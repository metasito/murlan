// A move by whoever is to act, through the engine's one entry point. Runtime imports, so
// node --test and jest only: Playwright loads tests/support/game.ts instead.
import {
  actingSeat,
  applyMove,
  checkSelection,
  getAllValidPlays,
  tableDemand,
  type Combination,
  type GameState,
  type Move,
  type MoveRefusal,
} from "../../lib/game/gameEngine.ts";
import { autoMoveForSeat } from "../../lib/game/autoMove.ts";

function settled(state: GameState, move: Move): GameState {
  const result = applyMove(state, actingSeat(state), move);
  if (!result.ok) throw new Error(`the engine refused the ${move.kind}: ${result.code}`);
  return result.state;
}

/** The seat on move plays `combo`'s cards; a refusal throws, naming its code. */
export const played = (state: GameState, combo: Combination): GameState =>
  settled(state, { kind: "play", cardIds: combo.cards.map((card) => card.id) });

export const passed = (state: GameState): GameState => settled(state, { kind: "pass" });

export const givenBack = (state: GameState, cardId: string): GameState =>
  settled(state, { kind: "giveback", cardId });

/** Why the seat to act may not make `move`, or null when it may. */
export function refusalOf(state: GameState, move: Move): MoveRefusal | null {
  const result = applyMove(state, actingSeat(state), move);
  return result.ok ? null : result.code;
}

/**
 * The round played to its end by the bot at every seat, through lib/game/autoMove.ts as any table
 * plays it: every state along the way, `start` first. Throws when a seat on move has nothing it can
 * do, or past `limit` moves.
 */
export function playRoundOut(start: GameState, rng: () => number = Math.random, limit = 2000): GameState[] {
  const states = [start];
  let state = start;
  while (!state.roundOver) {
    if (states.length > limit) throw new Error(`the round did not end in ${limit} moves`);
    const seat = actingSeat(state);
    const auto = autoMoveForSeat(state, seat, "bot", rng);
    if (!auto) throw new Error(`seat ${seat} is on move and the bot has nothing to do`);
    state = auto.state;
    states.push(state);
  }
  return states;
}

/** Every play `seat` may make now, against the table's demand. */
export const legalPlays = (state: GameState, seat: number): Combination[] =>
  getAllValidPlays(state.players[seat]?.hand ?? [], tableDemand(state));

/** Whether `candidate` beats `lastPlayed` once the opening is past, asked as the table asks it. */
export const beats = (candidate: Combination, lastPlayed: Combination | null): boolean =>
  checkSelection(candidate.cards, { toBeat: lastPlayed, mustInclude: null }).ok;

/** The seat whose play nobody beat, when `state`'s last move closed a trick; null otherwise. */
export const trickClosedBy = (state: GameState): number | null =>
  state.lastMove.kind === "pass" && state.lastMove.closedTrick ? state.lastPlayedBy : null;
