import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ANNULUS,
  LAMP_FLOOR,
  LAMP_SYMMETRY,
  annulusLuminance,
  evenness,
  legibility,
  type Pixels,
} from "../../lib/diagnostics/lampLegibility.ts";

type Rgba = readonly [number, number, number, number];
const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const GREY: Rgba = [128, 128, 128, 255];
const GREY_LINEAR = 0.216;

const PER_PT = 2;
const AT = { x: 60, y: 60 };
const MID = (ANNULUS.inner + ANNULUS.outer) / 2;

function paint(widthPt: number, heightPt: number, perPt: number, at: { x: number; y: number }, byPt: (d: number) => Rgba): Pixels {
  const width = widthPt * perPt;
  const height = heightPt * perPt;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot((x + 0.5) / perPt - at.x, (y + 0.5) / perPt - at.y);
      data.set(byPt(d), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const ring = (inside: Rgba, band: Rgba, outside: Rgba) => (d: number) =>
  d < ANNULUS.inner ? inside : d > ANNULUS.outer ? outside : band;

const near = (actual: number, expected: number, tol: number) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} is not within ${tol} of ${expected}`);

describe("annulusLuminance", () => {
  test("reads the ring, not its middle and not past it", () => {
    near(annulusLuminance(paint(120, 120, PER_PT, AT, ring(WHITE, GREY, WHITE)), AT, PER_PT), GREY_LINEAR, 0.001);
    assert.equal(annulusLuminance(paint(120, 120, PER_PT, AT, ring(WHITE, BLACK, WHITE)), AT, PER_PT), 0);
    assert.equal(annulusLuminance(paint(120, 120, PER_PT, AT, ring(BLACK, WHITE, BLACK)), AT, PER_PT), 1);
  });

  test("reads the whole ring, each part by its area, at any pixel density", () => {
    const halves = (d: number) => (d < ANNULUS.inner || d > ANNULUS.outer ? GREY : d < MID ? BLACK : WHITE);
    const outerShare = (ANNULUS.outer ** 2 - MID ** 2) / (ANNULUS.outer ** 2 - ANNULUS.inner ** 2);
    for (const perPt of [1, 2, 3]) near(annulusLuminance(paint(120, 120, perPt, AT, halves), AT, perPt), outerShare, 0.02);
  });

  test("sRGB 128 reads about 0.216, in linear relative luminance", () => {
    near(annulusLuminance(paint(120, 120, PER_PT, AT, () => GREY), AT, PER_PT), GREY_LINEAR, 0.001);
    near(annulusLuminance(paint(120, 120, PER_PT, AT, () => [0, 255, 0, 255]), AT, PER_PT), 0.7152, 0.0001);
  });

  test("off-felt pixels count as neither light nor dark", () => {
    for (const offFelt of [[0, 0, 0, 0], [255, 255, 255, 0]] as const) {
      const half = paint(120, 120, PER_PT, AT, () => GREY);
      for (let i = 0; i < half.data.length / 2; i += 4) (half.data as Uint8ClampedArray).set(offFelt, i);
      near(annulusLuminance(half, AT, PER_PT), GREY_LINEAR, 0.001);
    }
  });

  test("a ring past the image edge reads only the part on it", () => {
    const edge = { x: 0, y: 60 };
    near(annulusLuminance(paint(120, 120, PER_PT, edge, ring(WHITE, GREY, WHITE)), edge, PER_PT), GREY_LINEAR, 0.001);
  });

  test("a ring off the image, or on nothing drawn, refuses to read", () => {
    const grey = paint(120, 120, PER_PT, AT, () => GREY);
    assert.throws(() => annulusLuminance(grey, { x: 300, y: 60 }, PER_PT), /off the screen/);
    const blank = paint(120, 120, PER_PT, AT, () => [0, 0, 0, 0]);
    assert.throws(() => annulusLuminance(blank, AT, PER_PT), /drew nothing/);
  });
});

describe("the two ratios", () => {
  const means = { bottom: 0.4, right: 0.1, top: 0.02, left: 0.08 };

  test("legibility is the seat on move over the brightest other seat", () => {
    assert.equal(legibility(means, "bottom"), 4);
    assert.equal(legibility(means, "right"), 0.25);
    assert.equal(legibility({ bottom: 0.3, left: 0.15 }, "bottom"), 2);
    assert.throws(() => legibility(means, "north" as keyof typeof means), /north/);
  });

  test("evenness is the worst ratio over the best", () => {
    assert.equal(evenness([4, 5, 3]), 0.6);
    assert.equal(evenness([4.2]), 1);
    assert.throws(() => evenness([]));
  });

  test("the bounds are Q3's: about equal is 0.8, and the floor out-lights", () => {
    assert.deepEqual(ANNULUS, { inner: 17, outer: 45 });
    assert.equal(LAMP_SYMMETRY, 0.8);
    assert.ok(LAMP_FLOOR > 1, `LAMP_FLOOR ${LAMP_FLOOR} lets the seat on move be darker than another`);
  });
});
