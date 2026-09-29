import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createCollector } from "../../scripts/diagnostics-collector.mjs";
import { burstStalls, flingerUnderruns, flingerVerdict, verdict } from "../../scripts/diagnostics-verdict.mjs";

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

const LATENCY = { k: "latency", t: 0, outputMs: 8, ioMs: 5, inputMs: 10 };
const run = (name: string, inner: object[]) => bracket("d", name, [LATENCY, ...inner]);
const onset = (t: number, source: "app" | "mic" = "app") => ({ k: "onset", t, db: -20, source });

type Arm = { onsetMs?: number; drop?: number; ui?: number; js?: number; hz?: number; ticks?: number };

function arm(name: string, on: boolean, o: Arm = {}): object[] {
  const end = 1000 + 60 * 167 + 600;
  const rows: object[] = [{ k: "arm", t: 0, name, phase: "start" }];
  const dt = 1000 / (o.hz ?? 120);
  for (let t = 1000; t < end; t += dt) rows.push({ k: "frame", t, dt });
  for (let i = 0; i < 60; i++) {
    const t = 1000 + i * 167;
    rows.push({ k: "trigger", t, name: "tap" });
    if (!on) continue;
    rows.push({ k: "play", t, id: "select", at: t, bus: "sfx", dropped: false, lead: 10.5 });
    if (i !== o.drop) rows.push(onset(t + (o.onsetMs ?? 20)));
  }
  if (o.ui) rows.push({ k: "frame", t: o.ui, dt: 40 });
  if (o.js) rows.push({ k: "jsLag", t: o.js, dt: 40 });
  rows.push({ k: "jsTicks", t: end, n: o.ticks ?? 1200 }, { k: "arm", t: end + 1, name, phase: "end" });
  return rows;
}

const burst = (o: Arm) => verdict(run("tapBurst", [...arm("off", false), ...arm("on", true, o)]), "tapBurst");

test("tapBurst passes 60 taps heard in 30.5 ms at 120 Hz with no stall on either thread", () => {
  const v = burst({});
  assert.equal(v?.pass, true);
  assert.equal(v?.metrics.tapToHeardP90, 30.5);
});

test("tapBurst fails one silent tap, a UI stall, a JS stall, a 60 Hz burst, no JS ticks, a slow onset, or an onset before its tap", () => {
  assert.equal(burst({ drop: 17 })?.metrics.missing, 1);
  assert.equal(burst({ drop: 17 })?.pass, false);
  assert.equal(burst({ ui: 5000 })?.metrics.stalls, 1);
  assert.equal(burst({ ui: 5000 })?.pass, false);
  assert.equal(burst({ js: 5000 })?.pass, false);
  assert.equal(burst({ hz: 60 })?.pass, false);
  assert.equal(burst({ ticks: 0 })?.pass, false);
  assert.equal(burst({ onsetMs: 40 })?.pass, false);
  assert.equal(burst({ onsetMs: -30 })?.pass, false);
});

test("burstStalls merges a UI and a JS stall 60 ms apart into one, and keeps two 200 ms apart", () => {
  const rows = (gap: number) => [{ k: "frame", t: 1000, dt: 40 }, { k: "jsLag", t: 1000 + gap, dt: 40 }];
  assert.equal(burstStalls(rows(60)).stalls, 1);
  assert.equal(burstStalls(rows(200)).stalls, 2);
});

test("scheduledOnset judges the mic: passes a 10 ms bias, fails a 30 ms one, fails a missing onset, and reports the app track", () => {
  const rows = (err: number, n = 40) =>
    run("scheduledOnset", Array.from({ length: 40 }, (_, i) => {
      const at = 1000 + i * 1000;
      return [
        { k: "trigger", t: at, name: "scheduled" },
        { k: "play", t: at - 300, id: "turn", at, bus: "sfx", dropped: false, lead: 10.5 },
        onset(at - 10.5 + 2, "app"),
        ...(i < n ? [onset(at + err + 10, "mic")] : []),
      ];
    }).flat());
  const good = verdict(rows(10), "scheduledOnset");
  assert.equal(good?.pass, true);
  assert.equal(good?.metrics.appMedianErr, 2);
  assert.equal(verdict(rows(30), "scheduledOnset")?.pass, false);
  assert.equal(verdict(rows(10, 39), "scheduledOnset")?.pass, false);
});

test("pulseCost passes a 5 ms cold fire and 0.3 ms warm ones, and fails a slow cold, a slow warm p90 or a short run", () => {
  const rows = (cold: number, warm: number, n = 20) =>
    run("pulseCost", [{ k: "pulseCost", t: 1, ms: cold, cold: true }, ...Array.from({ length: n }, (_, i) => ({ k: "pulseCost", t: 2 + i, ms: warm, cold: false }))]);
  assert.equal(verdict(rows(5, 0.3), "pulseCost")?.pass, true);
  assert.equal(verdict(rows(12, 0.3), "pulseCost")?.pass, false);
  assert.equal(verdict(rows(5, 2), "pulseCost")?.pass, false);
  assert.equal(verdict(rows(5, 0.3, 19), "pulseCost")?.pass, false);
});

test("hapticOnset passes 30 shakes 20 ms after their pulses, and fails a missing one or a slow p90", () => {
  const rows = (lag: (i: number) => number | null) =>
    run("hapticOnset", Array.from({ length: 30 }, (_, i) => {
      const t = 1000 + i * 1000;
      const l = lag(i);
      return [{ k: "trigger", t, name: "pulse" }, ...(l === null ? [] : [{ k: "shake", t: t + l, g: 0.05 }])];
    }).flat());
  assert.equal(verdict(rows(() => 20), "hapticOnset")?.pass, true);
  assert.equal(verdict(rows((i) => (i === 3 ? null : 20)), "hapticOnset")?.pass, false);
  assert.equal(verdict(rows((i) => (i < 5 ? 80 : 20)), "hapticOnset")?.pass, false);
});

test("musicSwitch passes steady music, and fails a 300 ms gap, a 2 s death, or music too quiet to judge", () => {
  const rows = (db: (t: number) => number) =>
    run("musicSwitch", [
      ...Array.from({ length: 40 }, (_, i) => ({ k: "trigger", t: 1000 + i * 3000, name: "switch" })),
      ...Array.from({ length: 2400 }, (_, i) => ({ k: "level", t: 1000 + i * 50, db: db(1000 + i * 50) })),
    ]);
  assert.equal(verdict(rows(() => -25), "musicSwitch")?.pass, true);
  assert.equal(verdict(rows((t) => (t >= 30000 && t < 30300 ? -60 : -25)), "musicSwitch")?.pass, false);
  assert.equal(verdict(rows((t) => (t >= 30000 && t < 32100 ? -60 : -25)), "musicSwitch")?.metrics.deaths, 1);
  assert.equal(verdict(rows(() => -45), "musicSwitch")?.pass, false);
});
