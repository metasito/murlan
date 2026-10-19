# 09-tests-server-engine — slice review (SRC 50144087)

Scope: tests/integration (68), tests/server (72), tests/engine (28), tests/bots (7), tests/soak (4), tests/helpers (26) — 205 files. All read in full. Paths are relative to SRC.

## Findings

### 09-tests-server-engine-F1 (P1, M) The db module captures DATABASE_URL at import, which shapes the whole integration tree
- **files:**
  - server/db/db.ts:45-58 and pool.ts:5: the URL is read when the module loads.
  - tests/helpers/testServer.ts:175, 260, 269: the URL is repointed per schema and restored on stop().
  - 33 integration files import `await import("../../server/…")` after boot.
  - 25 integration files build their own `pg.Pool`, among them abandonedGames, abandonmentRecord, addEmail, bugReports, clientErrors, friendsLadder, accountDeletionMidRound, registrationFailureKeepsConnection:45, roomLifecycleRaces:19, socketCloseReason:20, stats, teamsOnline, restartConvergence, shutdown, crossInstance and postgresRestart.
  - The "one server per process" premise is stated in schemaBootstrap:13-15, shutdown:13-14, soakLogReplays:68-69, testServerKeepAlive:5-7, testServerTeardown:6-8, soak/replay.ts:81-85 and stats.test.ts:398-402.
  - DATABASE_URL is mutated in crossInstance:243 (never reset) and ownershipReclaim:40.
- **problem:**
  - The test server's interface hides the real seam, which is which database the modules talk to.
  - A test cannot import a store statically. Each file re-derives a connection to the schema. stop() ends a module singleton pool, so a file can host only one server.
  - Files exist only to get a fresh process (testServerKeepAlive, testServerTeardown, schemaBootstrap, shutdown), and soak/replay.ts grew an "existing server" parameter to work around it.
  - Low locality: each of the ~58 sites knows about the import-order trap.
- **proposed:**
  - Have `startTestServer()` return its `db` and `pool` handles, for example `server.db` and `server.query(sql)`.
  - Make server/db build lazily from a `createDb(url)` that the server boot owns, not from module scope.
  - Dynamic imports then become static, ad-hoc pools are deleted, and one process can boot N servers.
- **effect:**
  - About 25 pool constructions and 33 dynamic-import blocks are deleted. Several files can merge (the harness trio).
  - The "cannot import without DB" folklore (F7) disappears.
- **overlap:** extends tests-T8 and server-F2 (an ActiveGameStore needs the same db injection).
- **confidence:** high for the mechanism. The counts come from grep: `pg.Pool|new Pool` in 25 integration files and `await import("../../server` in 33.

### 09-tests-server-engine-F2 (P1, M) The Clock seam exists but integration tests sleep real time instead of using it
- **files:**
  - server/game/gameTimers.ts:9-32 already exports `Clock` and `setClock` for afk, disconnect, lobbyGrace, bot and autoStart.
  - tests/helpers/fakeClock.ts (34 lines) is used only by tests/server/gameTimers.test.ts and openingGrace.test.ts.
  - The integration server runs in-process, so it shares that module.
  - Integration tests shrink the same timers with env and wait them out instead:
    - turnDeadline:20 sets AFK with a 2500ms sleep at :79.
    - lobbyGrace:25 sets 1500ms, with sleeps of 200, 300 and 3000.
    - reconnect sleeps min(500, grace/2) and 1000×2.
    - openingGraceTimesOut:21; quickmatchAutoStart:40; tableStalls (server) with MURLAN_LOBBY_GRACE_MS=30 and sleeps of 150 and 10.
  - Timers outside the seam:
    - stateAckTimeoutMs uses socket.io `.timeout()` (server/game/gamePersistence.ts:198), so stateRedelivered sleeps 3000 at :86 and 4000 at :111, 7s for one file.
    - seatHoldMs (server/store/roomStore.ts:261, 298) is a DB timestamp, so seatHold mutates MURLAN_SEAT_HOLD_MS mid-test (:161, :199) and sleeps 600×2 (:218, :227).
- **problem:**
  - The seam is real: a production adapter plus fakeClock make two adapters.
  - The slow, flaky class still pays wall-clock time, because the integration harness offers no `setClock` hook and two timers bypass the seam.
- **proposed:**
  - Have `startTestServer({ clock })` call `setClock`.
  - Route the state-ack re-send through `clock.setTimeout`.
  - Give seatHold a `now()` from the clock rather than relying on the DB's `now()` alone.
  - Then turnDeadline, lobbyGrace, reconnect's AFK re-arm and openingGraceTimesOut drive time with `advance()`.
- **effect:** removes about 15s of fixed sleeps per CI run and a whole class of timing flakes. openingGraceTimesOut collapses into server/openingGrace.test.ts.
- **overlap:** extends tests-T8 and server-F9.
- **confidence:** high for the seam and its two users; medium for the size of the savings.

### 09-tests-server-engine-F3 (P2, S) Fixed sleeps standing in for events the protocol already has
- **files:**
  - Positive waits that have an ack or event available:
    - gameInviteOutlives sleeps 150, 400×5, 120×S×3, 300×S and 800. `friend:invite` acks: server/socket/socketPresence.ts:52-57, socketSafety.ts:184-197 and friendships.ts:162. So `emitWithAck` replaces the sleeps.
    - pushTokens sleeps 300×3 and 800.
    - quickmatch sleeps 2000; crossInstance 1500, 2800 and 2000; ownerLoss 500; ownershipReclaim 2500.
    - restartConvergence sleeps 1000 in replaceServer (:164) and before its second block (:375), with QUIET_MS 900 settle loops.
    - postgresRestart:174 sleeps 500.
    - soak/soak.ts:587 and 691 sleep 700 after a rematch vote.
  - Negative windows ("nothing arrived"):
    - admin:136 waits 300×S; events waits 300×S and 400.
    - spectator waits 200, 250×2, 150×2 and 400×3 (:164, 214, 233, 240, 250, 295).
    - sessionReplaced waits GRACE×3×SCALE (:133) and 250 (:166, :292).
    - socketHandshakeLimit waits 450, 600 and 250 (:54, :81, :205).
    - socketRefusalLogging (server) waits 250.
  - After-hook settles: roomVisibility:39 (200), socketOrigin:25 (600), roomLifecycleRaces:329 (200).
  - Small server-unit sleeps: seatReclaim 40, weakSeatTakeover 30, shutdownSeatLost, endMatchVote and persistedEnvelope 20, socketAdapter 30, sessionEviction 5.
- **problem:**
  - A positive sleep is either too long (slow) or too short (flaky on CI).
  - A negative sleep only proves nothing happened within a guessed window.
- **proposed:**
  - For positive waits, await the ack or event (`emitWithAck`, or `waitFor` from client.ts).
  - For negative waits, emit a sentinel request on the same socket and assert that nothing arrived before its reply. Ordering per socket is guaranteed.
- **effect:** removes several seconds per file and the CI-scale guesswork.
- **overlap:** extends tests-T8.
- **confidence:** high for gameInviteOutlives, since the ack is verified. Medium for the others: each needs its event confirmed.

### 09-tests-server-engine-F4 (P2, M) Socket test infrastructure is re-implemented per file (wire types, connect, boot, polling)
- **files:**
  - Wire types re-declared 13 times:
    - RoomState in addressedByUser:24, gameInviteOutlives:24, intentAcknowledged:24, lobbyGrace:41, quickmatchAutoStart:19, roomFullInvite:24, roomVisibility:21, seatHold:21, spectator:47 and stateRedelivered:26.
    - SanitizedState in spectator:40, plus TableState in soak/soak.ts:34-50.
    - The helpers declare it twice more: helpers/table.ts:20-57 and helpers/gameDriver.ts:13-43.
  - The ticket-then-connect sequence:
    - client.ts has 3 copies (88-112, 125-153, 160-185); reconnectWith and reconnectAs are identical.
    - Other copies: sessionReplaced:71-90, socketHandshakeLimit:91-107 (= socketOrigin:29-43), and restartConvergence:77-100.
  - Child-instance boot ×3:
    - helpers/instance.ts.
    - restartConvergence:46-75 hard-codes PORT 5571, LOG_LEVEL and a 600ms sleep.
    - crossInstance and postgresRestart (PORTS 5591/5592, :12) have their own register and connect.
  - Poll loops `for attempt<20 … 50ms`: about 42 sites in 13 files, plus local `until` helpers (roomLifecycleRaces:69-75) and their 25ms twins in rematch:63-68 and 359-362, soak/replay.ts:53-69, and clientErrors:117, 140, 166, 188 and 209.
  - Two play loops: gameDriver.ts:103-118 = table.ts:180-196.
  - Friend helpers: helpers/friends.ts:13 befriend is re-implemented in friendsLadder:28-36, pushTokens (×3), friendScope, friendRaces, friendRequestOffline and crossInstance.
  - helpers/onlineTable.ts exists but tests hand-build OnlineGameState literals, for example tests/server/roundOver.test.ts:115-141.
  - Copy-pasted server stubs:
    - stubIo ×4: endMatchVote:51, seatReclaim:50, tableStalls:41, voidAbandonedMatch:28. jscpd reports endMatchVote = seatReclaim.
    - FakeClient ×3: pool:8, postgresAdapterPatch:11, socketAdapter:100.
- **problem:**
  - Shallow helpers with leaky interfaces: table.ts and gameDriver.ts overlap, client.ts copies itself, and files still roll their own.
  - When the wire shape changes, about 15 declarations drift silently.
- **proposed:**
  - Import wire types from the server's own exported types; T3 already proposes a typed socket seam.
  - One `connect(server, {cookie?})` in client.ts.
  - One `eventually(fn, {ms})` poll.
  - Merge gameDriver.ts into table.ts.
  - Have helpers/instance.ts take a port and be the only boot path.
  - One `tests/helpers/fakeIo.ts` and one `fakePgClient.ts`.
- **effect:** deletes roughly 600-900 duplicated lines, and the helpers deepen.
- **overlap:** extends tests-T3 and tests-T7 and confirms the jscpd SUMMARY (endMatchVote = seatReclaim).
- **confidence:** high (each site cited). The deletion estimate is medium.

### 09-tests-server-engine-F5 (P2, S) Production singletons patched at runtime instead of injected
- **files:**
  - gameplay patches friendStore.getFriends (:105) and logger.level.
  - intentAcknowledged patches userStore.getUser (:224); ownerLoss patches userStore.updateLastSeen (:92).
  - ladderAndReplay patches pool.query (:377).
  - reconnect patches roomStore.getRoomPlayers (:471, :515), roundOverWriters.previewRatedDeltas (:829) and endMatchVotes (:354).
  - roomLifecycleRaces patches roomStore.findWaitingPublicRooms (:186) and getRoomByCode (:221).
  - socketHandshakeLimit patches friendStore.getFriends (:195).
  - tableStalls (server) mocks db.query.activeGames.findFirst 5 times.
- **problem:**
  - Each patch mutates a shared module object. A missed restore leaks into the rest of the file.
  - The patch site couples the test to internal call paths: a deletion test on the call path makes the patch dead, and the test may stay green.
- **proposed:**
  - Extend the deps-object pattern that already works here: roomLifecycleRaces:317 patches the deliberate `persistence` seam, and lobbyIntents and friendships take `deps` fakes.
  - Apply it to friendStore, userStore and roomStore reads, and to rated-delta preview, in the modules that call them.
- **effect:** turns about 12 monkeypatches into explicit adapters. Two adapters (prod plus test) make each one a real seam.
- **overlap:** extends server-F2 (ActiveGameStore, for tableStalls) and server-F10.
- **confidence:** medium. Each module's deps shape needs design.

### 09-tests-server-engine-F6 (P2, S) Unit tests reach production DB writers through the seam they claim to stub
- **files:**
  - tests/server/vacateSeatPersonality:53, voidAbandonedMatch:65 and 94, and weakSeatTakeover:71 and 103 pass the production `roundOverWriters` to vacateSeat.
  - weakSeatTakeover:303-307 admits that DB I/O sits outside the seam.
  - roundOver.test.ts, which uses full fake writers, is the model to copy.
- **problem:** the writers interface is a hypothetical seam on this path. Only one adapter is used, so the "unit" tests carry hidden DB dependencies.
- **proposed:** use fake writers, as roundOver.test.ts does.
- **effect:** the three files run without Postgres and become deterministic.
- **overlap:** extends server-F10.
- **confidence:** high.

### 09-tests-server-engine-F7 (P2, S) Source scans: 17 hand-rolled walkers, 4 comment strippers, and false premises
- **files:**
  - Walkers:
    - server: logRedaction:119, protocolEvents:31, protocolVersion:52, rateLimiterFactory:54, retentionOffWritePath:31, seatLedger:144, serverLoadable:12 and 34, sessionRevocation:11, socketEvents:27, tableOwnership:30, testOnlyEnv:66.
    - integration/timerContainment:93-131, a regex scan inside an integration file.
    - engine/deal:241-291, engine/matchState:203-299, bots/botFill:137-166.
  - Comment strippers: socketErrorLogging:36, socketEvents:58, tableOwnership:24, logRedaction:135.
  - socketErrorLogging hard-codes a list of 6 files; tableOwnership checks 2 files.
  - validate.test.ts:27-30 matches with a regex.
  - String scans:
    - engine/deal:190-204 (a GAME-RULES.md regex), :258-271 and :366-389.
    - sharedGameFlow:65-79, botPersonalities:268-277 (indexOf), botSearchTimeout:30-45 and 73-87 (reads tests/e2e and app/game.tsx).
    - helpers/sourceScan.ts itself has two walkers (14-25, 47-58), and fullBleedNodes uses indexOf (443). Only 3 files in this slice import it.
  - Scans built on a false premise ("cannot import without DB"):
    - historyBound:10-12. It also misses `LIMIT ${}` at server/store/stats.ts:140, and integration/stats.test.ts:472-489 already covers the behaviour.
    - privacyRetention:8-10, exchangeVisibility:302-315.
- **problem:**
  - Text presence is not reachability.
  - Each scan has its own walker and stripper, which differ in edge cases.
  - Scans made for a reason F1 removes are pure cost.
- **proposed:**
  - One `walkTs(dir)` and one comment-blanker in sourceScan.ts, both of which already exist there, de-duplicated.
  - Delete the premise-false scans in favour of behavioural tests once F1 lands (historyBound now).
  - Use moduleEdges.ts (AST) for import and caller claims (deal, matchState, botFill).
- **effect:** removes about 17 walkers, and scans stop falling to decoys.
- **overlap:** extends tests-T5 and tests-T6.
- **confidence:** high for the inventory. Medium for deleting each specific scan.

### 09-tests-server-engine-F8 (P2, M) Bot and round-loop tests bypass the one bot module, and matchTerminates soaks a mirror
- **files:**
  - Hand-rolled "play a round out" loops:
    - engine/flow:303-359, bots/botCardMemory:64-82, bots/botPersonalities:60-110, bots/botTeamAwareness:211-250.
    - helpers/offlineMatch.ts mirrors applyRoundToMatch (58-86) and dealFrom (379-394), and patches crypto (96-120).
  - The loops call `botChoosePlay` positionally with 8-9 args, including undefined placeholders: botCardMemory:70-79, botExchangeAwareness:58-60.
  - botPersonalities' loop omits playedRanks and partner info.
  - engine/matchTerminates soaks `simulateOfflineMatch` from the helper, so it proves that the mirror terminates, not context/GameContext.tsx.
  - CLAUDE.md names lib/game/autoMove.ts as the only bot entry; botExchangeAwareness:127 uses autoMoveForSeat, which is right.
  - engine/offlineMatchContestPlay and offlineMatchHarness test the test helper.
- **problem:**
  - The deep module (autoMove) is bypassed by tests that re-assemble its inputs. A wide positional interface leaks into five call sites.
  - The mirror is a second implementation of match accounting, which fails the deletion test: removing it from production changes nothing it checks.
- **proposed:**
  - Add one `playRoundOut(state, chooser = autoMoveForSeat)` in tests/engine/helpers.ts.
  - Give botChoosePlay an options object.
  - Point matchTerminates at the extracted production match reducer once domain-F2/F3 lands, and delete the offlineMatch mirrors.
- **effect:** deletes four loops and the mirror. Bot tests exercise what ships.
- **overlap:** extends domain-F2 and domain-F3 (offline mirrors) and confirms the CLAUDE.md autoMove invariant.
- **confidence:** high for the sites. Medium for retiring the mirror, since it depends on domain-F2.

### 09-tests-server-engine-F9 (P2, S) No injectable rng: four PRNGs, retry loops, unseeded statistics
- **files:**
  - PRNGs:
    - mulberry32 in tests/engine/helpers.ts.
    - A `seeded` LCG in engine/rating:42-45.
    - fixedRng in bots/botPersonalities:31-34.
    - xorshift `makeRng` in soak/soak.ts:56-65.
  - Retry loops forced by the server's crypto deal (soak.ts:216-221 documents it):
    - integration/gameplay:188-201 loops up to 20 rematches.
    - rematch:339-348 retries up to 6 times on 1-in-16 odds.
    - Meanwhile helpers/liveGame.ts:44 `redealExactly` exists, and only soak/replay.ts:130 uses it. That contradicts gameplay's comment that a rig seam was rejected.
  - Unseeded statistics: engine/deal:43-53, 111-120, 149-180 (loops of 20, 300 and 200); engine/exchange:276-307 (×50).
  - The good model is engine/reconnectDelay, which injects its rng.
- **problem:** nondeterminism and loops sized by probability. The rig already exists but is used by one caller.
- **proposed:**
  - One exported `seededRng` in tests/engine/helpers.ts.
  - Use `redealExactly` in gameplay and rematch.
  - Pass an rng to shuffleDeck and initializeRematch.
- **effect:** removes the retry loops and makes deal and exchange deterministic.
- **overlap:** extends tests-T9.
- **confidence:** high.

### 09-tests-server-engine-F10 (P2, XS) The sourceMaps test deletes the repo's real `sourcemaps/` directory
- **files:** tests/server/sourceMaps.test.ts:13-33. server/http/sourceMaps.ts:14 derives MAPS_ROOT from cwd.
- **problem:** running the suite destroys a developer's local sourcemaps. It also races any parallel file reading them.
- **proposed:**
  - Make MAPS_ROOT a parameter of the handler factory and point the test at a temporary directory.
  - Same class: process.chdir used as a cwd seam in appLinks:28/40, noWebBuild:25/35, integration/e2e:44 and httpCaching:55. This is process-global, so it is unsafe under in-file concurrency.
- **effect:** removes a destructive side effect, and four files stop mutating process cwd.
- **overlap:** new.
- **confidence:** high.

### 09-tests-server-engine-F11 (P2, S) Slow integration files that become unit tests once a seam lands
- **files:**
  - ladderAndReplay costs 126s by its own note (66-70) → `handleRoundOver` with fake writers (F6 pattern).
  - stateRedelivered (7s) and turnDeadline (2.5s) → Clock (F2).
  - seatHold (1.2s) → Clock plus a seat-hold `now`.
  - openingGraceTimesOut duplicates server/openingGrace.test.ts (medium).
  - lobbyGrace → Clock.
  - events and admin negative waits → wait on a sentinel row (F3).
  - takeoverSerialised is already the model: setTableHandlers plus a fake io (38-41), with PG only for the advisory lock.
- **problem:** integration cost is paid for logic that has no socket or DB question.
- **proposed:** move these as each seam lands; keep one thin integration smoke per feature.
- **effect:** the largest single cut in integration wall clock (ladderAndReplay).
- **overlap:** extends tests-T8.
- **confidence:** medium.

### 09-tests-server-engine-F12 (P3, S) Tests, scripts and e2e are tangled
- **files:**
  - scripts/measureHeadsUpBalance.ts imports tests/helpers/offlineMatch.ts and tests/engine/helpers.ts, and engine/royalStraightBlindSpotHelpers.test.ts:5-8 imports that script, which makes a cycle.
  - engine/flow:14 imports components/seatLayout.ts.
  - bots/botSearchTimeout and botTotalTimeWatchdog test tests/e2e/helpers/bot.ts. botSearchTimeout:136-138 patches global `Date.now`, because that helper has no clock seam.
  - bots/botFill tests server/game/onlineGameLogic.ts.
  - integration/verifyEmailMailRoundTrip imports tests/e2e/helpers/mailSink.ts.
  - tests/engine/helpers.ts:14 does `export * from gameEngine`.
- **problem:** production tooling depends on test helpers, and test directories do not say what they test.
- **proposed:**
  - Move the balance-measurement core into lib/ or scripts/, imported by both.
  - Move the bot-search tests next to tests/e2e/helpers.
  - Move botFill to tests/server.
- **effect:** removes the cycle; placement tells the reader what a file tests.
- **overlap:** confirms the jscpd SUMMARY and the knip inventory.
- **confidence:** high.

### 09-tests-server-engine-F13 (P3, XS) Dead and unused helper surface (knip, confirmed)
- **files:**
  - offlineMatch.ts: SilentSeatError :220, RotationOrderError :241, HandNotShrunkError :286.
  - sourceScan.ts: enclosingTag :228.
  - gameDriver.ts: ExchangePhaseView :13, SanitizedPlayer :21.
  - table.ts: SanitizedPlayer :20, ExchangePhase :29.
  - moduleEdges.ts: resolveSpec :11. It is used internally at :44, so drop only the `export`.
  - helpers/instance.ts:24 sets LOG_LEVEL, which is dead because server/logger.ts:74 derives the level from NODE_ENV; restartConvergence repeats it.
  - instance.ts:41 sleeps a fixed 600ms, and the child is not killed on timeout.
  - Hard-coded ports 5561/5562 (crossInstance), 5571 (restartConvergence), 5581 (ownerLoss) and 5591/5592 (postgresRestart).
- **problem:**
  - Dead knobs read as working configuration.
  - A child left running on timeout holds its port and its memory.
- **proposed:**
  - Delete the exports and the knob.
  - instance.ts waits on its health endpoint and kills the child in `finally`.
  - Take port 0, or allocate ports in one place.
- **effect:** a small cleanup that removes a leaked-process path.
- **overlap:** confirms knip.
- **confidence:** high.

### 09-tests-server-engine-F14 (P3, XS) Stale, orphaned and changelog comments
- **files:**
  - The "register capped at 20 per process" claim is stale (testServer.ts sets the limit to 200). It appears in table.ts:14-16, reconnect:991-993, accountDeletionMidRound:20-21, sessionReplaced:31-32 and 66-69, and socketHandshakeLimit:19-20.
  - Other stale comments: table.ts:113 (stale pointer); offlineMatch.ts:237-239 ("not exported", which is false).
  - Orphan or truncated lines: client.ts:74-81 (orphan docblock), ladderAndReplay:31 (truncated line), pushTokens:74-75 (orphan docblock), gameInviteOutlives:64-65 (doubled `/**`).
  - Changelog comments that violate CLAUDE.md § Comments: engine/scoring:316-319 ("Was `{ u0: 6…}`") and 332-335 ("Was pinned at 20").
  - gameplay.test.ts:188-201 claims a rig seam was rejected, while liveGame.ts:44 has one (F9).
- **problem:** comments make claims that the code contradicts.
- **proposed:** delete or correct them.
- **effect:** readers stop being misled.
- **overlap:** new.
- **confidence:** high.

### 09-tests-server-engine-F15 (P3, XS) client.ts leaks sockets and listeners on failure paths
- **files:**
  - tests/helpers/client.ts:150: connectAs does not close the socket on `connect_error`.
  - :207: `waitFor` leaves its listener attached on timeout.
  - :200: DEADLINE_SCALE is read at import.
  - waitForPendingCode polls 50ms × 100.
- **problem:** a failing test leaks handles, which can keep `--test-force-exit` as the only exit and mask the first failure.
- **proposed:** close the socket and `off` the listener in the reject paths.
- **effect:** cleaner failure output.
- **overlap:** new.
- **confidence:** high.

### 09-tests-server-engine-F16 (P3, XS) A fixture sets a field the type does not carry
- **files:** tests/server/shutdownSeatLost.test.ts:35 sets `roundWinner`, which is not a field of the state it builds.
- **problem:** the fixture does not set what the test believes it sets.
- **proposed:** use the onlineTable.ts builder (F4), which is typed.
- **overlap:** extends tests-T7.
- **confidence:** medium.

### 09-tests-server-engine-F17 (P3, S) Env writes at module scope, an inventory for tests-T8
- **files:**
  - Module scope:
    - testServer.ts:20-88 writes 9 keys.
    - Integration files: accountDeletionMidRound:24-25, gameplay:47-50, ladderAndReplay:28-29, lobbyGrace:25, openingGraceTimesOut:21, ownerLoss:14, reconnect:36-43, pushTokens:46, rematch:30 and 36, rename:18, sessionReplaced:37-38, spectator:27-32, stateRedelivered:24, stats:28-29, teamsOnline:27-28, timerContainment:24, turnDeadline:20, verifyEmailLimiter:15, verifyEmailMailRoundTrip:21, quickmatchAutoStart.
  - In hooks: soakDrivesTheGame:31-32.
  - Server-unit env writes: tableStalls:109, logRedaction:629-637, cors, testOnlyEnv, socketTicket, rateLimiterFactory, appLinks, bootFailure.
- **problem:** ESM hoisting makes module-scope env writes order-sensitive. The config arrives through a process-global, not a parameter.
- **proposed:** `startTestServer({ env })` passes a config object into the boot path. This follows the same design as F1 and F2.
- **overlap:** extends tests-T8.
- **confidence:** high for the inventory.

## Prior findings that are wrong or already fixed

- None found to be wrong. One refinement:
  - Reports that call for a Clock seam (tests-T8, server-F9) should note that it already exists for five timer kinds (server/game/gameTimers.ts:9-32, with tests/helpers/fakeClock.ts). What is missing is integration-harness wiring plus the state-ack and seat-hold timers (F2).

## Inventory items checked (real / false positive)

- **Real:**
  - scripts/measureHeadsUpBalance.ts imports tests/helpers (F12).
  - The knip unused exports in offlineMatch.ts, sourceScan.ts, gameDriver.ts and table.ts (F13).
  - moduleEdges.resolveSpec: only its export is unused, since it is used at :44.
  - jscpd stubIo endMatchVote = seatReclaim; the same stub is in 4 files (F4).
- **False positive:** jscpd offlineSave v2/v3 fixtures are deliberate, because they are versioned save formats exercised by engine/offlineSave.
- **Good models to copy:**
  - roundOver.test.ts (fake writers), schemaDdl, roundEnd.
  - logRedaction `createLogger(sink)`.
  - lobbyIntents and friendships deps fakes.
  - takeoverSerialised (fake io).
  - engine/reconnectDelay (injected rng).
  - soak/gateBudget (budget derived from package.json).
  - helpers/userLock, importShellGuard, fileDeadline and filesRunReporter: guards with a floor that cannot be switched off.

## Coverage

| file | lines | verdict |
|---|---|---|
| tests/bots/botCardMemory.test.ts | 321 | F8 |
| tests/bots/botExchangeAwareness.test.ts | 136 | F8 |
| tests/bots/botFill.test.ts | 166 | F7 F12 |
| tests/bots/botPersonalities.test.ts | 417 | F7 F8 F9 |
| tests/bots/botSearchTimeout.test.ts | 368 | F7 F12 |
| tests/bots/botTeamAwareness.test.ts | 250 | F8 |
| tests/bots/botTotalTimeWatchdog.test.ts | 56 | F12 |
| tests/engine/achievements.test.ts | 79 | read; clean |
| tests/engine/combinations.test.ts | 210 | read; clean |
| tests/engine/deal.test.ts | 394 | F7 F9 |
| tests/engine/engineFloor.test.ts | 164 | read; clean |
| tests/engine/enumerator.property.test.ts | 297 | read; clean |
| tests/engine/exchange.test.ts | 351 | F9 |
| tests/engine/flow.test.ts | 360 | F8 F12 |
| tests/engine/helpers.ts | 93 | F8 F9 F12 |
| tests/engine/matchState.test.ts | 299 | F7 |
| tests/engine/matchTerminates.test.ts | 186 | F8 |
| tests/engine/offlineMatchContestPlay.test.ts | 57 | F8 (tests the helper) |
| tests/engine/offlineMatchHarness.test.ts | 101 | F8 (tests the helper) |
| tests/engine/offlineSave.test.ts | 133 | clean (v2/v3 fixtures deliberate) |
| tests/engine/passing.test.ts | 316 | read; clean |
| tests/engine/playRefusals.test.ts | 121 | read; clean |
| tests/engine/profileStats.test.ts | 94 | read; clean |
| tests/engine/rating.test.ts | 225 | F9 |
| tests/engine/reconnectDelay.test.ts | 14 | good model (injected rng) |
| tests/engine/replay.test.ts | 187 | read; clean |
| tests/engine/royalStraightBlindSpotHelpers.test.ts | 94 | F12 |
| tests/engine/scoring.test.ts | 496 | F14 |
| tests/engine/sharedGameFlow.test.ts | 79 | F7 |
| tests/engine/smoke.test.ts | 14 | read; clean |
| tests/engine/standings.test.ts | 58 | read; clean |
| tests/engine/storageKeys.test.ts | 13 | read; clean |
| tests/engine/straights.test.ts | 243 | read; clean |
| tests/engine/streak.test.ts | 98 | read; clean |
| tests/engine/teams.test.ts | 281 | read; clean |
| tests/helpers/adoptedHookRules.ts | 30 | read; clean |
| tests/helpers/androidAction.ts | 58 | read; clean |
| tests/helpers/client.ts | 243 | F4 F14 F15 |
| tests/helpers/clothDepartures.ts | 7 | read; clean |
| tests/helpers/fakeClock.ts | 34 | F2 (seam with 2 users) |
| tests/helpers/fileDeadline.mjs | 30 | read; clean |
| tests/helpers/filesRunReporter.mjs | 80 | read; clean |
| tests/helpers/friends.ts | 48 | F4 (re-implemented elsewhere) |
| tests/helpers/gameDriver.ts | 147 | F4 F13 |
| tests/helpers/hookSuppression.ts | 129 | read; clean |
| tests/helpers/importShellGuard.ts | 117 | read; clean |
| tests/helpers/instance.ts | 47 | F4 F13 |
| tests/helpers/lanternFixture.ts | 38 | read; clean |
| tests/helpers/liveGame.ts | 130 | F9 (redealExactly underused) |
| tests/helpers/liveRegions.ts | 19 | read; clean |
| tests/helpers/moduleEdges.ts | 69 | F13 (export only) |
| tests/helpers/offlineMatch.ts | 562 | F8 F12 F13 F14 |
| tests/helpers/onlineTable.ts | 31 | F4 (unused by hand-built fixtures) |
| tests/helpers/phoneTable.ts | 35 | read; clean |
| tests/helpers/routeMountings.ts | 39 | read; clean |
| tests/helpers/runWatch.mjs | 28 | read; clean |
| tests/helpers/sourceScan.ts | 463 | F7 F13 |
| tests/helpers/table.ts | 260 | F4 F13 F14 |
| tests/helpers/testServer.ts | 282 | F1 F17 |
| tests/helpers/trackedFiles.ts | 29 | read; clean |
| tests/helpers/userLock.ts | 76 | read; clean |
| tests/integration/abandonedGames.test.ts | 137 | F1 |
| tests/integration/abandonmentRecord.test.ts | 83 | F1 |
| tests/integration/accountDeletionMidRound.test.ts | 153 | F1 F14 F17 |
| tests/integration/addEmail.test.ts | 265 | F1 F4 |
| tests/integration/addEmailLimiter.test.ts | 63 | F1 |
| tests/integration/addressedByUser.test.ts | 135 | F4 |
| tests/integration/admin.test.ts | 303 | F3 |
| tests/integration/auth.test.ts | 559 | F1 (bcrypt timing stats) |
| tests/integration/bugReports.test.ts | 180 | F1 |
| tests/integration/changePassword.test.ts | 155 | read; clean |
| tests/integration/clientErrors.test.ts | 253 | F1 F4 |
| tests/integration/crossInstance.test.ts | 410 | F1 F3 F4 F13 |
| tests/integration/e2e.test.ts | 78 | F10 |
| tests/integration/events.test.ts | 158 | F3 F11 |
| tests/integration/friendRaces.test.ts | 260 | F1 F4 |
| tests/integration/friendRequestOffline.test.ts | 115 | F4 |
| tests/integration/friendRowTravelsWithTheEvent.test.ts | 140 | read; clean |
| tests/integration/friendScope.test.ts | 70 | F4 |
| tests/integration/friendsLadder.test.ts | 99 | F1 F4 |
| tests/integration/gameInviteOutlives.test.ts | 279 | F3 F4 F14 |
| tests/integration/gameplay.test.ts | 883 | F5 F9 F14 F17 |
| tests/integration/httpCaching.test.ts | 180 | F1 F10 |
| tests/integration/intentAcknowledged.test.ts | 276 | F4 F5 |
| tests/integration/ladderAndReplay.test.ts | 443 | F5 F11 F14 F17 |
| tests/integration/lobbyGrace.test.ts | 220 | F2 F4 F11 F17 |
| tests/integration/markEmailVerified.test.ts | 75 | F1 |
| tests/integration/openingGraceTimesOut.test.ts | 112 | F2 F11 F17 |
| tests/integration/ownerLoss.test.ts | 107 | F3 F5 F13 F17 |
| tests/integration/ownershipReclaim.test.ts | 82 | F1 F3 |
| tests/integration/passwordReset.test.ts | 371 | F1 (timing stats) |
| tests/integration/postgresRestart.test.ts | 231 | F1 F3 F4 F13 |
| tests/integration/pushTokens.test.ts | 415 | F3 F4 F14 F17 |
| tests/integration/quickmatchAutoStart.test.ts | 91 | F2 F3 F4 F17 |
| tests/integration/reconnect.test.ts | 1095 | F2 F5 F14 F17 |
| tests/integration/refusalCodes.test.ts | 83 | F1 |
| tests/integration/registerEmailLimiter.test.ts | 42 | read; clean |
| tests/integration/registrationFailureKeepsConnection.test.ts | 71 | F1 |
| tests/integration/rematch.test.ts | 471 | F4 F9 F17 |
| tests/integration/rename.test.ts | 128 | F17 |
| tests/integration/replayIdentity.test.ts | 83 | F1 |
| tests/integration/resendVerification.test.ts | 93 | F1 |
| tests/integration/restartConvergence.test.ts | 522 | F1 F3 F4 F13 |
| tests/integration/roomFullInvite.test.ts | 139 | F4 |
| tests/integration/roomLifecycleRaces.test.ts | 342 | F1 F3 F4 F5 |
| tests/integration/roomVisibility.test.ts | 357 | F3 F4 |
| tests/integration/schemaBootstrap.test.ts | 170 | F1 |
| tests/integration/seatHold.test.ts | 330 | F2 F4 F11 |
| tests/integration/sessionReplaced.test.ts | 298 | F3 F4 F14 F17 |
| tests/integration/shutdown.test.ts | 113 | F1 |
| tests/integration/soakDrivesTheGame.test.ts | 86 | F17 |
| tests/integration/soakLogReplays.test.ts | 103 | F1 |
| tests/integration/socketCloseReason.test.ts | 71 | F1 F4 |
| tests/integration/socketHandshakeLimit.test.ts | 219 | F3 F4 F5 F14 |
| tests/integration/socketOrigin.test.ts | 62 | F3 F4 |
| tests/integration/spectator.test.ts | 302 | F3 F4 F17 |
| tests/integration/stateRedelivered.test.ts | 117 | F2 F4 F11 F17 |
| tests/integration/stats.test.ts | 495 | F1 F17 |
| tests/integration/takeoverSerialised.test.ts | 162 | good model (fake io) |
| tests/integration/teamsOnline.test.ts | 214 | F1 F17 |
| tests/integration/testServerCleanup.test.ts | 68 | F1 |
| tests/integration/testServerKeepAlive.test.ts | 43 | F1 (exists for one-server-per-process) |
| tests/integration/testServerTeardown.test.ts | 37 | F1 (exists for one-server-per-process) |
| tests/integration/timerContainment.test.ts | 133 | F7 F17 |
| tests/integration/turnDeadline.test.ts | 95 | F2 F11 F17 |
| tests/integration/tutorialSeen.test.ts | 57 | read; clean |
| tests/integration/verifyEmailCode.test.ts | 191 | F1 |
| tests/integration/verifyEmailLimiter.test.ts | 40 | F17 |
| tests/integration/verifyEmailMailRoundTrip.test.ts | 89 | F12 F17 |
| tests/server/appLinks.test.ts | 105 | F10 F17 |
| tests/server/authReplyBeforeMail.test.ts | 238 | read; clean |
| tests/server/authRoutesLimited.test.ts | 44 | read; clean |
| tests/server/backupDb.test.ts | 351 | read; clean |
| tests/server/bootFailure.test.ts | 42 | F17 |
| tests/server/commitMove.test.ts | 158 | read; clean |
| tests/server/cors.test.ts | 92 | F17 |
| tests/server/csp.test.ts | 30 | read; clean |
| tests/server/dbPush.test.ts | 47 | read; clean |
| tests/server/dbResetGuard.test.ts | 86 | read; clean |
| tests/server/dbTls.test.ts | 72 | read; clean |
| tests/server/deployRuntime.test.ts | 41 | read; clean |
| tests/server/disposeClearsTimers.test.ts | 59 | read; clean |
| tests/server/endMatchVote.test.ts | 306 | F3 F4 |
| tests/server/exchangeRearm.test.ts | 105 | read; clean |
| tests/server/exchangeVisibility.test.ts | 316 | F7 (false premise) |
| tests/server/friendships.test.ts | 156 | good model (deps) |
| tests/server/gameTimers.test.ts | 78 | F2 (good: fakeClock) |
| tests/server/historyBound.test.ts | 56 | F7 (false premise) |
| tests/server/lobbyIntents.test.ts | 152 | good model (deps) |
| tests/server/logRedaction.test.ts | 718 | F7 F17 |
| tests/server/noWebBuild.test.ts | 73 | F10 |
| tests/server/onlineGameLogic.test.ts | 240 | read; clean |
| tests/server/openingGrace.test.ts | 167 | F2 (good: fakeClock) |
| tests/server/passwordRule.test.ts | 30 | read; clean |
| tests/server/persistedEnvelope.test.ts | 239 | F3 |
| tests/server/pgConnections.test.ts | 63 | read; clean |
| tests/server/pool.test.ts | 48 | F4 |
| tests/server/poolConfig.test.ts | 32 | read; clean |
| tests/server/postgresAdapterPatch.test.ts | 109 | F4 |
| tests/server/privacyRetention.test.ts | 88 | F7 (false premise) |
| tests/server/protocolEvents.test.ts | 152 | F7 |
| tests/server/protocolVersion.test.ts | 58 | F7 |
| tests/server/pushShape.test.ts | 101 | read; clean |
| tests/server/rateLimiterFactory.test.ts | 182 | F7 F17 |
| tests/server/replayShape.test.ts | 75 | read; clean |
| tests/server/retentionOffWritePath.test.ts | 61 | F7 |
| tests/server/roundEnd.test.ts | 425 | good model |
| tests/server/roundOver.test.ts | 462 | good model (fake writers) |
| tests/server/routesAuthenticated.test.ts | 71 | read; clean |
| tests/server/sanitizeVacated.test.ts | 52 | read; clean |
| tests/server/schemaDdl.test.ts | 337 | good model |
| tests/server/seatAllocation.test.ts | 282 | read; clean |
| tests/server/seating.test.ts | 33 | read; clean |
| tests/server/seatLedger.test.ts | 231 | F7 |
| tests/server/seatReclaim.test.ts | 367 | F3 F4 |
| tests/server/serverLoadable.test.ts | 87 | F7 |
| tests/server/sessionEviction.test.ts | 73 | F3 |
| tests/server/sessionRevocation.test.ts | 68 | F7 |
| tests/server/shutdownBudget.test.ts | 49 | read; clean |
| tests/server/shutdownSeatLost.test.ts | 74 | F3 F16 |
| tests/server/socketAdapter.test.ts | 130 | F3 F4 |
| tests/server/socketErrorLogging.test.ts | 173 | F7 |
| tests/server/socketEvents.test.ts | 374 | F7 |
| tests/server/socketRateLimit.test.ts | 72 | read; clean |
| tests/server/socketRefusalLogging.test.ts | 204 | F3 |
| tests/server/socketRoundFlags.test.ts | 97 | read; clean |
| tests/server/socketSchemas.test.ts | 44 | read; clean |
| tests/server/socketTicket.test.ts | 55 | F17 |
| tests/server/sourceMaps.test.ts | 69 | F10 |
| tests/server/stuckExchange.test.ts | 48 | read; clean |
| tests/server/tableOwnership.test.ts | 219 | F7 |
| tests/server/tableStalls.test.ts | 344 | F2 F4 F5 F17 |
| tests/server/tableState.test.ts | 176 | read; clean |
| tests/server/testOnlyEnv.test.ts | 84 | F7 F17 |
| tests/server/uniqueViolation.test.ts | 28 | read; clean |
| tests/server/usernameRule.test.ts | 102 | read; clean |
| tests/server/vacateSeatPersonality.test.ts | 62 | F6 |
| tests/server/validate.test.ts | 30 | F7 |
| tests/server/verificationEmailBody.test.ts | 62 | read; clean |
| tests/server/voidAbandonedMatch.test.ts | 106 | F4 F6 |
| tests/server/weakSeatTakeover.test.ts | 396 | F3 F6 |
| tests/soak/gateBudget.ts | 107 | good (derived budget) |
| tests/soak/invariants.ts | 181 | read; clean |
| tests/soak/replay.ts | 211 | F1 F4 F9 |
| tests/soak/soak.ts | 832 | F3 F4 F9 |
