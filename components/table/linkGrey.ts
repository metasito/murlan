import { Reconnect } from "../../lib/tokens.ts";

export const GREY_VISIBLE = 0.01;

export function greyFilter(g: number): string {
  "worklet";
  return g > GREY_VISIBLE ? `grayscale(${g}) brightness(${1 - Reconnect.darken * g})` : "none";
}

/**
 * `greyFilter(g)` as two black scrims over the table, for iOS: one blended `saturation` (Compositing
 * and Blending 1 § saturation), which at opacity g is `grayscale(g)` by the blend's own luminance
 * weights, and one plain, which at opacity `darken·g` is the brightness factor.
 */
export function greyScrims(g: number): { desaturate: number; darken: number } {
  "worklet";
  return { desaturate: g, darken: Reconnect.darken * g };
}
