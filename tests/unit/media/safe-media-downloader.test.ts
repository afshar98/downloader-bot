import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SafeHttpClientPort } from '../../../src/application/ports.js';
import { TemporaryWorkspaceFactory } from '../../../src/infrastructure/temporary-workspace.js';
import { applicationError } from '../../../src/shared/errors.js';
import { createRequestId } from '../../../src/shared/identifiers.js';
import { SafeMediaDownloader } from '../../../src/media/safe-media-downloader.js';
import { discoveredMedia, representation } from '../../support/builders.js';

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'downloader-media-test-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SafeMediaDownloader', () => {
  it('uses generated workspace paths and returns only a finalized bounded file', async () => {
    const parent = await createRoot();
    const factory = new TemporaryWorkspaceFactory({ parentDirectory: parent });
    const workspace = await factory.create(createRequestId());
    const http: SafeHttpClientPort = {
      downloadToFile: vi.fn(async ({ destinationPath }) => {
        await writeFile(destinationPath, 'video');
        return 5;
      }),
    };
    const downloader = new SafeMediaDownloader({ httpClient: http });

    const media = await downloader.download({
      media: discoveredMedia({ audioPresence: 'unknown' }),
      representation: representation(),
      workspace,
      limits: { maxMediaBytes: 10, timeoutMs: 1_000, maxRedirects: 3 },
      signal: new AbortController().signal,
    });

    expect(media).toMatchObject({
      mediaId: 'media-1',
      position: 1,
      kind: 'video',
      sizeBytes: 5,
      container: 'mp4',
      path: join(workspace.root, 'item-0001.mp4'),
      audioPresence: 'unknown',
    });
    expect(await readFile(media.path, 'utf8')).toBe('video');
    expect(await readdir(workspace.root)).toEqual(['item-0001.mp4']);
    expect(http.downloadToFile).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://media.example.invalid/video.mp4',
        destinationPath: join(workspace.root, 'item-0001.part'),
        maxBytes: 10,
      }),
    );
    await factory.cleanup(workspace);
  });

  it('removes partial files and preserves typed size and cancellation errors', async () => {
    const parent = await createRoot();
    const factory = new TemporaryWorkspaceFactory({ parentDirectory: parent });
    const workspace = await factory.create(createRequestId());
    const tooLarge: SafeHttpClientPort = {
      downloadToFile: async ({ destinationPath }) => {
        await writeFile(destinationPath, 'partial');
        throw applicationError('MediaTooLarge', 'download');
      },
    };
    const downloader = new SafeMediaDownloader({ httpClient: tooLarge });

    await expect(
      downloader.download({
        media: discoveredMedia(),
        representation: representation(),
        workspace,
        limits: { maxMediaBytes: 5, timeoutMs: 1_000, maxRedirects: 3 },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'MediaTooLarge' });
    expect(await readdir(workspace.root)).toEqual([]);

    const cancelled: SafeHttpClientPort = {
      downloadToFile: async () => {
        throw applicationError('OperationCancelled', 'download');
      },
    };
    await expect(
      new SafeMediaDownloader({ httpClient: cancelled }).download({
        media: discoveredMedia(),
        representation: representation(),
        workspace,
        limits: { maxMediaBytes: 5, timeoutMs: 1_000, maxRedirects: 3 },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'OperationCancelled' });
    await factory.cleanup(workspace);
  });

  it('maps untyped stream failures to MediaDownloadFailed and removes the partial', async () => {
    const parent = await createRoot();
    const factory = new TemporaryWorkspaceFactory({ parentDirectory: parent });
    const workspace = await factory.create(createRequestId());
    const http: SafeHttpClientPort = {
      downloadToFile: async ({ destinationPath }) => {
        await writeFile(destinationPath, 'partial');
        throw new Error('socket disconnected');
      },
    };

    await expect(
      new SafeMediaDownloader({ httpClient: http }).download({
        media: discoveredMedia(),
        representation: representation(),
        workspace,
        limits: { maxMediaBytes: 50, timeoutMs: 1_000, maxRedirects: 3 },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'MediaDownloadFailed' });
    expect(await readdir(workspace.root)).toEqual([]);
    await factory.cleanup(workspace);
  });
});
