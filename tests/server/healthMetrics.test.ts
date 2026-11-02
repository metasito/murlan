// tests/server/healthMetrics.test.ts — a stream's lag says nothing once nothing is being read, and the
// lag gate flips only on a sustained run of slow seconds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "@prometheus-io/client";
import { noteStreamRead } from "../../server/shared/metrics.ts";
import { installClock, now, realClock } from "../../server/http/clock.ts";
import { lagGate } from "../../server/http/health.ts";

async function sample(name: string, stream: string): Promise<number | undefined> {
  const metric = (await register.getMetricsAsJSON()).find((m) => m.name === name);
  return (metric?.values as { value: number; labels: Record<string, string> }[] | undefined)?.find(
    (v) => v.labels.stream === stream
  )?.value;
}

test("a stream's lag is the last entry's wait while reads go on, and 0 once they stop", async () => {
  let at = now();
  const restore = installClock({ ...realClock, now: () => at });
  try {
    noteStreamRead("inbox", `${at - 2_000}-0`);
    assert.equal(await sample("redis_stream_lag_seconds", "inbox"), 2);
    assert.equal(await sample("redis_stream_read_age_seconds", "inbox"), 0);
    at += 60_000;
    assert.equal(await sample("redis_stream_lag_seconds", "inbox"), 0, "a lag read a minute ago is still reported");
    assert.equal(await sample("redis_stream_read_age_seconds", "inbox"), 60);
  } finally {
    restore();
  }
});

test("the lag gate goes unready after three slow seconds in a row and back after three fast ones", () => {
  const gate = lagGate({ enterAfter: 3, leaveAfter: 3, maxMs: 200 });
  const run = (...p99s: number[]) => p99s.map((p) => (gate.observe(p), gate.lagging()));
  assert.deepEqual(run(300, 300, 10, 300, 300), [false, false, false, false, false], "two slow seconds flipped it");
  assert.deepEqual(run(300), [true]);
  assert.deepEqual(run(10, 10, 300, 10, 10), [true, true, true, true, true], "two fast seconds cleared it");
  assert.deepEqual(run(10), [false]);
});
