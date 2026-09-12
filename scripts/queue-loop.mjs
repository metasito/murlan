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

/**
 * `pinned` is a ticket the run is not finished with — a red CI round hands the same number back,
 * and letting the picker choose again leaves that one labelled `in-progress` with an open pull
 * request nothing will return to.
 *
 * A resumed route carries the ticket's size: without it `TURNS_BY_SIZE` fell through to the
 * default, so a `size:L` ticket resumed for a fix round was given 150 turns where its first
 * session had 320 — every resumed run of a large ticket bounded tighter than the one that had
 * already failed to finish it.
 *
 * @param {number|null} [pinned]
 */
function nextRoute(pinned = null) {
  const live = liveRoute(derive());
  if (live) return { ...live, size: ticketFacts(live.number).size, queue: null };
  if (pinned) {
    const { title, size } = ticketFacts(pinned);
    return { skill: "implement", number: pinned, title, size, queue: null, resuming: true, phase: "C" };
  }
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
export function syncCheckout(git, log, install = () => sh("npm", ["ci"], { stdio: "inherit" })) {
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

  let was;
  try {
    was = git("rev-parse", "HEAD").trim();
    git("fetch", "origin", "--quiet");
    git("merge", "--ff-only", "origin/main");
  } catch (err) {
    log(`queue-loop: cannot fast-forward main — ${String(err.message).split("\n")[0]}`);
    return false;
  }

  // The loop's own merges are what move the lockfile, and `preflight` refuses to start a ticket on
  // top of an install that has drifted from it. Left to the next iteration that is the loop
  // poisoning its own precondition: the first ticket touching package.json ends the night, on a
  // healthy machine, with a full queue. Reinstalling here is the repair, at the one moment no
  // session is live to have its node_modules pulled out from under it.
  try {
    if (git("diff", "--name-only", was, "HEAD").split("\n").includes("package-lock.json")) {
      log("queue-loop: the fast-forward moved package-lock.json — reinstalling before the next ticket");
      install();
    }
  } catch (err) {
    log(`queue-loop: could not reinstall after the fast-forward — ${String(err.message).split("\n")[0]}`);
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
 * when the child closes — so everything after that is bounded here instead. `STEP` is one `npx tsx`
 * call, generous enough for `gh run watch` to sit out a full ci.yml run; `DEADLINE` is the whole of
 * `settle`, so a branch that keeps asking for one more round cannot hold the night open.
 */
export const SETTLE = { STEP_MS: 45 * 60_000, DEADLINE_MS: 90 * 60_000 };

/** Consecutive red CI rounds on one ticket before it stops being the loop's to fix. */
export const CI_ROUNDS = 3;

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
  // Floored, always. A reset timestamp already in the past — a clock skew, a stale window, a
  // seven-day limit reported with an expired short-window reset — made `waitFor` answer 0, and a
  // hold of 0 is skipped entirely: twenty full `claude` spawns back to back, each paying its
  // context creation, before the ceiling stopped it. A knob with no floor under it.
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
  // A row, because a ticket that goes red three times otherwise produced three whole sessions and
  // nothing in the record: no cost, no turns, no count of how often the cap is reached.
  if (action === "fix") return { countsAsFailure: false, recorded: "retry" };
  return { countsAsFailure: true, recorded: "stalled" };
}

/**
 * What the session's exit leaves the supervisor to do.
 *
 * The pull request is the whole answer: an open one is settled, a merged one is a landing whoever
 * merged it, a closed one and an absent one are both the owner's. It is asked for by ticket
 * number, so phase F's teardown cannot hide it.
 *
 * @param {{pr: {number: number, state: string}|null, why: string|null}} run
 * @returns {{action: "settle"|"landed"|"park", pr?: number, why?: string}}
 */
export function outcomeOf({ pr, why }) {
  if (why) return { action: "park", why };
  if (!pr) return { action: "park", why: "the session pushed no pull request" };
  if (pr.state === "MERGED")
    return { action: "landed", pr: pr.number, why: `pull request #${pr.number} was already merged` };
  if (pr.state !== "OPEN")
    return { action: "park", pr: pr.number, why: `pull request #${pr.number} is ${String(pr.state).toLowerCase()}` };
  return { action: "settle", pr: pr.number };
}

/**
 * Why this session did not finish its ticket, or null if it did.
 *
 * @param {{status: number|string, phase?: string|null, stderr?: string, result?: object|null,
 *   declared?: {pr: number|null, stoodDown: boolean, why: string|null}|null}} run
 */
export function reasonFor(run, after, ticket) {
  const said = run.declared;
  if (said?.stoodDown) return said.why ?? "the session stood down";
  if (after?.ticket && after.ticket !== ticket) return `the session worked #${after.ticket}, not #${ticket}`;
  // A pull request the session said it pushed is a fact its exit status cannot take back. From
  // there CI and the merge are the supervisor's, and parking a pushed branch throws away the work
  // and the claim both.
  if (said?.pr) return null;
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

const ERASE = "\r\u001B[2K";
const HIDE = "\u001B[?25l";
const SHOW = "\u001B[?25h";
const REDRAW_MS = 120;

/**
 * The only thing in the loop that knows a cursor exists.
 *
 * Three rules, and the flicker was all three of them. **One write per frame** — erasing and then
 * drawing is two writes with an empty row between them, and that blank is the flash a person sees.
 * **Write only when the line changed** — eight identical repaints a second is eight chances to
 * tear, and the line only moves when the spinner turns or a second ticks. **Hide the cursor while
 * the line is live** — it sits at the end of the spinner, blinking and jumping a column per frame.
 *
 * At anything that is not a terminal — a pipe, a file, CI — every escape is suppressed and the
 * output is the append-only stream `loop-render.mjs` produces.
 */
export function ticker(out = process.stdout, err = process.stderr) {
  const live = Boolean(out.isTTY);
  let open = null;
  let timer = null;
  let drawn = "";
  let hidden = false;

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

  // A line wider than the terminal wraps, after which a carriage return lands at the start of the
  // last visual row and the erase misses every row over it.
  const room = () => Math.max(30, Math.min(78, (out.columns ?? 80) - 1));

  const draw = () => {
    if (!live || !open) return;
    const ms = Date.now() - open.startedAt;
    // The frame comes from the clock, not from a count of draws: a redraw prompted by a new tool
    // call inside the same frame window would otherwise turn the spinner, which makes every line
    // different from the last and defeats the only-write-on-change rule entirely.
    const line = activeLine({ ...open, ms, frame: Math.floor(ms / REDRAW_MS), width: room() });
    if (line === drawn) return;
    hide();
    // The erase clears the whole row whatever is on it — counting characters back is wrong for
    // anything double-width, and a command in the detail can carry one. Joined to the line so the
    // row is never briefly empty.
    out.write(ERASE + line);
    drawn = line;
  };

  /** Takes the live row down in the same write that puts the new text there. */
  const over = (text) => {
    out.write(live && drawn ? ERASE + text : text);
    drawn = "";
  };

  const clear = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  // `api.close()`, not `this.close()`: the object is destructured by its callers and `this` does
  // not survive that.
  const api = {
    say(line) {
      over(`${line}\n`);
      draw();
    },
    warn(text) {
      // The live row belongs to stdout and stderr cannot clear it, so the erase goes out on the
      // stream that owns it before the warning prints on the other one.
      if (live && drawn) {
        out.write(ERASE);
        drawn = "";
      }
      show();
      err.write(text.endsWith("\n") ? text : `${text}\n`);
      draw();
    },
    start(letter) {
      api.close();
      open = { letter, detail: "", startedAt: Date.now() };
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
      open = null;
      show();
      over(`${done}\n`);
    },
    stop() {
      clear();
      open = null;
      if (live && drawn) out.write(ERASE);
      drawn = "";
      show();
    },
  };
  return api;
}

/**
 * One ticket's worth of the issue, for the header, the turn bound and the record. Covers the
 * resume path, which has no picker.
 *
 * The review rounds come from the same read: phase D's cap of four is the one number the record
 * was never collecting, so whether $40 a ticket buys review rounds or burns turns could not be
 * answered from the file kept to answer it.
 */
const VERDICT_LINE = /^VERDICT:\s*(LAND|HOLD)\b/m;

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
      reviewRounds: (issue.comments ?? []).filter((c) => VERDICT_LINE.test(c.body ?? "")).length,
    };
  } catch {
    return { title: `ticket #${number}`, url: "", size: null, reviewRounds: 0 };
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
  };

  /** Seconds in the phase just left, so the record carries where a night's time actually goes. */
  const closePhase = () => {
    if (!state.phase) return;
    const secs = Math.round((Date.now() - state.phaseAt) / 1000);
    state.phases[state.phase] = (state.phases[state.phase] ?? 0) + secs;
    state.phaseAt = Date.now();
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
    if (fact.kind === "assistant") {
      if (fact.letter && fact.letter !== state.phase) {
        closePhase();
        state.phase = fact.letter;
        screen.start(fact.letter);
      }
      if (fact.declared) state.declared = fact.declared;
      // The only sign of life during phase D, which is the longest one and the one that read as a
      // hang: its work happens entirely inside two review subagents.
      if (fact.calls.length) screen.detail(toolDetail(fact.calls.at(-1)));
    }
    // A session emits one result per turn, and a background task's wake-up is a turn. The real one
    // carries `origin: null`; every other carries origin.kind "task-notification". Last-wins
    // across all of them reported a 144-turn session as one turn.
    if (fact.kind === "result" && !fact.origin) state.result = fact;
    if (fact.kind === "rate_limit") {
      // Cleared on the next reading that is not a refusal. Left sticky it pre-empted everything
      // else: a session refused at minute 2 that recovered and pushed at minute 40 was reported
      // `refused`, its pull request never looked for and its claim never released.
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
          }),
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
      screen.close(state.stalled || status !== 0 ? "✗" : "✓");
      // Resolved on the sink's own finish, not on the child's close: `end()` only asks, and a
      // caller reading the log it was just handed would otherwise find it short.
      sink.end(() =>
        resolve({
          status: state.stalled ? "stalled" : (status ?? 1),
          blocked: state.blocked,
          blockedUntil: state.blockedUntil,
          result: state.result,
          declared: state.declared,
          phase: state.phase,
          phases: state.phases,
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
 * One file per run, named for when the run started — not per calendar day.
 *
 * A day is not a boundary the loop has: two processes on one day appended to the same file, so a
 * closing total landed in the middle of it with five more rows underneath, and a run that crossed
 * midnight opened its second file with the first one's total under the wrong heading. Rows are
 * written as each ticket ends, so a crash keeps whatever the night had already done.
 */
const RUN_ID = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const reportPath = () => path.join(LOG_DIR, `run-${RUN_ID}.md`);

const NL = "\n";

function report(line) {
  mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(reportPath())) {
    fs.writeFileSync(reportPath(), `# queue-loop ${RUN_ID.replace(/-(\d\d)-(\d\d)$/, " $1:$2")}` + NL + NL, "utf8");
  }
  fs.appendFileSync(reportPath(), line + NL, "utf8");
}

function record(entry, line) {
  mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOG_DIR, "tickets.jsonl"), JSON.stringify(entry) + NL, "utf8");
  report(line);
}

/** A ticket's raw stream log is worth keeping for a week; after that it is only taking up disk. */
function pruneLogs(now = Date.now()) {
  const week = 7 * 24 * 60 * 60_000;
  if (!fs.existsSync(LOG_DIR)) return;
  for (const name of fs.readdirSync(LOG_DIR)) {
    if (!/\.(jsonl|log)$/.test(name) || name === "tickets.jsonl") continue;
    const file = path.join(LOG_DIR, name);
    if (now - fs.statSync(file).mtimeMs > week) fs.rmSync(file, { force: true });
  }
}

const tsx = (args) => JSON.parse(sh("npx", ["tsx", ...args], { timeout: SETTLE.STEP_MS }));

/**
 * Where a red run's failed-log tail waits for the session that has to fix it.
 *
 * `ciVerdict` spends a megabyte-scale fetch building it and `afterPush` read three other fields and
 * dropped it, so the fix session re-fetched CI itself — the one thing phase E tells it not to do.
 * Phase A reads this file when it exists.
 */
export const ciLogPath = (ticket) => path.join(LOG_DIR, `ci-${ticket}.log`);

/** land.ts merges when it can and otherwise names what it wants next; both shapes read the same. */
const landingOf = (out) =>
  out.merged ? { action: "merge", reason: out.reason } : { action: out.next, reason: out.reason };

/**
 * The pull request this ticket pushed, if it pushed one.
 *
 * Asked by ticket number, not only by branch: phase F tears the worktree down, `derive()` finds a
 * run only by that directory, and so the branch the old lookup needed was gone at exactly the
 * moment it was asked for. #891 pushed a green pull request, was reported as having pushed
 * nothing, and was left labelled `in-progress` with no claim released — $36.38 and a permanently
 * frozen ticket. The ticket number survives every teardown.
 *
 * `--state all`, because a pull request merged between the session's exit and this read — a peer,
 * an auto-merge, the owner — is a landing, not a session that pushed nothing.
 *
 * @param {string|null} branch
 * @param {number} ticket
 * @returns {{number: number, state: string, head: string}|null}
 */
function pushedPr(branch, ticket) {
  // Matched on the head ref rather than asked for by search: `#42` in a body also matches PR #942,
  // and a head qualifier's prefix semantics are GitHub's to change. `gh` lists newest first.
  const mine = (rows) =>
    rows.filter((pr) =>
      branch ? pr.headRefName === branch : new RegExp(`^agent/${ticket}-`).test(pr.headRefName ?? ""),
    );
  try {
    const rows = mine(
      JSON.parse(
        sh("gh", ["pr", "list", "--state", "all", "--limit", "100", "--json", "number,state,headRefName"]),
      ),
    );
    const pr = rows.find((p) => p.state === "OPEN") ?? rows.find((p) => p.state === "MERGED") ?? rows[0];
    // The head ref comes back too: once the worktree is gone it is the only place left that names
    // the branch, and `ciVerdict` is asked for a branch's run, not a pull request's.
    return pr ? { number: pr.number, state: pr.state, head: pr.headRefName ?? null } : null;
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
async function settle(pending, log = console.log, pause = SETTLE_PAUSE_MS, deadline = SETTLE.DEADLINE_MS) {
  const left = { ...SETTLE_ROUNDS };
  const until = Date.now() + deadline;
  // Not unref'd, for the same reason `holdFor` is not: this is the only handle open while it waits.
  const wait = () => new Promise((r) => setTimeout(r, pause));

  for (;;) {
    if (Date.now() > until) {
      return { action: "park", why: `CI did not settle in ${Math.round(deadline / 60_000)}m` };
    }
    let next;
    let asking = "retry";
    try {
      const verdict = tsx(["lib/loop/ciVerdict.ts", REPO, pending.branch, String(pending.pr)]);
      const landing = verdict.pass
        ? landingOf(tsx(["lib/loop/land.ts", REPO, String(pending.pr)]))
        : undefined;
      if (landing?.action === "recheck") asking = "recheck";
      next = afterPush({ verdict, landing });
      // Written before it is handed back, because the session that fixes it is a fresh process
      // with no way to ask this one anything.
      if (next.action === "fix" && verdict.output) {
        mkdirSync(LOG_DIR, { recursive: true });
        writeFileSync(ciLogPath(pending.ticket), verdict.output, "utf8");
      }
    } catch (err) {
      // `gh` refusing, a rate limit, or anything that is not JSON. The ticket is pushed and its
      // branch is intact, so this stalls rather than ending the night.
      return { action: "park", why: `could not read CI — ${String(err.message).split("\n")[0]}` };
    }

    if (next.action === "update-branch" && left.update > 0) {
      left.update -= 1;
      log(`  ⏳ #${pending.ticket} main moved — updating the branch and reading CI again`);
      try {
        sh("gh", ["pr", "update-branch", String(pending.pr)]);
      } catch (err) {
        return { action: "park", why: `could not update the branch — ${String(err.message).split("\n")[0]}` };
      }
      await wait();
      continue;
    }
    if (next.action === "retry-verdict" && left[asking] > 0) {
      left[asking] -= 1;
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
 * The session's own `LOOP-RESULT` first, `derive()` second. That order is the whole of the fix:
 * derive is right for *resuming* a run nobody told you about and wrong for *closing* one that just
 * told you, because every channel it reads — the worktree, its branch, its diff, its dirt — is
 * something phase F is separately instructed to delete. The two disagree only when the declaration
 * is missing, and then derive is all there is.
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
    // verdict, so it can only ever answer C, D, E or ?, and a park comment saying "phase E" of a
    // session that died in B was the record contradicting the reason printed beside it.
    phase: said?.phase ?? run.phase ?? derived?.phase ?? "?",
  };
}

/**
 * One ticket, start to finish. Serialised deliberately: the previous design ran the next ticket
 * against the last one's CI wait, which bought ~22% wall clock and cost an in-memory pending pull
 * request that nothing recovered when the process died, a worktree released out from under a live
 * `derive()`, and two sessions merging each other's work to get past a branch cut from a `main`
 * that did not have it yet.
 *
 * @param {object} io
 * @param {number|null} [pinned] a ticket a previous pass handed back unfinished
 * @returns {Promise<{outcome: "landed"|"parked"|"stalled"|"stop"|"hold"|"retry"|"refused",
 *   ticket?: number, why?: string, until?: number}>}
 */
export async function runOnce(io, pinned = null) {
  if (io.stopFile()) return { outcome: "stop", why: ".loop-stop" };
  if (!io.syncCheckout()) return { outcome: "stop", why: "the shared checkout is not usable" };
  // Exit 2 is "this machine cannot start a ticket *now*" — drift, a peer's dirt, memory. Treated
  // as a stop, the loop's own merges ended the night: the first ticket touching package-lock.json
  // merged, the next iteration pulled it in and refused to start on it, and the loop called that
  // "genuinely nothing to do".
  const pre = io.queuePre();
  if (pre === 2) return { outcome: "hold", why: "queue-pre is not ready for a ticket yet" };
  if (pre !== 0) return { outcome: "stop", why: `queue-pre exited ${pre}` };

  const route = io.pick(pinned);
  if (route.skill === "handoff") return { outcome: "stop", why: route.title };
  if (route.skill === "ambiguous") return { outcome: "stop", why: route.title };

  const run = await io.spawn(route);

  const dirtied = io.sharedCheckoutDirty?.();
  if (dirtied) io.log(`queue-loop: #${route.number}'s session left the shared checkout dirty:\n${dirtied}`);

  const after = afterSession(run, io.standing());
  const pr = io.pushedPr(after?.branch ?? null, route.number);
  // `blocked` is advisory, checked here rather than before the pull request is looked for: a
  // session refused mid-run that recovered and pushed has done its half, and reporting it refused
  // stranded the branch and left the claim on.
  if (!pr && run.blocked)
    return { outcome: "refused", ticket: route.number, until: run.blockedUntil ?? 0, run };

  const decided = outcomeOf({ pr, why: reasonFor(run, after, route.number) });
  const files = after?.changed?.length ?? 0;

  if (decided.action === "park") {
    // A park is now only ever a decision the owner has to make, which is the whole of what the
    // bell is for. Not a landing, not a retry, not a settle failure.
    io.bell();
    io.park(route.number, {
      phase: after?.phase ?? "?",
      why: decided.why,
      log: run.log,
      cwd: after?.cwd ?? null,
      branch: after?.branch ?? null,
      dirty: after?.dirty ?? false,
    });
    io.record({ number: route.number, outcome: "parked", why: decided.why, run, pr: decided.pr ?? null, files });
    return { outcome: "parked", ticket: route.number, why: decided.why };
  }

  if (decided.action === "landed") {
    io.releaseClaim(route.number);
    io.record({ number: route.number, outcome: "landed", why: decided.why, run, pr: decided.pr, merged: true, files });
    return { outcome: "landed", ticket: route.number };
  }

  const settled = await io.settle({
    ticket: route.number,
    pr: decided.pr,
    branch: after?.branch ?? pr.head,
    cwd: after?.cwd ?? null,
  });
  const cost = settleOutcome(settled);
  io.record({
    number: route.number,
    outcome: cost.recorded,
    why: settled.why,
    run,
    pr: decided.pr,
    merged: cost.recorded === "landed",
    files,
  });
  // The worktree comes with it: if the rounds run out, `main` has to hand the ticket back, and a
  // park that leaves the worktree standing is a run `derive()` resumes on the next iteration and
  // every iteration after that.
  if (cost.recorded === "retry") {
    return {
      outcome: "retry",
      ticket: route.number,
      why: settled.why,
      cwd: after?.cwd ?? null,
      branch: after?.branch ?? pr.head,
    };
  }
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
    pick: (pinned) => {
      const route = nextRoute(pinned);
      if (route.resuming) return route;
      if (before) screen.say(queueLine(before, route.queue));
      before = route.queue;
      return route;
    },
    spawn: (route) => {
      if (!route.resuming) screen.say(`  · picking — ${route.queue?.implement ?? 0} takeable`);
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
    // The merge is what mattered. A stuck label is visible on the tracker and costs one edit.
    releaseClaim: (number) => {
      try {
        sh("gh", ["issue", "edit", String(number), "--remove-label", "in-progress"]);
      } catch {
        /* nothing here is worth ending a landed ticket over */
      }
    },
    sharedCheckoutDirty: () => git("status", "--porcelain").trim(),
    log: (m) => screen.warn(m),
    record: ({ number, outcome, why, run, pr = null, merged = false, files = 0 }) => {
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
          phases: run.phases ?? {},
          result: run.result,
          // Named for what the loop actually knows. `ci: {pass:false}` was written for every
          // non-merged outcome, and read back as "CI failed" on five tickets that merged.
          merged,
          reviewRounds: facts.reviewRounds,
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
  let holds = 0;
  /** The ticket a red CI round handed back, and how many rounds it has had. */
  let pinned = null;
  let rounds = 0;
  const totals = { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 };

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

  /** Every exit writes the total. The clean stop used to print it to the screen and nowhere else. */
  const finish = (code, why) => {
    const total = runTotal(totals);
    if (why) (code === 0 ? screen.say : screen.warn)(`queue-loop: ${why} — stopping`);
    screen.say(total);
    report(`\n${total}`);
    bell();
    return code;
  };

  for (;;) {
    // Per iteration, not once per process: a run that lasts past midnight never pruned, and
    // .loop-logs was 33 MB for fifteen tickets.
    pruneLogs();

    let pass;
    try {
      pass = await runOnce(io, pinned);
    } catch (err) {
      screen.warn(`queue-loop: the iteration threw — ${String(err?.stack ?? err)}`);
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
      totals.cost += pass.run?.result?.cost ?? 0;
      totals.ms += pass.run?.ms ?? 0;
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

    waits = 0;

    // A red CI round is the same ticket again, not the next one: the picker would leave this one
    // labelled `in-progress` with an open pull request and take a different ticket, and nothing
    // would ever come back to it. Bounded, because a ticket that cannot go green is not the
    // loop's to keep paying for.
    if (pass.outcome === "retry") {
      rounds = pass.ticket === pinned ? rounds + 1 : 1;
      pinned = pass.ticket;
      if (rounds < CI_ROUNDS) {
        screen.say(`  🔁 #${pass.ticket} ${pass.why} — fix round ${rounds + 1}/${CI_ROUNDS}`);
        continue;
      }
      screen.warn(`queue-loop: #${pass.ticket} was red ${rounds} rounds running — handing it back`);
      io.bell();
      io.park(pass.ticket, {
        phase: "E",
        why: `${CI_ROUNDS} CI rounds on the same branch did not go green — last: ${pass.why}`,
        log: ciLogPath(pass.ticket),
        cwd: pass.cwd ?? null,
        branch: pass.branch ?? null,
        dirty: false,
      });
      pinned = null;
      rounds = 0;
      failures += 1;
      totals.tickets += 1;
      totals.parked += 1;
      if (shouldHalt(failures)) return finish(1, `${failures} tickets in a row did not land`);
      continue;
    }
    pinned = null;
    rounds = 0;
    totals.tickets += 1;
    if (pass.outcome === "landed") {
      failures = 0;
      totals.landed += 1;
    } else {
      failures += 1;
      totals.parked += 1;
    }
    if (shouldHalt(failures)) return finish(1, `${failures} tickets in a row did not land`);
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
