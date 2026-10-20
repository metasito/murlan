import type { OnlineGameState } from "./gameRoom.ts";
import type { ResolveRoundEndResult } from "./onlineGameLogic.ts";

/**
 * The only writer of a table's match fields — `rematchVotes`, `cumulativeScores`,
 * `matchTarget`, `roundsPlayed`, `matchOver` and `endedByVote`, read-only
 * everywhere else (`tests/server/ledgerFields.types.test.ts`). It mutates state
 * and nothing else: emits, timers and persistence stay with the callers.
 */
interface MatchFields {
  rematchVotes: Set<string>;
  cumulativeScores: Record<string, number>;
  matchTarget: number;
  roundsPlayed: number;
  matchOver: boolean;
  endedByVote?: boolean;
}

function match(game: OnlineGameState): MatchFields {
  return game as unknown as MatchFields;
}

export function castRematchVote(game: OnlineGameState, userId: string): void {
  match(game).rematchVotes.add(userId);
}

export function withdrawRematchVote(game: OnlineGameState, userId: string): void {
  match(game).rematchVotes.delete(userId);
}

export function clearRematchVotes(game: OnlineGameState): void {
  match(game).rematchVotes.clear();
}

export function applyRoundFold(
  game: OnlineGameState,
  result: Pick<ResolveRoundEndResult, "cumulativeScores" | "matchTarget" | "matchOver">
): void {
  const fields = match(game);
  fields.cumulativeScores = result.cumulativeScores;
  fields.matchTarget = result.matchTarget;
  fields.matchOver = result.matchOver;
  fields.roundsPlayed += 1;
  fields.rematchVotes = new Set();
}

export function closeMatch(game: OnlineGameState, { endedByVote }: { endedByVote: boolean }): void {
  const fields = match(game);
  if (endedByVote) fields.endedByVote = true;
  fields.matchOver = true;
}

export function rollForward(game: OnlineGameState, firstTarget: number): void {
  const fields = match(game);
  fields.cumulativeScores = {};
  fields.matchTarget = firstTarget;
  fields.roundsPlayed = 0;
  fields.matchOver = false;
}

export function carrySeatScore(game: OnlineGameState, fromKey: string, toUserId: string): void {
  const scores = match(game).cumulativeScores;
  const carried = scores[fromKey] ?? 0;
  if (carried !== 0) scores[toUserId] = (scores[toUserId] ?? 0) + carried;
  delete scores[fromKey];
}
