// scripts/queue-loop.mjs
/**
 * The loop that never stops. `.claude/commands/queue.md` runs one ticket per process and exits;
 * this is what starts the next one, in a clean process, so no ticket's context reaches the next.
 *
 * The split: this picks one ticket, passes its number to the session, waits for the session to
 * exit, reads CI, polls mergeability, merges, and records. The session owns claim → build →
 * review → gate → push and its own worktree teardown, because it is the only process that knows
 * whether its tree is dirty. Tickets are serialised, so there is no pending pull request held in
 * memory for a crash to orphan.
 *
 * It exits only when there is genuinely nothing to do. A spent usage window is a wait, not an end:
 * see `holdFor`.
 *
 * Usage: node scripts/queue-loop.mjs
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs, { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { derive } from "./loop-derive.mjs";
import { readLine } from "./loop-stream.mjs";
import {
  activeLine,
  bell,
  clockAt,
  closing,
  header,
  phaseLine,
  queueLine,
  reportRow,
  runTotal,
  toolDetail,
} from "./loop-render.mjs";
import { row } from "./loop-record.mjs";
import { readAllowedTools } from "./loop-tools.mjs";

const LOG_DIR = ".loop-logs";
const STOP_FILE = ".loop-stop";
const REPO = "metasito/murlan";

export function isInvokedDirectly(argv1, moduleUrl) {
  return Boolean(argv1) && path.resolve(argv1) === fileURLToPath(moduleUrl);
}

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
 * @returns {{skill: string, number: number, title: string, phase?: string, resuming: boolean}|null}
 */
export function liveRoute(status) {
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
  const live = liveRoute(derive());
  if (live) return { ...live, size: null, queue: { implement: 0, triage: 0, wayfinder: 0 } };
  const stdout = execFileSync("node", ["scripts/next-ticket.mjs"], { encoding: "utf8" });
  return { ...parseRoute(stdout), queue: parseStatus(stdout), resuming: false };
}

/**
 * The real bound is turns: a dollar cap is checked after a turn settles, so its stopping point
 * moves with the model and the context — measured 8x to 42x over a small cap — and at $15 with
 * subagents in flight it stops the *subagents* and lets the session carry on. #969 lost its
 * phase-D review to it, which is two opus reviewers, and finished anyway. The dollar figure stays
 * as a backstop against one pathological turn, well above what a healthy ticket reaches.
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
    String(TURNS_BY_SIZE[size ?? ""] ?? TURNS_DEFAULT),
    "--max-budget-usd",
    TICKET_BUDGET_USD,
  ];
}

// The session and the loop read these from the shared checkout, not from the ticket's worktree.
const PROTOCOL = ["CLAUDE.md", ".claude", "scripts"];

/**
 * Leaves the shared checkout on an up-to-date `main`, or refuses and says why.
 *
 * It asks whether the protocol files are *dirty*, not whether they differ from `origin/main`.
 * Those are different questions: the loop's own tickets edit `scripts/`, so the moment one merges
 * the checkout differs from origin until it is fast-forwarded — which is staleness, repaired here
 * rather than reported. Only an uncommitted edit is drift, and it belongs to someone.
 */
export function syncCheckout(git, log) {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").trim();
  if (branch === "HEAD") {
    log("queue-loop: the shared checkout is on a detached HEAD — put it back on main first.");
    return false;
  }

  const dirty = git("status", "--porcelain", "--", ...PROTOCOL).trim();
  if (dirty) {
    log("queue-loop: the protocol files in the shared checkout have uncommitted edits:");
    for (const line of dirty.split("\n")) log(`  ${line}`);
    log("  Commit them, or put them somewhere else. Nothing here will discard them.");
    return false;
  }

  if (branch !== "main") {
    const own = Number(git("rev-list", "--count", "origin/main..HEAD").trim()) || 0;
    if (own > 0) {
      log(`queue-loop: ${branch} is checked out with ${own} commit(s) of its own — not moving it.`);
      return false;
    }
    try {
      git("checkout", "main");
    } catch (err) {
      log(`queue-loop: cannot return to main — ${String(err.message).split("\n")[0]}`);
      return false;
    }
  }

  try {
    git("fetch", "origin", "--quiet");
    git("merge", "--ff-only", "origin/main");
  } catch (err) {
    log(`queue-loop: cannot fast-forward main — ${String(err.message).split("\n")[0]}`);
    return false;
  }
  return true;
}

/**
 * `lib/loop/ciVerdict.ts` blocks in phase E waiting for a CI run, which regularly takes twenty
 * minutes and emits nothing while it does. Any ceiling at or under that reads a working run as a
 * stalled one.
 */
export const STALL_MS = 30 * 60_000;

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
  return { action: "wait", hold: waitFor({ blocked, blockedUntil, done }, now), waits: waits + 1 };
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
export const shouldHalt = (consecutiveFailures) => consecutiveFailures >= BREAKER;

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
    return { action: "retry-verdict", why: "a job completed having run zero steps" };
  if (landing?.action === "already-merged") return { action: "merged", why: landing.reason };
  if (landing?.action === "recheck") return { action: "retry-verdict", why: landing.reason };
  if (!verdict.pass)
    return { action: "fix", why: `CI failed at ${verdict.failedStep ?? "an unnamed step"}` };
  if (landing?.action === "merge") return { action: "merged", why: landing.reason };
  if (landing?.action === "update-branch")
    return { action: "update-branch", why: landing.reason };
  return { action: "park", why: landing?.reason ?? "the pull request is not mergeable" };
}

/**
 * What a settled ticket costs the run.
 *
 * A mechanical failure — anything `settle()` decides — is not a decision the owner can make, so it
 * does not reach the tracker. The branch and the pull request are both intact and the next
 * iteration finds them from `derive()`; what it needs is the breaker, not a label.
 *
 * @param {{action: string}} settled
 */
export function settleOutcome({ action }) {
  if (action === "merged") return { countsAsFailure: false, recorded: "landed" };
  if (action === "fix") return { countsAsFailure: false, recorded: null };
  return { countsAsFailure: true, recorded: "stalled" };
}

/**
 * Whether a session's exit ended the ticket.
 *
 * Only `settle()` ever says "landed", and only after a merge. This says whether the session did
 * its half — pushed a pull request with nothing left to explain. The predicate it replaces was
 * `after.ticket !== route.number`, which is true whenever the session worked a *different* ticket,
 * stood down on a lost claim race, or `derive()` could not tell which run was live.
 *
 * @param {{pr: number|null, why: string|null}} run
 */
export function outcomeOf({ pr, why }) {
  if (why) return { landed: false, why };
  if (!pr) return { landed: false, why: "the session pushed no pull request" };
  return { landed: false, why: null, pushed: pr };
}

/** Why this session did not finish its ticket, or null if it did. */
export function reasonFor(run, after, ticket) {
  if (after && after.ticket !== ticket) return `the session worked #${after.ticket}, not #${ticket}`;
  // The only place "Budget limit reached ($15.08 of $15); stopping background agents." is ever
  // said — the result event for that session still reads subtype "success".
  if (/Budget limit reached/.test(run.stderr ?? "")) return "the session spent its budget mid-phase";
  if (run.result?.subtype === "error_max_turns") return "the session ran out of turns";
  if (run.status === "stalled")
    return `no output for ${Math.round(STALL_MS / 60_000)}m in phase ${run.phase ?? "?"}`;
  if (run.status !== 0) return `the session exited ${run.status} in phase ${run.phase ?? "?"}`;
  return null;
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
  const file = path.join(LOG_DIR, `park-${number}.md`);
  step("comment", () => {
    write(file, body, "utf8");
    run("gh", ["issue", "comment", String(number), "--body-file", file]);
  });

  if (cwd) step("worktree", () => run("npm", ["run", "worktrees:remove", "--", cwd]));

  return { ok: failed.length === 0, failed };
}

const ERASE = "\r[2K";
const REDRAW_MS = 120;

/**
 * The only thing in the loop that knows a cursor exists.
 *
 * Everything the run prints goes through `say` or `warn`, which erase the open phase's line before
 * writing and redraw it after — a write landing between two redraws otherwise leaves the tail of
 * the spinner in front of it, and that is the failure mode a person actually sees.
 *
 * At anything that is not a terminal — a pipe, a file, CI — every escape is suppressed and the
 * output is the append-only stream `loop-render.mjs` produces.
 */
export function ticker(out = process.stdout, err = process.stderr) {
  const live = Boolean(out.isTTY);
  let open = null;
  let frame = 0;
  let timer = null;
  let drawn = false;

  // The escape clears the whole row whatever is on it. Counting the characters back instead is
  // wrong for anything double-width, and a command in the detail can carry one.
  const erase = () => {
    if (!drawn) return;
    out.write(ERASE);
    drawn = false;
  };

  // A line wider than the terminal wraps, after which a carriage return lands at the start of the
  // last visual row and the erase misses every row over it.
  const room = () => Math.max(30, Math.min(78, (out.columns ?? 80) - 1));

  const draw = () => {
    if (!live || !open) return;
    erase();
    const width = room();
    const line = activeLine({ ...open, ms: Date.now() - open.startedAt, frame: frame++, width });
    // `activeLine` sizes itself, but it counts characters and a command in the detail can carry a
    // double-width one. This is the backstop that cannot be argued with.
    const chars = [...line];
    out.write(chars.length > width ? chars.slice(0, width).join("") : line);
    drawn = true;
  };

  const clear = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  // `api.close()`, not `this.close()`: the object is destructured by its callers and `this` does
  // not survive that.
  const api = {
    say(line) {
      erase();
      out.write(`${line}\n`);
      draw();
    },
    warn(text) {
      erase();
      err.write(text.endsWith("\n") ? text : `${text}\n`);
      draw();
    },
    start(letter) {
      api.close();
      open = { letter, detail: "", startedAt: Date.now() };
      frame = 0;
      if (!live) return;
      timer = setInterval(draw, REDRAW_MS);
      // A redraw must never be the reason the process is still alive.
      timer.unref?.();
      draw();
    },
    detail(text) {
      if (!open) return;
      open.detail = text;
      draw();
    },
    close(mark = "✓") {
      if (!open) return;
      const done = phaseLine({
        letter: open.letter,
        ms: Date.now() - open.startedAt,
        mark,
        // The finished line replaces the live one, so it is sized the same way — otherwise the
        // pair reads as two different lines at anything narrower than 79 columns.
        width: live ? room() : undefined,
      });
      clear();
      erase();
      open = null;
      out.write(`${done}\n`);
    },
    stop() {
      clear();
      erase();
      open = null;
    },
  };
  return api;
}

/** One ticket's worth of the issue, for the header. Covers the resume path, which has no picker. */
function ticketFacts(number) {
  try {
    const issue = JSON.parse(
      execFileSync("gh", ["issue", "view", String(number), "--json", "title,labels,url"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    return {
      title: issue.title,
      url: issue.url,
      size: issue.labels.map((l) => l.name).find((n) => n.startsWith("size:")) ?? null,
    };
  } catch {
    return { title: `ticket #${number}`, url: "", size: null };
  }
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
    dir = LOG_DIR,
  },
) {
  mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, `${number}.jsonl`);
  const sink = createWriteStream(logPath, { flags: "a" });
  const startedAt = Date.now();

  const state = {
    phase: at,
    result: null,
    version: null,
    lastFactAt: Date.now(),
    blocked: false,
    blockedUntil: 0,
    stalled: false,
    stderr: "",
  };

  screen.say(header({ number, ...facts(number), queue }));
  if (at) screen.say(phaseLine({ letter: at, detail: "resumed", ms: 0, mark: "↻" }));

  const child = spawnFn("claude", queueLoopArgs(number, size), {
    stdio: ["ignore", "pipe", "pipe"],
    // A background update landing at 2am changes the system prompt, and every remaining ticket of
    // the night then rebuilds its cached prefix at full price, with nothing to see. Whether to
    // update is a decision for a person between runs.
    env: { ...process.env, DISABLE_AUTOUPDATER: "1" },
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
    if (fact.kind === "phase") {
      state.phase = fact.letter;
      screen.start(fact.letter);
    }
    // The only sign of life during phase D, which is the longest one and the one that read as a
    // hang: its work happens entirely inside two review subagents.
    if (fact.kind === "tool" && fact.calls.length) screen.detail(toolDetail(fact.calls.at(-1)));
    // A session emits one result per turn, and a background task's wake-up is a turn. The real one
    // carries `origin: null`; every other carries origin.kind "task-notification". Last-wins
    // across all of them reported a 144-turn session as one turn.
    if (fact.kind === "result" && !fact.origin) state.result = fact;
    if (fact.kind === "rate_limit" && fact.blocked && !state.blocked) {
      state.blocked = true;
      state.blockedUntil = fact.resetsAtMs ?? 0;
      screen.say(
        closing({
          outcome: "rate_limited",
          number,
          why: `the ${fact.window ?? "usage"} limit is spent — resets ${clockAt(fact.resetsAt)}`,
          ms: 0,
          cost: 0,
        }),
      );
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
      // The phase the session was in when it exited: closed here because the session emits no
      // marker for a phase it did not finish, and a mark of its own because a ✓ on a session that
      // stalled is the display saying the opposite of what happened.
      screen.close(state.stalled || status !== 0 ? "✗" : "✓");
      // Resolved on the sink's own finish, not on the child's close: `end()` only asks, and a
      // caller reading the log it was just handed would otherwise find it short.
      sink.end(() =>
        resolve({
          status: state.stalled ? "stalled" : (status ?? 1),
          blocked: state.blocked,
          blockedUntil: state.blockedUntil,
          result: state.result,
          phase: state.phase,
          stderr: state.stderr,
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
  fs.appendFileSync(path.join(LOG_DIR, "tickets.jsonl"), JSON.stringify(entry) + NL, "utf8");
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
    if (now - fs.statSync(file).mtimeMs > week) fs.rmSync(file, { force: true });
  }
}

const tsx = (args) => JSON.parse(sh("npx", ["tsx", ...args]));

/** land.ts merges when it can and otherwise names what it wants next; both shapes read the same. */
const landingOf = (out) =>
  out.merged ? { action: "merge", reason: out.reason } : { action: out.next, reason: out.reason };

/** The pull request this branch pushed, if it pushed one. */
function pushedPr(branch) {
  try {
    const [pr] = JSON.parse(
      sh("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "number", "--limit", "1"]),
    );
    return pr?.number ?? null;
  } catch {
    return null;
  }
}

/**
 * Three budgets, not one. A branch updated twice because main moved twice is a healthy branch on a
 * busy night; a verdict asked for twice because the runner had nothing to say is a sick one; and a
 * mergeability job still running is neither. Sharing a counter parks whichever goes second.
 */
export const SETTLE_ROUNDS = { update: 3, retry: 3, recheck: 8 };

/** GitHub re-points the pull request head asynchronously; asked at once, CI answers for the old one. */
const SETTLE_PAUSE_MS = 15_000;

/**
 * Waits for the pushed branch's CI and lands it. No judgement here — `ciVerdict` says whether the
 * run passed, `land.ts` says whether the pull request can merge — which is why the session that
 * built the ticket has already exited by the time this runs.
 */
async function settle(pending, log = console.log, pause = SETTLE_PAUSE_MS) {
  const left = { ...SETTLE_ROUNDS };
  // Not unref'd, for the same reason `holdFor` is not: this is the only handle open while it waits.
  const wait = () => new Promise((r) => setTimeout(r, pause));

  for (;;) {
    let next;
    let asking = "retry";
    try {
      const verdict = tsx(["lib/loop/ciVerdict.ts", REPO, pending.branch, String(pending.pr)]);
      const landing = verdict.pass
        ? landingOf(tsx(["lib/loop/land.ts", REPO, String(pending.pr)]))
        : undefined;
      if (landing?.action === "recheck") asking = "recheck";
      next = afterPush({ verdict, landing });
    } catch (err) {
      // `gh` refusing, a rate limit, or anything that is not JSON. The ticket is pushed and its
      // branch is intact, so this stalls rather than ending the night.
      return { action: "park", why: `could not read CI — ${String(err.message).split("\n")[0]}` };
    }

    if (next.action === "update-branch" && left.update-- > 0) {
      log(`  ⏳ #${pending.ticket} main moved — updating the branch and reading CI again`);
      try {
        sh("gh", ["pr", "update-branch", String(pending.pr)]);
      } catch (err) {
        return { action: "park", why: `could not update the branch — ${String(err.message).split("\n")[0]}` };
      }
      await wait();
      continue;
    }
    if (next.action === "retry-verdict" && left[asking]-- > 0) {
      log(`  ⏳ #${pending.ticket} ${next.why} — asking once more`);
      await wait();
      continue;
    }
    if (next.action === "update-branch" || next.action === "retry-verdict") {
      const spent = next.action === "update-branch" ? SETTLE_ROUNDS.update : SETTLE_ROUNDS[asking];
      return { action: "park", why: `${next.action} did not settle in ${spent} rounds` };
    }
    if (next.action === "merged") {
      try {
        sh("gh", ["issue", "edit", String(pending.ticket), "--remove-label", "in-progress"]);
      } catch {
        // The merge is what mattered. A stuck label is visible on the tracker and costs one edit.
      }
    }
    return next;
  }
}

/** Where the ticket stood when its session exited. */
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
 * One ticket, start to finish. Serialised deliberately: the previous design ran the next ticket
 * against the last one's CI wait, which bought ~22% wall clock and cost an in-memory pending pull
 * request that nothing recovered when the process died, a worktree released out from under a live
 * `derive()`, and two sessions merging each other's work to get past a branch cut from a `main`
 * that did not have it yet.
 *
 * @returns {Promise<{outcome: "landed"|"parked"|"stalled"|"stop"|"retry"|"refused",
 *   ticket?: number, why?: string, until?: number}>}
 */
export async function runOnce(io) {
  if (io.stopFile()) return { outcome: "stop", why: ".loop-stop" };
  if (!io.syncCheckout()) return { outcome: "stop", why: "the shared checkout is not usable" };
  const pre = io.queuePre();
  if (pre !== 0) return { outcome: "stop", why: `queue-pre exited ${pre}` };

  const route = io.pick();
  if (route.skill === "handoff") return { outcome: "stop", why: route.title };
  if (route.skill === "ambiguous") return { outcome: "stop", why: route.title };

  const run = await io.spawn(route);
  if (run.blocked)
    return { outcome: "refused", ticket: route.number, until: run.blockedUntil ?? 0, run };

  const dirtied = io.sharedCheckoutDirty?.();
  if (dirtied) io.log(`queue-loop: #${route.number}'s session left the shared checkout dirty:\n${dirtied}`);

  const after = io.standing();
  const pr = after?.branch ? io.pushedPr(after.branch) : null;
  const decided = outcomeOf({ pr, why: reasonFor(run, after, route.number) });

  if (!decided.pushed) {
    // A park is now only ever a decision the owner has to make, which is the whole of what the
    // bell is for. Not a landing, not a retry, not a settle failure.
    io.bell();
    if (after)
      io.park(route.number, {
        phase: after.phase,
        why: decided.why,
        log: run.log,
        cwd: after.cwd,
        branch: after.branch,
        dirty: after.dirty,
      });
    io.record({ number: route.number, outcome: "parked", why: decided.why, run, files: after?.changed?.length ?? 0 });
    return { outcome: "parked", ticket: route.number, why: decided.why };
  }

  const settled = await io.settle({
    ticket: route.number,
    pr,
    branch: after.branch,
    cwd: after.cwd,
  });
  const cost = settleOutcome(settled);
  if (cost.recorded === null) return { outcome: "retry", ticket: route.number, why: settled.why };
  io.record({
    number: route.number,
    outcome: cost.recorded,
    why: settled.why,
    run,
    pr,
    files: after.changed?.length ?? 0,
  });
  return cost.countsAsFailure
    ? { outcome: "stalled", ticket: route.number, why: settled.why }
    : { outcome: "landed", ticket: route.number };
}

/** The real IO, bound once so `runOnce` can be driven without git, the tracker or a binary. */
function realIo(totals, screen) {
  // The queue as the *previous* pick read it. The direction is what a night is made of, and this
  // is the one reading that costs nothing — the next pick is being made anyway.
  let before = null;
  return {
    stopFile: () => takeStopFile(fs, STOP_FILE),
    syncCheckout: () => syncCheckout(git, (m) => screen.warn(m)),
    queuePre: () =>
      spawnSync(process.execPath, ["scripts/queue-pre.mjs"], { stdio: "inherit" }).status ?? 1,
    pick: () => {
      const route = nextRoute();
      if (route.resuming) return route;
      if (before) screen.say(queueLine(before, route.queue));
      before = route.queue;
      return route;
    },
    spawn: (route) => {
      if (!route.resuming) screen.say(`  · picking — ${route.queue.implement} takeable`);
      return runTicket(spawn, {
        number: route.number,
        queue: route.queue,
        size: route.size,
        at: route.resuming ? (route.phase ?? "C") : null,
        screen,
      });
    },
    standing,
    pushedPr,
    settle: (pending) => settle(pending, (m) => screen.say(m)),
    park,
    bell,
    sharedCheckoutDirty: () => git("status", "--porcelain").trim(),
    log: (m) => screen.warn(m),
    record: ({ number, outcome, why, run, pr = null, files = 0 }) => {
      totals.cost += run.result?.cost ?? 0;
      totals.ms += run.ms;
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
        }),
      );
      record(
        row({
          number,
          size: facts.size,
          outcome,
          pr,
          phases: {},
          result: run.result,
          // `ci: {pass:false}` was written for every non-merged outcome. The loop does not know CI
          // failed; it knows the merge did not happen.
          ci: outcome === "landed" ? { pass: true } : null,
          reviewRounds: 0,
          startedAt: new Date(Date.now() - run.ms).toISOString(),
          version: run.version,
        }),
        reportRow({
          number,
          title: facts.title,
          outcome,
          pr,
          ms: run.ms,
          cost: run.result?.cost ?? 0,
          why: why ?? undefined,
        }),
      );
    },
  };
}

async function main() {
  let failures = 0;
  let waits = 0;
  const totals = { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 };
  pruneLogs();

  const screen = ticker();
  // An interrupted run must not leave a half-drawn spinner under the shell prompt, and the exit
  // handler covers the paths a signal does not reach.
  process.on("exit", () => screen.stop());
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      screen.stop();
      process.exit(130);
    });
  }
  const io = realIo(totals, screen);

  for (;;) {
    let pass;
    try {
      pass = await runOnce(io);
    } catch (err) {
      screen.warn(`queue-loop: the iteration threw — ${String(err?.stack ?? err)}`);
      failures += 1;
      if (shouldHalt(failures)) {
        screen.warn(`queue-loop: ${failures} tickets in a row did not land — stopping`);
        bell();
        return 1;
      }
      continue;
    }

    if (pass.outcome === "stop") {
      screen.say(`queue-loop: ${pass.why} — stopping`);
      screen.say(runTotal(totals));
      bell();
      return 0;
    }

    // A refusal is not a failure and not a ticket: the account is out of usage, which the branch,
    // the pull request and the label all survive. It waits, then goes again — an exit here costs
    // every remaining ticket of an unattended night.
    if (pass.outcome === "refused") {
      totals.cost += pass.run?.result?.cost ?? 0;
      totals.ms += pass.run?.ms ?? 0;
      const step = afterRefusal({ waits, blocked: true, blockedUntil: pass.until });
      waits = step.waits;
      if (step.action === "give-up") {
        screen.warn(`queue-loop: ${step.why} — stopping`);
        screen.say(runTotal(totals));
        bell();
        return 1;
      }
      screen.say(
        step.hold
          ? `  ⏸ #${pass.ticket} the usage window is spent (${waits}/${WAIT.TRIES}) — back at ${clockAt(Date.now() + step.hold)}`
          : `  ⏸ #${pass.ticket} refused, and the window has already reset — going again`,
      );
      if (step.hold && (await holdFor(step.hold, undefined, undefined, (m) => screen.say(m))) === "stopped") {
        screen.say("queue-loop: .loop-stop during the wait — stopping");
        bell();
        return 0;
      }
      continue;
    }

    waits = 0;
    if (pass.outcome === "retry") continue;
    totals.tickets += 1;
    if (pass.outcome === "landed") {
      failures = 0;
      totals.landed += 1;
    } else {
      failures += 1;
      totals.parked += 1;
    }
    if (shouldHalt(failures)) {
      // Read before anything resets it: the old message printed "0 tickets in a row did not land".
      const halted = failures;
      screen.warn(`queue-loop: ${halted} tickets in a row did not land — stopping`);
      const total = runTotal(totals);
      screen.say(total);
      fs.appendFileSync(reportPath(), `\n${total}\n`, "utf8");
      bell();
      return 1;
    }
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  // An unhandled rejection here would end the night with a one-line node trace and no exit status,
  // in the one process whose job is to say what happened.
  main()
    .catch((err) => {
      console.error(`queue-loop: stopped by an unhandled error — ${err?.stack ?? err}`);
      return 1;
    })
    .then((code) => process.exit(code));
}
