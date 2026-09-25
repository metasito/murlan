// The fidelity harness's gate (#1255): the mockup's trace against the app's, field by field.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  diffPillAtProgress,
  diffTraces,
  movingFields,
  STEP_MS,
  TOLERANCES,
  type Trace,
  type TraceFrame,
} from "../e2e/helpers/traceDiff.ts";

const CHECKPOINTS = [0, 160, 320, 480];

function reference(): Trace {
  const frames: TraceFrame[] = [];
  for (let t = 0; t <= 480; t += STEP_MS) {
    frames.push({
      t,
      onsets: t === 32 ? ["sound:bomb", "moment:bomb"] : t === 96 ? ["haptic:hapticHeavy"] : [],
      live: t < 64 ? 40 : 100,
      dropped: t < 200 ? 0 : 10,
      lamp: { x: 457 + t / 10, y: 292, level: 1 - t / 1000, flare: t / 1000 },
      shake: t <= 256 ? { x: 9 - t / 32, y: 4, rotate: 1.3 } : { x: 0, y: 0, rotate: 0 },
      scorePill: { x: 722.2, y: 13.4, w: 124, h: 23.7, open: 0 },
    });
  }
  const regions = CHECKPOINTS.map((t) => ({
    t,
    regions: { pool: 120 + t / 10, rim: 40, rightBand: 12, pile: 90, scorePill: 60 },
  }));
  return { frames, regions };
}

function planted(edit: (trace: Trace) => void): Trace {
  const trace = structuredClone(reference());
  edit(trace);
  return trace;
}

const at = (trace: Trace, t: number) => trace.frames.find((f) => f.t === t)!;
const fieldsOf = (trace: Trace) => new Set(diffTraces(reference(), trace, CHECKPOINTS).map((f) => f.field));

describe("diffTraces", () => {
  test("a trace matches itself", () => {
    assert.deepEqual(diffTraces(reference(), reference(), CHECKPOINTS), []);
  });

  test("an onset one step late fails, and only on the onset", () => {
    const late = planted((tr) => {
      at(tr, 32).onsets = ["moment:bomb"];
      at(tr, 48).onsets = ["sound:bomb"];
    });
    assert.deepEqual(fieldsOf(late), new Set(["onset"]));
  });

  test("an onset one side never made fails", () => {
    const missing = planted((tr) => (at(tr, 96).onsets = []));
    assert.deepEqual(fieldsOf(missing), new Set(["onset"]));
  });

  test("a live count 11% off at one checkpoint fails; 9% passes", () => {
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 320).live = 111))), new Set(["live"]));
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 320).live = 109))), new Set());
  });

  test("a peak 11% high between checkpoints fails on the peak", () => {
    const failures = diffTraces(reference(), planted((tr) => (at(tr, 400).live = 111)), CHECKPOINTS);
    assert.deepEqual(failures.map((f) => [f.field, f.t]), [["live", 400]]);
  });

  test("a dropped count 11% off fails", () => {
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 480).dropped = 11.1))), new Set(["dropped"]));
  });

  test("a lamp 5 pt off fails; 3 pt passes", () => {
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 160).lamp!.y += 5))), new Set(["lamp"]));
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 160).lamp!.x += 3))), new Set());
  });

  test("a lamp level 0.04 off fails, and a flare 0.04 off", () => {
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 480).lamp!.level! += 0.04))), new Set(["level"]));
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 0).lamp!.flare! += 0.04))), new Set(["flare"]));
  });

  test("a lamp one side has no source for fails", () => {
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 0).lamp!.level = null))), new Set(["level"]));
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 160).lamp = null))), new Set(["lamp"]));
  });

  test("a shake peak 11% high fails", () => {
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 0).shake!.x = 9 * 1.11 + 0.5))), new Set(["shake"]));
  });

  test("a shake ending one step late fails", () => {
    const late = planted((tr) => (at(tr, 272).shake = { x: 0.5, y: 0, rotate: 0 }));
    assert.deepEqual(fieldsOf(late), new Set(["shake"]));
  });

  test("region brightness 7/255 off fails; 5/255 passes", () => {
    assert.deepEqual(fieldsOf(planted((tr) => (tr.regions[2].regions.pile += 7))), new Set(["brightness"]));
    assert.deepEqual(fieldsOf(planted((tr) => (tr.regions[2].regions.pile -= 5))), new Set());
  });

  test("a failing region is named on its failure", () => {
    const failures = diffTraces(reference(), planted((tr) => (tr.regions[1].regions.scorePill += 7)), CHECKPOINTS);
    assert.deepEqual(failures.map((f) => f.region), ["scorePill"]);
  });

  test("a score pill 1.5 pt off at a checkpoint fails; 0.5 pt passes; one side only fails", () => {
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 160).scorePill!.w += 1.5))), new Set(["scorePill"]));
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 160).scorePill!.x -= 0.5))), new Set());
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 480).scorePill = null))), new Set(["scorePill"]));
  });

  test("a checkpoint the app never reached fails rather than passing on nothing", () => {
    const short = planted((tr) => (tr.frames = tr.frames.filter((f) => f.t < 300)));
    assert.ok(fieldsOf(short).has("frames"));
  });

  test("the tolerances are the findings' proposal", () => {
    assert.deepEqual(TOLERANCES, {
      onsetMs: STEP_MS,
      countRatio: 0.1,
      lampPt: 4,
      level: 0.03,
      shakePeakRatio: 0.1,
      shakeEndMs: STEP_MS,
      brightness: 6,
      pillPt: 1,
    });
  });
});

describe("diffPillAtProgress", () => {
  const box = (open: number) => ({ x: 846.2 - (124 + 112 * open), y: 13.4, w: 124 + 112 * open, h: 23.7 + 104.3 * open });
  const opening = (): Trace => ({
    frames: [0, 0, 0.4, 0.9, 1.08, 1].map((open, i) => ({ ...reference().frames[i], scorePill: { ...box(open), open } })),
    regions: [],
  });
  const mockupAt = (open: number) => box(open);

  test("an app box on the mockup's at every progress it passed through passes", () => {
    assert.deepEqual(diffPillAtProgress(opening(), mockupAt), []);
  });

  test("a box 1.5 pt off at one progress fails there", () => {
    const off = opening();
    off.frames[3].scorePill!.h += 1.5;
    assert.deepEqual(diffPillAtProgress(off, mockupAt).map((f) => [f.field, f.t]), [["scorePill", off.frames[3].t]]);
  });

  test("a pill that never opened fails rather than passing at rest", () => {
    const shut = opening();
    for (const f of shut.frames) f.scorePill = { ...box(0), open: 0 };
    assert.equal(diffPillAtProgress(shut, mockupAt).length, 1);
  });
});

describe("movingFields", () => {
  test("names every field that changes over the window, and no other", () => {
    assert.deepEqual(
      movingFields(reference()),
      new Set(["onset", "live", "dropped", "lamp", "level", "flare", "shake", "brightness"])
    );
    const opened = planted((tr) => (at(tr, 480).scorePill!.w = 236));
    assert.ok(movingFields(opened).has("scorePill"));
  });

  test("a still trace moves nothing", () => {
    const still = planted((tr) => {
      for (const f of tr.frames) Object.assign(f, { ...tr.frames[0], t: f.t, onsets: [] });
      for (const r of tr.regions) r.regions = { ...tr.regions[0].regions };
    });
    assert.deepEqual(movingFields(still), new Set());
  });
});
