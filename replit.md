# Murlan - Card Game App

## Overview

Murlan is a mobile card game application developed with Expo React Native, bringing the classic Albanian card game to a digital format. The project aims to provide a comprehensive gaming experience with both offline and online play capabilities.

**Key features include:**
- **Offline Single-Player:** Play against AI opponents with three difficulty settings (Easy, Medium, Hard).
- **Local Multiplayer:** Pass-and-play mode for 2–4 players.
- **Online Multiplayer:** Supports private rooms via invite codes, enabling 2v2 team play or Free-For-All (FFA) matches. Includes emoji reactions for in-game communication.
- **Full Game Engine:** Implements all official Murlan rules, including card hierarchy, combinations (Single, Pair, Triple, Straight, Bomb, Royal Straight), and special Joker rules.
- **Exchange Phase:** Automated card exchange mechanism between the round winner and loser, with a special rule for two Jokers.
- **Teams Mode:** Specific game mode for 4 players.
- **User Interface:** Italian language UI, landscape-locked game screens, and adaptive portrait/landscape for menu/result screens.
- **Audio Experience:** 12 bundled WAV sound effects for various in-game events.

The business vision is to capture the market of traditional card game enthusiasts by offering a feature-rich, accessible mobile version of Murlan, fostering both casual and competitive play.

## User Preferences

- **Game Rules:** MUST NOT CHANGE
- **Exchange Phase:** MUST NOT CHANGE
- **Layout Constants:** MUST NOT CHANGE without updating both game files
- **Flying Card Animation + Pile:** MUST NOT CHANGE
- **Friends System Architecture:** IMPORTANT — do not break this
- **Socket Singleton Rules:** NEVER VIOLATE

## System Architecture

Murlan is built with a client-server architecture.

**Tech Stack:**
- **Frontend:** Expo Router (React Native)
- **Backend:** Express.js + Socket.io
- **Database:** Replit PostgreSQL with Drizzle ORM
- **Authentication:** bcryptjs for passwords, express-session for session management (stored in PostgreSQL)
- **Real-time Communication:** socket.io / socket.io-client
- **State Management:** React Context + @tanstack/react-query
- **Fonts:** Rajdhani and Inter (via @expo-google-fonts)
- **Animations:** react-native-reanimated
- **Audio:** expo-av (native), Web Audio API (web)

**Core Architectural Decisions & Design Patterns:**

**1. UI/UX Design:**
- **Color Scheme:** Dark felt theme (`#031008` background, `#0B3B25` felt, `#C9A84C` gold accents).
- **Typography:** Rajdhani for headings, Inter for body text.
- **Orientation:** Game screens are strictly landscape-locked. Menu and result screens adapt to both portrait and landscape orientations using `useWindowDimensions`.
- **Safe Area:** `useSafeAreaInsets()` ensures UI elements are not clipped.
- **Layout:** Game table fills the screen with minimal margins. `PASSA` and `GIOCA` buttons are inline within the hand section.
- **Animations:** Flying card animations for played cards, hand glow for current player's turn, and emoji reaction animations.
- **NotificationBanner:** A global, animated slide-down banner for real-time events (e.g., friend requests).
- **Design System:** `lib/theme.ts` is the single source of truth for Colors, Spacing, Radius, FontSize, and Shadow tokens. New components use this file. Existing screens still reference `constants/colors.ts` — do not retroactively replace.
- **Base Menu Components:** `components/MenuLayout.tsx` (safe-area-aware scrollable/fixed container), `components/MenuCard.tsx` (felt-colored card group), `components/MenuButton.tsx` (primary/secondary/danger/ghost variants). All new menu screens MUST use these. Offline lobby (`app/lobby.tsx`) is the reference design.

**2. Technical Implementations:**
- **Game Engine:** Encapsulated in `lib/gameEngine.ts`, handling all game logic, AI, and exchange rules.
- **Sound Management:** `lib/sounds.ts` provides a unified API for playing sounds across native and web platforms. Sounds are preloaded.
- **Socket Management:** A singleton `Map<userId, Socket>` in `lib/socket.ts` ensures a single socket instance per user, preventing connection issues. `SocketContext` centralizes socket lifecycle management and event listeners.
- **State Management:** React Context for global state (Auth, Game, OnlineGame, Socket) and React Query for data fetching and caching.
- **Authentication:** Session-based authentication with 30-day httpOnly cookies.
- **Server Authority:** The backend validates all game moves and broadcasts sanitized state, ensuring fair play in online matches.
- **Friend System:** Uses unique 6-character friend codes. `SocketContext` manages friend-related real-time events and notifications.
- **Online Lobby:** Rooms are created with a 6-character random code. Quickmatch functionality is implemented using a `publicRoomIds` Set.
- **Rematch System:** Vote-based rematch system (`game:rematch_vote`) in online multiplayer, requiring all players to agree.
- **Session Store:** Uses `express-session` + `connect-pg-simple` with `tableName: "session"` (matches existing DB table), `createTableIfMissing: false`. DB table was pre-created.
- **Game Persistence:** `active_games` table persists live game state to PostgreSQL after every move. Reconnect grace: 60s.
- **AFK Handling:** 30s timer auto-passes for inactive players. Clears on each move/pass.
- **Settings:** `SettingsContext` provides sound/haptic toggles. `SettingsModal` component accessible from home screen.
- **Offline Detection:** `OfflineBanner` uses `@react-native-community/netinfo`. Always-mounted; animation-controlled visibility. Only flags offline when `state.isConnected === false` (no false-positives from null values).
- **Structured Logging:** pino/pino-http replaces all console.log on the server.
- **NotificationBanner:** Always mounted (never returns null). Animation sequenced via callback chain: slide-in (320ms) → wait 4s → slide-out. Prevents the bug where a second `withTiming` assignment immediately overwrites the slide-in animation.
- **Friends FlatList:** `extraData={onlineIds}` on FlatList ensures rows re-render when online status changes, without waiting for the friends data array to change.
- **Game Invite:** `SocketContext` sets `pendingInvite` BEFORE showing notification. No duplicate Alert — banner-only UX. `index.tsx` auto-fills join code and opens modal via `pendingInvite` effect.

**3. Feature Specifications:**
- **Online Multiplayer Features:** Hidden opponent hands (only card count visible), emoji reactions with float animations, Quickmatch functionality, and vote-based rematch.
- **Friends System:** Sending/accepting/declining friend requests, listing online/offline friends with last seen status, and inviting friends to rooms.
- **Game Table Layout:** Specific pixel dimensions for cards, buttons, and section widths (`CARD_W`, `CARD_H`, `SIDE_BTN_W`, `TABLE_M`, etc.) are defined for consistent UI.
- **Flying Card Animation:** Uses `pileState` to manage card visibility during animation, ensuring cards appear exactly once.
- **Sound Events:** Specific sound events tied to game actions like card selection, play, pass, round start/win, bomb, deal, exchange, and game win/lose.

## External Dependencies

- **PostgreSQL:** For persistent data storage, accessed via Drizzle ORM.
- **Socket.io:** Real-time communication between client and server.
- **Expo SDK:** Core framework for React Native development, including `expo-router`, `@expo-google-fonts`, `expo-av`, `expo-crypto`, and `ScreenOrientation`.
- **React Native Ecosystem:**
    - `@tanstack/react-query`: Asynchronous state management and data fetching.
    - `react-native-reanimated`: For declarative animations.
    - `bcryptjs`: Password hashing.
    - `express-session`: Server-side session management.
    - `drizzle-orm`: ORM for PostgreSQL.
    - `pg`: PostgreSQL client.