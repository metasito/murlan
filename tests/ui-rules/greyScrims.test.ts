import { test } from "node:test";
import assert from "node:assert/strict";
import { greyScrims } from "../../components/table/linkGrey.ts";
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

// Compositing and Blending 1 § saturation: SetLum(SetSat(Cb, Sat(Cs)), Lum(Cb)). A black source
// has no saturation, so SetSat leaves every channel at 0 and the result is Lum(Cb) on each.
const lum = ([r, g, b]: Rgb) => 0.3 * r + 0.59 * g + 0.11 * b;
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => under.map((u, i) => alpha * top[i] + (1 - alpha) * u) as unknown as Rgb;
const BLACK: Rgb = [0, 0, 0];

function scrims(c: Rgb, g: number): Rgb {
  const { desaturate, darken } = greyScrims(g);
  const l = lum(c);
  return over(BLACK, darken, over([l, l, l], desaturate, c));
}

const saturation = (c: Rgb) => {
  const max = Math.max(...c);
  return max === 0 ? 0 : (max - Math.min(...c)) / max;
};

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as unknown as Rgb;

test("at the held grey the iOS scrims desaturate and darken the table as the CSS filter does", () => {
  const g = Reconnect.grey;
  for (const input of [hex(Colors.felt), hex(Colors.gold), hex(Colors.seatDisc)]) {
    const out = scrims(input, g);
    const want = css(input, g);
    assert.ok(saturation(input) > 0.6, `${input} is a saturated input`);
    assert.ok(Math.abs(saturation(out) - saturation(want)) <= 0.02, `${input} saturation: ${saturation(out)} vs ${saturation(want)}`);
    assert.ok(Math.abs(Math.max(...out) - Math.max(...want)) <= 0.02, `${input} value: ${Math.max(...out)} vs ${Math.max(...want)}`);
  }
});
