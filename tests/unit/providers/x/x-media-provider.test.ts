import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessRunnerPort } from '../../../../src/application/ports.js';
import type {
  ProcessExecution,
  ProcessExecutionResult,
} from '../../../../src/application/models.js';
import { createOperationContext } from '../../../../src/application/operation-context.js';
import { parseXPostUrl } from '../../../../src/providers/x/x-url.js';
import { XMediaProvider } from '../../../../src/providers/x/x-media-provider.js';
import { parseYtDlpMetadata } from '../../../../src/providers/x/yt-dlp-schema.js';
import { createRequestId } from '../../../../src/shared/identifiers.js';

const limits = {
  extractionTimeoutMs: 30_000,
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 65_536,
  maxMetadataBytes: 1_048_576,
};

function successfulResult(stdout: string, stderr = ''): ProcessExecutionResult {
  return { stdout, stderr, exitCode: 0, signal: null };
}

function fakeRunner(result: ProcessExecutionResult): {
  runner: ProcessRunnerPort;
  calls: ProcessExecution[];
} {
  const calls: ProcessExecution[] = [];
  const runner: ProcessRunnerPort = {
    run: vi.fn(async (request) => {
      calls.push(request);
      return result;
    }),
    checkVersion: vi.fn(async () => 'yt-dlp 2026.09.01'),
  };
  return { runner, calls };
}

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`../../../fixtures/x/${name}`, import.meta.url), 'utf8');
}

function context(signal = new AbortController().signal) {
  return createOperationContext({
    requestId: createRequestId(),
    signal,
    jobTimeoutMs: 120_000,
  });
}

describe('XMediaProvider', () => {
  it('maps supported fixture media in source order and filters non-progressive formats', async () => {
    const output = await fixture('video-post.json');
    const { runner } = fakeRunner(successfulResult(output));
    const provider = new XMediaProvider({ runner, executable: 'yt-dlp', limits });
    const operation = context();

    const media = await provider.resolve(parseXPostUrl('https://x.com/user/status/100'), operation);

    expect(media.map((item) => [item.mediaId, item.position])).toEqual([
      ['video-1', 1],
      ['video-2', 2],
    ]);
    expect(media[0]?.representations.map((item) => item.representationId)).toEqual([
      'low',
      'high',
      'hls',
    ]);
    operation.dispose();
  });

  it.each([
    ['HTTP Error 429: Too Many Requests', 'ProviderRateLimited'],
    ['This post is unavailable', 'PostInaccessible'],
  ])('maps bounded provider diagnostics to %s', async (stderr, code) => {
    const { runner } = fakeRunner({ stdout: '', stderr, exitCode: 1, signal: null });
    const provider = new XMediaProvider({ runner, executable: 'yt-dlp', limits });
    const operation = context();

    await expect(
      provider.resolve(parseXPostUrl('https://x.com/user/status/1'), operation),
    ).rejects.toMatchObject({ code });
    operation.dispose();
  });

  it('distinguishes accessible posts with no supported media', async () => {
    const output = await fixture('empty-post.json');
    const { runner } = fakeRunner(successfulResult(output));
    const provider = new XMediaProvider({ runner, executable: 'yt-dlp', limits });
    const operation = context();

    await expect(
      provider.resolve(parseXPostUrl('https://x.com/user/status/1'), operation),
    ).rejects.toMatchObject({ code: 'MediaNotFound' });
    operation.dispose();
  });

  it.each([
    '{invalid json',
    JSON.stringify({ id: 'post', entries: [] }),
    JSON.stringify({ id: 'post', entries: [null] }),
    JSON.stringify({ id: 'post', entries: [{ id: 'same' }, { id: 'same' }] }),
    JSON.stringify({ id: 'post', entries: [{ id: 'x', formats: [{ width: 1_000_000 }] }] }),
  ])('rejects malformed, capped, duplicate, or extreme output', async (output) => {
    expect(() => parseYtDlpMetadata(output, 1_048_576)).toThrow(
      expect.objectContaining({ code: 'ProviderOutputInvalid' }),
    );
    expect(() => parseYtDlpMetadata(' '.repeat(1_048_577), 1_048_576)).toThrow(
      expect.objectContaining({ code: 'ProviderOutputInvalid' }),
    );
  });

  it('preserves typed timeouts and invokes yt-dlp only with the canonical metadata URL', async () => {
    const output = await fixture('video-post.json');
    const { runner, calls } = fakeRunner(successfulResult(output));
    const provider = new XMediaProvider({ runner, executable: '/opt/bin/yt-dlp', limits });
    const operation = context();
    const post = parseXPostUrl('https://x.com/user/status/1?secret=query#fragment');

    await provider.resolve(post, operation);

    expect(calls[0]?.executable).toBe('/opt/bin/yt-dlp');
    expect(calls[0]?.args).toContain('--dump-single-json');
    expect(calls[0]?.args).toContain('--skip-download');
    expect(calls[0]?.args).toContain('--ignore-config');
    expect(calls[0]?.args.at(-1)).toBe('https://x.com/user/status/1');
    expect(calls[0]?.args.join(' ')).not.toMatch(/secret=query|fragment/);
    expect(calls[0]?.stdoutLimitBytes).toBe(limits.maxStdoutBytes);
    operation.dispose();
  });
});
