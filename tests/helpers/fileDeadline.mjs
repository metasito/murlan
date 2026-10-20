// Preloaded into every file `npm test` runs (package.json). A file that blocks its event loop — a
// synchronous child, a top-level await that never settles — outlives --test-timeout and
// --test-force-exit alike, since both need the loop it is blocking. A worker's timer does not.
import { Worker, isMainThread, workerData } from "node:worker_threads";
import { mkdirSync, renameSync, writeFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { identityOf } from "../../scripts/lib/proc.mjs";

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

/** Set by tests/helpers/filesRunReporter.mjs to its markers' directory; unset, no run is watching. */
export const EXIT_MARKERS_ENV = "MURLAN_TEST_EXIT_MARKERS";

if (isMainThread && process.env.NODE_TEST_CONTEXT) {
  const watch = { file: process.argv[1], ms: deadlineMs() };
  // Read now: a file may change its environment before it exits.
  const markers = process.env[EXIT_MARKERS_ENV];
  const identity = identityOf(process.pid);
  if (markers) {
    process.once("exit", () => {
      const marker = path.join(markers, String(process.pid));
      // Renamed into place, so the watcher never reads half a marker.
      try {
        mkdirSync(markers, { recursive: true });
        writeFileSync(`${marker}.tmp`, JSON.stringify({ file: watch.file, identity, at: Date.now() }));
        renameSync(`${marker}.tmp`, marker);
      } catch (err) {
        writeSync(2, `\n${watch.file}: its exit is unwatched: ${err.message}\n`);
      }
    });
  }
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
