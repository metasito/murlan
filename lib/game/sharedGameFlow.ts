import { useCallback, useState } from "react";

// Relative and extensioned, not `@/`: `tests/engine/sharedGameFlow.test.ts` loads this
// under `node --test` — docs/agents/checks.md, "Node's TypeScript loader".
import { matchIsClosing } from "./gameEngine.ts";
import type { Card, MatchLength } from "@/lib/game/gameEngine";

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
 * Whether to ask the table about another match. Not a hook: the two providers
 * hold these inputs in different objects, so each memoises on its own and only
 * the answer is shared.
 *
 * The hand counts come in already read, because only the caller knows whether
 * a seat's hand is the hand or a count the server sent in place of one.
 */
export function rematchPromptOpen(
  game: {
    gameOver: boolean;
    handCounts: number[];
    players: readonly { id: string; team?: string }[];
  } | null,
  match: { length: MatchLength; target: number; over: boolean },
  cumulative: Record<string, number>
): boolean {
  if (!game || game.gameOver || match.over) return false;
  const teamOfKey: Record<string, string> = {};
  for (const p of game.players) {
    if (p.team) teamOfKey[p.id] = p.team;
  }
  return matchIsClosing({
    teamOfKey,
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
 * The whole ceremony: what is being announced, and whether it still is. Both
 * providers run this one, so a table cannot be under a ceremony on one
 * transport and not the other. The table's `ExchangeLegs` ends it, on the
 * legs' own landing plus a notice's reading.
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
