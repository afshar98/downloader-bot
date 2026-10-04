import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot } from 'grammy';
import { createGifApplication } from './application.js';
import { loadConfig } from './config.js';
import { GifConverter } from './gif-converter.js';
import { MediaDownloader } from './media-downloader.js';
import { ProcessRunner } from './process-runner.js';
import { createTemporaryWorkspace } from './temporary-workspace.js';
import { GifDelivery } from './telegram-delivery.js';
import { registerTelegramHandlers } from './telegram-bot.js';
import { checkRuntimeTools } from './tool-checks.js';
import { XMediaProvider } from './x-media-provider.js';

export async function startBot(): Promise<void> {
  const config = loadConfig(process.env);
  const runner = new ProcessRunner();
  await checkRuntimeTools(config, runner);

  const bot = new Bot(config.telegramToken);
  const application = createGifApplication({
    maxConcurrentJobs: config.maxConcurrentJobs,
    jobTimeoutMs: config.jobTimeoutMs,
    workspaceFactory: createTemporaryWorkspace,
    provider: new XMediaProvider({ config, runner }),
    downloader: new MediaDownloader({ maxBytes: config.maxMediaBytes }),
    converter: new GifConverter({
      executable: config.ffmpegPath,
      maxSourceBytes: config.maxMediaBytes,
      maxGifBytes: config.maxGifBytes,
      timeoutMs: config.jobTimeoutMs,
      runner,
    }),
    delivery: new GifDelivery({
      sendAnimation: (chatId, animation, signal) =>
        bot.api.sendAnimation(
          chatId,
          animation,
          undefined,
          signal as Parameters<typeof bot.api.sendAnimation>[3],
        ),
    }),
    onFailure: ({ stage, code }) => {
      console.error(`[request-failed] stage=${stage} code=${code}`);
    },
  });
  registerTelegramHandlers(bot, application);
  bot.catch(() => {
    console.error('Telegram polling encountered an error.');
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    bot.stop();
    void application.shutdown().catch(() => {
      console.error('Application shutdown encountered an error.');
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await bot.start();
  await application.shutdown();
}

const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  void startBot().catch(() => {
    console.error('Bot startup failed. Check configuration and required local tools.');
    process.exitCode = 1;
  });
}
