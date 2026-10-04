import { lstat, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ProcessRunner } from './process-runner.js';
import { AppError } from './errors.js';

export type GifValidation = Readonly<{ width: number; height: number; frameCount: number }>;
type GifValidatorOptions = Readonly<{
  executable: string;
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
  maxFrames: number;
  timeoutMs?: number;
  runner?: Pick<ProcessRunner, 'run'>;
}>;

export class GifValidator {
  private readonly runner: Pick<ProcessRunner, 'run'>;

  constructor(private readonly options: GifValidatorOptions) {
    this.runner = options.runner ?? new ProcessRunner();
  }

  async validate(path: string, signal: AbortSignal): Promise<GifValidation> {
    if (signal.aborted) throw new AppError('cancelled');
    let bytes: Buffer;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new AppError('invalid-gif');
      if (info.size > this.options.maxBytes) throw new AppError('media-too-large');
      if (info.size === 0) throw new AppError('invalid-gif');
      bytes = await readFile(path);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('invalid-gif', 'GIF file could not be read', { cause: error });
    }
    if (bytes.length > this.options.maxBytes) throw new AppError('media-too-large');
    const result = parseGif(bytes, this.options);
    try {
      const decoded = await this.runner.run({
        executable: this.options.executable,
        args: [
          '-hide_banner',
          '-v',
          'error',
          '-xerror',
          '-nostdin',
          '-threads',
          '1',
          '-i',
          path,
          '-f',
          'null',
          '-',
        ],
        cwd: dirname(path),
        signal,
        timeoutMs: Math.min(this.options.timeoutMs ?? 15_000, 15_000),
        maxStdoutBytes: 1024,
        maxStderrBytes: 16 * 1024,
      });
      if (decoded.exitCode !== 0) throw new AppError('invalid-gif');
    } catch (error) {
      if (error instanceof AppError && ['cancelled', 'timed-out'].includes(error.code)) throw error;
      if (error instanceof AppError && error.code === 'invalid-gif') throw error;
      throw new AppError('invalid-gif', 'GIF decoding failed', { cause: error });
    }
    return result;
  }
}

function parseGif(bytes: Buffer, limits: GifValidatorOptions): GifValidation {
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
    throw new AppError('invalid-gif');
  }
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  if (!width || !height || width > limits.maxWidth || height > limits.maxHeight) {
    throw new AppError('invalid-gif');
  }
  let offset = 13;
  if (bytes[10]! & 0x80) offset += 3 * (1 << ((bytes[10]! & 7) + 1));
  if (offset > bytes.length) throw new AppError('invalid-gif');
  let frames = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset++]!;
    if (marker === 0x3b) {
      if (offset !== bytes.length || frames < 2) throw new AppError('invalid-gif');
      return { width, height, frameCount: frames };
    }
    if (marker === 0x21) {
      if (offset >= bytes.length) throw new AppError('invalid-gif');
      offset++;
      offset = skipSubBlocks(bytes, offset);
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) throw new AppError('invalid-gif');
    const left = bytes.readUInt16LE(offset);
    const top = bytes.readUInt16LE(offset + 2);
    const frameWidth = bytes.readUInt16LE(offset + 4);
    const frameHeight = bytes.readUInt16LE(offset + 6);
    const packed = bytes[offset + 8]!;
    offset += 9;
    if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) {
      throw new AppError('invalid-gif');
    }
    if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
    if (offset >= bytes.length || bytes[offset]! < 2 || bytes[offset]! > 8)
      throw new AppError('invalid-gif');
    offset++;
    offset = skipSubBlocks(bytes, offset);
    frames++;
    if (frames > limits.maxFrames) throw new AppError('invalid-gif');
  }
  throw new AppError('invalid-gif');
}

function skipSubBlocks(bytes: Buffer, start: number): number {
  let offset = start;
  while (offset < bytes.length) {
    const size = bytes[offset++]!;
    if (size === 0) return offset;
    offset += size;
    if (offset > bytes.length) throw new AppError('invalid-gif');
  }
  throw new AppError('invalid-gif');
}
