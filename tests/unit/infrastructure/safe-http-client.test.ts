import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { MockAgent } from 'undici';
import type { LookupFunction } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SafeHttpClient,
  type SafeHttpResponse,
  type SafeHttpRequester,
} from '../../../src/infrastructure/safe-http-client.js';
import { applicationError } from '../../../src/shared/errors.js';

const PUBLIC = [{ address: '93.184.216.34', family: 4 as const }];
const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'downloader-http-test-'));
  roots.push(root);
  return root;
}

function response(
  statusCode = 200,
  headers: Record<string, string | string[] | undefined> = {
    'content-type': 'video/mp4',
  },
  data: readonly (string | Buffer)[] = ['video'],
): SafeHttpResponse {
  return { statusCode, headers, body: Readable.from(data), close: vi.fn(async () => {}) };
}

function client(
  options: {
    addresses?: readonly { address: string; family: 4 | 6 }[];
    responses?: SafeHttpResponse[];
    resolve?: (hostname: string) => Promise<readonly { address: string; family: 4 | 6 }[]>;
    maxRedirects?: number;
  } = {},
): { instance: SafeHttpClient; requests: Array<{ url: string; headers: Record<string, string> }> } {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const queue = [...(options.responses ?? [response()])];
  const request: SafeHttpRequester = async (url, _addresses, _timeoutMs, _signal, headers) => {
    requests.push({ url: url.href, headers });
    const item = queue.shift();
    if (!item) throw new Error('unexpected request');
    return item;
  };
  return {
    instance: new SafeHttpClient({
      request,
      resolveHostname: options.resolve ?? (async () => options.addresses ?? PUBLIC),
      maxRedirects: options.maxRedirects ?? 3,
    }),
    requests,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SafeHttpClient', () => {
  it('keeps MediaTooLarge primary and logs cleanup failure without the file path', async () => {
    const root = await createRoot();
    const destination = join(root, 'too-large.part');
    const logger = { error: vi.fn() };
    const cleanup = vi.fn(async () => {
      throw new Error(`cannot unlink ${destination}`);
    });
    const safe = new SafeHttpClient({
      resolveHostname: async () => PUBLIC,
      request: async () => response(200, { 'content-type': 'video/mp4' }, ['abc', 'd']),
      removePartial: cleanup,
      logger,
    });

    await expect(
      safe.downloadToFile({
        url: 'https://media.example/video.mp4',
        destinationPath: destination,
        maxBytes: 3,
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'MediaTooLarge' });

    expect(cleanup).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      { stage: 'cleanup', code: 'CleanupFailed' },
      'partial download cleanup failed',
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(root);
  });

  it.each(['OperationTimedOut', 'OperationCancelled'] as const)(
    'keeps %s primary when partial-file cleanup fails',
    async (expectedCode) => {
      const root = await createRoot();
      const destination = join(root, `${expectedCode}.part`);
      const logger = { error: vi.fn() };
      const cleanup = vi.fn(async () => {
        throw new Error(`cannot unlink ${destination}`);
      });
      const body = new PassThrough();
      const safe = new SafeHttpClient({
        resolveHostname: async () => PUBLIC,
        request: async () => ({
          statusCode: 200,
          headers: { 'content-type': 'video/mp4' },
          body,
          close: vi.fn(),
        }),
        removePartial: cleanup,
        logger,
      });
      const controller = new AbortController();
      const pending = safe.downloadToFile({
        url: 'https://media.example/video.mp4',
        destinationPath: destination,
        maxBytes: 100,
        timeoutMs: 1_000,
        signal: controller.signal,
      });
      body.write('partial');
      await vi.waitFor(async () => expect(await readFile(destination, 'utf8')).toBe('partial'));
      controller.abort(applicationError(expectedCode, 'admission'));

      await expect(pending).rejects.toMatchObject({ code: expectedCode });
      expect(cleanup).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        { stage: 'cleanup', code: 'CleanupFailed' },
        'partial download cleanup failed',
      );
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(root);
    },
  );

  it('uses the production Undici request path with a DNS-pinned dispatcher and closes it', async () => {
    const root = await createRoot();
    const destination = join(root, 'mocked.part');
    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    mockAgent
      .get('https://media.example')
      .intercept({ path: '/video.mp4', method: 'GET' })
      .reply(200, 'video', { headers: { 'content-type': 'video/mp4' } });
    const destroy = vi.spyOn(mockAgent, 'destroy');
    let validatedLookup: LookupFunction | undefined;
    const safe = new SafeHttpClient({
      resolveHostname: async () => PUBLIC,
      dispatcherFactory: (options) => {
        if (
          typeof options.connect === 'object' &&
          options.connect !== null &&
          'lookup' in options.connect
        ) {
          validatedLookup = options.connect.lookup;
        }
        return mockAgent;
      },
    });

    await expect(
      safe.downloadToFile({
        url: 'https://media.example/video.mp4',
        destinationPath: destination,
        maxBytes: 100,
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe(5);

    expect(validatedLookup).toBeTypeOf('function');
    const resolved = await new Promise<unknown>((resolve, reject) => {
      validatedLookup?.('media.example', { all: true, verbatim: true }, (error, addresses) => {
        if (error) reject(error);
        else resolve(addresses);
      });
    });
    expect(resolved).toEqual(PUBLIC);
    expect(destroy).toHaveBeenCalledOnce();
    expect(await readFile(destination, 'utf8')).toBe('video');
    mockAgent.assertNoPendingInterceptors();
  });

  it('aborts an in-flight production Undici request and closes its dispatcher', async () => {
    const root = await createRoot();
    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    mockAgent
      .get('https://media.example')
      .intercept({ path: '/slow.mp4', method: 'GET' })
      .reply(200, 'video', { headers: { 'content-type': 'video/mp4' } })
      .delay(1_000);
    const destroy = vi.spyOn(mockAgent, 'destroy');
    let dispatcherCreated = false;
    const safe = new SafeHttpClient({
      resolveHostname: async () => PUBLIC,
      dispatcherFactory: () => {
        dispatcherCreated = true;
        return mockAgent;
      },
    });
    const controller = new AbortController();
    const pending = safe.downloadToFile({
      url: 'https://media.example/slow.mp4',
      destinationPath: join(root, 'cancel.part'),
      maxBytes: 100,
      timeoutMs: 2_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(dispatcherCreated).toBe(true));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'OperationCancelled' });
    expect(destroy).toHaveBeenCalledOnce();
    await expect(readFile(join(root, 'cancel.part'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    'http://media.example/video.mp4',
    'https://user:pass@media.example/video.mp4',
    'https://media.example:8443/video.mp4',
    'https://127.0.0.1/video.mp4',
    'https://[::1]/video.mp4',
  ])('rejects unsafe URL %s before issuing a request', async (url) => {
    const safe = client();
    const destination = join(await createRoot(), 'item.part');
    await expect(
      safe.instance.downloadToFile({
        url,
        destinationPath: destination,
        maxBytes: 100,
        timeoutMs: 100,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'MediaDownloadFailed' });
    expect(safe.requests).toHaveLength(0);
  });

  it('rejects a hostname with any non-public DNS answer', async () => {
    const safe = client({ addresses: [...PUBLIC, { address: '10.0.0.2', family: 4 }] });
    const destination = join(await createRoot(), 'item.part');

    await expect(
      safe.instance.downloadToFile({
        url: 'https://media.example/video.mp4',
        destinationPath: destination,
        maxBytes: 100,
        timeoutMs: 100,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'MediaDownloadFailed' });
    expect(safe.requests).toHaveLength(0);
  });

  it('bounds stalled DNS resolution by the request deadline', async () => {
    const safe = client({ resolve: () => new Promise(() => {}) });
    const destination = join(await createRoot(), 'item.part');
    await expect(
      safe.instance.downloadToFile({
        url: 'https://media.example/video.mp4',
        destinationPath: destination,
        maxBytes: 100,
        timeoutMs: 10,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'OperationTimedOut' });
    expect(safe.requests).toHaveLength(0);
  });

  it('aborts stalled DNS resolution when the caller cancels', async () => {
    const safe = client({ resolve: () => new Promise(() => {}) });
    const destination = join(await createRoot(), 'item.part');
    const controller = new AbortController();
    const pending = safe.instance.downloadToFile({
      url: 'https://media.example/video.mp4',
      destinationPath: destination,
      maxBytes: 100,
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'OperationCancelled' });
    expect(safe.requests).toHaveLength(0);
  });

  it('follows and revalidates relative redirects, requesting identity encoding', async () => {
    const safe = client({
      responses: [
        response(302, { location: '/cdn/video.mp4' }, []),
        response(200, { 'content-type': 'video/mp4', 'content-length': '5' }, ['video']),
      ],
    });
    const root = await createRoot();
    const destination = join(root, 'item.part');
    const bytes = await safe.instance.downloadToFile({
      url: 'https://media.example/post',
      destinationPath: destination,
      maxBytes: 100,
      timeoutMs: 100,
      signal: new AbortController().signal,
    });

    expect(bytes).toBe(5);
    expect(safe.requests.map((item) => item.url)).toEqual([
      'https://media.example/post',
      'https://media.example/cdn/video.mp4',
    ]);
    expect(safe.requests[0]?.headers['accept-encoding']).toBe('identity');
    expect(await readFile(destination, 'utf8')).toBe('video');
  });

  it.each([
    response(302, {}, []),
    response(302, { location: 'http://media.example/video.mp4' }, []),
    response(302, { location: 'https://user@media.example/video.mp4' }, []),
    response(302, { location: 'http://[bad' }, []),
  ])('rejects missing or unsafe redirect locations', async (redirect) => {
    const safe = client({ responses: [redirect] });
    const destination = join(await createRoot(), 'item.part');
    await expect(
      safe.instance.downloadToFile({
        url: 'https://media.example/video.mp4',
        destinationPath: destination,
        maxBytes: 100,
        timeoutMs: 100,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'MediaDownloadFailed' });
  });

  it('detects redirect loops and enforces the redirect cap', async () => {
    const loop = client({
      responses: [
        response(302, { location: '/same' }, []),
        response(302, { location: '/same' }, []),
      ],
    });
    await expect(
      loop.instance.downloadToFile({
        url: 'https://media.example/same',
        destinationPath: join(await createRoot(), 'loop.part'),
        maxBytes: 100,
        timeoutMs: 100,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'MediaDownloadFailed' });

    const capped = client({
      maxRedirects: 1,
      responses: [response(302, { location: '/one' }, []), response(302, { location: '/two' }, [])],
    });
    await expect(
      capped.instance.downloadToFile({
        url: 'https://media.example/start',
        destinationPath: join(await createRoot(), 'cap.part'),
        maxBytes: 100,
        timeoutMs: 100,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'MediaDownloadFailed' });
    expect(capped.requests).toHaveLength(2);
  });

  it('rejects wrong content type, compressed bodies, zero bytes, and declared oversize', async () => {
    const badResponses: readonly (readonly [SafeHttpResponse, string])[] = [
      [response(200, { 'content-type': 'text/html' }, ['no']), 'MediaDownloadFailed'],
      [
        response(200, { 'content-type': 'video/mp4', 'content-encoding': 'gzip' }, ['x']),
        'MediaDownloadFailed',
      ],
      [
        response(200, { 'content-type': 'video/mp4', 'content-length': '0' }, []),
        'MediaDownloadFailed',
      ],
      [
        response(200, { 'content-type': 'video/mp4', 'content-length': '101' }, ['x']),
        'MediaTooLarge',
      ],
    ];
    for (const [item, code] of badResponses) {
      const safe = client({ responses: [item] });
      const root = await createRoot();
      await expect(
        safe.instance.downloadToFile({
          url: 'https://media.example/video.mp4',
          destinationPath: join(root, 'item.part'),
          maxBytes: 100,
          timeoutMs: 100,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code });
      expect(await (await import('node:fs/promises')).readdir(root)).toEqual([]);
    }
  });

  it('enforces streamed byte caps when length is missing or inaccurate and deletes partial files', async () => {
    for (const headers of [
      { 'content-type': 'video/mp4' },
      { 'content-type': 'video/mp4', 'content-length': '5' },
    ]) {
      const safe = client({
        responses: [response(200, headers, ['123', '456'])],
      });
      const root = await createRoot();
      const destination = join(root, 'item.part');
      await expect(
        safe.instance.downloadToFile({
          url: 'https://media.example/video.mp4',
          destinationPath: destination,
          maxBytes: 5,
          timeoutMs: 100,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: 'MediaTooLarge' });
      await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    }

    const exact = client({
      responses: [response(200, { 'content-type': 'video/mp4' }, ['123', '45'])],
    });
    const root = await createRoot();
    const destination = join(root, 'exact.part');
    await expect(
      exact.instance.downloadToFile({
        url: 'https://media.example/video.mp4',
        destinationPath: destination,
        maxBytes: 5,
        timeoutMs: 100,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe(5);
  });

  it('maps caller abort and request timeout to distinct operation errors', async () => {
    const controller = new AbortController();
    let requestStarted = () => {};
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const safe = new SafeHttpClient({
      resolveHostname: async () => PUBLIC,
      request: async (_url, _addresses, _timeoutMs, signal) => {
        requestStarted();
        await new Promise<void>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        return response();
      },
    });
    const cancelled = safe.downloadToFile({
      url: 'https://media.example/video.mp4',
      destinationPath: join(await createRoot(), 'cancel.part'),
      maxBytes: 100,
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    await started;
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'OperationCancelled' });

    vi.useFakeTimers();
    const timed = new SafeHttpClient({
      resolveHostname: async () => PUBLIC,
      request: async (_url, _addresses, _timeoutMs, signal) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        return response();
      },
    });
    const timeout = timed.downloadToFile({
      url: 'https://media.example/video.mp4',
      destinationPath: join(await createRoot(), 'timeout.part'),
      maxBytes: 100,
      timeoutMs: 50,
      signal: new AbortController().signal,
    });
    const timedAssertion = expect(timeout).rejects.toMatchObject({ code: 'OperationTimedOut' });
    await vi.advanceTimersByTimeAsync(50);
    await timedAssertion;
  });
});
