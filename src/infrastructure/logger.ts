import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
export type LogFields = Readonly<Record<string, unknown>>;

export interface StructuredLogger {
  child(bindings: LogFields): StructuredLogger;
  info(fields: LogFields, message?: string): void;
  warn(fields: LogFields, message?: string): void;
  error(fields: LogFields, message?: string): void;
}

const redactedPaths = [
  'token',
  'telegramBotToken',
  'authorization',
  'cookie',
  'headers',
  'url',
  'rawUrl',
  'messageText',
  'text',
  'payload',
  'path',
  'filename',
  'stdout',
  'stderr',
  'processOutput',
  'cause',
  '*.token',
  '*.url',
  '*.path',
  '*.payload',
];

export type LoggerOptions = Readonly<{
  level: LogLevel;
  destination?: DestinationStream;
}>;

function wrap(logger: PinoLogger): StructuredLogger {
  return {
    child(bindings) {
      return wrap(logger.child(bindings));
    },
    info(fields, message) {
      logger.info(fields, message);
    },
    warn(fields, message) {
      logger.warn(fields, message);
    },
    error(fields, message) {
      logger.error(fields, message);
    },
  };
}

export function createLogger(options: LoggerOptions): StructuredLogger {
  const logger = pino(
    {
      level: options.level,
      redact: { paths: redactedPaths, censor: '[Redacted]' },
      serializers: {
        err: () => ({ type: 'Error', message: '[Redacted]' }),
        error: () => '[Redacted]',
      },
    },
    options.destination,
  );
  return wrap(logger);
}
