// The order a player has put their own hand in (#531).
//
// Kept free of JSX and of any import from a .tsx file, like handLayout.ts:
// Node's TS loader type-strips plain .ts only, and `node --test` is what
// covers this.
import type { Card } from "../lib/gameEngine.ts";

/**
 * The engine's cards in the player's own order.
 *
 * Applied to every update rather than stored once, which is what makes the
 * feature client-only: the server owns what is *in* the hand and re-sorts its
 * array whenever it likes, and this re-derives the player's arrangement from a
 * list of card ids each time. Ids are `${rank}_${suit}` and deterministic, so
 * the order survives a re-sort, a reconnect and a rejoin without the server
 * knowing it exists.
 *
 * A card the order has never seen — one just dealt, or handed back by the
 * exchange — keeps the place `sorted` gives it *relative to the cards around
 * it*, so it arrives where a player would look for it without moving anything
 * they placed. That is also why the order never needs invalidating.
 */
export function applyHandOrder(sorted: readonly Card[], order: readonly string[]): Card[] {
  const byId = new Map(sorted.map((card) => [card.id, card]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of order) {
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  // `cursor` trails the last placed card the walk has passed, so a run of new
  // cards between two placed ones keeps the engine's order among themselves.
  let cursor = 0;
  for (const card of sorted) {
    const at = out.indexOf(card.id);
    if (at !== -1) {
      cursor = at + 1;
      continue;
    }
    out.splice(cursor, 0, card.id);
    cursor++;
  }

  return out.map((id) => byId.get(id)!);
}

/** The order after `id` is dropped at slot `to`. */
export function moveCard(ids: readonly string[], id: string, to: number): string[] {
  const rest = ids.filter((x) => x !== id);
  const at = Math.max(0, Math.min(to, rest.length));
  rest.splice(at, 0, id);
  return rest;
}

/**
 * Which card a finger at `x` has landed on, given every card's left edge, or
 * null for a finger past the ends of the row.
 *
 * The last one whose box contains `x`, because a fan is drawn left to right
 * and each card covers the one before it: the card a finger is touching is the
 * one on top, not the first one whose box it happens to be inside.
 */
export function cardAt(cardXs: readonly number[], cardW: number, x: number): number | null {
  for (let i = cardXs.length - 1; i >= 0; i--) {
    if (x >= cardXs[i] && x <= cardXs[i] + cardW) return i;
  }
  return null;
}

/**
 * Which slot a finger at `x` is dropping into, given the left edges of the
 * cards it is *not* holding.
 *
 * The slot comes from where the finger is along the row, never from which card
 * it is over: a fan overlaps, so "over" names two cards at once and is
 * ambiguous by construction. There is one more slot than there are cards left
 * — before each of them, and after the last, which sits a whole card past its
 * left edge rather than on it.
 */
export function dropIndex(cardXs: readonly number[], cardW: number, x: number): number {
  if (cardXs.length === 0) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= cardXs.length; i++) {
    const at = i < cardXs.length ? cardXs[i] : cardXs[cardXs.length - 1] + cardW;
    const d = Math.abs(x - at);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
