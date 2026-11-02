// Telemetry rows are written in batches: one statement per 200 rows or per second, a bounded queue
// that drops its oldest past the cap, and a failed batch that costs its rows and nothing else.
import { test, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, pool } from "../../server/store/db.ts";
import { trackEvent } from "../../server/shared/events.ts";
import { recordClientError } from "../../server/http/clientErrors.ts";
import { flushTelemetry, telemetryRowsDropped } from "../../server/shared/telemetryBatch.ts";
import { logger } from "../../server/shared/logger.ts";

openDatabase();

interface Call {
  sql: string;
  values: unknown[][];
}

const ticks = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};

function captured(t: TestContext, answer: (call: Call) => Promise<unknown> = async () => ({ rows: [] })) {
  const calls: Call[] = [];
  t.mock.method(pool(), "query", (sql: string, values: unknown[][]) => {
    const call = { sql, values };
    calls.push(call);
    return answer(call);
  });
  return calls;
}

const rowsIn = (call: Call) => call.values[0].length;
const userIds = (call: Call) => call.values[0];

beforeEach(async () => {
  await flushTelemetry();
});

test("250 events are written as one statement of 200 and one of the rest within the second", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = captured(t);

  for (let i = 0; i < 250; i++) trackEvent("lobby.entered", `user-${i}`);
  await ticks();
  assert.equal(calls.length >= 1, true, "200 queued rows waited for the timer");
  t.mock.timers.tick(1_000);
  await ticks();

  assert.deepEqual(calls.map(rowsIn), [200, 50]);
  for (const call of calls) {
    assert.match(call.sql, /\bunnest\s*\(/i);
    assert.match(call.sql, /LEFT JOIN\s+users\b/i);
  }
});

test("a few events wait for the second, then go as one statement", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = captured(t);

  trackEvent("lobby.entered", "a");
  trackEvent("socket.closed", "b", { reason: "transport close" });
  await ticks();
  assert.equal(calls.length, 0, "a lone event was written at once");
  t.mock.timers.tick(999);
  await ticks();
  assert.equal(calls.length, 0);
  t.mock.timers.tick(1);
  await ticks();
  assert.deepEqual(calls.map(userIds), [["a", "b"]]);
});

test("the row past 5,000 queued drops the oldest and is counted", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let land!: () => void;
  const calls = captured(t, (call) =>
    rowsIn(call) === 200 && userIds(call)[0] === "held-0" ? new Promise((resolve) => (land = () => resolve({ rows: [] }))) : Promise.resolve({ rows: [] })
  );
  const before = telemetryRowsDropped();

  for (let i = 0; i < 200; i++) trackEvent("lobby.entered", `held-${i}`);
  for (let i = 0; i < 5_000; i++) trackEvent("lobby.entered", `queued-${i}`);
  assert.equal(telemetryRowsDropped() - before, 0, "a queue at its cap dropped a row");
  trackEvent("lobby.entered", "queued-5000");
  assert.equal(telemetryRowsDropped() - before, 1);

  land();
  await flushTelemetry();
  const written = calls.slice(1).flatMap(userIds);
  assert.equal(written.length, 5_000);
  assert.equal(written[0], "queued-1", "the newest row was dropped rather than the oldest");
  assert.equal(written.at(-1), "queued-5000");
});

test("a batch that fails is logged and counted as dropped, never retried, and the next batch still goes", async (t) => {
  const logged = t.mock.method(logger, "error", () => undefined);
  let fail = true;
  const calls = captured(t, async () => {
    if (fail) {
      fail = false;
      throw new Error("connection terminated");
    }
    return { rows: [] };
  });
  const before = telemetryRowsDropped();

  trackEvent("lobby.entered", "lost-1");
  trackEvent("lobby.entered", "lost-2");
  await assert.doesNotReject(flushTelemetry());
  assert.equal(telemetryRowsDropped() - before, 2);
  assert.equal(calls.length, 1, "a failed batch was retried");
  assert.equal(logged.mock.callCount(), 1);

  trackEvent("lobby.entered", "kept");
  await flushTelemetry();
  assert.deepEqual(calls.map(userIds), [["lost-1", "lost-2"], ["kept"]]);
  assert.equal(telemetryRowsDropped() - before, 2);
});

test("a foreign-key violation, an account deleted under the batch, retries it once", async (t) => {
  let violations = 1;
  const calls = captured(t, async () => {
    if (violations-- > 0) throw Object.assign(new Error("violates foreign key constraint"), { code: "23503" });
    return { rows: [] };
  });
  const before = telemetryRowsDropped();

  trackEvent("lobby.entered", "gone");
  await flushTelemetry();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].values, calls[0].values);
  assert.equal(telemetryRowsDropped() - before, 0);
});

test("client errors batch the same way, fingerprinted and stamped when reported", async (t) => {
  const calls = captured(t);

  recordClientError({ userId: "u1", message: "boom 12", stack: "Error: boom\n    at f (app.js:1:2)" });
  recordClientError({ userId: null, message: "nul\u0000inside", context: { componentStack: "at A\u0000" } });
  await flushTelemetry();

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO client_errors/i);
  assert.match(calls[0].sql, /\bunnest\s*\(/i);
  const text = JSON.stringify(calls[0].values);
  assert.equal(text.includes("\\u0000"), false, "a NUL reached the batch, and fails every row in it");
  const fingerprints = calls[0].values.find((column) => column.every((v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v)));
  assert.ok(fingerprints, "no fingerprint column");
});
