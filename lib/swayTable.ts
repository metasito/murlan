// The lamp's sway as a baked table: the one clock every sway reads (rest architecture § 2.3).
// 80 half-swings, each sampled at equal steps of the rig's phase, with linear easing between stops, as
// a baked animation curve is. The stops' times are the lamp rig's phase integral (the mockup's
// `lampStep`: w(t) = 0.84 * (1 + 0.14 sin(0.11t + 1.3) + 0.06 sin(0.37t))), so a CSS keyframe loop on
// the same stops and the live rig draw the same curve.
//
// JSX-free, no imports — docs/agents/checks.md, "Node's TypeScript loader".

export const HALF_SWINGS = 80;
/** Stops per half-swing. Linear between stops of an angle step `PI / STEPS` is off a sine by at most `(PI / STEPS)^2 / 8` of its amplitude. */
export const STEPS = 36;

const STEP = Math.PI / STEPS;
const COUNT = HALF_SWINGS * STEPS;

const phaseOf = (t: number) => 0.84 * (t - (0.14 / 0.11) * Math.cos(0.11 * t + 1.3) - (0.06 / 0.37) * Math.cos(0.37 * t));

/** Seconds at which the phase integral reaches `target`; it is monotone, w being positive. */
function timeOf(target: number, from: number, to: number): number {
  let lo = from;
  let hi = to;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (phaseOf(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The rig's phase 0 is the middle of a rising swing; the table starts at the extreme before it, a quarter turn of phase earlier. */
const START = timeOf(phaseOf(0) - Math.PI / 2, -10, 0);

/** Seconds from the table's start to each stop. */
export const SWAY_TIMES: readonly number[] = (() => {
  const times = [0];
  for (let n = 1; n <= COUNT; n++) times.push(timeOf(phaseOf(START) + n * STEP, START, START + 400) - START);
  return times;
})();
/** The rig's phase at each stop, from -PI/2 at the start. */
export const SWAY_PHASES: readonly number[] = SWAY_TIMES.map((_, n) => -Math.PI / 2 + n * STEP);
/** The sway, -1 to 1, at each stop: the sine of its phase. */
export const SWAY_VALUES: readonly number[] = SWAY_PHASES.map((ph) => Math.sin(ph));

export const SWAY_LOOP = SWAY_TIMES[COUNT]!;
/** Where a rig that starts at phase 0 begins: the stop where the sway crosses 0, rising. */
export const SWAY_REST_AT = SWAY_TIMES[STEPS / 2]!;

/** The most the table's sway (-1 to 1) differs from the rig's phase integral over one loop; `tests/ui-rules/swayTable.test.ts` measures it. It scales with the swing's amplitude. */
export const SWAY_VS_INTEGRAL = 0.001;

function between(t: number): { n: number; u: number } {
  "worklet";
  const s = ((t % SWAY_LOOP) + SWAY_LOOP) % SWAY_LOOP;
  let lo = 0;
  let hi = COUNT - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (SWAY_TIMES[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return { n: lo, u: (s - SWAY_TIMES[lo]!) / (SWAY_TIMES[lo + 1]! - SWAY_TIMES[lo]!) };
}

/** The sway, -1 to 1, `t` seconds into the table: what the rig's `sin(phase)` was. */
export function swayAt(t: number): number {
  "worklet";
  const { n, u } = between(t);
  return SWAY_VALUES[n]! + (SWAY_VALUES[n + 1]! - SWAY_VALUES[n]!) * u;
}

/** The rig's phase `t` seconds into the table, from phase 0 at `SWAY_REST_AT`; a mockup resumed at this phase continues the sway. */
export function swayPhase(t: number): number {
  "worklet";
  const { n, u } = between(t);
  return SWAY_PHASES[n]! + (SWAY_PHASES[n + 1]! - SWAY_PHASES[n]!) * u;
}

/** The loop as linear CSS keyframes of opacity between `low` (the sway's -1) and `high` (+1). */
export function swayKeyframes(low: number, high: number): Record<string, { opacity: number }> {
  const frames: Record<string, { opacity: number }> = {};
  for (let n = 0; n <= COUNT; n++) {
    const at = n === COUNT ? "100%" : `${(100 * SWAY_TIMES[n]!) / SWAY_LOOP}%`;
    frames[at] = { opacity: low + ((SWAY_VALUES[n]! + 1) / 2) * (high - low) };
  }
  return frames;
}
