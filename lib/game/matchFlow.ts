// The offline match's accounting, shared by context/GameContext.tsx and tests/helpers/offlineMatch.ts.
//
// Relative imports and no `react-native`: `node --test` loads it — docs/agents/checks.md, "Node's
// TypeScript loader".
import { firstTargetFor, foldRound } from "./gameEngine.ts";
import type { GameState, MatchLength, SeatScoring } from "./gameEngine.ts";
import type { MatchState } from "./matchState.ts";

export function freshMatch(length: MatchLength, playerCount: number): MatchState {
  return {
    length,
    target: firstTargetFor(playerCount),
    scores: {},
    rounds: [],
    over: false,
    winners: [],
    isDraw: false,
  };
}

/** Offline every seat scores under its own engine id, and nobody has left one. */
export function offlineSeats(state: GameState): SeatScoring[] {
  return state.players.map((p) => ({ engineId: p.id, key: p.id, team: p.team, crownable: true }));
}

export function applyRoundToMatch(match: MatchState, finished: GameState): MatchState {
  const folded = foldRound(
    {
      finishingOrder: finished.finishingOrder,
      playerCount: finished.players.length,
      gameMode: finished.gameMode,
      length: match.length,
    },
    { cumulative: match.scores, target: match.target },
    offlineSeats(finished)
  );

  return {
    ...match,
    scores: folded.cumulative,
    rounds: [...match.rounds, { finishingOrder: finished.finishingOrder, pointsAwarded: folded.roundByKey }],
    target: folded.target,
    over: folded.over,
    winners: folded.winners,
    isDraw: folded.isDraw,
  };
}
