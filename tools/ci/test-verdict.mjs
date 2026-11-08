/**
 * RULES.md 53's verdict, over what the runners themselves reported: the files
 * tools/ci/results-writer.mjs collects in every test job. ci.yml's CI gate runs the base branch's
 * copy of this file, but ci.yml itself is the pull request's: a head that changes the workflow can
 * still skip or replace this step (docs/agents/suites.md § A flake is fixed, Limits).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { prSpec } from "../../tests/e2e/tiers.mjs";
import { JOBS, scopeOf } from "./scopeOf.mjs";

export const LEDGER = "tools/ci/quarantine.json";
export const LABEL = "ci-flake";
export const ARTIFACT_PREFIX = "test-results-";
export const QUARANTINE_CAP = 5;
export const QUARANTINE_DAYS = 14;
const DAY = 86_400_000;

/** The jobs CI gate needs that run no test suite; any other need is a test job, judged or red. */
export const NON_TEST_JOBS = ["scope", "secrets", "lint", "android-build", "ios-build", "browser-report", "build", "timing-budget"];

/**
 * Every suite a pull request's run executes, the jobs that run it and the files it must have heard
 * pass; when each job runs is tools/ci/scopeOf.mjs's JOBS. A floor is the fewest files the listing
 * may hold: a listing that shrinks past it is a suite moved out of sight, not a smaller suite.
 * @typedef {{ app: boolean, harness: boolean, scans: boolean }} Scope
 * @type {{ name: string, jobs: string[], runner: "node" | "jest" | "playwright", lists: (file: string) => boolean, floor: number }[]}
 */
export const SUITES = [
  { name: "npm test", jobs: ["verify"], runner: "node", lists: (f) => /^tests\/.+\.test\.ts$/.test(f), floor: 400 },
  { name: "npm run loop:test", jobs: ["harness", "harness-windows"], runner: "node", lists: (f) => /^tools\/loop\/tests\/.+\.test\.ts$/.test(f), floor: 30 },
  { name: "npm run test:native", jobs: ["native"], runner: "jest", lists: (f) => /^tests\/native\/.+\.test\.tsx$/.test(f), floor: 200 },
  { name: "npm run test:e2e", jobs: ["browser"], runner: "playwright", lists: (f) => f.startsWith("tests/e2e/") && prSpec(f.slice("tests/e2e/".length)), floor: 80 },
];

/** `test-results-<job>-<shard>-<attempt>`, ci.yml's upload name. */
const NAME = /^test-results-(.+)-(\d+)-(\d+)$/;

/** @typedef {{ file: string, title: string, issue: number, expires: string }} Quarantined */
/** @typedef {{ name: string, runs: { file: string, records: any[] }[] }} Artifact */
/** @typedef {{ open: boolean, labelled: boolean, created: number }} Ticket */
/**
 * `scope` is null only on a push to main, whose scope job may skip a tree its pull request passed.
 * @typedef {{
 *   needs: Record<string, { result?: string } | undefined>,
 *   artifacts: Artifact[],
 *   listing: string[],
 *   ledger: { head: unknown, base: unknown },
 *   tickets: Map<number, Ticket>,
 *   changed: string[],
 *   renamed: [string, string][],
 *   scope: Scope | null,
 *   now: number,
 *   suites?: typeof SUITES,
 * }} VerdictInput
 */

/** Head-controlled text is printed inside a workflow command, so it is escaped as one. */
export const escape = (/** @type {unknown} */ s) => String(s).slice(0, 400).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/** @param {unknown} ledger @returns {Quarantined[] | string} */
export function entries(ledger) {
  const list = /** @type {any} */ (ledger)?.quarantine;
  if (!Array.isArray(list)) return `${LEDGER} has no "quarantine" list`;
  const bad = list.find(
    (e) => typeof e?.file !== "string" || typeof e?.title !== "string" || !Number.isInteger(e?.issue) || typeof e?.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.expires) || Number.isNaN(Date.parse(e.expires)),
  );
  return bad === undefined ? list : `${LEDGER} has an entry that is not {file, title, issue, expires: "YYYY-MM-DD"}: ${JSON.stringify(bad)}`;
}

const key = (/** @type {{ file: string, title: string }} */ r) => `${r.file}\0${r.title}`;

/**
 * Which head entries hold a skip. An entry the base does not hold exactly is an addition, which
 * lands only in a pull request touching the ledger alone. Every entry expires within
 * QUARANTINE_DAYS of its issue being opened, and an issue holds one test, so renewing means a new
 * issue for a test the base holds under none.
 * @param {Pick<VerdictInput, "ledger" | "tickets" | "changed" | "now">} input
 */
function quarantine({ ledger, tickets, changed, now }) {
  /** @type {string[]} */
  const problems = [];
  const head = entries(ledger.head);
  const base = ledger.base === null ? [] : entries(ledger.base);
  for (const l of [head, base]) if (typeof l === "string") problems.push(l);
  const list = typeof head === "string" ? [] : head;
  const baseList = typeof base === "string" ? [] : base;
  const exact = (/** @type {Quarantined} */ e) => `${key(e)}\0${e.issue}\0${e.expires}`;
  const held = new Set(baseList.map(exact));
  const alone = changed.length === 1 && changed[0] === LEDGER;
  if (list.length > QUARANTINE_CAP) problems.push(`${LEDGER} holds ${list.length} entries, over its cap of ${QUARANTINE_CAP}`);
  /** @type {Set<string>} */
  const holds = new Set();
  for (const e of list) {
    const red = problems.length;
    const expiry = Date.parse(e.expires) + DAY;
    if (!held.has(exact(e)) && !alone) problems.push(`${LEDGER} adds ${named(e)} (#${e.issue}) beside other changes; a quarantine lands in a pull request of its own`);
    if (now >= expiry) problems.push(`${LEDGER}'s quarantine of ${named(e)} expired on ${e.expires}`);
    for (const other of [...list, ...baseList]) {
      if (other.issue === e.issue && key(other) !== key(e)) problems.push(`${LEDGER} holds ${named(e)} under #${e.issue}, which already holds ${named(other)}; an issue quarantines one test`);
      if (other.issue !== e.issue && key(other) === key(e) && baseList.includes(other)) problems.push(`${LEDGER} moves ${named(e)} from #${other.issue} to #${e.issue}; a quarantine is not renewed under a new issue`);
    }
    const t = tickets.get(e.issue);
    if (!t?.open || !t.labelled) problems.push(`${LEDGER} holds ${named(e)} under #${e.issue}, which is not an open issue labelled ${LABEL}`);
    else if (Date.parse(e.expires) > Math.floor(t.created / DAY) * DAY + QUARANTINE_DAYS * DAY)
      problems.push(`${LEDGER} quarantines ${named(e)} until ${e.expires}, more than ${QUARANTINE_DAYS} days after #${e.issue} was opened`);
    if (problems.length === red && list.length <= QUARANTINE_CAP) holds.add(key(e));
  }
  return { problems, holds };
}
const named = (/** @type {{ file: string, title: string }} */ r) => `${r.file} › ${r.title}`;

/**
 * Each artifact parsed as one job's shard and attempt. Only the newest attempt of a shard must
 * have finished, but a failure or retry in any attempt counts: re-running a failed job is a retry.
 * @param {Artifact[]} artifacts
 */
function attempts(artifacts) {
  /** @type {string[]} */
  const problems = [];
  const parsed = [];
  for (const a of artifacts) {
    const m = NAME.exec(a.name);
    if (!m) problems.push(`artifact ${a.name} is not named ${ARTIFACT_PREFIX}<job>-<shard>-<attempt>`);
    else parsed.push({ ...a, job: m[1], shard: m[2], attempt: Number(m[3]) });
  }
  /** @type {Map<string, number>} */
  const newest = new Map();
  for (const a of parsed) newest.set(`${a.job}/${a.shard}`, Math.max(newest.get(`${a.job}/${a.shard}`) ?? 0, a.attempt));
  return { problems, parsed: parsed.map((a) => ({ ...a, newest: newest.get(`${a.job}/${a.shard}`) === a.attempt })) };
}

/**
 * @param {VerdictInput} input
 * @returns {string[]} every reason the run is red; none is green
 */
export function verdict({ needs, artifacts, listing, ledger, tickets, changed, renamed, scope, now, suites = SUITES }) {
  const { problems, parsed } = attempts(artifacts);
  const { problems: ledgerProblems, holds: quarantined } = quarantine({ ledger, tickets, changed, now });
  problems.push(...ledgerProblems);
  for (const [from, to] of renamed)
    for (const s of suites) if (s.lists(from) && !s.lists(to)) problems.push(`${from} is renamed to ${to}, out of ${s.name}'s listing`);
  const judged = new Set(suites.flatMap((s) => s.jobs));
  for (const job of Object.keys(needs)) {
    if (!judged.has(job) && !NON_TEST_JOBS.includes(job)) problems.push(`CI gate needs ${job}, which is neither a judged test job (SUITES) nor in NON_TEST_JOBS in tools/ci/test-verdict.mjs`);
  }
  for (const a of parsed) if (!judged.has(a.job)) problems.push(`${a.name} is from ${a.job}, which no suite in SUITES judges`);
  for (const job of judged) if (!(job in JOBS)) problems.push(`${job} runs a suite, but tools/ci/scopeOf.mjs's JOBS does not say when it runs`);
  if (scope)
    for (const [job, runs] of Object.entries(JOBS)) if (needs[job]?.result === "skipped" && runs(scope)) problems.push(`${job} was skipped, but the base's scope of this change runs it`);

  /** @type {Set<string>} */
  const passed = new Set();
  /** @type {Set<string>} */
  const filesPassed = new Set();
  /** @type {{ file: string, title: string, status: string }[]} */
  const unrun = [];
  for (const suite of suites) {
    for (const job of suite.jobs) {
      const result = needs[job]?.result;
      if (result === undefined) problems.push(`CI gate does not need ${job}, so ${suite.name} is not judged`);
      if (result === undefined || result === "skipped") continue;
      const mine = parsed.filter((a) => a.job === job);
      if (!mine.length) problems.push(`${job} ran (${result}) and uploaded no ${ARTIFACT_PREFIX}${job}-* results`);
      let passes = 0;
      for (const a of mine) {
        if (!a.runs.length) problems.push(`${a.name} holds no results file`);
        for (const run of a.runs) {
          const where = `${a.name}/${run.file}`;
          const [first] = run.records;
          const last = run.records.at(-1);
          if (first?.type !== "run" || first.runner !== suite.runner) problems.push(`${where} is not a ${suite.runner} results file`);
          else if (!Array.isArray(first.filters) || first.filters.length) problems.push(`${where} ran filtered by name (${[first.filters].flat().join(", ") || "unrecorded"}); a filtered-out test reports nothing at all`);
          if (a.newest && last?.type !== "end") problems.push(`${where} ends before its runner finished`);
          else if (a.newest && last.ok !== true) problems.push(`${where}: ${suite.runner} reported the run as not green`);
          /** @type {Set<string>} */
          const seen = new Set();
          for (const r of run.records) {
            if (r?.type !== "test") {
              if (r?.type !== "run" && r?.type !== "end") problems.push(`${where} holds a record that is not a result (${String(r?.type)})`);
              continue;
            }
            const once = `${key(r)}\0${r.project ?? ""}\0${r.attempt ?? 0}`;
            if (!r.suite && seen.has(once)) problems.push(`${named(r)} is reported twice in ${where}; one title's pass would be heard for the other`);
            seen.add(once);
            const tried = a.attempt > 1 ? ` (in run attempt ${a.attempt}; re-running a failed job is a retry)` : "";
            if (r.status === "failed") problems.push(`${named(r)} failed${tried}`);
            if ((r.attempt ?? 0) > 0 || (r.retries ?? 0) > 0) problems.push(`${named(r)} ran with retries (attempt ${r.attempt ?? 0}, ${r.retries ?? 0} allowed); a flake is fixed, never retried`);
            if (r.status === "passed") {
              passed.add(key(r));
              if (!r.suite) filesPassed.add(r.file);
              passes++;
            } else if (r.status === "skipped" || r.status === "todo") unrun.push(r);
            else if (r.status !== "failed") problems.push(`${named(r)} has an unknown status ${r.status}`);
          }
        }
      }
      if (mine.length && passes === 0) problems.push(`${job} heard no test pass`);
    }
    if (!suite.jobs.some((j) => needs[j]?.result && needs[j]?.result !== "skipped")) continue;
    const listed = listing.filter(suite.lists);
    if (listed.length < suite.floor) problems.push(`${suite.name} lists ${listed.length} test files, under its floor of ${suite.floor}`);
    for (const f of listed) if (!filesPassed.has(f)) problems.push(`${f} is in ${suite.name}'s listing and no test in it passed`);
  }
  for (const r of unrun) {
    if (!passed.has(key(r)) && !quarantined.has(key(r))) problems.push(`${named(r)} was ${r.status === "todo" ? "left todo" : "skipped"}, never passed elsewhere in the run, and is not quarantined in ${LEDGER}`);
  }
  return [...new Set(problems)];
}

/** @param {string} text */
const records = (text) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { type: "unreadable" };
      }
    });

/** @param {string} dir the `gh run download` directory, one subdirectory per artifact */
export function readArtifacts(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      runs: readdirSync(path.join(dir, d.name), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .map((f) => ({ file: f.split(path.sep).join("/"), records: records(readFileSync(path.join(dir, d.name, f), "utf8")) })),
    }));
}

/** @typedef {(args: string[]) => string} Exec */
/** @type {Exec} */
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024, timeout: 5 * 60_000 });
/** @type {Exec} */
const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

/** @param {string} status `git diff --name-status -z`, whose renames carry two paths */
export function renames(status) {
  const f = status.split("\0");
  /** @type {[string, string][]} */
  const out = [];
  for (let i = 0; i < f.length - 1; ) {
    const s = f[i] ?? "";
    if (/^[RC]/.test(s)) {
      if (s[0] === "R") out.push([f[i + 1] ?? "", f[i + 2] ?? ""]);
      i += 3;
    } else i += 2;
  }
  return out;
}

/**
 * @param {Exec} at
 * @param {string} rev
 */
function ledgerAt(at, rev) {
  if (!at(["ls-tree", "--name-only", rev, "--", LEDGER]).trim()) return null;
  return JSON.parse(at(["show", `${rev}:${LEDGER}`]));
}

/**
 * `HEAD` is the commit the run tested; `BASE` the base branch's tip it merges onto, main's tip for
 * a dispatch or a schedule, or `HEAD` on a push to main alone. `NEEDS` is the workflow's
 * `toJSON(needs)`; `EVENT` and `REF` are the run's `github.event_name` and `github.ref`.
 * @param {Record<string, string | undefined>} env
 * @param {{ gh?: Exec, git?: Exec, log?: (line: string) => void }} [io]
 */
export function run(env, { gh: hub = gh, git: at = git, log = console.log } = {}) {
  const repo = env.GITHUB_REPOSITORY ?? "";
  const runId = Number(env.GITHUB_RUN_ID);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo) || !Number.isInteger(runId) || runId <= 0 || !env.BASE) {
    log("::error::GITHUB_REPOSITORY, GITHUB_RUN_ID and BASE must name the run and the base it merges onto.");
    return 1;
  }
  const mainPush = env.EVENT === "push" && env.REF === "refs/heads/main";
  if (env.BASE === "HEAD" && !mainPush) {
    log(`::error::BASE is HEAD on a ${escape(env.EVENT)} of ${escape(env.REF)}; only a push to main is its own base.`);
    return 1;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "test-results-"));
  try {
    const needs = JSON.parse(env.NEEDS ?? "null") ?? {};
    const names = hub(["api", `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, "--paginate", "--jq", `.artifacts[] | select(.name | startswith("${ARTIFACT_PREFIX}")) | .name`])
      .split("\n")
      .filter(Boolean);
    if (names.length) hub(["run", "download", String(runId), "--repo", repo, "--pattern", `${ARTIFACT_PREFIX}*`, "--dir", dir]);
    const artifacts = readArtifacts(dir);
    if (artifacts.length !== new Set(names).size) log(`::error::${artifacts.length} of ${new Set(names).size} results artifacts arrived`);
    const ledger = { head: ledgerAt(at, "HEAD") ?? { quarantine: [] }, base: ledgerAt(at, env.BASE) };
    const issues = new Set(typeof entries(ledger.head) === "string" ? [] : /** @type {Quarantined[]} */ (entries(ledger.head)).map((e) => e.issue));
    /** @type {Map<number, Ticket>} */
    const tickets = new Map();
    for (const n of issues) {
      const t = JSON.parse(hub(["api", `repos/${repo}/issues/${n}`, "--jq", `{state, created_at, pr: (.pull_request != null), labels: [.labels[].name]}`]));
      tickets.set(n, { open: t.state === "open" && !t.pr, labelled: t.labels.includes(LABEL), created: Date.parse(t.created_at) });
    }
    const listing = at(["ls-tree", "-r", "-z", "--name-only", "HEAD"]).split("\0").filter(Boolean);
    const own = env.BASE === "HEAD";
    const changed = own ? [] : at(["diff", "--name-only", "-z", env.BASE, "HEAD"]).split("\0").filter(Boolean);
    const renamed = own ? [] : renames(at(["diff", "-M", "--name-status", "-z", env.BASE, "HEAD"]));
    const scope = own ? null : scopeOf(changed);
    const problems = verdict({ needs, artifacts, listing, ledger, tickets, changed, renamed, scope, now: Date.now() });
    const records = artifacts.reduce((n, a) => n + a.runs.reduce((m, r) => m + r.records.length, 0), 0);
    for (const p of problems.slice(0, 100)) log(`::error::${escape(p)}`);
    if (problems.length > 100) log(`::error::and ${problems.length - 100} more`);
    log(`${artifacts.length} results artifacts, ${records} records: ${problems.length ? `${problems.length} problems (RULES.md 53)` : "every test that ran passed, once, and none was skipped unheard"}`);
    return problems.length || artifacts.length !== new Set(names).size ? 1 : 0;
  } catch (err) {
    log(`::error::the results could not be read: ${escape(String(err instanceof Error ? err.message : err).split("\n")[0])}`);
    return 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) process.exitCode = run(process.env);
