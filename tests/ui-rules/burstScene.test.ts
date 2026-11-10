// tests/ui-rules/burstScene.test.ts — the web's burst scene: idle until something is thrown, awake while anything flies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "../../components/table/particles.ts";
import { burstIdle, createBurstScene, stepBurst } from "../../components/table/burstScene.ts";
import { restingLamp, TABLE_CENTRE } from "../../components/table/lampRig.ts";

test("a scene with nothing flying is idle, and a spawn, an ember or rain wakes it", () => {
  const lamp = restingLamp(TABLE_CENTRE);
  const scene = createBurstScene();
  assert.equal(burstIdle(scene), true);
  spawn(scene.s, { x: 100, y: 100, life: 0.1, size: 4 });
  assert.equal(burstIdle(scene), false);
  stepBurst(scene, lamp, 0.5, () => 0.5);
  assert.equal(burstIdle(scene), true, "a spent particle leaves it idle");
  scene.ember.t = 0;
  assert.equal(burstIdle(scene), false, "an ember keeps it awake");
  const rain = createBurstScene();
  rain.rain.t = 0;
  assert.equal(burstIdle(rain), false, "rain keeps it awake");
});
