// One automated action for a seat, wherever the seat is being played for.
//
// Relative imports and no `react-native`, for the same reason
// lib/exchangeCeremony.ts has none: the server bundles this with no alias
// resolution, and `node --test` type-strips plain .ts without resolving `@/`.
//
// It lives here rather than in server/ because a bot plays offline too, and
// one rule played two ways is two rules.
import {
  processPlay,
  processPass,
  processExchangeChoice,
  buildCombination,
  sortHand,
  aiChoosePlay,
  opponentsOf,
  pickGivebackCard,
  getStartingPlayerAfterExchange,
} from "./gameEngine.ts";
import type { GameState, Combination } from "./gameEngine.ts";

/**
 * Achievement bookkeeping: the engine has no notion of "did this seat play a
 * bomb/joker this hand", so every path that actually plays a combination has
 * to update it here, or a forced move (most commonly an AFK-forced lone joker)
 * silently under-counts the purist / iron_will / wild_card achievements.
 */
export function recordPlayFlags(
  handFlags: Record<number, { bomb: boolean; joker: boolean }>,
  seat: number,
  combo: Combination
) {
  const flags = (handFlags[seat] ??= { bomb: false, joker: false });
  if (combo.type === "bomb") flags.bomb = true;
  if (combo.cards.some((c) => c.isJoker)) flags.joker = true;
}

/**
 * Safety valve: the exchange winner holds no card they are allowed to give
 * back. Nobody — human or bot — can satisfy the phase, so it is closed and the
 * hand continues. Without this the whole table sits behind the exchange
 * overlay forever.
 */
export function resolveStuckExchange(state: GameState): GameState {
  const next = structuredClone(state);
  if (next.exchangePhase) next.exchangePhase.active = false;
  next.currentTurnIndex = getStartingPlayerAfterExchange(state);
  next.lastPlayedBy = next.currentTurnIndex;
  return next;
}

export interface AutoMoveContext {
  /**
   * Mutated in place, as the achievement counters are read off it after the
   * hand. Absent offline, which awards none.
   */
  handFlags?: Record<number, { bomb: boolean; joker: boolean }>;
  /** Records the move for a replay log. Absent offline, which keeps none. */
  onMove?: (seat: number, combo: Combination | null, next: GameState) => void;
}

/**
 * One automated action for a seat, or null when the seat cannot act at all.
 *
 * `useAi` picks the real engine AI (a seat with nobody behind it), otherwise
 * the minimum legal move — an AFK human should not be played *well* on their
 * behalf.
 */
export function autoMoveForSeat(
  state: GameState,
  seat: number,
  useAi: boolean,
  ctx: AutoMoveContext
): GameState | null {
  if (state.exchangePhase?.active) {
    if (state.exchangePhase.winnerIdx !== seat) return null;
    const player = state.players[seat];
    if (!player) return null;
    const chosen = pickGivebackCard(player.hand, state.exchangePhase.cardFromLoser?.id);
    if (!chosen) return resolveStuckExchange(state);
    return processExchangeChoice(state, chosen.id);
  }

  if (state.currentTurnIndex !== seat) return null;
  const player = state.players[seat];
  if (!player || player.hand.length === 0) return null;

  const isNewRound = state.lastPlayedCombination === null;
  // The start card is only mandatory for the very first play of the hand, and
  // only for the seat actually holding it.
  const startCard = !state.firstPlayMade ? state.startCard : undefined;
  const requireCard = startCard
    ? player.hand.find((c) => c.id === startCard.id)
    : undefined;

  const logged = (combo: Combination | null, next: GameState): GameState => {
    ctx.onMove?.(seat, combo, next);
    return next;
  };

  if (useAi) {
    const opponents = opponentsOf(state, seat);
    const combo = aiChoosePlay(
      player,
      isNewRound ? null : state.lastPlayedCombination,
      isNewRound,
      opponents.handCounts,
      requireCard,
      undefined,
      opponents.partnerHoldsTop,
      state.playedRanks
    );
    if (combo) {
      if (ctx.handFlags) recordPlayFlags(ctx.handFlags, seat, combo);
      return logged(combo, processPlay(state, combo));
    }
    if (!isNewRound) return logged(null, processPass(state));
    // A new round cannot be passed — fall through to the forced minimum play.
  }

  if (isNewRound) {
    // Read the mandatory opening card from the state instead of assuming 3♣:
    // with the full deal it is always present, but it is not always a club 3.
    const card = requireCard ?? sortHand([...player.hand])[0];
    if (!card) return null;
    const combo = buildCombination([card]);
    if (!combo) return null;
    if (ctx.handFlags) recordPlayFlags(ctx.handFlags, seat, combo);
    return logged(combo, processPlay(state, combo));
  }

  return logged(null, processPass(state));
}

