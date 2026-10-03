import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessingBudget } from '../../../src/application/models.js';
import type { ProcessRunnerPort } from '../../../src/application/ports.js';
import { GifValidator } from '../../../src/media/gif-validator.js';
import { applicationError } from '../../../src/shared/errors.js';
import { tinyGif } from '../../support/ffmpeg/gif-fixtures.js';

const roots: string[] = [];
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'gif-validator-'));
  roots.push(path);
  return path;
}
const budget = (): ProcessingBudget => ({
  signal: new AbortController().signal,
  deadlineAt: 10_000,
  remainingMs: () => 8_000,
});
const successRunner = (): ProcessRunnerPort => ({
  checkVersion: vi.fn(),
  run: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0, signal: null })),
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('GifValidator', () => {
  it('checks complete structure and performs a strict bounded full decode', async () => {
    const path = join(await root(), 'complete.gif');
    await writeFile(path, tinyGif);
    const runner = successRunner();
    const validator = new GifValidator(runner, {
      executable: '/trusted/ffmpeg',
      maxMediaBytes: 1024,
    });

    await expect(validator.validate(path, budget())).resolves.toBe(tinyGif.byteLength);
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'processing',
        executable: '/trusted/ffmpeg',
        timeoutMs: 8_000,
        stdoutLimitBytes: 16 * 1024,
        stderrLimitBytes: 16 * 1024,
        args: expect.arrayContaining([
          '-f',
          'gif',
          '-ignore_loop',
          '1',
          '-xerror',
          '-err_detect',
          'explode',
          '-f',
          'null',
          '-',
        ]),
      }),
    );
  });

  it.each([
    ['missing header', Buffer.alloc(0)],
    ['truncated after a valid image', tinyGif.subarray(0, tinyGif.length - 1)],
    ['missing image', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00\x3b', 'binary')],
    ['bad block boundary', Buffer.concat([tinyGif.subarray(0, -1), Buffer.from([0x01, 0x3b])])],
  ])('rejects %s before starting the decoder', async (_label, bytes) => {
    const path = join(await root(), 'invalid.gif');
    await writeFile(path, bytes);
    const runner = successRunner();
    const validator = new GifValidator(runner, {
      executable: '/trusted/ffmpeg',
      maxMediaBytes: 1024,
    });

    await expect(validator.validate(path, budget())).rejects.toMatchObject({
      code: 'MediaProcessingFailed',
      stage: 'processing',
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('rejects over-limit media and full decode failures', async () => {
    const path = join(await root(), 'large.gif');
    await writeFile(path, tinyGif);
    const validator = new GifValidator(successRunner(), {
      executable: 'ffmpeg',
      maxMediaBytes: 10,
    });
    await expect(validator.validate(path, budget())).rejects.toMatchObject({
      code: 'MediaTooLarge',
    });

    const runner: ProcessRunnerPort = {
      checkVersion: vi.fn(),
      run: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 1, signal: null })),
    };
    await expect(
      new GifValidator(runner, { executable: 'ffmpeg', maxMediaBytes: 1024 }).validate(
        path,
        budget(),
      ),
    ).rejects.toMatchObject({ code: 'MediaProcessingFailed' });
  });

  it('preserves shared processing timeout and cancellation', async () => {
    const path = join(await root(), 'valid.gif');
    await writeFile(path, tinyGif);
    const runner: ProcessRunnerPort = {
      checkVersion: vi.fn(),
      run: vi.fn(async () => {
        throw applicationError('OperationTimedOut', 'processing');
      }),
    };
    await expect(
      new GifValidator(runner, { executable: 'ffmpeg', maxMediaBytes: 1024 }).validate(
        path,
        budget(),
      ),
    ).rejects.toMatchObject({ code: 'OperationTimedOut', stage: 'processing' });
  });
});
