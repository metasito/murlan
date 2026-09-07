// tests/preflight.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyStatus, primaryWorktree, lockDrift } from "../scripts/preflight.mjs";

describe("what blocks a run from starting", () => {
  test("a modified tracked file blocks", () => {
    const { blocking } = classifyStatus(" M .claude/workflows/ticket-pipeline.mjs");
    assert.deepEqual(blocking, ["M .claude/workflows/ticket-pipeline.mjs"]);
  });

  test("staged, deleted and renamed files block too", () => {
    const { blocking } = classifyStatus("M  a.ts\n D b.ts\nR  c.ts -> d.ts");
    assert.equal(blocking.length, 3);
  });

  // A scratch folder is not someone's in-flight change, and a check that blocks on one becomes a
  // check people skip.
  test("untracked paths are reported but never block", () => {
    const { blocking, untracked } = classifyStatus('?? "murlan bug/"\n?? scratch.txt');
    assert.deepEqual(blocking, []);
    assert.deepEqual(untracked, ['"murlan bug/"', "scratch.txt"]);
  });

  // The floor: on a clean tree the check must find nothing. One that always reports something
  // would satisfy every assertion above and block every run.
  test("a clean tree blocks nothing and reports nothing", () => {
    const { blocking, untracked } = classifyStatus("");
    assert.deepEqual(blocking, []);
    assert.deepEqual(untracked, []);
  });

  test("the primary worktree is the first one git prints", () => {
    const listing = [
      "worktree C:/Users/dev/murlan",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree C:/Users/dev/murlan/.worktrees/agent-42",
      "HEAD def",
    ].join("\n");
    assert.equal(primaryWorktree(listing), "C:/Users/dev/murlan");
  });

  test("an unreadable listing yields no worktree rather than a wrong one", () => {
    assert.equal(primaryWorktree(""), null);
  });
});

describe("node_modules drift from package-lock.json", () => {
  const packageJson = { dependencies: { "react-native": "0.86.3" }, devDependencies: { typescript: "5.0.0" } };
  const packageLock = {
    packages: {
      "node_modules/react-native": { version: "0.86.3" },
      "node_modules/typescript": { version: "5.0.0" },
    },
  };

  test("an installed version behind the lockfile is drift", () => {
    const drift = lockDrift(packageJson, packageLock, { "react-native": "0.81.5", typescript: "5.0.0" });
    assert.deepEqual(drift, [{ name: "react-native", installed: "0.81.5", locked: "0.86.3" }]);
  });

  test("a missing install is drift too, not silently skipped", () => {
    const drift = lockDrift(packageJson, packageLock, { typescript: "5.0.0" });
    assert.deepEqual(drift, [{ name: "react-native", installed: "missing", locked: "0.86.3" }]);
  });

  test("matching installs report no drift", () => {
    const drift = lockDrift(packageJson, packageLock, { "react-native": "0.86.3", typescript: "5.0.0" });
    assert.deepEqual(drift, []);
  });

  test("a dependency absent from the lockfile's packages map is not checked", () => {
    const drift = lockDrift(
      { dependencies: { unlocked: "1.0.0" } },
      { packages: {} },
      { unlocked: "2.0.0" }
    );
    assert.deepEqual(drift, []);
  });
});
