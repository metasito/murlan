# A3 — Netcode, state sync & reconnection

Repo `C:\Users\roton\murlan` @ `b894af4`, branch `main`. Read-only pass.
Everything below was confirmed by reading source unless a finding says otherwise.
No integration or E2E suite was run (no `DATABASE_URL`, no Postgres) — see `Coverage gaps`.

---

## Findings

### [NET-01] Release the seat when a player leaves or drops at the results screen
- **Severity:** High
- **Confidence:** High (read the code)
- **Effort:** M
- **Location:** `server/socket.ts:2168-2193` (`handleLeaveRoom` has no `finished` branch), `server/socket.ts:1924-1927` (disconnect at game-over), `server/socket.ts:664-677` (`vacateSeat`'s game-over branch), `server/socket.ts:841` (status set to `finished`), `server/socket.ts:1539-1545` (the vote gate)
- **Problem:** Between manches nothing removes a departed player from `game.playerMap`, but the unanimous ready gate counts `Object.keys(game.playerMap).length`.
  `handleGameOver` sets the room to `finished` at `:841`. `handleLeaveRoom` only calls `vacateSeat` when `room.status === "in_progress"` (`:2188-2193`), and the disconnect handler routes a game-over disconnect to `handleLeaveRoom_lobby` (`:1924-1927`), which never touches `playerMap` and never arms a grace timer. `vacateSeat`'s own `if (game.gameState.gameOver)` branch (`:664-677`) — which exists precisely to drop the leaver out of the vote and re-broadcast `game:vote_state` with the new total — has **no reachable caller**: its only two call sites are `:1957` (armed only when `!gameOver`) and `:2192` (gated on `in_progress`).
- **Impact:** A player leaving or dropping at the end-of-manche results screen permanently blocks the next manche for everyone else. This is the ordinary end of every hand of every match, so it is the most common online flow in the app. Secondary: the `activeGames` entry and its `active_games` row survive until every remaining seat goes fully offline (the sweeper at `:2119-2125` requires `!anyoneConnected`), so each abandoned results screen leaks a live game in memory for as long as any seated user stays connected anywhere in the app.
- **Repro / proof:**
  1. Two accounts, `matchLength: "match"`, play manche 1 to `game:over`.
  2. Player B taps *Torna alla lobby* (`components/GameOverOverlay.tsx:274` → `app/(online)/game.tsx:196-199` → `leaveRoom()` → `context/OnlineGameContext.tsx:516` emits `room:leave`).
  3. Server `handleLeaveRoom` (`:2153`): the `room_players` row goes, `socketRoomMap` is cleared, but `room.status` is `finished` so neither branch runs — `game.playerMap` still holds B.
  4. Player A taps *Prossima mano* → `game:rematch_vote` (`:1523`). `rematchVotes = {A}`, `totalPlayers = 2`, so `:1545` returns. `game:vote_state` reports `1/2` and no further event ever arrives. A's overlay is stuck on the waiting label (`GameOverOverlay.tsx:314-316`) with only *Leave* as a way out.
  Same outcome for a plain network blip at the results screen: `:1924` sends it to `handleLeaveRoom_lobby`, and the reconnecting player cannot vote either — `attemptRejoin` (`context/OnlineGameContext.tsx:182`) requires `!currentGame.gameOver`, so no `game:rejoin` is emitted, `socketRoomMap` has no entry for the new socket id, and `game:rematch_vote` returns at `:1512`.
- **Proposed fix:** In `server/socket.ts`, call `vacateSeat` on the game-over path too. Concretely: (a) in `handleLeaveRoom`, replace the `else if (room.status === "in_progress")` with a check that runs `vacateSeat` whenever `activeGames.has(roomId)`, regardless of `rooms.status`; (b) in the disconnect handler, when `game.gameState.gameOver`, run `handleLeaveRoom_lobby` **and** `vacateSeat(io, currentRoomId, userId, username)` (no grace timer is needed — nobody is mid-turn). `vacateSeat`'s existing game-over branch already emits `game:player_left` + a corrected `game:vote_state` and disposes the room when the last seat empties, so no new event shape is required.
- **Acceptance criteria:** New integration test in `tests/integration/gameplay.test.ts`: three clients play a manche to `game:over`; one emits `room:leave`; the other two emit `game:rematch_vote` and both receive `game:started` + `game:match_state`. A second case: one client hard-disconnects at the results screen and the remaining two still reach the next manche. A third: the last remaining player leaving disposes the room (`activeGames` no longer holds it — assert via the abandoned-games prune or a follow-up `game:rejoin` answering `GAME_NOT_FOUND`).
- **Fix risk:** `vacateSeat` emits `game:player_left`, which the client turns into the blocking "Partita interrotta" alert (`context/OnlineGameContext.tsx:368`, `app/(online)/game.tsx:137-154`). Its game-over branch already emits that event unconditionally at `:667`, so wiring it up will now fire that alert on a leave between manches — check whether the remaining players should see the alert or only the updated vote tally, and adjust `:667` rather than the client if not.
- **Depends on:** None

---

### [NET-02] Rebuild the rematch roster from the game, not from `room_players`
- **Severity:** High
- **Confidence:** High (read the code)
- **Effort:** M
- **Location:** `server/socket.ts:1546-1596` — especially `:1546` (votes cleared before the bail-outs), `:1551` (`players.length < 2` → silent return), `:1554-1572` (roster rebuilt as all-human from `room_players`)
- **Problem:** The next manche is dealt from `storage.getRoomPlayers(roomId)` with every entry typed `"human"`. Bot seats do not exist in `room_players`, so they are dropped, and `fillWithBots`/`botPersonality`/`maxPlayers` are not consulted at all. Worse, the two bail-outs at `:1549` and `:1551` run *after* `game.rematchVotes.clear()` at `:1546`, so when they fire the table is left with cleared votes, no `game:vote_state` update, and no error.
- **Impact:**
  - **A single human plus bots can never play a second manche.** Host creates a 4-seat room, enables *Riempi con bot* (`app/(online)/room.tsx:35-106`), starts a `match`. Manche 1 ends with `matchOver: false`. The host votes: `totalPlayers = Object.keys(playerMap).length = 1`, so the gate at `:1545` passes, votes are cleared, `getRoomPlayers` returns one row, `:1551` returns. No `game:started`, no `game:state`, no `game:error`. The overlay sits on `1/1` forever. Practice-against-bots online is a one-hand mode in practice.
  - **A mixed table silently shrinks mid-match.** 2 humans + 2 bots: both vote, the gate passes, and `initializeRematch(playerSetup, …)` is handed **two** players. The next manche of the same match is dealt 27/27 instead of 14/14/13/13, `game.maxPlayers` still says 4, and `game.cumulativeScores` keeps orphaned `bot:2`/`bot:3` keys that `scoresByName` (`:980-986`) can no longer map to a seat.
  - The same shrink happens after any mid-manche seat vacancy, because the grace timer deletes the `room_players` row at `:1954-1956` before `vacateSeat`.
- **Repro / proof:** The rematch path is exercised only for a 2-human table today (`tests/integration/gameplay.test.ts:298-306`); the bot-fill test (`:423-459`) never reaches a rematch, which is why neither case is caught.
- **Proposed fix:** In the `game:rematch_vote` handler, build the next roster from the state that is already in memory rather than re-querying: reuse `game.gameState.players` for seat count, type and personality, and `game.playerMap` for the seat→user mapping, refreshing only the humans from `storage.getRoomPlayers` via `buildSeatRoster(humans, game.maxPlayers, { fillWithBots: <any seat is currently a bot>, botPersonality })` — the same helper `room:start` uses (`server/onlineGameLogic.ts:216-243`). Replace `if (players.length < 2) return;` with a check on total seats (`>= 2` including bots) and, when it genuinely cannot proceed, emit `game:error` and re-broadcast `game:vote_state` instead of returning silently. Move `rematchVotes.clear()` to after every bail-out.
- **Acceptance criteria:** Integration test: `room:start { fillWithBots: true }` in a 3-seat room with one human; drive the hand to `game:over`; emit `game:rematch_vote`; assert a `game:state` arrives with `players.length === 3` and exactly 2 `type: "ai"` seats, and that `game:match_state.scores` carries the running match total. Second test: 2 humans + 2 bots, after the rematch `players.length === 4`. Third: any bail-out path emits a `game:error` and leaves `game:vote_state` consistent.
- **Fix risk:** `initializeRematch(playerSetup, mode, prevRankings)` currently receives a `playerSetup` carrying explicit `id: "player_N"` fields (`:1555`) which the `room:start` path does not (`:1333-1341`); keeping the two roster builders in one helper must not change the engine ids `prevRankings` is matched against. Teams assignment is `idx % 2` in both places — preserve it.
- **Depends on:** None

---

### [NET-03] Add a room-level rejoin — a lobby reconnect strands the player
- **Severity:** High
- **Confidence:** High (read the code)
- **Effort:** M
- **Location:** `server/socket.ts:1924-1927` and `handleLeaveRoom_lobby` `:2196-2213`; `context/OnlineGameContext.tsx:179-192`; `app/(online)/room.tsx:330-344`; `server/socket.ts:1298-1299`, `:1271-1272`, `:1191`, `:1511-1512` (every room/game handler resolves the room from `socketRoomMap`, keyed by socket id)
- **Problem:** A disconnect with no live game removes the player from `room_players` immediately (`handleLeaveRoom_lobby` `:2202`) and migrates the host if needed. There is no counterpart on the way back: `attemptRejoin` only emits `game:rejoin` when there is a live, unfinished `gameState` (`:182`), and `room.tsx` has no reconnect handling at all. The reconnected socket therefore has no `socketRoomMap` entry, and every subsequent room event resolves to nothing and returns silently.
- **Impact:** A three-second wifi blip in the waiting lobby ejects the player server-side while their screen still shows the room, the code, and the roster. If they were host, the *Inizia* button emits `room:start`, `socketRoomMap.get(socket.id)` is `undefined` at `:1298`, and the handler returns with no error and no state — a dead button with no feedback. If they were a guest, the host starts without them and they wait on a room screen for a game they are not in. Re-emitting `room:join` with the code does not recover it either: once the host starts, `room.status !== "waiting"` rejects with `GAME_ALREADY_STARTED` (`:1163-1166`).
- **Repro / proof:** Two accounts in a waiting room. Kill B's network for 3 s and restore it. A's `room:state` (broadcast from `:2220`) no longer lists B; B's client emits nothing on reconnect (`OnlineGameContext.tsx:210-213` → `attemptRejoin` → both branches fail their guards) and continues to render the stale roster.
- **Proposed fix:** Two halves. Server: add a `room:rejoin { code }` inbound event (through `onEvent`, like every other) that re-claims the caller's seat via `storage.upsertRoomPlayer` when the room is still `waiting` and they were previously in it, re-runs `socket.join` + `socketRoomMap.set`, and replies with `room:state`; reject with the existing `room:error` codes otherwise. Client: persist the waiting-room id alongside the in-progress one (`persistActiveRoom` at `:170-177` deliberately stores only `in_progress` — add a separate key rather than reusing `ACTIVE_ROOM_KEY`, whose comment at `:220-225` documents why a waiting room must not produce a `game:rejoin`), and extend `attemptRejoin` to emit `room:rejoin` when `roomRef.current` exists but `gameStateRef.current` does not. Alternative with less new protocol: keep the `room_players` row through a short lobby grace instead of deleting it at `:2202`, and have the client re-emit `room:join`, which `claimRoomSeat` would then answer `already_joined` — but that path currently returns *before* `socket.join`/`socketRoomMap.set` (`:1168-1175`), so it would still have to be fixed to re-attach the socket.
- **Acceptance criteria:** Integration test: A creates a room, B joins, B's socket disconnects and reconnects, B recovers the room (`room:state` with both seats) without any manual re-entry of the code, and A's roster shows B throughout or is corrected within the grace. Second case: B was host — after reconnecting, `room:start` from B actually starts the game.
- **Fix risk:** Holding the `room_players` row through a lobby grace interacts with `claimRoomSeat`'s full/`already_joined` accounting (`server/storage.ts:268-286`) and with the quickmatch candidate query (`getWaitingRooms`), which counts seated players — a room could look full while a seat is really vacant. Prefer the explicit `room:rejoin` event over changing the seat-claim semantics.
- **Depends on:** None

---

### [NET-04] Stop `game:rejoin` from re-arming the whole room's turn timers
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `server/socket.ts:1649`, `:1740`, `:1869` (`armTurn` on every rejoin), `:526-550` (`armTurn` clears all room timers then arms a fresh AFK window), `:1747` (rate limit `20 / 60 s`)
- **Problem:** `armTurn` is unconditional on the rejoin path, and its first act is `clearRoomTimers(roomId)` (`:531`), which cancels the acting seat's pending AFK timer before `startAfkTimer` (`:612`) arms a brand-new full `AFK_TIMEOUT_MS`. `game:rejoin` is idempotent in every other respect, but not in this one.
- **Impact:** A seated player can hold a table open indefinitely on their own turn by emitting `game:rejoin { roomCode }` every ~20 seconds — comfortably inside the 20-per-minute limit and requiring no forged auth, since `game:rejoin` is a normal client emit. `handleAutoPass` never fires; the other players' clocks (client-side, `app/(online)/game.tsx:233-238`) run to zero and stop; the only escape is leaving the match. The benign version of the same bug: any player's reconnect silently extends the *current* player's deadline, so every other seat's displayed countdown is wrong from then on.
- **Repro / proof:** Read path — `game:rejoin` `:1611` finds the game in `activeGames`, `seatOfUser` succeeds, and control reaches `armTurn(roomCode)` at `:1649` with no check on whether the caller was actually disconnected or whether a timer is already pending for a different seat.
- **Proposed fix:** In the `game:rejoin` handler (both the in-memory and the rehydrated branch) and in the connect-handler reconnect block at `:1869`, only re-arm when the room has no timer for the acting seat — e.g. `if (!afkTimers.has(`${roomId}:${playerMap[actingSeat(game.gameState)]}`) && !botTimers.has(roomId)) armTurn(roomId);`. The rehydration branch (`:1740`) legitimately has no timers and must still call it. Additionally, make the rejoin cheap-repeat safe by returning early when the caller's socket is already the one in `userSocketMap` and already in `socketRoomMap` for this room.
- **Acceptance criteria:** Integration test with `MURLAN_AFK_TIMEOUT_MS` shortened: a seated client whose turn it is emits `game:rejoin` on a loop faster than the AFK window; the server still auto-passes that seat within roughly one AFK window. A second test: a rejoin by a *different* seat does not extend the current player's deadline.
- **Fix risk:** Over-tightening can leave a table with no armed timer after a genuine reconnect. The rehydrated-from-DB branch and the vacated-seat bot timer must both still get armed — cover both in the test.
- **Depends on:** None

---

### [NET-05] Reset `isSpectator` when the spectate attempt fails
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `context/OnlineGameContext.tsx:500-506` (set optimistically, never reset on error), `:508-517` (`leaveRoom` branches on it), `app/(online)/index.tsx:76`; server side `server/socket.ts:1100-1115` (three `room:error` rejections) and `:1138-1151` (`room:unspectate` no-ops without a `spectatorRoomMap` entry)
- **Problem:** `spectateRoom` sets `isSpectator` to `true` before the server has answered, and nothing ever sets it back to `false` except the spectator branch of `leaveRoom`. The three server rejections — `ROOM_NOT_FOUND` (`:1102`), `GAME_NOT_FOUND` (`:1107`), `ALREADY_IN_ROOM` (`:1113`) — arrive as `room:error`, which `onRoomError` (`:230-232`) turns into a toast without touching the flag.
- **Impact:** After one failed spectate (a mistyped code, or a room whose game has not started), the flag is latched for the life of the provider. The next room the player *joins and plays* is left occupied when they quit: `leaveRoom()` takes the spectator branch and emits `room:unspectate`, whose handler finds no `spectatorRoomMap` entry and returns. `room:leave` is never sent, so `socketRoomMap` still maps the socket to the room and the `room_players` row survives. Mid-game that means the player's seat keeps being dealt hands and auto-passed by the AFK timer while their own screen shows the lobby; in a waiting room it means a phantom seat nobody can free. It also makes the table render from seat 0 with `spectating` true (`app/(online)/game.tsx:208-209`) if they re-enter a game.
- **Repro / proof:** `app/(online)/index.tsx:76` calls `spectateRoom(code)` for any code the player types. Enter the code of a room that is still in the lobby → `activeGames.get(room.id)` is undefined → `room:error GAME_NOT_FOUND`. Then join a room normally and quit: the emitted event is `room:unspectate`, not `room:leave`.
- **Proposed fix:** In `context/OnlineGameContext.tsx`, set `isSpectator` from the server's answer rather than optimistically: leave it `false` in `spectateRoom` and set it `true` only when a `game:state` arrives whose `viewerSeatIndex` is `null` while no `room` is held, or (simpler and more explicit) add `setIsSpectator(false)` to `onRoomError` and to `joinRoom`/`createRoom`/`quickmatch`, which already reset the sibling rejoin flags at `:488-489`, `:495-496`, `:538-539`.
- **Acceptance criteria:** Unit/native test or an E2E step: after a failed `spectateRoom`, `leaveRoom()` emits `room:leave` (not `room:unspectate`). Server-side integration test: a client that spectates unsuccessfully, then joins a room and leaves, is gone from `getRoomPlayers`.
- **Fix risk:** A genuine spectator must still take the `room:unspectate` branch — do not simply delete the branch. Confirm against `tests/integration/spectator.test.ts`.
- **Depends on:** None

---

### [NET-06] One socket per user blackholes a second tab and then evicts the first
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** M
- **Location:** `server/socket.ts:131` (`userSocketMap: Map<userId, socketId>`), `:1054`, `:388-400` (`broadcastGameState`), `:195-201` (`emitToUser`), `:1904` and `:1919` (disconnect)
- **Problem:** `userSocketMap` holds exactly one socket id per account, and every server→client push resolves through it. The client singleton in `lib/socket.ts:4` is per-process, so two tabs (or an app plus a browser) are two connections for one user. The second overwrites the first at `:1054`, and the first is never told.
- **Impact:**
  - Tab 1 stops receiving `game:state`, `game:over` and every other broadcast while still displaying a live table with an enabled *Gioca* button. It has no way to notice: the socket is up, so the "Connessione persa" banner (`app/(online)/game.tsx:256-265`) never shows.
  - Closing tab 2 makes it worse. `:1904` deletes the mapping (it does point at tab 2), then `:1919`'s "still connected elsewhere" check reads `userSocketMap.has(userId)` → `false`, so the server announces `game:player_disconnected` for a player who is still connected, arms the 60 s grace, and hands the seat to a bot when it expires — while tab 1 sits there showing the pre-blackout table.
  - `isUserOnline` (`:203`) and the friends/push path (`friend:invite` `:1816-1826`) inherit the same single-socket assumption.
- **Repro / proof:** Read path only; no test covers a second connection for one account. `tests/helpers/client.ts` connects one socket per user.
- **Proposed fix:** Change `userSocketMap` to `Map<string, Set<string>>`. `broadcastGameState` and `emitToUser` iterate the set; the connect handler adds, the disconnect handler removes only its own id and treats the user as gone only when the set empties (which also makes the `:1919` guard correct by construction). `isUserOnline` becomes `set.size > 0`. Alternative if multi-tab is deliberately unsupported: on a second connection, emit a terminal `socket:error` to the older socket and disconnect it, so the first tab shows a clear state instead of a silent one.
- **Acceptance criteria:** Integration test: one registered user opens two sockets, joins a game on the first, and both receive `game:state` on the next move; closing the second produces no `game:player_disconnected` and no seat takeover; closing both does produce the grace.
- **Fix risk:** Room membership is per socket (`socket.join`), so `io.to(roomId)` broadcasts already reach every socket that joined; only the per-user `io.to(socketId)` sends change. Watch `emitFriendStatus`/`emitFriendStatusOffline` (`:2234-2272`), which use the map both to address friends and to decide online-ness.
- **Depends on:** None

---

### [NET-07] Tell the player why a rejoin failed instead of bouncing them to the lobby
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `context/OnlineGameContext.tsx:414-434` (discards both `reason` and `code`), `app/(online)/game.tsx:156-160`; server emitters `server/socket.ts:1615`, `:1658`, `:1672`, `:1683`, `:1744`
- **Problem:** The server distinguishes five rejoin failures and ships a stable `code` with each. `onRejoinFailed` reads neither — it clears the room and game state, sets `rejoinFailed`, and `app/(online)/game.tsx:156-160` navigates to the lobby. All five look identical to the player: the game vanishes with no message. `translateServerPayload` is already imported and used for every other server payload in this same file (`:231`, `:288`, `:294`, `:392`, `:406`).
- **Impact:** Player-visible outcome by reason, all identical today:

  | Server line | `code` | Real cause | What the player sees |
  |---|---|---|---|
  | `:1615` | `UNAUTHORIZED` | Seat already vacated — the 60 s grace expired and a bot took over | Silent bounce to lobby |
  | `:1658` | `GAME_NOT_FOUND` | Game finished, disposed, or its row pruned after a restart | Silent bounce to lobby |
  | `:1672` | `GAME_NO_LONGER_VALID` | `GAME_SCHEMA_VERSION` bumped by a deploy; the row is deleted at `:1671` | Silent bounce, manche scores gone |
  | `:1683` | `UNAUTHORIZED` | Rehydrated row does not name this user | Silent bounce to lobby |
  | `:1744` | `SERVER_ERROR` | A transient DB failure inside the handler | Silent bounce — indistinguishable from "your game is gone", and retrying would have worked |

  The last row is the sharp one: a recoverable error is presented as an unrecoverable one, and the client destroys its local room/game state and clears `ACTIVE_ROOM_KEY` (`:423`), so there is no way back in without the room code.
- **Repro / proof:** Read path. `onRejoinFailed`'s parameter type at `:414` is `{ reason?: string; roomCode?: string }` — `code` is not even destructured.
- **Proposed fix:** Type the payload as `ServerPayload & { roomCode?: string }`, render it with `translateServerPayload` and surface it through `showNotification` (or the existing `setError` toast) before tearing down. Add the five codes to `locales/it.ts` / `en.ts` / `sq.ts` (`tests/i18n.test.ts` pins parity). For `SERVER_ERROR` specifically, retry once after a short delay before treating the game as gone, since the server's own comment at `:1606-1609` establishes that this branch exists to avoid stranding the player.
- **Acceptance criteria:** Each of the five codes renders a distinct localised message in all three locales, and `SERVER_ERROR` does not clear `ACTIVE_ROOM_KEY` on the first occurrence. `tests/i18n.test.ts` still passes.
- **Fix risk:** None structural; keep the existing teardown for the four terminal codes so the lobby is still reachable.
- **Depends on:** NET-08 (same handler)

---

### [NET-08] The stale-rejoin guard is inverted — it switches itself off exactly when it is needed
- **Severity:** Medium
- **Confidence:** Medium
- **Effort:** S
- **Location:** `context/OnlineGameContext.tsx:414-421`, with `:219`, `:235`, `:488`, `:495`, `:538` all setting `pendingRejoinRoomIdRef.current = null`
- **Problem:**
  ```ts
  if (pendingRejoinRoomIdRef.current !== null && data.roomCode !== pendingRejoinRoomIdRef.current) {
    return;
  }
  ```
  The comment above it (`:415-418`) states the intent: "Only act on a reply for the attempt we're actually still waiting on — otherwise this wipes the room/game state that replaced it." But the guard only engages while `pendingRejoinRoomIdRef.current` is non-null, and every path that means *we are no longer waiting on a rejoin* sets it to **null** — `onRoomState` (`:219`), `onGameState` (`:235`), and the three deliberate resets in `createRoom` (`:488`), `joinRoom` (`:495`) and `quickmatch` (`:538`). So the one case the guard exists for — a late failure landing after the player has moved to another room — falls straight through and runs the full teardown.
- **Impact:** A late `game:rejoin_failed` for an old room clears `room`, `gameState`, `mySeatIndex` and `ACTIVE_ROOM_KEY` for the room the player is currently in, and latches `rejoinFailed`, which `app/(online)/game.tsx:156-160` turns into `leaveRoom()` + navigate-to-lobby. The player is ejected from a room they just created.
- **Repro / proof:** Cold start with a stale `ACTIVE_ROOM_KEY` pointing at a disposed room R1 (produced by force-quitting mid-game and letting the table finish server-side). The storage effect (`:195-207`) emits `game:rejoin { R1 }`. Before the reply lands the player taps *Crea stanza*: `createRoom` nulls the ref at `:488`; `room:state` for R2 arrives and nulls it again at `:219`. The `game:rejoin_failed { roomCode: R1 }` reply then passes the guard and tears R2 down.
- **Proposed fix:** Compare against the room the reply is *for*, unconditionally. Keep the requested room id in a ref that is cleared only by a matching reply (or by a matching `room:state`/`game:state` for that same room id), and make the first line `if (data.roomCode && data.roomCode !== requestedRoomIdRef.current) return;`. Do not clear the ref in `createRoom`/`joinRoom`/`quickmatch` — clearing it there is what disables the check; clear `rejoinFailed` there instead, which is the separate thing those call sites actually need.
- **Acceptance criteria:** A native or unit test that drives the handler directly: with a rejoin outstanding for R1, delivering `game:rejoin_failed { roomCode: "R1" }` after a `room:state` for R2 leaves `room` set to R2 and `rejoinFailed` false. Delivering it while R1 is still the outstanding attempt still tears down.
- **Fix risk:** Over-strict matching could swallow a genuine failure whose `roomCode` the server echoes differently — the server does echo the requested `roomCode` verbatim at all five sites, so this is safe today; add an assertion in the test rather than relying on that.
- **Depends on:** None

---

### [NET-09] Restore `matchOver` with the teams resolver for a teams match
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `server/socket.ts:1690-1707` (rehydration), against `server/socket.ts:778-782` (`handleGameOver` picks `resolveTeamMatch` for teams), `lib/gameEngine.ts:1209-1225`
- **Problem:** The rehydration branch computes `restoredResolution = resolveMatch(restoredScores, restoredTarget)` unconditionally, two lines before it reads `row.gameMode` to set `game.gameMode` (`:1700`). In teams mode `cumulativeScores` is keyed per seat/user, and the match is decided on the **pair total** (`docs/RULES.md` §11, implemented by `resolveTeamMatch`). A pair on 11 + 11 against a target of 21 has won, but no individual key reaches 21, so `resolveMatch` returns `null` and the game is restored with `matchOver: false`.
- **Impact:** After a server restart during a teams match that has just been decided, the first player to rejoin rehydrates the game with `matchOver` wrong. `rollMatchForward` (`:947-954`) then declines to reset `cumulativeScores` and `matchTarget`, and the `game:rematch_vote` gate at `:1535` (which refuses to restart a match the table voted down) is skipped. The table plays on inside a match that was already won, and the winners are announced a second time when the next hand ends.
- **Repro / proof:** Read path. Confirmable by unit-testing the restore branch: a `scores` map of `{a: 11, b: 11, c: 5, d: 4}` with `matchTarget: 21` and `gameMode: "teams"` yields `matchOver: false` from `resolveMatch` and `true` from `resolveTeamMatch` with a `teamOfKey` derived from `restoredState.players[].team` and `playerMap`.
- **Proposed fix:** Build the game object first, then compute `matchOver` with the same branch `handleGameOver` uses: `game.gameMode === "teams" && Object.keys(teamOfKey).length > 0 ? resolveTeamMatch(scores, teamKeyMap(game, state), target) : resolveMatch(scores, target)`. `teamKeyMap` (`:719-730`) already exists and takes exactly the `(game, state)` pair available at that point.
- **Acceptance criteria:** A test over the restore path (extract the `matchOver` computation into `server/onlineGameLogic.ts` so `tests/onlineGameLogic.test.ts` can reach it, as that file's header prescribes): a teams envelope whose pair total has crossed the target restores with `matchOver: true`; a free-for-all envelope is unchanged.
- **Fix risk:** `teamKeyMap` omits vacated (`bot:`) seats deliberately (`:713-718`); a restored game where a partner's seat is vacant will produce a smaller team total than the live game did. Assert that case explicitly rather than assuming parity.
- **Depends on:** None

---

### [NET-10] Delete `game:match_over` and `room:player_left`, or give them listeners
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `server/socket.ts:832-839` (`game:match_over`), `server/socket.ts:2224` (`room:player_left`); client listener sets `context/OnlineGameContext.tsx:436-453` and `context/SocketContext.tsx:224-233`
- **Problem:** Both events are emitted and nothing in `app/`, `components/`, `context/` or `lib/` listens for either. This is dead server work in both cases, not missing client behaviour:
  - `game:match_over` carries `{ target, isDraw, winners, continues }`. Every one of those fields is already on `game:over` as `matchTarget`, `isDraw`, `matchWinners`, `matchContinues` (`:820-830`), and `onGameOver` (`context/OnlineGameContext.tsx:320-345`) reads all four into `matchState`, which `GameOverOverlay` renders (`app/(online)/game.tsx:328-335`). Nothing is lost by its absence — the player sees the correct end-of-match screen today.
  - `room:player_left` is emitted immediately after the `room:state` that already removed the player from the roster (`:2220-2224`), so the roster is correct without it. Note it is emitted only by `handleLeaveRoom_lobby` and not by `handleLeaveRoom`, which is a second sign it is vestigial.
- **Impact:** Two wire events broadcast to every socket in the room that no client reads, and two entries in the protocol surface that a future reader will assume are load-bearing. `game:match_over` in particular reads as the match-end signal, which invites someone to wire the client to it and end up with two sources of truth for `matchState`.
- **Repro / proof:** Grep for both names across `app/ components/ context/ lib/` returns only the server emitters and the repo map. Confirmed in this pass.
- **Proposed fix:** Delete both emits. If a match-end signal is genuinely wanted as a separate event later, it should replace the corresponding fields on `game:over` rather than duplicate them.
- **Acceptance criteria:** `tests/socketEvents.test.ts` gains an outbound-event check (it currently only pins the inbound set) asserting every event name the server emits appears in a client `socket.on` in `context/`, with an explicit allow-list for anything deliberately fire-and-forget. Neither name is emitted any more.
- **Fix risk:** None — no consumer exists. Verify no external/native client depends on them (there is none in this repo).
- **Depends on:** None

---

### [NET-11] Send the turn deadline with the state instead of hardcoding 30 on the client
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** M
- **Location:** `app/(online)/game.tsx:33-35` (`SERVER_TURN_SECONDS = 30`), `:233-238`; `server/socket.ts:153` (`AFK_TIMEOUT_MS`, overridable via `MURLAN_AFK_TIMEOUT_MS`), `:526-550`; `components/GameTable.tsx:267-311`, `:888-893`
- **Problem:** The countdown the online table shows is a client constant that duplicates a server constant which is explicitly env-overridable, and it restarts on `turnToken` (a state-derived key) rather than on the server actually arming the timer. The clock is display-only — `onExpire` is deliberately omitted at `:236-237`, so this does not decide anything — but it is wrong in two ordinary situations.
- **Impact:** (a) Setting `MURLAN_AFK_TIMEOUT_MS` makes every client's clock lie; the E2E harness already sets the sibling `MURLAN_DISCONNECT_GRACE_MS` (`tests/e2e/playwright.config.ts:49`), so this is a live pattern. (b) `armTurn` re-arms the acting seat's AFK window without any broadcast on every rejoin (`:1649`, `:1740`, `:1869`) and on every disconnect (`:1943`), so every other seat's clock runs to zero while the server still has a full window left. A table where the visible clock hits 0 and nothing happens reads as frozen, which is exactly the failure mode the reconnect banner was added to avoid.
- **Repro / proof:** Read path. `TurnTimer` (`components/GameTable.tsx:283-300`) starts from `seconds` on every `resetKey`/`active` change and has no notion of a server deadline.
- **Proposed fix:** Have `armTurn` record an absolute `turnDeadlineMs = Date.now() + AFK_TIMEOUT_MS` on the `OnlineGameState` and include it in `sanitizeStateForPlayer` (`:240-267`); re-broadcast the state (or a small `game:turn_deadline` event) whenever `armTurn` re-arms without a state change. Client: pass `seconds: Math.ceil((deadline - Date.now()) / 1000)` into `turnTimer` and key the reset on the deadline value. Delete `SERVER_TURN_SECONDS`.
- **Acceptance criteria:** The displayed countdown tracks the server's remaining window within a second after a rejoin, and shortening `MURLAN_AFK_TIMEOUT_MS` shortens the displayed clock with no client change. `tests/motion.test.ts` and `tests/gameTableModel.test.ts` still pass.
- **Fix risk:** Clock skew between client and server makes an absolute timestamp risky on some devices; sending a remaining-milliseconds value with each state avoids that at the cost of being stale by one round-trip. Either is better than the constant. Do not add an `onExpire` — the server must stay the only thing that auto-passes.
- **Depends on:** NET-04 (the same re-arm is the underlying cause of the drift)

---

## Scenario walkthroughs

Each traced against source; "what actually happens", not what should.

**Refresh mid-turn (cold start).** New socket → `OnlineGameProvider` mounts (`app/(online)/_layout.tsx:21`) → the effect at `context/OnlineGameContext.tsx:195-207` reads `ACTIVE_ROOM_KEY` and, because `socket.connected` may already be true, calls `attemptRejoin` itself; `onConnect` (`:210-213`) covers the other ordering. Either way `game:rejoin { roomCode: <room uuid> }` is emitted (`:190`). Server `:1611` finds the game in `activeGames`, `upsertRoomPlayer` (idempotent, `server/storage.ts:244-262`), `room:state`, `game:state`, `game:player_reconnected`, `armTurn`. The client's `onRoomState` → `room` non-null → `app/(online)/room.tsx:330-334` redirects to the game screen once `gameState` lands. **Works.** Two cosmetic side effects: the connect handler's own reconnect block (`:1854-1876`) does the same work again if a grace timer was pending, so the room receives `game:player_reconnected` twice and `armTurn` runs twice; and the AFK window is reset (NET-04).

**Network drop mid-trick, back inside the 60 s grace.** Disconnect handler `:1892`: `userSocketMap` blanked, `friend:status` offline, `game:player_disconnected` with the grace seconds derived from the constant (`:1929-1939`), then `armTurn(currentRoomId)` (`:1943`) so the table keeps moving — note this arms the *AFK* timer for the disconnected seat, and 30 s < 60 s, so the absent player is auto-passed once or twice before the grace even expires. On return, `game:rejoin` restores the seat. **Works.**

**Back after the grace.** `:1948-1969` fires: `removeRoomPlayer` + `vacateSeat` → `game:seat_bot_takeover`, seat marked `ai`, removed from `playerMap`. The returning client's `game:rejoin` finds the game but `seatOfUser` is `null` → `game:rejoin_failed UNAUTHORIZED` (`:1615`) → silent bounce to lobby (NET-07). If it was a heads-up table, `remaining <= 1` disposed it instead and the reason is `GAME_NOT_FOUND`.

**Two tabs, same account.** See NET-06. The client singleton at `lib/socket.ts:4` is per-process and does not span tabs; the server keeps one socket id per user and the first tab goes dark.

**Host leaves during the lobby.** `handleLeaveRoom` `:2171-2187`: row removed, and if the leaver was host the lowest remaining seat is promoted (`updateRoomHost`) and `room:state` re-broadcast. **Works.** Same for a lobby disconnect via `handleLeaveRoom_lobby` (`:2214-2219`).

**Host leaves during a live game.** `room.status === "in_progress"` → `vacateSeat` (`:2192`) → bot takeover, or table closed when `remaining <= 1`. Host identity is not re-assigned in this branch, but nothing in a running game reads `hostUserId` (only `room:set_game_mode` `:1274` and `room:start` `:1303`, both lobby-only), so no live game is affected. **Works.**

**All players leave.** Live game: each vacancy decrements `remaining`; at `<= 1` the room is disposed and its row deleted (`:679-691`). At the results screen: nothing is released (NET-01), and the entry survives until every seated user is fully offline, at which point the sweeper's `!anyoneConnected && gameOver` branch (`:2119-2125`) disposes it — within 5 minutes.

**Server restart with live rooms.** `activeGames` is empty; `active_games` rows survive. There **is** a rehydration path, but it is pull-only: `game:rejoin` `:1654` reads the row, checks `isStaleSchema`, unpacks the envelope and re-registers the game (`:1693-1716`). Since every client reconnects automatically and `attemptRejoin` fires on `connect`, a live game does come back for anyone whose provider still holds a room or a persisted room id. What does not come back: `moveLog` is set to `null` (`:1712`), so the interrupted hand produces no replay; `spectators` is empty by design; a room in the *waiting* lobby has no `active_games` row at all and is unrecoverable (NET-03). Rows nobody rejoins are pruned at 24 h by `pruneAbandonedGames` (`:2062`).

**Slow client — a move arriving as `handleAutoPass` fires.** Not a race. Node runs the timer callback and the socket packet as separate macrotasks, and both `handleAutoPass` (`:589-610`) and the `game:play` handler (`:1395-1464`) are synchronous from their guard through the `game.gameState = next` assignment, so no interleaving is possible. Whichever runs first advances the turn; the loser fails its own seat check (`:595` or `:1415`) and returns. The `game:play` loser returns **silently** — no `game:error` — so the client's `pendingPlayRef` (`app/(online)/game.tsx:84`, `:98-112`) is never cleared and the selection stays; that is the intended "a rejection must not cost the player their selection" behaviour, so it is correct, just unexplained.

**Duplicate event delivery.** All idempotent by state, verified individually: `game:play` — the cards are gone from the hand, so `cards.length !== unique.length` at `:1421` returns; `game:pass` — the turn has moved, `:1489` returns; `game:exchange_give_card` — `exchangePhase.active` is false, `:1781` returns; `game:rejoin` — re-runs the same joins and emits (safe, but see NET-04); `game:rematch_vote` — `rematchVotes` is a `Set` of userIds and the caller must hold a seat (`:1532`), so **no, one client cannot vote twice and satisfy the gate for a seat that never answered**; `room:join` — `claimRoomSeat` answers `already_joined` (`server/storage.ts:283-284`) and the handler returns *before* `socket.join`/`socketRoomMap.set` (`:1168-1175`), which is why a re-join cannot repair a lost socket→room mapping (NET-03).

**Disconnect while it is your turn during the exchange.** `armTurn` (`:534`) resolves the acting seat through `actingSeat`, which returns `exchangePhase.winnerIdx` when the phase is active (`:405-409`), so the AFK timer is armed for the exchange winner. At 30 s `handleAutoPass` → `autoMoveForSeat` with `useAi: false` takes the `exchangePhase.active` branch (`:461-468`) and gives back `getValidGivebackCards(...)[0]`, or closes a genuinely unsatisfiable phase via `resolveStuckExchange` (`:425-431`). The table never sits behind the exchange overlay. **Works.**

**Deploy that bumps `GAME_SCHEMA_VERSION`.** `isStaleSchema` (`server/onlineGameLogic.ts:159-163`) → `disposeGame(roomCode)` deletes the row (`:1671`) → `GAME_NO_LONGER_VALID`. Every live game is destroyed at the first rejoin after the deploy and every player is bounced with no message (NET-07). That is the deliberate choice (the alternative is restoring a corrupt hand) but it is currently invisible to the player.

**Timer authority.** All three outcome-affecting timers are server-side and none has a client counterpart that can act: AFK (`:153`, `:612`) auto-passes; the disconnect grace (`:154`, `:1948`) vacates; bot pacing (`:158`, `:538`) drives vacant seats. The client's only clock is display-only (`app/(online)/game.tsx:236-237` omits `onExpire` on purpose) — see NET-11 for its accuracy, not its authority.

**Timer lifecycle.** `afkTimers` are keyed `${roomId}:${userId}` and every arm is preceded by a clear (`startAfkTimer:613`, `armTurn:531`); `botTimers` are one-per-room and cleared the same way; `disconnectTimers` are keyed by userId only and cleared on reconnect (`:1855-1857`), on re-arm (`:1945-1946`), in `clearAllTimersForUser` (`handleLeaveRoom:2163`), in `clearRoomDisconnectTimers` (`handleGameOver:741`, `disposeGame:329`), and by their own callback (`:1951`). I found no path that arms without clearing or leaves two of the same kind pending. The one keying weakness is `disconnectTimers`' userId-only key: a user seated in two different rooms from two tabs can only ever have one grace timer, but that requires the two-tab case (NET-06) to be fixed first for it to matter.

**Persistence.** `persistGameState` (`:344-386`) is fire-and-forget (`:1458` and eight other call sites) and only logs on failure. The concrete consequence is narrow, because the envelope is a *whole* snapshot rather than a delta: a failed write cannot leave the row internally inconsistent, and the next successful write corrects it. What can be lost is the **last** write before a process death — a rejoining player is then restored one or more moves behind, with already-played cards back in hands. The sharper case is `handleGameOver`'s write at `:844`: if that one fails and the process dies, the restored row holds the pre-game-over state and the pre-manche scoreboard, so the manche is replayed and can be scored twice. Not filed as a finding on its own — awaiting the write would trade this for a stall on every move, and the correct fix (a write-generation guard, or awaiting only the game-over write) is a design call rather than a defect on a line.

---

## Coverage gaps

1. **No integration or E2E run.** `DATABASE_URL` is unset and no Postgres is reachable, so all 11 integration suites self-skip and Playwright needs a built bundle plus a browser download (and would write into `tests/e2e/test-results/`, which the read-only rule forbids). Every finding above is from reading source. NET-01, NET-02, NET-03, NET-04 and NET-06 all describe behaviour a live socket run would confirm or refute in minutes; **they should be reproduced against a real server before implementation**, and each carries an acceptance test that does exactly that.
2. **`tests/helpers/gameDriver.ts` was not read** (context budget). `tests/helpers/testServer.ts` and `tests/integration/gameplay.test.ts` were, and the latter drives hands with its own inline driver rather than the helper, so the coverage statements above are based on the test bodies I read, not on the helper's capabilities.
3. **`tests/integration/abandonedGames.test.ts`, `testServerCleanup.test.ts`, `tests/persistedEnvelope.test.ts` and `tests/onlineGameLogic.test.ts` were not read in full.** The map's summaries (§11) were taken at face value for what they cover; where a finding claims something is untested (NET-01, NET-02), that claim rests on `game:rematch_vote` appearing in `tests/integration/gameplay.test.ts:300-301` only for a 2-human table, which I did read.
4. **No load or concurrency probe.** The out-of-order-upsert question for `persistGameState` (two `onConflictDoUpdate` calls for one row completing out of order under pool contention) is left open — the writes are normally >1 s apart, so I could not construct a concrete failure path and did not file one.
5. **`app/(online)/room.tsx` was read partially** (lines 1-260 plus a targeted scan of its effects and navigation). NET-03's claim that it has no reconnect handling rests on that scan, which covered every `useEffect` and every `router.*` call in the file.
6. **Client-side behaviour under React Compiler** was not evaluated. `CLAUDE.md` flags that `babel-plugin-react-compiler` (a dated beta) can miscompile `useEffect` references; several findings here concern effect ordering in `OnlineGameContext.tsx` and would behave differently if that happened.

## Opinions (non-findings)

- `context/OnlineGameContext.tsx:465` uses `socket.off("game:started")` with no handler argument, which removes *every* listener for that event on the shared singleton socket rather than only this provider's. There is exactly one listener today (an empty function at `:443`), so nothing breaks; it is still the odd one out among seventeen sibling calls that all pass their handler.
- `requestPlayAgain` (`context/OnlineGameContext.tsx:555-557`) is exported from the context and referenced by no screen. It emits `room:start` with no payload, which for a bot-filled table would fail the min-players guard at `:1311` and for a mixed table would drop the bots — the same defect as NET-02, reached by a second route. Deleting it removes the second route; C1 owns dead exports.
- `active_games.roomCode` (`shared/schema.ts:71-88`) actually stores the room **uuid**, not the six-character code: every writer passes `roomId` (`server/socket.ts:344`, `:2097`) and `game:rejoin`'s `roomCode` parameter is the uuid too (`context/OnlineGameContext.tsx:184`). Internally consistent, so not a defect, but the name reliably misleads on first read of the rejoin path.
- `handleLeaveRoom` and `handleLeaveRoom_lobby` (`:2153`, `:2196`) share about thirty lines of host-migration and empty-room handling that have already drifted apart in one respect (only the lobby variant emits `room:player_left`). Folding them would have prevented NET-01's missing branch, which is a difference of *omission* between two near-identical functions.

## Open questions for the human

1. **Is a single human plus bots meant to be a full online match, or a one-manche demo?** NET-02's fix assumes the former (that is what the room screen's *Riempi con bot* + *Partita a 21* combination promises). If the intent is the latter, the fix is instead to hide the match-length picker when bot-fill is on, and to make the rematch bail-out say so.
2. **When a player leaves between manches, should the remaining players keep playing against a bot in that seat, or should the table end?** NET-01's proposed fix reuses `vacateSeat`, which keeps the table alive with a bot and only ends it at one remaining human — matching the mid-game rule. The alternative (a match is over when anyone leaves it) is a smaller change but a different product decision, and it affects whether the departed player's accumulated match points stay on the scoreboard.
3. **Is more than one simultaneous session per account supported?** NET-06's fix differs materially: a socket set per user (multi-session supported) versus explicitly evicting the older connection (single-session enforced). The friends/online-status and push paths both assume single-session today.
4. **How long should a player have to reconnect in the *waiting* lobby?** NET-03 needs a number. There is a 60 s grace for a live game and effectively zero for a lobby; a lobby grace also decides whether a seat stays reserved (and therefore whether the room reads as full to quickmatch).
