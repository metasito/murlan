// Pure shaping and accumulation for a replay, split from server/replays.ts so
// the plain `node --test` runner can load it without db/session/storage coming
// with it — the same reason server/onlineGameLogic.ts exists.
import { MAX_REPLAY_MOVES } from "../lib/replay.ts";
import type { Combination } from "../lib/gameEngine.ts";
import type { ReplayMove, ReplaySeat } from "../lib/replay.ts";

/** Seat list for a replay row: every seat, with its user id or null for a bot. */
export function replaySeatsOf(
  players: { name: string }[],
  playerMap: Record<number, string>
): ReplaySeat[] {
  return players.map((p, seatIndex) => ({
    seatIndex,
    userId: playerMap[seatIndex] ?? null,
    name: p.name,
  }));
}

/** The human seats — who may read the replay back. */
export function replayPlayerIdsOf(seats: ReplaySeat[]): string[] {
  return seats.map((s) => s.userId).filter((id): id is string => id !== null);
}

/** A fresh log for a hand about to be dealt. */
export function startReplayLog(): ReplayMove[] {
  return [];
}

/**
 * Records one move, if the hand still has a usable log. `null` means the log
 * was abandoned — a hand rehydrated after a restart never had one, and one
 * past MAX_REPLAY_MOVES is dropped rather than grown — and no replay will be
 * written for that hand.
 */
export function appendReplayMove(
  game: { moveLog: ReplayMove[] | null },
  seat: number,
  combo: Combination | null,
  // Only the hand sizes are read, never the cards — see lib/replay.ts.
  next: { players: { hand: unknown[] }[] }
): void {
  if (!game.moveLog) return;
  if (game.moveLog.length >= MAX_REPLAY_MOVES) {
    game.moveLog = null;
    return;
  }
  game.moveLog.push({
    seat,
    combo,
    handCounts: next.players.map((p) => p.hand.length),
  });
}
