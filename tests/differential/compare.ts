// node tests/differential/compare.ts <baseline.jsonl> <head.jsonl> [--accepted accepted.json] [--baseline <sha>] [--match <table>:<seed>]
// Diffs two `trace.ts` outputs at the deepest level both offer. With --accepted, every differing
// match must be listed and every listed one must still differ. With --match, only that match is
// compared and the exit code says whether it differs (the predicate `git bisect run` needs).
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

interface Line {
  level: "match" | "transition";
  table: string;
  seed: number;
  [k: string]: unknown;
}

export interface Accepted {
  baseline: string;
  entries: { table: string; seed: number; cause: string }[];
}

export interface Diff {
  key: string;
  where: string;
}

export interface Report {
  level: "round" | "transition";
  matches: number;
  rounds: number;
  diffs: Diff[];
  failures: string[];
}

const keyOf = (l: { table: string; seed: number }) => `${l.table}:${l.seed}`;

export function parseTrace(text: string): Line[] {
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Line);
}

function group(lines: Line[]) {
  const matches = new Map<string, Line>();
  const transitions = new Map<string, Line[]>();
  for (const l of lines) {
    if (l.level === "match") matches.set(keyOf(l), l);
    else transitions.set(keyOf(l), [...(transitions.get(keyOf(l)) ?? []), l]);
  }
  return { matches, transitions };
}

function firstDifference(a: Line | undefined, b: Line | undefined, ta: Line[], tb: Line[], deep: boolean): string | null {
  if (!a || !b) return a ? "missing from head" : "missing from baseline";
  if (deep) {
    for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
      if (!isDeepStrictEqual(ta[i], tb[i])) {
        const t = (ta[i] ?? tb[i]) as Line;
        return `round ${t.round}, transition ${t.seq} (${String(ta[i]?.kind)} vs ${String(tb[i]?.kind)})`;
      }
    }
  }
  if ("error" in a || "error" in b) {
    return isDeepStrictEqual(a.error, b.error) ? null : `error: ${String(a.error)} vs ${String(b.error)}`;
  }
  const ra = a.rounds as unknown[];
  const rb = b.rounds as unknown[];
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    if (!isDeepStrictEqual(ra[i], rb[i])) return `round ${i}`;
  }
  if (!isDeepStrictEqual(a.winners, b.winners) || a.isDraw !== b.isDraw) return "match result";
  return null;
}

export function compareTraces(
  baseline: Line[],
  head: Line[],
  accepted?: Accepted,
  opts: { baseline?: string; only?: string } = {}
): Report {
  const a = group(baseline);
  const b = group(head);
  const deep = a.transitions.size > 0 && b.transitions.size > 0;
  const keys = [...new Set([...a.matches.keys(), ...b.matches.keys()])].filter((k) => !opts.only || k === opts.only);
  const failures: string[] = [];
  const diffs: Diff[] = [];
  let rounds = 0;
  for (const key of keys) {
    const rs = b.matches.get(key)?.rounds;
    rounds += Array.isArray(rs) ? rs.length : 0;
    const where = firstDifference(
      a.matches.get(key),
      b.matches.get(key),
      a.transitions.get(key) ?? [],
      b.transitions.get(key) ?? [],
      deep
    );
    if (where) diffs.push({ key, where });
  }
  if (keys.length === 0) failures.push("compared zero matches");
  else if (rounds === 0) failures.push("compared zero rounds");
  if (accepted) {
    if (opts.baseline && opts.baseline !== accepted.baseline) {
      failures.push(`accepted.json describes baseline ${accepted.baseline}, not ${opts.baseline}`);
    }
    const listed = new Set(accepted.entries.map(keyOf));
    const differing = new Set(diffs.map((d) => d.key));
    for (const d of diffs) if (!listed.has(d.key)) failures.push(`unlisted diff ${d.key} at ${d.where}`);
    for (const k of listed) if (!differing.has(k)) failures.push(`stale entry ${k}: it no longer differs`);
  }
  return { level: deep ? "transition" : "round", matches: keys.length, rounds, diffs, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const [basePath, headPath] = args;
  if (!basePath || !headPath || basePath.startsWith("--") || headPath.startsWith("--")) {
    console.error("usage: compare.ts <baseline.jsonl> <head.jsonl> [--accepted f] [--baseline sha] [--match table:seed]");
    process.exit(2);
  }
  const acceptedPath = flag("--accepted");
  const only = flag("--match");
  const report = compareTraces(
    parseTrace(readFileSync(basePath, "utf8")),
    parseTrace(readFileSync(headPath, "utf8")),
    acceptedPath ? (JSON.parse(readFileSync(acceptedPath, "utf8")) as Accepted) : undefined,
    { baseline: flag("--baseline"), only }
  );
  console.log(`compared ${report.matches} matches, ${report.rounds} rounds, at ${report.level} level`);
  for (const d of report.diffs) console.log(`differs ${d.key}: first at ${d.where}`);
  for (const f of report.failures) console.error(`FAIL ${f}`);
  const bad = report.failures.length > 0 || (!acceptedPath && report.diffs.length > 0);
  process.exit(bad ? 1 : 0);
}
