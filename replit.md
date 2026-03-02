# Murlan - Card Game App

A mobile card game app built with Expo React Native.

## MAINTENANCE RULE — ALWAYS KEEP THIS FILE UPDATED

**Before closing any session, update this file with:**
- New files created or deleted (add to Architecture section)
- Changed APIs, socket events, or DB columns
- New dependencies installed
- Architectural decisions and their rationale
- Bug fixes that required non-obvious solutions (document the root cause + fix)
- Any rules or constraints discovered during development

Failure to update this file means the next session starts blind.

---

## Overview

Murlan is a classic Italian card game with:
- Full offline single-player (vs AI opponents)
- Local multiplayer pass-and-play (2–4 players)
- **Online multiplayer** — private rooms by code, 2v2 teams / FFA, emoji reactions
- Complete game engine with all Murlan rules
- AI with 3 difficulty levels (Easy, Medium, Hard)
- Teams mode for 4 players
- Italian UI throughout
- Landscape-locked game screens; portrait+landscape result/menu screens
- 12 bundled WAV sound effects (expo-av on native, Web Audio API synth on web)

## Game Rules (MUST NOT CHANGE)

- 54-card deck (52 standard + 2 jokers)
- **Always deal 4 groups of 13 cards** — regardless of player count. With 2 players, 2 groups are unused/excluded.
- Card strength (low→high): 3 4 5 6 7 8 9 10 J Q K A 2 Joker★ Joker★★
- Combinations: Single, Pair, Triple, Straight (min 5 cards), Bomb (4×same rank), Royal Straight
- **Jokers can ONLY be played as single cards** — never in pairs, triples, straights, or any multi-card combination
- **3♠ starts first game**: player holding 3 of spades goes first; first play must include 3♠
- **Clockwise turn order**: `getNextActivePlayer` wraps indices clockwise
- Win: first to empty hand wins the round; game continues until all finish
- Round: players must beat the current combo or pass; when all pass, the round winner starts fresh
- Bomb (4 of a kind): beats any non-bomb combination
- Royal Straight: all same suit 5+ straight, beats regular straights and bombs

## Exchange Phase (MUST NOT CHANGE)

After each round (before the next deal):
1. **Loser gives best card** to winner — taken automatically in `initializeRematch`
2. **Winner must give a 3–10 card back** to loser (winner picks from their valid cards)
3. **Loser starts** the new round (after exchange)
4. **Both-jokers exception**: if the loser has both jokers, no exchange occurs — winner starts instead
5. Exchange dialog shows the received card as a `<CardView>` image (not text)
6. Both-jokers screen has an OK button to dismiss

## Tech Stack

- **Frontend:** Expo Router (React Native)
- **Backend:** Express.js + Socket.io (port 5000)
- **Database:** Replit PostgreSQL (Drizzle ORM)
- **Auth:** bcryptjs passwords + express-session (stored in PostgreSQL)
- **Real-time:** socket.io / socket.io-client
- **State:** React Context + @tanstack/react-query
- **Fonts:** Rajdhani + Inter (via @expo-google-fonts)
- **Animations:** react-native-reanimated
- **Audio:** expo-av + 12 real WAV files in `assets/sounds/`

## Architecture

### App Structure
```
app/
  _layout.tsx           # Root layout: QueryClient → Auth → Socket → Notification banner
  index.tsx             # Home screen (Amici gold pill button with badge)
  auth.tsx              # Login/Register screen
  lobby.tsx             # Offline game setup
  game.tsx              # Offline game table (landscape-locked)
  result.tsx            # End-game results + exchange overlay
  rules.tsx             # Rules & FAQ
  (online)/
    _layout.tsx         # OnlineGameProvider wrapper (requires auth)
    index.tsx           # Online lobby (create/join room)
    room.tsx            # Waiting room (+ InviteFriendsPanel)
    game.tsx            # Online game table (landscape + emoji reactions)
    friends.tsx         # Friend management (reads onlineIds from SocketContext)
    quickmatch.tsx      # Quickmatch lobby

server/
  index.ts              # Express setup with session middleware
  routes.ts             # Auth + friend API routes
  socket.ts             # Socket.io server (room + game engine + friend events)
  storage.ts            # DrizzleStorage (PostgreSQL) — includes hasPendingRequest()
  db.ts                 # Drizzle + pg pool

lib/
  gameEngine.ts         # Game logic (cards, combos, AI, exchange)
  sounds.ts             # Sound playback (expo-av native + Web Audio API web)
  socket.ts             # socket.io-client singleton — keyed by userId Map
  query-client.ts       # API fetcher + React Query config

context/
  GameContext.tsx       # Offline game state
  AuthContext.tsx       # User auth (username, friendCode, session)
  OnlineGameContext.tsx # Online game state (uses getSocket(userId) singleton)
  SocketContext.tsx     # Global socket lifecycle + onlineIds + notifications + invites
  InviteContext.tsx     # Re-exports useSocket as useInvite (backward compat shim)

components/
  NotificationBanner.tsx  # Slide-down banner for friend events (requests, acceptances, invites)
  GameShared.tsx          # Shared game UI components

assets/sounds/          # 12 WAV files (RIFF format, distinct sizes)
  card_select.mp3, card_play.mp3, card_pass.mp3
  your_turn.mp3, round_start.mp3, round_win.mp3
  urgent_tick.mp3, bomb.mp3, deal.mp3
  exchange.mp3, game_win.mp3, game_lose.mp3

scripts/
  gen-sounds.js         # WAV PCM generator (run if audio files need regeneration)
```

## Layout Constants (in GameShared.tsx — MUST NOT CHANGE without updating both game files)

```
CARD_W = 58, CARD_H = 84
SIDE_BTN_W = 50           # Width of inline PASSA/GIOCA buttons
BTN_W = 84, BTN_H = 84   # Legacy (not used for main buttons)
TOP_BAR_H = 40
TABLE_M = 4               # Margin around game table (tight, maximizes board size)
SIDE_SECTION_W = 130      # Opponent side panels
TOP_SECTION_H = 70        # Opponent top panel
HAND_SECTION_H = CARD_H + 16
```

## Game Table Layout

- Table fills screen edge-to-edge minus `TABLE_M=4` margins on all sides
- **Inline buttons**: PASSA and GIOCA are inside the hand section row (left/right sides)
  - PASSA: width=SIDE_BTN_W (50px), height=CARD_H, red pill
  - GIOCA: width=SIDE_BTN_W+4 (54px), height=CARD_H, gold gradient pill
  - `handAvailW = tableW - (SIDE_BTN_W+6)*2 - 8`
- `handSection` is `flexDirection: "row"` with buttons flanking `StraightHand`
- No absolute-positioned buttons outside the table
- Hand glow: native shadow (`shadowColor: gold, shadowRadius: 20`) when player's turn; web uses `boxShadow` inline style
- No visible border line on hand section (removed `borderTopWidth`)

## Flying Card Animation + Pile (MUST NOT CHANGE)

- `pileState = { prev: Combination | null, current: Combination | null }` derived from `gameState.lastPlayedCombination`
- `pileState.current` set **immediately** when new combo detected (no waiting for animation)
- **T005 fix**: `<PlayedPile current={flyInfo ? null : pileState.current} />` — pile's current layer hidden while animation is in flight, preventing duplicate rendering of the same cards
- `FlyingCards.onDone` only calls `setFlyInfo(null)` — nothing else
- `cancelAnimation` called on all Reanimated values in FlyingCards cleanup (prevents ghost flicker)
- Cards appear exactly once: flying during animation, then settled in pile

## Sounds

All 12 events: `playCardSelect`, `playCardPlay`, `playCardPass`, `playYourTurn`, `playRoundStart`, `playRoundWin`, `playUrgentTick`, `playBomb`, `playGameWin`, `playGameLose`, `playDeal`, `playExchange`
- Preloaded on game mount via `preloadSounds()`
- `playDeal()` fires after preload completes
- `playBomb()` fires for bomb + royal_straight combos
- `playExchange()` fires when exchange phase becomes active
- `playGameWin/Lose()` fires based on finish position

## Online Multiplayer

- Auth: username + password, 30-day session via httpOnly cookie
- Friend codes: unique 6-char codes for adding friends
- Rooms: 6-char random code, 2–4 players, FFA or Teams
- Socket: auth via `socket.handshake.auth.userId`
- Server-authoritative: server validates all moves, broadcasts sanitized state
- Opponent hands are hidden (only card count visible)
- Emoji reactions: 😂 🔥 😤 👏 😱 🤡 💣 👑 — float animation per player
- **Quickmatch**: `room:quickmatch` server event matches players by (maxPlayers+gameMode). `publicRoomIds` Set tracks open rooms.
- **Vote-based rivincita**: `game:rematch_vote` event; all players vote; restarts when all agree. `cumulativeScores` accumulate across rounds.
- **entrySource** in `OnlineGameContext`: `"quickmatch"` or `"friends"` — determines navigation on exit (quickmatch → `/quickmatch`, friends → `/(online)`)
- **Room lobby**: mode is read-only for all players (set at creation, not editable in lobby)

## UI/UX Rules

- All menu/lobby screens must be fully usable in both portrait AND landscape — use `useWindowDimensions` to detect and switch layouts
- Never let elements be clipped or unreachable in any orientation
- Game screens (offline + online) are landscape-locked via `ScreenOrientation.lockAsync`
- Shared game logic (banners, overlays, slot components, rankings) must live in `components/GameShared.tsx` — never duplicate between game files
- `StartReasonBanner` is exported from `GameShared.tsx` — import from there in both game files

## Navigation Conventions

- On exit from online game or room lobby, navigate based on `entrySource` from `OnlineGameContext`:
  - `"quickmatch"` → `router.replace("/(online)/quickmatch")`
  - `"friends"` (or null) → `router.replace("/(online)")`
- `leaveRoom()` in context does NOT navigate — navigation is the screen's responsibility
- `entrySource` is set in context: `"quickmatch"` when `quickmatch()` is called, `"friends"` when `createRoom()` or `joinRoom()` is called

## Friends System

### Architecture (IMPORTANT — do not break this)

**Root cause of previous bugs**: `lib/socket.ts` was recreating socket instances whenever `!socket.connected`. Since `autoConnect: false`, each context (`InviteProvider`, `OnlineGameProvider`) got a **different** socket instance — only one actually connected. All real-time events on the others were silently lost.

**Current correct design**:
- `lib/socket.ts` uses a `Map<userId, Socket>` — once created for a userId, ALWAYS returns the same instance
- `context/SocketContext.tsx` owns the entire socket lifecycle. It is the ONLY place that calls `connectSocket` / `disconnectSocket`
- All other contexts/screens use `getSocket(userId)` to access the already-connected singleton
- `OnlineGameContext` uses `getSocket(user.id)` — safe because SocketContext has already connected it

### Socket Singleton Rules (NEVER VIOLATE)
- **Never** recreate a socket based on connection state — Socket.IO handles reconnection automatically
- **Never** add `friend:*` event listeners outside of `SocketContext` — they belong there exclusively
- **Never** call `socket.connect()` / `socket.disconnect()` outside of `SocketContext`
- `getSocket(userId)` throws if socket doesn't exist yet — callers must ensure `SocketContext` has initialized first

### SocketContext (`context/SocketContext.tsx`)
Exposes via `useSocket()`:
- `socket` — the connected Socket.io instance (or null if not logged in)
- `onlineIds` — `Set<string>` of currently online friend user IDs (always accurate)
- `notification` — current in-app banner notification (or null)
- `dismissNotification()` — clears current notification
- `pendingInvite` — `{ roomCode, fromUsername }` or null
- `clearInvite()` — clears pending invite

Handles globally:
- `friend:online_list` → seeds `onlineIds` Set on connect
- `friend:status` → updates `onlineIds` (online/offline + lastSeen)
- `friend:request_incoming` → shows NotificationBanner + invalidates React Query cache
- `friend:request_accepted` → shows NotificationBanner + invalidates cache
- `friend:invite` → shows Alert dialog + sets `pendingInvite`
- On connect: emits `friend:get_online_list` to get current online friends

### NotificationBanner (`components/NotificationBanner.tsx`)
- Slide-down animated banner at top of screen (via react-native-reanimated)
- Auto-dismisses after 4 seconds; tap to dismiss early
- Two types: `friend_request` (gold, person-add icon) and `friend_accepted` (green, checkmark icon)
- Placed in root `_layout.tsx` so it overlays all screens
- Read notification state from `SocketContext` via `useSocket()`

### Server-side (`server/socket.ts`)
- `emitToUser(userId, event, data)` — exported helper to emit to a specific user's socket
- `friend:get_online_list` socket event — returns current online friend IDs to requesting socket
- `friend:status` emitted to friends on connect/disconnect with `{ userId, online, lastSeen }`
- `friend:online_list` emitted on connect with array of currently online friend IDs

### Storage (`server/storage.ts`)
- `hasPendingRequest(fromId, toId)` — checks for existing pending request (prevents duplicates)
- `acceptFriend(requestId)` — returns `{ requesterId }` so server can notify them
- `declineFriendRequest(requestId)` — declines and removes request
- `removeFriend(userId, friendUserId)` — removes friendship both ways
- `updateLastSeen(userId)` — called on socket disconnect

### API Endpoints
- `POST /api/friends/add` — `{ friendCode }` → sends request; returns 409 "Richiesta di amicizia già inviata" if duplicate
- `GET /api/friends/requests` — returns pending incoming requests
- `POST /api/friends/accept/:id` — accepts; emits `friend:request_accepted` to requester
- `POST /api/friends/decline/:id` — declines
- `DELETE /api/friends/:friendUserId` — removes friend
- `GET /api/friends` — list with `lastSeen` field

### Home Screen (`app/index.tsx`)
- Gold "Amici" pill button with `people` icon
- Red badge showing count of pending friend requests (from `/api/friends/requests`)
- Badge updates are driven by React Query cache invalidation from SocketContext (not local socket listeners)
- Navigates to `/(online)/friends`

### Friends Screen (`app/(online)/friends.tsx`)
- Reads `onlineIds` from `useSocket()` — never sets up its own socket listeners
- Green dot (#4CAF50) for online, grey dot for offline
- Italian relative time for last seen ("Poco fa", "X min fa", etc.)
- Remove friend: trash icon + confirmation alert
- Decline request: × button
- Add friend: by friend code input

### Room Invite Panel (`app/(online)/room.tsx`)
- `InviteFriendsPanel` reads `onlineIds` from `useSocket()`
- Shows online friends not yet in room as avatar chips
- Tapping emits `friend:invite` via `getSocket(userId)`

## Design

- Dark felt: `#031008` bg, `#0B3B25` felt, `#C9A84C` gold
- Fonts: Rajdhani (headings) + Inter (body)
- Landscape locked for game screens via `ScreenOrientation.lockAsync`
- Safe area via `useSafeAreaInsets()` — never hardcode top/bottom/left/right padding
- Web insets: top=67px, bottom=34px (applied only on `Platform.OS === "web"`)
- Result screen landscape: `paddingLeft/Right = insets.left/right`; `landscapeLeft` has `minWidth: 130, maxWidth: 200`

## Workflows

- **Start Backend:** `npm run server:dev` (port 5000)
- **Start Frontend:** `npm run expo:dev` (port 8081)
- Restart backend after ANY server/ or lib/socket.ts changes
- Do NOT restart frontend unnecessarily — HMR handles most changes automatically

## Known Constraints

- Expo Go compatible libraries only (no native builds)
- No `uuid` package — use `Date.now().toString() + Math.random().toString(36).substr(2, 9)` or `expo-crypto`
- `expo-av` deprecation warning is harmless (used for audio, works fine in SDK 53/54)
- TypeScript: Express `req.params.*` is typed `string | string[]` — always wrap with `String(req.params.x)` when passing to storage functions
