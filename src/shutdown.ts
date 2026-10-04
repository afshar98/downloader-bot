import { AppError } from './errors.js';

type ActiveTask = Readonly<{ controller: AbortController; promise: Promise<unknown> }>;

export class ShutdownController {
  private closing = false;
  private readonly active = new Set<ActiveTask>();
  private shutdownPromise: Promise<void> | undefined;

  run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new AppError('cancelled'));
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => operation(controller.signal));
    const task = { controller, promise };
    this.active.add(task);
    return promise.finally(() => this.active.delete(task));
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closing = true;
    for (const task of this.active) task.controller.abort();
    this.shutdownPromise = Promise.allSettled([...this.active].map(({ promise }) => promise)).then(
      () => undefined,
    );
    return this.shutdownPromise;
  }
}
