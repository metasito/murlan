// The score pill's geometry (#1265): the Lantern Table mockup's `renderScore`, in its own px at
// its 874 × 402 frame. `unit` is how many of the app's points one of those px is.
//
// Plain worklets with no imports, so `node --test` loads them and Reanimated runs them.

/** The mockup's frame's short edge: its px are the app's points at this window height. */
export const MOCKUP_SHORT_EDGE = 402;

const REST_W = 124;
const OPEN_W = 236;
const OPEN_H = 128;
const OPEN_RADIUS = 12;
const BOARD_W = 440;
const BOARD_H = 252;
const BOARD_RADIUS = 16;
const BOARD_ROW_SCALE = 1.2;

export const PILL_ROW = { x: 8, y: 26, step: 24, w: 220, h: 22 };
const BOARD_ROW = { x: 162, y: 46, step: 38 };
export const PILL_HEADER = { x: 12, y: 8, boardX: 164, boardY: 18, w: 212 };

export interface PillAnchor {
  /** The pill's right edge, which it opens leftward from. */
  right: number;
  top: number;
  restH: number;
  boardLeft: number;
  boardTop: number;
  unit: number;
}

export interface PillBox {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
}

function lerp(a: number, b: number, k: number): number {
  "worklet";
  return a + (b - a) * k;
}

function clamp01(v: number): number {
  "worklet";
  return Math.max(0, Math.min(1, v));
}

/** `open` may overshoot 1 on its back-out; `board` takes over from the open panel once past 0. */
export function scorePillBox(open: number, board: number, a: PillAnchor): PillBox {
  "worklet";
  const u = a.unit;
  if (board > 0) {
    return {
      x: lerp(a.right - OPEN_W * u, a.boardLeft, board),
      y: lerp(a.top, a.boardTop, board),
      w: lerp(OPEN_W, BOARD_W, board) * u,
      h: lerp(OPEN_H, BOARD_H, board) * u,
      radius: lerp(OPEN_RADIUS, BOARD_RADIUS, board) * u,
    };
  }
  const w = lerp(REST_W, OPEN_W, open) * u;
  return {
    x: a.right - w,
    y: a.top,
    w,
    h: lerp(a.restH, OPEN_H * u, open),
    radius: lerp(a.restH / 2, OPEN_RADIUS * u, clamp01(open)),
  };
}

export function scorePillFades(open: number, board: number): { chip: number; panel: number } {
  "worklet";
  if (board > 0) return { chip: 0, panel: 1 };
  return { chip: 1 - clamp01(open * 3), panel: clamp01((open - 0.3) / 0.5) };
}

/** The top-left corner and scale of the row at `pos`, best first, inside the box. */
export function scorePillRow(pos: number, board: number, unit: number): { x: number; y: number; scale: number } {
  "worklet";
  return {
    x: lerp(PILL_ROW.x, BOARD_ROW.x, board) * unit,
    y: lerp(PILL_ROW.y + pos * PILL_ROW.step, BOARD_ROW.y + pos * BOARD_ROW.step, board) * unit,
    scale: lerp(1, BOARD_ROW_SCALE, board),
  };
}

export function scorePillLift(open: number, board: number): { offsetY: number; blur: number } {
  "worklet";
  const lift = Math.max(clamp01(open), board);
  return { offsetY: 4 + 14 * lift, blur: 10 + 26 * lift };
}
