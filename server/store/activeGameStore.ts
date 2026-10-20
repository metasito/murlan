import { count, eq, lt } from "drizzle-orm";
import { db } from "./db.ts";
import { activeGames } from "../../shared/schema.ts";
import { now } from "../http/clock.ts";
import type { roomStore } from "./roomStore.ts";
import type { PersistedEnvelope } from "../../shared/persistedEnvelope.ts";
import type { GameState } from "../../lib/game/gameEngine.ts";

export interface ActiveGameRow {
  roomId: string;
  gameState: unknown;
}

const row = { roomId: activeGames.roomId, gameState: activeGames.gameState };

/** Outside the stores, only `retention.ts` reaches `active_games` past this (`tests/server/activeGameStoreScan.test.ts`). */
export const activeGameStore = {
  async load(roomId: string): Promise<ActiveGameRow | undefined> {
    const [found] = await db.select(row).from(activeGames).where(eq(activeGames.roomId, roomId));
    return found;
  },

  list(): Promise<ActiveGameRow[]> {
    return db.select(row).from(activeGames);
  },

  async write(roomId: string, gameState: PersistedEnvelope<GameState>): Promise<void> {
    const updatedAt = new Date(now());
    await db
      .insert(activeGames)
      .values({ roomId, gameState, updatedAt })
      .onConflictDoUpdate({ target: activeGames.roomId, set: { gameState, updatedAt } });
  },

  async remove(roomId: string): Promise<void> {
    await db.delete(activeGames).where(eq(activeGames.roomId, roomId));
  },

  async countUntouchedSince(cutoff: Date): Promise<number> {
    const [found] = await db.select({ n: count() }).from(activeGames).where(lt(activeGames.updatedAt, cutoff));
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
