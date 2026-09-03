// Correlates a maestro.log's own command timings against the device's logcat, to prove
// (not infer) which commands pay for a hierarchy fetch and whether that fetch's cost
// tracks the app's own frame jank in the same window. #823 built this because the prior
// reading — a looping animation makes Maestro's settle-wait poll forever — held for the
// two commands that touch the game table and not for the ~90 fetches on idle menus, and
// that split is only visible by joining the two logs on their own timestamps.
//
// Usage:
//   node scripts/analyze-maestro-run.mjs <maestro.log> <logcat.txt> [package-id]
//
// Both files come straight out of a `maestro-debug` run artifact:
//   gh run download <runId> --dir out
//   node scripts/analyze-maestro-run.mjs \
//     out/maestro-debug/.maestro/tests/*/offline-game/logs/maestro.log \
//     out/maestro-debug/work/_temp/logcat.txt

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PACKAGE = "com.murlan.cardgame";

/** @param {string} hhmmss e.g. "16:53:21.726" or "09-02 16:53:21.726" */
function timeOfDayMs(hhmmss) {
  const clock = hhmmss.trim().split(" ").at(-1);
  const [hms, ms] = clock.split(".");
  const [h, m, s] = hms.split(":").map(Number);
  return ((h * 60 + m) * 60 + s) * 1000 + Number(ms ?? 0);
}

/**
 * Every command's own window, matched RUNNING to its COMPLETED/SKIPPED/FAILED by a
 * per-label stack — nested commands (`Run flow` wrapping an `Assert`) share no label,
 * so LIFO is exact rather than a heuristic. A RUNNING with nothing to close it by the
 * last line in the file is real evidence too: it is the command that never returned,
 * reported with the log's last timestamp as a lower bound on how long it waited.
 *
 * A command still open at the file's last line closes against `endHintMs` if that is
 * later than anything the log itself saw — the log stops the instant the process that
 * writes it dies, which is earlier than the device kept running, so the log's own last
 * timestamp would understate a hang down to 0.
 *
 * @param {string} maestroLog
 * @param {number} [endHintMs]
 * @returns {{ label: string, status: string, startMs: number, endMs: number, elapsedMs: number }[]}
 */
export function parseCommandWindows(maestroLog, endHintMs = 0) {
  const lineRe = /^(\d\d:\d\d:\d\d\.\d+) \[.*?\] .*?on(?:CommandStart|CommandFinished): (.*) (RUNNING|COMPLETED|SKIPPED|FAILED)$/;
  /** @type {Map<string, number[]>} */
  const openStarts = new Map();
  /** @type {{ label: string, status: string, startMs: number, endMs: number, elapsedMs: number }[]} */
  const windows = [];
  let lastMs = 0;

  for (const line of maestroLog.split("\n")) {
    const match = line.match(lineRe);
    if (!match) continue;
    const [, time, label, status] = match;
    const ms = timeOfDayMs(time);
    lastMs = ms;
    if (status === "RUNNING") {
      if (!openStarts.has(label)) openStarts.set(label, []);
      openStarts.get(label).push(ms);
      continue;
    }
    const stack = openStarts.get(label);
    const startMs = stack?.pop();
    if (startMs === undefined) continue;
    windows.push({ label, status, startMs, endMs: ms, elapsedMs: ms - startMs });
  }

  const openEndMs = Math.max(lastMs, endHintMs);
  for (const [label, starts] of openStarts) {
    for (const startMs of starts) {
      windows.push({ label, status: "RUNNING", startMs, endMs: openEndMs, elapsedMs: openEndMs - startMs });
    }
  }
  return windows.sort((a, b) => a.startMs - b.startMs);
}

/** @param {string} logcat @returns {{ ms: number, durationMs: number }[]} */
export function parseHierarchyFetches(logcat) {
  const re = /^(\S+ \S+) D\/Maestro\S* \(\s*\d+\): View hierarchy received in (\d+) ms$/;
  return matchAll(logcat, re);
}

/**
 * `Davey!` frames are logged by whichever process drew the frame, tagged with its own
 * pid — filtering to the app under test is what keeps a compositor or launcher's jank
 * from being read as the app's.
 *
 * @param {string} logcat @param {number} pid @returns {{ ms: number, durationMs: number }[]}
 */
export function parseJankFrames(logcat, pid) {
  const re = new RegExp(`^(\\S+ \\S+) I/OpenGLRenderer\\(\\s*${pid}\\): Davey! duration=(\\d+)ms`);
  return matchAll(logcat, re);
}

/** @param {string} logcat @param {RegExp} re @returns {{ ms: number, durationMs: number }[]} */
function matchAll(logcat, re) {
  /** @type {{ ms: number, durationMs: number }[]} */
  const events = [];
  for (const line of logcat.split("\n")) {
    const match = line.match(re);
    if (match) events.push({ ms: timeOfDayMs(match[1]), durationMs: Number(match[2]) });
  }
  return events;
}

/**
 * The pid the app ran under for the launch immediately before `beforeMs` — each flow's
 * `Launch app ... with clear state` starts a fresh process, so a run that drives two
 * flows back to back has one pid per flow and this picks the one that was live when
 * the window we are asking about ran.
 *
 * @param {string} logcat @param {string} packageId @param {number} beforeMs
 * @returns {number | undefined}
 */
export function appPidAt(logcat, packageId, beforeMs) {
  const re = new RegExp(`^(\\S+ \\S+) I/am_proc_start\\(.*?\\): \\[0,(\\d+),\\d+,${packageId.replace(/\./g, "\\.")},`);
  let pid;
  for (const line of logcat.split("\n")) {
    const match = line.match(re);
    if (!match) continue;
    if (timeOfDayMs(match[1]) > beforeMs) break;
    pid = Number(match[2]);
  }
  return pid;
}

/**
 * @param {ReturnType<typeof parseCommandWindows>} windows
 * @param {ReturnType<typeof parseHierarchyFetches>} fetches
 * @param {ReturnType<typeof parseJankFrames>} jank
 */
export function summarize(windows, fetches, jank) {
  return windows.map((w) => {
    const inWindow = (e) => e.ms >= w.startMs && e.ms <= w.endMs;
    const wFetches = fetches.filter(inWindow);
    const wJank = jank.filter(inWindow);
    const sum = (es) => es.reduce((a, e) => a + e.durationMs, 0);
    return {
      label: w.label,
      status: w.status,
      elapsedMs: w.elapsedMs,
      fetchCount: wFetches.length,
      fetchTotalMs: sum(wFetches),
      fetchMeanMs: wFetches.length ? Math.round(sum(wFetches) / wFetches.length) : 0,
      jankCount: wJank.length,
      jankMeanMs: wJank.length ? Math.round(sum(wJank) / wJank.length) : 0,
    };
  });
}

/** @param {ReturnType<typeof summarize>} rows */
export function toMarkdownTable(rows) {
  const header = "| Command | Status | Elapsed | Fetches | Fetch total | Fetch mean | Janky frames | Jank mean |";
  const sep = "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |";
  const lines = rows
    .filter((r) => r.elapsedMs >= 500)
    .map(
      (r) =>
        `| ${r.label} | ${r.status} | ${(r.elapsedMs / 1000).toFixed(1)}s | ${r.fetchCount} | ${(
          r.fetchTotalMs / 1000
        ).toFixed(1)}s | ${r.fetchMeanMs}ms | ${r.jankCount} | ${r.jankMeanMs}ms |`
    );
  return [header, sep, ...lines].join("\n");
}

function isInvokedDirectly(argv1, moduleUrl) {
  return Boolean(argv1) && path.resolve(argv1) === fileURLToPath(moduleUrl);
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [maestroLogPath, logcatPath, packageId = DEFAULT_PACKAGE] = process.argv.slice(2);
  if (!maestroLogPath || !logcatPath) {
    throw new Error("usage: node scripts/analyze-maestro-run.mjs <maestro.log> <logcat.txt> [package-id]");
  }

  const maestroLog = readFileSync(maestroLogPath, "utf8");
  const logcat = readFileSync(logcatPath, "utf8");
  const logcatTimestamps = [...logcat.matchAll(/^\d\d-\d\d (\d\d:\d\d:\d\d\.\d+) /gm)].map((m) => timeOfDayMs(m[1]));
  const logcatEndMs = Math.max(0, ...logcatTimestamps);
  const windows = parseCommandWindows(maestroLog, logcatEndMs);
  const flowStart = windows.find((w) => /^Launch app/.test(w.label))?.endMs ?? 0;
  const pid = appPidAt(logcat, packageId, flowStart);
  if (pid === undefined) throw new Error(`no am_proc_start for ${packageId} at or before the flow's launch`);

  const fetches = parseHierarchyFetches(logcat);
  const jank = parseJankFrames(logcat, pid);
  const rows = summarize(windows, fetches, jank);

  process.stdout.write(`pid ${pid}, ${fetches.length} hierarchy fetches, ${jank.length} janky frames in the run\n\n`);
  process.stdout.write(`${toMarkdownTable(rows)}\n`);
}
