import { eq, lt } from "drizzle-orm";
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

/** The only reader and writer of `active_games` (`tests/server/activeGameStoreScan.test.ts`). */
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

  /** Returns how many went, so a caller can tell "nothing to do" from "did not run". */
  async removeUntouchedSince(cutoff: Date): Promise<number> {
    const gone = await db
      .delete(activeGames)
      .where(lt(activeGames.updatedAt, cutoff))
      .returning({ roomId: activeGames.roomId });
    return gone.length;
  },
};

/** The table runtime's narrow room port; the type server-output's deps object will take. */
export type TableRoomPort = Pick<
  typeof roomStore,
  "getRoomById" | "getRoomPlayers" | "updateRoomStatus" | "releaseSeat" | "upsertRoomPlayer" | "closeForStart"
>;
