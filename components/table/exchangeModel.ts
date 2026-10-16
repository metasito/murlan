// The exchange on the table: the live phase, each leg's stage, the seats it marks, its flights and its words.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Card, GameState, Player } from "@/lib/game/gameEngine";
import type { ExchangeAnnounceData } from "@/lib/game/sharedGameFlow";
import type { TFn } from "@/lib/i18n";
import { getCardDisplayRank, getSuitSymbol, givebackIsFallback } from "../../lib/game/gameEngine.ts";
import { restPoint, type LegPoints, type LegStage } from "../../lib/game/exchangeTimeline.ts";
import { handCountOf } from "../../shared/protocol.ts";
import { FIELD_SCALE, HAND_SCALE } from "../cardFaceModel.ts";
import { fanPoint } from "../fanGeometry.ts";
import { airborne, FAN_CARD_SCALE, seatPoint, type SeatGeometry } from "../flightPhysics.ts";
import type { CardFrom } from "../flightPose.ts";
import { seatDirection, viewerOwnsSeat } from "../seatLayout.ts";

export interface ExchangeView {
  active: boolean;
  /** The viewer owes the loser a card and must pick one. */
  viewerIsWinner: boolean;
  /** The viewer is waiting to receive a card. */
  viewerIsLoser: boolean;
  winner: Player | null;
  loser: Player | null;
  /** The card taken off the loser, which the engine has already put in the winner's hand. */
  cardFromLoser: Card | null;
}

export const INACTIVE_EXCHANGE: ExchangeView = {
  active: false,
  viewerIsWinner: false,
  viewerIsLoser: false,
  winner: null,
  loser: null,
  cardFromLoser: null,
};

export function readExchange(
  state: GameState,
  viewerSeat: number,
  spectating: boolean
): ExchangeView {
  const phase = state.exchangePhase;
  if (!phase?.active) return INACTIVE_EXCHANGE;
  return {
    active: true,
    viewerIsWinner: viewerOwnsSeat(phase.winnerIdx, viewerSeat, spectating),
    viewerIsLoser: viewerOwnsSeat(phase.loserIdx, viewerSeat, spectating),
    winner: state.players[phase.winnerIdx] ?? null,
    loser: state.players[phase.loserIdx] ?? null,
    cardFromLoser: phase.cardFromLoser ?? null,
  };
}

/** Each leg's stage, as `ExchangeLegs` reports it, for the exchange `key` names. */
export interface ExchangeStages { key: string; receive: LegStage; give: LegStage; ready: boolean }

export const exchangeKey = (announced: ExchangeAnnounceData): string =>
  announced.twoJokerException ? `jokers:${announced.loserIdx}` : `${announced.loserIdx}>${announced.winnerIdx}`;

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
  if (announced.twoJokerException) {
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
  input: SeatGeometry & { announced: ExchangeAnnounceData },
  handOrigins?: ReadonlyMap<string, CardFrom>
): { receive: LegPoints; give: LegPoints; jokers: LegPoints[] } {
  const { announced } = input;
  const end = (seat: number, card?: Card) => {
    const dir = seatDirection(seat, input.viewerSeat, input.players.length);
    const origin = seatPoint(input, dir);
    if (dir === "bottom") {
      const own = card && handOrigins?.get(card.id);
      const at = own ? { ...own, x: own.x + origin.dx, y: own.y + origin.dy } : { x: origin.dx, y: origin.dy, rot: 0, scale: HAND_SCALE / FIELD_SCALE };
      return { at, face: true };
    }
    const player = input.players[seat];
    return { at: { ...fanPoint(origin, dir, input.scale, player ? handCountOf(player) : 0), scale: FAN_CARD_SCALE }, face: false };
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

export interface PileNote { text: string; testID: string; cards: Card[] }

/**
 * The chip over the hand and the note on the pile. They answer "is this the viewer?" from different
 * sources on purpose: the chip from the live phase, the note from the shown exchange's seats, which
 * outlive the phase — one role for both makes the winner read their own give in the third person.
 */
export function exchangeNotes(input: {
  shown: ExchangeAnnounceData | null;
  stages: ExchangeStages;
  live: ExchangeView;
  /** The winner's legal gives, only while their choice is open. */
  giveable: Card[] | undefined;
  players: readonly { name: string }[];
  viewerSeat: number;
  spectating: boolean;
  t: TFn;
}): { chip: string | null; pileNote: PileNote | null } {
  const { shown, stages, live, giveable, players, viewerSeat, spectating, t } = input;
  if (!shown) return { chip: null, pileNote: null };
  const name = (seat: number) => players[seat]?.name ?? "";
  const giveNote = (card: Card, from: number, to: number): PileNote => {
    const c = `${getCardDisplayRank(card.rank)}${getSuitSymbol(card.suit)}`;
    const text = viewerOwnsSeat(from, viewerSeat, spectating)
      ? t("exchange.pileYouGive", { card: c, to: name(to) })
      : viewerOwnsSeat(to, viewerSeat, spectating)
        ? t("exchange.pileGivesYou", { from: name(from), card: c })
        : t("exchange.pileGives", { from: name(from), card: c, to: name(to) });
    return { text, testID: "exchange-pile-label", cards: [card] };
  };
  const pileNote = shown.twoJokerException
    ? stages.receive === "rest"
      ? { text: t("exchangeAnnouncement.noExchangeText"), testID: "exchange-none", cards: JOKERS }
      : null
    : stages.receive === "rest" && shown.cardReceived
      ? giveNote(shown.cardReceived, shown.loserIdx, shown.winnerIdx)
      : stages.give === "rest" && shown.cardGiven
        ? giveNote(shown.cardGiven, shown.winnerIdx, shown.loserIdx)
        : null;

  // The choice opens once the received card has landed and been read; until then the chip names the exchange.
  const loserName = live.loser?.name ?? "";
  const winnerName = live.winner?.name ?? "";
  const chip = !(live.active && stages.ready)
    ? t("exchange.chipTitle")
    : live.viewerIsWinner
      ? giveable && givebackIsFallback(giveable)
        ? t("exchange.noValidCards")
        : t("exchange.chipGive", { name: loserName })
      : live.viewerIsLoser
        ? t("exchange.waitingForYou", { winner: winnerName })
        : t("exchange.watching", { winner: winnerName, loser: loserName });
  return { chip, pileNote };
}
