// Seat and hand layout geometry for the shared game table.
//
// This file is deliberately JSX-free, for the same reason components/handLayout.ts
// is: Node's built-in TypeScript loader (`node --test tests/**/*.test.ts`) only
// type-strips plain .ts source — it cannot parse a .tsx file, and it cannot
// resolve the `@/` bundler alias at runtime. A runtime import must therefore be
// relative and carry its .ts extension; `@/` is safe only in a type-only import,
// which is erased before resolution.

import type { Player } from "@/lib/gameEngine";
import { CARD_BACK_H, CARD_BACK_W, BACK_SCALE } from "./cardFaceModel.ts";
import { arcBounds, solveArc, SEAT_ARC } from "./tableArc.ts";
import { Spacing } from "../lib/tokens.ts";

// ─── Layout constants ─────────────────────────────────────────────────────────
//
// Both game screens are laid out around these, and changing one without the
// other silently breaks a screen — `tests/layoutConstantsPinned.test.ts` is what
// pins their values, except `SEAT_DISC` and `FAN_DRAWN_CARDS`, which
// `tests/flightPhysics.test.ts` pins against the throw origin they also decide.
// The card dimensions belong to cardFaceModel.ts, which draws the
// card; the rest are defined here rather than in the components/table/ files
// that read them, so one module owns the number and the frame maths in
// tableFrame.ts can use it directly.

// The column a side seat's ring and label stand in. The prototype's own side
// seat measures 92 at scale 1; the fan leans out of the column by design.
export const SIDE_SECTION_W = 96;

// PASSA and GIOCA are square: they read as two keys either side of the hand
// rather than as two columns of it, which is what a card-height button was.
const ACTION_BTN = 56;
/** A comfortable thumb, in physical points — never `48 * scale`. */
export const ACTION_BTN_FLOOR = 48;
/** Hand to button, and button to the edge of the play area. */
export const HAND_ZONE_GAP = 26;

export function actionBtnSize(scale: number): number {
  return Math.max(ACTION_BTN_FLOOR, ACTION_BTN * scale);
}

/** A HUD chip's own height. The chrome over the felt is two of these. */
export function CHIP_H(scale: number): number {
  return 23 * scale;
}
/**
 * How far a selected card rises out of the hand row, and therefore the
 * headroom the row keeps above its own cards. `hand.tsx` lifts by exactly
 * this and clears exactly this in its scrollable fallback, so the two cannot
 * drift apart.
 *
 * It clears a card, so it takes the *card's* height rather than the table's
 * scale: a spectated hand draws backs, which are their own aspect, and the
 * hand draws at `scale * HAND_SCALE` rather than at the table's own. Read from
 * the table's scale instead, the reserved band and the lift it reserves for
 * differed by a fifth on a tablet.
 */
const SELECT_LIFT_SHARE = 16 / 90;
export function handRowHeadroom(cardH: number): number {
  return cardH * SELECT_LIFT_SHARE;
}

// ─── The hand's own band ──────────────────────────────────────────────────────
//
// The hand meets the device's bottom edge and is cropped by it, which buys the
// table height while making the cards bigger rather than smaller. The crop
// costs nothing: a card's index is at its top-left, and only the redundant
// upside-down copy at the foot is lost.

/**
 * How much of a hand card falls past the bottom edge. The prototype pushes the
 * hand `26 * s` below the safe line against a `90 * s` card, and that is what
 * takes the upside-down index at the card's foot out of the picture — a
 * shallower crop leaves it legible and the hand reads as floating rather than
 * as held.
 */
export const HAND_CROP = 26 / 90;

/**
 * The part of a hand card the player actually sees — which is also how tall
 * PASSA and GIOCA are, so the row still reads as one band. They are never
 * cropped themselves: they sit on the safe line, clear of the home indicator.
 */
export function handVisibleH(cardH: number): number {
  return cardH * (1 - HAND_CROP);
}

/**
 * The hand zone's own height. It runs to the device bottom rather than
 * stopping at the felt, so it carries the bottom safe pad itself: the buttons
 * sit above that line and the cards run past it.
 */
export function HAND_ZONE_H(cardH: number, bottomPad: number): number {
  return handVisibleH(cardH) + bottomPad + handRowHeadroom(cardH);
}

/**
 * How far above the hand row's own baseline (`bottom: 0`, `hand.tsx`) the
 * exchange's flying card retires — `flightOrigin`'s "bottom" case lands it at
 * the hand zone's own vertical centre, `handZoneH / 2` above the table floor.
 *
 * The row's baseline is not that floor. The zone reserves `bottomPad` under
 * itself, and the row is then centred in the headroom above it, which lifts it
 * by `rowRise` again — so both terms come off, and neither may be assumed to
 * be zero. `cardH` is the *resting* hand card (`CARD_H(scale * HAND_SCALE)`),
 * because that is the one the flight's own geometry was solved against; a hand
 * drawn larger because the turn is the viewer's own does not move where the
 * flier stopped.
 *
 * The arriving card's own descent (`hand.tsx`'s `dealRise`) starts from this
 * point instead of the unrelated height a freshly dealt card drops from
 * (`DEAL_RISE_PX`), so the flier's landing and the card's mount are the same
 * point rather than two guesses that happen to be close.
 */
export function exchangeArrivalRise(
  cardH: number,
  bottomPad: number,
  rowRise: number
): number {
  return HAND_ZONE_H(cardH, bottomPad) / 2 - bottomPad - rowRise;
}

// ─── Width budgets ────────────────────────────────────────────────────────────
//
// Every arc takes a share of the table, never all the room it can reach. A
// hand of three does not stretch across the felt to fill it, and a thirteen-
// card run compresses and stops rather than pushing the seats off the edge.

/**
 * The hand's share. The span the hand fills and then compresses inside, so it
 * is the same width whether the player holds five cards or eighteen. Only
 * the finger floor (`MIN_READABLE_STEP`, components/handLayout.ts) can push a
 * hand past it, and past `handAvailW` the row scrolls.
 */
export const HAND_WIDTH_SHARE = 0.56;
/**
 * The field's share of the same width, bounded by what the seats leave it.
 * The prototype's own `layout()` is the authority for it and computes
 * `tb.width * .55`; #193's "45%" is a misquote of that line, not a target.
 */
export const FIELD_WIDTH_SHARE = 0.55;

// ─── Seating ──────────────────────────────────────────────────────────────────

export type FlyDirection = "top" | "bottom" | "left" | "right";
export type OpponentSide = "top" | "left" | "right";

/**
 * Backs drawn in an opponent's fan. Not legibility: the step barely moves with
 * the count, because `fitSpread` takes the smaller of its width and rise
 * bounds and the width one keeps growing until about nineteen backs. What each
 * extra back past this many is, is another third-of-a-card sliver of the same
 * block carrying its own SVG subtree, re-rendered on every `game:state` — and
 * the seat's count badge is what carries the number.
 *
 * Here rather than beside the fan that draws it: `tests/e2e/seatFans.spec.ts`
 * is what proves the cap, and it cannot import the fan, which pulls in
 * react-native. A second copy in the spec would hold the same number and never
 * disagree with it.
 */
export const FAN_DRAWN_CARDS: Record<OpponentSide, number> = { top: 7, left: 5, right: 5 };

/**
 * Which side of the table an opponent sits on, given how many seats clockwise
 * they are from the viewer and how many opponents there are in total.
 */
export function getOpponentPosition(steps: number, total: number): OpponentSide {
  if (total === 1) return "top";
  if (total === 2) return steps === 1 ? "right" : "top";
  if (steps === 1) return "right";
  if (steps === 2) return "top";
  return "left";
}

/**
 * Where a seat renders from the viewer's point of view. The viewer is always
 * at the bottom; everyone else is rotated around them. The single source of
 * truth for both the opponent slots and the flying-card direction.
 */
export function seatDirection(
  seat: number,
  viewerSeat: number,
  playerCount: number
): FlyDirection {
  if (playerCount <= 0) return "bottom";
  if (seat === viewerSeat) return "bottom";
  const steps = (((seat - viewerSeat) % playerCount) + playerCount) % playerCount;
  return getOpponentPosition(steps, playerCount - 1);
}

// ─── The lamp ─────────────────────────────────────────────────────────────────

export interface LightPosition {
  /** Fractions of the felt box, not pixels. */
  x: number;
  y: number;
}

/**
 * The lamp swung off every seat and onto the middle of the felt, for a moment
 * that belongs to the table rather than to one player — the announcement of who
 * opens the manche. The same rig, pointed somewhere else; nothing new is drawn.
 */
export const LAMP_CENTRE: LightPosition = { x: 0.5, y: 0.5 };

/**
 * Where the lamp hangs when a given seat is on move, so half the table falls
 * into shadow when it is not your turn. Just off the edge on that seat's own
 * side: a lamp centred on a seat lights the seat rather than the table it is
 * leaning over.
 */
export function lightPosition(dir: FlyDirection): LightPosition {
  switch (dir) {
    case "bottom": return { x: 0.5, y: 0.98 };
    case "top":    return { x: 0.5, y: 0.02 };
    case "left":   return { x: 0.02, y: 0.48 };
    case "right":  return { x: 0.98, y: 0.48 };
  }
}

export interface SeatedPlayer<T> {
  player: T;
  seat: number;
}

export interface OpponentArrangement<T> {
  top: SeatedPlayer<T> | null;
  left: SeatedPlayer<T> | null;
  right: SeatedPlayer<T> | null;
}

/**
 * Bucket every non-viewer seat into the top / left / right slot. First seat to
 * claim a slot keeps it, matching the `.find(...)` lookups this replaces.
 */
export function arrangeOpponents<T>(
  players: readonly T[],
  viewerSeat: number
): OpponentArrangement<T> {
  const out: OpponentArrangement<T> = { top: null, left: null, right: null };
  for (let seat = 0; seat < players.length; seat++) {
    if (seat === viewerSeat) continue;
    const dir = seatDirection(seat, viewerSeat, players.length);
    if (dir === "bottom") continue;
    if (out[dir] === null) out[dir] = { player: players[seat], seat };
  }
  return out;
}

/**
 * Cards left in a seat's hand. Online the server blanks other players' hands
 * and ships a `handCount` alongside; offline the hand itself is authoritative.
 */
export function handCountOf(player: Player | (Player & { handCount?: number })): number {
  const count = (player as { handCount?: number }).handCount;
  return typeof count === "number" ? count : player.hand.length;
}

/**
 * Whether a seat is a human's that left, played on by the engine — never
 * true offline, which vacates nobody. The flag travels on the wire
 * (`sanitizeStateForPlayer`); `name` stays the person's own.
 */
export function vacatedOf(player: Player | (Player & { vacated?: boolean })): boolean {
  return (player as { vacated?: boolean }).vacated === true;
}

/**
 * The number a seat's fan and count badge both show — derived, never stored.
 * docs/adr/0002-a-play-leaves-the-seat-it-was-thrown-from.md §2.
 */
export function displayedHandCount(handCount: number, cardsInFlight: number): number {
  return handCount + cardsInFlight;
}

/** How many of a `CardFan`'s backs stay put versus lift and fade, at `cap`. */
export interface FanCounts {
  /** Backs re-solving into the smaller arc — `i < remaining` in the map. */
  remaining: number;
  /** Backs lifting and fading in place — drawn, never re-solved. */
  departing: number;
}

/**
 * `count` is the pre-play total (`displayedHandCount`); `departing` of it are
 * mid-flight. A fan never draws more than `cap` backs, so `remaining` re-caps
 * the *post-play* total rather than subtracting `departing` from an already
 * capped one — the difference only shows once a hand sits at `cap`, where
 * subtracting first left the fan visibly short for the length of the flight
 * and then popping back to `cap` the instant it landed.
 */
export function fanCounts(count: number, departing: number, cap: number): FanCounts {
  const cappedTotal = Math.min(count, cap);
  const remaining = Math.min(count - departing, cap);
  return { remaining, departing: cappedTotal - remaining };
}

/** The seat disc's diameter at scale 1 (components/table/seats.tsx `SeatRing`). */
export const SEAT_DISC = 33;
/**
 * Ring to fan, the same on every seat (components/table/seats.tsx `SeatWho`).
 * A share of the table, like the ring and the fan it separates — a flat gap is
 * a tenth of the seat column on a phone and a twentieth of it on a tablet.
 */
export function seatGap(scale: number): number {
  return Spacing.slim * scale;
}
const SEAT_NAME_LINE = 17;

/**
 * The band a seat's floating label needs above its ring: the name's own line,
 * the gap under it and the badge row, all four of `whoLabel`'s own lengths
 * (components/table/seats.tsx). A side seat's label runs inward rather than
 * upward and does not need this, but the top seat's does — drawn off the top
 * of the screen otherwise.
 */
export const SEAT_LABEL_GAP = Spacing.xxs;
export const SEAT_LABEL_PAD = Spacing.xs;
export function seatLabelH(scale: number): number {
  return (SEAT_NAME_LINE + SEAT_LABEL_GAP + SEAT_LABEL_PAD) * scale + CHIP_H(scale);
}

/**
 * A seat's own fan of `count` backs at `backScale` — the one solve `CardFan`
 * (components/table/seats.tsx) performs for its wrapper box, and that
 * `sideSlotHeight` and `topFanHeight` below perform for theirs, so none of the
 * three can disagree with what the fan actually draws.
 */
export function seatFanArc(count: number, backScale: number) {
  const backW = CARD_BACK_W(backScale);
  const backH = CARD_BACK_H(backScale);
  const { cards, box } = solveArc(count, {
    budget: SEAT_ARC,
    cardW: backW,
    cardH: backH,
    scale: backScale,
    room: Infinity,
    flip: true,
  });
  return { cards, box, bounds: arcBounds(cards, box, backW, backH) };
}

/**
 * A side seat's own slot height: its ring, or the fan beside it when that is
 * taller. The fan is turned a quarter there, so what it occupies vertically is
 * the arc's width — components/table/seats.tsx `CardFan`, `wrapH`.
 */
export function sideSlotHeight(scale: number, displayedCount: number): number {
  const ring = SEAT_DISC * scale;
  const drawn = Math.min(displayedCount, FAN_DRAWN_CARDS.left);
  if (drawn <= 0) return ring;
  return Math.max(ring, seatFanArc(drawn, scale * BACK_SCALE).bounds.w);
}

/**
 * The top seat's own fan height for `displayedCount` backs.
 *
 * Exported for `pileGeometry` (components/flightPhysics.ts), its only caller,
 * which serves both `flightOrigin` and `exchangeFlight`.
 */
export function topFanHeight(scale: number, displayedCount: number): number {
  const drawn = Math.min(displayedCount, FAN_DRAWN_CARDS.top);
  if (drawn <= 0) return 0;
  return seatFanArc(drawn, scale * BACK_SCALE).bounds.h;
}

/**
 * A watcher is handed a seat so the table has a bottom to draw from, but that
 * seat is a real player they are not, so every question of identity answers no
 * for them. Questions of *geometry* — which side a seat draws on — still use
 * `viewerSeat` raw, because a watcher's table is laid out from a seat all the
 * same. `tests/seatLayout.test.ts` pins that identity never asks directly.
 */
export function viewerOwnsSeat(
  seat: number | null,
  viewerSeat: number,
  spectating: boolean
): boolean {
  return !spectating && seat === viewerSeat;
}
