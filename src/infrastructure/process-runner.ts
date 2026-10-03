import { spawn, type SpawnOptions } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { ProcessExecution, ProcessExecutionResult } from '../application/models.js';
import { applicationError, operationAbortError } from '../shared/errors.js';

export interface ProcessChild {
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export type ProcessSpawner = (
  executable: string,
  args: string[],
  options: SpawnOptions,
) => ProcessChild;

export type ProcessRequest = ProcessExecution;
export type ProcessResult = ProcessExecutionResult;

export type ProcessRunnerOptions = Readonly<{
  spawn?: ProcessSpawner;
  killGraceMs?: number;
}>;

const controlledEnvironment = {
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  LANG: 'C',
  LC_ALL: 'C',
};

function defaultSpawn(executable: string, args: string[], options: SpawnOptions): ProcessChild {
  return spawn(executable, args, options);
}

export class ProcessRunner {
  private readonly spawnProcess: ProcessSpawner;
  private readonly killGraceMs: number;

  constructor(options: ProcessRunnerOptions = {}) {
    this.spawnProcess = options.spawn ?? defaultSpawn;
    this.killGraceMs = options.killGraceMs ?? 250;
  }

  run(request: ProcessRequest): Promise<ProcessResult> {
    validateLimit(request.timeoutMs, 'timeoutMs', 1);
    validateLimit(request.stdoutLimitBytes, 'stdoutLimitBytes', 1);
    validateLimit(request.stderrLimitBytes, 'stderrLimitBytes', 1);
    if (request.signal.aborted) {
      return Promise.reject(operationAbortError(request.signal.reason, 'provider'));
    }

    let child: ProcessChild;
    try {
      const options: SpawnOptions = {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: controlledEnvironment,
        ...(request.cwd ? { cwd: request.cwd } : {}),
      };
      child = this.spawnProcess(request.executable, [...request.args], options);
    } catch (cause) {
      return Promise.reject(applicationError('ProviderOutputInvalid', 'provider', { cause }));
    }

    if (!child.stdout || !child.stderr) {
      child.kill('SIGKILL');
      return Promise.reject(applicationError('ProviderOutputInvalid', 'provider'));
    }

    return new Promise((resolve, reject) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let terminalError: ReturnType<typeof applicationError> | undefined;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        if (forceTimer) clearTimeout(forceTimer);
        request.signal.removeEventListener('abort', onAbort);
      };
      const finishError = (error: ReturnType<typeof applicationError>) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const terminate = (error: ReturnType<typeof applicationError>) => {
        if (terminalError || settled) return;
        terminalError = error;
        try {
          child.kill('SIGTERM');
        } catch {
          // The bounded force-kill timer below still gives the child a chance to close.
        }
        killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // The runner must still settle if the process handle rejects termination.
          }
          forceTimer = setTimeout(() => finishError(error), this.killGraceMs);
          forceTimer.unref?.();
        }, this.killGraceMs);
        killTimer.unref?.();
      };
      const onAbort = () => terminate(operationAbortError(request.signal.reason, 'provider'));
      const timeoutTimer = setTimeout(
        () => terminate(applicationError('OperationTimedOut', 'provider')),
        request.timeoutMs,
      );
      timeoutTimer.unref?.();

      child.stdout?.on('data', (chunk: Buffer | string) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stdoutBytes += data.byteLength;
        if (stdoutBytes > request.stdoutLimitBytes) {
          terminate(applicationError('ProviderOutputInvalid', 'provider'));
          return;
        }
        stdout.push(data);
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stderrBytes += data.byteLength;
        if (stderrBytes > request.stderrLimitBytes) {
          terminate(applicationError('ProviderOutputInvalid', 'provider'));
          return;
        }
        stderr.push(data);
      });
      child.on('error', (cause) => {
        finishError(applicationError('ProviderOutputInvalid', 'provider', { cause }));
      });
      child.on('close', (exitCode, signal) => {
        if (terminalError) {
          finishError(terminalError);
          return;
        }
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          exitCode: exitCode ?? -1,
          signal,
        });
      });
      request.signal.addEventListener('abort', onAbort, { once: true });
      if (request.signal.aborted) onAbort();
    });
  }

  async checkVersion(executable: string): Promise<string> {
    const result = await this.run({
      stage: 'provider',
      executable,
      args: ['--version'],
      timeoutMs: 5_000,
      stdoutLimitBytes: 1_024,
      stderrLimitBytes: 1_024,
      signal: new AbortController().signal,
    });
    const version = result.stdout.trim();
    if (result.exitCode !== 0 || !version) {
      throw applicationError('ProviderOutputInvalid', 'provider');
    }
    return version;
  }
}

function validateLimit(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new RangeError(`${name} must be positive`);
}
