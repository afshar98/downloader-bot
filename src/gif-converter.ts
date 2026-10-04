import { lstat, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AppError } from './errors.js';
import { GifValidator } from './gif-validator.js';
import { ProcessRunner } from './process-runner.js';

const VERIFIED_GIF: unique symbol = Symbol('verifiedGif');
const CONVERSION_PROFILES = [
  { fps: 15, dimension: 640 },
  { fps: 10, dimension: 640 },
  { fps: 8, dimension: 480 },
  { fps: 6, dimension: 360 },
] as const;

export type GifMedia = Readonly<{
  path: string;
  sizeBytes: number;
  width: number;
  height: number;
  frameCount: number;
  container: 'gif';
  readonly [VERIFIED_GIF]: true;
}>;
type GifConverterOptions = Readonly<{
  executable: string;
  maxSourceBytes: number;
  maxGifBytes: number;
  timeoutMs?: number;
  runner?: Pick<ProcessRunner, 'run'>;
  validator?: Pick<GifValidator, 'validate'>;
}>;

export class GifConverter {
  private readonly runner: Pick<ProcessRunner, 'run'>;
  private readonly validator: Pick<GifValidator, 'validate'>;

  constructor(private readonly options: GifConverterOptions) {
    this.runner = options.runner ?? new ProcessRunner();
    this.validator =
      options.validator ??
      new GifValidator({
        executable: options.executable,
        maxBytes: options.maxGifBytes,
        maxWidth: 640,
        maxHeight: 640,
        maxFrames: 450,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        runner: this.runner,
      });
  }

  async convert(
    sourcePath: string,
    partialPath: string,
    gifPath: string,
    signal: AbortSignal,
  ): Promise<GifMedia> {
    if (signal.aborted) throw new AppError('cancelled');
    if (partialPath === gifPath || sourcePath === partialPath || sourcePath === gifPath) {
      throw new AppError('conversion-failed');
    }
    try {
      const source = await lstat(sourcePath);
      if (!source.isFile() || source.isSymbolicLink() || source.size === 0)
        throw new AppError('conversion-failed');
      if (source.size > this.options.maxSourceBytes) throw new AppError('media-too-large');
      try {
        await lstat(gifPath);
        throw new AppError('conversion-failed');
      } catch (error) {
        if (error instanceof AppError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const timeoutMs = this.options.timeoutMs ?? 180_000;
      const startedAt = Date.now();
      for (const [index, profile] of CONVERSION_PROFILES.entries()) {
        if (signal.aborted) throw new AppError('cancelled');
        if (index > 0) await rm(partialPath, { force: true });
        const remainingMs = timeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) throw new AppError('timed-out');
        const result = await this.runner.run({
          executable: this.options.executable,
          args: [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-y',
            '-threads',
            '1',
            '-filter_complex_threads',
            '1',
            '-i',
            sourcePath,
            '-an',
            '-filter_complex',
            createFilter(profile.fps, profile.dimension),
            '-map',
            '[out]',
            '-loop',
            '0',
            '-fs',
            String(this.options.maxGifBytes),
            '-f',
            'gif',
            partialPath,
          ],
          cwd: dirname(sourcePath),
          signal,
          timeoutMs: remainingMs,
          maxStdoutBytes: 1024,
          maxStderrBytes: 16 * 1024,
        });
        const output = await lstat(partialPath).catch(() => undefined);
        if (!output || !output.isFile() || output.isSymbolicLink() || output.size === 0) {
          throw new AppError('conversion-failed');
        }
        if (output.size > this.options.maxGifBytes) {
          if (index === CONVERSION_PROFILES.length - 1) throw new AppError('media-too-large');
          continue;
        }
        if (result.exitCode !== 0) throw new AppError('conversion-failed');
        const validation = await this.validator.validate(partialPath, signal);
        const verifiedFile = await stat(partialPath);
        if (verifiedFile.size > this.options.maxGifBytes) throw new AppError('media-too-large');
        await rename(partialPath, gifPath);
        const media = {
          path: gifPath,
          sizeBytes: verifiedFile.size,
          width: validation.width,
          height: validation.height,
          frameCount: validation.frameCount,
          container: 'gif',
        };
        Object.defineProperty(media, VERIFIED_GIF, { value: true });
        return Object.freeze(media) as GifMedia;
      }
      throw new AppError('media-too-large');
    } catch (error) {
      await rm(partialPath, { force: true }).catch(() => undefined);
      if (error instanceof AppError) throw error;
      throw new AppError('conversion-failed', 'GIF conversion failed', { cause: error });
    }
  }
}

function createFilter(fps: number, dimension: number): string {
  return `[0:v]fps=${fps},scale=w=min(${dimension}\\,iw):h=min(${dimension}\\,ih):force_original_aspect_ratio=decrease:flags=lanczos,split[palettein][gifin];[palettein]palettegen=max_colors=256[palette];[gifin][palette]paletteuse=dither=bayer:diff_mode=rectangle[out]`;
}

export function isVerifiedGifMedia(value: unknown): value is GifMedia {
  if (typeof value !== 'object' || value === null || !Object.isFrozen(value)) return false;
  const candidate = value as Record<PropertyKey, unknown>;
  return (
    candidate[VERIFIED_GIF] === true &&
    typeof candidate['path'] === 'string' &&
    candidate['path'].toLowerCase().endsWith('.gif') &&
    typeof candidate['sizeBytes'] === 'number' &&
    Number.isSafeInteger(candidate['sizeBytes']) &&
    candidate['sizeBytes'] > 0 &&
    typeof candidate['width'] === 'number' &&
    candidate['width'] > 0 &&
    typeof candidate['height'] === 'number' &&
    candidate['height'] > 0 &&
    typeof candidate['frameCount'] === 'number' &&
    candidate['frameCount'] >= 2 &&
    candidate['container'] === 'gif'
  );
}
