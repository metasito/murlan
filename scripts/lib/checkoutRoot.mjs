import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * The shared checkout's root, whichever worktree `from` is in. `--git-common-dir`, never
 * `--show-toplevel` (RULES.md rule 10): the latter answers with the linked worktree.
 */
export function checkoutRoot(from = process.cwd()) {
  const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: from,
    encoding: "utf8",
  }).trim();
  return path.dirname(gitDir);
}
