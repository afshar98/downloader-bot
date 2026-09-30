import type {
  DeliveryLimits,
  DiscoveredMedia,
  MediaRepresentation,
} from '../application/models.js';
import { applicationError } from '../shared/errors.js';

export type RepresentationSelectorOptions = Readonly<{ maxFallbacks?: number }>;

export class RepresentationSelector {
  private readonly maxFallbacks: number;

  constructor(options: RepresentationSelectorOptions = {}) {
    this.maxFallbacks = options.maxFallbacks ?? 3;
    if (!Number.isSafeInteger(this.maxFallbacks) || this.maxFallbacks < 1) {
      throw new RangeError('maxFallbacks must be a positive integer');
    }
  }

  select(media: DiscoveredMedia, limits: DeliveryLimits): readonly MediaRepresentation[] {
    const direct = media.representations.filter((candidate) => isDirectMp4(candidate, media.kind));
    const fitting = direct.filter((candidate) => {
      const size = usableSize(candidate.sizeBytes);
      return size === undefined || size <= limits.maxMediaBytes;
    });

    if (fitting.length === 0) {
      if (
        direct.some((candidate) => (usableSize(candidate.sizeBytes) ?? 0) > limits.maxMediaBytes)
      ) {
        throw applicationError('MediaTooLarge', 'processing');
      }
      throw applicationError('MediaProcessingFailed', 'processing');
    }

    return [...fitting].sort(compareQuality).slice(0, this.maxFallbacks);
  }
}

function isDirectMp4(candidate: MediaRepresentation, kind: DiscoveredMedia['kind']): boolean {
  const videoCodec = candidate.videoCodec?.trim().toLowerCase() ?? '';
  const animationCompatible =
    kind !== 'animation' ||
    ((videoCodec === 'h264' || videoCodec.startsWith('avc1') || videoCodec.startsWith('avc3')) &&
      candidate.audioCodec?.trim().toLowerCase() === 'none');
  return (
    animationCompatible &&
    candidate.url.protocol === 'https:' &&
    candidate.url.username === '' &&
    candidate.url.password === '' &&
    (candidate.url.port === '' || candidate.url.port === '443') &&
    candidate.container.toLowerCase() === 'mp4' &&
    candidate.protocol.toLowerCase() === 'https' &&
    typeof candidate.videoCodec === 'string' &&
    candidate.videoCodec.trim() !== '' &&
    candidate.videoCodec.toLowerCase() !== 'none'
  );
}

function compareQuality(left: MediaRepresentation, right: MediaRepresentation): number {
  const areaDifference = pixelArea(right) - pixelArea(left);
  if (areaDifference !== 0) return areaDifference;
  const bitrateDifference = usableQuality(right.bitrate) - usableQuality(left.bitrate);
  if (bitrateDifference !== 0) return bitrateDifference;
  const durationDifference =
    usableQuality(right.durationSeconds) - usableQuality(left.durationSeconds);
  if (durationDifference !== 0) return durationDifference;
  const sourceDifference = validIndex(left.sourceIndex) - validIndex(right.sourceIndex);
  if (sourceDifference !== 0) return sourceDifference;
  return left.representationId.localeCompare(right.representationId);
}

function pixelArea(candidate: MediaRepresentation): number {
  const width = usableQuality(candidate.width);
  const height = usableQuality(candidate.height);
  return width * height;
}

function usableQuality(value: number | null | undefined): number {
  return value !== undefined && value !== null && Number.isFinite(value) && value > 0 ? value : 0;
}

function usableSize(value: number | null | undefined): number | undefined {
  return value !== undefined && value !== null && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function validIndex(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER;
}
