// The order a seat has put its own hand in, for as long as it holds it (#531).
//
// Memory only, and deliberately: the server owns what is in a hand and has no
// business knowing how its owner likes it stacked. A list of card ids is enough
// to re-derive the arrangement after every broadcast, so nothing has to be
// stored, sent or migrated for the order to survive a re-sort or a reconnect.
import { useCallback, useRef, useState } from "react";
import { applyHandOrder, moveCard } from "@/components/handOrder";
import type { Card } from "@/lib/gameEngine";

/**
 * How much a hand may grow by and still be the same hand. Exactly one: the
 * exchange hands a card back mid-manche and the arrangement has to survive
 * that, and nothing else adds to a hand except a deal, which adds thirteen or
 * fourteen at once. Read off the size rather than off a phase flag, so it does
 * not depend on when that flag happens to arrive beside the cards.
 */
const KEEPS_ORDER_UP_TO = 1;

export interface HandOrder {
  /** `sorted` in this seat's own arrangement. */
  arranged: Card[];
  /** Puts `id` at slot `to` of the hand without it. */
  moveTo: (id: string, to: number) => void;
}

/**
 * `seat` keys the arrangement because two people sharing one phone do not
 * share a preference. `sorted` is the engine's own order, and it stays the
 * fallback for every card the arrangement has never been told about.
 */
export function useHandOrder(seat: number, sorted: Card[]): HandOrder {
  const [orders, setOrders] = useState<Record<number, string[]>>({});
  /** What each seat held on the previous render — a deal is what grew. */
  const sizes = useRef<Record<number, number>>({});
  /** What this seat is looking at right now, which is what a move rearranges. */
  const showing = useRef<string[]>([]);

  const dealt = sorted.length > (sizes.current[seat] ?? 0) + KEEPS_ORDER_UP_TO;
  sizes.current[seat] = sorted.length;

  // A new deal is a new hand of cards, so it is the engine's order again.
  // Dropped during the render that sees it rather than from an effect, which
  // would draw one frame of the new hand in the old hand's arrangement.
  if (dealt && orders[seat] !== undefined) {
    setOrders(({ [seat]: _dropped, ...rest }) => rest);
  }

  const arranged = applyHandOrder(sorted, (dealt ? undefined : orders[seat]) ?? []);
  showing.current = arranged.map((card) => card.id);

  const moveTo = useCallback(
    (id: string, to: number) => {
      setOrders((held) => ({ ...held, [seat]: moveCard(showing.current, id, to) }));
    },
    [seat]
  );

  return { arranged, moveTo };
}
