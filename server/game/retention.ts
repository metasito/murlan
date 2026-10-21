// The only home of every age-based delete (tests/server/retentionOffWritePath.test.ts), run by
// server/game/gamePersistence.ts's startSweeper.
import { gte, lt, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "../store/db.ts";
import { roomStore } from "../store/roomStore.ts";
import { now } from "../http/clock.ts";
import {
  activeGames,
  events,
  clientErrors,
  roundReplays,
  authTokens,
  bugReports,
  serverErrors,
  socketTicketNonces,
  rooms,
} from "../../shared/schema.ts";
import { activeGames as liveGames } from "./gameRoom.ts";
import { EVENT_RETENTION_DAYS } from "../shared/events.ts";
import { CLIENT_ERROR_RETENTION_DAYS } from "../http/clientErrors.ts";
import { SERVER_ERROR_RETENTION_DAYS } from "../http/serverErrors.ts";
import { REPLAY_RETENTION_DAYS } from "../../lib/game/replay.ts";
import { BUG_REPORT_RETENTION_DAYS } from "../http/bugReports.ts";
import { TICKET_TTL_MS } from "../socket/ticket.ts";
import { logger } from "../shared/logger.ts";

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
 *
 * Age is the only cluster signal read: whichever instance holds the game writes
 * `updated_at`, so no other check is made, and a game left untouched for a day on
 * a live instance is taken with the rest.
 */
export const ABANDONED_GAME_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * How long a `rooms` row may live before the sweeper takes it.
 *
 * Derived from `created_at` rather than a "finished at" column, because a
 * timestamp on `rooms` would be a new column on a table written every time
 * anyone opens a table — the write that breaks until `db:push` runs. No game
 * lasts a day, so age alone separates a live room from a dead one, and it
 * covers the rooms a restart stranded in `waiting` as well as the finished
 * ones.
 */
export const STALE_ROOM_MAX_AGE_MS = 24 * 60 * 60_000;

const BATCH = 5_000;
const MAX_BATCHES = 20;
const STALE_ROOM_BATCH = 500;

/**
 * At most `batch × maxBatches` rows per call, `batch` per statement: one
 * unbatched DELETE over a backlog outruns the pool's `statement_timeout` and
 * then never shrinks it.
 */
export async function deleteInBatches(
  table: PgTable,
  where: SQL,
  batch = BATCH,
  maxBatches = MAX_BATCHES
): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const result = await db().execute(
      sql`DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${where} LIMIT ${batch})`
    );
    const gone = result.rowCount ?? 0;
    total += gone;
    if (gone < batch) break;
  }
  return total;
}

/**
 * Deletes `active_games` rows untouched for longer than
 * `ABANDONED_GAME_MAX_AGE_MS`. Returns how many went, so a caller can tell
 * "nothing to do" from "did not run".
 */
export async function pruneAbandonedGames(): Promise<number> {
  const gone = await deleteInBatches(
    activeGames,
    lt(activeGames.updatedAt, new Date(now() - ABANDONED_GAME_MAX_AGE_MS))
  );
  if (gone > 0) logger.info({ count: gone }, "Pruned abandoned games orphaned by a restart");
  return gone;
}

/**
 * Deletes rooms nobody can still be playing in, and the seats that name them.
 *
 * A room whose `active_games` row was touched within the window is held by a
 * live game on some instance, so the cluster's answer comes from that row; the
 * in-memory map answers only for this instance.
 *
 * A room still waiting has no such row, and nothing written while it waits
 * (`users.last_seen` is stamped on disconnect) says it is live, so a lobby open
 * for longer than the window on another instance is purged.
 */
export async function pruneStaleRooms(): Promise<number> {
  const cutoff = new Date(now() - STALE_ROOM_MAX_AGE_MS);
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { rows } = await db().execute<{ id: string }>(
      sql`SELECT ${rooms.id} AS id FROM ${rooms}
          WHERE ${lt(rooms.createdAt, cutoff)}
            AND NOT EXISTS (
              SELECT 1 FROM ${activeGames}
              WHERE ${activeGames.roomId} = ${rooms.id} AND ${gte(activeGames.updatedAt, cutoff)}
            )
          LIMIT ${STALE_ROOM_BATCH}`
    );
    const ids = rows.map((r) => r.id).filter((id) => !liveGames.has(id));
    if (ids.length === 0) break;
    const gone = await db().transaction((tx) => roomStore.purgeRooms(tx, ids));
    total += gone;
    if (rows.length < STALE_ROOM_BATCH || gone === 0) break;
  }
  if (total > 0) logger.info({ count: total }, "Pruned rooms nobody can still be playing in");
  return total;
}

/**
 * Never thrown: this is diagnostic hygiene, not gameplay, and one rule
 * failing (e.g. a transient connection error) must not stop the others —
 * each rule is independent and gets its own try/catch.
 */
export async function sweepRetention(): Promise<void> {
  const daysAgo = (days: number) => sql`now() - make_interval(days => ${days})`;
  await pruneOlderThan("events", () =>
    deleteInBatches(events, lt(events.occurredAt, daysAgo(EVENT_RETENTION_DAYS)))
  );
  await pruneOlderThan("client_errors", () =>
    deleteInBatches(clientErrors, lt(clientErrors.occurredAt, daysAgo(CLIENT_ERROR_RETENTION_DAYS)))
  );
  await pruneOlderThan("server_errors", () =>
    deleteInBatches(serverErrors, lt(serverErrors.occurredAt, daysAgo(SERVER_ERROR_RETENTION_DAYS)))
  );
  await pruneOlderThan("round_replays", () =>
    deleteInBatches(roundReplays, lt(roundReplays.finishedAt, new Date(now() - REPLAY_RETENTION_DAYS * DAY_MS)))
  );
  await pruneOlderThan("auth_tokens", () =>
    deleteInBatches(authTokens, lt(authTokens.expiresAt, new Date(now())))
  );
  await pruneOlderThan("bug_reports", () =>
    deleteInBatches(bugReports, lt(bugReports.createdAt, daysAgo(BUG_REPORT_RETENTION_DAYS)))
  );
  await pruneOlderThan("socket_ticket_nonces", () =>
    deleteInBatches(socketTicketNonces, lt(socketTicketNonces.expiresAt, new Date(now() - TICKET_TTL_MS)))
  );
  await pruneOlderThan("active_games", pruneAbandonedGames);
  await pruneOlderThan("rooms", pruneStaleRooms);
}

async function pruneOlderThan(table: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    logger.error({ err, table }, "Retention sweep failed");
  }
}
