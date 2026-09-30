import { applicationError, type ErrorStage } from '../shared/errors.js';
import type { RequestId } from '../shared/identifiers.js';

export type StageSignal = Readonly<{
  signal: AbortSignal;
  dispose(): void;
}>;

export type OperationContext = Readonly<{
  requestId: RequestId;
  signal: AbortSignal;
  deadlineAt: number;
  remainingMs(): number;
  createStageSignal(stage: ErrorStage, timeoutMs: number): StageSignal;
  dispose(): void;
}>;

export type OperationContextOptions = Readonly<{
  requestId: RequestId;
  signal: AbortSignal;
  jobTimeoutMs: number;
  now?: () => number;
}>;

export function createOperationContext(options: OperationContextOptions): OperationContext {
  const now = options.now ?? (() => performance.now());
  const deadlineAt = now() + options.jobTimeoutMs;
  const controller = new AbortController();
  const callerAbort = () =>
    controller.abort(
      applicationError('OperationCancelled', 'admission', { cause: options.signal.reason }),
    );
  if (options.signal.aborted) callerAbort();
  else options.signal.addEventListener('abort', callerAbort, { once: true });

  const jobTimer = setTimeout(
    () => {
      controller.abort(applicationError('OperationTimedOut', 'admission'));
    },
    Math.max(0, options.jobTimeoutMs),
  );
  jobTimer.unref?.();

  return {
    requestId: options.requestId,
    signal: controller.signal,
    deadlineAt,
    remainingMs: () => Math.max(0, deadlineAt - now()),
    createStageSignal(stage, timeoutMs) {
      const stageController = new AbortController();
      const forwardAbort = () => stageController.abort(controller.signal.reason);
      if (controller.signal.aborted) forwardAbort();
      else controller.signal.addEventListener('abort', forwardAbort, { once: true });

      const duration = Math.max(0, Math.min(timeoutMs, deadlineAt - now()));
      const stageTimer = setTimeout(() => {
        stageController.abort(applicationError('OperationTimedOut', stage));
      }, duration);
      stageTimer.unref?.();

      return {
        signal: stageController.signal,
        dispose() {
          clearTimeout(stageTimer);
          controller.signal.removeEventListener('abort', forwardAbort);
        },
      };
    },
    dispose() {
      clearTimeout(jobTimer);
      options.signal.removeEventListener('abort', callerAbort);
    },
  };
}
