import { describe, expect, it, vi } from 'vitest';
import { createApplication } from '../src/application.js';

describe('createApplication', () => {
  it('does not start request work until a request is handled', async () => {
    const handle = vi.fn(async () => 'no-animation' as const);
    const app = createApplication({ handle });
    const input = {
      canonicalUrl: 'https://x.com/example/status/123456789',
      chatId: 'chat-42',
    };
    const signal = new AbortController().signal;

    expect(handle).not.toHaveBeenCalled();
    await expect(app.handleRequest(input, signal)).resolves.toBe('no-animation');
    expect(handle).toHaveBeenCalledWith(input, signal);
  });
});
