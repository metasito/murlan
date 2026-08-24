// lib/ticketPipeline/cleanup.ts
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface RunState {
  worktreePath: string | null;
  dockerStarted: boolean;
  localBranch: string | null;
  merged: boolean;
  ports?: number[];
  platform?: string;
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

// Windows and a Linux userspace share no port-freeing command: netstat/taskkill do not exist in
// the WSL distro, and lsof is not on Git Bash's PATH. `env MSYS_NO_PATHCONV=1` is what stops Git
// Bash rewriting taskkill's /PID into a path — an assignment prefixed to the pipeline's first
// command would reach netstat, not the taskkill that needs it. Both arms free nothing and exit 0
// when the port is unbound, which is the case the pipeline hits on almost every run.
function freePort(port: number, platform: string): string {
  return platform === "win32"
    ? `netstat -ano | grep -E ":${port}[[:space:]]" | awk '{print $5}' | sort -u | ` +
        `xargs -r -I% env MSYS_NO_PATHCONV=1 taskkill /PID % /F`
    : `lsof -ti tcp:${port} | xargs -r kill -9`;
}

// A port reaches this module as JSON on stdin and leaves it inside a shell command, so it is
// checked rather than quoted: anything not a plain TCP port number is dropped, not escaped.
function tcpPorts(ports: number[] | undefined): number[] {
  return (ports ?? []).filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
}

export function buildCleanupCommands(state: RunState): string[] {
  const commands: string[] = [];
  if (state.worktreePath) {
    commands.push(`git worktree remove ${state.worktreePath} --force`);
  }
  if (state.dockerStarted) {
    commands.push("docker rm -f murlan-verify-pg");
    // --rm removes this one on a clean exit; a run that died mid-poll leaves it holding BOOT_PORT.
    commands.push("docker rm -f murlan-verify-boot");
  }
  for (const port of tcpPorts(state.ports)) {
    commands.push(freePort(port, state.platform ?? process.platform));
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
