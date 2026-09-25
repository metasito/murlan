// The fidelity harness's gate (#1255): the mockup's trace against the app's. Pure, so
// tests/ui-rules/traceDiff.test.ts plants a divergence per field.
import type { TraceFrame } from "../../../lib/e2eTrace.ts";

export type { TraceFrame };

export const STEP_MS = 16;

export interface RegionSample {
  t: number;
  regions: Record<string, number>;
}

export interface Trace {
  frames: TraceFrame[];
  regions: RegionSample[];
}

export type Field =
  | "frames"
  | "onset"
  | "live"
  | "dropped"
  | "lamp"
  | "level"
  | "flare"
  | "shake"
  | "brightness"
  | "scorePill";

export interface Failure {
  field: Field;
  t: number;
  mockup: unknown;
  app: unknown;
  message: string;
  region?: string;
}

export type PillBox =Omit<NonNullable<TraceFrame["scorePill"]>, "open">;

/** The #1250 findings' proposal; the owner confirms them on the owner-review ticket. */
export const TOLERANCES = {
  onsetMs: STEP_MS,
  countRatio: 0.1,
  lampPt: 4,
  level: 0.03,
  shakePeakRatio: 0.1,
  shakeEndMs: STEP_MS,
  brightness: 6,
  pillPt: 1,
};

const PILL_OPEN = 0.999;

function pillOff(a: PillBox, m: PillBox): number {
  return Math.max(Math.abs(a.x - m.x), Math.abs(a.y - m.y), Math.abs(a.w - m.w), Math.abs(a.h - m.h));
}

const SHAKE_REST = 0.01;

function frameAt(trace: Trace, t: number): TraceFrame | undefined {
  return trace.frames.find((f) => Math.abs(f.t - t) < STEP_MS / 2);
}

function onsetTimes(trace: Trace): Map<string, number> {
  const seen = new Map<string, number>();
  for (const f of trace.frames) {
    for (const name of f.onsets) {
      let n = 0;
      while (seen.has(`${name}#${n}`)) n++;
      seen.set(`${name}#${n}`, f.t);
    }
  }
  return seen;
}

const offBy = (app: number, mockup: number, ratio: number) => Math.abs(app - mockup) > ratio * Math.abs(mockup);

function peak(trace: Trace, read: (f: TraceFrame) => number): { t: number; value: number } {
  let best = { t: 0, value: -Infinity };
  for (const f of trace.frames) if (read(f) > best.value) best = { t: f.t, value: read(f) };
  return best;
}

const shakeSize = (f: TraceFrame) => (f.shake ? Math.hypot(f.shake.x, f.shake.y) : 0);
const shakeTurn = (f: TraceFrame) => (f.shake ? Math.abs(f.shake.rotate) : 0);

function shakeEnd(trace: Trace): number {
  let end = -Infinity;
  for (const f of trace.frames) if (shakeSize(f) > SHAKE_REST || shakeTurn(f) > SHAKE_REST) end = f.t;
  return end;
}

export function diffTraces(
  mockup: Trace,
  app: Trace,
  checkpoints: readonly number[],
  tol: typeof TOLERANCES = TOLERANCES
): Failure[] {
  const out: Failure[] = [];
  const fail = (field: Field, t: number, m: unknown, a: unknown, message: string) =>
    out.push({ field, t, mockup: m, app: a, message });

  const mOn = onsetTimes(mockup);
  const aOn = onsetTimes(app);
  for (const key of new Set([...mOn.keys(), ...aOn.keys()])) {
    const m = mOn.get(key);
    const a = aOn.get(key);
    if (m === undefined || a === undefined) fail("onset", m ?? a!, m, a, `${key} fired on one side only`);
    else if (Math.abs(a - m) >= tol.onsetMs) fail("onset", a, m, a, `${key} at ${a} ms, the mockup's at ${m} ms`);
  }

  for (const t of checkpoints) {
    const m = frameAt(mockup, t);
    const a = frameAt(app, t);
    if (!m || !a) {
      fail("frames", t, !!m, !!a, `no frame at ${t} ms on the ${m ? "app" : "mockup"} side`);
      continue;
    }
    for (const field of ["live", "dropped"] as const) {
      if (offBy(a[field], m[field], tol.countRatio)) fail(field, t, m[field], a[field], `${field} ${a[field]} against ${m[field]}`);
    }
    if (!m.lamp || !a.lamp) {
      if (m.lamp !== a.lamp) fail("lamp", t, m.lamp, a.lamp, "a lamp on one side only");
    } else {
      const d = Math.hypot(a.lamp.x - m.lamp.x, a.lamp.y - m.lamp.y);
      if (d > tol.lampPt) fail("lamp", t, m.lamp, a.lamp, `lamp ${d.toFixed(1)} pt off`);
      for (const k of ["level", "flare"] as const) {
        const mv = m.lamp[k];
        const av = a.lamp[k];
        if (mv === null || av === null) {
          if (mv !== av) fail(k, t, mv, av, `lamp ${k} on one side only`);
        } else if (Math.abs(av - mv) > tol.level) fail(k, t, mv, av, `lamp ${k} ${av} against ${mv}`);
      }
    }
    if (!m.shake !== !a.shake) fail("shake", t, m.shake, a.shake, "a shake on one side only");
    if (!m.scorePill || !a.scorePill) {
      if (m.scorePill !== a.scorePill) fail("scorePill", t, m.scorePill, a.scorePill, "a score pill on one side only");
    } else {
      const d = pillOff(a.scorePill, m.scorePill);
      if (d > tol.pillPt) fail("scorePill", t, m.scorePill, a.scorePill, `score pill ${d.toFixed(1)} pt off`);
    }
  }

  for (const field of ["live", "dropped"] as const) {
    const m = peak(mockup, (f) => f[field]);
    const a = peak(app, (f) => f[field]);
    if (offBy(a.value, m.value, tol.countRatio)) fail(field, a.t, m.value, a.value, `${field} peak ${a.value} against ${m.value}`);
  }

  for (const read of [shakeSize, shakeTurn]) {
    const m = peak(mockup, read);
    const a = peak(app, read);
    if (offBy(a.value, m.value, tol.shakePeakRatio)) fail("shake", a.t, m.value, a.value, `shake peak ${a.value} against ${m.value}`);
  }
  const mEnd = shakeEnd(mockup);
  const aEnd = shakeEnd(app);
  if (mEnd !== aEnd && !(Math.abs(aEnd - mEnd) < tol.shakeEndMs)) {
    fail("shake", aEnd, mEnd, aEnd, `shake ends at ${aEnd} ms, the mockup's at ${mEnd} ms`);
  }

  for (const m of mockup.regions) {
    const a = app.regions.find((r) => Math.abs(r.t - m.t) < STEP_MS / 2);
    for (const [name, mv] of Object.entries(m.regions)) {
      const av = a?.regions[name];
      if (av === undefined || Math.abs(av - mv) > tol.brightness) {
        out.push({ field: "brightness", t: m.t, mockup: mv, app: av, message: `${name} ${av?.toFixed(1)} against ${mv.toFixed(1)}`, region: name });
      }
    }
  }
  return out;
}

/** Each app frame's pill box against the mockup's `renderScore` at that frame's own open progress. */
export function diffPillAtProgress(
  app: Trace,
  mockupAt: (open: number) => PillBox,
  tol: typeof TOLERANCES = TOLERANCES
): Failure[] {
  const out: Failure[] = [];
  const traced = app.frames.filter((f) => f.scorePill);
  const widest = Math.max(-Infinity, ...traced.map((f) => f.scorePill!.open));
  if (!(widest >= PILL_OPEN)) {
    out.push({ field: "scorePill", t: 0, mockup: 1, app: widest, message: `the pill opened only to ${widest}` });
  }
  for (const f of traced) {
    const m = mockupAt(f.scorePill!.open);
    const d = pillOff(f.scorePill!, m);
    if (d > tol.pillPt) {
      out.push({ field: "scorePill", t: f.t, mockup: m, app: f.scorePill, message: `score pill ${d.toFixed(1)} pt off at open ${f.scorePill!.open}` });
    }
  }
  return out;
}

/** The fields whose value changes somewhere in the window — a determinism entry's proof it recorded something. */
export function movingFields(trace: Trace): Set<Field> {
  const moved = new Set<Field>();
  const [first] = trace.frames;
  const differs = (read: (f: TraceFrame) => unknown) =>
    trace.frames.some((f) => JSON.stringify(read(f)) !== JSON.stringify(read(first)));
  if (trace.frames.some((f) => f.onsets.length > 0)) moved.add("onset");
  if (first) {
    if (differs((f) => f.live)) moved.add("live");
    if (differs((f) => f.dropped)) moved.add("dropped");
    if (differs((f) => f.lamp && [f.lamp.x, f.lamp.y])) moved.add("lamp");
    if (differs((f) => f.lamp?.level)) moved.add("level");
    if (differs((f) => f.lamp?.flare)) moved.add("flare");
    if (differs((f) => f.shake)) moved.add("shake");
    if (differs((f) => f.scorePill && [f.scorePill.x, f.scorePill.y, f.scorePill.w, f.scorePill.h])) moved.add("scorePill");
  }
  const [r0] = trace.regions;
  if (r0 && trace.regions.some((r) => JSON.stringify(r.regions) !== JSON.stringify(r0.regions))) moved.add("brightness");
  return moved;
}
