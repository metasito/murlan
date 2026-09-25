// The lamp (#1252 § The lamp): the one rig every lit thing reads, stepped once per frame on the
// UI thread. Its numbers are `lampStep`, `POOL` and `resetLamp` in
// tests/e2e/fixtures/lantern-table/index.html, in that table's 874 × 402 points.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { FlyDirection } from "../seatLayout.ts";

export const DESIGN = { width: 874, height: 402 } as const;

export type LampTarget = FlyDirection | "centre";

const POOL: Record<LampTarget, readonly [number, number]> = {
  bottom: [457, 292],
  right: [712, 196],
  top: [457, 116],
  left: [202, 196],
  centre: [465, 201],
};

/** The light hangs this far above the pool it throws. */
export const LIGHT_ABOVE = 40;
const GLIDE = 2.2;
const SWAY = 20;
const SWAY_KICKED = 80;
const KICK_DECAY = 1.1;
const FLARE_DECAY = 2.4;
const DEFAULT_LEVEL_RATE = 3;
const MAX_DT = 0.05;

export interface Lamp {
  /** The pool's centre, gliding toward `tx`, `ty`. */
  x: number;
  y: number;
  tx: number;
  ty: number;
  ph: number;
  kick: number;
  flare: number;
  lvl: number;
  lvlT: number;
  lvlRate: number;
  freeze: number;
  /** Seconds the rig has run: the sway's period drifts with it. */
  t: number;
  /** What a frame draws: the light point, swayed, and its level and flare. */
  lx: number;
  ly: number;
  level: number;
  f: number;
  /** `lx`, `ly`, `level`, `f` as the last frame `lampMoved` passed drew them. */
  shown: number[];
}

export function lampTarget(target: LampTarget): readonly [number, number] {
  "worklet";
  return POOL[target];
}

export function restingLamp(target: LampTarget, level = 1): Lamp {
  const [x, y] = POOL[target];
  return {
    x,
    y,
    tx: x,
    ty: y,
    ph: 0,
    kick: 0,
    flare: 0,
    lvl: level,
    lvlT: level,
    lvlRate: DEFAULT_LEVEL_RATE,
    freeze: 0,
    t: 0,
    lx: x,
    ly: y - LIGHT_ABOVE,
    level,
    f: 0,
    shown: [x, y - LIGHT_ABOVE, level, 0],
  };
}

/** A hundredth of a point, and half a step of 8-bit light. */
const SHOWN_STEP = [0.01, 0.01, 1 / 512, 1 / 512];

/** Whether this frame draws anything the last one shown did not; the felt redraws only then. */
export function lampMoved(s: Lamp): boolean {
  "worklet";
  const now = [s.lx, s.ly, s.level, s.f];
  if (now.every((v, i) => Math.abs(v - s.shown[i]) <= SHOWN_STEP[i])) return false;
  s.shown = now;
  return true;
}

const clamp01 = (v: number) => {
  "worklet";
  return Math.min(1, Math.max(0, v));
};

export function stepLamp(s: Lamp, seconds: number, reduced: boolean): void {
  "worklet";
  const dt = Math.min(MAX_DT, Math.max(0, seconds));
  s.t += dt;
  if (reduced) {
    s.x = s.tx;
    s.y = s.ty;
  } else {
    const e = 1 - Math.exp(-dt * GLIDE);
    s.x += (s.tx - s.x) * e;
    s.y += (s.ty - s.y) * e;
  }
  s.lvl += (s.lvlT - s.lvl) * (1 - Math.exp(-dt * s.lvlRate));
  const run = 1 - s.freeze;
  const w = 0.84 * (1 + 0.14 * Math.sin(s.t * 0.11 + 1.3) + 0.06 * Math.sin(s.t * 0.37));
  s.ph += dt * w * run;
  const sway = reduced ? 0 : Math.sin(s.ph) * (SWAY + SWAY_KICKED * s.kick);
  s.kick *= Math.exp(-dt * KICK_DECAY);
  s.level = clamp01(s.lvl);
  s.lx = s.x + sway;
  s.ly = s.y - LIGHT_ABOVE;
  s.f = reduced ? 0 : s.flare;
  s.flare *= Math.exp(-dt * FLARE_DECAY);
}

/** A moment's hold on the lamp: each call is what the mockup's chapters write into `lamp`. */
export const lampControls = {
  setTarget(s: Lamp, target: LampTarget, reduced: boolean): void {
    "worklet";
    [s.tx, s.ty] = POOL[target];
    if (reduced) {
      s.x = s.tx;
      s.y = s.ty;
    }
  },
  setLevel(s: Lamp, to: number, rate: number): void {
    "worklet";
    s.lvlT = clamp01(to);
    s.lvlRate = rate;
  },
  flare(s: Lamp, reduced: boolean): void {
    "worklet";
    if (!reduced) s.flare = 1;
  },
  kick(s: Lamp, reduced: boolean): void {
    "worklet";
    if (!reduced) s.kick = 1;
  },
  freeze(s: Lamp, amount: number): void {
    "worklet";
    s.freeze = clamp01(amount);
  },
};

/** Design points to the felt box's own: the table stretches to the window it is given. */
export function designScale(width: number, height: number): { sx: number; sy: number } {
  "worklet";
  return { sx: width / DESIGN.width, sy: height / DESIGN.height };
}
