// tests/cosmetics.test.ts — the player can repaint the table and the card
// backs, and neither choice may make the game harder to read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CardBacks, Colors, FeltGradient, FeltGradients } from "../lib/tokens.ts";
import {
  CARD_BACK_IDS,
  DEFAULT_CARD_BACK,
  DEFAULT_TABLE_FELT,
  TABLE_FELT_IDS,
  cardBackField,
  getCardBack,
  getTableFelt,
  isCardBackId,
  isTableFeltId,
} from "../lib/cosmetics.ts";

/** WCAG relative luminance. Higher means lighter. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

// tests/contrast.test.ts pins every text token against Colors.felt. That check
// is only honest for the other three felts if none of them is lighter, at any
// stop, than the green it was measured on.
test("no alternate felt is lighter than the default at any stop", () => {
  const base = FeltGradients[DEFAULT_TABLE_FELT];
  for (const id of TABLE_FELT_IDS) {
    FeltGradients[id].forEach((stop, i) => {
      assert.ok(
        luminance(stop) <= luminance(base[i]) + 1e-9,
        `felt "${id}" stop ${i} (${stop}) is lighter than the default's ${base[i]}`
      );
    });
  }
});

// A felt's five stops are laid along the lamp's falloff, not across a flat
// cloth: the first is the cloth directly under the light and the last is the
// cloth at the edge of its reach, handing over to the room. A ramp that does
// not fall is a wash, which is what the pool replaced.
test("every felt falls away from the lamp, stop by stop", () => {
  for (const id of TABLE_FELT_IDS) {
    const stops = getTableFelt(id);
    for (let i = 1; i < stops.length; i++) {
      assert.ok(
        luminance(stops[i]) < luminance(stops[i - 1]),
        `felt "${id}" stop ${i} (${stops[i]}) is no darker than stop ${i - 1} (${stops[i - 1]})`
      );
    }
  }
});

test("every felt ends dark enough to hand over to the room", () => {
  // Past the falloff the pool paints Colors.bg. A last stop far above it would
  // draw a visible ring where the cloth stops and the room starts.
  for (const id of TABLE_FELT_IDS) {
    const last = luminance(getTableFelt(id)[4]);
    assert.ok(
      last < luminance(Colors.felt),
      `felt "${id}" ends at ${last.toFixed(4)}, no darker than Colors.felt`
    );
  }
});

test("the default felt is the one every unthemed surface already draws", () => {
  assert.deepEqual([...FeltGradient], [...FeltGradients[DEFAULT_TABLE_FELT]]);
});

test("every felt has the five stops the table's `locations` prop expects", () => {
  for (const id of TABLE_FELT_IDS) assert.equal(getTableFelt(id).length, 5);
});

test("card backs are visually distinct, not just differently named", () => {
  const looks = CARD_BACK_IDS.map((id) => {
    const b = CardBacks[id];
    return `${b.field}|${b.ink}|${b.lattice}|${b.starPoints}`;
  });
  assert.equal(new Set(looks).size, looks.length);
});

test("every card back has its own five-stop field", () => {
  for (const id of CARD_BACK_IDS) {
    const field = cardBackField(id);
    assert.equal(field.length, 5);
    field.forEach((stop) => assert.match(stop, /^#[0-9A-Fa-f]{6}$/));
  }
});

// A back's own field must stay its own literal gradient — sharing one with a
// felt would mean repainting the felt silently repaints the back too.
test("a card back's field is never a reference to a felt's gradient", () => {
  for (const id of CARD_BACK_IDS) {
    const field = CardBacks[id].field;
    for (const feltId of TABLE_FELT_IDS) {
      assert.notEqual(field, FeltGradients[feltId], `${id}'s field is felt "${feltId}"`);
    }
  }
});

// A back drawn with too fine a lattice moires at card size, and a star with
// fewer than three points is not a star.
test("card back parameters stay inside what the drawing can render", () => {
  for (const id of CARD_BACK_IDS) {
    const b = CardBacks[id];
    assert.ok(b.lattice >= 4 && b.lattice <= 12, `${id} lattice ${b.lattice}`);
    assert.ok(b.starPoints >= 3 && b.starPoints <= 12, `${id} starPoints ${b.starPoints}`);
  }
});

test("an unknown or missing choice resolves to the default", () => {
  assert.deepEqual(getCardBack(undefined), CardBacks[DEFAULT_CARD_BACK]);
  assert.deepEqual(getCardBack("not-a-back"), CardBacks[DEFAULT_CARD_BACK]);
  assert.deepEqual([...getTableFelt(undefined)], [...FeltGradients[DEFAULT_TABLE_FELT]]);
  assert.deepEqual([...getTableFelt("not-a-felt")], [...FeltGradients[DEFAULT_TABLE_FELT]]);
  assert.equal(isCardBackId("not-a-back"), false);
  assert.equal(isTableFeltId("not-a-felt"), false);
  assert.equal(isCardBackId(DEFAULT_CARD_BACK), true);
  assert.equal(isTableFeltId(DEFAULT_TABLE_FELT), true);
});

test("the defaults are the first option in each picker", () => {
  assert.equal(CARD_BACK_IDS[0], DEFAULT_CARD_BACK);
  assert.equal(TABLE_FELT_IDS[0], DEFAULT_TABLE_FELT);
});
