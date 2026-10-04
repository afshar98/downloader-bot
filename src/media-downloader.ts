import { lookup as lookupDns } from 'node:dns/promises';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { open, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import ipaddr from 'ipaddr.js';
import { Agent, fetch, type Dispatcher, type Response } from 'undici';
import { AppError } from './errors.js';
import type { SourceMedia } from './x-media-provider.js';

const MAX_REDIRECTS = 3;
const MAX_REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

type FetchOptions = Readonly<{
  redirect: 'manual';
  signal: AbortSignal;
  dispatcher: Dispatcher;
  headers: Readonly<Record<string, string>>;
}>;

type Fetcher = (url: string, options: FetchOptions) => Promise<Response>;
type HostResolver = (hostname: string) => Promise<readonly LookupAddress[]>;

export type MediaDownloaderOptions = Readonly<{
  maxBytes: number;
  fetcher?: Fetcher;
  resolveHost?: HostResolver;
}>;

export class MediaDownloader {
  private readonly fetcher: Fetcher;
  private readonly resolveHost: HostResolver;

  constructor(private readonly options: MediaDownloaderOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.resolveHost = options.resolveHost ?? resolvePublicHost;
  }

  async download(
    source: SourceMedia,
    destination: string,
    signal: AbortSignal,
  ): Promise<Readonly<{ path: string; sizeBytes: number }>> {
    if (signal.aborted) throw new AppError('cancelled');
    if (
      source.expectedSizeBytes !== undefined &&
      source.expectedSizeBytes > this.options.maxBytes
    ) {
      throw new AppError('media-too-large');
    }

    const agent = new Agent({ connect: { lookup: this.safeLookup } });
    let handle: FileHandle | undefined;
    let created = false;
    let completed = false;
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancelRead: (() => void) | undefined;

    try {
      response = await this.fetchFollowingRedirects(source.url, agent, signal);
      if (response.status !== 200 || !response.body) throw new AppError('download-failed');

      const contentLength = readContentLength(response);
      if (contentLength !== undefined && contentLength > this.options.maxBytes) {
        throw new AppError('media-too-large');
      }

      handle = await open(destination, 'wx', 0o600);
      created = true;
      reader = response.body.getReader();
      cancelRead = () => {
        void reader?.cancel().catch(() => undefined);
      };
      signal.addEventListener('abort', cancelRead, { once: true });
      if (signal.aborted) cancelRead();
      let sizeBytes = 0;

      while (true) {
        if (signal.aborted) throw new AppError('cancelled');
        const { done, value } = await reader.read();
        if (signal.aborted) throw new AppError('cancelled');
        if (done) break;
        if (!value) continue;
        sizeBytes += value.byteLength;
        if (sizeBytes > this.options.maxBytes) throw new AppError('media-too-large');
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await handle.write(value.subarray(offset));
          if (bytesWritten < 1) throw new AppError('download-failed');
          offset += bytesWritten;
        }
      }

      if (contentLength !== undefined && sizeBytes !== contentLength) {
        throw new AppError('download-failed');
      }
      await handle.close();
      handle = undefined;
      completed = true;
      return { path: destination, sizeBytes };
    } catch (cause) {
      if (signal.aborted) throw new AppError('cancelled', 'Download cancelled', { cause });
      if (cause instanceof AppError) throw cause;
      throw new AppError('download-failed', 'Media download failed', { cause });
    } finally {
      if (cancelRead) signal.removeEventListener('abort', cancelRead);
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // The stream may already be closed.
        }
        reader.releaseLock();
      }
      if (handle) {
        try {
          await handle.close();
        } catch {
          completed = false;
        }
      }
      if (created && !completed) {
        try {
          await unlink(destination);
        } catch {
          // The owning workspace performs a final recursive cleanup.
        }
      }
      try {
        await agent.close();
      } catch {
        await agent.destroy();
      }
      if (response?.body && !reader) {
        try {
          await response.body.cancel();
        } catch {
          // The response body may already be closed.
        }
      }
    }
  }

  private readonly safeLookup = (
    hostname: string,
    options: LookupOptions,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    void this.resolveHost(hostname).then(
      (addresses) => {
        try {
          assertPublicAddresses(addresses);
          const matching = options.family
            ? addresses.filter((address) => address.family === options.family)
            : addresses;
          if (matching.length === 0) throw new AppError('unsafe-media-url');
          if (options.all) {
            callback(null, [...matching]);
            return;
          }
          const selected = matching[0];
          if (!selected) throw new AppError('unsafe-media-url');
          callback(null, selected.address, selected.family);
        } catch (error) {
          callback(toNodeError(error), '', 0);
        }
      },
      (error: unknown) => callback(toNodeError(error), '', 0),
    );
  };

  private async fetchFollowingRedirects(
    initialUrl: string,
    dispatcher: Dispatcher,
    signal: AbortSignal,
  ): Promise<Response> {
    let current = initialUrl;
    for (let redirects = 0; ; redirects += 1) {
      if (signal.aborted) throw new AppError('cancelled');
      const url = await validateMediaUrl(current, this.resolveHost);
      const response = await this.fetcher(url.href, {
        redirect: 'manual',
        signal,
        dispatcher,
        headers: { 'accept-encoding': 'identity' },
      });
      if (!MAX_REDIRECT_STATUS.has(response.status)) return response;
      if (redirects >= MAX_REDIRECTS) {
        await cancelBody(response);
        throw new AppError('download-failed');
      }
      const location = response.headers.get('location');
      await cancelBody(response);
      if (!location) throw new AppError('download-failed');
      try {
        current = new URL(location, url).href;
      } catch (cause) {
        throw new AppError('unsafe-media-url', 'Invalid media redirect', { cause });
      }
    }
  }
}

async function validateMediaUrl(value: string, resolveHost: HostResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new AppError('unsafe-media-url', 'Invalid media URL', { cause });
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    !(hostname === 'twimg.com' || hostname.endsWith('.twimg.com'))
  ) {
    throw new AppError('unsafe-media-url');
  }

  try {
    assertPublicAddresses(await resolveHost(hostname));
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError('unsafe-media-url', 'Media host is not public', { cause });
  }
  return url;
}

function assertPublicAddresses(addresses: readonly LookupAddress[]): void {
  if (addresses.length === 0) throw new AppError('unsafe-media-url');
  for (const address of addresses) {
    try {
      if (ipaddr.process(address.address).range() !== 'unicast') {
        throw new AppError('unsafe-media-url');
      }
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw new AppError('unsafe-media-url', 'Media host resolved to an invalid address', {
        cause,
      });
    }
  }
}

function readContentLength(response: Response): number | undefined {
  const value = response.headers.get('content-length');
  if (value === null) return undefined;
  if (!/^\d+$/u.test(value)) throw new AppError('download-failed');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new AppError('download-failed');
  return parsed;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Redirect bodies are discarded before following Location.
  }
}

function toNodeError(error: unknown): NodeJS.ErrnoException {
  if (error instanceof Error) {
    return Object.assign(error, { code: 'ERR_UNSAFE_DESTINATION' });
  }
  return Object.assign(new Error('Unsafe media destination'), { code: 'ERR_UNSAFE_DESTINATION' });
}

async function resolvePublicHost(hostname: string): Promise<readonly LookupAddress[]> {
  return lookupDns(hostname, { all: true, verbatim: true });
}
