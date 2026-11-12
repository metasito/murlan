/**
 * RULES.md 53's verdict posted as the `Test verdict` check by .github/workflows/test-verdict.yml,
 * from the default branch once CI completes. CI's own gate runs inside the head's `ci.yml`, which
 * can drop it; here the gate's needs come from the API by the default branch's job names, and the
 * judge is the default branch's. The records judged are still the ones the head's `ci.yml` and
 * reporters wrote, so this catches wiring that drifted, not a head that forges its records
 * (docs/agents/suites.md, its Limits). Of the head only git objects are fetched, and only read
 * (tests/tooling/verdictCheck.test.ts).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { gateVerdict } from "./gate.mjs";
import { gh, run as judge } from "./test-verdict.mjs";
import { CHECK } from "./verdict-name.mjs";

export { CHECK };
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
 * `toJSON(needs)` rebuilt from the run's latest jobs. A job no id names is the head's own and ignored.
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
/** @type {(dir: string) => Exec} */
const gitIn = (dir) => (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

/** The artifact ci.yml names after `github.sha`, the commit a pull request's run tested. */
export const TESTED_PREFIX = "tested-commit-";

/**
 * The commit the run tested, as ci.yml recorded it. Rebuilding the merge here would land on the
 * base as it is now, and a base that moved during the run lists tests CI never ran.
 * @param {string} repo
 * @param {number} id
 * @param {Exec} hub
 */
function testedOf(repo, id, hub) {
  const names = hub(["api", `repos/${repo}/actions/runs/${id}/artifacts?per_page=100`, "--paginate", "--jq", `.artifacts[] | select(.name | startswith("${TESTED_PREFIX}")) | .name`])
    .split("\n")
    .filter(Boolean);
  const shas = [...new Set(names.map((n) => n.slice(TESTED_PREFIX.length)))];
  if (shas.length !== 1 || !/^[0-9a-f]{40}$/.test(String(shas[0]))) throw new Error(`the run recorded ${shas.length ? `the tested commits ${shas.join(", ")}` : "no tested commit"} (${TESTED_PREFIX}<sha>), so there is no one commit to judge`);
  return /** @type {string} */ (shas[0]);
}

/**
 * The tested commit, fetched blob-less into a scratch repository and held to be the head merged
 * onto a commit of the base branch. The judge's reads fetch the blobs they need, and no file is
 * written out.
 * @param {string} dir an empty directory
 * @param {string} origin
 * @param {string} tested
 * @param {string} head
 * @param {string} baseRef
 */
function testedAt(dir, origin, tested, head, baseRef) {
  const git = gitIn(dir);
  git(["init", "-q", "--bare"]);
  for (const [k, v] of [
    ["core.repositoryformatversion", "1"],
    ["extensions.partialClone", "origin"],
    ["remote.origin.url", origin],
    ["remote.origin.promisor", "true"],
    ["remote.origin.partialclonefilter", "blob:none"],
  ])
    git(["config", /** @type {string} */ (k), /** @type {string} */ (v)]);
  git(["fetch", "-q", "--no-tags", "--filter=blob:none", "origin", `+${tested}:refs/heads/judged`, `+refs/heads/${baseRef}:refs/verdict/base`]);
  if (git(["rev-parse", "refs/heads/judged"]).trim() !== tested) throw new Error(`the fetched commit is not ${tested}`);
  const [, base, second, ...more] = git(["rev-list", "--parents", "-n", "1", tested]).trim().split(" ");
  if (!base || second !== head || more.length) throw new Error(`${tested} is not the head ${head} merged onto a base, so it is not what this pull request's run tested`);
  try {
    git(["merge-base", "--is-ancestor", base, "refs/verdict/base"]);
  } catch {
    throw new Error(`${tested} merges onto ${base}, which ${baseRef} never held`);
  }
  let merged;
  try {
    merged = git(["merge-tree", "--write-tree", base, head]).split("\n")[0];
  } catch {
    throw new Error(`${head} does not merge onto ${base} cleanly, so ${tested} is not their merge`);
  }
  if (merged !== git(["rev-parse", `${tested}^{tree}`]).trim()) throw new Error(`${tested}'s tree is not the merge of its parents, so it is not what this pull request's run tested`);
  git(["symbolic-ref", "HEAD", "refs/heads/judged"]);
  return { git, base };
}

/**
 * The pull request CI ran for, and its base branch. The event lists a pull request of this
 * repository; one from a fork it leaves out, so that one is looked up by its head.
 * @param {any} wr
 * @param {string} repo
 * @param {Exec} hub
 * @returns {{ number: number, baseRef: string }}
 */
function pullOf(wr, repo, hub) {
  const listed = (wr.pull_requests ?? []).filter((/** @type {any} */ p) => p?.head?.sha === wr.head_sha);
  const label = encodeURIComponent(`${wr.head_repository?.owner?.login}:${wr.head_branch}`);
  const found = listed.length
    ? listed
    : hub(["api", `repos/${repo}/pulls?state=open&per_page=100&head=${label}`, "--jq", ".[] | {number, head: {sha: .head.sha}, base: {ref: .base.ref}}"])
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((p) => p.head.sha === wr.head_sha);
  if (found.length !== 1) throw new Error(`${found.length} open pull requests have head ${wr.head_sha}, so there is no one base to judge it on`);
  const pr = found[0];
  if (!Number.isInteger(pr.number) || !/^[\w.][\w./-]*$/.test(String(pr.base?.ref))) throw new Error("the pull request names no number and base branch");
  return { number: pr.number, baseRef: pr.base.ref };
}

/**
 * A cancelled run that a newer one replaced: its pull request moved to another head, or CI ran
 * this head again. Its red would stand only until the newer run's verdict lands over it.
 * @param {any} wr
 * @param {string} repo
 * @param {number} pr
 * @param {Exec} hub
 */
function superseded(wr, repo, pr, hub) {
  if (hub(["api", `repos/${repo}/pulls/${pr}`, "--jq", ".head.sha"]).trim() !== wr.head_sha) return true;
  const runs = hub(["api", `repos/${repo}/actions/workflows/${CI}/runs?head_sha=${wr.head_sha}&per_page=100`, "--jq", ".workflow_runs[].id"]);
  return runs.split("\n").some((id) => Number(id) > wr.id);
}

/**
 * `GITHUB_EVENT_PATH` holds the `workflow_run` event of a completed CI run. Posts the check on the
 * run's head commit unless the run is not main's CI or is a cancelled one a newer run replaced;
 * any other failure posts red. A red verdict exits 0: this job's own check lands on main's tip,
 * which a pull request's red is not.
 * @param {Record<string, string | undefined>} env `ORIGIN` overrides the repository's clone URL
 * @param {{ gh?: Exec, log?: (line: string) => void }} [io]
 */
export function run(env, { gh: hub = gh, log = console.log } = {}) {
  const repo = env.GITHUB_REPOSITORY ?? "";
  /** @type {any} */
  let wr = {};
  /** @type {string | undefined} */
  let unread;
  try {
    wr = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8")).workflow_run ?? {};
  } catch (err) {
    unread = String(err instanceof Error ? err.message : err).split("\n")[0];
  }
  const sha = String(wr.head_sha ?? "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo) || !/^[0-9a-f]{40}$/.test(sha)) {
    log(`::error::the event names no repository and head commit to post a verdict on${unread ? `: ${unread}` : "."}`);
    return 1;
  }
  if (wr.event !== "pull_request") {
    log(`a ${String(wr.event).slice(0, 40)} run is judged by its own CI gate; only a pull request's is posted.`);
    return 0;
  }
  /** @type {string[]} */
  const said = [];
  const say = (/** @type {string} */ line) => (said.push(line), log(line));
  let ok = false;
  /** @type {string | undefined} */
  let scratch;
  /** @type {string | undefined} */
  let tested;
  try {
    if (!Number.isInteger(wr.id) || !Number.isInteger(wr.run_attempt)) throw new Error("the event names no CI run and attempt");
    const ci = hub(["api", `repos/${repo}/actions/workflows/${CI}`, "--jq", ".id"]).trim();
    if (ci !== String(wr.workflow_id)) {
      log(`::error::run ${wr.id} is of workflow ${wr.workflow_id}, not ${CI} (${ci}): a workflow that only names itself CI posts nothing.`);
      return 1;
    }
    const pr = pullOf(wr, repo, hub);
    if (wr.conclusion === "cancelled" && superseded(wr, repo, pr.number, hub)) {
      log(`run ${wr.id} was cancelled for a newer run of #${pr.number}, whose verdict is the one that counts.`);
      return 0;
    }
    const jobs = hub(["api", `repos/${repo}/actions/runs/${wr.id}/jobs?filter=latest&per_page=100`, "--paginate", "--jq", ".jobs[] | {name, status, conclusion}"])
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const { needs, problems } = needsOf(jobs);
    for (const p of problems) say(`::error::${p}`);
    const gate = gateVerdict(Object.entries(needs).map(([id, n]) => (n.result === "success" || n.result === "skipped" ? n.result : `${id} ${n.result}`)));
    if (!gate.ok) say(`::error::CI gate's needs are ${gate.why}`);
    const recorded = testedOf(repo, wr.id, hub);
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "judged-"));
    const judged = testedAt(scratch, env.ORIGIN ?? `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}.git`, recorded, sha, pr.baseRef);
    tested = recorded;
    const code = judge(
      { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: String(wr.id), BASE: judged.base, NEEDS: JSON.stringify(needs), EVENT: "pull_request", REF: `refs/pull/${pr.number}/merge`, GITHUB_STEP_SUMMARY: env.GITHUB_STEP_SUMMARY },
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
    output: {
      title: ok ? "Every test that ran passed, once" : "The run is red (RULES.md 53)",
      summary: `CI run ${wr.id}, attempt ${wr.run_attempt}, judged ${tested ? `at ${tested}, the commit it tested, ` : ""}by the default branch's tools/ci/test-verdict.mjs.`,
      text: lines.join("\n").slice(0, 60_000),
    },
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
