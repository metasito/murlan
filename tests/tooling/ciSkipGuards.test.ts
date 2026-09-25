import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unloaded } from "../helpers/filesRunReporter.mjs";

/**
 * A suite that skips still exits 0, so ci.yml reads the test log for the
 * messages a skip prints and fails the job on them. Each of those is a string
 * literal in one file matched by a string literal in another: reword one side
 * and CI goes on passing while it stops catching anything.
 *
 * Nothing here may name a phrase in a test title or print one — they are read
 * out of the workflow at run time for exactly that reason. A title reaches the
 * same log the grep reads, and the guard fires on itself.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readRepoFile = (...parts: string[]) =>
  readFileSync(path.join(repoRoot, ...parts), "utf8");

/** The files allowed to contain a phrase, because they are the ones printing it. */
const OWNERS = ["tests/helpers/testServer.ts", "tests/server/backupDb.test.ts"];

/** Every alternative inside the `grep -q…"…"` calls of the assert step. */
function grepPhrases(workflow: string): string[] {
  const step = /Assert the integration suites actually ran[\s\S]*?(?=\n  [a-z])/.exec(workflow);
  assert.ok(step, "ci.yml no longer has the step that fails on a silent skip");
  return [...step[0].matchAll(/grep -q[a-zA-Z]* "([^"]+)"/g)]
    .flatMap((m) => m[1].split("|"))
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "e2e" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("what CI greps for is what the suites actually print", () => {
  const phrases = grepPhrases(readRepoFile(".github", "workflows", "ci.yml"));

  test("the step greps for something", () => {
    assert.ok(phrases.length >= 4, `the assert step greps for ${phrases.length} phrases`);
  });

  test("each phrase is still printed by the suite that owns it", () => {
    const owned = OWNERS.map((f) => readRepoFile(...f.split("/")));
    const orphans = phrases.filter((phrase) => !owned.some((src) => src.includes(phrase)));

    assert.deepEqual(orphans, [], "nothing prints these, so CI's grep can never fire");
  });

  test("no other file can put one in the log and trip the grep by accident", () => {
    // A test *title* containing a phrase lands in the same output the workflow
    // greps, which fails the job on a suite that ran perfectly.
    const owners = OWNERS.map((f) => path.join(repoRoot, ...f.split("/")));
    const strays = sourceFiles(path.join(repoRoot, "tests"))
      .filter((file) => !owners.includes(file))
      .filter((file) => {
        const src = readFileSync(file, "utf8");
        return phrases.some((phrase) => src.includes(phrase));
      })
      .map((file) => path.relative(repoRoot, file));

    assert.deepEqual(strays, [], "these name a phrase ci.yml greps for");
  });
});

describe("the integration guard counts the files that ran, not only the skips", () => {
  const workflow = readRepoFile(".github", "workflows", "ci.yml");
  const step = /Assert the integration suites actually ran[\s\S]*?(?=\n  [a-z])/.exec(workflow)?.[0] ?? "";

  test("npm test's own flags put the per-directory count in the log the step reads", () => {
    const script = JSON.parse(readRepoFile("package.json")).scripts.test as string;
    const args = script.split(" ").slice(1, -1);
    assert.ok(args.includes("--test-reporter=./tests/helpers/filesRunReporter.mjs"));
    assert.match(workflow, /npm test 2>&1 \| tee test-output\.txt/);

    const dir = mkdtempSync(path.join(tmpdir(), "files-run-"));
    try {
      writeFileSync(path.join(dir, "one.test.mjs"), 'import test from "node:test";\ntest("x", () => {});\n');
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const run = spawnSync(process.execPath, [...args, path.join(dir, "one.test.mjs")], { cwd: repoRoot, env, encoding: "utf8" });
      assert.match(run.stdout + run.stderr, /^test files run in .+: 1$/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a file whose tests all skipped, or that declares none, is not counted as run", () => {
    const script = JSON.parse(readRepoFile("package.json")).scripts.test as string;
    const reporter = script.split(" ").filter((a) => a.startsWith("--test-reporter")).slice(-2);
    const dir = mkdtempSync(path.join(tmpdir(), "files-run-"));
    try {
      const files = {
        "real.test.mjs": 'import test from "node:test";\ntest("x", () => {});\ntest("y", { skip: true }, () => {});\n',
        "suite.test.mjs": 'import { describe, it } from "node:test";\ndescribe.skip("s", () => { it("x", () => {}); });\n',
        "option.test.mjs": 'import test from "node:test";\ntest("x", { skip: "no database" }, () => {});\n',
        "todo.test.mjs": 'import test from "node:test";\ntest.todo("x");\n',
        "empty.test.mjs": "// nothing here\n",
      };
      for (const [name, src] of Object.entries(files)) writeFileSync(path.join(dir, name), src);
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const run = spawnSync(process.execPath, ["--test", ...reporter, ...Object.keys(files).map((f) => path.join(dir, f))], {
        cwd: repoRoot,
        env,
        encoding: "utf8",
      });
      assert.match(run.stderr, /^test files run in .+: 1$/m, run.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a test file the run never loaded fails it by name", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "files-run-"));
    try {
      mkdirSync(path.join(dir, "tests", "engine"), { recursive: true });
      mkdirSync(path.join(dir, "tools", "loop", "tests"), { recursive: true });
      for (const f of [
        ["tests", "a.test.ts"],
        ["tests", "engine", "b.test.ts"],
        ["tests", "engine", "c.test.tsx"],
        ["tools", "loop", "tests", "d.test.ts"],
      ]) {
        writeFileSync(path.join(dir, ...f), "");
      }
      assert.deepEqual(unloaded([path.join(dir, "tests", "a.test.ts")], dir), [["tests", "engine", "b.test.ts"].join("/")]);
      assert.deepEqual(unloaded([path.join(dir, "tools", "loop", "tests", "d.test.ts")], dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the step compares that count with the integration files on disk, under a floor", () => {
    const printed = /yield `([^$`]+)\$\{dir\}: /.exec(readRepoFile("tests", "helpers", "filesRunReporter.mjs"));
    assert.ok(printed, "the reporter no longer prints a per-directory line");
    assert.ok(step.includes(`${printed[1]}tests/integration: `), "the step greps for a line nothing prints");
    assert.match(step, /ls tests\/integration\/\*\.test\.ts \| wc -l/);
    assert.match(step, /\[ "\$ran" -lt "\$expected" \]/);
    assert.match(step, /\[ "\$expected" -lt \d{2} \]/);
  });
});

describe("loop:test fails when a test file never loaded", () => {
  const scripts = JSON.parse(readRepoFile("package.json")).scripts;
  const reporters = (script: string) => script.split(" ").filter((a) => a.startsWith("--test-reporter"));

  test("it carries npm test's reporters", () => {
    assert.deepEqual(reporters(scripts["loop:test"]), reporters(scripts.test));
  });

  test("a glob matching nothing fails it", () => {
    const args = (scripts["loop:test"] as string).split(" ").slice(1, -1);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, [...args, "tools/loop/tests/**/no-such-*.test.ts"], {
      cwd: repoRoot,
      env,
      encoding: "utf8",
    });
    assert.notEqual(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stderr, /no test file loaded at all/);
  });
});

describe("the loop tests that skip off win32 run on Windows", () => {
  const job = /\n {2}harness-windows:\n[\s\S]*?(?=\n {2}[\w-]+:\n)/.exec(readRepoFile(".github", "workflows", "ci.yml"))?.[0] ?? "";
  const dir = path.join(repoRoot, "tools", "loop", "tests");
  const loopTests = readdirSync(dir).filter((f) => f.endsWith(".test.ts"));
  const lines = (f: string) => readFileSync(path.join(dir, f), "utf8").split("\n");

  test("the Windows leg selects every one of them", () => {
    assert.match(job, /runs-on: windows-latest/);
    const pattern = /grep -lE '([^']+)' tools\/loop\/tests\/\*\.test\.ts/.exec(job)?.[1];
    assert.ok(pattern, "the Windows leg no longer selects its files with grep");
    const selected = loopTests.filter((f) => lines(f).some((l) => new RegExp(pattern).test(l)));
    const code = (f: string) => lines(f).filter((l) => !/^\s*(\/\/|\/?\*)/.test(l));
    const gated = loopTests.filter((f) =>
      code(f).some((l) => /\bskip\b.*(\bwin32\b|\bonWindows\b|platform)/.test(l)),
    );
    assert.ok(gated.length >= 4, `only ${gated.length} loop test files skip off win32`);
    assert.deepEqual(selected, gated);
  });

  test("it fails on a skip, and on a run that passed nothing", () => {
    assert.match(job, /grep -qE '\^# skipped 0\$' win32\.tap \|\| \{[^}]*exit 1; \}/);
    assert.match(job, /grep -qE '\^# pass \[1-9\]' win32\.tap \|\| \{[^}]*exit 1; \}/);
    assert.match(job, /\[ -n "\$files" \] \|\| \{[^}]*exit 1; \}/);
  });
});
