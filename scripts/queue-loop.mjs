// scripts/queue-loop.mjs
/**
 * The loop that never stops. `.claude/commands/queue.md` runs one ticket per process and exits;
 * this is what starts the next one, in a clean process, so no ticket's context reaches the next.
 *
 * No iteration cap and no context budget: there is nothing here for a budget to protect, since
 * nothing survives past one `claude -p` call. The only stop condition is the tracker itself
 * reporting nothing takeable (`ROUTE handoff`), same halt `queue.md` already defines for a
 * by-hand run.
 *
 * Usage: node scripts/queue-loop.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { derive } from "./loop-derive.mjs";

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
  if (live) return live;
  const stdout = execFileSync("node", ["scripts/next-ticket.mjs"], { encoding: "utf8" });
  return { ...parseRoute(stdout), resuming: false };
}

export function queueLoopArgs() {
  return ["-p", "/queue", "--permission-mode", "auto", "--strict-mcp-config"];
}

/**
 * Read from this working tree, not from the ticket's worktree: the session's instructions, and
 * the scripts the loop shells out to by relative path. A stale copy of any of them is a different
 * protocol. This file is in that set and cannot guard its own staleness — a loop started from an
 * old checkout runs an old guard, which is why the repair below is worth having at every
 * iteration rather than once at startup.
 */
const PROTOCOL = ["CLAUDE.md", ".claude", "scripts"];

/**
 * The spawned session reads `PROTOCOL` from the shared checkout, not from `origin/main`. Left on
 * a ticket branch — which rule 8 forbids and which happened anyway — it runs whatever protocol
 * that branch froze, silently and green.
 *
 * Drift is repaired rather than reported: `git checkout` is the authority on whether that would
 * lose anything, so a refusal is the stop condition and nothing here second-guesses it. An agent
 * branch keeps its commits either way — only HEAD moves.
 *
 * @returns {boolean} false when the checkout could not be made to match `origin/main`.
 */
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
  // A repair that did not repair must not report success.
  if (drift()) {
    log("queue-loop: still differs after moving to main — main itself is ahead of origin");
    return false;
  }
  log("queue-loop: checkout moved back to main");
  return true;
}

function runOneTicket() {
  // NOT YET VERIFIED against /queue itself — that would claim a real ticket as a side effect, so
  // it needs a deliberate go-ahead rather than running as part of building this script. What IS
  // confirmed: this exact spawnSync mechanism correctly expands a harmless command
  // (`claude -p "/ponytail-help"`) in headless mode, so command expansion itself works; whether
  // /queue's phase text specifically appears (rather than a literal echo) is still open.
  //
  // Testing by hand from Git Bash needs `MSYS_NO_PATHCONV=1` — MSYS rewrites a bare leading
  // `/word` into a Windows path (`/help` -> `C:/Program Files/Git/help`) before `claude` ever sees
  // it. spawnSync here goes straight to CreateProcess, not through that shell layer, so it is
  // unaffected — only manual bash testing needs the env var.
  const result = spawnSync("claude", queueLoopArgs(), { stdio: "inherit" });
  return result.status ?? 1;
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

function main() {
  for (;;) {
    if (!syncProtocol(git, (m) => console.error(m))) return 1;
    const route = nextRoute();
    if (shouldStop(route)) {
      console.log(`queue-loop: ${route.title} — stopping`);
      return 0;
    }
    console.log(
      route.resuming
        ? `queue-loop: resuming #${route.number} (${route.title}) — a run was already mid-build`
        : `queue-loop: starting #${route.number} ${route.title} (${route.skill})`
    );
    const status = runOneTicket();
    if (status !== 0) {
      console.error(`queue-loop: claude -p exited ${status}, stopping rather than looping on a broken run`);
      return status;
    }
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  process.exit(main());
}
