// lib/ticketPipeline/ciVerdict.ts
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
    return { pass: false, infrastructure: true, reason: "no run found for this branch" };
  }
  if (run.status !== "completed") {
    return { pass: false, runId: run.databaseId, reason: `run is still ${run.status}` };
  }
  if (run.conclusion === "success") {
    return { pass: true, runId: run.databaseId, reason: "ci.yml passed" };
  }

  // A skipped job reports zero steps too, and it means the opposite: its gate answered, rather
  // than the runner never starting. `android-build`/`ios-build` skip whenever no native input
  // changed, so counting them here would call every genuinely red run infrastructure and stop
  // `driveToGreen` from ever sending a fix agent.
  const stepless = jobs.filter(
    (j) => j.conclusion !== "success" && j.conclusion !== "skipped" && j.steps === 0,
  );
  if (stepless.length > 0) {
    return {
      pass: false,
      runId: run.databaseId,
      infrastructure: true,
      failedStep: stepless[0].name,
      reason: `${stepless[0].name} ran no steps, so the run says nothing about the diff`,
    };
  }

  const failed = jobs.find((j) => j.conclusion === "failure");
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

// A push and the run it starts are not the same instant, and the API is reachable across a whole
// ci.yml run and then not for the second it is asked for the verdict. Both read as "no run
// found" with the branch underneath green — which is how #342 was handed back as red.
const RUN_APPEAR_ATTEMPTS = 12;
const RUN_APPEAR_INTERVAL_MS = 10_000;

/** Blocking on purpose: this module is a one-shot CLI whose caller is waiting on stdout. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

export function ghExecOptions(): ExecFileSyncOptionsWithStringEncoding {
  return { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GH_MAX_BUFFER };
}

function gh(args: string[]): string {
  return execFileSync("gh", args, ghExecOptions());
}

function ghJson<T>(args: string[], fallback: T): T {
  try {
    return JSON.parse(gh(args)) as T;
  } catch {
    return fallback;
  }
}

export function readVerdict(repo: string, branch: string, prNumber: number): Verdict {
  // The pull request carries other checks — the Maestro suites — that settle on their own
  // schedule and are not the gate. Waiting on all of them cost eleven minutes a run for a job
  // that is red on main anyway, so only ci.yml's own run is watched.
  const headSha = ghJson<{ headRefOid?: string }>(
    ["pr", "view", String(prNumber), "--repo", repo, "--json", "headRefOid"],
    {}
  ).headRefOid;

  let run: RunRow | undefined;
  for (let attempt = 1; attempt <= RUN_APPEAR_ATTEMPTS; attempt++) {
    run = runForHead(ghJson<RunRow[]>(runListArgs(repo, branch), []), headSha);
    if (run) break;
    pause(RUN_APPEAR_INTERVAL_MS);
  }
  if (run && run.status !== "completed") {
    try {
      // Blocks until that one run settles. Its exit status is deliberately ignored: piped, the
      // status belongs to the pipe, which is how a red branch once read as green.
      gh(["run", "watch", String(run.databaseId), "--repo", repo, "--interval", "20"]);
    } catch {
      // A non-zero exit means the run failed, which the row re-read below states properly.
    }
    run = runForHead(ghJson<RunRow[]>(runListArgs(repo, branch), []), headSha) ?? run;
  }
  if (!run || run.conclusion === "success") return decideVerdict(run, []);

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
    []
  );
  const verdict = decideVerdict(run, jobs);
  if (!verdict.pass && !verdict.infrastructure) {
    try {
      verdict.output = gh(["run", "view", String(run.databaseId), "--repo", repo, "--log-failed"])
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

if (process.argv[1]?.endsWith("ciVerdict.ts")) {
  const [repo, branch, prNumber] = process.argv.slice(2);
  if (!repo || !branch || !prNumber) {
    console.error("usage: npx tsx lib/ticketPipeline/ciVerdict.ts <repo> <branch> <prNumber>");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(readVerdict(repo, branch, Number(prNumber))));
}
