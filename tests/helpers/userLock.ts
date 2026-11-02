import pg from "pg";
import { eventually } from "./client.ts";

/**
 * Takes a row lock from a side connection and holds it until `release`.
 * `waitForBlocked(n)` resolves once `n` sessions are queued behind it and throws
 * once `eventually` gives up, so a writer that skips the lock fails the test.
 */
export async function holdRowLock(lockSql: string, params: unknown[]) {
  // Its own pool, not the app's: a lock held on one of the app's clients takes it from the writers it blocks.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const side = await pool.connect();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await side.query("COMMIT").catch(() => undefined);
    side.release();
    await pool.end();
  };
  try {
    await side.query("BEGIN");
    await side.query(lockSql, params);
  } catch (err) {
    await release();
    throw err;
  }
  const { rows } = await side.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");

  /**
   * Resolves once `n` writers wait on the lock. With `matching`, only waiters whose statement it
   * matches count: another writer that happens to take the same rows is not the one waited for.
   */
  async function waitForBlocked(n: number, matching?: RegExp) {
    let queued: string[] = [];
    await eventually(async () => {
      // Transitively: a second waiter queues behind the first one's tuple
      // lock, so only the first names the side connection as its blocker.
      const blocked = await pool.query<{ query: string }>(
        `WITH RECURSIVE blocked(pid) AS (
           SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
           UNION
           SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
         ) SELECT a.query FROM pg_stat_activity a JOIN blocked b ON a.pid = b.pid`,
        [rows[0]!.pid]
      );
      queued = blocked.rows.map((r) => r.query);
      return queued.filter((q) => !matching || matching.test(q)).length >= n;
    }, `${n} writers queued on the row lock`).catch(() => {
      throw new Error(`only these waited on the row lock, ${n} wanted${matching ? ` matching ${matching}` : ""}: ${JSON.stringify(queued)}`);
    });
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
  userIds: string[],
  calls: () => Promise<T>[]
): Promise<T[]> {
  const lock = await holdRowLock("SELECT id FROM users WHERE id = ANY($1) FOR NO KEY UPDATE", [userIds]);
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
