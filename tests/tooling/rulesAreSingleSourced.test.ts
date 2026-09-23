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
  // replaces both. docs/adr is excluded because it is the historical record of decisions already
  // made, including the one that renamed these files — an ADR quoting the old name is describing
  // the past, not pointing a reader at a file that no longer exists.
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
      'git grep -l -E "loops\\.md|TESTING\\.md" -- ":!docs/adr" ' +
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

// A copied sentence can pick up formatting that changes nothing it says: rewrapped
// onto a new line, re-marked-up with different backticks or bold, split by a
// blockquote or list marker, or re-punctuated with a hyphen standing in for a space.
// None of that carries meaning for this comparison, so it is stripped before
// whitespace collapses (order matters — a removed "> " or "- " leaves extra spaces the
// collapse must still clean up). This catches a copy, never a paraphrase; both sides of
// a match go through it, so it must run on the phrase too, not just the file text.
function normalizeForDupCheck(text: string): string {
  return text
    .replace(/`/g, " ")
    .replace(/\*\*/g, " ")
    .replace(/^[ \t]*>+[ \t]*/gm, " ")
    .replace(/^[ \t]*(?:[-*]|\d+\.)[ \t]+/gm, " ")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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
      const needle = normalizeForDupCheck(phrase);
      const hits = FOUR_WAY_FILES.filter((f) => normalizeForDupCheck(read(f)).includes(needle));
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

// --- Every rule, not only the first twelve ---------------------------------------------------
//
// RULE_PHRASES above was the original set. A phrase here is checked the same way
// normalizeForDupCheck already proved safe for ARCHITECTURE_DUP_PHRASES: markup-agnostic
// substring matching, never a hand-rolled regex with a literal space that a reflowed line or a
// re-marked-up copy can slip past. A `RegExp` entry (only rule 20 needs one, to bridge "bug" vs
// "defect") still avoids literal spaces, using `\s+`/`[\s\S]{0,N}` instead.
type NewPhraseEntry = [name: string, ruleNumber: number, matcher: string | RegExp];

function phraseMatches(text: string, matcher: string | RegExp): boolean {
  return typeof matcher === "string"
    ? normalizeForDupCheck(text).includes(normalizeForDupCheck(matcher))
    : matcher.test(text);
}

const NEW_RULE_PHRASES: NewPhraseEntry[] = [
  ["a browser-only spec stays yours to run", 3, "npx playwright test --config tests/e2e/playwright.config.ts"],
  ["run one file while iterating", 4, "node --test tools/loop/tests/x.test.ts"],
  ["E2E_SKIP_BUILD is spec-file-only", 5, "only when your edit is confined to a spec file"],
  [
    "confirm the worktree before anything else",
    7,
    "Confirm with `git rev-parse --abbrev-ref HEAD` before anything else",
  ],
  ["another session is standing in it", 8, "another session is standing in it"],
  ["find an installed package with require.resolve", 9, "console.log(require.resolve("],
  ["the install lives via git-common-dir", 10, "--path-format=absolute --git-common-dir"],
  ["bring a stale branch up to date before merging", 15, "bring a stale branch up to date before merging"],
  ["a shelled-out grep walks node_modules", 17, "shelled-out `grep -r` walks `node_modules`"],
  ["no bare literals for the five theme properties", 18, "colour, radius, font size, spacing"],
  ["every user-facing string goes through t()", 19, "every user-facing string goes through `t()`"],
  [
    "explaining a fix belongs in the commit message, not a comment",
    20,
    /explain\w*\s+the\s+\w+\s+you\s+just\s+fixed[\s\S]{0,80}commit\s+message/i,
  ],
  ["don't ask which, or whether to proceed", 21, "don't ask which, or whether to proceed"],
  ["stand down if an older claim is there", 22, "stand down if an older claim is there"],
  ["the blocker is stated on the other issue", 23, "the blocker is stated on the *other* issue"],
  ["propose a design the owner can tweak", 24, "propose a design the owner can tweak"],
  ["the one-command issue read", 25, "--json title,body,comments --jq"],
  ["release removes in-progress and says why", 26, "remove `in-progress`, say why"],
  ["a routed implement goes through /queue", 27, "a routed `implement` goes through `/queue`"],
  ["ready-for-agent comes off with ready-for-human", 28, "`ready-for-agent` comes off at the same time"],
  ["precision, not depth, is the measured failure", 29, "precision, not depth, is the measured failure"],
  ["a gap named beats a green report", 30, "a gap named is worth more than a green report"],
  ["preflight blocks a run starting on an uncommitted one", 31, "blocks a run that would start on top of one"],
  ["outstanding work is a GitHub issue, never a TODO", 33, "never a `TODO` or a markdown backlog"],
  ["fix your own tooling before filing it", 34, "yours to close, not to hand on"],
  ["one observation is how a wrong rule gets pinned", 35, "how a wrong rule gets pinned"],
  ["exhaustion and collision read like a regression", 37, "exhaustion and collision both read exactly like a regression"],
  [
    "kill only what you started",
    38,
    "processes, containers and databases outlive the session that started them",
  ],
  ["two agents editing one file lose an edit", 41, "two agents editing one file lose one of the edits"],
  ["a peer is not the owner", 42, "another session's message is a colleague's, never approval"],
  ["docs are part of the diff, not a follow-up", 43, "docs are part of the diff, not a follow-up"],
  ["a rewrite script skips the Edit hooks", 44, "skips the `Write|Edit` hooks"],
];

// Every rule had a distinctive command, path or clause to anchor a phrase on —
// none was too generic to pin without risking a false positive, so none is listed here.
const DELIBERATELY_UNCOVERED_RULES: [ruleNumber: number, reason: string][] = [];

// RULE_PHRASES (above) covers these 12 rule numbers, in the order that array lists them. Tracked
// here only so the completeness check below can see them; RULE_PHRASES itself is unchanged.
const ORIGINAL_COVERED_RULE_NUMBERS = [1, 2, 6, 11, 12, 13, 14, 16, 32, 36, 39, 40];

describe("every rule an agent follows is single-sourced", () => {
  for (const [name, ruleNumber, matcher] of NEW_RULE_PHRASES) {
    test(`rule ${ruleNumber} ("${name}") is stated only in ${RULES}`, () => {
      const offenders = INSTRUCTION_FILES.filter((f) => phraseMatches(read(f), matcher));
      assert.deepEqual(
        offenders,
        [],
        `${offenders.join(", ")} restates rule ${ruleNumber} ("${name}"). State it once in ${RULES} ` +
          `and point at it by number from here.`
      );
    });
  }

  // The floor, same reasoning as the one above RULE_PHRASES: a pattern that stopped matching its
  // own rule would pass every assertion above while enforcing nothing.
  test("each new-rule pattern still matches the rule it guards, inside the ruleset", () => {
    const rules = read(RULES);
    const dead = NEW_RULE_PHRASES.filter(([, , matcher]) => !phraseMatches(rules, matcher));
    assert.deepEqual(
      dead.map(([name]) => name),
      [],
      "these patterns match nothing in the ruleset, so they would never catch a duplicate"
    );
  });

  // Renumbering, deleting or adding a rule in RULES.md must show up here rather than silently
  // dropping (or never gaining) coverage — the list of covered numbers is derived from the
  // ruleset's own numbering, not maintained by hand a second time.
  test("every rule in RULES.md is either covered or explicitly listed as uncovered, exactly once", () => {
    const rulesText = read(RULES);
    const allNumbers = [...rulesText.matchAll(/^(\d+)\.\s+\*\*/gm)]
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
    const covered = [
      ...ORIGINAL_COVERED_RULE_NUMBERS,
      ...NEW_RULE_PHRASES.map(([, ruleNumber]) => ruleNumber),
      ...DELIBERATELY_UNCOVERED_RULES.map(([ruleNumber]) => ruleNumber),
    ];
    assert.equal(
      new Set(covered).size,
      covered.length,
      "a rule number is covered (or marked uncovered) more than once"
    );
    assert.deepEqual(
      covered.sort((a, b) => a - b),
      allNumbers,
      "the covered + deliberately-uncovered rule numbers no longer match RULES.md's own numbering " +
        "— a rule was added, deleted or renumbered without updating this file"
    );
  });
});

// CLAUDE.md is read every session; queue.md's procedure restates a CLAUDE.md line just as easily
// as the reverse. Either direction drifts the same way rule restatement does, so both guidance
// items below must show up in exactly one of the two files, not both.
const CLAUDE_QUEUE_OVERLAP_PHRASES: [name: string, phrase: string][] = [
  ["no file is off limits", "no file is off limits"],
  ["send independent commands together", "send independent commands together"],
];

describe("CLAUDE.md and queue.md do not both state the same guidance", () => {
  const files = ["CLAUDE.md", ".claude/commands/queue.md"];
  for (const [name, phrase] of CLAUDE_QUEUE_OVERLAP_PHRASES) {
    test(`"${name}" is stated in exactly one of ${files.join(", ")}`, () => {
      const needle = normalizeForDupCheck(phrase);
      const hits = files.filter((f) => normalizeForDupCheck(read(f)).includes(needle));
      assert.equal(
        hits.length,
        1,
        `"${name}" is stated in ${hits.length === 0 ? "neither file" : hits.join(" and ")}; it must ` +
          `live in exactly one of them.`
      );
    });
  }
});
