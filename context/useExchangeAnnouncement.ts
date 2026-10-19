import { useCallback, useState } from "react";

import type { ExchangeAnnounceData } from "@/lib/game/sharedGameFlow";

export interface ExchangeAnnouncement {
  announcing: boolean;
  data: ExchangeAnnounceData | null;
  /**
   * Opens the ceremony on this announce. One call, because the flag and the
   * data are one fact: set apart, a render between them draws the ceremony
   * from the previous exchange.
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
 * table reset, while the old ceremony is still up describes an exchange that no
 * longer has a record to point to, and nothing should still be showing it.
 */
export function useExchangeAnnouncement(phasePresent: boolean): ExchangeAnnouncement {
  const [opened, setOpened] = useState(false);
  const [data, setData] = useState<ExchangeAnnounceData | null>(null);

  // Closed for good by the phase leaving, not merely while it is away: left
  // open, the *next* phase would reopen it on the previous exchange's `data`.
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
