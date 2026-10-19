// Preloaded into every file `npm test` runs (package.json). A file that blocks its event loop — a
// synchronous child, a top-level await that never settles — outlives --test-timeout and
// --test-force-exit alike, since both need the loop it is blocking. A worker's timer does not.
import { Worker, isMainThread, workerData } from "node:worker_threads";
import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startBin } from "../../scripts/lib/proc.mjs";

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

/** An exit takes milliseconds; --test-force-exit makes every file's one process.exit. */
export const EXIT_GRACE_MS = 15_000;

/**
 * Only ever shortens the grace, so no setting of it switches the guard off.
 * @param {Record<string, string | undefined>} env
 */
export function exitGraceMs(env = process.env) {
  const asked = Number(env.MURLAN_TEST_EXIT_GRACE_MS);
  return asked > 0 ? Math.min(asked, EXIT_GRACE_MS) : EXIT_GRACE_MS;
}

if (isMainThread && process.env.NODE_TEST_CONTEXT) {
  const watch = { file: process.argv[1], ms: deadlineMs() };
  // process.exit stops the worker below before it ends, so a hang inside the exit needs a process.
  process.once("exit", () => {
    const watcher = fileURLToPath(new URL("./exitWatch.mjs", import.meta.url));
    startBin(process.execPath, [watcher, String(process.pid), String(exitGraceMs()), watch.file], { stdio: ["ignore", "ignore", "inherit"] }).unref();
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
