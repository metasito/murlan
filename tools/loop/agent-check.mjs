/**
 * The pre-push check. A clean tree's verdict is keyed on HEAD's sha, so an unchanged commit
 * replays instead of re-running; a tree with anything uncommitted always runs and records nothing.
 *
 * Usage: npm run agent:check          run, or replay a cached verdict
 *        npm run agent:check -- --force   ignore the cache
 */
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkLockDrift, parseWorktreeList } from "./workspace.mjs";
import { STEPS, LOCAL, DELEGATED, cmd, BANNER } from "./check-steps.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import preflightMemory from "../ci/preflightMemory.mjs";

/**
 * A subject with nothing in it is a refusal rather than a pass: a check looking at no diff has
 * nothing its green could be a statement about.
 */
export function checkSubject({ toplevel, baseSha, changed }) {
  if (!toplevel) return { refuse: "no tree to judge — this is not inside a git worktree" };
  if (!baseSha) return { refuse: "no base to judge against — origin/main does not resolve" };
  if (!changed.trim()) {
    return {
      refuse: `nothing to judge in ${toplevel} — no commits against origin/main, nothing tracked changed`,
    };
  }
  return { root: toplevel, base: baseSha.slice(0, 7) };
}

/** Takes `cwd` rather than the process's own, so two worktrees can be tested as judged apart. */
export function readSubject(cwd) {
  const read = (...args) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch {
      return null;
    }
  };
  return checkSubject({
    toplevel: read("rev-parse", "--show-toplevel"),
    baseSha: read("rev-parse", "--verify", "origin/main"),
    // Untracked files are excluded: a scratch file is not a change any verdict could be about.
    changed: [
      read("diff", "--name-only", "origin/main...HEAD"),
      read("status", "--porcelain", "--untracked-files=no"),
    ].join("\n"),
  });
}

/** On Windows the kill reaches the shell, not the tree, so a stray child can outlive it. */
const STEP_TIMEOUT_MS = 20 * 60_000;
const SHOWN_LINES = 40;
const HEAD_LINES = 10;

/** @param {{failed: string[], head: string, clean: boolean, deferred?: string[]}} run */
export const cacheEntry = ({ failed, head, clean, deferred = [] }) => ({
  pass: failed.length === 0,
  at: new Date().toISOString(),
  failed,
  head,
  clean,
  deferred,
});

const passed = (entry) => entry?.pass === true && typeof entry.head === "string";

/** A pass that deferred a suite for memory is run again next time rather than replayed as whole. */
export const replays = (entry) => passed(entry) && !entry.deferred?.length;

/** What `loop-gate --build` asks: a LOCAL PASS judged on this head, from a tree with nothing uncommitted. */
export const cleanPassFor = (cache, head) =>
  Object.values(cache).find((e) => passed(e) && e.head === head && e.clean === true);

export function clip(output) {
  const lines = output.split("\n");
  if (lines.length <= SHOWN_LINES) return `${output}\n`;
  const head = lines.slice(0, HEAD_LINES);
  const tail = lines.slice(HEAD_LINES - SHOWN_LINES);
  return [...head, `… ${lines.length - SHOWN_LINES} lines omitted …`, ...tail, ""].join("\n");
}

const spawnAsync = (file, args, opts) =>
  new Promise((resolve) => {
    // One command line under `shell`: node joins them anyway, and passing both is DEP0190.
    const [cmdLine, argv] = opts.shell ? [[file, ...args].join(" "), []] : [file, args];
    execFile(cmdLine, argv, opts, (err, stdout, stderr) => {
      const status = err ? (typeof err.code === "number" ? err.code : null) : 0;
      const error = err?.killed ? { code: "ETIMEDOUT" } : status === null ? err : undefined;
      resolve({ status, stdout, stderr, error });
    });
  });

/**
 * The parent's environment minus npm's log level. `npm run -s` exports it as silent, and a step's
 * npm inherits that and prints nothing — so a failed step would be reported with no reason.
 */
export const stepEnv = (env = process.env) =>
  Object.fromEntries(Object.entries(env).filter(([k]) => k.toLowerCase() !== "npm_config_loglevel"));

export async function runStep(step, spawn = spawnAsync, write = (s) => void process.stdout.write(s)) {
  write(`▸ ${step.name} …\n`);
  const run = await spawn("npm", step.args, {
    encoding: "utf8",
    env: stepEnv(),
    shell: process.platform === "win32",
    timeout: STEP_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
  });
  // A timeout leaves `status` null and sets `error.code` to ETIMEDOUT. Only one of them says
  // anything about the code, so they are reported apart.
  const timedOut = run.error?.code === "ETIMEDOUT";
  const title = `${BANNER}${step.name} ===`;
  if (!timedOut && run.status === 0) return { failed: null, text: `${title} ok\n` };
  const shown = clip(`${run.stdout ?? ""}${run.stderr ?? ""}`.replace(/\n$/, ""));
  if (!timedOut) return { failed: step.name, text: `\n${title} FAILED\n${shown}` };
  return {
    failed: `${step.name} (timed out)`,
    text: `\n${title} FAILED\n${shown}${step.name} timed out after ${STEP_TIMEOUT_MS / 60_000} minutes\n`,
  };
}

/** The light steps at once; whole suites after them, one at a time, since they compete for memory. */
export async function runAll(local, run = runStep, roomFor = async () => true) {
  const runs = await Promise.all(local.filter((s) => !s.after).map((step) => run(step)));
  for (const step of local.filter((s) => s.after)) {
    // Without the memory it goes back to CI, where it always ran, and the verdict says so; failing
    // here would hold the build gate on the machine, not the code.
    if (await roomFor(step)) runs.push(await run(step));
    else runs.push({ failed: null, deferred: step, text: `${BANNER}${step.name} === deferred: not enough memory\n` });
  }
  return runs;
}

/**
 * HEAD alone would call an edited tree unchanged, which is the one case that must never replay a
 * stale pass — so only a clean tree has a key at all.
 */
export async function judge({ head, clean, force, cache, run }) {
  const key = clean ? head : null;
  if (key && !force && replays(cache[key])) return { replayed: cache[key] };
  const runs = await run();
  const entry = cacheEntry({
    failed: runs.flatMap((r) => (r.failed ? [r.failed] : [])),
    head,
    clean,
    deferred: runs.flatMap((r) => (r.deferred ? [r.deferred.name] : [])),
  });
  return { runs, entry, cache: key ? { ...cache, [key]: entry } : null };
}

let subject;
let deferred = [];

// Names the tree it read and every suite it left out: a verdict that does not say cannot be told
// from a vacuous one.
const verdict = (outcome) =>
  [
    outcome,
    `  judged:    ${subject.root} against origin/main@${subject.base}`,
    `  ran here:  ${ran().map((s) => s.name).join(", ")}`,
    `  NOT run:   ${skipped().length} suite(s) — a green line here stands for none of them`,
    ...skipped().map((s) => `  ci.yml ${s.job}:  ${cmd(s)}`),
  ].join("\n");

function ran() {
  return LOCAL.filter((s) => !deferred.includes(s));
}
function skipped() {
  return [...DELEGATED, ...deferred];
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function cachePath() {
  return path.join(git("rev-parse", "--absolute-git-dir").trim(), "agent-check-cache.json");
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  // Refused, not dropped: a mistyped flag that fell away would print the same LOCAL PASS.
  const unknown = process.argv.slice(2).filter((a) => a !== "--force");
  if (unknown.length) {
    console.error(`agent:check: unknown flag ${unknown.join(" ")}; the only one is --force`);
    process.exit(1);
  }
  subject = readSubject(process.cwd());
  if (subject.refuse) {
    console.error(`agent:check: ${subject.refuse}`);
    process.exit(1);
  }
  // HEAD, the cache and the steps must all read the judged tree, not the invoker's cwd.
  process.chdir(subject.root);

  // The cache key is HEAD only, so it cannot see a peer's `npm install` drifting node_modules.
  const sharedRoot = parseWorktreeList(git("worktree", "list", "--porcelain"))[0]?.path ?? null;
  if (!sharedRoot) {
    console.error("agent:check: could not find the primary worktree");
    process.exit(1);
  }
  const drift = checkLockDrift(sharedRoot);
  if (drift.length) {
    console.error(`\nagent:check  node_modules in ${sharedRoot} has drifted from package-lock.json:\n`);
    for (const d of drift) console.error(`  ${d.name}: installed ${d.installed}, locked ${d.locked}`);
    console.error(
      `\nRun \`npm ci\` in ${sharedRoot} before trusting this result — node_modules is shared live ` +
        `across every worktree: check no peer session is mid-run before reinstalling.`
    );
    process.exit(1);
  }

  const head = git("rev-parse", "HEAD").trim();
  const clean = git("status", "--porcelain").trim() === "";
  const roomFor = () => preflightMemory().then(() => true, () => false);
  const out = await judge({
    head,
    clean,
    force: process.argv.includes("--force"),
    cache: readCache(),
    run: () => runAll(LOCAL, runStep, roomFor),
  });

  if (out.replayed) {
    console.log(verdict(`agent:check  CACHED LOCAL PASS for ${head.slice(0, 7)} (${out.replayed.at})`));
    console.log("Nothing changed since that run. Use --force to run the suites anyway.");
    process.exit(0);
  }

  for (const run of out.runs) process.stdout.write(run.text);
  deferred = out.runs.flatMap((run) => (run.deferred ? [run.deferred] : []));
  // A failure is recorded too, and never replayed (`replays`): a red verdict replayed would tell an
  // agent its fix did not work.
  if (out.cache) fs.writeFileSync(cachePath(), JSON.stringify(out.cache, null, 2));

  const { failed } = out.entry;
  if (failed.length) {
    console.error(verdict(`\nagent:check  FAIL — ${failed.join(", ")}`));
    process.exit(1);
  }
  const what = clean ? head.slice(0, 7) : "uncommitted tree, not recorded";
  console.log(verdict(`\nagent:check  LOCAL PASS  (${what}) — ${ran().length} of ${STEPS.length} suites`));
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) main();
