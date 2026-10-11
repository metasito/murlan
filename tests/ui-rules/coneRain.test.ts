import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { coneRainFrame, idleRain, startRain } from "../../components/table/coneRain.ts";
import { bombFx, createParticles, landingDust, mancheMotes, PARTICLE_BUDGET, spawn, step, type ParticleSpawn } from "../../components/table/particles.ts";
import { MOTES } from "../../components/table/air.ts";
import { BombFx, ConeRain, MancheMoment } from "../../lib/tokens.ts";

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
const within = (v: number | undefined, lo: number, hi: number) => v !== undefined && v >= lo - 1e-9 && v <= hi + 1e-9;

/** Every frame's spawns over `sec`, with the time each frame began. */
function rainOver(sec: number, lampAt: (t: number) => { lx: number; ly: number }, seed = 1) {
  const run = idleRain();
  startRain(run);
  const out: { t: number; p: ParticleSpawn; lamp: { lx: number; ly: number } }[] = [];
  const rng = mulberry32(seed);
  for (let t = 0; t < sec; t += DT) {
    const lamp = lampAt(t);
    for (const p of coneRainFrame(run, lamp, DT, rng)) out.push({ t, p, lamp });
  }
  return { out, run };
}

describe("a won partita's rain through the lamp's cone (#1423)", () => {
  test("an idle run rains nothing", () => {
    assert.deepEqual(coneRainFrame(idleRain(), { lx: 457, ly: 252 }, DT, mulberry32(1)), []);
  });

  test("60 motes, one every 20 ms over 1.2 s, then the run is idle", () => {
    const { out, run } = rainOver(2, () => ({ lx: 457, ly: 252 }));
    assert.equal(out.length, ConeRain.motes);
    assert.equal(ConeRain.motes, 60);
    assert.equal(ConeRain.overMs, 1200);
    out.forEach(({ t }, i) => {
      const due = (i * ConeRain.overMs) / ConeRain.motes / 1000;
      assert.ok(t <= due + 1e-9 && due <= t + DT + 1e-9, `mote ${i} in the frame from ${t}, due ${due}`);
    });
    assert.ok(out.at(-1)!.t < 1.2, `last at ${out.at(-1)!.t}`);
    assert.ok(run.t < 0, "still running after the last mote");
  });

  test("each mote within the mockup's ranges, above the light point of its own frame", () => {
    const { out } = rainOver(2, (t) => ({ lx: 400 + t * 100, ly: 250 - t * 20 }), 7);
    out.forEach(({ p, lamp }, i) => {
      assert.ok(within(p.x - lamp.lx, -130, 130), `x ${p.x - lamp.lx}`);
      assert.ok(within(lamp.ly - p.y, 40, 130), `y ${lamp.ly - p.y}`);
      assert.ok(within(p.vx, -8, 8), `vx ${p.vx}`);
      assert.ok(within(p.vy, 30, 70), `vy ${p.vy}`);
      assert.equal(p.g, 12);
      assert.equal(p.drag, 0.99);
      assert.ok(within(p.life, 1.3, 2), `life ${p.life}`);
      assert.ok(within(p.size, 0.8, 1.8), `size ${p.size}`);
      assert.equal(p.col, MancheMoment.golds[i % 3]);
      assert.equal(p.glow, 5);
    });
    const xs = new Set(out.map(({ lamp }) => lamp.lx));
    assert.ok(xs.size > 30, "the lamp moved, so the motes must follow it");
  });

  test("a restart while raining begins again from the first mote", () => {
    const run = idleRain();
    startRain(run);
    const rng = mulberry32(3);
    let n = 0;
    for (let t = 0; t < 0.5; t += DT) n += coneRainFrame(run, { lx: 457, ly: 252 }, DT, rng).length;
    startRain(run);
    for (let t = 0; t < 2; t += DT) n += coneRainFrame(run, { lx: 457, ly: 252 }, DT, rng).length;
    assert.ok(n > ConeRain.motes, `${n}`);
  });
});

describe("a bomb that ends a won partita shares one particle budget (#1423)", () => {
  test("the cap drops late rain; the dust, the seat's burst and the bomb all land whole", () => {
    const seat = { x: 457, y: 372 };
    const pile = { x: 457, y: 201 };
    const rng = mulberry32(11);
    const s = createParticles();
    const dropped: Record<string, number> = { dust: 0, burst: 0, bomb: 0, rain: 0 };
    const put = (from: string, ps: readonly ParticleSpawn[]) => {
      for (const p of ps) if (!spawn(s, p)) dropped[from]++;
    };
    const lamp = { lx: 457, ly: 252 };
    const run = idleRain();
    let peak = 0;
    let bombed = false;

    put("dust", landingDust({ catchUp: false, cards: 4, ...pile }, false, 1, 1, rng));
    const burst = mancheMotes("won", seat, false, 1, 1, rng);
    assert.equal(burst.length, MancheMoment.motes.won);
    put("burst", burst);
    startRain(run);
    for (let t = 0; t < 2.5; t += DT) {
      if (!bombed && t * 1000 >= BombFx.delayMs) {
        bombed = true;
        put("bomb", bombFx(pile, false, 1, 1, rng));
      }
      put("rain", coneRainFrame(run, lamp, DT, rng));
      step(s, DT);
      peak = Math.max(peak, s.live + MOTES);
    }

    assert.ok(bombed);
    assert.ok(peak <= PARTICLE_BUDGET, `peak ${peak}`);
    assert.equal(peak, PARTICLE_BUDGET, "the budget was never reached, so nothing was capped");
    assert.deepEqual({ dust: dropped.dust, burst: dropped.burst, bomb: dropped.bomb }, { dust: 0, burst: 0, bomb: 0 });
    assert.ok(dropped.rain > 0, "no rain was dropped");
    assert.equal(s.dropped, dropped.rain);
  });
});
