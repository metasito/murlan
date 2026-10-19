// Pure layout math for StraightHand's card row (components/table/hand.tsx).
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import type { HandCardSize } from "./cardFaceModel.ts";
import { stripAt } from "./handOrder.ts";
import { HAND_CROP, HAND_ZONE_H, exchangeArrivalRise, handRowHeadroom } from "./seatLayout.ts";
import { HAND_ARC, solveArc } from "./tableArc.ts";

// WCAG 2.2 SC 2.5.8 Level AA: 24x24 CSS px, or the undersized-target
// exception, which needs 24px circles on adjacent targets not to intersect.
// Adjacent card centres are exactly `step` apart, so below 24 fails both.
// 44pt needs ~630px of hand width at 14 cards — tests/e2e/tapTargets.spec.ts
// names the hand as its one deliberate exception. #193 asks for 34, which is
// the prototype's own step: 24 is the correction to it, not a shortfall to
// raise back.

/** Smallest overlap step (px) that keeps a card its own tappable target. */
export const MIN_READABLE_STEP = 24;

/**
 * The widest a hand ever steps, as a share of a card: past it the cards stop
 * overlapping enough to read as one held hand. It is the arc's own ratio,
 * taken from the arc rather than restated — the step and the curve it is laid
 * on have to agree about how wide the hand is.
 */
export const MAX_STEP_RATIO = HAND_ARC.stepRatio;

export interface HandLayout {
  /** Horizontal distance (px) between each card's left edge. */
  step: number;
  /** Total width (px) spanned by the row: left edge of card 0 to the right edge of the last card. */
  totalW: number;
  /**
   * True when `totalW` exceeds `availW`. The caller must let the row overflow
   * inside a scrollable container rather than clip it or shrink `step`.
   */
  scrollable: boolean;
}

/**
 * The hand fills `room` and then compresses inside it: more cards overlap
 * further, they do not reach wider. That is the whole shape of the thing — a
 * hand of five is not a hand of eighteen spread thin, and a full hand does
 * not push the seats off the edge of the felt.
 *
 * Two bounds, both on the step rather than on the span. `MAX_STEP_RATIO` stops
 * a short hand from fanning out into a row of separate cards, and
 * `MIN_READABLE_STEP` is the finger: below it two adjacent cards cannot be
 * told apart by touch, whatever the arc would prefer. `cardW` is the caller's
 * own already-scaled hand card width; `availW` is the hard edge past which the
 * caller must scroll rather than clip.
 */
export function computeHandLayout(
  n: number,
  room: number,
  cardW: number,
  availW: number = room
): HandLayout {
  if (n <= 1) {
    return { step: 0, totalW: cardW, scrollable: false };
  }
  const ideal = (room - cardW) / (n - 1);
  const step = Math.min(Math.max(ideal, MIN_READABLE_STEP), cardW * MAX_STEP_RATIO);
  const totalW = step * (n - 1) + cardW;
  return { step, totalW, scrollable: totalW > availW };
}

/**
 * The strip of card `i` that a tap belongs to, as a width from its own left
 * edge. Every card but the last is covered from `step` on by the one drawn over
 * it, so that strip is all of it a finger can reach.
 *
 * This is the hand's whole hit-testing rule, and it is here rather than in the
 * component because the platforms do not agree on what happens when a card's
 * ink overflows its strip: the web hit-tests the overflow and lets paint order
 * settle it, and UIKit does not hit-test outside a view's bounds at all. So the
 * card is drawn inside a box that takes no hits, and this decides the rest.
 */
export function hitWidth(i: number, n: number, step: number, cardW: number): number {
  return i === n - 1 ? cardW : step;
}

/**
 * Which slot a drawn card takes when the row holds one open for a card still
 * arriving. `undefined` means nothing is arriving.
 */
export function slotForCard(i: number, arrivingIndex: number | undefined): number {
  return arrivingIndex === undefined || i < arrivingIndex ? i : i + 1;
}

/** How far a selected card tips as it is picked up, in degrees. */
export const SELECT_TILT = -3;
/** How much bigger a card held out of the fan is drawn. */
export const HELD_SCALE = 1.06;

/** A drawn card's place in the row: `left`/`bottom` where it is placed, `shift` on to where it is drawn, `restX`/`restY` its centre at rest off the hand zone's centre. */
export interface CardPlace {
  left: number;
  bottom: number;
  rot: number;
  shift: number;
  hitW: number;
  restX: number;
  restY: number;
}

/** What a finger is resolved against: each drawn card's strip where it is drawn, and its top edge at rest. */
export interface HandStrips {
  ids: string[];
  lefts: number[];
  widths: number[];
  tops: number[];
  rots: number[];
}

export interface HandRow {
  size: HandCardSize;
  step: number;
  totalW: number;
  scrollable: boolean;
  /** The row's own box: the whole row when it scrolls, or as much as `availW` allows. */
  width: number;
  /** How far the pan reaches either way. */
  panLimit: number;
  crop: number;
  visibleH: number;
  /** How far the middle card climbs above the end ones. */
  arcRise: number;
  /** What a tilted card hangs past the row's box, above and below. */
  tiltOverhang: number;
  /** Everything a card can occupy above the row's top edge. */
  topClearance: number;
  /** The highest a held card may follow the finger, as a translate from the row's origin. */
  heldCeiling: number;
  /** The row's baseline, off the hand zone's centre. */
  base: number;
  /** Where an exchange's flying card retires, above the row's baseline. */
  arrivalRise: number;
  /** The drawn cards, the held one left out, in order. */
  cards: CardPlace[];
  strips: HandStrips;
  /** Where each slot of the whole hand sits — where a released card is going. */
  slots: { x: number; y: number; rot: number }[];
}

/**
 * The whole hand row, from the hand and the room it is given. The row is stepped for every slot —
 * the cards and the one held open for `arriving` — and each card is placed where it sits in the
 * hand without that slot, its `shift` carrying it to where it is drawn: `left` is a plain style
 * and never animates (#650). A `held` card leaves the fan, whose rest is arced as a hand of one
 * fewer inside the same box, and nothing is held open while it is out.
 */
export function layoutHandRow(input: {
  /** The hand by id, a held card included. */
  ids: readonly string[];
  arriving?: number;
  held?: string | null;
  size: HandCardSize;
  roomW: number;
  availW: number;
  bottomPad: number;
}): HandRow {
  const { ids, size, availW, bottomPad } = input;
  const { w, h } = size;
  const n = ids.length;
  const heldAt = input.held == null ? -1 : ids.indexOf(input.held);
  const parting = input.held == null ? input.arriving : undefined;
  const slotCount = parting === undefined ? n : n + 1;
  const { step, totalW, scrollable } = computeHandLayout(slotCount, input.roomW * size.reach, w, availW);
  const solve = (count: number) =>
    solveArc(count, { budget: HAND_ARC, cardW: w, cardH: h, scale: size.scale, room: totalW, step });
  const full = solve(slotCount);
  const crop = h * HAND_CROP;
  const visibleH = h - crop;
  const arcRise = full.box.h - h;
  // A tilted card's box grows by `w·sin(a) + h·cos(a) − h`, half above and half below. The end
  // cards carry the most of the arc's tilt and a chosen one adds SELECT_TILT, so the worst case is
  // the two together.
  const maxRot = full.cards.reduce((m, at) => Math.max(m, Math.abs(at.rot)), 0);
  const tiltRad = ((maxRot + Math.abs(SELECT_TILT)) * Math.PI) / 180;
  const tiltOverhang = (w * Math.sin(tiltRad) + h * Math.cos(tiltRad) - h) / 2;
  const fanRise = arcRise + handRowHeadroom(h);
  const width = scrollable ? totalW : Math.min(totalW, availW);
  const mid = width / 2;
  const base = HAND_ZONE_H(size.restH, bottomPad) / 2 - bottomPad - arcRise / 2;
  const rest = heldAt === -1 ? [...ids] : ids.filter((_, j) => j !== heldAt);
  const arc = heldAt === -1 ? full.cards : solve(rest.length).cards;
  const closed = parting === undefined ? full : solve(n);
  const strips: HandStrips = { ids: rest, lefts: [], widths: [], tops: [], rots: [] };
  const cards = rest.map((_, i): CardPlace => {
    const slot = slotForCard(i, parting);
    const at = arc[slot] ?? arc[arc.length - 1];
    const home = closed.cards[heldAt !== -1 && i >= heldAt ? i + 1 : i] ?? at;
    const hitW = hitWidth(slot, arc.length, step, w);
    strips.lefts.push(mid + at.x);
    strips.widths.push(hitW);
    strips.tops.push(home.y);
    strips.rots.push(home.rot);
    return {
      left: mid + home.x,
      bottom: -crop - home.y,
      rot: home.rot,
      shift: at.x - home.x,
      hitW,
      restX: home.x + w / 2,
      restY: base + crop + home.y - h / 2,
    };
  });
  return {
    size,
    step,
    totalW,
    scrollable,
    width,
    panLimit: Math.max(0, totalW - availW) / 2,
    crop,
    visibleH,
    arcRise,
    tiltOverhang,
    topClearance: fanRise + tiltOverhang,
    // Level with the fan's own high point: the card is lifted out of the hand, not thrown into the
    // air, and a rise the row can state is a rise the window can clear.
    heldCeiling: crop - fanRise + (h * (HELD_SCALE - 1)) / 2,
    base,
    // The resting face's height, not this hand's: the flight was solved against it whatever the turn.
    arrivalRise: exchangeArrivalRise(size.restH, bottomPad, arcRise / 2),
    cards,
    strips,
    slots: full.cards.map((at) => ({ x: mid + at.x, y: crop + at.y, rot: at.rot })),
  };
}

/**
 * Where a card's centre is drawn, off the hand zone's centre: its place, moved by the shift, lift
 * and tilt drawn on it. At rest those are `place.shift`, 0 and 0.
 */
export function restingOrigin(
  place: CardPlace,
  drawn: { shift: number; lift: number; tilt: number }
): { x: number; y: number; rot: number } {
  return { x: place.restX + drawn.shift, y: place.restY + drawn.lift, rot: place.rot + drawn.tilt };
}

/**
 * How far back a card entering the row starts, from its place: `from` is off the row's centre and
 * the point an exchange's flying card retires to, which is where a descending card falls from and
 * the pile a dealt one flies from is measured against.
 */
export function entryOffset(row: HandRow, place: CardPlace, from: { dx: number; dy: number }): { dx: number; dy: number } {
  return {
    dx: row.width / 2 - place.left + from.dx,
    dy: row.size.h / 2 + place.bottom - row.arrivalRise + from.dy,
  };
}

/**
 * The index of the drawn card a finger at (`x`, `y`) in the row's own coordinates is on, or null.
 * The strip decides along the row; then the card is turned about its centre as it is drawn — a
 * `raised` card lifted by `lift` and tipped by `tilt` — so a raised corner is still the card, and
 * the felt above a card's top edge is not. A card in `gone` is drawn elsewhere and takes no tap.
 */
export function cardUnder(
  strips: HandStrips,
  x: number,
  y: number,
  card: { w: number; h: number },
  pose: { raised: readonly string[]; gone: readonly string[]; lift: number; tilt: number }
): number | null {
  "worklet";
  const i = stripAt(strips.lefts, strips.widths, x);
  if (i === null) return null;
  const id = strips.ids[i];
  if (pose.gone.includes(id)) return null;
  const on = pose.raised.includes(id);
  const rad = ((strips.rots[i] + (on ? pose.tilt : 0)) * Math.PI) / 180;
  const dx = x - strips.lefts[i] - card.w / 2;
  const dy = y - (strips.tops[i] - (on ? pose.lift : 0)) - card.h / 2;
  return dy * Math.cos(rad) - dx * Math.sin(rad) < -card.h / 2 ? null : i;
}
