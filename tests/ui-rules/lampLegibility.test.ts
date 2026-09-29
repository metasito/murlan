import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ANNULUS,
  LAMP_FLOOR,
  LAMP_SYMMETRY,
  RING_COVERAGE,
  annulusLuminance,
  evenness,
  legibility,
  type DesignScale,
  type Pixels,
} from "../../lib/diagnostics/lampLegibility.ts";
import { SEAT_DISC } from "../../components/seatLayout.ts";
import { designScale, lampTarget } from "../../components/table/lampRig.ts";
import { PHONES } from "../e2e/helpers/phones.ts";

type Rgba = readonly [number, number, number, number];
type Point = { x: number; y: number };
const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const GREY: Rgba = [128, 128, 128, 255];
const DARK: Rgba = [20, 20, 20, 255];
const GREY_LINEAR = 0.216;
const DARK_LINEAR = 0.00699;

const PHONE = PHONES.find((p) => p.name === "iPhone 12")!;
const SCALE = designScale(PHONE.width, PHONE.height);
const PER_PT = 2;
const SEATS = (["bottom", "right", "top", "left"] as const).map((dir) => {
  const [x, y] = lampTarget(dir);
  return { dir, at: { x: x * SCALE.sx, y: y * SCALE.sy } };
});
const RIGHT = SEATS.find((s) => s.dir === "right")!.at;
const MID = (ANNULUS.inner + ANNULUS.outer) / 2;

function paint(at: Point, byDesignPt: (d: number) => Rgba, perPt = PER_PT, scale: DesignScale = SCALE): Pixels {
  const width = PHONE.width * perPt;
  const height = PHONE.height * perPt;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(((x + 0.5) / perPt - at.x) / scale.sx, ((y + 0.5) / perPt - at.y) / scale.sy);
      data.set(byDesignPt(d), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const ring = (inside: Rgba, band: Rgba, outside: Rgba) => (d: number) =>
  d < ANNULUS.inner ? inside : d > ANNULUS.outer ? outside : band;

const near = (actual: number, expected: number, tol: number) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} is not within ${tol} of ${expected}`);

describe("annulusLuminance", () => {
  test("reads the ring round each seat, not its middle and not past it", () => {
    for (const { at } of SEATS) {
      near(annulusLuminance(paint(at, ring(WHITE, GREY, WHITE)), at, PER_PT, SCALE), GREY_LINEAR, 0.001);
      near(annulusLuminance(paint(at, ring(WHITE, DARK, WHITE)), at, PER_PT, SCALE), DARK_LINEAR, 0.0001);
      assert.equal(annulusLuminance(paint(at, ring(BLACK, WHITE, BLACK)), at, PER_PT, SCALE), 1);
    }
  });

  test("the ring is in the table's design points, whatever the pixel density", () => {
    const halves = (d: number) => (d < ANNULUS.inner || d > ANNULUS.outer ? GREY : d < MID ? BLACK : WHITE);
    const outerShare = (ANNULUS.outer ** 2 - MID ** 2) / (ANNULUS.outer ** 2 - ANNULUS.inner ** 2);
    for (const scale of [SCALE, { sx: 1.4, sy: 0.7 }]) {
      for (const perPt of [1, 2, 3]) {
        near(annulusLuminance(paint(RIGHT, halves, perPt, scale), RIGHT, perPt, scale), outerShare, 0.02);
      }
    }
  });

  test("on the smallest phone, the ring shrinks with the table", () => {
    const se = PHONES.find((p) => p.name === "iPhone SE")!;
    const scale = designScale(se.width, se.height);
    assert.ok(scale.sx < 1 && scale.sy < 1);
    const band = paint(RIGHT, ring(WHITE, GREY, WHITE), PER_PT, scale);
    near(annulusLuminance(band, RIGHT, PER_PT, scale), GREY_LINEAR, 0.001);
  });

  test("sRGB 128 reads about 0.216, in linear relative luminance", () => {
    near(annulusLuminance(paint(RIGHT, () => GREY), RIGHT, PER_PT, SCALE), GREY_LINEAR, 0.001);
    near(annulusLuminance(paint(RIGHT, () => [0, 255, 0, 255]), RIGHT, PER_PT, SCALE), 0.7152, 0.0001);
  });

  test("a few off-felt pixels count as neither light nor dark", () => {
    for (const offFelt of [[0, 0, 0, 0], [255, 255, 255, 0], [255, 255, 255, 128]] as const) {
      const spotted = paint(RIGHT, () => GREY);
      for (let dy = 0; dy < 20; dy++) {
        const i = ((Math.round(RIGHT.y * PER_PT) + ANNULUS.inner * PER_PT + dy) * spotted.width + Math.round(RIGHT.x * PER_PT)) * 4;
        (spotted.data as Uint8ClampedArray).set(offFelt, i);
      }
      near(annulusLuminance(spotted, RIGHT, PER_PT, SCALE), GREY_LINEAR, 0.001);
    }
  });

  test("a ring off the image, even partly, refuses to read", () => {
    const grey = paint(RIGHT, () => GREY);
    assert.throws(() => annulusLuminance(grey, { x: PHONE.width + 300, y: RIGHT.y }, PER_PT, SCALE), /off the screen/);
    for (const edge of [{ x: 0, y: RIGHT.y }, { x: 1 - ANNULUS.outer * SCALE.sx, y: RIGHT.y }, { x: RIGHT.x, y: PHONE.height }]) {
      assert.throws(() => annulusLuminance(grey, edge, PER_PT, SCALE), /partly off the screen/);
    }
  });

  test("a ring the felt mostly left transparent refuses to read", () => {
    const blank = paint(RIGHT, () => [0, 0, 0, 0]);
    assert.throws(() => annulusLuminance(blank, RIGHT, PER_PT, SCALE), /drew nothing/);
    const speckled = paint(RIGHT, () => [0, 0, 0, 0]);
    const i = (Math.round(RIGHT.y * PER_PT) * speckled.width + Math.round((RIGHT.x + MID * SCALE.sx) * PER_PT)) * 4;
    for (let k = 0; k < 3; k++) (speckled.data as Uint8ClampedArray).set(WHITE, i + k * 4);
    assert.throws(() => annulusLuminance(speckled, RIGHT, PER_PT, SCALE), /drew nothing/);
    const half = paint(RIGHT, (d) => (d < MID ? GREY : [0, 0, 0, 0]));
    assert.throws(() => annulusLuminance(half, RIGHT, PER_PT, SCALE), /drew nothing/);
  });

  test("a black ring refuses to read", () => {
    assert.throws(() => annulusLuminance(paint(RIGHT, ring(WHITE, BLACK, WHITE)), RIGHT, PER_PT, SCALE), /black/);
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

  test("a zero, infinite or missing mean refuses to make a ratio", () => {
    for (const bad of [0, -0.1, Infinity, NaN]) {
      assert.throws(() => legibility({ bottom: 0.4, right: bad }, "bottom"), /right/);
      assert.throws(() => legibility({ bottom: bad, right: 0.1 }, "bottom"), /bottom/);
      assert.throws(() => evenness([4, bad]), /ratio 1/);
    }
  });

  test("evenness is the worst ratio over the best", () => {
    assert.equal(evenness([4, 5, 3]), 0.6);
    assert.equal(evenness([4.2]), 1);
    assert.throws(() => evenness([]));
  });

  test("the ring starts at the seat disc's edge, and the bounds are Q3's", () => {
    assert.equal(ANNULUS.inner, Math.ceil(SEAT_DISC / 2));
    assert.ok(ANNULUS.outer > ANNULUS.inner);
    assert.ok(RING_COVERAGE >= 0.9 && RING_COVERAGE < 1);
    assert.equal(LAMP_SYMMETRY, 0.8);
    assert.ok(LAMP_FLOOR > 1, `LAMP_FLOOR ${LAMP_FLOOR} lets the seat on move be darker than another`);
  });
});
