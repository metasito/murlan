// lib/ticketPipeline/cleanup.ts
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface RunState {
  worktreePath: string | null;
  dockerStarted: boolean;
  localBranch: string | null;
  merged: boolean;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// Whether the branch still holds work is live git state, so the decision has to reach the agent
// as a command rather than a boolean this function could compute. `rev-list --count` is what
// makes it fail closed: any error — origin/main unfetched, branch never created — prints nothing
// to stdout, and "" is not "0", so the delete arm is never taken on a check that could not run.
function deleteBranchUnlessItHoldsWork(branch: string): string {
  const b = shellQuote(branch);
  return (
    `if test "$(git rev-list --count origin/main..${b} 2>/dev/null)" = "0"; ` +
    `then git branch -D ${b}; ` +
    `else echo "kept ${b}: it holds commits origin/main does not, or the comparison could not run"; fi`
  );
}

export function buildCleanupCommands(state: RunState): string[] {
  const commands: string[] = [];
  if (state.worktreePath) {
    commands.push(`git worktree remove ${state.worktreePath} --force`);
  }
  if (state.dockerStarted) {
    commands.push("docker rm -f murlan-verify-pg");
  }
  if (state.localBranch && !state.merged) {
    commands.push(deleteBranchUnlessItHoldsWork(state.localBranch));
  }
  commands.push("git status --short");
  return commands;
}

// Input arrives on stdin, never as an argv token: a caller's shell layer collapses the `\\`
// that JSON.stringify emits for a literal backslash, which makes the payload unparseable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(readFileSync(0, "utf8").trim() || "{}");
  process.stdout.write(JSON.stringify(buildCleanupCommands(input)));
}
