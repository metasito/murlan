// The exchange on the table: the live phase, each leg's stage, the seats it marks, its flights and its words.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Card, Player } from "@/lib/game/gameEngine";
import type { ExchangeAnnounceData } from "@/lib/game/sharedGameFlow";
import type { TFn } from "@/lib/i18n";
import { getCardDisplayRank, getSuitSymbol } from "../../lib/game/gameEngine.ts";
import { restPoint, type LegPoints, type LegStage } from "../../lib/timeline/exchangeTimeline.ts";
import { handCountOf, type ViewedGameState } from "../../shared/protocol.ts";
import { fanPoint } from "../fanGeometry.ts";
import type { CardFrom } from "../flightPose.ts";
import { FAN_CARD_SCALE } from "../impact.ts";
import { seatDirection, viewerOwnsSeat } from "../seatLayout.ts";
import { ownSlotFrom, type Seating, type TableLayout } from "../tableLayout.ts";

export type ExchangeView =
  | { open: false; viewerIsWinner: false; viewerIsLoser: false; winner: null; loser: null }
  | {
      open: true;
      /** The viewer owes the loser a card and must pick one. */
      viewerIsWinner: boolean;
      /** The viewer is waiting to receive a card. */
      viewerIsLoser: boolean;
      winner: Player | null;
      loser: Player | null;
      /** The card taken off the loser, which the engine has already put in the winner's hand. */
      cardFromLoser: Card;
    };

export const INACTIVE_EXCHANGE: ExchangeView = {
  open: false,
  viewerIsWinner: false,
  viewerIsLoser: false,
  winner: null,
  loser: null,
};

export function readExchange(
  state: Pick<ViewedGameState, "exchangePhase" | "players">,
  viewerSeat: number,
  spectating: boolean
): ExchangeView {
  const phase = state.exchangePhase;
  if (phase?.kind !== "open") return INACTIVE_EXCHANGE;
  return {
    open: true,
    viewerIsWinner: viewerOwnsSeat(phase.winnerIdx, viewerSeat, spectating),
    viewerIsLoser: viewerOwnsSeat(phase.loserIdx, viewerSeat, spectating),
    winner: state.players[phase.winnerIdx] ?? null,
    loser: state.players[phase.loserIdx] ?? null,
    cardFromLoser: phase.cardFromLoser,
  };
}

const airborne = (s: LegStage) => s === "flying" || s === "rest" || s === "tuck";

/**
 * The card on its way *into* this seat's hand.
 *
 * The exchange ends its phase, hands the card over and raises its ceremony in
 * one tick, so the hand holds the card before the flight carrying it has left
 * (#672). The two ends are not symmetric: each seat is receiving what the other
 * gave, never what it gave away, which really has left the hand.
 *
 * Nothing flies when both Jokers cancelled the exchange, so nothing arrives.
 */
export function arrivingCard(
  announce: ExchangeAnnounceData | null | undefined,
  viewerSeat: number | null
): Card | undefined {
  if (!announce || announce.twoJokers) return undefined;
  if (viewerOwnsSeat(announce.winnerIdx, viewerSeat)) return announce.cardReceived;
  if (viewerOwnsSeat(announce.loserIdx, viewerSeat)) return announce.cardGiven;
  return undefined;
}

interface HandArrival {
  /** Drawn although the state has already moved it: the viewer's exchanged card, until its leg leaves the hand. */
  lent?: Card;
  /** Kept out of the fan, because a flier is drawing them. */
  withheldIds: string[];
  /** The slot the row parts at: set only while the card flies in. */
  arrivingIndex?: number;
  /** What the parted slot is waiting for, so the row can travel it in. */
  descendingId?: string;
  /** The card just received, which glows once it is in the hand. */
  receivedId?: string;
}

/**
 * The viewer's exchanged cards, each drawn in exactly one place: in the hand until its leg's first
 * visible frame, as its flier until it lands, and in the hand again from then on (#650).
 */
export function readHandArrival(input: {
  /** The hand as arranged, which is where the card takes its place. */
  hand: Card[];
  announced: ExchangeAnnounceData | null;
  stages: ExchangeStages;
  /** Null for a spectator: a synthetic hand has nothing to hold back. */
  viewerSeat: number | null;
}): HandArrival {
  const { hand, announced, stages, viewerSeat } = input;
  if (!announced) return { withheldIds: [] };
  const holds = (card: Card | undefined) => !!card && hand.some((c) => c.id === card.id);
  if (announced.twoJokers) {
    const shown = viewerOwnsSeat(announced.loserIdx, viewerSeat) && airborne(stages.receive);
    return { withheldIds: shown ? hand.filter((c) => c.isJoker).map((c) => c.id) : [] };
  }
  const winner = viewerOwnsSeat(announced.winnerIdx, viewerSeat);
  if (!winner && !viewerOwnsSeat(announced.loserIdx, viewerSeat)) return { withheldIds: [] };
  const incoming = arrivingCard(announced, viewerSeat);
  const outgoing = winner ? announced.cardGiven : announced.cardReceived;
  const inStage = winner ? stages.receive : stages.give;
  const outStage = winner ? stages.give : stages.receive;
  const withheldIds: string[] = [];
  if (incoming && inStage !== "landed" && holds(incoming)) withheldIds.push(incoming.id);
  if (outgoing && outStage !== "waiting" && holds(outgoing)) withheldIds.push(outgoing.id);
  const slot = incoming && inStage === "tuck" ? hand.findIndex((c) => c.id === incoming.id) : -1;
  return {
    lent: outgoing && outStage === "waiting" && !holds(outgoing) ? outgoing : undefined,
    withheldIds,
    // A card the ceremony names but the hand does not hold parts nothing: a gap
    // with nothing ever descending into it would stay open all game.
    arrivingIndex: slot < 0 ? undefined : slot,
    descendingId: incoming?.id,
    receivedId: incoming && inStage === "landed" ? incoming.id : undefined,
  };
}

/** Each leg's stage, as `ExchangeLegs` reports it, for the exchange `key` names. */
export interface ExchangeStages { key: string; receive: LegStage; give: LegStage; ready: boolean }

export const exchangeKey = (announced: ExchangeAnnounceData): string =>
  announced.twoJokers ? `jokers:${announced.loserIdx}` : `${announced.loserIdx}>${announced.winnerIdx}`;

export const NO_STAGES: Omit<ExchangeStages, "key"> = { receive: "waiting", give: "waiting", ready: false };

/**
 * The seats an exchange marks, and how far each opponent's drawn count is from its state's. The engine
 * moves a card when the phase opens or the choice lands, so the giver shows one more until its card
 * leaves and the receiver one fewer until it lands (the fixture's `S.counts`).
 */
export function readExchangeSeats(announced: ExchangeAnnounceData | null, stages: ExchangeStages): { lit: number[]; shift: Map<number, number> } {
  const lit = new Set<number>();
  const shift = new Map<number, number>();
  const add = (seat: number, n: number) => shift.set(seat, (shift.get(seat) ?? 0) + n);
  if (!announced) return { lit: [], shift };
  if (announced.twoJokers) {
    if (airborne(stages.receive)) {
      lit.add(announced.loserIdx);
      add(announced.loserIdx, -JOKERS.length);
    }
    return { lit: [...lit], shift };
  }
  const legs = [
    { giver: announced.loserIdx, receiver: announced.winnerIdx, card: announced.cardReceived, stage: stages.receive },
    { giver: announced.winnerIdx, receiver: announced.loserIdx, card: announced.cardGiven, stage: stages.give },
  ];
  for (const { giver, receiver, card, stage } of legs) {
    if (!card) continue;
    if (airborne(stage)) lit.add(giver);
    if (stage === "rest" || stage === "tuck") lit.add(receiver);
    if (stage === "waiting") add(giver, 1);
    if (stage !== "landed") add(receiver, -1);
  }
  return { lit: [...lit], shift };
}

/** Both Jokers, red first: the fixture's `jokers()` lays them 18 pt either side of the pile's centre. */
export const JOKERS: Card[] = [
  { id: "joker_colored", suit: null, rank: "joker_colored", isJoker: true },
  { id: "joker_bw", suit: null, rank: "joker_bw", isJoker: true },
];
const JOKER_SPREAD = 18;

/** The exchange's legs, in the pile-relative points a throw flies in: from a fan or the card's own hand slot, through the pile. */
export function readExchangeLegs(
  announced: ExchangeAnnounceData,
  layout: TableLayout,
  seating: Seating,
  handOrigins?: ReadonlyMap<string, CardFrom>
): { receive: LegPoints; give: LegPoints; jokers: LegPoints[] } {
  const end = (seat: number, card?: Card) => {
    const dir = seatDirection(seat, seating.viewerSeat, seating.players.length);
    const origin = layout.seatPoint(dir);
    if (dir === "bottom") return { at: ownSlotFrom(origin, card && handOrigins?.get(card.id)), face: true };
    const player = seating.players[seat];
    return { at: { ...fanPoint(origin, dir, layout.scale, player ? handCountOf(player) : 0), scale: FAN_CARD_SCALE }, face: false };
  };
  // The receiving hand draws no slot for the card until it lands, so it arrives at the row's centre and descends from there.
  const leg = (giver: number, receiver: number, card: Card | undefined, rest = restPoint()): LegPoints => {
    const from = end(giver, card);
    const to = end(receiver, receiver === giver ? card : undefined);
    return { from: from.at, fromFace: from.face, rest, to: to.at, toFace: to.face };
  };
  const loser = announced.loserIdx;
  return {
    receive: leg(loser, announced.winnerIdx, announced.cardReceived),
    give: leg(announced.winnerIdx, loser, announced.cardGiven),
    jokers: JOKERS.map((card, i) => leg(loser, loser, card, restPoint(i === 0 ? -JOKER_SPREAD : JOKER_SPREAD))),
  };
}

export interface PillNote { text: string; testID: string }

const NOTE_ID = "exchange-pill-note";

/**
 * The turn pill's words and the last-played pill's note. They answer "is this the viewer?" from
 * different sources on purpose: the chip from the live phase, the note from the shown exchange's
 * seats, which outlive the phase — one role for both makes the winner read their own give in the
 * third person.
 */
export function exchangeNotes(input: {
  shown: ExchangeAnnounceData | null;
  stages: ExchangeStages;
  live: ExchangeView;
  players: readonly { name: string }[];
  viewerSeat: number;
  spectating: boolean;
  t: TFn;
}): { chip: string | null; pillNote: PillNote | null } {
  const { shown, stages, live, players, viewerSeat, spectating, t } = input;
  if (!shown) return { chip: null, pillNote: null };
  const name = (seat: number) => players[seat]?.name ?? "";
  const note = (text: string): PillNote => ({ text, testID: NOTE_ID });
  const giveNote = (card: Card, from: number, to: number): PillNote => {
    const c = `${getCardDisplayRank(card.rank)}${getSuitSymbol(card.suit)}`;
    return note(
      viewerOwnsSeat(from, viewerSeat, spectating)
        ? t("exchange.pileYouGive", { card: c, to: name(to) })
        : viewerOwnsSeat(to, viewerSeat, spectating)
          ? t("exchange.pileGivesYou", { from: name(from), card: c })
          : t("exchange.pileGives", { from: name(from), card: c, to: name(to) })
    );
  };
  const winnerWord = viewerOwnsSeat(shown.winnerIdx, viewerSeat, spectating) ? t("gameShared.you") : name(shown.winnerIdx);
  const pillNote = shown.twoJokers
    ? stages.receive === "rest"
      ? note(t("exchangeAnnouncement.noExchangeText"))
      : null
    : stages.receive === "rest" && shown.cardReceived
      ? giveNote(shown.cardReceived, shown.loserIdx, shown.winnerIdx)
      : shown.oneWay && stages.ready
        ? note(t("exchange.pillNothing"))
        : stages.give === "rest" && shown.cardGiven
          ? giveNote(shown.cardGiven, shown.winnerIdx, shown.loserIdx)
          : null;

  // The choice opens once the received card has landed and been read; until then the chip names the exchange.
  const loserName = live.loser?.name ?? "";
  const winnerName = live.winner?.name ?? "";
  const chip = shown.oneWay && stages.ready
    ? t("exchange.chipOneWay", { name: winnerWord })
    : !(live.open && stages.ready)
      ? t("exchange.chipTitle")
      : live.viewerIsWinner
        ? t("exchange.chipGive", { name: loserName })
        : live.viewerIsLoser
          ? t("exchange.waitingForYou", { winner: winnerName })
          : t("exchange.watching", { winner: winnerName, loser: loserName });
  return { chip, pillNote };
}
