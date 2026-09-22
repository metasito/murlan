import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../store/db.ts";
import { matchReplays } from "../../shared/schema.ts";
import { replayPlayerIdsOf } from "./replayShape.ts";
import { namesOf } from "./userNames.ts";
import type { ReplayDto, ReplayMove, ReplaySeat, ReplaySummary } from "../../lib/game/replay.ts";
import type { GameMode } from "../../lib/game/gameEngine.ts";

/** The read is bounded too, so the list never grows with a busy fortnight. */
export const MAX_REPLAYS_LISTED = 20;

/** Rows whose player_ids contain this user — the only ones they may read. */
const ownedBy = (userId: string) =>
  sql`${matchReplays.playerIds} @> ${JSON.stringify([userId])}::jsonb`;

/**
 * `seats[].name` is a copy taken when the hand ended, so a rename never reaches
 * it and a departed player's own erasure has to. Whoever the seat still names
 * is asked for live; a seat behind no account — a bot, or a deleted one — keeps
 * what was stored.
 */
async function withLiveNames(rows: { seats: ReplaySeat[] }[]): Promise<void> {
  const seats = rows.flatMap((r) => r.seats);
  const live = await namesOf(
    seats.map((s) => s.userId ?? s.vacatedBy).filter((id): id is string => !!id)
  );
  for (const seat of seats) {
    const name = live.get(seat.userId ?? seat.vacatedBy ?? "");
    if (name) seat.name = name;
  }
}

export async function saveReplay(input: {
  roomId: string;
  /** The same instant `recordGameResult` writes — see its own note on why. */
  finishedAt: Date;
  gameMode: GameMode;
  seats: ReplaySeat[];
  moves: ReplayMove[];
  rankings: string[];
}): Promise<void> {
  const playerIds = replayPlayerIdsOf(input.seats);
  // An all-bot table produces a replay nobody could ever open.
  if (playerIds.length === 0) return;

  await db.insert(matchReplays).values({
    roomId: input.roomId,
    finishedAt: input.finishedAt,
    gameMode: input.gameMode,
    playerIds,
    seats: input.seats,
    moves: input.moves,
    rankings: input.rankings,
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

  await withLiveNames(rows);
  return rows.map((r) => ({
    id: r.id,
    finishedAt: r.finishedAt.toISOString(),
    gameMode: r.gameMode as GameMode,
    seats: r.seats,
    playerCount: r.seats.length,
    moveCount: r.moveCount,
  }));
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
  await withLiveNames([row]);
  return {
    id: row.id,
    finishedAt: row.finishedAt.toISOString(),
    gameMode: row.gameMode as GameMode,
    seats: row.seats,
    moves: row.moves,
    rankings: row.rankings,
  };
}
