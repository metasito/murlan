import type { Card } from "@/lib/game/gameEngine";
import type { ViewedGameState, WireExchangePhase } from "../../shared/protocol.ts";
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
  twoJokers: boolean;
  /** The winner held nothing to give back, so the deal settled the exchange: only the receive plays. */
  oneWay: boolean;
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
  phase: Pick<WireExchangePhase, "kind" | "winnerIdx" | "loserIdx">,
  cards: { given?: Card; received?: Card } = {}
): ExchangeAnnounceData {
  return {
    winnerName: players[phase.winnerIdx]?.name ?? "",
    loserName: players[phase.loserIdx]?.name ?? "",
    winnerIdx: phase.winnerIdx,
    loserIdx: phase.loserIdx,
    twoJokers: phase.kind === "twoJokers",
    oneWay: false,
    cardGiven: cards.given,
    cardReceived: cards.received,
  };
}

/**
 * Whether the deal settled this exchange with nothing handed back (docs/GAME-RULES.md § Decisions,
 * "What the winner may hand back"). The wire sends a settled phase's `cardFromLoser` for this case
 * alone, so a closed two-way phase is never mistaken for it, whoever is reading.
 */
export function isOneWay(phase: WireExchangePhase | undefined): phase is Extract<WireExchangePhase, { kind: "settled" }> & { cardFromLoser: Card } {
  return phase?.kind === "settled" && phase.cardFromLoser !== undefined && phase.cardToLoser === undefined;
}

/**
 * What one committed state announces, given the one it replaces: the give closing the phase, a
 * two-joker deal arriving or a one-way deal arriving. `prev` is null when nothing was seen before.
 * A fresh deal opening the phase announces nothing; the table draws the receive from the phase itself.
 */
export function exchangeAnnouncementOf(prev: ViewedGameState | null, next: ViewedGameState): ExchangeAnnounceData | null {
  const phase = next.exchangePhase;
  const move = moveSince(prev?.lastMove, next.lastMove);
  // Every deal records the same move, so a round that ended on none (a concession) hides the next deal from `moveSince`.
  const dealt = !prev || (prev.roundOver && !next.roundOver) || move?.kind === "deal";
  if (!phase || phase.kind === "open") return null;
  if (isOneWay(phase)) {
    return dealt && next.lastMove.kind === "deal"
      ? { ...buildExchangeAnnounce(next.players, phase, { received: phase.cardFromLoser }), oneWay: true }
      : null;
  }
  if (phase.kind === "settled") {
    // Online's closing state withholds `cardFromLoser`, so the received card is read from `prev`.
    const received = prev?.exchangePhase?.kind === "open" ? prev.exchangePhase.cardFromLoser : undefined;
    return move?.kind === "giveback" && received
      ? buildExchangeAnnounce(next.players, phase, { given: phase.cardToLoser, received })
      : null;
  }
  return dealt ? buildExchangeAnnounce(next.players, phase) : null;
}
