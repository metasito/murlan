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
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { derive } from "./loop-derive.mjs";
import { readLine, phaseOf, REDERIVE } from "./loop-stream.mjs";
import { PHASES, closing, header, phaseLine } from "./loop-render.mjs";

const LOG_DIR = ".loop-logs";

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
  const read = (name) => Number(/:(\d+)/.exec(line?.split("\t").find((f) => f.startsWith(name)) ?? "")?.[1] ?? 0);
  return { implement: read("implement"), triage: read("triage"), wayfinder: read("wayfinder") };
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
    resuming: true,
  };
}

function nextRoute() {
  // Checked here, not just left to queue.md's own phase A: without this, the log below claims
  // "starting #N" for whatever the picker happens to return, even while a different ticket is
  // genuinely mid-build in a worktree — misleading regardless of what the spawned session goes
  // on to correctly resume.
  const live = liveRoute(derive());
  if (live) return { ...live, queue: { implement: 0, triage: 0, wayfinder: 0 } };
  const stdout = execFileSync("node", ["scripts/next-ticket.mjs"], { encoding: "utf8" });
  return { ...parseRoute(stdout), queue: parseStatus(stdout), resuming: false };
}

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
  const drift = () => git("diff", "--name-only", "origin/main", "--", ...PROTOCOL).trim();
  git("fetch", "origin", "--quiet");
  if (!drift()) return true;

  log(`queue-loop: protocol differs from origin/main (${drift().split("\n").join(", ")})`);
  try {
    git("checkout", "main");
    git("merge", "--ff-only", "origin/main");
  } catch (err) {
    log(`queue-loop: cannot restore main — ${String(err.message).trim()}`);
    return false;
  }
  if (drift()) {
    log("queue-loop: still differs after moving to main — main itself is ahead of origin");
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

const sh = (file, args, opts) =>
  execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

/**
 * Hands a ticket back to the owner: the work committed, the claim released, the reason on the
 * issue, the worktree gone. Any step throwing stops the loop rather than leaving a ticket in a
 * state nobody can name.
 *
 * @param {number} number
 * @param {{phase: string, why: string, log: string, cwd: string, branch: string|null,
 *   dirty: boolean, run?: Function, write?: Function}} ctx
 */
export function park(number, { phase, why, log, cwd, branch, dirty, run = sh, write = writeFileSync }) {
  if (dirty) {
    // `-A` is safe here and nowhere else: this is the ticket's own worktree, which has its own
    // index, and rule 40 keeps every other session out of it. Rule 11's hazard is the shared
    // checkout. Losing an unstaged edit is the one thing parking must not do.
    run("git", ["-C", cwd, "add", "-A", "--", "."]);
    run("git", ["-C", cwd, "commit", "-m", `wip(#${number}): parked in phase ${phase}`]);
  }

  run("gh", [
    "issue", "edit", String(number),
    "--remove-label", "in-progress",
    "--add-label", "ready-for-human",
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

  run("npm", ["run", "worktrees:remove", "--", cwd]);
}

/** One ticket's worth of the issue, for the header. Covers the resume path, which has no picker. */
function ticketFacts(number) {
  try {
    const raw = execFileSync("gh", ["issue", "view", String(number), "--json", "title,labels,url"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const issue = JSON.parse(raw);
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
 * Spawns one session and draws its board from the stream.
 *
 * `spawnFn` is a parameter so a test can drive fixture lines through the whole path without a
 * `claude` binary. stderr stays inherited: a crash should still print itself rather than being
 * reassembled from a log nobody is watching.
 */
export function runTicket(spawnFn, { number, queue, log = console.log, facts = ticketFacts, stallMs = STALL_MS, tick = 30_000 }) {
  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `${number}.jsonl`);
  const sink = createWriteStream(logPath, { flags: "a" });
  const startedAt = Date.now();

  const state = {
    phase: null,
    printedHeader: false,
    result: null,
    version: null,
    phases: {},
    lastFactAt: Date.now(),
    stalled: false,
  };

  const closePhase = (letter, detail) => {
    state.phases[letter] = Math.round((Date.now() - startedAt) / 1000);
    log(phaseLine({ letter, detail, ms: Date.now() - startedAt }));
  };

  const child = spawnFn("claude", queueLoopArgs(), { stdio: ["ignore", "pipe", "inherit"] });

  createInterface({ input: child.stdout }).on("line", (line) => {
    sink.write(`${line}\n`);
    state.lastFactAt = Date.now();
    const fact = readLine(line);
    if (!fact) return;

    if (fact.kind === "init") state.version = fact.version;
    if (fact.kind === "result") state.result = fact;
    if (fact.kind === "rate_limit") {
      log(closing({ outcome: "rate_limited", number, why: `resets ${fact.resetsAt ?? "unknown"}`, ms: 0, cost: 0 }));
    }
    if (fact.kind !== "tool") return;

    for (const call of fact.calls) {
      // A subagent's own tool calls are phase B's work, not the session's progress through it.
      if (call.parent) continue;
      const before = state.phase;
      let next = advance(state.phase, phaseOf(call));
      if (call.name === "Bash" && REDERIVE.test(call.command)) next = advance(next, derive().phase);
      state.phase = next;
      if (next === before) continue;

      if (!state.printedHeader) {
        log(header({ number, ...facts(number), queue }));
        state.printedHeader = true;
      }
      closePhase(next, "");
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
      // Resolved on the sink's own finish, not on the child's close: `end()` only asks, and a
      // caller reading the log it was just handed would otherwise find it short.
      sink.end(() => resolve({
        status: state.stalled ? "stalled" : (status ?? 1),
        result: state.result,
        phase: state.phase,
        phases: state.phases,
        version: state.version,
        ms: Date.now() - startedAt,
        log: logPath,
      }));
    });
  });
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

async function main() {
  for (;;) {
    if (!syncProtocol(git, (m) => console.error(m))) return 1;
    const route = nextRoute();
    if (shouldStop(route)) {
      console.log(`queue-loop: ${route.title} — stopping`);
      return 0;
    }
    console.log(
      route.resuming
        ? `queue-loop: resuming #${route.number} — a run was already mid-build`
        : `queue-loop: picking up #${route.number} (${route.skill})`
    );

    const run = await runTicket(spawn, { number: route.number, queue: route.queue });
    if (run.status !== 0) {
      console.error(
        `queue-loop: claude -p exited ${run.status}, stopping rather than looping on a broken run`
      );
      return run.status;
    }
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  main().then((code) => process.exit(code));
}
