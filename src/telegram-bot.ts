import { Bot } from 'grammy';
import type { Application, RequestResult } from './application.js';
import { AppError } from './errors.js';
import { parseXStatusUrl } from './x-url.js';

export type IncomingText = Readonly<{
  text: string;
  chatId: string;
}>;

export type IncomingTextHandlerDependencies = Readonly<{
  application: Application;
  reply(chatId: string, text: string): Promise<void>;
}>;

const URL_TOKEN = /https?:\/\/[^\s<>]+/giu;
const TRAILING_PUNCTUATION = /[),.;!?\]}]+$/u;

const MESSAGES = {
  invalid: 'لطفاً لینک یک پست X را بفرست.',
  unsupported: 'فقط لینک مستقیم پست‌های عمومی X/Twitter پشتیبانی می‌شود.',
  inaccessible: 'به این پست دسترسی ندارم.',
  noAnimation: 'محتوای متحرکی در این پست پیدا نشد.',
  failed: 'ساخت فایل GIF انجام نشد. دوباره امتحان کن.',
  cancelled: 'درخواست لغو شد.',
} as const;

export function createIncomingTextHandler(dependencies: IncomingTextHandlerDependencies) {
  return async ({ text, chatId }: IncomingText): Promise<void> => {
    const candidates = extractUrlCandidates(text);
    if (candidates.length !== 1) {
      await dependencies.reply(chatId, MESSAGES.invalid);
      return;
    }

    let reference;
    try {
      reference = parseXStatusUrl(candidates[0] ?? '');
    } catch (error) {
      await dependencies.reply(chatId, errorReply(error));
      return;
    }

    let result: RequestResult;
    try {
      result = await dependencies.application.handleRequest(
        { canonicalUrl: reference.canonicalUrl, chatId },
        new AbortController().signal,
      );
    } catch {
      await dependencies.reply(chatId, MESSAGES.failed);
      return;
    }

    const message = resultReply(result);
    if (message) await dependencies.reply(chatId, message);
  };
}

export function registerTelegramHandlers(bot: Bot, application: Application): Bot {
  bot.on('message:text', async (context) => {
    const handler = createIncomingTextHandler({
      application,
      reply: async (_chatId, text) => {
        await context.reply(text);
      },
    });
    await handler({ text: context.message.text, chatId: String(context.chat.id) });
  });
  return bot;
}

export function extractUrlCandidates(text: string): string[] {
  return [...text.matchAll(URL_TOKEN)].map(([match]) => match?.replace(TRAILING_PUNCTUATION, '') ?? '');
}

function errorReply(error: unknown): string {
  if (!(error instanceof AppError)) return MESSAGES.invalid;
  return error.code === 'unsupported-url' ? MESSAGES.unsupported : MESSAGES.invalid;
}

function resultReply(result: RequestResult): string | undefined {
  switch (result) {
    case 'delivered':
      return undefined;
    case 'invalid-url':
      return MESSAGES.invalid;
    case 'unsupported-url':
      return MESSAGES.unsupported;
    case 'inaccessible':
      return MESSAGES.inaccessible;
    case 'no-animation':
      return MESSAGES.noAnimation;
    case 'failed':
      return MESSAGES.failed;
    case 'cancelled':
      return MESSAGES.cancelled;
  }
}
