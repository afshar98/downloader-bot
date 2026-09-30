import { applicationError, operationAbortError } from '../shared/errors.js';
import type { RequestId } from '../shared/identifiers.js';
import type { AdmissionPermit } from '../application/models.js';

export type Permit = AdmissionPermit;
export type AdmissionRequest = Readonly<{
  requestId: RequestId;
  signal: AbortSignal;
  deadlineAt?: number;
}>;

type Waiter = {
  requestId: RequestId;
  signal: AbortSignal;
  deadlineAt?: number;
  resolve: (permit: Permit) => void;
  reject: (reason: unknown) => void;
  onAbort: () => void;
  timer?: ReturnType<typeof setTimeout>;
};

export class AdmissionControl {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(private readonly limits: Readonly<{ maxActive: number; maxQueued: number }>) {
    if (!Number.isSafeInteger(limits.maxActive) || limits.maxActive < 1) {
      throw new RangeError('maxActive must be a positive integer');
    }
    if (!Number.isSafeInteger(limits.maxQueued) || limits.maxQueued < 0) {
      throw new RangeError('maxQueued must be a non-negative integer');
    }
  }

  acquire(request: AdmissionRequest): Promise<Permit> {
    if (request.signal.aborted) {
      return Promise.reject(
        operationAbortError(request.signal.reason, 'admission'),
      );
    }
    if (request.deadlineAt !== undefined && request.deadlineAt <= performance.now()) {
      return Promise.reject(applicationError('ServiceBusy', 'admission'));
    }
    if (this.active < this.limits.maxActive) {
      this.active += 1;
      return Promise.resolve(this.createPermit(request.requestId));
    }
    if (this.queue.length >= this.limits.maxQueued) {
      return Promise.reject(applicationError('ServiceBusy', 'admission'));
    }

    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        requestId: request.requestId,
        signal: request.signal,
        ...(request.deadlineAt !== undefined ? { deadlineAt: request.deadlineAt } : {}),
        resolve,
        reject,
        onAbort: () => this.removeWaiter(waiter, 'cancelled'),
      };
      request.signal.addEventListener('abort', waiter.onAbort, { once: true });
      if (request.deadlineAt !== undefined) {
        waiter.timer = setTimeout(
          () => this.removeWaiter(waiter, 'expired'),
          Math.max(0, request.deadlineAt - performance.now()),
        );
        waiter.timer.unref?.();
      }
      this.queue.push(waiter);
    });
  }

  snapshot(): Readonly<{ active: number; queued: number }> {
    return { active: this.active, queued: this.queue.length };
  }

  private createPermit(requestId: RequestId): Permit {
    let released = false;
    return {
      requestId,
      release: () => {
        if (released) return;
        released = true;
        this.active -= 1;
        this.admitNext();
      },
    };
  }

  private admitNext(): void {
    while (this.active < this.limits.maxActive && this.queue.length > 0) {
      const waiter = this.queue.shift();
      if (!waiter) return;
      this.clearWaiter(waiter);
      if (waiter.signal.aborted) {
        waiter.reject(
          operationAbortError(waiter.signal.reason, 'admission'),
        );
        continue;
      }
      if (waiter.deadlineAt !== undefined && waiter.deadlineAt <= performance.now()) {
        waiter.reject(applicationError('ServiceBusy', 'admission'));
        continue;
      }
      this.active += 1;
      waiter.resolve(this.createPermit(waiter.requestId));
    }
  }

  private removeWaiter(waiter: Waiter, reason: 'cancelled' | 'expired'): void {
    const index = this.queue.indexOf(waiter);
    if (index < 0) return;
    this.queue.splice(index, 1);
    this.clearWaiter(waiter);
    if (reason === 'cancelled') {
      waiter.reject(
        operationAbortError(waiter.signal.reason, 'admission'),
      );
    } else {
      waiter.reject(applicationError('ServiceBusy', 'admission'));
    }
  }

  private clearWaiter(waiter: Waiter): void {
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.signal.removeEventListener('abort', waiter.onAbort);
  }
}
