import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { brief, parseHeader, readIssue, KINDS } from "../brief.mjs";

const SCRIPT = fileURLToPath(new URL("../brief.mjs", import.meta.url));
const WT = "C:/Users/roton/murlan/.worktrees/agent-42";

describe("brief", () => {
  test("every kind opens with a header parseHeader reads back", () => {
    for (const kind of KINDS) {
      const text = brief(kind, { n: 42, worktree: WT, base: "abc1234" });
      assert.equal(text.split("\n")[0], `BRIEF ${kind} #42 ${WT} abc1234`);
      assert.deepEqual(parseHeader(text), { kind, n: 42, worktree: WT, base: "abc1234" });
    }
  });

  test("base defaults to origin/main", () => {
    assert.match(brief("review", { n: 7, worktree: WT }), /^BRIEF review #7 \S+ origin\/main$/m);
  });

  test("every brief forbids spawning a subagent", () => {
    for (const kind of KINDS) assert.match(brief(kind, { n: 1, worktree: WT }), /Do not spawn any subagent/);
  });

  test("every brief that names the issue reads its body and only trusted comments", () => {
    assert.match(readIssue(5), /^gh issue view 5 --json title,body,comments --jq '\.title, \.body, /);
    assert.ok(readIssue(5).includes(`select(.authorAssociation|IN("OWNER","MEMBER","COLLABORATOR"))`));
    for (const kind of KINDS) {
      const text = brief(kind, { n: 5, worktree: WT });
      assert.doesNotMatch(text, /--comments/, kind);
      if (["scope", "completeness", "review", "fix"].includes(kind)) assert.ok(text.includes(readIssue(5)), kind);
    }
  });

  test("the completeness brief sweeps every removed or renamed name", () => {
    const text = brief("completeness", { n: 1103, worktree: WT });
    assert.match(text, /gh issue view 1103 --json title,body,comments/);
    assert.match(text, /git -C \S+ diff origin\/main\.\.\.HEAD/);
    for (const kind of ["env var", "npm script", "locale key", "testID", "file path"]) assert.ok(text.includes(kind), kind);
    assert.match(text, /git -C \S+ grep/);
  });

  test("a review sorts findings so that only a bug, an unmet box, a regression or a security risk blocks", () => {
    for (const kind of ["review", "fix"]) {
      const text = brief(kind, { n: 1, worktree: WT });
      assert.match(text, /## Blocking`, `## Nits` and `## Pre-existing/, kind);
      assert.match(text, /A rule breach, a name, a comment, an untested branch or a style preference is a Nit/, kind);
    }
  });

  test("a later round reviews only the fix and checks the earlier Blocking findings", () => {
    const first = brief("review", { n: 1, worktree: WT });
    const later = brief("review", { n: 1, worktree: WT, base: "abc1234" });
    assert.match(first, /does it do what the Definition of done asks/);
    assert.match(later, /Review only the fix `git -C \S+ diff abc1234\.\.\.HEAD`/);
    assert.match(later, /each earlier Blocking finding listed after this brief fixed/);
    assert.match(later, /Report Blocking findings only/);
  });

  test("the completeness brief asks for the covering test, and leaves test strength to the builder", () => {
    const text = brief("completeness", { n: 1, worktree: WT });
    assert.match(text, /the test that covers it/);
    assert.doesNotMatch(text, /line is deleted|either way|recheck/);
  });
  test("the completeness brief sweeps the tests for a changed literal's old value", () => {
    const text = brief("completeness", { n: 1256, worktree: WT });
    assert.match(text, /literal value the diff changes/);
    assert.match(text, /git -C \S+ grep -n -F <old value> -- tests/);
  });

  test("the scope brief no longer asks for feature groups to split", () => {
    assert.doesNotMatch(brief("scope", { n: 1, worktree: WT }), /feature groups/);
  });

  test("an unknown kind throws, and a non-header first line parses to null", () => {
    assert.throws(() => brief("nope", { n: 1, worktree: WT }));
    assert.equal(parseHeader("You are a reviewer"), null);
    assert.equal(parseHeader(""), null);
  });

  test("the CLI prints the brief, and refuses bad arguments with exit 2", () => {
    assert.equal(execFileSync(process.execPath, [SCRIPT, "review", "9", WT], { encoding: "utf8" }).trimEnd(), brief("review", { n: 9, worktree: WT }).trimEnd());
    assert.equal(spawnSync(process.execPath, [SCRIPT, "nope", "9", WT]).status, 2);
    assert.equal(spawnSync(process.execPath, [SCRIPT, "review", "x", WT]).status, 2);
  });
});
