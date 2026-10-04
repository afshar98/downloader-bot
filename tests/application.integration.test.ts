import { describe, expect, it, vi } from 'vitest';
import { createGifApplication } from '../src/application.js';
import type { GifApplicationDependencies } from '../src/application.js';
import { AppError } from '../src/errors.js';
import type { GifMedia } from '../src/gif-converter.js';
import type { SourceMedia } from '../src/x-media-provider.js';

const gif = {
  path: '/private/request/animation.gif',
  sizeBytes: 256,
  width: 32,
  height: 32,
  frameCount: 5,
  container: 'gif',
} as unknown as GifMedia;
const source: SourceMedia = {
  url: 'https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/clip.mp4',
  container: 'mp4',
  width: 32,
  height: 32,
};

function setup(overrides: Partial<GifApplicationDependencies> = {}) {
  const workspace = {
    rootPath: '/private/request',
    sourcePath: '/private/request/source.mp4',
    partialGifPath: '/private/request/animation.gif.part',
    gifPath: gif.path,
    dispose: vi.fn(async () => undefined),
  };
  const provider = { getAnimation: vi.fn(async () => source) };
  const downloader = {
    download: vi.fn(async () => ({ path: workspace.sourcePath, sizeBytes: 64 })),
  };
  const converter = { convert: vi.fn(async () => gif) };
  const delivery = { sendAnimation: vi.fn(async () => undefined) };
  const dependencies: GifApplicationDependencies = {
    maxConcurrentJobs: 2,
    jobTimeoutMs: 1000,
    workspaceFactory: async () => workspace,
    provider,
    downloader,
    converter,
    delivery,
    ...overrides,
  };
  const app = createGifApplication(dependencies);
  return {
    app,
    workspace,
    provider: dependencies.provider,
    downloader: dependencies.downloader,
    converter: dependencies.converter,
    delivery: dependencies.delivery,
  };
}

describe('GIF request application', () => {
  it('runs extraction, download, conversion, and GIF delivery in order', async () => {
    const { app, workspace, provider, downloader, converter, delivery } = setup();
    const result = await app.handleRequest(
      { canonicalUrl: 'https://x.com/user/status/123', chatId: 'chat-1' },
      new AbortController().signal,
    );

    expect(result).toBe('delivered');
    expect(provider.getAnimation).toHaveBeenCalledWith(
      'https://x.com/user/status/123',
      expect.any(AbortSignal),
    );
    expect(downloader.download).toHaveBeenCalledWith(
      source,
      workspace.sourcePath,
      expect.any(AbortSignal),
    );
    expect(converter.convert).toHaveBeenCalledWith(
      workspace.sourcePath,
      workspace.partialGifPath,
      workspace.gifPath,
      expect.any(AbortSignal),
    );
    expect(delivery.sendAnimation).toHaveBeenCalledWith('chat-1', gif, expect.any(AbortSignal));
    expect(workspace.dispose).toHaveBeenCalledOnce();
  });

  it.each([
    ['inaccessible', new AppError('post-inaccessible'), 'inaccessible'],
    ['no animation', new AppError('no-animation'), 'no-animation'],
    ['conversion error', new AppError('conversion-failed'), 'failed'],
  ] as const)('maps %s safely and cleans its workspace', async (_label, error, expected) => {
    const { app, workspace, provider } = setup({
      provider: {
        getAnimation: vi.fn(async () => {
          throw error;
        }),
      },
    });
    await expect(
      app.handleRequest(
        { canonicalUrl: 'https://x.com/user/status/123', chatId: 'chat-1' },
        new AbortController().signal,
      ),
    ).resolves.toBe(expected);
    expect(provider.getAnimation).toHaveBeenCalledOnce();
    expect(workspace.dispose).toHaveBeenCalledOnce();
  });

  it('rejects work above the concurrency cap and frees the slot after completion', async () => {
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { app, workspace } = setup({
      maxConcurrentJobs: 1,
      provider: {
        getAnimation: vi.fn(async () => {
          await gate;
          return source;
        }),
      },
    });
    const first = app.handleRequest(
      { canonicalUrl: 'https://x.com/user/status/123', chatId: 'first' },
      new AbortController().signal,
    );
    await Promise.resolve();
    await expect(
      app.handleRequest(
        { canonicalUrl: 'https://x.com/user/status/123', chatId: 'second' },
        new AbortController().signal,
      ),
    ).resolves.toBe('failed');
    finish?.();
    await expect(first).resolves.toBe('delivered');
    expect(workspace.dispose).toHaveBeenCalledOnce();
  });

  it('aborts active media work on shutdown and waits for workspace cleanup', async () => {
    let enteredProvider: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredProvider = resolve;
    });
    const { app, workspace } = setup({
      provider: {
        getAnimation: async (_url, signal) => {
          enteredProvider?.();
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          throw new AppError('cancelled');
        },
      },
    });
    const request = app.handleRequest(
      { canonicalUrl: 'https://x.com/user/status/123', chatId: 'chat-1' },
      new AbortController().signal,
    );
    await entered;

    await app.shutdown();
    await expect(request).resolves.toBe('cancelled');
    expect(workspace.dispose).toHaveBeenCalledOnce();
  });

  it('returns a safe failure after Telegram rejects the upload and still cleans up', async () => {
    const { app, workspace } = setup({
      delivery: {
        sendAnimation: vi.fn(async () => {
          throw new Error('private Telegram response');
        }),
      },
    });
    await expect(
      app.handleRequest(
        { canonicalUrl: 'https://x.com/user/status/123', chatId: 'chat-1' },
        new AbortController().signal,
      ),
    ).resolves.toBe('failed');
    expect(workspace.dispose).toHaveBeenCalledOnce();
  });

  it('fails safely when workspace cleanup does not complete', async () => {
    const { app } = setup({
      workspaceFactory: async () => ({
        rootPath: '/private/request',
        sourcePath: '/private/request/source.mp4',
        partialGifPath: '/private/request/animation.gif.part',
        gifPath: gif.path,
        dispose: async () => {
          throw new Error('private filesystem detail');
        },
      }),
    });
    await expect(
      app.handleRequest(
        { canonicalUrl: 'https://x.com/user/status/123', chatId: 'chat-1' },
        new AbortController().signal,
      ),
    ).resolves.toBe('failed');
  });

  it('reports only a safe stage and error code for an internal failure', async () => {
    const onFailure = vi.fn();
    const privateDetails = 'private diagnostic https://video.twimg.com/private?token=secret';
    const { app } = setup({
      provider: {
        getAnimation: async () => {
          throw new AppError('extraction-failed', privateDetails);
        },
      },
      onFailure,
    });

    await expect(
      app.handleRequest(
        { canonicalUrl: 'https://x.com/user/status/123', chatId: 'private-chat-id' },
        new AbortController().signal,
      ),
    ).resolves.toBe('failed');
    expect(onFailure).toHaveBeenCalledWith({ stage: 'extract', code: 'extraction-failed' });
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain('private');
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain('private-chat-id');
  });
});
