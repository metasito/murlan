# Documentation Reorganisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every document an agent or a human reads in this repo is in the place its reader is already looking, says each thing once, is reached by a pointer that names its trigger, and is kept that way by a check.

**Architecture:** Three moves. (1) *Scope by directory*: the always-loaded `CLAUDE.md` keeps only what every task needs; UI and server material moves to `components/CLAUDE.md` and `server/CLAUDE.md`, which Claude Code loads only when reading files under those directories. (2) *One file per job*: `loops.md` + `TESTING.md` become one `docs/agents/checks.md`; game-rule decisions move from `BRIEF.md` §3.1 into `docs/GAME-RULES.md`; `domain.md` folds into `CONTEXT.md`. (3) *Working artefacts stop accumulating*: `docs/plans`, `docs/research`, `docs/specs` are emptied of anything superseded, their lasting decisions become ADRs, and a test refuses an unindexed document from then on.

**Tech Stack:** Markdown; `node --test` (node:test, TypeScript run directly by Node's loader) for the checks; `tools/loop/*.mjs` guards and hooks; GitHub Actions (`ci.yml`).

**Spec:** This file. It implements the owner's instruction of 2026-09-22: reorder the docs, fix the pointers, remove duplication across files, reduce the number of files where that is better, every file graded A against the writing-for-agents principles, dead weight and old history removed, PowerShell 7 assumed everywhere.

## Global Constraints

- **`docs/agents/RULES.md` is the only normative rule list.** No other file restates a rule; it cites the number. Rule numbers are never reused or renumbered (`docs/agents/RULES.md` header).
- **RULES.md stays under 120 lines** (`tests/tooling/rulesAreSingleSourced.test.ts`).
- **Never change what a rule requires** in this work. A rule that looks wrong is reported to the owner, not edited.
- **Game-rule text is moved verbatim.** A game-rule *decision* changes only through the owner (`CLAUDE.md`, `docs/GAME-RULES.md`).
- **Every check added here must be seen red** on a seeded violation before it is committed, and must not exempt what it checks (`CLAUDE.md`, "No self-defeating safeguards").
- **The shell is PowerShell 7 (pwsh), UTF-8 by default**, and Git Bash is available. Every doc claim about the shell must match that. `--body-file` stays the way multi-line GitHub bodies are passed, because quoting, not encoding, is the reason.
- **Word budgets:** `CLAUDE.md` ≤ 1,000 words; `components/CLAUDE.md` and `server/CLAUDE.md` ≤ 700 each; `docs/agents/checks.md` ≤ 3,500; `queue.md` ≤ 2,600. Enforced by Task 9's check.
- **One PR per task**, branch `docs/reorg-<n>-<slug>`, merged by the owner or the loop. CI is the gate; do not run the full sweep locally (RULES.md rules 1 and 2).
- **Do not touch** `.claude/skills/**` (vendored upstream), `docs/adr/0001`–`0006` (history, immutable), `docs/PRIVACY.md` (published policy).

---

### Task 1: Split CLAUDE.md by directory

**Files:**
- Modify: `CLAUDE.md` (1,816 words → ≤ 1,000)
- Create: `components/CLAUDE.md`, `server/CLAUDE.md`
- Test: `tests/tooling/claudeMdScope.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the three-file layout every later task edits; `claudeMdScope.test.ts` exporting nothing (a test file), asserting word budgets and that a UI/server term appears in exactly one of the three.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tooling/claudeMdScope.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

const BUDGET: Record<string, number> = {
  "CLAUDE.md": 1000,
  "components/CLAUDE.md": 700,
  "server/CLAUDE.md": 700,
};

// A term belongs to the file whose directory its reader is already in: the root file is
// loaded on every turn, the nested ones only when that directory is being read.
const OWNED: Record<string, string[]> = {
  "components/CLAUDE.md": ["CARD_W", "zIndex", "Layer.felt", "impactDelayMs", "a11yHidden", "supportedOrientations"],
  "server/CLAUDE.md": ["schemaDdl", "DEDUPE_ON_BOOT", "tablesFilter", "bootEnv", "deploy/runtime.json"],
};

for (const [file, budget] of Object.entries(BUDGET)) {
  test(`${file} is within its budget`, () => {
    assert.ok(words(read(file)) <= budget, `${file} is ${words(read(file))} words, budget ${budget}`);
  });
}

test("a scoped term is stated in exactly one CLAUDE.md", () => {
  const bodies = Object.keys(BUDGET).map((f) => [f, read(f)] as const);
  const strays: string[] = [];
  for (const [owner, terms] of Object.entries(OWNED)) {
    for (const term of terms) {
      for (const [file, body] of bodies) {
        if (file !== owner && body.includes(term)) strays.push(`${term} in ${file}, owned by ${owner}`);
      }
    }
  }
  assert.deepEqual(strays, []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/tooling/claudeMdScope.test.ts`
Expected: FAIL — `components/CLAUDE.md` does not exist (ENOENT), and the root file is over budget.

- [ ] **Step 3: Create `components/CLAUDE.md`**

Move, verbatim, from `CLAUDE.md`: the table/UI invariants (card-appears-once, `CARD_W`/`CARD_H`, impact feedback timing, which view covers which, native-only defects, table scale from the short edge, design tokens in their role, icon literal, one accessible node, labelled container, `<Modal>`/`supportedOrientations`, `NotificationBanner`, `OfflineBanner`, game invites) and the whole *Design system* section. Add one opening line: "Loaded when you read anything under `components/`. Rules live in `docs/agents/RULES.md`; invariants here are pinned by the test named on each line."

- [ ] **Step 4: Create `server/CLAUDE.md`**

Move, verbatim, from `CLAUDE.md`: the *Production* section (runtime contract, boot env, `schemaDdl.ts`, the `session` table, schema-change order) and the server invariants (server authority, ticket auth only, listener registration before every `await`, one socket per userId, a winner is an engine player id, one module chooses a bot's move). Same opening line, for `server/`.

- [ ] **Step 5: Rewrite the root `CLAUDE.md`**

Keep only: the one-paragraph what-this-is; the pointer list rewritten as triggers (Task 2); the cross-directory invariants (hooks before the null guard, `lib/game/autoMove.ts` as the only bot-move chooser if it is cited from both sides, the comment budget, no self-defeating safeguards); the loop-protocol paragraph. Each moved section leaves **no** summary behind — a pointer only where a trigger exists for it.

- [ ] **Step 6: Run the test**

Run: `node --test tests/tooling/claudeMdScope.test.ts`
Expected: PASS.

- [ ] **Step 7: Prove the scope check can fail**

Paste `CARD_W` into `server/CLAUDE.md`, run the test (expect FAIL naming it), remove it, run again (expect PASS).

- [ ] **Step 8: Commit**

```powershell
git add CLAUDE.md components/CLAUDE.md server/CLAUDE.md tests/tooling/claudeMdScope.test.ts
git commit -m "docs: scope CLAUDE.md by directory"
```

---

### Task 2: Turn every pointer into a trigger

**Files:**
- Modify: `CLAUDE.md` (pointer list), `components/CLAUDE.md`, `server/CLAUDE.md`, `.claude/commands/queue.md` (add the RULES.md read), `.claude/commands/triage.md`, `.claude/commands/wayfinder.md`
- Test: `tests/tooling/pointersAreTriggers.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's three-file layout.
- Produces: the convention every later doc edit follows — a pointer line names *when* to read the target, not what it contains.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tooling/pointersAreTriggers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const claude = readFileSync(path.join(root, "CLAUDE.md"), "utf8");

// The pointer list is the only place CLAUDE.md names another document, and each line must say
// the condition for going there: a pointer that only describes its target is not reached.
const TRIGGER = /\b(before|when|after|once|if)\b/i;

test("every pointer line names its trigger", () => {
  const lines = claude.split("\n").filter((l) => /^- .*`(docs|\.claude)\/[^`]+`/.test(l));
  assert.ok(lines.length >= 4, `found ${lines.length} pointer lines; the list moved`);
  assert.deepEqual(lines.filter((l) => !TRIGGER.test(l)), []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/tooling/pointersAreTriggers.test.ts`
Expected: FAIL — the current lines describe contents ("every rule an agent follows, numbered").

- [ ] **Step 3: Rewrite the pointer list**

Each line: trigger first, target second, one clause on what it settles. For example:

```markdown
- **Before any rendering, animation or test change** — `docs/agents/checks.md`: which check catches it, and the traps that pass every check and still ship broken.
- **Before claiming, labelling or writing a ticket** — `docs/agents/issue-tracker.md`.
- **When a rule number is cited and you cannot see the rule** — `docs/agents/RULES.md`.
- **Before changing a game rule** — `docs/GAME-RULES.md` § Decisions, and the owner decides.
- **When a decision needs recording** — `docs/adr/README.md`.
```

- [ ] **Step 4: Make the rule numbers resolvable in the loop**

In `.claude/commands/queue.md`, add as the first line of the procedure: "Read `docs/agents/RULES.md` now — this file cites it by number." (`triage.md` and `wayfinder.md` already do; keep their wording identical.)

- [ ] **Step 5: Run the test and the doc tests**

Run: `node --test tests/tooling/pointersAreTriggers.test.ts tests/tooling/rulesAreSingleSourced.test.ts tools/loop/tests/loopDocsAreExecutable.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add CLAUDE.md components/CLAUDE.md server/CLAUDE.md .claude/commands tests/tooling/pointersAreTriggers.test.ts
git commit -m "docs: pointers name their trigger, and queue.md reads the ruleset it cites"
```

---

### Task 3: One checks document

**Files:**
- Create: `docs/agents/checks.md` (from `docs/agents/loops.md` 4,779 w + `docs/TESTING.md` 4,637 w, target ≤ 3,500 w)
- Delete: `docs/agents/loops.md`, `docs/TESTING.md`
- Modify: every file citing either name (58 and 8 references — `git grep -l`), `.github/workflows/ci.yml` scope allowlist (the `docs/(PRIVACY|GAME-RULES|TESTING|WEB-PERF)` group), `tests/tooling/ciScope.test.ts`, `tools/loop/hint-test-traps.mjs`, `tests/tooling/loaderConstraintIsSingleSourced.test.ts`
- Test: the two tests above, plus `tools/loop/tests/hintTestTraps.test.ts`

**Interfaces:**
- Consumes: Task 2's trigger pointers (the `checks.md` pointer is already written).
- Produces: `docs/agents/checks.md` with the headings other files anchor to, kept verbatim: `Pick the loop by what you changed`, `Local ports`, `React Native Web traps`, `Node's TypeScript loader reaches plain `.ts` only`, `What a green loop does not mean`, `A scan needs a planted floor`, `The native harness is async`.

- [ ] **Step 1: List every inbound reference**

```powershell
git grep -n "loops\.md" | Out-File -Encoding utf8 refs-loops.txt
git grep -n "TESTING\.md" | Out-File -Encoding utf8 refs-testing.txt
```

Keep both lists open; every line is updated in Step 4 and the files are deleted at the end of the task.

- [ ] **Step 2: Write the failing test**

Add to `tests/tooling/rulesAreSingleSourced.test.ts` a case in the existing style:

```ts
test("the checks document is one file", () => {
  assert.ok(existsSync(path.join(repoRoot, "docs/agents/checks.md")));
  for (const gone of ["docs/agents/loops.md", "docs/TESTING.md"]) {
    assert.ok(!existsSync(path.join(repoRoot, gone)), `${gone} still exists`);
  }
  const stale = execSync('git grep -l -E "loops\\.md|TESTING\\.md" -- ":!docs/adr" ":!docs/plans" || true', { cwd: repoRoot, encoding: "utf8" }).trim();
  assert.equal(stale, "", `these still cite a deleted document:\n${stale}`);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test tests/tooling/rulesAreSingleSourced.test.ts`
Expected: FAIL — `checks.md` does not exist.

- [ ] **Step 4: Build `checks.md`**

Order: (1) the check-catches-what table; (2) local ports; (3) how to run each suite, from `TESTING.md`, one line each, no restatement of `package.json`; (4) device runs — dispatch on a ticket's own branch, read the artifacts, never rerun; (5) React Native Web traps; (6) the remaining traps as symptom → cause → action, each ending with the check that catches it where one exists. Drop every passage that only narrates an incident. Where `TESTING.md` and `loops.md` state the same fact, keep the shorter and verify it against the code.

- [ ] **Step 5: Update every reference**

Rewrite each line from Step 1 to `docs/agents/checks.md` with the same anchor. Update `ci.yml`'s allowlist group to `docs/(PRIVACY|GAME-RULES|WEB-PERF)\.md` and let `docs/agents/` cover the new file, then update `tests/tooling/ciScope.test.ts` to match. Delete `refs-*.txt`.

- [ ] **Step 6: Run the affected tests**

Run: `node --test tests/tooling/rulesAreSingleSourced.test.ts tests/tooling/ciScope.test.ts tests/tooling/loaderConstraintIsSingleSourced.test.ts tools/loop/tests/hintTestTraps.test.ts tools/loop/tests/loopDocsAreExecutable.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add docs/agents/checks.md tests .github .claude tools docs CLAUDE.md components server
git rm docs/agents/loops.md docs/TESTING.md
git commit -m "docs: one checks document replaces loops.md and TESTING.md"
```

---

### Task 4: Game-rule decisions live with the game rules

**Files:**
- Modify: `docs/GAME-RULES.md` (add `## Decisions`), `docs/BRIEF.md` (remove §3.1, renumber nothing else — keep §3.2/§3.3 numbers stable by leaving §3.1 as a one-line pointer), `CLAUDE.md` (the game-rule line), every file citing "BRIEF.md §3.1" (`git grep -n "BRIEF.md §3.1"`)
- Test: `tests/tooling/gameRuleDecisions.test.ts` (create)

**Interfaces:**
- Consumes: Task 2's pointer convention.
- Produces: `docs/GAME-RULES.md` § Decisions as the single home of decided rule questions; `BRIEF.md` §3.1 reduced to "Moved to `docs/GAME-RULES.md` § Decisions."

- [ ] **Step 1: Write the failing test**

```ts
// tests/tooling/gameRuleDecisions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

test("decided game rules are stated in GAME-RULES.md, not in BRIEF.md", () => {
  const rules = read("docs/GAME-RULES.md");
  const brief = read("docs/BRIEF.md");
  assert.match(rules, /^## Decisions$/m);
  // The rows moved: each of these phrases is now in the rules, and no longer in the brief.
  for (const phrase of ["The offline turn clock", "A match ended by the unanimous vote", "Who starts a matchmade table"]) {
    assert.ok(rules.includes(phrase), `GAME-RULES.md is missing: ${phrase}`);
    assert.ok(!brief.includes(phrase), `BRIEF.md still states: ${phrase}`);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/tooling/gameRuleDecisions.test.ts`
Expected: FAIL — no `## Decisions` heading.

- [ ] **Step 3: Move the table verbatim**

Cut the §3.1 table from `BRIEF.md` and paste it under a new `## Decisions` heading at the end of `docs/GAME-RULES.md`, with one opening line: "Each row is a decided question: the rule, and why it is that way. Changing a row is the owner's (`CLAUDE.md`)." Change no cell.

- [ ] **Step 4: Update the citations**

`git grep -n "BRIEF.md §3.1"` — rewrite each to `docs/GAME-RULES.md § Decisions`. Update `CLAUDE.md`'s game-rule line and `docs/BRIEF.md` §3.1's replacement line.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/tooling/gameRuleDecisions.test.ts tools/loop/tests/brief.test.ts tests/tooling/rulesAreSingleSourced.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add docs tests CLAUDE.md
git commit -m "docs: game-rule decisions move into GAME-RULES.md"
```

---

### Task 5: Fold the two small agent files into their homes

**Files:**
- Modify: `CONTEXT.md` (absorb `docs/agents/domain.md`, 149 w), `CLAUDE.md` (pointer), `docs/agents/smell-baseline.md` (header only)
- Delete: `docs/agents/domain.md`
- Test: `tools/loop/tests/brief.test.ts` (already asserts the smell baseline names RULES.md — keep green)

**Interfaces:**
- Consumes: Task 2's pointer convention.
- Produces: `CONTEXT.md` as the single domain-vocabulary file.

- [ ] **Step 1: Check who reads each file**

```powershell
git grep -n "domain\.md"; git grep -n "smell-baseline"
```

`smell-baseline.md` is pasted into the review brief by `tools/loop/brief.mjs` — it stays where it is, and only its header line changes to say it is vendored text changed by re-vendoring.

- [ ] **Step 2: Move the domain content**

Append `domain.md`'s four bullets to `CONTEXT.md` under `## Working with this vocabulary`, dropping anything `CONTEXT.md` already says.

- [ ] **Step 3: Update the references**

Every hit from Step 1 that names `docs/agents/domain.md` becomes `CONTEXT.md`.

- [ ] **Step 4: Run the tests**

Run: `node --test tools/loop/tests/brief.test.ts tests/tooling/rulesAreSingleSourced.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add CONTEXT.md CLAUDE.md docs
git rm docs/agents/domain.md
git commit -m "docs: the domain vocabulary is one file"
```

---

### Task 6: Empty the working-artefact directories

**Files:**
- Delete: `docs/plans/**` (10 files, 65,886 w), the superseded part of `docs/research/**` (32 files, 138,397 w) and `docs/specs/**` (7 files, 11,112 w), `docs/design/2026-09-03-review-fixes.md` (9,299 w, unreferenced), `docs/design/829-animation-audit.md`
- Create: `docs/adr/0007-*.md` … for each lasting decision extracted; `docs/README.md` (the index)
- Modify: `docs/adr/README.md` (state the policy for plans/research/specs)
- Test: `tests/tooling/docsIndexed.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/README.md`, whose links Task 9's check reads; the rule that a document is either indexed or gone.

- [ ] **Step 1: Produce the keep/delete list and get the owner's answer**

```powershell
node -e "const {execSync}=require('child_process');const fs=require('fs');for(const f of execSync('git ls-files docs/plans docs/research docs/specs',{encoding:'utf8'}).trim().split('\n')){const w=fs.readFileSync(f,'utf8').split(/\s+/).length;const refs=execSync(`git grep -l -F \"${f.split('/').pop()}\" -- \":!${f}\" \":!docs/plans\" \":!docs/research\" \":!docs/specs\" || true`,{encoding:'utf8'}).trim().split('\n').filter(Boolean).length;console.log(`${w}w ${refs}ref ${f}`)}"
```

Post the list on the reorganisation issue with a one-line verdict each (superseded by shipped code / holds a decision worth an ADR / still live), default **delete**. **Checkpoint: the owner confirms before anything is deleted.**

- [ ] **Step 2: Write the failing test**

```ts
// tests/tooling/docsIndexed.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tracked = (glob: string) =>
  execSync(`git ls-files ${glob}`, { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);

test("every document under docs/ is reachable from docs/README.md", () => {
  const index = readFileSync(path.join(root, "docs/README.md"), "utf8");
  const adrIndex = readFileSync(path.join(root, "docs/adr/README.md"), "utf8");
  const orphans = tracked('"docs/**/*.md"')
    .filter((f) => !/\/README\.md$/.test(f))
    .filter((f) => !index.includes(path.basename(f)) && !adrIndex.includes(path.basename(f)));
  assert.deepEqual(orphans, [], "index these in docs/README.md, or delete them");
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test tests/tooling/docsIndexed.test.ts`
Expected: FAIL — `docs/README.md` does not exist (ENOENT).

- [ ] **Step 4: Extract the decisions**

For every file the owner marked "holds a decision", write an ADR in the existing format (`docs/adr/0006-*.md` is the model): Context, Decision, Consequences, and the source file named in Context. Number them from 0007 upward.

- [ ] **Step 5: Delete what the owner approved**

```powershell
git rm -r docs/plans
git rm docs/research/<each approved file> docs/specs/<each approved file>
git rm docs/design/2026-09-03-review-fixes.md docs/design/829-animation-audit.md
```

Anything kept stays where it is and is indexed in Step 6.

- [ ] **Step 6: Write `docs/README.md`**

One table: document | when you read it. Every surviving `docs/**.md` appears exactly once, grouped as Product (BRIEF, GAME-RULES, DISCONNECT-POLICY, FEEL-BAR), Operating the repo (checks, issue-tracker, RULES, DEPLOY-RUNBOOK), Reference (ARCHITECTURE, WEB-PERF, BUNDLE, BETA-PLAYTEST, PRIVACY), Decisions (adr/README).

- [ ] **Step 7: State the policy where it is enforced**

In `docs/adr/README.md`, add: a plan, a research note or a design spec is a working artefact — it is deleted when the work lands, and anything worth keeping is an ADR by then. `docs/README.md` links the ADR index; the check above refuses an unindexed document.

- [ ] **Step 8: Run the test, and prove it fails**

Run: `node --test tests/tooling/docsIndexed.test.ts` → PASS. Then `New-Item docs/scratch-check.md -Value "x"`, run again (expect FAIL naming it), `Remove-Item docs/scratch-check.md`, run again (expect PASS).

- [ ] **Step 9: Commit**

```powershell
git add docs tests/tooling/docsIndexed.test.ts
git commit -m "docs: index what we keep, delete the working artefacts"
```

---

### Task 7: PowerShell 7 everywhere

**Files:**
- Modify: `docs/agents/checks.md`, `docs/agents/issue-tracker.md`, `.claude/commands/*.md`, `CLAUDE.md` (any shell claim), `docs/DEPLOY-RUNBOOK.md`, `tools/loop/guard-bash.mjs` (comments naming a 5.1 behaviour)
- Test: `tests/tooling/shellClaims.test.ts` (create)

**Interfaces:**
- Consumes: Task 3's `checks.md`.
- Produces: one stated shell contract that later docs cite instead of re-explaining.

- [ ] **Step 1: Find every claim**

```powershell
git grep -n -i -E "powershell 5|ps 5\.1|ansi|cp1252|Set-Content|Out-File|WriteAllText" -- "*.md" "tools/**/*.mjs"
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/tooling/shellClaims.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("no document claims Windows PowerShell 5.1", () => {
  const hits = execSync('git grep -n -i -E "powershell 5\\.1|ps 5\\.1" -- "*.md" ":!docs/adr" || true', { cwd: root, encoding: "utf8" }).trim();
  assert.equal(hits, "", `the shell is pwsh 7:\n${hits}`);
});
```

- [ ] **Step 3: Run it**

Run: `node --test tests/tooling/shellClaims.test.ts`
Expected: FAIL if any doc still says 5.1; if it already passes, keep the test — it holds the claim from coming back.

- [ ] **Step 4: State the contract once**

In `docs/agents/checks.md`, one bullet: "The shell is **pwsh 7**: UTF-8 by default, `&&`/`||` work, `$env:NAME` sets a variable. A multi-line GitHub body still goes through `--body-file`, because the problem is quoting, not encoding. Git Bash is available for POSIX scripts." Every other file that explained encoding workarounds cites this instead.

- [ ] **Step 5: Verify the claim on this machine**

```powershell
$PSVersionTable.PSVersion; [Console]::OutputEncoding.WebName
```

Record the two values in the bullet only if they are what it claims; if not, correct the bullet to what they say.

- [ ] **Step 6: Run the test and commit**

```powershell
node --test tests/tooling/shellClaims.test.ts
git add docs .claude CLAUDE.md tools tests/tooling/shellClaims.test.ts
git commit -m "docs: the shell is pwsh 7, stated once"
```

---

### Task 8: Trim queue.md and issue-tracker.md to their jobs

**Files:**
- Modify: `.claude/commands/queue.md` (2,899 → ≤ 2,600 w), `docs/agents/issue-tracker.md`
- Test: `tools/loop/tests/loopDocsAreExecutable.test.ts`, `tests/tooling/rulesAreSingleSourced.test.ts`, `tests/tooling/claudeMdScope.test.ts` (budget entry added for `queue.md`)

**Interfaces:**
- Consumes: Task 2 (queue.md now reads RULES.md), Task 9's budget check reads the same `BUDGET` map — add `".claude/commands/queue.md": 2600` there.
- Produces: no new interface.

- [ ] **Step 1: Cut what the environment already says**

Remove from `queue.md` every line restating a script's own output, `package.json`, or `issue-tracker.md`: the prompt-caching aside, the turn-budget rationale, the re-explanation of what `loop-gate` prints. Each phase keeps its marker line, its numbered steps and its "Done when".

- [ ] **Step 2: Make every completion criterion checkable**

Replace any criterion an agent cannot verify ("if you catch yourself narrating…") with an observable one, or delete it. Each phase ends: "Done when <observable state>."

- [ ] **Step 3: Give `issue-tracker.md` one recipe block**

Labels as a table; `gh` invocations in one block; the ticket-body template unchanged in meaning; the claiming procedure pointing at `queue:claim` rather than describing it twice.

- [ ] **Step 4: Run the doc tests**

Run: `node --test tools/loop/tests/loopDocsAreExecutable.test.ts tests/tooling/rulesAreSingleSourced.test.ts tests/tooling/claudeMdScope.test.ts tools/loop/tests/queueLoop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add .claude/commands/queue.md docs/agents/issue-tracker.md tests
git commit -m "docs: queue.md and the tracker doc keep only their own job"
```

---

### Task 9: Widen the single-source check to every rule

**Files:**
- Modify: `tests/tooling/rulesAreSingleSourced.test.ts`
- Test: itself

**Interfaces:**
- Consumes: the final wording of every doc (run this task last among the repo tasks).
- Produces: a phrase pattern per rule, so a future restatement fails CI.

- [ ] **Step 1: Add a pattern for every rule**

The test holds 12 phrase regexes for 42 rules. Add one per remaining rule, derived from its own line, and keep the existing assertion that each pattern still matches its own rule (that is what stops a pattern rotting into one that matches nothing).

- [ ] **Step 2: Fix what it now catches**

Every file it names restates a rule: replace the restatement with the rule number. Expect hits in `CLAUDE.md` (rules 18, 19, 20, 25) and `checks.md`.

- [ ] **Step 3: Add the CLAUDE ↔ queue overlap cases**

Assert that "no file is off limits" and the batching guidance appear in exactly one of `CLAUDE.md` and `queue.md`.

- [ ] **Step 4: Run it, and prove it fails**

Run: `node --test tests/tooling/rulesAreSingleSourced.test.ts` → PASS. Paste rule 30's sentence into `CLAUDE.md`, run again (expect FAIL naming the file), remove it, run again (expect PASS).

- [ ] **Step 5: Commit**

```powershell
git add tests/tooling/rulesAreSingleSourced.test.ts CLAUDE.md docs
git commit -m "test: every rule is single-sourced, not only twelve"
```

---

### Task 10: The two files outside the repo

**Files (not in this repo, no PR):**
- Modify: `C:/Users/roton/.claude/projects/C--Users-roton-murlan/memory/MEMORY.md` and the memory files it indexes
- Modify: `C:/Users/roton/.claude/CLAUDE.md`

**Interfaces:**
- Consumes: the finished repo docs, so a memory can be deleted only once the repo states the fact.
- Produces: a memory index holding what the repo cannot state.

- [ ] **Step 1: Delete the memories the repo now enforces**

For each entry, check the repo states it (RULES.md number, a check, or `CLAUDE.md`): merge with `--merge`, stage by pathspec, the worktree junction, reading an issue with comments, blockers before claiming, `/design`, cleanup, naming a model, builders must not fork, self-defeating safeguards, `onLayout`, iOS paint order, no changelog comments. Delete the file, remove its index line, and fix any `[[link]]` that pointed at it.

- [ ] **Step 2: Resolve the three contradictions**

"Never run Playwright locally" vs rule 3, "must not run agent:check" vs rule 1, "run many builders" vs "one ticket at a time". Rewrite each memory to say when each applies, or delete it if the rule already decides.

- [ ] **Step 3: Delete the superseded entries**

The ones whose own text says they are superseded.

- [ ] **Step 4: Fix the global CLAUDE.md**

Replace the PowerShell 5.1 encoding premise with the pwsh 7 contract from Task 7, keep `--body-file` and the codepoint-counting advice, and drop the graphify block's duplicate of the skill listing.

- [ ] **Step 5: Report**

No commit (these are outside the repo). Report word counts before and after, and the list of deleted memories, to the owner.

---

## Self-Review

**Spec coverage:** reorder and relocate (Tasks 1, 3, 4, 5, 6) · fix the pointers (Task 2) · remove duplication (Tasks 1, 3, 8, 9, 10) · fewer files where better (Tasks 3, 5, 6) · pwsh 7 (Task 7) · grade A held by checks (Tasks 1, 2, 6, 7, 9) · dead weight and old history (Tasks 3, 6, 8, 10) · MEMORY.md kept loaded in the loop, pruned not disabled (Task 10, per the owner's doubt about removing it).

**Placeholders:** none — every check is written out, every deletion is named by path or produced by the listed command, and the one judgement call (which artefacts hold a decision) is an explicit owner checkpoint in Task 6 Step 1.

**Type consistency:** `claudeMdScope.test.ts`'s `BUDGET` map is created in Task 1 and extended in Task 8; `docsIndexed.test.ts` reads `docs/README.md`, created in the same task; `checks.md`'s anchor headings are listed in Task 3's Interfaces and cited by Task 2's pointers.

---

## Amendment, 2026-09-22 — the reference layer

An independent grading of the tree before this work (6 A, 8 B, 3 C, 1 D; mean 19.9/24) found the instruction layer strong and the reference layer behind it stale and duplicated. The owner's bar is A for every file, so these four tasks join the plan. Same global constraints; same TDD shape where a check is possible.

### Task 11: ARCHITECTURE.md stops maintaining the invariants

**Files:** Modify `docs/ARCHITECTURE.md`; extend `tests/tooling/rulesAreSingleSourced.test.ts`.

- [ ] **Step 1:** List the invariants stated in both `docs/ARCHITECTURE.md` and one of the three `CLAUDE.md` files: `git grep -n -F -f <(grep -o '\*\*[^*]*\*\*' CLAUDE.md components/CLAUDE.md server/CLAUDE.md | sed 's/.*\*\*\(.*\)\*\*/\1/') docs/ARCHITECTURE.md`, then read both sides of every hit.
- [ ] **Step 2:** Add to `rulesAreSingleSourced.test.ts` a case asserting that each duplicated invariant phrase appears in exactly one of `{CLAUDE.md, components/CLAUDE.md, server/CLAUDE.md, docs/ARCHITECTURE.md}`. Run it; it must fail, naming the duplicates.
- [ ] **Step 3:** In `ARCHITECTURE.md`, replace each duplicated statement with the shape of the system plus a pointer to the file that owns the rule. ARCHITECTURE.md describes *what talks to what*; the invariant lives with the code it binds.
- [ ] **Step 4:** Verify every remaining claim against the code (module names, socket events, storage). Correct or delete what fails.
- [ ] **Step 5:** Run the test (PASS), seed a duplicate to see it red, remove it, commit.

### Task 12: audit.md earns its length

**Files:** Modify `.claude/commands/audit.md` (5,181 w).

- [ ] **Step 1:** For each lens, verify its `start`/`refs` paths exist and its question is still open: `node -e` over the lens list, then `git ls-files`. Delete a lens whose problem is fixed or whose files are gone; say so in the report.
- [ ] **Step 2:** Give the procedure ordered steps, each ending on a checkable criterion, and move the lens catalogue behind the steps as reference.
- [ ] **Step 3:** Cut anything restating RULES.md, `queue.md` or `issue-tracker.md`; cite by rule number instead.
- [ ] **Step 4:** Run `node --test tests/tooling/rulesAreSingleSourced.test.ts` (it reads `.claude/commands/*`), commit.

### Task 13: BRIEF.md is a product brief, not an archive

**Files:** Modify `docs/BRIEF.md` (after Task 4 removes §3.1).

- [ ] **Step 1:** Verify every remaining claim: feature status against `app/`, `components/`, `server/`; every issue number against `gh issue view <n> --json state,title`; every file path against `git ls-files`. List each false claim in the report with its correction.
- [ ] **Step 2:** Restructure: what the product is, who it is for, what is decided, what is open (each open item citing its issue). One statement per fact; no history of what a section used to say.
- [ ] **Step 3:** Cut every passage another document owns (rules, checks, deploy steps) and point instead.
- [ ] **Step 4:** Commit.

### Task 14: README.md, CONTEXT.md and GAME-RULES.md

**Files:** Modify `README.md`, `CONTEXT.md`, `docs/GAME-RULES.md`.

- [ ] **Step 1:** `README.md` is for a human arriving at the repo: what this is, how to run it, where the docs index is (`docs/README.md`, Task 6). Remove what it restates from `package.json` or `CLAUDE.md`.
- [ ] **Step 2:** `CONTEXT.md` (which absorbed `domain.md` in Task 5) gets its trigger pointer from the root `CLAUDE.md` pointer list, so it is no longer reachable only through an orphan.
- [ ] **Step 3:** `docs/GAME-RULES.md`: every rule states where the engine implements it (`lib/game/gameEngine.ts` symbol) or which test pins it, so a reader can check it. Add nothing to the rules themselves.
- [ ] **Step 4:** Run `node --test tests/tooling/rulesAreSingleSourced.test.ts tests/tooling/docsIndexed.test.ts` (the latter once Task 6 exists), commit.

### Task 15: the comment pass (owner instruction, 2026-09-22)

Measured before writing this: 29,611 comment lines against 125,590 code lines, 19.1% overall — `shared/` 34%, `lib/` 32%, `server/` 30%, `components/` 21%, `tools/` 17%, `tests/` 18%. `CLAUDE.md` § Comments says the default is no comment and names the four things that earn one: an invisible constraint, a *why* where the obvious approach is wrong, a contract the types cannot carry, a pointer to the authority.

**Files:** every `*.ts`, `*.tsx`, `*.mjs` outside `node_modules`; `tools/loop/comment-budget.mjs` and `tools/loop/commentShape.ts` are the existing guards and must stay green. Three commits, one per batch: (a) `lib/` + `shared/`, (b) `server/`, (c) `components/` + `context/` + `app/` + `scripts/` + `tools/`. `tests/` is a fourth, last, and only for comments that narrate rather than explain a fixture.

- [ ] **Step 1: Rank the targets**

```powershell
node -e "const {execSync}=require('child_process');const fs=require('fs');const files=execSync('git ls-files \"*.ts\" \"*.tsx\" \"*.mjs\"',{encoding:'utf8'}).trim().split('\n');const out=[];for(const f of files){const src=fs.readFileSync(f,'utf8').split('\n');let inb=false,c=0,code=0;for(const ln of src){const t=ln.trim();if(!t)continue;if(inb){c++;if(t.includes('*/'))inb=false;continue}if(t.startsWith('/*')){c++;if(!t.includes('*/'))inb=true;continue}if(t.startsWith('//')){c++;continue}code++}if(c>=30)out.push([c,code,f])}out.sort((a,b)=>b[0]-a[0]);for(const [c,code,f] of out.slice(0,40))console.log(c+' comment '+code+' code '+f)"
```

- [ ] **Step 2: Judge every comment in the ranked files against the four reasons**

Delete: a comment restating the line below it; any history of what the code was, when it changed, or which ticket changed it; an explanation of a defect that was fixed; narration of what the reader can see. Keep, and leave untouched: an ordering that prevents a race, a platform quirk, a *why* the obvious approach is wrong, a contract the types cannot carry, a pointer to the authority (a rule number, an ADR, `docs/GAME-RULES.md`). When a comment is true but too long, shorten it to the constraint it names.

- [ ] **Step 3: Keep the guards green after each batch**

Run: `node --test tools/loop/tests/commentBudget.test.ts tools/loop/tests/commentShape.test.ts` and `node tools/loop/comment-budget.mjs`. A deletion-only batch cannot exceed the budget; if a guard reds, the batch touched a pinned phrase — restore it.

- [ ] **Step 4: Prove nothing but comments changed**

```powershell
git diff --stat
node -e "const {execSync}=require('child_process');const d=execSync('git diff -U0',{encoding:'utf8'});const bad=d.split('\n').filter(l=>/^[-+][^-+]/.test(l)).map(l=>l.slice(1).trim()).filter(t=>t&&!t.startsWith('//')&&!t.startsWith('/*')&&!t.startsWith('*')&&!t.endsWith('*/'));console.log(bad.length?'CODE CHANGED:\n'+bad.join('\n'):'comments only')"
```

Expected: `comments only`. A batch that reports code lines is reverted and redone.

- [ ] **Step 5: Commit each batch**

```powershell
git add -- lib shared
git commit -m "refactor(comments): delete what the code already says in lib and shared"
```

- [ ] **Step 6: Report the numbers**

Comment lines and percentage per directory before and after, and the count of comments deleted by reason (restatement / history / fixed-defect / narration).

### Task 16: a doc reference that goes stale reds the branch (owner instruction, 2026-09-22)

The owner's requirement: when the loop takes any ticket, the process itself must keep doc references true, cut what the change made old, and use each reference properly. A sentence in `RULES.md` asking for that decays (`docs/agents/RULES.md` cannot fail); a check derives it on every run. Every doc in this repo names paths, npm scripts and tests as its authority — so the mechanical half of "the docs follow the code" is: **every path a doc names exists, and every doc file is reachable**. A rename or deletion in an unrelated ticket then fails `npm test` with the doc line that must change, which is how the loop learns to update docs it never opened.

**Files:** Create `tests/tooling/docReferences.test.ts`. Modify `docs/agents/RULES.md` (one rule line). No other file.

**Interfaces:**
- Consumes: the doc set after Tasks 3, 5, 6 and 11-14 — run this task last among doc tasks, so no reference it pins is about to move.
- Produces: nothing other tasks read. `npm test` already globs `tests/**/*.test.ts`, so CI picks it up with no wiring.

- [ ] **Step 1: Write the failing test**

Create `tests/tooling/docReferences.test.ts`, in the style of `tests/tooling/rulesAreSingleSourced.test.ts` (node:test, node:assert/strict, `execSync('git ls-files ...')` for the file set — never a hand-written list, which is the defect this task removes):

```ts
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join, normalize } from "node:path";

const docs = execSync('git ls-files "*.md"', { encoding: "utf8" })
  .trim().split("\n").filter((f) => !f.startsWith("node_modules/"));
const scripts = new Set(Object.keys(JSON.parse(readFileSync("package.json", "utf8")).scripts));

/** `](relative/path.md)` and `](relative/path.md#anchor)`, skipping URLs and bare anchors. */
const LINK = /\]\((?!https?:|mailto:|#)([^)\s#]+)(#[^)\s]*)?\)/g;
/** A repo path inside backticks: `docs/agents/RULES.md`, `lib/game/gameEngine.ts`, `tests/ui-rules/`. */
const CODE_PATH = /`((?:\.?\/)?(?:app|components|context|docs|lib|scripts|server|shared|tests|tools|assets|locales|\.github)\/[\w./@-]+)`/g;
/** `npm run <script>` in prose or a fenced block. */
const NPM_RUN = /npm run ([\w:-]+)/g;

test("every relative link in a doc resolves", () => {
  const broken: string[] = [];
  for (const doc of docs) {
    const body = readFileSync(doc, "utf8");
    for (const [, target] of body.matchAll(LINK)) {
      const resolved = normalize(join(dirname(doc), target));
      if (!existsSync(resolved)) broken.push(`${doc} -> ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("every repo path a doc names in backticks exists", () => {
  const broken: string[] = [];
  for (const doc of docs) {
    const body = readFileSync(doc, "utf8");
    for (const [, target] of body.matchAll(CODE_PATH)) {
      if (!existsSync(normalize(target.replace(/\/$/, "")))) broken.push(`${doc} -> ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("every npm script a doc names is defined", () => {
  const broken: string[] = [];
  for (const doc of docs) {
    for (const [, name] of readFileSync(doc, "utf8").matchAll(NPM_RUN)) {
      if (!scripts.has(name)) broken.push(`${doc} -> npm run ${name}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("the check reads the doc set from git, not from a list", () => {
  assert.ok(docs.length > 10, `expected the tracked doc set, got ${docs.length}`);
});
```

- [ ] **Step 2: Run it and read every failure as work**

Run: `node --test tests/tooling/docReferences.test.ts`

Expected: FAIL, listing every stale path this branch has not yet fixed. Each one is a real defect — fix the doc, never the regex, and never add an exception list. Two exceptions are legitimate and go in the regex itself, with the reason in one comment: a path that is deliberately illustrative (`path/to/file.ts` in an example) is written without a leading repo directory and so is already outside `CODE_PATH`; a path inside a fenced block quoting *another* repo does not exist here — quote it without backticks or rewrite the example.

- [ ] **Step 3: Fix the docs until it passes**

Run: `node --test tests/tooling/docReferences.test.ts`

Expected: PASS, four tests.

- [ ] **Step 4: State the rule once, where rules live**

Add one numbered rule to `docs/agents/RULES.md`, in that file's existing voice, saying that a change that moves, renames or deletes a file updates the docs naming it, and that `tests/tooling/docReferences.test.ts` is what fails when it does not. One line; no restatement anywhere else (`tests/tooling/rulesAreSingleSourced.test.ts` enforces that).

- [ ] **Step 5: Prove it catches a real rename**

```powershell
git mv docs/agents/issue-tracker.md docs/agents/tracker-tmp.md
node --test tests/tooling/docReferences.test.ts
git mv docs/agents/tracker-tmp.md docs/agents/issue-tracker.md
```

Expected: the middle command FAILS and names each doc still pointing at the old path; after the second `git mv`, `node --test tests/tooling/docReferences.test.ts` passes again. A check that stays green through the rename is not wired to the doc set — fix it before committing.


**Task 16 scope addition (ruled 2026-09-22, after two miscitation findings).** The reference check
also asserts that **every `rule N` citation names a rule that exists** in `docs/agents/RULES.md`,
derived by parsing that file's numbered list — never a hard-coded count. A citation is load-bearing
once a doc is forbidden to restate the rule, and a number that resolves to the wrong rule sends the
reader to an authority saying something else; this branch has now found two. The check cannot judge
whether a citation names the *right* rule — that stays a reader's job — but a renumbering of
RULES.md silently breaking every citation in the repo is exactly what it must catch. Its RULES.md
rule line also carries the standing rule cut from `docs/BRIEF.md` §8: a change to behaviour is not
complete until every document describing it is updated in the same change.

- [ ] **Step 6: Commit**

```powershell
git add -- tests/tooling/docReferences.test.ts docs/agents/RULES.md
git commit -m "test(docs): a doc naming a path that no longer exists fails the branch"
```

## Amendment, 2026-09-22 — sources and principles (owner instruction: "according to best practices of Claude anthropic and findings from online benchmarks")

The authority for every judgement in this plan is `.superpowers/sdd/2026-09-22-docs-reorganisation/research-best-practices.md`: claim, source, date and exact quote, each rule flagged MEASURED (Anthropic's own docs, or a replicated study) or PRACTITIONER. Nine rules came back MEASURED, one PRACTITIONER and explicitly not bound. The plan does not restate that file; the binding changes it forces are below, and the after-grading scores against its rule list rather than against anyone's taste.

**Binding, added to Global Constraints:**

- **Root `CLAUDE.md` is at or under 200 lines** — Anthropic's own stated threshold, not a number we invented. `tests/tooling/claudeMdScope.test.ts` (Task 1) gains a line assertion beside its word budget.
- **`@path` imports never count as a saving.** Anthropic's docs state an imported file "still load[s] and enter[s] the context window at launch". Only a nested subdirectory `CLAUDE.md` or a path-scoped `.claude/rules/*.md` defers loading — which is exactly the split Task 1 already made. The same test asserts the root file contains no `@` import line, so no later edit buys a smaller word count with a file that loads anyway.
- **Emphasis is rationed.** Undifferentiated `IMPORTANT`/ALL-CAPS/bold-as-alarm dilutes the markers that matter; the test caps their count in the root file and the count may only fall.
- **The single most load-bearing sentence of an always-loaded document sits in its first or last paragraph, never mid-file.** Two independent studies (Liu et al. 2023; Chroma's context-rot replication across 18 frontier models, 2025) agree retrieval is most reliable at the boundaries and that the effect *sharpens* with length. This binds Tasks 2, 8, 11-14: each doc's opening paragraph carries its own thesis, and no rule that a reader must obey is buried in the middle of a long file.
- **Pointer over inline is Anthropic's stated preference, not our style.** Their context-engineering guidance names CLAUDE.md's up-front loading as the failure mode it argues against and recommends just-in-time retrieval. Where a task weighs inlining against a pointer, the pointer wins unless the material is needed in every session.

**Task 15 is re-founded, and narrowed.** The research found *no* evidence in either direction on comment density and model comprehension: one large study finds comment *language* dominates with no consistent density effect, the other is a single unreplicated study about comment *accuracy*. So the comment pass is justified by this repo's own `CLAUDE.md` § Comments rule and by diff hygiene — nothing else. It deletes what the four reasons condemn, one comment at a time, and it sets **no density target**: the 19.1% baseline is a measurement to report against, never a number to hit. A comment that survives the four reasons stays, whatever the percentage does.

**The after-grading rubric** is the nine MEASURED rules plus this repo's own normative list (`docs/agents/RULES.md`) and `CLAUDE.md` § Comments. A grade is stated per file with the rule it failed; "reads well" is not a grade.
