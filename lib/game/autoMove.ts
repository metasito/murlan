// One automated action for a seat, wherever the seat is being played for.
//
// Relative imports and no `react-native`: the server bundles this unresolved, and
// `node --test` loads it the same way — docs/agents/checks.md, "Node's TypeScript loader".
//
// It lives here rather than in server/ because a bot plays offline too, and
// one rule played two ways is two rules.
import {
  actingSeat,
  applyMove,
  sortHand,
  pickGivebackCard,
  getStartingPlayerAfterExchange,
  getNextActivePlayer,
} from "./gameEngine.ts";
import { botChoosePlay, knownOpponentExchangeCard, opponentsOf } from "./bot.ts";
import type { AppliedMove, GameState, Move } from "./gameEngine.ts";

/**
 * `bot` is the real engine bot, for a seat with nobody behind it; `floor` the
 * minimum legal move, as an AFK human should not be played *well* on their behalf.
 */
export type Strength = "bot" | "floor";

/**
 * Safety valve: the exchange winner holds no card they are allowed to give
 * back. Nobody — human or bot — can satisfy the phase, so it is closed and the
 * round continues. Without this the whole table sits behind the exchange
 * overlay forever.
 */
export function resolveStuckExchange(state: GameState): GameState {
  const next = structuredClone(state);
  if (next.exchangePhase) next.exchangePhase.active = false;
  next.currentTurnIndex = getStartingPlayerAfterExchange(state);
  if (next.players[next.currentTurnIndex].hand.length === 0) {
    next.currentTurnIndex = getNextActivePlayer(next);
  }
  next.lastPlayedBy = next.currentTurnIndex;
  return next;
}

/**
 * The move `seat` makes now, or null when it has none to make. `rng` is
 * `botChoosePlay`'s own, so a simulation can reproduce a match from one seed.
 */
export function chooseMove(state: GameState, seat: number, strength: Strength, rng?: () => number): Move | null {
  if (state.exchangePhase?.active) {
    if (state.exchangePhase.winnerIdx !== seat) return null;
    const chosen = pickGivebackCard(state.players[seat]?.hand ?? [], state.exchangePhase.cardFromLoser?.id);
    return chosen ? { kind: "giveback", cardId: chosen.id } : null;
  }

  if (state.currentTurnIndex !== seat) return null;
  const player = state.players[seat];
  if (!player || player.hand.length === 0) return null;

  const isNewTrick = state.lastPlayedCombination === null;
  // The opening is only mandatory for the very first play of the round, and
  // only for the seat actually holding it.
  const startCard = !state.firstPlayMade ? state.startCard : undefined;
  const requireCard = startCard
    ? player.hand.find((c) => c.id === startCard.id)
    : undefined;

  if (strength === "bot") {
    const opponents = opponentsOf(state, seat);
    const combo = botChoosePlay(
      player,
      isNewTrick ? null : state.lastPlayedCombination,
      isNewTrick,
      opponents.handCounts,
      requireCard,
      rng,
      opponents.partnerHoldsTop,
      state.playedRanks,
      knownOpponentExchangeCard(state.exchangePhase, seat)
    );
    if (combo) return { kind: "play", cardIds: combo.cards.map((c) => c.id) };
    if (!isNewTrick) return { kind: "pass" };
    // A new trick cannot be passed — fall through to the forced minimum play.
  }

  if (isNewTrick) {
    // Read the mandatory opening card from the state instead of assuming 3♠:
    // with the full deal it is always present, but a short deal may lack it.
    const card = requireCard ?? sortHand([...player.hand])[0];
    return { kind: "play", cardIds: [card.id] };
  }

  return { kind: "pass" };
}

/** `move` null: the stuck exchange was closed, and nobody moved. */
export type AutoMove = { state: GameState; move: AppliedMove | null };

/** One automated action for a seat, or null when the seat cannot act at all. */
export function autoMoveForSeat(
  state: GameState,
  seat: number,
  strength: Strength,
  rng?: () => number
): AutoMove | null {
  const move = chooseMove(state, seat, strength, rng);
  if (!move) {
    const stuck = state.exchangePhase?.active && state.exchangePhase.winnerIdx === seat && state.players[seat];
    return stuck ? { state: resolveStuckExchange(state), move: null } : null;
  }
  const result = applyMove(state, seat, move);
  if (!result.ok) throw new Error(`seat ${seat} chose a ${move.kind} the engine refuses: ${result.code}`);
  return { state: result.state, move: result.move };
}

/** The offline table's bot turn: null unless a bot is to act, which it does at full strength. */
export function offlineBotMove(state: GameState, rng?: () => number): AutoMove | null {
  const seat = actingSeat(state);
  if (state.players[seat]?.type !== "bot") return null;
  return autoMoveForSeat(state, seat, "bot", rng);
}
