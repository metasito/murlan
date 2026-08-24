// lib/ticketPipeline/cleanup.ts
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface RunState {
  worktreePath: string | null;
  dockerStarted: boolean;
  localBranch: string | null;
  merged: boolean;
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
    commands.push(`git branch -D ${state.localBranch}`);
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
