import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    /(?:if|elif) (?:\[ -n "\$changed" \] && )?(!? ?)grep -q(v?)E '([^']+)' <<< "\$changed"; then\n(?:(?!\s*(?:if|elif|else|fi)\b).*\n)*?\s*echo "(app|harness)=(true|false)"/g;
  const chains: Record<string, { branches: Branch[]; otherwise?: boolean }> = {
    app: { branches: [] },
    harness: { branches: [] },
  };
  for (const [, not, invert, source, key, value] of step[0].matchAll(branch)) {
    assert.equal(Boolean(not.trim()), invert === "v", `unhandled grep form: ${source}`);
    chains[key].branches.push({ re: new RegExp(source), value: value === "true" });
  }
  for (const [, key, value] of step[0].matchAll(/\n\s*else\n\s*echo "(app|harness)=(true|false)"/g)) {
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

/** Every tracked file outside `tools/loop/` a relative import from inside it reaches. */
function reachedFromLoop(): string[] {
  const seen = new Set<string>();
  const queue = tracked.filter((f) => f.startsWith("tools/loop/") && SOURCE.test(f));
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

  test("prose nothing reads still skips the app suites", () => {
    assert.equal(scopeOf("docs/design/unread-note.md", chains.app), false);
    assert.equal(scopeOf("app/index.tsx", chains.app), true);
    assert.equal(scopeOf("app/index.tsx", chains.harness), false);
  });
});
