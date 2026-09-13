import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The files git tracks under `pathspec`, as repo-relative paths, minus any
 * deleted from the working tree — the index lists those and a reader of the
 * list would open them.
 */
export function trackedFiles(repoRoot: string, ...pathspec: string[]): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ...pathspec], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter((f) => f && existsSync(path.join(repoRoot, f)));
}

/**
 * The repo-root files git tracks.
 *
 * Not `readdirSync(repoRoot)`: git's index cannot hold a file nobody added, so
 * a listing taken from it cannot name the scratch tsconfigs
 * `tests/checkStrictIndexed.test.ts` writes and deletes in the repo root —
 * where a directory listing races them under `node --test`'s parallel files.
 */
export function trackedRootFiles(repoRoot: string): string[] {
  return trackedFiles(repoRoot, ":(glob)*");
}
