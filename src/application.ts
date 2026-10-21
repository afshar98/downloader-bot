import { AdmissionControl } from './admission-control.js';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import type { AppErrorCode } from './errors.js';
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
  onFailure?: (failure: RequestFailure) => void;
  onProgress?: (progress: RequestProgress) => void;
}>;

export type RequestFailure = Readonly<{
  stage: 'admission' | 'workspace' | 'extract' | 'download' | 'convert' | 'delivery' | 'cleanup';
  code: AppErrorCode | 'unknown' | 'timed-out' | 'cleanup-failed';
}>;

export type RequestProgress =
  | Readonly<{ stage: 'request'; status: 'started' }>
  | Readonly<{ stage: 'request'; status: 'completed'; result: RequestResult }>
  | Readonly<{ stage: RequestFailure['stage']; status: 'started' }>
  | Readonly<{ stage: RequestFailure['stage']; status: 'completed'; durationMs: number }>;

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
          let stage: RequestFailure['stage'] = 'admission';
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
            reportProgress(dependencies.onProgress, { stage: 'request', status: 'started' });
            if (controller.signal.aborted) throw new AppError('cancelled');
            let stageStartedAt = startStage(dependencies.onProgress, 'admission');
            release = admission.acquire();
            finishStage(dependencies.onProgress, 'admission', stageStartedAt);
            stageStartedAt = startStage(dependencies.onProgress, 'workspace');
            stage = 'workspace';
            workspace = await dependencies.workspaceFactory();
            finishStage(dependencies.onProgress, 'workspace', stageStartedAt);
            stageStartedAt = startStage(dependencies.onProgress, 'extract');
            stage = 'extract';
            const source = await dependencies.provider.getAnimation(
              input.canonicalUrl,
              controller.signal,
            );
            finishStage(dependencies.onProgress, 'extract', stageStartedAt);
            stageStartedAt = startStage(dependencies.onProgress, 'download');
            stage = 'download';
            await dependencies.downloader.download(source, workspace.sourcePath, controller.signal);
            finishStage(dependencies.onProgress, 'download', stageStartedAt);
            stageStartedAt = startStage(dependencies.onProgress, 'convert');
            stage = 'convert';
            const gif = await dependencies.converter.convert(
              workspace.sourcePath,
              workspace.partialGifPath,
              workspace.gifPath,
              controller.signal,
            );
            finishStage(dependencies.onProgress, 'convert', stageStartedAt);
            stageStartedAt = startStage(dependencies.onProgress, 'delivery');
            stage = 'delivery';
            await dependencies.delivery.sendAnimation(input.chatId, gif, controller.signal);
            finishStage(dependencies.onProgress, 'delivery', stageStartedAt);
            outcome = 'delivered';
          } catch (error) {
            outcome = resultForError(error, timedOut, externalSignal, shutdownSignal);
            if (outcome === 'failed') {
              reportFailure(dependencies.onFailure, {
                stage,
                code: timedOut ? 'timed-out' : safeErrorCode(error),
              });
            }
          } finally {
            clearTimeout(timeout);
            externalSignal.removeEventListener('abort', forwardAbort);
            shutdownSignal.removeEventListener('abort', forwardAbort);
            if (workspace) {
              try {
                await workspace.dispose();
              } catch {
                outcome = 'failed';
                reportFailure(dependencies.onFailure, { stage: 'cleanup', code: 'cleanup-failed' });
              }
            }
            release?.();
          }
          reportProgress(dependencies.onProgress, {
            stage: 'request',
            status: 'completed',
            result: outcome,
          });
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

function startStage(
  onProgress: GifApplicationDependencies['onProgress'],
  stage: RequestFailure['stage'],
): number {
  reportProgress(onProgress, { stage, status: 'started' });
  return Date.now();
}

function finishStage(
  onProgress: GifApplicationDependencies['onProgress'],
  stage: RequestFailure['stage'],
  startedAt: number,
): void {
  reportProgress(onProgress, {
    stage,
    status: 'completed',
    durationMs: Date.now() - startedAt,
  });
}

function reportProgress(
  onProgress: GifApplicationDependencies['onProgress'],
  progress: RequestProgress,
): void {
  try {
    onProgress?.(progress);
  } catch {
    // Logging must not change the request result.
  }
}

function safeErrorCode(error: unknown): AppErrorCode | 'unknown' {
  return error instanceof AppError ? error.code : 'unknown';
}

function reportFailure(
  onFailure: GifApplicationDependencies['onFailure'],
  failure: RequestFailure,
): void {
  try {
    onFailure?.(failure);
  } catch {
    // Logging must not change the request result.
  }
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
