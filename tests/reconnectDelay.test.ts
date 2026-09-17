import { test } from "node:test";
import assert from "node:assert/strict";
import { reconnectDelayMs } from "../lib/reconnectDelay.ts";

test("the delay is drawn from the whole exponential window, so clients do not reconnect in step", () => {
  assert.equal(reconnectDelayMs(0, () => 0), 0);
  assert.equal(reconnectDelayMs(0, () => 0.5), 1000);
  assert.equal(reconnectDelayMs(2, () => 0.5), 4000);
  assert.notEqual(reconnectDelayMs(1, () => 0.1), reconnectDelayMs(1, () => 0.9));
});

test("the window stops growing at the cap", () => {
  assert.equal(reconnectDelayMs(20, () => 0.5), 15_000);
});
