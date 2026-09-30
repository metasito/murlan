// Every card on the table as the felt sees it: one rectangle per drawn card, in the lamp's design
// space (lampRig.ts `DESIGN`), written on the UI thread by whichever view draws the card.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { CARD_BACK_H, CARD_BACK_W } from "../cardFaceModel.ts";
import { FAN_TURN, fanCounts, seatFanArc } from "../fanGeometry.ts";
import { FAN_DRAWN_CARDS, type OpponentSide } from "../seatLayout.ts";

/** Centre and size in the felt's design space (874 × 402); rot in degrees; lift and glow 0 to 1. */
export interface CardRect { x: number; y: number; w: number; h: number; rot: number; back: boolean; lift: number; glow: number }

/** Keyed `<scope>:<card>`: one entry per card drawn this frame. */
export type CardRects = Record<string, CardRect>;

export const CARD_SCOPES = ["hand", "fan", "pile", "deal", "leg"] as const;
export type CardScope = (typeof CARD_SCOPES)[number];

export interface Point { x: number; y: number }

/** Window points to design points, per axis: the felt stretches to the window. */
export interface Felt { sx: number; sy: number }

/** A card as drawn, in window points: its centre, its box after every scale, its turn. */
export interface DrawnCard { cx: number; cy: number; w: number; h: number; rot: number; back: boolean; lift: number; glow: number }

export function designRect(d: DrawnCard, felt: Felt): CardRect {
  "worklet";
  return { x: d.cx / felt.sx, y: d.cy / felt.sy, w: d.w / felt.sx, h: d.h / felt.sy, rot: d.rot, back: d.back, lift: d.lift, glow: d.glow };
}

function turned(x: number, y: number, deg: number): Point {
  "worklet";
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

const unit = (v: number) => {
  "worklet";
  return Math.min(1, Math.max(0, v));
};

/** A hand card: its box `left`/`bottom` in the row, moved by its own transform, the row by the pan and the zone's lift. */
export function handCardRect(
  row: Point & Felt,
  card: { left: number; bottom: number; w: number; h: number; tx: number; ty: number; rot: number; scale: number; back: boolean; lift: number; glow: number },
  pan: number,
  zoneLift: number
): CardRect {
  "worklet";
  return designRect(
    {
      cx: row.x + card.left + card.w / 2 + card.tx - pan,
      cy: row.y + zoneLift - card.bottom - card.h / 2 + card.ty,
      w: card.w * card.scale,
      h: card.h * card.scale,
      rot: card.rot,
      back: card.back,
      lift: unit(card.lift),
      glow: unit(card.glow),
    },
    row
  );
}

/** The group's transform list `translate, scale, translateY(drop), rotate`, about the pile's centre. */
export interface GroupPose { tx: number; ty: number; scale: number; drop: number; rot: number }
/** The wobble's `scale, rotate`, about the same point. */
export interface WobblePose { scale: number; rot: number }

/** A played card: its flight pose from its slot, the catch's lift in its own frame, the wobble and the group about the pile. */
export function pileCardRect(
  pile: Point,
  felt: Felt,
  group: GroupPose,
  wobble: WobblePose,
  card: { slotX: number; slotY: number; x: number; y: number; rot: number; scale: number; liftY: number; w: number; h: number; lift: number; glow: number }
): CardRect {
  "worklet";
  const up = turned(0, card.liftY * card.scale, card.rot);
  const own = turned(card.slotX + card.x + up.x, card.slotY + card.y + up.y, wobble.rot);
  const inGroup = turned(own.x * wobble.scale, own.y * wobble.scale, group.rot);
  const k = group.scale * wobble.scale * card.scale;
  return designRect(
    {
      cx: pile.x + group.tx + group.scale * inGroup.x,
      cy: pile.y + group.ty + group.scale * (group.drop + inGroup.y),
      w: card.w * k,
      h: card.h * k,
      rot: group.rot + wobble.rot + card.rot,
      back: false,
      lift: unit(card.lift),
      glow: unit(card.glow),
    },
    felt
  );
}

/** A dealt back in the air: from the pile toward its seat, spun. */
export function dealBackRect(pile: Point, felt: Felt, at: { dx: number; dy: number; rot: number }, w: number, h: number): CardRect {
  "worklet";
  return designRect({ cx: pile.x + at.dx, cy: pile.y + at.dy, w, h, rot: at.rot, back: true, lift: 0, glow: 0 }, felt);
}

/** A traded card's flier, from the pile; `w`/`h` are whichever side it shows. */
export function legCardRect(
  pile: Point,
  felt: Felt,
  pose: { x: number; y: number; rot: number; scale: number; flip: number; face: boolean },
  w: number,
  h: number
): CardRect {
  "worklet";
  return designRect(
    { cx: pile.x + pose.x, cy: pile.y + pose.y, w: w * pose.scale * Math.abs(pose.flip), h: h * pose.scale, rot: pose.rot, back: !pose.face, lift: 0, glow: 0 },
    felt
  );
}

/**
 * A seat's fan of backs, each turned in the fan's box and the box leaned back under its perspective
 * (`CardFan`, seats.tsx): the centre is projected exactly, the size foreshortened at it.
 */
export function fanBackRects(
  centre: Point,
  felt: Felt,
  fan: { side: OpponentSide; count: number; backScale: number; leanDeg: number; perspective: number }
): CardRect[] {
  const { cards, box, bounds } = seatFanArc(fanCounts(fan.count, FAN_DRAWN_CARDS[fan.side]), fan.backScale);
  const w = CARD_BACK_W(fan.backScale);
  const h = CARD_BACK_H(fan.backScale);
  const lean = (fan.leanDeg * Math.PI) / 180;
  const turn = FAN_TURN[fan.side];
  const depth = fan.perspective * fan.backScale;
  return cards.map((at) => {
    const qx = box.w / 2 + at.x + w / 2 - bounds.cx;
    const qy = at.y + h / 2 - bounds.cy;
    const z = qy * Math.sin(lean);
    const f = depth / (depth - z);
    const on = turned(qx, qy * Math.cos(lean), turn);
    const r = (at.rot * Math.PI) / 180;
    const seen = (Math.atan2(Math.sin(r) * Math.cos(lean), Math.cos(r)) * 180) / Math.PI;
    return designRect(
      { cx: centre.x + on.x * f, cy: centre.y + on.y * f, w: w * f, h: h * Math.cos(lean) * f, rot: turn + seen, back: true, lift: 0, glow: 0 },
      felt
    );
  });
}
