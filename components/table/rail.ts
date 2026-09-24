// The rail (#1252 § The rail): walnut with a brass line, the mockup's `RAIL`, `buildRail` and
// `lightRail`. The grain is drawn once per size by `paintRail` through whichever canvas bakes it —
// Skia's, or the web fallback's 2D one — so both bake the same rings from the same seed.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

export const RAIL = {
  wood: { w: 13, c: ["#4a2f1c", "#3a2415", "#5e3d25"], grain: 0.6 },
  line: { w: 1, c: "#b8923f" },
} as const;

/** The band the rail fills, from the table's outer edge to the felt. */
export const RAIL_BAND = RAIL.wood.w + RAIL.line.w;

/** The mockup's `ringPath`: the rail's rounded rectangle, `d` points in from its outer edge. */
export function ringRect(d: number): { x: number; y: number; w: number; h: number; r: number } {
  "worklet";
  return { x: 62 + d, y: 2 + d, w: 806 - 2 * d, h: 398 - 2 * d, r: 170 - d };
}

export interface RingPainter {
  ring(d: number, width: number, colour: string, dash?: { intervals: number[]; phase: number }): void;
}

/** The mockup's `rng`: mulberry32. */
export function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAIN_SEED = 5;
const RING_STEP = 0.3;

const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function paintRail(p: RingPainter): void {
  const r = rng(GRAIN_SEED);
  const { wood, line } = RAIL;
  const cols = wood.c.map(hexRgb);
  for (let d = 0; d < wood.w - 0.01; d += RING_STEP) {
    const a = r();
    const alt = a < 0.5 ? cols[1] : cols[2];
    const m = Math.abs(a - 0.5) * 2 * wood.grain * 1.6;
    const c = cols[0].map((x, i) => Math.round(x + (alt[i] - x) * Math.min(1, m)));
    p.ring(d + RING_STEP / 2, RING_STEP + 0.08, `rgb(${c.join(",")})`);
  }
  for (let d = 0.2; d < wood.w; d += 0.8) {
    const intervals: number[] = [];
    for (let i = 0; i < 6; i++) intervals.push(4 + r() * 40, 6 + r() * 60);
    const phase = r() * 300;
    p.ring(d, 0.35, `rgba(0,0,0,${0.1 + 0.3 * wood.grain * r()})`, { intervals, phase });
  }
  p.ring(0.3, 0.6, "rgba(0,0,0,0.45)");
  p.ring(wood.w - 0.3, 0.6, "rgba(0,0,0,0.5)");
  p.ring(wood.w + line.w / 2, line.w, line.c);
}

/** `lightRail`'s two passes, as the colours a frame with flare `f` draws them in. */
export const RAIL_LIGHT = {
  softRadius: 620,
  soft: (f: number) => {
    "worklet";
    return [`rgba(255,214,150,${0.85 + 0.15 * f})`, "rgba(128,112,92,0.5)", "rgba(0,0,0,0.95)"];
  },
  softStops: [0, 0.45, 1],
  coatRadius: 340,
  coat: (f: number) => {
    "worklet";
    return [`rgba(255,236,200,${0.45 + 0.3 * f})`, "rgba(255,236,200,0)"];
  },
  coatInset: RAIL.wood.w * 0.32,
  coatWidth: 1.1,
};
