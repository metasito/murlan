// tests/ui-rules/swayTable.test.ts — the baked sway table against the mockup's own stepping of the sway.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  HALF_SWINGS,
  STEPS,
  SWAY_LOOP,
  SWAY_REST_AT,
  SWAY_TIMES,
  SWAY_VS_INTEGRAL,
  TRACK_SECONDS,
  TRACK_STEP,
  TRACK_VS_EULER,
  bakeSway,
  swayAt,
  swayPhase,
  trackAt,
  swayTimeOf,
} from "../../lib/swayTable.ts";

const omega = (t: number) => 0.84 * (1 + 0.14 * Math.sin(t * 0.11 + 1.3) + 0.06 * Math.sin(t * 0.37));
/** The largest swing the lamp makes: the sway plus a full kick. */
const LARGEST = 100;
const DT = 1 / 60;

/** The most the table is off the sway the mockup steps at 60 Hz (`lampStep`), over one loop from the rig's start. */
function worstAgainstMockup(): number {
  let ph = 0;
  let worst = 0;
  for (let t = DT; t < SWAY_LOOP - SWAY_REST_AT; t += DT) {
    ph += DT * omega(t);
    worst = Math.max(worst, Math.abs(Math.sin(ph) - swayAt(t + SWAY_REST_AT)));
  }
  return worst;
}

describe("the sway table", () => {
  test("is 80 half-swings of about five minutes", () => {
    assert.equal(SWAY_TIMES.length, HALF_SWINGS * STEPS + 1);
    assert.ok(SWAY_LOOP > 290 && SWAY_LOOP < 300, `a loop of ${SWAY_LOOP} s`);
  });

  test("differs from the mockup's 60 Hz sway by SWAY_VS_INTEGRAL over one loop, and no more", () => {
    const worst = worstAgainstMockup();
    assert.ok(worst <= SWAY_VS_INTEGRAL, `the table is ${worst} off the mockup, above the pinned ${SWAY_VS_INTEGRAL}`);
    assert.ok((SWAY_VS_INTEGRAL - worst) * LARGEST < 0.01, `${SWAY_VS_INTEGRAL} is more than 0.01 pt looser than the measured ${worst}`);
  });

  test("crosses 0 at phase 0 where the mockup starts, and its phase follows the sway", () => {
    assert.ok(Math.abs(swayAt(SWAY_REST_AT)) < 1e-12);
    assert.ok(Math.abs(swayPhase(SWAY_REST_AT)) < 1e-12);
    let last = swayPhase(SWAY_REST_AT);
    for (let t = SWAY_REST_AT; t < SWAY_LOOP; t += 0.05) {
      const ph = swayPhase(t);
      assert.ok(ph >= last, `phase went back at ${t}`);
      assert.ok(Math.abs(Math.sin(ph) - swayAt(t)) < 1e-3, `at ${t}`);
      last = ph;
    }
  });

  test("swayTimeOf is the inverse of swayPhase, for any number of loops in", () => {
    for (let t = 0; t < SWAY_LOOP; t += 0.37) assert.ok(Math.abs(swayTimeOf(swayPhase(t)) - t) < 1e-6, `at ${t}`);
    assert.ok(Math.abs(swayTimeOf(swayPhase(12.5) + 80 * Math.PI) - 12.5) < 1e-6);
    assert.ok(Math.abs(swayTimeOf(0) - SWAY_REST_AT) < 1e-12);
  });
});

/** The mockup's stepping with its freeze: the phase stops while the clock, and so the speed, keeps going. */
function mockupStates(
  until: number,
  freezes: readonly (readonly [number, number])[],
): { ph: number; t: number }[] {
  const states = [{ ph: 0, t: 0 }];
  let ph = 0;
  for (let t = DT; t < until; t += DT) {
    ph +=
      DT *
      omega(t) *
      (freezes.some(([from, to]) => t >= from && t < to) ? 0 : 1);
    states.push({ ph, t });
  }
  return states;
}

const FREEZES = [
  [20, 22.7],
  [150, 153],
] as const;
/** Settles after a freeze ends, mid-loop, past one loop of the table, and past two. */
const SETTLES = [22.7, 23.5, 100, 153, 160, 297, 330];

describe("a sway track baked from the rig's state", () => {
  const states = mockupStates(
    Math.max(...SETTLES) + TRACK_SECONDS + 1,
    FREEZES,
  );
  const frames = Math.round(TRACK_SECONDS / DT);

  function worstFrom(track: (settle: number, j: number) => number): number {
    let worst = 0;
    for (const settle of SETTLES) {
      const k = Math.round(settle / DT);
      for (let j = 1; j <= frames; j++)
        worst = Math.max(
          worst,
          Math.abs(Math.sin(states[k + j]!.ph) - track(settle, j)),
        );
    }
    return worst;
  }

  const tracks = new Map(
    SETTLES.map((settle) => [
      settle,
      bakeSway(states[Math.round(settle / DT)]!, TRACK_SECONDS),
    ]),
  );

  test("differs from the mockup's 60 Hz sway by TRACK_VS_EULER from every settle, and no more", () => {
    const worst = worstFrom((settle, j) =>
      trackAt(tracks.get(settle)!, j * DT),
    );
    assert.ok(
      worst <= TRACK_VS_EULER,
      `a track is ${worst} off the mockup, above the pinned ${TRACK_VS_EULER}`,
    );
    assert.ok(
      (TRACK_VS_EULER - worst) * LARGEST < 0.01,
      `${TRACK_VS_EULER} is more than 0.01 pt looser than the measured ${worst}`,
    );
  });

  test("starts on the rig's own phase", () => {
    for (const settle of SETTLES) {
      const start = states[Math.round(settle / DT)]!;
      assert.ok(
        Math.abs(tracks.get(settle)![0]! - Math.sin(start.ph)) < 1e-12,
        `at ${settle}`,
      );
    }
  });

  test("is baked at TRACK_STEP and covers its seconds", () => {
    const track = tracks.get(100)!;
    assert.equal(track.length, Math.ceil(TRACK_SECONDS / TRACK_STEP) + 1);
    assert.ok((track.length - 1) * TRACK_STEP >= TRACK_SECONDS);
  });

  test("is what the fixed table is not: that one is a whole swing off after a freeze", () => {
    const fixed = worstFrom((settle, j) =>
      swayAt(states[Math.round(settle / DT) + j]!.t + SWAY_REST_AT),
    );
    assert.ok(
      fixed > 0.5,
      `the fixed table is only ${fixed} off a mockup that froze for 2.7 s`,
    );
  });
});
