import { test } from "node:test";
import assert from "node:assert/strict";
import { greyFilter, greyMatrix, iosGrey } from "../../components/table/linkGrey.ts";
import { Colors, Reconnect } from "../../lib/tokens.ts";

type Rgb = readonly [number, number, number];

// Filter Effects 1 § grayscale and § brightness, applied in that order.
function css(c: Rgb, g: number): Rgb {
  const s = 1 - g;
  const k = 1 - Reconnect.darken * g;
  const [r, gr, b] = c;
  return [
    k * ((0.2126 + 0.7874 * s) * r + (0.7152 - 0.7152 * s) * gr + (0.0722 - 0.0722 * s) * b),
    k * ((0.2126 - 0.2126 * s) * r + (0.7152 + 0.2848 * s) * gr + (0.0722 - 0.0722 * s) * b),
    k * ((0.2126 - 0.2126 * s) * r + (0.7152 - 0.7152 * s) * gr + (0.0722 + 0.9278 * s) * b),
  ];
}

function skia(m: readonly number[], c: Rgb, a = 1): number[] {
  const v = [...c, a, 1];
  return [0, 1, 2, 3].map((row) => v.reduce((sum, x, i) => sum + m[row * 5 + i] * x, 0));
}

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as unknown as Rgb;

test("on iOS the felt's matrix, then the black scrim at its opacity, is the CSS filter the other platforms draw", () => {
  const g = Reconnect.grey;
  const { filter, darken } = iosGrey(g);
  assert.equal(filter, `grayscale(${g})`, "the HUD's view filter is the grayscale half alone");
  assert.ok(greyFilter(g).startsWith(filter), "and is the same grayscale the CSS filter starts with");
  const m = greyMatrix(g);
  assert.equal(m.length, 20);
  for (const input of [[1, 0, 0], [0, 1, 0], [0, 0, 1], hex(Colors.felt), hex(Colors.gold), hex(Colors.seatDisc)] as Rgb[]) {
    const greyed = skia(m, input);
    assert.equal(greyed[3], 1, "alpha passes through");
    const out = greyed.slice(0, 3).map((x) => (1 - darken) * x);
    css(input, g).forEach((want, i) => assert.ok(Math.abs(out[i] - want) <= 0.005, `${input} channel ${i}: ${out[i]} vs ${want}`));
  }
});

test("below the visible grey iOS draws no filter, so the SwiftUI wrapper comes off", () => {
  assert.equal(iosGrey(0).filter, "none");
  assert.equal(iosGrey(0).darken, 0);
});
