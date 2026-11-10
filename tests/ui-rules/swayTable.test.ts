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
  swayAt,
  swayPhase,
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
