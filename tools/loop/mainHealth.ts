// tools/loop/mainHealth.ts
import { execFileSync } from "node:child_process";
import { decideVerdict, failedLogArgs, failingTestIds, markTimedOut, stripLogPrefix, type JobRow, type RunRow } from "./ciVerdict.ts";

/**
 * Whether `main` itself is green, and filing a ticket when it is not.
 *
 * A branch going red parks its own ticket. `main` going red parks nothing — by then the merge has
 * happened and the worktree is gone — so it is filed as an issue, the only thing here that
 * outlives the process that found it.
 */

export interface MainRun extends RunRow {
  url?: string;
}

export interface FiledIssue {
  number: number;
  title: string;
  url?: string;
  state?: string;
}

export type MainHealth =
  | { state: "green"; why: string; runId: number; close: number[] }
  | { state: "unknown"; why: string }
  | { state: "file"; runId: number; failedStep?: string; url?: string; title: string; why: string }
  | { state: "filed"; runId: number; title: string; why: string; url?: string };

/**
 * Separate from `loop` because `loop` is a person's label too: a burst of hand-filed loop tickets
 * would push the one issue the duplicate check needs to see out of any window drawn over them.
 */
export const MAIN_RED_LABEL = "main-red";
const MAIN_RED_LABELS = ["ready-for-agent", "loop", "size:S", MAIN_RED_LABEL];

/**
 * The run id is the key, and it travels in the title so a duplicate is found by listing rather
 * than searching. GitHub's search index trails its own writes by minutes, so a dedupe that asks it
 * files a second issue for exactly the run it was written to deduplicate.
 */
export const titleFor = (runId: number) => `main went red: ci.yml run ${runId}`;

const RUN_IN_TITLE = /\bci\.yml run (\d+)\b/;

export const WINDOW = 10;

/**
 * Only the *latest* ci.yml run on `main` is ever read, and run ids only climb, so the one id that
 * can come round twice is the newest — and the issue naming it is the newest this module wrote.
 * Issues ageing out of `WINDOW` name runs that can never be asked about again.
 */
const runOf = (issue: FiledIssue) => Number(RUN_IN_TITLE.exec(issue.title ?? "")?.[1]);

export function alreadyFiled(runId: number, issues: FiledIssue[]): FiledIssue | undefined {
  return issues.find((i) => runOf(i) === runId);
}

/** Only issues naming an older run: run ids only climb, so one naming a newer run is news this green predates. */
export function staleIssues(greenRunId: number, issues: FiledIssue[]): number[] {
  return issues.filter((i) => i.state === "OPEN" && runOf(i) < greenRunId).map((i) => i.number);
}

/**
 * Routed through the same `decideVerdict` as every branch read, so its two not-the-diff answers —
 * a cancelled run, a stepless runner failure — do not file. Neither is `main` being broken, and a
 * ticket for either sends someone after a bug no suite reported.
 */
export function decideMainHealth(
  run: MainRun | undefined,
  jobs: JobRow[],
  issues: FiledIssue[],
): MainHealth {
  const verdict = decideVerdict(run, jobs);
  if (verdict.pass && run) {
    return { state: "green", why: verdict.reason, runId: run.databaseId, close: staleIssues(run.databaseId, issues) };
  }
  if (!run || verdict.infrastructure || verdict.waiting || verdict.runId === undefined) {
    return { state: "unknown", why: verdict.reason };
  }

  const runId = verdict.runId;
  const title = titleFor(runId);
  const why = verdict.failedStep ? `${verdict.failedStep} failed` : verdict.reason;
  const seen = alreadyFiled(runId, issues);
  return seen
    ? { state: "filed", runId, title, why, url: seen.url }
    : { state: "file", runId, failedStep: verdict.failedStep, url: run.url, title, why };
}

/**
 * `--workflow ci.yml` for the reason `ciVerdict.runListArgs` gives: `main` carries other workflows
 * that finish on their own schedule, and unfiltered `--limit 1` answers with whichever ran last.
 */
export function mainRunArgs(repo: string): string[] {
  // prettier-ignore
  return [
    "run", "list", "--repo", repo, "--branch", "main",
    "--workflow", "ci.yml", "--limit", "1",
    "--json", "databaseId,conclusion,status,headSha,url",
  ];
}

export function filedIssueArgs(repo: string): string[] {
  // prettier-ignore
  return [
    "issue", "list", "--repo", repo, "--label", MAIN_RED_LABEL,
    "--state", "all", "--limit", String(WINDOW), "--json", "number,title,url,state",
  ];
}

export function closeArgs(repo: string, issue: number, greenRunId: number): string[] {
  return ["issue", "close", String(issue), "--repo", repo, "--comment", `main is green again: ci.yml run ${greenRunId}.`];
}

export function jobArgs(repo: string, runId: number): string[] {
  return ["run", "view", String(runId), "--repo", repo, "--json", "jobs"];
}

export function issueArgs(
  repo: string,
  health: Extract<MainHealth, { state: "file" }>,
  headSha: string | undefined,
  labels: string[],
): string[] {
  // prettier-ignore
  return [
    "issue", "create", "--repo", repo,
    "--title", health.title,
    "--body", bodyFor(health, headSha),
    ...labels.flatMap((l) => ["--label", l]),
  ];
}

export function bodyFor(health: Extract<MainHealth, { state: "file" }>, headSha?: string): string {
  return [
    "The most recent `ci.yml` run on `main` failed.",
    "",
    `- run: ${health.url ?? `id ${health.runId}`}`,
    `- commit: ${headSha ?? "not reported"}`,
    `- failing job: ${health.failedStep ?? "not reported by the API"}`,
    "",
    "Every ticket cut from here inherits the failure and reads it as its own.",
    "",
    "Filed by `tools/loop/mainHealth.ts`, which runs before each ticket. The run id in the title",
    "is what stops a second issue being filed for the same run, so keep it there.",
  ].join("\n");
}

/** Runs `gh` and returns its stdout. A non-zero exit throws. */
export type Gh = (args: string[]) => string;

const ghCli: Gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 24 });

const parse = <T,>(text: string, fallback: T): T => (text.trim() ? JSON.parse(text) : fallback);

type RawJobs = { jobs?: { name: string; conclusion: string | null; steps?: unknown[]; databaseId?: number }[] };

function jobRows(gh: Gh, repo: string, raw: RawJobs): JobRow[] {
  const jobs: JobRow[] = (raw.jobs ?? []).map((j) => ({
    name: j.name,
    conclusion: j.conclusion,
    steps: j.steps?.length ?? 0,
    id: j.databaseId,
  }));
  markTimedOut(jobs, gh, repo);
  return jobs;
}

/** Jobs are fetched only when the answer can turn on them. */
export function readMain(gh: Gh, repo: string): { run?: MainRun; jobs: JobRow[] } {
  const [run] = parse<MainRun[]>(gh(mainRunArgs(repo)), []);
  if (!run || run.status !== "completed" || run.conclusion === "success") return { run, jobs: [] };
  return { run, jobs: jobRows(gh, repo, parse<RawJobs>(gh(jobArgs(repo, run.databaseId)), {})) };
}

/**
 * Reads `main` and files the issue if it is red and unreported. Returns what happened; nothing
 * here prints.
 *
 * It never throws: this runs before every ticket, and refusing to start one because GitHub was
 * briefly unreachable turns a check into an outage.
 */
export function checkMain({ repo, gh = ghCli }: { repo: string; gh?: Gh }): MainHealth {
  try {
    const { run, jobs } = readMain(gh, repo);
    const health = decideMainHealth(run, jobs, parse<FiledIssue[]>(gh(filedIssueArgs(repo)), []));
    if (health.state === "green") {
      for (const issue of health.close) {
        try {
          gh(closeArgs(repo, issue, health.runId));
        } catch {
          // A close that fails is retried by the next green read; it must not make green read as unknown.
        }
      }
    }
    if (health.state !== "file") return health;
    const url = gh(issueArgs(repo, health, run?.headSha, MAIN_RED_LABELS)).trim().split("\n").at(-1);
    return { state: "filed", runId: health.runId, title: health.title, why: health.why, url };
  } catch (e) {
    const [first] = String((e as Error).message).split("\n");
    return { state: "unknown", why: `could not read main — ${first}` };
  }
}

export interface MainFailures {
  runId: number;
  url?: string;
  ids: string[];
  /** The ids failed attempt 1 of the pull-request run a green main inherited: flakes, not main's reds. */
  flaky?: true;
}

function failuresOf(gh: Gh, repo: string, run: RunRow, jobs: JobRow[], attempt?: number): string[] | null {
  const verdict = decideVerdict(run, jobs);
  if (verdict.pass || verdict.infrastructure) return null;
  const log = gh(failedLogArgs(repo, run.databaseId, jobs, verdict.failedStep, attempt));
  return failingTestIds(log.split("\n").map(stripLogPrefix).join("\n"));
}

const treeOf = (gh: Gh, repo: string, sha: string) => gh(["api", `repos/${repo}/commits/${sha}`, "--jq", ".commit.tree.sha"]).trim();

/**
 * ci.yml's scope job skips main's suite when main's tree is a pull-request head's that already has a
 * green run, so main's green is that run's — and a rerun's green says nothing of its attempt 1.
 */
function inheritedFlakes(gh: Gh, repo: string, main: MainRun): MainFailures | null {
  if (!main.headSha) return null;
  const head = gh(["api", `repos/${repo}/commits/${main.headSha}/pulls`, "--jq", ".[0].head.sha // empty"]).trim();
  if (!head || treeOf(gh, repo, main.headSha) !== treeOf(gh, repo, head)) return null;
  // prettier-ignore
  const [source] = parse<{ databaseId: number; attempt?: number; url?: string }[]>(gh([
    "run", "list", "--repo", repo, "--workflow", "ci.yml", "--commit", head,
    "--status", "success", "--limit", "1", "--json", "databaseId,attempt,url",
  ]), []);
  if (!source || (source.attempt ?? 1) < 2) return null;
  const first = parse<RawJobs & { status?: string; conclusion?: string | null }>(
    gh(["run", "view", String(source.databaseId), "--repo", repo, "--attempt", "1", "--json", "status,conclusion,jobs"]),
    {},
  );
  const run: RunRow = { databaseId: source.databaseId, status: first.status ?? "", conclusion: first.conclusion ?? null };
  const ids = failuresOf(gh, repo, run, jobRows(gh, repo, first), 1);
  return ids ? { runId: source.databaseId, url: source.url && `${source.url}/attempts/1`, ids, flaky: true } : null;
}

/** Main's latest completed red run and its failing test ids, or a green main's inherited flakes; null when main has none to give, never a throw. */
export function mainFailures(gh: Gh, repo: string): MainFailures | null {
  try {
    const { run, jobs } = readMain(gh, repo);
    if (!run || run.status !== "completed") return null;
    if (run.conclusion === "success") return inheritedFlakes(gh, repo, run);
    const ids = failuresOf(gh, repo, run, jobs);
    return ids && { runId: run.databaseId, url: run.url, ids };
  } catch {
    return null;
  }
}
