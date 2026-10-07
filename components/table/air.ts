// The table at rest (#1261): 40 motes lit only inside the lamp's cone, and a moth crossing the
// light. Its numbers are `lamp.m`, `lampStep` and `drawAir` in
// tests/e2e/fixtures/lantern-table/index.html, in that table's 874 × 402 points.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { DESIGN, type Lamp } from "./lampRig.ts";
import type { Rng } from "./particles.ts";

export const MOTES = 40;
/** Offsets into one mote's `MOTE_STRIDE` floats of `Air.m`. */
export const M = { x: 0, y: 1, r: 2, vx: 3, vy: 4, ph: 5 } as const;
export const MOTE_STRIDE = 6;

const TAU = Math.PI * 2;
const CROSSING_S = 4;
const UNSEEN = 0.02;
const MOTE_ALPHA = 0.85;

export interface Air {
  /** Seconds the air has run: the drift's sway, the twinkle and the moth read it. */
  t: number;
  m: Float64Array;
  mothAt: number;
  /** When the moth on the light set off, or -1. */
  mothT: number;
}

export type AirLight = Pick<Lamp, "lx" | "ly" | "level" | "f" | "r" | "freeze">;
export type MoteLight = Omit<AirLight, "freeze">;

/** Whether `l` lights the motes otherwise than `seen` did; `seen` takes its values. */
export function relit(seen: MoteLight, l: AirLight): boolean {
  "worklet";
  if (seen.lx === l.lx && seen.ly === l.ly && seen.level === l.level && seen.f === l.f && seen.r === l.r) return false;
  seen.lx = l.lx;
  seen.ly = l.ly;
  seen.level = l.level;
  seen.f = l.f;
  seen.r = l.r;
  return true;
}

export function createAir(rng: Rng): Air {
  const R = (a: number, b: number) => a + rng() * (b - a);
  const m = new Float64Array(MOTES * MOTE_STRIDE);
  for (let i = 0; i < MOTES; i++) m.set([R(70, 860), R(10, 392), R(0.4, 1.7), R(-5, 5), R(-4, 2), R(0, TAU)], i * MOTE_STRIDE);
  return { t: 0, m, mothAt: R(6, 10), mothT: -1 };
}

/** Steps the air `dt` seconds; true when a moth sets off. Under reduced motion nothing moves and no moth flies. */
export function stepAir(a: Air, dt: number, { freeze }: Pick<AirLight, "freeze">, reduced: boolean, rng: Rng): boolean {
  "worklet";
  if (reduced) {
    a.mothT = -1;
    return false;
  }
  a.t += dt;
  const run = 1 - freeze;
  const m = a.m;
  for (let o = 0; o < m.length; o += MOTE_STRIDE) {
    m[o + M.x] += (m[o + M.vx] * dt + Math.sin(a.t * 0.7 + m[o + M.ph]) * 3 * dt) * run;
    m[o + M.y] += m[o + M.vy] * dt * run;
    if (m[o + M.y] < 0) m[o + M.y] = DESIGN.height;
    if (m[o + M.y] > DESIGN.height) m[o + M.y] = 0;
    if (m[o + M.x] < 62) m[o + M.x] = 860;
    if (m[o + M.x] > 870) m[o + M.x] = 64;
  }
  if (run <= 0) return false;
  let set = false;
  if (a.mothT < 0 && a.t >= a.mothAt) {
    a.mothT = a.t;
    a.mothAt = a.t + 10 + rng() * 5;
    set = true;
  }
  if (a.mothT >= 0 && a.t - a.mothT > CROSSING_S) a.mothT = -1;
  return set;
}

export function moteAt(a: Air, i: number): { x: number; y: number; r: number } {
  "worklet";
  const o = i * MOTE_STRIDE;
  return { x: a.m[o + M.x], y: a.m[o + M.y], r: a.m[o + M.r] };
}

/** Mote `i`'s alpha, 0 where it is too faint to draw; the cone scales with the light's reach. */
export function moteAlpha(a: Air, i: number, l: AirLight): number {
  "worklet";
  const o = i * MOTE_STRIDE;
  const d = Math.hypot(a.m[o + M.x] - l.lx, (a.m[o + M.y] - l.ly) * 1.3);
  const lit = Math.max(0, 1 - d / ((300 + l.f * 200) * l.r)) * (0.5 + 0.5 * Math.sin(a.t * 1.3 + a.m[o + M.ph])) * l.level;
  return lit < UNSEEN ? 0 : lit * MOTE_ALPHA;
}

/** Ellipse radii: the two wings sit either side of `mx`, the shadow at `sx`, `sy` turned by `shadowRot`. */
export interface MothPose {
  mx: number;
  my: number;
  wing: number;
  wingRy: number;
  sx: number;
  sy: number;
  shadowRx: number;
  shadowRy: number;
  shadowRot: number;
}

export function mothPose(a: Air, l: AirLight): MothPose | null {
  "worklet";
  if (a.mothT < 0 || l.freeze >= 1) return null;
  const q = (a.t - a.mothT) / CROSSING_S;
  const mx = l.lx - 130 + q * 270 + Math.sin(q * 30) * 14;
  const my = l.ly - 50 + Math.cos(q * 23) * 18;
  return {
    mx,
    my,
    wing: (3 + Math.abs(Math.sin(a.t * 38)) * 4) / 2,
    wingRy: 2,
    sx: l.lx + (mx - l.lx) * 2.4,
    sy: l.ly + (my - l.ly) * 2.2 + 150,
    shadowRx: 16 + Math.abs(Math.sin(a.t * 40)) * 9,
    shadowRy: 6,
    shadowRot: 0.3,
  };
}
