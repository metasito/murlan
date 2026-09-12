// tests/agentCheckSubject.test.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSubject, readSubject } from "../scripts/preflight.mjs";
import { BANNER } from "../scripts/check-steps.mjs";

const REAP = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } as const;
// A refusal exits at once; a regression that stops short-circuiting would otherwise run the real
// suites, and a check turning from red into an hours-long hang is the one outcome a guard must not
// have.
const SPAWN = { encoding: "utf8", timeout: 60_000 } as const;

const SCRIPT = fileURLToPath(new URL("../scripts/agent-check.mjs", import.meta.url));

type Reading = { toplevel: string | null; baseSha: string | null; changed: string };

const reading: Reading = {
  toplevel: "C:/Users/x/murlan/.worktrees/agent-981",
  baseSha: "abc1234567",
  changed: " M scripts/agent-check.mjs\n",
};

const refusal = (subject: { refuse?: string }): string => {
  assert.ok(subject.refuse, "expected a refusal, got a subject");
  return subject.refuse;
};

describe("a subject it cannot locate", () => {
  test("no tree is a refusal, not a pass", () => {
    assert.match(refusal(checkSubject({ ...reading, toplevel: null })), /no tree to judge/);
  });

  test("no base is a refusal, not a pass", () => {
    assert.match(refusal(checkSubject({ ...reading, baseSha: null })), /origin\/main/);
  });

  test("the subject names the base it judged against", () => {
    assert.equal(checkSubject(reading).base, "abc1234");
  });
});

let root: string | null = null;
let shared = "";
let branch = "";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" });

const slashes = (p: string) => p.replace(/\\/g, "/");

/**
 * One repository, a shared checkout on `main` and a ticket worktree carrying the work — the
 * arrangement every run of the loop sits in. Built for real, because the defect is in what the
 * readings are taken *from*, and a hand-written reading cannot be taken from the wrong tree.
 */
before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "murlan-subject-")));
  shared = path.join(root, "repo");
  branch = path.join(shared, ".worktrees", "agent-1");
  fs.mkdirSync(shared);
  git(shared, "init", "-q", "-b", "main");
  git(shared, "config", "user.email", "t@example.com");
  git(shared, "config", "user.name", "t");
  fs.writeFileSync(path.join(shared, "a.txt"), "one\n");
  git(shared, "add", "-A");
  git(shared, "commit", "-qm", "base");
  git(shared, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(shared, "worktree", "add", "-q", "-b", "agent/1", branch);
  fs.writeFileSync(path.join(branch, "b.txt"), "two\n");
  git(branch, "add", "-A");
  git(branch, "commit", "-qm", "the branch's work");
  // A scratch file is what the shared checkout always has lying in it, and it is not work.
  fs.writeFileSync(path.join(shared, "scratch.log"), "noise\n");
});

after(() => {
  if (root) fs.rmSync(root, REAP);
  root = null;
});

describe("the tree agent:check judges", () => {
  test("two worktrees of one repository, at one moment, give two verdicts", () => {
    assert.match(
      refusal(readSubject(shared)),
      /nothing to judge/,
      "the shared checkout is on main with nothing but a scratch file"
    );
    assert.equal(readSubject(branch).refuse, undefined, "the branch carries the work");
  });

  test("the branch's verdict names the branch's tree", () => {
    assert.equal(readSubject(branch).root, slashes(branch));
  });

  test("and the base it judged against", () => {
    assert.equal(readSubject(branch).base, git(shared, "rev-parse", "--short=7", "origin/main").trim());
  });

  // Without this, the subject could be resolved for any tree at all and every assertion above
  // would still pass — the shape where a correct module lands with nothing calling it.
  test("the script asks about the tree it is standing in", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { ...SPAWN, cwd: shared });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, new RegExp(`nothing to judge in ${slashes(shared).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });
});

describe("the refusal is the script's, not only the helper's", () => {
  test("run where it cannot find a tree, agent-check refuses before it runs a step", () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "murlan-no-tree-")));
    try {
      const run = spawnSync(process.execPath, [SCRIPT], { ...SPAWN, cwd: outside });
      assert.notEqual(run.status, 0, "a check that cannot locate its subject must not report green");
      assert.match(run.stderr, /agent:check: no tree to judge/);
      assert.ok(!run.stdout.includes(BANNER), "no step may run before the subject is known");
    } finally {
      fs.rmSync(outside, REAP);
    }
  });
});
