import { and, count, eq, lt, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { activeGames } from "../../shared/schema.ts";
import { now } from "../http/clock.ts";
import type { roomStore } from "./roomStore.ts";
import type { PersistedEnvelope } from "../../shared/persistedEnvelope.ts";

export interface ActiveGameRow {
  roomId: string;
  gameState: unknown;
}

/** A row as a claim leaves it: the epoch it now carries, and what it held. */
export interface ClaimedRow extends ActiveGameRow {
  ownerEpoch: number;
}

/** The claim a write is made under, and whether that claim's row exists. */
export interface OwnerFence {
  epoch: number;
  rowExists: boolean;
}

const row = { roomId: activeGames.roomId, gameState: activeGames.gameState };
const mine = (roomId: string, epoch: number) => and(eq(activeGames.roomId, roomId), eq(activeGames.ownerEpoch, epoch));

/** Outside the stores, only `retention.ts` reaches `active_games` past this (`tests/server/activeGameStoreScan.test.ts`). */
export const activeGameStore = {
  async load(roomId: string): Promise<ActiveGameRow | undefined> {
    const [found] = await db().select(row).from(activeGames).where(eq(activeGames.roomId, roomId));
    return found;
  },

  /** Moves the row to the next epoch and reads it, in one statement; undefined when there is no row. */
  async claim(roomId: string): Promise<ClaimedRow | undefined> {
    const [found] = await db()
      .update(activeGames)
      .set({ ownerEpoch: sql`${activeGames.ownerEpoch} + 1` })
      .where(eq(activeGames.roomId, roomId))
      .returning({ ...row, ownerEpoch: activeGames.ownerEpoch });
    return found;
  },

  async epochOf(roomId: string): Promise<number | undefined> {
    const [found] = await db()
      .select({ ownerEpoch: activeGames.ownerEpoch })
      .from(activeGames)
      .where(eq(activeGames.roomId, roomId));
    return found?.ownerEpoch;
  },

  list(): Promise<ActiveGameRow[]> {
    return db().select(row).from(activeGames);
  },

  /**
   * False when no row changed: the row carries another claim's epoch, or a row this claim wrote
   * is gone. A claim with no row yet inserts one, and takes over a row only at its own epoch, so
   * an insert whose commit went unanswered can be made again.
   */
  async write(roomId: string, gameState: PersistedEnvelope, fence: OwnerFence): Promise<boolean> {
    const updatedAt = new Date(now());
    const changed = fence.rowExists
      ? await db()
          .update(activeGames)
          .set({ gameState, updatedAt })
          .where(mine(roomId, fence.epoch))
          .returning({ roomId: activeGames.roomId })
      : await db()
          .insert(activeGames)
          .values({ roomId, gameState, updatedAt, ownerEpoch: fence.epoch })
          .onConflictDoUpdate({
            target: activeGames.roomId,
            set: { gameState, updatedAt },
            setWhere: eq(activeGames.ownerEpoch, fence.epoch),
          })
          .returning({ roomId: activeGames.roomId });
    return changed.length > 0;
  },

  /** False when no row at `epoch` was there to delete. */
  async remove(roomId: string, epoch: number): Promise<boolean> {
    const gone = await db().delete(activeGames).where(mine(roomId, epoch)).returning({ roomId: activeGames.roomId });
    return gone.length > 0;
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
