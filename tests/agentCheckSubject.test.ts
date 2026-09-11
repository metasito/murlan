// tests/agentCheckSubject.test.ts
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkSubject, readSubject } from "../scripts/preflight.mjs";
import { LOCAL } from "../scripts/check-steps.mjs";

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

/**
 * One repository, a shared checkout on `main` and a ticket worktree carrying the work — the exact
 * arrangement every run of the loop sits in. Built for real, because the defect is in what the
 * readings are taken *from*, and a hand-written reading cannot be taken from the wrong tree.
 */
const repo = mkdtempSync(path.join(tmpdir(), "agent-check-"));
const branch = path.join(repo, ".worktrees", "agent-1");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
const same = (a: string, b: string) =>
  assert.equal(realpathSync(a).replace(/\\/g, "/").toLowerCase(), realpathSync(b).replace(/\\/g, "/").toLowerCase());

git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.email", "t@example.com");
git(repo, "config", "user.name", "t");
writeFileSync(path.join(repo, "a.txt"), "one\n");
git(repo, "add", "-A");
git(repo, "commit", "-qm", "base");
git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
git(repo, "worktree", "add", "-q", "-b", "agent/1", branch);
writeFileSync(path.join(branch, "b.txt"), "two\n");
git(branch, "add", "-A");
git(branch, "commit", "-qm", "the branch's work");
// A scratch file is what the shared checkout always has lying in it, and it is not work.
writeFileSync(path.join(repo, "scratch.log"), "noise\n");

after(() => {
  // Windows leaves git's object files read-only; a temp directory outliving a green test is not
  // worth failing over.
  try {
    rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* ignore */
  }
});

describe("the tree agent:check judges", () => {
  test("two worktrees of one repository, at one moment, give two verdicts", () => {
    assert.match(
      refusal(readSubject(repo)),
      /nothing to judge/,
      "the shared checkout is on main with nothing but a scratch file, so a green there is about nothing"
    );
    assert.equal(readSubject(branch).refuse, undefined, "the branch carries the work");
  });

  test("the branch's verdict names the branch's tree", () => {
    same(readSubject(branch).root, branch);
  });

  test("and the base it judged against", () => {
    assert.equal(readSubject(branch).base, git(repo, "rev-parse", "--short=7", "origin/main").trim());
  });
});

describe("the refusal is the script's, not only the helper's", () => {
  test("run where it cannot find a tree, agent-check refuses before it runs a step", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "agent-check-outside-"));
    try {
      const run = spawnSync(process.execPath, [path.resolve("scripts/agent-check.mjs")], {
        cwd: outside,
        encoding: "utf8",
      });
      assert.notEqual(run.status, 0, "a check that cannot locate its subject must not report green");
      assert.match(run.stderr, /agent:check: no tree to judge/);
      assert.doesNotMatch(run.stdout, new RegExp(`=== ${LOCAL[0].name} ===`));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
