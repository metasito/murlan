// lib/ticketPipeline/claim.ts
import { execFileSync } from "node:child_process";

export interface Comment {
  body: string;
  createdAt: string;
}

export interface ClaimResult {
  claimed: boolean;
  number: number;
  branch: string;
  reason: string;
}

const CLAIM_RE = /Claimed by `([^`]+)`/;

export function claimBody(branch: string): string {
  return `Claimed by \`${branch}\`.`;
}

/**
 * Whether this session won the claim, read back from the issue's own comments.
 *
 * Two sessions can list the same free queue a second apart, so writing the claim is not winning
 * it: the comment written first wins, and the loser stands down. An assignee cannot decide this —
 * every session authenticates as the same account.
 *
 * Ties go to standing down. A claim whose timestamp matches ours to the second is ambiguous, and
 * taking the ticket on a coin-flip is how two sessions push the same branch.
 */
export function wonTheClaim(
  comments: Comment[],
  ourBranch: string,
  /**
   * Whether another session's branch still exists. A run that died before pushing leaves its claim
   * comment behind for ever, and read as a claim it takes the ticket out of the queue permanently:
   * #278 carried three, from three crashed runs, and every later run stood down to a session that
   * had not existed for hours. `scripts/next-ticket.mjs` already tests this before offering a
   * ticket, so without it here the router and the claimer disagree about the same issue.
   *
   * Defaults to treating every claim as live, which is the safe answer when nobody can say.
   */
  isLive: (branch: string) => boolean = () => true
): { won: boolean; reason: string } {
  const claims = comments
    .map((c) => ({ branch: CLAIM_RE.exec(c.body)?.[1], at: c.createdAt }))
    .filter((c): c is { branch: string; at: string } => Boolean(c.branch));

  const ours = claims.find((c) => c.branch === ourBranch);
  if (!ours) return { won: false, reason: "our own claim comment is not on the issue" };

  const older = claims.find((c) => c.branch !== ourBranch && c.at <= ours.at && isLive(c.branch));
  if (older) return { won: false, reason: `already claimed by \`${older.branch}\` at ${older.at}` };

  return { won: true, reason: "no live claim is older than ours" };
}

/**
 * Fails closed: a branch nobody can ask about counts as alive, because standing down from a ticket
 * somebody is working on costs a run, and taking one costs two sessions pushing the same branch.
 */
export function branchLivesOnOrigin(branch: string): boolean {
  try {
    return gh0(["ls-remote", "--heads", "origin", branch]).trim().length > 0;
  } catch {
    return true;
  }
}

function gh0(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function claimTicket(repo: string, number: number, branch: string): ClaimResult {
  // Read before writing, so a stand-down can tell a label it added from one that was already
  // there. Removing somebody else's `in-progress` would clear their claim; leaving our own takes
  // the ticket out of the queue for good, because `classify()` skips it from then on.
  const wasInProgress = labelsOn(repo, number).includes("in-progress");

  try {
    gh(["issue", "edit", String(number), "--repo", repo, "--add-label", "in-progress"]);
    gh(["issue", "comment", String(number), "--repo", repo, "--body", claimBody(branch)]);
  } catch (err) {
    return { claimed: false, number, branch, reason: `could not write the claim: ${(err as Error).message}` };
  }

  let comments: Comment[] = [];
  try {
    comments = JSON.parse(gh(["issue", "view", String(number), "--repo", repo, "--json", "comments", "--jq", ".comments"]));
  } catch (err) {
    return { claimed: false, number, branch, reason: `could not read the claim back: ${(err as Error).message}` };
  }

  const { won, reason } = wonTheClaim(comments, branch, branchLivesOnOrigin);
  if (!won && !wasInProgress) {
    try {
      gh(["issue", "edit", String(number), "--repo", repo, "--remove-label", "in-progress"]);
    } catch {
      // Reported through `reason`; the label is the caller's problem to notice, not a crash.
    }
  }
  return { claimed: won, number, branch, reason };
}

function labelsOn(repo: string, number: number): string[] {
  try {
    return JSON.parse(
      gh(["issue", "view", String(number), "--repo", repo, "--json", "labels", "--jq", "[.labels[].name]"])
    ) as string[];
  } catch {
    // Unreadable: assume it was already there, so a stand-down never removes a label it cannot
    // prove it added.
    return ["in-progress"];
  }
}

export function releaseTicket(repo: string, number: number, why: string): void {
  // `ready-for-agent` comes off with the release. Left on beside `ready-for-human`, the router's
  // frontier takes the ticket straight back and every later run re-escalates it.
  gh([
    "issue", "edit", String(number), "--repo", repo,
    "--remove-label", "in-progress",
    "--remove-label", "ready-for-agent",
    "--add-label", "ready-for-human",
  ]);
  gh(["issue", "comment", String(number), "--repo", repo, "--body", why]);
}

if (process.argv[1]?.endsWith("claim.ts")) {
  const [action, repo, number, rest] = process.argv.slice(2);
  if (action === "claim") {
    process.stdout.write(JSON.stringify(claimTicket(repo, Number(number), rest)));
  } else if (action === "release") {
    releaseTicket(repo, Number(number), rest);
    process.stdout.write(JSON.stringify({ released: true, number: Number(number) }));
  } else {
    console.error("usage: npx tsx lib/ticketPipeline/claim.ts claim|release <repo> <number> <branch|reason>");
    process.exit(1);
  }
}
