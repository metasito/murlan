# 09 — Test harness: renderApp, fixtures, test speed, test correctness

Area IDs: L-118, L-119, L-121, L-123, L-124, L-126, L-133, L-137, L-140, L-142, L-147, L-148, L-150,
L-154, L-157, L-159, L-160, L-163, L-168, L-169, L-172, L-173. All lines below were re-checked at MAIN
`a1d0ebb5`.

## 1. Summary

- **Now:** every tier fakes its own I/O by hand, one file at a time. Native tests replace whole app
  modules (97 `@/context/*` mocks, 46 `@/lib/accessibility`, 11 RN-private `useWindowDimensions`, 11
  netinfo, 9 `@/lib/socket`, 19 `@/lib/query-client`). Integration helpers re-declare the wire types
  (8 copies, already drifted). E2E specs hand-write the offline save (11 copies). Card, seat and state
  builders are copied per tier (45 card builders, 63 seat builders, 5 `mulberry32` copies).
- **After:** each tier gets **one fake per I/O edge, at the vendor boundary**, and one fixture home.
  Native gets `socket.io-client`, `fetch` and env knobs (window, motion, connectivity), installed once
  in `setup.ts` the way `react-native-audio-api` already is, plus `renderApp()` mounting the real
  `AppProviders`. Integration gets typed sockets over `shared/protocol.ts`. E2E gets a typed
  `OfflineSave` builder. `tests/support/game.ts` serves every tier.
- **Why:** each hand-typed stand-in lets production drift (a context gaining a field, the wire's
  `cardFromLoser` going optional, the save schema moving) without any test noticing. Moving the fake
  down to the vendor edge means the real module runs, so a drift fails `tsc` or the test.
- The small correctness defects (false greens, repo-root writes, leaked handles, a live-network test)
  are fixed directly in one cleanup ticket.
- 9 tickets: 1 S, 8 M.

## 2. Current shape (evidence at MAIN)

### 2.1 Native tier: modules mocked instead of the I/O beneath them
- `app/_layout.tsx:147-163` composes nine providers inline in `RootLayout`. No exported composition
  exists, so no test can mount "the app" over fakes.
- Context mocks by module, counted by `jest.mock('@/context/<X>')` files: AuthContext 36,
  SocketContext 20, NotificationContext 15, onlineGameHooks 14, GameContext 9, OnlineGameContext 3.
  `tests/native/onlineContextMock.ts` (a hand-typed wide value) still serves `handMemo`,
  `onlineRoundSelection` and `rejoinFailedExit`.
- What the providers really touch is small and already fakeable at the vendor edge:
  - `context/AuthContext.tsx:51-57,76-130`: `fetch` (raw, and via `apiRequest`), `AsyncStorage` (vendor
    mock in setup), `NetInfo` (vendor mock in setup).
  - `lib/query-client.ts:1`: `expo/fetch`, which `tests/native/setup.ts:116-121` already routes to
    `globalThis.fetch`.
  - `lib/socket.ts:1,71-99`: `io` from `socket.io-client`, plus `fetch` for the ticket.
  - `lib/sendIntent.ts:84-90`: `socket.timeout(ms).emit(event, message, (err, reply) => …)`. A fake
    must answer acks.
  - `context/SocketContext.tsx:237-238,284-285,318-324`: `socket.io.reconnection()`, `connect()`,
    `disconnect()`, `active`, `connected`.
- The 9 `@/lib/socket` mocks are byte-identical untyped objects whose `off(){}` is a no-op
  (`tests/native/sessionReplaced.test.tsx:17-37`, `socketReconnect.test.tsx:18-37`).
- Precedent for the target shape: `tests/native/setup.ts:160-170` mocks each audio layer **once**
  (`./mocks/audioApi`, `./mocks/turboHaptics`), resets it `beforeEach`, and "every other test reads
  what it recorded".
- Env knobs:
  - `lib/accessibility.ts:18` `setMotionPreference` drives `usePrefersReducedMotion` (`:127-141`),
    yet 46 files mock the module and 18 use the setter. Some mocks contradict the real hook:
    `bannerBand.test.tsx:19-23` returns `true` with preference `'off'`, which the hook maps to
    `false`.
  - `setup.ts:30-39` already calls `Dimensions.set` before every test, so the private-path
    `useWindowDimensions` mock in 11 files duplicates a mechanism setup already has.
  - `setup.ts:79` installs the vendor netinfo mock. 9 files re-mock it plainly; 2
    (`offlineBannerLargeText:11`, `tableNotices`) each build their own driver.
- No `afterEach(jest.useRealTimers)` in setup. 109 files fake timers and 108 restore them inline, so a
  failing test cascades into its siblings. `process.env` is written in 11 native files. `Platform.OS`
  is redefined in 7.

### 2.2 Integration tier: wire types copied, connect copied, polls copied
- `tests/helpers/table.ts:20-57` and `tests/helpers/gameDriver.ts:13-43` declare their own
  `SanitizedState`/`ExchangePhase`/`RoomState`. So do `tests/soak/soak.ts:28-50` and five integration
  tests (gameplay, reconnect, rematch, sessionReplaced, spectator, teamsOnline). They have drifted from
  `shared/protocol.ts:20-41` (`WireGameState`, `WireRoomState`):
  - `cardFromLoser` is required in the copies; production made it optional in #1638.
  - `cardToLoser` is missing.
  - `viewerSeatIndex` is `number` in the copies and `number | null` on the wire.
- `tests/helpers/client.ts` has three copies of connect:
  - `connect` (:58), `reconnectWith` (:88), `connectAs` (:126) and `reconnectAs` (:160) open a socket
    four ways.
  - `connectAs` rejects on `connect_error` without closing the socket (:146-149, **L-159**).
  - `waitFor` (:207-218) takes `event: string` and a caller-asserted `T`, and leaves its `once`
    listener behind on timeout (**L-159**). It has 259 call sites.
- Two round drivers do one job: `driveRoundToExchangeOrOver` (`table.ts:127`) and
  `driveHumansToRoundOver` (`gameDriver.ts:57`).
- Hand-rolled polls: `gameDriver.ts:136 waitForRow`, `client.ts:229 waitForPendingCode`, and
  `tests/soak/replay.ts:53-69`.
- Server unit tests: 13 files stub `io` with `as unknown as SocketServer`, and `stubIo` is copied 4
  times. That is **server-output's** recording adapter (L-026), not this area's (see §9).
- `tests/server/shutdownSeatLost.test.ts:25-45` builds a game with `roundWinner: null`, a field
  `GameState` does not have, through `as unknown as` (**L-160**). `tests/helpers/onlineTable.ts` is the
  typed builder it should use.

### 2.3 Fixtures copied across tiers
- `tests/engine/helpers.ts` (`c`, `j`, `makePlayer`, `makeState`, `mulberry32`, `sample`, plus
  `export *` of the engine) has 25 importers and none of them is native.
- `mulberry32` is copied in `tests/ui-rules/{bombFx:7,coneRain:8,particles:18,roundMotes:6,trick:20}`.
  The e2e in-page copies (`seededRandomness.ts:10-15`, `virtualClock.ts:19-25`) run inside the
  browser and must stay inline (verifier).
- Relative luminance is written five times: `lib/diagnostics/lampLegibility.ts:36` (not exported),
  `ui-rules/contrast.test.ts:31`, `suitColours.test.ts:21`, `cosmetics.test.ts:23` (threshold
  `0.03928`) and `e2e/seatNameContrast.spec.ts:30,70`. No 8-bit channel lies between `0.03928` and
  `0.04045` (10/255 = 0.0392, 11/255 = 0.0431), so unifying the threshold changes no result.
- `tests/native/tableCardRects.test.tsx:39-58` and `tableCardShadows.test.tsx:49-67` each carry their
  own `METRICS`, `table`, `base`, `seat` and `card`. They walk the same three scenarios twice
  (`frames(2000)` throw, `frames(1600)` deal, `frames(3000)` exchange), each under a 120 s timeout
  (**L-133**).

### 2.4 E2E tier: the save is hand-written, sleeps are fixed
- `tests/e2e/helpers/offlineSeed.ts:60-114`:
  - `offlineGameSave(playerCount, handSize, turn, scores, holding)` takes five positional parameters
    and returns an **untyped** literal with `version: 3`.
  - The app's own `OfflineSave` type and `encodeOfflineSave` already exist (`lib/offlineSave.ts:21-38`).
  - 11 specs write their own `version: 3` save: a11yOverlays, bombShakeBounds, exchangeAnnounceNodes,
    exchangeAttribution, exchangeNoOverlap, exchangePickChange, exchangeTeleport, mockupPolish (×2),
    playedRound, startAnnouncement and tableMoments.
  - 8 files use `OFFLINE_SAVE_KEY`/`E2E_SUSPEND_BOT_KEY` directly.
- `tests/e2e/resultActions.spec.ts:54-62` and `resultCutout.spec.ts:85-93` drive a whole `single`
  round through the lobby, with a 5-minute timeout, only to reach the board. `tableMoments.spec.ts:169`
  `matchPointSave` already shows the seeded shape.
- `tests/e2e/onlineTableSurvey.spec.ts:530-549` boots an online table (120 s) to test a helper's own
  guard.
- `tests/tooling/e2eFixedSleeps.test.ts:20-44` `LEGACY` holds 58 sleeps. It only tightens (`:171`).
- `tests/e2e/helpers/navigation.ts:84-90` `dismissStartAnnouncement` counts the gate, then clicks with
  `.catch(() => {})`: check-then-act plus a swallowed error.
- `tableMoments.spec.ts:3` promises a flight-shadow moment, but the file has no such test. Its
  fixtures sit at `:131-160`.

### 2.5 Correctness defects (point fixes)
- `tests/server/sourceMaps.test.ts:13,32-34` writes under `process.cwd()/sourcemaps` and
  `rmSync`s the whole directory. The production `MAPS_ROOT` is a module constant
  (`server/http/sourceMaps.ts:14`), so it cannot be redirected without a signature change.
- `tests/tooling/diagnosticsPlugin.test.ts:9-15` sets and deletes `EXPO_PUBLIC_DIAGNOSTICS` with no
  `try/finally`.
- False greens:
  - `tests/native/handTapStrip.test.tsx:34` asserts `strip / 2 < strip`.
  - `errorReporting.test.tsx:218-222` clears the set it then asserts empty.
  - `cardHitBox.test.tsx:26-27` asserts `width: expect.any(Number)`.
- `tools/loop/tests/deleteBranchOnMerge.test.ts:11-17` calls live `gh api graphql` with no
  environment floor. `tools/loop/tests/reap.test.ts:487-494` reads the real process table, though
  `reap()` already takes `readTable` (`tools/loop/reap.mjs:301`).
- `tests/native/spectateFailed.test.tsx:89-133` calls `spectateRoom`/`joinRoom`/`leaveRoom` inside
  `waitFor`, which retries side effects.
- `tests/tooling/soundAssets.test.ts:39` `readMp3` decodes the same files repeatedly
  (`:200-243`).

## 3. Alternatives considered

### 3.1 The native seam (L-121, L-119 client half, L-118/L-154/L-163)

| | A. Vendor-edge fakes in setup + `renderApp` (**picked**) | B. Production DI ports | C. Typed context fakes |
|---|---|---|---|
| Shape | `jest.mock('socket.io-client')` → `FakeSocket`; `globalThis.fetch` → `FakeHttp`; window, motion and netinfo knobs; `AppProviders` extracted (a pure move); `renderApp()` mounts it | `AppProviders({http, socketFactory})`; `apiRequest`, `lib/socket` and `errorReporting` take an injected transport | each context exports its `Context`; `fakeAuth(partial): AuthContextValue` |
| Production change | one extraction (`context/AppProviders.tsx`), no signatures | `lib/query-client` is a module singleton used outside React (`errorReporting`, `AuthContext.fetchMe`), so the transport must be threaded through every caller | export 5 Context objects |
| Depth | deep: callers learn `renderApp(ui, {user})`, `socket.deliver/emitted/reply`, `http.on`. Every real provider, `sendIntent` and `lib/socket` runs | deep, but only a test adapter exists beside the real one, and production pays for it | shallow: still an imagined provider, now type-checked |
| Locality | the fakes live with `mocks/audioApi.ts`; one place to change when socket.io changes | spread across production | per context |
| What it catches | provider wiring, intent acks, reconnect loop, a context field meaning something new | same as A | a field added or removed, not a meaning change; no wiring |
| Migration risk | the global `fetch`/`io` default changes the environment of 250 files; the default must look like "offline" | high: touches production network code | low |

**Pick A.** It reaches B's coverage without a production seam that only tests would use (the deletion
test: B's port has one real adapter). It also follows a precedent the repo already trusts (one audio
mock in setup). C is kept only as the fallback for the owner decision in §10.1.

### 3.2 Fixtures (L-142, L-150, L-133, L-160)

- **A. One cross-tier module `tests/support/game.ts` (picked).** Pure TypeScript with relative
  extensioned imports and no React Native, so `node --test`, jest and Playwright all load it. Per
  `checks.md` § Node's TypeScript loader, that is the constraint.
- **B. Typed per-tier builders (`satisfies GameState`) with no shared home.** Cheaper to land, but a
  field change still edits N builders. It fixes type drift, not duplication.

**Pick A.** B fails the deletion test: removing any one copy makes nothing simpler.

### 3.3 E2E save (L-147, L-137)

- **A. A typed options builder, plus presets only where ≥3 callers share a shape (picked).**
  `offlineSave(opts): OfflineSave` encodes through `encodeOfflineSave`. Presets:
  `exchangeSave(opts)` (5 exchange specs) and `oneCardFromFinishing(opts)` (tableMoments,
  resultActions, resultCutout).
- **B. The ledger's four shape helpers (`exchangeSave`, `bombSave`, `openingSave`, `card`) on top of
  the positional `offlineGameSave`.** This keeps five positional parameters and an untyped literal;
  `bombSave` and `openingSave` would each have one or two callers.

**Pick A.** A schema change then fails `tsc` in one file.

### 3.4 Integration socket (L-119 integration half, L-140, L-159)

- **A. Typed `TestSocket = Socket<ServerToClientEvents, TestEmits>` (picked).** `TestEmits` is
  `ClientToServerEvents` with the ack made optional, because tests emit without an ack. Wire types are
  imported. One `openSocket`, and `waitFor<E>` typed from the event name.
- **B. Import the wire types only (the verifier's cheapest step).** This fixes the drift but leaves
  259 `waitFor<T>` casts and four connect copies.

**Pick A.** It costs one helper rewrite more than B, and every call site becomes checked.

## 4. Target design

### 4.1 Native harness — `tests/native/harness/`

```ts
// tests/native/mocks/socketIo.ts — installed by setup.ts: jest.mock('socket.io-client', () => require('./mocks/socketIo').module())
import type { ServerToClientEvents, ClientToServerEvents, IntentReply } from '@/shared/protocol';
export interface FakeSocket {
  readonly connected: boolean; readonly active: boolean;
  /** Server → client: runs every listener registered through `on`/`once` (a real `off` removes it). */
  deliver<E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>): Promise<void>; // wraps act()
  /** Client → server, in order, payload typed by event. */
  emitted<E extends keyof ClientToServerEvents>(event?: E): { event: E; payload: Parameters<ClientToServerEvents[E]>[0] }[];
  /** How the next acks for `event` are answered; default { ok: true } at once. 'silence' never acks (the timeout path). */
  reply(event: keyof ClientToServerEvents, answer: IntentReply | 'silence'): void;
  open(): Promise<void>; drop(reason?: string): Promise<void>; refuse(message: string): Promise<void>; // connect / disconnect / connect_error
  listenerCount(event: string): number;
}
export function sockets(): FakeSocket[];         // every socket `io()` minted this test, oldest first
export function lastSocket(): FakeSocket;        // throws a named error when none was minted

// tests/native/mocks/http.ts — installed by setup.ts as globalThis.fetch
export interface FakeHttp {
  on(method: string, path: string | RegExp, answer: { status?: number; json?: unknown } | ((req: Recorded) => Response | Promise<Response>)): void;
  requests(path?: string | RegExp): Recorded[];   // { method, path, body }
}
export const http: FakeHttp;
// Unrouted request → rejects with TypeError('network: unrouted GET /api/x'): the same shape as offline,
// so a provider that tolerates offline still boots; a test that needs an answer must route it.

// tests/native/harness/env.ts — each reset by setup.ts afterEach
export function setWindow(w: { width: number; height: number; fontScale?: number; scale?: number }): Promise<void>; // Dimensions.set inside act
export function setMotion(p: MotionPreference): Promise<void>;   // setMotionPreference inside act; reset to 'system'
export function setConnectivity(isConnected: boolean): Promise<void>; // drives the vendor netinfo mock's listeners

// tests/native/harness/renderApp.tsx
export interface AppOptions {
  user?: AuthUser | null;          // seeds AsyncStorage AUTH_USER_KEY and routes GET /api/auth/me (200 | 401); default signed out
  settings?: Partial<Settings>;    // seeds SETTINGS_KEY, so the real SettingsProvider pushes motion etc.
  window?: { width: number; height: number; fontScale?: number };
}
export function renderApp(ui: React.ReactElement, opts?: AppOptions): Promise<RenderResult & {
  socket(): FakeSocket;            // the socket lib/socket minted for opts.user
  http: FakeHttp; queryClient: QueryClient;
}>;

// context/AppProviders.tsx — production, moved verbatim from app/_layout.tsx:147-163
export function AppProviders(props: { children: React.ReactNode; queryClient: QueryClient }): JSX.Element;
```

**Invariants and ordering a caller must know**
- `AppProviders` is the one provider order. `RootLayout` renders
  `<AppProviders queryClient={queryClient}><RootLayoutNav/></AppProviders>`. A provider added in one
  place only would be invisible to the harness, so a single definition is the point.
- `renderApp` builds a fresh `QueryClient` per call. `lib/socket`'s `socketMap` is module state, so
  the setup `afterEach` disconnects every socket the fake minted (`disconnectSocket` per user). The
  next test therefore never receives the previous test's socket.
- Fake I/O is reset in `beforeEach`, as `audioApi.newEpoch()` is.
- The real-timers restore (§4.5) is declared **after** the testing library's `require`, so it runs
  after the library's auto-unmount. `setup.ts:133-145` documents that `afterEach` order is
  declaration order.
- `deliver`, `open`, `drop` and the `set*` knobs wrap `act` and must be awaited. A bare call is the
  `checks.md` § The native harness is async trap, and `nativeActPairing` already refuses it.
- `expo-router` stays a per-file mock (47 files, out of scope). `renderApp` mounts an element, not a
  route.
- Error modes: `lastSocket()` with no socket minted throws `no socket: was a user signed in?`. An
  unrouted request reaches the provider as offline. It never hangs.

**Deleted:**
- The 46 `@/lib/accessibility` mocks, which become `setMotion` or nothing.
- 9 private `useWindowDimensions` mocks, which become `setWindow`. Two stay: `orientationFirstRender`
  and `tableRelocksAfterEntry` deliberately simulate a stale bridge value.
- 9 plain netinfo re-mocks and 2 drivers, which become `setConnectivity`.
- 9 `@/lib/socket` mocks.
- The `@/context/*` mocks and `query-client` mocks in migrated files.
- `tests/native/onlineContextMock.ts`.

`eslint.config.js` gains a `no-restricted-syntax` entry over `tests/native/**` that bans `jest.mock`
of the modules the harness now owns. The list grows ticket by ticket. That is a floor, not a ratchet:
a banned name has zero allowed sites.

### 4.2 Shared fixtures — `tests/support/game.ts` (+ native `renderTable`)

```ts
// tests/support/game.ts — relative .ts imports only; no react-native (checks.md § Node's TypeScript loader)
export const card: (rank: Rank, suit: Suit) => Card;          // replaces c()
export const joker: (kind: 'bw' | 'colored') => Card;         // replaces j()
export function seat(i: number, hand?: Card[], over?: Partial<Player>): Player;
export function state(over?: Partial<GameState>): GameState;  // the single GameState literal for tests
export function rng(seed: number): () => number;              // mulberry32, the only node-side copy
export function sample(deck: Card[], n: number, rand: () => number): Card[];
export const cardKey: (cards: Card[]) => string;
// tests/native/harness/table.tsx
export function renderTable(gs: GameState, o?: { viewer?: number; window?: WindowSpec; motion?: MotionPreference; props?: Partial<ComponentProps<typeof GameTable>> }): Promise<RenderResult>;
// tests/native/helpers/cardScenarios.ts
export type Scenario = 'throw' | 'deal' | 'exchange' | 'goingOut';
export function runScenario(s: Scenario, onFrame: (frame: number) => void): Promise<void>;
// lib/contrast.ts — production, pure: lampLegibility and the tests import it
export function relativeLuminance(rgb: readonly [number, number, number]): number;
export function contrastRatio(a: string, b: string): number;
```

**Deleted:**
- `tests/engine/helpers.ts`. Its 25 importers re-point, and engine symbols are imported from the
  engine directly instead of through `export *`.
- 5 `mulberry32` copies.
- 4 luminance copies. `seatNameContrast.spec.ts:70` runs inside `page.evaluate` and stays.
- The local builders in `tableCardRects`/`tableCardShadows`, which become one file asserting
  `expectExactlyDrawn()` and `expectNoCardShadow()` on the same frames. The going-out walk keeps its
  registry-only assertion.
- `shutdownSeatLost`'s `as unknown as` game, replaced by `onlineTable({..., gameState: state(...)})`.

### 4.3 Integration helpers — `tests/helpers/client.ts`, `tests/helpers/table.ts`

```ts
import type { ServerToClientEvents, ClientToServerEvents, WireGameState, WireRoomState } from '../../shared/protocol.ts';
type TestEmits = { [E in keyof ClientToServerEvents]: (...a: OptionalAck<Parameters<ClientToServerEvents[E]>>) => void };
export type TestSocket = Socket<ServerToClientEvents, TestEmits>;
export function openSocket(server: TestServer, how: { cookie: string } | { auth: Record<string, unknown> }): Promise<TestSocket>;
export function connectAs(server: TestServer, username: string): Promise<Client>;     // register + openSocket
export function waitFor<E extends keyof ServerToClientEvents>(s: TestSocket, e: E, ms?: number): Promise<Parameters<ServerToClientEvents[E]>[0]>;
export function eventually<T>(check: () => T | Promise<T>, o?: { ms?: number; every?: number; what: string }): Promise<NonNullable<T>>;
export function driveRound(clients: Client[], kickoff: () => void, o?: { onExchange?: 'stop' | 'idle' | 'give'; timeoutMs?: number }): Promise<DriveResult>;
```

**Invariants**
- Every rejection path closes the socket it opened and removes the listener it added (L-159).
  `waitFor` `off`s on timeout.
- All deadlines scale by `DEADLINE_SCALE`, as today.
- `eventually`'s message names `what`.

**Deleted:**
- `connect`, `reconnectWith` and `reconnectAs`, folded into `openSocket`.
- The 8 `SanitizedState` declarations.
- `gameDriver.ts`'s driver, folded into `driveRound`. `waitForRow` becomes `eventually`.
- `replay.ts`'s and `waitForPendingCode`'s own poll loops.

**Drift this exposes:** `viewerSeatIndex: number | null`. Drivers must treat `null` (a spectator) as
"not my seat".

### 4.4 E2E seeding — `tests/e2e/helpers/offlineSeed.ts`

```ts
import type { OfflineSave } from '../../../lib/offlineSave';
export interface SaveOptions { seats: 2|3|4; hand?: number; holding?: string[][]; turn?: number; scores?: Record<string, number>;
  length?: MatchLength; target?: number; state?: Partial<GameState>; }
export function offlineSave(o: SaveOptions): OfflineSave;                 // built with tests/support/game.ts state()
export function exchangeSave(o: SaveOptions & { winner: number; loser: number; cardFromLoser?: string }): OfflineSave;
export function oneCardFromFinishing(o: { seats: 2|3|4; length: MatchLength; last: Card; pile?: Card[] }): OfflineSave;
export function resumeSaved(page: Page, baseURL: string, save: OfflineSave, o?: { holdTurn?: boolean }): Promise<void>;
```

**Invariants**
- `resumeSaved` writes `encodeOfflineSave(save)`, so the version comes from production.
- It is the only writer of `OFFLINE_SAVE_KEY` and `E2E_SUSPEND_BOT_KEY` in `tests/e2e`.

**Deleted:**
- The positional `offlineGameSave`.
- 11 inline saves.
- `mockupParity.ts`'s `seatTable()` and `exchangeAttribution`'s own opener.

### 4.5 Test-environment hygiene (setup.ts)
- `afterEach(() => jest.useRealTimers())`, declared after the testing library's `require`.
- `Platform.OS` and `fetch` overrides go through `jest.replaceProperty` and `jest.spyOn`, with
  `afterEach(jest.restoreAllMocks)` scoped to **spies and replaced properties only**.
- No `restoreMocks: true` in `jest.config.js`. Under Jest 29 it would wipe the `jest.fn(impl)` inside
  module-factory mocks.
- No `withEnv` helper (the verifier called it an overreach): the 11 env writes get `try/finally` where
  they are.

## 5. Migration (each step leaves main green)

1. **Cleanup (T1).** Point fixes in §2.5, plus §4.5's hygiene. Deletes three false greens, the
   repo-root write and the live-network dependency.
2. **Env knobs (T2).**
   - Add `harness/env.ts`.
   - Prove `setWindow` re-renders `useWindowDimensions` mid-test on one file, `bannerBand`, before
     the rest (verifier's condition).
   - Delete the accessibility, window and netinfo mocks; add the eslint ban entries.
3. **Fakes and AppProviders (T3).**
   - Add the `socketIo`/`http` mocks to setup. Before installing the global fetch default, prove that
     no current file depends on what jest-expo's `fetch` does: run the native suite once with it
     installed.
   - Extract `AppProviders`.
   - Convert the 9 `@/lib/socket` files and three screen tests (one Auth-heavy home test, `spectateFailed`
     and `socketReconnect`) as the proof the verifier asked for.
4. **Migrate the account-side context mocks (T4).** AuthContext and NotificationContext files, plus
   `query-client` mocks, move to `renderApp`. The ban list grows.
5. **Migrate the table-side context mocks (T5).** SocketContext, onlineGameHooks, GameContext,
   OnlineGameContext and `onlineContextMock`. Deletes `onlineContextMock.ts`.
6. **Shared fixtures (T6).** `tests/support/game.ts`, `lib/contrast.ts` and `cardScenarios`;
   re-point importers; fix L-160. Independent of 2–5 except `setup.ts`, which T6 does not touch.
7. **Integration helpers (T7).** Independent.
8. **E2E seeding (T8).** Uses `tests/support/game.ts`, so it comes after T6.
9. **E2E waits and defects (T9).** It shares spec files with T8 (`a11yOverlays`, `resultCutout`), so
   it comes after T8.

## 6. No-regression strategy

- **Pin before moving.** Every converted native test keeps its assertions word for word. Only the
  arrange section changes. A test whose assertion must change says why in the PR.
  - Where a mock contradicted production (`bannerBand`/`captureScreen`/`homeReturnToTable` answering
    reduced motion `true` with preference `'off'`), the converted test picks the preference that
    yields the behaviour it asserts, `setMotion('on')`, and the PR lists them.
- **Red/green where it is a bug.**
  - L-124: each rewritten assertion is shown red against a planted defect before going green
    (`hitWidth` ignored, the teardown remover not called, the box width from the card), per
    `checks.md` § A scan needs a planted floor.
  - L-159: a test that connects to a closed port asserts the socket is closed and the listener count
    is 0.
  - L-160: the fixed fixture fails `tsc` if `roundWinner` returns.
  - L-123: a test asserts `symbolicate` reads only from the root it was given. Run the suite with a
    planted `sourcemaps/keep.txt`; it must survive.
- **Harness self-tests.** `tests/native/harness.test.tsx` covers:
  - `deliver` reaches a listener, `off` removes it, and acks answer as configured (`'silence'` makes
    `sendIntent` time out).
  - An unrouted fetch rejects as offline.
  - Each knob resets between tests: two tests in order, the second asserting the defaults.
  - A floor: a planted provider-order change in `AppProviders` (Socket above Auth) makes a
    `renderApp` test fail.
- **Equivalence for the merged card scenarios (L-133).** For one run, the merged file records the
  per-frame drawn set and host shadows, and the PR compares them to the two old files' outputs. Wall
  time goes in the PR (memory: quote only measured deltas).
- **Which checks catch what.**
  - `tsc` catches wire, save and fixture drift (T6, T7, T8).
  - `jest` (ios + android + compiled) catches native harness conversions.
  - `node --test` catches T6's node tiers and T7 (integration needs `DATABASE_URL` from `dev-stack`).
  - Playwright catches T8 and T9. The changed specs run alone, per rule 3; the e2e budget gate
    (`tools/ci/e2e-budget.mjs`) must show `resultActions`/`resultCutout` faster.
  - No unit test sees layout. T8/T9 must keep every geometric assertion: L-173 deletes only
    presence-only tests, each named in the PR next to the native test that covers it.
- **Scans that move.**
  - `tests/tooling/e2eFixedSleeps.test.ts` `LEGACY` drops by each sleep removed (T9).
  - `nativeActPairing` keeps refusing bare `act` pairings; the harness's async knobs comply.
  - `repoLayout` must accept `tests/support/`. Check it in T6.

## 7. Coverage table

| ID | Covered by | Note |
|---|---|---|
| L-118 | T2 | Delete 46 mocks. Contradictory ones map to `setMotion('on')`. `automationReducedMotion` is env, untouched. Reset in `tests/native/setup.ts` (verifier's path). |
| L-119 | T3 (client fake), T7 (integration typing) | The server `FakeIo`/`TableIo` half goes to server-output (L-026's recording adapter). This area does not build a second one. |
| L-121 | T3 (harness + 3 proofs), T4, T5 | Real providers over vendor-edge fakes. No `initialUser` prop is needed: AsyncStorage plus `/api/auth/me` seed a signed-in start. No dependency on L-019 in practice: the native harness uses jest fake timers. |
| L-123 | T1 | `symbolicate(raw, root = MAPS_ROOT)`, test on `mkdtempSync`. diagnosticsPlugin gets `try/finally`. checkStrictIndexed is already correct (verifier) and is left. |
| L-124 | T1 | Three false greens, not six (verifier). Each is shown red on a planted defect. |
| L-126 | T1 | reap test injects `readTable`. deleteBranchOnMerge runs where `gh` is authenticated (see §10.2). |
| L-133 | T6 | `runScenario` driver; one file asserts both. `shadowClusterBuilds` unmocks `cardShadows` and stays separate but uses the driver. |
| L-137 | T8 | `resultActions`/`resultCutout` seed `oneCardFromFinishing`. `onlineTableSurvey`'s guard becomes a `node --test` of an extracted `assertFresh`. tapTargets, menuHeight and oneAccessibleNode need nothing (verifier). |
| L-140 | T7 | Wire types imported, one `openSocket`, `eventually`, one driver. The "merge three Postgres checks" part was never verified; it is left out. |
| L-142 | T6 (module + node tiers + native helpers), T4/T5 (native files touched there use `state()`/`renderTable`) | 60 native `GameState` literals migrate as their files are touched by T4/T5/T6. The remainder is listed in T6's PR. |
| L-147 | T8 | Typed `offlineSave` on `encodeOfflineSave`. `exchangeSave` and `oneCardFromFinishing` presets only. |
| L-148 | T9 | Each sleep replaced by `atRest`/`expect.poll`/a dealt-attribute wait. `LEGACY` lowered in the same diff. |
| L-150 | T6 | `lib/contrast.ts`. The in-page e2e copies stay (verifier). The threshold unification changes no 8-bit result. |
| L-154 | T2 | `setConnectivity` over the vendor mock. |
| L-157 | T1 | `await act(async () => result.current.spectateRoom(...))`. Latent, not a live double emit. |
| L-159 | T7 | Folded into `openSocket`/`waitFor`. |
| L-160 | T6 | `onlineTable` + `state()`. |
| L-163 | T2 | `setWindow`. Two deliberate private mocks stay. Proven on one file first. |
| L-168 | T1 | Memoise `readMp3` only. The shared `ts.Program` was rejected: the root sets differ (verifier). |
| L-169 | T1 | Global real-timers restore, `replaceProperty` for Platform/fetch, `try/finally` env writes. No `restoreMocks`, no `withEnv`. |
| L-172 | T9 | `dismissStartAnnouncement` waits for the hidden state. Flight-shadow: write the moment or drop the claim and fixtures (see the ticket). reducedMotionWobbleReset is already fixed (verifier). |
| L-173 | T9 | Delete presence-only tests (`homeArena.spec.ts:38,80`, `gameSettingsSheet.spec.ts:215`) after naming each native counterpart. Files and geometric tests stay. |

## 8. Proposed tickets

### T1 — Tests: false greens, a repo-root write, leaked env and timers, and two environment-bound loop tests (S)
- **Files:**
  - `server/http/sourceMaps.ts:14,~70` (`symbolicate(raw, root = MAPS_ROOT)`) and its caller
    `server/http/admin.ts:209`, unchanged.
  - `tests/server/sourceMaps.test.ts`, `tests/tooling/diagnosticsPlugin.test.ts`.
  - `tests/native/{handTapStrip:34,errorReporting:217-222,cardHitBox:26-27,spectateFailed:89-133}.test.tsx`.
  - `tests/native/setup.ts`, the 7 `Platform.OS` redefiners and the 2 fetch spies.
  - `tests/tooling/soundAssets.test.ts:39`.
  - `tools/loop/tests/{reap:487-494,deleteBranchOnMerge}.test.ts`.
- **Blocked by:** #1641 (it edits reap), and http if it reshapes `server/http/sourceMaps.ts`.
- **DoD:**
  - [ ] The sourceMaps test writes only under `os.tmpdir()`; a planted `sourcemaps/keep.txt`
    survives `node --test tests/server/sourceMaps.test.ts`.
  - [ ] Each of the three rewritten assertions is shown red on a planted defect in the PR body.
  - [ ] `afterEach(jest.useRealTimers)` sits below the testing-library `require` in setup.
    `Platform.OS` and fetch overrides use `replaceProperty`/`spyOn`, restored by
    `afterEach(jest.restoreAllMocks)`.
  - [ ] reap's in-process test injects `readTable`. deleteBranchOnMerge follows §10.2's decision.
  - [ ] `readMp3` memoised. Before and after time measured.
- **Checks:**
  - While iterating: each touched file alone (`node --test <file>`;
    `npx jest <file> --selectProjects ios`).
  - Before pushing: `npm run typecheck`, eslint, and the loop test command from `checks.md` for
    `tools/loop/tests`.

### T2 — Native: window, motion and connectivity are setup knobs, not module mocks (M)
- **Files:**
  - New: `tests/native/harness/env.ts`.
  - `tests/native/setup.ts`.
  - The 46 accessibility-mocking files, 9 of the 11 `useWindowDimensions` files and the 11 netinfo
    files.
  - `eslint.config.js` (a ban entry for `tests/native/**`).
- **Blocked by:** T1 (setup.ts). Coordinate eslint.config.js with static-checks: never in parallel.
- **DoD:**
  - [ ] `setWindow` is proven mid-test on `bannerBand` first. If it does not re-render, the ticket
    stops and reports.
  - [ ] Zero `jest.mock('@/lib/accessibility')` and zero `react-native/Libraries/Utilities/useWindowDimensions`
    mocks remain, except `orientationFirstRender` and `tableRelocksAfterEntry`, each with a reason.
    Zero netinfo re-mocks.
  - [ ] eslint refuses a new one: a planted mock goes red.
  - [ ] The contradictory motion mocks are listed in the PR with the preference chosen.
  - [ ] A two-test harness check proves each knob resets.
- **Checks:**
  - While iterating: `npx jest <file> --selectProjects ios`.
  - Before pushing: `npm run typecheck`, eslint, and the touched files in all three projects. Memory
    rule: name unrun tests if memory is low.

### T3 — Native: one typed socket and HTTP fake under the real providers, and `renderApp` (M)
- **Files:**
  - New: `tests/native/mocks/{socketIo,http}.ts`, `tests/native/harness/renderApp.tsx`,
    `tests/native/harness.test.tsx`, `context/AppProviders.tsx`.
  - `app/_layout.tsx:147-163`, `tests/native/setup.ts`.
  - The 9 `@/lib/socket` files.
  - Three proof screens: one home test, `spectateFailed`, `socketReconnect`.
- **Blocked by:** T2 (setup.ts). Client area: no parallel edit of `app/_layout.tsx` or `context/*`
  provider order.
- **DoD:**
  - [ ] `RootLayout` renders `AppProviders`. The provider order is unchanged; the diff shows a pure
    move.
  - [ ] `FakeSocket` is typed on `shared/protocol.ts`, `off` really removes, and acks follow
    `reply()`. `sendIntent`'s timeout path is tested with `'silence'`.
  - [ ] Unrouted fetch rejects as offline. The full native suite passes with the global defaults
    installed before any file is converted (first commit).
  - [ ] Zero `jest.mock('@/lib/socket')` remains; the ban entry is added.
  - [ ] Harness floor: a planted provider reorder reds a `renderApp` test.
- **Checks:**
  - While iterating: `npx jest tests/native/harness.test.tsx --selectProjects ios`.
  - Before pushing: typecheck, eslint, and the converted files in all three projects.

### T4 — Native: account-side screens render through `renderApp` (Auth, Notification, query-client mocks) (M)
- **Files:** the files mocking `@/context/AuthContext` (36), `@/context/NotificationContext` (15) and
  `@/lib/query-client` (19). They overlap; expect about 45 files.
- **Blocked by:** T3.
- **DoD:**
  - [ ] Zero mocks of the three modules in `tests/native`; ban entries are added.
  - [ ] Assertions are unchanged. Any changed one is listed with its reason.
  - [ ] Any `GameState` literal in a touched file uses `tests/support/game.ts` (if T6 has landed),
    otherwise it is left alone.
- **Checks:**
  - While iterating: per file, ios.
  - Before pushing: typecheck, eslint, and the touched files in all projects.

### T5 — Native: table-side screens render through `renderApp` (Socket, online slices, Game; retire `onlineContextMock`) (M)
- **Files:**
  - The files mocking `@/context/{SocketContext,onlineGameHooks,GameContext,OnlineGameContext}`
    (46 mocks).
  - `tests/native/onlineContextMock.ts` (deleted) and its 3 users.
- **Blocked by:** T4 (shared files), and client area's L-061 slice re-export.
- **DoD:**
  - [ ] Zero mocks of these modules, or the typed-slice fallback per §10.1. Ban entries are added.
  - [ ] Online screens get state through `socket().deliver('game:state', …)`.
  - [ ] `onlineContextMock.ts` is deleted.
- **Checks:** as T4.

### T6 — Tests: one fixture module for every tier, one luminance, one card-scenario driver (M)
- **Files:**
  - New: `tests/support/game.ts`, `tests/native/harness/table.tsx`,
    `tests/native/helpers/cardScenarios.ts`, `lib/contrast.ts`.
  - Deleted: `tests/engine/helpers.ts`. Its 25 importers re-point.
  - `tests/ui-rules/{bombFx,coneRain,particles,roundMotes,trick,contrast,suitColours,cosmetics}.test.ts`.
  - `lib/diagnostics/lampLegibility.ts`, `tests/e2e/seatNameContrast.spec.ts:30`.
  - `tests/native/{tableCardRects,tableCardShadows,shadowClusterBuilds}.test.tsx`.
  - `tests/native/helpers/{dealTable,dealTurnTable,closeMatch,landing,pileMounts}.tsx`.
  - `tests/server/shutdownSeatLost.test.ts`.
- **Blocked by:** engine area, if it reshapes `GameState`/`Card`.
- **DoD:**
  - [ ] `tests/support/game.ts` loads under `node --test`, jest and Playwright: one import from each
    tier in the PR. `repoLayout` is green.
  - [ ] One node-side `mulberry32` remains, and one luminance (`lib/contrast.ts`).
  - [ ] tableCardRects and tableCardShadows become one file. The per-frame equivalence and the
    measured wall time are in the PR.
  - [ ] `shutdownSeatLost` has no `as unknown as` on the game, and `roundWinner` is gone.
- **Checks:**
  - While iterating: `node --test` on touched node files; `npx jest <file> --selectProjects ios`.
  - Before pushing: typecheck, eslint, and `npm test`.

### T7 — Integration: typed sockets over the wire protocol, one connect, one poll, one driver (M)
- **Files:**
  - `tests/helpers/{client,table,gameDriver}.ts`, `tests/soak/{soak,replay}.ts`.
  - `tests/integration/{gameplay,reconnect,rematch,sessionReplaced,spectator,teamsOnline}.test.ts`.
  - The callers of `connect`/`reconnectWith`/`reconnectAs`/`driveHumansToRoundOver`.
- **Blocked by:** none in this area. Server-output (L-026) only if it renames wire types.
- **DoD:**
  - [ ] Zero local `SanitizedState`/`RoomState` declarations. `waitFor` is typed by event name; no
    `waitFor<…>` type arguments remain.
  - [ ] One `openSocket`. Every reject path closes its socket and `off`s its listener, proven by a
    test against a closed port.
  - [ ] One driver with `onExchange`. `eventually` replaces the three hand-rolled polls.
- **Checks:**
  - While iterating: `DATABASE_URL=… node --test tests/integration/<file>.test.ts`.
  - Before pushing: typecheck, eslint, and the integration folder with `dev-stack up`.

### T8 — E2E: a typed save builder, and result-board specs that start one card from the end (M)
- **Files:**
  - `tests/e2e/helpers/offlineSeed.ts`, `tests/e2e/helpers/mockupParity.ts`.
  - The 11 inline-save specs and the 8 direct-key users.
  - `tests/e2e/{resultActions,resultCutout,onlineTableSurvey,tableMoments}.spec.ts`.
  - New node test for `assertFresh`.
- **Blocked by:** T6 (the `state()` builder).
- **DoD:**
  - [ ] `offlineSave` returns `OfflineSave`; `resumeSaved` encodes through `encodeOfflineSave`.
  - [ ] Zero `version: 3` literals and zero direct `OFFLINE_SAVE_KEY`/`E2E_SUSPEND_BOT_KEY` writes
    outside `offlineSeed.ts`.
  - [ ] resultActions and resultCutout reach the board from a seeded save. Measured spec time before
    and after is in the PR.
  - [ ] onlineTableSurvey's guard test is a node test.
- **Checks:**
  - While iterating: each changed spec alone with `E2E_SKIP_BUILD=1`.
  - Before pushing: typecheck, eslint, and the changed specs.

### T9 — E2E: event waits instead of fixed sleeps, a race-free announcement dismiss, and no presence-only duplicates (M)
- **Files:**
  - The specs and helpers in §2.4 / L-148's list.
  - `tests/tooling/e2eFixedSleeps.test.ts` (`LEGACY`).
  - `tests/e2e/helpers/navigation.ts:84-90`, `tableMoments.spec.ts`.
  - `homeArena.spec.ts`, `gameSettingsSheet.spec.ts`, `seatFans.spec.ts`.
- **Blocked by:** T8 (shared specs). Static-checks if it converts `e2eFixedSleeps` to a lint rule.
- **DoD:**
  - [ ] Every removed sleep lowers its `LEGACY` entry in the same commit.
  - [ ] `dismissStartAnnouncement` waits for the gate's hidden state, with no swallowed error.
  - [ ] tableMoments either has the flight-shadow test or neither the claim nor its fixtures. Check
    `landingShadowStill.spec.ts` first; if it already covers the drop, delete.
  - [ ] Each deleted presence-only test is named with its native counterpart. No geometric assertion
    is removed.
- **Checks:**
  - While iterating: each spec alone.
  - Before pushing: typecheck, eslint, the changed specs, and `node --test
    tests/tooling/e2eFixedSleeps.test.ts`.

**Order (GitHub "blocked by"):**
- T1 → T2 → T3 → T4 → T5.
- T6 → T8 → T9.
- T7 is free.
- T6 may run beside T2–T5: it touches no setup and no context-mock file, except that native helper
  files used by T5 must not be in flight together. T5 is blocked by T6 if both touch
  `tests/native/helpers/*`.

## 9. Cross-area contracts

- **server-output (L-026):** owns the recording adapter that replaces the 13 server `io` stubs and the
  4 `stubIo` copies. This area builds no `FakeIo`. T7 consumes `ServerToClientEvents`/`WireGameState`
  unchanged; a rename there must update `tests/helpers` in the same PR.
- **client:**
  - Owns `context/*` and provider order. T3 moves the composition into `context/AppProviders.tsx`,
    and from then on, a provider change edits that file.
  - L-061 (re-export slice hooks, keep the six online contexts) must land before T5, so T5 migrates
    against the final hook surface.
  - `lib/sendIntent.ts`'s ack contract (`timeout().emit(…, cb(err, reply))`) is what `FakeSocket`
    implements. Changing it means changing the fake.
- **engine:** `GameState`/`Card`/`Player` shapes feed `tests/support/game.ts`. A field change is now
  one edit there.
- **time:** owns clock and RNG injection into the engine and server. `tests/support/game.ts` `rng()`
  is the seed source tests pass to whatever `rng` parameter that session adds. The e2e in-page
  `mulberry32` copies are the time session's if it changes in-page seeding.
- **static-checks:**
  - Owns lint and scan mechanisms. This area adds `no-restricted-syntax` ban entries for test mocks
    to `eslint.config.js` (T2–T5), so edits to that file must be ordered.
  - `e2eFixedSleeps.test.ts` is edited by T9 (`LEGACY` only). If static-checks converts it, T9 is
    blocked by that.
- **table-ui:** T6 rewrites `tableCardRects`/`tableCardShadows` and the native table helpers. Table-UI
  tickets that add cases to those files must be ordered with T6.
- **http:** T1 adds an optional `root` parameter to `symbolicate` (`server/http/sourceMaps.ts`); the
  only caller is `server/http/admin.ts:209`.
- **loop:** T1 edits `tools/loop/tests/{reap,deleteBranchOnMerge}.test.ts` and is blocked by #1641.

## 10. Owner decisions needed

1. **Leaf components and the online slice hooks (T5).** For a leaf component reading one slice
   (14 `onlineGameHooks` mocks), should the test mount the real `OnlineGameProvider` over
   `FakeSocket`, or keep a slice fixture typed `satisfies ReturnType<typeof useX>`? The typed fixture
   is shape C in §3.1: cheaper, but blind to meaning changes.
   - **Recommendation:** renderApp for every screen-level test, and a typed slice fixture allowed
     only for components under `components/table/` that read exactly one slice.
2. **`deleteBranchOnMerge` (L-126).** It checks a repository setting, not code.
   - (a) Keep it in the harness CI job, where a token exists. Skip it locally without `gh` auth, with
     a floor: the CI leg fails if it skipped, the same pattern as `harness-windows`.
   - (b) Move it to a weekly scheduled workflow that files an issue on red, like the device runs.
   - **Recommendation:** (a). It keeps the check on every PR and is honest offline. A bare skip would
     be a self-defeating safeguard (CLAUDE.md invariant).
3. **None other.** The global fetch and socket defaults, `restoreMocks`, and the fixture home are
   technical calls decided above.
