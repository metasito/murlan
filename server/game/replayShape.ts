// Pure shaping and accumulation for a replay, split from server/game/replays.ts so
// the plain `node --test` runner can load it without db/session/storage coming
// with it — the same reason server/game/onlineGameLogic.ts exists.
import { MAX_REPLAY_MOVES } from "../../lib/game/replay.ts";
import type { Combination } from "../../lib/game/gameEngine.ts";
import type { ReplayMove, ReplaySeat } from "../../lib/game/replay.ts";

/** Seat list for a replay row: every seat, with its user id or null for a bot. */
export function replaySeatsOf(
  players: { name: string }[],
  playerMap: Readonly<Record<number, string>>,
  vacatedSeats: ReadonlyMap<number, { userId: string }> = new Map()
): ReplaySeat[] {
  return players.map((p, seatIndex) => ({
    seatIndex,
    userId: playerMap[seatIndex] ?? null,
    // Deliberately outside `replayPlayerIdsOf` below: a leaver keeps no read
    // access to the replay, this only says whose name the seat still carries.
    vacatedBy: playerMap[seatIndex] ? null : vacatedSeats.get(seatIndex)?.userId ?? null,
    name: p.name,
  }));
}

/** The human seats — who may read the replay back. */
export function replayPlayerIdsOf(seats: ReplaySeat[]): string[] {
  return seats.map((s) => s.userId).filter((id): id is string => id !== null);
}

/**
 * Records one move, if the round still has a usable log. `null` means the log
 * was abandoned — a round rehydrated after a restart never had one, and one
 * past MAX_REPLAY_MOVES is dropped rather than grown — and no replay will be
 * written for that round.
 */
export function appendReplayMove(
  game: { moveLog: ReplayMove[] | null },
  seat: number,
  combo: Combination | null,
  // Only the hand sizes are read, never the cards — see lib/game/replay.ts.
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
