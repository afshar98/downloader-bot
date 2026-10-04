import { describe, expect, it, vi } from 'vitest';
import { GifDelivery } from '../src/telegram-delivery.js';
import type { GifMedia } from '../src/gif-converter.js';
import { InputFile } from 'grammy';

const media: GifMedia = {
  path: '/tmp/verified.gif',
  sizeBytes: 1024,
  width: 32,
  height: 32,
  frameCount: 5,
  container: 'gif',
};

describe('GifDelivery', () => {
  it('uploads only the verified GIF artifact as an animation', async () => {
    const sendAnimation = vi.fn(
      async (_chatId: string, _animation: InputFile, _signal: AbortSignal) => undefined,
    );
    const telegram = { sendAnimation };
    const delivery = new GifDelivery(telegram);
    const signal = new AbortController().signal;

    await delivery.sendAnimation('chat-1', media, signal);

    expect(sendAnimation).toHaveBeenCalledOnce();
    expect(sendAnimation.mock.calls[0]?.[0]).toBe('chat-1');
    const uploaded = sendAnimation.mock.calls[0]?.[1];
    expect(uploaded).toBeInstanceOf(InputFile);
    expect(uploaded?.filename).toBe('verified.gif');
    expect(sendAnimation.mock.calls[0]?.[2]).toBe(signal);
    expect(telegram).not.toHaveProperty('sendVideo');
  });

  it('does not make a Telegram call after cancellation', async () => {
    const sendAnimation = vi.fn(async () => undefined);
    const delivery = new GifDelivery({ sendAnimation });
    const controller = new AbortController();
    controller.abort();

    await expect(delivery.sendAnimation('chat-1', media, controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(sendAnimation).not.toHaveBeenCalled();
  });

  it('rejects an artifact that is not marked as an animated GIF', async () => {
    const sendAnimation = vi.fn(async () => undefined);
    const delivery = new GifDelivery({ sendAnimation });
    const invalid = { ...media, container: 'mp4' } as unknown as GifMedia;

    await expect(
      delivery.sendAnimation('chat-1', invalid, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'invalid-gif',
    });
    expect(sendAnimation).not.toHaveBeenCalled();
  });

  it('maps Telegram upload errors to a stable safe failure', async () => {
    const delivery = new GifDelivery({
      sendAnimation: vi.fn(async () => {
        throw new Error('sensitive Telegram details');
      }),
    });

    await expect(
      delivery.sendAnimation('chat-1', media, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'delivery-failed',
    });
  });
});
