// tools/loop/mainHealth.ts
import { execFileSync } from "node:child_process";
import { decideVerdict, failingTestIds, stripLogPrefix, type JobRow, type RunRow } from "./ciVerdict.ts";

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
}

export type MainHealth =
  | { state: "green" | "unknown"; why: string }
  | { state: "file"; runId: number; failedStep?: string; url?: string; title: string; why: string }
  | { state: "filed"; runId: number; title: string; why: string; url?: string };

/**
 * Separate from `loop` because `loop` is a person's label too: a burst of hand-filed loop tickets
 * would push the one issue the duplicate check needs to see out of any window drawn over them.
 */
export const MAIN_RED_LABEL = "main-red";

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
export function alreadyFiled(runId: number, issues: FiledIssue[]): FiledIssue | undefined {
  return issues.find((i) => Number(RUN_IN_TITLE.exec(i.title ?? "")?.[1]) === runId);
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
  if (verdict.pass) return { state: "green", why: verdict.reason };
  if (verdict.infrastructure || verdict.runId === undefined) {
    return { state: "unknown", why: verdict.reason };
  }
  // Still running is not a red `main`; it is a `main` nobody can answer for yet.
  if (run?.status !== "completed") return { state: "unknown", why: verdict.reason };

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
    "--state", "all", "--limit", String(WINDOW), "--json", "number,title,url",
  ];
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

/** Jobs are fetched only when the answer can turn on them. */
export function readMain(gh: Gh, repo: string): { run?: MainRun; jobs: JobRow[] } {
  const [run] = parse<MainRun[]>(gh(mainRunArgs(repo)), []);
  if (!run || run.status !== "completed" || run.conclusion === "success") return { run, jobs: [] };
  const raw = parse<{ jobs?: { name: string; conclusion: string | null; steps?: unknown[] }[] }>(
    gh(jobArgs(repo, run.databaseId)),
    {},
  );
  const jobs = (raw.jobs ?? []).map((j) => ({
    name: j.name,
    conclusion: j.conclusion,
    steps: j.steps?.length ?? 0,
  }));
  return { run, jobs };
}

/**
 * Reads `main` and files the issue if it is red and unreported. Returns what happened; nothing
 * here prints.
 *
 * It never throws: this runs before every ticket, and refusing to start one because GitHub was
 * briefly unreachable turns a check into an outage.
 */
export function checkMain({
  repo,
  gh = ghCli,
  labels = ["ready-for-agent", "loop", "size:S", MAIN_RED_LABEL],
}: {
  repo: string;
  gh?: Gh;
  labels?: string[];
}): MainHealth {
  try {
    const { run, jobs } = readMain(gh, repo);
    const health = decideMainHealth(run, jobs, parse<FiledIssue[]>(gh(filedIssueArgs(repo)), []));
    if (health.state !== "file") return health;
    const url = gh(issueArgs(repo, health, run?.headSha, labels)).trim().split("\n").at(-1);
    return { state: "filed", runId: health.runId, title: health.title, why: health.why, url };
  } catch (e) {
    const [first] = String((e as Error).message).split("\n");
    return { state: "unknown", why: `could not read main — ${first}` };
  }
}

/** Main's latest completed red run and its failing test ids; null when main has none to give, never a throw. */
export function mainFailures(gh: Gh, repo: string): { runId: number; url?: string; ids: string[] } | null {
  try {
    const { run, jobs } = readMain(gh, repo);
    if (!run || run.status !== "completed" || run.conclusion === "success") return null;
    if (decideVerdict(run, jobs).infrastructure) return null;
    const log = gh(["run", "view", String(run.databaseId), "--repo", repo, "--log-failed"]);
    return { runId: run.databaseId, url: run.url, ids: failingTestIds(log.split("\n").map(stripLogPrefix).join("\n")) };
  } catch {
    return null;
  }
}
