// tools/loop/ciVerdict.ts
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";

export interface RunRow {
  databaseId: number;
  conclusion: string | null;
  status: string;
  /** Optional so a caller reasoning about a single run need not invent one. */
  headSha?: string;
}

export interface JobRow {
  name: string;
  conclusion: string | null;
  steps: number;
}

export interface Verdict {
  pass: boolean;
  /** The run has not answered yet, which is not a failure. `settle` waits on this rather than budgeting it. */
  waiting?: boolean;
  runId?: number;
  failedStep?: string;
  output?: string;
  infrastructure?: boolean;
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
    return { pass: false, waiting: true, infrastructure: true, reason: "no run found for this branch" };
  }
  if (run.status !== "completed") {
    return { pass: false, waiting: true, runId: run.databaseId, reason: `run is still ${run.status}` };
  }
  if (run.conclusion === "success") {
    return { pass: true, runId: run.databaseId, reason: "ci.yml passed" };
  }
  // ci.yml's concurrency group cancels an in-progress pull-request run on every new push, so this
  // is the common path, not an edge. Asked through the jobs instead, the ones that never started
  // carry conclusion null with zero steps and read as a stepless runner failure.
  if (run.conclusion === "cancelled") {
    return { pass: false, runId: run.databaseId, infrastructure: true, reason: "the run was cancelled" };
  }

  // A job that actually failed outranks one that ran nothing, and the order matters: a run that
  // fails fast cancels its siblings, and a cancelled job that never reached its first step is
  // stepless. Asked the other way round, this reported `infrastructure` and named the cancelled
  // job — hiding a real red `Secret scan` for two rounds, which is exactly the fix round the
  // infrastructure verdict exists to prevent being wasted.
  const realFailure = jobs.find((j) => j.conclusion === "failure" && j.steps > 0);

  // A skipped job reports zero steps too, and it means the opposite: its gate answered, rather
  // than the runner never starting. `android-build`/`ios-build` skip whenever no native input
  // changed, so counting them here would call every genuinely red run infrastructure and stop
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

  const failed = realFailure ?? jobs.find((j) => j.conclusion === "failure");
  return {
    pass: false,
    runId: run.databaseId,
    failedStep: failed?.name,
    reason: `ci.yml concluded ${run.conclusion}`,
  };
}

/**
 * ci.yml is the gate, and the branch carries other workflows — the Maestro suites, EAS — that
 * finish on their own schedule. Unfiltered, `--limit 1` answers with whichever of them ran last,
 * so a green Maestro over a red ci.yml reads as a green branch.
 */
export function runListArgs(repo: string, branch: string): string[] {
  // prettier-ignore
  return [
    "run", "list", "--repo", repo, "--branch", branch,
    "--workflow", "ci.yml", "--limit", "5",
    "--json", "databaseId,conclusion,status,headSha",
  ];
}

/**
 * A fix round pushes and asks immediately. For the seconds before the new run registers, the
 * newest row on the branch belongs to the previous push — completed, and red, which is why the
 * round ran at all. Answering from it sends another fix agent after a failure already fixed.
 */
export function runForHead(runs: RunRow[], headSha: string | undefined): RunRow | undefined {
  if (!headSha) return runs[0];
  return runs.find((r) => r.headSha === headSha);
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

function gh(args: string[], until: number): string {
  return execFileSync("gh", args, ghExecOptions(until));
}

function ghJson<T>(args: string[], fallback: T, until: number): T {
  try {
    return JSON.parse(gh(args, until)) as T;
  } catch {
    return fallback;
  }
}

export function readVerdict(
  repo: string,
  branch: string,
  prNumber: number,
  until = Date.now() + READ_DEADLINE_MS
): Verdict {
  // The pull request carries other checks — the Maestro suites — that settle on their own
  // schedule and are not the gate. Waiting on all of them cost eleven minutes a run for a job
  // that is red on main anyway, so only ci.yml's own run is watched.
  const headSha = ghJson<{ headRefOid?: string }>(
    ["pr", "view", String(prNumber), "--repo", repo, "--json", "headRefOid"],
    {},
    until
  ).headRefOid;

  // Waiting belongs to `settle`, which polls anyway; `gh run watch` here froze the whole event loop.
  const run = runForHead(ghJson<RunRow[]>(runListArgs(repo, branch), [], until), headSha);
  if (!run || run.status !== "completed" || run.conclusion === "success") {
    return decideVerdict(run, []);
  }

  const jobs = ghJson<JobRow[]>(
    [
      "run",
      "view",
      String(run.databaseId),
      "--repo",
      repo,
      "--json",
      "jobs",
      "--jq",
      "[.jobs[] | {name, conclusion, steps: (.steps | length)}]",
    ],
    [],
    until
  );
  const verdict = decideVerdict(run, jobs);
  if (!verdict.pass && !verdict.infrastructure) {
    try {
      verdict.output = gh(["run", "view", String(run.databaseId), "--repo", repo, "--log-failed"], until)
        .split("\n")
        .slice(-FAILED_LOG_LINES)
        .map(stripLogPrefix)
        .join("\n");
    } catch (error) {
      // Naming the reason: a fix agent told only that the log is unreadable cannot tell a tooling
      // failure from a job that logged nothing, and reproduces the run either way.
      verdict.output = `(the failed log could not be read: ${(error as Error)?.message ?? error})`;
    }
  }
  return verdict;
}

