#!/usr/bin/env node
// node scripts/diagnostics-verdict.mjs <run.ndjson> <scenario|all> — exits 1 unless every named gate passed.
import { readFileSync } from "node:fs";
import { isInvokedDirectly } from "./lib/entry.mjs";

export const GATES = {
  idle: (rows) => {
    const frames = rows.filter((r) => r.k === "frame").length;
    return { pass: frames > 0, metrics: { frames } };
  },
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
  const [file, scenario] = process.argv.slice(2);
  const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const names = scenario === "all" ? Object.keys(GATES).filter((n) => rows.some((r) => r.k === "scenario" && r.name === n)) : [scenario];
  const out = Object.fromEntries(names.map((n) => [n, verdict(rows, n)]));
  console.log(JSON.stringify(out, null, 2));
  process.exit(names.length > 0 && names.every((n) => out[n]?.pass === true) ? 0 : 1);
}
