// tools/loop/tests/claim.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { slugOf, claimSteps, claim } from "../claim.mjs";

test("a slug is lowercase, hyphenated and short enough to be a branch", () => {
  assert.equal(slugOf("Fix the A11y veil's re-announce"), "fix-the-a11y-veil-s-re-announce");
  assert.ok(slugOf("x".repeat(200)).length <= 48);
});

test("the worktree is taken last, because taking it is what wins the ticket", () => {
  const names = claimSteps(42, "Some ticket").map((s) => s.name);
  assert.deepEqual(names, ["label", "comment", "fetch", "worktree"]);
});

test("the claim comment goes through a file, never an inline body", () => {
  const comment = claimSteps(42, "Some ticket").find((s) => s.name === "comment");
  assert.ok(comment?.args.includes("--body-file"));
  assert.ok(!comment?.args.includes("--body"));
});

test("a branch already on origin is reset to, never cut fresh from main", () => {
  const asked: string[][] = [];
  claim(1043, "Stranded", (file: string, args: string[]) => {
    asked.push([file, ...args]);
    return args.includes("--json") ? JSON.stringify({ comments: [] }) : "";
  });
  const add = asked.find((a) => a[1] === "worktree");
  assert.deepEqual(add?.slice(0, 4), ["git", "worktree", "add", "-B"]);
  assert.equal(add?.at(-1), "origin/agent/1043-stranded");
});

test("no branch on origin cuts a fresh one from main", () => {
  const asked: string[][] = [];
  claim(44, "Fresh", (file: string, args: string[]) => {
    asked.push([file, ...args]);
    if (args[0] === "rev-parse") throw new Error("not a ref");
    return args.includes("--json") ? JSON.stringify({ comments: [] }) : "";
  });
  const add = asked.find((a) => a[1] === "worktree");
  assert.deepEqual(add?.slice(0, 4), ["git", "worktree", "add", "-b"]);
  assert.equal(add?.at(-1), "origin/main");
});

// A worktree already standing is the only evidence that separates a live peer from a dead run, and
// #1043 was parked because a comment-reading check could not tell them apart.
test("a worktree already standing loses the ticket, and keeps the holder's label", () => {
  const asked: string[][] = [];
  const out = claim(42, "Some ticket", (file: string, args: string[]) => {
    asked.push([file, ...args]);
    if (args[0] === "worktree") throw new Error("fatal: '.worktrees/agent-42' already exists");
    if (args[0] === "rev-parse") throw new Error("not a ref");
    return "";
  });
  assert.equal(out.won, false);
  assert.match(String(out.why), /already standing/);
  assert.equal(asked.some((a) => a.includes("--remove-label")), false);
});

test("a stale claim comment from a dead run does not lose the ticket", () => {
  const out = claim(1043, "Stranded", (_file: string, args: string[]) =>
    args.includes("--json") ? JSON.stringify({ comments: [{ body: "Claimed by `agent/1043-old-slug`." }] }) : "",
  );
  assert.equal(out.won, true);
});
