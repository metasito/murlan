# 07 — Client: contexts and providers

Area: `context/` (OnlineGameContext and its six slices, GameContext, Socket, Notification, Auth),
the online route group's navigation, and a handful of client-side small fixes. Lines are at MAIN
(`a1d0ebb5`) unless marked.

## 1. Summary

- **Now:** each provider exposes *state*, and the screens supply the behaviour that follows from it: five online screens each navigate on table state; offline, `app/game.tsx` runs the bot loop and keeps refs to stale-prone commands; teardown, rejoin and storage handles are written out by hand inside a 1104-line provider; Socket and Notification contexts mix stable commands with fast state.
- **After:** each provider is a complete adapter. Online: one `resetTable()`, one `useRejoin` hook that owns the handles, one routing hook in the `(online)` layout, server notices stored as payloads with a surface. Offline: GameContext commands read the latest state (stable identity, no lost update), "resumable" is derived, and a `useOfflineDriver` hook does what the server does online. Socket/Notification are split by rate of change.
- **Kept:** the six online slice contexts (#961/#1602, `CONTEXT.md:127-138`), no `reduce(state, event)`, the auth request blocks unmerged, the `GameTable` props seam.
- **Why:** most of the 25 entries are one root cause showing up in different places: a behaviour that belongs to the adapter has been pushed out to its callers. When the adapter owns it, the per-caller copies go away.
- **Tickets:** 8 (6 M, 2 S), in two independent chains (online: C1→C2→C3→C4a→C4b→C6; offline: C5a→C5b).

## 2. Current shape (evidence at MAIN)

**Online provider, `context/OnlineGameContext.tsx` (1104 lines).**
- 21 `useState` (`:279-335`) and 9 refs (`:311-331`) make up "the table". Teardown is written out twice. `abandonRejoin` (`:441-472`) resets 14 things. `leaveRoom` (`:917-949`) resets 18, and it is the only one that clears `error`, `rejoiningRoomCodeRef` and `isSpectator`. `onRoomError` (`:530-535`) does a third, partial reset. Neither full teardown clears `matchState`, `placementPoints`, `ratingDeltas`, `ratingsAfter`, `roundRecorded`, `autoPassed` or `turnDeadline`. Each of those is overwritten later by `game:match_state` (`:620-640`) or the next `game:state`, so they are correct by coincidence (L-058).
- The rejoin state machine is spread out: refs at `:315-331`, `forgetRejoinAttempt` `:379-386`, `attemptRejoin` `:396-432`, the storage load `:475-491`, `onRejoinFailed` `:768-793`, `onGameStarted` `:799-802`, the terminal-code branch of `onRoomError` `:530-535` and the constants `:250-265`. It is only exercised through the whole provider (`tests/native/rejoinFailed.test.tsx`).
- Persisted handles: written through refs plus AsyncStorage (`:360-376`). Home reads `ACTIVE_ROOM_KEY` itself (`app/index.tsx:661-679`), so `tests/native/homeReturnToTable.test.tsx` mocks AsyncStorage (L-062).
- Connection: `connected` comes from its own `useSyncExternalStore` (`:343-358`). `useOwnLink(socket)` (`:338`, `lib/useOwnLink.ts:23-45`) subscribes to the same two events. `useOwnLink.ts:32` resets the shared WeakMap entry on every subscribe (L-075). The screen composes `linkPill(...)` and then maps it to text (`app/(online)/game.tsx:91,280-296`) (L-076).
- Errors are stored as translated text (`:541,590`). So are notices (`:727,750`) (L-083). The text is rendered four ways and cleared by whichever screen gets there first: `app/(online)/index.tsx:241-258`, `quickmatch.tsx:109,154,161,264-266`, `room.tsx:366-371` (toast and clear) and `game.tsx:276`. All four screens can be mounted at once (L-065).
- `spectateRoom` uppercases (`:912`) and `joinRoom` does not (`:904`). Callers uppercase at `app/(online)/index.tsx:128,135` (L-081).
- Slices: one context per slice with its own memo (`:164-229`, `:1005-1070`). `context/onlineGameHooks.ts:28-60` is six one-line pass-throughs. `useOnlineGame` (`:1093-1104`) is read only by tests (L-061, online half).

**Routing (L-059):**
- Effects keyed on `room?.roomId`: `app/(online)/index.tsx:52-56` (push), `quickmatch.tsx:100-104` (replace) and `friends.tsx:202-206` (push), with the "id, not the room" comment copied three times.
- Spectate push: `index.tsx:63-66`. Room to game: `room.tsx:349-354`.
- Lobby chosen by `entrySource`: `room.tsx:356-364`, `room.tsx:446-451` and `game.tsx:102-105`.
- `rejoinFailed` is consumed only by `game.tsx:131-135`.
- `friends.tsx` is pushed on top of the still-mounted lobby, and both have a roomId push effect. That probably means two pushes for one room. This is unmeasured; C3 pins it.

**Invites (L-063):** Home and the join route call `acceptInvite` (`app/index.tsx:623-626`, `app/join/[code].tsx:16-18`). The online lobby joins once connected (`index.tsx:103-107`). Friends calls `hideGameInvite` and then `joinRoom` (`friends.tsx:223-227`), with no connected gate and no `pendingInvite` clear. The lobby is not always under friends: `SocketContext.tsx:368,382` pushes `/(online)/friends` directly.

**SocketContext (L-071, L-067):**
- One value (`:490-517`) holds `socket`, a dead `connected` (`:133,291,304,315,465`, never read), `onlineIds` (`:134,328-349`) and seven invite fields. Every consumer, including `OnlineGameProvider` (`OnlineGameContext.tsx:337`), wakes on every `friend:status`.
- Raw emits from screens: `friends.tsx:211`, `room.tsx:207`, and `friend:invite` with its own ack (`room.tsx:224-236`).
- `lib/socket.ts:39-42` keeps one global auth-failure slot. `onAuthFailure` calls `logout()` (`SocketContext.tsx:286`), which POSTs before it clears anything locally (`AuthContext.tsx:195-200`).

**NotificationContext (L-077, L-078):** one value (`:96-105`) holds the stable `showNotification` together with `notification` and `bannerBottom`. `dismissNotification` depends on `notification` (`:79-81`). `useBannerBottom` reads the same context (`:46-57`). There are nine `game_error` toast sites, and only `SocketContext.tsx:424-429` and `:443-448` are identical.

**Account deletion (L-073):** `components/SettingsModal.tsx:151-168` runs the DELETE, `onClose()` and `await logout()` in one try. A network drop between the two calls reports a deletion that succeeded as failed.

**Offline (L-057, L-060, L-061 local, L-066, L-069):**
- Every `GameContext` command closes over `gameState` (`context/GameContext.tsx:218-266`). `app/game.tsx:57-68` keeps five refs and `readyRef` (`:149-156`) so its timers get fresh closures.
- `hasSavedGame`/`savedRef` are set once from the boot read (`:157-158,298-316`). The persist effect (`:335-351`) never updates `savedRef`. `resumeGame` (`:286-296`) restores the boot snapshot. A render-phase sync clears the flag on match over (`:329-333`). The result: back to Home, then Resume, rolls the live match back to its boot snapshot (L-057).
- `exchangeHoldMsOverride` is part of the context value (`:120-121,161`) only so that `app/game.tsx:230` can forward it. The e2e knobs are module constants in a provider (`:48-67`). `process.env.EXPO_PUBLIC_E2E_FAST` is read at 14 sites (the ledger's L-066 evidence lists them). `lib/e2eBotSuspend.ts` and `lib/e2eRealExchange.ts` are the same reader with different keys.
- The offline driver lives in the route file: deal timer `app/game.tsx:97-104`, bot loop `:113-127`, giveback and stuck `:132-156`, e2e globals `:71-82` and the turn timeout `:219-223` (L-069). One context feeds four `useMemo` projections (`context/gameHooks.ts:16-71`), so Home's `useLocalSession` wakes on every offline move while `/game` is pushed over it.

**Small (L-064, L-074, L-084, L-085, L-086, L-087):**
- Mode labels are duplicated in four namespaces and have already drifted in `it` and `sq` (`locales/it.ts:328-329,599-600,803-804,836-837`; readers `components/HistoryRow.tsx:31`, `app/lobby.tsx:232`, `app/(online)/index.tsx:154`, `room.tsx:462`).
- The room's 1 s interval re-renders the whole room screen for every viewer (`room.tsx:336-347`, shown only at `:488`).
- `tn(base: string)` uses a cast (`lib/i18n.ts:135-141`).
- Provisional rounds-left is computed in three places (`app/profile.tsx:601-602`, `leaderboard.tsx:39-40`, `app/(online)/game.tsx:213-214`), plus the server flag at `server/game/ratings.ts:197`.
- The `[2,3,4]` chips appear in `app/lobby.tsx:215` and `app/(online)/index.tsx:172`. The match-length picker is copied at `room.tsx:142-177`. The teams rule is written as a literal 4 at `app/lobby.tsx:170,226` and `app/(online)/index.tsx:184,195-196`, while `room.tsx:384` and `server/socket/socketTable.ts:133` use `TEAMS_PLAYER_COUNT`.
- On native, every reduce-motion subscriber adds its own `AccessibilityInfo` listener and bridge call (`lib/accessibility.ts:91-100`).

## 3. Alternatives considered

### 3a. The online provider's internals (L-058, useRejoin, L-062)

| | A. `resetTable()` + `useRejoin` hook owning handles (pick) | B. One `useState<TableRecord>` + reducer-like setters | C. Leave the provider; add a teardown test only |
|---|---|---|---|
| Depth | `useRejoin` hides 6 refs, 2 timers, the retry cap, the stale-reply guard, the terminal codes and storage behind 7 methods | Deep, but the record changes on every field, which defeats #1602's per-slice memos (`sliceRenderCounts.test.tsx`) | none gained |
| Locality | rejoin rules in one file with a `renderHook` + fake-socket test | one record, but the memos must re-derive slices with selectors | unchanged |
| Records | respects `CONTEXT.md:132-138` (effects stay in the handlers) | close to the rejected reducer; owner note L-058 says no | — |
| Migration risk | medium: ordering invariants move file, but keep their order | high: every handler rewritten | none |

Pick **A**. B is rejected by the owner's L-058 note and by the render-count pin. C leaves the three hand-written lists in place.

### 3b. Routing that follows table state (L-059, L-063)

| | A. One `useOnlineRouting()` in `app/(online)/_layout.tsx` + pure `navigationFor(prev, next, here)` (pick) | B. Per-screen `useFollowTable(screen)` sharing a pure `placeFor` + `lobbyFor` |
|---|---|---|
| Interface a screen knows | nothing; screens only render | its own name, and which transitions are its own |
| Double navigation (lobby + friends both mounted) | impossible: one effect | still possible: two mounted screens, two hooks |
| `rejoinFailed` latch | consumed wherever the player is | still only where a screen opted in |
| Accepted-invite join | lives at the layout, so it also runs when the lobby is not mounted (friends reached from a banner) | stays in the lobby screen |
| Risk | the back stack must match today's push/replace exactly; pinned by a pure table test and the online e2e specs | lower: closer to today |

Pick **A**. B removes the copies but keeps the leak: every screen still has to know the stack. The verifier's "pure function first" advice is followed inside A's migration: the pure `navigationFor` and its table test land before any effect is deleted.

### 3c. Offline commands (L-060, with L-057, L-069)

| | A. Commands read a `stateRef` written only by one `commit(next)`; config in a ref (pick) | B. `useReducer({game, match, config})` over engine transitions; announcements derived in a commit-time effect |
|---|---|---|
| Lost update | impossible: the second call reads the first call's result | impossible |
| Identity | stable | stable `dispatch` |
| Announcements | stay in the same batch as the state (`commitState` today) | land one render later, so the bot-loop key sees an inactive phase with no announcement for one render; that is safe only because the bot delay is > 0 |
| Size of change | GameContext body only; same engine calls | GameContext rewritten; StrictMode double-invoke must stay pure |

Pick **A**. B is not barred offline (the `CONTEXT.md` rejection is about the socket provider), but the one-render gap in announcements is a new timing hazard right next to #1624/#1639's gates, for no extra depth.

### 3d. SocketContext split (L-071)

The choice is between (A) one provider with three contexts (`useSocketConnection`, `usePresence`, `useInvites`) and the render-phase account reset kept in one place, and (B) three providers. B would have to repeat the account-switch reset (`SocketContext.tsx:245-253`) three times. Pick **A**.

## 4. Target design

### 4.1 Online provider internals (C1)

```ts
// lib/tableHandles.ts — the storage half of "is there a table to return to"
export type TableHandles = { activeRoomId: string | null; waitingCode: string | null };
export function readTableHandles(): Promise<TableHandles>;           // never rejects; {null,null} on error
export function writeActiveRoom(roomId: string | null): void;        // fire-and-forget, errors swallowed
export function writeWaitingRoom(code: string | null): void;

// context/useRejoin.ts
export interface Rejoin {
  /** game:rejoin for a live/in-progress room or the stored id; else room:rejoin for a waiting seat. False when nothing was sent. */
  attempt(): boolean;
  /** Live state arrived for some room: nothing is outstanding (requested id, retries, timer, rejoining code). */
  forget(): void;
  /** game:rejoin_failed: ignores a reply for a room no longer requested; retries SERVER_ERROR ≤3× at 2000 ms; else onRefused. */
  onRejoinFailed(data: ServerPayload & { roomId?: string }): void;
  /** room:error: true iff it answers an outstanding room:rejoin with a terminal code (caller drops the lobby). */
  claimsRoomError(payload: ServerPayload): boolean;
  holdActive(roomId: string | null): void;   // ref + writeActiveRoom
  holdWaiting(code: string | null): void;    // ref + writeWaitingRoom
}
export function useRejoin(args: {
  socket: Socket | null;
  userId: string;
  /** Read at call time — the provider's refs, never render state. */
  current(): { room: RoomState | null; game: GameState | null };
  onRefused(payload: ServerPayload): void;
}): Rejoin;
```

Invariants a caller must know:
- Every `Rejoin` member has a stable identity across the provider's life. The listener effect's dependency array stays entirely stable (`CONTEXT.md:136-138` measured this), and a test counts `socket.on` calls over a whole table lifecycle.
- `onRefused` is read through a ref assigned in an effect. The hook calls it at most once per outstanding attempt.
- The hook owns the storage load effect (`OnlineGameContext.tsx:475-491`) and clears the retry timer on unmount.
- No `reduce`. Every handler stays in the provider's listener effect. The handlers call into `Rejoin`.

Inside the provider:

```ts
/** Every table-scoped field back to its initial value. entrySource, error, rejoinFailed and isSpectator are the caller's. */
const resetTable: () => void;
```

`resetTable` clears all of the following: `rejoin.forget()`, both handles, room and gameState together with their refs, `mySeatIndex` (back to -1), `turnDeadline`, `playerLeft`, both vote states, `disconnectedSeats`, `autoPassed`, `cumulativeScores`, `placementPoints`, `placementPointsCurrent`, `ratingDeltas`, `ratingsAfter`, `roundRecorded`, `matchState`, `reconnectNotice` and its timer, and `clearReactions()` (`lib/reactions.ts` says leaving has to say so). The exchange announcement closes on its own when `gameState` goes null (`lib/game/sharedGameFlow.ts:93-99`).

It has three callers:
- `abandonRejoin`: the notification, then `resetTable()`, then `setRejoinFailed(true)`.
- `leaveRoom`: deliver, then `resetTable()`, then `setIsSpectator(false)`, `setRejoinFailed(false)` and `setError(null)`.
- `onRoomError` when `rejoin.claimsRoomError(p)`: `resetTable()`.

Behaviour change: the seven fields neither teardown cleared are now cleared. No reader exists after a leave, because the game screen renders its null state. `entrySource` is deliberately kept, since the lobby choice reads it after the leave.

`joinRoom(raw)` and `spectateRoom(raw)` normalise through `joinCode(raw.trim())` (`lib/deepLink.ts:4-8`). When the code is invalid, nothing is emitted, and the error is set from the existing `server.ROOM_NOT_FOUND` payload (`locales/en.ts:63`). Callers pass raw input, and the `.toUpperCase()` at `app/(online)/index.tsx:128,135` is deleted.

Deleted: `persistedRoomIdRef`, `persistedWaitingCodeRef`, `requestedRoomIdRef`, `rejoinRetriesRef`, `rejoinRetryTimerRef`, `rejoiningRoomCodeRef`, `persistActiveRoom`, `persistWaitingRoom`, `forgetRejoinAttempt` and `attemptRejoin` from the provider (about 160 lines moved). The two hand-written teardowns are deleted (about 35 lines). Home's AsyncStorage read becomes `readTableHandles()`.

### 4.2 Connection slice (C2)

```ts
// lib/useOwnLink.ts
export function useOwnLink(socket: LinkSocket | null): { link: OwnLink; connected: boolean };
//   connected = edges.everUp && edges.downAt === null  (observe() folds socket.connected at subscribe)
//   edgesOf entry initialised only when missing (L-075)

// context/OnlineGameContext.tsx
export type ServerNotice = { payload: ServerPayload; seq: number; surface: "lobby" | "room" | "table" };
export type ReconnectNotice = { payload: ServerPayload; back: boolean };
type ConnectionSlice = {
  connected: boolean; ownLink: OwnLink; pill: LinkPill | null;   // pill = linkPill(link, connected, notice?.back)
  error: ServerNotice | null; clearError(seq: number): void;     // clears only if seq still matches
  reconnectNotice: ReconnectNotice | null; playerLeft; rejoinFailed; clearPlayerLeft; clearRejoinFailed; retryConnection;
};
export function useServerError(surface: ServerNotice["surface"]): { text: string; seq: number } | null; // translated at render
```

The surface is stamped when the error arrives, from the provider's refs: `gameStateRef.current` set means `"table"`, otherwise `roomRef.current` set means `"room"`, otherwise `"lobby"`. The lobby and quickmatch read `"lobby"`, the room reads `"room"` (it still converts to a toast and clears by seq), and the game reads `"table"`. The point of this is that a screen can no longer clear an error meant for another one, because the surfaces are disjoint. Text is translated when it renders (`useTranslation().translateServerPayload`, `lib/i18n.ts:185-192`), so a language switch also reaches a standing error or notice (L-083).

The slice hooks are named `useOnlineConnection` … `useOnlineExchange` at their `sliceContext` call (`OnlineGameContext.tsx:224-229`). `context/onlineGameHooks.ts` becomes `export { … } from "./OnlineGameContext"`, which keeps the import path that 14 test mocks use. `useOnlineGame` moves to `tests/native/onlineSurface.ts`, composing the six hooks.

The six contexts and their memos are unchanged (L-061, narrow).

Deleted:
- the provider's second `useSyncExternalStore` (`:343-358`)
- `linkPill` composition in the screen (`app/(online)/game.tsx:91`)
- the 40 pass-through lines
- three `clearError()` calls in quickmatch (`:109,154,161`), because a new attempt retires a lobby error by seq

### 4.3 Online routing (C3)

```ts
// context/onlineRouting.ts
export type OnlineRoute = "lobby" | "quickmatch" | "room" | "game" | "other";   // from useSegments()
export type OnlineFacts = { roomId: string | null; hasGame: boolean; isSpectator: boolean; rejoinFailed: boolean };
export type Navigation = { kind: "push" | "replace"; to: Href } | null;
export function lobbyFor(entrySource: "quickmatch" | "friends" | null): "/(online)" | "/(online)/quickmatch";
/** Pure. One change of facts → at most one navigation, given where the player is. */
export function navigationFor(prev: OnlineFacts, next: OnlineFacts, here: OnlineRoute,
                              entrySource: "quickmatch" | "friends" | null): Navigation;
/** Mounted once, inside OnlineGameProvider, in app/(online)/_layout.tsx. */
export function useOnlineRouting(): void;
```

The transition table, matching today's behaviour:

| Change | Here | Navigation |
|---|---|---|
| a room appears, no game yet | quickmatch | replace `/room` |
| a room appears, no game yet | anywhere else | push `/room` |
| a seated game appears | room | replace `/game` |
| a seated game appears together with its room (cold rejoin) | lobby | push `/game` |
| a watched game appears | lobby | push `/game` |
| no room and no game left | room or game | replace `lobbyFor(entrySource)` |
| `rejoinFailed` turns on | room or game | replace `lobbyFor`, then `clearRejoinFailed()` |
| `rejoinFailed` turns on | anywhere else | `clearRejoinFailed()` only |

The hook also joins an accepted invite: when `acceptedInvite && connected`, it calls `clearAcceptedInvite()` and then `joinRoom(code)` (moved from `app/(online)/index.tsx:103-107`). The friends screen calls `acceptInvite(code)` in place of `hideGameInvite` + `joinRoom`. The lobby keeps its render-phase "joining" banner, which reads `acceptedInvite`.

Deleted:
- the 8 navigation effects and 3 lobby-choice copies
- the explicit navigations after `leaveRoom()` (`room.tsx:446-451`, and the game screen's `goToLobby` in its leave and playerLeft handlers), because leaving changes the facts and the router follows
- the copied "id, not the room" comment

### 4.4 Socket, Notification, Auth (C4a, C4b)

```ts
// context/SocketContext.tsx — one provider, three contexts, each its own memo
export function useSocketConnection(): Socket | null;
export function usePresence(): { onlineIds: ReadonlySet<string>; refresh(): void };     // refresh = friend:get_online_list
export function useInvites(): {
  invites: PendingInvite[]; prompt: PendingInvite | null; accepted: string | null;
  accept(code: string): void; dismiss(code: string): void; hide(code: string): void;
  clearPrompt(): void; clearAccepted(): void;
  /** friend:invite with ack; false on timeout or refusal, and the caller is told by a toast inside. */
  send(friendUserId: string, roomCode: string): Promise<boolean>;
};
// lib/socket.ts
export function connectSocket(userId: string, opts: { onAuthFailure(): void }): Socket;  // handler held per socket entry
// (setSocketAuthFailureHandler and the module-global slot are deleted)

// context/NotificationContext.tsx
export function useNotification(): {               // stable for the provider's life
  showNotification(n: NotificationData): void;
  notifyError(message: string, opts?: { title?: string; duration?: number }): void;  // default title common.error
  notifyServerError(payload: ServerPayload): void; // title common.error, translateServerPayload, Reading.notice
};
export function useBanner(): { notification; dismissNotification; bannerBottom; reportBannerBottom };
export function useBannerBottom(): number;         // reads the banner context; 0 with no provider

// context/AuthContext.tsx
forgetSession(): Promise<void>;  // local only: forgetPushRegistration, setUser(null), multiRemove(ACCOUNT_KEYS)
logout(): Promise<void>;         // unchanged: POST, then forgetSession — throws if the POST fails
```

`logout` deliberately stays POST-then-forget, contrary to the verifier's try/finally. On web the session is a cookie. If the POST fails and the client forgets locally anyway, the next `fetchMe` signs the player straight back in, so a user-initiated logout must still report failure (`SettingsModal.tsx:139-147`). The two paths where the session is already dead call `forgetSession()` directly: the socket's 401 (`SocketContext.tsx:286`) and a successful account DELETE (`SettingsModal.tsx:151-168`, where only the DELETE stays in the try).

Not done (with reasons):
- moving the friends-cache listener to `lib/friends.ts` and `qc.clear()` to AuthContext: the verifier says it can wait, and it has no second consumer.
- one title for every toast: the verifier says bodies differ (`notifyError(message, opts?)`).

### 4.5 Offline (C5a, C5b)

```ts
// context/GameContext.tsx — two contexts
type LocalSession = {             // changes only when hasSavedGame/restored flip
  setupGame(players, mode, length?): void; resetGame(): void;
  hasSavedGame: boolean;          // derived: gameState ? !match.over : isResumable(bootSave)
  resumeGame(): boolean;          // live table → true, nothing restored; else restores bootSave
  restored: boolean;
};
type LocalTable = {
  gameState: GameState | null; match: MatchState;
  exchangeAnnouncing: boolean; exchangeAnnounceData: ExchangeAnnounceData | null;
  playCards(ids: string[]): boolean; passTurn(): void; runBotTurn(): void;
  chooseExchangeCard(id: string): void; acknowledgeExchange(): void;
  /** The table has shown the received card: a bot winner gives back its weakest legal card; a winner with no legal card releases the phase; a human winner waits. */
  settleExchange(): void;
  startNextRound(): void; startNewMatch(): void;
};
// every command: stable identity, reads stateRef.current; the only writer is commit(next) (also setup/resume/reset)

// context/offlineDriver.ts
export function useOfflineDriver(): {
  viewerSeat: number; autoPassed: number;
  onExchangeReady(): void;                         // = settleExchange
  onRoundLanded: ((landsAt: number) => void) | undefined;
  turnTimer: { seconds: number; includeNewTrick: false; pausable: true; onExpire(): void };
  exchangeHold: ExchangeHold | undefined;          // e2e only; undefined for a real player
};
// lib/e2eConfig.ts (C5b) — the only reader of the inlined literal
export const E2E_FAST: boolean;                    // process.env.EXPO_PUBLIC_E2E_FAST === "1", literal kept greppable
export function storedFlag(key: string): boolean;  // replaces suspendBot/realExchange
export const e2e: { suspendBot: boolean; realExchange: boolean; opener: boolean; exchangeHold?: ExchangeHold };
```

Invariants:
- No `setGameState` outside `commit`. `stateRef.current` is assigned synchronously in `commit` before `setGameState`, so two commands in one tick compose, and `flushSync(() => passTurn())` (`app/game.tsx:76-77`) still commits the state it read.
- `configRef` holds `{ players, mode, dealFirstSeat }`. These are not rendered. The persist effect keys on `[gameState, match]` and reads the ref.
- `useOfflineDriver` is null-safe and is called at the top of `app/game.tsx`, before `if (!gameState)` (CLAUDE.md invariant).
- It keeps `botTurnKey`'s semantics exactly, including the deal gate that #1624/#1639 add, and the "reset in render" for `roundLandedAt` (ADR-0005: no set-state-in-effect).
- The bot's move is still chosen only in `lib/game/autoMove.ts`.

Deleted:
- `savedRef`, the `hasSavedGame` state and its setters, the `flaggedForOver` render sync (`:329-333`), `releaseStuckExchange` (folded into `settleExchange`)
- five refs and `readyRef` in `app/game.tsx`
- `exchangeHoldMsOverride` from the context and `useLocalExchange`
- the module-scope e2e knobs in GameContext
- `lib/e2eBotSuspend.ts` and `lib/e2eRealExchange.ts`, merged into `lib/e2eConfig.ts`

`app/game.tsx` drops to about 90 lines of props mapping.

### 4.6 Small fixes (C6)

```ts
// lib/game/gameEngine.ts (next to TEAMS_PLAYER_COUNT)
export function modeFits(mode: GameMode, seats: number): boolean;   // teams ⇔ seats === TEAMS_PLAYER_COUNT
// lib/game/rating.ts
export function provisionalLeft(r: { rounds: number }): number | undefined; // server flag = provisionalLeft(r) !== undefined
// components/RatingSummary.tsx
export function RatingSummary(props: { rating: RatingDto }): JSX.Element;   // profile + leaderboard
// components/lobbyPickers.tsx
export function SeatCountPicker(p: { value: number; onChange(n: number): void }): JSX.Element;
export function MatchLengthPicker(p: { value: MatchLength; onChange(l: MatchLength): void; seats: number }): JSX.Element;
// lib/i18n.ts
type PluralBase = { [K in TranslationKey]: K extends `${infer B}_one` ? B : never }[TranslationKey];
export function tn(base: PluralBase, count: number, params?: TranslationParams): string;
// lib/accessibility.ts — one native listener, ref-counted, cached value (the in-app setting's pattern)
// app/(online)/room.tsx — <BotsComingHint onDue={() => setBotsOffered(true)} /> mounted only when hostIsWaiting
// locales: term.mode.teams, term.mode.freeForAll (+ any glossary word an en-duplicate scan finds); helper modeLabel(mode, t)
```

## 5. Migration (each step leaves main green)

1. **C1:**
   - Pin the behaviour first: a teardown parity test, the rejoin unit cases through the provider, and a listener-stability count.
   - Add `lib/tableHandles.ts` and `context/useRejoin.ts`, then move the rejoin code there.
   - Add `resetTable`.
   - Normalise codes in `joinRoom`/`spectateRoom`.
   - Point Home at `readTableHandles`.
   - This deletes the two teardown lists and the provider's rejoin refs.
2. **C2:** `useOwnLink` returns `connected`; payload notices with a surface; slice hooks re-exported; `useOnlineGame` moves to tests. This deletes the duplicate subscription, the screen pill composition and the pass-throughs.
3. **C3:**
   - Land the pure `navigationFor` + `lobbyFor` and its table test.
   - Mount `useOnlineRouting` and delete the screen effects in the same PR.
   - Move the accepted-invite join to the layout, and point friends at `acceptInvite`.
4. **C4a:** split SocketContext into three hooks, add `usePresence().refresh` and `useInvites().send`, make the auth-failure handler per socket, delete the dead `connected`, and update the 20 `@/context/SocketContext` mocks.
5. **C4b:** split Notification into notify and banner, add `notifyError`/`notifyServerError`, add `forgetSession`, and fix account deletion.
6. **C5a** (after #1624, #1639): GameContext stable commands, derived resumable, two contexts, `settleExchange`, `useOfflineDriver`.
7. **C5b:** `lib/e2eConfig.ts` becomes the one env reader; move the literal-pin tooling tests to it.
8. **C6:** pickers + `modeFits`, `term.mode.*`, the countdown child, typed `tn`, the reduce-motion store, `provisionalLeft` + `RatingSummary`.

## 6. No-regression strategy

**Pins written before any code moves**

| What is pinned | Test | Red today? |
|---|---|---|
| A full table, then `leaveRoom` (and then `game:rejoin_failed`): every field of all six slices equals a freshly mounted provider's, except `entrySource` and the per-reason fields. The comparison iterates over the slices, so a field added later without a reset fails. | new `tests/native/tableReset.test.tsx` | Red for the seven uncleared fields. Expected; the reset makes it green. |
| The rejoin rules: a stale `roomId` reply is ignored; `SERVER_ERROR` is retried 3× at 2000 ms and then abandoned; a terminal `room:error` drops only an outstanding rejoin; `game:started` without state rejoins | first through the provider (`rejoinFailed.test.tsx` already covers part), then a `renderHook(useRejoin)` + fake-socket test | no |
| The listener effect does not re-subscribe across a lifecycle (`socket.on` count constant) | new case in `tableReset.test.tsx` | no |
| The Home resume rollback: boot with a save, resume, play a move, leave `/game` without reset, resume again; the state is the post-move one | `tests/native/offlineResume.test.tsx` | yes |
| The lost update: two `passTurn` calls in one `act` both apply (or the second is refused against the new state) | new case in `gameContextExchange.test.tsx` or `offlineCommands.test.tsx` | yes |
| One navigation per transition, from every row of the table, including lobby and friends both mounted | `tests/native/onlineRouting.test.ts` (pure) + one screen test | the double push is red if it exists today |
| Accept from friends clears `pendingInvite` and joins once connected | extend `acceptInviteClearsPending.test.tsx` | yes for friends |
| An error with a lobby surface survives the room's toast-and-clear; a language switch re-renders a standing error | new cases in `onlineErrorFloat.test.tsx` | yes |
| A second `useOwnLink` subscriber during an outage keeps `downAt` | `ownLinkHold.test.tsx` | yes |
| Account delete with the logout POST failing shows no "delete failed" toast and lands on `/auth` | new `settingsDeleteAccount.test.tsx` | yes |

**Existing tests that move or change**

- `tests/ui-rules/contextSlices.test.ts`:
  - Online: read each hook's fields from its `Pick` (the `pickedBy` logic already does this) instead of from hook bodies.
  - Local: two contexts.
  - Drop `use*Slice` from `CONTEXT_HOOKS`.
- `tests/native/onlineContextMock.ts`: rename its keys.
- Four `useOnlineGame` readers switch to `tests/native/onlineSurface.ts`: `rejoinFailed`, `roundEndRefreshesRatings`, `sliceRenderCounts` (wide control) and `spectateFailed`.
- `sliceRenderCounts.test.tsx` stays the render-isolation pin and must stay green unchanged in its assertions.
- The 9 `@/context/GameContext` mocks get a `localContextMock` helper. They are: `exchangeHoldsTheTurn`, `homeFieldPausesOnBlur`, `homeReturnToTable`, `homeSettingsPillWord`, `matchEndsOnTable`, `offlineAutoPass`, `passAndPlayHandoff`, `roundEndsOnTable` and `tutorialOnce`.
- The 20 `@/context/SocketContext` mocks name the hook they need.
- `homeReturnToTable` mocks `@/lib/tableHandles`, not AsyncStorage.
- Routing: `connectingState`, `onlineLeaveConfirm` and `rejoinFailedExit` assert router calls today, so they move to the router test or render the layout.
- Tooling: `exchangeE2EHold.test.ts`, `e2eOpenerWiring.test.ts`, `e2eBuildMark.test.ts`, `e2eBotSuspend.test.ts` and `e2eRealExchange.test.ts` re-point at `lib/e2eConfig.ts`. They are joined by a tooling test: `process.env.EXPO_PUBLIC_E2E_FAST` appears only in `lib/e2eConfig.ts`. That is a count, not an allowlist of old sites.
- `tests/ui-rules/i18n.test.ts`: add a check that fails when a non-`term.*` key's last segment equals a `term.*` key's last segment and their English values are equal. It counts every key and exempts none.
- `tests/ui-rules/reactCompiler.test.ts` runs for the new hooks (`useRejoin`, `useOfflineDriver`, `useOnlineRouting`). The React Compiler pitfall in CLAUDE.md applies to refs read in effects, so every ref is assigned in an effect or a layout effect, never during render.

**What catches what**
- Unit tests and native tests catch state, ordering and render counts.
- Only `tests/e2e/` catches layout and back-stack-on-web. C3 runs `online.spec.ts` (create → room → game, two browsers, a watch refusal stays in the lobby, create in portrait) and `reconnect.spec.ts`.
- C5a runs `offline.spec.ts`, `offlineMatch.spec.ts`, `offlineResume.spec.ts`, `motionMatch.spec.ts` and `motionThirdDeal.spec.ts`. The pacing and the deal gate are game feel.
- C6 runs `menuFit.spec.ts` and `smokeFlowCopy.spec.ts`, because the pickers move and the labels change.

## 7. Coverage table

| ID | Covered by | Note |
|---|---|---|
| L-057 | C5a | `hasSavedGame` derived from live state, then the boot save; `resumeGame` on a live table restores nothing. Red test in `offlineResume`. |
| L-058 | C1 | Plain `resetTable()` (owner note), three callers, a parity test against a fresh provider. Per-slice memos untouched. |
| L-059 | C3 | Pure `navigationFor` + one `useOnlineRouting` in the layout. Push/replace carried per row; quickmatch keeps `gestureEnabled:false`. |
| L-060 | C5a | `stateRef` + a single `commit`; stable commands; lost-update red test. |
| L-061 | C2 (online), C5a (local) | Narrow: slice hooks re-exported, six contexts kept; `useOnlineGame` moves to tests; GameContext split into session/table contexts. |
| L-062 | C1 | `lib/tableHandles.ts` (storage) + `useRejoin` holds the sync refs (the verifier's point that async `read()` cannot replace them). |
| L-063 | C3 (+C4a rename) | Friends calls `acceptInvite`; the join-when-connected moves to the layout, so it works without the lobby mounted. |
| L-064 | C6 | `term.mode.*` + `modeLabel`; a key-counting ratchet in `i18n.test.ts`. it/sq wording is an owner decision (§10). |
| L-065 | C2 | `ServerNotice { payload, seq, surface }`, `useServerError(surface)`, `clearError(seq)`. |
| L-066 | C5a (field leaves context), C5b (one env module) | Literal stays greppable in `lib/e2eConfig.ts`; the pin tests move. |
| L-067 | C4a (per-socket handler), C4b (`forgetSession`) | `logout` itself unchanged (web cookie reason, §4.4); the 401 path uses `forgetSession`. |
| L-069 | C5a | `context/offlineDriver.ts` `useOfflineDriver()`; hooks before the null guard. |
| L-071 | C4a | Three hooks over one provider; dead `connected` deleted; raw emits behind `refresh`/`send`. Listener-hook move deferred (§4.4). |
| L-072 (useRejoin) | C1 | `context/useRejoin.ts`, effects kept in place, no reducer. L-072 itself dropped. |
| L-073 | C4b | Only the DELETE in the try; then `forgetSession()`. |
| L-074 | C6 | `BotsComingHint` child owns the interval, mounted only for the waiting host. |
| L-075 | C2 | Initialise the `edgesOf` entry only when missing. |
| L-076 | C2 | `connected` derived from the link edges; `pill` in the slice. Text mapping stays in the screen, because it is presentation. |
| L-077 | C4b | `notifyError(message, opts?)`, `notifyServerError(payload)`; nine sites. |
| L-078 | C4b | Stable `useNotification` + `useBanner`; `useBannerBottom` reads the banner context. |
| L-081 | C1 | `joinCode()` in both commands; invalid → local `ROOM_NOT_FOUND`, no emit. |
| L-083 | C2 | Error and reconnect notice stored as payloads. The notification queue keeps text: banners are transient (≤ `Reading.notice`), so the stale-language window is seconds; noted, not done. |
| L-084 | C6 | `PluralBase`; if `tsc` time regresses visibly, a generated union of bases is the fallback. |
| L-085 | C6 | `provisionalLeft` used by the server flag and three screens; `RatingSummary` for profile and leaderboard. |
| L-086 | C6 | `SeatCountPicker`, `MatchLengthPicker`, `modeFits` used by three screens and `teamsSizeRefusal`. |
| L-087 | C6 | One ref-counted native listener with a cached value. |

## 8. Proposed tickets

### C1 — Online provider: one table reset, a rejoin hook that owns the stored handles (M)

- **Files:**
  - `context/OnlineGameContext.tsx`
  - new `context/useRejoin.ts`
  - new `lib/tableHandles.ts`
  - `app/index.tsx` (`:661-679` only)
  - `app/(online)/index.tsx` (`:128,135` only)
  - tests: new `tableReset.test.tsx`, new `useRejoin.test.tsx`, `rejoinFailed.test.tsx`, `spectateFailed.test.tsx`, `homeReturnToTable.test.tsx`
- **Blocked by:** none in this area. Order against server-output or test-harness tickets that edit `OnlineGameContext.tsx` or add a shared fake socket (use it if it has landed).
- **Definition of done:**
  - [ ] `tableReset.test.tsx` written first: after `leaveRoom` and after a terminal `game:rejoin_failed`, all six slices equal a fresh provider's, except `entrySource` and the per-reason fields. Red on the seven uncleared fields before the change.
  - [ ] `resetTable()` is the only teardown, called from `abandonRejoin`, `leaveRoom` and the terminal `room:error` branch.
  - [ ] `useRejoin` owns the six refs, the retry timer, the storage load and the terminal codes. Its unit test covers the stale reply, the retry cap of 3 at 2000 ms, the terminal room code and `game:started`.
  - [ ] The listener effect subscribes once per socket over a whole lifecycle (test counts `on` calls).
  - [ ] No `reduce(state, event)`. Handlers stay in the provider's listener effect (`CONTEXT.md:132-138`).
  - [ ] `joinRoom`/`spectateRoom` normalise with `joinCode`. An invalid code emits nothing and sets a `ROOM_NOT_FOUND` error. Call-site uppercasing is removed.
  - [ ] Home reads `readTableHandles()`. `homeReturnToTable` mocks `@/lib/tableHandles`.
  - [ ] `useRejoin` has exactly one caller and `tableHandles` has exactly two (grep in the PR body).
- **Checks:**
  - While iterating: `npx jest tests/native/tableReset.test.tsx tests/native/useRejoin.test.tsx tests/native/rejoinFailed.test.tsx tests/native/spectateFailed.test.tsx tests/native/sliceRenderCounts.test.tsx`.
  - Before pushing: `npm run agent:check`, then `npx playwright test tests/e2e/reconnect.spec.ts tests/e2e/online.spec.ts`.

### C2 — Online connection slice: one link subscription, server notices as payloads with a surface, slice hooks re-exported (M)

- **Files:**
  - `lib/useOwnLink.ts`
  - `context/OnlineGameContext.tsx`
  - `context/onlineGameHooks.ts`
  - `app/(online)/{game,index,quickmatch,room}.tsx` (error and pill reads only)
  - `tests/ui-rules/contextSlices.test.ts`
  - `tests/native/{onlineContextMock.ts, onlineSurface.ts (new), onlineErrorFloat, onlineStatusRow, tableNotices, ownLinkHold, sliceRenderCounts, rejoinFailed, spectateFailed, roundEndRefreshesRatings}`
- **Blocked by:** C1.
- **Definition of done:**
  - [ ] `useOwnLink` returns `{ link, connected }` and initialises a socket's edges only when missing. A second-subscriber-during-outage test is red first.
  - [ ] The provider has no `useSyncExternalStore` of its own for `connected`. The connection slice exposes `pill`, and `app/(online)/game.tsx` no longer calls `linkPill`.
  - [ ] `error` is `{ payload, seq, surface }`, read through `useServerError(surface)`, and `clearError(seq)` clears only that error. A test shows the room's toast does not clear a lobby error, and a test shows a language switch re-renders a standing error. Both are red first.
  - [ ] `reconnectNotice` stores its payload and is translated at render.
  - [ ] The slice hooks are defined at `sliceContext` and re-exported from `onlineGameHooks.ts`. The six contexts and six memos are unchanged, and `sliceRenderCounts` passes with unchanged assertions.
  - [ ] `useOnlineGame` no longer exists in `context/`.
  - [ ] `contextSlices.test.ts` still pins the partition and the one-context-per-slice rule, reading the `Pick`s.
- **Checks:**
  - While iterating: `npx jest tests/native/onlineErrorFloat.test.tsx tests/native/onlineStatusRow.test.tsx tests/native/tableNotices.test.tsx tests/native/sliceRenderCounts.test.tsx` and `node --test tests/ui-rules/contextSlices.test.ts`.
  - Before pushing: `npm run agent:check`, then `npx playwright test tests/e2e/reconnect.spec.ts tests/e2e/mockupParityReconnect.spec.ts`.

### C3 — Online navigation follows table state from one place, and one accept-invite path (M)

- **Files:**
  - new `context/onlineRouting.ts`
  - `app/(online)/_layout.tsx`
  - `app/(online)/{index,quickmatch,friends,room,game}.tsx`
  - tests: new `onlineRouting.test.ts`, `connectingState`, `onlineLeaveConfirm`, `rejoinFailedExit`, `acceptInviteClearsPending`, `friendsInviteJoin`, `joinInviteFromHome`
- **Blocked by:** C2.
- **Definition of done:**
  - [ ] The pure `navigationFor` and its table test land first, with every row of §4.3 including "lobby and friends both mounted → one push".
  - [ ] `useOnlineRouting` is mounted once inside `OnlineGameProvider` in the layout. No online screen calls `router.push`/`replace` in response to room, game or `rejoinFailed` state. A grep test fails if one does.
  - [ ] Leave handlers only call `leaveRoom()`, and the router takes the player to `lobbyFor(entrySource)`.
  - [ ] `rejoinFailed` is consumed wherever the player is.
  - [ ] The accepted-invite join runs from the layout when connected. Friends calls `acceptInvite(code)`, and `pendingInvite` is cleared on that path (test red first).
  - [ ] quickmatch keeps `gestureEnabled:false`. Back from `/room` after a lobby push still returns to the lobby, and after a quickmatch replace still returns to quickmatch's predecessor (online e2e).
- **Checks:**
  - While iterating: `node --test tests/native/onlineRouting.test.ts` (or jest if it renders) and `npx jest tests/native/acceptInviteClearsPending.test.tsx tests/native/rejoinFailedExit.test.tsx`.
  - Before pushing: `npm run agent:check`, then `npx playwright test tests/e2e/online.spec.ts tests/e2e/reconnect.spec.ts tests/e2e/copyRoomCode.spec.ts`.

### C4a — SocketContext split into connection, presence and invites (M)

- **Files:**
  - `context/SocketContext.tsx`
  - `lib/socket.ts`
  - `context/OnlineGameContext.tsx` (`useSocket` → `useSocketConnection`)
  - `context/onlineRouting.ts`
  - `app/index.tsx`, `app/join/[code].tsx`
  - `app/(online)/{index,friends,room}.tsx`
  - the 20 test files mocking `@/context/SocketContext`, plus `acceptInviteClearsPending`, `sessionReplaced`, `socketReconnect`
- **Blocked by:** C3.
- **Definition of done:**
  - [ ] `useSocketConnection`, `usePresence` and `useInvites` each read their own context with their own memo. A render-count test shows a `friend:status` does not re-render a `useInvites`-only consumer or `OnlineGameProvider`.
  - [ ] The account-switch reset stays in one render-phase block.
  - [ ] No screen holds `socket`: the `friend:get_online_list` emits go through `usePresence().refresh`, and `friend:invite` goes through `useInvites().send` with a failure toast.
  - [ ] The dead `connected` is deleted.
  - [ ] `connectSocket(userId, { onAuthFailure })`. `setSocketAuthFailureHandler` is deleted.
- **Checks:**
  - While iterating: `npx jest tests/native/acceptInviteClearsPending.test.tsx tests/native/sessionReplaced.test.tsx tests/native/socketReconnect.test.tsx tests/native/roomInviteAndShare.test.tsx tests/native/friendsPresenceRow.test.tsx`.
  - Before pushing: `npm run agent:check`, then `npx playwright test tests/e2e/online.spec.ts tests/e2e/friendsLadder.spec.ts tests/e2e/pendingRequests.spec.ts`.

### C4b — Notifications split by rate of change; a session that is already dead is forgotten locally (S)

- **Files:**
  - `context/NotificationContext.tsx`
  - `app/_layout.tsx`
  - `components/SettingsModal.tsx`
  - `context/AuthContext.tsx`
  - `context/SocketContext.tsx` (`onAuthFailure`, the two `notifyServerError` sites)
  - `context/OnlineGameContext.tsx` (`deliver`)
  - `app/(online)/{friends,room}.tsx`
  - `components/MenuLayout.tsx` if needed
  - tests: new `settingsDeleteAccount.test.tsx`, `bannerBottom`/banner tests
- **Blocked by:** C4a.
- **Definition of done:**
  - [ ] `useNotification()` returns only stable commands (`showNotification`, `notifyError`, `notifyServerError`). The banner reads `useBanner()`, and `useBannerBottom` reads the banner context. A test shows a banner change does not re-render a notify-only consumer.
  - [ ] The nine `game_error` sites use `notifyError`/`notifyServerError`, and titles that differ stay different.
  - [ ] `forgetSession()` exists. `logout` keeps POST-then-forget and still throws on failure. The socket 401 path and a successful account DELETE call `forgetSession()`.
  - [ ] With the logout POST failing after a successful DELETE, the player lands on `/auth` with no "delete failed" toast. The test is red first.
- **Checks:**
  - While iterating: `npx jest tests/native/settingsDeleteAccount.test.tsx tests/native/sessionReplaced.test.tsx`.
  - Before pushing: `npm run agent:check`, then `npx playwright test tests/e2e/bannerDisplaces.spec.ts tests/e2e/gameSettingsSheet.spec.ts`.

### C5a — Offline table: commands read the latest state, resume derives from it, and the driver leaves the screen (M)

- **Files:**
  - `context/GameContext.tsx`
  - `context/gameHooks.ts`
  - new `context/offlineDriver.ts`
  - `app/game.tsx`
  - `tests/ui-rules/contextSlices.test.ts` (LOCAL part)
  - new `tests/native/localContextMock.ts`
  - the 9 GameContext-mocking tests
  - `offlineResume`, `gameContextExchange`, `resumeAtRest`, `offlineDealFirstSeat`, `oneTapOneCommit`
  - new `offlineDriver.test.tsx`
- **Blocked by:** #1624 and #1639 (both edit `app/game.tsx`'s `botTurnKey`/exchange gates), and table-ui tickets editing `app/game.tsx`.
- **Definition of done:**
  - [ ] The red tests land first: Home resume after back-navigation does not roll back; two `passTurn` in one `act` compose.
  - [ ] Every GameContext command has a stable identity and reads `stateRef`. `commit` is the only writer (plus setup, resume and reset). The config lives in a ref, and persistence keys on `[gameState, match]`.
  - [ ] `hasSavedGame` is derived. `savedRef`, its setters and the render-phase `flaggedForOver` sync are gone. `resumeGame()` on a live, unfinished table returns true and restores nothing.
  - [ ] Session and table are two contexts. A render-count test shows a move does not re-render a `useLocalSession`-only consumer (Home).
  - [ ] `settleExchange()` replaces `releaseStuckExchange` and the screen's giveback logic. `useOfflineDriver` holds the bot loop (same key, same delay, plus the deal gate from #1624/#1639), the round-landed timer, the turn-timeout auto-pass, the e2e globals and `exchangeHold`. `exchangeHoldMsOverride` is not in any context.
  - [ ] `app/game.tsx` has no `useRef` for commands, and every hook runs before `if (!gameState)`.
  - [ ] The bot move is still chosen only by `lib/game/autoMove.ts`.
- **Checks:**
  - While iterating: `npx jest tests/native/offlineResume.test.tsx tests/native/offlineDriver.test.tsx tests/native/offlineAutoPass.test.tsx tests/native/exchangeHoldsTheTurn.test.tsx tests/native/passAndPlayHandoff.test.tsx tests/native/roundEndsOnTable.test.tsx` and `node --test tests/ui-rules/contextSlices.test.ts tests/ui-rules/reactCompiler.test.ts`.
  - Before pushing: `npm run agent:check`, then `npx playwright test tests/e2e/offline.spec.ts tests/e2e/offlineMatch.spec.ts tests/e2e/offlineResume.spec.ts tests/e2e/motionMatch.spec.ts tests/e2e/motionThirdDeal.spec.ts`.

### C5b — One module reads the e2e build flag (S)

- **Files:**
  - new `lib/e2eConfig.ts`
  - delete `lib/e2eBotSuspend.ts` and `lib/e2eRealExchange.ts`
  - `context/offlineDriver.ts`, `context/GameContext.tsx`, `app/game.tsx`
  - `lib/{captureRoute,e2eBuildMark,e2eTrace,device/feedback,game/offlineBotDelay}.ts`
  - `components/{feltCanvas.tsx,feltReady.ts,feltSkia.web.tsx,useCardRects.ts}` (one line each)
  - tooling tests `exchangeE2EHold`, `e2eOpenerWiring`, `e2eBuildMark`, `e2eBotSuspend`, `e2eRealExchange`, plus a new count test
- **Blocked by:** C5a. Order against table-ui tickets touching the felt files.
- **Definition of done:**
  - [ ] `process.env.EXPO_PUBLIC_E2E_FAST` appears in exactly one source file. A tooling test counts it; it is not an allowlist.
  - [ ] `storedFlag(key)` replaces the two copied readers, and the keys stay in `lib/storageKeys.ts`.
  - [ ] The literal-pin tests point at `lib/e2eConfig.ts` and are red once against a build that reads the flag elsewhere.
  - [ ] No production behaviour changes: a non-e2e bundle takes no e2e branch (`assertNotE2EFast.test.ts` green).
- **Checks:**
  - While iterating: `node --test tests/tooling/e2e*.test.ts tests/tooling/exchangeE2EHold.test.ts`.
  - Before pushing: `npm run agent:check`, then `npx playwright test tests/e2e/offline.spec.ts tests/e2e/exchangeAnnounceNodes.spec.ts`.

### C6 — Client small fixes: lobby pickers and the teams rule, mode terms, bots countdown, typed plurals, one reduce-motion listener, one rating summary (M)

- **Files:**
  - `app/lobby.tsx`, `app/(online)/index.tsx`, `app/(online)/room.tsx`
  - new `components/lobbyPickers.tsx`, new `components/RatingSummary.tsx`
  - `components/HistoryRow.tsx`
  - `lib/game/gameEngine.ts` (+`modeFits`)
  - `server/socket/socketTable.ts:133`, `server/game/ratings.ts:197`
  - `lib/game/rating.ts`, `lib/i18n.ts`, `lib/accessibility.ts`
  - `app/profile.tsx`, `app/(online)/leaderboard.tsx`, `app/(online)/game.tsx:211-215`
  - `locales/{en,it,sq}.ts`
  - `tests/ui-rules/i18n.test.ts`, the reduce-motion test
- **Blocked by:** C4b. Also engine (`gameEngine.ts`), server-output (`ratings.ts`, `socketTable.ts`) and table-ui (`HistoryRow`).
- **Definition of done:**
  - [ ] `modeFits` is next to `TEAMS_PLAYER_COUNT` and used by three screens and `teamsSizeRefusal`. No literal 4 stands for the teams rule (grep).
  - [ ] `SeatCountPicker` and `MatchLengthPicker` are used by the offline lobby, the online lobby and the room.
  - [ ] `term.mode.teams` and `term.mode.freeForAll` (plus any glossary word a duplicate scan of `en.ts` finds; list it in the PR body) replace the per-screen keys in all three locales, using the owner's wording. The `i18n.test.ts` ratchet counts keys and exempts none, and is red once with one per-screen copy restored.
  - [ ] `BotsComingHint` owns the interval and is mounted only when `hostIsWaiting`. A render-count test shows the room screen does not re-render per tick.
  - [ ] `tn(base: PluralBase)`. A misspelled base is a `tsc` error (shown in a `@ts-expect-error` test).
  - [ ] Native reduce-motion: one `AccessibilityInfo` listener for N subscribers, released at zero (test with a mocked `AccessibilityInfo`).
  - [ ] `provisionalLeft()` is used by the server flag and three screens. `RatingSummary` is used by profile and leaderboard.
- **Checks:**
  - While iterating: `node --test tests/ui-rules/i18n.test.ts`, `npx tsc --noEmit`, and `npx jest` on the touched native tests.
  - Before pushing: `npm run agent:check`, then `npx playwright test tests/e2e/menuFit.spec.ts tests/e2e/smokeFlowCopy.spec.ts tests/e2e/friendsLadder.spec.ts tests/e2e/online.spec.ts`.

## 9. Cross-area contracts

- **table-ui:**
  - C5a/C5b edit `app/game.tsx`. C5b edits `components/feltCanvas.tsx`, `feltReady.ts`, `feltSkia.web.tsx` and `useCardRects.ts` (one import line each). C6 edits `components/HistoryRow.tsx`.
  - The `GameTable` props are not changed. `exchangeAnnouncement.holdMsOverride` stays a prop, now fed from `useOfflineDriver().exchangeHold`, and `error` stays `{ text, seq }` (the screen translates).
  - The name `TableFacts` belongs to #1604. This area uses `OnlineFacts`.
- **engine:** C6 adds `modeFits(mode, seats)` beside `TEAMS_PLAYER_COUNT` in `lib/game/gameEngine.ts`. C5a needs nothing new from the engine (`checkPlay`, `processPass`, `pickGivebackCard` and `resolveStuckExchange` as today).
- **server-output / server-runtime:** C6 edits `server/game/ratings.ts:197` (`provisional` from `provisionalLeft`) and `server/socket/socketTable.ts:133` (`modeFits`). C1 relies on the `room:rejoin`/`game:rejoin` reply contracts, which are unchanged: `roomId` echoed on `game:rejoin_failed`, and the terminal room codes.
- **test-harness:** if a shared fake socket or a `renderApp` lands first, C1 (`useRejoin`, `tableReset`) and C4a use it instead of hand-rolled doubles. This area adds `tests/native/onlineSurface.ts` and `tests/native/localContextMock.ts`, which test-harness may fold in.
- **static-checks:**
  - C2 and C5a rewrite `tests/ui-rules/contextSlices.test.ts`, and `scripts/contextSurface.mjs` (`:120` names `useOnlineGame`) must follow.
  - C5b replaces the e2e literal-pin tests with one count test.
  - C6 adds the `term.*` ratchet to `i18n.test.ts`.
- **time / lastMove:** no shared files expected. If lastMove edits `OnlineGameContext.tsx` (`onGameState`), it orders against C1/C2.
- **Open tickets:** C5a is blocked by #1624 (in progress) and #1639. #1628 (vote deadline) edits the match slice, so if it touches `OnlineGameContext.tsx` it orders against C1/C2.

## 10. Owner decisions needed

1. **Mode wording (C6):** pick the `it` and `sq` words for `term.mode.teams` and `term.mode.freeForAll`.
   - Today `it` uses Coppie / A coppie for teams and Libero / Libera / Tutti vs Tutti / Tutti contro tutti for free-for-all.
   - `sq` uses Çifte / Në çifte and I lirë / E lirë / Të gjithë kundër të gjithëve.
   - If the history row needs a short form, add `term.mode.*Short` rather than keeping per-screen keys.
   - The proposed default is "A coppie" / "Tutti contro tutti" and "Në çifte" / "Të gjithë kundër të gjithëve", with the short forms "Coppie" / "Libero" and "Çifte" / "I lirë".
2. **Resume while a table is live (C5a):** Home will offer "Resume" whenever an offline table is in memory and unfinished, and it goes back to that table. This is the fix for L-057; it is stated here only because it makes Resume show up in one more place (after an OS back) than it does today.
3. **`CONTEXT.md` update (no conflict):** after C2, the entry at `CONTEXT.md:127-130` should say the slice hooks are defined in the provider and re-exported from `onlineGameHooks.ts`. The seam is unchanged.
4. **L-067 deviation:** user-initiated `logout` stays POST-then-forget rather than try/finally, because a web cookie session survives a failed POST. If the owner prefers "always signed out locally", a stale cookie will sign the player back in on reload.
