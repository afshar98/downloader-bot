import { describe, expect, it } from 'vitest';
import {
  failedItem,
  deliveredItem,
  outcomeFromItems,
  unattemptedItem,
} from '../../../src/application/outcomes.js';

describe('request outcomes', () => {
  it('creates an ordered complete result when every item is delivered', () => {
    const outcome = outcomeFromItems([deliveredItem(1, 'media-a'), deliveredItem(2, 'media-b')]);

    expect(outcome).toEqual({
      kind: 'complete',
      items: [
        { kind: 'delivered', position: 1, mediaId: 'media-a' },
        { kind: 'delivered', position: 2, mediaId: 'media-b' },
      ],
    });
  });

  it('preserves delivered, failed, and unattempted item positions in a partial result', () => {
    const outcome = outcomeFromItems([
      deliveredItem(1, 'media-a'),
      failedItem(2, 'media-b', 'TelegramDeliveryFailed', true),
      unattemptedItem(3, 'OperationTimedOut'),
    ]);

    expect(outcome).toEqual({
      kind: 'partial',
      items: [
        { kind: 'delivered', position: 1, mediaId: 'media-a' },
        {
          kind: 'failed',
          position: 2,
          mediaId: 'media-b',
          errorCode: 'TelegramDeliveryFailed',
          retryable: true,
        },
        { kind: 'unattempted', position: 3, reason: 'OperationTimedOut' },
      ],
      deliveredCount: 1,
      failedPositions: [2],
      unattemptedPositions: [3],
    });
  });

  it('returns a typed request failure when no item was delivered', () => {
    expect(outcomeFromItems([failedItem(1, 'media-a', 'MediaProcessingFailed', false)])).toEqual({
      kind: 'failed',
      errorCode: 'MediaProcessingFailed',
      items: [
        {
          kind: 'failed',
          position: 1,
          mediaId: 'media-a',
          errorCode: 'MediaProcessingFailed',
          retryable: false,
        },
      ],
    });
  });
});
