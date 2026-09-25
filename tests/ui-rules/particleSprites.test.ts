import { test } from "node:test";
import assert from "node:assert/strict";
import { createParticles, spawn } from "../../components/table/particles.ts";
import { CELLS, D, DRAW_STRIDE, SHEET, SPRITE_R, layout } from "../../components/table/particleSprites.ts";

function drawOf(p: Parameters<typeof spawn>[1]) {
  const s = createParticles(1);
  spawn(s, p);
  const out = new Float32Array(DRAW_STRIDE);
  layout(s, out);
  const at = (u: number, v: number) => ({
    x: out[D.scos] * u - out[D.ssin] * v + out[D.tx],
    y: out[D.ssin] * u + out[D.scos] * v + out[D.ty],
  });
  const cell = CELLS.find((c) => c.x === out[D.x] && c.y === out[D.y])!;
  return { out, at, cell };
}

const close = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-3, `${msg}: ${a} against ${b}`);

test("the cells tile the sheet without overlapping", () => {
  for (const [i, a] of CELLS.entries()) {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= SHEET.width && a.y + a.h <= SHEET.height, `cell ${i} off the sheet`);
    for (const b of CELLS.slice(i + 1)) {
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `${a.shape}/${a.glow} overlaps ${b.shape}/${b.glow}`);
    }
  }
});

test("a dot's sprite centre lands on the particle, scaled to its radius", () => {
  const { out, at, cell } = drawOf({ x: 300, y: 120, size: 1.5, glow: 5, col: "#ffe2a8" });
  assert.equal(cell.shape, "dot");
  assert.equal(cell.glow, 5);
  const c = at(cell.cx, cell.cy);
  close(c.x, 300, "x");
  close(c.y, 120, "y");
  const edge = at(cell.cx + SPRITE_R, cell.cy);
  close(edge.x - c.x, 1.5, "radius");
  close(out[D.r], 1, "red");
  close(out[D.a], 1, "alpha at birth");
});

test("a glow takes the nearest baked radius", () => {
  assert.equal(drawOf({ x: 0, y: 0, glow: 7 }).cell.glow, 6);
  assert.equal(drawOf({ x: 0, y: 0, glow: 9 }).cell.glow, 10);
});

test("a spark runs from its head back along −v·0.035, as wide as its size", () => {
  const { out, at, cell } = drawOf({ x: 200, y: 100, vx: 120, vy: -50, size: 2, shape: "spark" });
  assert.equal(cell.shape, "spark");
  const head = at(cell.cx, cell.cy);
  close(head.x, 200, "head x");
  close(head.y, 100, "head y");
  const len = Math.hypot(120, -50) * 0.035;
  const scale = Math.hypot(out[D.scos], out[D.ssin]);
  const tail = at(cell.cx + len / scale, cell.cy);
  close(tail.x, 200 - 120 * 0.035, "tail x");
  close(tail.y, 100 + 50 * 0.035, "tail y");
  close(scale * 2 * SPRITE_R, 2, "width");
  close(out[D.w], cell.cx + len / scale + SPRITE_R, "sprite cut past the tail's cap");
});

test("a soft puff carries its colour's own alpha", () => {
  const { out, cell } = drawOf({ x: 0, y: 0, size: 12, col: "rgba(230,215,180,.1)", shape: "soft" });
  assert.equal(cell.shape, "soft");
  close(out[D.a], 0.1, "alpha");
});
