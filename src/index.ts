import { pathToFileURL } from 'node:url';
import { Bot } from 'grammy';
import { loadProcessConfig } from './config/load-config.js';
import { verifyFfmpegVersion } from './config/verify-ffmpeg-version.js';
import { DownloadPostMedia } from './application/download-post-media.js';
import { createLogger } from './infrastructure/logger.js';
import { ProcessRunner } from './infrastructure/process-runner.js';
import { AdmissionControl } from './infrastructure/admission-control.js';
import { TemporaryWorkspaceFactory } from './infrastructure/temporary-workspace.js';
import { SafeHttpClient } from './infrastructure/safe-http-client.js';
import { XMediaProvider } from './providers/x/x-media-provider.js';
import { SafeMediaDownloader } from './media/safe-media-downloader.js';
import { GifMediaProcessor } from './media/gif-media-processor.js';
import { RepresentationSelector } from './media/representation-selector.js';
import { TelegramDelivery } from './bot/telegram-delivery.js';
import { createTelegramBot, startLongPolling, stopLongPolling } from './bot/telegram-bot.js';
import { callGrammyWithAbortSignal } from './bot/grammy-signal-adapter.js';
import { applicationError } from './shared/errors.js';

export async function startApplication(): Promise<Readonly<{ stop(): Promise<boolean> }>> {
  const config = await loadProcessConfig();
  const logger = createLogger({ level: config.logLevel });
  const controller = new AbortController();
  const bot = new Bot(config.telegramBotToken);
  let initiateShutdown: () => void = () => {};
  let fatalShutdownStarted = false;
  const onFatalResourceFailure = () => {
    if (!controller.signal.aborted) {
      controller.abort(applicationError('OperationCancelled', 'cleanup'));
    }
    if (fatalShutdownStarted) return;
    fatalShutdownStarted = true;
    initiateShutdown();
  };
  const processRunner = new ProcessRunner({ onFatalResourceFailure });
  const actualYtDlpVersion = await processRunner.checkVersion(config.ytDlpPath);
  if (actualYtDlpVersion.trim() !== config.ytDlpExpectedVersion) {
    throw new Error('Configured yt-dlp version does not match the approved deployment version');
  }
  await verifyFfmpegVersion(processRunner, config.ffmpegPath, config.ffmpegExpectedVersion);

  const admission = new AdmissionControl({
    maxActive: config.maxConcurrentJobs,
    maxQueued: config.maxQueuedJobs,
  });
  const workspaceFactory = new TemporaryWorkspaceFactory({
    parentDirectory: config.tempDir,
    logger,
    onFatalResourceFailure,
  });
  const provider = new XMediaProvider({
    runner: processRunner,
    executable: config.ytDlpPath,
    limits: {
      extractionTimeoutMs: config.extractionTimeoutMs,
      maxStdoutBytes: config.maxYtDlpStdoutBytes,
      maxStderrBytes: config.maxYtDlpStderrBytes,
      maxMetadataBytes: config.maxMetadataBytes,
    },
  });
  const httpClient = new SafeHttpClient({ maxRedirects: config.maxRedirects, logger });
  const downloader = new SafeMediaDownloader({ httpClient });
  const processor = new GifMediaProcessor({
    executable: config.ffmpegPath,
    maxMediaBytes: config.maxMediaBytes,
    runner: processRunner,
    onFatalResourceFailure,
  });
  const selector = new RepresentationSelector();
  const application = new DownloadPostMedia({
    provider,
    downloader,
    processor,
    delivery: new TelegramDelivery({
      timeoutMs: config.deliveryTimeoutMs,
      api: {
        sendVideo: async (destination, file, signal) => {
          return callGrammyWithAbortSignal(signal, (grammySignal) =>
            bot.api.sendVideo(destination, file, {}, grammySignal),
          );
        },
        sendAnimation: async (destination, file, signal) => {
          return callGrammyWithAbortSignal(signal, (grammySignal) =>
            bot.api.sendAnimation(destination, file, {}, grammySignal),
          );
        },
      },
    }),
    admission,
    downloadAdmission: new AdmissionControl({
      maxActive: config.maxOpenDownloads,
      maxQueued: config.maxConcurrentJobs,
    }),
    workspaceFactory,
    selector,
    limits: {
      maxMediaBytes: config.maxMediaBytes,
      jobTimeoutMs: config.jobTimeoutMs,
      downloadTimeoutMs: config.downloadTimeoutMs,
      processingTimeoutMs: config.processingTimeoutMs,
      maxRedirects: config.maxRedirects,
    },
    logger,
    onFatalResourceFailure,
  });
  createTelegramBot({
    token: config.telegramBotToken,
    bot,
    downloadPostMedia: application,
    requestSignal: controller.signal,
    logger,
  });
  const polling = startLongPolling(bot, config.maxConcurrentJobs + config.maxQueuedJobs);
  let stopPromise: Promise<boolean> | undefined;
  const stop = (): Promise<boolean> => {
    stopPromise ??= stopLongPolling(polling, controller, config.shutdownGraceMs, () =>
      processRunner.closeResources(),
    );
    return stopPromise;
  };
  initiateShutdown = () => {
    void stop().then((stopped) => {
      if (!stopped) {
        process.exitCode = 1;
        process.exit(1);
      }
    });
  };

  return {
    async stop() {
      const stopped = await stop();
      logger.info(
        { stage: 'shutdown', code: stopped ? 'OperationCancelled' : 'OperationTimedOut' },
        stopped ? 'bot shutdown complete' : 'bot shutdown grace elapsed',
      );
      return stopped;
    },
  };
}

async function main(): Promise<void> {
  let application: Awaited<ReturnType<typeof startApplication>>;
  try {
    application = await startApplication();
  } catch {
    process.stderr.write('{"level":"error","code":"ProviderOutputInvalid","stage":"startup"}\n');
    process.exitCode = 1;
    return;
  }

  let stopping = false;
  const stop = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    process.stderr.write(`{"level":"info","stage":"shutdown","signal":"${signal}"}\n`);
    if (!(await application.stop())) {
      process.exitCode = 1;
      process.exit(1);
    }
  };
  const onSigint = () => void stop('SIGINT');
  const onSigterm = () => void stop('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
