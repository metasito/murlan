// tools/loop/queue-loop.mjs
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
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs, { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  ciRedPosted,
  ciRedRounds,
  derive,
  parityRed,
  REPO,
  reviewRounds,
  totalHolds,
  trustedComments,
  WORKTREE_DIR,
} from "./loop-derive.mjs";
import { COMMITTING, readLine, scopeEnds } from "./loop-stream.mjs";
import {
  act,
  activity,
  ahead,
  bell,
  capabilities,
  ciLine,
  clockAt,
  closing,
  elapsed,
  header,
  help,
  keybar,
  LAND,
  note,
  notice,
  phaseRow,
  progress,
  recap,
  PLAIN,
  reportRow,
  runRecap,
  runTotal,
  stepRow,
  stepTitle,
  stream as streamBlock,
  tasksDetail,
  theme,
  thought,
  RECENT,
  UNNAMED,
} from "./loop-render.mjs";
import {
  DIR,
  ciLogPath,
  ciRedNotePath,
  errorLine,
  errorOf,
  killedStarts,
  leftoverPath,
  ledgerPath,
  ledger as openLedger,
  parkNotePath,
  parkReasonOf,
  pendingReparks,
  prune as pruneLogs,
  readLedger,
  streamLog,
  ticketTally,
  typicalMs,
  usageSplit,
  windowCost,
} from "./loop-logs.mjs";
import { readAllowedTools } from "./loop-tools.mjs";
import { checkLockDrift, housekeeping, listWorktreeDirNames } from "./workspace.mjs";
import { buildReady, landable, MAX_REVIEW_ROUNDS, reviewerRan } from "./loop-gate.mjs";
import { CONTEXT_BY_SIZE, CONTEXT_DEFAULT, EFFORT_BY_PHASE, familyOf, MODEL_BY_PHASE, TURNS_BY_SIZE, TURNS_DEFAULT, turnHeadroom } from "./loop-cost.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { CHECK_BASH_TIMEOUT_MS, STALL_MS, sleepClock } from "./limits.mjs";
import { commands, withoutQuotedBodies } from "./shell.mjs";
import { OWNER_LABELS } from "./next-ticket.mjs";
import { afterSession, decide, WAIT } from "./decide.mjs";
import { createRequire } from "node:module";

// Loaded on use: a static .ts import plus process.exit aborts node on Windows (nodejs/node#56645).
const ts = (file) => createRequire(import.meta.url)(file);

// Spawning a sibling by its own directory, not the cwd: the supervisor runs from the repo root,
// but nothing guarantees that, and the sibling is beside this file either way.
const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..", "..");

const STOP_FILE = ".loop-stop";
const PARK_FILE = ".loop-park";

/** Whether the owner asked, from the board, to park this ticket once its session has exited. */
export const parkAsked = (number, read = (f) => fs.readFileSync(f, "utf8")) => {
  if (number == null) return false;
  try {
    return Number(read(PARK_FILE).trim()) === number;
  } catch {
    return false;
  }
};

/** @returns {{ skill: string, number: number, title: string, size: string|null }} */
export function parseRoute(stdout) {
  const line = stdout.split("\n").find((l) => l.startsWith("ROUTE\t"));
  if (!line) throw new Error("no ROUTE line in next-ticket.mjs output");
  const [, skill, number, title, size] = line.split("\t");
  return { skill, number: Number(number), title, size: size?.trim() || null };
}

/** The bucket depths the picker already prints, for the header's "how much is behind this one". */
export function parseStatus(stdout) {
  const line = stdout.split("\n").find((l) => l.startsWith("STATUS\t"));
  const read = (name) => {
    const n = /:(\d+)/.exec(line?.split("\t").find((f) => f.startsWith(`${name}:`)) ?? "")?.[1];
    return n === undefined ? null : Number(n);
  };
  return {
    implement: read("implement") ?? 0,
    triage: read("triage") ?? 0,
    wayfinder: read("wayfinder") ?? 0,
    launch: read("launch"),
  };
}

export function shouldStop(route) {
  return route.skill === "handoff";
}

/**
 * @param {string[]|null} [labels] the live ticket's labels, null when the tracker could not say
 * @returns {{skill: string, number: number, title: string, phase?: string, resuming: boolean}|null}
 */
export function liveRoute(status, labels = null) {
  // locateRun refuses to guess between two live ticket worktrees, and that refusal is the whole
  // point of it — returning null here turned it into "no run is live" and the picker took a third.
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
    picker = () => execFileSync("node", [HERE + "/next-ticket.mjs"], { encoding: "utf8" }),
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
    // A held red's retry row names its head; a supervisor that stopped mid-settle wrote none, and owes G.
    const held = status.ci?.state === "unposted" && status.ci.sha === tally.lastRedHead;
    const fix = Boolean(status.fix) || held;
    const handed = at ?? (fix ? "C" : null) ?? tally.lastHandoff;
    const settles = live.phase === "G" && status.ci?.pushed === true && !held;
    const derived = live.phase === "G" ? "E" : live.phase;
    // A LAND on this head ends the review the handoff was for; D lands its own, so no row says E.
    const phase = settles ? "G" : handed === "D" && derived === "E" ? "E" : (handed ?? derived);
    return {
      ...live,
      phase,
      fix: fix && phase !== "G",
      head: status.ci?.sha ?? status.head ?? null,
      cwd: status.cwd ?? null,
      branch: status.branch ?? null,
      dirty: status.dirty ?? false,
      size: known?.size ?? null,
      ciRounds: known?.ciRounds ?? 0,
      queue: null,
      // The pull request whose CI-RED `runOnce` posts before the fix round: the session reads only that.
      ...(held && { unposted: status.ci.pr }),
    };
  }
  if (pinned) {
    const { title, size, ciRounds, labels } = facts(pinned);
    // A handoff here would stop the run over one ticket the owner took back; the picker decides.
    // `ready-for-agent` alone is still ours: an API failure before phase A's claim holds it pinned.
    const released =
      labels &&
      (labels.some((l) => OWNER_LABELS.has(l)) || !labels.some((l) => l === "in-progress" || l === "ready-for-agent"));
    if (!released) return { skill: "implement", number: pinned, title, size, ciRounds, queue: null, resuming: true, phase: "A" };
  }
  const stdout = picker();
  return { ...parseRoute(stdout), queue: parseStatus(stdout), resuming: false };
}

/**
 * The real bound is turns. A dollar cap is checked only after a turn settles, so where it stops
 * moves with the model and the context — measured 8x to 42x over a small cap — and with subagents
 * in flight it stops the *subagents* and lets the session carry on. The dollar figure stays as a
 * backstop against one pathological turn, well above what a healthy ticket reaches.
 */
const TICKET_BUDGET_USD = "40";

/**
 * What one ticket may cost across every process it is spawned as.
 *
 * `TICKET_BUDGET_USD` bounds a single session and is unchanged; with phase handoffs a ticket is up
 * to `MAX_HANDOFFS` of them, so the per-ticket figure has to be kept here, where the supervisor is
 * the only thing that survives them all. Set above the fleet median for the size, so it catches
 * a runaway and never a healthy run.
 */
export const USD_BY_SIZE = {
  "size:XS": 20,
  "size:S": 30,
  "size:M": 45,
  "size:L": 70,
  "size:XL": 90,
};
export const USD_DEFAULT = 40;

/** @param {number} spent @param {string|null} size */
export const overSpend = (spent, size) => spent >= (USD_BY_SIZE[size ?? ""] ?? USD_DEFAULT);

/** @param {string|null} [size] a `size:*` label, or null */
export const turnsFor = (size) => TURNS_BY_SIZE[size ?? ""] ?? TURNS_DEFAULT;

/** @param {string|null} [size] a `size:*` label, or null */
export const contextFor = (size) => CONTEXT_BY_SIZE[size ?? ""] ?? CONTEXT_DEFAULT;

/** @param {string|null} [phase] */
const plannedModel = (phase) => MODEL_BY_PHASE[phase ?? "A"] ?? MODEL_BY_PHASE.A;

const LOOP_SETTINGS = path.join(HERE, "loop-settings.json");
const RESULT_SCHEMA = JSON.stringify(JSON.parse(fs.readFileSync(path.join(HERE, "result-schema.json"), "utf8")));

/** `loop-settings.json` can only switch off what it names; a plugin it does not turn on is stray. */
export const strayPlugins = (loaded, allowed = JSON.parse(fs.readFileSync(LOOP_SETTINGS, "utf8")).enabledPlugins) =>
  loaded.filter((source) => !source.endsWith("@builtin") && allowed[source] !== true);

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
    LOOP_SETTINGS,
    "--setting-sources",
    "project",
    "--tools",
    readAllowedTools().join(","),
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

/** Worktree directories someone else may be working in right now. */
function peerWorktrees(dir = WORKTREE_DIR) {
  return listWorktreeDirNames(dir).filter((name) => name.startsWith("agent-"));
}

const LOCK_STAMP = "node_modules/.loop-lock-hash";

/** The install's own record of the lockfile it was run against — a fact about `node_modules`. */
const defaultStamp = {
  current: () => {
    try {
      return createHash("sha256").update(fs.readFileSync("package-lock.json")).digest("hex");
    } catch {
      return null;
    }
  },
  stored: () => {
    try {
      return fs.readFileSync(LOCK_STAMP, "utf8").trim();
    } catch {
      return null;
    }
  },
  write: (hash) => writeFileSync(LOCK_STAMP, hash),
  peers: peerWorktrees,
  drifted: () => checkLockDrift(".").length > 0,
};
const DRIFT_MARK = "drift-reinstalled";

/**
 * Leaves the shared checkout on an up-to-date `main`, or refuses and says why.
 *
 * It asks whether the protocol files are *dirty*, not whether they differ from `origin/main`.
 * Those are different questions: the loop's own tickets edit its own code, so the moment one
 * merges the checkout differs from origin until it is fast-forwarded — which is staleness,
 * repaired here rather than reported. Only an uncommitted edit is drift, and it belongs to someone.
 *
 * @param {{current: () => string|null, stored: () => string|null, write: (hash: string) => void,
 *   peers: () => string[], drifted: () => boolean}} [stamp]
 * @param {number|null} [pinned] the ticket whose own worktree, if any, is not another session
 */
/** Captured, not inherited: npm's own report would draw over the board. A failure still carries it. */
export const reinstall = (run = sh) => run("npm", ["ci", "--no-audit", "--no-fund"]);

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

  // Keyed on the installed stamp, not the fast-forward's own diff: a diff seen once and skipped
  // for a live peer is gone for good, so a worktree standing at merge time must not cost the loop
  // its only chance to notice. `housekeeping` refuses to start a ticket on top of a drifted install,
  // so leaving the repair to the next iteration is the loop poisoning its own precondition. It
  // runs only when no *other* ticket's worktree is standing: every worktree's node_modules is a
  // junction into this install, so reinstalling under a live session empties the tree it is in.
  try {
    const current = stamp.current();
    const [stored, mark] = (stamp.stored() ?? "").split(" ");
    const changed = current !== stored;
    if (current !== null && (changed || (mark !== DRIFT_MARK && stamp.drifted()))) {
      const what = changed ? "package-lock.json differs from the last install" : "node_modules has drifted from package-lock.json";
      const live = stamp.peers().filter((name) => name !== `agent-${pinned}`);
      if (live.length) {
        log(`${what}, but ${live.join(", ")} is live — not reinstalling`);
        return true;
      }
      log(`${what} — reinstalling before the next ticket`);
      install();
      stamp.write(changed ? current : `${current} ${DRIFT_MARK}`);
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
export { afterRefusal, afterSession, apiFailure, exhausted, handoffOf, outcomeOf, reasonFor, resumePhase, WAIT, waitFor } from "./decide.mjs";

/**
 * Every other call's: a command waiting on a stdin nothing will write is killed at this, not at the
 * ceiling. `await-run` waits a minute less, and each re-issue of it is a turn at full context, so
 * this stays well past the CI run's target.
 */
export const BASH_DEFAULT_TIMEOUT_MS = 10 * 60_000;

/**
 * The supervisor's half has no watchdog over it — `runTicket`'s watches the child and is cleared
 * when the child closes — so `settle` as a whole is bounded here instead, and a branch that keeps
 * asking for one more round cannot hold the night open. Each individual `gh` call carries its own
 * ceiling in `ciVerdict.ts`'s `ghExecOptions`, which is where the one that can block lives.
 */
export const SETTLE = { DEADLINE_MS: 90 * 60_000 };

/** Consecutive red CI rounds on one ticket before it stops being the loop's to fix. */
export const CI_ROUNDS = 3;

/**
 * Processes one ticket may be spawned as. A+B+C is one, each review round is one and the last also
 * lands — five for a ticket that uses every round, and the slack is for a resume that re-enters a phase.
 *
 * A ceiling, not a budget: the thing that actually stops a runaway ticket is `overSpend`.
 */
export const MAX_HANDOFFS = 8;
export const overHandoffs = (n) => n >= MAX_HANDOFFS;

/** The CLI's assistant-error codes no unattended wait cures: someone has to act on the account. */
export const ACCOUNT_ERRORS = new Set(["authentication_failed", "oauth_org_not_allowed", "account_on_hold", "verification_required", "billing_error"]);

// `npm` and `npx` are `.cmd` shims, and since the fix for CVE-2024-27980 node will not resolve one
// from execFileSync — measured here: `execFileSync("npx", ["--version"])` throws ENOENT while `gh`
// and `git` are fine. Both are reached only with argument lists this file writes itself, never with
// anything a ticket or the tracker supplies.
const SHIMMED = new Set(["npm", "npx"]);

/**
 * `sh` reads a whole `gh` payload, and one of them carries four hundred lines of CI log — over
 * node's 1 MB default that is an ENOBUFS throw, which `settle` catches and turns into a parked
 * ticket. `ciVerdict.ts` sets a large buffer for exactly this; its caller has to as well.
 */
const SH_MAX_BUFFER = 64 * 1024 * 1024;

const sh = (file, args, opts) => {
  const shell = SHIMMED.has(file) && process.platform === "win32";
  const base = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: SH_MAX_BUFFER, ...opts };
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


/** `.loop-stop` drains the loop. Left on disk, so a scheduled restart sees it too. */
export function takeStopFile(fs, file) {
  return fs.existsSync(file);
}

/**
 * How often a long hold says it is still there. The hold is the one stretch of the run that
 * prints nothing, and a silent terminal reads exactly like a dead one — which is the complaint
 * the live phase line exists to answer.
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

/** Keeps a held session's uncommitted work in `refs/loop/wip/<n>` without touching HEAD, the index or the branch. */
export function snapshotWip(cwd, number, run = sh) {
  if (!cwd || !run("git", ["-C", cwd, "status", "--porcelain"]).trim()) return null;
  const env = { ...process.env, GIT_INDEX_FILE: path.join(os.tmpdir(), `loop-wip-${number}-${process.pid}`) };
  try {
    run("git", ["-C", cwd, "read-tree", "HEAD"], { env });
    run("git", ["-C", cwd, "add", "-A", "--", "."], { env });
    const tree = run("git", ["-C", cwd, "write-tree"], { env }).trim();
    const sha = run("git", ["-C", cwd, "commit-tree", tree, "-p", "HEAD", "-m", `wip(#${number}): held`]).trim();
    run("git", ["-C", cwd, "update-ref", `refs/loop/wip/${number}`, sha]);
    return sha;
  } finally {
    fs.rmSync(env.GIT_INDEX_FILE, { force: true });
  }
}

/**
 * Hands a ticket back to the owner: the work committed, the claim released, the reason on the
 * issue, the worktree gone.
 *
 * Each step reports rather than throwing. This is the failure path — reached from the stop-file
 * drain as well as from a bad session — so a throw here turned an orderly stop into an unhandled
 * rejection and lost whatever the run still held.
 *
 * @param {number} number
 * @param {{phase: string, why: string, log: string, cwd: string|null, branch: string|null,
 *   dirty: boolean, error?: object|null, run?: Function, write?: Function}} ctx
 * @returns {{ok: boolean, failed: string[]}}
 */
export function park(
  number,
  { phase, why, log, cwd, branch, dirty, error = null, run = sh, write = writeFileSync },
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

  step("label", () => PARK_STEPS.label(number, run));

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
    PARK_STEPS.comment(number, run);
  });

  if (cwd) step("worktree", () => removeWorktree(cwd, run));

  return { ok: failed.length === 0, failed };
}

/** The tracker's half of a park, each a step a later pass can apply again on its own. */
const PARK_STEPS = {
  label: (number, run) =>
    run("gh", [
      "issue",
      "edit",
      String(number),
      "--remove-label",
      "in-progress",
      // Left on, a park is absorbing: classify() sends any issue carrying an owner label to the
      // owner bucket whatever else it carries, so the ticket never returns to the frontier.
      "--remove-label",
      "ready-for-agent",
      "--add-label",
      "ready-for-human",
    ]),
  comment: (number, run) => run("gh", ["issue", "comment", String(number), "--body-file", parkNotePath(number)]),
};

/**
 * The park steps that failed, applied again from what the park left on disk — only while the park
 * still stands. `why` says why a debt closed without being applied; `failed` is what is still owed.
 *
 * @param {number} number @param {string[]} steps
 * @returns {{failed: string[], why: string|null}}
 */
export function repark(number, steps, run = sh, exists = (f) => fs.existsSync(f)) {
  let issue;
  try {
    issue = JSON.parse(run("gh", ["issue", "view", String(number), "--json", "state,labels"], { timeout: CI_RED_TIMEOUT_MS }));
  } catch (err) {
    console.error(`  ⚠️ park #${number}: the issue could not be read — ${String(err.message).split("\n")[0]}`);
    return { failed: steps, why: null };
  }
  // The label step owed leaves `in-progress` on; once it landed, `ready-for-human` is the park's own.
  // Anything else is the owner's doing, which a retry must not undo.
  const mark = steps.includes("label") ? "in-progress" : "ready-for-human";
  if (issue.state !== "OPEN" || !issue.labels.some((l) => l.name === mark)) {
    return { failed: [], why: "the owner already acted on the issue" };
  }
  const pruned = steps.includes("comment") && !exists(parkNotePath(number));
  const failed = steps.filter((s) => {
    if (s === "comment" && pruned) return false;
    try {
      PARK_STEPS[s](number, run);
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
    run("git", ["update-ref", "-d", `refs/loop/wip/${number}`], { cwd: ROOT });
  } catch {
    // a failed cleanup must not undo the removal
  }
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
 * Pushes the head review is about to read, and opens a draft for it when no pull request is open,
 * so CI runs while the review does. Not a gate: phase D's land step pushes again if this failed.
 */
export function publishForReview(number, branch, cwd, title, run = sh) {
  const opts = { timeout: REFRESH_TIMEOUT_MS };
  run("git", ["-C", cwd, "push", "--quiet", "-u", "origin", branch], opts);
  const open = JSON.parse(
    run("gh", ["pr", "list", "--repo", REPO, "--head", branch, "--state", "open", "--json", "number"], opts),
  );
  if (open.length > 0) return prUrl(open[0].number);
  const body = `Closes #${number}\n\nOpened as a draft when review started. Phase D writes this description on LAND.`;
  return String(
    run("gh", ["pr", "create", "--repo", REPO, "--draft", "--base", "main", "--head", branch, "--title", title, "--body", body], opts),
  ).trim();
}

const prUrl = (n) => `https://github.com/${REPO}/pull/${n}`;

/** The ticket's branch, read from its worktree: a resumed ticket has no claim to take it from. */
function branchOf(number, run = sh) {
  try {
    return run("git", ["-C", path.join(ROOT, WORKTREE_DIR, `agent-${number}`), "branch", "--show-current"]).trim() || null;
  } catch {
    return null;
  }
}

/** A red round's `update-branch` moved the remote head, and the fix is built on top of it. */
export function refreshWorktree(cwd, branch, run = sh) {
  const opts = { timeout: REFRESH_TIMEOUT_MS };
  run("git", ["-C", cwd, "fetch", "--quiet", "origin", branch], opts);
  run("git", ["-C", cwd, "merge", "--ff-only", `origin/${branch}`], opts);
}
const REFRESH_TIMEOUT_MS = 2 * 60_000;

const ERASE = "\r\u001B[2K";
const HIDE = "\u001B[?25l";
const SHOW = "\u001B[?25h";
const REDRAW_MS = 120;
const ESC = String.fromCharCode(27);
// `[0A` is not "up none": ECMA-48 reads a parameter of 0 as 1, so an unguarded zero moves the
// cursor a row it was never asked to move.
const UP = (n) => (n > 0 ? `${ESC}[${n}A` : "");
const CTRL_C = String.fromCharCode(3);
const BEL = String.fromCharCode(7);

/** Rows the block never claims: the header above it, and slack so it cannot scroll itself. */
const CHROME = 8;

/**
 * How much of the stream the `e` key can reach back through. A phase can run for hours and both
 * `call()` and `said()` push on every turn, while `stream()` only ever reads the last screenful —
 * so without a ceiling this grows all night and nothing past the first screen is reachable anyway.
 */
const FEED = 200;

/**
 * The only thing in the loop that knows a cursor or a keyboard exists.
 *
 * The board is a block, not a line, and a block is redrawn by counting rows back up. Three rules
 * hold that together, and each was a bug before it was a rule.
 *
 * **Erase before the text, never after.** `[2K` clears the whole row the cursor sits on, so a row
 * written and then erased is a row that was never on screen.
 *
 * **Rows are joined with `\r\n`.** Without the carriage return each row starts one indent further
 * right than the last and the block walks diagonally off the screen.
 *
 * **The block is never taller than the window.** `[<n>A` counts rows, so a block that scrolls the
 * terminal as it is drawn moves its own origin out from under the next frame.
 *
 * Finished phases are written above the block as ordinary scrollback, so the record is what is
 * still on screen in the morning and the moving part is only ever the bottom few rows.
 *
 * At anything that is not a terminal every escape is suppressed and nothing is redrawn: the output
 * is the append-only stream `loop-render.mjs` produces, which is what `.loop-logs/run-*.md` wants.
 */
export function ticker(out = process.stdout, err = process.stderr, reveal = openExternally, copy = toClipboard) {
  // A window too narrow to lay a row out in is a window the block cannot be drawn in: every row
  // would wrap, and a wrapped row is the cursor arithmetic wrong for the rest of the run. The
  // append-only stream is what such a terminal gets, the same as a pipe — and it can become one
  // mid-run, so this is re-read on resize rather than settled at start-up.
  let live = Boolean(out.isTTY) && !capabilities(out).tight;
  let t = theme(capabilities(out));
  // A window resized mid-run leaves a board wider than the terminal, and every row of it then
  // wraps — which puts the next carriage return on the wrong line and takes the redraw with it for
  // the rest of the night. Rebuilt only when the width actually moves, since the block is
  // reassembled eight times a second and the detection is not free.
  const resized = () => {
    const caps = capabilities(out);
    const drawable = Boolean(out.isTTY) && !caps.tight;
    if (caps.width === t.width && drawable === live) return false;
    t = theme(caps);
    live = drawable;
    return true;
  };
  let open = null;
  let timer = null;
  let headed = null;
  let drawn = [];
  let hidden = false;
  let raw = false;
  const view = { expanded: false, stopping: false, parking: false, recap: false, help: false };
  let board = { typical: {}, recap: null };
  let ctx = { number: null, url: null, log: null, branch: null, session: null, pr: null, since: null };
  let titled = "";
  const setTitle = (text) => {
    if (!out.isTTY || text === titled) return;
    out.write(`${ESC}]0;${text}${BEL}`);
    titled = text;
  };

  const hide = () => {
    if (!live || hidden) return;
    out.write(HIDE);
    hidden = true;
  };
  const show = () => {
    if (!hidden) return;
    out.write(SHOW);
    hidden = false;
  };

  const block = () => {
    const ms = Date.now() - open.startedAt;
    // The frame comes from the clock, not from a count of draws: a redraw prompted by a new tool
    // call inside the same frame window would otherwise turn the spinner, which makes every frame
    // different from the last and defeats the only-write-on-change rule entirely.
    const frame = Math.floor(ms / REDRAW_MS);
    // Both branches, not just the expanded one. The collapsed block is nine rows whatever the
    // window is, and at nine rows or fewer drawing it scrolls the terminal — after which `[<n>A`
    // clamps at the top of the viewport and the block walks down the screen at eight frames a
    // second for the rest of the night.
    const room = Math.max(3, (out.rows ?? 30) - CHROME);
    const left = open.wait ? Math.max(0, open.wait.until - Date.now()) : 0;
    const next = ahead(open.letter, board.typical, t);
    const body = view.help
      ? help(t).join("\n")
      : view.recap && board.recap && !open.wait
        ? board.recap(t).join("\n")
        : open.wait
          ? [
              stepRow({ label: "waiting", detail: `${open.wait.label} · ${elapsed(left)} left`, state: "skipped" }, t),
              ...(open.wait.then ? [stepRow({ label: "then", detail: open.wait.then, state: "skipped" }, t)] : []),
              ...(board.recap ? ["", ...board.recap(t)] : []),
            ].join("\n")
          : view.expanded
            ? streamBlock(open.feed, { ms, frame, letter: open.letter }, t, room)
            : [
                progress({ letter: open.letter, round: open.round, ticketMs: ctx.since == null ? null : Date.now() - ctx.since }, t),
                ...next,
                "",
                activity({ said: open.said, recent: open.recent, ms, frame }, t, room - 4 - next.length),
              ].join("\n");
    // A wait already shows the recap, and `r` there would hide the countdown.
    const recap = open.wait ? null : board.recap;
    const offers = { ticket: ctx.number, waiting: open.wait, pr: ctx.pr, url: ctx.url, log: ctx.log, session: ctx.session, recap };
    // The key bar is cut last: it is the only way to end a wait or close a view.
    return [...body.split("\n").slice(0, Math.max(1, room - 2)), "", keybar({ ...view, recap: view.recap && Boolean(recap), offers }, t)];
  };

  const title = () =>
    ctx.number == null
      ? ""
      : stepTitle({
          number: ctx.number,
          letter: open?.letter,
          round: open?.round,
          waitMs: open?.wait ? Math.max(0, open.wait.until - Date.now()) : null,
          ticketMs: ctx.since == null ? null : Date.now() - ctx.since,
        });

  const draw = () => {
    if (!out.isTTY || !open) return;
    // Before the `live` gate, not after: a window narrowed past the point of drawing has to be
    // able to widen back. A narrower window also means the rows already on screen have wrapped and
    // their count is no longer what the cursor maths assumes — repainting from scratch is the only
    // honest recovery, and it leaves the wrapped rows behind as a one-time smear.
    if (resized()) drawn = [];
    setTitle(title());
    if (!live) return;
    const rows = block();
    if (rows.length === drawn.length && rows.every((r, i) => r === drawn[i])) return;
    hide();
    // Every row of the old block is painted over, including the ones a shorter new block does not
    // reach — otherwise a block that shrinks leaves the tail of the last one under it forever.
    const span = Math.max(rows.length, drawn.length);
    let text = drawn.length ? `${UP(drawn.length - 1)}\r` : "";
    for (let i = 0; i < span; i += 1) {
      text += ERASE + (rows[i] ?? "");
      if (i < span - 1) text += "\r\n";
    }
    if (span > rows.length) text += UP(span - rows.length);
    out.write(`${text}\r`);
    drawn = rows;
  };

  /**
   * Takes the block down, in one write, so `text` lands where the block's first row was. `text` is
   * a line to keep, or "" for the block alone.
   *
   * Every newline in it becomes a carriage return and a newline: raw mode turns off the output
   * translation that would otherwise supply the return, so a line ending in a bare `\n` leaves the
   * cursor at the column it ended on and the block redrawn under it starts there too.
   */
  const over = (text) => {
    const line = text ? `${text}\n` : "";
    // A resize since the last frame means the rows on screen have wrapped and their count is no
    // longer what walking back up assumes. Leaving them is a one-time smear; walking up by a
    // number that is now wrong erases rows belonging to the scrollback above.
    if (live && drawn.length && resized()) drawn = [];
    if (!live || !drawn.length) {
      if (line) out.write(live ? line.replace(/\n/g, "\r\n") : line);
      return;
    }
    let blank = `${UP(drawn.length - 1)}\r`;
    for (let i = 0; i < drawn.length; i += 1) blank += ERASE + (i < drawn.length - 1 ? "\r\n" : "");
    blank += UP(drawn.length - 1);
    drawn = [];
    out.write(`${blank}\r${line.replace(/\n/g, "\r\n")}`);
  };

  const clear = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const remember = (event) => {
    open.feed.push(event);
    if (open.feed.length > FEED) open.feed.splice(0, open.feed.length - FEED);
  };

  /**
   * One chunk from the keyboard, which is not one keystroke: raw flowing mode delivers whatever
   * arrived in one read, so an autorepeat, two quick presses or a paste come through as `"es"` or
   * `"x"`. Compared whole, none of those matched anything — including the interrupt, which
   * raw mode has already taken off the OS's hands.
   */
  const keys = (chunk) => {
    const text = String(chunk);
    if (text.includes(CTRL_C)) return interrupt();
    let moved = false;
    for (const k of text) moved = press(k) || moved;
    if (moved) draw();
  };

  /**
   * Ctrl+C, by hand, because raw mode cleared the input flag that made the console deliver it.
   *
   * The teardown runs here rather than through a signal: `process.kill(process.pid, "SIGINT")` on
   * win32 does not raise a signal at all — libuv terminates the process outright — so neither the
   * SIGINT handler nor the `exit` handler would run, and the ticket would keep its in-progress
   * label with the session still attached to the worktree. `emit` reaches the same handlers a real
   * signal would, on every platform.
   */
  const interrupt = () => {
    api.stop();
    if (process.listenerCount("SIGINT")) process.emit("SIGINT");
    else process.exit(130);
  };

  /** @returns {boolean} whether the board has anything new to show */
  const press = (k) => {
    // Whatever follows the question answers it, and only `y` is a yes: a stray key parks nothing.
    if (view.parking === "confirm") {
      if (k === "y") askPark(true);
      else view.parking = false;
      return true;
    }
    if (k === "e") view.expanded = !view.expanded;
    else if (k === "s") askStop(!view.stopping);
    else if (k === "k" && ctx.number != null) {
      if (view.parking === "asked") askPark(false);
      else view.parking = "confirm";
    } else if (k === "w" && open?.wait) open.wait.wake();
    else if (k === "p" && ctx.pr) reveal(ctx.pr);
    else if (k === "o" && ctx.url) reveal(ctx.url);
    else if (k === "l" && ctx.log) reveal(ctx.log);
    else if (k === "t" && ctx.session) handOver(`claude --resume ${ctx.session} --fork-session`);
    else if (k === "c" && ctx.log) handOver([ctx.branch, ctx.log].filter(Boolean).join("\n"));
    else if (k === "r" && board.recap && !open?.wait) view.recap = !view.recap;
    else if (k === "?") view.help = !view.help;
    else return false;
    return true;
  };

  /** Copied, and printed too: a clipboard nothing confirmed is a key that seemed to do nothing. */
  const handOver = (text) => {
    copy(text);
    over(stepRow({ label: "copied", detail: text.replace(/\n/g, " · "), state: "done" }, t));
  };

  /**
   * The stop key's shape, for the one other key that changes what the loop does: the file is the
   * request, so it survives this process, and the bar follows the file rather than the press. It
   * names the ticket, so a request left behind cannot park the next one.
   */
  const askPark = (wanted) => {
    try {
      if (wanted) writeFileSync(PARK_FILE, `${ctx.number}\n`);
      else fs.rmSync(PARK_FILE, { force: true });
    } catch (e) {
      api.notice("park", `could not ${wanted ? "write" : "remove"} ${PARK_FILE} — ${e}`);
    }
    view.parking = parkAsked(ctx.number) ? "asked" : false;
  };

  /**
   * The same file a person would write by hand, so the key and the shell agree, and so a stop asked
   * for here survives this process dying before it acts on it. The flag follows the file rather
   * than leading it: a bar reading "stopping after this" over a write that failed is the board
   * promising something the loop will not do.
   */
  const askStop = (wanted) => {
    try {
      if (wanted) writeFileSync(STOP_FILE, "asked for from the board\n");
      else fs.rmSync(STOP_FILE, { force: true });
      view.stopping = wanted;
    } catch (e) {
      api.notice("stop", `could not ${wanted ? "write" : "remove"} ${STOP_FILE} — ${e}`);
      view.stopping = fs.existsSync(STOP_FILE);
    }
  };

  const listen = () => {
    if (raw || !live || !process.stdin.isTTY) return;
    try {
      process.stdin.setRawMode(true);
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", keys);
      // The keyboard must never be the reason the process is still alive.
      process.stdin.unref?.();
      raw = true;
    } catch {
      /* no keyboard is not a reason to stop printing */
    }
  };

  // `api.close()`, not `this.close()`: the object is destructured by its callers and `this` does
  // not survive that.
  const api = {
    // The painter this screen is drawing with, so a caller rendering a permanent line paints it
    // for the same terminal the live block is drawn for — one detection, not one per call site.
    // A getter, because a resize replaces it and a snapshot taken at start-up would outlive it.
    get theme() {
      return t;
    },
    say(line) {
      over(line);
      draw();
    },
    /** The supervisor's own word. Board content, so stdout and the scrollback, not stderr. */
    notice(label, text) {
      over(notice(label, text, t));
      draw();
    },
    warn(text) {
      // The block belongs to stdout and stderr cannot clear it, so the erase goes out on the
      // stream that owns it before the warning prints on the other one.
      over("");
      show();
      const said = text.endsWith("\n") ? text : `${text}\n`;
      err.write(live ? said.replace(/\n/g, "\r\n") : said);
      draw();
    },
    // The same entry point the keyboard uses, so what the key bar offers can be checked against
    // what a press actually does. `process.stdin` is not a terminal under the test runner, and a
    // bar pinned against a handler nothing can call is a bar that pins nothing.
    key: (k) => keys(k),
    /**
     * Whether this ticket still wants a header box, and a record that it has now had one. `main()`
     * re-enters `runTicket` once per handoff, and the screen is the only thing that outlives a
     * phase — the child process is new every time.
     */
    needsHeader(number) {
      if (headed === number) return false;
      headed = number;
      return true;
    },
    /** What the keys act on. Set once per ticket, beside its header. */
    context(next = {}) {
      const { spentMs, ...rest } = next;
      // A ticket's pull request outlives the session that opened it: the next phase is the same ticket.
      const pr = rest.number != null && rest.number === ctx.number ? ctx.pr : null;
      ctx = { number: null, url: null, log: null, branch: null, session: null, pr, since: spentMs == null ? null : Date.now() - spentMs, ...rest };
      view.stopping = fs.existsSync(STOP_FILE);
      view.parking = parkAsked(ctx.number) ? "asked" : false;
    },
    /** What outlives every ticket: the per-step medians, and the run's recap as a render. */
    board(fields) {
      board = { ...board, ...fields };
    },
    /** What a ticket learns after its header: the session it is on, the pull request it opened. */
    set(fields) {
      ctx = { ...ctx, ...fields };
    },
    /**
     * A hold, as one live row counting down rather than a line every quarter hour. `w` ends it
     * early. At a pipe there is no live row, so the returned `say` is the heartbeat instead.
     * @param {string|null} [then]
     */
    wait(label, until, then = null) {
      let wake;
      const woken = new Promise((r) => (wake = r));
      api.start(UNNAMED);
      open.wait = { label, until, wake, then };
      draw();
      return { woken, say: live ? null : (m) => api.notice("waiting", m) };
    },
    start(letter, round = null) {
      // A placeholder, not a phase: the first marker replaces it rather than closing it as one.
      if (open?.letter === UNNAMED) {
        clear();
        open = null;
      } else api.close();
      open = { letter, round, startedAt: Date.now(), said: null, recent: [], feed: [] };
      if (!live) return;
      listen();
      timer = setInterval(draw, REDRAW_MS);
      // A redraw must never be the reason the process is still alive.
      timer.unref?.();
      draw();
    },
    /** One tool call. Newest first, and what falls off the board is kept for the `e` key. */
    call(name, what) {
      if (!open) return;
      open.recent.unshift({ name, what });
      open.recent.length = Math.min(open.recent.length, RECENT);
      remember({ kind: "call", name, what });
      draw();
    },
    /** The session's own account of what it is doing — the only channel that says why. */
    said(text) {
      if (!open || !text) return;
      open.said = text;
      remember({ kind: "said", text });
      draw();
    },
    close(state = "done", detail = "") {
      if (!open) return;
      const ms = Date.now() - open.startedAt;
      const done = open.wait
        ? stepRow({ label: "waited", detail: open.wait.label, ms, state: "skipped" }, t)
        : phaseRow({ letter: open.letter, round: open.round, ms, state, detail }, t);
      clear();
      open = null;
      show();
      over(done);
    },
    stop() {
      clear();
      open = null;
      over("");
      show();
      setTitle("");
      if (!raw) return;
      try {
        process.stdin.setRawMode(false);
        process.stdin.off("data", keys);
      } catch {
        /* the terminal is going away anyway */
      }
      raw = false;
    },
  };
  return api;
}

/**
 * Hands a URL or a path to whatever the desktop opens it with. Never fatal, never awaited.
 *
 * On Windows the opener is `cmd`, and `spawn` only quotes an argument carrying whitespace or a
 * quote — so `&`, `|` and `^` would reach the shell as syntax. Both targets are ours today (a URL
 * from `gh`, a log path this file generated); this is the one place a string that is not entirely
 * ours is handed to a shell, so it is refused rather than escaped.
 */
function openExternally(target) {
  if (/[&|^<>"'`\r\n]/.test(target)) return;
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* a key that opens nothing is not a reason to stop the run */
  }
}

/** The platform's own clipboard command, fed on stdin. Never fatal, like `openExternally`. */
function toClipboard(text) {
  const [cmd, args] =
    process.platform === "win32" ? ["clip", []] : process.platform === "darwin" ? ["pbcopy", []] : ["xclip", ["-selection", "clipboard"]];
  try {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(text);
  } catch {
    /* a key that copies nothing is not a reason to stop the run */
  }
}

/**
 * One ticket's worth of the issue, for the header, the turn bound and the record. Covers the
 * resume path, which has no picker.
 *
 * The review rounds come from the same read, counted by `loop-derive`'s own parser. A second,
 * weaker copy lived here — no fence stripping, no sha — so a verdict quoted inside a code block
 * counted as a round the gate does not recognise, and the two answers drifted with nothing able to
 * notice.
 *
 * `reviewRounds: null` on a failed read, never 0: a count nobody could take is not a count of none.
 */
export function ticketFacts(number, exec = execFileSync) {
  try {
    const issue = JSON.parse(
      exec("gh",["issue", "view", String(number), "--json", "title,labels,url,comments,state,stateReason"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: SH_MAX_BUFFER,
        timeout: 30_000,
      }),
    );
    return {
      title: issue.title,
      url: issue.url,
      size: issue.labels.map((l) => l.name).find((n) => n.startsWith("size:")) ?? null,
      labels: issue.labels.map((l) => l.name),
      reviewRounds: reviewRounds(trustedComments(issue.comments ?? [])),
      totalHolds: totalHolds(trustedComments(issue.comments ?? [])),
      ciRounds: ciRedRounds(trustedComments(issue.comments ?? [])),
      state: issue.state,
      stateReason: issue.stateReason ?? null,
    };
  } catch {
    return { title: `ticket #${number}`, url: "", size: null, labels: null, reviewRounds: null, totalHolds: null, ciRounds: 0 };
  }
}

/**
 * Whether a task event says that task is over.
 *
 * A `task_updated` carries a status only when it is closing one; mid-run it says something else
 * entirely — a task flipping to the background — and reading that as "finished" empties the board
 * while the agent is still working.
 *
 * @param {{event: string, status: string|null}} fact
 */
export function closesTask({ event, status }) {
  if (event === "notification") return true;
  return event === "updated" && status !== null && status !== "in_progress";
}

/** A log too large or too broken to read is not worth ending a finished ticket over. */
function readUsageSplit(logPath) {
  try {
    return usageSplit(fs.readFileSync(logPath, "utf8"));
  } catch {
    return null;
  }
}


/**
 * How far into its turn budget a session may get in phase C with nothing committed.
 *
 * A fraction rather than a number, because the budget itself moves with the ticket's size and a
 * flat threshold either fires on turn one of an XL or never fires at all on an XS.
 */
export const UNCOMMITTED_SHARE = 0.35;

/**
 * Says so, once, when a build phase is spending turns without committing any of them.
 *
 * The one ticket in nineteen that produced nothing made 74 `Edit` calls, 16 `Write` calls, 10
 * `git add` calls and zero `git commit` calls across 121 turns, then reached phase E with an empty
 * branch. `loop-gate.mjs` catches that, at phase E, after the whole budget is spent; the supervisor
 * parses every line of the stream and can see it while there is still budget to act on.
 *
 * It cannot commit on the session's behalf — rule 11 forbids `git add -A` precisely because the
 * staging decisions are the session's — so it reports, and the reason reaches the ledger.
 *
 * @param {{phase: string|null, buildTurns: number, committed: boolean, warnedUncommitted: boolean,
 *   buildMsg?: string|null}} state
 * @param {{id?: string|null, calls: {name: string, command: string}[]}} fact
 * @param {number} budget the session's `--max-turns`
 * @param {(line: string) => void} warn
 */
export function watchBuild(state, fact, budget, warn) {
  if (state.committed || state.phase !== "C") return;
  if (fact.calls.some((c) => c.name === "Bash" && COMMITTING.test(c.command))) {
    state.committed = true;
    return;
  }
  if (fact.id != null && fact.id === state.buildMsg) return;
  state.buildMsg = fact.id;
  state.buildTurns += 1;
  if (state.warnedUncommitted || state.buildTurns < Math.round(budget * UNCOMMITTED_SHARE)) return;
  state.warnedUncommitted = true;
  warn(
    `${state.buildTurns} turns into phase C of a ${budget}-turn budget with no commit` +
      " — an unstaged edit is the only work this loop can lose",
  );
}

/** The `gh run rerun` commands the session itself ran — parsed, so a comment quoting one is not one. */
const rerunsIn = (calls) =>
  calls
    .filter((c) => !c.parent && (c.name === "Bash" || c.name === "PowerShell"))
    .flatMap((c) => commands(withoutQuotedBodies(c.command)))
    .filter((c) => c.cmd === "gh" && c.args[0] === "run" && c.args[1] === "rerun").length;

/**
 * Spawns one session and reports what it did.
 *
 * The phase comes from the session's own `PHASE <letter>` line. Inferring it from outside by
 * regexing its shell commands missed 74 of 131 markers, because `queue.md` itself prescribes
 * `git add -- <paths>` before committing and the anchored pattern never fired — and it cost a
 * `derive()` every twenty seconds, eight subprocesses a call, to draw a line nothing branches on.
 *
 * `spawnFn` is a parameter so a test can drive fixture lines through the whole path without a
 * `claude` binary.
 *
 * @param {Function} spawnFn
 * @param {{number: number, queue: object, size?: string|null, at?: string|null,
 *   screen?: ReturnType<typeof ticker>, facts?: Function, stallMs?: number, tick?: number,
 *   dir?: string}} opts
 */
export function runTicket(
  spawnFn,
  {
    number,
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
  const logPath = streamLog(number, dir);
  mkdirSync(dir, { recursive: true });
  const sink = createWriteStream(logPath, { flags: "a" });
  const startedAt = Date.now();

  const state = {
    phase: at,
    phaseAt: Date.now(),
    phases: {},
    result: null,
    declared: null,
    version: null,
    lastFactAt: Date.now(),
    asleepMs: 0,
    lastFact: null,
    reruns: 0,
    blocked: false,
    blockedUntil: 0,
    stalled: false,
    wrongModel: null,
    strayPlugin: null,
    accountError: null,
    apiErrorCode: null,
    stderr: "",
    /** Turns spent in phase C, and whether any of them committed. */
    buildTurns: 0,
    committed: false,
    warnedUncommitted: false,
    /** Subagents running right now, in the order they were last heard from. */
    tasks: new Map(),
  };

  /** Seconds in the phase just left, so the record carries where a night's time actually goes. */
  const closePhase = () => {
    if (!state.phase) return;
    const secs = Math.round((Date.now() - state.phaseAt) / 1000);
    state.phases[state.phase] = (state.phases[state.phase] ?? 0) + secs;
    state.phaseAt = Date.now();
  };

  const about = facts(number);
  // `reviewRounds` counts the verdicts already on the issue, so the round about to run is the next
  // one. Null when the tracker could not be read — a number nobody could take is not a count of none.
  const round = () => {
    if (state.phase === "D" && about.reviewRounds != null) return { n: about.reviewRounds + 1, of: MAX_REVIEW_ROUNDS };
    // `retryCount` red CI runs so far is that many fixes, out of the runs after the first.
    if (state.phase === "C" && fix) return { n: Math.max(1, retryCount), of: CI_ROUNDS - 1, fix: true };
    return null;
  };

  if (screen.needsHeader(number)) screen.say(header({ number, ...about, queue }, screen.theme));
  const spentMs = ticketTally(number, readLedger(ledgerPath(undefined, dir))).ms;
  screen.context({ number, url: about.url, log: logPath, branch: branchOf(number), spentMs });
  if (at) {
    // Opened here, not left for the session's own marker: `state.phase` is already this letter, so
    // the marker is read as "no change" and the board stays dark for the whole of that phase.
    screen.start(at, round());
  } else {
    // The board's only state was "a phase is open", so the spawn, the session's start-up, and the
    // whole run if a marker is missed had nowhere to go and printed as a blank screen under the
    // header. An unnamed row carries the same clock and tool detail, and says no phase is named yet.
    screen.start(UNNAMED);
  }

  const budget = turnsFor(size);
  const planned = plannedModel(at);
  const child = spawnFn("claude", queueLoopArgs(number, size, at), {
    stdio: ["ignore", "pipe", "pipe"],
    // A background update landing at 2am changes the system prompt, and every remaining ticket of
    // the night then rebuilds its cached prefix at full price, with nothing to see. Whether to
    // update is a decision for a person between runs.
    //
    // `LOOP_TURNS` is the bound that actually stops a session, and it was invisible to the session
    // subject to it: the word "turn" appeared in none of queue.md, RULES.md, checks.md or CLAUDE.md,
    // so phase C's commit rule arrived with no stated reason to hurry.
    env: {
      ...process.env,
      DISABLE_AUTOUPDATER: "1",
      LOOP_TURNS: String(budget),
      LOOP_TICKET: String(number),
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(contextFor(size)),
      // A is where derive() starts anyway; handing it would pin a rebuilt worktree to A.
      LOOP_PHASE: at && at !== "A" ? at : undefined,
      LOOP_REASON: reason ?? undefined,
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
    },
  });

  // Mirrored, not swallowed: a crash must still print itself. Through the screen, because this is
  // the highest-volume writer there is while the live phase line is turning.
  child.stderr?.on("data", (chunk) => {
    state.stderr += chunk;
    screen.warn(String(chunk));
  });

  createInterface({ input: child.stdout }).on("line", (line) => {
    sink.write(`${line}\n`);
    state.lastFactAt = Date.now();
    const fact = readLine(line);
    if (!fact) return;
    state.lastFact = fact.kind;
    if (fact.kind === "init") {
      state.version = fact.version;
      screen.set({ session: fact.sessionId });
      const family = fact.model ? familyOf(fact.model) : null;
      if (fact.model && !family) screen.warn(`the session started on ${fact.model}, a model of no known family\n`);
      const stray = strayPlugins(fact.plugins ?? []);
      if (stray.length && !state.strayPlugin) {
        state.strayPlugin =
          `the session loaded ${stray.join(", ")}, which tools/loop/loop-settings.json does not turn on —` +
          " set each to false there, or true if the loop needs it";
      } else if (family && family !== planned && !state.wrongModel) {
        state.wrongModel = `the session started on ${fact.model}, but phase ${at ?? "A"} runs on ${planned}`;
      }
      if (state.strayPlugin || state.wrongModel) {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
      }
    }
    if (fact.kind === "assistant") {
      const letter = fact.letter ?? (state.phase === "B" && scopeEnds(fact.calls) ? "C" : null);
      if (letter && letter !== state.phase) {
        closePhase();
        state.phase = letter;
        screen.start(letter, round());
      }
      if (fact.declared) state.declared = fact.declared;
      state.reruns += rerunsIn(fact.calls);
      // The only sign of life during phase D, which is the longest one and the one that read as a
      // hang: its work happens entirely inside a review subagent.
      // Both halves, in the order a person reads them: what the session said about what it is
      // doing, then the calls it made saying it. Only two markers were ever taken out of the text
      // and the rest — the one channel that says *why* — was thrown away.
      screen.said(thought(fact.text));
      for (const call of fact.calls) screen.call(call.name, act(call));
      watchBuild(state, fact, budget, (m) => screen.notice("uncommitted", m));
    }
    // A foreground subagent emits nothing else into the parent stream, so without these the phase
    // line freezes on its last fact for the whole of phase D — 78% of a run's clock — and a working
    // session is indistinguishable from a hung one. The watchdog was never the problem: every raw
    // line already refreshes `lastFactAt`. The board was.
    if (fact.kind === "task") {
      if (closesTask(fact)) state.tasks.delete(fact.id);
      else {
        // Deleted before set, so the insertion order stays "least recently heard from first" and
        // the detail names the agent that just moved.
        state.tasks.delete(fact.id);
        state.tasks.set(fact.id, fact);
      }
      const detail = tasksDetail([...state.tasks.values()]);
      if (detail) screen.said(detail);
    }
    // A session emits one result per turn, and a background task's wake-up is a turn. The real one
    // carries `origin: null`; every other carries origin.kind "task-notification". Last-wins
    // across all of them reported a 144-turn session as one turn.
    if (fact.kind === "api_error") {
      screen.said(thought(fact.text));
      if (ACCOUNT_ERRORS.has(fact.code)) state.accountError ??= `${fact.code}: ${fact.text}`;
      state.apiErrorCode = fact.code;
    }
    if (fact.kind === "result" && !fact.origin) {
      state.result = fact;
      if (fact.declared) state.declared = fact.declared;
    }
    if (fact.kind === "rate_limit") {
      // Cleared on the next reading that is not a refusal: a session refused early that recovers
      // and pushes has done its work, and a sticky flag pre-empts every other reading of it.
      if (!fact.blocked && state.blocked) {
        state.blocked = false;
        state.blockedUntil = 0;
      }
      if (fact.blocked && !state.blocked) {
        state.blocked = true;
        state.blockedUntil = fact.resetsAtMs ?? 0;
        screen.say(
          closing({
            outcome: "rate_limited",
            number,
            why: `the ${fact.window ?? "usage"} limit is spent — resets ${clockAt(fact.resetsAt)}`,
            ms: 0,
            cost: 0,
          },
          screen.theme,
        ),
        );
      }
    }
  });

  return new Promise((resolve) => {
    // SIGTERM, not SIGINT: the docs give SIGTERM as the one that terminates the process tree of a
    // still-running Bash command and then runs SessionEnd, which is what a wedged session needs.
    // SIGINT only ends the turn, and a session with nothing to end ignores it.
    const clock = sleepClock(tick);
    const watchdog = setInterval(() => {
      const slept = clock.lap();
      const now = Date.now();
      state.asleepMs += slept;
      state.lastFactAt = Math.min(now, state.lastFactAt + slept);
      if (now - state.lastFactAt <= stallMs) return;
      state.stalled = true;
      clearInterval(watchdog);
      // Windows' SIGTERM takes `claude.exe` alone, and a grandchild left holding its stdout keeps
      // `close` from ever firing: 92 min on #1389, 260 on #1268. So the tree, then a deadline.
      if (process.platform === "win32" && child.pid) {
        try {
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } catch {
          /* already gone */
        }
      } else child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
        child.stdout.destroy();
        child.stderr.destroy();
        finish(null);
      }, killGraceMs).unref();
    }, tick);
    watchdog.unref();

    let finished = false;
    child.on("close", (status) => finish(status));
    function finish(status) {
      if (finished) return;
      finished = true;
      clearInterval(watchdog);
      closePhase();
      // The phase the session was in when it exited: closed here because the session emits no
      // marker for a phase it did not finish, and a mark of its own because a ✓ on a session that
      // stalled is the display saying the opposite of what happened.
      screen.close(state.stalled || status !== 0 ? "failed" : "done");
      // Resolved on the sink's own finish, not on the child's close: `end()` only asks, and a
      // caller reading the log it was just handed would otherwise find it short.
      sink.end(() =>
        resolve({
          status: state.stalled ? "stalled" : (status ?? 1),
          blocked: state.blocked,
          blockedUntil: state.blockedUntil,
          result: state.result,
          declared: state.declared,
          size,
          phase: state.phase,
          phases: state.phases,
          committed: state.committed,
          stderr: state.stderr,
          version: state.version,
          wrongModel: state.wrongModel,
          strayPlugin: state.strayPlugin,
          accountError: state.accountError,
          apiErrorCode: state.apiErrorCode,
          started: new Date(startedAt).toISOString(),
          ms: Date.now() - startedAt,
          asleepMs: state.asleepMs,
          lastFact: state.lastFact,
          reruns: state.reruns,
          log: logPath,
          // Read now rather than accumulated as the lines arrived: the sink has just closed, so the
          // file is complete and nothing is writing to it.
          usage: readUsageSplit(logPath),
        }),
      );
    }
  });
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

/**
 * One report file per run, named for when the run started — not per calendar day.
 *
 * A day is not a boundary the loop has: two processes on one day appended to the same file, so a
 * closing total landed in the middle of it with five more rows underneath, and a run that crossed
 * midnight opened its second file with the first one's total under the wrong heading.
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
 * @param {Function} [run]
 * @returns {{number: number, state: string, head: string, sha: string|null, changedFiles: number}|null}
 */
export function pushedPr(branch, ticket, declared = null, since = 0, run = sh) {
  // Matched on the head ref rather than by search: `#42` in a body also matches PR #942. With a
  // branch in hand `--head` is exact; without one the newest 100 are scanned, which reaches back
  // far enough for a branch pushed minutes ago. `gh` lists newest first.
  const json = ["--json", "number,state,headRefName,headRefOid,mergedAt,changedFiles"];
  // The head ref is the only thing that makes a pull request this ticket's, and it is checked on
  // every path including the declared one. `declared` is a number a model wrote into a line of
  // text, and what it reaches is `gh pr merge`.
  const mine = (pr) =>
    branch ? pr?.headRefName === branch : new RegExp(`^agent/${ticket}-`).test(pr?.headRefName ?? "");
  const stale = (pr) =>
    pr.state === "MERGED" && since > 0 && Date.parse(pr.mergedAt ?? "") < since;
  const take = (pr) =>
    pr && mine(pr) && !stale(pr)
      ? { number: pr.number, state: pr.state, head: pr.headRefName, sha: pr.headRefOid ?? null, changedFiles: pr.changedFiles ?? 0 }
      : null;
  const query = branch
    ? ["pr", "list", "--state", "all", "--head", branch, "--limit", "20", ...json]
    : ["pr", "list", "--state", "all", "--limit", "100", ...json];
  try {
    const rows = JSON.parse(run("gh", query)).filter((pr) => mine(pr) && !stale(pr));
    const found = take(
      rows.find((p) => p.state === "OPEN") ?? rows.find((p) => p.state === "MERGED") ?? rows[0],
    );
    if (found) return found;
  } catch {
    /* falls through to the declared number */
  }
  if (!declared) return null;
  try {
    return take(
      JSON.parse(run("gh", ["pr", "view", String(declared), "--json", "number,state,headRefName,headRefOid,changedFiles"])),
    );
  } catch {
    return null;
  }
}

/**
 * Separate budgets, not one. A branch updated twice because main moved twice is a healthy branch on a
 * busy night; a verdict asked for twice because the runner had nothing to say is a sick one; a
 * mergeability job still running is neither; and a run that has not registered yet is a push seconds
 * old. Sharing a counter parks whichever goes second. A run that *is* running spends none of these.
 */
export const SETTLE_ROUNDS = { update: 3, retry: 3, recheck: 8, appear: 12, ready: 2 };

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
  const { pause = SETTLE_PAUSE_MS, deadline = SETTLE.DEADLINE_MS, watch = poll } = opts;
  screen.start(LAND);
  screen.set({ pr: prUrl(pending.pr) });
  screen.said(`waiting for ci.yml on ${pending.branch}`);
  try {
    const out = await watch(pending, (m) => screen.said(m), pause, deadline);
    const landed = out.action === "already-merged";
    screen.close(landed ? "done" : "failed", landed ? `#${pending.pr} merged` : out.reason);
    return out;
  } catch (err) {
    // An open phase is a spinner with no end. Whatever else is wrong, the row has to settle.
    screen.close("failed", String(err.message).split("\n")[0]);
    throw err;
  }
}

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

/** Bounds each `gh` call `postCiRedOnce` makes, so a wedged one cannot stall the supervisor. */
const CI_RED_TIMEOUT_MS = 30_000;

/** Null when the tracker cannot be read, which is a reason to skip posting, never to post blind. */
function readTicketComments(ticket, run, log) {
  try {
    return trustedComments(
      JSON.parse(run("gh", ["issue", "view", String(ticket), "--json", "comments"], { timeout: CI_RED_TIMEOUT_MS })).comments,
    );
  } catch (err) {
    log(`CI-RED: could not read the tracker — ${String(err.message).split("\n")[0]}`);
    return null;
  }
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

/**
 * Posted once per red head, checked against the tracker rather than a local marker: the fix
 * session may run on another machine, or after a restart, and reads only the tracker.
 *
 * @returns {boolean} whether the tracker carries it now
 */
function postCiRedOnce(ticket, verdict, { onMain, flaky }, comments, run, write, log) {
  const sha = verdict.head;
  if (!comments) return false;
  if (!sha || ciRedPosted(comments, sha)) return true;
  const body = ciRedBody({
    sha,
    runUrl: `https://github.com/${REPO}/actions/runs/${verdict.runId}`,
    failedStep: verdict.failedStep,
    testIds: verdict.testIds ?? [],
    excerpt: verdict.output,
    onMain,
    flaky,
    runId: verdict.runId,
    logArgs: verdict.logArgs,
    reason: verdict.reason,
    attempt: verdict.attempt,
  });
  try {
    const file = ciRedNotePath(ticket);
    write(file, body, "utf8");
    run("gh", ["issue", "comment", String(ticket), "--body-file", file], { timeout: CI_RED_TIMEOUT_MS });
    return true;
  } catch (err) {
    log(`CI-RED: could not post — ${String(err.message).split("\n")[0]}`);
    return false;
  }
}

/** How many times `poll` reads the tracker and posts a CI-RED before it holds the red. */
const CI_RED_TRIES = 3;

/**
 * The CI log a fix round reads, written before the red is handed back: that session is a fresh
 * process with no way to ask this one anything. Then the `on main:` lines its CI-RED carries.
 * Never call it when `output` is the reason rather than the log: round one's real failure is
 * already in that file, and this would paint over it.
 */
function prepareRed(ticket, verdict, { mkdir, write, mainFailures, log }) {
  try {
    mkdir(DIR, { recursive: true });
    write(ciLogPath(ticket), verdict.output, "utf8");
  } catch (err) {
    log(`CI-RED: could not write the CI log — ${firstLine(err)}`);
  }
  const failing = verdict.testIds ?? [];
  const main = failing.length ? mainFailures() : null;
  return { onMain: onMainLine(failing, main?.flaky ? null : main), flaky: onMainLine(failing, main?.flaky ? main : null) };
}

/** A held red's CI-RED, posted by the supervisor from the run itself; whether the tracker carries it now. */
function postHeldRed(ticket, pr, log) {
  const run = (file, args, opts) => sh(file, args, { timeout: CI_RED_TIMEOUT_MS, ...opts });
  try {
    const { ci } = ts("./ciVerdict.ts").readLandingState(REPO, pr);
    if (ci.pass || ci.waiting || ci.infrastructure || !ci.output || ci.logUnread) return false;
    const mainFailures = () => ts("./mainHealth.ts").mainFailures((args) => run("gh", args), REPO);
    const lines = prepareRed(ticket, ci, { mkdir: mkdirSync, write: writeFileSync, mainFailures, log });
    return postCiRedOnce(ticket, ci, lines, readTicketComments(ticket, run, log), run, writeFileSync, log);
  } catch (err) {
    log(`CI-RED: could not read #${pr}'s red — ${firstLine(err)}`);
    return false;
  }
}

/** What a red a rerun turned green failed on, one name per issue: its tests, or its step when it named none. */
const flakeNames = ({ tests, step }) => (tests.length ? tests : [`${step ?? "an unnamed step"} (no test named)`]);

const FLAKES_PER_RUN = 3;

const flakeLine = (red) => `Merged on a rerun's green: attempt 1 of ci.yml run ${red.runId} failed ${flakeNames(red).join(", ")}.`;

/**
 * One open issue per flaky test, found by its exact title in a listing of every open issue: GitHub's
 * search trails its own writes, and promoting one swaps its label. `ready-for-human`, not
 * `ci-flake`: ADR 0011 keeps that label, and the rank it carries, the owner's to add.
 */
function fileFlakes(red, gh, log) {
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
      ...(titles.length < names.length ? ["", ...names.map((n) => `- ${n}`)] : []),
      "",
      "Filed by the supervisor (`tools/loop/queue-loop.mjs`). The title is what stops a second issue for the same failure, so keep it.",
    ].join("\n");
    try {
      gh(["issue", "create", "--repo", REPO, "--title", title, "--body", body, "--label", "ready-for-human"]);
      log(`filed ${title}`);
    } catch (err) {
      log(`could not file ${title} — ${firstLine(err)}`);
    }
  }
}

/** A `gh` failure that is the network's, not GitHub's answer: `execFileSync` puts it in `stderr` or `code`. */
const OFFLINE = /error connecting to|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|i\/o timeout|TLS handshake timeout/i;

const firstLine = (err) => String(err?.message ?? err).split("\n")[0];

/** The ticket's stream, every process of it, as facts. */
function streamFacts(ticket) {
  const file = streamLog(ticket);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").map(readLine).filter(Boolean) : [];
}

/**
 * Settles a pushed pull request: waits on its `CI gate`, arms GitHub's auto-merge on a green head
 * that review cleared, and reruns a red once before handing it back.
 *
 * **Armed is a state no session may push into.** GitHub merges whatever head carries the arm once
 * the gate passes, so every exit but the merge disarms first, and a red is disarmed before its
 * CI-RED is posted — that comment is what starts a fix round, here or after a restart.
 */
export async function poll(pending, log, pause, deadline, io = {}) {
  const {
    run = sh,
    stateOf = (pr) => ts("./ciVerdict.ts").readLandingState(REPO, pr),
    write = writeFileSync,
    mkdir = mkdirSync,
    mainFailures = () =>
      ts("./mainHealth.ts").mainFailures((args) => run("gh", args, { timeout: CI_RED_TIMEOUT_MS }), REPO),
    facts = () => streamFacts(pending.ticket),
    cleared = (sha) => {
      const comments = readTicketComments(pending.ticket, run, log);
      try {
        run("git", ["fetch", "--quiet", "origin", pending.branch, "main"], { timeout: REFRESH_TIMEOUT_MS });
      } catch (err) {
        return { ok: false, why: `could not fetch ${pending.branch} — ${firstLine(err)}` };
      }
      const v = landable(comments, sha, (args) => run("git", args).trim());
      if (!v.ok || reviewerRan(facts(), pending.ticket)) return v;
      return { ok: false, why: `no loop-review or loop-fix completed for #${pending.ticket} since its last build` };
    },
  } = io;
  const { armArgs, branchSurvives, deleteBranchArgs, disarmArgs, landing } = ts("./land.ts");
  const gh = (args) => run("gh", args, { timeout: CI_RED_TIMEOUT_MS });
  const spent = { update: 0, retry: 0, recheck: 0, appear: 0, ready: 0 };
  let until = Date.now() + deadline;
  let woke = false;
  let head = null;
  let armed = false;
  let armedAt = null;
  let reran = null;
  let firstRed = null;
  // Only the pause is measured for a standby: a `gh` call that took long is real time and counts.
  const wait = async () => {
    const clock = sleepClock(pause);
    // Not unref'd, for the same reason `holdFor` is not: this is the only handle open while it waits.
    await new Promise((r) => setTimeout(r, pause));
    const slept = clock.lap();
    until += slept;
    woke ||= slept > 0;
  };
  let verdict = {};
  const owner = (reason) => ({ action: "owner", reason, runId: verdict.runId ?? null, head, ...(flake && { flake }) });
  let flake = null;
  const merged = (reason) => {
    if (pending.branch) {
      try {
        gh(deleteBranchArgs(REPO, pending.branch));
      } catch {
        // Already gone is the common refusal, and `ls-remote` below is the judge either way.
      }
      try {
        if (branchSurvives(run("git", ["ls-remote", "origin", pending.branch], { timeout: REFRESH_TIMEOUT_MS }))) {
          log(`⚠️ #${pending.ticket} ${pending.branch} is still on origin after its merge`);
        }
      } catch {
        // An unreadable `ls-remote` is not evidence of a survivor.
      }
    }
    if (flake) fileFlakes({ ...firstRed, ticket: pending.ticket, pr: pending.pr }, gh, log);
    return { action: "already-merged", reason, ...(flake && { flake }) };
  };
  /**
   * Null once nothing is armed; the owner's otherwise, since GitHub may still merge what is. A
   * refusal is asked about: GitHub refuses to disarm what never armed, and what already merged.
   */
  const disarm = (then) => {
    if (!armed) return null;
    try {
      gh(disarmArgs(REPO, pending.pr));
      armed = false;
      return null;
    } catch (err) {
      try {
        const now = stateOf(pending.pr).pr;
        if (now.state === "MERGED") {
          armed = false;
          return merged("the pull request merged before it could be disarmed");
        }
        if (now.armed !== true) {
          armed = false;
          return null;
        }
      } catch {
        // Unread is not unarmed.
      }
      return owner(`could not disarm auto-merge — ${firstLine(err)}; it may still merge${then ? ` — ${then}` : ""}`);
    }
  };
  const leave = (out) => disarm(out.reason) ?? out;

  const handBack = async (next) => {
    const held = disarm(next.reason);
    if (held) return held;
    const lines = prepareRed(pending.ticket, verdict, { mkdir, write, mainFailures, log });
    for (let tries = 1; !postCiRedOnce(pending.ticket, verdict, lines, readTicketComments(pending.ticket, run, log), run, write, log); tries++) {
      // A hand-back without its CI-RED is a fix round nothing starts; a hold leaves the red for the next pick to read.
      if (tries === CI_RED_TRIES) return { action: "hold", reason: `CI-RED for ${String(head).slice(0, 7)} could not be posted`, head, runId: verdict.runId ?? null };
      await wait();
    }
    return { ...next, head, runId: verdict.runId ?? null };
  };

  for (;;) {
    let next = null;
    let error = null;
    const overdue = Date.now() > until;
    if (!overdue) {
      try {
        let pr;
        ({ pr, ci: verdict } = stateOf(pending.pr));
        armed = pr.armed === true;
        if (pr.headRefOid !== head) {
          head = pr.headRefOid ?? null;
          until = Date.now() + deadline;
        }
        if (verdict.progress) log(ciLine(pending.pr, verdict.progress));
        // `--match-head-commit` is checked when GitHub arms, not again when it merges: an arm outlives
        // no head but the one cleared. An arm this process did not make is treated the same way.
        if (armed && armedAt !== head) {
          const held = disarm(`the head moved to ${String(head).slice(0, 7)} under the arm`);
          if (held) return held;
          pr = { ...pr, armed: false };
        }
        next = landing(pr, verdict);
        woke = false;
      } catch (err) {
        // A machine waking from standby has no network for minutes to hours; the deadline still bounds it.
        error = { why: firstLine(err), offline: OFFLINE.test(`${err.code ?? ""} ${err.message} ${err.stderr ?? ""}`), woke };
      }
    }
    // Landing reads move no run counter.
    const read = { step: "landing", limits: LIMITS, loop: {} };
    const facts = { ...next, head, armed, overdue, deadline, rounds: spent, ci: verdict, error, reran, cleared: undefined };
    let step = decide({ ...read, landing: facts });
    if (step.kind === "ask") step = decide({ ...read, landing: { ...facts, cleared: cleared(head) } });

    if (step.kind === "settled") {
      if (step.action === "hand-back") return handBack(next);
      if (step.action === "owner") return leave(owner(step.why));
      if (step.action === "already-merged") return merged(step.why);
      return next;
    }
    if (step.spend) spent[step.spend] += 1;
    if (step.act === "rerun") {
      reran = head;
      firstRed = { runId: verdict.runId, tests: verdict.testIds ?? [], step: verdict.failedStep ?? null };
      try {
        gh(["run", "rerun", String(verdict.runId), "--failed", "--repo", REPO]);
      } catch (err) {
        log(`could not rerun ${verdict.runId} — ${firstLine(err)}; handing the red back`);
        return handBack(next);
      }
      until = Date.now() + deadline;
    } else if (step.act === "update-branch") {
      // The merge of main is a new head nobody cleared, and an arm would carry over to it.
      const held = disarm(next.reason);
      if (held) return held;
      log(step.why);
      try {
        gh(["pr", "update-branch", String(pending.pr)]);
      } catch (err) {
        return leave(owner(`could not update the branch — ${firstLine(err)}`));
      }
    } else if (step.act === "ready") {
      try {
        gh(["pr", "ready", String(pending.pr), "--repo", REPO]);
      } catch (err) {
        return leave(owner(`could not mark the draft ready — ${firstLine(err)}`));
      }
    } else if (step.act === "arm") {
      const at = String(head ?? "an unread head").slice(0, 7);
      // A green this process's rerun won: named in the merge and on the row; filed once it has merged.
      if (reran === head && firstRed && !flake) flake = { runId: firstRed.runId, tests: firstRed.tests };
      const argv = armArgs(REPO, pending.pr, head, flake ? flakeLine(firstRed) : undefined);
      // An arm whose answer was lost may have taken effect, so every way out disarms from here on.
      armed = "maybe";
      armedAt = head;
      try {
        gh(argv);
        armed = true;
        log(`auto-merge armed at ${at}`);
      } catch (err) {
        // GitHub refuses `--auto` where auto-merge is off or the head is already mergeable; the
        // gate is green here, and `--match-head-commit` still binds the merge to the cleared head.
        log(`could not arm auto-merge — ${firstLine(err)}; merging ${at} directly`);
        try {
          gh(argv.filter((a) => a !== "--auto"));
        } catch (again) {
          return leave(owner(`the merge failed — ${firstLine(again)}`));
        }
      }
    }
    if (step.act === "rerun" || step.act === "wait") log(step.why);
    await wait();
  }
}

/** Where the ticket stood when its session exited, as far as git and the tracker can still say. */
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
      }
    : null;
};

/** The ticket's worktree as git has it now: a retry or refused pass carries none of it. */
function worktreeOf(io, number) {
  try {
    const at = io.standing();
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
 * @param {object} io
 * @param {number} number
 * @param {{phase: string, why: string, log: string, cwd: string|null, branch: string|null,
 *   dirty: boolean, run?: object, pr?: number|null, files?: number}} ctx `run` only when this park
 *   is the session's own row; otherwise its cost is already recorded and the row carries none.
 */
export function parkAndRecord(io, number, { run = null, pr = null, files = 0, flake = null, ...ctx }) {
  io.bell();
  const failed = io.park(number, { ...ctx, error: run ? errorOf(run) : null })?.failed ?? [];
  if (failed.length) io.log(`#${number}'s park did not reach the tracker (${failed.join(", ")}) — applied again at the start of each pass`, "park");
  io.record({
    number,
    outcome: "parked",
    why: ctx.why,
    run: run ?? { result: null, ms: 0, log: ctx.log, phases: {} },
    pr,
    files,
    counts: true,
    parkFailed: failed.length ? failed : null,
    flake,
  });
  return { outcome: "parked", ticket: number, why: ctx.why };
}

const LIMITS = { BREAKER, CI_ROUNDS, MAX_HANDOFFS, USD_BY_SIZE, USD_DEFAULT, WAIT, ROUNDS: SETTLE_ROUNDS };

/** Read in order, and only as far as the first that ends the pass. */
async function preflight(io, pinned) {
  if (io.stopFile()) return { stop: true };
  if (!io.syncCheckout(pinned)) return { unusable: true };
  const moved = io.loopMoved?.();
  if (moved) return { moved };
  return { housekeeping: await io.housekeeping(pinned) };
}

const HELD_AS = { preflight: "hold", usage: "refused", api: "overloaded" };

/** The passes that leave the ticket standing, which the owner's park takes over. */
const PARKABLE = new Set(["handoff", "retry", "refused", "overloaded", "hold"]);

/**
 * One ticket, start to finish. Serialised deliberately: overlapping the next ticket with the last
 * one's CI wait buys ~22% wall clock and costs pending state nothing recovers when the process
 * dies, a worktree released under a live `derive()`, and two sessions cutting branches from a
 * `main` neither has yet.
 *
 * Every routing choice is `decide()`'s: this reads the facts it asks for and does what it answers.
 *
 * @param {object} io
 * @param {number|null} [pinned] a ticket a previous pass handed back unfinished
 * @param {string|null} [at] the phase a handoff said the next process starts at
 * @param {{failures: number, holds: number, waits: number, overloads: number, pinned: number|null}} [loop]
 *   the run's counters, which the pass returns updated
 * @returns {Promise<{outcome: "landed"|"closed"|"parked"|"stop"|"hold"|"retry"|"refused"|"overloaded"|"handoff"|"restart",
 *   loop: object, halt: string|null, ticket?: number, why?: string, until?: number, hold?: number, byOwner?: boolean,
 *   cwd?: string|null, branch?: string|null, pr?: number, files?: number, phase?: string, run?: any, size?: string|null}>}
 */
export async function runOnce(io, pinned = null, at = null, loop = { failures: 0, holds: 0, waits: 0, overloads: 0, pinned }) {
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

  const begun = decideAt("pre", { pre: await preflight(io, pinned) });
  if (begun.kind !== "go") return pass(begun);

  let route = io.pick(pinned, at);
  let picking = { route: { ...route, n: route.number }, tally: io.tally(route.number), repicked: false };
  let picked = decideAt("pick", picking);
  if (picked.kind === "repick") {
    io.teardown(route.cwd, route.number);
    route = io.pick(loop.pinned, loop.pinned === null ? null : at);
    picking = { route: { ...route, n: route.number }, tally: io.tally(route.number), repicked: true };
    picked = decideAt("pick", picking);
  }
  const n = route.number;
  const ticket = { ...route, n };
  const size = route.size ?? null;
  const owner = () => (parkAsked(n) ? { asked: true, own: worktreeOf(io, n) } : { asked: false, own: null });
  const parkHere = (action, ctx) => {
    if (action.byOwner) fs.rmSync(PARK_FILE, { force: true });
    const parked = parkAndRecord(io, n, { ...ctx, phase: action.phase, why: action.why });
    return { ...parked, loop, halt: action.halt ?? null, ...(action.byOwner && { byOwner: true }) };
  };
  // A cap's or the owner's park comes after the row of what it replaced, and carries the worktree
  // with it: a handoff leaves one standing on purpose, so a park without it leaves `derive()` a live
  // run to resume.
  const parkOver = (over, own, log) => parkHere(over, { ...(own ?? worktreeOf(io, n)), log });
  if (picked.kind === "ask") {
    picking = { ...picking, posted: Boolean(io.postRed(n, route.unposted)), ...owner() };
    picked = decideAt("pick", picking);
  }
  let { tally } = picking;
  const unrun = { log: streamLog(n), cwd: route.cwd ?? null, branch: route.branch ?? null, dirty: route.dirty ?? false };
  if (picked.kind === "park") return picked.instead ? parkOver(picked, picking.own, streamLog(n)) : parkHere(picked, unrun);
  if (picked.kind !== "go") return pass(picked);

  if (picked.redWhileDown) {
    io.record({
      number: n,
      outcome: "retry",
      why: "CI went red while the loop was down",
      run: { result: null, ms: 0, log: streamLog(n), phases: {} },
      counts: false,
      head: route.head,
    });
    tally = io.tally(n);
  }
  if (route.fix) {
    let error = null;
    try {
      io.refreshWorktree(route.cwd, route.branch);
    } catch (err) {
      error = String(err.stderr || err.message).trim().split("\n")[0];
    }
    const refreshed = decideAt("refresh", { route: ticket, error });
    if (refreshed.kind === "park") return parkHere(refreshed, unrun);
  }

  const settling = route.phase === "G";
  if (settling) io.announce(route);
  const run = settling
    ? { status: 0, result: null, declared: null, ms: 0, log: streamLog(route.number), phase: "G", phases: {} }
    : await io.spawn({
        ...route,
        retryCount: Math.max(tally.retries, tally.ciRounds ?? 0),
        reason: route.phase === tally.lastHandoff ? tally.handoffWhy : null,
      });

  const dirtied = io.sharedCheckoutDirty?.();
  if (dirtied) io.log(`#${route.number}'s session left the shared checkout dirty:\n${dirtied}`, "session");

  const derived = io.standing();
  const after = afterSession(run, derived);
  const keepWip = () => {
    try {
      const kept = io.snapshotWip?.(after?.cwd ?? null, n);
      if (kept) io.log(`#${n}'s uncommitted work is kept at refs/loop/wip/${n} (${kept.slice(0, 7)})`, "session");
    } catch (err) {
      io.log(`#${n}'s uncommitted work could not be snapshotted — ${String(err.message).split("\n")[0]}`, "session");
    }
  };
  // Read once the session has exited: a park is never a kill.
  const facts = { route: ticket, run: settling ? null : run, after: derived, tally, ...owner() };
  // `null`, never `undefined`, for a fact read: `undefined` is `decide`'s "not read yet".
  const read = {
    built: () => {
      const built = Boolean(io.buildPassed(after?.cwd ?? null, n));
      if (!built) io.log(`#${n} handed off to review with no local pass or no full DOD-CHECK on HEAD — back to C`, "build");
      return built;
    },
    pushed: () => io.pushedPr(after?.branch ?? null, n, run.declared?.pr ?? null, settling ? 0 : Date.now() - run.ms) ?? null,
    issue: () => io.issueState(n) ?? null,
  };
  let action = decideAt("session", facts);
  while (action.kind === "ask") {
    facts[action.fact] = read[action.fact]();
    action = decideAt("session", facts);
  }

  // The pull request's own count when derive() read no worktree.
  const files = () => (facts.pushed === undefined ? 0 : after?.changed?.length || facts.pushed?.changedFiles || 0);
  let billed = run;
  const worked = (pr, log = billed.log) => ({ log, cwd: after?.cwd ?? null, branch: after?.branch ?? null, dirty: after?.dirty ?? false, run: billed, pr: pr ?? null, files: files() });

  const replaced = action.instead ?? action;
  if (replaced.kind === "handoff" || replaced.kind === "hold") {
    if (replaced.kind === "handoff") {
      // CI runs while the review does; `poll` merges only a head a LAND covers.
      if (replaced.publish) io.publish(n, after.branch, after.cwd);
      const why = `phase ${replaced.phase} next${replaced.why ? ` — ${replaced.why}` : ""}`;
      io.record({ number: n, outcome: "handoff", why, run, counts: false, handoff: { phase: replaced.phase, why: replaced.why, said: replaced.said } });
    } else {
      keepWip();
      // A refusal spends real money before it stops, and this row is the one place it is recorded.
      io.record({ number: n, outcome: HELD_AS[replaced.wait], why: replaced.why, run, counts: false });
    }
    if (action.kind === "park") return parkOver(action, facts.own, run.log);
    if (action.kind === "handoff") return pass(action, { phase: action.phase, run, size, cwd: after?.cwd ?? null, branch: after?.branch ?? null });
    return pass(action, { run, until: replaced.until });
  }
  if (action.kind === "stop") {
    if (run.accountError) keepWip();
    io.record({ number: n, outcome: "halted", why: run.strayPlugin ?? run.accountError, run, counts: false });
    return pass(action);
  }
  if (action.kind === "park") return parkHere(action, worked(action.pr));
  if (action.kind === "closed") {
    io.teardown(after?.cwd ?? null, n);
    io.record({ number: n, outcome: "closed", why: action.why, run, files: files() });
    return pass(action);
  }
  if (action.kind === "landed") {
    io.teardown(after?.cwd ?? null, n);
    io.record({ number: n, outcome: "landed", why: action.why, run, pr: action.pr, merged: true, files: files() });
    return pass(action);
  }

  // The session's own row, before a wait the supervisor may not survive: every row below is the
  // land alone, so a restarted G pass adds its clock and never the session's cost a second time.
  if (!settling) {
    io.record({ number: n, outcome: "pushed", why: "CI next", run, pr: action.pr, files: files(), counts: false, head: action.head });
    billed = { result: null, ms: 0, log: run.log, phases: {} };
  }
  const landFrom = Date.now();
  const settled = await io.settle({ ticket: n, pr: action.pr, branch: after?.branch ?? facts.pushed.head });
  billed.ms += Date.now() - landFrom;
  // What the next round is judged against: a round that leaves this where it was cannot change
  // what CI answers.
  const head = settled.head ?? facts.pushed?.sha ?? null;
  const owned = owner();
  const verdict = decideAt("settled", { route: ticket, settled: { ...settled, head }, tally: io.tally(n), ...owned });
  const red = verdict.instead ?? verdict;
  if (red.kind === "retry" || red.record === "retry") {
    io.record({ number: n, outcome: "retry", why: settled.reason, run: billed, pr: action.pr, merged: false, files: files(), counts: false, head, flake: settled.flake ?? null });
    if (verdict.kind === "park") return parkOver(verdict, owned.own, red.kind === "hold" ? streamLog(n) : run.log);
    // The worktree and the run come with it: the next round works in that worktree.
    if (verdict.kind === "retry") {
      return pass(verdict, { cwd: after?.cwd ?? null, branch: after?.branch ?? facts.pushed.head, pr: action.pr, sha: head, files: files(), run, size });
    }
    return pass(verdict);
  }
  if (verdict.kind === "landed") {
    io.record({ number: n, outcome: "landed", why: settled.reason, run: billed, pr: action.pr, merged: true, files: files(), counts: true, head, flake: settled.flake ?? null });
    io.teardown(after?.cwd ?? null, n);
    return pass(verdict);
  }
  // The failed CI log, when there is one: it is what the owner needs and the session's own stream
  // log is not.
  const log = verdict.ciRed && fs.existsSync(ciLogPath(n)) ? ciLogPath(n) : billed.log;
  return parkHere(verdict, { ...worked(action.pr, log), flake: verdict.ciRed ? null : (settled.flake ?? null) });
}

/** The real IO, bound once so `runOnce` can be driven without git, the tracker or a binary. */
function realIo(book, screen) {
  // The queue as the *previous* pick read it. The direction is what a night is made of, and this
  // is the one reading that costs nothing — the next pick is being made anyway.
  let before = null;
  let picked = null;
  const started = loopSha();
  return {
    stopFile: () => takeStopFile(fs, STOP_FILE),
    loopMoved: () => loopMoved(started),
    snapshotWip,
    syncCheckout: (pinned) => syncCheckout(git, (m) => screen.notice("checkout", m), undefined, { pinned }),
    housekeeping: (pinned) =>
      housekeeping({
        pinned,
        say: (row) => screen.say([stepRow(row, screen.theme), ...(row.note?.trim() ? [note(row.note, screen.theme)] : [])].join("\n")),
      }),
    parity: () => parityRed(),
    issueState: (n) => {
      const f = ticketFacts(n);
      return { state: f.state ?? null, stateReason: f.stateReason ?? null };
    },
    pick: (pinned, at) => {
      const route = nextRoute(pinned, at);
      picked = route;
      if (route.resuming) return route;
      if (before) screen.say(recap(book.totals, before, route.queue, screen.theme));
      before = route.queue;
      return route;
    },
    spawn: (route) => {
      if (!route.resuming) {
        if (screen.needsHeader(route.number)) {
          const url = `https://github.com/${REPO}/issues/${route.number}`;
          screen.say(header({ number: route.number, title: route.title, size: route.size, url, queue: route.queue }, screen.theme));
        }
        // A lost race exits 1, which `sh` raises. It is not a failure of this run: the ticket is
        // someone else's, and the shape that says so is the stand-down every other path already
        // reads — so the session is never spawned and `runOnce` parks it from the declaration.
        try {
          const claimed = sh("node", [HERE + "/claim.mjs", String(route.number), route.title]);
          const branch = claimed.split("\t")[2] ?? "";
          screen.say(stepRow({ label: "claim", detail: `won · ${branch}`, ms: null }, screen.theme));
        } catch (err) {
          const why = String(err.stdout ?? "").split("\t").at(-1)?.trim() || "the claim did not stand";
          screen.say(stepRow({ label: "claim", detail: why, ms: null, state: "failed" }, screen.theme));
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
      return runTicket(spawn, {
        number: route.number,
        queue: route.queue,
        size: route.size,
        at,
        fix: Boolean(route.fix),
        retryCount: route.retryCount ?? 0,
        reason: route.reason ?? null,
        screen,
      });
    },
    announce: (route) => {
      if (screen.needsHeader(route.number)) {
        screen.say(header({ number: route.number, ...ticketFacts(route.number), queue: route.queue }, screen.theme));
      }
      screen.context({ spentMs: ticketTally(route.number, readLedger()).ms });
    },
    buildPassed: (cwd, ticket) => {
      try {
        return Boolean(cwd) && buildReady(cwd, ticket).ok;
      } catch {
        return false;
      }
    },
    // A fresh pick has no CI rounds: its claim comment is newer than any CI-RED before it.
    tally: (n) => ({
      ...ticketTally(n, readLedger()),
      ciRounds: picked?.number === n ? (picked.ciRounds ?? 0) : 0,
    }),
    standing,
    refreshWorktree: (cwd, branch) => refreshWorktree(cwd, branch),
    publish: (number, branch, cwd) => {
      try {
        screen.set({ pr: publishForReview(number, branch, cwd, ticketFacts(number).title) });
      } catch (err) {
        screen.notice("publish", `#${number} is not pushed for review — ${String(err.message).split("\n")[0]}`);
      }
    },
    pushedPr,
    settle: (pending) => settle(pending, screen),
    postRed: (number, pr) => postHeldRed(number, pr, (m) => screen.notice("ci", m)),
    queue: () => before,
    park,
    /**
     * **The claim comes off here, and nowhere else on the success paths.** Releasing it beside each
     * teardown call meant an exit path could take one without the other, and one did: a settle that
     * ended in a verdict nothing recognised wrote its row, removed the worktree and returned, with
     * `in-progress` still on the issue — which `next-ticket.mjs` skips for good. Tied to the
     * teardown, no path can tear down and keep the claim.
     */
    teardown: (cwd, number) => {
      if (number) {
        try {
          sh("gh", ["issue", "edit", String(number), "--remove-label", "in-progress"]);
        } catch (err) {
          // Said out loud, because silence here is permanent: the picker skips `in-progress`, so a
          // swallowed failure leaves a finished ticket nothing will ever take again. #1026 merged.
          screen.notice("claim", `#${number} is still in-progress — ${String(err.message).split("\n")[0]}`);
        }
      }
      if (!cwd || !fs.existsSync(cwd)) return;
      try {
        removeLanded(cwd, number, { say: (m) => screen.notice("worktree", m) });
      } catch {
        screen.notice("worktree", `${cwd} is still standing — derive() will read it as a live run`);
      }
    },
    bell,
    sharedCheckoutDirty: () => git("status", "--porcelain").trim(),
    log: (m, label = "loop") => screen.notice(label, m),
    /**
     * One session, one row, one writer. `counts` says whether this session closed a *ticket* — a
     * CI fix round and a usage refusal are sessions that spent money without one — and it changes
     * only which counter moves, never whether the money is recorded.
     */
    killed: () => {
      const lastSeen = (row) => (fs.existsSync(streamLog(row.n)) ? fs.statSync(streamLog(row.n)).mtimeMs : null);
      const last = killedStarts(readLedger(undefined, { starts: true }), lastSeen).at(-1);
      return last?.trailing ? last : null;
    },
    ledgerRows: () => readLedger(),
    repark: (number, steps) => repark(number, steps),
    record: ({ number, outcome, why, run, pr = null, merged = false, files = 0, counts = true, head = null, handoff = null, parkFailed = null, flake = null }) => {
      const error = errorOf(run);
      const facts = ticketFacts(number);
      const rows = readLedger();
      const cost = windowCost({ n: number, outcome, own: run.result?.cost ?? 0 }, rows);
      // The merged row is the ticket's whole bill; the land session alone has no turns and no spend.
      const whole = outcome === "landed" || outcome === "closed" ? ticketTally(number, rows) : null;
      const bill = whole
        ? { ms: whole.ms + run.ms, turns: whole.turns + (run.result?.turns ?? 0), cost: whole.spend + (run.result?.cost ?? 0) }
        : { ms: run.ms, turns: run.result?.turns ?? 0, cost };
      // Each of these is said by the row after it: the next phase opening, or the merge step's own
      // result. The log is offered only where something needs reading.
      if (!["handoff", "retry", "pushed", "reparked"].includes(outcome)) {
        screen.say(
          closing(
            {
              outcome: outcome === "landed" ? "merged" : outcome,
              number,
              files,
              ...bill,
              why: why ?? undefined,
              log: outcome === "landed" ? undefined : run.log,
            },
            screen.theme,
          ),
        );
      }
      book.record(
        {
          number,
          size: facts.size,
          outcome,
          // The sentence, not the outcome: a park written by a turn cap, one written by a review
          // deadlock and one written by a genuine blocker were the same four characters in the file.
          parkReason: parkReasonOf(outcome, why, error),
          pr,
          phases: run.phases ?? {},
          result: run.result,
          // Named for what the loop knows: whether it merged, not a CI verdict it never read.
          merged,
          reviewRounds: facts.reviewRounds,
          totalHolds: facts.totalHolds,
          // A session's own start: a park recorded hours after its session ended is not `now - ms`.
          startedAt: run.started ?? new Date(Date.now() - run.ms).toISOString(),
          ms: run.ms,
          asleepMs: run.asleepMs ?? null,
          reruns: run.reruns ?? null,
          version: run.version,
          usage: run.usage ?? null,
          committed: run.committed ?? null,
          head,
          handoff,
          error,
          parkFailed,
          flake,
        },
        {
          runId: RUN_ID,
          counts,
          report: { number, title: facts.title, outcome, pr, ms: bill.ms, cost: bill.cost, why: why ?? undefined },
        },
      );
    },
  };
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
 * @param {{screen?: object, book?: object, io?: object, install?: Function, runId?: string}} [deps]
 */
export async function main({
  screen = ticker(),
  book = openLedger({ loopSha: loopSha() }),
  io = null,
  install = trapSignals,
  runId = RUN_ID,
  tick = 30_000,
} = {}) {
  /** `pinned` is the ticket a red CI round or a handoff handed back; its counts are the ledger's. */
  let loop = { failures: 0, holds: 0, waits: 0, overloads: 0, pinned: null };

  install(screen);
  io ??= realIo(book, screen);
  const killed = io.killed?.();
  if (killed) {
    screen.notice(
      "killed",
      `#${killed.n}'s phase ${killed.phase ?? "?"} session from ${clockAt(Date.parse(killed.started))} was killed after ${Math.round(killed.ms / 60_000)} min and left no row`,
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

  /**
   * The ticket phase A has claimed, so a throw anywhere in the iteration can still release it.
   *
   * `runOnce`'s own exits all route through `park`, but a throw routes through none of them, and
   * an `in-progress` label nothing removes is a ticket `next-ticket.mjs` skips for good — the
   * defect this branch closed on every other path. `io.pick` is the claim, so wrapping it is
   * where the answer is knowable; `git status` on a contended shared index is the reachable way
   * to get there.
   */
  let claimed = null;
  const watched = {
    ...io,
    pick: (p, at) => {
      const route = io.pick(p, at);
      claimed = typeof route?.number === "number" ? route.number : null;
      if (route?.queue) launch = route.queue.launch ?? null;
      return route;
    },
    settle: (pending) => timed("ci", () => io.settle(pending)),
  };

  /** Every exit writes the total. The clean stop used to print it to the screen and nowhere else. */
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
    const q = io.queue?.();
    return q ? ` · queue ${q.implement} to implement, ${q.triage} to triage` : "";
  };

  for (;;) {
    // Per iteration, not once per process: a run lasting past midnight would never prune.
    pruneLogs();
    parity = io.parity?.() ?? null;
    const rows = io.ledgerRows();
    screen.board?.({ typical: typicalMs(rows) });
    // From the ledger, not memory: the outage that failed a park outlasts any backoff, and a restart.
    for (const { n, steps } of pendingReparks(rows)) {
      const { failed, why: moot = null } = io.repark(n, steps);
      if (!moot && failed.length === steps.length) {
        screen.notice("park", `#${n}'s park has still not reached the tracker (${steps.join(", ")})`);
        continue;
      }
      const why = [moot ?? "the park reached the tracker", ...(failed.length ? [`still owed: ${failed.join(", ")}`] : [])].join(" — ");
      io.record({ number: n, outcome: "reparked", why, run: { result: null, ms: 0, log: streamLog(n), phases: {} }, counts: false, parkFailed: failed.length ? failed : null });
      io.log(`#${n}: ${why}`, "park");
    }

    let pass;
    claimed = null;
    try {
      pass = await runOnce(watched, loop.pinned, loop.pinned ? io.tally(loop.pinned).lastHandoff : null, loop);
    } catch (err) {
      screen.warn(`queue-loop: the iteration threw — ${String(err?.stack ?? err)}`);
      // No row: there is no run to write one from, and inventing one is how the ledger came to be
      // trusted while wrong. The claim is the part that strands the ticket, and it comes off here.
      const own = claimed === null ? null : worktreeOf(io, claimed);
      const threw = decide({ step: "threw", route: claimed === null ? null : { n: claimed }, error: String(err?.message ?? err), own, loop, limits: LIMITS, now: Date.now() });
      if (threw.kind === "park") {
        try {
          parkAndRecord(io, claimed, { ...own, phase: threw.phase, why: threw.why, log: streamLog(claimed) });
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

    // Not a failure: a pre-flight the machine has to settle, or a red whose CI-RED the tracker
    // would not take. Held and asked again, bounded by the same ceiling a usage refusal has.
    if (pass.outcome === "hold") {
      const whose = pass.ticket != null ? `#${pass.ticket} held: ` : "";
      screen.notice("waiting", `${whose}${pass.why} — asking again shortly (${loop.holds} of ${WAIT.TRIES})`);
      const [what, then] =
        pass.ticket != null
          ? [`#${pass.ticket}'s CI-RED`, `#${pass.ticket}'s fix round, read from CI${queued()}`]
          : ["a pre-flight hold", `the pre-flight asks again, then the next pick${queued()}`];
      if ((await hold(pass.hold, what, then)) === "stopped") return finish(0, ".loop-stop during the wait");
      continue;
    }

    // A refusal is not a failure and not a ticket: the account is out of usage, which the branch,
    // the pull request and the label all survive. It waits, then goes again — an exit here costs
    // every remaining ticket of an unattended night.
    if (pass.outcome === "refused") {
      screen.notice(
        "usage",
        `#${pass.ticket} paused: the usage window is spent — back at ${clockAt(Date.now() + pass.hold)} (wait ${loop.waits} of ${WAIT.TRIES})`,
      );
      const resets = `usage resets ${clockAt(Date.now() + pass.hold)}`;
      if ((await hold(pass.hold, resets, `#${pass.ticket} resumes from its worktree${queued()}`)) === "stopped") {
        return finish(0, ".loop-stop during the wait");
      }
      continue;
    }

    if (pass.outcome === "overloaded") {
      const back = clockAt(Date.now() + pass.hold);
      screen.notice("api", `#${pass.ticket} paused: ${pass.why} — trying again at ${back} (${loop.overloads} of ${WAIT.TRIES})`);
      if ((await hold(pass.hold, "the API is failing", `#${pass.ticket} resumes from its worktree${queued()}`)) === "stopped") {
        return finish(0, ".loop-stop during the wait");
      }
      continue;
    }

    if (pass.halt) return finish(1, pass.halt);
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  // An unhandled rejection here would end the night with a one-line node trace and no exit status,
  // in the one process whose job is to say what happened.
  main({})
    .catch((err) => {
      console.error(`queue-loop: stopped by an unhandled error — ${err?.stack ?? err}`);
      return 1;
    })
    .then((code) => process.exit(code));
}
