import { Reconnect } from "../../lib/tokens.ts";

export const GREY_VISIBLE = 0.01;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

export function greyFilter(g: number): string {
  "worklet";
  return g > GREY_VISIBLE ? `grayscale(${g}) brightness(${1 - Reconnect.darken * g})` : "none";
}

/**
 * `greyFilter(g)` split for iOS, where `brightness()` is a multiply-blended sublayer that cannot see
 * the Skia felt beneath it: `grayscale(g)` as the view filter (the felt's `greyMatrix`), and the
 * brightness factor as one black scrim at opacity `darken·g` over all of them.
 */
export function iosGrey(g: number): { filter: string; darken: number } {
  "worklet";
  return { filter: g > GREY_VISIBLE ? `grayscale(${g})` : "none", darken: Reconnect.darken * g };
}

/** `grayscale(g)` as a Skia colour matrix, row-major 4×5 (Filter Effects 1 § grayscale). */
export function greyMatrix(g: number): number[] {
  "worklet";
  const s = 1 - g;
  const m: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) m.push(LUMA[col] * g + (row === col ? s : 0));
    m.push(0, 0);
  }
  m.push(0, 0, 0, 1, 0);
  return m;
}
