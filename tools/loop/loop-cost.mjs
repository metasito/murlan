/**
 * What the loop spends, by phase, from `.loop-logs`. Every cost claim about the loop is checked
 * here or is an assertion.
 *
 * `total_cost_usd` on a `result` record is cumulative for its `session_id`: a ticket's spend is the
 * max per session, summed across sessions. Summing the records double-counts, by a lot.
 *
 * Usage: node tools/loop/loop-cost.mjs [<n> | <n>+ ...] [--since <time>] [--until <time>] [--by-sha]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PHASE, scopeEnds } from "./loop-stream.mjs";
import { DIR, ARTEFACTS, killedStarts, readLedger } from "./loop-logs.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const REVIEW = /\b(spec|standards) review\b/i;
const ORDER = ["pre", "A", "B", "C", "D", "E", "F", "G"];

/**
 * The model a process is spawned on, keyed by the phase it starts at — not every phase it runs:
 * after a LAND, E and F continue inside D's process on D's model. Defined here, not in `queue-loop.mjs`: that file
 * statically imports `.ts` sources, which crashes a light CLI importing it on Windows. `queue-loop`
 * imports this instead.
 */
export const MODEL_BY_PHASE = { A: "opus", B: "opus", C: "opus", D: "opus", E: "sonnet", F: "sonnet" };
export const EFFORT_BY_PHASE = { A: "high", B: "high", C: "high", D: "high", E: "medium", F: "medium" };

/**
 * The real bound is turns. A dollar cap is checked only after a turn settles, so where it stops
 * moves with the model and the context — measured 8x to 42x over a small cap — and with subagents
 * in flight it stops the *subagents* and lets the session carry on. The dollar figure stays as a
 * backstop against one pathological turn, well above what a healthy ticket reaches.
 *
 * Each cap stays above twice the busiest healthy process of its size; `loop-cost` prints any size
 * where it does not.
 */
export const TURNS_BY_SIZE = {
  "size:XS": 60,
  "size:S": 160,
  "size:M": 270,
  "size:L": 320,
  "size:XL": 400,
};
export const TURNS_DEFAULT = 150;

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

export const priceOf = (model, u) => {
  const [i, w5, r, o, w1h] = PRICE[familyOf(model) ?? "opus"];
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
      const marked = blocks.map((b) => (b.type === "text" ? PHASE.exec(b.text ?? "") : null)).find(Boolean);
      if (marked) advance(marked[1], t);
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
    rounds: Math.floor(reviewers / 2),
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
    processesMedian: median(groups.map((w) => w.filter((r) => r.outcome !== "pushed").length)),
    mismatches: rows.filter(mismatchedModel),
    unjudged: rows.filter(unjudgeable).length,
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
      const row = (all[k] ??= { turns: 0, tokens: 0, usd: 0, mins: [], toolTurns: 0, batched: 0 });
      row.turns += p.turns;
      row.toolTurns += p.toolTurns ?? 0;
      row.batched += p.batched ?? 0;
      row.tokens += p.tokens;
      row.usd += p.usd * scale;
      row.mins.push(p.minutes);
    }
  }

  const rows = ORDER.filter((k) => all[k]).map((k) => {
    const r = all[k];
    return `${k.padEnd(5)} ${String(r.turns).padStart(6)} ${(r.tokens / 1e6).toFixed(1).padStart(7)}M` +
      ` $${(r.usd / done.length).toFixed(2).padStart(6)} ${((r.usd / reported) * 100).toFixed(0).padStart(4)}%` +
      ` ${median(r.mins).toFixed(1).padStart(8)}` +
      ` ${(r.toolTurns ? `${Math.round((r.batched / r.toolTurns) * 100)}%` : "-").padStart(6)}`;
  });

  // Named, never swallowed: an id with no family is priced at opus's rate, and a reader comparing
  // two runs has to know the share column was guessed at rather than read.
  const guessed = [...new Set(done.flatMap((t) => t.unpriced ?? []))];
  const ledger = ledgerRows.length ? ledgerSummary(ledgerRows) : null;

  return [
    `loop-cost: ${done.length} tickets, $${reported.toFixed(2)} reported${note}`,
    ...(guessed.length ? [`priced at opus's rate, family unrecognised: ${guessed.join(", ")}`] : []),
    "phase  turns  tokens  $/tkt  share  med min  batch",
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
          ...(ledger.unjudged ? [`model unjudged: ${ledger.unjudged} rows predate the reading`] : []),
          ...turnHeadroom(ledgerRows)
            .filter((h) => h.short)
            .map((h) => `turn cap under 2× the busiest process: ${h.size} busiest ${h.most}, cap ${h.cap}`),
        ]
      : []),
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
    g.sessions += 1;
    g.cost += r.cost ?? 0;
    if (r.outcome === "landed") g.landed += 1;
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

/** `--since <time>` / `--until <time>`: the tickets with a ledger row started in [since, until), and those rows. */
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
  const files = window && !picks.length ? [] : wanted(existsSync(DIR) ? readdirSync(DIR) : [], picks);
  // Unfiltered, fix-round share was the whole directory's however narrow the window asked for.
  const asked = new Set(files.map((f) => Number.parseInt(f, 10)));
  const rows = (window ? window.rows : ledger).filter((r) => asked.has(r.n));
  const lastSeen = (row, until) => lastStamp(existsSync(join(DIR, `${row.n}.jsonl`)) ? readFileSync(join(DIR, `${row.n}.jsonl`), "utf8") : "", Date.parse(row.started), until);
  // A ticket whose one session in the window was killed has no row there, so `asked` never has it.
  const killed = killedStarts(withStarts, lastSeen).filter((k) =>
    window ? k.started >= (since ?? "") && (!until || k.started < until) : asked.has(k.n));
  console.log(report(
    files.map((f) => readTicket(readFileSync(join(DIR, f), "utf8").split("\n"), f.replace(".jsonl", ""), since, until)),
    rows,
  ));
  const died = killedLine(killed);
  if (died) console.log(died);
  if (grouped) console.log(`\n${shaTable(rows, killed)}`);
}
