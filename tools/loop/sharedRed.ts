// tools/loop/sharedRed.ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failingTestIds, stripLogPrefix, type GhExec } from "./ciVerdict.ts";
import { DIR as LOOP_LOGS_DIR, redCachePath as artefactRedCachePath } from "./loop-logs.mjs";

/**
 * Owns a test id failing on more than one branch (or on `main`) in one tracker issue, so a second
 * branch reads it as known rather than rediscovering it. Modelled on `mainHealth.ts`: a pure core
 * plus a `gh` seam that never throws.
 */

export interface RedRun {
  runId: number;
  branch: string;
  headSha?: string;
  url?: string;
  testIds: string[];
}

export interface SharedIssue {
  number: number;
  title: string;
  url?: string;
  state?: string;
  /** ISO timestamp; only `fixLandedOnMain` reads it, and only once `state` is `"closed"`. */
  closedAt?: string;
}

export type SharedDecision =
  | { kind: "none"; why?: string }
  | { kind: "file"; testId: string; evidence: RedRun; issue?: SharedIssue }
  | { kind: "known"; issue: SharedIssue; testId: string }
  | { kind: "reopen"; issue: SharedIssue; testId: string };

export const SHARED_RED_LABEL = "shared-red";
export const DEFAULT_CACHE_DIR = LOOP_LOGS_DIR;
const DEFAULT_BUDGET_MS = 45 * 60_000;
const WINDOW_MS = 48 * 60 * 60_000;
const MAIN_LOOKBACK_LIMIT = 10;

export const titleFor = (testId: string): string => `shared red: ${testId}`;

export function redRunListArgs(repo: string): string[] {
  // prettier-ignore
  return [
    "run", "list", "--repo", repo,
    "--workflow", "ci.yml", "--limit", "40",
    "--json", "databaseId,conclusion,status,headSha,url,headBranch,createdAt",
  ];
}

export function sharedIssueArgs(repo: string): string[] {
  // prettier-ignore
  return [
    "issue", "list", "--repo", repo,
    "--label", SHARED_RED_LABEL, "--state", "all", "--limit", "100",
    "--json", "number,title,url,state,closedAt",
  ];
}

export function sharedBody(testId: string, evidence: RedRun): string {
  return [
    `Failing test id: \`${testId}\``,
    "",
    `Also red on \`${evidence.branch}\`: ${evidence.url ?? `run ${evidence.runId}`}`,
    "",
    "A branch whose diff fixes this closes it with `Closes #<n>` in its PR body.",
  ].join("\n");
}

export function redCachePath(runId: number, cacheDir: string = DEFAULT_CACHE_DIR): string {
  return artefactRedCachePath(runId, cacheDir);
}

function readCache(runId: number, cacheDir: string): string[] | undefined {
  try {
    return readFileSync(redCachePath(runId, cacheDir), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return undefined;
  }
}

function writeCache(runId: number, cacheDir: string, ids: string[]): void {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(redCachePath(runId, cacheDir), ids.length ? `${ids.join("\n")}\n` : "", "utf8");
  } catch {
    return; // the cache is prunable and best-effort; a write failure just costs a re-fetch (Ruling R6)
  }
}

function ghJson<T>(gh: GhExec, args: string[], until: number, fallback: T): T {
  try {
    return JSON.parse(gh(args, until)) as T;
  } catch {
    return fallback;
  }
}

function testIdsFor(gh: GhExec, repo: string, runId: number, until: number, cacheDir: string): string[] {
  const cached = readCache(runId, cacheDir);
  if (cached) return cached;
  try {
    const log = gh(["run", "view", String(runId), "--repo", repo, "--log-failed"], until)
      .split("\n")
      .map(stripLogPrefix)
      .join("\n");
    const ids = failingTestIds(log);
    writeCache(runId, cacheDir, ids);
    return ids;
  } catch {
    return [];
  }
}

interface RawRun {
  databaseId: number;
  conclusion: string | null;
  status: string;
  headSha?: string;
  url?: string;
  headBranch?: string;
  createdAt?: string;
}

/**
 * Failed `ci.yml` runs from the last `sinceMs`, each carrying every failing test id its full log
 * named — read from `.loop-logs/red-<runId>.ids` when a previous call already cached it.
 */
export function recentRedRuns(
  repo: string,
  gh: GhExec,
  sinceMs: number,
  { until = Date.now() + DEFAULT_BUDGET_MS, cacheDir = DEFAULT_CACHE_DIR }: { until?: number; cacheDir?: string } = {},
): RedRun[] {
  const runs = ghJson<RawRun[]>(gh, redRunListArgs(repo), until, []);
  return runs
    .filter((r) => r.status === "completed" && r.conclusion === "failure" && Date.parse(r.createdAt ?? "") >= sinceMs)
    .map((r) => ({
      runId: r.databaseId,
      branch: r.headBranch ?? "",
      headSha: r.headSha,
      url: r.url,
      testIds: testIdsFor(gh, repo, r.databaseId, until, cacheDir),
    }));
}

function issueForTestId(testId: string, issues: SharedIssue[]): SharedIssue | undefined {
  return issues.find((i) => (i.title ?? "").includes(testId));
}

/**
 * Shared means the same test id failed on `main` or on a branch other than `mine`'s own — the
 * branch's own older runs, carried in `others` by `recentRedRuns`' window, never count.
 */
export function decideShared(
  mine: { branch: string; testIds: string[] },
  others: RedRun[],
  issues: SharedIssue[],
): SharedDecision {
  const elsewhere = others.filter((r) => r.branch !== mine.branch);
  for (const testId of mine.testIds) {
    const evidence = elsewhere.find((r) => r.testIds.includes(testId));
    if (!evidence) continue;
    const issue = issueForTestId(testId, issues);
    if (!issue) return { kind: "file", testId, evidence };
    return issue.state === "closed" ? { kind: "reopen", issue, testId } : { kind: "known", issue, testId };
  }
  return { kind: "none" };
}

interface MainRunRow {
  databaseId: number;
  conclusion: string | null;
  status: string;
  createdAt?: string;
}

export function mainRunsSinceArgs(repo: string, limit: number = MAIN_LOOKBACK_LIMIT): string[] {
  // prettier-ignore
  return [
    "run", "list", "--repo", repo, "--branch", "main",
    "--workflow", "ci.yml", "--limit", String(limit),
    "--json", "databaseId,conclusion,status,createdAt",
  ];
}

/**
 * Signal for the supervisor's "known, fix already on main" branch, from positive evidence only:
 * `issue` must be closed, and the newest completed `ci.yml` run on `main` that started after it
 * closed must have concluded success. No run since the close, a still-red one, or an unreadable
 * read all answer false — main's silence is not proof a fix landed.
 */
export function fixLandedOnMain(
  repo: string,
  gh: GhExec,
  issue: SharedIssue,
  until: number = Date.now() + DEFAULT_BUDGET_MS,
): boolean {
  if (issue.state !== "closed" || !issue.closedAt) return false;
  const closedAt = Date.parse(issue.closedAt);
  const runs = ghJson<MainRunRow[]>(gh, mainRunsSinceArgs(repo), until, []);
  const since = runs
    .filter((r) => r.status === "completed" && Date.parse(r.createdAt ?? "") >= closedAt)
    .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""));
  return since[0]?.conclusion === "success";
}

function fileSharedIssue(
  repo: string,
  gh: GhExec,
  decision: Extract<SharedDecision, { kind: "file" }>,
  until: number,
  labels: string[],
): SharedDecision {
  const dir = mkdtempSync(join(tmpdir(), "shared-red-"));
  const bodyFile = join(dir, "issue.md");
  writeFileSync(bodyFile, sharedBody(decision.testId, decision.evidence), "utf8");
  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    titleFor(decision.testId),
    "--body-file",
    bodyFile,
    ...labels.flatMap((l) => ["--label", l]),
  ];
  const url = gh(args, until).trim().split("\n").at(-1);
  const number = Number(url?.split("/").pop());
  return { ...decision, issue: { number, title: titleFor(decision.testId), url } };
}

/**
 * Never throws: this runs alongside a fix round, and GitHub being briefly unreachable must not
 * block it. On "file" it creates the issue; on "reopen" it reopens the existing one; "known" and
 * "none" are read-only.
 */
export function checkShared({
  repo,
  gh,
  mine,
  sinceMs = Date.now() - WINDOW_MS,
  labels = [SHARED_RED_LABEL],
  cacheDir = DEFAULT_CACHE_DIR,
  until = Date.now() + DEFAULT_BUDGET_MS,
}: {
  repo: string;
  gh: GhExec;
  mine: { branch: string; testIds: string[] };
  sinceMs?: number;
  labels?: string[];
  cacheDir?: string;
  until?: number;
}): SharedDecision {
  try {
    const others = recentRedRuns(repo, gh, sinceMs, { until, cacheDir });
    const issues = ghJson<SharedIssue[]>(gh, sharedIssueArgs(repo), until, []);
    const decision = decideShared(mine, others, issues);
    if (decision.kind === "file") return fileSharedIssue(repo, gh, decision, until, labels);
    if (decision.kind === "reopen") gh(["issue", "reopen", String(decision.issue.number), "--repo", repo], until);
    return decision;
  } catch (e) {
    const [first] = String((e as Error)?.message ?? e).split("\n");
    return { kind: "none", why: `could not check shared red — ${first}` };
  }
}
