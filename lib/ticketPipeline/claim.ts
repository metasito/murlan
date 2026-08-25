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
export function wonTheClaim(comments: Comment[], ourBranch: string): { won: boolean; reason: string } {
  const claims = comments
    .map((c) => ({ branch: CLAIM_RE.exec(c.body)?.[1], at: c.createdAt }))
    .filter((c): c is { branch: string; at: string } => Boolean(c.branch));

  const ours = claims.find((c) => c.branch === ourBranch);
  if (!ours) return { won: false, reason: "our own claim comment is not on the issue" };

  const older = claims.find((c) => c.branch !== ourBranch && c.at <= ours.at);
  if (older) return { won: false, reason: `already claimed by \`${older.branch}\` at ${older.at}` };

  return { won: true, reason: "claim is the oldest on the issue" };
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function claimTicket(repo: string, number: number, branch: string): ClaimResult {
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

  const { won, reason } = wonTheClaim(comments, branch);
  return { claimed: won, number, branch, reason };
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
