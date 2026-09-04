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
import { basename } from "node:path";

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
 * Every worktree git knows about, as `{ dir, branch, detached }`.
 *
 * @param {string} [cwd]
 */
export function worktrees(cwd) {
  const out = run("git", ["worktree", "list", "--porcelain"], cwd);
  return out.split(/\n\s*\n/).filter(Boolean).map((block) => {
    const dir = /^worktree (.+)$/m.exec(block)?.[1] ?? null;
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
    return { dir, branch, detached: /^detached$/m.test(block) };
  });
}

/**
 * Which worktree the run is in — which is almost never the one the session is sitting in.
 *
 * The loop works in `.worktrees/agent-<n>` and RULES.md rule 40 forbids parking a shell there, so
 * reading `HEAD` at the process's own cwd answers for the shared checkout and reports "no run"
 * during every run. An audit caught exactly that: compaction recovery printed nothing and the
 * phase-E gate exited 2, on a live ticket. Git already lists every worktree and its branch, so ask
 * it rather than asking where we happen to be standing.
 *
 * A detached worktree (a conflicted rebase, an interrupted checkout) has no branch to read, so its
 * directory name carries the ticket and the caller is told the head is loose rather than told
 * nothing is happening.
 *
 * @param {string} [cwd]
 * @returns {{cwd: string|undefined, branch: string|null, ticket: number|null, detached: boolean}}
 */
export function locateRun(cwd) {
  const here = currentBranch(cwd);
  if (ticketOf(here)) return { cwd, branch: here, ticket: ticketOf(here), detached: false };

  // Only worktrees under the checkout's own `.worktrees/`, which is where phase A puts them. The
  // scan answers "is a run live", so it must not adopt an unrelated `agent/` branch someone left
  // checked out somewhere else on the disk and call it this session's run.
  let list = [];
  try {
    const top = run("git", ["rev-parse", "--show-toplevel"], cwd).replace(/\\/g, "/");
    const home = `${top}/.worktrees/`;
    list = worktrees(cwd).filter((w) => (w.dir ?? "").replace(/\\/g, "/").startsWith(home));
  } catch {
    return { cwd, branch: here, ticket: null, detached: here === "HEAD" };
  }

  const onBranch = list.filter((w) => ticketOf(w.branch));
  if (onBranch.length === 1) {
    const w = onBranch[0];
    return { cwd: w.dir, branch: w.branch, ticket: ticketOf(w.branch), detached: false };
  }
  if (onBranch.length > 1) {
    const w = onBranch[0];
    return { cwd: w.dir, branch: w.branch, ticket: ticketOf(w.branch), detached: false, many: onBranch.length };
  }

  const loose = list.find((w) => w.detached && /^agent-\d+$/.test(basename(w.dir ?? "")));
  if (loose) {
    return {
      cwd: loose.dir,
      branch: null,
      ticket: Number(basename(loose.dir).slice("agent-".length)),
      detached: true,
    };
  }
  return { cwd, branch: here, ticket: null, detached: here === "HEAD" };
}

/**
 * The review is a comment on the issue, and it names the commit it read. That binding is what
 * makes it impossible to land a diff nobody reviewed: commit again after the review and the head
 * moves, so the verdict no longer matches and the gate asks for another one.
 *
 * A HOLD on a head is final for that head. Order used to decide, so a later `LAND <same sha>` —
 * from a confused reviewer, or from the reviewer quoting its own instructions — erased a hold
 * nobody had addressed. The only way past a hold is a commit, which moves the head and asks for a
 * fresh review of the new code.
 *
 * `VERDICT:` is matched literally and fenced code is stripped first, so quoting the review prompt
 * or pasting a draft in a ``` block is not a review.
 *
 * @param {{body: string}[]} comments
 * @param {string} head
 */
export function verdictFor(comments, head) {
  const short = head.slice(0, 7);
  const covers = (sha) => head.startsWith(sha) || sha.startsWith(short);
  let land = null;
  for (let i = comments.length - 1; i >= 0; i--) {
    const body = (comments[i].body ?? "").replace(/```[\s\S]*?```/g, "");
    const m = /^VERDICT:\s*(LAND|HOLD)\b[^\n]*?\b([0-9a-f]{7,40})\b/m.exec(body);
    if (!m || !covers(m[2])) continue;
    if (m[1] === "HOLD") return { decision: "HOLD", line: m[0].trim() };
    land ??= { decision: "LAND", line: m[0].trim() };
  }
  return land;
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
  const file = process.env.LOOP_GH_SCRIPT;
  // stderr discarded: an unreachable tracker is reported as "cannot read the review", and `gh`'s
  // own GraphQL complaint printed mid-brief reads as the brief having failed.
  return execFileSync(file ? process.execPath : "gh", file ? [file, ...args] : args, {
    encoding: "utf8",
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * Everything the loop needs to know about where it is. No arguments, no memory.
 *
 * `LOOP_BASE` overrides what the diff is measured against, and is a test seam only: the tests run
 * against scratch worktrees that have no `origin/main`. It is deliberately not a command-line
 * flag — an audit passed `--base HEAD~1` and walked a `.github/workflows/` change straight through
 * the gate, because a documented flag is a mistake the loop can make by reading its own usage text.
 */
export function derive({ cwd = undefined, base = process.env.LOOP_BASE || "origin/main" } = {}) {
  const at = locateRun(cwd);
  if (at.detached && at.ticket) {
    return {
      onTicket: true,
      ticket: at.ticket,
      branch: null,
      cwd: at.cwd,
      phase: "?",
      why: `#${at.ticket}'s worktree is on a detached HEAD — a rebase or checkout left it without a branch`,
    };
  }
  if (!at.ticket) {
    const why = at.detached
      ? "HEAD is detached, so there is no branch to read a ticket from"
      : "not on an agent branch";
    return { onTicket: false, branch: at.branch, phase: "A", why };
  }
  const { ticket, branch } = at;
  cwd = at.cwd;

  let head = null;
  let commits = 0;
  let changed = [];
  let dirty = false;
  try {
    head = run("git", ["rev-parse", "HEAD"], cwd);
    commits = Number(run("git", ["rev-list", "--count", `${base}..HEAD`], cwd));
    changed = run("git", ["diff", "--name-only", `${base}...HEAD`], cwd).split("\n").filter(Boolean);
    dirty = run("git", ["status", "--porcelain"], cwd).length > 0;
  } catch {
    return { onTicket: true, ticket, branch, cwd, phase: "?", why: `cannot read history against ${base}` };
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
    cwd,
    base,
    head,
    commits,
    changed,
    dirty,
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
