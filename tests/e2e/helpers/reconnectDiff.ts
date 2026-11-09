// The `reconnect` moment's gate (#1268): on real time, so each side's frames fall where its own
// rAF puts them, and both are read against anchors of their own (`Anchors`).
import type { TraceFrame } from "../../../lib/e2eTrace.ts";
import { STEP_MS, type Failure } from "./traceDiff.ts";

/** One frame of jitter, on 60 Hz frames rather than the virtual clock's 16 ms grid. */
const JITTER_MS = Math.ceil(1000 / 60);
/** A due timer's onset lands within this many frames of the last stall that held it, counting that stall's own frame; a passive effect's stamp trails what it stamps by as many, so a stall in them moves an anchor past the curve it opens. */
const STAMP_FRAMES = 4;
const PIPELINE_FRAMES = 3;
/** Rounding of the trace's stamps, in ms. */
const STAMP_ROUNDING_MS = 2;
/** The lamp steps by its frame's span, no more than this: `MAX_DT` in `components/table/lampRig.ts`, and the mockup's own cap. */
const LAMP_STEP_CAP_MS = 50;
/** The ceiling no stall lifts, so a frozen thread cannot excuse itself without limit: the ten red CI traces of #1449 were late by 221 ms at most. */
const JITTER_CEILING_MS = 300;
/** What the clock may stray from the capped spans' sum by, as a share of it: the half millisecond it is read to a frame, and a little. */
const CLOCK_SHARE = 0.01;
/** The grey moves 0.85 in 300 ms: one frame of jitter, and a little. */
const GREY_TOLERANCE = 0.06;
/** The lamp's phase runs about 0.84 rad/s; frozen, it does not move at all. */
const FROZEN_PH = 1e-3;
const RUNNING_PH = 0.05;
const CURVE_SPAN_MS = 600;

export const RECONNECT_SOUND = { mockup: "sound:reconnect", app: "sound:reconnected" } as const;
type Side = keyof typeof RECONNECT_SOUND;

const onsetAt = (frames: TraceFrame[], name: string, from = -Infinity) =>
  frames.find((f) => f.t >= from && f.onsets.includes(name))?.t ?? null;

const cadenceOf = (frames: TraceFrame[]) => {
  const spans = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((x, y) => x - y);
  return Math.max(JITTER_MS, spans[spans.length >> 1] ?? 0);
};

const STALL_FRAMES = 1.5;

/** What a stalled main thread took from `(from, to]`: each span of `frames` past `STALL_FRAMES` of a frame counts what of it lies inside, beyond one frame; and when the last such span ended. */
const stallIn = (frames: TraceFrame[], frame: number, from: number, to: number) => {
  let took = 0;
  let end = -Infinity;
  for (let i = 1; i < frames.length; i++) {
    const [start, stop] = [frames[i - 1].t, frames[i].t];
    const inside = Math.min(stop, to) - Math.max(start, from);
    if (stop - start > STALL_FRAMES * frame && inside > 0) {
      took += Math.max(0, inside - frame);
      end = stop;
    }
  }
  return { took, end };
};

/** The lamp eases toward 0.55 at a rate of 1. The curve may sit one shift off the mockup's, as far as an onset may, and be read against it there: what is left once it does is the rate's alone: a faithful app's is under 0.001 and a twentieth off puts it at 0.006. */
const LEVEL_TOLERANCE = 0.004;
const LEVEL_SPAN_MS = 1500;

const between = (frames: TraceFrame[], t: number, read: (f: TraceFrame) => number): number | null => {
  const after = frames.findIndex((f) => f.t >= t);
  if (after <= 0) return after === 0 && frames[0].t === t ? read(frames[0]) : null;
  const [a, b] = [frames[after - 1], frames[after]];
  const k = (t - a.t) / (b.t - a.t);
  return read(a) + (read(b) - read(a)) * k;
};

/** The grey at `t`, between the frames either side of it. */
export const greyAt = (frames: TraceFrame[], t: number) => between(frames, t, (f) => f.grey ?? 0);

/** The app's frames on its lamp's own clock, which loses the time of every frame past `LAMP_STEP_CAP_MS` as the lamp does; null when a frame carries none. */
const onLampClock = (frames: TraceFrame[]): TraceFrame[] | null =>
  frames.every((f) => f.lamp?.clock !== undefined) ? frames.map((f) => ({ ...f, t: f.lamp!.clock! * 1000 })) : null;

/** The lamp's clock stands still through the frames it loses to a stall, so the level's span needs the app's trace to run until the clock has covered it, not only the wall time. */
export const levelSpanTraced = (frames: TraceFrame[], lost: number) => {
  const [from, to] = [frames.find((f) => f.t === lost)?.lamp?.clock, frames.at(-1)?.lamp?.clock];
  return from !== undefined && from !== null && to !== undefined && to !== null && (to - from) * 1000 >= LEVEL_SPAN_MS;
};

/** The lamp's clock runs each frame's span, capped, and that makes reading the level on it honest rather than a way to forgive a slow lamp: over the level's own window, from the clock at `lost` to the span's end. */
const clockDrift = (frames: TraceFrame[], lost: number) => {
  const from = frames.findIndex((f) => f.t === lost);
  let capped = 0;
  let clock = 0;
  for (let i = from + 1; i < frames.length && clock < LEVEL_SPAN_MS; i++) {
    capped += Math.min(frames[i].t - frames[i - 1].t, LAMP_STEP_CAP_MS);
    clock = (frames[i].lamp!.clock! - frames[from].lamp!.clock!) * 1000;
  }
  return { drift: clock - capped, allowed: capped * CLOCK_SHARE };
};

/** What a curve is at `t`: one value, or, inside a span stalled beyond `stallOver`, anything between the frames either side of it, which the app painted but the trace never saw. */
const readAt = (frames: TraceFrame[], t: number, read: (f: TraceFrame) => number, stallOver: number): [number, number] | null => {
  const after = frames.findIndex((f) => f.t >= t);
  if (after <= 0) return after === 0 && frames[0].t === t ? [read(frames[0]), read(frames[0])] : null;
  const [a, b] = [read(frames[after - 1]), read(frames[after])];
  if (frames[after].t - frames[after - 1].t > stallOver) return [Math.min(a, b), Math.max(a, b)];
  const v = between(frames, t, read)!;
  return [v, v];
};

const phSpan = (frames: TraceFrame[], from: number, to: number) => {
  const ph = frames.filter((f) => f.t >= from && f.t <= to && f.lamp?.ph !== undefined).map((f) => f.lamp!.ph!);
  return ph.length < 2 ? null : Math.max(...ph) - Math.min(...ph);
};

/** The drop, the way back, the second drop, and the give-up, whose delay after it is the app's own (`Reconnect.giveUp`). */
export interface Anchors {
  drop: number;
  back: number;
  again: number;
  lost: number;
}
const ANCHORS = ["drop", "back", "again", "lost"] as const;
const ONSET_OF: Record<keyof Anchors, string> = { drop: "moment:drop", back: "moment:net-ok", again: "moment:drop", lost: "moment:net-bad" };

export function anchorsOf(frames: TraceFrame[]): Anchors | null {
  const found: Partial<Anchors> = {};
  let from = -Infinity;
  for (const anchor of ANCHORS) {
    const t = onsetAt(frames, ONSET_OF[anchor], from);
    if (t === null) return null;
    found[anchor] = from = t;
  }
  return found as Anchors;
}

/** Each side's frames on the mockup's chapter clock, each span from the anchor that opens it; the give-up's longer wait is cut to the chapter's. */
export function onChapterClock(frames: TraceFrame[], own: Anchors, chapter: Anchors): TraceFrame[] {
  return frames.flatMap((f) => {
    const anchor = ANCHORS.findLast((a) => f.t >= own[a]) ?? "drop";
    const t = Math.round(f.t - own[anchor] + chapter[anchor]);
    return anchor === "again" && t >= chapter.lost ? [] : [{ ...f, t }];
  });
}

interface Curve {
  field: Failure["field"];
  what: string;
  anchor: keyof Anchors;
  frames: TraceFrame[];
  own: number;
  read: (f: TraceFrame) => number;
  tolerance: number;
  span: number;
  stallOver: number;
}

export function diffReconnect(sides: Record<Side, TraceFrame[]>): Failure[] {
  const failures: Failure[] = [];
  const fail = (field: Failure["field"], t: number, mockup: unknown, app: unknown, message: string) =>
    failures.push({ field, t, mockup, app, message });
  const anchors = { mockup: anchorsOf(sides.mockup), app: anchorsOf(sides.app) };
  if (!anchors.mockup || !anchors.app) {
    fail("onset", 0, anchors.mockup, anchors.app, "both sides drop, come back, drop again and give up");
    return failures;
  }
  const { mockup: m, app: a } = anchors as Record<Side, Anchors>;

  const offset = (side: Side, anchor: number, name: string) => {
    const t = onsetAt(sides[side], name, anchor);
    return t === null ? null : t - anchor;
  };
  const onsets: [string, keyof Anchors, Record<Side, string>, boolean][] = [
    ["the pill's Riconnessione…", "drop", { mockup: "moment:net-net", app: "moment:net-net" }, true],
    ["the recovery sound", "back", RECONNECT_SOUND, false],
    ["the pill's Di nuovo in linea clearing", "back", { mockup: "moment:net-", app: "moment:net-" }, true],
    ["the pill's Riconnessione… again", "again", { mockup: "moment:net-net", app: "moment:net-net" }, true],
  ];
  const frame = cadenceOf(sides.app);
  /** The app stamps an onset and its anchor alike from a passive effect (`useLinkHold`), each read a frame or two after it painted: up to two of its frames each way, and one of the mockup's virtual steps. */
  const jitter = Math.min(JITTER_CEILING_MS, 2 * frame + STEP_MS);
  /** A timer armed with the anchor falls due inside a frame, whose task waits out the frame in progress, renders in the next and is read in the one after it painted: three frames after it was due, and the mockup's step for where its own due fell. */
  const lateBy = Math.min(JITTER_CEILING_MS, PIPELINE_FRAMES * frame + STEP_MS);
  for (const [what, anchor, names, timer] of onsets) {
    const limit = timer ? lateBy : jitter;
    const got = { mockup: offset("mockup", m[anchor], names.mockup), app: offset("app", a[anchor], names.app) };
    const late = got.mockup === null || got.app === null ? null : got.app - got.mockup;
    const stalled = late === null ? null : stallIn(sides.app, frame, a[anchor] + got.mockup!, a[anchor] + got.app!);
    const excused = stalled !== null && late! <= limit + stalled.took && a[anchor] + got.app! - stalled.end <= (STAMP_FRAMES - 1) * frame + STAMP_ROUNDING_MS;
    if (late === null || late < -jitter || late > JITTER_CEILING_MS || (late > limit && !excused)) {
      fail("onset", m[anchor] + (got.mockup ?? 0), got.mockup, got.app, `${what}, in ms after the ${anchor}`);
    }
  }

  const appClock = onLampClock(sides.app);
  const clockAnchor = appClock ? appClock[sides.app.findIndex((f) => f.t === a.lost)]?.t : undefined;
  if (!appClock || clockAnchor === undefined) fail("level", m.lost, null, null, "the app's frames carry the lamp's clock");
  else {
    const { drift, allowed } = clockDrift(sides.app, a.lost);
    if (Math.abs(drift) > allowed) fail("level", m.lost, 0, drift, "the lamp's clock advances by each frame's span, capped, from the lost");
  }

  /** The anchor is stamped from a passive effect, so a stall just before it moves the stamp past where the curve began: the curve may be that much further on. */
  const shiftAt = (anchor: number) =>
    Math.min(
      JITTER_CEILING_MS,
      sides.app.reduce((took, f, i) => {
        const span = i > 0 ? f.t - sides.app[i - 1].t : 0;
        return f.t > anchor - STAMP_FRAMES * frame && f.t <= anchor && span > STALL_FRAMES * frame ? took + span - frame : took;
      }, 0)
    );
  const grey = (f: TraceFrame) => f.grey ?? 0;
  const level = (f: TraceFrame) => f.lamp?.level ?? 1;
  const curves: Curve[] = [
    { field: "grey", what: "the grey", anchor: "drop", frames: sides.app, own: a.drop, read: grey, tolerance: GREY_TOLERANCE, span: CURVE_SPAN_MS, stallOver: STALL_FRAMES * frame },
    { field: "grey", what: "the grey", anchor: "back", frames: sides.app, own: a.back, read: grey, tolerance: GREY_TOLERANCE, span: CURVE_SPAN_MS, stallOver: STALL_FRAMES * frame },
    { field: "grey", what: "the grey", anchor: "lost", frames: sides.app, own: a.lost, read: grey, tolerance: GREY_TOLERANCE, span: CURVE_SPAN_MS, stallOver: STALL_FRAMES * frame },
  ];
  if (appClock && clockAnchor !== undefined) {
    const reach = jitter + shiftAt(a.lost);
    const fall = Array.from({ length: Math.floor(LEVEL_SPAN_MS / (STEP_MS * 3)) + 1 }, (_, i) => i * STEP_MS * 3);
    const miss = (s: number) => fall.map((d) => Math.abs((between(appClock, clockAnchor + d, level) ?? NaN) - (between(sides.mockup, m.lost + d + s, level) ?? NaN)));
    const shifts = Array.from({ length: Math.floor((jitter + reach) / STEP_MS) + 1 }, (_, i) => -jitter + i * STEP_MS);
    const best = shifts.map((s) => ({ s, miss: miss(s) })).reduce((x, y) => (Math.max(...y.miss) < Math.max(...x.miss) ? y : x));
    if (!(Math.max(...best.miss) <= LEVEL_TOLERANCE)) {
      fall.forEach((d, i) => {
        if (!(best.miss[i] <= LEVEL_TOLERANCE)) fail("level", m.lost + d, between(sides.mockup, m.lost + d + best.s, level), between(appClock, clockAnchor + d, level), `the lamp's level ${d} ms after the lost`);
      });
    }
  }
  for (const { field, what, anchor, frames, own, read, tolerance, span, stallOver } of curves) {
    const shift = shiftAt(a[anchor]);
    const shifts = [...Array.from({ length: Math.floor(shift / STEP_MS) }, (_, i) => i * STEP_MS), shift];
    const ds = Array.from({ length: Math.floor(span / (STEP_MS * 3)) + 1 }, (_, i) => i * STEP_MS * 3);
    const misses = (s: number) =>
      ds.map((d) => {
        const got = readAt(frames, own + d, read, stallOver);
        const want = between(sides.mockup, m[anchor] + d + s, read);
        return got === null || want === null || got[0] > want + tolerance || got[1] < want - tolerance;
      });
    const best = shifts.map((s) => ({ s, miss: misses(s) })).reduce((x, y) => (y.miss.filter(Boolean).length < x.miss.filter(Boolean).length ? y : x));
    ds.forEach((d, i) => {
      if (!best.miss[i]) return;
      const got = readAt(frames, own + d, read, stallOver);
      fail(field, m[anchor] + d, between(sides.mockup, m[anchor] + d + best.s, read), got && (got[0] === got[1] ? got[0] : got), `${what} ${d} ms after the ${anchor}`);
    });
  }

  for (const side of ["mockup", "app"] as const) {
    const own = anchors[side]!;
    const held = phSpan(sides[side], own.drop + 2 * JITTER_MS, own.back - JITTER_MS);
    if (held === null || held > FROZEN_PH) fail("freeze", m.drop, side === "mockup" ? held : null, side === "app" ? held : null, `${side}: the lamp's phase stands still while held`);
    const after = phSpan(sides[side], own.back + 2 * JITTER_MS, own.back + CURVE_SPAN_MS);
    if (after === null || after < RUNNING_PH) fail("freeze", m.back, side === "mockup" ? after : null, side === "app" ? after : null, `${side}: the lamp's phase runs on once back`);
  }
  return failures;
}
