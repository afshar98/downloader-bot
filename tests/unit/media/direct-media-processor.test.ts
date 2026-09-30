import { describe, expect, it } from 'vitest';
import { DirectMediaProcessor } from '../../../src/media/direct-media-processor.js';
import { downloadedMedia } from '../../support/builders.js';

describe('DirectMediaProcessor', () => {
  it('returns a compatible MP4 unchanged without transformation', async () => {
    const media = downloadedMedia();
    const processor = new DirectMediaProcessor({ maxMediaBytes: 10_000_000 });

    await expect(processor.prepare(media)).resolves.toEqual({
      downloaded: media,
      deliveryKind: 'video',
      transformed: false,
    });
  });

  it('preserves animation delivery metadata without conversion', async () => {
    const media = downloadedMedia({ kind: 'animation' });
    const processor = new DirectMediaProcessor({ maxMediaBytes: 10_000_000 });

    await expect(processor.prepare(media)).resolves.toMatchObject({
      downloaded: media,
      deliveryKind: 'animation',
      transformed: false,
    });
  });

  it('rejects incompatible media and oversize files with stable errors', async () => {
    const processor = new DirectMediaProcessor({ maxMediaBytes: 100 });
    await expect(
      processor.prepare(downloadedMedia({ path: '/tmp/item-0001.part', sizeBytes: 50 })),
    ).rejects.toMatchObject({ code: 'MediaProcessingFailed' });
    await expect(processor.prepare(downloadedMedia({ sizeBytes: 101 }))).rejects.toMatchObject({
      code: 'MediaTooLarge',
    });
  });
});
