// Retention as a property of each table, not of each write.
//
// events.ts, clientErrors.ts, replays.ts, authTokens.ts and bugReports.ts
// each used to prune their own table inside the write that just grew it,
// each citing the others as precedent. That idiom put a DELETE on every
// request's critical path (write cost) and, for events/auth_tokens, made it
// a full-table seq scan (shared/schema.ts had no index on either predicate).
// One scheduled sweep, called from server/game/gamePersistence.ts's existing
// startSweeper interval, replaces all five.
import { lt, sql } from "drizzle-orm";
import { db } from "../store/db.ts";
import { now } from "../http/clock.ts";
import {
  activeGames,
  events,
  clientErrors,
  roundReplays,
  authTokens,
  bugReports,
  serverErrors,
} from "../../shared/schema.ts";
import { EVENT_RETENTION_DAYS } from "../socket/events.ts";
import { CLIENT_ERROR_RETENTION_DAYS } from "../http/clientErrors.ts";
import { SERVER_ERROR_RETENTION_DAYS } from "../http/serverErrors.ts";
import { REPLAY_RETENTION_DAYS } from "../../lib/game/replay.ts";
import { BUG_REPORT_RETENTION_DAYS } from "../http/bugReports.ts";
import { logger } from "../http/logger.ts";

const DAY_MS = 24 * 60 * 60_000;

/**
 * How long an `active_games` row may sit untouched before it is abandoned.
 *
 * Every path that deletes a row walks the in-memory `activeGames`, which a
 * restart empties — so a game live when the process went down, and never
 * rejoined, is invisible to all of them. On a host that sleeps, that is every
 * sleep with a game open.
 *
 * A day is far past any live game: `persistGameState` refreshes `updated_at`
 * on every move. The margin is so a rejoinable row is never taken from under
 * a player.
 */
export const ABANDONED_GAME_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * Deletes `active_games` rows untouched for longer than
 * `ABANDONED_GAME_MAX_AGE_MS`. Returns how many went, so a caller can tell
 * "nothing to do" from "did not run".
 */
export async function pruneAbandonedGames(): Promise<number> {
  const gone = await db
    .delete(activeGames)
    .where(lt(activeGames.updatedAt, new Date(now() - ABANDONED_GAME_MAX_AGE_MS)))
    .returning({ roomId: activeGames.roomId });
  if (gone.length > 0) logger.info({ count: gone.length }, "Pruned abandoned games orphaned by a restart");
  return gone.length;
}

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
  await pruneOlderThan("server_errors", () =>
    db
      .delete(serverErrors)
      .where(lt(serverErrors.occurredAt, sql`now() - make_interval(days => ${SERVER_ERROR_RETENTION_DAYS})`))
  );
  await pruneOlderThan("round_replays", () =>
    db
      .delete(roundReplays)
      .where(lt(roundReplays.finishedAt, new Date(now() - REPLAY_RETENTION_DAYS * DAY_MS)))
  );
  await pruneOlderThan("auth_tokens", () =>
    db.delete(authTokens).where(lt(authTokens.expiresAt, new Date(now())))
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
