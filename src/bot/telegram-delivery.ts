import { InputFile } from 'grammy';
import type { DeliveryDestination, PreparedMedia } from '../application/models.js';
import type { DeliveryReceipt, MediaDelivery } from '../application/ports.js';
import type { OperationContext } from '../application/operation-context.js';
import { applicationError, isApplicationError } from '../shared/errors.js';

export interface TelegramMediaApi {
  sendVideo(destination: string, file: InputFile, signal: AbortSignal): Promise<unknown>;
  sendAnimation(destination: string, file: InputFile, signal: AbortSignal): Promise<unknown>;
}

export type TelegramDeliveryOptions = Readonly<{
  api: TelegramMediaApi;
  timeoutMs: number;
}>;

export class TelegramDelivery implements MediaDelivery {
  constructor(private readonly options: TelegramDeliveryOptions) {}

  async deliver(
    destination: DeliveryDestination,
    media: PreparedMedia,
    context: OperationContext,
  ): Promise<DeliveryReceipt> {
    const stage = context.createStageSignal('delivery', this.options.timeoutMs);
    try {
      const file = new InputFile(media.deliveryPath);
      if (media.deliveryKind === 'animation') {
        await this.options.api.sendAnimation(destination, file, stage.signal);
      } else {
        await this.options.api.sendVideo(destination, file, stage.signal);
      }
      return { itemPosition: media.downloaded.position };
    } catch (error) {
      if (isApplicationError(stage.signal.reason)) throw stage.signal.reason;
      if (isPermanentDestinationError(error)) {
        throw applicationError('DeliveryDestinationUnavailable', 'delivery');
      }
      throw applicationError('TelegramDeliveryFailed', 'delivery', { cause: error });
    } finally {
      stage.dispose();
    }
  }
}

function isPermanentDestinationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  const status = record['error_code'];
  const description = record['description'];
  if (typeof status !== 'number' || typeof description !== 'string') return false;
  const safeDestinationFailure =
    /bot was blocked|bot was kicked|bot was removed|can't initiate conversation|chat not found|not enough rights|not a member of the chat|have no rights to send/i;
  return (status === 400 || status === 403) && safeDestinationFailure.test(description);
}
