import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { checkRuntimeTools } from '../src/tool-checks.js';
import type { ProcessRunInput, ProcessRunner } from '../src/process-runner.js';

const config: Config = {
  telegramToken: 'test-token',
  ytDlpPath: '/tools/yt-dlp',
  ytDlpExpectedVersion: '2026.08.19',
  ffmpegPath: '/tools/ffmpeg',
  ffmpegExpectedVersion: '6.1.1',
  maxMediaBytes: 1000,
  maxGifBytes: 900,
  maxConcurrentJobs: 2,
  jobTimeoutMs: 180_000,
};

describe('checkRuntimeTools', () => {
  it('checks configured executables and requires their approved version tokens', async () => {
    const run = vi.fn(async (input: ProcessRunInput) => ({
      exitCode: 0,
      stdout: input.executable.endsWith('yt-dlp') ? '2026.08.19\n' : 'ffmpeg version 6.1.1 build\n',
      stderr: '',
    }));

    await expect(checkRuntimeTools(config, { run } as ProcessRunner)).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0].args).toEqual(['--version']);
    expect(run.mock.calls[1]?.[0].args).toEqual(['-version']);
  });

  it('fails closed when a tool reports a different version', async () => {
    const runner = {
      run: vi.fn(async () => ({ exitCode: 0, stdout: 'unexpected version', stderr: '' })),
    };

    await expect(
      checkRuntimeTools(config, runner as unknown as ProcessRunner),
    ).rejects.toMatchObject({
      code: 'tool-check-failed',
    });
  });

  it('does not accept a version token that is a prefix of a different version', async () => {
    const runner = {
      run: vi.fn(async (input: ProcessRunInput) => ({
        exitCode: 0,
        stdout: input.executable.endsWith('yt-dlp')
          ? '2026.08.19\n'
          : 'ffmpeg version 6.1.10 build',
        stderr: '',
      })),
    };

    await expect(
      checkRuntimeTools(config, runner as unknown as ProcessRunner),
    ).rejects.toMatchObject({
      code: 'tool-check-failed',
    });
  });
});
