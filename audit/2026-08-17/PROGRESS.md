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
| - [x] 11 | Layout and overflow | 11 | low | Sonnet | merged — 2026-08-18 | `audit/batch-11-layout-overflow` | [#15](https://github.com/metasito/murlan/pull/15) |
| - [x] 12 | Test coverage where it matters | 13 | high | Opus | merged — 2026-08-18 | `audit/batch-12-test-coverage` | [#16](https://github.com/metasito/murlan/pull/16) |
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
| Batch 8 · UX-01 | Emit `game:error` `INVALID_CARD` when a play names a card the hand does not hold | UX-01's client half landed — GIOCA sends the validated selection and stale ids are pruned — but its server half did not: `server/socket.ts` still returns bare on a card-count mismatch, so a client whose selection drifted gets silence instead of a reason. The code and its translations already exist, so it is a two-line emit. Left out because `server/socket.ts` was outside this batch's declared file scope; UX-01's integration acceptance criterion depends on the emit and is therefore unwritten. | **Batch 13** (it owns the `server/socket.ts` seams) | open |
| Batch 9 · A11Y-02 | Prove the exchange overlay traps focus with a Playwright case | **Batch 12 tried this and could not finish it — see below**, distinct from why it was skipped before. | **Owner** — not a batch | open |
| Batch 9 · A11Y-13 | Show an uncapped rank glyph clipping, on a device | A11Y-13's second criterion is "a jest-expo snapshot at a simulated large scale, or a Playwright run at a browser base font size of 32px, showing no clipped rank glyph". Neither is observable here: `maxFontSizeMultiplier` is applied by the native text layer, so no JS renderer sees its effect, and react-native-web ignores the prop entirely (browser zoom is the web's font scaling). `tests/fontScaling.test.ts` and `tests/native/a11yCollapse.test.tsx` pin that every Text in the table's fixed geometry declares the cap; that the cap is enough is asserted, not measured. | **Owner** — not a batch | open |
| Batch 9 · A11Y-03 | `accessibilityHint` reaches native only on a `<Switch>` | `lib/a11y.tsx` carries a hint to the DOM as `aria-describedby` pointing at a visually-hidden node. react-native-web's `Switch` spreads unknown props onto its wrapper `View` and builds the focusable `<input role="switch">` separately with only `aria-label`, so on the three switch sites (`SettingsModal` sounds and haptics, `room.tsx` fill-with-bots) the description lands on a node no screen reader focuses. The React Native half works. Fixing it means not using RNW's Switch. | **Batch 11** (it owns the client UI surfaces) | open |
| Batch 6 · PERF-02 | Ship web-specific WOFF2 Latin subsets — step 3 of the finding | PERF-02's fix is three steps and its acceptance criteria are split accordingly. Steps 1 and 2 landed: the unreferenced `Rajdhani_400Regular` is gone, every weight is imported by subpath instead of through the barrel that `require`s all nine weights and nine italics, and the render gate no longer blocks first paint. That took the shipped TTF from 12,098,616 to 2,568,828 bytes and the bytes blocking first paint on web from 2,475,596 to 0. **Step 3 is still not done.** Batch 12 scoped it: `subset-font` (harfbuzzjs/WASM, no native build tooling — safe for a Replit deploy) can subset each of the 6 shipped weights down to exactly the characters `locales/{it,en,sq}.ts` ever render, which is provably safe because `RegisterSchema` (`server/schemas.ts:8`) already limits usernames to `[a-zA-Z0-9_]` — no user-generated text needs a wider set. **Not attempted**: wiring the subset output into Metro's web export (`expo:web:build` / `expo:static:build`) means either pre-processing the source TTFs before Metro bundles them or post-processing `dist/`'s already-hashed, already-referenced assets and rewriting every reference to them inside a minified JS bundle — real surgery on the build pipeline with no way to visually verify Rajdhani/Inter render Albanian ë/ç correctly afterward from this environment. Shipping it wrong risks tofu in production, which is worse than the current, merely-oversized fonts. | **Batch 12** (it owns `scripts/build.js` — TEST-05 and TEST-06 harden that same script) | open |
| Batch 6 · PERF-02 / PERF-08 | Run the two device-and-browser checks these findings name | Neither is runnable from this environment and both are stated criteria. PERF-02's fix risk names `tests/e2e/tableFit.spec.ts` and `tests/e2e/tapTargets.spec.ts` as the specs that would catch a layout shift from the font swap, and says to run them locally because CI does not — which is the same gate the Batch 4 row below describes as unmanned. PERF-08's criterion is that all twelve effects still play on web, iOS and Android, and its fix risk says to verify MP3 decoding on a real iOS device rather than a simulator. The risk is small (AVFoundation has decoded MP3 for as long as it has existed) but it is asserted, not measured. | **Owner** — not a batch | open |
| Batch 5 · (new) | Replace every `Alert.alert` in `app/` — it shows nothing on web | `react-native-web`'s `Alert` is `static alert() {}`, so every `Alert.alert` call is invisible on the bundle Replit serves. RES-09 fixed the one site whose acceptance criterion depended on it (the online lobby's error). The two that matter and remain are in `app/(online)/game.tsx`: the quit confirmation and the "Partita interrotta" dialog. A confirmation that never appears means its destructive branch never runs — on web the quit button does nothing. No audit finding covers this. Detail in `REMARKS.md`. | **Batch 11** (it owns the client UI surfaces) | open |
| Batch 4 · RES-03 | Give a cold-start rejoin a `room` when the roster read fails | RES-03(a) gives `emitRoomStateTo` its own `.catch` so a failed `getRoomPlayers` cannot fail a rejoin that holds a valid seat — which is the fix RES-03 asks for. A *reconnecting* client still holds the `room` it had. A **cold start** holds nothing, and the navigation chain needs `room`, so the player lands on the game screen's null state. NET-03's `room:rejoin` does not reach it; the client would have to notice "game state but no room" and re-ask, which is new logic on a different path. | **Batch 13** (it owns the `server/socket.ts` seams) | open |
| Batch 3 · SEC-01 / RULE-01 · Batch 8 · UX-02 | Have a native Italian speaker read the new Italian strings | `server.MATCH_IN_PROGRESS`, `server.NEW_MATCH_NOT_READY` and `server.REMATCH_DECLINED` were written by Claude, not by a speaker. Italian is what most of the player base reads, so a clumsy string ships to them. (English is the source of truth for copy — see ARCH-19; the code does not enforce that yet.) **Batch 8 adds one more, and it was a judgement call nobody ratified:** the per-seat pass marker reads **PASSO**. The obvious word, *PASSA*, is byte-identical to the PASSA button's label, which would make one word mean both "an action you can take" and "a seat's state". *PASSO* is the player's own declaration and is ungendered. UX-02's open question 4 asking for this wording was never answered in `DECISIONS.md`. | **Owner** — not a batch | open |
| Batch 10 · (new) | Wrap the socket-event emits the native tests fire in `act(...)` | Every `npm run test:native` run still prints **78 `console.error` blocks** (unchanged — verified this session), surfacing under six **PASS** lines. `tests/native/rejoinFailed.test.tsx:88-90` documents *why* it is not the mechanical fix it looks like: delivering an event inside `act()` was tried and made react-test-renderer drop the resulting update entirely, so the tests currently call the listener bare and rely on `waitFor` to flush it. The real fix is finding the async `act()` pattern that flushes without dropping updates (or a properly scoped console filter, not a blanket one — a global suppression of "not wrapped in act" would hide a genuinely new bug the same shape as the two this exact warning class has already caught twice). Batch 12 read the code and reproduced the count, but did not find or verify that pattern. | **Owner** — not a batch | open |
| Batch 10 · (new) | Send `game:match_state` on rejoin — a reconnecting player is shown the wrong match target | `server/socket.ts` emits it at exactly two places, `room:start` (`:1940`) and `game:rematch_vote` (`:2203`). **No rejoin path emits it at all**, so a client that reconnects, cold-starts or is rehydrated after a server restart keeps `INITIAL_MATCH` (`context/OnlineGameContext.tsx:58`): target 21, empty scores, length `"match"`. `game:over` corrects it, so the wrong figures show for the rest of the current manche — minutes, not a flash — on the format label (`app/(online)/game.tsx:257`), the result screen and the game-over overlay. It was already wrong for a `single` game and for the running scoreboard; **RULE-06 makes it wrong about the number too**, since a 2-seat table now plays to 7 and a 3-seat one to 14 while the rejoined client still says 21. The fix is one emit on the rejoin paths, which is `server/socket.ts` and so outside Batch 10's declared scope. Sits with the RES-03 cold-start row above. | **Batch 13** (it owns the `server/socket.ts` seams) | open |
| Batch 12 · A11Y-02 | Prove the exchange overlay traps focus with a Playwright case | Driving an **offline** game to its first hand's end via `tests/e2e/helpers/bot.ts` (needed to reach the exchange phase) stalled short of completion four times running — both 2- and 4-player, up to 9 minutes each, always converging (never a frozen description, so the driver's own stall watchdog never fired) but never finishing. `driveGameToCompletion` is exercised elsewhere only against **online** (server-authoritative) games; this may be the first attempt at driving an offline one to a real finish, and something in that path is materially slower or gets stuck near the end in a way worth its own investigation, separate from A11Y-02's actual accessibility question. `tests/blockingOverlays.test.ts` still pins the structural half (the overlay is a real `<Modal>`, which is what buys the trap) — that part is unaffected. | **Owner** — not a batch | open |

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

- **Batch 9 · (new) — register-against-the-E2E-stack 500.** Not reproducible: `POST
  /api/auth/register` was called 16 times in a row against a fresh `scripts/e2e-server.mjs`
  boot with no failure, and the full `tapTargets.spec.ts` suite (which registers an account in
  most of its cases) is green. The most likely cause was the same one Batch 4's row above
  named — `reuseExistingServer` adopting a stale server serving old code — which Batch 12's fix
  for that row removes. **No code change of its own; closed by verification, not by a
  commit.**

---

## Decisions

**All closed.** `DECISIONS.md` D1–D6 answer every question that blocked implementation.
**No batch is waiting on anything.** Two questions remain recorded there (the Expo Go landing
page, the severity rubric) and both carry a stated default, so no session will stop to ask.

If a batch tells you a decision is missing, that is a bug in the plan — say so rather than
guessing.
