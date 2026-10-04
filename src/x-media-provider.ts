import { tmpdir } from 'node:os';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import type { ProcessRunner } from './process-runner.js';
import { parseXStatusUrl } from './x-url.js';

const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 32 * 1024;
const EXTRACTION_TIMEOUT_MS = 45_000;

export type SourceMedia = Readonly<{
  url: string;
  container: 'mp4';
  width: number;
  height: number;
  expectedSizeBytes?: number;
}>;

export type XMediaProviderOptions = Readonly<{
  config: Config;
  runner: Pick<ProcessRunner, 'run'>;
}>;

type Format = Readonly<{
  url: string;
  ext: string;
  protocol: string;
  vcodec: string;
  width: number;
  height: number;
  tbr: number;
  size: number | undefined;
}>;

export class XMediaProvider {
  constructor(private readonly options: XMediaProviderOptions) {}

  async getAnimation(statusUrl: string, signal: AbortSignal): Promise<SourceMedia> {
    const reference = parseXStatusUrl(statusUrl);
    let result;
    try {
      result = await this.options.runner.run({
        executable: this.options.config.ytDlpPath,
        args: [
          '--no-config',
          '--no-plugin-dirs',
          '--no-playlist',
          '--skip-download',
          '--dump-single-json',
          '--no-warnings',
          '--no-progress',
          reference.canonicalUrl,
        ],
        cwd: tmpdir(),
        signal,
        timeoutMs: Math.min(this.options.config.jobTimeoutMs, EXTRACTION_TIMEOUT_MS),
        maxStdoutBytes: MAX_METADATA_BYTES,
        maxStderrBytes: MAX_DIAGNOSTIC_BYTES,
      });
    } catch (cause) {
      if (cause instanceof AppError && (cause.code === 'cancelled' || cause.code === 'timed-out')) {
        throw cause;
      }
      if (cause instanceof AppError) throw cause;
      throw new AppError('extraction-failed', 'X media extraction failed', { cause });
    }

    if (result.exitCode !== 0) {
      if (/HTTP Error (?:401|403|404)|(?:private|protected|not available)/i.test(result.stderr)) {
        throw new AppError('post-inaccessible');
      }
      throw new AppError('extractor-failed', 'yt-dlp could not extract this post');
    }

    let metadata: unknown;
    try {
      metadata = JSON.parse(result.stdout);
    } catch (cause) {
      throw new AppError('invalid-extractor-response', 'X media metadata was invalid', { cause });
    }

    const formats = readFormats(metadata);
    if (formats.length === 0) throw new AppError('no-animation');

    const progressiveMp4 = formats.filter(isEligibleFormat);
    if (progressiveMp4.length === 0) throw new AppError('no-animation');
    const withinLimit = progressiveMp4.filter(
      (format) => format.size === undefined || format.size <= this.options.config.maxMediaBytes,
    );
    if (withinLimit.length === 0) throw new AppError('media-too-large');
    if (withinLimit.some((format) => !isXMediaUrl(format.url))) {
      throw new AppError('unsafe-media-url');
    }
    const eligible = withinLimit.sort(
      (a, b) => b.height - a.height || b.width - a.width || b.tbr - a.tbr,
    );
    const selected = eligible[0];
    if (!selected) throw new AppError('no-animation');
    return {
      url: selected.url,
      container: 'mp4',
      width: selected.width,
      height: selected.height,
      ...(selected.size === undefined ? {} : { expectedSizeBytes: selected.size }),
    };
  }
}

function readFormats(value: unknown): Format[] {
  if (!isRecord(value)) throw new AppError('invalid-extractor-response');
  const rawFormats = value['formats'];
  if (rawFormats === undefined || rawFormats === null) return [];
  if (!Array.isArray(rawFormats)) throw new AppError('invalid-extractor-response');

  return rawFormats.map((value) => {
    if (!isRecord(value)) throw new AppError('invalid-extractor-response');
    const url = value['url'];
    const ext = value['ext'];
    const protocol = value['protocol'];
    const vcodec = value['vcodec'];
    if (
      typeof url !== 'string' ||
      typeof ext !== 'string' ||
      typeof protocol !== 'string' ||
      typeof vcodec !== 'string'
    ) {
      throw new AppError('invalid-extractor-response');
    }

    return {
      url,
      ext,
      protocol,
      vcodec,
      width: optionalPositiveNumber(value['width']) ?? 0,
      height: optionalPositiveNumber(value['height']) ?? 0,
      tbr: optionalPositiveNumber(value['tbr']) ?? 0,
      size:
        optionalPositiveNumber(value['filesize']) ??
        optionalPositiveNumber(value['filesize_approx']),
    };
  });
}

function isEligibleFormat(format: Format): boolean {
  return (
    format.ext === 'mp4' &&
    format.protocol === 'https' &&
    format.vcodec !== 'none' &&
    format.width > 0 &&
    format.height > 0
  );
}

function isXMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      (url.hostname === 'twimg.com' || url.hostname.endsWith('.twimg.com'))
    );
  } catch {
    return false;
  }
}

function optionalPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
