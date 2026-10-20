// The offline match, deal to deal and round to round, shared by context/GameContext.tsx and tests/helpers/offlineMatch.ts.
//
// Relative imports and no `react-native`: `node --test` loads it — docs/agents/checks.md, "Node's
// TypeScript loader".
import { dealFirstSeatFor, firstTargetFor, foldRound, openingAfter, seatsOf, startRound } from "./gameEngine.ts";
import type { GameMode, GameState, MatchLength, RandomSource, SeatScoring, SeatSetup } from "./gameEngine.ts";
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

export interface OfflineTable {
  state: GameState;
  match: MatchState;
  /** Where this round was dealt from; the next deal rotates from it. */
  dealFirstSeat: number;
}

/** `deal` deals the first round from the seat given, in place of `startRound`. */
export function startTable(
  seats: readonly SeatSetup[],
  mode: GameMode,
  length: MatchLength,
  { deal, random }: { deal?: (firstSeat: number) => GameState; random?: RandomSource } = {}
): OfflineTable {
  const dealFirstSeat = dealFirstSeatFor(true, 0, seats.length);
  return {
    state: deal ? deal(dealFirstSeat) : startRound(seats, mode, { firstSeat: dealFirstSeat, random }),
    match: freshMatch(length, seats.length),
    dealFirstSeat,
  };
}

/** `next` on the table; the round it ends is scored into the match, once. Otherwise `match` keeps its identity. */
export function advance(table: OfflineTable, next: GameState): OfflineTable {
  const ends = next.roundOver && !table.state.roundOver;
  return { ...table, state: next, match: ends ? applyRoundToMatch(table.match, next) : table.match };
}

/** The round after a finished one: the match's next, or a fresh match's first once it is over. The same table while a round is live. */
export function dealNext(table: OfflineTable, random?: RandomSource): OfflineTable {
  const { state, match } = table;
  if (!state.roundOver) return table;
  const seatCount = state.players.length;
  const dealFirstSeat = dealFirstSeatFor(match.over, table.dealFirstSeat, seatCount);
  return {
    state: startRound(seatsOf(state), state.gameMode, { firstSeat: dealFirstSeat, opening: openingAfter(state), random }),
    match: match.over ? freshMatch(match.length, seatCount) : match,
    dealFirstSeat,
  };
}
