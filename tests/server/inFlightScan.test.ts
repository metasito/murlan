// tests/server/inFlightScan.test.ts — a promise nobody awaits is registered with
// server/shared/inFlight.ts, so stop() and shutdown() wait for it before the clients it uses close.
// Read off the type checker, not the spelling: `void work()`, a bare `work().then(…)` and a bare
// `work()` are the same defect. The behaviour this stands beside: tests/integration/testServerCleanup.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { sourcesUnder } from "../helpers/sourceScan.ts";
import { programFor } from "../helpers/typeShape.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * A detached promise that is not tracked, by file and the start of its expression, with how many
 * there are: the reason it may outlive `stop()`. Exact, so a removed one lowers its entry and a
 * new one is a red test.
 */
const DETACHED: Record<string, { why: string; heads: Record<string, number> }> = {
  "server/game/gameOwnership.ts": {
    why: "the ownership connection and its lock renewals belong to closeOwnership(), which stop() and shutdown await",
    heads: {
      "void c .query(\"SELECT pg_advisory_unlock($1::big": 1,
      "void clearTableOwner(roomId, hold.epoch)": 2,
      "void dead.end().catch(() => {})": 1,
      "void next.end().catch(() => {})": 1,
      "void next.query(\"SELECT 1\").then( () => { for (c": 1,
      "void reclaim()": 3,
      "void refreshTableOwner(roomId, epoch, OWNER_RECO": 1,
    },
  },
  "server/game/ratings.ts": {
    why: "bookkeeping on a read already awaited by its caller",
    heads: {
      "started.rows.catch(() => { if (last === started)": 1,
    },
  },
  "server/game/tableHandOff.ts": {
    why: "the hand-off is awaited by handOffTables(), the first step of shutdown",
    heads: {
      "void outcome .catch(() => {}) .finally(() => { r": 1,
    },
  },
  "server/game/tableRouter.ts": {
    why: "bookkeeping on an outcome the caller awaits",
    heads: {
      "outcome.catch(() => applied.delete(action.id))": 1,
    },
  },
  "server/http/health.ts": {
    why: "the probe loop is stopped by stopHealth(), which stop() and shutdown call",
    heads: {
      "void pollStore()": 2,
      "void refreshLinks()": 3,
    },
  },
  "server/index.ts": {
    why: "the process entry: boot, and the signal handlers that start shutdown",
    heads: {
      "(async () => { const { server, io, rt } = await ": 1,
      "void adapterUp.then(() => logger.info(`express s": 1,
      "void shutdown(\"SIGINT\", { io, server, tables: rt": 1,
      "void shutdown(\"SIGTERM\", { io, server, tables: r": 1,
    },
  },
  "server/shared/telemetryBatch.ts": {
    why: "flushTelemetry() awaits the batch in flight, and stop() and shutdown call it",
    heads: {
      "void flush(false)": 1,
      "void flush(true)": 1,
      "void run.finally(() => { if (flushing === run) f": 1,
    },
  },
  "server/socket/delivery.ts": {
    why: "bookkeeping on a send already tracked at its call",
    heads: {
      "void sent.finally(() => { if (roomTails.get(room": 1,
    },
  },
  "server/socket/socketAdapter.ts": {
    why: "adapter traffic on links io.close() ends; a lost heartbeat is retried by the next",
    heads: {
      "void serverSideEmit([LEAVING, instanceId])": 1,
      "void serverSideEmit(heartbeatPacket())": 1,
    },
  },
  "server/store/db.ts": {
    why: "the pool probe, ended by closeDatabase()",
    heads: {
      "void check()": 1,
    },
  },
  "server/store/instanceInbox.ts": {
    why: "the inbox reader and its renewals, ended by stopInbox(), which stop() and shutdown await",
    heads: {
      "void create().catch(() => {})": 1,
      "void keepAlive()": 1,
      "void mine.catch(() => {}).finally(() => { if (ta": 1,
      "void read(reader)": 1,
    },
  },
  "server/store/redis.ts": {
    why: "a connection attempt on a client whose owner closes it",
    heads: {
      "client.connect().catch(() => {})": 1,
    },
  },
  "server/store/roomStore.ts": {
    why: "bookkeeping on the room status write chain",
    heads: {
      "void tail.then(() => { if (statusWrites.get(room": 1,
    },
  },
};

const head = (node: ts.Node) => node.getText().replace(/\s+/g, " ").replace(/;$/, "").slice(0, 48);

function isThenable(checker: ts.TypeChecker, node: ts.Expression): boolean {
  return checker.getTypeAtLocation(node).getProperty("then") !== undefined;
}

export function untracked(files: string[], override: Record<string, string> = {}): string[] {
  const program = programFor(files, override);
  const checker = program.getTypeChecker();
  const found: string[] = [];
  const visit = (file: string) => (node: ts.Node) => {
    const at = () => `${file}: ${head(node)}`;
    if (ts.isVoidExpression(node)) {
      const inner = node.expression;
      const tracked = ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && inner.expression.text === "track";
      if (!tracked && isThenable(checker, inner)) found.push(at());
    } else if (ts.isExpressionStatement(node)) {
      const e = node.expression;
      const assigned = ts.isBinaryExpression(e) && e.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && e.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
      if (!assigned && !ts.isAwaitExpression(e) && !ts.isVoidExpression(e) && isThenable(checker, e)) found.push(at());
    }
    ts.forEachChild(node, visit(file));
  };
  for (const file of files) {
    const source = program.getSourceFile(path.resolve(repoRoot, file));
    assert.ok(source, `${file} is not in the program`);
    ts.forEachChild(source, visit(file));
  }
  return found.sort();
}

/** The registry itself, whose own bookkeeping cannot register with itself. */
const REGISTRY = "server/shared/inFlight.ts";
const SERVER = sourcesUnder(repoRoot, ["server"], /\.ts$/).map(([f]) => f).filter((f) => f !== REGISTRY);

test("every detached promise in server/ is tracked or listed with its reason", () => {
  assert.ok(SERVER.length > 50 && SERVER.includes("server/store/presence.ts"), "the scan read no server source");
  const found = untracked(SERVER);
  const listed = Object.entries(DETACHED).flatMap(([file, { heads }]) => Object.entries(heads).flatMap(([h, n]) => Array<string>(n).fill(`${file}: ${h}`)));
  assert.deepEqual(
    found,
    listed.sort(),
    "track it with server/shared/inFlight.ts, or list it in DETACHED with why it may outlive stop(); a listed one that is gone comes off"
  );
});

test("the scan sees a bare void, a bare .then and a bare call, and not a tracked or awaited one", () => {
  const file = "server/shared/refusal.ts";
  const text = [
    "async function work(): Promise<void> {}",
    "declare function track<T>(p: Promise<T>): Promise<T>;",
    "export async function planted() {",
    "  void work();",
    "  work().then(() => {});",
    "  work();",
    "  void track(work());",
    "  await work();",
    "  const kept = work();",
    "  return kept;",
    "}",
  ].join("\n");
  const found = untracked([file], { [file]: text });
  assert.deepEqual(found.map((f) => f.split(": ")[1]), ["void work()", "work()", "work().then(() => {})"]);
});
