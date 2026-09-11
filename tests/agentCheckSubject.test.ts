// tests/agentCheckSubject.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkSubject } from "../scripts/preflight.mjs";

// The two readings one repository gives at one moment: from the shared checkout on main, which
// carries nothing, and from the ticket worktree, which carries the work.
type Reading = { toplevel: string | null; baseSha: string | null; changed: string };

const primary: Reading = { toplevel: "C:/Users/x/murlan", baseSha: "abc1234567", changed: "" };
const worktree: Reading = {
  toplevel: "C:/Users/x/murlan/.worktrees/agent-981",
  baseSha: "abc1234567",
  changed: " M scripts/agent-check.mjs\n",
};

const refusal = (reading: typeof worktree): string => {
  const { refuse } = checkSubject(reading);
  assert.ok(refuse, "expected a refusal, got a subject");
  return refuse;
};

describe("the tree agent:check judges", () => {
  test("is the one it was invoked from", () => {
    assert.equal(checkSubject(worktree).root, worktree.toplevel);
  });

  test("two worktrees of one repository give two verdicts", () => {
    assert.match(
      refusal(primary),
      /nothing to judge/,
      "the shared checkout has no diff, so a green there is about nothing"
    );
    assert.equal(checkSubject(worktree).refuse, undefined);
  });

  test("no tree is a refusal, not a pass", () => {
    assert.match(refusal({ ...worktree, toplevel: null }), /no tree to judge/);
  });

  test("no base is a refusal, not a pass", () => {
    assert.match(refusal({ ...worktree, baseSha: null }), /origin\/main/);
  });

  test("the verdict names the base it judged against", () => {
    assert.equal(checkSubject(worktree).base, "abc1234");
  });
});

describe("the refusal is the script's, not only the helper's", () => {
  test("run where it cannot find a tree, agent-check refuses before it runs a step", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "agent-check-"));
    try {
      const run = spawnSync(process.execPath, [path.resolve("scripts/agent-check.mjs")], {
        cwd: outside,
        encoding: "utf8",
      });
      assert.notEqual(run.status, 0, "a check that cannot locate its subject must not report green");
      assert.match(run.stderr, /agent:check: no tree to judge/);
      assert.doesNotMatch(run.stdout, /=== typecheck ===/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
