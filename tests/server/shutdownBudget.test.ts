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

/**
 * Callees that bound themselves by the budget they are handed, so awaiting one is bounded.
 * `within` is the general form and is checked apart: it ends the wait at its budget whatever it wraps.
 */
const SELF_BOUNDED: Record<string, string> = {
  settleInFlight: "gives up at its argument",
  closeTableOwners: "settles for at most its argument, then destroys the client",
  closeDatabase: "drains for at most `drainMs`",
};

const budgetKey = (e: ts.Node | undefined): string | null =>
  e && ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "SHUTDOWN_BUDGET" ? e.name.text : null;

/** What a function body defers: an await inside one runs when it is called, not where it is written. */
const isFunction = (n: ts.Node) => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);
const isAwait = (n: ts.Node) => ts.isAwaitExpression(n) || (ts.isForOfStatement(n) && n.awaitModifier !== undefined);

/**
 * Every `await` and `for await` in `shutdown`, at any depth, must be `await within(SHUTDOWN_BUDGET.k, X)`
 * or a self-bounded callee handed `SHUTDOWN_BUDGET.k` (or `{ drainMs: SHUTDOWN_BUDGET.k }`), and each
 * entry bounds exactly one: a second use would run for its time again beyond what the sum counts.
 * An await inside X, outside a nested function body, is not bounded by `within` (the wait happens
 * before `within` is called), so it is read like any other.
 */
function inspectShutdown(source: string): { unbudgeted: string[]; used: Map<string, number> } {
  const file = ts.createSourceFile("shutdown.ts", source, ts.ScriptTarget.Latest, true);
  const unbudgeted: string[] = [];
  const used = new Map<string, number>();
  const bounded = (call: ts.Node): string | null => {
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return null;
    const name = call.expression.text;
    if (name === "within") return call.arguments.length === 2 ? budgetKey(call.arguments[0]) : null;
    if (!(name in SELF_BOUNDED) || call.arguments.length !== 1) return null;
    const arg = call.arguments[0]!;
    if (ts.isObjectLiteralExpression(arg)) {
      const prop = arg.properties[0];
      return arg.properties.length === 1 && prop && ts.isPropertyAssignment(prop) && prop.name.getText() === "drainMs" ? budgetKey(prop.initializer) : null;
    }
    return budgetKey(arg);
  };
  const visit = (n: ts.Node) => {
    if (isFunction(n)) return;
    if (isAwait(n)) {
      const key = ts.isAwaitExpression(n) ? bounded(n.expression) : null;
      if (key === null || !(key in SHUTDOWN_BUDGET)) unbudgeted.push(n.getText().split("\n")[0]!.replace(/\s+/g, " "));
      else used.set(key, (used.get(key) ?? 0) + 1);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(file, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === "shutdown") ts.forEachChild(n.body!, visit);
  });
  return { unbudgeted, used };
}

const shutdownSource = readFileSync(path.resolve(import.meta.dirname, "..", "..", "server", "http", "shutdown.ts"), "utf8");

test("every await in shutdown is bounded by an entry of SHUTDOWN_BUDGET, and each entry bounds exactly one", () => {
  const { unbudgeted, used } = inspectShutdown(shutdownSource);
  assert.deepEqual(unbudgeted, []);
  assert.deepEqual(
    Object.fromEntries(Object.keys(SHUTDOWN_BUDGET).map((k) => [k, used.get(k) ?? 0])),
    Object.fromEntries(Object.keys(SHUTDOWN_BUDGET).map((k) => [k, 1])),
    "a budget entry bounds no awaited step, or bounds two"
  );
});

test("the check sees an unbounded await however it is spelled", () => {
  const plant = (from: string, to: string) => {
    const planted = shutdownSource.replace(from, to);
    assert.notEqual(planted, shutdownSource, `${from} is not in shutdown.ts`);
    return inspectShutdown(planted);
  };
  const owners = "await closeTableOwners(SHUTDOWN_BUDGET.tableOwners);";
  assert.deepEqual(plant(owners, "await closeTableOwners();").unbudgeted, ["await closeTableOwners()"]);
  assert.equal(plant(owners, "await new Promise((r) => r(5_000 + SHUTDOWN_BUDGET.tableOwners));").unbudgeted.length, 1);
  const pool = "await within(SHUTDOWN_BUDGET.poolEnd, ended);";
  assert.equal(
    plant(pool, "await Promise.all([within(SHUTDOWN_BUDGET.poolEnd, ended), new Promise((r) => r(5_000))]);").unbudgeted.length,
    1
  );
  assert.equal(plant(owners, "if (signal) { await other(); }\n    " + owners).unbudgeted.length, 1);
  assert.equal(plant(owners, "await closeTableOwners(SHUTDOWN_BUDGET.nothing);").unbudgeted.length, 1);
  assert.equal(plant(pool, "await within(SHUTDOWN_BUDGET.poolEnd, await slow().then(() => ended));").unbudgeted.length, 1);
  assert.equal(plant(owners, "for await (const x of stream()) void x;\n    " + owners).unbudgeted.length, 1);
  const reused = plant(owners, owners + "\n    await within(SHUTDOWN_BUDGET.tableOwners, other());");
  assert.equal(reused.unbudgeted.length, 0);
  assert.equal(reused.used.get("tableOwners"), 2);
});

test("an entry named only in a comment bounds nothing", () => {
  const planted = shutdownSource.replace("await closeTableOwners(SHUTDOWN_BUDGET.tableOwners);", "// SHUTDOWN_BUDGET.tableOwners");
  assert.equal(inspectShutdown(planted).used.get("tableOwners"), undefined);
});
