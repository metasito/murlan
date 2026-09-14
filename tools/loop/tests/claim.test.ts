// tools/loop/tests/claim.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { slugOf, claimSteps, claim } from "../claim.mjs";

test("a slug is lowercase, hyphenated and short enough to be a branch", () => {
  assert.equal(slugOf("Fix the A11y veil's re-announce"), "fix-the-a11y-veil-s-re-announce");
  assert.ok(slugOf("x".repeat(200)).length <= 48);
});

test("the claim writes the label before it reads the race", () => {
  const names = claimSteps(42, "Some ticket").map((s) => s.name);
  assert.deepEqual(names, ["label", "comment", "race", "fetch", "worktree"]);
});

test("the claim comment goes through a file, never an inline body", () => {
  const comment = claimSteps(42, "Some ticket").find((s) => s.name === "comment");
  assert.ok(comment?.args.includes("--body-file"));
  assert.ok(!comment?.args.includes("--body"));
});

test("an older claim by someone else loses the race", () => {
  const out = claim(42, "Some ticket", (_file: string, args: string[]) => {
    if (args.includes("--json")) {
      return JSON.stringify({ comments: [{ body: "Claimed by `agent/42-someone-else`." }] });
    }
    return "";
  });
  assert.equal(out.won, false);
  assert.match(String(out.why), /agent\/42-someone-else/);
});

test("the session's own claim comment does not lose it the race", () => {
  const out = claim(42, "Some ticket", (_file: string, args: string[]) =>
    args.includes("--json")
      ? JSON.stringify({ comments: [{ body: "Claimed by `agent/42-some-ticket`." }] })
      : "",
  );
  assert.equal(out.won, true);
  assert.equal(out.why, null);
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

test("a lost race leaves in-progress alone — it is the winner's label too", () => {
  const asked: string[][] = [];
  claim(42, "Some ticket", (file: string, args: string[]) => {
    asked.push([file, ...args]);
    return args.includes("--json")
      ? JSON.stringify({ comments: [{ body: "Claimed by `agent/42-someone-else`." }] })
      : "";
  });
  assert.equal(asked.some((a) => a.includes("--remove-label")), false);
});
