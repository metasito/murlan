// The lamp's sway as a table: the one clock every sway reads (rest architecture § 2.3).
// 80 half-swings, each a keyframe whose easing is `SWAY_EASE`, so a CSS keyframe loop and the live
// rig draw the same curve. The half-swing boundaries are the extremes of the lamp rig's own phase
// integral (the mockup's `lampStep`: w(t) = 0.84 * (1 + 0.14 sin(0.11t + 1.3) + 0.06 sin(0.37t))).
//
// JSX-free, no imports — docs/agents/checks.md, "Node's TypeScript loader".

export const HALF_SWINGS = 80;
/** Penner's easeInOutSine as a cubic bezier. */
export const SWAY_EASE = [0.445, 0.05, 0.55, 0.95] as const;

const phaseOf = (t: number) => 0.84 * (t - (0.14 / 0.11) * Math.cos(0.11 * t + 1.3) - (0.06 / 0.37) * Math.cos(0.37 * t));

/** Seconds at which the phase integral has advanced `by` radians past `from`; it is monotone, w being positive. */
function after(from: number, by: number): number {
  const target = phaseOf(from) + by;
  let lo = from;
  let hi = from + by / 0.5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (phaseOf(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The rig's phase 0 is the middle of a rising swing; the table starts at the extreme before it, a quarter turn of phase earlier. */
const START = (() => {
  let lo = -10;
  let hi = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (phaseOf(0) - phaseOf(mid) > Math.PI / 2) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
})();

/** Seconds from the table's start to each extreme: `SWAY_STOPS[k]` begins half-swing k (rising when k is even); the last is the loop. */
export const SWAY_STOPS: readonly number[] = (() => {
  const stops = [0];
  let t = START;
  for (let k = 1; k <= HALF_SWINGS; k++) {
    t = after(t, Math.PI);
    stops.push(t - START);
  }
  return stops;
})();
export const SWAY_LOOP = SWAY_STOPS[HALF_SWINGS]!;
/** The most the table's sway (-1 to 1) differs from the rig's phase integral over one loop; `tests/ui-rules/swayTable.test.ts` measures it. It scales with the swing's amplitude. */
export const SWAY_VS_INTEGRAL = 0.105;

const [X1, Y1, X2, Y2] = SWAY_EASE;

const bezier = (a: number, b: number, v: number) => {
  "worklet";
  return 3 * (1 - v) * (1 - v) * v * a + 3 * (1 - v) * v * v * b + v * v * v;
};

/** Where a rig that starts at phase 0 begins: the middle of the first swing, where the sway is 0 as the mockup's is at its start. */
export const SWAY_REST_AT = (() => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(Y1, Y2, mid) < 0.5) lo = mid;
    else hi = mid;
  }
  return SWAY_STOPS[1]! * bezier(X1, X2, (lo + hi) / 2);
})();

/** The keyframe easing at fraction `u` of a half-swing. */
export function swayEase(u: number): number {
  "worklet";
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(X1, X2, mid) < u) lo = mid;
    else hi = mid;
  }
  return bezier(Y1, Y2, (lo + hi) / 2);
}

function locate(t: number): { k: number; u: number } {
  "worklet";
  const s = ((t % SWAY_LOOP) + SWAY_LOOP) % SWAY_LOOP;
  let lo = 0;
  let hi = HALF_SWINGS - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (SWAY_STOPS[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return { k: lo, u: (s - SWAY_STOPS[lo]!) / (SWAY_STOPS[lo + 1]! - SWAY_STOPS[lo]!) };
}

/** The sway, -1 to 1, `t` seconds into the table: what the rig's `sin(phase)` was. */
export function swayAt(t: number): number {
  "worklet";
  const { k, u } = locate(t);
  const e = swayEase(u);
  return (k % 2 === 0 ? 2 * e : 2 * (1 - e)) - 1;
}

/** The rig's phase `t` seconds into the table: the angle whose sine is `swayAt(t)`, on the branch the sway is travelling. */
export function swayPhase(t: number): number {
  "worklet";
  const { k } = locate(t);
  const n = Math.min(1, Math.max(-1, swayAt(t)));
  const turns = Math.floor(k / 2) * 2 * Math.PI;
  return k % 2 === 0 ? turns + Math.asin(n) : turns + Math.PI - Math.asin(n);
}

/** The loop as CSS keyframes of opacity between `low` and `high`, each half-swing carrying `ease`. */
export function swayKeyframes<E>(ease: E, low: number, high: number): Record<string, { opacity: number; animationTimingFunction?: E }> {
  const frames: Record<string, { opacity: number; animationTimingFunction?: E }> = {};
  for (let k = 0; k <= HALF_SWINGS; k++) {
    const at = k === HALF_SWINGS ? "100%" : `${(100 * SWAY_STOPS[k]!) / SWAY_LOOP}%`;
    frames[at] = { opacity: k % 2 === 0 ? low : high, ...(k < HALF_SWINGS ? { animationTimingFunction: ease } : {}) };
  }
  return frames;
}
