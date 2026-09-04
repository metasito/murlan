// lib/loop/land.ts
import { execFileSync } from "node:child_process";

export interface PrState {
  mergeStateStatus: string;
  mergeable: string;
}

export type LandAction =
  | { action: "merge"; reason: string }
  | { action: "update-branch"; reason: string }
  | { action: "stop"; reason: string };

/**
 * What to do with a green pull request.
 *
 * BEHIND means main moved: merging then builds a tree no run has tested, and `ci.yml`'s scope job
 * stops skipping the main push, so the whole suite runs again and is billed again. Updating the
 * branch first costs one run instead of two.
 *
 * Anything conflicted or blocked stops rather than reaching for `--admin`: a merge that needs a
 * flag to force it is a decision, not a step.
 */
export function decideLanding(pr: PrState): LandAction {
  if (pr.mergeable === "CONFLICTING") {
    return { action: "stop", reason: "the branch conflicts with main and needs a human" };
  }
  if (pr.mergeStateStatus === "BEHIND") {
    return { action: "update-branch", reason: "main moved; update the branch and let it go green on that tree" };
  }
  if (pr.mergeStateStatus === "BLOCKED" || pr.mergeStateStatus === "DIRTY") {
    return { action: "stop", reason: `mergeStateStatus is ${pr.mergeStateStatus}` };
  }
  if (pr.mergeStateStatus === "CLEAN" || pr.mergeStateStatus === "UNSTABLE" || pr.mergeStateStatus === "HAS_HOOKS") {
    return { action: "merge", reason: `mergeStateStatus is ${pr.mergeStateStatus}` };
  }
  return { action: "stop", reason: `unrecognised mergeStateStatus ${pr.mergeStateStatus}` };
}

/**
 * `--merge`, never `--squash`: the branch's own history is what a later bisect reads.
 * `--delete-branch` removes the remote copy, which nothing else does.
 */
export function mergeArgs(repo: string, prNumber: number): string[] {
  return ["pr", "merge", String(prNumber), "--repo", repo, "--merge", "--delete-branch"];
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

if (process.argv[1]?.endsWith("land.ts")) {
  const [repo, prNumber] = process.argv.slice(2);
  if (!repo || !prNumber) {
    console.error("usage: npx tsx lib/loop/land.ts <repo> <prNumber>");
    process.exit(1);
  }
  const pr: PrState = JSON.parse(
    gh(["pr", "view", prNumber, "--repo", repo, "--json", "mergeStateStatus,mergeable"])
  );
  const decision = decideLanding(pr);
  if (decision.action === "merge") {
    gh(mergeArgs(repo, Number(prNumber)));
    process.stdout.write(JSON.stringify({ merged: true, prNumber: Number(prNumber), reason: decision.reason }));
  } else {
    process.stdout.write(
      JSON.stringify({ merged: false, prNumber: Number(prNumber), next: decision.action, reason: decision.reason })
    );
  }
}
