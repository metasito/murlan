// What the web's burst canvas steps and draws from: the particles, the ember and the rain, none of the air. The air at rest
// is moteLayer's; native keeps its own in particleSprites.ts.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { createParticles, PARTICLE_BUDGET, spawn, step, type Particles, type Rng } from "./particles.ts";
import { coneRainFrame, idleRain, type RainRun } from "./coneRain.ts";
import { emberFrame, idleEmber, type EmberRun } from "./ember.ts";
import { DRAW_STRIDE, layout } from "./particleSprites.ts";
import type { Lamp } from "./lampRig.ts";

export interface BurstScene {
  s: Particles;
  d: Float32Array;
  ember: EmberRun;
  rain: RainRun;
}

export function createBurstScene(): BurstScene {
  return { s: createParticles(), d: new Float32Array(PARTICLE_BUDGET * DRAW_STRIDE), ember: idleEmber(), rain: idleRain() };
}

/** Nothing is flying: no particle live, no ember or rain still to throw. */
export function burstIdle(v: BurstScene): boolean {
  "worklet";
  return !v.s.live && v.ember.t < 0 && v.rain.t < 0;
}

/** Steps the scene `dt` seconds and lays it out into `v.d`. */
export function stepBurst(v: BurstScene, l: Pick<Lamp, "lx" | "ly">, dt: number, rng: Rng): void {
  "worklet";
  for (const p of emberFrame(v.ember, dt, rng)) spawn(v.s, p);
  for (const p of coneRainFrame(v.rain, l, dt, rng)) spawn(v.s, p);
  step(v.s, dt);
  layout(v.s, v.d);
}
