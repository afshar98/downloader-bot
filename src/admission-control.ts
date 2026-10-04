import { AppError } from './errors.js';

export class AdmissionControl {
  private active = 0;

  constructor(private readonly maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1)
      throw new RangeError('maximum must be positive');
  }

  get activeCount(): number {
    return this.active;
  }

  acquire(): () => void {
    if (this.active >= this.maximum) throw new AppError('busy');
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}
