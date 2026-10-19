# Client state and screens: design audit (context/, app/, lib/ excluding game, locales/, modules/)

Auditor report, 2026-10-16. Read-only. Every claim below was checked against the source at `d8c34919`; paths are relative to the repo root. "Verified" means read in code. Render-count claims follow from React context semantics and were **not measured**.

## Headline answer: is there one "table session" seam with offline and online as adapters?

**No, not at session level.** The one real seam is `GameTable`'s props (`components/GameTable.tsx:280-345`). It has five adapters: `app/game.tsx`, `app/(online)/game.tsx`, `app/(online)/replay.tsx`, `app/capture.tsx` and `components/BenchScreen.tsx`, and about 50 native tests render it directly. That seam is deep and should stay.

Above it there are two unrelated context surfaces:
- **Offline:** `GameContext`, read through `context/gameHooks.ts`.
- **Online:** six slice contexts, read through `context/onlineGameHooks.ts`.

`gameHooks.ts:1-11` records why one hook over both was rejected: it "would be a union with half its fields null". I agree with that. But the result is that each screen has to know things its adapter should own:
- **The offline screen (`app/game.tsx`)** runs the offline "server": bot loop, auto-advance to the next round, bot giveback, stuck-exchange release, local turn timeout and e2e globals (`app/game.tsx:54-163`, `211-227`). It also knows the match's internals (`rounds[...].pointsAwarded`, `:167-168`) and has to keep refs to every context command because the commands are render-scoped closures (`:54-68`, `152-159`).
- **The online screen (`app/(online)/game.tsx`)** builds the connection pill from three sources (`:90-91`, `279-296`), the rating view model (`:203-218`), vote tallies (`:219-246`, `298-331`) and lobby routing by `entrySource` (`:102-105`).

Findings F3, F4 and F8 make each context a complete adapter of "a table", so both screens become plain context-to-props mappings.

---

## P1

### F1. Online table teardown is written out by hand in three places, and the three lists disagree
- **Where:**
  - `abandonRejoin`: `context/OnlineGameContext.tsx:444-477`
  - `leaveRoom`: `:948-982`
  - listener-effect cleanup: `:873-880`
  - state declared at `:279-338`
- **What's wrong:** about 20 `useState`s and 10 refs make up "the table", but there is no single reset.
  - Both `abandonRejoin` and `leaveRoom` clear: game state, room, seat, votes, disconnected seats, cumulative scores, `placementPointsCurrent`, the two exchange edge refs and the reconnect notice.
  - Only `leaveRoom` also clears: `error`, `rejoiningRoomCodeRef`, `isSpectator`.
  - Neither clears: `matchState`, `placementPoints`, `ratingDeltas`, `ratingsAfter`, `roundRecorded`, `autoPassed`, `turnDeadline`, `entrySource`, `prevGameStateRef` (read by `sameResults` at `:601`), the exchange announcement, or reactions. `clearReactions` runs only on effect cleanup (`:879`), even though `lib/reactions.ts:52-55` says "leaving a table has to say so".
  - I found no visible bug today. Each leftover is overwritten by a later server event (`game:match_state`, the next `game:state`), so correctness holds by coincidence, not by construction. Every new field has to be remembered in two lists.
- **Proposed interface:**
  ```ts
  // inside the provider: one owner of "what a table is"
  type TableEnd = "left" | "rejoinRefused";
  function endTable(reason: TableEnd, payload?: ServerPayload): void; // resets every table field from one INITIAL_TABLE record and clears every timer/ref
  const INITIAL_TABLE: { room: null; gameState: null; mySeatIndex: -1; /*…all fields…*/ };
  ```
  Better still, group the table fields into one `useState<TableRecord>` (or `useRef` plus setter), so a reset is `setTable(INITIAL_TABLE)` and a new field cannot be missed.
- **Dependency category:** in-process.
- **Effect if done:** about 45 hand-written reset lines become one call each. Bugs where one table's stale state shows on the next become structurally impossible. A test can assert `endTable` returns every slice to its initial value by iterating the record, replacing per-field assertions scattered across `rejoinFailed.test.tsx` and `spectateFailed.test.tsx`.
- **Effort / risk:** S / low. The `rejoinFailed` latch and the `error` difference must stay per-reason.

### F2. Routing that follows table state is spread over five screens and three lobby-choice copies
- **Where:**
  - "a room exists, go to /room": `app/(online)/index.tsx:51-57` (push), `app/(online)/quickmatch.tsx:98-105` (replace), `app/(online)/friends.tsx:200-207` (push)
  - "a game state exists, go to /game": `app/(online)/room.tsx:348-354`, plus the spectate variant at `app/(online)/index.tsx:59-66`
  - "no room, back to a lobby chosen by `entrySource`": `room.tsx:356-364`, `room.tsx:443-451`, `app/(online)/game.tsx:102-105`
  - `rejoinFailed` bounce: `game.tsx:131-135`
  - offline null-state redirect: `app/game.tsx:161-163`
- **What's wrong:** the interface is leaky. Each screen must know which transitions are "its own", whether to push or replace, and that it must key on `room?.roomId` rather than `room` (the comment is copied three times). Only the game screen consumes `rejoinFailed`, so a refusal that lands while another screen is up depends on the latch rule documented at `OnlineGameContext.tsx:141-147`. The lobby chosen by `entrySource` is written three times.
- **Proposed interface:**
  ```ts
  // context/onlineRouting.ts, mounted once in app/(online)/_layout.tsx
  type OnlinePlace = "lobby" | "quickmatch" | "room" | "game";
  export function placeFor(s: { room: RoomState|null; hasGame: boolean; isSpectator: boolean; entrySource: EntrySource; rejoinFailed: boolean }): OnlinePlace; // pure
  export function useOnlineRouting(): void; // replaces/pushes on place change, consumes rejoinFailed
  ```
- **Dependency category:** in-process (expo-router is the only external, already a module).
- **Effect if done:** about 9 effects across 5 screens become one effect plus a pure function. Double navigation and missed transitions stop being per-screen concerns. The `placeFor` table becomes a plain unit test instead of mocking `expo-router` in screen tests (`connectingState`, `onlineLeaveConfirm`, `rejoinFailedExit`). The online lobby also stops needing `useOnlineTable()` just to compute `watching`; see F5.
- **Effort / risk:** M / medium. Push-vs-replace back-stack behaviour must be preserved. Verify with e2e back-button specs.

---

## P2

### F3. The offline "driver" lives in the screen, not in the offline adapter
- **Where:**
  - bot loop: `app/game.tsx:106-130`
  - next-round timer: `:97-104`
  - giveback and stuck exchange: `:132-159`
  - local turn timeout: `:211-227`
  - pass-and-play viewer rotation: `:84-93`
  - e2e globals: `:70-82`
  - `E2E_FAST` and `BOT_SUSPENDED`: `:31-36`
- **What's wrong:** locality. Online, the counterpart of this code is the server. Offline, it is split between `GameContext` (engine transitions and persistence) and a route file. The tests that cover it must render the whole screen and `GameTable` with a mocked wide `useGame` (`offlineAutoPass`, `exchangeHoldsTheTurn`, `passAndPlayHandoff`, `roundEndsOnTable`, `matchEndsOnTable`, `resumeAtRest`).
- **Proposed interface:**
  ```ts
  // context/offlineDriver.ts
  export function useOfflineDriver(): {
    viewerSeat: number;
    onExchangeReady: () => void;
    onRoundLanded?: (landsAt: number) => void;
    turnTimer: TurnTimerConfig;   // includes onExpire → passTurn + autoPassed++
    autoPassed: number;
  };
  ```
  The UI signals (`onExchangeReady`, `onRoundLanded`) still come from the table, so this is a hook rather than provider internals.
- **Dependency category:** in-process plus time. Inject `setTimeout` or use fake timers.
- **Effect if done:** `app/game.tsx` drops from 238 to about 90 lines and becomes a pure props mapping like the online screen. The driver gets a `renderHook` test surface with fake timers, so the six screen tests above can assert driver behaviour without `GameTable`.
- **Effort / risk:** M / medium. Pacing is game feel; keep `OFFLINE_BOT_DELAY_MS` and the `botTurnKey` semantics exactly.

### F4. GameContext commands are render-scoped closures, so callers must manage freshness
- **Where:** `context/GameContext.tsx:219-273` (`startNextRound`, `startNewMatch`, `chooseExchangeCard`, `playCards`, `passTurn`, `runBotTurn` and `releaseStuckExchange` all close over `gameState`). Consumers compensate in `app/game.tsx:54-68` (five refs synced in an effect) and `:152-159` (`readyRef`).
- **What's wrong:** an unwritten rule of the interface: "a command is valid only for the render that produced it". Every timer-driven caller must know it. Two calls in one tick both compute from the same snapshot, which is a lost update instead of a refusal. `resetGame` even depends on `gameState?.players.length` (`:290`).
- **Proposed interface:** the same signatures, but stable identity, reading the latest state:
  ```ts
  const stateRef = useRef<GameState|null>(null); // written in the single commit path
  const passTurn = useCallback(() => { const s = stateRef.current; if (!s || !checkPass(s).ok) return; commit(processPass(s), s); }, []);
  ```
  or `useReducer` over engine transitions, with announcements emitted through F6's pure function.
- **Dependency category:** in-process.
- **Effect if done:** about 20 lines of ref plumbing in `app/game.tsx` go away. Stale-closure double application becomes impossible. Command identity becomes stable, so `GameContext`'s value changes only on state change.
- **Effort / risk:** S / low.

### F5. The slice hooks are pass-throughs; every field is declared six times and tests have two mock seams
- **Where:**
  - `context/onlineGameHooks.ts:31-190`: each hook destructures an already-memoized slice and re-memos the same fields.
  - `context/gameHooks.ts:16-71`: four "slices" all over one `useGame()`.
  - The field lists appear in the interface (`OnlineGameContextValue`, `OnlineGameContext.tsx:78-152`), the `Pick`s (`:164-212`), the provider memos (`:1038-1103`), the hooks file (three times per hook: destructure, object, deps), `tests/ui-rules/contextSlices.test.ts:84-127` and `tests/native/onlineContextMock.ts`.
  - `useOnlineGame()` (`:1126-1137`) has zero production callers; only five tests use it.
- **What's wrong:**
  - **Deletion test:** `export const useOnlineConnection = useConnectionSlice` behaves identically. The provider memo's deps are exactly the hook's deps, so the hook's object changes exactly when the slice's does.
  - **The local slices are a hypothetical seam:** one context, so no render isolation (the file admits this, `contextSlices.test.ts:111`). `useLocalSession()` in `app/index.tsx:655` subscribes Home to the whole `GameContext`, and Home stays mounted under `/game` (`index → lobby(push) → game(replace)`; no `freezeOnBlur` in the app). So Home and its animated `CardField` re-render on every offline move. Similarly, `app/(online)/index.tsx:40` reads `useOnlineTable()` for one boolean, so the online lobby under `/game` wakes on every `game:state`.
  - **Two test seams:** 14 tests `jest.mock('@/context/onlineGameHooks')`, writing about 355 lines of factories; 3 tests mock the context module through `onlineContextMock`; offline tests mock `GameContext.useGame` wide (9 files) and never use `gameHooks`. `contextSlices.test.ts` (203 lines) plus `scripts/contextSurface.mjs` (138 lines) regex-parse source to pin the pass-throughs' shape.
- **Proposed interface:**
  ```ts
  // onlineGameHooks.ts becomes a re-export (keeps the import path tests already mock)
  export { useConnectionSlice as useOnlineConnection, useRoomSlice as useOnlineRoom, … } from "./OnlineGameContext";
  // GameContext: split like online where it pays — a rarely-changing session context
  export function useLocalSession(): { setupGame; resetGame; hasSavedGame; resumeGame; restored } // own context
  export function useLocalTable(): { gameState; match; …commands } // own context
  // a selector-sized read for screens that need one fact
  export function useIsWatching(): boolean;
  ```
- **Dependency category:** in-process.
- **Effect if done:**
  - about 170 lines out of `onlineGameHooks.ts`;
  - `useOnlineGame` deleted, or moved to tests;
  - `contextSlices.test.ts` partition checks become a type-level exclusivity assertion over the `Pick`s;
  - Home and the online lobby stop re-rendering per move;
  - one mock seam, or none with F11.
- **Effort / risk:** S for the online re-export, M for the `GameContext` split / low. `sliceRenderCounts.test.tsx` still pins the real behaviour.

### F6. Exchange-announcement detection is implemented twice, differently
- **Where:**
  - offline announces at command time: `GameContext.tsx:210-212`, `230-245`
  - online detects edges by diffing states with two dedicated refs: `OnlineGameContext.tsx:311-313`, `570-597`, plus their resets at `:470-471`, `980-981`
  - shared ceremony state: `lib/game/sharedGameFlow.ts:70-91`
- **What's wrong:** one concept ("an exchange just resolved, or the two-Joker exception was dealt") has two derivations. The engine already provides everything the online path reads: `processExchangeChoice` sets `cardToLoser` (`lib/game/gameEngine.ts:968`).
- **Proposed interface:**
  ```ts
  // lib/game/sharedGameFlow.ts
  export function exchangeAnnounceFor(prev: GameState | null, next: GameState): ExchangeAnnounceData | null; // pure
  ```
  Both adapters call it from their single commit path: `commitState` offline, `onGameState` online.
- **Dependency category:** in-process.
- **Effect if done:** two refs and four reset lines deleted online; offline announce code moves out of the commands. One pure test table covers both transports, replacing parts of `exchangeAnnounceBothWays`, `exchangeAnnounceFrame` and `ceremonyHoldsTheCard`. Offline and online can no longer disagree about when the ceremony opens.
- **Effort / risk:** S-M / medium. `resolveStuckExchange` closing a phase offline would start announcing "received only", as online would. Decide that explicitly.

### F7. The HTTP API has no client module: keys, types and invalidation are spread out, with three fetch clients
- **Where:**
  - 30 `queryKey: ["/api/…"]` literals across `app/profile.tsx:545-554`, `app/(online)/friends.tsx:74-87`, `app/(online)/room.tsx:210`, `app/index.tsx:391-396`, `context/SocketContext.tsx:102-107` and `139-143`, and others.
  - The same key is typed differently per site: `/api/friends/requests` is `{id}[]` at `app/index.tsx:391` and `FriendRequestInfo[]` at `friends.tsx:79`.
  - Invalidation is decided far from the data: `OnlineGameContext.tsx:714-718` (stats, history, achievements, rating, ladder after every round), `SocketContext.tsx:300`, `362-416`, `friends.tsx:108-146`, `194`.
  - Three fetch implementations: `lib/query-client.ts:1` uses `expo/fetch`, while `context/AuthContext.tsx:51-61` (`fetchMe`) and `lib/socket.ts:52-69` (`fetchSocketTicket`) use global `fetch`.
  - Both raw clients justify themselves with "apiRequest swallows a 401 identically" (`AuthContext.tsx:46-47`, `socket.ts:49-50`). That reason is stale: `apiRequest` throws `ApiError` carrying `.status` (`lib/apiError.ts:9-26`, `query-client.ts:19-24`).
- **What's wrong:** each caller must know the URL, the response type, which other keys go stale when, and which fetch to use. The query key is the URL (`query-client.ts:52`).
- **Proposed interface:**
  ```ts
  // lib/api.ts — the one HTTP adapter
  export type Outcome<T> = { ok: true; data: T } | { ok: false; status: number; payload: ServerPayload|null } | { ok: false; unreachable: true };
  export function request<T>(method: Method, route: string, body?: unknown): Promise<Outcome<T>>;
  // lib/queries.ts — one entry per resource
  export const Q = { friends: q<FriendInfo[]>("/api/friends"), friendRequests: q<FriendRequestInfo[]>("/api/friends/requests"), statsMe: q<UserStatsDto>("/api/stats/me"), … };
  export function useApi<K extends keyof typeof Q>(k: K, opts?): UseQueryResult<Data<K>>;
  export const stale = { afterRound: [Q.statsMe, Q.history, Q.achievements, Q.ratingMe, LADDER], onReconnect: [...], afterFriendAccept: [...] };
  ```
- **Dependency category:** remote-owned (port is `request`, adapter is `expo/fetch`; tests substitute an in-memory adapter instead of mocking `@/lib/query-client` in 19 files).
- **Effect if done:**
  - 30 key literals and about 8 per-site type assertions removed;
  - `fetchMe` and `fetchSocketTicket` shrink to about 3 lines each over `request`;
  - one fetch implementation, so cookie and credential behaviour cannot diverge between login and every other call;
  - invalidation sets named once, so a missed refresh after a round or friend event becomes a review of one table.
- **Effort / risk:** M / low-medium.

### F8. SocketContext mixes four responsibilities and hands screens the raw socket
- **Where:**
  - connection lifecycle, backoff, auth failure, session replaced: `context/SocketContext.tsx:176-184`, `228-239`, `255-326`, `431-449`, `464-487`, `519-525`
  - presence: `:134`, `328-359`
  - friends cache sync and banners: `:35-50`, `96-107`, `361-384`, `423-430`
  - invites (pending, accepted, hidden, server rows, dismiss): `:59-70`, `135-226`, `386-417`
  - `qc.clear()` on sign-out, a whole-app cache concern: `:144-151`
  - `connected` state (`:133`, `291`, `304`, `315`, `465`) has **no consumer**. Only `socket`, `onlineIds` and the invite fields are read (`friends.tsx:55`, `(online)/index.tsx:42`, `room.tsx:202`, `index.tsx:613/656`, `join/[code].tsx:12`, `OnlineGameContext.tsx:340`).
  - Screens emit on the raw socket:
    - `room.tsx:224-236` sends `friend:invite` with its own `.timeout().emit` and ack handling, bypassing `lib/sendIntent`. A failure is silent, and the 2 s timer at `:234` is never cleared.
    - `friends.tsx:209-213` and `room.tsx:206-208` both emit `friend:get_online_list`.
- **What's wrong:** a god context with a shallow, leaky surface. Every `useSocket()` consumer (Home, the online lobby, friends, room, and `OnlineGameProvider` itself) re-renders on every `friend:status` presence change.
- **Proposed interface:**
  ```ts
  useConnection(): { socket: Socket|null }                          // lifecycle only
  usePresence(): { onlineIds: ReadonlySet<string>; refresh(): void }
  useInvites(): { invites: PendingInvite[]; prompt: PendingInvite|null; accepted: string|null;
                  accept(code): void; dismiss(code): void; send(friendId, roomCode): Promise<boolean>; clearPrompt(); clearAccepted() }
  // friends cache sync: a listener hook in lib/friends.ts using F7's `stale` sets
  // qc.clear() on sign-out: AuthContext (owner of the session)
  ```
- **Dependency category:** remote-owned (socket).
- **Effect if done:**
  - no screen holds `socket`, so the 3 raw emits move behind named commands with error feedback;
  - presence churn wakes only presence readers;
  - the 20 tests mocking `@/context/SocketContext` each mock one small surface;
  - dead `connected` deleted.
- **Effort / risk:** M / medium. The account-switch reset at `:245-253` must move with each piece.

### F9. The persisted table handles have no owner module; Home reads the storage key directly
- **Where:**
  - writer and reader: `OnlineGameContext.tsx:363-379`, `479-497`
  - Home reads the same key itself: `app/index.tsx:661-679`
  - `tests/native/homeReturnToTable.test.tsx:19-26` has to mock `@react-native-async-storage/async-storage` globally to test one decision.
- **What's wrong:** a missing seam. "Is there a table I can return to?" has no interface, and storage format and key ownership leak to a screen outside the provider's subtree.
- **Proposed interface:**
  ```ts
  // lib/tableHandles.ts
  export const tableHandles = {
    read(): Promise<{ activeRoomId: string|null; waitingCode: string|null }>;
    setActive(roomId: string|null): void; setWaiting(code: string|null): void;
  };
  export function useHasActiveTable(): boolean; // re-reads on focus, as index.tsx does now
  ```
- **Dependency category:** local-substitutable (AsyncStorage; tests pass an in-memory map).
- **Effect if done:** about 25 lines out of Home and about 20 out of the provider. The test stops mocking AsyncStorage.
- **Effort / risk:** S / low.

### F10. Two different "accept an invite" paths
- **Where:**
  - `SocketContext.acceptInvite` (`:218-225`), used from `app/index.tsx:625-626` and `app/join/[code].tsx:16-18`, routes through the online lobby, which waits for `connected` (`(online)/index.tsx:102-107`).
  - `friends.tsx:223-227` (`handleJoinGameInvite`) calls `hideGameInvite` plus `joinRoom` directly: no `connected` gate and no clearing of `pendingInvite`. The `acceptInvite` docstring (`:214-217`) calls that clearing necessary ("leaving `pendingInvite` up would reopen the code prompt").
- **What's wrong:** one operation, two implementations with different preconditions.
- **Proposed interface:** `useInvites().accept(code)` (F8) as the only entry point. The friends screen calls it and navigates like Home does.
- **Dependency category:** in-process.
- **Effect if done:** one path, and `acceptInviteClearsPending.test.tsx` covers both callers.
- **Effort / risk:** S / low.

### F11. No shared fake socket and no static online provider, so tests hand-roll both
- **Where:**
  - 18 native tests each define their own socket double: `rejoinFailed.test.tsx:24-47` (whose `off(){}` is a no-op, so listener-removal bugs are invisible there), `sessionReplaced`, `socketReconnect`, `ownLinkHold`, `spectateFailed`, `sliceRenderCounts`, `tableNotices`, and others.
  - 14 tests write slice mock factories of 3 to 55 lines each (F5).
- **What's wrong:** the socket is the remote-owned dependency of two providers, and there is no adapter for it in tests. Each double implements a different subset (`once`, `timeout`, ack callbacks), so a provider change breaks some doubles and silently passes others.
- **Proposed interface:**
  ```ts
  // tests/native/helpers/fakeSocket.ts
  export function fakeSocket(opts?: { connected?: boolean; ack?: (event, payload) => IntentReply | "silent" }): Socket & {
    serverEmit(event: string, ...args: unknown[]): void; emitted: { event: string; payload?: unknown }[]; listenerCount(event: string): number };
  // tests/native/helpers/staticOnlineGame.tsx — the six slice Providers with defaults, overrides per slice
  export function StaticOnlineGame(p: Partial<{ connection; room; table; turnClock; match; exchange }> & { children }): JSX.Element;
  ```
  The second requires exporting the six `Context` objects, or a `StaticOnlineGameProvider`, from `OnlineGameContext.tsx`.
- **Dependency category:** remote-owned (socket) / in-process (contexts).
- **Effect if done:** about 18 hand-rolled doubles and about 355 lines of `jest.mock` factories replaced. `listenerCount` makes the "twenty `on`, twenty `off`" claim in CONTEXT.md testable.
- **Effort / risk:** M / low.

### F12. Locale keys duplicate domain terms per screen, and the translations have already drifted
- **Where:** a script over `locales/*.ts` (923 en keys) found 52 groups of keys sharing one English value; in 21 of them the it or sq translations differ. The domain-term cases:
  - "Free-for-all" is 4 keys (`result.modeFreeForAll`, `lobby.`, `onlineLobby.`, `room.`), with 4 different Italian strings: "Libero", "Tutti vs Tutti", "Libera", "Tutti contro tutti". Albanian has 4 variants too.
  - "Teams" is 4 keys, with Italian "Coppie" / "A Coppie" / "A coppie".
  - "Queen": `cards.rankQueen` = "Donna" but `rules.strengthQueen` = "Regina".
  - Combination names are split between `gameShared.combo*` and `rules.combo*Name`.
- **What's wrong:** CONTEXT.md says each domain term has one word that "each locale translates". The catalogue structure (namespaced by screen) means every new screen makes a new copy of a term, and nothing makes them agree.
- **Proposed interface:** a `term.*` namespace for glossary words (`term.mode.freeForAll`, `term.mode.teams`, `term.rank.queen`, `term.combo.straight`, …) plus tiny helpers `modeLabel(mode, t)` and `comboLabel(type, t)`. A test fails when a non-`term.*` key's English value equals a `term.*` value.
- **Dependency category:** in-process.
- **Effect if done:** about 20 keys times 3 locales removed and the drift fixed. Screens stop picking the per-screen key.
- **Effort / risk:** S / low. Needs a translator's call on which variant wins; some variants may be grammatical agreement on purpose.

### F13. OnlineGameContext as a whole is a god provider (map of where F1, F6, F7, F9 and F14 apply)
- **Responsibilities by line range in `context/OnlineGameContext.tsx`:**
  - surface types and slices: 44-238
  - persisted handles: 240-245, 363-379, 479-497
  - rejoin state machine (requested-room guard, retries, terminal codes, `game:started` fallback): 246-265, 317-334, 381-477, 799-834
  - connection status: 341-361
  - protocol-version gate: 503-509
  - room state and errors: 511-547, 620-622
  - game state, exchange edges and persistence: 549-618
  - banners and i18n: 624-649, 733-750
  - match and round results plus query invalidation: 651-719
  - votes: 721-722
  - reactions: 724-725, 877-879
  - disconnect seats and notice timers: 752-797
  - intents: 894-1032
  - teardown: 444-477, 948-982
- **Not proposed:** CONTEXT.md (2026-09-10) rejects extracting a `reduce(state, event)`; nothing here proposes that.
- **Proposed instead:** extraction by responsibility, keeping effects where they are:
  ```ts
  function useRejoin(socket, handles: TableHandles, onRefused: (p: ServerPayload) => void): { attempt(): boolean; settle(): void; onRejoinFailed(d): void; onRoomError(p): boolean };
  ```
  plus F1 (`endTable`), F6 (`exchangeAnnounceFor`), F7 (`stale.afterRound`) and F9 (`tableHandles`).
- **Dependency category:** remote-owned (socket) / local-substitutable (storage).
- **Effect if done:** the provider drops from about 1140 to about 700 lines. The rejoin rules (the stale-reply guard, the retry cap of 3 at 2000 ms) get a `renderHook` plus fake-socket test surface of their own instead of being exercised through the full provider (`rejoinFailed.test.tsx`).
- **Effort / risk:** M-L / medium. The rejoin code carries hard-won ordering invariants.

---

## P3

### F14. Connection status is three subscriptions plus a composition in the screen
- **Where:**
  - `connected` via `useSyncExternalStore`: `OnlineGameContext.tsx:346-361`
  - `useOwnLink(socket)` subscribes to the same events again: `lib/useOwnLink.ts:23-56`
  - `SocketContext`'s own `useState` `connected` (dead, F8)
  - the screen composes `linkPill(ownLink, connected, reconnectNotice?.back)` and maps it to a translated `ConnectionNote`: `app/(online)/game.tsx:90-91`, `279-296`
- **Proposed interface:** `useOnlineConnection()` returns `connectionNote: ConnectionNote | null` (built once, from the pure `lib/ownLink.ts`), plus `ownLink`.
- **Effect if done:** about 20 lines out of the screen. The pill mapping becomes a unit test instead of a screen test (`onlineStatusRow`, `tableNotices` connection cases).
- **Category / effort / risk:** in-process / S / low.

### F15. The server-error latch leaves "who clears it" to each screen
- **Where:**
  - `error` is set at `OnlineGameContext.tsx:546` and `621`.
  - It is rendered four different ways: an inline banner (`(online)/index.tsx:241-258`), inline text (`quickmatch.tsx:264-266`), converted to a toast then cleared (`room.tsx:366-371`), and floated on the table (`game.tsx:276`).
  - The provider clears it defensively on join, spectate and leave (`:934`, `942`, `975`, with comments about a standing error "greeting the player").
- **Proposed interface:** `error: { text; seq; surface: "lobby"|"table" } | null` with consumption tied to `seq` (`useServerError(surface)` acknowledges on read). Alternatively, fold it into F2's routing so the active place owns it.
- **Category / effort / risk:** in-process / S / low.

### F16. Error-toast boilerplate repeated
- **Where:** `showNotification({ type: "game_error", title: t("common.error"), message })` at `friends.tsx:67`, `room.tsx:368`, `room.tsx:404`, `OnlineGameContext.tsx:902-907`, `SocketContext.tsx:424-429` and `443-448`. The last two are identical bodies.
- **Proposed interface:** `notifyError(message: string)` on `NotificationContext`, and `notifyServerError(payload)`.
- **Effect if done:** 6 sites become 1 line each.
- **Category / effort / risk:** in-process / S / none.

### F17. NotificationContext mixes a stable command with fast-changing state
- **Where:** `context/NotificationContext.tsx:96-105`. A single value holds `showNotification` (stable) together with `notification` and `bannerBottom`, so every component that only calls `showNotification` (both online providers, `GameProvider`, room, friends, SettingsModal) re-renders on every banner change and every measured `bannerBottom`.
- **Proposed interface:** split into a `NotifyContext` (`showNotification`, `notifyError`) and a `BannerContext` (`notification`, `dismiss`, `bannerBottom`, `report`). `useBannerBottom` already reads separately.
- **Category / effort / risk:** in-process / S / low.

### F18. e2e configuration leaks into production interfaces
- **Where:**
  - `exchangeHoldMsOverride` is part of `GameContextValue` (`GameContext.tsx:120-121`, `161`), threaded through `useLocalExchange` and into `GameTable` (`app/game.tsx:233`).
  - e2e knobs at module scope in `GameContext.tsx:48-67`.
  - `process.env.EXPO_PUBLIC_E2E_FAST === "1"` is evaluated at 14 sites across app, context, lib and components.
  - `lib/e2eBotSuspend.ts` and `lib/e2eRealExchange.ts` are line-for-line copies apart from the key.
  - `murlanPass` / `murlanBotMove` globals in a route file: `app/game.tsx:70-82`.
- **Proposed interface:**
  ```ts
  // lib/e2eConfig.ts — the one place the env literal is read
  export const e2e: { fast: boolean; suspendBot: boolean; realExchange: boolean; opener: boolean; exchangeHold?: ExchangeHold };
  function storedFlag(key: string): boolean; // replaces the two copied modules
  ```
  `GameTable`, or the exchange component, reads `e2e.exchangeHold` directly, and the field leaves the context interface.
- **Category / effort / risk:** in-process / S / low. The literal `process.env.EXPO_PUBLIC_…` must stay greppable for inlining; one module does that.

### F19. Platform twins have no compile-time contract
- **Where:** `lib/device/{audioEngine,hapticsEngine,musicTracks,fonts,inviteTaps}.ts` and their `.web.ts` twins, plus `lib/flushSync{,.web}.ts`. Callers type-check against the native file only. The `export` lists match today (checked by diff), but only by hand; no test or type pins it (`tests/tooling/repoLayout.test.ts` only lists file names).
- **Proposed interface:** a type-only check per pair, e.g. `lib/device/twins.check.ts`: `import * as n from "./audioEngine"; import * as w from "./audioEngine.web"; const _: typeof n = w;` Or `satisfies AudioEngine` from a shared `*.types.ts`.
- **Effect if done:** web/native signature drift becomes a `tsc` error.
- **Category / effort / risk:** in-process / S / none.

### F20. Native modules duplicate the latency readings
- **Where:** `modules/murlan-audio-session/ios/MurlanAudioSessionModule.swift:8-9` and `modules/murlan-diagnostics/ios/MurlanDiagnosticsModule.swift:31-32` define identical `outputLatencyMs` / `ioBufferMs`. The game uses the first (`lib/device/audioEngine.ts:252-253`); the bench measures through the second (`lib/diagnostics/probe.ts:7-8`), so a change to how the game reads latency would not be what the bench measures.
- **Proposed interface:** `probe.outputLatencyMs` and `ioBufferMs` read `@/modules/murlan-audio-session`; drop the two optional members from `MurlanDiagnostics`.
- **Category / effort / risk:** true-external (native) / S / low.

### F21. Stored settings JSON is parsed twice
- **Where:** `lib/device/feedback.ts:36-41` (a raw `JSON.parse` that reads `hapticsEnabled`) and `context/SettingsContext.tsx:94-110` (`parseStored`, which validates every field).
- **What's wrong:** the format has two readers, and only one validates.
- **Not proposed:** CONTEXT.md's "Feedback master state" note rejects a single `applyFeedbackSettings`; this keeps the separate setters.
- **Proposed interface:** `lib/settingsStore.ts`: `export function readStoredSettings(): Promise<Partial<Settings>>` (moving `parseStored` there), used by both.
- **Category / effort / risk:** local-substitutable / S / low.

### F22. The query loading / error / data block is repeated about 10 times
- **Where:** `app/profile.tsx:587-596`, `630-634`, `747-753`, `797-800`; `leaderboard.tsx` (7 `LoadingBlock`/`ErrorBlock`/retry sites); `history.tsx` (4); `friends.tsx` (5); `room.tsx:249-255`; `replay.tsx`.
- **Proposed interface:**
  ```ts
  <QueryBlock q={query} loading={label} errorTitle={…} retryA11y={…} stale? empty?>{(data) => …}</QueryBlock>
  ```
- **Category / effort / risk:** in-process / S / low. The `stale` and empty variants differ per site, so they must remain props.

### F23. Room-code normalisation is scattered and the two join commands disagree
- **Where:** `OnlineGameContext.tsx:943` (`spectateRoom` uppercases), `:927-936` (`joinRoom` does not), `(online)/index.tsx:128`, `135`, `369`, `lib/deepLink.ts:4-8` (`joinCode`).
- **Proposed interface:** `joinRoom` and `spectateRoom` both normalise through `joinCode()`; callers pass raw input.
- **Category / effort / risk:** in-process / S / none.

### F24. The tutorial route file holds pure content and engine validation
- **Where:** `app/tutorial.tsx:40-454` (card literals, `buildExchangeState`, `buildBeats` at about 180 lines, `stageBeat`, `evaluatePlay`, `evaluateExchange`). Progress persistence is inline AsyncStorage at `:477-506`.
- **Proposed interface:** `lib/tutorial/beats.ts`: `buildBeats(t): Beat[]`, `evaluatePlay(sel, beat, t)`, `evaluateExchange(card, beat, t)`; plus `tutorialProgress.{read,write,clear}` beside `lib/tutorialSeen.ts`.
- **Effect if done:** the screen drops from about 900 to about 450 lines. The validation becomes unit-testable under `node --test`; today `tutorialTableBeats.test.tsx` renders the screen.
- **Category / effort / risk:** in-process / S / low.

### F25. Contexts store translated strings, not payloads
- **Where:** `ServerError.text` (`OnlineGameContext.tsx:76`, `546`, `621`) and `ReconnectNotice.text` (`:758`, `781`) are translated when the event arrives. The banners in `SocketContext.tsx:364-398` are translated at event time too.
- **What's wrong:** the providers depend on i18n (presentation), and a language switch in SettingsModal does not re-render a standing error or notice. `useTranslation().translateServerPayload` exists (`lib/i18n.ts:185-192`) but the contexts cannot use it.
- **Proposed interface:** store `{ payload: ServerPayload; seq }` and translate at render.
- **Category / effort / risk:** in-process / S / low. A cosmetic edge, not a priority bug.

### F26. Small leaks in the auth and socket error modes
- **Where:**
  - `setSocketAuthFailureHandler`: a single global callback slot in `lib/socket.ts:39-42`, installed by a React provider (`SocketContext.tsx:288`, `474`).
  - `AuthContext.logout` (`:195-200`) clears local state only after the POST succeeds. The auth-failure path (`SocketContext.tsx:286`) relies on it and navigates to `/auth` regardless, so a failed POST leaves the local session cached. The server route needs no auth (`server/http/routes.ts:525-534`), so this needs a network failure at that moment.
- **Proposed interface:** `connectSocket(userId, { onAuthFailure })`, held per socket; plus `AuthContext.forgetSession()` (local only), with `logout = server POST then forgetSession`, called with `finally`.
- **Category / effort / risk:** remote-owned / S / low.

### F27. `tn()` takes an untyped base string
- **Where:** `lib/i18n.ts:136-141` (`base: string`, then `as TranslationKey`). A misspelled base compiles; `tests/ui-rules/i18n.test.ts:776-782` only checks for unused keys.
- **Proposed interface:** ``type PluralBase = { [K in TranslationKey]: K extends `${infer B}_one` ? B : never }[TranslationKey]; tn(base: PluralBase, …)``
- **Effect if done:** about 14 call sites become compile-checked.
- **Category / effort / risk:** in-process / S / none.

### F28. Orientation lock sits outside `lib/device/orientation` (boundary note, components area)
- **Where:** `components/GameTable.tsx:155`, `209-212`, `963-967` call `expo-screen-orientation` and `modules/murlan-orientation` directly; `lib/device/orientation.tsx` owns only reading orientation.
- **Proposed interface:** `lockLandscape()` and `releaseLandscape()` exported from `lib/device/orientation.tsx`.
- **Category / effort / risk:** true-external / S / none.

### Note for the protocol auditor
`OnlineGameContext` parses 3 of 18 inbound events (`room:state`, `game:state`, `game:round_over`), each followed by `as unknown as` (`:514`, `558`, `688`) because the `passthrough` schemas do not infer the client types. The other 15 handlers trust their payload type outright. The comment at `:503` says this is deliberate ("Rendering is all the parse protects"); it is worth a look from the `shared/protocol.ts` side.

---

## Already deep: leave alone
- **`GameTable` props seam** (five adapters, about 50 direct tests).
- **`lib/sendIntent.ts`:** `send` / `undelivered`, intent ids, retry on retryable codes. Small interface, a lot behind it.
- **`lib/ownLink.ts` plus `lib/useOwnLink.ts`:** a pure link state machine with injectable time.
- **`lib/reactions.ts`:** an external store isolated from table renders.
- **`lib/socket.ts`:** `peekSocket` / `subscribeToSockets` read the socket instead of mirroring it.
- **`lib/game/sharedGameFlow.ts`:** `useExchangeAnnouncement`, one ceremony state for both transports. F6 only adds the pure "when" next to it.
- **`lib/offlineSave.ts`:** `encode` / `decode` / `isResumable` with a versioned "incompatible" outcome.
- **`NotificationContext` queue semantics:** dedupe, the cap, and dismiss keyed to the shown item. Only F17's split applies.
- **`lib/i18n.ts` plus `locales/`:** catalogues typed against `en` (`Record<keyof typeof en, string>`), so missing or extra keys are compile errors. F12 and F27 tighten them without restructuring.
- **`AuthContext`'s `fetchMe` contract** (`null` / `undefined` / user) and NetInfo re-confirmation. Only the fetch client (F7) and `forgetSession` (F26) change.
- **Small modules:** `lib/updateRequired.ts`, `lib/reconnectDelay.ts` (injectable `random`), `lib/apiError.ts` (`serverErrorMessage`), and `lib/storageKeys.ts` (the `ACCOUNT_KEYS` / `DEVICE_KEYS` partition).
- **The online six-context split itself:** real render isolation, pinned by `tests/native/sliceRenderCounts.test.tsx`. F5 removes only the pass-through layer on top.
- **Recorded rejections in CONTEXT.md, respected here:** no reducer extraction from `OnlineGameContext`, no single `applyFeedbackSettings`, and no shared hook for the five account-recovery request blocks (profile's ChangePassword, AddEmail and VerifyEmail cards are left as they are).
