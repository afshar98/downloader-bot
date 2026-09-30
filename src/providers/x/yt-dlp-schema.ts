import { z } from 'zod';
import type { DiscoveredMedia, MediaKind, MediaRepresentation } from '../../application/models.js';
import { applicationError } from '../../shared/errors.js';

const boundedText = z.string().min(1).max(2_048);
const optionalCodec = z.string().max(128).nullable().optional();
const optionalSize = z
  .number()
  .finite()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
  .optional();

const formatSchema = z
  .object({
    format_id: z.string().min(1).max(128).optional(),
    url: boundedText,
    protocol: z.string().min(1).max(64),
    ext: z.string().min(1).max(16),
    vcodec: optionalCodec,
    acodec: optionalCodec,
    width: z.number().int().min(1).max(32_768).nullable().optional(),
    height: z.number().int().min(1).max(32_768).nullable().optional(),
    tbr: z.number().finite().nonnegative().max(1_000_000_000).nullable().optional(),
    filesize: optionalSize,
    filesize_approx: optionalSize,
    duration: z.number().finite().nonnegative().max(86_400).nullable().optional(),
  })
  .passthrough();

const entrySchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    ext: z.string().max(16).optional(),
    media_type: z.string().max(32).optional(),
    formats: z.array(formatSchema).max(200).optional(),
  })
  .passthrough();

const metadataSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    entries: z.array(entrySchema).max(100).nullable().optional(),
    formats: z.array(formatSchema).max(200).optional(),
    ext: z.string().max(16).optional(),
    media_type: z.string().max(32).optional(),
  })
  .passthrough();

export function parseYtDlpMetadata(
  output: string,
  maximumBytes: number,
): readonly DiscoveredMedia[] {
  if (Buffer.byteLength(output, 'utf8') > maximumBytes) {
    throw applicationError('ProviderOutputInvalid', 'provider');
  }

  try {
    const decoded: unknown = JSON.parse(output);
    const root = metadataSchema.parse(decoded);
    const entries = root.entries === undefined ? [root] : root.entries;
    if (!entries || entries.length === 0)
      throw applicationError('ProviderOutputInvalid', 'provider');

    const seenIds = new Set<string>();
    const supported: DiscoveredMedia[] = [];
    for (const entry of entries) {
      if (seenIds.has(entry.id)) throw applicationError('ProviderOutputInvalid', 'provider');
      seenIds.add(entry.id);
      const kind: MediaKind =
        entry.media_type?.toLowerCase() === 'gif' || entry.ext?.toLowerCase() === 'gif'
          ? 'animation'
          : 'video';
      const representations = (entry.formats ?? [])
        .map((format, sourceIndex) => toRepresentation(format, sourceIndex))
        .filter(
          (representation): representation is MediaRepresentation => representation !== undefined,
        );
      if (representations.length > 0) {
        supported.push({
          mediaId: entry.id,
          position: supported.length + 1,
          kind,
          representations,
        });
      }
    }
    if (supported.length === 0) throw applicationError('MediaNotFound', 'provider');
    return supported;
  } catch (error) {
    if (isDomainError(error)) throw error;
    throw applicationError('ProviderOutputInvalid', 'provider');
  }
}

type ValidFormat = z.infer<typeof formatSchema>;

function toRepresentation(
  format: ValidFormat,
  sourceIndex: number,
): MediaRepresentation | undefined {
  if (!format.vcodec || format.vcodec.toLowerCase() === 'none') return undefined;

  let url: URL;
  try {
    url = new URL(format.url);
  } catch {
    return undefined;
  }
  const sizeBytes = format.filesize ?? format.filesize_approx;
  return {
    representationId: format.format_id ?? `format-${sourceIndex}`,
    url,
    container: format.ext,
    protocol: format.protocol,
    ...(format.vcodec !== undefined ? { videoCodec: format.vcodec } : {}),
    ...(format.acodec !== undefined ? { audioCodec: format.acodec } : {}),
    ...(format.width != null ? { width: format.width } : {}),
    ...(format.height != null ? { height: format.height } : {}),
    ...(format.tbr != null ? { bitrate: format.tbr } : {}),
    ...(sizeBytes != null ? { sizeBytes } : {}),
    ...(format.duration != null ? { durationSeconds: format.duration } : {}),
    sourceIndex,
  };
}

function isDomainError(error: unknown): error is { code: string; stage: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'stage' in error &&
    typeof error.stage === 'string'
  );
}
