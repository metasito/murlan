/**
 * Clears what a killed run leaves behind: the e2e server still holding its port, and node
 * processes belonging to sessions that have exited.
 *
 * A sibling of prune-worktrees.mjs rather than a flag on it. Removing a worktree is reversible and
 * asked for; killing a process is neither, and prune runs in places where doing it would be a
 * surprise.
 *
 * Usage: node scripts/reap.mjs [--dry-run] [--stale] [--port]
 */
import { execFileSync } from "node:child_process";

const ORPHAN_AGE_MS = 2 * 60 * 60 * 1000;
const STALE_AGE_MS = 24 * 60 * 60 * 1000;
const E2E_PORT = process.env.E2E_PORT ?? "5199";

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
 * the cmd above that — so its parent is alive and `orphans` cannot see it. Nine such processes,
 * three to five days old, were what prompted this. Age is the only honest signal left, and it is
 * not a safe one on its own: a live session's node is also a node process that has been running a
 * long time. This is why `--stale` is asked for rather than assumed.
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
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name," +
        "@{n='Started';e={[int64][datetimeoffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}} " +
        "| ConvertTo-Json -Compress",
    ]);
    if (!json.trim()) return [];
    const rows = JSON.parse(json);
    return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
      pid: r.ProcessId,
      ppid: r.ParentProcessId,
      name: String(r.Name ?? ""),
      startedAt: Number(r.Started ?? 0),
    }));
  }
  const now = Date.now();
  return sh("ps", ["-eo", "pid=,ppid=,etimes=,comm="])
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((f) => f.length >= 4)
    .map(([pid, ppid, etimes, ...rest]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      name: rest.join(" "),
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

/** Whatever is listening on `port`, so the next run binds instead of adopting or failing. */
export function portListeners(port) {
  if (process.platform === "win32") {
    return [
      ...new Set(
        sh("netstat", ["-ano"])
          .split("\n")
          .filter((l) => /LISTENING/.test(l) && new RegExp(`:${port}\\s`).test(l))
          .map((l) => Number(l.trim().split(/\s+/).pop()))
          .filter(Boolean)
      ),
    ];
  }
  return [
    ...new Set(
      sh("lsof", ["-ti", `tcp:${port}`])
        .split("\n")
        .map((l) => Number(l.trim()))
        .filter(Boolean)
    ),
  ];
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
  const nodes = table.filter((p) => /^node(\.exe)?$/i.test(p.name));
  const keep = ancestry(table, process.pid);
  const hoursOf = (p) => ((now - p.startedAt) / 3_600_000).toFixed(1);

  const parentless = orphans(nodes, {
    livePids: new Set(table.map((p) => p.pid)),
    minAgeMs: ORPHAN_AGE_MS,
    now,
    keep,
  });
  for (const p of parentless) {
    console.log(`reap: ${dryRun ? "would kill" : "killed"} node pid ${p.pid}, ${hoursOf(p)}h old, parent ${p.ppid} is gone`);
    killPid(p.pid, dryRun);
  }
  if (!parentless.length) console.log("reap: no node process lost its parent");

  const stale = staleByAge(nodes, { maxAgeMs: STALE_AGE_MS, now, keep }).filter(
    (p) => !parentless.includes(p)
  );
  const takeStale = process.argv.includes("--stale");
  for (const p of stale) {
    console.log(
      `reap: ${takeStale && !dryRun ? "killed" : "would kill"} node pid ${p.pid}, ${hoursOf(p)}h old` +
        (takeStale ? "" : " — pass --stale to take it")
    );
    if (takeStale) killPid(p.pid, dryRun);
  }
  if (!stale.length) console.log(`reap: no node process older than ${STALE_AGE_MS / 3_600_000}h`);
}
