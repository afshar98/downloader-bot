import { tmpdir } from 'node:os';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { ProcessRunner } from './process-runner.js';

const CHECKS = [
  { path: 'ytDlpPath', expected: 'ytDlpExpectedVersion', args: ['--version'] },
  { path: 'ffmpegPath', expected: 'ffmpegExpectedVersion', args: ['-version'] },
] as const;

export async function checkRuntimeTools(
  config: Config,
  runner: Pick<ProcessRunner, 'run'> = new ProcessRunner(),
): Promise<void> {
  for (const check of CHECKS) {
    try {
      const result = await runner.run({
        executable: config[check.path],
        args: check.args,
        cwd: tmpdir(),
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        maxStdoutBytes: 4096,
        maxStderrBytes: 4096,
      });
      const output = `${result.stdout}\n${result.stderr}`;
      const expected = escapeRegExp(config[check.expected]);
      const exactToken = new RegExp(`(?<![A-Za-z0-9._-])${expected}(?![A-Za-z0-9._-])`, 'u');
      if (result.exitCode !== 0 || !exactToken.test(output)) {
        throw new AppError('tool-check-failed');
      }
    } catch (cause) {
      throw new AppError(
        'tool-check-failed',
        'A required media tool is unavailable or unapproved',
        {
          cause,
        },
      );
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
