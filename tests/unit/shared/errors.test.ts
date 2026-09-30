import { describe, expect, it } from 'vitest';
import {
  applicationError,
  isItemLevelErrorCode,
  isUserSendableErrorCode,
  normalizeApplicationError,
} from '../../../src/shared/errors.js';

describe('application errors', () => {
  it('keeps stable classifications and bounded operator context', () => {
    const error = applicationError('MediaTooLarge', 'download', {
      retryable: false,
      operatorContext: {
        requestId: 'req_123',
        itemPosition: 2,
        durationMs: 50,
        url: 'https://private.example/secret',
        path: '/tmp/secret.mp4',
        processOutput: 'token=secret',
      },
    });

    expect(error).toMatchObject({
      code: 'MediaTooLarge',
      stage: 'download',
      retryable: false,
      operatorContext: { requestId: 'req_123', itemPosition: 2, durationMs: 50 },
    });
    expect(JSON.stringify(error)).not.toMatch(/private\.example|secret|\/tmp/);
  });

  it('normalizes unknown faults without retaining their messages', () => {
    const error = normalizeApplicationError(
      new Error('https://secret.example/path and token=abc'),
      'TelegramDeliveryFailed',
      'delivery',
    );

    expect(error).toMatchObject({ code: 'TelegramDeliveryFailed', stage: 'delivery' });
    expect(JSON.stringify({ code: error.code, stage: error.stage })).not.toMatch(/secret|token/);
  });

  it('classifies user-sendable and item-level codes explicitly', () => {
    expect(isUserSendableErrorCode('UnsupportedPostUrl')).toBe(true);
    expect(isUserSendableErrorCode('ProviderOutputInvalid')).toBe(true);
    expect(isUserSendableErrorCode('DeliveryDestinationUnavailable')).toBe(false);
    expect(isUserSendableErrorCode('CleanupFailed')).toBe(false);
    expect(isItemLevelErrorCode('MediaDownloadFailed')).toBe(true);
    expect(isItemLevelErrorCode('OperationCancelled')).toBe(false);
  });
});
