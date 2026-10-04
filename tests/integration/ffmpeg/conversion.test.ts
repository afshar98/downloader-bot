import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GifConverter } from '../../../src/gif-converter.js';
import { ProcessRunner } from '../../../src/process-runner.js';

const SOURCE = new URL('../../fixtures/media/source.mp4', import.meta.url);

describe('real FFmpeg conversion', () => {
  it('writes a bounded, decodable animated GIF artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xgif-ffmpeg-test-'));
    const sourcePath = join(root, 'source.mp4');
    const partialPath = join(root, 'result.gif.part');
    const gifPath = join(root, 'result.gif');
    const executable = process.env['FFMPEG_PATH']?.trim() || '/usr/bin/ffmpeg';
    const maxGifBytes = 15 * 1024 * 1024;

    try {
      await writeFile(sourcePath, await readFile(SOURCE));
      const media = await new GifConverter({
        executable,
        maxSourceBytes: 20 * 1024 * 1024,
        maxGifBytes,
        runner: new ProcessRunner(),
      }).convert(sourcePath, partialPath, gifPath, new AbortController().signal);
      const [bytes, file] = await Promise.all([readFile(gifPath), stat(gifPath)]);

      expect(['GIF87a', 'GIF89a']).toContain(bytes.toString('ascii', 0, 6));
      expect(media).toMatchObject({ container: 'gif', frameCount: expect.any(Number) });
      expect(media.frameCount).toBeGreaterThanOrEqual(2);
      expect(media.width).toBeLessThanOrEqual(640);
      expect(media.height).toBeLessThanOrEqual(640);
      expect(file.size).toBeGreaterThan(0);
      expect(file.size).toBeLessThanOrEqual(maxGifBytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
