import { execFileSync } from "node:child_process";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { readIssue } from "./brief.mjs";
import { BRANCH, REPO, ticketOf, TRUSTED_AUTHORS, worktrees } from "./loop-derive.mjs";

const SIZE_ORDER = ["size:XS", "size:S", "size:M", "size:L", "size:XL"];
export const OWNER_LABELS = new Set(["ready-for-human", "needs-info", "rejected", "deferred"]);
export const LAUNCH_MILESTONE = "Launch";
function trusted(issueOrComment) {
  return TRUSTED_AUTHORS.includes(issueOrComment.author_association);
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });

function ghJson(args) {
  return JSON.parse(gh(args));
}

const QUERY = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){issues(states:OPEN,first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{number title authorAssociation labels(first:100){nodes{name}} milestone{title} issueDependenciesSummary{blockedBy}}}}}`;

/** Every open issue with its open-blocker count, a page of 100 per call. GraphQL, not `gh issue list`: only it carries both the author association and the dependency summary. */
export function openIssues(run = gh) {
  const [owner, name] = REPO.split("/");
  const nodes = [];
  let after = null;
  do {
    const args = ["api", "graphql", "-f", `query=${QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`];
    if (after) args.push("-f", `after=${after}`);
    const { issues } = JSON.parse(run(args)).data.repository;
    nodes.push(...issues.nodes);
    if (issues.pageInfo.hasNextPage && !issues.pageInfo.endCursor) {
      throw new Error(`after ${nodes.length} open issues, GraphQL reads hasNextPage with no endCursor; the rest are unreachable`);
    }
    after = issues.pageInfo.hasNextPage ? issues.pageInfo.endCursor : null;
  } while (after);
  return nodes.map((n) => ({
    number: n.number,
    title: n.title,
    author_association: n.authorAssociation,
    labels: n.labels.nodes,
    milestone: n.milestone,
    blocked: n.issueDependenciesSummary.blockedBy > 0,
  }));
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
 * @typedef {{ number: number, title: string, labels: { name: string }[], author_association?: string, milestone?: { title: string } | null, blocked?: boolean, _stranded?: boolean }} Issue
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

/** The Launch milestone's open issues, whatever their labels: zero means launch-first ordering orders nothing. */
export function launchOpen(/** @type {Issue[]} */ openIssues) {
  return openIssues.filter((i) => i.milestone?.title === LAUNCH_MILESTONE).length;
}

/**
 * @param {Issue[]} openIssues
 * @returns {{ frontier: Issue[], triage: Issue[], wayfinder: Issue[], owner: Issue[], stranded: Issue[] }}
 */
export function classify(openIssues, io = realClassifyIo()) {
  /** @type {{frontier: Issue[], triage: Issue[], wayfinder: Issue[], owner: Issue[], stranded: Issue[]}} */
  const buckets = { frontier: [], triage: [], wayfinder: [], owner: [], stranded: [] };
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

/** The gate order per candidate: native blockers, then claims. */
export function takeable(frontier, limit, claimed = (n) => claimedElsewhere(n, openPrsFor)) {
  const out = [];
  for (const issue of frontier) {
    if (issue.blocked) continue;
    // A stranded candidate is exactly the shape `claimedElsewhere` refuses — its own open pull
    // request — and it reached the frontier because nothing on this machine is working it.
    if (!issue._stranded && claimed(issue.number)) {
      process.stderr.write(`SKIP\t${issue.number}\tan open pull request already claims it\n`);
      continue;
    }
    out.push(issue);
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

/** Why a ticket read in full (REST's shape) is not takeable; none means it is. */
export function takeableReasons(issue) {
  const ls = labelNames(issue);
  const reasons = [];
  if ((issue.issue_dependencies_summary?.blocked_by ?? 0) > 0) reasons.push("has open blockers");
  if (ls.includes("in-progress")) reasons.push("labelled in-progress");
  if (ls.includes("blocked")) reasons.push("labelled blocked");
  if (ls.some((l) => OWNER_LABELS.has(l))) reasons.push(`owner-gated (${ls.filter((l) => OWNER_LABELS.has(l)).join(", ")})`);
  if (!trusted(issue)) reasons.push(`opened from outside the repo (${issue.author_association})`);
  return reasons;
}

function printDetail(issue, comments) {
  const ls = labelNames(issue);
  console.log(`\n===== TICKET #${issue.number} - ${issue.title} =====`);
  console.log(`Labels: ${ls.join(", ")}`);
  console.log(`Open blockers: ${issue.issue_dependencies_summary?.blocked_by ?? 0}`);
  // A CI fix round is handed back by ticket number, and that session's first question — does the
  // branch already exist — cannot be answered from labels.
  for (const pr of openPrsFor(issue.number)) {
    if (pr.state === "OPEN") console.log(`Open pull request: #${pr.number} on ${pr.headRefName}`);
  }
  const reasons = takeableReasons(issue);
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
  const explicit = args.map(Number).find((n) => Number.isInteger(n) && n > 0);
  const read = (n) => {
    try {
      return [
        ghJson(["api", `repos/{owner}/{repo}/issues/${n}`]),
        ghJson(["api", `repos/{owner}/{repo}/issues/${n}/comments?per_page=100`]),
      ];
    } catch {
      console.error(`#${n} could not be read (a pull request, or gh unreachable)`);
      process.exit(1);
    }
  };

  if (explicit) {
    const [issue, comments] = read(explicit);
    // `queue.md` branches on implement / triage / wayfinder / handoff and has no fifth case.
    console.log(`ROUTE\t${routeOf(issue) ?? "handoff"}\t${explicit}\t${issue.title}\t${sizeOf(issue) ?? ""}`);
    printDetail(issue, comments);
    process.exit(0);
  }

  const issues = openIssues();
  const buckets = classify(issues);
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
    `\tlaunch:${launchOpen(issues)}`,
  );

  if (chosen.ticket) printDetail(...read(chosen.ticket.number));
}
