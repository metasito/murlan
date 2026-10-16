// tools/loop/tests/claim.test.ts
import test, { afterEach, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugOf, claimSteps, claim, failedClaim, baseOf } from "../claim.mjs";
import { fakeTracker } from "../tracker.mjs";

test("a slug is lowercase, hyphenated and short enough to be a branch", () => {
  assert.equal(slugOf("Fix the A11y veil's re-announce"), "fix-the-a11y-veil-s-re-announce");
  assert.ok(slugOf("x".repeat(200)).length <= 48);
});

test("the worktree is taken last, because taking it is what wins the ticket", () => {
  const names = claimSteps(42, "Some ticket").map((s) => s.name);
  assert.deepEqual(names, ["label", "comment", "fetch", "worktree"]);
});

test("the fetch prunes, so a merged branch's tracking ref does not outlive it", () => {
  assert.ok(claimSteps(42, "Some ticket").find((s) => s.name === "fetch")?.args?.includes("--prune"));
});

test("a claim labels the issue and comments the branch in the shape a peer's claim is matched on", () => {
  const tracker = fakeTracker({ 42: { labels: ["ready-for-agent"] } });
  claim(42, "Some ticket", (_file: string, args: string[]) => {
    if (args[0] === "rev-parse") throw new Error("not a ref");
    return "";
  }, tracker);
  const { labels, comments } = tracker.held(42);
  assert.deepEqual(labels, ["in-progress", "ready-for-agent"]);
  assert.deepEqual(comments.map((f: string) => readFileSync(f, "utf8")), ["Claimed by `agent/42-some-ticket`.\n"]);
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

/** What execFileSync throws: the command line in `message`, git's own words in `stderr`. */
const gitFailure = (args: string[], stderr: string) =>
  Object.assign(new Error(`Command failed: git ${args.join(" ")}\n${stderr}`), { stderr });

test("a branch only this machine holds is checked out as it stands, never cut again", () => {
  const asked: string[][] = [];
  const out = claim(1090, "Parked unpushed", (file: string, args: string[]) => {
    asked.push([file, ...args]);
    if (args[0] === "rev-parse" && args.at(-1)?.startsWith("refs/remotes/")) throw new Error("not a ref");
    return "";
  });
  assert.equal(out.won, true);
  const add = asked.find((a) => a[1] === "worktree");
  assert.deepEqual(add, ["git", "worktree", "add", ".worktrees/agent-1090", "agent/1090-parked-unpushed"]);
});

test("a local branch ahead of its pushed one is used as it stands", () => {
  const git = (ancestor: string) => (_file: string, args: string[]) => {
    if (args[0] === "merge-base" && `${args[2]} ${args[3]}` !== ancestor) throw new Error("not an ancestor");
    return "";
  };
  assert.equal(baseOf("agent/7-x", git("origin/agent/7-x agent/7-x")), "agent/7-x");
  assert.equal(baseOf("agent/7-x", git("agent/7-x origin/agent/7-x")), "origin/agent/7-x");
});

// #1602 parked in phase A on 2026-10-16: origin was rebased and force-pushed, and the shared
// checkout kept the stale local branch, whose one local-only patch main already carried.
describe("a local branch diverged from a rebased origin", () => {
  const B = "agent/1602-x";
  let root = "";
  let dir = "";
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "advice.skippedCherryPicks=false", ...args], { cwd, encoding: "utf8" }).trim();
  const run = (_file: string, args: string[]) => git(dir, ...args);
  const commit = (file: string, body: string) => {
    writeFileSync(join(dir, file), body);
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", file);
    return git(dir, "rev-parse", "HEAD");
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "claim-diverged-"));
    dir = join(root, "work");
    const origin = join(root, "origin.git");
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    git(root, "init", "-q", "-b", "main", dir);
    git(dir, "remote", "add", "origin", origin);
    commit("base.txt", "0");
    git(dir, "checkout", "-qb", B);
    commit("work.txt", "1");
    const duplicate = commit("shared.txt", "2");
    git(dir, "checkout", "-q", "main");
    git(dir, "cherry-pick", duplicate);
    writeFileSync(join(dir, "notes.txt"), "n");
    commit("main.txt", "3");
    git(dir, "checkout", "-q", "-b", "rebased", B);
    git(dir, "rebase", "-q", "main");
    git(dir, "push", "-q", "origin", "main", `rebased:${B}`);
    git(dir, "checkout", "-q", "main");
    git(dir, "fetch", "-q", "origin");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("every local-only patch already upstream: the claim resets to origin", () => {
    assert.equal(baseOf(B, run), `origin/${B}`);
  });

  test("a local-only patch main carries under another patch-id, applying as an empty diff, still resets", () => {
    git(dir, "checkout", "-q", B);
    const byHand = commit("main.txt", "3");
    git(dir, "checkout", "-q", "main");
    assert.ok(git(dir, "cherry", "origin/main", B).includes(`+ ${byHand}`), "main's commit also added notes.txt, so no patch-id matches");
    assert.equal(baseOf(B, run), `origin/${B}`);
  });

  test("a local-only patch absent from both origin and main is refused", () => {
    git(dir, "checkout", "-q", B);
    commit("only-here.txt", "4");
    git(dir, "checkout", "-q", "main");
    assert.throws(() => baseOf(B, run), /diverged/);
  });
});

// #1090 was parked "already standing" with no worktree anywhere: the command line in the message
// names the path, and git's "a branch named … already exists" completed the match.
test("a branch git refuses to cut is an error, never a peer holding the worktree", () => {
  assert.throws(
    () =>
      claim(42, "Some ticket", (_file: string, args: string[]) => {
        if (args[0] === "rev-parse") throw new Error("not a ref");
        if (args[0] === "worktree") throw gitFailure(args, "fatal: a branch named 'agent/42-some-ticket' already exists");
        return "";
      }),
    /a branch named/,
  );
  const line = failedClaim(gitFailure(["worktree"], "Preparing worktree\nfatal: a branch named 'x' already exists\n"));
  assert.equal(line.split("\t").at(-1), "fatal: a branch named 'x' already exists");
});

// A worktree already standing is the only evidence that separates a live peer from a dead run, and
// #1043 was parked because a comment-reading check could not tell them apart.
test("a worktree already standing loses the ticket, and keeps the holder's label", () => {
  const tracker = fakeTracker({ 42: { labels: ["in-progress"] } });
  const out = claim(42, "Some ticket", (_file: string, args: string[]) => {
    if (args[0] === "worktree") throw gitFailure(args, "fatal: '.worktrees/agent-42' already exists");
    if (args[0] === "rev-parse") throw new Error("not a ref");
    return "";
  }, tracker);
  assert.equal(out.won, false);
  assert.match(String(out.why), /already standing/);
  assert.deepEqual(tracker.held(42).labels, ["in-progress"]);
});

test("a stale claim comment from a dead run does not lose the ticket", () => {
  const out = claim(1043, "Stranded", (_file: string, args: string[]) =>
    args.includes("--json") ? JSON.stringify({ comments: [{ body: "Claimed by `agent/1043-old-slug`." }] }) : "",
  );
  assert.equal(out.won, true);
});
