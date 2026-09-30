import { describe, expect, it } from 'vitest';
import { DirectMediaProcessor } from '../../../src/media/direct-media-processor.js';
import { RepresentationSelector } from '../../../src/media/representation-selector.js';
import { applicationError } from '../../../src/shared/errors.js';
import { discoveredMedia, downloadedMedia, representation } from '../../support/builders.js';

describe('animation direct delivery', () => {
  it('selects a compatible MP4 and preserves animation through preparation', async () => {
    const media = discoveredMedia({
      kind: 'animation',
      representations: [representation({ representationId: 'animation-mp4', sizeBytes: 900_000, audioCodec: 'none' })],
    });
    const selected = new RepresentationSelector().select(media, { maxMediaBytes: 51_380_224 });
    const downloaded = downloadedMedia({ kind: 'animation', sizeBytes: 900_000 });
    const prepared = await new DirectMediaProcessor({ maxMediaBytes: 51_380_224 }).prepare(
      downloaded,
    );

    expect(selected.map((candidate) => candidate.representationId)).toEqual(['animation-mp4']);
    expect(prepared).toMatchObject({ deliveryKind: 'animation', transformed: false });
  });

  it('filters animation representations for AVC video without audio before ranking', () => {
    const media = discoveredMedia({
      kind: 'animation',
      representations: [
        representation({ representationId: 'high-audio', width: 1920, audioCodec: 'mp4a.40.2' }),
        representation({ representationId: 'high-vp9', width: 1920, videoCodec: 'vp9', audioCodec: 'none' }),
        representation({ representationId: 'low-compatible', width: 640, videoCodec: 'h264', audioCodec: 'none' }),
      ],
    });
    expect(new RepresentationSelector().select(media, { maxMediaBytes: 51_380_224 })
      .map((candidate) => candidate.representationId)).toEqual(['low-compatible']);
  });

  it('keeps ordinary video representation compatibility unchanged', () => {
    const media = discoveredMedia({
      representations: [representation({ videoCodec: 'vp9', audioCodec: 'opus' })],
    });
    expect(new RepresentationSelector().select(media, { maxMediaBytes: 51_380_224 })).toHaveLength(1);
  });

  it('fails safely when the animation has no direct progressive MP4', () => {
    const media = discoveredMedia({
      kind: 'animation',
      representations: [representation({ protocol: 'm3u8_native' })],
    });

    expect(() => new RepresentationSelector().select(media, { maxMediaBytes: 51_380_224 })).toThrow(
      expect.objectContaining({ code: 'MediaProcessingFailed' }),
    );
    expect(applicationError('MediaProcessingFailed', 'processing').code).toBe(
      'MediaProcessingFailed',
    );
  });
});
