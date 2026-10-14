/**
 * What the loop spends, from the ledger: one row per process, its figures the `result` event's.
 * Every cost claim about the loop is checked here or is an assertion.
 *
 * Usage: node tools/loop/loop-cost.mjs [<n> | <n>+ ...] [--since <time>] [--until <time>] [--by-sha]
 */
import { atOf, closesWindow, isProcess, killedStarts, readLedger, RETAIN_MS, tallyOf, withSpawnPhase } from "./loop-logs.mjs";
import { shortOfTurns } from "./loop-render.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const ORDER = ["pre", "A", "B", "C", "D", "E", "F", "G"];

/**
 * The model a process is spawned on, keyed by the phase it starts at — not every phase it runs:
 * after a LAND, E and F continue inside D's process on D's model. Defined here, not in `queue-loop.mjs`: that file
 * statically imports `.ts` sources, which crashes a light CLI importing it on Windows. `queue-loop`
 * imports this instead.
 */
export const MODEL_BY_PHASE = { A: "opus", B: "opus", C: "opus", D: "opus", E: "sonnet", F: "sonnet" };
/**
 * A fresh ticket is built at medium; a process that starts at C or D is a fix round or a review,
 * and runs at high. Anthropic's measured trade on Opus 5.5: medium first, failures re-run at high.
 */
export const EFFORT_BY_PHASE = { A: "medium", B: "medium", C: "high", D: "high", E: "medium", F: "medium" };

/**
 * Each size's `CLAUDE_CODE_AUTO_COMPACT_WINDOW`; a compaction fires about 33k below it. A handoff
 * costs the next process 5-14 min re-reading what this one knew; a larger ceiling costs every later
 * turn its extra context. Sized from each size's measured need.
 */
export const CONTEXT_BY_SIZE = { "size:M": 300_000, "size:L": 330_000, "size:XL": 330_000 };
export const CONTEXT_DEFAULT = 200_000;

/**
 * Each cap stays above twice the busiest healthy process of its size; `loop-cost` and the run recap
 * print any size where it does not. A raised context ceiling raises its cap with it, so that one is met first.
 */
export const TURNS_BY_SIZE = {
  "size:XS": 60,
  "size:S": 320,
  "size:M": 505,
  "size:L": 560,
  "size:XL": 600,
};
export const TURNS_DEFAULT = 150;

/** @param {{size?: string, turns?: number, outcome?: string}[]} rows @param {Record<string, number>} [caps] */
export function turnHeadroom(rows, caps = TURNS_BY_SIZE) {
  const busiest = {};
  for (const r of rows) {
    if (!r.size || !r.turns || r.outcome === "parked" || r.outcome === "diagnosed") continue;
    busiest[r.size] = Math.max(busiest[r.size] ?? 0, r.turns);
  }
  return Object.entries(busiest).map(([size, most]) => ({ size, most, cap: caps[size], short: 2 * most > (caps[size] ?? Infinity) }));
}

/**
 * The model family an id names. Keyed on the family word rather than on a full id, because the logs
 * carry four spellings of two models — `claude-opus-5`, `opus`, `claude-opus-5[1m]`, `sonnet`.
 */
export const familyOf = (model) => ["opus", "sonnet", "haiku"].find((f) => String(model).includes(f)) ?? null;

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;

/** The main session's own model; a v8 row names the one most of its turns ran on. */
const modelOf = (row) => row.model ?? Object.entries(row.usage?.mainModels ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

const sum = (a) => a.reduce((x, y) => x + y, 0);

const byTicket = (rows) => {
  const by = new Map();
  for (const r of rows) (by.get(r.n) ?? by.set(r.n, []).get(r.n)).push(r);
  return [...by.values()];
};

/** Each ticket's claim windows, its closing row in each and an open last one included. */
function windowsOf(rows) {
  return byTicket(rows).flatMap((forTicket) => {
    const out = [[]];
    for (const r of forTicket) {
      out.at(-1).push(r);
      if (closesWindow(r)) out.push([]);
    }
    return out.filter((w) => w.length);
  });
}

/**
 * The gauge over ledger rows of every schema, start rows included. A ticket is an issue number,
 * however many claims it took; fix spend is counted per claim window; a model is judged only on a
 * process.
 *
 * @param {{n: number, [field: string]: unknown}[]} input @param {Record<string, number>} [caps]
 */
export function summary(input, caps = TURNS_BY_SIZE) {
  const rows = withSpawnPhase(input);
  const processes = rows.filter(isProcess);
  const tickets = byTicket(rows).map((mine) => ({
    spend: sum(mine.map((r) => r.cost ?? 0)),
    minutes: sum(mine.map((r) => r.ms ?? 0)) / 6e4,
    rounds: Math.max(0, ...mine.map((r) => r.review_rounds ?? 0)),
  }));
  const spent = tickets.filter((t) => t.spend > 0);
  const windows = windowsOf(rows).map(tallyOf);
  const spend = sum(spent.map((t) => t.spend));
  const fixSpend = sum(windows.map((t) => t.fixSpend));
  const byAt = {};
  for (const r of processes) {
    const at = atOf(r);
    if (!at) continue;
    const b = (byAt[at] ??= { processes: 0, spend: 0, ms: [] });
    b.processes += 1;
    b.spend += r.cost ?? 0;
    b.ms.push(r.ms ?? 0);
  }
  return {
    tickets: spent.length,
    spend,
    perTicket: { mean: spent.length ? spend / spent.length : 0, median: median(spent.map((t) => t.spend)) },
    minutesMedian: median(spent.map((t) => t.minutes)),
    reviewRoundsMedian: median(spent.map((t) => t.rounds).filter(Boolean)),
    fixSpend,
    fixShare: spend ? (fixSpend / spend) * 100 : 0,
    holdsPerTicket: tickets.length ? sum(windows.map((t) => t.holds)) / tickets.length : 0,
    processesMedian: median(windows.map((t) => t.processes).filter(Boolean)),
    mismatched: processes.filter((r) => {
      const want = MODEL_BY_PHASE[atOf(r)];
      const family = familyOf(modelOf(r));
      return Boolean(want && family && family !== want);
    }),
    unjudged: processes.filter((r) => !modelOf(r)).length,
    headroom: turnHeadroom(processes, caps),
    maxTurnsHit: processes.filter((r) => r.error?.reason === "error_max_turns").length,
    byAt: Object.fromEntries(Object.entries(byAt).map(([at, b]) => [at, { processes: b.processes, spend: b.spend, minutes: median(b.ms) / 6e4 }])),
  };
}

/** @param {object[]} rows ledger rows, start rows excluded @param {Record<string, number>} [caps] */
export function report(rows, caps = TURNS_BY_SIZE) {
  const s = summary(rows, caps);
  if (!s.tickets) return "loop-cost: no processes in the ledger";
  const usd = (x) => `$${x.toFixed(2)}`;
  const table = ORDER.filter((at) => s.byAt[at]).map((at) => {
    const b = s.byAt[at];
    return `${at.padEnd(10)} ${String(b.processes).padStart(10)} ${b.spend.toFixed(2).padStart(8)} ${`${(s.spend ? (b.spend / s.spend) * 100 : 0).toFixed(0)}%`.padStart(7)} ${b.minutes.toFixed(1).padStart(8)}`;
  });
  return [
    `loop-cost: ${s.tickets} tickets, ${usd(s.spend)} spent`,
    `per ticket: ${usd(s.perTicket.mean)} mean, ${usd(s.perTicket.median)} median, ${s.minutesMedian.toFixed(0)} min median, ${s.reviewRoundsMedian} review rounds median`,
    `fix rounds: ${usd(s.fixSpend)} (${s.fixShare.toFixed(0)}%)`,
    `HOLD rounds: ${s.holdsPerTicket.toFixed(2)} per ticket`,
    `processes/ticket: median ${s.processesMedian}`,
    ...(s.mismatched.length ? [`model mismatch: ${s.mismatched.map((r) => `#${r.n}`).join(", ")}`] : []),
    ...(s.unjudged ? [`model unjudged: ${s.unjudged} processes name no model`] : []),
    ...(s.maxTurnsHit ? [`turn cap: ${s.maxTurnsHit} processes ran out of turns`] : []),
    ...s.headroom.filter((h) => h.short).map(shortOfTurns),
    "",
    "spawned at  processes        $   share  med min",
    ...table,
  ].join("\n");
}

/**
 * The rows a reading asks for: started in [since, until), of the tickets each `<n>` names and each
 * `<n>+` with every later one; no pick is every ticket.
 *
 * A number is not a date: the loop takes the oldest ticket first, so `1095+` mixes in runs from
 * before whatever change is being measured. `--since` is what a before-and-after is asked with.
 *
 * @param {{n: number, started?: string}[]} rows
 * @param {{picks?: string[], since?: string|null, until?: string|null}} [ask]
 */
export function select(rows, { picks = [], since = null, until = null } = {}) {
  const from = since ? Date.parse(since) : -Infinity;
  const to = until ? Date.parse(until) : Infinity;
  const picked = (n) => !picks.length || picks.some((p) => (p.endsWith("+") ? n >= Number.parseInt(p, 10) : n === Number(p)));
  return rows.filter((r) => {
    const t = Date.parse(r.started ?? "");
    return picked(r.n) && ((!since && !until) || (t >= from && t < to));
  });
}

/** Sessions whose supervisor died with them, from the `started` rows no session row answers. */
export function killedLine(killed) {
  if (!killed.length) return null;
  const each = killed.map((k) => `#${k.n} ${k.phase ?? "?"} ${Math.round(k.ms / 6e4)}m`).join(", ");
  return `killed: ${killed.length} sessions left no row — ${each}${killed.at(-1).trailing ? " (the last may still be running)" : ""}`;
}

/** `--by-sha`: each loop commit's sessions, spend and outcomes, so a redesign is judged on its own runs. */
export function shaTable(rows, killed = []) {
  const groups = new Map();
  const of = (sha) => {
    const key = sha ? sha.slice(0, 7) : "unknown";
    if (!groups.has(key)) groups.set(key, { sessions: 0, cost: 0, landed: 0, parked: 0, killed: 0 });
    return groups.get(key);
  };
  for (const r of rows) {
    const g = of(r.loop_sha);
    if (isProcess(r)) g.sessions += 1;
    g.cost += r.cost ?? 0;
    if (r.outcome === "landed" || r.outcome === "closed") g.landed += 1;
    if (r.outcome === "parked") g.parked += 1;
  }
  for (const k of killed) of(k.loop_sha).killed += 1;
  return [
    "loop     sessions       $  landed  parked  killed",
    ...[...groups].map(([sha, g]) =>
      `${sha.padEnd(8)} ${String(g.sessions).padStart(8)} ${g.cost.toFixed(2).padStart(7)} ${String(g.landed).padStart(7)} ${String(g.parked).padStart(7)} ${String(g.killed).padStart(7)}`,
    ),
  ].join("\n");
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const grouped = process.argv.includes("--by-sha");
  const argv = process.argv.slice(2).filter((a) => a !== "--by-sha");
  const stamp = (flag) => {
    const at = argv.indexOf(flag);
    if (at < 0) return null;
    const t = new Date(argv[at + 1] ?? "");
    if (Number.isNaN(t.getTime())) {
      console.error(`loop-cost: ${flag} needs a time, e.g. ${flag} 2026-09-24T16:33Z`);
      process.exit(2);
    }
    return t.toISOString();
  };
  const until = stamp("--until");
  const picks = argv.filter((a, i) => !["--since", "--until"].includes(a) && !["--since", "--until"].includes(argv[i - 1]));
  // Asked nothing, the stream logs' retention: the population every earlier reading was taken over.
  const since = stamp("--since") ?? (picks.length || until ? null : new Date(Date.now() - RETAIN_MS).toISOString());
  const all = readLedger(undefined, { starts: true });
  const rows = select(all, { picks, since, until });
  const killed = select(killedStarts(all), { picks, since, until });
  console.log(report(rows));
  const died = killedLine(killed);
  if (died) console.log(died);
  if (grouped) console.log(`\n${shaTable(rows.filter((r) => r.outcome !== "started"), killed)}`);
}
