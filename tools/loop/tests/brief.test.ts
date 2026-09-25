import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { brief, parseHeader, KINDS } from "../brief.mjs";

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
    assert.match(brief("spec", { n: 7, worktree: WT }), /^BRIEF spec #7 \S+ origin\/main$/m);
  });

  test("every brief forbids spawning a subagent", () => {
    for (const kind of KINDS) assert.match(brief(kind, { n: 1, worktree: WT }), /Do not spawn any subagent/);
  });

  test("the completeness brief sweeps every removed or renamed name", () => {
    const text = brief("completeness", { n: 1103, worktree: WT });
    assert.match(text, /gh issue view 1103 --json title,body,comments/);
    assert.match(text, /git -C \S+ diff origin\/main\.\.\.HEAD/);
    for (const kind of ["env var", "npm script", "locale key", "testID", "file path"]) assert.ok(text.includes(kind), kind);
    assert.match(text, /git -C \S+ grep/);
  });

  test("the standards brief carries the vendored baseline and points at RULES.md", () => {
    const text = brief("standards", { n: 1, worktree: WT });
    assert.match(text, /docs\/agents\/RULES\.md/);
    assert.match(text, /Feature Envy/);
  });

  test("the scope brief asks for independent feature groups", () => {
    assert.match(brief("scope", { n: 1, worktree: WT }), /independent feature groups/);
  });

  test("an unknown kind throws, and a non-header first line parses to null", () => {
    assert.throws(() => brief("nope", { n: 1, worktree: WT }));
    assert.equal(parseHeader("You are a reviewer"), null);
    assert.equal(parseHeader(""), null);
  });

  test("the CLI prints the brief, and refuses bad arguments with exit 2", () => {
    assert.equal(execFileSync(process.execPath, [SCRIPT, "spec", "9", WT], { encoding: "utf8" }).trimEnd(), brief("spec", { n: 9, worktree: WT }).trimEnd());
    assert.equal(spawnSync(process.execPath, [SCRIPT, "nope", "9", WT]).status, 2);
    assert.equal(spawnSync(process.execPath, [SCRIPT, "spec", "x", WT]).status, 2);
  });
});
