import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { changedFiles, git } from "../../tools/loop/cli.mjs";
import { SUBJECT_CHANGES } from "../../tools/loop/agent-check.mjs";
import { RELATED_CHANGES } from "../../tools/loop/related-tests.mjs";
import { SCOPE_CHANGES, scopeAt } from "../../tools/ci/scope.mjs";

/**
 * One repository holding one of each kind of change: a commit on the branch, a commit on
 * origin/main the branch does not have, an uncommitted tracked edit, an untracked file and an
 * ignored one. Each caller's row names which of them it counts.
 */
let dir = "";
const commit = (file: string, message: string, content = message) => {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir)(["add", file]);
  git(dir)(["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", message]);
};

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "changed-files-"));
  git(dir)(["init", "-q", "-b", "main"]);
  commit(".gitignore", "base", "ignored.log\n");
  commit("edited.txt", "base");
  git(dir)(["switch", "-q", "-c", "upstream"]);
  commit("upstream-only.txt", "upstream");
  git(dir)(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(dir)(["switch", "-q", "main"]);
  commit("committed.txt", "branch");
  fs.writeFileSync(path.join(dir, "edited.txt"), "edited");
  fs.writeFileSync(path.join(dir, "new.test.ts"), "");
  fs.writeFileSync(path.join(dir, "ignored.log"), "");
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("each caller's change set", () => {
  const rows: [string, Parameters<typeof changedFiles>[1], string[]][] = [
    ["agent:check judges the branch and its uncommitted edits, not scratch files", SUBJECT_CHANGES, ["committed.txt", "edited.txt"]],
    ["native:related also selects a test not yet added", RELATED_CHANGES, ["committed.txt", "edited.txt", "new.test.ts"]],
    [
      "ci's scope diffs the two trees, so what the base has and HEAD lacks counts too",
      { ...SCOPE_CHANGES, base: "origin/main" },
      ["committed.txt", "upstream-only.txt"],
    ],
  ];
  for (const [name, which, want] of rows) {
    test(name, () => assert.deepEqual(changedFiles(git(dir), which).sort(), want));
  }
});

test("a base git cannot read runs every suite", () => {
  assert.deepEqual(scopeAt("no-such-ref", git(dir)), { app: true, harness: true, scans: true, native: true });
});
