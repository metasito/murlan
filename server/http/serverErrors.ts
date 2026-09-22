// Every server log line at `error` or above, kept long enough to be read on /admin.
import { sql } from "drizzle-orm";
import { db } from "../store/db.ts";
import { serverErrors } from "../../shared/schema.ts";
import { setErrorRecorder } from "./logger.ts";

/** The same window as client crash reports. */
export const SERVER_ERROR_RETENTION_DAYS = 90;

const MESSAGE_MAX = 500;

export function installServerErrorRecorder(): void {
  setErrorRecorder(({ level, msg, time: _time, pid: _pid, hostname: _host, ...context }) => {
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
