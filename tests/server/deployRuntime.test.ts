import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { connectionsPerInstance } from "../../server/store/pool.ts";
import { blankComments, scanSources, sourcesUnder } from "../helpers/sourceScan.ts";
import { CLUSTER_GAP_SECONDS, streamMaxLen } from "../../server/store/redis.ts";
import { adapterOptions } from "../../server/socket/socketAdapter.ts";
import { inboxTrim } from "../../server/store/instanceInbox.ts";
import { PLATFORM_GRACE_MS } from "../../server/http/shutdown.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");
const manifest = JSON.parse(read("deploy", "runtime.json"));

test("the engines floor is the manifest's Node major", () => {
  const floor = JSON.parse(read("package.json")).engines.node;
  assert.match(floor, /^>=\d+$/, "engines.node stays a floor");
  assert.equal(Number(floor.slice(2)), manifest.node);
});

test(".node-version is the manifest's Node major, so CI and dev run production's", () => {
  assert.equal(Number(read(".node-version").trim()), manifest.node);
});

test("the shutdown budget is sized to the manifest's SIGTERM grace", () => {
  assert.equal(PLATFORM_GRACE_MS, manifest.sigtermGraceMs);
});

test("the manifest's connections per instance is the sum over the connection profiles", () => {
  assert.equal(manifest.pgConnectionsPerInstance, connectionsPerInstance());
});

const OPENS = /\bcreate(?:Pool|Client)\(\s*"([a-z]+)"/g;

function profilesOpened(sources: [string, string][]): string[] {
  return scanSources(OPENS, sources.map(([f, src]): [string, string] => [f, blankComments(src)]));
}

test("each profile is opened from one place, so the budget counts what runs", () => {
  const sites = profilesOpened(sourcesUnder(repoRoot, ["server"], /\.ts$/));
  assert.ok(sites.length >= 3, `the scan found ${sites.length} openings: it reads nothing`);
  const names = sites.map((s) => s.slice(s.indexOf('"')));
  assert.deepEqual(names, [...new Set(names)], `a profile opened twice holds twice its share:\n${sites.join("\n")}`);
});

test("the opening scan sees a pool or a client named by its profile, and not a comment", () => {
  const planted: [string, string][] = [
    ["a.ts", 'const p = createPool("app", { max });'],
    ["b.ts", 'const c = createClient(\n  "ownership", onError);'],
    ["c.ts", '// createPool("admin")\nconst x = createPoolish("health");'],
  ];
  assert.deepEqual(profilesOpened(planted), ['a.ts: createPool("app"', 'b.ts: createClient(\n  "ownership"']);
});

test("the cluster streams hold two minutes of the manifest's design peak", () => {
  assert.equal(manifest.maxClusterMessagesPerSecond, 1000);
  assert.equal(CLUSTER_GAP_SECONDS, 120);
  assert.equal(streamMaxLen(), 120_000);
  assert.equal(streamMaxLen(7), 840);
  assert.equal(adapterOptions().maxLen, 120_000, "the adapter's stream, which defaults to 10,000 without it");
  assert.equal(inboxTrim().threshold, 120_000, "each inbox");
  assert.equal(inboxTrim().strategy, "MAXLEN");
});
