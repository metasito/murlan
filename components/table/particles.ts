// The one particle simulation every table moment spawns into (#1252 § Particles). Its numbers are
// `sp`, `stepP` and `landDust` in tests/e2e/fixtures/lantern-table/index.html, in that table's
// 874 × 402 points. It draws nothing, and game information never passes through it.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

export type ParticleShape = "dot" | "spark" | "soft";
export const SHAPES: readonly ParticleShape[] = ["dot", "spark", "soft"];

export interface ParticleSpawn {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  g?: number;
  /** Per 60 fps frame. */
  drag?: number;
  life?: number;
  size?: number;
  /** `#rrggbb` or `rgba(r,g,b,a)`. */
  col?: string;
  shape?: ParticleShape;
  glow?: number;
}

/** The 40 ambient motes included. */
export const PARTICLE_BUDGET = 200;

/** Offsets into one particle's `STRIDE` floats of `Particles.f`; `shape` indexes `SHAPES`, `r`…`a` are 0–1. */
export const P = { x: 0, y: 1, vx: 2, vy: 3, g: 4, drag: 5, life: 6, max: 7, size: 8, glow: 9, shape: 10, r: 11, gr: 12, b: 13, a: 14 } as const;
export const STRIDE = 15;

/** The live particles are `f`'s first `live × STRIDE` floats, in no particular order. */
export interface Particles {
  live: number;
  dropped: number;
  readonly f: Float32Array;
}

export type Rng = () => number;

/** What a draw layer hands its owner: the one way into its simulation. */
export interface ParticleEmitter {
  emit(spawns: readonly ParticleSpawn[]): void;
}

export function createParticles(budget: number = PARTICLE_BUDGET): Particles {
  return { live: 0, dropped: 0, f: new Float32Array(budget * STRIDE) };
}

export function rgba(col: string): [number, number, number, number] {
  "worklet";
  if (col[0] === "#") {
    const n = parseInt(col.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const [r, g, b, a = 1] = col.slice(col.indexOf("(") + 1, -1).split(",").map(Number);
  return [r / 255, g / 255, b / 255, a];
}

/** Over the budget the spawn is dropped and counted: a live particle is never evicted. */
export function spawn(s: Particles, p: ParticleSpawn): boolean {
  "worklet";
  if ((s.live + 1) * STRIDE > s.f.length) {
    s.dropped++;
    return false;
  }
  const f = s.f;
  const o = s.live * STRIDE;
  const [r, g, b, a] = rgba(p.col ?? "#ffffff");
  const life = p.life || 1;
  f[o + P.x] = p.x;
  f[o + P.y] = p.y;
  f[o + P.vx] = p.vx ?? 0;
  f[o + P.vy] = p.vy ?? 0;
  f[o + P.g] = p.g ?? 0;
  f[o + P.drag] = p.drag ?? 1;
  f[o + P.life] = life;
  f[o + P.max] = life;
  f[o + P.size] = p.size ?? 2;
  f[o + P.glow] = p.glow ?? 0;
  f[o + P.shape] = SHAPES.indexOf(p.shape ?? "dot");
  f[o + P.r] = r;
  f[o + P.gr] = g;
  f[o + P.b] = b;
  f[o + P.a] = a;
  s.live++;
  return true;
}

export function step(s: Particles, dt: number): void {
  "worklet";
  const f = s.f;
  for (let i = s.live - 1; i >= 0; i--) {
    const o = i * STRIDE;
    f[o + P.life] -= dt;
    if (f[o + P.life] <= 0) {
      s.live--;
      f.copyWithin(o, s.live * STRIDE, (s.live + 1) * STRIDE);
      continue;
    }
    const dr = Math.pow(f[o + P.drag], dt * 60);
    f[o + P.vx] *= dr;
    f[o + P.vy] = f[o + P.vy] * dr + f[o + P.g] * dt;
    f[o + P.x] += f[o + P.vx] * dt;
    f[o + P.y] += f[o + P.vy] * dt;
  }
}

/** The particle at float offset `o`: its fade over its last two thirds, times its colour's own alpha. */
export function alpha(f: Float32Array, o: number): number {
  "worklet";
  return Math.min(1, (f[o + P.life] / f[o + P.max]) * 1.5) * f[o + P.a];
}

export const landingDustCount = (cards: number): number => 16 + 5 * cards;

const TAU = Math.PI * 2;
const PILE_FOOT = 46;

/** A landing of `cards` around the pile's centre: 70% thrown outward along the felt from its foot, and soft puffs. */
export function landDust(cards: number, count: number, x0: number, y0: number, rng: Rng, puffs = 3): ParticleSpawn[] {
  const R = (a: number, b: number) => a + rng() * (b - a);
  const w = cards * 30 + 40;
  const out: ParticleSpawn[] = [];
  for (let i = 0; i < count; i++) {
    const side = rng() < 0.7;
    const x = x0 + R(-w / 2, w / 2);
    const y = side ? y0 + PILE_FOOT + R(-3, 3) : y0 + R(-40, 40);
    const a = side ? R(-0.4, 0.4) + (x < x0 ? Math.PI * 0.95 : Math.PI * 0.05) : R(0, TAU);
    const s = R(18, 70);
    const vy = Math.sin(a) * s * 0.4 - R(4, 14);
    out.push({ x, y, vx: Math.cos(a) * s, vy, g: -6, drag: 0.92, life: R(0.5, 1.1), size: R(0.35, 1.1), col: "#ffe2a8" });
  }
  for (let i = 0; i < puffs; i++) {
    const x = x0 + R(-w / 2, w / 2);
    const vx = R(-20, 20);
    const vy = R(-10, 0);
    out.push({ x, y: y0 + 44, vx, vy, drag: 0.95, life: R(0.7, 1.1), size: R(10, 18), col: "rgba(230,215,180,.1)", shape: "soft" });
  }
  return out;
}
