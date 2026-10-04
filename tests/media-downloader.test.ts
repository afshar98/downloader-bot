import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Response } from 'undici';
import { describe, expect, it, vi } from 'vitest';
import { MediaDownloader } from '../src/media-downloader.js';
import { createTemporaryWorkspace } from '../src/temporary-workspace.js';
import type { SourceMedia } from '../src/x-media-provider.js';

const source: SourceMedia = {
  url: 'https://video.twimg.com/clip.mp4',
  container: 'mp4',
  width: 320,
  height: 320,
  expectedSizeBytes: 4,
};

const publicAddress = [{ address: '93.184.216.34', family: 4 }];

describe('MediaDownloader', () => {
  it('follows bounded HTTPS CDN redirects and streams the source to disk', async () => {
    const workspace = await createTemporaryWorkspace();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://video-cf.twimg.com/clip.mp4' },
        }),
      )
      .mockResolvedValueOnce(new Response('GIF? no, source bytes', { status: 200 }));
    const downloader = new MediaDownloader({
      maxBytes: 64,
      fetcher,
      resolveHost: async () => publicAddress,
    });

    try {
      const downloaded = await downloader.download(
        source,
        workspace.sourcePath,
        new AbortController().signal,
      );

      expect(downloaded.sizeBytes).toBe(21);
      expect(await readFile(downloaded.path, 'utf8')).toBe('GIF? no, source bytes');
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      await workspace.dispose();
    }
  });

  it.each(['127.0.0.1', '10.0.0.5', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1'])(
    'rejects a CDN hostname that resolves to a non-public IP (%s)',
    async (address) => {
      const workspace = await createTemporaryWorkspace();
      const fetcher = vi.fn(async () => new Response('should not be fetched'));
      const downloader = new MediaDownloader({
        maxBytes: 64,
        fetcher,
        resolveHost: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
      });

      try {
        await expect(
          downloader.download(source, workspace.sourcePath, new AbortController().signal),
        ).rejects.toMatchObject({ code: 'unsafe-media-url' });
        expect(fetcher).not.toHaveBeenCalled();
      } finally {
        await workspace.dispose();
      }
    },
  );

  it('rejects a redirect to a private destination before following it', async () => {
    const workspace = await createTemporaryWorkspace();
    const fetcher = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/internal' } }),
    );
    const downloader = new MediaDownloader({
      maxBytes: 64,
      fetcher,
      resolveHost: async () => publicAddress,
    });

    try {
      await expect(
        downloader.download(source, workspace.sourcePath, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'unsafe-media-url' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await workspace.dispose();
    }
  });

  it('rejects non-success responses', async () => {
    const workspace = await createTemporaryWorkspace();
    const downloader = new MediaDownloader({
      maxBytes: 64,
      fetcher: async () => new Response('denied', { status: 404 }),
      resolveHost: async () => publicAddress,
    });

    try {
      await expect(
        downloader.download(source, workspace.sourcePath, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'download-failed' });
    } finally {
      await workspace.dispose();
    }
  });

  it('rejects a declared content length over the download limit', async () => {
    const workspace = await createTemporaryWorkspace();
    const downloader = new MediaDownloader({
      maxBytes: 8,
      fetcher: async () =>
        new Response('123456789', { status: 200, headers: { 'content-length': '9' } }),
      resolveHost: async () => publicAddress,
    });

    try {
      await expect(
        downloader.download(source, workspace.sourcePath, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'media-too-large' });
    } finally {
      await workspace.dispose();
    }
  });

  it('rejects streamed bytes over the download limit and removes the partial file', async () => {
    const workspace = await createTemporaryWorkspace();
    const downloader = new MediaDownloader({
      maxBytes: 8,
      fetcher: async () => new Response('123456789', { status: 200 }),
      resolveHost: async () => publicAddress,
    });

    try {
      await expect(
        downloader.download(source, workspace.sourcePath, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'media-too-large' });
      await expect(stat(workspace.sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await workspace.dispose();
    }
  });

  it('rejects a truncated response and removes the partial file', async () => {
    const workspace = await createTemporaryWorkspace();
    const downloader = new MediaDownloader({
      maxBytes: 64,
      fetcher: async () =>
        new Response('short', { status: 200, headers: { 'content-length': '12' } }),
      resolveHost: async () => publicAddress,
    });

    try {
      await expect(
        downloader.download(source, workspace.sourcePath, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'download-failed' });
      await expect(stat(workspace.sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await workspace.dispose();
    }
  });

  it('stops reading a response body when the request is cancelled', async () => {
    const workspace = await createTemporaryWorkspace();
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new Uint8Array([1, 2, 3]));
      },
    });
    const downloader = new MediaDownloader({
      maxBytes: 64,
      fetcher: async () => new Response(body, { status: 200 }),
      resolveHost: async () => publicAddress,
    });
    const operation = downloader.download(source, workspace.sourcePath, controller.signal);
    const timeout = setTimeout(() => controller.abort(), 20);

    try {
      const result = await Promise.race([
        operation,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('body read did not stop')), 200),
        ),
      ]);
      throw new Error(`expected cancellation, got ${JSON.stringify(result)}`);
    } catch (error) {
      expect(error).toMatchObject({ code: 'cancelled' });
      await expect(stat(workspace.sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      clearTimeout(timeout);
      await workspace.dispose();
    }
  });

  it('disposes a private request workspace idempotently', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'xgif-test-'));
    const workspace = await createTemporaryWorkspace(parent);
    await writeFile(workspace.sourcePath, 'temporary');

    try {
      expect((await stat(workspace.rootPath)).mode & 0o777).toBe(0o700);
      await workspace.dispose();
      await workspace.dispose();
      await expect(stat(workspace.rootPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
