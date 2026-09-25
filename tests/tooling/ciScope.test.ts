import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STEPS } from "../../tools/loop/check-steps.mjs";

/**
 * The `scope` step decides which suites a change runs, so a path it wrongly
 * exempts is a suite that never sees the change that breaks it. The regexes
 * are read out of ci.yml and evaluated here, never restated.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");
const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const SOURCE = /\.(m?[jt]sx?|cjs)$/;

type Branch = { re: RegExp; value: boolean };

/** Each output's if/elif chain as the step writes it, for a change of one file. */
function scopeChains(workflow: string) {
  const step = /- id: scope\n[\s\S]*?(?=\n\n {2}\S)/.exec(workflow);
  assert.ok(step, "ci.yml has no `scope` step");
  const branch =
    /(?:if|elif) (?:\[ -n "\$changed" \] && )?(!? ?)grep -q(v?)E '([^']+)' <<< "\$changed"; then\n(?:(?!\s*(?:if|elif|else|fi)\b).*\n)*?\s*echo "(app|harness|scans)=(true|false)"/g;
  const chains: Record<string, { branches: Branch[]; otherwise?: boolean }> = {
    app: { branches: [] },
    harness: { branches: [] },
    scans: { branches: [] },
  };
  for (const [, not, invert, source, key, value] of step[0].matchAll(branch)) {
    assert.equal(Boolean(not.trim()), invert === "v", `unhandled grep form: ${source}`);
    chains[key].branches.push({ re: new RegExp(source), value: value === "true" });
  }
  for (const [, key, value] of step[0].matchAll(/\n\s*else\n\s*echo "(app|harness|scans)=(true|false)"/g)) {
    chains[key].otherwise = value === "true";
  }
  return chains;
}

function scopeOf(file: string, chain: { branches: Branch[]; otherwise?: boolean }) {
  assert.notEqual(chain.otherwise, undefined, "a chain with no else branch");
  return chain.branches.find((b) => b.re.test(file))?.value ?? chain.otherwise;
}

/** Every tracked `docs/**` file a test names in a string literal, or sits under a named directory. */
function docsTestsRead(): string[] {
  const named = new Set<string>();
  for (const file of tracked.filter((f) => f.startsWith("tests/") && SOURCE.test(f))) {
    const src = read(file);
    for (const m of src.matchAll(/["'](?:\.\.\/)*(docs\/[^"'\s]*?)\/?["']/g)) named.add(m[1]);
    for (const m of src.matchAll(/"docs"((?:,\s*"[^"]+")+)/g)) {
      named.add(["docs", ...[...m[1].matchAll(/"([^"]+)"/g)].map((s) => s[1])].join("/"));
    }
  }
  return tracked.filter(
    (f) => f.startsWith("docs/") && [...named].some((n) => f === n || f.startsWith(`${n}/`)),
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

const ROOT_LISTING =
  /\bls-files\b|\btracked(?:Root)?Files\(|\b(?:readdirSync|sourceFiles|walk)\(\s*(?:["']\.\/?["']|repoRoot|REPO_ROOT|ROOT|root|process\.cwd\(\))\s*[,)]/;

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

/** The CI jobs whose command's glob loads `file`, with the scope outputs that gate each. */
function jobsRunning(file: string, workflow: string): { job: string; gate: string[] }[] {
  const scripts = JSON.parse(read("package.json")).scripts;
  return STEPS.flatMap((s) => {
    const glob = /"([^"]+\*[^"]*)"\s*$/.exec(scripts[s.args.at(-1)!] ?? "")?.[1];
    if (!s.job || glob === undefined || !path.posix.matchesGlob(file, glob)) return [];
    const job = new RegExp(`\\n {2}${s.job}:\\n[\\s\\S]*?\\n {4}if: (.*)\\n`).exec(workflow);
    assert.ok(job, `ci.yml has no job ${s.job} with an if:`);
    return [{ job: s.job, gate: [...job[1].matchAll(/needs\.scope\.outputs\.(\w+) == 'true'/g)].map((m) => m[1]) }];
  });
}

describe("ci.yml's scope runs the suite that reads a change", () => {
  const chains = scopeChains(read(".github/workflows/ci.yml"));

  test("a doc a test reads runs the app suites", () => {
    const docs = docsTestsRead();
    assert.ok(docs.length >= 7, `only ${docs.length} docs found read by tests`);
    const skipped = docs.filter((f) => !scopeOf(f, chains.app));
    assert.deepEqual(skipped, [], "a change to only these skips the suite that reads them");
  });

  test("a file the loop imports runs the loop's suite", () => {
    const reached = reachedFromLoop();
    assert.ok(reached.length >= 3, `only ${reached.length} files found reached from tools/loop`);
    const skipped = reached.filter((f) => !scopeOf(f, chains.harness));
    assert.deepEqual(skipped, [], "a change to only these skips loop:test");
  });

  test("a test that lists the repository runs on a change to any tracked path", () => {
    const workflow = read(".github/workflows/ci.yml");
    const listers = testsListingTheRepo();
    for (const known of ["docReferences", "handBuiltNodeModulesPaths", "licence", "ciScope"]) {
      assert.ok(listers.includes(`tests/tooling/${known}.test.ts`), `${known} is not seen to list the repo`);
    }
    const skipped = listers.flatMap((lister) => {
      const jobs = jobsRunning(lister, workflow);
      if (jobs.length === 0) return [`${lister}: no CI job runs it`];
      const runs = (f: string) => jobs.some(({ gate }) => gate.some((key) => chains[key] && scopeOf(f, chains[key])));
      return tracked.filter((f) => !runs(f)).map((f) => `${f} skips ${lister}`);
    });
    assert.deepEqual(skipped.slice(0, 20), [], `${skipped.length} path/scan pairs skip the scan`);
  });

  test("a doc-only change skips the app suites and still runs the scans", () => {
    assert.equal(scopeOf("docs/research/a-note.md", chains.app), false);
    assert.equal(scopeOf("docs/research/a-note.md", chains.scans), true);
    assert.equal(scopeOf("app/index.tsx", chains.app), true);
    assert.equal(scopeOf("app/index.tsx", chains.harness), false);
  });
});
