import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import type { ProcessRunnerPort } from '../application/ports.js';
import type { ProcessingBudget } from '../application/models.js';
import { applicationError, isApplicationError, operationAbortError } from '../shared/errors.js';

const MAX_SOURCE_PIXELS = 16_777_216;
const MAX_ALLOCATION_BYTES = 64 * 1024 * 1024;
const DIAGNOSTIC_LIMIT_BYTES = 16 * 1024;

export type GifValidatorOptions = Readonly<{
  executable: string;
  maxMediaBytes: number;
}>;

export class GifValidator {
  constructor(
    private readonly runner: Pick<ProcessRunnerPort, 'run'>,
    private readonly options: GifValidatorOptions,
  ) {}

  async validate(path: string, budget: ProcessingBudget): Promise<number> {
    try {
      const details = await lstat(path);
      if (!details.isFile() || details.isSymbolicLink() || details.size < 1) throw new Error();
      if (details.size > this.options.maxMediaBytes) {
        throw applicationError('MediaTooLarge', 'processing');
      }
      await validateGifStructure(path, details.size);
      const timeoutMs = remainingMs(budget);
      const result = await this.runner.run({
        stage: 'processing',
        executable: this.options.executable,
        args: [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-max_alloc',
          String(MAX_ALLOCATION_BYTES),
          '-threads',
          '1',
          '-filter_threads',
          '1',
          '-filter_complex_threads',
          '1',
          '-max_pixels',
          String(MAX_SOURCE_PIXELS),
          '-protocol_whitelist',
          'file',
          '-f',
          'gif',
          '-ignore_loop',
          '1',
          '-xerror',
          '-err_detect',
          'explode',
          '-i',
          path,
          '-f',
          'null',
          '-',
        ],
        timeoutMs,
        stdoutLimitBytes: DIAGNOSTIC_LIMIT_BYTES,
        stderrLimitBytes: DIAGNOSTIC_LIMIT_BYTES,
        signal: budget.signal,
      });
      if (result.exitCode !== 0) throw applicationError('MediaProcessingFailed', 'processing');
      return details.size;
    } catch (error) {
      if (isApplicationError(error)) throw error;
      if (budget.signal.aborted) throw operationAbortError(budget.signal.reason, 'processing');
      throw applicationError('MediaProcessingFailed', 'processing', { cause: error });
    }
  }
}

async function validateGifStructure(path: string, expectedSize: number): Promise<void> {
  const reader = new GifByteReader(path);
  try {
    const signature = await reader.readBytes(6);
    if (signature.toString('ascii') !== 'GIF87a' && signature.toString('ascii') !== 'GIF89a') {
      throw new Error('invalid GIF signature');
    }
    const logicalScreen = await reader.readBytes(7);
    const width = readUint16(logicalScreen, 0);
    const height = readUint16(logicalScreen, 2);
    if (!isBoundedDimension(width) || !isBoundedDimension(height)) throw new Error('dimensions');
    if ((logicalScreen[4]! & 0x80) !== 0) {
      await reader.skip(3 * 2 ** ((logicalScreen[4]! & 0x07) + 1));
    }

    let images = 0;
    while (true) {
      const marker = await reader.readByte();
      if (marker === 0x3b) {
        if (
          images === 0 ||
          reader.bytesRead !== expectedSize ||
          (await reader.readByte()) !== undefined
        ) {
          throw new Error('incomplete GIF');
        }
        return;
      }
      if (marker === 0x21) {
        await reader.readByte();
        await reader.skipSubBlocks();
        continue;
      }
      if (marker !== 0x2c) throw new Error('invalid GIF block');

      const descriptor = await reader.readBytes(9);
      const frameWidth = readUint16(descriptor, 4);
      const frameHeight = readUint16(descriptor, 6);
      if (!isBoundedDimension(frameWidth) || !isBoundedDimension(frameHeight)) {
        throw new Error('frame dimensions');
      }
      if ((descriptor[8]! & 0x80) !== 0) {
        await reader.skip(3 * 2 ** ((descriptor[8]! & 0x07) + 1));
      }
      const minimumCodeSize = await reader.readByte();
      if (minimumCodeSize === undefined || minimumCodeSize < 2 || minimumCodeSize > 8) {
        throw new Error('invalid LZW code size');
      }
      await reader.skipSubBlocks();
      images += 1;
    }
  } finally {
    await reader.close();
  }
}

class GifByteReader {
  private readonly iterator: AsyncIterator<Buffer>;
  private current: Uint8Array = new Uint8Array(0);
  private offset = 0;
  bytesRead = 0;

  constructor(path: string) {
    this.iterator = createReadStream(path, { highWaterMark: 16 * 1024 })[Symbol.asyncIterator]();
  }

  async readByte(): Promise<number | undefined> {
    if (!(await this.ensureBuffer())) return undefined;
    this.bytesRead += 1;
    return this.current[this.offset++];
  }

  async readBytes(count: number): Promise<Buffer> {
    const result = Buffer.allocUnsafe(count);
    let copied = 0;
    while (copied < count) {
      if (!(await this.ensureBuffer())) throw new Error('truncated GIF');
      const amount = Math.min(count - copied, this.current.length - this.offset);
      result.set(this.current.subarray(this.offset, this.offset + amount), copied);
      this.offset += amount;
      this.bytesRead += amount;
      copied += amount;
    }
    return result;
  }

  async skip(count: number): Promise<void> {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalid GIF block length');
    let remaining = count;
    while (remaining > 0) {
      if (!(await this.ensureBuffer())) throw new Error('truncated GIF block');
      const amount = Math.min(remaining, this.current.length - this.offset);
      this.offset += amount;
      this.bytesRead += amount;
      remaining -= amount;
    }
  }

  async skipSubBlocks(): Promise<void> {
    while (true) {
      const length = await this.readByte();
      if (length === undefined) throw new Error('truncated GIF sub-block');
      if (length === 0) return;
      await this.skip(length);
    }
  }

  async close(): Promise<void> {
    await this.iterator.return?.();
  }

  private async ensureBuffer(): Promise<boolean> {
    while (this.offset >= this.current.length) {
      const next = await this.iterator.next();
      if (next.done) return false;
      this.current = next.value;
      this.offset = 0;
    }
    return true;
  }
}

function readUint16(value: Buffer, offset: number): number {
  return value.readUInt16LE(offset);
}

function isBoundedDimension(value: number): boolean {
  return value > 0 && value <= 640;
}

function remainingMs(budget: ProcessingBudget): number {
  if (budget.signal.aborted) throw operationAbortError(budget.signal.reason, 'processing');
  const remaining = budget.remainingMs();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw applicationError('OperationTimedOut', 'processing');
  }
  return Math.max(1, Math.floor(remaining));
}
