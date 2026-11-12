/**
 * RULES.md 53's verdict posted as the `Test verdict` check, by .github/workflows/test-verdict.yml
 * from main's checkout once CI completes. CI's own gate runs inside the head's `ci.yml`, which can
 * drop it; here the jobs and artifacts come from the API, the judge is main's, and the head is
 * fetched as git objects and only read (tests/tooling/verdictCheck.test.ts).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { gateVerdict } from "./gate.mjs";
import { run as judge } from "./test-verdict.mjs";

export const CHECK = "Test verdict";
export const CI = "ci.yml";

/**
 * CI gate's needs by job id, each with its `name:` in ci.yml: the API reports a job by name only.
 * tests/tooling/verdictCheck.test.ts holds this equal to main's ci.yml.
 */
export const JOB_NAMES = Object.freeze({
  scope: "Does this change need the suite?",
  secrets: "Secret scan",
  verify: "Typecheck and tests ${{ matrix.shard }}/${{ strategy.job-total }}",
  native: "Native tests ${{ matrix.shard }}/${{ strategy.job-total }}",
  harness: "Loop harness",
  "harness-windows": "Loop harness on Windows",
  lint: "Lint",
  "android-build": "Android compiles",
  "ios-build": "iOS compiles",
  browser: "Browser tests ${{ matrix.shard }}/${{ strategy.job-total }}",
  "browser-report": "Browser test report",
  build: "Build and boot",
  "timing-budget": "Timing budget",
});

/** A skipped matrix job may be reported before its expressions are expanded, or without them. */
export function nameMatcher(/** @type {string} */ template) {
  const parts = template.split(/\$\{\{.*?\}\}/);
  const lit = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (parts.length === 1) return (/** @type {string} */ name) => name === template;
  const head = /** @type {string} */ (parts[0]);
  const re = new RegExp(`^${lit(head.trimEnd())}(?:${lit(head.slice(head.trimEnd().length))}.*?${parts.slice(1).map(lit).join(".*?")})?$`);
  return (/** @type {string} */ name) => re.test(name);
}

/** A matrix job's `needs.<id>.result` from its runs' conclusions, as GitHub folds them. */
export function resultOf(/** @type {(string | null)[]} */ conclusions) {
  if (conclusions.every((c) => c === "skipped")) return "skipped";
  if (conclusions.every((c) => c === "success" || c === "skipped")) return "success";
  if (conclusions.every((c) => c === "success" || c === "skipped" || c === "cancelled")) return "cancelled";
  return "failure";
}

/**
 * `toJSON(needs)` rebuilt from the attempt's jobs. A job no id names is the head's own and ignored.
 * @param {{ name: string, status: string, conclusion: string | null }[]} jobs
 */
export function needsOf(jobs) {
  /** @type {string[]} */
  const problems = [];
  const matchers = Object.entries(JOB_NAMES).map(([id, name]) => /** @type {const} */ ([id, nameMatcher(name)]));
  /** @type {Record<string, (string | null)[]>} */
  const by = {};
  for (const job of jobs) {
    const ids = matchers.filter(([, m]) => m(job.name)).map(([id]) => id);
    if (ids.length > 1) problems.push(`CI's job "${job.name}" is named like ${ids.join(" and ")}`);
    if (ids.length !== 1) continue;
    if (job.status !== "completed") problems.push(`CI's job "${job.name}" has not completed (${job.status})`);
    (by[/** @type {string} */ (ids[0])] ??= []).push(job.conclusion);
  }
  /** @type {Record<string, { result: string }>} */
  const needs = {};
  for (const [id, name] of Object.entries(JOB_NAMES)) {
    const ran = by[id];
    if (ran) needs[id] = { result: resultOf(ran) };
    else problems.push(`CI ran no job named "${name}" (${id}), so the run is not ci.yml's as main knows it`);
  }
  return { needs, problems };
}

/** @typedef {(args: string[]) => string} Exec */
/** @type {Exec} */
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024, timeout: 5 * 60_000 });
/** @type {(dir: string) => Exec} */
const gitIn = (dir) => (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

/**
 * A bare repository borrowing `workspace`'s objects whose HEAD is `sha`, so the judge's `HEAD` is
 * the head without a file of it written out.
 * @param {Exec} at the workspace's git
 * @param {string} sha
 */
function headOnly(at, sha) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "judged-"));
  const bare = gitIn(dir);
  bare(["init", "-q", "--bare"]);
  fs.writeFileSync(path.join(dir, "objects", "info", "alternates"), `${path.resolve(at(["rev-parse", "--absolute-git-dir"]).trim(), "objects")}\n`);
  bare(["update-ref", "refs/heads/judged", sha]);
  bare(["symbolic-ref", "HEAD", "refs/heads/judged"]);
  return { dir, git: bare };
}

/**
 * `GITHUB_EVENT_PATH` holds the `workflow_run` event of a completed CI run; `GITHUB_WORKSPACE` is
 * main's checkout. Posts the check on the run's head commit unless the run is not main's CI. A red
 * verdict exits 0: this job's own check lands on main's tip, which a pull request's red is not.
 * @param {Record<string, string | undefined>} env
 * @param {{ gh?: Exec, git?: Exec, log?: (line: string) => void }} [io]
 */
export function run(env, { gh: hub = gh, git: at = gitIn(env.GITHUB_WORKSPACE ?? process.cwd()), log = console.log } = {}) {
  const repo = env.GITHUB_REPOSITORY ?? "";
  const wr = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8")).workflow_run ?? {};
  const sha = String(wr.head_sha ?? "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo) || !/^[0-9a-f]{40}$/.test(sha) || !Number.isInteger(wr.id) || !Number.isInteger(wr.run_attempt)) {
    log("::error::the event names no repository, CI run, attempt and head commit to judge.");
    return 1;
  }
  if (wr.event !== "pull_request") {
    log(`a ${String(wr.event).slice(0, 40)} run is judged by its own CI gate; only a pull request's is posted.`);
    return 0;
  }
  const ci = hub(["api", `repos/${repo}/actions/workflows/${CI}`, "--jq", ".id"]).trim();
  if (ci !== String(wr.workflow_id)) {
    log(`::error::run ${wr.id} is of workflow ${wr.workflow_id}, not ${CI} (${ci}): a workflow that only names itself CI posts nothing.`);
    return 1;
  }
  /** @type {string[]} */
  const said = [];
  const say = (/** @type {string} */ line) => (said.push(line), log(line));
  let ok = false;
  /** @type {string | undefined} */
  let scratch;
  try {
    at(["fetch", "--no-tags", "origin", `+${sha}:refs/verdict/head`, "+refs/heads/main:refs/verdict/main"]);
    if (at(["rev-parse", "refs/verdict/head"]).trim() !== sha) throw new Error(`the fetched head is not ${sha}`);
    const base = at(["merge-base", "refs/verdict/main", "refs/verdict/head"]).trim();
    const jobs = hub(["api", `repos/${repo}/actions/runs/${wr.id}/attempts/${wr.run_attempt}/jobs?per_page=100`, "--paginate", "--jq", ".jobs[] | {name, status, conclusion}"])
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const { needs, problems } = needsOf(jobs);
    for (const p of problems) say(`::error::${p}`);
    const gate = gateVerdict(Object.entries(needs).map(([id, n]) => (n.result === "success" || n.result === "skipped" ? n.result : `${id} ${n.result}`)));
    if (!gate.ok) say(`::error::CI gate's needs are ${gate.why}`);
    const judged = headOnly(at, sha);
    scratch = judged.dir;
    const code = judge(
      { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: String(wr.id), BASE: base, NEEDS: JSON.stringify(needs), EVENT: "pull_request", REF: "", GITHUB_STEP_SUMMARY: env.GITHUB_STEP_SUMMARY },
      { gh: hub, git: judged.git, log: say },
    );
    ok = code === 0 && !problems.length && gate.ok;
  } catch (err) {
    say(`::error::the run could not be judged: ${String(err instanceof Error ? err.message : err).split("\n")[0]}`);
  } finally {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
  const lines = said.map((l) => l.replace(/^::error(?: title=[^:]*)?::/, "- ").replace(/%0A/g, " ").replace(/%0D/g, " ").replace(/%25/g, "%"));
  const body = {
    name: CHECK,
    head_sha: sha,
    status: "completed",
    conclusion: ok ? "success" : "failure",
    details_url: wr.html_url,
    output: { title: ok ? "Every test that ran passed, once" : "The run is red (RULES.md 53)", summary: `CI run ${wr.id}, attempt ${wr.run_attempt}, judged by main's tools/ci/test-verdict.mjs.`, text: lines.join("\n").slice(0, 60_000) },
  };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "check-")), "check.json");
  fs.writeFileSync(file, JSON.stringify(body));
  try {
    hub(["api", "-X", "POST", `repos/${repo}/check-runs`, "--input", file]);
  } catch (err) {
    log(`::error::the check could not be posted: ${String(err instanceof Error ? err.message : err).split("\n")[0]}`);
    return 1;
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
  return 0;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) process.exitCode = run(process.env);
