import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { RepresentationSelector } from '../../../../src/media/representation-selector.js';
import { parseYtDlpMetadata } from '../../../../src/providers/x/yt-dlp-schema.js';

describe('yt-dlp direct Twitter formats', () => {
  it('selects MP4 formats when yt-dlp omits codec fields', async () => {
    const metadata = await readFile(
      new URL('../../../fixtures/x/direct-codec-omitted.json', import.meta.url),
      'utf8',
    );
    const [media] = parseYtDlpMetadata(metadata, 1_048_576);

    expect(media).toBeDefined();
    expect(media?.kind).toBe('animation');
    expect(media?.audioPresence).toBe('absent');
    expect(new RepresentationSelector().select(media!, { maxMediaBytes: 51_380_224 })).toHaveLength(
      2,
    );
  });

  it.each([
    [{ acodec: '  NONE ', audio_ext: ' none ' }, 'absent'],
    [{ acodec: ' MP4A.40.2 ', audio_ext: ' M4A ' }, 'present'],
    [{ acodec: 'unknown', audio_ext: ' ' }, 'unknown'],
    [{ acodec: 'none', audio_ext: 'm4a' }, 'conflicting'],
    [{ acodec: null, audio_ext: 'm4a' }, 'present'],
    [{ acodec: 'opus', audio_ext: 'none' }, 'conflicting'],
  ] as const)('normalizes independent audio fields %o', async (fields, expected) => {
    const [media] = parseYtDlpMetadata(
      JSON.stringify({
        id: 'post',
        formats: [
          {
            url: 'https://video.twimg.com/post/vid/avc1/video.mp4',
            protocol: 'https',
            ext: 'mp4',
            vcodec: 'avc1',
            ...fields,
          },
        ],
      }),
      10_000,
    );
    expect(media?.representations[0]?.audioEvidence).toBe(expected);
    expect(media?.audioPresence).toBe(
      expected === 'absent' ? 'absent' : expected === 'present' ? 'present' : 'unknown',
    );
  });

  it('aggregates evidence from usable video formats before delivery filtering', () => {
    const [media] = parseYtDlpMetadata(
      JSON.stringify({
        id: 'post',
        formats: [
          {
            url: 'https://video.twimg.com/post/vid/avc1/silent.mp4',
            protocol: 'https',
            ext: 'mp4',
            vcodec: 'avc1',
            acodec: 'none',
            audio_ext: 'none',
          },
          {
            url: 'https://video.twimg.com/post/audio.m3u8',
            protocol: 'm3u8_native',
            ext: 'mp4',
            vcodec: 'h264',
            acodec: 'mp4a.40.2',
            audio_ext: 'm4a',
          },
        ],
      }),
      10_000,
    );
    expect(media?.audioPresence).toBe('present');
    expect(media?.kind).toBe('video');
    expect(() => new RepresentationSelector().select(media!, { maxMediaBytes: 1000 })).toThrow(
      expect.objectContaining({ code: 'MediaProcessingFailed' }),
    );
  });
});
