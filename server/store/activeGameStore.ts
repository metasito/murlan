import { and, count, eq, lt, sql } from "drizzle-orm";
import { db, type Database, type Tx } from "./db.ts";
import { activeGames, activeGameSettled, ownerEpochs } from "../../shared/schema.ts";
import { now } from "../http/clock.ts";
import type { roomStore } from "./roomStore.ts";
import {
  GAME_SCHEMA_VERSION,
  OLDEST_GAME_SCHEMA_VERSION,
  type PendingResult,
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

/** A persisted table the orphan sweep may wake or owes a results commit, and who sits at it in seat order. */
export interface ResumableRow {
  roomId: string;
  userIds: string[];
  /** Its deal is over: only its pending results are owed. */
  roundOver: boolean;
  /** It holds a round whose results have not committed. */
  pending: boolean;
}

const row = { roomId: activeGames.roomId, gameState: activeGames.gameState };
const mine = (roomId: string, epoch: number) => and(eq(activeGames.roomId, roomId), eq(activeGames.ownerEpoch, epoch));

const pending = sql`${activeGames.gameState}->'pendingResults'`;
const roundOver = sql`(${activeGames.gameState}->'gameState'->>'roundOver') is not distinct from 'true'`;
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

  /**
   * Every table at a version `unpackPersistedState` accepts whose deal is still in play, or whose
   * results are still pending: what the orphan sweep may wake or commit.
   */
  listResumable(): Promise<ResumableRow[]> {
    return db()
      .select({
        roomId: activeGames.roomId,
        userIds: seatedUserIds,
        roundOver: sql<boolean>`${roundOver}`,
        pending: sql<boolean>`not ${activeGameSettled}`,
      })
      .from(activeGames)
      .where(
        and(
          // A CASE, because Postgres may evaluate an AND's operands in either order.
          sql`case when jsonb_typeof(${version}) = 'number'
            then (${version})::numeric between ${OLDEST_GAME_SCHEMA_VERSION} and ${GAME_SCHEMA_VERSION}
            else false end`,
          sql`(not ${roundOver} or not ${activeGameSettled})`
        )
      );
  },

  /**
   * Writes the row at `epoch`, inserting it when there is none: a table whose row an exempt
   * writer deleted under it (an account deletion purging the host's rooms) plays on. False when
   * the row carries another epoch, which stays as it was.
   *
   * An existing row keeps its own pending results, whatever `gameState` carries: memory can still
   * hold a round whose commit landed unheard, and writing it back would apply it twice. `adding`
   * appends one finished round, unless the row holds it already; only the commit's fenced clear
   * removes one.
   */
  async write(roomId: string, gameState: PersistedEnvelope, epoch: number, adding?: PendingResult): Promise<boolean> {
    const updatedAt = new Date(now());
    const kept = sql`coalesce(${pending}, '[]'::jsonb)`;
    const pendingAfter = adding
      ? sql`case when ${kept} @> jsonb_build_array(jsonb_build_object('round', ${adding.round}::bigint))
          then ${kept} else ${kept} || jsonb_build_array(${JSON.stringify(adding)}::jsonb) end`
      : kept;
    const changed = await db()
      .insert(activeGames)
      .values({ roomId, gameState, updatedAt, ownerEpoch: epoch })
      .onConflictDoUpdate({
        target: activeGames.roomId,
        set: { gameState: sql`jsonb_set(excluded.game_state, '{pendingResults}', ${pendingAfter})`, updatedAt },
        setWhere: eq(activeGames.ownerEpoch, epoch),
      })
      .returning({ roomId: activeGames.roomId });
    return changed.length > 0;
  },

  /**
   * Deletes the row at `epoch` unless it holds unapplied results, which keep it. False when the
   * row carries another epoch, and stays.
   */
  async remove(roomId: string, epoch: number): Promise<boolean> {
    const gone = await db()
      .delete(activeGames)
      .where(and(mine(roomId, epoch), activeGameSettled))
      .returning({ roomId: activeGames.roomId });
    if (gone.length > 0) return true;
    const found = await activeGameStore.epochOf(roomId);
    return found === undefined || found === epoch;
  },

  /**
   * Inside the results transaction: removes `round` from the row's pending results at `epoch`.
   * False when the row holds no such round at that epoch, which rolls the transaction back.
   */
  async clearPendingResult(tx: Tx, roomId: string, epoch: number, round: number): Promise<boolean> {
    const cleared = await tx
      .update(activeGames)
      .set({
        gameState: sql`jsonb_set(${activeGames.gameState}, '{pendingResults}', coalesce(
          (select jsonb_agg(e) from jsonb_array_elements(${pending}) e where e->'round' <> to_jsonb(${round}::bigint)),
          '[]'::jsonb))`,
      })
      .where(and(mine(roomId, epoch), sql`${pending} @> jsonb_build_array(jsonb_build_object('round', ${round}::bigint))`))
      .returning({ roomId: activeGames.roomId });
    return cleared.length > 0;
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
