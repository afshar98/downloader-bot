import type { RequestId } from '../shared/identifiers.js';

declare const destinationBrand: unique symbol;
export type DeliveryDestination = string & { readonly [destinationBrand]: true };

export function createDeliveryDestination(value: string): DeliveryDestination {
  if (value.length < 1 || value.length > 128) {
    throw new RangeError('Delivery destination must contain between 1 and 128 characters');
  }
  return value as DeliveryDestination;
}

export type MediaKind = 'video' | 'animation';
export type AudioPresence = 'present' | 'absent' | 'unknown';
export type AudioEvidence = AudioPresence | 'conflicting';

export type PostReference = Readonly<{
  provider: 'x';
  postId: string;
  canonicalUrl: URL;
}>;

export type MediaRepresentation = Readonly<{
  representationId: string;
  url: URL;
  container: string;
  protocol: string;
  videoCodec?: string | null;
  audioCodec?: string | null;
  audioEvidence: AudioEvidence;
  width?: number | null;
  height?: number | null;
  bitrate?: number | null;
  sizeBytes?: number | null;
  durationSeconds?: number | null;
  sourceIndex: number;
}>;

export type DiscoveredMedia = Readonly<{
  mediaId: string;
  position: number;
  kind: MediaKind;
  audioPresence: AudioPresence;
  representations: readonly MediaRepresentation[];
}>;

export type DownloadedMedia = Readonly<{
  mediaId: string;
  position: number;
  kind: MediaKind;
  audioPresence: AudioPresence;
  path: string;
  sizeBytes: number;
  container: 'mp4';
}>;

export type PreparedMedia =
  | Readonly<{
      downloaded: DownloadedMedia;
      deliveryPath: string;
      deliverySizeBytes: number;
      deliveryKind: 'video';
      deliveryContainer: 'mp4';
      transformed: false;
    }>
  | Readonly<{
      downloaded: DownloadedMedia;
      deliveryPath: string;
      deliverySizeBytes: number;
      deliveryKind: 'animation';
      deliveryContainer: 'gif';
      transformed: true;
    }>;

export type DeliveryLimits = Readonly<{
  maxMediaBytes: number;
}>;

export type DownloadLimits = Readonly<{
  maxMediaBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}>;

export type ProcessExecution = Readonly<{
  stage: 'provider' | 'processing';
  executable: string;
  args: readonly string[];
  cwd?: string;
  timeoutMs: number;
  stdoutLimitBytes: number;
  stderrLimitBytes: number;
  signal: AbortSignal;
  stdoutFile?: Readonly<{ path: string; maxBytes: number }>;
}>;

export type ProcessExecutionResult = Readonly<{
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  outputBytes?: number;
}>;

export type ProcessingBudget = Readonly<{
  signal: AbortSignal;
  deadlineAt: number;
  remainingMs(): number;
}>;

export type SafeHttpDownload = Readonly<{
  url: string;
  destinationPath: string;
  maxBytes: number;
  timeoutMs: number;
  signal: AbortSignal;
}>;

export type WorkspaceItemPaths = Readonly<{
  partPath: string;
  mediaPath: string;
  palettePartPath: string;
  palettePath: string;
  gifPartPath: string;
  gifPath: string;
}>;

export interface TemporaryWorkspace {
  readonly root: string;
  itemPaths(position: number): WorkspaceItemPaths;
  finalizeItem(position: number): Promise<void>;
  finalizePalette(position: number): Promise<void>;
  finalizeGif(position: number): Promise<void>;
  removePalette(position: number): Promise<void>;
  removePartial(position: number): Promise<void>;
  removeConversion(position: number): Promise<void>;
  removeItem(position: number): Promise<void>;
}

export type AdmissionPermit = Readonly<{ requestId: RequestId; release(): void }>;
