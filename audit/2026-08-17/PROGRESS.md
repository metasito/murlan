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
| - [ ] 7 | Render hot path | 4 | high | Opus | not started | | |
| - [ ] 8 | Game feel | 11 | medium | Sonnet | not started | | |
| - [ ] 9 | Accessibility | 13 | high | Opus | not started | | |
| - [ ] 10 | Rules correctness | 10 | high | Opus | not started | | |
| - [ ] 11 | Layout and overflow | 11 | low | Sonnet | not started | | |
| - [ ] 12 | Test coverage where it matters | 13 | high | Opus | not started | | |
| - [ ] 13 | Architecture seams | 9 | **max** | **Opus** | not started | | |
| - [ ] 14 | Docs truth and housekeeping | 11 | low | Sonnet | not started | | |

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

**123 findings total.** 3 Critical, 17 High, 61 Medium, 42 Low.

---

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
| Batch 6 · PERF-02 | Ship web-specific WOFF2 Latin subsets — step 3 of the finding | PERF-02's fix is three steps and its acceptance criteria are split accordingly. Steps 1 and 2 landed: the unreferenced `Rajdhani_400Regular` is gone, every weight is imported by subpath instead of through the barrel that `require`s all nine weights and nine italics, and the render gate no longer blocks first paint. That took the shipped TTF from 12,098,616 to 2,568,828 bytes and the bytes blocking first paint on web from 2,475,596 to 0. **Step 3 is not done**, so its criterion — total font bytes fetched on a web cold load under 300 KB — is unmet: the remaining ~2.12 MB of app fonts still ships as TTF (roughly halved on the wire by PERF-01's gzip). A Latin subset would take it to ~200 KB, and the finding asks for the subsets to be generated in `scripts/build.js` so no tooling is needed at deploy time on Replit. | **Batch 12** (it owns `scripts/build.js` — TEST-05 and TEST-06 harden that same script) | open |
| Batch 6 · PERF-02 / PERF-08 | Run the two device-and-browser checks these findings name | Neither is runnable from this environment and both are stated criteria. PERF-02's fix risk names `tests/e2e/tableFit.spec.ts` and `tests/e2e/tapTargets.spec.ts` as the specs that would catch a layout shift from the font swap, and says to run them locally because CI does not — which is the same gate the Batch 4 row below describes as unmanned. PERF-08's criterion is that all twelve effects still play on web, iOS and Android, and its fix risk says to verify MP3 decoding on a real iOS device rather than a simulator. The risk is small (AVFoundation has decoded MP3 for as long as it has existed) but it is asserted, not measured. | **Owner** — not a batch | open |
| Batch 5 · (new) | Replace every `Alert.alert` in `app/` — it shows nothing on web | `react-native-web`'s `Alert` is `static alert() {}`, so every `Alert.alert` call is invisible on the bundle Replit serves. RES-09 fixed the one site whose acceptance criterion depended on it (the online lobby's error). The two that matter and remain are in `app/(online)/game.tsx`: the quit confirmation and the "Partita interrotta" dialog. A confirmation that never appears means its destructive branch never runs — on web the quit button does nothing. No audit finding covers this. Detail in `REMARKS.md`. | **Batch 11** (it owns the client UI surfaces) | open |
| Batch 4 · (new) | Stop the E2E suite reusing an unbuilt server — `reuseExistingServer: !process.env.CI` | `tests/e2e/playwright.config.ts:39` adopts whatever already holds port 5199, however stale, with none of the `webServer.env` block applied. Batch 4's `reconnect.spec.ts` run timed out against a server 21h older than the branch, serving a bundle 16h older, and never reached any reconnect code. `retries` is 0, so there is no flake signal either. A gate that can pass or fail on a binary nobody built is the `CLAUDE.md` self-defeating-safeguard shape. Fix: `reuseExistingServer: false`, keeping `E2E_SKIP_BUILD=1` as the explicit local fast path. **Compounded by Batch 5:** `.github/workflows/ci.yml` runs no Playwright step at all, so every acceptance criterion across the audit that names a `tests/e2e/*.spec.ts` case is verified by nothing on a runner. Both halves belong to the same fix. Detail in `REMARKS.md`. | **Batch 12** (it owns test/build hardening) | open |
| Batch 4 · RES-03 | Give a cold-start rejoin a `room` when the roster read fails | RES-03(a) gives `emitRoomStateTo` its own `.catch` so a failed `getRoomPlayers` cannot fail a rejoin that holds a valid seat — which is the fix RES-03 asks for. A *reconnecting* client still holds the `room` it had. A **cold start** holds nothing, and the navigation chain needs `room`, so the player lands on the game screen's null state. NET-03's `room:rejoin` does not reach it; the client would have to notice "game state but no room" and re-ask, which is new logic on a different path. | **Batch 13** (it owns the `server/socket.ts` seams) | open |
| Batch 3 · SEC-01 / RULE-01 | Have a native Italian speaker read the new server-error strings | `server.MATCH_IN_PROGRESS`, `server.NEW_MATCH_NOT_READY` and `server.REMATCH_DECLINED` were written by Claude, not by a speaker. Italian is the UI language and the source of truth for the other two locales, so a clumsy string ships to every player. | **Owner** — not a batch | open |

### Not carried forward — closed as designed

Recorded so nobody re-opens them looking for missing work:

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
