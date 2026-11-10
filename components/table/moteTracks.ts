// The motes and the moth at rest as tracks (#2036 § 2.4): each mote's drift, twinkle and cone, and the moth's flight, precomputed
// from `lampStep` and `drawAir` in tests/e2e/fixtures/lantern-table/index.html (through air.ts, which holds their numbers), in
// that table's 874 × 402 points. A compositor plays them; nothing here runs per frame.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import type { CSSAnimationKeyframes } from "react-native-reanimated";
import { SWAY_LOOP, swayAt } from "../../lib/swayTable.ts";
import { MOTE_ALPHA, MOTE_STRIDE, MOTES, M, moteCone, mothPose, stepAir, twinkle, TWINKLE_RATE, UNSEEN, type Air, type MoteLight } from "./air.ts";
import { SWAY } from "./lampRig.ts";

/** The mockup steps at 60 Hz; a track stepped at the same rate wraps its motes on the same frame. */
const FRAME_S = 1 / 60;
/** How long a track plays before the layer rebuilds it: one loop of the sway table, whole seconds. */
export const SPAN_S = Math.floor(SWAY_LOOP);
/** A wrapped mote is at its old place this long before the new one, so no interpolation sweeps it across the table. */
const WRAP_GAP_S = 0.01;
/** The wobble moves a mote 4.3 pt over 9 s: a stop a second keeps a track within 0.3 pt of it. */
const STOP_S = 1;

/**
 * How long the layer plays a track before rebuilding it. The rig's sway speed drifts with its own clock, which the table
 * (read from the phase at the build) does not follow, so a track's light falls behind the rig's after about this long.
 */
export const REBUILD_S = 240;

export const FLIGHT_S = 4;
const FLIGHT_STEP_S = 1 / 30;

/** The lamp as a track reads it: where it points, unswayed, and the table time at which its sway phase stands. */
export interface RestLight {
  x: number;
  ly: number;
  level: number;
  r: number;
  /** Seconds into the sway table (`swayTimeOf`) at the track's start. */
  tt: number;
}

export interface Stop {
  t: number;
  x: number;
  y: number;
}

export interface ConeStop {
  t: number;
  v: number;
}

export interface MoteTrack {
  r: number;
  ph: number;
  /** Where the mote is, from the build to `SPAN_S` on: linear between stops, a jump across a wrap. */
  drift: Stop[];
  /** The cone's share of the mote's alpha, `MOTE_ALPHA` included: a stop a second, and either side of a wrap. */
  cone: ConeStop[];
}

export interface MoteTracks {
  /** The air's clock at the build: the twinkle's phase is read from it. */
  built: number;
  /** A mote the light never reaches has no track. */
  motes: ({ i: number } & MoteTrack)[];
}

/** Steps `air` `seconds` forward at the mockup's own rate. */
export function advanceAir(air: Air, seconds: number): void {
  const steps = Math.round(seconds / FRAME_S);
  for (let n = 0; n < steps; n++) stepAir(air, FRAME_S, { freeze: 0 }, false, () => 0);
}

/** The lamp's light at `s` seconds into a track that began at `light`. */
function lightAt(light: RestLight, s: number): MoteLight {
  return { lx: light.x + SWAY * swayAt(light.tt + s), ly: light.ly, level: light.level, f: 0, r: light.r };
}

export function buildMoteTracks(air: Air, light: RestLight): MoteTracks {
  const sim: Air = { t: air.t, m: Float64Array.from(air.m), mothAt: Infinity, mothT: -1 };
  const drift: Stop[][] = Array.from({ length: MOTES }, (_, i) => [{ t: 0, x: sim.m[i * MOTE_STRIDE + M.x], y: sim.m[i * MOTE_STRIDE + M.y] }]);
  const cone: ConeStop[][] = Array.from({ length: MOTES }, () => []);
  const coneAt = (x: number, y: number, t: number) => moteCone(x, y, lightAt(light, t)) * MOTE_ALPHA;
  for (let i = 0; i < MOTES; i++) cone[i].push({ t: 0, v: coneAt(drift[i][0].x, drift[i][0].y, 0) });
  const steps = SPAN_S / FRAME_S;
  const before = new Float64Array(MOTES * 2);
  for (let n = 1; n <= steps; n++) {
    for (let i = 0; i < MOTES; i++) {
      before[i * 2] = sim.m[i * MOTE_STRIDE + M.x];
      before[i * 2 + 1] = sim.m[i * MOTE_STRIDE + M.y];
    }
    stepAir(sim, FRAME_S, { freeze: 0 }, false, () => 0);
    const t = n * FRAME_S;
    const whole = n % (STOP_S / FRAME_S) === 0;
    for (let i = 0; i < MOTES; i++) {
      const x = sim.m[i * MOTE_STRIDE + M.x];
      const y = sim.m[i * MOTE_STRIDE + M.y];
      const wrapped = Math.abs(x - before[i * 2]) > 100 || Math.abs(y - before[i * 2 + 1]) > 100;
      if (wrapped) {
        drift[i].push({ t: t - WRAP_GAP_S, x: before[i * 2], y: before[i * 2 + 1] }, { t, x, y });
        cone[i].push({ t: t - WRAP_GAP_S, v: coneAt(before[i * 2], before[i * 2 + 1], t) }, { t, v: coneAt(x, y, t) });
      } else if (whole) {
        drift[i].push({ t, x, y });
        cone[i].push({ t, v: coneAt(x, y, t) });
      }
    }
  }
  const motes: MoteTracks["motes"] = [];
  for (let i = 0; i < MOTES; i++) {
    if (Math.max(...cone[i].map((c) => c.v)) < UNSEEN * MOTE_ALPHA) continue;
    motes.push({ i, r: air.m[i * MOTE_STRIDE + M.r], ph: air.m[i * MOTE_STRIDE + M.ph], drift: drift[i], cone: cone[i] });
  }
  return { built: air.t, motes };
}

const between = (a: number, b: number, u: number) => a + (b - a) * u;

/** The stop pair around `s` and how far between them it falls. */
function around<T extends { t: number }>(stops: readonly T[], s: number): [T, T, number] {
  let lo = 0;
  let hi = stops.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (stops[mid].t <= s) lo = mid;
    else hi = mid;
  }
  const a = stops[lo];
  const b = stops[hi];
  return [a, b, b.t > a.t ? Math.min(1, Math.max(0, (s - a.t) / (b.t - a.t))) : 0];
}

export function trackAt(track: MoteTrack, s: number): { x: number; y: number } {
  const [a, b, u] = around(track.drift, s);
  return { x: between(a.x, b.x, u), y: between(a.y, b.y, u) };
}

/** The mote's alpha `s` seconds after the build, as the compositor shows it: the cone times the twinkle. */
export function trackAlpha(tracks: MoteTracks, track: MoteTrack, s: number): number {
  const [a, b, u] = around(track.cone, s);
  return between(a.v, b.v, u) * twinkle(tracks.built + s, track.ph);
}

/** How many motes the light draws, `s` seconds after the build, by `drawAir`'s own floor. */
export function litAt(tracks: MoteTracks, s: number): number {
  return tracks.motes.filter((t) => trackAlpha(tracks, t, s) >= UNSEEN * MOTE_ALPHA).length;
}

/** What a reduced-motion table shows: every mote where it is, at its first twinkle, in the unswayed light. */
export function stillAlphas(air: Air, light: RestLight): number[] {
  const l = lightAt({ ...light, tt: 0 }, 0);
  const still = { ...l, lx: light.x };
  return Array.from({ length: MOTES }, (_, i) => moteCone(air.m[i * MOTE_STRIDE + M.x], air.m[i * MOTE_STRIDE + M.y], still) * twinkle(0, air.m[i * MOTE_STRIDE + M.ph]) * MOTE_ALPHA);
}

const percent = (s: number, span: number) => `${((s / span) * 100).toFixed(4)}%`;

export function driftKeyframes(track: MoteTrack): CSSAnimationKeyframes {
  const out: Record<string, object> = {};
  for (const p of track.drift) out[percent(p.t, SPAN_S)] = { transform: [{ translateX: p.x }, { translateY: p.y }] };
  return out as CSSAnimationKeyframes;
}

export function coneKeyframes(track: MoteTrack): CSSAnimationKeyframes {
  const out: Record<string, object> = {};
  for (const c of track.cone) out[percent(c.t, SPAN_S)] = { opacity: c.v };
  return out as CSSAnimationKeyframes;
}

const TWINKLE_STOPS = 24;
export const TWINKLE_MS = ((2 * Math.PI) / TWINKLE_RATE) * 1000;
/** One twinkle period, shared by every mote: each starts at its own phase through `twinkleDelay`. */
export const TWINKLE_KEYFRAMES: CSSAnimationKeyframes = Object.fromEntries(
  Array.from({ length: TWINKLE_STOPS + 1 }, (_, j) => [`${(j / TWINKLE_STOPS) * 100}%`, { opacity: twinkle((j / TWINKLE_STOPS) * (2 * Math.PI / TWINKLE_RATE), 0) }])
) as CSSAnimationKeyframes;

/** A mote's twinkle starts this far into its period, so it reads the air's clock from the layer's mount. */
export function twinkleDelay(ph: number): number {
  return -(ph / TWINKLE_RATE) * 1000;
}

export interface FlightStop {
  t: number;
  mx: number;
  my: number;
  sx: number;
  sy: number;
}

/** The moth's crossing from a flight that sets off with the sway at table time `tt`: `mothPose` at every step, the light swaying under it. */
export function buildFlight(light: Omit<RestLight, "level" | "r">): FlightStop[] {
  const air: Air = { t: 0, m: new Float64Array(0), mothAt: Infinity, mothT: 0 };
  const stops: FlightStop[] = [];
  for (let n = 0; n * FLIGHT_STEP_S <= FLIGHT_S + 1e-9; n++) {
    const t = n * FLIGHT_STEP_S;
    air.t = t;
    const l = lightAt({ ...light, level: 1, r: 1 }, t);
    const p = mothPose(air, { ...l, freeze: 0 })!;
    stops.push({ t, mx: p.mx, my: p.my, sx: p.sx, sy: p.sy });
  }
  return stops;
}

export function flightAt(stops: readonly FlightStop[], s: number): FlightStop {
  const [a, b, u] = around(stops, s);
  return { t: s, mx: between(a.mx, b.mx, u), my: between(a.my, b.my, u), sx: between(a.sx, b.sx, u), sy: between(a.sy, b.sy, u) };
}

export function bodyKeyframes(stops: readonly FlightStop[]): CSSAnimationKeyframes {
  return Object.fromEntries(stops.map((p) => [percent(p.t, FLIGHT_S), { transform: [{ translateX: p.mx }, { translateY: p.my }] }])) as CSSAnimationKeyframes;
}

export function shadowKeyframes(stops: readonly FlightStop[]): CSSAnimationKeyframes {
  return Object.fromEntries(stops.map((p) => [percent(p.t, FLIGHT_S), { transform: [{ translateX: p.sx }, { translateY: p.sy }] }])) as CSSAnimationKeyframes;
}

/** A wing beat is `|sin(rate · t)|` wide: one beat, as a scale from the width at rest to full. */
function beat(rate: number, from: number): { keyframes: CSSAnimationKeyframes; ms: number } {
  const stops = 8;
  return {
    ms: (Math.PI / rate) * 1000,
    keyframes: Object.fromEntries(Array.from({ length: stops + 1 }, (_, j) => [`${(j / stops) * 100}%`, { transform: [{ scaleX: from + (1 - from) * Math.sin((j / stops) * Math.PI) }] }])) as CSSAnimationKeyframes,
  };
}

/** The moth's wings: width `3 + 4|sin(38 t)|` against 7 at most. */
export const WING_BEAT = beat(38, 3 / 7);
/** Its shadow: `rx = 16 + 9|sin(40 t)|` against 25 at most. */
export const SHADOW_BEAT = beat(40, 16 / 25);
