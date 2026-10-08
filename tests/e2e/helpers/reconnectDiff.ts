// The `reconnect` moment's gate (#1268): on real time, so each side's frames fall where its own
// rAF puts them, and both are read against anchors of their own (`Anchors`).
import type { TraceFrame } from "../../../lib/e2eTrace.ts";
import { STEP_MS, type Failure } from "./traceDiff.ts";

/** One frame of jitter, on 60 Hz frames rather than the virtual clock's 16 ms grid. */
export const JITTER_MS = Math.ceil(1000 / 60);
/** An onset's offset spans two of a side's frames: the app's real one that stamped it, up to one dropped frame long, and one of the mockup's virtual steps. */
const onsetJitterMs = (appFrameMs: number) => Math.min(Math.max(JITTER_MS, appFrameMs), 2 * JITTER_MS) + STEP_MS;
/** The grey moves 0.85 in 300 ms: one frame of jitter, and a little. */
export const GREY_TOLERANCE = 0.06;
/** The lamp's phase runs about 0.84 rad/s; frozen, it does not move at all. */
const FROZEN_PH = 1e-3;
const RUNNING_PH = 0.05;
const CURVE_SPAN_MS = 600;

export const RECONNECT_SOUND = { mockup: "sound:reconnect", app: "sound:reconnected" } as const;
type Side = keyof typeof RECONNECT_SOUND;

const onsetAt = (frames: TraceFrame[], name: string, from = -Infinity) =>
  frames.find((f) => f.t >= from && f.onsets.includes(name))?.t ?? null;

const frameEndingAt = (frames: TraceFrame[], t: number) => {
  const i = frames.findIndex((f) => f.t === t);
  return i > 0 ? t - frames[i - 1].t : 0;
};

/** The lamp eases toward 0.55 at a rate of 1: one onset's jitter of its fall, and a little. */
const LEVEL_TOLERANCE = 0.04;
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
const levelAt = (frames: TraceFrame[], t: number) => between(frames, t, (f) => f.lamp?.level ?? 1);

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
  const onsets: [string, keyof Anchors, Record<Side, string>][] = [
    ["the pill's Riconnessione…", "drop", { mockup: "moment:net-net", app: "moment:net-net" }],
    ["the recovery sound", "back", RECONNECT_SOUND],
    ["the pill's Di nuovo in linea clearing", "back", { mockup: "moment:net-", app: "moment:net-" }],
    ["the pill's Riconnessione… again", "again", { mockup: "moment:net-net", app: "moment:net-net" }],
  ];
  for (const [what, anchor, names] of onsets) {
    const got = { mockup: offset("mockup", m[anchor], names.mockup), app: offset("app", a[anchor], names.app) };
    const appFrameMs = got.app === null ? 0 : Math.max(frameEndingAt(sides.app, a[anchor] + got.app), frameEndingAt(sides.app, a[anchor]));
    if (got.mockup === null || got.app === null || Math.abs(got.app - got.mockup) > onsetJitterMs(appFrameMs)) {
      fail("onset", m[anchor] + (got.mockup ?? 0), got.mockup, got.app, `${what}, in ms after the ${anchor}`);
    }
  }

  const curves: [Failure["field"], string, keyof Anchors, typeof greyAt, number, number][] = [
    ["grey", "the grey", "drop", greyAt, GREY_TOLERANCE, CURVE_SPAN_MS],
    ["grey", "the grey", "back", greyAt, GREY_TOLERANCE, CURVE_SPAN_MS],
    ["grey", "the grey", "lost", greyAt, GREY_TOLERANCE, CURVE_SPAN_MS],
    ["level", "the lamp's level", "lost", levelAt, LEVEL_TOLERANCE, LEVEL_SPAN_MS],
  ];
  for (const [field, what, anchor, at, tolerance, span] of curves) {
    for (let d = 0; d <= span; d += STEP_MS * 3) {
      const got = { mockup: at(sides.mockup, m[anchor] + d), app: at(sides.app, a[anchor] + d) };
      if (got.mockup === null || got.app === null || Math.abs(got.app - got.mockup) > tolerance) {
        fail(field, m[anchor] + d, got.mockup, got.app, `${what} ${d} ms after the ${anchor}`);
      }
    }
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
