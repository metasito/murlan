export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

let installed = realClock;

/** Epoch ms on the installed clock: the one wall-time read in server/ (eslint guard `murlan/server-reads-one-clock`). */
export function now(): number {
  return installed.now();
}

/** For gameTimers' arm and clear only. */
export function clock(): Clock {
  return installed;
}

/** Installs `next` process-wide and returns the restore. */
export function installClock(next: Clock): () => void {
  const previous = installed;
  installed = next;
  return () => {
    installed = previous;
  };
}
