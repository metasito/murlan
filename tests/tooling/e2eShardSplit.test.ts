import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assignShards,
  filesForShard,
  MAX_CONCURRENT_JOBS,
  MAX_SHARDS,
  plan,
  readTimings,
  shardsNeeded,
  specFilesIn,
  splitProblems,
  TARGET_RUN_SECONDS,
  UNMEASURED_SECONDS,
} from "../../tools/ci/e2e-shard.mjs";
import { NIGHTLY, PERF } from "../e2e/tiers.mjs";
import { loadWorkflow, needsOf, type Job } from "../helpers/workflow.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const E2E_DIR = path.join(repoRoot, "tests", "e2e");
const ciYml = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
const ciJobs = Object.entries(loadWorkflow("ci.yml").jobs);
// Left out: the device compiles, which start only on a native change or the weekly schedule — runs
// their own 9–29 min already put far past the target (#1408), where two queued jobs cost nothing.
const deviceCompile = (job: Job) => /\boutputs\.native\b/.test(job.if ?? "");
// A job that needs the shards' own job starts only once every shard has finished.
const afterShards = (job: Job) => needsOf(job).includes("browser");
const besideShards = ciJobs
  .filter(([id, job]) => id !== "scope" && id !== "browser" && !afterShards(job) && !deviceCompile(job))
  .reduce((n, [, job]) => {
    const shard = job.strategy?.matrix?.shard;
    return n + (Array.isArray(shard) ? shard.length : 1);
  }, 0);
const SHARDS = plan([path.join(E2E_DIR, "timings.json")]).shards.length;

/** The spec files Playwright itself lists under `config`, relative to tests/e2e. */
function playwrightLists(config: string): string[] {
  const out = execFileSync(
    process.execPath,
    [createRequire(import.meta.url).resolve("@playwright/test/cli"), "test", "--list", "--reporter=json", "-c", path.join(E2E_DIR, config)],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, MURLAN_MAIL_SINK: path.join(tmpdir(), "e2e-shard-split-mail.jsonl") } },
  );
  const listing = JSON.parse(out.slice(out.indexOf("{"))) as { suites: { file: string }[]; errors: unknown[] };
  assert.deepEqual(listing.errors, [], `${config} does not load`);
  return listing.suites.map((s) => s.file).sort();
}
const PR_RUN = playwrightLists("playwright.config.ts");
const NIGHTLY_RUN = playwrightLists("playwright.parity.config.ts");
const specFiles = () =>
  (readdirSync(E2E_DIR, { recursive: true }) as string[]).map((f) => f.split(path.sep).join("/")).filter((f) => /\.spec\.ts$/.test(f));

describe("every browser spec reaches exactly one shard", () => {
  test("the splitter sees every spec Playwright would run, under a floor", () => {
    assert.ok(PR_RUN.length >= 40, `only ${PR_RUN.length} specs found`);
    assert.ok(SHARDS >= 2, `the plan runs ${SHARDS} shard`);
    assert.deepEqual(specFilesIn(E2E_DIR), PR_RUN);
  });

  test("ci.yml runs the shards the scope job planned, and counts that many back", () => {
    assert.match(ciYml, /node tools\/ci\/e2e-shard\.mjs plan /);
    assert.match(ciYml, /shard: \$\{\{ fromJSON\(needs\.scope\.outputs\.shards\) \}\}/);
    assert.match(ciYml, /TIMINGS: \$\{\{ needs\.scope\.outputs\.timings \}\}\n\s+run: printf '%s' "\$TIMINGS" > tests\/e2e\/timings\.json/);
    assert.match(ciYml, /e2e-shard\.mjs \$\{\{ matrix\.shard \}\} \$\{\{ strategy\.job-total \}\}/);
    assert.match(ciYml, /if \[ "\$found" -ne "\$\{\{ needs\.scope\.outputs\.shard-count \}\}" \]/);
    assert.match(ciYml, /if: \$\{\{ needs\.browser\.result == 'success' \}\}\n(?:\s+(?:id|continue-on-error|uses):.*\n)+\s+with:\n\s+name: e2e-timings\n/);
  });

  test("the weekly timings commit passes this file before it lands, as its bot push runs no CI", () => {
    const step = /- name: Commit the regenerated timings[\s\S]*?\n\n/.exec(ciYml)?.[0] ?? "";

    assert.match(step, /node --test tests\/tooling\/e2eShardSplit\.test\.ts[\s\S]*git commit /);
  });

  test("the weekly timings commit installs the packages this file imports, under the commit's own gate", () => {
    const steps = loadWorkflow("ci.yml").jobs["browser-report"].steps ?? [];
    const commit = steps.findIndex((s) => s.name === "Commit the regenerated timings, if main's copy is stale");
    const install = steps.findIndex((s) => s.uses === "./.github/actions/install");
    assert.ok(commit > 0, "browser-report has no timings commit step");
    assert.ok(install >= 0 && install < commit, "the commit runs this file, which imports `yaml`, with no node_modules");
    assert.equal(steps[install].if, steps[commit].if);
  });

  test("a spec in a subdirectory is placed, as Playwright would run it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-shard-"));
    try {
      mkdirSync(path.join(dir, "online"));
      for (const f of ["a.spec.ts", "online/b.spec.ts", "online/c.nightly.spec.ts", "webPerf.spec.ts", "helper.ts"]) {
        writeFileSync(path.join(dir, f), "");
      }
      assert.deepEqual(specFilesIn(dir), ["a.spec.ts", "online/b.spec.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the union of the shards is the whole suite, with nothing repeated", () => {
    const files = PR_RUN;
    const assigned = assignShards(files, readTimings(), SHARDS).flatMap((s) => s.files);

    assert.deepEqual([...assigned].sort(), [...files].sort());
    assert.equal(new Set(assigned).size, assigned.length, "a spec is in two shards");
  });

  test("a spec nobody has measured is still placed", () => {
    // The failure this exists for: a new spec is added, no one updates
    // timings.json, and the suite quietly stops covering it.
    const files = [...specFilesIn(E2E_DIR), "brandNew.spec.ts"];
    const assigned = assignShards(files, readTimings(), SHARDS).flatMap((s) => s.files);

    assert.ok(assigned.includes("brandNew.spec.ts"));
  });

  test("an unmeasured spec is assumed slow, not free", () => {
    const [heavy] = assignShards(["a.spec.ts"], {}, 1);

    assert.equal(heavy.seconds, UNMEASURED_SECONDS);
  });

  test("webPerf is left out, as playwright.config.ts also ignores it", () => {
    assert.ok(
      readdirSync(E2E_DIR).includes("webPerf.spec.ts"),
      "this test is pinning an exclusion that no longer has anything to exclude"
    );
    assert.ok(!specFilesIn(E2E_DIR).includes("webPerf.spec.ts"));
  });

  test("every spec runs in exactly one tier: a pull request's, nightly's, or the perf recorder's", () => {
    const all = specFiles();
    assert.ok(NIGHTLY_RUN.length >= 20, `only ${NIGHTLY_RUN.length} nightly specs found`);
    assert.deepEqual(NIGHTLY_RUN, all.filter((f) => NIGHTLY.test(f)).sort());
    const perf = all.filter((f) => PERF.test(f));
    assert.deepEqual(perf, ["webPerf.spec.ts"]);
    assert.deepEqual([...PR_RUN, ...NIGHTLY_RUN, ...perf].sort(), [...all].sort());
  });

  test("the layout guards with no pixels in them run on every pull request", () => {
    for (const file of ["handParity.spec.ts", "lampSeats.spec.ts"]) assert.ok(PR_RUN.includes(file), file);
    assert.ok(NIGHTLY_RUN.includes("lampSeats.nightly.spec.ts"), "the felt's pixels left the nightly run");
  });
});

describe("the split is stable and even", () => {
  test("the same suite always splits the same way", () => {
    const once = assignShards(specFilesIn(E2E_DIR), readTimings(), SHARDS);
    const twice = assignShards(specFilesIn(E2E_DIR), readTimings(), SHARDS);

    assert.deepEqual(once, twice);
  });

  test("no shard carries more than a third again of the lightest", () => {
    // The defect #441 was filed over was a 2m11s shard and a 5m20s shard in
    // the same run. Longest-processing-time guarantees far better than this;
    // the margin is here so a pathological timings.json still fails loudly.
    const seconds = assignShards(specFilesIn(E2E_DIR), readTimings(), SHARDS).map((s) => s.seconds);

    assert.ok(
      Math.max(...seconds) <= Math.min(...seconds) * (4 / 3),
      `shards range ${Math.min(...seconds)}s to ${Math.max(...seconds)}s`
    );
  });

  test("the evenness above is measured, not assumed, over the numbers the run splits by", () => {
    const steps = loadWorkflow("ci.yml").jobs["browser-report"].steps ?? [];
    const check = steps.find((s) => /node tools\/ci\/e2e-shard\.mjs check "\$RUNNER_TEMP\/split-timings\.json"/.test(s.run ?? ""));

    assert.ok(check, "browser-report no longer checks how much of the split was guessed");
    assert.equal(check.env?.TIMINGS, "${{ needs.scope.outputs.timings }}");
    assert.match(check.run ?? "", /printf '%s' "\$TIMINGS" > "\$RUNNER_TEMP\/split-timings\.json"\n/);
    assert.equal(check["continue-on-error"], undefined);
    assert.equal(check.if, "${{ !cancelled() }}");
  });

  test("no spec is larger than a shard's fair share", () => {
    const files = specFilesIn(E2E_DIR);
    const timings = readTimings();
    const seconds = (f: string) => timings[f] ?? UNMEASURED_SECONDS;
    const fair = files.reduce((sum, f) => sum + seconds(f), 0) / SHARDS;
    const over = files.filter((f) => seconds(f) > fair).map((f) => `${f} ${seconds(f)}s`);

    assert.deepEqual(over, [], `over the ${fair.toFixed(0)}s each of ${SHARDS} shards gets; split them`);
  });

  test("the target is the owner's five minutes, as rule 46 states it", () => {
    const rules = readFileSync(path.join(repoRoot, "docs", "agents", "RULES.md"), "utf8");
    const rule = /^46\. \*\*The whole CI run stays under 5 minutes[^\n]*`TARGET_RUN_SECONDS`[^\n]* is (\d+)\.\*\*/m.exec(rules);

    assert.ok(rule, "docs/agents/RULES.md no longer carries rule 46, the owner's CI target");
    assert.equal(Number(rule[1]), 300, "rule 46 names a target other than the owner's 300 s");
    assert.equal(TARGET_RUN_SECONDS, 300, "TARGET_RUN_SECONDS moved off rule 46's 300 s; only the owner changes it");
  });

  test("a suite past the target within the shards a run may have is a problem of the split", () => {
    const suite = Array.from({ length: 40 }, (_, i) => `s${i}.spec.ts`);
    const priced = (seconds: number) => Object.fromEntries(suite.map((f) => [f, seconds]));
    const fits = (seconds: number) => shardsNeeded(suite, priced(seconds)) <= MAX_SHARDS;
    const most = Array.from({ length: 400 }, (_, s) => s).filter(fits).at(-1) ?? 0;

    assert.ok(most > 0 && !fits(400), "the fixture never crosses the target");
    assert.deepEqual(splitProblems(suite, priced(most)), []);
    assert.match(splitProblems(suite, priced(most + 1)).join(), new RegExp(`over the ${MAX_SHARDS} allowed`));
  });

  test("the shards and every job started beside them fit the measured concurrency cap", () => {
    assert.ok(besideShards >= 8, `found ${besideShards} jobs beside the shards; the split of ci.yml is wrong`);
    assert.ok(MAX_SHARDS + besideShards <= MAX_CONCURRENT_JOBS, `${MAX_SHARDS} shards and ${besideShards} other jobs exceed ${MAX_CONCURRENT_JOBS}`);
    assert.equal(ciJobs.filter(([, job]) => deviceCompile(job)).length, 2, "only the two device compiles may be left out");
  });

  test("timings.json describes specs that exist", () => {
    const known = specFilesIn(E2E_DIR);
    const stale = Object.keys(readTimings()).filter((f) => !known.includes(f));

    assert.deepEqual(stale, [], "timings.json names specs that are gone: run `npm run regen`");
  });
});

describe("the plan prices each spec by its latest green run", () => {
  const files = ["heavy.spec.ts", ...Array.from({ length: 8 }, (_, i) => `light${i}.spec.ts`)];
  const even = Object.fromEntries(files.map((f) => [f, 100]));

  type Layer = Record<string, number> | Record<string, number>[];
  const planned = (layers: Record<string, Layer>, missing: string[] = []) => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-plan-"));
    const write = (name: string, timings: Record<string, number>) => {
      writeFileSync(path.join(dir, name), JSON.stringify(timings));
      return path.join(dir, name);
    };
    try {
      const paths = Object.entries(layers).map(([name, layer]) =>
        Array.isArray(layer) ? layer.map((timings, i) => write(`${name}${i}`, timings)) : write(name, layer)
      );
      return plan([...paths, ...missing.map((m) => path.join(dir, m))]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("a spec is priced at the median of a branch's recent runs, so one slow run does not move it", () => {
    const runs = [100, 95, 105, 100, 300].map((s) => ({ ...even, "heavy.spec.ts": s }));
    const { timings } = planned({ committed: { ...even, "heavy.spec.ts": 500 }, main: runs });

    assert.equal(timings["heavy.spec.ts"], 100);
  });

  test("an even count of runs prices a spec between its two middle runs", () => {
    const { timings } = planned({ main: [90, 110, 400, 100].map((s) => ({ ...even, "heavy.spec.ts": s })) });

    assert.equal(timings["heavy.spec.ts"], 105);
  });

  test("a run that did not measure a spec leaves it to the runs that did", () => {
    const { timings } = planned({ committed: { "light0.spec.ts": 50 }, main: [{ "heavy.spec.ts": 80 }, { "heavy.spec.ts": 120 }] });

    assert.equal(timings["light0.spec.ts"], 50);
    assert.equal(timings["heavy.spec.ts"], 100);
  });

  test("ci.yml hands the plan several of main's runs, and only the branch's latest", () => {
    assert.doesNotMatch(ciYml, /sort_by\(\.created_at\) \| last \| \.id/);
    assert.match(ciYml, /sort_by\(\.created_at\) \| \.\[-\$RUNS:\]/);
    assert.match(ciYml, /runs=\$RUNS; \[ "\$branch" != main \] && runs=1/);
    assert.match(ciYml, /--argjson RUNS "\$runs"/);
  });

  test("a spec heavier on the branch is priced as the branch runs it", () => {
    const { timings } = planned({ committed: even, main: even, branch: { "heavy.spec.ts": 600 } });

    assert.equal(timings["heavy.spec.ts"], 600);
    assert.equal(timings["light0.spec.ts"], 100);
    const alone = assignShards(files, timings, 4).find((s) => s.files.includes("heavy.spec.ts"));
    assert.deepEqual(alone?.files, ["heavy.spec.ts"]);
  });

  test("with no branch run, main's numbers win over the committed ones", () => {
    const { timings } = planned({ committed: even, main: { ...even, "heavy.spec.ts": 300 } }, ["branch"]);

    assert.equal(timings["heavy.spec.ts"], 300);
  });

  test("specs main has measured are not held against a pull request the committed file is stale for", () => {
    const suite = [...files, ...Array.from({ length: 11 }, (_, i) => `new${i}.spec.ts`)];
    const merged = Object.fromEntries(suite.map((f) => [f, 100]));
    const { timings } = planned({ committed: even, main: [merged] });

    assert.equal(splitProblems(suite, even).length, 1);
    assert.deepEqual(splitProblems(suite, timings), []);
  });

  test("a pull request bringing more unmeasured specs than the split absorbs is named, spec by spec", () => {
    const suite = [...files, "mine0.spec.ts", "mine1.spec.ts"];
    const [problem] = splitProblems(suite, planned({ committed: even, main: [even] }).timings);

    assert.match(problem ?? "", /2 of 11 specs .*: mine0\.spec\.ts, mine1\.spec\.ts\./);
    assert.deepEqual(splitProblems([...files, "mine0.spec.ts"], even), []);
  });

  test("a split of no spec at all is a problem, not a pass", () => {
    assert.equal(splitProblems([], even).length, 1);
  });

  test("the check exits red on a guessed split and green on a measured one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-check-"));
    const run = (timings: Record<string, number>) => {
      writeFileSync(path.join(dir, "t.json"), JSON.stringify(timings));
      try {
        execFileSync(process.execPath, [path.join(repoRoot, "tools", "ci", "e2e-shard.mjs"), "check", path.join(dir, "t.json")], { stdio: "pipe" });
        return 0;
      } catch (err) {
        return (err as { status: number }).status;
      }
    };
    try {
      assert.equal(run({}), 1);
      assert.equal(run(Object.fromEntries(specFilesIn(E2E_DIR).map((f) => [f, 1]))), 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the fit check grows with the suite", () => {
    const heavy = Object.fromEntries(files.map((f) => [f, 250]));
    assert.ok(shardsNeeded(files, heavy) > shardsNeeded(files, even));
  });
});

describe("the shard argument", () => {
  test("names each shard exactly once across 1..n", () => {
    const all = Array.from({ length: SHARDS }, (_, i) => filesForShard(i + 1, SHARDS)).flat();

    assert.deepEqual([...all].sort(), [...specFilesIn(E2E_DIR)].sort());
  });

  test("refuses an index outside the run", () => {
    assert.throws(() => filesForShard(0, SHARDS), /shard index/);
    assert.throws(() => filesForShard(SHARDS + 1, SHARDS), /shard index/);
    assert.throws(() => assignShards([], {}, 0), /positive integer/);
  });
});
