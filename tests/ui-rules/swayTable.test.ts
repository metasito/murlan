// tests/ui-rules/swayTable.test.ts — the sway table is the one clock: it reproduces the rig's phase
// integral within a measured error, the rig reads it, and a CSS keyframe loop on it is the same curve.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HALF_SWINGS,
  SWAY_EASE,
  SWAY_LOOP,
  SWAY_REST_AT,
  SWAY_STOPS,
  SWAY_VS_INTEGRAL,
  swayAt,
  swayKeyframes,
  swayPhase,
} from "../../lib/swayTable.ts";
import { SWAY, restingLamp, stepLamp, TABLE_CENTRE } from "../../components/table/lampRig.ts";
import { coneRainFrame, idleRain, startRain } from "../../components/table/coneRain.ts";
import { mulberry32 } from "../../lib/game/simulate.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const omega = (t: number) => 0.84 * (1 + 0.14 * Math.sin(t * 0.11 + 1.3) + 0.06 * Math.sin(t * 0.37));

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
    assert.equal(SWAY_STOPS.length, HALF_SWINGS + 1);
    assert.ok(SWAY_LOOP > 290 && SWAY_LOOP < 300, `a loop of ${SWAY_LOOP} s`);
  });

  test("differs from the rig's phase integral by SWAY_VS_INTEGRAL over one loop, and no more", () => {
    const worst = worstAgainstIntegral();
    assert.ok(worst <= SWAY_VS_INTEGRAL, `the table is ${worst} off the integral, above the pinned ${SWAY_VS_INTEGRAL}`);
    assert.ok(SWAY_VS_INTEGRAL - worst < 0.01, `${SWAY_VS_INTEGRAL} is looser than the measured ${worst}`);
  });

  test("starts the rig at the middle of a swing and its phase is the angle of its sway", () => {
    assert.ok(Math.abs(swayAt(SWAY_REST_AT)) < 1e-9);
    assert.ok(Math.abs(swayPhase(SWAY_REST_AT)) < 1e-9);
    let last = swayPhase(SWAY_REST_AT);
    for (let t = SWAY_REST_AT; t < SWAY_LOOP; t += 0.05) {
      const ph = swayPhase(t);
      assert.ok(ph >= last - 1e-9, `phase went back at ${t}`);
      assert.ok(Math.abs(Math.sin(ph) - swayAt(t)) < 1e-9, `at ${t}`);
      last = ph;
    }
  });

  test("a CSS keyframe loop on it is the rig's curve, to under half a point at the largest swing", () => {
    const frames = swayKeyframes("ease", 0, 1);
    const stops = Object.keys(frames).map((k) => parseFloat(k) / 100);
    assert.equal(stops.length, HALF_SWINGS + 1);
    const [x1, y1, x2, y2] = SWAY_EASE;
    const bez = (a: number, b: number, v: number) => 3 * (1 - v) ** 2 * v * a + 3 * (1 - v) * v * v * b + v ** 3;
    const css = (t: number) => {
      const p = (((t % SWAY_LOOP) + SWAY_LOOP) % SWAY_LOOP) / SWAY_LOOP;
      let k = 0;
      while (k < HALF_SWINGS - 1 && stops[k + 1]! <= p) k++;
      const u = (p - stops[k]!) / (stops[k + 1]! - stops[k]!);
      let v = u;
      for (let i = 0; i < 30; i++) v -= (bez(x1, x2, v) - u) / (3 * (1 - v) ** 2 * x1 + 6 * (1 - v) * v * (x2 - x1) + 3 * v * v * (1 - x2));
      const e = bez(y1, y2, v);
      return k % 2 === 0 ? e : 1 - e;
    };
    let worst = 0;
    for (let t = 0; t < SWAY_LOOP; t += 0.37) worst = Math.max(worst, Math.abs(SWAY * (2 * css(t) - 1) - SWAY * swayAt(t)));
    assert.ok(worst < 0.5, `a handoff would jump ${worst} pt`);
  });

  test("the rig and the keyframes read one table", () => {
    const rig = readFileSync(path.join(repoRoot, "components/table/lampRig.ts"), "utf8");
    assert.match(rig, /from "\.\.\/\.\.\/lib\/swayTable\.ts"/);
    assert.doesNotMatch(rig.replace(/\/\/.*$/gm, ""), /Math\.sin\(s\.ph\)|0\.84/);
    const s = restingLamp(TABLE_CENTRE);
    for (let i = 0; i < 600; i++) {
      stepLamp(s, 1 / 60, false);
      assert.equal(s.lx, s.x + swayAt(s.at) * SWAY);
    }
    const motion = readFileSync(path.join(repoRoot, "lib/motion.ts"), "utf8");
    assert.match(motion, /from "\.\/swayTable"/);
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
    const near = spawns.every((m) => Math.abs(m.x - (s.x + swayAt(s.at) * SWAY)) < 200);
    assert.ok(near);
  });
});
