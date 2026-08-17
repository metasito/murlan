# A4 — Resilience & error handling

Repo `C:\Users\roton\murlan`, SHA `b894af461550cd1a184a6a6f1694baf10d27b70c`, branch `main`.
Read-only pass. Findings ordered most severe first.

**Counts:** Critical 0 · High 4 · Medium 5 · Low 1

---

### [RES-01] Give the root ErrorBoundary a fallback it can actually render

- **Severity:** High
- **Confidence:** High (read the code, then proved it by running the fallback under jest-expo)
- **Effort:** S (<1h)
- **Location:** `app/_layout.tsx:78-98` (`<ErrorBoundary>` at `:79`, `<SafeAreaProvider>` at `:82`), `components/ErrorFallback.tsx:26`, `components/ErrorBoundary.tsx:53-64`
- **Problem:** The app's only error boundary is mounted *outside* `SafeAreaProvider`. Its fallback,
  `ErrorFallback`, calls `useSafeAreaInsets()` on its first line, and
  `react-native-safe-area-context@5.6.2` throws when no provider is above it
  (`node_modules/react-native-safe-area-context/src/SafeAreaContext.tsx:150-156` —
  `if (insets == null) throw new Error(NO_INSETS_ERROR)`). So the moment the boundary catches
  anything, the fallback it renders throws, and React attributes that second error to the *next*
  boundary above — of which there is none, because `<ErrorBoundary>` is the outermost element the
  app renders.
- **Impact:** Every render crash anywhere in the app produces a blank screen instead of the
  "something went wrong / Restart / Continue" screen. The player gets no message, no Restart
  button, and no `resetError`; the only way out is to kill the app. Worse, the crash-report POST
  lives in `ErrorFallback`'s `useEffect` (`components/ErrorFallback.tsx:36-44`), which never runs
  because the component never mounts — so `POST /api/client-errors`
  (`server/routes.ts:417-438`) has no working reporter at all and the team is blind to every
  client crash in production.
- **Repro / proof:** Ran, from a throwaway config outside the repo, under `jest-expo/ios` with the
  repo's own `tests/native/setup.ts`:
  `render(<Outer><ErrorBoundary><Thrower/></ErrorBoundary></Outer>)` where `Thrower` throws on
  render and `Outer` is a bare probe boundary. Result: the error React reported was
  `No safe area value available. Make sure you are rendering \`<SafeAreaProvider>\` at the top of
  your app.` thrown at `components/ErrorFallback.tsx:26:35`, with `componentStack` =
  `ErrorFallback → ErrorBoundary → Outer` and `errorBoundary: Outer` — i.e. `ErrorBoundary` did
  **not** catch its own fallback's throw; it propagated past it. In `app/_layout.tsx` there is no
  `Outer`, so it propagates to the React root and the tree unmounts.
- **Proposed fix:** Move `<ErrorBoundary>` inside `<SafeAreaProvider>` in `app/_layout.tsx`
  (wrapping `<GestureHandlerRootView>` or `<RootLayoutNav />`), *and* make `ErrorFallback`
  independent of any provider — replace `useSafeAreaInsets()` with
  `useContext(SafeAreaInsetsContext) ?? { top: 0, right: 0, bottom: 0, left: 0 }` so the crash
  screen renders even if the crash was in the provider itself. Both, not either: the second is
  what makes the boundary genuinely last-resort.
- **Acceptance criteria:** A new `tests/native/errorBoundary.test.tsx` renders the *root provider
  stack from `app/_layout.tsx`* around a component that throws, and asserts (a) the text of
  `errorFallback.title` is on screen, (b) a `Restart` and a `Continue` control are present, (c)
  `apiRequest` was called with `POST /api/client-errors`. A second case renders `ErrorFallback`
  with no `SafeAreaProvider` anywhere and asserts it still renders.
- **Fix risk:** Moving the boundary inward means a crash in `SettingsProvider`,
  `QueryClientProvider` or `SafeAreaProvider` itself is no longer caught — which is exactly why
  the `useContext` fallback in `ErrorFallback` must land in the same change.
- **Depends on:** None

---

### [RES-02] Stop writing the session cookie to the production log on every request

- **Severity:** High
- **Confidence:** High (read the code and the two libraries' serializers)
- **Effort:** S (<1h)
- **Location:** `server/testApp.ts:199-204`, `server/logger.ts:3-9`
- **Problem:** `pinoHttp({ logger, autoLogging: { ignore: req => req.url === "/health" } })` is
  installed with default serializers. `pino-http@11.0.0` (`node_modules/pino-http/logger.js:29-35`)
  falls back to `pino-std-serializers`' `req`/`res`, and those copy the **whole header bag**:
  `_req.headers = req.headers` (`node_modules/pino-std-serializers/lib/req.js`, `headers` is an
  enumerable field of the returned object) and `_res.headers = res.getHeaders()`
  (`node_modules/pino-std-serializers/lib/res.js:34-39`). `pino-http` binds the serialized request
  to the per-request child logger (`logger.js:145`), so every completed request line carries it.
  The production log level is `info` (`server/logger.ts:4`) and `pino-http`'s default level is
  `info`, so this is on in production, not just in dev.
- **Impact:** `connect.sid` — the signed express-session id — is written in cleartext for every
  authenticated request, and `set-cookie` (the freshly-minted session) is written for every
  `POST /api/auth/login` and `/api/auth/register` response. Anyone who can read the Replit
  deployment logs (workspace collaborators, anyone the log is pasted to, any future log shipper)
  can replay a cookie and act as that player: session cookies are 30-day httpOnly cookies, so the
  window is long.
- **Repro / proof:** Code path only — `server/testApp.ts:199` passes no `serializers` and no
  `redact`, so `pino-http`'s `opts.serializers[reqKey] = wrapRequestSerializer(serializers.req)`
  at `logger.js:30,33` takes effect, and `serializers.req` emits `headers` verbatim. No test
  covers log output.
- **Proposed fix:** In `server/testApp.ts`, pass an explicit serializer pair to `pinoHttp`:
  `serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url }), res: (res) => ({ statusCode: res.statusCode }) }`.
  Belt and braces, add `redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'], censor: '[redacted]' }`
  to the pino instance in `server/logger.ts` so any *other* code that logs a raw request object is
  covered too.
- **Acceptance criteria:** A test writes to a capturing stream, drives one authenticated request
  through `createApp()`, and asserts no emitted line's JSON contains the substring `connect.sid`
  or the word `cookie` as an object key. Add the same assertion for a `POST /api/auth/login`
  response line and `set-cookie`.
- **Fix risk:** Losing `user-agent`/`referer` from the log. If those are wanted, allowlist them
  explicitly rather than reverting to the default serializer.
- **Depends on:** None

---

### [RES-03] Stop turning a transient rejoin failure into a forfeited game

- **Severity:** High
- **Confidence:** High (read the code end to end)
- **Effort:** M (a few hours)
- **Location:** `server/socket.ts:1601-1748` (esp. `:1632` and the catch at `:1742-1745`),
  `server/socket.ts:2018-2023` (`emitRoomStateTo`), `context/OnlineGameContext.tsx:414-434`,
  `app/(online)/game.tsx:156-160`, `server/socket.ts:2153-2193` (`handleLeaveRoom`)
- **Problem:** Three things compose badly.
  1. `game:rejoin`'s own try/catch (`:1742`) converts *any* throw into
     `game:rejoin_failed { code: "SERVER_ERROR" }`. The memory path — the case where the game is
     alive in `activeGames` and the caller holds a seat — still awaits `emitRoomStateTo`
     (`:1632`), which does two unguarded DB reads (`storage.getRoomById`, `storage.getRoomPlayers`,
     `:2019-2021`). One dropped connection there and a player with a perfectly valid seat in a
     perfectly live game is told the rejoin failed.
  2. The client's `onRejoinFailed` (`context/OnlineGameContext.tsx:414-434`) reads only
     `data.roomCode`. The `reason` and `code` the server sends are discarded — all five failure
     reasons (`:1615`, `:1658`, `:1672`, `:1683`, `:1744`) render identically as nothing. It also
     calls `persistActiveRoom(null)` (`:423`), erasing the `@murlan_active_room` value that is the
     only handle a cold start has for rejoining.
  3. `app/(online)/game.tsx:156-160` then calls `leaveRoom()`, which emits `room:leave`. Mid-game
     that reaches `handleLeaveRoom` (`server/socket.ts:2188-2192`) and runs `vacateSeat`
     **immediately** — the player's seat is handed to a bot on the spot, not after the 60s grace.
- **Impact:** One transient database hiccup during a reconnect and the player is silently thrown
  out of a game they were winning, their seat is given to a bot, and their rejoin handle is
  deleted so they cannot get back in — `room:join` refuses a room whose status is not `waiting`
  (`server/socket.ts:1163`). If the table had exactly two humans, `vacateSeat`'s `remaining <= 1`
  branch (`:679-690`) closes the table for the other player too. They see a bounce to the lobby
  with no message at all.
- **Repro / proof:** Code path. Force `storage.getRoomPlayers` to reject once (or kill the DB for
  one second) while a client reconnects mid-game: `emitRoomStateTo` throws → `:1742` catch →
  `game:rejoin_failed SERVER_ERROR` → client clears `room`/`gameState`, wipes AsyncStorage, sets
  `rejoinFailed` → game screen calls `leaveRoom()` → server vacates the seat. `activeGames` still
  held the live game the whole time.
- **Proposed fix:** Three changes.
  (a) In `server/socket.ts`, do not let a cosmetic failure fail the rejoin: wrap the
      `emitRoomStateTo` call at `:1632` (and `:1727`) in its own `.catch(err => logger.warn(...))`,
      the way `upsertRoomPlayer` already is at `:1623-1627`.
  (b) Distinguish retryable from terminal on the client. Have `onRejoinFailed` branch on
      `data.code`: `SERVER_ERROR` should re-arm one delayed retry (2s, capped at 3 attempts) and
      leave `room`/`gameState`/the persisted room id untouched; only `GAME_NOT_FOUND`,
      `GAME_NO_LONGER_VALID` and `UNAUTHORIZED` tear state down.
  (c) On the terminal branch, show the reason. Add `server.REJOIN_*` keys to all three catalogues
      and render `translateServerPayload(data)` through `showNotification` before navigating, and
      do not emit `room:leave` — the player did not choose to leave, and the disconnect grace
      timer is the correct owner of that seat.
- **Acceptance criteria:** An integration test in `tests/integration/gameplay.test.ts` where a
  seated client reconnects while `getRoomPlayers` is stubbed to reject once asserts that the
  client ends up with a live `game:state` and still holds its seat in `playerMap`. A second test
  asserts a `SERVER_ERROR` rejoin_failed does not clear `@murlan_active_room`. A third asserts
  that after a terminal `GAME_NOT_FOUND` the client shows a localised notification and the server
  received no `room:leave`.
- **Fix risk:** Retrying rejoin must stay bounded — the handler's limiter is 20/60s
  (`:1747`), so 3 attempts is safe, but an unbounded retry would trip it and produce a
  `game:error` the rejoin path does not listen for (the hazard the comment at `:1606-1609`
  already names).
- **Depends on:** None

---

### [RES-04] Contain throws in the bot and AFK timer callbacks — today they freeze the table forever

- **Severity:** High
- **Confidence:** High (read the code; the freeze mechanism is confirmed, the triggering throw is
  the uncertain half — see Repro)
- **Effort:** M (a few hours)
- **Location:** `server/socket.ts:538-544` (bot timer), `:552-586` (`runBotTurn`), `:589-610`
  (`handleAutoPass`), `:615-631` (AFK timer), `server/socketSafety.ts:103-143` (`onEvent`) and
  `:150-157` (`installProcessGuards`)
- **Problem:** Every *inbound socket event* is wrapped by `onEvent`, whose stated contract is that
  "a throwing handler degrades to an error emitted to that one socket instead of an unhandled
  rejection that kills the process" (`server/socketSafety.ts:5-9`). The **timer-driven** half of
  the same mutation path has no such wrapper: the `setTimeout` callbacks at `:540-543` and
  `:617-630` call `runBotTurn` / `handleAutoPass` bare, and those call `autoMoveForSeat`,
  `processPlay`, `appendReplayMove`, `broadcastGameState` and `persistGameState` with nothing
  around them. A throw there escapes to `uncaughtException`, which `installProcessGuards` logs and
  swallows (`:154-156`).
  The freeze follows from `armTurn`: it calls `clearRoomTimers(roomId)` at `:531` *before*
  scheduling the next timer. Once the callback throws, no timer is pending for that room and
  nothing will ever re-arm one — `armTurn` is only called from a move, a rejoin, a disconnect or
  another timer. The room is permanently stuck on a turn that will never be taken.
- **Impact:** Every human still at that table sits in front of a board that never moves. No
  `game:error` is sent (nothing emitted it), no AFK notice, no timeout — the client's turn clock
  runs out and nothing happens, because the client's `turnTimer` has no `onExpire`
  (`app/(online)/game.tsx:233-238`, "the server auto-passes"). The only escape is Quit, which
  forfeits. `installProcessGuards` makes this *worse* than a crash would be: its justifying
  comment says the process "must not stop a server that is holding live games in memory for other
  players" (`server/socketSafety.ts:146-149`), but that premise is false — `game:rejoin`
  rehydrates a live game from `active_games` after a restart (`server/socket.ts:1654-1716`), so a
  crash-and-restart is recoverable and a frozen room is not.
- **Repro / proof:** Confirmed by reading: there is no `try` between the `setTimeout` at `:540`
  and `persistGameState` at `:579`, and `armTurn:531` clears the room's timers first. What I could
  not confirm from reading is a specific input that makes `autoMoveForSeat` throw — `server/socket.ts`
  has no unit test file (map §11) and `handleGameOver`/`runBotTurn` are reached only by the
  DB-gated integration suites. Treat the containment gap as the finding; it is the asymmetry with
  `onEvent` that is the defect, not a specific known throw.
- **Proposed fix:** In `server/socket.ts`, add a small `safeTimer(label, roomId, fn)` helper that
  wraps a timer body in `try/catch`, logs `{ err, roomId, label }`, and on catch emits
  `game:notification { type: "abandoned", code: "GAME_INTERRUPTED_SERVER_ERROR" }` to the room and
  calls `disposeGame(roomId)` — the same treatment `runBotTurn` already gives the
  "vacant seat could not act" case at `:565-574`, which is the right shape and should be reused.
  Use it for both `setTimeout` bodies (`:540`, `:617`) and for the sweeper's per-room work.
  Separately, in `server/socketSafety.ts:154-156`, make `uncaughtException` log at `fatal` and
  then `process.exit(1)` after a flush: Node's own guidance is that the process is in an undefined
  state, and the rehydration path above means a restart costs nothing but a reconnect.
- **Acceptance criteria:** A test that stubs `autoMoveForSeat` (via `__testables`,
  `server/socket.ts:212-235`) to throw, arms a bot turn, and asserts the room receives a
  `game:notification` with an interrupted code and that `activeGames` no longer holds the room —
  i.e. no room is left in memory with zero pending timers and `gameOver === false`. A second
  test asserts `installProcessGuards`' `uncaughtException` handler exits non-zero.
- **Fix risk:** Making `uncaughtException` exit means a bug that previously produced a log line
  now restarts the server. That is the intent, but it will surface latent throws as visible
  restarts; land the timer containment first so the common case never reaches the guard.
- **Depends on:** None

---

### [RES-05] Close socket.io on shutdown — every SIGTERM currently ends in a forced `exit(1)`

- **Severity:** Medium
- **Confidence:** High (read the code; confirmed `io.close()` appears nowhere in `server/` or `scripts/`)
- **Effort:** S (<1h)
- **Location:** `server/index.ts:29-43`, `server/socket.ts:1004-1017` (the `io` returned by
  `setupSocket`), `server/testApp.ts:235-239` (`createApp` returns `io` but `index.ts` discards it
  at `:20`)
- **Problem:** `shutdown()` calls `server.close(cb)` and nothing else. `server.close()` stops
  accepting new connections and fires its callback only once **all existing connections have
  ended**. Socket.io's websockets are long-lived upgraded connections that never end on their own,
  and `io.close()` / `io.disconnectSockets()` is never called anywhere in the repo. So with even
  one player connected the callback at `:31` never runs: `pool.end()` is never awaited, "Server
  shut down cleanly" is never logged, the 10s timer at `:36-39` fires and the process exits **1**.
- **Impact:** Replit Cloud Run SIGTERMs on every deploy. Every deploy therefore hangs for 10s and
  then reports a failed exit code. Anything in flight at that moment is lost silently, and the
  writes on the game-over path are deliberately un-awaited fire-and-forget:
  `recordGameResult` (`server/socket.ts:910`), `recordRatedResult` (`:920`), `saveReplay` (`:936`)
  and `persistGameState` (`:363-385`). A player who finishes a match in the deploy window loses
  their stats row, their ladder movement and their replay, and the last move of a live hand may
  never reach `active_games` — so the rejoin after the restart restores a stale board.
- **Repro / proof:** Code path. `grep -rn "io.close\|disconnectSockets\|closeAllConnections" server/ scripts/`
  returns nothing; `server/index.ts:20` destructures only `{ server }` from `createApp()`, so the
  `io` handle is not even in scope for the shutdown closure.
- **Proposed fix:** Destructure `io` at `server/index.ts:20` and make `shutdown` do, in order:
  `io.close()` (which disconnects every socket and closes the underlying engine), then
  `server.close()`, then `await pool.end()`, then `process.exit(0)`. Keep the 10s watchdog as a
  watchdog but `unref()` it so it cannot itself hold the process open. Guard `shutdown` against
  being entered twice (SIGTERM followed by SIGINT).
- **Acceptance criteria:** An integration test boots `createApp()`, connects a socket client,
  invokes the shutdown routine, and asserts the process-level promise resolves in well under 10s,
  that the client observed a `disconnect`, and that `pool.ended === true`. A second assertion: the
  exit code passed to the mocked `process.exit` is 0.
- **Fix risk:** Disconnecting sockets on SIGTERM makes every client reconnect at once when the new
  revision comes up; `lib/socket.ts:59-62` already backs off (1s → 5s) and mints a fresh ticket per
  attempt, so this is expected, but the ticket limiter (60/min, `server/routes.ts:67-73`) should be
  sanity-checked against the real concurrent-player count.
- **Depends on:** None

---

### [RES-06] Give the Postgres pool an error handler and timeouts

- **Severity:** Medium
- **Confidence:** High (read the code; consequence is the documented `pg` behaviour)
- **Effort:** S (<1h)
- **Location:** `server/db.ts:5-11`
- **Problem:** The pool is constructed with a connection string and an SSL flag and nothing else:
  no `pool.on("error", …)`, no `max`, no `connectionTimeoutMillis`, no `idleTimeoutMillis`, no
  `statement_timeout`/`query_timeout`. `pg`'s `Pool` is an `EventEmitter` that emits `error` when a
  backend or network error hits an **idle** client; with no listener, Node throws on the
  unhandled `error` event. The defaults that are left in place are `max: 10` and
  `connectionTimeoutMillis: 0` — nought meaning *wait forever* for a free client.
- **Impact:** Two distinct failures.
  (a) Replit's managed Postgres dropping an idle connection raises an uncaught exception. It does
      not kill the server only because `installProcessGuards` (`server/socketSafety.ts:154-156`)
      swallows it — the pool's health is silently load-bearing on the process guard.
  (b) With `connectionTimeoutMillis: 0` and no statement timeout, one slow or stuck query holds a
      client indefinitely; ten of them and every subsequent `pool.query` — every REST route, every
      `storage.*` call inside a socket handler, and `/health` itself
      (`server/testApp.ts:215-228`) — waits forever with no error. Express has no request timeout,
      so clients hang rather than getting a 5xx, and nothing in the logs says why.
- **Repro / proof:** Code path. `server/db.ts` is 11 lines; there is no `.on(` anywhere in it and
  no options object beyond `connectionString`/`ssl`.
- **Proposed fix:** In `server/db.ts`, add
  `pool.on("error", (err) => logger.error({ err }, "Idle Postgres client error"))`, and pass
  `max: 10, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000, statement_timeout: 15_000,
  query_timeout: 15_000` (tune `max` against Replit's connection cap). A `connectionTimeoutMillis`
  rejection surfaces as a 500 through the existing error handler
  (`server/testApp.ts:154-159`), which is a far better outcome than a hang.
- **Acceptance criteria:** `tests/serverLoadable.test.ts` already imports `server/db.ts`; extend a
  test to assert `pool.listenerCount("error") === 1` and that `pool.options.connectionTimeoutMillis`
  and `pool.options.statement_timeout` are both non-zero. Manual check: with the pool saturated,
  `GET /health` returns 503 within the timeout instead of never returning.
- **Fix risk:** A `statement_timeout` that is too tight would abort legitimate slow queries — the
  leaderboard join (`server/ratings.ts:127-141`) and the history prune
  (`server/stats.ts:119-135`) are the two worth timing before picking the number.
- **Depends on:** None

---

### [RES-07] Do not treat a network failure at boot as "logged out"

- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `context/AuthContext.tsx:26-42`, `lib/query-client.ts:22-46`
- **Problem:** The boot effect reads the cached user from AsyncStorage, then calls
  `apiRequest("GET", "/api/auth/me")`. `apiRequest` throws on *any* non-2xx
  (`lib/query-client.ts:22-27`) and on any network error, and the single `catch` at `:35-38` then
  does `setUser(null)` **and** `AsyncStorage.removeItem(STORAGE_KEY)`. A 502 during a Replit
  redeploy, a captive portal, or a dropped connection is indistinguishable from a genuine 401.
  The effect's dependency array is `[]`, so it never retries; and `lib/query-client.ts:76` sets
  `retry: false` globally, so nothing else re-checks either.
- **Impact:** A player who opens the app during a redeploy window — or in a tunnel — is logged out
  for the whole session: the title screen shows the signed-out state, every online destination
  routes to `/auth` (`app/index.tsx:335-337`), and there is no re-check when connectivity returns.
  They must fully restart the app, and if they do not remember their password, `/auth` is a wall.
  The session cookie was valid the entire time.
- **Repro / proof:** Code path. The codebase already knows this distinction matters and applies it
  exactly once, in the socket ticket path: `lib/socket.ts:23-24` — "Uses a raw fetch (not
  apiRequest) so a 401 can be told apart from a transient network failure instead of being
  swallowed identically" — and `:33-37` branches on `res.status === 401`. `AuthContext` does not.
- **Proposed fix:** In `context/AuthContext.tsx`, replace `apiRequest` with a raw `fetch` (as
  `lib/socket.ts:26-43` does) and clear the cached user **only** on `res.status === 401`. On any
  other failure keep the cached user, leave AsyncStorage alone, set `loading` false, and retry the
  check once connectivity returns — `@react-native-community/netinfo` is already a dependency and
  already used by `components/OfflineBanner.tsx:23`.
- **Acceptance criteria:** A `tests/native/authBoot.test.tsx` with three cases: (1) cached user +
  `fetch` rejecting → `user` is still the cached user and `murlan_user` is still in AsyncStorage;
  (2) cached user + 503 → same; (3) cached user + 401 → `user` is null and the key is removed.
- **Fix risk:** Keeping a cached user whose session has genuinely expired means the first online
  action fails instead of the app starting signed-out. That path is already handled —
  `lib/socket.ts:33-35` fires `authFailureHandler`, and `context/SocketContext.tsx:99-108` logs out
  and routes to `/auth`.
- **Depends on:** None

---

### [RES-08] Make a failed boot exit non-zero instead of being "contained"

- **Severity:** Medium
- **Confidence:** High for the code path; Medium for the Replit consequence (I cannot observe a deploy)
- **Effort:** S (<1h)
- **Location:** `server/testApp.ts:190` and `:211`, `server/index.ts:19-27`
- **Problem:** `createApp()` installs the process guards at `:190` and only *then* does the work
  that can fail at boot: `await ensureSchema(pool)` at `:211` (which deliberately rethrows so "the
  server refuses to start rather than serving requests against a schema it knows is wrong",
  `server/schemaDdl.ts:336-339`), then `registerRoutes`, then the dynamic
  `import("./socket.ts")`. The top-level IIFE in `server/index.ts:19-44` has no `.catch`. So a boot
  failure becomes an unhandled rejection, which the guard at `server/socketSafety.ts:151-153`
  logs as `"Unhandled promise rejection — contained"` — and `server.listen()` never runs. With no
  listening socket and no live pool clients, the event loop drains and Node **exits 0**.
- **Impact:** `ensureSchema`'s deliberate refuse-to-start is defeated: instead of a non-zero crash
  that names the schema problem, the operator gets one `error`-level line whose message claims the
  failure was contained (it was not — nothing started) and a zero exit status. A boot failure and a
  clean shutdown are indistinguishable by exit code, which is what supervision and deploy tooling
  reads first.
- **Repro / proof:** Code path. `installProcessGuards()` at `server/testApp.ts:190` precedes
  `await ensureSchema(pool)` at `:211`; `server/index.ts:19` is `(async () => { … })()` with no
  `.catch` and no `unhandledRejection`-aware wrapper of its own.
- **Proposed fix:** Two changes. Move `installProcessGuards()` in `server/testApp.ts` to after
  `setupErrorHandler(app)` (i.e. to the end of `createApp`), so nothing that runs during
  construction can be swallowed by it. And in `server/index.ts`, attach
  `.catch((err) => { logger.fatal({ err }, "Server failed to start"); process.exit(1); })` to the
  IIFE.
- **Acceptance criteria:** A test that calls `createApp()` with a `DATABASE_URL` pointing at a
  closed port asserts the returned promise **rejects** (rather than resolving or being swallowed),
  and that `process.listenerCount("unhandledRejection")` is 0 at that moment.
  `tests/integration/schemaBootstrap.test.ts` already covers the success case and the
  "an internal failure does not describe the database" case; extend it with the boot-failure exit
  path.
- **Fix risk:** Moving the guards later leaves a very short window during construction with no
  net. That window is exactly the one where a crash is the correct outcome.
- **Depends on:** None

---

### [RES-09] Do not navigate to the game screen before the spectate request is answered

- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `app/(online)/index.tsx:73-80`, `app/(online)/game.tsx:162`,
  `server/socket.ts:1095-1132`
- **Problem:** `handleSpectate` emits `room:spectate` and then calls
  `router.push("/(online)/game")` on the very next line, unconditionally — it never waits for the
  server. The server has four ways to refuse: room not found (`:1102`), no live game (`:1107`),
  the caller already holds a seat (`:1113`), and the `onEvent` rate limit of 10/60s (`:1131`,
  `server/socketSafety.ts:117-120`). All four reply `room:error` and send no `game:state`. The game
  screen's first statement after its hooks is `if (!gameState) return null`
  (`app/(online)/game.tsx:162`).
- **Impact:** Typing a room code that is wrong, finished, or already yours and tapping Watch lands
  the player on a completely blank screen — no text, no back button, no quit control, nothing.
  The `error` state *is* set by `onRoomError`, but the toast that would show it is rendered below
  the `return null`, so it is invisible; the auto-clear effect at `:114-118` then discards it after
  3s. The only way out is the OS back gesture / browser back. `isSpectator` also stays `true`
  (`context/OnlineGameContext.tsx:502`) for the rest of the session.
- **Repro / proof:** Code path, three lines: `app/(online)/index.tsx:76` emits, `:79` navigates,
  `app/(online)/game.tsx:162` renders nothing. `spectateRoom`
  (`context/OnlineGameContext.tsx:500-506`) sets no room and returns immediately.
- **Proposed fix:** Two parts. (a) In `app/(online)/index.tsx`, do not navigate in `handleSpectate`;
  add an effect that navigates when `isSpectator && gameState` becomes true, and surface `error`
  (already destructured at `:30`) if a `room:error` arrives first. (b) Independently, replace the
  bare `return null` at `app/(online)/game.tsx:162` with a minimal connecting state — the app's
  spinner plus a "Back" `MenuButton` that calls `leaveRoom()` and `goToLobby()` — so no future path
  can strand a player there either.
- **Acceptance criteria:** An e2e case in `tests/e2e/online.spec.ts`: open the online lobby, enter
  a code for a room that does not exist, tap Watch, and assert the lobby is still shown with a
  visible error, not a blank page. A native test renders `OnlineGameScreen` with a null
  `gameState` and asserts a back control is present and accessible.
- **Fix risk:** The connecting state must keep every hook above it running unconditionally — the
  file's own comment at `app/(online)/game.tsx:88` records that invariant.
- **Depends on:** None

---

### [RES-10] Log the outcome of a hand — today a disputed result cannot be reconstructed

- **Severity:** Medium
- **Confidence:** High (read every `logger.*` call in `server/socket.ts`)
- **Effort:** S (<1h)
- **Location:** `server/socket.ts:732-944` (`handleGameOver`), `:820-830` (`game:over` emit),
  `:1391-1465` (`game:play`)
- **Problem:** Asked concretely — "could you, from the logs alone, reconstruct why one specific
  room's game ended wrongly?" — the answer is no. `handleGameOver` computes `state.rankings`,
  `handByKey`, `game.cumulativeScores`, `matchTarget`, `matchWinners` and `isDraw`, broadcasts them
  all, and logs **none** of it: its only `logger` call is the bot-majority notice at `:903-906`. No
  move is logged either — `game:play` (`:1391-1465`) logs nothing at all, and neither does
  `handleAutoPass` or `runBotTurn`. The `match_replays` row is not a substitute: it is only written
  for tables with a human seat *and* a live `moveLog`, a hand restored after a restart has
  `moveLog: null` by construction (`:1710-1712`), and it stores no scores.
- **Impact:** A player report of "the scoreboard gave the match to the wrong seat" is
  uninvestigable. There is no line in the log tying a room to its rankings, its per-seat points,
  its cumulative totals or its declared winners — the fields the complaint is about.
- **Repro / proof:** `grep -n "logger\." server/socket.ts` — 55 call sites across `server/`, none
  of them in `handleGameOver`'s scoring block or in any play/pass path.
- **Proposed fix:** One `logger.info` at the end of `handleGameOver`, after `:830`, carrying
  `{ roomId, gameMode, matchLength, rankings: state.rankings, handByKey, cumulative: game.cumulativeScores, matchTarget: game.matchTarget, matchOver: game.matchOver, isDraw, matchWinners }`
  — all values already in scope, all of them non-personal (ids and integers, no hand contents).
  Optionally one `logger.debug` per accepted play at `:1452` with `{ roomId, seat, comboType, cardCount }`
  — counts and a type, never card identities, so enabling debug can never leak a hand.
- **Acceptance criteria:** Play one hand to completion in `tests/integration/gameplay.test.ts`
  against a capturing pino stream and assert exactly one line contains `rankings` and
  `matchWinners` for the room's id. A companion assertion that no logged line contains a card id
  or a `hand` array, at any level.
- **Fix risk:** Log volume, and the standing rule that a hand must never be logged. Keep the
  per-play line at `debug` and keep it to counts.
- **Depends on:** [RES-02] (do the redaction first, so a new structured log line lands on a
  logger that is already safe)

---

### [RES-11] Stop swallowing room-bookkeeping write failures with no log line

- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `server/socket.ts:1954-1956`, `:2202`, `:2182`, `:2218`, `:572`, `:673`, `:688`,
  `:841`, `:1909`
- **Problem:** Nine `.catch(() => {})` sites discard the error entirely — no log, no metric, no
  retry. Two of them mutate the seat table: `storage.removeRoomPlayer` in the disconnect-grace
  timer (`:1954-1956`) and in `handleLeaveRoom_lobby` (`:2202`). Four more silently drop a room
  status or host change (`:572`, `:673`, `:688`, `:841`, `:2182`, `:2218`).
- **Impact:** When `removeRoomPlayer` fails, the `room_players` row survives while the in-memory
  seat is vacated. `claimRoomSeat` counts rows, not live players
  (`server/storage.ts:278-290`: `if (seated.length >= room.maxPlayers) return { ok: false, reason: "full" }`),
  so the room reports itself full to the next joiner and `getRoomPlayers` puts a ghost player in
  every `room:state` payload. Nothing recovers it until `pruneStaleRooms` reaches it 24h later
  (`server/socket.ts:2085`, `STALE_ROOM_MAX_AGE_MS`). Because nothing is logged, the first evidence
  is a player saying a room they can see is "full".
- **Repro / proof:** Code path, plus `server/storage.ts:268-295` for the seat-count consequence.
  Compare with the sites that got this right: `:336-338`, `:383-385`, `:1625-1627` all log.
- **Proposed fix:** Replace every `.catch(() => {})` in `server/socket.ts` with
  `.catch((err) => logger.warn({ err, roomId, userId }, "<what did not happen>"))`. Keep them
  non-fatal — the fire-and-forget shape is right — but make them visible. `:1909`
  (`updateLastSeen`) is genuinely cosmetic and can stay silent if a `debug` line is unwanted.
- **Acceptance criteria:** `grep -n "catch(() => {})" server/socket.ts` returns at most the one
  `updateLastSeen` site, and each replaced site names in its message the write that failed.
- **Fix risk:** None beyond log volume.
- **Depends on:** None

---

## Coverage gaps

1. **No live database.** `DATABASE_URL` is unset here, so all 11 integration suites self-skip
   (map §1). I read `tests/integration/clientErrors.test.ts` and `tests/integration/schemaBootstrap.test.ts`
   but did not observe either run. Every DB-dependent claim above (RES-03, RES-06, RES-08) is
   from reading code and library sources, not from an observed failure.
2. **No production log sample.** RES-02 is derived from `pino-http@11.0.0` and
   `pino-std-serializers` source plus the call site. I did not boot the server and capture a real
   log line, because that needs a database.
3. **`autoMoveForSeat` throw not demonstrated.** RES-04's containment gap is proven; a concrete
   input that makes the engine throw inside a timer is not. Confirming it would need a fuzz over
   `processPlay`/`aiChoosePlay` states, which is A2's territory.
4. **Replit shutdown behaviour unobserved.** RES-05's exit-code claim follows from
   `server.close()`'s documented semantics and the absence of `io.close()`; I could not SIGTERM a
   real deploy.
5. **Playwright and the production build were not run** (forbidden by the read-only rule — both
   write to gitignored output). So the offline-resume path was assessed only via
   `tests/offlineSave.test.ts` and `tests/native/offlineResume.test.tsx`, both of which I read and
   both of which cover what they claim. I found no resilience defect in `lib/offlineSave.ts`.
6. **Not audited in depth:** `lib/sounds.ts` (checked — every load and playback path is
   try/caught, `:12-93`, `:168-194`; degrades silently and correctly), font loading
   (`app/_layout.tsx:55-76` — `fontError` is handled and does not block boot), and the react-query
   error states in `app/(online)/profile.tsx`, `leaderboard.tsx`, `replay.tsx`, all of which have
   explicit `isError` branches with retry controls. No findings there.

## Opinions (non-findings)

- `notifyUser`'s `fetch` (`server/push.ts:99-104`) has no `AbortSignal.timeout`. It is
  `void`-called and never throws, so a hang costs one pending promise and a socket handle — but it
  would also stop a fixed `io.close()`-based shutdown from being instant. A 5s abort signal is a
  one-line improvement, not a defect.
- `installProcessGuards()` is called from `createApp()`, which the test harness also calls
  (`tests/helpers/testServer.ts`), so the test process inherits handlers that swallow unhandled
  rejections. The handlers are idempotent-ish (Node warns past 10 listeners), and no test
  currently depends on an unhandled rejection failing the run. Worth knowing, not worth a finding.
- `context/SocketContext.tsx:126-135` runs its own exponential backoff *and* socket.io runs its
  own (`lib/socket.ts:59-62`). They overlap on transport errors. `Manager.open()` is a no-op while
  already opening, so the duplication is harmless today; it is the kind of thing that stops being
  harmless when someone changes one of the two.
- `components/OfflineBanner.tsx:26` — the `state.isConnected === false` invariant CLAUDE.md
  describes is present and correct, with the comment forbidding the `!state.isConnected` rewrite.
  Verified, no action.

## Open questions for the human

1. **Who reads the server logs, and where do they go?** RES-02's severity turns entirely on that.
   If the Replit deployment log is visible to more than one person, or is ever pasted into an
   issue, the session cookie leak is the most urgent item in this report.
2. **Should a server crash be allowed to happen?** RES-04 proposes making `uncaughtException`
   exit non-zero, on the grounds that `game:rejoin` rehydrates from `active_games`. That trades a
   silently frozen room for a visible ~10s restart affecting every connected player. It is a
   product call, not a technical one.
3. **Is `EXPO_PUBLIC_DOMAIN` set in the Replit deployment?** `lib/query-client.ts:8-20` throws when
   it is unset *and* `window` is undefined. That is fine for the web bundle served from the same
   origin, but a native build with it unset would fail every REST call at the first `getApiUrl()`.
   I could not determine its value from the repo.
