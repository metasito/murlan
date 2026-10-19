/**
 * The loop that never stops. `.claude/commands/queue.md` runs one ticket per process and exits;
 * this is what starts the next one, in a clean process, so no ticket's context reaches the next.
 *
 * The split: this picks one ticket, passes its number to the session, waits for the session to
 * exit, reads CI, polls mergeability, merges, and records. The session owns claim → build →
 * review → gate → push. Tickets are serialised, so there is no pending pull request held in
 * memory for a crash to orphan.
 *
 * It exits only when there is genuinely nothing to do. A spent usage window is a wait, not an end:
 * see `holdFor`.
 *
 * Usage: npm run queue:loop (tools/loop/run-loop.mjs, which restarts this on exit 75)
 */
import path from "node:path";
import { git as gitAt, REPO } from "./cli.mjs";
import { derive } from "./loop-derive.mjs";
import { killedRun, runSession, runTicket } from "./loop-session.mjs";
import { bell, clockAt, LAND, PLAIN, reportRow, runRecap, runTotal, stepRow } from "./loop-render.mjs";
import { ticker } from "./loop-screen.mjs";
import { journaled, screenEvents, ticketFacts } from "./loop-board.mjs";
import {
  appendSupervisor,
  errorLine,
  errorOf,
  killedStarts,
  lastWrite,
  ledger as openLedger,
  conflictNotePath,
  parkNotePath,
  pendingReparks,
  prune as pruneLogs,
  logOf,
  noted,
  writeNote,
  readLedger,
  streamLog,
  ticketTally,
  typicalMs,
} from "./loop-logs.mjs";
import { loopSha, sh, tearDown, workspacePort } from "./workspace.mjs";
import { buildReady } from "./loop-gate.mjs";
import { ghTracker } from "./tracker.mjs";
import { turnHeadroom } from "./loop-cost.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { HEARTBEAT_MS, LIMITS, REFRESH_TIMEOUT_MS, RESTART, sleepClock } from "./limits.mjs";
import { nextPick } from "./next-ticket.mjs";
import { branchOf, claim, claimError } from "./claim.mjs";
import { afterSession, decide } from "./decide.mjs";
import { CI_RED_TIMEOUT_MS, runSettle } from "./settle.mjs";

const { SETTLE, TICKET_HOLDS, WAIT } = LIMITS;

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * Sliced, so `.loop-stop` still reaches the loop across a long wait.
 *
 * @param {number} ms
 * @param {() => boolean} stopped whether `.loop-stop` is on disk
 * @param {number} [slice]
 * @param {((line: string) => void)|null} [say]
 * @param {number} [beat]
 * @param {Promise<void>|null} [woken] resolves when the owner asks for the wait to end now
 */
export async function holdFor(
  ms,
  stopped,
  slice = 30_000,
  say = null,
  beat = HEARTBEAT_MS,
  woken = null,
) {
  const until = Date.now() + ms;
  let next = Date.now() + beat;
  let wake = false;
  woken?.then(() => (wake = true));
  while (Date.now() < until) {
    if (stopped()) return "stopped";
    if (wake) return "woken";
    if (say && Date.now() >= next) {
      say(`still waiting — back at ${clockAt(until)}`);
      next = Date.now() + beat;
    }
    // Not unref'd: by now this is the only handle keeping the process alive.
    let timer;
    await Promise.race([new Promise((r) => (timer = setTimeout(r, Math.min(slice, until - Date.now())))), woken].filter(Boolean));
    clearTimeout(timer);
  }
  return wake ? "woken" : "waited";
}

/**
 * Hands a ticket back to the owner: the work committed, the claim released, the reason on the
 * issue, the worktree gone.
 *
 * Each step reports rather than throwing. This is the failure path — reached from the stop-file
 * drain as well as from a bad session — so a throw here would turn an orderly stop into an
 * unhandled rejection.
 *
 * @param {number} number
 * @param {{phase: string, why: string, log: string, cwd: string|null, branch: string|null,
 *   dirty: boolean, error?: object|null, run?: Function, tracker?: object, write?: Function}} ctx
 * @returns {{ok: boolean, failed: string[]}}
 */
export function park(
  number,
  {
    phase,
    why,
    log,
    cwd,
    branch,
    dirty,
    error = null,
    run = sh,
    tracker = ghTracker((args, opts) => run("gh", args, opts)),
    write = writeNote,
    remove = tearDown,
  },
) {
  const failed = [];
  const step = (name, fn) => {
    try {
      fn();
    } catch (err) {
      failed.push(name);
      console.error(`  ⚠️ park #${number}: ${name} failed — ${String(err.message).split("\n")[0]}`);
    }
  };

  if (dirty && cwd) {
    // `-A` is safe here and nowhere else: this is the ticket's own worktree, which has its own
    // index, and rule 40 keeps every other session out of it. Losing an unstaged edit is the one
    // thing parking must not do. Re-read rather than trusting `dirty`: it comes from a derive()
    // up to twenty seconds old, and a session that committed in that window leaves nothing to
    // stage, which makes `git commit` exit 1.
    step("commit", () => {
      run("git", ["-C", cwd, "add", "-A", "--", "."]);
      if (run("git", ["-C", cwd, "status", "--porcelain"]).trim()) {
        run("git", ["-C", cwd, "commit", "-m", `wip(#${number}): parked in phase ${phase}`]);
      }
    });
  }

  step("label", () => PARK_STEPS.label(number, tracker));

  const body = [
    `Parked by the queue loop in **phase ${phase}**.`,
    "",
    `- reason: ${why}`,
    `- branch: \`${branch ?? "none"}\`${dirty ? " (uncommitted work was committed before teardown)" : ""}`,
    `- log: \`${log}\``,
    ...(error ? [`- error: ${errorLine(error)}`] : []),
    ...(error?.stderr ? ["", "```", error.stderr, "```"] : []),
    "",
    "The branch keeps its commits. Nothing was discarded.",
    "",
    "**To send it back:** deal with the reason above, then swap `ready-for-human` for `ready-for-agent`." +
      " The next run resumes from the branch as it stands.",
  ].join("\n");
  step("comment", () => {
    write(parkNotePath(number), body);
    PARK_STEPS.comment(number, tracker);
  });

  if (cwd) step("worktree", () => remove(cwd));

  return { ok: failed.length === 0, failed };
}

/** The tracker's half of a park, each a step a later pass can apply again on its own. */
const PARK_STEPS = {
  label: (number, tracker) => tracker.park(number),
  comment: (number, tracker) => tracker.comment(number, parkNotePath(number)),
};

/**
 * The park steps that failed, applied again from what the park left on disk — only while the park
 * still stands. `why` says why a debt closed without being applied; `failed` is what is still owed.
 *
 * @param {number} number @param {string[]} steps
 * @returns {{failed: string[], why: string|null}}
 */
export function repark(number, steps, tracker = ghTracker(), exists = noted) {
  let issue;
  try {
    issue = tracker.issue(number, { timeout: CI_RED_TIMEOUT_MS });
  } catch (err) {
    console.error(`  ⚠️ park #${number}: the issue could not be read — ${String(err.message).split("\n")[0]}`);
    return { failed: steps, why: null };
  }
  // The label step owed leaves `in-progress` on; once it landed, `ready-for-human` is the park's own.
  // Anything else is the owner's doing, which a retry must not undo.
  const mark = steps.includes("label") ? "in-progress" : "ready-for-human";
  if (issue.state !== "OPEN" || !issue.labels.includes(mark)) {
    return { failed: [], why: "the owner already acted on the issue" };
  }
  const pruned = steps.includes("comment") && !exists(parkNotePath(number));
  const failed = steps.filter((s) => {
    if (s === "comment" && pruned) return false;
    try {
      PARK_STEPS[s](number, tracker);
      return false;
    } catch (err) {
      console.error(`  ⚠️ park #${number}: ${s} failed again — ${String(err.message).split("\n")[0]}`);
      return true;
    }
  });
  return { failed, why: pruned ? "the park note was pruned, so its comment is not posted" : null };
}

/**
 * Pushes the head review is about to read, and opens its pull request when none is open,
 * so CI runs while the review does. Not a gate: phase D's land step pushes again if this failed.
 */
export function publishForReview(number, branch, cwd, title, run = sh, tracker = ghTracker()) {
  const opts = { timeout: REFRESH_TIMEOUT_MS };
  run("git", ["-C", cwd, "push", "--quiet", "-u", "origin", branch], opts);
  const open = tracker.openPrFor(branch, opts);
  if (open) return prUrl(open.number);
  const body = `Closes #${number}\n\nOpened when review started. Phase D writes this description on LAND.`;
  return tracker.createPr({ head: branch, title, body }, opts);
}

const prUrl = (n) => `https://github.com/${REPO}/pull/${n}`;


/**
 * One report file per run, named for when the run started — not per calendar day: two runs on one
 * day would share a file, and a run crossing midnight would split across two.
 */
const RUN_ID = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

/**
 * The pull request this ticket pushed, if it pushed one.
 *
 * Falls back to the ticket number when the branch is unknown.
 *
 * `--state all`, because a pull request merged between the session's exit and this read — a peer,
 * an auto-merge, the owner — is a landing, not a session that pushed nothing. The head ref comes
 * back too: `ciVerdict` is asked for a branch's run, not a pull request's.
 *
 * `declared` is the number the session stated on its way out, asked for directly when the listing
 * has not caught up or does not reach back far enough.
 *
 * `since` bounds what counts as merged. A ticket re-opened and re-queued still has its old
 * `agent/<n>-…` pull request on the tracker, and reading that as a landing releases the claim on a
 * session that pushed nothing.
 *
 * @param {string|null} branch
 * @param {number} ticket
 * @param {number|null} [declared]
 * @param {number} [since] epoch ms; a merge older than this is not this session's
 * @param {ReturnType<typeof ghTracker>} [tracker]
 * @returns {{number: number, state: string, head: string, sha: string|null, changedFiles: number|null}|null}
 */
export function pushedPr(branch, ticket, declared = null, since = 0, tracker = ghTracker()) {
  // Matched on the head ref rather than by search: `#42` in a body also matches PR #942. With a
  // branch in hand the listing is exact; without one the newest 100 are scanned, which reaches back
  // far enough for a branch pushed minutes ago.
  // The head ref is the only thing that makes a pull request this ticket's, and it is checked on
  // every path including the declared one. `declared` is a number a model wrote, and what it
  // reaches is `gh pr merge`.
  const mine = (pr) =>
    branch ? pr?.headRefName === branch : new RegExp(`^agent/${ticket}-`).test(pr?.headRefName ?? "");
  const stale = (pr) =>
    pr.state === "MERGED" && since > 0 && Date.parse(pr.mergedAt ?? "") < since;
  const take = (pr) =>
    pr && mine(pr) && !stale(pr)
      ? { number: pr.number, state: pr.state, head: pr.headRefName, sha: pr.headRefOid ?? null, changedFiles: pr.changedFiles ?? null }
      : null;
  // A listing carries no file count; only the pull request itself does, and an unread one is unknown, not none.
  const counted = (pr) => {
    try {
      return { ...pr, changedFiles: tracker.pr(pr.number).changedFiles ?? null };
    } catch {
      return { ...pr, changedFiles: null };
    }
  };
  try {
    const rows = tracker.prsFor({ branch, ticket }).filter((pr) => mine(pr) && !stale(pr));
    const row = rows.find((p) => p.state === "OPEN") ?? rows.find((p) => p.state === "MERGED") ?? rows[0];
    const found = row && take(counted(row));
    if (found) return found;
  } catch {
    /* falls through to the declared number */
  }
  if (!declared) return null;
  try {
    return take(tracker.pr(declared));
  } catch {
    return null;
  }
}

/** GitHub re-points the pull request head asynchronously; asked at once, CI answers for the old one. */
const SETTLE_PAUSE_MS = 15_000;

/**
 * Waits for the pushed branch's CI and lands it. No judgement here — `readLandingState` says whether
 * the gate passed and `landing()` says what that plus the merge state means — which is why the session
 * that built the ticket has already exited by the time this runs.
 *
 * It owns a phase of its own because it is the longest stretch of a ticket and the session is gone:
 * without a row with a clock on it, a board that has just ticked `close` reads as finished, and a
 * twenty-minute CI wait reads as a hang.
 */
export async function settle(pending, screen, opts = {}) {
  const { pause = SETTLE_PAUSE_MS, deadline = SETTLE.DEADLINE_MS, watch = runSettle } = opts;
  screen.start(LAND);
  screen.set({ pr: prUrl(pending.pr) });
  screen.said(`waiting for ci.yml on ${pending.branch}`);
  try {
    const out = await watch(
      pending,
      (m) => {
        screen.said(m);
        screen.keep(m);
      },
      pause,
      deadline,
    );
    const landed = out.action === "already-merged";
    screen.close(landed ? "done" : "failed", landed ? `#${pending.pr} merged` : out.reason);
    return out;
  } catch (err) {
    // An open phase is a spinner with no end. Whatever else is wrong, the row has to settle.
    screen.close("failed", String(err.message).split("\n")[0]);
    throw err;
  }
}

/**
 * The one way a ticket is handed to the owner, and its one `parked` row: the row closes the
 * ledger window `ticketTally` counts from, so a park that writes none leaves the next claim
 * inheriting this one's rounds and spend.
 *
 * @param {{tracker: object, events: object, record: Function}} via
 * @param {number} number
 * @param {{phase: string, why: string, log: string, cwd: string|null, branch: string|null,
 *   dirty: boolean, run?: object, pr?: number|null, files?: number}} ctx `run` only when this park
 *   is the session's own row; otherwise its cost is already recorded and the row carries none.
 */
export function parkAndRecord({ tracker, events, record }, number, { run = null, pr = null, files = 0, flake = null, ...ctx }) {
  events.bell();
  const failed = tracker.park(number, { ...ctx, error: run ? errorOf(run) : null })?.failed ?? [];
  if (failed.length) events.log(`#${number}'s park did not reach the tracker (${failed.join(", ")}) — applied again at the start of each pass`, "park");
  record({
    number,
    outcome: "parked",
    why: ctx.why,
    run: run ?? { result: null, ms: 0, log: ctx.log, phases: {} },
    pr,
    files,
    parkFailed: failed.length ? failed : null,
    flake,
  });
  return { outcome: "parked", ticket: number, why: ctx.why };
}

/** Read in order, and only as far as the first that ends the pass. */
async function preflight(workspace, pinned) {
  if (workspace.stopFile()) return { stop: true };
  if (!workspace.syncCheckout(pinned)) return { unusable: true };
  const moved = workspace.loopMoved?.();
  if (moved) return { moved };
  return { housekeeping: await workspace.housekeeping(pinned) };
}

const HELD_AS = { preflight: "hold", usage: "refused", api: "overloaded", undeclared: "undeclared" };

/** The passes that leave the ticket standing, which the owner's park takes over. */
const PARKABLE = new Set(["handoff", "retry", "rebase", "refused", "overloaded", "hold", "undeclared"]);

/** What `main` says over each held pass, and the row it waits on. */
const HOLDS = {
  hold: ({ ticket, why }, loop) =>
    ticket != null
      ? { label: "waiting", line: `#${ticket} held: ${why} — asking again shortly (${loop.ticketHolds} of ${TICKET_HOLDS})`, what: `#${ticket}'s CI-RED`, then: `#${ticket} settles again` }
      : { label: "waiting", line: `${why} — asking again shortly (${loop.holds} of ${WAIT.TRIES})`, what: "a pre-flight hold", then: "the pre-flight asks again, then the next pick" },
  refused: ({ ticket }, loop, back) => ({
    label: "usage",
    line: `#${ticket} paused: the usage window is spent — back at ${back} (wait ${loop.waits} of ${WAIT.TRIES})`,
    what: `usage resets ${back}`,
    then: `#${ticket} resumes from its worktree`,
  }),
  overloaded: ({ ticket, why }, loop, back) => ({
    label: "api",
    line: `#${ticket} paused: ${why} — trying again at ${back} (${loop.overloads} of ${WAIT.TRIES})`,
    what: "the API is failing",
    then: `#${ticket} resumes from its worktree`,
  }),
};

/**
 * The pick step driven to an answer: each fact it asks for is read with `reads[fact](action, picking)`
 * and it is decided again. `decideAt` is `decide` given the pass's own limits, clock and counters.
 *
 * @param {Record<string, any>} picking what has been read so far; filled in as the step asks
 * @param {Record<string, (action: {n?: number}, picking: Record<string, any>) => any>} reads
 * @param {(facts: Record<string, any>) => any} decideAt
 */
export function choose(picking, reads, decideAt) {
  let action = decideAt(picking);
  while (action.kind === "ask") {
    picking[action.fact] = reads[action.fact](action, picking) ?? null;
    action = decideAt(picking);
  }
  return action;
}

/** What the pick step's facts are read from, through the pass's ports. */
const pickReads = ({ tracker, workspace, ledger }) => ({
  standing: () => workspace.derive(),
  known: (_, { standing }) => tracker.facts(standing.ticket),
  tally: ({ n }) => ledger.tally(n),
  // No claim runs on a resume, so the pinned ticket's branch is the one its claim would cut.
  pinnedFacts: (_, { pinned }) => {
    const facts = tracker.facts(pinned);
    return facts && { ...facts, branch: branchOf(pinned, facts.title) };
  },
  picked: () => tracker.pick(),
});

/**
 * One ticket, start to finish. Serialised deliberately: overlapping the next ticket with the last
 * one's CI wait buys ~22% wall clock and costs pending state nothing recovers when the process
 * dies, a worktree released under a live `derive()`, and two sessions cutting branches from a
 * `main` neither has yet.
 *
 * Every routing choice is `decide()`'s: this reads the facts it asks for and does what it answers.
 *
 * @param {{tracker: object, workspace: object, session: object, ledger: object}} ports what the
 *   pass reads and acts on, by what each reaches: GitHub, git and the disk, `claude`, the ledger
 * @param {object} events the lines the pass says itself, beside the ones its ports draw
 * @param {number|null} [pinned] a ticket a previous pass handed back unfinished
 * @param {string|null} [at] the phase a handoff said the next process starts at
 * @param {{failures: number, holds: number, waits: number, overloads: number, pinned: number|null}} [loop]
 *   the run's counters, which the pass returns updated
 * @returns {Promise<{outcome: "landed"|"closed"|"parked"|"stop"|"hold"|"retry"|"rebase"|"refused"|"overloaded"|"undeclared"|"handoff"|"restart",
 *   loop: object, halt: string|null, ticket?: number, why?: string, until?: number, hold?: number, byOwner?: boolean,
 *   cwd?: string|null, branch?: string|null, pr?: number, files?: number, phase?: string, run?: any, size?: string|null}>}
 */
export async function runOnce(ports, events, pinned = null, at = null, loop = { failures: 0, holds: 0, waits: 0, overloads: 0, pinned }) {
  const { tracker, workspace, session, ledger } = ports;
  const teardown = (cwd, number) => {
    if (number) tracker.release(number);
    workspace.remove(cwd, number);
  };
  const decideAt = (step, facts) => {
    const action = decide({ now: Date.now(), asked: false, own: null, ...facts, step, loop });
    loop = action.loop;
    return action;
  };
  const pass = (action, more = {}) => ({
    outcome: action.kind === "hold" ? HELD_AS[action.wait] : action.kind,
    ...(action.n != null && { ticket: action.n }),
    ...(action.why != null && { why: action.why }),
    ...(action.hold != null && { hold: action.hold }),
    ...more,
    loop,
    halt: action.halt ?? null,
  });

  const begun = decideAt("pre", { pre: await preflight(workspace, pinned) });
  if (begun.kind !== "go") return pass(begun);

  const reads = pickReads(ports);
  const pick = (picking) => {
    const action = choose(picking, reads, (facts) => decideAt("pick", facts));
    events.picked?.(action.n ?? null);
    return action;
  };
  let picked = pick({ pinned, at, repicked: false });
  if (picked.kind === "repick") {
    teardown(picked.cwd, picked.n);
    picked = pick({ pinned: loop.pinned, at: loop.pinned === null ? null : at, repicked: true });
  }
  if (picked.kind !== "go" && picked.kind !== "park") return pass(picked);
  const { route } = picked;
  const n = route.number;
  const ticket = { ...route, n };
  const size = route.size ?? null;
  const about = { title: route.title, size, reviewRounds: route.reviewRounds ?? null };
  const record = (row) => ledger.record({ ...about, ...row });
  const owner = () => (workspace.parkAsked(n) ? { asked: true, own: workspace.worktreeOf(n) } : { asked: false, own: null });
  const parkHere = (action, ctx) => {
    if (action.byOwner) workspace.clearParkAsk();
    const parked = parkAndRecord({ tracker, events, record }, n, { ...ctx, phase: action.phase, why: action.why });
    return { ...parked, loop, halt: action.halt ?? null, ...(action.byOwner && { byOwner: true }) };
  };
  // A cap's or the owner's park comes after the row of what it replaced, and carries the worktree
  // with it: a handoff leaves one standing on purpose, so a park without it leaves `derive()` a live
  // run to resume.
  const parkOver = (over, own, log) => parkHere(over, { ...(own ?? workspace.worktreeOf(n)), log });
  const unrun = { log: streamLog(n), cwd: route.cwd ?? null, branch: route.branch ?? null, dirty: route.dirty ?? false };
  if (picked.kind === "park") return parkHere(picked, unrun);
  const tallyNow = () => ledger.tally(n);
  let tally = picked.tally ?? tallyNow();

  if (picked.redWhileDown) {
    record({
      number: n,
      outcome: "retry",
      why: "CI went red while the loop was down",
      run: { result: null, ms: 0, log: streamLog(n), phases: {} },
      head: route.head,
    });
    tally = tallyNow();
  }
  if (route.fix) {
    let error = null;
    try {
      workspace.refreshWorktree(route.cwd, route.branch);
    } catch (err) {
      error = String(err.stderr || err.message).trim().split("\n")[0];
    }
    const refreshed = decideAt("refresh", { route: ticket, error });
    if (refreshed.kind === "park") return parkHere(refreshed, unrun);
  }

  const settling = route.phase === "G";
  if (settling) events.announce({ number: n, ...tracker.facts(n), queue: route.queue }, tally.ms);
  const run = settling
    ? { status: 0, result: null, declared: null, ms: 0, log: streamLog(route.number), phase: "G", phases: {} }
    : await session.spawn({
        ...route,
        retryCount: Math.max(tally.retries, route.ciRounds ?? 0),
        reason: route.phase === tally.lastHandoff ? tally.handoffWhy : null,
      });

  const dirtied = workspace.sharedCheckoutDirty?.();
  if (dirtied) events.log(`#${route.number}'s session left the shared checkout dirty:\n${dirtied}`, "session");

  const derived = workspace.standing();
  about.reviewRounds = derived?.ticket === n && derived.reviewRounds != null ? derived.reviewRounds : tracker.facts(n).reviewRounds;
  const after = afterSession(run, derived);
  // Read once the session has exited: a park is never a kill.
  const facts = { route: ticket, run: settling ? null : run, after: derived, tally, ...owner() };
  // `null`, never `undefined`, for a fact read: `undefined` is `decide`'s "not read yet".
  const read = {
    built: () => {
      const built = Boolean(workspace.buildPassed(after?.cwd ?? null, n));
      if (!built) events.log(`#${n} handed off to review with no local pass or no full DOD-CHECK on HEAD — back to C`, "build");
      return built;
    },
    pushed: () => tracker.pushedPr(after?.branch ?? null, n, run.declared?.pr ?? null, settling ? 0 : Date.now() - run.ms) ?? null,
    issue: () => tracker.issueState(n) ?? null,
  };
  let action = decideAt("session", facts);
  while (action.kind === "ask") {
    facts[action.fact] = read[action.fact]();
    action = decideAt("session", facts);
  }

  // The pull request's own count when derive() read no worktree; null when that count was not read.
  const files = () => {
    if (facts.pushed === undefined) return 0;
    if (after?.changed?.length) return after.changed.length;
    return facts.pushed ? (facts.pushed.changedFiles ?? null) : 0;
  };
  let billed = run;
  const worked = (pr, log = billed.log) => ({ log, cwd: after?.cwd ?? null, branch: after?.branch ?? null, dirty: after?.dirty ?? false, run: billed, pr: pr ?? null, files: files() });

  const replaced = action.instead ?? action;
  if (replaced.kind === "handoff" || replaced.kind === "hold") {
    if (replaced.kind === "handoff") {
      // CI runs while the review does; `runSettle` merges only a head a LAND covers.
      if (replaced.publish) tracker.publish(n, after.branch, after.cwd);
      const why = `phase ${replaced.phase} next${replaced.why ? ` — ${replaced.why}` : ""}`;
      record({ number: n, outcome: "handoff", why, run, handoff: { phase: replaced.phase, why: replaced.why, said: replaced.said } });
    } else {
      // A refusal spends real money before it stops, and this row is the one place it is recorded.
      record({ number: n, outcome: HELD_AS[replaced.wait], why: replaced.why, run });
    }
    if (action.kind === "park") return parkOver(action, facts.own, run.log);
    if (action.kind === "handoff") return pass(action, { phase: action.phase, run, size, cwd: after?.cwd ?? null, branch: after?.branch ?? null });
    return pass(action, { run, until: replaced.until });
  }
  if (action.kind === "stop") {
    record({ number: n, outcome: "halted", why: run.accountError, run });
    return pass(action);
  }
  if (action.kind === "park") return parkHere(action, worked(action.pr));
  if (action.kind === "closed") {
    teardown(after?.cwd ?? null, n);
    record({ number: n, outcome: "closed", why: action.why, run, files: files() });
    return pass(action);
  }
  if (action.kind === "landed") {
    teardown(after?.cwd ?? null, n);
    record({ number: n, outcome: "landed", why: action.why, run, pr: action.pr, merged: true, files: files() });
    return pass(action);
  }

  // The session's own row, before a wait the supervisor may not survive: every row below is the
  // land alone, so a restarted G pass adds its clock and never the session's cost a second time.
  if (!settling) {
    record({ number: n, outcome: "pushed", why: "CI next", run, pr: action.pr, files: files(), head: action.head });
    billed = { result: null, ms: 0, log: run.log, phases: {} };
  }
  const landFrom = Date.now();
  const settled = await tracker.settle({
    ticket: n,
    pr: action.pr,
    branch: after?.branch ?? facts.pushed.head,
    // A process that armed on a rerun's green and then stopped leaves its flake here, not in memory.
    flake: tally.armedFlake ?? null,
    noteArmed: (flake) =>
      record({
        number: n,
        outcome: "armed",
        why: "auto-merge armed on a rerun's green",
        run: { result: null, ms: 0, log: streamLog(n), phases: {} },
        pr: action.pr,
        head: flake.head,
        flake: { runId: flake.runId, tests: flake.tests, step: flake.step },
      }),
  });
  billed.ms += Date.now() - landFrom;
  // What the next round is judged against: a round that leaves this where it was cannot change
  // what CI answers.
  const head = settled.head ?? facts.pushed?.sha ?? null;
  const owned = owner();
  const judging = { route: ticket, settled: { ...settled, head }, tally: tallyNow(), ...owned };
  let verdict = decideAt("settled", judging);
  // The CONFLICT comment is what routes the next pass to the rebase round, as CI-RED routes a fix round.
  if (verdict.kind === "ask") verdict = decideAt("settled", { ...judging, posted: tracker.conflict(n, head) });
  const red = verdict.instead ?? verdict;
  if (red.kind === "retry" || red.kind === "rebase" || red.kind === "hold") {
    record({ number: n, outcome: red.kind === "hold" ? HELD_AS[red.wait] : red.kind, why: settled.reason, run: billed, pr: action.pr, merged: false, files: files(), head, flake: settled.flake ?? null });
    if (verdict.kind === "park") return parkOver(verdict, owned.own, red.kind === "hold" ? streamLog(n) : run.log);
    // The worktree and the run come with it: the next round works in that worktree.
    if (verdict.kind === "retry" || verdict.kind === "rebase") {
      return pass(verdict, { cwd: after?.cwd ?? null, branch: after?.branch ?? facts.pushed.head, pr: action.pr, sha: head, files: files(), run, size });
    }
    return pass(verdict);
  }
  if (verdict.kind === "landed") {
    record({ number: n, outcome: "landed", why: settled.reason, run: billed, pr: action.pr, merged: true, files: files(), head, flake: settled.flake ?? null });
    teardown(after?.cwd ?? null, n);
    return pass(verdict);
  }
  // The failed CI log, when there is one: it is what the owner needs and the session's own stream
  // log is not.
  const log = (verdict.ciRed && workspace.ciLog(n)) || billed.log;
  return parkHere(verdict, { ...worked(action.pr, log), flake: verdict.ciRed ? null : (settled.flake ?? null) });
}

/**
 * The real ports, bound once so `runOnce` can be driven without git, the tracker or a binary:
 * `tracker` is everything GitHub, `workspace` git and the disk, `session` the `claude` process,
 * `ledger` the record of the night. Whatever they draw goes through `events`.
 */
function realPorts(book, screen, events) {
  // The queue as the *previous* pick read it. The direction is what a night is made of, and this
  // is the one reading that costs nothing — the next pick is being made anyway.
  let before = null;
  const tracker = {
    pick: () => {
      const route = nextPick();
      if (before) events.recap(book.totals, before, route.queue);
      before = route.queue;
      return route;
    },
    queue: () => before,
    facts: ticketFacts,
    issueState: (n) => {
      const f = ticketFacts(n);
      return { state: f.state ?? null, stateReason: f.stateReason ?? null };
    },
    publish: (number, branch, cwd) => {
      try {
        events.published(publishForReview(number, branch, cwd, ticketFacts(number).title));
      } catch (err) {
        events.log(`#${number} is not pushed for review — ${String(err.message).split("\n")[0]}`, "publish");
      }
    },
    pushedPr,
    settle,
    park,
    conflict: (number, head) => {
      try {
        writeNote(conflictNotePath(number), `CONFLICT ${head}\nThe branch conflicts with main: the next process rebases it onto origin/main.`);
        ghTracker().comment(number, conflictNotePath(number));
        return true;
      } catch (err) {
        events.log(`#${number}: could not post CONFLICT — ${String(err.message).split("\n")[0]}`, "conflict");
        return false;
      }
    },
    repark: (number, steps) => repark(number, steps),
    /**
     * **The claim comes off here, and nowhere else on the success paths**, with the worktree
     * (`runOnce`'s teardown) — and `in-progress` left on is a ticket `next-ticket.mjs` skips for good.
     */
    release: (number) => {
      try {
        ghTracker().release(number);
      } catch (err) {
        // Said out loud, because silence here is permanent: the picker skips `in-progress`, so a
        // swallowed failure leaves a finished ticket nothing will ever take again.
        events.log(`#${number} is still in-progress — ${String(err.message).split("\n")[0]}`, "claim");
      }
    },
  };
  const workspace = {
    ...workspacePort({ root: ROOT, git: gitAt(ROOT), events }),
    buildPassed: (cwd, ticket) => {
      try {
        return Boolean(cwd) && buildReady(cwd, ticket).ok;
      } catch {
        return false;
      }
    },
  };
  const session = {
    spawn: (route) => {
      let branch = route.branch ?? null;
      if (!route.resuming) {
        events.header({ number: route.number, title: route.title, size: route.size, url: `https://github.com/${REPO}/issues/${route.number}`, queue: route.queue });
        // A lost race is not a failure of this run: the ticket is someone else's, and the shape that
        // says so is the stand-down every other path already reads — so the session is never
        // spawned and `runOnce` parks it from the declaration.
        let claimed;
        try {
          claimed = claim(route.number, route.title);
        } catch (err) {
          claimed = { won: false, why: claimError(err) };
        }
        if (claimed.won) {
          branch = claimed.branch;
          events.step({ label: "claim", detail: `won · ${branch}`, ms: null });
        } else {
          const why = claimed.why || "the claim did not stand";
          events.step({ label: "claim", detail: why, ms: null, state: "failed" });
          return Promise.resolve({
            status: 0,
            blocked: false,
            result: null,
            ms: 0,
            log: streamLog(route.number),
            phases: {},
            declared: { ticket: route.number, branch: null, pr: null, phase: "A", handoff: null, stoodDown: true, why },
          });
        }
      }
      const at = route.resuming ? (route.phase ?? "C") : null;
      book.start(route.number, at ?? "A", RUN_ID);
      return runTicket(runSession, {
        number: route.number,
        branch,
        queue: route.queue,
        size: route.size,
        at,
        fix: Boolean(route.fix),
        retryCount: route.retryCount ?? 0,
        reason: route.reason ?? null,
        screen,
      });
    },
  };
  const ledger = {
    tally: (n) => ticketTally(n, readLedger()),
    rows: () => readLedger(),
    record: (row) => events.recorded(row, book.record(row, RUN_ID).bill),
    killed: () => {
      const last = killedStarts(readLedger(undefined, { starts: true }), lastWrite).at(-1);
      if (!last?.trailing) return null;
      book.killed(last, killedRun(last, logOf(last.n)));
      return last;
    },
    journal: (line) => appendSupervisor(line),
    logOf: (n) => logOf(n),
    prune: () => pruneLogs(),
  };
  return { tracker, workspace, session, ledger };
}

/** An interrupted run must not leave a half-drawn spinner under the shell prompt. */
function trapSignals(screen) {
  process.on("exit", () => screen.stop());
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      screen.stop();
      process.exit(130);
    });
  }
}

/**
 * The night, as a loop over `runOnce`.
 *
 * Every collaborator is a parameter with a real default rather than something this function
 * constructs, so a test drives the real loop: the counters are `decide()`'s, and what a pass does to
 * them is only seen here, across passes.
 *
 * @param {{screen?: object, book?: object, ports?: object, events?: object, install?: Function, runId?: string}} [deps]
 */
export async function main({
  screen = ticker(),
  book = openLedger({ loopSha: loopSha((...args) => gitAt(ROOT)(args)) }),
  ports = null,
  events = null,
  install = trapSignals,
  runId = RUN_ID,
  tick = 30_000,
} = {}) {
  /** `pinned` is the ticket a red CI round or a handoff handed back; its counts are the ledger's. */
  let loop = { failures: 0, holds: 0, waits: 0, overloads: 0, pinned: null, heldTicket: null, ticketHolds: 0 };

  /**
   * The ticket phase A has claimed, so a throw anywhere in the iteration can still release it.
   *
   * `runOnce`'s own exits all route through `park`, but a throw routes through none of them, and
   * an `in-progress` label nothing removes is a ticket `next-ticket.mjs` skips for good.
   * `runOnce` says which ticket its pick settled on, so that is where the answer is knowable.
   */
  let claimed = null;
  screen = journaled(screen, () => claimed, (line) => ports?.ledger.journal?.(line));
  install(screen);
  events ??= screenEvents(screen);
  ports ??= realPorts(book, screen, events);
  const { tracker, workspace, ledger } = ports;
  const killed = ledger.killed?.();
  if (killed) {
    screen.notice(
      "killed",
      `#${killed.n}'s phase ${killed.phase ?? "?"} session from ${new Date(killed.started).toISOString().slice(11, 16)}Z was killed after ${Math.round(killed.ms / 60_000)} min and left no row; recorded it as killed`,
    );
  }

  const startedAt = Date.now();
  const spent = { ci: 0, wait: 0 };
  const since = { ci: null, wait: null };
  const timed = async (kind, work) => {
    since[kind] = Date.now();
    try {
      return await work();
    } finally {
      spent[kind] += Date.now() - since[kind];
      since[kind] = null;
    }
  };
  const sofar = (kind) => spent[kind] + (since[kind] == null ? 0 : Date.now() - since[kind]);
  // Whatever the run was doing when the machine slept, the sleep comes out of that bucket.
  let asleepMs = 0;
  const clock = sleepClock(tick);
  const sleepWatch = setInterval(() => {
    const slept = clock.lap();
    const now = Date.now();
    asleepMs += slept;
    for (const kind of Object.keys(since)) if (since[kind] != null) since[kind] = Math.min(now, since[kind] + slept);
  }, tick);
  sleepWatch.unref();
  /** The Launch milestone's open count as the last picker run read it; null until one has. */
  let launch = null;
  let parity = null;
  // `utc` for the file: its title is RUN_ID, which is UTC.
  const recapOf = (t, utc = false) =>
    runRecap(
      {
        startedAt,
        now: Date.now(),
        totals: book.totals,
        tickets: book.tickets,
        ciMs: sofar("ci"),
        waitMs: sofar("wait"),
        asleepMs,
        launch,
        parity,
        utc,
        headroom: turnHeadroom(book.rows ?? []),
      },
      t,
    );
  screen.board?.({ recap: recapOf });

  const watched = {
    ...ports,
    tracker: {
      ...tracker,
      pick: () => {
        const route = tracker.pick();
        if (route?.queue) launch = route.queue.launch ?? null;
        return route;
      },
      settle: (pending) => timed("ci", () => tracker.settle(pending, screen)),
    },
  };
  const told = {
    ...events,
    picked: (n) => {
      claimed = n;
    },
  };

  /** Every exit writes the total to the report file, not only the screen. */
  const finish = (code, why) => {
    clearInterval(sleepWatch);
    const total = runTotal(book.totals);
    const t = screen.theme ?? PLAIN();
    if (why) {
      if (code === RESTART) screen.say(`restarting — ${why}`);
      else if (code === 0) screen.say(stepRow({ label: "stopped", detail: why, state: "skipped" }, t));
      else screen.notice("stopped", why);
    }
    const rule = t.paint("faint", "─".repeat(t.width));
    const tickets = book.tickets.map((r) => reportRow(r, t));
    screen.say([rule, ...recapOf(t), rule, ...(tickets.length ? [...tickets, rule] : []), `   ${t.paint("text", `run total  ${total}`, true)}`].join("\n"));
    book.close(runId, why ? `${total} · ${code === RESTART ? "restarting" : "stopped"}: ${why}` : total, recapOf(PLAIN(), true).join("\n"));
    if (code !== RESTART) bell();
    return code;
  };

  const hold = (ms, label, then) =>
    timed("wait", async () => {
      const { woken, say } = screen.wait(label, Date.now() + ms, then);
      const how = await holdFor(ms, workspace.stopFile, undefined, say, undefined, woken);
      screen.close();
      return how;
    });
  const queued = () => {
    const q = tracker.queue?.();
    return q ? ` · queue ${q.implement} to implement, ${q.triage} to triage` : "";
  };
  const record = (row) => {
    const { title, size } = tracker.facts(row.number);
    ledger.record({ title, size, ...row });
  };

  for (;;) {
    claimed = null;
    // Per iteration, not once per process: a run lasting past midnight would never prune.
    ledger.prune();
    parity = workspace.parity?.() ?? null;
    const rows = ledger.rows();
    screen.board?.({ typical: typicalMs(rows) });
    // From the ledger, not memory: the outage that failed a park outlasts any backoff, and a restart.
    for (const { n, steps } of pendingReparks(rows)) {
      const { failed, why: moot = null } = tracker.repark(n, steps);
      if (!moot && failed.length === steps.length) {
        screen.notice("park", `#${n}'s park has still not reached the tracker (${steps.join(", ")})`);
        continue;
      }
      const why = [moot ?? "the park reached the tracker", ...(failed.length ? [`still owed: ${failed.join(", ")}`] : [])].join(" — ");
      record({ number: n, outcome: "reparked", why, run: { result: null, ms: 0, log: streamLog(n), phases: {} }, parkFailed: failed.length ? failed : null });
      events.log(`#${n}: ${why}`, "park");
    }

    let pass;
    try {
      pass = await runOnce(watched, told, loop.pinned, loop.pinned ? ledger.tally(loop.pinned).lastHandoff : null, loop);
    } catch (err) {
      screen.warn(`queue-loop: the iteration threw — ${String(err?.stack ?? err)}`);
      // No row: there is no run to write one from, and an invented row is a ledger trusted while
      // wrong. The claim is the part that strands the ticket, and it comes off here.
      const own = claimed === null ? null : workspace.worktreeOf(claimed);
      const threw = decide({ step: "threw", route: claimed === null ? null : { n: claimed }, error: String(err?.message ?? err), own, loop, now: Date.now() });
      if (threw.kind === "park") {
        try {
          parkAndRecord({ tracker, events, record }, claimed, { ...own, phase: threw.phase, why: threw.why, log: streamLog(claimed) });
        } catch (unparked) {
          screen.notice("claim", `#${claimed} is still claimed — ${String(unparked?.message ?? unparked)}`);
        }
      }
      loop = threw.loop;
      if (threw.halt) return finish(1, threw.halt);
      continue;
    }
    loop = pass.loop;

    if (pass.outcome === "stop") return finish(pass.halt ? 1 : 0, pass.why);
    if (pass.outcome === "restart") return finish(RESTART, pass.why);

    // A pass that left the ticket standing was the park's to take, and `runOnce` took it; this one
    // ended the ticket first.
    if (pass.ticket != null && !PARKABLE.has(pass.outcome) && workspace.parkAsked(pass.ticket)) {
      workspace.clearParkAsk();
      screen.notice("park", `#${pass.ticket} ${pass.outcome} before the park could act`);
    }

    // None is a failure. A pre-flight the machine has to settle, a red whose CI-RED the tracker
    // would not take, a spent usage window, a failing API: each waits, then goes again — an exit
    // here costs every remaining ticket of an unattended night.
    const held = HOLDS[pass.outcome]?.(pass, loop, clockAt(Date.now() + (pass.hold ?? 0)));
    if (held) {
      screen.notice(held.label, held.line);
      if ((await hold(pass.hold, held.what, `${held.then}${queued()}`)) === "stopped") return finish(0, ".loop-stop during the wait");
      continue;
    }

    if (pass.halt) return finish(1, pass.halt);
  }
}

/**
 * `--check`: the reads a pass's pick makes, in the order `decide` asks for them, each printed as
 * `<fact>\t<json>`, then the pick's answer as `PICK\t<json>` — with nothing synced, claimed, pruned,
 * spawned or written. It runs the real ports' read wiring, which the loop's tests stub out.
 */
export function check({ say = console.log } = {}) {
  const reads = pickReads({
    workspace: { derive: () => derive({ ci: true }) },
    tracker: { facts: ticketFacts, pick: nextPick },
    ledger: { tally: (n) => ticketTally(n, readLedger()) },
  });
  const said = Object.fromEntries(
    Object.entries(reads).map(([fact, read]) => [
      fact,
      (action, picking) => {
        const value = read(action, picking);
        say(`${fact}\t${JSON.stringify(value)}`);
        return value;
      },
    ]),
  );
  const loop = { failures: 0, holds: 0, waits: 0, overloads: 0, pinned: null };
  const action = choose({ pinned: null, at: null, repicked: false }, said, (facts) =>
    decide({ now: Date.now(), asked: false, own: null, ...facts, step: "pick", loop }),
  );
  say(`PICK\t${JSON.stringify(action)}`);
}

if (isInvokedDirectly(process.argv[1], import.meta.url) && process.argv.includes("--check")) {
  check();
} else if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  // An unhandled rejection here would end the night with a one-line node trace and no exit status,
  // in the one process whose job is to say what happened.
  main({})
    .catch((err) => {
      console.error(`queue-loop: stopped by an unhandled error — ${err?.stack ?? err}`);
      return 1;
    })
    .then((code) => process.exit(code));
}
