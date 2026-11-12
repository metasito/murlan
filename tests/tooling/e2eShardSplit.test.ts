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
  fitProblems,
  guessProblems,
  judgedPrices,
  MAX_CONCURRENT_JOBS,
  MAX_SHARDS,
  plan,
  readTimings,
  shardsNeeded,
  specFilesIn,
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
// Four specs a shard: as even as a split gets, so a fixture reds only on what it changes.
const SUITE = Array.from({ length: MAX_SHARDS * 4 }, (_, i) => `s${i}.spec.ts`);
const at = (seconds: number, suite = SUITE) => Object.fromEntries(suite.map((f) => [f, seconds]));
const fits = (seconds: number) => shardsNeeded(SUITE, at(seconds)) <= MAX_SHARDS;
/** The most a spec of `SUITE` may cost with the suite still inside the target. */
const MOST = Array.from({ length: 400 }, (_, s) => s).filter(fits).at(-1) ?? 0;

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

    assert.match(step, /node tools\/ci\/e2e-shard\.mjs judge tests\/e2e\/timings\.json \|\| ! node --test tests\/tooling\/e2eShardSplit\.test\.ts; then\n\s+echo[^\n]*\n\s+exit 1\n[\s\S]*git commit /);
  });

  test("the weekly timings commit installs the packages this file imports, under the commit's own gate", () => {
    const steps = loadWorkflow("ci.yml").jobs["browser-report"].steps ?? [];
    const commit = steps.findIndex((s) => s.name === "Commit the regenerated timings, if main's copy is stale");
    const install = steps.findIndex((s) => s.uses === "./.github/actions/install");
    assert.ok(commit > 0, "browser-report has no timings commit step");
    assert.ok(install >= 0 && install < commit, "the commit runs this file, which imports `yaml`, with no node_modules");
    assert.equal(steps[install].id, "install");
    assert.equal(steps[commit].if, "${{ !cancelled() && steps.install.outcome == 'success' }}", "the commit would run its gate with no node_modules");
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

  test("every run's split is judged on this run's measurements, and fails the run without stopping its suite", () => {
    const report = loadWorkflow("ci.yml").jobs["browser-report"];
    const steps = report.steps ?? [];
    const checkAt = steps.findIndex((s) => s.name === "The split was measured, even and within the target");
    const check = steps[checkAt];
    const run = check?.run ?? "";

    assert.ok(check, "browser-report no longer fails a run whose split was guessed, uneven or over the target");
    assert.match(run, /node tools\/ci\/e2e-shard\.mjs check "\$PROBLEMS" "\$RUNNER_TEMP\/stable\.json" tests\/e2e\/timings\.json "\$BASE" "\$changed"\n?$/);
    assert.match(run, /^printf '%s' "\$STABLE" > "\$RUNNER_TEMP\/stable\.json"\n/);
    assert.match(run, /git fetch -q --no-tags --depth=1 origin "\$BASE" && git cat-file -e "\$BASE\^\{commit\}" \\\n\s+&& names=\$\(git diff --name-only "\$BASE" HEAD -- tests\/e2e\); then\n\s+changed=\$\(paste -sd, - <<< "\$names"\)\n\s+else\n\s+changed='\?'\n/);
    assert.deepEqual(check.env, {
      PROBLEMS: "${{ needs.scope.outputs.split-problems }}",
      STABLE: "${{ needs.scope.outputs.stable }}",
      BASE: "${{ github.event.pull_request.base.sha }}",
    });
    assert.equal(check.if, "${{ !cancelled() && steps.regen.outcome == 'success' && needs.browser.result == 'success' }}", "a red run's durations are not a measurement");
    assert.equal(check["continue-on-error"], undefined);
    assert.equal(report.if, "${{ !cancelled() && needs.browser.result != 'skipped' }}");
    assert.equal((report as Record<string, unknown>)["continue-on-error"], undefined);
    assert.match(ciYml, /split-problems: \$\{\{ steps\.plan\.outputs\.split-problems \}\}/);
    assert.match(ciYml, /stable: \$\{\{ steps\.plan\.outputs\.stable \}\}/);
    assert.match(ciYml, /node tools\/ci\/e2e-shard\.mjs plan "\$\{layers\[0\]\}" "\$\{layers\[1\]\}"\n/);
    assert.ok(checkAt > steps.findIndex((s) => s.id === "regen"), "the check would read the plan's prices, not this run's");
    const uploads = steps.flatMap((s, i) => ((s.with as { name?: string } | undefined)?.name === "e2e-timings" ? [i] : []));
    const install = steps.findIndex((s) => s.id === "install");
    const commit = steps.findIndex((s) => s.name === "Commit the regenerated timings, if main's copy is stale");
    assert.ok(uploads.length === 2 && install >= 0 && commit > install, "the timings uploads or the weekly commit moved");
    assert.ok(checkAt > Math.max(...uploads), "a red split would stop this run's timings from reaching the next run");
    assert.ok(checkAt < install, "the weekly commit can reset to a newer main before the check reads this run's split");
    assert.equal(steps[install].if, "${{ !cancelled() && steps.regen.outcome == 'success' && env.COMMIT_TIMINGS == 'true' }}", "a red split would keep the prices that made it");
    assert.equal(steps.find((s) => s.id === "regen")?.name, "Regenerate tests/e2e/timings.json");
  });

  test("the plan pages past other branches' artifacts to main's runs and this branch's latest", () => {
    const run = loadWorkflow("ci.yml").jobs.scope.steps?.find((s) => s.id === "plan")?.run ?? "";

    assert.match(run, /for page in \$\(seq 1 50\); do\n/);
    assert.match(run, /actions\/artifacts\?name=e2e-timings&per_page=100&page=\$page"\); then\n\s+echo "::warning::/);
    assert.match(run, /\[ "\$\(jq '\.artifacts \| length' <<< "\$got"\)" -lt 100 \] && break\n/);
    assert.match(run, /ours='\[\.artifacts\[\] \| select\(\(\.expired \| not\) and \.workflow_run\.head_repository_id == \.workflow_run\.repository_id\)\]'/);
    assert.match(run, /artifacts=\$\(jq -s --arg b "\$BRANCH" "\{artifacts: \(\.\[0\]\.artifacts \+ \(\.\[1\] \| \$ours\n\s+\| map\(select\(\.workflow_run\.head_branch == \\"main\\" or \.workflow_run\.head_branch == \\\$b\)\)\)\)\}" <\(echo "\$artifacts"\) <\(echo "\$got"\)\)\n/);
    assert.match(run, /\[ "\$\(jq '\.artifacts \| map\(select\(\.workflow_run\.head_branch == "main"\)\) \| length' <<< "\$artifacts"\)" -ge "\$RUNS" \]/);
    assert.match(run, /\[ "\$BRANCH" = main \] \|\| \[ "\$FORK" = true \] \\\n\s+\|\| \[ "\$\(jq --arg b "\$BRANCH" '\.artifacts \| map\(select\(\.workflow_run\.head_branch == \$b\)\) \| length' <<< "\$artifacts"\)" -gt 0 \] \\\n/);
    assert.match(run, /\|\| jq -e --arg t "\$OPENED" '\$t != "" and \.artifacts\[-1\]\.created_at < \$t' <<< "\$got" > \/dev\/null; \}/);
    assert.match(run, /if \[ "\$BRANCH" != main \] && \[ "\$FORK" != true \]; then branches\+=\("\$BRANCH"\); fi/);
    const env = loadWorkflow("ci.yml").jobs.scope.steps?.find((s) => s.id === "plan")?.env;
    assert.equal(env?.FORK, "${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository }}");
    assert.equal(env?.OPENED, "${{ github.event.pull_request.created_at }}");
  });

  test("the target is the owner's five minutes, as rule 46 states it", () => {
    const rules = readFileSync(path.join(repoRoot, "docs", "agents", "RULES.md"), "utf8");
    const rule = /^46\. \*\*The whole CI run stays under 5 minutes[^\n]*`TARGET_RUN_SECONDS`[^\n]* is (\d+)\.\*\*/m.exec(rules);

    assert.ok(rule, "docs/agents/RULES.md no longer carries rule 46, the owner's CI target");
    assert.equal(Number(rule[1]), 300, "rule 46 names a target other than the owner's 300 s");
    assert.equal(TARGET_RUN_SECONDS, 300, "TARGET_RUN_SECONDS moved off rule 46's 300 s; only the owner changes it");
  });

  test("a suite past the target within the shards a run may have is a problem of the split", () => {
    assert.ok(MOST > 0 && !fits(400), "the fixture never crosses the target");
    assert.deepEqual(fitProblems(SUITE, at(MOST)), []);
    assert.match(fitProblems(SUITE, at(MOST + 1)).join(), new RegExp(`over the ${MAX_SHARDS} allowed`));
  });

  test("a spec over a shard's fair share is a problem, named", () => {
    const big = { ...at(10), "big.spec.ts": 100 };
    const problems = fitProblems([...SUITE, "big.spec.ts"], big);

    assert.match(problems.join("\n"), /each of \d+ shards gets; split them: big\.spec\.ts 100s$/m);
  });

  test("shards a third again heavier than the lightest are a problem, with no spec over its share", () => {
    const suite = SUITE.slice(0, MAX_SHARDS + 1);
    const problems = fitProblems(suite, at(10));

    assert.deepEqual(problems, ["shards range 10s to 20s, more than a third again of the lightest"]);
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
      return plan([...paths, ...missing.map((m) => path.join(dir, m))], Math.min(2, paths.length + missing.length));
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
    const fresh = Array.from({ length: 11 }, (_, i) => `new${i}.spec.ts`);
    const suite = [...SUITE, ...fresh];
    const { timings } = planned({ committed: at(10), main: [at(10, suite)] });

    assert.match(guessProblems(suite, at(10)).join(), /11 of 79 specs were priced at the/);
    assert.deepEqual(guessProblems(suite, timings), []);
  });

  test("a pull request bringing more unmeasured specs than the split absorbs is named, spec by spec", () => {
    const mine = Array.from({ length: 8 }, (_, i) => `mine${i}.spec.ts`);
    const { timings } = planned({ committed: at(10), main: [at(10)] });
    const [problem] = guessProblems([...SUITE, ...mine], timings);

    assert.match(problem ?? "", new RegExp(`8 of 76 specs .*: ${mine.join(", ").replaceAll(".", "\\.")}\\.`));
    assert.deepEqual(guessProblems([...SUITE, ...mine.slice(1)], timings), []);
  });

  test("main's prices are the committed file under main's medians, never the branch's run", () => {
    const { stable, timings } = planned({ committed: { ...at(10), "old.spec.ts": 5 }, main: [at(20)], branch: { "s0.spec.ts": 300 } });

    assert.equal(timings["s0.spec.ts"], 300);
    assert.equal(stable["s0.spec.ts"], 20);
    assert.equal(stable["old.spec.ts"], 5);
  });

  test("a run slower than main's, on specs the pull request left alone, reds nothing", () => {
    const slow = Object.fromEntries(SUITE.map((f, i) => [f, Math.round(MOST * (i % 2 ? 1.1 : 1.2))]));

    assert.ok(shardsNeeded(SUITE, slow) > MAX_SHARDS, "the run is not slow enough to miss the target");
    assert.deepEqual(fitProblems(SUITE, judgedPrices(at(MOST), slow, [])), []);
  });

  test("a first run with a new 200 s spec, and no run of the branch before it, reds", () => {
    // A share above the guess, so only the spec's measured price can red it.
    const { stable, timings } = planned({ committed: at(30), main: [at(30)] }, ["branch"]);
    const measured = { ...timings, "new.spec.ts": 200 };

    assert.deepEqual(fitProblems([...SUITE, "new.spec.ts"], stable), []);
    assert.match(fitProblems([...SUITE, "new.spec.ts"], judgedPrices(stable, measured, [])).join("\n"), /split them: new\.spec\.ts 200s/);
    assert.match(fitProblems([...SUITE, "new.spec.ts"], judgedPrices(stable, measured, ["new.spec.ts"])).join("\n"), /split them: new\.spec\.ts 200s/);
  });

  test("a push that makes a changed spec heavy reds, though the push before it measured it light", () => {
    const pushA = planned({ committed: at(10), main: [at(10)] }, ["branch"]);
    const measuredA = { ...at(10), "s0.spec.ts": 12 };
    assert.deepEqual(fitProblems(SUITE, judgedPrices(pushA.stable, measuredA, ["s0.spec.ts"])), []);

    const pushB = planned({ committed: at(10), main: [at(10)], branch: measuredA });
    const judged = judgedPrices(pushB.stable, { ...at(11), "s0.spec.ts": 200 }, ["s0.spec.ts"]);
    assert.equal(judged["s0.spec.ts"], 200);
    assert.equal(judged["s1.spec.ts"], 10);
    assert.match(fitProblems(SUITE, judged).join("\n"), /split them: s0\.spec\.ts 200s/);
  });

  test("a run's own prices for specs the pull request left alone are never what it is judged on", () => {
    const committed = { ...at(10), "s0.spec.ts": 40 };
    const judged = judgedPrices(committed, { ...at(400), "new.spec.ts": 70 }, []);

    assert.deepEqual(judged, { ...committed, "new.spec.ts": 70 });
  });

  test("a problem main's prices already have is main's to report, while one the pull request adds still reds it", () => {
    const lopsided = { ...at(MOST), "s0.spec.ts": 500 };
    assert.match(fitProblems(SUITE, lopsided).join("\n"), /split them: s0\.spec\.ts 500s/);
    assert.deepEqual(fitProblems(SUITE, lopsided, lopsided), []);
    assert.deepEqual(fitProblems(SUITE, at(MOST + 20), at(MOST + 20)), []);

    const worse = fitProblems(SUITE, { ...lopsided, "s1.spec.ts": 500 }, lopsided).join("\n");
    assert.match(worse, /split them: s1\.spec\.ts 500s/);
    assert.doesNotMatch(worse, /s0\.spec\.ts/);
    assert.match(fitProblems(SUITE, { ...at(10), "s0.spec.ts": 60 }, at(10)).join("\n"), /shards range \d+s to \d+s/);
  });

  test("a pull request that makes a main already over the target worse reds; one that leaves it so does not", () => {
    const needing = (n: number) => at(Array.from({ length: 2000 }, (_, s) => s).find((s) => shardsNeeded(SUITE, at(s)) === n) ?? NaN);

    assert.match(fitProblems(SUITE, needing(22), needing(18)).join("\n"), /^22 shards to meet/m);
    assert.deepEqual(fitProblems(SUITE, needing(18), needing(18)), []);
    assert.match(fitProblems(SUITE, { ...at(10), "s0.spec.ts": 90 }, { ...at(10), "s0.spec.ts": 60 }).join("\n"), /shards range \d+s to \d+s/);
  });

  test("a fork's guessed split is not told to re-run, which reads no more of its timings", () => {
    const mine = Array.from({ length: 8 }, (_, i) => `mine${i}.spec.ts`);
    const fork = guessProblems([...SUITE, ...mine], at(10), true).join("\n");

    assert.match(fork, /8 of 76 specs/);
    assert.doesNotMatch(fork, /[Rr]e-run|push again/);
    assert.match(guessProblems([...SUITE, ...mine], at(10)).join("\n"), /Re-run all jobs/);
  });

  test("fewer specs than shards leave shards empty, which is not called uneven or over a share", () => {
    assert.deepEqual(fitProblems(SUITE.slice(0, MAX_SHARDS - 1), at(10)), []);
  });

  test("a split of no spec at all is a problem, not a pass", () => {
    assert.equal(fitProblems([], even).length, 1);
  });

  const shardCli = (...args: string[]) => {
    try {
      return { status: 0, out: execFileSync(process.execPath, [path.join(repoRoot, "tools", "ci", "e2e-shard.mjs"), ...args], { encoding: "utf8", stdio: "pipe", env: { ...process.env, GITHUB_OUTPUT: "" } }) };
    } catch (err) {
      return { status: (err as { status: number }).status, out: String((err as { stdout: unknown }).stdout) };
    }
  };

  test("the check exits red on a problem and green on none, refuses to run on less, and reds an unread base", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-check-"));
    try {
      // A spec merged since the weekly commit is priced at a second, so a stale file cannot red this.
      const prices = path.join(dir, "t.json");
      writeFileSync(prices, JSON.stringify({ ...at(1, specFilesIn(E2E_DIR)), ...readTimings() }));
      const check = (...args: string[]) => shardCli("check", ...args);
      assert.equal(check('["the split was guessed"]', prices, prices, "", "").status, 1);
      assert.equal(check("[]", prices, prices, "", "").status, 0);
      assert.equal(check("[]", prices, prices, "base", `tests/e2e/${specFilesIn(E2E_DIR)[0]},app/x.ts`).status, 0);
      const unread = check("[]", prices, prices, "base", "?");
      assert.equal(unread.status, 1);
      assert.match(unread.out, /^::error::the pull request's base could not be read/m);
      assert.notEqual(check().status, 0);
      assert.notEqual(check("[]", prices, prices, "").status, 0);
      assert.notEqual(check("{}", prices, prices, "", "").status, 0);

      const over = path.join(dir, "over.json");
      writeFileSync(over, JSON.stringify(at(400, specFilesIn(E2E_DIR))));
      const onMain = check("[]", over, over, "", "");
      assert.equal(onMain.status, 1, "main's own runs never judge main's split");
      assert.match(onMain.out, /^::error::\d+ shards to meet/m);
      assert.equal(check("[]", over, over, "base", "").status, 0, "a pull request is held to a main it did not break");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the plan reports how much of the split it guessed, and hands on main's prices", () => {
    const committed = path.join(E2E_DIR, "timings.json");
    const out = shardCli("plan", committed, "").out;
    const { timings, stable } = plan([committed, [committed], []], 2);

    assert.equal(/^split-problems=(.*)$/m.exec(out)?.[1], JSON.stringify(guessProblems(specFilesIn(E2E_DIR), timings)));
    assert.equal(/^stable=(.*)$/m.exec(out)?.[1], JSON.stringify(stable));
  });

  test("a plan with no main run to read says so, and how to get one, rather than splitting on the committed file unremarked", () => {
    const problems = JSON.parse(/^split-problems=(.*)$/m.exec(shardCli("plan", "", "").out)?.[1] ?? "null");

    assert.match(problems.join(), /no run of main's e2e-timings could be read.*once the API answers again use "Re-run all jobs"/);
  });

  test("the weekly commit's judge reds a timings file that splits badly, and needs one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-judge-"));
    try {
      const write = (timings: Record<string, number>) => {
        writeFileSync(path.join(dir, "t.json"), JSON.stringify(timings));
        return path.join(dir, "t.json");
      };
      // A spec merged since the weekly commit is priced at a second, so a stale file cannot red this.
      const measured = { ...at(1, specFilesIn(E2E_DIR)), ...readTimings() };
      assert.equal(shardCli("judge", write(measured)).status, 0);
      const lopsided = shardCli("judge", write({ ...measured, [specFilesIn(E2E_DIR)[0]]: 500 }));
      assert.equal(lopsided.status, 1);
      assert.match(lopsided.out, /^::error::over the \d+s each of \d+ shards gets; split them: /m);
      assert.equal(shardCli("judge", write({})).status, 1);
      assert.notEqual(shardCli("judge").status, 0);
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
