import type { ErrorCode } from '../shared/errors.js';

export type DeliveredItem = Readonly<{
  kind: 'delivered';
  position: number;
  mediaId: string;
}>;

export type FailedItem = Readonly<{
  kind: 'failed';
  position: number;
  mediaId: string;
  errorCode: ErrorCode;
  retryable: boolean;
}>;

export type UnattemptedItem = Readonly<{
  kind: 'unattempted';
  position: number;
  reason: 'OperationTimedOut' | 'OperationCancelled' | 'DeliveryDestinationUnavailable';
}>;

export type ItemResult = DeliveredItem | FailedItem | UnattemptedItem;

export type RequestOutcome =
  | Readonly<{ kind: 'complete'; items: readonly DeliveredItem[] }>
  | Readonly<{
      kind: 'partial';
      items: readonly ItemResult[];
      deliveredCount: number;
      failedPositions: readonly number[];
      unattemptedPositions: readonly number[];
      terminalErrorCode?: 'OperationTimedOut' | 'OperationCancelled';
    }>
  | Readonly<{ kind: 'failed'; errorCode: ErrorCode; items?: readonly ItemResult[] }>
  | Readonly<{ kind: 'rejected'; errorCode: 'InvalidUrl' | 'UnsupportedPostUrl' | 'ServiceBusy' }>;

export function deliveredItem(position: number, mediaId: string): DeliveredItem {
  return { kind: 'delivered', position, mediaId };
}

export function failedItem(
  position: number,
  mediaId: string,
  errorCode: ErrorCode,
  retryable: boolean,
): FailedItem {
  return { kind: 'failed', position, mediaId, errorCode, retryable };
}

export function unattemptedItem(
  position: number,
  reason: UnattemptedItem['reason'],
): UnattemptedItem {
  return { kind: 'unattempted', position, reason };
}

export function outcomeFromItems(
  items: readonly ItemResult[],
  terminalErrorCode?: ErrorCode,
): RequestOutcome {
  if (items.length === 0) throw new Error('A request outcome requires at least one item');

  const delivered = items.filter((item): item is DeliveredItem => item.kind === 'delivered');
  if (delivered.length === items.length) return { kind: 'complete', items: delivered };

  const failedPositions = items
    .filter((item): item is FailedItem => item.kind === 'failed')
    .map((item) => item.position);
  const unattemptedPositions = items
    .filter((item): item is UnattemptedItem => item.kind === 'unattempted')
    .map((item) => item.position);

  if (terminalErrorCode === 'DeliveryDestinationUnavailable') {
    return { kind: 'failed', errorCode: terminalErrorCode, items };
  }
  if (terminalErrorCode && delivered.length === 0) {
    return { kind: 'failed', errorCode: terminalErrorCode, items };
  }

  if (delivered.length > 0) {
    return {
      kind: 'partial',
      items,
      deliveredCount: delivered.length,
      failedPositions,
      unattemptedPositions,
      ...(terminalErrorCode === 'OperationTimedOut' || terminalErrorCode === 'OperationCancelled'
        ? { terminalErrorCode }
        : {}),
    };
  }

  const firstFailure = items.find((item): item is FailedItem => item.kind === 'failed');
  return {
    kind: 'failed',
    errorCode: firstFailure?.errorCode ?? 'OperationCancelled',
    items,
  };
}
