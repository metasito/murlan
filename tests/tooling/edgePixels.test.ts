import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodePng } from "../../tools/ci/feltPixels.mjs";
import { SOFT_MIN, edgeVerdict } from "../../tools/ci/edgePixels.mjs";

const W = 160;
const H = 160;
const FACE = [254, 252, 246];
const EDGE = [181, 174, 159];
const BORDER = 3;
const SAMPLES = 8;

const felt = (x: number, y: number) => [0, 36 + ((x * 7 + y * 3) % 42), 21 + ((x * 5 + y) % 24)];

function card(degrees: number, antialiased: boolean) {
  const [cx, cy, hw, hh] = [W / 2, H / 2, 45, 60];
  const [cos, sin] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
  const paint = (px: number, py: number) => {
    const [dx, dy] = [px - cx, py - cy];
    const [u, v] = [Math.abs(dx * cos + dy * sin), Math.abs(-dx * sin + dy * cos)];
    if (u > hw || v > hh) return null;
    return u > hw - BORDER || v > hh - BORDER ? EDGE : FACE;
  };
  const data = new Uint8Array(W * H * 4);
  const offsets = antialiased ? Array.from({ length: SAMPLES }, (_, i) => (i + 0.5) / SAMPLES) : [0.5];
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) {
      const sum = [0, 0, 0];
      for (const oy of offsets)
        for (const ox of offsets) {
          const colour = paint(x + ox, y + oy) ?? felt(x, y);
          colour.forEach((c, i) => (sum[i] += c));
        }
      const n = offsets.length ** 2;
      data.set([...sum.map((c) => Math.round(c / n)), 255], (y * W + x) * 4);
    }
  return { width: W, height: H, data };
}

test("an aliased staircase along a rotated card edge scores below the threshold", () => {
  const verdict = edgeVerdict(card(5, false));
  assert.ok(verdict.lines >= 200, `scored ${verdict.lines} lines`);
  assert.ok(verdict.score < SOFT_MIN, `score ${verdict.score}`);
  assert.equal(verdict.pass, false);
});

test("an anti-aliased rotated card edge scores above the threshold", () => {
  const verdict = edgeVerdict(card(5, true));
  assert.ok(verdict.lines >= 200, `scored ${verdict.lines} lines`);
  assert.ok(verdict.score >= SOFT_MIN, `score ${verdict.score}`);
  assert.equal(verdict.pass, true);
});

test("a frame with no rotated card edge fails rather than passing unscored", () => {
  const verdict = edgeVerdict(card(0, true));
  assert.equal(verdict.lines, 0);
  assert.equal(verdict.pass, false);
});

const capture = (name: string) => edgeVerdict(decodePng(readFileSync(`tests/tooling/fixtures/${name}.png`)));

test("the hand fan in ios.yml's felt-settled.png on main scores as aliased", () => {
  const verdict = capture("edge-ios-aliased");
  assert.ok(verdict.lines >= 200, `scored ${verdict.lines} lines`);
  assert.ok(verdict.score < SOFT_MIN, `score ${verdict.score}`);
});

for (const [name, where] of [
  ["edge-chromium-antialiased", "in Chromium at the simulator's scale"],
  ["edge-ios-antialiased", "in the simulator, each outline layer carrying a perspective"],
])
  test(`the same hand fan ${where} scores as anti-aliased`, () => {
    const verdict = capture(name);
    assert.ok(verdict.lines >= 200, `scored ${verdict.lines} lines`);
    assert.ok(verdict.score >= SOFT_MIN, `score ${verdict.score}`);
  });
