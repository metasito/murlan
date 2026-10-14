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
 * issue across claims and fix rounds, beside `review_rounds`, the count the cap reads. 9 adds
 * `model`, the one the session's init line named, and drops `usage`, a token split read back off
 * the stream log, and `review_holds_total`, which `holdRound` counts from the rows.
 */
export const SCHEMA = 9;

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
 * @param {{number: number, size: string|null, outcome: string, parkReason?: string|null,
 *   pr: number|null, phases: Record<string, number>, result: object|null, merged: boolean,
 *   reviewRounds: number|null, startedAt: string, ms: number, version: string|null,
 *   model?: string|null, head?: string|null, runId?: string|null,
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
  startedAt,
  ms,
  asleepMs = null,
  version,
  model = null,
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
    asleep_ms: asleepMs,
    model,
    models,
    subagents: result?.subagents ?? null,
    cache: result?.cache ?? { created: 0, read: 0 },
    merged: Boolean(merged),
    review_rounds: reviewRounds ?? null,
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

const LANDING = new Set(["pushed", "armed", "retry"]);

/**
 * The pull requests the loop pushed and nothing has ended since: each ticket whose last row is one
 * of `LANDING`, with the pull request its window named. The supervisor visits each once a pass.
 *
 * @param {{n: number, outcome: string, pr?: number|null}[]} rows
 * @returns {{n: number, pr: number}[]}
 */
export function inFlight(rows) {
  const at = new Map();
  for (const r of rows) {
    if (r.outcome === "started") continue;
    const pr = r.pr ?? at.get(r.n)?.pr ?? null;
    if (LANDING.has(r.outcome) && pr) at.set(r.n, { n: r.n, pr });
    else at.delete(r.n);
  }
  return [...at.values()];
}

/** A spawn, written before the session can die with its supervisor and leave no row of its own. */
export const startRow = ({ number, phase = null, runId = null, loopSha = null, at = new Date() }) => ({
  schema: SCHEMA,
  n: number,
  outcome: "started",
  phase,
  started: at.toISOString(),
  run_id: runId,
  loop_sha: loopSha,
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

/** `killedStarts`' `lastSeen`: when the ticket's stream log was last written. */
export const lastWrite = (row) => (fsNode.existsSync(streamLog(row.n)) ? fsNode.statSync(streamLog(row.n)).mtimeMs : null);

/** A ticket is a row that ended one; a fix round, a handoff or a refusal is a session, not a ticket. */
const ENDS_TICKET = new Set(["landed", "closed", "parked"]);

/** What a run's rows add up to. */
export function totalsOf(rows) {
  const sum = (key) => rows.reduce((n, r) => n + (r[key] ?? 0), 0);
  const ended = rows.filter((r) => ENDS_TICKET.has(r.outcome));
  const parked = ended.filter((r) => r.outcome === "parked").length;
  return { tickets: ended.length, landed: ended.length - parked, parked, cost: sum("cost"), ms: sum("ms") };
}

/** What a row's report line shows: a landing the ticket's whole bill, a settle the push it closes. */
function billOf(entry, prior) {
  if (entry.outcome !== "landed" && entry.outcome !== "closed") {
    return { ms: entry.ms, turns: entry.turns, cost: windowCost({ n: entry.n, outcome: entry.outcome, own: entry.cost }, prior) };
  }
  const whole = ticketTally(entry.n, prior);
  return { ms: whole.ms + entry.ms, turns: whole.turns + entry.turns, cost: whole.spend + entry.cost };
}

/**
 * The run's record, and its running totals, with one owner: every session that ends calls `record`
 * exactly once, and the totals are whatever the rows say.
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

  /** @type {object[]} */
  const rows = [];
  /** The report row of every ticket this run closed — what the exit summary prints. */
  const tickets = [];

  return {
    get totals() {
      return totalsOf(rows);
    },
    rows,
    tickets,
    loopSha,
    /** @param {number} number @param {string|null} phase @param {string} runId */
    start(number, phase, runId) {
      mkdir();
      append(ledgerPath(), `${JSON.stringify(startRow({ number, phase, runId, loopSha }))}\n`);
    },
    /**
     * @param {{number: number, outcome: string, why?: string|null, run: object, title?: string|null,
     *   size?: string|null, reviewRounds?: number|null, pr?: number|null,
     *   merged?: boolean, head?: string|null, handoff?: object|null, parkFailed?: string[]|null,
     *   flake?: object|null}} session
     * @param {string} runId
     */
    record({ number, outcome, why = null, run, title = null, size = null, reviewRounds = null, pr = null, merged = false, head = null, handoff = null, parkFailed = null, flake = null }, runId) {
      const prior = exists(ledgerPath()) ? parsed(read(ledgerPath())) : [];
      const error = errorOf(run);
      const entry = sessionRow({
        number,
        size,
        outcome,
        parkReason: parkReasonOf(outcome, why, error),
        pr,
        phases: run.phases ?? {},
        result: run.result,
        merged,
        reviewRounds,
        // A park recorded hours after its session ended did not start at `now - ms`.
        startedAt: run.started ?? new Date(Date.now() - run.ms).toISOString(),
        ms: run.ms,
        asleepMs: run.asleepMs ?? null,
        version: run.version,
        model: run.model ?? null,
        head,
        runId,
        loopSha,
        handoff,
        error,
        parkFailed,
        flake,
      });
      mkdir();
      append(ledgerPath(), `${JSON.stringify(entry)}\n`);

      const bill = billOf(entry, prior);
      const report = { number, title: title ?? `ticket #${number}`, outcome, pr, ms: bill.ms, cost: bill.cost, why: why ?? undefined };
      const file = reportPath(runId);
      const sha = loopSha ? ` · loop ${loopSha.slice(0, 7)}` : "";
      if (!exists(file)) write(file, `# queue-loop ${runId.replace(/-(\d\d)-(\d\d)$/, " $1:$2")}${sha}\n\n`);
      append(file, `${reportRow(report, PLAIN())}\n`);

      if (ENDS_TICKET.has(outcome)) tickets.push(report);
      rows.push(entry);
      return { entry, bill };
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

/** @type {(text: string, starts?: boolean) => any[]} */
const parsed = (text, starts = false) =>
  text.split("\n").flatMap((line) => {
    try {
      const row = JSON.parse(line);
      return starts || row.outcome !== "started" ? [row] : [];
    } catch {
      return [];
    }
  });

/** Session rows only, unless `starts` asks for the spawns between them too. @param {string} [file] */
export function readLedger(file = ledgerPath(), { starts = false } = {}) {
  return fsNode.existsSync(file) ? parsed(fsNode.readFileSync(file, "utf8"), starts) : [];
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

/** @param {{handoff?: {phase: string, why: string|null, said?: string|null}|null}} row */
export const handoffIn = ({ handoff }) => (handoff ? { phase: handoff.phase, why: handoff.why ?? handoff.said ?? null } : null);

/** @param {string} outcome @param {string|null|undefined} why @param {object|null} [error] */
export const parkReasonOf = (outcome, why, error = null) =>
  outcome === "landed" || outcome === "closed" || outcome === "retry" || outcome === "pushed" || outcome === "armed"
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
  // An `armed` row is the landing's note in passing, not the end of its window.
  const last = rows.filter((r) => r.n === n && r.outcome !== "armed").at(-1);
  return own + (outcome !== "pushed" && last?.outcome === "pushed" ? (last.cost ?? 0) : 0);
}

/**
 * A ticket's rounds, spend and handoffs, rebuilt from the rows a restart cannot otherwise see:
 * everything for `n` since its last row `closesWindow` names, which is where the tally
 * must have read zero even before this session existed.
 *
 * @param {number} n @param {object[]} rows
 */
export function ticketTally(n, rows) {
  const mine = rows.filter((r) => r.n === n && r.outcome !== "started");
  return tallyOf(mine.slice(mine.findLastIndex(closesWindow) + 1));
}

const CLOSERS = new Set(["landed", "closed", "parked", "reparked"]);
export const closesWindow = (row) => CLOSERS.has(row.outcome);

/** A session's row: any row but a start that ran turns. */
export const isProcess = (row) => row.outcome !== "started" && row.turns !== 0;

/**
 * The phase a process was spawned at: `withSpawnPhase` reads it from the start row, and only a row
 * older than start rows falls back to the first phase it timed.
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
    out.push(at == null ? r : { ...r, at });
  }
  return out;
}

/**
 * A review that held: a process that reviewed and handed back to C or D. Read from the phase it
 * timed first, not the one it was spawned at: a fresh claim that found its branch at review ran D.
 * A handoff on to E was a LAND that left E to the next process.
 */
export const holdRound = (row) =>
  isProcess(row) && row.outcome === "handoff" && (Object.keys(row.phases ?? {})[0] ?? row.at) === "D" && ["C", "D"].includes(row.handoff?.phase ?? "");

/**
 * One window's rows folded together: `ticketTally`'s open window, and each of the gauge's. A row
 * carries no `fix`, so a process after the window's first `retry` is the fix round's.
 *
 * @param {object[]} rows one ticket's rows, oldest first, start rows excluded
 */
export function tallyOf(rows) {
  const t = {
    sessions: 0,
    spend: 0,
    ms: 0,
    turns: 0,
    processes: 0,
    fixSpend: 0,
    holds: 0,
    handoffsThisRound: 0,
    lastHandoff: /** @type {string|null} */ (null),
    handoffWhy: /** @type {string|null} */ (null),
    lastRedHead: /** @type {string|null} */ (null),
    retries: 0,
    /** Rows since the last `retry` that are not an `armed` note: a fix round's own. */
    sinceRed: 0,
    armedHead: /** @type {string|null} */ (null),
    armedFlake: /** @type {{runId: number, tests: string[], step: string|null, head: string|null}|null} */ (null),
  };
  let fixing = false;
  for (const r of rows) {
    const cost = r.cost ?? 0;
    if (r.outcome === "armed") {
      // A head re-armed after its rerun keeps the rerun's note: the green it merges on is still that rerun's.
      t.armedFlake = r.flake ? { ...r.flake, head: r.head ?? null } : t.armedFlake?.head === r.head ? t.armedFlake : null;
      t.armedHead = r.head ?? null;
    } else {
      t.sinceRed = r.outcome === "retry" ? 0 : t.sinceRed + 1;
      if (r.outcome !== "pushed") t.sessions += 1;
    }
    t.spend += cost;
    t.ms += r.ms ?? 0;
    t.turns += r.turns ?? 0;
    if (isProcess(r)) t.processes += 1;
    const held = holdRound(r);
    if (held) t.holds += 1;
    if (fixing || held) t.fixSpend += cost;
    if (r.outcome === "retry") {
      t.retries += 1;
      t.handoffsThisRound = 0;
      t.lastHandoff = null;
      t.handoffWhy = null;
      t.lastRedHead = r.head ?? null;
      fixing = true;
    } else if (r.outcome === "handoff") {
      t.handoffsThisRound += 1;
      const handed = handoffIn(r);
      if (handed) [t.lastHandoff, t.handoffWhy] = [handed.phase, handed.why];
    }
  }
  return t;
}
