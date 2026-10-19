# 03-app-context — slice review (SRC 50144087)

Read in full: all 32 files of the slice (app/ and context/). Prior reports read in full: client.md, domain.md. Line numbers in client.md still match SRC almost exactly (the slice barely moved since d8c34919), so most of client.md's findings stand. They are confirmed in a list below, not repeated. The findings here are new, or they add evidence to a prior finding.

## Findings

### 03-app-context-F1 (P1, S) Home's "Resume" restores a stale snapshot from boot over the match being played
- files: context/GameContext.tsx:157-158, 180-196, 293-303, 306-323, 342-358; app/index.tsx:655, 733, 741-743; components/homeMenuModel.ts:46-56; app/lobby.tsx:193-197; app/game.tsx (no back interception; the only `BackHandler` on the table is components/table/settingsSheet.tsx:50-59, and only while the sheet is open)
- problem: three facts each have their own home, and nothing keeps them in step:
  - `hasSavedGame` is set once, by the read on mount (`:320`). Only `clearSavedGame` (reset) and the match-over render branch (`:337-340`) clear it.
  - `savedRef` is also set once on mount (`:319`). The persist effect (`:342-358`) writes newer rows to storage but never updates the ref.
  - `setupGame` and `resumeGame` touch neither of them.
  
  The offline stack is `index → lobby(push) → game(replace)` or `index → game(push)`, so an iOS swipe, Android back or browser back from the table returns to a mounted Home while `gameState` is still live. Concrete outcomes:
  - (a) Boot with save A. Resume, play several rounds, go back. Home's hero is still "Resume" (`homeMenu` promotes `savedGame`). Tapping it runs `resumeGame()`, which restores A from `savedRef`. Every round since boot is lost, and the next persist overwrites storage with A.
  - (b) Boot with save A. Start a new match from the lobby, go back. "Resume" replaces the new match with A.
  - (c) Boot with no save. Start a match, go back. Home offers no way back to the running match, although storage holds it.
  
  `tests/native/offlineResume.test.tsx:132-210` covers only resume across a remount, never within one session.
- proposed: one owner for "is there a table to go back to", read from the live state first:
  ```ts
  // GameContext
  const resumable = (gameState !== null && !match.over) || isResumable(savedRef.current);
  resumeGame(): boolean  // gameState live → true, no restore; else restore savedRef
  ```
  The persist effect sets `savedRef.current` to what it writes, so the ref and storage cannot diverge. `hasSavedGame` becomes `resumable`, a derived value rather than state with its own setters.
- effect: the flag state, its render-phase sync (`:336-340`) and the two set sites are removed. The bug class "Home offers a different table than the one in storage" is gone. Add one renderHook test: setup, play, then resume keeps `gameState` identity.
- overlap: new (client-F5 notes Home stays mounted under /game; that is what makes this reachable).
- confidence: high for the mechanism (read in code). Medium that every back path is live on every platform; at least Android back and web back are not intercepted.

### 03-app-context-F2 (P2, S) A join refused from the friends screen is silent
- files: app/(online)/friends.tsx:223-227 (`handleJoinGameInvite` → `joinRoom`); friends.tsx reads no `error` (no `useOnlineConnection`); context/OnlineGameContext.tsx:530-547 (a refusal only latches `error`); app/(online)/_layout.tsx:20-31 (no `initialRouteName`/`unstable_settings`, so a `/(online)/friends` reached from Home has no lobby beneath it to render the banner).
- problem: client-F10 noted that this path skips the `connected` gate and `pendingInvite` clearing. It also has no error surface. ROOM_FULL, GAME_ALREADY_STARTED and similar refusals land in a latched `error` that no mounted screen shows. The provider unmounts with the group on the way back to Home, so the error is lost. `deliver` only reports *undelivered*, not *refused*. The player taps Join and nothing happens.
- proposed: take client-F10's single entry point: `acceptInvite(code)` then `router.push("/(online)")`, exactly as `app/index.tsx:623-626` does. The lobby then owns the connected gate, the joining banner and the error banner.
- effect: `handleJoinGameInvite` and `hideGameInvite` leave the friends screen's surface. The bug class "an action whose answer has no surface" is closed for joins. `acceptInviteClearsPending.test.tsx` covers both callers.
- overlap: extends client-F10 (and client-F15: who owns `error`)
- confidence: medium-high (the route-stack composition is inferred from the layout having no initial route).

### 03-app-context-F3 (P2, S) The `error` latch is cleared by some intents and not others, and call sites compensate
- files: context/OnlineGameContext.tsx:913-925 (`createRoom`: no `setError(null)`), :984-989 (`quickmatch`: none), :927-936 and :938-946 (`joinRoom` and `spectateRoom` clear it, with a comment saying a standing error "hides this join's own answer"), :444-477 (`abandonRejoin` clears neither `error` nor `isSpectator`); app/(online)/quickmatch.tsx:154 and :161 (the screen clears it itself before `quickmatch`); app/(online)/index.tsx:115-118 (`handleCreate` does not, so a stale banner stays over the create's outcome).
- problem: the rule "a new attempt retires the last one's refusal", in the provider's own words, is applied to two of four entry intents. A third is patched at its call site. This is the same lists-disagree pattern as client-F1, applied to the latch rather than to teardown.
- proposed: one `beginAttempt(source: EntrySource | "spectate")` inside the provider, called by all four intents. It clears `error` and `rejoinFailed`, sets `isSpectator` and `entrySource`, and replaces the 3-line preamble each intent writes by hand. With client-F1's `endTable`, the reset vocabulary is two functions.
- effect: about 12 lines removed across the four intents. The two `clearError()` calls in quickmatch.tsx are removed. Stale-error-on-create is fixed.
- overlap: extends client-F1, client-F15
- confidence: high

### 03-app-context-F4 (P2, S) Changing account without passing through signed-out keeps A's cache and table handle
- files: context/SocketContext.tsx:147-151 (`qc.clear()` only on a truthy→falsy `userId` edge); context/AuthContext.tsx:195-200 (`logout` clears state and `ACCOUNT_KEYS` only after the POST resolves); SocketContext.tsx:278-287 (`onAuthFailure` routes to `/auth` with `.finally`, whether or not logout cleared anything); lib/storageKeys.ts:17 (`ACTIVE_ROOM_KEY` is an account key); OnlineGameContext.tsx:480-496 (the next provider reads it and rejoins).
- problem: when the logout POST fails, `user` A stays set and the app sits on `/auth`. Signing in as B is then an A→B change of `userId`, never A→null:
  - `qc.clear()` does not run, so B's friends, requests, invites and stats are A's until each refetches.
  - A's `@murlan_active_room` survives, so B's first `(online)` mount sends `game:rejoin` for A's room and shows B a rejoin-failed notice.
- proposed: `if (signedInRef.current !== userId) qc.clear()` (any change of account, not only sign-out). Split `AuthContext.logout` into server POST plus a local `forgetSession()` run in `finally`, as client-F26 proposes.
- effect: the cache and handles are partitioned by account rather than by the sign-out edge.
- overlap: extends client-F26 (adds the cache and handle consequences and the one-line guard fix)
- confidence: medium (needs a failed logout POST, or another path that sets a new user without nulling the old one)

### 03-app-context-F5 (P3, XS) Two AsyncStorage writes per online move
- files: context/OnlineGameContext.tsx:363-379 (`persistActiveRoom` and `persistWaitingRoom` always write), :610-617 (both called on every `game:state`)
- problem: every broadcast does `setItem(ACTIVE_ROOM_KEY, sameId)` and `removeItem(WAITING_ROOM_KEY)`, even when the in-memory refs already hold those values. That is redundant I/O on the hottest client path; on web each call is a synchronous localStorage write.
- proposed: compare against `persistedRoomIdRef.current` / `persistedWaitingCodeRef.current` first, and write only on change. This belongs inside client-F9's `tableHandles.setActive/setWaiting`.
- effect: 2 storage operations per move become 0.
- overlap: extends client-F9
- confidence: high

### 03-app-context-F6 (P3, S) The tutorial restates the opening rule and the engine's giveback check, under a comment that says it does not
- files: app/tutorial.tsx:375-377 (the comment says "Every legality check below goes through lib/game/gameEngine.ts"), :379-390 (`stageBeat` passes `startCard: undefined, firstPlayMade: true`), :412-420 (the must-include-3♠ check is hand-written), :437-452 (`getValidGivebackCards` and then `processExchangeChoice`, two checks of one rule); components/table/stagedPlay.ts:40-45, 54-61 (`readStagedPlay` already takes `startCard`/`firstPlayMade` and derives `requiresStartCard`).
- problem: the comment is false, and the opening obligation gets a sixth derivation (domain-F6 counted five). The exchange beat validates with one engine function and then confirms with another.
- proposed: `stageBeat` passes `startCard: beat.requireCard, firstPlayMade: !beat.requireCard`, and the refusal maps through `TUTORIAL_REFUSAL_KEYS` (add a key for the start-card refusal). `evaluateExchange` calls `processExchangeChoice` alone and reads refusal by identity, until domain-F7's `applyMove` lands.
- effect: about 15 lines removed. The tutorial cannot disagree with the table on the opening.
- overlap: extends domain-F6, client-F24
- confidence: high

### 03-app-context-F7 (P3, S) The rating summary is written twice, and provisionality is derived on both sides of the wire
- files: app/profile.tsx:599-614 and app/(online)/leaderboard.tsx:37-42, 57-68 (the same season/rounds strings and the same a11y group); app/(online)/game.tsx:208-218 (`provisionalLeft` recomputed from `rounds < PROVISIONAL_ROUNDS`); server/game/ratings.ts:197 (the server's own `provisional: rounds < PROVISIONAL_ROUNDS`, sent on `RatingDto` but not on `RatingAfter`).
- proposed: `lib/game/rating.ts: provisionalLeft(r: { rounds: number }): number | undefined` used by the server's flag and by all three screens, plus `components/RatingSummary.tsx({ rating: RatingDto })` used by profile and leaderboard.
- effect: about 30 duplicated lines removed. The provisional threshold is read through one function.
- overlap: new
- confidence: high

### 03-app-context-F8 (P3, S) Lobby pickers are copied across three screens, and two restate the teams rule with a literal 4
- files: app/(online)/room.tsx:142-177 (`MatchLengthControls`, "Mirrors the offline lobby's picker") = app/lobby.tsx:131-134, 246-262; player-count chips app/(online)/index.tsx:169-182 = app/lobby.tsx:212-224; teams-needs-four as a literal at app/(online)/index.tsx:184, 195-196 and app/lobby.tsx:170, 226, while app/(online)/room.tsx:383-384 and server/socket/socketTable.ts:133 use `TEAMS_PLAYER_COUNT`.
- proposed: `components/MatchLengthPicker({ value, onChange, seats })` and `SeatCountPicker`, plus `modeFits(mode, seats): boolean` exported next to `TEAMS_PLAYER_COUNT` in the engine, used by all three screens and the server.
- effect: 3 inventory duplicate blocks removed. A change to the teams seat count reaches every screen.
- overlap: new (inventory dup items room↔lobby, online index↔lobby)
- confidence: high

### 03-app-context-F9 (P3, XS) Dead code in the offline lobby and the room's invite panel
- files: app/lobby.tsx:67-79 (`PlayerRow` renders a name `TextInput` only when `lobbyMode === "local" && !isHuman`, but local mode makes every seat human at :149 and nothing changes a seat's type, so the branch is unreachable, along with its hint, a11y label and `nameInput` style); app/(online)/room.tsx:193, 198, 622, 666 (`InviteFriendsPanel`'s `myUserId` prop is passed and never read).
- proposed: delete both, or decide that pass-and-play seats get names and make the condition `lobbyMode === "local" && index > 0`.
- effect: dead UI and an a11y string out of the bundle.
- overlap: new
- confidence: high

### 03-app-context-F10 (P3, XS) The room's bots-countdown re-renders the whole screen every second for every viewer
- files: app/(online)/room.tsx:336-347 (an interval from mount for 30 s, unconditional), :390-391 and :486-490 (shown only when `hostIsWaiting`)
- problem: non-hosts, and rooms that are not waiting, re-render `RoomScreen` (seat list, invite panel, `FlatList`) 30 times for a hint they never see.
- proposed: move the countdown into a `BotsComingHint` child, mounted only when `hostIsWaiting`, which owns its interval. `botsOffered` comes up through `onDue`.
- effect: 30 whole-screen renders per room visit become 30 renders of one `Text`.
- overlap: new
- confidence: high

## Prior findings that are wrong or already fixed
- **client-F6 (partially addressed):** offline `chooseExchangeCard` now announces only after the engine accepts the give (`context/GameContext.tsx:233-234`, `if (next === gameState) return`), from commit 4475dd2e. The two derivations (at command time offline, a state diff online) remain.
- None of the client.md or domain.md findings that touch this slice were wrong. Each of the following was re-verified in SRC:
  - client-F1, F2, F3, F4, F5 (`useOnlineGame` has no production caller; 0 found), F7 (the "swallowed identically" justification at AuthContext.tsx:46-47 is still stale: `apiRequest` throws `ApiError` with `.status`, lib/query-client.ts:19-24), F8 (`SocketContext.connected` has no consumer: grep finds no `useSocket()` destructure of it), F9, F10, F13, F14, F15, F16, F17, F18 (E2E_FAST is read at app/game.tsx:31 and context/GameContext.tsx:51; EXPO_PUBLIC_DIAGNOSTICS is re-read at app/+native-intent.tsx:4 although lib/diagnostics/index.ts:9 exports it, while app/bench.tsx:5 and app/_layout.tsx:49 need the literal for require-elimination), F22, F23 (joinRoom still does not normalise; spectateRoom uppercases), F24, F25, F26.
  - domain-F1 and F16 (the giveback and stuck rule in app/game.tsx:132-159), domain-F2 (`applyRoundToMatch` is exported for tests/native/teamsSingleRound.test.tsx only; `INITIAL_MATCH.target = MATCH_TARGETS[0]` at OnlineGameContext.tsx:59-70), domain-F12 (WireGameState stored as GameState: OnlineGameContext.tsx:558 and 604).

## Inventory items checked
- Sizes and fan-in for app/index.tsx, OnlineGameContext, profile, tutorial, room, friends, (online)/index and SocketContext: real.
- Long functions (OnlineGameProvider 845, its listener effect 384, SocketProvider 409 and its effect 234, GameProvider 262): real; the structure is client-F13/F8/F3. The screen components (FriendsScreen, OnlineLobbyScreen, RoomScreen, TutorialScreen, OnlineGameScreen, ProfileScreen, HomeScreen, AuthScreen, QuickmatchScreen, GameScreen, LobbyScreen, ReplayScreen, RecoverScreen, VerifyEmailScreen, LeaderboardScreen, UserCard, InviteFriendsPanel, AuthProvider): real, but the length is JSX and styles rather than logic. `buildBeats` (178) and `renderBody` (181) in the tutorial are real; that is client-F24.
- Test-only exports: `useOnlineGame` is real (tests only). `RoomState`, `TurnDeadline` and `GameStateBroadcast` are real test imports. `RematchVoteState`, `OnlineMatchState` and `ReconnectNotice` are exported with no external importer (harmless type exports). `applyRoundToMatch` is real (teamsSingleRound; domain-F2). `NOTIFICATION_QUEUE_MAX` is a legitimate test seam (notificationQueue.test.tsx reads the cap rather than copying it).
- Dup onlineGameHooks.ts:34-84 = 76-119: real (pass-through shape, client-F5).
- Dup recover↔verify-email, recover↔recover, auth↔recover, auth↔verify-email blocks: real but JSX form fields of the five recovery screens, which CONTEXT.md (2026-09-10) rejects consolidating. Leave.
- Dup quickmatch.tsx:47-70 = 55-78: false positive (repeated literal mode-data entries).
- Dup room.tsx:76-96 = 117-137 (bot-fill row vs matchmaking row): real, minor; a `ToggleRow` would absorb it. Not filed.
- Dup room.tsx:611-626 = 655-670 and (online)/index.tsx:297-304 = 319-326 (landscape and portrait copies of one block): real, minor. room.tsx already hoists most blocks (`codeCard`, `seatList`); the players header and the status row could follow. Not filed.
- Dup room.tsx:779-797, 804-821, 766-782 = 838-851: style objects; noise.
- Dup room.tsx:524-533 = 535-544 (copy and share buttons): trivial.
- Dup room.tsx:162-175 = lobby.tsx:249-262 and (online)/index.tsx:169-179 = lobby.tsx:212-222: real, filed as F8.
- Dup (online)/index.tsx:387-398 = 402-413 (modal buttons): trivial.
- Dup leaderboard.tsx:6-15 = server/socket/socket.ts, replay.tsx:7-19 = server/app.ts, verify-email.tsx:4-14 = server/app.ts, (online)/index.tsx:22-30 = server/game/retention.ts: false positives (import lists).
- jest.mock targets AuthContext 36, SocketContext 20, NotificationContext 15, onlineGameHooks 14, GameContext 9, OnlineGameContext 3: real. These are the two mock seams client-F5/F8/F11 describe.
- Layer edge context→components (1): SocketContext.tsx:28 renders `SessionReplacedNotice` inside the provider. It is not in the violation rule set; a provider owning one overlay is acceptable. Noted only.

## Coverage
| file | lines | verdict |
|---|---|---|
| app/(online)/friends.tsx | 678 | F2; client-F7, F10, F16, F22 confirmed |
| app/(online)/game.tsx | 386 | F7; client-F2, F14 confirmed |
| app/(online)/history.tsx | 115 | clean (client-F22 QueryBlock applies) |
| app/(online)/index.tsx | 577 | F3, F8; client-F2, F5, F15, F23 confirmed |
| app/(online)/leaderboard.tsx | 196 | F7 |
| app/(online)/quickmatch.tsx | 490 | F3; client-F2 confirmed |
| app/(online)/replay.tsx | 231 | leave-alone: thin GameTable adapter, one index state, derived table |
| app/(online)/room.tsx | 860 | F8, F9, F10; client-F2, F8 (raw `friend:invite` emit, uncleared timer), F15 confirmed |
| app/(online)/_layout.tsx | 34 | clean (no initial route is relevant to F2) |
| app/+native-intent.tsx | 10 | clean (DIAGNOSTICS re-read noted under client-F18) |
| app/+not-found.tsx | 35 | clean |
| app/auth.tsx | 318 | leave-alone: account-recovery client block, CONTEXT.md rejection; #897 behaviour |
| app/bench.tsx | 7 | clean (the literal env read is needed for require-elimination) |
| app/capture.tsx | 170 | leave-alone: dev-only GameTable adapter, gated twice |
| app/game.tsx | 238 | F1 (no back interception); client-F3, F4, F18, domain-F1, F3, F16 confirmed |
| app/index.tsx | 1177 | F1; client-F5, F7, F9 confirmed |
| app/join/[code].tsx | 30 | clean |
| app/lobby.tsx | 400 | F1, F8, F9 |
| app/profile.tsx | 1070 | F7; client-F7, F22 confirmed; recovery cards left per CONTEXT.md |
| app/recover.tsx | 186 | leave-alone: CONTEXT.md recovery rejection |
| app/rules.tsx | 390 | clean |
| app/tutorial.tsx | 906 | F6; client-F24 confirmed |
| app/verify-email.tsx | 180 | leave-alone: CONTEXT.md recovery rejection |
| app/_layout.tsx | 171 | clean |
| context/AuthContext.tsx | 218 | F4; client-F7 (stale comment), F26 confirmed |
| context/GameContext.tsx | 410 | F1; client-F4, F6 (partly fixed), F18, domain-F2 confirmed |
| context/gameHooks.ts | 71 | client-F5 confirmed (four slices over one context) |
| context/NotificationContext.tsx | 112 | client-F17 confirmed; queue semantics leave-alone |
| context/OnlineGameContext.tsx | 1137 | F3, F4, F5; client-F1, F6, F9, F13, F14, F15, F23, F25, domain-F2, F12 confirmed; listener-effect stability re-checked (all deps stable, CONTEXT.md holds) |
| context/onlineGameHooks.ts | 190 | client-F5 confirmed (pass-through; deletion test fails) |
| context/SettingsContext.tsx | 220 | client-F21 confirmed; otherwise leave-alone (per-field validation; CONTEXT.md feedback setters) |
| context/SocketContext.tsx | 527 | F4; client-F8, F10, F16, F26 confirmed |
