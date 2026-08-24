// lib/ticketPipeline/cleanup.ts
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(process.argv[2] ?? "{}");
  process.stdout.write(JSON.stringify(buildCleanupCommands(input)));
}
