// The turn hand-off's ember: `ember` in tests/e2e/fixtures/lantern-table/index.html, in that
// table's 874 × 402 points, run by either platform's particle layer one frame at a time.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { Ember } from "../../lib/tokens.ts";
import type { FlyDirection } from "../seatLayout.ts";
import type { ParticleSpawn, Rng } from "./particles.ts";

export const RIM = { cx: 465, cy: 201, rx: 385, ry: 182 } as const;
export const EMBER_MS = 380;
const ANGLE: Record<FlyDirection, number> = { bottom: 90, right: 0, top: -90, left: -180 };

/** The one run a layer holds: a new hand-off restarts it, so two embers never fly at once. `t` < 0 is idle. */
export interface EmberRun {
  a0: number;
  a1: number;
  t: number;
}

export function idleEmber(): EmberRun {
  return { a0: 0, a1: 0, t: -1 };
}

/**
 * The rim's angles, in degrees, from one seat to the next. They increase because the turn passes
 * clockwise on screen (`getNextActivePlayer`, `seatDirection`); the mockup's turn runs the other way.
 */
export function emberSweep(from: FlyDirection, to: FlyDirection): [number, number] {
  "worklet";
  const a0 = ANGLE[from];
  let a1 = ANGLE[to];
  while (a1 < a0) a1 += 360;
  return [a0, a1];
}

export function startEmber(run: EmberRun, from: FlyDirection, to: FlyDirection): void {
  "worklet";
  const [a0, a1] = emberSweep(from, to);
  run.a0 = a0;
  run.a1 = a1;
  run.t = 0;
}

/** This frame's head and trail spark, advancing `run` by `dt` seconds. */
export function emberFrame(run: EmberRun, dt: number, rng: Rng): ParticleSpawn[] {
  "worklet";
  if (run.t < 0) return [];
  const k = Math.min(1, (run.t * 1000) / EMBER_MS);
  run.t = k < 1 ? run.t + dt : -1;
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const a = ((run.a0 + (run.a1 - run.a0) * e) * Math.PI) / 180;
  const x = RIM.cx + RIM.rx * Math.cos(a);
  const y = RIM.cy + RIM.ry * Math.sin(a);
  const R = (lo: number, hi: number) => lo + rng() * (hi - lo);
  return [
    { x, y, life: 0.05, size: 2.4, col: Ember.head, glow: 10 },
    { x, y, vx: R(-15, 15), vy: R(-15, 15), drag: 0.9, life: R(0.25, 0.4), size: R(0.6, 1.3), col: Ember.trail, glow: 4 },
  ];
}
