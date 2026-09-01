import { useEffect, useState } from "react";

// Relative and extensioned, not `@/`: `tests/sharedGameFlow.test.ts` loads this
// under `node --test`, which type-strips plain .ts and resolves nothing a
// bundler would. A type-only import is erased before resolution and may use the
// alias; a runtime one may not.
import { EXCHANGE_FLIGHT_MS, exchangeAnnounceMs } from "./exchangeCeremony.ts";
import type { Card } from "@/lib/gameEngine";

export interface ExchangeAnnounceData {
  winnerName: string;
  loserName: string;
  /**
   * The seats, not only the names: the cards fly between the two seats, and
   * two players may share a name.
   */
  winnerIdx: number;
  loserIdx: number;
  bothJokersException: boolean;
  cardGiven?: Card;
  cardReceived?: Card;
}

/**
 * The announce, described the same way whether the exchange happened on a
 * server or in this process.
 *
 * A seat index that names nobody has to become an empty string: the banner
 * puts this straight into a `<Text>`, where `undefined` renders as nothing on
 * web and throws on native.
 */
export function buildExchangeAnnounce(
  players: readonly { name: string }[],
  phase: { winnerIdx: number; loserIdx: number; bothJokersException?: boolean },
  cards: { given?: Card; received?: Card } = {}
): ExchangeAnnounceData {
  return {
    winnerName: players[phase.winnerIdx]?.name ?? "",
    loserName: players[phase.loserIdx]?.name ?? "",
    winnerIdx: phase.winnerIdx,
    loserIdx: phase.loserIdx,
    bothJokersException: phase.bothJokersException === true,
    cardGiven: cards.given,
    cardReceived: cards.received,
  };
}

/**
 * Ends the ceremony on its own clock, beside the state it ends rather than
 * inside the view that draws it. The turn waits on this flag, and a flag only a
 * mounted overlay can clear is a table that stays under a ceremony for good if
 * the overlay ever does not mount.
 *
 * One implementation for both providers, for the same reason as everything else
 * in this file: the online and the offline table run the same ceremony, and two
 * clocks for it are two clocks that can disagree.
 */
export function useExchangeCeremonyExpiry(
  announcing: boolean,
  bothJokersException: boolean | undefined,
  end: () => void
): void {
  useEffect(() => {
    if (!announcing) return;
    const done = setTimeout(end, exchangeAnnounceMs(bothJokersException ?? false));
    return () => clearTimeout(done);
  }, [announcing, bothJokersException, end]);
}

/**
 * Whether the traded cards have arrived. False while they are still crossing.
 *
 * The ceremony outlives the flight by `Reading.notice` — the tags beside each
 * seat are there to be read after the cards land — so "the ceremony is running"
 * and "the card is still in the air" are different questions, and the hand
 * leaving a place for an arriving card is asking the second. Both the view that
 * draws the flight and the hand that waits for it read this one clock, because
 * two would be two that can disagree.
 *
 * Nothing flies when both Jokers cancelled the exchange, so nothing is ever in
 * the air.
 */
export function useTradedCardsLanded(
  announcing: boolean,
  bothJokersException: boolean | undefined
): boolean {
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (!announcing) {
      setLanded(false);
      return;
    }
    if (bothJokersException) {
      setLanded(true);
      return;
    }
    const land = setTimeout(() => setLanded(true), EXCHANGE_FLIGHT_MS);
    return () => clearTimeout(land);
  }, [announcing, bothJokersException]);
  return landed;
}
