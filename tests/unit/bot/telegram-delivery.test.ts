import { InputFile } from 'grammy';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryDestination } from '../../../src/application/models.js';
import type { TelegramMediaApi } from '../../../src/bot/telegram-delivery.js';
import { createOperationContext } from '../../../src/application/operation-context.js';
import { TelegramDelivery } from '../../../src/bot/telegram-delivery.js';
import { createRequestId } from '../../../src/shared/identifiers.js';
import { preparedAnimationMedia, preparedMedia } from '../../support/builders.js';

function context(signal = new AbortController().signal) {
  return createOperationContext({ requestId: createRequestId(), signal, jobTimeoutMs: 5_000 });
}

afterEach(() => vi.useRealTimers());

describe('TelegramDelivery', () => {
  it('sends each prepared item to its opaque destination using the correct Bot API method', async () => {
    const api: TelegramMediaApi = {
      sendVideo: vi.fn(async () => undefined),
      sendAnimation: vi.fn(async () => undefined),
    };
    const delivery = new TelegramDelivery({ api, timeoutMs: 1_000 });
    const operation = context();
    const destination = '-10012345' as DeliveryDestination;

    await delivery.deliver(destination, preparedMedia(), operation);
    await delivery.deliver(destination, preparedAnimationMedia(), operation);

    expect(api.sendVideo).toHaveBeenCalledWith(
      destination,
      expect.any(InputFile),
      expect.any(AbortSignal),
    );
    expect(api.sendAnimation).toHaveBeenCalledWith(
      destination,
      expect.any(InputFile),
      expect.any(AbortSignal),
    );
    operation.dispose();
  });

  it('maps per-item timeout and ordinary API failures to safe typed errors', async () => {
    vi.useFakeTimers();
    const api: TelegramMediaApi = {
      sendVideo: vi.fn(async (_destination, _file, signal) => {
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      }),
      sendAnimation: vi.fn(async () => undefined),
    };
    const operation = context();
    const upload = new TelegramDelivery({ api, timeoutMs: 20 }).deliver(
      '-10012345' as DeliveryDestination,
      preparedMedia(),
      operation,
    );
    const timed = expect(upload).rejects.toMatchObject({ code: 'OperationTimedOut' });
    await vi.advanceTimersByTimeAsync(20);
    await timed;

    const failing: TelegramMediaApi = {
      sendVideo: vi.fn(async () => {
        throw new Error('secret response body');
      }),
      sendAnimation: vi.fn(async () => undefined),
    };
    await expect(
      new TelegramDelivery({ api: failing, timeoutMs: 1_000 }).deliver(
        '-10012345' as DeliveryDestination,
        preparedMedia(),
        operation,
      ),
    ).rejects.toMatchObject({ code: 'TelegramDeliveryFailed' });
    operation.dispose();
  });

  it('classifies authoritative blocked destinations as request-wide unavailable', async () => {
    const api: TelegramMediaApi = {
      sendVideo: vi.fn(async () => {
        throw { error_code: 403, description: 'Forbidden: bot was blocked by the user' };
      }),
      sendAnimation: vi.fn(async () => undefined),
    };
    const operation = context();

    await expect(
      new TelegramDelivery({ api, timeoutMs: 1_000 }).deliver(
        '-10012345' as DeliveryDestination,
        preparedMedia(),
        operation,
      ),
    ).rejects.toMatchObject({ code: 'DeliveryDestinationUnavailable' });
    operation.dispose();
  });
});
