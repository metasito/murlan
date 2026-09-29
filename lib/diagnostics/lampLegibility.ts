import { SEAT_DISC } from "../../components/seatLayout.ts";

export interface Pixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface DesignScale {
  sx: number;
  sy: number;
}

/** The research model's outer edge, `zoneMean(…, 17, 45)` in murlan-plans/2026-09-28-1259-lantern-review/scripts/lamp3.mjs. */
export const ANNULUS_OUTER = 45;

export const ANNULUS = { inner: Math.ceil(SEAT_DISC / 2), outer: ANNULUS_OUTER } as const;

export const RING_COVERAGE = 0.95;

export const LAMP_SYMMETRY = 0.8;

/** Q3's interim CI floor; Task 10 replaces it with the device's (plan 2026-09-28-1259-3 §5). */
export const LAMP_FLOOR = 3.8;

const RGBA = 4;
const CHANNEL_MAX = 255;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

function linear(channel: number): number {
  const c = channel / CHANNEL_MAX;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const percent = (share: number) => `${Math.round(share * 100)} %`;

export function annulusLuminance(
  pixels: Pixels,
  at: { x: number; y: number },
  perPt: number,
  scale: DesignScale,
): number {
  const { width, height, data } = pixels;
  const cx = at.x * perPt;
  const cy = at.y * perPt;
  const rx = ANNULUS.outer * scale.sx * perPt;
  const ry = ANNULUS.outer * scale.sy * perPt;
  const toDesignX = 1 / (scale.sx * perPt);
  const toDesignY = 1 / (scale.sy * perPt);
  let inRing = 0;
  let onImage = 0;
  let onFelt = 0;
  let sum = 0;
  for (let y = Math.floor(cy - ry); y < Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x < Math.ceil(cx + rx); x++) {
      const d = Math.hypot((x + 0.5 - cx) * toDesignX, (y + 0.5 - cy) * toDesignY);
      if (d < ANNULUS.inner || d > ANNULUS.outer) continue;
      inRing++;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      onImage++;
      const i = (y * width + x) * RGBA;
      if (data[i + 3] !== CHANNEL_MAX) continue;
      onFelt++;
      sum += LUMA[0] * linear(data[i]) + LUMA[1] * linear(data[i + 1]) + LUMA[2] * linear(data[i + 2]);
    }
  }
  const where = `the ring at (${at.x}, ${at.y}) pt`;
  if (onImage === 0) throw new Error(`${where} is off the screen (${width}×${height} px)`);
  if (onImage < inRing * RING_COVERAGE) {
    throw new Error(`${where} is partly off the screen: ${percent(onImage / inRing)} of it is on the image`);
  }
  if (onFelt < inRing * RING_COVERAGE) {
    throw new Error(`the felt drew nothing over ${percent(1 - onFelt / inRing)} of ${where}`);
  }
  if (sum === 0) throw new Error(`${where} read black: the felt was not lit`);
  return sum / onFelt;
}

function positive(label: string, v: number): number {
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} is ${v}, not a positive finite number`);
  return v;
}

export function legibility<M extends Readonly<Record<string, number>>>(means: M, onMove: keyof M & string): number {
  if (!(onMove in means)) throw new Error(`no mean for the seat on move, ${onMove}`);
  const others = Object.entries(means)
    .filter(([k]) => k !== onMove)
    .map(([k, v]) => positive(`the mean at ${k}`, v));
  if (others.length === 0) throw new Error("legibility needs a seat besides the one on move");
  return positive(`the mean at ${onMove}`, means[onMove]) / Math.max(...others);
}

export function evenness(ratios: readonly number[]): number {
  if (ratios.length === 0) throw new Error("evenness needs at least one ratio");
  const checked = ratios.map((r, i) => positive(`ratio ${i}`, r));
  return Math.min(...checked) / Math.max(...checked);
}
