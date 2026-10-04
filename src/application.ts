import { AdmissionControl } from './admission-control.js';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import type { GifConverter } from './gif-converter.js';
import type { MediaDownloader } from './media-downloader.js';
import type { RequestWorkspace } from './temporary-workspace.js';
import type { GifDelivery } from './telegram-delivery.js';
import { ShutdownController } from './shutdown.js';
import type { XMediaProvider } from './x-media-provider.js';

export type RequestInput = Readonly<{
  canonicalUrl: string;
  chatId: string;
}>;

export type RequestResult =
  | 'delivered'
  | 'invalid-url'
  | 'unsupported-url'
  | 'inaccessible'
  | 'no-animation'
  | 'failed'
  | 'cancelled';

export type ApplicationDependencies = Readonly<{
  handle(input: RequestInput, signal: AbortSignal): Promise<RequestResult>;
}>;

export type Application = Readonly<{
  handleRequest(input: RequestInput, signal: AbortSignal): Promise<RequestResult>;
}>;

export type GifApplicationDependencies = Readonly<{
  maxConcurrentJobs: Config['maxConcurrentJobs'];
  jobTimeoutMs: Config['jobTimeoutMs'];
  workspaceFactory(): Promise<RequestWorkspace>;
  provider: Pick<XMediaProvider, 'getAnimation'>;
  downloader: Pick<MediaDownloader, 'download'>;
  converter: Pick<GifConverter, 'convert'>;
  delivery: Pick<GifDelivery, 'sendAnimation'>;
}>;

export type GifApplication = Application & Readonly<{ shutdown(): Promise<void> }>;

export function createGifApplication(dependencies: GifApplicationDependencies): GifApplication {
  const admission = new AdmissionControl(dependencies.maxConcurrentJobs);
  const lifecycle = new ShutdownController();

  return {
    async handleRequest(input, externalSignal) {
      try {
        return await lifecycle.run(async (shutdownSignal) => {
          let release: (() => void) | undefined;
          let workspace: RequestWorkspace | undefined;
          let timedOut = false;
          let outcome: RequestResult;
          const controller = new AbortController();
          const forwardAbort = () => controller.abort();
          externalSignal.addEventListener('abort', forwardAbort, { once: true });
          shutdownSignal.addEventListener('abort', forwardAbort, { once: true });
          if (externalSignal.aborted || shutdownSignal.aborted) controller.abort();
          const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, dependencies.jobTimeoutMs);

          try {
            if (controller.signal.aborted) throw new AppError('cancelled');
            release = admission.acquire();
            workspace = await dependencies.workspaceFactory();
            const source = await dependencies.provider.getAnimation(
              input.canonicalUrl,
              controller.signal,
            );
            await dependencies.downloader.download(source, workspace.sourcePath, controller.signal);
            const gif = await dependencies.converter.convert(
              workspace.sourcePath,
              workspace.partialGifPath,
              workspace.gifPath,
              controller.signal,
            );
            await dependencies.delivery.sendAnimation(input.chatId, gif, controller.signal);
            outcome = 'delivered';
          } catch (error) {
            outcome = resultForError(error, timedOut, externalSignal, shutdownSignal);
          } finally {
            clearTimeout(timeout);
            externalSignal.removeEventListener('abort', forwardAbort);
            shutdownSignal.removeEventListener('abort', forwardAbort);
            if (workspace) {
              try {
                await workspace.dispose();
              } catch {
                outcome = 'failed';
              }
            }
            release?.();
          }
          return outcome;
        });
      } catch (error) {
        return error instanceof AppError && error.code === 'cancelled'
          ? 'cancelled'
          : resultForError(error);
      }
    },
    shutdown: () => lifecycle.shutdown(),
  };
}

function resultForError(
  error: unknown,
  timedOut = false,
  externalSignal?: AbortSignal,
  shutdownSignal?: AbortSignal,
): RequestResult {
  if (timedOut) return 'failed';
  if (externalSignal?.aborted || shutdownSignal?.aborted) return 'cancelled';
  if (!(error instanceof AppError)) return 'failed';
  switch (error.code) {
    case 'cancelled':
      return 'cancelled';
    case 'post-inaccessible':
      return 'inaccessible';
    case 'no-animation':
      return 'no-animation';
    case 'invalid-url':
      return 'invalid-url';
    case 'unsupported-url':
      return 'unsupported-url';
    default:
      return 'failed';
  }
}

export function createApplication(dependencies: ApplicationDependencies): Application {
  return {
    handleRequest(input, signal) {
      return dependencies.handle(input, signal);
    },
  };
}
