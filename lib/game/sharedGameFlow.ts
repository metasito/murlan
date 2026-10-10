import { useCallback, useState } from "react";

import type { Card } from "@/lib/game/gameEngine";

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
 * The whole ceremony: what is being announced, and whether it still is. Both
 * providers run this one, so a table cannot be under a ceremony on one
 * transport and not the other. The table's `ExchangeLegs` ends it, on the
 * give's own landing plus `Motion.exchange.read`.
 *
 * `phasePresent` is `gameState.exchangePhase !== undefined` — the record this
 * ceremony describes, read fresh every render. A fresh match dealt, or the
 * table reset, while the old ceremony is still up describes a trade that no
 * longer has a record to point to, and nothing should still be showing it.
 */
export function useExchangeAnnouncement(phasePresent: boolean): ExchangeAnnouncement {
  const [opened, setOpened] = useState(false);
  const [data, setData] = useState<ExchangeAnnounceData | null>(null);

  // Closed for good by the phase leaving, not merely while it is away: left
  // open, the *next* phase would reopen it on the previous trade's `data`.
  const [shownPhase, setShownPhase] = useState(phasePresent);
  if (phasePresent !== shownPhase) {
    setShownPhase(phasePresent);
    if (!phasePresent) setOpened(false);
  }

  const announcing = opened && phasePresent;

  const announce = useCallback((next: ExchangeAnnounceData) => {
    setData(next);
    setOpened(true);
  }, []);
  const end = useCallback(() => setOpened(false), []);

  return { announcing, data, announce, end };
}
