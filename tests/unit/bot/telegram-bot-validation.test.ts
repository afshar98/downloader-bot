import { describe, expect, it, vi } from 'vitest';
import type { DownloadPostMediaInput } from '../../../src/application/download-post-media.js';
import { createTelegramMessageHandler } from '../../../src/bot/telegram-bot.js';
import { createRequestId } from '../../../src/shared/identifiers.js';

function setup() {
  const requests: DownloadPostMediaInput[] = [];
  const replies: string[] = [];
  const execute = vi.fn(async (request: DownloadPostMediaInput) => {
    requests.push(request);
    let candidate: URL;
    try {
      candidate = new URL(request.candidateUrl);
    } catch {
      return { kind: 'rejected' as const, errorCode: 'InvalidUrl' as const };
    }
    if (candidate.hostname !== 'x.com') {
      return { kind: 'rejected' as const, errorCode: 'UnsupportedPostUrl' as const };
    }
    if (candidate.pathname !== '/user/status/1') {
      return { kind: 'rejected' as const, errorCode: 'UnsupportedPostUrl' as const };
    }
    return { kind: 'complete' as const, items: [] };
  });
  const handler = createTelegramMessageHandler({
    downloadPostMedia: { execute },
    createRequestId: () => createRequestId(() => 'request_1'),
  });
  const reply = async (text: string) => {
    replies.push(text);
  };
  return { handler, requests, replies, execute, reply };
}

describe('Telegram input validation', () => {
  it('rejects malformed, unsupported host, and non-status URLs with safe guidance', async () => {
    const { handler, execute, replies, reply } = setup();
    const signal = new AbortController().signal;

    await handler({ chatId: 1, text: 'hello' }, reply, signal);
    await handler({ chatId: 1, text: 'https://' }, reply, signal);
    await handler({ chatId: 1, text: 'https://example.org/user/status/1' }, reply, signal);
    await handler({ chatId: 1, text: 'https://x.com/explore' }, reply, signal);

    expect(execute).toHaveBeenCalledTimes(3);
    expect(replies[0]).toMatch(/one.*url/i);
    expect(replies.some((message) => /supported.*status/i.test(message))).toBe(true);
    expect(replies.join(' ')).not.toMatch(/example\.org|explore|raw|diagnostic/i);
  });

  it('rejects multiple URL tokens before calling the use case', async () => {
    const { handler, execute, replies, reply } = setup();

    await handler(
      { chatId: 2, text: 'https://x.com/user/status/1 https://t.co/short' },
      reply,
      new AbortController().signal,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/one.*url/i);
  });

  it('ignores updates without text and never starts a download', async () => {
    const { handler, execute, replies, reply } = setup();

    await handler({ chatId: 3 }, reply, new AbortController().signal);

    expect(execute).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
  });
});
