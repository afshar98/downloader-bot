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
    expect(new RepresentationSelector().select(media!, { maxMediaBytes: 51_380_224 })).toHaveLength(
      2,
    );
  });
});
