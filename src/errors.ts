export type AppErrorCode =
  | 'invalid-url'
  | 'unsupported-url'
  | 'post-inaccessible'
  | 'no-animation'
  | 'extraction-failed'
  | 'download-failed'
  | 'conversion-failed'
  | 'invalid-gif'
  | 'delivery-failed'
  | 'timed-out'
  | 'cancelled'
  | 'output-limit-exceeded'
  | 'process-failed'
  | 'download-failed'
  | 'media-too-large'
  | 'unsafe-media-url'
  | 'internal-error';

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string = code,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}
