import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DownloadPostMedia } from '../../src/application/download-post-media.js';
import { createDeliveryDestination, type DiscoveredMedia } from '../../src/application/models.js';
import type { MediaDelivery, MediaProvider } from '../../src/application/ports.js';
import { AdmissionControl } from '../../src/infrastructure/admission-control.js';
import { TemporaryWorkspaceFactory } from '../../src/infrastructure/temporary-workspace.js';
import { RepresentationSelector } from '../../src/media/representation-selector.js';
import { applicationError } from '../../src/shared/errors.js';
import { createRequestId } from '../../src/shared/identifiers.js';
const MAX_MEDIA_BYTES = 49 * 1024 * 1024;
import {
  discoveredMedia,
  downloadedMedia,
  preparedMedia,
  representation,
  fakeClock,
} from '../support/builders.js';

type Scenario =
  | 'success'
  | 'item-failure'
  | 'no-direct'
  | 'at-limit'
  | 'over-limit'
  | 'duplicate'
  | 'timeout'
  | 'cancelled'
  | 'busy';
type Entry = { postId: string; scenario: Scenario; gate?: boolean };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('SC-005 mixed request isolation acceptance', () => {
  it('processes the exact 100-request workload with bounded admission and isolated cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mixed-acceptance-'));
    try {
      const entries: Entry[] = [
        ...Array.from({ length: 2 }, (_, i): Entry => ({
          postId: `gate-${i}`,
          scenario: 'success',
          gate: true,
        })),
        ...Array.from({ length: 8 }, (_, i): Entry => ({
          postId: `queued-${i}`,
          scenario: 'success',
        })),
        ...Array.from({ length: 5 }, (_, i): Entry => ({ postId: `busy-${i}`, scenario: 'busy' })),
        ...Array.from({ length: 30 }, (_, i): Entry => ({
          postId: `success-${i}`,
          scenario: 'success',
        })),
        ...Array.from({ length: 15 }, (_, i): Entry => ({
          postId: `failure-${i}`,
          scenario: 'item-failure',
        })),
        ...Array.from({ length: 10 }, (_, i): Entry => ({
          postId: `unsupported-${i}`,
          scenario: 'no-direct',
        })),
        ...Array.from({ length: 5 }, (_, i): Entry => ({
          postId: `limit-${i}`,
          scenario: 'at-limit',
        })),
        ...Array.from({ length: 5 }, (_, i): Entry => ({
          postId: `over-${i}`,
          scenario: 'over-limit',
        })),
        ...Array.from({ length: 5 }, (_, i): Entry => ({
          postId: `duplicate-${i}`,
          scenario: 'duplicate',
        })),
        ...Array.from({ length: 5 }, (_, i): Entry => ({
          postId: `duplicate-${i}`,
          scenario: 'duplicate',
        })),
        ...Array.from({ length: 5 }, (_, i): Entry => ({
          postId: `timeout-${i}`,
          scenario: 'timeout',
        })),
        ...Array.from({ length: 5 }, (_, i): Entry => ({
          postId: `cancel-${i}`,
          scenario: 'cancelled',
        })),
      ];
      expect(entries).toHaveLength(100);
      const byPostId = new Map(entries.map((entry) => [entry.postId, entry]));
      const gate = deferred();
      const activeGate = new Set(['gate-0', 'gate-1']);
      const roots: string[] = [];
      const paths: string[] = [];
      const processChildren: Array<{ close: ReturnType<typeof vi.fn> }> = [];
      const httpResponses: Array<{ close: ReturnType<typeof vi.fn> }> = [];
      const clock = fakeClock();
      let removeAttempts = 0;
      const cleanupLogger = { error: vi.fn() };
      const destinations: string[] = [];
      const expectedDestinationByRequest = new Map<string, string>();
      const terminalDurations: number[] = [];
      const provider: MediaProvider = {
        recognizes: () => true,
        validate: (url) => {
          const candidate = new URL(url);
          return {
            provider: 'x',
            postId: candidate.pathname.split('/').at(-1) ?? '',
            canonicalUrl: candidate,
          };
        },
        resolve: async (post) => {
          const child = { close: vi.fn(async () => {}) };
          processChildren.push(child);
          try {
            if (activeGate.has(post.postId)) await gate.promise;
            const scenario = byPostId.get(post.postId)?.scenario ?? 'success';
            if (scenario === 'timeout' || scenario === 'cancelled') {
              return [media(post.postId, 1, 'success'), media(post.postId, 2, scenario)];
            }
            return [media(post.postId, 1, scenario)];
          } finally {
            await child.close();
          }
        },
      };
      const admission = new AdmissionControl({ maxActive: 2, maxQueued: 8 });
      const workspaceFactory = new TemporaryWorkspaceFactory({
        parentDirectory: root,
        logger: cleanupLogger,
        removeDirectory: async (path) => {
          removeAttempts += 1;
          if (removeAttempts === 1) throw new Error(`temporary path: ${path}`);
          await rm(path, { recursive: true, force: true });
        },
      });
      const create = vi.spyOn(workspaceFactory, 'create');
      const downloader = {
        download: async ({
          media: item,
          workspace,
        }: {
          media: DiscoveredMedia;
          workspace: { root: string; itemPaths(position: number): { mediaPath: string } };
        }) => {
          const response = { close: vi.fn(async () => {}) };
          httpResponses.push(response);
          try {
            if (!roots.includes(workspace.root)) roots.push(workspace.root);
            paths.push(workspace.itemPaths(item.position).mediaPath);
            const sizeBytes = item.representations[0]?.sizeBytes ?? 8;
            if (item.mediaId.endsWith('item-failure'))
              throw applicationError('MediaDownloadFailed', 'download');
            return downloadedMedia({ mediaId: item.mediaId, position: item.position, sizeBytes });
          } finally {
            await response.close();
          }
        },
      };
      const delivery: MediaDelivery = {
        deliver: async (_destination, item, context) => {
          destinations.push(_destination);
          expect(_destination).toBe(expectedDestinationByRequest.get(context.requestId));
          clock.advance(1);
          const [postId] = item.downloaded.mediaId.split(':');
          const scenario = byPostId.get(postId ?? '')?.scenario;
          if (item.downloaded.position === 2 && scenario === 'timeout')
            throw applicationError('OperationTimedOut', 'delivery');
          if (item.downloaded.position === 2 && scenario === 'cancelled')
            throw applicationError('OperationCancelled', 'delivery');
          if (activeGate.has(postId ?? '')) await gate.promise;
          return { itemPosition: item.downloaded.position };
        },
      };
      const app = new DownloadPostMedia({
        provider,
        downloader,
        processor: { prepare: async (downloaded) => preparedMedia({ media: downloaded }) },
        delivery,
        admission,
        workspaceFactory,
        selector: new RepresentationSelector(),
        limits: {
          maxMediaBytes: MAX_MEDIA_BYTES,
          jobTimeoutMs: 5_000,
          downloadTimeoutMs: 500,
          maxRedirects: 3,
        },
      });
      const requests = entries.map((entry, index) => {
        const requestId = createRequestId();
        const destination = `chat-${index}`;
        expectedDestinationByRequest.set(requestId, destination);
        return {
          destination: createDeliveryDestination(destination),
          messageText: `https://x.com/u/status/${entry.postId}`,
          candidateUrl: `https://x.com/u/status/${entry.postId}`,
          requestId,
          signal: new AbortController().signal,
        };
      });
      const runRequest = async (request: (typeof requests)[number]) => {
        const startedAt = clock.now();
        const outcome = await app.execute(request);
        terminalDurations.push(clock.now() - startedAt);
        return outcome;
      };
      const firstBatch = requests.slice(0, 15).map(runRequest);
      await vi.waitFor(() => expect(admission.snapshot()).toEqual({ active: 2, queued: 8 }));
      const firstOutcomes = await Promise.all(firstBatch.slice(10));
      expect(firstOutcomes).toHaveLength(5);
      expect(
        firstOutcomes.every(
          (outcome) => outcome.kind === 'rejected' && outcome.errorCode === 'ServiceBusy',
        ),
      ).toBe(true);
      gate.resolve();
      const acceptedFirst = await Promise.all(firstBatch.slice(0, 10));
      const rest: Awaited<ReturnType<typeof app.execute>>[] = [];
      for (let index = 15; index < requests.length; index += 10) {
        rest.push(...(await Promise.all(requests.slice(index, index + 10).map(runRequest))));
      }
      const outcomes = [...acceptedFirst, ...firstOutcomes, ...rest];
      expect(outcomes).toHaveLength(100);
      const counts = outcomes.reduce<Record<string, number>>((result, outcome) => {
        const key =
          outcome.kind === 'failed' || outcome.kind === 'rejected'
            ? outcome.errorCode
            : outcome.kind;
        result[key] = (result[key] ?? 0) + 1;
        return result;
      }, {});
      expect(counts['complete']).toBe(55);
      expect(counts['MediaDownloadFailed']).toBe(15);
      expect(counts['MediaProcessingFailed']).toBe(10);
      expect(counts['MediaTooLarge']).toBe(5);
      expect(counts['partial']).toBe(10);
      expect(counts['ServiceBusy']).toBe(5);
      expect(create).toHaveBeenCalledTimes(95);
      expect(processChildren.length).toBe(95);
      expect(processChildren.every((child) => child.close.mock.calls.length === 1)).toBe(true);
      expect(httpResponses.every((response) => response.close.mock.calls.length === 1)).toBe(true);
      expect(clock.now()).toBe(destinations.length);
      expect(terminalDurations).toHaveLength(100);
      expect(
        terminalDurations.every((duration) => Number.isFinite(duration) && duration >= 0),
      ).toBe(true);
      expect(removeAttempts).toBe(96);
      expect(JSON.stringify(cleanupLogger.error.mock.calls)).not.toContain(root);
      expect(new Set(roots).size).toBe(roots.length);
      expect(new Set(paths).size).toBe(paths.length);
      expect(new Set(destinations).size).toBe(65);
      expect(destinations.every((destination) => /^chat-\d+$/.test(destination))).toBe(true);
      expect(admission.snapshot()).toEqual({ active: 0, queued: 0 });
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function media(postId: string, position: number, scenario: Scenario): DiscoveredMedia {
  const representationValue =
    scenario === 'no-direct'
      ? representation({ protocol: 'm3u8_native', container: 'webm' })
      : scenario === 'at-limit'
        ? representation({ sizeBytes: MAX_MEDIA_BYTES })
        : scenario === 'over-limit'
          ? representation({ sizeBytes: MAX_MEDIA_BYTES + 1 })
          : representation({ sizeBytes: 8 });
  return discoveredMedia({
    mediaId: `${postId}:${position}:${scenario}`,
    position,
    representations: [representationValue],
  });
}
