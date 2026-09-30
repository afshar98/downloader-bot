import { fileURLToPath } from 'node:url';
import { ProcessRunner } from '../../../src/infrastructure/process-runner.js';

const fixturePath = fileURLToPath(
  new URL('../../fixtures/process/controlled-child.mjs', import.meta.url),
);

export function runControlledChild(
  mode: 'valid' | 'non-zero' | 'malformed' | 'oversized' | 'wait',
  options: Readonly<{
    timeoutMs?: number;
    stdoutLimitBytes?: number;
    stderrLimitBytes?: number;
    signal?: AbortSignal;
  }> = {},
) {
  const runner = new ProcessRunner({ killGraceMs: 20 });
  return runner.run({
    executable: process.execPath,
    args: [fixturePath, mode],
    timeoutMs: options.timeoutMs ?? 2_000,
    stdoutLimitBytes: options.stdoutLimitBytes ?? 1024,
    stderrLimitBytes: options.stderrLimitBytes ?? 1024,
    signal: options.signal ?? new AbortController().signal,
  });
}
