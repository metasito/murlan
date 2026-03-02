# Murlan - Card Game App

A mobile card game app built with Expo React Native.

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
  _layout.tsx           # Root layout (AuthProvider + GameProvider)
  index.tsx             # Home screen (with auth-aware Online button)
  auth.tsx              # Login/Register screen
  lobby.tsx             # Offline game setup
  game.tsx              # Offline game table (landscape-locked)
  result.tsx            # End-game results + exchange overlay
  rules.tsx             # Rules & FAQ
  (online)/
    _layout.tsx         # OnlineGameProvider wrapper (requires auth)
    index.tsx           # Online lobby (create/join room)
    room.tsx            # Waiting room
    game.tsx            # Online game table (landscape + emoji reactions)
    friends.tsx         # Friend management

server/
  index.ts              # Express setup with session middleware
  routes.ts             # Auth + friend API routes
  socket.ts             # Socket.io server (room + game engine)
  storage.ts            # DrizzleStorage (PostgreSQL)
  db.ts                 # Drizzle + pg pool

lib/
  gameEngine.ts         # Game logic (cards, combos, AI, exchange)
  sounds.ts             # Sound playback (expo-av native + Web Audio API web)
  socket.ts             # socket.io-client singleton
  query-client.ts       # API fetcher + React Query config

context/
  GameContext.tsx       # Offline game state
  AuthContext.tsx       # User auth (username, friendCode, session)
  OnlineGameContext.tsx # Online game state (socket events)

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

## Known Constraints

- Expo Go compatible libraries only (no native builds)
- No `uuid` package — use `Date.now().toString() + Math.random().toString(36).substr(2, 9)` or `expo-crypto`
- `expo-av` deprecation warning is harmless (used for audio, works fine in SDK 53)
- Only one TypeScript error exists (pre-existing, in `server/routes.ts`) — safe to ignore
