# Murlan — Architecture

> **Scope of this file:** how the system is built — layers, data flow, socket lifecycle,
> auth, persistence, state management, and the presentational-table refactor. It does not
> cover game rules (`docs/RULES.md`), scope/decisions (`docs/BRIEF.md`), remediation status
> (`docs/PLAN.md`), or Replit run/deploy mechanics (`replit.md`).

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
lib/gameEngine.ts (offline: called directly)   server/socket.ts (online: server-authoritative)
                                                        │
                                                        ▼
                                                lib/gameEngine.ts (same engine, server side)
                                                        │
                                                        ▼
                                                shared/schema.ts + server/db.ts (Postgres)
```

- **`lib/gameEngine.ts`** is the single rules engine, imported by both the client (offline
  mode) and the server (online mode, authoritative). Deck of 54 (52 + 2 distinguishable
  Jokers) is dealt in full every game — see `docs/RULES.md` §3. There is no reduced-deck
  mode.
- **`server/socket.ts`** is the only place that mutates online game state. The client never
  computes an online outcome locally — it sends an intent (`game:play`, `game:pass`,
  `game:exchange_give_card`) and renders whatever the server broadcasts back.
- **`components/GameTable.tsx`** (925 lines) + **`components/gameTableModel.ts`** (305
  lines, pure/JSX-free) are the single presentational table. `app/game.tsx` (131 lines,
  offline) and `app/(online)/game.tsx` (361 lines, online) are thin adapters — see §5.

## 2. Data flow

**Offline:** `GameContext` holds a `GameState` produced by `lib/gameEngine.ts` in memory.
User actions call context methods that call the engine directly and set new state. Nothing
is persisted; a lost app means a lost game.

**Online:** `OnlineGameContext` holds a `GameState` it only ever receives from the server
via socket events (`game:state`, `game:play_result`, …). User actions call context methods
that `emit` an intent to the server. The server is the only writer of `GameState` — it
validates the intent against `lib/gameEngine.ts`, mutates state, persists it
(`active_games` table), and broadcasts a sanitized copy to every seat (each player's own
socket gets their own hand; opponents' hands are stripped server-side before emit).

## 3. Socket lifecycle and the ticket auth model

**Connection:** `lib/socket.ts` owns a singleton `Map<userId, Socket>` — `SocketContext` is
the only place that creates or tears down a socket. Nothing else is allowed to call `io()`.

**Auth handshake — ticket model (`server/ticket.ts`, `server/routes.ts`,
`server/socket.ts`):**
1. The client calls `POST /api/auth/socket-ticket` (behind `requireAuth`, so it needs a
   live session cookie) and receives a short-lived, single-use HMAC-signed ticket —
   `node:crypto` only, no new dependency.
2. `lib/socket.ts` fetches a fresh ticket immediately before every `io()` connect
   (including every reconnect, since tickets are single-use) and passes it as
   `auth: { ticket }`.
3. The server's connection middleware accepts **only** a valid session or a valid
   unconsumed ticket. There used to be a third branch — a bare, unproven
   `handshake.auth.userId` — that let any client connect as any user; it has been deleted.
   Rejected connections get `next(new Error('unauthorized'))`.

**Disconnect → grace period → bot takeover (not forfeit):**
- On `disconnect`, if the user has no other live socket, the server emits
  `game:player_disconnected` to the room, arms a fresh turn cycle so the table doesn't
  stall on the disconnected seat, and starts a `DISCONNECT_GRACE_MS` (60s) timer.
- If the same `userId` reconnects and emits `game:rejoin` before the timer fires, the timer
  is cleared and the seat is unaffected.
- If the grace period expires, `vacateSeat()` runs: the seat's player row is removed, the
  seat's `type` flips to `"ai"` so the engine's own AI plays it, and the room is told via
  `game:seat_bot_takeover` — **not** `game:player_left`, which is reserved for genuine
  game-over/abandonment so it doesn't eject the remaining humans from a game the server is
  actively keeping alive. If the vacancy leaves ≤1 human seated, the game really is
  unplayable and *that* is when `game:player_left` fires and the game is disposed.
- `game:rejoin` failures (room gone after a restart, stale room code, etc.) reply
  `game:rejoin_failed`; the client leaves the room and returns to the lobby.

**AFK (distinct from disconnect):** a connected-but-idle player gets a 30s
(`AFK_TIMEOUT_MS`) auto-pass/auto-play timer, re-armed on every turn transition through a
single `advanceTurn` epilogue so it can't be armed once and then silently stop covering
later turns.

## 4. Persistence

- **`active_games`** (`shared/schema.ts`): one row per room, `roomCode` primary key,
  `gameState` (jsonb, stamped with `schemaVersion` so a restart can tell a current-shape row
  from a stale pre-migration one and refuse to rehydrate it), `playerIds`, `playerMap`
  (keyed by seat, not compacted by array position — a compacted array previously
  reassigned a rejoining player to the wrong seat and the wrong hand), `scores`
  (cumulative match scores), `gameMode`, `matchTarget`. `persistGameState()` runs after
  every state-mutating move and does a full `onConflictDoUpdate` — mode, seats and
  scoreboard are all refreshed, not written once at game start.
- **`session`** (via `connect-pg-simple`): pre-created, `createTableIfMissing: false`. Never
  dropped or recreated by app code — see `replit.md`.
- **`match_replays`**: one row per finished manche — `seats`, `moves` and `rankings` as
  jsonb, plus `playerIds` for the containment filter both reads go through, so a player
  can only ever fetch a hand they sat at. **No hand is stored**: a move carries what was
  played and the counts that followed, never what anyone held. The live log is memory
  only (`OnlineGameState.moveLog`), unlike `handFlags`, because the `game_state` envelope
  is rewritten after every move and a hand a restart interrupts has no replay either way.
  Pruned by age (`REPLAY_RETENTION_DAYS`) inside the insert's transaction — a row belongs
  to up to four players, so a per-player cap could not delete one alone. The write is not
  awaited and the table is not required to exist: until `npm run db:push` has run the
  insert fails, is logged, and the only consequence is an empty replays list.
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
| `AuthContext` | Session user, login/logout/register, account deletion |
| `GameContext` | Offline `GameState`, calls `lib/gameEngine.ts` directly |
| `OnlineGameContext` | Online `GameState` as received from the server, socket intents |
| `SocketContext` | The socket singleton lifecycle, friend presence events, invites |
| `SettingsContext` | Sound, haptics, motion, and the card back / table felt |
| `NotificationContext` | Queue-based banner notifications; sits above `SocketContext` — both `SocketContext` and `OnlineGameContext` call `useNotification()` |

`@tanstack/react-query` handles request/response REST data (friends list, auth checks) —
it does not touch socket or game state.

## 6. The presentational-table refactor

`app/game.tsx` (offline) and `app/(online)/game.tsx` (online) used to independently
implement ~2,400 lines of nearly-identical table rendering, layout and animation. That has
been collapsed:

- **`components/gameTableModel.ts`** — pure functions and constants with no JSX and no
  runtime imports (only type-only imports from `lib/gameEngine.ts`), so it loads under
  Node's built-in TypeScript stripping in the test suite (`node --test`) without a bundler.
  Owns the layout constants (`CARD_H`, `BTN_W`, `SIDE_BTN_W`, `TABLE_M`,
  `HAND_SECTION_H`, …), seating/opponent-position math, pile advancement, exchange-state
  reads, and other logic both screens need identically.
- **`components/GameTable.tsx`** — the one presentational table. It takes a `GameState`, a
  `viewerSeat`, and a small set of slots (`topBarExtra`, `banners`, `overlays`,
  `turnTimer`) through which the offline and online adapters inject exactly what differs
  between them (a local AI turn loop and 20s response timer offline; server acknowledgement,
  reactions, and connection-loss banners online). It contains no `isOnline &&` branching.
- **`app/game.tsx`** (131 lines) and **`app/(online)/game.tsx`** (361 lines) are now thin
  adapters: each maps its own state source onto `GameTableProps`.

Both adapters call out, in a comment at the top of their component, the same guard: **every
hook runs unconditionally before the `if (!gameState) return null` guard.** This is not
decorative — it is the fix for a bug that was live until this refactor landed (see §7).

## 7. Fixed bug: "Rendered fewer hooks than expected" in `OnlineGameScreen`

Before the refactor, `app/(online)/game.tsx` had `if (!gameState) return null;` followed by
roughly a dozen more hooks (`useMemo`, `useEffect`, `useAnimatedStyle`, …). Any transition
from a non-null `gameState` to `null` while the component stayed mounted — e.g. a failed
`game:rejoin` after a server restart — dropped the hook count between renders and crashed
with `Rendered fewer hooks than expected`.

**Current guard:** in both `app/game.tsx` and `app/(online)/game.tsx`, every hook is called
unconditionally, and the null check (`if (!gameState) return null`) is the last line before
the `return` of JSX — nothing conditional sits between a hook and the top of the function.
Any future change to either file that reintroduces a hook after the null guard reintroduces
this crash; that is the one invariant to protect here.
