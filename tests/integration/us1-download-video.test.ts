import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { InputFile } from 'grammy';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessRunnerPort } from '../../src/application/ports.js';
import type { ProcessExecution, ProcessExecutionResult } from '../../src/application/models.js';
import { createDeliveryDestination } from '../../src/application/models.js';
import { DownloadPostMedia } from '../../src/application/download-post-media.js';
import { createOperationContext } from '../../src/application/operation-context.js';
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

const roots: string[] = [];
const publicAddress = [{ address: '93.184.216.34', family: 4 as const }];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('US1 deterministic download integration', () => {
  it('delivers fixture media in source order, enforces caps, and removes its workspace', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'us1-integration-'));
    roots.push(parent);
    const fixture = await import('node:fs/promises').then(({ readFile }) =>
      readFile(new URL('../fixtures/x/video-post.json', import.meta.url), 'utf8'),
    );
    const processCalls: ProcessExecution[] = [];
    const processResult: ProcessExecutionResult = {
      stdout: fixture,
      stderr: '',
      exitCode: 0,
      signal: null,
    };
    const runner: ProcessRunnerPort = {
      run: vi.fn(async (request) => {
        processCalls.push(request);
        return processResult;
      }),
      checkVersion: vi.fn(async () => 'yt-dlp 2026.09.01'),
    };
    const requestedUrls: string[] = [];
    const requester: SafeHttpRequester = async (url, addresses, _timeout, _signal, headers) => {
      expect(addresses).toEqual(publicAddress);
      expect(headers['accept-encoding']).toBe('identity');
      requestedUrls.push(url.href);
      const body = Buffer.from(`media:${url.pathname}`);
      return {
        statusCode: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': String(body.byteLength) },
        body: Readable.from([body]),
        close: vi.fn(),
      };
    };
    const safeHttp = new SafeHttpClient({
      request: requester,
      resolveHostname: async () => publicAddress,
    });
    const sent: Array<{ destination: string; content: string }> = [];
    const telegram = new TelegramDelivery({
      api: {
        sendVideo: async (destination, file) => {
          sent.push({ destination, content: await readInputFile(file) });
        },
        sendAnimation: async () => {
          throw new Error('video fixture must use sendVideo');
        },
      },
      timeoutMs: 10_000,
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
      downloader: new SafeMediaDownloader({ httpClient: safeHttp }),
      processor: new DirectMediaProcessor({ maxMediaBytes: 51_380_224 }),
      delivery: telegram,
      admission: new AdmissionControl({ maxActive: 2, maxQueued: 8 }),
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
    const context = createOperationContext({
      requestId,
      signal: new AbortController().signal,
      jobTimeoutMs: 115_000,
    });

    const outcome = await app.execute({
      destination: createDeliveryDestination('-10012345'),
      messageText: 'send this https://x.com/user/status/100 please',
      candidateUrl: 'https://x.com/user/status/100',
      requestId,
      signal: new AbortController().signal,
    });
    context.dispose();

    expect(outcome).toMatchObject({ kind: 'complete', items: [{ position: 1 }, { position: 2 }] });
    expect(processCalls[0]?.args).toContain('--skip-download');
    expect(requestedUrls.map((url) => new URL(url).pathname)).toEqual([
      '/video-1-high.mp4',
      '/video-2.mp4',
    ]);
    expect(sent.map(({ content }) => content)).toEqual([
      'media:/video-1-high.mp4',
      'media:/video-2.mp4',
    ]);
    expect(sent.every(({ destination }) => destination === '-10012345')).toBe(true);
    expect(await readdir(parent)).toEqual([]);
  });
});

async function readInputFile(file: InputFile): Promise<string> {
  const value = await file.toRaw();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  const chunks: Uint8Array[] = [];
  for await (const chunk of value) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
