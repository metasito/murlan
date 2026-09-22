// tests/server/shutdownBudget.test.ts — the shutdown budget and the query timeout used
// to be independent literals in two files, and drifted into contradiction: a
// query stuck to its own 15s timeout outlived a 10s watchdog, so a shutdown
// that was working correctly still ended in exit(1). These are the inequalities
// that have to hold for a healthy shutdown to always exit 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pool, QUERY_TIMEOUT_MS } from "../../server/store/db.ts";
import { DRAIN_TIMEOUT_MS, FORCED_EXIT_MS } from "../../server/http/shutdown.ts";

const { sigtermGraceMs } = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "..", "..", "deploy", "runtime.json"), "utf8")
);

test("the drain outlasts a single query's own timeout", () => {
  assert.ok(
    DRAIN_TIMEOUT_MS > QUERY_TIMEOUT_MS,
    `a client stuck on a query is released only when the query aborts at ${QUERY_TIMEOUT_MS}ms; ` +
      `a ${DRAIN_TIMEOUT_MS}ms drain gives up first and reports live writes abandoned`
  );
});

test("the watchdog outlasts the drain", () => {
  assert.ok(
    FORCED_EXIT_MS > DRAIN_TIMEOUT_MS,
    `the drain must be able to finish and reach exit(0); with a ${FORCED_EXIT_MS}ms watchdog ` +
      `and a ${DRAIN_TIMEOUT_MS}ms drain a healthy shutdown exits 1`
  );
});

test("the watchdog fires inside the host's SIGTERM grace", () => {
  assert.ok(
    FORCED_EXIT_MS < sigtermGraceMs,
    `the host SIGKILLs at ~${sigtermGraceMs}ms (deploy/runtime.json), so a ${FORCED_EXIT_MS}ms watchdog never runs`
  );
});

test("the pool is the thing QUERY_TIMEOUT_MS bounds", () => {
  assert.deepEqual(
    {
      statement_timeout: pool.options.statement_timeout,
      query_timeout: pool.options.query_timeout,
    },
    { statement_timeout: QUERY_TIMEOUT_MS, query_timeout: QUERY_TIMEOUT_MS },
    "the shutdown budget is derived from QUERY_TIMEOUT_MS, which is only true if the pool uses it"
  );
});
