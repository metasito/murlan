// tests/server/presenceScan.test.ts — presence is state in Redis, asked by key: nothing under
// server/ sweeps the cluster's sockets for it, and the presence code sends Redis no script.
// The behaviour these stand beside: tests/integration/presenceCluster.test.ts (no FETCH_SOCKETS
// per connect) and tests/integration/presenceStore.test.ts (compare-and-delete without a script).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { blankComments, scanSources, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const FETCH_SOCKETS = /\bfetchSockets\s*\(/g;
const SCRIPT = /\.\s*(?:eval|evalSha|evalRo|evalShaRo|fCall|scriptLoad)\s*\(|["'`]\s*(?:EVAL|EVALSHA|EVAL_RO|EVALSHA_RO|FCALL|SCRIPT)\b/gi;
const PRESENCE_CODE = ["server/store/presence.ts", "server/socket/socketOutbox.ts", "server/socket/socketPresence.ts"];

const code = (sources: [string, string][]) => sources.map(([f, src]): [string, string] => [f, blankComments(src)]);

test("nothing under server/ asks the cluster for its sockets", () => {
  const sources = sourcesUnder(repoRoot, ["server"], /\.[cm]?[jt]sx?$/);
  assert.ok(sources.some(([f]) => f === "server/socket/socketRegistry.ts"), "the scan read no server source");
  assert.deepEqual(scanSources(FETCH_SOCKETS, code(sources)), []);
});

test("the presence code sends Redis no script", () => {
  const sources = sourcesUnder(repoRoot, ["server"], /\.ts$/).filter(([f]) => PRESENCE_CODE.includes(f));
  assert.deepEqual(sources.map(([f]) => f).sort(), [...PRESENCE_CODE].sort(), "a presence file moved; the scan would read nothing");
  assert.match(sources.find(([f]) => f === "server/store/presence.ts")![1], /\.mGet\(/, "the presence store no longer reads Redis here");
  assert.deepEqual(scanSources(SCRIPT, code(sources)), []);
});

test("the scans see what they forbid, and not a comment", () => {
  const planted: [string, string][] = [
    ["a.ts", "await io.in(room).fetchSockets();"],
    ["b.ts", "await io\n  .fetchSockets ();"],
    ["c.ts", "await client.eval(CLEAR, { keys: [k] });"],
    ["d.ts", 'await client.sendCommand(["EVAL", script, "1", k]);'],
    ["e.ts", "await client.evalSha(sha, { keys: [k] });"],
    ["f.ts", "// client.eval(x) and io.fetchSockets()\nawait client.get(k);"],
  ];
  assert.deepEqual([...new Set(scanSources(FETCH_SOCKETS, code(planted)).map((s) => s.split(":")[0]))], ["a.ts", "b.ts"]);
  assert.deepEqual([...new Set(scanSources(SCRIPT, code(planted)).map((s) => s.split(":")[0]))], ["c.ts", "d.ts", "e.ts"]);
});
