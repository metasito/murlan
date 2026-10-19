# 07-tests-native — slice review (SRC 50144087)

Scope: 250 files and 29,639 lines under `tests/native/`, every one read in full. All paths below are relative to `SRC/tests/native/` unless they start with another top-level folder. The jscpd-tests report (`phase0/tools/jscpd-tests/jscpd-report.json`) lists 44 clone pairs that touch this slice. Each one is cited where it supports a finding below.

## Findings

### 07-tests-native-F1 (P1, S) Accessibility is mocked in 46 files, and setup.ts does not reset the setter that would replace those mocks
- **files:** the 46 files that mock the module are:
  - bannerBand:19, captureScreen:31, clockCrossFade:9, dealFeel:5, dealTurn:14, dealTurnGrowth:12, handoffEmber:6, homeFieldPausesOnBlur:37, homeReturnToTable:42, homeSettingsPillWord:40, howToPlayEntry:12
  - lampFlareEndToEnd, lampFlareReducedMotion, lampFlareWiring, landingOnContact:17, linkGreyLayers:11, matchOutcomeEdges:9, matchOutcomeOnTheFelt:8, musicRoute:32, nowCueSurvivesAStall:8, offlineBannerLargeText:21, ownLinkHold:20, particleLayerTrace:16, passMarker:13
  - roomSeatFill:10, roundOutcomeOnTheFelt:17, roundOverSting:18, roundStingAtLanding:14, scorePill:9, seatDealArrival:8, seatDimming:8, seatFinishTrophy:9, seatLowCount:7, seatReconnectClock:11, seatTurnClock:19
  - startAnnouncement:24, suitShapes:11, tableCoveredVeil:25, tableNotices:12, tableStatus:12, tapLiftOnUiThread:44, trickClose:15, trickWinnerBanner:19, tutorialOnce:45, tutorialSkip:43, tutorialTableBeats:16
  - setup.ts, which has no `afterEach(() => setMotionPreference('system'))`.
- **problem:** `setMotionPreference` is public, and the files that use it are correct: landWobble:26-29, noticeEntrance, onlineRoundEndsOnTable, roundEndingPill, motionPreferenceDrivesReanimated, tableShakeReducedMotion:110. The mocks are hand-typed and disagree with one another:
  - `true` with preference `'off'` in about 25 files.
  - `true` with `'on'` in linkGreyLayers:11 and scorePill:9.
  - `false` with `'on'` in suitShapes:11.
  - `false` with `'system'` in matchOutcomeOnTheFelt:8. That is the real default, so this mock can simply be deleted.
  - Mutable flags in 11 files.
  - A partial `requireActual` in 5 files (dealTurn, dealTurnGrowth, homeFieldPausesOnBlur, particleLayerTrace, tapLiftOnUiThread). tapLiftOnUiThread imports the setter and resets it at :126 anyway.
  - A mocked `usePrefersReducedMotion` never reaches the code paths that read the preference directly, such as the reanimated ReduceMotion bridge, so these tests run a configuration that cannot occur.
  - The four mocks that only exist to "collapse flight" (passMarker, trickClose, trickWinnerBanner, roundOverSting) express that intent through a fake rather than through the preference.
- **proposed:**
  - Add `afterEach(() => act(() => setMotionPreference('system')))` to setup.ts.
  - Replace each mock with `beforeEach(() => setMotionPreference('on' | 'off'))`. A mutable mock becomes a call inside the test.
  - Optionally add a ui-rule that bans `jest.mock('@/lib/accessibility')`.
- **effect:** about 46 × 5 = 230 lines go, and the contradictory states disappear. The four-line mock blocks are among the most common clones jscpd finds in this tier.
- **overlap:** confirms tests-T2. Adds the full file list, the `true`/`'on'` and `false`/`'on'` variants, and the fact that setup.ts still has no reset.
- **confidence:** high

### 07-tests-native-F2 (P1, M) The socket fakes come in two incompatible shapes, and the common one hides listener bugs by construction
- **files:**
  - **Identical `lib/socket` harness** (a `mockSocket` whose listeners are a `Map<string, Listener>`, a no-op `off(){}`, the same five-function `jest.mock('@/lib/socket')`, an AuthContext mock, and `require`d SocketProvider/NotificationProvider inside a QueryClient tree), in 9 files:
    - acceptInviteClearsPending:12-46
    - friendLastSeen:6-43
    - friendRequestReconcile:17-54
    - friendRowArrivesWithTheBanner:17-53
    - sessionReplaced:17-57
    - signOutClearsQueryCache:10-47
    - socketAccountSwitch:9-60
    - socketContextFreshness:12-65
    - socketReconnect:16-56
  - jscpd confirms these clones: friendLastSeen:6-43 = socketReconnect:10-47, = socketContextFreshness:10-40, = sessionReplaced:27-48; acceptInviteClearsPending:12-36 = sessionReplaced, = socketAccountSwitch, = signOutClearsQueryCache.
  - **`SocketContext` fakes with a no-op `off`:** onlineAutoPass:17, protocolMismatch:20, rejoinFailed:30, rematchVoteKeptBetweenRounds:19, roundEndRefreshesRatings:20.
    - jscpd: onlineAutoPass:7-26 = rematchVoteKeptBetweenRounds:9-28 = roundEndRefreshesRatings:9-30; roundEndRefreshesRatings:8-30 = sliceRenderCounts:27-52; rejoinFailed:15-37 = spectateFailed:16-38.
  - **`Set`-per-event fakes:** sliceRenderCounts:30-48 and spectateFailed:18-39, which carry the same comment word for word. tableNotices:29-43 also has a real `off`.
  - **The typed model to copy:** ownLinkHold:29-45, which is typed and has a real `off`.
- **problem:**
  - sliceRenderCounts:32-33 itself states the defect: "the provider registers more than one `connect` handler, and a map of one would silently keep only the last". The nine Map-based harnesses do exactly that.
  - Because `off` is a no-op everywhere except ownLinkHold and tableNotices, a provider that leaks or double-registers a listener passes every one of these tests.
  - There are about 15 hand-rolled copies.
- **proposed:**
  - `tests/native/harness/fakeSocket.ts`: `createFakeSocket(): FakeSocket` with `on`/`off`/`once`/`timeout`/`emit` over `Map<string, Set<Listener>>`, `deliver(event, payload)`, `emitted(event?)`, `connected`/`active`, `io.reconnection`, and `listenerCount(event)`. It is typed against `ClientSocket` from lib/socket.
  - Two mount helpers: `mountSocketProvider({user})`, used by the 9 files above, and `mountOnlineProvider({userId})`, used by the 8 that mount OnlineGameProvider.
- **effect:**
  - About 15 fakes become one, roughly 400 lines go, and a listener-leak test becomes possible: assert `listenerCount` is 0 after unmount.
  - Test to add with it: unmount a provider and expect no listeners left. Today that test cannot be written.
- **overlap:** extends tests-T3 and client-F11. T3 counted 9 `lib/socket` and 8 `SocketContext` fakes; this adds the Map-of-one defect, the jscpd pairs, and ownLinkHold as the model.
- **confidence:** high

### 07-tests-native-F3 (P1, L) Screens are tested against hand-typed fakes of their contexts: six recurring fake sets, plus two seams for the online state
- **files:**
  - **Online-screen set:**
    - The 6-hook `onlineGameHooks` fake (useOnlineTable / TurnClock / Room / Connection / Match / Exchange): matchEndsOnTable:64-106, onlineCatchUp:38-80, onlineErrorFloat:32-61, onlineLeaveConfirm:45-99, onlineRoundEndsOnTable:36-78, endMatchVoteBanner:52, connectingState:26.
    - A GameTable stub in onlineCatchUp:82, onlineErrorFloat:64, onlineLeaveConfirm:101 and endMatchVoteBanner:102.
    - jscpd: onlineCatchUp:62-82 = onlineLeaveConfirm:81-101; endMatchVoteBanner:69-87 = onlineErrorFloat:38-56; connectingState:31-45 = endMatchVoteBanner:66-80 = onlineRoundEndsOnTable:46-60.
  - **Lobby, room and friends set** (a 3-hook `onlineGameHooks` fake plus Auth, SocketContext and expo-router):
    - joinInviteFromHome:25 and onlineStatusRow:33.
    - roomInviteAndShare:54-74 and roomMatchmakingToggle:40-50, which also share the room literal (:68).
    - friendsActionFailure:8-24 = friendsPresenceRow:15-33 (jscpd), and friendsInviteJoin:9-42.
  - **Offline-screen set** (a GameContext fake, a Notification mock and a GameTable stub):
    - offlineAutoPass:40-78, passAndPlayHandoff:50-68, roundEndsOnTable:34-64, matchEndsOnTable:47-63, exchangeHoldsTheTurn:53-75.
  - **Home prelude** (expo-router, SettingsModal, Auth, GameContext, SocketContext, react-query, query-client, accessibility):
    - homeFieldPausesOnBlur:7-40, homeReturnToTable:14-46, homeSettingsPillWord:14-44, tutorialOnce:17-49.
    - jscpd: homeReturnToTable:36-48 = tutorialOnce:36-51.
  - **Profile prelude and its `show()` fixture:** profileForm:8-101 = profileHistoryCard:11-116 (jscpd: profileForm:76-92 = profileHistoryCard:92-108). Also historyScreen:8-27 and leaderboardScreen:10-16.
  - **Expo-router `Stack` mock:** motionPreferenceDrivesReanimated:13-24 = musicRoute:12-27.
  - **The legacy flat `OnlineGameContext` seam:** onlineContextMock.ts (untyped `value() => unknown`), used by onlineRoundSelection:53, rejoinFailedExit:24 and handMemo:37. handMemo:145 also builds a flat online value by hand.
  - **Auth with two HTTP seams:** authBoot, authLogout and renameAccount mock both `apiRequest` and a raw `fetch`.
- **problem:**
  - Every fake is a partial object literal with no type tie to the hook it replaces. When a slice gains a field, or a field changes meaning, these tests stay green against the imagined provider.
  - The online state has two mock seams: six slice hooks, and the legacy flat context through onlineContextMock. A screen can be "tested" through whichever seam it does not actually read.
  - Fixing a fake means editing up to 7 copies.
- **proposed:**
  - First step, without touching providers: typed fake factories in `tests/native/harness/fakes.ts`.
    - `fakeOnlineHooks(over?: { table?: Partial<ReturnType<typeof useOnlineTable>>; room?: …; … })` returns a `jest.mock` factory body, so a missing field fails `tsc`.
    - `fakeGameContext(state)`, `stubGameTable` typed by `ComponentProps<typeof GameTable>`, and `homePrelude()`.
    - Move the three onlineContextMock consumers onto the slice hooks and delete onlineContextMock.ts.
  - Long term: T1's `AppProviders` plus `renderApp`, so screens mount real providers over F2's fake socket and a fake HTTP transport.
- **effect:**
  - About 40 fake blocks become typed calls, and the second online seam goes.
  - Tests affected: the 38 files above. The deletion test passes: onlineContextMock has no consumer left once the three files move.
- **overlap:**
  - confirms tests-T1 and client-F5 (two mock seams).
  - contradicts the tests.md "Keep: slice hooks plus `onlineContextMock`" line. Keeping both is the two-seam problem client-F5 names, and onlineContextMock still serves three consumers with the flat legacy shape.
- **confidence:** high on the duplication and the two seams; medium on how much a typed factory catches before T1 lands.

### 07-tests-native-F4 (P2, M) Table fixtures are rebuilt in each file, and existing helpers are bypassed
- **files:**
  - The 844×390 / 47 / 34 `METRICS` object is defined in 94 files under tests/native.
  - GameState, seat and table builders are copied in, among others: handMemoTable:21-31, handShadeWiring:18-33, historyScreen:52, legalPlaysPerHand:39-68, playRejection:44-62, passMarker:58-88, linkGreyLayers:55, scorePill, seatTurnClock:33-93, selectionIntegrity:21-73, stagedSelection:24-80, tableStatus:23-69, tableTapFeedback:12-26, trickClose:30-78, trickWinnerBanner:29-76, ceremonyHoldsTheCard:16-31, exchangeDeal:44.
  - jscpd pairs:
    - legalPlaysPerHand:39-68 = trickClose:51-81
    - playRejection:44-62 = trickClose:49-67
    - selectionIntegrity:18-35 = stagedSelection:21-38
    - ceremonyHoldsTheCard:16-31 = selectionIntegrity:18-33
    - onlineRoundEndsOnTable:14-28 = roundEndingPill:19-33
    - bannerBand:34-57 = tableCoveredVeil:40-63
  - **The lampFlare trio** copies METRICS, seat, BOMB_PLAY, ROYAL_PLAY, inPlay and table between lampFlareEndToEnd:35-86, lampFlareReducedMotion:21-74 and lampFlareWiring:28-83 (jscpd, 21–29 lines per pair).
  - **Round-outcome cases:** roundOutcomeOnTheFelt:13-66 and roundStingAtLanding:10-62 (jscpd :13-31 = :10-28) build the same CASES, seat and table beside `helpers/closeMatch.tsx`. roundOverSting writes the same 4-seat teams literal four times in one file (:86, :121, :274, :302).
  - **Inline repeats:** tableNotices renders `<SafeAreaProvider><GameTable …/>` inline 10 times (:128, :259, :336, :350, :371, :397, :426, :445, :573, :618). handShadeRebuild builds the same CardTable twice (:47, :74).
  - **The idle `useFeedbackOnTimeline` state** is copied 5 times: tableShake:18-35, tableShakeReducedMotion:72-88, tableFeedbackIdentity:14-31, traceMomentFollowsShake:16-32, yourTurnCue:18-35.
  - **The `withdrawn()` accessibility predicate** is copied verbatim at startAnnouncement:107-110 and tableCoveredVeil:75-78.
  - **Tutorial METRICS and `withSafeArea`:** tutorialOnce:59-66, tutorialSkip:54-61, tutorialTableBeats:26-29.
  - **Save JSON builders:** offlineDealFirstSeat:26 and offlineResume:32.
  - **The `GameStateBroadcast` builder:** onlineAutoPass:34 and rematchVoteKeptBetweenRounds:33.
  - **Frame steppers:**
    - `helpers/frames.ts` exports `FRAME_MS = 1000/60`, but only setup.ts and ownLinkHold import it.
    - helpers/landing:127, exchangeLegs:85 `frames`, dealTable:58 `frame`, dealTurnTable:28 `advance`, feedback:44 `settle`, exchangeE2EHold:76, exchangeKeyHolds:82, handoffEmber:26, landingNotDropped:17 and hiddenThrows:16 each step by a hand-written 16 ms instead.
  - **Overlapping helpers:** `helpers/dealTurnTable.tsx:9-25` is a generalised copy of dealPool:39-52. The five existing helpers (closeMatch, dealTable, dealTurnTable, landing, pileMounts) each redefine METRICS and a GameState builder.
- **problem:** a GameState field or a GameTable prop change needs edits in about 60 places. Each copy drifts on its own; for example, the 16 ms step differs from the 16.67 ms frame that setup paces rAF at.
- **proposed:** extend `helpers/landing.tsx`, the most-used helper, into `tests/native/harness/table.tsx` exporting:
  - `METRICS`
  - `card`, `seat(i, over?)`, `state(over?)`
  - `renderTable(state, {viewer, spectating, ownLink, turnTimer, …})`
  - `idleFeedbackState(over?)`, `withdrawn(props)`, and `frames(ms, each?)` built on `FRAME_MS`.
  - The five helpers then import from it instead of redefining.
- **effect:** roughly 1,500 duplicated lines go across about 60 files. jscpd's tests/native clone count falls by about 20 of its 44 pairs.
- **overlap:** extends tests-T7. Adds the jscpd pairs, the five idle-state copies, the unused `FRAME_MS`, and the in-file repeats.
- **confidence:** high

### 07-tests-native-F5 (P2, S) tableCardRects and tableCardShadows run the same four 120-second scenarios twice
- **files:** tableCardRects:16-73 and tableCardShadows:20-82 share base, seat, card, table, METRICS, the env/timer setup and the `seen` coverage check (jscpd: tableCardRects:36-75 = tableCardShadows:46-84). They also share the scenarios:
  - a throw: tableCardRects:76, tableCardShadows:85
  - a deal: :95 and :118
  - an exchange leg: :107 and :130
  - a full hand: shadows :95 and :107
  - Each scenario carries a 120,000 ms timeout.
- **problem:** each frame walk (`frames(2000/1600/3000)`) is driven twice, once to read the registry and once to read host shadows. These are the slowest tests in the tier; shadowClusterBuilds runs the same `throwPair` again.
- **proposed:**
  - One scenario driver, `tests/native/helpers/cardScenarios.ts`, that runs each scenario once and passes a per-frame callback.
  - A single file asserting `expectExactlyDrawn()` and `expectNoCardShadow()` on the same frames. Alternatively, keep the two files but import the driver and fixtures.
- **effect:** about 4 slow scenarios and about 60 duplicated lines removed, roughly halving the wall time of this pair.
- **overlap:** new. jscpd lists the clone.
- **confidence:** high on the duplication; medium on the time saved (not measured).

### 07-tests-native-F6 (P2, XS) Assertions that cannot fail, or cannot tell the claim from its absence
- **files and problem:**
  - **handTapStrip:34** `expect(strip / 2).toBeLessThan(strip)` is arithmetic on a positive number and is true whatever the component does.
  - **errorReporting:217-222** ("stops reporting once removed") asserts `listeners.size === 0` straight after the test itself called `listeners.clear()`. It cannot fail.
  - **cardHitBox:25-28** checks `width: expect.any(Number)`, which cannot tell the strip width from the card width the title claims to distinguish.
  - **bannerPlacement:71-80** repeats `getByTestId` existence checks that :53 already made; `getBy` throws, so the follow-up `toBeTruthy` adds nothing.
  - **a11yCollapse:20-41** asserts on RN's own Pressable and Text, not on app code, so no app change can turn it red.
  - **tableShake:43-58** pins a zero offset at rest. Its sibling's header, tableShakeReducedMotion:5-14, records that this sample "proves nothing" about the shake.
- **proposed:**
  - handTapStrip: assert the measured strip against the card height.
  - errorReporting: unmount, or call the returned remover, then emit and assert nothing is reported.
  - cardHitBox: assert the exact strip width.
  - Delete bannerPlacement:71-80 and a11yCollapse:20-41.
  - Fold tableShake into tableShakeReducedMotion as its control case.
- **effect:** six false greens gone.
- **overlap:** new.
- **confidence:** high (each verified against the cited lines)

### 07-tests-native-F7 (P3, XS) Tests that duplicate another test's coverage
- **files:**
  - **friendRequestReconcile:98-107:** `'/api/friends'` is invalidated on connect. That key is already one of `PENDING_KEYS` (:54), which the test at :85-96 asserts. It is a strict subset.
  - **bombBeat:137-142 and bombBurstAnimatesVisibly:68-85** make the same checks (rings > 0, scale > 0.15, no sparks), one through GameTable and one direct.
  - **tableShake** is already covered by tableShakeReducedMotion; see F6.
  - **tableNotices:300-315 and seatTurnClock:166-184** both pin "frozen clock holds its count and runs on". One works on the TurnChip prop, the other through GameTable's `ownLink`, so they partly overlap (medium).
- **proposed:** delete friendRequestReconcile:98-107. Keep a single bomb-burst animation check, the direct one. Keep both clock tests only if `ownLink` → `frozen` wiring is not pinned elsewhere.
- **effect:** about 30 lines and one GameTable mount go.
- **overlap:** new
- **confidence:** high for friendRequestReconcile; medium for the others.

### 07-tests-native-F8 (P2, XS) Timing constants copied into tests as prose
- **files:**
  - **rejoinFailed:54-56** `RETRY_DELAY_MS = 2000` and `MAX_RETRIES = 3`, commented "same file". The real constants are unexported at context/OnlineGameContext.tsx:250-251.
  - **trickClose:35-38** `HOLD_MS = 1800` ("Mirrors TRICK_WINNER_MS") and `BOT_DELAY_MS = 1200` ("`botMoveDelayMs()`'s default"). `TRICK_WINNER_MS` is unexported at components/table/pile.tsx:582.
  - **trickWinnerBanner:82** `MARK_ENTER_MS = 100`.
  - **socketReconnect:64-66** `FIRST_RETRY_MS = 246` is derived by hand from `Math.random = 0.123`, although `reconnectDelayMs(attempt, random)` is exported at lib/reconnectDelay.ts:8.
  - **roomMatchmakingToggle:58** `COUNTDOWN_STEP_MS = 1000`.
- **problem:** each is a premise held in a comment. When production changes the value, these tests either keep passing at the wrong time window or fail without explaining why.
- **proposed:**
  - Export the constants: `REJOIN_RETRY_DELAY_MS`, `MAX_REJOIN_RETRIES`, `TRICK_WINNER_MS`, and the mark-enter duration.
  - Import them in the tests.
  - socketReconnect uses `reconnectDelayMs(0, () => 0.123)`.
- **effect:** five drift sources go, and the exports gain test-only users (tolerable: they are timing contracts).
- **overlap:** new
- **confidence:** high (the unexported constants were checked by grep)

### 07-tests-native-F9 (P3, S) `useWindowDimensions` is mocked through RN's private module path in 11 files
- **files:** bannerBand:14, bannerMakesRoom:20, bannerPlacement:20, bannerReportsRestingBottom:22, captureScreen:26, dealTurn:19, dealTurnGrowth:18, orientationFirstRender:20, startAnnouncement:17, tableCoveredVeil:20, tableRelocksAfterEntry:27.
- **problem:**
  - `react-native/Libraries/Utilities/useWindowDimensions` is internal and breaks on an RN upgrade.
  - setup.ts already calls `Dimensions.set`, so the mock mostly restates a window size.
  - dealTurn and others also hard-code `fontScale: 1` against setup's 2.
- **proposed:** `setWindow({width, height, fontScale})` in setup, wrapping `Dimensions.set` and resetting after each test. Keep the private mock only in orientationFirstRender and tableRelocksAfterEntry, which deliberately simulate a stale bridge value.
- **effect:** nine private-path mocks go.
- **overlap:** confirms tests-T12 (count 11 verified).
- **confidence:** high

### 07-tests-native-F10 (P3, XS) netinfo is re-mocked in 11 files over setup's vendor mock
- **files:** setup.ts:79 installs `@react-native-community/netinfo/jest/netinfo-mock.js`. These 11 files replace it anyway:
  - Nine use a bare `addEventListener: () => () => {}`: accountRecovery:32, authAutofill:22, authBoot:25, authLogout:27, motionPreferenceDrivesReanimated:25, musicRoute:28, registerCheckEmail:26, renameAccount:32, settingsOverlay:13.
  - Two capture listeners so they can drive connectivity: offlineBannerLargeText:11 and tableNotices:18.
- **problem:** the nine plain re-mocks are noise the vendor mock already covers. The two capturing variants each build their own driver.
- **proposed:** delete the nine. Add `setConnectivity(isConnected)` to setup, on top of the vendor mock or a single local one, for the two that drive it.
- **effect:** about 50 lines go.
- **overlap:** new
- **confidence:** medium. That the vendor mock is enough for the nine is inferred from it exporting `addEventListener`; I did not run them.

### 07-tests-native-F11 (P3, M) Spy-through and re-declared vendor mocks
- **files:**
  - **Render counters via mocks:**
    - The `cosmetics.useCardBackId` counter is copied 5 times: cardGloss:37, foilGlint:19, handMemo:14, handMemoTable:7, oneTapOneCommit:52.
    - oneTapOneCommit:22-124 carries 9 spy-throughs (jscpd: oneTapOneCommit:100-126 = tapLiftOnUiThread:17-43).
    - Also botMoveCost.compiled, dealFeel:11-29, exchangeKeyHolds:9 and lampFlareWiring:17-20 (`any`).
  - **`particles.landingDust` spy** in 5 files: dealFeel, hiddenThrows:5, landingDust:5, landingNotDropped:6, landingOnContact:9 (jscpd: hiddenThrows:3-16 = landingNotDropped:4-17).
  - **The Skia Proxy mock re-declared** on top of setup's, 3 times: feltRailDispose:15-34, linkGreyLayers:18-35, particleLayerTrace:22-30.
  - **Other `requireActual` spy-throughs:**
    - `cardShadows` re-wrapped in handShadeRebuild:17, although setup.ts:122 already mocks it.
    - dealPool:10-22 and seatDealArrival:14 (dealSlots and useFrameCallback).
    - legalPlaysPerHand:16.
  - **Reaching past the interface:**
    - tableShakeReducedMotion:31-51 wraps vendor `useSharedValue` and `withSequence`, because `shakeTrauma` is not exposed.
    - bannerHoldsUnderReducedMotion:9 and motionPreferenceDrivesReanimated:11 import reanimated's private `lib/module/ReducedMotion`.
- **problem:** these tests are coupled to module boundaries and vendor internals rather than to behaviour. A file split or a reanimated upgrade turns them red with no product change, and three copies of the Skia mock drift from setup's.
- **proposed:**
  - A Profiler-based `countRenders(id)` helper replaces the cosmetics and memo counters.
  - Export the Skia mock factory from setup and reuse it.
  - Expose `shakeTrauma` (or a `traceOnset('shake', trauma)` event) so tableShakeReducedMotion can drop the reanimated wrapper.
- **effect:** about 25 mocks go.
- **overlap:** extends tests-T10. Adds the Skia ×3, the cosmetics ×5, the reanimated private paths, and the shake capture.
- **confidence:** high on the duplication; medium on the shake seam.

### 07-tests-native-F12 (P3, S) Environment, globals and fake timers are left changed when a test fails or ends
- **files:**
  - **`process.env` written and never restored:** benchRecording:27, dealTurnGrowth:33/53 (not in a finally), frameProbe:10, frameProbeFirstWindow:46, framedScenarios:12, lampVariantsScenario:17, noticeGalleryScenario:12, noticeProbe:13, orientationRows:12, seatAnchorsScenario:19, threadLoadScenario:14, roomInviteAndShare:95. The contrast is shadowClusterBuilds:22-27, tableCardRects:60-66 and motionPreference, which restore it.
  - **Global `fetch` assigned and never restored:** accountRecovery:61, authBoot:59, authLogout:65, registerCheckEmail:80, renameAccount:61.
  - **Fake timers or replaced properties not restored in a finally or afterEach:**
    - pileFlinch:50/75, exchangeOnTable:238-258, seatReconnectClock:41-58 and :62-92, tableCoveredVeil:154-170.
    - lampVariantsScenario never restores fake timers.
    - roomInviteAndShare:187-194 (`Platform.OS` replaceProperty). theme:9-20 shows the correct try/finally shape.
  - **Unawaited unmount:** registerCheckEmail:97, :110, :128, :145.
  - **Order coupling:** signOutClearsQueryCache sets `mockUser = null` at :69 and never resets it.
- **problem:** Jest gives each file its own `process.env` (jest-util createProcessObject), so the leak stays within the file. Even so, one failing test cascades into its later siblings and hides the first cause.
- **proposed:**
  - `withEnv(vars, fn)` and `withFakeTimers(fn)` helpers in setup, or `afterEach(jest.useRealTimers)` globally (T17).
  - `jest.replaceProperty` + `restoreAllMocks` for `fetch` and `Platform`.
- **effect:** later tests in a file can no longer be affected by an earlier one's leftover env, fetch or timers.
- **overlap:** new. Touches tests-T17.
- **confidence:** high (per-file isolation is from jest-util source)

### 07-tests-native-F13 (P3, XS) Two scenario tests share a copied subprocess gate, and each spawns node per test
- **files:** lampVariantsScenario:24-29 and seatAnchorsScenario:27-32 are byte-identical `spawnSync(process.execPath, …)` gate wrappers that differ only in the gate name.
- **problem:** the same harness is written twice, and every `it` pays a node start-up.
- **proposed:** `helpers/scenarioGate.ts` exporting `runGate(name, rows)`, called once per file in `beforeAll`, with its result shared across the file's tests.
- **effect:** about 10 lines and N−1 subprocesses per file go.
- **overlap:** new
- **confidence:** high on the duplication; medium on the time saved.

### 07-tests-native-F14 (P3, XS) Hard-coded English copy and a duplicated `t` helper
- **files:**
  - **English literals instead of `t()`:**
    - joinInviteFromHome:93 'Join a room'
    - matchTurnChip:27, :30 'Match over' / 'Hand over'
    - passAndPlayHandoff:87, :116 "'s turn"
    - playRejection:168, :178
    - roundEndingPill:89-90
    - turnPillNamesTheLitSeat:17, :42, :49, :63 `/'s turn$/`
    - tutorialTableBeats:76 `/^Not yet: /`
  - **A local `t = translate(DEFAULT_LOCALE)`:** historyScreen:49, profileForm:57, profileHistoryCard:53, renameFailureCopy:20, replayControls:18, replayEndStopsPlayback:44, replayExpired:34. Other files import `t` from `@/lib/i18n`.
- **problem:** a copy edit in locales/en.ts turns these red. Two ways of obtaining `t` also exist side by side.
- **proposed:** build the expected text with `t(key, vars)` (tableStatus:141 `filled()` shows the pattern), and import one `t`.
- **effect:** copy changes stop breaking unrelated tests.
- **overlap:** new
- **confidence:** high

### 07-tests-native-F15 (P3, XS) Comments that are false or attached to nothing
- **files:**
  - **lampFlareReducedMotion:7-8** says "the preference is mocked at module scope, so the two cannot share one file". That is false: `setMotionPreference` exists, and landWobble:26-29 switches it inside a single file.
  - **offlineResume:23-24** has a doubled `/** */` docblock ("Reports the bits…") attached to nothing.
  - **profileHistoryCard:4-7** claims that a render which is not unmounted corrupts later renders. profileForm:113-147 leaves its first three renders mounted and passes, and RNTL auto-cleanup unmounts between tests (medium).
- **proposed:**
  - Merge lampFlareReducedMotion into lampFlareEndToEnd using the setter (this also removes one F4 copy).
  - Delete the stray docblock.
  - Correct or delete the profileHistoryCard claim.
- **overlap:** new
- **confidence:** high for the first two; medium for the third.

### 07-tests-native-F16 (P2, S) Source scans in the native tier
- **files:**
  - **errorBoundary:59-74** uses `indexOf` over app/_layout.tsx to check provider order.
  - **cardMemoComparators:17-22** uses regexes over memo comparators.
  - **signOutClearsQueryCache:77-96** collects every `/([\w.]+)\.clear\(\)/` in app/components/context/lib and pins the list to 4 entries.
- **problem:** text presence is not reachability. A `queryClient.clear ()`, a `removeQueries()`, or a `.clear()` inside a comment slips past or trips the signOutClearsQueryCache scan. Its claim, "the only place the app clears anything", is about behaviour the scan cannot see. The errorBoundary scan exists only because the provider stack has no export.
- **proposed:**
  - errorBoundary becomes a render test once `AppProviders` is exported (T1).
  - cardMemoComparators becomes a `satisfies` table (ui-F8).
  - Delete the signOutClearsQueryCache scan. Its behavioural half (:50-75) already asserts that the cache is emptied.
- **effect:** three scans that fall to decoys go.
- **overlap:** extends ui-F13 and tests-T6. signOutClearsQueryCache is a new instance.
- **confidence:** high

### 07-tests-native-F17 (P3, S) Web modules and pure logic run in the native tier, twice (iOS and Android)
- **files:**
  - **Web modules:**
    - feltFallbackShade tests feltSkia.web with a fake `document` (:27).
    - webAudioGesture tests lib/device/audioEngine.web.
    - linearGradientHiddenLayout tests the vendor `NativeLinearGradient.web`.
  - **Pure logic:**
    - errorReporting:7 mocks all of `react-native` to get `Platform.OS = 'web'`.
    - teamsSingleRound:2-4: `applyRoundToMatch` lives in context/GameContext.tsx:87.
    - renameFailureCopy:10-13 runs here because i18n pulls in expo-localization.
    - suitShapes:45-49 regexes the SUIT_GLYPHS path strings.
- **problem:** these need no renderer and no native platform, yet each runs once per jest-expo project, and they pull React Native into what is pure logic.
- **proposed:**
  - Move `applyRoundToMatch` to lib/game/matchState, then move its test to tests/engine.
  - Move the two web-module tests to a node or jsdom project.
  - Keep linearGradientHiddenLayout, which pins `patches/expo-linear-gradient+57.0.2.patch`.
- **effect:** fewer double runs, and the stranded logic becomes importable without jest-expo.
- **overlap:** confirms tests-T11 (applyRoundToMatch at GameContext:87 and renameFailureCopy verified). The web modules are new evidence.
- **confidence:** high

### 07-tests-native-F18 (P3, XS) spectateFailed calls provider actions through `waitFor`
- **files:** spectateFailed:89, 94, 107, 110, 114, 128, 133, e.g. `await waitFor(() => result.current.spectateRoom('ZZZZZZ'))`.
- **problem:** `waitFor` retries its callback until it stops throwing. A side-effecting action can therefore run more than once, for example emitting `room:spectate` twice, and the test would hide it.
- **proposed:** `await act(async () => result.current.spectateRoom('ZZZZZZ'))`.
- **overlap:** new
- **confidence:** medium (whether the action can throw before the provider settles is inferred)

### 07-tests-native-F19 (P3, XS) mocks/audioApi.ts exports four types it alone uses
- **files:** mocks/audioApi.ts:1 `ParamEvent`, :7 `MockParam`, :17 `MockBuffer`, :93 `MockContext`.
- **problem:** knip lists 6 unused exports. 4 are real: they are used only inside the file. 2 are false positives: `audioApiModule` and `audioSessionModule` are reached through `require` inside the `jest.mock` factories at setup.ts:165-166.
- **proposed:** drop `export` from the four.
- **overlap:** new (knip.md)
- **confidence:** high

## Prior findings that are wrong or already fixed
- **tests-T2** says 18 files already use the setter. A grep at SRC finds 16 files that call `setMotionPreference(` without mocking the module. The 46 mocks are confirmed exactly. This is a minor count difference that probably comes from a different definition. Nothing in T2 is fixed: setup.ts still has no reset.
- **tests "Keep: Slice hooks plus `onlineContextMock`"** conflicts with client-F5. onlineContextMock still serves the legacy flat value to onlineRoundSelection, rejoinFailedExit and handMemo, so keeping it keeps two seams (F3).
- **The other numbers in tests-T3, T10, T11 and T12 are accurate at SRC:**
  - 9 `lib/socket` mocks, all named.
  - particles spied in 5 files.
  - `applyRoundToMatch` at GameContext:87.
  - 11 `useWindowDimensions` private mocks.
  - 20 SocketContext mocks and 14 onlineGameHooks mocks.
- No prior finding in this slice was fixed between d8c34919 and 50144087.

## Inventory items checked
- **inventory.md mock-target counts for tests/native** (accessibility 46, SocketContext 20, onlineGameHooks 14, lib/socket 9, netinfo 11): real, and match grep.
- **inventory.md duplicates, cycles and orphans:** no tests/native entries. No cycles in the test helpers; `helpers/frames.ts` has only 2 importers (F4).
- **jscpd-tests:** 44 clone pairs touch tests/native. All are real. Each is cited under F2, F3, F4, F5 or F11, apart from these four:
  - accountRecovery:23-37 = registerCheckEmail:17-31, and authAutofill:19-36 = registerCheckEmail:23-40. Both are the auth-form prelude, F3 class.
  - accountRecovery:421-438 = :475-492, an in-file repeat (F4 class).
  - roundEndRefreshesRatings:42-54 = :68-83, an in-file repeat.
- **knip, `tests/native/mocks/audioApi.ts` with 6 unused exports:** 4 real (F19) and 2 false positives (`audioApiModule` and `audioSessionModule`, required from setup.ts:165-166).
- **SUMMARY "Undeclared `@jest/globals`, imported by 243 test files":** real for this slice. Every test file here imports it. That is a package.json fix outside the slice.

## Coverage
| file | lines | verdict |
|---|---|---|
| tests/native/a11yCollapse.test.tsx | 124 | F6 |
| tests/native/a11yGroup.test.tsx | 21 | clean |
| tests/native/a11yVeilReannounce.test.tsx | 78 | clean |
| tests/native/acceptInviteClearsPending.test.tsx | 242 | F2, F3 |
| tests/native/accountRecovery.test.tsx | 501 | F3, F10, F12 |
| tests/native/answeredMotionUnderReducedRoot.test.tsx | 49 | clean |
| tests/native/audioEngine.test.tsx | 325 | clean |
| tests/native/authAutofill.test.tsx | 69 | F3, F10 |
| tests/native/authBoot.test.tsx | 175 | F3, F10, F12 |
| tests/native/authLogout.test.tsx | 105 | F3, F10, F12 |
| tests/native/authNextDestination.test.tsx | 91 | F3 |
| tests/native/bannerBand.test.tsx | 82 | F1, F4, F9 |
| tests/native/bannerHoldsUnderReducedMotion.test.tsx | 49 | F11 |
| tests/native/bannerMakesRoom.test.tsx | 185 | F9 |
| tests/native/bannerPlacement.test.tsx | 111 | F6, F9 |
| tests/native/bannerReportsRestingBottom.test.tsx | 65 | F9 |
| tests/native/beatenPose.test.tsx | 121 | clean |
| tests/native/benchRecording.test.tsx | 63 | F12 |
| tests/native/bombBeat.test.tsx | 225 | F7 |
| tests/native/bombBurstAnimatesVisibly.test.tsx | 103 | F7 |
| tests/native/bombBurstNodeBudget.test.tsx | 111 | clean |
| tests/native/botMoveCost.compiled.test.tsx | 126 | F11 |
| tests/native/captureScreen.test.tsx | 121 | F1, F9 |
| tests/native/cardArtWarm.test.tsx | 43 | clean |
| tests/native/cardBackHostViews.test.tsx | 75 | clean |
| tests/native/cardEdgeAntialiasing.test.tsx | 39 | clean |
| tests/native/cardGloss.test.tsx | 172 | F11 |
| tests/native/cardHitBox.test.tsx | 76 | F6 |
| tests/native/cardLevelShade.test.tsx | 99 | clean |
| tests/native/cardMemoComparators.test.tsx | 141 | F16 |
| tests/native/cardRectCommit.test.tsx | 90 | clean |
| tests/native/ceremonyHoldsTheCard.test.tsx | 276 | F4 |
| tests/native/choiceChips.test.tsx | 49 | clean |
| tests/native/clockCrossFade.test.tsx | 106 | F1 |
| tests/native/comboChipEntrance.test.tsx | 115 | clean |
| tests/native/comboChipTiming.test.tsx | 40 | clean |
| tests/native/connectingState.test.tsx | 112 | F3 |
| tests/native/cueWithdrawnOnUnmount.test.tsx | 42 | clean |
| tests/native/dealFeel.test.tsx | 124 | F1, F11 |
| tests/native/dealPool.test.tsx | 148 | F4, F11 |
| tests/native/dealTurn.test.tsx | 94 | F1, F9 |
| tests/native/dealTurnGrowth.test.tsx | 55 | F1, F9, F12 |
| tests/native/endMatchVoteBanner.test.tsx | 219 | F3 |
| tests/native/errorBoundary.test.tsx | 143 | F16 |
| tests/native/errorReporting.test.tsx | 223 | F6, F17 |
| tests/native/everyMomentHasACaller.test.tsx | 125 | clean |
| tests/native/exchangeAnnounceBothWays.test.tsx | 87 | clean |
| tests/native/exchangeAnnounceFrame.test.tsx | 54 | clean |
| tests/native/exchangeDeal.test.tsx | 119 | F4 |
| tests/native/exchangeE2EHold.test.tsx | 132 | F4 |
| tests/native/exchangeHoldsTheTurn.test.tsx | 135 | F3 |
| tests/native/exchangeKeyHolds.test.tsx | 114 | F4, F11 |
| tests/native/exchangeOnTable.test.tsx | 292 | F12 |
| tests/native/exchangeReceivedNeverMissing.test.tsx | 61 | clean |
| tests/native/fabricIntProps.ts | 89 | leave-alone: the Fabric prop check tests.md keeps; one deep assertion helper |
| tests/native/feedback.test.tsx | 126 | clean |
| tests/native/feltFallbackShade.test.tsx | 51 | F17 |
| tests/native/feltRailDispose.test.tsx | 49 | F11 |
| tests/native/feltScrim.test.tsx | 123 | clean |
| tests/native/flightFloor.test.tsx | 63 | clean |
| tests/native/flightRestPose.test.tsx | 39 | clean |
| tests/native/flightShadow.test.tsx | 30 | clean |
| tests/native/flightStartsOnce.test.tsx | 39 | clean |
| tests/native/floatSlot.test.tsx | 215 | clean |
| tests/native/foilGlint.test.tsx | 114 | F11 |
| tests/native/framedScenarios.test.tsx | 43 | F12 |
| tests/native/framePacing.test.tsx | 36 | clean |
| tests/native/frameProbe.test.tsx | 112 | F12 |
| tests/native/frameProbeFirstWindow.test.tsx | 71 | F12 |
| tests/native/friendLastSeen.test.tsx | 102 | F2, F3 |
| tests/native/friendRequestReconcile.test.tsx | 121 | F2, F3, F7 |
| tests/native/friendRowArrivesWithTheBanner.test.tsx | 195 | F2, F3 |
| tests/native/friendsActionFailure.test.tsx | 115 | F3 |
| tests/native/friendsInviteJoin.test.tsx | 69 | F3 |
| tests/native/friendsPresenceRow.test.tsx | 90 | F3 |
| tests/native/gameContextExchange.test.tsx | 236 | clean |
| tests/native/gameSettingsSheetRows.test.tsx | 123 | clean |
| tests/native/giocaCuesRemount.test.tsx | 36 | clean |
| tests/native/handMemo.test.tsx | 189 | F3, F11 |
| tests/native/handMemoTable.test.tsx | 86 | F4, F11 |
| tests/native/handMoveDisarmsOnce.test.tsx | 59 | clean |
| tests/native/handoffEmber.test.tsx | 78 | F1, F4 |
| tests/native/handReorderActions.test.tsx | 53 | clean |
| tests/native/handShadeRebuild.test.tsx | 83 | F4, F11 |
| tests/native/handShadeWiring.test.tsx | 91 | F4 |
| tests/native/handTapStrip.test.tsx | 46 | F6 |
| tests/native/hapticsEngine.test.tsx | 59 | clean |
| tests/native/hapticsPreload.test.tsx | 24 | clean |
| tests/native/helpers/botRound.ts | 33 | clean |
| tests/native/helpers/closeMatch.tsx | 112 | F4 |
| tests/native/helpers/dealSweep.ts | 14 | clean |
| tests/native/helpers/dealTable.tsx | 58 | F4 |
| tests/native/helpers/dealTurnTable.tsx | 29 | F4 |
| tests/native/helpers/exchangeLegs.tsx | 90 | F4 |
| tests/native/helpers/feedback.ts | 58 | F4 |
| tests/native/helpers/frames.ts | 2 | F4 |
| tests/native/helpers/landing.tsx | 135 | F4 |
| tests/native/helpers/pileMounts.tsx | 156 | F4 |
| tests/native/hiddenThrows.test.tsx | 83 | F4, F11 |
| tests/native/historyScreen.test.tsx | 189 | F3, F4, F14 |
| tests/native/homeFieldPausesOnBlur.test.tsx | 66 | F1, F3 |
| tests/native/homeIgnoresTaps.test.tsx | 94 | clean |
| tests/native/homeReturnToTable.test.tsx | 109 | F1, F3 |
| tests/native/homeSettingsPillWord.test.tsx | 114 | F1, F3 |
| tests/native/howToPlayEntry.test.tsx | 73 | F1 |
| tests/native/inviteTapRoute.test.tsx | 108 | clean |
| tests/native/joinInviteFromHome.test.tsx | 166 | F3, F14 |
| tests/native/joinRoute.test.tsx | 63 | clean |
| tests/native/lampFlareEndToEnd.test.tsx | 151 | F1, F4 |
| tests/native/lampFlareReducedMotion.test.tsx | 126 | F1, F4, F15 |
| tests/native/lampFlareWiring.test.tsx | 129 | F1, F4, F11 |
| tests/native/lampVariantsScenario.test.tsx | 73 | F12, F13 |
| tests/native/landingDust.test.tsx | 50 | F11 |
| tests/native/landingHaptic.test.tsx | 111 | clean |
| tests/native/landingNotDropped.test.tsx | 51 | F4, F11 |
| tests/native/landingOnContact.test.tsx | 67 | F1, F11 |
| tests/native/landWobble.test.tsx | 40 | clean |
| tests/native/leaderboardScreen.test.tsx | 64 | F3, F4 |
| tests/native/legalPlaysPerHand.test.tsx | 136 | F4, F11 |
| tests/native/linearGradientHiddenLayout.test.tsx | 34 | leave-alone: pins patches/expo-linear-gradient+57.0.2.patch |
| tests/native/linkGreyLayers.test.tsx | 172 | F1, F4, F11 |
| tests/native/liveRegionsHelper.test.tsx | 68 | clean |
| tests/native/matchEndsOnTable.test.tsx | 299 | F3 |
| tests/native/matchOutcomeEdges.test.tsx | 65 | F1 |
| tests/native/matchOutcomeOnTheFelt.test.tsx | 58 | F1 |
| tests/native/matchTurnChip.test.tsx | 47 | F14 |
| tests/native/menuButtonLabelFits.test.tsx | 19 | clean |
| tests/native/menuButtonShadow.test.tsx | 26 | clean |
| tests/native/mocks/audioApi.ts | 180 | F19 |
| tests/native/mocks/turboHaptics.ts | 20 | clean |
| tests/native/motionPreference.test.tsx | 123 | clean |
| tests/native/motionPreferenceDrivesReanimated.test.tsx | 104 | F3, F10, F11 |
| tests/native/musicPlatform.test.tsx | 18 | clean |
| tests/native/musicRoute.test.tsx | 110 | F1, F3, F10 |
| tests/native/noticeEntrance.test.tsx | 74 | clean |
| tests/native/noticeGalleryScenario.test.tsx | 49 | F12 |
| tests/native/noticeProbe.test.tsx | 150 | F12 |
| tests/native/notificationQueue.test.tsx | 54 | clean |
| tests/native/nowCueSurvivesAStall.test.tsx | 110 | F1 |
| tests/native/offlineAutoPass.test.tsx | 117 | F3, F4 |
| tests/native/offlineBannerLargeText.test.tsx | 86 | F1, F10 |
| tests/native/offlineDealFirstSeat.test.tsx | 136 | F4 |
| tests/native/offlineResume.test.tsx | 219 | F4, F15 |
| tests/native/oneEventPerCommit.test.tsx | 99 | clean |
| tests/native/oneSoundPerMoment.test.tsx | 44 | clean |
| tests/native/oneTapOneCommit.test.tsx | 284 | F4, F11 |
| tests/native/onlineAutoPass.test.tsx | 99 | F2, F4 |
| tests/native/onlineCatchUp.test.tsx | 190 | F3 |
| tests/native/onlineContextMock.ts | 26 | F3 |
| tests/native/onlineErrorFloat.test.tsx | 90 | F3 |
| tests/native/onlineLeaveConfirm.test.tsx | 181 | F3 |
| tests/native/onlineRoundEndsOnTable.test.tsx | 184 | F3, F4 |
| tests/native/onlineRoundSelection.test.tsx | 177 | F3 |
| tests/native/onlineStatusRow.test.tsx | 73 | F3 |
| tests/native/orientationFirstRender.test.tsx | 60 | F9 |
| tests/native/orientationRows.test.tsx | 46 | F12 |
| tests/native/ownLinkHold.test.tsx | 232 | F1 (its typed fakeSocket is the model for F2) |
| tests/native/particleLayerTrace.test.tsx | 251 | F1, F11 |
| tests/native/passAndPlayHandoff.test.tsx | 167 | F3, F14 |
| tests/native/passMarker.test.tsx | 371 | F1, F4 |
| tests/native/pileFlinch.test.tsx | 78 | F12 |
| tests/native/pileLayers.test.tsx | 69 | clean |
| tests/native/pileMountsOnceFull.test.tsx | 8 | leave-alone: 8-line wrapper; a module-scope mock forces one file per mode |
| tests/native/pileMountsOnceReduced.test.tsx | 8 | leave-alone: 8-line wrapper; a module-scope mock forces one file per mode |
| tests/native/playRejection.test.tsx | 269 | F4, F14 |
| tests/native/profileForm.test.tsx | 188 | F3, F14, F15 |
| tests/native/profileHistoryCard.test.tsx | 230 | F3, F14, F15 |
| tests/native/protocolMismatch.test.tsx | 87 | F2 |
| tests/native/reactionIsolation.test.tsx | 68 | clean |
| tests/native/registerCheckEmail.test.tsx | 168 | F3, F10, F12 |
| tests/native/rejoinFailed.test.tsx | 216 | F2, F8 |
| tests/native/rejoinFailedExit.test.tsx | 101 | F3 |
| tests/native/rematchVoteKeptBetweenRounds.test.tsx | 88 | F2, F4 |
| tests/native/renameAccount.test.tsx | 107 | F3, F10, F12 |
| tests/native/renameFailureCopy.test.tsx | 77 | F14, F17 |
| tests/native/render.test.tsx | 126 | clean |
| tests/native/replayControls.test.tsx | 171 | F14 |
| tests/native/replayEndStopsPlayback.test.tsx | 71 | F14 |
| tests/native/replayExpired.test.tsx | 165 | F14 |
| tests/native/resumeAtRest.test.tsx | 102 | clean |
| tests/native/roomInviteAndShare.test.tsx | 205 | F3, F12 |
| tests/native/roomKind.test.tsx | 41 | clean |
| tests/native/roomMatchmakingToggle.test.tsx | 166 | F3, F8 |
| tests/native/roomSeatFill.test.tsx | 103 | F1 |
| tests/native/roomSeatHold.test.tsx | 87 | clean |
| tests/native/rotateOverlay.test.tsx | 35 | clean |
| tests/native/roundEndingPill.test.tsx | 135 | F4, F14 |
| tests/native/roundEndingStart.test.tsx | 84 | clean |
| tests/native/roundEndRefreshesRatings.test.tsx | 96 | F2 |
| tests/native/roundEndsOnTable.test.tsx | 139 | F3 |
| tests/native/roundOutcomeOnTheFelt.test.tsx | 195 | F1, F4 |
| tests/native/roundOverSting.test.tsx | 349 | F1, F4 |
| tests/native/roundStingAtLanding.test.tsx | 104 | F1, F4 |
| tests/native/scorePill.test.tsx | 144 | F1, F4 |
| tests/native/screenHeaderBack.test.tsx | 36 | clean |
| tests/native/screenShakeSetting.test.tsx | 60 | clean |
| tests/native/seatAnchorsScenario.test.tsx | 104 | F12, F13 |
| tests/native/seatDealArrival.test.tsx | 111 | F1, F11 |
| tests/native/seatDimming.test.tsx | 54 | F1 |
| tests/native/seatDiscLit.test.tsx | 33 | clean |
| tests/native/seatFinishTrophy.test.tsx | 55 | F1 |
| tests/native/seatLowCount.test.tsx | 55 | F1 |
| tests/native/seatReconnectClock.test.tsx | 125 | F1, F12 |
| tests/native/seatTurnClock.test.tsx | 296 | F1, F4, F7 |
| tests/native/selectionIntegrity.test.tsx | 152 | F4 |
| tests/native/sessionReplaced.test.tsx | 144 | F2 |
| tests/native/settingsFirstWrite.test.tsx | 125 | clean |
| tests/native/settingsHapticsRace.test.tsx | 79 | clean |
| tests/native/settingsOverlay.test.tsx | 303 | F10 |
| tests/native/setup.ts | 174 | F1, F9, F10 (missing motion reset, window and connectivity helpers) |
| tests/native/shadowClusterBuilds.test.tsx | 105 | clean |
| tests/native/signOutClearsQueryCache.test.tsx | 108 | F2, F12, F16 |
| tests/native/sliceRenderCounts.test.tsx | 198 | F2 |
| tests/native/slider.test.tsx | 108 | clean |
| tests/native/socketAccountSwitch.test.tsx | 85 | F2 |
| tests/native/socketContextFreshness.test.tsx | 87 | F2 |
| tests/native/socketReconnect.test.tsx | 122 | F2, F8 |
| tests/native/spectateFailed.test.tsx | 140 | F2, F18 |
| tests/native/stagedSelection.test.tsx | 258 | F4 |
| tests/native/startAnnouncement.test.tsx | 304 | F1, F4, F9 |
| tests/native/startCardHook.test.tsx | 67 | clean |
| tests/native/suitShapes.test.tsx | 60 | F1, F17 |
| tests/native/tableCardRects.test.tsx | 138 | F5 |
| tests/native/tableCardShadows.test.tsx | 177 | F5 |
| tests/native/tableCoveredVeil.test.tsx | 180 | F1, F4, F9, F12 |
| tests/native/tableFeedbackIdentity.test.tsx | 42 | F4 |
| tests/native/tableNotices.test.tsx | 637 | F1, F4, F7, F10 |
| tests/native/tableRelocksAfterEntry.test.tsx | 225 | F9 |
| tests/native/tableShake.test.tsx | 59 | F4, F6, F7 |
| tests/native/tableShakeReducedMotion.test.tsx | 168 | F4, F11 |
| tests/native/tableStatus.test.tsx | 267 | F1, F4 |
| tests/native/tableTapFeedback.test.tsx | 58 | F4 |
| tests/native/tapHelpers.tsx | 38 | clean |
| tests/native/tapLiftOnUiThread.test.tsx | 437 | F1, F11 |
| tests/native/teamsSingleRound.test.tsx | 43 | F17 |
| tests/native/theme.test.tsx | 109 | clean |
| tests/native/threadLoadScenario.test.tsx | 145 | F12 |
| tests/native/traceMomentFollowsShake.test.tsx | 79 | F4 |
| tests/native/traceOnsetFollowsSettings.test.tsx | 42 | clean |
| tests/native/trickClose.test.tsx | 210 | F1, F4, F8 |
| tests/native/trickWinnerBanner.test.tsx | 149 | F1, F4, F8 |
| tests/native/turnChipLabel.test.tsx | 146 | clean |
| tests/native/turnPillNamesTheLitSeat.test.tsx | 75 | F14 |
| tests/native/turnTimerAnnouncement.test.tsx | 124 | clean |
| tests/native/tutorialOnce.test.tsx | 257 | F1, F3, F4 |
| tests/native/tutorialSkip.test.tsx | 129 | F1, F4 |
| tests/native/tutorialTableBeats.test.tsx | 88 | F1, F4, F14 |
| tests/native/visibilityHelpers.ts | 64 | clean |
| tests/native/webAudioGesture.test.tsx | 164 | F17 |
| tests/native/yourTurnCue.test.tsx | 102 | F4 |
