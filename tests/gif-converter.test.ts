import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/errors.js';
import { GifConverter } from '../src/gif-converter.js';
import type { GifValidator } from '../src/gif-validator.js';
import type { ProcessResult, ProcessRunInput, ProcessRunner } from '../src/process-runner.js';

const SOURCE = new URL('./fixtures/media/source.mp4', import.meta.url);
const VALID_GIF = new URL('./fixtures/media/valid.gif', import.meta.url);

type RunnerImplementation = (input: ProcessRunInput) => Promise<ProcessResult>;

function validator(overrides: Partial<GifValidator> = {}): Pick<GifValidator, 'validate'> {
  return {
    validate: overrides.validate ?? vi.fn(async () => ({ width: 32, height: 32, frameCount: 5 })),
  };
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'xgif-converter-test-'));
  const sourcePath = join(root, 'source.mp4');
  const partialPath = join(root, 'animation.gif.part');
  const gifPath = join(root, 'animation.gif');
  await writeFile(sourcePath, await readFile(SOURCE));
  return { root, sourcePath, partialPath, gifPath };
}

describe('GifConverter', () => {
  it('converts to a new GIF, validates it, and atomically finalizes the delivery path', async () => {
    const paths = await workspace();
    const bytes = await readFile(VALID_GIF);
    const run = vi.fn<RunnerImplementation>(async ({ args }) => {
      await writeFile(args.at(-1) ?? '', bytes);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const gifValidator = validator();
    const converter = new GifConverter({
      executable: '/usr/bin/ffmpeg',
      maxSourceBytes: 1024 * 1024,
      maxGifBytes: 1024 * 1024,
      runner: { run } as ProcessRunner,
      validator: gifValidator,
    });
    const signal = new AbortController().signal;

    try {
      await expect(
        converter.convert(paths.sourcePath, paths.partialPath, paths.gifPath, signal),
      ).resolves.toEqual({
        path: paths.gifPath,
        sizeBytes: bytes.length,
        width: 32,
        height: 32,
        frameCount: 5,
        container: 'gif',
      });
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          executable: '/usr/bin/ffmpeg',
          args: expect.arrayContaining(['-nostdin', '-an', '-f', 'gif', paths.partialPath]),
        }),
      );
      expect(gifValidator.validate).toHaveBeenCalledWith(paths.partialPath, signal);
      await expect(stat(paths.partialPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(paths.gifPath)).toEqual(bytes);
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });

  it('caps encoded output and removes an oversized partial file', async () => {
    const paths = await workspace();
    const bytes = await readFile(VALID_GIF);
    const run = vi.fn<RunnerImplementation>(async ({ args }) => {
      await writeFile(args.at(-1) ?? '', bytes);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const converter = new GifConverter({
      executable: '/usr/bin/ffmpeg',
      maxSourceBytes: 1024 * 1024,
      maxGifBytes: 8,
      runner: { run } as ProcessRunner,
      validator: validator(),
    });

    try {
      await expect(
        converter.convert(
          paths.sourcePath,
          paths.partialPath,
          paths.gifPath,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: 'media-too-large' });
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ args: expect.arrayContaining(['-fs', '8']) }),
      );
      await expect(stat(paths.partialPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(paths.gifPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });

  it.each([
    ['non-zero exit', async () => ({ exitCode: 1, stdout: '', stderr: 'private ffmpeg output' })],
    ['missing output', async () => ({ exitCode: 0, stdout: '', stderr: '' })],
    [
      'timeout',
      async () => {
        throw new AppError('timed-out');
      },
    ],
  ])('does not finalize an output after %s', async (_label, implementation) => {
    const paths = await workspace();
    const run = vi.fn<RunnerImplementation>(implementation);
    const converter = new GifConverter({
      executable: '/usr/bin/ffmpeg',
      maxSourceBytes: 1024 * 1024,
      maxGifBytes: 1024 * 1024,
      runner: { run } as ProcessRunner,
      validator: validator(),
    });

    try {
      await expect(
        converter.convert(
          paths.sourcePath,
          paths.partialPath,
          paths.gifPath,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: _label === 'timeout' ? 'timed-out' : 'conversion-failed' });
      await expect(stat(paths.gifPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(paths.partialPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });

  it('does not finalize data rejected by GIF validation', async () => {
    const paths = await workspace();
    const bytes = await readFile(VALID_GIF);
    const run = vi.fn<RunnerImplementation>(async ({ args }) => {
      await writeFile(args.at(-1) ?? '', bytes);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const converter = new GifConverter({
      executable: '/usr/bin/ffmpeg',
      maxSourceBytes: 1024 * 1024,
      maxGifBytes: 1024 * 1024,
      runner: { run } as ProcessRunner,
      validator: validator({
        validate: vi.fn(async () => {
          throw new AppError('invalid-gif');
        }),
      }),
    });

    try {
      await expect(
        converter.convert(
          paths.sourcePath,
          paths.partialPath,
          paths.gifPath,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: 'invalid-gif' });
      await expect(stat(paths.gifPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(paths.partialPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });
});
