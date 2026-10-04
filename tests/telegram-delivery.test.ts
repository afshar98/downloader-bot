import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GifDelivery } from '../src/telegram-delivery.js';
import { GifConverter, type GifMedia } from '../src/gif-converter.js';
import { InputFile } from 'grammy';
import type { ProcessRunner } from '../src/process-runner.js';

const VALID_GIF = new URL('./fixtures/media/valid.gif', import.meta.url);

async function withVerifiedMedia(run: (media: GifMedia, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'xgif-delivery-test-'));
  const sourcePath = join(root, 'source.mp4');
  const partialPath = join(root, 'verified.gif.part');
  const gifPath = join(root, 'verified.gif');
  const bytes = await readFile(VALID_GIF);
  await writeFile(sourcePath, 'synthetic source');
  const converter = new GifConverter({
    executable: '/usr/bin/ffmpeg',
    maxSourceBytes: 1024,
    maxGifBytes: 1024 * 1024,
    runner: {
      run: vi.fn(async ({ args }) => {
        await writeFile(args.at(-1) ?? '', bytes);
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    } as ProcessRunner,
    validator: { validate: vi.fn(async () => ({ width: 32, height: 32, frameCount: 5 })) },
  });
  try {
    const media = await converter.convert(
      sourcePath,
      partialPath,
      gifPath,
      new AbortController().signal,
    );
    await run(media, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('GifDelivery', () => {
  it('uploads only the verified GIF artifact as an animation', async () => {
    await withVerifiedMedia(async (media) => {
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
  });

  it('does not make a Telegram call after cancellation', async () => {
    await withVerifiedMedia(async (media) => {
      const sendAnimation = vi.fn(async () => undefined);
      const delivery = new GifDelivery({ sendAnimation });
      const controller = new AbortController();
      controller.abort();

      await expect(
        delivery.sendAnimation('chat-1', media, controller.signal),
      ).rejects.toMatchObject({
        code: 'cancelled',
      });
      expect(sendAnimation).not.toHaveBeenCalled();
    });
  });

  it('rejects an artifact that is not marked as an animated GIF', async () => {
    const sendAnimation = vi.fn(async () => undefined);
    const delivery = new GifDelivery({ sendAnimation });
    const invalid = Object.freeze({
      path: '/tmp/verified.gif',
      sizeBytes: 1024,
      width: 32,
      height: 32,
      frameCount: 5,
      container: 'gif',
    }) as unknown as GifMedia;

    await expect(
      delivery.sendAnimation('chat-1', invalid, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'invalid-gif',
    });
    expect(sendAnimation).not.toHaveBeenCalled();
  });

  it('maps Telegram upload errors to a stable safe failure', async () => {
    await withVerifiedMedia(async (media) => {
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
});
