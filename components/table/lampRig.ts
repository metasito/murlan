// The lamp (#1252 § The lamp): the one rig every lit thing reads, stepped once per frame on the
// UI thread. Its numbers are `lampStep` and `resetLamp` in
// tests/e2e/fixtures/lantern-table/index.html, in that table's 874 × 402 points; where it aims is
// the owner's G1 answers (docs/plans/2026-09-28-1259-3-layout-and-lamp.md § Decided).
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { speedOf, swept } from "../../lib/swayTable.ts";
import type { FlyDirection } from "../seatLayout.ts";

export const DESIGN = { width: 874, height: 402 } as const;

export type LampTarget = FlyDirection | "centre";

/** Design points; reach 1 is the size of the light on the page the owner tuned. */
export type Pool = readonly [x: number, y: number, reach: number];

type Point = { readonly x: number; readonly y: number };

/** The middle of the window; the start announcement's light takes its x from the table the words centre on. */
export const TABLE_CENTRE: Pool = [DESIGN.width / 2, DESIGN.height / 2, 1];

/** The hand-to-top distance on the page he tuned, in design points: reach 1. */
const REACH_ONE = 269;
const INWARD = 7;
const INTO_TABLE: Record<FlyDirection, readonly [number, number]> = {
  bottom: [0, -1],
  top: [0, 1],
  left: [1, 0],
  right: [-1, 0],
};

/** The light hangs this far above the pool it throws. */
export const LIGHT_ABOVE = 40;

/** `seat`, `top` and `bottom` are window points of a `width` × `height` window. */
export function poolOver(side: FlyDirection, seat: Point, top: Point, bottom: Point, width: number, height: number): Pool {
  const { sx, sy } = designScale(width, height);
  const apart = (a: Point, b: Point) => Math.hypot((a.x - b.x) / sx, (a.y - b.y) / sy);
  const near = side === "top" || side === "bottom" ? apart(top, bottom) : Math.min(apart(seat, top), apart(seat, bottom));
  const reach = near / REACH_ONE;
  const [ix, iy] = INTO_TABLE[side];
  return [seat.x / sx + ix * INWARD * reach, seat.y / sy + iy * INWARD * reach + LIGHT_ABOVE, reach];
}

export function lampPools(anchors: Record<FlyDirection, Point>, width: number, height: number): Record<LampTarget, Pool> {
  const over = (side: FlyDirection) => poolOver(side, anchors[side], anchors.top, anchors.bottom, width, height);
  const centre: Pool = [anchors.top.x / designScale(width, height).sx, TABLE_CENTRE[1], TABLE_CENTRE[2]];
  return { bottom: over("bottom"), right: over("right"), top: over("top"), left: over("left"), centre };
}
/** The light's size at reach 1, in design points: the owner's G1 sliders, the pool's bright radius and the vignette's. */
export const LAMP_LIGHT = { poolR: 380, vigR: 380 } as const;

export function lightUniforms(reach: number): { uPoolR: number; uVigR: number } {
  "worklet";
  return { uPoolR: LAMP_LIGHT.poolR * reach, uVigR: LAMP_LIGHT.vigR * reach };
}

/** Where the light hangs: `sway` points either side of the pool's centre `x`, and above its `y`. */
export function lightX(x: number, sway: number): number {
  "worklet";
  return x + sway;
}

export function lightY(y: number): number {
  "worklet";
  return y - LIGHT_ABOVE;
}

export const GLIDE = 2.2;
export const SWAY = 20;
export const SWAY_KICKED = 80;
const KICK_DECAY = 1.1;
const FLARE_DECAY = 2.4;
const DEFAULT_LEVEL_RATE = 3;
export const MAX_DT = 0.05;

/** Who may hold the lamp's level down: the lost round, the deal's breath, the viewer's lost link. */
export type LevelOwner = "lost" | "breath" | "link";
const RELEASED = 1;

export interface Lamp {
  /** The pool's centre, gliding toward `tx`, `ty`. */
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** The light's reach, gliding toward `tr` with the pool. */
  r: number;
  tr: number;
  ph: number;
  kick: number;
  flare: number;
  lvl: number;
  lvlT: number;
  lvlRate: number;
  /** The level each owner holds the lamp at, `RELEASED` when it holds nothing; `lvlT` is the lowest. */
  holds: Record<LevelOwner, number>;
  freeze: number;
  /** Seconds the rig has run: the sway's period drifts with it. */
  t: number;
  /** What a frame draws: the light point, swayed, and its level and flare. */
  lx: number;
  ly: number;
  level: number;
  f: number;
  /** What the last frame `lampMoved` passed drew. */
  drawn: { lx: number; ly: number; level: number; f: number; r: number };
}

/** A `level` under 1 is the deal's breath, held from the first frame. */
export function restingLamp([x, y, r]: Pool, level = 1): Lamp {
  return {
    x,
    y,
    tx: x,
    ty: y,
    r,
    tr: r,
    ph: 0,
    kick: 0,
    flare: 0,
    lvl: level,
    lvlT: level,
    lvlRate: DEFAULT_LEVEL_RATE,
    holds: { lost: RELEASED, breath: level, link: RELEASED },
    freeze: 0,
    t: 0,
    lx: x,
    ly: y - LIGHT_ABOVE,
    level,
    f: 0,
    drawn: { lx: x, ly: y - LIGHT_ABOVE, level, f: 0, r },
  };
}

/** Design points the light may move before the felt redraws it, so a sway crosses it a few times a second, not every frame. Measured, not derived: Skia captures at this step differ from ones redrawn every frame by at most 2 levels of 8-bit light (`tests/ui-rules/lampRig.test.ts` holds the step). */
const FELT_STEP = 0.5;
/** Half a step of 8-bit light. */
const LIGHT_STEP = 1 / 512;
/** Nothing the reach scales lies farther than the table's width from the light: under this, no point moves by a step. */
const REACH_STEP = FELT_STEP / DESIGN.width;

/** Whether this frame draws anything the last one drawn did not; the felt redraws only then. */
export function lampMoved(s: Lamp): boolean {
  "worklet";
  const d = s.drawn;
  const still =
    Math.abs(s.lx - d.lx) <= FELT_STEP &&
    Math.abs(s.ly - d.ly) <= FELT_STEP &&
    Math.abs(s.level - d.level) <= LIGHT_STEP &&
    Math.abs(s.f - d.f) <= LIGHT_STEP &&
    Math.abs(s.r - d.r) <= REACH_STEP;
  if (still) return false;
  d.lx = s.lx;
  d.ly = s.ly;
  d.level = s.level;
  d.f = s.f;
  d.r = s.r;
  return true;
}

const clamp01 = (v: number) => {
  "worklet";
  return Math.min(1, Math.max(0, v));
};

/** `drawnAt` is the seconds into `dt` the kick and flare are drawn at: a frame draws what it starts with, as the mockup's `lampStep`; a span carried at once, what it ends with. */
function advance(s: Lamp, dt: number, swing: number, reduced: boolean, drawnAt: number): void {
  "worklet";
  s.t += dt;
  if (reduced) {
    s.x = s.tx;
    s.y = s.ty;
    s.r = s.tr;
  } else {
    const e = 1 - Math.exp(-dt * GLIDE);
    s.x += (s.tx - s.x) * e;
    s.y += (s.ty - s.y) * e;
    s.r += (s.tr - s.r) * e;
  }
  s.lvl += (s.lvlT - s.lvl) * (1 - Math.exp(-dt * s.lvlRate));
  s.ph += swing * (1 - s.freeze);
  s.kick *= Math.exp(-drawnAt * KICK_DECAY);
  s.flare *= Math.exp(-drawnAt * FLARE_DECAY);
  const sway = reduced ? 0 : Math.sin(s.ph) * (SWAY + SWAY_KICKED * s.kick);
  s.level = clamp01(s.lvl);
  s.lx = lightX(s.x, sway);
  s.ly = lightY(s.y);
  s.f = reduced ? 0 : s.flare;
  s.kick *= Math.exp(-(dt - drawnAt) * KICK_DECAY);
  s.flare *= Math.exp(-(dt - drawnAt) * FLARE_DECAY);
}

/** One frame: at most `MAX_DT`, the phase at the frame's end speed, as the mockup's `lampStep`. */
export function stepLamp(s: Lamp, seconds: number, reduced: boolean): void {
  "worklet";
  const dt = Math.min(MAX_DT, Math.max(0, seconds));
  advance(s, dt, dt * speedOf(s.t + dt), reduced, 0);
}

/** `seconds` the rig did not step, at once, the phase on the exact integral of the speed: what the compositor's track played meanwhile. */
export function resumeLamp(s: Lamp, seconds: number, reduced: boolean): void {
  "worklet";
  const dt = Math.max(0, seconds);
  advance(s, dt, swept(s.t, s.t + dt), reduced, dt);
}

/** The lamp as every reader takes it: `now()` is valid until the next call, and only the rig writes it. */
export interface LampNow {
  now(): Lamp;
  /** `now().t`, without carrying the rest of the lamp on. */
  clock(): number;
}

/** A lamp the rig steps every frame it moves: native, where nothing holds it. */
export function steppedLamp(lamp: { readonly value: Lamp }): LampNow {
  return {
    now: () => {
      "worklet";
      return lamp.value;
    },
    clock: () => {
      "worklet";
      return lamp.value.t;
    },
  };
}

/** A rig that may stop stepping its lamp while the compositor carries its sway (`endsCarry`), the lamp carried on for readers by the page's clock. */
export interface LampHold extends LampNow {
  /** Seconds a frame at `timestamp` (ms, the page's clock) steps the lamp: from the instant the lamp stands at, so a lamp resumed between frames steps only what is left. */
  step(timestamp: number): number;
  /** The rig stops stepping the lamp from the instant it stands at; its clock runs on while the page shows. */
  hold(): void;
  held(): boolean;
  /** Carries the rig's own lamp `s` on to now if it was held, and leaves it to the rig's steps again. */
  resume(s: Lamp): void;
  /** The page shows or is hidden: a hidden page steps no rig, so a held clock stops with it. */
  shown(visible: boolean): void;
}

export function createLampHold(lamp: { get(): Lamp }, reduced: { get(): boolean }): LampHold {
  let heldAt = NaN;
  let hiddenAt = NaN;
  let at = NaN;
  const carried = { ...lamp.get() };
  const heldFor = () => {
    if (Number.isNaN(heldAt)) return 0;
    const until = Number.isNaN(hiddenAt) ? performance.now() : hiddenAt;
    return Math.max(0, until - heldAt) / 1000;
  };
  return {
    // `advance` writes neither `holds` nor `drawn`: the copy shares them with the rig's lamp.
    now: () => {
      const s = lamp.get();
      if (Number.isNaN(heldAt)) return s;
      Object.assign(carried, s);
      resumeLamp(carried, heldFor(), reduced.get());
      return carried;
    },
    clock: () => lamp.get().t + heldFor(),
    step: (timestamp) => {
      const from = Number.isNaN(at) ? timestamp : at;
      at = Math.max(from, timestamp);
      return (at - from) / 1000;
    },
    hold: () => {
      heldAt = Number.isNaN(at) ? performance.now() : at;
    },
    held: () => !Number.isNaN(heldAt),
    resume: (s) => {
      if (Number.isNaN(heldAt)) return;
      resumeLamp(s, heldFor(), reduced.get());
      at = performance.now();
      heldAt = NaN;
    },
    shown: (visible) => {
      const at = performance.now();
      if (!visible) {
        if (Number.isNaN(hiddenAt)) hiddenAt = at;
        return;
      }
      if (!Number.isNaN(heldAt) && !Number.isNaN(hiddenAt)) heldAt += at - Math.max(heldAt, hiddenAt);
      hiddenAt = NaN;
    },
  };
}

const SETTLED = 1e-4;

/** Whether a further step would move nothing: under reduced motion, converged on its targets, and the flare and kick spent. */
export function lampSettled(s: Lamp, reduced: boolean): boolean {
  "worklet";
  return (
    reduced &&
    Math.abs(s.tx - s.x) < SETTLED &&
    Math.abs(s.ty - s.y) < SETTLED &&
    Math.abs(s.tr - s.r) < SETTLED &&
    Math.abs(s.lvlT - s.lvl) < SETTLED &&
    s.flare < SETTLED &&
    s.kick < SETTLED
  );
}

/** A moment's hold on the lamp: each call is what the mockup's chapters write into `lamp`. */
export const lampControls = {
  setTarget(s: Lamp, pool: Pool, reduced: boolean): void {
    "worklet";
    [s.tx, s.ty, s.tr] = pool;
    if (reduced) {
      s.x = s.tx;
      s.y = s.ty;
      s.r = s.tr;
    }
  },
  /** `level` null releases `owner`'s hold; `rate` is the glide's only when this write moves the lamp's target. */
  hold(s: Lamp, owner: LevelOwner, level: number | null, rate: number): void {
    "worklet";
    s.holds[owner] = level === null ? RELEASED : clamp01(level);
    const to = Math.min(RELEASED, s.holds.lost, s.holds.breath, s.holds.link);
    if (to === s.lvlT) return;
    s.lvlT = to;
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
