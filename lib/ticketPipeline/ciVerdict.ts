// lib/ticketPipeline/ciVerdict.ts
import { execFileSync } from "node:child_process";

export interface RunRow {
  databaseId: number;
  conclusion: string | null;
  status: string;
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
 * suite ever reported.
 */
export function decideVerdict(run: RunRow | undefined, jobs: JobRow[] = []): Verdict {
  if (!run) return { pass: false, reason: "no run found for this branch" };
  if (run.status !== "completed") {
    return { pass: false, runId: run.databaseId, reason: `run is still ${run.status}` };
  }
  if (run.conclusion === "success") {
    return { pass: true, runId: run.databaseId, reason: "ci.yml passed" };
  }

  const stepless = jobs.filter((j) => j.conclusion !== "success" && j.steps === 0);
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

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function ghJson<T>(args: string[], fallback: T): T {
  try {
    return JSON.parse(gh(args)) as T;
  } catch {
    return fallback;
  }
}

export function readVerdict(repo: string, branch: string, prNumber: number): Verdict {
  try {
    // Blocks until the checks settle. Its exit status is deliberately ignored.
    execFileSync("gh", ["pr", "checks", String(prNumber), "--repo", repo, "--watch", "--interval", "20"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // A non-zero exit here means "checks failed", which the run row below states properly.
  }

  const runs = ghJson<RunRow[]>(
    ["run", "list", "--repo", repo, "--branch", branch, "--limit", "1", "--json", "databaseId,conclusion,status"],
    []
  );
  const run = runs[0];
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
        .slice(-60)
        .join("\n");
    } catch {
      verdict.output = "(could not read the failed log)";
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
