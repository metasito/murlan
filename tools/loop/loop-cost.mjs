/**
 * What the loop spends, by phase, from `.loop-logs`. Every cost claim about the loop is checked
 * here or is an assertion.
 *
 * `total_cost_usd` on a `result` record is cumulative for its `session_id`: a ticket's spend is the
 * max per session, summed across sessions. Summing the records double-counts, by a lot.
 *
 * Usage: node tools/loop/loop-cost.mjs [ticket]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PHASE } from "./loop-stream.mjs";
import { DIR, ARTEFACTS, readLedger } from "./loop-logs.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const REVIEW = /\b(spec|standards) review\b/i;
const ORDER = ["pre", "A", "B", "C", "D", "E", "F", "G"];

/**
 * The model each phase is meant to run on (T11). Defined here, not in `queue-loop.mjs`: that file
 * statically imports `.ts` sources, which crashes a light CLI importing it on Windows. `queue-loop`
 * imports this instead.
 */
export const MODEL_BY_PHASE = { A: "opus", B: "opus", C: "opus", D: "opus", E: "sonnet", F: "sonnet" };

/**
 * $/MTok by family: base input, cache write, cache read, output.
 *
 * Keyed on the family word rather than on a full id, because the logs carry four spellings of two
 * models — `claude-opus-5`, `opus`, `claude-opus-5[1m]`, `sonnet` — and an exact-match table priced
 * 64 sonnet turns at opus's rate. `report` scales absolutes onto Anthropic's reported total, so a
 * misprice lands entirely in the share column, which is the one number this file exists to give.
 */
export const PRICE = {
  opus: [5, 6.25, 0.5, 25],
  sonnet: [2, 2.5, 0.2, 10],
  haiku: [1, 1.25, 0.1, 5],
};

export const familyOf = (model) => Object.keys(PRICE).find((f) => String(model).includes(f)) ?? null;

const priceOf = (model, u) => {
  const [i, w, r, o] = PRICE[familyOf(model) ?? "opus"];
  return (
    ((u.input_tokens ?? 0) * i + (u.cache_creation_input_tokens ?? 0) * w +
      (u.cache_read_input_tokens ?? 0) * r + (u.output_tokens ?? 0) * o) / 1e6
  );
};

const bucket = () => ({ turns: 0, tokens: 0, usd: 0, minutes: 0 });

export function readTicket(lines, ticket = "") {
  /** @type {Record<string, ReturnType<typeof bucket>>} */
  const phases = {};
  const sessions = new Map();
  let phase = "pre";
  let at = null;
  let first = null;
  let last = null;
  let reviewers = 0;
  const unpriced = new Set();

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
      continue;
    }
    if (j.type === "result" && j.session_id) {
      sessions.set(j.session_id, Math.max(sessions.get(j.session_id) ?? 0, j.total_cost_usd ?? 0));
      continue;
    }
    if (j.type !== "assistant" || !j.message?.usage) continue;

    // Main-session only: a subagent emits no marker, and its text quoting a phase would otherwise
    // reassign every turn after it.
    if (!j.parent_tool_use_id) {
      for (const b of j.message.content ?? []) {
        if (b.type !== "text") continue;
        const m = PHASE.exec(b.text ?? "");
        if (m) advance(m[1], t);
      }
    }

    const u = j.message.usage;
    const model = j.message.model ?? "";
    if (!familyOf(model)) unpriced.add(model);
    const row = (phases[phase] ??= bucket());
    row.turns++;
    row.tokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    row.usd += priceOf(model, u);
    advance(phase, t);
  }

  return {
    ticket,
    usd: [...sessions.values()].reduce((a, b) => a + b, 0),
    minutes: first && last ? (last - first) / 6e4 : 0,
    rounds: Math.floor(reviewers / 2),
    marked: Object.keys(phases).some((k) => k !== "pre"),
    unpriced: [...unpriced],
    phases,
  };
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;

/** A ledger row (one session) whose `models` ran a family MODEL_BY_PHASE did not plan for. */
export function mismatchedModel(row) {
  const ran = new Set(Object.keys(row.models ?? {}).map(familyOf).filter(Boolean));
  return Object.keys(row.phases ?? {}).some((l) => {
    const want = MODEL_BY_PHASE[l];
    return want && ran.size && !ran.has(want);
  });
}

/** A ticket's rows since its last `landed`/`parked` close — an open window still counts. */
function windows(rows) {
  const byTicket = new Map();
  for (const r of rows) (byTicket.get(r.n) ?? byTicket.set(r.n, []).get(r.n)).push(r);
  return [...byTicket.values()].flatMap((forTicket) => {
    const out = [];
    let win = [];
    for (const r of forTicket) {
      win.push(r);
      if (r.outcome === "landed" || r.outcome === "parked") {
        out.push(win);
        win = [];
      }
    }
    return win.length ? [...out, win] : out;
  });
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
    return first < 0 ? a : a + win.slice(first + 1).reduce((x, r) => x + (r.cost ?? 0), 0);
  }, 0);
  return {
    fixCost,
    fixShare: total ? (fixCost / total) * 100 : 0,
    processesMedian: median(groups.map((w) => w.length)),
    mismatches: rows.filter(mismatchedModel),
  };
}

/**
 * A ticket whose session emitted no phase marker charges its whole spend to `pre`, which is a
 * statement about the log rather than about the loop — eleven of thirty-one such logs put `pre` at
 * 27% of a table whose job is to say which phase to attack. They are dropped and counted, because
 * the gate this feeds compares a before against an after and only marked runs are in both.
 */
export function report(tickets, ledgerRows = []) {
  const priceable = tickets.filter((t) => t.usd > 0);
  const done = priceable.filter((t) => t.marked);
  const skipped = priceable.length - done.length;
  const note = skipped ? `, ${skipped} skipped for emitting no phase marker` : "";
  if (!done.length) return `loop-cost: no priced tickets in ${DIR}${note}`;

  // Per-phase dollars are priced from usage records; the ticket total is Anthropic's own. The
  // shares are trustworthy where the absolutes are not, so scale the shares onto the total.
  const reported = done.reduce((a, t) => a + t.usd, 0);
  const priced = done.reduce((a, t) => a + Object.values(t.phases).reduce((x, p) => x + p.usd, 0), 0);
  const scale = priced ? reported / priced : 1;

  const all = {};
  for (const t of done) {
    for (const [k, p] of Object.entries(t.phases)) {
      const row = (all[k] ??= { turns: 0, tokens: 0, usd: 0, mins: [] });
      row.turns += p.turns;
      row.tokens += p.tokens;
      row.usd += p.usd * scale;
      row.mins.push(p.minutes);
    }
  }

  const rows = ORDER.filter((k) => all[k]).map((k) => {
    const r = all[k];
    return `${k.padEnd(5)} ${String(r.turns).padStart(6)} ${(r.tokens / 1e6).toFixed(1).padStart(7)}M` +
      ` $${(r.usd / done.length).toFixed(2).padStart(6)} ${((r.usd / reported) * 100).toFixed(0).padStart(4)}%` +
      ` ${median(r.mins).toFixed(1).padStart(8)}`;
  });

  // Named, never swallowed: an id with no family is priced at opus's rate, and a reader comparing
  // two runs has to know the share column was guessed at rather than read.
  const guessed = [...new Set(done.flatMap((t) => t.unpriced ?? []))];
  const ledger = ledgerRows.length ? ledgerSummary(ledgerRows) : null;

  return [
    `loop-cost: ${done.length} tickets, $${reported.toFixed(2)} reported${note}`,
    ...(guessed.length ? [`priced at opus's rate, family unrecognised: ${guessed.join(", ")}`] : []),
    "phase  turns  tokens  $/tkt  share  med min",
    ...rows,
    `\nper ticket: $${(reported / done.length).toFixed(2)} mean, $${median(done.map((t) => t.usd)).toFixed(2)} median,` +
      ` ${median(done.map((t) => t.minutes)).toFixed(0)} min median,` +
      ` ${median(done.filter((t) => t.rounds).map((t) => t.rounds))} review rounds median`,
    ...(ledger
      ? [
          `fix rounds: $${ledger.fixCost.toFixed(2)} (${ledger.fixShare.toFixed(0)}%)`,
          `processes/ticket: median ${ledger.processesMedian}`,
          ...(ledger.mismatches.length
            ? [`model mismatch: ${ledger.mismatches.map((r) => `#${r.n}`).join(", ")}`]
            : []),
        ]
      : []),
  ].join("\n");
}

/**
 * `<n>` is one ticket; `<n>+` is that ticket and every later one.
 *
 * The second is what a before-and-after is asked with. Every ticket in the directory averaged
 * together dilutes the runs a change actually touched by the twenty that came before it, and a
 * median that cannot move is a gate that cannot fail.
 */
export function wanted(files, arg = "") {
  const from = /^\d+\+$/.test(arg) ? Number.parseInt(arg, 10) : null;
  const one = /^\d+$/.test(arg) ? `${arg}.jsonl` : null;
  return files.filter((f) => {
    if (!ARTEFACTS.stream.name.test(f)) return false;
    if (one) return f === one;
    if (from !== null) return Number.parseInt(f, 10) >= from;
    return true;
  });
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const files = wanted(existsSync(DIR) ? readdirSync(DIR) : [], process.argv[2]);
  console.log(report(
    files.map((f) => readTicket(readFileSync(join(DIR, f), "utf8").split("\n"), f.replace(".jsonl", ""))),
    readLedger(),
  ));
}
