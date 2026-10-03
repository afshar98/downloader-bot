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
      deliveryPath: media.path,
      deliverySizeBytes: media.sizeBytes,
      deliveryContainer: 'mp4',
      transformed: false,
    });
  });

  it('keeps an animation label with unknown audio on the video path', async () => {
    const media = downloadedMedia({ kind: 'animation', audioPresence: 'unknown' });
    const processor = new DirectMediaProcessor({ maxMediaBytes: 10_000_000 });

    await expect(processor.prepare(media)).resolves.toMatchObject({
      downloaded: media,
      deliveryKind: 'video',
      deliveryContainer: 'mp4',
      transformed: false,
    });
  });

  it('does not report confirmed silent MP4 as a prepared animation before conversion exists', async () => {
    const media = downloadedMedia({ audioPresence: 'absent' });
    const processor = new DirectMediaProcessor({ maxMediaBytes: 10_000_000 });

    await expect(processor.prepare(media)).rejects.toMatchObject({
      code: 'MediaProcessingFailed',
      stage: 'processing',
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
