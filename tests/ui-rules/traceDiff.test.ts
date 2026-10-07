// The fidelity harness's gate (#1255): the mockup's trace against the app's, field by field.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  diffAir,
  diffApart,
  diffFlight,
  diffMoth,
  diffOnsetWindows,
  diffPillAtProgress,
  diffStillAir,
  diffTraces,
  movingFields,
  STEP_MS,
  TOLERANCES,
  type Field,
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
      lamp: { x: 457 + t / 10, y: 292, level: 1 - t / 1000, flare: t / 1000, r: 1 + t / 2000 },
      shake: t <= 256 ? { x: 9 - t / 32, y: 4, rotate: 1.3 } : { x: 0, y: 0, rotate: 0 },
      scorePill: { x: 722.2, y: 13.4, w: 124, h: 23.7, open: 0 },
      flight: 0,
      motes: 12,
      moth: null,
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

  test("a reach that moves a point 5 pt at the table's width fails; 3 pt passes", () => {
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 320).lamp!.r += 5 / 874))), new Set(["lamp"]));
    assert.deepEqual(fieldsOf(planted((tr) => (at(tr, 320).lamp!.r -= 3 / 874))), new Set());
    assert.deepEqual(fieldsOf(planted((tr) => delete (at(tr, 320).lamp as Partial<{ r: number }>).r)), new Set(["lamp"]));
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
      contactPt: 1,
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

describe("the flight field", () => {
  const withFlight = (start: number, contact: number, from = 120): Trace => {
    const t = reference();
    for (const f of t.frames) {
      f.flight = f.t < start ? 0 : f.t >= contact ? 0.5 : from * (1 - (f.t - start) / (contact - start)) + 0.6;
    }
    return t;
  };

  test("the same flight on both sides passes", () => {
    assert.deepEqual(diffFlight(withFlight(32, 336), withFlight(32, 336)), []);
  });

  test("an app flight that touches down 32 ms late fails", () => {
    const failures = diffFlight(withFlight(32, 336), withFlight(32, 368));
    assert.ok(failures.some((f) => f.field === "flight" && /contact/.test(f.message)), JSON.stringify(failures));
  });

  test("a flight on one side only fails", () => {
    const none = reference();
    for (const f of none.frames) f.flight = 0;
    assert.ok(diffFlight(withFlight(32, 336), none).some((f) => /one side/.test(f.message)));
  });
});

describe("the moth field", () => {
  const withMoth = (from: number, until = 4000, sway = 0, off = 0): Trace => {
    const t = reference();
    for (const f of t.frames) {
      const q = (f.t - from) / 4000;
      if (q < 0 || f.t > from + until) continue;
      f.lamp = { ...f.lamp!, x: f.lamp!.x + sway };
      f.moth = { x: f.lamp.x - 130 + q * 270 + Math.sin(q * 30) * 14 + off, y: f.lamp.y - 50 + Math.cos(q * 23) * 18 };
    }
    return t;
  };

  test("the same crossing passes wherever each side's moth set off and wherever its light hung", () => {
    assert.deepEqual(diffMoth(withMoth(32), withMoth(160, 4000, 30)), []);
  });

  test("a moth 6 pt off the mockup's path fails", () => {
    const failures = diffMoth(withMoth(32), withMoth(160, 4000, 0, 6));
    assert.ok(failures.length > 0 && failures.every((f) => f.field === "moth" && /off the mockup's path/.test(f.message)), JSON.stringify(failures));
  });

  test("a moth on one side only, or one gone after a frame, fails", () => {
    assert.ok(diffMoth(withMoth(32), reference()).some((f) => /one side/.test(f.message)));
    assert.ok(diffMoth(withMoth(32, 160), withMoth(32, 16)).some((f) => /frames/.test(f.message)));
  });

  test("an onset is held to its window, and one that never fires fails", () => {
    const window = { "moment:bomb": [16, 48] as const };
    assert.deepEqual(diffOnsetWindows(reference(), window), []);
    assert.match(diffOnsetWindows(reference(), { "moment:bomb": [64, 128] })[0].message, /outside/);
    assert.match(diffOnsetWindows(reference(), { "moment:moth": [0, 480] })[0].message, /never fired/);
  });

  test("two particle-layer frames apart must both draw and differ", () => {
    const drawn = (t: number, sha1: string) => ({ t, sha1, drawn: true });
    assert.deepEqual(diffApart([drawn(0, "a"), drawn(15000, "b")], [0, 15000]), []);
    assert.match(diffApart([drawn(0, "a"), drawn(15000, "a")], [0, 15000])[0].message, /is the one at/);
    assert.match(diffApart([drawn(0, "a"), { t: 15000, sha1: "b", drawn: false }], [0, 15000])[0].message, /drew nothing/);
    assert.match(diffApart([drawn(0, "a")], [0, 15000])[0].message, /no particle layer sample/);
  });

  test("under reduced motion the air holds: the same motes lit every frame, and no moth", () => {
    assert.deepEqual(diffStillAir(reference()), []);
    assert.match(diffStillAir(planted((t) => (at(t, 160).motes = 13)))[0].message, /13 motes at 160 ms/);
    assert.match(diffStillAir(planted((t) => t.frames.forEach((f) => (f.motes = 0))))[0].message, /none lit/);
    assert.match(diffStillAir(withMoth(32))[0].message, /a moth at 32 ms/);
  });

  test("a moment's air is held by the fields it names, and by the fallback's still light", () => {
    const spec = { onsetWindows: { "moment:moth": [0, 480] as const }, apart: [0, 15000] as const, fallbackStill: true };
    const held = (...fields: Field[]) => new Set<Field>(fields);
    const fails = (h: Set<Field>, fallback: boolean, app: Trace) => diffAir(spec, h, fallback, withMoth(32), app, []).map((f) => f.message);
    assert.deepEqual(fails(held(), false, reference()), []);
    assert.deepEqual(fails(held("onset"), false, withMoth(32)), ["moment:moth never fired"]);
    assert.ok(fails(held("moth"), false, reference()).some((m) => /one side/.test(m)));
    assert.deepEqual(fails(held("air"), false, withMoth(32)), ["no particle layer sample at 0 ms"]);
    assert.deepEqual(fails(held(), true, withMoth(32)), ["a moth at 32 ms"]);
  });
});
