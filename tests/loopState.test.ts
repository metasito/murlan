// tests/loopState.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readFields, isRunning, stateDir, statePath } from "../scripts/loop-state.mjs";

describe("where the run state lives", () => {
  // The defect this replaced: a tracked STATE.md, rewritten every phase, made the tree dirty, and
  // preflight refuses to start a run on a dirty tree. The loop could run exactly once.
  test("it is outside the working tree, so a run cannot dirty it", () => {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split(/\r?\n/);
    assert.ok(
      !tracked.includes(".claude/loop/STATE.md"),
      "STATE.md is tracked again; a run will make the tree dirty and preflight will refuse"
    );
    assert.ok(tracked.includes(".claude/loop/STATE.template.md"), "the template must be tracked");
  });

  test("it resolves under the shared git dir, which every worktree sees", () => {
    const common = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8" }
    ).trim();
    assert.equal(resolve(stateDir()), resolve(common, "loop"));
    assert.equal(resolve(statePath()), resolve(common, "loop", "STATE.md"));
  });

  test("the template carries every field the gate requires", () => {
    const fields = readFields(readFileSync(".claude/loop/STATE.template.md", "utf8"));
    for (const key of ["status", "ticket", "branch", "dod", "recon", "verdict"]) {
      assert.ok(key in fields, `the template has no \`${key}\` field`);
    }
  });
});

describe("the one parser", () => {
  test("a template hint is not evidence", () => {
    const f = readFields("status: RUNNING\nrecon:   # B: files to touch\n");
    assert.equal(f.recon, "");
  });

  test("a checklist spanning several lines is one field", () => {
    const f = readFields("dod:\n  - [ ] one\n  - [ ] two\nrecon: a.ts\n");
    assert.match(f.dod, /one/);
    assert.match(f.dod, /two/);
    assert.equal(f.recon, "a.ts");
  });

  // Two parsers disagreed on this exact input: the gate read it as live and allowed a push, while
  // the compaction brief read it as dead and restored nothing.
  test("odd spacing means the same thing to everything that reads it", () => {
    for (const text of ["status: RUNNING\n", "status:  RUNNING\n", "status:\tRUNNING\n"]) {
      assert.equal(isRunning(readFields(text)), true, `not read as live: ${JSON.stringify(text)}`);
    }
    assert.equal(isRunning(readFields("status: HALTED\nnote: was RUNNING\n")), false);
  });
});
