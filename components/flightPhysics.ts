// Card-flight and pile physics, and the impact feedback a landing earns.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Card, Combination, GameState, Player } from "@/lib/game/gameEngine";
import type { ExchangeAnnounceData } from "@/lib/game/sharedGameFlow";
import { Spacing, Trauma } from "../lib/tokens.ts";
import { HAND_ZONE_H, SEAT_DISC, seatDirection, seatLabelH, viewerOwnsSeat } from "./seatLayout.ts";
import type { FlyDirection, OpponentArrangement } from "./seatLayout.ts";
import { sideSlotHeight, topBandHeight } from "./tableFrame.ts";
import { handCountOf } from "../shared/protocol.ts";
import { FIELD_SCALE, HAND_SCALE } from "./cardFaceModel.ts";
import { floatAboveFoot } from "./table/noticeModel.ts";
import { fanPoint } from "./fanGeometry.ts";
import type { CardFrom } from "./flightPose.ts";
import { restPoint, type LegPoints, type LegStage } from "../lib/game/exchangeTimeline.ts";

/** A card leaving a fan starts at the mockup's `.4` of its size on the felt (index.html `play()`). */
export const FAN_CARD_SCALE = 0.4;

// ─── Flight and impact timing ─────────────────────────────────────────────────
//
// A played combination flies from its seat to the pile before it arrives. Sound,
// haptics and the bomb's screen shake are the *impact*, so they belong at the
// moment the card lands — firing them at launch puts the bang a third of a
// second before the thing that caused it.
//
// PileLayer (components/table/pile.tsx) owns the animation; these are the numbers both it
// and the table's feedback read, so the two cannot drift apart.

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
  if (!announce || announce.bothJokersException || viewerSeat === null) return undefined;
  if (viewerSeat === announce.winnerIdx) return announce.cardReceived;
  if (viewerSeat === announce.loserIdx) return announce.cardGiven;
  return undefined;
}

/** The mockup's `landWobble` (#1242), off the Motion scale: its sine rates are set against this span. */
export const LAND_WOBBLE_MS = 400;

/**
 * Its scale and rotation in degrees, `k` of the way through. Both are at rest at 0 and at 1, so
 * reduced motion needs only `k` held at 0.
 */
export function landWobble(k: number): { scale: number; rotate: number } {
  "worklet";
  const t = (k * LAND_WOBBLE_MS) / 1000;
  return {
    scale: 1 + 0.035 * Math.sin(50.8 * t) * Math.pow(1 - k, 3),
    rotate: 0.6 * Math.sin(40.8 * t) * Math.pow(1 - k, 2),
  };
}

// ─── Screen shake ──────────────────────────────────────────────────────────────
//
// The table's trauma at each rung of the landing escalation #101 settled — the
// one place #764 (the beaten pile's flinch) and #765 (the lamp flare) key
// their own magnitudes off, by the same five tiers, rather than inventing a
// second classification that could disagree with this one.

export type ImpactTier = "ordinary" | "straightFlush" | "bomb" | "mancheWon" | "partitaWon";

const TRAUMA_BY_TIER: Record<ImpactTier, number> = {
  ordinary: 0,
  straightFlush: 0,
  bomb: Trauma.bomb,
  mancheWon: Trauma.mancheWon,
  partitaWon: Trauma.partitaWon,
};

/** The tier a played combination's own shape lands at, on its own. */
export function comboImpactTier(comboType: Combination["type"]): ImpactTier {
  if (comboType === "bomb") return "bomb";
  if (comboType === "straight" || comboType === "royal_straight") return "straightFlush";
  return "ordinary";
}

/**
 * The tier one landing falls at, once whatever it closed is folded in.
 *
 * A manche closes when `GameState.gameOver` turns true — `processPlay`
 * (lib/game/gameEngine.ts) sets it the moment a hand empties, its own comment
 * calling that "the hand is decided", which `docs/GAME-RULES.md` names the
 * manche. A partita closing is a *further* fact about that same landing,
 * carried by the match verdict (`lib/game/matchState.ts` `MatchVerdict.over`,
 * `context/GameContext.tsx` `applyHandToMatch`, the online
 * `game:over`/`matchOver` payload): the hand that empties a seat's hand is
 * also the hand that happens to close the match, never a second, later
 * event. `GameState.roundWinner` is not read here — `docs/GAME-RULES.md` §9
 * calls that a *trick*, and it closes many times a hand.
 *
 * One landing fires one tier: a play that is itself a bomb and also closes
 * the manche or the partita is still only as loud as its loudest rung —
 * `TRAUMA_BY_TIER` is what decides which that is, so this can't disagree
 * with the table by naming a tier lower than the play already earned.
 */
export function landingTier(input: {
  comboType: Combination["type"];
  handOver: boolean;
  matchOver: boolean;
}): ImpactTier {
  const playTier = comboImpactTier(input.comboType);
  if (!input.handOver) return playTier;
  const closureTier: ImpactTier = input.matchOver ? "partitaWon" : "mancheWon";
  return TRAUMA_BY_TIER[playTier] >= TRAUMA_BY_TIER[closureTier] ? playTier : closureTier;
}

/** The tier's peak trauma, or 0 outright when the player asked for less motion or no shake. */
export function traumaFor(tier: ImpactTier, reduceMotion: boolean, shakeOff: boolean): number {
  "worklet";
  return reduceMotion || shakeOff ? 0 : TRAUMA_BY_TIER[tier];
}

/**
 * How far the beaten combination (`components/table/trick.ts`, `beatenPlay`) is knocked as the new
 * one lands on it, scaled by the table like `shakeOffset` — colocated with
 * `TRAUMA_BY_TIER` so #764 and #765 read the same five tiers. `straightFlush`
 * is not silent, unlike trauma: #101's own table keeps it the smallest
 * non-zero step on purpose, reserving the escalation's headroom for the
 * bomb. Widen `Spacing.xxs` here — not `TRAUMA_BY_TIER` — if that reads too
 * subtle on a device.
 */
const FLINCH_BY_TIER: Record<ImpactTier, number> = {
  ordinary: 0,
  straightFlush: Spacing.xxs,
  bomb: Spacing.slim,
  mancheWon: Spacing.slim,
  partitaWon: Spacing.slim,
};

/** The tier's own flinch, or 0 outright when the player asked for less motion — the caller scales the answer by the table the way `shakeOffset` scales trauma. */
export function flinchFor(tier: ImpactTier, reduceMotion: boolean): number {
  "worklet";
  return reduceMotion ? 0 : FLINCH_BY_TIER[tier];
}

/**
 * The shake's own amplitude `elapsedMs` into a decay window of `decayMs` —
 * trauma squared, not trauma (see `Trauma`, lib/tokens.ts, for why squaring
 * wins over the raw value): the tier's own trauma decays linearly to 0 across
 * `decayMs`, and what the table reads back is that decaying value squared.
 * `decayMs` is a parameter rather than a constant read in here: the caller
 * resolves it through `motionMs("shake", reduceMotion)` (`Motion.duration.shake`,
 * lib/tokens.ts), so this file never holds its own copy of a timing value for
 * `motionMs`/`Motion.reduced` to drift from. `decayMs` 0 (the reduced-motion
 * answer) is rest, not a division by zero.
 */
export function shakeMagnitude(trauma: number, elapsedMs: number, decayMs: number): number {
  "worklet";
  if (decayMs <= 0) return 0;
  const t = Math.min(Math.max(elapsedMs, 0), decayMs) / decayMs;
  const remaining = trauma * (1 - t);
  return remaining * remaining;
}

/** Full cycles the shake wiggles through across its own decay window. */
const SHAKE_CYCLES = 3;
/**
 * Peak displacement at trauma 1, before the tier's own trauma scales it down
 * — `Spacing.md`/`Spacing.snug` (lib/tokens.ts), not a pixel literal: a
 * shake is a distance on the same scale as a padding, the way `hitSlop` is.
 */
const SHAKE_AMPLITUDE_X = Spacing.md;
const SHAKE_AMPLITUDE_Y = Spacing.snug;

/**
 * The bomb's own peak, layered on top of the amplitude above rather than
 * replacing it: `kick` (`components/useTableFeedback.ts`) is gated to
 * `bomb`/`royal_straight` alone, so a manche or partita closed by an
 * ordinary combination has no kick to lean on, and one shared amplitude
 * moves every tier by the same ratio once trauma is squared — this is
 * reserved for the one tier that needs the headroom.
 */
const BOMB_SHAKE_AMPLITUDE_X = Spacing.xxl;
const BOMB_SHAKE_AMPLITUDE_Y = Spacing.lg;
const BOMB_SHAKE_ROTATE_DEG = 1.2;

interface ShakeAmplitude {
  x: number;
  y: number;
  /** Degrees at trauma 1. */
  rotate: number;
}

/** Which peak a tier's shake reads — every tier but the bomb shares the default above. */
export function shakeAmplitudeFor(tier: ImpactTier): ShakeAmplitude {
  "worklet";
  if (tier === "bomb") {
    return { x: BOMB_SHAKE_AMPLITUDE_X, y: BOMB_SHAKE_AMPLITUDE_Y, rotate: BOMB_SHAKE_ROTATE_DEG };
  }
  return { x: SHAKE_AMPLITUDE_X, y: SHAKE_AMPLITUDE_Y, rotate: 0 };
}

/**
 * The table's own displacement `elapsedMs` into a shake of `decayMs` —
 * `shakeMagnitude` riding a decaying wiggle rather than a single
 * push-and-recover, so the hit reads as a shake rather than a shove. `cos`
 * rather than `sin`: the jolt peaks at the moment of impact (`elapsedMs` 0)
 * instead of building up to it. `scale` is the table's own — `kick`
 * (components/useTableFeedback.ts) multiplies its jolts by the same value, so
 * a shake is a fraction of the table rather than a fixed pixel count that
 * reads huge on a phone and vanishes on a tablet. `amplitude` defaults to the
 * shared peak above; the caller passes `shakeAmplitudeFor(tier)` to let one
 * tier read a different one.
 */
export function shakeOffset(
  trauma: number,
  elapsedMs: number,
  decayMs: number,
  scale: number,
  amplitude: ShakeAmplitude = { x: SHAKE_AMPLITUDE_X, y: SHAKE_AMPLITUDE_Y, rotate: 0 }
): { x: number; y: number; rotate: number } {
  "worklet";
  const magnitude = shakeMagnitude(trauma, elapsedMs, decayMs);
  const phase = decayMs <= 0 ? 0 : (elapsedMs / decayMs) * Math.PI * 2 * SHAKE_CYCLES;
  const wiggle = decayMs <= 0 ? 0 : Math.cos(phase);
  return {
    x: magnitude * wiggle * amplitude.x * scale,
    y: magnitude * wiggle * amplitude.y * scale,
    rotate: magnitude * Math.sin(phase) * amplitude.rotate,
  };
}

// ─── Lamp flare and lift (#765) ──────────────────────────────────────────────
//
// The lamp's own reaction to a landing, at the graduated tiers #101 settled
// (the "C — Cinema" row of #772's grammar). Reads `ImpactTier` — the same
// tier #763 squares into a shake — rather than a second table: a manche is
// the expected ending and hands over to its own banner, so it lifts instead
// of flaring; the bomb and the partita both throw light, because both are the
// surprise the shake already ranks above a manche closing.

/** What the lamp's own flare does at a tier's landing, if anything. */
export type FlareKind = "none" | "brief" | "settle";

export function flareKindFor(tier: ImpactTier): FlareKind {
  "worklet";
  if (tier === "bomb") return "brief";
  if (tier === "partitaWon") return "settle";
  return "none";
}

/** Whether a tier's landing lifts the lamp rather than flaring it. */
export function lampLiftFor(tier: ImpactTier): boolean {
  "worklet";
  return tier === "mancheWon";
}

// ─── Seat anchors ──────────────────────────────────────────────────────────────
//
// Where a throw starts. docs/adr/0002-a-play-leaves-the-seat-it-was-thrown-from.md §1.

export type TableGeometry = {
  scale: number;
  windowWidth: number;
  windowHeight: number;
  tableLeft: number;
  tableRight: number;
  tableTop: number;
  /** `TableFrame.surplus` — how far above the window's bottom the table ends. */
  surplus: number;
  /** HAND_ZONE_H(handCardH, bottomPad) — the hand row's own height. */
  handZoneH: number;
};

export type SeatPlace = Omit<SeatGeometry, "players" | "opponents" | "viewerSeat">;

export function tableGeometry(place: SeatPlace): TableGeometry {
  return {
    scale: place.scale,
    windowWidth: place.windowWidth,
    windowHeight: place.windowHeight,
    tableLeft: place.tableLeft,
    tableRight: place.tableRight,
    tableTop: place.tableTop,
    surplus: place.surplus,
    handZoneH: HAND_ZONE_H(place.handCardH, place.bottomPad),
  };
}

/**
 * Each seat's point and the pile's centre, in window points: a ring's centre, or the hand zone's
 * before its lift. The bands are the drawn cap's (`topBandHeight`, `sideSlotHeight`), laid out by
 * GameTable.tsx's `table-top-section` and side sections, which is why no count reaches here.
 */
export function anchorPoints(g: TableGeometry): Record<FlyDirection | "pile", { x: number; y: number }> {
  const ring = SEAT_DISC * g.scale;
  const midTop = g.tableTop + topBandHeight(g.scale);
  const tableFloor = g.windowHeight - g.surplus;
  const midH = tableFloor - midTop - g.handZoneH;
  const x = g.tableLeft + (g.windowWidth - g.tableLeft - g.tableRight) / 2;
  const sideY = midTop + sideSlotHeight(g.scale) / 2;
  return {
    pile: { x, y: midTop + midH / 2 },
    top: { x, y: g.tableTop + seatLabelH(g.scale) + ring / 2 },
    bottom: { x, y: tableFloor - g.handZoneH / 2 },
    left: { x: g.tableLeft + Spacing.sm + ring / 2, y: sideY },
    right: { x: g.windowWidth - g.tableRight - Spacing.sm - ring / 2, y: sideY },
  };
}

/** The float slot's top edge, in window points: `.floatchip`, above the hand row's floor. */
export function floatTop(place: SeatPlace): number {
  return place.windowHeight - place.surplus - place.bottomPad - floatAboveFoot(place.scale);
}

/**
 * The delta a throw starts at: from the throwing seat's own point to the
 * pile's. `PileLayer` (components/table/pile.tsx) animates this toward
 * zero, on the views the pile then keeps, so the throw lands where the
 * cards rest.
 */
export function flightOrigin(input: TableGeometry & { dir: FlyDirection }): { dx: number; dy: number } {
  const anchors = anchorPoints(input);
  return { dx: anchors[input.dir].x - anchors.pile.x, dy: anchors[input.dir].y - anchors.pile.y };
}

/**
 * Identity of a played combination. Two different players playing the same
 * card ids is impossible, but the same player replaying an identical-looking
 * combination in a later round is not — hence the seat in the key.
 */
export function comboKey(combo: Combination, playedBy: number): string {
  return combo.cards.map((c) => c.id).join(",") + "_" + playedBy;
}

/**
 * The pass that just closed a round, seen from one state. `processPass`
 * (lib/game/gameEngine.ts) clears `lastPlayedCombination` and credits `roundWinner`
 * in the same transition, so the table gets both on a single commit — and the
 * winning cards must stay on the felt under the tag that announces them
 * instead of being wiped by the empty-table branch.
 */
export function roundClosedWithWinner(state: {
  lastPlayedCombination: Combination | null;
  roundWinner?: number | null;
}): boolean {
  return (
    state.lastPlayedCombination === null &&
    state.roundWinner !== null &&
    state.roundWinner !== undefined
  );
}

/**
 * The seats that have passed in the round on the table, in pass order.
 *
 * A pass changes nothing visible, so this derives it from what did: turns run
 * from `lastPlayedBy` in *descending* seat order and the pile only moves on a
 * play, so every seat in between has passed. Seats holding no cards are
 * stepped over — a false marker is worse than none.
 *
 * Empty between rounds, and empty when the seat on move is the one that
 * played: that span is a full circle. `outOfCards` carries the seat count.
 */
export function passedSeats(state: {
  currentTurnIndex: number;
  lastPlayedBy: number;
  lastPlayedCombination: Combination | null;
  /** Indexed by seat: true once that seat holds no cards. */
  outOfCards: readonly boolean[];
}): number[] {
  const { currentTurnIndex, lastPlayedBy, outOfCards } = state;
  const seatCount = outOfCards.length;
  if (state.lastPlayedCombination === null) return [];
  if (lastPlayedBy < 0 || lastPlayedBy >= seatCount) return [];
  if (currentTurnIndex === lastPlayedBy) return [];

  const passed: number[] = [];
  for (let step = 1; step < seatCount; step++) {
    const seat = (((lastPlayedBy - step) % seatCount) + seatCount) % seatCount;
    if (seat === currentTurnIndex) break;
    if (outOfCards[seat]) continue;
    passed.push(seat);
  }
  return passed;
}

type PassView = Parameters<typeof passedSeats>[0] & { roundWinner?: number | null };

/**
 * The seats one change of state shows passing: each `passedSeats` names anew, and the seat on move
 * when a pass closed the round, which `passedSeats` never names because the round is gone with it.
 */
export function seatsJustPassed(before: PassView, after: PassView): number[] {
  const was = passedSeats(before);
  const now = passedSeats(after).filter((seat) => !was.includes(seat));
  const closedByPass =
    before.lastPlayedCombination !== null && roundClosedWithWinner(after) && after.lastPlayedBy === before.lastPlayedBy;
  return closedByPass ? [...now, before.currentTurnIndex] : now;
}

// ─── Exchange phase ───────────────────────────────────────────────────────────

interface ExchangeView {
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

/** Each leg's stage, as `ExchangeLegs` reports it, for the trade `key` names. */
export interface TradeStages { key: string; receive: LegStage; give: LegStage; ready: boolean }

export const tradeKey = (trade: ExchangeAnnounceData): string =>
  trade.bothJokersException ? `jokers:${trade.loserIdx}` : `${trade.loserIdx}>${trade.winnerIdx}:${trade.cardReceived?.id ?? ""}`;

export const NO_STAGES: Omit<TradeStages, "key"> = { receive: "waiting", give: "waiting", ready: false };

const airborne = (s: LegStage) => s === "flying" || s === "rest" || s === "tuck";

/**
 * The seats a trade marks, and how far each opponent's drawn count is from its state's. The engine
 * moves a card when the phase opens or the choice lands, so the giver shows one more until its card
 * leaves and the receiver one fewer until it lands (the fixture's `S.counts`).
 */
export function readTradeSeats(trade: ExchangeAnnounceData | null, stages: TradeStages): { lit: number[]; shift: Map<number, number> } {
  const lit = new Set<number>();
  const shift = new Map<number, number>();
  const add = (seat: number, n: number) => shift.set(seat, (shift.get(seat) ?? 0) + n);
  if (!trade) return { lit: [], shift };
  if (trade.bothJokersException) {
    if (airborne(stages.receive)) {
      lit.add(trade.loserIdx);
      add(trade.loserIdx, -JOKERS.length);
    }
    return { lit: [...lit], shift };
  }
  const legs = [
    { giver: trade.loserIdx, receiver: trade.winnerIdx, card: trade.cardReceived, stage: stages.receive },
    { giver: trade.winnerIdx, receiver: trade.loserIdx, card: trade.cardGiven, stage: stages.give },
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

interface HandArrival {
  /** Drawn although the state has already moved it: the viewer's traded card, until its leg leaves the hand. */
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
 * The viewer's traded cards, each drawn in exactly one place: in the hand until its leg's first
 * visible frame, as its flier until it lands, and in the hand again from then on (#650).
 */
export function readHandArrival(input: {
  /** The hand as arranged, which is where the card takes its place. */
  hand: Card[];
  trade: ExchangeAnnounceData | null;
  stages: TradeStages;
  /** Null for a spectator: a synthetic hand has nothing to hold back. */
  viewerSeat: number | null;
}): HandArrival {
  const { hand, trade, stages, viewerSeat } = input;
  if (!trade || viewerSeat === null) return { withheldIds: [] };
  const holds = (card: Card | undefined) => !!card && hand.some((c) => c.id === card.id);
  if (trade.bothJokersException) {
    const shown = viewerSeat === trade.loserIdx && airborne(stages.receive);
    return { withheldIds: shown ? hand.filter((c) => c.isJoker).map((c) => c.id) : [] };
  }
  const winner = viewerSeat === trade.winnerIdx;
  if (!winner && viewerSeat !== trade.loserIdx) return { withheldIds: [] };
  const incoming = arrivingCard(trade, viewerSeat);
  const outgoing = winner ? trade.cardGiven : trade.cardReceived;
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

// ─── Thrown plays ─────────────────────────────────────────────────────────────

interface ThrownPlay {
  dir: FlyDirection;
  cards: Card[];
  /** Where each card starts, from the pile's centre: its own hand slot, or its seat's fan. */
  from: CardFrom[];
  /** Where it lands: the pile's centre, in window points. */
  pile: { x: number; y: number };
  /** Impact reads heavier for these. */
  heavy: boolean;
  /** The throw emptied the hand it came from, so the flush is owed. */
  emptiedHand: boolean;
}

export interface ThrownPlayInput {
  combo: Combination;
  playedBy: number;
  viewerSeat: number;
  players: readonly Player[];
  opponents: OpponentArrangement<Player>;
  scale: number;
  windowWidth: number;
  windowHeight: number;
  /**
   * `TableFrame`'s own fields rather than the frame. Naming the frame inside
   * an effect is what `react-hooks/exhaustive-deps` makes it demand, and
   * `computeTableFrame` runs on every render — so the caller would re-run on
   * every render to pass one object it rebuilt anyway.
   */
  tableLeft: number;
  tableRight: number;
  tableTop: number;
  surplus: number;
  bottomPad: number;
  /** A hand card's height, which is what sets the height of the hand row. */
  handCardH: number;
}

export type SeatGeometry = Omit<ThrownPlayInput, "combo" | "playedBy">;

/**
 * Everything a throw decides, from the state it was thrown out of.
 */
export function readThrownPlay(input: ThrownPlayInput, handOrigins?: ReadonlyMap<string, CardFrom>): ThrownPlay {
  const { combo, playedBy, players } = input;
  const dir = seatDirection(playedBy, input.viewerSeat, players.length);
  const anchors = anchorPoints(tableGeometry(input));
  const pile = anchors.pile;
  const origin = { dx: anchors[dir].x - pile.x, dy: anchors[dir].y - pile.y };
  const thrower = players[playedBy];
  let from: CardFrom[];
  if (dir === "bottom") {
    from = combo.cards.map((card) => {
      const own = handOrigins?.get(card.id);
      return own
        ? { ...own, x: own.x + origin.dx, y: own.y + origin.dy }
        : { x: origin.dx, y: origin.dy, rot: 0, scale: HAND_SCALE / FIELD_SCALE };
    });
  } else {
    const fan = fanPoint(origin, dir, input.scale, thrower ? handCountOf(thrower) : 0);
    from = combo.cards.map(() => ({ ...fan, scale: FAN_CARD_SCALE }));
  }
  return {
    dir,
    cards: combo.cards,
    heavy: combo.type === "bomb" || combo.type === "royal_straight",
    emptiedHand: !!thrower && handCountOf(thrower) === 0,
    from,
    pile,
  };
}

/** A seat's own point from the pile, nothing leaving its hand: where a closed round is swept, and where a dealt card lands. */
export function seatPoint(place: SeatPlace, dir: FlyDirection): { dx: number; dy: number } {
  return flightOrigin({ ...tableGeometry(place), dir });
}

/** Both Jokers, red first: the fixture's `jokers()` lays them 18 pt either side of the pile's centre. */
export const JOKERS: Card[] = [
  { id: "joker_colored", suit: null, rank: "joker_colored", isJoker: true },
  { id: "joker_bw", suit: null, rank: "joker_bw", isJoker: true },
];
const JOKER_SPREAD = 18;

/** The trade's legs, in the pile-relative points a throw flies in: from a fan or the card's own hand slot, through the pile. */
export function readExchangeLegs(
  input: SeatGeometry & { trade: ExchangeAnnounceData },
  handOrigins?: ReadonlyMap<string, CardFrom>
): { receive: LegPoints; give: LegPoints; jokers: LegPoints[] } {
  const { trade } = input;
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
  const loser = trade.loserIdx;
  return {
    receive: leg(loser, trade.winnerIdx, trade.cardReceived),
    give: leg(trade.winnerIdx, loser, trade.cardGiven),
    jokers: JOKERS.map((card, i) => leg(loser, loser, card, restPoint(i === 0 ? -JOKER_SPREAD : JOKER_SPREAD))),
  };
}
