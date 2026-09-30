import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdmissionControl } from '../../../src/infrastructure/admission-control.js';
import { createRequestId } from '../../../src/shared/identifiers.js';
import { applicationError } from '../../../src/shared/errors.js';

describe('AdmissionControl', () => {
  afterEach(() => vi.useRealTimers());

  it('admits within bounds, queues FIFO, rejects overflow, and releases idempotently', async () => {
    const admission = new AdmissionControl({ maxActive: 1, maxQueued: 2 });
    const signal = new AbortController().signal;
    const first = await admission.acquire({ requestId: createRequestId(), signal });
    const secondPromise = admission.acquire({ requestId: createRequestId(), signal });
    const thirdPromise = admission.acquire({ requestId: createRequestId(), signal });

    await expect(admission.acquire({ requestId: createRequestId(), signal })).rejects.toMatchObject(
      {
        code: 'ServiceBusy',
      },
    );
    first.release();
    first.release();
    const second = await secondPromise;
    expect(admission.snapshot()).toEqual({ active: 1, queued: 1 });
    second.release();
    const third = await thirdPromise;
    expect(admission.snapshot()).toEqual({ active: 1, queued: 0 });
    third.release();
    expect(admission.snapshot()).toEqual({ active: 0, queued: 0 });
  });

  it('maps an expired queue deadline to ServiceBusy', async () => {
    vi.useFakeTimers();
    const admission = new AdmissionControl({ maxActive: 1, maxQueued: 1 });
    const signal = new AbortController().signal;
    const permit = await admission.acquire({ requestId: createRequestId(), signal });
    const waiting = admission.acquire({
      requestId: createRequestId(),
      signal,
      deadlineAt: performance.now() + 50,
    });
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'ServiceBusy' });

    await vi.advanceTimersByTimeAsync(50);

    await rejected;
    expect(admission.snapshot()).toEqual({ active: 1, queued: 0 });
    permit.release();
  });

  it('maps cancellation of a queued request to OperationCancelled', async () => {
    const admission = new AdmissionControl({ maxActive: 1, maxQueued: 1 });
    const active = await admission.acquire({
      requestId: createRequestId(),
      signal: new AbortController().signal,
    });
    const controller = new AbortController();
    const waiting = admission.acquire({ requestId: createRequestId(), signal: controller.signal });

    controller.abort();

    await expect(waiting).rejects.toMatchObject({ code: 'OperationCancelled' });
    expect(admission.snapshot()).toEqual({ active: 1, queued: 0 });
    active.release();
  });

  it('preserves a typed request timeout while queued', async () => {
    const admission = new AdmissionControl({ maxActive: 1, maxQueued: 1 });
    const active = await admission.acquire({ requestId: createRequestId(), signal: new AbortController().signal });
    const controller = new AbortController();
    const waiting = admission.acquire({ requestId: createRequestId(), signal: controller.signal });
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'OperationTimedOut' });
    controller.abort(applicationError('OperationTimedOut', 'admission'));
    await rejected;
    expect(admission.snapshot()).toEqual({ active: 1, queued: 0 });
    active.release();
  });
});
