// tests/ui-rules/lampHeld.test.ts — a lamp the rig stops stepping at rest (`endsCarry`) is carried on as stepping would have
// carried it (`resumeLamp`), on the phase the compositor's track plays (`swept`), and read the same by every reader (`GlossTracks.now`).
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import type { SharedValue } from "react-native-reanimated";
import { lampControls, restingLamp, resumeLamp, stepLamp, type Lamp } from "../../components/table/lampRig.ts";
import { endsCarry } from "../../components/table/restEnds.ts";
import { createGlossTracks } from "../../components/table/glossTrackStore.ts";
import { speedOf, swept } from "../../lib/swayTable.ts";

const FRAME = 1 / 60;

function moving(): Lamp {
  const s = restingLamp([437, 180, 1], 0.8);
  s.t = 7.3;
  s.ph = 0.4;
  lampControls.setTarget(s, [300, 210, 1.2], false);
  lampControls.hold(s, "lost", null, 3);
  s.lvlT = 1;
  s.flare = 0.6;
  s.kick = 0.4;
  return s;
}

function rested(): Lamp {
  const s = restingLamp([437, 180, 1]);
  s.t = 12;
  s.ph = 1.1;
  return s;
}

function mutable<T>(value: T): SharedValue<T> {
  const v = { value, get: () => v.value, set: (next: T) => void (v.value = next) };
  return v as unknown as SharedValue<T>;
}

const FIELDS = ["t", "x", "y", "r", "lvl", "level", "kick", "flare", "ly"] as const;

describe("resumeLamp", () => {
  test("carries everything but the phase exactly as continuous stepping would, and the phase to within stepping's own error", () => {
    for (const reduced of [false, true]) {
      const stepped = moving();
      const held = moving();
      const frames = 90;
      for (let i = 0; i < frames + 1; i++) stepLamp(stepped, FRAME, reduced);
      resumeLamp(held, frames * FRAME, reduced);
      stepLamp(held, FRAME, reduced);
      for (const k of FIELDS) assert.ok(Math.abs(stepped[k] - held[k]) < 1e-9, `${k} under reduced ${reduced}: ${stepped[k]} vs ${held[k]}`);
      const euler = (FRAME / 2) * Math.abs(speedOf(held.t) - speedOf(moving().t)) + 1e-5;
      assert.ok(Math.abs(stepped.ph - held.ph) <= euler, `phase ${stepped.ph} vs ${held.ph}, Euler's ${euler}`);
    }
  });

  test("carried in pieces lands where it lands carried at once", () => {
    const once = moving();
    const pieces = moving();
    resumeLamp(once, 2.5, false);
    for (let i = 0; i < 10; i++) resumeLamp(pieces, 0.25, false);
    stepLamp(once, FRAME, false);
    stepLamp(pieces, FRAME, false);
    for (const k of [...FIELDS, "ph", "lx"] as const) assert.ok(Math.abs(once[k] - pieces[k]) < 1e-9, `${k}: ${once[k]} vs ${pieces[k]}`);
  });

  test("under reduced motion draws no sway and no flare, from its first frame", () => {
    const s = moving();
    resumeLamp(s, 0.4, true);
    assert.equal(s.lx, s.x);
    assert.equal(s.f, 0);
    assert.equal(s.x, s.tx);
  });

  test("a lamp frozen runs no phase", () => {
    const s = moving();
    lampControls.freeze(s, 1);
    const ph = s.ph;
    resumeLamp(s, 3, false);
    assert.equal(s.ph, ph);
  });
});

describe("swept", () => {
  test("is the integral of speedOf", () => {
    for (const [from, to] of [
      [0, 1],
      [7.3, 19.8],
      [120, 121.5],
      [40, 40],
    ] as const) {
      const n = 20_000;
      const h = (to - from) / n;
      let sum = speedOf(from) + speedOf(to);
      for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * speedOf(from + i * h);
      const simpson = (h / 3) * sum;
      assert.ok(Math.abs(swept(from, to) - simpson) < 1e-9, `${from}..${to}: ${swept(from, to)} vs ${simpson}`);
    }
  });
});

describe("endsCarry", () => {
  test("only a rested lamp, with an end shown, under motion", () => {
    assert.equal(endsCarry(rested(), -1, false), true);
    assert.equal(endsCarry(rested(), 1, false), true);
    assert.equal(endsCarry(rested(), -1, true), false, "reduced motion");
    assert.equal(endsCarry(rested(), 0, false), false, "no end shown");
    assert.equal(endsCarry(moving(), -1, false), false, "gliding");
  });
});

describe("GlossTracks.now", () => {
  function held(reduced = false) {
    let wall = 1000;
    mock.method(performance, "now", () => wall);
    const lamp = mutable(rested());
    const tracks = createGlossTracks(lamp, mutable({ lx: 0, ly: 0, level: 1, r: 1, t: 0 }), mutable(-1), mutable(reduced), rested());
    tracks.hold();
    return { lamp, tracks, advance: (ms: number) => void (wall += ms) };
  }

  test("is the rig's own lamp while it steps", () => {
    const lamp = mutable(rested());
    const tracks = createGlossTracks(lamp, mutable({ lx: 0, ly: 0, level: 1, r: 1, t: 0 }), mutable(0), mutable(false), rested());
    assert.equal(tracks.now(), lamp.get());
    assert.equal(tracks.clock(), lamp.get().t);
  });

  test("is the held lamp carried on by the wall's time, its clock the same, and the rig's own lamp left where it was held", () => {
    const { lamp, tracks, advance } = held();
    advance(1500);
    const expected = rested();
    resumeLamp(expected, 1.5, false);
    const now = tracks.now();
    for (const k of [...FIELDS, "ph", "lx"] as const) assert.ok(Math.abs(now[k] - expected[k]) < 1e-12, k);
    assert.ok(Math.abs(tracks.clock() - expected.t) < 1e-12);
    assert.equal(lamp.get().t, 12);
    mock.restoreAll();
  });

  test("resumes the rig's own lamp to where `now` had it, once", () => {
    const { lamp, tracks, advance } = held();
    advance(800);
    const ph = tracks.now().ph;
    tracks.resume(lamp.get());
    assert.equal(tracks.held(), false);
    assert.ok(Math.abs(lamp.get().ph - ph) < 1e-12);
    advance(800);
    tracks.resume(lamp.get());
    assert.ok(Math.abs(lamp.get().ph - ph) < 1e-12, "a second resume carries nothing");
    mock.restoreAll();
  });

  test("stops its clock while the page is hidden, as the rig's steps do", () => {
    const { tracks, advance } = held();
    advance(500);
    tracks.shown(false);
    advance(4000);
    assert.ok(Math.abs(tracks.clock() - 12.5) < 1e-12, `hidden: ${tracks.clock()}`);
    tracks.shown(true);
    advance(250);
    assert.ok(Math.abs(tracks.clock() - 12.75) < 1e-12, `shown again: ${tracks.clock()}`);
    mock.restoreAll();
  });

  test("honours reduced motion", () => {
    const { tracks, advance } = held(true);
    advance(300);
    const now = tracks.now();
    assert.equal(now.lx, now.x);
    assert.equal(now.f, 0);
    mock.restoreAll();
  });
});
