import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemporaryWorkspaceFactory } from '../../../src/infrastructure/temporary-workspace.js';
import { createRequestId } from '../../../src/shared/identifiers.js';

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'downloader-workspace-test-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('TemporaryWorkspaceFactory', () => {
  it('creates unique isolated roots and generated item paths', async () => {
    const parentDirectory = await createRoot();
    const factory = new TemporaryWorkspaceFactory({ parentDirectory });
    const first = await factory.create(createRequestId());
    const second = await factory.create(createRequestId());

    expect(first.root).not.toBe(second.root);
    expect(first.itemPaths(1)).toEqual({
      partPath: join(first.root, 'item-0001.part'),
      mediaPath: join(first.root, 'item-0001.mp4'),
      palettePartPath: join(first.root, 'item-0001.palette.part'),
      palettePath: join(first.root, 'item-0001.palette.png'),
      gifPartPath: join(first.root, 'item-0001.gif.part'),
      gifPath: join(first.root, 'item-0001.gif'),
    });
    expect(() => first.itemPaths(0)).toThrow(RangeError);
    expect(() => first.itemPaths(1.5)).toThrow(RangeError);
    expect(() => first.itemPaths(10_000)).toThrow(RangeError);
    await factory.cleanup(first);
    await factory.cleanup(second);
    expect(await readdir(parentDirectory)).toEqual([]);
  });

  it('creates files exclusively, finalizes by rename, and removes partials idempotently', async () => {
    const parentDirectory = await createRoot();
    const factory = new TemporaryWorkspaceFactory({ parentDirectory });
    const workspace = await factory.create(createRequestId());
    const handle = await workspace.createPartFile(1);
    await handle.writeFile('media-data');
    await handle.close();
    await expect(workspace.createPartFile(1)).rejects.toMatchObject({ code: 'EEXIST' });
    await workspace.finalizeItem(1);
    expect(await readFile(workspace.itemPaths(1).mediaPath, 'utf8')).toBe('media-data');
    await workspace.removePartial(2);
    await workspace.removePartial(2);
    await factory.cleanup(workspace);
    await factory.cleanup(workspace);
    await expect(lstat(workspace.root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('finalizes conversion artifacts and removes them without deleting the source', async () => {
    const parentDirectory = await createRoot();
    const factory = new TemporaryWorkspaceFactory({ parentDirectory });
    const workspace = await factory.create(createRequestId());
    const paths = workspace.itemPaths(1);
    await writeFile(paths.partPath, 'source');
    await workspace.finalizeItem(1);
    await writeFile(paths.palettePartPath, 'palette');
    await workspace.finalizePalette(1);
    await writeFile(paths.gifPartPath, 'gif');
    await workspace.finalizeGif(1);

    await workspace.removeConversion(1);
    expect(await readdir(workspace.root)).toEqual(['item-0001.mp4']);
    await workspace.removeItem(1);
    await workspace.removeItem(1);
    expect(await readdir(workspace.root)).toEqual([]);
    await factory.cleanup(workspace);
  });

  it('rejects a symlinked parent before creating a workspace', async () => {
    const realParent = await createRoot();
    const link = join(realParent, 'link');
    await symlink(realParent, link);
    const factory = new TemporaryWorkspaceFactory({
      parentDirectory: link,
      logger: { error: vi.fn() },
    });

    await expect(factory.create(createRequestId())).rejects.toMatchObject({
      code: 'ServiceBusy',
      stage: 'cleanup',
    });
    expect(await readdir(realParent)).toEqual(['link']);
  });

  it('logs a deletion failure and retries cleanup without leaving residual files', async () => {
    const parentDirectory = await createRoot();
    let attempts = 0;
    const removeDirectory = vi.fn(async (path: string) => {
      attempts += 1;
      if (attempts === 1) throw new Error('/tmp/private path must not be logged');
      await rm(path, { recursive: true, force: true });
    });
    const logger = { error: vi.fn() };
    const factory = new TemporaryWorkspaceFactory({
      parentDirectory,
      removeDirectory,
      logger,
    });
    const workspace = await factory.create(createRequestId());

    await factory.cleanup(workspace);

    expect(removeDirectory).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/private path|\/tmp/);
    expect(await readdir(parentDirectory)).toEqual([]);
  });
});
