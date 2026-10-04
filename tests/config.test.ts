import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const requiredEnvironment = {
  TELEGRAM_BOT_TOKEN: '123456:test-token',
  YT_DLP_PATH: '/usr/local/bin/yt-dlp',
  YT_DLP_EXPECTED_VERSION: '2026.10.01',
  FFMPEG_PATH: '/usr/local/bin/ffmpeg',
  FFMPEG_EXPECTED_VERSION: '7.1.1',
};

describe('loadConfig', () => {
  it('loads pinned executables and conservative media defaults', () => {
    expect(loadConfig(requiredEnvironment)).toEqual({
      telegramToken: '123456:test-token',
      ytDlpPath: '/usr/local/bin/yt-dlp',
      ytDlpExpectedVersion: '2026.10.01',
      ffmpegPath: '/usr/local/bin/ffmpeg',
      ffmpegExpectedVersion: '7.1.1',
      maxMediaBytes: 20 * 1024 * 1024,
      maxGifBytes: 15 * 1024 * 1024,
      maxConcurrentJobs: 2,
      jobTimeoutMs: 180_000,
    });
  });

  it.each([
    'TELEGRAM_BOT_TOKEN',
    'YT_DLP_PATH',
    'YT_DLP_EXPECTED_VERSION',
    'FFMPEG_PATH',
    'FFMPEG_EXPECTED_VERSION',
  ])('requires %s', (key) => {
    const environment = { ...requiredEnvironment, [key]: '' };
    expect(() => loadConfig(environment)).toThrow(key);
  });

  it('allows positive resource limits to be lowered', () => {
    expect(
      loadConfig({
        ...requiredEnvironment,
        MAX_MEDIA_BYTES: '1048576',
        MAX_GIF_BYTES: '524288',
        MAX_CONCURRENT_JOBS: '1',
        JOB_TIMEOUT_MS: '30000',
      }),
    ).toMatchObject({
      maxMediaBytes: 1_048_576,
      maxGifBytes: 524_288,
      maxConcurrentJobs: 1,
      jobTimeoutMs: 30_000,
    });
  });

  it.each([
    { MAX_MEDIA_BYTES: '0' },
    { MAX_MEDIA_BYTES: '51380225' },
    { MAX_GIF_BYTES: '-1' },
    { MAX_GIF_BYTES: '20971521' },
    { MAX_CONCURRENT_JOBS: '1.5' },
    { MAX_CONCURRENT_JOBS: '5' },
    { JOB_TIMEOUT_MS: 'not-a-number' },
    { JOB_TIMEOUT_MS: '300001' },
  ])('rejects invalid bounded resource limits: %o', (overrides) => {
    expect(() => loadConfig({ ...requiredEnvironment, ...overrides })).toThrow();
  });
});
