import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function isInvokedDirectly(argv1, moduleUrl) {
  return Boolean(argv1) && path.resolve(argv1) === fileURLToPath(moduleUrl);
}

const SIZE_ORDER = ["size:XS", "size:S", "size:M", "size:L", "size:XL"];
const OWNER_LABELS = new Set(["ready-for-human", "needs-info", "rejected"]);

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
 * Which skill works this issue, from its labels alone; `null` means the owner's.
 *
 * Precedence, encoded: an AFK session implements specified work first, then converts unspecified
 * input (triage), then resolves decisions (wayfinder), and otherwise hands off. An owner label
 * wins over `ready-for-agent`, and a ticket carrying both is the normal case — releasing one to
 * the owner adds `ready-for-human` beside the label already there.
 *
 * @typedef {{ number: number, title: string, labels: { name: string }[] }} Issue
 * @param {Issue} issue
 */
export function routeOf(issue) {
  const ls = labelNames(issue);
  if (ls.some((l) => OWNER_LABELS.has(l))) return null;
  if (ls.includes("ready-for-agent")) return "implement";
  if (ls.includes("needs-triage") || ls.length === 0) return "triage";
  if (ls.some((l) => l.startsWith("wayfinder:") && l !== "wayfinder:map")) return "wayfinder";
  return null;
}

/** The bucket each route lands in. `owner` is where anything with no route goes. */
const BUCKET = { implement: "frontier", triage: "triage", wayfinder: "wayfinder" };

/**
 * @param {Issue[]} openIssues
 * @returns {{ frontier: Issue[], triage: Issue[], wayfinder: Issue[], owner: Issue[] }}
 */
export function classify(openIssues) {
  /** @type {{frontier: Issue[], triage: Issue[], wayfinder: Issue[], owner: Issue[]}} */
  const buckets = { frontier: [], triage: [], wayfinder: [], owner: [] };
  for (const issue of openIssues) {
    const ls = labelNames(issue);
    if (ls.includes("in-progress")) continue;
    // `blocked` keeps `ready-for-agent`: the label carries a decision already
    // made, and taking it off to un-jam the queue is how that decision is lost.
    if (ls.includes("blocked")) continue;
    buckets[BUCKET[routeOf(issue)] ?? "owner"].push(issue);
  }
  // Oldest first: sorting by size put every self-filed size:S follow-up at the head.
  for (const b of Object.values(BUCKET)) buckets[b].sort((a, x) => a.number - x.number);
  return buckets;
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
  return openPrs.filter((pr) => new RegExp(`^agent/${number}-`).test(pr.headRefName ?? ""));
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
    if (claimedElsewhere(issue.number, openPrsFor)) {
      process.stderr.write(`SKIP\t${issue.number}\tan open pull request already claims it\n`);
      continue;
    }
    const comments = ghJson(["api", `repos/{owner}/{repo}/issues/${issue.number}/comments?per_page=100`]);
    out.push({ ...issue, _full: full, _comments: comments });
    if (out.length >= limit) break;
  }
  return out;
}

export function pickRoute(buckets) {
  if (buckets.frontier.length > 0) {
    const head = takeable(buckets.frontier, 1);
    if (head.length > 0) return { skill: "implement", ticket: head[0] };
  }
  if (buckets.triage.length > 0) return { skill: "triage", ticket: buckets.triage[0] };
  if (buckets.wayfinder.length > 0) return { skill: "wayfinder", ticket: buckets.wayfinder[0] };
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
  console.log(reasons.length === 0 ? `Takeable: yes` : `Takeable: no - ${reasons.join("; ")}`);
  console.log("----- BODY -----");
  console.log(issue.body ?? "(empty)");
  console.log(`----- COMMENTS (${comments.length}) -----`);
  for (const c of comments) {
    console.log(`\n[${c.user.login} | ${c.created_at}]`);
    console.log(c.body);
  }
  if (reasons.length === 0) {
    const n = issue.number;
    console.log("\n----- NEXT -----");
    console.log("Claim (first write; then confirm you won the race):");
    // Not an inline --body: PowerShell turns the backticks this file's own `claimBranch()`
    // matches on into a BEL, so an inline claim is one no peer can see. Not `--comments` either:
    // rule 25, it prints the thread instead of the body.
    console.log(`  gh issue edit ${n} --add-label in-progress`);
    console.log(`  gh issue comment ${n} --body-file <file>   # holding: Claimed by \`<branch>\`.`);
    console.log(
      `  gh issue view ${n} --json title,body,comments ` +
        `--jq '.title, .body, (.comments[]|"--- "+.author.login+": "+.body)'`
    );
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

  const openIssues = ghJson([
    "issue", "list",
    "--state", "open",
    "--limit", "200",
    "--json", "number,title,labels",
  ]);

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
      `\t${chosen.ticket?.title ?? "nothing agent-takeable"}` +
      `\t${chosen.ticket ? (sizeOf(chosen.ticket) ?? "") : ""}`,
  );
  console.log(
    `STATUS\timplement:${buckets.frontier.length}` +
    `\ttriage:${buckets.triage.length}` +
    `\twayfinder:${buckets.wayfinder.length}` +
    `\towner:${buckets.owner.length}`,
  );

  if (chosen.ticket) {
    printDetail(chosen.ticket, chosen.ticket._comments ?? []);
  }
}
