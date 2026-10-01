export interface Pixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** The ring in screen points round a seat: a circle of `inner` (the drawn disc), out to the ellipse `outerX` × `outerY`. */
export interface Ring {
  inner: number;
  outerX: number;
  outerY: number;
}

/** How much of a ring must be on the image: short of it, the sampler is reading the wrong place. */
export const RING_ON_IMAGE = 0.95;

/** Seats sit against the rail, so a ring is partly off felt by geometry; under this share it reads too little felt to judge. */
export const FELT_SHARE = 0.4;

export const LAMP_SYMMETRY = 0.8;

/** Q3's interim CI floor; Task 10 replaces it with the device's (plan 2026-09-28-1259-3 §5). */
export const LAMP_FLOOR = 3.8;

export const LAMP_SIDES = ["bottom", "right", "top", "left"] as const;
export type LampSide = (typeof LAMP_SIDES)[number];

/** One sway period, whose worst frame a player sees: the bench's snapshots per seat, and over how long. */
export const LAMP_SWAY = { samples: 20, ms: 8000 } as const;

const RGBA = 4;
const CHANNEL_MAX = 255;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

function linear(channel: number): number {
  const c = channel / CHANNEL_MAX;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const percent = (share: number) => `${Math.round(share * 100)} %`;

/** `skip`: boxes, in the pixels' points, that are no part of the ring, as if it had a hole there. */
export function annulusLuminance(
  pixels: Pixels,
  at: { x: number; y: number },
  perPt: number,
  ring: Ring,
  skip: readonly { x: number; y: number; w: number; h: number }[] = [],
): number {
  const { width, height, data } = pixels;
  const cx = at.x * perPt;
  const cy = at.y * perPt;
  const rx = ring.outerX * perPt;
  const ry = ring.outerY * perPt;
  let inRing = 0;
  let onImage = 0;
  let onFelt = 0;
  let sum = 0;
  for (let y = Math.floor(cy - ry); y < Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x < Math.ceil(cx + rx); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (Math.hypot(dx, dy) < ring.inner * perPt) continue;
      if (Math.hypot(dx / rx, dy / ry) > 1) continue;
      const [px, py] = [(x + 0.5) / perPt, (y + 0.5) / perPt];
      if (skip.some((b) => px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h)) continue;
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
  if (onImage < inRing * RING_ON_IMAGE) {
    throw new Error(`${where} is partly off the screen: ${percent(onImage / inRing)} of it is on the image`);
  }
  if (onFelt < inRing * FELT_SHARE) {
    throw new Error(`only ${percent(onFelt / inRing)} of ${where} is felt, under ${percent(FELT_SHARE)}`);
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
