/**
 * The one record format the three runners' results reporters write and tools/ci/test-verdict.mjs
 * reads (RULES.md 53). One file per runner invocation, created exclusively, never overwritten, so
 * a second invocation in a job sits beside the first rather than replacing its failures.
 */
import { appendFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

/** The directory a CI job collects into; unset, the reporters write nothing. */
export const RESULTS_ENV = "MURLAN_TEST_RESULTS";

/** @typedef {"passed" | "failed" | "skipped" | "todo"} Status */
/**
 * @typedef {{ type: "run", runner: "node" | "jest" | "playwright", started: string, filters: string[] }
 *   | { type: "test", file: string, title: string, status: Status, attempt?: number, retries?: number, project?: string, suite?: true }
 *   | { type: "end", ok: boolean, counts?: Record<string, number> }} ResultRecord
 */

/**
 * @param {"node" | "jest" | "playwright"} runner
 * @param {Record<string, string | undefined>} [env]
 * @param {string[]} [filters] what the run was told to leave out by name, which no runner reports as a skip
 * @returns {{ write: (record: ResultRecord) => void, file: string | undefined }}
 */
export function openResults(runner, env = process.env, filters = []) {
  const dir = env[RESULTS_ENV];
  if (!dir) return { write: () => {}, file: undefined };
  // A test that spawns its own runner (loopTestEnv.test.ts reuses loop:test's arguments) must not
  // add that run's planted failures to the job's: the runner opens this before it spawns a test.
  delete env[RESULTS_ENV];
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${runner}-${process.pid}-${randomBytes(4).toString("hex")}.jsonl`);
  closeSync(openSync(file, "wx"));
  const write = (/** @type {ResultRecord} */ record) => appendFileSync(file, `${JSON.stringify(record)}\n`);
  write({ type: "run", runner, started: new Date().toISOString(), filters });
  return { write, file };
}

/** @param {string} file absolute or relative to `root` */
export const repoPath = (file, root = process.cwd()) => path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
