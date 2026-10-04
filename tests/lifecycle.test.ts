import { describe, expect, it } from 'vitest';
import { AdmissionControl } from '../src/admission-control.js';
import { ShutdownController } from '../src/shutdown.js';

describe('AdmissionControl', () => {
  it('limits active jobs and releases capacity idempotently', () => {
    const admission = new AdmissionControl(1);
    const release = admission.acquire();

    expect(admission.activeCount).toBe(1);
    expect(() => admission.acquire()).toThrowError();
    release();
    release();
    expect(admission.activeCount).toBe(0);
    expect(admission.acquire()).toBeTypeOf('function');
  });
});

describe('ShutdownController', () => {
  it('aborts active work, waits for it to settle, and rejects new work', async () => {
    const lifecycle = new ShutdownController();
    let finished = false;
    const work = lifecycle.run(async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      finished = true;
    });

    await Promise.resolve();
    await lifecycle.shutdown();
    await work;
    expect(finished).toBe(true);
    await expect(lifecycle.run(async () => undefined)).rejects.toMatchObject({ code: 'cancelled' });
  });
});
