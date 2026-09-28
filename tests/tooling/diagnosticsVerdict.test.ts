import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createCollector } from "../../scripts/diagnostics-collector.mjs";
import { flingerUnderruns, flingerVerdict, verdict } from "../../scripts/diagnostics-verdict.mjs";

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

function soakRows(opts: { minutes: number; mbPerMin: number; lateSteps?: number; state?: string; playsPerMin?: number; rate?: number; name?: string }) {
  const rows: object[] = [];
  const end = opts.minutes * 60000;
  for (let t = 0; t <= end; t += 10000) {
    const late = opts.lateSteps && t > end / 2 && t % 60000 === 0 ? 30 : 0;
    rows.push({ k: "engine", t, state: opts.state ?? "running", audioMs: t * (opts.rate ?? 1) + 5 + late, plays: 0 });
    rows.push({ k: "footprint", t, mb: 150 + (opts.mbPerMin * t) / 60000 });
  }
  const plays = Math.round(opts.minutes * (opts.playsPerMin ?? 50));
  for (let i = 0; i < plays; i++) rows.push({ k: "play", t: (i * end) / plays, id: "turn", at: (i * end) / plays, bus: "sfx", dropped: false, lead: 0 });
  const name = opts.name ?? "soak";
  return [
    { session: "s", k: "build", t: 0, dev: false, scriptURL: "assets://index.android.bundle" },
    { session: "s", k: "scenario", t: 0, name, phase: "start" },
    ...rows.map((r) => ({ session: "s", ...r })),
    { session: "s", k: "scenario", t: end, name, phase: "end", error: null },
  ];
}

test("a flat half-hour soak passes, and so does one whose audio clock runs 1% fast", () => {
  assert.equal(verdict(soakRows({ minutes: 30, mbPerMin: 0.2 }), "soak")?.pass, true);
  assert.equal(verdict(soakRows({ minutes: 30, mbPerMin: 0.2, rate: 1.01 }), "soak")?.pass, true);
});

test("the smoke passes a running clock, and fails a clock that stands still as 'no audio device'", () => {
  assert.equal(verdict(soakRows({ minutes: 1, mbPerMin: 0, name: "smoke" }), "smoke")?.pass, true);
  const still = verdict(soakRows({ minutes: 1, mbPerMin: 0, rate: 0, name: "smoke" }), "smoke");
  assert.equal(still?.pass, false);
  assert.equal(still?.metrics.error, "no audio device");
  assert.equal(verdict(soakRows({ minutes: 1, mbPerMin: 0, state: "suspended", name: "smoke" }), "smoke")?.pass, false);
});

const FLINGER = (partial: number, empty: number) =>
  `Output thread 0x7b2c type 0 (MIXER):\n  Normal mixer raw underrun counters: partial=${partial} empty=${empty}\nOutput thread 0x7b40 type 0 (MIXER):\n  Normal mixer raw underrun counters: partial=1 empty=0\n`;

test("underruns are summed over every output thread, and a dump without the counters is no reading", () => {
  assert.equal(flingerUnderruns(FLINGER(3, 4)), 8);
  assert.equal(flingerUnderruns("Output thread 0x7b2c type 0 (MIXER):\n  Standby: no\n"), null);
  assert.equal(flingerVerdict(FLINGER(3, 4), FLINGER(20, 30)).pass, true);
  assert.equal(flingerVerdict(FLINGER(3, 4), FLINGER(40, 40)).pass, false);
  assert.equal(flingerVerdict(FLINGER(3, 4), "no counters").pass, false);
});

test("a soak fails on a 2 MB/min leak, growing lag jumps, a stopped context, too few plays, or too short a run", () => {
  assert.equal(verdict(soakRows({ minutes: 30, mbPerMin: 2 }), "soak")?.pass, false);
  assert.equal(verdict(soakRows({ minutes: 30, mbPerMin: 0.2, lateSteps: 1 }), "soak")?.pass, false);
  assert.equal(verdict(soakRows({ minutes: 30, mbPerMin: 0.2, state: "suspended" }), "soak")?.pass, false);
  assert.equal(verdict(soakRows({ minutes: 30, mbPerMin: 0.2, playsPerMin: 20 }), "soak")?.pass, false);
  assert.equal(verdict(soakRows({ minutes: 10, mbPerMin: 0.2 }), "soak")?.pass, false);
});
