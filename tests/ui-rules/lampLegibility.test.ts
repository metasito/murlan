import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  LAMP_FLOOR,
  LAMP_SYMMETRY,
  RING_COVERAGE,
  annulusLuminance,
  evenness,
  legibility,
  type Ring,
  type Pixels,
} from "../../lib/diagnostics/lampLegibility.ts";
import { HAND_ZONE_H, SEAT_DISC } from "../../components/seatLayout.ts";
import { cardScale } from "../../components/cardFaceModel.ts";
import { anchorPoints } from "../../components/flightPhysics.ts";
import type { FlyDirection } from "../../components/seatLayout.ts";
import { designScale } from "../../components/table/lampRig.ts";
import { ANNULUS_OUTER, legibilityRing } from "../../components/table/legibilityRing.ts";
import { PHONES } from "../e2e/helpers/phones.ts";

type Rgba = readonly [number, number, number, number];
type Point = { x: number; y: number };
type Where = { pt: number; d: number; dx: number; dy: number };
const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const GREY: Rgba = [128, 128, 128, 255];
const DARK: Rgba = [20, 20, 20, 255];
const GREY_LINEAR = 0.216;
const DARK_LINEAR = 0.00699;
const OUTER = 45;

const PHONE = PHONES.find((p) => p.name === "iPhone SE")!;
const SCALE = designScale(PHONE.width, PHONE.height);
const CARD = cardScale(Math.min(PHONE.width, PHONE.height));
const RING = legibilityRing(PHONE.width, PHONE.height);
const DISC = RING.inner;
const PER_PT = 2;
const anchors = anchorPoints({
  scale: CARD,
  windowWidth: PHONE.width,
  windowHeight: PHONE.height,
  tableLeft: 40,
  tableRight: 40,
  tableTop: 8,
  surplus: 0,
  handZoneH: HAND_ZONE_H(90 * CARD, 8),
});
const SEATS = (["bottom", "right", "top", "left"] as FlyDirection[]).map((dir) => ({ dir, at: anchors[dir] }));
const RIGHT = anchors.right;

function paint(at: Point, colour: (w: Where) => Rgba, perPt = PER_PT, scale = SCALE): Pixels {
  const width = PHONE.width * perPt;
  const height = PHONE.height * perPt;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x + 0.5) / perPt - at.x;
      const dy = (y + 0.5) / perPt - at.y;
      data.set(colour({ pt: Math.hypot(dx, dy), d: Math.hypot(dx / scale.sx, dy / scale.sy), dx: dx / scale.sx, dy: dy / scale.sy }), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const ring = (inside: Rgba, band: Rgba, outside: Rgba, disc = DISC) => (w: Where) =>
  w.pt < disc ? inside : w.d > OUTER ? outside : band;

const near = (actual: number, expected: number, tol: number) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} is not within ${tol} of ${expected}`);

const read = (pixels: Pixels, at: Point, perPt = PER_PT, ring: Ring = RING) => annulusLuminance(pixels, at, perPt, ring);

describe("annulusLuminance", () => {
  test("reads the ring round each seat, not its middle and not past it", () => {
    for (const { at } of SEATS) {
      near(read(paint(at, ring(WHITE, GREY, WHITE)), at), GREY_LINEAR, 0.001);
      near(read(paint(at, ring(WHITE, DARK, WHITE)), at), DARK_LINEAR, 0.0001);
      assert.equal(read(paint(at, ring(BLACK, WHITE, BLACK)), at), 1);
    }
  });

  test("the ring's radii are the x and y radii: an anisotropic phone reads all of its top and bottom", () => {
    assert.ok(SCALE.sy / SCALE.sx > 1.2, "the fixture is not anisotropic enough to tell rx from ry");
    const tip = (w: Where) => Math.abs(w.dy * SCALE.sy) > OUTER * SCALE.sx;
    const tips = (w: Where) => (w.pt < DISC || w.d > OUTER ? GREY : tip(w) ? WHITE : DARK);
    for (const { at } of SEATS) {
      const px = paint(at, () => BLACK);
      let n = 0;
      let white = 0;
      for (let y = 0; y < px.height; y++) {
        for (let x = 0; x < px.width; x++) {
          const dx = (x + 0.5) / PER_PT - at.x;
          const dy = (y + 0.5) / PER_PT - at.y;
          const w = { pt: Math.hypot(dx, dy), d: Math.hypot(dx / SCALE.sx, dy / SCALE.sy), dx: dx / SCALE.sx, dy: dy / SCALE.sy };
          if (w.pt < DISC || w.d > OUTER) continue;
          n++;
          if (tip(w)) white++;
        }
      }
      near(read(paint(at, tips), at), (white + (n - white) * DARK_LINEAR) / n, 0.001);
    }
  });

  test("the outer edge is 45 design pt, the research model's zoneMean(…, 17, 45) in lamp3.mjs", () => {
    assert.equal(ANNULUS_OUTER, OUTER);
    for (const [phone, inner, outerX, outerY] of [
      ["iPhone SE", 13.5385, 29.2563, 35.8209],
      ["iPhone 17 Pro Max", 18.6154, 49.2, 49.2],
    ] as const) {
      const p = PHONES.find((q) => q.name === phone)!;
      const r = legibilityRing(p.width, p.height);
      near(r.inner, inner, 0.01);
      near(r.outerX, outerX, 0.5);
      near(r.outerY, outerY, 0.5);
    }
    for (const s of [1, 0.7]) {
      const scale = { sx: s, sy: s };
      for (const perPt of [1, 2, 3]) {
        const innerDesign = DISC / s;
        const mid = (innerDesign + OUTER) / 2;
        const half = (w: Where) => (w.pt < DISC || w.d > OUTER ? GREY : w.d < mid ? BLACK : WHITE);
        const share = (OUTER ** 2 - mid ** 2) / (OUTER ** 2 - innerDesign ** 2);
        near(read(paint(RIGHT, half, perPt, scale), RIGHT, perPt, { inner: DISC, outerX: OUTER * s, outerY: OUTER * s }), share, 0.02);
      }
    }
  });

  test("the ring starts at the drawn disc's edge, which scales with the card and not the table", () => {
    assert.equal(SEAT_DISC * CARD / 2, DISC);
    near(DISC, 13.5, 0.1);
    const discWhite = (w: Where) => (w.pt < DISC ? WHITE : GREY);
    for (const { at } of SEATS) near(read(paint(at, discWhite), at), GREY_LINEAR, 0.001);
  });

  test("sRGB 128 reads about 0.216, in linear relative luminance", () => {
    near(read(paint(RIGHT, () => GREY), RIGHT), GREY_LINEAR, 0.001);
    near(read(paint(RIGHT, () => [0, 255, 0, 255]), RIGHT), 0.7152, 0.0001);
  });

  test("a few off-felt pixels count as neither light nor dark", () => {
    for (const offFelt of [[0, 0, 0, 0], [255, 255, 255, 0]] as const) {
      const spotted = paint(RIGHT, () => GREY);
      for (let dy = 0; dy < 20; dy++) {
        const i = ((Math.round(RIGHT.y * PER_PT) + Math.ceil(DISC + 2) * PER_PT + dy) * spotted.width + Math.round(RIGHT.x * PER_PT)) * 4;
        (spotted.data as Uint8ClampedArray).set(offFelt, i);
      }
      near(read(spotted, RIGHT), GREY_LINEAR, 0.001);
    }
  });

  test("a ring off the image, even partly, refuses to read", () => {
    const grey = paint(RIGHT, () => GREY);
    assert.throws(() => read(grey, { x: PHONE.width + 300, y: RIGHT.y }), /off the screen/);
    for (const edge of [{ x: 0, y: RIGHT.y }, { x: 1 - OUTER * SCALE.sx, y: RIGHT.y }, { x: RIGHT.x, y: PHONE.height }]) {
      assert.throws(() => read(grey, edge), /partly off the screen/);
    }
  });

  test("a ring the felt mostly left transparent refuses to read", () => {
    const blank = paint(RIGHT, () => [0, 0, 0, 0]);
    assert.throws(() => read(blank, RIGHT), /drew nothing/);
    const speckled = paint(RIGHT, () => [0, 0, 0, 0]);
    const i = (Math.round(RIGHT.y * PER_PT) * speckled.width + Math.round((RIGHT.x + 30 * SCALE.sx) * PER_PT)) * 4;
    for (let k = 0; k < 3; k++) (speckled.data as Uint8ClampedArray).set(WHITE, i + k * 4);
    assert.throws(() => read(speckled, RIGHT), /drew nothing/);
    const half = paint(RIGHT, (w) => (w.d < 30 ? GREY : [0, 0, 0, 0]));
    assert.throws(() => read(half, RIGHT), /drew nothing/);
  });

  test("a ring the felt only half-covered refuses to read: alpha short of opaque is not felt", () => {
    const rim = paint(RIGHT, (w) => (w.d > 43 && w.d <= OUTER ? [128, 128, 128, 128] : GREY));
    assert.throws(() => read(rim, RIGHT), /drew nothing/);
  });

  test("a black ring refuses to read", () => {
    assert.throws(() => read(paint(RIGHT, ring(WHITE, BLACK, WHITE)), RIGHT), /black/);
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

  test("the bounds are Q3's", () => {
    assert.ok(OUTER > SEAT_DISC / 2);
    assert.ok(RING_COVERAGE >= 0.9 && RING_COVERAGE < 1);
    assert.equal(LAMP_SYMMETRY, 0.8);
    assert.ok(LAMP_FLOOR > 1, `LAMP_FLOOR ${LAMP_FLOOR} lets the seat on move be darker than another`);
  });
});
