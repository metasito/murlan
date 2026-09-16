import type pg from "pg";

/**
 * Takes a row lock from a side connection and holds it until `release`.
 * `waitForBlocked(n)` resolves once `n` sessions are queued behind it and throws
 * after five seconds, so a writer that skips the lock fails the test.
 */
export async function holdRowLock(pool: pg.Pool, lockSql: string, params: unknown[]) {
  const side = await pool.connect();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await side.query("COMMIT").catch(() => undefined);
    side.release();
  };
  try {
    await side.query("BEGIN");
    await side.query(lockSql, params);
  } catch (err) {
    await release();
    throw err;
  }
  const { rows } = await side.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");

  async function waitForBlocked(n: number) {
    const deadline = Date.now() + 5_000;
    for (;;) {
      // Transitively: a second waiter queues behind the first one's tuple
      // lock, so only the first names the side connection as its blocker.
      const blocked = await pool.query<{ n: number }>(
        `WITH RECURSIVE blocked(pid) AS (
           SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
           UNION
           SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
         ) SELECT count(*)::int AS n FROM blocked`,
        [rows[0]!.pid]
      );
      if (blocked.rows[0]!.n >= n) return;
      if (Date.now() > deadline) {
        throw new Error(`only ${blocked.rows[0]!.n} of ${n} writers waited on the row lock`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  return { waitForBlocked, release };
}

/**
 * Holds these users' row locks, starts `calls`, waits until every one of them
 * is blocked behind it, then releases and settles them.
 *
 * The side lock is `NO KEY UPDATE`, the mode `lockUsers` takes: `FOR UPDATE`
 * would also block a foreign-key insert and pass a writer with no lock at all.
 */
export async function whileUserLocked<T>(
  pool: pg.Pool,
  userIds: string[],
  calls: () => Promise<T>[]
): Promise<T[]> {
  const lock = await holdRowLock(pool, "SELECT id FROM users WHERE id = ANY($1) FOR NO KEY UPDATE", [userIds]);
  let started: Promise<PromiseSettledResult<T>[]> | undefined;
  try {
    const running = calls();
    started = Promise.allSettled(running);
    await lock.waitForBlocked(running.length);
  } finally {
    await lock.release();
  }
  const settled = await started!;
  return settled.map((s) => {
    if (s.status === "rejected") throw s.reason;
    return s.value;
  });
}
