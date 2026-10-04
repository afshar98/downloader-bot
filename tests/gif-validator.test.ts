import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GifValidator } from '../src/gif-validator.js';
import type { ProcessResult, ProcessRunInput } from '../src/process-runner.js';

const VALID_GIF = new URL('./fixtures/media/valid.gif', import.meta.url);
const validGif = await readFile(VALID_GIF);
const SINGLE_FRAME_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

function runner(exitCode = 0) {
  return {
    run: vi.fn(async (_input: ProcessRunInput): Promise<ProcessResult> => ({
      exitCode,
      stdout: '',
      stderr: '',
    })),
  };
}

async function withGif(
  bytes: Uint8Array,
  validate: (path: string, processRunner: ReturnType<typeof runner>) => Promise<unknown>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'xgif-validator-test-'));
  const path = join(directory, 'sample.gif');
  const processRunner = runner();
  try {
    await writeFile(path, bytes);
    await validate(path, processRunner);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('GifValidator', () => {
  it.each(['GIF89a', 'GIF87a'])('accepts a decoded animated %s file', async (signature) => {
    const bytes = Buffer.from(validGif);
    bytes.write(signature, 0, 'ascii');

    await withGif(bytes, async (path, processRunner) => {
      const validator = new GifValidator({
        executable: '/usr/bin/ffmpeg',
        maxBytes: 1024 * 1024,
        maxWidth: 640,
        maxHeight: 640,
        maxFrames: 450,
        runner: processRunner,
      });

      await expect(validator.validate(path, new AbortController().signal)).resolves.toEqual({
        width: 32,
        height: 32,
        frameCount: 5,
      });
      expect(processRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          executable: '/usr/bin/ffmpeg',
          args: expect.arrayContaining(['-xerror', '-i', path, '-f', 'null', '-']),
        }),
      );
    });
  });

  it.each([
    ['MP4 bytes with a GIF filename', Buffer.from('ftypisomp42')],
    ['empty file', Buffer.alloc(0)],
    ['truncated animation', Buffer.from(validGif.subarray(0, 20))],
    ['single-frame image', SINGLE_FRAME_GIF],
    [
      'corrupt block stream',
      (() => {
        const bytes = Buffer.from(validGif);
        bytes[bytes.length - 1] = 0;
        return bytes;
      })(),
    ],
  ])('rejects %s before it can be delivered', async (_label, bytes) => {
    await withGif(bytes, async (path, processRunner) => {
      const validator = new GifValidator({
        executable: '/usr/bin/ffmpeg',
        maxBytes: 1024 * 1024,
        maxWidth: 640,
        maxHeight: 640,
        maxFrames: 450,
        runner: processRunner,
      });

      await expect(validator.validate(path, new AbortController().signal)).rejects.toMatchObject({
        code: 'invalid-gif',
      });
      expect(processRunner.run).not.toHaveBeenCalled();
    });
  });

  it('rejects a GIF whose logical screen exceeds the dimension cap', async () => {
    const bytes = Buffer.from(validGif);
    bytes.writeUInt16LE(641, 6);

    await withGif(bytes, async (path, processRunner) => {
      const validator = new GifValidator({
        executable: '/usr/bin/ffmpeg',
        maxBytes: 1024 * 1024,
        maxWidth: 640,
        maxHeight: 640,
        maxFrames: 450,
        runner: processRunner,
      });

      await expect(validator.validate(path, new AbortController().signal)).rejects.toMatchObject({
        code: 'invalid-gif',
      });
      expect(processRunner.run).not.toHaveBeenCalled();
    });
  });

  it('rejects a GIF larger than its byte cap', async () => {
    const bytes = Buffer.from(validGif);

    await withGif(bytes, async (path, processRunner) => {
      const validator = new GifValidator({
        executable: '/usr/bin/ffmpeg',
        maxBytes: bytes.length - 1,
        maxWidth: 640,
        maxHeight: 640,
        maxFrames: 450,
        runner: processRunner,
      });

      await expect(validator.validate(path, new AbortController().signal)).rejects.toMatchObject({
        code: 'media-too-large',
      });
      expect(processRunner.run).not.toHaveBeenCalled();
    });
  });

  it('rejects structurally valid data when FFmpeg cannot decode it', async () => {
    const bytes = Buffer.from(validGif);

    await withGif(bytes, async (path) => {
      const processRunner = runner(1);
      const validator = new GifValidator({
        executable: '/usr/bin/ffmpeg',
        maxBytes: 1024 * 1024,
        maxWidth: 640,
        maxHeight: 640,
        maxFrames: 450,
        runner: processRunner,
      });

      await expect(validator.validate(path, new AbortController().signal)).rejects.toMatchObject({
        code: 'invalid-gif',
      });
    });
  });
});
