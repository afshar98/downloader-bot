import type { MediaDownloader as MediaDownloaderPort } from '../application/ports.js';
import type {
  DownloadedMedia,
  DownloadLimits,
  DiscoveredMedia,
  MediaRepresentation,
  TemporaryWorkspace,
} from '../application/models.js';
import type { SafeHttpClientPort } from '../application/ports.js';
import { applicationError, isApplicationError } from '../shared/errors.js';

export type SafeMediaDownloaderOptions = Readonly<{ httpClient: SafeHttpClientPort }>;

export class SafeMediaDownloader implements MediaDownloaderPort {
  constructor(private readonly options: SafeMediaDownloaderOptions) {}

  async download(input: {
    media: DiscoveredMedia;
    representation: MediaRepresentation;
    workspace: TemporaryWorkspace;
    limits: DownloadLimits;
    signal: AbortSignal;
  }): Promise<DownloadedMedia> {
    const paths = input.workspace.itemPaths(input.media.position);
    try {
      await input.workspace.removePartial(input.media.position);
      const sizeBytes = await this.options.httpClient.downloadToFile({
        url: input.representation.url.href,
        destinationPath: paths.partPath,
        maxBytes: input.limits.maxMediaBytes,
        timeoutMs: input.limits.timeoutMs,
        signal: input.signal,
      });
      if (sizeBytes < 1 || sizeBytes > input.limits.maxMediaBytes) {
        throw applicationError(
          sizeBytes > input.limits.maxMediaBytes ? 'MediaTooLarge' : 'MediaDownloadFailed',
          'download',
        );
      }
      await input.workspace.finalizeItem(input.media.position);
      return {
        mediaId: input.media.mediaId,
        position: input.media.position,
        kind: input.media.kind,
        path: paths.mediaPath,
        sizeBytes,
        container: 'mp4',
      };
    } catch (error) {
      try {
        await input.workspace.removePartial(input.media.position);
      } catch {
        // Preserve the primary download outcome; the request-level cleanup owns the workspace.
      }
      if (isApplicationError(error)) throw error;
      if (input.signal.aborted) {
        throw applicationError('OperationCancelled', 'download', { cause: input.signal.reason });
      }
      throw applicationError('MediaDownloadFailed', 'download', { cause: error });
    }
  }
}
