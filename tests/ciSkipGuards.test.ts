import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readRepoFile = (...parts: string[]) =>
  readFileSync(path.join(repoRoot, ...parts), "utf8");

/** The files allowed to contain a phrase, because they are the ones printing it. */
const OWNERS = ["tests/helpers/testServer.ts", "tests/backupDb.test.ts"];

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
