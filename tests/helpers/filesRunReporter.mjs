import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { tableTimeoutMs } from "../../scripts/lib/proc.mjs";
import { EXIT_TICK_MS } from "./exitGuard.mjs";
import { EXIT_MARKERS_ENV, exitMarkers, FILE_DEADLINE_MS } from "./fileDeadline.mjs";

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

/** An exit takes milliseconds: --test-force-exit makes each file's one process.exit. */
export const EXIT_GRACE_MS = 15_000;

/** Below this a slow but healthy exit would be killed. */
export const MIN_EXIT_GRACE_MS = 1_000;

/**
 * What the grace keeps clear below the idle limit: a tick, and the `ps` read of a kill at its slowest.
 * @param {Record<string, string | undefined>} env
 */
export const exitGraceMarginMs = (env = process.env) => Math.max(1_000, EXIT_TICK_MS + tableTimeoutMs(env));

export const EXIT_GRACE_MARGIN_MS = exitGraceMarginMs({});

/**
 * Only ever shortens the grace, and keeps it inside the run's idle limit, so a file stuck in its
 * exit is named by this guard before the run's. Undefined, the guard off, when that limit leaves no
 * room for the floor.
 * @param {Record<string, string | undefined>} env
 * @returns {number | undefined}
 */
export function exitGraceMs(env = process.env) {
  const asked = Number(env.MURLAN_TEST_EXIT_GRACE_MS);
  const wanted = asked > 0 ? Math.min(asked, EXIT_GRACE_MS) : EXIT_GRACE_MS;
  const grace = Math.max(MIN_EXIT_GRACE_MS, Math.min(wanted, runIdleMs(env) - exitGraceMarginMs(env)));
  return grace + exitGraceMarginMs(env) <= runIdleMs(env) ? grace : undefined;
}

// At load: the runner spawns its files before this reporter hears its first event.
process.env[EXIT_MARKERS_ENV] = exitMarkers(process.pid);

const isFile = (data) => data?.nesting === 0 && path.resolve(data.name ?? "") === path.resolve(data.file ?? "");

/**
 * Contract: one `test files run in <dir>: <n>` line per directory, which ci.yml's Test guard counts.
 * A file counts only when a test in it really ran — not skipped, not todo, and not the stand-in
 * node reports for a file that declared no test at all.
 *
 * It also fails the run when a `*.test.ts` under a directory the run's globs hold never loaded: a
 * narrowed glob drops whole directories and still exits 0. A run handed only `*.test.ts` paths, one CI shard
 * of the suite, answers for those; CI gate's verdict holds every shard together to the whole listing.
 */
export default async function* filesRun(source) {
  const loaded = new Set();
  const ran = new Set();
  const inFlight = new Set();
  const heartbeat = new BigInt64Array(new SharedArrayBuffer(8));
  const beat = () => Atomics.store(heartbeat, 0, BigInt(Date.now()));
  beat();
  const markers = exitMarkers(process.pid);
  mkdirSync(markers, { recursive: true });
  // This runner's own start: a marker older than that is a previous run's that had this pid.
  const graceMs = exitGraceMs();
  if (graceMs === undefined) writeSync(2, `\nnpm test: the run's idle limit leaves no room for an exit grace; hangs in a file's exit go to the idle limit\n`);
  // Set by the idle watchdog before it kills anything, and before the directory goes, so the exit guard's last tick does not report it missing.
  const stop = new Int32Array(new SharedArrayBuffer(4));
  // No inherited execArgv: the runner's own `--test …` or `-e` would make the worker something else.
  const watch = new Worker(new URL("./runWatch.mjs", import.meta.url), { execArgv: [], workerData: { heartbeat, idleMs: runIdleMs(), markers, stop } });
  watch.unref();
  const since = Math.floor(performance.timeOrigin);
  const exitWatch =
    graceMs === undefined
      ? undefined
      : new Worker(new URL("./exitWatch.mjs", import.meta.url), { execArgv: [], workerData: { markers, graceMs, since, stop } });
  exitWatch?.unref();
  const tell = () => watch.postMessage([...inFlight].map((f) => path.relative(process.cwd(), f)));
  try {
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
  } finally {
    Atomics.store(stop, 0, 1);
    void watch.terminate();
    void exitWatch?.terminate();
    rmSync(markers, { recursive: true, force: true });
  }
  const perDir = new Map();
  for (const file of ran) {
    const dir = path.relative(process.cwd(), path.dirname(file)).split(path.sep).join("/");
    perDir.set(dir, (perDir.get(dir) ?? 0) + 1);
  }
  for (const [dir, count] of [...perDir].sort()) yield `test files run in ${dir}: ${count}\n`;

  // In `node --test`, everything after the executable is a file argument; the flags are execArgv.
  const missing = loaded.size === 0 ? ["(no test file loaded at all)"] : unloaded([...loaded], process.cwd(), process.argv.slice(1));
  for (const file of missing) yield `test file never loaded: ${file}\n`;
  if (missing.length > 0) process.exitCode = 1;
}

const isWild = (/** @type {string} */ s) => /[*?[\]{}]/.test(s);

/** A path to one test file; a glob or a directory names whatever its root holds. */
const namesOneFile = (/** @type {string} */ arg, /** @type {string} */ cwd) =>
  !isWild(arg) && !statSync(path.resolve(cwd, arg), { throwIfNoEntry: false })?.isDirectory();

const posix = (/** @type {string} */ f) => f.split(path.sep).join("/");
const within = (/** @type {string} */ f, /** @type {string} */ dir) => dir === "" || f === dir || f.startsWith(`${dir}/`);

/**
 * The directory a glob or directory argument holds: its segments before the first wildcard, so
 * `tests/tooling/**` answers for tests/tooling, and `tests/{a,b}/**` still for the whole of tests.
 */
const rootOf = (/** @type {string} */ arg, /** @type {string} */ cwd) => {
  const segments = posix(path.relative(cwd, path.resolve(cwd, arg))).split("/");
  const wild = segments.findIndex(isWild);
  return segments.slice(0, wild === -1 ? segments.length : wild).filter(Boolean).join("/");
};

/**
 * @param {string[]} loaded absolute paths
 * @param {string[]} args the runner's file arguments
 */
export function unloaded(loaded, cwd = process.cwd(), args = []) {
  const rel = loaded.map((f) => posix(path.relative(cwd, f)));
  const files = args.filter((a) => namesOneFile(a, cwd)).map((a) => posix(path.relative(cwd, path.resolve(cwd, a))));
  const touched = ROOTS.filter((root) => rel.some((f) => within(f, root)));
  const dirs =
    args.length === 0
      ? touched
      : args
          .filter((a) => !namesOneFile(a, cwd))
          .map((a) => rootOf(a, cwd))
          .flatMap((g) => [...touched.filter((root) => within(root, g)), ...(ROOTS.some((root) => within(g, root)) ? [g] : [])]);
  const held = dirs.flatMap((dir) =>
    existsSync(path.join(cwd, dir))
      ? readdirSync(path.join(cwd, dir), { recursive: true, encoding: "utf8" })
          .map((f) => `${dir}/${posix(f)}`)
          .filter((f) => f.endsWith(".test.ts"))
      : [`${dir}/ (no such directory)`]
  );
  return [...new Set([...files, ...held])].filter((f) => !rel.includes(f));
}
