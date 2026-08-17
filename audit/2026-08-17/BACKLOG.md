# BACKLOG — Murlan audit, 2026-08-17

Repo at `b894af461550cd1a184a6a6f1694baf10d27b70c`, branch `main`.
**120 findings filed by ten specialists → 7 merged → 113 surviving → +9 promoted from the
reports' `Opinions` and untested-rule enumerations (Appendix A) → +1 created by an owner
decision (Appendix B) → 123 tracked.**

| Severity | Count |
|---|---|
| **Critical** | 3 |
| **High** | 17 |
| Medium | 61 |
| Low | 42 |

**Owner decisions are recorded in `DECISIONS.md`** — D1–D4 answer four of the eight open
questions and fully unblock Batch 3. Q5 (multi-session, blocks NET-06 in Batch 5) and Q2 (the
2- and 3-player match target, blocks RULE-06 in Batch 10) remain open.

## How to read this file

The table below is the authoritative, ordered list. Every row's **full schema entry** —
Problem, Impact, Repro/proof, Proposed fix, Acceptance criteria, Fix risk — lives in the
source report named in the Category column, under the same finding ID, in the exact schema
the brief specified. Those files are the detail:

```
findings/01-security.md   findings/02-rules.md      findings/03-netcode.md
findings/04-resilience.md findings/05-performance.md findings/06-ui-visual.md
findings/07-ux-gamefeel.md findings/08-a11y-mobile.md findings/09-architecture.md
findings/10-testing-build.md
```

**Full entries are reproduced here only where the orchestrator changed something** — a merge,
a severity change, or a corrected claim. Those are in §Amended entries below, and they
supersede the source report. Everything else: go to the report, the entry is complete there
and has not been altered. This keeps one source of truth rather than a 7,000-line copy that
will drift on the first edit.

Read `CONFLICTS.md` before starting Batch 3 or Batch 13 — both contain ordering hazards that
will cost you a debugging session if you meet them cold.

---

## Fix order

Batches are ordered so that each one's verification is possible when you reach it. **Batch 1
is not the most severe work — it is the work that makes every later batch's acceptance
criteria mean anything.** Today CI cannot fail a test (TEST-01), so "add a test that proves
it" is not yet a gate.

| # | Batch | Findings | Theme |
|---|---|---|---|
| 1 | Restore the safety net | 6 | CI can gate again |
| 2 | Server operational integrity | 7 | Credentials out of logs; the process fails loudly |
| 3 | **The match lifecycle** | 7 | `finished` is overloaded — the audit's core defect |
| 4 | Reconnect and error surfacing | 8 | Stop silently ejecting players |
| 5 | Robustness and session safety | 6 | Timers, tabs, deletion, spectate |
| 6 | Bytes on the wire | 6 | First paint |
| 7 | Render hot path | 4 | The table during a hand |
| 8 | Game feel | 11 | The feedback that isn't there |
| 9 | Accessibility | 12 | Make the game playable non-visually |
| 10 | Rules correctness | 10 | The edges of a correct engine |
| 11 | Layout and overflow | 10 | Content you cannot reach |
| 12 | Test coverage where it matters | 13 | The guards that don't guard |
| 13 | Architecture seams | 9 | Make `socket.ts` testable |
| 14 | Docs truth and housekeeping | 11 | Stop the docs lying to the next session |

Batch sizes including Appendices A and B: 6 · **7** · **7** · 9 · 6 · 6 · 4 · 11 · 13 · 10 ·
11 · 13 · 9 · 11 = **123**.

### Merged-ID index

The seven merged IDs have no row of their own. If you came here looking for one, it is alive
inside its merge target — nothing was discarded, and every cited location was carried over.

| Filed as | Now lives in | Batch |
|---|---|---|
| NET-02 | **RULE-01** | 3 |
| ARCH-05 | **NET-07** | 4 |
| UI-05 | **UX-12** | 11 |
| A11Y-11 | **UX-12** | 11 |
| NET-10 | **ARCH-08** | 13 |
| UI-08 | **ARCH-02** | 13 |
| TEST-12 | **SEC-06** | 14 |

Every one of the 120 originally-filed IDs therefore resolves: 113 have their own row, 7 resolve
through this table. Appendix A adds 9 more. **122 tracked, 0 dropped.**

---

## The table

`Src` = source report. `Dep` = must land after. **Bold ID** = Critical or High.

### Batch 1 — Restore the safety net

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| **TEST-01** | CI's test step cannot fail — the pipe into `tee` discards the exit code | High | S | 10 | `.github/workflows/ci.yml:61-74` | — |
| **TEST-03** | Declare `esbuild` — prod server bundled by an undeclared 2023 transitive | High | S | 10 | `package.json:12,74-94`, `.replit:10` | — |
| **TEST-04** | Exercise the production build in CI — nothing verifies it before Replit runs it | High | S | 10 | `.github/workflows/ci.yml:42-77`, `scripts/build.js` | TEST-03 |
| TEST-14 | Run `test:native` in CI — 230 tests never gate a merge | Med | S | 10 | `.github/workflows/ci.yml`, `jest.config.js:19-21` | TEST-01 |
| TEST-09 | Complete `serverLoadable.test.ts` — checks 11 of 21 server modules | Med | S | 10 | `tests/serverLoadable.test.ts:4-9` | — |
| TEST-17 | Correct the test counts in `docs/TESTING.md` — all three are wrong | Low | S | 10 | `docs/TESTING.md:9,11` | — |

### Batch 2 — Server operational integrity

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| **RES-02** | **Stop writing the session cookie to the production log on every request** | **Critical** | S | 04 | `server/logger.ts:3-9`, `server/testApp.ts:199-204` | — |
| SEC-04 | Regenerate the session id on login and registration | Med | S | 01 | `server/routes.ts:124-125,157-158` | — |
| RES-06 | Give the Postgres pool an error handler and timeouts | Med | S | 04 | `server/db.ts:5-11` | — |
| RES-05 | Close socket.io on shutdown — every SIGTERM ends in a forced `exit(1)` | Med | S | 04 | `server/index.ts:29-43` | — |
| RES-08 | Make a failed boot exit non-zero instead of being "contained" | Med | S | 04 | `server/testApp.ts:190,211` | — |
| RES-11 | Stop swallowing room-bookkeeping write failures with no log line | Low | S | 04 | `server/socket.ts:1954-1956,2202,2182,2218` | — |
| RES-10 | Log the outcome of a hand — a disputed result cannot be reconstructed | Med | S | 04 | `server/socket.ts:732-944,820-830` | RES-02 |

### Batch 3 — The match lifecycle · read CONFLICTS.md C5 and C6 first

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| **SEC-02** | **Score an abandoned hand instead of discarding it** | **Critical** | L | 01 | `server/socket.ts:643-709`, `server/stats.ts:61`, `server/ratings.ts:84` | — |
| **SEC-01** | **Refuse `room:start` on a match that is still running** | **Critical** | M | 01 | `server/socket.ts:1293-1387,841,768-772` | — |
| **NET-01** | Release the seat when a player leaves or drops at the results screen | High | M | 03 | `server/socket.ts:2168-2193,1924-1927,664-677,1539-1545` | — |
| **RULE-01** | Deal the next manche from the running game's roster, not `room_players` *(merged: NET-02)* | High | M | 02+03 | `server/socket.ts:1548-1583` | — |
| RULE-02 | Bot seats always vote against a rematch — their score key is stripped by design | Med | S | 02 | `server/socket.ts:961-974`, `server/onlineGameLogic.ts:78-87` | — |
| UX-13 | Mark a bot-controlled seat persistently, not only in the takeover banner | Med | S | **D3** | `components/GameShared.tsx`, `server/socket.ts:697-704` | NET-01 |
| ARCH-07 | Fold `handleLeaveRoom` / `handleLeaveRoom_lobby` and give it an honest name | Low | M | 09 | `server/socket.ts:2153-2232` | NET-01 |

### Batch 4 — Reconnect and error surfacing

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| **RES-01** | Give the root ErrorBoundary a fallback it can actually render | High | S | 04 | `app/_layout.tsx:78-98`, `components/ErrorFallback.tsx:26` | — |
| **RES-03** | Stop turning a transient rejoin failure into a forfeited game | High | M | 04 | `server/socket.ts:1601-1748` (esp. `:1632`, `:1742-1745`) | — |
| **NET-03** | Add a room-level rejoin — a lobby reconnect strands the player | High | M | 03 | `server/socket.ts:1924-1927,2196-2213`, `app/(online)/room.tsx` | — |
| NET-07 | Tell the player why a rejoin failed *(merged: ARCH-05)* | Med | S | 03+09 | `context/OnlineGameContext.tsx:414-434`, `server/socket.ts:1615,1658,1672,1683,1744` | NET-08 |
| NET-08 | The stale-rejoin guard is inverted — it switches off exactly when needed | Med | S | 03 | `context/OnlineGameContext.tsx:414-421` | — |
| NET-04 | Stop `game:rejoin` re-arming the whole room's turn timers | Med | S | 03 | `server/socket.ts:1649,1740,1869,526-550` | — |
| RES-07 | Do not treat a network failure at boot as "logged out" | Med | S | 04 | `context/AuthContext.tsx:26-42` | — |
| ARCH-01 | Send one payload shape for `game:player_reconnected` | Med | S | 09 | `server/socket.ts:1868` vs `:1642-1648` | — |
| RES-12 | Remove the second reconnect loop — `SocketContext` backs off on top of socket.io's own | Low | S | App. A | `context/SocketContext.tsx:124-135`, `lib/socket.ts:58-62` | — |

### Batch 5 — Robustness and session safety

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| **RES-04** | Contain throws in the bot and AFK timer callbacks — they freeze the table forever | High | M | 04 | `server/socket.ts:538-544,552-586,589-610` | — |
| NET-06 | One socket per user blackholes a second tab, then evicts the first | Med | M | 03 | `server/socket.ts:131,1054,388-400,1904,1919` | — |
| SEC-05 | Rate-limit the socket.io handshake | Med | M | 01 | `server/socket.ts:1030-1049,1878-1888` | — |
| SEC-03 | Stop an account deletion mid-hand from wiping the whole table's results | Med | M | 01 | `server/routes.ts:211-222`, `server/stats.ts:57-148` | — |
| NET-05 | Reset `isSpectator` when the spectate attempt fails | Med | S | 03 | `context/OnlineGameContext.tsx:500-517` | — |
| RES-09 | Do not navigate to the game screen before spectate is answered | Med | S | 04 | `app/(online)/index.tsx:73-80` | NET-05 |

### Batch 6 — Bytes on the wire

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| **PERF-01** | Enable HTTP compression on the Express server | High | S | 05 | `server/testApp.ts:116-127`, `package.json` | — |
| PERF-09 | Set a long `Cache-Control` on the content-hashed web assets | Low | S | 05 | `server/testApp.ts:116-121` | PERF-01 |
| **PERF-02** | Stop blocking first paint on 2.36 MB of uncompressed TTF | High | M | 05 | `app/_layout.tsx:55-63,76` | — |
| PERF-04 | Import icon families by path, not from the `@expo/vector-icons` barrel | Med | S | 05 | 23 files, `docs/BUNDLE.md:101` | — |
| PERF-08 | Ship the sound effects compressed instead of 843 KB of raw WAV | Med | M | 05 | `lib/sounds.ts:99-112`, `scripts/build-sounds.mjs` | — |
| PERF-10 | Re-measure `icon.png`/`splash-icon.png` — the closing note tests the wrong thing | Low | S | 05 | `docs/BUNDLE.md:102`, `scripts/bundle-report.mjs:140-147` | — |

### Batch 7 — Render hot path

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| **PERF-03** | Get the game table back under the React Compiler, and memoize the card components | High | M | 05 | `components/GameTable.tsx:383`+6 suppressions, `GameShared.tsx:610,514,173,968,1223,364`, `CardView.tsx:462` | — |
| PERF-05 | Stop animating `box-shadow` every frame on the container holding the hand | Med | S | 05 | `components/GameShared.tsx:968-1029`, `GameTable.tsx:697-718` | PERF-03 |
| PERF-06 | Take `reactions` out of the shared online-game context value | Med | S | 05 | `context/OnlineGameContext.tsx:132,358-366,603-643` | — |
| PERF-07 | Make the replay list read only what it uses, and index the ownership predicate | Med | S | 05 | `server/replays.ts:13-14,49-68`, `shared/schema.ts:121-131` | — |

### Batch 8 — Game feel

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| **UX-01** | Send the validated cards, not the raw selection; clear it when the server moves for you | High | S | 07 | `components/GameTable.tsx:468-471,815-821`, `app/(online)/game.tsx:98-107` | — |
| **UX-02** | Make a pass visible — half of every hand happens in silence | High | M | 07 | `components/GameTable.tsx:822-827,845`, `GameShared.tsx:285-360` | — |
| UX-03 | Fix the win/lose sting lookup — it searches an id list for a display name | Med | S | 07 | `components/GameTable.tsx:686-692`, `lib/gameEngine.ts:750,770` | — |
| UX-04 | Do not wipe the winning cards as the round is won; stings play inverted | Med | M | 07 | `lib/gameEngine.ts:830-833`, `GameTable.tsx:602-611,650-666` | UX-03 |
| UX-05 | The same seat winning twice running shows no tag and plays no sound | Med | S | 07 | `components/GameTable.tsx:421,650-666`, `lib/gameEngine.ts:833,845` | UX-04 |
| UX-06 | "TROPPO BASSA" is shown for every rejection with a built combination | Med | S | 07 | `components/gameTableModel.ts:173-184`, `locales/it.ts:244,246` | — |
| UX-11 | Nothing in the game gives failure feedback — both failure haptics are tutorial-only | Low | S | 07 | `lib/haptics.ts:44-47`, `components/GameTable.tsx:1080-1085` | UX-06 |
| UX-09 | The notification banner covers the table's turn indicator and countdown | Med | M | 07 | `app/_layout.tsx:37-51`, `components/NotificationBanner.tsx:149-168` | — |
| UX-07 | The offline 20-second auto-pass fires with no sound, haptic or explanation | Med | S | 07 | `app/game.tsx:27,136-141`, `context/GameContext.tsx:360-368` | UX-09 |
| UX-10 | Cards cannot be touched outside your turn, so every clock starts from a blank selection | Med | M | 07 | `components/GameTable.tsx:809-814,1059-1067` | UX-01 |
| UX-08 | Backing out of the first-run tutorial re-opens it forever | Med | S | 07 | `app/index.tsx:302-309`, `app/tutorial.tsx:420-449` | — |

### Batch 9 — Accessibility

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| **A11Y-01** | Attach the table and hand screen-reader descriptions to a real accessibility node | High | M | 08 | `components/GameTable.tsx:932-944,1058`, `gameTableModel.ts:325-419` | — |
| **A11Y-02** | Make the blocking game overlays real modals — the table stays focusable behind them | High | M | 08 | `ExchangeModal.tsx:158-163`, `GameOverOverlay.tsx:204-208`, `ResultExchangeOverlay.tsx` | — |
| A11Y-03 | Stop relying on props react-native-web silently drops | Med | M | 08 | 24 `accessibilityState` + 19 `accessibilityHint` sites | — |
| A11Y-04 | Expose which cards are selected | Med | S | 08 | `components/CardView.tsx:462-582` | A11Y-03 |
| A11Y-05 | Combo chip and winner tag fail AA on the felt (2.49–4.31:1) | Med | S | 08 | `components/GameShared.tsx:1156-1177,1126-1144` | — |
| A11Y-06 | `contrast.test.ts` measures a felt colour nothing is drawn on; opponent names 3.43:1 | Med | S | 08 | `tests/contrast.test.ts:72-76`, `GameShared.tsx:1060-1066` | — |
| A11Y-07 | `Colors.danger` used as body text, in neither contrast list — 4.07:1 | Med | S | 08 | `components/SettingsModal.tsx:498`, `tests/contrast.test.ts:91-122` | — |
| A11Y-08 | Raise the hand's minimum overlap step — cards expose a 22–35pt tap strip | Med | M | 08 | `components/handLayout.ts:12-34,62-73` | — |
| A11Y-09 | Bring the sub-44pt controls up to size — nothing in the repo measures target size | Med | S | 08 | `GameTable.tsx:1352-1360`, `GameOverOverlay.tsx:458-484`, `SettingsModal.tsx:457-482` | — |
| A11Y-13 | Cap font scaling on the fixed-size boxes, or they clip at large text sizes | Med | M | 08 | `CardView.tsx:651-688`, `GameTable.tsx:1219-1246` | — |
| A11Y-10 | Gate the three unguarded layout animations on the motion preference | Low | S | 08 | `GameTable.tsx:336-338`, `GameOverOverlay.tsx:205-207`, `GameShared.tsx:556-560` | — |
| A11Y-12 | Set `autoComplete` / `textContentType` on the login and register fields | Low | S | 08 | `app/auth.tsx:110-147` | — |
| A11Y-14 | Un-nest the two `Pressable`s in the notification banner | Low | S | App. A | `components/NotificationBanner.tsx:116-145` | — |

### Batch 10 — Rules correctness

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| RULE-03 | Rotate the deal — seats 0 and 1 receive the extra card in every manche, forever | Med | M | 02 | `lib/gameEngine.ts:243-251`, `docs/RULES.md:38` | — |
| RULE-04 | Refuse teams mode with anything other than four seats | Med | S | 02 | `server/socket.ts:1311,1337-1340`, `app/(online)/room.tsx:360-361` | — |
| RULE-05 | Do not call a match a draw when one player is ahead at the final target | Med | S | 02 | `lib/gameEngine.ts:1152-1177` | — |
| RULE-06 | Scale the match target to the player count — a 1-v-1 partita is ~27 manches | Med | M | 02 | `lib/gameEngine.ts:1098`, `app/lobby.tsx:132-134` | **owner decision** |
| RULE-07 | The exchange winner may hand back the exact card the loser just gave | Low | S | 02 | `lib/gameEngine.ts:1022-1027,957-961` | — |
| RULE-08 | A single-manche teams game credits the win to one seat, not the pair | Low | S | 02 | `server/socket.ts:768-772`, `context/GameContext.tsx:103-111` | — |
| RULE-09 | Delete the unreachable anti-freeze branch — it would play an illegal opening | Low | S | 02 | `context/GameContext.tsx:401-410` | — |
| RULE-10 | An AFK exchange is announced as an automatic pass | Low | S | 02 | `server/socket.ts:612-632,461-468` | — |
| NET-09 | Restore `matchOver` with the teams resolver for a teams match | Low | S | 03 | `server/socket.ts:1690-1707` vs `:778-782` | — |
| NET-11 | Send the turn deadline with the state instead of hardcoding 30 on the client | Low | M | 03 | `app/(online)/game.tsx:33-35,233-238`, `server/socket.ts:153` | NET-04 |

### Batch 11 — Layout and overflow

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| UI-01 | Give `SettingsModal` a scrollable body and a max height *(was High — see CONFLICTS C4)* | Med | S | 06 | `components/SettingsModal.tsx:191-413` | — |
| UI-02 | Wrap the portrait room screen in the ScrollView its landscape twin already has | Med | S | 06 | `app/(online)/room.tsx:583-696` | — |
| UI-03 | Make the portrait home menu scrollable — it already overflows on a current iPhone | Med | S | 06 | `app/index.tsx:398-459,605` | — |
| UI-04 | Replay transport controls render behind the table's top bar and felt | Med | S | 06 | `app/(online)/replay.tsx:115-186`, `GameTable.tsx:903,1219-1227` | — |
| UI-06 | `MenuLayout` imposes no content max-width; menu screens stretch across a desktop browser | Med | S | 06 | `components/MenuLayout.tsx:28-77`, `MenuCard.tsx:16` | — |
| UI-09 | The reaction panel's hardcoded `top: 52` puts it over the top bar on web | Low | S | 06 | `components/ReactionLayer.tsx:138-152` | — |
| UI-10 | The replay screen renders a blank screen while it loads | Low | S | 06 | `app/(online)/replay.tsx:30-33,101` | — |
| UI-11 | The profile's ladder card is the only data card with no error state | Low | S | 06 | `app/(online)/profile.tsx:295-320` | — |
| UI-12 | A notification arriving while the settings modal is open is never seen | Low | M | 06 | `components/SettingsModal.tsx:192-201`, `NotificationBanner.tsx:149-155` | UI-01 |
| UX-12 | Blocking user-facing strings that never go through `t()` *(merged: UI-05, A11Y-11)* | Low | S | 07+06+08 | `GameTable.tsx:1189-1199`, `SocketContext.tsx:164-192`, `OnlineGameContext.tsx:377-378` | — |
| UI-13 | Move `GameShared`'s inline JSX styles into the token system (bare `zIndex: 50`) | Low | S | App. A | `components/GameShared.tsx:840-873` | — |

### Batch 12 — Test coverage where it matters

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| **TEST-02** | Test the two server-authority checks that stop the obvious cheats | High | M | 10 | `server/socket.ts:1414,1417-1420,1430-1440` | TEST-01 |
| TEST-07 | Make `reducedMotion.test.ts` check animations, not files — a no-op for all 118 | Med | M | 10 | `tests/reducedMotion.test.ts:34-63` | — |
| TEST-08 | Close the blind spots in the three other source-scanning tests | Med | M | 10 | `tests/socketEvents.test.ts:31,46`, `tokenRoles.test.ts:68`, `motion.test.ts:78-84` | — |
| TEST-10 | Cover the rematch decision — three pure functions, zero test references | Med | S | 10 | `lib/gameEngine.ts:1247-1274` | — |
| TEST-11 | Give `handleGameOver` a testable seam — 213 lines with no unit coverage | Med | L | 10 | `server/socket.ts:732-945` | ARCH-04 |
| TEST-05 | Fail the static build when the asset extractor finds nothing | Med | S | 10 | `scripts/build.js:314-358,540-544` | TEST-04 |
| TEST-06 | Stop `build.js` adopting a Metro server it did not start | Med | S | 10 | `scripts/build.js:108-152` | TEST-04 |
| TEST-15 | Raise the E2E AFK timeout above the card-click budget | Med | S | 10 | `scripts/e2e-server.mjs:35`, `tests/e2e/helpers/bot.ts:73` | — |
| TEST-18 | Pin the turn-rotation direction — both halves of the "senso orario" claim are unpinned | Low | S | App. A | `lib/gameEngine.ts:852-861`, `tests/flow.test.ts:173,181` | — |
| TEST-19 | Test `aiChoosePlay` at 2 and 3 seats, in teams mode, and with a non-3♠ `requireCard` | Low | S | App. A | `lib/gameEngine.ts:621-723`, `tests/botPersonalities.test.ts:32-40` | — |
| TEST-20 | Play a 3-player game end to end in a test — no test ever does | Low | S | App. A | `lib/gameEngine.ts:243-251`, `tests/deal.test.ts:57` | — |
| TEST-21 | Raise the enumerator property test above 10 cards — it never sees a real hand | Low | M | App. A | `tests/enumerator.property.test.ts:17`, `tests/straights.test.ts:205-222` | — |
| TEST-22 | Cover the teams hand-end disjunct — it is never the reason the branch fires | Low | S | App. A | `lib/gameEngine.ts:784-787`, `tests/teams.test.ts:99-113` | — |

### Batch 13 — Architecture seams · read CONFLICTS.md C1 and C5

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| ARCH-02 | Card dimensions exist in four places; the CLAUDE.md invariant is false *(merged: UI-08)* | Med | M | 09+06 | `cardFaceModel.ts:11-12`, `handLayout.ts:10`, `gameTableModel.ts:20,31-32`, `ExchangeAnnouncement.tsx:28-29`, `tests/gameTableModel.test.ts:7` | — |
| ARCH-04 | Split `server/socket.ts` so `handleGameOver` can be unit-tested | Med | L | 09 | `server/socket.ts` (2272 L), `:125-138`, `:193`, `:732-945` | — |
| ARCH-06 | Bring the whole `active_games` row under `GAME_SCHEMA_VERSION`; drop `player_ids` | Med | M | 09 | `shared/schema.ts:71-88`, `server/socket.ts:344-386,1662-1713` | — |
| ARCH-15 | Type the `active_games` round-trip instead of `as any` at both ends | Low | M | 09 | `server/socket.ts:352-355,1662,1690`, `shared/schema.ts:165-177` | ARCH-06 |
| ARCH-08 | Delete the four dead socket surfaces, incl. a fully unreachable handler *(merged: NET-10)* | Low | S | 09+03 | `server/socket.ts:1266-1291,832-839,2224`, `socketSchemas.ts:44-46` | NET-01, ARCH-07 |
| ARCH-14 | Delete the dead exports and the dead context surface | Low | S | 09 | `context/InviteContext.tsx`, `lib/gameEngine.ts:867-873,1029-1039` | ARCH-08 |
| ARCH-09 | `GameShared.tsx` has one consumer — "Shared" promises a boundary that does not exist | Low | M | 09 | `components/GameShared.tsx` (1329 L), `GameTable.tsx:76-89` | — |
| ARCH-13 | Match progression is implemented twice, once per authority | Low | L | 09 | `context/GameContext.tsx:98-135`, `server/socket.ts:749-792` | ARCH-04 |
| ARCH-17 | Rename `active_games.room_code` — it stores a room uuid, not the six-character code | Low | S | App. A | `shared/schema.ts:71-88`, `server/socket.ts:344,2097`, `context/OnlineGameContext.tsx:184` | ARCH-06 |

### Batch 14 — Docs truth and housekeeping

| ID | Title | Sev | Eff | Src | Files | Dep |
|---|---|---|---|---|---|---|
| ARCH-03 | Retire `docs/BRIEF.md` §2 and correct four documents describing code that no longer exists | Med | M | 09 | `docs/BRIEF.md:36-91`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `replit.md:49` | ARCH-02 |
| SEC-06 | Correct BACKLOG O9 and plan the `drizzle-orm` bump *(merged: TEST-12)* | Low | S/M | 01+10 | `docs/BACKLOG.md` O9, `package.json:35` | — |
| SEC-07 | Escape the Host header before it reaches the landing page's inline script | Low | S | 01 | `server/testApp.ts:88-99`, `server/templates/landing-page.html:388,396,408` | — |
| SEC-08 | Make username uniqueness case-insensitive in the DB, not just in the check | Low | S | 01 | `server/storage.ts:142-145,446-452`, `shared/schema.ts:8` | — |
| ARCH-10 | Rename `server/testApp.ts` — it is the production app factory | Low | S | 09 | `server/testApp.ts`, `server/index.ts:9,15` | — |
| ARCH-11 | `getSocket()` silently constructs a socket, defeating the singleton invariant | Low | M | 09 | `lib/socket.ts:68-74,45-66` | — |
| ARCH-12 | Name and pin the server-safe subset of `lib/` | Low | S | 09 | `lib/{gameEngine,replay,botPersonalities,achievements,rating,streak}.ts` | TEST-09 |
| ARCH-16 | Give the seven contexts one shape — three throw, three silently no-op | Low | S | 09 | all of `context/` | — |
| TEST-13 | Pin `babel-plugin-react-compiler` — a caret on a prerelease lets the compiler float | Med | S | 10 | `package.json:84`, `app.json:57-60` | TEST-04 |
| TEST-16 | Reconcile the Node version split, and give `server:build` a `--target` | Low | S | 10 | `.github/workflows/ci.yml:52`, `.replit:2` | TEST-03 |
| UI-07 | The numeric half of the design-token scale is unenforced and abandoned | Low | L | 06 | `lib/tokens.ts:138-161`, `eslint.config.js:24-38` | — |

---

## Appendix A — promoted from `Opinions` and from the untested-rule enumerations

The brief routes style preferences to each report's `Opinions (non-findings)` section and asks
A2 separately to enumerate *"rules that are implemented but untested"*. Reviewing both, nine
items were **actionable defects or concrete coverage gaps rather than taste**, and would
otherwise have been lost. Each was verified by the orchestrator before promotion. Two of them
were raised independently by two different agents, which is what flagged them.

They carry full IDs, sit in a batch, and are counted in the totals above.

| ID | Title | Sev | Eff | Origin | Files | Batch |
|---|---|---|---|---|---|---|
| RES-12 | Remove the second reconnect loop — `SocketContext` backs off on top of socket.io's own | Low | S | A4 Opinions | `context/SocketContext.tsx:124-135`, `lib/socket.ts:58-62` | 4 |
| A11Y-14 | Un-nest the two `Pressable`s in the notification banner | Low | S | B4 Opinions | `components/NotificationBanner.tsx:116-145` | 9 |
| UI-13 | Move `GameShared`'s inline JSX styles into the token system | Low | S | B2 Opinions | `components/GameShared.tsx:840-873` | 11 |
| ARCH-17 | Rename `active_games.room_code` — it stores a room uuid, not the six-character code | Low | S | **A1 + A3 Opinions** | `shared/schema.ts:71-88`, `server/socket.ts:344,2097`, `context/OnlineGameContext.tsx:184` | 13 |
| TEST-18 | Pin the turn-rotation direction — both halves of the "senso orario" claim are unpinned | Low | S | A2 enumeration | `lib/gameEngine.ts:852-861`, `tests/flow.test.ts:173,181` | 12 |
| TEST-19 | Test `aiChoosePlay` at 2 and 3 seats, in teams mode, and with a non-3♠ `requireCard` | Low | S | A2 enumeration | `lib/gameEngine.ts:621-723`, `tests/botPersonalities.test.ts:32-40` | 12 |
| TEST-20 | Play a 3-player game end to end in a test — no test ever does | Low | S | A2 enumeration | `lib/gameEngine.ts:243-251`, `tests/deal.test.ts:57` | 12 |
| TEST-21 | Raise the enumerator property test above 10 cards — it never sees a real hand | Low | M | A2 enumeration | `tests/enumerator.property.test.ts:17`, `tests/straights.test.ts:205-222` | 12 |
| TEST-22 | Cover the teams hand-end disjunct — it is never the reason the branch fires | Low | S | A2 enumeration | `lib/gameEngine.ts:784-787`, `tests/teams.test.ts:99-113` | 12 |

### Verification notes on the four promoted from Opinions

**RES-12.** `lib/socket.ts:58-62` already configures socket.io with
`reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000,
reconnectionDelayMax: 5000` — it retries with its own backoff. `context/SocketContext.tsx:126-135`
adds a **second** exponential backoff on `connect_error` that calls `socket.connect()` itself.
Two reconnect loops race on one socket, and the manual `connect()` fires inside socket.io's own
retry cycle. Delete the manual loop and keep the library's; if the library's curve is wrong,
change its options rather than adding a competing timer.

**A11Y-14.** Confirmed: `<Pressable accessibilityRole="alert">` at `:116` **contains**
`<Pressable accessibilityRole="button">` at `:135`. B4 scored this 70 and moved it to Opinions
on the grounds that `role=alert` is a leaf on web so there is no double-announce — that
reasoning is sound but addresses a different problem. The defect is the **nesting**: the outer
Pressable is focusable and interactive, so it can swallow taps meant for the close button, and
a focusable element inside a live region is invalid. Make the outer element a plain `View`.

**UI-13.** Confirmed a `CLAUDE.md` violation, not a preference. `components/GameShared.tsx:843-851`
writes `style={{ position:"absolute", top: topOffset, left:0, right:0, alignItems:"center",
zIndex: 50, pointerEvents:"box-none" }}` — a **bare `zIndex: 50` literal in a style object**,
which the design-system rule explicitly forbids ("a genuinely component-local one-off may be a
named module constant; a bare literal in a style object may not"). It matters beyond style:
B2's report contains a 17-layer stacking table, and an unnamed z-index is exactly what makes
that table necessary. Coordinate with UI-04, UI-09 and UI-12, which are all stacking bugs.

**ARCH-17.** Raised independently by **A1** and **A3**. `shared/schema.ts:72` names the column
`room_code`, and `game:rejoin`'s payload field is `roomCode` — but every writer passes the room
**uuid** (`server/socket.ts:344`, `:2097`, `context/OnlineGameContext.tsx:184`). It is
internally consistent, so nothing is broken. It is promoted because it has a measured cost: A1
recorded that it had to prove the naming was benign "before I could rule out a
room-code-guessing attack on rejoin." A name that costs a security reviewer time is a defect.

---

## Appendix B — work created by the owner decisions

`DECISIONS.md` D3 settled that a vacated seat keeps playing as a bot **and that the table must
be able to see it is a bot**. Half of that already exists; the other half is new work, tracked
here so it is not lost between "a decision was made" and "someone implemented it".

| ID | Title | Sev | Eff | Origin | Files | Batch |
|---|---|---|---|---|---|---|
| UX-13 | Mark a bot-controlled seat persistently, not only in the 4-second takeover banner | Med | S | Decision D3 | `components/GameShared.tsx` (seat/avatar rendering), `components/GameTable.tsx`, `server/socket.ts:697-704`, `locales/{it,en,sq}.ts` | 3 |

**What exists already.** `vacateSeat` emits `game:seat_bot_takeover`
(`server/socket.ts:697-704`) with code `PLAYER_LEFT_BOT_TAKEOVER` and the message
*"X ha lasciato la partita — il computer gioca al suo posto."* That event is correct and
NET-01's fix routes through it.

**What is missing.** It arrives as a `game:notification`, which `NotificationBanner` shows for
4 seconds and discards. After that the seat is visually identical to a human's. A player who
joins their attention to the table 30 seconds later cannot tell they are now playing a bot —
which matters because it changes how they should play, and because the ladder records the
result.

**What to build.** The seat already knows: `game.gameState.players[seat].type` is set to
`"ai"` at `server/socket.ts:660`, and it survives `sanitizeStateForPlayer`, so the client has
the fact without any protocol change. Render a persistent marker on the opponent seat — the
existing avatar/name row in `components/GameShared.tsx` is the place. Distinguish it from a
seat that was *always* a bot if that is cheap; a player who left is a different story from a
bot that was dealt in, and `botSeatNames` already names the latter.

**Acceptance criteria.** A native test asserting that after `game:seat_bot_takeover` the seat
renders its bot marker for the rest of the match, not only while the banner is up. The marker's
label goes through `t()` with keys in all three locales — `tests/i18n.test.ts` pins parity.

**Do it with NET-01, in Batch 3.** Same code path, and NET-01 is what makes the takeover
reachable from the results screen in the first place.

---

## Amended entries

These supersede the source reports. Everything not listed here is unchanged — read it in
`findings/`.

---

### [RES-02] Stop writing the session cookie to the production log on every request
- **Severity:** ~~High~~ → **Critical** *(orchestrator; see CONFLICTS C2)*
- **Confidence:** High — **confirmed by execution**, not by reading
- **Effort:** S (<1h)
- **Location:** `server/logger.ts:3-9`, `server/testApp.ts:199-204`
- **Problem:** `server/logger.ts` sets no `redact` and no `serializers` (grepped: zero hits
  for either). `server/testApp.ts:200-205` mounts `pinoHttp({ logger, autoLogging: { ignore }})`
  with no serializer overrides. pino-http 11's default `req` serializer emits the entire
  `headers` object, which includes `cookie`.
- **Impact:** Every authenticated request writes a **live 30-day session cookie**
  (`server/session.ts:20`) into the Replit log stream in plaintext. Anyone with log-read
  access — a teammate, a support integration, a log shipper, anyone who obtains a log export —
  replays the cookie and holds the account for a month. No password involved, and the cookie
  is `httpOnly`, so the user has no way to notice or revoke it.
- **Repro / proof:** Executed against the repo's own installed pino-http 11.0.0 with the exact
  config above:
  ```
  {"level":30,…,"req":{"id":1,"method":"GET","url":"/api/auth/me",
   "headers":{"cookie":"murlan.sid=s%3ASECRET-SESSION-VALUE.abc123",
              "authorization":"Bearer TOKEN123","host":"murlan.example"},…}}
  session cookie in log?  YES — LEAKED
  authorization in log?   YES — LEAKED
  ```
- **Proposed fix:** Add a `redact` list to the pino instance in `server/logger.ts`:
  `redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'], censor: '[redacted]' }`.
  Prefer `redact` over a custom serializer so future header additions do not silently
  re-open it.
- **Acceptance criteria:** A test asserting a log line produced for a request carrying a
  `cookie` header contains neither the cookie value nor the string `murlan.sid=`. Grep the
  running server's output during the integration suite for `set-cookie` and assert no hit.
- **Fix risk:** None. Redaction is additive and cannot change request handling.
- **Depends on:** None — **and RES-10 depends on this**: do the redaction first so the new
  structured hand-outcome log line lands on an already-safe logger.

---

### [SEC-02] Score an abandoned hand instead of discarding it
- **Severity:** ~~High~~ → **Critical** *(orchestrator; see CONFLICTS C3)*
- **Everything else** — Problem, Impact, Repro, Proposed fix, Acceptance criteria, Fix risk —
  is unchanged and complete in `findings/01-security.md`.
- **Why the change:** the rubric's first Critical clause is "exploitable cheat", and A1's own
  *"The cheapest cheat"* section names this the #1 exploit in the repository: it needs no
  modified client and no protocol knowledge — closing the browser tab is the entire attack.
  Verified at `server/socket.ts:679-691`: `disposeGame` runs without `handleGameOver`.
- **Note:** this is an **XL in practice, not an L.** A1's own Proposed-fix field opens by
  saying it "needs a design decision on the rule, then a contained implementation — write it
  up under `docs/superpowers/` first", which the project's standing agreement requires for
  anything touching storage or the socket protocol. Budget the design doc.

---

### [UI-01] Give `SettingsModal` a scrollable body and a max height
- **Severity:** ~~High~~ → **Medium** *(orchestrator; see CONFLICTS C4)*
- **Correction to the source report's framing:** B2 wrote "on any phone in landscape". The
  modal mounts from **exactly one place** — `app/index.tsx:393` and `:458`, the title screen
  (grepped all of `app/` and `components/`; no other mount site). It is **not** reachable from
  the game table, so no player is stuck mid-game. Rotating to portrait recovers every control.
- **Everything else** is unchanged and correct: the file is 499 lines with zero hits for
  `ScrollView` or `maxHeight`, and it declares `supportedOrientations` including landscape at
  `:200`.

---

### [RULE-01] Deal the next manche from the running game's roster, not from `room_players`
- **Merged from:** A2's `RULE-01` and A3's `NET-02`, filed independently over the same 30
  lines. Both source entries are complete; read `findings/02-rules.md` for the executed
  engine-half proof and `findings/03-netcode.md` for the roster-construction analysis.
- **Severity:** High · **Effort:** M
- **Location (union of both):** `server/socket.ts:1546-1596` — `:1546` (votes cleared before
  the bail-outs), `:1550` (`getRoomPlayers`), `:1551` (`< 2` silent return), `:1554-1562`
  (`playerSetup`, all `type: "human"`), `:1569-1572` (`playerMap` keyed by array index).
  Contrast `server/socket.ts:1320-1347` — what `room:start` actually seated, including its
  comment at `:1325-1330` explaining that it deliberately avoids seat renumbering.
- **The four consequences, consolidated:**
  1. **1 human + bots can never play a second manche.** `players.length` is 1, `:1551`
     returns silently, votes were already cleared at `:1546`. The overlay sits on `1/1`
     forever. This is the *default* solo online flow.
  2. **A mixed table silently shrinks mid-match.** 2 humans + 2 bots becomes 2 seats; the
     points scale changes from 3/2/1/0 to 1/0 while `cumulativeScores` and `matchTarget` carry
     over unchanged.
  3. **The exchange runs between the wrong players.** `prevRankings` holds the old roster's
     engine ids; `initializeRematch` falls back to `0` / `length-1` on a `-1` lookup.
     A2 executed this: a table where bots placed 1st and 2nd produced
     `exchangePhase.winnerIdx = 0` — the human who actually placed **3rd**.
  4. Every bail-out path returns with no `game:error` and no `game:vote_state` update.
- **Proposed fix (reconciled from both agents — they agree):** build the next roster from the
  in-memory game rather than the database. Derive `playerSetup` from `game.gameState.players`
  (name, type, team, personality) and copy `game.playerMap` rather than re-indexing
  `getRoomPlayers`. Replace `players.length < 2` with a check on *seat* count. Move
  `rematchVotes.clear()` to after every bail-out, and emit `game:error` +
  re-broadcast `game:vote_state` when it genuinely cannot proceed. Keep the DB read only for
  `room.gameMode` / `maxPlayers`. Reuse `buildSeatRoster`
  (`server/onlineGameLogic.ts:216-243`) — the same helper `room:start` uses — so the two
  handlers stop building the same structure by two different rules.
- **Acceptance criteria (union):** an integration test with `fillWithBots: true` and one human
  reaches manche 2 with the same seat count and the bot seats still AI-driven; a 2-human +
  2-bot table keeps `players.length === 4` after the rematch; `exchangePhase.winnerIdx` is the
  seat of the previous manche's `rankings[0]`; every bail-out emits a `game:error`.
- **Fix risk:** `playerMap` is what `sanitizeStateForPlayer` uses to decide who sees which
  hand — getting the copy wrong hands a player someone else's cards. Cover with the existing
  "a player never receives another player's hand" assertion in
  `tests/integration/gameplay.test.ts`.
- **Depends on:** None. **Same batch as SEC-01, SEC-02 and NET-01** — all four are the
  `finished`-status cluster.

---

### [NET-01] Release the seat when a player leaves or drops at the results screen
- **One claim softened** *(see REJECTED.md §1)*. A3 wrote that `vacateSeat`'s game-over
  branch (`server/socket.ts:664-677`) "has **no reachable caller**". That is overstated: the
  disconnect **grace timer** at `:1957` calls `vacateSeat` unconditionally, and if the hand
  ends inside that 60-second window the branch does run. Reachable through a narrow race, not
  by design.
- **The finding is otherwise unchanged and verified.** Neither `handleLeaveRoom:2171-2193`
  (no `finished` branch at all) nor `handleLeaveRoom_lobby:2225-2231` (status rewrite only)
  removes a departed player from `playerMap`, and `game:rematch_vote:1545` gates on
  `rematchVotes.size < Object.keys(playerMap).length`. **One player tapping "Torna alla
  lobby" permanently blocks the next manche for everyone else.**
- **Ordering hazard — read CONFLICTS C5.** The fix routes the results-screen leave through
  `vacateSeat`, which emits **`game:player_left`** — the event that drives the client's
  blocking "Partita interrotta" teardown. Adjust the emit at `:667`, not the client. Do not
  confuse it with **`room:player_left`** (`:2224`), which ARCH-08 deletes.

---

### [NET-07] Tell the player why a rejoin failed instead of bouncing them to the lobby
- **Merged from:** A3's `NET-07` and C1's `ARCH-05` — the same finding, filed independently.
  NET-07 carries the five-reason table (`findings/03-netcode.md`); ARCH-05 frames it as a
  break in the `{code, message, params}` error contract used everywhere else
  (`findings/09-architecture.md`). Both entries are complete; implement from NET-07 and take
  ARCH-05's contract framing for the payload shape.
- **Severity:** Medium · **Effort:** S · **Depends on:** NET-08 (same handler)

---

### [ARCH-02] Card dimensions exist in four places, not one
- **Merged from:** C1's `ARCH-02` and B2's `UI-08` (`WEB_TOP_PAD` / `WEB_BOTTOM_PAD` re-typed
  as bare `67` / `34` in five files) — same root cause, different constants, one fix surface.
- **The fix has three parts and shipping only the first is worse than nothing** — see
  CONFLICTS C1 for the full reasoning:
  1. Delete the duplicates; re-export from one module.
  2. **Change the test's shape.** `tests/gameTableModel.test.ts:47` asserts `CARD_W === 58`.
     Every duplicate is also 58, so every duplicate passes — the test cannot detect the thing
     it is credited with detecting, and `:7` imports `CARD_W` from `handLayout.ts`, the second
     copy. Assert single-sourcing (or source-scan, as `tests/tokenRoles.test.ts` does).
  3. Correct the `CLAUDE.md` invariant, which is false in three ways.
- Also note `components/ExchangeAnnouncement.tsx:25-27` justifies its copy with *"Mirrors the
  private CARD_W/CARD_H in components/CardView.tsx (not exported…)"* — **that comment is
  factually wrong.** They are exported from `components/cardFaceModel.ts:11-12`, which is
  where `CardView.tsx` itself imports them. The correct fix there is a one-line import.

---

### [ARCH-08] Delete the four dead socket-protocol surfaces
- **Merged from:** C1's `ARCH-08` and A3's `NET-10` (which covered two of the four).
- **A3 answered the open question directly:** `game:match_over` is **dead server work, not
  missing client behaviour.** The `game:over` payload at `server/socket.ts:820-830` already
  carries all four of its fields (`matchTarget`, `isDraw`, `matchWinners`, `matchContinues`)
  and `context/OnlineGameContext.tsx:320-345` reads all four. Nothing is lost by deleting it.
- **Depends on:** NET-01 and ARCH-07 — see CONFLICTS C5. Delete `room:player_left` (`:2224`);
  **keep `game:player_left`** (`:667`, `:681`).

---

### [SEC-06] Correct BACKLOG O9 and plan the `drizzle-orm` bump
- **Merged from:** A1's `SEC-06` (the package-by-package reachability table) and C2's
  `TEST-12` (the upgrade plan). Read both entries.
- **The substance:** `docs/BACKLOG.md` O9 claims *"Every remaining advisory is in build
  tooling … not in the shipped bundle or the running server."* That is false for exactly one
  package. `npm audit` reports 31 advisories (O9 says 30), and one of the 14 highs is
  **`drizzle-orm <0.45.2`, GHSA-gpj5-g38j-94v9** — the ORM every REST route and socket handler
  queries through, in production.
- **13 of 14 highs and all 17 moderates are genuinely build/dev/test tooling** — A1's table
  verifies each. And the `drizzle-orm` advisory is **not exploitable here**: it requires an
  attacker-controlled SQL *identifier*, and `grep -rn "sql.identifier\|sql.raw"` across
  `server/ shared/ lib/ tests/ scripts/` returns nothing.
- So the immediate defect is **a wrong record, not a live hole** — but the record is what
  stops the next person triaging the list. Correct O9 first (S); plan the 0.39 → 0.45 bump
  separately (M), with `tests/schemaDdl.test.ts` as the guard.
