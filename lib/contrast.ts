/** WCAG 2.x relative luminance and contrast, over 8-bit sRGB channels. */
export type Rgb = readonly [number, number, number];

const CHANNEL_MAX = 255;

export function linear(channel: number): number {
  const c = channel / CHANNEL_MAX;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

const rgbOf = (colour: string | Rgb): Rgb => {
  if (typeof colour !== "string") return colour;
  if (!/^#[0-9a-f]{6}$/i.test(colour)) throw new Error(`not a #rrggbb colour: ${colour}`);
  const n = parseInt(colour.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

/**
 * 1 to 21, whichever way round the two are given. A colour is `#rrggbb`, or channels where it was
 * composited at fractional values and rounding to hex would move the answer.
 */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const [hi, lo] = [relativeLuminance(rgbOf(a)), relativeLuminance(rgbOf(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
