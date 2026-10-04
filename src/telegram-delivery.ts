import { InputFile } from 'grammy';
import { AppError } from './errors.js';
import type { GifMedia } from './gif-converter.js';

export type AnimationApi = Readonly<{
  sendAnimation(chatId: string, animation: InputFile, signal: AbortSignal): Promise<unknown>;
}>;

export class GifDelivery {
  constructor(private readonly api: AnimationApi) {}

  async sendAnimation(chatId: string, media: GifMedia, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new AppError('cancelled');
    if (
      media.container !== 'gif' ||
      !media.path.toLowerCase().endsWith('.gif') ||
      media.sizeBytes <= 0 ||
      media.frameCount < 2
    ) {
      throw new AppError('invalid-gif');
    }
    try {
      await this.api.sendAnimation(chatId, new InputFile(media.path), signal);
    } catch (cause) {
      if (signal.aborted) throw new AppError('cancelled', 'Delivery cancelled', { cause });
      throw new AppError('delivery-failed', 'Telegram animation upload failed', { cause });
    }
  }
}
