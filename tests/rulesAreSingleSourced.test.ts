// tests/rulesAreSingleSourced.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const RULES = "docs/agents/RULES.md";

// Files that instruct an agent. Each may point at a rule; none may restate one.
const INSTRUCTION_FILES = [
  "CLAUDE.md",
  ".claude/commands/queue.md",
  ".claude/commands/triage.md",
  ".claude/commands/wayfinder.md",
  "docs/agents/issue-tracker.md",
  "docs/agents/loops.md",
  "docs/agents/domain.md",
];

/**
 * One phrase per rule, distinctive enough that finding it outside RULES.md means the rule was
 * written down twice. A rule stated in two places drifts, and the copy an agent happens to read
 * is the one that wins — which is how the pipeline ended up with rules in four files.
 */
const RULE_PHRASES: [string, RegExp][] = [
  ["stage by pathspec", /git\s+add\s+-A/i],
  ["never push to main", /never push (it |them )?(straight )?to .?main/i],
  ["Closes #NN in the PR body", /closes #NN/i],
  ["merge, never squash", /--squash/],
  ["one pre-push check", /agent:check.{0,30}before you push/i],
  ["never run the whole sweep locally", /npm run verify/i],
  ["read a file once, whole", /read a file once, whole/i],
  ["prove it red first", /fail before your fix/i],
  ["leave no residue", /leave no residue/i],
  ["remove a worktree with the named command", /never\s+`?git\s+worktree\s+remove/i],
  ["never park a shell in a worktree", /never leave a shell parked/i],
  // Not the rule's own wording: a restatement is a paraphrase, and a pattern
  // cut from the sentence only catches someone quoting it. What any spelling of
  // this rule has to put in one clause is closing (or claiming) and a capture.
  [
    "an iOS report closes on an iOS capture",
    /\b(?:clos|claim)\w*\b[^.\n]{0,60}\bcaptures?\b|\bcaptures?\b[^.\n]{0,60}\b(?:clos|claim)\w*\b/i,
  ],
];

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("every agent rule is written down exactly once", () => {
  test("the ruleset exists and is short enough to be read", () => {
    const body = read(RULES);
    assert.ok(body.length > 0, `${RULES} is missing`);
    const lines = body.split("\n").length;
    assert.ok(lines < 120, `${RULES} is ${lines} lines; a ruleset nobody finishes is not enforced`);
  });

  for (const [name, pattern] of RULE_PHRASES) {
    test(`"${name}" is stated only in ${RULES}`, () => {
      const offenders = INSTRUCTION_FILES.filter((f) => pattern.test(read(f)));
      assert.deepEqual(
        offenders,
        [],
        `${offenders.join(", ")} restates the "${name}" rule. State it once in ${RULES} and ` +
          `point at it by number from here.`
      );
    });
  }

  // CLAUDE.md is loaded every session; queue.md only when the loop runs. That asymmetry is
  // exactly why the loop's procedure kept getting summarised into CLAUDE.md "so it is always
  // there" — and a summary is a second copy that drifts, with the always-loaded one winning.
  // CLAUDE.md may point at the protocol and name the paths an agent must not touch on its own.
  // The steps belong to queue.md alone.
  for (const [name, pattern] of [
    ["how the review is recorded", /VERDICT: LAND/],
    ["where an out-of-scope finding goes", /gh issue create/i],
    ["how the run is recovered", /loop-status\.mjs/],
    ["one ticket at a time", /one ticket at a time/i],
    ["what to preserve when compacting", /failing test output/i],
  ] as [string, RegExp][]) {
    test(`"${name}" is procedure, so it lives in the command file only`, () => {
      assert.equal(
        pattern.test(read("CLAUDE.md")),
        false,
        `CLAUDE.md restates "${name}". It belongs in .claude/commands/queue.md; CLAUDE.md ` +
          `points at that file and stops there.`
      );
      assert.ok(
        pattern.test(read(".claude/commands/queue.md")),
        `neither file states "${name}" any more — it was deleted rather than moved`
      );
    });
  }

  // The floor: with a rule genuinely duplicated, the check above must fail. A pattern that no
  // longer matches its own rule would pass every assertion while enforcing nothing.
  test("each pattern still matches the rule it guards, inside the ruleset", () => {
    const rules = read(RULES);
    const dead = RULE_PHRASES.filter(([, pattern]) => !new RegExp(pattern.source, "i").test(rules));
    assert.deepEqual(
      dead.map(([name]) => name),
      [],
      "these patterns match nothing in the ruleset, so they would never catch a duplicate"
    );
  });

  // The floor for both tests below: a path that no longer resolves reads as an
  // empty file, which is clean under every assertion here. Without this, moving
  // one of these files takes it out of the guard silently.
  test("every instruction file is still where the list says", () => {
    const gone = INSTRUCTION_FILES.filter((f) => !existsSync(f));
    assert.deepEqual(gone, [], `listed but missing: ${gone.join(", ")}`);
  });

  test("instruction files point at the ruleset rather than repeating it", () => {
    // `RULES`, not the bare basename: `docs/RULES.md` is the game's rules spec,
    // and matching it would pass a file that never names the agent ruleset.
    const silent = INSTRUCTION_FILES.filter((f) => !read(f).includes(RULES));
    assert.deepEqual(silent, [], `${silent.join(", ")} never mentions ${RULES}`);
  });
});
