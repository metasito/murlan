# Jest test ids, shared-red removal, `on main:` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement #1181. `failingTestIds` stops reading jest's project name as a test id. Shared-red detection, which has never produced a true positive, is removed in full. The fix round is instead told which of its failures main's latest red CI run has too.

**Architecture:** The parser fix is one regex in `tools/loop/ciVerdict.ts`, pinned by a test that reads the project names from `jest.config.js`. `tools/loop/mainHealth.ts` gains `mainFailures()`, the failing ids of main's latest completed red run. `poll()` in `tools/loop/queue-loop.mjs` uses it in place of `sharedRed.ts` to write an `on main:` line into `CI-RED`. The blocking path (`blockedBy`, `blockOnShared`, `io.block`) goes: the loop runs one ticket at a time, and nothing ever closed a blocker.

**Tech Stack:** Node 24 ESM and TypeScript run by Node's own loader (`.ts` files are `require`d via `ts()` in `queue-loop.mjs`), `node:test`.

**Spec:** GitHub issue #1181 (`gh issue view 1181 --comments`). Its Definition of done is the acceptance list.

## Global Constraints

- Work only in `C:/Users/roton/murlan-1181`, branch `loop/1181-test-ids-and-main-reds`. Never touch `C:/Users/roton/murlan` (the live loop runs there) or anything under `.worktrees/`. The Bash tool's cwd resets after each call: use absolute paths or `git -C C:/Users/roton/murlan-1181`.
- Never run `npm test`, jest, Playwright or `npm run agent:check`. Locally only `node --test --test-force-exit <files>`, `npx tsc --noEmit -p .`, `npx eslint <files>`, `npm run check:comments`.
- Commit by pathspec (`git add -- <paths>`); never `gh pr merge`. Each commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Watch each new or changed test fail before making it pass.
- Comment budget (CLAUDE.md → Comments): default is no comment. Never history ("was", "used to", "removed"). `npm run check:comments` must end `within budget`.
- Edit TypeScript and JS source with the Edit/Write tools, never through a shell heredoc or `node -e` with string escapes: a template literal eats `\d`, `\n` and `\|` silently.
- A deletion is complete only when `git -C C:/Users/roton/murlan-1181 grep -n -E "sharedRed|sharedPlan|blockOnShared|blockedBy|SHARED_BUDGET|redCache|redCachePath|shared-red|shared red|claimShared|checkShared"` prints nothing outside `docs/superpowers/plans/` and `docs/research/`.
- Do not spawn subagents.

## File map

| File | Change |
|---|---|
| `tools/loop/ciVerdict.ts` | `JEST_FAILURE` skips a project-name token |
| `tools/loop/tests/ciVerdict.test.ts` | parser tests, project names read from `jest.config.js` |
| `tools/loop/mainHealth.ts` | add `mainFailures(gh, repo)` |
| `tools/loop/tests/mainHealth.test.ts` | tests for it (create the file if absent, or extend the existing one) |
| `tools/loop/queue-loop.mjs` | `poll` uses `mainFailures`; `ciRedBody` writes `on main:`; delete `sharedPlan`, `blockOnShared`, `SHARED_BUDGET_MS`, the `blockedBy` settle branch, `io.block`, the `sharedRed.ts` calls |
| `tools/loop/loop-logs.mjs` | delete the `redCache` artefact and `redCachePath` |
| delete `tools/loop/sharedRed.ts`, `tools/loop/tests/sharedRed.test.ts` | |
| `tools/loop/tests/settleReplay.test.ts`, `queueLoopMain.test.ts`, `loopLogs.test.ts` | drop shared cases, add `on main:` cases |
| `.claude/commands/queue.md` | drop phase A's shared paragraph and phase C's `shared:` paragraph; add `on main:` |

---

### Task 1: The jest parser reads the path, never the project name

**Files:** `tools/loop/ciVerdict.ts:176`, `tools/loop/tests/ciVerdict.test.ts` (near the existing `"a jest failure names its file"` test, ~line 295)

- [ ] **Step 1: Failing tests.** Add beside the existing jest test:

```ts
import { createRequire } from "node:module";

const jestProjects: string[] = createRequire(import.meta.url)("../../../jest.config.js").projects.map(
  (p: { displayName: string }) => p.displayName,
);

test("a jest failure behind a project name names its file, never the project", () => {
  const log = [
    "FAIL android tests/native/musicPlatform.test.tsx",
    "FAIL ios tests/native/musicPlatform.test.tsx",
    "FAIL tests/native/musicPlatform.test.tsx",
  ].join("\n");
  assert.deepEqual(failingTestIds(log), ["tests/native/musicPlatform.test.tsx"]);
});

test("no jest project name in jest.config.js is ever a test id", () => {
  assert.ok(jestProjects.length > 0, "jest.config.js declares no projects: this test no longer checks anything");
  for (const name of jestProjects) {
    const ids = failingTestIds(`FAIL ${name} tests/native/x.test.tsx\nFAIL ${name} tests/native/y.test.tsx (5.2 s)`);
    assert.deepEqual(ids, ["tests/native/x.test.tsx", "tests/native/y.test.tsx"], name);
  }
});
```

If `jest.config.js` cannot be `require`d from the test (it reads `__dirname`, so a CommonJS `require` works), keep the derivation and adapt only the loading.

- [ ] **Step 2:** `node --test --test-force-exit tools/loop/tests/ciVerdict.test.ts`. Expected: both new tests FAIL (`android`/`ios` in the ids).

- [ ] **Step 3: Fix.** jest prints the project name only in multi-project mode, as one token with no path separator before the relative test path. Replace line 176 with:

```ts
const JEST_FAILURE = /^FAIL\s+(?:[^\s/\\]+\s+)?(\S*[/\\]\S*)/gm;
```

The group requires a separator, so the id is always a path. Check that the existing `"FAIL tests/native/x.test.tsx"` test and the `loopDerive.test.ts:539` fixture (`log: "FAIL x"`) still hold. If that fixture depended on `x` parsing as an id, change the fixture to a path, not the regex.

- [ ] **Step 4:** Run `ciVerdict.test.ts` and `loopDerive.test.ts`: all pass.
- [ ] **Step 5:** `git add -- tools/loop/ciVerdict.ts tools/loop/tests/ciVerdict.test.ts [tools/loop/tests/loopDerive.test.ts]`, then commit `loop: a jest FAIL line's id is its test path, never the project name`.

### Task 2: `mainFailures()`, the failing ids of main's latest red run

**Files:** `tools/loop/mainHealth.ts`, its test file (`ls tools/loop/tests | grep -i mainhealth`; extend it if present)

**Interfaces:**
- Consumes: `readMain(gh, repo)` and `Gh` (already in `mainHealth.ts`), `decideVerdict`, `failingTestIds` and `stripLogPrefix` from `./ciVerdict.ts`.
- Produces: `export function mainFailures(gh: Gh, repo: string): { runId: number; url?: string; ids: string[] } | null`.
  - `null` when main's latest ci.yml run is missing, not completed, successful, or an infrastructure verdict (`decideVerdict(run, jobs).infrastructure`, which is how `decideMainHealth` already tells the two apart; reuse that, don't re-derive it). Also `null` on any throw from `gh`.
  - Otherwise `ids = failingTestIds(gh(["run","view",String(run.databaseId),"--repo",repo,"--log-failed"]).split("\n").map(stripLogPrefix).join("\n"))`, which is exactly the read `sharedRed.ts:testIdsFor` does today.

- [ ] **Step 1: Failing tests** with a stub `gh` keyed on the args (`mainRunArgs(repo)`, `jobArgs(repo, id)`, and the `--log-failed` call). Four cases: green run → `null`; red with jobs that ran → `{runId, url, ids: ["tests/native/a.test.tsx"]}` from a log holding `FAIL android tests/native/a.test.tsx`; red where every job has zero steps (infrastructure) → `null`; `gh` throws → `null`.
- [ ] **Step 2:** Run it: FAIL, `mainFailures` is not exported.
- [ ] **Step 3: Implement**, in `mainHealth.ts` after `checkMain`:

```ts
/** Main's latest completed red run and its failing test ids, or null when main has none to give. */
export function mainFailures(gh: Gh, repo: string): { runId: number; url?: string; ids: string[] } | null {
  try {
    const { run, jobs } = readMain(gh, repo);
    if (!run || run.status !== "completed" || run.conclusion === "success") return null;
    if (decideVerdict(run, jobs).infrastructure) return null;
    const log = gh(["run", "view", String(run.databaseId), "--repo", repo, "--log-failed"]);
    return { runId: run.databaseId, url: run.url, ids: failingTestIds(log.split("\n").map(stripLogPrefix).join("\n")) };
  } catch {
    return null;
  }
}
```

Match `decideVerdict`'s real call shape as `decideMainHealth` uses it in this file, and adapt if it differs.

- [ ] **Step 4:** Tests pass. **Step 5:** commit `loop: mainFailures reads the failing ids of main's latest red run`.

### Task 3: The supervisor says `on main:` and no longer knows shared-red

**Files:** `tools/loop/queue-loop.mjs`, `tools/loop/loop-logs.mjs`, delete `tools/loop/sharedRed.ts` and `tools/loop/tests/sharedRed.test.ts`, then update `tools/loop/tests/settleReplay.test.ts`, `queueLoopMain.test.ts` and `loopLogs.test.ts`.

**Interfaces:**
- `export function onMainLine(failing: string[], main: {url?: string, ids: string[]} | null): string` in `queue-loop.mjs`. Returns `"none"` when `main` is null or nothing overlaps; otherwise `` `${k} of ${n} also fail on main (${main.url ?? "main's latest run"}): ${ids.join(", ")}` ``, where `ids` are the entries of `failing` that are also in `main.ids`, in `failing`'s order.
- `ciRedBody({... , onMain = "none" })` replaces its `shared` parameter; the body line becomes `` `on main: ${onMain}` `` where `shared: …` was.
- `poll`'s io gains `mainFailures = () => ts("./mainHealth.ts").mainFailures((args) => run("gh", args, { timeout: CI_RED_TIMEOUT_MS }), REPO)` and loses `shared`.

- [ ] **Step 1: Failing tests.** In `settleReplay.test.ts`: delete the `describe("a red head shared with another branch")` and `describe("sharedPlan")` blocks and the `sharedPlan` import. Add:

```ts
describe("a red head's failures that main has too", () => {
  test("onMainLine names the overlap and main's run, in the branch's order", () => {
    assert.equal(onMainLine(["b", "a"], { url: "u", ids: ["a", "b", "c"] }), "2 of 2 also fail on main (u): b, a");
    assert.equal(onMainLine(["a", "z"], { url: "u", ids: ["a"] }), "1 of 2 also fail on main (u): a");
    assert.equal(onMainLine(["z"], { url: "u", ids: ["a"] }), "none");
    assert.equal(onMainLine(["a"], null), "none");
  });
});
```

Then change the existing poll test that asserts the CI-RED body (the one using `redFake` and `bodyOf`) so its io passes `mainFailures: () => ({ runId: 1, url: "https://example.test/runs/1", ids: [<one of that test's failing ids>] })`, and assert the body line with `/^on main: 1 of \d+ also fail on main \(https:\/\/example\.test\/runs\/1\): /m`. Add one case with `mainFailures: () => null` asserting `/^on main: none$/m`. Replace the fixture text `shared: none` (~line 262) with `on main: none`. Assert that no `poll` result carries `blockedBy`.

In `queueLoopMain.test.ts`: delete every test whose settle returns `blockedBy` (~lines 865–945, the `blockOnShared` cases, the `blocked` entry ~1455 and the case ~1600), remove `block: () => {}` from the default io, and remove the `blockOnShared` import. In `loopLogs.test.ts`: drop `red-999.ids` from the prunable fixtures and expectations.

- [ ] **Step 2:** `node --test --test-force-exit tools/loop/tests/settleReplay.test.ts`. Expected: FAIL, `onMainLine` is not exported.

- [ ] **Step 3: Implement in `queue-loop.mjs`.**
  - In `poll`'s io defaults, replace `shared = …checkShared…` with the `mainFailures` default above.
  - Replace the whole block from `const decision = shared(…)` through `if (plan.action === "block") …` (currently ~1987–2002) with:

    ```js
    const onMain = onMainLine(verdict.testIds ?? [], mainFailures());
    postCiRedOnce(pending.ticket, verdict, onMain, comments, run, write, log);
    ```

    `next` is left as `readLanding` returned it. The shared plan's `update-branch` action goes with it.
  - `postCiRedOnce(ticket, verdict, onMain, …)` passes `onMain` to `ciRedBody`.
  - `ciRedBody`: the `shared` param and its `shared: ${shared}` line become `onMain` / `on main: ${onMain}`. Update its JSDoc param list.
  - Delete `sharedPlan`, `blockOnShared`, `SHARED_BUDGET_MS`, the `ghVia` helper if nothing else uses it (`grep -n "ghVia" tools/loop/queue-loop.mjs`), the `if (settled.blockedBy) { … }` settle branch (~2352) and the `block:` io entry (~2485).
  - Add `onMainLine` (exported) near `ciRedBody`.
- [ ] **Step 4: Delete** `tools/loop/sharedRed.ts` and `tools/loop/tests/sharedRed.test.ts` (`git rm`). In `tools/loop/loop-logs.mjs`, delete the `redCache` artefact entry and the `redCachePath` export.
- [ ] **Step 5:** Run the Global Constraints `git grep`: it must print nothing outside the two excluded doc folders. Then `node --test --test-force-exit tools/loop/tests/settleReplay.test.ts tools/loop/tests/queueLoopMain.test.ts tools/loop/tests/queueLoop.test.ts tools/loop/tests/loopLogs.test.ts tools/loop/tests/ciVerdict.test.ts`: all pass.
- [ ] **Step 6:** Commit, by pathspec, every file this task touched (including the `git rm`s): `loop: remove shared-red detection; CI-RED says which failures main has too`. The body gives the four runs from #1181 and why the signal was wrong.

### Task 4: `queue.md` says what `on main:` means

**Files:** `.claude/commands/queue.md`, and `tools/loop/tests/loopDocsAreExecutable.test.ts` only if it pins the removed text.

- [ ] **Step 1: Failing test** in `loopDocsAreExecutable.test.ts`:

```ts
test("queue.md reads CI-RED's on main: line and knows no shared-red issue", () => {
  const q = read(QUEUE);
  assert.match(q, /`on main:`/);
  assert.doesNotMatch(q, /shared:|shared issue|owned here/);
});
```

- [ ] **Step 2:** Run it: FAIL.
- [ ] **Step 3: Edit `queue.md`.**
  - Delete phase A's paragraph starting "If it was blocked on a shared issue that is now closed", with its `git -C .worktrees/agent-<n> merge --no-edit origin/main` block.
  - In phase C, replace the paragraph starting "The `CI-RED` comment's `shared:` line" (through "do not re-investigate it.") with:

    ```markdown
    The `CI-RED` comment's `on main:` line names the failures main's own latest CI run has too.
    Those did not come from this diff, and the loop runs one ticket at a time, so nobody else is
    working on them. Fix their root cause here in a commit of its own, and name main's run in
    `FIX-NOTES`. `none` means every failure is this diff's.
    ```
- [ ] **Step 4:** `node --test --test-force-exit tools/loop/tests/loopDocsAreExecutable.test.ts tools/loop/tests/queueLoop.test.ts tests/rulesAreSingleSourced.test.ts`: all pass.
- [ ] **Step 5:** Commit `loop: queue.md reads on main:, not shared:`.

### Task 5: Whole-branch check and PR

- [ ] **Step 1:**

```bash
cd C:/Users/roton/murlan-1181
node --test --test-timeout=60000 --test-force-exit tools/loop/tests/*.test.ts tests/rulesAreSingleSourced.test.ts 2>&1 | tail -12
npx tsc --noEmit -p .
npx eslint tools/loop --max-warnings 0
npm run check:comments
git grep -n -E "sharedRed|sharedPlan|blockOnShared|blockedBy|SHARED_BUDGET|redCache|redCachePath|shared-red|shared red|claimShared|checkShared" -- . ':!docs/superpowers' ':!docs/research'
```

Expected: `fail 0`, tsc and eslint silent, `within budget`, and the grep prints nothing.

- [ ] **Step 2:** Push `loop/1181-test-ids-and-main-reds` and open the PR. Write the body file with the Write tool at `C:/Users/roton/AppData/Local/Temp/claude/C--Users-roton-murlan/aca97a58-d2ea-4ba0-a8fa-4924a0fd7fed/scratchpad/pr1181.md`. It covers what changed per DoD group and how it was checked, then `Closes #1181`, `Closes #1169` (a false positive of the removed mechanism), a blank line, and `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Self-review notes

- DoD parser → Task 1. Remove shared-red → Task 3 plus the grep. `mainFailures` → Task 2. `on main:` line → Task 3. `queue.md` → Task 4. #1169 → Task 5's PR body.
- `.loop-logs/red-*.ids` in the live checkout are not this branch's; the owner's session deletes them after merge.
