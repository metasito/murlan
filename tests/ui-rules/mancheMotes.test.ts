import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mancheMotes } from "../../components/table/particles.ts";
import { MancheMoment } from "../../lib/tokens.ts";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEAT = { x: 457, y: 372 };
const within = (v: number | undefined, lo: number, hi: number) => v !== undefined && v >= lo - 1e-9 && v <= hi + 1e-9;

describe("a manche's motes at the winner's seat (#1469)", () => {
  test("a win throws 46, a loss and a neutral finish 20, a draw and a pending outcome none", () => {
    const rng = mulberry32(1);
    assert.equal(mancheMotes("won", SEAT, false, 1, 1, rng).length, 46);
    assert.equal(mancheMotes("lost", SEAT, false, 1, 1, rng).length, 20);
    assert.equal(mancheMotes("neutral", SEAT, false, 1, 1, rng).length, 20);
    assert.equal(mancheMotes("draw", SEAT, false, 1, 1, rng).length, 0);
    assert.equal(mancheMotes("pending", SEAT, false, 1, 1, rng).length, 0);
  });

  test("reduced motion throws none", () => {
    assert.equal(mancheMotes("won", SEAT, true, 1, 1, mulberry32(1)).length, 0);
    assert.equal(mancheMotes("lost", SEAT, true, 1, 1, mulberry32(1)).length, 0);
  });

  for (const [outcome, big] of [["won", 1], ["lost", 0.7]] as const) {
    test(`${outcome}: from a 14 pt ring, outward at ${30 * big}–${150 * big}, rising, glowing gold`, () => {
      for (const seed of [1, 2, 3]) {
        mancheMotes(outcome, SEAT, false, 1, 1, mulberry32(seed)).forEach((p, i) => {
          const dx = p.x - SEAT.x;
          const dy = p.y - SEAT.y;
          assert.ok(within(Math.hypot(dx, dy), 14, 14), `ring ${Math.hypot(dx, dy)}`);
          const speed = Math.hypot(p.vx ?? 0, p.vy ?? 0);
          assert.ok(within(speed, 30 * big, 150 * big), `speed ${speed}`);
          assert.ok((p.vx ?? 0) * dx + (p.vy ?? 0) * dy > 0, "outward");
          assert.equal(p.g, -14);
          assert.equal(p.drag, 0.95);
          assert.ok(within(p.life, 0.9, 1.8), `life ${p.life}`);
          assert.ok(within(p.size, 0.6 * big, 1.8 * big), `size ${p.size}`);
          assert.equal(p.col?.toLowerCase(), ["#ffe2a8", "#e9c46a", "#fff6d8"][i % 3]);
          assert.equal(p.glow, 5);
        });
      }
    });
  }

  test("the colours are one token object", () => {
    assert.deepEqual(MancheMoment.golds.map((c) => c.toLowerCase()), ["#ffe2a8", "#e9c46a", "#fff6d8"]);
  });

  test("the seat is in layer pixels and the motes in design points", () => {
    const [p] = mancheMotes("won", { x: SEAT.x * 2, y: SEAT.y * 3 }, false, 2, 3, mulberry32(1));
    assert.ok(within(Math.hypot(p.x - SEAT.x, p.y - SEAT.y), 14, 14));
  });
});
