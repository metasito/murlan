/**
 * One queue ticket, start to finish: claim it, implement it, review it, let ci.yml judge it, land
 * it. `npm run ticket`.
 *
 * A model runs at exactly three points, each of them a judgement call, each prompted with a single
 * line that names a skill. Everything else — picking, claiming, branching, pushing, reading the
 * verdict, merging, tearing down — is a function call, because it is deterministic and a model
 * asked in prose to run a command is how the previous pipeline shipped sixteen defects.
 *
 * Nothing an agent says about what it did is believed. Git is asked instead.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { classify, pickRoute } from "./next-ticket.mjs";
import { runAgent, type Effort } from "../lib/ticketPipeline/agent.ts";
import { claimTicket, releaseTicket } from "../lib/ticketPipeline/claim.ts";
import { readVerdict, ghExecOptions, type Verdict } from "../lib/ticketPipeline/ciVerdict.ts";
import { buildCleanupCommands } from "../lib/ticketPipeline/cleanup.ts";
import { needsDesignFirstGate, unsettledDecisions } from "../lib/ticketPipeline/gate.ts";
import { decideLanding, mergeArgs } from "../lib/ticketPipeline/land.ts";
import { buildWorktreeCommands, worktreePathFor } from "../lib/ticketPipeline/worktree.ts";

const REPO = "metasito/murlan";
const MAX_FIX_ROUNDS = 2;
/** A run whose CI never appears is not a red suite. It is retried once, without a model. */
const MAX_INFRASTRUCTURE_RETRIES = 1;

interface Ticket {
  number: number;
  title: string;
  body: string;
  comments: string;
}

interface RunState {
  worktreePath: string | null;
  localBranch: string | null;
  merged: boolean;
  prNumber: number | null;
}

/** A stop with a reason the owner will read on the issue. Anything else is a crash, and says so. */
class Stop extends Error {}

// ---------------------------------------------------------------- shell

function gh(args: string[]): string {
  return execFileSync("gh", args, ghExecOptions());
}

function ghJson<T>(args: string[]): T {
  return JSON.parse(gh(args)) as T;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Cleanup's commands are bash, and on Windows that is Git Bash. Failures there are not fatal. */
function bash(command: string, { fatal = true } = {}): void {
  try {
    execFileSync("bash", ["-c", command], { cwd: process.cwd(), stdio: "inherit" });
  } catch (error) {
    if (fatal) throw error;
    say(`  (ignored) ${command}: ${(error as Error).message}`);
  }
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

// ---------------------------------------------------------------- git as the witness

function commitsAhead(cwd: string): number {
  return Number(git(cwd, ["rev-list", "--count", "origin/main..HEAD"]).trim());
}

function changedFiles(cwd: string): string[] {
  return git(cwd, ["diff", "--name-only", "origin/main...HEAD"]).split("\n").filter(Boolean);
}

/**
 * An agent that edited and did not commit still did the work. The worktree has its own index, so
 * staging everything in it cannot reach another session — the rule against a bare add is about
 * the shared checkout, which no stage of this run ever touches.
 */
function commitLeftovers(cwd: string, message: string): void {
  if (!git(cwd, ["status", "--porcelain"]).trim()) return;
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-m", message]);
}

// ---------------------------------------------------------------- the three prompts

function implementPrompt(): string {
  return (
    "/mattpocock-skills:implement\n\n" +
    "The work is specified in `.pipeline/ticket.md` at the root of this worktree. Read it first " +
    "and do what it asks. Commit your work. Do not push and do not open a pull request.\n\n" +
    "`docs/agents/RULES.md` is the ruleset — read it, and follow it over anything here."
  );
}

function reviewPrompt(): string {
  return "/code-review high --fix main";
}

function fixPrompt(verdict: Verdict): string {
  return (
    `ci.yml failed on this branch. The failing job is \`${verdict.failedStep ?? "unknown"}\`.\n\n` +
    `Its log ends:\n\n${verdict.output ?? "(no log)"}\n\n` +
    "Find the cause, fix it, and commit. Do not push."
  );
}

// ---------------------------------------------------------------- stages

function stage(name: string, prompt: string, model: "sonnet" | "opus", effort: Effort, cwd: string): void {
  const started = Date.now();
  say(`\n--- ${name} (${model}, effort ${effort}) ---`);
  const result = runAgent({ prompt, model, effort, cwd });
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  say(`--- ${name} done in ${minutes}m, ${result.turns} turns, $${result.costUsd.toFixed(2)} ---`);
  if (!result.ok) say(`(the ${name} agent exited non-zero; git decides whether it did the work)`);
}

function pickTicket(): Ticket | null {
  const issues = ghJson<{ number: number; title: string; labels: { name: string }[] }[]>([
    "issue", "list", "--repo", REPO, "--state", "open", "--limit", "200", "--json", "number,title,labels",
  ]);
  const route = pickRoute(classify(issues));
  if (route.skill !== "implement" || !route.ticket) {
    say(`nothing to implement: the queue routes to \`${route.skill}\``);
    return null;
  }
  const detail = ghJson<{ body: string | null; comments: { body: string }[] }>([
    "issue", "view", String(route.ticket.number), "--repo", REPO, "--json", "body,comments",
  ]);
  return {
    number: route.ticket.number,
    title: route.ticket.title,
    body: detail.body ?? "",
    comments: detail.comments.map((c) => c.body).join("\n\n"),
  };
}

export function branchNameFor(ticket: { number: number; title: string }): string {
  const slug = ticket.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `agent/${ticket.number}-${slug || "ticket"}`;
}

/**
 * The ticket, and only the ticket. Comments are kept out: the previous gate concatenated them and
 * read its own escalation notices back as the specification.
 */
function writeTicketFile(worktree: string, ticket: Ticket): void {
  mkdirSync(path.join(worktree, ".pipeline"), { recursive: true });
  writeFileSync(
    path.join(worktree, ".pipeline", "ticket.md"),
    `# #${ticket.number} — ${ticket.title}\n\n${ticket.body}\n`,
    "utf8"
  );
}

function openPullRequest(ticket: Ticket, branch: string): number {
  gh([
    "pr", "create", "--repo", REPO, "--base", "main", "--head", branch,
    "--title", ticket.title,
    "--body", `Closes #${ticket.number}\n`,
  ]);
  const [pr] = ghJson<{ number: number }[]>([
    "pr", "list", "--repo", REPO, "--head", branch, "--json", "number",
  ]);
  if (!pr) throw new Stop("the pull request was created but cannot be found");
  return pr.number;
}

/** Green, or a reason to stop. A fix agent is spawned only for a failure ci.yml actually reported. */
function driveToGreen(branch: string, prNumber: number, worktree: string): void {
  let fixRounds = 0;
  let infrastructureRetries = 0;
  for (;;) {
    const verdict = readVerdict(REPO, branch, prNumber);
    say(`ci.yml: ${verdict.reason}`);
    if (verdict.pass) return;

    if (verdict.infrastructure) {
      if (infrastructureRetries++ >= MAX_INFRASTRUCTURE_RETRIES) {
        throw new Stop(`ci.yml could not be read: ${verdict.reason}`);
      }
      say("that says nothing about the diff — asking again rather than sending a fix agent");
      continue;
    }

    if (fixRounds++ >= MAX_FIX_ROUNDS) {
      throw new Stop(`still red after ${MAX_FIX_ROUNDS} fix rounds: ${verdict.reason}`);
    }
    stage(`fix ${fixRounds}`, fixPrompt(verdict), "sonnet", "high", worktree);
    commitLeftovers(worktree, `Fix ${verdict.failedStep ?? "ci.yml"}`);
    git(worktree, ["push"]);
  }
}

function land(branch: string, prNumber: number, worktree: string, state: RunState): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    const pr = ghJson<{ mergeStateStatus: string; mergeable: string }>([
      "pr", "view", String(prNumber), "--repo", REPO, "--json", "mergeStateStatus,mergeable",
    ]);
    const decision = decideLanding(pr);
    say(`landing: ${decision.action} — ${decision.reason}`);
    if (decision.action === "merge") {
      gh(mergeArgs(REPO, prNumber));
      state.merged = true;
      return;
    }
    if (decision.action !== "update-branch") throw new Stop(decision.reason);
    gh(["pr", "update-branch", String(prNumber), "--repo", REPO]);
    driveToGreen(branch, prNumber, worktree);
  }
  throw new Stop("the branch would not come up to date");
}

// ---------------------------------------------------------------- the run

function work(ticket: Ticket, branch: string, state: RunState): void {
  const relative = worktreePathFor(ticket.number);
  bash(buildWorktreeCommands({ number: ticket.number, branch }).join(" && "));
  state.worktreePath = relative;
  const worktree = path.resolve(relative);

  writeTicketFile(worktree, ticket);

  stage("implement", implementPrompt(), "sonnet", "high", worktree);
  commitLeftovers(worktree, `Implement #${ticket.number}`);
  if (commitsAhead(worktree) === 0) throw new Stop("the implement agent committed nothing");

  // On the real diff, not on a guess made from the ticket's prose. A well-written ticket names
  // every file worth reading, which is not the same set as the files a fix touches.
  const gate = needsDesignFirstGate({
    filesTouched: changedFiles(worktree),
    body: ticket.body,
    comments: ticket.comments,
  });
  if (gate.escalate) throw new Stop(`design-first gate: ${gate.reason}`);

  stage("review", reviewPrompt(), "opus", "max", worktree);
  commitLeftovers(worktree, "Apply review findings");

  git(worktree, ["push", "-u", "origin", branch]);
  state.prNumber = openPullRequest(ticket, branch);
  say(`opened #${state.prNumber}`);

  driveToGreen(branch, state.prNumber, worktree);
  land(branch, state.prNumber, worktree, state);
}

function teardown(ticket: Ticket, state: RunState, why: string): void {
  if (!state.merged) {
    try {
      releaseTicket(REPO, ticket.number, why);
      say(`released #${ticket.number}: ${why}`);
    } catch (error) {
      say(`could not release #${ticket.number}: ${(error as Error).message}`);
    }
  }
  for (const command of buildCleanupCommands({
    worktreePath: state.worktreePath,
    dockerStarted: false,
    localBranch: state.localBranch,
    merged: state.merged,
  })) {
    bash(command, { fatal: false });
  }
}

function main(): number {
  execFileSync("node", ["scripts/preflight.mjs"], { stdio: "inherit" });

  const ticket = pickTicket();
  if (!ticket) return 0;
  say(`#${ticket.number} — ${ticket.title}`);

  // The one gate that reads the specification alone. `ready-for-agent` promises the decisions are
  // made; an open box under "What to settle" means it is not, and no worktree should be spent.
  const open = unsettledDecisions(ticket.body);
  if (open > 0) {
    releaseTicket(REPO, ticket.number, `Not taken: ${open} unsettled decision(s) under "What to settle".`);
    say(`escalated #${ticket.number}: ${open} unsettled decision(s)`);
    return 0;
  }

  const branch = branchNameFor(ticket);
  const claim = claimTicket(REPO, ticket.number, branch);
  if (!claim.claimed) {
    say(`stood down from #${ticket.number}: ${claim.reason}`);
    return 0;
  }

  const state: RunState = { worktreePath: null, localBranch: branch, merged: false, prNumber: null };
  let why = "";
  try {
    work(ticket, branch, state);
    say(`\nlanded #${ticket.number} via #${state.prNumber}`);
    return 0;
  } catch (error) {
    why =
      error instanceof Stop
        ? `Stopped: ${error.message}`
        : `Stopped on an unexpected error: ${(error as Error).message}`;
    say(`\n${why}`);
    return 1;
  } finally {
    teardown(ticket, state, why || "Stopped without a reason recorded.");
  }
}

// Guarded so a test can import the pure helpers above without starting a run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
