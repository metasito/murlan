// The hands-free device bench's end: wait for the run, then one pass/fail table (docs/agents/device-runs.md).
import { existsSync, readFileSync } from "node:fs";
import { GATES, verdict } from "./diagnostics-verdict.mjs";

export function readRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

export async function waitForRunEnd(read, { pollMs = 5000, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = read();
    const end = rows.findLast((r) => r.k === "run" && r.phase === "end");
    if (end) return { names: end.names ?? [], timedOut: false };
    if (Date.now() >= deadline) return { names: rows.findLast((r) => r.k === "run" && r.phase === "start")?.names ?? [], timedOut: true };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** The rows up to the first run-end after `from`: a run the phone starts after it (a stray tap on its button) is not part of this verdict. */
export function untilRunEnd(rows, from = 0) {
  const end = rows.findIndex((r, i) => i >= from && r.k === "run" && r.phase === "end");
  return end < 0 ? rows : rows.slice(0, end + 1);
}

const num = (v) => (typeof v === "number" ? +v.toFixed(2) : v);

/** What an earlier run finished on a Release bundle with no error and no lost data, judged on each scenario's latest attempt. */
export function doneScenarios(rows) {
  const names = new Set(rows.filter((r) => r.k === "scenario" && r.phase === "start").map((r) => r.name));
  return [...names].filter((name) => verdict(rows, name, { [name]: () => ({ pass: true, metrics: {} }) })?.pass === true);
}

function keyNumbers(metrics) {
  const { sys } = metrics;
  const own = Object.entries(metrics)
    .filter(([, v]) => v === null || typeof v !== "object")
    .map(([k, v]) => `${k}=${num(v)}`)
    .join(" ")
    .slice(0, 140);
  const device = sys
    ? ` thermal=${sys.maxThermal}/${sys.thermalAtEnd} cpu%=${num(sys.cpuPctP50)}/${num(sys.cpuPctP90)} gpuMb=${num(sys.gpuMbMax)} lowPower=${sys.lowPower} charging=${sys.charging} batteryDropPct=${num(sys.batteryDropPct)}`
    : "";
  return own + device;
}

/** @param {Record<string, (rows: any[]) => { pass: boolean | null; metrics: Record<string, any> }>} [gates] */
export function gateTable(rows, names, timedOut = false, gates = GATES) {
  const lines = ["| Scenario | Result | Key numbers |", "| --- | --- | --- |"];
  let pass = names.length > 0 && !timedOut;
  for (const name of new Set([...Object.keys(gates), ...names])) {
    const v = verdict(rows, name, gates);
    const throttled = (v?.metrics.sys?.maxThermal ?? 0) >= 2;
    const result = !v ? "missing" : v.pass === true ? "pass" : v.pass === null ? "unrun" : throttled ? "fail (throttled: rerun cool)" : "fail";
    if (result !== "pass") pass = false;
    lines.push(`| ${name} | ${result} | ${v ? keyNumbers(v.metrics) : ""} |`);
  }
  return { pass, markdown: lines.join("\n") };
}
