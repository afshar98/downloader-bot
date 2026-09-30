import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeliveryDestination } from '../../../src/application/models.js';
import { DownloadPostMedia } from '../../../src/application/download-post-media.js';
import { AdmissionControl } from '../../../src/infrastructure/admission-control.js';
import { TemporaryWorkspaceFactory } from '../../../src/infrastructure/temporary-workspace.js';
import { RepresentationSelector } from '../../../src/media/representation-selector.js';
import { createRequestId } from '../../../src/shared/identifiers.js';
import { discoveredMedia, downloadedMedia, preparedMedia } from '../../support/builders.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe('download stream admission', () => {
  it('limits concurrent media downloads to the configured slot count', async () => {
    const root = await mkdtemp(join(tmpdir(), 'download-admission-'));
    roots.push(root);
    let entered = 0;
    let active = 0;
    let maximum = 0;
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const downloadAdmission = new AdmissionControl({ maxActive: 1, maxQueued: 2 });
    const app = new DownloadPostMedia({
      provider: {
        recognizes: () => true,
        validate: () => ({
          provider: 'x',
          postId: '1',
          canonicalUrl: new URL('https://x.com/u/status/1'),
        }),
        resolve: async () => [discoveredMedia()],
      },
      downloader: {
        download: async ({ media }) => {
          active += 1;
          entered += 1;
          maximum = Math.max(maximum, active);
          if (entered === 1) await gate;
          active -= 1;
          return downloadedMedia({ mediaId: media.mediaId, position: media.position });
        },
      },
      processor: { prepare: async (media) => preparedMedia({ media }) },
      delivery: {
        deliver: async (_destination, media) => ({ itemPosition: media.downloaded.position }),
      },
      admission: new AdmissionControl({ maxActive: 2, maxQueued: 0 }),
      downloadAdmission,
      workspaceFactory: new TemporaryWorkspaceFactory({ parentDirectory: root }),
      selector: new RepresentationSelector(),
      limits: {
        maxMediaBytes: 51_380_224,
        jobTimeoutMs: 5_000,
        downloadTimeoutMs: 1_000,
        maxRedirects: 3,
      },
    });
    const request = (chat: string) =>
      app.execute({
        destination: createDeliveryDestination(chat),
        messageText: 'https://x.com/u/status/1',
        candidateUrl: 'https://x.com/u/status/1',
        requestId: createRequestId(),
        signal: new AbortController().signal,
      });
    const first = request('first');
    await viWaitFor(() => entered === 1);
    const second = request('second');
    await Promise.resolve();
    await viWaitFor(() => downloadAdmission.snapshot().queued === 1);
    expect(downloadAdmission.snapshot()).toEqual({ active: 1, queued: 1 });
    open();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ kind: 'complete' }),
      expect.objectContaining({ kind: 'complete' }),
    ]);
    expect(maximum).toBe(1);
    expect(downloadAdmission.snapshot()).toEqual({ active: 0, queued: 0 });
  });
});

async function viWaitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 1));
}
