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
12 → 13 → 14
```

**Why Track B stays serial:** batches 7, 8, 9 and 11 all rewrite `components/GameTable.tsx`
and `components/GameShared.tsx`. Running them concurrently guarantees conflicts in the two
largest files in the repo.

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
| - [ ] 11 | Layout and overflow | 11 | low | Sonnet | not started | | |
| - [ ] 12 | Test coverage where it matters | 13 | high | Opus | not started | | |
| - [ ] 13 | Architecture seams | 9 | **max** | **Opus** | not started | | |
| - [ ] 14 | Docs truth and housekeeping | 13 | low | Sonnet | not started | | |

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
| 14 Docs | **1**, plus ARCH-18 as its own pass | no | `npm run verify` — ARCH-18 touches source |

**Scale local verification to what the batch touches; CI always runs everything.** A batch that
never opens `server/` cannot break the integration suites, and waiting 115s locally to prove it
buys nothing that CI does not already prove. Run them locally when the batch touches `server/`,
`shared/` or `lib/gameEngine.ts` — there, `skipped 0` still matters before you push.

11 and 14 are 22 findings, almost all Low and effort S, in files that barely overlap. They are
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

**Anything a batch does not finish is written here, or it is lost.** Reporting a deferral in
chat does not count — chat evaporates and the next session never sees it. A batch may only
close with an open item if that item has a row here naming which batch picks it up.

An entry is removed only when the work is actually done, by the batch that owns it.

| From | Item | Why it was not done then | Owed by | Status |
|---|---|---|---|---|
| Batch 1 · TEST-04 | Add `expo:static:build` to the CI build step | It runs `scripts/build.js`, which starts a Metro server — too slow and flaky on a runner until the script is hardened. Recorded at `.github/workflows/ci.yml:85-86`. | **Batch 12**, after TEST-05 and TEST-06 | open |
| Batch 3 · RULE-01 | Give the integration suites headroom on the 20-account registration cap | `/api/auth/register` rate-limits to 20 registrations per process. `tests/integration/gameplay.test.ts` sits at that ceiling, and the 21st registration returns `429 AUTH_RATE_LIMITED` with nothing explaining why. Batch 3 worked around it by opening `tests/integration/rematch.test.ts` and sharing helpers through `tests/helpers/table.ts`; the next suite to grow hits the same wall. | **Batch 12** (test coverage) | open |
| Batch 8 · UX-01 | Emit `game:error` `INVALID_CARD` when a play names a card the hand does not hold | UX-01's client half landed — GIOCA sends the validated selection and stale ids are pruned — but its server half did not: `server/socket.ts` still returns bare on a card-count mismatch, so a client whose selection drifted gets silence instead of a reason. The code and its translations already exist, so it is a two-line emit. Left out because `server/socket.ts` was outside this batch's declared file scope; UX-01's integration acceptance criterion depends on the emit and is therefore unwritten. | **Batch 13** (it owns the `server/socket.ts` seams) | open |
| Batch 9 · (new) | Register an account against the E2E dev stack — `POST /api/auth/register` answers 500 | Six of the eleven `tests/e2e/tapTargets.spec.ts` cases fail in `registerNewAccount` with "Errore interno del server", not a rate limit (`RateLimit-Remaining: 19`). Reproduced with `curl` against the stack `scripts/e2e-server.mjs` boots, so it is the server against `murlan_dev`, not the browser. Batch 9's diff is client-only and cannot reach it. Every E2E case that registers is unverifiable until this is found, which is most of the suite. | **Batch 12** (it owns test/build hardening) | open |
| Batch 9 · A11Y-02 | Prove the exchange overlay traps focus with a Playwright case | A11Y-02's stated criterion is "open the exchange phase, press Tab five times, assert `document.activeElement.closest('[data-testid="game-table"]')` is null every time". Reaching the exchange phase needs a played-out manche, which needs a registered account — the row above. `tests/blockingOverlays.test.ts` pins the structural half (each overlay's body is inside a `<Modal>`, which is what buys react-native-web's focus trap), so the fix is guarded; the behavioural assertion is not written. | **Batch 12** | open |
| Batch 9 · A11Y-13 | Show an uncapped rank glyph clipping, on a device | A11Y-13's second criterion is "a jest-expo snapshot at a simulated large scale, or a Playwright run at a browser base font size of 32px, showing no clipped rank glyph". Neither is observable here: `maxFontSizeMultiplier` is applied by the native text layer, so no JS renderer sees its effect, and react-native-web ignores the prop entirely (browser zoom is the web's font scaling). `tests/fontScaling.test.ts` and `tests/native/a11yCollapse.test.tsx` pin that every Text in the table's fixed geometry declares the cap; that the cap is enough is asserted, not measured. | **Owner** — not a batch | open |
| Batch 9 · A11Y-03 | `accessibilityHint` reaches native only on a `<Switch>` | `lib/a11y.tsx` carries a hint to the DOM as `aria-describedby` pointing at a visually-hidden node. react-native-web's `Switch` spreads unknown props onto its wrapper `View` and builds the focusable `<input role="switch">` separately with only `aria-label`, so on the three switch sites (`SettingsModal` sounds and haptics, `room.tsx` fill-with-bots) the description lands on a node no screen reader focuses. The React Native half works. Fixing it means not using RNW's Switch. | **Batch 11** (it owns the client UI surfaces) | open |
| Batch 8 · (new) | Let the E2E stack run while the integration database is up | `scripts/dev-stack.mjs` hardcodes port 55432 for its `murlan-dev-pg` container, which is the same port the integration suites' `murlan-pg` holds, so `npm run test:e2e` cannot boot its own server whenever the test database is running. It then silently falls through to `reuseExistingServer`, which is the Batch 4 row below. Taking the port from the environment fixes it. Separately, `tests/e2e/helpers/bot.ts` does `table.count()` then `table.getAttribute(...)` with no timeout: when the table unmounts between the two — i.e. exactly when a game ends — `getAttribute` waits out the entire test budget instead of letting the loop re-check `isFinished`, costing a full timeout rather than a fast pass. | **Batch 12** (it owns test/build hardening) | open |
| Batch 7 · PERF-03 | Step 4 — take `giocaPressed`/`passaPressed` out of React state | PERF-03's fix has four steps; steps 1–3 landed (18 hook suppressions removed and their dependency arrays rewritten, `React.memo` on the card components, the online screen's select callback stabilised). Step 4 is separate work: a button press currently sets React state on `GameTable`, so pressing GIOCA or PASSA re-renders the whole table. It wants the pressed state isolated into a `GiocaButton` child, which is a component split rather than a dependency fix. Compiler bailouts went 70 → 60 and eslint-caused ones 45 → 24; the four in-scope files now compile with zero. | **Batch 12** (test coverage — it already owns the render-path scanners) | open |
| Batch 7 · (new) | `npm run lint` cannot fail on a hook-dependency bug | `react-hooks/exhaustive-deps` is configured at severity `1` by `eslint-config-expo/flat`, and `expo lint` exits 0 on warnings — so a wrong dependency array is reported as a warning nobody sees and the command still passes. This is not theoretical: Batch 5 found a `useCallback` in `context/OnlineGameContext.tsx` closing over a stale `false` because a dependency was missing, and lint reported nothing. Batch 7 then found and fixed a live round-winner-banner bug with the same shape. PERF-03's own acceptance criterion ("`npx expo lint` still reports 0 problems") is satisfied by a lint that would report 0 with the bug present — the `CLAUDE.md` self-defeating-safeguard shape. Fix: promote the rule to `error`, or add `--max-warnings 0`, which needs the 24 remaining suppressions elsewhere in the repo dealt with first. `tests/reactCompiler.test.ts` is the check that actually fails today, but only for five files. | **Batch 12** (it owns test/build hardening) | open |
| Batch 6 · PERF-02 | Ship web-specific WOFF2 Latin subsets — step 3 of the finding | PERF-02's fix is three steps and its acceptance criteria are split accordingly. Steps 1 and 2 landed: the unreferenced `Rajdhani_400Regular` is gone, every weight is imported by subpath instead of through the barrel that `require`s all nine weights and nine italics, and the render gate no longer blocks first paint. That took the shipped TTF from 12,098,616 to 2,568,828 bytes and the bytes blocking first paint on web from 2,475,596 to 0. **Step 3 is not done**, so its criterion — total font bytes fetched on a web cold load under 300 KB — is unmet: the remaining ~2.12 MB of app fonts still ships as TTF (roughly halved on the wire by PERF-01's gzip). A Latin subset would take it to ~200 KB, and the finding asks for the subsets to be generated in `scripts/build.js` so no tooling is needed at deploy time on Replit. | **Batch 12** (it owns `scripts/build.js` — TEST-05 and TEST-06 harden that same script) | open |
| Batch 6 · PERF-02 / PERF-08 | Run the two device-and-browser checks these findings name | Neither is runnable from this environment and both are stated criteria. PERF-02's fix risk names `tests/e2e/tableFit.spec.ts` and `tests/e2e/tapTargets.spec.ts` as the specs that would catch a layout shift from the font swap, and says to run them locally because CI does not — which is the same gate the Batch 4 row below describes as unmanned. PERF-08's criterion is that all twelve effects still play on web, iOS and Android, and its fix risk says to verify MP3 decoding on a real iOS device rather than a simulator. The risk is small (AVFoundation has decoded MP3 for as long as it has existed) but it is asserted, not measured. | **Owner** — not a batch | open |
| Batch 5 · (new) | Replace every `Alert.alert` in `app/` — it shows nothing on web | `react-native-web`'s `Alert` is `static alert() {}`, so every `Alert.alert` call is invisible on the bundle Replit serves. RES-09 fixed the one site whose acceptance criterion depended on it (the online lobby's error). The two that matter and remain are in `app/(online)/game.tsx`: the quit confirmation and the "Partita interrotta" dialog. A confirmation that never appears means its destructive branch never runs — on web the quit button does nothing. No audit finding covers this. Detail in `REMARKS.md`. | **Batch 11** (it owns the client UI surfaces) | open |
| Batch 4 · (new) | Stop the E2E suite reusing an unbuilt server — `reuseExistingServer: !process.env.CI` | `tests/e2e/playwright.config.ts:39` adopts whatever already holds port 5199, however stale, with none of the `webServer.env` block applied. Batch 4's `reconnect.spec.ts` run timed out against a server 21h older than the branch, serving a bundle 16h older, and never reached any reconnect code. `retries` is 0, so there is no flake signal either. A gate that can pass or fail on a binary nobody built is the `CLAUDE.md` self-defeating-safeguard shape. Fix: `reuseExistingServer: false`, keeping `E2E_SKIP_BUILD=1` as the explicit local fast path. **Compounded by Batch 5:** `.github/workflows/ci.yml` runs no Playwright step at all, so every acceptance criterion across the audit that names a `tests/e2e/*.spec.ts` case is verified by nothing on a runner. Both halves belong to the same fix. Detail in `REMARKS.md`. | **Batch 12** (it owns test/build hardening) | open |
| Batch 4 · RES-03 | Give a cold-start rejoin a `room` when the roster read fails | RES-03(a) gives `emitRoomStateTo` its own `.catch` so a failed `getRoomPlayers` cannot fail a rejoin that holds a valid seat — which is the fix RES-03 asks for. A *reconnecting* client still holds the `room` it had. A **cold start** holds nothing, and the navigation chain needs `room`, so the player lands on the game screen's null state. NET-03's `room:rejoin` does not reach it; the client would have to notice "game state but no room" and re-ask, which is new logic on a different path. | **Batch 13** (it owns the `server/socket.ts` seams) | open |
| Batch 3 · SEC-01 / RULE-01 · Batch 8 · UX-02 | Have a native Italian speaker read the new Italian strings | `server.MATCH_IN_PROGRESS`, `server.NEW_MATCH_NOT_READY` and `server.REMATCH_DECLINED` were written by Claude, not by a speaker. Italian is what most of the player base reads, so a clumsy string ships to them. (English is the source of truth for copy — see ARCH-19; the code does not enforce that yet.) **Batch 8 adds one more, and it was a judgement call nobody ratified:** the per-seat pass marker reads **PASSO**. The obvious word, *PASSA*, is byte-identical to the PASSA button's label, which would make one word mean both "an action you can take" and "a seat's state". *PASSO* is the player's own declaration and is ungendered. UX-02's open question 4 asking for this wording was never answered in `DECISIONS.md`. | **Owner** — not a batch | open |
| Batch 10 · (new) | `tests/contrast.test.ts` cannot run on a Windows checkout | It locates a style by searching `components/GameShared.tsx` for the literal `"\n  <name>: {\n"`. With `core.autocrlf=true` — the default on Windows — the file is checked out with CRLF and every one of its 9 GameShared cases fails with "has no style named …", on `origin/main` as much as on any branch. It passes 23/23 the moment the file is normalised to LF, and CI runs on Linux, so nothing is actually unguarded — but a local `npm test` is red for everyone on Windows, which is how a real failure gets waved through. The same shape is in every source-scanning test (`tokenRoles`, `orientation`, `socketEvents`, `reactCompiler`, `a11yLabels`). Fix: match `\r?\n`, or pin these files to LF with `.gitattributes`. No audit finding covers it. | **Batch 12** (it owns test/build hardening) | open |
| Batch 10 · (new) | Wrap the socket-event emits the native tests fire in `act(...)` | Every `npm run test:native` run prints **78 `console.error` blocks** — 64 "An update to OnlineGameProvider inside a test was not wrapped in act(...)", 8 for `Probe`, 6 for `NotificationProvider` — surfacing under six **PASS** lines (`rejoinFailed`, `spectateFailed`, `motionPreference`, each per project). Jest prints a passing suite's captured console too, and `console.error` renders red, so a green step looks like a failing one. Cause: a test fires a socket event, the handler calls `setRoom`/`setMatchState` (`context/OnlineGameContext.tsx:349` and siblings) outside React's control, and the dev build warns the render was not flushed deterministically. Identical 64/8/6 split on `origin/main` at `7d42d53`, so no batch introduced it. Harmless today — the `waitFor` assertions still see the updated tree — but it is 78 lines of red that trains everyone to skim past the one that matters. No audit finding covers it. | **Batch 12** (it owns test/build hardening) | open |
| Batch 10 · (new) | Send `game:match_state` on rejoin — a reconnecting player is shown the wrong match target | `server/socket.ts` emits it at exactly two places, `room:start` (`:1940`) and `game:rematch_vote` (`:2203`). **No rejoin path emits it at all**, so a client that reconnects, cold-starts or is rehydrated after a server restart keeps `INITIAL_MATCH` (`context/OnlineGameContext.tsx:58`): target 21, empty scores, length `"match"`. `game:over` corrects it, so the wrong figures show for the rest of the current manche — minutes, not a flash — on the format label (`app/(online)/game.tsx:257`), the result screen and the game-over overlay. It was already wrong for a `single` game and for the running scoreboard; **RULE-06 makes it wrong about the number too**, since a 2-seat table now plays to 7 and a 3-seat one to 14 while the rejoined client still says 21. The fix is one emit on the rejoin paths, which is `server/socket.ts` and so outside Batch 10's declared scope. Sits with the RES-03 cold-start row above. | **Batch 13** (it owns the `server/socket.ts` seams) | open |

### Not carried forward — closed as designed

Recorded so nobody re-opens them looking for missing work:

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

---

## Decisions

**All closed.** `DECISIONS.md` D1–D6 answer every question that blocked implementation.
**No batch is waiting on anything.** Two questions remain recorded there (the Expo Go landing
page, the severity rubric) and both carry a stated default, so no session will stop to ask.

If a batch tells you a decision is missing, that is a bug in the plan — say so rather than
guessing.
