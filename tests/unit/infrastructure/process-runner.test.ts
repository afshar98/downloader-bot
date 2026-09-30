import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { SpawnOptions } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProcessRunner,
  type ProcessChild,
  type ProcessSpawner,
} from '../../../src/infrastructure/process-runner.js';
import { applicationError } from '../../../src/shared/errors.js';

class FakeChild extends EventEmitter implements ProcessChild {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn((_signal?: NodeJS.Signals) => {
    queueMicrotask(() => this.emit('close', null, 'SIGTERM'));
    return true;
  });
}

function runnerFor(configure: (child: FakeChild) => void): {
  runner: ProcessRunner;
  child: FakeChild;
  calls: { executable?: string; args?: string[]; options?: SpawnOptions };
} {
  const child = new FakeChild();
  const calls: { executable?: string; args?: string[]; options?: SpawnOptions } = {};
  const spawn: ProcessSpawner = (executable, args, options) => {
    calls.executable = executable;
    calls.args = args;
    calls.options = options;
    queueMicrotask(() => configure(child));
    return child;
  };
  return { runner: new ProcessRunner({ spawn, killGraceMs: 20 }), child, calls };
}

const request = {
  executable: '/opt/bin/yt-dlp',
  args: ['--dump-single-json', '--', 'https://x.com/example/status/1'],
  cwd: '/tmp/controlled',
  timeoutMs: 100,
  stdoutLimitBytes: 16,
  stderrLimitBytes: 8,
  signal: new AbortController().signal,
};

afterEach(() => vi.useRealTimers());

describe('ProcessRunner', () => {
  it('uses an argument array with shell disabled and returns bounded output', async () => {
    const { runner, calls } = runnerFor((child) => {
      child.stdout.end('{"ok":true}');
      child.stderr.end('');
      child.emit('close', 0, null);
    });

    const result = await runner.run(request);

    expect(calls.executable).toBe('/opt/bin/yt-dlp');
    expect(calls.args).toEqual(request.args);
    expect(calls.options).toMatchObject({ shell: false, cwd: '/tmp/controlled' });
    expect(result).toMatchObject({ stdout: '{"ok":true}', stderr: '', exitCode: 0 });
  });

  it('rejects output over the exact configured cap and terminates the child', async () => {
    const { runner, child } = runnerFor((process) => {
      process.stdout.end('12345678901234567');
    });

    await expect(runner.run(request)).rejects.toMatchObject({ code: 'ProviderOutputInvalid' });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('returns non-zero exit metadata and maps cancellation to a typed error', async () => {
    const failed = runnerFor((child) => {
      child.stdout.end('');
      child.stderr.end('diagnostic');
      child.emit('close', 2, null);
    });
    await expect(failed.runner.run({ ...request, stderrLimitBytes: 16 })).resolves.toMatchObject({
      exitCode: 2,
      stderr: 'diagnostic',
    });

    const controller = new AbortController();
    const cancelled = runnerFor(() => {});
    const result = cancelled.runner.run({ ...request, signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'OperationCancelled' });
    expect(cancelled.child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('preserves typed timeout and cancellation reasons from the request signal', async () => {
    for (const code of ['OperationTimedOut', 'OperationCancelled'] as const) {
      const controller = new AbortController();
      const { runner } = runnerFor(() => {});
      const result = runner.run({ ...request, signal: controller.signal });
      const assertion = expect(result).rejects.toMatchObject({ code });
      controller.abort(applicationError(code, 'admission'));
      await assertion;
    }
  });

  it('terminates a child after its deadline and checks the version prerequisite', async () => {
    vi.useFakeTimers();
    const timed = runnerFor(() => {});
    const timeoutResult = timed.runner.run({ ...request, timeoutMs: 25 });
    const timeoutAssertion = expect(timeoutResult).rejects.toMatchObject({
      code: 'OperationTimedOut',
    });
    await vi.advanceTimersByTimeAsync(25);
    await timeoutAssertion;
    expect(timed.child.kill).toHaveBeenCalledWith('SIGTERM');

    const version = runnerFor((child) => {
      child.stdout.end('yt-dlp 2026.09.01');
      child.stderr.end('');
      child.emit('close', 0, null);
    });
    await expect(version.runner.checkVersion('/opt/bin/yt-dlp')).resolves.toBe('yt-dlp 2026.09.01');
  });
});
