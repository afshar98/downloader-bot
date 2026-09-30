import { describe, expect, it, vi } from 'vitest';
import { DownloadPostMedia } from '../../src/application/download-post-media.js';
import type { MediaProvider } from '../../src/application/ports.js';
import { AdmissionControl } from '../../src/infrastructure/admission-control.js';
import { RepresentationSelector } from '../../src/media/representation-selector.js';
import { createTelegramMessageHandler } from '../../src/bot/telegram-bot.js';
import { createRequestId } from '../../src/shared/identifiers.js';
import { applicationError } from '../../src/shared/errors.js';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('SC-003 input validation acceptance', () => {
  it('handles 100 invalid/unsupported messages with bounded concurrency and no retrieval resources', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'input-acceptance-'));
    try {
      let now = 0;
      const entries = new Map<number, number>();
      const durations: number[] = [];
      const replies = new Map<number, string>();
      let active = 0;
      let peak = 0;
      const resolve = vi.fn(async () => []);
      const provider: MediaProvider = {
        recognizes: (url) =>
          ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname),
        validate: vi.fn(() => {
          throw applicationError('UnsupportedPostUrl', 'input');
        }),
        resolve,
      };
      const admission = new AdmissionControl({ maxActive: 2, maxQueued: 8 });
      const create = vi.fn();
      const downloader = { download: vi.fn() };
      const processor = { prepare: vi.fn() };
      const delivery = { deliver: vi.fn() };
      const app = new DownloadPostMedia({
        provider,
        downloader,
        processor,
        delivery,
        admission,
        workspaceFactory: { create, cleanup: vi.fn() },
        selector: new RepresentationSelector(),
        limits: {
          maxMediaBytes: 51_380_224,
          jobTimeoutMs: 115_000,
          downloadTimeoutMs: 60_000,
          maxRedirects: 3,
        },
      });
      const handler = createTelegramMessageHandler({
        downloadPostMedia: app,
        createRequestId: () => createRequestId(() => `acceptance_${++now}`),
      });
      const messages = Array.from({ length: 100 }, (_, index) => {
        switch (index % 5) {
          case 0:
            return 'no URL here';
          case 1:
            return 'https://example.org/user/status/1';
          case 2:
            return 'https://x.com/explore';
          case 3:
            return 'https://x.com/user/status/1 https://t.co/abc';
          default:
            return 'https://[';
        }
      });
      const run = async (index: number) => {
        const started = now;
        const text = messages[index];
        if (text === undefined) throw new Error('missing acceptance message');
        entries.set(index, started);
        active += 1;
        peak = Math.max(peak, active);
        await handler(
          { chatId: index + 1, text },
          async (text) => {
            replies.set(index, text);
            now += 20;
          },
          new AbortController().signal,
        );
        active -= 1;
        durations.push(now - started);
      };
      for (let index = 0; index < messages.length; index += 2) {
        await Promise.all([run(index), run(index + 1)]);
      }

      durations.sort((a, b) => a - b);
      const p95 = durations[Math.ceil(0.95 * durations.length) - 1];
      expect(durations).toHaveLength(100);
      expect(p95).toBeLessThanOrEqual(5_000);
      expect(Math.max(...durations)).toBeLessThanOrEqual(100);
      expect(peak).toBe(2);
      expect(resolve).not.toHaveBeenCalled();
      expect(provider.validate).toHaveBeenCalledTimes(20);
      expect(
        [...replies.entries()]
          .filter(([index]) => index % 5 === 4)
          .every(([, text]) => text.includes('one valid URL')),
      ).toBe(true);
      expect(create).not.toHaveBeenCalled();
      expect(downloader.download).not.toHaveBeenCalled();
      expect(processor.prepare).not.toHaveBeenCalled();
      expect(delivery.deliver).not.toHaveBeenCalled();
      expect(admission.snapshot()).toEqual({ active: 0, queued: 0 });
      expect(await readdir(parent)).toEqual([]);
      expect(entries.size).toBe(100);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
