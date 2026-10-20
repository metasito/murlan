// A move by whoever is to act, through the engine's one entry point. Runtime imports, so
// node --test and jest only: Playwright loads tests/support/game.ts instead.
import {
  actingSeat,
  applyMove,
  checkSelection,
  type Combination,
  type GameState,
  type Move,
  type MoveRefusal,
} from "../../lib/game/gameEngine.ts";
import { botChoosePlay, botView, pickGivebackCard } from "../../lib/game/bot.ts";

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
 * The round played to its end by the bot at every seat: every state along the way, `start` first.
 * Throws when the engine refuses a bot's move, when a bot declines to lead, or past `limit` moves.
 */
export function playRoundOut(start: GameState, rng: () => number = Math.random, limit = 2000): GameState[] {
  const states = [start];
  let state = start;
  while (!state.roundOver) {
    if (states.length > limit) throw new Error(`the round did not end in ${limit} moves`);
    const phase = state.exchangePhase?.active ? state.exchangePhase : null;
    if (phase) {
      const card = pickGivebackCard(state.players[phase.winnerIdx].hand, phase.cardFromLoser?.id);
      if (!card) throw new Error(`seat ${phase.winnerIdx} holds nothing to give back`);
      state = givenBack(state, card.id);
    } else {
      const view = botView(state, state.currentTurnIndex);
      const combo = botChoosePlay(view, rng);
      if (!combo && view.toBeat === null) throw new Error(`seat ${state.currentTurnIndex} declined to lead`);
      state = combo ? played(state, combo) : passed(state);
    }
    states.push(state);
  }
  return states;
}

/** Whether `candidate` beats `lastPlayed` once the opening is past, asked as the table asks it. */
export const beats = (candidate: Combination, lastPlayed: Combination | null): boolean =>
  checkSelection(candidate.cards, { lastPlayedCombination: lastPlayed, firstPlayMade: true }).ok;
