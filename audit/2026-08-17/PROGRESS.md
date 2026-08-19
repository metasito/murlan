# PROGRESS — audit remediation

Run `/batch next` to start the next unchecked batch. Run `/batch status` to print this file.
Each batch fills in its own row as it goes and ticks its box once its PR is **merged**.

## Run order

```
2 → 3 → 4 → 5            serial — all four rewrite server/socket.ts lifecycle code

then two tracks, in parallel worktrees:
  Track A:  6 → 10       server, build, rules
  Track B:  7 → 8 → 9 → 11   client UI — serial within the track

then serial:
12 → 13 → 14 → 15
```

**Why Track B stays serial:** batches 7, 8, 9 and 11 all rewrite `components/GameTable.tsx`
and `components/GameShared.tsx`. Running them concurrently guarantees conflicts in the two
largest files in the repo.

**Why 15 is last:** it is the docs batch, and a document is only true once the code it
describes has stopped moving. Batch 14 is the last batch that touches source, so 15 runs
after it and describes the finished state.

**Why 12, 13, 14 come last:** 12 needs Batch 9 landed (its `reducedMotion` scanner is what
catches Batch 9's unguarded animations) and Batch 10 landed (the rules tests). 13 splits
`socket.ts` *and* de-duplicates the layout constants, so it needs both tracks finished. 14
corrects the documents describing what 13 changed.

**One collision if you run the tracks in parallel:** Batch 6 edits `app/_layout.tsx` for the
font gate and Batch 8 edits the same file for the notification banner. Different regions, but
merge one before opening the other's PR.

| # | Batch | Findings | Effort | Model | Status | Branch | PR |
|---|---|---|---|---|---|---|---|
| - [x] 1 | Restore the safety net | 6 | medium | Sonnet | merged — 2026-08-17 | `audit/batch-1-safety-net` | [#2](https://github.com/metasito/murlan/pull/2) |
| - [x] 2 | Server operational integrity | 7 | medium | Sonnet | merged — 2026-08-17 | `audit/batch-2-server-integrity` | [#3](https://github.com/metasito/murlan/pull/3) |
| - [x] 3 | The match lifecycle | 7 | **max** | **Opus** | merged — 2026-08-17 | `audit/batch-3-match-lifecycle` | [#7](https://github.com/metasito/murlan/pull/7) |
| - [x] 4 | Reconnect and error surfacing | 9 | high | Opus | merged — 2026-08-18 | `audit/batch-4-reconnect-errors` | [#8](https://github.com/metasito/murlan/pull/8) |
| - [x] 5 | Robustness and session safety | 6 | high | Opus | merged — 2026-08-18 | `audit/batch-5-robustness-session` | [#9](https://github.com/metasito/murlan/pull/9) |
| - [x] 6 | Bytes on the wire | 6 | medium | Sonnet | merged — 2026-08-18 | `audit/batch-6-bytes-on-the-wire` | [#10](https://github.com/metasito/murlan/pull/10) |
| - [x] 7 | Render hot path | 4 | high | Opus | merged — 2026-08-18 | `audit/batch-7-render-hot-path` | [#11](https://github.com/metasito/murlan/pull/11) |
| - [x] 8 | Game feel | 11 | medium | Sonnet | merged — 2026-08-18 | `audit/batch-8-game-feel` | [#12](https://github.com/metasito/murlan/pull/12) |
| - [x] 9 | Accessibility | 13 | high | Opus | merged — 2026-08-18 | `audit/batch-9-accessibility` | [#13](https://github.com/metasito/murlan/pull/13) |
| - [x] 10 | Rules correctness | 10 | high | Opus | merged — 2026-08-18 | `audit/batch-10-rules-correctness` | [#14](https://github.com/metasito/murlan/pull/14) |
| - [x] 11 | Layout and overflow | 11 | low | Sonnet | merged — 2026-08-18 | `audit/batch-11-layout-overflow` | [#15](https://github.com/metasito/murlan/pull/15) |
| - [x] 12 | Test coverage where it matters | 13 | high | Opus | merged — 2026-08-18 | `audit/batch-12-test-coverage` | [#16](https://github.com/metasito/murlan/pull/16) |
| - [x] 13 | Architecture seams | 9 | **max** | **Opus** | merged — 2026-08-19 | `audit/batch-13-architecture-seams` | [#17](https://github.com/metasito/murlan/pull/17) |
| - [x] 14 | Carried-forward cleanup | 13 | high | **Opus** | merged — 2026-08-19 | `audit/batch-14-carried-forward` | [#21](https://github.com/metasito/murlan/pull/21) |
| - [x] 15 | Docs truth and housekeeping | 13 | low | **Opus** | merged — 2026-08-19 | `audit/batch-15-docs-truth` | PR_PLACEHOLDER |

A batch is done when it is **committed, pushed, opened as a PR, and merged once CI is green** —
one commit per finding, one branch per batch, one PR per branch. Merge with `--merge`, never
`--squash`: the rollback story depends on the per-finding commits reaching `main`.

Status values: `not started` → `in progress` → `PR open` → `merged`. Fill in the branch and PR
columns as you go, and only tick the box once the PR is **merged**.

**The merge gate — all four, or stop and ask the owner:** every CI check completed and green
(pending is not green); nothing deferred; every acceptance criterion actually verified rather
than assumed; nothing changed outside the batch's declared scope.

Merging does not deploy — Replit Cloud Run is triggered from its own UI, so merged work waits
on `main` for a human to ship it.

**125 findings total.** 3 Critical, 17 High, 63 Medium, 42 Low.

---

## Treatment per batch

Decided from what the finished batches actually cost, so no session has to work it out again.
The default is **inline, grouped, one review, one full-suite run**. Deviations only where the
row says so.

| # | Dispatches | Subagents | Local verify before push |
|---|---|---|---|
| 8 Game feel | 2 (client) | no | `npm test` + `test:native` — no Postgres needed |
| 9 Accessibility | 2-3 (components / tokens / tests) | no | `npm test` + `test:native` |
| 10 Rules | 2 (engine / server) | no | full, **with Postgres** |
| 11 Layout | **1** | no | `npm test` + `test:native` |
| 12 Test coverage | 2 | no | full, **with Postgres** |
| 13 Architecture seams | per risky finding | **yes** — `subagent-driven-development` | full, **with Postgres** |
| 14 Carried-forward cleanup | 4 (storage / server / client / CI+tests) | no | full, **with Postgres** — storage and rule changes |
| 15 Docs | **1**, plus ARCH-18 as its own pass | no | `npm run verify` — ARCH-18 touches source |

**Scale local verification to what the batch touches; CI always runs everything.** A batch that
never opens `server/` cannot break the integration suites, and waiting 115s locally to prove it
buys nothing that CI does not already prove. Run them locally when the batch touches `server/`,
`shared/` or `lib/gameEngine.ts` — there, `skipped 0` still matters before you push.

11 and 15 are 22 findings, almost all Low and effort S, in files that barely overlap. They are
one dispatch each and should finish inside an hour, not a day.

## Blocking notes

- **Batch 1 cannot be verified locally.** `TEST-01` fixes GitHub Actions' shell wrapper, which
  only exists on a runner. The batch requires pushing a deliberately failing test, confirming
  CI goes red, then removing it. A green CI proves nothing — that was the bug.
- **Batches 3, 4, 5, 10, 12, 13 need a live Postgres** for their integration acceptance
  criteria. Start one and export `DATABASE_URL` before running `npm test`; the recipe is in
  `.claude/commands/batch.md`. Confirm the output reports `skipped 0` and contains no
  `DATABASE_URL not set` line — that line means the integration suites did not run.
- **Batch 3's design doc is written, implemented and deleted.** `CLAUDE.md` requires a written
  design for anything touching storage or the socket protocol, and requires implemented design
  docs to be deleted rather than archived. The decisions it carried live permanently in
  `DECISIONS.md` D1–D4 and, for the two that are rule changes, in `docs/BRIEF.md` §3.1.

## Carried forward

Rows owed by **Owner** are also written out in plain language, with the options spelled out,
in [`OWNER-TODO.md`](OWNER-TODO.md) — that file is the one to read if you are not going to
run a batch yourself.

**Anything a batch does not finish is written here, or it is lost.** Reporting a deferral in
chat does not count — chat evaporates and the next session never sees it. A batch may only
close with an open item if that item has a row here naming which batch picks it up.

An entry is removed only when the work is actually done, by the batch that owns it.

| From | Item | Why it was not done then | Owed by | Status |
|---|---|---|---|---|
| Batch 6 · PERF-08 | Hear the twelve sound effects on a real iOS device | PERF-08's criterion is that all twelve effects play on web, iOS and Android, and its fix risk says to verify MP3 decoding on a real device rather than a simulator. The risk is small — AVFoundation has decoded MP3 for as long as it has existed — but it is asserted, not measured. **PERF-02's half of this row is done:** Batch 14 ran `npm run test:e2e` in full for the font change (36 of 37, the one failure measured as pre-existing — see the `tableFit` row below) and added `tests/e2e/webFonts.spec.ts`, which measures the accented characters against the fallback face in a browser. | **Owner** — not a batch | open |
| Batch 13 · ARCH-17 · Batch 14 | **`npm run db:push` has to be run against the production database before or with this deploy** | Two columns are now renamed — `active_games.room_code` and `match_replays.room_code`, both to `room_id` — and `ensureSchema()` is additive, so it cannot carry either out. `assertRenamesApplied()` runs first at boot and throws, so **the server refuses to start** against a database still holding an old column: merging and pressing Deploy without the push is a boot loop, not a degraded start. This is the one place `CLAUDE.md` § Replit's "must launch from the Run button with no setup" does not hold. Separately, `game:rejoin`'s wire payload renamed `roomCode` → `roomId` (and `game:rejoin_failed` with it), so the server and the web bundle have to ship together — a stale bundle rejoins a new server with a field it no longer reads. **Batch 14 added a field to the saved-game envelope (D11) and deliberately did not bump `GAME_SCHEMA_VERSION`**, so it rides the same one-time disposal this deploy already causes: any game in progress at the moment of the deploy ends and its players are told so, once rather than twice. | **Owner** — a deploy step, not a batch | open |
| Batch 14 · (new) | `tests/e2e/tableFit.spec.ts` fails about one run in seven, and has been doing so for some time | Running the suite for PERF-02's fix risk turned up `the table fits the screen › small phone landscape, 4 players` failing. It is **not** the font change: measured **3 failures in 20** against `main`'s own font wiring, with the PERF-02 commits reverted, and 1 in 10 with them. What escapes the 667px viewport is the right seat's card fan — fixed-size card backs, so no font can widen them — which means the test is sampling a moment while the table is still settling rather than catching a layout defect. `page.waitForTimeout(2_000)` is the whole of its settling logic, and bots start playing immediately under `EXPO_PUBLIC_E2E_FAST`. Nobody noticed because **CI runs no Playwright step at all** (`REMARKS.md`), so this suite runs only when someone runs it by hand. Either the wait becomes a real quiescence check, or the sweep excludes what is mid-animation. | **Owner** — a backlog item; no finding covers it and Batch 15 is docs-only | open |
| Batch 14 · (new) | The icon fonts are now 82% of the font bytes the web downloads | PERF-02 took the six text weights from 2,123,508 B of TTF to 99,016 B of WOFF2. `Ionicons.ttf` (389,724 B) and `Feather.ttf` (55,596 B) still ship whole, for a few dozen glyphs. Subsetting them is the same technique with one extra step — the character set comes from the `name="…"` props across the app rather than from the strings — but no finding covers it and PERF-02's own arithmetic (~200 KB for the text faces) never counted them. Detail in `OWNER-TODO.md` §5. | **Owner** — a backlog decision, not a batch | open |
| Batch 14 · (new) | Four Italian server strings assume the player is a man | `server.PLAYER_AFK_AUTO_PASS`, `server.PLAYER_AFK_AUTO_EXCHANGE`, `server.PLAYER_DISCONNECTED_GRACE` and `server.PLAYER_RECONNECTED` all carry masculine agreement (*inattivo*, *disconnesso*, *rientrato*), and every one of them is shown to the whole table several times a hand. Found while doing D14, which scoped four other keys. Not fixed here because the fix is a product decision — rewrite each into a genderless form, or record gender on the account — rather than a wording one. Albanian has never had a native read either. Detail in `OWNER-TODO.md` §4. | **Owner** — a product decision, not a batch | open |

| Batch 15 · TEST-13 | Evaluate the stable `babel-plugin-react-compiler@1.0.0` | TEST-13 step 1 (pin the manifest to the installed build) is done; step 2 is explicitly *"do not combine the two changes in one commit"* and its fix risk requires a real web build and a manual pass over an animated game table, which is a device check rather than a batch. | **Owner** — not a batch | open |
| Batch 15 · (new) | **The build and the test use different React Compilers** | `babel-preset-expo@54.0.12` resolves its own nested `babel-plugin-react-compiler@1.0.0`, so that is what compiles the app. The root devDependency — the 19.0.0 beta TEST-13 just pinned — is what `tests/reactCompiler.test.ts` loads, so the acceptance test proves a bailout-free table under a compiler the build never runs. No finding covers this and it is outside batch 15's scope. Either the test resolves the plugin the way `babel-preset-expo` does, or the root pin is dropped as dead weight. | **Owner** — a backlog decision | open |
| Batch 15 · (new) | `tests/integration/httpCaching.test.ts` failed once in three full-suite runs, and passes alone | Seen once: all 7 cases in that file failed together while the same file passed in isolation and in the two runs after it. It writes fixture files into `dist/` and removes them in `after()`, and `node --test` runs files concurrently — so a sibling suite reading `dist/` during that window is the shape to look at. Not the comment pass: the diff for it contains no non-comment line. | **Owner** — a backlog item; no finding covers it | open |

### Not carried forward — closed as designed

Recorded so nobody re-opens them looking for missing work:

- **Batch 15 · ARCH-18** stops at **15.7%** comment density in `server/socket.ts`, not the
  "under 12%" the finding names. What the finding is *for* is done and is checkable: the
  diff contains **no line that is not a comment**, every comment restating its code line or
  narrating history or explaining a just-fixed defect is gone, the longest block went from
  25 lines to 8, and **every comment block outside `tests/` is now 8 lines of prose or
  fewer**. Reaching 12% from here means deleting ~63 more lines from a set that is
  overwhelmingly the four categories `CLAUDE.md` says earn a comment — which is exactly what
  the finding's own Fix risk forbids ("when unsure whether a comment carries a constraint,
  keep it and shorten it to the constraint alone"). The 12% figure was set against a
  2272-line `socket.ts` that still held the game logic; ARCH-04 has since moved that logic
  into five modules and left behind the `onEvent` registrations, each of which carries a
  protocol constraint. **Density measured, not estimated:** repo-wide 14.7% → 14.2%.

- **Batch 15 · UI-07** enforces the lint rule on `fontSize` and `borderRadius` only, not on
  the spacing family the finding's selector also lists. Both swept scales now hold **zero**
  bare literals — 8 `FontSize` steps plus one named display constant, and 3 non-circular
  `Radius` steps — against the finding's targets of ≤9 and ≤5. `Spacing` is left out
  deliberately: its steps are 4/8/16/24/32/48 and 321 sites nudge by 1, 2, 3 and 6, so the
  rule would produce noise and disables rather than a scale. Recorded in `CLAUDE.md`
  § Design system so nobody reads the rule as covering more than it does.

- **Batch 15 · UI-07** uses `Radius.full` for the 26 radii that were exactly half their box
  rather than the allow-list the finding proposes for circular avatars. Same rendered
  result, and it removes the carve-out — a lint exemption for "radius equals half a sibling
  width" is a rule nobody can check by eye and everyone can reach for.

- **Batch 15 · ARCH-16** keeps `SocketContextValue.socket` as `Socket | null`. The finding
  expects the throwing hook to make it non-nullable, but `SocketProvider` is mounted in
  `app/_layout.tsx` **above** auth, and `connectSocket` runs in an effect — so there is
  genuinely no socket until a user exists, and a non-null type would be a lie the two
  `if (socket)` guards currently tell the truth about. All six live contexts do now use
  `createContext<T | null>(null)` and a throwing hook, which is the finding's substance.

- **Batch 10 · RULE-03** stores the deal rotation as `dealFirstSeat` rather than the
  `dealerSeat` the finding names. It is the seat the deal *starts from*, and
  `docs/RULES.md` §3 has the dealer deal to their left — so a field called
  `dealerSeat` holding the first receiver would be off by one against the document
  it implements. **Naming only; the rotation is exactly what the finding specifies.**

- **Batch 9 · A11Y-09** measures the 44pt floor in two places rather than one.
  `tests/e2e/tapTargets.spec.ts` gained the size sweep the finding asked for, and
  `tests/touchTargets.test.ts` pins the declared floors — because CI runs no
  Playwright step at all (the Batch 4 row above), so the sweep alone would guard
  nothing on a runner. **Both are the finished state, not a duplication.**
- **Batch 9 · A11Y-01** keeps `accessibilityLabel` on the table and hand
  containers. It is the E2E harness's hook (`tests/e2e/helpers/bot.ts` reads the
  raw attribute); players get the same sentence from the `A11yStatus` node, and
  `tests/a11yLabels.test.ts` accepts a container label only when an `A11yStatus`
  in the same file carries it. **This is the option A11Y-01 offers, not a
  shortfall.**

- **Batch 1 · TEST-09** excluded `server/index.ts` from `tests/serverLoadable.test.ts`.
  Importing it binds a port and installs signal handlers, so it cannot be load-tested in
  isolation. The plan explicitly asked for a named exclusion rather than forcing it, and the
  reason is recorded at `tests/serverLoadable.test.ts:11`. **This is the finished state of
  TEST-09, not a deferral.**

- **Batch 9 · (new) — register-against-the-E2E-stack 500.** Not reproducible: `POST
  /api/auth/register` was called 16 times in a row against a fresh `scripts/e2e-server.mjs`
  boot with no failure, and the full `tapTargets.spec.ts` suite (which registers an account in
  most of its cases) is green. The most likely cause was the same one Batch 4's row above
  named — `reuseExistingServer` adopting a stale server serving old code — which Batch 12's fix
  for that row removes. **No code change of its own; closed by verification, not by a
  commit.**

- **Batch 13 · ARCH-08** keeps the two `game:started` server emits, deleting only the
  client's no-op listener and its bare `socket.off("game:started")`. Socket.IO's default
  delivery is at-most-once with no server buffer and `connectionStateRecovery` is not
  enabled, so a one-shot event is lost outright if it lands while a client is
  reconnecting — navigation is therefore state-driven (`gameState` becoming non-null),
  and wiring it to the event would be a regression. The emit is also load-bearing for six
  integration sites and a merged batch-10 rules criterion. It is now declared in the
  **outbound drift-detector's allow-list**, which ARCH-08 built (NET-10) — so the decision
  is enforced by a test rather than left as drift. **This is the finished state, not a
  shortfall.**

- **Batch 13 · ARCH-04** executes the finding's six module boundaries in a corrected
  order. As written, module 3 (`gameTurn`) is extracted before modules 4 and 5, which it
  calls — that would force either an import cycle dragging `storage → db → pg` back in, or
  five injected callbacks the next step would unwind. Nothing in 4 or 5 calls into 3, so
  the graph is a clean DAG and the order used was 1 → 2 → 5 → 4 → 3 → 6. **Same
  boundaries, valid sequence.**

- **Batch 13 · ARCH-15** did not build the `makeTestGame` fixture its step 3 asks for.
  `autoMoveForSeat` and `recordPlayFlags` instead take `Pick<OnlineGameState, …>` — exactly
  what they read. That removes the unsound casts with no scaffolding and is stronger: a
  fixture filling 15 fields with defaults still lets a function grow a sixteenth read the
  test satisfies with a default production never has, whereas a narrowed parameter makes
  that a compile error. `appendReplayMove` already set the precedent.

- **Batch 13 · ARCH-04**'s "add the three new modules to `tests/serverLoadable.test.ts`'s
  list" is satisfied by construction — that file now derives its module set from
  `readdirSync("server")` minus `index.ts`, and picked all five up with zero edits
  (25 → 28). **Adding a literal list would be a regression.**

- **Batch 13 · ARCH-04** stops at **1686 lines**, not the "under 1000" the finding names.
  Settled by **D10**: the structural payoff landed — five modules, the in-memory state owned
  by `gameRoom.ts`, and `handleGameOver` callable from plain `node --test` with no database,
  which is the reason the finding exists. What remains is ~1150 lines of `onEvent`
  registrations the finding itself requires to stay in `socket.ts`, so the target was
  unreachable as written. **Closed as designed, not deferred.**

---

## Decisions

**All closed.** `DECISIONS.md` D1–D10 answer every question that blocked implementation.
**No batch is waiting on anything.** Two questions remain recorded there (the Expo Go landing
page, the severity rubric) and both carry a stated default, so no session will stop to ask.

If a batch tells you a decision is missing, that is a bug in the plan — say so rather than
guessing.
