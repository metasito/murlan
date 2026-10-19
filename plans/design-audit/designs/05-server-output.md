# 05 — server-output: the table's output port, the refusal channel, the `tableHandlers.ts` split

IDs: L-025, L-026, L-031, L-035, L-037, L-047, L-048, L-049, L-050, L-055, L-056.
Read at MAIN `a1d0ebb5`. Every `path:line` below was re-read there.

## 1. Summary

- **Now:** the game layer takes the whole Socket.IO server (`io: SocketServer`, 44 parameters
  in `server/game`) as its output, and a refusal is said on two channels: an ack built from the
  handler's return value and a `*:error` emit written beside it by hand. Nothing ties them
  together, so 8 lobby refusals ack `{ok:true}` and are never logged.
- **After:** a refusal is a returned value (`refuse(code, params)` carries its own notice), and
  `onEvent` is the one place that emits it, acks it and logs it. The table layer takes a
  `TableRuntime`: a small output port (`out.room/user(...).emit`, `out.state`), cluster
  presence, the persistence writers, and `route`. One Socket.IO adapter implements it, and a
  recording adapter in `tests/helpers` implements it for tests.
- **Why:** the root cause of L-026, L-035 and L-037 is that nothing is injected at table level:
  output is the raw `io`, writers are injected on one path in four, and the router finds the
  handlers through setters. Building the runtime once in `setupSocket` fixes all three. With
  the refusal channel fixed (L-050), most of L-031 and L-047 becomes deletion.
- **Kept small:** L-048 (exhaustive kind table), L-049 (pass-throughs), L-055 (round_over
  schema) and L-056 (payload sites) are standalone fixes, each folded into the ticket that
  already edits the same files.
- **Five tickets:** S-OUT-1 refusals (M), S-OUT-2 lobby and registration (S), S-OUT-3 the
  runtime port (L), S-OUT-4 the split and layering (M), S-OUT-5 the round_over schema (S).

## 2. Current shape (MAIN evidence)

### Output is the raw Socket.IO server (L-026)
- `io: SocketServer` appears 44 times in `server/game`: tableHandlers 17, gameTurn 9,
  tableRouter 8, gamePersistence 5, roundOver 4 and dealRound 1. The game layer uses four
  things from it:
  - `io.to(room).emit`, at 20+ sites. Examples: `gameTurn.ts:108,210,263,341,372,410`,
    `roundOver.ts:138,276`, `tableHandlers.ts:112,115,441,633,702,760`,
    `dealRound.ts:47`, `emit.ts:7,22,34`.
  - `io.to(userRoom(uid)).timeout(ms).emit("game:state", …, ack)` with one re-derived retry
    (`gamePersistence.ts:190-214`).
  - `io.fetchSockets()` for the finished-table sweep (`gamePersistence.ts:327-342`).
  - Cluster presence through the `_io` singleton (`socketRegistry.ts:15-111`), which
    `tableHandlers.ts:52` imports.
- Tests rebuild that shape by hand: 20 `as unknown as SocketServer` casts in 13 files
  (`tests/server/tableStalls.test.ts:42-54` has 6). The stubs collapse every address into one
  list (`to: () => target`), so no test can tell a send to a room from a send to one user.

### The writers seam is bypassed (L-035)
- `RoundOverWriters` (`roundOver.ts:21-57`) is injected only into `handleRoundOver`,
  `vacateSeat` and `endMatchByAgreement`. Everywhere else the production object is
  hard-wired:
  - `commitMove` passes `roundOverWriters` and calls `persistGameState` directly
    (`gameTurn.ts:96-97`).
  - `dealRound` calls `roomStore.updateRoomStatus` and `persistGameState` directly
    (`dealRound.ts:40-50`).
  - `vacateSeat` takes `writers` but calls `roomStore.updateRoomStatus` itself
    (`gameTurn.ts:350-358`).
  - The reclaim branch of `rejoinAction` calls `persistGameState` (`tableHandlers.ts:488`).
- "Close the table" (announce `abandoned`, set `rooms.status` to finished, `disposeGame`) is
  written three times: `gamePersistence.ts:247-260` (`safeTimer`), `gameTurn.ts:209-222`
  (`runBotTurn`) and `gameTurn.ts:350-359` (last player leaves between rounds).

### Setters and layering (L-037)
- `setTableHandlers` (`tableRouter.ts:75-81`) exists because `tableHandlers.ts` imports the
  router; the header admits it at `tableHandlers.ts:14-16`. `setRoomLostHandler`
  (`gameOwnership.ts:63-67`) exists so the lock does not import disposal. Both are installed
  by `installTableHandlers` (`tableHandlers.ts:833-837`), which every table test calls in
  `before`.
- `setSocketServer` (`socketRegistry.ts:15-20`) is **legitimate late binding**:
  `registerRoutes` runs before `setupSocket` creates `io` (`app.ts:248-251`). This design
  keeps it.
- `setClock` belongs to the time area.
- Imports from `server/game` into `socket/` and `http/` at MAIN:
  - `../http/logger.ts` ×9
  - `../socket/socketTypes.ts` ×6
  - `payload.ts` ×3, `emit.ts` ×3, `socketSafety.ts` ×2 (the `EventOutcome` type),
    `events.ts` ×2
  - `socketTable.ts`, `socketRegistry.ts`, `seating.ts`
  - `retention.ts` reaches into `http/` for three retention constants.
- `emit.ts` sits in `socket/` but imports `game/` (`emit.ts:2-3`).

### Refusals: two channels (L-050)
- `onEvent` turns a void return into `{ok:true}` (`socketSafety.ts:226`) and logs only a
  returned refusal (`:227-229`). `EventResult = void | EventOutcome` (`:157`) makes the void
  return legal.
- Refusals that emit `room:error` and then return void, so they ack `ok:true` and skip the
  log:
  - `lobbyIntents.ts:58` (create, teams size)
  - `lobbyIntents.ts:71-74,75-78,81-84` (join)
  - `socketRooms.ts:111-114,117-120,123-126` (`room:rejoin`)
  - `socketRooms.ts:188` (quickmatch, teams size)
- Emit-and-return pairs that restate the code by hand:
  - `tableHandlers.ts:209-210,223-224,264-265,273-274,296-297,409-410,531-532,544-545,600`
  - `tableHandlers.ts:337-342` (`dealVotedRound`'s local `refuse`)
  - `socketRooms.ts:163-174`
  - `lobbyIntents.ts:105-107,112-115`
  - `socketPresence.ts:56`
- The owner-side emits go to `io.to(userRoom(userId))` through `gameError`/`roomError`
  (`tableHandlers.ts:111-116`). They exist only so the literal-event scans can see the event.
- The client uses the ack only for "never delivered" (`lib/sendIntent.ts:114-116`,
  `OnlineGameContext.tsx:867-878`). Everything it shows comes from `*:error`, so a channel
  change must keep `*:error` exactly as it is.

### The lobby port is half adopted (L-031)
- `LobbyPort` (`lobbyIntents.ts:18-37`) covers create, join and spectate. `room:rejoin`
  (`socketRooms.ts:105-135`), `room:setVisibility` (`:154-181`) and `room:quickmatch`
  (`:183-232`) run inline against `roomStore`.
- Quickmatch's join tail (`:206-218`) mirrors `joinRoomIntent` (`lobbyIntents.ts:80-94`), and
  its create fallback (`:222-229`) mirrors `createRoomIntent` (`:58-66`).

### Smaller items
- **L-047:** `socketGameplay.ts:80-181` has six handlers, each `atTable()` →
  `NOT_AT_A_TABLE` → `applyOrForward`, with rate limits that differ per event. The
  `protocolEvents.test.ts:62` and `socketEvents.test.ts:200` scans need the literal
  `onEvent(socket, "<event>"` shape.
- **L-048:** `takeoverMode` is an `if` chain that defaults to `"forward"`
  (`tableActions.ts:85-96`). The dispatcher's `default` must stay
  (`tableHandlers.ts:801-803`).
- **L-049:** pass-throughs that fail the deletion test:
  - the `socket.ts:41-46` barrel, used only by `routes.ts:30` and `timerContainment.test.ts:51`
  - the `recordPlayFlags` wrapper (`gameTurn.ts:51-54`)
  - three identical `{io, socket, userId}` context interfaces (`socketGameplay.ts:60-64`,
    `socketRooms.ts:41-45`, `socketPresence.ts:42-46`)
  - `EventOutcome = IntentReply` (`socketSafety.ts:145`)
- **L-055:** `roundOverSchema` (`shared/protocol.ts:160-169`) checks 6 of the 13 fields of
  `RoundOverPayload` (`lib/game/matchState.ts:185-221`). The client casts
  `as unknown as RoundOverPayload` and then falls back with `??`
  (`OnlineGameContext.tsx:657-677`). Every server emit site already sends all 13
  (`roundOver.ts:117-137,261-275`).
- **L-056:** `payload.ts:1-6` claims to be the one place a payload is built. Exceptions:
  - `gameTurn.ts:263-270` hand-builds English text.
  - `gameTurn.ts:346,376,415` call `translate(DEFAULT_LOCALE, …)` directly.
- **L-025:** `tableHandlers.ts` is 839 lines and holds:
  - rehydrate (`:135-183`)
  - play, pass and exchange (`:197-301`)
  - votes and the next deal (`:303-462`)
  - rejoin (`:464-506`)
  - startMatch (`:509-644`)
  - seat loss (`:653-739`)
  - the dispatcher (`:741-805`)
  - the orphan sweep (`:812-826`)
  - the wiring (`:833-837`)
  - The ready gate has two arithmetics: `votesUnanimous` is size ≥ `voterCount` (`:309-311`)
    and startMatch is `seatedIds.every(has)` (`:540-546`).
  - They agree on every reachable state, because the vote sets only ever hold seated ids
    (`seatLedger.ts:31,59`; `gameTurn.ts:325`). The duplicate arithmetic is a latent risk,
    not a live bug.
  - The "two next-round constructions" claim is withdrawn by verification: they differ by
    design (`:386-390`).

## 3. Alternatives considered

### 3a. The output port (L-026, L-035, L-037)

| | A. `TableRuntime` value threaded where `io` is today | B. Narrow structural Socket.IO subset | C. Ambient module outbox (`setOutbox`) | D. Handlers return an effect list, interpreted |
|---|---|---|---|---|
| Interface | `out.room(r).emit`, `out.user(u).emit`, `out.state(u, render)`, `presence`, `writers`, `route`, plus `transport` (the router only) | `type TableIo = { to(r): { emit; timeout } }`; real `io` passes unchanged | Same calls as A, with no parameter | `Effect[]` (emit, persist, arm, await-read) |
| Depth | Deep: ack retry, user-room addressing and presence-failure semantics live behind it | Shallow: the game still builds `userRoom()` strings and owns the retry | Deep, but hidden global wiring | Deepest test seam |
| Seam | Two real adapters (Socket.IO and recording) | One adapter, the type only | Two adapters, swapped by a setter | Two |
| Fixes L-035/L-037 | Yes: `writers` and `route` ride along, so both setters go | No | Adds a third setter | Yes |
| Migration | Mechanical parameter swap of the 44 sites, 13 test stubs → 1 helper | Smallest | Small | Rewrite: `handleRoundOver` awaits a read in the middle of its sequence (`roundOver.ts:107-114`), which an effect list cannot hold without an interpreter that is itself the old code |
| Scans | `out.room(r).emit("x"` keeps the literal `.emit("x"` the scans match (`socketEvents.test.ts:103-106`, `protocolEvents.test.ts:57-60`), so no scan changes | Unchanged | Same as A | Every event is computed, which the scans forbid |

**Pick A.**
- B leaves the leak (writers) and the setters exactly where they are.
- C contradicts L-037: the setters are the problem.
- D would turn a mechanical change into a rewrite of load-bearing ordering.
- A's interface is the four verbs the game layer actually uses (`server/CLAUDE.md` keeps
  `io.to(userRoom(...))` as the addressing rule, and the adapter keeps it). The method shape
  is chosen so the scans do not move.

### 3b. Where a refusal's words are emitted (L-050)

| | R1. Owner and `onEvent` each emit, wire reply unchanged | R2. The refusal carries its notice; only `onEvent` emits |
|---|---|---|
| Emitters | Two: `onEvent` for socket-local handlers, the dispatcher for table actions | One: `onEvent` (`errorEventFor(event)` already picks `room:error` for `room:start` and `game:error` for `game:*`, exactly today's channels) |
| Channel knowledge on the owner | A per-kind channel table | None |
| Cross-instance | Notice never crosses | Notice rides the `serverSideEmit` reply (JSON) and the `applied` replay cache |
| Rolling deploy | No gap | New owner to old socket instance: one toast lost per forwarded refusal during a two-revision window (ADR-0003). Old owner to new socket instance: old owner still emits itself, so nothing is lost |
| Internal callers (timer `startMatch`, seat-left deal) | Owner emits to a user who pressed nothing | Nothing is emitted, which matches `dealVotedRound`'s own rule (`tableHandlers.ts:326-329`) |

**Pick R2.**
- It deletes `gameError`/`roomError` and every per-site emit.
- The deploy gap is a lost toast, not a lost move: the ack still says `ok:false`. Murlan is
  not live (memory).
- The only internal caller whose notice disappears is `scheduleAutoStart` → `startMatch`
  (`socketTable.ts:384-389`). It can only reach the `closeForStart` refusal for a full
  waiting room with no live match, and quickmatch has already refused a wrong teams size, so
  in practice it is unreachable.

### 3c. Splitting `tableHandlers.ts` (L-025)

| | S1. Five-way split (the ledger's proposal) | S2. Extract what is deep; co-locate the two memory writers |
|---|---|---|
| New modules | tableMoves, tableVotes, tableState.nextRound, tableLifecycle, seatPresence | tableMoves (pure), tableVotes (one gate arithmetic), tableLifecycle (startMatch, rehydrate, resume) |
| Deletion test | seatPresence and nextRound are moves of code, not deepening, and nextRound unifies two constructions that verification says differ by design | Each new module hides a decision: legality, the gate, entry to memory |
| Conflicts | nextRound collides with the engine's L-004 (`dealNextRound`) | tableVotes is where the engine's L-004 will call in |

**Pick S2.** Seat loss, rejoin and the dispatcher stay in `tableHandlers.ts`, about 260
lines.

## 4. Target design

### 4.1 `server/shared/refusal.ts` (new; `payload.ts` moves next to it)

```ts
import type { ServerPayload } from "../../shared/protocol.ts";
import type { TranslationParams } from "../../shared/i18n.ts";
import { payload, type ServerCode } from "./payload.ts";

/** What a handler, lobby intent or table action answers. Never `void`. */
export type Outcome = { ok: true } | Refusal;
export interface Refusal {
  ok: false;
  code: string;
  /** The words the asking socket is shown; absent means a silent refusal (ack only). */
  notice?: ServerPayload;
}
export const OK: Outcome = { ok: true };
/** A refusal the player is told about, in the same code the ack carries. */
export function refuse<C extends ServerCode>(code: C, params?: TranslationParams): Refusal;
```

- **Invariant:** a refusal's code and its notice code are the same string, so the two
  channels cannot disagree. `refuse` is the only producer of `notice`, apart from the
  `game:rejoin` mapping below.
- **Silent refusals** keep the literal form `return { ok: false, code: "NOT_YOUR_TURN" }`.
  `refusalCodesTested` already reads that form.

### 4.2 `onEvent` (`server/socket/socketSafety.ts`)

```ts
export function onEvent<E extends keyof InboundSchemas>(
  socket: Socket, event: E, schema: InboundSchemas[E],
  handler: (p: z.infer<InboundSchemas[E]>, ctx: EventContext) => Outcome | Promise<Outcome>,
  options?: {
    limit?: number; windowMs?: number;
    /** Every refusal, wrapper-made or returned. Default: emit `errorEventFor(event)` with its notice, when it has one. */
    refuse?: (refusal: Refusal, raw: unknown) => void;
  }
): void;
```

- **Order, per intent:**
  1. Rate limit.
  2. Parse.
  3. Handler.
  4. On a refusal: `logRefusal` once, then `options.refuse` (it emits), then the ack
     `{ ok: false, code }`, with the notice stripped so the ack shape on the wire stays
     `IntentReply`.
  5. On a throw: `refuse(payload("SERVER_ERROR"))` plus the ack, as today.
- **`void` is no longer assignable to the handler's return type.** This is the compile-time
  half of "silent success cannot be written".
- **The runtime half is a scan.** No `.emit("…:error"` remains in `server/` except
  `socketSafety.ts` (the default) and `socketRegistry.ts` (`socket:error` SESSION_REVOKED,
  which is a push rather than a refusal). The scan asserts that exact list with `deepEqual`.
- **`game:rejoin`:**
  - Its `refuse` option maps `refusal.code` through `REJOIN_FAILURE` to the
    `game:rejoin_failed` payload with `roomId`, and stays the one `"game:rejoin_failed"`
    line (`i18n.test.ts:691-700`).
  - The handler's try/catch (`socketGameplay.ts:136-142`) is deleted: the wrapper's
    SERVER_ERROR now goes through the same `refuse`.
  - `REJOIN_FAILURE` becomes `Record<RejoinCode, …>` with an explicit SERVER_ERROR fallback,
    as today.

### 4.3 The table runtime (`server/game/tableRuntime.ts`, new)

```ts
type OutEvent = Exclude<keyof ServerToClientEvents, "game:state">;
export interface Emitter {
  emit<E extends OutEvent>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
}
export interface TableOutbox {
  room(roomId: string): Emitter;          // everyone in the Socket.IO room, every instance
  user(userId: string): Emitter;          // the account's user room, never a socket
  /** `game:state` to one account. If the ack does not come, `render(true)` is called once
   *  more and its result sent; `null` sends nothing. */
  state(userId: string, render: (retrying: boolean) => WireGameState | null): void;
}
export interface Presence {               // all asked of the cluster; none throws
  isOnline(userId: string): Promise<boolean>;                  // false when the cluster fails
  isAtTable(userId: string, roomId: string): Promise<boolean>; // false when the cluster fails
  tablePresence(roomId: string): Promise<{ online: Set<string>; atTable: Set<string> } | null>;
  /** null when the cluster did not answer — never read as "nobody" (the sweep disposes on it). */
  connectedUserIds(): Promise<Set<string> | null>;
}
export interface TableWriters extends RoundOverWriters {}       // the existing six, now the only path
export interface TablePorts {
  out: TableOutbox;
  presence: Presence;
  writers: TableWriters;
  /** Socket.IO itself. Only `tableRouter.ts` and `socket/seating.ts` read it (scan). */
  transport: SocketServer;
  // server-runtime adds: store: ActiveGameStore; (and its registry, if it builds one)
  // time adds: clock: Clock
}
export interface TableRuntime extends TablePorts {
  /** Today's applyOrForward: runs a table action wherever the table is. */
  route(draft: TableActionDraft): Promise<Outcome>;
}
export function createTableRuntime(ports: TablePorts): TableRuntime;
```

- **Construction**, once, in `setupSocket`:
  ```ts
  const rt = createTableRuntime({
    out: socketOutbox(io), presence: socketPresence(io),
    writers: tableWriters, transport: io,
  });
  ```
  `createTableRuntime` does three things:
  1. Builds `rt.route = (d) => applyOrForward(rt, d)`.
  2. Calls `registerTableRouting(rt)`.
  3. Calls `reopenOwnership({ onRoomLost: (roomId) => disposeGame(rt, roomId, false) })`.
- **The ordering invariant from `socket.ts:105-108` holds:** the routing listener is
  registered before the first connection.
- **Setters deleted:**
  - `setTableHandlers`: the router imports `applyTableAction`/`rehydrateGame` statically.
    Handlers no longer import the router; they call `rt.route`, so the cycle is gone.
  - `setRoomLostHandler`: becomes a `reopenOwnership` argument.
  - `installTableHandlers`.
- **`setSocketServer` stays** as the HTTP late binding, renamed `bindSocketRuntime(rt)`.
  `evictUser`, `announceRoom` and `__testables` need `rt`.
- **Socket adapter:** `server/socket/socketOutbox.ts` (new) implements `TableOutbox` and
  `Presence` over `io`:
  - `user(u)` is `io.to(userRoom(u))`.
  - `state` is today's `sendGameStateTo` body with the literal `.emit("game:state"`, so the
    scans still see the event.
  - `Presence` moves from `socketRegistry.ts:44-111`. The registry's exported `onlineUserIds`
    keeps its "empty on failure" contract for friends by calling
    `connectedUserIds() ?? new Set()`.
- **Recording adapter:** `tests/helpers/recordingRuntime.ts` (new).
  - Returns `{ rt, sent }`, where `sent: { to: {room}|{user}; event; args }[]` and
    `state()` calls `render(false)` immediately.
  - A `missAck(userId)` switch drives the one retry.
  - Presence is backed by settable sets.
  - The writers are recording fakes.
  - `transport` is a single-instance stub: `serverSideEmit` answers `[]` and `on` is a
    no-op. It holds the one cast in the repo.
- **Error modes:** `out.*` never throws. A send to an absent room is a no-op, as Socket.IO's
  is. `Presence` never throws.

### 4.4 One publish path (L-035), in `gamePersistence.ts`

```ts
/** Broadcast, then persist; the persist promise is returned so a disposer can order after it. */
export function publishState(rt: TableRuntime, game: OnlineGameState): Promise<unknown>;
/** Announce, mark finished (awaited, logged on failure), dispose. The one "close the table". */
export async function closeTable(
  rt: TableRuntime, roomId: string,
  notice: "GAME_INTERRUPTED_SERVER_ERROR" | "GAME_INTERRUPTED_EMPTY_SEAT" | null
): Promise<void>;
```

- **Ordering invariants these hold:**
  - `markExchangeSettled` runs before the first seat is served (`gamePersistence.ts:217-219`).
  - Persist runs before dispose (`roundOver.ts:170-174`).
- **Callers:**
  - `commitMove`, `dealRound`, the reclaim branch of `rejoinAction` and the tail of
    `vacateSeat` call `publishState`.
  - `safeTimer`, `runBotTurn` and the between-rounds last-leaver branch call `closeTable`.
    The last-leaver branch passes `null`, because `seat_bot_takeover` was already sent.
- **Arming stays at each caller,** because it differs per site.
- **`vacateSeat` drops its `writers` parameter** (`gameTurn.ts:317-320`). The "required, not
  defaulted" concern it carried is now `rt.writers`, which cannot be defaulted.

### 4.5 `tableHandlers.ts` split (L-025), with refusals as values

```ts
// server/game/tableMoves.ts — pure: no rt, no store, no clock
export type MoveAction = Extract<TableAction, { kind: "play" | "pass" | "exchange" }>;
export function decideMove(game: OnlineGameState, a: MoveAction):
  | Refusal
  | { next: GameState; move: CommittedMove | null; seat: number; firstPlay: boolean };

// server/game/tableVotes.ts
/** The one vote arithmetic: every seat a human holds has voted. Bots and vacated seats abstain. */
export function everySeatedVoted(votes: ReadonlySet<string>, game: OnlineGameState): boolean;
export function rematchVoteAction(rt: TableRuntime, game: OnlineGameState, a: RematchVote): Promise<Outcome>;
export function endMatchVoteAction(rt: TableRuntime, game: OnlineGameState, a: EndMatchVote): Promise<Outcome>;
export function dealIfSeatLeftGateClosed(rt: TableRuntime, roomId: string): Promise<Outcome>;

// server/game/tableLifecycle.ts — the only two writers of activeGames (tableOwnership.test.ts)
export function startMatchAction(rt: TableRuntime, a: StartMatch): Promise<Outcome>;
export function rehydrateGame(rt: TableRuntime, roomId: string, forUserId: string | null): Promise<RehydrateOutcome>;
export function resumeOrphanedTables(rt: TableRuntime): Promise<void>;

// server/game/tableHandlers.ts — dispatcher, seat loss, rejoin
export function applyTableAction(rt: TableRuntime, action: TableAction): Promise<Outcome>;
```

- **`decideMove`** owns the following, all returned rather than emitted:
  - `PLAY_REFUSAL_CODES` and the `roundOver` → `NO_LIVE_GAME` guard
  - the exchange-pending guard, as `refuse("EXCHANGE_PENDING")`
  - the turn guard, as the silent `NOT_YOUR_TURN`
  - the `MUST_PLAY_START_CARD` params
  - the flag recording, as a returned decision; the dispatcher calls `recordPlayFlags` from
    `lib/game/autoMove.ts` directly, which deletes the `gameTurn.ts` wrapper
- **The dispatcher** applies a decision as:
  `trackEvent` (first move) → `commitMove(rt, game, next, move)`.
- **Kind table (L-048)**, in `tableActions.ts`:
  ```ts
  export const TAKEOVER = { … } as const satisfies Record<TableActionKind, Mode>
  ```
  - `takeoverMode(kind)` becomes `TAKEOVER[kind]`.
  - The dispatcher's `default:` assigns `action satisfies never` for the compiler and still
    returns `UNKNOWN_ACTION` at runtime, for forwards from a newer revision.

### 4.6 The lobby port, completed (L-031)

```ts
export interface LobbyPort {             // `refuse` is gone: intents return Outcome
  userId: string; socketId: string;
  store: Pick<typeof roomStore,
    "createRoom" | "addRoomPlayer" | "getRoomPlayers" | "getRoomByCode" | "getRoomById"
    | "claimRoomSeat" | "updateRoomVisibility" | "findWaitingPublicRooms">;
  watching: Map<string, string>;
  seat(roomId: string): Promise<void>;
  sendState(state: WireRoomState): void;
  broadcastState(roomId: string, state: WireRoomState): void;
  join(roomId: string): void; leave(roomId: string): void;
  roomState: typeof roomStatePayload;
  table(draft: TableActionDraft): Promise<Outcome>;
  announceFilled(room: …, seated: number): Promise<void>;
  announceChanged(roomId: string): Promise<void>;      // new: setVisibility
  clearLobbyGrace(roomId: string, userId: string): void; // new: rejoin
  track: typeof trackEvent;
}
export function createRoomIntent(port, p, opts?: { visibility: "public"; autoStart: true }): Promise<Outcome>;
export function joinRoomIntent(port, p): Promise<Outcome>;
export function spectateRoomIntent(port, p): Promise<Outcome>;
export function rejoinRoomIntent(port, p: { code: string }): Promise<Outcome>;
export function setVisibilityIntent(port, roomId: string | null, p: { visibility }): Promise<Outcome>;
export function quickmatchIntent(port, p: { maxPlayers; gameMode }): Promise<Outcome>;
```

- **Quickmatch:** the candidate loop stays its own (`socketRooms.ts:195-210`). A successful
  claim goes through the same claim-tail helper as `joinRoomIntent`
  (seat → roster → broadcast → `announceFilled`). The fallback is
  `createRoomIntent(port, p, { visibility: "public", autoStart: true })`.
- **Out of scope:** `room:leave`, `room:start` and `room:unspectate` already delegate
  (`handleSeatRelease`, `route`, `stopSpectating`), so they stay inline.
- **`teamsSizeRefusal(gameMode, count): Refusal | null`** loses its sink parameter
  (`socketTable.ts:128-137`).

### 4.7 Registration (L-047, L-049)

```ts
// socketGameplay.ts: the literal stays at every call site, so the scans see it
const atTable = (toDraft: (p) => DraftBody) => async (p, { intentId }): Promise<Outcome> => {
  const roomId = socketRoomMap.get(socket.id);
  if (!roomId) return { ok: false, code: "NOT_AT_A_TABLE" };
  return rt.route({ ...toDraft(p), roomId, userId, intentId });
};
onEvent(socket, "game:play", GamePlaySchema, atTable(({ cardIds }) => ({ kind: "play", cardIds })), { limit: GAME_ACTION_RATE_LIMIT, windowMs: 60_000 });
// … pass, rematch_vote, end_match_vote, reaction, exchange_give_card; game:rejoin stays apart
```

- **One `HandlerContext`** in `socketTypes.ts`, `{ rt, io, socket, userId }`, replaces the
  three identical interfaces. Before S-OUT-3 it is `{ io, socket, userId }`.
- **The `socket.ts:41-46` barrel is deleted.** `routes.ts:30` and `timerContainment.test.ts:51`
  import from `socketRegistry.ts`.
- **`EventOutcome` is deleted;** callers use `Outcome`.

### 4.8 `roundOverSchema` (L-055)

- **`shared/protocol.ts`:** every one of the 13 fields is required, still `.passthrough()`
  for fields a newer server adds. Field types:
  - `matchLength`: `MatchLengthSchema`
  - `ratingsAfter`: required
  - `scores[]`: carries `ScoreLine`'s fields
  - Export `type RoundOverPayload = z.infer<typeof roundOverSchema>`.
- **`lib/game/matchState.ts`** re-exports it (the `ScoreLine` and `RatingAfter` interfaces
  stay as the element shapes the schema is written against).
- **`OnlineGameContext.tsx` `onRoundOver`** reads `parsed.data` with no cast and no `??`
  fallbacks.
- **`PROTOCOL_VERSION` bumps** with its hash recorded. `MIN_PROTOCOL_VERSION` stays: every
  server emitter in the field already sends all 13 fields
  (`roundOver.ts:117-137,261-275`; the rejoin re-send at `socketTable.ts:205` is the same
  object).

### 4.9 Payloads (L-056)

- `gameTurn.ts:263-270` becomes `...payload(exchanged ? "PLAYER_AFK_AUTO_EXCHANGE" :
  "PLAYER_AFK_AUTO_PASS", { username })`.
- `:341-348,:373-378,:410-417` become `...payload("PLAYER_LEFT_BOT_TAKEOVER"|"PLAYER_LEFT_ABANDONED", { username })`.
- `gameTurn.ts` drops its `translate`/`DEFAULT_LOCALE` import.
- **Wire output is byte-identical:** `payload()` builds the same `{code, message, params}`
  (`payload.ts:13-15`), and `en.ts` has the keys. This is a no-behaviour change, pinned by a
  snapshot of the emitted object.

### Deleted

- `gameError`/`roomError` and every per-site `*:error` emit outside `onEvent`.
- `EventResult`'s `void`, `EventOutcome`, `LobbyPort.refuse` and the `teamsSizeRefusal` sink.
- `setTableHandlers`, `setRoomLostHandler`, `installTableHandlers` and the 44
  `io: SocketServer` parameters in `server/game`.
- The `vacateSeat` `writers` parameter, the two duplicate close-table copies, the
  `recordPlayFlags` wrapper and the `socket.ts` barrel.
- The three context interfaces, the six `atTable` bodies and the `REJOIN_FAILURE` try/catch.
- The cast and the `??` fallbacks in `onRoundOver`, and 20 test casts.

## 5. Migration (each step leaves main green)

1. **S-OUT-1 — refusals are values.**
   - Add `server/shared/{refusal,payload}.ts` (`payload.ts` moved; `server/http/*` and
     `socket/*` importers re-pointed). `onEvent` takes `Outcome`, and every handler returns
     one.
   - Convert every site in section 2 (refusals).
   - Teach `refusalCodesTested` to read `refuse("X")` calls.
   - Add the `*:error` emit scan.
   - Do the payload sites in `gameTurn.ts` (L-056).
   - *Deletes:* `gameError`/`roomError`, `EventOutcome`, `EventResult`'s void,
     `LobbyPort.refuse`, the teams sink.
2. **S-OUT-2 — lobby port and registration.**
   - The three lobby intents, the `atTable` helper and one `HandlerContext`.
   - The barrel goes, and the `TAKEOVER` record goes in.
   - *Deletes:* about 90 inline lines in `socketRooms.ts`, six handler bodies, three
     interfaces, the barrel and `takeoverMode`'s if-chain.
3. **S-OUT-3 — the runtime.**
   - First commit: pin today's emit order on the recording stubs (section 6).
   - Then: `tableRuntime.ts`, `socketOutbox.ts` and `recordingRuntime.ts`; swap the 44
     parameters and the socket-family call sites to `rt`.
   - Fold the writers in, and add `publishState`/`closeTable`.
   - Delete the setters; migrate the 13 test stubs.
   - *Deletes:* the setters, `installTableHandlers`, the duplicate close-table copies, 20
     casts.
4. **S-OUT-4 — the split and the layering.**
   - Add `tableMoves`, `tableVotes` and `tableLifecycle`.
   - Move `logger.ts`'s base logger to `server/shared/logger.ts` (`createRequestLogger` stays
     in `http/` and imports it).
   - Move `emit.ts` to `server/game/tableBroadcasts.ts` and `events.ts` to
     `server/shared/events.ts`.
   - Add an exact-list import-direction scan.
   - *Deletes:* the second gate arithmetic, the 38-line narration header (replaced by a
     pointer), the `recordPlayFlags` wrapper.
5. **S-OUT-5 — round_over schema.** Independent of 1–4.

## 6. No-regression strategy

**Pinned before the move (first commit of each ticket):**

- **S-OUT-1, red then green:**
  - `tests/integration/intentAcknowledged.test.ts` gains three cases: `room:join` to a full
    room, `room:join` to an unknown code, and `room:rejoin` from a non-member. Each acks
    `{ok:false, code}` (red today: `ok:true`), and each still emits exactly one `room:error`
    with the same payload.
  - `tests/server/socketSafety.test.ts` (or the existing onEvent test) gains a handler that
    returns `refuse("ROOM_FULL")`. It must log once, emit `room:error` once and ack
    `{ok:false, code:"ROOM_FULL"}` with no `notice` key.
  - `tests/server/lobbyIntents.test.ts`: assertions move from `calls` containing
    `refuse X` to the returned Outcome.
  - A routed refusal (`game:pass` during an exchange, through the router) must still reach the
    asking socket as one `game:error`. This is already pinned in
    `gameplay.test.ts:169`; keep it unchanged.
- **S-OUT-3, characterisation, green before and after:** a new
  `tests/server/publishOrder.test.ts` records the event and writer order for:
  - `commitMove`, mid-round and round-ending
  - `dealRound`: status write → `game:state` per seat → `game:started` → `game:match_state`
    → persist → `game:turn_deadline`
  - `vacateSeat`: all three branches
  - `closeTable` via `safeTimer`

  It is written first against today's `stubIo` plus `t.mock` writers, then ported to the
  recording runtime unchanged.
- **S-OUT-3, red then green:** "`dealRound` with fake writers writes the room status through
  them" is red today (`dealRound.ts:40` calls `roomStore` directly).
- **S-OUT-3, sweep safety:** a sweep whose `connectedUserIds()` returns `null` disposes
  nothing. This is new, because today's throw-path relies on the sweeper's outer catch.
- **S-OUT-4:**
  - A property-style unit test: `everySeatedVoted` agrees with the old size arithmetic on every
    state reachable through `seatLedger`/`vacateSeat`, and differs on a hand-built set that
    holds an unseated id.
  - `decideMove` unit tests for every `PLAY_REFUSAL_CODES` entry, `NOT_YOUR_TURN`,
    `EXCHANGE_PENDING` and `CANNOT_PASS`, with no rt and no db.
- **S-OUT-5, red then green:** `roundOverSchema.safeParse` refuses a payload without
  `matchContinues` (today it passes).

**Scans that move or change:**
- **Unchanged by design:** `socketEvents.test.ts` and `protocolEvents.test.ts`. The
  `.emit("literal"` shape is kept in `out.room/user(...).emit` and in the adapter's
  `game:state`. `onEvent(socket, "literal"` is kept, and `WRAPPED_EVENT_COUNT` stays 18.
- **`tableOwnership.test.ts`:**
  - "writers of activeGames" moves from `game/tableHandlers.ts` to `game/tableLifecycle.ts`
    (S-OUT-4).
  - The kind-enumeration test iterates `TAKEOVER` (S-OUT-2).
  - Every `installTableHandlers` becomes `recordingRuntime()` (S-OUT-3).
- **`refusalCodesTested.test.ts`:** the `literalsOf` helper-parameter rule is generalised to
  an imported `refuse`. This is not an exemption of `refusal.ts`: its codes are read at the
  call sites.
- **`deal.test.ts:259`** reads `tableHandlers.ts` for `dealFirstSeatFor(game.matchOver,`, so
  it is re-pointed to `tableVotes.ts` in S-OUT-4.
- **`i18n.test.ts:691`:** the rejoin-failed literal stays in `socketGameplay.ts`.
- **`logRedaction.test.ts:217`:** the file list follows `lobbyIntents.ts` (unchanged path).
- **`socketErrorLogging.test.ts:22-29`:** the family list is unchanged.

**Which check catches what:**
- **Ordering and emit-address regressions:** `npm test` (the server unit tests on the
  recording runtime) and the integration suite (Postgres plus real sockets).
- **Cross-instance forwarding of the notice:** `tests/integration/takeoverSerialised.test.ts`
  and the two-instance router tests.
- **Protocol drift:** `protocolVersion.test.ts`.
- **Layout:** none of these tickets touches rendering. `tests/e2e/` is not needed beyond CI's
  usual run.

## 7. Coverage table

| ID | Covered by | Note |
|---|---|---|
| L-025 | S-OUT-4 | S2 split: `tableMoves` (pure), `tableVotes` (one gate arithmetic, `everySeatedVoted`), `tableLifecycle` (the two `activeGames` writers). "Two next-round constructions" dropped per verification; the engine's L-004 may unify them later. |
| L-026 | S-OUT-3 | `TableRuntime.out`/`presence` with two adapters; the 44 parameters and 20 casts go. The router keeps Socket.IO as `rt.transport`. |
| L-031 | S-OUT-2 | rejoin, setVisibility and quickmatch move behind `LobbyPort`; quickmatch reuses the join tail and `createRoomIntent`. leave, start and unspectate stay (they already delegate). |
| L-035 | S-OUT-3 | `rt.writers` is the only path; `publishState` and `closeTable`; `vacateSeat` loses its parameter. |
| L-037 | S-OUT-3 (setters), S-OUT-4 (moves and scan) | `setTableHandlers` and `setRoomLostHandler` deleted. `setSocketServer` is kept as HTTP late binding (`app.ts:248-251`) and renamed. `setClock` belongs to the time area. The `roomStore`→`game` edge belongs to server-runtime (L-046). |
| L-047 | S-OUT-2 | `atTable(toDraft)` returns the handler; the literal `onEvent(socket, "game:…"` stays, so no scan changes. |
| L-048 | S-OUT-2 | `TAKEOVER satisfies Record<TableActionKind, Mode>`; `satisfies never` plus the runtime `default` in the dispatcher. |
| L-049 | S-OUT-1 (`EventOutcome`), S-OUT-2 (barrel, contexts), S-OUT-4 (`recordPlayFlags`) | `routes.ts:30` import re-pointed (one http-area line). |
| L-050 | S-OUT-1 | R2: the refusal carries its notice; `onEvent` is the one emitter. `void` returns become a type error, and a scan pins the remaining `*:error` emit sites. |
| L-055 | S-OUT-5 | Full schema, `z.infer` type, no client cast; `PROTOCOL_VERSION` bump, MIN unchanged. |
| L-056 | S-OUT-1 | 4 sites become `payload()`; wire output identical. |

## 8. Proposed tickets

### S-OUT-1 — A refusal is a returned value; `onEvent` alone says it (M)
- **Files:**
  - Moved to `server/shared/`: `refusal.ts` (new) and `payload.ts` (from `server/socket/`).
  - Socket layer: `socketSafety.ts`, `lobbyIntents.ts`, `socketRooms.ts`,
    `socketGameplay.ts`, `socketPresence.ts`, `socketTable.ts`.
  - Game layer: `tableHandlers.ts` (all refusal sites, `dealVotedRound`'s refuse),
    `tableRouter.ts` (types), `gameTurn.ts` (L-056).
  - Importers of `payload`: `server/http/{validate,errorHandler,routes}.ts`, import lines
    only.
  - Tests: `tests/tooling/refusalCodesTested.test.ts`,
    `tests/server/{lobbyIntents,socketEvents}.test.ts`,
    `tests/integration/intentAcknowledged.test.ts`.
- **Blocked by:** none within this design. Never in parallel with http-area tickets editing
  `routes.ts` import lines, or with static-checks tickets editing `refusalCodesTested`.
- **DoD:**
  - [ ] The handler type rejects `void`, and every `onEvent` handler returns an `Outcome`.
  - [ ] No `.emit("…:error"` in `server/` outside `socketSafety.ts` and `socketRegistry.ts`
        (new exact-list scan).
  - [ ] The three `intentAcknowledged` cases are red first, then green. `room:error`
        payloads are unchanged (existing integration assertions untouched).
  - [ ] A routed refusal's notice reaches the asking socket once. The owner emits no
        `*:error`.
  - [ ] `game:rejoin`'s failures all go through its `refuse` option, and the handler's
        try/catch is gone.
  - [ ] `gameTurn.ts` has no `translate(` and no hand-built `{code,message}`.
  - [ ] `refusalCodesTested` reports no unread code.
- **Checks:**
  - While iterating: `node --test tests/server/lobbyIntents.test.ts
    tests/server/socketEvents.test.ts tests/tooling/refusalCodesTested.test.ts` and
    `npm run typecheck`.
  - Before pushing: `npm test`, plus `intentAcknowledged`, `gameplay`, `rematch` and
    `roomVisibility` from `tests/integration` (DATABASE_URL per `docs/agents/checks.md`).

### S-OUT-2 — The lobby port is whole; gameplay registration is one line per event (S)
- **Files:**
  - Socket layer: `lobbyIntents.ts`, `socketRooms.ts`, `socketGameplay.ts`,
    `socketPresence.ts`, `socketTypes.ts`, `socket.ts`.
  - Game layer: `tableActions.ts`, `tableHandlers.ts` (default case).
  - `server/http/routes.ts:30` (import line).
  - Tests: `tests/integration/timerContainment.test.ts:51`,
    `tests/server/{lobbyIntents,tableOwnership}.test.ts`.
- **Blocked by:** S-OUT-1.
- **DoD:**
  - [ ] `rejoinRoomIntent`, `setVisibilityIntent` and `quickmatchIntent` are exported and
        unit-tested with port fakes (no Postgres). Quickmatch's join path calls the same
        claim tail as `joinRoomIntent`.
  - [ ] Each gameplay `onEvent` is a one-liner through `atTable`. `WRAPPED_EVENT_COUNT`
        stays 18.
  - [ ] One `HandlerContext`; the barrel is deleted.
  - [ ] `TAKEOVER` is a `Record<TableActionKind, Mode>`. The dispatcher has `satisfies never`
        and the runtime `default`. The tableOwnership kind test iterates the record.
- **Checks:**
  - While iterating: `node --test tests/server/lobbyIntents.test.ts
    tests/server/tableOwnership.test.ts`.
  - Before pushing: `npm test`, plus `tests/integration/{quickmatchAutoStart,lobbyGrace,roomVisibility,seatHold}.test.ts`.

### S-OUT-3 — The table runtime: one output port, one writers seam, no setters (L)
- **Files:**
  - New: `server/game/tableRuntime.ts`, `server/socket/socketOutbox.ts`,
    `tests/helpers/recordingRuntime.ts`, `tests/server/publishOrder.test.ts`.
  - Game layer: `tableHandlers.ts`, `gameTurn.ts`, `gamePersistence.ts`, `roundOver.ts`,
    `dealRound.ts`, `tableRouter.ts`, `gameOwnership.ts` (`reopenOwnership` argument).
  - Socket layer: `emit.ts`, `socketTable.ts`, `seating.ts`, `socketRegistry.ts`,
    `socket.ts`, `socketGameplay.ts`, `socketRooms.ts`, `socketPresence.ts`.
  - Tests: the 13 test files with stubs, plus `ownershipReclaim` and `takeoverSerialised`.
- **Blocked by:** S-OUT-2. Never in parallel with any server-runtime or time ticket that edits
  `server/game/*` or `gameOwnership.ts`. Those are blocked by this ticket instead (section 9).
- **DoD:**
  - [ ] `publishOrder.test.ts` lands first, green on today's code, and is unchanged after
        the port.
  - [ ] No `SocketServer` in `server/game/` except `tableRuntime.ts` (the `transport` type)
        and `tableRouter.ts`, enforced by a scan.
  - [ ] The test suite has no `as unknown as SocketServer`, except the helper's one.
  - [ ] `commitMove`, `dealRound`, `vacateSeat` and rejoin-reclaim write only through
        `rt.writers`. The dealRound-writers test is red first, then green.
  - [ ] One `closeTable`, and the three copies are gone.
  - [ ] A sweep with `connectedUserIds() === null` disposes nothing.
  - [ ] `setTableHandlers`, `setRoomLostHandler` and `installTableHandlers` are deleted, and
        the router listener is still registered before the first connection.
  - [ ] `game:state` keeps its one re-derived retry (unit test via `missAck`).
- **Checks:**
  - While iterating: `npm run typecheck` and `node --test tests/server/*.test.ts`.
  - Before pushing: `npm test` and the full `tests/integration` suite. It is the only
    multi-instance coverage (takeover, reconnect, rematch).

### S-OUT-4 — Split `tableHandlers.ts` by decision; game/ stops importing socket/ and http/ (M)
- **Files:**
  - New: `server/game/{tableMoves,tableVotes,tableLifecycle}.ts`,
    `server/shared/logger.ts`.
  - Moved: `server/socket/emit.ts` → `server/game/tableBroadcasts.ts`; `server/socket/events.ts`
    → `server/shared/events.ts`.
  - Logger importers: import lines only.
  - Tests: `tests/server/{tableOwnership,tableMoves,tableVotes}.test.ts`,
    `tests/engine/deal.test.ts:259`, `tests/server/layering.test.ts` (new).
- **Blocked by:** S-OUT-3, plus server-runtime's ActiveGameStore and matchLedger tickets
  (L-024, L-036) if they exist. Never in parallel with the engine's L-004/L-011 server
  adoption.
- **DoD:**
  - [ ] `decideMove` is pure, with unit tests per refusal code.
  - [ ] `everySeatedVoted` is the only vote arithmetic (rematch, startMatch, end-match), with
        its equivalence test.
  - [ ] `activeGames` writers sit only in `tableLifecycle.ts` (scan updated), and
        `tableHandlers.ts` is ≤ 300 lines.
  - [ ] The `recordPlayFlags` wrapper is gone, and the header narration is replaced by a
        pointer.
  - [ ] `layering.test.ts` asserts with `deepEqual` the exact set of `server/game` imports
        from `../socket/` and `../http/`. The expected set is `socketTypes.ts` (type),
        `socketTable.ts`, `seating.ts`, `testOnlyEnv.ts` and retention's three constants, so
        a new edge or a removed edge fails.
- **Checks:**
  - While iterating: `node --test tests/server/tableMoves.test.ts
    tests/server/tableVotes.test.ts tests/server/tableOwnership.test.ts`.
  - Before pushing: `npm test` and `tests/integration/{gameplay,rematch,teamsOnline,reconnect}.test.ts`.

### S-OUT-5 — `game:round_over` is parsed whole; the client stops guessing (S)
- **Files:** `shared/protocol.ts`, `tests/fixtures/protocolHashes.json`,
  `lib/game/matchState.ts`, `context/OnlineGameContext.tsx` (`onRoundOver`), plus
  `tests/server/protocol*.test.ts` and native tests touching `onRoundOver`.
- **Blocked by:** none in this design. Never in parallel with client-area tickets editing
  `OnlineGameContext.tsx`.
- **DoD:**
  - [ ] The schema requires all 13 fields and keeps `.passthrough()`.
  - [ ] `RoundOverPayload` is `z.infer<typeof roundOverSchema>`.
  - [ ] There is a red-then-green missing-field test.
  - [ ] `onRoundOver` has no `as unknown as` and no `??` fallback for a schema field.
  - [ ] `PROTOCOL_VERSION` is bumped, with the hash recorded; MIN is unchanged.
- **Checks:**
  - While iterating: `node --test tests/server/protocolVersion.test.ts` and
    `npm run test:native:related`.
  - Before pushing: `npm test`, `npm run test:native`, and `tests/integration/{reconnect,ladderAndReplay}.test.ts`.

**Order:** S-OUT-1 → S-OUT-2 → S-OUT-3 → S-OUT-4. S-OUT-5 is free.

## 9. Cross-area contracts

- **server-runtime (gives and needs):**
  - **I give** `TablePorts`/`TableRuntime` in `server/game/tableRuntime.ts`, landed by
    S-OUT-3. server-runtime adds fields to `TablePorts`: `store: ActiveGameStore` (L-024),
    and its registry if it replaces the raw `activeGames` map. It must not add a second
    injection object.
  - **Ordering:** every server-runtime ticket that edits `server/game/{tableHandlers,
    gamePersistence,gameTurn,roundOver,dealRound}.ts` or `gameOwnership.ts` is blocked by
    S-OUT-3 and blocks S-OUT-4. This covers L-022 shutdown timers, L-027 claim errors, the
    L-028 tombstone in `disposeGame`, L-036 matchLedger and L-040 deal status write.
  - **What I need:** `rehydrateGame`/`resumeOrphanedTables` read through `rt.store` once
    L-024 lands. S-OUT-4 moves them, store calls included, into `tableLifecycle.ts`.
  - **matchLedger owns writes; `tableVotes` owns the gate.** matchLedger (L-036) owns writes
    to `rematchVotes` and the score fields. `tableVotes.everySeatedVoted` only reads.
  - **`disposeGame` signature:** `disposeGame(rt, roomId, deleteRow?)` after S-OUT-3. The
    tombstone goes inside it.
  - **Ownership seam:** `reopenOwnership({ onRoomLost })` replaces the setter. L-027/L-028
    edit the same file after S-OUT-3.
- **time:** `clock: Clock` joins `TablePorts` after S-OUT-3 (L-019). `setClock` is theirs to
  keep or retire.
- **engine:**
  - L-011's "record flags at commitMove" lands after S-OUT-4. The wrapper is already gone, so
    `tableHandlers`'s one direct `recordPlayFlags` call moves into `commitMove`.
  - L-004's `dealNextRound` replaces the construction inside
    `tableVotes.ts`/`tableLifecycle.ts`, not `tableHandlers.ts`. The two are never in
    parallel with S-OUT-4.
- **http:**
  - S-OUT-1 and S-OUT-2 each change import lines in `server/http/routes.ts` (`payload` path,
    the barrel at `:30`) and `validate.ts`/`errorHandler.ts`. They are never in parallel with
    a routes split.
  - `setSocketServer` stays HTTP's late binding (renamed `bindSocketRuntime`, S-OUT-3).
    `evictUser` and `revokeAccountSockets` keep their signatures.
- **client:** S-OUT-5 edits `OnlineGameContext.tsx` `onRoundOver` (`:642-688`). Order it
  against any client ticket on that file. The `*:error` channel and the ack shape
  (`IntentReply`) are unchanged by S-OUT-1, so `lib/sendIntent.ts` needs nothing.
- **static-checks:** S-OUT-1 edits `refusalCodesTested.test.ts`. S-OUT-1 and S-OUT-3 add
  exact-list scans (`*:error` emit sites, `SocketServer` in `game/`). S-OUT-4 adds
  `layering.test.ts`. All are deepEqual lists, so none loosens itself.
- **test-harness:** `tests/helpers/recordingRuntime.ts` is new in S-OUT-3, and it is the place
  future table tests build a runtime. A harness ticket restructuring `tests/helpers` should
  follow S-OUT-3.

## 10. Owner decisions needed

None. Two technical calls are decided here and are recorded for review:

1. **R2 (the refusal travels back with its notice) accepts one lost toast per forwarded
   refusal during a two-revision deploy window.** The ack still refuses. Murlan is not live.
2. **A refusal of the matchmade auto-start timer's own `startMatch` no longer toasts the
   host.** No one pressed anything, and the path is unreachable in practice (section 3b).

No ADR, `CONTEXT.md` or `docs/GAME-RULES.md` decision is contradicted:
- ADR-0003's multi-instance router is kept intact as `rt.route`.
- `server/CLAUDE.md`'s rule of addressing an account rather than a socket is kept inside
  `out.user()`.
