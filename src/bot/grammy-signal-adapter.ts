import { AbortController as GrammyAbortController } from 'abort-controller';
import type { AbortSignal as GrammyAbortSignal } from 'abort-controller';

export type GrammySignalBridge = Readonly<{
  signal: GrammyAbortSignal;
  dispose(): void;
}>;

export function bridgeAbortSignal(signal: AbortSignal): GrammySignalBridge {
  const controller = new GrammyAbortController();
  const forwardAbort = () => controller.abort();

  if (signal.aborted) forwardAbort();
  else signal.addEventListener('abort', forwardAbort, { once: true });

  return {
    signal: controller.signal,
    dispose() {
      signal.removeEventListener('abort', forwardAbort);
    },
  };
}

export async function callGrammyWithAbortSignal<T>(
  signal: AbortSignal,
  request: (signal: GrammyAbortSignal) => Promise<T>,
): Promise<T> {
  const bridge = bridgeAbortSignal(signal);
  try {
    return await request(bridge.signal);
  } finally {
    bridge.dispose();
  }
}
