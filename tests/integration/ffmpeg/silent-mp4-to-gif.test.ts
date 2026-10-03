import { mkdtemp, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InputFile } from 'grammy';
import { afterEach, describe, expect, it } from 'vitest';
import { createOperationContext } from '../../../src/application/operation-context.js';
import type { ProcessingBudget } from '../../../src/application/models.js';
import { TelegramDelivery } from '../../../src/bot/telegram-delivery.js';
import { verifyFfmpegVersion } from '../../../src/config/verify-ffmpeg-version.js';
import { ProcessRunner } from '../../../src/infrastructure/process-runner.js';
import { TemporaryWorkspaceFactory } from '../../../src/infrastructure/temporary-workspace.js';
import { GifMediaProcessor } from '../../../src/media/gif-media-processor.js';
import {
  createDeliveryDestination,
  type DownloadedMedia,
} from '../../../src/application/models.js';
import { createRequestId } from '../../../src/shared/identifiers.js';

const roots: string[] = [];
async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ffmpeg-acceptance-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('controlled approved-FFmpeg acceptance', () => {
  it('converts a synthetic silent MP4 to a valid animated GIF and uploads the GIF bytes', async () => {
    const executable = process.env['FFMPEG_PATH']?.trim();
    const expectedVersion = process.env['FFMPEG_EXPECTED_VERSION']?.trim();
    expect(executable, 'FFMPEG_PATH must be set for the controlled FFmpeg lane').toBeTruthy();
    expect(
      expectedVersion,
      'FFMPEG_EXPECTED_VERSION must be set for the controlled FFmpeg lane',
    ).toBeTruthy();

    const runner = new ProcessRunner();
    await verifyFfmpegVersion(runner, executable!, expectedVersion!);
    const parent = await createRoot();
    const factory = new TemporaryWorkspaceFactory({ parentDirectory: parent });
    const workspace = await factory.create(createRequestId());
    const position = 1;
    const paths = workspace.itemPaths(position);
    const sourceBytes = await readFile(
      new URL('../../fixtures/media/tiny-silent.mp4', import.meta.url),
    );
    const sourceHandle = await open(paths.partPath, 'wx', 0o600);
    await sourceHandle.writeFile(sourceBytes);
    await sourceHandle.close();
    await workspace.finalizeItem(position);
    const media: DownloadedMedia = {
      mediaId: 'synthetic-silent',
      position,
      kind: 'animation',
      audioPresence: 'absent',
      path: paths.mediaPath,
      sizeBytes: sourceBytes.byteLength,
      container: 'mp4',
    };
    const context = createOperationContext({
      requestId: createRequestId(),
      signal: new AbortController().signal,
      jobTimeoutMs: 60_000,
    });
    const startedAt = performance.now();
    const processingStage = context.createStageSignal('processing', 30_000);
    const budget: ProcessingBudget = {
      signal: processingStage.signal,
      deadlineAt: Math.min(context.deadlineAt, startedAt + 30_000),
      remainingMs: () =>
        Math.max(0, Math.min(context.remainingMs(), startedAt + 30_000 - performance.now())),
    };
    const processor = new GifMediaProcessor({
      executable: executable!,
      maxMediaBytes: 49 * 1024 * 1024,
      runner,
    });

    const prepared = await processor.prepare(media, context, workspace, budget);
    const gifStat = await stat(prepared.deliveryPath);
    expect(prepared).toMatchObject({
      deliveryPath: paths.gifPath,
      deliveryKind: 'animation',
      deliveryContainer: 'gif',
      transformed: true,
    });
    expect(gifStat.size).toBeGreaterThan(20);
    expect(gifStat.size).toBeLessThanOrEqual(49 * 1024 * 1024);
    expect(prepared.deliverySizeBytes).toBe(gifStat.size);

    const profile = await runner.run({
      stage: 'processing',
      executable: executable!,
      args: [
        '-hide_banner',
        '-loglevel',
        'info',
        '-nostdin',
        '-protocol_whitelist',
        'file',
        '-f',
        'gif',
        '-ignore_loop',
        '1',
        '-i',
        prepared.deliveryPath,
        '-vf',
        'showinfo',
        '-an',
        '-threads',
        '1',
        '-f',
        'null',
        '-',
      ],
      timeoutMs: Math.max(1, Math.floor(budget.remainingMs())),
      stdoutLimitBytes: 16 * 1024,
      stderrLimitBytes: 16 * 1024,
      signal: budget.signal,
    });
    expect(profile.exitCode).toBe(0);
    expect(profile.stderr).toContain('s:32x24');
    const frameLines = profile.stderr.match(/n:\s*\d+[^\n]*s:32x24/g) ?? [];
    expect(frameLines.length).toBeGreaterThan(1);

    const sent: Buffer[] = [];
    const delivery = new TelegramDelivery({
      timeoutMs: 5_000,
      api: {
        sendVideo: async () => {
          throw new Error('silent fixture must be uploaded as GIF');
        },
        sendAnimation: async (_destination, file) => sent.push(await inputBytes(file)),
      },
    });
    await delivery.deliver(createDeliveryDestination('-100123'), prepared, context);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(await readFile(paths.gifPath));
    expect(sent[0]).not.toEqual(sourceBytes);
    expect(await readdir(workspace.root)).toEqual(['item-0001.gif', 'item-0001.mp4']);

    context.dispose();
    processingStage.dispose();
    await workspace.removeItem(position);
    await factory.cleanup(workspace);
    expect(await readdir(parent)).toEqual([]);
  });
});

async function inputBytes(file: InputFile): Promise<Buffer> {
  const value = await file.toRaw();
  if (value instanceof Uint8Array) return Buffer.from(value);
  const chunks: Uint8Array[] = [];
  for await (const chunk of value) chunks.push(chunk);
  return Buffer.concat(chunks);
}
