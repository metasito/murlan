import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { matchReplays } from "../shared/schema.ts";
import { replayPlayerIdsOf } from "./replayShape.ts";
import { REPLAY_RETENTION_DAYS } from "../lib/replay.ts";
import type { ReplayDto, ReplayMove, ReplaySeat, ReplaySummary } from "../lib/replay.ts";
import type { GameMode } from "../lib/gameEngine.ts";

/** The read is bounded too, so the list never grows with a busy fortnight. */
export const MAX_REPLAYS_LISTED = 20;

/** Rows whose player_ids contain this user — the only ones they may read. */
const ownedBy = (userId: string) =>
  sql`${matchReplays.playerIds} @> ${JSON.stringify([userId])}::jsonb`;

export async function saveReplay(input: {
  roomCode: string;
  gameMode: GameMode;
  seats: ReplaySeat[];
  moves: ReplayMove[];
  rankings: string[];
}): Promise<void> {
  const playerIds = replayPlayerIdsOf(input.seats);
  // An all-bot table produces a replay nobody could ever open.
  if (playerIds.length === 0) return;

  await db.transaction(async (tx) => {
    await tx.insert(matchReplays).values({
      roomCode: input.roomCode,
      gameMode: input.gameMode,
      playerIds,
      seats: input.seats,
      moves: input.moves,
      rankings: input.rankings,
    });
    // Pruned in the same transaction as the insert, as match_history is, so
    // the table cannot grow without bound if the prune is ever skipped.
    await tx
      .delete(matchReplays)
      .where(
        lt(
          matchReplays.finishedAt,
          sql`now() - make_interval(days => ${REPLAY_RETENTION_DAYS})`
        )
      );
  });
}

export async function listReplaysForUser(userId: string): Promise<ReplaySummary[]> {
  const rows = await db
    .select({
      id: matchReplays.id,
      finishedAt: matchReplays.finishedAt,
      gameMode: matchReplays.gameMode,
      seats: matchReplays.seats,
      // The list shows how long the hand was, not what was played: one manche
      // is ~9 KB of jsonb, so twenty of them are most of this response and all
      // of it is discarded. Postgres counts them instead.
      moveCount: sql<number>`jsonb_array_length(${matchReplays.moves})`,
    })
    .from(matchReplays)
    .where(ownedBy(userId))
    .orderBy(desc(matchReplays.finishedAt))
    .limit(MAX_REPLAYS_LISTED);

  return rows.map((r) => {
    const seats = r.seats as ReplaySeat[];
    return {
      id: r.id,
      finishedAt: r.finishedAt.toISOString(),
      gameMode: r.gameMode as GameMode,
      seats,
      playerCount: seats.length,
      moveCount: r.moveCount,
    };
  });
}

/** Only a player who sat at the table may read the log back. */
export async function getReplayForUser(
  id: string,
  userId: string
): Promise<ReplayDto | null> {
  const [row] = await db
    .select()
    .from(matchReplays)
    .where(and(eq(matchReplays.id, id), ownedBy(userId)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    finishedAt: row.finishedAt.toISOString(),
    gameMode: row.gameMode as GameMode,
    seats: row.seats as ReplaySeat[],
    moves: row.moves as ReplayMove[],
    rankings: row.rankings as string[],
  };
}
