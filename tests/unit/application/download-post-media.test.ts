import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AdmissionControlPort,
  MediaDelivery,
  MediaDownloader,
  MediaProcessor,
  MediaProvider,
} from '../../../src/application/ports.js';
import { createDeliveryDestination } from '../../../src/application/models.js';
import type { ProcessingBudget } from '../../../src/application/models.js';
import { DownloadPostMedia } from '../../../src/application/download-post-media.js';
import { RepresentationSelector } from '../../../src/media/representation-selector.js';
import { TemporaryWorkspaceFactory } from '../../../src/infrastructure/temporary-workspace.js';
import { AdmissionControl } from '../../../src/infrastructure/admission-control.js';
import { applicationError } from '../../../src/shared/errors.js';
import { createRequestId } from '../../../src/shared/identifiers.js';
import { discoveredMedia, downloadedMedia, preparedMedia } from '../../support/builders.js';

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'download-usecase-test-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function makeUseCase(
  input: {
    media?: ReturnType<typeof discoveredMedia>[];
    resolveError?: unknown;
    processErrorAt?: number;
    admission?: AdmissionControlPort;
  } = {},
) {
  const items = input.media ?? [discoveredMedia()];
  const provider: MediaProvider = {
    recognizes: (candidate) =>
      ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(candidate.hostname),
    validate: () => ({
      provider: 'x',
      postId: '1',
      canonicalUrl: new URL('https://x.com/user/status/1'),
    }),
    resolve: vi.fn(async () => {
      if (input.resolveError) throw input.resolveError;
      return items;
    }),
  };
  const downloader: MediaDownloader = {
    download: vi.fn(async ({ media }) =>
      downloadedMedia({
        mediaId: media.mediaId,
        position: media.position,
        kind: media.kind,
      }),
    ),
  };
  const processor: MediaProcessor = {
    prepare: vi.fn(async (media) => {
      if (media.position === input.processErrorAt) {
        throw applicationError('MediaProcessingFailed', 'processing');
      }
      return preparedMedia({ media });
    }),
  };
  const deliver = vi.fn(async (_destination: unknown, media: ReturnType<typeof preparedMedia>) => ({
    itemPosition: media.downloaded.position,
  }));
  const delivery: MediaDelivery = { deliver };
  return { provider, downloader, processor, delivery, deliver };
}

describe('DownloadPostMedia', () => {
  it('uses one item processing budget across fallback and retires each attempt before reacquiring', async () => {
    const parent = await createRoot();
    let clock = performance.now();
    const media = discoveredMedia({
      representations: [
        { ...discoveredMedia().representations[0]!, representationId: 'first', sourceIndex: 0 },
        { ...discoveredMedia().representations[0]!, representationId: 'second', sourceIndex: 1 },
      ],
    });
    const provider: MediaProvider = {
      recognizes: () => true,
      validate: () => ({
        provider: 'x',
        postId: '1',
        canonicalUrl: new URL('https://x.com/u/status/1'),
      }),
      resolve: async () => [media],
    };
    const downloadSignals: AbortSignal[] = [];
    let downloads = 0;
    const downloader: MediaDownloader = {
      download: async ({ media: item, workspace, signal }) => {
        downloads += 1;
        downloadSignals.push(signal);
        if (downloads === 2) expect(await readdir(workspace.root)).toEqual([]);
        const handle = await open(workspace.itemPaths(item.position).partPath, 'wx', 0o600);
        await handle.writeFile('mp4');
        await handle.close();
        await workspace.finalizeItem(item.position);
        return downloadedMedia({
          mediaId: item.mediaId,
          position: item.position,
          path: workspace.itemPaths(item.position).mediaPath,
          sizeBytes: 3,
        });
      },
    };
    const budgets: ProcessingBudget[] = [];
    const processor: MediaProcessor = {
      prepare: async (downloaded, _context, _workspace, budget) => {
        budgets.push(budget);
        if (budgets.length === 1) {
          clock += 3;
          throw applicationError('MediaProcessingFailed', 'processing');
        }
        return preparedMedia({ media: downloaded });
      },
    };
    const app = new DownloadPostMedia({
      provider,
      downloader,
      processor,
      delivery: {
        deliver: async (_destination, value) => ({ itemPosition: value.downloaded.position }),
      },
      admission: new AdmissionControl({ maxActive: 1, maxQueued: 0 }),
      workspaceFactory: new TemporaryWorkspaceFactory({ parentDirectory: parent }),
      selector: new RepresentationSelector({ maxFallbacks: 2 }),
      limits: {
        maxMediaBytes: 51_380_224,
        jobTimeoutMs: 100,
        downloadTimeoutMs: 50,
        processingTimeoutMs: 10,
        maxRedirects: 3,
      },
      now: () => clock,
    });

    const outcome = await app.execute({
      destination: createDeliveryDestination('-100123'),
      messageText: 'https://x.com/u/status/1',
      candidateUrl: 'https://x.com/u/status/1',
      requestId: createRequestId(),
      signal: new AbortController().signal,
    });
    expect(outcome.kind).toBe('complete');
    expect(downloads).toBe(2);
    expect(budgets[0]?.signal).toBe(budgets[1]?.signal);
    expect(budgets[0]?.deadlineAt).toBe(budgets[1]?.deadlineAt);
    expect(downloadSignals[1]).toBe(budgets[0]?.signal);
    expect(budgets[1]?.remainingMs()).toBe(7);
    expect(await readdir(parent)).toEqual([]);
  });

  it('does not start fallback acquisition after the shared processing budget expires', async () => {
    const parent = await createRoot();
    let clock = performance.now();
    const media = discoveredMedia({
      representations: [
        { ...discoveredMedia().representations[0]!, representationId: 'first', sourceIndex: 0 },
        { ...discoveredMedia().representations[0]!, representationId: 'second', sourceIndex: 1 },
      ],
    });
    const provider: MediaProvider = {
      recognizes: () => true,
      validate: () => ({
        provider: 'x',
        postId: '1',
        canonicalUrl: new URL('https://x.com/u/status/1'),
      }),
      resolve: async () => [media],
    };
    const downloader = {
      download: vi.fn(async ({ media: item, workspace }) =>
        downloadedMedia({
          mediaId: item.mediaId,
          position: item.position,
          path: workspace.itemPaths(item.position).mediaPath,
        }),
      ),
    };
    const app = new DownloadPostMedia({
      provider,
      downloader,
      processor: {
        prepare: async () => {
          clock += 20;
          throw applicationError('MediaProcessingFailed', 'processing');
        },
      },
      delivery: { deliver: vi.fn(async () => ({ itemPosition: 1 })) },
      admission: new AdmissionControl({ maxActive: 1, maxQueued: 0 }),
      workspaceFactory: new TemporaryWorkspaceFactory({ parentDirectory: parent }),
      selector: new RepresentationSelector({ maxFallbacks: 2 }),
      limits: {
        maxMediaBytes: 51_380_224,
        jobTimeoutMs: 100,
        downloadTimeoutMs: 50,
        processingTimeoutMs: 10,
        maxRedirects: 3,
      },
      now: () => clock,
    });

    const outcome = await app.execute({
      destination: createDeliveryDestination('-100123'),
      messageText: 'https://x.com/u/status/1',
      candidateUrl: 'https://x.com/u/status/1',
      requestId: createRequestId(),
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'OperationTimedOut' });
    expect(downloader.download).toHaveBeenCalledTimes(1);
    expect(await readdir(parent)).toEqual([]);
  });

  it('retries item cleanup and signals fatal shutdown after bounded retirement fails', async () => {
    const parent = await createRoot();
    const factory = new TemporaryWorkspaceFactory({ parentDirectory: parent });
    let workspaceRemove: ReturnType<typeof vi.spyOn> | undefined;
    const create = vi.spyOn(factory, 'create').mockImplementation(async (requestId) => {
      const workspace = await new TemporaryWorkspaceFactory({ parentDirectory: parent }).create(
        requestId,
      );
      workspaceRemove = vi
        .spyOn(workspace, 'removeItem')
        .mockRejectedValue(new Error('private path'));
      return workspace;
    });
    const onFatalResourceFailure = vi.fn();
    const { provider, downloader, processor, delivery } = makeUseCase({
      media: [discoveredMedia({ position: 1 }), discoveredMedia({ position: 2 })],
    });
    const app = new DownloadPostMedia({
      provider,
      downloader,
      processor,
      delivery,
      admission: new AdmissionControl({ maxActive: 1, maxQueued: 0 }),
      workspaceFactory: { create, cleanup: (workspace) => factory.cleanup(workspace) },
      selector: new RepresentationSelector(),
      limits: {
        maxMediaBytes: 51_380_224,
        jobTimeoutMs: 100,
        downloadTimeoutMs: 50,
        processingTimeoutMs: 20,
        maxRedirects: 3,
      },
      onFatalResourceFailure,
    });

    const outcome = await app.execute({
      destination: createDeliveryDestination('-100123'),
      messageText: 'https://x.com/u/status/1',
      candidateUrl: 'https://x.com/u/status/1',
      requestId: createRequestId(),
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      kind: 'partial',
      deliveredCount: 1,
      terminalErrorCode: 'OperationCancelled',
      unattemptedPositions: [2],
    });
    expect(workspaceRemove).toHaveBeenCalledTimes(2);
    expect(onFatalResourceFailure).toHaveBeenCalledWith('workspace-cleanup-incomplete');
    expect(await readdir(parent)).toEqual([]);
  });

  it('discovers, downloads, and delivers items in source order, then cleans and releases', async () => {
    const parent = await createRoot();
    const items = [
      discoveredMedia({ mediaId: 'one', position: 1 }),
      discoveredMedia({ mediaId: 'two', position: 2 }),
    ];
    const { provider, downloader, delivery, deliver, processor } = makeUseCase({ media: items });
    const workspaceFactory = new TemporaryWorkspaceFactory({ parentDirectory: parent });
    const appWithFactory = new DownloadPostMedia({
      provider,
      downloader,
      processor,
      delivery,
      admission: new AdmissionControl({ maxActive: 1, maxQueued: 0 }),
      workspaceFactory,
      selector: new RepresentationSelector(),
      limits: {
        maxMediaBytes: 51_380_224,
        jobTimeoutMs: 115_000,
        downloadTimeoutMs: 60_000,
        maxRedirects: 3,
      },
    });

    const outcome = await appWithFactory.execute({
      destination: createDeliveryDestination('-100123'),
      messageText: 'https://x.com/user/status/1',
      candidateUrl: 'https://x.com/user/status/1',
      requestId: createRequestId(),
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({ kind: 'complete', items: [{ position: 1 }, { position: 2 }] });
    expect(deliver.mock.calls.map((call) => call[1].downloaded.position)).toEqual([1, 2]);
    expect(processor.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 'one' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.objectContaining({ root: expect.any(String) }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineAt: expect.any(Number),
        remainingMs: expect.any(Function),
      }),
    );
    expect(await readdir(parent)).toEqual([]);
  });

  it('continues after an isolated item failure and reports ordered partial results', async () => {
    const parent = await createRoot();
    const items = [1, 2, 3].map((position) =>
      discoveredMedia({
        mediaId: `media-${position}`,
        position,
      }),
    );
    const { provider, downloader, delivery, deliver } = makeUseCase({
      media: items,
      processErrorAt: 2,
    });
    const workspaceFactory = new TemporaryWorkspaceFactory({ parentDirectory: parent });
    const app = new DownloadPostMedia({
      provider,
      downloader,
      processor: {
        prepare: async (media) => {
          if (media.position === 2) throw applicationError('MediaProcessingFailed', 'processing');
          return preparedMedia({ media });
        },
      },
      delivery,
      admission: new AdmissionControl({ maxActive: 2, maxQueued: 1 }),
      workspaceFactory,
      selector: new RepresentationSelector(),
      limits: {
        maxMediaBytes: 51_380_224,
        jobTimeoutMs: 115_000,
        downloadTimeoutMs: 60_000,
        maxRedirects: 3,
      },
    });

    const outcome = await app.execute({
      destination: createDeliveryDestination('-100123'),
      messageText: 'https://x.com/user/status/1',
      candidateUrl: 'https://x.com/user/status/1',
      requestId: createRequestId(),
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      kind: 'partial',
      deliveredCount: 2,
      failedPositions: [2],
    });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(await readdir(parent)).toEqual([]);
  });

  it('returns safe provider failures and rejects unsupported URLs before admission', async () => {
    const parent = await createRoot();
    const { provider, downloader, processor, delivery } = makeUseCase({
      resolveError: applicationError('ProviderOutputInvalid', 'provider'),
    });
    const workspaceFactory = new TemporaryWorkspaceFactory({ parentDirectory: parent });
    const admission = new AdmissionControl({ maxActive: 1, maxQueued: 0 });
    const acquire = vi.spyOn(admission, 'acquire');
    const app = new DownloadPostMedia({
      provider,
      downloader,
      processor,
      delivery,
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

    const input = {
      destination: createDeliveryDestination('-100123'),
      messageText: 'https://x.com/user/status/1',
      candidateUrl: 'https://x.com/user/status/1',
      requestId: createRequestId(),
      signal: new AbortController().signal,
    };
    await expect(app.execute(input)).resolves.toMatchObject({
      kind: 'failed',
      errorCode: 'ProviderOutputInvalid',
    });
    await expect(app.execute({ ...input, candidateUrl: 'https://example.org/' })).resolves.toEqual({
      kind: 'rejected',
      errorCode: 'UnsupportedPostUrl',
    });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(await readdir(parent)).toEqual([]);
  });

  it('cancels queued work and cleans an active request after shutdown cancellation', async () => {
    const parent = await createRoot();
    const admission = new AdmissionControl({ maxActive: 1, maxQueued: 1 });
    const activePermit = await admission.acquire({
      requestId: createRequestId(),
      signal: new AbortController().signal,
    });
    const { provider, downloader, processor, delivery } = makeUseCase();
    const workspaceFactory = new TemporaryWorkspaceFactory({ parentDirectory: parent });
    const app = new DownloadPostMedia({
      provider,
      downloader,
      processor,
      delivery,
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
    const controller = new AbortController();
    const queued = app.execute({
      destination: createDeliveryDestination('-100123'),
      messageText: 'https://x.com/user/status/1',
      candidateUrl: 'https://x.com/user/status/1',
      requestId: createRequestId(),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(admission.snapshot().queued).toBe(1));
    controller.abort();

    await expect(queued).resolves.toMatchObject({
      kind: 'failed',
      errorCode: 'OperationCancelled',
    });
    expect(admission.snapshot()).toEqual({ active: 1, queued: 0 });
    expect(await readdir(parent)).toEqual([]);
    activePermit.release();
  });
});
