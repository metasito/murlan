import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bombFx, createParticles, landingDust, spawn } from "../../components/table/particles.ts";
import { MOTES } from "../../components/table/air.ts";
import { BombFx } from "../../lib/tokens.ts";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PILE = [457, 222] as const;
const bomb = { cards: 4, x: PILE[0], y: PILE[1] };
const within = (v: number | undefined, lo: number, hi: number) => v !== undefined && v >= lo - 1e-9 && v <= hi + 1e-9;

describe("the bomb's sparks and embers (#1263)", () => {
  test("fires 90 ms after the landing, the mockup's `later(90, bombFx)`", () => {
    assert.equal(BombFx.delayMs, 90);
  });

  test("one call throws 48 sparks at three cycling sizes and colours, and 18 embers", () => {
    const specs = bombFx(bomb, false, 1, 1, mulberry32(1));
    const sparks = specs.filter((p) => p.shape === "spark");
    const embers = specs.filter((p) => p.shape !== "spark");
    assert.equal(sparks.length, 48);
    assert.equal(embers.length, 18);
    sparks.forEach((p, i) => {
      assert.equal(p.size, [1, 1.8, 2.8][i % 3]);
      assert.equal(p.col?.toLowerCase(), ["#ffd27a", "#ffb347", "#fff1c8"][i % 3]);
    });
  });

  test("the sparks fly from the pile's centre ± 20 at 160–540 plus 120 upward, and fall", () => {
    for (const seed of [1, 2, 3]) {
      for (const p of bombFx(bomb, false, 1, 1, mulberry32(seed)).filter((s) => s.shape === "spark")) {
        assert.ok(within(p.x, PILE[0] - 20, PILE[0] + 20) && within(p.y, PILE[1] - 20, PILE[1] + 20));
        const speed = Math.hypot(p.vx ?? 0, (p.vy ?? 0) + 120);
        assert.ok(within(speed, 160, 540), `speed ${speed}`);
        assert.equal(p.g, 520);
        assert.equal(p.drag, 0.965);
        assert.ok(within(p.life, 0.5, 1.2));
      }
    }
  });

  test("the embers rise from x ± 40 at the pile's centre, slow and long-lived, glowing", () => {
    for (const seed of [1, 2, 3]) {
      for (const p of bombFx(bomb, false, 1, 1, mulberry32(seed)).filter((s) => s.shape !== "spark")) {
        assert.ok(within(p.x, PILE[0] - 40, PILE[0] + 40));
        assert.equal(p.y, PILE[1]);
        assert.ok(within(p.vx, -30, 30) && within(p.vy, -90, -30));
        assert.equal(p.g, -10);
        assert.equal(p.drag, 0.985);
        assert.ok(within(p.life, 1.5, 2.6) && within(p.size, 1, 2));
        assert.equal(p.col?.toLowerCase(), "#ff9a4a");
        assert.equal(p.glow, 6);
      }
    }
  });

  test("lands in design points, scaled by the layer's sx/sy like the landing dust", () => {
    const scaled = bombFx({ x: PILE[0] * 2, y: PILE[1] * 2 }, false, 2, 2, mulberry32(4));
    assert.deepEqual(scaled, bombFx(bomb, false, 1, 1, mulberry32(4)));
  });

  test("a bomb's landing dust and beat together peak at no more than 160 live, motes included, dropping none", () => {
    const s = createParticles();
    for (const p of landingDust({ ...bomb, catchUp: false }, false, 1, 1, mulberry32(5))) spawn(s, p);
    for (const p of bombFx(bomb, false, 1, 1, mulberry32(6))) spawn(s, p);
    assert.equal(s.live, 36 + 3 + 48 + 18);
    assert.ok(s.live + MOTES <= 160);
    assert.equal(s.dropped, 0);
  });

  test("reduced motion throws nothing", () => {
    assert.deepEqual(bombFx(bomb, true, 1, 1, mulberry32(1)), []);
  });
});
