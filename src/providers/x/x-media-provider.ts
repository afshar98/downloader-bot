import type { MediaProvider } from '../media-provider.js';
import type { ProcessExecution } from '../../application/models.js';
import type { OperationContext } from '../../application/operation-context.js';
import type { ProcessRunnerPort } from '../../application/ports.js';
import type { PostReference } from '../../application/models.js';
import { applicationError, isApplicationError } from '../../shared/errors.js';
import { parseXPostUrl, recognizesXPostUrl } from './x-url.js';
import { parseYtDlpMetadata } from './yt-dlp-schema.js';

export type XMediaProviderLimits = Readonly<{
  extractionTimeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxMetadataBytes: number;
}>;

export type XMediaProviderOptions = Readonly<{
  runner: ProcessRunnerPort;
  executable: string;
  limits: XMediaProviderLimits;
}>;

export class XMediaProvider implements MediaProvider {
  constructor(private readonly options: XMediaProviderOptions) {}

  recognizes(candidate: URL): boolean {
    return recognizesXPostUrl(candidate);
  }

  validate(candidate: string): PostReference {
    return parseXPostUrl(candidate);
  }

  async resolve(post: PostReference, context: OperationContext) {
    const stage = context.createStageSignal('provider', this.options.limits.extractionTimeoutMs);
    try {
      const request: ProcessExecution = {
        executable: this.options.executable,
        args: [
          '--ignore-config',
          '--no-plugin-dirs',
          '--no-remote-components',
          '--socket-timeout',
          String(Math.max(1, Math.ceil(this.options.limits.extractionTimeoutMs / 1_000))),
          '--dump-single-json',
          '--skip-download',
          '--yes-playlist',
          '--use-extractors',
          'twitter',
          '--',
          post.canonicalUrl.href,
        ],
        timeoutMs: Math.min(this.options.limits.extractionTimeoutMs, context.remainingMs()),
        stdoutLimitBytes: this.options.limits.maxStdoutBytes,
        stderrLimitBytes: this.options.limits.maxStderrBytes,
        signal: stage.signal,
      };
      const result = await this.options.runner.run(request);
      if (result.exitCode !== 0) throw providerFailure(result.stderr);
      return parseYtDlpMetadata(result.stdout, this.options.limits.maxMetadataBytes);
    } catch (error) {
      if (isApplicationError(error)) throw error;
      throw applicationError('ProviderOutputInvalid', 'provider', { cause: error });
    } finally {
      stage.dispose();
    }
  }
}

function providerFailure(stderr: string) {
  const text = stderr.toLowerCase();
  if (/rate.?limit|too many requests|\b429\b/.test(text)) {
    return applicationError('ProviderRateLimited', 'provider');
  }
  if (/unavailable|private|not found|\b403\b|\b404\b|does not exist/.test(text)) {
    return applicationError('PostInaccessible', 'provider');
  }
  return applicationError('ProviderOutputInvalid', 'provider');
}
