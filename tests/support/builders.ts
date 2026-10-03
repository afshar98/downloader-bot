import type {
  DiscoveredMedia,
  DownloadedMedia,
  MediaRepresentation,
  PreparedMedia,
} from '../../src/application/models.js';

export function representation(overrides: Partial<MediaRepresentation> = {}): MediaRepresentation {
  const audioEvidence =
    overrides.audioEvidence ??
    (overrides.audioCodec?.trim().toLowerCase() === 'none'
      ? 'absent'
      : overrides.audioCodec
        ? 'present'
        : 'unknown');
  return {
    representationId: 'format-1',
    url: new URL('https://media.example.invalid/video.mp4'),
    container: 'mp4',
    protocol: 'https',
    videoCodec: 'avc1.64001f',
    audioCodec: 'mp4a.40.2',
    audioEvidence,
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
    kind: overrides.kind ?? 'video',
    audioPresence:
      overrides.audioPresence ?? (overrides.kind === 'animation' ? 'absent' : 'present'),
    representations: [representation()],
    ...overrides,
  };
}

export function downloadedMedia(overrides: Partial<DownloadedMedia> = {}): DownloadedMedia {
  return {
    mediaId: 'media-1',
    position: 1,
    kind: overrides.kind ?? 'video',
    audioPresence:
      overrides.audioPresence ?? (overrides.kind === 'animation' ? 'absent' : 'present'),
    path: '/tmp/workspace/item-0001.mp4',
    sizeBytes: 8_000_000,
    container: 'mp4',
    ...overrides,
  };
}

export function preparedMedia(
  overrides: {
    media?: DownloadedMedia;
  } = {},
): PreparedMedia {
  const downloaded = overrides.media ?? downloadedMedia();
  return {
    downloaded,
    deliveryKind: 'video',
    deliveryContainer: 'mp4',
    deliveryPath: downloaded.path,
    deliverySizeBytes: downloaded.sizeBytes,
    transformed: false,
  };
}

export function preparedAnimationMedia(
  overrides: { media?: DownloadedMedia; deliveryPath?: string; deliverySizeBytes?: number } = {},
): PreparedMedia {
  const downloaded =
    overrides.media ?? downloadedMedia({ kind: 'animation', audioPresence: 'absent' });
  return {
    downloaded,
    deliveryKind: 'animation',
    deliveryContainer: 'gif',
    deliveryPath: overrides.deliveryPath ?? '/tmp/workspace/item-0001.gif',
    deliverySizeBytes: overrides.deliverySizeBytes ?? 90_000,
    transformed: true,
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
