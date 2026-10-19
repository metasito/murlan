# Murlan test architecture audit (read-only)

Auditor report, 2026-10-16. Scope: `tests/**` except `tools/loop/tests`, at HEAD `d8c34919`. Runtimes are taken from `docs/agents/checks.md`, not measured.

## Inventory

| Folder | Files | Lines | Notes |
|---|---|---|---|
| native | 250 | 29.6k | Runs twice (ios + android), except 4 iOS-only files and 1 compiled. About 8 s per file; 2 shards |
| e2e | 103 specs (72 blocking, 31 nightly) | 17.0k | About 35 s per spec; parity about 2.5 min |
| ui-rules | 102 | 17.1k | About 1 s; 44 read source |
| tooling | 128 | 13.8k | 96 read files; 38 read production source |
| integration | 68 | 14.3k | About 10 s per file; Postgres; `createApp()` |
| server | 72 | 10.5k | 27 read source |
| engine / bots / soak | 28 / 7 / 4 | 5.1k / 1.7k / 1.3k | |
| helpers (26 + 26 + 10) | 62 | 8.3k | |

### Mock and patch counts
- 380 `jest.mock`/`doMock` calls in 150 files: 258 target `@/` modules, and 82 are vendor mocks outside `setup.ts`.
- 82 `requireActual` in 47 files; 423 `jest.fn` in 104; 46 `spyOn` in 20; 41 `t.mock.method` in 12.
- 126 `useFakeTimers` in 109 files; 94 `process.env` writes in 52; 128 `as unknown as`, 20 of them `as SocketServer`.
- Most-mocked modules:

| Module | Mocks |
|---|---|
| expo-router | 47 |
| `@/lib/accessibility` | 46 |
| AuthContext | 36 |
| SocketContext | 20 |
| query-client | 19 |
| NotificationContext | 15 |
| onlineGameHooks | 14 |
| react-query | 12 |
| netinfo | 12 |
| RN `useWindowDimensions` | 11 |
| diagnostics/recorder | 10 |
| lib/socket | 9 |
| GameContext | 9 |
| GameTable | 8 |

---

## P1

### T1 (L). The app contexts have no seam, so tests replace them with partial hand-typed mocks
- **Files:**
  - No context exports its Context object: AuthContext.tsx:41, SocketContext:111, NotificationContext:44, GameContext:141, SettingsContext:68.
  - 97 context mocks (Auth 36, Socket 20, Notification 15, onlineGameHooks 14, Game 9, Online 3), plus I/O mocks: query-client 19, lib/socket 9, react-query 12.
  - The 9-provider stack is inline at app/_layout.tsx:149-162, so no test can mount "the app" with fakes underneath.
  - The four home tests (homeSettingsPillWord, homeReturnToTable, homeFieldPausesOnBlur, tutorialOnce) carry 8–9 mocks each.
- **What's wrong:** each mock is a partial, hand-typed value. A context gaining a field, or changing what a field means, passes every test that mocks it. Tests exercise the screen against an imagined provider, not the real one.
- **Proposed interface:**
  - Export `AppProviders` from the layout, taking the HTTP transport (`apiRequest`) and a socket factory as props.
  - `tests/native/harness/renderApp.tsx({route, user, socket: FakeSocket, http: FakeHttp, window})` mounts the real providers over fakes at the I/O edge.
  - `<AuthProvider initialUser>` for signed-in starts.
- **Dependency category:** remote-owned (HTTP, socket), port plus adapter.
- **Effect:** about 97 context mocks plus 28 I/O mocks deleted. Provider wiring becomes tested by every screen test. **Risk:** medium; needs the clock seam (T8) and the typed socket fake (T3) first.

### T2 (S). Accessibility is mocked 46 times even though it has a public setter
- **Files:** `setMotionPreference` (lib/accessibility.ts:18) is honoured by `usePrefersReducedMotion` (127). 18 files already use the setter. The other 46 mock the module, inconsistently: bannerBand:19, captureScreen:31 and homeReturnToTable:42 return `true` with preference `'off'`; matchOutcomeOnTheFelt:8 returns `false` with `'system'`.
- **Proposed:** delete the mocks; add `afterEach(() => setMotionPreference('system'))` in setup.ts; optionally a ui-rule banning `jest.mock('@/lib/accessibility')`.
- **Effect:** about 180 lines removed; the contradictory mock states disappear. **Risk:** low.

### T3 (M). The socket seam is untyped on both sides, and the integration helper's wire types have drifted
- **Client:**
  - 17 hand-rolled fakes. 9 carry an identical lib/socket mock: acceptInviteClearsPending:30, friendLastSeen:28, friendRequestReconcile:38, friendRowArrivesWithTheBanner:38, sessionReplaced:33, signOutClearsQueryCache:21, socketAccountSwitch:25, socketContextFreshness:28, socketReconnect.
  - 8 mock SocketContext instead (protocolMismatch:14, onlineAutoPass:11, rejoinFailed:24, …).
  - None is typed, and `off(){}` is a no-op, so listener-leak bugs cannot show up.
- **Server:**
  - 11 `io` stubs with 20 casts.
  - `stubIo` is copied 4 times (endMatchVote:51, seatReclaim:50, tableStalls:41, voidAbandonedMatch:28).
  - Other stubs in commitMove:22, exchangeRearm:15, openingGrace:33, shutdownSeatLost:19, seating:25, roundOver:73.
- **Integration:**
  - `client.ts:207 waitFor<T>(socket, event: string)` has 241 calls (97× `RoomState`, 34× `SanitizedState`). The event name is a string and the payload type is asserted by the caller.
  - `table.ts:20-57` and `gameDriver.ts:13-43` re-declare the wire types and **have drifted**: `cardFromLoser` is required there, optional in gameEngine.ts:63.
  - Two round drivers do the same job: `driveRoundToExchangeOrOver` (table.ts:127) and `driveHumansToRoundOver` (gameDriver.ts:57).
- **Proposed interface:**
  - A typed `FakeSocket<S2C, C2S>` with `deliver(event, payload)`, `emitted(event)`, a real `off`, and an ack queue.
  - `FakeIo` for the server, plus a `TableIo` port so handlers take the narrow emitter they use.
  - `waitFor<E extends keyof ServerToClientEvents>(socket, event): Promise<Parameters<…>[0]>`.
  - Delete the type copies in table.ts and gameDriver.ts; merge the two drivers.
- **Effect:** about 26 fakes become 1; 20 casts and about 90 lines go; 241 calls become type-checked, so wire drift fails `tsc`. **Risk:** low-medium.

### T4 (M-L). The global `activeGames` Map and singleton stores make server tests patch modules
- **Files:**
  - `gameRoom.ts:146 activeGames` is mutated directly in 23 test files (36 `set`, 37 `delete`). `liveGame.ts` exports `forgetActiveGame` and `redealExactly` for tests.
  - tableOwnership.test 29-66 enforces ownership by regex, e.g. `/activeGames\.delete[\s\S]{0,200}releaseRoom/`.
  - 41 `mock.method` calls in 12 files patch roomStore (roomStore.ts:57), persistence (gamePersistence:128) and `db.query.activeGames.findFirst` (tableHandlers:140). tableStalls alone has 19.
- **Pattern to follow:** `LobbyPort` (lobbyIntents:18) and `RoundOverWriters` already inject their dependencies.
- **Proposed interface:** `TableRegistry` (`claim`, `get`, `release`, `forEach`) owning the Map, plus an injected `TableStore` port with Postgres and in-memory adapters.
- **Effect:** the 41 module patches and 73 direct Map mutations go; the ownership regex becomes a type-level fact (only the registry can release). Overlaps server.md's ActiveGameStore finding. **Risk:** medium.

---

## P2

### T5 (M-L). Route and socket invariants are checked by parsing source
- **Files:**
  - `routeMountings.ts` builds an AST over routes.ts; used by routesAuthenticated and authRoutesLimited.
  - rateLimiterFactory 19-75; validate 27-29 (`req.body as`); sessionRevocation 35-60; authReplyBeforeMail (checks AST position); socketEvents with 10 scanner tests.
- **What's wrong:** the facts being checked ("this route is authenticated and rate-limited", "every client event has a handler") are declarations the code could make directly.
- **Proposed interface:**
  - `defineRoute({method, path, auth, limiter, body, endsSession?, handler})`, so authentication and the limiter are required fields.
  - A typed handler registry: `satisfies Record<keyof ClientToServerEvents, Handler>`.
  - Keep authReplyBeforeMail as a behaviour test with a fake mailer.
- **Effect:** about 6 parsing tests become `tsc`; a forgotten limiter or handler fails to compile.

### T6 (M). The source-scan suite
- **Files:** `sourceScan.ts` is a 463-line hand-written lexer, with its own 276-line test, while 16 files already use the `typescript` package. 13 private import regexes (layering:23, orientation, flightHooks, e2eRunnableImports, ciScope, assetBarrels, …) duplicate `moduleEdges.ts`.
- **Categories and destinations:**

| Category | Examples | Destination |
|---|---|---|
| Import ownership | audioOwners (duplicates eslint.config.js:25-41), layering, engine/matchState:262, orientation 118-155, rateLimiterFactory | eslint `no-restricted-imports` / `import/no-restricted-paths` |
| Forbidden APIs | workletScheduling, noFocusedTests, e2eFixedSleeps | lint rules |
| Vendor-API decisions | reducedMotion/infiniteAnimations (`withRepeat` ×7), withDelayReduceMotion (`withDelay` ×13), answeredMotionOptsOut, frameCallbackIdentity | typed wrapper plus a lint ban on the raw API |
| Single-path rules | intentsGoThroughSend, tableOwnership, validate | typed seams (T3, T4, T5) |
| Registry completeness | cardMemoComparators, timerEnvIsLive, contextSlices, refusalCodesTested | `satisfies` tables |
| Behaviour by proximity | tableOwnership regex, sessionRevocation, engine/sharedGameFlow:65-74 | behaviour tests |
| Docs / CI / workflows | | keep; no other way to check them |
| Layout constants | touchTargets, fontScaling, stackingIsStated, a11yLabels, blockingOverlays | keep, moved to the TS AST |

- **Effect:** 15–20 tests become lint rules (with editor feedback); about 740 lexer lines go; the decoy class (memory: "a source scan falls to a decoy") shrinks to the docs/layout scans.

### T7 (M). Fixtures are duplicated across tiers
- **Files:**
  - `tests/engine/helpers.ts` (`c`, `j`, `makePlayer`, `makeState`, `mulberry32`) is used by 24 files, none of them native.
  - 45 files define their own card builder and 61 their own player builder; 94 write `GameState` literals (60 native, 14 server, 10 e2e).
  - `mulberry32` is copied in bombFx:7, coneRain:8, particles:18, roundMotes:6, trick:20, plus 2 e2e scripts.
  - 93 files define a METRICS object; the 844×390 window with insets 47/34 appears verbatim 16 times. 97 wrap `SafeAreaProvider`; 21 call `new QueryClient`.
  - 51 files render GameTable directly, beside 5 existing helpers (dealTable, dealTurnTable, closeMatch, landing, pileMounts).
  - 8 GameTable stubs are hand-typed (exchangeHoldsTheTurn:75, offlineAutoPass:64, onlineLeaveConfirm:101, roundEndsOnTable:55, …).
- **Proposed interface:**
  - `tests/support/game.ts`: `card`, `seat`, `state`, `onlineTable`, `rng`, shared by every tier.
  - `renderTable(state, {viewer, window, motion})` for the native tier.
  - `stubGameTable` typed with `ComponentProps<typeof GameTable>`.
- **Effect:** a `GameState` field change is one fixture edit instead of about 94; the stubs fail `tsc` when props change.

### T8 (M). Server configuration arrives through env, and the clock seam has 3 users
- **Files:**
  - `createApp()` (app.ts:192) takes no arguments. 24 `MURLAN_*` variables; tests write them 45 times (37 in integration, e.g. `DISCONNECT_GRACE_MS="500"` ×7 and `AFK_TIMEOUT_MS="300"` ×6).
  - testServer.ts:20-60 sets 6 more; timerEnvIsLive is a regex test that each timer reads env per call; there are 15 `sleep()` calls.
  - The `Clock` port (gameTimers 12-27) has a `fakeClock`, but only 3 users.
- **Proposed interface:** `createApp({timeouts, limits, clock, mailer})`; `startTestServer(opts)` passes them through.
- **Effect:** about 51 env writes and the timerEnvIsLive scan go; the "ESM hoists imports above env writes" class goes (memory note); tests can advance a fake clock instead of sleeping.

### T9 (S-M). There is no randomness seam in the engine
- **Files:** gameEngine 226-262 and 283 call `Math.random` directly; contrast bot.ts:228, which takes `rng`.
- **Workarounds:** offlineMatch:96 `withSeededDeals`; e2e seededRandomness and virtualClock; native socketReconnect patches `Math.random`; `liveGame.redealExactly`.
- **Proposed:** an `rng` parameter on `dealCards` and `initializeGame`, defaulting to `Math.random`.
- **Effect:** four patching mechanisms collapse into one parameter. Overlaps domain.md's RandomSource finding.

### T10 (M). Render-count tests use spy-through mocks
- **Files:** 82 `requireActual` calls; oneTapOneCommit has 9 mocks; legalPlaysPerHand:16; botMoveCost.compiled:21; particles spied 5 times; `traumaFor` 5 times.
- **Proposed:** a Profiler-based `countRenders()` helper, and a pure memoised `legalPlaysFor()` so its cost can be measured without spying.

### T11 (M). Pure logic is stranded in the native tier
- **Files:**
  - `applyRoundToMatch` (GameContext:87) is tested via teamsSingleRound:2-4, which needs jest-expo.
  - renameFailureCopy:10 needs the native tier because i18n pulls in expo-localization.
  - OnlineGameContext is 1137 lines with about 20 handlers, covered by 8 mounting tests (onlineAutoPass, protocolMismatch, rejoinFailed, rematchVoteKeptBetweenRounds, roundEndRefreshesRatings, sliceRenderCounts, spectateFailed, tableNotices).
- **Proposed:** move `applyRoundToMatch` to lib/game; split i18n so string tables load without expo-localization; extract an `onlineReducer`.
- **Note:** CONTEXT.md rejects a reducer for OnlineGameContext, so the third item conflicts with a recorded decision and needs an ADR before ticketing.

---

## P3
- **T12.** `useWindowDimensions` is mocked via an RN private module path 11 times (bannerBand:14, bannerMakesRoom:20, bannerPlacement:20, captureScreen:26, …). Add a `setWindow(w, h)` helper in setup.
- **T13.** The parity spec regex is duplicated at playwright.config.ts:50 and playwright.parity.config.ts:8. Use a `*.parity.spec.ts` suffix instead.
- **T14.** noFocusedTests:33 filters out its own file, so it does not check itself (a self-exempting safeguard). Use `blankCommentsAndStrings`, or move it to eslint (`jest/no-focused-tests`).
- **T15.** 17 engine exports are used only by tests: `canPlay`, `canPlayerPlay`, `findStartingPlayer`, `getCombinationType`, `getCombinationStrength`, `resolveMatch`, `resolveTeamMatch`, `addPlacementPoints`, `nextMatchTarget`, `nextDealFirstSeat`, `targetsFor`, `shuffleDeck`, `freshHandFloor`, `loserHasBothJokers`, `getBestCardFromHand`, `STRAIGHT_MAX_LEN`, and others. Test through the public engine interface or mark them internal.
- **T16.** jest.config.js:19-27 keeps the iOS-only test list by hand. About 11 production files branch on platform (CardView:682, feltCanvas:57, greyLayer:8, useLinkHold:17, settingsSheet:52, keyboard:19, orientation:23, pushRegistration, theme:67, GameContext:54, errorReporting:94). Measure what the double run catches before changing it.
- **T17.** 109 files opt into fake timers one by one. Low value; leave unless a default is wanted.

---

## Overlap between tiers
No material redundancy across tiers. The layout tiers are well layered (native for wiring, e2e for flexbox). The one remaining gap is that seat placement is decided by flexbox, so only e2e sees it.

## Keep
- setup.ts vendor mocks and the single audio mock (`oneAudioMock`).
- The Fabric prop check.
- `Clock`/`fakeClock`, `LobbyPort`, `RoundOverWriters`: the seams to copy.
- Slice hooks plus `onlineContextMock`.
- The integration harness (`startTestServer`, `ensureSchema`) and `captureStates`.
- The jest projects split and the timing budgets.
- `moduleEdges.ts`, the versioned save fixtures, and `protocolHashes.json`.

## Suggested order
T2 → T3 → T7 → T1 → T4 → T8 → T6 → T5 → T9–T11 → P3.
