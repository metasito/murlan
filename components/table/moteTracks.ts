// The motes and the moth at rest as tracks (#2036 § 2.4): each mote's drift, twinkle and cone, and the moth's flight, precomputed
// from `lampStep` and `drawAir` in tests/e2e/fixtures/lantern-table/index.html (through air.ts, which holds their numbers), in
// that table's 874 × 402 points. A compositor plays them; nothing here runs per frame.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import type { CSSAnimationKeyframes } from "react-native-reanimated";
import { SWAY_LOOP, swayAt } from "../../lib/swayTable.ts";
import { MOTE_ALPHA, MOTE_STRIDE, MOTES, M, moteCone, mothPose, stepAir, twinkle, UNSEEN, type Air, type MoteLight } from "./air.ts";
import { SWAY } from "./lampRig.ts";

/** The mockup steps at 60 Hz; a track stepped at the same rate wraps its motes on the same frame. */
const FRAME_S = 1 / 60;
/** How long a track plays before the layer rebuilds it: one loop of the sway table, whole seconds. */
export const SPAN_S = Math.floor(SWAY_LOOP);
/** A wrapped mote is at its old place this long before the new one, so no interpolation sweeps it across the table. */
const WRAP_GAP_S = 0.01;
/** The wobble moves a mote 4.3 pt over 9 s: a stop a second keeps a track within 0.3 pt of it. */
const STOP_S = 1;

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

/** Opacity is sampled this often: a twinkle's period is 4.83 s, so a step of 0.5 s keeps linear between stops within 0.03 of it. */
const ALPHA_STEP_S = 0.5;

/** One mote's whole motion as one keyframe set, so it is one animation and one layer: its place at every drift stop, and its alpha (the cone times the twinkle) there and every 0.5 s between. */
export function moteKeyframes(tracks: MoteTracks, track: MoteTrack): CSSAnimationKeyframes {
  const at = new Map<string, number>();
  for (const p of track.drift) at.set(percent(p.t, SPAN_S), p.t);
  for (let t = 0; t <= SPAN_S; t += ALPHA_STEP_S) at.set(percent(t, SPAN_S), t);
  const out: Record<string, object> = {};
  for (const [key, t] of [...at].sort((x, y) => x[1] - y[1])) {
    const [a, b, u] = around(track.drift, t);
    out[key] = { transform: [{ translateX: between(a.x, b.x, u) }, { translateY: between(a.y, b.y, u) }], opacity: trackAlpha(tracks, track, t) };
  }
  return out as CSSAnimationKeyframes;
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

export interface Flight {
  /** Seconds after the track's build at which the moth sets off. */
  s: number;
  stops: FlightStop[];
}

/** The moths over a span, from the first at `first` seconds on the air's clock and `built` its clock at the build, 10 to 15 s apart as the mockup sends them; `next` is the one after the span. */
export function buildMoth(light: RestLight, built: number, first: number, rng: () => number): { flights: Flight[]; next: number } {
  const flights: Flight[] = [];
  let at = first;
  while (at < built) at += 10 + rng() * 5;
  for (; at - built + FLIGHT_S < SPAN_S; at += 10 + rng() * 5) {
    const s = at - built;
    flights.push({ s, stops: buildFlight({ x: light.x, ly: light.ly, tt: light.tt + s }) });
  }
  return { flights, next: at };
}

/** Where the moth is `s` seconds after the build, or null while none flies. */
export function mothAt(flights: readonly Flight[], s: number): FlightStop | null {
  const f = flights.find((x) => s >= x.s && s <= x.s + FLIGHT_S);
  if (!f) return null;
  const [a, b, u] = around(f.stops, s - f.s);
  return { t: s, mx: between(a.mx, b.mx, u), my: between(a.my, b.my, u), sx: between(a.sx, b.sx, u), sy: between(a.sy, b.sy, u) };
}

/** The moth's body or shadow over the whole span: hidden between flights, a flight's stops while one flies. */
export function mothKeyframes(flights: readonly Flight[], part: "body" | "shadow"): CSSAnimationKeyframes {
  const out: Record<string, object> = {};
  const at = (p: FlightStop) => (part === "body" ? { translateX: p.mx, translateY: p.my } : { translateX: p.sx, translateY: p.sy });
  const put = (t: number, p: FlightStop, opacity: number) => {
    const { translateX, translateY } = at(p);
    out[percent(t, SPAN_S)] = { opacity, transform: [{ translateX }, { translateY }] };
  };
  put(0, flights[0].stops[0], 0);
  for (const f of flights) {
    put(Math.max(0, f.s - WRAP_GAP_S), f.stops[0], 0);
    for (const p of f.stops) put(f.s + p.t, p, 1);
    put(Math.min(SPAN_S, f.s + FLIGHT_S + WRAP_GAP_S), f.stops[f.stops.length - 1], 0);
  }
  return out as CSSAnimationKeyframes;
}

/** Wings and shadow at their mean widths: `3 + 4|sin(38 t)|` and `16 + 9|sin(40 t)|` average to these. */
export const WING_MEAN = 3 + 4 * (2 / Math.PI);
export const SHADOW_MEAN = 16 + 9 * (2 / Math.PI);
