import { describe, expect, it, vi } from 'vitest';
import type { ProcessRunnerPort } from '../../../src/application/ports.js';
import { verifyFfmpegVersion } from '../../../src/config/verify-ffmpeg-version.js';

function runnerWith(stdout: string, exitCode = 0): ProcessRunnerPort {
  return {
    checkVersion: vi.fn(),
    run: vi.fn(async () => ({ stdout, stderr: '', exitCode, signal: null })),
  };
}

describe('verifyFfmpegVersion', () => {
  it('runs bounded processing-stage -version and compares the first-line token exactly', async () => {
    const runner = runnerWith('ffmpeg version approved-build Copyright (c)\nconfiguration: ...');
    await expect(verifyFfmpegVersion(runner, '/trusted/ffmpeg', 'approved-build')).resolves.toBe(
      undefined,
    );
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'processing',
        executable: '/trusted/ffmpeg',
        args: ['-version'],
        timeoutMs: 5_000,
        stdoutLimitBytes: 16 * 1024,
        stderrLimitBytes: 16 * 1024,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    ['', 0],
    ['not ffmpeg', 0],
    ['ffmpeg version approved-build-extra', 0],
    ['ffmpeg version approved-build', 1],
  ])(
    'fails startup safely for malformed, mismatched, or unsuccessful output',
    async (stdout, code) => {
      const runner = runnerWith(stdout, code);
      await expect(verifyFfmpegVersion(runner, '/secret/path', 'approved-build')).rejects.toThrow(
        'FFmpeg prerequisite version check failed',
      );
    },
  );

  it('redacts process failures from the startup error', async () => {
    const runner: ProcessRunnerPort = {
      checkVersion: vi.fn(),
      run: vi.fn(async () => {
        throw new Error('private diagnostic /tmp/workspace');
      }),
    };
    await expect(verifyFfmpegVersion(runner, '/trusted/ffmpeg', 'approved-build')).rejects.toThrow(
      'FFmpeg prerequisite version check failed',
    );
  });
});
