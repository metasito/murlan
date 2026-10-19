# 05-server — slice review (SRC 50144087)

All 75 files in the slice were read in full. Resilience got the most weight: reconnect, restart, shutdown, DB failure and timers. Paths are relative to SRC.

## Findings

### 05-server-F1 (P1, M) Lobby grace lives in one process, so a player who reconnects to another instance loses the seat
- files:
  - The timer is armed in two places: `server/socket/socketPresence.ts:215` arms it on the disconnecting socket's instance, and `server/game/tableHandlers.ts:698` arms it on the owner.
  - Its expiry check is local: `server/socket/socketTable.ts:240-266`, which reads `userSocketMap` and `socketRoomMap` at :259-260.
  - It is cleared only locally: `server/socket/socketRooms.ts:129`, which is the rejoining socket's instance, and `server/game/tableHandlers.ts:494-495`, which is the owner.
  - `startMatchAction` reads the owner's local `usersInLobbyGrace` at `server/game/tableHandlers.ts:557`.
  - The timer store itself is `server/game/gameTimers.ts`.
- problem:
  - ADR-0003 makes multi-instance real, but lobby grace is a per-process timer. Suppose a player drops on instance A and reconnects within the grace window through instance B.
    - A's expiry asks A's own `userSocketMap`, which does not hold the player.
    - So A calls `handleSeatRelease` and frees a seat that its holder is sitting in.
  - The comment at `tableHandlers.ts:491-493` says clearing on the owner "makes the answer independent of" which instance saw the socket go. That is false whenever the grace was armed by `socketPresence.ts:215` on a non-owner instance.
  - `startMatchAction` also counts as absent only the users whose grace timer is on the owner.
  - `tests/integration/lobbyGrace.test.ts` boots one instance, so it is green by construction for this class.
- proposed:
  - Make the expiry ask the cluster instead of its own maps. `isUserAtTable(userId, roomId)` already exists in `socketRegistry.ts:61` and uses `io.in(userRoom).fetchSockets()`.
  - Then `if (await isUserAtTable(userId, roomId)) return;` replaces the local check.
  - Arm the grace in one place only (the owner, through `applyOrForward`), so both clears and `usersInLobbyGrace` see the same timer.
- effect: Removes a cross-instance seat-loss class. Deletes the false comment. A two-instance variant of `lobbyGrace.test.ts` becomes the regression test.
- overlap: new. It is in the same family as the comment at `tableHandlers.ts:174-175`, which acknowledges per-process timers.
- confidence: medium-high. The mechanism was read end to end, but no two-instance run was done.

### 05-server-F2 (P1, S) Shutdown hands rooms back while bot and AFK timers keep playing and persisting
- files:
  - `server/http/shutdown.ts:74-102`
  - `server/game/gameRoom.ts:157-163`
  - `server/game/gameTurn.ts:191-247` (`runBotTurn`, `handleAutoPass`)
  - `server/game/gamePersistence.ts:106-125`
- problem:
  - `beginShutdown()` (`shutdown.ts:74`) only sets a flag. The flag is read by the rejoin, the orphan sweep, the router and the lobby grace (`tableHandlers.ts:661,813,819`, `tableRouter.ts:294`, `socketTable.ts:248`, `socketPresence.ts:196`).
  - It is never read by the turn timers. After `closeOwnership()` (`shutdown.ts:86`), the drain can run up to `DRAIN_TIMEOUT_MS` (6 s), and during that window:
    - a bot timer (about 1.2 s) or an auto-pass still mutates the in-memory game,
    - it calls `persistGameState`,
    - and it writes `active_games`.
  - Meanwhile another instance can already have claimed and restored the room. That gives two writers on one row, which is exactly the hazard the comment at `shutdown.ts:83-85` exists to prevent.
- proposed:
  - Stop all turn timers in the shutdown path before `closeOwnership()`. One option is to call `clearRoomTimers(roomId)` for every `activeGames` key inside `beginShutdown()`.
  - Alternatively, make `arm()` in `gameTimers.ts` refuse while `isShuttingDown()`.
  - Persist writes that are already queued still drain, which is what the drain is for.
- effect: One owner per row holds through a deploy. Add a test that fires a bot timer after `beginShutdown` and asserts no write.
- overlap: new.
- confidence: medium-high.

### 05-server-F3 (P2, S) An ownership query error during reclaim is read as "claimed elsewhere" and drops live tables
- files: `server/game/gameOwnership.ts:140-153`, `:163-180`; `server/game/tableHandlers.ts:835` (`onRoomLost` → `disposeGame(roomId,false)`)
- problem:
  - `takeLock` returns `null` when it cannot connect, but `false` when the query throws (`:149-151`).
  - `reclaim` treats `false` as lost (`:170-173`). It deletes the room from `held` and disposes the game.
  - So a Postgres blip during reclaim, such as a statement timeout or a failover mid-query, throws away a live table's memory-only state: the move log, spectators, timers and any unwritten moves. It does this without retrying, even though the retry path for `null` exists right beside it.
- proposed: Return `null` from the `catch` so the existing `OWNERSHIP_RECLAIM_RETRY_MS` path covers it. This is a one-line change.
- effect: Removes a data-loss path on DB failure. Add a unit test with a query that throws once.
- overlap: new.
- confidence: medium-high.

### 05-server-F4 (P2, S) `disposeGame` releases the lock before the row delete lands
- files: `server/game/gamePersistence.ts:106-125`; `server/game/tableRouter.ts` (restore-mode claim)
- problem:
  - `void releaseRoom(roomId)` (`:116`) runs right away, while the `active_games` delete is queued behind pending writes on `inRoomOrder` (`:117-124`).
  - In that window, a restore-mode action such as rejoin or a rematch vote can find no owner, claim the lock and rehydrate the row it reads. That resurrects a table that was just disposed.
  - The comment at `:113-115` justifies releasing promptly, but not the ordering.
- proposed: When `deleteRow` is set, release inside the same `inRoomOrder` chain after the delete settles: `void inRoomOrder(roomId, () => del().finally(() => releaseRoom(roomId)))`.
- effect: Closes a resurrection race. `activeGames` is already empty, so nothing else waits on it.
- overlap: extends server-F2 (persistence has no owning module) and server-F10.
- confidence: medium.

### 05-server-F5 (P2, S) Retention and prune deletes are unbounded under a 5 s statement timeout, and one policy has two homes
- files:
  - `server/game/retention.ts:25-52`
  - `server/game/gamePersistence.ts:269-279` (`pruneAbandonedGames`) and `:292-303`
  - `server/socket/ticket.ts:89`
  - `server/store/db.ts` (query timeout)
- problem:
  - Each sweep is one unbatched `DELETE ... WHERE ts < cutoff`. Once a backlog makes it exceed the 5 s `statement_timeout`, it times out on every run and never catches up.
  - Each failure is logged at error level (`retention.ts:58`). Through the error recorder (F9), that becomes another `server_errors` row.
  - Every instance runs the sweep every interval.
  - `pruneStaleRooms` already batches with `STALE_ROOM_BATCH`, so the right shape exists in the same file.
  - Separately, `ticket.ts:89` prunes `socket_ticket_nonces` inside every handshake. That is the per-write prune idiom `retention.ts:1-9` says was removed, so the retention policy has two homes.
- proposed:
  - Use one batched helper, `pruneOlderThan(table, where, batch=5000)`, as a `DELETE ... WHERE ctid IN (SELECT ctid ... LIMIT n)` loop.
  - Move the nonce prune into `sweepRetention`.
- effect: The sweep converges after an outage, and the handshake loses a write. `retention.ts` becomes the only home again.
- overlap: new.
- confidence: medium. The timeout behaviour is inferred from the config, not measured.

### 05-server-F6 (P2, S) HTTP rate limiters use the per-instance memory store
- files: `server/http/rateLimit.ts:61-69`; `server/http/routes.ts:139-149` (`loginUsernameLimiter`); `server/socket/socketSafety.ts:60`
- problem:
  - No `store` is passed, so express-rate-limit keeps counts in process memory. Under ADR-0003 with N instances:
    - the per-username login limit becomes about 10 × N attempts per window,
    - and every deploy resets it.
  - That matters because the comment at `routes.ts:139-149` calls this limiter what actually makes a password hard to guess.
  - The socket limits (`socketSafety.ts:60`) are also per instance, but a socket lives on one instance, so that part is fine.
- proposed: Use a Postgres-backed store for the auth limiters only. A small `Store` over one `rate_limits(key, window_start, hits)` table using upsert is enough; the other limiters can stay in memory. Otherwise, record the N× ceiling as accepted in `server/CLAUDE.md`.
- effect: The brute-force bound becomes cluster-wide and survives restarts.
- overlap: new.
- confidence: high on the fact, medium on the severity.

### 05-server-F7 (P2, M) The connect path and the sweeper fetch every socket in the cluster
- files: `server/socket/socketRegistry.ts:72-111` (`onlineUserIds`, `tablePresence` → `_io.fetchSockets()` at :79 and :101); `server/socket/socketPresence.ts:111`; `server/game/tableHandlers.ts:812-826`; `server/game/gamePersistence.ts:331`
- problem:
  - Every connection, every `friend:get_online_list`, and every orphan or sweeper pass calls `io.fetchSockets()` over the whole cluster. Through the postgres adapter, that is a broadcast request whose reply holds every socket.
  - A reconnect storm after a deploy is therefore O(N²) in sockets.
  - `resumeOrphanedTables` also full-scans the `active_games` jsonb on every pass.
  - The single-user helpers in the same file (`:47`, `:61`, `:127`) already scope correctly with `io.in(userRoom(id))`.
- proposed: `onlineUserIds(ids)` → `io.in(ids.map(userRoom)).fetchSockets()`, and `tablePresence(roomId)` → `io.in(roomId).fetchSockets()`.
- effect: The cost becomes proportional to friends or seats, not to the cluster.
- overlap: new.
- confidence: medium. The adapter cost is inferred from the API.

### 05-server-F8 (P3, XS) Outbound HTTP has no timeout
- files: `server/http/mail.ts:75`, `:101-104`; `server/socket/push.ts:109`
- problem:
  - `fetch` to the mail provider and to Expo push has no `signal`, so a hung remote holds the request, or the un-awaited invite push, forever.
  - `mail.ts:101-104` cites the Replit "Run button", which has been stale since ADR-0006.
- proposed: Add `signal: AbortSignal.timeout(10_000)` to both, and delete the stale sentence.
- overlap: new.
- confidence: high.

### 05-server-F9 (P3, S) The error recorder amplifies DB outages, and client crashes inflate server errors
- files: `server/http/serverErrors.ts:12-20`; `server/http/logger.ts` (`setErrorRecorder`); `server/http/routes.ts:300-310`, `:978`, `:982`, `:1020`; `server/http/clientErrors.ts`; `server/http/bugReports.ts`
- problem:
  - Each error-level log line runs one `INSERT server_errors`. During a DB outage, every failed query logs an error, and each log asks for another pool checkout. That deepens the pool starvation it is reporting.
  - Client crash reports are logged at error level (`routes.ts:982`), so each one is also a `server_errors` row and counts toward `/admin`'s server-error panel.
  - One `errorReportLimiter` instance is shared by crash reports and bug reports (`:978`, `:1020`), so a crash loop starves bug reports.
- proposed:
  - Have the recorder drop inserts while the pool has waiters, or keep a small in-memory ring and flush it from the sweeper.
  - Log client crashes at warn level.
  - Give bug reports their own limiter instance.
- overlap: new.
- confidence: medium.

### 05-server-F10 (P3, S) `/admin` and the circle leaderboard saturate the 10-connection pool
- files: `server/http/admin.ts:8`, `:214-254`; `server/http/sourceMaps.ts:69-89`; `server/game/ratings.ts:224-236`; `server/store/friendStore.ts:24-32`
- problem:
  - `adminSnapshot` runs 18 queries in parallel against a pool of 10.
  - The error-group queries are GROUP BYs over the whole table, despite the claim at `admin.ts:8` that "Every query is bounded".
  - `symbolicate` parses a source map per crash group on the game process's event loop.
  - `getCircleLeaderboard` runs `Promise.all` with one `currentRow` per member, and friend count has no cap (`getFriends` has no LIMIT). A large circle holds the whole pool and makes live gameplay writes wait.
- proposed:
  - Bound the error groups with a date window.
  - Run the admin queries in chunks of at most 4.
  - Replace the per-member `currentRow` with one `inArray` query.
  - Make the false comment true.
- overlap: new.
- confidence: medium.

### 05-server-F11 (P3, S) Boot DDL runs without a lock while another revision serves
- files: `server/store/schemaDdl.ts:489-496`
- problem:
  - `ensureSchema` runs about 100 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements on every boot. Postgres takes ACCESS EXCLUSIVE on the table even when the column exists.
  - This happens under the 5 s `statement_timeout` while the old revision holds row locks, so a boot can fail on a lock wait.
  - Two booting instances are not serialised.
- proposed: Wrap the DDL in `pg_advisory_xact_lock(<const>)` with `SET LOCAL lock_timeout` and a retry, or skip `ALTER`s whose column is already in `information_schema`.
- overlap: new.
- confidence: medium. The Postgres lock behaviour is from knowledge, not measured here.

### 05-server-F12 (P3, XS) The shutdown budget leaves out steps it spends time on
- files: `server/http/shutdown.ts:34`, `:78-102`; `tests/server/shutdownBudget.test.ts`
- problem:
  - `FORCED_EXIT_MS = 1500 + 6000 + 2000` counts the settle, the drain and slack.
  - It omits `socketAdapterReady(1_000)`, `io.close()`, `closeOwnership()` and `adapterPool.end()`.
  - Only about 1 s of the 2 s slack is really free, and the test checks just the drain against the watchdog. A step added later can make the watchdog fire on the ordinary path.
- proposed: Derive `FORCED_EXIT_MS` from a named list of step budgets, and have the test sum that list.
- overlap: new.
- confidence: medium.

### 05-server-F13 (P3, XS) The deal waits on a best-effort status write
- files: `server/game/dealRound.ts:40-44`
- problem: `await roomStore.updateRoomStatus(...).catch(warn)` sits before `broadcastGameState`. The write is explicitly optional, yet under DB stress it delays the deal by up to the connection wait plus the query timeout.
- proposed: Make it `void` (fire-and-forget), or move it after the emits.
- overlap: new.
- confidence: medium.

### 05-server-F14 (P3, S) `pruneStaleRooms` only knows about this process's games
- files: `server/game/gamePersistence.ts:290`, `:292-303`
- problem:
  - Candidates are filtered with the local `activeGames.has(id)` only.
  - A room older than `STALE_ROOM_MAX_AGE_MS` that is live on another instance loses its `room_players` and `active_games` rows underneath that instance.
  - The comment at `:290` claims a safety it only has on a single instance.
- proposed: Exclude rooms with `status = 'in_progress'` or an `active_games.updated_at` within the window in SQL. That makes the guard cluster-wide.
- overlap: new.
- confidence: medium. It needs a match that lasts longer than the stale age, so it is rare.

### 05-server-F15 (P3, S) An uncaught exception exits without draining queued persists
- files: `server/socket/socketSafety.ts:265-280`; `server/index.ts`
- problem: `process.exit(1)` runs immediately, which drops every write queued on `inRoomOrder` and leaves the ownership locks to time out with the connection. The comment at `:275-277` defends exiting, not exiting without the drain.
- proposed: Call the existing `shutdown("uncaughtException", ...)` with a short watchdog, then exit with code 1.
- overlap: new.
- confidence: low-medium. It is a judgement call, because state after an uncaught exception is suspect.

### 05-server-F16 (P3, S) Room creation is not atomic, and the room store reaches up into `game/`
- files: `server/store/roomStore.ts:5-7`, `:68-95`, `:190-192`, `:335-339`; `server/socket/lobbyIntents.ts:60`; `server/socket/socketRooms.ts:224`
- problem:
  - `createRoom`, then a separate `addRoomPlayer(room.id, host, 0)`: a failure between the two leaves a host-less `waiting` room. A public one would be offered by `findWaitingPublicRooms`; `requireOccupied` covers that case, but it is a patch for the gap.
  - `removeRoomPlayer` is now called only by `tests/integration/roomVisibility.test.ts`, so it is dead in production.
  - The store imports `seatHoldMs` from `game/gameTimers.ts`. The store depends on the game layer for a constant, which inverts the layering.
- proposed:
  - Use `createRoom(host, …)` that inserts the host's seat in the same transaction, and delete `addRoomPlayer` and `removeRoomPlayer`.
  - Pass `holdMs` in as a parameter.
- overlap: extends server-F13 (layering) and server-F11 (lobby port half adopted).
- confidence: high.

### 05-server-F17 (P3, XS) Comments that lie
- files: `server/game/onlineGameLogic.ts:1`, `:176`, `:344`; `server/socket/socketGameplay.ts:33`; `server/game/tableHandlers.ts:491-493` (see F1); `server/http/admin.ts:8` (see F10); `server/http/mail.ts:101-104` (see F8)
- problem:
  - `onlineGameLogic.ts` names `server/socket/socket.ts` as its caller and as the home of `handleRoundOver`. They are really `tableHandlers.ts` and `roundOver.ts`.
  - `socketGameplay.ts:33` cites `authMaxFromEnv in routes.ts`, which no longer exists.
- proposed: Correct or delete them.
- overlap: new.
- confidence: high.

### 05-server-F18 (P3, XS) Auth error paths: raw store errors reach the client, and the logout destroy error is ignored
- files: `server/socket/socket.ts:116-118`; `server/http/routes.ts:531-534`; client `context/SocketContext.tsx:314-325`
- problem:
  - An express-session store failure at the handshake is passed through as `next(err)`, so a raw pg message reaches the client's `connect_error`.
  - `AUTH_UNAVAILABLE` has no client consumer. The client retries everything except `CLIENT_OUTDATED`.
  - In logout, the `req.session.destroy` callback ignores its error and answers success.
- proposed: Map store errors to `payload("AUTH_UNAVAILABLE")`, and log the destroy error.
- overlap: new.
- confidence: medium.

## Prior findings that are wrong or already fixed
- None are fixed in SRC. Every prior finding I checked in this slice is still present, at the same lines or within a few:
  - server-F3: `lobbyIntents.ts:58,73,77,83` and `socketRooms.ts:111-126`
  - server-F4: `tableHandlers.ts:309-311` vs `:541-543`
  - server-F5 / domain-F10: `gameTurn.ts:287-304`
  - server-F6: `routes.ts:452-482` vs `:502-522`
  - server-F9: `onlineGameLogic.ts:95,124`
  - server-F10: `gamePersistence.ts:252-260` and `gameTurn.ts:214-222`, `:351-359`
  - server-F13: confirmed, and F16 adds store→game
  - server-F14: `socketPresence.ts:88-103`
  - server-F16: `socketGameplay.ts:80-181`
  - server-F17: `tableActions.ts:85-95`
  - server-F19: `gameTurn.ts:263-270`, plus the hard-coded Italian "Qualcuno" in `friendships.ts:88,105`
  - server-F20: `socketGameplay.ts:39-43`
  - domain-F4: `tableState.ts:189-197`
  - domain-F15: `replayShape.ts:30`
  - domain-F17: `stats.ts:33-35`
- server.md "Already deep: leave alone" lists `tableRouter.ts`. I agree, and ADR-0003 and ADR-0007 cover it. F4 touches only `disposeGame`'s ordering, not the router.
- Ticket #1640 (the `tableState` field list) is open and touches `MEMORY_ONLY`. I propose nothing there.

## Inventory items checked (real / false positive, one line each)
- Functions of 80 lines or more:
  - `registerRoutes` (632): real, server-F6.
  - `registerRoomHandlers` (209): real.
  - `handleRoundOver` (181): real.
  - `resolveRoundEnd` (147): real.
  - `startMatchAction` (136): real, server-F4.
  - `createFriendships` (135): real but flat. It is a closure of small methods, so leave it alone.
  - `setupSocket` (131): real.
  - `renderAdminPage` (122): real, a template, so leave it alone.
- Duplicated blocks:
  - `tableHandlers.ts:202-214` = `:260-269` (jscpd and inventory): real, the play/pass guards. Fold them with server-F4.
  - `socketGameplay.ts` 87-101 / 113-132 / 156-181: real, server-F16.
  - `routes.ts` limiter blocks (200-245/216-253, 271-298/280-310): real but trivial config. Not worth it.
  - `routes.ts` 486-502 vs 564-578 (lookup plus password compare): real, server-F6.
  - `routes.ts` 871-883 vs 877-889 (friend param routes): real, trivial.
  - `friendStore.ts` 24-34 vs 34-52: real but trivial. These are three join-and-filter readers (`getFriends`, `getPendingFriendRequests`, `getSentFriendRequests`), and they are clearer apart.
  - `friendships.ts` 111-120 vs 117-125: false positive. The decline and cancel one-liners differ in who is authorised.
  - The cross-tier pairs (leaderboard.tsx/socket.ts, replay.tsx/app.ts, verify-email/app.ts, index.tsx/retention.ts): false positives, import blocks.
- Cycles and layer violations: the inventory shows none for `server/`. Real anyway are `game/` → `socket/` (server-F13) and `store/roomStore.ts` → `game/gameTimers.ts` and `game/seatAllocation.ts` (F16).
- Test-only exports (`ABANDONED_GAME_MAX_AGE_MS`, `setClock`, `__testables`, `inFlight`, `rehydrateGame`, `ownershipKey`, `resolvePoolMax`): real test seams, which is acceptable. `removeRoomPlayer` is test-only, see F16. `emitRoomStateTo` is test-only (`tests/integration/reconnect.test.ts`).
- depcruise/knip: `validate.ts:3` imports the type `express-serve-static-core`, which is not in `package.json` (it comes in through `@types/express`). Real. Replace it with `import type { ParamsDictionary } from "express"`, or let `Request["params"]` stand in.
- knip unused exports:
  - Verified by grep as used only in their own file, so the `export` can go:
    - `socketTable.ts`: `announceRoomJoinable`, `roomOf`, `seatedHumansOf`
    - `SESSION_EVICTION_EVENT` (`socketPresence.ts`)
    - `STOP_SPECTATING_EVENT` (`seating.ts`)
    - `armAfterMove` (`gameTurn.ts`)
    - `DISCONNECT_SETTLE_MS` (`shutdown.ts`)
    - `MAX_REPLAYS_LISTED` (`replays.ts`)
    - `LEADERBOARD_SIZE` (`ratings.ts`)
    - `ROW_LIMIT` (`admin.ts`)
  - The `START_RATING` re-export at `ratings.ts:238` is real and unused: every importer takes it from `lib/game/rating.ts`.
  - `EmailTakenError` is real. It is thrown at `userStore.ts:100`, but production only names it in comments (`routes.ts:225,419`), and only `tests/integration/addEmailLimiter.test.ts` uses it.
  - `SESSION_MAX_AGE_MS` is test-only (`privacyRetention.test.ts`), which is acceptable.
  - The knip type-only items in the slice (`HistoryParticipant`, `ScoreboardRow`, `TableActionBase`, `LimiterKey`, `DayCount`) were not grepped individually, so they are unverified.

## Coverage
| file | lines | verdict |
|---|---|---|
| server/app.ts | 256 | clean |
| server/game/botSeat.ts | 22 | clean |
| server/game/dealRound.ts | 52 | F13 |
| server/game/gameOwnership.ts | 253 | F3 |
| server/game/gamePersistence.ts | 396 | F4, F5, F7, F14; confirms server-F10 |
| server/game/gameRoom.ts | 209 | F2 |
| server/game/gameTimers.ts | 213 | F1, F2 |
| server/game/gameTurn.ts | 422 | F2; confirms server-F5, F10, F19 |
| server/game/onlineGameLogic.ts | 494 | F17; confirms server-F9 |
| server/game/ratings.ts | 238 | F10; knip START_RATING, LEADERBOARD_SIZE |
| server/game/replays.ts | 105 | clean (knip MAX_REPLAYS_LISTED export) |
| server/game/replayShape.ts | 57 | confirms domain-F15 |
| server/game/retention.ts | 60 | F5 |
| server/game/roundOver.ts | 344 | confirms server-F10 |
| server/game/seatAllocation.ts | 146 | leave-alone: pure seat and hold rules behind a small interface |
| server/game/seatLedger.ts | 85 | leave-alone: the one writer of seat fields (server-F12 already covers its scope) |
| server/game/stats.ts | 241 | confirms domain-F17 |
| server/game/tableActions.ts | 96 | confirms server-F17 |
| server/game/tableHandlers.ts | 839 | F1, F4, F7, F17; confirms server-F3, F4 |
| server/game/tableRouter.ts | 332 | leave-alone: deep, ADR-0003 and ADR-0007 |
| server/game/tableState.ts | 209 | confirms domain-F4; ticket #1640 |
| server/game/userNames.ts | 14 | clean |
| server/http/admin.ts | 288 | F10, F17 |
| server/http/adminPage.ts | 174 | clean |
| server/http/appLinks.ts | 26 | clean |
| server/http/authTokens.ts | 200 | clean |
| server/http/bootEnv.ts | 14 | clean |
| server/http/bugReports.ts | 99 | F9 |
| server/http/buildInfo.ts | 13 | clean |
| server/http/clientErrors.ts | 103 | F9 |
| server/http/cors.ts | 38 | clean |
| server/http/deleteAccount.ts | 89 | clean |
| server/http/errorHandler.ts | 28 | clean |
| server/http/logger.ts | 161 | F9 |
| server/http/mail.ts | 117 | F8 |
| server/http/rateLimit.ts | 70 | F6 |
| server/http/roundHistoryView.ts | 110 | clean |
| server/http/routes.ts | 1041 | F6, F9, F18; confirms server-F6 |
| server/http/schemas.ts | 118 | clean |
| server/http/serverErrors.ts | 46 | F9 |
| server/http/session.ts | 46 | clean |
| server/http/shutdown.ts | 123 | F2, F12 |
| server/http/sourceMaps.ts | 89 | F10 |
| server/http/staticPaths.ts | 48 | clean |
| server/http/testOnlyEnv.ts | 19 | clean |
| server/http/validate.ts | 19 | inventory: express-serve-static-core import |
| server/index.ts | 39 | F15 |
| server/socket/emit.ts | 38 | clean |
| server/socket/events.ts | 76 | clean |
| server/socket/friendships.ts | 200 | confirms server-F19 ("Qualcuno") |
| server/socket/lobbyIntents.ts | 125 | F16; confirms server-F3 |
| server/socket/payload.ts | 15 | confirms server-F19 |
| server/socket/push.ts | 130 | F8 |
| server/socket/pushShape.ts | 77 | leave-alone: pure, tested without I/O |
| server/socket/seating.ts | 57 | clean (knip STOP_SPECTATING_EVENT export) |
| server/socket/socket.ts | 210 | F18 |
| server/socket/socketAdapter.ts | 177 | leave-alone: adapter wiring, ADR-0003 |
| server/socket/socketGameplay.ts | 182 | F17; confirms server-F16, F20 |
| server/socket/socketPresence.ts | 330 | F1, F7; confirms server-F14 |
| server/socket/socketRegistry.ts | 203 | F7 |
| server/socket/socketRooms.ts | 255 | F1, F16; confirms server-F3 |
| server/socket/socketSafety.ts | 280 | F6, F15 |
| server/socket/socketTable.ts | 450 | F1; knip unused exports |
| server/socket/socketTypes.ts | 5 | clean |
| server/socket/ticket.ts | 102 | F5 |
| server/store/codes.ts | 13 | clean |
| server/store/db.ts | 58 | clean |
| server/store/drainPool.ts | 49 | clean |
| server/store/friendRows.ts | 31 | clean |
| server/store/friendStore.ts | 358 | F10 |
| server/store/pool.ts | 23 | clean |
| server/store/roomStore.ts | 340 | F16 |
| server/store/schemaDdl.ts | 496 | F11 |
| server/store/userLock.ts | 20 | clean |
| server/store/userStore.ts | 207 | clean (knip EmailTakenError) |
