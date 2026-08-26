/**
 * One queue ticket, start to finish: claim it, implement it, review it, let ci.yml judge it, land
 * it. `npm run ticket`.
 *
 * A model runs at exactly three points, each of them a judgement call: implement, review, fix.
 * Everything else — picking, claiming, branching, pushing, reading the verdict, merging, tearing
 * down — is a function call, because it is deterministic, and a model asked in prose to run a
 * command is how the previous pipeline shipped sixteen defects.
 *
 * Each of the three is prompted with a skill and the findings that skill cannot know: which
 * suites this repo makes an agent judge, what the previous stage already proved. Nothing in a
 * prompt decides control flow.
 *
 * Nothing an agent says about what it did is believed. Git is asked instead.
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
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

/** Git Bash is the shell every command in this repo is written for; the agent has both. */
const SHELL_NOTE = "Use the Bash tool, not PowerShell.";

/**
 * Which suites to run locally. Two findings, both expensive: #349 spent 58 of its 85 minutes on
 * seven Playwright runs, and a ticket carrying a `## Checks` section was written by someone who
 * had read the diff coming, so reaching past it pays for minutes ci.yml is already spending.
 */
const CHECKS_NOTE =
  "Follow `docs/agents/RULES.md` rules 1-6 for what to run while iterating and what to run once " +
  "before you stop. When the issue has a `## Checks` section, that section is this ticket's list: " +
  "run what it names and nothing further. With no such section, judge it from the files you touched.";

/**
 * The whole ticket, body and comments both. The comments are where the owner's rulings and the
 * answers to the body's own questions arrive, and an agent that never sees them implements the
 * question instead of the answer. They are labelled apart rather than concatenated: the previous
 * gate ran them together and read its own escalation notices back as the specification.
 *
 * `execFileSync` hands argv straight to the process with no shell in between, so none of this
 * needs quoting or a scratch file to carry it.
 */
function implementPrompt(ticket: Ticket): string {
  return [
    "/mattpocock-skills:implement",
    "",
    `Implement issue #${ticket.number} of ${REPO}, given below in full — the comments as much as`,
    "the body. Take it to a finished state: you are the only stage that writes code, and ci.yml can",
    "only tell you whether you broke something. No stubs, no deferring a part the ticket asked for,",
    "no test that asserts around the part that was hard.",
    "",
    "Write down the ticket's Definition of done as a checklist first and treat it as the contract.",
    "Say in your summary which boxes you closed and name any you did not, with why — an honest gap",
    "is worth more than a green report.",
    "",
    "Two overrides on that skill:",
    "",
    `- **Do not run the full test suite at the end.** ci.yml runs it against a clean build on the`,
    `  push. ${CHECKS_NOTE}`,
    "- **Do not review your own diff or dispatch a reviewer.** The next stage does that, in this",
    "  same worktree, and hands your evidence to it.",
    "",
    "Commit on this branch. Do not push and do not open a pull request.",
    "",
    "End your reply with the exact commands you ran and watched pass, one per line. The reviewer is",
    "given that list as evidence, so what you leave out of it is what gets run a second time.",
    "",
    `${SHELL_NOTE} \`docs/agents/RULES.md\` is the ruleset — follow it over anything here.`,
    "",
    `---`,
    "",
    `# #${ticket.number} — ${ticket.title}`,
    "",
    ticket.body,
    "",
    `---`,
    "",
    `## Comments on #${ticket.number}`,
    "",
    ticket.comments || "(none)",
  ].join("\n");
}

/**
 * What the implement stage proved travels to the reviewer as evidence, not as a fact the runner
 * acts on. Without it the reviewer re-ran the two-minute native suite three times a ticket,
 * because it had no way to know what had already passed against the tree it was reading.
 */
function reviewPrompt(ticket: Ticket, evidence: string): string {
  return [
    "/code-review high --fix main",
    "",
    `The diff on this branch closes issue #${ticket.number}: ${ticket.title}`,
    "",
    "Commit whatever you fix. Do not push and do not open a pull request.",
    "",
    "These already passed against the tree you are reading. They are evidence, not something to",
    `repeat — re-run one only where your own edit could have broken it. ${CHECKS_NOTE}`,
    "",
    evidence.slice(-2000) || "(the implement stage reported none)",
  ].join("\n");
}

function fixPrompt(verdict: Verdict, round: number): string {
  return [
    "ci.yml is red on this branch. Make it green, and change nothing the failure does not require.",
    "",
    `Failing job: \`${verdict.failedStep ?? "not reported"}\``,
    "",
    "Its log ends:",
    "",
    verdict.output ?? "(none reported)",
    "",
    // A pushed guess costs a full CI round to disprove, and a fix round has turned a working
    // branch broken more than once.
    "Run the failing check here and watch it pass before you stop. Commit; do not push.",
    round > 1
      ? "\nThe previous round did not fix it. Use `/mattpocock-skills:diagnosing-bugs` to drive the\ndiagnosis rather than guessing again."
      : "",
    "",
    `${SHELL_NOTE} ${CHECKS_NOTE}`,
  ].join("\n");
}

// ---------------------------------------------------------------- stages

function stage(name: string, prompt: string, model: "sonnet" | "opus", effort: Effort, cwd: string): string {
  const started = Date.now();
  say(`\n--- ${name} (${model}, effort ${effort}) ---`);
  const result = runAgent({ prompt, model, effort, cwd });
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  say(`--- ${name} done in ${minutes}m, ${result.turns} turns, $${result.costUsd.toFixed(2)} ---`);
  if (!result.ok) say(`(the ${name} agent exited non-zero; git decides whether it did the work)`);
  return result.text;
}

interface IssueDetail {
  number: number;
  title: string;
  state: string;
  body: string | null;
  labels: { name: string }[];
  comments: { author: { login: string }; body: string; createdAt: string }[];
}

function readIssue(number: number): Ticket {
  const detail = ghJson<IssueDetail>([
    "issue", "view", String(number), "--repo", REPO,
    "--json", "number,title,state,body,labels,comments",
  ]);
  if (detail.state !== "OPEN") throw new Stop(`#${number} is ${detail.state.toLowerCase()}`);
  return {
    number: detail.number,
    title: detail.title,
    body: detail.body ?? "",
    comments: detail.comments
      .map((c) => `### ${c.author.login} — ${c.createdAt}\n\n${c.body}`)
      .join("\n\n"),
  };
}

/** With no number, the queue picks; with one, that ticket, so a run can be aimed at a known case. */
function pickTicket(forced?: number): Ticket | null {
  if (forced) return readIssue(forced);
  const issues = ghJson<{ number: number; title: string; labels: { name: string }[] }[]>([
    "issue", "list", "--repo", REPO, "--state", "open", "--limit", "200", "--json", "number,title,labels",
  ]);
  const route = pickRoute(classify(issues));
  if (route.skill !== "implement" || !route.ticket) {
    say(`nothing to implement: the queue routes to \`${route.skill}\``);
    return null;
  }
  return readIssue(route.ticket.number);
}

/** `--ticket 348`, or nothing. Anything else is a typo worth stopping on, not a queue run. */
export function forcedTicket(argv: string[]): number | undefined {
  const at = argv.indexOf("--ticket");
  if (at === -1) return undefined;
  const value = Number(argv[at + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--ticket needs an issue number, got ${JSON.stringify(argv[at + 1])}`);
  }
  return value;
}

export function branchNameFor(ticket: { number: number; title: string }): string {
  const slug = ticket.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `agent/${ticket.number}-${slug || "ticket"}`;
}

/**
 * Idempotent: an escalation publishes, and so does the path that carries on to CI.
 *
 * `Closes #NN` goes in the body and never in a commit message, where it would close the issue at
 * push time — before ci.yml has said anything about the branch.
 */
function publish(ticket: Ticket, branch: string, worktree: string, state: RunState, summary = ""): number {
  if (state.prNumber) return state.prNumber;
  git(worktree, ["push", "-u", "origin", branch]);
  gh([
    "pr", "create", "--repo", REPO, "--base", "main", "--head", branch,
    "--title", ticket.title,
    "--body", `${summary.slice(-4000)}\n\nCloses #${ticket.number}\n`,
  ]);
  const [pr] = ghJson<{ number: number }[]>([
    "pr", "list", "--repo", REPO, "--head", branch, "--json", "number",
  ]);
  if (!pr) throw new Stop("the pull request was created but cannot be found");
  state.prNumber = pr.number;
  say(`opened #${pr.number}`);
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
    stage(`fix ${fixRounds}`, fixPrompt(verdict, fixRounds), "sonnet", "high", worktree);
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

  const evidence = stage("implement", implementPrompt(ticket), "sonnet", "high", worktree);
  commitLeftovers(worktree, `Implement #${ticket.number}`);
  if (commitsAhead(worktree) === 0) throw new Stop("the implement agent committed nothing");

  // On the real diff, not on paths guessed out of the ticket's prose: a well-written ticket names
  // every file worth reading, which is a much larger set than the files a fix touches. The work is
  // published either way — an escalation is a question for the owner, not a reason to bin a diff.
  const gate = needsDesignFirstGate({
    filesTouched: changedFiles(worktree),
    body: ticket.body,
    comments: ticket.comments,
  });
  if (gate.escalate) {
    publish(ticket, branch, worktree, state, evidence);
    throw new Stop(`design-first gate: ${gate.reason}. The diff is on #${state.prNumber}.`);
  }

  stage("review", reviewPrompt(ticket, evidence), "opus", "max", worktree);
  commitLeftovers(worktree, "Apply review findings");

  const prNumber = publish(ticket, branch, worktree, state, evidence);

  driveToGreen(branch, prNumber, worktree);
  land(branch, prNumber, worktree, state);
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

  // `git worktree remove` unregisters first and deletes second, and on Windows the delete loses to
  // whatever still holds a handle on the directory a stage just exited. Git reports the failure and
  // the registration is already gone, so nothing tries again: thirteen orphaned directories under
  // `.worktrees/` were made exactly this way. `rmSync`'s retries are for this case.
  if (state.worktreePath) {
    try {
      rmSync(path.resolve(state.worktreePath), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (error) {
      say(`the worktree directory outlived the run: ${(error as Error).message}`);
    }
  }
}

function main(): number {
  execFileSync("node", ["scripts/preflight.mjs"], { stdio: "inherit" });

  const ticket = pickTicket(forcedTicket(process.argv.slice(2)));
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
