// tests/tooling/rulesAreSingleSourced.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_BY_PHASE } from "../../tools/loop/loop-cost.mjs";

const RULES = "docs/agents/RULES.md";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Files that instruct an agent. Each may point at a rule; none may restate one.
const INSTRUCTION_FILES = [
  "CLAUDE.md",
  ...[".claude/commands", "docs/agents"].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => `${dir}/${name}`)
      .filter((file) => file !== RULES),
  ),
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
  ["a capped read", /read at most \d+ lines per call/i],
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
    ["the loop is one ticket per process", /one ticket per (claude )?process/i],
    ["there is no ticket-count budget", /queue-loop\.mjs/i],
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

  test("queue.md carries no ticket-count budget language", () => {
    // Matches the old mechanic's own phrasing, not the sentence that now declares its absence —
    // "there is no ticket-count budget" would otherwise trip a bare /ticket-count budget/i itself.
    const queue = read(".claude/commands/queue.md");
    const budgetPattern = /max-tickets|budget is spent|budget spent ·/i;
    assert.equal(
      budgetPattern.test(queue),
      false,
      "queue.md still mentions the old ticket-count budget mechanism; Decision 3 replaced it with " +
        "queue-loop.mjs running one ticket per process with no cap"
    );
  });

  test("every ticket is built at opus, whether the loop or a person starts it", () => {
    for (const phase of ["A", "B", "C", "D"] as const) {
      assert.equal(
        MODEL_BY_PHASE[phase],
        "opus",
        `phase ${phase} is planned on ${MODEL_BY_PHASE[phase]}; rule 29 puts implementing at opus. ` +
          "A cheaper builder pushes the tracing into phase D's reviewers."
      );
    }
    const queue = read(".claude/commands/queue.md");
    assert.equal(
      queue.match(/^model:\s*(\S+)/m)?.[1],
      MODEL_BY_PHASE.A,
      "a by-hand /queue gets no --model flag, so the frontmatter is what builds its ticket"
    );
  });

  test("phase A checks loop-status.mjs before the picker, not just somewhere in the doc", () => {
    const queue = read(".claude/commands/queue.md");
    const statusAt = queue.indexOf("loop-status.mjs");
    const pickerAt = queue.indexOf("next-ticket.mjs $ARGUMENTS");
    assert.ok(statusAt >= 0 && pickerAt >= 0, "one of the two commands is missing from queue.md");
    assert.ok(
      statusAt < pickerAt,
      "loop-status.mjs must run before next-ticket.mjs's picker, or a live ticket can be bypassed " +
        "for a fresh pick — see #911/#915"
    );
  });

  test("phase D runs the real two-axis code-review, not a hand-rolled single subagent", () => {
    const queue = read(".claude/commands/queue.md");
    assert.match(queue, /mattpocock-skills:code-review/);
    assert.match(queue, /## Standards.{0,80}## Spec/s);
  });

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
    assert.ok(INSTRUCTION_FILES.length >= 8, `only ${INSTRUCTION_FILES.length} instruction files found`);
    const gone = INSTRUCTION_FILES.filter((f) => !existsSync(f));
    assert.deepEqual(gone, [], `listed but missing: ${gone.join(", ")}`);
  });

  test("instruction files point at the ruleset rather than repeating it", () => {
    // `RULES`, not the bare basename: `docs/GAME-RULES.md` is the game's rules spec,
    // and matching it would pass a file that never names the agent ruleset.
    const silent = INSTRUCTION_FILES.filter((f) => !read(f).includes(RULES));
    assert.deepEqual(silent, [], `${silent.join(", ")} never mentions ${RULES}`);
  });

  // loops.md and TESTING.md said overlapping things about which check catches what; checks.md
  // replaces both. docs/adr and docs/plans are excluded because they are the historical record of
  // decisions already made, including the one that renamed these files — a plan or an ADR quoting
  // the old name is describing the past, not pointing a reader at a file that no longer exists.
  // CLAUDE.md, components/CLAUDE.md and server/CLAUDE.md are excluded because a later, separate
  // task owns their rewrite; the pointers they still carry are handed to that task rather than
  // edited here.
  test("the checks document is one file", () => {
    assert.ok(existsSync(path.join(repoRoot, "docs/agents/checks.md")));
    for (const gone of ["docs/agents/loops.md", "docs/TESTING.md"]) {
      assert.ok(!existsSync(path.join(repoRoot, gone)), `${gone} still exists`);
    }
    // Excludes its own path: this test's source has to name the two gone files to check for
    // them, which is not a reader being pointed at a document that no longer exists.
    const stale = execSync(
      'git grep -l -E "loops\\.md|TESTING\\.md" -- ":!docs/adr" ":!docs/plans" ' +
        '":!tests/tooling/rulesAreSingleSourced.test.ts" ":!CLAUDE.md" ' +
        '":!components/CLAUDE.md" ":!server/CLAUDE.md" || true',
      { cwd: repoRoot, encoding: "utf8" },
    ).trim();
    assert.equal(stale, "", `these still cite a deleted document:\n${stale}`);
  });
});

// docs/ARCHITECTURE.md and the three CLAUDE.md files both state the repo's invariants.
// ARCHITECTURE.md's job is what talks to what; an invariant lives with the code it
// binds. A phrase below is a CLAUDE.md invariant — finding it a second time in
// ARCHITECTURE.md means the two copies can drift, and the file nobody reloads every
// session (ARCHITECTURE.md, unlike CLAUDE.md) is the one that goes quietly wrong.
const FOUR_WAY_FILES = ["CLAUDE.md", "components/CLAUDE.md", "server/CLAUDE.md", "docs/ARCHITECTURE.md"];

// A line wrap turns one source space into a newline, and a reflow can turn one space
// into two — neither changes what the text says. Matching against a raw file let a
// duplicate slip past this check once already (round 1: `Record<keyof typeof en,
// string>` wrapped across a line and every pattern stayed green). Normalizing first —
// collapse whitespace to one space, drop `**` — means a phrase below is checked
// against the words, never against which line they happened to wrap on, so every
// pattern can be the literal phrase with ordinary single spaces.
function normalizeForDupCheck(text: string): string {
  return text.replace(/\*\*/g, " ").replace(/\s+/g, " ").toLowerCase();
}

const ARCHITECTURE_DUP_PHRASES: [string, string][] = [
  ["the hook-before-null-guard order", "every hook runs before `if (!gamestate)`"],
  ["autoMove.ts is the sole bot-move chooser", "chooses a bot's move"],
  ["a winner travels as an engine player id", "every client can map at every moment `game:over` can arrive"],
  ["ticket auth closes the bare handshake.auth.userId vector", "handshake.auth.userid"],
  ["locales/en.ts, it.ts and sq.ts are Record<keyof typeof en, string>", "record<keyof typeof en, string>"],
  [
    "server authority: validates every move, broadcasts sanitized state",
    "validates every move and broadcasts sanitized state",
  ],
  ["the session table's createTableIfMissing: false", "createtableifmissing: false"],
];

describe("docs/ARCHITECTURE.md does not restate a CLAUDE.md invariant", () => {
  for (const [name, phrase] of ARCHITECTURE_DUP_PHRASES) {
    test(`"${name}" is stated in exactly one of ${FOUR_WAY_FILES.join(", ")}`, () => {
      const hits = FOUR_WAY_FILES.filter((f) => normalizeForDupCheck(read(f)).includes(phrase));
      assert.equal(
        hits.length,
        1,
        `"${name}" is stated in ${hits.length === 0 ? "none of the four files" : hits.join(" and ")}; ` +
          `it must live in exactly one — the CLAUDE.md file that owns the rule, never also in ` +
          `docs/ARCHITECTURE.md, which describes what talks to what.`
      );
    });
  }
});
