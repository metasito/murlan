## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

---

## Project: Murlan

**Murlan** is a traditional Albanian card game, digitized as a mobile app. The UI language is Italian (the player base uses Italian), but the game itself is Albanian in origin. It is developed and deployed on **Replit** and must remain fully functional on Replit at all times — do not introduce changes that break the Replit environment.

---

## Replit Constraints

- The app runs on Replit. The Express server serves both the REST API and the Expo web bundle.
- **Port:** Use `process.env.PORT` — Replit assigns this dynamically.
- **Database:** Replit-managed PostgreSQL, connection string at `process.env.DATABASE_URL`.
- **Session table:** `session` — pre-created, never drop or recreate it. `createTableIfMissing: false`.
- **Env vars:** `DATABASE_URL`, `SESSION_SECRET`, `PORT` must always be set in Replit Secrets.
- Do not add build steps that require local tooling unavailable on Replit (e.g. native compilation).
- The app must be launchable from Replit's Run button without extra setup.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Expo Router (React Native, runs as web via Expo) |
| Backend | Express.js + Socket.io |
| Database | PostgreSQL via Drizzle ORM (`drizzle-orm`, `pg`) |
| Auth | bcryptjs + express-session (30-day httpOnly cookies in PostgreSQL) |
| Real-time | socket.io / socket.io-client |
| State | React Context (Auth, Game, OnlineGame, Socket, Settings) + @tanstack/react-query |
| Animations | react-native-reanimated |
| Audio | expo-av (native — deprecated, migration pending) + Web Audio API (web) |
| Fonts | Rajdhani (headings), Inter (body) via @expo-google-fonts |

---

## Key Files

| File | Purpose |
|---|---|
| `lib/gameEngine.ts` | All game logic, AI, card rules, exchange phase — **do not change game rules here** |
| `lib/socket.ts` | Socket singleton `Map<userId, Socket>` — **never violate singleton rules** |
| `lib/sounds.ts` | Unified sound API for native + web |
| `lib/theme.ts` | Design tokens (Colors, Spacing, Radius, FontSize, Shadow) — single source of truth for new components |
| `constants/colors.ts` | Legacy color constants — existing screens still use this; do not retroactively replace |
| `server/index.ts` | Express entry point |
| `server/routes.ts` | REST API routes |
| `server/socket.ts` | Socket.io event handlers, game state mutations |
| `server/db.ts` | Drizzle ORM + pg Pool |
| `server/session.ts` | express-session setup |
| `shared/schema.ts` | Drizzle schema + shared TypeScript types (Card, GameState, etc.) |
| `context/AuthContext.tsx` | Auth state (useAuth hook — god node with 22 edges) |
| `context/OnlineGameContext.tsx` | Online game state |
| `context/SocketContext.tsx` | Socket lifecycle, friend events, invite handling |
| `context/SettingsContext.tsx` | Sound/haptic toggles |
| `app/_layout.tsx` | Root layout, NotificationBanner |
| `app/lobby.tsx` | Reference design for offline lobby — all new menu screens follow this pattern |
| `app/(online)/game.tsx` | Online game screen (OnlineGameScreen) |
| `app/game.tsx` | Offline game screen (GameScreen) |

---

## MUST NOT CHANGE (golden rules from replit.md)

- **Game rules** — card hierarchy, combinations, Joker rules in `lib/gameEngine.ts`
- **Exchange Phase logic** — the card exchange between round winner/loser
- **Layout constants** — `CARD_W`, `CARD_H`, `SIDE_BTN_W`, `TABLE_M`, etc. — if changed, both `app/game.tsx` and `app/(online)/game.tsx` must be updated together
- **Flying card animation + pile state** — `pileState` card visibility logic
- **Friends system architecture** — 6-character friend codes, SocketContext friend events
- **Socket singleton** — one socket per userId, managed via `lib/socket.ts` singleton Map

---

## Architecture Rules

**Server authority:** The backend validates all game moves and broadcasts sanitized state. Never trust client-side game state for outcomes.

**Socket singleton:** `lib/socket.ts` maintains a `Map<userId, Socket>`. `SocketContext` is the only place to manage socket lifecycle. Never create sockets outside this pattern.

**Disconnect/reconnect:** On disconnect during a game, server emits `game:player_disconnected` and starts a 60s grace timer. Client emits `game:rejoin` on reconnect. `handleLeaveRoom` is only for intentional `room:leave` events.

**AFK:** 30s auto-pass timer, cleared on every move/pass.

**Session store:** `connect-pg-simple`, table `"session"`, `createTableIfMissing: false`. The table was pre-created — never recreate it.

**Game persistence:** `active_games` table stores live game state after every move.

**Rematch:** Vote-based (`game:rematch_vote`) — all players must agree.

**NotificationBanner:** Always mounted (never returns null). Animation is slide-in (320ms) → wait 4s → slide-out via callback chain — do not use parallel `withTiming` calls or the slide-in gets overwritten.

**OfflineBanner:** Only flags offline when `state.isConnected === false` — `null` does not mean offline.

**Friends FlatList:** Must have `extraData={onlineIds}` to re-render on online-status changes.

**Game invite flow:** `SocketContext` sets `pendingInvite` BEFORE showing the notification banner. `index.tsx` auto-fills join code via `pendingInvite` effect. No duplicate Alert — banner-only UX.

---

## Design System

- **Background:** `#031008`
- **Felt (table):** `#0B3B25`
- **Gold accents:** `#C9A84C`
- **New components:** use `lib/theme.ts` tokens + base components `MenuLayout`, `MenuCard`, `MenuButton` (from `components/`)
- **Shadows:** `Shadow.gold` / `Shadow.dark` in `lib/theme.ts` are platform-aware (`boxShadow` on web, native shadow props on native)
- **Orientation:** Game screens → landscape-locked. Menu/result screens → portrait + landscape via `useWindowDimensions`
- **Safe area:** Always use `useSafeAreaInsets()` in game/layout components

---

## Game Mechanics (reference)

- **Players:** 2–4
- **Deck:** Standard 52-card deck + Joker
- **Combinations:** Single, Pair, Triple, Straight, Bomb, Royal Straight
- **Card strength order:** 3 < 4 < ... < K < A < 2 < Joker (suit also matters for tiebreaks)
- **Exchange phase:** After each round, winner and loser exchange cards (special rule for two Jokers)
- **Teams mode:** 2v2 with partners
- **Win condition:** First to empty hand

---

## Known Pitfalls / Past Bugs

- `Cannot read property 'cards' of null` — always null-check game state before accessing `.cards`
- `Rendered fewer hooks than expected` in `OnlineGameScreen` — never early-return before all hooks are called
- `REPLACE navigation action not handled` — ensure `index` route exists in the navigator before navigating
- React Compiler (`babel-plugin-react-compiler`) can miscompile `useEffect` references — if you see `useEffect doesn't exist`, check compiler output
- `metro.config.js` has a self-import cycle — known, do not fix without testing metro still works

---

## Online Multiplayer Screens

All under `app/(online)/`:
- `_layout.tsx` — online layout wrapper
- `index.tsx` (OnlineLobbyScreen) — room creation/join
- `room.tsx` (RoomScreen) — waiting lobby with room code `XXXXXX`
- `game.tsx` (OnlineGameScreen) — live game
- `friends.tsx` (FriendsScreen) — friends list + invites
- `quickmatch.tsx` (QuickmatchScreen) — public room matchmaking via `publicRoomIds` Set
