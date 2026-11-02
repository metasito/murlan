import { and, count, eq, lt, sql } from "drizzle-orm";
import { db, type Tx } from "./db.ts";
import { activeGames, activeGameSettled, ownerEpochs } from "../../shared/schema.ts";
import { now } from "../http/clock.ts";
import type { roomStore } from "./roomStore.ts";
import type { PersistedEnvelope } from "../../shared/persistedEnvelope.ts";

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

const row = { roomId: activeGames.roomId, gameState: activeGames.gameState };
const mine = (roomId: string, epoch: number) => and(eq(activeGames.roomId, roomId), eq(activeGames.ownerEpoch, epoch));

const pending = sql`${activeGames.gameState}->'pendingResults'`;

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

  list(): Promise<ActiveGameRow[]> {
    return db().select(row).from(activeGames);
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
