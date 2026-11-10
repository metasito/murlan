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
 * there are and why each may outlive `stop()`. Exact, so a removed one lowers its entry and a new
 * one is a red test.
 *
 * Seen: `void x`, a bare thenable statement (optional calls and `cond && work()` included), an assignment of a promise
 * to anything but a local that is later awaited or returned, and a function that returns a promise
 * passed to a timer, `arm`, `safeTimer`, `forEach` or a member `.on`/`.once`. Not seen: a promise-returning
 * callback handed to any other void-typed parameter (an express route handler is one), which would
 * need a per-parameter allowlist of the same size as the routes.
 */
const DETACHED: Record<string, { n: number; why: string }> = {
  "server/game/gameOwnership.ts: hold.entering ??= (async () => { try { const { e": { n: 1, why: "stored on the hold and awaited by whoever enters the room" },
  "server/game/gameOwnership.ts: void c .query(\"SELECT pg_advisory_unlock($1::big": { n: 1, why: "a lock release on the ownership connection, which closeOwnership() ends after it" },
  "server/game/gameOwnership.ts: void dead.end().catch(() => {})": { n: 1, why: "ending a dead ownership connection; nothing is waiting on it" },
  "server/game/gameOwnership.ts: void next.end().catch(() => {})": { n: 1, why: "ending a superseded ownership connection; nothing is waiting on it" },
  "server/game/gameOwnership.ts: void next.query(\"SELECT 1\").then( () => { for (c": { n: 1, why: "the ownership liveness probe, stopped when closeOwnership() ends the connection" },
  "server/game/gameOwnership.ts: void reclaim()": { n: 3, why: "the ownership reconnect loop, stopped by closeOwnership()" },
  "server/game/ratings.ts: started.rows.catch(() => { if (last === started)": { n: 1, why: "bookkeeping on a read its caller awaits" },
  "server/game/roomWriteChain.ts: settle = (async () => write())()": { n: 1, why: "the room write chain: roomWritesLanded() awaits the tail, as closeDatabase()'s drain does" },
  "server/game/tableHandOff.ts: tail = next": { n: 1, why: "the hand-off chain, awaited by handOffTables()" },
  "server/game/tableHandOff.ts: void outcome .catch(() => {}) .finally(() => { r": { n: 1, why: "the hand-off is awaited by handOffTables(), the first step of shutdown" },
  "server/game/tableRouter.ts: outcome.catch(() => applied.delete(action.id))": { n: 1, why: "bookkeeping on an outcome the caller awaits" },
  "server/http/admin.ts: previousSnapshot = snapshot.catch(() => {})": { n: 1, why: "the admin snapshot chain, read by the next request" },
  "server/http/health.ts: void pollStore()": { n: 2, why: "the probe loop is stopped by stopHealth(), which stop() and shutdown call" },
  "server/http/health.ts: void refreshLinks()": { n: 3, why: "the probe loop is stopped by stopHealth(), which stop() and shutdown call" },
  "server/http/rateLimit.ts: this.#localTail = taken.catch(() => {})": { n: 1, why: "the rate limiter's local chain, awaited by the next take" },
  "server/http/rateLimit.ts: this.#scriptsLoaded ??= this.#redis.init(this.#o": { n: 1, why: "the limiter's one script load, awaited by every take" },
  "server/index.ts: (async () => { const { server, io, rt } = await ": { n: 1, why: "the process entry: boot, and the signal handlers that start shutdown" },
  "server/index.ts: void adapterUp.then(() => logger.info(`express s": { n: 1, why: "the process entry: boot, and the signal handlers that start shutdown" },
  "server/index.ts: void shutdown(\"SIGINT\", { io, server, tables: rt": { n: 1, why: "the process entry: boot, and the signal handlers that start shutdown" },
  "server/index.ts: void shutdown(\"SIGTERM\", { io, server, tables: r": { n: 1, why: "the process entry: boot, and the signal handlers that start shutdown" },
  "server/shared/telemetryBatch.ts: flushing = run": { n: 1, why: "flushTelemetry() awaits the batch in flight, and stop() and shutdown call it" },
  "server/shared/telemetryBatch.ts: void flush(false)": { n: 1, why: "flushTelemetry() awaits the batch in flight, and stop() and shutdown call it" },
  "server/shared/telemetryBatch.ts: void flush(true)": { n: 1, why: "flushTelemetry() awaits the batch in flight, and stop() and shutdown call it" },
  "server/shared/telemetryBatch.ts: void run.finally(() => { if (flushing === run) f": { n: 1, why: "flushTelemetry() awaits the batch in flight, and stop() and shutdown call it" },
  "server/socket/delivery.ts: tail = tail.then(async () => { const where = awa": { n: 1, why: "the delivery chain, awaited by the next flush" },
  "server/socket/delivery.ts: void sent.finally(() => { if (roomTails.get(room": { n: 1, why: "bookkeeping on a send already tracked at its call" },
  "server/socket/seating.ts: socket.join(roomId)": { n: 1, why: "the adapter's room bookkeeping for a socket the server owns; io.close() ends the sockets" },
  "server/socket/seating.ts: socket.leave(roomId)": { n: 1, why: "the adapter's room bookkeeping for a socket the server owns; io.close() ends the sockets" },
  "server/socket/socket.ts: callback async (socket: Socket) => { const userId = socke": { n: 1, why: "the connection handler: its presence work is tracked inside and its listeners are registered before the first await" },
  "server/socket/socket.ts: void socket.join(userRoom(userId))": { n: 1, why: "the adapter's room bookkeeping for a socket the server owns; io.close() ends the sockets" },
  "server/socket/socketAdapter.ts: void serverSideEmit([LEAVING, instanceId])": { n: 1, why: "adapter traffic on links io.close() ends; a lost heartbeat is retried by the next" },
  "server/socket/socketAdapter.ts: void serverSideEmit(heartbeatPacket())": { n: 1, why: "adapter traffic on links io.close() ends; a lost heartbeat is retried by the next" },
  "server/socket/socketRegistry.ts: socket.leave(roomId)": { n: 1, why: "the adapter's room bookkeeping for a socket the server owns; io.close() ends the sockets" },
  "server/store/db.ts: void check()": { n: 1, why: "the pool probe, ended by closeDatabase()" },
  "server/store/instanceInbox.ts: void keepAlive()": { n: 2, why: "the inbox reader and its renewals, ended by stopInbox(), which stop() and shutdown await" },
  "server/store/instanceInbox.ts: void mine.catch(() => {}).finally(() => { if (ta": { n: 1, why: "the inbox reader and its renewals, ended by stopInbox(), which stop() and shutdown await" },
  "server/store/instanceInbox.ts: void read(reader)": { n: 1, why: "the inbox reader and its renewals, ended by stopInbox(), which stop() and shutdown await" },
  "server/store/presence.ts: beating = beat() .catch(warn(\"Presence heartbeat": { n: 1, why: "the heartbeat in flight, tracked at its start and stopped with the store" },
  "server/store/presence.ts: guardTail = run.catch(() => {})": { n: 1, why: "the guarded-transaction chain, awaited by the next guard" },
  "server/store/redis.ts: client.connect().catch(() => {})": { n: 1, why: "a connection attempt on a client whose owner closes it" },
  "server/store/roomStore.ts: void tail.then(() => { if (statusWrites.get(room": { n: 1, why: "bookkeeping on the room status write chain" },
};

const head = (node: ts.Node) => node.getText().replace(/\s+/g, " ").replace(/;$/, "").slice(0, 48);

const thenableType = (type: ts.Type): boolean => (type.isUnion() ? type.types.some(thenableType) : type.getProperty("then") !== undefined);

function isThenable(checker: ts.TypeChecker, node: ts.Expression): boolean {
  return thenableType(checker.getTypeAtLocation(node));
}

const isTrack = (e: ts.Expression) => ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "track";

/** Callees whose function argument runs later with nobody reading what it returns. */
const DEFERS = new Set(["setTimeout", "setInterval", "setImmediate", "queueMicrotask", "arm", "safeTimer", "on", "once", "forEach"]);

function calleeName(call: ts.CallExpression): string {
  const c = call.expression;
  return ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
}

/** Whether `name` is awaited or returned anywhere in `file`: a local that is only ever kept, and later settled. */
function settledLater(file: ts.SourceFile, name: string): boolean {
  let seen = false;
  const look = (n: ts.Node) => {
    if ((ts.isAwaitExpression(n) || ts.isReturnStatement(n)) && n.expression && ts.isIdentifier(n.expression) && n.expression.text === name) seen = true;
    ts.forEachChild(n, look);
  };
  look(file);
  return seen;
}

export function untracked(files: string[], override: Record<string, string> = {}): string[] {
  const program = programFor(files, override);
  const checker = program.getTypeChecker();
  const found: string[] = [];
  const visit = (file: string, source: ts.SourceFile) => (node: ts.Node) => {
    const at = () => `${file}: ${head(node)}`;
    if (ts.isVoidExpression(node)) {
      if (!isTrack(node.expression) && isThenable(checker, node.expression)) found.push(at());
    } else if (ts.isExpressionStatement(node)) {
      const e = node.expression;
      if (ts.isBinaryExpression(e) && e.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && e.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const keptLocal = ts.isIdentifier(e.left) && settledLater(source, e.left.text);
        if (!keptLocal && !isTrack(e.right) && isThenable(checker, e.right)) found.push(at());
      } else if (!ts.isAwaitExpression(e) && !ts.isVoidExpression(e) && isThenable(checker, e)) found.push(at());
    } else if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isCallExpression(node.parent) &&
      DEFERS.has(calleeName(node.parent)) && !(ts.isIdentifier(node.parent.expression) && ["on", "once"].includes(node.parent.expression.text)) &&
      node.parent.arguments.includes(node)
    ) {
      const returns = checker.getSignaturesOfType(checker.getTypeAtLocation(node), ts.SignatureKind.Call).map((s) => checker.getReturnTypeOfSignature(s));
      if (returns.some(thenableType)) found.push(`${file}: callback ${head(node)}`);
    }
    ts.forEachChild(node, visit(file, source));
  };
  for (const file of files) {
    const source = program.getSourceFile(path.resolve(repoRoot, file));
    assert.ok(source, `${file} is not in the program`);
    ts.forEachChild(source, visit(file, source));
  }
  return found.sort();
}

/** The registry itself, whose own bookkeeping cannot register with itself. */
const REGISTRY = "server/shared/inFlight.ts";
const SERVER = sourcesUnder(repoRoot, ["server"], /\.ts$/).map(([f]) => f).filter((f) => f !== REGISTRY);

test("every detached promise in server/ is tracked or listed with its reason", () => {
  assert.ok(SERVER.length > 50 && SERVER.includes("server/store/presence.ts"), "the scan read no server source");
  const found = untracked(SERVER);
  const listed = Object.entries(DETACHED).flatMap(([key, { n }]) => Array<string>(n).fill(key));
  assert.deepEqual(
    found,
    listed.sort(),
    "track it with server/shared/inFlight.ts, or list it in DETACHED with why it may outlive stop(); a listed one that is gone comes off"
  );
});

test("the scan sees a bare void, .then, call, optional call, property assignment and deferred callback, and not a tracked, awaited or kept one", () => {
  const file = "server/shared/refusal.ts";
  const text = [
    "async function work(): Promise<void> {}",
    "declare function track<T>(p: Promise<T>): Promise<T>;",
    "declare const maybe: { w(): Promise<void> } | undefined;",
    "declare const cond: boolean;",
    "declare const box: { p?: Promise<void> };",
    "export async function planted() {",
    "  void work();",
    "  work().then(() => {});",
    "  work();",
    "  void maybe?.w();",
    "  box.p = work();",
    "  setTimeout(async () => { await work(); }, 1);",
    "  setTimeout(() => work(), 1);",
    "  cond && work();",
    "  [1].forEach(async () => { await work(); });",
    "  void track(work());",
    "  box.p = track(work());",
    "  await work();",
    "  let kept: Promise<void> | undefined;",
    "  kept = work();",
    "  await kept;",
    "  setTimeout(() => { void track(work()); }, 1);",
    "}",
  ].join("\n");
  const found = untracked([file], { [file]: text });
  assert.deepEqual(found.map((f) => f.split(": ").slice(1).join(": ")), [
    "box.p = work()",
    "callback () => work()",
    "callback async () => { await work(); }",
    "callback async () => { await work(); }",
    "cond && work()",
    "void maybe?.w()",
    "void work()",
    "work()",
    "work().then(() => {})",
  ]);
});
