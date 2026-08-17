# Murlan Audit Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan batch-by-batch. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate 122 audited findings in 14 independently shippable batches, without
breaking the Replit deployment at any point.

**Architecture:** One branch per batch, one commit per finding. Batches are ordered so that
each batch's acceptance criteria are *verifiable when you reach it* — Batch 1 exists solely to
restore CI's ability to fail, because today it cannot, and every later batch's "a test proves
it" is otherwise meaningless. Batches 2–5 fix correctness and safety; 6–11 fix experience;
12–14 fix the structural causes.

**Tech Stack:** Expo SDK 54 / React 19.1 / React Native 0.81.5 as web · expo-router 6 ·
Express 5 + socket.io 4.8.3 · PostgreSQL via drizzle-orm 0.39 · TypeScript 5.9 ·
`node --test` with native TS type-stripping · jest-expo · Playwright · Replit Cloud Run.

**Spec:** `audit/2026-08-17/BACKLOG.md` (the ordered finding list),
`audit/2026-08-17/SUMMARY.md` (why this order), `audit/2026-08-17/CONFLICTS.md` (ordering
hazards — **read before Batch 3 and Batch 13**), `audit/2026-08-17/findings/*.md` (the full
schema entry for every finding, including Proposed fix and Acceptance criteria).

**You are expected to read the finding entry before implementing it.** This plan gives you the
batch: which findings, in what order, which files, which tests, how to verify, how to roll
back. The *fix* is specified in the finding entry, which names files and approach concretely.
Do not improvise a fix without reading it.

---

## Global Constraints

Copied verbatim from `CLAUDE.md`. Every task's requirements implicitly include this section.

- **The app must remain fully functional on Replit at all times.** Port comes from
  `process.env.PORT`. Database from `process.env.DATABASE_URL`. `DATABASE_URL`,
  `SESSION_SECRET`, `PORT` must always be set in Replit Secrets. No build step that requires
  local tooling unavailable on Replit (e.g. native compilation). The app must be launchable
  from Replit's Run button without extra setup.
- **Schema is created at boot** by `server/schemaDdl.ts` from `shared/schema.ts`. Every
  statement it emits must be additive and idempotent — pinned by `tests/schemaDdl.test.ts`.
  No manual `db:push` in any deploy path.
- **The `session` table**: `createTableIfMissing: false`, deliberately absent from
  `shared/schema.ts`, excluded from drizzle-kit by `drizzle.config.ts` `tablesFilter`. Clear
  its rows, never drop it while the server is running.
- **Game rules** live in `lib/gameEngine.ts` and are specified by `docs/RULES.md`. Change them
  only via a decision recorded in `docs/BRIEF.md` §3.1.
- **Ticket auth only** — the socket handshake accepts a live session or a single-use ticket.
  Never add a `handshake.auth.userId` branch; that was a full impersonation vector.
- **Listener registration precedes every `await`** in the socket connection handler.
- **No hardcoded colours, spacing, radii, font sizes or animation timings** — everything from
  `lib/theme.ts`. A component-local one-off may be a named module constant; a bare literal in
  a style object may not.
- **Every user-facing string goes through `t()`** with keys in all three locales
  (`locales/it.ts` is the source of truth, then `en.ts`, `sq.ts`). Pinned by
  `tests/i18n.test.ts`.
- **Comment the code as it is.** No changelogs in code — never write what the code used to be,
  what was wrong with it, or when it was fixed. Git has that.
- **No self-defeating safeguards.** If you write a guard, do not also ship the thing that gets
  past it. The tell is the justifying comment. **This plan fixes three instances of exactly
  that; do not add a fourth.**
- **The database is not precious.** There are no real users. Dropping and recreating a table
  to reach a clean shape is preferred over accreting compatibility.

### Verification commands (exact)

| Command | What it runs | Gates |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | Yes (CI) |
| `npm test` | `node --test "tests/**/*.test.ts"` — 672 tests | Yes (CI, **after Batch 1**) |
| `npm run test:native` | `jest`, 18 suites / 230 tests | **After Batch 1** |
| `npm run lint` | `expo lint` | Yes (CI) |
| `npm run verify` | typecheck + test + test:native — **not lint, not e2e** | — |
| `npm run test:e2e` | Playwright, needs a built bundle + Postgres | No |

**The 11 integration suites in `tests/integration/` self-skip without `DATABASE_URL`.** Any
acceptance criterion that says "integration test" requires a live Postgres. Set
`DATABASE_URL` locally or rely on CI, which provides a Postgres 16 service.

### Branch, commit, push and rollback convention

```bash
git checkout main && git pull
git checkout -b audit/batch-NN-<slug>
# one commit per finding: "fix(SEC-02): score an abandoned hand"
git push -u origin audit/batch-NN-<slug>
gh pr create --base main --title "Batch NN: <theme>" --body "<IDs fixed, verification output, deferrals>"
gh pr checks --watch
gh pr merge --merge --delete-branch     # only when green — see the gate below
```

**Every completed batch is committed, pushed, opened as a PR, and merged by the batch author
once CI is green.** One commit per finding, one branch per batch, one PR per branch. Never
force-push and never `--no-verify` — if a hook fails, fix what it is complaining about.

**`--merge`, never `--squash`.** The rollback story below depends on the per-finding commits
reaching `main`. Squashing collapses them and makes `git revert <finding-sha>` impossible,
which silently removes the ability to back out one finding without backing out the batch.

**The merge gate — all four, or stop and ask:** every CI check completed and green (pending is
not green); nothing deferred; every acceptance criterion actually verified rather than assumed;
nothing changed outside the batch's declared scope.

**Merging does not deploy.** `.replit` defines the build and run commands, but there is no
GitHub-side deploy job — Replit Cloud Run is triggered from its own UI. So a merged batch
reaches `main` and waits there for a human to deploy it. That is what makes auto-merge on green
a reasonable default rather than a risky one.

Push at the end of the batch, except where a finding requires it earlier — `TEST-01` in Batch 1
can only be verified on a GitHub runner, so that batch pushes mid-flight to confirm CI goes red
and then pushes again at the end.

**Rollback story, identical for every batch:** each batch is one branch merged as one merge
commit. To undo a whole batch: `git revert -m 1 <merge-sha>`. To undo one finding inside a
merged batch: `git revert <commit-sha>` — this is why the one-commit-per-finding rule matters.
No batch in this plan requires a data migration, so no rollback needs a database step. The two
that touch persisted shapes (ARCH-06, RULE-03) are called out with their own rollback notes.

---

# Batch 1 — Restore the safety net

**Why first:** `.github/workflows/ci.yml:62` pipes `npm test` into `tee`. GitHub Actions' default
shell is `bash -e {0}` — `errexit` without `pipefail` — so the step reports `tee`'s exit code.
**No test failure in this repository can currently turn CI red.** Every later batch's acceptance
criteria assume a test can gate. This batch makes that true.

**Findings:** TEST-01, TEST-03, TEST-04, TEST-14, TEST-09, TEST-17
**Order:** TEST-01 → TEST-03 → TEST-04 → TEST-14 → TEST-09 → TEST-17
(TEST-04 depends on TEST-03; TEST-14 depends on TEST-01.)

**Files touched:** `.github/workflows/ci.yml`, `package.json`, `package-lock.json`,
`tests/serverLoadable.test.ts`, `docs/TESTING.md`

---

### Task 1: Make CI's test step able to fail (TEST-01)

**Files:**
- Modify: `.github/workflows/ci.yml:61-62`

**Interfaces:**
- Produces: a CI test step whose exit code is `npm test`'s. Every later batch depends on this.

- [ ] **Step 1: Reproduce the defect locally, so you know the fix works**

```bash
bash -e -c 'false | tee /tmp/out.txt; echo "exit=$?"'
```
Expected output: `exit=0` — the failure is swallowed. This is exactly what CI does today.

- [ ] **Step 2: Confirm the fix in the same shell**

```bash
bash -e -c 'set -o pipefail; false | tee /tmp/out.txt; echo "exit=$?"'
```
Expected output: `exit=1`.

- [ ] **Step 3: Apply it to the workflow**

Replace `.github/workflows/ci.yml:61-62` with:

```yaml
      - name: Test
        shell: bash
        run: |
          set -o pipefail
          npm test | tee test-output.txt
```

`shell: bash` is required: the default `bash -e {0}` does not read `set -o pipefail` from a
one-line `run:`, and being explicit documents why the line exists.

- [ ] **Step 4: Prove the guard now guards — temporarily break a test**

```bash
git stash list  # note the depth so you can find your way back
```
Add a deliberately failing assertion to `tests/smoke.test.ts`:

```ts
test("TEMPORARY — delete before commit", () => {
  assert.equal(1, 2);
});
```

Push the branch. **Confirm the CI job goes red.** This is the only way to verify this fix —
a local run cannot exercise GitHub's shell wrapper.

- [ ] **Step 5: Remove the temporary failure and confirm green**

Delete the temporary test. Push. Confirm the job goes green.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "fix(TEST-01): make CI's test step able to fail

The pipe into tee discarded npm test's exit code, so no test failure
could turn the job red. set -o pipefail restores it."
```

---

### Task 2: Declare esbuild (TEST-03)

**Files:**
- Modify: `package.json` (devDependencies), `package-lock.json`

**Interfaces:**
- Produces: a pinned, declared `esbuild` that `server:build` resolves to. TEST-04 needs this
  before it can meaningfully run the build in CI.

- [ ] **Step 1: Confirm the defect**

```bash
grep -n '"esbuild"' package.json; node -e "console.log(require('esbuild/package.json').version)"
```
Expected: no match in `package.json` (it appears only inside the `server:build` command
string at `:12`), and a version around `0.18.20` — a 2023 build arriving transitively through
`drizzle-kit` → `@esbuild-kit/*`. The production server bundle is built by an undeclared,
dev-only transitive.

- [ ] **Step 2: Add it as a devDependency**

```bash
npm install --save-dev --save-exact esbuild@0.25.10
```

Exact-pin rather than caret: this tool builds the production server bundle, and
`package.json` already exact-pins the packages whose version must not float.

- [ ] **Step 3: Verify the build command still works**

```bash
npm run server:build && ls -la server_dist/
```
Expected: `server_dist/index.js` exists. **Then delete it** — `server_dist/` is gitignored, but
leaving a stale bundle around confuses later manual testing:
```bash
rm -rf server_dist
```

- [ ] **Step 4: Typecheck and test**

```bash
npm run typecheck && npm test
```
Expected: 0 errors; 670 pass / 2 skipped (11 integration suites skip without `DATABASE_URL`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix(TEST-03): declare esbuild instead of relying on a dev-only transitive"
```

---

### Task 3: Exercise the production build in CI (TEST-04)

**Files:**
- Modify: `.github/workflows/ci.yml` (add a step after Lint)

- [ ] **Step 1: Add the build step**

Append to `.github/workflows/ci.yml` after the Lint step:

```yaml
      - name: Build (the chain Replit runs on deploy)
        run: npm run expo:web:build && npm run server:build
```

`expo:static:build` is deliberately omitted — it runs `scripts/build.js`, which starts a Metro
server and is slow and flaky on a runner. TEST-05 and TEST-06 harden that script separately in
Batch 12; add it to CI there, not here.

- [ ] **Step 2: Push and confirm the job passes with the build step**

If the build fails, **that is the finding doing its job** — CI has never run it. Fix the build
break before proceeding, and record what it was in the commit message.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "fix(TEST-04): run the production build chain in CI"
```

---

### Task 4: Run the native suite in CI (TEST-14)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Confirm it passes locally**

```bash
npm run test:native
```
Expected: 18 suites, 230 tests, all pass, ~21s.

- [ ] **Step 2: Add the step after Test**

```yaml
      - name: Native tests
        run: npm run test:native
```

- [ ] **Step 3: Push, confirm green, commit**

```bash
git add .github/workflows/ci.yml
git commit -m "fix(TEST-14): gate merges on the 230 native tests"
```

---

### Task 5: Complete the server-loadable test (TEST-09)

**Files:**
- Modify: `tests/serverLoadable.test.ts:4-9`

- [ ] **Step 1: Read the finding**

`findings/10-testing-build.md`, TEST-09. The test checks 11 of 21 server modules while its
name claims to check every one. Notably absent: `socket.ts`, `routes.ts`, `testApp.ts`,
`schemaDdl.ts`, `stats.ts`, `ratings.ts`, `replays.ts`, `push.ts`.

- [ ] **Step 2: Enumerate the real list**

```bash
ls server/*.ts | sed 's|server/||;s|\.ts$||'
```

- [ ] **Step 3: Add each missing module to the test's list and run it**

```bash
node --test tests/serverLoadable.test.ts
```

**Expect some to fail.** A module that cannot be imported under plain Node type-stripping is a
real finding — it is the same property that makes `server/socket.ts` untestable (ARCH-04,
TEST-11). If a module fails to load, **do not force it in**: add it to an explicit,
commented exclusion list naming why, and leave the rest asserted. An honest list of 18 with 3
named exclusions is worth more than a list of 11 that claims to be complete.

- [ ] **Step 4: Commit**

```bash
git add tests/serverLoadable.test.ts
git commit -m "fix(TEST-09): assert every server module loads, or name why it cannot"
```

---

### Task 6: Correct the test counts in the docs (TEST-17)

**Files:**
- Modify: `docs/TESTING.md:9,11`

- [ ] **Step 1: Get the real numbers**

```bash
npm test 2>&1 | tail -20
npm run test:native 2>&1 | tail -10
```
Recorded at audit time: **670 pass / 2 skipped of 672** node tests; **230** native tests in
**18** suites. The doc says 664 and 228.

- [ ] **Step 2: Update both lines, run lint, commit**

```bash
npm run lint
git add docs/TESTING.md
git commit -m "docs(TEST-17): correct the test counts"
```

---

### Batch 1 verification

```bash
npm run verify && npm run lint
```
Expected: typecheck 0 errors · 670/672 node tests · 230/230 native tests · lint 0 problems.

**Plus the only verification that matters for TEST-01:** push a deliberately failing test and
confirm CI goes red, then remove it. A green CI proves nothing here — that was the bug.

**Rollback:** `git revert -m 1 <merge-sha>`. No runtime code changed; reverting restores the
previous CI configuration and removes the `esbuild` devDependency. Replit is unaffected either
way — it runs the build chain from `.replit`, not from CI.

---

# Batch 2 — Server operational integrity

**Findings:** RES-02 *(Critical)*, SEC-04, RES-06, RES-05, RES-08, RES-11, RES-10
**Order:** **RES-02 first** — RES-10 adds a new structured log line and must land on an
already-redacted logger. The rest are independent.

**Files touched:** `server/logger.ts`, `server/testApp.ts`, `server/routes.ts`,
`server/db.ts`, `server/index.ts`, `server/socket.ts`

**Tests to add or update:**
- **RES-02:** a test asserting a log line produced for a request carrying a `cookie` header
  contains neither the cookie value nor `murlan.sid=`. Put it in
  `tests/integration/clientErrors.test.ts` (which already boots the app) or a new
  `tests/logRedaction.test.ts` if you can construct the logger in isolation — prefer the
  latter, it runs without a database.
- **SEC-04:** new case in `tests/integration/auth.test.ts` — capture `set-cookie` from a first
  authenticated request, log in on the same cookie, assert the returned `connect.sid` differs.
- **RES-05/RES-06/RES-08:** these are startup/shutdown paths.
  `tests/integration/testServerCleanup.test.ts` is the closest existing harness; extend it.

**Verification:** `npm run verify && npm run lint`, plus the integration suites against a live
Postgres — `DATABASE_URL=... npm test` and confirm **no** `DATABASE_URL not set` line in the
output.

**Rollback:** `git revert -m 1 <merge-sha>`. All changes are additive middleware/handlers; no
persisted shape changes.

**Replit note:** RES-08 changes a failed boot from "contained" to a non-zero exit. That is the
intent — Cloud Run should see a failed container rather than serve a half-built app — but
**confirm the happy path still boots** before merging, because a boot regression here takes
the site down rather than degrading it.

---

# Batch 3 — The match lifecycle

> **Read `CONFLICTS.md` C5 and C6 before starting. There are two hazards in this batch that
> will cost you a debugging session if you meet them cold.**

**Why this batch is the audit's core:** `handleGameOver` sets `room.status = "finished"` after
**every manche** (`server/socket.ts:841`), so `"finished"` means both "between hands of a live
partita" and "this room is over". Five handlers branch on that flag and no two agree. All four
findings below are symptoms of that one overload.

**Findings:** SEC-02 *(Critical)*, SEC-01 *(Critical)*, NET-01, RULE-01, RULE-02, ARCH-07,
**UX-13** *(created by decision D3)*

> **The owner decisions this batch needed are ANSWERED.** Read
> `audit/2026-08-17/DECISIONS.md` — D1, D2, D3 and D4. Do not ask; they are settled and each
> one names exactly what to implement. **Nothing in this batch is blocked.**

**Order — this one matters:**
1. **Write the design doc first**, from `DECISIONS.md` D1 and D4 — they give you the rule, so
   the doc is a *how*, not a *whether*. `CLAUDE.md`'s standing agreement mandates a written
   design for anything touching storage or the socket protocol. Save to
   `docs/superpowers/plans/2026-08-17-match-lifecycle.md`.
2. **RULE-02 first among the code changes, and this ordering is load-bearing.** Implement its
   option (b): vacated and bot seats **abstain** — excluded from both `yes` and `total` in
   `countRematchAnswers`, so the verdict is the connected humans' majority. D4's new-match
   consent gate deadlocks without it, exactly the way NET-01's gate deadlocks today.
3. NET-01 (unblocks the deadlock; must precede ARCH-07 and ARCH-08)
4. **UX-13** — the persistent bot-seat marker D3 requires. Do it with NET-01; same code path,
   and NET-01 is what makes the takeover reachable from the results screen.
5. RULE-01 (the rematch roster — implement as written; D2 settles that a solo+bots table is a
   full match)
6. SEC-01 (the `room:start` scope guard — **two rules now**, see D4: refuse outright while
   `matchOver === false`; require the unanimous gate when `matchOver === true`)
7. SEC-02 (the largest; D1 gives you the rule — last-place finish, in-memory `abandonedSeats`,
   no `GAME_SCHEMA_VERSION` bump)
8. ARCH-07 (fold the two leave functions — **after** NET-01, same code)
9. **Copy D1 and D4 into `docs/BRIEF.md` §3.1** — `CLAUDE.md` requires rule decisions to live
   there, and this batch is where they become real.

**Hazard 1 — two events one letter apart.** `game:player_left` (`server/socket.ts:667`, `:681`)
is **kept**; NET-01's fix makes it fire in a new situation. `room:player_left` (`:2224`) is
**deleted** by ARCH-08 in Batch 13. Do not confuse them.

**Hazard 2 — NET-01's fix changes what players see.** Routing the results-screen leave through
`vacateSeat` fires `game:player_left`, which drives the client's blocking "Partita interrotta"
teardown (`context/OnlineGameContext.tsx:368`, `app/(online)/game.tsx:137-154`). The remaining
players should see an **updated vote tally**, not a teardown alert. **Adjust the emit at
`server/socket.ts:667` — do not change the client.**

**Files touched:** `server/socket.ts` (`:643-709`, `:732-945`, `:961-974`, `:1293-1387`,
`:1546-1596`, `:2153-2232`), `server/stats.ts:57-148`, `server/ratings.ts:84-116`,
`server/onlineGameLogic.ts:78-87`, `lib/achievements.ts`, `locales/{it,en,sq}.ts`

**Tests to add or update** — all integration, all need Postgres:
- `tests/integration/gameplay.test.ts`: three clients play a manche to `game:over`, one emits
  `room:leave`, the other two emit `game:rematch_vote` and **both receive `game:started`**
  (NET-01). A second case: `room:start { fillWithBots: true }` with one human reaches manche 2
  with the same seat count and its bot seats still AI-driven (RULE-01). A third: the host
  emitting `room:start { matchLength: "single" }` between manches gets `room:error` and the
  state is unchanged (SEC-01).
- `tests/integration/ladderAndReplay.test.ts`: two players, one disconnects mid-hand; after the
  grace **both** have a `user_ratings` row, the quitter's delta negative (SEC-02).
- `tests/integration/stats.test.ts`: four players, one leaves mid-hand; the leaver has a
  `match_history` row with `placement = 4` and no achievement unlocked (SEC-02).
- **New unit test** via `__testables` (`server/socket.ts:212-235` already exposes five
  functions this way): `countRematchAnswers` with `playerMap = {0: "u1"}`, four seats,
  `cumulativeScores = {u1: 7}`, `rematchIntents = {u1: true}` → `tableWantsRematch` is **true**
  (RULE-02).
- `tests/rating.test.ts` must pass **unchanged** — SEC-02 changes *who* is fed into the
  arithmetic, never the arithmetic.
- **New, from D4:** an integration case where a match has ended (`matchOver === true`) and the
  host emits `room:start` — assert it does **not** start until every connected seated human has
  readied, and that a table with one vacated seat still reaches the new match (proving RULE-02's
  abstain rule composes with the gate rather than deadlocking it).
- **New, from D3 (UX-13):** a native test asserting a seat whose player left renders a
  persistent bot marker for the rest of the match, not only during the 4-second banner.

**Verification:**
```bash
npm run verify && npm run lint
DATABASE_URL=<live> npm test   # and confirm no "DATABASE_URL not set" in the output
npm run test:e2e               # online.spec.ts and reconnect.spec.ts exercise this batch
```

**Rollback:** `git revert -m 1 <merge-sha>`. SEC-02 adds an `abandonedSeats` map to the
in-memory `OnlineGameState` — **in memory only**, so a revert loses nothing persisted. If you
choose to persist it into the `game_state` envelope instead, that changes a persisted shape and
you must bump `GAME_SCHEMA_VERSION` (`server/onlineGameLogic.ts:156`), which disposes every
live game on the next rejoin. Prefer the in-memory form for exactly this reason.

---

# Batch 4 — Reconnect and error surfacing

**Findings:** RES-01, RES-03, NET-03, NET-07 *(merged with ARCH-05)*, NET-08, NET-04, RES-07,
ARCH-01, **RES-12**
**Order:** RES-01 → NET-08 → NET-07 → ARCH-01 → NET-04 → RES-12 → RES-03 → NET-03 → RES-07
(NET-07 depends on NET-08 — same handler; fix the inverted guard before adding messaging to it.)

**RES-12 (Appendix A):** `lib/socket.ts:58-62` already gives socket.io `reconnection: true`,
`reconnectionAttempts: Infinity`, `reconnectionDelay: 1000`, `reconnectionDelayMax: 5000`, and
`context/SocketContext.tsx:126-135` adds a **second** exponential backoff that calls
`socket.connect()` on `connect_error`. Two reconnect loops race on one socket. Delete the manual
loop; if the library's curve is wrong, change its options rather than adding a competing timer.
Do this **before** NET-03, which adds room-level reconnect behaviour on top of the same path.

**Files touched:** `app/_layout.tsx:78-98`, `components/ErrorFallback.tsx`,
`context/OnlineGameContext.tsx:414-434`, `context/AuthContext.tsx:26-42`,
`server/socket.ts:1601-1748`, `:1868`, `app/(online)/room.tsx`, `locales/{it,en,sq}.ts`

**Start with RES-01** — it is S, and until it lands **every render crash is a blank screen**.
`<ErrorBoundary>` at `app/_layout.tsx:79` sits *outside* `<SafeAreaProvider>` at `:82`, while
`components/ErrorFallback.tsx:26` calls `useSafeAreaInsets()`. The fallback throws when it
renders, with nothing above to catch it. Fix by moving `SafeAreaProvider` outside the boundary,
or by removing the hook from the fallback. Moving the provider is smaller and keeps the
fallback's layout correct.

**Tests to add or update:**
- **RES-01:** a native test (`tests/native/`) rendering `ErrorBoundary` around a throwing child
  and asserting the fallback's recovery control is present. A4 already proved the defect this
  way under `jest-expo/ios` — reuse its shape.
- **NET-07:** each of the five `game:rejoin_failed` codes renders a distinct localised message
  in all three locales; `SERVER_ERROR` does **not** clear `ACTIVE_ROOM_KEY` on first occurrence.
  `tests/i18n.test.ts` must still pass with the five new keys.
- **NET-08:** a handler-level test — with a rejoin outstanding for R1, delivering
  `game:rejoin_failed { roomCode: "R1" }` after a `room:state` for R2 leaves `room` set to R2
  and `rejoinFailed` false.
- **NET-04:** integration with `MURLAN_AFK_TIMEOUT_MS` shortened — a seated client emitting
  `game:rejoin` on a loop faster than the AFK window is **still** auto-passed within roughly one
  window.
- **NET-03:** integration — B joins a room, disconnects, reconnects, and recovers the room via
  `room:state` without re-entering the code.

**Verification:** `npm run verify && npm run lint`, integration with `DATABASE_URL`,
plus `npm run test:e2e -- reconnect.spec.ts`.

**Rollback:** `git revert -m 1 <merge-sha>`. NET-03 adds a new inbound socket event
(`room:rejoin`) — reverting removes it; no client depends on it until this batch merges, and
`tests/socketEvents.test.ts` pins the inbound set, so update that test in the same commit.

---

# Batch 5 — Robustness and session safety

**Findings:** RES-04, NET-06, SEC-05, SEC-03, NET-05, RES-09
**Order:** RES-04 → NET-05 → RES-09 → SEC-05 → SEC-03 → NET-06
(RES-09 depends on NET-05 — same flag. NET-06 last: it changes a data structure every
server→client push resolves through, so land it when the rest of the batch is stable.)

**RES-04 is the High.** The bot timer callback (`server/socket.ts:539-542`) and
`handleAutoPass`/`runBotTurn` (`:552-610`) have **no try/catch**, unlike every socket event,
which `onEvent` wraps. A throw inside a timer callback propagates to `uncaughtException`;
`installProcessGuards` keeps the process alive, but the timer has already been deleted from
`botTimers` and nothing re-arms it. **The table freezes forever.** Fix: wrap both callbacks,
log with the room id, and re-arm.

**NET-06 is decided — see `DECISIONS.md` D5. Single-session, evict the older tab visibly.**
`userSocketMap` keeps its `Map<userId, socketId>` shape; no structural change. Two things D5
calls out that will bite if you skip them: the existing guards at `server/socket.ts:1904` and
`:1919` already compose correctly with eviction — verify, do not rewrite them — and **the
evicted client must stop reconnecting on the new error code**, because
`lib/socket.ts:60` sets `reconnectionAttempts: Infinity` and two tabs will otherwise evict each
other forever.

**Files touched:** `server/socket.ts` (`:131`, `:388-400`, `:538-610`, `:1030-1049`,
`:1904-1919`), `server/routes.ts:211-222`, `context/OnlineGameContext.tsx:500-517`,
`app/(online)/index.tsx:73-80`

**Tests:** integration — a throwing bot turn does not freeze the room (RES-04); the 61st
connection by one account in a minute is rejected while another account succeeds (SEC-05);
three players in a live hand, one calls `DELETE /api/users/me`, the other two still get
`user_stats` and `match_history` rows (SEC-03); after a failed `spectateRoom`, `leaveRoom()`
emits `room:leave` not `room:unspectate` (NET-05).

**Verification / rollback:** as Batch 4.

---

# Batch 6 — Bytes on the wire

**Findings:** PERF-01, PERF-09, PERF-02, PERF-04, PERF-08, PERF-10
**Order:** PERF-01 → PERF-09 (same file, same edit session) → PERF-04 → PERF-10 → PERF-02 → PERF-08

**PERF-01 is the single largest user-visible win in the audit and is effort S.** There is no
compression middleware anywhere in `server/`, and `compression` is not a dependency — verified.
The Expo web bundle ships raw.

```bash
npm install --save compression
npm install --save-dev @types/compression
```
Mount it in `server/testApp.ts` **before** the static handler at `:116-127`.

**PERF-02 needs a judgement call, not just a fix.** `app/_layout.tsx:55-63` loads seven fonts
and `:76` returns `null` until all of them resolve — 2.36 MB of TTF before first paint. B1
found one of the seven is referenced by zero styles. Steps: grep each family/weight across
`app/`, `components/` and `lib/tokens.ts`; delete the unused one; then either drop the render
gate (accept a font swap) or preload only the two families the first screen needs.

**Files touched:** `server/testApp.ts:116-127`, `package.json`, `app/_layout.tsx:55-76`,
23 files importing from `@expo/vector-icons`, `lib/sounds.ts:99-112`,
`scripts/build-sounds.mjs`, `docs/BUNDLE.md`

**Tests:** `npm run test:native` covers `lib/sounds.ts` (12 cases —
`tests/native/sounds.test.tsx`); `tests/soundAssets.test.ts` asserts the sound files exist and
have the expected shape and **will need updating** when PERF-08 changes the format. No test
exists for compression; add a small integration case asserting `Content-Encoding: gzip` on a
`GET /` with `Accept-Encoding: gzip`.

**Verification:**
```bash
npm run verify && npm run lint
npm run expo:web:build && node scripts/bundle-report.mjs   # before/after byte counts
```
Record the before/after numbers in the commit message — this batch is the one where a measured
result is the acceptance criterion.

**Rollback:** `git revert -m 1 <merge-sha>`. PERF-08 changes files in `assets/sounds/`, which
are build products of `scripts/build-sounds.mjs` — regenerate rather than hand-restore.

---

# Batch 7 — Render hot path

**Findings:** PERF-03, PERF-05, PERF-06, PERF-07
**Order:** PERF-03 → PERF-05 (depends: same components) → PERF-06 → PERF-07

**PERF-03 is measured, not guessed.** B1 compiled the repo with its own compiler options: 40
components bail out of the React Compiler, and **45 of 72 bailout events are caused by
`eslint-disable react-hooks` comments**. With no `React.memo` anywhere, `StraightHand`'s
compiled guard on `onPress` — a fresh arrow from the uncompiled `GameTable:809` — misses on
every render, rebuilding all 14–27 cards 3–5× per move.

Approach: remove the six suppressions in `GameTable.tsx` (`:646, :665, :717, :731, :742, :754`)
and the two in `CardView.tsx` (`:493, :501`) by fixing the underlying hook dependencies, then
add `React.memo` to the card components. **Do not silence the lint rule again** — that is what
caused this.

**Files touched:** `components/GameTable.tsx`, `components/GameShared.tsx`,
`components/CardView.tsx`, `app/(online)/game.tsx`, `app/game.tsx`,
`context/OnlineGameContext.tsx:603-643`, `server/replays.ts`, `shared/schema.ts:121-131`

**Tests:** `tests/gameTableModel.test.ts` (62 cases) and `npm run test:native` are the
regression net — the pure layout half must not move. PERF-07 adds an index to
`match_replays`; `tests/schemaDdl.test.ts` must still pass (every statement additive and
idempotent).

**Verification:** `npm run verify && npm run lint && npm run test:e2e -- tableFit.spec.ts`

**Rollback:** `git revert -m 1 <merge-sha>`. PERF-07's index is additive; a revert leaves it in
place harmlessly, or drop it by hand.

---

# Batch 8 — Game feel

**Findings:** UX-01, UX-02, UX-03, UX-04, UX-05, UX-06, UX-11, UX-09, UX-07, UX-10, UX-08
**Order:** UX-03 → UX-04 → UX-05 (a chain on the same round-transition code) → UX-01 → UX-10
(depends on UX-01) → UX-06 → UX-11 (depends on UX-06) → UX-09 → UX-07 (depends on UX-09) →
UX-02 → UX-08

**Start with UX-03 — one line, and the game has never played its win or lose sound.**
`components/GameTable.tsx:688` looks up `viewer.name` (a username) in `gameState.rankings`,
which `lib/gameEngine.ts:750` fills with engine ids (`player_0`). Map the seat to its engine id
before the lookup. The same commit must move `hapticSuccess()` at `:687` inside the win branch —
it currently fires unconditionally, so the **loser** gets a success haptic.

**UX-02 is the other High and the larger job:** a pass is invisible. `gameState.passCount`
appears in the table only as part of a cache-key string at `:845`; there is no per-seat pass
tag, no count, no animation. In Murlan roughly half of all actions are passes.

**Files touched:** `components/GameTable.tsx`, `components/GameShared.tsx`,
`components/gameTableModel.ts:173-184`, `components/NotificationBanner.tsx`,
`app/_layout.tsx:37-51`, `app/game.tsx`, `app/index.tsx:302-309`, `app/tutorial.tsx:420-449`,
`context/GameContext.tsx`, `lib/haptics.ts`, `locales/{it,en,sq}.ts`

**Tests:** `tests/motion.test.ts` (no spring written inline; every spring settles) and
`tests/soundAssets.test.ts` are the existing net. Add: a native test asserting the win sting
fires for the seat that placed first and the lose sting for last (UX-03); a
`gameTableModel.test.ts` case pinning that the rejection label distinguishes "too low" from
other rejection reasons (UX-06). `tests/i18n.test.ts` must pass with every new key in all three
locales.

**Verification:** `npm run verify && npm run lint && npm run test:e2e`

**Rollback:** `git revert -m 1 <merge-sha>`. Presentation only; nothing persisted.

---

# Batch 9 — Accessibility

**Findings:** A11Y-01, A11Y-02, A11Y-03, A11Y-04, A11Y-05, A11Y-06, A11Y-07, A11Y-08, A11Y-09,
A11Y-13, A11Y-10, A11Y-12, **A11Y-14**
**Order:** A11Y-03 → A11Y-04 (depends) → A11Y-01 → A11Y-02 → A11Y-14 → A11Y-05 → A11Y-06 →
A11Y-07 → A11Y-09 → A11Y-08 → A11Y-13 → A11Y-10 → A11Y-12

**A11Y-14 (Appendix A):** `components/NotificationBanner.tsx:116` is a
`<Pressable accessibilityRole="alert">` **containing** a `<Pressable accessibilityRole="button">`
at `:135`. The outer one is focusable and interactive, so it can swallow taps meant for the
close button, and a focusable element inside a live region is invalid. Make the outer element a
plain `View`. Do it alongside A11Y-02, which is the same class of problem on the game overlays.

**A11Y-01 has a trap in it.** `describeTableForA11y` — 95 lines, 11 tests, three locales — is
attached at `components/GameTable.tsx:932` to a `<View>` with no `accessible` and no role, so it
reaches no screen reader on any platform. **The obvious fix is wrong.** The comment at `:929-931`
correctly warns that adding `accessible` would collapse the PASSA/GIOCA buttons and every card
into one unreachable leaf. The fix is a **separate node** carrying the label — a visually-hidden
live region, or `accessibilityRole` on a sibling — not `accessible` on this one.

**A11Y-02:** despite the name, `ExchangeModal` is not a `<Modal>`. Grepping the three overlays
for `<Modal>`, `accessibilityViewIsModal` and `aria-modal` returns nothing — which is also why
`tests/orientation.test.ts` never looks at them.

**Files touched:** `components/GameTable.tsx`, `components/GameShared.tsx`,
`components/CardView.tsx`, `components/handLayout.ts:12-34`, `components/ExchangeModal.tsx`,
`components/GameOverOverlay.tsx`, `components/ResultExchangeOverlay.tsx`,
`components/SettingsModal.tsx`, `app/auth.tsx:110-147`, `lib/tokens.ts`,
`tests/contrast.test.ts:72-122`

**Tests:** `tests/native/a11yCollapse.test.tsx`, `tests/contrast.test.ts`,
`tests/suitColours.test.ts`, `tests/reducedMotion.test.ts`, `tests/e2e/tapTargets.spec.ts` are
the existing net. **A11Y-06 changes `contrast.test.ts` itself** — it currently measures a felt
stop nothing renders on. Add the real pairs, including opponent names at 3.43:1 and
`Colors.danger` as body text at 4.07:1, both of which are in no contrast list today.

**Verification:** `npm run verify && npm run lint && npm run test:e2e -- tapTargets.spec.ts`

**Rollback:** `git revert -m 1 <merge-sha>`. A11Y-08 changes `MIN_READABLE_STEP` in
`components/handLayout.ts`, which feeds the pinned layout constants — if `tests/gameTableModel.test.ts`
fails after a revert, the constant did not come back cleanly; check it by hand.

---

# Batch 10 — Rules correctness

> **`CLAUDE.md`: game rules change only via a decision recorded in `docs/BRIEF.md` §3.1.**
> **RULE-06 is decided — see `DECISIONS.md` D6.** The match target scales by
> `(playerCount − 1)/3`: **7/10/14/17** at two seats, **14/21/27/34** at three, and the
> four-seat ladder `21/31/41/51` **unchanged**, so `docs/RULES.md` §12 stays literally true.
> Keeping the 4-player output byte-identical to today's constant is the regression test.
> Record the decision in `docs/BRIEF.md` §3.1 and update `rules.faq.a8` in all three locales,
> which currently states a flat 21 for every count. Nothing in this batch is blocked.

**Findings:** RULE-03, RULE-04, RULE-05, RULE-07, RULE-08, RULE-09, RULE-10, NET-09, NET-11,
RULE-06
**Order:** RULE-05 → RULE-09 → RULE-10 → RULE-07 → RULE-08 → RULE-04 → NET-09 → NET-11 →
RULE-03 → RULE-06 *(blocked)*

**RULE-03 is the one with a measured consequence.** `lib/gameEngine.ts:243-251` deals
`hands[i % playerCount]` from index 0 every time, so with 54 cards and 4 players **seats 0 and 1
always get 14 cards and seats 2 and 3 always get 13 — forever.** A2 measured it over 4,000
hands with four identical AI personalities: seat 0/1 win 25.9%/26.3% of manches versus
23.4%/24.4% for seats 2/3, a ~2.2-point gap at ≈4.5σ. A control run with a rotating dealer
collapsed the spread to noise. Online, **seat 0 is always the host**
(`server/socket.ts:1076`), and this bias is being recorded as skill by the rated ladder.

Fix: `dealCards(playerCount, firstSeat = 0)` dealing `hands[(firstSeat + i) % playerCount]`,
with a rotating value carried on `OnlineGameState` and in `context/GameContext.tsx` offline.
Default the parameter to 0 so every existing caller compiles unchanged.

**Files touched:** `lib/gameEngine.ts` (`:243-251`, `:1098`, `:1152-1177`, `:1022-1027`),
`context/GameContext.tsx` (`:103-111`, `:401-410`), `server/socket.ts` (`:612-632`, `:768-772`,
`:1311`, `:1337-1340`, `:1690-1707`), `app/(online)/game.tsx:33-35`, `app/(online)/room.tsx`,
`docs/RULES.md`, `docs/BRIEF.md` §3.1, `locales/{it,en,sq}.ts`

**Tests:** `tests/deal.test.ts:57` currently pins `[14,14,13,13]` and **must be updated** to
spell out the offset — `dealCards(4, 1)` → `[13,14,14,13]`, and the whole 54-card deck still
goes out at every offset. `tests/scoring.test.ts` gains
`resolveMatch({a:53,b:51}, 51)` → `{winners:["a"], newTarget:null, isDraw:false}` (RULE-05).
`tests/exchange.test.ts` gains the received-card exclusion plus the fallback case (RULE-07).
Add the `aiChoosePlay` non-null invariant test that makes RULE-09's dead branch unnecessary.

**Verification:** `npm run verify && npm run lint`, integration with `DATABASE_URL` for
RULE-04 and RULE-10.

**Rollback:** `git revert -m 1 <merge-sha>`. **RULE-03 adds a field to the offline save shape**
(`lib/offlineSave.ts`) — read its version-discard behaviour in `tests/offlineSave.test.ts`
before adding one. A save from another version is *discarded, not migrated*, so a revert makes
in-flight offline saves unresumable. That is acceptable per `CLAUDE.md` ("the database is not
precious"), but say so in the commit message.

---

# Batch 11 — Layout and overflow

**Findings:** UI-01, UI-02, UI-03, UI-04, UI-06, UI-09, UI-10, UI-11, UI-12, UX-12, **UI-13**
**Order:** UI-01 → UI-12 (depends) → UI-02 → UI-03 → UI-06 → UI-04 → UI-09 → **UI-13** →
UI-10 → UI-11 → UX-12

**UI-13 (Appendix A) is a `CLAUDE.md` violation, not a preference.**
`components/GameShared.tsx:843-851` writes a bare `zIndex: 50` literal inside a style object,
which the design-system rule explicitly forbids. Group it with UI-04, UI-09 and UI-12 — all
four are stacking bugs, and B2's report contains a **17-layer overlay stacking table with
z-indexes and co-occurrence** that you should read before touching any of them. An unnamed
z-index is exactly what makes that table necessary.

Nine of the ten are effort S and mechanical (add a `ScrollView`, add a `maxWidth`, add a
loading state, add an error state, use a token instead of a literal). **UX-12 is the merged
untranslated-strings finding** — three specialists independently found
`components/GameTable.tsx:1189-1199`'s hardcoded Italian "rotate your device" overlay. Every new
key goes in all three locales or `tests/i18n.test.ts` fails.

**Files touched:** `components/SettingsModal.tsx`, `components/NotificationBanner.tsx`,
`components/ReactionLayer.tsx:138-152`, `components/MenuLayout.tsx:28-77`,
`components/MenuCard.tsx:16`, `components/GameTable.tsx:1189-1199`,
`app/(online)/room.tsx:583-696`, `app/(online)/replay.tsx`, `app/(online)/profile.tsx:295-320`,
`app/index.tsx:398-459`, `context/SocketContext.tsx:164-192`, `locales/{it,en,sq}.ts`

**Tests:** `tests/orientation.test.ts` (every `<Modal>` declares `supportedOrientations`
including landscape) and `tests/i18n.test.ts` (key parity, no empty translations, placeholder
parity) are the net. `tests/e2e/tableFit.spec.ts` is parameterised by viewport × player count —
extend it with the desktop width UI-06 addresses.

**Verification:** `npm run verify && npm run lint && npm run test:e2e -- tableFit.spec.ts`

**Rollback:** `git revert -m 1 <merge-sha>`. Presentation only.

---

# Batch 12 — Test coverage where it matters

> **Read `CONFLICTS.md` C8 first.** C2 filed the scanner blind spots as *theoretical*; B4
> independently found three live defects hiding in one of them (A11Y-10, fixed in Batch 9).
> This batch is not tidying.

> **Carried forward from Batch 1 — this batch owns it.** Batch 1 added the production build to
> CI but omitted `expo:static:build`, because it runs `scripts/build.js`, which starts a Metro
> server and was too flaky on a runner. **TEST-05 and TEST-06 in this batch harden exactly that
> script. Once they land, add `expo:static:build` back to the build step in
> `.github/workflows/ci.yml` and delete the comment at `:85-86` explaining its absence.**
> Do not close this batch leaving it out — it is logged in `PROGRESS.md` § Carried forward and
> that row is yours to clear.

**Findings:** TEST-02, TEST-07, TEST-08, TEST-10, TEST-05, TEST-06, TEST-15, TEST-11,
**TEST-18, TEST-19, TEST-20, TEST-21, TEST-22**
**Order:** TEST-02 → TEST-10 → **TEST-18 → TEST-20 → TEST-22 → TEST-19 → TEST-21** → TEST-07 →
TEST-08 → TEST-15 → TEST-05 → TEST-06 → TEST-11
(TEST-11 depends on ARCH-04 in Batch 13 — if you reach it and the seam does not exist yet,
**defer TEST-11 to Batch 13** rather than forcing a test around an untestable function.)

**TEST-18 … TEST-22 come from A2's "Implemented but untested" enumeration** — rules the engine
enforces that no test in `tests/` exercises, verified by reading the test files rather than
inferring from filenames. They are cheap and they close real holes in a rules engine that is
otherwise the strongest part of the codebase:

- **TEST-18** — the turn moves to the **previous** seat index (`lib/gameEngine.ts:852-861`) and
  skips seats that have gone out. `tests/flow.test.ts:173,181` asserts only that the turn is
  *not* the finished seat, never the direction; `tests/gameTableModel.test.ts` pins
  `seatDirection` but never against the engine's rotation. **Both halves of the "senso orario"
  claim in `locales/it.ts:443` are unpinned.**
- **TEST-19** — `tests/botPersonalities.test.ts:32-40` builds a 4-seat free-for-all table only
  (`botTable(personality, seats = 4)`; the `seats` argument is never passed). The AI is untested
  at 2 and 3 seats, in teams mode, and with a `requireCard` that is not the 3♠.
- **TEST-20** — no test plays a 3-player game end to end. `tests/deal.test.ts:57` pins the hand
  sizes and stops there.
- **TEST-21** — `tests/enumerator.property.test.ts:17` fixes `HAND_SIZE = 10`, so the
  brute-force oracle never sees a real 13/14/18/27-card hand.
  `tests/straights.test.ts:205-222` runs a 27-card hand but only asserts it is *fast*, not that
  it is complete. **Raising the size may be slow — measure before committing to a number.**
- **TEST-22** — the teams hand-end disjunct "no opposing seat still holds cards"
  (`lib/gameEngine.ts:784-787`, second half of the `if`). `tests/teams.test.ts:99-113` reaches
  the same `return` through `teammateDone`, so the disjunct alone is never the reason the branch
  fires.

**TEST-02 is the High:** the two server guards that stop the obvious cheats — playing out of
turn (`server/socket.ts:1414`) and playing a card you do not hold (`:1417-1420`) — have **zero
tests**. A1 read them and confirmed they are correct; nothing proves they stay correct.

**TEST-07 and TEST-08 change tests that currently pass.** Expect them to go red when fixed —
that is the point. `tests/reducedMotion.test.ts` is a no-op for all 118 call sites it nominally
covers; when you make it real, it will catch the A11Y-10 animations if Batch 9 has not landed
yet. Sequence Batch 9 before this one, or accept the overlap.

**Files touched:** `tests/reducedMotion.test.ts:34-63`, `tests/socketEvents.test.ts:31,46`,
`tests/tokenRoles.test.ts:68`, `tests/motion.test.ts:78-84`,
`tests/integration/gameplay.test.ts`, `scripts/build.js:108-152,314-358`,
`scripts/e2e-server.mjs:35`, `tests/e2e/helpers/bot.ts`

**Verification:**
```bash
npm run verify && npm run lint
DATABASE_URL=<live> npm test
npm run test:e2e
```

**Rollback:** `git revert -m 1 <merge-sha>`. Test-only plus two build-script guards; no runtime
behaviour changes except `scripts/build.js`, which CI now exercises (TEST-04).

---

# Batch 13 — Architecture seams

> **Read `CONFLICTS.md` C1 and C5 first.**

**Findings:** ARCH-02, ARCH-04, ARCH-06, ARCH-15, ARCH-08, ARCH-14, ARCH-09, ARCH-13,
**ARCH-17**
**Order:** ARCH-02 → ARCH-08 → ARCH-14 (depends) → ARCH-06 → **ARCH-17** → ARCH-15 (depends) →
ARCH-04 → ARCH-13 (depends) → ARCH-09

**ARCH-17 (Appendix A) — do it inside ARCH-06's edit, not after.** `shared/schema.ts:72` names
the column `room_code` and `game:rejoin`'s payload field is `roomCode`, but every writer passes
the room **uuid** (`server/socket.ts:344`, `:2097`, `context/OnlineGameContext.tsx:184`).
Nothing is broken — it is consistent — but it was raised independently by **two** specialists,
and A1 recorded that it had to prove the naming was benign before it could rule out a
room-code-guessing attack on rejoin. ARCH-06 is already rewriting this table's shape and
`GAME_SCHEMA_VERSION`; renaming the column in the same commit costs nothing extra and avoids a
second disposal of every live game.

**ARCH-02 has three parts and shipping only the first is worse than nothing.** Delete the
duplicate `CARD_W`/`CARD_H` definitions and re-export from `components/cardFaceModel.ts`;
**change the shape of `tests/gameTableModel.test.ts`** so it asserts single-sourcing rather than
asserting `CARD_W === 58` (every duplicate is also 58, so every duplicate passes today, and
`:7` imports the constant from the second copy); and correct the false `CLAUDE.md` invariant.
Note `components/ExchangeAnnouncement.tsx:25-27` justifies its copy by claiming the constants
are "not exported" — they are, from `cardFaceModel.ts`, so that one is a one-line import.

**ARCH-08 must land after NET-01 and ARCH-07** (Batch 3). Delete `room:player_left` (`:2224`);
**keep `game:player_left`** (`:667`, `:681`).

**ARCH-04 is the L and the structural payoff of the whole audit:** `server/socket.ts` is 2272
lines holding all in-memory state, the whole event surface, the timer machinery and a 213-line
`handleGameOver`, with no unit test because nothing is importable in isolation. Nine of the
twenty Critical/High findings live in this file. Extract `server/gameOver.ts` first — that is
the seam TEST-11 needs.

**Files touched:** `server/socket.ts`, `server/onlineGameLogic.ts`, `shared/schema.ts:71-88`,
`components/{cardFaceModel,handLayout,gameTableModel,ExchangeAnnouncement,GameShared}.*`,
`tests/gameTableModel.test.ts`, `context/InviteContext.tsx` *(delete)*, `CLAUDE.md`

**Tests:** `tests/schemaDdl.test.ts` is the guard for ARCH-06 — every statement additive and
idempotent. `tests/socketEvents.test.ts` must be updated when ARCH-08 removes emit sites, and
gains the **outbound**-event check NET-10 proposed (every event the server emits appears in a
client `socket.on`, with an explicit allow-list for deliberate fire-and-forget).

**Verification:** `npm run verify && npm run lint`, integration with `DATABASE_URL`, full E2E.

**Rollback:** `git revert -m 1 <merge-sha>`. **ARCH-06 changes the `active_games` row shape.**
Bump `GAME_SCHEMA_VERSION` (`server/onlineGameLogic.ts:156`) in the same commit — every live
game is then disposed on the next rejoin with `GAME_NO_LONGER_VALID`, which is the deliberate
existing behaviour. Deploy it when no match is in flight, and note that NET-07 (Batch 4) is what
makes that failure legible to the player rather than a silent bounce.

---

# Batch 14 — Docs truth and housekeeping

**Findings:** ARCH-03, SEC-06 *(merged with TEST-12)*, SEC-07, SEC-08, ARCH-10, ARCH-11,
ARCH-12, ARCH-16, TEST-13, TEST-16, UI-07
**Order:** ARCH-03 first (depends on ARCH-02's corrected wording), then the rest in any order.
UI-07 is an L and can be split out into its own branch.

**ARCH-03 matters more than its severity suggests.** `CLAUDE.md` is loaded into every future
session's context, and **7 of its 36 claims are false** — including two it presents as *live*
examples of a bug (both already fixed), and a named **Invariant** describing a `FlatList` in
`app/(online)/friends.tsx` that does not exist (all four lists are plain `.map()`). A false
invariant actively instructs the next implementer to preserve something that is not there.

While you are in `CLAUDE.md`: **replace the two "no self-defeating safeguards" examples with the
three live ones this audit found** (TEST-01's unfailable CI step, A11Y-01's unreachable a11y
label, ARCH-02's undetectable constant duplication). The originals are fixed and now read as
false claims; the live ones teach the shape rather than a fixed bug list.

Also correct: `docs/ARCHITECTURE.md` names three identifiers that do not exist
(`game:play_result`, `advanceTurn`, the `'unauthorized'` error string) plus four stale line
counts; `docs/BRIEF.md` §2 is headed "Current state — verified assessment" while all 15 of its
defect citations point at unrelated code, including one claiming a live impersonation vector
that `tests/integration/auth.test.ts` disproves; `docs/BACKLOG.md` O11 is stale, which silently
unblocks Q11 and Q12.

**Files touched:** `CLAUDE.md`, `docs/{ARCHITECTURE,BRIEF,BACKLOG}.md`, `replit.md`,
`server/testApp.ts` *(rename)*, `server/index.ts:9,15`, `lib/socket.ts:45-74`,
`server/storage.ts:142-145`, `shared/schema.ts:8`, `server/templates/landing-page.html`,
`package.json`, `.github/workflows/ci.yml`, `lib/tokens.ts:138-161`, `eslint.config.js:24-38`

**Tests:** `tests/dbPush.test.ts` and `tests/schemaDdl.test.ts` guard SEC-08's new
case-insensitive unique index — it must be additive and idempotent. `tests/serverLoadable.test.ts`
and `tests/helpers/testServer.ts` both reference `server/testApp.ts` and must be updated with
ARCH-10's rename.

**Verification:** `npm run verify && npm run lint`, integration with `DATABASE_URL`.

**Rollback:** `git revert -m 1 <merge-sha>`. **SEC-08 adds a unique index on
`lower(username)`.** If two existing rows differ only by case, `ensureSchema` throws at boot and
the server will not start — that is the loud failure `server/schemaDdl.ts` is designed for.
Check first:
```sql
SELECT lower(username) FROM users GROUP BY 1 HAVING count(*) > 1;
```
On a database with no real users, dropping the offending row is fine.

---

## Self-review

**Spec coverage.** All 122 tracked findings in `BACKLOG.md` appear in exactly one batch here.
Verified mechanically rather than by hand: every finding ID was extracted from the ten source
reports and diffed against the backlog and against these batch sections — 120 filed IDs all
resolve (113 with their own row, 7 through the merged-ID index), plus the 9 promoted in
Appendix A, with **no duplicates and no omissions**.

Batch sizes: 6+7+6+9+6+6+4+11+13+10+11+13+9+11 = **122**.

**Nothing was dropped for being low-priority.** Beyond the 113, nine items were promoted out of
the reports' `Opinions (non-findings)` sections and A2's untested-rule enumeration after the
orchestrator verified each against the code — see `BACKLOG.md` Appendix A for the verification
notes. Two of the nine had been raised independently by two different agents.

**Dependency consistency.** Every `Depends on` in `BACKLOG.md` is honoured by the ordering
above, including the three cross-batch ones: ARCH-08 (Batch 13) after NET-01 and ARCH-07
(Batch 3); TEST-11 (Batch 12) after ARCH-04 (Batch 13) — flagged inline with an explicit
instruction to defer rather than force; ARCH-03 (Batch 14) after ARCH-02 (Batch 13).

**Known ordering tension, stated rather than hidden:** TEST-11 sits in Batch 12 but depends on
ARCH-04 in Batch 13. Two batches are therefore not strictly independent. The instruction to
defer TEST-11 into Batch 13 resolves it, and it is called out at the point of use rather than
only here.

**Owner decisions — all closed.** Six are answered in `audit/2026-08-17/DECISIONS.md` (D1–D6),
covering every question that blocked implementation. **No batch in this plan is waiting on a
decision.** The two questions still listed there (Q7 the Expo Go landing page, Q8 the severity
rubric) each carry a stated default, so a session that reaches one proceeds on the default
rather than stopping to ask.

**Placeholder scan:** no "TBD", no "add appropriate error handling", no "similar to Task N".
Every batch names its files, its tests, its exact verification command and its rollback. Batch 1
carries full step-level detail with runnable commands because it gates everything else and
because its fix cannot be verified locally — the rest delegate the fix specification to the
finding entries, which already carry Proposed fix and Acceptance criteria in the audit's schema.

---

## Execution handoff

Plan complete and saved to `audit/2026-08-17/IMPLEMENTATION-PLAN.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per batch, review between batches, fast
iteration. Batch 1 first, always.

**2. Inline Execution** — execute batches in-session with checkpoints for review.

**Start with Batch 1 regardless of which you choose.** Until `.github/workflows/ci.yml:62` is
fixed, no test in this repository can fail a build, and every acceptance criterion in every
other batch is unenforceable.
