import type pg from "pg";

/**
 * Holds `userId`'s row lock from a side connection, starts `calls`, waits
 * until every one of them is blocked behind it, then releases and settles them.
 * A writer that skips `lockUsers` never waits, so this throws.
 *
 * The side lock is `NO KEY UPDATE`, the mode `lockUsers` takes: `FOR UPDATE`
 * would also block a foreign-key insert and pass a writer with no lock at all.
 */
export async function whileUserLocked<T>(
  pool: pg.Pool,
  userId: string,
  calls: () => Promise<T>[]
): Promise<T[]> {
  const side = await pool.connect();
  let started: Promise<PromiseSettledResult<T>[]> | undefined;
  try {
    await side.query("BEGIN");
    await side.query("SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE", [userId]);
    const { rows } = await side.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const running = calls();
    started = Promise.allSettled(running);

    const deadline = Date.now() + 5_000;
    for (;;) {
      const blocked = await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
        [rows[0]!.pid]
      );
      if (blocked.rows[0]!.n >= running.length) break;
      if (Date.now() > deadline) {
        throw new Error(`only ${blocked.rows[0]!.n} of ${running.length} writers waited on the user's row lock`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  } finally {
    await side.query("COMMIT").catch(() => undefined);
    side.release();
  }
  const settled = await started!;
  return settled.map((s) => {
    if (s.status === "rejected") throw s.reason;
    return s.value;
  });
}
