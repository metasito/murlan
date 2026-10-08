import { test, describe } from "node:test";
import assert from "node:assert/strict";
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
  readRunCosts,
  readTimings,
  shardsNeeded,
  specFilesIn,
  TARGET_RUN_SECONDS,
  UNMEASURED_SECONDS,
} from "../../tools/ci/e2e-shard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const E2E_DIR = path.join(repoRoot, "tests", "e2e");
const ciYml = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
const ciJobs = ciYml.slice(ciYml.indexOf("\njobs:\n")).split(/\n(?= {2}[a-z][\w-]*:\n)/).slice(1);
const SHARDS = plan([path.join(E2E_DIR, "timings.json")]).shards.length;

const config = readFileSync(path.join(E2E_DIR, "playwright.config.ts"), "utf8");
const ignore = /testIgnore: \/(.+)\/,$/m.exec(config);
assert.ok(ignore, "playwright.config.ts no longer declares a testIgnore regex");
/** Playwright's own walk: recursive from `testDir`, its default testMatch, minus the config's ignore. */
const playwrightRuns = (dir: string) =>
  (readdirSync(dir, { recursive: true }) as string[])
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(f) && !new RegExp(ignore[1]).test(f))
    .sort();

/**
 * How much of the suite may sit at `UNMEASURED_SECONDS` before the evenness
 * assertion below stops being about time. Room for a spec or two written since
 * the last measurement, and nowhere near enough for the constant to carry the
 * split.
 */
const UNMEASURED_SHARE = 0.1;

describe("every browser spec reaches exactly one shard", () => {
  test("the splitter sees every spec Playwright would run, under a floor", () => {
    const files = playwrightRuns(E2E_DIR);
    assert.ok(files.length >= 40, `only ${files.length} specs found`);
    assert.ok(SHARDS >= 2, `the plan runs ${SHARDS} shard`);
    assert.deepEqual(specFilesIn(E2E_DIR), files);
  });

  test("ci.yml runs the shards the scope job planned, and counts that many back", () => {
    assert.match(ciYml, /node tools\/ci\/e2e-shard\.mjs plan /);
    assert.match(ciYml, /shard: \$\{\{ fromJSON\(needs\.scope\.outputs\.shards\) \}\}/);
    assert.match(ciYml, /TIMINGS: \$\{\{ needs\.scope\.outputs\.timings \}\}\n\s+run: printf '%s' "\$TIMINGS" > tests\/e2e\/timings\.json/);
    assert.match(ciYml, /e2e-shard\.mjs \$\{\{ matrix\.shard \}\} \$\{\{ strategy\.job-total \}\}/);
    assert.match(ciYml, /if \[ "\$found" -ne "\$\{\{ needs\.scope\.outputs\.shard-count \}\}" \]/);
    assert.match(ciYml, /if: \$\{\{ needs\.browser\.result == 'success' \}\}\n.*\n\s+with:\n\s+name: e2e-timings\n/);
  });

  test("the weekly timings commit passes this file before it lands, as its bot push runs no CI", () => {
    const step = /- name: Commit the regenerated timings[\s\S]*?\n\n/.exec(ciYml)?.[0] ?? "";
    const price = /- name: Price this run's time outside the specs[\s\S]*?\n\n/.exec(ciYml)?.[0] ?? "";

    assert.match(step, /node --test tests\/tooling\/e2eShardSplit\.test\.ts[\s\S]*git commit /);
    assert.match(price, /run: \|\n\s+rm tests\/e2e\/run-costs\.json\n/);
    assert.match(price, /node tools\/ci\/ci-run-costs\.mjs [^\n]* tests\/e2e\/run-costs\.json\n\s+cp tests\/e2e\/run-costs\.json "\$RUNNER_TEMP\/run-costs\.json"\n/);
    assert.match(ciYml, /name: e2e-timings\n\s+path: \|\n\s+tests\/e2e\/timings\.json\n\s+tests\/e2e\/run-costs\.json\n/);
    assert.match(step, /git commit [^\n]*-- tests\/e2e\/timings\.json tests\/e2e\/run-costs\.json\n/);
    assert.match(step, /git reset --hard [^\n]*\n\s+node tools\/ci\/e2e-timings\.mjs [^\n]*\n\s+cp "\$RUNNER_TEMP\/run-costs\.json" tests\/e2e\/run-costs\.json\n/);
    assert.ok(ciYml.indexOf(price) > ciYml.indexOf("- name: Regenerate tests/e2e/timings.json"), "the price step runs before this run's timings exist");
    const commitCron = /github\.event\.schedule == '([^']+)'/.exec(step)?.[1];
    assert.ok(price.includes(`continue-on-error: \${{ github.event.schedule != '${commitCron}' }}`), "a refused price must red the run that commits it, and only that run");
  });

  test("the weekly run that commits the record starts no job the record leaves out", () => {
    const crons = [...ciYml.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);
    const commitIf = /- name: Commit the regenerated timings[^\n]*\n\s+if: ([^\n]*)/.exec(ciYml)?.[1] ?? "";
    const commitCron = /github\.event\.schedule == '([^']+)'/.exec(commitIf)?.[1] ?? "";
    const native = ciJobs.filter((job) => /^ {4}if: .*\bnative\b/m.test(job));

    assert.ok(crons.includes(commitCron), `the timings commit (${commitIf}) runs on none of ci.yml's crons ${crons.join(", ")}`);
    assert.ok(native.length >= 2, `found ${native.length} device compile jobs; the split of ci.yml is wrong`);
    for (const job of native) {
      const cond = /^ {4}if: (.*)$/m.exec(job)?.[1] ?? "";
      assert.ok(!/event_name == 'schedule'/.test(cond) && !cond.includes(`'${commitCron}'`), `${job.split("\n")[0]} runs on the cron that commits the record: ${cond}`);
    }
  });

  test("a spec in a subdirectory is placed, as Playwright would run it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-shard-"));
    try {
      mkdirSync(path.join(dir, "online"));
      for (const f of ["a.spec.ts", "online/b.spec.ts", "webPerf.spec.ts", "helper.ts"]) {
        writeFileSync(path.join(dir, f), "");
      }
      assert.deepEqual(playwrightRuns(dir), ["a.spec.ts", "online/b.spec.ts"]);
      assert.deepEqual(specFilesIn(dir), playwrightRuns(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the union of the shards is the whole suite, with nothing repeated", () => {
    const files = playwrightRuns(E2E_DIR);
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

  test("the evenness above is measured, not assumed", () => {
    // What the assertion above compares is `UNMEASURED_SECONDS` per unmeasured
    // spec, and a constant divides evenly: the less of the suite is measured,
    // the more even the split looks. At 22 of 47 unmeasured it read a flat 331s
    // across six shards that really ran 119s to 226s, and #441's defect was
    // back with its own guard reporting it fixed. Counted rather than weighed,
    // because weighing needs the very seconds that are missing.
    const files = specFilesIn(E2E_DIR);
    const timings = readTimings();
    const guessed = files.filter((file) => !(file in timings));

    assert.ok(
      guessed.length <= files.length * UNMEASURED_SHARE,
      `${guessed.length} of ${files.length} specs are priced at the ${UNMEASURED_SECONDS}s ` +
        `guess, over the ${UNMEASURED_SHARE * 100}% the split can absorb and still be even in ` +
        `wall clock: ${guessed.join(", ")}. tools/ci/e2e-timings.mjs regenerates the file from a ` +
        `CI run's own reports, and says at the top where to get one.`
    );
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

  test("the suite fits the target within the shards a run may have", () => {
    const needed = shardsNeeded(specFilesIn(E2E_DIR), readTimings());

    assert.ok(needed <= MAX_SHARDS, `${needed} shards to meet the target, over the ${MAX_SHARDS} allowed`);
  });

  test("the shards and every job started beside them fit the measured concurrency cap", () => {
    const beside = ciJobs.filter((job) => !/^ {2}(scope|browser|browser-report):/.test(job) && !/^ {4}if: .*\bnative\b/m.test(job));

    assert.ok(beside.length >= 7, `found ${beside.length} jobs beside the shards; the split of ci.yml is wrong`);
    assert.ok(MAX_SHARDS + beside.length <= MAX_CONCURRENT_JOBS, `${MAX_SHARDS} shards and ${beside.length} other jobs exceed ${MAX_CONCURRENT_JOBS}`);
    const { run, peakConcurrentJobs } = readRunCosts();
    assert.ok(MAX_CONCURRENT_JOBS <= peakConcurrentJobs, `run ${run} ran at most ${peakConcurrentJobs} jobs at once, so ${MAX_CONCURRENT_JOBS} is unmeasured`);
  });

  test("no job beside the shards outlasted the target in the measured run", () => {
    const { run, otherJobsEndSeconds } = readRunCosts();
    const over = Object.entries(otherJobsEndSeconds).filter(([, end]) => end === null || end > TARGET_RUN_SECONDS);

    assert.deepEqual(over, [], `run ${run}: these ended past ${TARGET_RUN_SECONDS}s, or were still running when it was priced`);
  });

  test("the measured run priced every job ci.yml starts beside the shards", () => {
    const { run, otherJobsEndSeconds } = readRunCosts();
    const beside = ciJobs
      .filter((job) => !/^ {2}(scope|browser|browser-report):/.test(job) && !/^ {4}if: .*\bnative\b/m.test(job))
      .map((job) => /^ {4}name: (.*)$/m.exec(job)?.[1]);
    const unpriced = beside.filter((name) => !name || !(name in otherJobsEndSeconds));

    assert.deepEqual(unpriced, [], `run ${run} has no end for these jobs, so nothing holds them to the target`);
  });

  test("timings.json describes specs that exist", () => {
    const known = specFilesIn(E2E_DIR);
    const stale = Object.keys(readTimings()).filter((f) => !known.includes(f));

    assert.deepEqual(stale, [], "timings.json names specs that are gone");
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
      return plan([...paths, ...missing.map((m) => path.join(dir, m))], files);
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
    const { timings, shards } = planned({ committed: even, main: even, branch: { "heavy.spec.ts": 600 } });

    assert.equal(timings["heavy.spec.ts"], 600);
    assert.equal(timings["light0.spec.ts"], 100);
    assert.equal(shards.length, shardsNeeded(files, timings));
    const alone = assignShards(files, timings, shards.length).find((s) => s.files.includes("heavy.spec.ts"));
    assert.deepEqual(alone?.files, ["heavy.spec.ts"]);
  });

  test("with no branch run, main's numbers win over the committed ones", () => {
    const { timings } = planned({ committed: even, main: { ...even, "heavy.spec.ts": 300 } }, ["branch"]);

    assert.equal(timings["heavy.spec.ts"], 300);
  });

  test("the count is arithmetic on the numbers, not a constant", () => {
    const light = planned({ committed: even }).shards.length;
    const heavy = planned({ committed: Object.fromEntries(files.map((f) => [f, 250])) }).shards.length;

    assert.ok(heavy > light, `${light} shards for 900s of specs and ${heavy} for 2250s`);
    const guessed = planned({}).shards.length;
    assert.equal(guessed, shardsNeeded(files, {}), "nine unmeasured specs at the guess");
    assert.ok(guessed < light && light < heavy);
  });

  test("the count prices every measured cost, and refuses a record that leaves no time for specs", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `s${i}.spec.ts`);
    const even100 = Object.fromEntries(nine.map((f) => [f, 100]));
    const costs = { run: 1, aroundShardsSeconds: 40, shardOverheadSeconds: 50, shardNoise: 1.5, otherJobsEndSeconds: {} };

    assert.equal(shardsNeeded(nine, even100, costs), 7);
    assert.throws(() => shardsNeeded(nine, even100, { ...costs, aroundShardsSeconds: 252, shardOverheadSeconds: 48 }), /run 1 leaves no time/);
    assert.throws(() => shardsNeeded(nine, even100, { ...costs, shardNoise: 0 }), /run 1 leaves no time/);
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
