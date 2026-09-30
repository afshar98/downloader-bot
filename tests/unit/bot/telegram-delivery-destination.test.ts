import { describe, expect, it, vi } from 'vitest';
import { createOperationContext } from '../../../src/application/operation-context.js';
import { TelegramDelivery } from '../../../src/bot/telegram-delivery.js';
import type { TelegramMediaApi } from '../../../src/bot/telegram-delivery.js';
import { outcomeCopy } from '../../../src/bot/telegram-bot.js';
import { createRequestId } from '../../../src/shared/identifiers.js';
import { preparedMedia } from '../../support/builders.js';
import { createDeliveryDestination } from '../../../src/application/models.js';

const permanent = [
  'Forbidden: bot was blocked by the user',
  'Forbidden: bot was kicked from the group chat',
  'Forbidden: bot was removed from the channel',
  'Bad Request: chat not found',
  "Forbidden: bot can't initiate conversation with a user",
  'Forbidden: not enough rights to send text messages to the chat',
  'Forbidden: bot is not a member of the chat',
  'Forbidden: bot have no rights to send messages',
];

describe('Telegram destination failure classification', () => {
  it.each(
    permanent.map(
      (description) =>
        [description === 'Bad Request: chat not found' ? 400 : 403, description] as const,
    ),
  )('classifies authoritative permanent response: %s %s', async (status, description) => {
    const api: TelegramMediaApi = {
      sendVideo: vi.fn(async () => {
        throw { error_code: status, description };
      }),
      sendAnimation: vi.fn(async () => undefined),
    };
    const context = createOperationContext({
      requestId: createRequestId(),
      signal: new AbortController().signal,
      jobTimeoutMs: 5_000,
    });
    await expect(
      new TelegramDelivery({ api, timeoutMs: 1_000 }).deliver(
        createDeliveryDestination('-100private'),
        preparedMedia(),
        context,
      ),
    ).rejects.toMatchObject({ code: 'DeliveryDestinationUnavailable' });
    context.dispose();
  });

  it('does not classify transient and non-destination errors as unavailable', async () => {
    for (const error of [
      { error_code: 429, description: 'Too Many Requests' },
      { error_code: 400, description: 'Bad Request: file is too big' },
      { error_code: 403, description: 'Forbidden: media upload rejected' },
      new Error('opaque transport failure'),
    ]) {
      const api: TelegramMediaApi = {
        sendVideo: vi.fn(async () => {
          throw error;
        }),
        sendAnimation: vi.fn(async () => undefined),
      };
      const context = createOperationContext({
        requestId: createRequestId(),
        signal: new AbortController().signal,
        jobTimeoutMs: 5_000,
      });
      await expect(
        new TelegramDelivery({ api, timeoutMs: 1_000 }).deliver(
          createDeliveryDestination('-100private'),
          preparedMedia(),
          context,
        ),
      ).rejects.toMatchObject({ code: 'TelegramDeliveryFailed' });
      context.dispose();
    }
  });

  it('suppresses user responses after permanent destination failure and emits no diagnostics', () => {
    expect(
      outcomeCopy({ kind: 'failed', errorCode: 'DeliveryDestinationUnavailable' }),
    ).toBeUndefined();
    const rendered = String(
      outcomeCopy({
        kind: 'partial',
        items: [
          { kind: 'delivered', position: 1, mediaId: 'opaque' },
          { kind: 'unattempted', position: 2, reason: 'DeliveryDestinationUnavailable' },
        ],
        deliveredCount: 1,
        failedPositions: [],
        unattemptedPositions: [2],
      }),
    );
    expect(rendered).not.toMatch(/private|token|payload|trace|diagnostic/);
  });
});
