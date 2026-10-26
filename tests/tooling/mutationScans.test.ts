// stryker.config.mjs keeps scans out of the mutation run by a static list. Each entry must really
// scan, or a behaviour file's kills are thrown away; each scan must be listed, or it fails the
// dry run in a sandbox that is no checkout and whose source is instrumented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { blankComments } from "../helpers/sourceScan.ts";
import { EXTRA_TESTS, SCANS, TEST_DIRS, testFiles } from "../../stryker.config.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const CALLS_GIT = /\b(?:execFileSync|execSync|spawnSync|spawn|execFile)\(\s*["'`]git\b|\b(?:sourcesUnder|clientSources|componentSources)\b/;
const READS = /\b(?:readFileSync|readdirSync|readFile|readdir)\(/;
const SOURCE_PATH = /["'`](?:\.\.\/)*(?:lib|server|shared|context|app|components)(?:\/[^"'`]*)?["'`]/;
const IMPORT_SPECIFIER = /\b(?:from|import)\s*\(?\s*["'][^"']*["']/g;

function scans(source: string): boolean {
  const code = blankComments(source).replace(IMPORT_SPECIFIER, "");
  return CALLS_GIT.test(code) || (READS.test(code) && SOURCE_PATH.test(code));
}

const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

test("the detector tells a scan from a behaviour test", () => {
  const behaviour = [
    'import { readFileSync } from "node:fs";',
    'import { canPlay } from "../../lib/game/gameEngine.ts";',
    "// reads lib/game/gameEngine.ts? no: it plays a hand",
    'const save = readFileSync(new URL("../fixtures/offlineSave.json", import.meta.url), "utf8");',
    "test('a pair beats a pair', () => assert.ok(canPlay(save)));",
  ].join("\n");
  assert.equal(scans(behaviour), false);
  assert.equal(scans(`${behaviour}\nconst src = readFileSync(path.join(root, "server", "game", "x.ts"), "utf8");`), true);
  assert.equal(scans(`${behaviour}\nexecFileSync("git", ["ls-files"]);`), true);
  assert.equal(scans(`${behaviour}\nconst all = sourcesUnder(root, ["lib"]);`), true);
});

test("every file kept out of the mutation run scans", () => {
  assert.ok(SCANS.length >= 10, `only ${SCANS.length} scans listed`);
  for (const file of SCANS) {
    assert.ok(existsSync(path.join(repoRoot, file)), `${file} is listed but gone`);
    assert.ok(scans(read(file)), `${file} neither calls git nor reads a source path: it is a behaviour test, and belongs in the run`);
  }
});

test("every scan in the run's test directories is kept out", () => {
  const all = TEST_DIRS.flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir))
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => `${dir}/${name}`),
  );
  assert.ok(all.length >= 100, `found only ${all.length} test files under ${TEST_DIRS.join(", ")}`);
  assert.deepEqual(
    all.filter((file) => scans(read(file)) && !SCANS.includes(file)),
    [],
    "a scan in the run fails the dry run or kills a mutant by reading it",
  );
});

test("the run keeps every behaviour test and no scan", () => {
  assert.ok(testFiles.length >= 100, `the run holds only ${testFiles.length} test files`);
  assert.deepEqual(testFiles.filter((file) => SCANS.includes(file)), []);
  assert.ok(testFiles.includes("tests/engine/moves.test.ts"));
});

test("every extra test outside the run's directories exists and does not scan", () => {
  assert.ok(EXTRA_TESTS.length >= 1, "no extra test is listed");
  for (const file of EXTRA_TESTS) {
    assert.ok(existsSync(path.join(repoRoot, file)), `${file} is listed but gone`);
    assert.ok(!TEST_DIRS.some((dir) => file.startsWith(`${dir}/`)), `${file} is already under a directory the run reads`);
    assert.ok(!scans(read(file)), `${file} scans: its kills are false kills, and it belongs in neither list`);
    assert.ok(!SCANS.includes(file), `${file} is listed as both an extra test and a scan`);
    assert.ok(testFiles.includes(file), `${file} is listed but the run does not include it`);
  }
});

test("a scan planted in an extra test is caught", () => {
  const planted = `${read(EXTRA_TESTS[0])}\nconst src = readFileSync(path.join(root, "lib", "game", "scorePill.ts"), "utf8");`;
  assert.equal(scans(planted), true);
});

test("a file split into behaviour and scan keeps its behaviour in the run and its scan out", () => {
  const split = [
    "tests/bots/botFill", "tests/bots/botPersonalities", "tests/bots/botSearchTimeout", "tests/engine/deal",
    "tests/engine/matchState", "tests/engine/sharedGameFlow", "tests/server/dbTls", "tests/server/exchangeVisibility",
    "tests/server/logRedaction", "tests/server/seatAllocation", "tests/server/tableOwnership", "tests/server/testOnlyEnv",
  ];
  for (const name of split) {
    assert.ok(testFiles.includes(`${name}.test.ts`), `${name}.test.ts is a behaviour file: it belongs in the run`);
    assert.ok(SCANS.includes(`${name}Scan.test.ts`), `${name}Scan.test.ts holds the scan and must stay out of the run`);
    assert.ok(scans(read(`${name}Scan.test.ts`)), `${name}Scan.test.ts no longer scans`);
    assert.ok(!scans(read(`${name}.test.ts`)), `${name}.test.ts scans again`);
  }
});
