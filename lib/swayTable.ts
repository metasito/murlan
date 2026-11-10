// The lamp's sway as the rig carries it: its phase `ph` advances by the sway speed at the rig's clock `t`, and a freeze stops
// `ph` but not `t`. `bakeSway({ ph, t }, seconds)` bakes that curve from the rig's own state, linear between stops as a baked
// animation is, and `trackAt` reads it. There is no other model of the sway.
//
// JSX-free, no imports — docs/agents/checks.md, "Node's TypeScript loader".

/** The mockup's sway speed: a base rate, a slow drift and a quick one. */
const BASE = 0.84;
const SLOW = { amp: 0.14, rate: 0.11, offset: 1.3 };
const QUICK = { amp: 0.06, rate: 0.37 };

const phaseOf = (t: number) => BASE * (t - (SLOW.amp / SLOW.rate) * Math.cos(SLOW.rate * t + SLOW.offset) - (QUICK.amp / QUICK.rate) * Math.cos(QUICK.rate * t));

/** The sway's speed in radians a second, `t` seconds into the rig's clock: the mockup's `lampStep`, and the one definition the rig and every track read. */
export function speedOf(t: number): number {
  "worklet";
  return BASE * (1 + SLOW.amp * Math.sin(t * SLOW.rate + SLOW.offset) + QUICK.amp * Math.sin(t * QUICK.rate));
}

/** Seconds between the stops of a track: linear between stops this far apart is off a sine by at most `(1.01 * TRACK_STEP)^2 / 8`, the speed's top being 1.008 rad/s, about 0.001. */
export const TRACK_STEP = 0.1;

/** The rig's `ph` and `t` at the moment a track starts: its speed follows `t`, which a freeze does not stop. */
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
