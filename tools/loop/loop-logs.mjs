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
import { PLAIN, reportRow } from "./loop-render.mjs";

export const DIR = ".loop-logs";

/**
 * `ephemeral` is "two weeks from now this is only taking up disk". The ledger and the run reports
 * are the record itself, so they are never swept.
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

/**
 * An entry in `.loop-logs/` the pruner may delete once it is old enough: anything but the record,
 * because sessions write there under names no artefact declares.
 */
export function prunable(name) {
  return !Object.values(ARTEFACTS).some((a) => !a.ephemeral && a.name.test(name));
}

export const RETAIN_MS = 14 * 24 * 60 * 60_000;

/** A directory is as old as the newest thing in it. `lstat`, so a link is aged, never followed. */
const newest = (p, fs) => {
  const s = fs.lstatSync(p);
  if (!s.isDirectory()) return s.mtimeMs;
  return fs.readdirSync(p).reduce((m, n) => Math.max(m, newest(path.join(p, n), fs)), s.mtimeMs);
};

/** @param {number} [now] @param {typeof fsNode} [fs] */
export function prune(now = Date.now(), fs = fsNode, dir = DIR) {
  if (!fs.existsSync(dir)) return [];
  const swept = [];
  for (const name of fs.readdirSync(dir)) {
    const entry = path.join(dir, name);
    try {
      if (!prunable(name) || now - newest(entry, fs) <= RETAIN_MS) continue;
      fs.rmSync(entry, { recursive: true, force: true });
      swept.push(name);
    } catch {
      // ponytail: a file vanishing or locked mid-walk is skipped; the next iteration retries it.
    }
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
  const split = { main: empty(), subagents: empty(), models: {}, mainModels: {} };
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
    if (model) {
      split.models[model] = (split.models[model] ?? 0) + 1;
      if (!e.parent_tool_use_id) split.mainModels[model] = (split.mainModels[model] ?? 0) + 1;
    }
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
 * `run_id`, both null on rows written before it. 6 drops `solo_bash_turns`, adds `loop_sha`,
 * `handoff` and `error`, and brings the `started` row, which is a spawn and not a session. 7 adds
 * `park_failed` and the `reparked` row, which closes it, `asleep_ms`, the part of `ms` the
 * machine spent in standby, and `reruns`. 8 adds `review_holds_total`, every HOLD on the
 * issue across claims and fix rounds, beside `review_rounds`, the count the cap reads.
 *
 * 9 splits the row by `kind`: a `process` row per spawned session, its figures the `result`
 * event's, and an `outcome` row for what the supervisor decided without one. `sessionRow` and
 * `startRow` write 8 until the supervisor writes 9; a reader tells the two apart by `kind`.
 */
export const SCHEMA = 9;
const SESSION_SCHEMA = 8;

export const STDERR_CAP = 2000;

/** What a session died of, or null when it did not say. */
export function errorOf(run) {
  const stderr = String(run?.stderr ?? "").trim().slice(-STDERR_CAP) || null;
  if (!run?.result?.isError && !stderr) return null;
  return { status: run.result?.apiStatus ?? null, reason: run.result?.terminalReason ?? run.result?.subtype ?? null, stderr };
}

/** @param {{status: number|null, reason: string|null, stderr: string|null}} error */
export const errorLine = (error) =>
  [error.status && `API ${error.status}`, error.reason, error.stderr?.trim().split("\n").at(-1)].filter(Boolean).join(" · ");

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
 *   reviewRounds: number|null, totalHolds?: number|null, startedAt: string, ms: number, version: string|null,
 *   usage?: object|null, committed?: boolean|null, head?: string|null, runId?: string|null,
 *   loopSha?: string|null, handoff?: {phase: string, why: string|null, said: string|null}|null,
 *   error?: object|null, flake?: {runId: number, tests: string[]}|null}} session
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
  totalHolds = null,
  startedAt,
  ms,
  asleepMs = null,
  reruns = null,
  version,
  usage = null,
  committed = null,
  head = null,
  runId = null,
  loopSha = null,
  handoff = null,
  error = null,
  parkFailed = null,
  flake = null,
}) {
  const models = Object.fromEntries(
    Object.entries(result?.models ?? {}).map(([name, u]) => [name, u.costUSD ?? 0]),
  );
  return {
    schema: SESSION_SCHEMA,
    n: number,
    size: size ?? null,
    outcome,
    park_reason: parkReason ?? null,
    pr: pr ?? null,
    phases,
    cost: result?.cost ?? 0,
    turns: result?.turns ?? 0,
    ms,
    asleep_ms: asleepMs,
    reruns,
    models,
    subagents: result?.subagents ?? null,
    usage,
    cache: result?.cache ?? { created: 0, read: 0 },
    merged: Boolean(merged),
    // Whether phase C ever ran `git commit`. The one ticket in nineteen that produced nothing made
    // 74 edits and no commits, and the record it left said only "parked".
    committed,
    review_rounds: reviewRounds ?? null,
    review_holds_total: totalHolds,
    claude_version: version ?? null,
    started: startedAt,
    head,
    run_id: runId,
    loop_sha: loopSha,
    handoff,
    error,
    park_failed: parkFailed,
    // The run whose rerun went green, and the tests its first attempt failed: a landing a flake let through.
    flake,
  };
}

/** The park steps a later pass can apply again: the tracker's half, not the worktree's. */
const REPARKABLE = new Set(["label", "comment"]);

/**
 * Each ticket whose last row is a park the tracker did not receive, with the steps still owed. A
 * `reparked` row carries what its retry left failed, so an empty list there closes it.
 *
 * @param {object[]} rows
 * @returns {{n: number, steps: string[]}[]}
 */
export function pendingReparks(rows) {
  const last = new Map();
  for (const r of rows) if (r.outcome !== "started") last.set(r.n, r);
  return [...last.values()].flatMap((r) => {
    const steps = (r.park_failed ?? []).filter((s) => REPARKABLE.has(s));
    return (r.outcome === "parked" || r.outcome === "reparked") && steps.length ? [{ n: r.n, steps }] : [];
  });
}

/** A spawn, written before the session can die with its supervisor and leave no row of its own. */
export const startRow = ({ number, phase = null, runId = null, loopSha = null, at = new Date() }) => ({
  schema: SESSION_SCHEMA,
  n: number,
  outcome: "started",
  phase,
  started: at.toISOString(),
  run_id: runId,
  loop_sha: loopSha,
});

/**
 * One spawned session. `at` is the phase it was spawned at and `model` its own session's model
 * from `init`, so a model is judged per row; `run` is what `runTicket` returned, its `result` the
 * `readEvent` reading of the `result` event and null when the session died before writing one.
 * `fix` is left unwritten when the supervisor does not know, so a reader falls back on the window's
 * order. `error` is `errorOf`'s.
 *
 * @param {{n: number, runId?: string|null, loopSha?: string|null, started: string, ms: number,
 *   asleepMs?: number|null, at: string|null, fix?: boolean, size?: string|null, model?: string|null,
 *   sessionId?: string|null, version?: string|null, maxTurns?: number|null, outcome: string,
 *   why?: string|null, handoff?: {phase: string, why: string|null, said: string|null}|null,
 *   pr?: number|null, head?: string|null, error?: object|null,
 *   run?: {result?: Record<string, any>|null, phases?: Record<string, number>}|null}} p
 */
export const processRow = ({ n, runId = null, loopSha = null, started, ms, asleepMs = null, at, fix = undefined, size = null, model = null, sessionId = null, version = null, maxTurns = null, run = null, outcome, why = null, handoff = null, pr = null, head = null, error = null }) => ({
  schema: SCHEMA,
  kind: "process",
  n,
  run_id: runId,
  loop_sha: loopSha,
  started,
  ms,
  asleep_ms: asleepMs,
  at,
  fix,
  size,
  model,
  claude_version: version,
  session_id: sessionId,
  cost: run?.result?.cost ?? 0,
  turns: run?.result?.turns ?? 0,
  max_turns: maxTurns,
  subtype: run?.result?.subtype ?? null,
  phases: run?.phases ?? {},
  outcome,
  why,
  handoff,
  pr,
  head,
  error,
});

/**
 * What the supervisor decided with no session of its own; `ms` is the time it waited on CI.
 *
 * @param {{n: number, runId?: string|null, loopSha?: string|null, outcome: string, why?: string|null,
 *   pr?: number|null, head?: string|null, ms?: number|null, at?: Date}} p
 */
export const outcomeRow = ({ n, runId = null, loopSha = null, outcome, why = null, pr = null, head = null, ms = null, at = new Date() }) => ({
  schema: SCHEMA,
  kind: "outcome",
  n,
  run_id: runId,
  loop_sha: loopSha,
  started: at.toISOString(),
  ms,
  outcome,
  why,
  pr,
  head,
});

/**
 * Every `started` row with no row of its ticket and run after it before the next start — a
 * restarted run writes rows for the ticket too. `ms` runs to `lastSeen(row, until)`, the session's
 * last sign of life before `until`; the next start comes only when someone restarts the loop, so
 * it bounds the session and does not time it.
 *
 * @param {object[]} rows the ledger with its start rows
 * @param {(row: object, until: number) => number|null} [lastSeen]
 */
export function killedStarts(rows, lastSeen = () => null) {
  const killed = [];
  let open = null;
  const close = (until, trailing) => {
    const end = Math.min(lastSeen(open, until) ?? until, until);
    killed.push({ n: open.n, phase: open.phase ?? null, started: open.started, loop_sha: open.loop_sha ?? null, ms: Math.max(0, end - Date.parse(open.started)), trailing });
  };
  for (const r of rows) {
    if (r.outcome === "started") {
      if (open) close(Date.parse(r.started), false);
      open = r;
    } else if (open && r.n === open.n && r.run_id === open.run_id) open = null;
  }
  if (open) close(Date.now(), true);
  return killed;
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
 * @param {{append?: Function, mkdir?: Function, exists?: Function, write?: Function, read?: Function,
 *   loopSha?: string|null}} [io]
 */
export function ledger(io = {}) {
  const {
    append = (file, text) => fsNode.appendFileSync(file, text, "utf8"),
    mkdir = () => fsNode.mkdirSync(DIR, { recursive: true }),
    exists = (file) => fsNode.existsSync(file),
    write = (file, text) => fsNode.writeFileSync(file, text, "utf8"),
    read = (file) => fsNode.readFileSync(file, "utf8"),
    loopSha = null,
  } = io;

  const totals = { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 };
  /** @type {object[]} */
  const rows = [];
  /** The report row of every ticket this run closed — what the exit summary prints. */
  const tickets = [];

  return {
    totals,
    rows,
    tickets,
    /**
     * @param {object} session what `sessionRow` needs
     * @param {{runId: string, report: object, counts?: boolean}} into what `reportRow` renders,
     *   and whether this session closes a ticket — a retry round is a session, not a ticket.
     */
    loopSha,
    /** @param {number} number @param {string|null} phase @param {string} runId */
    start(number, phase, runId) {
      mkdir();
      append(ledgerPath(), `${JSON.stringify(startRow({ number, phase, runId, loopSha }))}\n`);
    },
    record(session, { runId, report, counts = true }) {
      const entry = sessionRow({ ...session, runId, loopSha });
      mkdir();
      append(ledgerPath(), `${JSON.stringify(entry)}\n`);

      const file = reportPath(runId);
      const sha = loopSha ? ` · loop ${loopSha.slice(0, 7)}` : "";
      if (!exists(file)) write(file, `# queue-loop ${runId.replace(/-(\d\d)-(\d\d)$/, " $1:$2")}${sha}\n\n`);
      append(file, `${reportRow(report, PLAIN())}\n`);

      totals.cost += entry.cost;
      totals.ms += entry.ms;
      if (counts) {
        totals.tickets += 1;
        if (entry.outcome === "landed" || entry.outcome === "closed") totals.landed += 1;
        else totals.parked += 1;
        tickets.push(report);
      }
      rows.push(entry);
      return entry;
    },
    /** The closing total under the night's rows, and the recap above them, under the title. */
    close(runId, line, recap = "") {
      mkdir();
      const file = reportPath(runId);
      const titled = exists(file);
      append(file, `\n${line}\n`);
      if (!recap || !titled) return;
      const [title, ...rest] = read(file).split("\n");
      write(file, [title, "", recap, ...rest].join("\n"));
    },
  };
}

/** Session rows only, unless `starts` asks for the spawns between them too. @param {string} [file] */
export function readLedger(file = ledgerPath(), { starts = false } = {}) {
  if (!fsNode.existsSync(file)) return [];
  const rows = [];
  for (const line of fsNode.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (starts || row.outcome !== "started") rows.push(row);
    } catch {
      continue;
    }
  }
  return rows;
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/**
 * How long each step usually takes, in ms. A session row times A–F in seconds; the merge step is
 * the supervisor's settle, a `landed` row with no phases, turns or spend, whose clock is the CI wait.
 *
 * @param {object[]} rows
 */
export function typicalMs(rows) {
  const by = {};
  for (const r of rows) {
    const phases = Object.entries(r.phases ?? {});
    for (const [k, s] of phases) (by[k] ??= []).push(s * 1000);
    if (r.outcome === "landed" && !phases.length && !r.turns && !r.cost && r.ms) (by.G ??= []).push(r.ms);
  }
  return Object.fromEntries(Object.entries(by).map(([k, a]) => [k, median(a)]));
}

/** Only for rows before schema 6, which carried a handoff as prose. */
const HANDOFF_RE = /phase\s+([A-Za-z])\s+next(?: — (.+))?/;

/** @param {{handoff?: {phase: string, why: string|null, said?: string|null}|null, park_reason?: string|null}} row */
export function handoffIn(row) {
  if (row.handoff) return { phase: row.handoff.phase, why: row.handoff.why ?? row.handoff.said ?? null };
  const m = HANDOFF_RE.exec(row.park_reason ?? "");
  return m ? { phase: m[1], why: m[2] ?? null } : null;
}

/** @param {string} outcome @param {string|null|undefined} why @param {object|null} [error] */
export const parkReasonOf = (outcome, why, error = null) =>
  outcome === "landed" || outcome === "closed" || outcome === "retry" || outcome === "pushed"
    ? null
    : outcome === "parked" && error && why
      ? `${why} — ${errorLine(error)}`
      : (why ?? null);

/**
 * What a row's report line shows: its own cost, plus that of the `pushed` row its window opened
 * with. The ledger keeps the money on the `pushed` row alone.
 *
 * @param {{n: number, outcome: string, own: number}} row @param {object[]} rows
 */
export function windowCost({ n, outcome, own }, rows) {
  const last = rows.filter((r) => r.n === n).at(-1);
  return own + (outcome !== "pushed" && last?.outcome === "pushed" ? (last.cost ?? 0) : 0);
}

/**
 * A ticket's rounds, spend and handoffs, rebuilt from the rows a restart cannot otherwise see:
 * everything for `n` since its last `landed`, `closed` or `parked` row, which is where the tally
 * must have read zero even before this session existed.
 *
 * @param {number} n @param {object[]} rows
 */
export function ticketTally(n, rows) {
  const forTicket = rows.filter((r) => r.n === n && r.outcome !== "started");
  let start = 0;
  forTicket.forEach((r, i) => {
    if (["landed", "closed", "parked", "reparked"].includes(r.outcome)) start = i + 1;
  });
  const since = forTicket.slice(start);

  let spend = 0;
  let ms = 0;
  let turns = 0;
  let handoffsThisRound = 0;
  let lastHandoff = null;
  let handoffWhy = null;
  let retries = 0;
  let lastRedHead = null;
  for (const r of since) {
    spend += r.cost ?? 0;
    ms += r.ms ?? 0;
    turns += r.turns ?? 0;
    if (r.outcome === "retry") {
      retries += 1;
      handoffsThisRound = 0;
      lastHandoff = null;
      handoffWhy = null;
      lastRedHead = r.head ?? null;
    } else if (r.outcome === "handoff") {
      handoffsThisRound += 1;
      const handed = handoffIn(r);
      if (handed) [lastHandoff, handoffWhy] = [handed.phase, handed.why];
    }
  }
  const sessions = since.filter((r) => r.outcome !== "pushed").length;
  return { sessions, spend, ms, turns, handoffsThisRound, lastHandoff, handoffWhy, lastRedHead, retries };
}

const CLOSERS = new Set(["landed", "closed", "parked", "reparked"]);
export const closesWindow = (row) => CLOSERS.has(row.outcome);

/** A session's row: by `kind` from schema 9, and before it any row but a start that ran turns. */
export const isProcess = (row) => (row.kind ? row.kind === "process" : row.outcome !== "started" && row.turns !== 0);

/**
 * The phase a process was spawned at: schema 9 records it, `withSpawnPhase` reads it from the start
 * row before that, and only a row older than start rows falls back to the first phase it timed.
 */
export const atOf = (row) => row.at ?? Object.keys(row.phases ?? {})[0] ?? null;

/**
 * The rows without their start rows, each earlier process row given the `at` its start row named.
 * The first phase a session timed is B for most fresh claims, and D for one that reached review.
 *
 * @param {{n: number, [field: string]: any}[]} rows the ledger with its start rows
 * @returns {{n: number, [field: string]: any}[]}
 */
export function withSpawnPhase(rows) {
  const pending = new Map();
  const out = [];
  for (const r of rows) {
    const key = `${r.n} ${r.run_id ?? ""}`;
    if (r.outcome === "started") {
      pending.set(key, r.phase ?? null);
      continue;
    }
    const at = isProcess(r) ? pending.get(key) : undefined;
    if (at !== undefined) pending.delete(key);
    out.push(r.at || at == null ? r : { ...r, at });
  }
  return out;
}

/**
 * A review that held: a process that reviewed and handed back to C or D. Read from the phase it
 * timed first, not the one it was spawned at: a fresh claim that found its branch at review ran D.
 * A handoff on to E was a LAND that left E to the next process.
 */
export const holdRound = (row) =>
  isProcess(row) && row.outcome === "handoff" && (Object.keys(row.phases ?? {})[0] ?? row.at) === "D" && ["C", "D"].includes(handoffIn(row)?.phase ?? "");

/**
 * One window's rows folded together. Before schema 9 a row carries no `fix`, so a process after
 * the window's first `retry` is the fix round's.
 *
 * @param {object[]} rows one ticket's rows, oldest first, start rows excluded
 */
export function tallyOf(rows) {
  const t = {
    spend: 0,
    ms: 0,
    turns: 0,
    processes: 0,
    handoffs: 0,
    lastHandoff: /** @type {{phase: string, why: string|null}|null} */ (null),
    retries: 0,
    lastRedHead: /** @type {string|null} */ (null),
    reruns: /** @type {(string|null)[]} */ ([]),
    holds: 0,
    fixSpend: 0,
  };
  let fixing = false;
  for (const r of rows) {
    const cost = r.cost ?? 0;
    t.spend += cost;
    t.ms += r.ms ?? 0;
    t.turns += r.turns ?? 0;
    if (isProcess(r)) t.processes += 1;
    if (holdRound(r)) t.holds += 1;
    if ((r.fix ?? fixing) || holdRound(r)) t.fixSpend += cost;
    if (r.outcome === "retry") {
      t.retries += 1;
      t.handoffs = 0;
      t.lastHandoff = null;
      t.lastRedHead = r.head ?? null;
      fixing = true;
    } else if (r.outcome === "handoff") {
      t.handoffs += 1;
      t.lastHandoff = handoffIn(r) ?? t.lastHandoff;
    } else if (r.outcome === "rerun" || r.outcome === "diagnosed") {
      t.reruns.push(r.head ?? null);
    }
  }
  return t;
}

/**
 * Ticket `n`'s open window: its rows since its last landed, closed, parked or reparked row, where
 * every count must have read zero even before this process existed. `ciRounds` is the tracker's
 * CI-RED count, which survives a ledger that never saw a round the loop was down for.
 *
 * @param {number} n @param {object[]} rows @param {number} [ciRounds]
 */
export function ticketWindow(n, rows, ciRounds = 0) {
  const mine = rows.filter((r) => r.n === n && r.outcome !== "started");
  return { ...tallyOf(mine.slice(mine.findLastIndex(closesWindow) + 1)), ciRounds };
}
