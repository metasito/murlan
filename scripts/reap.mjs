/**
 * Clears what a killed run leaves behind: the e2e server still holding its port, and node
 * processes belonging to sessions that have exited.
 *
 * A sibling of prune-worktrees.mjs rather than a flag on it. Removing a worktree is reversible and
 * asked for; killing a process is neither, and prune runs in places where doing it would be a
 * surprise.
 *
 * Usage: node scripts/reap.mjs [--dry-run] [--stale] [--docker] [--port]
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORPHAN_AGE_MS = 2 * 60 * 60 * 1000;
const STALE_AGE_MS = 24 * 60 * 60 * 1000;
const E2E_PORT = process.env.E2E_PORT ?? "5199";

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
 * Whether a process belongs to this repo's tooling, read off its command line.
 *
 * Matching by process name instead would be indefensible: `chrome.exe` is as likely to be the
 * owner's own browser, and `python.exe` and `msedgewebview2.exe` on this machine belong to an
 * unrelated agent and to Windows. A command line naming a root below is the only thing that
 * distinguishes ours from theirs, so a command line that could not be read claims nothing.
 */
export function ownedByTooling(commandLine, roots, platform = process.platform) {
  if (!commandLine) return false;
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
  return processes.filter(
    (p) =>
      Number.isFinite(p.startedAt) &&
      p.startedAt > 0 &&
      !keep.has(p.pid) &&
      !livePids.has(p.ppid) &&
      now - p.startedAt >= minAgeMs
  );
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

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

/** Every process on the box, so a candidate's parent can be looked up rather than assumed dead. */
function processTable() {
  if (process.platform === "win32") {
    const json = sh("powershell", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine," +
        "@{n='Started';e={[int64][datetimeoffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}} " +
        "| ConvertTo-Json -Compress",
    ]);
    if (!json.trim()) return [];
    const rows = JSON.parse(json);
    return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
      pid: r.ProcessId,
      ppid: r.ParentProcessId,
      name: String(r.Name ?? ""),
      commandLine: r.CommandLine ?? "",
      startedAt: Number(r.Started ?? 0),
    }));
  }
  const now = Date.now();
  return sh("ps", ["-eo", "pid=,ppid=,etimes=,args="])
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
}

/** This process and everything that launched it, so the reaper cannot kill its own caller. */
function ancestry(table, pid) {
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const keep = new Set();
  for (let cur = pid; cur && !keep.has(cur); cur = byPid.get(cur)?.ppid) keep.add(cur);
  return keep;
}

function killPid(pid, dryRun) {
  if (dryRun) return;
  if (process.platform === "win32") sh("taskkill", ["/PID", String(pid), "/T", "/F"]);
  else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** LISTENING pids in `netstat -ano` output — every one, or only those bound to `port`. */
export function netstatListeners(text, port) {
  return [
    ...new Set(
      text
        .split("\n")
        .filter((l) => /LISTENING/.test(l) && (port === undefined || new RegExp(`:${port}\\s`).test(l)))
        .map((l) => Number(l.trim().split(/\s+/).pop()))
        .filter(Boolean)
    ),
  ];
}

function pidLines(text) {
  return [...new Set(text.split("\n").map((l) => Number(l.trim())).filter(Boolean))];
}

/** Whatever is listening on `port`, so the next run binds instead of adopting or failing. */
export function portListeners(port) {
  return process.platform === "win32"
    ? netstatListeners(sh("netstat", ["-ano"]), port)
    : pidLines(sh("lsof", ["-ti", `tcp:${port}`]));
}

/**
 * Anything serving a port is doing work, whatever its parent or its age says. A dev server left
 * running detached is the case this protects: its launcher is long gone and it is hours old, so
 * both classes below would otherwise read it as a corpse.
 */
function listeningPids() {
  return new Set(
    process.platform === "win32"
      ? netstatListeners(sh("netstat", ["-ano"]))
      : pidLines(sh("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-t"]))
  );
}

/** Present only when docker is up; a stopped engine is not a container worth reporting. */
function removeContainer(name, dryRun) {
  const running = sh("docker", ["ps", "-a", "--filter", `name=^${name}$`, "--format", "{{.Names}}"]).trim();
  if (running !== name) return false;
  if (!dryRun) sh("docker", ["rm", "-f", name]);
  return true;
}

export function clearPort(port, { dryRun = false } = {}) {
  const pids = portListeners(port).filter((pid) => pid !== process.pid);
  for (const pid of pids) killPid(pid, dryRun);
  return pids;
}

if (import.meta.filename === process.argv[1]) {
  const dryRun = process.argv.includes("--dry-run");
  const verb = dryRun ? "would clear" : "cleared";

  const held = clearPort(E2E_PORT, { dryRun });
  console.log(
    held.length
      ? `reap: ${verb} the e2e port ${E2E_PORT}, held by pid ${held.join(", ")}`
      : `reap: e2e port ${E2E_PORT} is free`
  );

  // `npm run test:e2e` takes this path. Playwright refuses a busy port before it ever runs the
  // webServer command, so the port has to be free by then — but a suite is not the place to
  // decide that some other node process has outlived its session.
  if (process.argv.includes("--port")) process.exit(0);

  const now = Date.now();
  const table = processTable();
  // A worktree lives under the checkout, so naming the checkout covers every one of them —
  // including the worktree this is running from, which is not necessarily the main one.
  const checkout = path
    .resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
    .split(/[\\/]\.worktrees[\\/]/)[0];
  const roots = toolingRoots({ repoRoot: checkout, home: os.homedir() });
  const ours = table.filter((p) => ownedByTooling(p.commandLine, roots));
  const keep = ancestry(table, process.pid);
  for (const pid of listeningPids()) keep.add(pid);
  const hoursOf = (p) => ((now - p.startedAt) / 3_600_000).toFixed(1);
  const labelOf = (p) => `${p.name || "process"} pid ${p.pid}`;

  const parentless = orphans(ours, {
    livePids: new Set(table.map((p) => p.pid)),
    minAgeMs: ORPHAN_AGE_MS,
    now,
    keep,
  });
  for (const p of parentless) {
    console.log(`reap: ${dryRun ? "would kill" : "killed"} ${labelOf(p)}, ${hoursOf(p)}h old, parent ${p.ppid} is gone`);
    killPid(p.pid, dryRun);
  }
  if (!parentless.length) console.log("reap: nothing of ours lost its parent");

  const stale = staleByAge(ours, { maxAgeMs: STALE_AGE_MS, now, keep }).filter(
    (p) => !parentless.includes(p)
  );
  const takeStale = process.argv.includes("--stale");
  for (const p of stale) {
    console.log(
      `reap: ${takeStale && !dryRun ? "killed" : "would kill"} ${labelOf(p)}, ${hoursOf(p)}h old` +
        (takeStale ? "" : " — pass --stale to take it")
    );
    if (takeStale) killPid(p.pid, dryRun);
  }
  if (!stale.length) console.log(`reap: nothing of ours older than ${STALE_AGE_MS / 3_600_000}h`);

  // A container is not owned by the session that started it, so only the single-run ones go by
  // default. The dev stack backs whatever else is running — another session's e2e most of the
  // time — and taking it is a decision, not a tidy-up.
  for (const name of ["murlan-verify-pg", "murlan-verify-boot"]) {
    if (removeContainer(name, dryRun)) {
      console.log(`reap: ${dryRun ? "would remove" : "removed"} container ${name}`);
    }
  }
  if (process.argv.includes("--docker") && removeContainer("murlan-dev-pg", dryRun)) {
    console.log(`reap: ${dryRun ? "would remove" : "removed"} container murlan-dev-pg`);
  }
}
