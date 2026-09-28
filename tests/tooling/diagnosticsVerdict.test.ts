import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createCollector } from "../../scripts/diagnostics-collector.mjs";
import { verdict } from "../../scripts/diagnostics-verdict.mjs";

const RELEASE = { k: "build", t: 0, dev: false, scriptURL: "file:///var/containers/Bundle/Application/X/murlan.app/main.jsbundle" };

const bracket = (session: string, name: string, inner: object[], error: string | null = null, build: object | null = RELEASE) => [
  ...(build ? [{ session, ...build }] : []),
  { session, k: "scenario", t: 0, name, phase: "start" },
  ...inner.map((r) => ({ session, ...r })),
  { session, k: "scenario", t: 5000, name, phase: "end", error },
];

test("the collector appends a batch line and every posted row as NDJSON", async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "murlan-collector-")), "run.ndjson");
  const server = createCollector(file).listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  const body = JSON.stringify({ session: "s1", seq: 0, dropped: 2, rows: [{ k: "frame", t: 1, dt: 16 }] });
  const res = await fetch(`http://127.0.0.1:${port}/log`, { method: "POST", body });
  server.close();
  assert.equal(res.status, 200);
  const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [
    { session: "s1", seq: 0, k: "batch", n: 1, dropped: 2 },
    { session: "s1", seq: 0, k: "frame", t: 1, dt: 16 },
  ]);
});

test("a verdict reads its own scenario's bracket in the newest session only", () => {
  const rows = [...bracket("old", "idle", [{ k: "frame", t: 1, dt: 16 }]), ...bracket("new", "idle", [])];
  assert.deepEqual(verdict(rows, "idle"), { pass: false, metrics: { frames: 0 } });
});

test("no bracket, an unfinished bracket, or an unknown scenario is no verdict", () => {
  assert.equal(verdict([], "idle"), null);
  assert.equal(verdict(bracket("s", "idle", []).slice(0, 2), "idle"), null);
  assert.equal(verdict(bracket("s", "nope", []), "nope"), null);
});

test("a scenario that threw, or rows the phone dropped, fail whatever the gate said", () => {
  const frame = { k: "frame", t: 1, dt: 16 };
  assert.equal(verdict(bracket("s", "idle", [frame]), "idle")?.pass, true);
  assert.equal(verdict(bracket("s", "idle", [frame], "Error: boom"), "idle")?.pass, false);
  const dropped = [{ session: "s", k: "batch", n: 1, dropped: 3 }, ...bracket("s", "idle", [frame])];
  assert.deepEqual(verdict(dropped, "idle"), { pass: false, metrics: { frames: 1, dropped: 3 } });
});

test("a verdict stands only on a Release build with an embedded bundle; anything else is unrun, with its metrics", () => {
  const on = (build: object | null) => verdict(bracket("s", "idle", [{ k: "frame", t: 1, dt: 16 }], null, build), "idle");
  assert.deepEqual(on(RELEASE), { pass: true, metrics: { frames: 1 } });
  assert.equal(on({ ...RELEASE, scriptURL: "assets://index.android.bundle" })?.pass, true);
  for (const build of [null, { ...RELEASE, dev: true }, { ...RELEASE, scriptURL: "http://192.168.1.5:8081/index.bundle?platform=ios" }, { ...RELEASE, scriptURL: null }]) {
    const v = on(build);
    assert.equal(v?.pass, null);
    assert.equal(v?.metrics.frames, 1);
    assert.equal(typeof v?.metrics.unrun, "string");
  }
});
