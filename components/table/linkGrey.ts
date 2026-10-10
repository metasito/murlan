import { Reconnect } from "../../lib/tokens.ts";

export const GREY_VISIBLE = 0.01;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

export function greyFilter(g: number): string {
  "worklet";
  return g > GREY_VISIBLE ? `grayscale(${g}) brightness(${1 - Reconnect.darken * g})` : "none";
}

/** `greyFilter(g)` as a Skia colour matrix, row-major 4×5 (Filter Effects 1 § grayscale, § brightness). */
export function greyMatrix(g: number): number[] {
  "worklet";
  const s = 1 - g;
  const k = 1 - Reconnect.darken * g;
  const m: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) m.push(k * (LUMA[col] * g + (row === col ? s : 0)));
    m.push(0, 0);
  }
  m.push(0, 0, 0, 1, 0);
  return m;
}
