import { mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessingBudget } from '../../../src/application/models.js';
import type { ProcessRunnerPort } from '../../../src/application/ports.js';
import { createOperationContext } from '../../../src/application/operation-context.js';
import { GifMediaProcessor } from '../../../src/media/gif-media-processor.js';
import { TemporaryWorkspaceFactory } from '../../../src/infrastructure/temporary-workspace.js';
import { createRequestId } from '../../../src/shared/identifiers.js';
import { applicationError } from '../../../src/shared/errors.js';
import { downloadedMedia } from '../../support/builders.js';
import { tinyGif, tinyPngSignature } from '../../support/ffmpeg/gif-fixtures.js';

const roots: string[] = [];
async function createRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'gif-processor-'));
  roots.push(path);
  return path;
}

async function setup() {
  const parent = await createRoot();
  const factory = new TemporaryWorkspaceFactory({ parentDirectory: parent });
  const workspace = await factory.create(createRequestId());
  const handle = await workspace.createPartFile(1);
  await handle.writeFile('synthetic-mp4');
  await handle.close();
  await workspace.finalizeItem(1);
  const context = createOperationContext({
    requestId: createRequestId(),
    signal: new AbortController().signal,
    jobTimeoutMs: 30_000,
  });
  return { parent, factory, workspace, context };
}

function budget(
  signal = new AbortController().signal,
  remainingMs: () => number = () => 10_000,
): ProcessingBudget {
  return { signal, deadlineAt: 10_000, remainingMs };
}

function successfulRunner(
  overrides: {
    gif?: Buffer;
    firstExitCode?: number;
    onRun?: (request: Parameters<ProcessRunnerPort['run']>[0]) => void;
  } = {},
): ProcessRunnerPort {
  let outputCount = 0;
  return {
    checkVersion: vi.fn(),
    run: vi.fn(async (request) => {
      overrides.onRun?.(request);
      if (request.stdoutFile) {
        outputCount += 1;
        const bytes = outputCount === 1 ? tinyPngSignature : (overrides.gif ?? tinyGif);
        const handle = await open(request.stdoutFile.path, 'wx', 0o600);
        await handle.writeFile(bytes);
        await handle.close();
        return {
          stdout: '',
          stderr: '',
          exitCode: outputCount === 1 ? (overrides.firstExitCode ?? 0) : 0,
          signal: null,
          outputBytes: bytes.byteLength,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0, signal: null };
    }),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('GifMediaProcessor', () => {
  it('converts only confirmed silence with bounded two-pass local FFmpeg and retires the palette', async () => {
    const { workspace, context, factory } = await setup();
    let remainingCalls = 0;
    const seen: Parameters<ProcessRunnerPort['run']>[0][] = [];
    const runner = successfulRunner({ onRun: (request) => seen.push(request) });
    const processor = new GifMediaProcessor({
      executable: '/trusted/ffmpeg',
      maxMediaBytes: 49 * 1024 * 1024,
      runner,
    });
    const media = downloadedMedia({
      kind: 'animation',
      audioPresence: 'absent',
      path: workspace.itemPaths(1).mediaPath,
      sizeBytes: Buffer.byteLength('synthetic-mp4'),
    });

    const result = await processor.prepare(
      media,
      context,
      workspace,
      budget(undefined, () => 10_000 - remainingCalls++ * 1_000),
    );

    expect(result).toMatchObject({
      downloaded: media,
      deliveryPath: workspace.itemPaths(1).gifPath,
      deliverySizeBytes: tinyGif.byteLength,
      deliveryKind: 'animation',
      deliveryContainer: 'gif',
      transformed: true,
    });
    expect(seen).toHaveLength(3);
    expect(seen.map((request) => request.timeoutMs)).toEqual([9_000, 8_000, 7_000]);
    expect(seen[0]?.stdoutFile?.maxBytes).toBe(16 * 1024);
    expect(seen[1]?.stdoutFile?.maxBytes).toBe(49 * 1024 * 1024);
    expect(seen[0]?.args).toContain(
      "fps=15,scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease:flags=lanczos,setsar=1,palettegen=max_colors=256",
    );
    expect(seen[0]?.args).toEqual(
      expect.arrayContaining([
        '-protocol_whitelist',
        'file',
        '-enable_drefs',
        '0',
        '-use_absolute_path',
        '0',
        '-vf',
        expect.stringContaining('palettegen=max_colors=256'),
        '-frames:v',
        '1',
        'pipe:1',
      ]),
    );
    expect(seen[1]?.args).toEqual(
      expect.arrayContaining(['-f', 'png_pipe', '-loop', '0', '-f', 'gif', 'pipe:1']),
    );
    for (const request of seen) {
      expect(request.executable).toBe('/trusted/ffmpeg');
      expect(request.signal).toBeDefined();
      expect(request.args).not.toContain('-t');
    }
    expect(seen[2]?.args).toEqual(
      expect.arrayContaining([
        '-xerror',
        '-err_detect',
        'explode',
        '-ignore_loop',
        '1',
        '-f',
        'null',
      ]),
    );
    expect(await readdir(workspace.root)).toEqual(['item-0001.gif', 'item-0001.mp4']);
    expect(await readFile(workspace.itemPaths(1).gifPath)).toEqual(tinyGif);
    context.dispose();
    await factory.cleanup(workspace);
  });

  it.each(['unknown', 'present'] as const)(
    'keeps %s media on the direct video path without invoking FFmpeg',
    async (audioPresence) => {
      const { workspace, context, factory } = await setup();
      const runner = successfulRunner();
      const processor = new GifMediaProcessor({
        executable: 'ffmpeg',
        maxMediaBytes: 49 * 1024 * 1024,
        runner,
      });
      const media = downloadedMedia({
        path: workspace.itemPaths(1).mediaPath,
        audioPresence,
      });

      await expect(processor.prepare(media, context, workspace, budget())).resolves.toMatchObject({
        deliveryKind: 'video',
        deliveryContainer: 'mp4',
        deliveryPath: media.path,
        transformed: false,
      });
      expect(runner.run).not.toHaveBeenCalled();
      context.dispose();
      await factory.cleanup(workspace);
    },
  );

  it('cleans partial conversion files after a failed FFmpeg pass', async () => {
    const { workspace, context, factory } = await setup();
    const runner = successfulRunner({ firstExitCode: 1 });
    const processor = new GifMediaProcessor({ executable: 'ffmpeg', maxMediaBytes: 1024, runner });
    const media = downloadedMedia({
      kind: 'animation',
      audioPresence: 'absent',
      path: workspace.itemPaths(1).mediaPath,
      sizeBytes: Buffer.byteLength('synthetic-mp4'),
    });

    await expect(processor.prepare(media, context, workspace, budget())).rejects.toMatchObject({
      code: 'MediaProcessingFailed',
      stage: 'processing',
    });
    expect(await readdir(workspace.root)).toEqual(['item-0001.mp4']);
    context.dispose();
    await factory.cleanup(workspace);
  });

  it('does not spawn conversion when the shared budget is already exhausted', async () => {
    const { workspace, context, factory } = await setup();
    const runner = successfulRunner();
    const processor = new GifMediaProcessor({ executable: 'ffmpeg', maxMediaBytes: 1024, runner });
    const media = downloadedMedia({
      kind: 'animation',
      audioPresence: 'absent',
      path: workspace.itemPaths(1).mediaPath,
      sizeBytes: Buffer.byteLength('synthetic-mp4'),
    });
    await expect(
      processor.prepare(
        media,
        context,
        workspace,
        budget(undefined, () => 0),
      ),
    ).rejects.toMatchObject({ code: 'OperationTimedOut', stage: 'processing' });
    expect(runner.run).not.toHaveBeenCalled();
    context.dispose();
    await factory.cleanup(workspace);
  });

  it('preserves cancellation through the same budget signal', async () => {
    const { workspace, context, factory } = await setup();
    const controller = new AbortController();
    controller.abort(applicationError('OperationCancelled', 'admission'));
    const runner = successfulRunner();
    const processor = new GifMediaProcessor({ executable: 'ffmpeg', maxMediaBytes: 1024, runner });
    const media = downloadedMedia({
      kind: 'animation',
      audioPresence: 'absent',
      path: workspace.itemPaths(1).mediaPath,
      sizeBytes: Buffer.byteLength('synthetic-mp4'),
    });
    await expect(
      processor.prepare(media, context, workspace, budget(controller.signal)),
    ).rejects.toMatchObject({
      code: 'OperationCancelled',
      stage: 'processing',
    });
    expect(runner.run).not.toHaveBeenCalled();
    context.dispose();
    await factory.cleanup(workspace);
  });
});
