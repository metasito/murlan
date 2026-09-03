import { useCallback, useEffect, useState } from "react";

// Relative and extensioned, not `@/`: `tests/sharedGameFlow.test.ts` loads this
// under `node --test`, which type-strips plain .ts and resolves nothing a
// bundler would. A type-only import is erased before resolution and may use the
// alias; a runtime one may not.
import { EXCHANGE_FLIGHT_MS, exchangeAnnounceMs } from "./exchangeCeremony.ts";
import { matchIsClosing } from "./gameEngine.ts";
import type { Card, MatchLength } from "@/lib/gameEngine";

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
function useExchangeCeremonyExpiry(
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
 * Whether to ask the table about another match. Not a hook: the two providers
 * hold these inputs in different objects, so each memoises on its own and only
 * the answer is shared.
 *
 * The hand counts come in already read, because only the caller knows whether
 * a seat's hand is the hand or a count the server sent in place of one.
 */
export function rematchPromptOpen(
  game: { gameOver: boolean; handCounts: number[] } | null,
  match: { length: MatchLength; target: number; over: boolean },
  cumulative: Record<string, number>
): boolean {
  if (!game || game.gameOver || match.over) return false;
  return matchIsClosing({
    length: match.length,
    target: match.target,
    cumulative,
    handCounts: game.handCounts,
    playerCount: game.handCounts.length,
  });
}

export interface ExchangeAnnouncement {
  announcing: boolean;
  data: ExchangeAnnounceData | null;
  /**
   * Opens the ceremony on this announce. One call, because the flag and the
   * data are one fact: set apart, a render between them draws the ceremony
   * from the previous trade.
   */
  announce: (data: ExchangeAnnounceData) => void;
  /** Closes it — the clock running out and the viewer saying so are one close. */
  end: () => void;
}

/**
 * The whole ceremony: what is being announced, whether it still is, and the
 * clock that ends it. Both providers run this one, so a table cannot be under a
 * ceremony on one transport and not the other.
 *
 * `phasePresent` is `gameState.exchangePhase !== undefined` — the record this
 * ceremony describes, read fresh every render. The reading clock is what ends
 * an ordinary trade; this is the floor under it, not a replacement for it: an
 * exchange stays on the felt for `Reading.notice` after it resolves by design,
 * and the phase itself lives at least that long too (the winner still has to
 * play out the rest of the hand). What it guards is the case the timer
 * cannot — a fresh match dealt, or the table reset, while the old ceremony's
 * clock is still counting down describes a trade that no longer has a record
 * to point to, and nothing should still be showing it.
 */
export function useExchangeAnnouncement(phasePresent: boolean): ExchangeAnnouncement {
  const [announcing, setAnnouncing] = useState(false);
  const [data, setData] = useState<ExchangeAnnounceData | null>(null);

  const announce = useCallback((next: ExchangeAnnounceData) => {
    setData(next);
    setAnnouncing(true);
  }, []);
  const end = useCallback(() => setAnnouncing(false), []);

  useExchangeCeremonyExpiry(announcing, data?.bothJokersException, end);

  useEffect(() => {
    if (announcing && !phasePresent) end();
  }, [announcing, phasePresent, end]);

  return { announcing, data, announce, end };
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
