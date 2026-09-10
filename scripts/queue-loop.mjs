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
import { PHASES, closing, header, phaseLine, reportRow, runTotal } from "./loop-render.mjs";
import { row } from "./loop-record.mjs";

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

/** One bad ticket is a ticket. Three in a row is the loop or the machine, and a night proving it. */
export const BREAKER = 3;
export const shouldHalt = (consecutiveFailures) => consecutiveFailures >= BREAKER;

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
    files: 0,
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
      if (call.name === "Bash" && REDERIVE.test(call.command)) {
        const d = derive();
        next = advance(next, d.phase);
        // The count as of the last commit: after the ticket lands, its worktree is gone and there
        // is nothing left to count.
        state.files = d.changed?.length ?? state.files;
      }
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
        files: state.files,
        version: state.version,
        ms: Date.now() - startedAt,
        log: logPath,
      }));
    });
  });
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

const STOP_FILE = ".loop-stop";

/**
 * Written as each ticket ends rather than at exit, so a crash or a closed terminal keeps whatever
 * the night had already done.
 */
function record(entry, line) {
  mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOG_DIR, "tickets.jsonl"), `${JSON.stringify(entry)}
`, "utf8");
  const report = path.join(LOG_DIR, `run-${new Date().toISOString().slice(0, 10)}.md`);
  if (!fs.existsSync(report)) {
    fs.writeFileSync(report, `# queue-loop ${new Date().toISOString().slice(0, 10)}

`, "utf8");
  }
  fs.appendFileSync(report, `${line}
`, "utf8");
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

/** Where the ticket stood when its session exited — what the progress guard compares against. */
const standing = () => {
  const s = derive();
  return s.onTicket
    ? { ticket: s.ticket, head: s.head ?? null, commits: s.commits ?? 0, cwd: s.cwd, branch: s.branch, dirty: s.dirty, phase: s.phase }
    : null;
};

async function main() {
  let prev = null;
  let failures = 0;
  const totals = { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 };

  pruneLogs();

  for (;;) {
    if (takeStopFile(fs, STOP_FILE)) {
      console.log("queue-loop: .loop-stop — draining, nothing new will be started");
      return 0;
    }
    if (!syncProtocol(git, (m) => console.error(m))) return 1;

    const pre = spawnSync(process.execPath, ["scripts/queue-pre.mjs"], { stdio: "inherit" });
    if (pre.status !== 0) return pre.status ?? 1;

    const route = nextRoute();
    if (shouldStop(route)) {
      console.log(`queue-loop: ${route.title} — stopping`);
      return 0;
    }

    const run = await runTicket(spawn, { number: route.number, queue: route.queue });
    const after = standing();
    totals.tickets += 1;
    totals.cost += run.result?.cost ?? 0;
    totals.ms += run.ms;

    // A ticket still live after its session exited did not land, whatever the exit code said.
    const landed = !after || after.ticket !== route.number;
    const stuck = after && !madeProgress(prev, after);
    const why = stuck
      ? "resumed with nothing committed since the last run"
      : run.status === "stalled"
        ? `no output for ${Math.round(STALL_MS / 60_000)}m in phase ${run.phase ?? "?"}`
        : run.status !== 0
          ? `the session exited ${run.status} in phase ${run.phase ?? "?"}`
          : null;

    if (landed && !why) {
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
        })
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
        })
      );
    }

    const facts = ticketFacts(route.number);
    record(
      row({
        number: route.number,
        size: facts.size,
        outcome: landed && !why ? "landed" : "parked",
        pr: null,
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
        outcome: landed && !why ? "landed" : "parked",
        pr: null,
        ms: run.ms,
        cost: run.result?.cost ?? 0,
        why: why ?? undefined,
      })
    );

    prev = after;
    if (shouldHalt(failures)) {
      console.error(`queue-loop: ${failures} tickets in a row did not land — stopping`);
      const total = runTotal(totals);
      console.log(total);
      fs.appendFileSync(path.join(LOG_DIR, `run-${new Date().toISOString().slice(0, 10)}.md`), `
${total}
`, "utf8");
      return 1;
    }
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  main().then((code) => process.exit(code));
}
