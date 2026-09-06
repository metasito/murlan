# Queue Loop Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ticket queue loop's context boundary match its process boundary (one ticket = one fresh process, not one line in an endless session), fix the model/review inconsistencies found in review, and make CLAUDE.md / `docs/agents/RULES.md` / `.claude/commands/queue.md` / this session's memory say each fact exactly once.

**Architecture:** An outer Node script (`scripts/queue-loop.mjs`) becomes the thing that never stops. It asks `next-ticket.mjs` for a route, and while a route is takeable, spawns one `claude -p "/queue"` per ticket and waits for it to exit before spawning the next. `queue.md` itself shrinks: it no longer loops or holds a ticket-count budget — it runs phases A–F exactly once, for one ticket, then exits and lets the outer script start the next process. Everything else already derived from git/the tracker (loop-status.mjs, loop-gate.mjs) needs no change, because it never assumed a shared session in the first place.

**Tech Stack:** Node (`node --test`), the existing `execFileSync`/pure-function-export pattern from `scripts/next-ticket.mjs`, `claude -p` headless mode.

**Spec:** This document's Decisions section (below) is the spec — the work is small enough that splitting spec and plan into two files nobody re-reads separately would be its own violation of "one source of truth."

## Decisions

Each numbered finding is from the prior review. Superseded/rejected options are listed so nobody re-proposes them without knowing why they were cut.

1. **Ticket = process boundary.** `queue.md` phase F no longer says "take the next ticket" in the same session; it exits. `scripts/queue-loop.mjs` is a new, permanently-running outer loop: check route → if takeable, `spawnSync("claude", ["-p", "/queue", "--permission-mode", "auto"], {stdio: "inherit"})` → repeat; if `handoff`, exit 0. This is Anthropic's own documented fan-out pattern (`for f in ...; do claude -p ...; done`), just polling the tracker instead of a static file list.
2. **Stop hook: rejected, superseded by (1).** A Stop hook can only block one session from ending; it can't make a process that already exited start a new one. Once an external script owns the "keep going" loop, "never stop" is mechanical (`while` loop) and needs no in-session enforcement. Dropped.
3. **Context-size budget: rejected, superseded by (1).** The ticket-count budget (`argument-hint: "[max-tickets]"`, default 5) was a proxy for "context is filling up." Under (1) there is no cross-ticket context to fill — each ticket gets a fresh process — so the proxy is deleted rather than replaced. `queue-loop.mjs` has no iteration cap; it stops exactly when `next-ticket.mjs` says `handoff`, same as today's "queue empty" halt.
4. **Model: `queue.md` frontmatter `model: opus` → `model: sonnet`.** Rule 29 (`docs/agents/RULES.md`): "Implementing, verifying, landing: sonnet." Phase C (build) and E (land) run directly in the orchestrating session, which is exactly that work — it should not be paying opus-per-token. Phase D's subagent keeps its own explicit `opus` override (independent review, per the same rule); phase B keeps `sonnet`. No change needed there — the fix is only the outer frontmatter.
5. **Phase D stays a single subagent, not `mattpocock-skills:code-review`'s two-axis parallel shape — documented, not silent.** The packaged skill runs Standards and Spec as two parallel subagents; `queue.md`'s reviewer is one subagent because `loop-gate.mjs` needs a single sha-bound `VERDICT: LAND <sha>` line, and doubling the subagent count doubles opus spend across up to 4 review rounds for a marginal gain (the single prompt already asks both "in scope" and "correct" questions). Add one sentence to `queue.md` recording this trade-off so it reads as a decision, not drift. Rejected alternative: two parallel opus subagents + a merge step — costs 2x opus per round for a fix that a slightly better single prompt already covers.
6. **Single source of truth, three layers, one ownership map:**
   - `docs/agents/RULES.md` — the rule, once, numbered. (Already declared authoritative; enforced by `tests/rulesAreSingleSourced.test.ts`.)
   - `.claude/commands/queue.md` — the procedure that follows the rules. Enforced by the same test plus `tests/loopDocsAreExecutable.test.ts` (every named script/command must actually exist).
   - `CLAUDE.md` — pointers only, already structured this way.
   - **My memory (outside the repo, not covered by any repo test)** — must cite RULES.md/queue.md by name or section, never restate their content. This is the one layer with no automated gate, because it isn't a repo file; keeping it aligned is my own bookkeeping, done as part of this plan and re-checked whenever `queue.md` changes again.

## Global Constraints

- Every fact lives in exactly one file; every other file points at it by name — enforced by `tests/rulesAreSingleSourced.test.ts` for CLAUDE.md/queue.md/triage.md/wayfinder.md/issue-tracker.md/loops.md/domain.md.
- Every script/command `queue.md` names must exist — enforced by `tests/loopDocsAreExecutable.test.ts`.
- Model per sub-agent per rule 29: haiku (mechanical), sonnet (implement/verify/land), opus (independent review).
- Never `git add -A`; stage by pathspec (rule 11).
- New script follows `scripts/next-ticket.mjs`'s convention: pure logic in exported functions, guarded `isInvokedDirectly` side-effecting block at the bottom, so tests import without shelling out.
- No changes to `loop-status.mjs`, `loop-gate.mjs`, `next-ticket.mjs`, `preflight.mjs` — verified in Task 6, not modified, because none of them assumed a shared session across tickets in the first place.

---

## File Structure

- **Modify:** `.claude/commands/queue.md` — drop the ticket-count budget and in-session loop; phase F exits instead of continuing; frontmatter `model: opus` → `sonnet`; phase D gets one documenting sentence.
- **Modify:** `tests/rulesAreSingleSourced.test.ts` — extend the "procedure lives in queue.md only" list with the new facts, and add a frontmatter-model assertion. Written and run failing *before* `queue.md` changes (Task 1), confirmed passing after (Task 2).
- **Create:** `scripts/queue-loop.mjs` — the outer per-ticket-process driver.
- **Create:** `tests/queueLoop.test.ts` — unit tests for `queue-loop.mjs`'s exported pure functions.
- **Modify:** `package.json` — add `"queue:loop": "node scripts/queue-loop.mjs"`.
- **Read, amend only if needed:** `docs/agents/issue-tracker.md` — check for any cadence assumption the rewrite breaks.
- **Outside the repo (my memory, not a code task but part of this plan):** `murlan-endless-queue-loop.md`, `MEMORY.md` index line, `sequential-one-ticket-at-a-time.md`.

---

## Task 1: Extend the single-source-of-truth test to guard the new facts (red first)

**Files:**
- Modify: `tests/rulesAreSingleSourced.test.ts`

**Interfaces:**
- Consumes: the file's existing `read()` helper and the `INSTRUCTION_FILES` list (unchanged).
- Produces: nothing new is imported elsewhere — this is a leaf test file.

- [ ] **Step 1: Add the model-value assertion**

Add this test inside the existing `describe` block, after the `RULE_PHRASES` loop:

```ts
test("queue.md builds each ticket at sonnet, not opus", () => {
  const queue = read(".claude/commands/queue.md");
  const model = queue.match(/^model:\s*(\S+)/m)?.[1];
  assert.equal(
    model,
    "sonnet",
    "queue.md's own frontmatter model runs phases C and E directly (implement/verify/land, " +
      "rule 29) — it should not be opus. Phase D's subagent keeps its own opus override."
  );
});
```

- [ ] **Step 2: Add the new procedure-lives-in-queue.md-only facts**

Add these two entries to the existing array literal (the one starting `["how the review is recorded", ...]`, around line 74):

```ts
["the loop is one ticket per process", /one ticket per (claude )?process/i],
["there is no ticket-count budget", /queue-loop\.mjs/i],
```

- [ ] **Step 3: Run the suite and confirm it fails for the right reason**

Run: `node --test tests/rulesAreSingleSourced.test.ts`
Expected: FAIL — `"queue.md builds each ticket at sonnet, not opus"` fails because the frontmatter still says `opus`; `"the loop is one ticket per process"` and `"there is no ticket-count budget"` fail their `assert.ok(pattern.test(read(".claude/commands/queue.md")))` check because neither phrase exists yet.

- [ ] **Step 4: Commit**

```bash
git add -- tests/rulesAreSingleSourced.test.ts
git commit -m "test: pin the queue loop's new single-sourced facts (red)"
```

---

## Task 2: Rewrite `.claude/commands/queue.md` to make Task 1 pass

**Files:**
- Modify: `.claude/commands/queue.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: the frontmatter and phase text that `tests/rulesAreSingleSourced.test.ts` and `tests/loopDocsAreExecutable.test.ts` check against.

- [ ] **Step 1: Frontmatter**

Change:

```yaml
---
description: Work the ticket queue autonomously, one ticket at a time
argument-hint: "[max-tickets]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, Skill, SlashCommand, TodoWrite
model: opus
---
```

to:

```yaml
---
description: Work one ticket, then exit — scripts/queue-loop.mjs starts the next process
argument-hint: "[issue-number]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, Skill, SlashCommand, TodoWrite
model: sonnet
---
```

(`argument-hint` now takes an explicit issue number for manual/debugging use — `node scripts/next-ticket.mjs <n>` already supports this per its existing `explicit` branch — rather than a ticket-count budget that no longer means anything.)

- [ ] **Step 2: Replace the Phase 0 closing line**

Find:

```
Then run phases A–F per ticket until the budget is spent (default 5, or `$1`), the queue is empty,
or a stop condition fires.
```

Replace with:

```
Then run phases A–F once, for exactly one ticket per process. `scripts/queue-loop.mjs` is what
keeps going — it is a fresh `claude -p "/queue"` invocation that starts the next ticket, not this
session continuing. There is no ticket-count budget: nothing survives past phase F for a budget to
protect.
```

- [ ] **Step 3: Replace Phase F step 5**

Find:

```
5. Take the next ticket. There is no state to reset: the next `git worktree add` is what says which
   ticket you are on, and the previous ticket's review cannot follow you to it.
```

Replace with:

```
5. **Exit.** One ticket per process, by design (`docs/superpowers/plans/2026-09-06-loop-rewrite.md`):
   `scripts/queue-loop.mjs` starts the next ticket in a clean process, so there is nothing here to
   reset and nothing that can leak forward. Do not loop back to phase A in this session.
```

- [ ] **Step 4: Update the Halt list**

Find:

```
Budget spent · queue empty · route `handoff` · preflight red · three failed CI rounds on the same
failure · a decision only the owner can make **that parking cannot carry**.
```

Replace with:

```
Queue empty · route `handoff` · preflight red · three failed CI rounds on the same
failure · a decision only the owner can make **that parking cannot carry**. `queue-loop.mjs` checks
for an empty queue before it even starts a process; this list is the fallback for a `/queue` run
started by hand.
```

- [ ] **Step 5: Document the Phase D trade-off (Decision 5)**

In Phase D, immediately after the closing `Post that line verbatim as a comment on the issue:` code block, add:

```
This is one subagent, not `mattpocock-skills:code-review`'s two-axis parallel shape — deliberately.
`loop-gate.mjs` binds to a single sha-tagged `VERDICT: LAND <sha>` line, and running Standards and
Spec as two parallel opus subagents would double review cost across up to 4 rounds for a prompt that
already asks both questions. See Decision 5 in the plan above if this trade-off ever needs revisiting.
```

- [ ] **Step 6: Run both guarding tests**

Run: `node --test tests/rulesAreSingleSourced.test.ts tests/loopDocsAreExecutable.test.ts`
Expected: PASS — Task 1's three new assertions now pass, and `loopDocsAreExecutable` stays green because `queue-loop.mjs` doesn't exist as a *named script inside queue.md's own `node scripts/x.mjs` calls* (it's referenced in prose, not as a runnable step queue.md tells the agent to invoke — queue.md never calls it, the outer driver calls queue.md).

- [ ] **Step 7: Commit**

```bash
git add -- .claude/commands/queue.md
git commit -m "refactor(queue): one ticket per process, sonnet build, documented review trade-off"
```

---

## Task 3: `scripts/queue-loop.mjs` — the outer driver, TDD

**Files:**
- Create: `scripts/queue-loop.mjs`
- Test: `tests/queueLoop.test.ts`

**Interfaces:**
- Consumes: the stdout contract `next-ticket.mjs` already prints on its first line: `ROUTE\t<skill>\t<number>\t<title>` (see `scripts/next-ticket.mjs:200`).
- Produces: `parseRoute(stdout: string): { skill: string, number: number, title: string }` and `shouldStop(route: { skill: string }): boolean`, both exported for the test; a guarded `main()` side-effecting block that only runs when invoked directly (mirrors `next-ticket.mjs`'s `isInvokedDirectly` pattern).

- [ ] **Step 1: Write the failing tests**

Create `tests/queueLoop.test.ts`:

```ts
// tests/queueLoop.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, shouldStop } from "../scripts/queue-loop.mjs";

describe("parseRoute", () => {
  test("reads the ROUTE line next-ticket.mjs prints", () => {
    const stdout = "ROUTE\timplement\t824\tFix the lamp swing\nSTATUS\timplement:3\ttriage:1\n";
    assert.deepEqual(parseRoute(stdout), { skill: "implement", number: 824, title: "Fix the lamp swing" });
  });

  test("handles the handoff route, which carries no ticket", () => {
    const stdout = "ROUTE\thandoff\t0\tnothing agent-takeable\n";
    assert.deepEqual(parseRoute(stdout), { skill: "handoff", number: 0, title: "nothing agent-takeable" });
  });

  test("throws on output with no ROUTE line, rather than silently looping forever", () => {
    assert.throws(() => parseRoute("some unrelated error\n"), /no ROUTE line/);
  });
});

describe("shouldStop", () => {
  test("stops on handoff", () => {
    assert.equal(shouldStop({ skill: "handoff" }), true);
  });

  for (const skill of ["implement", "triage", "wayfinder"]) {
    test(`keeps going on ${skill}`, () => {
      assert.equal(shouldStop({ skill }), false);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/queueLoop.test.ts`
Expected: FAIL with `Cannot find module '../scripts/queue-loop.mjs'`

- [ ] **Step 3: Write `scripts/queue-loop.mjs`**

```js
// scripts/queue-loop.mjs
/**
 * The loop that never stops. `.claude/commands/queue.md` runs one ticket per process and exits;
 * this is what starts the next one, in a clean process, so no ticket's context reaches the next.
 *
 * No iteration cap and no context budget: there is nothing here for a budget to protect, since
 * nothing survives past one `claude -p` call. The only stop condition is the tracker itself
 * reporting nothing takeable (`ROUTE handoff`), same halt `queue.md` already defines for a
 * by-hand run.
 *
 * Usage: node scripts/queue-loop.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function isInvokedDirectly(argv1, moduleUrl) {
  return Boolean(argv1) && path.resolve(argv1) === fileURLToPath(moduleUrl);
}

/** @returns {{ skill: string, number: number, title: string }} */
export function parseRoute(stdout) {
  const line = stdout.split("\n").find((l) => l.startsWith("ROUTE\t"));
  if (!line) throw new Error("no ROUTE line in next-ticket.mjs output");
  const [, skill, number, title] = line.split("\t");
  return { skill, number: Number(number), title };
}

export function shouldStop(route) {
  return route.skill === "handoff";
}

function nextRoute() {
  const stdout = execFileSync("node", ["scripts/next-ticket.mjs"], { encoding: "utf8" });
  return parseRoute(stdout);
}

function runOneTicket() {
  const result = spawnSync("claude", ["-p", "/queue", "--permission-mode", "auto"], {
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function main() {
  for (;;) {
    const route = nextRoute();
    if (shouldStop(route)) {
      console.log(`queue-loop: ${route.title} — stopping`);
      return 0;
    }
    console.log(`queue-loop: starting #${route.number} ${route.title} (${route.skill})`);
    const status = runOneTicket();
    if (status !== 0) {
      console.error(`queue-loop: claude -p exited ${status}, stopping rather than looping on a broken run`);
      return status;
    }
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  process.exit(main());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/queueLoop.test.ts`
Expected: PASS, all 6 cases.

- [ ] **Step 5: Add the package.json script**

In `package.json`, add next to the other `scripts/*.mjs` entries (after `"reap"`):

```json
"queue:loop": "node scripts/queue-loop.mjs",
```

- [ ] **Step 6: Commit**

```bash
git add -- scripts/queue-loop.mjs tests/queueLoop.test.ts package.json
git commit -m "feat: add queue-loop.mjs, the per-ticket-process outer driver"
```

---

## Task 4: Verify `claude -p "/queue"` actually expands the project command headlessly

This is the one assumption in the plan that isn't provable by a unit test — it depends on this Claude Code build's headless-mode behavior, not on this repo's code.

**Files:** none (manual verification step, recorded here so it isn't skipped).

- [ ] **Step 1: Smoke-test with an explicit ticket number, on whatever the queue currently holds**

Run by hand, in the shared checkout, while free (i.e. `node scripts/preflight.mjs` is currently clean):

```bash
claude -p "/queue" --permission-mode auto
```

- [ ] **Step 2: Confirm the transcript shows `queue.md`'s own phase language (Phase 0 bootstrap, "A — Take", etc.), not a literal echo of the string `/queue`.**

If it echoes literally: headless mode in this build does not expand project commands from `-p`, and Task 3's `runOneTicket()` needs its prompt changed from `"/queue"` to the command's own body inlined as plain instructions (a one-line change, but blocked on this finding). Record the result as a comment at the top of `queue-loop.mjs`'s `runOneTicket()` either way, so the next reader isn't left re-deriving it.

---

## Task 5: Reconcile `docs/agents/issue-tracker.md`

**Files:**
- Read: `docs/agents/issue-tracker.md`
- Modify only if a cadence assumption is found.

- [ ] **Step 1: Read the whole file**

Look specifically for any statement implying the loop is one continuous session across tickets (e.g. language like "during a run" spanning multiple tickets, or claiming/labels timing that assumes same-session continuity).

- [ ] **Step 2a: If nothing assumes shared-session cadence — no edit.** Note that in the commit message of Task 6 instead of making an empty commit here.

- [ ] **Step 2b: If something does — fix it, then re-run the guarding tests**

Run: `node --test tests/rulesAreSingleSourced.test.ts tests/loopDocsAreExecutable.test.ts`
Expected: PASS.

```bash
git add -- docs/agents/issue-tracker.md
git commit -m "docs: reconcile issue-tracker.md with the one-ticket-per-process loop"
```

---

## Task 6: Full verification sweep

**Files:** none created; this task only runs checks.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no `.mjs` files are typechecked, but this catches any accidental TS breakage from the plan's other edits).

- [ ] **Step 2: The three guarding suites together**

Run: `node --test tests/rulesAreSingleSourced.test.ts tests/loopDocsAreExecutable.test.ts tests/queueLoop.test.ts`
Expected: PASS, all green.

- [ ] **Step 3: Lint**

Run: `npx eslint scripts/queue-loop.mjs tests/queueLoop.test.ts tests/rulesAreSingleSourced.test.ts`
Expected: PASS.

- [ ] **Step 4: Note Task 5's outcome in this commit if it produced no separate commit**

```bash
git add -- docs/superpowers/plans/2026-09-06-loop-rewrite.md
git commit -m "docs: record loop rewrite plan and issue-tracker.md reconciliation outcome"
```

---

## Task 7: Align memory (outside the repo — my bookkeeping, not a repo commit)

No repo test can gate this; it's recorded here so it isn't dropped once the code tasks feel "done."

- [ ] **Step 1: Rewrite `murlan-endless-queue-loop.md`**

Remove the claim that tickets go through `Skill(skill="mattpocock-skills:implement")` (false as of this rewrite — phase C calls `mattpocock-skills:tdd`/`diagnosing-bugs` directly) and the claim that review goes through `mattpocock-skills:code-review` by name (false — it's the documented single-subagent trade-off from Decision 5). Replace both with a pointer: "see `.claude/commands/queue.md`, phases C and D, for the current procedure — this memory does not restate it." Add the process-per-ticket fact and the `sonnet`-for-build fact, each as a one-line pointer to the plan/queue.md, not a restatement.

- [ ] **Step 2: Add the discipline note itself**

Append to the same memory file: "This memory cites `docs/agents/RULES.md` and `.claude/commands/queue.md` by name; it does not restate their content. If a fact here and a fact in either of those files disagree, those files win and this memory is stale — fix it." (Mirrors `docs/agents/RULES.md`'s own header sentence, applied to the one layer the repo's tests can't reach.)

- [ ] **Step 3: Update `MEMORY.md`'s index line for this memory**

Keep it under 150 characters, reflect the corrected content.

- [ ] **Step 4: Check `sequential-one-ticket-at-a-time.md` for staleness**

If it currently reads as a policy the agent must remember, add one clause noting it is now mechanically enforced by `queue-loop.mjs` (one `claude -p` call per ticket) rather than only a stated policy — same fact, stronger source.

---

## Self-Review

**Spec coverage:** Decision 1 → Tasks 2, 3, 4. Decision 2/3 → Task 2 Steps 2/4 (deletion). Decision 4 → Task 2 Step 1 + Task 1 Step 1. Decision 5 → Task 2 Step 5. Decision 6 → Tasks 1, 5, 7. Every decision has a task.

**Placeholder scan:** No TBD/TODO; every step shows literal code or literal diff text; no "similar to Task N."

**Type consistency:** `parseRoute` and `shouldStop` are used with the same shape (`{ skill, number, title }` / `{ skill }`) in both the test file and the implementation. `isInvokedDirectly` signature matches `next-ticket.mjs`'s existing export exactly, so a future reader isn't surprised by two different guards doing the same job.

---

Plan complete and saved to `docs/superpowers/plans/2026-09-06-loop-rewrite.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
