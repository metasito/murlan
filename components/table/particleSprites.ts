// The sprite sheet both particle layers draw from, and where each live particle lands on it. One
// white sprite per shape and glow radius, tinted per particle, so nothing is blurred per frame.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { alpha, createParticles, P, PARTICLE_BUDGET, rgba, SHAPES, spawn, step, STRIDE, type ParticleShape, type Particles, type Rng } from "./particles.ts";
import { createAir, M, MOTE_STRIDE, MOTES, moteAlpha, mothPose, relit, stepAir, type Air, type AirLight, type MothPose, type MoteLight } from "./air.ts";
import { coneRainFrame, idleRain, type RainRun } from "./coneRain.ts";
import { emberFrame, idleEmber, type EmberRun } from "./ember.ts";
import type { Lamp } from "./lampRig.ts";
import { RestAir } from "../../lib/tokens.ts";

/** A dot's or a soft puff's radius on the sheet, and a spark's half-width. */
export const SPRITE_R = 6;
/** The glow radii the moments use, in table points; a particle takes the nearest. */
export const GLOWS = [0, 4, 5, 6, 10] as const;
/** A spark's longest line on the sheet, past its cap. */
export const SPARK_LEN = 128;

/** Baked for a particle of size 1, so a glow's halo scales with the particle it surrounds. */
const pad = (glow: number) => Math.ceil(glow * SPRITE_R);
const ROW_H = 2 * (SPRITE_R + pad(GLOWS[GLOWS.length - 1]));
const ROWS: Record<ParticleShape, number> = { dot: 0, soft: 1, spark: 2 };

export interface Cell {
  shape: ParticleShape;
  glow: number;
  /** The sprite's top-left on the sheet, and its centre — a spark's head — within it. */
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/** Indexed `shape × GLOWS.length + glow`, in `SHAPES`' order. */
export const CELLS: readonly Cell[] = SHAPES.flatMap((shape) => {
  let x = 0;
  return GLOWS.map((glow) => {
    const c = SPRITE_R + pad(glow);
    const w = 2 * c + (shape === "spark" ? SPARK_LEN : 0);
    const cell = { shape, glow, x, y: ROWS[shape] * ROW_H + ROW_H / 2 - c, w, h: 2 * c, cx: c, cy: c };
    x += w;
    return cell;
  });
});

export const SHEET = {
  width: Math.max(...CELLS.map((c) => c.x + c.w)),
  height: 3 * ROW_H,
};

function nearestGlow(glow: number): number {
  "worklet";
  let best = 0;
  for (let i = 1; i < GLOWS.length; i++) if (Math.abs(GLOWS[i] - glow) < Math.abs(GLOWS[best] - glow)) best = i;
  return best;
}

/** One live particle's draw: `sprite` rect on the sheet, its RSXform, its tint and alpha 0–1. */
export const D = { x: 0, y: 1, w: 2, h: 3, scos: 4, ssin: 5, tx: 6, ty: 7, r: 8, g: 9, b: 10, a: 11 } as const;
export const DRAW_STRIDE = 12;

/** Writes each live particle's draw into `out`, in table points, following `stepP`'s shapes. */
export function layout(s: Particles, out: Float32Array): void {
  "worklet";
  const f = s.f;
  for (let i = 0; i < s.live; i++) {
    const o = i * STRIDE;
    const d = i * DRAW_STRIDE;
    const cell = CELLS[f[o + P.shape] * GLOWS.length + nearestGlow(f[o + P.glow])];
    const size = f[o + P.size];
    let scale = size / SPRITE_R;
    let angle = 0;
    let w = cell.w;
    if (cell.shape === "spark") {
      scale = size / (2 * SPRITE_R);
      const vx = f[o + P.vx];
      const vy = f[o + P.vy];
      angle = Math.atan2(-vy, -vx);
      w = Math.min(cell.w, cell.cx + (Math.hypot(vx, vy) * 0.035) / scale + SPRITE_R);
    }
    const scos = scale * Math.cos(angle);
    const ssin = scale * Math.sin(angle);
    out[d + D.x] = cell.x;
    out[d + D.y] = cell.y;
    out[d + D.w] = w;
    out[d + D.h] = cell.h;
    out[d + D.scos] = scos;
    out[d + D.ssin] = ssin;
    out[d + D.tx] = f[o + P.x] - (scos * cell.cx - ssin * cell.cy);
    out[d + D.ty] = f[o + P.y] - (ssin * cell.cx + scos * cell.cy);
    out[d + D.r] = f[o + P.r];
    out[d + D.g] = f[o + P.gr];
    out[d + D.b] = f[o + P.b];
    out[d + D.a] = alpha(f, o);
  }
}

const MOTE_CELL = CELLS[SHAPES.indexOf("dot") * GLOWS.length];
const [MOTE_R, MOTE_G, MOTE_B] = rgba(RestAir.mote);

/** Writes the motes' draws into `out` from draw `from` on, and returns how many are lit: an unlit one draws at alpha 0. */
export function layoutMotes(a: Air, l: AirLight, out: Float32Array, from: number): number {
  "worklet";
  let lit = 0;
  for (let i = 0; i < MOTES; i++) {
    const d = (from + i) * DRAW_STRIDE;
    const o = i * MOTE_STRIDE;
    const scale = a.m[o + M.r] / SPRITE_R;
    out[d + D.x] = MOTE_CELL.x;
    out[d + D.y] = MOTE_CELL.y;
    out[d + D.w] = MOTE_CELL.w;
    out[d + D.h] = MOTE_CELL.h;
    out[d + D.scos] = scale;
    out[d + D.ssin] = 0;
    out[d + D.tx] = a.m[o + M.x] - scale * MOTE_CELL.cx;
    out[d + D.ty] = a.m[o + M.y] - scale * MOTE_CELL.cy;
    out[d + D.r] = MOTE_R;
    out[d + D.g] = MOTE_G;
    out[d + D.b] = MOTE_B;
    out[d + D.a] = moteAlpha(a, i, l);
    if (out[d + D.a] > 0) lit++;
  }
  return lit;
}

/** Everything one frame of the particle layer steps and draws from; both adapters hold one. */
export interface Scene {
  s: Particles;
  d: Float32Array;
  air: Air;
  lit: number;
  shown: number;
  light: MoteLight;
  ember: EmberRun;
  rain: RainRun;
  moth: MothPose | null;
}

export function createScene(rng: Rng): Scene {
  return {
    s: createParticles(),
    d: new Float32Array(PARTICLE_BUDGET * DRAW_STRIDE),
    air: createAir(rng),
    lit: 0,
    shown: 0,
    light: { lx: NaN, ly: NaN, level: NaN, f: NaN, r: NaN },
    ember: idleEmber(),
    rain: idleRain(),
    moth: null,
  };
}

/** Nothing is flying or was drawn last frame. */
export function sceneIdle(v: Scene): boolean {
  "worklet";
  return !v.s.live && !v.shown && v.ember.t < 0 && v.rain.t < 0;
}

/** Idle, and nothing in the air moves or relights: a frame would draw what the last one did. */
export function sceneAsleep(v: Scene, l: Lamp, still: boolean): boolean {
  "worklet";
  return sceneIdle(v) && still && v.air.mothT < 0 && !relit(v.light, l);
}

/** Steps the scene `dt` seconds and lays it out into `v.d`; true when a moth sets off. */
export function stepScene(v: Scene, l: Lamp, dt: number, still: boolean, rng: Rng): boolean {
  "worklet";
  for (const p of emberFrame(v.ember, dt, rng)) spawn(v.s, p);
  for (const p of coneRainFrame(v.rain, l, dt, rng)) spawn(v.s, p);
  step(v.s, dt);
  const onset = stepAir(v.air, dt, l, still, rng);
  layout(v.s, v.d);
  v.lit = layoutMotes(v.air, l, v.d, v.s.live);
  relit(v.light, l);
  v.shown = v.s.live;
  v.moth = mothPose(v.air, l);
  return onset;
}
