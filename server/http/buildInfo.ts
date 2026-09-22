import { execFileSync } from "node:child_process";

// Read once at process startup: a checkout only changes under a restarted process,
// so the boot value is what is running.
export const runningCommitSha = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
})();
