/**
 * Everything the loop writes into `.loop-logs/`: what each artefact is called, which of them the
 * pruner may delete, and the ledger of what a run did.
 *
 * Five jobs write into that directory — the stream sink, the park note, the CI tail, the ledger
 * row and the morning report — and the pruner deletes by filename pattern, which made it a sixth
 * copy of the other five's conventions with nothing holding them together. Naming them here means
 * a new artefact is one entry rather than a new convention plus an edit to the pruner someone will
 * forget.
 *
 * `name` is a second spelling of `path`, deliberately: deriving a regex by feeding a pattern
 * fragment through a path builder is the kind of clever nobody wants to read at 3am.
 * `tools/loop/tests/loopLogs.test.ts` holds the pair together instead — every builder's output must match its
 * own `name` and no other artefact's.
 */
import fsNode from "node:fs";
import path from "node:path";

export const DIR = ".loop-logs";

/**
 * `ephemeral` is "a week from now this is only taking up disk". The ledger and the run reports are
 * the record itself, so they are never swept.
 */
export const ARTEFACTS = {
  stream: { path: (t, dir = DIR) => path.join(dir, `${t}.jsonl`), name: /^\d+\.jsonl$/, ephemeral: true },
  ciTail: { path: (t, dir = DIR) => path.join(dir, `ci-${t}.log`), name: /^ci-\d+\.log$/, ephemeral: true },
  ciRedNote: { path: (t, dir = DIR) => path.join(dir, `ci-red-${t}.md`), name: /^ci-red-\d+\.md$/, ephemeral: true },
  parkNote: { path: (t, dir = DIR) => path.join(dir, `park-${t}.md`), name: /^park-\d+\.md$/, ephemeral: true },
  leftover: { path: (t, dir = DIR) => path.join(dir, `leftover-${t}.patch`), name: /^leftover-\d+\.patch$/, ephemeral: false },
  report: { path: (runId, dir = DIR) => path.join(dir, `run-${runId}.md`), name: /^run-.+\.md$/, ephemeral: false },
  // `_` so every builder takes the same two arguments: the table is only useful if one loop can
  // call all of them.
  ledger: { path: (_, dir = DIR) => path.join(dir, "tickets.jsonl"), name: /^tickets\.jsonl$/, ephemeral: false },
};

export const streamLog = ARTEFACTS.stream.path;
export const ciLogPath = ARTEFACTS.ciTail.path;
export const ciRedNotePath = ARTEFACTS.ciRedNote.path;
export const parkNotePath = ARTEFACTS.parkNote.path;
export const reportPath = ARTEFACTS.report.path;
export const leftoverPath = ARTEFACTS.leftover.path;
export const ledgerPath = ARTEFACTS.ledger.path;

/** A file in `.loop-logs/` the pruner may delete once it is old enough. */
export function prunable(name) {
  return Object.values(ARTEFACTS).some((a) => a.ephemeral && a.name.test(name));
}

const WEEK_MS = 7 * 24 * 60 * 60_000;

/** @param {number} [now] @param {typeof fsNode} [fs] */
export function prune(now = Date.now(), fs = fsNode, olderThan = WEEK_MS) {
  if (!fs.existsSync(DIR)) return [];
  const swept = [];
  for (const name of fs.readdirSync(DIR)) {
    if (!prunable(name)) continue;
    const file = path.join(DIR, name);
    if (now - fs.statSync(file).mtimeMs <= olderThan) continue;
    fs.rmSync(file, { force: true });
    swept.push(name);
  }
  return swept;
}

/**
 * How a session's tokens split between the session itself and the subagents it spawned.
 *
 * Read back off the finished stream log rather than accumulated as it arrives: the log is complete
 * and on disk by the time anyone asks, so this costs one pass over a file nobody is writing any
 * more, and the hot path stays a line in and a fact out.
 *
 * Two things the raw events do that have to be undone, both measured: per-event `usage` is
 * **duplicated** across the events of one request, so it is deduped on `request_id`; and the
 * subagent's own events are the ones carrying a non-null `parent_tool_use_id`, which is the only
 * thing that tells the two apart.
 *
 * Tokens, not dollars. A price table in here would be a second copy of Anthropic's, silently wrong
 * from the first time it moved.
 *
 * @param {string} text the stream log's contents
 */
export function usageSplit(text) {
  const empty = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
  const split = { main: empty(), subagents: empty(), models: {} };
  const seen = new Set();

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== "assistant") continue;
    const id = e.request_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const u = e.message?.usage;
    if (!u) continue;
    const into = e.parent_tool_use_id ? split.subagents : split.main;
    into.input += u.input_tokens ?? 0;
    into.output += u.output_tokens ?? 0;
    into.cacheRead += u.cache_read_input_tokens ?? 0;
    into.cacheCreate += u.cache_creation_input_tokens ?? 0;

    const model = e.message?.model;
    if (model) split.models[model] = (split.models[model] ?? 0) + 1;
  }
  return split;
}

/**
 * `schema` is what lets a measurement span a change of meaning: a field that starts holding
 * something else gets a new number, and rows with no `schema` predate the first one.
 *
 * 3 is **one row per session, not one per ticket**. A ticket that ran twice — a red CI round, a
 * resumed run — writes two rows, and its cost is the sum of them. Under 2 the second session
 * overwrote the reading of the first and the money it spent left no trace, which is the shape the
 * stream logs always had and the ledger never did; grouping on `n` is now the reader's job, and
 * `tests/` can check the file against those logs because both count the same thing.
 *
 * 4 adds `solo_bash_turns`, which is null on every row written before it. 5 adds `head` and
 * `run_id`, both null on rows written before it.
 */
export const SCHEMA = 5;

/**
 * One session, as one line of the ledger.
 *
 * `park_reason` is the sentence, not the outcome. A park written by a turn cap, one written by a
 * review deadlock and one written by a genuine blocker were four identical characters in the file,
 * so "why do tickets park" could not be asked of the record kept to answer it.
 *
 * `usage` splits deduped token counts between this session and the subagents it spawned, rather
 * than carrying a dollar figure for them. A price table in here would be a second copy of
 * Anthropic's, silently wrong from the first time it moved; tokens are a measurement, and the
 * reader multiplies.
 *
 * @param {{number: number, size: string|null, outcome: string, parkReason?: string|null,
 *   pr: number|null, phases: Record<string, number>, result: object|null, merged: boolean,
 *   reviewRounds: number|null, startedAt: string, ms: number, version: string|null,
 *   usage?: object|null, committed?: boolean|null, soloBash?: number|null,
 *   head?: string|null, runId?: string|null}} session
 */
export function sessionRow({
  number,
  size,
  outcome,
  parkReason = null,
  pr,
  phases,
  result,
  merged,
  reviewRounds,
  startedAt,
  ms,
  version,
  usage = null,
  committed = null,
  soloBash = null,
  head = null,
  runId = null,
}) {
  const models = Object.fromEntries(
    Object.entries(result?.models ?? {}).map(([name, u]) => [name, u.costUSD ?? 0]),
  );
  return {
    schema: SCHEMA,
    n: number,
    size: size ?? null,
    outcome,
    park_reason: parkReason ?? null,
    pr: pr ?? null,
    phases,
    cost: result?.cost ?? 0,
    turns: result?.turns ?? 0,
    ms,
    models,
    subagents: result?.subagents ?? null,
    usage,
    cache: result?.cache ?? { created: 0, read: 0 },
    merged: Boolean(merged),
    // Whether phase C ever ran `git commit`. The one ticket in nineteen that produced nothing made
    // 74 edits and no commits, and the record it left said only "parked".
    committed,
    /** Turns that spent a whole context read on one shell command. See queue-loop's `watchCalls`. */
    solo_bash_turns: soloBash ?? null,
    review_rounds: reviewRounds ?? null,
    claude_version: version ?? null,
    started: startedAt,
    head,
    run_id: runId,
  };
}

/**
 * The run's record, and its running totals, with one owner.
 *
 * Totals used to be added up in three places — the row writer, the refusal branch and the
 * retry-park branch — and a `counted` flag existed to patch the double count the third one caused.
 * Here every session that ends calls `record` exactly once, the totals are whatever the rows say,
 * and a session that spent money without finishing a ticket (a usage refusal) is a row like any
 * other rather than an adjustment nothing can audit.
 *
 * @param {{append?: Function, mkdir?: Function, exists?: Function, write?: Function}} [io]
 */
export function ledger(io = {}) {
  const {
    append = (file, text) => fsNode.appendFileSync(file, text, "utf8"),
    mkdir = () => fsNode.mkdirSync(DIR, { recursive: true }),
    exists = (file) => fsNode.existsSync(file),
    write = (file, text) => fsNode.writeFileSync(file, text, "utf8"),
  } = io;

  const totals = { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 };
  /** @type {object[]} */
  const rows = [];

  return {
    totals,
    rows,
    /**
     * @param {object} session what `sessionRow` needs
     * @param {{runId: string, line: string, counts?: boolean}} into the morning report's row, and
     *   whether this session closes a ticket — a retry round is a session, not a ticket.
     */
    record(session, { runId, line, counts = true }) {
      const entry = sessionRow({ ...session, runId });
      mkdir();
      append(ledgerPath(), `${JSON.stringify(entry)}\n`);

      const file = reportPath(runId);
      if (!exists(file)) write(file, `# queue-loop ${runId.replace(/-(\d\d)-(\d\d)$/, " $1:$2")}\n\n`);
      append(file, `${line}\n`);

      totals.cost += entry.cost;
      totals.ms += entry.ms;
      if (counts) {
        totals.tickets += 1;
        if (entry.outcome === "landed") totals.landed += 1;
        else totals.parked += 1;
      }
      rows.push(entry);
      return entry;
    },
    /** The closing total, appended under the night's rows. */
    close(runId, line) {
      mkdir();
      append(reportPath(runId), `\n${line}\n`);
    },
  };
}

/** @param {string} [file] */
export function readLedger(file = ledgerPath()) {
  if (!fsNode.existsSync(file)) return [];
  const rows = [];
  for (const line of fsNode.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return rows;
}

const HANDOFF_RE = /phase\s+([A-Za-z])\s+next/;

/**
 * A ticket's rounds, spend and handoffs, rebuilt from the rows a restart cannot otherwise see:
 * everything for `n` since its last `landed` or `parked` row, which is where the tally must have
 * read zero even before this session existed.
 *
 * @param {number} n @param {object[]} rows
 */
export function ticketTally(n, rows) {
  const forTicket = rows.filter((r) => r.n === n);
  let start = 0;
  forTicket.forEach((r, i) => {
    if (r.outcome === "landed" || r.outcome === "parked") start = i + 1;
  });
  const since = forTicket.slice(start);

  let spend = 0;
  let handoffsThisRound = 0;
  let lastHandoff = null;
  let retries = 0;
  let lastRedHead = null;
  for (const r of since) {
    spend += r.cost ?? 0;
    if (r.outcome === "retry") {
      retries += 1;
      handoffsThisRound = 0;
      lastHandoff = null;
      lastRedHead = r.head ?? null;
    } else if (r.outcome === "handoff") {
      handoffsThisRound += 1;
      lastHandoff = HANDOFF_RE.exec(r.park_reason ?? "")?.[1] ?? lastHandoff;
    }
  }
  return { sessions: since.length, spend, handoffsThisRound, lastHandoff, lastRedHead, retries };
}
