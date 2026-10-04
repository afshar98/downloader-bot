import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { XMediaProvider } from '../src/x-media-provider.js';

const config = loadConfig({
  TELEGRAM_BOT_TOKEN: '123456:test-token',
  YT_DLP_PATH: '/usr/local/bin/yt-dlp',
  YT_DLP_EXPECTED_VERSION: '2026.08.19',
  FFMPEG_PATH: '/usr/bin/ffmpeg',
  FFMPEG_EXPECTED_VERSION: '6.1.1',
});

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function runner(stdout: string, exitCode = 0, stderr = '') {
  return {
    run: vi.fn(async () => ({ exitCode, stdout, stderr })),
  };
}

describe('XMediaProvider', () => {
  it('selects the highest-resolution progressive MP4 from validated yt-dlp JSON', async () => {
    const processRunner = runner(await fixture('x-animation.json'));
    const provider = new XMediaProvider({ config, runner: processRunner });

    await expect(
      provider.getAnimation('https://x.com/name/status/123456789', new AbortController().signal),
    ).resolves.toEqual({
      url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/720x720/high.mp4?tag=1',
      container: 'mp4',
      width: 720,
      height: 720,
      expectedSizeBytes: 900000,
    });
    expect(processRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: '/usr/local/bin/yt-dlp',
        args: expect.arrayContaining([
          '--no-config',
          '--no-plugin-dirs',
          '--no-playlist',
          '--skip-download',
          '--dump-single-json',
          'https://x.com/name/status/123456789',
        ]),
      }),
    );
  });

  it('distinguishes a valid accessible post with no animation', async () => {
    const provider = new XMediaProvider({
      config,
      runner: runner(await fixture('x-no-animation.json')),
    });

    await expect(
      provider.getAnimation('https://x.com/name/status/123456789', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'no-animation' });
  });

  it('rejects malformed JSON and malformed format collections safely', async () => {
    const malformedJson = new XMediaProvider({ config, runner: runner('{') });
    const malformedFormats = new XMediaProvider({
      config,
      runner: runner(await fixture('x-invalid.json')),
    });

    await expect(
      malformedJson.getAnimation(
        'https://x.com/name/status/123456789',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'extraction-failed' });
    await expect(
      malformedFormats.getAnimation(
        'https://x.com/name/status/123456789',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'extraction-failed' });
  });

  it.each([
    'http://video.twimg.com/ext_tw_video/1/low.mp4',
    'https://127.0.0.1/clip.mp4',
    'https://169.254.1.2/clip.mp4',
    'https://example.com/clip.mp4',
  ])('does not select a direct media URL at a disallowed destination: %s', async (url) => {
    const output = JSON.stringify({
      id: '123456789',
      formats: [
        {
          url,
          ext: 'mp4',
          protocol: 'https',
          vcodec: 'avc1',
          acodec: 'none',
          width: 320,
          height: 320,
        },
      ],
    });
    const provider = new XMediaProvider({ config, runner: runner(output) });

    await expect(
      provider.getAnimation('https://x.com/name/status/123456789', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'unsafe-media-url' });
  });

  it('maps known private or missing post responses to inaccessible', async () => {
    const provider = new XMediaProvider({
      config,
      runner: runner('', 1, 'ERROR: HTTP Error 404: Not Found'),
    });

    try {
      await provider.getAnimation(
        'https://x.com/name/status/123456789',
        new AbortController().signal,
      );
      throw new Error('expected inaccessible post error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'post-inaccessible' });
    }
  });
});
