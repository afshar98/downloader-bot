import type { DeliveryDestination, DownloadLimits, ProcessingBudget } from './models.js';
import type {
  AdmissionControlPort,
  LifecycleLogger,
  MediaDelivery,
  MediaDownloader,
  MediaProcessor,
  MediaProvider,
  TemporaryWorkspacePort,
} from './ports.js';
import {
  createOperationContext,
  type OperationContext,
  type StageSignal,
} from './operation-context.js';
import {
  deliveredItem,
  failedItem,
  outcomeFromItems,
  unattemptedItem,
  type ItemResult,
  type RequestOutcome,
} from './outcomes.js';
import type { RepresentationSelector } from '../media/representation-selector.js';
import {
  applicationError,
  isApplicationError,
  normalizeApplicationError,
  type ApplicationError,
  type ErrorCode,
} from '../shared/errors.js';
import type { RequestId } from '../shared/identifiers.js';

export type DownloadPostMediaOptions = Readonly<{
  provider: MediaProvider;
  downloader: MediaDownloader;
  processor: MediaProcessor;
  delivery: MediaDelivery;
  admission: AdmissionControlPort;
  downloadAdmission?: AdmissionControlPort;
  workspaceFactory: TemporaryWorkspacePort;
  selector: RepresentationSelector;
  limits: Readonly<{
    maxMediaBytes: number;
    jobTimeoutMs: number;
    downloadTimeoutMs: number;
    processingTimeoutMs?: number;
    maxRedirects: number;
  }>;
  logger?: LifecycleLogger;
  onFatalResourceFailure?: (reason: 'workspace-cleanup-incomplete') => void;
  now?: () => number;
}>;

export type DownloadPostMediaInput = Readonly<{
  destination: DeliveryDestination;
  messageText: string;
  candidateUrl: string;
  requestId: RequestId;
  signal: AbortSignal;
}>;

export class DownloadPostMedia {
  constructor(private readonly options: DownloadPostMediaOptions) {}

  async execute(input: DownloadPostMediaInput): Promise<RequestOutcome> {
    const startedAt = this.now();
    this.options.logger?.info(
      { requestId: input.requestId, stage: 'admission' },
      'download request received',
    );
    const operation = createOperationContext({
      requestId: input.requestId,
      signal: input.signal,
      jobTimeoutMs: this.options.limits.jobTimeoutMs,
      ...(this.options.now ? { now: this.options.now } : {}),
    });
    const itemResults: ItemResult[] = [];
    let outcome: RequestOutcome | undefined;
    let permit: Awaited<ReturnType<AdmissionControlPort['acquire']>> | undefined;
    let workspace: Awaited<ReturnType<TemporaryWorkspacePort['create']>> | undefined;

    try {
      let parsedCandidate: URL | undefined;
      try {
        parsedCandidate = new URL(input.candidateUrl);
      } catch {
        outcome = { kind: 'rejected', errorCode: 'InvalidUrl' };
      }

      if (!outcome && parsedCandidate && !this.options.provider.recognizes(parsedCandidate)) {
        outcome = { kind: 'rejected', errorCode: 'UnsupportedPostUrl' };
      } else if (!outcome) {
        let post;
        try {
          post = this.options.provider.validate(input.candidateUrl);
        } catch (error) {
          outcome = requestErrorOutcome(
            normalizeApplicationError(error, 'InvalidUrl', 'input'),
            itemResults,
          );
        }

        if (!outcome && post) {
          try {
            permit = await this.options.admission.acquire({
              requestId: input.requestId,
              deadlineAt: operation.deadlineAt,
              signal: operation.signal,
            });
            workspace = await this.options.workspaceFactory.create(input.requestId);
            const media = await this.options.provider.resolve(post, operation);
            if (media.length === 0) {
              outcome = { kind: 'failed', errorCode: 'MediaNotFound' };
            } else {
              outcome = await this.processItems(
                input.destination,
                media,
                workspace,
                operation,
                itemResults,
              );
            }
          } catch (error) {
            const normalized = normalizeApplicationError(
              error,
              'ProviderOutputInvalid',
              'provider',
            );
            outcome = requestErrorOutcome(normalized, itemResults);
          }
        }
      }
    } catch (error) {
      outcome = requestErrorOutcome(
        normalizeApplicationError(error, 'ProviderOutputInvalid', 'provider'),
        itemResults,
      );
    } finally {
      if (workspace) {
        try {
          await this.options.workspaceFactory.cleanup(workspace);
        } catch {
          this.options.logger?.error(
            { requestId: input.requestId, stage: 'cleanup', code: 'CleanupFailed' },
            'request workspace cleanup failed',
          );
        }
      }
      permit?.release();
      operation.dispose();
    }

    const finalOutcome = outcome ?? { kind: 'failed', errorCode: 'ProviderOutputInvalid' as const };
    const code =
      finalOutcome.kind === 'complete'
        ? 'complete'
        : finalOutcome.kind === 'partial'
          ? (finalOutcome.terminalErrorCode ?? 'partial')
          : finalOutcome.errorCode;
    const fields = {
      requestId: input.requestId,
      stage: 'closed',
      code,
      durationMs: Math.max(0, Math.round(this.now() - startedAt)),
    };
    if (code === 'DeliveryDestinationUnavailable' || code === 'CleanupFailed') {
      this.options.logger?.warn(fields, 'download request stopped');
    } else {
      this.options.logger?.info(fields, 'download request finished');
    }
    return finalOutcome;
  }

  private async processItems(
    destination: DeliveryDestination,
    mediaItems: Awaited<ReturnType<MediaProvider['resolve']>>,
    workspace: Awaited<ReturnType<TemporaryWorkspacePort['create']>>,
    context: OperationContext,
    results: ItemResult[],
  ): Promise<RequestOutcome> {
    let terminalError: ErrorCode | undefined;

    for (let index = 0; index < mediaItems.length; index += 1) {
      const media = mediaItems[index];
      if (!media) continue;
      if (context.signal.aborted) {
        terminalError = terminalCode(context.signal.reason) ?? 'OperationCancelled';
        appendUnattempted(results, mediaItems, index, terminalError);
        break;
      }

      let selected;
      try {
        selected = this.options.selector.select(media, {
          maxMediaBytes: this.options.limits.maxMediaBytes,
        });
      } catch (error) {
        const normalized = normalizeApplicationError(error, 'MediaProcessingFailed', 'processing');
        this.options.logger?.warn(
          {
            requestId: context.requestId,
            stage: normalized.stage,
            itemPosition: media.position,
            code: normalized.code,
          },
          'media item selection failed',
        );
        results.push(
          failedItem(media.position, media.mediaId, normalized.code, normalized.retryable),
        );
        continue;
      }

      let delivered = false;
      let itemError: ApplicationError | undefined;
      let processingStage: StageSignal | undefined;
      let processingBudget: ProcessingBudget | undefined;
      const processingTimeoutMs = this.options.limits.processingTimeoutMs ?? 60_000;
      this.options.logger?.info(
        { requestId: context.requestId, stage: 'download', itemPosition: media.position },
        'media item started',
      );
      try {
        for (let candidateIndex = 0; candidateIndex < selected.length; candidateIndex += 1) {
          const representation = selected[candidateIndex];
          if (!representation) continue;
          let attemptError: ApplicationError | undefined;
          try {
            if (processingBudget) assertBudget(processingBudget);
            const downloadLimits: DownloadLimits = {
              maxMediaBytes: this.options.limits.maxMediaBytes,
              timeoutMs: this.options.limits.downloadTimeoutMs,
              maxRedirects: this.options.limits.maxRedirects,
            };
            const downloadPermit = this.options.downloadAdmission
              ? await this.options.downloadAdmission.acquire({
                  requestId: context.requestId,
                  deadlineAt: Math.min(
                    context.deadlineAt,
                    processingBudget?.deadlineAt ?? Number.POSITIVE_INFINITY,
                    this.now() + downloadLimits.timeoutMs,
                  ),
                  signal: processingBudget?.signal ?? context.signal,
                })
              : undefined;
            let downloaded;
            try {
              downloaded = await this.options.downloader.download({
                media,
                representation,
                workspace,
                limits: downloadLimits,
                signal: processingBudget?.signal ?? context.signal,
              });
            } finally {
              downloadPermit?.release();
            }
            if (!processingBudget) {
              processingStage = context.createStageSignal('processing', processingTimeoutMs);
              const startedAt = this.now();
              const deadlineAt = Math.min(context.deadlineAt, startedAt + processingTimeoutMs);
              processingBudget = {
                signal: processingStage.signal,
                deadlineAt,
                remainingMs: () =>
                  Math.max(0, Math.min(context.remainingMs(), deadlineAt - this.now())),
              };
            }
            const prepared = await this.options.processor.prepare(
              downloaded,
              context,
              workspace,
              processingBudget,
            );
            assertBudget(processingBudget);
            await this.options.delivery.deliver(destination, prepared, context);
            results.push(deliveredItem(media.position, media.mediaId));
            delivered = true;
          } catch (error) {
            attemptError = normalizeApplicationError(error, 'MediaDownloadFailed', 'download');
          }

          if (!(await this.retireItem(workspace, context, media.position))) {
            terminalError = 'OperationCancelled';
            appendUnattempted(results, mediaItems, delivered ? index + 1 : index, terminalError);
            break;
          }
          if (delivered) break;
          if (attemptError) {
            if (isRequestTerminal(attemptError.code)) {
              terminalError = attemptError.code;
              appendUnattempted(results, mediaItems, index, attemptError.code);
              break;
            }
            itemError = attemptError;
            const mayTryFallback =
              candidateIndex + 1 < selected.length &&
              (attemptError.code === 'MediaTooLarge' ||
                attemptError.code === 'MediaProcessingFailed');
            if (mayTryFallback) continue;
            break;
          }
        }
      } finally {
        processingStage?.dispose();
      }

      if (terminalError) break;
      if (!delivered) {
        const failure = itemError ?? applicationError('MediaProcessingFailed', 'processing');
        this.options.logger?.warn(
          {
            requestId: context.requestId,
            stage: failure.stage,
            itemPosition: media.position,
            code: failure.code,
          },
          'media item failed',
        );
        results.push(failedItem(media.position, media.mediaId, failure.code, failure.retryable));
      } else {
        this.options.logger?.info(
          {
            requestId: context.requestId,
            stage: 'delivery',
            itemPosition: media.position,
            code: 'complete',
          },
          'media item delivered',
        );
      }
    }

    if (results.length === 0) {
      return { kind: 'failed', errorCode: terminalError ?? 'MediaNotFound' };
    }
    return outcomeFromItems(results, terminalError);
  }

  private async retireItem(
    workspace: Awaited<ReturnType<TemporaryWorkspacePort['create']>>,
    context: OperationContext,
    position: number,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await workspace.removeItem(position);
        return true;
      } catch {
        this.options.logger?.error(
          {
            requestId: context.requestId,
            stage: 'cleanup',
            itemPosition: position,
            code: 'CleanupFailed',
            attempt,
          },
          'media item cleanup failed',
        );
      }
    }
    try {
      this.options.onFatalResourceFailure?.('workspace-cleanup-incomplete');
    } catch {
      // Preserve delivered items and the stable request outcome.
    }
    return false;
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }
}

function appendUnattempted(
  results: ItemResult[],
  mediaItems: Awaited<ReturnType<MediaProvider['resolve']>>,
  startIndex: number,
  reason: ErrorCode,
): void {
  const acceptedReason =
    reason === 'DeliveryDestinationUnavailable'
      ? reason
      : reason === 'OperationTimedOut'
        ? reason
        : 'OperationCancelled';
  for (let index = startIndex; index < mediaItems.length; index += 1) {
    const media = mediaItems[index];
    if (media) results.push(unattemptedItem(media.position, acceptedReason));
  }
}

function requestErrorOutcome(
  error: ApplicationError,
  items: readonly ItemResult[],
): RequestOutcome {
  if (
    error.code === 'InvalidUrl' ||
    error.code === 'UnsupportedPostUrl' ||
    error.code === 'ServiceBusy'
  ) {
    return { kind: 'rejected', errorCode: error.code };
  }
  if (items.length > 0) return outcomeFromItems(items, error.code);
  return { kind: 'failed', errorCode: error.code };
}

function isRequestTerminal(code: ErrorCode): boolean {
  return (
    code === 'OperationTimedOut' ||
    code === 'OperationCancelled' ||
    code === 'DeliveryDestinationUnavailable'
  );
}

function terminalCode(value: unknown): ErrorCode | undefined {
  return isApplicationError(value) && isRequestTerminal(value.code) ? value.code : undefined;
}

function assertBudget(budget: ProcessingBudget): void {
  if (budget.signal.aborted) {
    throw normalizeApplicationError(budget.signal.reason, 'OperationCancelled', 'processing');
  }
  const remaining = budget.remainingMs();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw applicationError('OperationTimedOut', 'processing');
  }
}
