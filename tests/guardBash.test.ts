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
    "grep -n 'git add -A' docs/agents/RULES.md",
    "node -e \"const p=/git add -A/; console.log(p)\"",
    "gh issue comment 5 --body 'do not use git add -A here'",
    "echo 'find / is slow' > note.txt",
  ]) {
    test(`allows: ${cmd}`, () => {
      assert.equal(check(cmd), null, `expected ${cmd} to be allowed`);
    });
  }
});
