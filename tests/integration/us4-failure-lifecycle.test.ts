import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DownloadPostMedia } from '../../src/application/download-post-media.js';
import { createDeliveryDestination, type DiscoveredMedia } from '../../src/application/models.js';
import type { LifecycleLogger, MediaDelivery, MediaProvider } from '../../src/application/ports.js';
import { AdmissionControl } from '../../src/infrastructure/admission-control.js';
import { TemporaryWorkspaceFactory } from '../../src/infrastructure/temporary-workspace.js';
import { RepresentationSelector } from '../../src/media/representation-selector.js';
import { applicationError } from '../../src/shared/errors.js';
import { outcomeCopy } from '../../src/bot/telegram-bot.js';
import { createRequestId } from '../../src/shared/identifiers.js';
import { discoveredMedia, downloadedMedia, preparedMedia } from '../support/builders.js';

async function createRoot() {
  return mkdtemp(join(tmpdir(), 'us4-lifecycle-'));
}

function makeApp(input: {
  provider: MediaProvider;
  delivery: MediaDelivery;
  root: string;
  logger?: LifecycleLogger;
}) {
  const workspaceFactory = new TemporaryWorkspaceFactory({ parentDirectory: input.root });
  const app = new DownloadPostMedia({
    provider: input.provider,
    downloader: {
      download: async ({ media, workspace }) =>
        downloadedMedia({
          mediaId: media.mediaId,
          position: media.position,
          path: workspace.itemPaths(media.position).mediaPath,
        }),
    },
    processor: { prepare: async (media) => preparedMedia({ media }) },
    delivery: input.delivery,
    admission: new AdmissionControl({ maxActive: 2, maxQueued: 8 }),
    workspaceFactory,
    selector: new RepresentationSelector(),
    limits: {
      maxMediaBytes: 51_380_224,
      jobTimeoutMs: 5_000,
      downloadTimeoutMs: 1_000,
      maxRedirects: 3,
    },
    ...(input.logger ? { logger: input.logger } : {}),
  });
  return app;
}

function providerFor(media: (postId: string) => readonly DiscoveredMedia[]): MediaProvider {
  return {
    recognizes: () => true,
    validate: (url) => {
      const candidate = new URL(url);
      return {
        provider: 'x',
        postId: candidate.pathname.split('/').at(-1) ?? '',
        canonicalUrl: candidate,
      };
    },
    resolve: async (post) => media(post.postId),
  };
}

function request(postId: string, chat: string) {
  return {
    destination: createDeliveryDestination(chat),
    messageText: `https://x.com/u/status/${postId}`,
    candidateUrl: `https://x.com/u/status/${postId}`,
    requestId: createRequestId(),
    signal: new AbortController().signal,
  };
}

describe('US4 failure and request isolation integration', () => {
  it('continues on ordinary item failures but stops and suppresses summaries for unavailable destinations', async () => {
    const root = await createRoot();
    try {
      const items = [1, 2, 3].map((position) =>
        discoveredMedia({ position, mediaId: `item-${position}` }),
      );
      const ordinaryCalls: number[] = [];
      const ordinary = makeApp({
        root,
        provider: providerFor(() => items),
        delivery: {
          deliver: async (_destination, media) => {
            const position = media.downloaded.position;
            ordinaryCalls.push(position);
            if (position === 2) throw applicationError('TelegramDeliveryFailed', 'delivery');
            return { itemPosition: position };
          },
        },
      });
      const normalOutcome = await ordinary.execute(request('ordinary', 'chat-ordinary'));
      expect(normalOutcome).toMatchObject({
        kind: 'partial',
        deliveredCount: 2,
        failedPositions: [2],
      });
      expect(ordinaryCalls).toEqual([1, 2, 3]);

      const logs: unknown[] = [];
      const logger: LifecycleLogger = {
        info: (fields) => logs.push(fields),
        warn: (fields) => logs.push(fields),
        error: (fields) => logs.push(fields),
      };
      const destinationCalls: number[] = [];
      const unavailable = makeApp({
        root,
        logger,
        provider: providerFor(() => items),
        delivery: {
          deliver: async (_destination, media) => {
            const position = media.downloaded.position;
            destinationCalls.push(position);
            if (position === 2)
              throw applicationError('DeliveryDestinationUnavailable', 'delivery');
            return { itemPosition: position };
          },
        },
      });
      const unavailableOutcome = await unavailable.execute(
        request('blocked', 'private-chat-identifier'),
      );
      expect(unavailableOutcome).toMatchObject({
        kind: 'failed',
        errorCode: 'DeliveryDestinationUnavailable',
      });
      expect(destinationCalls).toEqual([1, 2]);
      expect(outcomeCopy(unavailableOutcome)).toBeUndefined();
      expect(JSON.stringify(logs)).not.toContain('private-chat-identifier');
      expect(JSON.stringify(logs)).not.toContain('/tmp/');
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps overlapping jobs bound to separate workspaces and their own chats', async () => {
    const root = await createRoot();
    try {
      const assignments = new Map<string, string>();
      const delivered: Array<{ destination: string; path: string }> = [];
      let resolveBarrier!: () => void;
      const barrier = new Promise<void>((resolve) => {
        resolveBarrier = resolve;
      });
      let arrived = 0;
      const app = makeApp({
        root,
        provider: providerFor((postId) => [discoveredMedia({ mediaId: postId, position: 1 })]),
        delivery: {
          deliver: async (destination, media) => {
            const path = media.downloaded.path;
            const owner = path.includes('xmd-') ? (path.split('/').slice(-2, -1)[0] ?? '') : '';
            assignments.set(destination.includes('chat-a') ? 'alpha' : 'beta', owner);
            arrived += 1;
            if (arrived === 2) resolveBarrier();
            await barrier;
            delivered.push({ destination, path });
            return { itemPosition: media.downloaded.position };
          },
        },
      });
      const [alpha, beta] = await Promise.all([
        app.execute(request('alpha', 'chat-alpha')),
        app.execute(request('beta', 'chat-beta')),
      ]);
      expect(alpha.kind).toBe('complete');
      expect(beta.kind).toBe('complete');
      expect(delivered).toHaveLength(2);
      expect(new Set(delivered.map((entry) => entry.path)).size).toBe(2);
      expect(delivered.map((entry) => entry.destination).sort()).toEqual([
        'chat-alpha',
        'chat-beta',
      ]);
      expect(assignments.get('alpha')).not.toBe(assignments.get('beta'));
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
