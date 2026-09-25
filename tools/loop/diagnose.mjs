// tools/loop/diagnose.mjs
/**
 * A stop the supervisor has no rule for goes to a short read-only session that finds its cause and
 * says what to do next, instead of the supervisor growing one more rule for the shape it just met.
 */
import { execFileSync, spawn as spawnChild } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..", "..");

export const DIAGNOSIS = {
  TURNS: 40,
  BUDGET_USD: "3",
  TIMEOUT_MS: 20 * 60_000,
  STDERR_CHARS: 4000,
  EVENTS: 30,
  EVENT_CHARS: 300,
  CI_LINES: 80,
  CAUSE_CHARS: 1500,
};

/** How a handoff the diagnosis asked for is told apart from one a session declared. */
export const DIAGNOSED = "diagnosis: ";

const RESUMABLE = new Set(["B", "C", "D"]);

export function diagnosisArgs() {
  return [
    "-p",
    "--permission-mode",
    "auto",
    "--strict-mcp-config",
    "--output-format",
    "json",
    "--settings",
    path.join(HERE, "loop-settings.json"),
    "--tools",
    "Read,Grep,Glob,Bash",
    "--max-turns",
    String(DIAGNOSIS.TURNS),
    "--max-budget-usd",
    DIAGNOSIS.BUDGET_USD,
    "--model",
    "sonnet",
  ];
}

const lastLines = (text, n) => text.trimEnd().split("\n").slice(-n);

const readLast = (file, n) => {
  try {
    return lastLines(fs.readFileSync(file, "utf8"), n);
  } catch {
    return [];
  }
};

/**
 * @param {{ticket: number, phase: string, why: string, stderr?: string, log?: string|null,
 *   runId?: number|null, ciLog?: string|null}} stop
 */
export function diagnosisPrompt({ ticket, phase, why, stderr = "", log = null, runId = null, ciLog = null }) {
  const events = log ? readLast(log, DIAGNOSIS.EVENTS).map((l) => l.slice(0, DIAGNOSIS.EVENT_CHARS)) : [];
  const ci = ciLog ? readLast(ciLog, DIAGNOSIS.CI_LINES) : [];
  return [
    `The queue loop stopped on ticket #${ticket} in phase ${phase}, for a reason it has no rule for: ${why}`,
    "",
    "Find the root cause. Use the evidence below, the worktree you are in, git, and gh" +
      ` (\`gh issue view ${ticket} --comments\`, \`gh run view <id> --log-failed\`).` +
      " Change nothing — no edit, commit, push, comment or rerun. The loop acts on your answer.",
    "",
    `CI run: ${runId ?? "none"}`,
    "",
    "stderr, last part:",
    "```",
    stderr.slice(-DIAGNOSIS.STDERR_CHARS).trim() || "(empty)",
    "```",
    "",
    `The session's last ${events.length} stream events${log ? ` (the whole stream is ${log})` : ""}:`,
    "```",
    ...(events.length ? events : ["(none)"]),
    "```",
    ...(ci.length ? ["", `The failed CI log, last ${ci.length} lines (${ciLog}):`, "```", ...ci, "```"] : []),
    "",
    "End your reply with exactly these two lines:",
    "DIAGNOSIS: <one of: resume B, resume C, resume D, rerun, park>",
    "CAUSE: the root cause in one paragraph, and what the next session or the owner must do",
    "",
    "- resume <phase>: the ticket's own work can fix it. A fresh session resumes there with CAUSE as its brief: B scopes, C builds, D reviews.",
    "- rerun: the failure is outside the branch — a runner, an artifact store, the network — and running the failed jobs once more will pass. Only with a CI run.",
    "- park: only a person can move it.",
  ].join("\n");
}

const DECISION = /^[#>*`\s]*DIAGNOSIS[*`]*:[*`\s]*(resume\s+([A-Za-z])\b|rerun\b|park\b)(?![^\n]*\|)/im;
const ECHOED = /^[#>*`\s]*DIAGNOSIS[^\n]*[|<]/im;
const CAUSE = /^[#>*`\s]*CAUSE[*`]*:[*`]*[ \t]*\n?(.+(?:\n(?![#>*`\s]*DIAGNOSIS)(?!\s*$).+)*)/im;

/**
 * @param {string|null|undefined} text the session's final reply
 * @param {number|null} runId
 * @returns {{ok: true, action: "resume"|"rerun"|"park", phase?: string, cause: string}|{ok: false, error: string}}
 */
export function parseDiagnosis(text, runId = null) {
  const t = text ?? "";
  const decision = DECISION.exec(t);
  if (!decision)
    return { ok: false, error: ECHOED.test(t) ? "it copied the options line instead of choosing one" : "it gave no DIAGNOSIS line" };
  const cause = CAUSE.exec(t)?.[1].replace(/`{3,}/g, "").replace(/\s+/g, " ").trim().slice(0, DIAGNOSIS.CAUSE_CHARS);
  if (!cause) return { ok: false, error: "it gave no CAUSE line" };
  if (decision[2]) {
    const phase = decision[2].toUpperCase();
    return RESUMABLE.has(phase)
      ? { ok: true, action: "resume", phase, cause }
      : { ok: false, error: `it asked to resume at ${phase}, which no session resumes at` };
  }
  const action = /** @type {"rerun"|"park"} */ (decision[1].toLowerCase());
  if (action === "rerun" && !runId) return { ok: false, error: "it asked for a rerun with no CI run to rerun" };
  return { ok: true, action, cause };
}

/** HEAD and the tree's status together, so a diagnosis that wrote anything is caught either way. */
export function treeState(cwd, run = (args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" })) {
  try {
    return `${run(["rev-parse", "HEAD"]).trim()}\n${run(["status", "--porcelain"])}`;
  } catch (err) {
    return `unreadable: ${String(err.message).split("\n")[0]}`;
  }
}

/**
 * @param {{ticket: number, phase: string, why: string, cwd?: string|null, log?: string|null,
 *   stderr?: string, runId?: number|null, ciLog?: string|null}} stop
 * @returns {Promise<({ok: true, action: string, phase?: string, cause: string}|{ok: false, error: string})
 *   & {reply?: string, run: {result: {cost: number, turns: number}|null, ms: number, log: string|null, phases: {}}}>}
 */
export function diagnose(stop, { spawnFn = spawnChild, state = treeState, timeoutMs = DIAGNOSIS.TIMEOUT_MS } = {}) {
  const cwd = stop.cwd ?? ROOT;
  const before = state(cwd);
  const startedAt = Date.now();
  const run = { result: null, ms: 0, log: stop.log ?? null, phases: {} };
  return new Promise((resolve) => {
    let settled = false;
    const done = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.ms = Date.now() - startedAt;
      resolve({ ...answer, run });
    };
    const child = spawnFn("claude", diagnosisArgs(), {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      // Not a queue session: with `LOOP_TURNS` set, CLAUDE.md sends it to resume the ticket.
      env: {
        ...process.env,
        DISABLE_AUTOUPDATER: "1",
        CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
        LOOP_TURNS: undefined,
        LOOP_PHASE: undefined,
        LOOP_REASON: undefined,
      },
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      done({ ok: false, error: `it ran past ${Math.round(timeoutMs / 60_000)}m` });
    }, timeoutMs);
    timer.unref?.();
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr?.on("data", () => {});
    child.on("error", (err) => done({ ok: false, error: `it could not start — ${err.message}` }));
    child.on("close", (status) => {
      let json;
      try {
        json = JSON.parse(out);
      } catch {
        return done({ ok: false, error: `it exited ${status} with no result` });
      }
      run.result = { cost: json.total_cost_usd ?? 0, turns: json.num_turns ?? 0 };
      if (state(cwd) !== before) return done({ ok: false, error: "it changed the worktree it was only to read" });
      if (json.is_error) return done({ ok: false, error: `it ended ${json.subtype ?? "in an error"}` });
      done({ ...parseDiagnosis(json.result, stop.runId ?? null), reply: String(json.result ?? "") });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(diagnosisPrompt(stop));
  });
}
