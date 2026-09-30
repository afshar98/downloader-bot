import { access, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

const MAX_MEDIA_BYTES = 49 * 1024 * 1024;

function boundedInteger(defaultValue: number, minimum: number, maximum: number): z.ZodType<number> {
  return z
    .string()
    .default(String(defaultValue))
    .transform((value) => Number(value))
    .pipe(z.number().int().min(minimum).max(maximum));
}

const schema = z
  .object({
    TELEGRAM_BOT_TOKEN: z.string().trim().min(1),
    YT_DLP_PATH: z.string().trim().min(1).default('yt-dlp'),
    YT_DLP_EXPECTED_VERSION: z.string().trim().min(1),
    EXTRACTION_TIMEOUT_MS: boundedInteger(30_000, 1, 300_000),
    DOWNLOAD_TIMEOUT_MS: boundedInteger(60_000, 1, 300_000),
    PROCESSING_TIMEOUT_MS: boundedInteger(60_000, 1, 300_000),
    DELIVERY_TIMEOUT_MS: boundedInteger(30_000, 1, 300_000),
    JOB_TIMEOUT_MS: boundedInteger(115_000, 1, 600_000),
    MAX_MEDIA_BYTES: boundedInteger(MAX_MEDIA_BYTES, 1, MAX_MEDIA_BYTES),
    TEMP_DIR: z.string().default(tmpdir()),
    MAX_CONCURRENT_JOBS: boundedInteger(2, 1, 32),
    MAX_QUEUED_JOBS: boundedInteger(8, 0, 256),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    MAX_YTDLP_STDOUT_BYTES: boundedInteger(1_048_576, 1, 16 * 1024 * 1024),
    MAX_YTDLP_STDERR_BYTES: boundedInteger(65_536, 1, 1024 * 1024),
    MAX_METADATA_BYTES: boundedInteger(1_048_576, 1, 16 * 1024 * 1024),
    MAX_REDIRECTS: boundedInteger(3, 0, 3),
    MAX_OPEN_DOWNLOADS: boundedInteger(2, 1, 32),
    SHUTDOWN_GRACE_MS: boundedInteger(30_000, 1, 30_000),
  })
  .superRefine((config, context) => {
    if (config.MAX_OPEN_DOWNLOADS > config.MAX_CONCURRENT_JOBS) {
      context.addIssue({
        code: 'custom',
        path: ['MAX_OPEN_DOWNLOADS'],
        message: 'must not exceed MAX_CONCURRENT_JOBS',
      });
    }
  });

export type RuntimeConfig = Readonly<{
  telegramBotToken: string;
  ytDlpPath: string;
  ytDlpExpectedVersion: string;
  extractionTimeoutMs: number;
  downloadTimeoutMs: number;
  processingTimeoutMs: number;
  deliveryTimeoutMs: number;
  jobTimeoutMs: number;
  maxMediaBytes: number;
  tempDir: string;
  maxConcurrentJobs: number;
  maxQueuedJobs: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
  maxYtDlpStdoutBytes: number;
  maxYtDlpStderrBytes: number;
  maxMetadataBytes: number;
  maxRedirects: number;
  maxOpenDownloads: number;
  shutdownGraceMs: number;
}>;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export async function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
): Promise<RuntimeConfig> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'environment')),
    ];
    throw new ConfigurationError(`Invalid configuration: ${fields.join(', ')}`);
  }

  const tempDir = parsed.data.TEMP_DIR;
  if (!isAbsolute(tempDir))
    throw new ConfigurationError('Invalid configuration: TEMP_DIR must be absolute');
  try {
    const details = await lstat(tempDir);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new ConfigurationError(
        'Invalid configuration: TEMP_DIR must be a non-symlink directory',
      );
    }
    await access(tempDir, 2);
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError(
      'Invalid configuration: TEMP_DIR must be an existing writable directory',
    );
  }

  return Object.freeze({
    telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
    ytDlpPath: parsed.data.YT_DLP_PATH,
    ytDlpExpectedVersion: parsed.data.YT_DLP_EXPECTED_VERSION,
    extractionTimeoutMs: parsed.data.EXTRACTION_TIMEOUT_MS,
    downloadTimeoutMs: parsed.data.DOWNLOAD_TIMEOUT_MS,
    processingTimeoutMs: parsed.data.PROCESSING_TIMEOUT_MS,
    deliveryTimeoutMs: parsed.data.DELIVERY_TIMEOUT_MS,
    jobTimeoutMs: parsed.data.JOB_TIMEOUT_MS,
    maxMediaBytes: parsed.data.MAX_MEDIA_BYTES,
    tempDir,
    maxConcurrentJobs: parsed.data.MAX_CONCURRENT_JOBS,
    maxQueuedJobs: parsed.data.MAX_QUEUED_JOBS,
    logLevel: parsed.data.LOG_LEVEL,
    maxYtDlpStdoutBytes: parsed.data.MAX_YTDLP_STDOUT_BYTES,
    maxYtDlpStderrBytes: parsed.data.MAX_YTDLP_STDERR_BYTES,
    maxMetadataBytes: parsed.data.MAX_METADATA_BYTES,
    maxRedirects: parsed.data.MAX_REDIRECTS,
    maxOpenDownloads: parsed.data.MAX_OPEN_DOWNLOADS,
    shutdownGraceMs: parsed.data.SHUTDOWN_GRACE_MS,
  });
}

export function loadProcessConfig(): Promise<RuntimeConfig> {
  return loadConfig(process.env);
}
