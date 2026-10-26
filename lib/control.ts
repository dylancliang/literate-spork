// Pause, resume and cancel for a translation run.
// Pause stops new batches from starting; batches already sent finish normally.
// Cancel stops new batches and aborts the ones in flight.

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

export class RunControl {
  paused = false;
  cancelled = false;
  readonly abort = new AbortController();
  private waiters: (() => void)[] = [];

  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
    this.release();
  }
  cancel() {
    this.cancelled = true;
    this.abort.abort();
    this.release();
  }

  /** Waits while paused. Returns false once the run is cancelled. */
  async gate(): Promise<boolean> {
    while (this.paused && !this.cancelled) await new Promise<void>((r) => this.waiters.push(r));
    return !this.cancelled;
  }

  /** Throws CancelledError if the run was cancelled (after waiting out any pause). */
  async checkpoint(): Promise<void> {
    if (!(await this.gate())) throw new CancelledError();
  }

  private release() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }
}
