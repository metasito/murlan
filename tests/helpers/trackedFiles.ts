import { execFileSync } from "node:child_process";

/**
 * The repo-root files git tracks, as bare names.
 *
 * Not `readdirSync(repoRoot)`: `tests/checkStrictIndexed.test.ts` writes and
 * deletes `scratch.strictIndexed.*.json` in the repo root, and under
 * `node --test`'s parallel file execution another file's listing and that
 * cleanup interleave — the name is listed, then read after it is gone (#999).
 * git's index cannot hold a file nobody committed, so the race is gone by
 * construction rather than avoided by timing.
 */
export function trackedRootFiles(repoRoot: string): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ":(glob)*"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}
