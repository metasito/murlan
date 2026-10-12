import { execFileSync } from "node:child_process";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { readIssue } from "./brief.mjs";
import { BRANCH, ticketOf, TRUSTED_AUTHORS, worktrees } from "./loop-derive.mjs";

const SIZE_ORDER = ["size:XS", "size:S", "size:M", "size:L", "size:XL"];
export const OWNER_LABELS = new Set(["ready-for-human", "needs-info", "rejected", "deferred"]);
export const LAUNCH_MILESTONE = "Launch";
function trusted(issueOrComment) {
  return TRUSTED_AUTHORS.includes(issueOrComment.author_association);
}

function ghJson(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
}

function labelNames(issue) {
  return issue.labels.map((l) => l.name);
}

/** The `size:*` label, or null. The supervisor derives the session's turn bound from it. */
export function sizeOf(issue) {
  return SIZE_ORDER.find((s) => labelNames(issue).includes(s)) ?? null;
}

/**
 * Which skill works this issue, from its author and labels; `null` means the owner's.
 *
 * An issue opened from outside the repo is the owner's whatever it carries: the bug template
 * labels it `needs-triage`, and triage would turn a stranger's text into work an agent merges.
 *
 * Precedence, encoded: an AFK session implements specified work first, then converts unspecified
 * input (triage), then resolves decisions (wayfinder), and otherwise hands off. An owner label
 * wins over `ready-for-agent`: releasing a ticket takes `ready-for-agent` off (RULES.md rule 28),
 * but one left carrying both must still not be taken.
 *
 * @typedef {{ number: number, title: string, labels: { name: string }[], author_association?: string, milestone?: { title: string } | null, _stranded?: boolean }} Issue
 * @param {Issue} issue
 */
export function routeOf(issue) {
  const ls = labelNames(issue);
  if (!trusted(issue)) return null;
  if (ls.some((l) => OWNER_LABELS.has(l))) return null;
  if (ls.includes("ready-for-agent")) return "implement";
  if (ls.includes("needs-triage") || ls.length === 0) return "triage";
  if (ls.some((l) => l.startsWith("wayfinder:") && l !== "wayfinder:map")) return "wayfinder";
  return null;
}

/** The bucket each route lands in. `owner` is where anything with no route goes. */
const BUCKET = { implement: "frontier", triage: "triage", wayfinder: "wayfinder" };

/**
 * A ticket with its own pushed branch that nothing on this machine is working.
 *
 * Two shapes reach it: a supervisor that died between CI rounds leaves `in-progress` on, and a park
 * the owner sent back leaves only `ready-for-agent` beside the pull request the park kept open. The
 * test is the same for both: claimed or implement-routed, pushed, and no worktree on this machine
 * standing for it. Its own open pull request is then not a peer's claim.
 *
 * The worktree half is local by design. This loop runs on one machine, and `.worktrees/` is the only
 * evidence separating "a peer is working it right now" from "nobody is" — the one distinction that
 * must not be got wrong in the direction of taking a live ticket.
 *
 * @param {Issue} issue @param {{openPr: boolean, liveWorktree: boolean}} evidence
 */
export function stranded(issue, { openPr, liveWorktree }) {
  const ours = labelNames(issue).includes("in-progress") || routeOf(issue) === "implement";
  return ours && openPr && !liveWorktree;
}

/**
 * `launch` is the Launch milestone's open issues in any bucket: zero means launch-first ordering is
 * ordering nothing.
 *
 * @param {Issue[]} openIssues
 * @returns {{ frontier: Issue[], triage: Issue[], wayfinder: Issue[], owner: Issue[], stranded: Issue[], launch: number }}
 */
export function classify(openIssues, io = realClassifyIo()) {
  const launch = openIssues.filter((i) => i.milestone?.title === LAUNCH_MILESTONE).length;
  /** @type {{frontier: Issue[], triage: Issue[], wayfinder: Issue[], owner: Issue[], stranded: Issue[], launch: number}} */
  const buckets = { frontier: [], triage: [], wayfinder: [], owner: [], stranded: [], launch };
  // Asked once, and only once a ticket has an open pull request: it costs a subprocess, and with no
  // pull request no ticket can be stranded.
  let live;
  const evidence = (issue) => {
    const openPr = io.openPr(issue.number);
    if (!openPr) return { openPr, liveWorktree: false };
    if (live === undefined) live = io.liveWorktrees();
    // `live === null` is git unreadable: every ticket reads as live, which fails closed.
    return { openPr, liveWorktree: !live || live.has(issue.number) };
  };
  for (const issue of openIssues) {
    const ls = labelNames(issue);
    const claimed = ls.includes("in-progress");
    // `blocked` keeps `ready-for-agent`: the label carries a decision already
    // made, and taking it off to un-jam the queue is how that decision is lost.
    if (!claimed && ls.includes("blocked")) continue;
    const route = routeOf(issue);
    if ((claimed || route === "implement") && stranded(issue, evidence(issue))) {
      buckets.stranded.push({ ...issue, _stranded: true });
      continue;
    }
    if (claimed) continue;
    buckets[BUCKET[route] ?? "owner"].push(issue);
  }
  // A red main or a CI flake first, then the Launch milestone, each oldest first. Never by size: that put every
  // self-filed size:S follow-up at the head.
  for (const b of [...new Set([...Object.values(BUCKET), "owner", "stranded"])]) buckets[b].sort((a, x) => rank(a) - rank(x) || a.number - x.number);
  // A branch already pushed and already reviewed is the cheapest work in the queue, and leaving it
  // is the one outcome nothing else recovers from.
  buckets.frontier = [...buckets.stranded, ...buckets.frontier];
  return buckets;
}

function realClassifyIo() {
  return {
    openPr: (n) => claimedElsewhere(n, openPrsFor),
    liveWorktrees: () => {
      try {
        const live = new Set();
        for (const w of worktrees()) {
          const n = ticketOf(w.branch);
          if (n) live.add(n);
        }
        return live;
      } catch {
        // Unreadable git is not evidence that nothing is running — and an empty set would say every
        // ticket is stranded, so refuse instead: `stranded` is then asked with liveWorktree true.
        return null;
      }
    },
  };
}

/**
 * A branch alive on origin is not a claim — a merged one satisfies that and froze nine tickets.
 * An open pull request is. Fails open: an unreachable tracker must not empty the queue.
 */
export function claimedElsewhere(number, list) {
  try {
    return list(number).some((pr) => pr.state === "OPEN");
  } catch {
    return false;
  }
}

let openPrs = null;
/** One listing per process, matched on the head ref: `#42` in a body also matches PR #942. */
function openPrsFor(number) {
  openPrs ??= ghJson(["pr", "list", "--state", "open", "--limit", "100", "--json", "number,state,headRefName"]);
  return openPrs.filter((pr) => Number(BRANCH.exec(pr.headRefName ?? "")?.[1]) === number);
}

function openBlockers(number) {
  const edges = ghJson([
    "api", `repos/{owner}/{repo}/issues/${number}/dependencies/blocked_by?per_page=100`,
  ]);
  return edges.filter((e) => e.state === "open");
}

// The gate order per candidate: native blockers, then claims.
function takeable(frontier, limit) {
  // No list endpoint carries the dependencies summary, so each candidate costs
  // one call; stop as soon as enough are in hand.
  const out = [];
  for (const issue of frontier) {
    const full = ghJson(["api", `repos/{owner}/{repo}/issues/${issue.number}`]);
    if (full.issue_dependencies_summary.blocked_by !== 0) continue;
    // A stranded candidate is exactly the shape `claimedElsewhere` refuses — its own open pull
    // request — and it reached the frontier because nothing on this machine is working it.
    if (!issue._stranded && claimedElsewhere(issue.number, openPrsFor)) {
      process.stderr.write(`SKIP\t${issue.number}\tan open pull request already claims it\n`);
      continue;
    }
    const comments = ghJson(["api", `repos/{owner}/{repo}/issues/${issue.number}/comments?per_page=100`]);
    out.push({ ...issue, _full: full, _comments: comments });
    if (out.length >= limit) break;
  }
  return out;
}

/** @param {Issue} issue */
export function rank(issue) {
  if (labelNames(issue).some((l) => l === "main-red" || l === "ci-flake")) return 0;
  return issue.milestone?.title === LAUNCH_MILESTONE ? 1 : 2;
}

/** The owner's open asks, as the handoff line names them: what the loop is waiting on. */
export function waitingOn(owner, max = 8) {
  const asks = owner
    .filter((i) => {
      const ls = labelNames(i);
      return !ls.includes("deferred") && ls.some((l) => l === "ready-for-human" || l === "needs-info");
    })
    .sort((a, x) => rank(a) - rank(x) || x.number - a.number);
  return asks.length ? `nothing agent-takeable; waiting on you: ${asks.slice(0, max).map((i) => `#${i.number}`).join(", ")}` : "nothing agent-takeable";
}

export function pickRoute(buckets, take = takeable) {
  if (buckets.frontier.length > 0) {
    const head = take(buckets.frontier, 1);
    if (head.length > 0) return { skill: "implement", ticket: head[0] };
  }
  if (buckets.triage.length > 0) return { skill: "triage", ticket: buckets.triage[0] };
  if (buckets.wayfinder.length > 0) {
    const head = take(buckets.wayfinder, 1);
    if (head.length > 0) return { skill: "wayfinder", ticket: head[0] };
  }
  return { skill: "handoff", ticket: null };
}

function printDetail(ticket, comments) {
  const issue = ticket._full ?? ghJson(["api", `repos/{owner}/{repo}/issues/${ticket.number}`]);
  const ls = labelNames({ labels: issue.labels });
  const blockers = issue.issue_dependencies_summary?.blocked_by ?? 0;
  console.log(`\n===== TICKET #${issue.number} - ${issue.title} =====`);
  console.log(`Labels: ${ls.join(", ")}`);
  console.log(`Open blockers: ${blockers}`);
  if (blockers > 0) {
    for (const b of openBlockers(issue.number)) {
      console.log(`  blocked by #${b.number} ${b.title}`);
    }
  }
  // A CI fix round is handed back by ticket number, and that session's first question — does the
  // branch already exist — cannot be answered from labels.
  for (const pr of openPrsFor(issue.number)) {
    if (pr.state === "OPEN") console.log(`Open pull request: #${pr.number} on ${pr.headRefName}`);
  }
  const reasons = [];
  if (blockers > 0) reasons.push("has open blockers");
  if (ls.includes("in-progress")) reasons.push("labelled in-progress");
  if (ls.includes("blocked")) reasons.push("labelled blocked");
  if (ls.some((l) => OWNER_LABELS.has(l))) reasons.push(`owner-gated (${ls.filter((l) => OWNER_LABELS.has(l)).join(", ")})`);
  if (!trusted(issue)) reasons.push(`opened from outside the repo (${issue.author_association})`);
  console.log(reasons.length === 0 ? `Takeable: yes` : `Takeable: no - ${reasons.join("; ")}`);
  console.log("----- BODY -----");
  console.log(issue.body ?? "(empty)");
  const shown = comments.filter(trusted);
  console.log(`----- COMMENTS (${shown.length}) -----`);
  if (shown.length < comments.length) console.log(`(${comments.length - shown.length} from outside the repo not shown)`);
  for (const c of shown) {
    console.log(`\n[${c.user.login} | ${c.created_at}]`);
    console.log(c.body);
  }
  if (reasons.length === 0) {
    const n = issue.number;
    console.log("\n----- NEXT -----");
    console.log("Claim (first write; then confirm you won the race):");
    // Not an inline --body: PowerShell turns backticks into a BEL. Not `--comments`: rule 25, it
    // prints the thread instead of the body.
    console.log(`  gh issue edit ${n} --add-label in-progress`);
    console.log(`  gh issue comment ${n} --body-file <file>   # holding: Claimed by \`<branch>\`.`);
    console.log(`  ${readIssue(n)}`);
  }
}

// Guarded so a test can import `classify` (and the other pure functions
// above) without shelling out to `gh` as a side effect of the import.
const invokedDirectly = isInvokedDirectly(process.argv[1], import.meta.url);

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const wantAll = args.includes("--all");
  const explicit = args.map(Number).find((n) => Number.isInteger(n) && n > 0);

  if (explicit) {
    let issue, comments;
    try {
      issue = ghJson(["api", `repos/{owner}/{repo}/issues/${explicit}`]);
      comments = ghJson(["api", `repos/{owner}/{repo}/issues/${explicit}/comments?per_page=100`]);
    } catch {
      console.error(`#${explicit} not found (is it a pull request?)`);
      process.exit(1);
    }
    // `queue.md` branches on implement / triage / wayfinder / handoff and has no fifth case.
    console.log(`ROUTE\t${routeOf(issue) ?? "handoff"}\t${explicit}\t${issue.title}\t${sizeOf(issue) ?? ""}`);
    printDetail(issue, comments);
    process.exit(0);
  }

  // REST, not `gh issue list`: only REST carries `author_association`.
  const openIssues = ghJson([
    "api", "--paginate", "--slurp", "repos/{owner}/{repo}/issues?state=open&per_page=100",
  ]).flat().filter((i) => !i.pull_request);

  const buckets = classify(openIssues);

  if (wantAll) {
    // The listing is a gate, not a menu: blocked tickets stay off it even here.
    for (const issue of buckets.frontier) {
      const { blocked_by } = ghJson(["api", `repos/{owner}/{repo}/issues/${issue.number}`]).issue_dependencies_summary;
      if (blocked_by === 0) console.log(`${issue.number}\t${issue.title}`);
    }
    process.exit(0);
  }

  const chosen = pickRoute(buckets);
  console.log(
    `ROUTE\t${chosen.skill}\t${chosen.ticket?.number ?? 0}` +
      `\t${chosen.ticket?.title ?? waitingOn(buckets.owner)}` +
      `\t${chosen.ticket ? (sizeOf(chosen.ticket) ?? "") : ""}`,
  );
  console.log(
    `STATUS\timplement:${buckets.frontier.length}` +
    `\ttriage:${buckets.triage.length}` +
    `\twayfinder:${buckets.wayfinder.length}` +
    `\towner:${buckets.owner.length}` +
    `\tlaunch:${buckets.launch}`,
  );

  if (chosen.ticket) {
    printDetail(chosen.ticket, chosen.ticket._comments ?? []);
  }
}
