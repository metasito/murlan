import { execFileSync } from "node:child_process";

// Read once at process startup. The dev-sync hook always restarts this
// process (via scripts/dev-workflow-supervisor.mjs) after fast-forwarding
// the checkout, so a value captured at boot accurately reflects what is
// actually running — no need to re-exec git on every request.
function readCommitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

export const runningCommitSha = readCommitSha();
