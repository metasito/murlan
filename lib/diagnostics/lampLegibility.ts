export interface Pixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export const ANNULUS = { inner: 17, outer: 45 } as const;

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

export function annulusLuminance(pixels: Pixels, at: { x: number; y: number }, perPt: number): number {
  const { width, height, data } = pixels;
  const cx = at.x * perPt;
  const cy = at.y * perPt;
  const inner = ANNULUS.inner * perPt;
  const outer = ANNULUS.outer * perPt;
  const x0 = Math.max(0, Math.floor(cx - outer));
  const x1 = Math.min(width, Math.ceil(cx + outer));
  const y0 = Math.max(0, Math.floor(cy - outer));
  const y1 = Math.min(height, Math.ceil(cy + outer));
  let inRing = 0;
  let onFelt = 0;
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < inner || d > outer) continue;
      inRing++;
      const i = (y * width + x) * RGBA;
      if (data[i + 3] === 0) continue;
      onFelt++;
      sum += LUMA[0] * linear(data[i]) + LUMA[1] * linear(data[i + 1]) + LUMA[2] * linear(data[i + 2]);
    }
  }
  if (inRing === 0) throw new Error(`the ring at (${at.x}, ${at.y}) pt is off the screen (${width}×${height} px)`);
  if (onFelt === 0) throw new Error(`the felt drew nothing in the ring at (${at.x}, ${at.y}) pt`);
  return sum / onFelt;
}

export function legibility<M extends Readonly<Record<string, number>>>(means: M, onMove: keyof M & string): number {
  if (!(onMove in means)) throw new Error(`no mean for the seat on move, ${onMove}`);
  const others = Object.entries(means)
    .filter(([k]) => k !== onMove)
    .map(([, v]) => v);
  if (others.length === 0) throw new Error("legibility needs a seat besides the one on move");
  return means[onMove] / Math.max(...others);
}

export function evenness(ratios: readonly number[]): number {
  if (ratios.length === 0) throw new Error("evenness needs at least one ratio");
  return Math.min(...ratios) / Math.max(...ratios);
}
