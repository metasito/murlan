// tests/ui-rules/lampHeld.test.ts — a lamp the rig stops stepping at rest (`endsCarry`) is carried on as stepping would have
// carried it (`resumeLamp`), on the phase the compositor's track plays (`swept`), and read the same by every reader (`LampHold.now`).
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import type { SharedValue } from "react-native-reanimated";
import { createLampHold, lampControls, restingLamp, resumeLamp, stepLamp, steppedLamp, SWAY, SWAY_KICKED, type Lamp } from "../../components/table/lampRig.ts";
import { endsCarry, showsEnd } from "../../components/table/restEnds.ts";
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

  test("draws the sway and flare a kicked, flared lamp has at the span's end, as the frame stepping there draws them", () => {
    const frames = 30;
    const stepped = moving();
    const held = moving();
    for (let i = 0; i < frames; i++) stepLamp(stepped, FRAME, false);
    resumeLamp(held, frames * FRAME, false);
    const one = moving();
    stepLamp(one, FRAME, false);
    const kickFrame = one.kick / moving().kick;
    const flareFrame = one.flare / moving().flare;
    assert.ok(held.kick > 0.1 && held.f > 0.1, `kick ${held.kick}, flare ${held.f}`);
    assert.ok(Math.abs(held.f - held.flare) < 1e-12, `drawn flare ${held.f} vs flare ${held.flare}`);
    assert.ok(Math.abs(stepped.f * flareFrame - held.f) < 1e-9, `stepping drew ${stepped.f} a frame before ${held.f}`);
    const euler = (FRAME / 2) * Math.abs(speedOf(held.t) - speedOf(moving().t)) + 1e-5;
    const sway = (SWAY + SWAY_KICKED * moving().kick) * euler + SWAY_KICKED * held.kick * (1 / kickFrame - 1);
    assert.ok(Math.abs(stepped.lx - held.lx) <= sway, `lx ${stepped.lx} vs ${held.lx}, within ${sway}`);
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

describe("showsEnd", () => {
  test("only a rested lamp, with an end named, under reduced motion too", () => {
    assert.equal(showsEnd(rested(), -1), true);
    assert.equal(showsEnd(rested(), 1), true);
    assert.equal(showsEnd(rested(), 0), false, "no end named");
    assert.equal(showsEnd(moving(), 1), false, "gliding");
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

describe("steppedLamp", () => {
  test("is the rig's own lamp, and its clock", () => {
    const lamp = mutable(rested());
    const rig = steppedLamp(lamp);
    assert.equal(rig.now(), lamp.value);
    assert.equal(rig.clock(), 12);
  });
});

describe("createLampHold", () => {
  function held(reduced = false) {
    let wall = 1000;
    mock.method(performance, "now", () => wall);
    const lamp = mutable(rested());
    const hold = createLampHold(lamp, mutable(reduced));
    hold.hold();
    return { lamp, hold, advance: (ms: number) => void (wall += ms) };
  }

  test("is the rig's own lamp while it steps", () => {
    const lamp = mutable(rested());
    const hold = createLampHold(lamp, mutable(false));
    assert.equal(hold.now(), lamp.get());
    assert.equal(hold.clock(), lamp.get().t);
  });

  test("is the held lamp carried on by the wall's time, its clock the same, and the rig's own lamp left where it was held", () => {
    const { lamp, hold, advance } = held();
    advance(1500);
    const expected = rested();
    resumeLamp(expected, 1.5, false);
    const now = hold.now();
    for (const k of [...FIELDS, "ph", "lx"] as const) assert.ok(Math.abs(now[k] - expected[k]) < 1e-12, k);
    assert.ok(Math.abs(hold.clock() - expected.t) < 1e-12);
    assert.equal(lamp.get().t, 12);
    mock.restoreAll();
  });

  test("resumes the rig's own lamp to where `now` had it, once", () => {
    const { lamp, hold, advance } = held();
    advance(800);
    const ph = hold.now().ph;
    hold.resume(lamp.get());
    assert.equal(hold.held(), false);
    assert.ok(Math.abs(lamp.get().ph - ph) < 1e-12);
    advance(800);
    hold.resume(lamp.get());
    assert.ok(Math.abs(lamp.get().ph - ph) < 1e-12, "a second resume carries nothing");
    mock.restoreAll();
  });

  test("held and resumed between frames, again and again, keeps the rig's clock on the page's", () => {
    let wall = 1000;
    mock.method(performance, "now", () => wall);
    const lamp = mutable(rested());
    const hold = createLampHold(lamp, mutable(false));
    const frame = () => {
      wall += 16;
      if (!hold.held()) stepLamp(lamp.get(), hold.step(wall), false);
    };
    frame();
    const offset = lamp.get().t - wall / 1000;
    for (let cycle = 0; cycle < 20; cycle++) {
      for (let i = 0; i < 5; i++) frame();
      hold.hold();
      for (let i = 0; i < 7; i++) frame();
      wall += 5 + cycle;
      hold.resume(lamp.get());
      wall += 16 * (cycle % 3);
      for (let i = 0; i < 5; i++) frame();
      assert.ok(Math.abs(lamp.get().t - wall / 1000 - offset) < 1e-9, `cycle ${cycle}: the rig's clock is ${((lamp.get().t - wall / 1000 - offset) * 1000).toFixed(3)} ms off the page's`);
      assert.ok(Math.abs(hold.clock() - lamp.get().t) < 1e-12);
    }
    mock.restoreAll();
  });

  test("stops its clock while the page is hidden, as the rig's steps do", () => {
    const { hold, advance } = held();
    advance(500);
    hold.shown(false);
    advance(4000);
    assert.ok(Math.abs(hold.clock() - 12.5) < 1e-12, `hidden: ${hold.clock()}`);
    hold.shown(true);
    advance(250);
    assert.ok(Math.abs(hold.clock() - 12.75) < 1e-12, `shown again: ${hold.clock()}`);
    mock.restoreAll();
  });

  test("held while hidden, runs its clock from when the page shows", () => {
    let wall = 1000;
    mock.method(performance, "now", () => wall);
    const hold = createLampHold(mutable(rested()), mutable(false));
    hold.shown(false);
    wall += 500;
    hold.hold();
    wall += 1500;
    assert.equal(hold.clock(), 12, "hidden");
    hold.shown(true);
    wall += 250;
    assert.ok(Math.abs(hold.clock() - 12.25) < 1e-12, `shown: ${hold.clock()}`);
    mock.restoreAll();
  });

  test("honours reduced motion", () => {
    const { hold, advance } = held(true);
    advance(300);
    const now = hold.now();
    assert.equal(now.lx, now.x);
    assert.equal(now.f, 0);
    mock.restoreAll();
  });
});
