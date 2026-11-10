// The felt at rest (#1252 § The lamp): a lamp that has come to rest sways ±SWAY about its target, and the
// felt shows that as two baked frames, the light at either end of the sway, A drawn and B laid over it at an
// opacity the compositor moves. This is the decisions: when the table is at rest, what the canvas draws for
// it, and the track B's opacity follows.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { CSSAnimationKeyframes } from "react-native-reanimated";
import { bakeSway, TRACK_SECONDS, TRACK_STEP, trackAt } from "../../lib/swayTable.ts";
import { FLARE_SEEN } from "./feltShader.ts";
import { lightX, lightY, SWAY, SWAY_KICKED, type Lamp } from "./lampRig.ts";

/** What the canvas draws of the lamp: the light point, its reach and level, and how far the cloth crosses from end A to end B. */
export interface Shown {
  lx: number;
  ly: number;
  f: number;
  r: number;
  level: number;
  lean: number;
}

/** Before the first frame: it differs from any lamp in every field. */
export const NOT_SHOWN: Shown = {
  lx: NaN,
  ly: NaN,
  f: NaN,
  r: NaN,
  level: NaN,
  lean: NaN,
};

/** Design points the lamp may lie from its target and still be at it; under the 0.5 pt step the felt redraws on. */
const AT_TARGET = 0.25;
const AT_REACH = 0.02;
/** The kick's swing beyond the sway, in points, under which the sway is the sway. */
const KICK_SEEN = 0.1;
const LEVEL_SEEN = 1 / 1024;

const clamp01 = (v: number) => {
  "worklet";
  return Math.min(1, Math.max(0, v));
};

/** Whether nothing but the sway moves the light: arrived, unflared, unkicked, at its level, and running. */
export function isRested(s: Lamp): boolean {
  "worklet";
  return (
    Math.abs(s.x - s.tx) < AT_TARGET &&
    Math.abs(s.y - s.ty) < AT_TARGET &&
    Math.abs(s.r - s.tr) < AT_REACH &&
    s.flare < FLARE_SEEN &&
    s.kick * SWAY_KICKED < KICK_SEEN &&
    Math.abs(s.lvlT - s.lvl) < LEVEL_SEEN &&
    s.freeze === 0
  );
}

/** How far the light is from end A toward end B, 0 to 1. */
export function leanOf(s: Lamp): number {
  "worklet";
  return clamp01(0.5 + (s.lx - s.tx) / (2 * SWAY));
}

/** `side` -1 draws end A of a rested lamp and 1 end B; 0, or a lamp that has moved, the lamp as it is. */
export function shownLamp(s: Lamp, side: number): Shown {
  "worklet";
  if (side === 0 || !isRested(s))
    return {
      lx: s.lx,
      ly: s.ly,
      f: s.f,
      r: s.r,
      level: s.level,
      lean: leanOf(s),
    };
  return {
    lx: lightX(s.tx, side * SWAY),
    ly: lightY(s.ty),
    f: 0,
    r: s.tr,
    level: clamp01(s.lvlT),
    lean: (side + 1) / 2,
  };
}

/** `held` while the canvas would draw what it drew, so that nothing redraws for a sway the compositor carries. */
export function nextShown(held: Shown, s: Lamp, side: number): Shown {
  "worklet";
  const next = shownLamp(s, side);
  const same =
    next.lx === held.lx &&
    next.ly === held.ly &&
    next.f === held.f &&
    next.r === held.r &&
    next.level === held.level &&
    next.lean === held.lean;
  return same ? held : next;
}

export interface EndTrack {
  /** The sway, -1 to 1, at each `TRACK_STEP`: what `keyframes` are the opacity of. */
  sway: readonly number[];
  keyframes: CSSAnimationKeyframes;
  /** One pass, in milliseconds. */
  duration: number;
  /** The rig's clock when the track starts: a track `s` seconds in is the light at rig time `t + s`. */
  t: number;
}

/** End B's opacity from the rig's `ph` and `t`, sampled `TRACK_STEP` apart for `TRACK_SECONDS`. */
export function endTrack(ph: number, t: number): EndTrack {
  const sway = bakeSway({ ph, t }, TRACK_SECONDS);
  const last = sway.length - 1;
  const keyframes: Record<string, { opacity: number }> = {};
  sway.forEach((v, i) => {
    keyframes[`${((i / last) * 100).toFixed(4)}%`] = { opacity: 0.5 + 0.5 * v };
  });
  return { sway, keyframes: keyframes as CSSAnimationKeyframes, duration: last * TRACK_STEP * 1000, t };
}

/** Seconds before a track ends that the next is baked: an animation loops back to its start. */
export const REBAKE_BEFORE = 2;
/** How long what an end draws holds still before the table is shown as ends again: a debounce, not a motion step. */
export const QUIET_MS = 250;

/** Points the compositor's light may lie off the rig's before the animation is moved to where the rig is. */
export const DRIFT_PT = 0.2;
/** How often the animation is held against the rig: at the rate a rig that stalls drifts (5% slow, 1 pt a second), the two are never 0.5 pt apart between checks. A polling cadence, not a motion step. */
export const DRIFT_CHECK_MS = 250;

/** The rig's place in a track baked at rig time `t`, in seconds; past `TRACK_SECONDS - REBAKE_BEFORE` the track is spent. */
export function placeOf(track: Pick<EndTrack, "t">, rigT: number): number {
  return rigT - track.t;
}

/**
 * How far the light the animation plays, `playing` seconds into its pass, is from the rig's at `place`, in points. The rig
 * steps at most `MAX_DT` a frame, so a page that stalls runs it behind the wall clock the animation keeps.
 */
export function driftPt(sway: readonly number[], playing: number, place: number): number {
  return Math.abs(trackAt(sway, playing) - trackAt(sway, place)) * SWAY;
}
