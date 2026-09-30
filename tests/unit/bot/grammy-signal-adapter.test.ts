import { describe, expect, it, vi } from 'vitest';
import type { AbortSignal as GrammyAbortSignal } from 'abort-controller';
import {
  bridgeAbortSignal,
  callGrammyWithAbortSignal,
} from '../../../src/bot/grammy-signal-adapter.js';

describe('grammY abort signal bridge', () => {
  it('forwards caller cancellation to the grammY API signal', () => {
    const controller = new AbortController();
    const bridge = bridgeAbortSignal(controller.signal);
    expect(bridge.signal.aborted).toBe(false);
    controller.abort();
    expect(bridge.signal.aborted).toBe(true);
    bridge.dispose();
  });

  it('preserves a caller signal that was already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    const bridge = bridgeAbortSignal(controller.signal);
    expect(bridge.signal.aborted).toBe(true);
    bridge.dispose();
  });

  it('removes the parent listener after the API call settles', () => {
    const controller = new AbortController();
    const bridge = bridgeAbortSignal(controller.signal);
    bridge.dispose();
    controller.abort();
    expect(bridge.signal.aborted).toBe(false);
  });

  it.each(['sendVideo', 'sendAnimation'] as const)(
    'forwards job cancellation into the %s API request and disposes the bridge',
    async (method) => {
      const controller = new AbortController();
      let receivedSignal: GrammyAbortSignal | undefined;
      let cancellationObserved = false;
      const apiRequest = vi.fn(async (signal: GrammyAbortSignal) => {
        receivedSignal = signal;
        await new Promise<void>((_resolve) => {
          const observeAbort = () => {
            cancellationObserved = signal.aborted;
            _resolve();
          };
          if (signal.aborted) observeAbort();
          else signal.addEventListener('abort', observeAbort, { once: true });
        });
      });
      const api = { sendVideo: apiRequest, sendAnimation: apiRequest };
      const pending = callGrammyWithAbortSignal(controller.signal, (signal) => api[method](signal));
      expect(receivedSignal).toBeDefined();
      controller.abort();
      await pending;
      expect(api[method]).toHaveBeenCalledTimes(1);
      expect(receivedSignal?.aborted).toBe(true);
      expect(cancellationObserved).toBe(true);
    },
  );
});
