import { describe, expect, it, vi } from 'vitest';
import { createApplication } from '../src/application.js';
import { createIncomingTextHandler } from '../src/telegram-bot.js';

describe('createIncomingTextHandler', () => {
  it('asks for one link when the message contains none', async () => {
    const handle = vi.fn(async () => 'delivered' as const);
    const reply = vi.fn(async (_chatId: string, _text: string) => undefined);
    const handler = createIncomingTextHandler({
      application: createApplication({ handle }),
      reply,
    });

    await handler({ text: 'hello', chatId: 'chat-1' });

    expect(handle).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('chat-1', expect.any(String));
  });

  it('rejects multiple links without choosing one', async () => {
    const handle = vi.fn(async () => 'delivered' as const);
    const reply = vi.fn(async (_chatId: string, _text: string) => undefined);
    const handler = createIncomingTextHandler({
      application: createApplication({ handle }),
      reply,
    });

    await handler({
      text: 'https://x.com/name/status/123456789 and https://example.com/post/2',
      chatId: 'chat-1',
    });

    expect(handle).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('chat-1', expect.any(String));
  });

  it('rejects a malformed single link without starting media work', async () => {
    const handle = vi.fn(async () => 'delivered' as const);
    const reply = vi.fn(async (_chatId: string, _text: string) => undefined);
    const handler = createIncomingTextHandler({
      application: createApplication({ handle }),
      reply,
    });

    await handler({ text: 'https://', chatId: 'chat-1' });

    expect(handle).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('chat-1', expect.any(String));
  });

  it('reports an unsupported URL without starting media work', async () => {
    const handle = vi.fn(async () => 'delivered' as const);
    const reply = vi.fn(async (_chatId: string, _text: string) => undefined);
    const handler = createIncomingTextHandler({
      application: createApplication({ handle }),
      reply,
    });

    await handler({ text: 'https://example.com/post/2', chatId: 'chat-1' });

    expect(handle).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('chat-1', expect.any(String));
  });

  it('passes one canonical X URL to the application and leaves success reply to media delivery', async () => {
    const handle = vi.fn(async () => 'delivered' as const);
    const reply = vi.fn(async (_chatId: string, _text: string) => undefined);
    const handler = createIncomingTextHandler({
      application: createApplication({ handle }),
      reply,
    });

    await handler({
      text: 'Please get this: https://www.twitter.com/name/status/123456789?ref=share.',
      chatId: 'chat-1',
    });

    expect(handle).toHaveBeenCalledWith(
      { canonicalUrl: 'https://x.com/name/status/123456789', chatId: 'chat-1' },
      expect.any(AbortSignal),
    );
    expect(reply).not.toHaveBeenCalled();
  });

  it('maps safe application failures to a reply without revealing error details', async () => {
    const handle = vi.fn(async () => 'no-animation' as const);
    const reply = vi.fn(async (_chatId: string, _text: string) => undefined);
    const handler = createIncomingTextHandler({
      application: createApplication({ handle }),
      reply,
    });

    await handler({ text: 'https://x.com/name/status/123456789', chatId: 'chat-1' });

    expect(reply).toHaveBeenCalledWith('chat-1', expect.any(String));
    expect(reply.mock.calls[0]?.[1]).not.toContain('https://');
  });

  it('shows the generic GIF failure text when the application returns failed', async () => {
    const handle = vi.fn(async () => 'failed' as const);
    const reply = vi.fn(async (_chatId: string, _text: string) => undefined);
    const handler = createIncomingTextHandler({
      application: createApplication({ handle }),
      reply,
    });

    await handler({ text: 'https://x.com/name/status/123456789', chatId: 'chat-1' });

    expect(reply).toHaveBeenCalledWith('chat-1', 'ساخت فایل GIF انجام نشد. دوباره امتحان کن.');
  });
});
