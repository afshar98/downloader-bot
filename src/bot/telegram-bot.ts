import { Bot } from 'grammy';
import { run } from '@grammyjs/runner';
import type { DownloadPostMedia } from '../application/download-post-media.js';
import type { ItemResult, RequestOutcome } from '../application/outcomes.js';
import { createDeliveryDestination } from '../application/models.js';
import { extractSingleCandidate } from './message-url-extractor.js';
import { createRequestId, type RequestId } from '../shared/identifiers.js';
import type { LifecycleLogger } from '../application/ports.js';
import type { ErrorCode } from '../shared/errors.js';

export type TelegramMessage = Readonly<{
  chatId: number | string;
  text?: string;
}>;

export type TelegramReply = (text: string) => Promise<unknown>;

export type TelegramMessageHandlerOptions = Readonly<{
  downloadPostMedia: Pick<DownloadPostMedia, 'execute'>;
  createRequestId?: () => RequestId;
}>;

export type TelegramBotOptions = Readonly<{
  token: string;
  bot?: Bot;
  downloadPostMedia: Pick<DownloadPostMedia, 'execute'>;
  requestSignal?: AbortSignal;
  logger?: LifecycleLogger;
}>;

export type PollingHandle = Readonly<{ stop(): Promise<void> }>;

export function startLongPolling(bot: Bot, maxInFlight: number): PollingHandle {
  return run(bot, {
    runner: { silent: true },
    sink: { concurrency: maxInFlight },
  });
}

export async function stopLongPolling(
  polling: PollingHandle,
  controller: AbortController,
  graceMs: number,
  closeResources: () => Promise<void> = async () => {},
  wait: (promise: Promise<void>, timeoutMs: number) => Promise<boolean> = waitWithin,
): Promise<boolean> {
  controller.abort();
  try {
    return await wait(polling.stop(), graceMs);
  } finally {
    await closeResources();
  }
}

async function waitWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
  });
  const completed = promise.then(
    () => true,
    () => false,
  );
  const result = await Promise.race([completed, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

export function createTelegramMessageHandler(options: TelegramMessageHandlerOptions) {
  const createId = options.createRequestId ?? createRequestId;
  return async (
    message: TelegramMessage,
    reply: TelegramReply,
    signal: AbortSignal,
  ): Promise<void> => {
    if (typeof message.text !== 'string') return;

    let candidate: string;
    try {
      candidate = extractSingleCandidate(message.text);
    } catch {
      await reply(userCopy('InvalidUrl'));
      return;
    }

    const outcome = await options.downloadPostMedia.execute({
      destination: createDeliveryDestination(String(message.chatId)),
      messageText: message.text,
      candidateUrl: candidate,
      requestId: createId(),
      signal,
    });
    const copy = outcomeCopy(outcome);
    if (copy) await reply(copy);
  };
}

export function createTelegramBot(options: TelegramBotOptions): Bot {
  const bot = options.bot ?? new Bot(options.token);
  const handleMessage = createTelegramMessageHandler({
    downloadPostMedia: options.downloadPostMedia,
  });

  bot.on('message:text', async (context) => {
    await handleMessage(
      { chatId: context.chat.id, text: context.message.text },
      (text) => context.reply(text),
      options.requestSignal ?? new AbortController().signal,
    );
  });

  bot.catch(() => {
    options.logger?.error(
      { code: 'TelegramDeliveryFailed', stage: 'delivery' },
      'telegram update failed',
    );
  });

  return bot;
}

export function outcomeCopy(outcome: RequestOutcome): string | undefined {
  if (outcome.kind === 'complete') return undefined;
  if (outcome.kind === 'rejected') return userCopy(outcome.errorCode);

  if (outcome.kind === 'partial') {
    const failed = describeFailedItems(outcome.items);
    const unattempted = outcome.unattemptedPositions.length
      ? ` Not attempted: ${formatPositions(outcome.unattemptedPositions)}.`
      : '';
    const terminal =
      outcome.terminalErrorCode === 'OperationTimedOut'
        ? ' The request timed out.'
        : outcome.terminalErrorCode === 'OperationCancelled'
          ? ' The request was cancelled.'
          : '';
    const retry = outcome.items.some((item) => item.kind === 'failed' && item.retryable)
      ? ' You can try the failed items again.'
      : '';
    return `Delivered ${outcome.deliveredCount} of ${outcome.items.length} items.${failed}${unattempted}${terminal}${retry}`;
  }

  if (
    outcome.errorCode === 'DeliveryDestinationUnavailable' ||
    outcome.errorCode === 'CleanupFailed'
  ) {
    return undefined;
  }
  if (outcome.items?.some((item) => item.kind === 'delivered')) return undefined;
  if (outcome.items?.some((item) => item.kind === 'failed')) {
    const failed = outcome.items.filter((item) => item.kind === 'failed');
    const unattemptedPositions = outcome.items
      .filter((item) => item.kind === 'unattempted')
      .map((item) => item.position);
    const unattempted = unattemptedPositions.length
      ? ` Not attempted: ${formatPositions(unattemptedPositions)}.`
      : '';
    const terminal =
      outcome.errorCode === 'OperationTimedOut'
        ? ' The request timed out.'
        : outcome.errorCode === 'OperationCancelled'
          ? ' The request was cancelled.'
          : '';
    const retry = failed.some((item) => item.retryable) ? ' You can try again later.' : '';
    return `No media items were delivered.${describeFailedItems(failed)}${unattempted}${terminal}${retry}`;
  }
  return userCopy(outcome.errorCode);
}

function describeFailedItems(items: readonly ItemResult[]): string {
  const failed = items.filter((item) => item.kind === 'failed');
  if (failed.length === 0) return '';
  const descriptions = failed.map(
    (item) => `item ${item.position} ${itemFailureDescription(item.errorCode)}`,
  );
  return ` Failed: ${descriptions.join('; ')}.`;
}

function itemFailureDescription(code: ErrorCode): string {
  switch (code) {
    case 'MediaDownloadFailed':
      return 'could not be retrieved';
    case 'MediaTooLarge':
      return 'exceeds the configured size limit';
    case 'MediaProcessingFailed':
      return 'has no directly deliverable representation';
    case 'TelegramDeliveryFailed':
      return 'could not be sent';
    default:
      return 'could not be completed';
  }
}

function formatPositions(positions: readonly number[]): string {
  return positions.map((position) => `item ${position}`).join(', ');
}

function userCopy(
  code:
    | 'InvalidUrl'
    | 'UnsupportedPostUrl'
    | 'PostInaccessible'
    | 'MediaNotFound'
    | 'ProviderRateLimited'
    | 'ProviderOutputInvalid'
    | 'MediaDownloadFailed'
    | 'MediaTooLarge'
    | 'MediaProcessingFailed'
    | 'TelegramDeliveryFailed'
    | 'OperationTimedOut'
    | 'OperationCancelled'
    | 'ServiceBusy',
): string {
  switch (code) {
    case 'InvalidUrl':
      return 'Send exactly one valid URL for an X/Twitter post.';
    case 'UnsupportedPostUrl':
      return 'Send a supported HTTPS X/Twitter status URL.';
    case 'PostInaccessible':
      return 'The post could not be accessed. Check its availability or try again later.';
    case 'MediaNotFound':
      return 'No supported video or animated media was found in the post.';
    case 'ProviderRateLimited':
      return 'The media provider is temporarily rate limited. Please try again later.';
    case 'ProviderOutputInvalid':
      return 'Media details could not be read safely. Please try again later.';
    case 'MediaDownloadFailed':
      return 'A media item could not be retrieved. Please try again.';
    case 'MediaTooLarge':
      return 'A media item exceeds the configured size limit.';
    case 'MediaProcessingFailed':
      return 'A media item has no directly deliverable representation.';
    case 'TelegramDeliveryFailed':
      return 'A media item could not be sent. Please try again later.';
    case 'OperationTimedOut':
      return 'The request timed out. Please try again.';
    case 'OperationCancelled':
      return 'The request was cancelled before it finished.';
    case 'ServiceBusy':
      return 'The service is busy. Please try again shortly.';
  }
}
