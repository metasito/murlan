// Preloaded into every file `npm test` runs (package.json). A file that blocks its event loop — a
// synchronous child, a top-level await that never settles — outlives --test-timeout and
// --test-force-exit alike, since both need the loop it is blocking. A worker's timer does not.
import { Worker, isMainThread, workerData } from "node:worker_threads";
import { renameSync, writeFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Three times the slowest file CI has measured: `tests/integration/reconnect.test.ts`, 47 s. */
export const FILE_DEADLINE_MS = 150_000;

/**
 * Only ever shortens the deadline, so no setting of it switches the guard off.
 * @param {Record<string, string | undefined>} env
 */
export function deadlineMs(env = process.env) {
  const asked = Number(env.MURLAN_TEST_FILE_DEADLINE_MS);
  return asked > 0 ? Math.min(asked, FILE_DEADLINE_MS) : FILE_DEADLINE_MS;
}

/**
 * Where a file's process, as its exit begins, leaves word for the run that spawned it: the exit
 * stops this file's own deadline worker in its teardown, after the exit listeners have run, so
 * tests/helpers/runWatch.mjs keeps the deadline for what follows.
 * @param {number} runnerPid
 */
export function exitMarkers(runnerPid) {
  return path.join(os.tmpdir(), `murlan-exiting-${runnerPid}`);
}

if (isMainThread && process.env.NODE_TEST_CONTEXT) {
  const watch = { file: process.argv[1], ms: deadlineMs() };
  // Read now: a file may change TMPDIR or its cwd before it exits.
  const marker = path.join(exitMarkers(process.ppid), String(process.pid));
  process.once("exit", () => {
    // Renamed into place, so the watcher never reads half a marker. `started` is no earlier than
    // this process's start, which is how a stranger that later takes the pid is told apart.
    const started = Math.floor(performance.timeOrigin);
    try {
      writeFileSync(`${marker}.tmp`, JSON.stringify({ file: watch.file, started, at: Date.now() }));
      renameSync(`${marker}.tmp`, marker);
    } catch (err) {
      // No directory: no run is watching, as when this preload runs without filesRunReporter.mjs.
      if (err.code !== "ENOENT") writeSync(2, `\n${watch.file}: its exit is unwatched: ${err.message}\n`);
    }
  });
  // Not the inherited execArgv: its `--import ./tests/…` resolves against the cwd when the worker
  // boots, and a file that chdirs before then kills the worker, and with it the deadline.
  new Worker(new URL(import.meta.url), { execArgv: [], workerData: { fileDeadline: watch } }).unref();
} else if (workerData?.fileDeadline) {
  const { file, ms } = workerData.fileDeadline;
  setTimeout(() => {
    writeSync(2, `\n${file}: still running after ${ms / 1000}s, killed by tests/helpers/fileDeadline.mjs\n`);
    process.kill(process.pid, "SIGKILL");
  }, ms);
}
