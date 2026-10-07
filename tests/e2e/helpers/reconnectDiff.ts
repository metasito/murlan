// The `reconnect` moment's gate (#1268): on real time, so each side's frames fall where its own
// rAF puts them, and both are read against two anchors of their own: the drop and the way back.
import type { TraceFrame } from "../../../lib/e2eTrace.ts";
import { STEP_MS, type Failure } from "./traceDiff.ts";

/** One frame of jitter, on 60 Hz frames rather than the virtual clock's 16 ms grid. */
export const JITTER_MS = Math.ceil(1000 / 60);
/** An onset's offset spans two of a side's frames: one frame of the app's real ones, and one of the mockup's virtual steps. */
const ONSET_JITTER_MS = JITTER_MS + STEP_MS;
/** The grey moves 0.85 in 300 ms: one frame of jitter, and a little. */
export const GREY_TOLERANCE = 0.06;
/** The lamp's phase runs about 0.84 rad/s; frozen, it does not move at all. */
const FROZEN_PH = 1e-3;
const RUNNING_PH = 0.05;
const GREY_SPAN_MS = 600;

export const RECONNECT_SOUND = { mockup: "sound:reconnect", app: "sound:reconnected" } as const;
type Side = keyof typeof RECONNECT_SOUND;

const onsetAt = (frames: TraceFrame[], name: string, from = -Infinity) =>
  frames.find((f) => f.t >= from && f.onsets.includes(name))?.t ?? null;

/** The grey at `t`, between the frames either side of it. */
export function greyAt(frames: TraceFrame[], t: number): number | null {
  const after = frames.findIndex((f) => f.t >= t);
  if (after <= 0) return after === 0 && frames[0].t === t ? (frames[0].grey ?? 0) : null;
  const [a, b] = [frames[after - 1], frames[after]];
  const k = (t - a.t) / (b.t - a.t);
  return (a.grey ?? 0) + ((b.grey ?? 0) - (a.grey ?? 0)) * k;
}

const phSpan = (frames: TraceFrame[], from: number, to: number) => {
  const ph = frames.filter((f) => f.t >= from && f.t <= to && f.lamp?.ph !== undefined).map((f) => f.lamp!.ph!);
  return ph.length < 2 ? null : Math.max(...ph) - Math.min(...ph);
};

export interface Anchors {
  drop: number;
  back: number;
}

export function anchorsOf(frames: TraceFrame[]): Anchors | null {
  const drop = onsetAt(frames, "moment:drop");
  const back = drop === null ? null : onsetAt(frames, "moment:net-ok", drop);
  return drop === null || back === null ? null : { drop, back };
}

/** Each side's frames on the mockup's chapter clock: before the way back from its drop, after it from its return. */
export function onChapterClock(frames: TraceFrame[], own: Anchors, chapter: Anchors): TraceFrame[] {
  return frames.map((f) => ({ ...f, t: Math.round(f.t < own.back ? f.t - own.drop + chapter.drop : f.t - own.back + chapter.back) }));
}

export function diffReconnect(sides: Record<Side, TraceFrame[]>): Failure[] {
  const failures: Failure[] = [];
  const fail = (field: Failure["field"], t: number, mockup: unknown, app: unknown, message: string) =>
    failures.push({ field, t, mockup, app, message });
  const anchors = { mockup: anchorsOf(sides.mockup), app: anchorsOf(sides.app) };
  if (!anchors.mockup || !anchors.app) {
    fail("onset", 0, anchors.mockup, anchors.app, "both sides drop and come back");
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
  ];
  for (const [what, anchor, names] of onsets) {
    const got = { mockup: offset("mockup", m[anchor], names.mockup), app: offset("app", a[anchor], names.app) };
    if (got.mockup === null || got.app === null || Math.abs(got.app - got.mockup) > ONSET_JITTER_MS) {
      fail("onset", m[anchor] + (got.mockup ?? 0), got.mockup, got.app, `${what}, in ms after the ${anchor}`);
    }
  }

  for (const anchor of ["drop", "back"] as const) {
    for (let d = 0; d <= GREY_SPAN_MS; d += STEP_MS * 3) {
      const got = { mockup: greyAt(sides.mockup, m[anchor] + d), app: greyAt(sides.app, a[anchor] + d) };
      if (got.mockup === null || got.app === null || Math.abs(got.app - got.mockup) > GREY_TOLERANCE) {
        fail("grey", m[anchor] + d, got.mockup, got.app, `the grey ${d} ms after the ${anchor}`);
      }
    }
  }

  for (const side of ["mockup", "app"] as const) {
    const own = anchors[side]!;
    const held = phSpan(sides[side], own.drop + 2 * JITTER_MS, own.back - JITTER_MS);
    if (held === null || held > FROZEN_PH) fail("freeze", m.drop, side === "mockup" ? held : null, side === "app" ? held : null, `${side}: the lamp's phase stands still while held`);
    const after = phSpan(sides[side], own.back + 2 * JITTER_MS, own.back + GREY_SPAN_MS);
    if (after === null || after < RUNNING_PH) fail("freeze", m.back, side === "mockup" ? after : null, side === "app" ? after : null, `${side}: the lamp's phase runs on once back`);
  }
  return failures;
}
