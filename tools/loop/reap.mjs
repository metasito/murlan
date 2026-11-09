/**
 * Clears what a killed run leaves behind: the e2e server still holding its port, and node
 * processes belonging to sessions that have exited.
 *
 * Usage: node tools/loop/reap.mjs [--dry-run] [--stale]
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { killTree } from "../../scripts/lib/proc.mjs";
import { ownerOf } from "../ci/e2eOwner.mjs";
import { checkoutRoot } from "./cli.mjs";

const ORPHAN_AGE_MS = 2 * 60 * 60 * 1000;
const STALE_AGE_MS = 24 * 60 * 60 * 1000;

/** What `ownedByTooling` matches a command line against, so an answer one directory out silently classifies nothing as ours. */
export { checkoutRoot } from "./cli.mjs";

/**
 * Where this repo's tooling runs from. Playwright is the reason this is a list rather than the
 * checkout: it keeps its browsers under `ms-playwright` in the user's profile, so a rule that knew
 * only the repo would leave behind the one process class that costs hundreds of megabytes.
 */
export function toolingRoots({ repoRoot, env = process.env, platform = process.platform, home = os.homedir() }) {
  const browsers =
    env.PLAYWRIGHT_BROWSERS_PATH ||
    (platform === "win32"
      ? `${env.LOCALAPPDATA}/ms-playwright`
      : platform === "darwin"
        ? `${home}/Library/Caches/ms-playwright`
        : `${home}/.cache/ms-playwright`);
  return [repoRoot, browsers].filter(Boolean).map((r) => normalizePath(r, platform));
}

function normalizePath(value, platform = process.platform) {
  const slashed = String(value).replace(/\//g, "\\");
  return platform === "win32" ? slashed.toLowerCase() : slashed;
}

/**
 * Matching by process name instead would be indefensible: `chrome.exe` is as likely to be the
 * owner's own browser, and `python.exe` and `msedgewebview2.exe` on this machine belong to an
 * unrelated agent and to Windows. A command line naming a root below is the only thing that
 * distinguishes ours from theirs, so a command line that could not be read claims nothing.
 *
 * A session host is the one thing that satisfies that rule without being ours, so the rule
 * cannot state the exception itself: see `isSessionHost`.
 */
export function ownedByTooling(commandLine, roots, platform = process.platform) {
  if (!commandLine) return false;
  if (isSessionHost(commandLine, { platform })) return false;
  const haystack = normalizePath(commandLine, platform);
  return roots.some((root) => haystack.includes(root));
}

/**
 * A dead parent alone is not enough. Every process a shell starts is briefly parentless while its
 * launcher exits, so without the age floor the reaper's first casualty is the suite that called it.
 *
 * An age that could not be read is not an old one. Left as 0 it reads as 1970, which clears the
 * floor by half a century and turns the guard into the thing it exists to prevent.
 */
export function orphans(processes, { livePids, minAgeMs, now, keep }) {
  return staleByAge(processes, { maxAgeMs: minAgeMs, now, keep }).filter((p) => !livePids.has(p.ppid));
}

/**
 * A crashed session leaves its whole tree resident — the node process, the bash that launched it,
 * the cmd above that — so its parent is alive and `orphans` cannot see it. Age is the only signal
 * left, and not a safe one alone: a live session's node is also long-running. Hence `--stale`
 * rather than the default.
 */
export function staleByAge(processes, { maxAgeMs, now, keep }) {
  return processes.filter(
    (p) =>
      Number.isFinite(p.startedAt) && p.startedAt > 0 && !keep.has(p.pid) && now - p.startedAt >= maxAgeMs
  );
}

/** The output, or null when the tool could not run at all. A tool that ran and exited non-zero (lsof does, for "nothing found") still answered. */
function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (err) {
    return typeof err.status === "number" ? String(err.stdout ?? "") : null;
  }
}

/** docs/agents/checks.md's shell contract. */
const POWERSHELL = "pwsh";

/**
 * `-Compress` emits no whitespace of its own, so a raw byte below 0x20 arriving here is never
 * JSON structure — it is a character of somebody's command line that the serializer let through
 * unescaped, and `JSON.parse` rejects the whole table over it. Dropping it costs one character of
 * one command line, which every rule below matches on as a substring.
 */
const RAW_CONTROL_BYTE = /[\x00-\x1f]/g;

export function parseWindowsProcessJson(json) {
  if (!json.trim()) return [];
  const rows = JSON.parse(json.replace(RAW_CONTROL_BYTE, ""));
  return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
    pid: r.ProcessId,
    ppid: r.ParentProcessId,
    name: String(r.Name ?? ""),
    commandLine: r.CommandLine ?? "",
    startedAt: Number(r.Started ?? 0),
  }));
}

/**
 * `parseWindowsProcessJson`, but a PowerShell that did not answer as one degrades this one sweep
 * instead of crashing every unattended run after it. `blind` says why it saw nothing, since an
 * empty table otherwise reads as a machine with nothing to take.
 */
export function readProcessTable(json, exeName) {
  if (!json.trim()) return { rows: [], blind: `${exeName} gave no process table (missing, or it failed), so this sweep takes nothing` };
  try {
    return { rows: parseWindowsProcessJson(json), blind: null };
  } catch (err) {
    return { rows: [], blind: `${exeName} did not answer as PowerShell, so this sweep takes nothing: ${err.message}` };
  }
}

/** Every process on the box, so a candidate's parent can be looked up rather than assumed dead. */
export function processTable() {
  if (process.platform === "win32") {
    const json = sh(POWERSHELL, [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine," +
        "@{n='Started';e={[int64][datetimeoffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}} " +
        "| ConvertTo-Json -Compress",
    ]);
    return readProcessTable(json ?? "", POWERSHELL);
  }
  const now = Date.now();
  const rows = (sh("ps", ["-eo", "pid=,ppid=,etimes=,args="]) ?? "")
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, etimes, args]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      name: args.split(/\s+/)[0] ?? "",
      commandLine: args,
      startedAt: now - Number(etimes) * 1000,
    }));
  return { rows, blind: rows.length ? null : "ps gave no process table, so this sweep takes nothing" };
}

/** This process and everything that launched it, so the reaper cannot kill its own caller. */
function ancestry(table, pid) {
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const keep = new Set();
  for (let cur = pid; cur && !keep.has(cur); cur = byPid.get(cur)?.ppid) keep.add(cur);
  return keep;
}

/**
 * Whether ending `pid` would end `selfPid` with it — `pid` and everything below it, which on
 * Windows is exactly what `taskkill /T` takes.
 *
 * The guard that holds when the process table does not. `ancestry` walks parent links upward
 * and stops at the first pid the snapshot is missing; above a terminal that pid is the
 * launcher, which has always already exited, and any of the links below it may exit during
 * the walk. Everything above the gap then silently stops being protected. Reading the tree that
 * is about to be terminated cannot be fooled the same way: the reaper is inside it or it is not.
 */
export function wouldTakeSelf(table, pid, selfPid) {
  // A table that cannot see the reaper cannot see its tree either: no answer is a refusal.
  if (!table.some((p) => p.pid === selfPid)) return true;
  const children = new Map();
  for (const p of table) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p.pid);
  }
  const seen = new Set([pid]);
  for (const cur of seen) for (const kid of children.get(cur) ?? []) seen.add(kid);
  return seen.has(selfPid);
}

/**
 * Where a session is hosted rather than where its work runs: the terminal window, the console
 * host, the shell inside them.
 *
 * `ownedByTooling` reads the whole command line, and a terminal's carries the directory it was
 * opened in — `WindowsTerminal.exe -d C:\Users\roton\murlan` names this repo exactly as loudly
 * as a jest worker does. Where a process was *started* is not what it is running, and every
 * process of the session sits inside the window's tree.
 *
 * Stated for Windows alone because that is where a session has a process for its window. A
 * POSIX terminal emulator is not in the repo's tree at all, so no rule here can reach it.
 */
export function isSessionHost(commandLine, { platform = process.platform, systemRoot } = {}) {
  if (!commandLine || platform !== "win32") return false;
  const where = normalizePath(commandLine, platform);
  return [systemRoot || process.env.SystemRoot || "C:/Windows", "C:/Program Files/WindowsApps"].some(
    (root) => where.includes(normalizePath(root, platform))
  );
}

/** @returns {string | null} why the kill was refused for want of a table, else null */
function killPid(pid, dryRun, say = console.log, readTable = processTable) {
  if (dryRun) return null;
  // Re-read rather than trust the caller's snapshot: the tree is what `/T` acts on, and a
  // process that joined it since the sweep began is as fatal as one that was always there.
  const { rows } = readTable();
  if (!rows.some((p) => p.pid === process.pid)) {
    const why = `refused to kill pid ${pid} — no process table shows this reaper, so its tree cannot be checked`;
    say(`reap: ${why}`);
    return why;
  }
  if (wouldTakeSelf(rows, pid, process.pid)) {
    say(`reap: refused to kill pid ${pid} — this session is inside its process tree`);
    return null;
  }
  try {
    killTree(pid);
  } catch (err) {
    const why = `could not kill pid ${pid} — ${err.message}`;
    say(`reap: ${why}`);
    return why;
  }
  return null;
}

/** Every listening socket as `{ pid, port }`: an e2e server binds `PORT=0`, so the port is read off the socket, never assumed. */
export function netstatSockets(text) {
  return text
    .split("\n")
    .filter((l) => /LISTENING/.test(l))
    .map((l) => {
      const cols = l.trim().split(/\s+/);
      return { pid: Number(cols.at(-1)), port: Number(cols[1]?.match(/:(\d+)$/)?.[1]) };
    })
    .filter((s) => s.pid && s.port);
}

export function lsofSockets(text) {
  const sockets = [];
  let pid = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n")) {
      const port = Number(line.match(/:(\d+)$/)?.[1]);
      if (pid && port) sockets.push({ pid, port });
    }
  }
  return sockets;
}

/**
 * What is listening, read once for every class below. A tool that could not run is `blind`, not
 * an empty machine: an empty answer would let the sweep take a dev server it could not see
 * holding a port, and report it clean.
 */
export function readListeners({ platform = process.platform } = {}) {
  const win = platform === "win32";
  const tool = win ? "netstat" : "lsof";
  const out = win ? sh("netstat", ["-ano"]) : sh("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]);
  if (out === null) return { sockets: [], blind: `${tool} could not run (missing, or it failed), so this sweep cannot see what is listening and takes nothing` };
  return { sockets: win ? netstatSockets(out) : lsofSockets(out), blind: null };
}

/**
 * Whether the run that started `server` is still there. A pid the table does not hold is gone; one
 * it holds under another program, or that started after the server did, is a different process
 * that was handed the number since. A run whose command line or start could not be read is not
 * shown to be dead.
 */
function runIsAlive(owner, server) {
  if (!owner) return false;
  if (owner.commandLine && !/e2e-server\.mjs/.test(owner.commandLine)) return false;
  return !(owner.startedAt > server.startedAt + 1000);
}

/**
 * The e2e servers a dead run left listening. `scripts/e2e-server.mjs` starts its server with its
 * own pid as an argument (`tools/ci/e2eOwner.mjs`), so a server is a leftover only when it names a
 * run and that run is gone. Parentage cannot say so: an orphan is reparented to pid 1, which is
 * alive. A listener without the argument, a dev server or `npm run play`, is nobody's leftover.
 */
export function staleE2eServers(sockets, table, ours) {
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const seen = new Set();
  return sockets.filter(({ pid }) => {
    const server = byPid.get(pid);
    if (!server || seen.has(pid) || !ours.includes(server)) return false;
    const owner = ownerOf(server.commandLine);
    if (owner === null || runIsAlive(byPid.get(owner), server)) return false;
    seen.add(pid);
    return true;
  });
}

/**
 * One sweep, said a line at a time through `say`. `took` is how many it named to take; a server
 * whose run is alive is somebody else working, not a leftover, so it is not counted. `blind` is why
 * it could not see the processes or the listeners, or null.
 */
export async function reap({ dryRun = false, stale: takeStale = false, say = console.log, readTable = processTable, listeners = readListeners } = {}) {
  const verb = dryRun ? "would clear" : "cleared";
  const now = Date.now();
  const { rows: table, blind } = readTable();
  if (blind) say(`reap: ${blind}`);
  const { sockets, blind: listenBlind } = listeners();
  if (listenBlind) {
    say(`reap: ${listenBlind}`);
    return { took: 0, blind: blind ?? listenBlind };
  }
  let refused = null;
  const kill = (pid) => {
    refused = killPid(pid, dryRun, say, readTable) ?? refused;
  };
  const roots = toolingRoots({ repoRoot: checkoutRoot(), home: os.homedir() });
  const ours = table.filter((p) => ownedByTooling(p.commandLine, roots));
  const keep = ancestry(table, process.pid);
  for (const { pid } of sockets) keep.add(pid);
  const hoursOf = (p) => ((now - p.startedAt) / 3_600_000).toFixed(1);
  const labelOf = (p) => `${p.name || "process"} pid ${p.pid}`;

  const byPid = new Map(table.map((p) => [p.pid, p]));
  const staleServers = staleE2eServers(sockets.filter((s) => s.pid !== process.pid), table, ours);
  for (const { pid, port } of staleServers) {
    say(`reap: ${verb} the e2e server on port ${port}, ${labelOf(byPid.get(pid))}`);
    kill(pid);
  }
  if (!staleServers.length) say("reap: no e2e server left listening without its run");

  const parentless = orphans(ours, {
    livePids: new Set(table.map((p) => p.pid)),
    minAgeMs: ORPHAN_AGE_MS,
    now,
    keep,
  });
  for (const p of parentless) {
    say(`reap: ${dryRun ? "would kill" : "killed"} ${labelOf(p)}, ${hoursOf(p)}h old, parent ${p.ppid} is gone`);
    kill(p.pid);
  }
  if (!parentless.length) say("reap: nothing of ours lost its parent");

  const stale = staleByAge(ours, { maxAgeMs: STALE_AGE_MS, now, keep }).filter(
    (p) => !parentless.includes(p)
  );
  for (const p of stale) {
    say(
      `reap: ${takeStale && !dryRun ? "killed" : "would kill"} ${labelOf(p)}, ${hoursOf(p)}h old` +
        (takeStale ? "" : " — pass --stale to take it")
    );
    if (takeStale) kill(p.pid);
  }
  if (!stale.length) say(`reap: nothing of ours older than ${STALE_AGE_MS / 3_600_000}h`);

  return { took: staleServers.length + parentless.length + stale.length, blind: blind ?? refused };
}

const isNode = (name) => /^node(\.exe)?$/i.test(path.basename(String(name)));

/**
 * The node processes left in `worktree` by its own ticket's sessions, whatever their age: only
 * that ticket runs there, so no live peer can be among them. The separator after the root is what
 * keeps `agent-16` from claiming `agent-1641`'s processes.
 */
export function worktreeOrphans(table, { worktree, checkout = checkoutRoot(), selfPid, keep = new Set(), platform = process.platform }) {
  const root = normalizePath(worktree, platform).replace(/\\+$/, "") + "\\";
  // The shared checkout holds every worktree and the supervisor; none of it is one ticket's.
  if (root === normalizePath(checkout, platform).replace(/\\+$/, "") + "\\") return [];
  const ancestors = ancestry(table, selfPid);
  return table.filter(
    (p) =>
      isNode(p.name) &&
      !ancestors.has(p.pid) &&
      !keep.has(p.pid) &&
      ownedByTooling(p.commandLine, [root], platform)
  );
}

/** `worktreeOrphans`, killed: the agent:check preflight's sweep of its own tree. */
export function reapWorktree(worktree, { dryRun = false, say = console.log, readTable = processTable, listeners = readListeners } = {}) {
  const { rows: table, blind } = readTable();
  if (blind) say(`reap: ${blind}`);
  const { sockets, blind: listenBlind } = listeners();
  if (listenBlind) {
    say(`reap: ${listenBlind}`);
    return [];
  }
  const found = worktreeOrphans(table, { worktree, selfPid: process.pid, keep: new Set(sockets.map((s) => s.pid)) });
  for (const p of found) {
    say(`reap: ${dryRun ? "would kill" : "killed"} ${p.name} pid ${p.pid}, left running in ${worktree}`);
    killPid(p.pid, dryRun, say, readTable);
  }
  return found.map((p) => p.pid);
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  await reap({ dryRun: process.argv.includes("--dry-run"), stale: process.argv.includes("--stale") });
}
