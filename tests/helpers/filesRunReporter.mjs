import { readdirSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { FILE_DEADLINE_MS } from "./fileDeadline.mjs";

/** The suites' roots: a run that loads anything under one is answerable for everything under it. */
const ROOTS = ["tools/loop/tests", "tests"];

/**
 * Past a file's own deadline, so a stuck file is named by that guard first. This one hears what
 * neither that guard nor --test-timeout can: the runner itself, whose loop both depend on.
 */
export const RUN_IDLE_MS = FILE_DEADLINE_MS + 30_000;

/**
 * Only ever shortens the limit, so no setting of it switches the guard off.
 * @param {Record<string, string | undefined>} env
 */
export function runIdleMs(env = process.env) {
  const asked = Number(env.MURLAN_TEST_RUN_IDLE_MS);
  return asked > 0 ? Math.min(asked, RUN_IDLE_MS) : RUN_IDLE_MS;
}

const isFile = (data) => data?.nesting === 0 && path.resolve(data.name ?? "") === path.resolve(data.file ?? "");

/**
 * Contract: one `test files run in <dir>: <n>` line per directory, which ci.yml's Test guard counts.
 * A file counts only when a test in it really ran — not skipped, not todo, and not the stand-in
 * node reports for a file that declared no test at all.
 *
 * It also fails the run when a `*.test.ts` under a root the run touched never loaded: a narrowed
 * glob drops whole directories and still exits 0.
 */
export default async function* filesRun(source) {
  const loaded = new Set();
  const ran = new Set();
  const inFlight = new Set();
  const heartbeat = new BigInt64Array(new SharedArrayBuffer(8));
  const beat = () => Atomics.store(heartbeat, 0, BigInt(Date.now()));
  beat();
  // No inherited execArgv: the runner's own `--test …` or `-e` would make the worker something else.
  const watch = new Worker(new URL("./runWatch.mjs", import.meta.url), { execArgv: [], workerData: { heartbeat, idleMs: runIdleMs() } });
  watch.unref();
  const tell = () => watch.postMessage([...inFlight].map((f) => path.relative(process.cwd(), f)));
  for await (const { type, data } of source) {
    beat();
    if (isFile(data) && (type === "test:dequeue" || type === "test:complete")) {
      if (type === "test:dequeue") inFlight.add(data.file);
      else inFlight.delete(data.file);
      tell();
    }
    if (!data?.file) continue;
    loaded.add(data.file);
    if (type === "test:fail") ran.add(data.file);
    const standIn = path.resolve(data.name ?? "") === path.resolve(data.file);
    if (type === "test:pass" && !data.skip && !data.todo && !standIn) ran.add(data.file);
  }
  void watch.terminate();
  const perDir = new Map();
  for (const file of ran) {
    const dir = path.relative(process.cwd(), path.dirname(file)).split(path.sep).join("/");
    perDir.set(dir, (perDir.get(dir) ?? 0) + 1);
  }
  for (const [dir, count] of [...perDir].sort()) yield `test files run in ${dir}: ${count}\n`;

  const missing = unloaded([...loaded]);
  if (loaded.size === 0) missing.push("(no test file loaded at all)");
  for (const file of missing) yield `test file never loaded: ${file}\n`;
  if (missing.length > 0) process.exitCode = 1;
}

/** @param {string[]} loaded absolute paths */
export function unloaded(loaded, cwd = process.cwd()) {
  const rel = loaded.map((f) => path.relative(cwd, f).split(path.sep).join("/"));
  return ROOTS.filter((root) => rel.some((f) => f.startsWith(`${root}/`))).flatMap((root) =>
    readdirSync(path.join(cwd, root), { recursive: true, encoding: "utf8" })
      .map((f) => `${root}/${f.split(path.sep).join("/")}`)
      .filter((f) => f.endsWith(".test.ts") && !rel.includes(f))
  );
}
