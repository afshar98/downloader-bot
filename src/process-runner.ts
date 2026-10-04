import { spawn } from 'node:child_process';
import { AppError } from './errors.js';

const KILL_GRACE_MS = 200;

export type ProcessRunInput = Readonly<{
  executable: string;
  args: readonly string[];
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}>;

export type ProcessResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export class ProcessRunner {
  run(input: ProcessRunInput): Promise<ProcessResult> {
    if (input.signal.aborted) return Promise.reject(new AppError('cancelled'));
    if (
      !Number.isSafeInteger(input.timeoutMs) ||
      input.timeoutMs < 1 ||
      !Number.isSafeInteger(input.maxStdoutBytes) ||
      input.maxStdoutBytes < 0 ||
      !Number.isSafeInteger(input.maxStderrBytes) ||
      input.maxStderrBytes < 0
    ) {
      return Promise.reject(new AppError('process-failed', 'Invalid process limits'));
    }

    return new Promise((resolve, reject) => {
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdout: Buffer[] = [];
      let stderr: Buffer[] = [];
      let failure: AppError | undefined;
      let terminationTimer: NodeJS.Timeout | undefined;
      const timeout = setTimeout(() => fail(new AppError('timed-out')), input.timeoutMs);

      const child = spawn(input.executable, [...input.args], {
        cwd: input.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const abort = () => fail(new AppError('cancelled'));
      const fail = (error: AppError) => {
        if (failure) return;
        failure = error;
        child.kill('SIGTERM');
        terminationTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      };

      input.signal.addEventListener('abort', abort, { once: true });
      if (input.signal.aborted) abort();

      child.stdout.on('data', (chunk: Buffer) => {
        if (failure) return;
        stdoutBytes += chunk.length;
        if (stdoutBytes > input.maxStdoutBytes) {
          fail(new AppError('output-limit-exceeded'));
          return;
        }
        stdout.push(chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (failure) return;
        stderrBytes += chunk.length;
        if (stderrBytes > input.maxStderrBytes) {
          fail(new AppError('output-limit-exceeded'));
          return;
        }
        stderr.push(chunk);
      });

      child.once('error', (cause) => {
        if (!failure)
          failure = new AppError('process-failed', 'Could not start process', { cause });
      });

      child.once('close', (exitCode) => {
        clearTimeout(timeout);
        if (terminationTimer) clearTimeout(terminationTimer);
        input.signal.removeEventListener('abort', abort);
        if (failure) {
          reject(failure);
          return;
        }
        if (exitCode === null) {
          reject(new AppError('process-failed', 'Process ended without an exit code'));
          return;
        }
        resolve({
          exitCode,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
        stdout = [];
        stderr = [];
      });
    });
  }
}
