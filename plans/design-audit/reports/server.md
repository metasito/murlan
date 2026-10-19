# Murlan server: module design audit

Auditor report, 2026-10-16, commit `d8c34919`.

**Scope:** `server/**`, the protocol half of `shared/`, plus `tests/server` (72 files) and `tests/integration` (68 files, every one booting `testServer`). This was a read-only audit: nothing was edited or committed.

Every claim was checked in source. Line numbers are real file lines.

**Overall verdict:**
- **Deep and worth keeping:** the routing, ownership, idempotency, envelope and ledger core.
- **Shallow:** the edges.
  - The game layer's output port is the whole Socket.IO server.
  - `active_games` persistence has no module of its own.
  - A refusal is "said" twice, and the two can disagree.
  - Two god modules mix 8–10 responsibilities each.
  - Time and dealing randomness are only partly injected.

---

## P1

### F1. The game layer's output port is the raw Socket.IO server
**Files:**
- `io: SocketServer` is threaded through 44 parameters: `tableHandlers.ts` (17), `gameTurn.ts` (9), `tableRouter.ts` (8), `gamePersistence.ts` (5), `roundOver.ts` (4), `dealRound.ts` (1).
- `server/game/*` has 20 `io.to(...)` sites. It also uses:
  - `io.to().timeout().emit` with an ack (`gamePersistence.ts:197-211`)
  - `io.fetchSockets()` (`gamePersistence.ts:331`)
  - `io.serverSideEmit` (`tableRouter.ts:157`, `seating.ts:49`)

**What's wrong:**
- The interface the game logic needs is small: "send to room", "send to user", "send state with one retry on a missing ack", and "who is online". The interface it actually takes is all of Socket.IO.
- Tests have to recreate it by hand. Twelve `tests/server` files each write their own `stubIo` cast with `as unknown as SocketServer`, for example `tableStalls.test.ts:42-54`, `endMatchVote`, `seatReclaim`, `voidAbandonedMatch`, `weakSeatTakeover`, `commitMove`, `exchangeRearm`, `openingGrace`, `roundOver`, `shutdownSeatLost`, `vacateSeatPersonality`.
- Each stub has to fake `.to().timeout().emit`, `.sockets.adapter.rooms` and `serverSideEmit`. That is leakage of transport internals into tests that are about table rules.
- Game flows can't be tested without a socket, so integration tests cover rules. Examples:
  - `rematch.test.ts:202` "room:start cannot deal the next round of a running match"
  - `rematch.test.ts:235` "a new match after the last one needs the table"
  - `gameplay.test.ts:169` "play and pass are rejected during an active exchange"

**Proposed interface:**
```ts
// server/game/tableOutbox.ts
export interface TableOutbox {
  toRoom<E extends keyof ServerToClientEvents>(roomId: string, e: E, ...a: Parameters<ServerToClientEvents[E]>): void;
  toUser<E extends keyof ServerToClientEvents>(userId: string, e: E, ...a: Parameters<ServerToClientEvents[E]>): void;
  /** game:state with one re-derived retry on a missing ack (today's sendGameStateTo body). */
  sendState(userId: string, render: () => WireGameState | null): void;
}
export interface Presence { isOnline(u: string): Promise<boolean>; isAtTable(u: string, r: string): Promise<boolean>;
  tablePresence(r: string): Promise<{online:Set<string>;atTable:Set<string>}|null>; onlineUserIds(): Promise<Set<string>>; }
export interface TableDeps { out: TableOutbox; presence: Presence; games: ActiveGameStore /*F2*/; clock: Clock /*F9*/; }
```
- There would be one Socket.IO adapter built in `setupSocket`, plus a recording adapter in `tests/helpers`.
- The router (`tableRouter.ts`) keeps `io` for `serverSideEmit`, because it really is transport.

**Dependency category:** remote-owned (Socket.IO / the adapter), handled as a port plus two adapters.

**Effect if done:**
- About 44 `io` params collapse into one `deps`.
- 12 hand-rolled stubs become one recording outbox.
- Tests assert on `out.sent` instead of on Socket.IO shape.
- A class of rule tests could move from `tests/integration` (real Postgres plus a socket client) to `tests/server`. The `rematch.test.ts` and `teamsOnline.test.ts` rule cases above are examples.
- Outbound-event checks become type-checked at one seam. Today `gameError`/`roomError` (`tableHandlers.ts:111-116`) must name events as literals so the `socketEvents.test.ts` scan can see them.

**Effort:** M–L, mechanical but wide. **Risk:** medium, because ordering of emits relative to persistence must be kept. **Priority:** P1.

### F2. `active_games` persistence has no owning module, so tests mock drizzle internals
**Files:**
- Read on takeover: `tableHandlers.ts:140-142` (`db.query.activeGames.findFirst`).
- Full scan for orphan resume: `tableHandlers.ts:814-816`.
- Ordered write: `gamePersistence.ts:128-170` (`persistence.writeActiveGame` plus `inRoomOrder`).
- Delete on dispose: `gamePersistence.ts:116-123`.
- Pruning: `gamePersistence.ts:269-279` (`pruneAbandonedGames`) and `292-313` (`pruneStaleRooms`, which also deletes `rooms` and `room_players`).
- Account deletion: `deleteAccount.ts:38-44` deletes hosted rooms' `active_games`, `room_players` and `rooms` inside its transaction.

**What's wrong:**
- One table's lifecycle (write order, delete order, "room_players has no cascade so it goes first") is spread over three modules and raw drizzle.
- Tests reach past every interface to substitute it:
  - `t.mock.method(db.query.activeGames, "findFirst", …)` appears 6× in `tableStalls.test.ts` (94, 113, 279, 291, 303, 321), plus `endMatchVote.test.ts:269` and `persistedEnvelope.test.ts:147`.
  - `t.mock.method(db, "delete", …)` appears at `persistedEnvelope.test.ts:148`.
  - `t.mock.method(persistence, "writeActiveGame", …)` appears in `commitMove` (3), `exchangeRearm` (2), `weakSeatTakeover` (2) and `endMatchVote`.
- A drizzle upgrade or a query rewrite breaks table-rule tests.

**Proposed interface:**
```ts
// server/store/activeGameStore.ts
export interface ActiveGameStore {
  read(roomId: string): Promise<{ roomId: string; gameState: unknown } | undefined>;
  write(roomId: string, env: PersistedEnvelope<GameState>): Promise<void>; // per-room ordering (inRoomOrder) lives inside
  remove(roomId: string): Promise<void>;                                   // ordered after pending writes
  listLive(): Promise<{ roomId: string; gameState: unknown }[]>;           // resumeOrphanedTables
  pruneOlderThan(cutoff: Date): Promise<number>;
}
```
- `pruneStaleRooms` and `deleteUser`'s room purge should share one `roomStore.purgeRooms(tx, ids)` that encodes the delete order once.

**Dependency category:** local-substitutable. An in-memory `Map` adapter serves unit tests; the real one is Postgres. Two adapters makes this a real seam.

**Effect if done:**
- Deletes about 15 `mock.method(db…|persistence…)` calls.
- `rehydrateGame` and `resumeOrphanedTables` stop importing `db` and `shared/schema` (`tableHandlers.ts:42-43,49`).
- The ordering invariant ("a slow earlier snapshot can land last") stays inside the module that owns it.
- The 3-step delete order is written once instead of twice.

**Effort:** S–M. **Risk:** low; the ordering logic moves as-is. **Priority:** P1.

### F3. A refusal is emitted and returned separately; 8 lobby refusals ack `{ok:true}` and skip the refusal log
**Files:**
- `onEvent` defaults a void return to `{ok:true}` and logs only *returned* refusals (`socketSafety.ts:226-229`).
- Paths that `emit("room:error")` then `return;` (void):
  - `lobbyIntents.ts:58` (teams size, create)
  - `lobbyIntents.ts:72-74, 76-78, 81-83` (join: not found / started / claim refused)
  - `socketRooms.ts:111-114, 117-120, 123-126` (`room:rejoin`)
  - `socketRooms.ts:188` (`room:quickmatch` teams size)
- Emit-plus-return pairs that restate the code by hand:
  - `tableHandlers.ts:209-210, 222-224, 264-265, 272-274, 296-297, 409-410, 531-532, 544-545`
  - `socketRooms.ts:163-174`
- Identity maps exist only to feed a source scan:
  - `routes.ts:262-268` (`FRIEND_REQUEST_REFUSAL_CODE`)
  - `socketPresence.ts:36-40` (`INVITE_REFUSAL_CODE`), both "spelled out because `refusalCodesTested.test.ts` reads … only as a literal"
- `IntentReply.code` is `string` (`shared/protocol.ts:95-98`), and so is `ServerPayload.code` (`:43-49`).
- `REJOIN_FAILURE: Record<string,…>` (`socketGameplay.ts:51-58`) silently falls back for any unknown string.

**What's wrong:**
- The interface has two channels, the ack and the `*:error` emit, and nothing forces them to agree. The bug class the `socketSafety.ts:150-157` comment warns about is live: `room:join` → ROOM_FULL answers the ack `ok:true`, and nothing reaches the "Socket event refused" log line.
- Refusal codes are typed only by an AST source scan. That forces literal identity maps that add nothing.

**Proposed interface:**
```ts
// shared/protocol.ts
export type RefusalCode = ServerCode | "NOT_AT_A_TABLE" | "NO_LIVE_GAME" | "TABLE_UNREACHABLE" | /*…closed set…*/;
export type IntentReply = { ok: true; code?: string } | { ok: false; code: RefusalCode };
// server/socket/refusal.ts
export interface Refusal { ok: false; code: RefusalCode; params?: TranslationParams; channel: "room"|"game"|"friend"|"socket" }
export const refuse = (channel: Refusal["channel"], code: RefusalCode, params?: TranslationParams): Refusal => …;
// onEvent: if outcome is a Refusal, it emits `${channel}:error` with payload(code, params) itself, then acks.
// Handlers never call socket.emit("*:error") directly.
```
- On the owner side, `tableHandlers` returns a `Refusal`. The dispatcher sends it with `out.toUser(userId, \`${channel}:error\`, …)` (F1).

**Dependency category:** in-process.

**Effect if done:**
- The 8 silent-success refusals become impossible to write.
- About 20 emit/return pairs become one `return refuse(...)` each.
- The identity maps and `REJOIN_FAILURE`'s `Record<string>` go away. With `RefusalCode` a union, `tests/tooling/refusalCodesTested.test.ts` could check against the type instead of literals.
- Client/server code drift becomes a compile error.

**Effort:** M. **Risk:** low–medium; the client reads `*:error` payloads unchanged. **Priority:** P1.

### F4. `tableHandlers.ts` (839 lines) is a god module
**Distinct responsibilities:**
| Lines | Responsibility |
|---|---|
| 1-38 | 38-line comment narrating a 6-file call chain (itself a symptom of low locality) |
| 111-116 | refusal emit helpers |
| 135-183 | `rehydrateGame`: raw DB read, envelope restore, roster gate, cluster presence, grace re-arming |
| 185-301 | move validation: play/pass/exchange, engine-refusal→wire mapping, analytics, commit |
| 303-462 | rematch and end-match voting, and dealing the next round |
| 464-506 | rejoin/reclaim |
| 509-644 | `startMatch`: lobby→table transition (room row, lobby graces, roster, invites, spectating, `room:state`, deal) |
| 646-739 | seat loss and disconnect grace (`seatLostAction`, `armSeatGrace`) |
| 741-805 | dispatcher, with 5 kinds inlined (`reaction` 757-766, `spectate` 773-784, `unspectate`, `resume`, `vacate`) |
| 807-826 | sweeper job `resumeOrphanedTables` (raw drizzle) |
| 833-837 | wiring |

**Duplication inside it:**
- **Next-round construction exists twice.** `dealVotedRound` (`tableHandlers.ts:366-384`) and `newTable`/`carriedFinishingOrder` (`tableState.ts:68-91, 103-113, 136`) both:
  - build `playerSetup`,
  - choose `initializeRematch` vs `initializeGame` by "did every seat finish" (`tableHandlers.ts:381` vs `tableState.ts:74`),
  - call `dealFirstSeatFor`.

  The team rule differs: one copies `p.team`, the other calls `teamForSeat`.
- **The ready gate has two different arithmetics.** `votesUnanimous` (`309-311`, `votes.size >= voterCount`) vs `startMatchAction` (`541-543`, `seatedIds.every(has)`), despite the comment at `303-307` saying a second vote must reuse the first.
- Guards are repeated: `seatOfUser(...) === null → NOT_SEATED` at 405, 432, 670 and 759; `roundOver → NO_LIVE_GAME` at 203, 261 and 774.

**Proposed split and deepening:**
```ts
// server/game/tableMoves.ts — pure, no io/db
export function decideMove(game: OnlineGameState, a: PlayAction|PassAction|ExchangeAction):
  | Refusal
  | { next: GameState; move: CommittedMove | null; firstPlay: boolean };
// server/game/tableVotes.ts
export function castRematch(game, userId): Refusal | { gateClosed: boolean };
export function readyGate(game, votes: Set<string>): boolean;  // the one arithmetic
// server/game/tableState.ts (extend)
export function nextRound(game: OnlineGameState, room: TableRoom): GameState; // replaces dealVotedRound 362-384 and newTable's choice
// server/game/tableLifecycle.ts: startMatch, rehydrate, resumeOrphans (via F2 store)
// server/game/seatPresence.ts: seatLost, armSeatGrace, rejoin
// tableHandlers.ts: only the dispatcher (≈80 lines) applying decisions through TableDeps
```

**Dependency category:** in-process (pure deciders) plus the F1/F2 ports.

**Effect if done:**
- Move legality, vote gates and round construction become unit-testable as pure functions, with no stub io and no db mock.
- The two-arithmetic bug class for vote gates disappears.
- One next-round builder means a team or first-seat change lands once.
- The 38-line narration comment can shrink to a pointer.

**Effort:** M. **Risk:** medium, because ordering in `startMatch` is documented as load-bearing (612-636). **Priority:** P1.

### F5. A game rule lives outside the engine: `concedeRound`
**Files:**
- `gameTurn.ts:287-304` assigns `finishPosition` and pushes `finishingOrder` itself (lines 292-293), sorting by hand length, then by seat.
- The engine does the same kind of placement in `lib/game/gameEngine.ts:671-672, 757-758`.

**What's wrong:**
- CLAUDE.md says game rules live in `lib/game/gameEngine.ts` and change only via GAME-RULES § Decisions.
- This placement rule ("closest to finishing first, seat order tiebreak") mutates engine state in place, outside the engine. The offline table has no counterpart.

**Proposed interface:**
```ts
// lib/game/gameEngine.ts
export function concedeRound(state: GameState, winnerSeat: number | undefined): GameState; // pure, returns roundOver state
```
- `vacateSeat` would call it, then `commitMove`-style publish (F10).

**Dependency category:** in-process.

**Effect if done:**
- Restores the invariant.
- The rule gets an engine unit test next to the other placement code.
- Removes one of the in-place mutations of `GameState` on the server.

**Effort:** S. **Risk:** low. **Priority:** P1, as an invariant breach.

---

## P2

### F6. `routes.ts` (1041 lines) is a god module, with repeated auth and session plumbing
**Responsibilities by line range:**
| Lines | Responsibility |
|---|---|
| 54-77 | param and friendship result helpers |
| 79-310 | 12 limiter definitions |
| 312-408 | `sessionUser`, mail bodies and senders, `requireAdmin`, `requireAuth`, `rollbackRegistration` |
| 412-745 | auth and recovery (12 routes) |
| 747-812 | account (rename, tutorial, delete) |
| 814-893 | friends |
| 897-914 | stats and own rating |
| 916-932 | admin |
| 934-942 | leaderboards (split from ratings by the admin block) |
| 944-962 | replays |
| 964-1032 | crash and bug reports |
| 1034-1037 | achievements (split from stats) |
| 1039-1040 | **creates the `http.Server`**, a responsibility `app.ts` should own |

**Duplication:**
- `req.session.userId!` appears 26 times.
- `res.status(...).json({ ...payload(...) })` appears 35 times.
- `userStore.getUser(userId)` then "missing → 401" appears 5 times: 551-554, 566-570, 598-602, 663-667, and `requireAdmin` 375. It is **inconsistent**: `/me` answers `401 USER_NOT_FOUND` (553), the others `401 NOT_AUTHENTICATED`. `/me` also re-implements `requireAuth` inline (547-550).
- The session regenerate, revoke-prior-sid and save sequence is duplicated in register (452-482) and login (502-522).
- `bcrypt.hash(…, 10)` appears 3 times (436, 578, 727).

**Proposed interface** (keeps every route's await-vs-fire-and-forget timing, which CONTEXT.md and ADR-0007 call deliberate):
```ts
// server/http/routeTable.ts
type Access = "public" | "signedIn" | "admin";
interface RouteSpec<B, R> { method; path; access: Access; limiters?: RequestHandler[]; body?: z.ZodType<B>;
  handle(ctx: { req; res; userId: Access extends "public" ? string|undefined : string; user?: User; body: B }): Promise<void>; }
export function mount(app: Express, routes: RouteSpec<any, any>[]): void;
// server/http/accountSession.ts
export function signIn(req: Request, userId: string): Promise<void>;  // regenerate + revoke prior sid + save; rejects on failure
export const hashPassword = (p: string) => bcrypt.hash(p, 10);
```
- Split into `routes/{auth,account,friends,ladder,replays,reports,admin}.ts`.
- Do **not** merge the recovery state machine into one module. CONTEXT.md records that this was reviewed and rejected; the helpers above change no reply timing.

**Dependency category:** in-process.

**Effect if done:**
- Removes 26 non-null assertions.
- Removes the `/me` inconsistency.
- Register and login shrink by about 25 lines each.
- Each area file stays under about 250 lines.
- `registerRoutes` no longer constructs the server.

**Effort:** M. **Risk:** low–medium, because limiter ordering per route must be kept exactly (e.g. `validate` before `renameLimiter`, 760). **Priority:** P2.

### F7. The auth guarantee rests on an AST scan of one file
**Files:**
- `tests/helpers/routeMountings.ts` reads only `server/http/routes.ts` and matches only `app.<verb>("literal", …)`.
- `tests/server/routesAuthenticated.test.ts` asserts against that scan.
- `/health` (`app.ts:268`) and `registerAppLinks` (`app.ts:167`) are mounted elsewhere and are not scanned.

**What's wrong:**
- This is a safeguard that exempts what it does not look at.
- The F6 split, or any router-based mounting, would move routes outside the scanned file and pass silently. CLAUDE.md lists exactly this as a "self-defeating safeguard".

**Proposed interface:** the `access` field in F6's `RouteSpec`. `mount()` installs `requireAuth`/`requireAdmin` from `access`, so the guard is a type rather than a scan. The test then iterates the exported route tables.

**Effect if done:** the guard survives any file split, and route lists come from data instead of parsing.

**Effort:** S, on top of F6. **Risk:** low. **Priority:** P2. It must land **before or with** F6.

### F8. The HTTP contract is unshared; client and server types can drift silently
**Files:**
- Server response types are declared server-side:
  - `ratings.ts:19-37` (`RatingView`, `LeaderboardEntry`)
  - `stats.ts:180-183, 220-226` (`UserStatsView extends UserStats`, whose `updatedAt: Date` serialises to a string)
  - `routes.ts:314-322` (`sessionUser`)
- The client declares its own copies: `lib/wire.ts:5-38` (`UserStatsDto`, `RatingDto`, `LeaderboardEntryDto`, `AchievementStatusDto`) and `lib/authUser` (`AuthUser`).
- No test ties these together. The only `lib/wire` users on the server are `friendRows.ts`, `friendships.ts` and `replays.ts`.
- Request schemas live in `server/http/schemas.ts`, which is not shared.
- The client hard-codes about 50 `/api/...` path literals across `context/`, `app/` and `lib/`.
- `ServerPayload.error` (`protocol.ts:46-47`) has no producer in `server/`.

**What's wrong:**
- The socket protocol is typed end-to-end through `ClientToServerEvents`/`ServerToClientEvents` and `IntentSchemas`. HTTP has no equivalent seam.
- A renamed field in `getRating` compiles on both sides and breaks the profile screen at runtime.

**Proposed interface:**
```ts
// shared/http.ts
export interface HttpContract {
  "GET /api/ratings/me": { res: RatingDto };
  "GET /api/stats/me":   { res: UserStatsDto };
  "POST /api/auth/login": { body: z.input<typeof LoginSchema>; res: SessionUserDto };
  …
}
```
- The server route specs (F6) are typed `RouteSpec<HttpContract[K]>`.
- `lib/wire` DTOs move into `shared/http.ts`, and request schemas move into `shared/`.
- The dead `ServerPayload.error` field is deleted.

**Dependency category:** in-process (a shared types module).

**Effect if done:** the server-view/client-DTO pairs collapse to one declaration each, and drift becomes a compile error.

**Effort:** M. **Risk:** low. **Priority:** P2.

### F9. Time and dealing randomness are only partly injected (several clocks)
**Files:**
- `gameTimers.ts:12-29` has an injectable `Clock` (`setClock`), used for AFK, grace and `secondsUntil`.
- These still read wall time:
  - `onlineGameLogic.ts:95, 124` default `now = Date.now()` for `markExchangeSettled`/`visibleExchangePhase`, and `gamePersistence.ts:86-89, 219` never pass `now`. Under `fakeClock`, `turnSecondsRemaining` uses fake time while exchange-card visibility uses real time.
  - Seat holds: `roomStore.ts:260, 297` use `Date.now()` against `seatHoldMs()`; `socketTable.ts:65` uses it for `expiresInMs`. `seatHold.test.ts:161-162` therefore sets env to 1 ms and really sleeps.
  - Idempotency TTL: `tableRouter.ts:87, 109`.
  - Rate windows: `socketSafety.ts:120`.
  - Round timestamps: `roundOver.ts:101`.
- The deal: `initializeGame`/`initializeRematch` accept dealt hands (`gameEngine.ts:1115-1123`, 871), but the server never passes them (`tableState.ts:111-113`, `tableHandlers.ts:380-383`). The integration suite therefore loops rounds to reach an exchange (`gameplay.test.ts:181`, which needs `MURLAN_GAME_ACTION_RATE_LIMIT` raised at line 50 for headroom, per `socketGameplay.ts:32-43`).

**Proposed interface:**
- Add `clock: Clock` and `deal?: (playerCount: number, firstSeat: number) => Card[][]` to `TableDeps` (F1).
- Pass `deps.clock.now()` into `visibleExchangePhase`/`markExchangeSettled` and into `roomStore.claimRoomSeat`/`getRoomSeatHolds` as a `now` argument. `seatForClaim` already takes `now`.

**Dependency category:** in-process (time and randomness ports).

**Effect if done:**
- Exchange-ceremony timing and seat-hold expiry become testable with `fakeClock` instead of real sleeps.
- Exchange-path tests can deal a fixed hand instead of looping.
- The two-clock disagreement bug class is removed.

**Effort:** S–M. **Risk:** low. **Priority:** P2.

### F10. Mutate→broadcast→persist→arm is repeated, and the `RoundOverWriters` seam is bypassed
**Files:**
- The publish sequence appears in several places:
  - `commitMove` (`gameTurn.ts:86-99`)
  - `dealRound` (`dealRound.ts:21-52`)
  - `rejoinAction` reclaim branch (`tableHandlers.ts:483-488`)
  - `vacateSeat` tail (`gameTurn.ts:419-421`) and its between-rounds branch (`:366`)
  - `handleRoundOver` (`roundOver.ts:138-174`)
- "Close the table" (notify abandoned, set `rooms.status` to finished, `disposeGame`) is written 3 times: `gamePersistence.ts:248-260`, `gameTurn.ts:210-222`, `gameTurn.ts:351-359`.
- `vacateSeat` *takes* `writers: RoundOverWriters` but calls `roomStore.updateRoomStatus` directly at `gameTurn.ts:351-358`.
- `disposeGame` always deletes through raw `db` (`gamePersistence.ts:116-123`).
- `commitMove` hard-wires the production `roundOverWriters` (`gameTurn.ts:97`).

**What's wrong:**
- Ordering is documented as load-bearing: settle before serving (`gamePersistence.ts:217-219`), persist before dispose (`roundOver.ts:170-174`). Yet the sequence is open-coded at each site.
- The one injected seam leaks, so a test with fake writers still hits Postgres. That is why those tests also mock `roomStore` and `db`.

**Proposed interface:**
```ts
// server/game/tableSession.ts
export function publish(deps: TableDeps, game: OnlineGameState, opts: { arm?: "afterMove" | "fresh" | false; prev?: GameState }): Promise<void>;
export function closeTable(deps: TableDeps, roomId: string, reason: "EMPTY_SEAT" | "SERVER_ERROR" | "LAST_PLAYER_LEFT"): Promise<void>;
```
- `RoundOverWriters` folds into `TableDeps`, so one injection point covers every path.

**Effect if done:** about 6 open-coded sequences become 1, the 3 close-table copies become 1, and the writers leak disappears.

**Effort:** M. **Risk:** medium (ordering). **Priority:** P2.

### F11. The lobby port is half adopted
**Files:**
- `lobbyIntents.ts:18-37` defines `LobbyPort` (a good, testable seam) for create/join/spectate.
- `socketRooms.ts` keeps three intents inline against the socket and store:
  - `room:rejoin` (105-135)
  - `room:setVisibility` (154-181)
  - `room:quickmatch` (183-232). Its join branch (206-219) duplicates `joinRoomIntent` (`lobbyIntents.ts:80-94`); its create branch (222-229) duplicates `createRoomIntent` (`:59-66`), differing only in `"public", autoStart:true`.

**What's wrong:** inconsistent seam placement. Half the lobby can be tested with `node --test` and no Postgres; the other half needs integration tests (`quickmatchAutoStart.test.ts`, `lobbyGrace.test.ts`).

**Proposed interface:** `rejoinRoomIntent(port, {code})`, `setVisibilityIntent(port, {visibility})` and `quickmatchIntent(port, {maxPlayers, gameMode})`. Quickmatch reuses `joinRoomIntent`'s claim-and-announce and `createRoomIntent({visibility:"public", autoStart:true})`. Widen `LobbyPort.store` accordingly. With F3, each intent returns its `Refusal`.

**Effect if done:** about 60 lines of duplication removed, with all 6 lobby intents behind one port.

**Effort:** S. **Risk:** low. **Priority:** P2.

### F12. `OnlineGameState` is mutated by many modules; only seat fields have a ledger
**Files:**
- `seatLedger.ts:1-10` claims single writership of the seat fields, pinned by test.
- Everything else is written ad hoc:
  - `roundOver.ts` (15 writes: scores, target, matchOver, roundsPlayed, `rematchVotes = new Set()` at 95, `endedByVote` at 318)
  - `tableHandlers.ts` (9; `rematchVotes` at 360, 413, 540, 561; `dealFirstSeat`, `gameMode`, `maxPlayers` at 384-392)
  - `gameTurn.ts` (5; `rematchVotes.delete` at 325, `turnDeadlineMs`)
  - `dealRound.ts` (4)
  - `reclaim` merges `cumulativeScores` (`seatLedger.ts:58-62`)
- The 20-field interface is `gameRoom.ts:8-144`.

**What's wrong:** the vote and score invariants ("cleared whenever the roster changes or a round deals") are spread across 4 modules. `seatLedger` shows the fix works.

**Proposed interface:** extend the ledger pattern to a `matchLedger.ts` covering `castRematchVote`, `clearVotes`, `foldRound(result)`, `rollForward()` and `markEndedByVote()`. Pin "only the ledgers write these fields" with the same scan `seatLedger.test.ts` uses.

**Effect if done:** vote and score lifecycle rules move into one file and can be tested on a bare object.

**Effort:** S–M. **Risk:** low. **Priority:** P2–P3.

### F13. Layering: `game/` imports `socket/`, and cycles are dodged with mutable module setters
**Files:**
- `tableHandlers.ts` imports `socket/socketTable.ts` (83), `socketRegistry.ts` (52), `seating.ts` (53), `emit.ts`, `payload.ts`, `events.ts` and `socketSafety` (types).
- `socketTable.ts` imports back into `game/` (`tableRouter`, `gameTurn`, `gamePersistence`).
- Setters exist to avoid import cycles:
  - `setTableHandlers` (`tableRouter.ts:75-81`; `tableHandlers.ts:15` says "to dodge a circular import")
  - `setRoomLostHandler` (`gameOwnership.ts:63-67`)
  - `setSocketServer`/`_io` (`socketRegistry.ts:15-20`)
  - `setClock` (`gameTimers.ts:27`)
- Placement smells:
  - `logger` lives in `http/` but is used everywhere.
  - `payload.ts` lives in `socket/` but is used by `http/validate.ts` and `errorHandler.ts`.
  - `events.ts` (a DB writer), `push.ts` (DB plus Expo HTTP) and `friendships.ts` (used by HTTP) live in `socket/`.
  - `retention.ts` in `game/` imports `http/*` constants.
  - `roomStore.ts:5-7` (store) imports `game/gameTimers` and `seatAllocation`.

**What's wrong:** the directories don't reflect dependency direction, and the mutable setters are ambient global wiring that tests must reset (`reopenOwnership`, `installTableHandlers` in every table test's `before`).

**Proposed interface:** with F1, `createTableRuntime(deps: TableDeps): { apply(action): Promise<IntentReply>; rehydrate(...) }` is constructed once in `setupSocket` and passed to the router. The setter globals go away. Move the shared utilities (`logger`, `payload`) to `server/shared/`.

**Effect if done:** removes 3 of the 4 setters, and the import graph points one way (socket → game → store).

**Effort:** M (rides on F1). **Risk:** low. **Priority:** P2.

### F14. A safeguard exempts a file that breaks its rule
**Files:**
- `tests/server/tableOwnership.test.ts:50-60` asserts that "the handler families do not resolve a game from this process's map". It checks only `socketGameplay.ts` and `socketRooms.ts`.
- `socketPresence.ts:88-103` (`announcePresence`) iterates `activeGames.entries()` to resume a grace-held round.

**What's wrong:**
- The scan's list is hand-maintained, so it silently exempts the third handler family.
- The local path only fires when the connecting instance is also the owner, because the grace timer was armed on the owner (`tableHandlers.ts:713`) and `clearDisconnectGrace` is local.
- The routed `game:rejoin`, whose `rejoinAction` clears the grace (494), already covers the general case. That makes this a redundant, instance-dependent second path.

**Proposed:** delete the local block in `announcePresence` and rely on the routed rejoin. Alternatively, make the scan cover every `server/socket/*` file. Encapsulate `activeGames`: export `getGame`/`hasGame` from the table runtime (F13) rather than the raw `Map`.

**Effort:** S. **Risk:** low–medium; verify the client always emits `game:rejoin` on connect. `server/CLAUDE.md` says it does. **Priority:** P2.

### F15. Store seam: one adapter, substituted by monkeypatching
**Files:**
- `userStore`, `roomStore` and `friendStore` are objects so tests can `t.mock.method` them (`roomStore.ts:50-55` says so).
- 19 non-store modules import `db` directly: `gamePersistence`, `ratings`, `replays`, `retention`, `stats`, `tableHandlers`, `userNames`, `admin` (13 queries), `authTokens`, `bugReports`, `clientErrors`, `deleteAccount`, `roundHistoryView`, `serverErrors`, `session`, `shutdown`, `events`, `push`, `ticket`.
- No PGlite or any second adapter exists.
- Monkeypatch sites: `roomLifecycleRaces` (6), `reconnect` (4), and `gameplay`/`intentAcknowledged`/`ownerLoss`/`socketHandshakeLimit` (2 each).

**Verdict:** "The store" is a hypothetical seam with one Postgres adapter. A full store interface with an in-memory twin is **not** recommended: Postgres-specific behaviour is load-bearing (advisory locks, `FOR UPDATE` in `closeForStart`/`claimRoomSeat`, partial unique indexes, `LISTEN/NOTIFY` for the adapter).

The two consumer-shaped ports that already work are `FriendshipDeps` (`friendships.ts:13-31`) and `LobbyPort.store`. Follow that pattern instead: give each consumer a `Pick<typeof store, …>` port where it has a unit-test surface (F2, F11), and keep integration tests on real Postgres for locking behaviour.

**Category:** local-substitutable only per narrow port. **Effort:** n/a, done incrementally via F2/F11. **Priority:** P2 (guidance).

---

## P3

- **F16. Six identical gameplay handlers.** `socketGameplay.ts:80-181`: six `onEvent`s each do `atTable() → NOT_AT_A_TABLE → applyOrForward(kind…)`. A table-driven `tableIntent(event, schema, toDraft, limits)` would reduce them to six one-line entries, with `game:rejoin` kept apart. **Effort S.**
- **F17. Non-exhaustive action-kind routing.** `takeoverMode` (`tableActions.ts:85-95`) is an `if` chain, so a new `TableAction` kind silently defaults to `"forward"`. Make it `const TAKEOVER: Record<TableActionKind, Mode>`. The dispatcher `default` (`tableHandlers.ts:801-803`) must stay for cross-revision forwards; add a separate `satisfies never` exhaustiveness check so a new kind fails to compile until handled. **Effort S.**
- **F18. Pass-throughs that fail the deletion test** (deleting each makes complexity vanish rather than reappear):
  - the `socket.ts:41-46` re-export barrel for routes; it also makes `routes.ts` import the whole socket graph
  - `gameTurn.ts:52-54` `recordPlayFlags` wrapper
  - three identical context interfaces: `socketGameplay.ts:60-64`, `socketRooms.ts:41-45`, `socketPresence.ts:42-46`
  - the `EventOutcome` alias of `IntentReply` (`socketSafety.ts:145`), imported by the game layer
  - **Effort S.**
- **F19. `payload.ts` claims to be "the one place" a payload is built** (`payload.ts:1-6`), but:
  - `gameTurn.ts:263-270` hand-builds `{code,message,params}` with English template literals,
  - `gameTurn.ts:346, 376, 415` call `translate(DEFAULT_LOCALE, …)` by hand.

  Use `payload("PLAYER_AFK_AUTO_PASS", {username})` and similar. **Effort S.**
- **F20. Socket-limit config freezes at import.** `socketGameplay.ts:39-43` reads `MURLAN_GAME_ACTION_RATE_LIMIT` at module scope, contrary to the "read per call" rule in `gameTimers.ts:88-97` (pinned for timers by `timerEnvIsLive.test.ts`). Read it per call, or take it from `deps`. **Effort S.**

---

## Already deep: leave alone
- **`tableRouter.ts`.** `applyOrForward(io, draft) → IntentReply` hides instance discovery, takeover under advisory lock, per-room serialisation (`inFlight`), retry with backoff and idempotent replay (`applied` TTL map). The interface is tiny and the behaviour large. Only F17 and the setter (F13) touch it.
- **`gameOwnership.ts`.** `claimRoom`/`releaseRoom`/`ownsRoom` over a dedicated connection with heartbeat, reclaim and keepalives.
- **`seatLedger.ts`.** A single writer of seat fields, pinned by test. It is the model for F12.
- **`onlineGameLogic.resolveRoundEnd`.** One pure input→result function behind `handleRoundOver`. Only the `now` defaults (F9) need changing.
- **`tableState.ts` with `shared/persistedEnvelope.ts`.** The single construction, pack and restore point, with `MEMORY_ONLY` enumerated.
- **`RoundOverWriters`.** A real seam with two adapters (production plus test fakes); widen it, don't remove it (F10).
- **`socketSafety.onEvent`.** Validation, per-user rate limit, per-socket ordering, exactly-once ack and containment in one wrapper. F3 only changes how a refusal is returned.
- **`lobbyIntents` `LobbyPort` and `friendships` `createFriendships(deps)`.** Correct consumer-shaped ports; extend them (F11).
- **`gameTimers.ts`.** Keyed timers plus an injectable `Clock`; F9 just makes everyone use it.
- **`schemaDdl.ensureSchema`, `shutdown(ShutdownDeps)`, `routeLimiter`, and the recovery routes' timing.** CONTEXT.md / ADR-0007 explicitly reject consolidating the recovery state machine.
- **Socket protocol typing** (`shared/protocol.ts` event maps, `IntentSchemas`, `socketTypes.ts`). Inbound and outbound socket events are already typed end-to-end; only refusal codes (F3) and HTTP (F8) are untyped.

## Suggested order
1. F5, F14, F7 (small invariant and safeguard fixes).
2. F2, then F1 with F9 (the ports).
3. F3, F10, F4 (they use the ports).
4. F6 and F8.
5. F11, F12, F13.
6. P3 items opportunistically.
