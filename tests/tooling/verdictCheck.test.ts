import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { CHECK, JOB_NAMES, needsOf, resultOf, run } from "../../tools/ci/verdict-check.mjs";
import { NON_TEST_JOBS, SUITES } from "../../tools/ci/test-verdict.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOW = ".github/workflows/test-verdict.yml";
const workflowText = fs.readFileSync(path.join(root, WORKFLOW), "utf8");
const workflow = parse(workflowText);
const ciJobs = parse(fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")).jobs as Record<string, { name?: string; needs?: string[] }>;
const job = Object.values(workflow.jobs)[0] as { name: string; if: string; steps: { uses?: string; with?: Record<string, unknown>; run?: string; env?: Record<string, string> }[] };

const NAMES: Record<string, string> = JOB_NAMES;
/** A run's jobs as the API lists them, every need run once and green. */
const green = () =>
  Object.entries(NAMES).flatMap(([id, name]) =>
    (name.includes("${{") ? [1, 2] : [0]).map((n) => ({ name: n ? name.replace(/\$\{\{ matrix\.shard \}\}/, String(n)).replace(/\$\{\{ strategy\.job-total \}\}/, "2") : name, status: "completed", conclusion: id.endsWith("-build") ? "skipped" : "success" })),
  );

describe("CI's jobs, named as main's ci.yml names them", () => {
  test("JOB_NAMES is CI gate's needs, each with its ci.yml name, and the verdict knows every one", () => {
    assert.deepEqual(Object.keys(NAMES).sort(), [...ciJobs["ci-gate"]!.needs!].sort());
    for (const [id, name] of Object.entries(NAMES)) assert.equal(name, ciJobs[id]!.name, id);
    assert.deepEqual(Object.keys(NAMES).sort(), [...new Set([...SUITES.flatMap((s) => s.jobs), ...NON_TEST_JOBS])].sort());
  });

  test("a matrix folds as needs does, a skipped one is matched expanded, bare or not, and a job of the head's own is ignored", () => {
    const { needs, problems } = needsOf([...green(), { name: "Test verdict", status: "completed", conclusion: "success" }]);
    assert.deepEqual(problems, []);
    assert.deepEqual(needs.verify, { result: "success" });
    assert.deepEqual(needs["ios-build"], { result: "skipped" });
    assert.equal(needs["browser-report"]!.result, "success");
    for (const name of ["Browser tests", "Browser tests ${{ matrix.shard }}/${{ strategy.job-total }}"]) {
      const jobs = green().filter((j) => !j.name.startsWith("Browser tests "));
      assert.deepEqual(needsOf([...jobs, { name, status: "completed", conclusion: "skipped" }]).needs.browser, { result: "skipped" }, name);
    }
  });

  test("a red, a cancelled or an unfinished shard, and a need CI never ran, are each reported", () => {
    assert.equal(resultOf(["success", "failure"]), "failure");
    assert.equal(resultOf(["success", "cancelled"]), "cancelled");
    assert.equal(resultOf(["success", "timed_out"]), "failure");
    assert.equal(resultOf(["skipped", "skipped"]), "skipped");
    const jobs = green().filter((j) => j.name !== "Lint");
    jobs[0] = { ...jobs[0]!, status: "in_progress", conclusion: null as unknown as string };
    const { problems } = needsOf(jobs);
    assert.ok(problems.some((p) => /has not completed \(in_progress\)/.test(p)), problems.join("\n"));
    assert.ok(problems.some((p) => /ran no job named "Lint" \(lint\)/.test(p)), problems.join("\n"));
  });
});

describe("the workflow runs main's judge on CI's own record, and of the head's only its objects", () => {
  test("it runs when CI completes, posts only for a pull request's run, and its job is not named the check", () => {
    assert.deepEqual(workflow.on, { workflow_run: { workflows: ["CI"], types: ["completed"] } });
    assert.equal(job.if, "github.event.workflow_run.event == 'pull_request'");
    assert.notEqual(job.name, CHECK);
  });

  test("its token reads, and writes checks only; it holds no secret, cache or install", () => {
    assert.deepEqual(workflow.permissions, { actions: "read", checks: "write", contents: "read", issues: "read", "pull-requests": "read" });
    assert.doesNotMatch(workflowText, /secrets\.|actions\/cache|\.github\/actions\/install|\bnpm\b|\bnpx\b/);
  });

  test("the checkout is main's, pinned as ci.yml pins it, one commit of the judge's files, with no credential", () => {
    const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
    const uses = job.steps.filter((s) => s.uses);
    assert.deepEqual(uses.map((s) => s.uses!.split("@")[0]), ["actions/checkout", "actions/setup-node"]);
    for (const s of uses) assert.ok(ci.includes(`uses: ${s.uses}`), `${s.uses} is not ci.yml's pin`);
    const { "sparse-checkout": sparse, ...rest } = uses[0]!.with as Record<string, unknown>;
    assert.deepEqual(rest, { "fetch-depth": 1, "persist-credentials": false, "sparse-checkout-cone-mode": false });
    const patterns = String(sparse).split("\n").filter(Boolean);
    const inSparse = (f: string) => patterns.some((p) => (p.endsWith("/") ? `/${f}`.startsWith(p) : `/${f}` === p));
    assert.ok(inSparse(".node-version"));
    const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).stdout.split("\0").filter(Boolean);
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), "verdict-sparse-"));
    try {
      for (const f of tracked.filter(inSparse)) {
        fs.mkdirSync(path.join(checkout, path.dirname(f)), { recursive: true });
        fs.copyFileSync(path.join(root, f), path.join(checkout, f));
      }
      const loaded = spawnSync(process.execPath, ["--input-type=module", "-e", 'await import("./tools/ci/verdict-check.mjs");'], { cwd: checkout, encoding: "utf8" });
      assert.equal(loaded.status, 0, `the script does not load from the sparse checkout:\n${loaded.stderr}`);
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });

  test("its one run is main's script, with no field of the event in the shell", () => {
    const runs = job.steps.filter((s) => s.run);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.run, "node tools/ci/verdict-check.mjs");
    assert.deepEqual(runs[0]!.env, { GH_TOKEN: "${{ github.token }}" });
  });
});

describe("a CI run judged over scratch histories", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "verdict-check-"));
  after(() => fs.rmSync(work, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const sh = (dir: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const listed = Array.from({ length: SUITES[0]!.floor }, (_, i) => `tests/a/t${i}.test.ts`);
  const added = `tests/a/t${listed.length}.test.ts`;
  const notes = ["docs", "notes.md"].join("/");

  /**
   * A head branched with a docs change; its base branch, `release`, then gains a test, and `main`
   * moves on with code. CI ran the head merged onto `release`, so its records hold the added test.
   */
  function histories() {
    const origin = fs.mkdtempSync(path.join(work, "origin-"));
    const write = (file: string, text: string) => (fs.mkdirSync(path.dirname(path.join(origin, file)), { recursive: true }), fs.writeFileSync(path.join(origin, file), text));
    const commit = (m: string) => (sh(origin, "add", "-A"), sh(origin, "commit", "-q", "-m", m), sh(origin, "rev-parse", "HEAD"));
    sh(origin, "init", "-q", "-b", "main");
    sh(origin, "config", "uploadpack.allowFilter", "true");
    sh(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
    for (const f of listed) write(f, "");
    commit("base");
    sh(origin, "branch", "release");
    sh(origin, "checkout", "-q", "-b", "head");
    write(notes, "x");
    const head = commit("head");
    sh(origin, "checkout", "-q", "release");
    write(added, "");
    const base = commit("release gains a test");
    sh(origin, "checkout", "-q", "main");
    write(["lib", "code.ts"].join("/"), "1");
    commit("main moves");
    return { head, base, origin: `file://${origin}` };
  }

  type Judged = { event?: string; workflowId?: number; jobs?: ReturnType<typeof green>; failed?: boolean; conclusion?: string; listedPr?: boolean; nowAt?: string; newer?: boolean; ciLookup?: () => string };
  function judge({ event = "pull_request", workflowId = 77, jobs = green(), failed = false, conclusion = "success", listedPr = true, nowAt, newer = false, ciLookup = () => "77\n" }: Judged = {}) {
    const { head, base, origin } = histories();
    const eventPath = path.join(work, `event-${path.basename(origin)}.json`);
    const pr = { number: 7, head: { sha: head }, base: { ref: "release", sha: base } };
    fs.writeFileSync(eventPath, JSON.stringify({ workflow_run: { id: 5, run_attempt: 1, head_sha: head, head_branch: "head", head_repository: { owner: { login: "f" } }, event, conclusion, workflow_id: workflowId, html_url: "https://example.invalid/run/5", pull_requests: listedPr ? [pr] : [] } }));
    const records = [{ type: "run", runner: "node", filters: [] }, ...[...listed, added].map((file, i) => ({ type: "test", file, title: "t", status: failed && i === 0 ? "failed" : "passed" })), { type: "end", ok: !failed }];
    const posted: Record<string, any>[] = [];
    const asked: string[] = [];
    const gh = (args: string[]) => {
      if (args[0] === "api" && args[1] === "-X") return (posted.push(JSON.parse(fs.readFileSync(args[args.indexOf("--input") + 1]!, "utf8"))), "{}");
      asked.push(args[1]!);
      if (args[1]!.endsWith("/actions/workflows/ci.yml")) return ciLookup();
      if (args[1]!.endsWith("/runs/5/jobs?filter=latest&per_page=100")) return jobs.map((j) => JSON.stringify(j)).join("\n");
      if (args[1]!.includes("/runs/5/artifacts")) return "test-results-verify-1-1\n";
      if (args[1] === "repos/o/r/pulls/7") return `${nowAt ?? head}\n`;
      if (args[1]!.startsWith("repos/o/r/actions/workflows/ci.yml/runs?head_sha=")) return newer ? "5\n6\n" : "5\n";
      if (args[1] === "repos/o/r/pulls?state=open&per_page=100&head=f%3Ahead") return `${JSON.stringify({ number: 7, head: { sha: head }, base: { sha: base } })}\n`;
      if (args[0] === "run" && args[1] === "download") {
        const dir = path.join(args[args.indexOf("--dir") + 1]!, "test-results-verify-1-1");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "node-1.jsonl"), records.map((r) => JSON.stringify(r)).join("\n"));
        return "";
      }
      throw new Error(`unexpected gh ${args.join(" ")}`);
    };
    const said: string[] = [];
    const code = run({ GITHUB_REPOSITORY: "o/r", GITHUB_EVENT_PATH: eventPath, ORIGIN: origin }, { gh, log: (l) => void said.push(l) });
    return { code, posted, asked, said: said.join("\n"), head };
  }

  /** A docs-only change: the suites its scope skips are skipped, and verify ran. */
  const docsRun = () =>
    green().map((j) => (/^(Loop harness|Native tests|Browser tests |Lint$|Build and boot$)/.test(j.name) ? { ...j, conclusion: "skipped" } : j));

  test("a green run posts a green check on the head, judged as the merge onto the event's base CI ran, not onto main", () => {
    for (const listedPr of [true, false]) {
      const r = judge({ jobs: docsRun(), listedPr });
      assert.equal(r.code, 0, r.said);
      assert.equal(r.posted.length, 1, r.said);
      assert.deepEqual([r.posted[0]!.name, r.posted[0]!.head_sha, r.posted[0]!.status, r.posted[0]!.conclusion], [CHECK, r.head, "completed", "success"], r.said);
    }
  });

  test("a failed test, or a need CI did not run, posts a red check naming it", () => {
    const failed = judge({ jobs: docsRun(), failed: true });
    assert.equal(failed.posted[0]!.conclusion, "failure");
    assert.match(failed.posted[0]!.output.text, /t0\.test\.ts › t failed/);
    const missing = judge({ jobs: docsRun().filter((j) => j.name !== "Secret scan") });
    assert.equal(missing.posted[0]!.conclusion, "failure");
    assert.match(missing.posted[0]!.output.text, /ran no job named "Secret scan"/);
  });

  test("a run of a workflow that only calls itself CI posts nothing, and neither does a run not of a pull request", () => {
    const spoof = judge({ workflowId: 78 });
    assert.equal(spoof.code, 1);
    assert.deepEqual(spoof.posted, []);
    const push = judge({ event: "push" });
    assert.equal(push.code, 0);
    assert.deepEqual(push.posted, []);
  });

  test("a lookup that fails posts red rather than leaving the check pending", () => {
    const r = judge({ ciLookup: () => { throw new Error("HTTP 502"); } });
    assert.equal(r.posted[0]!.conclusion, "failure", r.said);
    assert.match(r.posted[0]!.output.text, /HTTP 502/);
  });

  test("a cancelled run a newer one replaced posts nothing; one nothing replaced posts red", () => {
    const cancelled = () => docsRun().map((j) => (j.name === "Secret scan" ? { ...j, conclusion: "cancelled" } : j));
    for (const replaced of [{ nowAt: "0".repeat(40) }, { newer: true }]) {
      const r = judge({ conclusion: "cancelled", jobs: cancelled(), ...replaced });
      assert.equal(r.code, 0, r.said);
      assert.deepEqual(r.posted, [], r.said);
    }
    const r = judge({ conclusion: "cancelled", jobs: cancelled() });
    assert.equal(r.posted[0]!.conclusion, "failure", r.said);
  });
});
