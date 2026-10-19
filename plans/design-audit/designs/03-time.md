# 03 — Time: Clock, randomness and config injection

Area IDs: L-019, L-020, L-021, L-135. All line numbers are at MAIN (`a1d0ebb5`).

## 1. Summary

- **Now:** the server reads four things that live outside the process: wall time, randomness, `MURLAN_*` config and `DATABASE_URL`. Each module reads them whenever it happens to load or run. One `Clock` exists, but it only covers the five keyed timers. About 30 other sites call `Date.now()` / `new Date()`. The deal reads `globalThis.crypto`, so tests patch the global. `server/store/db.ts`, `routes.ts`'s limiters, `socketGameplay.ts` and `session.ts` read env at import, so tests have to import the server dynamically, in the right order.
- **After:**
  - One ambient clock (`server/clock.ts`) that every server time read goes through. Pure deciders take `now` with no default.
  - A `random` argument on the engine's deal.
  - A database that boot opens and shutdown closes (`openDatabase`/`db()`/`closeDatabase`).
  - Config read when it is used, never at import.
  - The test harness hands out its `db`/`query`, installs a clock, and waits on acks instead of sleeping.
- **Why:** all four entries are one wrong shape: *ambient input frozen or read at an arbitrary moment*. Making each one read at a single, named place fixes the two-clock exchange bug class and the ESM-hoisting class. It also deletes the global `crypto` patches, the ordering comments, ~28 ad-hoc pools and ~119 dynamic imports.

## 2. Current shape (evidence at MAIN)

**Clock (L-019)**
- `server/game/gameTimers.ts:12-33` defines `Clock`, `realClock`, `setClock` and `now()`. Its users are `arm` (:53,58), `secondsUntil` (:150) and `gameTurn.ts:158` (`turnDeadlineMs`).
- Only two test files ever install a fake: `tests/server/gameTimers.test.ts:11-25` and `tests/server/openingGrace.test.ts:19-74`, using `tests/helpers/fakeClock.ts`.
- These sites still read wall time directly:
  - `onlineGameLogic.ts:95` and `:124` default `now = Date.now()` for `markExchangeSettled` / `visibleExchangePhase`. Their only production caller passes no `now`: `gamePersistence.ts:86-89` and `:219`. Under a fake clock, `turnSecondsRemaining` (fake) and the `cardToLoser` ceremony window (real) disagree.
  - Seat holds: `roomStore.ts:260` and `:297` use `now: Date.now()`. The invite `created_at` the hold is measured from is stamped by **Postgres** (`friendStore.ts:207-212`, `schema.ts` `defaultNow()`), so a hold compares two different clocks. `socketTable.ts:65` (`expiresInMs`) is a third read. As a result `tests/integration/seatHold.test.ts:161-162` sets the hold to 1 ms and really sleeps, and `:199-227` sleeps 2×600 ms.
  - Elsewhere:
    - `tableRouter.ts:87,109`: idempotency TTL.
    - `socketSafety.ts:120`: rate windows.
    - `roundOver.ts:101`: `finishedAt`, which keys the rating season.
    - `gamePersistence.ts:130,270,293`.
    - `stats.ts:91,104,207`, `ratings.ts:185`.
    - `routes.ts:913,935,941`, `admin.ts:257`.
    - `authTokens.ts:48,103`, `ticket.ts:43,68,89`.
    - `push.ts:55,58`, `userStore.ts:126,197,204`, `socketPresence.ts:162`.
  - Real-I/O waits that must stay on real time: `drainPool.ts:35-46` and `socketAdapter.ts:78-127`.
- The state-ack resend is Socket.IO's own `.timeout()` (`gamePersistence.ts:198`). It is transport, not ours.

**Database and config at import (L-020)**
- `server/store/db.ts:45-58` builds `POOL_MAX`, `pool` and `db` at module scope. `pool.ts:5` reads `process.env.DATABASE_URL` when that runs.
- 24 server modules import it, with 124 `db.`/`pool.` uses. `session.ts:3,21-27` builds the session store from `pool` and `SESSION_SECRET` at import.
- Other config read at import:
  - `routes.ts`: 13 `routeLimiter({... envVar})` calls at module scope (e.g. `:89-94`), and `rateLimit.ts:32` says "Read when the limiter is built".
  - `socketGameplay.ts:39-43` (`GAME_ACTION_RATE_LIMIT`).
- Consequences in the tests:
  - `tests/helpers/testServer.ts:4-6,17-88` must set nine env vars "before anything imports" the server. `:170-195` repoints `DATABASE_URL`, then dynamic-imports `app.ts` and `db.ts`.
  - There are 119 `await import("../../server…")` calls in 37 integration/soak/helper files. One example is `stats.test.ts:398-402`, whose comment explains the ordering.
  - 28 test files build their own `new pg.Pool({connectionString: process.env.DATABASE_URL})`, e.g. `abandonedGames.test.ts:32`.
  - `auth.test.ts:8-14`, `schemaBootstrap.test.ts:13-16` and `soak/replay.ts:81-85` each document "a second `startTestServer` in one process fails on the ended pool".
- `timerEnvIsLive.test.ts` pins per-call reads for the timers only, by regex over `gameTimers.ts`. `tests/server/testOnlyEnv.test.ts:58-83` scans for bare `process.env.MURLAN_*`, but not for *when* the read happens.
- Already right: `socketAdapter.ts:151-167` (pool built in `createSocketAdapter()` at boot) and `gameOwnership.ts:85` (client built per call).

**Randomness (L-021)**
- `lib/game/gameEngine.ts:225-263`: `getRandomSource()` reads `globalThis.crypto` inside `randomBelow`, and `shuffleDeck`/`dealCards` (:283) take no source.
- Workarounds that grew into the interface:
  - `initializeGame(setup, mode, firstSeat, dealt?)` with validation at `:1124-1137`.
  - `initializeRematch(..., firstSeat, dealtHands?)` at `:860-873`, which has **no** validation.
- Global patches:
  - `tests/helpers/offlineMatch.ts:96-118` (`withSeededDeals`, `defineProperty` on `globalThis.crypto`), used by `:359` and `scripts/measureHeadsUpBalance.ts:122,292,421`.
  - `tests/e2e/helpers/seededRandomness.ts:9-25` and `tests/e2e/exchangeAttribution.spec.ts:243` patch the browser's `crypto` (and `Math.random`).
- `tests/native/setup.ts` no longer patches crypto (checked).
- The bot already takes `rng` (`bot.ts:228`, `autoMove.ts:63-67`).
- Server deal sites: `tableState.ts:139-141` and `tableHandlers.ts:380-383`.
- In-process tests rig a deal through `tests/helpers/liveGame.ts:44-79` (`redealExactly`, via `initializeGame(..., 0, dealt)`).
- `tests/integration/gameplay.test.ts:181-200` loops up to 20 rounds to reach an exchange. It explicitly refuses a production deal seam: "no test is worth putting that seam within reach of production".

**Fixed sleeps (L-135)**
- Every inbound event goes through `onEvent` (`socketSafety.ts:178-200`). That function runs one socket's intents in order (`intentQueue`, :202) and acks each exactly once with an `IntentReply`, even on `RATE_LIMITED`. So an ack is a usable synchronisation point, and an ack on a second intent from the same socket proves the earlier ones finished.
- Tests still sleep instead:
  - `gameInviteOutlives.test.ts`: 10 sleeps (e.g. :77,88,139,143).
  - `spectator.test.ts`: 7 (e.g. :164,214,240,250, which are negative waits).
  - `seatHold.test.ts`: 3 (time passage).
  - Others with 2-5 each.
- `tests/helpers/client.ts:207-223` has `waitFor`/`waitForOrNull`, but nothing for "the server finished my intent" or "nothing arrived".
- Correction from verify: `socketPresence.ts:52-57` and `socketSafety.ts:184-197` are the ack plumbing that makes this possible, not sleeps.

## 3. Alternatives considered

### Clock

| | A. Ambient clock module (pick) | B. `clock` in `TableDeps` / `createApp({clock})` | C. Leave in `gameTimers`, only fix the defaults |
|---|---|---|---|
| Shape | `server/clock.ts`: `now()`, `clock()`, `installClock()`. Pure deciders take `now: number` with **no default**. | Threaded through deps | `setClock` stays in `gameTimers`; edges pass `now()` |
| Reach | Every server module, stores included | Only what `TableDeps` reaches. `roomStore`, `friendStore`, `socketSafety` and `tableRouter` sit outside it. | Same as A, but store → `game/` imports grow (F13 smell) |
| Consistency | The timer map in `gameTimers` is already process-global, so an ambient clock matches it | A DI clock over a global timer map is two models | Same as A |
| Tests | `installClock(fake)` reaches the in-process integration server too | Integration tests can't reach deps built inside `createApp` without a new option | Same as A |
| Adapters | real, `fakeClock` (manual), `skewedClock` (real timers, movable `now`): all used | `TableDeps.clock` would be a one-adapter duplicate of the ambient one | — |

**Pick A.** C is A minus the move. The move costs one file and stops the store layer importing `game/gameTimers` for time. B depends on a seam (F1) that does not exist at MAIN (`grep TableDeps` finds nothing) and would not cover the stores. **Removing the `= Date.now()` defaults** is what makes A enforceable: `tsc` names every caller that forgets.

### Database and config

| | A. Full DI: `createDb(url)` threaded to 24 modules | B. Boot-owned singleton behind accessors (pick) | C. Keep import-time pool; a `node --import` preload sets a per-process schema URL |
|---|---|---|---|
| Server change | Every store/route signature | `db.x` → `db().x` (124 mechanical sites); `openDatabase` in `createApp`, `closeDatabase` in shutdown | None |
| Fixes the class | Yes | Yes. Nothing reads env at import, which a behavioural test can then pin. | No. A new import-time read works only if the preload happens to set its var. A check would have to exempt `db.ts`, the thing it checks. |
| N servers per process | Yes | Sequential boots yes. Concurrent no, but multi-instance tests already use child processes (`crossInstance`, `ownerLoss`, `restartConvergence`), and `activeGames`/timers are process-global anyway. | No |
| Risk | High, wide | Medium, mechanical, `tsc`-guided | Low, but hidden coupling to the test runner flags |

**Pick B.** A buys concurrency the process model can't use. C keeps the defect and needs a self-exempting check. Within B, an `export let db` live binding (zero call-site edits) was rejected: tests destructure it (`const { db } = await import(...)`), which captures the value and goes stale across a restart. `db()` cannot go stale. A lazy `Proxy` was rejected because drizzle's node-postgres session checks `client instanceof Pool`.

For config, the alternative to "read at use" is `createApp({timeouts, limits})` (tests T8). That needs a second transport parallel to `testOnlyEnv`, which is the production guard (`testOnlyEnv.ts:5-20`). Per-use reads keep env as the one transport and make write order irrelevant. **Pick per-use.** express-rate-limit 8 accepts `limit: (req, res) => number`.

### Randomness

| | A. `random` argument on the engine's deal (pick) | B. Installable process-global source (`setRandomSource`) | C. Server deal port (`TableDeps.deal`) |
|---|---|---|---|
| Purity | Engine stays pure. The seed is an argument. | Ambient, so a forgotten restore leaks | — |
| Reaches | Node tests, scripts, offline sims | Also the in-process server | The server |
| Browser e2e | Still the global `crypto` patch (fix_ok: a parameter can't reach the bundle). `cryptoRandom` reads `globalThis.crypto` per call, so that patch keeps working. | Same | Same |
| Recorded stance | Fine | Puts a deal rig within reach of production | Contradicts `gameplay.test.ts:187-191` |

**Pick A, with no server deal seam.** In-process tests that need a specific deal already have a test-side rig that production can't reach (`liveGame.redealExactly`). It gains a rematch variant so an exchange can be dealt directly. The source shape stays `{ getRandomValues(Uint32Array) }` and not the bot's `() => number`: the deal does rejection sampling over uint32 (`gameEngine.ts:237-255`), and `globalThis.crypto` is then an adapter with no wrapper.

## 4. Target design

### 4.1 `server/clock.ts` (new; replaces `gameTimers.ts:12-33`)

```ts
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export const realClock: Clock;
/** Epoch ms on the installed clock. The only wall-time read in server/ outside the I/O-wait allowlist. */
export function now(): number;
/** For gameTimers' arm/clear only. */
export function clock(): Clock;
/** Installs `next` process-wide and returns the restore. Tests call the restore in `after`/`t.after`. */
export function installClock(next: Clock): () => void;
```

- `gameTimers.ts` drops `Clock`, `realClock`, `setClock` and `now`, and imports `clock()`/`now()` instead.
- `onlineGameLogic.markExchangeSettled(phase, now: number)` and `visibleExchangePhase(phase, viewer, now: number)` lose their defaults.
- `gamePersistence.sanitizeStateForPlayer` and `broadcastGameState` pass `now()`.
- `roomStore.claimRoomSeat`/`getRoomSeatHolds` use `now()`. `friendStore.ts:207-212` inserts `createdAt: new Date(now())`, and the on-conflict path still leaves it alone.
- `socketTable.ts:65`, `tableRouter.ts:87,109`, `socketSafety.ts:120` and every `new Date()` listed in §2 become `now()` / `new Date(now())`. A local variable named `now` is renamed so it doesn't shadow the import.

**Invariants**
- A timestamp compared against the Clock is written from the Clock, never from Postgres `now()`/`defaultNow()`. The seat-hold `created_at` is the one such pair today.
- Real-I/O polling (`drainPool.ts`, `socketAdapter.ts` subscription wait, `shutdown.ts`'s force-exit timer) stays on real time. A fake clock there would spin forever.
- `installClock` changes `now()` for timers already armed. `fakeClock` timers fire only on `advance`. `skewedClock` moves `now()` but leaves armed real timers on their real schedule, so a test needing "a timer fired" still shortens its timeout through env.

**Test adapters** in `tests/helpers/fakeClock.ts`:
```ts
export function fakeClock(startMs?: number): FakeClock;      // existing; manual timers
export function skewedClock(): Clock & { skip(ms: number): void }; // real timers, now() = Date.now() + skew
```
`startTestServer({ clock?: Clock })` installs it before `createApp` and restores it in `stop()`.

### 4.2 `server/store/db.ts`

```ts
export type Db = NodePgDatabase<typeof schema>;
export const QUERY_TIMEOUT_MS = 5_000;
export function resolvePoolMax(raw: string | undefined): number;      // unchanged
/** Reads DATABASE_URL and MURLAN_PG_POOL_MAX now. Returns the open one if already open. */
export function openDatabase(): { db: Db; pool: Pool };
/** Throws `Error("database not open: openDatabase() runs in createApp")` before open. */
export function db(): Db;
export function pool(): Pool;
/** Ends the pool and forgets it, so a later openDatabase() reads the env again. */
export async function closeDatabase(): Promise<void>;
```

- `createApp()` calls `openDatabase()` first, then `createSessionMiddleware(pool())` (`session.ts` becomes a factory that reads `SESSION_SECRET`/`NODE_ENV` at call).
- `shutdown.ts` keeps its drain policy and calls `closeDatabase()` where it calls `pool.end()` today. `testServer.stop()` does the same.
- `scripts/reset-password.mjs` and any other non-boot user calls `openDatabase()` itself.

**Config read at use**
- `routeLimiter` passes `limit: () => maxFrom(envVar, defaultMax)`.
- `socketGameplay` reads `gameActionLimit()` per event.
- The rule after this change: **no server module reads `process.env` while it is being imported.** The one exception is `NODE_ENV` in `logger.ts`, fixed per process.

**Harness**
```ts
interface TestServer {
  url, port, schema, io, httpServer;
  db: Db; query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]>;
  stop(): Promise<void>;
}
```
`query` runs on the app pool. A suite that keeps querying after `stop()` (shutdown tests) keeps its own pool.

### 4.3 Engine randomness (`lib/game/gameEngine.ts`)

```ts
export type RandomSource = { getRandomValues(array: Uint32Array): Uint32Array };
/** globalThis.crypto, read per call (the e2e browser patch relies on that); Math.random last resort. */
export const cryptoRandom: RandomSource;
export function shuffleDeck(deck: Card[], random?: RandomSource): Card[];
export function dealCards(playerCount: number, firstSeat?: number, random?: RandomSource): { hands: Card[][]; excluded: Card[] };
export interface DealOptions { firstSeat?: number; random?: RandomSource; dealt?: Card[][] }
export function initializeGame(setup: SeatSetup[], mode: GameMode, deal?: DealOptions): GameState;
export function initializeRematch(setup: SeatSetup[], mode: GameMode, prevFinishingOrder: string[], deal?: DealOptions): GameState;
```

- One private `handsFor(setup, deal)` does the `dealt` validation (seat count, no duplicate card) for **both** initialisers. `initializeRematch` has none today.
- `random` is ignored when `dealt` is given.
- Errors: same messages as `gameEngine.ts:1128,1133`.
- Deleted: `withSeededDeals` (offlineMatch :88-118) and its `crypto` `defineProperty`.
- New `tests/helpers/seededRandom.ts`: `seededRandom(seed): RandomSource` (mulberry32), used by `offlineMatch.ts` and `measureHeadsUpBalance.ts`.
- `redealExactly(io, roomId, hands, { prevFinishingOrder? })` deals through `initializeRematch` when given, so a test can deal an exchange.
- What stays global: the two e2e browser patches. They are the only adapter able to reach code running in the page.

### 4.4 Waiting on the protocol (`tests/helpers/client.ts`)

```ts
/** Resolves once the server has run every intent this socket sent before it, and delivered everything it emitted to this socket meanwhile. */
export function settled(socket: Socket): Promise<void>;          // emitWithAck("friend:get_online_list"); any reply, RATE_LIMITED included
/** Runs `act` (awaiting its ack if it returns one), then settles `watcher`; fails if `event` reached `watcher` in between. */
export function nothingArrives(watcher: Socket, event: string, act: () => unknown): Promise<void>;
```

- **Covers:** emits the server made before the acting intent's ack. In-process the adapter delivers local broadcasts synchronously.
- **Does not cover:** work a handler fires and forgets after returning. A test that depends on such work keeps a bounded `waitFor`.

## 5. Migration (each step leaves main green)

1. **T1: one server clock.**
   - Add the red test first, then:
     - add `server/clock.ts`;
     - move the `Clock` out of `gameTimers`;
     - drop the defaults;
     - route every listed time read through `now()`;
     - stamp invite `created_at` from the clock;
     - add `skewedClock` and `startTestServer({clock})`;
     - move `seatHold.test.ts` to `skewedClock`;
     - add a clock scan.
   - Deletes: `setClock`, the two `= Date.now()` defaults, three real sleeps in `seatHold`.
2. **T3: deal randomness as an argument** (parallel with T1).
   - Change the engine signatures and every caller (`tsc` finds them).
   - Add `seededRandom`, delete `withSeededDeals`.
   - Give `redealExactly` a rematch variant.
   - In `gameplay.test.ts`, replace the 20-round loop with a dealt rematch and drop its raised `MURLAN_GAME_ACTION_RATE_LIMIT`.
   - Deletes: the Node `crypto` patch and `initializeRematch`'s unvalidated `dealtHands`.
3. **T2a: harness hands out its database; limits read at use.**
   - `TestServer.db`/`query`.
   - Replace the 28 ad-hoc `new pg.Pool` with `server.query`/`server.db`; the exceptions are `testServer.ts`'s own admin/cleanup pools and suites querying after `stop()`.
   - Per-request `limit`.
   - `socketGameplay` reads per call.
   - Deletes: the ad-hoc pools, and the "set before routes.ts is imported" ordering text in `testServer.ts:29-71`.
4. **T2b: boot-owned database.**
   - `openDatabase`/`db()`/`pool()`/`closeDatabase`, `createSessionMiddleware`.
   - Update all 24 server importers and every test importer.
   - Convert dynamic server imports in tests to static ones.
   - Add the import-time env test, and trim `timerEnvIsLive`'s module-scope regex section (subsumed).
   - Deletes: ~119 dynamic imports (those that existed for ordering), the "second server in one process fails" comments and workarounds (`replay.ts` `existing?` parameter purpose, `auth.test.ts:8-14`, `schemaBootstrap.test.ts:13-16`), and `testServer.ts:4-6,17-20`.
5. **T4: sleeps become acks.**
   - Add `settled`/`nothingArrives`.
   - Convert `gameInviteOutlives`, `spectator`, and the remaining same-process sleeps in `lobbyGrace`, `reconnect` and `sessionReplaced`.
   - Add an inventory test that pins each file's remaining bare-sleep count exactly.

## 6. No-regression strategy

**T1**
- *Red first:* `tests/server/exchangeClock.test.ts`.
  - Steps: install `fakeClock`, build a game whose exchange just closed, call `broadcastGameState` with a recording io, `advance(exchangeAnnounceMs(false) + 1)`, then `sanitizeStateForPlayer` for a non-participant and for the loser.
  - Expected: `cardToLoser` is gone for the loser too.
  - Red at MAIN, because the ceremony is measured on real `Date.now()` and has not elapsed.
- *Red first:* in `seatHold.test.ts`, the re-invite case under `skewedClock` must fail if `friendStore` restamps `created_at`. Prove the power once by temporarily restamping in the PR's red commit.
- Existing pins that must stay green: `exchangeVisibility.test.ts` (explicit `now` arguments; they now must be passed), `gameTimers.test.ts`, `openingGrace.test.ts` (import moves), `seatAllocation.test.ts`.
- *New scan* `tests/tooling/serverReadsOneClock.test.ts`:
  - No `Date.now()` or argument-less `new Date()` under `server/` outside `server/clock.ts` and an allowlist (`store/drainPool.ts`, `socket/socketAdapter.ts`), each with its reason.
  - Floor: `clock.ts` must itself contain the read, and every allowlisted file must still contain one (no stale exemption).

**T3**
- `tests/engine/deal.test.ts` gains:
  - `dealCards(n, s, seededRandom(1))` is identical across two calls;
  - `initializeRematch` with a duplicate card throws (red: no validation today);
  - `cryptoRandom` reads `globalThis.crypto` per call (the e2e dependency): swap the global inside the test and observe the change.
- Offline match simulations (`tests/helpers/offlineMatch.ts` users) keep their seeds' outcomes. The stream changes from patched-crypto to an argument, but it is the same mulberry32 consumed the same way. Pin with the existing seed-outcome assertions, run before and after.
- The e2e specs using `seedRandomness` are unchanged, so CI e2e is the check that the browser path still works.

**T2a / T2b**
- *Before the move*, add `tests/integration/twoServersOneProcess.test.ts` (red at MAIN): `startTestServer()`, `stop()`, `startTestServer()` again, register a user. Today this fails on the ended pool.
- *New* `tests/server/noEnvReadAtImport.test.ts` (T2b):
  - Steps: replace `process.env` with a recording Proxy, then dynamically import `server/app.ts` (the whole graph). Assert that no key other than `NODE_ENV` was read during the import.
  - Floor: after the import, call `afkTimeoutMs()` and `maxFrom("MURLAN_AUTH_RATE_LIMIT", 1)` and assert that the recorder saw both reads.
  - This is behavioural, so it also catches transitive reads, e.g. a module-scope `routeLimiter` → `maxFrom` → `testOnlyEnv`.
- Remaining checks:
  - `serverLoadable.test.ts:59-75` (pool options) now calls `openDatabase()`.
  - `poolConfig.test.ts` and `shutdownBudget.test.ts` are unchanged in substance.
  - `testOnlyEnv.test.ts` stays.
  - `tsc` finds every `db.` → `db()` miss.
  - The whole integration suite (`DATABASE_URL` from dev-stack) is the gate for T2a and T2b.

**T4**
- Each converted sleep keeps its assertion. A negative wait converted to `nothingArrives` must be shown to fail when the forbidden emit is injected: the red commit temporarily emits to the watcher.
- The inventory test fails on a new bare `setTimeout(r…, N)` in `tests/integration/*.test.ts` and also on a removed one whose count was not lowered. The count is exact, so the list can neither drift loose nor be satisfied by silence.

**Layout:** none of this touches rendering. `tests/e2e/` is relevant only for T3 (the browser `crypto` patch path).

## 7. Coverage table

| ID | covered by | note |
|---|---|---|
| L-019 | T1 (clock), T3 (deal) | Clock is ambient in `server/clock.ts`, not in `TableDeps`: the seat-hold, router and rate sites are outside any `TableDeps`, and F1 does not exist at MAIN. The deal half is test-side (`redealExactly` rematch variant) per the recorded stance in `gameplay.test.ts:187-191`. The state-ack resend stays on Socket.IO's own timer (transport). Priority per verify: P2. |
| L-020 | T2a, T2b | Module is `server/store/db.ts` (verify correction). Config-at-import (`routes.ts` limiters, `socketGameplay.ts:39-43`, `session.ts`) is the same class and is included. "N servers in one process" is delivered as *sequential*; concurrent servers go through child processes, as today. |
| L-021 | T3 | fix_ok concern honoured: the e2e browser patches stay and are the only global patches left. `tests/native/setup.ts` no longer patches crypto at MAIN, so nothing to do there. `lib/e2eOpener.ts` re-deal loop is left (iOS flows; out of scope). |
| L-135 | T4 (acks), T1 (time-passage sleeps) | Verify correction: the cited `socketPresence.ts`/`socketSafety.ts` lines are the ack plumbing used, not sleeps. Multi-process suites (`restartConvergence`, `crossInstance`, `postgresRestart`, `ownerLoss`, `ownershipReclaim`) keep their sleeps in the inventory. |

## 8. Proposed tickets

### T1: One server clock: every time read goes through `server/clock.ts` (size M)
- **Files:**
  - New: `server/clock.ts`, `tests/server/exchangeClock.test.ts`, `tests/tooling/serverReadsOneClock.test.ts`.
  - Game: `server/game/{gameTimers,gameTurn,onlineGameLogic,gamePersistence,roundOver,stats,ratings,tableRouter}.ts`.
  - Store: `server/store/{roomStore,friendStore,userStore}.ts`.
  - Socket: `server/socket/{socketTable,socketSafety,socketPresence,ticket,push}.ts`.
  - HTTP: `server/http/{routes,admin,authTokens}.ts`.
  - Tests: `tests/helpers/{fakeClock,testServer}.ts`, `tests/server/{gameTimers,openingGrace,exchangeVisibility}.test.ts`, `tests/integration/seatHold.test.ts`.
- **Blocked by:** none within this area. Cross-area: order after any server-runtime ticket that edits `gamePersistence.ts`'s broadcast/sanitize, or have it rebase. Order relative to the test-harness ticket that edits `testServer.ts`.
- **DoD:**
  - [ ] `exchangeClock.test.ts` is red on its first commit and green at the end.
  - [ ] `markExchangeSettled`/`visibleExchangePhase` take `now: number` with no default.
  - [ ] `setClock` gone; `installClock` returns its restore.
  - [ ] Invite `created_at` is written from `now()`, and `seatHold.test.ts` uses `skewedClock` with no real sleep.
  - [ ] `serverReadsOneClock` scan, with its floor, passes.
  - [ ] `startTestServer({clock})` installs the clock and restores it on `stop()`.
- **Checks:** while iterating, `node --test tests/server/exchangeClock.test.ts tests/server/gameTimers.test.ts tests/tooling/serverReadsOneClock.test.ts`. Before pushing: `npx tsc --noEmit`, then `seatHold`, `gameplay` and `turnDeadline` under `tests/integration` with `DATABASE_URL`.

### T3: The deal takes its randomness as an argument (size M)
- **Files:**
  - Engine and app: `lib/game/gameEngine.ts`, `context/GameContext.tsx`, `lib/e2eOpener.ts`, `lib/diagnostics/benchTable.ts`.
  - Server: `server/game/{tableState,tableHandlers}.ts` (options form only).
  - Test helpers and scripts: `tests/helpers/{offlineMatch,seededRandom(new),liveGame}.ts`, `tests/soak/replay.ts`, `scripts/measureHeadsUpBalance.ts`.
  - Tests: `tests/engine/{deal,exchange,flow}.test.ts`, `tests/bots/*` callers, `tests/native/helpers/botRound.ts`, `tests/integration/gameplay.test.ts`.
- **Blocked by:** engine-area tickets that change `initializeGame`/`initializeRematch` or `gameEngine.ts:225-300`.
- **DoD:**
  - [ ] `DealOptions` signatures as in §4.3.
  - [ ] `withSeededDeals` deleted; no Node-side write to `globalThis.crypto` remains in `tests/` or `scripts/` (grep).
  - [ ] `initializeRematch` validates `dealt` (red test first).
  - [ ] `redealExactly` can deal a rematch.
  - [ ] `gameplay.test.ts`'s exchange case reaches the exchange through it, with no round loop and no raised action limit.
  - [ ] e2e `seedRandomness` unchanged and still effective.
- **Checks:** while iterating, `node --test tests/engine/deal.test.ts tests/engine/exchange.test.ts`. Before pushing: `npx tsc --noEmit`, `npm test`, and `gameplay.test.ts` with `DATABASE_URL`.

### T2a: The test server hands out its database; rate limits are read when used (size M)
- **Files:**
  - Server: `server/http/{rateLimit,routes}.ts`, `server/socket/socketGameplay.ts`.
  - Tests: `tests/helpers/testServer.ts` and the 28 test files with `new pg.Pool` (list: `grep -rl "new pg.Pool" tests`).
- **Blocked by:** T1 (`testServer.ts`, `routes.ts`).
- **DoD:**
  - [ ] `TestServer.db` and `.query` exist.
  - [ ] Every `new pg.Pool` in tests is replaced, except `testServer.ts`'s admin/cleanup pools and suites that query after `stop()`. Each kept one carries a one-line reason.
  - [ ] `routeLimiter` reads `limit` per request.
  - [ ] `socketGameplay` reads its limit per event.
  - [ ] A test sets `MURLAN_AUTH_RATE_LIMIT` *after* importing `routes.ts` and sees it applied.
- **Checks:** while iterating, `node --test tests/server/testOnlyEnv.test.ts tests/server/rateLimiterFactory.test.ts`. Before pushing: the whole `tests/integration` suite with `DATABASE_URL`, and `tsc`.

### T2b: Boot opens the database; nothing reads env at import (size M)
- **Files:**
  - Server: `server/store/db.ts`, `server/app.ts`, `server/http/{session,shutdown}.ts`, and every importer of `store/db.ts` (24; list in §2).
  - Scripts: `scripts/reset-password.mjs`.
  - Tests: every test importer of `db`/`pool` (34) and every integration file with an ordering-only dynamic server import.
  - New: `tests/server/noEnvReadAtImport.test.ts`, `tests/integration/twoServersOneProcess.test.ts`.
  - Also: `tests/tooling/timerEnvIsLive.test.ts`.
- **Blocked by:** T2a, T3 (`gameplay.test.ts`, `liveGame.ts`).
- **DoD:**
  - [ ] `twoServersOneProcess` red first, then green.
  - [ ] `db()`/`pool()` throw a named error before `openDatabase()`.
  - [ ] Shutdown and `stop()` both close through `closeDatabase()`.
  - [ ] `noEnvReadAtImport` passes, with its floor.
  - [ ] No integration test dynamic-imports a server module for ordering. Remaining dynamic imports, if any, carry a reason.
  - [ ] The ordering comments in `testServer.ts`, `stats.test.ts`, `auth.test.ts`, `schemaBootstrap.test.ts` and `replay.ts` are gone.
- **Checks:** while iterating, `node --test tests/server/noEnvReadAtImport.test.ts tests/server/serverLoadable.test.ts`. Before pushing: `tsc`, the whole integration suite, and `npm run agent:check`.

### T4: Integration tests wait on acks, not fixed sleeps (size S)
- **Files:** `tests/helpers/client.ts`, `tests/integration/{gameInviteOutlives,spectator,lobbyGrace,reconnect,sessionReplaced}.test.ts`, new `tests/tooling/integrationSleepInventory.test.ts`.
- **Blocked by:** T1 (clock for time-passage waits), T2b (same test files).
- **DoD:**
  - [ ] `settled`/`nothingArrives` exist with the contract in §4.4.
  - [ ] Every sleep in the listed files is converted, or kept with a reason in the inventory.
  - [ ] Each converted negative wait is proved to fail by an injected emit in the red commit.
  - [ ] The inventory pins exact per-file counts, including the multi-process suites.
- **Checks:** while iterating, the listed files with `DATABASE_URL`. Before pushing: the whole integration suite twice, then `CI=1` once (memory: verify under the failing condition).

**Count:** 5 tickets: 4 M, 1 S. T1 and T3 run in parallel; T2a waits on T1; T2b waits on T2a and T3; T4 waits on T1 and T2b.

## 9. Cross-area contracts

- **server-runtime:**
  - The clock is `server/clock.ts`'s `now()`/`clock()`, not a `TableDeps` field. Any new timer (e.g. #1628's 30 s next-round vote deadline, #1639's bot callbacks) arms through `gameTimers.arm`, so it runs on the Clock.
  - Any new time read uses `now()`; T1's scan enforces this.
  - If F1/`TableDeps` lands, it must not add a `clock` or `deal` member.
  - Files I touch that they may too: `gamePersistence.ts` (sanitize/broadcast), `tableHandlers.ts:380-383`, `tableState.ts:139-141`, `roundOver.ts:101`, `tableRouter.ts:87,109`.
- **test-harness:**
  - From T1: `startTestServer({ clock })`.
  - From T2a: `TestServer.db`/`query`.
  - From T2b: static imports are safe, and sequential boots in one process work.
  - From T4: `settled`/`nothingArrives` in `client.ts`.
  - `fakeClock`/`skewedClock` live in `tests/helpers/fakeClock.ts`; `seededRandom` in `tests/helpers/seededRandom.ts`.
  - If test-harness restructures `testServer.ts` (merging the harness trio), it goes after T2b, or T2a/T2b absorb it. Never in parallel.
- **engine:** T3 changes the `initializeGame`/`initializeRematch`/`dealCards` signatures (`DealOptions`). An engine ticket editing those functions must be ordered with T3.
- **static-checks:** T1, T2b and T4 add three scans (`serverReadsOneClock`, `noEnvReadAtImport`, `integrationSleepInventory`). Each has a floor. They should use `tests/helpers/sourceScan.ts` if static-checks standardises on it.
- **client / table-ui:** none. The client's own clocks (e2e `virtualClock`) are out of scope.
- **loop:** none.

## 10. Owner decisions needed

None blocking. Two calls I made from the records, which the owner may overturn:

1. **No server-side deal seam.** I followed the stance written at `tests/integration/gameplay.test.ts:187-191` (not an ADR). Exchange tests rig the deal through the test-only `redealExactly`. If the owner wants seeded server deals (e.g. so a soak seed reproduces its deals), T3 would add an installable source that refuses under `NODE_ENV=production`. That is a decision to record in `docs/adr/`.
2. **Rate limits are read per request instead of once per limiter build.** This reverses the comment at `rateLimit.ts:32`. The only effect in production is a `process.env` lookup per limited request: `testOnlyEnv` still returns `undefined` for these keys in production.
