// The order a seat has put its own hand in, for as long as it holds it (#531).
//
// Memory only, and deliberately: the server owns what is in a hand and has no
// business knowing how its owner likes it stacked. A list of card ids is enough
// to re-derive the arrangement after every broadcast, so nothing has to be
// stored, sent or migrated for the order to survive a re-sort or a reconnect.
import { useCallback, useMemo, useState } from "react";
import { applyHandOrder, moveCard } from "@/components/handOrder";
import type { Card } from "@/lib/gameEngine";

/**
 * How many cards a hand may gain and still be the same hand. Exactly one: the
 * exchange hands a card back mid-manche and the arrangement has to survive
 * that. Nothing else adds to a hand except a deal, which brings thirteen or
 * fourteen strangers at once.
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
  // Each entry names every card the hand held when it was written, so the cards
  // it does *not* name are the ones that arrived since.
  const [orders, setOrders] = useState<Record<number, string[]>>({});
  const stored = orders[seat];

  // A deal is read off which cards are new rather than off how many there are.
  // Counting was wrong twice over: a hand momentarily absent from the state
  // reads as zero and makes the next one look dealt, and a manche a player sat
  // out entirely ends on the same thirteen it started with, so the next deal
  // changes no count at all.
  const order = useMemo(() => {
    if (stored === undefined) return undefined;
    const known = new Set(stored);
    let strangers = 0;
    for (const card of sorted) {
      if (!known.has(card.id) && ++strangers > KEEPS_ORDER_UP_TO) return undefined;
    }
    return stored;
  }, [stored, sorted]);

  const arranged = useMemo(() => applyHandOrder(sorted, order ?? []), [sorted, order]);

  const moveTo = useCallback(
    (id: string, to: number) => {
      setOrders((held) => ({ ...held, [seat]: moveCard(arranged.map((c) => c.id), id, to) }));
    },
    [seat, arranged]
  );

  return { arranged, moveTo };
}
