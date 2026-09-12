# Queue Loop Re-architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run queue:loop` run a night unattended without false parks, false "landed" reports, or premature stops — and delete roughly 60% of the machinery while doing it.

**Architecture:** Redraw the supervisor/session split. The supervisor picks one ticket, passes its number to the session, waits for the session to exit, reads CI, polls mergeability, merges, and records — nothing else. The session owns claim → build → review → gate → push **and its own worktree teardown**, because it is the only process that knows whether its tree is dirty. Tickets are serialised: no merge queue, no overlap, no in-memory pending pull request. Every defect that came from two processes disagreeing about which ticket is live becomes unreachable rather than fixed.

**Tech Stack:** Node 22 ESM (`.mjs`), TypeScript for `lib/loop/*.ts`, `node --test` against `tests/**/*.test.ts`, `gh` CLI 2.93, git 2.53 on Windows, GitHub Actions.

**Spec:** [`docs/research/2026-09-12-queue-loop-rearchitecture.md`](../../research/2026-09-12-queue-loop-rearchitecture.md) — 43 numbered defects (A1–J2), the six measured facts that drive the design, and the recovery checklist. **Read it before starting.** Defect IDs below refer to its §3.

## What was executed

Tasks 2–18 all landed on `loop/rearchitecture-994`. **Task 1 did not** — it is the recovery
checklist, two of its steps need the owner's decision before anything is deleted, and it ends
by stopping for him. Nothing below depends on it having run.

Two deliberate departures from the plan as written, each because the code was read and the plan
was found wrong:

- **Task 9 keeps the rate-limit hold** rather than exiting. The plan's reasoning — that the hold
  protects no state — is right and is not the question: an exit nobody is there to recover costs
  every remaining ticket of an unattended night. What landed is the bounded form: the counter is
  the run's rather than the ticket's (keyed per ticket it never fired), one hold is capped at 12
  hours against a wrong clock, and 20 refusals in a row after full waits gives up. The rest of
  Task 9 landed as written — `.loop-stop` is no longer consumed on read, and `.gitignore` covers
  it.
- **Task 9's correction to `loop-stream.mjs` was not applied**, because the premise is false.
  `unifiedWindows` and `rateLimitType` are both real: the CLI bundle carries the zod schema
  `{status, resetsAt, rateLimitType, utilization, unifiedWindows: {five_hour, seven_day,
  seven_day_overage_included}}`, each window `{utilization, resetsAt}`, documented there as unix
  epoch seconds. `rateLimitType` can name `seven_day_opus`, which `unifiedWindows` has no key
  for, which is why both reads fall back. Verified against the installed binary, 2026-09-12.

Two more places where the shape differs and the plan is what was wrong:

- `scripts/loop-render.mjs` was **kept**, not folded into `queue-loop.mjs`. It is 160 pure lines
  with its own test file; moving it would have added them to a 1,000-line supervisor for nothing.
- Task 17's `docs/agents/loops.md` update was skipped and Task 17's I4 correction was a no-op.
  `loops.md` documents the verify loops, not the supervisor, and the stale `land.ts:19`
  scope-job sentence no longer exists — Task 2's rewrite removed it.

## Global Constraints

- **Test command:** `npm test` runs `node --test --test-timeout=30000 --test-force-exit "tests/**/*.test.ts"`. A single file: `node --test --test-timeout=30000 --test-force-exit tests/<name>.test.ts`.
- **Typecheck:** `npm run typecheck` (`tsc --noEmit`). **Lint:** `npm run lint`. Run both in the worktree you edited, not the primary checkout.
- **Do not run `npm run agent:check` while a peer agent is running** — its memory preflight refuses forever with peers live. Run `tsc` and `eslint` yourself and let CI gate.
- **Never run jest or Playwright locally.** CI is the test runner. `tsc`, `eslint` and `node --test` on the files you touched are the local gate.
- **`git add -- <paths>`, never `git add -A`.** `scripts/guard-bash.mjs` blocks the bare form and it is correct to.
- **Never `git worktree remove` or `rm -rf` a worktree.** Use `npm run worktrees:remove -- <path>` — it detaches the `node_modules` junction first. `git worktree remove --force` deletes *through* a Windows junction into the shared install and exits 0 (measured; spec §1 fact 4).
- **Multi-line `gh` bodies go through `--body-file`**, written with the Write tool or a bash heredoc. Never an inline `--body` (word-split) and never PowerShell `Set-Content` (cp1252 mojibake).
- **Commit message style:** `fix(scope): lowercase sentence`, matching `git log --oneline`. One commit per task step that says "Commit".
- **Comment policy (CLAUDE.md):** default is no comment. Four things earn one — an invisible constraint, a *why* where the obvious approach is wrong, a contract the types can't carry, a pointer to the authority. **Never** explain the defect you just fixed; that goes in the commit message.
- **`docs/agents/RULES.md` is the normative rule list.** Nothing in this plan restates it; `tests/rulesAreSingleSourced.test.ts` enforces that.

---

## File Structure

**Modified:**

| File | Responsibility after this plan |
|---|---|
| `lib/loop/land.ts` | Decide what to do with a pull request from its state. Gains `MERGED`/`CLOSED` and `UNKNOWN` cases. |
| `lib/loop/ciVerdict.ts` | Decide whether a CI run passed. Gains a `null`-conclusion case. |
| `scripts/queue-loop.mjs` | Supervisor: pick → spawn → settle → record. Loses the merge slot, the phase board, the rate-limit hold, and the `landed` inference. 1188 → ≈400 lines. |
| `scripts/loop-stream.mjs` | Parse the child's stdout into facts. Loses the phase markers; gains `origin` and a `PHASE` line reader. |
| `scripts/next-ticket.mjs` | Pick one ticket, claim it, confirm the claim. Gains the claim write; loses `branchAlive`. |
| `scripts/guard-bash.mjs` | PreToolUse boundary. Gains a `gh pr merge` rule. |
| `scripts/comment-budget.mjs` | Count comment lines per file, not per diff hunk. 102 → ≈45 lines. |
| `.claude/commands/queue.md` | The session protocol. Gains `$ARGUMENTS` use, worktree teardown, and `PHASE` echoes. |
| `.github/workflows/ci.yml` | Timings regeneration moves from `push` to `schedule`. |
| `tests/e2e/playwright.config.ts` | `retries: 1` on CI. |

**Deleted:** `scripts/loop-render.mjs`, `scripts/loop-record.mjs`, `tests/loopRender.test.ts`, `tests/loopRecord.test.ts`.

**Created:** `lib/loop/prState.ts` (poll mergeability), `tests/land.test.ts`, `tests/ciVerdict.test.ts`, `tests/queueLoopMain.test.ts`.

---

## Task 1: Recover the current state

Nothing else can be verified while the checkout is 25 commits behind and a stale worktree makes `derive()` ambiguous. **No code changes in this task.**

**Files:** none — this is repository and tracker state.

**Interfaces:**
- Consumes: nothing.
- Produces: a clean primary checkout on `main` at `origin/main`, at most one `.worktrees/agent-*`, and a tracker with no false `ready-for-human`.

- [ ] **Step 1: Re-derive, because this moved twice during the research**

```bash
cd /c/Users/roton/murlan
git fetch origin --quiet
git status --short
git worktree list
git rev-list --count HEAD..origin/main
gh pr list --state open --json number,headRefName,mergeable,mergeStateStatus
gh issue list --label ready-for-human --state all --json number,state,labels
```

Write down what you actually see. Every command below assumes the state in the spec's §7; if it differs, the spec's §7 is stale and your reading wins.

- [ ] **Step 2: Fast-forward the primary checkout**

```bash
git checkout main
git merge --ff-only origin/main
git rev-list --count HEAD..origin/main   # expect 0
```

If `merge --ff-only` refuses over local changes, **stop and show the user `git status --short`.** Do not stash, do not checkout, do not discard. Those files are why a previous run died.

- [ ] **Step 3: Land or close the open pull request, then remove its worktree**

For each open `agent/*` pull request (the spec names #991 on `agent/983-jsx-free-rationale`):

```bash
gh pr checks <n>                                    # every job green?
gh pr view <n> --json state,mergeable,mergeStateStatus
gh pr merge <n> --merge --delete-branch
git ls-remote --heads origin agent/<branch>         # expect empty
```

Then, and only after the merge:

```bash
npm run worktrees:remove -- .worktrees/agent-<n>
git worktree list                                   # expect only the primary
```

If the removal refuses with "has uncommitted changes", read what is uncommitted (`git -C .worktrees/agent-<n> status --short`) before doing anything else. **Do not pass `--force`.**

- [ ] **Step 4: Delete the merged-but-undeleted remote branches**

These freeze their tickets forever: `takeable()` skips any ticket whose claim comment names a branch still alive on origin (defect F3).

```bash
git ls-remote --heads origin 'refs/heads/agent/*' | sed 's#.*refs/heads/##'
```

For each one, find whether its pull request merged:

```bash
gh pr list --head <branch> --state all --json number,state,mergedAt
```

Delete only those whose pull request is `MERGED`:

```bash
git push origin --delete <branch>
```

**Two need a look first, not a delete:** `agent/627-view-hierarchy` has no pull request at all, and `agent/955-storage-split` carries an unpushed `wip(#955): parked in phase E` commit that `park()` made. Show the user `git log origin/<branch> --oneline -5` for each and ask before touching them.

- [ ] **Step 5: Clear the false `ready-for-human` labels**

```bash
gh issue list --label ready-for-human --state all --json number,state,title
```

For each **closed** issue still carrying it (the spec names #955, #969, #987, #993):

```bash
gh issue edit <n> --remove-label ready-for-human
```

Each of those four has a park comment claiming a landed ticket was parked. That comment is the record the owner reads, so correct it. Write the file first:

```bash
cat > /tmp/correct-<n>.md <<'EOF'
Parked in error by the queue loop. PR #<pr> had already merged when the supervisor
read it, and a merged pull request reports `mergeStateStatus: UNKNOWN` — which
`decideLanding` had no case for, so it fell through to "unrecognised".

Nothing was wrong with this ticket. See
`docs/research/2026-09-12-queue-loop-rearchitecture.md` §1 fact 1.
EOF
gh issue comment <n> --body-file /tmp/correct-<n>.md
```

- [ ] **Step 6: File the two test defects**

Both are real, both are unreported, and both will bite the loop again. Write each body to a file and create the issue.

```bash
cat > /tmp/flake.md <<'EOF'
`tests/e2e/oneAccessibleNode.spec.ts:129` ("a revisited room screen carries the room
code on exactly one accessible node") failed once in CI run 34662559313, on a branch
whose diff was `scripts/comment-budget.mjs` and its test — code the app bundle does
not import.

The failing assertion is the last of five. The four before it passed, including
`getByText("CODICE STANZA", {exact:true}).count() === 1` at spec:166, which proves the
caption is in the DOM at that moment. What came back empty was the accessibility-tree
view of the same node: `nodes.filter(n => !n.ignored && role === "StaticText")` at
spec:178-181 returned `[]`. That is a mid-transition CDP snapshot read.

`tests/e2e/playwright.config.ts:54` sets `retries: 0`, so one unlucky snapshot is a red
suite — and a red suite stops the queue loop.

Definition of done: the spec waits for the AX node rather than sampling it once, or the
config retries on CI (Playwright then marks it `flaky` rather than `passed`, so the
information is kept). Either closes it; say which and why.
EOF
gh issue create --title "oneAccessibleNode reads the AX tree once, mid-transition" \
  --body-file /tmp/flake.md --label ready-for-agent --label size:S

cat > /tmp/race.md <<'EOF'
CI run 34647545165 — the **main push** that merged PR #994 — went red on
`Typecheck and tests`:

```
test at tests/exchangeE2EHold.test.ts:51:3
✖ only the E2E harness's own build configs ever set EXPO_PUBLIC_E2E_FAST
  Error: ENOENT: no such file or directory, open '.../scratch.strictIndexed.broken.json'
    at read (tests/exchangeE2EHold.test.ts:15:31)
```

`tests/exchangeE2EHold.test.ts:62-65` does `readdirSync(repoRoot)` and then `readFileSync`
on every root-level file. `tests/checkStrictIndexed.test.ts:16-19` writes and deletes
`scratch.strictIndexed.*.json` in the repo root — it has to, because tsconfig `include`
globs resolve relative to the config file's directory. Under `node --test`'s parallel file
execution the listing and the cleanup interleave.

It reddened `main`, and nothing noticed: `ciVerdict.runListArgs` filters by `--branch`, so
`main` is never read.

Definition of done: the scan is scoped to `git ls-files` (or the scratch configs move to a
directory the scan skips), and a test pins that a file appearing and vanishing in the repo
root mid-scan cannot fail the assertion.
EOF
gh issue create --title "Two tests race on the repo root, and it reddened main" \
  --body-file /tmp/race.md --label ready-for-agent --label size:S
```

- [ ] **Step 7: Correct the local run report**

`.loop-logs/` is gitignored, so this is local only. **Do not hand-edit `tickets.jsonl`** — the wrong rows are written from `outcome.action`, which Task 2 fixes at the source.

```bash
cat >> .loop-logs/run-2026-09-12.md <<'EOF'

## Correction, 2026-09-12
Five of the parks above are false. #955, #969, #987 and #993 all merged; #983 was rebased
and merged. Every one was `decideLanding` falling through on a merged pull request's
`mergeStateStatus: UNKNOWN`. The `ci: {pass:false}` rows are wrong for the same reason.
EOF
rm -f .loop-logs/park-*.md   # already posted as issue comments; nothing is lost
```

- [ ] **Step 8: Report the recovered state to the user and stop**

Print the four commands from Step 1 again and show the user the result. **Do not start Task 2 until they have seen it** — every task below assumes a clean tree, and if Step 2 refused they need to decide what to do with those files.

---

## Task 2: `decideLanding` must handle a merged pull request and an unknown one

Defects A1, A2, A3, A4, A5, A6, A7. This is the root cause of every false park. Smallest diff, largest effect — do it first.

**Files:**
- Modify: `lib/loop/land.ts:26-37` (`decideLanding`), `:58-68` (the CLI block)
- Create: `tests/land.test.ts`
- Modify: `scripts/queue-loop.mjs:295-316` (`afterPush`), `:816` (`SETTLE_ROUNDS`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `decideLanding(pr: PrState): LandAction` where `PrState` is `{ state: string; mergeable: string; mergeStateStatus: string }` and `LandAction` gains two members — `{ action: "already-merged"; reason: string }` and `{ action: "recheck"; reason: string }`. `afterPush` maps `already-merged` → `{action: "merged"}` and `recheck` → `{action: "retry-verdict"}`.

- [ ] **Step 1: Write the failing test**

Create `tests/land.test.ts`:

```typescript
// tests/land.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decideLanding, mergeArgs } from "../lib/loop/land.ts";

const pr = (over: Partial<Parameters<typeof decideLanding>[0]> = {}) => ({
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  ...over,
});

describe("decideLanding", () => {
  // A merged pull request answers UNKNOWN/UNKNOWN on both fields. Measured on #985, #986,
  // #994 and #996. Read `state` before either of them or a landed ticket reads as unlandable.
  test("a MERGED pull request is already merged, whatever its merge state says", () => {
    const d = decideLanding(pr({ state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }));
    assert.equal(d.action, "already-merged");
  });

  test("a CLOSED pull request is not a merge and not a retry", () => {
    const d = decideLanding(pr({ state: "CLOSED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }));
    assert.equal(d.action, "stop");
    assert.match(d.reason, /closed without merging/);
  });

  test("an open pull request still being computed asks again", () => {
    const d = decideLanding(pr({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }));
    assert.equal(d.action, "recheck");
  });

  test("mergeable UNKNOWN asks again even when the merge state reads CLEAN", () => {
    const d = decideLanding(pr({ mergeable: "UNKNOWN", mergeStateStatus: "CLEAN" }));
    assert.equal(d.action, "recheck");
  });

  test("CONFLICTING stops", () => {
    assert.equal(decideLanding(pr({ mergeable: "CONFLICTING" })).action, "stop");
  });

  test("BEHIND updates the branch", () => {
    assert.equal(decideLanding(pr({ mergeStateStatus: "BEHIND" })).action, "update-branch");
  });

  test("CLEAN merges", () => {
    assert.equal(decideLanding(pr()).action, "merge");
  });

  test("HAS_HOOKS merges", () => {
    assert.equal(decideLanding(pr({ mergeStateStatus: "HAS_HOOKS" })).action, "merge");
  });

  // UNSTABLE means "mergeable with non-passing commit status", and non-passing includes
  // *queued*. gh merges it on the spot. The CI verdict is read before this function is
  // called at all, so reaching here on UNSTABLE means the suite was green and a non-required
  // check is pending — which is the only reading under which merging is right.
  test("UNSTABLE merges, and says that CI was already judged", () => {
    const d = decideLanding(pr({ mergeStateStatus: "UNSTABLE" }));
    assert.equal(d.action, "merge");
    assert.match(d.reason, /ciVerdict/);
  });

  test("an unrecognised state names itself and stops", () => {
    const d = decideLanding(pr({ mergeStateStatus: "SOMETHING_NEW" }));
    assert.equal(d.action, "stop");
    assert.match(d.reason, /SOMETHING_NEW/);
  });
});

describe("mergeArgs", () => {
  test("merges with a merge commit and deletes the branch", () => {
    assert.deepEqual(mergeArgs("o/r", 7), ["pr", "merge", "7", "--repo", "o/r", "--merge", "--delete-branch"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/land.test.ts`
Expected: FAIL — several cases, the first being `a MERGED pull request...` asserting `"already-merged"` against the received `"stop"`.

- [ ] **Step 3: Rewrite `decideLanding` and widen `PrState`**

In `lib/loop/land.ts`, replace the `PrState` interface, the `LandAction` type and the whole of `decideLanding`:

```typescript
export interface PrState {
  state: string;
  mergeStateStatus: string;
  mergeable: string;
}

export type LandAction =
  | { action: "merge"; reason: string }
  | { action: "already-merged"; reason: string }
  | { action: "recheck"; reason: string }
  | { action: "update-branch"; reason: string }
  | { action: "stop"; reason: string };

/**
 * What to do with a green pull request.
 *
 * `state` is read before either mergeability field because a merged pull request answers
 * `UNKNOWN` on both, and so does one GitHub has not finished computing — the same two values for
 * "done" and "not yet".
 *
 * `mergeable: UNKNOWN` is the async signal: GitHub starts a background job when asked and the
 * documented remedy is to resubmit the request, so it is a recheck rather than a verdict.
 *
 * Anything conflicted or blocked stops rather than reaching for `--admin`: a merge that needs a
 * flag to force it is a decision, not a step.
 */
export function decideLanding(pr: PrState): LandAction {
  if (pr.state === "MERGED") {
    return { action: "already-merged", reason: "the pull request is already merged" };
  }
  if (pr.state === "CLOSED") {
    return { action: "stop", reason: "the pull request was closed without merging" };
  }
  if (pr.mergeable === "UNKNOWN" || pr.mergeStateStatus === "UNKNOWN") {
    return { action: "recheck", reason: "GitHub is still computing mergeability" };
  }
  if (pr.mergeable === "CONFLICTING") {
    return { action: "stop", reason: "the branch conflicts with main and needs a human" };
  }
  if (pr.mergeStateStatus === "BEHIND") {
    return { action: "update-branch", reason: "main moved; update the branch and let it go green on that tree" };
  }
  if (pr.mergeStateStatus === "BLOCKED" || pr.mergeStateStatus === "DIRTY") {
    return { action: "stop", reason: `mergeStateStatus is ${pr.mergeStateStatus}` };
  }
  if (pr.mergeStateStatus === "CLEAN" || pr.mergeStateStatus === "HAS_HOOKS") {
    return { action: "merge", reason: `mergeStateStatus is ${pr.mergeStateStatus}` };
  }
  // UNSTABLE is "mergeable with non-passing commit status", and non-passing includes queued —
  // gh merges it on the spot either way. Reaching here means ciVerdict already read the run for
  // this head and passed it, which is the only reading under which a pending check is ignorable.
  if (pr.mergeStateStatus === "UNSTABLE") {
    return { action: "merge", reason: "mergeStateStatus is UNSTABLE; ciVerdict already passed this head" };
  }
  return { action: "stop", reason: `unrecognised mergeStateStatus ${pr.mergeStateStatus}` };
}
```

Then in the CLI block at the bottom of the same file, ask for `state` and report the two new actions:

```typescript
  const pr: PrState = JSON.parse(
    gh(["pr", "view", prNumber, "--repo", repo, "--json", "state,mergeStateStatus,mergeable"])
  );
  const decision = decideLanding(pr);
  if (decision.action === "merge") {
    gh(mergeArgs(repo, Number(prNumber)));
    process.stdout.write(JSON.stringify({ merged: true, prNumber: Number(prNumber), reason: decision.reason }));
  } else if (decision.action === "already-merged") {
    process.stdout.write(JSON.stringify({ merged: true, prNumber: Number(prNumber), reason: decision.reason }));
  } else {
    process.stdout.write(
      JSON.stringify({ merged: false, prNumber: Number(prNumber), next: decision.action, reason: decision.reason })
    );
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/land.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Write the failing supervisor test**

Append to `tests/queueLoop.test.ts`, inside the existing `afterPush` describe block:

```typescript
  test("a recheck rides the retry budget instead of parking", () => {
    const out = afterPush({ verdict: { pass: true }, landing: { action: "recheck", reason: "still computing" } });
    assert.equal(out.action, "retry-verdict");
  });

  test("an already-merged pull request is a merge, not a park", () => {
    const out = afterPush({ verdict: { pass: true }, landing: { action: "already-merged", reason: "already merged" } });
    assert.equal(out.action, "merged");
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: FAIL — both new cases receive `"park"`.

- [ ] **Step 7: Teach `afterPush` the two new actions and raise the recheck budget**

In `scripts/queue-loop.mjs`, inside `afterPush`, add these two branches immediately after the `verdict.infrastructure` check and before `if (!verdict.pass)`:

```js
  if (landing?.action === "already-merged")
    return { action: "merged", why: landing.reason };
  if (landing?.action === "recheck")
    return { action: "retry-verdict", why: landing.reason };
```

Change `SETTLE_ROUNDS` so the recheck budget is its own, and generous — the mergeability job is fast but undocumented, so the bound is ours to pick:

```js
export const SETTLE_ROUNDS = { update: 3, retry: 3, recheck: 8 };
```

In `settle()`, give `recheck` its own counter and its own message. Replace the `retry-verdict` branch with:

```js
    if (next.action === "retry-verdict" && left.retry-- > 0) {
      log(`  ⏳ #${pending.ticket} ${next.why} — asking once more`);
      await wait();
      continue;
    }
```

…keeping it as is, and fix the give-up message so it names the budget that ran out:

```js
    if (next.action === "update-branch" || next.action === "retry-verdict") {
      const spent = next.action === "update-branch" ? SETTLE_ROUNDS.update : SETTLE_ROUNDS.retry;
      return { action: "park", why: `${next.action} did not settle in ${spent} rounds` };
    }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts tests/land.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck
git add -- lib/loop/land.ts tests/land.test.ts scripts/queue-loop.mjs tests/queueLoop.test.ts
git commit -m "fix(loop): read a pull request's state before its mergeability

A merged pull request answers UNKNOWN on both mergeable and mergeStateStatus, and so
does one GitHub has not finished computing. decideLanding had a case for neither and
fell through to \"unrecognised\", which afterPush turned into a park. Five tickets that
had landed were parked, relabelled and counted against the circuit breaker.

land.ts had no test file at all."
```

---

## Task 3: Make `gh pr merge` unreachable from a session

Defect E2. Two sessions merged a peer's pull request, which is what fed Task 2's bug real input. `--disallowedTools` is **not** a security boundary — Anthropic's permissions documentation publishes a bypass table (`git -C . push` defeats `Bash(git push *)`). A `PreToolUse` hook is, and it fires inside subagents too.

**Files:**
- Modify: `scripts/guard-bash.mjs` — add one rule to the `RULES` array
- Modify: `tests/guardBash.test.ts` (if it exists; otherwise create it — check with `ls tests/ | grep -i guard`)

**Interfaces:**
- Consumes: `check(command)` from `scripts/guard-bash.mjs`, already exported.
- Produces: nothing new; the rule is internal to `RULES`.

- [ ] **Step 1: Write the failing test**

`tests/guardBash.test.ts` already exists and already imports `check`. Append this describe block to it.

```typescript
  describe("gh pr merge", () => {
    test("a bare merge is blocked", () => {
      assert.match(String(check("gh pr merge 994 --merge --delete-branch")), /not yours to merge/);
    });

    // The forms a deny rule would miss. A PreToolUse hook sees the whole line, so it can.
    test("a repo-scoped merge is blocked", () => {
      assert.match(String(check("gh -R metasito/murlan pr merge 994 --merge")), /not yours to merge/);
    });

    test("a merge after a separator is blocked", () => {
      assert.match(String(check("git push && gh pr merge 994 --merge")), /not yours to merge/);
    });

    test("the graphql mutation is blocked", () => {
      assert.match(
        String(check("gh api graphql -f query='mutation{mergePullRequest(input:{pullRequestId:\"x\"}){clientMutationId}}'")),
        /not yours to merge/
      );
    });

    // The words in a commit message or a PR body are prose about a command, not a command.
    test("the phrase inside a heredoc is allowed", () => {
      assert.equal(check("git commit -F - <<'EOF'\nsay why gh pr merge is the loop's job\nEOF"), null);
    });

    test("reading a pull request is allowed", () => {
      assert.equal(check("gh pr view 994 --json state,mergeStateStatus"), null);
    });

    test("creating a pull request is allowed", () => {
      assert.equal(check("gh pr create --base main --head agent/1-x --title t --body-file b.md"), null);
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/guardBash.test.ts`
Expected: FAIL — `check` returns `null` for every blocked case.

- [ ] **Step 3: Add the rule**

In `scripts/guard-bash.mjs`, append to the `RULES` array (before the closing `];`):

```js
  {
    // Reaching the merge from a session is how a pull request gets merged before its CI has been
    // read: `gh pr merge` treats UNSTABLE — which includes *queued* — as immediately mergeable.
    // Matched here rather than with --disallowedTools because a deny rule matches the invocation
    // Claude usually writes and is documented as not a boundary around the program; a PreToolUse
    // hook sees the whole line, and fires inside subagents too.
    test: (c) =>
      new RegExp(AT_COMMAND_START + String.raw`gh\s+(?:-[A-Za-z]+\s+\S+\s+|--\S+(?:=\S+)?\s+)*pr\s+merge\b`, "m").test(c) ||
      /\bmergePullRequest\s*\(/.test(c) ||
      /\benablePullRequestAutoMerge\s*\(/.test(c),
    message:
      "gh pr merge is not yours to merge. The pull request's CI has not been judged yet, and " +
      "`gh pr merge` merges an UNSTABLE pull request on the spot — UNSTABLE includes checks that " +
      "have not started. Two sessions merged a peer's pull request this way and the supervisor " +
      "then parked the ticket that had just landed.\n" +
      "scripts/queue-loop.mjs reads the run for this head, polls mergeability, and merges. " +
      "Push, open the pull request, and exit — that is the whole of phase E.\n" +
      "Blocked on a predecessor's change? Say so on the issue and park; do not merge it yourself.",
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/guardBash.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the hook is actually wired for this**

```bash
node -e "import('./scripts/guard-bash.mjs').then(m=>console.log(m.check('gh pr merge 1 --merge')))"
echo '{"tool_input":{"command":"gh pr merge 1 --merge"}}' | node scripts/guard-bash.mjs; echo "exit=$?"
```

Expected: the message on stderr and `exit=2`. **If the exit code is 0, the CLI block's `process.argv[1]` guard did not match — fix that before committing**, because the unit test would pass while the hook does nothing.

- [ ] **Step 6: Commit**

```bash
git add -- scripts/guard-bash.mjs tests/guardBash.test.ts
git commit -m "fix(guard): refuse gh pr merge from a session

queue.md says the merge is not the session's, in prose, and settings.local.json allows
Bash(gh pr *) unprompted. Two sessions merged their predecessor's pull request to unblock
themselves. A deny rule is documented as not a boundary around a program; a PreToolUse
hook reads the whole line and fires inside subagents."
```

---

## Task 4: Three repository-level changes that delete defect classes

Defects I1, I3, F3. None of these is loop code, and each removes a class rather than an instance.

**Files:**
- Modify: `.github/workflows/ci.yml:597-598`
- Modify: `tests/e2e/playwright.config.ts:54`
- Repository settings via `gh api`

**Interfaces:**
- Consumes: nothing.
- Produces: a `main` that stops moving on its own, a CI suite that survives one flaky snapshot, and branches that delete themselves on merge.

- [ ] **Step 1: Ask the user before changing the repository setting**

`delete_branch_on_merge` changes behaviour for every future merge, including manual ones. Show them this and wait for a yes:

> Ten `agent/*` branches are on origin, six from merged pull requests. Each one freezes its ticket: `takeable()` skips a ticket whose claim comment names a branch still alive on origin, and `issue-tracker.md:86` records this exact failure on #294. `delete_branch_on_merge: true` closes the class permanently — GitHub deletes the head branch server-side on any merge. May I set it?

- [ ] **Step 2: Set it, once they say yes**

```bash
gh api -X PATCH repos/metasito/murlan -f delete_branch_on_merge=true
gh api repos/metasito/murlan --jq '.delete_branch_on_merge'   # expect true
```

- [ ] **Step 3: Move the timings regeneration off the main push**

`ci.yml`'s `browser-report` job pushes a regenerated `tests/e2e/timings.json` straight to `main` on every green main push — 9 commits on 2026-09-11 alone, each rewriting the whole file because Playwright durations wobble. It makes every open pull request BEHIND, and it defeats `scope`'s skip, turning a 1-minute main run into a 6-minute one which then produces another timings commit.

`ci.yml:19-20` already has a weekly cron. In `.github/workflows/ci.yml`, change line 597-598's gate:

```yaml
      - name: Commit the regenerated timings, if main's copy is stale
        if: ${{ github.event_name == 'schedule' && needs.browser.result == 'success' }}
```

Update the comment block immediately above it (lines ~584-596) so it says what the gate now depends on. Replace its last sentence with:

```yaml
      # Weekly, not per-merge. Regenerating on every green main push moved `main`
      # under every open pull request, which cost each one a branch update and a
      # full extra run — and moved the tree out from under `scope`'s skip, so the
      # next main push ran the whole suite and regenerated again.
      # `tests/e2eShardSplit.test.ts` tolerates 10% unmeasured specs, which is
      # about five new specs at the current count, so a week is well inside the
      # floor. If it ever trips, that test says so by name and a
      # `workflow_dispatch` regenerates.
```

- [ ] **Step 4: Verify the workflow still parses**

```bash
node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!/github.event_name == 'schedule' && needs.browser.result/.test(y)) throw new Error('gate not changed'); console.log('gate ok')"
gh workflow view ci.yml >/dev/null && echo "workflow readable"
```

- [ ] **Step 5: Retry a flaky snapshot on CI only**

In `tests/e2e/playwright.config.ts`, replace `retries: 0,` with:

```typescript
  // One unlucky accessibility-tree snapshot is otherwise a red suite, and a red suite
  // is a stopped queue loop. Playwright marks a retried-then-passed test `flaky` rather
  // than `passed`, so the information survives the retry. Locally still 0: a flake you
  // cannot see is one nobody fixes.
  retries: process.env.CI ? 1 : 0,
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add -- .github/workflows/ci.yml tests/e2e/playwright.config.ts
git commit -m "fix(ci): regenerate the e2e timings weekly, and retry a flake once

The per-merge timings commit moved main under every open pull request, cost each one a
branch update plus a full extra run, and defeated the scope job's skip so the next main
push ran everything and regenerated again. Nine such commits on 2026-09-11.

retries: 0 made one mid-transition AX snapshot a red suite, and a red suite stops the loop."
```

---

## Task 5: A mechanical park must not remove the ticket from the frontier

Defects D1, D2, D5. `park()` adds `ready-for-human` and leaves `ready-for-agent`; `classify()`'s owner-wins rule then makes the park absorbing. The laziest correct answer is not a new label: **do not park for a mechanical reason at all.**

**Files:**
- Modify: `scripts/queue-loop.mjs:917-950` (`account`), `:351-396` (`park`)
- Modify: `tests/queueLoop.test.ts` (the `park` describe block)

**Interfaces:**
- Consumes: `afterPush`'s action set from Task 2.
- Produces: `park(number, ctx)` unchanged in signature; `ctx` gains no fields. `account(settled)` no longer calls `park` for a `settle()` outcome.

- [ ] **Step 1: Write the failing test**

In `tests/queueLoop.test.ts`, inside the `park` describe block:

```typescript
  test("park takes ready-for-agent off as well as in-progress", () => {
    const calls: string[][] = [];
    park(42, {
      phase: "C",
      why: "a decision only the owner can make",
      log: ".loop-logs/42.jsonl",
      cwd: null,
      branch: "agent/42-x",
      dirty: false,
      run: (file: string, args: string[]) => { calls.push([file, ...args]); return ""; },
      write: () => {},
    });
    const edit = calls.find((c) => c[1] === "issue" && c[2] === "edit");
    assert.ok(edit, "park edits the issue's labels");
    // Asserted as the whole argument list, not with `some(includes)`: the defect was a label
    // that was never removed, and a positive-only assertion cannot see an absent argument.
    assert.deepEqual(edit, [
      "gh", "issue", "edit", "42",
      "--remove-label", "in-progress",
      "--remove-label", "ready-for-agent",
      "--add-label", "ready-for-human",
    ]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: FAIL — the received array lacks `--remove-label ready-for-agent`.

- [ ] **Step 3: Fix the label write**

In `scripts/queue-loop.mjs`'s `park()`:

```js
  run("gh", [
    "issue",
    "edit",
    String(number),
    "--remove-label",
    "in-progress",
    // Left on, a park is absorbing: classify() sends any issue carrying an owner label to the
    // owner bucket whatever else it carries, so the ticket never returns to the frontier.
    "--remove-label",
    "ready-for-agent",
    "--add-label",
    "ready-for-human",
  ]);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the mechanical path**

```typescript
  test("a settle failure does not park the ticket", async () => {
    const parked: number[] = [];
    const outcome = await settleOutcome({
      ticket: 42,
      action: "park",
      why: "update-branch did not settle in 3 rounds",
      park: (n: number) => parked.push(n),
    });
    assert.deepEqual(parked, [], "a mechanical failure is the loop's, not the owner's");
    assert.equal(outcome.countsAsFailure, true, "it still counts toward the breaker");
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: FAIL — `settleOutcome is not defined`.

- [ ] **Step 7: Extract and export the decision**

Add to `scripts/queue-loop.mjs`, near `afterPush`:

```js
/**
 * What a settled ticket costs the run.
 *
 * A mechanical failure — anything `settle()` decides — is not a decision the owner can make, so
 * it does not reach the tracker. The branch and the pull request are both intact and the next
 * iteration finds them from `derive()`; what it needs is the breaker, not a label.
 *
 * @param {{ticket: number, action: string, why?: string, park: Function}} settled
 */
export async function settleOutcome({ action, why, park: parkFn }) {
  if (action === "merged") return { countsAsFailure: false, recorded: "landed" };
  if (action === "fix") return { countsAsFailure: false, recorded: null };
  void parkFn;
  void why;
  return { countsAsFailure: true, recorded: "stalled" };
}
```

Then in `account()`, replace the whole `failures += 1; totals.parked += 1; park(...)` block with:

```js
    const settled = await settleOutcome({ ...outcome, ticket: held.ticket, park });
    if (settled.recorded === null) return;
    if (settled.countsAsFailure) {
      failures += 1;
      totals.parked += 1;
      console.log(`  ⚠️ #${held.ticket} did not merge — ${outcome.why}`);
    }
    record(
      row({ ...held.record, outcome: settled.recorded, ci: null }),
      reportRow({ ...held.report, outcome: settled.recorded, why: outcome.why }),
    );
```

Note `ci: null`, not `ci: {pass: false}` — defect D5. The loop does not know CI failed; it knows the merge did not happen.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -- scripts/queue-loop.mjs tests/queueLoop.test.ts
git commit -m "fix(loop): a mechanical failure is not the owner's to decide

park() added ready-for-human and left ready-for-agent, and classify() sends any issue
carrying an owner label to the owner bucket whatever else it carries — so every park was
absorbing and the frontier drained 11 to 6 in one night. Five of those parks were false.

A settle failure now counts toward the breaker and touches no label: the branch and the
pull request are intact and the next iteration derives them.

The existing park test asserted the two calls the code made and never the third it did
not; the assertion is now the whole argument list."
```

---

## Task 6: Pass the ticket number, and stop inferring that a ticket landed

Defects B1, B2, B3, B4, B5, B6, B7, F5. The supervisor spawns `-p /queue` with no argument, so the session picks again; `landed` then compares against a number the session was never told.

**Files:**
- Modify: `scripts/queue-loop.mjs:105-126` (`queueLoopArgs`), `:76-86` (`liveRoute`), `:1035` (`landed`), `:550` (the log path)
- Modify: `.claude/commands/queue.md:40-70` (phase A)
- Modify: `tests/queueLoop.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `queueLoopArgs(number: number): string[]` — was zero-arity. `liveRoute(status)` returns `{skill, number, title, phase, resuming} | {skill: "ambiguous", why} | null`.

- [ ] **Step 1: Write the failing tests**

```typescript
  test("the spawn carries the ticket number", () => {
    const args = queueLoopArgs(956);
    const i = args.indexOf("-p");
    assert.notEqual(i, -1);
    assert.equal(args[i + 1], "/queue 956");
  });

  test("an ambiguous derive is a route, not an absence", () => {
    const r = liveRoute({ onTicket: false, ambiguous: true, why: "2 live agent/* worktrees" });
    assert.equal(r?.skill, "ambiguous");
  });

  test("a clean derive off a ticket is still no route", () => {
    assert.equal(liveRoute({ onTicket: false, ambiguous: false, why: "not on an agent branch" }), null);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: FAIL — `queueLoopArgs` takes no argument and puts `/queue` at `i+1`; `liveRoute` returns `null` for the ambiguous case.

- [ ] **Step 3: Pass the number and surface ambiguity**

In `scripts/queue-loop.mjs`:

```js
export function queueLoopArgs(number) {
  return [
    "-p",
    `/queue ${number}`,
    "--permission-mode",
    "auto",
    "--strict-mcp-config",
    "--output-format",
    "stream-json",
    "--verbose",
    "--tools",
    readAllowedTools().join(","),
    "--max-budget-usd",
    TICKET_BUDGET_USD,
  ];
}
```

```js
export function liveRoute(status) {
  // locateRun refuses to guess between two live ticket worktrees, and that refusal is the whole
  // point of it — returning null here turned it into "no run is live" and the picker took a third.
  if (status.ambiguous)
    return { skill: "ambiguous", number: 0, title: status.why ?? "more than one live worktree", resuming: false };
  if (!status.onTicket || !status.ticket) return null;
  return {
    skill: "implement",
    number: status.ticket,
    title: status.branch ?? `ticket #${status.ticket}`,
    phase: status.phase && status.phase !== "?" ? status.phase : "C",
    resuming: true,
  };
}
```

Update the call site in `runTicket` to `spawnFn("claude", queueLoopArgs(number), {...})`, and in `main()` handle the ambiguous route immediately after `nextRoute()`:

```js
    if (route.skill === "ambiguous") {
      console.error(`queue-loop: ${route.title} — refusing to guess which run is live`);
      console.error("  Land or remove one of them: npm run worktrees:remove -- .worktrees/agent-<n>");
      return 1;
    }
```

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the landing decision**

```typescript
  describe("what counts as landed", () => {
    test("a pushed pull request is not yet landed", () => {
      assert.equal(outcomeOf({ pr: 984, why: null }).landed, false);
    });

    test("no pull request and no reason is not landed either", () => {
      // The session stood down on a lost claim race, or derive() could not read the run.
      // Both used to read as "the worktree is gone, so it landed".
      const o = outcomeOf({ pr: null, why: null });
      assert.equal(o.landed, false);
      assert.match(o.why, /pushed no pull request/);
    });

    test("a reason is always a park", () => {
      assert.equal(outcomeOf({ pr: 984, why: "the session exited 1 in phase C" }).landed, false);
    });
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: FAIL — `outcomeOf is not defined`.

- [ ] **Step 7: Replace the inference with a function**

Add to `scripts/queue-loop.mjs`:

```js
/**
 * Whether a session's exit ended the ticket.
 *
 * Only `settle()` ever says "landed", and only after a merge. This says whether the session did
 * its half — pushed a pull request with nothing left to explain. The predicate it replaces was
 * `after.ticket !== route.number`, which is true whenever the session worked a *different*
 * ticket, stood down on a lost claim race, or `derive()` could not tell which run was live.
 *
 * @param {{pr: number|null, why: string|null}} run
 */
export function outcomeOf({ pr, why }) {
  if (why) return { landed: false, why };
  if (!pr) return { landed: false, why: "the session pushed no pull request" };
  return { landed: false, why: null, pushed: pr };
}
```

In `main()`, delete `const landed = ...` and rewrite the three-way branch as two:

```js
    const decided = outcomeOf({ pr: pushed, why });

    if (decided.pushed) {
      // Pushed and reviewed. Nothing left needs a model; settle() decides whether it landed.
      ...existing "landed" console.log, but say "pushed" not "landed"...
    } else {
      failures += 1;
      totals.parked += 1;
      if (after) park(route.number, { phase: after.phase, why: decided.why, log: run.log, cwd: after.cwd, branch: after.branch, dirty: after.dirty });
      ...existing parked console.log, with decided.why...
    }
```

Name the log by the ticket the session actually worked, not the routed one (defect B6) — in `runTicket`, after the run completes, the caller already has `after.ticket`; leave the stream log named by `number` but add one line to `main()` after `standing()`:

```js
    if (after && after.ticket !== route.number) {
      console.error(
        `queue-loop: routed #${route.number} and the session worked #${after.ticket} — ` +
          `the number is passed on the command line, so this should be impossible. Stopping.`,
      );
      return 1;
    }
```

- [ ] **Step 8: Run the tests**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: PASS.

- [ ] **Step 9: Teach queue.md to use the argument**

In `.claude/commands/queue.md` phase A, after the `loop-status.mjs` paragraph, replace the picker instruction with:

```markdown
`scripts/queue-loop.mjs` passes the ticket number, so `$ARGUMENTS` is normally set and
`next-ticket.mjs $ARGUMENTS` inspects *that* ticket rather than picking. A bare `/queue`
with no argument picks from the live queue, which is the by-hand form.

**You work the ticket you were given.** If it turns out to be wrong — the claim race is
lost, the premise is false, a blocker is named in a comment — say so on the issue, remove
your label, and **exit**. Do not pick another one: the supervisor starts the next process,
and a session that picks a second ticket spends one ticket's accounting on two.
```

- [ ] **Step 10: Run the docs test and commit**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopDocsAreExecutable.test.ts`
Expected: PASS — it checks that queue.md names only real scripts.

```bash
npm run typecheck
git add -- scripts/queue-loop.mjs tests/queueLoop.test.ts .claude/commands/queue.md
git commit -m "fix(loop): pass the ticket number, and stop reading an absent worktree as a landing

The supervisor picked a ticket, then spawned the session with a bare /queue so the session
picked again. landed = after.ticket !== route.number then compared against a number the
session was never told: #70 was reported landed with 34 files and one turn while the
session resumed #955.

locateRun already refuses to guess between two live worktrees. liveRoute returned null on
that refusal, so the supervisor read it as no run live and picked a third ticket."
```

---

## Task 7: Serialise the tickets and delete the merge slot

Defects C1–C5, E3, E4, and the orphaned-pending-pull-request hole. Measured cost of serialising: CI median 6m10 against a ticket median of 27m38 — **+22%, about 74 minutes across a twelve-ticket night** — and less than that once Task 4's timings change lands, because the branch is then never BEHIND.

**Files:**
- Modify: `scripts/queue-loop.mjs` — delete `mergeSlot` (:413-465), `canStartNext` (:324-333), `releaseWorktree` (:404-411), `reattachWorktree` (:485-495), `SHARED_INSTALL` (:321), and rewrite `main()`'s loop body
- Modify: `tests/queueLoop.test.ts` — delete the `mergeSlot` and `canStartNext` describe blocks

**Interfaces:**
- Consumes: `settleOutcome` (Task 5), `outcomeOf` (Task 6), `afterPush` (Task 2).
- Produces: `main()` with no in-memory pending pull request. `settle(pending, log, pause)` keeps its signature.

- [ ] **Step 1: Write the failing test for the new loop shape**

Create `tests/queueLoopMain.test.ts`:

```typescript
// tests/queueLoopMain.test.ts
//
// main() is where eight of the ten headline defects lived, and it was the one function with no
// test: every export was unit-tested and the composition was not.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runOnce } from "../scripts/queue-loop.mjs";

const io = (over: Record<string, unknown> = {}) => ({
  stopFile: () => false,
  syncCheckout: () => true,
  queuePre: () => 0,
  pick: () => ({ skill: "implement", number: 42, title: "t", queue: { implement: 1, triage: 0, wayfinder: 0 } }),
  spawn: async () => ({ status: 0, blocked: false, result: { cost: 1, turns: 9 }, ms: 1000, log: "l", phase: "E" }),
  standing: () => ({ ticket: 42, branch: "agent/42-x", cwd: ".worktrees/agent-42", head: "a", commits: 1, changed: [], dirty: false, phase: "E" }),
  pushedPr: () => 984,
  settle: async () => ({ action: "merged", why: "merged" }),
  park: () => {},
  record: () => {},
  log: () => {},
  ...over,
});

describe("runOnce", () => {
  test("a ticket that pushes and merges is landed, in one pass", async () => {
    const r = await runOnce(io());
    assert.equal(r.outcome, "landed");
    assert.equal(r.ticket, 42);
  });

  // The whole point of serialising: settle() runs before the next pick, so there is no slot to
  // orphan when the process dies and no second ticket in flight to confuse derive().
  test("settle runs before the pass returns", async () => {
    const order: string[] = [];
    await runOnce(io({
      spawn: async () => { order.push("spawn"); return { status: 0, blocked: false, result: {}, ms: 1, log: "l", phase: "E" }; },
      settle: async () => { order.push("settle"); return { action: "merged", why: "" }; },
    }));
    assert.deepEqual(order, ["spawn", "settle"]);
  });

  test("a settle that does not merge counts as a failure and parks nothing", async () => {
    const parked: number[] = [];
    const r = await runOnce(io({
      settle: async () => ({ action: "park", why: "update-branch did not settle in 3 rounds" }),
      park: (n: number) => parked.push(n),
    }));
    assert.equal(r.outcome, "stalled");
    assert.deepEqual(parked, []);
  });

  test("a session that pushed nothing parks the ticket", async () => {
    const parked: number[] = [];
    const r = await runOnce(io({ pushedPr: () => null, park: (n: number) => parked.push(n) }));
    assert.equal(r.outcome, "parked");
    assert.deepEqual(parked, [42]);
  });

  test("an ambiguous pick stops rather than taking a third ticket", async () => {
    const r = await runOnce(io({ pick: () => ({ skill: "ambiguous", title: "2 live worktrees" }) }));
    assert.equal(r.outcome, "stop");
  });

  test("a handoff route drains and stops", async () => {
    const r = await runOnce(io({ pick: () => ({ skill: "handoff", title: "nothing agent-takeable" }) }));
    assert.equal(r.outcome, "stop");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoopMain.test.ts`
Expected: FAIL — `runOnce is not defined`.

- [ ] **Step 3: Extract one iteration as `runOnce`**

Add to `scripts/queue-loop.mjs`. Every dependency is a parameter so the composition can be tested without a `claude` binary, a git repository or a network:

```js
/**
 * One ticket, start to finish. Serialised deliberately: the previous design ran the next ticket
 * against the last one's CI wait, which bought ~22% wall clock and cost an in-memory pending pull
 * request that nothing recovered when the process died, a worktree released out from under a live
 * `derive()`, and two sessions merging each other's work to get past a branch cut from a `main`
 * that did not have it yet.
 *
 * @returns {Promise<{outcome: "landed"|"parked"|"stalled"|"stop"|"retry", ticket?: number, why?: string}>}
 */
export async function runOnce(io) {
  if (io.stopFile()) return { outcome: "stop", why: ".loop-stop" };
  if (!io.syncCheckout()) return { outcome: "stop", why: "the shared checkout is not usable" };
  const pre = io.queuePre();
  if (pre !== 0) return { outcome: "stop", why: `queue-pre exited ${pre}` };

  const route = io.pick();
  if (route.skill === "handoff") return { outcome: "stop", why: route.title };
  if (route.skill === "ambiguous") return { outcome: "stop", why: route.title };

  const run = await io.spawn(route);
  if (run.blocked) return { outcome: "retry", ticket: route.number, why: "the usage window is spent" };

  const after = io.standing();
  const pr = after?.branch ? io.pushedPr(after.branch) : null;
  const why = reasonFor(run, after, route.number);
  const decided = outcomeOf({ pr, why });

  if (!decided.pushed) {
    if (after) io.park(route.number, { phase: after.phase, why: decided.why, log: run.log, cwd: after.cwd, branch: after.branch, dirty: after.dirty });
    io.record(route.number, "parked", decided.why, run);
    return { outcome: "parked", ticket: route.number, why: decided.why };
  }

  const settled = await io.settle({ ticket: route.number, pr, branch: after.branch, cwd: after.cwd });
  if (settled.action === "merged") {
    io.record(route.number, "landed", null, run);
    return { outcome: "landed", ticket: route.number };
  }
  if (settled.action === "fix") {
    io.record(route.number, null, settled.why, run);
    return { outcome: "retry", ticket: route.number, why: settled.why };
  }
  io.record(route.number, "stalled", settled.why, run);
  return { outcome: "stalled", ticket: route.number, why: settled.why };
}

/** Why this session did not finish its ticket, or null if it did. */
export function reasonFor(run, after, ticket) {
  if (after && after.ticket !== ticket) return `the session worked #${after.ticket}, not #${ticket}`;
  if (run.status === "stalled") return `no output for ${Math.round(STALL_MS / 60_000)}m in phase ${run.phase ?? "?"}`;
  if (run.status !== 0) return `the session exited ${run.status} in phase ${run.phase ?? "?"}`;
  return null;
}
```

Then rewrite `main()` to be the loop around it, carrying only the breaker and the totals:

```js
async function main() {
  let failures = 0;
  const totals = { tickets: 0, landed: 0, parked: 0, cost: 0, ms: 0 };
  pruneLogs();

  for (;;) {
    const pass = await runOnce(realIo(totals));
    if (pass.outcome === "stop") {
      console.log(`queue-loop: ${pass.why} — stopping`);
      console.log(runTotal(totals));
      return 0;
    }
    if (pass.outcome === "retry") continue;
    totals.tickets += 1;
    if (pass.outcome === "landed") { failures = 0; totals.landed += 1; }
    else { failures += 1; totals.parked += 1; }
    if (shouldHalt(failures)) {
      const halted = failures;
      console.error(`queue-loop: ${halted} tickets in a row did not land — stopping`);
      const total = runTotal(totals);
      console.log(total);
      fs.appendFileSync(reportPath(), `\n${total}\n`, "utf8");
      return 1;
    }
  }
}
```

Note `const halted = failures` — defect G6, the old message read the counter after `drain()` had reset it and printed "0 tickets in a row did not land".

Write `realIo(totals)` as a small factory binding the real `takeStopFile`, `syncProtocol`, `queue-pre` spawn, `nextRoute`, `runTicket`, `standing`, `pushedPr`, `settle`, `park` and `record`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoopMain.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Delete what serialising made dead**

Remove from `scripts/queue-loop.mjs`: `mergeSlot`, `canStartNext`, `SHARED_INSTALL`, `releaseWorktree`, `reattachWorktree`, `madeProgress` and `prev` (nothing resumes a pushed ticket now, so the anti-resume-forever guard has nothing to guard), and `stalled` (defect G7 — exported, tested, never called; the watchdog inlines it).

Remove from `tests/queueLoop.test.ts` the describe blocks for each. **Do not delete the `holdFor` test** — Task 9 decides its fate.

- [ ] **Step 6: Run the whole loop suite**

Run: `npm test 2>&1 | tail -30`
Expected: PASS. Anything red here is a test asserting a deleted export — delete the test, do not re-add the export.

- [ ] **Step 7: Typecheck, lint and commit**

```bash
npm run typecheck
npm run lint
git add -- scripts/queue-loop.mjs tests/queueLoop.test.ts tests/queueLoopMain.test.ts
git commit -m "refactor(loop): one ticket at a time, and main() gets a test

Overlapping the next ticket with the last one's CI bought about 22% wall clock and cost:
an in-memory pending pull request nothing recovered when the process died, a worktree
released out from under a live derive(), and two sessions merging a predecessor's pull
request because their branch was cut from a main that did not have it yet.

runOnce() takes its IO as parameters, so the composition where eight of the ten defects
lived is now the part that is tested."
```

---

## Task 8: The session removes its own worktree

Defects C1, C6. The session is the only process that knows whether its tree is dirty. `git worktree remove --force` is **not** the fix — measured, it deletes through a Windows junction into the shared `node_modules` and exits 0.

**Files:**
- Modify: `.claude/commands/queue.md` phase F
- Modify: `scripts/queue-pre.mjs` — add a naming check
- Modify: `tests/loopDocsAreExecutable.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `queue-pre` exits non-zero naming any `.worktrees/*` whose basename does not match `/^agent-\d+$/`.

- [ ] **Step 1: Write the failing test**

In `tests/loopDocsAreExecutable.test.ts`:

```typescript
  test("phase F tells the session to remove its own worktree, through the script", () => {
    const md = readFileSync(".claude/commands/queue.md", "utf8");
    assert.match(md, /npm run worktrees:remove -- \.worktrees\/agent-<n>/);
    // The supervisor cannot do it: after the push the tree is dirty, and the removal refuses a
    // dirty tree for a good reason. Forcing it deletes through the node_modules junction.
    assert.doesNotMatch(md, /The loop tears the worktree down/);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopDocsAreExecutable.test.ts`
Expected: FAIL on the first assertion.

- [ ] **Step 3: Rewrite phase F**

In `.claude/commands/queue.md`, replace step 4 of phase F and the paragraph after it:

```markdown
4. **Tear down your worktree, then exit.**

   ```sh
   git -C .worktrees/agent-<n> status --short      # nothing unexpected left behind?
   npm run worktrees:remove -- .worktrees/agent-<n>
   git worktree list                               # yours is gone
   ```

   You are the only process that knows whether that tree is dirty, which is why this is yours
   and not the supervisor's. If the removal refuses, **read what it names** — that is work you
   have not committed. Commit it to your branch and push again, or say on the issue what it is.
   Never pass `--force` and never `rm -rf`: a `--force` removal walks *through* the
   `node_modules` junction into the shared install and exits 0. `scripts/guard-bash.mjs` blocks
   the form; the reason is measured, not theorised.

5. **Exit.** One ticket per process, by design: `scripts/queue-loop.mjs` starts the next ticket
   in a clean process. Do not loop back to phase A, and do not pick another ticket.
```

Delete the sentence "The loop tears the worktree down, on the landed, parked and stopped paths alike."

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopDocsAreExecutable.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the naming check**

Create or extend `tests/queuePre.test.ts`:

```typescript
  test("a worktree that does not follow the naming convention is named", () => {
    const bad = misnamedWorktrees([".worktrees/agent-42", ".worktrees/fix-971", ".worktrees/agent-7"]);
    assert.deepEqual(bad, [".worktrees/fix-971"]);
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queuePre.test.ts`
Expected: FAIL — `misnamedWorktrees is not defined`.

- [ ] **Step 7: Add the check**

In `scripts/queue-pre.mjs`:

```js
/**
 * `derive()` reads a worktree's *branch* to find the ticket and ignores a directory whose branch
 * is not `agent/<n>-…`; `prune-worktrees` reads the *registration* and treats every directory
 * under `.worktrees/` as first class. A `fix-971` is therefore invisible to the thing that decides
 * whether a run is live and visible to the thing that deletes worktrees.
 */
export function misnamedWorktrees(dirs) {
  return dirs.filter((d) => !/^agent-\d+$/.test(d.split(/[\\/]/).pop() ?? ""));
}
```

Add it as a fourth step in `main()`, after `prune-worktrees` and before `preflight`, reading `.worktrees/` with `readdirSync` and exiting 1 naming any offender and the command to remove it.

- [ ] **Step 8: Run the tests and commit**

```bash
node --test --test-timeout=30000 --test-force-exit tests/queuePre.test.ts tests/loopDocsAreExecutable.test.ts
npm run typecheck
git add -- .claude/commands/queue.md scripts/queue-pre.mjs tests/queuePre.test.ts tests/loopDocsAreExecutable.test.ts
git commit -m "fix(loop): the session tears down its own worktree

The supervisor removed it without --force against a post-push tree that is always dirty,
the removal refused, and the surviving directory made derive() report a live run — so the
next iteration resumed an already-pushed ticket, found nothing committed, and parked it.

--force is not the fix: it deletes through the node_modules junction into the shared
install and exits 0. The session knows what is dirty; the supervisor does not."
```

---

## Task 9: Drain and exit on a rate limit instead of holding for five hours

Defects H5, H6, H7. `WAIT.CAP` is 5.5 hours against a night, and the hold protects no state — everything is derived from git and the tracker.

**Files:**
- Modify: `scripts/queue-loop.mjs` — delete `holdFor`, `waitFor`, `WAIT`, `afterRefusal`, `waits`, `waitsOn`; change `takeStopFile`
- Modify: `scripts/loop-stream.mjs:57-64` — correct the `rate_limit_info` field names
- Delete: `tests/loopHoldSurvives.test.ts`
- Modify: `tests/queueLoop.test.ts`, `tests/loopStream.test.ts`

**Interfaces:**
- Consumes: `runOnce` from Task 7.
- Produces: `takeStopFile(fs, file)` no longer removes the file. `readLine` returns `rate_limit` facts with `{status, blocked, warning, resetsAt, resetsAtMs, utilization, errorCode}` — **no `window`, no `used`**.

- [ ] **Step 1: Write the failing stream test**

In `tests/loopStream.test.ts`:

```typescript
  test("a rate limit event reads the fields the SDK actually publishes", () => {
    const fact = readLine(JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1789000000, utilization: 1 },
    }));
    assert.equal(fact?.kind, "rate_limit");
    assert.equal(fact?.blocked, true);
    assert.equal(fact?.utilization, 1);
  });

  // The third status is the only signal that arrives before work starts failing.
  test("allowed_warning is not a refusal but is worth knowing", () => {
    const fact = readLine(JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed_warning", utilization: 0.92 },
    }));
    assert.equal(fact?.blocked, false);
    assert.equal(fact?.warning, true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopStream.test.ts`
Expected: FAIL — there is no `warning` field.

**Do not touch the `unifiedWindows` / `rateLimitType` reads.** An earlier draft of this step said
those fields do not exist and told you to delete them. They are real — verified in `claude.exe`'s
own schema — and the existing fallback is correct. Only the `warning` field is missing. The
corrected replacement below reflects that.

- [ ] **Step 3: Correct the field names**

In `scripts/loop-stream.mjs`, replace the `rate_limit_event` branch:

```js
  if (e.type === "rate_limit_event") {
    const info = e.rate_limit_info ?? {};
    // A window's own `resetsAt` is preferred over the top-level one. `rateLimitType` names six
    // windows and `unifiedWindows` carries three, so the lookup is legitimately undefined for
    // `seven_day_opus` and both reads fall back.
    const window = info.unifiedWindows?.[info.rateLimitType];
    return {
      kind: "rate_limit",
      status: info.status ?? "unknown",
      blocked: info.status === "rejected",
      warning: info.status === "allowed_warning",
      resetsAt: window?.resetsAt ?? info.resetsAt ?? null,
      resetsAtMs: (() => {
        const at = window?.resetsAt ?? info.resetsAt;
        return at ? (at > 1e12 ? at : at * 1000) : 0;
      })(),
      utilization: window?.utilization ?? info.utilization ?? null,
      errorCode: info.errorCode ?? null,
    };
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopStream.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the stop file**

```typescript
  test("the stop file survives being read", () => {
    let removed = false;
    const fakeFs = { existsSync: () => true, rmSync: () => { removed = true; } };
    assert.equal(takeStopFile(fakeFs, ".loop-stop"), true);
    // A scheduled restart must see it too. holdFor honoured it without consuming it and
    // takeStopFile consumed it, so a stop during a wait silently killed the next run as well.
    assert.equal(removed, false);
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: FAIL — `removed` is `true`.

- [ ] **Step 7: Stop consuming the file, and exit on a refusal**

```js
/** `.loop-stop` drains the loop. Left on disk, so a scheduled restart sees it too. */
export function takeStopFile(fs, file) {
  return fs.existsSync(file);
}
```

Delete `holdFor`, `waitFor`, `WAIT`, `afterRefusal`, and the `waits`/`waitsOn` variables. In `runOnce`, the `blocked` branch already returns `{outcome: "retry"}`; change it to return `{outcome: "stop"}` and have `main()` print the reset clock:

```js
  if (run.blocked) {
    return {
      outcome: "stop",
      ticket: route.number,
      why: `the usage window is spent — resets ${clockAt(run.blockedUntil)}. Nothing is lost: ` +
        `the branch, the pull request and the label are all on disk and on the tracker. Start the ` +
        `loop again after the reset, or schedule it.`,
    };
  }
```

Delete `tests/loopHoldSurvives.test.ts` and the `holdFor`/`waitFor`/`afterRefusal` describe blocks in `tests/queueLoop.test.ts`.

- [ ] **Step 8: Add `.loop-stop` to `.gitignore`**

Defect H8. In `.gitignore`, beside the existing `.loop-logs/` line:

```
.loop-stop
```

- [ ] **Step 9: Run the suite and commit**

```bash
npm test 2>&1 | tail -20
npm run typecheck
git add -- scripts/queue-loop.mjs scripts/loop-stream.mjs tests/queueLoop.test.ts tests/loopStream.test.ts .gitignore
git rm tests/loopHoldSurvives.test.ts
git commit -m "fix(loop): exit on a spent usage window instead of holding 5.5 hours

The hold protected no state — everything the loop knows is derived from git and the
tracker, and a restarted process re-derives it in one call. It held an un-suspended node
process through most of an unattended night, and its refusal counter was keyed per ticket
when a usage refusal is a property of the account.

.loop-stop is no longer consumed on read: holdFor honoured it without removing it and
takeStopFile removed it, so a stop during a wait killed the next run too.

The only missing field was `warning` — status has a third value, allowed_warning, which is
the only signal arriving before work starts failing."
```

---

## Task 10: `syncProtocol` should check dirtiness, not a diff against origin

Defects H1, H2, H3. The loop's own tickets edit `scripts/`, so diffing `scripts/` against `origin/main` reports drift every iteration; and the dirty-`main` case reaches `merge --ff-only`, which refuses and ends the run.

**Files:**
- Modify: `scripts/queue-loop.mjs:137-179`
- Modify: `tests/queueLoop.test.ts` (the `syncProtocol` describe block)

**Interfaces:**
- Consumes: nothing.
- Produces: `syncCheckout(git, log)` replaces `syncProtocol(git, log)`; same `(git, log) => boolean` shape.

- [ ] **Step 1: Write the failing tests**

```typescript
  describe("syncCheckout", () => {
    const fake = (answers: Record<string, string>) => (...args: string[]) => {
      const key = args.join(" ");
      for (const [k, v] of Object.entries(answers)) if (key.startsWith(k)) return v;
      return "";
    };

    test("a clean main behind origin fast-forwards and says nothing about drift", () => {
      const said: string[] = [];
      const ok = syncCheckout(fake({ "rev-parse --abbrev-ref": "main", "status --porcelain": "" }), (m) => said.push(m));
      assert.equal(ok, true);
      assert.equal(said.filter((s) => /differs/.test(s)).length, 0);
    });

    // The loop's own tickets edit scripts/. Diffing scripts/ against origin/main called that drift
    // on every iteration; being behind is staleness, and staleness is repaired, not reported.
    test("being behind origin is not drift", () => {
      const said: string[] = [];
      syncCheckout(fake({ "rev-parse --abbrev-ref": "main", "status --porcelain": "" }), (m) => said.push(m));
      assert.equal(said.some((s) => /protocol differs/.test(s)), false);
    });

    test("an uncommitted protocol edit on main refuses, and names the files", () => {
      const said: string[] = [];
      const ok = syncCheckout(
        fake({ "rev-parse --abbrev-ref": "main", "status --porcelain": " M scripts/queue-loop.mjs\n M .claude/commands/queue.md" }),
        (m) => said.push(m),
      );
      assert.equal(ok, false);
      assert.match(said.join("\n"), /scripts\/queue-loop\.mjs/);
      assert.match(said.join("\n"), /queue\.md/);
    });

    test("a foreign branch with its own commits refuses", () => {
      const ok = syncCheckout(
        fake({ "rev-parse --abbrev-ref": "agent/9-x", "status --porcelain": "", "rev-list --count": "2" }),
        () => {},
      );
      assert.equal(ok, false);
    });

    test("a detached head refuses rather than checking main out from under it", () => {
      const ok = syncCheckout(fake({ "rev-parse --abbrev-ref": "HEAD", "status --porcelain": "" }), () => {});
      assert.equal(ok, false);
    });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: FAIL — `syncCheckout is not defined`.

- [ ] **Step 3: Replace `syncProtocol`**

```js
// The session and the loop read these from the shared checkout, not from the ticket's worktree.
const PROTOCOL = ["CLAUDE.md", ".claude", "scripts"];

/**
 * Leaves the shared checkout on an up-to-date `main`, or refuses and says why.
 *
 * It asks whether the protocol files are *dirty*, not whether they differ from `origin/main`.
 * Those are different questions: the loop's own tickets edit `scripts/`, so the moment one merges
 * the checkout differs from origin until it is fast-forwarded — which is staleness, repaired here
 * rather than reported. Only an uncommitted edit is drift, and it belongs to someone.
 */
export function syncCheckout(git, log) {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").trim();
  if (branch === "HEAD") {
    log("queue-loop: the shared checkout is on a detached HEAD — put it back on main first.");
    return false;
  }

  const dirty = git("status", "--porcelain", "--", ...PROTOCOL).trim();
  if (dirty) {
    log("queue-loop: the protocol files in the shared checkout have uncommitted edits:");
    for (const line of dirty.split("\n")) log(`  ${line}`);
    log("  Commit them, or put them somewhere else. Nothing here will discard them.");
    return false;
  }

  if (branch !== "main") {
    const own = Number(git("rev-list", "--count", "origin/main..HEAD").trim()) || 0;
    if (own > 0) {
      log(`queue-loop: ${branch} is checked out with ${own} commit(s) of its own — not moving it.`);
      return false;
    }
    try {
      git("checkout", "main");
    } catch (err) {
      log(`queue-loop: cannot return to main — ${String(err.message).split("\n")[0]}`);
      return false;
    }
  }

  try {
    git("fetch", "origin", "--quiet");
    git("merge", "--ff-only", "origin/main");
  } catch (err) {
    log(`queue-loop: cannot fast-forward main — ${String(err.message).split("\n")[0]}`);
    return false;
  }
  return true;
}
```

Point `runOnce`'s `syncCheckout` at it and delete `syncProtocol`.

- [ ] **Step 4: Run the tests and commit**

```bash
node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts
npm run typecheck
git add -- scripts/queue-loop.mjs tests/queueLoop.test.ts
git commit -m "fix(loop): ask whether the protocol files are dirty, not whether they differ

Diffing scripts/ against origin/main conflated a stale checkout with an edited one, and
the loop's own tickets edit scripts/ — so it reported drift on every iteration. The
dirty-main case then reached merge --ff-only, which refuses over local changes, which
ended one run and left the checkout in that state."
```

---

## Task 11: Delete the phase board; let the session say what phase it is in

Defects G3, G5, G7. ≈890 lines that decide nothing, costing 560–1,280 subprocess spawns per ticket.

**Files:**
- Delete: `scripts/loop-render.mjs`, `tests/loopRender.test.ts`
- Modify: `scripts/loop-stream.mjs` — delete `PHASE_MARKERS`, `toPattern`, `COMPILED`, `phaseOf`, `REDERIVE`; add `PHASE` line reading
- Modify: `scripts/queue-loop.mjs` — `runTicket` loses the board; keep `header`, `phaseLine`, `closing`, `runTotal` as ~30 lines of local rendering
- Modify: `.claude/commands/queue.md` — one `echo` per phase
- Modify: `tests/loopStream.test.ts`, `tests/loopDocsAreExecutable.test.ts`, `tests/queueLoop.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `readLine` returns `{kind: "phase", letter: string}` for a stdout line matching `/^PHASE ([A-F])$/`. `runTicket` returns `{status, blocked, blockedUntil, result, phase, files, version, ms, log}` — same shape, `phase` now from the session.

- [ ] **Step 1: Write the failing test**

In `tests/loopStream.test.ts`:

```typescript
  test("a PHASE line from the session is a fact", () => {
    assert.deepEqual(readLine('{"type":"assistant","message":{"content":[{"type":"text","text":"PHASE D"}]}}'), {
      kind: "phase",
      letter: "D",
    });
  });

  test("prose mentioning a phase is not a fact", () => {
    const fact = readLine('{"type":"assistant","message":{"content":[{"type":"text","text":"now in PHASE D of six"}]}}');
    assert.notEqual(fact?.kind, "phase");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopStream.test.ts`
Expected: FAIL — `readLine` returns `null` for a text-only assistant message.

- [ ] **Step 3: Read the phase the session reports**

In `scripts/loop-stream.mjs`, delete `PHASE_MARKERS`, `toPattern`, `COMPILED`, `phaseOf` and `REDERIVE`, and inside the `e.type === "assistant"` branch, before the tool-call mapping:

```js
    // The session is the only thing that knows what phase it is in. Inferring it from outside by
    // regexing its shell commands missed 56% of the markers it was built to catch, because
    // queue.md itself prescribes `git add -- <paths>` before committing and the anchor never fired.
    const said = (e.message?.content ?? []).find((b) => b.type === "text");
    const phase = /^PHASE ([A-F])$/m.exec(String(said?.text ?? "").trim());
    if (phase) return { kind: "phase", letter: phase[1] };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopStream.test.ts`
Expected: PASS.

- [ ] **Step 5: Emit the phase from queue.md**

At the top of each phase section in `.claude/commands/queue.md`, add the echo as the phase's first instruction. Phase A:

```markdown
Say which phase you are in, as the whole of one message, before its first command:

`PHASE A`

The supervisor reads that line and nothing else about your progress. One line, on its own,
no prose around it — a sentence mentioning the phase is not a phase report.
```

Repeat for B–F with the matching letter, one line each, without repeating the explanation.

- [ ] **Step 6: Strip the board out of `runTicket`**

Delete from `scripts/queue-loop.mjs`: the `beat`/`erase`/`say` TTY block, `snapshot()`, `closePhase()`, `advance()`, `state.phases`, `state.tasks`, `state.lastDerive`, `state.files`, `state.seen`, and the whole `fact.kind === "tool"` loop. Replace the stdout handler's body with:

```js
  createInterface({ input: child.stdout }).on("line", (line) => {
    sink.write(`${line}\n`);
    state.lastFactAt = Date.now();
    const fact = readLine(line);
    if (!fact) return;
    if (fact.kind === "init") state.version = fact.version;
    if (fact.kind === "phase") {
      state.phase = fact.letter;
      log(phaseLine({ letter: fact.letter, ms: Date.now() - startedAt }));
    }
    // A session emits one result per turn, and a background task's wake-up is a turn. The real
    // one carries `origin: null`; every other carries origin.kind "task-notification". Last-wins
    // across all of them reported a 144-turn session as one turn.
    if (fact.kind === "result" && !fact.origin) state.result = fact;
    if (fact.kind === "rate_limit" && fact.blocked && !state.blocked) {
      state.blocked = true;
      state.blockedUntil = fact.resetsAtMs ?? 0;
    }
  });
```

Add `origin: e.origin ?? null` to `readLine`'s `result` return.

Move `header`, `phaseLine`, `closing`, `elapsed`, `clockAt` and `runTotal` from `loop-render.mjs` into `queue-loop.mjs` as ~30 lines, and delete `detailOf`, `reportRow`, `heartbeat`, `BLANK`, `SPIN`, `parseStatus`, `ticketFacts` and the `run-<date>.md` writing.

- [ ] **Step 7: Delete the files and their tests**

```bash
git rm scripts/loop-render.mjs tests/loopRender.test.ts
```

Remove the phase-marker describe from `tests/loopDocsAreExecutable.test.ts`, and add one asserting every phase heading in queue.md carries its echo:

```typescript
  test("every phase of queue.md reports itself", () => {
    const md = readFileSync(".claude/commands/queue.md", "utf8");
    for (const letter of ["A", "B", "C", "D", "E", "F"]) {
      assert.match(md, new RegExp("`PHASE " + letter + "`"), `phase ${letter} has no echo`);
    }
  });
```

- [ ] **Step 8: Run everything and commit**

```bash
npm test 2>&1 | tail -20
npm run typecheck
npm run lint
git add -- scripts/queue-loop.mjs scripts/loop-stream.mjs .claude/commands/queue.md tests/
git commit -m "refactor(loop): the session says what phase it is in

The board inferred it by regexing the session's shell commands, and missed 74 of 131
markers — queue.md prescribes \`git add -- <paths>\` before committing, so the anchored
pattern never fired. #982 and #983 rendered as claim-then-push while their issues record
three full review rounds each.

It also cost a derive() every 20 seconds: 8 subprocesses a call, 70-160 calls a ticket,
to draw a line nothing branches on. loop-stream.mjs said so itself.

A session emits one result per turn and a background task's wake-up is a turn; the real
one carries origin: null. Last-wins reported a 144-turn session as one turn."
```

---

## Task 12: The picker claims what it picks, and stops freezing tickets

Defects F1, F2, F4, F5, F6.

**Files:**
- Modify: `scripts/next-ticket.mjs:54` (the sort), `:60-105` (`claimBranch`/`branchAlive`/`takeable`), `:117-156` (`printDetail`)
- Modify: `tests/nextTicket.test.ts`
- Modify: `.claude/commands/queue.md` phase C (the filing block)

**Interfaces:**
- Consumes: nothing.
- Produces: `classify(openIssues)` unchanged in shape; its `frontier` is sorted oldest-first. `claimedElsewhere(number, ghJson)` replaces `branchAlive`.

- [ ] **Step 1: Write the failing tests**

```typescript
  test("the frontier serves the oldest ticket first, whatever its size", () => {
    const b = classify([
      { number: 995, title: "new and small", labels: [{ name: "ready-for-agent" }, { name: "size:S" }] },
      { number: 70, title: "old and large", labels: [{ name: "ready-for-agent" }, { name: "size:L" }] },
    ]);
    assert.deepEqual(b.frontier.map((i: { number: number }) => i.number), [70, 995]);
  });

  test("an unreachable origin does not empty the queue", () => {
    // The comment promised fail-open and the code had no try/catch, so an unreachable origin
    // threw out of takeable(), out of the picker, and took the supervisor's for(;;) with it.
    const threw = () => { throw new Error("could not read from remote repository"); };
    assert.equal(claimedElsewhere(42, threw), false);
  });

  test("a claim is live only while its pull request is open", () => {
    const open = () => [{ number: 984, state: "OPEN" }];
    const merged = () => [];
    assert.equal(claimedElsewhere(42, open), true);
    assert.equal(claimedElsewhere(42, merged), false);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-timeout=30000 --test-force-exit tests/nextTicket.test.ts`
Expected: FAIL — the frontier is `[995, 70]` and `claimedElsewhere` is not defined.

- [ ] **Step 3: Fix the sort and replace the claim test**

In `scripts/next-ticket.mjs`:

```js
  // Oldest first. Sorting by size first put every self-filed follow-up at the head of the
  // frontier: the loop files a size:S ticket out of its own tooling and then serves it before
  // anything older, which is how three consecutive sessions went to one local-only check.
  buckets.frontier.sort((a, b) => a.number - b.number);
```

```js
/**
 * Whether someone else is working this ticket.
 *
 * A branch alive on origin is not a claim: `delete_branch_on_merge` was off for months, so six
 * merged branches were still there and each one froze its ticket for ever. An *open pull request*
 * is the claim — one call, and it answers both halves of the question `issue-tracker.md` asks.
 *
 * Fails open, and this time the code does it: an unreachable tracker must not empty the queue.
 */
export function claimedElsewhere(number, list) {
  try {
    return list(number).some((pr) => pr.state === "OPEN");
  } catch {
    return false;
  }
}
```

In `takeable`, replace the `claimBranch`/`branchAlive` block with a call to `claimedElsewhere(issue.number, (n) => ghJson(["pr", "list", "--search", `${n} in:body`, "--state", "open", "--json", "number,state"]))`, and delete `claimBranch` and `branchAlive`.

- [ ] **Step 4: Stop fetching three candidates and refetching one**

`takeable(frontier, 3)` fetches three and `pickRoute` uses `head[0]` — four wasted `gh api` calls per pick; and `printDetail` refetches the issue `takeable` already read. Change `pickRoute` to `takeable(buckets.frontier, 1)`, and change `printDetail(ticket, comments)` to take the issue object `takeable` already holds rather than refetching it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test --test-timeout=30000 --test-force-exit tests/nextTicket.test.ts`
Expected: PASS.

- [ ] **Step 6: Teach phase C to record a dependency**

Defect F6 — nothing in the repo creates a dependency edge; the command is named only in a wayfinding section, which is why #992→#983 exists and #993→#987 does not. In `.claude/commands/queue.md`, in phase C's filing block, after the `gh issue create` line:

```markdown
  If the thing you filed cannot be started until this ticket lands — it edits the same file, or
  it builds on what you are adding — record that, or the picker will serve it against a `main`
  that does not have your change and the session will be stuck the way #995 was:

  ```sh
  gh api -X POST repos/{owner}/{repo}/issues/<new>/dependencies/blocked_by -f issue_id=<this>
  ```
```

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
node --test --test-timeout=30000 --test-force-exit tests/nextTicket.test.ts tests/loopDocsAreExecutable.test.ts
git add -- scripts/next-ticket.mjs tests/nextTicket.test.ts .claude/commands/queue.md
git commit -m "fix(picker): oldest first, and a claim is an open pull request

Sorting by size first put every self-filed size:S follow-up at the head of the frontier,
so the loop served its own tooling's tickets ahead of older player-facing work for three
sessions running.

branchAlive had no try/catch behind a comment promising fail-open, and a merged-but-
undeleted branch read as a live claim — ten such branches were on origin, six of them
merged, each freezing its ticket."
```

---

## Task 13: Bound the session by turns, and let the supervisor see why it stopped

Defects G1, G2, G4. `--max-budget-usd` is checked *after* a turn settles (measured 42× over a small cap), resets on `--resume`, and at $15 it kills the session's **subagents** — #969 lost its phase-D review to it and carried on.

**Files:**
- Modify: `scripts/queue-loop.mjs` — `TICKET_BUDGET_USD`, `queueLoopArgs`, `runTicket`'s stderr handling
- Modify: `tests/queueLoop.test.ts`

**Interfaces:**
- Consumes: `queueLoopArgs(number)` from Task 6.
- Produces: `queueLoopArgs(number, size)` — `size` is a `size:*` label string or `null`. `runTicket` returns `stderr: string` alongside its existing fields.

- [ ] **Step 1: Write the failing tests**

```typescript
  test("the spawn bounds turns as well as dollars", () => {
    const args = queueLoopArgs(42, "size:S");
    assert.ok(args.includes("--max-turns"), "a dollar cap is checked after a turn settles");
  });

  test("a larger ticket gets more turns", () => {
    const s = Number(queueLoopArgs(1, "size:S")[queueLoopArgs(1, "size:S").indexOf("--max-turns") + 1]);
    const l = Number(queueLoopArgs(1, "size:L")[queueLoopArgs(1, "size:L").indexOf("--max-turns") + 1]);
    assert.ok(l > s, `size:L should get more turns than size:S, got ${l} and ${s}`);
  });

  test("an unlabelled ticket still gets a bound", () => {
    const args = queueLoopArgs(1, null);
    const n = Number(args[args.indexOf("--max-turns") + 1]);
    assert.ok(Number.isInteger(n) && n > 0);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: FAIL — `--max-turns` is not in the argument list.

- [ ] **Step 3: Bound by turns, and keep the dollar cap as a far-out backstop**

```js
/**
 * The real bound is turns: a dollar cap is checked after a turn settles, so its stopping point
 * moves with the model and the context — measured 8x to 42x over a small cap — and at $15 with
 * subagents in flight it stops the *subagents* and lets the session carry on. #969 lost its
 * phase-D review to it, which is two opus reviewers, and finished anyway.
 *
 * The dollar figure stays as a backstop against one pathological turn, well above the number a
 * healthy ticket reaches.
 */
const TURNS_BY_SIZE = { "size:XS": 60, "size:S": 120, "size:M": 200, "size:L": 320, "size:XL": 400 };
const TURNS_DEFAULT = 150;
const TICKET_BUDGET_USD = "40";

export function queueLoopArgs(number, size = null) {
  return [
    "-p",
    `/queue ${number}`,
    "--permission-mode",
    "auto",
    "--strict-mcp-config",
    "--output-format",
    "stream-json",
    "--verbose",
    "--tools",
    readAllowedTools().join(","),
    "--max-turns",
    String(TURNS_BY_SIZE[size ?? ""] ?? TURNS_DEFAULT),
    "--max-budget-usd",
    TICKET_BUDGET_USD,
  ];
}
```

**Before committing, prove `--max-turns` is accepted by this CLI** — it is documented but hidden from `claude --help`:

```bash
claude -p --max-turns 1 "say ok" >/dev/null 2>&1; echo "max-turns exit=$?"
claude -p --this-flag-does-not-exist 1 "say ok" >/dev/null 2>&1; echo "unknown flag exit=$?"
```

Expected: `max-turns exit=0` (or a turn-limit error, not a parse error) and `unknown flag exit=1`. If both are 1, read the error text — a parse error means the flag is gone and this step needs the user.

- [ ] **Step 4: Capture the child's stderr instead of inheriting it**

The budget message goes to stderr, which `runTicket` inherits and never reads — so the loop cannot name a budget stop, and `subtype` still says `success`. In `runTicket`:

```js
  const child = spawnFn("claude", queueLoopArgs(number, size), {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DISABLE_AUTOUPDATER: "1" },
  });

  // Mirrored, not swallowed: a crash must still print itself. Kept because it is the only place
  // "Budget limit reached ($15.08 of $15); stopping background agents." is ever said — the result
  // event for that session still reads subtype "success".
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });
```

Return `stderr` from the promise, and in `reasonFor`, before the status checks:

```js
  if (/Budget limit reached/.test(run.stderr ?? "")) return "the session spent its budget mid-phase";
  if (run.result?.subtype === "error_max_turns") return "the session ran out of turns";
  if (run.result?.terminalReason && run.result.terminalReason !== "completed")
    return `the session ended on ${run.result.terminalReason}`;
```

Add `terminalReason: e.terminal_reason ?? null` to `readLine`'s `result` return if it is not there — check first; the current code already has it.

- [ ] **Step 5: Run the tests, and pass the size through**

`runOnce`'s `pick()` already returns the route; add the ticket's `size:*` label to it from `next-ticket.mjs`'s `ROUTE` line (add a fourth tab-separated field) so `runTicket` can pass it to `queueLoopArgs`. Update `parseRoute` to read it and its test to expect it.

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add -- scripts/queue-loop.mjs scripts/next-ticket.mjs scripts/loop-stream.mjs tests/
git commit -m "fix(loop): bound a session by turns, and read the stderr that says why it stopped

--max-budget-usd is checked after a turn settles, so its stopping point moves with the
model and the context, and it resets on every --resume. At \$15 with subagents in flight
it stops the subagents rather than the session: #969 lost both phase-D reviewers to it and
carried on to phase E.

The message that says so is on stderr, which runTicket inherited and never read, and the
result event for that session still says subtype success."
```

---

## Task 14: `ciVerdict` — a null conclusion, and something that watches `main`

Defects A8, I2.

**Files:**
- Modify: `lib/loop/ciVerdict.ts:63-78`
- Create: `tests/ciVerdict.test.ts`
- Modify: `scripts/queue-pre.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `decideVerdict(run, jobs)` unchanged in signature. `queue-pre` gains a main-health read that warns and does not block.

- [ ] **Step 1: Write the failing test**

Create `tests/ciVerdict.test.ts`:

```typescript
// tests/ciVerdict.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decideVerdict } from "../lib/loop/ciVerdict.ts";

const run = (over = {}) => ({ databaseId: 1, status: "completed", conclusion: "failure", ...over });

describe("decideVerdict", () => {
  test("no run at all is infrastructure, not a red branch", () => {
    assert.equal(decideVerdict(undefined, []).infrastructure, true);
  });

  test("a run still going is not a verdict", () => {
    const v = decideVerdict(run({ status: "in_progress" }), []);
    assert.equal(v.pass, false);
    assert.match(v.reason, /in_progress/);
  });

  test("success passes", () => {
    assert.equal(decideVerdict(run({ conclusion: "success" }), []).pass, true);
  });

  test("a job that failed with steps is a real failure", () => {
    const v = decideVerdict(run(), [{ name: "Browser tests 2/6", conclusion: "failure", steps: 11 }]);
    assert.equal(v.pass, false);
    assert.equal(v.infrastructure, undefined);
    assert.equal(v.failedStep, "Browser tests 2/6");
  });

  test("a skipped device job is not stepless infrastructure", () => {
    const v = decideVerdict(run(), [
      { name: "iOS compiles", conclusion: "skipped", steps: 0 },
      { name: "Lint", conclusion: "failure", steps: 4 },
    ]);
    assert.equal(v.infrastructure, undefined);
    assert.equal(v.failedStep, "Lint");
  });

  // ci.yml cancels in-progress pull-request runs on every new push, and a job that never started
  // carries conclusion null with zero steps. null is not success, skipped or cancelled, so it fell
  // into `stepless` — the right answer reached by the wrong route, on a path exercised constantly.
  test("a job that never started is not evidence of a runner failure", () => {
    const v = decideVerdict(run({ conclusion: "cancelled" }), [{ name: "Lint", conclusion: null, steps: 0 }]);
    assert.match(v.reason, /cancelled/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/ciVerdict.test.ts`
Expected: FAIL on the last case — the reason names a stepless job, not the cancellation.

- [ ] **Step 3: Read the run's own conclusion before its jobs**

In `lib/loop/ciVerdict.ts`, immediately after the `run.conclusion === "success"` check:

```typescript
  // A cancelled run says nothing about the diff — ci.yml's concurrency group cancels an
  // in-progress pull-request run on every new push. Asked through the jobs instead, the jobs that
  // never started carry conclusion null with zero steps and read as a stepless runner failure.
  if (run.conclusion === "cancelled") {
    return { pass: false, runId: run.databaseId, infrastructure: true, reason: "the run was cancelled" };
  }
```

and add `j.conclusion !== null` to the `stepless` filter.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/ciVerdict.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Warn when `main` itself is red**

`main` went red on a cross-test race and nothing noticed: `runListArgs` filters by `--branch`, so `main` is never read. A ticket cut from a red tree inherits the failure and the session spends a round on it. In `scripts/queue-pre.mjs`, add a fourth step that **warns and does not block**:

```js
/** A red `main` is not a reason to refuse a ticket, and it is a reason to say so before one starts. */
function mainHealth(run = spawnSync) {
  const { stdout, status } = run("gh", ["run", "list", "--branch", "main", "--limit", "1", "--json", "conclusion,headSha,url"], {
    encoding: "utf8",
  });
  if (status !== 0) return;
  const [last] = JSON.parse(stdout || "[]");
  if (last && last.conclusion && last.conclusion !== "success") {
    console.error(`queue-pre: main's last run was ${last.conclusion} at ${last.headSha?.slice(0, 8)} — ${last.url}`);
    console.error("  A ticket cut from here inherits it. Read the run before blaming the diff.");
  }
}
```

Call it after the three existing steps, inside a `try {} catch {}` so an unreachable tracker never blocks a ticket.

- [ ] **Step 6: Commit**

```bash
npm run typecheck
node --test --test-timeout=30000 --test-force-exit tests/ciVerdict.test.ts tests/queuePre.test.ts
git add -- lib/loop/ciVerdict.ts tests/ciVerdict.test.ts scripts/queue-pre.mjs
git commit -m "fix(ci-verdict): read the run's own conclusion, and say when main is red

ciVerdict had no test file. A cancelled run's unstarted jobs carry conclusion null with
zero steps, which fell into the stepless filter — the right answer by the wrong route, on
a path ci.yml's concurrency group exercises on every push.

main went red on a cross-test race and nothing noticed: the verdict is filtered by branch,
so main is never read, and the next ticket cut from it inherits the failure."
```

---

## Task 15: Rewrite `comment-budget` to read files instead of a diff

Defect J1, J2. 54 original lines have absorbed +103/−52 across seven follow-ups, and every one of the seven is a diff-format bug. "Is line N of file F a comment" is a lexical property of the **file**; a unified diff is a lossy window over pairs of files, rendered through the caller's git configuration.

**Files:**
- Rewrite: `scripts/comment-budget.mjs` (102 → ≈45 lines)
- Rewrite: `tests/commentBudget.test.ts` (120 → ≈50 lines)
- Modify: `scripts/check-steps.mjs:10`

**Interfaces:**
- Consumes: nothing.
- Produces: `countComments(text: string): {comment: number, code: number}` and `budget(base: string, head?: string): [string, {comment: number, code: number}][]`. **`budget` no longer takes a diff string** — every caller and test changes.

- [ ] **Step 1: Write the failing test**

Replace `tests/commentBudget.test.ts` entirely:

```typescript
// tests/commentBudget.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { countComments } from "../scripts/comment-budget.mjs";

const count = (...lines: string[]) => countComments(lines.join("\n"));

describe("countComments", () => {
  test("a line comment is a comment", () => {
    assert.deepEqual(count("// why", "const a = 1;"), { comment: 1, code: 1 });
  });

  test("a block comment's body is prose whatever its lines start with", () => {
    assert.deepEqual(count("/*", "  why, with no asterisk", "*/", "const a = 1;"), { comment: 3, code: 1 });
  });

  test("a jsdoc block counts every line of itself", () => {
    assert.deepEqual(count("/**", " * why", " */", "export function f() {}"), { comment: 3, code: 1 });
  });

  test("a one-line block comment is one comment", () => {
    assert.deepEqual(count("/* why */ const a = 1;"), { comment: 1, code: 0 });
  });

  test("code after a block closes on the same line is still code", () => {
    assert.deepEqual(count("/*", "why", "*/ const a = 1;"), { comment: 3, code: 0 });
  });

  test("blank lines count as neither", () => {
    assert.deepEqual(count("const a = 1;", "", "   ", "const b = 2;"), { comment: 0, code: 2 });
  });

  test("a comment marker inside a string is not a comment", () => {
    assert.deepEqual(count('const url = "https://example.com";'), { comment: 0, code: 1 });
  });

  test("an empty file counts nothing", () => {
    assert.deepEqual(countComments(""), { comment: 0, code: 0 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/commentBudget.test.ts`
Expected: FAIL — `countComments is not exported`.

- [ ] **Step 3: Rewrite the script**

Replace `scripts/comment-budget.mjs` entirely:

```js
/**
 * CLAUDE.md: "A change adding more comment lines than code lines is explaining itself instead of
 * being clear." That rule was in context for every change this repo has ever seen, and it is broken
 * regularly — so it is a check rather than a sentence.
 *
 * Compares each changed file's comment and code counts before and after. Not a diff: "is this line
 * a comment" is a property of the file, and a unified diff is a lossy window over pairs of files
 * rendered through the caller's git configuration — `diff.external`, `color.ui`, `textconv`,
 * `diff.noprefix` and a `.gitattributes` `-diff` marker each change what arrives. Counting whole
 * files has none of that surface: `git show <rev>:<path>` and `readFileSync` both return bytes.
 * A comment that moved between two files nets to zero across the pair without being tracked.
 *
 * Usage: node scripts/comment-budget.mjs [base]   (default origin/main)
 *        exit 0 - within budget; exit 1 - names the files over it
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

export function countComments(text) {
  let comment = 0;
  let code = 0;
  let block = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (block) {
      comment += 1;
      if (line.includes("*/")) block = false;
      continue;
    }
    if (line.startsWith("//")) {
      comment += 1;
      continue;
    }
    if (line.startsWith("/*")) {
      comment += 1;
      block = !line.includes("*/", 2);
      continue;
    }
    code += 1;
  }
  return { comment, code };
}

const show = (rev, file) => {
  try {
    return git("show", `${rev}:${file}`);
  } catch {
    return ""; // added in this branch
  }
};

export function budget(base, head = "HEAD") {
  const files = git("diff", "--name-only", "--diff-filter=AMR", "-M", `${base}...${head}`,
    "--", "*.mjs", "*.js", "*.ts", "*.tsx").split("\n").filter(Boolean);
  const over = [];
  for (const file of files) {
    const before = countComments(show(base, file));
    let after;
    try {
      after = countComments(readFileSync(file, "utf8"));
    } catch {
      continue; // deleted or renamed away; nothing was written
    }
    const n = { comment: after.comment - before.comment, code: after.code - before.code };
    // A handful of comments on a small change is not a ratio worth policing; the rule is about a
    // change that is mostly prose.
    if (n.comment > 6 && n.comment > n.code) over.push([file, n]);
  }
  return over;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const over = budget(process.argv[2] ?? "origin/main");
  for (const [file, n] of over) {
    console.error(`comment-budget: ${file} adds ${n.comment} comment lines to ${n.code} of code`);
  }
  if (over.length) {
    console.error("CLAUDE.md: a change adding more comment lines than code is explaining itself.");
    process.exit(1);
  }
  console.log("comment-budget: within budget");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/commentBudget.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the check against this very branch**

```bash
node scripts/comment-budget.mjs origin/main
```

Expected: `comment-budget: within budget`, or a named file. If it names one of *your* files, that is the check working — fix the file, do not weaken the check.

- [ ] **Step 6: Move it onto CI**

It is wired `where: "local"` in `scripts/check-steps.mjs:10`, so it runs only inside `npm run agent:check`, in whatever tree that happens to be — never in `ci.yml`. It gates nothing. Change its entry to run in the `verify` job the way the other non-delegated checks do; read `scripts/check-steps.mjs` and `.github/workflows/ci.yml`'s verify job together and follow whatever pattern the neighbouring checks use.

- [ ] **Step 7: Commit**

```bash
npm run typecheck
npm run lint
git add -- scripts/comment-budget.mjs tests/commentBudget.test.ts scripts/check-steps.mjs .github/workflows/ci.yml
git commit -m "refactor(comment-budget): count files, not diff hunks

Seven follow-up fixes in thirty hours and every one was a diff-format bug: a moved comment,
which header names the file, block state across a hunk window, and five ways the machine's
own git config changes what a diff is. The property being measured is lexical and belongs
to the file; a unified diff is a lossy window over pairs of files.

git show and readFileSync both return bytes, so diff.external, color.ui, textconv,
diff.noprefix and a -diff attribute cannot reach it. A comment moved between two files nets
to zero across the pair with nothing tracking it.

It also ran only inside agent:check, in whatever tree that was, so it gated nothing."
```

---

## Task 16: Make every failure path survivable

Defects D3, D4, H4, H9, H10. `main()` has no try/catch and eleven unguarded `execFileSync` calls; `park()` is the worst, because it is the failure path and five of its steps can throw.

**Files:**
- Modify: `scripts/queue-loop.mjs` — `park()`, `runOnce`'s call sites
- Modify: `tests/queueLoop.test.ts`

**Interfaces:**
- Consumes: `runOnce` from Task 7.
- Produces: `park(number, ctx)` never throws; it returns `{ok: boolean, failed: string[]}`.

- [ ] **Step 1: Write the failing tests**

```typescript
  test("park does not throw when the commit has nothing to stage", () => {
    const out = park(42, {
      phase: "C", why: "x", log: "l", cwd: ".worktrees/agent-42", branch: "agent/42-x", dirty: true,
      run: (file: string, args: string[]) => {
        if (args.includes("commit")) throw new Error("nothing to commit, working tree clean");
        return "";
      },
      write: () => {},
    });
    assert.equal(out.ok, false);
    assert.deepEqual(out.failed, ["commit"]);
  });

  test("park still takes the label off when the comment fails", () => {
    const calls: string[][] = [];
    park(42, {
      phase: "C", why: "x", log: "l", cwd: null, branch: "agent/42-x", dirty: false,
      run: (file: string, args: string[]) => {
        calls.push([file, ...args]);
        if (args.includes("comment")) throw new Error("gh: rate limited");
        return "";
      },
      write: () => {},
    });
    assert.ok(calls.some((c) => c[2] === "edit"), "the label edit happened");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: FAIL — both throw out of `park`.

- [ ] **Step 3: Make each step of `park` independent**

```js
export function park(number, { phase, why, log, cwd, branch, dirty, run = sh, write = writeFileSync }) {
  const failed = [];
  // Each step reports rather than throwing. park is the failure path: reached from the stop-file
  // drain as well as from a bad session, so a throw here turned an orderly stop into an unhandled
  // rejection and lost whatever the run still held.
  const step = (name, fn) => {
    try {
      fn();
    } catch (err) {
      failed.push(name);
      console.error(`  ⚠️ park #${number}: ${name} failed — ${String(err.message).split("\n")[0]}`);
    }
  };

  if (dirty && cwd) {
    // Re-read rather than trusting the caller's flag: it comes from a derive() up to twenty
    // seconds old, and a session that committed in that window leaves nothing to stage — which
    // makes `git commit` exit 1.
    step("commit", () => {
      run("git", ["-C", cwd, "add", "-A", "--", "."]);
      if (run("git", ["-C", cwd, "status", "--porcelain"]).trim()) {
        run("git", ["-C", cwd, "commit", "-m", `wip(#${number}): parked in phase ${phase}`]);
      }
    });
  }

  step("label", () =>
    run("gh", ["issue", "edit", String(number),
      "--remove-label", "in-progress",
      "--remove-label", "ready-for-agent",
      "--add-label", "ready-for-human"]),
  );

  const body = [
    `Parked by the queue loop in **phase ${phase}**.`,
    "",
    `- reason: ${why}`,
    `- branch: \`${branch ?? "none"}\`${dirty ? " (uncommitted work was committed before teardown)" : ""}`,
    `- log: \`${log}\``,
    "",
    "The branch keeps its commits. Nothing was discarded.",
  ].join("\n");
  const file = path.join(LOG_DIR, `park-${number}.md`);
  step("comment", () => {
    write(file, body, "utf8");
    run("gh", ["issue", "comment", String(number), "--body-file", file]);
  });

  if (cwd) step("worktree", () => run("npm", ["run", "worktrees:remove", "--", cwd]));

  return { ok: failed.length === 0, failed };
}
```

Note the `git status --porcelain` re-read before the commit — defect D4. The `dirty` flag stays in the signature because the message text uses it, but the commit no longer trusts it.

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test --test-timeout=30000 --test-force-exit tests/queueLoop.test.ts`
Expected: PASS.

- [ ] **Step 5: Wrap the iteration**

In `main()`, wrap the `runOnce` call so one bad iteration does not end the night:

```js
    let pass;
    try {
      pass = await runOnce(realIo(totals));
    } catch (err) {
      console.error(`queue-loop: the iteration threw — ${String(err?.stack ?? err)}`);
      failures += 1;
      if (shouldHalt(failures)) {
        console.error(`queue-loop: ${failures} tickets in a row did not land — stopping`);
        return 1;
      }
      continue;
    }
```

- [ ] **Step 6: Run preflight after the session as a diagnostic**

Defect H9 — `preflight` runs before the session and never after, so a session that dirties the shared checkout kills the run on the *next* ticket and the culprit is unidentifiable. In `runOnce`, after `io.spawn(route)` returns, add a non-blocking check:

```js
  const dirtied = io.sharedCheckoutDirty();
  if (dirtied) {
    io.log(`queue-loop: #${route.number}'s session left the shared checkout dirty:\n${dirtied}`);
  }
```

Bind `sharedCheckoutDirty` to `() => git("status", "--porcelain").trim()`. **Warn, never block** — blocking here would strand a pushed pull request.

- [ ] **Step 7: Run the full suite and commit**

```bash
npm test 2>&1 | tail -20
npm run typecheck
npm run lint
git add -- scripts/queue-loop.mjs tests/queueLoop.test.ts
git commit -m "fix(loop): one failing step must not end the night

main() had no try/catch and eleven unguarded execFileSync calls. park() is the worst of
them because it is the failure path — reached from the stop-file drain as well as from a
bad session — and five of its steps could throw. A park that cannot comment ended the run
after the label was already off.

The empty-commit throw specifically: dirty came from a derive() up to twenty seconds old,
so a session that committed in that window left git add -A nothing to stage and git commit
exited 1. Re-read instead of trusting the flag.

And a session that dirties the shared checkout is now named when it happens, rather than
killing the next ticket anonymously."
```

---

## Task 17: Write down what changed

**Files:**
- Modify: `docs/agents/loops.md`
- Modify: `CLAUDE.md` (the `land.ts:19` / scope-job note, defect I4)
- Create: `docs/adr/0004-the-queue-loop-serialises-and-owns-the-merge.md`

**Interfaces:**
- Consumes: everything above.
- Produces: documentation. No code.

- [ ] **Step 1: Read what is there now**

```bash
sed -n '1,80p' docs/agents/loops.md
cat docs/adr/README.md
grep -n "scope job stops skipping" CLAUDE.md lib/loop/land.ts
```

- [ ] **Step 2: Correct the stale scope-job claim**

Defect I4: the note says "`ci.yml`'s scope job stops skipping the main push". The skip exists and fires; what stopped it was a `main` that moved, which Task 4 fixed. Rewrite the sentence in both `CLAUDE.md` and `lib/loop/land.ts:19` to say what it actually depends on, or delete it if Task 4 made it false. **Read the current text first and decide** — do not paste a replacement blind.

- [ ] **Step 3: Write the ADR**

Follow the shape of `docs/adr/0002-*.md`. The decision: the loop serialises tickets and the supervisor owns the merge. The forces, each one a measured fact from the spec: `gh pr merge` treats `UNSTABLE` (which includes queued) as immediately mergeable; `--auto` is evaluated client-side and skipped for an immediately-mergeable pull request; GitHub Merge Queue needs an organization-owned repository and this one is user-owned; overlapping cost about 22% wall clock and bought an in-memory pending pull request that nothing recovered. Link the research doc.

- [ ] **Step 4: Update `docs/agents/loops.md`**

It is the "which check catches what, what each costs" document. Add what this plan changed: the phase board is gone and the session reports its own phase; the session removes its own worktree; a rate-limit refusal exits rather than holding; `comment-budget` reads files and runs on CI. Keep it to what an agent needs to know, not a history of the change.

- [ ] **Step 5: Run the single-source test and commit**

```bash
node --test --test-timeout=30000 --test-force-exit tests/rulesAreSingleSourced.test.ts
git add -- docs/ CLAUDE.md lib/loop/land.ts
git commit -m "docs(loop): record the serialise-and-own-the-merge decision"
```

- [ ] **Step 6: Open the pull request**

```bash
git push -u origin <branch>
cat > /tmp/pr.md <<'EOF'
Re-architects the queue loop against
`docs/research/2026-09-12-queue-loop-rearchitecture.md` — 43 numbered defects, of which
five had cost real work in a single night: five false parks, one ticket reported as landed
that was never touched, and two sessions merging each other's pull requests.

The root cause was one fall-through: a merged pull request reports
`mergeStateStatus: UNKNOWN`, and `decideLanding` had no case for it.

The structural change is that the supervisor and the session no longer both decide which
ticket is live. The number is passed on the command line; the session owns its own worktree
teardown because it is the only process that knows whether its tree is dirty; tickets are
serialised, so there is no in-memory pending pull request to orphan.

Deleted: the phase board (it decided nothing and cost 560-1,280 subprocess spawns per
ticket), the merge slot, the five-hour rate-limit hold, and `loop-render.mjs`.

`lib/loop/land.ts` and `lib/loop/ciVerdict.ts` now have test files. `main()` does too.
EOF
gh pr create --base main --head <branch> --title "Re-architect the queue loop" --body-file /tmp/pr.md
```

---

## Task 18: Make the display worth watching

Requested by the owner after Task 11 made the phase signal trustworthy. Four additions, in
priority order: a live timer on the open phase, what it is doing right now, the queue draining
across the night, and a bell when it needs a person.

**Depends on Task 11** — the phase signal has to be real before anything is built on it. Do not
start this until Task 11's `PHASE` reader is committed.

**The standard for this task:** it is the one part of the loop a person looks at directly, so a
rendering bug is a bug the owner sees every night. Three specific traps, each of which has a step
below: a redraw interleaved with a `console.log` leaves half of each on screen; an un-cleared
interval keeps the node process alive after the run ends; and an in-place line longer than the
terminal wraps, after which a carriage return lands at the start of the *last visual row* and the
erase misses everything above it. None of these show up in a unit test that only checks the string.

**Files:**
- Modify: `scripts/loop-render.mjs` — add `SPIN`, `activeLine`, `toolDetail`, `queueLine`, `bell`
- Modify: `scripts/queue-loop.mjs` — add `ticker()`; route every console write through it
- Modify: `tests/loopRender.test.ts` (recreate it — Task 11 deleted it)
- Create: `tests/ticker.test.ts`

**Interfaces:**
- Consumes: `phaseLine`, `elapsed`, `fit`, `PHASES` from `loop-render.mjs`; the `{kind: "phase"}`
  and `{kind: "tool"}` facts from `loop-stream.mjs` (Task 11).
- Produces:
  - `activeLine({letter: string, detail?: string, ms: number, frame?: number}): string`
  - `toolDetail({name: string, command?: string, parent?: string|null}): string`
  - `queueLine(before: Queue, after: Queue): string` where `Queue` is
    `{implement: number, triage: number, wayfinder: number}`
  - `bell(stream?: NodeJS.WriteStream): void`
  - `ticker(out?: NodeJS.WriteStream)` returning
    `{say(line: string): void, start(letter: string): void, detail(text: string): void,
      close(mark?: string): void, stop(): void}`

### 1 — A live timer on the open phase

- [ ] **Step 1: Write the failing test**

Recreate `tests/loopRender.test.ts` (Task 11 deleted it; these are pure functions and belong back):

```typescript
// tests/loopRender.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { activeLine, phaseLine, toolDetail, queueLine, bell, SPIN } from "../scripts/loop-render.mjs";

describe("activeLine", () => {
  test("names the phase, its number and how long it has been open", () => {
    const line = activeLine({ letter: "C", ms: 252_000 });
    assert.match(line, /\[3\/6\] C/);
    assert.match(line, /build/);
    assert.match(line, /4:12\s*$/);
  });

  test("the spinner advances with the frame", () => {
    const a = activeLine({ letter: "C", ms: 0, frame: 0 });
    const b = activeLine({ letter: "C", ms: 0, frame: 1 });
    assert.notEqual(a.trim()[0], b.trim()[0]);
  });

  test("the frame wraps rather than running off the end of the spinner", () => {
    assert.equal(activeLine({ letter: "C", ms: 0, frame: SPIN.length }).trim()[0], SPIN[0]);
    assert.equal(activeLine({ letter: "C", ms: 0, frame: SPIN.length * 3 + 2 }).trim()[0], SPIN[2]);
  });

  // Every line this module emits is the same width, and the timer is what is redrawn in place: a
  // line that changes width leaves the tail of the longer one on screen after the shorter one.
  test("the width does not move as the detail grows", () => {
    const short = activeLine({ letter: "C", ms: 0, detail: "git status" });
    const long = activeLine({ letter: "C", ms: 0, detail: "x".repeat(200) });
    assert.equal(short.length, long.length);
  });

  test("it lines up with the finished line that replaces it", () => {
    assert.equal(activeLine({ letter: "C", ms: 0 }).length, phaseLine({ letter: "C", ms: 0 }).length);
  });

  test("an unknown letter does not render a negative index", () => {
    assert.doesNotMatch(activeLine({ letter: "Z", ms: 0 }), /\[0\/6\]/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopRender.test.ts`
Expected: FAIL — `activeLine is not exported`.

- [ ] **Step 3: Add `activeLine` and `SPIN`**

In `scripts/loop-render.mjs`, after `phaseLine`:

```js
/** Braille, because every frame is one column wide in every terminal font. */
export const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * The open phase, redrawn in place while it runs. `phaseLine` is the same line once it is done, and
 * the two are the same width so the finished one covers the live one exactly.
 *
 * Pure, like the rest of this module: the terminal handling is `ticker` in queue-loop.mjs, which is
 * the only thing in the loop that knows a cursor exists.
 */
export function activeLine({ letter, detail = "", ms, frame = 0 }) {
  const i = PHASES.findIndex(([l]) => l === letter);
  const name = PHASES[i]?.[1] ?? "";
  const n = i < 0 ? "?" : String(i + 1);
  return fit(`  ${SPIN[frame % SPIN.length]} [${n}/6] ${letter}  ${name.padEnd(9)}${detail}`, `${elapsed(ms)} `);
}
```

Write `SPIN` with the escapes shown, not by pasting braille glyphs — this repo's shell is PowerShell
5.1 on a non-UTF-8 codepage and a pasted glyph can arrive mojibaked.

`fit` already truncates an over-long left side to the fixed `WIDTH`, which is what makes the width
test pass — check that it does before relying on it, and if it does not, that is the bug to fix
rather than to work around.

Also give `phaseLine` the same `i < 0` guard, so a stray letter cannot render `[0/6]` there either.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopRender.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing ticker test**

Create `tests/ticker.test.ts`. This is where the three traps get pinned:

```typescript
// tests/ticker.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ticker } from "../scripts/queue-loop.mjs";

const ESC = "";
const BEL = "";

const fake = (isTTY = true, columns: number | undefined = 80) => {
  const wrote: string[] = [];
  return { isTTY, columns, write: (s: string) => { wrote.push(s); return true; }, wrote };
};
const all = (out: { wrote: string[] }) => out.wrote.join("");

describe("ticker", () => {
  test("a phase opens with a line and closes with the finished one", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    assert.match(all(out), /\[3\/6\] C/);
    tick.close();
    assert.match(all(out), /✓ \[3\/6\] C/);
  });

  // The trap: a console.log landing between two redraws leaves the tail of the spinner line in
  // front of it. Everything the loop prints goes through say(), which erases first.
  test("a line printed while a phase is open is not written into the spinner line", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.say("  something happened");
    const text = all(out);
    const at = text.indexOf("something happened");
    assert.ok(at > 0);
    // The erase has to be the thing immediately before it.
    assert.ok(text.slice(0, at).endsWith(`${ESC}[2K`), "say() must erase the live line first");
  });

  test("the message keeps its own line and the spinner comes back under it", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.say("hello");
    assert.match(all(out).split("hello\n")[1] ?? "", /\[3\/6\] C/);
  });

  // The trap: an interval that outlives the run holds the event loop open and the loop never exits.
  test("closing a phase stops the redraw", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.close();
    const after = out.wrote.length;
    t.mock.timers.tick(5_000);
    assert.equal(out.wrote.length, after, "a closed phase must not still be drawing");
  });

  test("stop() stops the redraw from an open phase too", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.stop();
    const after = out.wrote.length;
    t.mock.timers.tick(5_000);
    assert.equal(out.wrote.length, after);
  });

  test("starting a phase closes the one before it, and leaves one timer running", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.start("D");
    assert.match(all(out), /✓ \[3\/6\] C/);
    out.wrote.length = 0;
    t.mock.timers.tick(1_200);
    const draws = all(out).split("[4/6] D").length - 1;
    assert.ok(draws >= 8 && draws <= 12, `expected one timer's worth of redraws, saw ${draws}`);
  });

  test("close on nothing open writes nothing", () => {
    const out = fake();
    ticker(out as never).close();
    assert.equal(out.wrote.length, 0);
  });

  // The trap: piped to a file or a CI log, cursor control is line noise. It is also the shape the
  // whole module was built around - right in a terminal, in a pipe, and in a file.
  test("not a terminal means no cursor control at all", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake(false);
    const tick = ticker(out as never);
    tick.start("C");
    tick.detail("git push");
    t.mock.timers.tick(5_000);
    tick.say("hello");
    tick.close();
    const text = all(out);
    assert.ok(!text.includes(ESC), "no escape sequences outside a terminal");
    assert.ok(!text.includes("\r"), "no carriage returns outside a terminal");
    assert.match(text, /hello\n/);
    assert.match(text, /✓ \[3\/6\] C/);
  });

  // The trap: a line wider than the terminal wraps, and a carriage return then lands at the start
  // of the last visual row - the erase misses every row above it and the screen fills with
  // spinner fragments.
  test("the live line never exceeds the terminal's width", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake(true, 40);
    const tick = ticker(out as never);
    tick.start("C");
    tick.detail("x".repeat(200));
    for (const chunk of out.wrote) {
      for (const line of chunk.split("\n")) {
        const visible = line.split(ESC).join("").replace(/\[2K/g, "").replace(/\r/g, "");
        assert.ok([...visible].length < 40, `wrote ${[...visible].length} columns into a 40-column terminal`);
      }
    }
  });

  test("a terminal that reports no width is assumed to be 80", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake(true, undefined);
    ticker(out as never).start("C");
    assert.ok(out.wrote.length > 0);
  });

  test("BEL is never part of a phase line", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.close();
    assert.ok(!all(out).includes(BEL));
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/ticker.test.ts`
Expected: FAIL — `ticker is not exported`.

- [ ] **Step 7: Write `ticker`**

In `scripts/queue-loop.mjs`:

```js
const ERASE = "\r[2K";

/**
 * The only thing in the loop that knows a cursor exists.
 *
 * Everything the run prints goes through `say`, which erases the open phase's line before writing
 * and redraws it after — a `console.log` landing between two redraws otherwise leaves the tail of
 * the spinner in front of it, and that is the failure mode a person actually sees.
 *
 * At anything that is not a terminal — a pipe, a file, CI — every escape is suppressed and the
 * output is the append-only stream `loop-render.mjs` was built to produce.
 */
export function ticker(out = process.stdout) {
  const live = Boolean(out.isTTY);
  let open = null;
  let frame = 0;
  let timer = null;
  let drawn = false;

  // The escape clears the whole row whatever is on it. Counting the characters back instead is
  // wrong for anything double-width, and a command in the detail can carry one.
  const erase = () => {
    if (!drawn) return;
    out.write(ERASE);
    drawn = false;
  };

  const draw = () => {
    if (!live || !open) return;
    erase();
    const line = activeLine({ ...open, ms: Date.now() - open.startedAt, frame: frame++ });
    // A line wider than the terminal wraps, after which a carriage return lands at the start of the
    // last visual row and the erase above misses every row over it.
    const room = Math.max(20, (out.columns ?? 80) - 1);
    const chars = [...line];
    out.write(chars.length > room ? chars.slice(0, room).join("") : line);
    drawn = true;
  };

  const api = {
    say(line) {
      erase();
      out.write(`${line}\n`);
      draw();
    },
    start(letter) {
      api.close();
      open = { letter, detail: "", startedAt: Date.now() };
      frame = 0;
      if (!live) return;
      timer = setInterval(draw, 120);
      // A redraw must never be the reason the process is still alive.
      timer.unref?.();
      draw();
    },
    detail(text) {
      if (!open) return;
      open.detail = text;
      draw();
    },
    close(mark = "✓") {
      if (!open) return;
      const done = phaseLine({ letter: open.letter, ms: Date.now() - open.startedAt, mark });
      if (timer) clearInterval(timer);
      timer = null;
      erase();
      open = null;
      out.write(`${done}\n`);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      erase();
      open = null;
    },
  };
  return api;
}
```

`api.close()` rather than `this.close()`: the object is passed around and destructured, and `this`
does not survive that.

- [ ] **Step 8: Run it to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/ticker.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 9: Wire it into the run, and leave no spinner behind on exit**

Build one `ticker` in `main()` and pass it down. In `runTicket`'s stdout handler, replace Task 11's
`log(phaseLine(...))` with `tick.start(fact.letter)`, and close the last open phase when the child
exits.

Every `console.log` in the loop becomes `tick.say(...)`. Find the ones you miss:

```bash
grep -n "console\.log" scripts/queue-loop.mjs
```

A `console.log` left behind is not a crash — it is one corrupted line, occasionally, which is
exactly the kind of thing that survives review. Convert all of them.

Then, so an interrupted run does not leave a half-drawn spinner under the shell prompt:

```js
  process.on("exit", () => tick.stop());
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      tick.stop();
      process.exit(130);
    });
  }
```

- [ ] **Step 10: Watch it with your own eyes**

Unit tests cannot see a corrupted terminal. Run the real thing for ninety seconds:

```bash
node scripts/queue-loop.mjs
```

Confirm: the spinner turns; the timer counts; a printed line lands *above* the spinner with nothing
of the spinner in it; the finished line covers the live one exactly; Ctrl-C leaves a clean prompt
with no fragment. Then confirm the pipe is still plain text:

```bash
node scripts/queue-loop.mjs 2>/dev/null | head -40 | cat -v | grep -c "\^\[" || echo "no escapes in a pipe"
```

Expected: `no escapes in a pipe`. **If either check is wrong the task is not done** — say what you
saw rather than committing on green units.

- [ ] **Step 11: Commit**

```bash
npm run typecheck
git add -- scripts/loop-render.mjs scripts/queue-loop.mjs tests/loopRender.test.ts tests/ticker.test.ts
git commit -m "feat(loop): a live timer on the open phase

A phase line only appeared once the phase ended, so a 22-minute build phase was 22 minutes
of nothing on screen and no way to tell a working session from a stuck one.

Every write goes through ticker.say, which erases the live line first: a console.log
landing between two redraws leaves the tail of the spinner in front of it. The redraw
interval is unref'd and cleared on close, on stop and on a signal, because an interval that
outlives the run holds the event loop open. The line is clipped to the terminal's width,
because a wrapped line puts the carriage return at the start of the last visual row and the
erase then misses every row above it.

Not a terminal: no escapes at all, and the append-only output loop-render.mjs was built for."
```

### 2 — Say what it is doing

- [ ] **Step 1: Write the failing test**

In `tests/loopRender.test.ts`:

```typescript
describe("toolDetail", () => {
  test("a shell call shows the command", () => {
    assert.equal(toolDetail({ name: "Bash", command: "git push -u origin agent/42-x" }), "git push -u origin agent/42-x");
  });

  test("a non-shell tool shows its name", () => {
    assert.equal(toolDetail({ name: "Read", command: "" }), "Read");
  });

  test("only the first line of a multi-line command", () => {
    assert.equal(toolDetail({ name: "Bash", command: "gh issue comment 42 \\\n  --body-file b.md" }), "gh issue comment 42 \\");
  });

  test("a long command is truncated, not wrapped", () => {
    const d = toolDetail({ name: "Bash", command: `git ${"x".repeat(200)}` });
    assert.ok(d.length <= 44, `${d.length} chars`);
    assert.match(d, /…$/);
  });

  // A review subagent's calls are the only sign of life during phase D, which is the longest phase
  // and the one that looked like a hang.
  test("a subagent's call is shown, and marked as one", () => {
    assert.match(toolDetail({ name: "Bash", command: "git diff", parent: "toolu_1" }), /^· /);
  });

  test("a marked call is truncated to the same width as an unmarked one", () => {
    const d = toolDetail({ name: "Bash", command: "y".repeat(200), parent: "toolu_1" });
    assert.ok(d.length <= 44, `${d.length} chars`);
  });

  test("a command that is only whitespace falls back to the tool's name", () => {
    assert.equal(toolDetail({ name: "Bash", command: "   \n  " }), "Bash");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopRender.test.ts`
Expected: FAIL — `toolDetail is not exported`.

- [ ] **Step 3: Add `toolDetail`**

In `scripts/loop-render.mjs`:

```js
const DETAIL = 44;

/** What the session is doing, as one short phrase. A middot marks a review subagent's call. */
export function toolDetail({ name, command = "", parent = null }) {
  const mark = parent ? "· " : "";
  if (name !== "Bash" && name !== "PowerShell") return `${mark}${name}`;
  const first = command.split("\n")[0].trim();
  if (!first) return `${mark}${name}`;
  const room = DETAIL - mark.length;
  return mark + (first.length > room ? `${first.slice(0, room - 1)}…` : first);
}
```

`DETAIL` is 44 because `activeLine`'s fixed prefix is 23 columns and its right-hand elapsed is 7,
inside a `WIDTH` of 78. If you change `WIDTH`, this has to move with it — part 1's width test is
what catches that.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopRender.test.ts`
Expected: PASS.

- [ ] **Step 5: Feed it from the stream**

Task 11 deleted the `fact.kind === "tool"` loop. This puts one line of it back, in `runTicket`'s
stdout handler:

```js
    if (fact.kind === "tool" && fact.calls.length) tick.detail(toolDetail(fact.calls.at(-1)));
```

Confirm `loop-stream.mjs` still returns `{kind: "tool", calls: [{name, command, parent}]}` — if
Task 11 dropped `parent`, put it back; it is what separates a review subagent's work from the
session's own.

**Nothing else may come back with it.** The deleted `snapshot`, `advance`, `closePhase` and the
20-second `derive` are not needed for this, and removing them was the point of Task 11.

- [ ] **Step 6: Commit**

```bash
node --test --test-timeout=30000 --test-force-exit tests/loopRender.test.ts tests/loopStream.test.ts
npm run typecheck
git add -- scripts/loop-render.mjs scripts/queue-loop.mjs tests/loopRender.test.ts
git commit -m "feat(loop): show the command the session is running

Phase D is the longest phase and its work happens entirely inside two review subagents, so
it read as a hang. A subagent's call is marked, because that is the part that was invisible.

The tool fact was already parsed and thrown away; this is one line of what Task 11 deleted,
and none of the rest of it."
```

### 3 — The queue draining

- [ ] **Step 1: Write the failing test**

In `tests/loopRender.test.ts`:

```typescript
describe("queueLine", () => {
  const q = (implement: number, triage = 0, wayfinder = 0) => ({ implement, triage, wayfinder });

  test("a bucket that moved shows both numbers", () => {
    assert.match(queueLine(q(11), q(10)), /11→10 implement/);
  });

  test("a bucket that did not move shows one", () => {
    const line = queueLine(q(11, 3), q(10, 3));
    assert.match(line, /3 triage/);
    assert.doesNotMatch(line, /3→3/);
  });

  // The frontier grew because the ticket filed follow-ups. That is the number worth seeing, and the
  // arrow is the only thing that shows it.
  test("a bucket that grew reads as growth", () => {
    assert.match(queueLine(q(10), q(12)), /10→12 implement/);
  });

  test("an empty queue says so rather than printing three zeroes", () => {
    assert.match(queueLine(q(1), q(0, 0, 0)), /empty/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopRender.test.ts`
Expected: FAIL — `queueLine is not exported`.

- [ ] **Step 3: Add `queueLine`**

In `scripts/loop-render.mjs`:

```js
/**
 * The queue after a ticket, against the queue before it. The header carries the depth already; what
 * it cannot show is the direction, and across an unattended night the direction is the whole story
 * — a frontier that grows every ticket is the loop filing follow-ups faster than it lands them.
 */
export function queueLine(before, after) {
  if (!after.implement && !after.triage && !after.wayfinder) return "     queue empty";
  const moved = (k) => (before[k] === after[k] ? String(after[k]) : `${before[k]}→${after[k]}`);
  return `     queue ${moved("implement")} implement · ${moved("triage")} triage · ${moved("wayfinder")} wayfinder`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopRender.test.ts`
Expected: PASS.

- [ ] **Step 5: Print it after each ticket**

`runOnce` already has the route's `queue` from the picker. Keep that as `before`, and take `after`
from the **next iteration's pick**, which is already being made — print the line at the top of the
next iteration rather than adding a reading of your own.

Do not add a `gh` call for this. If the structure makes that awkward, say so and leave the line out
rather than paying for it.

- [ ] **Step 6: Commit**

```bash
node --test --test-timeout=30000 --test-force-exit tests/loopRender.test.ts
npm run typecheck
git add -- scripts/loop-render.mjs scripts/queue-loop.mjs tests/loopRender.test.ts
git commit -m "feat(loop): show the queue moving after each ticket

The header carries the depth but not the direction, and the direction is what a night is
made of: a frontier that grows every ticket is the loop filing follow-ups faster than it
lands them, which is what happened on 2026-09-11 and took a hand count to notice.

No new gh call - the reading is the one the next pick already makes."
```

### 4 — A bell when it needs a person

- [ ] **Step 1: Write the failing test**

In `tests/loopRender.test.ts`:

```typescript
describe("bell", () => {
  test("it rings at a terminal", () => {
    const wrote: string[] = [];
    bell({ isTTY: true, write: (s: string) => wrote.push(s) } as never);
    assert.deepEqual(wrote, [""]);
  });

  // Piped to a file or a CI log a bell is a stray byte, and the loop's output is read that way more
  // often than it is watched.
  test("it is silent anywhere else", () => {
    const wrote: string[] = [];
    bell({ isTTY: false, write: (s: string) => wrote.push(s) } as never);
    assert.deepEqual(wrote, []);
  });

  test("a stream that cannot be written to does not take the run down with it", () => {
    assert.doesNotThrow(() => bell({ isTTY: true, write: () => { throw new Error("EPIPE"); } } as never));
  });

  test("no stream at all is silent, not a crash", () => {
    assert.doesNotThrow(() => bell(null as never));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopRender.test.ts`
Expected: FAIL — `bell is not exported`.

- [ ] **Step 3: Add `bell`**

In `scripts/loop-render.mjs`:

```js
/**
 * Rings once, and only at a terminal a person could be sitting at. Wrapped because a run must never
 * end on a closed pipe, and it goes to stderr so a piped stdout stays clean.
 */
export function bell(stream = process.stderr) {
  if (!stream?.isTTY) return;
  try {
    stream.write("");
  } catch {
    /* a bell is never worth an exception */
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-timeout=30000 --test-force-exit tests/loopRender.test.ts`
Expected: PASS.

- [ ] **Step 5: Ring it where a person is needed, and nowhere else**

Three places, and only these three — a bell on every ticket is a bell nobody hears:

- a park (Task 5's `runOnce` park branch) — it is now only ever a real decision for the owner
- the breaker halting the run (`shouldHalt`)
- the loop draining and exiting, including a spent usage window (Task 9)

Not on a landed ticket, not on a retry, not on a settle failure.

- [ ] **Step 6: Verify the byte, then commit**

```bash
node -e "import('./scripts/loop-render.mjs').then(m => m.bell({isTTY: true, write: s => process.stdout.write(JSON.stringify(s))}))"
```

Expected: `""`. Then ring the real one — silence is also a valid outcome, since the terminal's
bell may be off:

```bash
node -e "import('./scripts/loop-render.mjs').then(m => m.bell(process.stderr))"
```

```bash
npm run typecheck
git add -- scripts/loop-render.mjs scripts/queue-loop.mjs tests/loopRender.test.ts
git commit -m "feat(loop): ring once when the run needs a person

A park, the breaker halting, and the loop draining. Not a landed ticket - a bell on every
ticket is a bell nobody hears. stderr and TTY only, so a piped log stays clean."
```

### Closing the task

- [ ] **Step 1: Run everything**

```bash
npm test 2>&1 | tail -20
npm run typecheck
npm run lint
```

Expected: PASS. `tests/loopRender.test.ts` should hold roughly 20 tests across the four parts.

- [ ] **Step 2: One real run, watched**

Nothing above proves the four pieces coexist. Run the loop for one whole ticket and confirm, in
order: the header; a spinner that turns and a timer that counts; the command changing under it; the
finished line covering the live one exactly, with no fragment left; the closing line; the queue
line; a bell if it parked. Then Ctrl-C and confirm the prompt is clean.

Report what you saw. **If any of it is wrong, say so rather than closing the task** — this is the
one part of the loop the owner looks at directly, and a rendering bug is one they see every night.

---

## Self-Review

**Spec coverage.** Every defect in the spec's §3 maps to a task: A1–A7 → Task 2; A8 → Task 14; B1–B7 → Task 6; C1–C5 → Tasks 7 and 8; C6 → Task 8; D1, D2, D5 → Task 5; D3, D4 → Task 16; E1 → Task 6; E2 → Task 3; E3, E4 → Task 7; F1, F2, F4, F6 → Task 12; F3 → Task 4; F5 → Task 6; G1, G2, G4 → Task 13; G3, G5, G7 → Task 11; G6 → Task 7; H1–H3 → Task 10; H4, H9, H10 → Task 16; H5–H8 → Task 9; I1, I3 → Task 4; I2 → Tasks 1 and 14; I4 → Task 17; J1, J2 → Task 15. The recovery checklist is Task 1. Task 18 is not from the spec — the owner asked for it after Task 11 made the phase signal trustworthy, and it depends on Task 11.

**Two deliberate omissions, both flagged here rather than hidden.** The spec's §5.4 note that `GET /pulls/{n}/merge` makes a mid-merge crash recoverable is not implemented: serialising (Task 7) removes the in-memory slot, so the only remaining window is a crash *inside* `settle()`, and Task 2's `already-merged` case handles the resume correctly without a new endpoint. And the spec's suggestion of a `loop-stalled` label is not implemented — Task 5 takes the lazier branch it names, which is not to park mechanically at all.

**Ordering.** Tasks 2, 3 and 4 are independent of everything else and fix the most damage for the smallest diff; run them first even if the rest is deferred. Tasks 6, 7, 8 must run in that order — Task 7's `runOnce` consumes Task 6's `outcomeOf`, and Task 8 assumes the session owns teardown. Task 11 must run after Task 7, which deletes half of what it touches.

**Type consistency.** `PrState` gains `state` in Task 2 and is used with that field in Task 14's tests. `LandAction`'s two new members (`already-merged`, `recheck`) are consumed by `afterPush` in the same task. `outcomeOf` (Task 6) is consumed by `runOnce` (Task 7) and by `reasonFor` (Tasks 7 and 13). `queueLoopArgs` gains its `number` parameter in Task 6 and its `size` parameter in Task 13 — Task 13's tests call the two-argument form and Task 6's call the one-argument form, which is why Task 6's test uses `queueLoopArgs(956)` and stays valid under the default. `budget()` changes signature in Task 15 and every caller is in that task.
