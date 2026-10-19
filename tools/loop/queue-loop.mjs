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
import { execFileSync } from "node:child_process";
import fs, { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gh as ghCli, git as gitAt, MAX_BUFFER, REPO } from "./cli.mjs";
import {
  ciRedRounds,
  derive,
  parityRed,
  reviewRounds,
  WORKTREE_DIR,
} from "./loop-derive.mjs";
import { runSession } from "./loop-session.mjs";
import { spawnEnv } from "./session-env.mjs";
import { readLine, reduceSession, sessionStart } from "./loop-stream.mjs";
import {
  act,
  bell,
  clockAt,
  closing,
  header,
  LAND,
  note,
  recap,
  PLAIN,
  reportRow,
  runRecap,
  runTotal,
  stepRow,
  tasksDetail,
  thought,
  UNNAMED,
} from "./loop-render.mjs";
import { PARK_FILE, parkAsked, STOP_FILE, ticker } from "./loop-screen.mjs";
import {
  DIR,
  ciLogPath,
  appendSupervisor,
  errorLine,
  errorOf,
  killedStarts,
  lastWrite,
  leftoverPath,
  ledgerPath,
  ledger as openLedger,
  conflictNotePath,
  parkNotePath,
  pendingReparks,
  prune as pruneLogs,
  readLedger,
  streamLog,
  ticketTally,
  typicalMs,
} from "./loop-logs.mjs";
import { checkLockDrift, housekeeping, listWorktreeDirNames } from "./workspace.mjs";
import { buildReady, MAX_REVIEW_ROUNDS } from "./loop-gate.mjs";
import { branchOf } from "./claim.mjs";
import { ghTracker } from "./tracker.mjs";
import {
  CONTEXT_BY_SIZE,
  CONTEXT_DEFAULT,
  EFFORT_BY_PHASE,
  estimateCost,
  MODEL_BY_PHASE,
  TICKET_BUDGET_USD,
  TURNS_BY_SIZE,
  TURNS_DEFAULT,
  turnHeadroom,
  USD_BY_SIZE,
  USD_DEFAULT,
} from "./loop-cost.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { CHECK_BASH_TIMEOUT_MS, REFRESH_TIMEOUT_MS, STALL_MS, sleepClock } from "./limits.mjs";
import { nextPick, OWNER_LABELS } from "./next-ticket.mjs";
import { afterSession, decide, WAIT } from "./decide.mjs";
import { CI_RED_TIMEOUT_MS, runSettle, SETTLE, UPDATES } from "./settle.mjs";

// Spawning a sibling by its own directory, not the cwd: the supervisor runs from the repo root,
// but nothing guarantees that, and the sibling is beside this file either way.
const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..", "..");

/**
 * @param {string[]|null} [labels] the live ticket's labels, null when the tracker could not say
 * @returns {{skill: string, number: number, title: string, phase?: string, resuming: boolean}|null}
 */
export function liveRoute(status, labels = null) {
  // locateRun refuses to guess between two live ticket worktrees: returning null here would read
  // as "no run is live", and the picker would take a third.
  if (status.ambiguous)
    return {
      skill: "ambiguous",
      number: 0,
      title: status.why ?? "more than one live worktree",
      resuming: false,
    };
  if (!status.onTicket || !status.ticket) return null;
  if (labels && !labels.includes("in-progress")) return null;
  return {
    skill: "implement",
    number: status.ticket,
    title: status.branch ?? `ticket #${status.ticket}`,
    // A resumed session re-emits no marker for a phase it has already passed.
    phase: status.phase && status.phase !== "?" ? status.phase : "C",
    resuming: true,
  };
}

/**
 * `pinned` is a ticket the run is not finished with — a red CI round hands the same number back,
 * and letting the picker choose again leaves that one labelled `in-progress` with an open pull
 * request nothing will return to.
 *
 * A resumed route carries the ticket's size, or `TURNS_BY_SIZE` falls through to the default and
 * bounds the second attempt tighter than the one that already failed to finish.
 *
 * A pushed head's own reading — CI to settle, or a red run to fix — outranks a handoff the ledger
 * still holds from before the push.
 *
 * @param {number|null} [pinned]
 */
export function nextRoute(
  pinned = null,
  at = null,
  {
    read = derive,
    facts = ticketFacts,
    ledger = readLedger,
    picker = nextPick,
  } = {},
) {
  const status = read({ ci: true });
  const known = status.onTicket && status.ticket ? facts(status.ticket) : null;
  if (known?.state === "CLOSED") {
    return { skill: "closed", number: status.ticket, title: known.title, cwd: status.cwd ?? null, resuming: true, queue: null };
  }
  const live = liveRoute(status, known?.labels ?? null);
  if (live) {
    const tally = ticketTally(live.number, ledger());
    // A red with no CI-RED is G's too: `runSettle` posts it, once per head, before it hands the red back.
    const fix = Boolean(status.fix);
    const handed = at ?? (fix ? "C" : null) ?? tally.lastHandoff;
    const settles = live.phase === "G" && status.ci?.pushed === true;
    const derived = live.phase === "G" ? "E" : live.phase;
    // A LAND on this head ends the review the handoff was for; D lands its own, so no row says E.
    const phase = settles ? "G" : handed === "D" && derived === "E" ? "E" : (handed ?? derived);
    return {
      ...live,
      title: known?.title ?? live.title,
      reviewRounds: status.reviewRounds ?? null,
      phase,
      fix: fix && phase !== "G",
      head: status.ci?.sha ?? status.head ?? null,
      cwd: status.cwd ?? null,
      branch: status.branch ?? null,
      dirty: status.dirty ?? false,
      size: known?.size ?? null,
      ciRounds: known?.ciRounds ?? 0,
      queue: null,
    };
  }
  if (pinned) {
    const { title, size, ciRounds, labels } = facts(pinned);
    // A handoff here would stop the run over one ticket the owner took back; the picker decides.
    // `ready-for-agent` alone is still ours: an API failure before phase A's claim holds it pinned.
    const released =
      labels &&
      (labels.some((l) => OWNER_LABELS.has(l)) || !labels.some((l) => l === "in-progress" || l === "ready-for-agent"));
    if (!released) return { skill: "implement", number: pinned, title, size, ciRounds, queue: null, resuming: true, phase: "A", branch: branchOf(pinned, title) };
  }
  return { ...picker(), resuming: false };
}

/** @param {string|null} [size] a `size:*` label, or null */
export const turnsFor = (size) => TURNS_BY_SIZE[size ?? ""] ?? TURNS_DEFAULT;

/** @param {string|null} [size] a `size:*` label, or null */
export const contextFor = (size) => CONTEXT_BY_SIZE[size ?? ""] ?? CONTEXT_DEFAULT;

/** @param {string|null} [phase] */
const plannedModel = (phase) => MODEL_BY_PHASE[phase ?? "A"] ?? MODEL_BY_PHASE.A;

/**
 * `queue.md`'s `allowed-tools` frontmatter governs permission, not what is loaded, so a session
 * declaring ten tools still carries every tool the build has — about 876 tokens each, measured.
 * Passing the same list as `--tools` makes the declaration mean what it looks like it means.
 */
export function allowedTools(text) {
  const m = /^allowed-tools:\s*(.+)$/m.exec(text);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const SETTINGS_FILE = path.join(HERE, "loop-settings.json");
const RESULT_SCHEMA = JSON.stringify(JSON.parse(fs.readFileSync(path.join(HERE, "result-schema.json"), "utf8")));

/**
 * @param {number} number
 * @param {string|null} [size] a `size:*` label, or null
 * @param {string|null} [phase] the phase the session resumes at, null for a fresh one
 */
export function queueLoopArgs(number, size = null, phase = null) {
  return [
    "-p",
    `/queue ${number}`,
    "--permission-mode",
    "auto",
    "--strict-mcp-config",
    "--output-format",
    "stream-json",
    // Print mode refuses stream-json without it: "Error: When using --print,
    // --output-format=stream-json requires --verbose".
    "--verbose",
    "--include-hook-events",
    // Without it a fresh process reuses ~8k of a ~33k prefix even from an identical twin (2.1.274).
    // With it the twin reuses all of it — once the git status is gone too (the env below) and the
    // startup hook says nothing (loop-status.mjs), since both land ahead of the static rest.
    "--exclude-dynamic-system-prompt-sections",
    // Plugins no protocol file names: 83 skills become 66, and the prefix every turn re-reads
    // loses 2.3k. The prompt itself cannot move later — the ticket number is what stops a second pick.
    "--settings",
    SETTINGS_FILE,
    "--setting-sources",
    "project",
    "--tools",
    allowedTools(fs.readFileSync(".claude/commands/queue.md", "utf8")).join(","),
    "--json-schema",
    RESULT_SCHEMA,
    "--max-turns",
    String(turnsFor(size)),
    "--max-budget-usd",
    TICKET_BUDGET_USD,
    "--model",
    plannedModel(phase),
    "--effort",
    EFFORT_BY_PHASE[phase ?? "A"] ?? EFFORT_BY_PHASE.A,
  ];
}

// The session and the loop read these from the shared checkout, not from the ticket's worktree.
const PROTOCOL = ["CLAUDE.md", ".claude", "tools/loop", "scripts/lib"];

function peerWorktrees(dir = WORKTREE_DIR) {
  return listWorktreeDirNames(dir).filter((name) => name.startsWith("agent-"));
}

const mtime = (file) => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : null);
const DRIFT_MARK = "node_modules/.loop-drift-reinstalled";

/**
 * npm's hidden lockfile, which every install writes after reading `package-lock.json`: a lockfile
 * newer than it is one no install has run against. The drift mark names the lockfile a drift
 * reinstall already ran for, so drift that `npm ci` cannot cure costs one install, not one a pass.
 */
const defaultStamp = {
  lockfile: () => mtime("package-lock.json"),
  installed: () => mtime("node_modules/.package-lock.json"),
  stored: () => (fs.existsSync(DRIFT_MARK) ? fs.readFileSync(DRIFT_MARK, "utf8").trim() : null),
  write: (lock) => writeFileSync(DRIFT_MARK, lock),
  peers: peerWorktrees,
  drifted: () => checkLockDrift(".").length > 0,
};

/** Captured, not inherited: npm's own report would draw over the board. A failure still carries it. */
export const reinstall = (run = sh) => run("npm", ["ci", "--no-audit", "--no-fund"]);

/**
 * Leaves the shared checkout on an up-to-date `main`, or refuses and says why.
 *
 * It asks whether the protocol files are *dirty*, not whether they differ from `origin/main`.
 * Those are different questions: the loop's own tickets edit its own code, so the moment one
 * merges the checkout differs from origin until it is fast-forwarded — which is staleness,
 * repaired here rather than reported. Only an uncommitted edit is drift, and it belongs to someone.
 *
 * @param {{lockfile: () => number|null, installed: () => number|null, stored: () => string|null,
 *   write: (lock: string) => void, peers: () => string[], drifted: () => boolean}} [stamp]
 * @param {number|null} [pinned] the ticket whose own worktree, if any, is not another session
 */
export function syncCheckout(
  git,
  log,
  install = reinstall,
  { stamp = defaultStamp, pinned = /** @type {number|null} */ (null) } = {},
) {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").trim();
  if (branch === "HEAD") {
    log("the shared checkout is on a detached HEAD — put it back on main first.");
    return false;
  }

  const dirty = git("status", "--porcelain", "--", ...PROTOCOL).trim();
  if (dirty) {
    // One call, not one per file: the caller renders a message as a row and its note, and a line at
    // a time gives each file a row of its own with nothing in the column that says what they are.
    log(
      `the protocol files here have uncommitted edits:\n${dirty}\n` +
        `Commit them, or put them somewhere else. Nothing here will discard them.`,
    );
    return false;
  }

  if (branch !== "main") {
    const own = Number(git("rev-list", "--count", "origin/main..HEAD").trim()) || 0;
    if (own > 0) {
      log(`${branch} is checked out with ${own} commit(s) of its own — not moving it.`);
      return false;
    }
    try {
      git("checkout", "main");
    } catch (err) {
      log(`cannot return to main — ${String(err.message).split("\n")[0]}`);
      return false;
    }
  }

  try {
    git("fetch", "origin", "--quiet");
    git("merge", "--ff-only", "origin/main");
  } catch (err) {
    log(`cannot fast-forward main — ${String(err.message).split("\n")[0]}`);
    return false;
  }

  // Keyed on what was installed, not the fast-forward's own diff: a diff seen once and skipped
  // for a live peer is gone for good, so a worktree standing at merge time must not cost the loop
  // its only chance to notice. `housekeeping` refuses to start a ticket on top of a drifted install,
  // so leaving the repair to the next iteration is the loop poisoning its own precondition. It
  // runs only when no *other* ticket's worktree is standing: every worktree's node_modules is a
  // junction into this install, so reinstalling under a live session empties the tree it is in.
  try {
    const lock = stamp.lockfile();
    const installed = stamp.installed();
    const changed = installed === null || lock > installed;
    if (lock !== null && (changed || (stamp.stored() !== String(lock) && stamp.drifted()))) {
      const what = changed ? "package-lock.json differs from the last install" : "node_modules has drifted from package-lock.json";
      const live = stamp.peers().filter((name) => name !== `agent-${pinned}`);
      if (live.length) {
        log(`${what}, but ${live.join(", ")} is live — not reinstalling`);
        return true;
      }
      log(`${what} — reinstalling before the next ticket`);
      install();
      if (!changed) stamp.write(String(lock));
    }
  } catch (err) {
    log(`could not reinstall — ${String(err.message).split("\n")[0]}`);
    return false;
  }
  return true;
}

/**
 * A session's own longest silence. Phase D's review subagent emits nothing into the parent
 * stream while it reads, and a large diff keeps it there past twenty minutes. Any ceiling at or
 * under that reads a working run as a stalled one. `CHECK_BASH_TIMEOUT_MS` is the session's Bash
 * ceiling, which `agent:check` needs and a stall must outlast.
 */
export { STALL_MS, CHECK_BASH_TIMEOUT_MS };

/**
 * Every other call's: a command waiting on a stdin nothing will write is killed at this, not at the
 * ceiling. `await-run` waits a minute less, and each re-issue of it is a turn at full context, so
 * this stays well past the CI run's target.
 */
export const BASH_DEFAULT_TIMEOUT_MS = 10 * 60_000;

export { SETTLE, UPDATES };

/** Consecutive red CI rounds on one ticket before it stops being the loop's to fix. */
export const CI_ROUNDS = 3;

/**
 * Processes one ticket may be spawned as. A+B+C is one, each review round is one and the last also
 * lands — five for a ticket that uses every round, and the slack is for a resume that re-enters a phase.
 *
 * A ceiling, not a budget: the thing that actually stops a runaway ticket is `USD_BY_SIZE`.
 */
export const MAX_HANDOFFS = 8;

// `npm` and `npx` are `.cmd` shims, and since the fix for CVE-2024-27980 node will not resolve one
// from execFileSync. Both are reached only with argument lists this file writes itself, never with
// anything a ticket or the tracker supplies.
const SHIMMED = new Set(["npm", "npx"]);

const sh = (file, args, opts = {}) => {
  if (file === "git") return gitAt(opts.cwd)(args, opts);
  if (file === "gh") return ghCli(args, opts);
  const shell = SHIMMED.has(file) && process.platform === "win32";
  const base = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: MAX_BUFFER, ...opts };
  // A command line, not a file plus arguments: under `shell` node concatenates them anyway, and
  // passing both is DEP0190. The quoting is this file's own, and one argument is a worktree path,
  // which carries whatever spaces the checkout's location has.
  if (shell) {
    const line = [file, ...args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(" ");
    return execFileSync(line, { ...base, shell: true });
  }
  return execFileSync(file, args, base);
};

/** One bad ticket is a ticket. Three in a row is the loop or the machine, and a night proving it. */
export const BREAKER = 3;

/**
 * How often a long hold says it is still there. The hold is the one stretch of the run that
 * prints nothing, and a silent terminal reads exactly like a dead one.
 */
export const HEARTBEAT_MS = 15 * 60_000;

/**
 * Sliced, so `.loop-stop` still reaches the loop across a long wait.
 *
 * @param {number} ms
 * @param {(f: string) => boolean} [exists]
 * @param {number} [slice]
 * @param {((line: string) => void)|null} [say]
 * @param {number} [beat]
 * @param {Promise<void>|null} [woken] resolves when the owner asks for the wait to end now
 */
export async function holdFor(
  ms,
  exists = (f) => fs.existsSync(f),
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
    if (exists(STOP_FILE)) return "stopped";
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
    write = writeFileSync,
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
    write(parkNotePath(number), body, "utf8");
    PARK_STEPS.comment(number, tracker);
  });

  if (cwd) step("worktree", () => removeWorktree(cwd, run));

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
export function repark(number, steps, tracker = ghTracker(), exists = (f) => fs.existsSync(f)) {
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

/** From the main checkout: `removeWorktree` in workspace.mjs refuses a caller standing inside the tree it removes. */
export function removeWorktree(cwd, run = sh) {
  return run("npm", ["run", "worktrees:remove", "--", cwd], { cwd: ROOT });
}

const writeLeftover = (file, body) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
};

/**
 * Only after a confirmed merge. `--force` is safe here because the script detaches the junction
 * before removing, and the leftovers are on disk first; a patch that cannot be written keeps the tree.
 */
export function removeLanded(cwd, number, { run = sh, write = writeLeftover, say = console.error } = {}) {
  const branch = run("git", ["-C", cwd, "branch", "--show-current"]).trim();
  const removed = removeLandedTree(cwd, number, { run, write, say });
  if (removed === null || !branch) return removed;
  try {
    run("git", ["branch", "-d", branch], { cwd: ROOT });
  } catch (err) {
    say(`${branch} was kept — ${String(err.message).split("\n")[0]}`);
  }
  return removed;
}

function removeLandedTree(cwd, number, { run, write, say }) {
  if (!run("git", ["-C", cwd, "status", "--porcelain"]).trim()) return removeWorktree(cwd, run);
  const file = leftoverPath(number);
  try {
    run("git", ["-C", cwd, "add", "-A"]);
    const patch = run("git", ["-C", cwd, "diff", "--cached", "--binary", "HEAD"], { encoding: "buffer" });
    write(file, patch);
  } catch (err) {
    say(`#${number}'s worktree has uncommitted leftovers and ${file} could not be written — ${String(err.message).split("\n")[0]}`);
    return null;
  }
  say(`#${number} landed with uncommitted leftovers in its worktree — saved to ${file}`);
  return run("npm", ["run", "worktrees:remove", "--", cwd, "--force"], { cwd: ROOT });
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


/** A red round's `update-branch` moved the remote head, and the fix is built on top of it. */
export function refreshWorktree(cwd, branch, run = sh) {
  const opts = { timeout: REFRESH_TIMEOUT_MS };
  run("git", ["-C", cwd, "fetch", "--quiet", "origin", branch], opts);
  run("git", ["-C", cwd, "merge", "--ff-only", `origin/${branch}`], opts);
}

/**
 * One ticket's worth of the issue, for the header and the turn bound. Covers the resume path, which
 * has no picker. The review rounds are counted by `loop-derive`'s own parser, so this and the gate
 * cannot disagree.
 *
 * `reviewRounds: null` on a failed read, never 0: a count nobody could take is not a count of none.
 */
export function ticketFacts(number, tracker = ghTracker()) {
  const issue = tracker.facts(number, { stderr: "ignore", timeout: 30_000 });
  if (!issue) return { title: `ticket #${number}`, url: "", size: null, labels: null, reviewRounds: null, ciRounds: 0 };
  const { comments, ...facts } = issue;
  return { ...facts, reviewRounds: reviewRounds(comments), ciRounds: ciRedRounds(comments) };
}

/**
 * The environment a session is spawned into.
 *
 * A background update landing at 2am changes the system prompt, and every remaining ticket of the
 * night then rebuilds its cached prefix at full price, with nothing to see. Whether to update is a
 * decision for a person between runs.
 *
 * The turn bound is what actually stops a session, passed so the session can see it.
 */
export function sessionEnv(number, size = null, at = null, reason = null, base = process.env) {
  return {
    ...spawnEnv({ number, at, reason, turns: turnsFor(size) }, base),
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(contextFor(size)),
    // `-p` leaves fork mode off, so subagents default to background and the session spends a turn
    // each time it asks one whether it is done. Foreground makes the Agent call an await.
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    // Also drops the commit trailer, which queue.md states instead.
    CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "1",
    // The owner's memory is written for his sessions: it contradicts rules the loop runs under,
    // and each of its writes moves the cached prefix.
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: "1",
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
    CLAUDE_CODE_DISABLE_WORKFLOWS: "1",
    CLAUDE_CODE_DISABLE_CRON: "1",
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
    CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING: "1",
    // Every brief says "Do not spawn any subagent"; this is what holds it.
    CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "1",
    CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS: "6000",
    BASH_MAX_TIMEOUT_MS: String(CHECK_BASH_TIMEOUT_MS),
    BASH_DEFAULT_TIMEOUT_MS: String(BASH_DEFAULT_TIMEOUT_MS),
  };
}

/**
 * The board's round for a phase. `reviewRounds` counts the verdicts already on the issue, so the
 * round about to run is the next one. Null when the tracker could not be read — a number nobody
 * could take is not a count of none.
 */
export const roundOf = (about, { fix = false, retryCount = 0 } = {}) => (phase) => {
  if (phase === "D" && about.reviewRounds != null) return { n: about.reviewRounds + 1, of: MAX_REVIEW_ROUNDS };
  // `retryCount` red CI runs so far is that many fixes, out of the runs after the first.
  if (phase === "C" && fix) return { n: Math.max(1, retryCount), of: CI_ROUNDS - 1, fix: true };
  return null;
};

/** The ticket's header, its keys' context and its first row, before the session says anything. */
export function openTicket(screen, { number, branch = null, queue, at = null, about, log, round, dir = DIR }) {
  if (screen.needsHeader(number)) screen.say(header({ number, ...about, queue }, screen.theme));
  const spentMs = ticketTally(number, readLedger(ledgerPath(undefined, dir))).ms;
  screen.context({ number, url: about.url, log, branch, spentMs });
  if (at) {
    // Opened here, not left for the session's own marker: `state.phase` is already this letter, so
    // the marker is read as "no change" and the board stays dark for the whole of that phase.
    screen.start(at, round(at));
  } else {
    // An unnamed row carries the clock and tool detail through the spawn, the start-up and a missed
    // marker, where the board would otherwise be blank under the header.
    screen.start(UNNAMED);
  }
}

/** `runSession`'s `onState` for the board: each effect `reduceSession` returned, drawn. */
export function sessionView(screen, { number, round }) {
  return (_state, effects) => {
    for (const e of effects) {
      if (e.kind === "session") screen.set({ session: e.id });
      if (e.kind === "start") screen.start(e.letter, round(e.letter));
      if (e.kind === "said") screen.said(thought(e.text));
      if (e.kind === "call") screen.call(e.call.name, act(e.call));
      if (e.kind === "tasks") {
        const detail = tasksDetail(e.tasks);
        if (detail) screen.said(detail);
      }
      if (e.kind === "refused") {
        screen.say(
          closing(
            {
              outcome: "rate_limited",
              number,
              why: `the ${e.window ?? "usage"} limit is spent — resets ${clockAt(e.resetsAt)}`,
              ms: 0,
              cost: 0,
            },
            screen.theme,
          ),
        );
      }
    }
  };
}

/**
 * A killed session's run, replayed from its ticket's stream log: the lines from the last session
 * start, since every session of the ticket appends to the one log. A session writes its
 * `SessionStart` hook lines before its `init`, so taking `init` alone bills one killed between the
 * two for the session before it. Its lines carry no clock, so its whole time goes to the phase it
 * was spawned at; one that wrote nothing after its start (`ms` 0) has no lines of its own.
 *
 * @param {{phase: string|null, ms: number}} k a `killedStarts` entry
 * @param {string} stream
 */
export function killedRun(k, stream) {
  const lines = stream.split("\n");
  const from = k.ms > 0 ? lines.findLastIndex(opensSession) : -1;
  let state = sessionStart(k.phase, 0);
  if (from >= 0) {
    for (const line of lines.slice(from)) state = reduceSession(state, line, { now: 0, at: k.phase, planned: "" }).state;
  }
  return {
    phases: k.phase ? { [k.phase]: Math.round(k.ms / 1000) } : {},
    estimatedCost: state.usage.size ? estimateCost(state.usage.values()) : null,
    model: state.model,
    version: state.version,
  };
}

function opensSession(line) {
  if (readLine(line)?.kind === "init") return true;
  try {
    const e = JSON.parse(line);
    return e.type === "system" && e.subtype === "hook_started" && e.hook_event === "SessionStart";
  } catch {
    return false;
  }
}

/** What `runTicket` reports: a finished session's state, flattened with its exit. */
export function ticketRun({ status, state, stderr, started, ms, asleepMs }, { size = null, log }) {
  return {
    status,
    blocked: state.blocked,
    blockedUntil: state.blockedUntil,
    result: state.result,
    estimatedCost: state.result || !state.usage.size ? null : estimateCost(state.usage.values()),
    declared: state.declared,
    size,
    phase: state.phase,
    phases: state.phases,
    stderr,
    version: state.version,
    model: state.model,
    accountError: state.accountError,
    wrongModel: state.wrongModel,
    apiErrorCode: state.apiErrorCode,
    started,
    ms,
    asleepMs,
    lastFact: state.lastFact,
    log,
  };
}

/**
 * Runs one session on the board and reports what it did. The phase comes from the session's own
 * `PHASE <letter>` line, never inferred from its shell commands, which miss most markers.
 *
 * @param {typeof runSession} session
 * @param {{number: number, queue: object, size?: string|null, at?: string|null,
 *   screen?: ReturnType<typeof ticker>, facts?: Function, stallMs?: number, tick?: number,
 *   dir?: string}} opts
 */
export async function runTicket(
  session,
  {
    number,
    branch = null,
    queue,
    size = null,
    at = null,
    fix = false,
    retryCount = 0,
    reason = null,
    screen = ticker(),
    facts = ticketFacts,
    stallMs = STALL_MS,
    tick = 30_000,
    killGraceMs = 10_000,
    // A test seam, and not an optional one: every fixture in the suite uses a live ticket number,
    // so a default that reaches `.loop-logs/` has the tests appending to — and deleting — the
    // loop's own record of its nights.
    dir = DIR,
  },
) {
  const log = streamLog(number, dir);
  const about = facts(number);
  const round = roundOf(about, { fix, retryCount });
  openTicket(screen, { number, branch, queue, at, about, log, round, dir });
  const done = await session(queueLoopArgs(number, size, at), {
    env: sessionEnv(number, size, at, reason),
    log,
    at,
    planned: plannedModel(at),
    stallMs,
    tick,
    killGraceMs,
    onState: sessionView(screen, { number, round }),
    // Through the screen, because this is the highest-volume writer there is while the live phase
    // line is turning.
    onStderr: (chunk) => screen.warn(chunk),
  });
  // The phase the session was in when it exited, with a mark of its own because a ✓ on a session
  // that stalled is the display saying the opposite of what happened.
  screen.close(done.status === 0 ? "done" : "failed");
  return ticketRun(done, { size, log });
}

const git = (...args) => gitAt()(args);

/**
 * One report file per run, named for when the run started — not per calendar day: two runs on one
 * day would share a file, and a run crossing midnight would split across two.
 */
const RUN_ID = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

export const RESTART = 75;
/** The supervisor's own code moved under it: `syncCheckout` updated the checkout, not the running process. */
export function loopMoved(startSha, run = git) {
  if (!startSha) return null;
  try {
    run("diff", "--quiet", startSha, "HEAD", "--", "tools/loop", "scripts/lib");
    return null;
  } catch (err) {
    return err.status === 1 ? run("rev-parse", "--short", "HEAD").trim() : null;
  }
}

/** The commit this supervisor runs, or null: two loop versions are otherwise one in the record. */
export function loopSha(run = git) {
  try {
    return run("rev-parse", "HEAD").trim() || null;
  } catch {
    return null;
  }
}

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

/** Passes one ticket may hold in a row before it is parked: `WAIT.FLOOR` apart, they outlast a short GitHub outage. */
export const TICKET_HOLDS = 10;

const standing = () => {
  const s = derive();
  return s.onTicket
    ? {
        ticket: s.ticket,
        head: s.head ?? null,
        commits: s.commits ?? 0,
        changed: s.changed ?? [],
        cwd: s.cwd,
        branch: s.branch,
        dirty: s.dirty,
        phase: s.phase,
        reviewRounds: s.reviewRounds ?? null,
      }
    : null;
};

/** The ticket's worktree as git has it now: a retry or refused pass carries none of it. */
function worktreeOf(workspace, number) {
  try {
    const at = workspace.standing();
    if (at?.ticket === number) return { cwd: at.cwd, branch: at.branch, dirty: at.dirty, phase: at.phase ?? null };
  } catch {
    const kept = path.join(ROOT, WORKTREE_DIR, `agent-${number}`);
    if (fs.existsSync(kept)) return { cwd: kept, branch: null, dirty: false, phase: null };
  }
  return { cwd: null, branch: null, dirty: false, phase: null };
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

const LIMITS = { BREAKER, CI_ROUNDS, MAX_HANDOFFS, TICKET_HOLDS, USD_BY_SIZE, USD_DEFAULT, WAIT, UPDATES };

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
    const action = decide({ limits: LIMITS, now: Date.now(), asked: false, own: null, ...facts, step, loop });
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

  let route = tracker.pick(pinned, at);
  let picking = { route: { ...route, n: route.number }, tally: ledger.tally(route.number), repicked: false };
  let picked = decideAt("pick", picking);
  if (picked.kind === "repick") {
    teardown(route.cwd, route.number);
    route = tracker.pick(loop.pinned, loop.pinned === null ? null : at);
    picking = { route: { ...route, n: route.number }, tally: ledger.tally(route.number), repicked: true };
    picked = decideAt("pick", picking);
  }
  const n = route.number;
  const ticket = { ...route, n };
  const size = route.size ?? null;
  const about = { title: route.title, size, reviewRounds: route.reviewRounds ?? null };
  const record = (row) => ledger.record({ ...about, ...row });
  const owner = () => (parkAsked(n) ? { asked: true, own: worktreeOf(workspace, n) } : { asked: false, own: null });
  const parkHere = (action, ctx) => {
    if (action.byOwner) fs.rmSync(PARK_FILE, { force: true });
    const parked = parkAndRecord({ tracker, events, record }, n, { ...ctx, phase: action.phase, why: action.why });
    return { ...parked, loop, halt: action.halt ?? null, ...(action.byOwner && { byOwner: true }) };
  };
  // A cap's or the owner's park comes after the row of what it replaced, and carries the worktree
  // with it: a handoff leaves one standing on purpose, so a park without it leaves `derive()` a live
  // run to resume.
  const parkOver = (over, own, log) => parkHere(over, { ...(own ?? worktreeOf(workspace, n)), log });
  let { tally } = picking;
  const unrun = { log: streamLog(n), cwd: route.cwd ?? null, branch: route.branch ?? null, dirty: route.dirty ?? false };
  if (picked.kind === "park") return parkHere(picked, unrun);
  if (picked.kind !== "go") return pass(picked);

  if (picked.redWhileDown) {
    record({
      number: n,
      outcome: "retry",
      why: "CI went red while the loop was down",
      run: { result: null, ms: 0, log: streamLog(n), phases: {} },
      head: route.head,
    });
    tally = ledger.tally(n);
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
        retryCount: Math.max(tally.retries, tally.ciRounds ?? 0),
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
  const judging = { route: ticket, settled: { ...settled, head }, tally: ledger.tally(n), ...owned };
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
  const log = verdict.ciRed && fs.existsSync(ciLogPath(n)) ? ciLogPath(n) : billed.log;
  return parkHere(verdict, { ...worked(action.pr, log), flake: verdict.ciRed ? null : (settled.flake ?? null) });
}

/**
 * `screen`, with every line the supervisor says also handed to `keep` as one line of
 * `.loop-logs/supervisor.log`: the board scrolls away, and the file is what a monitor reads after.
 * `settle` keeps its lines through `keep` itself, since its `said` carries the session's words too.
 */
export function journaled(screen, ticket, keep) {
  const write = (text) => {
    try {
      const n = ticket();
      keep(`${new Date().toISOString()}${n == null ? "" : ` #${n}`} ${String(text).replace(/\r?\n/g, " | ")}\n`);
    } catch {
      // A disk that refuses the line costs the line, never the night.
    }
  };
  // Not a spread: `theme` is a getter a resize replaces, and a spread would freeze it.
  return Object.assign(Object.create(screen), {
    notice: (label, text) => {
      write(`${label}: ${text}`);
      screen.notice(label, text);
    },
    warn: (text) => {
      write(text);
      screen.warn(text);
    },
    keep: write,
  });
}

/**
 * What the supervisor draws, as an observer: `runOnce` says its own lines through it, and the real
 * ports draw theirs. Each method is one kind of line on the board.
 */
export function screenEvents(screen) {
  const ticketHeader = (ticket) => {
    if (screen.needsHeader(ticket.number)) screen.say(header(ticket, screen.theme));
  };
  return {
    log: (m, label = "loop") => screen.notice(label, m),
    bell,
    step: (row) => screen.say([stepRow(row, screen.theme), ...(row.note?.trim() ? [note(row.note, screen.theme)] : [])].join("\n")),
    recap: (totals, before, queue) => screen.say(recap(totals, before, queue, screen.theme)),
    header: ticketHeader,
    announce: (ticket, spentMs) => {
      ticketHeader(ticket);
      screen.context({ spentMs });
    },
    published: (pr) => screen.set({ pr }),
    recorded: (row, bill) => {
      // Each of these is said by the row after it: the next phase opening, or the merge step's own
      // result. The log is offered only where something needs reading.
      if (["handoff", "retry", "pushed", "reparked", "armed"].includes(row.outcome)) return;
      const landed = row.outcome === "landed";
      screen.say(closing({ outcome: landed ? "merged" : row.outcome, number: row.number, files: row.files === undefined ? 0 : row.files, ...bill, why: row.why ?? undefined, log: landed ? undefined : row.run.log }, screen.theme));
    },
  };
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
  let picked = null;
  const started = loopSha();
  const tracker = {
    pick: (pinned, at) => {
      const route = nextRoute(pinned, at);
      picked = route;
      if (route.resuming) return route;
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
        mkdirSync(DIR, { recursive: true });
        writeFileSync(conflictNotePath(number), `CONFLICT ${head}\nThe branch conflicts with main: the next process rebases it onto origin/main.`, "utf8");
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
    // Read, never removed: a scheduled restart must see the stop too.
    stopFile: () => fs.existsSync(STOP_FILE),
    loopMoved: () => loopMoved(started),
    syncCheckout: (pinned) => syncCheckout(git, (m) => events.log(m, "checkout"), undefined, { pinned }),
    housekeeping: (pinned) => housekeeping({ pinned, say: events.step }),
    parity: () => parityRed(),
    standing,
    refreshWorktree: (cwd, branch) => refreshWorktree(cwd, branch),
    buildPassed: (cwd, ticket) => {
      try {
        return Boolean(cwd) && buildReady(cwd, ticket).ok;
      } catch {
        return false;
      }
    },
    sharedCheckoutDirty: () => git("status", "--porcelain").trim(),
    remove: (cwd, number) => {
      if (!cwd || !fs.existsSync(cwd)) return;
      try {
        removeLanded(cwd, number, { say: (m) => events.log(m, "worktree") });
      } catch {
        events.log(`${cwd} is still standing — derive() will read it as a live run`, "worktree");
      }
    },
  };
  const session = {
    spawn: (route) => {
      let branch = route.branch ?? null;
      if (!route.resuming) {
        events.header({ number: route.number, title: route.title, size: route.size, url: `https://github.com/${REPO}/issues/${route.number}`, queue: route.queue });
        // A lost race exits 1, which `sh` raises. It is not a failure of this run: the ticket is
        // someone else's, and the shape that says so is the stand-down every other path already
        // reads — so the session is never spawned and `runOnce` parks it from the declaration.
        try {
          const claimed = sh("node", [HERE + "/claim.mjs", String(route.number), route.title]);
          branch = claimed.split("\t")[2]?.trim() || null;
          events.step({ label: "claim", detail: `won · ${branch ?? ""}`, ms: null });
        } catch (err) {
          const why = String(err.stdout ?? "").split("\t").at(-1)?.trim() || "the claim did not stand";
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
    // A fresh pick has no CI rounds: its claim comment is newer than any CI-RED before it.
    tally: (n) => ({
      ...ticketTally(n, readLedger()),
      ciRounds: picked?.number === n ? (picked.ciRounds ?? 0) : 0,
    }),
    rows: () => readLedger(),
    record: (row) => events.recorded(row, book.record(row, RUN_ID).bill),
    killed: () => {
      const last = killedStarts(readLedger(undefined, { starts: true }), lastWrite).at(-1);
      if (!last?.trailing) return null;
      const log = streamLog(last.n);
      book.killed(last, killedRun(last, fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""));
      return last;
    },
    journal: (line) => appendSupervisor(line),
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
  book = openLedger({ loopSha: loopSha() }),
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
   * `tracker.pick` is the claim, so wrapping it is where the answer is knowable.
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
      pick: (p, at) => {
        const route = tracker.pick(p, at);
        claimed = typeof route?.number === "number" ? route.number : null;
        if (route?.queue) launch = route.queue.launch ?? null;
        return route;
      },
      settle: (pending) => timed("ci", () => tracker.settle(pending, screen)),
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
      const how = await holdFor(ms, undefined, undefined, say, undefined, woken);
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
    pruneLogs();
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
      pass = await runOnce(watched, events, loop.pinned, loop.pinned ? ledger.tally(loop.pinned).lastHandoff : null, loop);
    } catch (err) {
      screen.warn(`queue-loop: the iteration threw — ${String(err?.stack ?? err)}`);
      // No row: there is no run to write one from, and an invented row is a ledger trusted while
      // wrong. The claim is the part that strands the ticket, and it comes off here.
      const own = claimed === null ? null : worktreeOf(workspace, claimed);
      const threw = decide({ step: "threw", route: claimed === null ? null : { n: claimed }, error: String(err?.message ?? err), own, loop, limits: LIMITS, now: Date.now() });
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
    if (pass.ticket != null && !PARKABLE.has(pass.outcome) && parkAsked(pass.ticket)) {
      fs.rmSync(PARK_FILE, { force: true });
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
 * `--check`: the reads a pass starts from — the standing ticket, its facts and tally, and the next
 * pick — printed one per line, with nothing synced, claimed, pruned, spawned or written. It runs the
 * real ports' read wiring, which the loop's tests stub out.
 */
export function check({ say = console.log, standingOf = standing, facts = ticketFacts, ledger = readLedger, picker = nextPick } = {}) {
  const at = standingOf();
  say(`STANDING\t${JSON.stringify(at)}`);
  if (at) {
    say(`FACTS\t${JSON.stringify(facts(at.ticket))}`);
    say(`TALLY\t${JSON.stringify(ticketTally(at.ticket, ledger()))}`);
  }
  say(`PICK\t${JSON.stringify(picker())}`);
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
