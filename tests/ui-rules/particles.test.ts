import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  P,
  PARTICLE_BUDGET,
  STRIDE,
  alpha,
  createParticles,
  landDust,
  landingDustCount,
  rgba,
  spawn,
  step,
  type Particles,
} from "../../components/table/particles.ts";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DT = 1 / 60;
const PILE = [457, 222] as const;

function land(s: Particles, cards: number, seed: number) {
  const specs = landDust(cards, landingDustCount(cards), PILE[0], PILE[1], mulberry32(seed));
  for (const p of specs) spawn(s, p);
  return specs;
}

function trace(seed: number): number[] {
  const s = createParticles();
  land(s, 2, seed);
  const out: number[] = [];
  for (let k = 0; k < 90; k++) {
    step(s, DT);
    out.push(s.live, ...s.f.slice(0, s.live * STRIDE));
  }
  return out;
}

describe("the particle module", () => {
  test("a landing of n cards spawns 16 + 5n dust and 3 puffs, all live", () => {
    for (const cards of [1, 2, 3, 4]) {
      const s = createParticles();
      const specs = land(s, cards, cards);
      const dust = specs.filter((p) => p.shape !== "soft");
      assert.equal(dust.length, 16 + 5 * cards);
      assert.equal(specs.length - dust.length, 3);
      assert.equal(s.live, 16 + 5 * cards + 3);
      assert.equal(s.dropped, 0);
    }
  });

  test("the dust spreads over 30n + 40 around the pile, 70% of it from the pile's foot", () => {
    const specs = landDust(4, 4000, PILE[0], PILE[1], mulberry32(7), 0);
    const w = 4 * 30 + 40;
    for (const p of specs) assert.ok(Math.abs(p.x - PILE[0]) <= w / 2);
    const foot = specs.filter((p) => Math.abs(p.y - (PILE[1] + 46)) <= 3);
    assert.ok(Math.abs(foot.length / specs.length - 0.7) < 0.03, `${foot.length} of ${specs.length} from the foot`);
    for (const p of foot) assert.equal(Math.sign(p.vx!), Math.sign(p.x - PILE[0]), "thrown outward");
  });

  test("each particle lives its own life, then leaves", () => {
    const s = createParticles();
    const specs = land(s, 2, 3);
    const lives = specs.map((p) => p.life!);
    for (const [i, p] of specs.entries()) {
      const [lo, hi] = p.shape === "soft" ? [0.7, 1.1] : [0.5, 1.1];
      assert.ok(lives[i] >= lo && lives[i] <= hi, `life ${lives[i]}`);
    }
    let t = 0;
    for (let k = 0; k < 80; k++) {
      step(s, DT);
      t += DT;
      assert.equal(s.live, lives.filter((l) => Math.fround(l) - t > 1e-6).length, `live at ${t.toFixed(3)} s`);
    }
    assert.equal(s.live, 0);
  });

  test("one step integrates drag per 60 fps frame, then gravity, then position", () => {
    const s = createParticles();
    spawn(s, { x: 10, y: 20, vx: 30, vy: -40, g: -6, drag: 0.92, life: 1 });
    step(s, 0.1);
    // 0.92^6 = 0.6063550...
    const near = (field: keyof typeof P, want: number) => assert.ok(Math.abs(s.f[P[field]] - want) < 1e-4, `${field} ${s.f[P[field]]}, want ${want}`);
    near("vx", 18.190651);
    near("vy", -24.854202);
    near("x", 11.819065);
    near("y", 17.514580);
    near("life", 0.9);
    assert.equal(alpha(s.f, 0), 1);
    step(s, 0.4);
    near("life", 0.5);
    assert.ok(Math.abs(alpha(s.f, 0) - 0.75) < 1e-6, "the fade is life / max × 1.5");
  });

  test("a colour carries its own alpha into the particle's", () => {
    assert.deepEqual(rgba("#ffe2a8"), [1, 0xe2 / 255, 0xa8 / 255, 1]);
    const [, , , a] = rgba("rgba(230,215,180,.1)");
    assert.equal(a, 0.1);
    const s = createParticles();
    spawn(s, { x: 0, y: 0, life: 1, col: "rgba(230,215,180,.1)" });
    assert.ok(Math.abs(alpha(s.f, 0) - 0.1) < 1e-6);
  });

  test("250 requested gives 200 live and 50 dropped, evicting nothing and never growing the pool", () => {
    const s = createParticles();
    const size = s.f.length;
    for (let i = 0; i < 250; i++) spawn(s, { x: i, y: 0, life: 1 });
    assert.equal(PARTICLE_BUDGET, 200);
    assert.equal(s.live, 200);
    assert.equal(s.dropped, 50);
    assert.equal(s.f.length, size);
    const xs = Array.from({ length: s.live }, (_, i) => s.f[i * STRIDE + P.x]).sort((a, b) => a - b);
    assert.deepEqual(xs, Array.from({ length: 200 }, (_, i) => i), "the first 200 are the ones kept");
  });

  test("the same seed gives the same trace, and another seed another", () => {
    assert.deepEqual(trace(1258), trace(1258));
    assert.notDeepEqual(trace(1258), trace(1259));
  });
});
