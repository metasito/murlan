// tests/server/inFlightScan.test.ts — a presence write or notice nobody awaits is registered with
// server/shared/inFlight.ts, so stop() and shutdown() wait for it before the clients it uses close.
// The behaviour this stands beside: tests/integration/testServerCleanup.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { blankComments, scanSources, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const DETACHED = /(?:^|[;)]\s*)void\s+(?!track\()/gm;
const FILES = ["server/store/presence.ts", "server/socket/socketPresence.ts", "server/socket/seating.ts"];

const code = (sources: [string, string][]) => sources.map(([f, src]): [string, string] => [f, blankComments(src)]);

test("nothing detached in the presence code escapes the in-flight registry", () => {
  const sources = sourcesUnder(repoRoot, ["server"], /\.ts$/).filter(([f]) => FILES.includes(f));
  assert.deepEqual(sources.map(([f]) => f).sort(), [...FILES].sort(), "a presence file moved; the scan would read nothing");
  assert.deepEqual(scanSources(DETACHED, code(sources)), []);
});

test("the scan sees a bare void and not a tracked one", () => {
  const planted: [string, string][] = [
    ["a.ts", "void client.del(k);"],
    ["b.ts", "if (heartbeat) void beat();"],
    ["c.ts", "void track(client.del(k));\nconst f: () => void = () => {};"],
  ];
  assert.deepEqual([...new Set(scanSources(DETACHED, code(planted)).map((s) => s.split(":")[0]))], ["a.ts", "b.ts"]);
});
