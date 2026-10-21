// Who has passed in the trick on the table, and which play is on it.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Combination } from "@/lib/game/gameEngine";

/**
 * Identity of a played combination. Two different players playing the same
 * card ids is impossible, but the same player replaying an identical-looking
 * combination in a later trick is not — hence the seat in the key.
 */
export function comboKey(combo: Combination, playedBy: number): string {
  return combo.cards.map((c) => c.id).join(",") + "_" + playedBy;
}

/**
 * The seats that have passed in the trick on the table, in pass order.
 *
 * A pass changes nothing visible, so this derives it from what did: turns run
 * from `lastPlayedBy` in *descending* seat order and the pile only moves on a
 * play, so every seat in between has passed. Seats holding no cards are
 * stepped over — a false marker is worse than none.
 *
 * Empty between tricks, and empty when the seat on move is the one that
 * played: that span is a full circle. `outOfCards` carries the seat count.
 */
export function passedSeats(state: {
  currentTurnIndex: number;
  lastPlayedBy: number;
  lastPlayedCombination: Combination | null;
  /** Indexed by seat: true once that seat holds no cards. */
  outOfCards: readonly boolean[];
}): number[] {
  const { currentTurnIndex, lastPlayedBy, outOfCards } = state;
  const seatCount = outOfCards.length;
  if (state.lastPlayedCombination === null) return [];
  if (lastPlayedBy < 0 || lastPlayedBy >= seatCount) return [];
  if (currentTurnIndex === lastPlayedBy) return [];

  const passed: number[] = [];
  for (let step = 1; step < seatCount; step++) {
    const seat = (((lastPlayedBy - step) % seatCount) + seatCount) % seatCount;
    if (seat === currentTurnIndex) break;
    if (outOfCards[seat]) continue;
    passed.push(seat);
  }
  return passed;
}
