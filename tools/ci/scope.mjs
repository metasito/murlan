/**
 * Which suites a change runs, for ci.yml's scope job: `node tools/ci/scope.mjs <base>` prints
 * `app=`, `harness=`, `scans=` and `native=` lines for `$GITHUB_OUTPUT`. It runs before any
 * `npm ci`, so it imports only `node:` modules and repository files that do the same. The decision
 * itself is tools/ci/scopeOf.mjs's.
 */
import { readFileSync } from "node:fs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { changedFiles, git } from "../loop/cli.mjs";
import { needsNative, patchReader } from "./nativeScope.mjs";
import { scopeOf } from "./scopeOf.mjs";

export { ASSERTED_PROSE, HARNESS, PROSE, QUEUE_LOOP_TESTS, scopeOf } from "./scopeOf.mjs";

/** From `base` itself, not the merge base: a push's `before` is the commit it replaced. */
export const SCOPE_CHANGES = Object.freeze({ range: "..", worktree: false, untracked: false });

const EVERYTHING = { app: true, harness: true, scans: true, native: true };

/** @param {string} base */
export function scopeAt(base, at = git()) {
  try {
    const changed = changedFiles(at, { ...SCOPE_CHANGES, base });
    process.stderr.write(`Changed files:\n${changed.join("\n")}\n`);
    const before = changed.includes("package.json") ? at(["show", `${base}:package.json`]) : "";
    const readPatch = patchReader((rev, f) => at(["show", `${rev}:${f}`]), base);
    return { ...scopeOf(changed), native: needsNative(changed, before, readFileSync("package.json", "utf8"), readPatch) };
  } catch (err) {
    process.stderr.write(`No change set from ${base} — running everything: ${err?.message ?? err}\n`);
    return EVERYTHING;
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const scope = process.argv[2] ? scopeAt(process.argv[2]) : EVERYTHING;
  for (const [key, value] of Object.entries(scope)) console.log(`${key}=${value}`);
}
