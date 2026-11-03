// Telemetry rows are written in batches: one statement per 200 rows or per second, a bounded queue
// that drops its oldest past the cap, and a failed batch that costs its rows and nothing else.
import { test, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, pool } from "../../server/store/db.ts";
import { trackEvent } from "../../server/shared/events.ts";
import { recordClientError } from "../../server/http/clientErrors.ts";
import { flushTelemetry, telemetryRowsDropped } from "../../server/shared/telemetryBatch.ts";
import { logger } from "../../server/shared/logger.ts";
import { register } from "@prometheus-io/client";
import "../../server/shared/metrics.ts";

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
    // pg's answer to an INSERT: every row written unless the answer says otherwise.
    return answer(call).then((result) => ({ rowCount: rowsIn(call), ...(result as object) }));
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
  assert.deepEqual(calls.map(rowsIn), [200], "200 queued rows waited for the timer, or the rest did not");
  t.mock.timers.tick(1_000);
  await ticks();

  assert.deepEqual(calls.map(rowsIn), [200, 50]);
  for (const call of calls) {
    assert.match(call.sql, /\bunnest\s*\(/i);
    assert.match(call.sql, /LEFT JOIN\s+users\b/i);
    assert.match(call.sql, /WHERE\s+t\.user_id\s+IS\s+NULL\s+OR\s+u\.id\s+IS\s+NOT\s+NULL/i);
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
  const exported = async () => (await register.getSingleMetric("telemetry_rows_dropped_total")!.get()).values[0]!.value;
  const exportedBefore = await exported();
  trackEvent("lobby.entered", "queued-5000");
  assert.equal(telemetryRowsDropped() - before, 1);
  assert.equal((await exported()) - exportedBefore, 1, "telemetry_rows_dropped_total did not follow the drop");

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

const wellFormed = (call: Call) => call.values.flat().every((v) => typeof v !== "string" || v.isWellFormed());

test("a lone surrogate, which jsonb refuses for the whole batch, is made well-formed in every column", async (t) => {
  const calls = captured(t);

  recordClientError({
    userId: "u1",
    message: "cut \ud800",
    stack: "at f \udc00",
    screen: "/game\ud800",
    appVersion: "1\ud800",
    context: { componentStack: "at A \ud83d" },
  });
  trackEvent("socket.closed", "u2", { reason: "transport close\ud800" as never });
  await flushTelemetry();

  assert.equal(calls.length, 2);
  for (const call of calls) assert.ok(wellFormed(call), `a lone surrogate reached ${call.sql.slice(0, 30)}`);
});

test("a batch one row breaks is written row by row, so only that row is lost", async (t) => {
  t.mock.method(logger, "error", () => undefined);
  const calls = captured(t, async (call) => {
    if (userIds(call).includes("bad")) throw Object.assign(new Error("invalid input syntax"), { code: "22P02" });
    return { rows: [], rowCount: rowsIn(call) };
  });
  const before = telemetryRowsDropped();

  for (const id of ["a", "bad", "c"]) trackEvent("lobby.entered", id);
  await flushTelemetry();

  assert.deepEqual(calls.map(userIds), [["a", "bad", "c"], ["a"], ["bad"], ["c"]]);
  assert.equal(telemetryRowsDropped() - before, 1);
});

test("an outage that starts while a broken batch goes row by row ends it: one statement, one log line", async (t) => {
  const logged = t.mock.method(logger, "error", () => undefined);
  let down = false;
  const calls = captured(t, async (call) => {
    if (down) throw new Error("connection terminated");
    if (userIds(call).includes("bad")) {
      if (rowsIn(call) === 1) down = true;
      throw Object.assign(new Error("invalid input syntax"), { code: "22P02" });
    }
    return { rows: [] };
  });
  const before = telemetryRowsDropped();

  for (const id of ["a", "bad", "c", "d"]) trackEvent("lobby.entered", id);
  await flushTelemetry();
  trackEvent("lobby.entered", "after");
  await flushTelemetry();

  assert.deepEqual(calls.map(userIds), [["a", "bad", "c", "d"], ["a"], ["bad"], ["c"], ["after"]]);
  assert.equal(telemetryRowsDropped() - before, 4, "the bad row, the two the outage reached, and the next batch were not all counted");
  assert.equal(logged.mock.callCount(), 3, "the outage was logged once per row it reached, not once: the bad row, the outage, the next batch");
});

test("a batch the database could not take at all is not retried row by row", async (t) => {
  t.mock.method(logger, "error", () => undefined);
  const calls = captured(t, async () => {
    throw new Error("connection terminated");
  });
  const before = telemetryRowsDropped();

  for (const id of ["a", "b", "c"]) trackEvent("lobby.entered", id);
  await flushTelemetry();

  assert.equal(calls.length, 1, "an outage was multiplied into a statement per row");
  assert.equal(telemetryRowsDropped() - before, 3);
});

test("rows the join drops, for an account deleted since they were queued, are counted as dropped", async (t) => {
  captured(t, async () => ({ rows: [], rowCount: 1 }));
  const before = telemetryRowsDropped();

  trackEvent("socket.closed", "deleted", { reason: "server namespace disconnect" });
  trackEvent("lobby.entered", null);
  await flushTelemetry();

  assert.equal(telemetryRowsDropped() - before, 1);
});
