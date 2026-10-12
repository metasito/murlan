// tools/loop/mainHealth.ts
import { execFileSync } from "node:child_process";

/**
 * Whether `main` itself is green, and filing a ticket when it is not.
 *
 * A branch going red parks its own ticket. `main` going red parks nothing — by then the merge has
 * happened and the worktree is gone — so it is filed as an issue, the only thing here that
 * outlives the process that found it.
 */

export interface MainRun {
  databaseId: number;
  conclusion: string | null;
  headSha?: string;
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

/**
 * Only the *latest* ci.yml run on `main` is ever read, and run ids only climb, so the one id that
 * can come round twice is the newest — and the issue naming it is the newest this module wrote.
 * Issues ageing out of `WINDOW` name runs that can never be asked about again.
 */
export const WINDOW = 10;

const runOf = (issue: FiledIssue) => Number(RUN_IN_TITLE.exec(issue.title ?? "")?.[1]);

export function alreadyFiled(runId: number, issues: FiledIssue[]): FiledIssue | undefined {
  return issues.find((i) => runOf(i) === runId);
}

/** Only issues naming an older run: run ids only climb, so one naming a newer run is news this green predates. */
export function staleIssues(greenRunId: number, issues: FiledIssue[]): number[] {
  return issues.filter((i) => i.state === "OPEN" && runOf(i) < greenRunId).map((i) => i.number);
}

/**
 * `--workflow ci.yml`: `main` carries other workflows that finish on their own schedule, and
 * unfiltered `--limit 1` answers with whichever ran last.
 */
export function mainRunArgs(repo: string): string[] {
  // prettier-ignore
  return [
    "run", "list", "--repo", repo, "--branch", "main",
    "--workflow", "ci.yml", "--limit", "1",
    "--json", "databaseId,conclusion,headSha,url",
  ];
}

export function filedIssueArgs(repo: string): string[] {
  // prettier-ignore
  return [
    "issue", "list", "--repo", repo, "--label", MAIN_RED_LABEL,
    "--state", "all", "--limit", String(WINDOW), "--json", "number,title,url,state",
  ];
}

function closeArgs(repo: string, issue: number, greenRunId: number): string[] {
  return ["issue", "close", String(issue), "--repo", repo, "--comment", `main is green again: ci.yml run ${greenRunId}.`];
}

export function bodyFor(run: MainRun): string {
  return [
    "The most recent `ci.yml` run on `main` failed.",
    "",
    `- run: ${run.url ?? `id ${run.databaseId}`}`,
    `- commit: ${run.headSha ?? "not reported"}`,
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

/**
 * Reads `main` and files the issue if it is red and unreported. Returns what happened; nothing
 * here prints. Only `failure` files: a push to `main` is never cancelled by ci.yml's concurrency
 * group, which cancels pull requests only, so anything but success or failure is not a verdict.
 *
 * It never throws: this runs before every ticket, and refusing to start one because GitHub was
 * briefly unreachable turns a check into an outage.
 */
export function checkMain({ repo, gh = ghCli }: { repo: string; gh?: Gh }): MainHealth {
  try {
    const [run] = parse<MainRun[]>(gh(mainRunArgs(repo)), []);
    if (!run) return { state: "unknown", why: "main has no ci.yml run" };
    if (run.conclusion !== "success" && run.conclusion !== "failure") {
      return { state: "unknown", why: `main's latest ci.yml run reads ${run.conclusion || "unfinished"}` };
    }
    const runId = run.databaseId;
    const issues = parse<FiledIssue[]>(gh(filedIssueArgs(repo)), []);
    if (run.conclusion === "success") {
      const close = staleIssues(runId, issues);
      for (const issue of close) {
        try {
          gh(closeArgs(repo, issue, runId));
        } catch {
          // A close that fails is retried by the next green read; it must not make green read as unknown.
        }
      }
      return { state: "green", why: "ci.yml passed", runId, close };
    }
    const title = titleFor(runId);
    const seen = alreadyFiled(runId, issues);
    if (seen) return { state: "filed", runId, title, why: "ci.yml failed", url: seen.url };
    // prettier-ignore
    const url = gh([
      "issue", "create", "--repo", repo, "--title", title, "--body", bodyFor(run),
      ...MAIN_RED_LABELS.flatMap((l) => ["--label", l]),
    ]).trim().split("\n").at(-1);
    return { state: "filed", runId, title, why: "ci.yml failed", url };
  } catch (e) {
    const [first] = String((e as Error).message).split("\n");
    return { state: "unknown", why: `could not read main — ${first}` };
  }
}
