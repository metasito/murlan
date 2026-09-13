// tools/loop/land.ts

export interface PrState {
  state: string;
  mergeStateStatus: string;
  mergeable: string;
}

export interface CiVerdict {
  pass?: boolean;
  infrastructure?: boolean;
  failedStep?: string;
  output?: string;
}

export type Landing =
  | { action: "merge"; reason: string }
  | { action: "already-merged"; reason: string }
  | { action: "update-branch"; reason: string }
  | { action: "recheck"; reason: string }
  /** CI is red and a fresh session can fix it. */
  | { action: "hand-back"; reason: string }
  /** Only a person can move this. */
  | { action: "owner"; reason: string };

/**
 * What to do with a pushed pull request, over the pull request and the CI verdict together.
 *
 * Six arms rather than four, because the caller genuinely does something different for
 * `already-merged` (skip the merge call), `update-branch` (`gh pr update-branch`) and `recheck`
 * (wait and ask again) — collapsing them and re-splitting downstream rebuilds the same fan-out one
 * layer lower.
 *
 * Total by construction: every pair of inputs has an answer, and the answer for an input this
 * function does not recognise is to ask again rather than to assert anything about it.
 */
export function landing(pr: PrState, ci: CiVerdict): Landing {
  // Before CI is consulted at all. A merged branch's ci.yml run commonly reads `cancelled` — the
  // concurrency group stops it when the merge lands — and there is nothing left to fix on a branch
  // whose work is on main.
  if (pr.state === "MERGED") {
    return { action: "already-merged", reason: "the pull request is already merged" };
  }
  if (pr.state === "CLOSED") {
    return { action: "owner", reason: "the pull request was closed without merging" };
  }
  // An unrecognised state is a reading, not a verdict.
  if (pr.state !== "OPEN") {
    return { action: "recheck", reason: `the pull request state reads ${pr.state}` };
  }

  // Ahead of both CI checks on purpose. A fix round rebuilds the worktree from the branch and
  // commits to it, which cannot clear a conflict with main; and rechecking cannot either, so a
  // conflict read as an infrastructure stall spends every retry round and then tells the owner the
  // runner is sick. ci.yml's concurrency group cancels a superseded push, and a cancelled run is
  // exactly what `infrastructure` means.
  if (pr.mergeable === "CONFLICTING") {
    return { action: "owner", reason: "the branch conflicts with main" };
  }

  // Billing, a quota or a runner. It says nothing about the diff, so a fix round spent on it hunts
  // a defect no suite ever reported.
  if (ci.infrastructure) {
    return { action: "recheck", reason: "a job completed having run zero steps" };
  }

  if (ci.pass !== true) {
    return { action: "hand-back", reason: `CI failed at ${ci.failedStep ?? "an unnamed step"}` };
  }

  // GitHub computes mergeability in a background job it starts when asked, and the documented
  // remedy is to ask again. A merged pull request answers UNKNOWN on both fields too, which is why
  // `state` is read first.
  if (pr.mergeable === "UNKNOWN" || pr.mergeStateStatus === "UNKNOWN") {
    return { action: "recheck", reason: "GitHub is still computing mergeability" };
  }

  // Main moved: merging now builds a tree no run has tested. Updating first costs one run, not two.
  if (pr.mergeStateStatus === "BEHIND") {
    return { action: "update-branch", reason: "main moved; update the branch and read CI on that tree" };
  }

  // Reaching for `--admin` is a decision, not a step.
  if (pr.mergeStateStatus === "BLOCKED" || pr.mergeStateStatus === "DIRTY") {
    return { action: "owner", reason: `mergeStateStatus is ${pr.mergeStateStatus}` };
  }

  if (pr.mergeStateStatus === "CLEAN" || pr.mergeStateStatus === "HAS_HOOKS") {
    return { action: "merge", reason: `mergeStateStatus is ${pr.mergeStateStatus}` };
  }

  // UNSTABLE is "mergeable with non-passing commit status", and non-passing includes queued — gh
  // merges it on the spot either way. Reaching here means the verdict above passed the run for this
  // head, which is the only reading under which a pending check is ignorable.
  if (pr.mergeStateStatus === "UNSTABLE") {
    return { action: "merge", reason: "mergeStateStatus is UNSTABLE; ciVerdict already passed this head" };
  }

  // "I have never seen this value" is not a verdict, and a verdict here is a ticket nobody can pick
  // up again: the caller's stall path leaves `in-progress` on the issue.
  return { action: "recheck", reason: `unrecognised mergeStateStatus ${pr.mergeStateStatus}` };
}

/**
 * `--merge`, never `--squash`: the branch's own history is what a later bisect reads.
 * `--delete-branch` removes the remote copy, which nothing else does.
 */
export function mergeArgs(repo: string, prNumber: number): string[] {
  return ["pr", "merge", String(prNumber), "--repo", repo, "--merge", "--delete-branch"];
}

/**
 * Whether `git ls-remote origin <branch>` still finds the branch — RULES.md rule 14's confirmation
 * that `--delete-branch` took effect. A worktree still holding the local branch makes the delete
 * fail and the remote copy survives with it.
 *
 * Harmless over a merged branch; over an unmerged one it is #294, where a branch on origin with no
 * open pull request satisfies `issue-tracker.md`'s staleness test and the ticket can never be
 * picked up again.
 *
 * A string predicate: the caller owns the command.
 */
export function branchSurvives(lsRemoteStdout: string): boolean {
  return lsRemoteStdout.trim().length > 0;
}
