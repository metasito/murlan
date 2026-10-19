# Murlan design audit — merged ledger

238 entries from 301 source findings (178 slice, 123 area-report). Machine-readable: `ledger.json`.

## Summary

### Theme × priority

| Theme | P1 | P2 | P3 | Total |
|---|---:|---:|---:|---:|
| Engine purity & domain model | 5 | 7 | 6 | 18 |
| Time & randomness seams | 2 | 1 | 0 | 3 |
| Server table runtime | 5 | 11 | 12 | 28 |
| Wire & transport contracts | 1 | 3 | 3 | 7 |
| Client state & providers | 3 | 13 | 15 | 31 |
| Table UI & components | 4 | 11 | 15 | 30 |
| Test support & test architecture | 4 | 27 | 26 | 57 |
| Loop & CI tooling | 3 | 8 | 31 | 42 |
| Dependencies, dead code & hygiene | 0 | 0 | 15 | 15 |
| Native modules, device flows | 0 | 4 | 3 | 7 |
| **All** | 27 | 85 | 126 | 238 |

### By kind

| Kind | Entries |
|---|---:|
| structure | 78 |
| test | 56 |
| defect | 39 |
| tooling | 33 |
| perf | 13 |
| dead-code | 11 |
| resilience | 8 |

### By status

| Status | Entries |
|---|---:|
| open | 234 |
| contested | 4 |

Entries that conflict with a recorded decision: L-015, L-018, L-061, L-141, L-144, L-217.

## Engine purity & domain model

**Target shape.** Every rule, verdict and derived fact about a round lives in lib/game behind a few deep functions (applyMove, a match-flow module, a lastMove record, an injectable RandomSource). Server, offline table, tutorial, bots and UI ask the engine instead of re-deriving, and lib/game holds only domain code.

- **L-001** P1/S · defect — The verdict on restore is derived differently from the live verdict (a latent bug) (after L-004)
  - two implementations answer "is this match decided?" (the comment at `gameEngine.ts:1325` claims one).
  - sources: domain-F4, 04-lib-shared-F1
- **L-002** P1/S · structure — A server rule mutates engine state outside the engine
  - `gameTurn.ts:339-356` (`concedeRound`) writes `finishPosition`, `finishingOrder` and `roundOver` in place on `game.gameState`.
  - sources: domain-F10, server-F5
- **L-003** P1/M · defect — The offline bot's exchange choice bypasses `autoMove.ts`, and the guard tests cannot see it
  - CLAUDE.md's invariant says one module chooses a bot's move.
  - sources: domain-F1
- **L-004** P1/M · structure — The match lifecycle (start, fold a round, roll forward, deal next) has no module and exists three times (after L-005)
  - The domain logic sits behind a React provider (the wrong seam), so it cannot be tested through an interface and gets copied instead.
  - sources: domain-F2
- **L-005** P1/L · structure — `GameState` has no record of what just happened, so consumers diff fields and invent keys
  - The UI depends on the engine's internal ordering of field writes, which is a leaky interface.
  - sources: domain-F3
- **L-006** P2/XS · structure — The stuck-exchange safety valve is kept at three sites for a state the rules make unreachable in a dealt round
  - Why it is unreachable: `getValidGivebackCards` (`gameEngine.ts:987-998`) falls back to the lowest card for any non-empty eligible hand.
  - sources: domain-F16, 04-lib-shared-F5
- **L-007** P2/S · structure — `FoldRoundInput` is a wide, closure-based interface with dead flexibility
  - the interface is shallow relative to its implementation.
  - sources: domain-F5
- **L-008** P2/S · defect — The team has two sources of truth
  - `Player.team` is optional and supplied by callers.
  - sources: domain-F9
- **L-009** P2/M · structure — "What the table demands of the seat on move" is derived in five places, and `startCard`/`firstPlayMade` encode one obligation in two fields
  - "What the table demands of the seat on move" is derived in five places (checkSelection at gameEngine.ts:490, autoMove.ts:97-103, stagedPlay.ts:40-45, GameTable.tsx:1620, offlineMatch's weakestBeatingPlay).
  - sources: domain-F6
- **L-010** P2/M · structure — Three transitions use three error modes, and every caller pre-checks
  - `processPlay` throws (`assertPlayable`, `:690-710`).
  - sources: domain-F7
- **L-011** P2/M · structure — `autoMoveForSeat` reports its result through a callback and an in-place mutation; achievement flags are recorded at three sites
  - `autoMove.ts:54-69` and `105-143`: `ctx.onMove` and `ctx.roundFlags` are mutated.
  - sources: domain-F8
- **L-012** P2/M · structure — Type weaknesses that make callers carry invariants
  - `playedRanks?` stays optional "for a round persisted before the tally existed" (`gameEngine.ts:103-112`).
  - sources: domain-F12
- **L-013** P3/XS · dead-code — Pass-throughs (each fails the deletion test)
  - `lib/exchangeCeremony.ts` (`exchangeAnnounceMs` equals `exchangeAnnounceFrom`) `server/game/replayShape.ts:30` (`startReplayLog` returns `[]`) `gameTurn.ts:104-106` (the `recordPlayFlags` wrapper) `onlineGameLogic.ts:324` (`ScoreboardRow = ScoreLine`)
  - sources: domain-F15, 04-lib-shared-F6
- **L-014** P3/XS · structure — Bot seat-key format is defined twice
  - three spellings of one key format.
  - sources: 04-lib-shared-F7
- **L-015** P3/S · structure — Non-domain modules sit inside `lib/game` (**conflicts**)
  - `sharedGameFlow.ts` imports `react` (`useExchangeAnnouncement`) in a folder that otherwise loads under `node --test`.
  - sources: domain-F14
- **L-016** P3/S · structure — The placement-points rule is duplicated
  - `server/game/stats.ts:33-35` (`pointsForPlacement`, "mirroring … `scoreRound` exactly").
  - sources: domain-F17
- **L-017** P3/S · structure — `botChoosePlay` takes nine positional parameters, five of them optional
  - `bot.ts:221-231`.
  - sources: domain-F18
- **L-018** P3/M · structure — `gameEngine.ts` is a 1525-line module with about ten responsibilities (**conflicts**; after L-010)
  - `gameEngine.ts` is 1525 lines with about ten responsibilities (cards and deck, combinations and beat rules, legal plays, trick state machine, display helpers, exchange, opening predicates, teams and deal rotation, round construction, match scoring, plus a transport timeout). 16 exports have no production caller and exist only for tests, which therefore reach past the interface.
  - sources: domain-F13, tests-T15

## Time & randomness seams

**Target shape.** One Clock and one RandomSource are injected wherever time or shuffling matters, server and engine alike, so tests run on virtual time and seeded deals instead of sleeps and module patches. Configuration is read per call or passed in, never frozen at import.

- **L-019** P1/M · test — Time and dealing randomness are only partly injected (several clocks) (tickets #1600)
  - `gameTimers.ts:12-29` has an injectable `Clock` (`setClock`), used for AFK, grace and `secondsUntil`.
  - sources: server-F9, 09-tests-server-engine-F2, tests-T8
- **L-020** P1/M · test — The db module captures DATABASE_URL at import, which shapes the whole integration tree
  - The test server's interface hides the real seam, which is which database the modules talk to.
  - sources: 09-tests-server-engine-F1, 09-tests-server-engine-F17, server-F20
- **L-021** P2/S · test — Deal randomness cannot be injected
  - `shuffleDeck` and `dealCards` read `globalThis.crypto` (`gameEngine.ts:229-263`).
  - sources: domain-F11, tests-T9, 09-tests-server-engine-F9

## Server table runtime

**Target shape.** The table runtime talks to a TableOutbox and an ActiveGameStore port rather than raw Socket.IO and drizzle, one module owns each mutation path, and every per-process assumption (grace timers, rate limits, pruning, shutdown) holds across instances as ADR-0003 requires.

- **L-022** P1/S · defect — Shutdown hands rooms back while bot and AFK timers keep playing and persisting
  - `beginShutdown()` (`shutdown.ts:74`) only sets a flag.
  - sources: 05-server-F2
- **L-023** P1/M · defect — Lobby grace lives in one process, so a player who reconnects to another instance loses the seat
  - ADR-0003 makes multi-instance real, but lobby grace is a per-process timer.
  - sources: 05-server-F1
- **L-024** P1/M · structure — `active_games` persistence has no owning module, so tests mock drizzle internals
  - One table's lifecycle (write order, delete order, "room_players has no cascade so it goes first") is spread over three modules and raw drizzle.
  - sources: server-F2, tests-T4
- **L-025** P1/M · structure — `tableHandlers.ts` (839 lines) is a god module (tickets #1597; after L-026)
  - `tableHandlers.ts` (839 lines) holds refusal helpers, rehydrate, move validation, voting and next-round dealing, rejoin, startMatch, seat loss, the dispatcher and a sweeper.
  - sources: server-F4
- **L-026** P1/L · structure — The game layer's output port is the raw Socket.IO server
  - The interface the game logic needs is small: "send to room", "send to user", "send state with one retry on a missing ack", and "who is online".
  - sources: server-F1
- **L-027** P2/S · defect — An ownership query error during reclaim is read as "claimed elsewhere" and drops live tables
  - `takeLock` returns `null` when it cannot connect, but `false` when the query throws (`:149-151`).
  - sources: 05-server-F3
- **L-028** P2/S · defect — `disposeGame` releases the lock before the row delete lands
  - `void releaseRoom(roomId)` (`:116`) runs right away, while the `active_games` delete is queued behind pending writes on `inRoomOrder` (`:117-124`).
  - sources: 05-server-F4
- **L-029** P2/S · resilience — Retention and prune deletes are unbounded under a 5 s statement timeout, and one policy has two homes
  - Each sweep is one unbatched `DELETE ...
  - sources: 05-server-F5
- **L-030** P2/S · defect — HTTP rate limiters use the per-instance memory store
  - No `store` is passed, so express-rate-limit keeps counts in process memory.
  - sources: 05-server-F6
- **L-031** P2/S · structure — The lobby port is half adopted
  - inconsistent seam placement.
  - sources: server-F11
- **L-032** P2/S · test — A safeguard exempts a file that breaks its rule
  - The scan's list is hand-maintained, so it silently exempts the third handler family.
  - sources: server-F14
- **L-033** P2/M · perf — The connect path and the sweeper fetch every socket in the cluster
  - Every connection, every `friend:get_online_list`, and every orphan or sweeper pass calls `io.fetchSockets()` over the whole cluster.
  - sources: 05-server-F7
- **L-034** P2/M · structure — `routes.ts` (1041 lines) is a god module, with repeated auth and session plumbing
  - `routes.ts` (1041 lines) mixes 12 limiter definitions, session and mail helpers, auth and recovery, account, friends, stats, admin, ladders, replays, reports and creating the `http.Server`.
  - sources: server-F6
- **L-035** P2/M · structure — Mutate→broadcast→persist→arm is repeated, and the `RoundOverWriters` seam is bypassed (after L-026)
  - Ordering is documented as load-bearing: settle before serving (`gamePersistence.ts:217-219`), persist before dispose (`roundOver.ts:170-174`).
  - sources: server-F10, 09-tests-server-engine-F6
- **L-036** P2/M · structure — `OnlineGameState` is mutated by many modules; only seat fields have a ledger (tickets #1640)
  - the vote and score invariants ("cleared whenever the roster changes or a round deals") are spread across 4 modules.
  - sources: server-F12
- **L-037** P2/M · structure — Layering: `game/` imports `socket/`, and cycles are dodged with mutable module setters
  - the directories don't reflect dependency direction, and the mutable setters are ambient global wiring that tests must reset (`reopenOwnership`, `installTableHandlers` in every table test's `before`).
  - sources: server-F13
- **L-038** P3/XS · resilience — Outbound HTTP has no timeout
  - `fetch` to the mail provider and to Expo push has no `signal`, so a hung remote holds the request, or the un-awaited invite push, forever.
  - sources: 05-server-F8
- **L-039** P3/XS · resilience — The shutdown budget leaves out steps it spends time on
  - `FORCED_EXIT_MS = 1500 + 6000 + 2000` counts the settle, the drain and slack.
  - sources: 05-server-F12
- **L-040** P3/XS · perf — The deal waits on a best-effort status write
  - `await roomStore.updateRoomStatus(...).catch(warn)` sits before `broadcastGameState`.
  - sources: 05-server-F13
- **L-041** P3/S · resilience — The error recorder amplifies DB outages, and client crashes inflate server errors
  - Each error-level log line runs one `INSERT server_errors`.
  - sources: 05-server-F9
- **L-042** P3/S · perf — `/admin` and the circle leaderboard saturate the 10-connection pool
  - `adminSnapshot` runs 18 queries in parallel against a pool of 10.
  - sources: 05-server-F10
- **L-043** P3/S · resilience — Boot DDL runs without a lock while another revision serves
  - `ensureSchema` runs about 100 `ALTER TABLE ...
  - sources: 05-server-F11
- **L-044** P3/S · defect — `pruneStaleRooms` only knows about this process's games
  - Candidates are filtered with the local `activeGames.has(id)` only.
  - sources: 05-server-F14
- **L-045** P3/S · resilience — An uncaught exception exits without draining queued persists
  - `process.exit(1)` runs immediately, which drops every write queued on `inRoomOrder` and leaves the ownership locks to time out with the connection.
  - sources: 05-server-F15
- **L-046** P3/S · defect — Room creation is not atomic, and the room store reaches up into `game/`
  - `createRoom`, then a separate `addRoomPlayer(room.id, host, 0)`: a failure between the two leaves a host-less `waiting` room.
  - sources: 05-server-F16
- **L-047** P3/S · structure — Six identical gameplay handlers
  - `socketGameplay.ts:80-181`: six `onEvent`s each repeat `atTable() → NOT_AT_A_TABLE → applyOrForward(kind…)`.
  - sources: server-F16
- **L-048** P3/S · defect — Non-exhaustive action-kind routing
  - `takeoverMode` (`tableActions.ts:85-95`) is an `if` chain, so a new `TableAction` kind silently defaults to "forward".
  - sources: server-F17
- **L-049** P3/S · dead-code — Pass-throughs that fail the deletion test
  - Four pass-throughs fail the deletion test: the `socket.ts:41-46` re-export barrel (which makes `routes.ts` import the whole socket graph), the `gameTurn.ts:52-54` `recordPlayFlags` wrapper, three identical context interfaces in socketGameplay/socketRooms/socketPresence, and the `EventOutcome` alias of `IntentReply` imported by the game layer.
  - sources: server-F18

## Wire & transport contracts

**Target shape.** Client and server share typed HTTP and socket contracts in shared/, refusals travel one typed channel with one payload builder, and type homes form a leaf layer with no cycles.

- **L-050** P1/M · defect — A refusal is emitted and returned separately; 8 lobby refusals ack `{ok:true}` and skip the refusal log
  - The interface has two channels, the ack and the `*:error` emit, and nothing forces them to agree.
  - sources: server-F3
- **L-051** P2/S · test — The auth guarantee rests on an AST scan of one file (after L-034)
  - This is a safeguard that exempts what it does not look at.
  - sources: server-F7, tests-T5
- **L-052** P2/S · structure — The inventory's import cycle is all type-only, and is caused by two misplaced type homes
  - The cycle is gameEngine →type botPersonalities →type lib/i18n →type shared/protocol →type lib/wire →type gameEngine.
  - sources: 04-lib-shared-F2
- **L-053** P2/M · structure — The HTTP contract is unshared; client and server types can drift silently
  - The socket protocol is typed end-to-end through `ClientToServerEvents`/`ServerToClientEvents` and `IntentSchemas`.
  - sources: server-F8
- **L-054** P3/XS · defect — Auth error paths: raw store errors reach the client, and the logout destroy error is ignored
  - An express-session store failure at the handshake is passed through as `next(err)`, so a raw pg message reaches the client's `connect_error`.
  - sources: 05-server-F18
- **L-055** P3/S · defect — `RoundOverPayload` is declared "with no optional field", but the schema and the client do not match it
  - `roundOverSchema` validates 6 of 13 fields (`shared/protocol.ts:160-169`).
  - sources: domain-F19
- **L-056** P3/S · structure — `payload.ts` claims to be "the one place" a payload is built
  - `payload.ts:1-6` claims to be the one place a payload is built, but `gameTurn.ts:263-270` hand-builds `{code,message,params}` with English template literals and `gameTurn.ts:346, 376, 415` call `translate(DEFAULT_LOCALE, …)` by hand.
  - sources: server-F19

## Client state & providers

**Target shape.** Providers are narrow: teardown, routing, connection status, error latch and persistence each have one owner module, contexts store payloads not translated strings, and screens read derived state instead of composing it.

- **L-057** P1/S · defect — Home's "Resume" restores a stale snapshot from boot over the match being played
  - three facts each have their own home, and nothing keeps them in step: `hasSavedGame` is set once, by the read on mount (`:320`).
  - sources: 03-app-context-F1
- **L-058** P1/S · defect — Online table teardown is written out by hand in three places, and the three lists disagree
  - about 20 `useState`s and 10 refs make up "the table", but there is no single reset.
  - sources: client-F1
- **L-059** P1/M · structure — Routing that follows table state is spread over five screens and three lobby-choice copies
  - the interface is leaky.
  - sources: client-F2
- **L-060** P2/S · defect — GameContext commands are render-scoped closures, so callers must manage freshness
  - an unwritten rule of the interface: "a command is valid only for the render that produced it".
  - sources: client-F4
- **L-061** P2/S · structure — The slice hooks are pass-throughs; every field is declared six times and tests have two mock seams (**conflicts**)
  - Deletion test: `export const useOnlineConnection = useConnectionSlice` behaves identically.
  - sources: client-F5
- **L-062** P2/S · structure — The persisted table handles have no owner module; Home reads the storage key directly
  - a missing seam. "Is there a table I can return to?" has no interface, and storage format and key ownership leak to a screen outside the provider's subtree.
  - sources: client-F9, 03-app-context-F5
- **L-063** P2/S · defect — Two different "accept an invite" paths
  - one operation, two implementations with different preconditions.
  - sources: client-F10, 03-app-context-F2
- **L-064** P2/S · structure — Locale keys duplicate domain terms per screen, and the translations have already drifted
  - CONTEXT.md says each domain term has one word that "each locale translates".
  - sources: client-F12
- **L-065** P2/S · defect — The server-error latch leaves "who clears it" to each screen
  - `error` is set at `OnlineGameContext.tsx:546` and `621`.
  - sources: client-F15, 03-app-context-F3
- **L-066** P2/S · structure — e2e configuration leaks into production interfaces
  - `exchangeHoldMsOverride` is part of `GameContextValue` (`GameContext.tsx:120-121`, `161`), threaded through `useLocalExchange` and into `GameTable` (`app/game.tsx:233`). e2e knobs at module scope in `GameContext.tsx:48-67`.
  - sources: client-F18, 08-tests-rules-tooling-F8
- **L-067** P2/S · defect — Small leaks in the auth and socket error modes
  - `setSocketAuthFailureHandler`: a single global callback slot in `lib/socket.ts:39-42`, installed by a React provider (`SocketContext.tsx:288`, `474`).
  - sources: client-F26, 03-app-context-F4
- **L-068** P2/M · structure — The HTTP API has no client module: keys, types and invalidation are spread out, with three fetch clients (after L-053)
  - each caller must know the URL, the response type, which other keys go stale when, and which fetch to use.
  - sources: client-F7
- **L-069** P2/M · structure — The offline "driver" lives in the screen, not in the offline adapter
  - locality.
  - sources: client-F3
- **L-070** P2/M · defect — Exchange-announcement detection is implemented twice, differently (after L-005)
  - one concept ("an exchange just resolved, or the two-Joker exception was dealt") has two derivations.
  - sources: client-F6
- **L-071** P2/M · structure — SocketContext mixes four responsibilities and hands screens the raw socket
  - a god context with a shallow, leaky surface.
  - sources: client-F8
- **L-072** P2/L · structure — OnlineGameContext as a whole is a god provider (map of where F1, F6, F7, F9 and F14 apply) (after L-058 L-062 L-068)
  - `context/OnlineGameContext.tsx` (about 1140 lines) holds surface types and slices, persisted handles, a rejoin state machine, connection status, the protocol-version gate, room and game state, banners, match results and query invalidation, votes, reactions, disconnect notices, intents and teardown.
  - sources: client-F13
- **L-073** P3/XS · defect — Account deletion is reported as failed after it succeeded
  - the DELETE succeeds and the server destroys the session (routes.ts:796-800).
  - sources: 02-components-F8
- **L-074** P3/XS · perf — The room's bots-countdown re-renders the whole screen every second for every viewer
  - non-hosts, and rooms that are not waiting, re-render `RoomScreen` (seat list, invite panel, `FlatList`) 30 times for a hint they never see.
  - sources: 03-app-context-F10
- **L-075** P3/XS · defect — useOwnLink resets the shared link edges on every subscribe
  - `edgesOf.set(socket, NO_LINK)` runs on each subscribe against a WeakMap shared per socket.
  - sources: 04-lib-shared-F11
- **L-076** P3/S · structure — Connection status is three subscriptions plus a composition in the screen
  - Connection status is three subscriptions plus a composition in the screen: `connected` via `useSyncExternalStore` (OnlineGameContext.tsx:346-361), `useOwnLink(socket)` subscribing to the same events again (lib/useOwnLink.ts:23-56), a dead `connected` state in SocketContext, and `app/(online)/game.tsx` composing `linkPill(...)` into a `ConnectionNote`.
  - sources: client-F14
- **L-077** P3/S · structure — Error-toast boilerplate repeated
  - `showNotification({ type: "game_error", title: t("common.error"), message })` at `friends.tsx:67`, `room.tsx:368`, `room.tsx:404`, `OnlineGameContext.tsx:902-907`, `SocketContext.tsx:424-429` and `443-448`.
  - sources: client-F16
- **L-078** P3/S · perf — NotificationContext mixes a stable command with fast-changing state
  - `context/NotificationContext.tsx:96-105`.
  - sources: client-F17
- **L-079** P3/S · structure — Stored settings JSON is parsed twice
  - the format has two readers, and only one validates.
  - sources: client-F21
- **L-080** P3/S · structure — The query loading / error / data block is repeated about 10 times
  - `app/profile.tsx:587-596`, `630-634`, `747-753`, `797-800`; `leaderboard.tsx` (7 `LoadingBlock`/`ErrorBlock`/retry sites); `history.tsx` (4); `friends.tsx` (5); `room.tsx:249-255`; `replay.tsx`.
  - sources: client-F22
- **L-081** P3/S · defect — Room-code normalisation is scattered and the two join commands disagree
  - `OnlineGameContext.tsx:943` (`spectateRoom` uppercases), `:927-936` (`joinRoom` does not), `(online)/index.tsx:128`, `135`, `369`, `lib/deepLink.ts:4-8` (`joinCode`).
  - sources: client-F23
- **L-082** P3/S · structure — The tutorial route file holds pure content and engine validation (after L-009)
  - `app/tutorial.tsx:40-454` (card literals, `buildExchangeState`, `buildBeats` at about 180 lines, `stageBeat`, `evaluatePlay`, `evaluateExchange`).
  - sources: client-F24, 03-app-context-F6
- **L-083** P3/S · structure — Contexts store translated strings, not payloads
  - the providers depend on i18n (presentation), and a language switch in SettingsModal does not re-render a standing error or notice.
  - sources: client-F25
- **L-084** P3/S · structure — `tn()` takes an untyped base string
  - `lib/i18n.ts:136-141` (`base: string`, then `as TranslationKey`).
  - sources: client-F27
- **L-085** P3/S · structure — The rating summary is written twice, and provisionality is derived on both sides of the wire
  - app/profile.tsx:599-614 and app/(online)/leaderboard.tsx:37-42, 57-68 (the same season/rounds strings and the same a11y group); app/(online)/game.tsx:208-218 (`provisionalLeft` recomputed from `rounds < PROVISIONAL_ROUNDS`); server/game/ratings.ts:197 (the server's own `provisional: rounds < PROVISIONAL_ROUNDS`, sent on `RatingDto` but not on `RatingAfter`). proposed: `lib/game/rating.ts: provisionalLeft(r: { rounds: number }): number | undefined` used by the server's flag and by all three screens, plus …
  - sources: 03-app-context-F7
- **L-086** P3/S · structure — Lobby pickers are copied across three screens, and two restate the teams rule with a literal 4
  - app/(online)/room.tsx:142-177 (`MatchLengthControls`, "Mirrors the offline lobby's picker") = app/lobby.tsx:131-134, 246-262; player-count chips app/(online)/index.tsx:169-182 = app/lobby.tsx:212-224; teams-needs-four as a literal at app/(online)/index.tsx:184, 195-196 and app/lobby.tsx:170, 226, while app/(online)/room.tsx:383-384 and server/socket/socketTable.ts:133 use `TEAMS_PLAYER_COUNT`. proposed: `components/MatchLengthPicker({ value, onChange, seats })` and `SeatCountPicker`, plus `modeFits(mode, …
  - sources: 03-app-context-F8
- **L-087** P3/S · perf — Reduce-motion opens one native subscription per subscriber
  - on native, `subscribeSystemReduceMotion` adds an `AccessibilityInfo` listener and fires an `isReduceMotionEnabled()` bridge call for every subscriber.
  - sources: 04-lib-shared-F8

## Table UI & components

**Target shape.** GameTable composes pure, testable extractions (hand layout, exchange presentation, seat, turn and outcome) built from one TableFacts; motion and press feedback come from shared primitives, and no rule is re-implemented in a component.

- **L-088** P1/S · defect — GIOCA's refusal ladder re-implements the engine's rule outside `gameEngine.ts` (tickets #1596)
  - `readStagedPlay` already calls `checkSelection`, which returns `{ok:false, code}` (stagedPlay.ts:57-61).
  - sources: ui-F1
- **L-089** P1/M · structure — Hand-row geometry is buried in `StraightHand`, computed in three parallel loops; the tested hit-test is a decoy (tickets #1604)
  - All of this is pure arithmetic (card size per turn, crop, arc solve, tilt overhang, `topClearance`, `heldCeiling`, slot, home and shift per card, strips, rotated hit test).
  - sources: ui-F2, 01-table-F9
- **L-090** P1/M · structure — The exchange's presentation is smeared across five modules, with GameTable holding its state machine (tickets #1603)
  - No module owns "the exchange as the table shows it".
  - sources: ui-F3, 01-table-F1
- **L-091** P1/M · structure — Table geometry is a 12-field bag mixed with game state, fanned out field by field, and the layout is encoded twice
  - `SeatGeometry` mixes frame geometry (scale, window, table edges, surplus, bottomPad, handCardH) with game state (players, opponents, viewerSeat).
  - sources: ui-F4
- **L-092** P2/S · structure — Opponent seats: two near-identical slot components rendered three times with 13 identical props (tickets #1602)
  - The slots' 12-prop interface is as big as their bodies (shallow).
  - sources: ui-F6, 01-table-F8
- **L-093** P2/S · structure — Hand-written memo comparators, with a source-parsing test to keep them complete
  - Both comparators are shallow equality except for `card` (compared by id) and two mount-only props.
  - sources: ui-F8
- **L-094** P2/S · structure — Turn presentation: two parallel 5-way ternaries and two `turnTimerActive` calls in GameTable's JSX (tickets #1602)
  - This is pure presentation logic inline in render.
  - sources: ui-F10, 02-components-F7
- **L-095** P2/S · structure — OS orientation lock lives in the table component
  - A true-external dependency (UIKit/Android orientation plus a custom native module) is driven from inside the presentational table.
  - sources: ui-F12, client-F28
- **L-096** P2/S · structure — "The play that ended the round has landed" is decided four times, behind a call-order contract
  - Each hook re-derives "ended, nothing in flight, nothing pending" from `timeline.inFlight` and `timeline.pending()`.
  - sources: 01-table-F2
- **L-097** P2/S · defect — The lamp level has three writers that guess ownership from the target value
  - Three effects write one `lvlT`.
  - sources: 01-table-F3
- **L-098** P2/S · structure — CardView carries an interaction model that only the tutorial uses
  - CardView is two modules in one.
  - sources: 02-components-F1
- **L-099** P2/M · structure — `flightPhysics.ts` is a grab bag whose name misleads, guarded by an import-ownership scan (tickets #1603)
  - Low cohesion; the name misleads on half its contents.
  - sources: ui-F5, 02-components-F13
- **L-100** P2/M · structure — Three hand-rolled countdowns; the seat ring and the turn chip show the same window from independent clocks
  - The same concept ("a server window of N seconds, restarted by a key, optionally held") is implemented three ways.
  - sources: ui-F7
- **L-101** P2/M · structure — `CardItem` has 30 props, a boolean disguised as a number, and two "deal" mechanisms
  - `dealDelay` is documented as "ms to wait, or -1", but its only caller passes `descending ? 0 : -1` (1355).
  - sources: ui-F9
- **L-102** P2/M · structure — Notice float, opening gate and veils are state machines written as render-time `setState` (tickets #1602)
  - The float reducer tracks four "last seen" values (`passSeen`, `errorSeen`, `autoSeen`, `withdrawnSeen`) inline.
  - sources: ui-F11
- **L-103** P3/XS · structure — GIOCA and PASSA each hand-roll the press scale, and the garnet gradient stops live twice
  - The inventory duplicate is real: the same `setPress`/`pressVal`/cancel/`pressStyle` block appears twice.
  - sources: 01-table-F6, 02-components-F4
- **L-104** P3/XS · resilience — `useCardRect` takes its mapper inputs from a private worklets field
  - `__closure` is an internal of the worklets Babel plugin.
  - sources: 01-table-F10
- **L-105** P3/XS · defect — Notice timing puts a reading hold in `Motion` and ignores reduced motion for two shapes
  - `chip` and `float` take `Motion.mark.{enter, hold, exit}` whatever `reduceMotion` is.
  - sources: 01-table-F11
- **L-106** P3/XS · structure — Unused motion knob and component-literal durations
  - A parameter with one value is a hypothetical seam.
  - sources: 01-table-F12
- **L-107** P3/XS · structure — Rank letter-spacing is defined twice, and the joker rank ignores scale
  - `LETTER_SPACING = -0.5` in cardFaceModel feeds `rankTextWidth`, which is the geometry that keeps index boxes from overlapping.
  - sources: 02-components-F6
- **L-108** P3/XS · perf — Render churn from fresh defaults and per-frame state
  - The `placementPoints = {}` (357) and `disconnectedSeats = {}` (371) defaults are new objects on every render for replay, capture and bench callers.
  - sources: 02-components-F10
- **L-109** P3/XS · defect — BenchScreen run latch has no finally
  - `benchRunning` and the drain interval are reset only on the success path.
  - sources: 02-components-F11
- **L-110** P3/S · structure — Platform branches scattered instead of behind one seam
  - The web overflow-clip quirk (a focused child scrolls a `hidden` box) is written twice with two different casts: `GameTable.tsx:169-170` (`WEB_CLIP`, cast via `unknown as ViewStyle`) and `hand.tsx:1431` (`"clip" as "hidden"`).
  - sources: ui-F14
- **L-111** P3/S · structure — `useTableFeedback` recomputes the round and match outcome GameTable already has (tickets #1602)
  - The 17-input interface exists to rebuild a value the caller holds.
  - sources: ui-F15
- **L-112** P3/S · structure — Score pill and match-board derivation in GameTable
  - pure geometry and labels sit in the component, beside the existing `components/table/scorePillModel.ts` and `lib/game/scorePill.ts`.
  - sources: ui-F16
- **L-113** P3/S · structure — `getComboLabel` is a pure label function living in a component, with a lossy key type (after L-064)
  - `Record<string, TranslationKey>` loses exhaustiveness; an unknown type falls back to the raw `combo.type` string on screen.
  - sources: ui-F17, 02-components-F3
- **L-114** P3/S · structure — Animation-lifetime boilerplate
  - 55 `cancelAnimation(` calls across components (`useTableFeedback.ts` 10, `hand.tsx` 9, `seats.tsx` 7, `moments.tsx` 7, `pile.tsx` 6, …). 11 of them are the exact `useEffect(() => () => cancelAnimation(x), [x])` shape.
  - sources: ui-F18
- **L-115** P3/S · perf — Both particle adapters re-state the per-frame scene step, and the web one never idles
  - The seam between the two is real (Skia Atlas vs 2D canvas).
  - sources: 01-table-F5
- **L-116** P3/S · structure — "Where the chips end" is computed in two places; computeScreenPads is a pass-through
  - `notificationTopOffset` (tableFrame.ts:201-216) rebuilds the chip bottom from raw inputs: `max(PAD_TOP*s, topPad) + surplus + CHIP_H + PAD_INNER*s`.
  - sources: 02-components-F2
- **L-117** P3/S · structure — Settings rows are spelled out six times
  - every row repeats `row`/`stackRow > rowLeft > RowIcon + label/sublabel + control`.
  - sources: 02-components-F9

## Test support & test architecture

**Target shape.** Tests mount real providers over typed fakes at the I/O edge (FakeSocket, FakeHttp, clock, rng), fixtures and helpers exist once, source scans become lint rules or typed seams, and each fact is tested at the cheapest tier that can see it.

- **L-118** P1/S · test — Accessibility is mocked 46 times even though it has a public setter
  - `setMotionPreference` (lib/accessibility.ts:18) is honoured by `usePrefersReducedMotion` (127). 18 files already use the setter.
  - sources: tests-T2, 07-tests-native-F1
- **L-119** P1/M · test — The socket seam is untyped on both sides, and the integration helper's wire types have drifted
  - Client: 17 hand-rolled fakes. 9 carry an identical lib/socket mock: acceptInviteClearsPending:30, friendLastSeen:28, friendRequestReconcile:38, friendRowArrivesWithTheBanner:38, sessionReplaced:33, signOutClearsQueryCache:21, socketAccountSwitch:25, socketContextFreshness:28, socketReconnect. 8 mock SocketContext instead (protocolMismatch:14, onlineAutoPass:11, rejoinFailed:24, …).
  - sources: tests-T3, 07-tests-native-F2, client-F11
- **L-120** P1/M · test — Reduced motion is guarded by four overlapping text scans; a motion seam would replace them (after L-114)
  - Calls to Reanimated's `withTiming`, `withRepeat` and `withDelay` are scattered through components.
  - sources: 08-tests-rules-tooling-F1
- **L-121** P1/L · test — The app contexts have no seam, so tests replace them with partial hand-typed mocks (**contested**; after L-119 L-019)
  - each mock is a partial, hand-typed value.
  - sources: tests-T1, 07-tests-native-F3
- **L-122** P2/XS · test — Checks that exempt themselves or carry a spare exemption
  - noFocusedTests:33 filters out its own file, so it does not check itself (a self-exempting safeguard).
  - sources: tests-T14, 08-tests-rules-tooling-F5
- **L-123** P2/XS · test — Tests that write into the repo root or leak env changes
  - A concurrent `git add`, or the root scan, picks up the fixture. rootScanRace exists because of this class.
  - sources: 08-tests-rules-tooling-F15, 09-tests-server-engine-F10
- **L-124** P2/XS · test — Assertions that cannot fail, or cannot tell the claim from its absence
  - handTapStrip:34 `expect(strip / 2).toBeLessThan(strip)` is arithmetic on a positive number and is true whatever the component does. errorReporting:217-222 ("stops reporting once removed") asserts `listeners.size === 0` straight after the test itself called `listeners.clear()`.
  - sources: 07-tests-native-F6
- **L-125** P2/XS · test — Timing constants copied into tests as prose
  - each is a premise held in a comment.
  - sources: 07-tests-native-F8
- **L-126** P2/XS · test — A live-network test and a machine-state test
  - the result depends on network, auth or what is running on the machine, so the test is red offline or on a fork without a token and says nothing about the code.
  - sources: 10-tests-e2e-loop-F16
- **L-127** P2/S · test — Store seam: one adapter, substituted by monkeypatching (after L-024)
  - `userStore`, `roomStore` and `friendStore` are objects so tests can `t.mock.method` them (`roomStore.ts:50-55` says so). 19 non-store modules import `db` directly: `gamePersistence`, `ratings`, `replays`, `retention`, `stats`, `tableHandlers`, `userNames`, `admin` (13 queries), `authTokens`, `bugReports`, `clientErrors`, `deleteAccount`, `roundHistoryView`, `serverErrors`, `session`, `shutdown`, `events`, `push`, `ticket`.
  - sources: server-F15, 09-tests-server-engine-F5
- **L-128** P2/S · test — The nightly list is a regex copied into four places, plus 23 stub specs
  - The parity spec regex is duplicated at playwright.config.ts:50 and playwright.parity.config.ts:8.
  - sources: tests-T13, 10-tests-e2e-loop-F4
- **L-129** P2/S · test — Import-graph rules are kept in three text scans, one of which duplicates eslint, and none catches the violations the tools found (after L-052)
  - The audio-owner rule has two homes. eslint enforces it for app/components/context/lib (:154). audioOwners re-derives it with moduleEdges and adds `modules/`, the one directory eslint's glob misses.
  - sources: 08-tests-rules-tooling-F3
- **L-130** P2/S · test — submitEditingGuards hand-parses JSX to check a two-part contract that should be a component
  - The contract is that every `onSubmitEditing` field has `editable={!busy}` and the handler returns early when busy.
  - sources: 08-tests-rules-tooling-F4
- **L-131** P2/S · test — About 40 scans re-implement the file walk, ignore .gitignore, or depend on cwd
  - Each walker makes its own decision about which files count.
  - sources: 08-tests-rules-tooling-F6, 09-tests-server-engine-F7
- **L-132** P2/S · test — Scans a decoy satisfies today
  - These go green when the guarded thing is not true, the "a source scan falls to a decoy" class.
  - sources: 08-tests-rules-tooling-F17
- **L-133** P2/S · test — tableCardRects and tableCardShadows run the same four 120-second scenarios twice
  - each frame walk (`frames(2000/1600/3000)`) is driven twice, once to read the registry and once to read host shadows.
  - sources: 07-tests-native-F5
- **L-134** P2/S · test — Source scans in the native tier
  - text presence is not reachability.
  - sources: 07-tests-native-F16
- **L-135** P2/S · test — Fixed sleeps standing in for events the protocol already has (after L-019)
  - A positive sleep is either too long (slow) or too short (flaky on CI).
  - sources: 09-tests-server-engine-F3
- **L-136** P2/S · perf — Slow integration files that become unit tests once a seam lands (after L-026 L-024)
  - integration cost is paid for logic that has no socket or DB question.
  - sources: 09-tests-server-engine-F11
- **L-137** P2/S · perf — Whole-match drives used only to reach the result board
  - these specs check the result screen, but they play a whole match to get there.
  - sources: 10-tests-e2e-loop-F3
- **L-138** P2/S · test — Layout guards demoted to the nightly parity run (tickets #1645)
  - CLAUDE.md says only tests/e2e catches layout bugs.
  - sources: 10-tests-e2e-loop-F5
- **L-139** P2/S · test — `font-subset.json` check reads its own record, not the shipped fonts
  - test 1 compares the characters the app needs against `manifest.characters`, a committed text file.
  - sources: 11-gaps-F2
- **L-140** P2/M · test — Socket test infrastructure is re-implemented per file (wire types, connect, boot, polling) (after L-026)
  - Shallow helpers with leaky interfaces: table.ts and gameDriver.ts overlap, client.ts copies itself, and files still roll their own.
  - sources: 09-tests-server-engine-F4
- **L-141** P2/M · test — The source-scan suite (**contested**; **conflicts**)
  - `sourceScan.ts` is a 463-line hand-written lexer, with its own 276-line test, while 16 files already use the `typescript` package. 13 private import regexes (layering:23, orientation, flightHooks, e2eRunnableImports, ciScope, assetBarrels, …) duplicate `moduleEdges.ts`.
  - sources: tests-T6, 08-tests-rules-tooling-F2
- **L-142** P2/M · test — Fixtures are duplicated across tiers
  - `tests/engine/helpers.ts` (`c`, `j`, `makePlayer`, `makeState`, `mulberry32`) is used by 24 files, none of them native. 45 files define their own card builder and 61 their own player builder; 94 write `GameState` literals (60 native, 14 server, 10 e2e).
  - sources: tests-T7, 07-tests-native-F4
- **L-143** P2/M · test — Render-count tests use spy-through mocks
  - 82 `requireActual` calls; oneTapOneCommit has 9 mocks; legalPlaysPerHand:16; botMoveCost.compiled:21; particles spied 5 times; `traumaFor` 5 times.
  - sources: tests-T10, 07-tests-native-F11
- **L-144** P2/M · test — Pure logic is stranded in the native tier (**conflicts**)
  - `applyRoundToMatch` (GameContext:87) is tested via teamsSingleRound:2-4, which needs jest-expo. renameFailureCopy:10 needs the native tier because i18n pulls in expo-localization.
  - sources: tests-T11, 07-tests-native-F17
- **L-145** P2/M · test — Source-scan tests that pin implementation details or have decayed (after L-102 L-091)
  - Each maps to the refactor that replaces it.
  - sources: ui-F13, 08-tests-rules-tooling-F10
- **L-146** P2/M · test — Bot and round-loop tests bypass the one bot module, and matchTerminates soaks a mirror (after L-004)
  - The deep module (autoMove) is bypassed by tests that re-assemble its inputs.
  - sources: 09-tests-server-engine-F8
- **L-147** P2/M · test — Hand-written saves and seating outside the offlineSeed module
  - the save shape (the SavedGame JSON plus its storage key) has about 12 homes.
  - sources: 10-tests-e2e-loop-F1
- **L-148** P2/M · test — Fixed sleeps and networkidle where a settle signal exists
  - a fixed sleep is either too long, which wastes shard time, or too short, which flakes on a 7x-slower CI runner. tests/e2e/helpers/settle.ts (`settled`/`atRest`), the virtual clock and data-dealing attributes already give event-based waits.
  - sources: 10-tests-e2e-loop-F2
- **L-149** P3/XS · test — HOLD_MS lives in two places and a test keeps them equal
  - One fact has two homes, and a text scan is the bridge.
  - sources: 08-tests-rules-tooling-F9, 10-tests-e2e-loop-F7
- **L-150** P3/XS · test — Duplicate fixtures inside the slice
  - Copies drift.
  - sources: 08-tests-rules-tooling-F11, 10-tests-e2e-loop-F8
- **L-151** P3/XS · test — Test files export helpers that other tests import
  - Importing a test file registers its tests in the importer as well, or runs them twice.
  - sources: 08-tests-rules-tooling-F16
- **L-152** P3/XS · test — Dead or misleading leftovers
  - tests/tooling/gameRuleDecisions.test.ts is a one-off migration guard.
  - sources: 08-tests-rules-tooling-F19
- **L-153** P3/XS · test — Tests that duplicate another test's coverage
  - friendRequestReconcile:98-107: `'/api/friends'` is invalidated on connect.
  - sources: 07-tests-native-F7
- **L-154** P3/XS · test — netinfo is re-mocked in 11 files over setup's vendor mock
  - the nine plain re-mocks are noise the vendor mock already covers.
  - sources: 07-tests-native-F10
- **L-155** P3/XS · test — Two scenario tests share a copied subprocess gate, and each spawns node per test
  - the same harness is written twice, and every `it` pays a node start-up.
  - sources: 07-tests-native-F13
- **L-156** P3/XS · test — Hard-coded English copy and a duplicated `t` helper
  - a copy edit in locales/en.ts turns these red.
  - sources: 07-tests-native-F14
- **L-157** P3/XS · test — spectateFailed calls provider actions through `waitFor`
  - `waitFor` retries its callback until it stops throwing.
  - sources: 07-tests-native-F18
- **L-158** P3/XS · dead-code — Dead and unused helper surface (knip, confirmed)
  - Dead knobs read as working configuration.
  - sources: 09-tests-server-engine-F13
- **L-159** P3/XS · test — client.ts leaks sockets and listeners on failure paths
  - a failing test leaks handles, which can keep `--test-force-exit` as the only exit and mask the first failure.
  - sources: 09-tests-server-engine-F15
- **L-160** P3/XS · defect — A fixture sets a field the type does not carry
  - the fixture does not set what the test believes it sets.
  - sources: 09-tests-server-engine-F16
- **L-161** P3/XS · test — Patched-RN override has no tripwire for the day upstream fixes it
  - the Reanimated patch test has `DROP` guidance and fails when the installed library contains the upstream fix (reanimatedSyncPropsPatch.test.ts:20-21,40-45).
  - sources: 11-gaps-F6
- **L-162** P3/XS · test — `deploy/runtime.json` `postgres: 16` is never checked, while `node` is
  - four of the five fields have a test (node, sigtermGraceMs, pgConnectionsPerInstance, and proxyHops in cors.test.ts:81).
  - sources: 11-gaps-F7
- **L-163** P3/S · test — `useWindowDimensions` is mocked through RN's private module path in 11 files
  - `useWindowDimensions` is mocked via an RN private module path 11 times (bannerBand:14, bannerMakesRoom:20, bannerPlacement:20, captureScreen:26, …).
  - sources: tests-T12, 07-tests-native-F9
- **L-164** P3/S · test — jest.config.js:19-27 keeps the iOS-only test list by hand
  - jest.config.js:19-27 keeps the iOS-only test list by hand, while about 11 production files branch on platform (CardView:682, feltCanvas:57, greyLayer:8, useLinkHold:17, settingsSheet:52, keyboard:19, orientation:23, pushRegistration, theme:67, GameContext:54, errorReporting:94).
  - sources: tests-T16
- **L-165** P3/S · test — 109 files opt into fake timers one by one
  - 109 test files opt into fake timers one by one.
  - sources: tests-T17
- **L-166** P3/S · test — Workflow YAML is parsed with regexes on the false premise that there is no YAML parser
  - Indentation-sensitive regexes break on harmless reformatting, and the false comments stop anyone from fixing them ("a premise in prose decays").
  - sources: 08-tests-rules-tooling-F7
- **L-167** P3/S · test — i18n: two halves re-check facts the types already carry
  - The regex halves duplicate the type check, and anything that spells the code differently decoys them.
  - sources: 08-tests-rules-tooling-F13
- **L-168** P3/S · perf — Slow tests that could be cheaper
  - These dominate the ui-rules/tooling wall time.
  - sources: 08-tests-rules-tooling-F14
- **L-169** P3/S · test — Environment, globals and fake timers are left changed when a test fails or ends
  - Jest gives each file its own `process.env` (jest-util createProcessObject), so the leak stays within the file.
  - sources: 07-tests-native-F12
- **L-170** P3/S · structure — Tests, scripts and e2e are tangled
  - production tooling depends on test helpers, and test directories do not say what they test.
  - sources: 09-tests-server-engine-F12, 06-tooling-F18
- **L-171** P3/S · test — Four copies of the "find a legal play" search (after L-009)
  - each copy taps cards until the GIOCA button enables.
  - sources: 10-tests-e2e-loop-F6
- **L-172** P3/S · defect — Small defects in e2e helpers and specs
  - the race and the swallowed error are flake sources.
  - sources: 10-tests-e2e-loop-F9
- **L-173** P3/S · perf — Specs that repeat cheaper-tier coverage
  - these assert presence, text or toggle state, which RNTL tests already cover.
  - sources: 10-tests-e2e-loop-F10
- **L-174** P3/M · test — Registry and harness facts checked by scans where a typed table would carry them
  - Each of these is a completeness question ("every channel, port, sentinel, invariant or env timer has an entry").
  - sources: 08-tests-rules-tooling-F12

## Loop & CI tooling

**Target shape.** The queue loop is a small orchestrator over ports (GitHub, git, process, disk) with pure deciders tested by value; CI workflows share one install and one Node version source, and every guard fails closed.

- **L-175** P1/M · tooling — Phase and route resolution is computed in four places, bridged by an env var
  - queue-loop.mjs:1085 says "Every routing choice is `decide()`'s".
  - sources: tooling-F2, 10-tests-e2e-loop-F13
- **L-176** P1/M · tooling — GitHub access is scattered, with about 7 argv-level gh fakes in tests and an unenforced `--repo` rule (tickets #1605 #1606)
  - `tracker.mjs` is a real seam with two adapters (`ghTracker`, `fakeTracker`), but it covers only the 5 label and comment operations.
  - sources: tooling-F3, 06-tooling-F11, 10-tests-e2e-loop-F12
- **L-177** P1/L · tooling — `queue-loop.mjs` is a god module: adapters, board glue, orchestration and config in one file (tickets #1605 #1606 #1607 #1608; after L-176 L-175 L-184)
  - the module's interface is everything it exports, about 40 names, and tests import about 30 of them.
  - sources: tooling-F1
- **L-178** P2/S · tooling — Policy and limits are spread over 8 modules; light scripts import the god module for one constant
  - no single place answers "what are the run's caps".
  - sources: tooling-F6, 10-tests-e2e-loop-F18, 06-tooling-F24
- **L-179** P2/S · tooling — `runOnce` and `main` bypass their ports for disk I/O, so tests `chdir` (tickets #1608)
  - the composition's interface includes the process cwd and the real `.loop-logs`, while the ports suggest otherwise.
  - sources: tooling-F7, 10-tests-e2e-loop-F15
- **L-180** P2/S · tooling — ci.yml's `scope` decision is inline bash, and its test regex-parses bash out of YAML
  - the interface is YAML and bash, so the test reaches past it by parsing the implementation.
  - sources: tooling-F8
- **L-181** P2/S · tooling — `decide.mjs` exports its internals, and about 290 test lines test past `decide()` (after L-175)
  - the interface is `decide(input)`, but the tests also pin the helper decomposition, so refactoring a helper breaks tests while behaviour is unchanged.
  - sources: tooling-F10, 10-tests-e2e-loop-F14
- **L-182** P2/S · defect — settle turns one transient gh error into an owner verdict
  - Two cases become `verdict("owner","could not read CI")`: any single non-offline `gh` read error, and an offline error that no wake follows.
  - sources: 06-tooling-F1
- **L-183** P2/M · tooling — The session environment is a hidden interface written in one place and parsed in five
  - "am I a loop session?" is answered three different ways (`LOOP_TURNS` truthy, `LOOP_PHASE` matching a regex, `LOOP_TICKET` numeric).
  - sources: tooling-F4
- **L-184** P2/M · tooling — Process spawning is duplicated: the npm/npx shim, tree-kill, and the "run a bin" pattern, with a real orphan bug class on Windows
  - five shallow copies of the same adapter.
  - sources: tooling-F5, 06-tooling-F6
- **L-185** P2/M · tooling — Workflow duplication: installs, Node versions, and a byte-identical device gate (**contested**)
  - shallow copies.
  - sources: tooling-F9, 06-tooling-F13, 08-tests-rules-tooling-F18
- **L-186** P3/XS · tooling — Stale premises in prose and config
  - loop-settings.json `soft_deny` says "package.json db:reset already bundles --yes".
  - sources: tooling-F16, 06-tooling-F20
- **L-187** P3/XS · tooling — Four scripts hand-roll the entry-point check
  - `scripts/e2eBuildMark.mjs:33`, `scripts/mockupParityPage.mjs:162`, `scripts/ios-device.mjs:436` and `scripts/measureHeadsUpBalance.ts:556-557` compare unresolved paths.
  - sources: tooling-F19
- **L-188** P3/XS · defect — loop-gate `landable` throws when a parent is not on main
  - `git merge-base --is-ancestor` exits 1 for "not an ancestor".
  - sources: 06-tooling-F3
- **L-189** P3/XS · defect — loop-screen `openExternally` has no spawn error listener
  - The detached `spawn` has no `'error'` handler, so a missing opener binary raises an unhandled error and takes the supervisor's screen down with it.
  - sources: 06-tooling-F4
- **L-190** P3/XS · defect — claim.mjs leaks its mkdtemp directory
  - The `mkdtempSync` directory is never removed, so one directory accumulates per claim.
  - sources: 06-tooling-F5
- **L-191** P3/XS · defect — e2ePort kills every listener on the chosen port, not the verified pids
  - `clearPort(chosen.port)` lists the port again and kills whatever is listening by then, rather than the pids the claim verified.
  - sources: 06-tooling-F7
- **L-192** P3/XS · perf — loop-logs ledger.record re-reads the whole ledger, which is never pruned
  - Every `record` call parses the full append-only ledger, so the cost grows without bound.
  - sources: 06-tooling-F8
- **L-193** P3/XS · tooling — two definitions of a spec's duration
  - One tool sums all attempts; the other takes the slowest attempt.
  - sources: 06-tooling-F9
- **L-194** P3/XS · defect — next-ticket prints the wrong claim command, and its comment read is capped
  - `printDetail` always prints `gh issue edit --add-label in-progress`.
  - sources: 06-tooling-F10
- **L-195** P3/XS · tooling — ios-device.yml's push path filter misses native inputs
  - The filter lists package.json, the lock, app.json, assets/images and the workflow itself.
  - sources: 06-tooling-F14
- **L-196** P3/XS · tooling — `HARD_FACTOR = 3` is defined three times
  - RULES.md rule 46 states it as one owner ruling, but each copy has its own `<= 3` pin, so the copies can drift apart.
  - sources: 06-tooling-F16
- **L-197** P3/XS · tooling — build-court-art `CROP` duplicates `COURT_ART_BOX`
  - The two are kept equal only by a "keep in step" comment. bake-card-art.mjs already imports from cardFaceModel.ts, so the import path exists.
  - sources: 06-tooling-F17
- **L-198** P3/XS · tooling — diagnostics collector port 5099 is a literal in three places
  - The three literals are not tied to each other.
  - sources: 06-tooling-F19
- **L-199** P3/XS · tooling — `server:dev` and `server:prod` use POSIX env prefixes
  - `NODE_ENV=x cmd` fails under npm's default cmd shell on Windows, which is the owner's machine.
  - sources: 06-tooling-F21
- **L-200** P3/XS · tooling — checks.md:96-97 describes the dispatch gate backwards
  - The doc says the gate refuses a dispatch off an `agent/<n>-` or `claude/<n>-` branch.
  - sources: 06-tooling-F22
- **L-201** P3/XS · test — Small loop-test defects
  - a duplicate name hides which test failed, cleanup leaks on failure, the fixed sleep is flake-prone, and the global mock is a missing seam.
  - sources: 10-tests-e2e-loop-F19
- **L-202** P3/XS · tooling — `result-schema.json` lets extra fields through; a test does that check by hand
  - the schema has `required` but no `additionalProperties: false`.
  - sources: 11-gaps-F10
- **L-203** P3/XS · tooling — Small shell hardening
  - (a) `sort | tail -1` is lexicographic, so `build-tools/9.0.0` would beat `34.0.0` and `100.x` loses to `35.x`; use `sort -V`. (b) `$title` goes into a double-quoted jq string from `$workflow`; only `ios.yml` and `maestro.yml` pass today, but `--arg t "$title"` and `select(.title == $t)` removes the quoting hazard. (c) gitleaks-scan.sh has no `-e`/`-u`, and it relies on its callers noticing the exit status.
  - sources: 11-gaps-F11
- **L-204** P3/XS · tooling — `skills-lock.json` lists seven skills, only one is installed, and nothing reads it
  - six entries (`find-skills`, `frontend-design`, `next-best-practices`, `radon-mcp`, `rnrepo`, `typegpu`) have no directory in `.claude/skills`.
  - sources: 11-gaps-F9
- **L-205** P3/S · tooling — In-process modules are called through subprocesses and stdout protocols
  - `queue-loop.mjs:1436-1440` runs `node claim.mjs` and parses `claimed.split("\t")[2]` and `err.stdout.split("\t").at(-1)`, even though `claim(number, title, run, tracker)` (claim.mjs:87-117) is importable and already returns `{branch, cwd, won, why}`.
  - sources: tooling-F11, 10-tests-e2e-loop-F17
- **L-206** P3/S · tooling — Issue-read trust policy lives in `brief.mjs` and comes in three shapes (after L-176)
  - `brief.mjs:45-70` (`TRUSTED_SELECT` jq, `readIssue`, `untrustedRead`, `apiMethod`) is imported by guard-bash.mjs:19 and next-ticket.mjs:3.
  - sources: tooling-F12
- **L-207** P3/S · tooling — The agent-check cache is an implicit file interface and self-reported gate evidence (**contested**)
  - The writer is `agent-check.mjs:178-180, 237`; the reader is `loop-gate.mjs:47`, which rebuilds the path `join(gitDir, "agent-check-cache.json")` itself and shares the `{pass, head, clean, deferred}` schema only by convention. loopGate.test.ts:435 writes the file directly.
  - sources: tooling-F13
- **L-208** P3/S · defect — Guard hooks fail open silently, which makes `onFailure: "block"` dead config
  - `guard-write.mjs:41-43` and `guard-agent-model.mjs:66-68` wrap everything in `catch { process.exit(0) }`, which includes `checkoutRoot(cwd)` throwing (cli.mjs:70-71).
  - sources: tooling-F14
- **L-209** P3/S · tooling — "The change" is computed five different ways
  - `agent-check.mjs:33-51`: `origin/main...HEAD` + tracked status, excluding untracked.
  - sources: tooling-F15
- **L-210** P3/S · tooling — gh/git wrappers outside tools/loop (after L-176)
  - `scripts/await-run.mjs:15-21`, `tools/ci/await-artifact.mjs:52`, `tools/ci/ios-wall.mjs:57`, `tools/ci/budget-gate.mjs:131-132` (re-states the 64 MB `MAX_BUFFER`), `tools/ci/nativeScope.mjs:54`, `tools/ci/e2e-budget.mjs:17`, `scripts/ios-device.mjs:99-103`. cli.test.ts's "no git or gh outside cli.mjs" scan covers only `tools/loop/*` (cli.test.ts:116).
  - sources: tooling-F18
- **L-211** P3/S · tooling — The e2e port literal is in four places, and the process-table module sits in the loop
  - `5199` appears at tools/ci/e2ePort.mjs:17 (`BASE_PORT`), scripts/e2e-server.mjs:32, tools/loop/reap.mjs:14 and tests/e2e/playwright.config.ts:25. reap clears only `E2E_PORT ?? 5199`, while `chooseE2ePort` may hand out 5199-5218 (e2ePort.mjs:18, 32-49).
  - sources: tooling-F20
- **L-212** P3/S · tooling — Minor shallow items
  - Minor shallow items: three trimmed-git micro-wrappers (loop-derive.mjs:18, loop-gate.mjs:31-33, brief.mjs:25-31, plus agent-check.mjs:174-176), `scripts/dev-stack.mjs:95` spawning a node process to sleep, and a module-level mutable `openPrs` cache in next-ticket.mjs:176-180.
  - sources: tooling-F21
- **L-213** P3/S · defect — queue-loop resolves paths against the cwd despite its HERE/ROOT contract
  - The HERE/ROOT comment at :89-92 says paths resolve from the script.
  - sources: 06-tooling-F2
- **L-214** P3/S · tooling — checks.md documents an `await-run --pr` mode that does not exist
  - The doc says that with `--pr <n>`, a passed run that is over budget also exits 1.
  - sources: 06-tooling-F12
- **L-215** P3/S · tooling — diagnostics gates restate each scenario's sample count
  - Each count is written twice, so changing a scenario's iterations reds the gate for a reason unrelated to performance.
  - sources: 06-tooling-F15
- **L-216** P3/S · tooling — failure reporting to the tracker is copied about four times, and two soak jobs share one issue
  - The same "find the open labelled issue, else create it, then comment" logic is copied about four times.
  - sources: 06-tooling-F23

## Dependencies, dead code & hygiene

**Target shape.** No phantom or unused dependencies, no unused exports or knobs, and comments that state only what is true; small duplications collapse into one constant or helper.

- **L-217** P3/XS · dead-code — dependency hygiene: phantom and unused packages from the phase-0 knip run (**conflicts**)
  - These are used but not declared, resolving only through hoisting: `@jest/globals` (243 files) `canvaskit-wasm` (tests import it directly) `jest-util` `@expo/env` `babel-jest` `playwright` `@types/bcryptjs` is declared but unused, because bcryptjs 3 ships its own types.
  - sources: 06-tooling-F25
- **L-218** P3/XS · dead-code — export lists wider than their callers
  - These exports are used only inside their own file, or only by tests.
  - sources: 06-tooling-F26, 10-tests-e2e-loop-F11
- **L-219** P3/XS · dead-code — Dead or duplicate items
  - `scripts/post-merge.sh` has zero references anywhere (a Replit-era post-merge hook; `tests/tooling/noReplitCoupling.test.ts` exists, and replit.md was folded away in commit c8d04d5e).
  - sources: tooling-F17, 11-gaps-F8
- **L-220** P3/XS · dead-code — `LampRig.flare()` and `kick()` are interface with no caller
  - Nothing outside the hook calls `rig.flare` or `rig.kick`; a grep of SRC finds no caller.
  - sources: 01-table-F4
- **L-221** P3/XS · dead-code — ErrorBoundary `FallbackComponent` / `onError` are a hypothetical seam
  - the only caller passes neither prop, and no test uses them.
  - sources: 02-components-F12
- **L-222** P3/XS · dead-code — Dead code in the offline lobby and the room's invite panel
  - app/lobby.tsx:67-79 (`PlayerRow` renders a name `TextInput` only when `lobbyMode === "local" && !isHuman`, but local mode makes every seat human at :149 and nothing changes a seat's type, so the branch is unreachable, along with its hint, a11y label and `nameInput` style); app/(online)/room.tsx:193, 198, 622, 666 (`InviteFriendsPanel`'s `myUserId` prop is passed and never read). proposed: delete both, or decide that pass-and-play seats get names and make the condition `lobbyMode === "local" && index > 0`. …
  - sources: 03-app-context-F9
- **L-223** P3/XS · dead-code — mocks/audioApi.ts exports four types it alone uses
  - knip lists 6 unused exports. 4 are real: they are used only inside the file. 2 are false positives: `audioApiModule` and `audioSessionModule` are reached through `require` inside the `jest.mock` factories at setup.ts:165-166.
  - sources: 07-tests-native-F19
- **L-224** P3/XS · dead-code — Small hygiene items
  - lib/diagnostics/FrameProbe.tsx:45-49: `armFrames` never clears its 1 s reject timer after it resolves.
  - sources: 04-lib-shared-F12
- **L-225** P3/XS · structure — captureStates seats bots that the lobby never seats
  - `BOTS = ["Luan","Drita","Besnik"]` claims to match "as app/lobby.tsx fills empty seats".
  - sources: 04-lib-shared-F9
- **L-226** P3/XS · structure — Comments that are false in SRC
  - files and problems: `components/table/hand.tsx:311-313`: "the stagger is disarmed one render after the hand appears, so `dealDelay` becomes -1 while this card is still flying in".
  - sources: 01-table-F7
- **L-227** P3/XS · structure — Comments that say something false (tickets #1604)
  - GameTable.tsx:157-160 describes "whole-pixel travel, mirroring MenuButton … 2px down".
  - sources: 02-components-F5
- **L-228** P3/XS · structure — Comments that are false against SRC
  - files and problems: lib/game/autoMove.ts:132: "instead of assuming 3♣".
  - sources: 04-lib-shared-F10
- **L-229** P3/XS · structure — Comments that lie
  - `onlineGameLogic.ts` names `server/socket/socket.ts` as its caller and as the home of `handleRoundOver`.
  - sources: 05-server-F17
- **L-230** P3/XS · structure — Comments that are false or attached to nothing
  - lampFlareReducedMotion:7-8 says "the preference is mocked at module scope, so the two cannot share one file".
  - sources: 07-tests-native-F15
- **L-231** P3/XS · structure — Stale, orphaned and changelog comments
  - comments make claims that the code contradicts.
  - sources: 09-tests-server-engine-F14

## Native modules, device flows

**Target shape.** Production native fixes live outside diagnostics, native readings exist once, and Maestro/device flows share their boilerplate and wait on signals rather than sleeps.

- **L-232** P2/XS · defect — Pass-loops assume `btn-passa` disappears when the round ends, but exchange-phase.yaml says it stays drawn
  - offline-game.yaml:213-217 says the loop stops the moment `btn-passa` is gone. exchange-phase.yaml:100 says the opposite for the same screen, and actions.tsx:259-267 renders the button with `disabled={!canPass}`.
  - sources: 11-gaps-F3
- **L-233** P2/S · structure — Production-critical iOS patches ship inside the "diagnostics" bench module
  - The module named and documented as the bench/probe module also carries two fixes the store build depends on: the SwiftUI-filters flag behind iOS grayscale, and the recycled-layout swizzle from #1485.
  - sources: 04-lib-shared-F3, 11-gaps-F1
- **L-234** P2/S · structure — Platform twins have no compile-time contract
  - `lib/device/{audioEngine,hapticsEngine,musicTracks,fonts,inviteTaps}.ts` and their `.web.ts` twins, plus `lib/flushSync{,.web}.ts`.
  - sources: client-F19, 04-lib-shared-F4
- **L-235** P2/S · tooling — Seven Maestro flows copy the launch / tutorial-skip / lobby block, and the stated reason is false
  - exchange-phase.yaml:7-9 and new-match.yaml:12-14 say "Maestro has no import mechanism, so the boilerplate is duplicated on purpose".
  - sources: 11-gaps-F4
- **L-236** P3/XS · test — `captures.yaml` and `felt-opaque.yaml` use fixed sleeps and a hard-coded point
  - offline-game.yaml:19-28 says the table's glow and pulse never let the hierarchy settle.
  - sources: 11-gaps-F5
- **L-237** P3/S · structure — Native modules duplicate the latency readings
  - `modules/murlan-audio-session/ios/MurlanAudioSessionModule.swift:8-9` and `modules/murlan-diagnostics/ios/MurlanDiagnosticsModule.swift:31-32` define identical `outputLatencyMs` / `ioBufferMs`.
  - sources: client-F20, 11-gaps-F12
- **L-238** P3/S · resilience — Native diagnostics module: unbounded buffer, state not reset between captures, error swallowed on stop
  - if the bench stops draining (JS paused, bench screen left), `rows` grows without bound at audio rate (a `level` row every 50 ms).
  - sources: 11-gaps-F13

## Source-id checklist

301 of 301 source ids placed, each in exactly one entry.

**01-table** (12): F1→L-090, F2→L-096, F3→L-097, F4→L-220, F5→L-115, F6→L-103, F7→L-226, F8→L-092, F9→L-089, F10→L-104, F11→L-105, F12→L-106

**02-components** (13): F1→L-098, F2→L-116, F3→L-113, F4→L-103, F5→L-227, F6→L-107, F7→L-094, F8→L-073, F9→L-117, F10→L-108, F11→L-109, F12→L-221, F13→L-099

**03-app-context** (10): F1→L-057, F2→L-063, F3→L-065, F4→L-067, F5→L-062, F6→L-082, F7→L-085, F8→L-086, F9→L-222, F10→L-074

**04-lib-shared** (12): F1→L-001, F2→L-052, F3→L-233, F4→L-234, F5→L-006, F6→L-013, F7→L-014, F8→L-087, F9→L-225, F10→L-228, F11→L-075, F12→L-224

**05-server** (18): F1→L-023, F2→L-022, F3→L-027, F4→L-028, F5→L-029, F6→L-030, F7→L-033, F8→L-038, F9→L-041, F10→L-042, F11→L-043, F12→L-039, F13→L-040, F14→L-044, F15→L-045, F16→L-046, F17→L-229, F18→L-054

**06-tooling** (26): F1→L-182, F2→L-213, F3→L-188, F4→L-189, F5→L-190, F6→L-184, F7→L-191, F8→L-192, F9→L-193, F10→L-194, F11→L-176, F12→L-214, F13→L-185, F14→L-195, F15→L-215, F16→L-196, F17→L-197, F18→L-170, F19→L-198, F20→L-186, F21→L-199, F22→L-200, F23→L-216, F24→L-178, F25→L-217, F26→L-218

**07-tests-native** (19): F1→L-118, F2→L-119, F3→L-121, F4→L-142, F5→L-133, F6→L-124, F7→L-153, F8→L-125, F9→L-163, F10→L-154, F11→L-143, F12→L-169, F13→L-155, F14→L-156, F15→L-230, F16→L-134, F17→L-144, F18→L-157, F19→L-223

**08-tests-rules-tooling** (19): F1→L-120, F2→L-141, F3→L-129, F4→L-130, F5→L-122, F6→L-131, F7→L-166, F8→L-066, F9→L-149, F10→L-145, F11→L-150, F12→L-174, F13→L-167, F14→L-168, F15→L-123, F16→L-151, F17→L-132, F18→L-185, F19→L-152

**09-tests-server-engine** (17): F1→L-020, F2→L-019, F3→L-135, F4→L-140, F5→L-127, F6→L-035, F7→L-131, F8→L-146, F9→L-021, F10→L-123, F11→L-136, F12→L-170, F13→L-158, F14→L-231, F15→L-159, F16→L-160, F17→L-020

**10-tests-e2e-loop** (19): F1→L-147, F2→L-148, F3→L-137, F4→L-128, F5→L-138, F6→L-171, F7→L-149, F8→L-150, F9→L-172, F10→L-173, F11→L-218, F12→L-176, F13→L-175, F14→L-181, F15→L-179, F16→L-126, F17→L-205, F18→L-178, F19→L-201

**11-gaps** (13): F1→L-233, F2→L-139, F3→L-232, F4→L-235, F5→L-236, F6→L-161, F7→L-162, F8→L-219, F9→L-204, F10→L-202, F11→L-203, F12→L-237, F13→L-238

**domain** (19): F1→L-003, F2→L-004, F3→L-005, F4→L-001, F5→L-007, F6→L-009, F7→L-010, F8→L-011, F9→L-008, F10→L-002, F11→L-021, F12→L-012, F13→L-018, F14→L-015, F15→L-013, F16→L-006, F17→L-016, F18→L-017, F19→L-055

**server** (20): F1→L-026, F2→L-024, F3→L-050, F4→L-025, F5→L-002, F6→L-034, F7→L-051, F8→L-053, F9→L-019, F10→L-035, F11→L-031, F12→L-036, F13→L-037, F14→L-032, F15→L-127, F16→L-047, F17→L-048, F18→L-049, F19→L-056, F20→L-020

**client** (28): F1→L-058, F2→L-059, F3→L-069, F4→L-060, F5→L-061, F6→L-070, F7→L-068, F8→L-071, F9→L-062, F10→L-063, F11→L-119, F12→L-064, F13→L-072, F14→L-076, F15→L-065, F16→L-077, F17→L-078, F18→L-066, F19→L-234, F20→L-237, F21→L-079, F22→L-080, F23→L-081, F24→L-082, F25→L-083, F26→L-067, F27→L-084, F28→L-095

**tooling** (21): F1→L-177, F2→L-175, F3→L-176, F4→L-183, F5→L-184, F6→L-178, F7→L-179, F8→L-180, F9→L-185, F10→L-181, F11→L-205, F12→L-206, F13→L-207, F14→L-208, F15→L-209, F16→L-186, F17→L-219, F18→L-210, F19→L-187, F20→L-211, F21→L-212

**ui** (18): F1→L-088, F2→L-089, F3→L-090, F4→L-091, F5→L-099, F6→L-092, F7→L-100, F8→L-093, F9→L-101, F10→L-094, F11→L-102, F12→L-095, F13→L-145, F14→L-110, F15→L-111, F16→L-112, F17→L-113, F18→L-114

**tests** (17): T1→L-121, T2→L-118, T3→L-119, T4→L-024, T5→L-051, T6→L-141, T7→L-142, T8→L-019, T9→L-021, T10→L-143, T11→L-144, T12→L-163, T13→L-128, T14→L-122, T15→L-018, T16→L-164, T17→L-165
