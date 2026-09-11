// Card-flight and pile physics, and the impact feedback a landing earns.
//
// JSX-free, runtime imports relative — docs/agents/loops.md, "Node's TypeScript loader".

import type { Card, Combination, GameState, Player } from "@/lib/gameEngine";
import type { ExchangeAnnounceData } from "@/lib/sharedGameFlow";
import { Hold, Motion, Spacing, Trauma } from "../lib/tokens.ts";
import {
  HAND_ZONE_H,
  SEAT_DISC,
  SIDE_SECTION_W,
  displayedHandCount,
  handCountOf,
  seatDirection,
  seatGap,
  seatLabelH,
  sideSlotHeight,
  topFanHeight,
  viewerOwnsSeat,
} from "./seatLayout.ts";
import type { FlyDirection, OpponentArrangement } from "./seatLayout.ts";

// ─── Pile state ───────────────────────────────────────────────────────────────
//
// The pile shows at most two layers: the combination currently on the table and
// the faded one it beat. Getting this wrong made cards appear twice or not at
// all, which is why the transition is a pure function with its own tests.

export interface PileState {
  prev: Combination | null;
  current: Combination | null;
  /** Seat `current` came from — carried alongside it so a name and its combination can never name different plays. */
  playedBy: number | null;
}

export const EMPTY_PILE: PileState = { prev: null, current: null, playedBy: null };

// ─── Flight and impact timing ─────────────────────────────────────────────────
//
// A played combination flies from its seat to the pile before it arrives. Sound,
// haptics and the bomb's screen shake are the *impact*, so they belong at the
// moment the card lands — firing them at launch puts the bang a third of a
// second before the thing that caused it.
//
// FlyingCards (components/table/pile.tsx) owns the animation; these are the numbers both it
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

// The card in flight is `travel` (#126) — 380 was Weighted, the alternative
// the owner rejected in favour of this one. Derived rather than restated, so
// the throw cannot drift back to a number the decision already turned down.
export const FLIGHT_MS: number = Motion.duration.travel;
/** Fraction of the flight after which the card is on the felt and settling. */
export const LANDING_FRACTION = 0.82;

/** Delay from a play being registered to the card touching the pile. */
export function impactDelayMs(reduceMotion: boolean): number {
  // Under reduced motion FlyingCards skips the flight, so there is nothing to
  // wait for and the feedback fires immediately.
  return reduceMotion ? 0 : Math.round(FLIGHT_MS * LANDING_FRACTION);
}

/**
 * The beat the table sits still on at contact, before the aftermath — the
 * settle spring, and the pile bounce riding its callback — runs.
 *
 * A hold marks a landing, so it is asked of the landing rather than of
 * `reduceMotion`: reading the flag here as well is the second derivation the
 * two could drift apart on. One value; the ladder of beats is #101's.
 */
export function landingHoldMs(reduceMotion: boolean): number {
  return impactDelayMs(reduceMotion) === 0 ? 0 : Hold.land;
}

/**
 * How far a card compresses on the axis it fell, at the peak of contact —
 * `settle` at 1. Shy of `LAND_DIP`'s bounce: a card is a face, not a ball, so
 * the deformation reads as pressed rather than squashed flat.
 */
export const LAND_SQUASH = 0.92;

/**
 * The card's squash-and-stretch at contact, riding the pile's own `settle`
 * value rather than a timeline of its own — the squash rides `Motion.spring.land`
 * because `settle` is what that spring drives; a second derivation is the
 * thing that could drift from it. `x * y` is 1 for every input, so
 * compressing one axis always expands the other by exactly as much — a
 * uniform scale-down would be a card shrinking, not a card landing.
 *
 * At `settle` 0 both axes are 1: no deformation. That covers the whole of
 * reduced motion for free as long as `settle` is actually 0 there —
 * `settleForMotion` is what keeps that true.
 */
export function landSquashScale(settle: number): { x: number; y: number } {
  "worklet";
  const y = 1 - (1 - LAND_SQUASH) * settle;
  return { x: 1 / y, y };
}

/**
 * What `settle` should read the moment a flight's motion preference is
 * decided — at mount, and again if the player toggles reduced motion while a
 * flight is up. Reanimated's `cancelAnimation` (run by the effect's own
 * cleanup on that toggle) freezes a shared value at its current number
 * rather than resetting it, so the branch that skips the flight cannot rely
 * on `current` already being 0 by the time it runs: under reduced motion
 * this ignores `current` and always answers 0. Off reduced motion `current`
 * passes through unchanged — the flight's own animation is what actually
 * drives it from there.
 */
export function settleForMotion(reduceMotion: boolean, current: number): number {
  return reduceMotion ? 0 : current;
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
 * (lib/gameEngine.ts) sets it the moment a hand empties, its own comment
 * calling that "the hand is decided", which `docs/RULES.md` names the
 * manche. A partita closing is a *further* fact about that same landing,
 * carried by the match verdict (`lib/matchState.ts` `MatchVerdict.over`,
 * `context/GameContext.tsx` `applyHandToMatch`, the online
 * `game:over`/`matchOver` payload): the hand that empties a seat's hand is
 * also the hand that happens to close the match, never a second, later
 * event. `GameState.roundWinner` is not read here — `docs/RULES.md` §9
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

/** The tier's peak trauma, or 0 outright when the player asked for less motion. */
export function traumaFor(tier: ImpactTier, reduceMotion: boolean): number {
  return reduceMotion ? 0 : TRAUMA_BY_TIER[tier];
}

/**
 * How far the beaten combination (`pileState.prev`) is knocked as the new
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

/** Which peak a tier's shake reads — every tier but the bomb shares the default above. */
export function shakeAmplitudeFor(tier: ImpactTier): { x: number; y: number } {
  if (tier === "bomb") return { x: BOMB_SHAKE_AMPLITUDE_X, y: BOMB_SHAKE_AMPLITUDE_Y };
  return { x: SHAKE_AMPLITUDE_X, y: SHAKE_AMPLITUDE_Y };
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
  amplitude: { x: number; y: number } = { x: SHAKE_AMPLITUDE_X, y: SHAKE_AMPLITUDE_Y }
): { x: number; y: number } {
  "worklet";
  const magnitude = shakeMagnitude(trauma, elapsedMs, decayMs);
  const wiggle =
    decayMs <= 0 ? 0 : Math.cos((elapsedMs / decayMs) * Math.PI * 2 * SHAKE_CYCLES);
  return {
    x: magnitude * wiggle * amplitude.x * scale,
    y: magnitude * wiggle * amplitude.y * scale,
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
  if (tier === "bomb") return "brief";
  if (tier === "partitaWon") return "settle";
  return "none";
}

/**
 * Whether a tier's landing throws sparks off the point of impact. Never
 * disagrees with `flareKindFor`: every tier that flares also sparks, in the
 * table #101 settled, so this reads that one derivation rather than carrying
 * a second membership test that could drift from it.
 */
export function sparksFor(tier: ImpactTier): boolean {
  return flareKindFor(tier) !== "none";
}

/** Whether a tier's landing lifts the lamp rather than flaring it. */
export function lampLiftFor(tier: ImpactTier): boolean {
  return tier === "mancheWon";
}

// ─── Bomb burst ────────────────────────────────────────────────────────────────

/** Spark dots ringing the bomb's impact point. */
export const SPARK_COUNT = 16;

export interface SparkOffset {
  /** Where the spark ends up, relative to the impact point. */
  dx: number;
  dy: number;
  /** ms before this spark's own animation starts. */
  delay: number;
}

/**
 * The burst's own head start, and the gap between its five phases. Off the
 * Motion scale on purpose: every other timing in the app is chosen to line up
 * with its neighbours, and these two are chosen against each other so that
 * sixteen sparks read as debris rather than as one ring leaving at once.
 */
const SPARK_LEAD_MS = 60;
const SPARK_PHASE_MS = 22;

/**
 * Where the i-th of `SPARK_COUNT` sparks flies to, and when it starts —
 * derived from its index so every client draws the same burst. `dy` is
 * squashed to .62 of the unsquashed distance: sparks land in a shallow
 * ellipse, not a circle, the way debris does on a table seen from above
 * rather than face-on. The distance steps every 4th spark and the delay
 * every 5th, so the two cycles fall out of phase across the ring instead of
 * both resetting at the same spark.
 */
export function sparkOffset(i: number, scale: number): SparkOffset {
  const angle = (i / SPARK_COUNT) * Math.PI * 2;
  const dist = (110 + (i % 4) * 34) * scale;
  return {
    dx: Math.cos(angle) * dist,
    dy: Math.sin(angle) * dist * 0.62,
    delay: SPARK_LEAD_MS + (i % 5) * SPARK_PHASE_MS,
  };
}

// ─── Flight origin ─────────────────────────────────────────────────────────────
//
// Where a throw starts. docs/adr/0002-a-play-leaves-the-seat-it-was-thrown-from.md §1.
export interface FlightOriginInput {
  dir: FlyDirection;
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
  /**
   * The top seat's displayed hand count (`displayedHandCount`) — needed
   * because the pile sits in the space *below* the top seat, whichever seat
   * is actually throwing. Ignored when `dir` is not "top".
   */
  topDisplayedCount: number;
  /**
   * …and the throwing side seat's, for the same reason: a side seat's slot is
   * as tall as its fan, and the slot's own centre is where its ring sits.
   * Ignored when `dir` is not "left" or "right".
   */
  sideDisplayedCount: number;
}

/**
 * The delta a throw starts at: from the throwing seat's own point to the
 * pile's. `FlyingCards` (components/table/pile.tsx) animates this toward
 * zero, so the throw lands exactly where `PlayedPile` then redraws the same
 * cards.
 */
/**
 * Where the pile's own centre lands, and the band the seats share it with.
 * Every delta on this table is measured from that point, so it is derived once
 * and read by both the throw's origin and the exchange's own geometry.
 */
function pileGeometry(input: Omit<FlightOriginInput, "dir" | "sideDisplayedCount">): {
  centerX: number;
  centerY: number;
  tableFloor: number;
  midH: number;
} {
  const ringSize = SEAT_DISC * input.scale;
  // The column the top seat's label, ring and fan stack in — see
  // components/table/seats.tsx `topOppSlot`. The pile sits in whatever
  // vertical space that column leaves, whichever seat is actually throwing.
  const topSectionH =
    seatLabelH(input.scale) +
    ringSize +
    (input.topDisplayedCount > 0
      ? seatGap(input.scale) + topFanHeight(input.scale, input.topDisplayedCount)
      : 0);
  const tableFloor = input.windowHeight - input.surplus;
  const midH = tableFloor - input.tableTop - topSectionH - input.handZoneH;
  return {
    centerX: input.tableLeft + (input.windowWidth - input.tableLeft - input.tableRight) / 2,
    centerY: input.tableTop + topSectionH + midH / 2,
    tableFloor,
    midH,
  };
}

export function flightOrigin(input: FlightOriginInput): { dx: number; dy: number } {
  const { dir, scale } = input;

  const ringSize = SEAT_DISC * scale;
  const { centerX: pileCenterX, centerY: pileCenterY, tableFloor, midH } = pileGeometry(input);

  if (dir === "bottom") {
    // The hand zone runs flush to the table's own bottom edge (GameTable.tsx
    // `handSection`, a flex sibling of the pile's own midSection), so its
    // vertical centre sits `handZoneH / 2` above that edge.
    const handCenterY = tableFloor - input.handZoneH / 2;
    return { dx: 0, dy: handCenterY - pileCenterY };
  }

  if (dir === "top") {
    const ringCenterY = input.tableTop + seatLabelH(scale) + ringSize / 2;
    return { dx: 0, dy: ringCenterY - pileCenterY };
  }

  // A side seat's ring sits flush against the rail (or the opposite edge), and
  // its column is anchored to the top of the mid band (components/table/
  // chrome.tsx `sideSection`, `alignSelf`), so the ring rides the slot's own
  // centre while the pile rides the band's.
  const ringCenterX =
    dir === "left"
      ? input.tableLeft + Spacing.sm + ringSize / 2
      : input.windowWidth - input.tableRight - Spacing.sm - ringSize / 2;
  const slotH = sideSlotHeight(scale, input.sideDisplayedCount);
  return { dx: ringCenterX - pileCenterX, dy: (slotH - midH) / 2 };
}

export interface ExchangeFlightInput
  extends Omit<FlightOriginInput, "dir" | "sideDisplayedCount"> {
  /** The seat the card leaves. */
  from: FlyDirection;
  /** The seat it arrives at. */
  to: FlyDirection;
  /**
   * Both side seats' displayed counts. A throw asks about one seat; an
   * exchange has two ends, and they can both be side seats holding different
   * numbers of cards — which is two different slot heights.
   */
  sideDisplayedCounts: { left: number; right: number };
  /**
   * The flying card's own box. Both dimensions, because the gap the two cards
   * keep runs across their trip in whatever direction that happens to be: a
   * pair passing side by side needs a card's width between them, and a pair
   * passing one above the other needs its height.
   */
  cardW: number;
  cardH: number;
}

export interface ExchangeFlight {
  from: { dx: number; dy: number };
  /** Where the card waits out the beat that makes the pair read as a trade. */
  meet: { dx: number; dy: number };
  to: { dx: number; dy: number };
  /**
   * The shift that took this trip out of the shared line and into its own
   * lane, across the direction of travel and as long as the card's own reach
   * that way. Anything that has to sit clear of this card — a label at the
   * seat — goes further along it; the three points cannot supply that
   * direction between them, since all three carry the same shift.
   */
  lane: { dx: number; dy: number };
  /**
   * Where this trip's "got this card" label sits — beside the seat it names,
   * clear of the card it describes, and inside the table. Carried on the trip
   * rather than derived at the label itself, which knows the geometry of
   * nothing.
   */
  tag: { dx: number; dy: number };
}

/**
 * One card's trip across an exchange, in the same pile-relative deltas
 * `flightOrigin` speaks — so a card starts and ends exactly where that seat's
 * own cards do, rather than at a point measured a second time.
 *
 * The two cards of an exchange travel at once, in opposite directions along
 * the same line, and would collide on it. Each takes a lane instead: the whole
 * trip is shifted one clearance along the perpendicular of its own direction,
 * and because the two directions are opposite the two lanes are that whole gap
 * apart from departure to arrival. A pair that only parted at the middle would
 * still cross on the way there, which is the thing to keep in mind before
 * moving any of this: the separation has to hold at every moment, not at one.
 *
 * The clearance is how far a card of this size reaches along that
 * perpendicular. Half a card width would be the answer only for a pair
 * separated horizontally; separated vertically it leaves them a third of a card
 * deep in each other, and on a diagonal neither dimension alone is enough.
 *
 * The meeting point is the midpoint of the lane, where the two cards sit level
 * with each other for a beat. That beat is what makes the pair read as a trade
 * rather than as two deliveries that happen to coincide.
 */
export function exchangeFlight(input: ExchangeFlightInput): ExchangeFlight {
  const at = (dir: FlyDirection) =>
    flightOrigin({
      ...input,
      dir,
      sideDisplayedCount:
        dir === "left" || dir === "right" ? input.sideDisplayedCounts[dir] : 0,
    });
  const from = at(input.from);
  const to = at(input.to);

  const vx = to.dx - from.dx;
  const vy = to.dy - from.dy;
  const len = Math.hypot(vx, vy);
  // Two seats resolving to one point cannot happen on a laid-out table, but a
  // zero-length trip would divide by zero rather than simply going nowhere.
  const px = len === 0 ? 0 : -vy / len;
  const py = len === 0 ? 0 : vx / len;
  // How far a card of this size reaches along the perpendicular — its own
  // support in that direction. Two lanes that far apart cannot overlap wherever
  // either card happens to be along them, which is a stronger claim than two
  // *points* that far apart and is the one this needs.
  const clearance = (Math.abs(px) * input.cardW + Math.abs(py) * input.cardH) / 2;
  const offX = len === 0 ? 0 : px * clearance;
  const offY = len === 0 ? 0 : py * clearance;
  const intoLane = (p: { dx: number; dy: number }) => ({ dx: p.dx + offX, dy: p.dy + offY });

  const trip = {
    from: intoLane(from),
    meet: intoLane({ dx: (from.dx + to.dx) / 2, dy: (from.dy + to.dy) / 2 }),
    to: intoLane(to),
    lane: { dx: offX, dy: offY },
  };
  const pile = pileGeometry(input);
  return {
    ...trip,
    // The band the pile sits in, less the columns the side seats sit in: the
    // one region of the table that holds no cards, whoever is playing and
    // however many they hold. The label is placed by its centre and drawn no
    // wider than `TAG_MAX_W`, so half of that keeps its box inside as well.
    tag: exchangeTagOffset(trip, {
      minDx: input.tableLeft + SIDE_SECTION_W + TAG_MAX_W / 2 - pile.centerX,
      maxDx: input.windowWidth - input.tableRight - SIDE_SECTION_W - TAG_MAX_W / 2 - pile.centerX,
      minDy: TAG_CLEARANCE - pile.midH / 2,
      maxDy: pile.midH / 2 - TAG_CLEARANCE,
    }),
  };
}

/**
 * How wide the label is allowed to get. Both a bound the clamp above can use —
 * a centre is only inside the table if half a label is too — and the width
 * `ExchangeSeatTag` draws it at, so the two cannot disagree about a box only
 * one of them can see.
 */
export const TAG_MAX_W = 160;

/**
 * The label's own reach: how far it stands off anything it must not touch —
 * its lane, beyond the card's own reach, and every edge it is clamped inside.
 * A single line of type in a padded box is smaller than this in both
 * directions, so the clearance holds for the box and not merely its centre.
 */
const TAG_CLEARANCE = 30;
/**
 * How far along its own trip the label sits — on its seat's side of the table,
 * and stopping well short of the seat itself.
 *
 * A label at the landing point lands *in* that seat's cards: for the viewer's
 * own seat the arrival is the hand zone's centre (`flightOrigin`, "bottom"), so
 * the words came out over the player's own hand and read as dark text on a card
 * face (#817). Short of it, the label is over felt in both directions, and the
 * perpendicular lane keeps it off the card it names and off the other tag.
 */
const TAG_ALONG_TRIP = 0.72;

/**
 * Where one seat's "got this card" label sits, in the same pile-relative deltas
 * the flight itself speaks.
 *
 * The lane runs across the direction of travel, so on a diagonal it carries the
 * label sideways as far as it carries it along — and the seat it names is
 * already at the table's edge. The bounds are what it may not leave; the table
 * clips what does, which costs the label its whole message and no error.
 */
function exchangeTagOffset(
  trip: Omit<ExchangeFlight, "tag">,
  bounds: { minDx: number; maxDx: number; minDy: number; maxDy: number }
): { dx: number; dy: number } {
  const laneLen = Math.hypot(trip.lane.dx, trip.lane.dy) || 1;
  const reach = laneLen + TAG_CLEARANCE;
  // A window too small to hold the clearance on both sides has no room to
  // clamp into; the middle of what there is beats an inverted box.
  const clamp = (v: number, min: number, max: number) =>
    min > max ? (min + max) / 2 : Math.min(Math.max(v, min), max);
  return {
    dx: clamp(
      trip.from.dx + (trip.to.dx - trip.from.dx) * TAG_ALONG_TRIP + (trip.lane.dx / laneLen) * reach,
      bounds.minDx,
      bounds.maxDx
    ),
    dy: clamp(
      trip.from.dy + (trip.to.dy - trip.from.dy) * TAG_ALONG_TRIP + (trip.lane.dy / laneLen) * reach,
      bounds.minDy,
      bounds.maxDy
    ),
  };
}

/**
 * Identity of a played combination. Two different players playing the same
 * card ids is impossible, but the same player replaying an identical-looking
 * combination in a later round is not — hence the seat in the key.
 */
export function comboKey(combo: Combination, playedBy: number): string {
  return combo.cards.map((c) => c.id).join(",") + "_" + playedBy;
}

/** The old current becomes the faded layer; the new combination takes the top. */
export function advancePile(state: PileState, combo: Combination, playedBy: number): PileState {
  return { prev: state.current, current: combo, playedBy };
}

/**
 * The pass that just closed a round, seen from one state. `processPass`
 * (lib/gameEngine.ts) clears `lastPlayedCombination` and credits `roundWinner`
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

// ─── Exchange phase ───────────────────────────────────────────────────────────

export interface ExchangeView {
  active: boolean;
  /** The viewer owes the loser a card and must pick one. */
  viewerIsWinner: boolean;
  /** The viewer is waiting to receive a card. */
  viewerIsLoser: boolean;
  winner: Player | null;
  loser: Player | null;
  /**
   * The card taken off the loser. The engine puts it in the winner's hand as
   * the phase opens while the prompt draws it on the felt, so the winner's fan
   * has to know which card it is not drawing (#650).
   */
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

export interface HandArrival {
  /** Kept out of the fan, because something else is already drawing it. */
  withheldId?: string;
  /** The slot the row parts at — set only while the card is actually flying. */
  arrivingIndex?: number;
  /** What the parted slot is waiting for, so the row can travel it in. */
  descendingId?: string;
}

/**
 * One window in which the receiving hand does not draw its traded card,
 * running from the exchange opening to the flight landing (#650).
 *
 * The engine gives the winner the loser's card as the phase opens while
 * `ExchangePrompt` draws that same card on the felt, and the ceremony then
 * commits and raises the flight in one tick — so without this the card is in
 * two places for the whole prompt and again for the whole flight.
 *
 * The row only *parts* for the second half: a gap held open beside the giveback
 * picker is a hole to choose next to rather than the first beat of an arrival.
 */
export function readHandArrival(input: {
  /** The hand as arranged, which is where the card takes its place. */
  hand: Card[];
  exchange: ExchangeView;
  /** The live ceremony, or null when none is running. */
  announce: ExchangeAnnounceData | null;
  /** Null for a spectator: a synthetic hand has nothing to hold back. */
  viewerSeat: number | null;
  landed: boolean;
  reduceMotion: boolean;
}): HandArrival {
  // Nothing flies under reduced motion, so there is nothing to wait for and the
  // row would hold a slot open for a card already in it.
  const incoming = input.reduceMotion
    ? undefined
    : arrivingCard(input.announce, input.viewerSeat);
  const flying = input.landed ? undefined : incoming;
  const onTheFelt = input.exchange.viewerIsWinner ? input.exchange.cardFromLoser : null;
  const slot = flying === undefined ? -1 : input.hand.findIndex((c) => c.id === flying.id);
  return {
    withheldId: flying?.id ?? onTheFelt?.id,
    // A card the ceremony names but the hand does not hold parts nothing: a gap
    // with nothing ever descending into it would stay open all game.
    arrivingIndex: slot < 0 ? undefined : slot,
    // `incoming` rather than `flying`, so the id still names the card on the
    // render it lands — which is the render the row mounts it on.
    descendingId: incoming?.id,
  };
}

// ─── Card jitter ──────────────────────────────────────────────────────────────

/**
 * Cards thrown onto a table do not land square, so a combination keeps a small
 * jitter on top of the arc it lands on. The bound stays small: past a few
 * degrees the overlap stops reading as one combination.
 */
export const COMBO_MAX_TILT = 4.5;

/**
 * A card's own jitter (deg), derived from its id so the same combination looks
 * the same on every client and in every frame of its throw.
 */
export function cardTilt(id: string, maxTilt: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(hash) % 200) / 100 - 1) * maxTilt;
}

// ─── Thrown plays ─────────────────────────────────────────────────────────────

export interface ThrownPlay {
  dir: FlyDirection;
  cards: Card[];
  /** Where the throw starts, relative to where it lands. */
  origin: { dx: number; dy: number };
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

/**
 * Everything a throw decides, from the state it was thrown out of.
 *
 * The counts are the seats' *displayed* ones, held at their pre-play values
 * for the length of the flight: the pile sits in whatever room the top seat's
 * column leaves whichever seat is throwing, so a fan that shrinks the moment
 * the cards leave would move the pile out from under them mid-flight.
 */
export function readThrownPlay(input: ThrownPlayInput): ThrownPlay {
  const { combo, playedBy, players, opponents } = input;
  const dir = seatDirection(playedBy, input.viewerSeat, players.length);

  const topPlayer = opponents.top?.player;
  const topDisplayedCount = topPlayer
    ? displayedHandCount(handCountOf(topPlayer), dir === "top" ? combo.cards.length : 0)
    : 0;
  const sidePlayer = dir === "left" || dir === "right" ? opponents[dir]?.player : undefined;
  const sideDisplayedCount = sidePlayer
    ? displayedHandCount(handCountOf(sidePlayer), combo.cards.length)
    : 0;

  const thrower = players[playedBy];
  return {
    dir,
    cards: combo.cards,
    heavy: combo.type === "bomb" || combo.type === "royal_straight",
    emptiedHand: !!thrower && handCountOf(thrower) === 0,
    origin: flightOrigin({
      dir,
      scale: input.scale,
      windowWidth: input.windowWidth,
      windowHeight: input.windowHeight,
      tableLeft: input.tableLeft,
      tableRight: input.tableRight,
      tableTop: input.tableTop,
      surplus: input.surplus,
      handZoneH: HAND_ZONE_H(input.handCardH, input.bottomPad),
      topDisplayedCount,
      sideDisplayedCount,
    }),
  };
}
