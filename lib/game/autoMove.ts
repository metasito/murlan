// One automated action for a seat, wherever the seat is being played for.
//
// Relative imports and no `react-native`: the server bundles this unresolved, and
// `node --test` loads it the same way — docs/agents/checks.md, "Node's TypeScript loader".
//
// It lives here rather than in server/ because a bot plays offline too, and
// one rule played two ways is two rules.
import { actingSeat, applyMove, sortHand } from "./gameEngine.ts";
import { botChoosePlay, botView, pickGivebackCard } from "./bot.ts";
import type { AppliedMove, GameState, Move } from "./gameEngine.ts";

/**
 * `bot` is the real engine bot, for a seat with nobody behind it; `floor` the
 * minimum legal move, as an AFK human should not be played *well* on their behalf.
 */
export type Strength = "bot" | "floor";

/**
 * The move `seat` makes now, or null when it has none to make. `rng` is
 * `botChoosePlay`'s own, so a simulation can reproduce a match from one seed.
 */
export function chooseMove(state: GameState, seat: number, strength: Strength, rng?: () => number): Move | null {
  if (state.roundOver) return null;
  const phase = state.exchangePhase;
  if (phase?.kind === "open") {
    if (phase.winnerIdx !== seat) return null;
    const chosen = pickGivebackCard(state.players[seat]?.hand ?? [], phase.cardFromLoser.id);
    return chosen ? { kind: "giveback", cardId: chosen.id } : null;
  }

  if (state.currentTurnIndex !== seat) return null;
  const player = state.players[seat];
  if (!player || player.hand.length === 0) return null;

  const view = botView(state, seat);
  const isNewTrick = view.toBeat === null;

  if (strength === "bot") {
    const combo = botChoosePlay(view, rng);
    if (combo) return { kind: "play", cardIds: combo.cards.map((c) => c.id) };
    if (!isNewTrick) return { kind: "pass" };
    // A new trick cannot be passed — fall through to the forced minimum play.
  }

  if (isNewTrick) {
    // Read the mandatory opening card from the state instead of assuming 3♠:
    // with the full deal it is always present, but a short deal may lack it.
    const card = view.mustInclude ?? sortHand([...player.hand])[0];
    return { kind: "play", cardIds: [card.id] };
  }

  return { kind: "pass" };
}

export type AutoMove = { state: GameState; move: AppliedMove };

/** One automated action for a seat, or null when the engine has nothing legal for it. Never throws. */
export function autoMoveForSeat(
  state: GameState,
  seat: number,
  strength: Strength,
  rng?: () => number
): AutoMove | null {
  const move = chooseMove(state, seat, strength, rng);
  if (!move) return null;
  const result = applyMove(state, seat, move);
  return result.ok ? { state: result.state, move: result.move } : null;
}

/** The offline table's bot turn: null unless a bot is to act, which it does at full strength. */
export function offlineBotMove(state: GameState, rng?: () => number): AutoMove | null {
  const seat = actingSeat(state);
  if (state.players[seat]?.type !== "bot") return null;
  return autoMoveForSeat(state, seat, "bot", rng);
}
