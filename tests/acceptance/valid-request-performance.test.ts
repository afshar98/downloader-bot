import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  MediaDelivery,
  MediaDownloader,
  MediaProcessor,
  MediaProvider,
} from '../../src/application/ports.js';
import { type DiscoveredMedia } from '../../src/application/models.js';
import { DownloadPostMedia } from '../../src/application/download-post-media.js';
import { AdmissionControl } from '../../src/infrastructure/admission-control.js';
import { TemporaryWorkspaceFactory } from '../../src/infrastructure/temporary-workspace.js';
import { RepresentationSelector } from '../../src/media/representation-selector.js';
import { createTelegramMessageHandler } from '../../src/bot/telegram-bot.js';
import {
  fakeClock,
  downloadedMedia,
  discoveredMedia,
  preparedMedia,
  representation,
} from '../support/builders.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SC-002 valid request performance', () => {
  it('completes 100 bounded fixture requests with two active jobs and no live network', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'valid-acceptance-'));
    roots.push(parent);
    const clock = fakeClock();
    let nextMedia = 0;
    let active = 0;
    let maxActive = 0;
    const provider: MediaProvider = {
      recognizes: () => true,
      validate: () => ({
        provider: 'x',
        postId: '1',
        canonicalUrl: new URL('https://x.com/user/status/1'),
      }),
      resolve: async () => {
        clock.advance(1);
        const count = (nextMedia++ % 4) + 1;
        return Array.from({ length: count }, (_unused, index): DiscoveredMedia =>
          discoveredMedia({
            mediaId: `request-${nextMedia}-media-${index + 1}`,
            position: index + 1,
            representations: [representation({ sizeBytes: 1024 * 1024 })],
          }),
        );
      },
    };
    const downloader: MediaDownloader = {
      download: async ({ media }) => {
        clock.advance(1);
        return downloadedMedia({
          mediaId: media.mediaId,
          position: media.position,
          sizeBytes: 1024 * 1024,
        });
      },
    };
    const processor: MediaProcessor = {
      prepare: async (media) => {
        clock.advance(1);
        return preparedMedia({ media });
      },
    };
    const delivery: MediaDelivery = {
      deliver: async (_destination, media) => {
        clock.advance(1);
        return { itemPosition: media.downloaded.position };
      },
    };
    const admission = new AdmissionControl({ maxActive: 2, maxQueued: 8 });
    const app = new DownloadPostMedia({
      provider,
      downloader,
      processor,
      delivery,
      admission,
      workspaceFactory: new TemporaryWorkspaceFactory({ parentDirectory: parent }),
      selector: new RepresentationSelector(),
      limits: {
        maxMediaBytes: 51_380_224,
        jobTimeoutMs: 115_000,
        downloadTimeoutMs: 60_000,
        maxRedirects: 3,
      },
    });
    const durations: number[] = [];
    const outcomes: Array<Promise<void>> = [];
    const handler = createTelegramMessageHandler({ downloadPostMedia: app });

    for (let batch = 0; batch < 50; batch += 1) {
      const requests = Array.from({ length: 2 }, async () => {
        const startedAt = clock.now();
        active += 1;
        maxActive = Math.max(maxActive, active);
        await handler(
          { chatId: `chat-${batch}-${active}`, text: 'https://x.com/user/status/1' },
          async () => undefined,
          new AbortController().signal,
        );
        durations.push(clock.now() - startedAt);
        active -= 1;
      });
      outcomes.push(...requests);
      await Promise.all(requests);
      expect(admission.snapshot()).toEqual({ active: 0, queued: 0 });
    }
    await Promise.all(outcomes);
    durations.sort((left, right) => left - right);
    const p95 = durations[Math.ceil(0.95 * durations.length) - 1] ?? Number.POSITIVE_INFINITY;

    expect(durations).toHaveLength(100);
    expect(maxActive).toBe(2);
    expect(p95).toBeLessThanOrEqual(120_000);
    expect(await readdir(parent)).toEqual([]);
  });
});
