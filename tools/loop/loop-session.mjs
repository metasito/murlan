/**
 * The one place a `claude` session is spawned: its stream goes to the log sink and through
 * `reduceSession`, and the watchdog kills one that goes silent. What the state means is the
 * caller's, through `onState`.
 */
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { BASH_DEFAULT_TIMEOUT_MS, CHECK_BASH_TIMEOUT_MS, SESSION_POLICY, STALL_MS, sleepClock } from "./limits.mjs";
import { closePhase, readLine, reduceSession, sessionStart } from "./loop-stream.mjs";
import { spawnEnv } from "./session-env.mjs";
import { estimateCost } from "./loop-cost.mjs";
import { DIR, streamLog } from "./loop-logs.mjs";
import { ticker } from "./loop-screen.mjs";
import { ROOT } from "./paths.mjs";
import { openTicket, roundOf, sessionView, ticketFacts } from "./loop-board.mjs";

const { CONTEXT_BY_SIZE, CONTEXT_DEFAULT, EFFORT_BY_PHASE, MODEL_BY_PHASE, TICKET_BUDGET_USD, TURNS_BY_SIZE, TURNS_DEFAULT } = SESSION_POLICY;
const HERE = import.meta.dirname;

/**
 * @param {string[]} argv
 * @param {{spawnFn?: Function, env?: object, log: string, at?: string|null, planned: string,
 *   onState?: (state: object, effects: object[]) => void, onStderr?: (chunk: string) => void,
 *   stallMs?: number, tick?: number, killGraceMs?: number}} opts
 */
export function runSession(
  argv,
  {
    spawnFn = spawn,
    env = process.env,
    log,
    at = null,
    planned,
    onState = () => {},
    onStderr = () => {},
    stallMs = STALL_MS,
    tick = 30_000,
    killGraceMs = 10_000,
  },
) {
  mkdirSync(path.dirname(log), { recursive: true });
  const sink = createWriteStream(log, { flags: "a" });
  const startedAt = Date.now();
  let state = sessionStart(at, startedAt);
  let heardAt = startedAt;
  let asleepMs = 0;
  let stalled = false;
  let stderr = "";

  const child = spawnFn("claude", argv, { stdio: ["ignore", "pipe", "pipe"], env });

  // A spawn failure (ENOENT) emits `error` and then `close`; unhandled, it takes the supervisor down.
  child.on("error", (e) => {
    stderr += `${e.message}\n`;
    onStderr(`${e.message}\n`);
  });

  // Mirrored, not swallowed: a crash must still print itself.
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
    onStderr(String(chunk));
  });

  createInterface({ input: child.stdout }).on("line", (line) => {
    sink.write(`${line}\n`);
    heardAt = Date.now();
    const next = reduceSession(state, line, { now: heardAt, at, planned });
    state = next.state;
    if (next.effects.some((e) => e.kind === "kill")) {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), killGraceMs).unref();
    }
    onState(state, next.effects);
  });

  return new Promise((resolve) => {
    // SIGTERM, not SIGINT: the docs give SIGTERM as the one that terminates the process tree of a
    // still-running Bash command and then runs SessionEnd, which is what a wedged session needs.
    // SIGINT only ends the turn, and a session with nothing to end ignores it.
    const clock = sleepClock(tick);
    /** @type {NodeJS.Timeout | undefined} */
    let grace;
    const watchdog = setInterval(() => {
      const slept = clock.lap();
      const now = Date.now();
      asleepMs += slept;
      heardAt = Math.min(now, heardAt + slept);
      if (now - heardAt <= stallMs) return;
      stalled = true;
      clearInterval(watchdog);
      // Windows' SIGTERM takes `claude.exe` alone, and a grandchild left holding its stdout keeps
      // `close` from ever firing. So the tree, then a deadline.
      if (process.platform === "win32" && child.pid) {
        try {
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } catch {
          /* already gone */
        }
      } else child.kill("SIGTERM");
      grace = setTimeout(() => {
        child.kill("SIGKILL");
        child.stdout.destroy();
        child.stderr.destroy();
        finish(null);
      }, killGraceMs);
    }, tick);

    let finished = false;
    child.on("close", (status) => finish(status));
    function finish(status) {
      if (finished) return;
      finished = true;
      clearInterval(watchdog);
      clearTimeout(grace);
      // The session emits no marker for a phase it did not finish.
      state = closePhase(state, Date.now());
      // Resolved on the sink's own finish, not on the child's close: `end()` only asks, and a
      // caller reading the log it was just handed would otherwise find it short.
      sink.end(() =>
        resolve({
          status: stalled ? "stalled" : (status ?? 1),
          state,
          stderr,
          started: new Date(startedAt).toISOString(),
          ms: Date.now() - startedAt,
          asleepMs,
        }),
      );
    }
  });
}

/** @param {string|null} [size] a `size:*` label, or null */
export const turnsFor = (size) => TURNS_BY_SIZE[size ?? ""] ?? TURNS_DEFAULT;

/** @param {string|null} [size] a `size:*` label, or null */
export const contextFor = (size) => CONTEXT_BY_SIZE[size ?? ""] ?? CONTEXT_DEFAULT;

/** @param {string|null} [phase] */
export const plannedModel = (phase) => MODEL_BY_PHASE[phase ?? "A"] ?? MODEL_BY_PHASE.A;

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
const RESULT_SCHEMA = JSON.stringify(JSON.parse(readFileSync(path.join(HERE, "result-schema.json"), "utf8")));

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
    allowedTools(readFileSync(path.join(ROOT, ".claude/commands/queue.md"), "utf8")).join(","),
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
