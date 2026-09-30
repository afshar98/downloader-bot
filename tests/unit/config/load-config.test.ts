import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config/load-config.js';

const tempRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'downloader-config-test-'));
  tempRoots.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('loadConfig', () => {
  it('loads immutable defaults from explicit input and requires a bot token', async () => {
    const directory = await temporaryDirectory();
    const config = await loadConfig({
      TELEGRAM_BOT_TOKEN: '123456:secret',
      TEMP_DIR: directory,
      YT_DLP_EXPECTED_VERSION: 'yt-dlp 2026.09.01',
    });

    expect(config).toMatchObject({
      telegramBotToken: '123456:secret',
      ytDlpPath: 'yt-dlp',
      ytDlpExpectedVersion: 'yt-dlp 2026.09.01',
      extractionTimeoutMs: 30_000,
      downloadTimeoutMs: 60_000,
      processingTimeoutMs: 60_000,
      deliveryTimeoutMs: 30_000,
      jobTimeoutMs: 115_000,
      maxMediaBytes: 51_380_224,
      tempDir: directory,
      maxConcurrentJobs: 2,
      maxQueuedJobs: 8,
      maxYtDlpStdoutBytes: 1_048_576,
      maxYtDlpStderrBytes: 65_536,
      maxMetadataBytes: 1_048_576,
      maxRedirects: 3,
      maxOpenDownloads: 2,
      shutdownGraceMs: 30_000,
      logLevel: 'info',
    });
    expect(Object.isFrozen(config)).toBe(true);
    await expect(loadConfig({ TEMP_DIR: directory })).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it.each([
    ['EXTRACTION_TIMEOUT_MS', '0'],
    ['DOWNLOAD_TIMEOUT_MS', '-1'],
    ['PROCESSING_TIMEOUT_MS', 'nope'],
    ['DELIVERY_TIMEOUT_MS', 'Infinity'],
    ['JOB_TIMEOUT_MS', '0'],
    ['MAX_MEDIA_BYTES', '51380225'],
    ['MAX_CONCURRENT_JOBS', '0'],
    ['MAX_QUEUED_JOBS', '-1'],
    ['MAX_YTDLP_STDOUT_BYTES', '0'],
    ['MAX_YTDLP_STDERR_BYTES', '0'],
    ['MAX_METADATA_BYTES', '0'],
    ['MAX_REDIRECTS', '4'],
    ['MAX_OPEN_DOWNLOADS', '0'],
    ['SHUTDOWN_GRACE_MS', '0'],
  ])('rejects invalid %s', async (key, value) => {
    const directory = await temporaryDirectory();
    await expect(
      loadConfig({
        TELEGRAM_BOT_TOKEN: 'token',
        YT_DLP_EXPECTED_VERSION: 'yt-dlp 2026.09.01',
        TEMP_DIR: directory,
        [key]: value,
      }),
    ).rejects.toThrow(key);
  });

  it.each(['relative/path', '/path/that/does/not/exist'])(
    'rejects unsafe TEMP_DIR %s',
    async (tempDir) => {
      await expect(
        loadConfig({
          TELEGRAM_BOT_TOKEN: 'token',
          YT_DLP_EXPECTED_VERSION: 'yt-dlp 2026.09.01',
          TEMP_DIR: tempDir,
        }),
      ).rejects.toThrow(/TEMP_DIR/);
    },
  );

  it('rejects a symlinked temp directory', async () => {
    const directory = await temporaryDirectory();
    const target = join(directory, 'target');
    await mkdir(target);
    const link = join(directory, 'link');
    await symlink(target, link);

    await expect(
      loadConfig({
        TELEGRAM_BOT_TOKEN: 'token',
        YT_DLP_EXPECTED_VERSION: 'yt-dlp 2026.09.01',
        TEMP_DIR: link,
      }),
    ).rejects.toThrow(/TEMP_DIR/);
  });

  it('rejects a media limit above 49 MiB and an invalid log level', async () => {
    const directory = await temporaryDirectory();
    await expect(
      loadConfig({
        TELEGRAM_BOT_TOKEN: 'token',
        YT_DLP_EXPECTED_VERSION: 'yt-dlp 2026.09.01',
        TEMP_DIR: directory,
        MAX_MEDIA_BYTES: '51380225',
      }),
    ).rejects.toThrow(/MAX_MEDIA_BYTES/);
    await expect(
      loadConfig({
        TELEGRAM_BOT_TOKEN: 'token',
        YT_DLP_EXPECTED_VERSION: 'yt-dlp 2026.09.01',
        TEMP_DIR: directory,
        LOG_LEVEL: 'verbose',
      }),
    ).rejects.toThrow(/LOG_LEVEL/);
  });
});
