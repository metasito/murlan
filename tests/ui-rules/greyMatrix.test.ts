import { test } from "node:test";
import assert from "node:assert/strict";
import { greyMatrix } from "../../components/table/linkGrey.ts";
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

const saturation = (c: readonly number[]) => {
  const max = Math.max(c[0], c[1], c[2]);
  return max === 0 ? 0 : (max - Math.min(c[0], c[1], c[2])) / max;
};

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as unknown as Rgb;

test("at the held grey the felt matrix desaturates and darkens as the CSS filter does", () => {
  const g = Reconnect.grey;
  const m = greyMatrix(g);
  assert.equal(m.length, 20);
  for (const input of [[1, 0, 0], [0, 1, 0], [0, 0, 1], hex(Colors.felt), hex(Colors.gold), hex(Colors.seatDisc)] as Rgb[]) {
    const out = skia(m, input);
    assert.ok(saturation(input) > 0.6, `${input} is a saturated input`);
    assert.ok(saturation(out) < saturation(input), `${input} desaturates: ${saturation(out)}`);
    assert.ok(Math.max(...out.slice(0, 3)) < Math.max(...input), `${input} darkens: ${out}`);
    css(input, g).forEach((want, i) => assert.ok(Math.abs(out[i] - want) <= 0.005, `${input} channel ${i}: ${out[i]} vs ${want}`));
    assert.equal(out[3], 1, "alpha passes through");
  }
});
