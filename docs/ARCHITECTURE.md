# Murlan — Architecture

> **Scope of this file:** how the system is built — layers, data flow, socket lifecycle,
> auth, persistence, state management, and the presentational-table refactor. It does not
> cover game rules (`docs/GAME-RULES.md`), scope/decisions (`docs/BRIEF.md`), outstanding work
> (GitHub Issues, `metasito/murlan`), or deploy mechanics (`docs/DEPLOY-RUNBOOK.md`).

---

## 1. Layers

```
Expo Router app/ (screens)
        │
        ▼
components/GameTable.tsx  ◄── the one presentational game table
        │  (props only — no game-mode branching inside)
        ▼
context/  (GameContext offline, OnlineGameContext online)
        │
        ▼
lib/game/gameEngine.ts (offline: called directly)   server/socket/socket.ts (online: handshake + listeners)
                                                        │
                                                        ▼
                                                server/socket/socketGameplay.ts (one listener per intent)
                                                        │
                                                        ▼
                                                server/game/tableRouter.ts  ◄── applyOrForward: this
                                                        │                  process, or the one
                                                        │                  that owns the room
                                                        ▼
                                                server/game/tableHandlers.ts (applyTableAction)
                                                  + gameTurn.ts / gameOver.ts / dealManche.ts
                                                        │
                                                        ▼
                                                lib/game/gameEngine.ts (same engine, server side)
                                                        │
                                                        ▼
                                                shared/schema.ts + server/store/db.ts (Postgres)
```

- **`lib/game/gameEngine.ts`** is the single rules engine, imported by both the client (offline
  mode) and the server (online mode, authoritative). Deck of 54 (52 + 2 distinguishable
  Jokers) is dealt in full every game — see `docs/GAME-RULES.md` §3. There is no reduced-deck
  mode. The bot heuristics live apart from the rules, in `lib/game/ai.ts`, reached only through
  `lib/game/autoMove.ts`.
- **The client sends an intent** (`game:play`, `game:pass`, `game:exchange_give_card`) and renders
  whatever the server broadcasts back — server/CLAUDE.md's server-authority rule covers why.
  `server/socket/socket.ts` is the handshake and the listener wiring only; it never touches game
  state. Every intent lands in a `server/socket/socketGameplay.ts` listener, which resolves the room
  and calls `applyOrForward` (`server/game/tableRouter.ts`) and does nothing else. **The single
  mutator is `applyTableAction` in `server/game/tableHandlers.ts`**, which dispatches to
  `playAction` / `passAction` / `exchangeAction` / `rejoinAction` / `startMatchAction` /
  `seatLostAction`; those in turn use `gameTurn.ts` (`armTurn`, the AFK timer and bot turns),
  `gameOver.ts` (`handleGameOver`) and `dealManche.ts` (the shared fresh-manche reset used by
  both the first deal and a rematch). See §3 for how `applyOrForward` reaches the process that
  owns the room.
- **`components/GameTable.tsx`** + the table's pure model (`seatLayout.ts`,
  `flightPhysics.ts`, `turnTimerUi.ts`, `tableFrame.ts`, `tableA11y.ts` — all JSX-free) +
  **`components/table/`** are the single presentational table. `GameTable.tsx` assembles it
  and owns the interaction; `components/table/` holds the pieces it draws, one file per
  concern — `seats.tsx` (the opponent slots), `pile.tsx` (the played pile and the card
  flight), `hand.tsx` (the viewer's card row) and `chrome.tsx` (the vignette, the billboard,
  the banners and the shared table styles); `components/useTableFeedback.ts` answers a state
  change with a sound, a haptic or a wobble. `app/game.tsx` (offline) and
  `app/(online)/game.tsx` (online) are thin adapters — see §6.

- **`lib/` is client code, except for the modules `server/` and `shared/` import.** That set is
  not a list anyone maintains: `tests/server/serverLoadable.test.ts` derives it by scanning the
  server's own imports — `import type` included — and loads each under plain Node, so it is
  whatever the imports say it is today. **A module in that set may import only other modules in
  it and third-party packages with no React Native dependency** — everything else in `lib/`
  reaches `react-native`, `expo-*` or AsyncStorage and breaks `npm run server:build`. Adding a
  `lib/` import to a server file therefore enlists that module and everything it imports; the
  test is where you find out.
- **`locales/en.ts`, `it.ts` and `sq.ts`** back every `t()` call (components/CLAUDE.md's
  translation-coverage rule); `DEFAULT_LOCALE` and every fallback in `lib/i18n.ts` resolve to
  English.

## 2. Data flow

**Offline:** `GameContext` holds a `GameState` produced by `lib/game/gameEngine.ts` in memory.
User actions call context methods that call the engine directly and set new state. The
whole match — engine state, scoreboard, rematch answers, and the seat setup the next
manche is dealt from — is written to AsyncStorage on every change (`lib/offlineSave.ts`),
so a kill mid-hand is resumable from the home screen. A save from another version is
discarded rather than migrated, the same call `active_games` makes.

**Online:** `OnlineGameContext` holds a `GameState` it only ever receives from the server
via socket events (`game:state`, `game:over`, …). User actions call context methods
that `emit` an intent to the server. The server is the only writer of `GameState`
(server/CLAUDE.md's authority rule) — it runs the intent through `lib/game/gameEngine.ts`,
mutates state, persists it (`active_games` table), and emits a copy to every seat with each
player's own hand and opponents' hands stripped before emit.

**`playedRanks` on the broadcast state.** A 15-slot tally, indexed by `getRankStrength`, of
how many cards of each rank have been played this manche. `processPlay` writes it and every
fresh deal resets it, so the one funnel both the online and offline paths already share keeps
it correct in both without a second implementation. It is public information — every seat
watched those cards land — so `sanitizeStateForPlayer` passes it through untouched, and it
holds ranks only, never card identities. It is the bots' whole memory: without it no bot at
any difficulty could know a 2 or a joker was already gone.

The field is **optional**, because `GameState` is persisted as jsonb and a hand in flight
across a deploy rehydrates without it. A bot reading an absent tally must play exactly as it
did before the tally existed. It is an additive protocol change; older clients ignore it.

At two seats the twenty-six undealt cards are never played and never in a bot's hand, so they
read as still outstanding. That makes the bot slightly more cautious than a perfect counter
and never over-confident, which is the safe direction — do not "fix" it by tracking the
excluded cards, which would put cards nobody has seen into a broadcast field.

## 3. Socket lifecycle and the ticket auth model

**Connection:** `lib/socket.ts` owns a singleton `Map<userId, Socket>` — `SocketContext` is
the only place that creates or tears down a socket. Nothing else is allowed to call `io()`.

**Auth handshake — ticket model (`server/socket/ticket.ts`, `server/http/routes.ts`,
`server/socket/socket.ts`):**
1. The client calls `POST /api/auth/socket-ticket` (behind `requireAuth`, so it needs a
   live session cookie) and receives a short-lived, single-use HMAC-signed ticket —
   `node:crypto` only, no new dependency.
2. `lib/socket.ts` fetches a fresh ticket immediately before every `io()` connect
   (including every reconnect, since tickets are single-use) and passes it as
   `auth: { ticket }`.
3. The server's connection middleware accepts only a valid session or a valid unconsumed
   ticket — the two paths server/CLAUDE.md's ticket-auth rule allows. Rejected connections get
   `next(new Error("Not authenticated"))`, or `AUTH_UNAVAILABLE` when the check itself failed.

**Single session per account:** a second connection for the same user evicts the first
rather than the two coexisting. The older socket receives `SESSION_REPLACED` over the
`socket:error` path and disconnects itself — `lib/socket.ts` would otherwise retry forever
and evict the new connection right back. The evicted tab renders a terminal "opened
elsewhere" state with a manual reconnect action; it does not go silently dead, and it does
not reconnect on its own.

**Table ownership and forwarding (`server/game/gameOwnership.ts`, `server/game/tableRouter.ts`):** a live
game lives in one process's `activeGames` map, and more than one process may be running. A room
is owned by whichever process holds a Postgres **advisory session lock** keyed by
`ownershipKey(roomId)`. There is no lease and no heartbeat expiry, deliberately: a killed process
drops its Postgres connection and Postgres releases its locks, so ownership cannot outlive the
process holding it.

`applyOrForward` is the one door in:
1. If this process has the room in `activeGames`, it applies the action itself.
2. Otherwise it asks every other instance over `io.serverSideEmit(TABLE_ACTION_EVENT, …)`. Each
   instance's `registerTableRouting` listener replies `NOT_THIS_INSTANCE` unless it owns the
   room, in which case it applies the action and acks with the real outcome.
3. If nobody owns it, this process claims the lock, rehydrates the game from Postgres and
   becomes the owner.

The forwarding instance does **not** re-broadcast. Broadcasts happen inside the owner's own
handler (`broadcastGameState`, `io.to(roomId).emit(…)`) and reach every socket at that table
whichever instance holds each one, because the Socket.io Postgres adapter carries `io.to()`
across instances the same way it carries the forwarded action.

**Bot-filled matches:** `room:start` with `fillWithBots` needs only one seated human. The
room screen already offers bot-fill and the match-length picker together, so a solo player
against bots plays a complete match to the target, the same as a full human table — not a
single manche.

**Disconnect → grace period → bot takeover (not forfeit):**
- On `disconnect`, if the user has no other live socket, the server emits
  `game:player_disconnected` to the room, arms a fresh turn cycle so the table doesn't
  stall on the disconnected seat, and starts a `disconnectGraceMs()` (60s default) timer.
- If the same `userId` reconnects and emits `game:rejoin` before the timer fires, the timer
  is cleared and the seat is unaffected.
- If the grace period expires, `vacateSeat()` runs: the seat's player row is removed, the
  seat's `type` flips to `"ai"` so the engine's own AI plays it, and the room is told via
  `game:seat_bot_takeover` — **not** `game:player_left`, which is reserved for genuine
  game-over/abandonment so it doesn't eject the remaining humans from a game the server is
  actively keeping alive. If the vacancy leaves ≤1 human seated, the game really is
  unplayable and *that* is when `game:player_left` fires and the game is disposed.
- The seat keeps playing rather than ending the match, because a disconnect is far more
  often the network than a walkout and the server has no reliable way to tell the two
  apart. The takeover is not a one-time announcement: the seat carries a persistent bot
  marker (`SeatBadges` in `components/table/seats.tsx`) for the rest of the match, not just
  the four-second `game:notification` banner — a player who looks away has to be able to
  tell, on return, that the seat is no longer human.
- `game:rejoin` failures (room gone after a restart, stale room code, etc.) reply
  `game:rejoin_failed`; the client leaves the room and returns to the lobby.

**AFK (distinct from disconnect):** a connected-but-idle player gets a 30s-default
(`afkTimeoutMs()`) auto-pass/auto-play timer, re-armed on every turn transition through a
single `armTurn` epilogue so it can't be armed once and then silently stop covering
later turns.

## 4. Persistence

- **`active_games`** (`shared/schema.ts`): one row per room, and only three columns —
  `roomId` primary key, `updatedAt` (a column because `pruneAbandonedGames` filters on it
  in SQL), and `gameState`, the versioned envelope `PersistedEnvelope`
  (`shared/persistedEnvelope.ts`) specifies. Everything else rides inside that envelope: the
  hand itself, `handFlags`, `dealFirstSeat`, the room's six-character `joinCode` (duplicated
  from `rooms.code` so a cold-start rejoin can still draw the room screen once that row is
  gone — a code cannot be invented, and an unjoinable one on screen is worse than none), and
  a `match` object holding `playerMap`
  (keyed by seat, not compacted by array position — a compacted array previously
  reassigned a rejoining player to the wrong seat and the wrong hand), `scores`,
  `gameMode`, `matchTarget`, `matchLength`, `maxPlayers` and `isPublic`. One
  version stamp therefore governs the whole row; it previously covered `gameState` alone,
  so a bump refused a stale hand while happily rehydrating the stale scoreboard beside it.
  `persistGameState()` runs after every state-mutating move and does a full
  `onConflictDoUpdate` — mode, seats and scoreboard are all refreshed, not written once at
  game start.
  Rows are deleted by `disposeGame`, whose every caller walks the in-memory map — so a
  restart, which empties that map, orphans the row of any game that was live. The
  periodic sweeper therefore also prunes rows untouched for 24h. `updated_at` advances
  on every move, so a game being played is never a candidate.
- **`session`** (via `connect-pg-simple`): `server/store/schemaDdl.ts` creates it at boot with
  the same DDL the library ships (server/CLAUDE.md's session-table rule covers its config and
  lifecycle). Never dropped or recreated by app code — see `docs/DEPLOY-RUNBOOK.md`.
- **`match_replays`**: one row per finished manche — `seats`, `moves` and `rankings` as
  jsonb, plus `playerIds` for the containment filter both reads go through, so a player
  can only ever fetch a hand they sat at. **No hand is stored**: a move carries what was
  played and the counts that followed, never what anyone held. The live log is memory
  only (`OnlineGameState.moveLog`), unlike `handFlags`, because the `game_state` envelope
  is rewritten after every move and a hand a restart interrupts has no replay either way.
  Pruned by age (`REPLAY_RETENTION_DAYS`) inside the insert's transaction — a row belongs
  to up to four players, so a per-player cap could not delete one alone. The write is not
  awaited: if it fails it is logged, and the only consequence is an empty replays list.
  It is also the one user-naming table with **no** cascading foreign key — a replay
  belongs to up to four players, so `deleteUser` erases the departing player from it
  by hand (id out of `player_ids`, name blanked in `seats`) and drops replays nobody
  is left to open. The blank name is deliberate: the row carries no wording, and the
  client renders its own localized label.
- **`user_ratings`**: one row per player per season, primary key `(user_id, season)`.
  The season is `YYYY-MM` **derived from the clock**, never written by a scheduled job:
  a reset that has to run on a host that sleeps is a reset that eventually does not.
  A new season is a new row seeded from half the previous one's distance to 1000, so
  last season stays readable. Written per manche beside the stats write, on the same
  `isContestedTable` gate, free-for-all only. Not awaited and not required to exist.
- **`rooms` / `room_players` / `friends` / `users`**: relational state for lobby, matchmaking
  and the friends system, unrelated to in-hand game state.

## 5. State management

React Context, one provider per concern:

| Context | Owns |
|---|---|
| `AuthContext` | Session user, and the account state machine: login/logout/register, rename, change password, add email, `refreshUser` |
| `GameContext` | Offline `GameState`, the match score, rematch and exchange-announcement state; calls `lib/game/gameEngine.ts` directly |
| `OnlineGameContext` | Online `GameState` as received from the server, plus the room, the turn clock, match/rematch/end-match vote state, disconnected seats and spectator mode, and the socket intents. Screens read it through the six slices in `context/onlineGameHooks.ts`, not directly — `tests/ui-rules/contextSlices.test.ts` pins that |
| `SocketContext` | The socket singleton lifecycle, friend presence events, invites |
| `SettingsContext` | Sound, haptics, motion, and the card back / table felt |
| `NotificationContext` | Queue-based banner notifications; sits above `SocketContext` — both `SocketContext` and `OnlineGameContext` call `useNotification()` |

`@tanstack/react-query` handles request/response REST data (friends list, auth checks) —
it does not touch socket or game state.

## 6. The presentational-table refactor

`app/game.tsx` (offline) and `app/(online)/game.tsx` (online) used to independently
implement nearly-identical table rendering, layout and animation. That has been
collapsed:

- **`components/seatLayout.ts`**, **`flightPhysics.ts`**, **`turnTimerUi.ts`**,
  **`tableFrame.ts`**, **`tableA11y.ts`** — the table's pure model, one file per concern
  (#956). Each is JSX-free with relative runtime imports, so `node --test` can load it
  (`docs/agents/checks.md`, "Node's TypeScript loader"). A module under `components/table/`
  that keeps to the same shape is node-loadable whatever its neighbours are, which is how a
  number reached only from a `.tsx` — or from a `.ts` that imports through `@/` at runtime —
  is tested.
  `seatLayout` holds the layout constants and the seating/opponent-position math;
  `flightPhysics` the card flight, pile advancement, impact feedback and exchange-state
  reads; `turnTimerUi` the play-button labels and the turn clock; `tableFrame` the
  safe-area/rail arithmetic; `tableA11y` the screen-reader description. `flightPhysics`
  takes `seatDirection` from `seatLayout`; the reverse must never happen.
- **`components/GameTable.tsx`** — the one presentational table. It takes a `GameState`, a
  `viewerSeat`, and a small set of slots (`turnTimer`, `exchangeAnnouncement`,
  `rematchPrompt`, `disconnectedSeats`, `railExtra`, `banners`, `overlays`) through which the
  offline and online adapters inject exactly what differs between them (a local AI turn loop and
  its response timer offline; server acknowledgement,
  reactions, and connection-loss banners online). It contains no `isOnline &&` branching.
- **`components/table/`** — the table's own components, grouped by what they draw:
  `seats.tsx`, `pile.tsx`, `hand.tsx` and `chrome.tsx`. `GameTable.tsx` is their only
  screen-level consumer, and three `tests/native/` cases mount `seats.tsx` and `hand.tsx`
  directly.
- **`components/useTableFeedback.ts`** — the shared values, the effects that answer a state
  change with a sound, a haptic or a wobble, and the animated styles they drive. `GameTable`
  still schedules the impact itself, against `impactDelayMs()`,
  and calls `playImpact` when it lands: the timer has to be cancellable alongside the flight
  it belongs to.
- **`app/game.tsx`** and **`app/(online)/game.tsx`** are now thin adapters: each maps its
  own state source onto `GameTableProps`.

Both adapters call out, in a comment at the top of their component, the hook-order guard
CLAUDE.md's invariants list states — the fix for a bug that was live until this refactor
landed (see §7).

### 6a. What offline and online share below the table

The presentational table unified what the two modes *draw*. The modules below unify what
they *decide*, so a rule cannot hold in one mode and not the other:

- **`lib/game/autoMove.ts`** — called by `server/` and by `context/GameContext.tsx`
  (CLAUDE.md's bot-move invariant: one chooser, both callers). It also owns
  `resolveStuckExchange`, the valve for an exchange no seat can satisfy.
- **`lib/game/matchState.ts`** — the `game:over` wire shape (`GameOverPayload`, `ScoreLine`,
  `MatchVerdict`) and `celebration()`, which picks the name the results board shouts. A
  winner travels as an **engine player id** (`player_N`), never a username or a seat index
  (server/CLAUDE.md's rule). `matchWinnerIds` may be empty on a match that
  *is* over — a client rejoining a finished table never receives the event — so
  `celebration()` takes an ordered candidate list and passes over any id naming no seat.
- **`lib/game/standings.ts`**, **`lib/game/placement.ts`**, **`lib/exchangeCeremony.ts`** — scoring
  order, placement colours and labels, and the ceremony's own clock.
- **`components/ResultBoard.tsx`** — the end-of-manche screen for both modes; `app/result.tsx`
  and the online `GameOverOverlay` are thin callers.
- **`server/socket/emit.ts`** — every `game:match_state` and `game:vote_state` broadcast, so the
  vote total is derived once rather than at each call site.

A module here that the server bundles (`autoMove`, `matchState`, `standings`,
`exchangeCeremony`) imports with a relative path and an explicit `.ts`, and touches nothing
from `react-native`. `lib/wire.ts` and `lib/game/placement.ts` are client-only.

## 7. Fixed bug: "Rendered fewer hooks than expected" in `OnlineGameScreen`

Before the refactor, `app/(online)/game.tsx` had a null-state early return followed by
roughly a dozen more hooks (`useMemo`, `useEffect`, `useAnimatedStyle`, …). Any transition
from a non-null `gameState` to `null` while the component stayed mounted — e.g. a failed
`game:rejoin` after a server restart — dropped the hook count between renders and crashed
with `Rendered fewer hooks than expected`.

Both `app/game.tsx` and `app/(online)/game.tsx` now hold the guard CLAUDE.md's invariants
list states; a change to either file that violates it reintroduces this exact crash.
