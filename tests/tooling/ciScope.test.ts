import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STEPS } from "../../tools/loop/check-steps.mjs";
import { parse } from "yaml";
import { JOBS, outputs, scopeOf } from "../../tools/ci/scope.mjs";
import { trackedFiles } from "../helpers/trackedFiles.ts";

/**
 * `scopeOf` decides which suites a change runs, so a path it wrongly exempts is a suite that never
 * sees the change that breaks it.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");
const tracked = trackedFiles(repoRoot);
const SOURCE = /\.(m?[jt]sx?|cjs)$/;

/** Every tracked `docs/**` file a test names in a string literal, or sits under a named directory. */
function docsTestsRead(): string[] {
  const named = new Set<string>();
  for (const file of tracked.filter((f) => f.startsWith("tests/") && SOURCE.test(f))) {
    const src = read(file);
    for (const m of src.matchAll(/["'](?:\.\.\/)*(docs\/[^"'\s]*?)\/?["']/g)) named.add(m[1]);
    for (const m of src.matchAll(/["'](?:\.\.\/)*([\w-]+\.md)["']/g)) named.add(m[1]);
    for (const m of src.matchAll(/"docs"((?:,\s*"[^"]+")+)/g)) {
      named.add(["docs", ...[...m[1].matchAll(/"([^"]+)"/g)].map((s) => s[1])].join("/"));
    }
  }
  return tracked.filter(
    (f) => (f.startsWith("docs/") || /^[\w-]+\.md$/.test(f)) && [...named].some((n) => f === n || f.startsWith(`${n}/`)),
  );
}

/** Every tracked file outside `tools/loop/` that `loop:test` loads, or a relative import from inside it reaches. */
function reachedFromLoop(): string[] {
  const seen = new Set<string>();
  const scripts = JSON.parse(read("package.json")).scripts;
  const commands = [scripts["preloop:test"], scripts["loop:test"]].join(" ");
  const loaded = [...commands.matchAll(/(?:\.\/)?([\w./-]+\.m?[jt]s)\b/g)].map((m) => m[1]);
  const queue = [
    ...tracked.filter((f) => f.startsWith("tools/loop/") && SOURCE.test(f)),
    ...loaded.filter((f) => tracked.includes(f)),
  ];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const specifiers = read(file).matchAll(
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g,
    );
    for (const [, spec] of specifiers) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      const target = [base, `${base}.ts`, `${base}.mjs`, base.replace(/\.js$/, ".ts")].find((c) =>
        tracked.includes(c),
      );
      assert.ok(target, `${file} imports ${spec}, which resolves to no tracked file`);
      queue.push(target);
    }
  }
  return [...seen].filter((f) => !f.startsWith("tools/loop/"));
}

/** `ls-files --others` lists only what git does not track, so `cli.mjs`'s `changedFiles` is not a lister. */
const ROOT_LISTING =
  /\bls-files\b(?!["'],\s*["']--others)|\btracked(?:Root)?Files\(|\b(?:readdirSync|sourceFiles|walk)\(\s*(?:["']\.\/?["']|repoRoot|REPO_ROOT|ROOT|root|process\.cwd\(\))\s*[,)]/;

/** Every test file that lists the repository from its root, in its own source or in a module it imports. */
function testsListingTheRepo(): string[] {
  return tracked
    .filter((f) => /\.(test|spec)\.m?[jt]sx?$/.test(f))
    .filter((file) => {
      const specs = [...read(file).matchAll(/(?:from\s+|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)];
      const imported = specs
        .map(([, spec]) => path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)))
        .filter((f) => tracked.includes(f));
      return [file, ...imported].some((f) => ROOT_LISTING.test(read(f)));
    });
}

/** The CI jobs whose command's glob loads `file`. */
function jobsRunning(file: string): string[] {
  const scripts = JSON.parse(read("package.json")).scripts;
  return STEPS.flatMap((s) => {
    const glob = /"([^"]+\*[^"]*)"\s*$/.exec(scripts[s.args.at(-1)!] ?? "")?.[1];
    return s.job && glob !== undefined && path.posix.matchesGlob(file, glob) ? [s.job] : [];
  });
}

/** Every way `workflow`'s job conditions part from JOBS: a job gated on scope reads its own key and nothing else. */
function conditionsOffJobs(workflow: string): string[] {
  const jobs = parse(workflow).jobs as Record<string, { needs?: string | string[]; if?: string }>;
  const own = (job: string) => `fromJSON(needs.scope.outputs.jobs)['${job}']`;
  return [
    ...Object.keys(JOBS).filter((job) => jobs[job]?.if !== own(job)).map((job) => `${job}: if: is ${JSON.stringify(jobs[job]?.if)}, not ${own(job)}`),
    ...Object.entries(jobs)
      .filter(([job, j]) => !(job in JOBS) && /needs\.scope\.outputs\.jobs/.test(j.if ?? ""))
      .map(([job]) => `${job} reads the scope's jobs, but JOBS has no ${job}`),
    ...Object.entries(jobs)
      .filter(([, j]) => /needs\.scope\.outputs\.(app|harness|scans)\b/.test(j.if ?? ""))
      .map(([job]) => `${job} reads a scope key, not its job's`),
  ];
}

type Key = "app" | "harness" | "scans";

/** The paths among `files` that, changed alone, would not run the suite behind `key`. */
const skips = (key: Key, files: string[]) => files.filter((f) => !scopeOf([f])[key]);

const PLANTED_DOC = path.posix.join("docs", "PLANTED-POLICY.md");
const PLANTED_IMPORT = path.posix.join("scripts", "planted-helper.mjs");

describe("scopeOf runs the suite that reads a change", () => {
  test("a doc a test reads runs the app suites", () => {
    const docs = docsTestsRead();
    assert.ok(docs.length >= 7, `only ${docs.length} docs found read by tests`);
    assert.deepEqual(skips("app", docs), [], "a change to only these skips the suite that reads them");
  });

  test("a doc a test reads that the allowlist misses is caught", () => {
    assert.deepEqual(skips("app", [...docsTestsRead(), PLANTED_DOC]), [PLANTED_DOC]);
  });

  test("a file the loop imports runs the loop's suite", () => {
    const reached = reachedFromLoop();
    assert.ok(reached.length >= 3, `only ${reached.length} files found reached from tools/loop`);
    assert.deepEqual(skips("harness", reached), [], "a change to only these skips loop:test");
  });

  test("a file the loop imports that the allowlist misses is caught", () => {
    assert.deepEqual(skips("harness", [...reachedFromLoop(), PLANTED_IMPORT]), [PLANTED_IMPORT]);
  });

  test("a test that lists the repository runs on a change to any tracked path", () => {
    const listers = testsListingTheRepo();
    for (const known of ["docReferences", "handBuiltNodeModulesPaths", "licence", "ciScope"]) {
      assert.ok(listers.includes(`tests/tooling/${known}.test.ts`), `${known} is not seen to list the repo`);
    }
    const skipped = listers.flatMap((lister) => {
      const jobs = jobsRunning(lister);
      if (jobs.length === 0) return [`${lister}: no CI job runs it`];
      const runs = (f: string) => jobs.some((job) => JOBS[job]?.(scopeOf([f])));
      return tracked.filter((f) => !runs(f)).map((f) => `${f} skips ${lister}`);
    });
    assert.deepEqual(skipped.slice(0, 20), [], `${skipped.length} path/scan pairs skip the scan`);
  });
});

describe("scopeOf, change by change", () => {
  const rows: [string, string[], { app: boolean; harness: boolean; scans: boolean }][] = [
    ["prose alone skips the app suites and still runs the scans", ["docs/research/a-note.md"], { app: false, harness: false, scans: true }],
    ["a nested README is prose", ["tests/e2e/57-polish-audit/README.md"], { app: false, harness: false, scans: true }],
    ["the root README is asserted on, by licence.test.ts", ["README.md"], { app: true, harness: false, scans: true }],
    ["docs TypeScript is in tsconfig.json", ["docs/research/a-note.ts"], { app: true, harness: false, scans: true }],
    ["docs TSX too", ["docs/research/a-note.tsx"], { app: true, harness: false, scans: true }],
    ["a doc the suite asserts on is not prose", ["docs/GAME-RULES.md"], { app: true, harness: false, scans: true }],
    ["the agent docs run both suites", ["docs/agents/RULES.md"], { app: true, harness: true, scans: true }],
    ["the root CLAUDE.md runs both suites", ["CLAUDE.md"], { app: true, harness: true, scans: true }],
    ["an area CLAUDE.md is read by the scans", ["components/CLAUDE.md"], { app: false, harness: false, scans: true }],
    ["a command file runs both suites", [".claude/commands/queue.md"], { app: true, harness: true, scans: true }],
    ["game code runs the app suites only", ["app/index.tsx"], { app: true, harness: false, scans: true }],
    ["the loop's tests alone skip the app suites", ["tools/loop/tests/x.test.ts"], { app: false, harness: true, scans: true }],
    ["the loop's source can reach the game", ["tools/loop/reap.mjs"], { app: true, harness: true, scans: true }],
    ["this workflow runs both suites", [".github/workflows/ci.yml"], { app: true, harness: true, scans: true }],
    ["the preload in every test file's process runs both suites", ["scripts/lib/blockingStdout.mjs"], { app: true, harness: true, scans: true }],
    ["a path no rule names runs the app suites", ["newdir/thing.xyz"], { app: true, harness: false, scans: true }],
    ["prose beside code is not prose alone", ["docs/research/a-note.md", "app/index.tsx"], { app: true, harness: false, scans: true }],
    ["prose beside the loop's tests is neither alone", ["README.md", "tools/loop/tests/x.test.ts"], { app: true, harness: true, scans: true }],
    ["no change runs the app suites and nothing that reads paths", [], { app: true, harness: false, scans: false }],
  ];
  for (const [name, changed, want] of rows) {
    test(name, () => assert.deepEqual(scopeOf(changed), want));
  }
});

test("ci.yml's scope step asks scope.mjs", () => {
  const step = /- id: scope\n[\s\S]*?(?=\n\n {2}\S|\n {6}- )/.exec(read(".github/workflows/ci.yml"));
  assert.ok(step, "ci.yml has no `scope` step");
  assert.match(step[0], /node tools\/ci\/scope\.mjs "\$base" \| tee -a "\$GITHUB_OUTPUT"/);
  assert.doesNotMatch(step[0], /grep/, "a second copy of the decision in bash");
  assert.doesNotMatch(step[0], />> "\$GITHUB_OUTPUT"/, "an output written by bash, not by scope.mjs");
});

describe("every job the scope gates reads its own key of JOBS", () => {
  const workflow = read(".github/workflows/ci.yml");

  test("ci.yml's conditions are JOBS's", () => assert.deepEqual(conditionsOffJobs(workflow), []));

  test("scope.mjs prints every JOBS key, in each of its three modes", () => {
    const keys = Object.keys(JOBS).sort();
    const jobs = (lines: string[]) => JSON.parse(lines.find((l) => l.startsWith("jobs="))!.slice("jobs=".length));
    assert.deepEqual(outputs("--none").at(1), "native=false");
    assert.ok(Object.values(jobs(outputs("--none"))).every((v) => v === false));
    assert.ok(Object.values(jobs(outputs(undefined))).every((v) => v === true));
    for (const mode of [outputs("--none"), outputs(undefined), outputs("HEAD")]) assert.deepEqual(Object.keys(jobs(mode)).sort(), keys);
  });

  const plants: [string, (w: string) => string, RegExp][] = [
    ["verify gated on the app alone", (w) => w.replace("fromJSON(needs.scope.outputs.jobs)['verify']", "needs.scope.outputs.app == 'true'"), /^verify: if: is "needs\.scope\.outputs\.app == 'true'"/],
    ["browser reading lint's key", (w) => w.replace("fromJSON(needs.scope.outputs.jobs)['browser']", "fromJSON(needs.scope.outputs.jobs)['lint']"), /^browser: if: is/],
    ["build always running", (w) => w.replace("fromJSON(needs.scope.outputs.jobs)['build']", "always()"), /^build: if: is "always\(\)"/],
    ["a job JOBS does not hold", (w) => w.replace("needs: [native, browser]\n    if: ${{ !cancelled() && github.event_name == 'pull_request' }}", "needs: [native, browser]\n    if: fromJSON(needs.scope.outputs.jobs)['timing-budget']"), /timing-budget reads the scope's jobs, but JOBS has no timing-budget/],
  ];
  for (const [name, mutate, want] of plants) {
    test(`planted: ${name} is caught`, () => {
      const planted = mutate(workflow);
      assert.notEqual(planted, workflow, "the plant changed nothing");
      assert.ok(conditionsOffJobs(planted).some((p) => want.test(p)), conditionsOffJobs(planted).join("\n"));
    });
  }
});
