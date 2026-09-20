# Loop Pending Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every open loop defect found in the v4 review — the loop discards CI failures it has already read, parks healthy branches, and reports the wrong phase — so an overnight run lands tickets instead of parking them.

**Architecture:** All changes are inside `tools/loop/`, which is its own product with its own gate. Three deliverables land as three pull requests, in dependency order: phase correctness first (everything downstream reads the phase), then the CI-RED handover and the turn-cap handoff, then the instruments. Each PR is reviewed by `/code-review` before the push, and merged only on green CI.

**Tech Stack:** Node 22, plain `.mjs` for the supervisor, `.ts` (type-stripped) for the CI reader and the tests. `node --test` via `npm run loop:test`. No new dependencies.

**Spec:** GitHub issues [#1150](https://github.com/metasito/murlan/issues/1150) (items 1–7), [#1142](https://github.com/metasito/murlan/issues/1142) (board design, blocked on Task 1), [#1134](https://github.com/metasito/murlan/issues/1134) (v4 follow-up; Part 1 is measured in #1150's evidence).

## Global Constraints

- `docs/agents/RULES.md` is the only normative rule list. Nothing here restates it (`tests/rulesAreSingleSourced.test.ts`).
- Comment budget: a change may add at most **six** comment lines (three in a test) *and* no more comment lines than code, counted across the whole branch against `origin/main`. `tools/loop/guard-comments.mjs` refuses the write.
- No bare literals for timing; loop code uses named module constants.
- **No self-defeating safeguards.** A check that can be satisfied without the thing it guards being true is worse than none.
- Never run jest or Playwright locally — CI is the test runner. `npx tsc --noEmit`, `npx eslint <paths>` and `node --test` on loop tests are the local gate.
- Every commit ends with the two attribution lines used by this repo.
- Files go through Read/Edit/Write, never batch shell rewrites.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `tools/loop/loop-derive.mjs` | Derives the whole run state from git + tracker | Add phase `B` for a claimed, unworked worktree |
| `tools/loop/loop-status.mjs` | Renders that state for a session | Add the `B` line to the `next` map |
| `tools/loop/queue-loop.mjs` | Supervisor: spawns, reads the stream, posts CI-RED, parks | `exhausted()`, turn-cap handoff, `ciRedBody` rewrite |
| `tools/loop/loop-cost.mjs` | Ledger reporting | Window the fix-round share; fix the wrong-model flag |
| `tools/loop/guard-context.mjs` | PostToolUse notice hook | Stop re-reading the transcript per call |
| `.claude/commands/queue.md` | The loop protocol | Fix round must read the failed log |
| `tools/loop/tests/*.test.ts` | The gate | One test per behaviour below |

---

## Task 1: A claimed, unworked worktree derives phase B

**Why:** `loop-derive.mjs:452` returns `C` when `commits === 0`. `loop-status.mjs`'s `next` map has no `B` at all. So a freshly claimed ticket is told "C — Build"; the session declares `PHASE C`, reads queue.md, finds it owes a scope pass and declares `PHASE B`. Every step row the board prints is therefore transposed (`#1088` showed `build 0:33` then `scope 47:34`, where the 47 minutes *is* the build), and `loop-cost` bills the build to B — which is why B reads 52% of spend and C 4.7 minutes.

**Files:**
- Modify: `tools/loop/loop-derive.mjs:452-462`
- Modify: `tools/loop/loop-status.mjs:44-51`
- Test: `tools/loop/tests/loopDerive.test.ts:444` (existing test pins the wrong behaviour), `tools/loop/tests/loopStatus.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `derive()` may now return `phase: "B"`. `report()` renders `B — Scope. One sonnet subagent maps the change, then build.` Everything switching on phase (`watchBuild`'s `state.phase !== "C"`, `MODEL_BY_PHASE.B === "opus"`, `HANDED = /^[A-G]$/`) already accepts B.

- [ ] **Step 1: Replace the test that pins the wrong behaviour**

In `tools/loop/tests/loopDerive.test.ts`, the existing case reads:

```ts
  test("nothing committed → C, no fix", () => {
    const s = at({ issue: { comments: land() } }, { base: BR });
    assert.equal(s.phase, "C");
```

Replace that test with the two cases the discriminator actually has:

```ts
  test("claimed and untouched → B, so the scope pass is what the board shows", () => {
    const s = at({ issue: { comments: land() } }, { base: BR });
    assert.equal(s.phase, "B");
    assert.equal(s.fix, false);
  });

  test("nothing committed but the tree is dirty → C: the build has begun", () => {
    writeFileSync(join(dir, "wip.txt"), "1");
    try {
      const s = at({ issue: { comments: land() } }, { base: BR });
      assert.equal(s.phase, "C");
    } finally {
      rmSync(join(dir, "wip.txt"), { force: true });
    }
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --experimental-strip-types --test tools/loop/tests/loopDerive.test.ts`
Expected: FAIL — `Expected values to be strictly equal: 'C' !== 'B'`.

- [ ] **Step 3: Derive B in `loop-derive.mjs`**

Replace line 452 and the head of the `why` ternary:

```js
  // A claimed worktree that is clean and has no commits has not been worked yet, so it owes its
  // scope pass. Deriving C there made every session declare `PHASE C` and then, on reading
  // queue.md, `PHASE B` — which transposed every step row the board printed.
  const scoping = commits === 0 && !dirty;
  let phase = scoping ? "B" : commits === 0 ? "C" : !verdict ? "D" : land ? "E" : "C";
  let why =
    commits === 0
      ? scoping
        ? "claimed, with nothing committed and nothing in the tree yet"
        : "nothing committed yet"
      : !trackerReadable
```

- [ ] **Step 4: Give `loop-status.mjs` its B line**

In `report()`, add to the `next` map, above `C`:

```js
      B: "B — Scope. One sonnet subagent maps the change, then build.",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tools/loop/tests/loopDerive.test.ts tools/loop/tests/loopStatus.test.ts tools/loop/tests/loopGate.test.ts tools/loop/tests/queueLoop.test.ts`
Expected: PASS, 0 fail. Any other test that asserted `phase === "C"` for a clean, commitless worktree was pinning the defect — update it the same way, and say so in the commit.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit` then `npx eslint tools/loop/loop-derive.mjs tools/loop/loop-status.mjs`
Expected: both silent.

- [ ] **Step 7: Commit**

```bash
git add tools/loop/loop-derive.mjs tools/loop/loop-status.mjs tools/loop/tests/loopDerive.test.ts
git commit -m "loop: a claimed, unworked worktree is at B, not C"
```

---

## Task 2: A session cut off mid-phase hands off instead of parking

**Why:** `reasonFor` already calls `error_max_turns` **soft**, but `handoffOf(run)` reads the handoff only out of the session's declared `LOOP-RESULT` — and a session killed by `--max-turns` never reaches it. #1090 died at 121 turns with six commits on its branch and a standing worktree, and the supervisor parked it: $10.23 discarded for want of a line the session had no turn left to write. The phase is derivable from git; that is what `derive()` exists for.

**Files:**
- Modify: `tools/loop/queue-loop.mjs` — near `handoffOf` (~:407), and the handoff block (~:2039)
- Test: `tools/loop/tests/queueLoop.test.ts`

**Interfaces:**
- Consumes: `derive()`'s `phase` (Task 1), through `after` in `runOnce`.
- Produces: `export const exhausted = (run) => boolean`. `runOnce` may return `{ outcome: "handoff", phase }` for a run that declared none. `MAX_HANDOFFS = 8` remains the floor that stops a loop.

- [ ] **Step 1: Write the failing test**

Add to `tools/loop/tests/queueLoop.test.ts`:

```ts
describe("a session cut off mid-phase", () => {
  test("exhausted() names the turn cap and the dollar cap, and nothing else", () => {
    assert.equal(exhausted({ result: { subtype: "error_max_turns" } }), true);
    assert.equal(exhausted({ stderr: "Budget limit reached ($15.08 of $15); stopping." }), true);
    assert.equal(exhausted({ result: { subtype: "success" }, stderr: "" }), false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tools/loop/tests/queueLoop.test.ts`
Expected: FAIL — `exhausted is not defined` (add it to the import list from `../queue-loop.mjs`).

- [ ] **Step 3: Add `exhausted` and use it in `reasonFor`**

Beneath `handoffOf`:

```js
/**
 * Cut off mid-phase by the turn cap or the per-session dollar cap. Such a session never reaches
 * its `LOOP-RESULT`, so it declares no handoff — which is not the same as having nothing to hand.
 *
 * @param {{result?: {subtype?: string}|null, stderr?: string}} run
 */
export const exhausted = (run) =>
  run.result?.subtype === "error_max_turns" || /Budget limit reached/.test(run.stderr ?? "");
```

and in `reasonFor`, replace `run.result?.subtype === "error_max_turns"` with `exhausted(run)`.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --experimental-strip-types --test tools/loop/tests/queueLoop.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the synthesised handoff**

```ts
  test("a turn-cap death with a live worktree hands the derived phase on, rather than parking", () => {
    const run = { result: { subtype: "error_max_turns" }, declared: null, stderr: "" };
    const after = { cwd: ".worktrees/agent-1090", phase: "C", branch: "agent/1090-x" };
    assert.equal(resumePhase(run, after), "C");
  });

  test("no worktree, or no derivable phase, is still a park", () => {
    const run = { result: { subtype: "error_max_turns" }, declared: null, stderr: "" };
    assert.equal(resumePhase(run, { cwd: null, phase: "C" }), null);
    assert.equal(resumePhase(run, { cwd: ".worktrees/agent-1", phase: "?" }), null);
  });

  test("a session that declared a handoff is untouched by it", () => {
    const run = { result: { subtype: "success" }, declared: { handoff: "D" }, stderr: "" };
    assert.equal(resumePhase(run, { cwd: ".worktrees/agent-1", phase: "C" }), null);
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --experimental-strip-types --test tools/loop/tests/queueLoop.test.ts`
Expected: FAIL — `resumePhase is not defined`.

- [ ] **Step 7: Implement `resumePhase` and wire it in**

Beneath `exhausted`:

```js
/**
 * The phase a cut-off session's successor starts at, or null when there is nothing to resume: no
 * worktree, no derivable phase, or a session that declared its own handoff and is not cut off.
 *
 * @param {{result?: {subtype?: string}|null, stderr?: string, declared?: object|null}} run
 * @param {{cwd?: string|null, phase?: string|null}|null} after
 */
export function resumePhase(run, after) {
  if (handoffOf(run) || !exhausted(run)) return null;
  const phase = after?.phase ?? null;
  return after?.cwd && phase && phase !== "?" ? phase : null;
}
```

In `runOnce`, immediately after `let handoff = handoffOf(run);`:

```js
  handoff ??= resumePhase(run, after);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tools/loop/tests/queueLoop.test.ts tools/loop/tests/queueLoopMain.test.ts tools/loop/tests/settleReplay.test.ts`
Expected: PASS, 0 fail.

- [ ] **Step 9: Commit**

```bash
git add tools/loop/queue-loop.mjs tools/loop/tests/queueLoop.test.ts
git commit -m "loop: a session cut off mid-phase hands off, it does not park"
```

---

## Task 3: CI-RED hands over a reference, and stops summarising the failure

**Why:** `FAILING_LINE_MAX = 200` truncates `failing:` by characters, so #1088's round 1 named 1 of 11 failing ids and hid `tests/fontSubset.test.ts` and `tests/iconSubset.test.ts` behind `+10 more`. Those two were red, identically, in all three CI runs; the whole remaining fix was two `node scripts/build-*.mjs` commands, and the string `build-fonts` appears nowhere in `.loop-logs/1088.jsonl`. Round 2 hid them again. Round 3 named them, one round after the cap — the ticket parked. Separately, `EXCERPT_LINES = 8` takes the *tail* of the failed step, which in rounds 1 and 2 was actions/checkout cleanup, so the excerpt could not recover them either.

Both are the same mistake: compressing a failure the agent could read itself. `verdict.testIds` already carries **every** id the full log named — only the comment throws them away.

**Files:**
- Modify: `tools/loop/queue-loop.mjs:1632-1678` (`FAILING_LINE_MAX`, `failingLine`, `ciRedBody`)
- Modify: `.claude/commands/queue.md:122-135` (phase C's fix round)
- Test: `tools/loop/tests/queueLoop.test.ts` (or wherever `ciRedBody` is pinned today — `tools/loop/tests/loopDerive.test.ts` imports it for `ciRedRounds`)

**Interfaces:**
- Consumes: `verdict.testIds: string[]` (ids shaped `path › name`), `verdict.runId: number`, `verdict.output: string`.
- Produces: `ciRedBody` keeps its `CI-RED <sha>` first line so `ciRedRounds` and `ciRedPosted` still count it. New exported helper `failingFiles(testIds): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
describe("a CI-RED comment hands over every failing file", () => {
  const ids = [
    "tests/e2e/offlineMatch.spec.ts › a match plays multiple hands and exercises the card exchange",
    "tests/fontSubset.test.ts › the subsets carry every character the app can render",
    "tests/iconSubset.test.ts › the shipped subsets carry a glyph for every name the app renders",
  ];

  test("no id is dropped, however long the others are", () => {
    const body = ciRedBody({ sha: "abc", runUrl: "u", failedStep: "Test", testIds: ids, runId: 7 });
    assert.match(body, /tests\/fontSubset\.test\.ts/);
    assert.match(body, /tests\/iconSubset\.test\.ts/);
    assert.doesNotMatch(body, /\+\d+ more/);
  });

  test("it states how many files are red, which is what makes 'I have them all' checkable", () => {
    const body = ciRedBody({ sha: "abc", runUrl: "u", testIds: ids, runId: 7 });
    assert.match(body, /3 failing files/);
  });

  test("it carries the command that prints the failure, against this run", () => {
    const body = ciRedBody({ sha: "abc", runUrl: "u", testIds: ids, runId: 7 });
    assert.match(body, /gh run view 7 --log-failed/);
  });

  test("with no id parsed, the excerpt is still the only signal, so it stays", () => {
    const body = ciRedBody({ sha: "abc", runUrl: "u", testIds: [], excerpt: "error TS2322: nope", runId: 7 });
    assert.match(body, /error TS2322/);
  });

  test("the first line is unchanged, so ciRedRounds still counts it", () => {
    assert.match(ciRedBody({ sha: "abc", runUrl: "u", testIds: ids, runId: 7 }), /^CI-RED abc$/m);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tools/loop/tests/loopDerive.test.ts`
Expected: FAIL on `+N more` and on the missing `3 failing files` line.

- [ ] **Step 3: Replace `failingLine` with `failingFiles` and rewrite `ciRedBody`**

Delete `FAILING_LINE_MAX` and `failingLine`. Add:

```js
/** The distinct files behind a run's failing test ids — the count of fix rounds the branch needs. */
export const failingFiles = (testIds) => [...new Set(testIds.map((id) => id.split(" › ")[0]))];
```

and:

```js
export function ciRedBody({ sha, runUrl, failedStep, testIds = [], excerpt = "", shared = "none", runId }) {
  const files = failingFiles(testIds);
  // Not a summary of the failure: the reference to it. Every heuristic that tried to fit one into
  // a comment threw away the part that mattered (#1150).
  const body = [
    `CI-RED ${sha}`,
    `run: ${runUrl} · step: ${failedStep ?? "an unnamed step"}`,
    `failing: ${files.length} failing files, ${testIds.length} tests — read them, do not guess:`,
    "```sh",
    `gh run view ${runId} --log-failed | grep -E "✖|AssertionError|error TS|FAIL " -A5`,
    "```",
    ...files.map((f) => `- ${f}`),
    `shared: ${shared}`,
  ];
  if (files.length === 0) body.push("```", ...excerpt.split("\n").slice(-EXCERPT_LINES), "```");
  return body.join("\n");
}
```

Pass `runId: verdict.runId` at the `postCiRedOnce` call site.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --experimental-strip-types --test tools/loop/tests/loopDerive.test.ts tools/loop/tests/queueLoop.test.ts tools/loop/tests/sharedRed.test.ts`
Expected: PASS, 0 fail.

- [ ] **Step 5: Make the fix round read the log**

In `.claude/commands/queue.md`, phase C's fix-round paragraph, the `gh run view … --log-failed` block is today a *fallback*. Make it the required first act, and add the falsifiable bound:

> **Read the thread's `CI-RED` comment first, then read the failed log it points at.** The comment
> states how many files are red; a round that has diagnosed fewer than that number has not
> finished. A cheap subagent may do the reading and return the list.

- [ ] **Step 6: Check the docs gate**

Run: `node --experimental-strip-types --test tools/loop/tests/loopDocsAreExecutable.test.ts && node --test tests/rulesAreSingleSourced.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tools/loop/queue-loop.mjs .claude/commands/queue.md tools/loop/tests/
git commit -m "loop: CI-RED hands over the failure, it no longer summarises it away"
```

---

## Task 4: Open the pull request for Tasks 1–3, review it, merge on green

- [ ] **Step 1: Run the local gate**

Run: `npx tsc --noEmit && npx eslint tools/loop && npm run loop:test && node tools/loop/comment-budget.mjs`
Expected: all clean. **Do not** run jest or Playwright.

- [ ] **Step 2: Review the diff before pushing**

Run `/code-review` scoped to the branch diff. Every finding is either fixed or answered in the PR body. A review that raises a regression in a path the diff touches blocks the push.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin loop/1150-phase-and-ci-red
gh pr create --fill --body-file <(printf '%s\n' "Closes part of #1150 — items 1, 2, 3 and 4.")
```

- [ ] **Step 4: Wait for CI, then merge**

Merge with `gh pr merge --merge --delete-branch` only once every check is green. A red check is diagnosed from its own log, never re-run hoping.

---

## Task 5: The instruments stop lying

**Why:** two figures in `loop-cost` cannot fail meaningfully. `mismatchedModel()` compares the session's **costliest** model family against `MODEL_BY_PHASE[first phase]`, so any opus session whose sonnet subagents outspend it trips — it flags 62 rows including every v4 ticket. And fix-round share ignores the ticket filter: `loop-cost` printed the identical `$52.19 (6%)` for the whole 51-ticket ledger and for a 6-ticket window, so #1134's target for it cannot be measured at all.

**Files:**
- Modify: `tools/loop/loop-cost.mjs:131-136` (`mismatchedModel`), and the fix-round tally in `summary`/`ledger`
- Test: `tools/loop/tests/loopCost.test.ts`

**Interfaces:**
- Consumes: a ledger row's `models` map and its `phases`.
- Produces: `mismatchedModel(row)` judged against the row's own spawned model when the ledger records one; fix-round total computed from the filtered rows.

- [ ] **Step 1: Write the failing tests**

```ts
test("a session on its planned model is not a mismatch, whatever its subagents cost", () => {
  const row = { phases: { C: 1 }, models: { "claude-opus-5": 2, "claude-sonnet-5": 9 }, model: "opus" };
  assert.equal(mismatchedModel(row), false);
});

test("a session actually spawned on the wrong model is", () => {
  const row = { phases: { C: 1 }, models: { "claude-sonnet-5": 9 }, model: "sonnet" };
  assert.equal(mismatchedModel(row), true);
});

test("fix-round spend respects the ticket window", () => {
  const all = ledger(rowsFixture);
  const one = ledger(rowsFixture.filter((r) => r.n === 1090));
  assert.notEqual(all.fixCost, one.fixCost);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-strip-types --test tools/loop/tests/loopCost.test.ts`
Expected: FAIL on both.

- [ ] **Step 3: Judge the model the session was spawned on**

`queueLoopArgs` already passes `--model plannedModel(phase)`. Record that model on the ledger row when the run is recorded, and compare against it; fall back to the costliest-model reading **only** when the row predates the field, and exclude such rows from the flag rather than guessing.

- [ ] **Step 4: Window the fix-round tally**

Compute the fix-round total from the same filtered row set the rest of the table uses, not from the whole ledger.

- [ ] **Step 5: Run to verify they pass, then check the real numbers**

Run: `node --experimental-strip-types --test tools/loop/tests/loopCost.test.ts && node tools/loop/loop-cost.mjs 1085+`
Expected: tests pass; the printed fix-round figure differs from the all-ticket run's.

- [ ] **Step 6: Commit**

```bash
git add tools/loop/loop-cost.mjs tools/loop/tests/loopCost.test.ts
git commit -m "loop-cost: the wrong-model flag and the fix-round share say something falsifiable"
```

---

## Task 6: `guard-context.mjs` stops re-reading the transcript per tool call

**Why:** the hook matches `Bash|Read|Grep|Glob|Agent|Task|WebFetch` and on **each** call reads up to `TAIL_BYTES = 4 MB` of transcript and JSON-parses every line, to decide whether two notices have already been said. #1088 made 483 matching calls in one ticket.

**Files:**
- Modify: `tools/loop/guard-context.mjs`
- Test: `tools/loop/tests/guardContext.test.ts`

**Interfaces:**
- Consumes: the PostToolUse payload's `session_id` and `transcript_path`.
- Produces: unchanged stdout contract — `hookSpecificOutput.additionalContext`, exit 0 always.

- [ ] **Step 1: Write the failing test**

```ts
test("a notice is said once per session without re-reading the transcript to find out", () => {
  const reads = [];
  const first = notices(payload, (f) => (reads.push(f), transcriptOverCeiling));
  const second = notices(payload, (f) => (reads.push(f), transcriptOverCeiling));
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(reads.length, 1, "the second call read the transcript again");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tools/loop/tests/guardContext.test.ts`
Expected: FAIL — `reads.length` is 2.

- [ ] **Step 3: Remember what was said, per session**

Keep the said-notices set in a marker file keyed by `session_id` beside the log, written once per notice. The context reading still needs the last assistant usage, so read only the transcript's **tail by byte offset** for that, not the whole file — and only when a notice has not already been said, so a session past the ceiling pays for the read once.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --experimental-strip-types --test tools/loop/tests/guardContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/loop/guard-context.mjs tools/loop/tests/guardContext.test.ts
git commit -m "guard-context: a notice is remembered, not re-derived on every tool call"
```

---

## Task 7: PR for Tasks 5–6, reviewed and merged

Same procedure as Task 4, on branch `loop/1150-instruments`. `/code-review`, push, green CI, `gh pr merge --merge --delete-branch`.

---

## Task 8: Unpark #1088

**Why:** PR #1146 is open and red on exactly two tests, both saying what to run.

**Files:**
- Modify: `public/fonts/*`, `assets/fonts/Ionicons.subset.ttf` (generated)

- [ ] **Step 1: Check out the branch and regenerate**

```bash
git fetch origin agent/1088-every-offered-flow-has-a-path-through-it
git checkout agent/1088-every-offered-flow-has-a-path-through-it
node scripts/build-fonts.mjs && node scripts/build-icon-fonts.mjs
```

- [ ] **Step 2: Verify the two tests now pass**

Run: `node --test tests/fontSubset.test.ts tests/iconSubset.test.ts`
Expected: PASS. If either still fails, the diagnosis is wrong — read the assertion, do not re-run.

- [ ] **Step 3: Commit, push, merge on green**

```bash
git add public/fonts assets/fonts
git commit -m "fonts: carry the apostrophe and U+f13f the new copy renders"
git push
```

Merge PR #1146 once CI is green, then remove the `parked` state from issue #1088.

---

## Task 9: Record the v4 measurement and re-aim #1134

**Why:** #1134 Part 1 asks for v4's numbers next to the baseline in the research doc. They are measured. Part 2's premise — "Phase C is 55% of spend" — is an artefact of the phase defect Task 1 fixes, so it must be re-read before any work is planned off it.

**Files:**
- Modify: `docs/research/2026-09-17-loop-audit.md`

- [ ] **Step 1: Add the results section**

| Metric | Baseline | Target | v4 measured |
|---|---|---|---|
| $ per landed ticket | $14.86 | ≤ $12 | $20.34 ($81.35 / 4 landed) |
| $ per ticket attempted | — | — | $13.56 mean, $15.64 median |
| Median minutes | 45 | ≤ 40 | 43 |
| Phase-C max context | 360k | ≤ 210k | 206k — **met** |
| Healthy tickets parked | 0 | 0 | 2 (#1088, #1090) |

Note that the per-phase table cannot be read until Task 1 has landed and a fresh run has produced rows, and that zero of 3,000+ tool calls in any ticket log carried two tool_use blocks.

- [ ] **Step 2: Commit and open it with Task 7's PR or its own**

---

## Task 10: Split #1142's exploratory items into a POC ticket

The owner's first comment on #1142 asks for open-ended UI/UX exploration — mockups via `/design`, opening the running Claude session from the board, new ways to show progress. That is exploration, not a defect. File it as its own ticket, labelled `poc`, and leave #1142 holding only what is specified. Cross-link both.

---

## Self-Review

**Spec coverage:** #1150 items 1+2 → Task 3; item 3 → Task 2; item 4 → Task 1; item 5 → Task 6; item 6 → Task 5; item 7 → **not implemented here** — the batching suppression is an open investigation and `TURNS_BY_SIZE` cannot be re-sized honestly until Task 1 lands and a run produces correctly-phased rows. It stays open on #1150 with that reason recorded. #1134 Part 1 → Task 9. #1142 → unblocked by Task 1, split by Task 10. #1088 → Task 8.

**Type consistency:** `exhausted(run)` and `resumePhase(run, after)` are used exactly as defined in Task 2. `failingFiles(testIds)` is defined and used in Task 3 only. `ciRedBody` gains one field, `runId`, passed at its single call site.

**Known gap:** Task 5 Step 3 requires a new ledger field; if `loop-logs.mjs` does not already record the spawned model, adding it is part of that task and only rows written after it can be judged — which is why older rows are excluded rather than guessed at.
