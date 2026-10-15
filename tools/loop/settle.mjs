/**
 * Settles a pushed pull request: waits on its `CI gate`, arms GitHub's auto-merge on a green head
 * that review cleared, and reruns a red once before handing it back.
 *
 * `stepSettle` is the state machine, pure: one read of the pull request in, the effects to run and
 * the next state out. `runSettle` is the executor that reads, runs those effects through its ports
 * and sleeps between reads. The judgement on each read is `decide.mjs`'s `landing` step.
 *
 * **Armed is a state no session may push into.** GitHub merges whatever head carries the arm once
 * the gate passes, so every exit but the merge disarms first, and a red is disarmed before its
 * CI-RED is posted — that comment is what starts a fix round, here or after a restart.
 */
import fs, { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { firstLine, gh as ghCli, git as gitAt, REPO } from "./cli.mjs";
import { ciRedPosted, trustedComments } from "./loop-derive.mjs";
import { readLine } from "./loop-stream.mjs";
import { ciLine } from "./loop-render.mjs";
import { DIR, ciLogPath, ciRedNotePath, streamLog } from "./loop-logs.mjs";
import { landable, reviewerRan } from "./loop-gate.mjs";
import { REFRESH_TIMEOUT_MS, sleepClock } from "./limits.mjs";
import { decide } from "./decide.mjs";

// Loaded on use: a static .ts import plus process.exit aborts node on Windows (nodejs/node#56645).
const ts = (file) => createRequire(import.meta.url)(file);

/**
 * The supervisor's half has no watchdog over it — `runTicket`'s watches the child and is cleared
 * when the child closes — so `settle` as a whole is bounded here instead, and a branch that keeps
 * asking for one more round cannot hold the night open. Each individual `gh` call carries its own
 * ceiling in `ciVerdict.ts`'s `ghExecOptions`, which is where the one that can block lives.
 */
export const SETTLE = { DEADLINE_MS: 90 * 60_000, STUCK_MS: 3 * 60_000 };

/** Each update-branch is a new head, which restarts the deadline: without a cap, a busy main never lets it run out. */
export const UPDATES = 3;

/** Bounds each `gh` call settling makes, so a wedged one cannot stall the supervisor. */
export const CI_RED_TIMEOUT_MS = 30_000;

/** How many times a hand-back reads the tracker and posts a CI-RED before it holds the red. */
const CI_RED_TRIES = 3;

/** A `gh` failure that is the network's, not GitHub's answer: `execFileSync` puts it in `stderr` or `code`. */
const OFFLINE = /error connecting to|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|i\/o timeout|TLS handshake timeout/i;

const sha7 = (sha) => String(sha).slice(0, 7);

/**
 * @param {{at: number, deadline: number, stuckMs?: number, pr: number, ledgered?: {head: string, runId: number, tests?: string[], step?: string|null}|null}} start
 *   `ledgered` is the flake a process that armed on a rerun's green and then stopped left in the ledger
 */
export function startSettle({ at, deadline, stuckMs = SETTLE.STUCK_MS, pr, ledgered = null }) {
  return {
    pr,
    deadline,
    stuckMs,
    ledgered,
    until: at + deadline,
    stuckSince: at,
    seen: null,
    woke: false,
    head: null,
    armed: false,
    armedAt: null,
    reran: null,
    firstRed: null,
    flake: null,
    updates: 0,
    last: null,
    ci: {},
  };
}

/** Only the pause is measured for a standby: a `gh` call that took long is real time and counts. */
export const rested = (state, slept) => ({
  ...state,
  until: state.until + slept,
  stuckSince: state.stuckSince + slept,
  woke: state.woke || slept > 0,
});

/** True when the read at `at` would come past the deadline, so the executor does not take it. */
export const overdueAt = (state, at) => at > state.until;

const ownerOut = (s, reason) => ({ action: "owner", reason, runId: s.ci.runId ?? null, head: s.head, ...(s.flake && { flake: s.flake }) });

/**
 * A verdict into its outcome and the effects that must run first. `end` is `{action, reason}`, and a
 * hand-back's carries `next`, `landing()`'s answer. An effect that fails can end the settle too: the
 * executor brings its `end` back here, with the state the step left.
 *
 * @returns {{state: object, effects: object[], outcome: object}}
 */
export function endSettle(state, end) {
  const s = { ...state };
  const effects = [];
  const disarm = (then) => {
    if (!s.armed) return;
    effects.push({ do: "disarm", then });
    // A disarm that fails ends the settle, so the rest of the list may count it done.
    s.armed = false;
  };
  if (end.action === "hand-back") {
    disarm(end.next.reason);
    effects.push({ do: "post-red", ci: s.ci, head: s.head });
    return { state: s, effects, outcome: { ...end.next, head: s.head, runId: s.ci.runId ?? null } };
  }
  if (end.action === "hold") return { state: s, effects, outcome: { action: "hold", reason: end.reason, head: s.head, runId: s.ci.runId ?? null } };
  if (end.action === "already-merged") {
    // The merged branch is GitHub's to delete: `deleteBranchOnMerge.test.ts` pins the repository setting.
    const l = s.ledgered;
    if (!s.flake && l && l.head === s.head) s.flake = { runId: l.runId, tests: l.tests ?? [], step: l.step ?? null };
    if (s.flake) effects.push({ do: "file-flakes", red: s.flake });
    return { state: s, effects, outcome: { action: "already-merged", reason: end.reason, ...(s.flake && { flake: s.flake }) } };
  }
  disarm(end.reason);
  return { state: s, effects, outcome: ownerOut(s, end.reason) };
}

/**
 * One read of the pull request: `read` is `{at, landing}` (`readLandingState`'s answer), `{at, error}`
 * (what that read threw), or `{at}` alone when it was past the deadline and not taken. A step that
 * needs to know whether review cleared the head returns `{ask: "cleared", head}` and no effects:
 * step the same state again with the answer as `read.cleared`.
 *
 * @returns {{state: object, effects: object[], outcome?: object, ask?: "cleared", head?: string|null}}
 */
export function stepSettle(state, read) {
  const s = { ...state };
  const effects = [];
  const log = (line) => effects.push({ do: "log", line });
  let next = null;
  let error = null;
  const overdue = overdueAt(s, read.at);
  if (!overdue && read.error) {
    s.seen = null;
    const err = read.error;
    // A machine waking from standby has no network for minutes to hours; the deadline still bounds it.
    error = { why: firstLine(err), offline: OFFLINE.test(`${err.code ?? ""} ${err.message} ${err.stderr ?? ""}`), woke: s.woke };
  } else if (!overdue) {
    let { pr, ci } = read.landing;
    s.ci = ci;
    s.armed = pr.armed === true;
    if (pr.headRefOid !== s.head) {
      s.head = pr.headRefOid ?? null;
      s.until = read.at + s.deadline;
    }
    if (ci.progress) log(ciLine(s.pr, ci.progress));
    // `--match-head-commit` is checked when GitHub arms, not again when it merges: an arm outlives
    // no head but the one cleared. An arm this process did not make is treated the same way.
    if (s.armed && s.armedAt !== s.head) {
      effects.push({ do: "disarm", then: `the head moved to ${sha7(s.head)} under the arm` });
      s.armed = false;
      pr = { ...pr, armed: false };
    }
    next = ts("./land.ts").landing(pr, ci);
    s.woke = false;
    const seen = JSON.stringify([s.head, ci.runId, ci.attempt, ci.reason, pr.mergeStateStatus, pr.mergeable]);
    if (seen !== s.seen) [s.seen, s.stuckSince] = [seen, read.at];
  }
  // Landing reads move no run counter.
  const stuck = read.at - s.stuckSince >= s.stuckMs;
  const facts = { ...next, head: s.head, armed: s.armed, overdue, deadline: s.deadline, updates: s.updates, last: s.last, stuck, ci: s.ci, error, reran: s.reran, cleared: read.cleared };
  const step = decide({ step: "landing", limits: { UPDATES }, loop: {}, landing: facts });
  if (step.kind === "ask") return { state, effects: [], ask: "cleared", head: s.head };

  if (step.kind === "settled") {
    if (step.action === "hand-back") return withEffects(effects, endSettle(s, { action: "hand-back", next }));
    if (step.action === "owner" || step.action === "already-merged") return withEffects(effects, endSettle(s, { action: step.action, reason: step.why }));
    return { state: s, effects, outcome: next };
  }
  s.last = step.why;
  if (step.act === "rerun") {
    s.reran = s.head;
    s.firstRed = { runId: s.ci.runId, tests: s.ci.testIds ?? [], step: s.ci.failedStep ?? null };
    effects.push({ do: "rerun", runId: s.ci.runId, next });
    s.until = read.at + s.deadline;
  } else if (step.act === "update-branch") {
    // The merge of main is a new head nobody cleared, and an arm would carry over to it.
    if (s.armed) effects.push({ do: "disarm", then: next.reason });
    s.armed = false;
    log(step.why);
    s.updates += 1;
    effects.push({ do: "update-branch" });
  } else if (step.act === "arm") {
    // A green this process's rerun won: named in the merge and on the row; filed once it has merged.
    if (s.reran === s.head && s.firstRed && !s.flake) {
      s.flake = s.firstRed;
      effects.push({ do: "note-flake", flake: { ...s.flake, head: s.head } });
    }
    effects.push({ do: "arm", head: s.head, flake: s.flake });
    // An arm whose answer was lost may have taken effect, so every way out disarms from here on.
    s.armed = "maybe";
    s.armedAt = s.head;
  }
  if (step.act === "rerun" || step.act === "wait") log(step.why);
  return { state: s, effects };
}

const withEffects = (before, ended) => ({ ...ended, effects: [...before, ...ended.effects] });

/** The fenced excerpt's ceiling, for the failures that parse as no test id at all. */
const EXCERPT_LINES = 8;

/** The distinct files behind a run's failing ids — the fix rounds the branch owes. */
export const failingFiles = (testIds) => [...new Set(testIds.map((id) => id.split(" › ")[0]))];

/**
 * The CI-RED comment's exact shape, so `ciRedRounds` can count it and a fix round can find the
 * failure. Not a summary of the failure: the reference to it, because every budget that tried to
 * fit one into a comment dropped the part that mattered. `onMain` and `flaky` are `onMainLine`'s answers.
 *
 * @param {{sha: string, runUrl: string, failedStep?: string, testIds?: string[], excerpt?: string,
 *   onMain?: string, flaky?: string, runId?: number, logArgs?: string[], reason?: string, attempt?: number}} args
 */
export function ciRedBody({ sha, runUrl, failedStep, testIds = [], excerpt = "", onMain = "none", flaky = "none", runId, logArgs, reason, attempt }) {
  const files = failingFiles(testIds);
  // A count of zero would be a target a round meets by diagnosing nothing, so a step whose output
  // parses as no test id says that instead of stating one.
  const body = [
    `CI-RED ${sha}`,
    `run: ${runUrl} · step: ${failedStep ?? "an unnamed step"}`,
    ...(reason ? [`why: ${reason}`] : []),
    files.length
      ? `failing: ${files.length} failing files, ${testIds.length} tests — read them, do not guess:`
      : "failing: no test id parsed — this step's own output is the count. Read the run:",
    "```sh",
    `gh ${logArgs?.join(" ") ?? `run view ${runId} --log-failed`} | grep -E "✖|AssertionError|error TS|FAIL " -A5`,
    "```",
    ...files.map((f) => `- ${f}`),
    `on main: ${onMain}`,
    ...(flaky === "none" ? [] : [`flaky on main: ${flaky}`]),
    // A rerun the supervisor could not start leaves attempt 1: that red was never asked twice.
    `rerun: ${attempt > 1 ? "survived one" : "none"}`,
  ];
  if (files.length === 0) body.push("```", ...excerpt.split("\n").slice(-EXCERPT_LINES), "```");
  return body.join("\n");
}

/**
 * @param {string[]} failing the red head's test ids
 * @param {{url?: string, ids: string[], flaky?: boolean}|null} main `mainFailures()`'s answer
 */
export function onMainLine(failing, main) {
  const onMain = new Set(main?.ids ?? []);
  const ids = failing.filter((id) => onMain.has(id));
  if (!main || ids.length === 0) return "none";
  const how = main.flaky ? "failed attempt 1 of main's rerun-won green" : "also fail on main";
  return `${ids.length} of ${failing.length} ${how} (${main.url ?? "main's latest run"}): ${ids.join(", ")}`;
}

/** What a red a rerun turned green failed on, one name per issue: its tests, or its step when it named none. */
const flakeNames = ({ tests, step }) => (tests.length ? tests : [`${step ?? "an unnamed step"} (no test named)`]);

const FLAKES_PER_RUN = 3;

/** Bounds what a merge message or an issue body lists: a starved runner fails hundreds. */
const FLAKES_LISTED = 20;

const listed = (names) =>
  (names.length > FLAKES_LISTED ? [...names.slice(0, FLAKES_LISTED), `and ${names.length - FLAKES_LISTED} more`] : names).map((n) => `- ${n}`);

/**
 * The ports `runSettle` acts through; `io` overrides any of them. `run` is `cli.mjs`'s `gh` and
 * `git`, called as `run(file, args, opts)`; `stateOf` is `readLandingState`; `cleared` asks whether
 * review cleared a head; `sleep` waits out the pause and resolves to the time a standby added to it.
 */
function settlePorts(pending, log, pause, io) {
  const run = io.run ?? ((file, args, opts = {}) => (file === "git" ? gitAt(opts.cwd)(args, opts) : ghCli(args, opts)));
  const facts = io.facts ?? (() => streamFacts(pending.ticket));
  const ports = {
    run,
    gh: (args) => run("gh", args, { timeout: CI_RED_TIMEOUT_MS }),
    stateOf: io.stateOf ?? ((pr) => ts("./ciVerdict.ts").readLandingState(REPO, pr)),
    write: io.write ?? writeFileSync,
    mkdir: io.mkdir ?? mkdirSync,
    mainFailures: io.mainFailures ?? (() => ts("./mainHealth.ts").mainFailures((args) => run("gh", args, { timeout: CI_RED_TIMEOUT_MS }), REPO)),
    noteArmed: io.noteArmed ?? pending.noteArmed,
    now: io.now ?? (() => Date.now()),
    sleep:
      io.sleep ??
      (async () => {
        const clock = sleepClock(pause);
        // Not unref'd, for the same reason `holdFor` is not: this is the only handle open while it waits.
        await new Promise((r) => setTimeout(r, pause));
        return clock.lap();
      }),
    log,
  };
  ports.cleared =
    io.cleared ??
    ((sha) => {
      const comments = readTicketComments(pending.ticket, ports);
      try {
        run("git", ["fetch", "--quiet", "origin", pending.branch, "main"], { timeout: REFRESH_TIMEOUT_MS });
      } catch (err) {
        return { ok: false, why: `could not fetch ${pending.branch} — ${firstLine(err)}` };
      }
      const v = landable(comments, sha, (args) => run("git", args).trim());
      if (!v.ok || reviewerRan(facts(), pending.ticket)) return v;
      return { ok: false, why: `no loop-review or loop-fix completed for #${pending.ticket} since its last build` };
    });
  return ports;
}

function streamFacts(ticket) {
  const file = streamLog(ticket);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").map(readLine).filter(Boolean) : [];
}

/** Null when the tracker cannot be read, which is a reason to skip posting, never to post blind. */
function readTicketComments(ticket, { gh, log }) {
  try {
    return trustedComments(JSON.parse(gh(["issue", "view", String(ticket), "--json", "comments"])).comments);
  } catch (err) {
    log(`CI-RED: could not read the tracker — ${firstLine(err)}`);
    return null;
  }
}

/**
 * Posted once per red head, checked against the tracker rather than a local marker: the fix
 * session may run on another machine, or after a restart, and reads only the tracker.
 *
 * @returns {boolean} whether the tracker carries it now
 */
function postCiRedOnce(ticket, ci, { onMain, flaky }, comments, { gh, write, log }) {
  const sha = ci.head;
  if (!comments) return false;
  if (!sha || ciRedPosted(comments, sha)) return true;
  const body = ciRedBody({
    sha,
    runUrl: `https://github.com/${REPO}/actions/runs/${ci.runId}`,
    failedStep: ci.failedStep,
    testIds: ci.testIds ?? [],
    excerpt: ci.output,
    onMain,
    flaky,
    runId: ci.runId,
    logArgs: ci.logArgs,
    reason: ci.reason,
    attempt: ci.attempt,
  });
  try {
    const file = ciRedNotePath(ticket);
    write(file, body, "utf8");
    gh(["issue", "comment", String(ticket), "--body-file", file]);
    return true;
  } catch (err) {
    log(`CI-RED: could not post — ${firstLine(err)}`);
    return false;
  }
}

/**
 * The CI log a fix round reads, written before the red is handed back: that session is a fresh
 * process with no way to ask this one anything. Then the `on main:` lines its CI-RED carries.
 * Never call it when `output` is the reason rather than the log: round one's real failure is
 * already in that file, and this would paint over it.
 */
function prepareRed(ticket, ci, { mkdir, write, mainFailures, log }) {
  try {
    mkdir(DIR, { recursive: true });
    write(ciLogPath(ticket), ci.output, "utf8");
  } catch (err) {
    log(`CI-RED: could not write the CI log — ${firstLine(err)}`);
  }
  const failing = ci.testIds ?? [];
  const main = failing.length ? mainFailures() : null;
  return { onMain: onMainLine(failing, main?.flaky ? null : main), flaky: onMainLine(failing, main?.flaky ? main : null) };
}

/** The merge message's body, written to a file: an inline argument has no bound. */
function flakeMergeFile(red, ticket, write) {
  const file = path.join(DIR, `flake-merge-${ticket}.md`);
  write(file, [`Merged on a rerun's green: attempt 1 of ci.yml run ${red.runId} failed`, ...listed(flakeNames(red))].join("\n"), "utf8");
  return file;
}

/**
 * One open issue per flaky test, found by its exact title in a listing of every open issue: GitHub's
 * search trails its own writes, and promoting one swaps its label. `ready-for-human`, not
 * `ci-flake`: ADR 0011 keeps that label, and the rank it carries, the owner's to add.
 */
function fileFlakes(red, { gh, log, write }) {
  let open;
  try {
    open = JSON.parse(gh(["issue", "list", "--repo", REPO, "--state", "open", "--limit", "1000", "--json", "number,title"]));
  } catch (err) {
    log(`could not list the open flake issues — ${firstLine(err)}; the merge and the ledger still name it`);
    return;
  }
  const names = flakeNames(red);
  // More reds than this cleared by one rerun reads as a starved runner, and it bounds the `gh` calls.
  const titles = names.length > FLAKES_PER_RUN ? [`CI flake: ${names.length} tests in run ${red.runId}`] : names.map((n) => `CI flake: ${n}`);
  for (const title of titles) {
    if (open.some((i) => i.title === title)) continue;
    const body = [
      `Attempt 1 of https://github.com/${REPO}/actions/runs/${red.runId} failed ${titles.length < names.length ? "these" : "this"}; its rerun went green and #${red.pr} (ticket #${red.ticket}) merged on that green.`,
      ...(titles.length < names.length ? ["", ...listed(names)] : []),
      "",
      "Filed by the supervisor (`tools/loop/settle.mjs`). The title is what stops a second issue for the same failure, so keep it.",
    ].join("\n");
    try {
      const file = path.join(DIR, `flake-issue-${red.ticket}.md`);
      write(file, body, "utf8");
      gh(["issue", "create", "--repo", REPO, "--title", title, "--body-file", file, "--label", "ready-for-human"]);
      log(`filed ${title}`);
    } catch (err) {
      log(`could not file ${title} — ${firstLine(err)}`);
    }
  }
}

/**
 * Runs one effect. Undefined when the list goes on; an `end` (`endSettle`'s input) when it ended
 * the settle instead.
 */
async function perform(effect, pending, ports) {
  const { gh, log } = ports;
  const { armArgs, disarmArgs } = ts("./land.ts");
  switch (effect.do) {
    case "log":
      log(effect.line);
      return;
    // A refusal is asked about: GitHub refuses to disarm what never armed, and what already merged.
    case "disarm":
      try {
        gh(disarmArgs(REPO, pending.pr));
        return;
      } catch (err) {
        try {
          const now = ports.stateOf(pending.pr).pr;
          if (now.state === "MERGED") return { action: "already-merged", reason: "the pull request merged before it could be disarmed" };
          if (now.armed !== true) return;
        } catch {
          // Unread is not unarmed.
        }
        return { action: "owner", reason: `could not disarm auto-merge — ${firstLine(err)}; it may still merge${effect.then ? ` — ${effect.then}` : ""}` };
      }
    case "rerun":
      try {
        gh(["run", "rerun", String(effect.runId), "--failed", "--repo", REPO]);
        return;
      } catch (err) {
        log(`could not rerun ${effect.runId} — ${firstLine(err)}; handing the red back`);
        return { action: "hand-back", next: effect.next };
      }
    case "update-branch":
      try {
        gh(["pr", "update-branch", String(pending.pr)]);
        return;
      } catch (err) {
        return { action: "owner", reason: `could not update the branch — ${firstLine(err)}` };
      }
    case "note-flake":
      try {
        ports.noteArmed?.(effect.flake);
      } catch (err) {
        log(`could not ledger the flake before arming — ${firstLine(err)}`);
      }
      return;
    case "arm": {
      const at = String(effect.head ?? "an unread head").slice(0, 7);
      let message;
      try {
        if (effect.flake) {
          ports.mkdir(DIR, { recursive: true });
          message = flakeMergeFile(effect.flake, pending.ticket, ports.write);
        }
      } catch (err) {
        log(`could not write the flake into the merge message — ${firstLine(err)}`);
      }
      const argv = armArgs(REPO, pending.pr, effect.head, message);
      try {
        gh(argv);
        log(`auto-merge armed at ${at}`);
      } catch (err) {
        // GitHub refuses `--auto` where auto-merge is off or the head is already mergeable; the
        // gate is green here, and `--match-head-commit` still binds the merge to the cleared head.
        log(`could not arm auto-merge — ${firstLine(err)}; merging ${at} directly`);
        try {
          gh(argv.filter((a) => a !== "--auto"));
        } catch (again) {
          return { action: "owner", reason: `the merge failed — ${firstLine(again)}` };
        }
      }
      return;
    }
    case "post-red": {
      const lines = prepareRed(pending.ticket, effect.ci, ports);
      for (let tries = 1; !postCiRedOnce(pending.ticket, effect.ci, lines, readTicketComments(pending.ticket, ports), ports); tries++) {
        // A hand-back without its CI-RED is a fix round nothing starts; a hold leaves the red for the next pick to read.
        if (tries === CI_RED_TRIES) return { action: "hold", reason: `CI-RED for ${sha7(effect.head)} could not be posted` };
        await ports.sleep();
      }
      return;
    }
    case "file-flakes":
      fileFlakes({ ...effect.red, ticket: pending.ticket, pr: pending.pr }, ports);
      return;
    default:
      throw new Error(`settle has no effect called ${effect.do}`);
  }
}

/**
 * The executor: reads the pull request, steps, runs the step's effects, and sleeps, until a step
 * settles. `pending` is `{ticket, pr, branch, flake?, noteArmed?}`; `io` overrides `settlePorts`'.
 */
export async function runSettle(pending, log, pause, deadline, io = {}) {
  const ports = settlePorts(pending, log, pause, io);
  let state = startSettle({ at: ports.now(), deadline, stuckMs: io.stuckMs, pr: pending.pr, ledgered: pending.flake ?? null });
  for (;;) {
    const read = { at: ports.now() };
    if (!overdueAt(state, read.at)) {
      try {
        read.landing = ports.stateOf(pending.pr);
      } catch (err) {
        read.error = err;
      }
    }
    let step = stepSettle(state, read);
    if (step.ask) step = stepSettle(state, { ...read, cleared: ports.cleared(step.head) });
    let { effects, outcome } = step;
    state = step.state;
    for (let i = 0; i < effects.length; i++) {
      const end = await perform(effects[i], pending, ports);
      if (!end) continue;
      ({ state, effects, outcome } = endSettle(state, end));
      i = -1;
    }
    if (outcome) return outcome;
    state = rested(state, await ports.sleep());
  }
}
