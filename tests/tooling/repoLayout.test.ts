import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { trackedFiles } from "../helpers/trackedFiles.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function misplacedRules(files: string[]): string[] {
  return files.filter((f) => path.posix.basename(f) === "RULES.md" && !f.startsWith("docs/agents/"));
}

function looseTests(files: string[]): string[] {
  return files.filter((f) => /^tests\/[^/]+\.test\.tsx?$/.test(f));
}

const under = (p: string) => `tests/${p}`;
const NAMED_TEST = /(?<![\w/.-])tests\/[\w./-]+\.(?:test|spec)\.tsx?/g;

function danglingTestPaths(files: [string, string][], exists: (p: string) => boolean): string[] {
  return files.flatMap(([file, src]) =>
    [...src.matchAll(NAMED_TEST)].filter(([p]) => !exists(p)).map(([p]) => `${file} -> ${p}`),
  );
}

describe("the repository layout (#1131)", () => {
  const docs = trackedFiles(repoRoot, "docs");

  test("the only RULES.md under docs/ is the agents' one", () => {
    assert.ok(docs.includes("docs/agents/RULES.md"), "docs/agents/RULES.md is missing");
    assert.ok(docs.includes("docs/GAME-RULES.md"), "docs/GAME-RULES.md is missing");
    assert.deepEqual(misplacedRules(docs), []);
  });

  test("a RULES.md anywhere else under docs/ is caught", () => {
    assert.deepEqual(
      misplacedRules(["docs/agents/RULES.md", "docs/specs/RULES.md", "docs/design/RULES.md"]),
      ["docs/specs/RULES.md", "docs/design/RULES.md"],
    );
  });

  const tests = trackedFiles(repoRoot, "tests");

  test("every test file sits in a folder under tests/, none at its top", () => {
    assert.ok(tests.length > 200, `only ${tests.length} files tracked under tests/`);
    assert.deepEqual(looseTests(tests), []);
    assert.deepEqual(
      looseTests([under("x.test.ts"), under("y.test.tsx"), under("engine/deal.test.ts"), under("helpers.ts")]),
      [under("x.test.ts"), under("y.test.tsx")],
    );
  });

  test("every test path a file under tests/ names exists", () => {
    const sources = tests
      .filter((f) => /\.(tsx?|mjs|js)$/.test(f))
      .map((f): [string, string] => [f, readFileSync(path.join(repoRoot, f), "utf8")]);
    assert.ok(sources.some(([, src]) => src.match(NAMED_TEST) !== null), "the scan finds no test path to check");
    assert.deepEqual(danglingTestPaths(sources, (p) => existsSync(path.join(repoRoot, p))), []);
    assert.deepEqual(
      danglingTestPaths([["a.ts", `see ${under("engine/gone.test.ts")} and tools/loop/${under("x.test.ts")}`]], () => false),
      [`a.ts -> ${under("engine/gone.test.ts")}`],
    );
  });
});
