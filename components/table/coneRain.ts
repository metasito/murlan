// A won partita's rain: `coneRain` in tests/e2e/fixtures/lantern-table/index.html, in that table's
// 874 × 402 points, run by either platform's particle layer one frame at a time.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { ConeRain, MancheMoment } from "../../lib/tokens.ts";
import type { Lamp } from "./lampRig.ts";
import type { ParticleSpawn, Rng } from "./particles.ts";

/** The one run a layer holds. `t` < 0 is idle; `n` motes have fallen. */
export interface RainRun {
  t: number;
  n: number;
}

export function idleRain(): RainRun {
  return { t: -1, n: 0 };
}

export function startRain(run: RainRun): void {
  "worklet";
  run.t = 0;
  run.n = 0;
}

/**
 * The motes due by this frame, advancing `run` by `dt` seconds. Each starts above the light point
 * of the frame it falls in, as the mockup's `later` reads `lamp.lx` when it fires.
 */
export function coneRainFrame(run: RainRun, lamp: Pick<Lamp, "lx" | "ly">, dt: number, rng: Rng): ParticleSpawn[] {
  "worklet";
  if (run.t < 0) return [];
  const C = ConeRain;
  const due = Math.min(C.motes, Math.ceil(((run.t + dt) * 1000 * C.motes) / C.overMs));
  const R = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const out: ParticleSpawn[] = [];
  for (; run.n < due; run.n++) {
    out.push({
      x: lamp.lx + R(-C.halfWidth, C.halfWidth),
      y: lamp.ly - R(C.above[0], C.above[1]),
      vx: R(-C.vx, C.vx),
      vy: R(C.vy[0], C.vy[1]),
      g: C.g,
      drag: C.drag,
      life: R(C.lifeSec[0], C.lifeSec[1]),
      size: R(C.size[0], C.size[1]),
      col: MancheMoment.golds[run.n % 3],
      glow: MancheMoment.glow,
    });
  }
  run.t = run.n < C.motes ? run.t + dt : -1;
  return out;
}
