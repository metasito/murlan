// node tests/differential/compare.ts <baseline.jsonl> <head.jsonl> [--accepted f.json] [--baseline <sha>] [--head-level transition] [--match <table>:<seed>]
// Diffs two `trace.ts` outputs at the deepest level both offer. With --accepted, every differing
// match must be listed with where it first differs, and every listed one must still differ there.
// With --match, only that match is compared and the exit code is `git bisect run`'s: 0 same,
// 1 differs, 125 when the head trace lacks the match.
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { TABLES } from "./trace.ts";

interface Line {
  level: "match" | "transition";
  table: string;
  seed: number;
  [k: string]: unknown;
}

type Level = "round" | "transition";

export interface Accepted {
  baseline: string;
  level: Level;
  entries: { table: string; seed: number; round: number | null; where: string; cause: string }[];
}

export interface Diff {
  key: string;
  round: number | null;
  where: string;
}

export interface Report {
  level: Level;
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

function firstDifference(a: Line | undefined, b: Line | undefined, ta: Line[], tb: Line[], deep: boolean): Omit<Diff, "key"> | null {
  if (!a || !b) return { round: null, where: a ? "missing from head" : "missing from baseline" };
  if (deep) {
    for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
      if (!isDeepStrictEqual(ta[i], tb[i])) {
        const t = (ta[i] ?? tb[i]) as Line;
        return { round: t.round as number, where: `round ${t.round}, transition ${t.seq} (${String(ta[i]?.kind)} vs ${String(tb[i]?.kind)})` };
      }
    }
  }
  if ("error" in a || "error" in b) {
    return isDeepStrictEqual(a.error, b.error) ? null : { round: null, where: `error: ${String(a.error)} vs ${String(b.error)}` };
  }
  const ra = a.rounds as unknown[];
  const rb = b.rounds as unknown[];
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    if (!isDeepStrictEqual(ra[i], rb[i])) return { round: i, where: `round ${i}` };
  }
  if (!isDeepStrictEqual(a.winners, b.winners) || a.isDraw !== b.isDraw) return { round: null, where: "match result" };
  return null;
}

export function compareTraces(
  baseline: Line[],
  head: Line[],
  accepted?: Accepted,
  opts: { baseline?: string; only?: string; headLevel?: Level } = {}
): Report {
  const a = group(baseline);
  const b = group(head);
  const deep = a.transitions.size > 0 && b.transitions.size > 0;
  const level: Level = deep ? "transition" : "round";
  const tables = opts.only ? [opts.only.split(":")[0]] : Object.keys(TABLES);
  const keys = [...new Set([...a.matches.keys(), ...b.matches.keys()])].filter(
    (k) => (opts.only ? k === opts.only : tables.includes(k.split(":")[0]))
  );
  const failures: string[] = [];
  const diffs: Diff[] = [];
  let rounds = 0;
  for (const table of tables) {
    const own = keys.filter((k) => k.split(":")[0] === table);
    const tableRounds = own.reduce((n, k) => {
      const rs = b.matches.get(k)?.rounds;
      return n + (Array.isArray(rs) ? rs.length : 0);
    }, 0);
    rounds += tableRounds;
    if (own.filter((k) => a.matches.has(k) && b.matches.has(k)).length === 0) failures.push(`table ${table}: compared zero matches`);
    else if (tableRounds === 0) failures.push(`table ${table}: compared zero rounds`);
    else if (opts.headLevel === "transition" && !own.some((k) => (b.transitions.get(k) ?? []).length > 0)) {
      failures.push(`table ${table}: head wrote no transitions`);
    }
  }
  for (const key of keys) {
    for (const [side, m] of [["baseline", a.matches.get(key)], ["head", b.matches.get(key)]] as const) {
      if (m && "error" in m) failures.push(`match ${key} errored on ${side}: ${String(m.error)}`);
    }
    const diff = firstDifference(a.matches.get(key), b.matches.get(key), a.transitions.get(key) ?? [], b.transitions.get(key) ?? [], deep);
    if (diff) diffs.push({ key, ...diff });
  }
  if (accepted) {
    if (opts.baseline && opts.baseline !== accepted.baseline) {
      failures.push(`accepted.json describes baseline ${accepted.baseline}, not ${opts.baseline}`);
    }
    if (level !== accepted.level) failures.push(`compared at ${level} level, accepted.json requires ${accepted.level}`);
    const listed = new Map(accepted.entries.map((e) => [keyOf(e), e]));
    const live = new Map(diffs.map((d) => [d.key, d]));
    for (const d of diffs) if (!listed.has(d.key)) failures.push(`unlisted diff ${d.key} at ${d.where}`);
    for (const [k, e] of listed) {
      const d = live.get(k);
      if (!d) failures.push(`stale entry ${k}: it no longer differs`);
      else if (d.where !== e.where || d.round !== e.round) failures.push(`moved entry ${k}: first differs at ${d.where}, accepted at ${e.where}`);
    }
  }
  return { level, matches: keys.length, rounds, diffs, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const [basePath, headPath] = args;
  const headLevel = flag("--head-level");
  if (!basePath || !headPath || basePath.startsWith("--") || headPath.startsWith("--") || (headLevel && headLevel !== "transition")) {
    console.error("usage: compare.ts <baseline.jsonl> <head.jsonl> [--accepted f] [--baseline sha] [--head-level transition] [--match table:seed]");
    process.exit(2);
  }
  const acceptedPath = flag("--accepted");
  const only = flag("--match");
  const head = parseTrace(readFileSync(headPath, "utf8"));
  if (only && !head.some((l) => l.level === "match" && keyOf(l) === only)) {
    console.error(`${only} is not in ${headPath}: skip this commit`);
    process.exit(125);
  }
  const report = compareTraces(
    parseTrace(readFileSync(basePath, "utf8")),
    head,
    acceptedPath ? (JSON.parse(readFileSync(acceptedPath, "utf8")) as Accepted) : undefined,
    { baseline: flag("--baseline"), only, headLevel: headLevel as Level | undefined }
  );
  console.log(`compared ${report.matches} matches, ${report.rounds} rounds, at ${report.level} level`);
  for (const d of report.diffs) console.log(`differs ${d.key}: first at ${d.where}`);
  for (const f of report.failures) console.error(`FAIL ${f}`);
  const bad = report.failures.length > 0 || (!acceptedPath && report.diffs.length > 0);
  process.exit(bad ? 1 : 0);
}
