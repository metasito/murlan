/**
 * Waiting for a `pg` pool to go quiet, shared by the shutdown path and the
 * integration harness. Pure — takes the counters structurally and imports
 * nothing, so a caller can use it without pulling in `server/db.ts`, which
 * builds the app's Pool from `DATABASE_URL` at import time.
 */

export interface PoolActivity {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

export interface DrainOptions {
  /** Upper bound on the whole wait. */
  timeoutMs?: number;
  /** How long the pool must stay quiet before it counts as drained. */
  quietMs?: number;
  pollMs?: number;
}

/**
 * Resolves once no client has been checked out of `pool` for `quietMs`, or
 * once `timeoutMs` elapses. Returns whether it drained.
 *
 * A single observation of zero would not mean anything: the chains this exists
 * to protect — the disconnect handler, `handleGameOver`, `persistGameState` —
 * are sequences of awaited queries, and the count drops to zero in the gap
 * between two of them. Quiescence has to hold for a moment to be quiescence.
 */
export async function drainPool(
  pool: PoolActivity,
  { timeoutMs = 5_000, quietMs = 50, pollMs = 25 }: DrainOptions = {}
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let quietSince: number | null = null;

  for (;;) {
    const busy = pool.totalCount - pool.idleCount + pool.waitingCount;
    if (busy === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMs) return true;
    } else {
      quietSince = null;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
