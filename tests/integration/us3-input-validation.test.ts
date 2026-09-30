import { describe, expect, it, vi } from 'vitest';
import { DownloadPostMedia } from '../../src/application/download-post-media.js';
import type { MediaProvider, ProcessRunnerPort } from '../../src/application/ports.js';
import { TemporaryWorkspaceFactory } from '../../src/infrastructure/temporary-workspace.js';
import { AdmissionControl } from '../../src/infrastructure/admission-control.js';
import { RepresentationSelector } from '../../src/media/representation-selector.js';
import { createTelegramMessageHandler } from '../../src/bot/telegram-bot.js';
import { applicationError } from '../../src/shared/errors.js';
import { XMediaProvider } from '../../src/providers/x/x-media-provider.js';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('US3 input validation integration', () => {
  it.each([
    'https://x.com/user/foo/../status/1',
    'https://x.com/user/./status/1',
    'https://x.com/user/%2e%2e/user/status/1',
    'https://x.com/user/.%2e/user/status/1',
    'https://x.com/user/%2e./user/status/1',
  ])('does not normalize an unsupported submitted path into a valid post URL: %s', async (url) => {
    const parent = await mkdtemp(join(tmpdir(), 'raw-url-validation-'));
    try {
      const runner: ProcessRunnerPort = {
        run: vi.fn(async () => ({
          stdout: '{"id":"1","formats":[]}',
          stderr: '',
          exitCode: 0,
          signal: null,
        })),
        checkVersion: vi.fn(async () => 'yt-dlp 2026.09.01'),
      };
      const provider = new XMediaProvider({
        runner,
        executable: 'yt-dlp',
        limits: {
          extractionTimeoutMs: 30_000,
          maxStdoutBytes: 1_048_576,
          maxStderrBytes: 65_536,
          maxMetadataBytes: 1_048_576,
        },
      });
      const app = new DownloadPostMedia({
        provider,
        downloader: { download: vi.fn() },
        processor: { prepare: vi.fn() },
        delivery: { deliver: vi.fn() },
        admission: new AdmissionControl({ maxActive: 1, maxQueued: 0 }),
        workspaceFactory: new TemporaryWorkspaceFactory({ parentDirectory: parent }),
        selector: new RepresentationSelector(),
        limits: {
          maxMediaBytes: 51_380_224,
          jobTimeoutMs: 115_000,
          downloadTimeoutMs: 60_000,
          maxRedirects: 3,
        },
      });
      const handler = createTelegramMessageHandler({ downloadPostMedia: app });
      const replies: string[] = [];

      await handler(
        { chatId: 1, text: url },
        async (text) => {
          replies.push(text);
        },
        new AbortController().signal,
      );

      expect(runner.run).not.toHaveBeenCalled();
      expect(replies).toEqual(['Send a supported HTTPS X/Twitter status URL.']);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('accepts a normal status URL through the Telegram, application, and provider path', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'raw-url-valid-'));
    try {
      const runner: ProcessRunnerPort = {
        run: vi.fn(async () => ({
          stdout: '{"id":"1","formats":[]}',
          stderr: '',
          exitCode: 0,
          signal: null,
        })),
        checkVersion: vi.fn(async () => 'yt-dlp 2026.09.01'),
      };
      const provider = new XMediaProvider({
        runner,
        executable: 'yt-dlp',
        limits: {
          extractionTimeoutMs: 30_000,
          maxStdoutBytes: 1_048_576,
          maxStderrBytes: 65_536,
          maxMetadataBytes: 1_048_576,
        },
      });
      const app = new DownloadPostMedia({
        provider,
        downloader: { download: vi.fn() },
        processor: { prepare: vi.fn() },
        delivery: { deliver: vi.fn() },
        admission: new AdmissionControl({ maxActive: 1, maxQueued: 0 }),
        workspaceFactory: new TemporaryWorkspaceFactory({ parentDirectory: parent }),
        selector: new RepresentationSelector(),
        limits: {
          maxMediaBytes: 51_380_224,
          jobTimeoutMs: 115_000,
          downloadTimeoutMs: 60_000,
          maxRedirects: 3,
        },
      });
      const handler = createTelegramMessageHandler({ downloadPostMedia: app });
      const replies: string[] = [];

      await handler(
        { chatId: 1, text: 'https://x.com/user/status/1' },
        async (text) => {
          replies.push(text);
        },
        new AbortController().signal,
      );

      expect(runner.run).toHaveBeenCalledOnce();
      expect(replies).toEqual(['No supported video or animated media was found in the post.']);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('rejects invalid and unsupported messages before retrieval or resource creation', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'input-validation-'));
    try {
      const provider: MediaProvider = {
        recognizes: (url) =>
          ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname),
        validate: vi.fn(() => {
          throw applicationError('UnsupportedPostUrl', 'input');
        }),
        resolve: vi.fn(async () => []),
      };
      const acquire = vi.fn(async () => {
        throw new Error('admission must not run');
      });
      const workspaceFactory = new TemporaryWorkspaceFactory({ parentDirectory: parent });
      const create = vi.spyOn(workspaceFactory, 'create');
      const app = new DownloadPostMedia({
        provider,
        downloader: { download: vi.fn() },
        processor: { prepare: vi.fn() },
        delivery: { deliver: vi.fn() },
        admission: { acquire },
        workspaceFactory,
        selector: new RepresentationSelector(),
        limits: {
          maxMediaBytes: 51_380_224,
          jobTimeoutMs: 115_000,
          downloadTimeoutMs: 60_000,
          maxRedirects: 3,
        },
      });
      const handler = createTelegramMessageHandler({ downloadPostMedia: app });
      const replies: string[] = [];
      const reply = async (text: string) => {
        replies.push(text);
      };
      const signal = new AbortController().signal;
      const messages = [
        'nothing here',
        'https://x.com/user/status/not-a-number',
        'https://x.com/explore',
        'https://example.org/user/status/1',
        'https://x.com/user/status/1 https://twitter.com/user/status/2',
        'https://x.com/u/status/1',
      ];

      for (const [index, text] of messages.entries()) {
        await handler({ chatId: index + 1, text }, reply, signal);
      }
      await handler({ chatId: 999 }, reply, signal);

      expect(replies).toHaveLength(messages.length);
      expect(replies.filter((text) => /supported.*status/i.test(text))).toHaveLength(4);
      expect(provider.resolve).not.toHaveBeenCalled();
      expect(acquire).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(await readdir(parent)).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
