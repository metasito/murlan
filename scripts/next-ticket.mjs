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

function sizeRank(issue) {
  const i = SIZE_ORDER.findIndex((s) => labelNames(issue).includes(s));
  return i === -1 ? SIZE_ORDER.length : i;
}

// Precedence, encoded: an AFK session implements specified work first, then
// converts unspecified input (triage), then resolves decisions (wayfinder),
// and otherwise hands off to the owner. Each stage manufactures work for the
// stages above it, which is why they run bottom-up here, top-down in value.
//
// `owner` means labelled, with the label saying a human decides.
/**
 * @typedef {{ number: number, title: string, labels: { name: string }[] }} Issue
 * @param {Issue[]} openIssues
 * @returns {{ frontier: Issue[], triage: Issue[], wayfinder: Issue[], owner: Issue[] }}
 */
export function classify(openIssues) {
  const buckets = { frontier: [], triage: [], wayfinder: [], owner: [] };
  for (const issue of openIssues) {
    const ls = labelNames(issue);
    if (ls.includes("in-progress")) continue;
    // `blocked` keeps `ready-for-agent`: the label carries a decision already
    // made, and taking it off to un-jam the queue is how that decision is lost.
    if (ls.includes("blocked")) continue;
    // An owner label wins over `ready-for-agent`, and a ticket carrying both is the normal case:
    // releasing one to the owner adds `ready-for-human` beside the label that is already there.
    // Without this the frontier takes it, the pipeline claims it and the gate escalates it again —
    // and because it sorts to the same place every time, the queue serves it forever.
    if (ls.some((l) => OWNER_LABELS.has(l))) buckets.owner.push(issue);
    else if (ls.includes("ready-for-agent")) buckets.frontier.push(issue);
    else if (ls.includes("needs-triage") || ls.length === 0) buckets.triage.push(issue);
    else if (ls.some((l) => l.startsWith("wayfinder:") && l !== "wayfinder:map")) buckets.wayfinder.push(issue);
    else buckets.owner.push(issue);
  }
  buckets.frontier.sort((a, b) => sizeRank(a) - sizeRank(b) || a.number - b.number);
  buckets.triage.sort((a, b) => a.number - b.number);
  buckets.wayfinder.sort((a, b) => a.number - b.number);
  return buckets;
}

function claimBranch(comments) {
  for (let i = comments.length - 1; i >= 0; i--) {
    const m = comments[i].body.match(/^Claim(?:ed by|ing)[^`\n]*`([^`]+)`/m);
    if (m) return m[1];
  }
  return null;
}

function branchAlive(branch) {
  // Fail open: an unreachable origin must not empty the whole queue. The
  // post-claim race check remains the backstop for whatever slips through.
  const out = execFileSync("git", ["ls-remote", "--heads", "origin", branch], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return out.trim().length > 0;
}

function openBlockers(number) {
  const edges = ghJson([
    "api", `repos/{owner}/{repo}/issues/${number}/dependencies/blocked_by?per_page=100`,
  ]);
  return edges.filter((e) => e.state === "open");
}

// The gate order per candidate: native blockers, then claims. A claim counts
// even when its in-progress label write was lost - a claim comment naming a
// branch that still lives on origin takes the ticket off the frontier.
function takeable(frontier, limit) {
  // No list endpoint carries the dependencies summary, so each candidate costs
  // one call; stop as soon as enough are in hand.
  const out = [];
  for (const issue of frontier) {
    const { blocked_by } = ghJson(["api", `repos/{owner}/{repo}/issues/${issue.number}`]).issue_dependencies_summary;
    if (blocked_by !== 0) continue;
    const comments = ghJson(["api", `repos/{owner}/{repo}/issues/${issue.number}/comments?per_page=100`]);
    const claim = claimBranch(comments);
    if (claim && branchAlive(claim)) {
      process.stderr.write(`SKIP\t${issue.number}\tclaimed on \`${claim}\` (branch alive)\n`);
      continue;
    }
    out.push({ ...issue, _comments: comments });
    if (out.length >= limit) break;
  }
  return out;
}

export function pickRoute(buckets) {
  if (buckets.frontier.length > 0) {
    const head = takeable(buckets.frontier, 3);
    if (head.length > 0) return { skill: "implement", ticket: head[0] };
  }
  if (buckets.triage.length > 0) return { skill: "triage", ticket: buckets.triage[0] };
  if (buckets.wayfinder.length > 0) return { skill: "wayfinder", ticket: buckets.wayfinder[0] };
  return { skill: "handoff", ticket: null };
}

function printDetail(ticket, comments) {
  const issue = ghJson(["api", `repos/{owner}/{repo}/issues/${ticket.number}`]);
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
    console.log(`ROUTE\tshow\t${explicit}\t${issue.title}`);
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
  console.log(`ROUTE\t${chosen.skill}\t${chosen.ticket?.number ?? 0}\t${chosen.ticket?.title ?? "nothing agent-takeable"}`);
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
