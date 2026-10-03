import { describe, expect, it } from 'vitest';
import { outcomeCopy } from '../../../src/bot/telegram-bot.js';
import type { RequestOutcome } from '../../../src/application/outcomes.js';
import type { ErrorCode } from '../../../src/shared/errors.js';

describe('safe Telegram outcome mapping', () => {
  it.each([
    ['InvalidUrl', 'one valid URL'],
    ['UnsupportedPostUrl', 'supported HTTPS X/Twitter status URL'],
    ['PostInaccessible', 'could not be accessed'],
    ['MediaNotFound', 'No supported video'],
    ['ProviderRateLimited', 'rate limited'],
    ['ProviderOutputInvalid', 'could not be read safely'],
    ['MediaDownloadFailed', 'could not be retrieved'],
    ['MediaTooLarge', 'size limit'],
    ['MediaProcessingFailed', 'prepared safely'],
    ['TelegramDeliveryFailed', 'could not be sent'],
    ['OperationTimedOut', 'timed out'],
    ['OperationCancelled', 'cancelled'],
    ['ServiceBusy', 'busy'],
  ] as const)('maps %s to safe user guidance', (errorCode, expected) => {
    const outcome =
      errorCode === 'InvalidUrl' ||
      errorCode === 'UnsupportedPostUrl' ||
      errorCode === 'ServiceBusy'
        ? { kind: 'rejected', errorCode }
        : { kind: 'failed', errorCode };
    expect(outcomeCopy(outcome as RequestOutcome)).toContain(expected);
    expect(outcomeCopy(outcome as RequestOutcome)).not.toMatch(/trace|stderr|https:\/\/|\/tmp/);
  });

  it('keeps timeout and cancellation distinct in partial summaries', () => {
    const base = {
      kind: 'partial' as const,
      items: [
        { kind: 'delivered' as const, position: 1, mediaId: 'opaque' },
        { kind: 'unattempted' as const, position: 2, reason: 'OperationCancelled' as const },
      ],
      deliveredCount: 1,
      failedPositions: [],
      unattemptedPositions: [2],
    };
    expect(outcomeCopy({ ...base, terminalErrorCode: 'OperationTimedOut' })).toContain('timed out');
    expect(outcomeCopy({ ...base, terminalErrorCode: 'OperationCancelled' })).toContain(
      'cancelled',
    );
    expect(outcomeCopy({ ...base, terminalErrorCode: 'OperationTimedOut' })).not.toEqual(
      outcomeCopy({ ...base, terminalErrorCode: 'OperationCancelled' }),
    );
  });

  it.each([
    ['OperationTimedOut', 'timed out'],
    ['OperationCancelled', 'cancelled'],
  ] as const)(
    'includes failed and unattempted items for zero-delivery %s',
    (terminalErrorCode, reason) => {
      const copy = outcomeCopy({
        kind: 'failed',
        errorCode: terminalErrorCode,
        items: [
          {
            kind: 'failed',
            position: 1,
            mediaId: 'private',
            errorCode: 'MediaDownloadFailed',
            retryable: true,
          },
          { kind: 'unattempted', position: 2, reason: terminalErrorCode },
        ],
      });
      expect(copy).toContain('item 1 could not be retrieved');
      expect(copy).toContain('Not attempted: item 2');
      expect(copy).toContain(reason);
      expect(copy).not.toContain('private');
    },
  );

  it('reports retry guidance for retryable isolated failures', () => {
    expect(
      outcomeCopy({
        kind: 'failed',
        errorCode: 'MediaDownloadFailed',
        items: [
          {
            kind: 'failed',
            position: 2,
            mediaId: 'opaque',
            errorCode: 'MediaDownloadFailed',
            retryable: true,
          },
        ],
      }),
    ).toContain('try again later');
  });

  it.each([
    ['InvalidUrl', false],
    ['UnsupportedPostUrl', false],
    ['PostInaccessible', true],
    ['MediaNotFound', false],
    ['ProviderRateLimited', true],
    ['ProviderOutputInvalid', true],
    ['MediaDownloadFailed', true],
    ['MediaTooLarge', false],
    ['MediaProcessingFailed', false],
    ['TelegramDeliveryFailed', true],
    ['OperationTimedOut', true],
    ['OperationCancelled', false],
    ['ServiceBusy', true],
  ] as const)('advises retry exactly for retryable %s outcomes', (errorCode, retryable) => {
    const isRejected =
      errorCode === 'InvalidUrl' ||
      errorCode === 'UnsupportedPostUrl' ||
      errorCode === 'ServiceBusy';
    const outcome: RequestOutcome = isRejected
      ? {
          kind: 'rejected',
          errorCode: errorCode as 'InvalidUrl' | 'UnsupportedPostUrl' | 'ServiceBusy',
        }
      : { kind: 'failed', errorCode: errorCode as ErrorCode };
    const copy = outcomeCopy(outcome);
    expect(copy).toBeDefined();
    expect(copy?.toLowerCase()).toMatch(
      retryable ? /try again|retry/ : /^((?!try again|retry).)*$/,
    );
  });

  it.each([
    ['MediaDownloadFailed', 'could not be retrieved'],
    ['MediaTooLarge', 'exceeds the configured size limit'],
    ['MediaProcessingFailed', 'prepared safely for delivery'],
    ['TelegramDeliveryFailed', 'could not be sent'],
  ] as const)('describes item failure %s in failed and partial outcomes', (errorCode, copy) => {
    const failedItem = {
      kind: 'failed' as const,
      position: 2,
      mediaId: 'SECRET',
      errorCode,
      retryable: errorCode !== 'MediaTooLarge' && errorCode !== 'MediaProcessingFailed',
    };
    const failed = outcomeCopy({ kind: 'failed', errorCode, items: [failedItem] });
    const partial = outcomeCopy({
      kind: 'partial',
      items: [{ kind: 'delivered', position: 1, mediaId: 'SECRET' }, failedItem],
      deliveredCount: 1,
      failedPositions: [2],
      unattemptedPositions: [],
    });
    expect(failed).toContain(copy);
    expect(partial).toContain(copy);
    expect(failed).toContain('item 2');
    expect(failed).not.toMatch(/SECRET|https:\/\/|\/tmp|stderr|trace/);
    expect(failed).toContain(failedItem.retryable ? 'try again' : 'No media items');
    if (failedItem.retryable) expect(partial).toContain('try the failed items again');
    else expect(partial).not.toContain('try the failed items again');
  });

  it('does not send a response for unavailable destinations or cleanup-only failures', () => {
    expect(
      outcomeCopy({ kind: 'failed', errorCode: 'DeliveryDestinationUnavailable' }),
    ).toBeUndefined();
    expect(outcomeCopy({ kind: 'failed', errorCode: 'CleanupFailed' })).toBeUndefined();
  });
});
