// The hands-free device bench's end: wait for the run, then one pass/fail table (docs/agents/checks.md).
import { existsSync, readFileSync } from "node:fs";
import { verdict } from "./diagnostics-verdict.mjs";

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

function keyNumbers(metrics) {
  return Object.entries(metrics)
    .filter(([, v]) => v === null || typeof v !== "object")
    .map(([k, v]) => `${k}=${typeof v === "number" ? +v.toFixed(2) : v}`)
    .join(" ")
    .slice(0, 140);
}

export function gateTable(rows, names) {
  const lines = ["| Scenario | Result | Key numbers |", "| --- | --- | --- |"];
  let pass = names.length > 0;
  for (const name of names) {
    const v = verdict(rows, name);
    const result = !v ? "missing" : v.pass === true ? "pass" : v.pass === null ? "unrun" : "fail";
    if (result !== "pass") pass = false;
    lines.push(`| ${name} | ${result} | ${v ? keyNumbers(v.metrics) : ""} |`);
  }
  return { pass, markdown: lines.join("\n") };
}
