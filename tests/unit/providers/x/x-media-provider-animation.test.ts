import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessRunnerPort } from '../../../../src/application/ports.js';
import type { ProcessExecutionResult } from '../../../../src/application/models.js';
import { createOperationContext } from '../../../../src/application/operation-context.js';
import { XMediaProvider } from '../../../../src/providers/x/x-media-provider.js';
import { parseXPostUrl } from '../../../../src/providers/x/x-url.js';
import { createRequestId } from '../../../../src/shared/identifiers.js';

describe('XMediaProvider animation mapping', () => {
  it('retains GIF animation entries and excludes static images', async () => {
    const stdout = await readFile(
      new URL('../../../fixtures/x/animation.json', import.meta.url),
      'utf8',
    );
    const result: ProcessExecutionResult = { stdout, stderr: '', exitCode: 0, signal: null };
    const runner: ProcessRunnerPort = {
      run: vi.fn(async () => result),
      checkVersion: vi.fn(async () => 'yt-dlp 2026.09.01'),
    };
    const provider = new XMediaProvider({
      runner,
      executable: 'yt-dlp',
      limits: {
        extractionTimeoutMs: 30_000,
        maxStdoutBytes: 1_048_576,
        maxStderrBytes: 65_536,
        maxMetadataBytes: 1_048_576,
      },
    });
    const context = createOperationContext({
      requestId: createRequestId(),
      signal: new AbortController().signal,
      jobTimeoutMs: 115_000,
    });

    const media = await provider.resolve(parseXPostUrl('https://x.com/user/status/2'), context);

    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({
      mediaId: 'animated-gif',
      kind: 'animation',
      audioPresence: 'absent',
    });
    expect(media[0]?.representations[0]?.audioEvidence).toBe('absent');
    expect(media[0]?.representations[0]?.representationId).toBe('animation-mp4');
    context.dispose();
  });
});
