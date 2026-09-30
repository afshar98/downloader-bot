import type {
  DiscoveredMedia,
  DownloadedMedia,
  MediaKind,
  MediaRepresentation,
  PreparedMedia,
} from '../../src/application/models.js';

export function representation(overrides: Partial<MediaRepresentation> = {}): MediaRepresentation {
  return {
    representationId: 'format-1',
    url: new URL('https://media.example.invalid/video.mp4'),
    container: 'mp4',
    protocol: 'https',
    videoCodec: 'avc1.64001f',
    audioCodec: 'mp4a.40.2',
    width: 1280,
    height: 720,
    bitrate: 2_500,
    sizeBytes: 8_000_000,
    durationSeconds: 12,
    sourceIndex: 0,
    ...overrides,
  };
}

export function discoveredMedia(overrides: Partial<DiscoveredMedia> = {}): DiscoveredMedia {
  return {
    mediaId: 'media-1',
    position: 1,
    kind: 'video',
    representations: [representation()],
    ...overrides,
  };
}

export function downloadedMedia(overrides: Partial<DownloadedMedia> = {}): DownloadedMedia {
  return {
    mediaId: 'media-1',
    position: 1,
    kind: 'video',
    path: '/tmp/workspace/item-0001.mp4',
    sizeBytes: 8_000_000,
    container: 'mp4',
    ...overrides,
  };
}

export function preparedMedia(
  overrides: {
    media?: DownloadedMedia;
    deliveryKind?: MediaKind;
  } = {},
): PreparedMedia {
  const downloaded = overrides.media ?? downloadedMedia();
  return {
    downloaded,
    deliveryKind: overrides.deliveryKind ?? downloaded.kind,
    transformed: false,
  };
}

export function identifierSequence(values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) throw new Error('identifier sequence exhausted');
    index += 1;
    return value;
  };
}

export function fakeClock(initial = 0): {
  now(): number;
  advance(milliseconds: number): void;
} {
  let current = initial;
  return {
    now: () => current,
    advance: (milliseconds) => {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        throw new RangeError('Clock can only advance by a finite non-negative duration');
      }
      current += milliseconds;
    },
  };
}
