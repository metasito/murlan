// tests/server/shutdownBudget.test.ts — the shutdown budget and the query timeout used
// to be independent literals in two files, and drifted into contradiction: a
// query stuck to its own 15s timeout outlived a 10s watchdog, so a shutdown
// that was working correctly still ended in exit(1). These are the inequalities
// that have to hold for a healthy shutdown to always exit 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { openDatabase, pool, QUERY_TIMEOUT_MS } from "../../server/store/db.ts";
import { DRAIN_TIMEOUT_MS, FORCED_EXIT_MS, SHUTDOWN_BUDGET } from "../../server/http/shutdown.ts";

openDatabase();

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

const stepsMs = Object.values(SHUTDOWN_BUDGET).reduce((sum, ms) => sum + ms, 0);

test("every step of the shutdown, end to end, fits inside the host's SIGTERM grace", () => {
  assert.equal(SHUTDOWN_BUDGET.drain, DRAIN_TIMEOUT_MS);
  assert.ok(
    stepsMs < sigtermGraceMs,
    `the steps take up to ${stepsMs}ms between them; the host SIGKILLs at ~${sigtermGraceMs}ms`
  );
});

test("the watchdog outlasts every step together", () => {
  assert.ok(
    FORCED_EXIT_MS > stepsMs,
    `a shutdown whose steps each stay inside their budget can take ${stepsMs}ms; a ${FORCED_EXIT_MS}ms watchdog exits 1 under it`
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

test("the watchdog leaves the host's grace a margin", () => {
  assert.ok(
    FORCED_EXIT_MS <= sigtermGraceMs - 250,
    `a ${FORCED_EXIT_MS}ms watchdog sits within 250ms of the ~${sigtermGraceMs}ms SIGKILL, which is approximate`
  );
});

test("the pool is the thing QUERY_TIMEOUT_MS bounds", () => {
  assert.deepEqual(
    {
      statement_timeout: pool().options.statement_timeout,
      query_timeout: pool().options.query_timeout,
    },
    { statement_timeout: QUERY_TIMEOUT_MS, query_timeout: QUERY_TIMEOUT_MS },
    "the shutdown budget is derived from QUERY_TIMEOUT_MS, which is only true if the pool uses it"
  );
});

/** The awaits at the top of `shutdown`'s try block that name no `SHUTDOWN_BUDGET` entry. */
function unbudgetedAwaits(source: string): string[] {
  const file = ts.createSourceFile("shutdown.ts", source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const hasAwait = (n: ts.Node): boolean => ts.isAwaitExpression(n) || ts.forEachChild(n, (c) => (hasAwait(c) ? true : undefined)) === true;
  const visit = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === "shutdown") {
      const tried = n.body?.statements.find(ts.isTryStatement);
      for (const statement of tried?.tryBlock.statements ?? []) {
        if (hasAwait(statement) && !/SHUTDOWN_BUDGET\.\w+/.test(statement.getText())) found.push(statement.getText().replace(/\s+/g, " "));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return found;
}

const shutdownSource = readFileSync(path.resolve(import.meta.dirname, "..", "..", "server", "http", "shutdown.ts"), "utf8");

test("every step shutdown awaits is bounded by an entry of SHUTDOWN_BUDGET, and every entry is used", () => {
  assert.deepEqual(unbudgetedAwaits(shutdownSource), []);
  for (const key of Object.keys(SHUTDOWN_BUDGET)) {
    assert.match(shutdownSource, new RegExp(`SHUTDOWN_BUDGET\\.${key}\\b`), `${key} is budgeted but no step uses it`);
  }
});

test("the check sees a close step that names no budget", () => {
  const planted = shutdownSource.replace("await closeTableOwners(SHUTDOWN_BUDGET.tableOwners);", "await closeTableOwners();");
  assert.notEqual(planted, shutdownSource, "the planted step is not in shutdown.ts");
  assert.deepEqual(unbudgetedAwaits(planted), ["await closeTableOwners();"]);
});
