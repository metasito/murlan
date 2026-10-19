/** WCAG 2.x relative luminance and contrast, over 8-bit sRGB channels. */
export type Rgb = readonly [number, number, number];

const CHANNEL_MAX = 255;

export function linear(channel: number): number {
  const c = channel / CHANNEL_MAX;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** 1 to 21, whichever way round the two are given. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(...a), luminance(...b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
