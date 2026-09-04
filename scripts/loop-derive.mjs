/**
 * Where the loop's run stands, derived from git and the tracker rather than remembered.
 *
 * There used to be a state file. Every serious defect two audits found was in it and not in the
 * loop: it was tracked, so a run made the tree dirty and the next run deadlocked on preflight; it
 * was never cleared between tickets, so ticket two inherited ticket one's `VERDICT: LAND` and would
 * have pushed unreviewed work; it was read by two parsers that disagreed; its own template hints
 * were read as evidence. All of them were the same bug — a third copy of the truth, disagreeing
 * with the two systems that already held it.
 *
 * Git knows the branch, the commits and the diff. The tracker knows the ticket and the review. So
 * nothing here is stored, and nothing can go stale: every answer is computed from those two, every
 * time it is asked.
 *
 * The branch name is the binding. `agent/<n>-<slug>` says which ticket this work belongs to, and
 * git will not let you be on two at once.
 */
import { execFileSync } from "node:child_process";

export const BRANCH = /^agent\/(\d+)-/;

const run = (file, args, cwd) => execFileSync(file, args, { encoding: "utf8", cwd }).trim();

/** @returns {string|null} */
export function currentBranch(cwd) {
  try {
    return run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  } catch {
    return null;
  }
}

export function ticketOf(branch) {
  const m = BRANCH.exec(branch ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * The review is a comment on the issue, and it names the commit it read. That binding is what
 * makes it impossible to land a diff nobody reviewed: commit again after the review and the head
 * moves, so the verdict no longer matches and the gate asks for another one.
 *
 * @param {{body: string}[]} comments
 * @param {string} head
 */
export function verdictFor(comments, head) {
  const short = head.slice(0, 7);
  for (let i = comments.length - 1; i >= 0; i--) {
    const m = /^VERDICT:\s*(LAND|HOLD)\b[^\n]*?\b([0-9a-f]{7,40})\b/im.exec(comments[i].body ?? "");
    if (!m) continue;
    if (!head.startsWith(m[2]) && !m[2].startsWith(short)) continue;
    return { decision: m[1].toUpperCase(), line: m[0].trim() };
  }
  return null;
}

/**
 * The issue's comments, as `gh` returns them.
 *
 * `LOOP_GH_SCRIPT` names a node script to run instead, and exists only so the tests can drive the
 * verdict branches through the real binary. It cannot be a `gh` shim on PATH: since the 2024
 * fix for CVE-2024-27980, node will not resolve a `.cmd` from `execFileSync`, so on Windows a
 * stub is unreachable and the only testable review state is "tracker unreadable" — which is how
 * a mutant that lands a HOLD passed every test in the previous suite.
 */
function readComments(ticket, cwd) {
  const args = ["issue", "view", String(ticket), "--json", "comments"];
  const script = process.env.LOOP_GH_SCRIPT;
  return script ? run(process.execPath, [script, ...args], cwd) : run("gh", args, cwd);
}

/** Everything the loop needs to know about where it is. No arguments, no memory. */
export function derive({ cwd = undefined, base = "origin/main" } = {}) {
  const branch = currentBranch(cwd);
  const ticket = ticketOf(branch);
  if (!ticket) return { onTicket: false, branch, phase: "A", why: "not on an agent branch" };

  let head = null;
  let commits = 0;
  let changed = [];
  try {
    head = run("git", ["rev-parse", "HEAD"], cwd);
    commits = Number(run("git", ["rev-list", "--count", `${base}..HEAD`], cwd));
    changed = run("git", ["diff", "--name-only", `${base}...HEAD`], cwd).split("\n").filter(Boolean);
  } catch {
    return { onTicket: true, ticket, branch, phase: "?", why: `cannot read history against ${base}` };
  }

  let comments = [];
  let trackerReadable = true;
  try {
    comments = JSON.parse(readComments(ticket, cwd)).comments;
  } catch {
    trackerReadable = false;
  }

  const verdict = trackerReadable ? verdictFor(comments, head) : null;
  const phase = commits === 0 ? "C" : !verdict ? "D" : verdict.decision === "LAND" ? "E" : "C";

  return {
    onTicket: true,
    ticket,
    branch,
    head,
    commits,
    changed,
    trackerReadable,
    verdict,
    phase,
    why:
      commits === 0
        ? "nothing committed yet"
        : !trackerReadable
          ? "cannot reach the tracker to read the review"
          : !verdict
            ? `no review of ${head?.slice(0, 7)} on the issue`
            : verdict.decision === "LAND"
              ? "reviewed and cleared"
              : "the reviewer held it",
  };
}
