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
 * Usage: node tools/loop/queue-loop.mjs
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs, { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { ciRedPosted, ciRedRounds, derive, REPO, reviewRounds, WORKTREE_DIR } from "./loop-derive.mjs";
import { readLine } from "./loop-stream.mjs";
import {
  act,
  activity,
  bell,
  capabilities,
  clockAt,
  closing,
  header,
  keybar,
  LAND,
  notice,
  phaseRow,
  progress,
  queueLine,
  PLAIN,
  reportRow,
  runTotal,
  stepRow,
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
  leftoverPath,
  ledger as openLedger,
  parkNotePath,
  prune as pruneLogs,
  readLedger,
  streamLog,
  ticketTally,
  usageSplit,
} from "./loop-logs.mjs";
import { readAllowedTools } from "./loop-tools.mjs";
import { MAX_REVIEW_ROUNDS } from "./loop-gate.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { branchSurvives, landing, mergeArgs } from "./land.ts";
import { readVerdict } from "./ciVerdict.ts";

// Spawning a sibling by its own directory, not the cwd: the supervisor runs from the repo root,
// but nothing guarantees that, and the sibling is beside this file either way.
const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..", "..");

const STOP_FILE = ".loop-stop";

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
  const read = (name) =>
    Number(/:(\d+)/.exec(line?.split("\t").find((f) => f.startsWith(name)) ?? "")?.[1] ?? 0);
  return {
    implement: read("implement"),
    triage: read("triage"),
    wayfinder: read("wayfinder"),
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
export function nextRoute(pinned = null, at = null, { read = derive, facts = ticketFacts, ledger = readLedger } = {}) {
  const status = read({ ci: true });
  const known = status.onTicket && status.ticket ? facts(status.ticket) : null;
  const live = liveRoute(status, known?.labels ?? null);
  if (live) {
    const settles = live.phase === "G" && status.ci?.pushed === true;
    const derived = live.phase === "G" ? "E" : live.phase;
    const phase = settles
      ? "G"
      : (at ?? (status.fix ? "C" : null) ?? ticketTally(live.number, ledger()).lastHandoff ?? derived);
    return {
      ...live,
      phase,
      fix: Boolean(status.fix),
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
    const { title, size, ciRounds } = facts(pinned);
    return { skill: "implement", number: pinned, title, size, ciRounds, queue: null, resuming: true, phase: "A" };
  }
  const stdout = execFileSync("node", [HERE + "/next-ticket.mjs"], { encoding: "utf8" });
  return { ...parseRoute(stdout), queue: parseStatus(stdout), resuming: false };
}

/**
 * The real bound is turns. A dollar cap is checked only after a turn settles, so where it stops
 * moves with the model and the context — measured 8x to 42x over a small cap — and with subagents
 * in flight it stops the *subagents* and lets the session carry on. The dollar figure stays as a
 * backstop against one pathological turn, well above what a healthy ticket reaches.
 */
export const TURNS_BY_SIZE = {
  "size:XS": 60,
  "size:S": 120,
  "size:M": 200,
  "size:L": 320,
  "size:XL": 400,
};
export const TURNS_DEFAULT = 150;
const TICKET_BUDGET_USD = "40";

/**
 * What one ticket may cost across every process it is spawned as.
 *
 * `TICKET_BUDGET_USD` bounds a single session and is unchanged; with phase handoffs a ticket is up
 * to `MAX_HANDOFFS` of them, so the per-ticket figure has to be kept here, where the supervisor is
 * the only thing that survives them all. Set above the fleet median for the size
 * (`docs/research/2026-09-14-loop-efficiency.md` §5), so it catches a runaway and never a healthy run.
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

/**
 * @param {number} number
 * @param {string|null} [size] a `size:*` label, or null
 */
export function queueLoopArgs(number, size = null) {
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
    // No `--exclude-dynamic-system-prompt-sections`: it was measured on 2.1.268 and bought nothing.
    // Two fresh processes with a git-status change between them paid 15,579 creation tokens with it
    // and 14,848 without — the dynamic sections are ~200 tokens, and what a second process fails to
    // reuse is the rest of the prefix, which the flag does not reach.
    "--tools",
    readAllowedTools().join(","),
    "--max-turns",
    String(turnsFor(size)),
    "--max-budget-usd",
    TICKET_BUDGET_USD,
  ];
}

// The session and the loop read these from the shared checkout, not from the ticket's worktree.
const PROTOCOL = ["CLAUDE.md", ".claude", "tools/loop", "scripts/lib"];

/** Worktree directories someone else may be working in right now. */
function peerWorktrees(dir = ".worktrees") {
  try {
    return fs.readdirSync(dir).filter((name) => name.startsWith("agent-"));
  } catch {
    return [];
  }
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
};

/**
 * Leaves the shared checkout on an up-to-date `main`, or refuses and says why.
 *
 * It asks whether the protocol files are *dirty*, not whether they differ from `origin/main`.
 * Those are different questions: the loop's own tickets edit its own code, so the moment one
 * merges the checkout differs from origin until it is fast-forwarded — which is staleness,
 * repaired here rather than reported. Only an uncommitted edit is drift, and it belongs to someone.
 *
 * @param {{current: () => string|null, stored: () => string|null, write: (hash: string) => void,
 *   peers: () => string[]}} [stamp]
 * @param {number|null} [pinned] the ticket whose own worktree, if any, is not another session
 */
export function syncCheckout(
  git,
  log,
  install = () => sh("npm", ["ci"], { stdio: "inherit" }),
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
  // its only chance to notice. `preflight` refuses to start a ticket on top of a drifted install,
  // so leaving the repair to the next iteration is the loop poisoning its own precondition. It
  // runs only when no *other* ticket's worktree is standing: every worktree's node_modules is a
  // junction into this install, so reinstalling under a live session empties the tree it is in.
  try {
    const current = stamp.current();
    if (current !== null && current !== stamp.stored()) {
      const live = stamp.peers().filter((name) => name !== `agent-${pinned}`);
      if (live.length) {
        log(`package-lock.json differs from the last install, but ${live.join(", ")} is live — not reinstalling`);
        return true;
      }
      log("package-lock.json differs from the last install — reinstalling before the next ticket");
      install();
      stamp.write(current);
    }
  } catch (err) {
    log(`could not reinstall — ${String(err.message).split("\n")[0]}`);
    return false;
  }
  return true;
}

/**
 * A session's own longest silence. Phase D's two review subagents emit nothing into the parent
 * stream while they read, and a large diff keeps them there past twenty minutes. Any ceiling at or
 * under that reads a working run as a stalled one.
 */
export const STALL_MS = 30 * 60_000;

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
 * Processes one ticket may be spawned as. A+B+C is one, each review round is one, E+F is one — six
 * for a ticket that uses every round, and the slack is for a resume that re-enters a phase.
 *
 * A ceiling, not a budget: the thing that actually stops a runaway ticket is `overSpend`.
 */
export const MAX_HANDOFFS = 8;
export const overHandoffs = (n) => n >= MAX_HANDOFFS;

/** @param {{declared: {handoff?: string|null, stoodDown?: boolean}|null}} run */
export const handoffOf = (run) => (run.declared?.stoodDown ? null : (run.declared?.handoff ?? null));

/**
 * How long to wait out a spent usage window.
 *
 * The loop must not exit on a refusal: the owner is away, and an exit that nothing recovers costs
 * every remaining ticket of the night. `CAP` bounds one hold against a wrong clock, not the total
 * — a gap longer than it is held in pieces and asked again, so a seven-day window resumes within
 * `CAP` of its reset rather than never. `TRIES` is the floor under all of it: that many refusals
 * in a row, each after a full wait, is an account that is not coming back on its own.
 */
export const WAIT = {
  CAP: 12 * 60 * 60_000,
  FLOOR: 60_000,
  MARGIN: 30_000,
  TRIES: 20,
};

/** @param {{blocked?: boolean, blockedUntil?: number, done?: boolean}} run */
export function waitFor({ blocked, blockedUntil, done }, now = Date.now()) {
  if (!blocked || done) return 0;
  if (!blockedUntil) return WAIT.FLOOR;
  const gap = blockedUntil - now;
  if (gap <= 0) return 0;
  return Math.min(gap + WAIT.MARGIN, WAIT.CAP);
}

/**
 * What a refused session costs the run: a wait, and nothing else.
 *
 * A usage refusal is a property of the *account*, so the counter is the run's, not the ticket's.
 * Keyed per ticket it was inert — twenty tickets refused once each never reached the ceiling — and
 * cruel when it did fire, parking one ticket for a limit it had no part in.
 *
 * @param {{waits: number, blocked?: boolean, blockedUntil?: number, done?: boolean}} run
 * @returns {{action: "proceed"|"wait"|"give-up", hold: number, waits: number, why?: string}}
 */
export function afterRefusal({ waits, blocked, blockedUntil, done }, now = Date.now()) {
  if (!blocked || done) return { action: "proceed", hold: 0, waits: 0 };
  if (waits >= WAIT.TRIES) {
    return {
      action: "give-up",
      hold: 0,
      waits,
      why: `refused ${waits} times running, each after waiting out the window it named`,
    };
  }
  // Floored, always: a reset timestamp already in the past — clock skew, a stale window, a
  // seven-day limit reported with an expired short-window reset — makes `waitFor` answer 0, and a
  // hold of 0 is a knob with no floor, spawning back to back until the ceiling stops it.
  const hold = Math.max(waitFor({ blocked, blockedUntil, done }, now), WAIT.FLOOR);
  return { action: "wait", hold, waits: waits + 1 };
}

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
export const shouldHalt = (consecutiveFailures) => consecutiveFailures >= BREAKER;

/**
 * What a settled ticket costs the run.
 *
 * `hand-back` is a CI fix round — recorded rather than silent, because each one is a whole session
 * with its own cost and turns. `owner` is the only settled outcome that reaches the tracker;
 * everything else `landing()` decides is mechanical, and the branch and the pull request both
 * survive it for the next iteration to find from `derive()`.
 *
 * @param {{action: string}} settled
 */
export function settleOutcome({ action }) {
  if (action === "merge" || action === "already-merged")
    return { countsAsFailure: false, recorded: "landed", handBack: false };
  if (action === "hand-back") return { countsAsFailure: false, recorded: "retry", handBack: false };
  // Parked, not stalled, and handed back: a ticket nothing mechanical can move keeps neither its
  // claim nor its silence. Recording the row and tearing the worktree down without releasing
  // `in-progress` leaves an issue the picker skips for good.
  return { countsAsFailure: true, recorded: "parked", handBack: true };
}

/**
 * What the session's exit leaves the supervisor to do.
 *
 * **The pull request outranks every reason the session's exit gives, bar two.** A branch that was
 * pushed is a fact, and how the session ended is not a fact about it: a session that ran out of
 * turns after pushing has done its half, and from there CI and the merge are the supervisor's.
 * Reading the exit first parked eleven tickets whose pull requests merged anyway, throwing away the
 * work and the claim together.
 *
 * The two exceptions are the two things only the session can know: it stood the ticket down, or it
 * worked a different one. Both make its branch not this ticket's answer, so neither yields.
 *
 * @param {{pr: {number: number, state: string}|null,
 *   reason: {why: string|null, hard: boolean}}} run
 * @returns {{action: "settle"|"landed"|"park", pr?: number, why?: string}}
 */
export function outcomeOf({ pr, reason }) {
  if (reason.hard && reason.why) return { action: "park", why: reason.why, pr: pr?.number };
  if (pr?.state === "MERGED")
    return { action: "landed", pr: pr.number, why: `pull request #${pr.number} was already merged` };
  if (pr?.state === "OPEN") return { action: "settle", pr: pr.number };
  if (pr)
    return { action: "park", pr: pr.number, why: `pull request #${pr.number} is ${String(pr.state).toLowerCase()}` };
  return { action: "park", why: reason.why ?? "the session pushed no pull request" };
}

/**
 * Why this session did not finish its ticket, and whether that reason outranks a pushed branch.
 *
 * `hard` is the short list of things that make the session's own work not this ticket's answer.
 * Everything else is a reason the *session* ended, which says nothing about whether the branch it
 * left behind is good — that is CI's question, and `outcomeOf` lets the pull request answer first.
 *
 * @param {{status: number|string, phase?: string|null, stderr?: string, result?: object|null,
 *   declared?: {pr: number|null, stoodDown: boolean, why: string|null}|null}} run
 * @returns {{why: string|null, hard: boolean}}
 */
export function reasonFor(run, after, ticket) {
  const said = run.declared;
  const hard = (why) => ({ why, hard: true });
  const soft = (why) => ({ why, hard: false });

  if (said?.stoodDown) return hard(said.why ?? "the session stood down");
  if (after?.ticket && after.ticket !== ticket) return hard(`the session worked #${after.ticket}, not #${ticket}`);
  // The only place "Budget limit reached ($15.08 of $15); stopping background agents." is ever
  // said — the result event for that session still reads subtype "success".
  if (/Budget limit reached/.test(run.stderr ?? "")) return soft("the session spent its budget mid-phase");
  if (run.result?.subtype === "error_max_turns") return soft("the session ran out of turns");
  if (run.status === "stalled")
    return soft(`no output for ${Math.round(STALL_MS / 60_000)}m in phase ${run.phase ?? "?"}`);
  if (run.status !== 0) return soft(`the session exited ${run.status} in phase ${run.phase ?? "?"}`);
  // Phase F's LOOP-RESULT is not optional, and this is where its absence becomes visible rather than
  // absorbed. A session that exits clean without declaring has left every fact about itself to be
  // inferred.
  if (!said) return soft("the session exited without a LOOP-RESULT");
  return soft(null);
}

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
 */
export async function holdFor(
  ms,
  exists = (f) => fs.existsSync(f),
  slice = 30_000,
  say = null,
  beat = HEARTBEAT_MS,
) {
  const until = Date.now() + ms;
  let next = Date.now() + beat;
  while (Date.now() < until) {
    if (exists(STOP_FILE)) return "stopped";
    if (say && Date.now() >= next) {
      say(`  ⏸ still waiting — back at ${clockAt(until)}`);
      next = Date.now() + beat;
    }
    // Not unref'd: by now this is the only handle keeping the process alive.
    await new Promise((r) => setTimeout(r, Math.min(slice, until - Date.now())));
  }
  return "waited";
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
 *   dirty: boolean, run?: Function, write?: Function}} ctx
 * @returns {{ok: boolean, failed: string[]}}
 */
export function park(
  number,
  { phase, why, log, cwd, branch, dirty, run = sh, write = writeFileSync },
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

  step("label", () =>
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
  );

  const body = [
    `Parked by the queue loop in **phase ${phase}**.`,
    "",
    `- reason: ${why}`,
    `- branch: \`${branch ?? "none"}\`${dirty ? " (uncommitted work was committed before teardown)" : ""}`,
    `- log: \`${log}\``,
    "",
    "The branch keeps its commits. Nothing was discarded.",
  ].join("\n");
  const file = parkNotePath(number);
  step("comment", () => {
    write(file, body, "utf8");
    run("gh", ["issue", "comment", String(number), "--body-file", file]);
  });

  if (cwd) step("worktree", () => removeWorktree(cwd, run));

  return { ok: failed.length === 0, failed };
}

/** From the main checkout: `removeOneWorktree` refuses a caller standing inside the tree it removes. */
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

/** A red round's `update-branch` moved the remote head, and the fix is built on top of it. */
export function refreshWorktree(cwd, branch, run = sh) {
  run("git", ["-C", cwd, "fetch", "--quiet", "origin", branch]);
  run("git", ["-C", cwd, "merge", "--ff-only", `origin/${branch}`]);
}

const ERASE = "\r\u001B[2K";
const HIDE = "\u001B[?25l";
const SHOW = "\u001B[?25h";
const REDRAW_MS = 120;
const ESC = String.fromCharCode(27);
// `[0A` is not "up none": ECMA-48 reads a parameter of 0 as 1, so an unguarded zero moves the
// cursor a row it was never asked to move.
const UP = (n) => (n > 0 ? `${ESC}[${n}A` : "");
const CTRL_C = String.fromCharCode(3);

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
export function ticker(out = process.stdout, err = process.stderr, reveal = openExternally) {
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
  const view = { expanded: false, stopping: false };
  let ctx = { url: null, log: null };

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
    const body = view.expanded
      ? streamBlock(open.feed, { ms, frame, letter: open.letter }, t, room)
      : [
          progress({ letter: open.letter, ms, round: open.round }, t),
          "",
          activity({ said: open.said, recent: open.recent, ms, frame }, t, room - 4),
        ].join("\n");
    return [body, "", keybar(view, t)].join("\n").split("\n").slice(0, room);
  };

  const draw = () => {
    if (!out.isTTY || !open) return;
    // Before the `live` gate, not after: a window narrowed past the point of drawing has to be
    // able to widen back. A narrower window also means the rows already on screen have wrapped and
    // their count is no longer what the cursor maths assumes — repainting from scratch is the only
    // honest recovery, and it leaves the wrapped rows behind as a one-time smear.
    if (resized()) drawn = [];
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
    if (k === "e") view.expanded = !view.expanded;
    else if (k === "s") askStop(!view.stopping);
    else if (k === "o" && ctx.url) reveal(ctx.url);
    else if (k === "l" && ctx.log) reveal(ctx.log);
    else return false;
    return true;
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
    /** What the `o` and `l` keys open. Set once per ticket, beside its header. */
    context(next = {}) {
      ctx = { url: null, log: null, ...next };
      view.stopping = fs.existsSync(STOP_FILE);
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
      const done = phaseRow(
        { letter: open.letter, round: open.round, ms: Date.now() - open.startedAt, state, detail },
        t,
      );
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
function ticketFacts(number) {
  try {
    const issue = JSON.parse(
      execFileSync("gh", ["issue", "view", String(number), "--json", "title,labels,url,comments"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: SH_MAX_BUFFER,
      }),
    );
    return {
      title: issue.title,
      url: issue.url,
      size: issue.labels.map((l) => l.name).find((n) => n.startsWith("size:")) ?? null,
      labels: issue.labels.map((l) => l.name),
      reviewRounds: reviewRounds(issue.comments ?? []),
      ciRounds: ciRedRounds(issue.comments ?? []),
    };
  } catch {
    return { title: `ticket #${number}`, url: "", size: null, labels: null, reviewRounds: null, ciRounds: 0 };
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

/** What a `git commit` looks like in a `Bash` call, whatever else is on the line. */
const COMMITTING = /\bgit\b[^\n|;&]*\bcommit\b/;

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
 * @param {{phase: string|null, buildTurns: number, committed: boolean, warnedUncommitted: boolean}} state
 * @param {{calls: {name: string, command: string}[]}} fact
 * @param {number} budget the session's `--max-turns`
 * @param {(line: string) => void} warn
 */
export function watchBuild(state, fact, budget, warn) {
  if (state.committed || state.phase !== "C") return;
  if (fact.calls.some((c) => c.name === "Bash" && COMMITTING.test(c.command))) {
    state.committed = true;
    return;
  }
  state.buildTurns += 1;
  if (state.warnedUncommitted || state.buildTurns < Math.round(budget * UNCOMMITTED_SHARE)) return;
  state.warnedUncommitted = true;
  warn(
    `${state.buildTurns} turns into phase C of a ${budget}-turn budget with no commit` +
      " — an unstaged edit is the only work this loop can lose",
  );
}

/**
 * Turns that spent a full context read on one shell command.
 *
 * Not a warning and not a gate: nothing at the call site can tell a command that had to wait for the
 * last one from a command that did not. It is a number in the ledger, so "did the batching
 * instruction work" is a question the record can answer.
 *
 * @param {{soloBash: number, turns: number}} state
 * @param {{calls: {name: string}[]}} fact
 */
export function watchCalls(state, fact) {
  if (!fact.calls.length) return;
  state.turns += 1;
  if (fact.calls.length === 1 && fact.calls[0].name === "Bash") state.soloBash += 1;
}

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
    screen = ticker(),
    facts = ticketFacts,
    stallMs = STALL_MS,
    tick = 30_000,
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
    blocked: false,
    blockedUntil: 0,
    stalled: false,
    stderr: "",
    /** Turns spent in phase C, and whether any of them committed. */
    buildTurns: 0,
    committed: false,
    warnedUncommitted: false,
    soloBash: 0,
    turns: 0,
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
  const round = () =>
    state.phase === "D" && about.reviewRounds != null
      ? { n: about.reviewRounds + 1, of: MAX_REVIEW_ROUNDS }
      : null;

  if (screen.needsHeader(number)) screen.say(header({ number, ...about, queue }, screen.theme));
  screen.context({ url: about.url, log: logPath });
  if (at) {
    screen.say(phaseRow({ letter: at, detail: "resumed", ms: 0, state: "resumed", round: round() }, screen.theme));
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
  const child = spawnFn("claude", queueLoopArgs(number, size), {
    stdio: ["ignore", "pipe", "pipe"],
    // A background update landing at 2am changes the system prompt, and every remaining ticket of
    // the night then rebuilds its cached prefix at full price, with nothing to see. Whether to
    // update is a decision for a person between runs.
    //
    // `LOOP_TURNS` is the bound that actually stops a session, and it was invisible to the session
    // subject to it: the word "turn" appeared in none of queue.md, RULES.md, loops.md or CLAUDE.md,
    // so phase C's commit rule arrived with no stated reason to hurry.
    env: {
      ...process.env,
      DISABLE_AUTOUPDATER: "1",
      LOOP_TURNS: String(budget),
      // `-p` leaves fork mode off, so subagents default to background and the session spends a turn
      // each time it asks one whether it is done. Foreground makes the Agent call an await.
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
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
    if (fact.kind === "init") state.version = fact.version;
    if (fact.kind === "assistant") {
      if (fact.letter && fact.letter !== state.phase) {
        closePhase();
        state.phase = fact.letter;
        screen.start(fact.letter, round());
      }
      if (fact.declared) state.declared = fact.declared;
      // The only sign of life during phase D, which is the longest one and the one that read as a
      // hang: its work happens entirely inside two review subagents.
      // Both halves, in the order a person reads them: what the session said about what it is
      // doing, then the calls it made saying it. Only two markers were ever taken out of the text
      // and the rest — the one channel that says *why* — was thrown away.
      screen.said(thought(fact.text));
      for (const call of fact.calls) screen.call(call.name, act(call));
      watchBuild(state, fact, budget, (m) => screen.notice("uncommitted", m));
      watchCalls(state, fact);
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
      const detail = tasksDetail([...state.tasks.values()], Date.now() - state.phaseAt);
      if (detail) screen.said(detail);
    }
    // A session emits one result per turn, and a background task's wake-up is a turn. The real one
    // carries `origin: null`; every other carries origin.kind "task-notification". Last-wins
    // across all of them reported a 144-turn session as one turn.
    if (fact.kind === "result" && !fact.origin) state.result = fact;
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
    const watchdog = setInterval(() => {
      if (Date.now() - state.lastFactAt <= stallMs) return;
      state.stalled = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, tick);
    watchdog.unref();

    child.on("close", (status) => {
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
          soloBash: state.soloBash,
          callTurns: state.turns,
          stderr: state.stderr,
          version: state.version,
          ms: Date.now() - startedAt,
          log: logPath,
          // Read now rather than accumulated as the lines arrived: the sink has just closed, so the
          // file is complete and nothing is writing to it.
          usage: readUsageSplit(logPath),
        }),
      );
    });
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
 * Four budgets, not one. A branch updated twice because main moved twice is a healthy branch on a
 * busy night; a verdict asked for twice because the runner had nothing to say is a sick one; a
 * mergeability job still running is neither; and a run that has not registered yet is a push seconds
 * old. Sharing a counter parks whichever goes second. A run that *is* running spends none of these.
 */
export const SETTLE_ROUNDS = { update: 3, retry: 3, recheck: 8, appear: 12 };

/** GitHub re-points the pull request head asynchronously; asked at once, CI answers for the old one. */
const SETTLE_PAUSE_MS = 15_000;

/**
 * Reads the pull request's state and asks `landing()` what to do with it.
 *
 * **Every settle round asks, whatever CI said.** The landing question used to be put only behind a
 * green verdict, so a pull request someone else had already merged — whose ci.yml run reads
 * `cancelled`, because merging cancels it — was never asked at all, and spent three fix rounds
 * against a branch that was already in main.
 *
 * @param {Function} run
 */
function readLanding(prNumber, verdict, run = sh) {
  const pr = JSON.parse(
    run("gh", ["pr", "view", String(prNumber), "--repo", REPO, "--json", "state,mergeStateStatus,mergeable"]),
  );
  return landing(pr, verdict);
}

/**
 * Merges, then confirms the remote branch is actually gone.
 *
 * RULES.md rule 14 asks for that confirmation and ADR 0004 moved the merge here, which left the
 * rule with no executor at all — it was written for a session or a person doing the merging. A
 * worktree still holding the local branch makes `--delete-branch` fail quietly, and the remote copy
 * survives with it. Harmless over a merged pull request; the identical silence over an unmerged one
 * is #294, where a branch on origin with no open pull request reads as a live claim and the ticket
 * can never be picked up again.
 *
 * @returns {string|null} the branch, if it is still on origin
 */
function mergeAndConfirm(prNumber, branch, run = sh) {
  run("gh", mergeArgs(REPO, prNumber));
  if (!branch) return null;
  try {
    return branchSurvives(run("git", ["ls-remote", "origin", branch])) ? branch : null;
  } catch {
    // The merge is what mattered, and an unreadable `ls-remote` is not evidence of a survivor.
    return null;
  }
}

/**
 * Waits for the pushed branch's CI and lands it. No judgement here — `readVerdict` says whether the
 * run passed and `landing()` says what that plus the merge state means — which is why the session
 * that built the ticket has already exited by the time this runs.
 *
 * It owns a phase of its own because it is the longest stretch of a ticket and the session is gone:
 * without a row with a clock on it, a board that has just ticked `close` reads as finished, and a
 * twenty-minute CI wait reads as a hang.
 */
export async function settle(pending, screen, opts = {}) {
  const { pause = SETTLE_PAUSE_MS, deadline = SETTLE.DEADLINE_MS, watch = poll } = opts;
  screen.start(LAND);
  screen.said(`waiting for ci.yml on ${pending.branch}`);
  try {
    const out = await watch(pending, (m) => screen.said(m), pause, deadline);
    const landed = out.action === "merge";
    screen.close(landed ? "done" : "failed", landed ? `#${pending.pr} merged` : out.reason);
    return out;
  } catch (err) {
    // An open phase is a spinner with no end. Whatever else is wrong, the row has to settle.
    screen.close("failed", String(err.message).split("\n")[0]);
    throw err;
  }
}

/** The `failing:` line's ceiling, so one long test id cannot itself carry the line over budget. */
const FAILING_LINE_MAX = 200;

/** The fenced excerpt's ceiling, which is what keeps `ciRedBody` inside its own 15-line budget. */
const EXCERPT_LINES = 8;

function failingLine(testIds) {
  if (testIds.length === 0) return "failing: (no test ids parsed)";
  const shown = [];
  let used = 0;
  for (const id of testIds) {
    const width = (shown.length ? "; " : "").length + id.length;
    if (shown.length > 0 && used + width > FAILING_LINE_MAX) break;
    shown.push(id);
    used += width;
  }
  const rest = testIds.length - shown.length;
  return `failing: ${shown.join("; ")}${rest > 0 ? ` +${rest} more` : ""}`;
}

/**
 * The CI-RED comment's exact shape, so `ciRedRounds` can count it and a fix round can read it
 * without re-fetching the run. `shared` names another branch already red on the same failure
 * (task 8); until then every caller passes the default.
 *
 * @param {{sha: string, runUrl: string, failedStep?: string, testIds?: string[], excerpt?: string,
 *   shared?: string}} args
 */
export function ciRedBody({ sha, runUrl, failedStep, testIds = [], excerpt = "", shared = "none" }) {
  return [
    `CI-RED ${sha}`,
    `run: ${runUrl} · step: ${failedStep ?? "an unnamed step"}`,
    failingLine(testIds),
    `shared: ${shared}`,
    "```",
    ...excerpt.split("\n").slice(-EXCERPT_LINES),
    "```",
  ].join("\n");
}

/** Bounds each `gh` call `postCiRedOnce` makes, so a wedged one cannot stall the supervisor. */
const CI_RED_TIMEOUT_MS = 30_000;

/**
 * Posted once per red head, checked against the tracker rather than a local marker: a marker
 * surviving only on this machine is exactly what stranded #1077's second fix session with nothing
 * to read. An unreadable tracker is a reason to skip, never to post blind.
 */
function postCiRedOnce(ticket, verdict, run, write, log) {
  const sha = verdict.head;
  if (!sha) return;
  let comments;
  try {
    comments = JSON.parse(
      run("gh", ["issue", "view", String(ticket), "--json", "comments"], { timeout: CI_RED_TIMEOUT_MS }),
    ).comments;
  } catch (err) {
    log(`CI-RED: could not read the tracker — ${String(err.message).split("\n")[0]}`);
    return;
  }
  if (ciRedPosted(comments, sha)) return;
  const body = ciRedBody({
    sha,
    runUrl: `https://github.com/${REPO}/actions/runs/${verdict.runId}`,
    failedStep: verdict.failedStep,
    testIds: verdict.testIds ?? [],
    excerpt: verdict.output,
  });
  try {
    const file = ciRedNotePath(ticket);
    write(file, body, "utf8");
    run("gh", ["issue", "comment", String(ticket), "--body-file", file], { timeout: CI_RED_TIMEOUT_MS });
  } catch (err) {
    log(`CI-RED: could not post — ${String(err.message).split("\n")[0]}`);
  }
}

export async function poll(pending, log, pause, deadline, io = {}) {
  const { run = sh, verdictOf = readVerdict, write = writeFileSync, mkdir = mkdirSync } = io;
  const left = { ...SETTLE_ROUNDS };
  const until = Date.now() + deadline;
  // Not unref'd, for the same reason `holdFor` is not: this is the only handle open while it waits.
  const wait = () => new Promise((r) => setTimeout(r, pause));

  for (;;) {
    if (Date.now() > until) {
      return { action: "owner", reason: `CI did not settle in ${Math.round(deadline / 60_000)}m` };
    }
    let next;
    // Which budget a `recheck` spends. A verdict asked again because the runner had nothing to say
    // is a sick branch; a mergeability job still computing is neither sick nor healthy, and it
    // answers on its own in seconds. One counter for both parks whichever goes second.
    let asking = "recheck";
    let verdict = {};
    try {
      verdict = verdictOf(REPO, pending.branch, pending.pr);
      if (verdict.infrastructure) asking = verdict.appearing ? "appear" : "retry";
      next = readLanding(pending.pr, verdict, run);
      // Written before it is handed back, because the session that fixes it is a fresh process
      // with no way to ask this one anything. Never when `output` is the reason rather than the log:
      // round one's real failure is already in that file, and this would paint over it.
      if (next.action === "hand-back" && verdict.output && !verdict.logUnread) {
        mkdir(DIR, { recursive: true });
        write(ciLogPath(pending.ticket), verdict.output, "utf8");
        postCiRedOnce(pending.ticket, verdict, run, write, log);
      }
    } catch (err) {
      // `gh` refusing, a rate limit, or anything that is not JSON. The ticket is pushed and its
      // branch is intact, so this goes to the owner rather than ending the night.
      return { action: "owner", reason: `could not read CI — ${String(err.message).split("\n")[0]}` };
    }

    if (next.action === "update-branch" && left.update > 0) {
      left.update -= 1;
      log("main moved — updating the branch and reading CI again");
      try {
        run("gh", ["pr", "update-branch", String(pending.pr)]);
      } catch (err) {
        return { action: "owner", reason: `could not update the branch — ${String(err.message).split("\n")[0]}` };
      }
      await wait();
      continue;
    }
    // A run that has not finished is not a round spent: `left.recheck` is eight of them, and any
    // real ci.yml outlasts that. Its ceiling is `deadline`, read at the top of this loop — which no
    // round could reach while `gh run watch` held the process inside one.
    if (verdict.waiting && next.action === "recheck") {
      log(verdict.reason);
      await wait();
      continue;
    }
    // A hand-back's whole payload is the log the fix round reads. Without it that round is five
    // turns of phase A and a close — #1028 spent three of them, and only the park said anything.
    if (next.action === "hand-back" && (!verdict.output || verdict.logUnread)) {
      if (left.retry > 0) {
        left.retry -= 1;
        log("CI is red but named no log — asking once more");
        await wait();
        continue;
      }
      return { action: "owner", reason: `CI is red and its log could not be read — ${next.reason}` };
    }
    if (next.action === "recheck" && left[asking] > 0) {
      left[asking] -= 1;
      log(`${next.reason} — asking once more`);
      await wait();
      continue;
    }
    if (next.action === "update-branch" || next.action === "recheck") {
      const spent = next.action === "update-branch" ? SETTLE_ROUNDS.update : SETTLE_ROUNDS[asking];
      return { action: "owner", reason: `${next.action} did not settle in ${spent} rounds — last: ${next.reason}` };
    }
    if (next.action === "merge") {
      try {
        const survivor = mergeAndConfirm(pending.pr, pending.branch, run);
        if (survivor) log(`  ⚠️ #${pending.ticket} ${survivor} is still on origin after --delete-branch`);
      } catch (err) {
        return { action: "owner", reason: `the merge failed — ${String(err.message).split("\n")[0]}` };
      }
    }
    return next.action === "hand-back" ? { ...next, head: verdict.head ?? null } : next;
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

/**
 * What the supervisor knows about the session that just exited.
 *
 * The session's own `LOOP-RESULT` first, `derive()` second, which is all there is when the
 * declaration is missing.
 *
 * @param {{declared: object|null, phase: string|null}} run
 * @param {object|null} derived
 */
export function afterSession(run, derived) {
  const said = run.declared;
  if (!said && !derived) return null;
  return {
    ticket: said?.ticket ?? derived?.ticket ?? null,
    branch: said?.branch ?? derived?.branch ?? null,
    cwd: derived?.cwd ?? null,
    dirty: derived?.dirty ?? false,
    changed: derived?.changed ?? [],
    // The session's own marker, not derive()'s: derive computes a phase from commit count and
    // verdict, so it can only ever answer C, D, E or ?.
    phase: said?.phase ?? run.phase ?? derived?.phase ?? "?",
  };
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
export function parkAndRecord(io, number, { run = null, pr = null, files = 0, ...ctx }) {
  io.bell();
  io.park(number, ctx);
  io.record({
    number,
    outcome: "parked",
    why: ctx.why,
    run: run ?? { result: null, ms: 0, log: ctx.log, phases: {} },
    pr,
    files,
    counts: true,
  });
  return { outcome: "parked", ticket: number, why: ctx.why };
}

/**
 * One ticket, start to finish. Serialised deliberately: overlapping the next ticket with the last
 * one's CI wait buys ~22% wall clock and costs pending state nothing recovers when the process
 * dies, a worktree released under a live `derive()`, and two sessions cutting branches from a
 * `main` neither has yet.
 *
 * @param {object} io
 * @param {number|null} [pinned] a ticket a previous pass handed back unfinished
 * @param {string|null} [at] the phase a handoff said the next process starts at
 * @returns {Promise<{outcome: "landed"|"parked"|"stop"|"hold"|"retry"|"refused"|"handoff",
 *   ticket?: number, why?: string, until?: number, cwd?: string|null, branch?: string|null,
 *   pr?: number, files?: number, phase?: string, run?: any, size?: string|null, tally?: any}>}
 */
export async function runOnce(io, pinned = null, at = null) {
  if (io.stopFile()) return { outcome: "stop", why: ".loop-stop" };
  if (!io.syncCheckout(pinned)) return { outcome: "stop", why: "the shared checkout is not usable" };
  // Exit 2 is "this machine cannot start a ticket *now*" — drift, a peer's dirt, memory. Every one
  // of those clears on its own, including the drift the loop's own merge of a lockfile creates.
  const pre = io.queuePre();
  if (pre === 2) return { outcome: "hold", why: "queue-pre is not ready for a ticket yet" };
  if (pre !== 0) return { outcome: "stop", why: `queue-pre exited ${pre}` };

  const route = io.pick(pinned, at);
  if (route.skill === "handoff") return { outcome: "stop", why: route.title };
  if (route.skill === "ambiguous") return { outcome: "stop", why: route.title };
  let tally = io.tally(route.number);
  const size = route.size ?? null;

  if (route.fix) {
    const parkFix = (why) =>
      parkAndRecord(io, route.number, {
        phase: "C",
        why,
        log: streamLog(route.number),
        cwd: route.cwd ?? null,
        branch: route.branch ?? null,
        dirty: route.dirty ?? false,
      });
    if (route.head && route.head !== tally.lastRedHead) {
      if (Math.max(tally.retries, tally.ciRounds ?? 0) + 1 >= CI_ROUNDS) {
        return parkFix(`${CI_ROUNDS} CI rounds on the same branch did not go green — the last one while the loop was down`);
      }
      io.record({
        number: route.number,
        outcome: "retry",
        why: "CI went red while the loop was down",
        run: { result: null, ms: 0, log: streamLog(route.number), phases: {} },
        counts: false,
        head: route.head,
      });
      tally = io.tally(route.number);
    }
    try {
      io.refreshWorktree(route.cwd, route.branch);
    } catch (err) {
      return parkFix(
        `could not fast-forward the worktree before the fix round — ${String(err.stderr || err.message).trim().split("\n")[0]}`,
      );
    }
  }

  const settling = route.phase === "G";
  const run = settling
    ? { status: 0, result: null, declared: null, ms: 0, log: streamLog(route.number), phase: "G", phases: {} }
    : await io.spawn(route);

  const dirtied = io.sharedCheckoutDirty?.();
  if (dirtied) io.log(`#${route.number}'s session left the shared checkout dirty:\n${dirtied}`, "session");

  const after = afterSession(run, io.standing());
  // Before the pull request is looked for: a session that handed off has not pushed and is not
  // finished, and every reading below is about a session that meant to be its ticket's last.
  const handoff = handoffOf(run);
  if (handoff) {
    io.record({ number: route.number, outcome: "handoff", why: `phase ${handoff} next`, run, counts: false });
    // The worktree comes with it: a handoff leaves one standing on purpose, so a park that does not
    // carry it leaves `derive()` a live run to resume — the ticket it just handed to the owner.
    return {
      outcome: "handoff",
      ticket: route.number,
      phase: handoff,
      run,
      size,
      cwd: after?.cwd ?? null,
      branch: after?.branch ?? null,
    };
  }
  const pr = io.pushedPr(after?.branch ?? null, route.number, run.declared?.pr ?? null, settling ? 0 : Date.now() - run.ms);
  // `blocked` is advisory, checked here rather than before the pull request is looked for: a
  // session refused mid-run that recovered and pushed has done its half, and reporting it refused
  // stranded the branch and left the claim on.
  if (!pr && run.blocked) {
    // Recorded like any other session that ended. A refusal spends real money before it stops, and
    // adding that to the run's total anywhere but here is the third writer that made the ledger
    // need a flag to stop double-counting itself.
    io.record({
      number: route.number,
      outcome: "refused",
      why: "the usage window is spent",
      run,
      counts: false,
    });
    return { outcome: "refused", ticket: route.number, until: run.blockedUntil ?? 0, run };
  }

  const reason =
    settling && !pr
      ? { why: "phase G found no open pull request for the pushed head", hard: false }
      : reasonFor(run, after, route.number);
  const decided = outcomeOf({ pr, reason });
  // The pull request's own count when derive() read no worktree.
  const files = after?.changed?.length || pr?.changedFiles || 0;

  const handBack = (why, phase, log = run.log) =>
    parkAndRecord(io, route.number, {
      phase,
      why,
      log,
      cwd: after?.cwd ?? null,
      branch: after?.branch ?? null,
      dirty: after?.dirty ?? false,
      run,
      pr: decided.pr ?? null,
      files,
    });

  if (decided.action === "park") return handBack(decided.why, after?.phase ?? "?");

  if (decided.action === "landed") {
    io.teardown(after?.cwd ?? null, route.number);
    io.record({ number: route.number, outcome: "landed", why: decided.why, run, pr: decided.pr, merged: true, files });
    return { outcome: "landed", ticket: route.number };
  }

  const landFrom = Date.now();
  const settled = await io.settle({
    ticket: route.number,
    pr: decided.pr,
    branch: after?.branch ?? pr.head,
  });
  // The land is the ticket's longest stretch and the session that built it has already exited, so
  // the row's clock is the only place it can be counted. Every exit below records from `run.ms`.
  run.ms += Date.now() - landFrom;
  const cost = settleOutcome(settled);

  // Every exit from a settle that did not merge and is not a fix round goes through `park` — the
  // claim, the reason on the issue and the worktree, in that one place. Recording the row and
  // tearing the worktree down without it leaves `in-progress` on an issue the picker skips for
  // good, which is a ticket nothing will ever return to.
  if (cost.handBack) return handBack(settled.reason, "E");

  // A ticket that cannot go green is not the loop's to keep paying for, and the ceiling is checked
  // here rather than by the caller so that a ticket which runs out of rounds takes the same exit as
  // every other hand-back: one park, one row, one release of the claim. Counted from the round this
  // session is, so the last red round is a park rather than a retry nothing comes back to.
  const roundsUsed = Math.max(tally.retries, tally.ciRounds ?? 0);
  if (cost.recorded === "retry" && roundsUsed + 1 >= CI_ROUNDS) {
    return handBack(
      `${CI_ROUNDS} CI rounds on the same branch did not go green — last: ${settled.reason}`,
      "E",
      // The failed CI log, when there is one: it is what the owner needs and the session's own
      // stream log is not.
      fs.existsSync(ciLogPath(route.number)) ? ciLogPath(route.number) : run.log,
    );
  }

  io.record({
    number: route.number,
    outcome: cost.recorded,
    why: settled.reason,
    run,
    pr: decided.pr,
    merged: cost.recorded === "landed",
    files,
    counts: cost.recorded !== "retry",
    head: settled.head ?? pr?.sha ?? null,
  });
  // The worktree and the run come with it: the next round works in that worktree.
  if (cost.recorded === "retry") {
    return {
      outcome: "retry",
      ticket: route.number,
      why: settled.reason,
      cwd: after?.cwd ?? null,
      branch: after?.branch ?? pr.head,
      pr: decided.pr,
      // What the next round is judged against: a round that leaves this where it was cannot change
      // what CI answers, so `main` refuses to spend one on it.
      sha: settled.head ?? pr?.sha ?? null,
      files,
      run,
      size,
      tally,
    };
  }
  io.teardown(after?.cwd ?? null, route.number);
  return { outcome: "landed", ticket: route.number };
}

/** The real IO, bound once so `runOnce` can be driven without git, the tracker or a binary. */
function realIo(book, screen) {
  // The queue as the *previous* pick read it. The direction is what a night is made of, and this
  // is the one reading that costs nothing — the next pick is being made anyway.
  let before = null;
  let picked = null;
  return {
    stopFile: () => takeStopFile(fs, STOP_FILE),
    syncCheckout: (pinned) => syncCheckout(git, (m) => screen.notice("checkout", m), undefined, { pinned }),
    queuePre: () =>
      spawnSync(process.execPath, [HERE + "/queue-pre.mjs"], { stdio: "inherit" }).status ?? 1,
    pick: (pinned, at) => {
      const route = nextRoute(pinned, at);
      picked = route;
      if (route.resuming) return route;
      if (before) screen.say(queueLine(before, route.queue, screen.theme));
      before = route.queue;
      return route;
    },
    spawn: (route) => {
      if (!route.resuming) {
        screen.say(`  · picking — ${route.queue?.implement ?? 0} takeable`);
        // A lost race exits 1, which `sh` raises. It is not a failure of this run: the ticket is
        // someone else's, and the shape that says so is the stand-down every other path already
        // reads — so the session is never spawned and `runOnce` parks it from the declaration.
        try {
          const claimed = sh("node", [HERE + "/claim.mjs", String(route.number), route.title]);
          screen.say(
            stepRow({ label: "claim", detail: claimed.split("\t").slice(1, 3).join(" "), ms: null }, screen.theme),
          );
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
      return runTicket(spawn, {
        number: route.number,
        queue: route.queue,
        size: route.size,
        at: route.resuming ? (route.phase ?? "C") : null,
        screen,
      });
    },
    // A fresh pick has no CI rounds: its claim comment is newer than any CI-RED before it.
    tally: (n) => ({
      ...ticketTally(n, readLedger()),
      ciRounds: picked?.number === n ? (picked.ciRounds ?? 0) : 0,
    }),
    standing,
    refreshWorktree: (cwd, branch) => refreshWorktree(cwd, branch),
    pushedPr,
    settle: (pending) => settle(pending, screen),
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
    record: ({ number, outcome, why, run, pr = null, merged = false, files = 0, counts = true, head = null }) => {
      const facts = ticketFacts(number);
      screen.say(
        closing({
          outcome: outcome === "landed" ? "merged" : outcome,
          number,
          files,
          turns: run.result?.turns ?? 0,
          ms: run.ms,
          cost: run.result?.cost ?? 0,
          why: why ?? undefined,
          log: outcome === "landed" ? undefined : run.log,
        },
        screen.theme,
      ),
    );
      book.record(
        {
          number,
          size: facts.size,
          outcome,
          // The sentence, not the outcome: a park written by a turn cap, one written by a review
          // deadlock and one written by a genuine blocker were the same four characters in the file.
          parkReason: outcome === "landed" || outcome === "retry" ? null : (why ?? null),
          pr,
          phases: run.phases ?? {},
          result: run.result,
          // Named for what the loop knows: whether it merged, not a CI verdict it never read.
          merged,
          reviewRounds: facts.reviewRounds,
          startedAt: new Date(Date.now() - run.ms).toISOString(),
          ms: run.ms,
          version: run.version,
          usage: run.usage ?? null,
          committed: run.committed ?? null,
          soloBash: run.soloBash ?? null,
          head,
        },
        {
          runId: RUN_ID,
          counts,
          line: reportRow(
            {
              number,
              title: facts.title,
              outcome,
              pr,
              ms: run.ms,
              cost: run.result?.cost ?? 0,
              why: why ?? undefined,
            },
            PLAIN(),
          ),
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
 * constructs, which is the whole of what makes the breaker, the fix-round ceiling and the refusal
 * ceiling reachable from a test — five locals mutated across six branches, none of which any test
 * could drive, and `CI_ROUNDS`, `WAIT.TRIES` and `shouldHalt`'s interaction with them appeared in
 * none. A pure `step(state, pass)` beside it would be a second copy of that shape to keep in
 * agreement; driving the real one costs nothing and cannot drift.
 *
 * @param {{screen?: object, book?: object, io?: object, install?: Function, runId?: string}} [deps]
 */
export async function main({
  screen = ticker(),
  book = openLedger(),
  io = null,
  install = trapSignals,
  runId = RUN_ID,
} = {}) {
  let failures = 0;
  let waits = 0;
  let holds = 0;
  /** The ticket a red CI round or a handoff handed back. Its counts are the ledger's. */
  let pinned = null;

  install(screen);
  io ??= realIo(book, screen);

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
      return route;
    },
  };

  /** Every exit writes the total. The clean stop used to print it to the screen and nowhere else. */
  const finish = (code, why) => {
    const total = runTotal(book.totals);
    if (why) {
      if (code === 0) screen.say(`   ${why} — stopping`);
      else screen.notice("stopping", why);
    }
    screen.say(total);
    book.close(runId, total);
    bell();
    return code;
  };

  for (;;) {
    // Per iteration, not once per process: a run lasting past midnight would never prune.
    pruneLogs();

    let pass;
    claimed = null;
    try {
      pass = await runOnce(watched, pinned, pinned ? io.tally(pinned).lastHandoff : null);
    } catch (err) {
      screen.warn(`queue-loop: the iteration threw — ${String(err?.stack ?? err)}`);
      // No row: there is no run to write one from, and inventing one is how the ledger came to be
      // trusted while wrong. The claim is the part that strands the ticket, and it comes off here.
      if (claimed !== null) {
        try {
          let own = null;
          try {
            const at = io.standing();
            own = at?.ticket === claimed ? at : null;
          } catch {
            const kept = path.join(ROOT, WORKTREE_DIR, `agent-${claimed}`);
            own = fs.existsSync(kept) ? { cwd: kept, branch: null, dirty: false } : null;
          }
          parkAndRecord(io, claimed, {
            phase: "?",
            why: `the loop threw: ${String(err?.message ?? err)}`,
            log: streamLog(claimed),
            cwd: own?.cwd ?? null,
            branch: own?.branch ?? null,
            dirty: own?.dirty ?? false,
          });
        } catch (unparked) {
          screen.notice("claim", `#${claimed} is still claimed — ${String(unparked?.message ?? unparked)}`);
        }
      }
      failures += 1;
      if (shouldHalt(failures)) return finish(1, `${failures} tickets in a row did not land`);
      continue;
    }

    if (pass.outcome === "stop") return finish(0, pass.why);

    // Not a ticket and not a failure: something the machine has to settle before a ticket can
    // start. Held and asked again, bounded by the same ceiling a usage refusal has.
    if (pass.outcome === "hold") {
      holds += 1;
      if (holds > WAIT.TRIES) return finish(1, `${pass.why}, ${holds} times running`);
      screen.say(`  ⏸ ${pass.why} (${holds}/${WAIT.TRIES}) — asking again shortly`);
      if ((await holdFor(WAIT.FLOOR, undefined, undefined, (m) => screen.say(m))) === "stopped") {
        return finish(0, ".loop-stop during the wait");
      }
      continue;
    }
    holds = 0;

    // A refusal is not a failure and not a ticket: the account is out of usage, which the branch,
    // the pull request and the label all survive. It waits, then goes again — an exit here costs
    // every remaining ticket of an unattended night.
    if (pass.outcome === "refused") {
      const step = afterRefusal({ waits, blocked: true, blockedUntil: pass.until });
      waits = step.waits;
      if (step.action === "give-up") return finish(1, step.why);
      screen.say(
        `  ⏸ #${pass.ticket} the usage window is spent (${waits}/${WAIT.TRIES}) — back at ${clockAt(Date.now() + step.hold)}`,
      );
      if ((await holdFor(step.hold, undefined, undefined, (m) => screen.say(m))) === "stopped") {
        return finish(0, ".loop-stop during the wait");
      }
      continue;
    }

    const giveUp = (why) => {
      parkAndRecord(io, pass.ticket, {
        phase: pass.phase ?? "E",
        why,
        log: pass.run.log,
        cwd: pass.cwd ?? null,
        branch: pass.branch ?? null,
        dirty: false,
      });
      pinned = null;
      failures += 1;
      return shouldHalt(failures);
    };
    const halted = () => finish(1, `${failures} tickets in a row did not land`);

    // A red CI round is the same ticket again, not the next one: the picker would leave this one
    // labelled `in-progress` with an open pull request and take a different ticket, and nothing
    // would ever come back to it. `runOnce` owns the ceiling, so reaching here means there is
    // another round to spend.
    if (pass.outcome === "handoff" || pass.outcome === "retry") {
      // A round that left the head where it found it cannot change what CI answers, so spending the
      // next one on it buys nothing.
      if (pass.outcome === "retry" && pass.sha && pass.sha === pass.tally?.lastRedHead) {
        if (giveUp(`the fix round pushed no commit — CI would answer ${pass.why} again`)) return halted();
        continue;
      }
      pinned = pass.ticket;
      const tally = io.tally(pass.ticket);
      if (overSpend(tally.spend, pass.size ?? null)) {
        const why = `$${tally.spend.toFixed(2)} across ${tally.sessions} processes — over this ticket's ceiling`;
        if (giveUp(why)) return halted();
        continue;
      }
      if (overHandoffs(tally.handoffsThisRound)) {
        if (giveUp(`${tally.handoffsThisRound} phase handoffs on one ticket`)) return halted();
        continue;
      }
      if (pass.outcome === "retry") {
        screen.say(`  🔁 #${pass.ticket} ${pass.why} — fix round ${tally.retries + 1}/${CI_ROUNDS}`);
      }
      continue;
    }
    pinned = null;
    if (pass.outcome === "landed") {
      failures = 0;
      // Only a landing clears the refusal counter. Cleared on any non-refused outcome, refusals
      // interleaved with parks never reach the ceiling — a suspend knob with no floor under it.
      waits = 0;
    } else {
      failures += 1;
    }
    if (shouldHalt(failures)) return finish(1, `${failures} tickets in a row did not land`);
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
