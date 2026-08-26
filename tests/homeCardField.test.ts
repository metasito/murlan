// tests/homeCardField.test.ts — the home screen's drifting cards are a fixed
// composition, so it is one a test can read. What this pins is the shape of
// that composition: card proportions taken from the face rather than guessed,
// depth carried by every channel at once, and periods that never bring the
// field back to a pose the eye can recognise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DEPTH_BANDS,
  LANDSCAPE_CARDS,
  PORTRAIT_CARDS,
  cardBox,
  restingTilt,
  type Depth,
  type FloatingCardSpec,
} from "../components/homeCardField.ts";
import { CARD_H, CARD_W } from "../components/cardFaceModel.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEPTHS: Depth[] = ["far", "mid", "near"];
const ALL = [...PORTRAIT_CARDS, ...LANDSCAPE_CARDS];

test("every card is drawn at the face's own proportions", () => {
  const face = CARD_H(1) / CARD_W(1);
  for (const depth of DEPTHS) {
    const { width, height } = cardBox(depth);
    assert.equal(height / width, face, `${depth} is not card-shaped`);
  }
});

test("depth is carried by every channel, not just opacity", () => {
  const channels = ["scale", "opacity", "rise", "sway", "tilt", "driftMs", "tiltMs"] as const;
  const [far, mid, near] = DEPTHS.map((d) => DEPTH_BANDS[d]);
  for (const channel of channels) {
    const values = [far[channel], mid[channel], near[channel]];
    assert.equal(new Set(values).size, 3, `${channel} does not separate the three bands`);
  }
  // Nearer is bigger, denser, travels and turns further — and gets there sooner.
  for (const rising of ["scale", "opacity", "rise", "sway", "tilt"] as const) {
    assert.ok(far[rising] < mid[rising] && mid[rising] < near[rising], `${rising} is not ordered by depth`);
  }
  for (const falling of ["driftMs", "tiltMs"] as const) {
    assert.ok(far[falling] > mid[falling] && mid[falling] > near[falling], `${falling} is not ordered by depth`);
  }
  for (const layer of ["offsetY", "opacity", "radius", "elevation"] as const) {
    const cast = DEPTHS.map((d) => DEPTH_BANDS[d].shadow[layer]);
    assert.equal(new Set(cast).size, 3, `shadow ${layer} does not separate the three bands`);
    assert.ok(cast[0]! < cast[1]! && cast[1]! < cast[2]!, `shadow ${layer} is not ordered by depth`);
  }
});

test("no period divides into another, so the field never returns to one pose", () => {
  const periods = DEPTHS.flatMap((d) => [DEPTH_BANDS[d].driftMs, DEPTH_BANDS[d].tiltMs]);
  assert.equal(new Set(periods).size, periods.length, "two periods are the same length");
  for (const a of periods) {
    for (const b of periods) {
      if (a >= b) continue;
      assert.ok(b % a !== 0, `${b}ms is a whole multiple of ${a}ms`);
    }
  }
});

test("six cards in portrait and four in landscape, spread across the bands", () => {
  assert.equal(PORTRAIT_CARDS.length, 6);
  assert.equal(LANDSCAPE_CARDS.length, 4);
  for (const [name, field] of [
    ["portrait", PORTRAIT_CARDS],
    ["landscape", LANDSCAPE_CARDS],
  ] as [string, FloatingCardSpec[]][]) {
    const used = new Set(field.map((c) => c.depth));
    assert.deepEqual([...used].sort(), [...DEPTHS].sort(), `${name} leaves a depth band empty`);
  }
});

test("every card starts mid-flight, and no two from the same pose", () => {
  for (const card of ALL) {
    for (const phase of [card.driftPhase, card.tiltPhase]) {
      assert.ok(phase > 0 && phase < 1, `a phase of ${phase} is not mid-flight`);
    }
  }
  for (const field of [PORTRAIT_CARDS, LANDSCAPE_CARDS]) {
    const poses = field.map((c) => `${c.driftPhase}|${c.tiltPhase}`);
    assert.equal(new Set(poses).size, field.length, "two cards share a starting pose");
  }
});

test("a parked card still rests off upright, within its band's own tilt", () => {
  const angles = PORTRAIT_CARDS.map(restingTilt);
  assert.equal(new Set(angles).size, angles.length, "two parked cards rest at the same angle");
  for (const card of ALL) {
    const angle = restingTilt(card);
    assert.notEqual(angle, 0, "a parked card rests upright, so the field reads as a grid");
    assert.ok(Math.abs(angle) <= DEPTH_BANDS[card.depth].tilt, "a parked card rests past its own tilt");
  }
});

// The field used to draw its own durations, which meant the composition
// differed on every mount — see the header above.
test("the home screen draws no part of the field at random", () => {
  const source = readFileSync(path.join(repoRoot, "app/index.tsx"), "utf8");
  assert.ok(!/Math\.random\(/.test(source), "app/index.tsx still calls Math.random()");
});
