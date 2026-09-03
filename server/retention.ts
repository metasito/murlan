// Retention as a property of each table, not of each write.
//
// events.ts, clientErrors.ts, replays.ts, authTokens.ts and bugReports.ts
// each used to prune their own table inside the write that just grew it,
// each citing the others as precedent. That idiom put a DELETE on every
// request's critical path (write cost) and, for events/auth_tokens, made it
// a full-table seq scan (shared/schema.ts had no index on either predicate).
// One scheduled sweep, called from server/gamePersistence.ts's existing
// startSweeper interval, replaces all five.
import { lt, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { events, clientErrors, matchReplays, authTokens, bugReports } from "../shared/schema.ts";
import { EVENT_RETENTION_DAYS } from "./events.ts";
import { CLIENT_ERROR_RETENTION_DAYS } from "./clientErrors.ts";
import { REPLAY_RETENTION_DAYS } from "../lib/replay.ts";
import { BUG_REPORT_RETENTION_DAYS } from "./bugReports.ts";
import { logger } from "./logger.ts";

/**
 * Never thrown: this is diagnostic hygiene, not gameplay, and one rule
 * failing (e.g. a transient connection error) must not stop the others —
 * each DELETE is independent and gets its own try/catch.
 */
export async function sweepRetention(): Promise<void> {
  await pruneOlderThan("events", () =>
    db.delete(events).where(lt(events.occurredAt, sql`now() - make_interval(days => ${EVENT_RETENTION_DAYS})`))
  );
  await pruneOlderThan("client_errors", () =>
    db
      .delete(clientErrors)
      .where(lt(clientErrors.occurredAt, sql`now() - make_interval(days => ${CLIENT_ERROR_RETENTION_DAYS})`))
  );
  await pruneOlderThan("match_replays", () =>
    db
      .delete(matchReplays)
      .where(lt(matchReplays.finishedAt, sql`now() - make_interval(days => ${REPLAY_RETENTION_DAYS})`))
  );
  await pruneOlderThan("auth_tokens", () =>
    db.delete(authTokens).where(lt(authTokens.expiresAt, sql`now()`))
  );
  await pruneOlderThan("bug_reports", () =>
    db
      .delete(bugReports)
      .where(lt(bugReports.createdAt, sql`now() - make_interval(days => ${BUG_REPORT_RETENTION_DAYS})`))
  );
}

async function pruneOlderThan(table: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    logger.error({ err, table }, "Retention sweep failed");
  }
}
