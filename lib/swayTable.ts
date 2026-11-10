// The lamp's sway baked as a table: 80 half-swings sampled at equal steps of the mockup's sway phase,
// linear between stops, as a baked animation curve is. Times come from the exact integral of the
// mockup's sway speed. `bakeSway` bakes the same curve from the rig's own state instead.
//
// JSX-free, no imports — docs/agents/checks.md, "Node's TypeScript loader".

export const HALF_SWINGS = 80;
/** Stops per half-swing: linear between stops an angle `PI / STEPS` apart is off a sine by at most `(PI / STEPS)^2 / 8`. */
export const STEPS = 36;

const STEP = Math.PI / STEPS;
const COUNT = HALF_SWINGS * STEPS;

/** The mockup's sway speed: a base rate, a slow drift and a quick one. */
const BASE = 0.84;
const SLOW = { amp: 0.14, rate: 0.11, offset: 1.3 };
const QUICK = { amp: 0.06, rate: 0.37 };

const phaseOf = (t: number) => BASE * (t - (SLOW.amp / SLOW.rate) * Math.cos(SLOW.rate * t + SLOW.offset) - (QUICK.amp / QUICK.rate) * Math.cos(QUICK.rate * t));

/** The sway's speed in radians a second, `t` seconds into the rig's clock: the mockup's `lampStep`, and the one definition the rig, the table and every track read. */
export function speedOf(t: number): number {
  "worklet";
  return BASE * (1 + SLOW.amp * Math.sin(t * SLOW.rate + SLOW.offset) + QUICK.amp * Math.sin(t * QUICK.rate));
}

/** Seconds at which the phase integral reaches `target`, found in `[from, to]` (the speed is positive, so the integral is monotone). */
function timeOf(target: number, from: number, to: number): number {
  let lo = from;
  let hi = to;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (phaseOf(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The mockup starts at phase 0, the middle of a rising swing; the table starts at the extreme before it. */
const START = timeOf(phaseOf(0) - Math.PI / 2, -10, 0);

/** Seconds from the table's start to each stop. Every quarter turn is solved on the exact integral; the stops between are the cubic through the two ends and the sway speed at each. */
export const SWAY_TIMES: readonly number[] = (() => {
  const QUARTER = Math.PI / 2;
  const knots = [START];
  for (let k = 1; k <= HALF_SWINGS * 2; k++) {
    const target = phaseOf(START) + k * QUARTER;
    let t = knots[k - 1]! + QUARTER / speedOf(knots[k - 1]!);
    for (let i = 0; i < 3; i++) t += (target - phaseOf(t)) / speedOf(t);
    knots.push(t);
  }
  const times = [0];
  const per = STEPS / 2;
  for (let k = 0; k < HALF_SWINGS * 2; k++) {
    const t0 = knots[k]!;
    const t1 = knots[k + 1]!;
    const m0 = QUARTER / speedOf(t0);
    const m1 = QUARTER / speedOf(t1);
    for (let j = 1; j <= per; j++) {
      const u = j / per;
      const u2 = u * u;
      const u3 = u2 * u;
      times.push((2 * u3 - 3 * u2 + 1) * t0 + (u3 - 2 * u2 + u) * m0 + (3 * u2 - 2 * u3) * t1 + (u3 - u2) * m1 - START);
    }
  }
  return times;
})();
/** The phase at each stop, from -PI/2 at the start. */
export const SWAY_PHASES: readonly number[] = SWAY_TIMES.map((_, n) => -Math.PI / 2 + n * STEP);
/** The sway, -1 to 1, at each stop: the sine of its phase. */
export const SWAY_VALUES: readonly number[] = SWAY_PHASES.map((ph) => Math.sin(ph));

export const SWAY_LOOP = SWAY_TIMES[COUNT]!;
/** Where the mockup's phase 0 falls: the stop where the sway crosses 0, rising. */
export const SWAY_REST_AT = SWAY_TIMES[STEPS / 2]!;

/** The most the table's sway (-1 to 1) differs from the mockup's own 60 Hz stepping over one loop, measured by tests/ui-rules/swayTable.test.ts; it scales with the swing's amplitude. */
export const SWAY_VS_INTEGRAL = 0.00255;

/** The stop at or before `t` in the loop. */
function stopBefore(s: number): number {
  "worklet";
  let lo = 0;
  let hi = COUNT - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (SWAY_TIMES[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The sway, -1 to 1, `t` seconds into the table. */
export function swayAt(t: number): number {
  "worklet";
  const s = ((t % SWAY_LOOP) + SWAY_LOOP) % SWAY_LOOP;
  const n = stopBefore(s);
  const u = (s - SWAY_TIMES[n]!) / (SWAY_TIMES[n + 1]! - SWAY_TIMES[n]!);
  return SWAY_VALUES[n]! + (SWAY_VALUES[n + 1]! - SWAY_VALUES[n]!) * u;
}

/** The sway phase `t` seconds into the table, from phase 0 at `SWAY_REST_AT`. */
export function swayPhase(t: number): number {
  "worklet";
  const s = ((t % SWAY_LOOP) + SWAY_LOOP) % SWAY_LOOP;
  const n = stopBefore(s);
  const u = (s - SWAY_TIMES[n]!) / (SWAY_TIMES[n + 1]! - SWAY_TIMES[n]!);
  return SWAY_PHASES[n]! + (SWAY_PHASES[n + 1]! - SWAY_PHASES[n]!) * u;
}

/** Seconds between the stops of a track: linear between stops this far apart is off a sine by at most `(1.01 * TRACK_STEP)^2 / 8`, the speed's top being 1.008 rad/s, about 0.001. */
export const TRACK_STEP = 0.1;

/** The rig's `ph` and `t` at the moment a track starts: its speed follows `t`, which a freeze does not stop, so the table's one loop cannot stand for it. */
export interface SwayStart {
  ph: number;
  t: number;
}

/** The sway, -1 to 1, at `TRACK_STEP` intervals over `seconds` from `start`, carrying the rig's phase forward on the exact integral of its speed. */
export function bakeSway({ ph, t }: SwayStart, seconds: number): number[] {
  const from = phaseOf(t);
  const stops = Math.ceil(seconds / TRACK_STEP);
  return Array.from({ length: stops + 1 }, (_, i) =>
    Math.sin(ph + phaseOf(t + i * TRACK_STEP) - from),
  );
}

/** A baked track at `s` seconds from its start, linear between its stops. */
export function trackAt(track: readonly number[], s: number): number {
  const at = Math.min(Math.max(s, 0) / TRACK_STEP, track.length - 1);
  const n = Math.min(Math.floor(at), track.length - 2);
  return track[n]! + (track[n + 1]! - track[n]!) * (at - n);
}

/** The most a track differs from the mockup's 60 Hz stepping over `TRACK_SECONDS` from any state, measured by tests/ui-rules/swayTable.test.ts; it scales with the swing's amplitude. */
export const TRACK_VS_EULER = 0.0024;

/** How long a track is baked for: past it the animation would loop, so the felt bakes another before. */
export const TRACK_SECONDS = 30;

/** Seconds into the table at which the sway phase is `ph` (any phase: the table repeats every `HALF_SWINGS` half-turns). */
export function swayTimeOf(ph: number): number {
  "worklet";
  const span = COUNT * STEP;
  const s = (((ph + Math.PI / 2) % span) + span) % span;
  const n = Math.min(COUNT - 1, Math.floor(s / STEP));
  return SWAY_TIMES[n]! + (SWAY_TIMES[n + 1]! - SWAY_TIMES[n]!) * (s / STEP - n);
}
