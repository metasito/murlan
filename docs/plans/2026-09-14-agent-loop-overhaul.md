# Agent Loop Overhaul — Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the loop's measured $19.89 per ticket by moving spend off the phase that produces least, and make the comment rule a boundary instead of a sentence.

**Architecture:** Five changes, each independently revertable, none moving orchestration. One comment classifier serves both the write-time deny hook and the CI-time budget, so the rule cannot mean two things. A measurement instrument lands first-class, because this plan's central assumption is an estimate and has to be falsifiable.

**Tech Stack:** Node 24 under the loader constraint `docs/agents/loops.md` states, `node --test`, Claude Code `PreToolUse` hooks, `gh` CLI.

**Spec:** `docs/research/2026-09-14-agent-loop-overhaul.md`

**Scope:** Stage 1 only. Stage 2 — moving phases A/E/F out of the model and phase D's orchestration out of the session — gets its own plan, written from the numbers Task 6 produces. Writing its steps now would mean guessing at what Task 6 is there to measure.

## Global Constraints

- **Windows/PowerShell 5.1, non-UTF-8 default.** Any file a non-PowerShell tool consumes is written strict UTF-8 without BOM: `[IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))`. Multiline GitHub bodies go through such a file plus `--body-file`, never inline `--body`.
- **Files go through Write/Edit/Read**, never batch shell rewrites. Bash runs commands.
- **`docs/agents/RULES.md` is the ruleset.** Rule 8: never change the shared checkout's branch. Rule 11: stage by pathspec, never `git add -A`. Rule 12: never push to `main`. Rule 14: merge `--merge --delete-branch`, never `--squash`. Rule 39: never `git worktree remove` or `rm -rf` a worktree.
- **No self-defeating safeguards** (CLAUDE.md): "If a safeguard can be satisfied without the thing it guards being true, it is worse than none." Every check added here states what it cannot see and names what covers that gap.
- **Comments** (CLAUDE.md): default is no comment. Never restate the line below, never any history of what the code was, never explain the defect just fixed.
- **No new npm dependencies.** A dependency change passes locally and fails every CI job, because `npm ci` obeys the lockfile while a worktree's `node_modules` may be a junction to the shared install.
- **Every commit ends with:**
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018NQgF89rmjUZMFgK5phKPb
  ```
- **After every task:** `npm run loop:test && npx tsc --noEmit && npx eslint tools/loop`.

---

## The measurement this plan argues from

Twenty tickets in `.loop-logs` carrying phase markers; $397.89 of real `total_cost_usd`. This is
`npm run loop:cost`'s own output (Task 4) — the executor should reproduce it exactly before trusting
anything below it.

| Phase | Model today | Turns | Input tok | $/ticket | Share | Median min |
|---|---|---|---|---|---|---|
| pre | Opus 5 (main session) | 374 | 22.0M | $0.67 | 3% | — |
| A claim | Opus 5 (main session) | 298 | 12.5M | $0.53 | 3% | 1.2 |
| B scope | Sonnet 5 subagent | 500 | 29.0M | $0.64 | 3% | 3.3 |
| C build | Opus 5 (main session) | 1,293 | 118.1M | $2.48 | 12% | 8.0 |
| **D review** | **Opus 5 ×2 subagents** | **6,174** | **609.8M** | **$14.37** | **72%** | **34.3** |
| E push | Opus 5 (main session) | 206 | 39.2M | $0.69 | 3% | 1.9 |
| F close | Opus 5 (main session) | 156 | 29.5M | $0.51 | 3% | 0.8 |

Per ticket: **$19.89 mean, $20.36 median, 4 review rounds median.** Two wall-clock figures, because
they answer different questions: the phase medians sum to **49.5 min** of time inside a phase, while
first-to-last on a ticket is **60 min** — the gap is start-up and the time between phases, which no
phase is charged for. Round-3 and round-4 agent pairs are nearly as frequent as round-2 (24 and 23
spawns against 35). Within phase D, **$8.70 is the session watching and $5.72 is the reviewers**.
Median 7-day subscription-window consumption: **2.0% per ticket**.

**The weakest number here is the assumption that rounds fall from 4 to ~2.5.** It carries most of the projected saving and it is an estimate. Task 6 exists to make it falsifiable.

## File Structure

| File | Responsibility |
|---|---|
| `tools/loop/commentShape.ts` **(new)** | The only place this repo decides "is this line a comment" and "is this too much prose". Pure: no I/O, no git, no process. Both enforcers import it. |
| `tools/loop/guard-comments.mjs` **(new)** | The `PreToolUse` deny. Reads the payload, asks `commentShape`, emits the deny. All judgement lives upstream of it. |
| `tools/loop/loop-cost.mjs` **(new)** | Reads `.loop-logs/*.jsonl`, reports cost and rounds by phase. The instrument every claim in this plan is checked against. |
| `tools/loop/comment-budget.mjs` | Keeps its multiset diff; **deletes its own `classify`** and imports the shared one. |
| `.claude/settings.json` | Registers the new hook beside `hint-test-traps.mjs`. |
| `tools/loop/queue-loop.mjs` | One env key on the spawned session. |
| `.claude/commands/queue.md` | Phase D's tier, brief and refutation pass. |

---

## Task 1: One comment classifier, used by both enforcers

The rule the owner has restated more than any other. It becomes one module with tests, imported by the write-time hook and the CI-time budget, so the two cannot drift.

**Two detectors, not three.** CLAUDE.md forbids restating the line below, but that detector is the one most likely to deny a legitimate write, and a false deny stops an unattended ticket. The budget catches the practical case by ratio, so the hook enforces only what it can enforce without guessing: **history** and **ratio**.

**Files:**
- Create: `tools/loop/commentShape.ts`
- Modify: `tools/loop/comment-budget.mjs`
- Test: `tools/loop/tests/commentShape.test.ts`, `tools/loop/tests/commentBudget.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Line = { n: number; text: string; kind: "comment" | "code" | "blank" };
  export type Violation = { rule: "history" | "ratio"; line: number; text: string; why: string };
  export const ARCHEOLOGY: string[];                   // plain phrases; HISTORY is built from it
  export const HISTORY: RegExp;
  export function classify(text: string): Line[];      // text is trimmed; strings are blanked first
  export function floorFor(path: string): number;      // 6 for source, 3 for tests
  export function violations(text: string, path: string): Violation[];
  ```
- `comment-budget.mjs` keeps `addedCounts(before, after)` and `budget(base)`; `over` gains a path: `over(added, path)`.

- [ ] **Step 1: Write the failing test**

Create `tools/loop/tests/commentShape.test.ts`:

```ts
// tools/loop/tests/commentShape.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ARCHEOLOGY, HISTORY, classify, floorFor, violations } from "../commentShape.ts";

const kinds = (text: string) => classify(text).map((l) => l.kind);
const rules = (text: string, path = "src/x.ts") => violations(text, path).map((v) => v.rule);

describe("classify", () => {
  test("names each line comment, code or blank", () => {
    assert.deepEqual(kinds(["// why", "const x = 1;", "", "let y;"].join("\n")), ["comment", "code", "blank", "code"]);
  });

  test("a block comment is comment to its closing line, blank interior included", () => {
    assert.deepEqual(kinds(["/**", " * why.", "", " */", "const x = 1;"].join("\n")),
      ["comment", "comment", "comment", "comment", "code"]);
  });

  test("a one-line block comment does not open a block", () => {
    assert.deepEqual(kinds(["/* why */", "const x = 1;"].join("\n")), ["comment", "code"]);
  });

  test("comment syntax inside a string is code", () => {
    assert.deepEqual(kinds(`const s = "// not a comment";`), ["code"]);
    assert.deepEqual(kinds("const s = '/* nor this */';"), ["code"]);
  });

  /**
   * The guard must not refuse the file that defines it. Its own phrase list and these very cases are
   * `//` inside string literals, so a classifier blind to strings would make its tests unwritable.
   */
  test("a quoted example of a forbidden comment is code, not a forbidden comment", () => {
    assert.deepEqual(rules(`const bad = "// previously this returned null";`), []);
  });

  test("a string holding a block opener does not open a block", () => {
    assert.deepEqual(kinds([`const s = "/*";`, "const x = 1;"].join("\n")), ["code", "code"]);
  });

  /** Known limit, pinned so it is a boundary and not a surprise. See `blankStrings`. */
  test("a line inside a multi-line template literal can read as a comment", () => {
    assert.deepEqual(kinds(["const s = `", "// inside a template", "`;"].join("\n")), ["code", "comment", "code"]);
  });

  test("text is trimmed, and the line number is one-based", () => {
    assert.deepEqual(classify("\n   const x = 1;")[1], { n: 2, text: "const x = 1;", kind: "code" });
  });
});

describe("the archeology list", () => {
  test("every phrase in it is one the rule actually catches", () => {
    for (const phrase of ARCHEOLOGY) {
      assert.ok(HISTORY.test(`// ${phrase} something`), `"${phrase}" is in the list but matches nothing`);
    }
  });

  test("holds plain phrases, so one entry cannot reshape the pattern", () => {
    for (const phrase of ARCHEOLOGY) {
      assert.doesNotMatch(phrase, /[\\^$.|?*+()[\]{}]/, `"${phrase}" carries a regex metacharacter`);
    }
  });
});

describe("the history rule", () => {
  for (const line of [
    "// previously this returned null",
    "// this used to call the old helper",
    "/* the bug was that the socket closed early */",
    "// we now read the window's short edge",
    "// renamed from checkoutRoot",
    "// no longer needed after the rewrite",
  ]) {
    test(`flags ${JSON.stringify(line)}`, () => {
      assert.deepEqual(rules([line, "const x = 1;"].join("\n")), ["history"]);
    });
  }

  for (const line of [
    "// the socket is no longer connected once the handshake fails",
    "// iOS does not paint in tree order, so the layer is stated",
    "// Reading, not Motion: this is how long a banner stays legible",
    "// the server validates every move before it broadcasts",
  ]) {
    test(`leaves ${JSON.stringify(line)} alone`, () => {
      assert.deepEqual(rules([line, "const x = 1;"].join("\n")), []);
    });
  }
});

describe("the ratio rule", () => {
  const prose = (n: number) => Array.from({ length: n }, (_, i) => `// line ${i} of prose`);

  test("more comment than code, above the floor", () => {
    assert.deepEqual(rules([...prose(8), "const x = 1;"].join("\n")), ["ratio"]);
  });

  test("a long docblock over a long function is not a violation", () => {
    const code = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`);
    assert.deepEqual(rules([...prose(8), ...code].join("\n")), []);
  });

  test("a handful of comments on a small change is not a ratio worth policing", () => {
    assert.deepEqual(rules([...prose(3), "const x = 1;"].join("\n")), []);
  });

  test("blank lines count as neither, in either column", () => {
    assert.deepEqual(rules([...prose(4), "", "", "const x = 1;"].join("\n")), []);
  });

  test("a blank line inside a block comment is comment, not a discount on it", () => {
    const block = ["/**", ...Array.from({ length: 6 }, () => " * prose."), "", " */", "const x = 1;"];
    assert.deepEqual(rules(block.join("\n")), ["ratio"]);
  });

  test("a test file gets the tighter floor", () => {
    const text = [...prose(4), "const x = 1;"].join("\n");
    assert.deepEqual(rules(text, "src/x.ts"), []);
    assert.deepEqual(rules(text, "tools/loop/tests/x.test.ts"), ["ratio"]);
  });

  test("floorFor names the two budgets", () => {
    assert.equal(floorFor("src/x.ts"), 6);
    assert.equal(floorFor("tools/loop/tests/x.test.ts"), 3);
    assert.equal(floorFor("tests/native/Hand.test.tsx"), 3);
  });
});

/**
 * It reads one write. A comment arriving any other way is `comment-budget.mjs`'s to catch from
 * committed bytes — which is what keeps the pair from being a guard that passes by not looking.
 */
test("code alone is clean", () => {
  assert.deepEqual(rules("const x = 1;"), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run loop:test`
Expected: FAIL — `Cannot find module '../commentShape.ts'`

- [ ] **Step 3: Write the implementation**

Create `tools/loop/commentShape.ts`:

```ts
/**
 * CLAUDE.md's comment rules as a check rather than a paragraph, and the only place this repo
 * decides what a comment line is — `comment-budget.mjs` and the write-time hook both read it here,
 * so the rule cannot come to mean two things.
 *
 * Two detectors, both narrow: this feeds a `PreToolUse` deny, and a false positive stops an
 * unattended ticket. "Restates the line below" is deliberately absent — it is the one that cannot
 * be decided without guessing, and the ratio arm covers its practical case.
 *
 * `history` is a property of a line and is never wrong about a fragment. `ratio` is a property of a
 * *file*, so a caller holding only part of one reports the first and leaves the second to whoever
 * can see the whole.
 */

export type Line = { n: number; text: string; kind: "comment" | "code" | "blank" };
export type Violation = { rule: "history" | "ratio"; line: number; text: string; why: string };

/**
 * Each phrase names the code's own past, which is the one thing a comment may never do. Anchored on
 * the subject rather than the verb: "no longer" alone is ordinary prose about runtime state, so every
 * entry carries the word that makes it archeology rather than description.
 *
 * Plain phrases, never patterns — the test asserts both that each one is caught and that none holds
 * a regex metacharacter, so a phrase cannot be added that silently matches nothing or everything.
 */
export const ARCHEOLOGY = [
  "previously", "formerly", "renamed from", "moved from", "was changed to", "instead of the old",
  "legacy behavior", "legacy behaviour",
  "used to be", "used to have", "used to return", "used to call", "used to live",
  "this used to", "this was formerly",
  "before this fix", "before this change", "before this commit",
  "the bug was", "the defect was", "the issue was",
  "we now", "we changed", "we switched", "we renamed",
  "no longer needed", "no longer used", "no longer necessary", "no longer required",
  "as of this commit", "as of this change", "as of this fix",
];

export const HISTORY = new RegExp(`\\b(${ARCHEOLOGY.join("|")})\\b`, "i");

const TEST_PATH = /(^|[\\/])tests?[\\/]|\.(test|spec)\.[jt]sx?$/;

/** A test's own description says what it covers, so its prose budget is tighter than source's. */
export function floorFor(path: string): number {
  return TEST_PATH.test(path) ? 3 : 6;
}

/**
 * A comment marker inside a string literal is not a comment. This is what lets a file *about* the
 * comment rules be written at all — its examples are string literals holding `//`, and without this
 * the guard would refuse every edit to its own tests.
 *
 * Known limit: a template literal spanning lines is unterminated on each of them, so a `//` opening
 * a line inside one reads as a comment. Pinned by a test rather than fixed — tracking template state
 * costs more than the case is worth, and `comment-budget.mjs` judges committed bytes either way.
 */
const blankStrings = (line: string) => line.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

export function classify(text: string): Line[] {
  const out: Line[] = [];
  let block = false;
  text.split("\n").forEach((raw, i) => {
    const line = blankStrings(raw).trim();
    const at = { n: i + 1, text: raw.trim() };
    if (block) {
      out.push({ ...at, kind: "comment" });
      if (line.includes("*/")) block = false;
    } else if (!line) {
      out.push({ ...at, kind: "blank" });
    } else if (line.startsWith("//")) {
      out.push({ ...at, kind: "comment" });
    } else if (line.startsWith("/*")) {
      out.push({ ...at, kind: "comment" });
      block = !line.includes("*/", 2);
    } else {
      out.push({ ...at, kind: "code" });
    }
  });
  return out;
}

export function violations(text: string, path: string): Violation[] {
  const lines = classify(text);
  const comments = lines.filter((l) => l.kind === "comment");
  const code = lines.filter((l) => l.kind === "code").length;

  const found: Violation[] = comments
    .filter((c) => HISTORY.test(c.text))
    .map((c) => ({
      rule: "history" as const,
      line: c.n,
      text: c.text,
      why: "CLAUDE.md: never any history of what the code was. That belongs in the commit message.",
    }));

  const floor = floorFor(path);
  if (comments.length > floor && comments.length > code) {
    found.push({
      rule: "ratio",
      line: comments[0].n,
      text: `${comments.length} comment lines to ${code} of code`,
      why: "CLAUDE.md: a change adding more comment lines than code is explaining itself instead of being clear.",
    });
  }
  return found;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run loop:test`
Expected: the new file PASSes. `commentBudget.test.ts` still passes — nothing has changed there yet.

- [ ] **Step 5: Point `comment-budget.mjs` at the shared classifier**

In `tools/loop/comment-budget.mjs`: delete the local `function* classify(text)` entirely, import the shared one, and rewrite `addedCounts`'s two loops to skip blanks. Its multiset logic is untouched.

```js
import { classify, floorFor } from "./commentShape.ts";
```

```js
export function addedCounts(before, after) {
  const pool = new Map();
  for (const { text, kind } of classify(before)) {
    if (kind === "blank") continue;
    const k = key(text, kind === "comment");
    pool.set(k, (pool.get(k) ?? 0) + 1);
  }
  let comment = 0;
  let code = 0;
  for (const { text, kind } of classify(after)) {
    if (kind === "blank") continue;
    const k = key(text, kind === "comment");
    const held = pool.get(k) ?? 0;
    if (held) {
      pool.set(k, held - 1);
      continue;
    }
    if (kind === "comment") comment += 1;
    else code += 1;
  }
  return { comment, code };
}
```

Then replace `FLOOR` and `over`:

```js
/**
 * A change with no code at all cannot be judged by ratio — `comment > code` is true at one line —
 * so the floor is the whole check there, and it is a lower one.
 */
const PROSE_ONLY_FLOOR = 2;

export function over(added, path) {
  const floor = added.code === 0 ? PROSE_ONLY_FLOOR : floorFor(path);
  return added.comment > floor && added.comment > added.code;
}
```

And in `budget()`, pass the path: `if (over(added, file)) named.push([file, added]);`

- [ ] **Step 6: Add the budget's new cases**

Add to `tools/loop/tests/commentBudget.test.ts`:

```ts
describe("the budget's floors", () => {
  test("a comment-only change cannot be saved by the ratio arm", () => {
    assert.equal(over({ comment: 4, code: 0 }, "src/x.ts"), true);
  });

  test("a one-line comment-only change still passes", () => {
    assert.equal(over({ comment: 1, code: 0 }, "src/x.ts"), false);
  });

  test("a test file gets the tighter floor", () => {
    assert.equal(over({ comment: 4, code: 2 }, "src/x.ts"), false);
    assert.equal(over({ comment: 4, code: 2 }, "tools/loop/tests/x.test.ts"), true);
  });

  test("source keeps the floor it had", () => {
    assert.equal(over({ comment: 6, code: 2 }, "src/x.ts"), false);
    assert.equal(over({ comment: 7, code: 2 }, "src/x.ts"), true);
  });

  test("a comment marker inside a string was never a comment", () => {
    assert.deepEqual(addedCounts("", `const s = "// x";`), { comment: 0, code: 1 });
  });
});
```

- [ ] **Step 7: Run the full suite**

Run: `npm run loop:test && npm run check:comments`
Expected: PASS.

**If an existing `commentBudget` test fails on the string case**, it was pinning the old string-blind classification. That was a defect, not a contract — update the test and say so in the commit body, not in a comment.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npx eslint tools/loop
git add tools/loop/commentShape.ts tools/loop/comment-budget.mjs tools/loop/tests/commentShape.test.ts tools/loop/tests/commentBudget.test.ts
git commit -m "Decide what a comment is in one place, and give a prose-only change its own floor"
```

---

## Task 2: Refuse the write

`PreToolUse` fires before any permission-mode check, in every permission mode including `bypassPermissions`, and runs for subagents' tool calls. It is the only mechanism here that stops a comment being written rather than reporting it afterwards.

**Files:**
- Create: `tools/loop/guard-comments.mjs`
- Modify: `.claude/settings.json`
- Test: `tools/loop/tests/guardComments.test.ts`

**Interfaces:**
- Consumes: `violations(text, path)` from `tools/loop/commentShape.ts` (Task 1).
- Produces: `export function decide(payload): { deny: false } | { deny: true, reason: string }`

- [ ] **Step 1: Write the failing test**

Create `tools/loop/tests/guardComments.test.ts`:

```ts
// tools/loop/tests/guardComments.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../guard-comments.mjs";

const write = (content: string, file_path = "src/x.ts") =>
  ({ tool_name: "Write", tool_input: { file_path, content } }) as never;
const edit = (new_string: string, file_path = "src/x.ts") =>
  ({ tool_name: "Edit", tool_input: { file_path, old_string: "", new_string } }) as never;

describe("decide", () => {
  test("a clean write passes", () => {
    assert.deepEqual(decide(write("const x = 1;")), { deny: false });
  });

  test("a history comment is denied, and the reason quotes the line", () => {
    const out = decide(write(["// previously this returned null", "const x = 1;"].join("\n")));
    assert.equal(out.deny, true);
    assert.match(out.reason ?? "", /previously this returned null/);
    assert.match(out.reason ?? "", /commit message/);
  });

  test("an Edit is judged on new_string, which is the text being added", () => {
    assert.equal(decide(edit(["// we now read the short edge", "const x = 1;"].join("\n"))).deny, true);
  });

  /**
   * A fragment has no ratio. A docblock added above an existing function is all comment and no code,
   * and is exactly what CLAUDE.md's four exceptions allow — denying it would teach the model to
   * write worse comments, not fewer.
   */
  test("an Edit adding only a docblock is not denied for its ratio", () => {
    const block = ["/**", ...Array.from({ length: 8 }, () => " * an invariant the types cannot carry."), " */"];
    assert.deepEqual(decide(edit(block.join("\n"))), { deny: false });
  });

  test("the same text written as a whole file is denied", () => {
    const block = ["/**", ...Array.from({ length: 8 }, () => " * prose."), " */", "const x = 1;"];
    assert.equal(decide(write(block.join("\n"))).deny, true);
  });

  test("an Edit still cannot smuggle history in", () => {
    assert.equal(decide(edit("// previously this returned null")).deny, true);
  });

  test("every violation is reported, not just the first", () => {
    const out = decide(write(["// previously null", "// we now return 1", "const x = 1;"].join("\n")));
    assert.match(out.reason ?? "", /previously null/);
    assert.match(out.reason ?? "", /we now return 1/);
  });

  test("a tool this hook does not judge passes untouched", () => {
    assert.deepEqual(decide({ tool_name: "Read", tool_input: { file_path: "src/x.ts" } } as never), { deny: false });
  });

  test("a file type with no comments of this shape passes", () => {
    assert.deepEqual(decide(write("# previously this was yaml", "docs/x.md")), { deny: false });
  });

  test("a malformed payload never disturbs the tool call", () => {
    for (const bad of [null, {}, { tool_name: "Write" }, { tool_name: "Write", tool_input: {} },
                       { tool_name: "Write", tool_input: { file_path: "src/x.ts", content: 7 } }]) {
      assert.deepEqual(decide(bad as never), { deny: false });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run loop:test`
Expected: FAIL — `Cannot find module '../guard-comments.mjs'`

- [ ] **Step 3: Write the implementation**

Create `tools/loop/guard-comments.mjs`:

```js
/**
 * PreToolUse deny for Write/Edit. CLAUDE.md's comment rules are documented as advisory, and 26% of
 * this repo's line churn is comments — the measurement saying advisory did not hold.
 *
 * Denies with a reason the model is shown, so it rewrites the edit rather than losing the turn. It
 * sees one write; `comment-budget.mjs` reads committed bytes in CI and covers every other route in.
 */
import { readFileSync } from "node:fs";
import { violations } from "./commentShape.ts";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const JUDGED = /\.(mjs|cjs|js|jsx|ts|tsx)$/;

export function decide(payload) {
  const input = payload?.tool_input;
  if (!input?.file_path || !JUDGED.test(input.file_path)) return { deny: false };

  // A Write carries the whole file; an Edit carries a fragment, and a fragment has no ratio — a
  // docblock added above an existing function is all comment and no code, and is exactly what
  // CLAUDE.md's four exceptions allow. The file's ratio is `comment-budget.mjs`'s to judge.
  const whole = payload.tool_name === "Write";
  const text = whole ? input.content : input.new_string;
  if (typeof text !== "string" || !text) return { deny: false };

  const found = violations(text, input.file_path).filter((v) => whole || v.rule === "history");
  if (!found.length) return { deny: false };

  const said = found.map((v) => `  line ${v.line}: ${v.text}\n    ${v.why}`).join("\n");
  return { deny: true, reason: `This write breaks CLAUDE.md's comment rules. Rewrite without them:\n${said}` };
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  let payload = null;
  try {
    payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.exit(0); // an unreadable payload must never disturb a tool call
  }
  const out = decide(payload);
  if (out.deny) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: out.reason,
        },
      })
    );
  }
  process.exit(0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run loop:test`
Expected: PASS.

- [ ] **Step 5: Register the hook**

In `.claude/settings.json`, add a second entry to the existing `Write|Edit` matcher's `hooks` array. Sibling hooks all run and the most restrictive answer wins, so the trap hint still prints on a write this one denies:

```json
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node tools/loop/hint-test-traps.mjs"
          },
          {
            "type": "command",
            "command": "node tools/loop/guard-comments.mjs"
          }
        ]
      }
```

- [ ] **Step 6: Verify end to end**

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"src/x.ts","content":"// previously this returned null\nconst x = 1;"}}' | node tools/loop/guard-comments.mjs
```
Expected: JSON carrying `"permissionDecision":"deny"` and the quoted line.

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"src/x.ts","content":"const x = 1;"}}' | node tools/loop/guard-comments.mjs
```
Expected: no output, exit 0.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npx eslint tools/loop
git add tools/loop/guard-comments.mjs tools/loop/tests/guardComments.test.ts .claude/settings.json
git commit -m "Refuse a write carrying the comments CLAUDE.md forbids, rather than reporting them after"
```

---

## Task 3: Delete the polling

Forty-four of 150 agent invocations are `Waiting.` turns. The cause is a default, not a prompt: `-p` leaves fork mode off, subagents then default to background, and asking a background subagent about its progress is documented to answer "still running".

The env var also removes a silent failure — `claude -p` drops a background subagent still running at a 10-minute idle wait ceiling, discarding its partial result.

**Files:**
- Modify: `tools/loop/queue-loop.mjs` (the spawn's `env`)
- Test: `tools/loop/tests/queueLoop.test.ts`

**Interfaces:** none new. The spawn's `env` gains one key.

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe("runTicket", …)` block in `tools/loop/tests/queueLoop.test.ts`, so it has `opts`, `RESULT` and the file's helpers in scope. It mirrors `fakeSpawn` but keeps the options it was handed:

```ts
  test("subagents run in the foreground, so a poll turn is unreachable", async () => {
    let env: Record<string, string> | undefined;
    const capturing = (_cmd: string, _args: string[], o: any) => {
      env = o.env;
      const child: any = new EventEmitter();
      child.stdout = Readable.from([`${RESULT}\n`]);
      child.stderr = Readable.from([]);
      child.stdout.on("end", () => setImmediate(() => child.emit("close", 0)));
      return child;
    };
    await runTicket(capturing as never, opts());
    assert.equal(
      env?.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS,
      "1",
      "without it `-p` leaves fork mode off, subagents default to background, and the session polls them",
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run loop:test`
Expected: FAIL — `expected undefined to equal '1'`

- [ ] **Step 3: Write the implementation**

In `tools/loop/queue-loop.mjs`, at the spawn's `env`:

```js
    env: {
      ...process.env,
      DISABLE_AUTOUPDATER: "1",
      LOOP_TURNS: String(budget),
      // `-p` leaves fork mode off, so subagents default to background and the session spends a turn
      // each time it asks one whether it is done. Foreground makes the Agent call an await.
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run loop:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/loop/queue-loop.mjs tools/loop/tests/queueLoop.test.ts
git commit -m "Run the session's subagents in the foreground, so the Agent call is an await"
```

---

## Task 4: The measurement instrument

Everything after this is justified by numbers, and this produces them. Without it the Task 6 gate is a sentence, and a gate that cannot fail is worse than none.

**Files:**
- Create: `tools/loop/loop-cost.mjs`
- Modify: `package.json`
- Test: `tools/loop/tests/loopCost.test.ts`

**Interfaces:**
- Produces:
  ```js
  export const PRICE: Record<string, [number, number, number, number]>;  // in, cache write, cache read, out
  export function readTicket(lines: string[], ticket?: string): {
    ticket: string, usd: number, minutes: number, rounds: number,
    phases: Record<string, { turns: number, tokens: number, usd: number, minutes: number }>
  };
  export function report(tickets): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `tools/loop/tests/loopCost.test.ts`:

```ts
// tools/loop/tests/loopCost.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readTicket } from "../loop-cost.mjs";

const at = (min: number) => new Date(Date.UTC(2026, 8, 14, 10, min)).toISOString();
const say = (text: string, min: number, model = "claude-opus-5", parent: string | null = null) =>
  JSON.stringify({
    type: "assistant", timestamp: at(min), parent_tool_use_id: parent,
    message: { model, content: [{ type: "text", text }], usage: { cache_read_input_tokens: 1e6 } },
  });
const result = (usd: number, session = "s1") =>
  JSON.stringify({ type: "result", session_id: session, total_cost_usd: usd });
const spawn = (description: string) =>
  JSON.stringify({ type: "system", subtype: "task_started", task_type: "local_agent", description });

describe("readTicket", () => {
  test("attributes turns to the phase marker preceding them", () => {
    const t = readTicket([say("PHASE A", 0), say("claiming", 1), say("PHASE C", 2), say("building", 8)]);
    assert.equal(t.phases.A.turns, 2);
    assert.equal(t.phases.C.turns, 2);
  });

  test("a phase's minutes run from its marker to the next", () => {
    const t = readTicket([say("PHASE A", 0), say("PHASE C", 5), say("done", 20)]);
    assert.equal(t.phases.A.minutes, 5);
    assert.equal(t.phases.C.minutes, 15);
  });

  test("a subagent turn never moves the phase, because it emits no marker", () => {
    const t = readTicket([say("PHASE D", 0), say("PHASE A", 1, "claude-sonnet-5", "toolu_1"), say("x", 2)]);
    assert.equal(t.phases.D.turns, 3);
    assert.equal(t.phases.A, undefined);
  });

  test("total_cost_usd is cumulative per session, so it is maxed and not summed", () => {
    assert.equal(
      readTicket([result(5, "s1"), result(11, "s1"), result(4, "s2")]).usd,
      15,
      "11 for s1 plus 4 for s2 — summing s1's two records would say 20",
    );
  });

  test("counts a review round per pair of review subagents", () => {
    assert.equal(readTicket([spawn("Spec review round 2"), spawn("Standards review round 2"), spawn("Recon issue 5")]).rounds, 1);
  });

  test("prices each turn at its own model's rate", () => {
    const opus = readTicket([say("PHASE D", 0)]).phases.D.usd;
    const sonnet = readTicket([say("PHASE D", 0, "claude-sonnet-5")]).phases.D.usd;
    assert.equal(Math.round((sonnet / opus) * 10) / 10, 0.4);
  });

  test("a log with no phase markers is reported, not dropped", () => {
    const t = readTicket([say("no marker here", 0), result(3)]);
    assert.equal(t.usd, 3);
    assert.equal(t.phases.pre.turns, 1);
  });

  test("an unparsable line is skipped rather than taking the report down", () => {
    assert.equal(readTicket(["{not json", say("PHASE A", 0)]).phases.A.turns, 1);
  });

  /** Taking `at = null` from an unstamped record loses the interval either side of it. */
  test("a record with no timestamp does not reset the phase clock", () => {
    const unstamped = JSON.stringify({ type: "assistant", message: { model: "claude-opus-5", content: [], usage: {} } });
    const t = readTicket([say("PHASE C", 0), unstamped, say("done", 10)]);
    assert.equal(t.phases.C.minutes, 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run loop:test`
Expected: FAIL — `Cannot find module '../loop-cost.mjs'`

- [ ] **Step 3: Write the implementation**

Create `tools/loop/loop-cost.mjs`. The phase regex must match `loop-stream.mjs`'s:

```js
/**
 * What the loop spends, by phase, from `.loop-logs`. Every cost claim about the loop is checked
 * here or is an assertion.
 *
 * `total_cost_usd` on a `result` record is cumulative for its `session_id`: a ticket's spend is the
 * max per session, summed across sessions. Summing the records double-counts, by a lot.
 *
 * Usage: node tools/loop/loop-cost.mjs [ticket]
 */
import { readFileSync, readdirSync } from "node:fs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const PHASE = /^[ \t]*`?PHASE ([A-G])`?[ \t]*$/m;
const REVIEW = /\b(spec|standards) review\b/i;
const ORDER = ["pre", "A", "B", "C", "D", "E", "F", "G"];

/** $/MTok: base input, cache write, cache read, output. */
export const PRICE = {
  "claude-opus-5": [5, 6.25, 0.5, 25],
  "claude-sonnet-5": [2, 2.5, 0.2, 10],
  "claude-haiku-4-5-20251001": [1, 1.25, 0.1, 5],
};

const priceOf = (model, u) => {
  const [i, w, r, o] = PRICE[model] ?? PRICE["claude-opus-5"];
  return (
    ((u.input_tokens ?? 0) * i + (u.cache_creation_input_tokens ?? 0) * w +
      (u.cache_read_input_tokens ?? 0) * r + (u.output_tokens ?? 0) * o) / 1e6
  );
};

const bucket = () => ({ turns: 0, tokens: 0, usd: 0, minutes: 0 });

export function readTicket(lines, ticket = "") {
  const phases = {};
  const sessions = new Map();
  let phase = "pre";
  let at = null;
  let first = null;
  let last = null;
  let reviewers = 0;

  /**
   * Charges the open phase for the time since the last stamped record, then moves to `to`. A record
   * with no timestamp must not move the clock: taking `at = null` from one would make the next
   * stamped turn uncountable and lose the interval either side of it.
   */
  const advance = (to, t) => {
    if (t !== null) {
      if (at !== null) (phases[phase] ??= bucket()).minutes += (t - at) / 6e4;
      at = t;
    }
    phase = to;
  };

  for (const line of lines) {
    if (!line) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }

    const t = j.timestamp ? Date.parse(j.timestamp) : null;
    if (t) { first ??= t; last = t; }

    if (j.type === "system" && j.subtype === "task_started" && j.task_type === "local_agent") {
      if (REVIEW.test(j.description ?? "")) reviewers++;
      continue;
    }
    if (j.type === "result" && j.session_id) {
      sessions.set(j.session_id, Math.max(sessions.get(j.session_id) ?? 0, j.total_cost_usd ?? 0));
      continue;
    }
    if (j.type !== "assistant" || !j.message?.usage) continue;

    // Main-session only: a subagent emits no marker, and its text quoting a phase would otherwise
    // reassign every turn after it.
    if (!j.parent_tool_use_id) {
      for (const b of j.message.content ?? []) {
        if (b.type !== "text") continue;
        const m = PHASE.exec(b.text ?? "");
        if (m) advance(m[1], t);
      }
    }

    const u = j.message.usage;
    const row = (phases[phase] ??= bucket());
    row.turns++;
    row.tokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    row.usd += priceOf(j.message.model ?? "", u);
    advance(phase, t);
  }

  return {
    ticket,
    usd: [...sessions.values()].reduce((a, b) => a + b, 0),
    minutes: first && last ? (last - first) / 6e4 : 0,
    rounds: Math.floor(reviewers / 2),
    phases,
  };
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;

export function report(tickets) {
  const done = tickets.filter((t) => t.usd > 0);
  if (!done.length) return "loop-cost: no priced tickets in .loop-logs";

  // Per-phase dollars are priced from usage records; the ticket total is Anthropic's own. The
  // shares are trustworthy where the absolutes are not, so scale the shares onto the total.
  const reported = done.reduce((a, t) => a + t.usd, 0);
  const priced = done.reduce((a, t) => a + Object.values(t.phases).reduce((x, p) => x + p.usd, 0), 0);
  const scale = priced ? reported / priced : 1;

  const all = {};
  for (const t of done) {
    for (const [k, p] of Object.entries(t.phases)) {
      const row = (all[k] ??= { turns: 0, tokens: 0, usd: 0, mins: [] });
      row.turns += p.turns;
      row.tokens += p.tokens;
      row.usd += p.usd * scale;
      row.mins.push(p.minutes);
    }
  }

  const rows = ORDER.filter((k) => all[k]).map((k) => {
    const r = all[k];
    return `${k.padEnd(5)} ${String(r.turns).padStart(6)} ${(r.tokens / 1e6).toFixed(1).padStart(7)}M` +
      ` $${(r.usd / done.length).toFixed(2).padStart(6)} ${((r.usd / reported) * 100).toFixed(0).padStart(4)}%` +
      ` ${median(r.mins).toFixed(1).padStart(8)}`;
  });

  return [
    `loop-cost: ${done.length} tickets, $${reported.toFixed(2)} reported`,
    "phase  turns  tokens  $/tkt  share  med min",
    ...rows,
    `\nper ticket: $${(reported / done.length).toFixed(2)} mean, $${median(done.map((t) => t.usd)).toFixed(2)} median,` +
      ` ${median(done.map((t) => t.minutes)).toFixed(0)} min median,` +
      ` ${median(done.filter((t) => t.rounds).map((t) => t.rounds))} review rounds median`,
  ].join("\n");
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const dir = new URL("../../.loop-logs/", import.meta.url);
  const only = process.argv[2];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl") && f !== "tickets.jsonl" && (!only || f === `${only}.jsonl`));
  console.log(report(files.map((f) =>
    readTicket(readFileSync(new URL(f, dir), "utf8").split("\n"), f.replace(".jsonl", "")))));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run loop:test`
Expected: PASS.

- [ ] **Step 5: Add the script and take the baseline**

In `package.json`, beside `check:comments`: `"loop:cost": "node tools/loop/loop-cost.mjs",`

Run: `npm run loop:cost`
Expected: a phase table. **Paste this output into the PR body — it is the baseline every later claim is measured against.**

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npx eslint tools/loop
git add tools/loop/loop-cost.mjs tools/loop/tests/loopCost.test.ts package.json
git commit -m "Report what the loop spends by phase, so a cost claim can be checked rather than asserted"
```

---

## Task 5: Retier and rebrief phase D

Seventy-two percent of spend, and the phase whose rounds 3 and 4 have been changing docblocks. Three edits in one file because they are one idea: cost less per pass, and stop asking for the findings that waste the passes.

The evidence, so the executor can argue with it rather than obey it:

- Anthropic states the mechanism: *"A reviewer prompted to find gaps will usually report some, even when the work is sound, because that is what it was asked to do… Tell the reviewer to flag only gaps that affect correctness or the stated requirements."* The current brief asks for *"every documented-rule violation by number, and any baseline smell"* — an instruction to enumerate.
- SWR-Bench (1,000 verified PRs): every mainstream automated reviewer scores precision below 10%, worst on the prose/documentation class — F1 14.30% against 26.20% on logic.
- The same benchmark's winning intervention is aggregation, not tier: a *fast* model self-aggregated beat every single-pass system by 43.67% F1.
- Anthropic documents the refutation shape: *"a verification subagent… has a fresh model try to refute the result, so the agent doing the work isn't the one grading it."* The loop uses this for the code and not for the findings.

**Files:**
- Modify: `.claude/commands/queue.md`
- Test: `tests/rulesAreSingleSourced.test.ts` must still pass — it pins that `queue.md` does not restate RULES.md.

**Interfaces:** Phase D's output contract is unchanged — one `VERDICT: LAND <sha>` or `VERDICT: HOLD <sha> — <sentence>` comment, which `loop-gate.mjs` reads.

- [ ] **Step 1: Retier the reviewers and narrow their briefs**

Replace the paragraph beginning "Two fresh `opus` subagents" and the two bullets under it:

```markdown
Two fresh `sonnet` subagents (rule 29's independent-review tier) that did not write the code, each
given the diff and nothing else — never your reasoning, which is the frame the review exists to
escape:

- **Standards** — sources: `docs/agents/RULES.md` plus the skill's own Fowler smell baseline (paste
  it in full; the subagent has no other access to it). Brief: report only what affects correctness
  or breaks a documented rule, by number, quoted. A smell with no correctness cost is not a
  finding. Skip what tooling enforces. Around 15 lines.
- **Spec** — source: issue #N's body and comments, already fetched in phase A. Brief: report
  requirements missing or partial, behaviour not asked for, and anything implemented but wrong,
  quoting the issue for each. Around 15 lines.

Both: `Do not spawn any subagent. Report findings only — what checked out is not reported. Every
finding names a file:line and either the rule number it breaks, a quoted line of the issue, or the
input that makes it go wrong. A finding carrying none of those three is a note, and notes are not
reported.` The tier is `sonnet` because the measured failure of this phase is precision, not depth:
automated review scores under 10% precision across the field, and is at its worst on exactly the
prose findings that cost this loop its third and fourth rounds.
```

- [ ] **Step 2: Add the refutation pass**

Immediately after those bullets, before "Post both reports on the issue":

```markdown
Then one more `sonnet` subagent, given both reports and the same diff, and nothing else:

> For each finding below, try to kill it. A finding survives only if you can state the input or the
> sequence that makes the code wrong, or quote the rule or the issue line it breaks. Answer with the
> surviving findings and one sentence each on what killed the rest. Do not spawn any subagent, and
> do not review the diff for anything the reports did not raise.

Its output is what reaches the verdict. A third subagent for the *findings*, never for the verdict —
that stays this session's own read, which is what keeps `loop-gate.mjs`'s single sha-bound line.
```

- [ ] **Step 3: Make the round rule's standing honest**

Replace the paragraph beginning "**Stop before the cap when a round earns nothing.**":

```markdown
**Stop before the cap when a round earns nothing.** A review will always find *something*, which is
exactly why a fixed count over-buys: a round that raises no finding the previous round did not
already raise ends the review on that head, and you post your `VERDICT: LAND`. The cap is the
ceiling, never the target.

That stopping rule is a judgement, not a measurement. No published work measures defects-per-round
across LLM review iterations, and the nearest evidence points the other way — parallel aggregation
improves findings, which is why the refutation pass above exists and a fifth sequential round does
not. It is the best available heuristic; say so if it is ever cited as more.
```

- [ ] **Step 4: Verify nothing restates RULES.md**

Run: `npx jest tests/rulesAreSingleSourced.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/commands/queue.md
git commit -m "Review at the tier and the precision the measurement asks for, and refute findings before the verdict"
```

---

## Task 6: The gate

Not a code change. This decides whether Stage 2 is worth building, and it is the only defence against this plan's weakest assumption.

- [ ] **Step 1: Open the pull request**

Body states what changed, the Task 4 baseline output, and the hypothesis: *median review rounds fall from 4, and cost per ticket from $19.89.*

```bash
git push -u origin agent/loop-overhaul-stage1
gh pr create --base main --head agent/loop-overhaul-stage1 \
  --title "Stage 1: retier review, delete the polling, make the comment rule a boundary" --body-file <file>
```

- [ ] **Step 2: Merge, then run five tickets** with no further changes.

- [ ] **Step 3: Measure**

Run: `npm run loop:cost`. Record median review rounds, $/ticket, median minutes, and phase D's share.

- [ ] **Step 4: Judge against the prediction, honestly**

| Outcome | What it means | What to do |
|---|---|---|
| Rounds ≤ 2.5 **and** $/ticket ≤ $14 | Stage 1 worked as predicted | Write the Stage 2 plan |
| Rounds fell, cost did not | The watching half dominates, as measured ($8.70 of $14.42) | Write the Stage 2 plan — it targets exactly that |
| Rounds **rose** | Sonnet reviewers are too weak for this codebase | Revert Task 5's tier change only; keep the brief and the refutation pass; re-measure |
| Nothing moved | The model was never the variable | **Stop.** Do not build Stage 2. Re-open the question with the new data. |

Post the answer as a comment on the merged PR. A gate whose result is not written down is not a gate.

---

## Projected outcome

| | $/ticket | Weekly window/ticket | In-phase min |
|---|---|---|---|
| Measured today | $19.89 | 2.0% | 49.5 |
| After Stage 1 | ~$12.26 (−38%) | ~1.2% | ~35 (−29%) |
| After Stage 2, if Task 6 licenses it | ~$6.97 (−65%) | ~0.7% | ~27 (−45%) |

What these figures are not:

1. **The per-phase dollar split is proportional, not absolute.** Pricing every usage record overshoots the authoritative `total_cost_usd` by about 1.5×, because streaming deltas double-count. `loop-cost.mjs` scales shares onto the reported total for exactly this reason.
2. **Rounds 4 → 2.5 is the assumption carrying most of the saving.** Task 6 exists because of it.
3. **Sonnet reviewers could raise the round count and eat their own saving.** Task 6 step 4 has a row for that and it says revert the tier.
4. **The subscription arithmetic is extrapolated.** The 2.0% median is real, read from `rate_limit_event.seven_day.utilization`. Anthropic does not publish the per-model weighting, so the projected percentages assume the window meters roughly in proportion to cost. Directionally safe, not a promise.

**Haiku appears nowhere in Stage 1.** Not because it is too weak — because the phases it would fit run inside the main session, whose model is fixed by `queue.md`'s frontmatter, and whose context reaches 310k against Haiku's 200K window. Stage 2 moves those phases out; by then they need no model at all.
