// tools/loop/ciVerdict.ts
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { UNREAD_STEP } from "../ci/budget-gate.mjs";
import type { PrState } from "./land.ts";

const CI_GATE = "CI gate";

export interface RunRow {
  databaseId: number;
  conclusion: string | null;
  status: string;
  /** Optional so a caller reasoning about a single run need not invent one. */
  headSha?: string;
  attempt?: number;
}

export interface JobRow {
  name: string;
  conclusion: string | null;
  steps: number;
  status?: string;
  id?: number;
  timedOut?: boolean;
  failedSteps?: string[];
}

/**
 * GitHub reports a job stopped by its own `timeout-minutes` exactly as one cancelled by a newer
 * push: job and run `cancelled`, a cancelled step. Only its check-run annotation tells them apart.
 */
export function markTimedOut(jobs: JobRow[], gh: (args: string[]) => string, repo: string): void {
  for (const job of jobs) {
    if (job.conclusion !== "cancelled" || job.steps === 0 || job.id === undefined) continue;
    try {
      const messages = JSON.parse(gh(["api", `repos/${repo}/check-runs/${job.id}/annotations`, "--jq", "[.[].message]"]));
      job.timedOut = messages.some((m: string) => /exceeded the maximum execution time/.test(m));
    } catch {
      job.timedOut = false;
    }
    if (job.timedOut) return;
  }
}

export function failedLogArgs(repo: string, runId: number, jobs: JobRow[], failedStep?: string, attempt?: number): string[] {
  const timedOut = jobs.find((j) => j.timedOut && j.name === failedStep);
  // `--log-failed` prints only failed steps, and a timed-out job's step reads cancelled. A job id
  // names one attempt already; a run id names its latest unless asked.
  return timedOut
    ? ["run", "view", "--job", String(timedOut.id), "--repo", repo, "--log"]
    : ["run", "view", String(runId), "--repo", repo, "--log-failed", ...(attempt ? ["--attempt", String(attempt)] : [])];
}

/** How far a run still going has got, for the board. It says nothing about the verdict. */
export interface CiProgress {
  done: number;
  total: number;
  running: string | null;
  failed: string | null;
}

export function ciProgress(jobs: JobRow[]): CiProgress {
  const done = jobs.filter((j) => j.status === "completed");
  return {
    done: done.length,
    total: jobs.length,
    running: jobs.find((j) => j.status === "in_progress")?.name ?? null,
    failed: done.find((j) => j.conclusion === "failure")?.name ?? null,
  };
}

export interface Verdict {
  pass: boolean;
  /** A live run has not answered yet, which is not a failure: the landing waits rather than counting it red. */
  waiting?: boolean;
  /** No run at all yet — waited for on its own budget, since one that never appears never will. */
  appearing?: boolean;
  /** `output` is the reason the log is missing, not the log. A fix round cannot be built on it. */
  logUnread?: boolean;
  runId?: number;
  failedStep?: string;
  output?: string;
  infrastructure?: boolean;
  head?: string | null;
  /** Every failing test id the full log named — never just the tail `output` carries. */
  testIds?: string[];
  /** The `gh` arguments that read the log `output` and `testIds` came from. */
  logArgs?: string[];
  progress?: CiProgress;
  /** The red run's attempt: the supervisor reruns only an attempt 1, so a red is rerun once. */
  attempt?: number;
  reason: string;
}

/**
 * The verdict, from data only — never from a command's exit status.
 *
 * `gh pr checks --watch` sets its status from the run, but piped into anything that status belongs
 * to the pipe's last command, so a failed run reads as a pass. That is how a red branch reached
 * main. Here the answer comes from the run's own `conclusion` field and nothing else.
 *
 * A job that finished with no steps ran nothing, so it says nothing about the diff: billing, a
 * quota or a runner failure looks identical to a red suite from outside. That is reported as
 * infrastructure rather than as a defect, because sending a fix agent after it hunts a bug no
 * suite ever reported. A run that cannot be found at all is the same case: an outage between
 * here and the API is indistinguishable from a branch nothing ever ran.
 */
export function decideVerdict(run: RunRow | undefined, jobs: JobRow[] = []): Verdict {
  if (!run) {
    return { pass: false, appearing: true, infrastructure: true, reason: "no run found for this branch" };
  }
  if (run.status !== "completed") {
    return { pass: false, waiting: true, runId: run.databaseId, reason: `run is still ${run.status}` };
  }
  if (run.conclusion === "success") {
    return { pass: true, runId: run.databaseId, reason: "ci.yml passed" };
  }
  // `CI gate` runs under `always()` and fails whenever another job did not pass: its red is the
  // cause only when no other job's is.
  const gate = jobs.find((j) => j.name === CI_GATE && j.conclusion === "failure");
  // Lists storage never served say nothing about the diff.
  const unread = jobs.find((j) => j.conclusion === "failure" && j.failedSteps?.length && j.failedSteps.every((s) => s === UNREAD_STEP));
  jobs = jobs.filter((j) => j.name !== CI_GATE && j !== unread);
  // A job that actually failed outranks one that ran nothing, and the order matters: a run that
  // fails fast cancels its siblings, and a cancelled job that never reached its first step is
  // stepless. Asked the other way round, this reported `infrastructure` and named the cancelled
  // job — hiding a real red `Secret scan` for two rounds, which is exactly the fix round the
  // infrastructure verdict exists to prevent being wasted. A cancelled run is the same case:
  // rereading it never changes its jobs, so a red among them must reach the fix round.
  const realFailure = jobs.find((j) => j.conclusion === "failure" && j.steps > 0) ?? jobs.find((j) => j.timedOut);

  // ci.yml's concurrency group cancels an in-progress pull-request run on every new push, so this
  // is the common path, not an edge. Asked through the jobs instead, the ones that never started
  // carry conclusion null with zero steps and read as a stepless runner failure.
  if (run.conclusion === "cancelled" && !realFailure) {
    return { pass: false, runId: run.databaseId, infrastructure: true, reason: "the run was cancelled" };
  }

  // A skipped job reports zero steps too, and it means the opposite: its gate answered, rather
  // than the runner never starting. `android-build`/`ios-build` skip on every run that does not
  // need them, so counting them here would call every genuinely red run infrastructure and stop
  // `driveToGreen` from ever sending a fix agent. `cancelled` is the same: the run was stopped
  // from outside, so the job says nothing about the runner either. `null` is a job that never
  // started, which is the same: it is not evidence that the runner failed.
  const stepless = jobs.filter(
    (j) =>
      j.conclusion !== null &&
      j.conclusion !== "success" &&
      j.conclusion !== "skipped" &&
      j.conclusion !== "cancelled" &&
      j.steps === 0,
  );
  if (!realFailure && stepless.length > 0) {
    return {
      pass: false,
      runId: run.databaseId,
      infrastructure: true,
      failedStep: stepless[0].name,
      reason: `${stepless[0].name} ran no steps, so the run says nothing about the diff`,
    };
  }
  if (!realFailure && unread) {
    return {
      pass: false,
      runId: run.databaseId,
      infrastructure: true,
      failedStep: unread.name,
      reason: `${unread.name} could not read the run's over-budget lists, so the run says nothing about the diff`,
    };
  }
  // The gate's own log names the job it saw fail or cancelled, so it is the fix round's payload.
  if (!realFailure && gate) {
    return {
      pass: false,
      runId: run.databaseId,
      failedStep: CI_GATE,
      reason: `${CI_GATE} failed while no other job did; its log names the job it saw fail`,
    };
  }

  return {
    pass: false,
    runId: run.databaseId,
    failedStep: realFailure?.name,
    reason: realFailure?.timedOut
      ? `${realFailure.name} ran past its timeout-minutes`
      : `ci.yml concluded ${run.conclusion}`,
  };
}

/**
 * `gh run view --log-failed` for a browser-test job runs to several megabytes, and
 * `execFileSync`'s default 1MB buffer turns that into an ENOBUFS throw rather than a short read.
 * Caught, it reached the fix agent as "(could not read the failed log)", so every fix round on a
 * job with a large log reproduced from nothing a failure CI had already described.
 */
const GH_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * How much of it reaches the fix agent. A Playwright failure ends with a run summary, and the
 * `Error:` line that names the defect sits above it — 135 lines up, in the run that prompted this.
 * Sixty was the old budget and reached none of it.
 */
const FAILED_LOG_LINES = 400;

/**
 * Every line of a `gh` job log is prefixed with its job, its step and an ISO timestamp — around
 * fifty-five characters of the same text on each. Dropping it is what makes a tail this wide
 * affordable in a prompt. Lines that do not carry the prefix are left exactly as they are.
 */
export function stripLogPrefix(line: string): string {
  return line.replace(/^[^\t]*\t[^\t]*\t\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "");
}

const PLAYWRIGHT_FAILURE = /^\s*(?:\d+\)\s*)?\[[\w.-]+\]\s*›\s*(\S+):\d+:\d+\s*›\s*(.+?)\s*$/gm;
const JEST_FAILURE = /^FAIL\s+(?:[^\s/\\]+\s+)?(\S*[/\\]\S*)/gm;
// `npm test`'s spec reporter, not TAP: each recap entry is this file:line:col line immediately
// followed by the `✖ <name> (<n>ms)` line naming it (.loop-logs/ci-1079.log:318-319).
const NODE_TEST_FAILURE = /^test at (\S+):\d+:\d+\r?\n✖ (.+?) \([\d.]+ms\)\s*$/gm;

export function failingTestIds(fullLog: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };

  for (const m of fullLog.matchAll(PLAYWRIGHT_FAILURE)) add(`${m[1]} › ${m[2]}`);
  for (const m of fullLog.matchAll(JEST_FAILURE)) add(m[1]);
  for (const m of fullLog.matchAll(NODE_TEST_FAILURE)) add(`${m[1]} › ${m[2]}`);

  return ids;
}

/**
 * The ceiling on one read. Every call here is synchronous, so a wedged `gh` with no timeout is the
 * supervisor's whole event loop — no board, no clock, no bell. It is the whole read rather than
 * each call because a read makes four `gh` calls in sequence and a per-call ceiling multiplies by
 * four while saying nothing about the total.
 */
const READ_DEADLINE_MS = 45 * 60_000;

/** Whatever is left of the read's budget, so sixteen calls cannot each take the whole of it. */
export function ghExecOptions(until = Date.now() + READ_DEADLINE_MS): ExecFileSyncOptionsWithStringEncoding {
  return {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: GH_MAX_BUFFER,
    // Never zero or negative: `execFileSync` reads those as "no timeout", which is the opposite of
    // what an exhausted budget means.
    timeout: Math.max(1_000, until - Date.now()),
  };
}

export type GhExec = (args: string[], until: number) => string;

const realGh: GhExec = (args, until) => execFileSync("gh", args, ghExecOptions(until));

function ghJson<T>(gh: GhExec, args: string[], fallback: T, until: number): T {
  try {
    return JSON.parse(gh(args, until)) as T;
  } catch {
    return fallback;
  }
}

function jobsAndLog(
  repo: string,
  run: RunRow | undefined,
  gh: GhExec,
  until: number
): { verdict: Verdict; testIds: string[] } {
  if (!run || run.conclusion === "success") {
    return { verdict: decideVerdict(run, []), testIds: [] };
  }
  const jobs = ghJson<JobRow[]>(
    gh,
    [
      "run",
      "view",
      String(run.databaseId),
      "--repo",
      repo,
      "--json",
      "jobs",
      "--jq",
      '[.jobs[] | {name, conclusion, status, steps: (.steps | length), id: .databaseId, failedSteps: [.steps[] | select(.conclusion == "failure") | .name]}]',
    ],
    [],
    until
  );
  if (run.status !== "completed") {
    return { verdict: { ...decideVerdict(run, []), progress: ciProgress(jobs) }, testIds: [] };
  }
  markTimedOut(jobs, (args) => gh(args, until), repo);
  const verdict = decideVerdict(run, jobs);
  let testIds: string[] = [];
  if (!verdict.pass && !verdict.infrastructure) {
    verdict.logArgs = failedLogArgs(repo, run.databaseId, jobs, verdict.failedStep);
    try {
      const strippedLines = gh(verdict.logArgs, until)
        .split("\n")
        .map(stripLogPrefix);
      testIds = failingTestIds(strippedLines.join("\n"));
      verdict.output = strippedLines.slice(-FAILED_LOG_LINES).join("\n");
    } catch (error) {
      // Naming the reason: a fix agent told only that the log is unreadable cannot tell a tooling
      // failure from a job that logged nothing, and reproduces the run either way. `logUnread` says
      // the same thing to the supervisor, which must not spend a fix round on a sentence.
      verdict.logUnread = true;
      verdict.output = `(the failed log could not be read: ${(error as Error)?.message ?? error})`;
    }
  }
  return { verdict, testIds };
}

/** One entry of `gh pr view --json statusCheckRollup`; a commit status carries `context` instead of `name`. */
interface RollupEntry {
  name?: string;
  status?: string;
  conclusion?: string;
  detailsUrl?: string;
  startedAt?: string;
  completedAt?: string;
}

/** An unfinished check reports `completedAt` as year 1, which parses to a time before any start. */
const lastMoved = (e: RollupEntry) => Math.max(Date.parse(e.startedAt ?? "") || 0, Date.parse(e.completedAt ?? "") || 0);

export interface LandingState {
  pr: PrState & { headRefOid: string };
  ci: Verdict;
  progress: CiProgress;
}

const RUN_OF = /\/actions\/runs\/(\d+)\//;

function rollupProgress(entries: RollupEntry[]): CiProgress {
  return ciProgress(
    entries
      .filter((e) => e.name && e.name !== CI_GATE)
      .map((e) => ({ name: e.name!, steps: 0, status: e.status?.toLowerCase(), conclusion: e.conclusion?.toLowerCase() || null })),
  );
}

function gateVerdict(repo: string, entries: RollupEntry[], gh: GhExec, until: number): Verdict {
  // A workflow_dispatch run on the same head reports a gate of its own beside the push's.
  const gate = entries.filter((e) => e.name === CI_GATE).reduce<RollupEntry | undefined>((a, e) => (a && lastMoved(a) > lastMoved(e) ? a : e), undefined);
  if (!gate) {
    return entries.length
      ? { pass: false, waiting: true, reason: `${CI_GATE} has not reported` }
      : { pass: false, appearing: true, infrastructure: true, reason: "no check has reported on this head" };
  }
  const runId = Number(RUN_OF.exec(gate.detailsUrl ?? "")?.[1]) || undefined;
  if (gate.status !== "COMPLETED") {
    return { pass: false, waiting: true, runId, reason: `${CI_GATE} is ${String(gate.status).toLowerCase()}` };
  }
  if (gate.conclusion === "SUCCESS") return { pass: true, runId, reason: `${CI_GATE} passed` };
  if (!runId) {
    return { pass: false, infrastructure: true, reason: `${CI_GATE} concluded ${gate.conclusion} on a run its link does not name` };
  }
  const run = ghJson<RunRow | undefined>(
    gh,
    ["run", "view", String(runId), "--repo", repo, "--json", "databaseId,status,conclusion,headSha,attempt"],
    undefined,
    until
  );
  const { verdict, testIds } = jobsAndLog(repo, run, gh, until);
  return { ...verdict, testIds, attempt: run?.attempt };
}

/**
 * The pull request and its required gate, from one read. The gate's own run is read only when the
 * gate is red, for the jobs and log a fix round is built on. A `pr view` that fails throws: whether
 * that is the network or GitHub's refusal is the caller's to judge.
 */
export function readLandingState(
  repo: string,
  prNumber: number,
  gh: GhExec = realGh,
  until = Date.now() + READ_DEADLINE_MS
): LandingState {
  const view = JSON.parse(
    gh(
      [
        "pr",
        "view",
        String(prNumber),
        "--repo",
        repo,
        "--json",
        "headRefOid,state,mergeable,mergeStateStatus,autoMergeRequest,statusCheckRollup",
      ],
      until
    )
  );
  const entries: RollupEntry[] = view.statusCheckRollup ?? [];
  const progress = rollupProgress(entries);
  const ci = gateVerdict(repo, entries, gh, until);
  return {
    pr: {
      headRefOid: view.headRefOid,
      state: view.state,
      mergeable: view.mergeable,
      mergeStateStatus: view.mergeStateStatus,
      armed: view.autoMergeRequest != null,
    },
    ci: { ...ci, head: view.headRefOid ?? null, ...(ci.waiting ? { progress } : {}) },
    progress,
  };
}

