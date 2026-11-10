// tests/ui-rules/swayTable.test.ts — the sway table is the one clock: it reproduces the rig's phase
// integral within a measured error, the rig reads it, and a CSS keyframe loop on it is the same curve.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HALF_SWINGS,
  STEPS,
  SWAY_LOOP,
  SWAY_REST_AT,
  SWAY_TIMES,
  SWAY_VS_INTEGRAL,
  swayAt,
  swayKeyframes,
  swayPhase,
} from "../../lib/swayTable.ts";
import { SWAY, SWAY_KICKED, restingLamp, stepLamp, TABLE_CENTRE } from "../../components/table/lampRig.ts";
import { coneRainFrame, idleRain, startRain } from "../../components/table/coneRain.ts";
import { mulberry32 } from "../../lib/game/simulate.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const omega = (t: number) => 0.84 * (1 + 0.14 * Math.sin(t * 0.11 + 1.3) + 0.06 * Math.sin(t * 0.37));
const LARGEST = SWAY + SWAY_KICKED;

/** The mockup's integral, summed as `lampStep` does at 600 Hz, read against the table from the rig's start. */
function worstAgainstIntegral(): number {
  const dt = 1 / 600;
  let ph = 0;
  let worst = 0;
  for (let t = dt; t < SWAY_LOOP - SWAY_REST_AT; t += dt) {
    ph += dt * omega(t);
    worst = Math.max(worst, Math.abs(Math.sin(ph) - swayAt(t + SWAY_REST_AT)));
  }
  return worst;
}

describe("the sway table", () => {
  test("is 80 half-swings of about five minutes", () => {
    assert.equal(SWAY_TIMES.length, HALF_SWINGS * STEPS + 1);
    assert.ok(SWAY_LOOP > 290 && SWAY_LOOP < 300, `a loop of ${SWAY_LOOP} s`);
  });

  test("differs from the rig's phase integral by SWAY_VS_INTEGRAL over one loop, and no more", () => {
    const worst = worstAgainstIntegral();
    assert.ok(worst <= SWAY_VS_INTEGRAL, `the table is ${worst} off the integral, above the pinned ${SWAY_VS_INTEGRAL}`);
    assert.ok((SWAY_VS_INTEGRAL - worst) * LARGEST < 0.01, `${SWAY_VS_INTEGRAL} is more than 0.01 pt looser than the measured ${worst}`);
    assert.ok(SWAY_VS_INTEGRAL * LARGEST <= 0.1, `${SWAY_VS_INTEGRAL * LARGEST} pt at the largest swing`);
  });

  test("starts the rig at the middle of a swing, phase 0, and its phase follows the sway", () => {
    assert.ok(Math.abs(swayAt(SWAY_REST_AT)) < 1e-12);
    assert.ok(Math.abs(swayPhase(SWAY_REST_AT)) < 1e-12);
    let last = swayPhase(SWAY_REST_AT);
    for (let t = SWAY_REST_AT; t < SWAY_LOOP; t += 0.05) {
      const ph = swayPhase(t);
      assert.ok(ph >= last, `phase went back at ${t}`);
      assert.ok(Math.abs(Math.sin(ph) - swayAt(t)) < SWAY_VS_INTEGRAL, `at ${t}`);
      last = ph;
    }
  });

  test("a linear CSS keyframe loop on it is the rig's curve", () => {
    const frames = swayKeyframes(0, 1);
    const stops = Object.keys(frames).map((k) => parseFloat(k) / 100);
    const values = Object.values(frames).map((f) => f.opacity);
    assert.equal(stops.length, SWAY_TIMES.length);
    let worst = 0;
    for (let t = 0; t < SWAY_LOOP; t += 0.37) {
      const p = t / SWAY_LOOP;
      let n = 0;
      while (n < stops.length - 2 && stops[n + 1]! <= p) n++;
      const css = values[n]! + ((values[n + 1]! - values[n]!) * (p - stops[n]!)) / (stops[n + 1]! - stops[n]!);
      worst = Math.max(worst, Math.abs(LARGEST * (2 * css - 1) - LARGEST * swayAt(t)));
    }
    assert.ok(worst < 1e-6, `a handoff would jump ${worst} pt`);
  });

  test("the rig reads the table", () => {
    const rig = readFileSync(path.join(repoRoot, "components/table/lampRig.ts"), "utf8");
    assert.match(rig, /from "\.\.\/\.\.\/lib\/swayTable\.ts"/);
    assert.doesNotMatch(rig.replace(/\/\/.*$/gm, ""), /Math\.sin\(s\.ph\)|0\.84/);
    const s = restingLamp(TABLE_CENTRE);
    for (let i = 0; i < 600; i++) {
      stepLamp(s, 1 / 60, false);
      assert.equal(s.lx, s.x + swayAt(s.at) * SWAY);
    }
  });

  test("a frozen rig holds its place in the table", () => {
    const s = restingLamp(TABLE_CENTRE);
    for (let i = 0; i < 100; i++) stepLamp(s, 1 / 60, false);
    s.freeze = 1;
    const held = s.at;
    for (let i = 0; i < 100; i++) stepLamp(s, 1 / 60, false);
    assert.equal(s.at, held);
  });

  test("the rain falls from the light the table puts it at", () => {
    const s = restingLamp(TABLE_CENTRE);
    for (let i = 0; i < 300; i++) stepLamp(s, 1 / 60, false);
    const run = idleRain();
    startRain(run);
    const spawns = coneRainFrame(run, s, 1 / 60, mulberry32(1));
    assert.ok(spawns.length > 0);
    assert.ok(spawns.every((m) => Math.abs(m.x - (s.x + swayAt(s.at) * SWAY)) < 200));
  });
});
