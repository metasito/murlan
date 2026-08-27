// Whether a change can reach the jest projects, which run everything under
// tests/native/**. Those tests import from lib/, context/, components/,
// shared/, locales/ and app/, so naming the directories that *do* reach them
// would be a list to keep in step with every new import. This names the ones
// that cannot instead, and anything unrecognised runs the suite — the same
// direction .github/workflows/ci.yml's `scope` job fails in.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Nothing under these is importable from tests/native/**. */
const NATIVE_BLIND = [
  /^server\//,
  /^docs\//,
  /^\.github\//,
  /^\.claude\//,
  /^scripts\//,
  // Every other suite, but not the native one itself.
  /^tests\/(?!native\/)/,
  /\.md$/,
];

/** @param {string[]} paths @returns {boolean} */
export function reachesNative(paths) {
  return paths.some((p) => !NATIVE_BLIND.some((blind) => blind.test(p)));
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Everything this branch would push: what it has committed since it left
 * `origin/main`, plus whatever is still uncommitted.
 * @returns {string[]}
 */
export function changedPaths() {
  const base = git("merge-base", "origin/main", "HEAD").trim();
  const committed = git("diff", "--name-only", base, "HEAD").split("\n");
  const working = git("status", "--porcelain")
    .split("\n")
    .map((line) => line.slice(3).trim())
    // A rename reads as `old -> new`; the new path is the one that can break a test.
    .map((p) => (p.includes(" -> ") ? p.split(" -> ")[1] : p));
  return [...new Set([...committed, ...working].map((p) => p.replace(/^"|"$/g, "")))].filter(Boolean);
}

/**
 * @param {string[]} [paths] defaults to what this branch would push
 * @returns {{ run: boolean, reason: string }} `run: true` whenever the answer
 * is not provably no, including when the changed paths cannot be read at all.
 */
export function nativeScope(paths) {
  let files = paths;
  if (!files) {
    try {
      files = changedPaths();
    } catch (err) {
      return { run: true, reason: `could not tell what changed (${err.message})` };
    }
  }
  if (files.length === 0) return { run: false, reason: "nothing has changed" };
  const reaching = files.filter((p) => !NATIVE_BLIND.some((blind) => blind.test(p)));
  return reaching.length > 0
    ? { run: true, reason: `${reaching.length} changed path(s) reach it, e.g. ${reaching[0]}` }
    : { run: false, reason: `all ${files.length} changed path(s) are outside its reach` };
}

export function isInvokedDirectly(argv1, moduleUrl) {
  return Boolean(argv1) && pathToFileURL(path.resolve(argv1)).href === moduleUrl;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const { run, reason } = nativeScope();
  console.log(`${run ? "run" : "skip"}: ${reason}`);
}
