import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOperationContext } from '../../../src/application/operation-context.js';
import { createRequestId } from '../../../src/shared/identifiers.js';

describe('operation deadlines', () => {
  afterEach(() => vi.useRealTimers());

  it('composes caller cancellation into the job signal', () => {
    const caller = new AbortController();
    const context = createOperationContext({
      requestId: createRequestId(),
      signal: caller.signal,
      jobTimeoutMs: 1_000,
    });

    caller.abort();

    expect(context.signal.aborted).toBe(true);
    expect(context.signal.reason).toMatchObject({ code: 'OperationCancelled' });
    context.dispose();
  });

  it('bounds a stage by its timeout and the remaining job deadline', async () => {
    vi.useFakeTimers();
    const context = createOperationContext({
      requestId: createRequestId(),
      signal: new AbortController().signal,
      jobTimeoutMs: 100,
    });
    const stage = context.createStageSignal('download', 250);

    await vi.advanceTimersByTimeAsync(100);

    expect(stage.signal.aborted).toBe(true);
    expect(stage.signal.reason).toMatchObject({ code: 'OperationTimedOut' });
    expect(context.remainingMs()).toBe(0);
    stage.dispose();
    context.dispose();
  });

  it('uses the shorter stage timeout', async () => {
    vi.useFakeTimers();
    const context = createOperationContext({
      requestId: createRequestId(),
      signal: new AbortController().signal,
      jobTimeoutMs: 1_000,
    });
    const stage = context.createStageSignal('delivery', 50);

    await vi.advanceTimersByTimeAsync(50);

    expect(stage.signal.aborted).toBe(true);
    expect(stage.signal.reason).toMatchObject({ code: 'OperationTimedOut', stage: 'delivery' });
    stage.dispose();
    context.dispose();
  });
});
