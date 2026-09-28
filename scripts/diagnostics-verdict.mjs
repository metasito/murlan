#!/usr/bin/env node
// node scripts/diagnostics-verdict.mjs <run.ndjson> <scenario|all> — exits 1 unless every named gate passed.
// node scripts/diagnostics-verdict.mjs --flinger <start.txt> <end.txt> — the audio_flinger underrun gate (#1231).
import { readFileSync } from "node:fs";
import { isInvokedDirectly } from "./lib/entry.mjs";

function slopePerMinute(points) {
  const n = points.length;
  const mx = points.reduce((a, [x]) => a + x, 0) / n;
  const my = points.reduce((a, [, y]) => a + y, 0) / n;
  const sxy = points.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
  const sxx = points.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  return sxx === 0 ? NaN : sxy / sxx;
}

function fit(points) {
  const slope = slopePerMinute(points);
  const mx = points.reduce((a, [x]) => a + x, 0) / points.length;
  const my = points.reduce((a, [, y]) => a + y, 0) / points.length;
  return (x) => my + slope * (x - mx);
}

function soak(rows) {
  const t0 = rows[0].t;
  const t1 = rows.at(-1).t;
  const minutes = (t1 - t0) / 60000;
  const memory = rows.filter((r) => r.k === "footprint" && r.t - t0 >= 5 * 60000).map((r) => [(r.t - t0) / 60000, r.mb]);
  const engine = rows.filter((r) => r.k === "engine");
  const lag = engine.map((r) => [(r.t - t0) / 60000, r.audioMs - r.t]);
  const line = lag.length >= 2 ? fit(lag) : () => NaN;
  const residual = lag.map(([x, y]) => y - line(x));
  const jumps = engine.slice(1).filter((_, i) => !(Math.abs(residual[i + 1] - residual[i]) <= 20)).map((r) => r.t);
  const mid = (t0 + t1) / 2;
  const firstHalf = jumps.filter((t) => t < mid).length;
  const secondHalf = jumps.length - firstHalf;
  const notRunning = engine.filter((r) => r.state !== "running").length;
  const plays = rows.filter((r) => r.k === "play" && !r.dropped).length;
  const mbPerMin = memory.length >= 10 ? slopePerMinute(memory) : NaN;
  const pass =
    minutes >= 29 && mbPerMin < 1 && secondHalf <= firstHalf && notRunning === 0 && engine.length >= minutes * 5 && plays >= minutes * 45;
  return { pass, metrics: { minutes, mbPerMin, driftMsPerMin: slopePerMinute(lag), firstHalf, secondHalf, notRunning, plays, samples: engine.length } };
}

function smoke(rows) {
  const engine = rows.filter((r) => r.k === "engine");
  const first = engine[0];
  const last = engine.at(-1);
  const advance = engine.length >= 2 ? (last.audioMs - first.audioMs) / (last.t - first.t) : 0;
  const running = engine.length > 0 && engine.every((r) => r.state === "running");
  const pass = engine.length >= 5 && running && advance >= 0.9;
  return { pass, metrics: { samples: engine.length, running, advance, ...(pass ? {} : { error: "no audio device" }) } };
}

const UNDERRUNS = /underrun counters: partial=(\d+) empty=(\d+)/g;

export function flingerUnderruns(text) {
  const counts = [...text.matchAll(UNDERRUNS)].map((m) => Number(m[1]) + Number(m[2]));
  return counts.length === 0 ? null : counts.reduce((a, b) => a + b, 0);
}

export function flingerVerdict(startText, endText) {
  const start = flingerUnderruns(startText);
  const end = flingerUnderruns(endText);
  const growth = start === null || end === null ? null : end - start;
  return { pass: growth !== null && growth <= 60, metrics: { start, end, growth } };
}

export const GATES = {
  idle: (rows) => {
    const frames = rows.filter((r) => r.k === "frame").length;
    return { pass: frames > 0, metrics: { frames } };
  },
  soak,
  smoke,
};

function bracket(rows, scenario) {
  const start = rows.findLastIndex((r) => r.k === "scenario" && r.name === scenario && r.phase === "start");
  if (start === -1) return null;
  const session = rows[start].session;
  const end = rows.findIndex((r, i) => i > start && r.k === "scenario" && r.name === scenario && r.phase === "end");
  if (end === -1) return null;
  return { rows: rows.slice(start, end + 1).filter((r) => r.session === session), session, error: rows[end].error ?? null };
}

function unrun(build) {
  if (!build) return "no build row";
  if (build.dev) return "dev JS";
  return !build.scriptURL || /^https?:/i.test(build.scriptURL) ? "not an embedded Release bundle" : null;
}

export function verdict(rows, scenario) {
  const gate = GATES[scenario];
  const part = gate && bracket(rows, scenario);
  if (!part) return null;
  const v = gate(part.rows);
  const dropped = rows.filter((r) => r.k === "batch" && r.session === part.session).reduce((n, r) => n + (r.dropped ?? 0), 0);
  const judged = part.error
    ? { pass: false, metrics: { ...v.metrics, error: part.error } }
    : dropped > 0 ? { pass: false, metrics: { ...v.metrics, dropped } } : v;
  const reason = unrun(rows.findLast((r) => r.k === "build" && r.session === part.session));
  return reason ? { pass: null, metrics: { ...judged.metrics, unrun: reason } } : judged;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  if (process.argv[2] === "--flinger") {
    const v = flingerVerdict(readFileSync(process.argv[3], "utf8"), readFileSync(process.argv[4], "utf8"));
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.pass ? 0 : 1);
  }
  const [file, scenario] = process.argv.slice(2);
  const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const names = scenario === "all" ? Object.keys(GATES).filter((n) => rows.some((r) => r.k === "scenario" && r.name === n)) : [scenario];
  const out = Object.fromEntries(names.map((n) => [n, verdict(rows, n)]));
  console.log(JSON.stringify(out, null, 2));
  process.exit(names.length > 0 && names.every((n) => out[n]?.pass === true) ? 0 : 1);
}
