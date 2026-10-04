import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type RequestWorkspace = Readonly<{
  rootPath: string;
  sourcePath: string;
  partialGifPath: string;
  gifPath: string;
  dispose(): Promise<void>;
}>;

export async function createTemporaryWorkspace(
  baseDirectory = tmpdir(),
): Promise<RequestWorkspace> {
  const rootPath = await mkdtemp(join(baseDirectory, 'xgif-'));
  try {
    await chmod(rootPath, 0o700);
  } catch (cause) {
    await rm(rootPath, { recursive: true, force: true });
    throw cause;
  }
  let disposal: Promise<void> | undefined;

  return {
    rootPath,
    sourcePath: join(rootPath, 'source.mp4'),
    partialGifPath: join(rootPath, 'animation.gif.part'),
    gifPath: join(rootPath, 'animation.gif'),
    dispose() {
      disposal ??= rm(rootPath, { recursive: true, force: true });
      return disposal;
    },
  };
}
