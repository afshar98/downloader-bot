import { describe, expect, it } from 'vitest';
import { RepresentationSelector } from '../../../src/media/representation-selector.js';
import { applicationError } from '../../../src/shared/errors.js';
import { discoveredMedia, representation } from '../../support/builders.js';

const selector = new RepresentationSelector({ maxFallbacks: 3 });

describe('RepresentationSelector', () => {
  it('orders direct MP4 candidates by dimensions, bitrate, duration, and source index', () => {
    const media = discoveredMedia({
      audioPresence: 'unknown',
      representations: [
        representation({
          representationId: 'small',
          width: 640,
          height: 360,
          bitrate: 800,
          sourceIndex: 3,
        }),
        representation({
          representationId: 'large',
          width: 1280,
          height: 720,
          bitrate: 2_000,
          sourceIndex: 2,
        }),
        representation({
          representationId: 'missing',
          width: null,
          height: null,
          bitrate: null,
          sourceIndex: 0,
        }),
        representation({
          representationId: 'same-quality-later',
          width: 1280,
          height: 720,
          bitrate: 2_000,
          sourceIndex: 5,
        }),
        representation({
          representationId: 'longer',
          width: 1280,
          height: 720,
          bitrate: 2_000,
          durationSeconds: 20,
          sourceIndex: 1,
        }),
      ],
    });

    expect(
      selector
        .select(media, { maxMediaBytes: 100_000_000 })
        .map((candidate) => candidate.representationId),
    ).toEqual(['longer', 'large', 'same-quality-later']);
  });

  it('filters known oversize, HLS, non-HTTPS, and missing-codec candidates', () => {
    const media = discoveredMedia({
      audioPresence: 'unknown',
      representations: [
        representation({ representationId: 'too-big', sizeBytes: 51_380_225 }),
        representation({ representationId: 'hls', protocol: 'm3u8_native' }),
        representation({
          representationId: 'http',
          url: new URL('http://media.example/video.mp4'),
        }),
        representation({ representationId: 'unknown-codec', videoCodec: null }),
        representation({ representationId: 'fits', sizeBytes: 50 }),
        representation({ representationId: 'unknown-size', sizeBytes: null }),
      ],
    });

    expect(
      selector.select(media, { maxMediaBytes: 100 }).map((item) => item.representationId),
    ).toEqual(['fits', 'unknown-size']);
  });

  it('distinguishes all-oversize representations from no compatible direct representation', () => {
    expect(() =>
      selector.select(
        discoveredMedia({
          audioPresence: 'unknown',
          representations: [representation({ sizeBytes: 200 })],
        }),
        {
          maxMediaBytes: 100,
        },
      ),
    ).toThrow(applicationError('MediaTooLarge', 'processing'));

    expect(() =>
      selector.select(
        discoveredMedia({
          audioPresence: 'unknown',
          representations: [representation({ protocol: 'm3u8_native' })],
        }),
        { maxMediaBytes: 100 },
      ),
    ).toThrow(applicationError('MediaProcessingFailed', 'processing'));
  });
});
