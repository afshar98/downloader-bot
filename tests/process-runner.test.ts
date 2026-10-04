import { describe, expect, it } from 'vitest';
import { ProcessRunner } from '../src/process-runner.js';

function runNode(
  script: string,
  options: Readonly<{
    timeoutMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
    signal?: AbortSignal;
  }> = {},
) {
  return new ProcessRunner().run({
    executable: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    signal: options.signal ?? new AbortController().signal,
    timeoutMs: options.timeoutMs ?? 2_000,
    maxStdoutBytes: options.maxStdoutBytes ?? 128,
    maxStderrBytes: options.maxStderrBytes ?? 128,
  });
}

describe('ProcessRunner', () => {
  it('passes argument values literally without invoking a shell', async () => {
    const result = await new ProcessRunner().run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write(process.argv[1] ?? "")', 'literal $(echo injected);*'],
      cwd: process.cwd(),
      signal: new AbortController().signal,
      timeoutMs: 2_000,
      maxStdoutBytes: 128,
      maxStderrBytes: 128,
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'literal $(echo injected);*',
      stderr: '',
    });
  });

  it('returns a non-zero process exit code without exposing diagnostics as an exception', async () => {
    const result = await runNode('process.stderr.write("private diagnostic"); process.exit(7)');

    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe('private diagnostic');
  });

  it('terminates a child that exceeds its stdout cap', async () => {
    await expect(
      runNode('process.stdout.write("x".repeat(32))', { maxStdoutBytes: 8 }),
    ).rejects.toMatchObject({
      code: 'output-limit-exceeded',
    });
  });

  it('terminates a child that exceeds its stderr cap', async () => {
    await expect(
      runNode('process.stderr.write("x".repeat(32))', { maxStderrBytes: 8 }),
    ).rejects.toMatchObject({
      code: 'output-limit-exceeded',
    });
  });

  it('terminates a child when its stage timeout expires', async () => {
    await expect(runNode('setTimeout(() => {}, 10000)', { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'timed-out',
    });
  });

  it('terminates a child when its signal is aborted', async () => {
    const controller = new AbortController();
    const operation = runNode('setTimeout(() => {}, 10000)', {
      timeoutMs: 2_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);

    await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
  });
});
