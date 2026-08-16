# Graph Report - .  (2026-06-03)

## Corpus Check
- Large corpus: 208 files � ~908,901 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 823 nodes · 1327 edges · 70 communities (47 shown, 23 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 89 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Offline Game Screen|Offline Game Screen]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_Expo App Config|Expo App Config]]
- [[_COMMUNITY_Dev Dependencies|Dev Dependencies]]
- [[_COMMUNITY_Menu UI Components|Menu UI Components]]
- [[_COMMUNITY_Game Engine (Core)|Game Engine (Core)]]
- [[_COMMUNITY_Card View Component|Card View Component]]
- [[_COMMUNITY_Game State Mutations|Game State Mutations]]
- [[_COMMUNITY_Build Scripts|Build Scripts]]
- [[_COMMUNITY_Installed Skills Lock|Installed Skills Lock]]
- [[_COMMUNITY_Offline Lobby Screen|Offline Lobby Screen]]
- [[_COMMUNITY_Sound Generation Scripts|Sound Generation Scripts]]
- [[_COMMUNITY_Server Storage Layer|Server Storage Layer]]
- [[_COMMUNITY_App Layout and Notifications|App Layout and Notifications]]
- [[_COMMUNITY_Next.js Best Practices|Next.js Best Practices]]
- [[_COMMUNITY_Server Socket Events|Server Socket Events]]
- [[_COMMUNITY_Online Game Context|Online Game Context]]
- [[_COMMUNITY_Vercel Composition Patterns|Vercel Composition Patterns]]
- [[_COMMUNITY_Server Routes and Auth|Server Routes and Auth]]
- [[_COMMUNITY_Database Schema|Database Schema]]
- [[_COMMUNITY_Auth Context|Auth Context]]
- [[_COMMUNITY_Socket Context|Socket Context]]
- [[_COMMUNITY_Theme and Design Tokens|Theme and Design Tokens]]
- [[_COMMUNITY_Vercel React Best Practices|Vercel React Best Practices]]
- [[_COMMUNITY_Online Game Screen|Online Game Screen]]
- [[_COMMUNITY_Friends Screen|Friends Screen]]
- [[_COMMUNITY_Online Lobby Screen|Online Lobby Screen]]
- [[_COMMUNITY_Room Screen|Room Screen]]
- [[_COMMUNITY_Result Screen|Result Screen]]
- [[_COMMUNITY_Rules Screen|Rules Screen]]
- [[_COMMUNITY_Game Shared Layout|Game Shared Layout]]
- [[_COMMUNITY_React Performance Rules|React Performance Rules]]
- [[_COMMUNITY_Server Middleware|Server Middleware]]
- [[_COMMUNITY_Shared DB Schema Types|Shared DB Schema Types]]
- [[_COMMUNITY_Query Client|Query Client]]
- [[_COMMUNITY_Drizzle Config|Drizzle Config]]
- [[_COMMUNITY_Settings Context|Settings Context]]
- [[_COMMUNITY_Error Boundary|Error Boundary]]
- [[_COMMUNITY_Exchange Phase UI|Exchange Phase UI]]
- [[_COMMUNITY_Offline Banner|Offline Banner]]
- [[_COMMUNITY_Attached UI Screenshots|Attached UI Screenshots]]
- [[_COMMUNITY_Bug Reports and Fixes|Bug Reports and Fixes]]
- [[_COMMUNITY_Functional Requirements|Functional Requirements]]
- [[_COMMUNITY_Production Hardening Specs|Production Hardening Specs]]
- [[_COMMUNITY_UI Polish Specs|UI Polish Specs]]
- [[_COMMUNITY_Frontend Design Skill|Frontend Design Skill]]
- [[_COMMUNITY_Find Skills Skill|Find Skills Skill]]
- [[_COMMUNITY_Game Engine AI|Game Engine AI]]
- [[_COMMUNITY_Haptics Library|Haptics Library]]
- [[_COMMUNITY_Sounds Library|Sounds Library]]
- [[_COMMUNITY_Socket Library|Socket Library]]
- [[_COMMUNITY_Server Logger|Server Logger]]
- [[_COMMUNITY_Server Validator|Server Validator]]
- [[_COMMUNITY_Server Session|Server Session]]
- [[_COMMUNITY_Server DB Connection|Server DB Connection]]
- [[_COMMUNITY_Server Schemas|Server Schemas]]
- [[_COMMUNITY_Landing Page HTML|Landing Page HTML]]
- [[_COMMUNITY_Card Images|Card Images]]
- [[_COMMUNITY_Game Table Screenshots|Game Table Screenshots]]
- [[_COMMUNITY_JS Performance Rules|JS Performance Rules]]
- [[_COMMUNITY_Bundle Optimization Rules|Bundle Optimization Rules]]
- [[_COMMUNITY_Rendering Performance Rules|Rendering Performance Rules]]
- [[_COMMUNITY_Colors Constants|Colors Constants]]
- [[_COMMUNITY_Quick Match Screen|Quick Match Screen]]
- [[_COMMUNITY_Invite Context|Invite Context]]
- [[_COMMUNITY_Native Intent Handler|Native Intent Handler]]
- [[_COMMUNITY_Not Found Screen|Not Found Screen]]

## God Nodes (most connected - your core abstractions)
1. `DrizzleStorage` - 29 edges
2. `Murlan Card Game App` - 23 edges
3. `useAuth()` - 22 edges
4. `Next.js Best Practices SKILL` - 19 edges
5. `expo` - 15 edges
6. `playNative()` - 15 edges
7. `playWebNotes()` - 14 edges
8. `Re-render Optimization Patterns` - 14 edges
9. `Card` - 13 edges
10. `makeSamples()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Murlan Expo App Config` --references--> `Murlan Card Game App`  [INFERRED]
  app.json → replit.md
- `Murlan Package.json` --references--> `Murlan Card Game App`  [INFERRED]
  package.json → replit.md
- `AuthScreen (app/auth.tsx)` --implements--> `Murlan Card Game App`  [INFERRED]
  app/auth.tsx → replit.md
- `HomeScreen (app/index.tsx)` --implements--> `Murlan Card Game App`  [INFERRED]
  app/index.tsx → replit.md
- `Murlan Game Table UI Layout` --implements--> `Murlan Card Game App`  [INFERRED]
  attached_assets/Cards_1772375986950.PNG → replit.md

## Import Cycles
- 1-file cycle: `metro.config.js -> metro.config.js`

## Hyperedges (group relationships)
- **Murlan Core Architecture** — murlan_replit_md_game_engine, murlan_replit_md_socket_singleton, murlan_replit_md_react_context, murlan_replit_md_session_store, murlan_replit_md_active_games_table [INFERRED 0.85]
- **Vercel State Management Composition Patterns** — vcp_context_interface, vcp_lift_state, vcp_decouple_implementation [EXTRACTED 0.95]
- **Murlan Installed Agent Skills** — skills_find_skills_skill_md_find_skills, skills_frontend_design_skill_md_frontend_design, skills_next_best_practices_skill_md_next_bp, skills_vercel_composition_skill_md_vcp, skills_vercel_react_bp_skill_md [EXTRACTED 1.00]
- **JavaScript Collection Performance Patterns** — vrbp_js_index_maps, vrbp_js_set_map_lookups, vrbp_js_combine_iterations [INFERRED 0.85]
- **Server-Side Caching Patterns** — vrbp_server_cache_lru, vrbp_server_cache_react, vrbp_server_hoist_static_io [INFERRED 0.85]
- **Online Multiplayer Screens** — app_online_index_tsx, app_online_room_tsx, app_online_game_tsx, app_online_friends_tsx, app_online_quickmatch_tsx [EXTRACTED 1.00]
- **Murlan React Context Providers** — context_authcontext_tsx, context_gamecontext_tsx, context_onlinegamecontext_tsx, context_socketcontext_tsx, context_settingscontext_tsx [EXTRACTED 1.00]
- **Murlan Server Stack** — server_index_ts, server_socket_ts, server_routes_ts, server_db_ts, server_session_ts [EXTRACTED 1.00]
- **Murlan Core Game Types** — concept_card_type, concept_combination_type, concept_game_state [EXTRACTED 1.00]

## Communities (70 total, 23 thin omitted)

### Community 0 - "Offline Game Screen"
Cohesion: 0.06
Nodes (68): EXCHANGE_VALID_RANKS, GameScreen(), localStyles, billboardStyles, COMBO_LABELS, FLY_LANDING_ROTS, FLY_OFFSETS, FLY_ROTS (+60 more)

### Community 1 - "Package Dependencies"
Cohesion: 0.03
Nodes (62): dependencies, bcryptjs, connect-pg-simple, drizzle-orm, drizzle-zod, expo, expo-av, expo-blur (+54 more)

### Community 2 - "Expo App Config"
Cohesion: 0.07
Nodes (29): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, package, reactCompiler, typedRoutes (+21 more)

### Community 3 - "Dev Dependencies"
Cohesion: 0.07
Nodes (27): devDependencies, @babel/core, babel-plugin-react-compiler, drizzle-kit, eslint, eslint-config-expo, @expo/ngrok, patch-package (+19 more)

### Community 4 - "Menu UI Components"
Cohesion: 0.12
Nodes (21): MenuButton(), MenuButtonProps, styles, Variant, MenuCard(), MenuCardProps, styles, MenuLayout() (+13 more)

### Community 5 - "Game Engine (Core)"
Cohesion: 0.11
Nodes (20): aiChoosePlay(), canPlayerPlay(), cardStrength(), CombinationType, EXCHANGE_VALID_RANKS, getAllValidPlays(), getCombinationStrength(), getCombinationType() (+12 more)

### Community 6 - "Card View Component"
Cohesion: 0.14
Nodes (17): CardView(), CardViewProps, styles, ExchangeAnnouncement(), ExchangeAnnouncementProps, getItalianCardName(), styles, ExchangeModal() (+9 more)

### Community 7 - "Game State Mutations"
Cohesion: 0.13
Nodes (16): deepCloneState(), getNextActivePlayer(), processExchangeChoice(), processPass(), processPlay(), activeGames, afkTimers, broadcastGameState() (+8 more)

### Community 8 - "Build Scripts"
Cohesion: 0.15
Nodes (22): checkMetroHealth(), clearMetroCache(), downloadAssets(), downloadBundle(), downloadBundlesAndManifests(), downloadFile(), downloadManifest(), exitWithError() (+14 more)

### Community 9 - "Installed Skills Lock"
Cohesion: 0.09
Nodes (22): computedHash, source, sourceType, computedHash, source, sourceType, computedHash, source (+14 more)

### Community 10 - "Offline Lobby Screen"
Cohesion: 0.15
Nodes (18): DIFFICULTY_LABELS, LobbyMode, LobbyScreen(), PlayerRowProps, ROUND_OPTIONS, styles, GameContext, GameContextValue (+10 more)

### Community 11 - "Sound Generation Scripts"
Cohesion: 0.15
Nodes (18): fs, genBomb(), genCardPass(), genCardPlay(), genCardSelect(), genDeal(), genExchange(), genGameLose() (+10 more)

### Community 13 - "App Layout and Notifications"
Cohesion: 0.12
Nodes (15): COLOR_MAP, ICON_MAP, NotificationData, NotificationType, Props, styles, OfflineBanner(), styles (+7 more)

### Community 14 - "Next.js Best Practices"
Cohesion: 0.11
Nodes (20): Next.js Async Params/Cookies Patterns, Next.js Bundling Best Practices, Next.js Data Fetching Patterns, Next.js Debug Tricks (MCP endpoint), Next.js Directives (use client/server/cache), Next.js Error Handling, Next.js File Conventions, Next.js Font Optimization (+12 more)

### Community 15 - "Server Socket Events"
Cohesion: 0.16
Nodes (12): AuthScreen(), styles, Tab, FriendsButton(), HomeScreen(), MenuButtonProps, styles, AuthContext (+4 more)

### Community 16 - "Online Game Context"
Cohesion: 0.14
Nodes (18): AuthScreen (app/auth.tsx), HomeScreen (app/index.tsx), RootLayout (app/_layout.tsx), ResultScreen (app/result.tsx), Murlan Functional Requirements (Italian), Murlan Production Hardening Implementation Spec (Expo), Murlan UI/UX Game Logic Consistency Plan, ErrorBoundary Component (+10 more)

### Community 17 - "Vercel Composition Patterns"
Cohesion: 0.15
Nodes (13): logger, authLimiter, friendLimiter, registerRoutes(), SessionData, AddFriendSchema, ExchangeCardSchema, LoginSchema (+5 more)

### Community 18 - "Server Routes and Auth"
Cohesion: 0.16
Nodes (13): generateRoomCode(), IStorage, activeGames, friends, friendStatusEnum, gameModeEnum, insertUserSchema, Room (+5 more)

### Community 19 - "Database Schema"
Cohesion: 0.15
Nodes (9): db, pool, app, configureExpoAndLanding(), getAppName(), IncomingMessage, REQUIRED_ENV, PgSession (+1 more)

### Community 20 - "Auth Context"
Cohesion: 0.19
Nodes (14): defaults, Settings, SettingsContext, SettingsContextValue, SettingsProvider(), guard(), hapticError(), hapticHeavy() (+6 more)

### Community 21 - "Socket Context"
Cohesion: 0.19
Nodes (12): RootLayoutNav(), useOnlineGame(), useSocket(), FriendsScreen(), OnlineLobbyScreen(), styles, FriendInfo, InviteFriendsPanel() (+4 more)

### Community 22 - "Theme and Design Tokens"
Cohesion: 0.19
Nodes (13): AuthContext (AuthProvider), query-client.ts (TanStack Query client, apiRequest), active_games PostgreSQL Table, Session Store (connect-pg-simple), server/db.ts (Drizzle ORM + pg Pool), server/index.ts (Express server entry), server/logger.ts (Pino structured logger), server/routes.ts (Express REST API routes) (+5 more)

### Community 23 - "Vercel React Best Practices"
Cohesion: 0.18
Nodes (7): apiRequest(), throwIfResNotOk(), UnauthorizedBehavior, FriendInfo, FriendRequest, SearchResult, styles

### Community 24 - "Online Game Screen"
Cohesion: 0.20
Nodes (12): GameScreen (app/game.tsx), OnlineGameScreen (app/(online)/game.tsx), Bug Report: Cannot read property 'cards' of null, Replit Requirements: Exchange Announcement Redesign, CardView Component, ExchangeAnnouncement Component, ExchangeModal Component, GameShared (shared game table layout constants) (+4 more)

### Community 25 - "Friends Screen"
Cohesion: 0.21
Nodes (12): Compound Component Pattern, Provider/Context Pattern, Vercel Composition Patterns SKILL, Vercel Composition Patterns (Compiled AGENTS.md), Avoid Boolean Prop Proliferation, Prefer Children Over Render Props, Use Compound Components, Define Generic Context Interfaces (+4 more)

### Community 26 - "Online Lobby Screen"
Cohesion: 0.17
Nodes (12): Vercel React Best Practices SKILL, Advanced React Patterns, Vercel React Best Practices AGENTS.md (compiled), Avoid Barrel File Imports Rule, Bundle Size Optimization, Client-Side Data Fetching Patterns, Defer Await Until Needed, Dynamic Imports for Heavy Components (+4 more)

### Community 27 - "Room Screen"
Cohesion: 0.20
Nodes (8): CardExchangeOverlay(), exStyles, POSITION_COLORS, POSITION_ICONS, POSITION_LABELS, ResultScreen(), styles, calcRoundPoints()

### Community 28 - "Result Screen"
Cohesion: 0.24
Nodes (6): ErrorBoundary, ErrorBoundaryProps, ErrorBoundaryState, ErrorFallback(), ErrorFallbackProps, styles

### Community 29 - "Rules Screen"
Cohesion: 0.25
Nodes (9): OnlineGameContext, OnlineGameProvider(), Reaction, RematchVoteState, RoomState, getApiUrl(), connectSocket(), getSocket() (+1 more)

### Community 30 - "Game Shared Layout"
Cohesion: 0.18
Nodes (11): Authenticate Server Actions Rule, React.cache() Per-Request Deduplication, Use after() for Non-Blocking Operations Rule, Authenticate Server Actions Like API Routes Rule, Cross-Request LRU Caching Rule, React.cache Per-Request Deduplication Rule, Avoid Duplicate Serialization in RSC Props Rule, Hoist Static I/O to Module Level Rule (+3 more)

### Community 31 - "React Performance Rules"
Cohesion: 0.20
Nodes (11): Defer State Reads to Usage Point Rule, Narrow Effect Dependencies Rule, Subscribe to Derived State Rule, Calculate Derived State During Rendering Rule, Use Lazy State Initialization Rule, Extract Default Non-primitive from Memoized Component Rule, Put Interaction Logic in Event Handlers Rule, Re-render Optimization Patterns (+3 more)

### Community 32 - "Server Middleware"
Cohesion: 0.27
Nodes (10): FriendsScreen (app/(online)/friends.tsx), OnlineLayout (app/(online)/_layout.tsx), QuickmatchScreen (app/(online)/quickmatch.tsx), RoomScreen (app/(online)/room.tsx), Murlan Room/Stanza Screen Implementation Plan, InviteContext (re-export from SocketContext), SocketContext (SocketProvider, friend events), socket.ts (Socket singleton Map) (+2 more)

### Community 33 - "Shared DB Schema Types"
Cohesion: 0.24
Nodes (10): AFK Timer (30s auto-pass), Card Type (suit, rank, isJoker), Combination Type (single/pair/triple/straight/bomb/royal_straight), Disconnect Grace Timer (60s reconnect window), GameState (full game state object), OnlineGameContext (OnlineGameProvider), gameEngine.ts (Card types, game logic, AI), Disconnect/Reconnect Grace Timer (+2 more)

### Community 34 - "Query Client"
Cohesion: 0.20
Nodes (10): Cache Storage API Calls Rule, Combine Multiple Array Iterations Rule, Early Return from Functions Rule, Hoist RegExp Creation Rule, Build Index Maps for Repeated Lookups Rule, Early Length Check for Array Comparisons Rule, Use Loop for Min/Max Instead of Sort Rule, JavaScript Performance Micro-optimizations (+2 more)

### Community 35 - "Drizzle Config"
Cohesion: 0.22
Nodes (8): compilerOptions, baseUrl, paths, strict, extends, include, @/*, @shared/*

### Community 36 - "Settings Context"
Cohesion: 0.25
Nodes (9): Use Activity Component for Show/Hide Rule, Animate SVG Wrapper Instead of SVG Element Rule, Use Explicit Conditional Rendering Rule, CSS content-visibility for Long Lists Rule, Prevent Hydration Mismatch Without Flickering Rule, Suppress Expected Hydration Mismatches Rule, Rendering Performance Patterns, Optimize SVG Precision Rule (+1 more)

### Community 37 - "Error Boundary"
Cohesion: 0.40
Nodes (6): LobbyScreen (app/lobby.tsx), OnlineLobbyScreen (app/(online)/index.tsx), Fix: Con Amici Screen Layout Match Gioca VS AI, Fix: Elements Must Fit Without Scrolling in Landscape, UI Screenshot: Con Amici (Create Room) Screen, UI Screenshot: Gioca vs AI (Lobby) Screen

### Community 38 - "Exchange Phase UI"
Cohesion: 0.33
Nodes (3): FAQ, FAQS, styles

### Community 39 - "Offline Banner"
Cohesion: 0.33
Nodes (6): Online Game Screenshot: Playing Cards in Hand, UI Screenshot: Online Game End State (Carte finite), UI Screenshot: Early Murlan Game Table (2-player), UI Screenshot: Early Murlan 2-player Hand View, UI Screenshot: Online Murlan Game (3 opponents), Murlan Game Table UI Layout

### Community 40 - "Attached UI Screenshots"
Cohesion: 0.33
Nodes (6): Bug Report: ReferenceError useEffect doesn't exist (React Compiler), React Compiler Auto-optimization, Murlan Expo App Config, Hoist Static JSX Elements Rule, Use Functional setState Updates Rule, Extract to Memoized Components Rule

### Community 41 - "Bug Reports and Fixes"
Cohesion: 0.40
Nodes (5): Props, SettingsModal(), styles, useSettings(), queryClient

### Community 42 - "Functional Requirements"
Cohesion: 0.33
Nodes (6): createDeck(), dealCards(), findStartingPlayer(), initializeGame(), initializeRematch(), shuffleDeck()

### Community 44 - "UI Polish Specs"
Cohesion: 0.67
Nodes (4): Murlan UI Polish Instructions, Colors Constants (design tokens), theme.ts (Design tokens: Colors, Spacing, Radius, Shadow), Design System (lib/theme.ts)

### Community 46 - "Find Skills Skill"
Cohesion: 0.67
Nodes (3): UI Screenshot: Online Game with LUAJ Button Active, Online Game Screenshot: Selected Cards for Play, Card Selection Interaction (GIOCA/LUAJ button)

## Knowledge Gaps
- **361 isolated node(s):** `allow`, `name`, `slug`, `version`, `orientation` (+356 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Murlan Card Game App` connect `Online Game Context` to `Server Middleware`, `Shared DB Schema Types`, `Offline Banner`, `Attached UI Screenshots`, `UI Polish Specs`, `Theme and Design Tokens`, `Online Game Screen`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `DrizzleStorage` connect `Server Storage Layer` to `Server Routes and Auth`, `Production Hardening Specs`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `Vercel React Best Practices AGENTS.md (compiled)` connect `Online Lobby Screen` to `Query Client`, `Settings Context`, `Attached UI Screenshots`, `Game Shared Layout`, `React Performance Rules`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 11 inferred relationships involving `Murlan Card Game App` (e.g. with `AuthScreen (app/auth.tsx)` and `HomeScreen (app/index.tsx)`) actually correct?**
  _`Murlan Card Game App` has 11 INFERRED edges - model-reasoned connections that need verification._
- **What connects `allow`, `name`, `slug` to the rest of the system?**
  _361 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Offline Game Screen` be split into smaller, more focused modules?**
  _Cohesion score 0.05962059620596206 - nodes in this community are weakly interconnected._
- **Should `Package Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.03225806451612903 - nodes in this community are weakly interconnected._