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
 * `tests/tooling/checkStrictIndexed.test.ts` writes and deletes in the repo root —
 * where a directory listing races them under `node --test`'s parallel files.
 */
export function trackedRootFiles(repoRoot: string): string[] {
  return trackedFiles(repoRoot, ":(glob)*");
}

/**
 * Doc scans leave out `.claude/skills/` (vendored upstream, never this repo's own claim) and a
 * dated plan under `docs/plans/` (a record of the tree it was written against: a later move leaves
 * its paths and commands stale by design).
 */
export function isRecordedExclusion(file: string): boolean {
  return file.startsWith(".claude/skills/") || /^docs\/plans\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/.test(file);
}
