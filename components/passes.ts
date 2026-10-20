// Which turn the table is on, and who has passed in it.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Combination, GameState } from "@/lib/game/gameEngine";

/**
 * Identity of a played combination. Two different players playing the same
 * card ids is impossible, but the same player replaying an identical-looking
 * combination in a later trick is not — hence the seat in the key.
 */
export function comboKey(combo: Combination, playedBy: number): string {
  return combo.cards.map((c) => c.id).join(",") + "_" + playedBy;
}

/** Changes on every move and every pass, including the same seat leading a new trick after winning one. */
export function turnKey(
  state: Pick<GameState, "currentTurnIndex" | "passCount" | "lastPlayedCombination" | "lastPlayedBy">,
): string {
  return (
    `${state.currentTurnIndex}|${state.passCount}|` +
    (state.lastPlayedCombination ? comboKey(state.lastPlayedCombination, state.lastPlayedBy) : "-")
  );
}

/**
 * The pass that just closed a trick, seen from one state. `processPass`
 * (lib/game/gameEngine.ts) clears `lastPlayedCombination` and credits `trickWinner`
 * in the same transition, so the table gets both on a single commit — and the
 * winning cards must stay on the felt under the tag that announces them
 * instead of being wiped by the empty-table branch.
 */
export function trickClosedWithWinner(state: {
  lastPlayedCombination: Combination | null;
  trickWinner?: number | null;
}): boolean {
  return (
    state.lastPlayedCombination === null &&
    state.trickWinner !== null &&
    state.trickWinner !== undefined
  );
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

type PassView = Parameters<typeof passedSeats>[0] & { trickWinner?: number | null };

/**
 * The seats one change of state shows passing: each `passedSeats` names anew, and the seat on move
 * when a pass closed the trick, which `passedSeats` never names because the trick is gone with it.
 */
export function seatsJustPassed(before: PassView, after: PassView): number[] {
  const was = passedSeats(before);
  const now = passedSeats(after).filter((seat) => !was.includes(seat));
  const closedByPass =
    before.lastPlayedCombination !== null && trickClosedWithWinner(after) && after.lastPlayedBy === before.lastPlayedBy;
  return closedByPass ? [...now, before.currentTurnIndex] : now;
}
