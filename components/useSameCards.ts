import { useState } from "react";
import type { Card } from "@/lib/game/gameEngine";

/**
 * `cards`, or the array last returned for the same ids in the same order.
 * Every `game:state` rebuilds each card object, so without this nothing keyed
 * on the array's identity downstream can hold still.
 */
export function useSameCards(cards: Card[]): Card[] {
  const signature = cards.map((card) => card.id).join(",");
  const [held, setHeld] = useState({ signature, cards });
  if (held.signature !== signature) {
    setHeld({ signature, cards });
    return cards;
  }
  return held.cards;
}
