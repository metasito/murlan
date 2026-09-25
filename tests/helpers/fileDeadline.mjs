// Preloaded into every file `npm test` runs (package.json). A file that blocks its event loop — a
// synchronous child, a top-level await that never settles — outlives --test-timeout and
// --test-force-exit alike, since both need the loop it is blocking. A worker's timer does not.
import { Worker, isMainThread, workerData } from "node:worker_threads";
import { writeSync } from "node:fs";

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

if (isMainThread && process.env.NODE_TEST_CONTEXT) {
  const watch = { file: process.argv[1], ms: deadlineMs() };
  new Worker(new URL(import.meta.url), { workerData: { fileDeadline: watch } }).unref();
} else if (workerData?.fileDeadline) {
  const { file, ms } = workerData.fileDeadline;
  setTimeout(() => {
    writeSync(2, `\n${file}: still running after ${ms / 1000}s, killed by tests/helpers/fileDeadline.mjs\n`);
    process.kill(process.pid, "SIGKILL");
  }, ms);
}
