import { describe, expect, it } from 'vitest';
import { DirectMediaProcessor } from '../../../src/media/direct-media-processor.js';
import { RepresentationSelector } from '../../../src/media/representation-selector.js';
import { applicationError } from '../../../src/shared/errors.js';
import { discoveredMedia, downloadedMedia, representation } from '../../support/builders.js';

describe('animation direct delivery', () => {
  it('keeps confirmed audio on audio-bearing candidates and their fallback chain', () => {
    const media = discoveredMedia({
      audioPresence: 'present',
      representations: [
        representation({
          representationId: 'silent-higher',
          width: 1920,
          audioEvidence: 'absent',
          audioCodec: 'none',
        }),
        representation({
          representationId: 'unknown',
          width: 1600,
          audioEvidence: 'unknown',
          audioCodec: null,
        }),
        representation({ representationId: 'audio-best', width: 1280, audioEvidence: 'present' }),
        representation({
          representationId: 'audio-fallback',
          width: 640,
          audioEvidence: 'present',
        }),
      ],
    });
    expect(
      new RepresentationSelector({ maxFallbacks: 2 })
        .select(media, { maxMediaBytes: 51_380_224 })
        .map((item) => item.representationId),
    ).toEqual(['audio-best', 'audio-fallback']);
  });

  it('requires confirmed silence and AVC input before selecting conversion sources', () => {
    const media = discoveredMedia({
      audioPresence: 'absent',
      representations: [
        representation({ representationId: 'unknown', audioEvidence: 'unknown', audioCodec: null }),
        representation({ representationId: 'sound', audioEvidence: 'present' }),
        representation({
          representationId: 'silent-vp9',
          videoCodec: 'vp9',
          audioEvidence: 'absent',
          audioCodec: 'none',
        }),
        representation({
          representationId: 'silent-avc',
          videoCodec: 'h264',
          audioEvidence: 'absent',
          audioCodec: 'none',
        }),
      ],
    });
    expect(
      new RepresentationSelector()
        .select(media, { maxMediaBytes: 51_380_224 })
        .map((item) => item.representationId),
    ).toEqual(['silent-avc']);
  });

  it('does not let an animation label with unknown audio change the video upload path', async () => {
    const media = discoveredMedia({
      kind: 'animation',
      representations: [
        representation({
          representationId: 'animation-mp4',
          sizeBytes: 900_000,
          audioCodec: 'none',
        }),
      ],
    });
    const selected = new RepresentationSelector().select(media, { maxMediaBytes: 51_380_224 });
    const downloaded = downloadedMedia({
      kind: 'animation',
      audioPresence: 'unknown',
      sizeBytes: 900_000,
    });
    const prepared = await new DirectMediaProcessor({ maxMediaBytes: 51_380_224 }).prepare(
      downloaded,
    );

    expect(selected.map((candidate) => candidate.representationId)).toEqual(['animation-mp4']);
    expect(prepared).toMatchObject({
      deliveryKind: 'video',
      deliveryContainer: 'mp4',
      transformed: false,
    });
  });

  it('filters animation representations for AVC video without audio before ranking', () => {
    const media = discoveredMedia({
      kind: 'animation',
      representations: [
        representation({ representationId: 'high-audio', width: 1920, audioCodec: 'mp4a.40.2' }),
        representation({
          representationId: 'high-vp9',
          width: 1920,
          videoCodec: 'vp9',
          audioCodec: 'none',
        }),
        representation({
          representationId: 'low-compatible',
          width: 640,
          videoCodec: 'h264',
          audioCodec: 'none',
        }),
      ],
    });
    expect(
      new RepresentationSelector()
        .select(media, { maxMediaBytes: 51_380_224 })
        .map((candidate) => candidate.representationId),
    ).toEqual(['low-compatible']);
  });

  it('keeps ordinary video representation compatibility unchanged', () => {
    const media = discoveredMedia({
      representations: [representation({ videoCodec: 'vp9', audioCodec: 'opus' })],
    });
    expect(new RepresentationSelector().select(media, { maxMediaBytes: 51_380_224 })).toHaveLength(
      1,
    );
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
