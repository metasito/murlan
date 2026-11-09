// A seat's fan of backs: its shape, and where it sits beside the seat's ring.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { CARD_BACK_H, CARD_BACK_W, BACK_SCALE } from "./cardFaceModel.ts";
import { arcBounds, solveArc, SEAT_ARC } from "./tableArc.ts";
import { FAN_DRAWN_CARDS, SEAT_DISC, seatGap, type OpponentSide } from "./seatLayout.ts";

/** A quarter turn per side, so one construction serves all three seats. */
export const FAN_TURN: Record<OpponentSide, number> = { top: 0, left: -90, right: 90 };

/**
 * How far the fan leans away from the viewer, in its own frame — so a side
 * player leans sideways from the same line of code as the top player leaning
 * back. The perspective is what turns the lean into depth rather than a squash.
 */
export const FAN_LEAN_DEG = -17;
export const FAN_PERSPECTIVE = 560;

/** How many backs a `CardFan` draws: the count leaves at the throw (ADR-0008), and never more than `cap`. */
export function fanCounts(count: number, cap: number): number {
  return Math.min(count, cap);
}

/**
 * A seat's own fan of `count` backs at `backScale` — the one solve `CardFan`
 * (components/table/seats.tsx) performs for its wrapper box, and that
 * `drawnFanBounds` performs for the bands, so none can disagree with what the fan actually draws.
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
 * The top fan's height, a side fan's vertical extent, and how far a side fan reaches inboard of its
 * ring's centre, each at its drawn cap.
 */
export function drawnFanBounds(scale: number): { topH: number; sideH: number; sideReach: number } {
  const backScale = scale * BACK_SCALE;
  const count = FAN_DRAWN_CARDS.left;
  const at = fanPoint({ dx: 0, dy: 0 }, "left", scale, count);
  return {
    topH: seatFanArc(FAN_DRAWN_CARDS.top, backScale).bounds.h,
    sideH: seatFanArc(Math.max(FAN_DRAWN_CARDS.left, FAN_DRAWN_CARDS.right), backScale).bounds.w,
    sideReach: Math.max(...fanCorners(at, "left", count, backScale).flat().map(([x]) => x)),
  };
}

/** How far a side seat's fan stands above its ring's top, which its name and badges must clear; the top seat's fan hangs below. */
export function seatLabelRise(side: OpponentSide, scale: number): number {
  return side === "top" ? 0 : Math.max(0, (drawnFanBounds(scale).sideH - SEAT_DISC * scale) / 2);
}

/** The fan's centre, from the pile, given its ring's (`seatPoint`), and the angle it is drawn at. */
export function fanPoint(
  ring: { dx: number; dy: number },
  dir: OpponentSide,
  scale: number,
  count: number
): { x: number; y: number; rot: number } {
  const drawn = fanCounts(count, FAN_DRAWN_CARDS[dir]);
  const across = drawn > 0 ? seatFanArc(drawn, scale * BACK_SCALE).bounds.h : 0;
  const along = (SEAT_DISC * scale) / 2 + seatGap(scale) + across / 2;
  if (dir === "top") return { x: ring.dx, y: ring.dy + along, rot: FAN_TURN.top };
  return { x: ring.dx + (dir === "left" ? along : -along), y: ring.dy, rot: FAN_TURN[dir] };
}

/**
 * `CardFan`'s box turned and leaned about the fan's middle under its perspective: each back's middle
 * in that box, measured from the middle, and `project`, which takes such a point to where the page
 * draws it from the fan's centre, with `f` its foreshortening there.
 */
export function fanProjection(side: OpponentSide, count: number, backScale: number, leanDeg = FAN_LEAN_DEG, perspective = FAN_PERSPECTIVE) {
  const { cards, box, bounds } = seatFanArc(fanCounts(count, FAN_DRAWN_CARDS[side]), backScale);
  const w = CARD_BACK_W(backScale);
  const h = CARD_BACK_H(backScale);
  const lean = (leanDeg * Math.PI) / 180;
  const turn = (FAN_TURN[side] * Math.PI) / 180;
  const depth = perspective * backScale;
  const project = (qx: number, qy: number) => {
    const f = depth / (depth - qy * Math.sin(lean));
    const y = qy * Math.cos(lean);
    return { x: (qx * Math.cos(turn) - y * Math.sin(turn)) * f, y: (qx * Math.sin(turn) + y * Math.cos(turn)) * f, f };
  };
  return { w, h, lean, cards: cards.map((at) => ({ x: box.w / 2 + at.x + w / 2 - bounds.cx, y: at.y + h / 2 - bounds.cy, rot: at.rot })), project };
}

/** Each back's four corners as the page draws them, in the coordinates of `centre` (`fanPoint`'s). */
export function fanCorners(centre: { x: number; y: number }, side: OpponentSide, count: number, backScale: number): [number, number][][] {
  const { w, h, cards, project } = fanProjection(side, count, backScale);
  return cards.map((at) => {
    const r = (at.rot * Math.PI) / 180;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]): [number, number] => {
      const p = project(at.x + ((sx * w) / 2) * Math.cos(r) - ((sy * h) / 2) * Math.sin(r), at.y + ((sx * w) / 2) * Math.sin(r) + ((sy * h) / 2) * Math.cos(r));
      return [centre.x + p.x, centre.y + p.y];
    });
  });
}
