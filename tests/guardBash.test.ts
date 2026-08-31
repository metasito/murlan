// tests/guardBash.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { check } from "../scripts/guard-bash.mjs";

describe("the bash guard blocks what has a correct alternative", () => {
  for (const cmd of [
    "git add -A",
    "git add .",
    "git add --all",
    "git commit -q -m x && git add -A",
    "cd /c/repo && git add -A -- .",
  ]) {
    test(`blocks: ${cmd}`, () => {
      assert.ok(check(cmd), `expected ${cmd} to be blocked`);
      assert.match(check(cmd)!, /pathspec/);
    });
  }

  for (const cmd of ["find / -iname node_modules", "find /c/ -name x", "find C:\\ -name x"]) {
    test(`blocks: ${cmd}`, () => {
      assert.ok(check(cmd), `expected ${cmd} to be blocked`);
      assert.match(check(cmd)!, /require\.resolve/);
    });
  }

  for (const cmd of [
    "git checkout -- components/MenuLayout.tsx",
    "git restore components/MenuLayout.tsx",
    "git restore -- a.ts",
    "npm test; git checkout -- a.ts b.ts",
    "git checkout --  spaced.ts",
    // --staged is safe on its own; adding --worktree is what discards the edits.
    "git restore --staged --worktree a.ts",
  ]) {
    test(`blocks: ${cmd}`, () => {
      assert.ok(check(cmd), `expected ${cmd} to be blocked`);
      assert.match(check(cmd)!, /Edit tool/);
    });
  }

  for (const cmd of [
    "git worktree remove .worktrees/w589 --force",
    "git worktree remove --force .worktrees/w589",
    "git worktree remove -f .worktrees/w589",
    "npm test; git worktree remove .worktrees/x --force",
    // Blanking a here-string body must not blind the guard to a real command beside it.
    "git commit -m @'\nmsg\n'@; git worktree remove .worktrees/x --force",
  ]) {
    test(`blocks: ${cmd}`, () => {
      assert.ok(check(cmd), `expected ${cmd} to be blocked`);
      assert.match(check(cmd)!, /worktrees:remove/);
    });
  }
});

// The floor. A guard that blocks everything passes every assertion above and makes the repo
// unusable, so the allowed cases are pinned as hard as the blocked ones.
describe("the bash guard allows correct usage", () => {
  for (const cmd of [
    "git add -- scripts/x.mjs tests/x.test.ts",
    "git add scripts/",
    "git add -p",
    "git status --short",
    "git commit -q -m 'x'",
    "find components -iname '*rail*'",
    "find . -maxdepth 2 -name package.json",
    "npm test",
    "gh pr create --title x",
    // The text as data, not as a command. A guard that fires on these blocks work that runs
    // nothing — it caught its own author writing a regex containing the phrase.
    // Naming a source is the deliberate, documented way back — and the only safe one, because
    // it is reached after the work being protected is committed.
    "git checkout HEAD -- components/MenuLayout.tsx",
    "git restore --source=HEAD~1 a.ts",
    "git restore --staged a.ts",
    // Moving between branches is not touching the working tree's contents.
    "git checkout -b agent/589-x origin/main",
    "git checkout main",
    "git checkout --track origin/x",
    // The plain remove refuses rather than deleting through a link, so it needs no guard.
    "git worktree remove .worktrees/w589",
    "git worktree list",
    "git worktree prune",
    // A here-string body is data — a commit message, a PR body — and its lines start at a line
    // start like any other. The guard blocked its own introducing commit over this.
    "git commit -m @'\nBlocked now:\n\n  git checkout -- <path>\n  git worktree remove --force\n'@",
    "gh pr create --body @\"\nRun `git restore x` and it reverts.\n\"@",
    "cat <<'EOF' > note.md\ngit checkout -- a.ts is what broke it\nEOF",
    "grep -n 'git add -A' docs/agents/RULES.md",
    "gh issue comment 5 --body 'never run git checkout -- on that file'",
    "node -e \"const p=/git add -A/; console.log(p)\"",
    "gh issue comment 5 --body 'do not use git add -A here'",
    "echo 'find / is slow' > note.txt",
  ]) {
    test(`allows: ${cmd}`, () => {
      assert.equal(check(cmd), null, `expected ${cmd} to be allowed`);
    });
  }
});
