# Design audit: developer and agent tooling (tools/loop, tools/ci, scripts, .claude, .github/workflows, package.json, tests/tooling)

Auditor report, 2026-10-16. Everything below was read in code. No files were edited and nothing was run apart from read-only greps and git commands. Line numbers are from worktree HEAD `d8c34919`.

## The short answer

Is there a pure "decide the next action from what was observed" core, with git, gh, claude and processes injected? **Yes, partly.**
- `tools/loop/decide.mjs` has one entry point, `decide(input)` (decide.mjs:432-434). It is pure and table-driven.
- `settle.mjs` already splits a pure state machine (`stepSettle`) from an executor (`runSettle`) that takes ports (settle.mjs:277-313, 522-547).
- `loop-stream.mjs` `reduceSession` is a pure reducer.
- `runOnce` takes four ports (`tracker`, `workspace`, `session`, `ledger`).

The core has four holes:
1. **Routing and phase still live outside it**: in `nextRoute` and `liveRoute` (queue-loop.mjs:98-183) and in `derive()` (loop-derive.mjs:426-547), bridged by the `LOOP_PHASE` env var.
2. **The ports are grouped for the caller's convenience, not by dependency**: `tracker.park` does git commit, labels and worktree removal; `tracker.settle` is CI and merging.
3. **`runOnce` and `main` bypass their own ports** for disk reads and writes.
4. **About 555 lines of real adapters (git, gh, npm) plus about 190 lines of board glue sit inside queue-loop.mjs.**

---

## P1

### F1. `queue-loop.mjs` is a god module: adapters, board glue, orchestration and config in one file
- **Files:** tools/loop/queue-loop.mjs (1706 lines). Responsibilities by line range:
  - 94-183: routing (`liveRoute`, `nextRoute`), which is decision logic (see F2).
  - 185-252 and 677-716: the claude CLI contract (`queueLoopArgs`, `allowedTools`, `sessionEnv`).
  - 254-364: `syncCheckout` (git checkout/fetch/ff, lockfile drift, `npm ci`), which is a workspace concern.
  - 366-421 and 864, 984: run caps and constants (`CI_ROUNDS`, `MAX_HANDOFFS`, `BREAKER`, `HEARTBEAT_MS`, `BASH_DEFAULT_TIMEOUT_MS`, `RESTART`, `TICKET_HOLDS`).
  - 394-412: its own process adapter `sh` (git/gh dispatch plus a Windows npm/npx shell quoting path).
  - 423-458: the `holdFor` timer.
  - 460-618: `park`, `repark`, `removeWorktree`, `removeLanded` (gh labels and comments, git add/commit, an npm subprocess, disk writes).
  - 620-675: `publishForReview`, `refreshWorktree`, `ticketFacts` (GitHub and git adapters).
  - 718-854: board glue (`roundOf`, `openTicket`, `sessionView`, `ticketRun`, `runTicket`).
  - 856-944: `loopMoved`, `loopSha`, `pushedPr` (gh adapter).
  - 946-981: `settle` (the board wrapper around `runSettle`).
  - 984-1041: `standing`, `worktreeOf`, `parkAndRecord`.
  - 1043-1291: `runOnce`, the orchestration.
  - 1293-1348: `journaled`, `screenEvents` (board).
  - 1350-1483: `realPorts`.
  - 1485-1695: `trapSignals`, `main` (timers, recap, reparks, holds).
- **What's wrong:** the module's interface is everything it exports, about 40 names, and tests import about 30 of them. The real seam, `runOnce(ports, …)`, is buried among adapters that are themselves exported and tested one by one.
  - The ports are not grouped by dependency. `tracker.park` → `park()` runs `git add/commit` in the worktree and `npm run worktrees:remove` (queue-loop.mjs:498-533). `tracker.settle` is CI and merging. `tracker.release` builds its own `ghTracker()` instead of using the injected one (1393).
  - The interface is wide enough that the tests needed a placement helper (`place` plus the `OPTIONAL` map, queueLoopMain.test.ts:47-67) and two independent fake-port builders: `stubPorts` (queueLoop.test.ts:36-60) and `io()` (queueLoopMain.test.ts:70-127).
- **Proposed interface:**
  - `queue-loop.mjs` keeps only `runOnce(ports, events, pinned, at, loop)` and `main(deps)`.
  - Ports regrouped by dependency category:
    - `github`: `{ pick, facts, issueState, prFor(branch|ticket, {since, declared}), publish(n, branch, cwd), label(n, 'claim'|'release'|'park'), comment(n, file), settle(pending) }` — remote-owned/true-external.
    - `workspace`: `{ stopFile, parkAsked(n), clearParkAsk(), sync(pinned), moved(), housekeeping(pinned), standing(), refresh(cwd, branch), buildPassed(cwd, n), sharedDirty(), commitWip(cwd, n, phase), removeLanded(cwd, n), worktreeOf(n), ciLog(n) }` — local-substitutable.
    - `session.spawn(route)` and `ledger` stay as they are.
  - `park()` becomes `workspace.commitWip`, then `github.label(n,'park')` + `github.comment`, then `workspace.remove`, composed in `parkAndRecord`.
  - The board glue moves to `loop-board.mjs`; the constants move to `limits.mjs` (F6).
- **Dependency category:** in-process orchestration over true-external (gh, git, npm, claude) adapters.
- **Effect:**
  - queue-loop.mjs drops from 1706 to about 500 lines; about 555 adapter lines go to `github.mjs`/`workspace.mjs`, about 190 board lines to `loop-board.mjs`, about 45 constant lines to `limits.mjs`, and about 90 routing lines go into `decide` (F2).
  - **Tests to delete:** the duplicate `stubPorts` builder and the `place`/`OPTIONAL` machinery (one fake per port suffices).
  - **Tests to move:** the argv-level adapter tests (queueLoop.test.ts `park` 1016-1127, `repark` 983-1016, `pushedPr` 1418-1496, `ticketFacts` 1622-end, `syncCheckout` 260-440, about 450 lines) move to the adapter modules as their contract tests.
  - **Bug class removed:** "a port named tracker that silently does git", so a fake tracker can no longer hide a missing commit.
  - **Locality:** a reader of `runOnce` sees every effect through four ports.
- **Effort:** L. **Risk:** medium; this is the supervisor's composition, so move it one adapter group at a time and keep `queueLoopMain.test.ts` green as the regression net. **Priority:** P1.

### F2. Phase and route resolution is computed in four places, bridged by an env var
- **Files:**
  - `loop-derive.mjs:426-547`: `derive()` reads git (469-475) and gh (479-486), then decides the phase inline (488-517).
  - `queue-loop.mjs:98-118`: `liveRoute` (labels check, default phase "C").
  - `queue-loop.mjs:133-183`: `nextRoute` re-derives the phase from the ledger handoff, `status.fix` and G/E settling (151-157), and decides whether a pinned ticket was released (176-180).
  - `queue-loop.mjs:686-694`: `sessionEnv` writes `LOOP_PHASE`.
  - `loop-derive.mjs:432, 513-516`: the spawned session's own `derive()` reads `LOOP_PHASE` back as `handed` and overrides its computed phase.
  - `decide.mjs` STEPS `pick` (199-215) then receives the result.
- **What's wrong:** queue-loop.mjs:1085 says "Every routing choice is `decide()`'s". That is false: `nextRoute` holds routing rules, such as "a LAND on this head ends the review" and "a pinned ticket the owner relabelled is released", and `derive()` holds the phase table.
  - `derive()` takes an injectable `exec` for gh, but git goes through a module-level `run` (loop-derive.mjs:18), so it is not injectable.
  - The only way to test the phase logic is a real git repo plus a fake gh written as a node script and selected through `LOOP_GH_SCRIPT`. loopDerive.test.ts does this with `mkdtemp` + `git init` in 4 describe blocks and 17 `LOOP_GH_SCRIPT` swaps (324-359, 485-556, 558-765). loopGate.test.ts spawns the gate as a subprocess with `LOOP_GH_SCRIPT`, `LOOP_BASE` and `LOOP_WORKTREE` (68-97).
- **Proposed interface:**
  - `readRun({cwd, base, worktree, ci, gh, git}) -> RunFacts`: I/O only. It returns `{ticket, branch, cwd, head, headSubject, commits, changed, dirty, comments|null, ci|null}`.
  - `phaseOf(facts, handed?) -> {phase, why}`: pure, owning the table now at loop-derive.mjs:488-517.
  - Move `liveRoute`/`nextRoute`'s rules into `decide`'s `pick` step as `{status, known, tally, pinnedLabels}` facts, so `nextRoute` only reads.
  - Pass `handed` explicitly in-process from the supervisor. The session-side `LOOP_PHASE` reading becomes the session-env reader's job (F4).
- **Dependency category:** pure core over local-substitutable git and remote-owned gh.
- **Effect:**
  - One home for the phase table.
  - About 12 `derive(` calls and 17 env swaps in loopDerive.test.ts become table tests of `phaseOf`. Keep 2-3 real-repo integration tests for `readRun`.
  - The "supervisor and session disagree about the phase" class (the reason `handed` exists) goes away: the supervisor computes the phase once and the session receives it.
  - `nextRoute`'s tests in queueLoopMain move into decide.test.ts.
- **Effort:** M. **Risk:** medium; `derive()` also drives the SessionStart hook (`loop-status.mjs`) and the gate. **Priority:** P1.

### F3. GitHub access is scattered, with about 7 argv-level gh fakes in tests and an unenforced `--repo` rule
- **Files:**
  - Issue comments are read in 3 places: `loop-derive.mjs:349-351`, `settle.mjs:321-329`, `queue-loop.mjs:654-675` (plus `tracker.issue`, tracker.mjs:35-38).
  - Open PRs are listed in 5 places: `queue-loop.mjs:624-635`, `queue-loop.mjs:908-944`, `loop-derive.mjs:388-409`, `workspace.mjs:239`, `next-ticket.mjs:176-180`.
  - Issues are created in 2 places: `settle.mjs:394-425` (flakes) and `mainHealth.ts:107-128`.
  - CI-RED comments are posted through raw `gh` (settle.mjs:356), bypassing `tracker.comment`.
  - `cli.mjs:9` says "The repository every `gh` call in the loop names, so no two of them can name different ones". The code contradicts this: about 13 call sites pass no `--repo` and resolve the repo from cwd's remote (tracker.mjs:32,35,89-98; queue-loop.mjs:657,925-926,939; loop-derive.mjs:350; settle.mjs:323,356,460; workspace.mjs:239; next-ticket.mjs:178), while others do pass it (queue-loop.mjs:628,633; loop-derive.mjs:341,395; settle.mjs:397,416).
  - Test fakes, each modelling its own slice of the gh CLI by matching argv:
    - queueLoop.test.ts:1421-1430: a "projecting" `gh` that re-implements `--json` field selection.
    - queueLoop.test.ts:1018-1029: a `recorder` keyed on argv substrings.
    - loopDerive.test.ts:459: `fakeGh` writes node scripts.
    - loopGate.test.ts:68: `stubGh` script.
    - workspace.test.ts:65: `fakeGh`.
    - mainHealth.test.ts:41: `fakeGh`.
    - ciVerdict.test.ts:303: `fakeGh`.
    - settleReplay.test.ts: `rollupFake`, stateful, from recorded fixtures.
- **What's wrong:** `tracker.mjs` is a real seam with two adapters (`ghTracker`, `fakeTracker`), but it covers only the 5 label and comment operations. Every other GitHub read is a hypothetical seam reached by argv, so each test re-creates gh's CLI semantics. The `--repo` rule is a premise held only in prose.
- **Proposed interface:** widen `tracker.mjs` into `github.mjs` with two adapters, `ghGitHub(gh = cli.gh)` and `fakeGitHub(state)`.
  ```js
  issue(n) -> {title, url, state, stateReason, labels, comments /* trusted only */}
  prs({branch?, ticket?, state:'open'|'all'}) -> PR[]   // {number,state,head,sha,mergedAt,changedFiles}
  pr(n) -> PR
  label(n, 'claim'|'release'|'park'); comment(n, bodyFile); createIssue({title, bodyFile, labels})
  openIssues() -> Issue[]   // the GraphQL query in next-ticket.mjs:17-42
  ```
  Every adapter call appends `--repo REPO`, so the rule becomes structural. `fakeGitHub` grows from `fakeTracker` plus settleReplay's `rollupFake` state.
- **Dependency category:** remote-owned (GitHub via the true-external `gh`).
- **Effect:**
  - About 15 call sites collapse to method calls.
  - **Tests deleted or replaced:** 7 bespoke fakes become 1. The `pushedPr` projecting-fake tests (about 80 lines) shrink to one adapter contract test. The `LOOP_GH_SCRIPT` node-script fakes in loopDerive and loopGate go away once F2 lands.
  - **Bug class removed:** "wrong or implicit repo" and "a field dropped from `--json`" are caught once, in the adapter's contract test.
  - `trustedComments` is applied in the adapter, so no caller can forget it.
- **Effort:** M. **Risk:** low-medium; mechanical, but it touches settle's effects. **Priority:** P1.

---

## P2

### F4. The session environment is a hidden interface written in one place and parsed in five
- **Files:**
  - The writer is `queue-loop.mjs:686-716` (`LOOP_TURNS`, `LOOP_TICKET`, `LOOP_PHASE`, `LOOP_REASON` plus 15 `CLAUDE_CODE_*`/`BASH_*`).
  - Readers:
    - `guard-bash.mjs:109` (`LOOP_PHASE` regex `^[B-G]$`), 212 (`LOOP_TICKET`), 410/442 (`Boolean(LOOP_TURNS)`).
    - `loop-derive.mjs:428-432` (`LOOP_PHASE`, plus the test seams `LOOP_BASE`, `LOOP_WORKTREE`).
    - `loop-gate.mjs:226` (`LOOP_WORKTREE`).
    - `loop-status.mjs:19,81,103,107,113` (`LOOP_TURNS`, `LOOP_REASON`).
    - `tools/ci/e2eGlobalTimeout.mjs:7` (`LOOP_TURNS`).
    - `cli.mjs:33` (`LOOP_GH_SCRIPT`, `LOOP_GIT_SCRIPT`).
  - Prose readers: CLAUDE.md "LOOP PROTOCOL" and queue.md (`$LOOP_TURNS`).
  - The workaround: `tools/loop/tests/helpers/clearLoopEnv.mjs` deletes every `LOOP_*` before tests (wired in package.json `loop:test`), and `loopTestEnv.test.ts` exists to check that.
- **What's wrong:** "am I a loop session?" is answered three different ways (`LOOP_TURNS` truthy, `LOOP_PHASE` matching a regex, `LOOP_TICKET` numeric). Production contract variables and test seams (`LOOP_BASE`, `LOOP_WORKTREE`, `LOOP_*_SCRIPT`) share one namespace. "Nothing in the loop may ever set" `LOOP_WORKTREE`/`LOOP_BASE` (loop-derive.mjs:411-418) is enforced only by prose; guard-bash has no rule about them.
- **Proposed interface:** `tools/loop/session-env.mjs`, the only module that names these variables:
  ```js
  export function toEnv({ticket, turns, phase, reason, context}) -> Record<string,string>
  export function fromEnv(env = process.env) -> {loop: boolean, ticket: number|null, turns: number|null, phase: string|null, reason: string|null}
  ```
  The test seams leave env: `derive`/`buildReady` take `{base, worktree}` parameters, which the gate's CLI could take as hidden flags, and `cli.mjs` exposes `withRunner(fn)` for tests instead of `LOOP_*_SCRIPT`.
- **Dependency category:** in-process.
- **Effect:**
  - Six readers become `fromEnv()` calls.
  - `clearLoopEnv.mjs` and `loopTestEnv.test.ts` become deletable once no production default reads env.
  - **Bug class removed:** "a test run inside a loop session inherits that session's state" (loop-derive.mjs:421-422 documents this hazard).
  - guard-bash's three different "is this a loop?" checks become one.
- **Effort:** M. **Risk:** low. **Priority:** P2.

### F5. Process spawning is duplicated: the npm/npx shim, tree-kill, and the "run a bin" pattern, with a real orphan bug class on Windows
- **Files:**
  - npm/npx shim through a shell, with three different strategies:
    - `queue-loop.mjs:397-412` (its own quoting).
    - `agent-check.mjs:104-110` (`shell: win32`, with a `timeout`).
    - `scripts/e2e-server.mjs:40-52, 79-84, 97-101` (`npx.cmd` + `shell`).
    - `scripts/ios-device.mjs:395-398, 413` (string command + `shell: true`).
    - `scripts/optimize-images.mjs:37`.
  - Tree-kill in 3 places with different semantics: `loop-session.mjs:78-88` (taskkill /T on win32, SIGTERM parent-only elsewhere), `reap.mjs:218-223`, `scripts/ios-device.mjs:324-325`.
  - The shell-free pattern already exists in the repo: `related-tests.mjs:70,81` (`process.execPath` + `jest.js`) and `checkStrictIndexed.mjs:96` (node + `tsc` bin).
  - The defect is documented and not fixed: agent-check.mjs:52 reads "On Windows the kill reaches the shell, not the tree, so a stray child can outlive it."
  - `e2e-server.mjs:38` `children.forEach((c) => c.kill())` kills `cmd.exe`, not `tsx server`, under `shell: true` on win32.
  - The same "node will not resolve a .cmd since CVE-2024-27980" explanation is repeated at cli.mjs:19-21, queue-loop.mjs:394-396 and checkStrictIndexed.mjs:32.
- **What's wrong:** five shallow copies of the same adapter. Each Windows `shell: true` site leaves orphaned trees on timeout or exit, which is the class `reap.mjs` and the memory notes exist to clean up.
- **Proposed interface:** `scripts/lib/proc.mjs`
  ```js
  npm(args, {cwd, timeout, inherit}) / npx(bin, args, opts)   // node + resolved npm-cli.js / bin, never a shell
  spawnTree(cmd, args, opts) -> {child, kill()}               // kill() = taskkill /T /F on win32, process-group SIGKILL elsewhere
  ```
  `cli.mjs`'s `run` and `queue-loop`'s `sh` delegate to it.
- **Dependency category:** true-external (OS processes).
- **Effect:**
  - About 9 call sites become calls into one module.
  - **Bug class removed:** orphaned jest workers or servers after a timeout or exit on Windows.
  - **Tests deleted:** cli.test.ts's `OTHER_BINARIES["queue-loop.mjs"]` exemption, which anchors on the literal source of `sh` (cli.test.ts:99-101, 106-108).
  - One place for the CVE explanation.
- **Effort:** M. **Risk:** medium; Windows behaviour must be checked on harness-windows. **Priority:** P2.

### F6. Policy and limits are spread over 8 modules; light scripts import the god module for one constant
- **Files:**
  - `queue-loop.mjs:379,384,392,415,421,864,984` (`BASH_DEFAULT_TIMEOUT_MS`, `CI_ROUNDS`, `MAX_HANDOFFS`, `BREAKER`, `HEARTBEAT_MS`, `RESTART`, `TICKET_HOLDS`).
  - `decide.mjs:73` (`WAIT`); `settle.mjs:34,37,40` (`SETTLE`, `UPDATES`, `CI_RED_TIMEOUT_MS`).
  - `loop-cost.mjs:20-71` (`MODEL_BY_PHASE`, `EFFORT_BY_PHASE`, `CONTEXT_BY_SIZE`, `TURNS_BY_SIZE`, `TICKET_BUDGET_USD`, `USD_BY_SIZE`).
  - `loop-gate.mjs:95,98` (`MAX_REVIEW_ROUNDS`, `MAX_FIX_HOLDS`); `limits.mjs` (`STALL_MS`, …); `loop-derive.mjs:365` (`CI_BUDGET_MS`).
  - `LIMITS` is assembled at queue-loop.mjs:1043 and duplicated in decide.test.ts:9, which imports them from queue-loop.mjs (decide.test.ts:7).
  - `scripts/await-run.mjs:8` imports `BASH_DEFAULT_TIMEOUT_MS` from queue-loop.mjs, which loads the whole supervisor graph and reads `result-schema.json` at import (queue-loop.mjs:209).
  - `run-loop.mjs:4` imports `RESTART` from queue-loop.mjs.
  - Stale premise: loop-cost.mjs:15-18 says the model table lives there because queue-loop "statically imports `.ts` sources". It no longer does (queue-loop's imports at 15-87 have no `.ts`; settle loads `.ts` lazily at settle.mjs:26).
- **What's wrong:** no single place answers "what are the run's caps". `decide()`'s input `limits` is built by its caller from four modules.
- **Proposed interface:** `limits.mjs` (already designated "plain constants, importable", limits.mjs:1) exports `LIMITS` and `SESSION_POLICY = {model, effort, context, turns, usd}`. `decide` defaults to `LIMITS`.
- **Effect:** decide.test.ts stops importing queue-loop.mjs; await-run and run-loop import a 30-line constants file; the stale comment goes. **Effort:** S. **Risk:** low. **Priority:** P2.

### F7. `runOnce` and `main` bypass their ports for disk I/O, so tests `chdir`
- **Files:**
  - queue-loop.mjs:1136 (`parkAsked(n)` reads `.loop-park` from cwd), 1138 and 1679 (`fs.rmSync(PARK_FILE)`).
  - 1147, 1156, 1175, 1260 (`streamLog(n)` against the default `.loop-logs`).
  - 1289 (`fs.existsSync(ciLogPath(n))`); 1009-1010 (`worktreeOf` uses `fs.existsSync` + `ROOT`).
  - 1635 (`pruneLogs()` on the real directory each pass); 1678 (`parkAsked`).
  - queueLoopMain.test.ts uses `process.chdir` 6 times to plant `.loop-park` (1921-1994). runTicket's comment (queue-loop.mjs:827-830) records that a default reaching `.loop-logs/` had the tests "appending to — and deleting — the loop's own record".
- **What's wrong:** the composition's interface includes the process cwd and the real `.loop-logs`, while the ports suggest otherwise. `process.chdir` is process-global inside a concurrent test runner.
- **Proposed interface:** add `workspace.parkAsked(n)`, `workspace.clearParkAsk()`, `workspace.ciLog(n) -> path|null`, `ledger.logOf(n)` and `ledger.prune()` (see F1).
- **Effect:** 6 `chdir`s are deleted, and the class "a test touches the live loop record or cwd" goes away. **Effort:** S. **Risk:** low. **Priority:** P2.

### F8. ci.yml's `scope` decision is inline bash, and its test regex-parses bash out of YAML
- **Files:** `.github/workflows/ci.yml:52-206`: about 60 lines of bash classifying paths into `app`/`harness`/`scans` (79-154), plus artifact fetching (156-201). `tests/tooling/ciScope.test.ts:23-47` extracts the `if/elif grep -qE '…'` chain from the YAML with a regex and asserts on "unhandled grep form". By contrast, `tools/ci/nativeScope.mjs` is already a module with a pure `needsNative(changed, before, after)`.
- **What's wrong:** the interface is YAML and bash, so the test reaches past it by parsing the implementation. The two path allowlists (ci.yml:131, 136) are the decision itself.
- **Proposed interface:** `tools/ci/scope.mjs` exporting `scopeOf(changed: string[]) -> {app, harness, scans}` and a CLI that prints `GITHUB_OUTPUT` lines. ci.yml keeps only the "identical tree already green" short-circuit and the `git diff`.
- **Effect:** about 75 lines of bash become about 40 lines of JS; ciScope.test.ts loses its YAML/regex extractor (lines 23-47) and calls `scopeOf` directly; scope becomes runnable locally. **Effort:** S. **Risk:** low; ciScope.test already pins behaviour. **Priority:** P2.

### F9. Workflow duplication: installs, Node versions, and a byte-identical device gate
- **Files:**
  - Thirteen full `setup-node` + `npm ci` blocks bypass the existing composite `.github/actions/install`: audio-soak.yml:26-30 and 105-114; ci.yml:429-433 (harness), 519-523 (android-build), 585-589 (ios-build), 956-975 (build); eas-build.yml:40-46; ios-app-cache.yml:26-32; ios-bench.yml:21-26; ios-device.yml:32-38; maestro.yml:109-115; soak.yml:60-64 and 130-134. The composite is used only at ci.yml:325, 388, 486, 691; ios.yml:61; parity-nightly.yml:28.
  - Node version: `env.NODE_VERSION: "24"` in 3 files, but a literal `24` in eas-build, ios-app-cache, ios-bench, ios-device, ios.yml (×2) and maestro.
  - Production's Node `22` is a literal at ci.yml:958 and soak.yml:62,132. Only ci.yml's `build` job verifies it against `deploy/runtime.json` (ci.yml:964-970); soak.yml does not.
  - The `gate` job is byte-identical in ios.yml:36-49 and maestro.yml:42-55. deviceWorkflowsGate.test.ts:17-30 runs the extracted bash from each.
- **What's wrong:** shallow copies. A Node bump or an install change is about 20 edits. The soak job's production-Node pin carries no check.
- **Proposed interface:**
  - `.github/actions/install` gains `node-version` defaulting to the repo version and an `npm-ci: always|cached` input for jobs that must not restore node_modules.
  - `.github/actions/device-gate` (or `tools/ci/device-gate.sh`) replaces both gate jobs.
  - Read production Node with `node-version-file`/`deploy/runtime.json` in soak.yml.
- **Effect:**
  - About 13 install blocks become 1-line uses, and 9 literal Node versions become 0.
  - deviceWorkflowsGate tests one script instead of two YAML extractions.
  - **Bug class removed:** "soak tests the wrong Node silently".
- **Effort:** M. Some jobs (android/ios prebuild) may deliberately avoid cached node_modules; check each before converting. **Risk:** low-medium; CI-only. **Priority:** P2.

### F10. `decide.mjs` exports its internals, and about 290 test lines test past `decide()`
- **Files:** `decide.mjs` exports `handoffOf`, `exhausted`, `RESUMABLE`, `resumePhase`, `apiFailure`, `waitFor`, `afterRefusal`, `outcomeOf`, `reasonFor` (lines 6-175). Outside decide.mjs, of these internals only `exhausted` (tools/ci/preflightMemory.mjs, tests/tooling/androidFlowMarker.test.ts) and `reasonFor` (loopDerive.test.ts) have callers beyond queueLoop.test.ts; the others (`handoffOf`, `RESUMABLE` none at all) are used only by tests. `afterSession` (decide.mjs:18-33) is a real dependency of queue-loop.mjs:1187 and is not part of this deletion. queueLoop.test.ts imports them (line 34) and tests them directly: describe `outcomeOf` 1127-1194, `reasonFor` 1194-1250, cut off 1250-1291, `waitFor` 1291-1326, `afterRefusal` 1364-1418. decide.test.ts already drives the same branches through `decide()` with `session(...)`/`api(...)` builders (decide.test.ts:12-33).
- **What's wrong:** the interface is `decide(input)`, but the tests also pin the helper decomposition, so refactoring a helper breaks tests while behaviour is unchanged.
- **Proposed interface:** export only `decide`, `afterSession`, `WAIT` and `exhausted` (the last has a non-test caller in tools/ci/preflightMemory.mjs). Move the unique cases into decide.test.ts as `decide()` inputs.
- **Effect:** about 290 lines of queueLoop.test.ts deleted or converted; decide's interface shrinks from 13 exports to 4. **Effort:** S. **Risk:** low; check each deleted case has a `decide()` twin first. **Priority:** P2.

---

## P3

### F11. In-process modules are called through subprocesses and stdout protocols
- `queue-loop.mjs:1436-1440` runs `node claim.mjs` and parses `claimed.split("\t")[2]` and `err.stdout.split("\t").at(-1)`, even though `claim(number, title, run, tracker)` (claim.mjs:87-117) is importable and already returns `{branch, cwd, won, why}`.
- `queue-loop.mjs:580-582, 617` remove worktrees with `npm run worktrees:remove`, going through the `sh` shell path on Windows, even though `workspace.removeWorktree(target, {force, git})` (workspace.mjs:154-202) is importable. The two exports are both named `removeWorktree` with different signatures (queue-loop.mjs:580 vs workspace.mjs:154).
- loopDocsAreExecutable.test.ts:279-283 pins the subprocess by source text (`/"worktrees:remove", "--"/`).
- **Fix:** call `claim()` and `removeWorktree()` in-process from the workspace port. Delete the source-text pin and the tab-protocol parsing; the subprocess CLIs stay for by-hand use. **Effort:** S. **Risk:** low. In-process works because the supervisor's cwd is the root and `removeWorktree` refuses only when cwd is inside the target (workspace.mjs:159-161).

### F12. Issue-read trust policy lives in `brief.mjs` and comes in three shapes
- `brief.mjs:45-70` (`TRUSTED_SELECT` jq, `readIssue`, `untrustedRead`, `apiMethod`) is imported by guard-bash.mjs:19 and next-ticket.mjs:3. That is the subagent-prompt module serving as the tracker's policy.
- `trustedComments` (loop-derive.mjs:328-333, `authorAssociation`) and `trusted()` (next-ticket.mjs:9-11, `author_association`) re-express the same rule.
- **Fix:** move these into `github.mjs` (F3); brief imports from there. **Effort:** S.

### F13. The agent-check cache is an implicit file interface and self-reported gate evidence
- The writer is `agent-check.mjs:178-180, 237`; the reader is `loop-gate.mjs:47`, which rebuilds the path `join(gitDir, "agent-check-cache.json")` itself and shares the `{pass, head, clean, deferred}` schema only by convention. loopGate.test.ts:435 writes the file directly.
- `buildPassed` (loop-gate.mjs:36-52) trusts a file the gated session can write with Bash. guard-write blocks only Write/Edit, and guard-bash has no rule for it.
- This is advisory: CI is the real merge gate (`settle` arms only on a green `ci-gate`). Still, by CLAUDE.md's own definition, a check that can be satisfied without the guarded thing being true should be named as advisory or removed.
- **Fix:** `agent-check.mjs` exports `passFor(cwd, head)` so the path and schema have one owner, and document `--build` as advisory. **Effort:** S.

### F14. Guard hooks fail open silently, which makes `onFailure: "block"` dead config
- `guard-write.mjs:41-43` and `guard-agent-model.mjs:66-68` wrap everything in `catch { process.exit(0) }`, which includes `checkoutRoot(cwd)` throwing (cli.mjs:70-71). They print nothing.
- guard-bash.mjs:427-431 also allows on an unreadable payload, but at least prints to stderr.
- loop-settings.json registers these with `"onFailure": "block"`, which can never fire because the scripts never fail.
- **Fix:** let a parse failure exit non-zero (or deny) and keep `exit 0` only for "no file_path"; at least write to stderr as guard-bash does. **Effort:** S. **Risk:** low.

### F15. "The change" is computed five different ways
- `agent-check.mjs:33-51`: `origin/main...HEAD` + tracked status, excluding untracked.
- `related-tests.mjs:60-66`: `origin/main...HEAD` + `HEAD` + untracked included. This runs inside agent-check's `native:related` step, so a scratch file can pick tests while the subject says untracked files are not a change.
- `loop-derive.mjs:473`: `base...HEAD` only.
- `nativeScope.mjs:57` and `ci.yml:118`: two-dot `base HEAD`.
- **Fix:** `changeSet(cwd, {base, untracked})` in one module (cli.mjs or a new `change.mjs`). **Effort:** S.

### F16. Stale premises in prose and config
- loop-settings.json `soft_deny` says "package.json db:reset already bundles --yes". It does not: `db:reset` is `node scripts/reset-db.mjs && drizzle-kit push`, and reset-db refuses without `ALLOW_DESTRUCTIVE=1` and `--yes` (reset-db.mjs:15-40). So `npm run db:reset` can never succeed; it only prints `HOW_TO`.
- cli.mjs:9 (F3) and loop-cost.mjs:15-18 (F6) are also stale.
- **Fix:** correct the text; drop or rename `db:reset` to something like `db:reset:help`. **Effort:** XS.

### F17. Dead or duplicate items
- `scripts/post-merge.sh` has zero references anywhere (a Replit-era post-merge hook; `tests/tooling/noReplitCoupling.test.ts` exists, and replit.md was folded away in commit c8d04d5e). Delete it.
- npm scripts with no references in repo docs or code: `lint:fix`, `expo:dev:clean`, `bake:card-art` (the script itself is used by cardArt.test.ts directly), `loop:cost` (referenced only in an audit doc). These are developer conveniences: keep or drop by taste.
- `brief.mjs:15` `MODEL_BY_KIND` duplicates the `.claude/agents/loop-*.md` frontmatter and exists only so guardAgentModel.test.ts:136 can compare the two. By the deletion test, the frontmatter is the authority. Either delete the constant and assert the policy in the test, or generate one from the other. **Effort:** XS.

### F18. gh/git wrappers outside tools/loop
`scripts/await-run.mjs:15-21`, `tools/ci/await-artifact.mjs:52`, `tools/ci/ios-wall.mjs:57`, `tools/ci/budget-gate.mjs:131-132` (re-states the 64 MB `MAX_BUFFER`), `tools/ci/nativeScope.mjs:54`, `tools/ci/e2e-budget.mjs:17`, `scripts/ios-device.mjs:99-103`.
- cli.test.ts's "no git or gh outside cli.mjs" scan covers only `tools/loop/*` (cli.test.ts:116).
- Each of these already takes an injected function, so leverage is low.
- **Fix:** import `cli.mjs`'s `gh`/`git` (it is deliberately dependency-light, cli.mjs:1-3) and widen the scan. **Effort:** S.

### F19. Four scripts hand-roll the entry-point check
`scripts/e2eBuildMark.mjs:33`, `scripts/mockupParityPage.mjs:162`, `scripts/ios-device.mjs:436` and `scripts/measureHeadsUpBalance.ts:556-557` compare unresolved paths. `scripts/lib/entry.mjs` (37 adopters) exists because that comparison breaks under junctions and subst drives. **Fix:** use `isInvokedDirectly`. **Effort:** XS.

### F20. The e2e port literal is in four places, and the process-table module sits in the loop
- `5199` appears at tools/ci/e2ePort.mjs:17 (`BASE_PORT`), scripts/e2e-server.mjs:32, tools/loop/reap.mjs:14 and tests/e2e/playwright.config.ts:25.
- reap clears only `E2E_PORT ?? 5199`, while `chooseE2ePort` may hand out 5199-5218 (e2ePort.mjs:18, 32-49).
- `tools/ci/e2ePort.mjs:15` imports `clearPort`/`portListeners`/`staleAmong` from `tools/loop/reap.mjs`, a CI and e2e dependency on the loop package. ci.yml:145-149 has to special-case this when scoping.
- **Fix:** export `BASE_PORT` once and import it everywhere. Move the process-table and port functions to `scripts/lib/processes.mjs`, shared by reap and e2ePort. **Effort:** S.

### F21. Minor shallow items
- Three trimmed-git micro-wrappers: `loop-derive.mjs:18`, `loop-gate.mjs:31-33`, `brief.mjs:25-31` (plus `agent-check.mjs:174-176`). `cli.mjs` could offer `git(cwd).lines(args)`/`.text(args)`.
- `scripts/dev-stack.mjs:95` spawns a node process to sleep (`execFileSync(process.execPath, ["-e", "setTimeout…"])`); `Atomics.wait` is in-process.
- `next-ticket.mjs:176-180` keeps a module-level mutable `openPrs` cache reset by `nextPick` (229). It disappears into the `github.prs()` call of F3.

---

## Already deep: leave alone
- **`decide.mjs` `decide()`**: one function, a step table, pure, with caps and tallies layered as `tallied(capped(STEPS[step]))`. Only trim its exports (F10).
- **`settle.mjs`**: `startSettle`/`stepSettle`/`endSettle`/`rested` form a pure state machine; `runSettle` is the executor with `io` overrides; settleReplay.test.ts replays recorded rollups. Model the other modules on this shape.
- **`loop-stream.mjs` `reduceSession`**: a pure reducer over stream-json events. **`loop-session.mjs` `runSession`**: a small interface over spawn plus watchdog. Only the tree-kill moves (F5).
- **`shell.mjs` `commands()`/`withoutQuotedBodies`/`loopBodies`**: one parser with a lot behind it, shared by guard-bash and the stream reader.
- **`guard-bash.mjs` `check(command, repo, loop, session)`**: a data-driven rule table behind one call. Only the env reads change (F4).
- **`tracker.mjs`**: a real seam with two adapters (`ghTracker`, `fakeTracker`) sharing the `TRANSITIONS` table. It is the template for F3.
- **`cli.mjs`**: the one place git and gh are started in the loop, enforced by cli.test.ts. Keep it and fold F5 and F18 into it.
- **`land.ts` (`landing`, `armArgs`/`disarmArgs`), `ciVerdict.ts` (`readLandingState(repo, pr)`), `mainHealth.ts` (`mainFailures(gh, repo)`)**: small interfaces with heavy logic behind them.
- **`check-steps.mjs`**: one table naming where each check runs, pinned to ci.yml by agentCheckDelegation.test.ts.
- **`next-ticket.mjs`**: `classify(openIssues, io)` and `pickRoute(buckets, take)` are injectable and mostly pure.
- **`loop-logs.mjs`**: `ARTEFACTS`, `ledger(io)`, `ticketTally`. One owner for the record's paths and schema.
- **tools/ci and scripts with injected I/O**: `e2ePort.chooseE2ePort`, `scripts/devStackPort.mjs` + `dockerEngine.mjs`, `budget-gate.mjs` (injected `gh`), `await-run.awaitRuns` (injected `view`/`pause`/`now`), `preflightMemory.mjs` (injected env).
- **`scripts/lib/entry.mjs`**: one answer to "was I run directly", with 37 adopters.

## Suggested order
1. F6 and F10: cheap, they unblock the rest, and they cut test coupling.
2. F3: the GitHub adapter and its single fake.
3. F1: split the adapters out of queue-loop, with F7 and F11 folded in.
4. F2: `phaseOf` plus routing into `decide`.
5. F4: the session-env module.
6. F5: the process module.
7. F8 and F9: CI work, independent of the loop and safe to run in parallel.
8. The remaining P3 items as small batches.
