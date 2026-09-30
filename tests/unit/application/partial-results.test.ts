import { describe, expect, it, vi } from 'vitest';
import type {
  AdmissionControlPort,
  MediaDelivery,
  MediaProvider,
} from '../../../src/application/ports.js';
import { createDeliveryDestination } from '../../../src/application/models.js';
import { DownloadPostMedia } from '../../../src/application/download-post-media.js';
import { RepresentationSelector } from '../../../src/media/representation-selector.js';
import { applicationError } from '../../../src/shared/errors.js';
import { createRequestId } from '../../../src/shared/identifiers.js';
import { discoveredMedia, downloadedMedia, preparedMedia } from '../../support/builders.js';

function makeApp(deliver: MediaDelivery['deliver'], signal: AbortSignal) {
  const media = [1, 2, 3].map((position) => discoveredMedia({ position, mediaId: `m${position}` }));
  const provider: MediaProvider = {
    recognizes: () => true,
    validate: () => ({
      provider: 'x',
      postId: '1',
      canonicalUrl: new URL('https://x.com/u/status/1'),
    }),
    resolve: vi.fn(async () => media),
  };
  const releases = vi.fn();
  const admission: AdmissionControlPort = {
    acquire: vi.fn(async ({ signal }) => {
      if (signal.aborted) throw applicationError('OperationCancelled', 'admission');
      return { requestId: createRequestId(), release: releases };
    }),
  };
  const workspace = {
    root: '/tmp/fake',
    itemPaths: () => ({ partPath: '/tmp/fake/a.part', mediaPath: '/tmp/fake/a.mp4' }),
    finalizeItem: vi.fn(),
    removePartial: vi.fn(),
  };
  const workspaceFactory = { create: vi.fn(async () => workspace), cleanup: vi.fn(async () => {}) };
  const downloader = {
    download: vi.fn(async ({ media: item }: { media: (typeof media)[number] }) =>
      downloadedMedia({ mediaId: item.mediaId, position: item.position }),
    ),
  };
  const processor = {
    prepare: vi.fn(async (item: ReturnType<typeof downloadedMedia>) =>
      preparedMedia({ media: item }),
    ),
  };
  const app = new DownloadPostMedia({
    provider,
    downloader,
    processor,
    delivery: { deliver },
    admission,
    workspaceFactory,
    selector: new RepresentationSelector(),
    limits: {
      maxMediaBytes: 51_380_224,
      jobTimeoutMs: 115_000,
      downloadTimeoutMs: 60_000,
      maxRedirects: 3,
    },
  });
  return {
    app,
    releases,
    workspaceFactory,
    downloader,
    execute: () =>
      app.execute({
        destination: createDeliveryDestination('-100'),
        messageText: 'https://x.com/u/status/1',
        candidateUrl: 'https://x.com/u/status/1',
        requestId: createRequestId(),
        signal,
      }),
  };
}

describe('request-wide cancellation partial results', () => {
  it('preserves prior deliveries and marks all remaining media unattempted after cancellation', async () => {
    const controller = new AbortController();
    const delivered: number[] = [];
    const delivery: MediaDelivery = {
      deliver: async (_destination, item) => {
        delivered.push(item.downloaded.position);
        if (item.downloaded.position === 1) controller.abort();
        return { itemPosition: item.downloaded.position };
      },
    };
    const context = makeApp(delivery.deliver.bind(delivery), controller.signal);
    const outcome = await context.execute();
    expect(outcome).toMatchObject({
      kind: 'partial',
      deliveredCount: 1,
      terminalErrorCode: 'OperationCancelled',
      failedPositions: [],
      unattemptedPositions: [2, 3],
    });
    expect(delivered).toEqual([1]);
    expect(context.downloader.download).toHaveBeenCalledTimes(1);
    expect(context.workspaceFactory.cleanup).toHaveBeenCalledTimes(1);
    expect(context.releases).toHaveBeenCalledTimes(1);
  });

  it('returns an actionable zero-delivery cancellation before any item is attempted', async () => {
    const controller = new AbortController();
    controller.abort();
    const delivery = { deliver: vi.fn(async () => ({ itemPosition: 1 })) };
    const context = makeApp(delivery.deliver, controller.signal);
    await expect(context.execute()).resolves.toMatchObject({
      kind: 'failed',
      errorCode: 'OperationCancelled',
    });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(context.workspaceFactory.create).not.toHaveBeenCalled();
  });

  it.each(['OperationTimedOut', 'OperationCancelled'] as const)(
    'maps zero-delivery terminal %s distinctly',
    async (code) => {
      const delivery = {
        deliver: vi.fn(async () => {
          throw applicationError(code, 'delivery');
        }),
      };
      const context = makeApp(delivery.deliver, new AbortController().signal);
      const outcome = await context.execute();
      expect(outcome).toMatchObject({ kind: 'failed', errorCode: code });
      expect(outcome).not.toHaveProperty('terminalErrorCode');
    },
  );

  it('stops the request when an item operation reports cancellation', async () => {
    const delivery = {
      deliver: vi.fn(async (_destination: unknown, item: ReturnType<typeof preparedMedia>) => {
        if (item.downloaded.position === 2)
          throw applicationError('OperationCancelled', 'delivery');
        return { itemPosition: item.downloaded.position };
      }),
    };
    const context = makeApp(delivery.deliver, new AbortController().signal);
    const outcome = await context.execute();
    expect(outcome).toMatchObject({
      kind: 'partial',
      deliveredCount: 1,
      unattemptedPositions: [2, 3],
    });
    expect(delivery.deliver).toHaveBeenCalledTimes(2);
  });
});
