import { spawn, type SpawnOptions } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type { WriteStream } from 'node:fs';
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
  onFatalResourceFailure?: (
    reason: 'process-termination-unconfirmed' | 'workspace-cleanup-incomplete',
  ) => void;
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
  private readonly onFatalResourceFailure: ProcessRunnerOptions['onFatalResourceFailure'];
  private readonly activeRuns = new Set<Promise<unknown>>();
  private readonly activeTerminations = new Map<ProcessChild, () => void>();

  constructor(options: ProcessRunnerOptions = {}) {
    this.spawnProcess = options.spawn ?? defaultSpawn;
    this.killGraceMs = options.killGraceMs ?? 250;
    this.onFatalResourceFailure = options.onFatalResourceFailure;
  }

  run(request: ProcessRequest): Promise<ProcessResult> {
    validateLimit(request.timeoutMs, 'timeoutMs', 1);
    validateLimit(request.stdoutFile?.maxBytes ?? request.stdoutLimitBytes, 'stdoutLimitBytes', 1);
    validateLimit(request.stderrLimitBytes, 'stderrLimitBytes', 1);
    if (request.signal.aborted) {
      return Promise.reject(operationAbortError(request.signal.reason, request.stage));
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
      return Promise.reject(processError(request, { cause }));
    }

    if (!child.stdout || !child.stderr) {
      child.kill('SIGKILL');
      return Promise.reject(processError(request));
    }
    const run = new Promise<ProcessResult>((resolve, reject) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let terminalError: ReturnType<typeof applicationError> | undefined;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      let sink: WriteStream | undefined;
      let sinkError = false;
      let sinkOwned = false;
      let closeResult: [number | null, NodeJS.Signals | null] | undefined;
      let closeHandled = false;
      if (request.stdoutFile) {
        sink = createWriteStream(request.stdoutFile.path, { flags: 'wx', mode: 0o600 });
        sink.on('open', () => {
          sinkOwned = true;
        });
        sink.on('error', () => {
          sinkError = true;
          if (closeResult) finishError(processError(request));
          else terminate(processError(request));
        });
        sink.on('open', () => {
          if (closeResult) handleClose();
        });
      }

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
        void closeSinkAndRemove()
          .catch(() => this.notifyFatalResourceFailure('workspace-cleanup-incomplete'))
          .finally(() => reject(error));
      };
      const closeSinkAndRemove = async () => {
        if (!sink) return;
        if (!sink.destroyed) sink.destroy();
        await new Promise<void>((done) => {
          if (sink?.closed) done();
          else sink?.once('close', () => done());
        });
        if (sinkOwned) {
          try {
            await unlink(request.stdoutFile!.path);
          } catch (error) {
            if (!isMissingFileError(error)) throw error;
          }
        }
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
          forceTimer = setTimeout(() => {
            this.notifyFatalResourceFailure('process-termination-unconfirmed');
          }, this.killGraceMs);
          forceTimer.unref?.();
        }, this.killGraceMs);
        killTimer.unref?.();
      };
      this.activeTerminations.set(child, () =>
        terminate(applicationError('OperationCancelled', request.stage)),
      );
      const onAbort = () => terminate(operationAbortError(request.signal.reason, request.stage));
      const timeoutTimer = setTimeout(
        () => terminate(applicationError('OperationTimedOut', request.stage)),
        request.timeoutMs,
      );
      timeoutTimer.unref?.();

      child.stdout?.on('data', (chunk: Buffer | string) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stdoutBytes += data.byteLength;
        const outputCap = request.stdoutFile?.maxBytes ?? request.stdoutLimitBytes;
        if (stdoutBytes > outputCap) {
          terminate(
            request.stdoutFile
              ? applicationError('MediaTooLarge', 'processing')
              : processError(request),
          );
          return;
        }
        if (sink) {
          if (!sink.write(data)) child.stdout?.pause();
        } else stdout.push(data);
      });
      sink?.on('drain', () => child.stdout?.resume());
      child.stderr?.on('data', (chunk: Buffer | string) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stderrBytes += data.byteLength;
        if (stderrBytes > request.stderrLimitBytes) {
          terminate(processError(request));
          return;
        }
        stderr.push(data);
      });
      child.on('error', (cause) => terminate(processError(request, { cause })));
      const handleClose = () => {
        if (!closeResult || closeHandled || (sink && !sinkOwned && !sinkError)) return;
        closeHandled = true;
        const [exitCode, signal] = closeResult;
        if (terminalError) {
          sink?.end();
          finishError(terminalError);
          return;
        }
        if (settled) return;
        if (sinkError) {
          finishError(processError(request));
          return;
        }
        sink?.end();
        const complete = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve({
            stdout: sink ? '' : Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            exitCode: exitCode ?? -1,
            signal,
            ...(request.stdoutFile ? { outputBytes: stdoutBytes } : {}),
          });
        };
        if (sink && !sink.closed) sink.once('close', complete);
        else complete();
      };
      child.on('close', (exitCode, signal) => {
        this.activeTerminations.delete(child);
        closeResult = [exitCode, signal];
        handleClose();
      });
      request.signal.addEventListener('abort', onAbort, { once: true });
      if (request.signal.aborted) onAbort();
    });
    this.activeRuns.add(run);
    void run.finally(() => this.activeRuns.delete(run)).catch(() => {});
    return run;
  }

  async closeResources(): Promise<void> {
    for (const terminate of this.activeTerminations.values()) terminate();
    await Promise.allSettled([...this.activeRuns]);
  }

  private notifyFatalResourceFailure(
    reason: 'process-termination-unconfirmed' | 'workspace-cleanup-incomplete',
  ): void {
    try {
      this.onFatalResourceFailure?.(reason);
    } catch {
      // Fatal signaling must not replace the operation's primary error.
    }
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

function processError(
  request: ProcessRequest,
  options?: { cause?: unknown },
): ReturnType<typeof applicationError> {
  return applicationError(
    request.stage === 'provider' ? 'ProviderOutputInvalid' : 'MediaProcessingFailed',
    request.stage,
    options,
  );
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function validateLimit(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new RangeError(`${name} must be positive`);
}
