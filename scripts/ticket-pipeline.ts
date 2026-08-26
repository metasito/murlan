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
 * prompt decides control flow, and nothing here decides whether the work was worth doing —
 * ci.yml is the gate, and the only one.
 *
 * Nothing an agent says about what it did is believed. Git is asked instead.
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { classify, pickRoute } from "./next-ticket.mjs";
import { runAgent, type Effort } from "../lib/ticketPipeline/agent.ts";
import { claimTicket, releaseTicket } from "../lib/ticketPipeline/claim.ts";
import { readVerdict, ghExecOptions, type Verdict } from "../lib/ticketPipeline/ciVerdict.ts";
import { buildCleanupCommands } from "../lib/ticketPipeline/cleanup.ts";
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

function k(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

// ---------------------------------------------------------------- git as the witness

function commitsAhead(cwd: string): number {
  return Number(git(cwd, ["rev-list", "--count", "origin/main..HEAD"]).trim());
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
function implementPrompt(ticket: Ticket, commitsAlready: number): string {
  return [
    "/mattpocock-skills:implement",
    "",
    `Implement issue #${ticket.number} of ${REPO}, given below in full — the comments as much as`,
    "the body. Take it to a finished state: you are the only stage that writes code, and ci.yml can",
    "only tell you whether you broke something. No stubs, no deferring a part the ticket asked for,",
    "no test that asserts around the part that was hard.",
    "",
    // Commits are not completion, so the runner does not read them as any. An earlier run may have
    // stopped anywhere: finished, half-finished, or down a path worth abandoning.
    commitsAlready > 0
      ? `This branch already carries ${commitsAlready} commit(s) from an earlier run. Read \`git log ` +
        "-p origin/main..HEAD` before anything else and judge it against the ticket yourself: " +
        "finish what is unfinished, fix what is wrong, and leave alone what is already right. If " +
        "the ticket is genuinely complete, say so and commit nothing.\n"
      : "",
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
    // The one real loss this pipeline has suffered: an agent died on a network error 12 minutes
    // in, having written 31 files and staged none, and there were no objects to recover.
    "Commit as you finish each piece, not once at the end — an unstaged edit is the only work this",
    "pipeline can actually lose. Do not push and do not open a pull request.",
    "",
    "Your reply becomes the pull request body a human reads, so write it as one: what changed and",
    "how you know, the Definition of done boxes closed and any not, and end with the exact commands",
    "you ran and watched pass, one per line. No preamble about what you were instructed to do. The",
    "reviewer is given that command list as evidence, so what you leave out is what gets run twice.",
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
  const { input, cacheRead, cacheWrite, output } = result.usage;
  say(`--- ${name} done in ${minutes}m, ${result.turns} turns, $${result.costUsd.toFixed(2)} ---`);
  say(
    `    in ${k(input + cacheRead + cacheWrite)} (${k(cacheRead)} cached, ${k(cacheWrite)} written)` +
      `, out ${k(output)}`
  );
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
 * The closing reference lives here rather than in a commit message (RULES.md rule 13) because a
 * commit closes the issue at push time, before ci.yml has said anything about the branch.
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
  // `origin/main` is only as current as the last fetch. Branch from a stale one and the pull
  // request opens BEHIND, so landing sends it to `update-branch` and the whole suite runs a second
  // time on a tree the first run already passed.
  bash("git fetch origin --quiet", { fatal: false });

  const worktree = standUpWorktree(ticket, branch, state);

  const evidence = stage("implement", implementPrompt(ticket, commitsAhead(worktree)), "sonnet", "high", worktree);
  commitLeftovers(worktree, `Implement #${ticket.number}`);
  if (commitsAhead(worktree) === 0) throw new Stop("nothing is committed on the branch");

  stage("review", reviewPrompt(ticket, evidence), "opus", "max", worktree);
  commitLeftovers(worktree, "Apply review findings");

  const prNumber = publish(ticket, branch, worktree, state, evidence);
  driveToGreen(branch, prNumber, worktree);
  land(branch, prNumber, worktree, state);
}

/**
 * A worktree on the ticket's branch, whether or not the branch already exists.
 *
 * Reusing a branch that is already there is what stops a stopped run from being a wasted one:
 * #278 was implemented in 26 minutes and $5.41 and there was no way back to it afterwards. What
 * is left of that work, and whether any of it still needs doing, is the implement stage's reading
 * of the ticket — not something a commit count can answer.
 */
function standUpWorktree(ticket: Ticket, branch: string, state: RunState): string {
  const relative = worktreePathFor(ticket.number);
  const existing = git(process.cwd(), ["ls-remote", "--heads", "origin", branch]).trim();
  state.worktreePath = relative;

  if (existing) {
    bash(`git worktree add ${JSON.stringify(relative)} ${JSON.stringify(branch)}`);
  } else {
    bash(buildWorktreeCommands({ number: ticket.number, branch }).join(" && "));
  }
  return path.resolve(relative);
}

/**
 * Whether `git worktree list --porcelain` still names this path. Windows compares paths without
 * case, and a mismatch here reads a live worktree as an orphan — which is a directory deleted.
 */
export function isRegisteredWorktree(porcelain: string, target: string): boolean {
  const wanted = path.resolve(target);
  return porcelain
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length).trim()))
    .some((p) => (process.platform === "win32" ? p.toLowerCase() === wanted.toLowerCase() : p === wanted));
}

/**
 * `git worktree remove` unregisters first and deletes second, and on Windows the delete loses to
 * whatever still holds a handle on the directory a stage has just exited. Git reports the failure
 * with the registration already gone, and nothing tries again — thirteen orphaned directories under
 * `.worktrees/` were made exactly this way.
 *
 * A registration still standing is the cleanup step having *decided to keep* the worktree, because
 * it holds work nobody has staged. So this deletes only what git has already let go of, and keeps
 * anything it cannot read: an implement agent that died mid-edit wrote 31 files that a `--force`
 * teardown then destroyed, and there were no objects left to recover them from.
 */
function removeOrphanedDirectory(worktreePath: string): void {
  const absolute = path.resolve(worktreePath);
  if (!existsSync(absolute)) return;

  let listed: string;
  try {
    listed = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" });
  } catch (error) {
    say(`kept ${worktreePath}: git could not be asked whether it still owns it — ${(error as Error).message}`);
    return;
  }
  if (isRegisteredWorktree(listed, absolute)) {
    say(`kept ${worktreePath}: git still has a registration for it, so cleanup chose to keep it`);
    return;
  }

  try {
    rmSync(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (error) {
    say(`the worktree directory outlived the run: ${(error as Error).message}`);
  }
}

function teardown(ticket: Ticket, state: RunState, why: string): void {
  try {
    if (state.merged) {
      // The merge closes the issue through the pull request body, but nothing takes the claim's
      // label off, and a closed ticket wearing `in-progress` reads as a run still going.
      gh(["issue", "edit", String(ticket.number), "--repo", REPO, "--remove-label", "in-progress"]);
    } else {
      releaseTicket(REPO, ticket.number, why);
      say(`released #${ticket.number}: ${why}`);
    }
  } catch (error) {
    say(`could not hand #${ticket.number} back: ${(error as Error).message}`);
  }

  // `gh pr merge --delete-branch` removes origin's copy and leaves the local one, which then
  // stands as the branch a later run's staleness check reads as a live claim. The delete below
  // asks `origin/main..branch` first and keeps anything ahead of it, so it needs a current
  // `origin/main` to compare against — without the fetch, a just-merged branch reads as unmerged
  // and survives.
  bash("git fetch origin main --quiet", { fatal: false });
  for (const command of buildCleanupCommands({
    worktreePath: state.worktreePath,
    dockerStarted: false,
    localBranch: state.localBranch,
    merged: false,
  })) {
    bash(command, { fatal: false });
  }

  if (state.worktreePath) removeOrphanedDirectory(state.worktreePath);
}

function main(): number {
  execFileSync("node", ["scripts/preflight.mjs"], { stdio: "inherit" });

  const ticket = pickTicket(forcedTicket(process.argv.slice(2)));
  if (!ticket) return 0;
  say(`#${ticket.number} — ${ticket.title}`);

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
