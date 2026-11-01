import { and, count, eq, lt, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { activeGames } from "../../shared/schema.ts";
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

/** A persisted table the orphan sweep may wake, and who sits at it in seat order. */
export interface ResumableRow {
  roomId: string;
  userIds: string[];
}

const row = { roomId: activeGames.roomId, gameState: activeGames.gameState };

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

  async write(roomId: string, gameState: PersistedEnvelope): Promise<void> {
    const updatedAt = new Date(now());
    await db()
      .insert(activeGames)
      .values({ roomId, gameState, updatedAt })
      .onConflictDoUpdate({ target: activeGames.roomId, set: { gameState, updatedAt } });
  },

  async remove(roomId: string): Promise<void> {
    await db().delete(activeGames).where(eq(activeGames.roomId, roomId));
  },

  async countUntouchedSince(cutoff: Date): Promise<number> {
    const [found] = await db().select({ n: count() }).from(activeGames).where(lt(activeGames.updatedAt, cutoff));
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
