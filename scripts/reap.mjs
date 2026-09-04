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
 * How much of one core, sustained across the sample, counts as burning. Well under the full core
 * the observed pipeline held, and far above the noise a process makes doing nothing.
 */
const BURN_MIN_RATIO = 0.2;
const BURN_SAMPLE_MS = 1000;

/**
 * How much CPU each process used *between* two snapshots, as a fraction of one core.
 *
 * The platform reports CPU time cumulatively, and a process that burned a core for hours and then
 * stopped still carries every second of it. Only the delta says it is burning one now, which is
 * the whole difference between measuring this and assuming it.
 */
export function cpuRatios(before, after, intervalMs) {
  const start = new Map(before.map((p) => [p.pid, p.cpuMs]));
  return after
    .filter((p) => Number.isFinite(p.cpuMs) && Number.isFinite(start.get(p.pid)))
    .map((p) => ({ ...p, cpuRatio: (p.cpuMs - start.get(p.pid)) / intervalMs }))
    .filter((p) => p.cpuRatio >= 0);
}

/**
 * Whether a process belongs to the operating system, and so can never be a candidate.
 *
 * This is the one class that kills something the repo does not own, so the exclusion has to fail
 * closed in both directions it can be wrong. An unreadable command line is the signature of a
 * protected process on Windows — the opposite conclusion from `ownedByTooling`, which claims
 * nothing in the same situation, because there an unknown process must not be *taken* and here an
 * unknown process must not be *spared* by accident.
 */
export function isSystemProcess({ pid, commandLine = "" }, { systemRoot, platform = process.platform } = {}) {
  if (!Number.isFinite(pid) || pid <= 4) return true;
  if (!commandLine.trim()) return true;
  const where = normalizePath(commandLine, platform);
  const roots =
    platform === "win32"
      ? [systemRoot || process.env.SystemRoot || "C:/Windows"]
      : ["/sbin", "/usr/sbin", "/lib/systemd", "/usr/lib/systemd"];
  return roots.some((root) => where.includes(normalizePath(root, platform)));
}

/**
 * A parentless process that is measurably burning CPU, whoever owns it.
 *
 * The class the ownership rule cannot reach. A `tr | fold | awk` pipeline reading `/dev/urandom`,
 * orphaned by a killed Git Bash session — Windows has no `SIGHUP` to send it and the input never
 * ends — held a core for 62 hours while `reap` reported "nothing of ours". Nothing legitimate is
 * at once parentless, hours old, and pegged, so the conjunction is what makes this safe rather
 * than ownership.
 */
export function burningOrphans(sampled, { livePids, minAgeMs, now, keep, minRatio, systemRoot, platform }) {
  return orphans(sampled, { livePids, minAgeMs, now, keep }).filter(
    (p) => p.cpuRatio >= minRatio && !isSystemProcess(p, { systemRoot, platform })
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

/**
 * `-Compress` emits no whitespace of its own, so a raw byte below 0x20 arriving here is never
 * JSON structure — it is a character of somebody's command line that the serializer let through
 * unescaped, and `JSON.parse` rejects the whole table over it. Dropping it costs one character of
 * one command line, which every rule below matches on as a substring.
 */
const RAW_CONTROL_BYTE = /[\x00-\x1f]/g;

/** One row per process, from the Windows table's JSON. Exported so the line above is testable. */
export function parseWindowsProcessJson(json) {
  if (!json.trim()) return [];
  const rows = JSON.parse(json.replace(RAW_CONTROL_BYTE, ""));
  return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
    pid: r.ProcessId,
    ppid: r.ParentProcessId,
    name: String(r.Name ?? ""),
    commandLine: r.CommandLine ?? "",
    startedAt: Number(r.Started ?? 0),
    cpuMs: Number(r.Cpu ?? NaN),
  }));
}

/** Every process on the box, so a candidate's parent can be looked up rather than assumed dead. */
function processTable() {
  if (process.platform === "win32") {
    const json = sh("powershell", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine," +
        "@{n='Started';e={[int64][datetimeoffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}}," +
        // Both times are cumulative, in 100-ns units. Their sum over 10,000 is milliseconds of CPU.
        "@{n='Cpu';e={[int64](($_.KernelModeTime + $_.UserModeTime) / 10000)}} " +
        "| ConvertTo-Json -Compress",
    ]);
    return parseWindowsProcessJson(json);
  }
  const now = Date.now();
  return sh("ps", ["-eo", "pid=,ppid=,etimes=,time=,args="])
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, etimes, cpuTime, args]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      name: args.split(/\s+/)[0] ?? "",
      commandLine: args,
      startedAt: now - Number(etimes) * 1000,
      cpuMs: psTimeToMs(cpuTime),
    }));
}

/** `ps`'s cumulative CPU column, which is `[[DD-]HH:]MM:SS[.ss]`, in milliseconds. */
export function psTimeToMs(text) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(String(text).trim());
  if (!m) return NaN;
  const [, days, hours, minutes, seconds] = m;
  return (
    ((Number(days ?? 0) * 24 + Number(hours ?? 0)) * 3600 + Number(minutes) * 60 + Number(seconds)) *
    1000
  );
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
 * the walk. Everything above the gap then silently stops being protected — which is how a
 * reaper came to take the terminal, the shell, the agent and itself in one call. Reading the
 * tree that is about to be terminated cannot be fooled the same way: the reaper is inside it
 * or it is not.
 */
export function wouldTakeSelf(table, pid, selfPid) {
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

function killPid(pid, dryRun) {
  if (dryRun) return;
  if (wouldTakeSelf(processTable(), pid, process.pid)) {
    // Re-read rather than trust the caller's snapshot: the tree is what `/T` acts on, and a
    // process that joined it since the sweep began is as fatal as one that was always there.
    console.log(`reap: refused to kill pid ${pid} — this session is inside its process tree`);
    return;
  }
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

/**
 * Which of `pids` hold the port as a leftover rather than as a running suite.
 *
 * A sweep must not be able to end a suite mid-run — and not only because it costs the run. A
 * webServer pulled out from under Playwright surfaces as a connection error or a 0ms failure,
 * which reads exactly like a defect, so a sweep that takes a live port *manufactures a test
 * result* in another process. Anything trusting a suite's verdict then acts on it.
 *
 * Parentage is the signal, not age: Playwright outlives the whole run and the webServer is its
 * child, so a live holder has a live parent. A pid the table cannot describe is left alone —
 * this is the one class that kills something no ownership rule vouched for, so it fails closed.
 */
export function stalePortHolders(pids, table) {
  const live = new Set(table.map((p) => p.pid));
  const byPid = new Map(table.map((p) => [p.pid, p]));
  return pids.filter((pid) => {
    const held = byPid.get(pid);
    return held !== undefined && !live.has(held.ppid);
  });
}

/** `stalePortHolders` against this machine's own process table. */
export function staleAmong(pids) {
  return stalePortHolders(pids, processTable());
}

export function clearPort(port, { dryRun = false } = {}) {
  const pids = portListeners(port).filter((pid) => pid !== process.pid);
  for (const pid of pids) killPid(pid, dryRun);
  return pids;
}

if (import.meta.filename === process.argv[1]) {
  const dryRun = process.argv.includes("--dry-run");
  const verb = dryRun ? "would clear" : "cleared";

  // Cleaning up after a run that is already over — `/loop` phase F is the
  // caller. Starting a run does not come through here: `scripts/e2ePort.mjs` picks a port that
  // is already free, which is what stopped two concurrent runs taking each other's server.
  //
  // A suite is also not the place to decide that some other node process has outlived its
  // session, so this exits before the classes below.
  if (process.argv.includes("--port")) {
    const held = clearPort(E2E_PORT, { dryRun });
    console.log(
      held.length
        ? `reap: ${verb} the e2e port ${E2E_PORT}, held by pid ${held.join(", ")}`
        : `reap: e2e port ${E2E_PORT} is free`
    );
    process.exit(0);
  }

  // Two snapshots a moment apart: cumulative CPU says only what a process has ever burned, and
  // the class below turns on what it is burning now.
  const firstSample = processTable();
  await new Promise((resolve) => setTimeout(resolve, BURN_SAMPLE_MS));

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

  // A sweep is not a suite. It has nothing waiting on the port, so a holder still attached to a
  // live launcher is somebody's run and stays — taking it does not merely cost that run, it
  // makes the suite fail in a way that reads as a defect. The command line is printed because
  // "held by pid 33196" tells whoever lost a run nothing about whose it was.
  const holders = portListeners(E2E_PORT).filter((pid) => pid !== process.pid);
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const staleHolders = stalePortHolders(holders, table);
  for (const pid of staleHolders) {
    console.log(`reap: ${verb} the e2e port ${E2E_PORT}, held by ${labelOf(byPid.get(pid))}`);
    killPid(pid, dryRun);
  }
  for (const pid of holders.filter((p) => !staleHolders.includes(p))) {
    const held = byPid.get(pid);
    console.log(
      `reap: left the e2e port ${E2E_PORT} to a live run — ${labelOf(held ?? { pid })}, ` +
        `launched by ${held?.ppid ?? "?"}: ${(held?.commandLine || "command line unreadable").slice(0, 120)}`
    );
  }
  if (!holders.length) console.log(`reap: e2e port ${E2E_PORT} is free`);

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

  // Ownership is what makes the classes above safe, and it is exactly why they could not see the
  // worst leftover on this machine: a `tr | fold | awk` pipeline reading `/dev/urandom`, orphaned
  // by a killed Git Bash session with no SIGHUP to end it, holding a core for 62 hours while reap
  // reported "nothing of ours". Here the conjunction does that work instead — parentless, hours
  // old, measurably burning, and not the operating system's.
  const burning = burningOrphans(cpuRatios(firstSample, table, BURN_SAMPLE_MS), {
    livePids: new Set(table.map((p) => p.pid)),
    minAgeMs: ORPHAN_AGE_MS,
    now,
    keep,
    minRatio: BURN_MIN_RATIO,
  }).filter((p) => !parentless.some((q) => q.pid === p.pid));
  for (const p of burning) {
    const percent = Math.round(p.cpuRatio * 100);
    console.log(
      `reap: ${dryRun ? "would kill" : "killed"} ${labelOf(p)}, ${hoursOf(p)}h old, ` +
        `parent ${p.ppid} is gone, burning ${percent}% of a core`
    );
    killPid(p.pid, dryRun);
  }
  if (!burning.length) console.log("reap: no orphan is burning CPU");

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
