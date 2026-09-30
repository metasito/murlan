// Every card on the table as the felt sees it: one rectangle per drawn card, in the lamp's design
// space (lampRig.ts `DESIGN`), written on the UI thread by whichever view draws the card.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { CARD_BACK_H, CARD_BACK_W } from "../cardFaceModel.ts";
import { FAN_TURN, fanCounts, seatFanArc } from "../fanGeometry.ts";
import { FAN_DRAWN_CARDS, type OpponentSide } from "../seatLayout.ts";

/**
 * `x`/`y`: the centre in the felt's design space (874 × 402), window point / `Felt.sx` and `/ Felt.sy`.
 * `w`/`h`: the card's own width and height, along its own axes, over the table's one card scale
 * `Felt.s` — the same factor on both, so a turned card keeps its shape; window points are `w × s`.
 * `rot` in degrees, clockwise on screen. `lift`, `glow` and `seen` run 0 to 1; `seen` is the share
 * of the card's width inside the window that clips it (a scrolled hand), 1 everywhere else.
 */
export interface CardRect { x: number; y: number; w: number; h: number; rot: number; back: boolean; lift: number; glow: number; seen: number }

/** Keyed `<scope>:<card>`: one entry per card drawn this frame. */
export type CardRects = Record<string, CardRect>;

export const CARD_SCOPES = ["hand", "fan", "pile", "deal", "leg"] as const;
export type CardScope = (typeof CARD_SCOPES)[number];

export interface Point { x: number; y: number }

/** The window's map onto the felt, and the two points the table's own motion turns about. */
export interface Felt { sx: number; sy: number; s: number; kickAt: Point; shakeAt: Point }

/** The kick (translate, then scale about `kickAt`) and inside it the shake (translate, then rotate about `shakeAt`). */
export interface TableMotion { kx: number; ky: number; ks: number; shx: number; shy: number; shr: number }
export const TABLE_AT_REST: TableMotion = { kx: 0, ky: 0, ks: 1, shx: 0, shy: 0, shr: 0 };

/** A card as laid out inside the shaken table, in window points: its centre, its box after every scale, its turn. */
export interface DrawnCard { cx: number; cy: number; w: number; h: number; rot: number; back: boolean; lift: number; glow: number; seen?: number }

function turned(x: number, y: number, deg: number): Point {
  "worklet";
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

const unit = (v: number) => {
  "worklet";
  return Math.min(1, Math.max(0, v));
};

export function designRect(d: DrawnCard, felt: Felt, m: TableMotion): CardRect {
  "worklet";
  const shaken = turned(d.cx - felt.shakeAt.x, d.cy - felt.shakeAt.y, m.shr);
  const x = felt.kickAt.x + m.kx + m.ks * (felt.shakeAt.x + m.shx + shaken.x - felt.kickAt.x);
  const y = felt.kickAt.y + m.ky + m.ks * (felt.shakeAt.y + m.shy + shaken.y - felt.kickAt.y);
  const k = m.ks / felt.s;
  return {
    x: x / felt.sx,
    y: y / felt.sy,
    w: d.w * k,
    h: d.h * k,
    rot: d.rot + m.shr,
    back: d.back,
    lift: unit(d.lift),
    glow: unit(d.glow),
    seen: unit(d.seen ?? 1),
  };
}

/** The row's pan as drawn: a pan past the overhang moves nothing. */
export function panShown(pan: number, limit: number): number {
  "worklet";
  return Math.min(Math.max(pan, -limit), limit);
}

/** Where a hand row sits, in window points at rest, and the window a scrolled row shows through (`clipHalf` 0: none). */
export interface HandPlace { x: number; y: number; clipX: number; clipHalf: number }

export function handCard(
  row: HandPlace,
  card: { left: number; bottom: number; w: number; h: number; tx: number; ty: number; rot: number; scale: number; back: boolean; lift: number; glow: number },
  pan: number,
  zoneLift: number
): DrawnCard {
  "worklet";
  const cx = row.x + card.left + card.w / 2 + card.tx - pan;
  const w = card.w * card.scale;
  const seen = row.clipHalf > 0 ? (Math.min(cx + w / 2, row.clipX + row.clipHalf) - Math.max(cx - w / 2, row.clipX - row.clipHalf)) / w : 1;
  return {
    cx,
    cy: row.y + zoneLift - card.bottom - card.h / 2 + card.ty,
    w,
    h: card.h * card.scale,
    rot: card.rot,
    back: card.back,
    lift: card.lift,
    glow: card.glow,
    seen,
  };
}

/** The group's transform list `translate, scale, translateY(drop), rotate`, about the pile's centre. */
export interface GroupPose { tx: number; ty: number; scale: number; drop: number; rot: number }
/** The wobble's `scale, rotate`, about the same point. */
export interface WobblePose { scale: number; rot: number }

export function pileCard(
  pile: Point,
  group: GroupPose,
  wobble: WobblePose,
  card: { slotX: number; slotY: number; x: number; y: number; rot: number; scale: number; liftY: number; w: number; h: number; lift: number; glow: number }
): DrawnCard {
  "worklet";
  const up = turned(0, card.liftY * card.scale, card.rot);
  const own = turned(card.slotX + card.x + up.x, card.slotY + card.y + up.y, wobble.rot);
  const inGroup = turned(own.x * wobble.scale, own.y * wobble.scale, group.rot);
  const k = group.scale * wobble.scale * card.scale;
  return {
    cx: pile.x + group.tx + group.scale * inGroup.x,
    cy: pile.y + group.ty + group.scale * (group.drop + inGroup.y),
    w: card.w * k,
    h: card.h * k,
    rot: group.rot + wobble.rot + card.rot,
    back: false,
    lift: card.lift,
    glow: card.glow,
  };
}

export function dealBack(pile: Point, at: { dx: number; dy: number; rot: number }, w: number, h: number): DrawnCard {
  "worklet";
  return { cx: pile.x + at.dx, cy: pile.y + at.dy, w, h, rot: at.rot, back: true, lift: 0, glow: 0 };
}

/** `w`/`h` are whichever side the flier shows. */
export function legCard(pile: Point, pose: { x: number; y: number; rot: number; scale: number; flip: number; face: boolean }, w: number, h: number): DrawnCard {
  "worklet";
  return { cx: pile.x + pose.x, cy: pile.y + pose.y, w: w * pose.scale * Math.abs(pose.flip), h: h * pose.scale, rot: pose.rot, back: !pose.face, lift: 0, glow: 0 };
}

/**
 * A seat's fan of backs, each turned in the fan's box and the box leaned back under its perspective
 * (`CardFan`, seats.tsx): the centre is projected exactly, the size foreshortened at it.
 */
export function fanBacks(centre: Point, fan: { side: OpponentSide; count: number; backScale: number; leanDeg: number; perspective: number }): DrawnCard[] {
  const { cards, box, bounds } = seatFanArc(fanCounts(fan.count, FAN_DRAWN_CARDS[fan.side]), fan.backScale);
  const w = CARD_BACK_W(fan.backScale);
  const h = CARD_BACK_H(fan.backScale);
  const lean = (fan.leanDeg * Math.PI) / 180;
  const turn = FAN_TURN[fan.side];
  const depth = fan.perspective * fan.backScale;
  return cards.map((at) => {
    const qx = box.w / 2 + at.x + w / 2 - bounds.cx;
    const qy = at.y + h / 2 - bounds.cy;
    const f = depth / (depth - qy * Math.sin(lean));
    const on = turned(qx, qy * Math.cos(lean), turn);
    const r = (at.rot * Math.PI) / 180;
    const leaned = (Math.atan2(Math.sin(r) * Math.cos(lean), Math.cos(r)) * 180) / Math.PI;
    return { cx: centre.x + on.x * f, cy: centre.y + on.y * f, w: w * f, h: h * Math.cos(lean) * f, rot: turn + leaned, back: true, lift: 0, glow: 0 };
  });
}
