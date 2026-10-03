import { mkdtemp, readdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  MediaDownloader,
  MediaProcessor,
  MediaProvider,
  ProcessRunnerPort,
} from '../../src/application/ports.js';
import type { ProcessExecutionResult } from '../../src/application/models.js';
import { createDeliveryDestination, type DiscoveredMedia } from '../../src/application/models.js';
import { DownloadPostMedia } from '../../src/application/download-post-media.js';
import { AdmissionControl } from '../../src/infrastructure/admission-control.js';
import {
  SafeHttpClient,
  type SafeHttpRequester,
} from '../../src/infrastructure/safe-http-client.js';
import { TemporaryWorkspaceFactory } from '../../src/infrastructure/temporary-workspace.js';
import { DirectMediaProcessor } from '../../src/media/direct-media-processor.js';
import { RepresentationSelector } from '../../src/media/representation-selector.js';
import { SafeMediaDownloader } from '../../src/media/safe-media-downloader.js';
import { TelegramDelivery } from '../../src/bot/telegram-delivery.js';
import { XMediaProvider } from '../../src/providers/x/x-media-provider.js';
import { createRequestId } from '../../src/shared/identifiers.js';
import { discoveredMedia, preparedMedia } from '../support/builders.js';

const roots: string[] = [];
const publicAddress = [{ address: '93.184.216.34', family: 4 as const }];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('US2 animation integration', () => {
  it('keeps a GIF-labeled item with unknown audio on the MP4 video path', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'us2-integration-'));
    roots.push(parent);
    const stdout = await readFile(new URL('../fixtures/x/animation.json', import.meta.url), 'utf8');
    const processResult: ProcessExecutionResult = { stdout, stderr: '', exitCode: 0, signal: null };
    const runner: ProcessRunnerPort = {
      run: vi.fn(async () => processResult),
      checkVersion: vi.fn(async () => 'yt-dlp 2026.09.01'),
    };
    const requester: SafeHttpRequester = async (_url) => {
      const body = Buffer.from('animation bytes');
      return {
        statusCode: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': String(body.byteLength) },
        body: Readable.from([body]),
        close: vi.fn(),
      };
    };
    const sent: string[] = [];
    const delivery = new TelegramDelivery({
      api: {
        sendVideo: async (_destination, file) => {
          const value = await file.toRaw();
          if (value instanceof Uint8Array) {
            sent.push(Buffer.from(value).toString('utf8'));
            return;
          }
          const chunks: Uint8Array[] = [];
          for await (const chunk of value) chunks.push(chunk);
          sent.push(Buffer.concat(chunks).toString('utf8'));
        },
        sendAnimation: async () => {
          throw new Error('uncertain audio metadata must use sendVideo');
        },
      },
      timeoutMs: 5_000,
    });
    const app = new DownloadPostMedia({
      provider: new XMediaProvider({
        runner,
        executable: 'yt-dlp',
        limits: {
          extractionTimeoutMs: 30_000,
          maxStdoutBytes: 1_048_576,
          maxStderrBytes: 65_536,
          maxMetadataBytes: 1_048_576,
        },
      }),
      downloader: new SafeMediaDownloader({
        httpClient: new SafeHttpClient({
          request: requester,
          resolveHostname: async () => publicAddress,
        }),
      }),
      processor: new DirectMediaProcessor({ maxMediaBytes: 51_380_224 }),
      delivery,
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
    const requestId = createRequestId();

    const outcome = await app.execute({
      destination: createDeliveryDestination('-10012345'),
      messageText: 'https://x.com/user/status/2',
      candidateUrl: 'https://x.com/user/status/2',
      requestId,
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      kind: 'complete',
      items: [{ kind: 'delivered', position: 1 }],
    });
    expect(sent).toEqual(['animation bytes']);
    expect(await readdir(parent)).toEqual([]);
  });

  it('returns a safe processing failure for animation without direct MP4 and skips Telegram', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'us2-incompatible-'));
    roots.push(parent);
    const media: DiscoveredMedia = discoveredMedia({
      kind: 'animation',
      representations: [
        {
          ...discoveredMedia().representations[0]!,
          protocol: 'm3u8_native',
        },
      ],
    });
    const provider: MediaProvider = {
      recognizes: () => true,
      validate: () => ({
        provider: 'x',
        postId: '2',
        canonicalUrl: new URL('https://x.com/user/status/2'),
      }),
      resolve: async () => [media],
    };
    const downloader: MediaDownloader = {
      download: async () => {
        throw new Error('non-direct animation must be rejected before download');
      },
    };
    const processor: MediaProcessor = {
      prepare: async (value) => preparedMedia({ media: value }),
    };
    const api = {
      sendVideo: vi.fn(async () => undefined),
      sendAnimation: vi.fn(async () => undefined),
    };
    const app = new DownloadPostMedia({
      provider,
      downloader,
      processor,
      delivery: new TelegramDelivery({ api, timeoutMs: 5_000 }),
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

    const outcome = await app.execute({
      destination: createDeliveryDestination('-10012345'),
      messageText: 'https://x.com/user/status/2',
      candidateUrl: 'https://x.com/user/status/2',
      requestId: createRequestId(),
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'MediaProcessingFailed' });
    expect(api.sendAnimation).not.toHaveBeenCalled();
    expect(await readdir(parent)).toEqual([]);
  });
});
