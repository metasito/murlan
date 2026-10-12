/**
 * What the loop spends, from the ledger: one row per process, its figures the `result` event's.
 * Every cost claim about the loop is checked here or is an assertion.
 *
 * Usage: node tools/loop/loop-cost.mjs [<n> | <n>+ ...] [--since <time>] [--until <time>] [--by-sha]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readEvent, scopeEnds } from "./loop-stream.mjs";
import { DIR, ARTEFACTS, atOf, closesWindow, holdRound as held, isProcess, killedStarts, readLedger, tallyOf, withSpawnPhase } from "./loop-logs.mjs";
import { shortOfTurns } from "./loop-render.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const REVIEW = /\b(spec|standards) review\b/i;
const SINGLE_REVIEW = /\breview #\d+ round \d+\b/i;
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
 * $/MTok by family: base input, 5-minute cache write, cache read, output, 1-hour cache write.
 *
 * Keyed on the family word rather than on a full id, because the logs carry four spellings of two
 * models — `claude-opus-5`, `opus`, `claude-opus-5[1m]`, `sonnet` — and an exact-match table priced
 * 64 sonnet turns at opus's rate. `report` scales absolutes onto Anthropic's reported total, so a
 * misprice lands entirely in the share column, which is the one number this file exists to give.
 *
 * A stream line's `output_tokens` is the count at the message's start, so output — about a fifth of
 * a session — is invisible per message and reaches the table only through that scaling.
 */
export const PRICE = {
  opus: [5, 6.25, 0.5, 25, 10],
  sonnet: [2, 2.5, 0.2, 10, 4],
  haiku: [1, 1.25, 0.1, 5, 2],
};

export const familyOf = (model) => Object.keys(PRICE).find((f) => String(model).includes(f)) ?? null;

/** The 5.5 releases repriced inside their family, so a release id wins over the family word. */
const PRICE_BY_RELEASE = {
  "opus-5-5": [4, 5, 0.2, 20, 8],
  "sonnet-5-5": [2, 2.5, 0.1, 10, 4],
  "haiku-5-5": [0.1, 0.125, 0.01, 0.5, 0.2],
};
const rateOf = (model) =>
  PRICE_BY_RELEASE[Object.keys(PRICE_BY_RELEASE).find((r) => String(model).includes(r)) ?? ""] ?? PRICE[familyOf(model) ?? "opus"];
const HAIKU_LONG_PROMPT = 100_000;

export const priceOf = (model, u) => {
  const prompt = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const scale = String(model).includes("haiku-5-5") && prompt > HAIKU_LONG_PROMPT ? 5 : 1;
  const [i, w5, r, o, w1h] = rateOf(model).map((p) => p * scale);
  const hour = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const writes = (u.cache_creation_input_tokens ?? 0) - hour;
  return ((u.input_tokens ?? 0) * i + writes * w5 + hour * w1h + (u.cache_read_input_tokens ?? 0) * r + (u.output_tokens ?? 0) * o) / 1e6;
};

const bucket = () => ({ turns: 0, tokens: 0, usd: 0, minutes: 0, toolTurns: 0, batched: 0 });

/** Sessions whose first stamped line is outside [since, until), which a window leaves out whole. */
function inWindow(lines, since, until) {
  const parsed = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } });
  const firstAt = new Map();
  for (const j of parsed) {
    if (j?.session_id && j.timestamp && !firstAt.has(j.session_id)) firstAt.set(j.session_id, new Date(j.timestamp).toISOString());
  }
  return lines.filter((_, i) => {
    const at = firstAt.get(parsed[i]?.session_id);
    return !(since && at < since) && !(until && at >= until);
  });
}

/** @param {string[]} allLines @param {string} [ticket] @param {string|null} [since] @param {string|null} [until] ISO times */
export function readTicket(allLines, ticket = "", since = null, until = null) {
  const lines = since || until ? inWindow(allLines, since, until) : allLines;
  /** @type {Record<string, ReturnType<typeof bucket>>} */
  const phases = {};
  const sessions = new Map();
  let phase = "pre";
  let at = null;
  let first = null;
  let last = null;
  let reviewers = 0;
  let singles = 0;
  const unpriced = new Set();
  const priced = new Set();
  const toolMsgs = new Map();

  /**
   * Charges the open phase for the time since the last stamped record, then moves to `to`. A record
   * with no timestamp must not move the clock: taking `at = null` from one would make the next
   * stamped turn uncountable and lose the interval either side of it.
   */
  const advance = (to, t) => {
    if (t !== null) {
      if (at !== null) (phases[phase] ??= bucket()).minutes += (t - at) / 6e4;
      at = t;
    }
    phase = to;
  };

  for (const line of lines) {
    if (!line) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }

    const t = j.timestamp ? Date.parse(j.timestamp) : null;
    if (t) { first ??= t; last = t; }

    if (j.type === "system" && j.subtype === "task_started" && j.task_type === "local_agent") {
      if (REVIEW.test(j.description ?? "")) reviewers++;
      if (SINGLE_REVIEW.test(j.description ?? "")) singles++;
      continue;
    }
    if (j.type === "result" && j.session_id) {
      sessions.set(j.session_id, Math.max(sessions.get(j.session_id) ?? 0, j.total_cost_usd ?? 0));
      continue;
    }
    // A new process starts before its marker, and the gap since the last one is no phase's time.
    if (j.type === "system" && j.subtype === "init") {
      phase = "pre";
      at = null;
      continue;
    }
    if (j.type !== "assistant" || !j.message?.usage) continue;

    // Main-session only: a subagent emits no marker, and its text quoting a phase would otherwise
    // reassign every turn after it.
    if (!j.parent_tool_use_id) {
      const blocks = j.message.content ?? [];
      const marked = readEvent(j)?.letter;
      if (marked) advance(marked, t);
      else if (phase === "B" || phase === "D" || phase === "E") {
        const calls = blocks
          .filter((b) => b.type === "tool_use")
          .map((b) => ({ name: b.name, command: b.input?.command, file: b.input?.file_path ?? b.input?.notebook_path }));
        if (scopeEnds(calls)) advance("C", t);
      }
    }

    // One line per content block, each repeating the message's usage: priced once, by id.
    const id = j.message.id;
    const uses = (j.message.content ?? []).filter((b) => b.type === "tool_use").length;
    if (!j.parent_tool_use_id && uses) {
      const msg = toolMsgs.get(id ?? toolMsgs.size) ?? { phase, calls: 0 };
      msg.calls += uses;
      toolMsgs.set(id ?? toolMsgs.size, msg);
    }
    if (id && priced.has(id)) continue;
    if (id) priced.add(id);

    const u = j.message.usage;
    const model = j.message.model ?? "";
    if (model === "<synthetic>") continue;
    if (!familyOf(model)) unpriced.add(model);
    const row = (phases[phase] ??= bucket());
    row.turns++;
    row.tokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    row.usd += priceOf(model, u);
    advance(phase, t);
  }
  for (const msg of toolMsgs.values()) {
    const row = (phases[msg.phase] ??= bucket());
    row.toolTurns++;
    if (msg.calls > 1) row.batched++;
  }

  return {
    ticket,
    usd: [...sessions.values()].reduce((a, b) => a + b, 0),
    minutes: first && last ? (last - first) / 6e4 : 0,
    rounds: Math.floor(reviewers / 2) + singles,
    marked: Object.keys(phases).some((k) => k !== "pre"),
    unpriced: [...unpriced],
    phases,
  };
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;

/**
 * A ledger row (one session) whose own model is not the family planned for its first phase, read
 * from the main session's turns alone — `models` counts subagents too, and judging by the costliest
 * of those flagged 62 rows: every opus build whose sonnet recon outspent it.
 */
export function mismatchedModel(row) {
  const want = MODEL_BY_PHASE[Object.keys(row.phases ?? {})[0]];
  const [top] = Object.entries(row.usage?.mainModels ?? {}).sort((a, b) => b[1] - a[1]);
  const family = top && familyOf(top[0]);
  return Boolean(want && family && family !== want);
}

/** A row from before `mainModels` was recorded, which this flag cannot speak about either way. */
const unjudgeable = (row) => !row.usage?.mainModels || Object.keys(row.usage.mainModels).length === 0;

/** A ticket's rows since its last `landed`/`closed`/`parked` close — an open window still counts. */
function windows(rows) {
  const byTicket = new Map();
  for (const r of rows) (byTicket.get(r.n) ?? byTicket.set(r.n, []).get(r.n)).push(r);
  return [...byTicket.values()].flatMap((forTicket) => {
    const out = [];
    let win = [];
    for (const r of forTicket) {
      win.push(r);
      if (r.outcome === "landed" || r.outcome === "closed" || r.outcome === "parked") {
        out.push(win);
        win = [];
      }
    }
    return win.length ? [...out, win] : out;
  });
}

/** A supervisor's own row — a settle, a CI-red retry, a park after it — which no session ran. */
const ranTurns = (row) => row.turns !== 0;

/** A process that starts at D and hands off is a HOLD round: the review and the fix it asked for. */
const holdRound = (row) => row.outcome === "handoff" && Object.keys(row.phases ?? {})[0] === "D";

/**
 * Each ticket's HOLD verdicts: schema 8's `review_holds_total`, across claims and fix rounds. A
 * ticket with no row carrying it is approximated as its `review_rounds` less its landings — a count a
 * re-claim resets, and one that takes a LAND still settling for a HOLD.
 */
function holdsByTicket(rows) {
  const by = new Map();
  for (const r of rows) {
    const t = by.get(r.n) ?? by.set(r.n, { holds: null, rounds: 0, landed: 0 }).get(r.n);
    if (typeof r.review_holds_total === "number") t.holds = Math.max(t.holds ?? 0, r.review_holds_total);
    t.rounds = Math.max(t.rounds, r.review_rounds ?? 0);
    if (r.outcome === "landed") t.landed += 1;
  }
  return Object.fromEntries([...by].map(([n, t]) => [n, t.holds ?? Math.max(0, t.rounds - t.landed)]));
}

/**
 * Fix-round spend, sessions per ticket, and any row that ran the wrong model — from `tickets.jsonl`
 * rather than the stream logs `readTicket` reads, because a fix round and a model are ledger facts.
 */
export function ledgerSummary(rows) {
  const groups = windows(rows);
  const total = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
  const fixCost = groups.reduce((a, win) => {
    const first = win.findIndex((r) => r.outcome === "retry");
    return a + win.reduce((x, r, i) => x + ((first >= 0 && i > first) || holdRound(r) ? (r.cost ?? 0) : 0), 0);
  }, 0);
  const holds = holdsByTicket(rows);
  const counts = Object.values(holds);
  return {
    fixCost,
    fixShare: total ? (fixCost / total) * 100 : 0,
    holds,
    holdsMean: counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0,
    processesMedian: median(groups.map((w) => w.filter(ranTurns).length).filter(Boolean)),
    mismatches: rows.filter(mismatchedModel),
    unjudged: rows.filter((r) => ranTurns(r) && unjudgeable(r)).length,
  };
}

/** The main session's own model: schema 9 records it, and before it the one most of its turns ran on. */
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
 * A ticket's HOLD verdicts. Schema 8 carries `review_holds_total` across claims and fix rounds; a
 * ticket with no row carrying it is approximated as its `review_rounds` less its landings, a count
 * a re-claim resets. From schema 9 each HOLD round is a process of its own.
 */
function holdsOf(rows) {
  let total = null;
  let rounds = 0;
  let landed = 0;
  let own = 0;
  for (const r of rows) {
    if (typeof r.review_holds_total === "number") total = Math.max(total ?? 0, r.review_holds_total);
    rounds = Math.max(rounds, r.review_rounds ?? 0);
    if (r.outcome === "landed") landed += 1;
    if (r.kind && held(r)) own += 1;
  }
  return (total ?? Math.max(0, rounds - landed)) + own;
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
    rounds: Math.max(0, ...mine.map((r) => r.review_rounds ?? 0)) + mine.filter((r) => r.kind === "process" && atOf(r) === "D").length,
    holds: holdsOf(mine),
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
    holdsPerTicket: tickets.length ? sum(tickets.map((t) => t.holds)) / tickets.length : 0,
    processesMedian: median(windows.map((t) => t.processes).filter(Boolean)),
    mismatched: processes.filter((r) => {
      const want = MODEL_BY_PHASE[atOf(r)];
      const family = familyOf(modelOf(r));
      return Boolean(want && family && family !== want);
    }),
    unjudged: processes.filter((r) => !modelOf(r)).length,
    headroom: turnHeadroom(processes, caps),
    maxTurnsHit: processes.filter((r) => (r.subtype ?? r.error?.reason) === "error_max_turns").length,
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
 * Each `<n>` is one ticket and each `<n>+` that ticket and every later one; none is all of them.
 *
 * A number is not a date: the loop takes the oldest ticket first, so `1095+` mixes in runs from
 * before whatever change is being measured. `--since` is what a before-and-after is asked with.
 */
/** @param {string[]} files @param {string | string[]} [args] */
export function wanted(files, args = []) {
  const picks = [args].flat().filter(Boolean);
  return files.filter((f) => {
    if (!ARTEFACTS.stream.name.test(f)) return false;
    const n = Number.parseInt(f, 10);
    return !picks.length || picks.some((p) => (p.endsWith("+") ? n >= Number.parseInt(p, 10) : `${p}.jsonl` === f));
  });
}

/** The latest stream-line timestamp in [from, until), or null: when a killed session last spoke. */
export function lastStamp(text, from, until) {
  let last = null;
  for (const line of text.split("\n")) {
    const t = Date.parse(/"timestamp":"([^"]+)"/.exec(line)?.[1] ?? "");
    if (t >= from && t < until && (last === null || t > last)) last = t;
  }
  return last;
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

/**
 * `--since <time>` / `--until <time>`: the tickets with a ledger row started in [since, until),
 * and those rows.
 * @param {{n: number, started?: string}[]} rows @param {string} since @param {string|null} [until]
 */
export function sinceWindow(rows, since, until = null) {
  const from = since ? Date.parse(since) : -Infinity;
  const to = until ? Date.parse(until) : Infinity;
  const inside = rows.filter((r) => {
    const t = Date.parse(r.started ?? "");
    return t >= from && t < to;
  });
  return { tickets: [...new Set(inside.map((r) => String(r.n)))], rows: inside };
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
  const since = stamp("--since");
  const until = stamp("--until");
  const args = argv.filter((a, i) => !["--since", "--until"].includes(a) && !["--since", "--until"].includes(argv[i - 1]));
  const withStarts = readLedger(undefined, { starts: true });
  const ledger = withStarts.filter((r) => r.outcome !== "started");
  const window = since || until ? sinceWindow(ledger, since ?? "", until) : null;
  const picks = window ? window.tickets : args;
  // The tickets whose stream log is still on disk. Retention keeps fourteen days of them, and that
  // is the population every earlier reading of this gauge was taken over.
  const files = window && !picks.length ? [] : wanted(existsSync(DIR) ? readdirSync(DIR) : [], picks);
  const asked = new Set(files.map((f) => Number.parseInt(f, 10)));
  const rows = (window ? sinceWindow(withStarts, since ?? "", until).rows : withStarts).filter((r) => asked.has(r.n));
  // The stream log only times a killed session: the ledger has no row for it to read.
  const lastSeen = (row, until) => lastStamp(existsSync(join(DIR, `${row.n}.jsonl`)) ? readFileSync(join(DIR, `${row.n}.jsonl`), "utf8") : "", Date.parse(row.started), until);
  const killed = killedStarts(withStarts, lastSeen).filter((k) =>
    window ? k.started >= (since ?? "") && (!until || k.started < until) : asked.has(k.n));
  console.log(report(rows));
  const died = killedLine(killed);
  if (died) console.log(died);
  if (grouped) console.log(`\n${shaTable(rows.filter((r) => r.outcome !== "started"), killed)}`);
}
