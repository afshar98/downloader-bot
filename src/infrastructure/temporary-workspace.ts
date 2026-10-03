import { open, lstat, mkdtemp, rename, rm, unlink, access } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  TemporaryWorkspace as WorkspaceContract,
  WorkspaceItemPaths,
} from '../application/models.js';
import { applicationError } from '../shared/errors.js';
import type { RequestId } from '../shared/identifiers.js';
import { createLogger, type StructuredLogger } from './logger.js';

export type ItemPaths = WorkspaceItemPaths;

export interface ManagedTemporaryWorkspace extends WorkspaceContract {
  createPartFile(position: number): Promise<FileHandle>;
}

export type TemporaryWorkspaceFactoryOptions = Readonly<{
  parentDirectory: string;
  logger?: Pick<StructuredLogger, 'error'>;
  removeDirectory?: (path: string) => Promise<void>;
  onFatalResourceFailure?: (reason: 'workspace-cleanup-incomplete') => void;
}>;

export class TemporaryWorkspaceFactory {
  private readonly logger: Pick<StructuredLogger, 'error'>;
  private readonly removeDirectory: (path: string) => Promise<void>;
  private readonly closeWorkspace = new WeakMap<WorkspaceContract, () => void>();
  private readonly requestIds = new WeakMap<WorkspaceContract, RequestId>();

  constructor(private readonly options: TemporaryWorkspaceFactoryOptions) {
    this.logger = options.logger ?? createLogger({ level: 'error' });
    this.removeDirectory =
      options.removeDirectory ?? ((path) => rm(path, { recursive: true, force: true }));
  }

  async create(requestId: RequestId): Promise<ManagedTemporaryWorkspace> {
    try {
      const parent = await lstat(this.options.parentDirectory);
      if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('untrusted parent');
      await access(this.options.parentDirectory, 2);
      const root = await mkdtemp(join(this.options.parentDirectory, 'xmd-'));
      const workspace = this.createWorkspace(root);
      this.requestIds.set(workspace, requestId);
      return workspace;
    } catch (cause) {
      this.logger.error(
        { requestId, stage: 'cleanup', code: 'ServiceBusy' },
        'temporary workspace could not be created',
      );
      throw applicationError('ServiceBusy', 'cleanup', { cause });
    }
  }

  async cleanup(workspace: WorkspaceContract): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await this.removeDirectory(workspace.root);
        this.closeWorkspace.get(workspace)?.();
        return;
      } catch {
        this.logger.error(
          {
            ...(this.requestIds.get(workspace)
              ? { requestId: this.requestIds.get(workspace) }
              : {}),
            stage: 'cleanup',
            code: 'CleanupFailed',
            attempt,
          },
          'temporary workspace cleanup failed',
        );
        if (attempt === 2) {
          try {
            this.options.onFatalResourceFailure?.('workspace-cleanup-incomplete');
          } catch {
            // Fatal signaling must not interrupt cleanup outcome handling.
          }
        }
      }
    }
  }

  private createWorkspace(root: string): ManagedTemporaryWorkspace {
    let closed = false;
    const itemPaths = (position: number): ItemPaths => {
      if (!Number.isSafeInteger(position) || position < 1 || position > 9_999) {
        throw new RangeError('Item position must be an integer from 1 through 9999');
      }
      if (closed) throw new Error('Temporary workspace is closed');
      const basename = `item-${String(position).padStart(4, '0')}`;
      return {
        partPath: join(root, `${basename}.part`),
        mediaPath: join(root, `${basename}.mp4`),
        palettePartPath: join(root, `${basename}.palette.part`),
        palettePath: join(root, `${basename}.palette.png`),
        gifPartPath: join(root, `${basename}.gif.part`),
        gifPath: join(root, `${basename}.gif`),
      };
    };
    const removePath = async (path: string) => {
      try {
        await unlink(path);
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
    };
    const workspace: ManagedTemporaryWorkspace = {
      root,
      itemPaths,
      createPartFile: async (position) => open(itemPaths(position).partPath, 'wx', 0o600),
      finalizeItem: async (position) => {
        const paths = itemPaths(position);
        await rename(paths.partPath, paths.mediaPath);
      },
      finalizePalette: async (position) => {
        const paths = itemPaths(position);
        await rename(paths.palettePartPath, paths.palettePath);
      },
      finalizeGif: async (position) => {
        const paths = itemPaths(position);
        await rename(paths.gifPartPath, paths.gifPath);
      },
      removePalette: async (position) => {
        const paths = itemPaths(position);
        await Promise.all([paths.palettePartPath, paths.palettePath].map(removePath));
      },
      removePartial: async (position) => removePath(itemPaths(position).partPath),
      removeConversion: async (position) => {
        const paths = itemPaths(position);
        await Promise.all(
          [paths.palettePartPath, paths.palettePath, paths.gifPartPath, paths.gifPath].map(
            removePath,
          ),
        );
      },
      removeItem: async (position) => {
        const paths = itemPaths(position);
        await Promise.all(Object.values(paths).map(removePath));
      },
    };
    this.closeWorkspace.set(workspace, () => {
      closed = true;
    });
    return workspace;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
