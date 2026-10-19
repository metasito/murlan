# 04 — Server runtime: table lifecycle, ownership, rows, resilience

Area: `ActiveGameStore` / table registry, the lifecycle of a table on an instance (claim, live, dispose,
shutdown, reclaim), cross-instance liveness, timers, retention, and the DB/HTTP stall findings.
All lines are at MAIN `a1d0ebb5` unless marked.

## 1. Summary

- **Now:** a table's life on an instance is four process-globals that nothing orders together — the
  `activeGames` Map (`gameRoom.ts:146`), the lock set `held` (`gameOwnership.ts:50`), the row write
  chain `roomWriteTails` (`gamePersistence.ts:138`) and the timer maps (`gameTimers.ts:47`). Every
  transition (dispose, shutdown, reclaim) touches them in its own order, and three of the defects
  are the same bug: **the lock goes before the last row write** (L-022 shutdown, L-028 dispose) or
  **is given up on an answer that never said "lost"** (L-027).
- **After:** one stated lifecycle with five invariants (§4), enforced at two chokepoints that already
  exist — `persistGameState` (a row is written only by the live game object) and `gameOwnership`
  (a lock is released only after the room's last write, and a claim is refused while that is
  pending). Shutdown gains one step, `stopTables()`, and closes ownership after the pool drain.
- `active_games` gets an owning store module with a memory twin for tests (L-024/L-127); every
  age-based delete moves into `retention.ts`, batched and cluster-safe (L-029/L-044/L-046).
- Two single-writer scans become derived rather than hand-listed (L-032 `activeGames`, L-036 new
  `matchLedger.ts`), and six independent stall fixes ride one hygiene ticket.
- **Why this shape:** the deep modules here (`tableRouter`, `gameOwnership`, `gameTimers`) are
  right; what is missing is an owner of *ordering* between them. Putting that ordering inside the
  two existing chokepoints fixes the class without a new registry module or touching the router.

## 2. Current shape (evidence at MAIN)

**Shutdown (L-022, L-039).** `shutdown.ts:74-116`: `beginShutdown()` (a flag, `gameRoom.ts:148-163`)
→ `socketAdapterReady(1_000)` → `io.close()` → `settleDisconnects(1_500)` → **`closeOwnership()`
(`:86`, drops every lock)** → adapter pool end → `drainPool` (`:102`) → `pool.end`. `activeGames`
still holds every game after `:86`. The flag is read at `tableHandlers.ts:661,813,819`,
`tableRouter.ts:294`, `socketTable.ts:248`, `socketPresence.ts:196` — never by a timer. A bot timer
(`gameTurn.ts:144`) → `runBotTurn` (`:191`) → `commitMove` (`:86-99`) → `persistGameState`
(`gamePersistence.ts:161-170`) writes the row after the lock is gone; `armAfterMove` (`gameTurn.ts:164`)
re-arms, so clearing timers once is not enough. `FORCED_EXIT_MS = 1500 + 6000 + 2000`
(`shutdown.ts:34`) leaves out `socketAdapterReady`, `io.close`, `closeOwnership`, adapter end;
`tests/server/shutdownBudget.test.ts` checks only three inequalities.

**Reclaim (L-027).** `takeLock` returns `null` when it cannot connect, `false` when the query throws
(`gameOwnership.ts:149-151`). `reclaim` (`:163-183`) reads `false` as "claimed elsewhere":
`held.delete` + `onRoomLost` → `disposeGame(roomId, false)` (`tableHandlers.ts:835`).

**Dispose (L-028).** `disposeGame` (`gamePersistence.ts:106-125`): `activeGames.delete` →
`void releaseRoom` (`:115`) → delete row queued on `inRoomOrder` (`:117-123`) behind pending writes.
A rejoin in that window: router finds no game, `claimRoom` returns true from `held` (`:193`) or
takes the freed lock, `rehydrateGame` reads the still-present row (`tableHandlers.ts:140-142`) and
resurrects the table. Same instance or another. A `persistGameState` on a held reference after the
delete re-inserts the row the same way.

**Lobby grace (L-023).** `armLobbyGrace` expiry asks only local maps
(`socketTable.ts:257-258`); a reconnect through another instance's `room:rejoin`
(`socketRooms.ts:129` `clearLobbyGrace`) is a local no-op there, so A releases a seat held live on B.
The in-game disconnect grace already asks the cluster (`tableHandlers.ts:719` `isUserOnline`);
`isUserAtTable` exists (`socketRegistry.ts:58-66`).

**Rows (L-024, L-127, L-136).** Reads: `db.query.activeGames.findFirst` in `rehydrateGame`
(`tableHandlers.ts:140-142`), full select in `resumeOrphanedTables` (`:814-816`); writes:
`persistence.writeActiveGame` (`gamePersistence.ts:128-136`); deletes in `disposeGame`, `pruneAbandonedGames`
(`:269-279`), `pruneStaleRooms` (`:292-313`) and `deleteAccount.ts:38-44` (the room_players →
active_games → rooms order written twice). Tests reach past every interface: 8× `mock.method(db.query.activeGames,"findFirst")`
(`tableStalls.test.ts:94,113,279,291,303,321`, `endMatchVote.test.ts:269`, `persistedEnvelope.test.ts:147`),
1× `mock.method(db,"delete")` (`persistedEnvelope.test.ts:148`), plus 16 roomStore stubs in
`tableStalls`/`shutdownSeatLost`. `tests/server/openingGrace.test.ts` is already a unit test.

**Retention and prune (L-029, L-044, L-046).** `retention.ts:25-52` claims to be the single home
but each rule is one unbatched `DELETE … WHERE ts < cutoff` under a 5 s `statement_timeout`;
`ticket.ts:89` deletes expired nonces on *every handshake* — a second home the
`retentionOffWritePath.test.ts` scan misses because it only recognises `make_interval`/`< now()`, not
`lt(col, new Date())`. `pruneStaleRooms` guards liveness with the local `activeGames.has`
(`gamePersistence.ts:300`). Room creation is two statements (`lobbyIntents.ts:59-60`,
`socketRooms.ts:223-224`); `removeRoomPlayer` (`roomStore.ts:335`) has only a test caller;
`roomStore.ts:5-7` imports `game/gameTimers` for `seatHoldMs` (`:261,:298`).

**Single writers (L-032, L-036).** `tableOwnership.test.ts:50-60` scans a hand list of two socket
files; `socketPresence.ts:88-103` iterates `activeGames.entries()`. `seatLedger.ts` owns seat fields
(scan at `seatLedger.test.ts:130-230`); `rematchVotes`, `cumulativeScores`, `matchTarget`,
`roundsPlayed`, `matchOver`, `endedByVote` are written in `roundOver.ts:90-95,259,318,326-329`,
`tableHandlers.ts:360,413,540,561`, `gameTurn.ts:325`, `seatLedger.ts:58-62`.

**Stalls (L-030, L-038, L-040..L-043).** `routeLimiter` passes no store (`rateLimit.ts:61-69`); the
comment at `routes.ts:139-150` oversells the per-username limiter. `fetch` without `signal`
(`mail.ts:75`, `push.ts:109`); stale Run-button sentence `mail.ts:101-104`. `await updateRoomStatus`
before the deal's broadcast (`dealRound.ts:40-44`). One `INSERT server_errors` per error log line
through the app pool (`serverErrors.ts:12-20`, `logger.ts:51-53`); client crashes logged at error
(`routes.ts:982`); bug reports share `errorReportLimiter` (`routes.ts:978,1020`). `adminSnapshot`
runs 18 queries in one `Promise.all` against a 10-connection pool (`admin.ts:235-254`); error-group
queries are unwindowed (`clientErrors.ts:83-101`, `serverErrors.ts:29-37`); `getCircleLeaderboard`
runs `currentRow` (two queries) per member (`ratings.ts:224-236`, `:46-68`). `ensureSchema` emits
`ADD COLUMN IF NOT EXISTS` for every column on every boot (`schemaDdl.ts:364-369,489-496`), each
taking ACCESS EXCLUSIVE.

## 3. Alternatives considered

The central question: who owns the ordering of memory, row, lock and timers for one room?

**A. Patch each site.** `arm()` refuses while `isShuttingDown()`; `takeLock` catch → `null`; a
`disposing` Set in `gamePersistence` consulted by `rehydrateGame`; a read function for rows.
*Depth:* none added. *Locality:* poor — the shutdown flag is unresettable (`gameRoom.ts:148`; the
reason `shutdownSeatLost.test.ts` is its own file), `arm()` refusing does not stop an in-flight
continuation, and a `disposing` check in `rehydrateGame` alone does not stop the router releasing the
lock early through `takeOverAndApply`'s `finally` (`tableRouter.ts:231`). Each new transition needs
its own guard. Rejected.

**B. A `TableRegistry` slot machine.** One module replaces `activeGames`, `inFlight`
(`tableRouter.ts:190`) and the tombstones with `Map<roomId, {state: "loading"|"live"|"disposing"|"stopped", game?}>`,
owning claim/load/dispose/stop, with ownership underneath.
*Depth:* highest; every transition in one file. *Seam:* the router's per-room serialisation
(`inFlight`) moves in. *Migration risk:* high — `tableRouter.ts` is assessed deep and correct
(server report, "Already deep"), its takeover serialisation took several fixes
(`takeoverSerialised.test.ts`), 89 test sites in 17 files touch `activeGames` directly, and the
server-output session is splitting `tableHandlers.ts`/`gamePersistence.ts` in parallel. Rejected
for now; §9 notes when it becomes cheap.

**C. Enforce the lifecycle at the two chokepoints every transition already passes.** (picked)
- *Writes:* `persistGameState` is the only row writer; it writes only for `activeGames.get(roomId) === game`.
  Stopping or disposing a table = removing it from memory; every later write on a held reference
  is a no-op, and every timer callback already resolves its game from memory at fire time
  (`gameTurn.ts:125,179,192,235,322`), so armAfterMove's re-arm finds nothing.
- *Locks:* `gameOwnership` models "releasing" as a lock state: `releaseRoomAfter(roomId, settled)`
  keeps the lock until the row delete lands, and `claimRoom` refuses while it is pending — the
  router already reads a refused claim as RETRY (`tableRouter.ts:262`). Shutdown closes ownership
  after the pool drain, so the last write lands before any lock drops.
- *Answers:* lock attempts are tri-state end to end; only "held elsewhere" loses a room.

*Comparison:* C gives B's invariants for the defects at hand with no change to the router's
serialisation, no test-wide import churn, and diffs confined to `shutdown.ts`, `gamePersistence.ts`,
`gameOwnership.ts`, `socketTable.ts` and two lines of `tableRouter.ts`. It loses B's single-file
locality for "what states can a room be in" — recovered by stating the lifecycle once (§4) and
pinning it with tests at the two chokepoints.

**For L-022 specifically**, three ways to stop timers were weighed: (i) `arm()` refuses during
shutdown — poisons every later test in the process and leaves in-flight continuations writing;
(ii) guard each timer callback with `isShuttingDown()` — but before `closeOwnership` the instance is
the legitimate owner, and the write half (held references) stays open; (iii) **`stopTables()`
removes every game from memory and clears its timers, plus the write-side identity guard** — the
guard is where the timer fires (it resolves nothing) and where the write lands. Picked (iii).

**For "when do locks drop at shutdown"**: (a) await the room write chains with a budget, then
`closeOwnership`, then drain; (b) `closeOwnership` *after* the drain. (b) is simpler (no second
wait, no new budget step) and strictly safer; its cost is that in a *degraded* shutdown other
instances wait up to `DRAIN_TIMEOUT_MS` (6 s) for the lock (healthy path: the drain returns after
50 ms quiet, `drainPool.ts:33`). Picked (b).

**For the store (L-024/L-127)**: a full store interface with an in-memory adapter for every store
was rejected (server report F15: advisory locks, `FOR UPDATE`, partial unique indexes are
load-bearing). Picked the codebase's own pattern — a module object per table (`roomStore`,
`persistence`) that tests replace method-by-method — plus one fixture-backed memory twin in
`tests/helpers` for the table-runtime surface, so tests declare state instead of stubbing drizzle.

## 4. Target design

### 4.1 The lifecycle of a room on one instance (stated once; pinned by T1's tests)

```
unclaimed ──claimRoom──▶ claimed ──admit (startMatch | rehydrate)──▶ live
live ──disposeGame(deleteRow)──▶ releasing (no game; row delete queued; lock held; claims refused) ──▶ unclaimed
live ──disposeGame(keepRow) | room lost──▶ unclaimed            (lock released at once)
live ──stopTables() [shutdown only]──▶ stopped (no game; row kept; lock held) ──closeOwnership after drain──▶ exit
```

Invariants a caller must know:
- **I1 — only the live object writes its row.** `persistGameState(roomId, game)` writes iff
  `activeGames.get(roomId) === game`; otherwise it resolves without writing. (Closes the write half
  of L-022 and the re-insert-after-delete variant of L-028.)
- **I2 — a lock outlives the room's last write.** Dispose with a row delete releases via
  `releaseRoomAfter`; shutdown closes ownership after `drainPool`.
- **I3 — no claim while releasing.** `claimRoom` returns false for a releasing room on this instance;
  other instances fail `pg_try_advisory_lock` because the lock is still held.
- **I4 — a room is lost only on "held elsewhere".** Unreachable or a thrown query retries.
- **I5 — every timer callback resolves its game from memory at fire time** (already true; T1 adds a
  test so it stays true). Removing a game from memory therefore stops every timer path.
- **I6 — a cross-instance liveness question asks the cluster** (lobby grace expiry, stale-room
  prune), never a local map.

### 4.2 Interfaces

```ts
// server/game/gameOwnership.ts
type LockAnswer = "taken" | "held_elsewhere" | "unreachable";
async function takeLock(roomId: string): Promise<LockAnswer>;        // catch → "unreachable"
export async function claimRoom(roomId: string): Promise<boolean>;    // false when held elsewhere,
                                                                      // unreachable, or releasing here
export async function releaseRoom(roomId: string): Promise<void>;     // unchanged
/** Keeps the lock until `settled` settles (either way), then releases. Claims are refused meanwhile. */
export function releaseRoomAfter(roomId: string, settled: Promise<unknown>): void;
// reclaim(): "taken" keep · "unreachable" retry (existing OWNERSHIP_RECLAIM_RETRY_MS) · "held_elsewhere" lose

// server/game/gamePersistence.ts
export function disposeGame(roomId: string, deleteRow = true): void;
//   deleteRow: activeGames.delete → releaseRoomAfter(roomId, inRoomOrder(roomId, store.remove))
//   !deleteRow: activeGames.delete → void releaseRoom(roomId)   (as today)
/** Shutdown only: forgets every live table — timers cleared, rows and locks kept — and stops the sweeper. */
export function stopTables(): void;
export function persistGameState(roomId: string, game: OnlineGameState): Promise<unknown>; // I1

// server/http/shutdown.ts
export const SHUTDOWN_BUDGET = {
  adapterReady: 1_000, ioClose: 500, settle: DISCONNECT_SETTLE_MS,
  drain: DRAIN_TIMEOUT_MS, ownership: 300, adapterEnd: 300, slack: 400,
} as const;                                    // every step awaited through within(step, ms)
export const FORCED_EXIT_MS: number;           // = sum(SHUTDOWN_BUDGET), < runtime.sigtermGraceMs
// order: beginShutdown → adapterReady → io.close → settle → stopTables → drain → closeOwnership
//        → adapter pool end → pool.end → exit

// server/store/activeGameStore.ts   (T2)
export interface ActiveGameRow { roomId: string; gameState: unknown }
export const activeGameStore = {
  load(roomId: string): Promise<ActiveGameRow | undefined>,
  list(): Promise<ActiveGameRow[]>,
  write(roomId: string, env: PersistedEnvelope<GameState>): Promise<void>,   // replaces `persistence`
  remove(roomId: string): Promise<void>,
};
/** The table runtime's narrow room port; the type server-output's deps object will take. */
export type TableRoomPort = Pick<typeof roomStore,
  "getRoomById" | "getRoomPlayers" | "updateRoomStatus" | "releaseSeat" | "upsertRoomPlayer" | "closeForStart">;

// server/store/roomStore.ts   (T3)
createRoom(host: string, opts: { gameMode; maxPlayers; visibility; autoStart }): Promise<Room>; // host seated at 0, one tx
purgeRooms(tx: Tx | typeof db, ids: string[]): Promise<number>;   // room_players → active_games → rooms
claimRoomSeat(..., holdMs: number) / the seat-hold reads take holdMs from the caller
// deleted: addRoomPlayer, removeRoomPlayer, the import of game/gameTimers

// server/game/retention.ts   (T3) — the only home of every age-based delete
export async function sweepRetention(): Promise<void>;   // + socket_ticket_nonces, active_games (untouched 24 h),
                                                         //   stale rooms (age AND no active_games row touched within 24 h)
async function deleteInBatches(table: string, where: SQL, batch = 5_000, maxBatches = 20): Promise<number>;
//   DELETE FROM t WHERE ctid IN (SELECT ctid FROM t WHERE <where> LIMIT batch), looped

// server/game/matchLedger.ts   (T4) — only writer of rematchVotes, cumulativeScores, matchTarget,
//                                      roundsPlayed, matchOver, endedByVote
export function castRematchVote(game, userId): void;
export function withdrawRematchVote(game, userId): void;
export function clearRematchVotes(game): void;
export function foldRound(game, result: Pick<RoundEndResult, "cumulativeScores"|"matchTarget"|"matchOver">): void;
export function closeMatch(game, { endedByVote }: { endedByVote: boolean }): void;
export function rollForward(game, firstTarget: number): void;
export function carrySeatScore(game, fromKey: string, toUserId: string): void;  // called by seatLedger.reclaim
```

Error modes and ordering a caller must know:
- A rejoin/rematch vote landing inside a dispose's release window gets RETRY → after
  `ASK_ATTEMPTS` (~360 ms) `TABLE_UNREACHABLE` if the delete is still pending (DB under stress);
  never a resurrected table. Normal windows are milliseconds.
- `rehydrateGame`'s "unrestorable" branch deletes the row itself, awaited, and **keeps the claim**:
  the router releases it for a non-create action (`tableRouter.ts:213-219`, unchanged) and deals on
  it for `startMatch` — the re-claim at `tableRouter.ts:221-225` is deleted.
- `stopTables()` must run after `settleDisconnects` (a disconnect handler may still route a
  `seatLost` to a table here) and before the drain (so nothing new is queued while it waits).
- After `stopTables()` a still-running continuation may complete stats/ladder/replay writes it had
  already started; these are round results, not the row, and the drain waits for them.

**Deleted:** `persistence` object (→ `activeGameStore.write`); the tableRouter re-claim for
unrestorable rows; the local-map check in `armLobbyGrace`'s expiry; `pruneAbandonedGames` and
`pruneStaleRooms` in `gamePersistence.ts` (→ `retention.ts`); the per-handshake nonce delete in
`ticket.ts`; `roomStore.addRoomPlayer`, `removeRoomPlayer`; the `game/gameTimers` import in
`roomStore.ts`; the hand list in `tableOwnership.test.ts:53`; 9 drizzle-internal mocks.

## 5. Migration (each step leaves main green)

1. **T1 — lifecycle defects in place.** Tri-state lock answers; `releaseRoomAfter` and refused
   claims; `disposeGame` releases after the delete; `rehydrateGame` unrestorable keeps the claim;
   `persistGameState` identity guard; `stopTables`; shutdown reorder and named budget; lobby grace
   asks the cluster. Deletes: the re-claim in the router, the local grace check, the stale comment
   at `tableHandlers.ts:491-493` (rewritten to the true statement for owner-path graces).
2. **T2 — `activeGameStore`.** Moves the read/list/write/remove into `server/store/activeGameStore.ts`;
   `rehydrateGame`/`resumeOrphanedTables` drop `db` and `shared/schema` imports
   (`tableHandlers.ts:42-43,49`); adds `tests/helpers/memoryTableStores.ts`; migrates the 9 drizzle
   mocks and the `persistence.writeActiveGame` mocks. Deletes: `persistence`, the raw drizzle in
   `tableHandlers.ts`.
3. **T3 — retention single home.** Batched deletes; nonce and active_games and stale-room prunes
   move into `retention.ts`; `purgeRooms` shared with `deleteAccount`; stale-room guard in SQL;
   atomic `createRoom`; `holdMs` passed in. Deletes: `pruneAbandonedGames`, `pruneStaleRooms` from
   `gamePersistence.ts`, `ticket.ts:89`, `addRoomPlayer`, `removeRoomPlayer`.
4. **T4 — single writers.** `tableOwnership` scan derived over `server/**`; `announcePresence` asks
   a game-layer function instead of iterating `activeGames`; `matchLedger.ts` plus a shared field-write
   scanner extracted from `seatLedger.test.ts`.
5. **T5 — stall hygiene** (independent of 1–4; any time).

## 6. No-regression strategy

Pins written **before** the move, red at MAIN where it is a bug:

| Ticket | Test | Red at MAIN because |
|---|---|---|
| T1 L-022 | `tests/server/shutdownStopsTables.test.ts` (own file: `beginShutdown` is irreversible). A live table whose acting seat is a bot; run the real `shutdown("SIGTERM", {io, server, pool, exit})` with fakes (`ShutdownDeps` already injects all four; `drainPool` reads a fake `{totalCount:0, idleCount:0, waitingCount:0}`); advance the `setClock` fake clock past `botMoveDelayMs()`; assert `writeActiveGame` never called and `activeGames` empty. Second case: `persistGameState(room, heldRef)` after `stopTables()` writes nothing. | the bot timer fires `commitMove` → write |
| T1 I5 | `tests/server/stopTablesTimers.test.ts`: every `TIMER_KINDS` kind armed for a live table, `stopTables()`, advance clock → no callback reaches a write or an emit (pattern of `disposeClearsTimers.test.ts`, `KEY_OF` reused). | new function — green-only pin |
| T1 L-027 | `tests/server/ownershipReclaim.test.ts` (unit): `t.mock.method(pg.Client.prototype, "connect" / "query")` — the lock query throws once during reclaim, then succeeds; assert `onRoomLost` never called and `ownsRoom` true. The integration `ownershipReclaim.test.ts` keeps covering refused connections. | `false` → room dropped |
| T1 L-028 | `tests/integration/disposeTombstone.test.ts`: claim + live table; hold an earlier row write on a deferred (mock `persistence.writeActiveGame`) so the delete queues; `disposeGame`; `applyOrForward({kind:"rejoin"})` → refusal, `activeGames` lacks the room; resolve the deferred → row gone, and a second pg client's `pg_try_advisory_lock` succeeds. | rehydrated from the row |
| T1 L-023 | `tests/server/lobbyGraceCluster.test.ts`: `setSocketServer` with a fake whose `in(userRoom).fetchSockets()` returns a socket in the room; no local socket; fake clock past `lobbyGraceMs()`; `roomStore.releaseSeat` not called. | local maps empty → released |
| T1 L-039 | `shutdownBudget.test.ts`: `FORCED_EXIT_MS === sum(SHUTDOWN_BUDGET)`, every entry > 0, `< sigtermGraceMs`; plus a unit test of `within()` (a never-settling step is abandoned at its budget with a logged warning). | constants absent |
| T2 | the 9 migrated tests stay green unchanged in assertions; `tests/server/activeGameStoreScan.test.ts`: no file under `server/` outside `server/store/` and `server/game/retention.ts` imports `activeGames` from `shared/schema` (derived over the tree). | `tableHandlers.ts:49` imports it |
| T3 L-044 | `tests/integration/staleRoomPrune.test.ts`: backdated room (created 25 h ago) with an `active_games` row touched now → kept; touched 25 h ago → purged with its `room_players`. | local-only guard purges it |
| T3 L-046 | `tests/integration/roomCreate.test.ts`: host insert fails (unknown user id → FK violation) → no `rooms` row remains. | orphan `waiting` row |
| T3 L-029 | `retentionOffWritePath.test.ts` signature widened to `lt(<col>, new Date())` / `< now()` with `.delete(` and the rule tightened to "every age-based delete lives in `retention.ts`" (derived over `server/**`); integration: 12 001 aged `events` rows with `batch = 5_000` are gone after one sweep. | `ticket.ts:89` trips the widened scan |
| T4 L-032 | `tableOwnership.test.ts`: production `activeGames.(set|delete|clear)` only in `tableHandlers.ts` and `gamePersistence.ts`; no `activeGames` read in any file under `server/socket/` or `server/http/` (directory listing, not a hand list). | `socketPresence.ts:89` |
| T4 L-036 | `tests/server/matchLedger.test.ts`: behaviour on a bare object (fold, close, roll forward, carry) + the shared field-write scan over `server/`, `lib/`, `shared/`. | writes in 5 files |
| T5 | per item, §8. | — |

Existing tests that move or change: `tableOwnership.test.ts:50-60` (hand list → derived) and its
`activeGames.delete … releaseRoom` regex (still matches `releaseRoomAfter`; T1 adds a runtime test
instead of relying on it); `disposeClearsTimers.test.ts` (unchanged, `deleteRow=false`);
`shutdownBudget.test.ts` (sums the list); `persistedEnvelope.test.ts:147-148`, `tableStalls.test.ts`
(8 mocks), `endMatchVote.test.ts:266-269`, `commitMove`/`exchangeRearm`/`weakSeatTakeover`
(`persistence.writeActiveGame` → `activeGameStore.write` or the memory twin); `lobbyIntents.test.ts:31,78`
(no `addRoomPlayer`); `roomVisibility.test.ts:163` (`removeRoomPlayer` → `releaseSeat`);
`seatLedger.test.ts` (scanner extracted to `tests/helpers/fieldWrites.ts`, `cumulativeScores` carry
now through `carrySeatScore`). Any server test that persists a game it never put in `activeGames`
must register it (I1); T1's DoD runs the whole `tests/server` directory to find them.

Which checks catch what: unit `node --test tests/server/*` catches I1–I5 and the scans;
`tests/integration/*` (Postgres) catches lock/row ordering, prune SQL and the atomic insert;
`shutdown.test.ts`/`restartConvergence.test.ts` catch a shutdown or restart that loses a seat. No
layout is touched, so `tests/e2e/` is not needed for any ticket here.

## 7. Coverage table

| ID | Covered by | Note |
|---|---|---|
| L-022 | T1 | `stopTables` + identity guard in `persistGameState` (guards where the timer fires: the callback resolves nothing; armAfterMove's re-arm finds nothing); ownership closed after drain covers the closeOwnership→exit window. Not `arm()` refusing (verify `fix_ok`). |
| L-023 | T1 | `isUserAtTable` in the lobby-grace expiry; comment at `tableHandlers.ts:491-493` corrected (true for the owner path). |
| L-024 | T2 (+ T3 for `purgeRooms`) | Read seam (`load`/`list`) per verify correction, not only `purgeRooms`. |
| L-027 | T1 | Tri-state `LockAnswer`; same fix covers `claimRoom` (verify correction). |
| L-028 | T1 | Tombstone = "releasing" lock state: `releaseRoomAfter` + `claimRoom` refusal (owner: tombstone). The proposed "release inside the chain" alone is rejected per verify. |
| L-029 | T3 | Nonce prune into the sweep (immediate value) + `deleteInBatches`; scan widened so `retention.ts` is the only home. |
| L-030 | T5 | Document the per-instance ceiling at the limiter and correct `routes.ts:139-150`; Postgres store not built (verify `fix_ok`). Owner decision 1. |
| L-032 | T4 | Derived scan; `announcePresence` block kept (it is correct and the only path for a client that lost its room id) but asks a game-layer function. `getGame/hasGame` encapsulation deferred to B (§3). |
| L-036 | T4 | `matchLedger.ts` + derived scan; after #1628 and server-output's split. |
| L-038 | T5 | `AbortSignal.timeout(10_000)` on both fetches; stale sentence `mail.ts:101-104` deleted. |
| L-039 | T1 | `SHUTDOWN_BUDGET` named list, `within()` per step, test sums the list. |
| L-040 | T5 | `void` the status write (joins require `waiting`, `lobbyIntents.ts:75`). |
| L-041 | T5 | Recorder skips while `pool.waitingCount > 0`; client crash at warn; `bugReportLimiter`. |
| L-042 | T5 | 7-day window on both error-group queries; admin queries in chunks of ≤ 4; one `DISTINCT ON` query for the circle. `symbolicate` left (not proposed). |
| L-043 | T5 | Skip `ADD COLUMN`/`CREATE INDEX` (and its `DEDUPE_ON_BOOT` delete) already in the catalog, from one catalog read; not the advisory lock (verify). |
| L-044 | T3 | SQL guard: no `active_games` row touched within the window. |
| L-046 | T3 | `createRoom(host, …)` seats the host in one transaction; `addRoomPlayer`/`removeRoomPlayer` deleted; `holdMs` passed in. |
| L-127 | T2 | Narrow: `activeGameStore` + `TableRoomPort` type + fixture-backed memory twin replacing the 9 drizzle mocks and the `tableStalls`/`shutdownSeatLost` roomStore stubs. Injection through a deps object is server-output's constructor (§9). |
| L-136 | T2 (partial); rest not needed at MAIN | The named example `tests/server/openingGrace.test.ts` is already a unit test with a thin integration smoke (`openingGraceTimesOut.test.ts`). `ladderAndReplay`'s SQL assertions need Postgres; only its socket-driving half could move, and that needs server-output's L-026 output port — handed to server-output/test-harness. T2's memory twin is the seam this area owes. |

## 8. Proposed tickets

### T1 — Table lifecycle: no row write after its lock is gone (M)
IDs: L-022, L-027, L-028, L-023, L-039.
Files: `server/http/shutdown.ts`, `server/game/gamePersistence.ts`, `server/game/gameOwnership.ts`,
`server/game/tableHandlers.ts` (`rehydrateGame` unrestorable branch `:151-158`, comment `:491-493`),
`server/game/tableRouter.ts` (`:221-225` deleted), `server/socket/socketTable.ts` (`:257-258`),
tests listed in §6.
Blocked by: **#1628** (adds a timer kind in `gameTimers.ts`, edits `handleRoundOver` and
`rehydrateGame`); any **server-output** ticket editing `gamePersistence.ts`/`tableHandlers.ts`/
`tableRouter.ts` must be ordered with this one (recommend T1 first: defects, small diffs).
Definition of done:
- [ ] `takeLock` answers `"taken" | "held_elsewhere" | "unreachable"`; a thrown query is `"unreachable"`; `reclaim` loses a room only on `"held_elsewhere"`; unit test with a lock query that throws once (red first)
- [ ] `releaseRoomAfter(roomId, settled)` exists; `claimRoom` returns false while a release is pending; `disposeGame(roomId)` releases after its row delete settles; `disposeGame(roomId, false)` releases at once
- [ ] `rehydrateGame`'s unrestorable branch deletes the row (awaited, ordered) and keeps the claim; the re-claim at `tableRouter.ts:221-225` is gone; `persistedEnvelope.test.ts`'s unrestorable cases stay green
- [ ] integration `disposeTombstone.test.ts`: a rejoin inside the release window does not restore the table; red first
- [ ] `persistGameState` writes only when `activeGames.get(roomId) === game`; tests that persisted unregistered games register them
- [ ] `stopTables()`: every live game out of memory, its timers (all kinds incl. per-user `disconnect`) and lobby graces cleared, rows and locks kept, sweeper interval cleared
- [ ] shutdown order: … `settleDisconnects` → `stopTables` → drain → `closeOwnership` → adapter pool end → `pool.end`; the comment at `shutdown.ts:83-85` states the new reason
- [ ] `shutdownStopsTables.test.ts` (own file) runs the real `shutdown()` with fakes and shows no row write after it; red first
- [ ] `SHUTDOWN_BUDGET` named list; every await in `shutdown()` goes through `within(name)`; `FORCED_EXIT_MS` is its sum; `shutdownBudget.test.ts` sums it against `sigtermGraceMs`
- [ ] lobby grace expiry asks `isUserAtTable(userId, roomId)`; `lobbyGraceCluster.test.ts` red first
Checks — while iterating: `node --test tests/server/shutdownStopsTables.test.ts tests/server/ownershipReclaim.test.ts tests/server/lobbyGraceCluster.test.ts tests/server/shutdownBudget.test.ts tests/server/disposeClearsTimers.test.ts`.
Before pushing: `node --test tests/server/*.test.ts`, `npm run agent:check`, and with the dev stack
up `node --test tests/integration/disposeTombstone.test.ts tests/integration/shutdown.test.ts tests/integration/ownershipReclaim.test.ts tests/integration/restartConvergence.test.ts tests/integration/lobbyGrace.test.ts`.

### T2 — `active_games` has one owner: `activeGameStore` and a memory twin (M)
IDs: L-024, L-127, L-136 (partial).
Files: new `server/store/activeGameStore.ts`; `server/game/gamePersistence.ts` (`persistence` →
store; dispose's delete → `store.remove`); `server/game/tableHandlers.ts` (`:42-43,49,140-142,814-816`);
new `tests/helpers/memoryTableStores.ts`; `tests/server/{tableStalls,persistedEnvelope,endMatchVote,commitMove,exchangeRearm,weakSeatTakeover,shutdownSeatLost}.test.ts`;
new `tests/server/activeGameStoreScan.test.ts`.
Blocked by: T1. Ordered with server-output tickets on `tableHandlers.ts`/`gamePersistence.ts`.
Definition of done:
- [ ] `activeGameStore.{load,list,write,remove}`; `persistence` deleted; `inRoomOrder` stays in `gamePersistence.ts` and wraps `store.write`/`store.remove`
- [ ] `tableHandlers.ts` imports neither `db` nor `shared/schema`
- [ ] `TableRoomPort` type exported from `server/store/activeGameStore.ts` (or `roomStore.ts`) naming the six roomStore methods the table runtime calls
- [ ] `useMemoryTableStores(t, {rooms, rows})` installs Map-backed mocks over `activeGameStore` and the `TableRoomPort` methods and returns the maps
- [ ] zero `mock.method(db…)` left under `tests/` (grep in the PR body); the `persistence.writeActiveGame` mocks use the twin or `activeGameStore.write`
- [ ] scan: only `server/store/*` and `server/game/retention.ts` import `activeGames` from `shared/schema`
Checks — while iterating: `node --test tests/server/tableStalls.test.ts tests/server/persistedEnvelope.test.ts tests/server/endMatchVote.test.ts`.
Before pushing: `node --test tests/server/*.test.ts`, `npm run agent:check`, integration
`restartConvergence`, `ownerLoss`, `takeoverSerialised`.

### T3 — Retention has one home, and pruning asks the cluster (M)
IDs: L-029, L-044, L-046, plus L-024's shared `purgeRooms`.
Files: `server/game/retention.ts`, `server/game/gamePersistence.ts` (prunes removed, sweeper calls
`sweepRetention` only), `server/store/roomStore.ts`, `server/http/deleteAccount.ts:38-44`,
`server/socket/ticket.ts:89`, `server/socket/lobbyIntents.ts:59-60`, `server/socket/socketRooms.ts:223-224`,
`tests/server/retentionOffWritePath.test.ts`, `tests/server/lobbyIntents.test.ts`,
`tests/integration/roomVisibility.test.ts:163`, new integration tests (§6).
Blocked by: T2 (both edit `gamePersistence.ts`). Ordered with server-output's **L-031** (lobby port;
same `createRoomIntent`/quickmatch lines) and http's `deleteAccount.ts` work if any.
Definition of done:
- [ ] `deleteInBatches` (ctid loop, `batch` and `maxBatches` parameters); every rule in `sweepRetention` uses it; integration test removes 12 001 aged rows in one sweep with `batch = 5_000`
- [ ] expired `socket_ticket_nonces` are pruned by the sweep; `redeemSocketTicket` issues no delete
- [ ] abandoned `active_games` and stale rooms are pruned from `retention.ts`; `pruneStaleRooms`' candidates exclude rooms with an `active_games` row touched within `STALE_ROOM_MAX_AGE_MS` (SQL), keeping the local filter; integration test red first
- [ ] `roomStore.purgeRooms(tx, ids)` is the one room_players → active_games → rooms order; `deleteAccount` and the stale-room prune both call it
- [ ] `retentionOffWritePath.test.ts` recognises `lt(col, new Date())` and asserts every age-based delete under `server/` is in `retention.ts`
- [ ] `createRoom(host, opts)` inserts the room and the host's seat 0 in one transaction; integration test with a failing seat insert leaves no room (red first); `addRoomPlayer`, `removeRoomPlayer` deleted
- [ ] `roomStore.ts` no longer imports `game/gameTimers`; callers pass `seatHoldMs()`
Checks — while iterating: `node --test tests/server/retentionOffWritePath.test.ts tests/server/lobbyIntents.test.ts`.
Before pushing: `npm run agent:check`; integration `staleRoomPrune`, `roomCreate`,
`roomVisibility`, `privacyRetention`, the account-deletion suite.

### T4 — Single writers for live tables and match fields (M)
IDs: L-032, L-036.
Files: `tests/server/tableOwnership.test.ts`, `server/socket/socketPresence.ts:88-103`, a game-layer
lookup (`heldRoundFor(userId)` beside `armTurnIfIdle` in `gameTurn.ts`, or in server-output's
seat-presence module if it has landed), new `server/game/matchLedger.ts`, `server/game/roundOver.ts`,
`server/game/tableHandlers.ts` (`:360,413,540,561`), `server/game/gameTurn.ts:325`,
`server/game/seatLedger.ts:58-62`, new `tests/helpers/fieldWrites.ts`, `tests/server/seatLedger.test.ts`,
new `tests/server/matchLedger.test.ts`.
Blocked by: T1, **#1628** (writes in `handleRoundOver`/vote gate), and server-output's
`tableHandlers.ts` split (L-025) — whichever order, never parallel.
Definition of done:
- [ ] `tableOwnership` scan lists files from the directory: no `activeGames` in any `server/socket/**` or `server/http/**` file; production `activeGames.set` only in `tableHandlers.ts` (2), `.delete/.clear` only in `gamePersistence.ts`; red first on `socketPresence.ts`
- [ ] `announcePresence` keeps its behaviour (the reconnect integration suite is unchanged) but resolves the grace-held round through the game-layer function
- [ ] `matchLedger.ts` is the only writer of the six match fields; `seatLedger.reclaim` carries a seat's score through `carrySeatScore`
- [ ] the seat-ledger scanner is extracted and drives both ledgers' scans; each scan has the "recognises every kind of write" self-test
Checks — while iterating: `node --test tests/server/matchLedger.test.ts tests/server/seatLedger.test.ts tests/server/tableOwnership.test.ts tests/server/roundEnd.test.ts`.
Before pushing: `node --test tests/server/*.test.ts`, `npm run agent:check`, integration `reconnect`, `rematch`, `endMatchVote`-related suites.

### T5 — DB and HTTP stall hygiene (M)
IDs: L-030, L-038, L-040, L-041, L-042, L-043.
Files: `server/http/routes.ts` (`:139-150` comment, `:982` level, `:1020` limiter),
`server/http/mail.ts`, `server/socket/push.ts`, `server/game/dealRound.ts:40-44`,
`server/http/serverErrors.ts`, `server/http/clientErrors.ts`, `server/http/admin.ts`,
`server/game/ratings.ts`, `server/store/schemaDdl.ts`, `tests/server/schemaDdl.test.ts`, small new tests.
Blocked by: nothing in this area; ordered with **http**'s `routes.ts` split (L-034).
Definition of done:
- [ ] login limiter comment states the per-instance ceiling (limit × instances, reset per deploy) and that bcrypt plus the per-IP limiter bound it; no "what makes a password hard to guess"
- [ ] both `fetch` calls pass `signal: AbortSignal.timeout(10_000)`; a test with a never-answering fetch resolves `sendMail` false; the Run-button sentence is gone
- [ ] `dealRound` does not await the status write; a test with a hanging `updateRoomStatus` still sees `game:started`
- [ ] the server-error recorder skips the insert while `pool.waitingCount > 0` (stderr line instead); client crash reports log at warn; bug reports have their own limiter instance
- [ ] error-group queries are windowed (7 days); `adminSnapshot` runs its queries in chunks of ≤ 4; `getCircleLeaderboard` reads every member's current-or-previous season row in one query (`DISTINCT ON (user_id) … season <= $1 ORDER BY user_id, season DESC`) with the same results (existing ladder tests)
- [ ] `ensureSchema` reads `information_schema.columns` and `pg_indexes` once and skips `ADD COLUMN` and `CREATE INDEX` (with its `DEDUPE_ON_BOOT` delete) that already exist; `schemaDdl.test.ts` covers the skip; integration: a second boot emits no `ALTER TABLE … ADD COLUMN`
Checks — while iterating: `node --test tests/server/schemaDdl.test.ts` and the new unit tests.
Before pushing: `npm run agent:check`; integration boot/schema suite and `tests/integration/shutdown.test.ts`
(boot path); CI `build` job boots on Node 22 (`AbortSignal.timeout` is in 22).

**Count:** 5 tickets, all M. Order: #1628 → T1 → T2 → T3; T4 after T1, #1628 and server-output's split; T5 any time.

## 9. Cross-area contracts

- **server-output** (L-025/L-026/L-035/L-037): we both edit `gamePersistence.ts`,
  `tableHandlers.ts`, `tableRouter.ts`. Contract: the identity guard (I1) stays inside
  `persistGameState` whatever wraps it — if `RoundOverWriters` folds into a deps object, its
  `persistGameState` is this one. When server-output's `createTableRuntime(deps)` lands, it takes
  `{ rooms: TableRoomPort, games: typeof activeGameStore }` from T2 — that is L-127's injection,
  delivered by them. The roomStore→`game/gameTimers` import (named in L-037) is removed by T3
  (L-046); server-output should not duplicate it. If server-output moves the output functions out of
  `gamePersistence.ts`, the remaining file *is* the lifecycle registry; renaming it `tableRegistry.ts`
  and moving `activeGames` from `gameRoom.ts` into it (alternative B's cheap half) is then a
  follow-up, not part of these tickets.
- **server-output L-031** (lobby port): edits `createRoomIntent` and quickmatch, as does T3 (L-046).
  Order them; T3 gives `createRoom(host, opts)`.
- **time**: `gameTimers.setClock` stays the clock every test here uses; T1 adds no clock. If time
  injects a clock into `shutdown`/`drainPool`, the `within()` budgets read it.
- **http** (L-034 routes split): T5 edits three sites in `routes.ts` — order.
- **test-harness**: `tests/helpers/memoryTableStores.ts` (T2) and `tests/helpers/fieldWrites.ts`
  (T4) are new helpers; L-136's socket-driving half of `ladderAndReplay` is theirs once L-026 lands.
- **Open tickets**: #1628 edits `gameTimers.ts`, `handleRoundOver`, `rehydrateGame`,
  `disposeClearsTimers.test.ts` — T1 and T4 are blocked by it; its new vote kind is cleared by
  `stopTables` through `clearRoomTimers` with no extra work. #1639 is client-only
  (`app/game.tsx`, `components/table/*`) — no overlap. #1624 (in progress, client gates) — no
  server-runtime file in common.

## 10. Owner decisions needed

1. **L-030 — accept per-instance login limits.** Recommendation: accept "10 attempts per username
   per 15 min *per instance*, reset on deploy", stated at the limiter (each guess still pays bcrypt
   and the per-IP limiter). The alternative, a Postgres-backed store for the auth limiters, adds a
   write per login attempt and needs a fail-open/fail-closed choice during a DB outage. This is a
   security-posture acceptance, so it is listed here; T5 implements the recommendation unless
   overturned.

Decided here (technical, recorded for review): at shutdown the ownership locks now drop *after* the
pool drain, so in a degraded shutdown another instance waits up to 6 s longer to take a table over;
in exchange no row is ever written after its lock is gone. A rejoin that lands inside a dispose's
release window is refused (`TABLE_UNREACHABLE` after the router's retries) instead of resurrecting
the table.
