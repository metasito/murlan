import { test } from "node:test";
import assert from "node:assert/strict";
import { reconnectDelayMs } from "../../lib/reconnectDelay.ts";

test("the delay is drawn from the whole exponential window, so clients do not reconnect in step", () => {
  assert.equal(reconnectDelayMs(0, () => 0), 0);
  assert.equal(reconnectDelayMs(0, () => 0.5), 500);
  assert.equal(reconnectDelayMs(2, () => 0.5), 2000);
  assert.notEqual(reconnectDelayMs(1, () => 0.1), reconnectDelayMs(1, () => 0.9));
});

test("the window stops growing at the cap", () => {
  assert.equal(reconnectDelayMs(3, () => 0.5), 2500);
  assert.equal(reconnectDelayMs(20, () => 0.5), 2500);
  assert.ok(reconnectDelayMs(20, () => 0.9999) < 5000);
});

test("a thousand clients dropped together spread across the first second, with no 50 ms comb", () => {
  const BUCKET_MS = 50;
  const buckets = new Array<number>(1000 / BUCKET_MS).fill(0);
  for (let client = 0; client < 1000; client++) {
    const delay = reconnectDelayMs(0);
    assert.ok(delay >= 0 && delay < 1000, `attempt 0 drew ${delay} ms, outside the first second`);
    buckets[Math.floor(delay / BUCKET_MS)]!++;
  }
  const empty = buckets.flatMap((n, i) => (n === 0 ? [`${i * BUCKET_MS}-${(i + 1) * BUCKET_MS} ms`] : []));
  assert.deepEqual(empty, [], `no client reconnected in ${empty.join(", ")}`);
});
