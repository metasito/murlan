// Every server log line at `error` or above, kept long enough to be read on /admin.
import { now } from "./clock.ts";
import { sql } from "drizzle-orm";
import { db, pool } from "../store/db.ts";
import { serverErrors } from "../../shared/schema.ts";
import { setErrorRecorder } from "./logger.ts";

/** The same window as client crash reports. */
export const SERVER_ERROR_RETENTION_DAYS = 90;

const MESSAGE_MAX = 500;

/** How far back /admin's error groups look; the rows themselves are kept longer. */
export const ERROR_GROUP_WINDOW_DAYS = 7;

const HOUR_MS = 3_600_000;
const WINDOW_MS = ERROR_GROUP_WINDOW_DAYS * 24 * HOUR_MS;

const WINDOW_HOURS = WINDOW_MS / HOUR_MS;

/** Lines skipped while the pool starved: one slot per hour of the window, stamped with its hour; this process only. */
const dropped = Array.from({ length: WINDOW_HOURS }, () => ({ hour: -1, count: 0 }));

function countDropped(at: number): void {
  const hour = Math.floor(at / HOUR_MS);
  const slot = dropped[hour % WINDOW_HOURS]!;
  if (slot.hour !== hour) Object.assign(slot, { hour, count: 0 });
  slot.count += 1;
}

/** Server error lines this process skipped writing within the error-group window. */
export function serverErrorsDropped(at = now()): number {
  const hour = Math.floor(at / HOUR_MS);
  return dropped.reduce((total, slot) => (slot.hour > hour - WINDOW_HOURS ? total + slot.count : total), 0);
}

export function installServerErrorRecorder(): void {
  setErrorRecorder(({ level, msg, time: _time, pid: _pid, hostname: _host, ...context }) => {
    // An error burst is usually the pool starving; an insert per line would
    // queue behind the very requests that are failing.
    if (pool.waitingCount > 0) {
      countDropped(now());
      process.stderr.write(
        `server_errors insert skipped, pool starved (${serverErrorsDropped()} dropped in ` +
          `${ERROR_GROUP_WINDOW_DAYS} days): ${String(msg ?? "")}\n`
      );
      return;
    }
    db.insert(serverErrors)
      .values({ level: Number(level), message: String(msg ?? "").slice(0, MESSAGE_MAX), context })
      .catch((err: unknown) => {
        process.stderr.write(`server_errors insert failed: ${String(err)}\n`);
      });
  });
}

export type ServerErrorGroup = {
  message: string;
  count: number;
  lastSeen: string;
};

export async function recentServerErrorGroups(limit: number): Promise<ServerErrorGroup[]> {
  const rows = await db.execute<ServerErrorGroup>(sql`
    SELECT message, count(*)::int AS count, max(occurred_at) AS "lastSeen"
    FROM server_errors
    WHERE occurred_at >= now() - make_interval(days => ${ERROR_GROUP_WINDOW_DAYS})
    GROUP BY message
    ORDER BY "lastSeen" DESC
    LIMIT ${limit}
  `);
  return rows.rows;
}

export async function serverErrorsThisWeek(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM server_errors
    WHERE occurred_at >= now() - make_interval(days => 7)
  `);
  return rows.rows[0]?.n ?? 0;
}
