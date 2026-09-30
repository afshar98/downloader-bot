import { Resolver, lookup as lookupDns } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { Agent, request as undiciRequest } from 'undici';
import type { Dispatcher } from 'undici';
import type { LookupFunction } from 'node:net';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ipaddr from 'ipaddr.js';
import { applicationError, isApplicationError, operationAbortError } from '../shared/errors.js';
import { createLogger, type StructuredLogger } from './logger.js';

export type ResolvedAddress = Readonly<{ address: string; family: 4 | 6 }>;

export type SafeHttpResponse = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  body: NodeJS.ReadableStream & { destroy(error?: Error): void };
  close(): Promise<void> | void;
}>;

export type SafeHttpRequester = (
  url: URL,
  addresses: readonly ResolvedAddress[],
  timeoutMs: number,
  signal: AbortSignal,
  headers: Readonly<Record<string, string>>,
) => Promise<SafeHttpResponse>;

export type SafeHttpClientOptions = Readonly<{
  maxRedirects?: number;
  resolveHostname?: (hostname: string, signal?: AbortSignal) => Promise<readonly ResolvedAddress[]>;
  request?: SafeHttpRequester;
  dispatcherFactory?: (options: Agent.Options) => Dispatcher;
  removePartial?: (path: string) => Promise<void>;
  logger?: Pick<StructuredLogger, 'error'>;
}>;

export type DownloadToFileRequest = Readonly<{
  url: string;
  destinationPath: string;
  maxBytes: number;
  timeoutMs: number;
  signal: AbortSignal;
}>;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const RESPONSE_HEADERS = {
  'accept-encoding': 'identity',
  accept: 'video/mp4, application/octet-stream',
};

export class SafeHttpClient {
  private readonly maxRedirects: number;
  private readonly resolveHostname: (
    hostname: string,
    signal?: AbortSignal,
  ) => Promise<readonly ResolvedAddress[]>;
  private readonly injectedRequest: SafeHttpRequester | undefined;
  private readonly dispatcherFactory: (options: Agent.Options) => Dispatcher;
  private readonly removePartialFile: (path: string) => Promise<void>;
  private readonly logger: Pick<StructuredLogger, 'error'>;

  constructor(options: SafeHttpClientOptions = {}) {
    this.maxRedirects = options.maxRedirects ?? 3;
    if (
      !Number.isSafeInteger(this.maxRedirects) ||
      this.maxRedirects < 0 ||
      this.maxRedirects > 3
    ) {
      throw new RangeError('maxRedirects must be an integer from 0 through 3');
    }
    this.resolveHostname = options.resolveHostname ?? defaultResolveHostname;
    this.injectedRequest = options.request;
    this.dispatcherFactory =
      options.dispatcherFactory ?? ((dispatcherOptions) => new Agent(dispatcherOptions));
    this.removePartialFile = options.removePartial ?? removePartial;
    this.logger = options.logger ?? createLogger({ level: 'error' });
  }

  async downloadToFile(request: DownloadToFileRequest): Promise<number> {
    validatePositiveLimit(request.maxBytes, 'maxBytes');
    validatePositiveLimit(request.timeoutMs, 'timeoutMs');
    const deadlineAt = performance.now() + request.timeoutMs;
    let response: SafeHttpResponse | undefined;
    let bytes = 0;
    let streamedOverflow = false;
    try {
      if (request.signal.aborted) {
        throw operationAbortError(request.signal.reason, 'download');
      }
      const firstUrl = parseSafeUrl(request.url);
      const visited = new Set<string>([firstUrl.href]);
      let currentUrl = firstUrl;

      for (let redirects = 0; ; redirects += 1) {
        const remainingBeforeDns = deadlineAt - performance.now();
        if (remainingBeforeDns <= 0) throw applicationError('OperationTimedOut', 'download');
        const dnsSignal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(Math.ceil(remainingBeforeDns)),
        ]);
        const addresses = await this.resolveAndValidate(currentUrl, dnsSignal);
        if (request.signal.aborted) {
          throw operationAbortError(request.signal.reason, 'download');
        }
        const remainingMs = deadlineAt - performance.now();
        if (remainingMs <= 0) throw applicationError('OperationTimedOut', 'download');
        const timeoutSignal = AbortSignal.timeout(Math.ceil(remainingMs));
        const signal = AbortSignal.any([request.signal, timeoutSignal]);
        response = await this.request(currentUrl, addresses, remainingMs, signal);

        if (REDIRECT_STATUS_CODES.has(response.statusCode)) {
          const location = getHeader(response.headers, 'location');
          if (!location || redirects >= this.maxRedirects) {
            throw applicationError('MediaDownloadFailed', 'download');
          }
          let nextUrl: URL;
          try {
            nextUrl = parseSafeUrl(new URL(location, currentUrl).href);
          } catch {
            throw applicationError('MediaDownloadFailed', 'download');
          }
          if (visited.has(nextUrl.href)) throw applicationError('MediaDownloadFailed', 'download');
          visited.add(nextUrl.href);
          response.body.destroy();
          await closeQuietly(response);
          response = undefined;
          currentUrl = nextUrl;
          continue;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw applicationError('MediaDownloadFailed', 'download');
        }
        const encoding = getHeader(response.headers, 'content-encoding');
        if (encoding && encoding.toLowerCase() !== 'identity') {
          throw applicationError('MediaDownloadFailed', 'download');
        }
        const contentType = getHeader(response.headers, 'content-type')
          ?.split(';', 1)[0]
          ?.trim()
          .toLowerCase();
        if (contentType !== 'video/mp4' && contentType !== 'application/octet-stream') {
          throw applicationError('MediaDownloadFailed', 'download');
        }
        const declaredLength = parseContentLength(getHeader(response.headers, 'content-length'));
        if (declaredLength === 0) throw applicationError('MediaDownloadFailed', 'download');
        if (declaredLength !== undefined && declaredLength > request.maxBytes) {
          throw applicationError('MediaTooLarge', 'download');
        }

        const limiter = new Transform({
          transform(chunk: Buffer | string, _encoding, callback) {
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += data.byteLength;
            if (bytes > request.maxBytes) {
              streamedOverflow = true;
              callback(new Error('media size limit exceeded'));
              return;
            }
            callback(null, data);
          },
        });
        await pipeline(
          response.body,
          limiter,
          createWriteStream(request.destinationPath, { flags: 'wx', mode: 0o600 }),
          { signal },
        );
        if (bytes === 0 || (declaredLength !== undefined && bytes !== declaredLength)) {
          throw applicationError('MediaDownloadFailed', 'download');
        }
        await closeQuietly(response);
        response = undefined;
        return bytes;
      }
    } catch (error) {
      if (response) await closeQuietly(response);
      try {
        await this.removePartialFile(request.destinationPath);
      } catch {
        this.logger.error(
          { stage: 'cleanup', code: 'CleanupFailed' },
          'partial download cleanup failed',
        );
      }
      if (isApplicationError(error)) throw error;
      if (streamedOverflow) throw applicationError('MediaTooLarge', 'download');
      if (request.signal.aborted) {
        throw operationAbortError(request.signal.reason, 'download');
      }
      if (performance.now() >= deadlineAt) throw applicationError('OperationTimedOut', 'download');
      if (error instanceof Error && error.name === 'AbortError') {
        throw applicationError('OperationTimedOut', 'download', { cause: error });
      }
      throw applicationError('MediaDownloadFailed', 'download', { cause: error });
    }
  }

  private async resolveAndValidate(
    url: URL,
    signal: AbortSignal,
  ): Promise<readonly ResolvedAddress[]> {
    const hostname = unbracket(url.hostname);
    let addresses: readonly ResolvedAddress[];
    if (ipaddr.isValid(hostname)) {
      const ip = ipaddr.process(hostname);
      addresses = [{ address: ip.toString(), family: ip.kind() === 'ipv4' ? 4 : 6 }];
    } else {
      try {
        addresses = await abortable(this.resolveHostname(hostname, signal), signal);
      } catch (cause) {
        if (signal.aborted) {
          if (signal.reason instanceof Error && signal.reason.name === 'TimeoutError') {
            throw applicationError('OperationTimedOut', 'download', { cause });
          }
          throw operationAbortError(signal.reason, 'download');
        }
        throw applicationError('MediaDownloadFailed', 'download', { cause });
      }
    }
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
      throw applicationError('MediaDownloadFailed', 'download');
    }
    return addresses;
  }

  private async request(
    url: URL,
    addresses: readonly ResolvedAddress[],
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<SafeHttpResponse> {
    if (this.injectedRequest) {
      return this.injectedRequest(url, addresses, timeoutMs, signal, RESPONSE_HEADERS);
    }

    const lookup: LookupFunction = (_hostname, options, callback) => {
      const dnsRecords: LookupAddress[] = addresses.map((entry) => ({ ...entry }));
      if (options.all) {
        callback(null, dnsRecords);
        return;
      }
      const first = dnsRecords[0];
      if (!first) {
        const error = Object.assign(new Error('No validated address'), { code: 'ENOTFOUND' });
        callback(error, '', 0);
        return;
      }
      callback(null, first.address, first.family);
    };
    const dispatcher = this.dispatcherFactory({
      connect: { lookup, timeout: timeoutMs },
      connections: 1,
    });
    try {
      const result = await undiciRequest(url, {
        method: 'GET',
        dispatcher,
        headers: RESPONSE_HEADERS,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        signal,
      });
      return {
        statusCode: result.statusCode,
        headers: result.headers,
        body: result.body,
        close: async () => {
          await dispatcher.destroy();
        },
      };
    } catch (error) {
      await dispatcher.destroy();
      throw error;
    }
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Operation aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('Operation aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function defaultResolveHostname(
  hostname: string,
  signal?: AbortSignal,
): Promise<readonly ResolvedAddress[]> {
  if (!signal) {
    const addresses = await lookupDns(hostname, { all: true, verbatim: true });
    return addresses.flatMap((entry) =>
      entry.family === 4 || entry.family === 6
        ? [{ address: entry.address, family: entry.family }]
        : [],
    );
  }
  const resolver = new Resolver();
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const results = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ]);
    if (signal.aborted) throw signal.reason ?? new Error('DNS lookup cancelled');
    const addresses: ResolvedAddress[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        for (const address of result.value)
          addresses.push({ address, family: index === 0 ? 4 : 6 });
      }
    }
    if (addresses.length === 0)
      throw results.find((result) => result.status === 'rejected')?.reason;
    return addresses;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

function parseSafeUrl(value: string): URL {
  if (value.length > 2_048) throw applicationError('MediaDownloadFailed', 'download');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw applicationError('MediaDownloadFailed', 'download');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    (url.port !== '' && url.port !== '443') ||
    url.hostname === ''
  ) {
    throw applicationError('MediaDownloadFailed', 'download');
  }
  url.hash = '';
  return url;
}

function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function getHeader(headers: SafeHttpResponse['headers'], name: string): string | undefined {
  const value = headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length === 1) return value[0];
  return undefined;
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw applicationError('MediaDownloadFailed', 'download');
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw applicationError('MediaDownloadFailed', 'download');
  return length;
}

async function closeQuietly(response: SafeHttpResponse): Promise<void> {
  try {
    await response.close();
  } catch {
    response.body.destroy();
  }
}

async function removePartial(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingFileError(error)) throw applicationError('MediaDownloadFailed', 'download');
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function validatePositiveLimit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be positive`);
}
