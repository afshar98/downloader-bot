const MIB = 1024 * 1024;

const DEFAULTS = {
  maxMediaBytes: 20 * MIB,
  maxGifBytes: 15 * MIB,
  maxConcurrentJobs: 2,
  jobTimeoutMs: 180_000,
} as const;

const LIMITS = {
  maxMediaBytes: { min: 1, max: 49 * MIB },
  maxGifBytes: { min: 1, max: 20 * MIB },
  maxConcurrentJobs: { min: 1, max: 4 },
  jobTimeoutMs: { min: 1_000, max: 300_000 },
} as const;

export type Config = Readonly<{
  telegramToken: string;
  ytDlpPath: string;
  ytDlpExpectedVersion: string;
  ffmpegPath: string;
  ffmpegExpectedVersion: string;
  maxMediaBytes: number;
  maxGifBytes: number;
  maxConcurrentJobs: number;
  jobTimeoutMs: number;
}>;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    telegramToken: required(env, 'TELEGRAM_BOT_TOKEN'),
    ytDlpPath: required(env, 'YT_DLP_PATH'),
    ytDlpExpectedVersion: required(env, 'YT_DLP_EXPECTED_VERSION'),
    ffmpegPath: required(env, 'FFMPEG_PATH'),
    ffmpegExpectedVersion: required(env, 'FFMPEG_EXPECTED_VERSION'),
    maxMediaBytes: boundedInteger(env, 'MAX_MEDIA_BYTES', DEFAULTS.maxMediaBytes, LIMITS.maxMediaBytes),
    maxGifBytes: boundedInteger(env, 'MAX_GIF_BYTES', DEFAULTS.maxGifBytes, LIMITS.maxGifBytes),
    maxConcurrentJobs: boundedInteger(
      env,
      'MAX_CONCURRENT_JOBS',
      DEFAULTS.maxConcurrentJobs,
      LIMITS.maxConcurrentJobs,
    ),
    jobTimeoutMs: boundedInteger(env, 'JOB_TIMEOUT_MS', DEFAULTS.jobTimeoutMs, LIMITS.jobTimeoutMs),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function boundedInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  bounds: Readonly<{ min: number; max: number }>,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) {
    throw new Error(`Invalid ${name}; expected an integer from ${bounds.min} to ${bounds.max}`);
  }
  return value;
}
