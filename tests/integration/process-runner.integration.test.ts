import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XMediaProvider } from '../../src/providers/x/x-media-provider.js';
import { createOperationContext } from '../../src/application/operation-context.js';
import { createRequestId } from '../../src/shared/identifiers.js';
import { applicationError } from '../../src/shared/errors.js';
import { runControlledChild } from '../support/process/controlled-child.js';

describe('controlled process integration', () => {
  it('writes controlled binary child output to a capped file and leaves no partial on overflow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'controlled-binary-'));
    try {
      const outputPath = join(root, 'item.gif.part');
      const result = await runControlledChild('binary', {
        stdoutFile: { path: outputPath, maxBytes: 6 },
        stage: 'processing',
      });
      expect(result).toMatchObject({ stdout: '', outputBytes: 6, exitCode: 0 });
      expect(await readFile(outputPath)).toEqual(Buffer.from('GIF89a'));

      const overflowPath = join(root, 'overflow.part');
      await expect(
        runControlledChild('binary', {
          stdoutFile: { path: overflowPath, maxBytes: 5 },
          stage: 'processing',
        }),
      ).rejects.toMatchObject({ code: 'MediaTooLarge', stage: 'processing' });
      expect(await readdir(root)).toEqual(['item.gif.part']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('terminates a timed out controlled extractor process', async () => {
    await expect(runControlledChild('wait', { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'OperationTimedOut',
    });
  });

  it('maps non-zero rate-limit output without exposing process diagnostics', async () => {
    const runner = {
      run: () => runControlledChild('non-zero'),
      checkVersion: async () => 'fixture',
    };
    const provider = new XMediaProvider({
      runner,
      executable: process.execPath,
      limits: {
        extractionTimeoutMs: 2_000,
        maxStdoutBytes: 1024,
        maxStderrBytes: 1024,
        maxMetadataBytes: 1024,
      },
    });
    const context = createOperationContext({
      requestId: createRequestId(),
      signal: new AbortController().signal,
      jobTimeoutMs: 2_000,
    });
    await expect(
      provider.resolve(
        { provider: 'x', postId: '1', canonicalUrl: new URL('https://x.com/u/status/1') },
        context,
      ),
    ).rejects.toMatchObject({ code: 'ProviderRateLimited' });
    context.dispose();
  });

  it('maps malformed and capped metadata output to ProviderOutputInvalid', async () => {
    for (const mode of ['malformed', 'oversized'] as const) {
      const runner = {
        run: () => runControlledChild(mode, { stdoutLimitBytes: mode === 'oversized' ? 32 : 1024 }),
        checkVersion: async () => 'fixture',
      };
      const provider = new XMediaProvider({
        runner,
        executable: process.execPath,
        limits: {
          extractionTimeoutMs: 2_000,
          maxStdoutBytes: 1024,
          maxStderrBytes: 1024,
          maxMetadataBytes: 1024,
        },
      });
      const context = createOperationContext({
        requestId: createRequestId(),
        signal: new AbortController().signal,
        jobTimeoutMs: 2_000,
      });
      await expect(
        provider.resolve(
          { provider: 'x', postId: '1', canonicalUrl: new URL('https://x.com/u/status/1') },
          context,
        ),
      ).rejects.toMatchObject({ code: 'ProviderOutputInvalid' });
      context.dispose();
    }
  });

  it('terminates when caller cancellation arrives', async () => {
    const controller = new AbortController();
    const running = runControlledChild('wait', { signal: controller.signal });
    setTimeout(() => controller.abort(applicationError('OperationCancelled', 'provider')), 20);
    await expect(running).rejects.toMatchObject({ code: 'OperationCancelled' });
  });
});
