/**
 * Every `git` and `gh` the loop runs, under one buffer, timeout and stderr policy. The hooks import
 * it too, so it stays free of anything heavier than `node:child_process`.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testSeams } from "./session-env.mjs";

/**
 * The repository every `gh` call in the loop names, so no two of them can name different ones. It
 * reaches gh as `GH_REPO`, which gh reads before the cwd's remotes, so a call made from any directory
 * — or one that forgets `--repo` — still names this one.
 */
export const REPO = "metasito/murlan";

/**
 * `gh run view --log-failed` for a browser-test job runs to several megabytes, and
 * `execFileSync`'s default 1MB buffer turns that into an ENOBUFS throw rather than a short read.
 */
export const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * `testSeams()`'s `ghScript` / `gitScript` name a node script to run instead of the binary, so a test can
 * drive a caller through its real process. It cannot be a shim on PATH: since the fix for
 * CVE-2024-27980, node will not resolve a `.cmd` from `execFileSync`, so on Windows a stub is unreachable.
 *
 * stderr is captured, never printed, unless `stderr: "ignore"`: a failure carries it on `err.stderr`
 * and in `err.message`. A `timeout` is floored at 1ms, since node reads zero or less as "none".
 *
 * @typedef {{cwd?: string, timeout?: number, stderr?: "pipe"|"ignore", maxBuffer?: number, encoding?: "utf8"|"buffer"}} RunOptions
 * @param {"git"|"gh"} tool
 * @param {string[]} args
 * @param {RunOptions} [opts]
 * @returns {string}
 */
function run(tool, args, { cwd, timeout, stderr = "pipe", maxBuffer = MAX_BUFFER, encoding = "utf8" } = {}) {
  const script = testSeams()[`${tool}Script`];
  return execFileSync(script ? process.execPath : tool, script ? [script, ...args] : args, {
    encoding,
    cwd,
    ...(tool === "gh" ? { env: { ...process.env, GH_REPO: REPO } } : {}),
    stdio: ["ignore", "pipe", stderr],
    maxBuffer,
    timeout: timeout === undefined ? undefined : Math.max(1, timeout),
  });
}

/** `git(cwd)(args, opts)`: stdout, untrimmed. A non-zero exit throws. */
export const git =
  (/** @type {string} [cwd] */ cwd) =>
  (/** @type {string[]} */ args, /** @type {RunOptions} */ opts = {}) =>
    run("git", args, { ...opts, cwd });

/** stdout, untrimmed. A non-zero exit throws. */
export const gh = (/** @type {string[]} */ args, /** @type {RunOptions} */ opts = {}) => run("gh", args, opts);

/** The exit status of `call`, which throws on failure: `null` when it never exited (a timeout, no binary). */
export function statusOf(call) {
  try {
    call();
    return 0;
  } catch (err) {
    return typeof err?.status === "number" ? err.status : null;
  }
}

/** What went wrong in one line: the tool's own stderr when it said anything, else the error. */
export const firstLine = (err) => String(err?.stderr?.trim() || err?.message || err).trim().split("\n")[0];

/**
 * The shared checkout's root, whichever worktree `from` is in. `--git-common-dir`, never
 * `--show-toplevel` (RULES.md rule 10): the latter answers with the linked worktree. Asked from
 * this file's own directory by default, so the answer does not depend on where a caller started.
 */
export const checkoutRoot = (from = path.dirname(fileURLToPath(import.meta.url))) =>
  path.dirname(git(from)(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
