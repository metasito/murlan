# Murlan - Card Game App

A mobile card game app built with Expo React Native.

## Overview

Murlan is a classic Italian card game app with:
- Full offline single-player (vs AI opponents)
- Local multiplayer pass-and-play (2–4 players)
- **Online multiplayer** — private rooms by code, 2v2 teams / FFA, emoji reactions
- Complete game engine with all combination rules
- AI with 3 difficulty levels (Easy, Medium, Hard)
- Teams mode for 4 players
- Italian UI throughout
- Landscape + portrait adaptive layout on all menus and result screens
- Username shown everywhere (replaces "Tu" with the authenticated user's name)

## Tech Stack

- **Frontend:** Expo Router (React Native)
- **Backend:** Express.js + Socket.io (port 5000)
- **Database:** Replit PostgreSQL (Drizzle ORM)
- **Auth:** bcryptjs passwords + express-session (stored in PostgreSQL)
- **Real-time:** socket.io / socket.io-client
- **State:** React Context + @tanstack/react-query
- **Fonts:** Rajdhani + Inter (via @expo-google-fonts)
- **Animations:** react-native-reanimated

## Architecture

### App Structure
```
app/
  _layout.tsx           # Root layout (AuthProvider + GameProvider)
  index.tsx             # Home screen (with auth-aware Online button)
  auth.tsx              # Login/Register screen
  lobby.tsx             # Offline game setup
  game.tsx              # Offline game table (landscape)
  result.tsx            # Offline end-game results
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
  gameEngine.ts         # Game logic (cards, combos, AI)
  socket.ts             # socket.io-client singleton
  query-client.ts       # API fetcher + React Query config

context/
  GameContext.tsx       # Offline game state
  AuthContext.tsx       # User auth (username, friendCode, session)
  OnlineGameContext.tsx # Online game state (socket events)

shared/
  schema.ts             # DB schema (users, rooms, room_players, friends)
```

## Game Rules (Murlan)

- 54-card deck (52 + 2 jokers)
- Card strength: Joker★ > Joker > 2 > A > K > Q > J > 10 > ... > 3
- Combinations: Single, Pair, Triple, Straight (min **5** cards), Bomb (4×same rank), Royal Straight
- Start: player with 3♠ goes first; first play must include 3♠
- Win: first to empty hand wins
- Round: players must beat or pass; when all pass, winner starts new round
- Straights: face-value based, A-2-3-4-5 to 10-J-Q-K-A valid
- Royal Straight: all same suit, beats regular straights
- Bomb (4 of a kind): beats all except Royal Straight
- Jokers: strongest singles; only one joker single can beat another

## Online Multiplayer

- Auth: username + password, 30-day session via httpOnly cookie
- Friend codes: unique 6-char codes for adding friends
- Rooms: 6-char random code, 2–4 players, FFA or Teams
- Socket: auth via `socket.handshake.auth.userId`
- Server-authoritative: server validates all moves, broadcasts sanitized state
- Opponent hands are hidden (only card count visible)
- Emoji reactions: 😂 🔥 😤 👏 😱 🤡 💣 👑 — float animation per player

## Design

- Dark felt aesthetic (#031008 bg, #0B3B25 felt, #C9A84C gold)
- Landscape for game screens (locked); result.tsx also locked landscape
- Two-column landscape layout on result/game-over screens (no ScrollView)
- CARD_W=58, CARD_H=84; cards lift with translateY on selection
- Avatar circles with initials + card count badge

## Shared Components

- `components/GameShared.tsx` — single source of truth for both game screens:
  - CardFan, AvatarCircle, TopOppSlot, SideOppSlot, FlyingCards, PlayedPile, CardItem, StraightHand
  - Shared styles: sharedTableStyles, sharedStyles, portraitOverlayStyles
  - Layout constants: CARD_W, CARD_H, BTN_W, BTN_H, TOP_BAR_H, TABLE_M, SIDE_SECTION_W, TOP_SECTION_H, HAND_SECTION_H
  - getOpponentPosition: steps=1→right, steps=2→top, steps=3→left (visual only)
- `lib/sounds.ts` — card sound effects via expo-av (card_select, card_play, card_pass)
  - card_select.mp3 (volume 0.35), card_play.mp3 (0.9), card_pass.mp3 (0.5)
  - Preload on game screen mount, unload on unmount

## Turn Order

- `getNextActivePlayer` decrements index (clockwise): bottom→left→top→right
- Player 0 always gets 3♠ (hand swap in `initializeGame` + server)
- getOpponentPosition visual: steps=1→right, steps=2→top, steps=3→left

## Testing (Landscape UX)

IMPORTANT: The game and result screens are landscape-only. Use browser devtools:
1. Open DevTools → Device toolbar (Ctrl+Shift+M)
2. Set width ≥ 600px and height ≤ 400px (landscape)
3. Verify game table, player hands, and result screen all fit without scrolling
4. On result screen: left column = winner + stats + buttons; right column = rankings (+ scoreboard for multi-round)

## Workflows

- **Start Backend:** `npm run server:dev` (port 5000)
- **Start Frontend:** `npm run expo:dev` (port 8081)
