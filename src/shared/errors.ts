export const errorCodes = [
  'InvalidUrl',
  'UnsupportedPostUrl',
  'PostInaccessible',
  'MediaNotFound',
  'ProviderRateLimited',
  'ProviderOutputInvalid',
  'CleanupFailed',
  'MediaDownloadFailed',
  'MediaTooLarge',
  'MediaProcessingFailed',
  'TelegramDeliveryFailed',
  'DeliveryDestinationUnavailable',
  'OperationTimedOut',
  'OperationCancelled',
  'ServiceBusy',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const errorStages = [
  'input',
  'admission',
  'provider',
  'download',
  'processing',
  'delivery',
  'cleanup',
] as const;

export type ErrorStage = (typeof errorStages)[number];

export type OperatorContext = Readonly<{
  requestId?: string;
  stage?: ErrorStage;
  provider?: 'x';
  itemPosition?: number;
  durationMs?: number;
  attempt?: number;
}>;

export type ApplicationError = Readonly<{
  code: ErrorCode;
  stage: ErrorStage;
  retryable: boolean;
  operatorContext?: OperatorContext;
  cause?: unknown;
}>;

export type ApplicationErrorOptions = Readonly<{
  retryable?: boolean;
  operatorContext?: Readonly<Record<string, unknown>>;
  cause?: unknown;
}>;

const userSendableCodes = new Set<ErrorCode>([
  'InvalidUrl',
  'UnsupportedPostUrl',
  'PostInaccessible',
  'MediaNotFound',
  'ProviderRateLimited',
  'ProviderOutputInvalid',
  'OperationTimedOut',
  'OperationCancelled',
  'ServiceBusy',
]);

const itemLevelCodes = new Set<ErrorCode>([
  'MediaDownloadFailed',
  'MediaTooLarge',
  'MediaProcessingFailed',
  'TelegramDeliveryFailed',
]);

const defaultRetryableCodes = new Set<ErrorCode>([
  'PostInaccessible',
  'ProviderRateLimited',
  'MediaDownloadFailed',
  'TelegramDeliveryFailed',
  'OperationTimedOut',
  'ServiceBusy',
]);

function boundedContext(
  input: Readonly<Record<string, unknown>> | undefined,
): OperatorContext | undefined {
  if (!input) return undefined;

  const context: {
    requestId?: string;
    stage?: ErrorStage;
    provider?: 'x';
    itemPosition?: number;
    durationMs?: number;
    attempt?: number;
  } = {};

  if (typeof input['requestId'] === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(input['requestId'])) {
    context.requestId = input['requestId'];
  }
  if (typeof input['stage'] === 'string' && errorStages.includes(input['stage'] as ErrorStage)) {
    context.stage = input['stage'] as ErrorStage;
  }
  if (input['provider'] === 'x') context.provider = 'x';
  if (Number.isSafeInteger(input['itemPosition']) && Number(input['itemPosition']) > 0) {
    context.itemPosition = Number(input['itemPosition']);
  }
  if (Number.isFinite(input['durationMs']) && Number(input['durationMs']) >= 0) {
    context.durationMs = Number(input['durationMs']);
  }
  if (Number.isSafeInteger(input['attempt']) && Number(input['attempt']) > 0) {
    context.attempt = Number(input['attempt']);
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

export function applicationError(
  code: ErrorCode,
  stage: ErrorStage,
  options: ApplicationErrorOptions = {},
): ApplicationError {
  const operatorContext = boundedContext(options.operatorContext);
  return {
    code,
    stage,
    retryable: options.retryable ?? defaultRetryableCodes.has(code),
    ...(operatorContext ? { operatorContext } : {}),
    ...(options.cause !== undefined ? { cause: options.cause } : {}),
  };
}

export function normalizeApplicationError(
  error: unknown,
  fallbackCode: ErrorCode,
  stage: ErrorStage,
): ApplicationError {
  if (isApplicationError(error)) return error;
  return applicationError(fallbackCode, stage, { cause: error });
}

export function isApplicationError(value: unknown): value is ApplicationError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['code'] === 'string' &&
    errorCodes.includes(candidate['code'] as ErrorCode) &&
    typeof candidate['stage'] === 'string' &&
    errorStages.includes(candidate['stage'] as ErrorStage) &&
    typeof candidate['retryable'] === 'boolean'
  );
}

export function isUserSendableErrorCode(code: ErrorCode): boolean {
  return userSendableCodes.has(code);
}

export function isItemLevelErrorCode(code: ErrorCode): boolean {
  return itemLevelCodes.has(code);
}


export function operationAbortError(reason: unknown, stage: ErrorStage): ApplicationError {
  if (
    isApplicationError(reason) &&
    (reason.code === 'OperationTimedOut' || reason.code === 'OperationCancelled')
  ) {
    return applicationError(reason.code, stage, { cause: reason });
  }
  return applicationError('OperationCancelled', stage, { cause: reason });
}
