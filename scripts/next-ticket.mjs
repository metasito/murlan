import { execFileSync } from "node:child_process";

const SIZE_ORDER = ["size:XS", "size:S", "size:M", "size:L", "size:XL"];

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
function classify(openIssues) {
  const buckets = { frontier: [], triage: [], wayfinder: [], owner: [] };
  for (const issue of openIssues) {
    const ls = labelNames(issue);
    if (ls.includes("in-progress")) continue;
    if (ls.includes("ready-for-agent")) buckets.frontier.push(issue);
    else if (ls.includes("needs-triage")) buckets.triage.push(issue);
    else if (ls.some((l) => l.startsWith("wayfinder:") && l !== "wayfinder:map")) buckets.wayfinder.push(issue);
    else buckets.owner.push(issue);
  }
  buckets.frontier.sort((a, b) => sizeRank(a) - sizeRank(b) || a.number - b.number);
  buckets.triage.sort((a, b) => a.number - b.number);
  buckets.wayfinder.sort((a, b) => a.number - b.number);
  return buckets;
}

function takeable(frontier, limit) {
  // No list endpoint carries the dependencies summary, so each candidate costs
  // one call; stop as soon as enough are in hand.
  const out = [];
  for (const issue of frontier) {
    const { blocked_by } = ghJson(["api", `repos/{owner}/{repo}/issues/${issue.number}`]).issue_dependencies_summary;
    if (blocked_by === 0) {
      out.push(issue);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function pickRoute(buckets) {
  if (buckets.frontier.length > 0) {
    const head = takeable(buckets.frontier, 3);
    if (head.length > 0) return { skill: "implement", ticket: head[0] };
  }
  if (buckets.triage.length > 0) return { skill: "triage", ticket: buckets.triage[0] };
  if (buckets.wayfinder.length > 0) return { skill: "wayfinder", ticket: buckets.wayfinder[0] };
  return { skill: "handoff", ticket: null };
}

function printDetail(ticket) {
  const issue = ghJson(["api", `repos/{owner}/{repo}/issues/${ticket.number}`]);
  const comments = ghJson(["api", `repos/{owner}/{repo}/issues/${ticket.number}/comments`]);
  console.log(`\n===== TICKET #${issue.number} - ${issue.title} =====`);
  console.log(`Labels: ${labelNames({ labels: issue.labels }).join(", ")}`);
  console.log(`Open blockers: ${issue.issue_dependencies_summary?.blocked_by ?? 0}`);
  console.log("----- BODY -----");
  console.log(issue.body ?? "(empty)");
  console.log(`----- COMMENTS (${comments.length}) -----`);
  for (const c of comments) {
    console.log(`\n[${c.user.login} · ${c.created_at}]`);
    console.log(c.body);
  }
  const n = issue.number;
  console.log("\n----- NEXT -----");
  console.log("Claim (first write; then confirm you won the race):");
  console.log(`  gh issue edit ${n} --add-label in-progress`);
  console.log(`  gh issue comment ${n} --body "Claimed by \\\`<branch-name>\\\`."`);
  console.log(`  gh issue view ${n} --comments`);
}

const wantAll = process.argv.includes("--all");
const openIssues = ghJson([
  "issue", "list",
  "--state", "open",
  "--limit", "200",
  "--json", "number,title,labels",
]);

const buckets = classify(openIssues);

if (wantAll) {
  for (const i of buckets.frontier) console.log(`${i.number}\t${i.title}`);
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

if (chosen.ticket) printDetail(chosen.ticket);
