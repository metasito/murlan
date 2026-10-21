import type { Card, GameState } from "@/lib/game/gameEngine";
import { moveSince } from "./moves.ts";

export interface ExchangeAnnounceData {
  winnerName: string;
  loserName: string;
  /**
   * The seats, not only the names: the cards fly between the two seats, and
   * two players may share a name.
   */
  winnerIdx: number;
  loserIdx: number;
  twoJokerException: boolean;
  cardGiven?: Card;
  cardReceived?: Card;
}

/** How long an offline e2e build holds the exchange overlay: milliseconds, or until the overlay is tapped. */
export type ExchangeHold = number | "untilTapped";

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
  phase: { winnerIdx: number; loserIdx: number; twoJokerException?: boolean },
  cards: { given?: Card; received?: Card } = {}
): ExchangeAnnounceData {
  return {
    winnerName: players[phase.winnerIdx]?.name ?? "",
    loserName: players[phase.loserIdx]?.name ?? "",
    winnerIdx: phase.winnerIdx,
    loserIdx: phase.loserIdx,
    twoJokerException: phase.twoJokerException === true,
    cardGiven: cards.given,
    cardReceived: cards.received,
  };
}

/**
 * What one committed state announces, given the one it replaces: the give closing the phase, or a
 * two-joker deal arriving. `prev` is null when nothing was seen before, and then the deal counts as
 * unseen. A fresh deal opening the phase announces nothing; the table draws the receive from the phase.
 */
export function exchangeAnnouncementOf(prev: GameState | null, next: GameState): ExchangeAnnounceData | null {
  const phase = next.exchangePhase;
  const move = moveSince(prev?.lastMove, next.lastMove);
  if (!move || !phase || phase.active) return null;
  if (move.kind === "giveback" && prev?.exchangePhase?.active) {
    // Online's closing state withholds `cardFromLoser`, so the received card is read from `prev`.
    const received = prev.exchangePhase.cardFromLoser;
    const given = phase.cardToLoser;
    return received || given ? buildExchangeAnnounce(next.players, phase, { given, received }) : null;
  }
  return phase.twoJokerException && (!prev || move.kind === "deal") ? buildExchangeAnnounce(next.players, phase) : null;
}
