import { describe, expect, it, vi } from 'vitest';
import { stopLongPolling } from '../../src/bot/telegram-bot.js';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DownloadPostMedia } from '../../src/application/download-post-media.js';
import { createDeliveryDestination } from '../../src/application/models.js';
import { AdmissionControl } from '../../src/infrastructure/admission-control.js';
import { TemporaryWorkspaceFactory } from '../../src/infrastructure/temporary-workspace.js';
import { RepresentationSelector } from '../../src/media/representation-selector.js';
import { applicationError } from '../../src/shared/errors.js';
import { createRequestId } from '../../src/shared/identifiers.js';
import { discoveredMedia } from '../support/builders.js';

describe('graceful polling shutdown', () => {
  it('stops polling, cancels active work, closes resources, and enforces the grace bound', async () => {
    const controller = new AbortController();
    const stop = vi.fn(async () => {});
    const closeResources = vi.fn(async () => {});
    const wait = vi.fn(async (promise: Promise<void>, timeoutMs: number) => {
      expect(timeoutMs).toBe(30_000);
      await promise;
      return false;
    });

    const completed = await stopLongPolling({ stop }, controller, 30_000, closeResources, wait);

    expect(completed).toBe(false);
    expect(controller.signal.aborted).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(closeResources).toHaveBeenCalledTimes(1);
  });

  it('cleans resources when the polling runner rejects during stop', async () => {
    const controller = new AbortController();
    const closeResources = vi.fn(async () => {});
    await expect(
      stopLongPolling(
        {
          stop: async () => {
            throw new Error('private runner diagnostic');
          },
        },
        controller,
        30_000,
        closeResources,
      ),
    ).resolves.toBe(false);
    expect(controller.signal.aborted).toBe(true);
    expect(closeResources).toHaveBeenCalledTimes(1);
  });

  it('applies one shutdown grace bound to both polling stop and process resource drain', async () => {
    const controller = new AbortController();
    const closeResources = vi.fn(async () => new Promise<void>(() => {}));
    const wait = vi.fn(async (_promise: Promise<void>, timeoutMs: number) => {
      expect(timeoutMs).toBe(25);
      expect(closeResources).toHaveBeenCalledTimes(1);
      return false;
    });
    const completed = await stopLongPolling(
      { stop: async () => {} },
      controller,
      25,
      closeResources,
      wait,
    );
    expect(completed).toBe(false);
    expect(controller.signal.aborted).toBe(true);
  });

  it('cancels queued and active jobs, aborts download work, cleans workspaces, and releases permits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shutdown-integration-'));
    try {
      const controller = new AbortController();
      const admission = new AdmissionControl({ maxActive: 1, maxQueued: 1 });
      const workspaceFactory = new TemporaryWorkspaceFactory({ parentDirectory: root });
      const create = vi.spyOn(workspaceFactory, 'create');
      let markDownloadStarted!: () => void;
      const downloadStarted = new Promise<void>((resolve) => {
        markDownloadStarted = resolve;
      });
      const downloader = {
        download: async ({ signal }: { signal: AbortSignal }) => {
          markDownloadStarted();
          if (!signal.aborted) {
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
          }
          throw applicationError('OperationCancelled', 'download');
        },
      };
      const delivery = { deliver: vi.fn(async () => ({ itemPosition: 1 })) };
      const app = new DownloadPostMedia({
        provider: {
          recognizes: () => true,
          validate: (url) => {
            const candidate = new URL(url);
            return { provider: 'x', postId: candidate.pathname, canonicalUrl: candidate };
          },
          resolve: async () => [discoveredMedia()],
        },
        downloader,
        processor: { prepare: vi.fn() },
        delivery,
        admission,
        workspaceFactory,
        selector: new RepresentationSelector(),
        limits: {
          maxMediaBytes: 51_380_224,
          jobTimeoutMs: 5_000,
          downloadTimeoutMs: 1_000,
          maxRedirects: 3,
        },
      });
      const input = (chatId: string) => ({
        destination: createDeliveryDestination(chatId),
        messageText: 'https://x.com/u/status/1',
        candidateUrl: 'https://x.com/u/status/1',
        requestId: createRequestId(),
        signal: controller.signal,
      });
      const active = app.execute(input('active-chat'));
      await downloadStarted;
      const queued = app.execute(input('queued-chat'));
      await vi.waitFor(() => expect(admission.snapshot()).toEqual({ active: 1, queued: 1 }));

      const stopped = await stopLongPolling(
        { stop: async () => {} },
        controller,
        30_000,
        async () => {},
        async (promise, timeoutMs) => {
          expect(timeoutMs).toBe(30_000);
          await promise;
          return true;
        },
      );
      expect(stopped).toBe(true);
      await expect(active).resolves.toMatchObject({
        kind: 'failed',
        errorCode: 'OperationCancelled',
      });
      await expect(queued).resolves.toMatchObject({
        kind: 'failed',
        errorCode: 'OperationCancelled',
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(delivery.deliver).not.toHaveBeenCalled();
      expect(admission.snapshot()).toEqual({ active: 0, queued: 0 });
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
