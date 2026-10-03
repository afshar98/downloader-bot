import type { ProcessRunnerPort } from '../application/ports.js';
import { ConfigurationError } from './load-config.js';

const VERSION_TIMEOUT_MS = 5_000;
const VERSION_OUTPUT_LIMIT_BYTES = 16 * 1024;

export async function verifyFfmpegVersion(
  runner: Pick<ProcessRunnerPort, 'run'>,
  executable: string,
  expectedVersion: string,
): Promise<void> {
  const expected = expectedVersion.trim();
  if (expected.length === 0)
    throw new ConfigurationError('FFmpeg prerequisite version check failed');

  try {
    const result = await runner.run({
      stage: 'processing',
      executable,
      args: ['-version'],
      timeoutMs: VERSION_TIMEOUT_MS,
      stdoutLimitBytes: VERSION_OUTPUT_LIMIT_BYTES,
      stderrLimitBytes: VERSION_OUTPUT_LIMIT_BYTES,
      signal: new AbortController().signal,
    });
    const firstLine = result.stdout.split(/\r?\n/, 1)[0] ?? '';
    const version = /^ffmpeg version ([^\s]+)(?:\s|$)/.exec(firstLine)?.[1];
    if (result.exitCode !== 0 || version !== expected) throw new Error('version mismatch');
  } catch {
    throw new ConfigurationError('FFmpeg prerequisite version check failed');
  }
}
