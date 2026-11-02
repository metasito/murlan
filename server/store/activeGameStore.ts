import { and, count, eq, lt, sql } from "drizzle-orm";
import { db, type Database } from "./db.ts";
import { activeGames, ownerEpochs } from "../../shared/schema.ts";
import { now } from "../http/clock.ts";
import type { roomStore } from "./roomStore.ts";
import {
  GAME_SCHEMA_VERSION,
  OLDEST_GAME_SCHEMA_VERSION,
  type PersistedEnvelope,
} from "../../shared/persistedEnvelope.ts";

export interface ActiveGameRow {
  roomId: string;
  gameState: unknown;
}

/** What a claim took: an epoch no other claim has had, and the row it found, if any. */
export interface Claimed {
  epoch: number;
  row: ActiveGameRow | undefined;
}

const nextEpoch = sql<string>`nextval(${sql.raw(`'${ownerEpochs.seqName}'`)})`;

/** A persisted table the orphan sweep may wake, and who sits at it in seat order. */
export interface ResumableRow {
  roomId: string;
  userIds: string[];
}

const row = { roomId: activeGames.roomId, gameState: activeGames.gameState };
const mine = (roomId: string, epoch: number) => and(eq(activeGames.roomId, roomId), eq(activeGames.ownerEpoch, epoch));

const version = sql`${activeGames.gameState}->'schemaVersion'`;
const playerMap = sql`${activeGames.gameState}->'match'->'playerMap'`;
// String ids in seat order. Narrower than `readPersistedPlayerMap`, which takes any key `Number()`
// reads as a seat: only digit keys, the one kind `packPersistedState`'s integer seats serialize to.
const seatedUserIds = sql<string[]>`array(
  select seat.value #>> '{}'
  from jsonb_each(case when jsonb_typeof(${playerMap}) = 'object' then ${playerMap} else '{}'::jsonb end) seat
  where jsonb_typeof(seat.value) = 'string' and seat.key ~ '^[0-9]+$'
  order by seat.key::numeric
)`;

/** Outside the stores, only `retention.ts` reaches `active_games` past this (`tests/server/activeGameStoreScan.test.ts`). */
export const activeGameStore = {
  async load(roomId: string): Promise<ActiveGameRow | undefined> {
    const [found] = await db().select(row).from(activeGames).where(eq(activeGames.roomId, roomId));
    return found;
  },

  /** Moves the row to a fresh epoch and reads it in one statement; with no row, only takes one. */
  async claim(roomId: string): Promise<Claimed> {
    const [found] = await db()
      .update(activeGames)
      .set({ ownerEpoch: nextEpoch })
      .where(eq(activeGames.roomId, roomId))
      .returning({ ...row, ownerEpoch: activeGames.ownerEpoch });
    if (found) return { epoch: found.ownerEpoch, row: { roomId: found.roomId, gameState: found.gameState } };
    const { rows } = await db().execute<{ epoch: string }>(sql`SELECT ${nextEpoch} AS epoch`);
    return { epoch: Number(rows[0]?.epoch), row: undefined };
  },

  async epochOf(roomId: string): Promise<number | undefined> {
    const [found] = await db()
      .select({ ownerEpoch: activeGames.ownerEpoch })
      .from(activeGames)
      .where(eq(activeGames.roomId, roomId));
    return found?.ownerEpoch;
  },

  /** Every table at a version `unpackPersistedState` accepts whose deal is still in play: what the orphan sweep may wake. */
  listResumable(): Promise<ResumableRow[]> {
    return db()
      .select({ roomId: activeGames.roomId, userIds: seatedUserIds })
      .from(activeGames)
      .where(
        and(
          // A CASE, because Postgres may evaluate an AND's operands in either order.
          sql`case when jsonb_typeof(${version}) = 'number'
            then (${version})::numeric between ${OLDEST_GAME_SCHEMA_VERSION} and ${GAME_SCHEMA_VERSION}
            else false end`,
          sql`(${activeGames.gameState}->'gameState'->>'roundOver') is distinct from 'true'`
        )
      );
  },

  /**
   * Writes the row at `epoch`, inserting it when there is none: a table whose row an exempt
   * writer deleted under it (an account deletion purging the host's rooms) plays on. False when
   * the row carries another epoch, which stays as it was.
   */
  async write(roomId: string, gameState: PersistedEnvelope, epoch: number): Promise<boolean> {
    const updatedAt = new Date(now());
    const changed = await db()
      .insert(activeGames)
      .values({ roomId, gameState, updatedAt, ownerEpoch: epoch })
      .onConflictDoUpdate({
        target: activeGames.roomId,
        set: { gameState, updatedAt },
        setWhere: eq(activeGames.ownerEpoch, epoch),
      })
      .returning({ roomId: activeGames.roomId });
    return changed.length > 0;
  },

  /** Deletes the row at `epoch`. False when the row carries another epoch, and stays. */
  async remove(roomId: string, epoch: number): Promise<boolean> {
    const gone = await db().delete(activeGames).where(mine(roomId, epoch)).returning({ roomId: activeGames.roomId });
    if (gone.length > 0) return true;
    return (await activeGameStore.epochOf(roomId)) === undefined;
  },

  async countUntouchedSince(database: Database, cutoff: Date): Promise<number> {
    const [found] = await database.select({ n: count() }).from(activeGames).where(lt(activeGames.updatedAt, cutoff));
    return found?.n ?? 0;
  },
};

/** The table runtime's narrow room port; the type server-output's deps object will take. */
export type TableRoomPort = Pick<
  typeof roomStore,
  | "getRoomById"
  | "getRoomPlayers"
  | "updateRoomStatus"
  | "releaseSeat"
  | "restoreSeat"
  | "upsertRoomPlayer"
  | "closeForStart"
>;
