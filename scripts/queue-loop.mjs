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

function nextRoute() {
  const stdout = execFileSync("node", ["scripts/next-ticket.mjs"], { encoding: "utf8" });
  return parseRoute(stdout);
}

export function queueLoopArgs() {
  return ["-p", "/queue", "--permission-mode", "auto", "--strict-mcp-config"];
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

function main() {
  for (;;) {
    const route = nextRoute();
    if (shouldStop(route)) {
      console.log(`queue-loop: ${route.title} — stopping`);
      return 0;
    }
    console.log(`queue-loop: starting #${route.number} ${route.title} (${route.skill})`);
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
