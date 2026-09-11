// scripts/queue-loop.mjs
/**
 * The loop that never stops. `.claude/commands/queue.md` runs one ticket per process and exits;
 * this is what starts the next one, in a clean process, so no ticket's context reaches the next.
 *
 * It also renders what that process is doing. `--output-format stream-json` is exclusive — taking
 * the machine-readable stream means the human-readable one is this file's to draw — so the child's
 * stdout is parsed here and the raw lines are kept in `.loop-logs/<n>.jsonl` for anything the board
 * does not show.
 *
 * No iteration cap and no context budget: there is nothing here for a budget to protect, since
 * nothing survives past one `claude -p` call.
 *
 * Usage: node scripts/queue-loop.mjs
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs, { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { derive } from "./loop-derive.mjs";
import { readLine, phaseOf, REDERIVE } from "./loop-stream.mjs";
import {
  BLANK,
  PHASES,
  clockAt,
  closing,
  header,
  heartbeat,
  phaseLine,
  reportRow,
  runTotal,
} from "./loop-render.mjs";
import { row } from "./loop-record.mjs";
import { readAllowedTools } from "./loop-tools.mjs";

const LOG_DIR = ".loop-logs";
const STOP_FILE = ".loop-stop";

export function isInvokedDirectly(argv1, moduleUrl) {
  return Boolean(argv1) && path.resolve(argv1) === fileURLToPath(moduleUrl);
}

/** @returns {{ skill: string, number: number, title: string }} */
export function parseRoute(stdout) {
  const line = stdout.split("\n").find((l) => l.startsWith("ROUTE\t"));
  if (!line) throw new Error("no ROUTE line in next-ticket.mjs output");
  const [, skill, number, title] = line.split("\t");
  return { skill, number: Number(number), title };
}

/** The bucket depths the picker already prints, for the header's "how much is behind this one". */
export function parseStatus(stdout) {
  const line = stdout.split("\n").find((l) => l.startsWith("STATUS\t"));
  const read = (name) =>
    Number(
      /:(\d+)/.exec(
        line?.split("\t").find((f) => f.startsWith(name)) ?? "",
      )?.[1] ?? 0,
    );
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
 * @returns {{ skill: string, number: number, title: string, resuming: true } | null}
 */
export function liveRoute(status) {
  if (!status.onTicket || !status.ticket) return null;
  return {
    skill: "implement",
    number: status.ticket,
    title: status.branch ?? `ticket #${status.ticket}`,
    // A resumed session re-emits no marker for a phase it has already passed.
    phase: status.phase && status.phase !== "?" ? status.phase : "C",
    resuming: true,
  };
}

function nextRoute() {
  // Checked here, not just left to queue.md's own phase A: without this, the log below claims
  // "starting #N" for whatever the picker happens to return, even while a different ticket is
  // genuinely mid-build in a worktree — misleading regardless of what the spawned session goes
  // on to correctly resume.
  const live = liveRoute(derive());
  if (live)
    return { ...live, queue: { implement: 0, triage: 0, wayfinder: 0 } };
  const stdout = execFileSync("node", ["scripts/next-ticket.mjs"], {
    encoding: "utf8",
  });
  return { ...parseRoute(stdout), queue: parseStatus(stdout), resuming: false };
}

/** One runaway ticket must not be able to spend the night's budget. */
const TICKET_BUDGET_USD = "15";

export function queueLoopArgs() {
  return [
    "-p",
    "/queue",
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
    "--max-budget-usd",
    TICKET_BUDGET_USD,
  ];
}

const ORDER = PHASES.map(([l]) => l);

/** The board only ever moves forward: a marker for a phase already passed says nothing new. */
export function advance(current, next) {
  const a = ORDER.indexOf(current);
  const b = ORDER.indexOf(next);
  return b > a ? ORDER[b] : current;
}

// The session and the loop read these from the shared checkout, not from the ticket's worktree.
const PROTOCOL = ["CLAUDE.md", ".claude", "scripts"];

// Repaired, not reported: `git checkout` decides whether that loses anything, and its refusal is
// the stop. A branch keeps its commits either way — only HEAD moves.
export function syncProtocol(git, log) {
  const drift = () =>
    git("diff", "--name-only", "origin/main", "--", ...PROTOCOL).trim();
  git("fetch", "origin", "--quiet");
  if (!drift()) return true;

  log(
    `queue-loop: protocol differs from origin/main (${drift().split("\n").join(", ")})`,
  );

  // Commits of its own mean someone is working here. Refuse; never move a checkout in use.
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").trim();
  const own =
    Number(git("rev-list", "--count", "origin/main..HEAD").trim()) || 0;
  if (branch !== "main" && own > 0) {
    log(
      `queue-loop: ${branch} is checked out with ${own} commit(s) of its own — not moving it. ` +
        `Land or park that branch, then start the loop.`,
    );
    return false;
  }

  try {
    git("checkout", "main");
    git("merge", "--ff-only", "origin/main");
  } catch (err) {
    log(`queue-loop: cannot restore main — ${String(err.message).trim()}`);
    return false;
  }
  if (drift()) {
    log(
      "queue-loop: still differs after moving to main — main itself is ahead of origin",
    );
    return false;
  }
  log("queue-loop: checkout moved back to main");
  return true;
}

/**
 * `lib/loop/ciVerdict.ts` blocks in phase E waiting for a CI run, which regularly takes twenty
 * minutes and emits nothing while it does. Any ceiling at or under that reads a working run as a
 * stalled one.
 */
export const STALL_MS = 30 * 60_000;

export const stalled = (lastFactAt, now) => now - lastFactAt > STALL_MS;

/** How often the loop is willing to pay for a `derive()`, and how often the TTY line redraws. */
export const REDERIVE_MS = 20_000;
const BEAT_MS = 1_000;

/** `CAP` is above the longest window and below a wrong clock; `FLOOR` covers a reset nobody named. */
export const WAIT = {
  CAP: 5.5 * 60 * 60_000,
  FLOOR: 60_000,
  MARGIN: 30_000,
  TRIES: 20,
};

/**
 * How long to hold before running this ticket again; zero is do not wait.
 *
 * @param {{blocked?: boolean, blockedUntil?: number, done?: boolean}} run
 */
export function waitFor({ blocked, blockedUntil, done }, now = Date.now()) {
  if (!blocked || done) return 0;
  if (!blockedUntil) return WAIT.FLOOR;
  const gap = blockedUntil - now;
  if (gap <= 0) return 0;
  return Math.min(gap + WAIT.MARGIN, WAIT.CAP);
}

/**
 * What a session that was refused costs the ticket: nothing, until it has been refused too often.
 * A hold of zero is still a retry — a reset that has already passed means go now, not park.
 *
 * @param {{ticket: number, waits: number, waitsOn: number|null, blocked?: boolean,
 *   blockedUntil?: number, done?: boolean}} run
 * @returns {{action: "proceed"|"retry"|"park", hold: number, waits: number, waitsOn: number,
 *   why?: string}}
 */
export function afterRefusal(
  { ticket, waits, waitsOn, blocked, blockedUntil, done },
  now = Date.now(),
) {
  const so_far = waitsOn === ticket ? waits : 0;
  if (!blocked || done)
    return { action: "proceed", hold: 0, waits: 0, waitsOn: ticket };
  if (so_far >= WAIT.TRIES) {
    return {
      action: "park",
      hold: 0,
      waits: 0,
      waitsOn: ticket,
      why: `refused ${so_far} times running`,
    };
  }
  return {
    action: "retry",
    hold: waitFor({ blocked, blockedUntil, done }, now),
    waits: so_far + 1,
    waitsOn: ticket,
  };
}

// `npm` and `npx` are `.cmd` shims, and since the fix for CVE-2024-27980 node will not resolve one
// from execFileSync — measured here: `execFileSync("npx", ["--version"])` throws ENOENT while `gh`
// and `git` are fine. Both are reached only with argument lists this file writes itself, never with
// anything a ticket or the tracker supplies.
const SHIMMED = new Set(["npm", "npx"]);

const sh = (file, args, opts) => {
  const shell = SHIMMED.has(file) && process.platform === "win32";
  // Under `shell` the arguments are concatenated, not passed through — and one of them is a
  // worktree path, which carries whatever spaces the checkout's own location has.
  const argv = shell ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args;
  return execFileSync(file, argv, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell,
    ...opts,
  });
};

/** One bad ticket is a ticket. Three in a row is the loop or the machine, and a night proving it. */
export const BREAKER = 3;
export const shouldHalt = (consecutiveFailures) =>
  consecutiveFailures >= BREAKER;

/**
 * A session can exit 0 without landing — parked, out of turns, halted by its own rules — and leave
 * the worktree and the `in-progress` label behind. The next iteration then resumes the same ticket,
 * and without this it does so for ever, at a full session's cost each time.
 *
 * Nothing is written down: the supervisor is alive across iterations, so this is memory rather than
 * state, and there is no third copy of the truth to disagree with git and the tracker.
 */
export function madeProgress(prev, now) {
  if (!prev || prev.ticket !== now.ticket) return true;
  return prev.head !== now.head || prev.commits !== now.commits;
}

/**
 * What to do with a ticket whose session has already exited.
 *
 * Nothing in this stretch is a judgement — `ciVerdict` says whether the run passed and
 * `decideLanding()` is already a pure function over the merge state — so it is a table here rather
 * than a model reading a CI log to decide that green means merge.
 *
 * @param {{verdict: {pass?: boolean, infrastructure?: boolean, failedStep?: string, output?: string},
 *   landing?: {action: string, reason: string}}} state
 */
export function afterPush({ verdict, landing }) {
  // A job that completed having run zero steps is billing, a quota or a runner. It says nothing
  // about the diff, so it is asked again rather than spending a fix round on it.
  if (verdict.infrastructure)
    return {
      action: "retry-verdict",
      why: "a job completed having run zero steps",
    };
  if (!verdict.pass)
    return {
      action: "fix",
      why: `CI failed at ${verdict.failedStep ?? "an unnamed step"}`,
    };
  if (landing?.action === "merge")
    return { action: "merged", why: landing.reason };
  if (landing?.action === "update-branch")
    return { action: "update-branch", why: landing.reason };
  return {
    action: "park",
    why: landing?.reason ?? "the pull request is not mergeable",
  };
}

// Worktrees isolate branches and indexes. They do not isolate node_modules — one install, shared
// through a junction — so a dependency change landing under a peer build is how that build gets a
// green typecheck against modules it does not have.
const SHARED_INSTALL = ["package.json", "package-lock.json"];

/** Whether a new ticket may start while the last one is still waiting to merge. */
export function canStartNext({ pending }) {
  if (!pending) return { ok: true, why: "" };
  const dep = (pending.changed ?? []).find((f) => SHARED_INSTALL.includes(f));
  if (dep)
    return {
      ok: false,
      why: `#${pending.ticket} changes ${dep}, and node_modules is shared`,
    };
  return { ok: true, why: "" };
}

/** `.loop-stop` drains the loop after the current ticket. Reading it removes it, so it cannot go stale. */
export function takeStopFile(fs, file) {
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

/**
 * Hands a ticket back to the owner: the work committed, the claim released, the reason on the
 * issue, the worktree gone. Any step throwing stops the loop rather than leaving a ticket in a
 * state nobody can name.
 *
 * @param {number} number
 * @param {{phase: string, why: string, log: string, cwd: string, branch: string|null,
 *   dirty: boolean, run?: Function, write?: Function}} ctx
 */
export function park(
  number,
  { phase, why, log, cwd, branch, dirty, run = sh, write = writeFileSync },
) {
  // A ticket parked after its push has no worktree left: the supervisor removes it at the push so
  // that nothing derives the ticket as a run still needing a session. There is then nothing to
  // commit and nothing to tear down, and the branch already holds the work.
  if (dirty && cwd) {
    // `-A` is safe here and nowhere else: this is the ticket's own worktree, which has its own
    // index, and rule 40 keeps every other session out of it. Rule 11's hazard is the shared
    // checkout. Losing an unstaged edit is the one thing parking must not do.
    run("git", ["-C", cwd, "add", "-A", "--", "."]);
    run("git", [
      "-C",
      cwd,
      "commit",
      "-m",
      `wip(#${number}): parked in phase ${phase}`,
    ]);
  }

  run("gh", [
    "issue",
    "edit",
    String(number),
    "--remove-label",
    "in-progress",
    "--add-label",
    "ready-for-human",
  ]);

  const body = [
    `Parked by the queue loop in **phase ${phase}**.`,
    "",
    `- reason: ${why}`,
    `- branch: \`${branch ?? "none"}\`${dirty ? " (uncommitted work was committed before teardown)" : ""}`,
    `- log: \`${log}\``,
    "",
    "The branch keeps its commits. Nothing was discarded.",
  ].join("\n");
  const file = path.join(LOG_DIR, `park-${number}.md`);
  write(file, body, "utf8");
  run("gh", ["issue", "comment", String(number), "--body-file", file]);

  if (cwd) run("npm", ["run", "worktrees:remove", "--", cwd]);
}

/**
 * A pushed ticket keeps its branch and its pull request, but must not keep its worktree: `derive()`
 * reads a worktree under `.worktrees/` as a run that still needs a session, so leaving one there
 * makes the next iteration — and the next session's own phase A — resume the ticket that was just
 * pushed instead of taking a new one. Everything is committed and pushed by this point.
 */
function releaseWorktree(cwd, log = console.log, run = sh) {
  if (!cwd) return;
  try {
    run("npm", ["run", "worktrees:remove", "--", cwd]);
  } catch (err) {
    log(`  ⚠️ could not remove ${cwd} — ${String(err.message).split("\n")[0]}`);
  }
}

/**
 * The merge queue: one ticket waiting for CI while the next one builds.
 *
 * It is one slot, so the whole of its job is that the slot is emptied before it is refilled — a
 * second `pending = …` over a full slot drops a pushed pull request silently, and the loop then
 * merges at most one ticket a night while reporting every one of them as landed. That is a two-line
 * ordering nobody can see in a 170-line `main()`, which is why it is here, with the spawning and the
 * reporting left outside.
 *
 * @param {{settle: Function, release: Function, reattach: Function, log?: Function}} io
 */
export function mergeSlot({ settle, release, reattach, log = console.log }) {
  let held = null;
  return {
    get pending() {
      return held;
    },
    /**
     * @returns {Promise<{ticket: {ticket: number, cwd?: string, branch?: string, at: number,
     *   cost?: object, record?: object, report?: object},
     *   outcome: {action: string, why?: string}} | null>} what settled, for the caller to record
     */
    async drain() {
      if (!held) return null;
      const ticket = held;
      held = null;
      const outcome = await settle(ticket);
      if (outcome.action === "merged") {
        log(
          phaseLine({
            letter: "F",
            detail: "merged · worktree removed",
            ms: Date.now() - ticket.at,
          }),
        );
      } else {
        log(`  ⚠️ #${ticket.ticket} ${outcome.why}`);
        // Red CI is not a failed ticket: the next session fixes it from what the pull request
        // shows, and a session needs the worktree this one released at the push.
        if (outcome.action === "fix") reattach(ticket.cwd, ticket.branch);
      }
      return { ticket, outcome };
    },
    async adopt(next) {
      const settled = await this.drain();
      release(next.cwd);
      held = next;
      return settled;
    },
  };
}

/** Sliced, so `.loop-stop` still reaches the loop across a five-hour wait. */
export async function holdFor(
  ms,
  exists = (f) => fs.existsSync(f),
  slice = 30_000,
) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (exists(STOP_FILE)) return "stopped";
    // Not unref'd: by now this is the only handle keeping the process alive.
    await new Promise((r) =>
      setTimeout(r, Math.min(slice, until - Date.now())),
    );
  }
  return "waited";
}

/** CI went red, so the ticket needs a session again — and a session needs the worktree back. */
function reattachWorktree(cwd, branch, log = console.log, run = sh) {
  try {
    run("git", ["worktree", "add", cwd, branch]);
    return true;
  } catch (err) {
    log(
      `  ⚠️ could not re-attach ${cwd} — ${String(err.message).split("\n")[0]}`,
    );
    return false;
  }
}

/** One ticket's worth of the issue, for the header. Covers the resume path, which has no picker. */
function ticketFacts(number) {
  try {
    const raw = execFileSync(
      "gh",
      ["issue", "view", String(number), "--json", "title,labels,url"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const issue = JSON.parse(raw);
    return {
      title: issue.title,
      url: issue.url,
      size:
        issue.labels.map((l) => l.name).find((n) => n.startsWith("size:")) ??
        null,
    };
  } catch {
    return { title: `ticket #${number}`, url: "", size: null };
  }
}

/**
 * Spawns one session and draws its board from the stream.
 *
 * `spawnFn` is a parameter so a test can drive fixture lines through the whole path without a
 * `claude` binary. stderr stays inherited: a crash should still print itself rather than being
 * reassembled from a log nobody is watching.
 *
 * @param {Function} spawnFn
 * @param {{number: number, queue: object, at?: string|null, log?: Function, facts?: Function,
 *   stallMs?: number, tick?: number}} opts
 */
export function runTicket(
  spawnFn,
  {
    number,
    queue,
    at = null,
    log = console.log,
    facts = ticketFacts,
    stallMs = STALL_MS,
    tick = 30_000,
  },
) {
  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `${number}.jsonl`);
  const sink = createWriteStream(logPath, { flags: "a" });
  const startedAt = Date.now();

  const state = {
    phase: at,
    printedHeader: false,
    result: null,
    version: null,
    phases: {},
    lastFactAt: Date.now(),
    lastDerive: 0,
    blocked: false,
    blockedUntil: 0,
    stalled: false,
    files: 0,
  };

  // A TTY gets one rewritten line saying the build is still moving; a pipe or a file gets nothing,
  // so the log reads the same in all three places. The phase's own line overwrites it, never
  // scrolls past it.
  const beat = { timer: null, shown: false, at: 0 };
  const erase = () => {
    if (!beat.shown) return;
    process.stdout.write(`\r${BLANK}\r`);
    beat.shown = false;
  };
  const say = (line) => {
    erase();
    log(line);
  };

  const closePhase = (letter, detail) => {
    state.phases[letter] = Math.round((Date.now() - startedAt) / 1000);
    say(phaseLine({ letter, detail, ms: Date.now() - startedAt }));
  };

  if (at) {
    say(header({ number, ...facts(number), queue }));
    say(phaseLine({ letter: at, detail: "resumed", ms: 0 }));
    state.printedHeader = true;
  }

  const child = spawnFn("claude", queueLoopArgs(), {
    stdio: ["ignore", "pipe", "inherit"],
    // A background update landing at 2am changes the system prompt, and every remaining ticket of
    // the night then rebuilds its cached prefix at full price, with nothing to see. Whether to
    // update is a decision for a person between runs.
    env: { ...process.env, DISABLE_AUTOUPDATER: "1" },
  });

  createInterface({ input: child.stdout }).on("line", (line) => {
    sink.write(`${line}\n`);
    state.lastFactAt = Date.now();
    const fact = readLine(line);
    if (!fact) return;

    if (fact.kind === "init") state.version = fact.version;
    if (fact.kind === "result") state.result = fact;
    if (fact.kind === "rate_limit") {
      if (fact.blocked && !state.blocked) {
        state.blocked = true;
        state.blockedUntil = fact.resetsAtMs ?? 0;
        say(
          closing({
            outcome: "rate_limited",
            number,
            why: `the ${fact.window ?? "usage"} limit is spent — resets ${clockAt(fact.resetsAt)}`,
            ms: 0,
            cost: 0,
          }),
        );
      }
    }
    if (fact.kind !== "tool") return;

    for (const call of fact.calls) {
      // A subagent's own tool calls are phase B's work, not the session's progress through it.
      if (call.parent) continue;
      const before = state.phase;
      let next = advance(state.phase, phaseOf(call));
      // `derive()` shells out to git four times and to `gh` once, synchronously, in the handler that
      // drains the child's stdout — and `git commit` fires many times in one ticket. Re-deriving on
      // every one applies the tracker's latency to the session being watched, for a phase that can
      // only move once. A missed re-derive costs a phase line arriving late, never a wrong one.
      const due = Date.now() - state.lastDerive > REDERIVE_MS;
      if (call.name === "Bash" && REDERIVE.test(call.command) && due) {
        state.lastDerive = Date.now();
        const d = derive();
        next = advance(next, d.phase);
        // The count as of the last commit: after the ticket lands, its worktree is gone and there
        // is nothing left to count.
        state.files = d.changed?.length ?? state.files;
      }
      state.phase = next;
      if (next === before) continue;

      if (!state.printedHeader) {
        say(header({ number, ...facts(number), queue }));
        state.printedHeader = true;
      }
      closePhase(next, "");
    }
  });

  if (process.stdout.isTTY) {
    beat.timer = setInterval(() => {
      if (!state.phase) return;
      process.stdout.write(
        `\r${heartbeat({ letter: state.phase, ms: Date.now() - startedAt, at: beat.at++ })}`,
      );
      beat.shown = true;
    }, BEAT_MS);
    beat.timer.unref();
  }

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
      if (beat.timer) clearInterval(beat.timer);
      erase();
      // Resolved on the sink's own finish, not on the child's close: `end()` only asks, and a
      // caller reading the log it was just handed would otherwise find it short.
      sink.end(() =>
        resolve({
          status: state.stalled ? "stalled" : (status ?? 1),
          blocked: state.blocked,
          blockedUntil: state.blockedUntil,
          result: state.result,
          phase: state.phase,
          phases: state.phases,
          files: state.files,
          version: state.version,
          ms: Date.now() - startedAt,
          log: logPath,
        }),
      );
    });
  });
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

/**
 * Written as each ticket ends rather than at exit, so a crash or a closed terminal keeps whatever
 * the night had already done.
 */
const today = () => new Date().toISOString().slice(0, 10);
const reportPath = () => path.join(LOG_DIR, `run-${today()}.md`);

const NL = "\n";

function record(entry, line) {
  mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(
    path.join(LOG_DIR, "tickets.jsonl"),
    JSON.stringify(entry) + NL,
    "utf8",
  );
  if (!fs.existsSync(reportPath())) {
    fs.writeFileSync(reportPath(), `# queue-loop ${today()}` + NL + NL, "utf8");
  }
  fs.appendFileSync(reportPath(), line + NL, "utf8");
}

/** A ticket's raw stream log is worth keeping for a week; after that it is only taking up disk. */
function pruneLogs(now = Date.now()) {
  const week = 7 * 24 * 60 * 60_000;
  if (!fs.existsSync(LOG_DIR)) return;
  for (const name of fs.readdirSync(LOG_DIR)) {
    if (!name.endsWith(".jsonl") || name === "tickets.jsonl") continue;
    const file = path.join(LOG_DIR, name);
    if (now - fs.statSync(file).mtimeMs > week)
      fs.rmSync(file, { force: true });
  }
}

const REPO = "metasito/murlan";
const tsx = (args) => JSON.parse(sh("npx", ["tsx", ...args]));

/** land.ts merges when it can and otherwise names what it wants next; both shapes read the same. */
const landingOf = (out) =>
  out.merged
    ? { action: "merge", reason: out.reason }
    : { action: out.next, reason: out.reason };

/** The pull request this branch pushed, if it pushed one. */
function pushedPr(branch) {
  try {
    const [pr] = JSON.parse(
      sh("gh", [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "open",
        "--json",
        "number",
        "--limit",
        "1",
      ]),
    );
    return pr?.number ?? null;
  } catch {
    return null;
  }
}

/**
 * Waits for the pushed branch's CI and lands it. No judgement here — `ciVerdict` says whether the
 * run passed, `land.ts` says whether the pull request can merge — which is why the session that
 * built the ticket has already exited by the time this runs.
 *
 * Updating a behind branch costs one more CI run; merging behind costs two, and tests a tree no run
 * has seen.
 */
/**
 * Two budgets, not one. A branch updated twice because main moved twice is a healthy branch on a
 * busy night; a verdict asked for twice because the runner had nothing to say is a sick one. Sharing
 * a counter between them parks whichever happens to go second.
 */
export const SETTLE_ROUNDS = { update: 3, retry: 3 };

/** GitHub re-points the pull request head asynchronously; asked at once, CI answers for the old one. */
const SETTLE_PAUSE_MS = 15_000;

async function settle(pending, log = console.log, pause = SETTLE_PAUSE_MS) {
  const left = { ...SETTLE_ROUNDS };
  // Not unref'd, for the same reason `holdFor` is not: this is the only handle open while it waits.
  const wait = () => new Promise((r) => setTimeout(r, pause));

  for (;;) {
    let next;
    try {
      const verdict = tsx([
        "lib/loop/ciVerdict.ts",
        REPO,
        pending.branch,
        String(pending.pr),
      ]);
      const landing = verdict.pass
        ? landingOf(tsx(["lib/loop/land.ts", REPO, String(pending.pr)]))
        : undefined;
      next = afterPush({ verdict, landing });
    } catch (err) {
      // `gh` refusing, a rate limit, or anything that is not JSON. The ticket is pushed and its
      // branch is intact, so this parks rather than ending the night.
      return {
        action: "park",
        why: `could not read CI — ${String(err.message).split("\n")[0]}`,
      };
    }

    if (next.action === "update-branch" && left.update-- > 0) {
      log(
        `  ⏳ #${pending.ticket} main moved — updating the branch and reading CI again`,
      );
      sh("gh", ["pr", "update-branch", String(pending.pr)]);
      await wait();
      continue;
    }
    if (next.action === "retry-verdict" && left.retry-- > 0) {
      log(`  ⏳ #${pending.ticket} ${next.why} — asking once more`);
      await wait();
      continue;
    }
    if (next.action === "update-branch" || next.action === "retry-verdict") {
      return {
        action: "park",
        why: `${next.action} did not settle in ${SETTLE_ROUNDS.update} rounds`,
      };
    }
    if (next.action === "merged") {
      sh("gh", [
        "issue",
        "edit",
        String(pending.ticket),
        "--remove-label",
        "in-progress",
      ]);
    }
    return next;
  }
}

/** Where the ticket stood when its session exited — what the progress guard compares against. */
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

async function main() {
  let prev = null;
  let failures = 0;
  let waits = 0;
  let waitsOn = null;
  const totals = { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 };

  pruneLogs();

  const slot = mergeSlot({
    settle,
    release: releaseWorktree,
    reattach: reattachWorktree,
  });

  /**
   * A pushed ticket is not a landed one, so its row and its place in the totals are written when CI
   * has answered — never at the push, which would report a merge that may never happen and would
   * hide a night of red CI from the circuit breaker.
   */
  const account = (settled) => {
    if (!settled) return;
    const { ticket: held, outcome } = settled;

    if (outcome.action === "merged") {
      failures = 0;
      totals.landed += 1;
      console.log(
        closing({ outcome: "merged", number: held.ticket, ...held.cost }),
      );
      record(
        row({ ...held.record, outcome: "landed", ci: { pass: true } }),
        reportRow({ ...held.report, outcome: "landed" }),
      );
      return;
    }
    // A ticket gone back for a fix has not finished: its row is written by the session that fixes it.
    if (outcome.action === "fix") return;

    failures += 1;
    totals.parked += 1;
    park(held.ticket, {
      phase: "E",
      why: outcome.why,
      log: path.join(LOG_DIR, `${held.ticket}.jsonl`),
      cwd: null,
      branch: held.branch,
      dirty: false,
    });
    record(
      row({ ...held.record, outcome: "parked", ci: { pass: false } }),
      reportRow({ ...held.report, outcome: "parked", why: outcome.why }),
    );
  };

  const drain = async () => account(await slot.drain());
  const adopt = async (next) => account(await slot.adopt(next));

  for (;;) {
    if (takeStopFile(fs, STOP_FILE)) {
      console.log(
        "queue-loop: .loop-stop — draining, nothing new will be started",
      );
      await drain();
      return 0;
    }

    const gate = canStartNext({ pending: slot.pending });
    if (!gate.ok) {
      console.log(`  ⏳ ${gate.why}`);
      await drain();
    }
    if (!syncProtocol(git, (m) => console.error(m))) return 1;

    const pre = spawnSync(process.execPath, ["scripts/queue-pre.mjs"], {
      stdio: "inherit",
    });
    if (pre.status !== 0) return pre.status ?? 1;

    const route = nextRoute();
    if (shouldStop(route)) {
      // The queue is empty of new work, but a pushed ticket may still be waiting to merge.
      await drain();
      console.log(`queue-loop: ${route.title} — stopping`);
      console.log(runTotal(totals));
      return 0;
    }

    // Never a silent terminal: a fresh ticket has nothing truthful to show until it is claimed.
    if (!route.resuming)
      console.log(`  · picking — ${route.queue.implement} takeable`);

    const run = await runTicket(spawn, {
      number: route.number,
      queue: route.queue,
      at: route.resuming ? (route.phase ?? "C") : null,
    });

    const after = standing();
    const pushed = after?.branch ? pushedPr(after.branch) : null;

    // `done` is "this session pushed": a session refused before claiming leaves no live ticket
    // either, so "no ticket is live" cannot tell the two apart.
    const step = afterRefusal({
      ticket: route.number,
      waits,
      waitsOn,
      blocked: run.blocked,
      blockedUntil: run.blockedUntil,
      done: Boolean(pushed),
    });
    waits = step.waits;
    waitsOn = step.waitsOn;

    if (step.action === "retry") {
      // Spent before the refusal is still spent.
      totals.cost += run.result?.cost ?? 0;
      totals.ms += run.ms;
      prev = after;
      // The pending pull request must not sleep through an unrelated window.
      await drain();
      console.log(
        step.hold
          ? `  ⏸ #${route.number} waiting out the usage window (${waits}/${WAIT.TRIES}) — back at ${clockAt(Date.now() + step.hold)}`
          : `  ⏸ #${route.number} refused, and the window has already reset — going again`,
      );
      if (step.hold && (await holdFor(step.hold)) === "stopped") {
        console.log("queue-loop: .loop-stop during the wait — stopping");
        return 0;
      }
      continue;
    }

    totals.tickets += 1;
    totals.cost += run.result?.cost ?? 0;
    totals.ms += run.ms;

    // A ticket still live after its session exited did not land, whatever the exit code said.
    const landed = !after || after.ticket !== route.number;
    const stuck = after && !madeProgress(prev, after);
    const why = step.why
      ? step.why
      : stuck
        ? "resumed with nothing committed since the last run"
        : run.status === "stalled"
          ? `no output for ${Math.round(STALL_MS / 60_000)}m in phase ${run.phase ?? "?"}`
          : run.status !== 0
            ? `the session exited ${run.status} in phase ${run.phase ?? "?"}`
            : null;

    const pr = pushed;
    const facts = ticketFacts(route.number);

    if (pr && !why) {
      // Pushed and reviewed, so nothing left needs a model. It goes in the merge queue and the next
      // ticket starts building against its CI wait rather than behind it.
      console.log(
        closing({
          outcome: "landed",
          number: route.number,
          files: run.files,
          turns: run.result?.turns ?? 0,
          ms: run.ms,
          cost: run.result?.cost ?? 0,
        }),
      );
      console.log(
        `  ⏳ #${route.number} CI running on PR #${pr} — starting the next ticket`,
      );
      await adopt({
        ticket: route.number,
        pr,
        branch: after.branch,
        cwd: after.cwd,
        changed: after.changed ?? [],
        at: Date.now(),
        cost: {
          files: run.files,
          turns: run.result?.turns ?? 0,
          ms: run.ms,
          cost: run.result?.cost ?? 0,
        },
        record: {
          number: route.number,
          size: facts.size,
          pr,
          phases: run.phases,
          result: run.result,
          reviewRounds: 0,
          startedAt: new Date(Date.now() - run.ms).toISOString(),
          version: run.version,
        },
        report: {
          number: route.number,
          title: facts.title,
          pr,
          ms: run.ms,
          cost: run.result?.cost ?? 0,
        },
      });
    } else if (landed && !why) {
      failures = 0;
      totals.landed += 1;
      console.log(
        closing({
          outcome: "landed",
          number: route.number,
          files: run.files,
          turns: run.result?.turns ?? 0,
          ms: run.ms,
          cost: run.result?.cost ?? 0,
        }),
      );
    } else {
      failures += 1;
      totals.parked += 1;
      if (after) {
        park(route.number, {
          phase: after.phase,
          why: why ?? "the session exited without landing the ticket",
          log: run.log,
          cwd: after.cwd,
          branch: after.branch,
          dirty: after.dirty,
        });
      }
      console.log(
        closing({
          outcome: "parked",
          number: route.number,
          why: why ?? "the session exited without landing the ticket",
          ms: run.ms,
          cost: run.result?.cost ?? 0,
          log: run.log,
        }),
      );
    }

    // A pushed ticket's row is written by `drain()` once CI has answered, not here.
    if (!pr || why) {
      const outcome = landed && !why ? "landed" : "parked";
      record(
        row({
          number: route.number,
          size: facts.size,
          outcome,
          pr,
          phases: run.phases,
          result: run.result,
          ci: null,
          reviewRounds: 0,
          startedAt: new Date(Date.now() - run.ms).toISOString(),
          version: run.version,
        }),
        reportRow({
          number: route.number,
          title: facts.title,
          outcome,
          pr,
          ms: run.ms,
          cost: run.result?.cost ?? 0,
          why: why ?? undefined,
        }),
      );
    }

    prev = after;
    if (shouldHalt(failures)) {
      await drain();
      console.error(
        `queue-loop: ${failures} tickets in a row did not land — stopping`,
      );
      const total = runTotal(totals);
      console.log(total);
      fs.appendFileSync(reportPath(), `\n${total}\n`, "utf8");
      return 1;
    }
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  // An unhandled rejection here would end the night with a one-line node trace and no exit status,
  // in the one process whose job is to say what happened.
  main()
    .catch((err) => {
      console.error(
        `queue-loop: stopped by an unhandled error — ${err?.stack ?? err}`,
      );
      return 1;
    })
    .then((code) => process.exit(code));
}
