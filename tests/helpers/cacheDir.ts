import { execFileSync } from "node:child_process";
import path from "node:path";

/** A content-keyed cache's directory, in the install every worktree shares (docs/agents/RULES.md rule 10). */
export function cacheDir(name: string): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  return path.join(path.dirname(common), "node_modules", ".cache", name);
}
