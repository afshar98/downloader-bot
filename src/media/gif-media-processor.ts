import { lstat, open } from 'node:fs/promises';
import type {
  MediaProcessor as MediaProcessorPort,
  ProcessRunnerPort,
} from '../application/ports.js';
import type {
  DownloadedMedia,
  PreparedMedia,
  ProcessingBudget,
  TemporaryWorkspace,
} from '../application/models.js';
import type { OperationContext } from '../application/operation-context.js';
import { applicationError, isApplicationError, operationAbortError } from '../shared/errors.js';
import { DirectMediaProcessor } from './direct-media-processor.js';
import { GifValidator } from './gif-validator.js';

const PALETTE_MAX_BYTES = 16 * 1024;
const DIAGNOSTIC_LIMIT_BYTES = 16 * 1024;
const MAX_SOURCE_PIXELS = 16_777_216;
const MAX_ALLOCATION_BYTES = 64 * 1024 * 1024;
const PALETTE_FILTER =
  "fps=15,scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease:flags=lanczos,setsar=1,palettegen=max_colors=256";
const GIF_FILTER =
  "[0:v]fps=15,scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[scaled];[scaled][1:v]paletteuse=dither=bayer:diff_mode=rectangle[gif]";

export type GifMediaProcessorOptions = Readonly<{
  executable: string;
  maxMediaBytes: number;
  runner: Pick<ProcessRunnerPort, 'run'>;
  onFatalResourceFailure?: (reason: 'workspace-cleanup-incomplete') => void;
}>;

export class GifMediaProcessor implements MediaProcessorPort {
  private readonly directProcessor: DirectMediaProcessor;
  private readonly validator: GifValidator;

  constructor(private readonly options: GifMediaProcessorOptions) {
    this.directProcessor = new DirectMediaProcessor({ maxMediaBytes: options.maxMediaBytes });
    this.validator = new GifValidator(options.runner, {
      executable: options.executable,
      maxMediaBytes: options.maxMediaBytes,
    });
  }

  async prepare(
    media: DownloadedMedia,
    context: OperationContext,
    workspace: TemporaryWorkspace,
    budget: ProcessingBudget,
  ): Promise<PreparedMedia> {
    if (media.audioPresence !== 'absent') {
      return this.directProcessor.prepare(media, context, workspace, budget);
    }
    const paths = workspace.itemPaths(media.position);
    if (
      media.sizeBytes > this.options.maxMediaBytes ||
      media.sizeBytes < 1 ||
      media.container !== 'mp4' ||
      media.path !== paths.mediaPath
    ) {
      throw applicationError(
        media.sizeBytes > this.options.maxMediaBytes ? 'MediaTooLarge' : 'MediaProcessingFailed',
        'processing',
      );
    }

    try {
      const sourceDetails = await lstat(media.path);
      if (!sourceDetails.isFile() || sourceDetails.isSymbolicLink() || sourceDetails.size < 1) {
        throw applicationError('MediaProcessingFailed', 'processing');
      }
      if (sourceDetails.size > this.options.maxMediaBytes) {
        throw applicationError('MediaTooLarge', 'processing');
      }
      if (sourceDetails.size !== media.sizeBytes) {
        throw applicationError('MediaProcessingFailed', 'processing');
      }
      remainingMs(budget);
      await this.runBounded(
        budget,
        paletteArgs(media.path),
        paths.palettePartPath,
        PALETTE_MAX_BYTES,
      );
      await validatePalette(paths.palettePartPath);
      await workspace.finalizePalette(media.position);

      await this.runBounded(
        budget,
        gifArgs(media.path, paths.palettePath),
        paths.gifPartPath,
        this.options.maxMediaBytes,
      );
      const deliverySizeBytes = await this.validator.validate(paths.gifPartPath, budget);
      remainingMs(budget);
      await workspace.finalizeGif(media.position);
      await workspace.removePalette(media.position);
      return {
        downloaded: media,
        deliveryPath: paths.gifPath,
        deliverySizeBytes,
        deliveryKind: 'animation',
        deliveryContainer: 'gif',
        transformed: true,
      };
    } catch (error) {
      try {
        await workspace.removeConversion(media.position);
      } catch {
        this.notifyFatalResourceFailure();
      }
      if (isApplicationError(error)) throw error;
      if (budget.signal.aborted) throw operationAbortError(budget.signal.reason, 'processing');
      throw applicationError('MediaProcessingFailed', 'processing', { cause: error });
    }
  }

  private async runBounded(
    budget: ProcessingBudget,
    args: string[],
    outputPath: string,
    maxBytes: number,
  ): Promise<void> {
    const result = await this.options.runner.run({
      stage: 'processing',
      executable: this.options.executable,
      args,
      timeoutMs: remainingMs(budget),
      stdoutLimitBytes: DIAGNOSTIC_LIMIT_BYTES,
      stderrLimitBytes: DIAGNOSTIC_LIMIT_BYTES,
      signal: budget.signal,
      stdoutFile: { path: outputPath, maxBytes },
    });
    if (result.exitCode !== 0) throw applicationError('MediaProcessingFailed', 'processing');
  }

  private notifyFatalResourceFailure(): void {
    try {
      this.options.onFatalResourceFailure?.('workspace-cleanup-incomplete');
    } catch {
      // Resource failure signaling cannot replace the processing outcome.
    }
  }
}

async function validatePalette(path: string): Promise<void> {
  const details = await lstat(path);
  if (
    !details.isFile() ||
    details.isSymbolicLink() ||
    details.size < 8 ||
    details.size > PALETTE_MAX_BYTES
  ) {
    throw applicationError('MediaProcessingFailed', 'processing');
  }
  const handle = await open(path, 'r');
  try {
    const signature = Buffer.alloc(8);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    if (
      bytesRead !== 8 ||
      !signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      throw applicationError('MediaProcessingFailed', 'processing');
    }
  } finally {
    await handle.close();
  }
}

function commonInputOptions(): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-max_alloc',
    String(MAX_ALLOCATION_BYTES),
    '-threads',
    '1',
    '-filter_threads',
    '1',
    '-filter_complex_threads',
    '1',
    '-max_pixels',
    String(MAX_SOURCE_PIXELS),
    '-protocol_whitelist',
    'file',
    '-enable_drefs',
    '0',
    '-use_absolute_path',
    '0',
    '-f',
    'mov',
  ];
}

function paletteArgs(sourcePath: string): string[] {
  return [
    ...commonInputOptions(),
    '-i',
    sourcePath,
    '-vf',
    PALETTE_FILTER,
    '-frames:v',
    '1',
    '-an',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    'pipe:1',
  ];
}

function gifArgs(sourcePath: string, palettePath: string): string[] {
  return [
    ...commonInputOptions(),
    '-i',
    sourcePath,
    '-threads',
    '1',
    '-max_pixels',
    String(MAX_SOURCE_PIXELS),
    '-protocol_whitelist',
    'file',
    '-f',
    'png_pipe',
    '-i',
    palettePath,
    '-filter_complex',
    GIF_FILTER,
    '-map',
    '[gif]',
    '-an',
    '-threads',
    '1',
    '-loop',
    '0',
    '-f',
    'gif',
    'pipe:1',
  ];
}

function remainingMs(budget: ProcessingBudget): number {
  if (budget.signal.aborted) throw operationAbortError(budget.signal.reason, 'processing');
  const remaining = budget.remainingMs();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw applicationError('OperationTimedOut', 'processing');
  }
  return Math.max(1, Math.floor(remaining));
}
