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
const inServer = (p: string) => `server/${p}`;
const NAMED_TEST = /(?<![\w/.-])tests\/[\w./-]+\.(?:test|spec)\.tsx?/g;

const SHORTHAND = /(?<![\w/.-])tests\/[A-Za-z][\w-]*(?![\w/-]|\.\w)/g;

function shorthandNotAFolder(files: [string, string][], folders: string[]): string[] {
  return files.flatMap(([file, src]) =>
    [...src.matchAll(SHORTHAND)].filter(([p]) => !folders.includes(p)).map(([p]) => `${file} -> ${p}`),
  );
}

function danglingTestPaths(files: [string, string][], exists: (p: string) => boolean): string[] {
  return files.flatMap(([file, src]) =>
    [...src.matchAll(NAMED_TEST)].filter(([p]) => !exists(p)).map(([p]) => `${file} -> ${p}`),
  );
}

const SERVER_ROOT_FILES = ["server/index.ts", "server/app.ts"];
const NAMED_SERVER_FILE = /(?<![\w/.-])server\/[\w./-]+\.(?:ts|html)\b/g;

function looseServerFiles(files: string[]): string[] {
  return files.filter((f) => /^server\/[^/]+$/.test(f) && !SERVER_ROOT_FILES.includes(f));
}

function danglingServerPaths(files: [string, string][], exists: (p: string) => boolean): string[] {
  return files.flatMap(([file, src]) =>
    [...src.matchAll(NAMED_SERVER_FILE)].filter(([p]) => !exists(p)).map(([p]) => `${file} -> ${p}`),
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

  test("a bare tests/<name> pointer names a folder, never a test that moved into one", () => {
    const folders = [...new Set(tests.map((f) => f.split("/").slice(0, 2).join("/")))].filter((p) => !p.includes("."));
    const sources = trackedFiles(repoRoot, ".", ":!docs/plans", ":!docs/research", ":!docs/specs", ":!docs/design")
      .filter((f) => /\.(tsx?|mjs|cjs|js|md|ya?ml|json)$/.test(f))
      .map((f): [string, string] => [f, readFileSync(path.join(repoRoot, f), "utf8")]);
    assert.ok(folders.includes(under("engine")) && folders.includes(under("native")), `folders: ${folders}`);
    assert.ok(sources.some(([, src]) => src.match(SHORTHAND) !== null), "the scan finds no shorthand to check");
    assert.deepEqual(shorthandNotAFolder(sources, folders), []);
    assert.deepEqual(
      shorthandNotAFolder(
        [["a.ts", `see ${under("hooksLint")}, ${under("native")}/x, ${under("engine")}. Or ${under("spacingLint")}.`]],
        [under("engine")],
      ),
      [`a.ts -> ${under("hooksLint")}`, `a.ts -> ${under("spacingLint")}`],
    );
  });

  const server = trackedFiles(repoRoot, "server");

  test("only index.ts and app.ts sit at the top of server/; everything else is in a folder", () => {
    for (const f of SERVER_ROOT_FILES) assert.ok(server.includes(f), `${f} is missing`);
    assert.ok(server.length > 60, `only ${server.length} files tracked under server/`);
    assert.deepEqual(looseServerFiles(server), []);
    assert.deepEqual(
      looseServerFiles(["server/index.ts", "server/app.ts", inServer("stray.ts"), "server/game/gameRoom.ts", "server/notes.md"]),
      [inServer("stray.ts"), "server/notes.md"],
    );
  });

  test("every server/ file path named in code exists", () => {
    const sources = trackedFiles(repoRoot, ".")
      .filter((f) => /\.(tsx?|mjs|cjs|js|json|ya?ml)$/.test(f))
      .map((f): [string, string] => [f, readFileSync(path.join(repoRoot, f), "utf8")]);
    assert.ok(
      sources.some(([, src]) => [...src.matchAll(NAMED_SERVER_FILE)].some(([p]) => p.startsWith("server/game/"))),
      "the scan finds no server path to check",
    );
    assert.deepEqual(danglingServerPaths(sources, (p) => existsSync(path.join(repoRoot, p))), []);
    assert.deepEqual(
      danglingServerPaths([["a.ts", `see ${inServer("gameRoom.ts")}, ../${inServer("x.ts")} and tests/${inServer("y.ts")}`]], () => false),
      [`a.ts -> ${inServer("gameRoom.ts")}`],
    );
  });
});
