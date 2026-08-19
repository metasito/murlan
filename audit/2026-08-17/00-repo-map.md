# Murlan — Phase 0 repo map

Produced 2026-08-17. Read-only recon. Every claim below was verified against source
or against command output captured in this session.

---

## 1. Baseline health

**Git**

| Item | Value |
|---|---|
| SHA | `b894af461550cd1a184a6a6f1694baf10d27b70c` |
| Branch | `main` |
| Remote | `origin https://github.com/metasito/murlan.git` |
| Dirty | `?? audit/2026-08-17/PROMPT.md` (untracked, the audit brief itself) — nothing else |
| Total commits | 291 |
| First commit | 2026-03-01 `288d27f Initial commit` |
| Last commit | 2026-08-17 |

**Commands run** (all from repo root, Git Bash, Windows 11, Node available locally):

| Check | Command | Exit | Wall | Result |
|---|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | 0 | 10s | **0 errors**, zero output |
| Lint | `npx expo lint` (= `npm run lint`) | 0 | 10s | **0 problems**, zero bytes of output |
| Unit/integration | `npm test` (`node --test "tests/**/*.test.ts"`) | 0 | 4s | **672 tests, 670 pass, 0 fail, 2 skipped** |
| Native renderer | `npx jest` (= `npm run test:native`) | 0 | 21s | **18 suites, 230 tests, all pass** (each suite runs twice: ios + android projects) |
| E2E | `npm run test:e2e` (Playwright) | — | — | **could not run: needs a live Postgres + a built web bundle + browser download**; not attempted |

**The 672-test run is not the whole suite.** 11 integration files self-skip when
`DATABASE_URL` is unset. Captured verbatim from the run:

```
﹣ abandoned game rows        # DATABASE_URL not set — skipping integration tests (unit tests still run)
﹣ socket authentication      # DATABASE_URL not set — skipping integration tests (unit tests still run)
﹣ client crash reports       # DATABASE_URL not set — skipping integration tests (unit tests still run)
﹣ gameplay integrity         # DATABASE_URL not set — skipping integration tests (unit tests still run)
﹣ ladder and replay writes   # DATABASE_URL not set — skipping integration tests (unit tests still run)
﹣ push token registry        # DATABASE_URL not set — skipping integration tests (unit tests still run)
﹣ a fresh database is usable on the first boot
﹣ spectator mode
﹣ stats persistence (Task 8)
﹣ online teams mode
﹣ startTestServer() cleans up after a failure during boot
```

That is **11 of 88 top-level suites silently no-ops locally**. CI guards this: see §12
— `.github/workflows/ci.yml:67-74` greps the test output for the skip string and fails
the job. So the skip is a local-only hole, and it is closed on CI. Note the interaction
with the CLAUDE.md "no self-defeating safeguards" rule: this is the *correct* shape —
the skip exists, and a separate check makes it fatal where it matters.

**Existing type errors:** 0. **Existing lint errors:** 0.
There is no pre-existing red to filter out — any failure a specialist finds is real.

---

## 2. Stack (derived from `package.json`, config files, source)

| Layer | Technology | Version |
|---|---|---|
| Runtime (server) | Node — CI pins **Node 24**, `.replit` module is **nodejs-22** | see note |
| Language | TypeScript | `~5.9.2` |
| App framework | Expo (SDK 54) | `~54.0.27` |
| React | react / react-dom | `19.1.0` |
| React Native | react-native | `0.81.5` |
| Web renderer | react-native-web | `^0.21.0` |
| Router | expo-router | `~6.0.17` |
| Server | Express | `^5.0.1` (Express **5**, not 4) |
| Realtime | socket.io / socket.io-client | `^4.8.3` |
| DB driver | pg | `^8.16.3` |
| ORM | drizzle-orm / drizzle-kit / drizzle-zod | `^0.39.3` / `^0.31.4` / `^0.7.0` |
| Auth | bcryptjs `^3.0.3` + express-session `^1.19.0` + connect-pg-simple `^10.0.0` | |
| Validation | zod | `^3.24.2` |
| Server state | @tanstack/react-query | `^5.83.0` |
| Client state | React Context (7 providers, §8) | — |
| Animation | react-native-reanimated `~4.1.1` + react-native-worklets `0.5.1` + react-native-gesture-handler `~2.28.0` | |
| Audio | expo-audio `~1.1.1` (+ Web Audio API in `lib/sounds.ts`) | |
| Fonts | @expo-google-fonts/inter `^0.4.2`, @expo-google-fonts/rajdhani `^0.4.1` | |
| Security mw | helmet `^8.1.0`, express-rate-limit `^8.2.1` | |
| Logging | pino `^10.3.1` + pino-http `^11.0.0` + pino-pretty `^13.1.3` | |
| Push | expo-notifications `~0.32.17` | |
| Test runner (node) | **`node --test`** with Node's native TS type-stripping — no ts-node/vitest/jest for these | built-in |
| Test runner (native) | jest `^29.7.0` + jest-expo `~54.0.17` + @testing-library/react-native `^14.0.1` | |
| Test runner (e2e) | @playwright/test `^1.62.1` | |
| Bundler (client) | Metro (via Expo) — `metro.config.js` | |
| Bundler (server) | **esbuild** invoked by `npm run server:build` (esbuild is *not* a declared dependency — it comes in transitively) | |
| Compiler plugin | babel-plugin-react-compiler `^19.0.0-beta-e993439-20250117` | pinned to a beta |
| Patching | patch-package `^8.0.0` + `patches/` + `postinstall` hook | |

**Unusual / pinned oddly:**
- `babel-plugin-react-compiler` is a **dated beta** (`19.0.0-beta-e993439-20250117`).
  CLAUDE.md's "Known Pitfalls" already flags React Compiler miscompiling `useEffect`.
- **Node version split**: CI pins `node-version: 24` (`.github/workflows/ci.yml:52`),
  `.replit` declares `modules = ["nodejs-22", ...]`. Production runs 22, CI tests on 24.
  `node --test` TS stripping is stable from 22.6, so both work, but they are not identical.
- **esbuild is used in a build script but is not in `package.json` dependencies or
  devDependencies** — `server:build` relies on it resolving transitively.
- `test-renderer": "^1.2.0"` is a devDependency — an unrelated npm package name, worth a
  supply-chain look (C2).
- Every `expo-*` package uses `~` (Expo-managed), the rest use `^`. `@react-native-async-storage/async-storage`,
  `@react-native-community/netinfo`, `@react-native-masked-view/masked-view`, `react-native-svg`,
  `react-native-worklets`, `react`, `react-dom`, `react-native` are **exact-pinned** (no range).

---

## 3. Deploy target

**Production is Replit Cloud Run.** From `.replit`:

```
[deployment]
deploymentTarget = "cloudrun"
build = ["sh","-c","npm run expo:static:build && npm run expo:web:build && npm run server:build"]
run  = ["npm","run","server:prod"]
```

- Build chain: `scripts/build.js` (563 lines) → `npx expo export --platform web` →
  `esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=server_dist`
- Run: `NODE_ENV=production node server_dist/index.js`
- Ports (`.replit`): local 5000 → external 5000 (Express), local 8081 → external 80 (Metro dev),
  local 8082 → external 3001. `[env] PORT = "5000"`.
- Dev Run button: workflow `Project` → `Start App` → parallel `npm run server:dev` (waits port 5000)
  and `npm run expo:dev` (waits port 8081, `ensurePreviewReachable = "/status"`).
- Nix channel `stable-24_05`, extra packages `dig`, `q`. Modules: `nodejs-22`, `javascript`, `postgresql-16`.
- **There is no Dockerfile, no vercel/fly/netlify/render config.** Verified by directory listing.
- `eas.json` exists (EAS build profiles) but the EAS workflow is `workflow_dispatch` only and
  **never submits** — `.github/workflows/eas-build.yml:3-6` states the submit credentials
  (`appleId`/`ascAppId`/`serviceAccountKeyPath`) are still placeholders.

**Env vars required:** `DATABASE_URL`, `SESSION_SECRET`, `PORT` (fail-fast check in
`server/index.ts` — see §5). CI supplies `DATABASE_URL` + `SESSION_SECRET`
(`.github/workflows/ci.yml:37-40`).

---

## 4. Directory tree

| Directory | Purpose |
|---|---|
| `app/` | Expo Router file-based routes. Offline/menu screens: `index.tsx` (title), `lobby.tsx`, `game.tsx`, `result.tsx`, `rules.tsx`, `tutorial.tsx`, `auth.tsx`, `_layout.tsx`, `+not-found.tsx`, `+native-intent.tsx` |
| `app/(online)/` | Online multiplayer route group: `_layout.tsx`, `index.tsx` (lobby), `room.tsx`, `game.tsx`, `friends.tsx`, `profile.tsx`, `quickmatch.tsx`, `leaderboard.tsx`, `replay.tsx` |
| `components/` | 19 files. `GameTable.tsx` (1388 L) + `GameShared.tsx` (1329 L) + `CardView.tsx` (689 L) are the table; `gameTableModel.ts`, `cardFaceModel.ts`, `handLayout.ts` are their pure halves; `MenuLayout`/`MenuCard`/`MenuButton` the menu kit; `ErrorBoundary`/`ErrorFallback`, `NotificationBanner`, `OfflineBanner`, `SettingsModal`, `ExchangeModal`, `ExchangeAnnouncement`, `ResultExchangeOverlay`, `GameOverOverlay`, `ReactionLayer` |
| `context/` | 7 React contexts: `AuthContext`, `GameContext` (offline), `OnlineGameContext`, `SocketContext`, `SettingsContext`, `NotificationContext`, `InviteContext` |
| `lib/` | 18 modules: `gameEngine.ts` (1274 L, all rules + AI), `socket.ts` (singleton), `theme.ts`/`tokens.ts`, `i18n.ts`, `sounds.ts`, `haptics.ts`, `accessibility.ts`, `achievements.ts`, `botPersonalities.ts`, `cardNames.ts`, `cosmetics.ts`, `offlineSave.ts`, `pushRegistration.ts`, `query-client.ts`, `rating.ts`, `replay.ts`, `sharedGameFlow.ts`, `streak.ts` |
| `server/` | 22 files. Express + Socket.io. `socket.ts` (2272 L) is the largest file in the repo |
| `server/templates/` | `landing-page.html` (Expo Go QR page, served when no web build exists) |
| `shared/` | `schema.ts` only — Drizzle table definitions |
| `locales/` | `it.ts` (778 L, source of truth), `en.ts` (761 L), `sq.ts` (790 L) |
| `tests/` | 45 `node --test` files at top level |
| `tests/integration/` | 11 files needing a live Postgres (self-skip without `DATABASE_URL`) |
| `tests/native/` | 10 jest-expo `.tsx` suites (run twice: ios + android projects) |
| `tests/e2e/` | 6 Playwright specs + `fixtures.ts`, `helpers/`, `playwright.config.ts` |
| `tests/helpers/` | `testServer.ts`, `client.ts`, `gameDriver.ts` — the integration harness |
| `scripts/` | `build.js` (563 L, Expo static build), `build-sounds.mjs`, `build-court-art.mjs`, `bundle-report.mjs`, `dev-stack.mjs`, `e2e-server.mjs`, `reset-db.mjs` |
| `docs/` | `ARCHITECTURE.md`, `BACKLOG.md`, `BRIEF.md`, `BUNDLE.md`, `HANDOFF.md`, `RULES.md`, `TESTING.md`, `murlan-audit-prompt.md` (untracked), `superpowers/specs/2026-08-16-tournaments-design.md` |
| `assets/` | `images/` (icons, splash, `cards/`), `sounds/` (12 wav + README) |
| `patches/` | `expo-asset+12.0.13.patch` (applied by `postinstall`) |
| `.maestro/` | `smoke.yaml`, `offline-game.yaml` — Android UI flows (manual CI only) |
| `.github/workflows/` | `ci.yml`, `eas-build.yml`, `maestro.yml` |
| `graphify-out/` | Knowledge graph artefacts (`graph.json`, `graph.html`, `GRAPH_REPORT.md`, `manifest.json`, `.graphify_labels.json` tracked; `cache/` and dated snapshots gitignored) |
| `.claude/`, `.agents/`, `.superpowers/` | Agent/skill tooling, not shipped code. `.superpowers/` is gitignored |
| `dist/`, `static-build/`, `server_dist/`, `.expo/`, `node_modules/` | Generated, gitignored |

---

## 5. Entry points

| What | File:line |
|---|---|
| **Server process entry** | `server/index.ts:1-4` — fail-fast env check for `SESSION_SECRET`, `DATABASE_URL` before any import; `server/index.ts:19-27` binds `process.env.PORT` or 5000, `reusePort` only on linux (`:24`) |
| **App factory** (the real wiring) | `server/testApp.ts:180` `createApp()`. Order: trust proxy `:186`, `installProcessGuards()` `:190`, helmet `:192`, pino-http `:199`, CORS `:206`, body parsing `:207`, `await ensureSchema(pool)` `:211`, session `:213`, `/health` `:215`, static/SPA `:230`, `registerRoutes` `:232`, `setupSocket` `:234` (dynamic `import("./socket.ts")`), error handler `:237` |
| **REST routes** | `server/routes.ts:108` `registerRoutes(app)`; creates the `http.Server` at `:445` |
| **Socket.io** | `server/socket.ts:1004` `setupSocket(httpServer)`; connection handler `server/socket.ts:1051` |
| **Schema DDL** | `server/schemaDdl.ts` `ensureSchema()` — the only table creator |
| **Client entry** | `package.json` `"main": "expo-router/entry"` then `app/_layout.tsx` (root layout, provider stack) |
| **Client route tree** | `app/index.tsx` (title screen), `app/(online)/_layout.tsx` |
| **Web build** | `npx expo export --platform web` produces `dist/`, served by `server/testApp.ts:119-127` |
| **Server bundle** | `esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=server_dist` (`package.json` `server:build`) |
| **Expo static build** | `scripts/build.js` (563 L) via `npm run expo:static:build` |
| **Dev stack (local)** | `scripts/dev-stack.mjs` |
| **E2E server** | `scripts/e2e-server.mjs` |
| **Test app boot** | `tests/helpers/testServer.ts` calls the same `createApp()` |

---

## 6. The game loop

### Online path

| Hop | File:line |
|---|---|
| 1. Card tap selects | `components/GameTable.tsx:809` `handleCardPress` then `onSelectCard(id)` |
| 2. Client pre-validates the selection | `components/GameTable.tsx:473` `buildCombination(selectedObjs)`, `:479` `canPlay(...)`, `:484` `playBtnValid = isValidPlay && isMyTurn && !isFinished` |
| 3. "Gioca" press | `components/GameTable.tsx:1082` `onPress={playBtnValid ? handlePlay : undefined}` then `:815` `handlePlay()` then `onPlay(selectedIds)` |
| 4. Screen adapter | `app/(online)/game.tsx:178` `handlePlay(cardIds)` then `:182` `playCards(cardIds)` |
| 5. Context emits | `context/OnlineGameContext.tsx:580-581` `socket.emit("game:play", { cardIds })` |
| 6. Server boundary | `server/socketSafety.ts:110` `onEvent` wrapper — rate limit, then `GamePlaySchema.safeParse`, then handler, all inside try/catch |
| 7. Server handler | `server/socket.ts:1391-1465` `game:play`. Room lookup `:1396`, gameOver guard `:1399`, exchange-pending guard `:1405`, seat authority `:1414` (`if (playerMap[currentIdx] !== userId) return;`), card-ownership filter `:1418-1420` (`cards.length !== unique.length` then silent return), `buildCombination` `:1422`, start-card rule `:1430-1440`, `canPlay` `:1443`, achievement flags `:1450`, `processPlay` `:1452` |
| 8. Engine mutation | `lib/gameEngine.ts` `processPlay(gameState, combo)` returns a new state |
| 9. Replay log | `server/socket.ts:1453` `appendReplayMove(game, currentIdx, combo, newState)` (in-memory only) |
| 10. Broadcast | `server/socket.ts:1456` `broadcastGameState(io, game)` then `server/socket.ts:388-403`, per-user `sanitizeStateForPlayer` (`:240-267`) — every non-viewer hand replaced with `[]` plus `handCount` |
| 11. Persist | `server/socket.ts:1457` `persistGameState(roomId, game)` then `:344-386` upsert into `active_games` keyed on `roomCode`. Not awaited; failure only logs (`:383-385`) |
| 12. Game over / next turn | `server/socket.ts:1459-1463` — `handleGameOver(io, roomId, game)` (`:732`) or `armTurn(roomId)` (`:526`) |
| 13. Client applies | `context/OnlineGameContext.tsx:440` `socket.on("game:state", onGameState)` then `:234` handler then `:274` `setGameState(state)` |
| 14. Render | `app/(online)/game.tsx` maps context state into `GameTable` |

Bot / AFK-forced moves take the same mutation path but bypass steps 1-6:
`armTurn` `server/socket.ts:526` → `runBotTurn` `:552` / `startAfkTimer` `:612` → `handleAutoPass` `:589` → `autoMoveForSeat` `:454`.

### Offline / AI path

| Hop | File:line |
|---|---|
| 1-3. Same UI | `components/GameTable.tsx:809`/`:815`, `onPlay` |
| 4. Screen adapter | `app/game.tsx:120` `onPlay={playSelected}`, `:121` `onPass={passTurn}` |
| 5. Validate and mutate **in the client** | `context/GameContext.tsx:334-357` `playSelected()` — `buildCombination` `:340`, `canPlay` `:344`, start-card `:347-352`, then `commitState(processPlay(gameState, combo), gameState)` `:355` |
| 6. Single write path | `context/GameContext.tsx:208-212` `commitState` — sets state and, on the manche ending, folds the score into the match via `applyHandToMatch`. Comment at `:203-207` states this is deliberately the only scoring site |
| 7. AI turn | `context/GameContext.tsx:370-411` `runAITurn()` — `aiChoosePlay` `:384`; if no play and it is a new round, leads the lowest card `:403-409` (explicit anti-freeze branch) |
| 8. Persist | `AsyncStorage` under `OFFLINE_SAVE_KEY` (`lib/offlineSave.ts`), cleared by `clearSavedGame` `context/GameContext.tsx:413-417` |
| 9. Broadcast | none — same process |

**There is no server in the offline path at all.** All rule enforcement is client-side by
construction, which is correct for a single-device game but means a rule bug there is
invisible to the socket/integration tests, and vice versa.

---

## 7. Client/server trust boundary

**Server owns authoritatively:** seat-to-user mapping (`playerMap`), turn order, hand
contents, combination legality, the start-card rule, the exchange phase, scores, match
target/length, rematch votes, room membership, AFK and disconnect timers, replay writes,
ratings, stats.

**Client computes for UI only:** which cards are selectable, whether the Gioca button lights
up, sort order, animation timing.

### Duplicated logic (divergence risk)

| Function | Server | Client |
|---|---|---|
| `buildCombination` | `server/socket.ts:1422` | `components/GameTable.tsx:473`, `context/GameContext.tsx:340`, `app/tutorial.tsx:323` |
| `canPlay` | `server/socket.ts:1443` | `components/GameTable.tsx:479`, `context/GameContext.tsx:344`, `app/tutorial.tsx:338` |
| start-card rule | `server/socket.ts:1430-1440` | `context/GameContext.tsx:347-352` (offline) **and `components/GameTable.tsx:476-481`** — see correction below |
| `getValidGivebackCards` | `server/socket.ts` (imported at `:57`) | `components/ExchangeModal.tsx:139`, `components/ResultExchangeOverlay.tsx:71`, `app/tutorial.tsx:368` |
| `cardStrength` | engine | `components/ExchangeModal.tsx:140` |

All of these import the *same* `lib/gameEngine.ts`, so numeric divergence is impossible
today. The real risk is structural: `context/GameContext.tsx` is the sole authority offline
while `server/socket.ts` is the sole authority online, and only the online one is covered by
the socket/integration tests.

> **CORRECTION (orchestrator, Phase 2).** The row above originally read "`GameTable` does
> *not* re-check" the start-card rule. **That was wrong.** `components/GameTable.tsx:476-481`
> does enforce it:
> ```ts
> const requiresStartCard = !gameState.firstPlayMade && !!gameState.startCard;
> const isValidPlay = tentativeCombo !== null && canPlay(…) &&
>   (!requiresStartCard || tentativeCombo.cards.some((c) => c.id === gameState.startCard!.id));
> ```
> Specialist A2 caught the error and independently confirmed `startCard` survives server-side
> sanitisation, so it is populated on the client when it matters. **There is no
> lit-button-then-silent-rejection path on the opening turn.** Verified by the orchestrator by
> reading the file. Any finding built on the original claim is void; A2 and B3 were both
> corrected mid-run.

### Socket events — server inbound (all via `onEvent`: zod-validated, per-user rate-limited, try/caught)

| Event | file:line | Payload schema | Validates |
|---|---|---|---|
| `room:create` | `server/socket.ts:1070` | `RoomCreateSchema` | yes |
| `room:spectate` | `:1095` | `RoomSpectateSchema` | yes |
| `room:unspectate` | `:1138` | `NoPayloadSchema` | yes |
| `room:join` | `:1153` | `RoomJoinSchema` | yes |
| `room:leave` | `:1186` | `NoPayloadSchema` | yes |
| `room:quickmatch` | `:1201` | `RoomQuickmatchSchema` | yes |
| `room:set_game_mode` | `:1266` | `RoomSetGameModeSchema` | yes |
| `room:start` | `:1293` | `RoomStartSchema` | yes |
| `game:play` | `:1391` | `GamePlaySchema` | yes |
| `game:pass` | `:1469` | `NoPayloadSchema` | yes |
| `game:rematch_intent` | `:1506` | `GameRematchIntentSchema` | yes |
| `game:rematch_vote` | `:1523` | `NoPayloadSchema` | yes |
| `game:rejoin` | `:1601` | `GameRejoinSchema` | yes |
| `game:reaction` | `:1750` | `GameReactionSchema` | yes |
| `game:exchange_give_card` | `:1773` | `GameExchangeGiveCardSchema` | yes |
| `friend:invite` | `:1803` | `FriendInviteSchema` | yes |
| `friend:get_online_list` | `:1836` | `NoPayloadSchema` | yes |
| `disconnect` | `:1892` (bare `socket.on`) | n/a | n/a |

Schemas live in `server/socketSchemas.ts` (13 exported schemas, lines 18-93).
**Every inbound event goes through `onEvent`** — verified by grepping `socket.on(` in
`server/socket.ts`: the only bare registration is `disconnect` at `:1892`.

### Socket events — server outbound

`room:state` (`:1082,:1181,:1260,:1288,:2022`), `room:error` (`:1102,:1107,:1113,:1125,:1160,:1164,:1170,:1278,:1312`),
`room:player_left` (`:2224`), `game:state` (`:393`), `game:error` (`:1407,:1425,:1435,:1445,:1481,:1491,:1789`),
`game:notification` (`:567,:623,:682`), `game:started` (`:1372,:1588`), `game:match_state` (`:1373,:1589`),
`game:over` (`:820`), `game:match_over` (`:833`), `game:vote_state` (`:668,:1540`),
`game:rematch_intents` (`:995`), `game:reaction` (`:1762`), `game:player_left` (`:667,:681`),
`game:seat_bot_takeover` (`:697`), `game:player_disconnected` (`:1930`), `game:player_reconnected` (`:1642,:1733,:1868`),
`game:rejoin_failed` (`:1615,:1658,:1672,:1683,:1744`), `friend:invite` (`:1828`), `friend:online_list` (`:1845,:1885`),
`friend:status` (`:2245,:2265`), `friend:error` (`:1813`), `friend:request_incoming` (`server/routes.ts:294`),
`friend:request_accepted` (`server/routes.ts:328`), plus `socket:error` from `server/socketSafety.ts:78`.

**Two server-emitted events have no client listener** (grepped `app/ components/ context/ lib/`):
- `game:match_over` — `server/socket.ts:833`
- `room:player_left` — `server/socket.ts:2224`

Client listeners: `context/OnlineGameContext.tsx:436-453` (18) and
`context/SocketContext.tsx:224-233` (10). Client emits:
`context/OnlineGameContext.tsx:184,190,490,497,503,513,516,540,544,552,556,560,564,581,585,589,597`;
`context/SocketContext.tsx:114,174,237`; `app/(online)/friends.tsx:221`; `app/(online)/room.tsx:214,227`.

### REST routes — `server/routes.ts`

| Method | Path | line | Auth | Validation |
|---|---|---|---|---|
| POST | `/api/auth/register` | 112 | none | `RegisterSchema` + `authLimiter` (20/15min) |
| POST | `/api/auth/login` | 142 | none | `LoginSchema` + `authLimiter` |
| POST | `/api/auth/logout` | 169 | none | none needed |
| POST | `/api/push/token` | 178 | `requireAuth` | `PushTokenSchema` + `pushLimiter` (10/min, keyed by userId) |
| DELETE | `/api/push/token` | 184 | `requireAuth` | `PushTokenSchema` + `pushLimiter` |
| GET | `/api/auth/me` | 189 | inline session check | n/a |
| POST | `/api/auth/socket-ticket` | 204 | `requireAuth` | `ticketLimiter` (60/min) |
| DELETE | `/api/users/me` | 211 | `requireAuth` | **no limiter** |
| GET | `/api/friends` | 226 | `requireAuth` | n/a |
| GET | `/api/friends/requests` | 235 | `requireAuth` | n/a |
| GET | `/api/users/search` | 243 | `requireAuth` | inline zod on `req.query.username` |
| GET | `/api/friends/sent` | 257 | `requireAuth` | n/a |
| POST | `/api/friends/add` | 265 | `requireAuth` | `AddFriendSchema` + `friendLimiter` (10/min) |
| DELETE | `/api/friends/requests/:id` | 302 | `requireAuth` | `readParam`, ownership scoped in storage |
| POST | `/api/friends/accept/:id` | 314 | `requireAuth` | `readParam`, IDOR-scoped to recipient |
| POST | `/api/friends/decline/:id` | 342 | `requireAuth` | `readParam`, IDOR-scoped to recipient |
| DELETE | `/api/friends/:friendUserId` | 355 | `requireAuth` | `readParam` |
| GET | `/api/stats/me` | 364 | `requireAuth` | n/a |
| GET | `/api/stats/history` | 369 | `requireAuth` | n/a |
| GET | `/api/ratings/me` | 379 | `requireAuth` | n/a |
| GET | `/api/ratings/leaderboard` | 383 | `requireAuth` | n/a |
| GET | `/api/replays` | 392 | `requireAuth` | scoped to caller's seats |
| GET | `/api/replays/:id` | 396 | `requireAuth` | `readParam`, scoped |
| POST | `/api/client-errors` | 417 | `requireAuth` | `ClientErrorSchema` + `errorReportLimiter` (5/min) |
| GET | `/api/stats/achievements` | 440 | `requireAuth` | n/a |
| GET | `/health` | `server/testApp.ts:215` | none | n/a |

`DELETE /api/users/me` (`server/routes.ts:211`) is the only mutating authenticated route with
no rate limiter. Error bodies are sanitised for 5xx at `server/testApp.ts:154-159`.

---

## 8. State management

Root provider stack, `app/_layout.tsx:80-96` (outermost first):
`SettingsProvider` → `QueryClientProvider` → `SafeAreaProvider` → `GestureHandlerRootView` →
`NotificationProvider` → `AuthProvider` → `SocketProvider` → `GameProvider`.
`OnlineGameProvider` is **not** in the root stack — it is mounted per-route-group at
`app/(online)/_layout.tsx:21`, keyed by `user.id`, behind an auth redirect (`:18`).

| Store | File | Owns | Source of truth | Sync |
|---|---|---|---|---|
| `SettingsContext` | `context/SettingsContext.tsx` | sound on/off + volume, haptics, animation amount, language, card back, table felt | device (AsyncStorage) | pushes cosmetics into the `lib/cosmetics.ts` module store so consumers avoid pulling expo-audio in |
| `AuthContext` | `context/AuthContext.tsx` | `user`, `loading`, login/register/logout | **server** (`/api/auth/me`, session cookie) | REST |
| `SocketContext` | `context/SocketContext.tsx` | socket lifecycle, `connected`, `onlineIds`, friend events, `pendingInvite`, `gameInvites` | server | socket.io; listeners `:224-233` |
| `NotificationContext` | `context/NotificationContext.tsx` | banner queue | local | — |
| `GameContext` | `context/GameContext.tsx` (544 L) | **the entire offline game**: `gameState`, `selectedCards`, `match`, `rematchAnswers`, saved configs, `hasSavedGame`, exchange announcement | **the client itself** | AsyncStorage (`lib/offlineSave.ts`); single write path `commitState` `:208-212` |
| `OnlineGameContext` | `context/OnlineGameContext.tsx` (656 L) | `room`, `gameState`, `mySeatIndex`, `matchState`, `cumulativeScores`, `rematchVoteState`, `rematchIntents`, `disconnectedPlayers`, `isSpectator`, `reactions`, errors | **the server** — every field is a mirror of a broadcast | socket.io; 22 `useState` at `:130-166`; listeners `:436-453` |
| `InviteContext` | `context/InviteContext.tsx` | nothing — 2-line re-export of `useSocket as useInvite` | — | **imported by no file in the repo** (see §14) |
| react-query | `lib/query-client.ts` | REST caches (stats, ratings, replays, friends) | server | HTTP |

Client socket singleton: `lib/socket.ts:4` `const socketMap = new Map<string, Socket>()`;
`connectSocket` `:45` returns the existing socket for a userId; auth is a per-attempt ticket
callback `:53-55` so every reconnect mints a fresh single-use ticket.

Rejoin state: `context/OnlineGameContext.tsx:179-192` `attemptRejoin()` — uses the in-memory
room if a game is live, otherwise the `ACTIVE_ROOM_KEY` value from AsyncStorage (cold start).

---

## 9. Data model

All tables from `shared/schema.ts`. Two enums: `room_status` (`waiting|in_progress|finished`,
`:15`) and `game_mode_type` (`free_for_all|teams`, `:16`); plus `friend_status`
(`pending|accepted`, `:54`).

| Table | line | Columns | Purpose |
|---|---|---|---|
| `users` | 6 | `id` (uuid pk), `username` (unique), `password` (bcrypt hash), `friend_code` (varchar 6, unique), `created_at`, `last_seen` | accounts |
| `rooms` | 18 | `id`, `code` (varchar 6, unique), `host_user_id`→users, `status`, `game_mode`, `max_players`, `created_at`; idx on host + status | lobby rooms |
| `room_players` | 35 | `id`, `room_id`→rooms, `user_id`→users, `seat_index`, `team` (varchar 1); idx on room/user; **unique (room,user)** and **unique (room,seat)** `:49-50` | seat claims; the unique indexes are what make simultaneous joins collide instead of sharing a seat |
| `friends` | 56 | `id`, `user_id`→users, `friend_user_id`→users, `status`, `created_at`; idx both directions | friendships + pending requests |
| `active_games` | 71 | `room_code` (text **pk**), `game_state` jsonb, `player_ids` jsonb, `player_map` jsonb, `scores` jsonb, `is_public` bool, `max_players`, `game_mode` text, `match_target` int, `match_length` text, `updated_at` | the live game envelope, rewritten on every move. Note `game_mode` here is plain `text`, not the enum |
| `user_stats` | 90 | `user_id` pk→users **cascade**, `games_played`, `games_won`, `matches_won`, `current_streak`, `best_streak`, `bombs_played`, `updated_at` | lifetime stats |
| `match_history` | 101 | `id`, `user_id`→users cascade, `finished_at`, `game_mode`, `placement`, `player_count`, `points`, `opponents` jsonb; idx (user, finished_at) | per-hand history, pruned to 50 rows (see `tests/historyBound.test.ts`) |
| `user_achievements` | 112 | pk (`user_id`, `achievement_id`), `unlocked_at` | achievements |
| `match_replays` | 121 | `id`, `room_code`, `finished_at`, `game_mode`, `player_ids` jsonb, `seats` jsonb, `moves` jsonb, `rankings` jsonb; idx finished_at | one finished manche; holds no hand |
| `user_ratings` | 136 | pk (`user_id`, `season`), `rating`, `games`, `updated_at`; idx (season, rating) | ladder, one row per player per season |
| `push_tokens` | 156 | `token` text **pk**, `user_id`→users cascade, `platform`, `updated_at`; idx user | one row per notification-enabled device |
| `session` | **not in `shared/schema.ts`** | connect-pg-simple's shape | created by `server/schemaDdl.ts:223-228` because nothing else can |

**DDL owner:** `server/schemaDdl.ts` — derives idempotent, additive DDL from the drizzle
schema (`schemaStatements()` `:245`, `generateSchemaDdl()` `:326`, `ensureSchema()` `:340`),
run once at `server/testApp.ts:211` before the session middleware.
It refuses to emit anything destructive and throws rather than guess on unsupported
defaults (`:37-45`, `:52-58`, `:70-75`).

**No `migrations/` directory exists** even though `drizzle.config.ts:8` sets
`out: "./migrations"` — `drizzle-kit push` is the only drizzle path, and it is reserved for
destructive reconciliation.

`drizzle.config.ts:22` `tablesFilter: ["!session"]` keeps drizzle-kit from ever asking
whether a new table is a rename of `session`.

**Nothing else creates a table** — confirmed: no `CREATE TABLE` anywhere outside
`server/schemaDdl.ts` and the test harness's schema-scoping.

---

## 10. Realtime layer

**Transport:** socket.io 4.8.3, `transports: ["websocket", "polling"]`,
`maxHttpBufferSize: 1e5` (100 KB) — `server/socket.ts:1005-1017`.
CORS mirrors the Express allowlist via `isAllowedOrigin` (`server/socket.ts:1011`,
`server/cors.ts`).

**Handshake auth** (`server/socket.ts:1021-1049`): session middleware injected at `:1021`,
then a second `io.use` that accepts *only* `req.session.userId` **or**
`consumeSocketTicket(socket.handshake.auth?.ticket)` (`:1035`). No bare `userId` branch.
Covered by `tests/integration/auth.test.ts` ("a bare userId is rejected — this was a full
impersonation vector", "a ticket cannot be replayed", "a forged ticket is rejected").

**Listener-before-await invariant:** `server/socket.ts:1057-1066` documents it; every
`onEvent` registration `:1070`-`:1856` is synchronous, and the first `await` is at `:1859`
(the reconnect-notice/friends-list block). Pinned by `tests/socketEvents.test.ts` ("no
inbound socket event bypasses onEvent") and by the integration test "an event emitted on the
client's own connect handler is not dropped" (`tests/integration/gameplay.test.ts`).

**Event names:** see §7 for the full inbound (18) and outbound (~27) lists with line numbers.

**Room lifecycle**

| Phase | file:line |
|---|---|
| create | `server/socket.ts:1070` `room:create` → `storage.createRoom` → `addRoomPlayer(seat 0)` → `socket.join(room.id)` → `socketRoomMap.set` |
| join | `:1153` `room:join` — `status !== "waiting"` rejected `:1163`, seat claimed atomically via `storage.claimRoomSeat` `:1166` |
| quickmatch | `:1201` — matched against the in-memory `publicRoomIds` Set (`:132`) |
| set mode | `:1266` `room:set_game_mode` |
| start | `:1293` `room:start` — min 2 players `:1311`, deals, emits `game:started` `:1372` + `game:match_state` `:1373` |
| play | `:1391` / `:1469` (see §6) |
| exchange | `:1773` `game:exchange_give_card` |
| hand end | `handleGameOver` `:732` → `game:over` `:820`, `game:match_over` `:833` |
| rematch | `:1506` intent, `:1523` unanimous vote gate |
| leave | `:1186` `room:leave` → `handleLeaveRoom` `:2153`; lobby variant `handleLeaveRoom_lobby` `:2196` |
| seat vacated | `vacateSeat` `:643` → `game:seat_bot_takeover` `:697` |
| dispose | `disposeGame` `:327` — clears timers, drops from `activeGames`/`publicRoomIds`, deletes the `active_games` row |
| sweeper | `startSweeper` `:2115`, every `SWEEP_INTERVAL_MS = 5min` (`:159`); `pruneAbandonedGames` `:2062` (rows older than `ABANDONED_GAME_MAX_AGE_MS` = 24h, `:178`), `pruneStaleRooms` `:2085` (`STALE_ROOM_MAX_AGE_MS` = 24h `:189`, `STALE_ROOM_BATCH` = 500 `:192`) |

**Timers** — all three are env-overridable via `timeoutFromEnv` (`server/socket.ts:146-156`):

| Timer | Constant | Default | file:line |
|---|---|---|---|
| AFK auto-pass | `AFK_TIMEOUT_MS` / `MURLAN_AFK_TIMEOUT_MS` | 30 s | `:153`; armed `startAfkTimer` `:612`; fires `handleAutoPass` `:589` → `autoMoveForSeat` `:454` |
| Disconnect grace | `DISCONNECT_GRACE_MS` / `MURLAN_DISCONNECT_GRACE_MS` | 60 s | `:154`; armed in the disconnect handler `:1949-1968` |
| Bot move pacing | `BOT_MOVE_DELAY_MS` / `MURLAN_BOT_MOVE_DELAY_MS` | 1.2 s | `:158`; armed in `armTurn` `:539` |

Timer maps `afkTimers` / `disconnectTimers` / `botTimers` at `:136-138`; cleanup helpers
`clearAfkTimer` `:272`, `clearRoomAfkTimers` `:281`, `clearBotTimer` `:291`,
`clearRoomTimers` `:299`, `clearAllTimersForUser` `:304`, `clearRoomDisconnectTimers` `:316`.

**Disconnect path** (`server/socket.ts:1892-1974`): spectator dropped `:1897-1901`;
`userSocketMap` blanked only if it still points at *this* socket `:1904`; `updateLastSeen`;
`friend:status` offline; if no room → return; **if still connected elsewhere → return
`:1918`**; if no live game → `handleLeaveRoom_lobby`; else emit `game:player_disconnected`
`:1930` with the grace seconds derived from the constant, **`armTurn(currentRoomId)` `:1944`
so the table does not stall**, then arm the grace timer `:1952` which calls
`storage.removeRoomPlayer` + `vacateSeat`.

**Reconnect path:** client `socket.io` reconnects with `reconnectionAttempts: Infinity`
(`lib/socket.ts:60`), mints a fresh ticket per attempt (`:53-55`), then
`context/OnlineGameContext.tsx:179-192` emits `game:rejoin`. Server handler
`server/socket.ts:1601-1748` — five distinct `game:rejoin_failed` reasons
(`:1615 UNAUTHORIZED`, `:1658 GAME_NOT_FOUND`, `:1672 GAME_NO_LONGER_VALID`,
`:1683 UNAUTHORIZED`, `:1744 SERVER_ERROR`) and `game:player_reconnected` on success
(`:1642`, `:1733`).

---

## 11. Test inventory

**How to run:**
- `npm test` → `node --test "tests/**/*.test.ts"` (native TS type-stripping, Node ≥22.6). 4 s.
- `npm run test:native` → `jest` (two projects: `ios`, `android`; `tests/native/**/*.test.tsx`). 21 s.
- `npm run test:e2e` → `playwright test --config tests/e2e/playwright.config.ts`. Builds the web bundle, boots `scripts/e2e-server.mjs`, needs Docker/Postgres.
- `npm run verify` → typecheck + test + test:native. **Does not include lint or e2e.**
- `maestro test .maestro/` — Android emulator flows, manual only.

### `tests/*.test.ts` — 45 files, all pure/unit

| File | What it actually asserts |
|---|---|
| `achievements.test.ts` | first_win / purist unlock rules; **every achievement has translation keys in all catalogues**; every achievement is reachable by some constructible `GameResult` |
| `botFill.test.ts` | empty seats fill with bots to `maxPlayers`; duplicate personalities get distinguishable names; bot seats excluded from match scoring; a lone human + bots is not recordable |
| `botPersonalities.test.ts` | personalities differ behaviourally (not just by name); aggression decides contesting and premium-card spending; unknown personality → default; `botSeatNames` numbers only repeats |
| `cardFace.test.ts` | pip counts per rank; nothing collides with the corner index; pips do not collide; the pip field stays inside the card |
| `cardNames.test.ts` | `cardSpokenName`, `rankSpokenName`, `suitSpokenName` across locales |
| `combinations.test.ts` | card strength order; combination typing; combination strength; `canPlay` beat hierarchy (16 cases) |
| `contrast.test.ts` | WCAG contrast ratios for `dangerDim`, `textMuted` on felt, `white` on `danger` |
| `cors.test.ts` | `isAllowedOrigin` allow/deny |
| `cosmetics.test.ts` | no alternate felt is lighter than default at any stop; darkest stop ≤ `Colors.felt`; every felt has exactly five stops; card backs are visually distinct; every back prints on a real felt palette |
| `dbPush.test.ts` | `drizzle.config.ts` excludes `session`; the schema does not describe `session`; the store still has `createTableIfMissing: false` |
| `dbResetGuard.test.ts` | the reset script refuses without `ALLOW_DESTRUCTIVE=1` **and** `--yes` |
| `deal.test.ts` | deck composition; whole deck goes out; `findStartingPlayer` |
| `enumerator.property.test.ts` | property tests over the combination enumerator |
| `exchange.test.ts` | `getValidGivebackCards`; `processExchangeChoice`; hand-to-hand setup |
| `exchangeVisibility.test.ts` | `visibleExchangePhase` blanks `cardFromLoser` for non-participants |
| `flow.test.ts` | `processPlay`; leader may not pass; round-end threshold |
| `gameTableModel.test.ts` | **62 cases**, the largest unit file. Pins `CARD_W/CARD_H/SIDE_BTN_W/TABLE_M/HAND_SECTION_H` ("MUST NOT CHANGE"), `getOpponentPosition`, `seatDirection`, `arrangeOpponents`, `handCountOf`, `comboKey` |
| `handLayout.test.ts` | `computeHandLayout` fan geometry |
| `historyBound.test.ts` | match history is pruned and stays bounded |
| `i18n.test.ts` | **locale key parity across it/en/sq**; no empty translations; pluralisation pairs; interpolation placeholders in sync; `interpolate()`; `translate()` output per locale |
| `motion.test.ts` | pickup has no wobble; land bounces exactly once; every spring settles; **no spring is written inline** |
| `offlineSave.test.ts` | save round-trip; a save from another version is discarded not migrated; unparseable → nothing; incomplete blob refused; running match resumable, finished not; a finished hand inside a running match is still resumable |
| `onlineGameLogic.test.ts` | `readPersistedPlayerMap` seat resolution on rejoin; `seatOfUser`/`findViewerSeat`; `excludeBotSeats`; `scoreKeyForSeat`; `isStaleSchema`/`GAME_SCHEMA_VERSION` |
| `orientation.test.ts` | every `<Modal>` declares `supportedOrientations` including landscape |
| `persistedEnvelope.test.ts` | the `game_state` envelope pack/unpack round-trip |
| `pushShape.test.ts` | one Expo message per device in token order; payload-less message still sends; only `DeviceNotRegistered` tokens dropped; other errors are not dead devices; mismatched response deletes nothing |
| `rating.test.ts` | Elo: even expectation sums to 1; duel is textbook; a table on one K conserves rating exactly; mixed records leak ≤ K spread; **seat order never changes the outcome**; placement orders the deltas |
| `reducedMotion.test.ts` | **every screen/component that animates reads the motion preference**; nothing loops forever without checking first |
| `replay.test.ts` | opening position; pile/counts per move; a pass leaves the pile; last index is the finished hand; out-of-range index clamped not thrown; **every hand is empty — a replay never reveals what anyone held** |
| `replayShape.test.ts` | player ids exclude bots; a bot-only replay belongs to nobody; seats from state + playerMap; play records combination + counts; pass records null; a log past the cap is dropped not truncated |
| `schemaDdl.test.ts` | **every statement is idempotent**; **no statement can destroy or rewrite data**; the `session` table is part of the bootstrap; columns added before indexes that target them; a table is created before anything references it |
| `scoring.test.ts` | `scoreHand`, `addHandScores`, `MATCH_TARGETS`/`nextMatchTarget`, `resolveMatch` |
| `serverLoadable.test.ts` | 11 server modules import cleanly under plain Node type-stripping (`logger, db, session, cors, validate, schemas, socketSchemas, socketSafety, ticket, storage, onlineGameLogic`). **Notably absent from that list: `socket.ts`, `routes.ts`, `testApp.ts`, `schemaDdl.ts`, `stats.ts`, `ratings.ts`, `replays.ts`, `push.ts`** |
| `smoke.test.ts` | harness + engine import; one enumerator regression |
| `socketEvents.test.ts` | **no inbound socket event bypasses `onEvent`** (source-scan); the registered set matches the expected set |
| `socketHandFlags.test.ts` | an AFK-forced lone-joker play sets `handFlags.joker`; an ordinary single leaves it empty |
| `socketRateLimit.test.ts` | `allowSocketAction` window behaviour |
| `soundAssets.test.ts` | the sound files exist and have the expected shape |
| `straights.test.ts` | straight legality (15 cases); enumeration completeness |
| `streak.test.ts` | `dailyStreak`; `utcDay` |
| `suitColours.test.ts` | suit ink distinguishable, including under simulated colour-vision deficiency |
| `teams.test.ts` | every seat gets a placement; match resolves on summed team total; escalation on a mutual reach; a draw names both pairs |
| `tokenRoles.test.ts` | **no fill/border/scrim token is used as a text or icon colour** (source-scan), and the scanner is proven to match a real use |
| `vignette.test.ts` | every vignette piece spans a full edge of the felt |

**Meta-tests worth calling out** (they scan source text rather than run code, so they are
only as good as their regexes, but each has a self-check case):
`tokenRoles.test.ts:70` ("the scanner actually matches a text colour use"),
`socketEvents.test.ts`, `reducedMotion.test.ts`, `motion.test.ts` ("no spring is written
inline"), `orientation.test.ts`, `tests/native/hapticsBypass.test.tsx` ("scans the whole UI
surface", "no module imports expo-haptics").

**No test asserts nothing.** I read every file's assertions; there is no empty or
always-true suite in the repo.

### `tests/integration/*.test.ts` — 11 files, all `skip` without `DATABASE_URL`

`abandonedGames` (row pruning), `auth` (**impersonation, ticket replay, forgery**),
`clientErrors` (auth required, size caps, rate limit), `gameplay` (**a player never receives
another player's hand**; play/pass rejected during an exchange; the connect-handler race),
`ladderAndReplay` (replay holds no hand; ratings cancel; **cannot read a stranger's replay**;
account deletion erases the player from others' replays), `pushTokens` (dedupe, per-device
logout, device cap, stranger cannot trigger a notification), `schemaBootstrap` (**fresh DB
usable on first boot; re-running changes nothing; an internal failure does not describe the
database**), `spectator` (**every hand hidden; a spectator cannot play or pass**), `stats`,
`teamsOnline` (partners opposite, nothing rated), `testServerCleanup`.

### `tests/native/*.test.tsx` — 10 files × 2 platforms = 18 suites, 230 tests

`a11yCollapse` (one accessible node per labelled control), `haptics` + `hapticsBypass`
(**no module imports expo-haptics directly**), `motionPreference` (on/off/system override),
`offlineResume` (a killed match comes back with its hand and its exchange), `render`
(NotificationBanner never unmounts), `resultExchange` (12 cases — giveback legality, a11y,
AI seats, the two-joker exception, the double-navigation bug), `sounds` (12 cases — silent
mode, volume scaling, player caching, release), `theme`.

### `tests/e2e/*.spec.ts` — 6 Playwright specs, chromium only, `workers: 1`, `retries: 0`

`offline.spec.ts` (a multi-hand match incl. the exchange), `offlineResume.spec.ts`,
`online.spec.ts` (host + bots; **two real browsers playing each other**; portrait phone room
creation), `reconnect.spec.ts` (a real network drop and return), `tableFit.spec.ts`
(parameterised viewport × player count), `tapTargets.spec.ts` (minimum touch target on
menus, table, lobby, profile/ladder).

### Covered vs. not

**Covered:** engine rules, scoring, teams, exchange, straights/bombs, i18n parity, design
tokens, contrast, motion, a11y node collapsing, sounds, haptics, offline save/resume, replay
shape and secrecy, ratings arithmetic, schema DDL idempotence, socket auth, hand secrecy,
spectators, rate limiting, room/seat claiming, abandoned-row pruning, tap targets, table fit.

**Not covered:**
- `server/socket.ts`'s 2272 lines have **no direct unit test** — only `__testables`
  (`:212-235`: `actingSeat`, `autoMoveForSeat`, `readPersistedPlayerMap`,
  `pruneAbandonedGames`, `pruneStaleRooms`) and the integration suites reach it.
- `handleGameOver` (`:732-945`, 213 lines — stats, ratings, replays, achievements,
  match resolution) has no unit test; only end-to-end coverage via `stats`/`ladderAndReplay`.
- `server/storage.ts` (475 L) has no dedicated test file.
- `scripts/build.js` (563 L) is untested.
- `components/GameTable.tsx` / `GameShared.tsx` (2717 L combined) are covered only through
  `gameTableModel.ts`'s pure half and the Playwright specs.
- No load/concurrency test on the socket layer.
- iOS UI automation does not exist (backlog Q12, owner-blocked O11).

---

## 12. Build / CI

**Scripts** (`package.json`): `postinstall` (patch-package), `expo:dev`, `server:dev`,
`expo:start:static:build`, `expo:static:build`, `expo:web:build`, `server:build`,
`server:prod`, `db:push`, `db:reset`, `start`, `lint`, `lint:fix`, `test`, `test:native`,
`test:e2e`, `typecheck`, `verify`.

**CI — `.github/workflows/ci.yml`**, on **every push and every pull_request**, Node 24,
Postgres 16 service:
1. `npm ci` (`:56`)
2. `npm run typecheck` (`:59`)
3. `npm test | tee test-output.txt` (`:62`)
4. **"Assert the integration suites actually ran"** (`:67-74`) — greps for `DATABASE_URL not set` and `exit 1`
5. `npm run lint` (`:77`)

**No `continue-on-error` anywhere in any workflow** — grepped all three files. Every step can
fail the job. This is a genuine improvement over the state CLAUDE.md warns about.

**What CI does NOT run:**
- `npm run test:native` (jest, 230 tests) — **absent from `ci.yml` entirely**
- `npm run test:e2e` (Playwright) — absent
- Maestro (`maestro.yml` is `workflow_dispatch` only, and its own header at `:5-15` says it has never run on a runner)
- `npm audit` / any dependency scan
- any build step — `expo:web:build` and `server:build` are **never exercised by CI**, so a break in the production build chain reaches Replit unnoticed

**`eas-build.yml`** — `workflow_dispatch` only, builds but never submits (credentials are
placeholders, `:3-6`).

**Deploy pipeline:** push to `main` → Replit Cloud Run deployment runs
`npm run expo:static:build && npm run expo:web:build && npm run server:build`, then
`npm run server:prod`. There is no GitHub-side deploy job; Replit is triggered from its own UI.

**Guard check (CLAUDE.md "no self-defeating safeguards"):**
`scripts/reset-db.mjs` requires **both** `ALLOW_DESTRUCTIVE=1` and `--yes` (`:26-42`), and
`package.json`'s `db:reset` is now `node scripts/reset-db.mjs && drizzle-kit push` — it does
**not** supply either. The bypass described in CLAUDE.md is fixed. Consequence:
`npm run db:reset` always fails at the guard, which is the intended behaviour but means the
script is a documentation stub rather than a runnable command.

---

## 13. Hot files — top 15 by recent churn

Window: **8 weeks** (`--since="8 weeks ago"`, 153 of 291 total commits — over half the repo's
history is in the window, so no widening was needed).
Counts below **exclude `graphify-out/`** (7 commits each, pure build artefacts) — the raw
`sort | uniq -c` including them is in the run notes.

| # | File | changes |
|---|---|---|
| 1 | `docs/BACKLOG.md` | 60 |
| 2 | `locales/sq.ts` | 25 |
| 3 | `server/socket.ts` | 23 |
| 4 | `locales/it.ts` | 22 |
| 5 | `locales/en.ts` | 22 |
| 6 | `components/GameTable.tsx` | 17 |
| 7 | `components/CardView.tsx` | 14 |
| 8 | `CLAUDE.md` | 14 |
| 9 | `server/routes.ts` | 13 |
| 10 | `docs/TESTING.md` | 13 |
| 11 | `components/GameShared.tsx` | 13 |
| 12 | `app/result.tsx` | 13 |
| 13 | `lib/tokens.ts` | 12 |
| 14 | `app/(online)/game.tsx` | 12 |
| 15 | `components/ExchangeModal.tsx` | 11 |

Next band: `package.json` 10, `app/index.tsx` 10, `docs/ARCHITECTURE.md` 9,
`context/OnlineGameContext.tsx` 8, `app/(online)/room.tsx` 8, `shared/schema.ts` 7,
`components/GameOverOverlay.tsx` 7, `app/game.tsx` 7, `app/(online)/profile.tsx` 7,
`tests/helpers/testServer.ts` 6, `server/socketSchemas.ts` 6, `server/onlineGameLogic.ts` 6,
`lib/gameEngine.ts` 6, `components/ReactionLayer.tsx` 6.

**Big landings in the window** (by lines touched, `--shortstat`):

| Commit | Subject | ins+del |
|---|---|---|
| `793b2ab` | Stop versioning the knowledge graph's build output | 188,891 (deletions) |
| `88620b5` | Clear the residue: 20 MB of chat attachments and six spent documents | 106,329 |
| `d811acf` | Refresh the knowledge graph | 105,247 |
| `12826af` | **Give the AI five named opponents instead of three difficulty levels** | 99,611 |
| `569a604` | Record what the replay path is | 21,000 |
| `dd136e2` | **Harden game engine, server auth and multiplayer lifecycle; add test suite** | 6,932 |
| `63810dc` | Let the player repaint the table and the card backs | 6,540 |
| `b90adb9` | **Unify the two game screens; add tutorial, CI and chrome polish** | 6,364 |
| `1f23c32` | **Put the ladder on the table: storage, endpoints and a leaderboard** | 6,123 |
| `e63b515` | Fix dependency vulnerabilities and Expo version alignment | 5,327 |
| `a4f9d53` | Localize the app (it/en/sq), cut render cost, and make the docs true | 3,999 |
| `471b7ea` | **One game model: a partita of manches, played to 21** | 1,703 |

The four largest are graph/asset housekeeping, not code. The real refactors are
`b90adb9` (two game screens unified into `GameTable`), `12826af` (bot personalities replacing
difficulty tiers), `471b7ea` (the match model), `dd136e2` (the security/lifecycle hardening
that created most of the test suite), `1f23c32` (the ladder), `63810dc` (cosmetics).

**Rush signals — searched for, and found clean:**
- Merge-conflict markers: `grep -rn "<<<<<<<\|>>>>>>>"` across `*.ts *.tsx *.js *.mjs *.md` → **zero hits**.
- `wip` / `fix fix` / `oops` / `temp` commit subjects → none. The only `revert`-shaped commit is `4bfbfc7 revert type module`.
- Commit messages are uniformly full sentences; commit hygiene is high.

---

## 14. Unfinished work

**Branches:** `git branch -a --no-merged main` → **empty**. Remotes are
`origin/main`, `origin/murlan-hardening`, `origin/murlan-polish` — both feature branches are
already merged. **No unmerged work exists.**

**Stashes:** `git stash list` → **empty**.

**Push state:** `git rev-list --count origin/main..main` → **0**. Local and remote `main` are
identical at `b894af4`.
→ **`docs/BACKLOG.md:108` (item O11) is stale**: it claims "`origin/main` is 74 commits behind
local `main`, so `.github/workflows/maestro.yml` does not exist on the remote at all". The
push has happened; that blocker no longer applies, and Q11/Q12 are now unblocked.

**`TODO`/`FIXME`/`HACK`/`XXX`/`ponytail:` inventory:**

| file:line | text |
|---|---|
| `package-lock.json:16670` | inside a base64 `sha512-…XXXevb5…` integrity hash — **not a marker** |
| `CLAUDE.md:305` | "waiting lobby with room code `XXXXXX`" — a format placeholder, not a marker |
| `audit/2026-08-17/PROMPT.md:13,107` | the audit brief's own text asking for this inventory |

**There is not a single real `TODO`, `FIXME`, `HACK`, `XXX` or `ponytail:` marker anywhere in
the source tree.** (Searched `*.ts *.tsx *.js *.mjs *.yml *.json` across
`app/ components/ context/ lib/ server/ shared/ tests/ scripts/ locales/ .github/` and the
root, excluding `node_modules`, `.git`, `graphify-out`, `dist`, `.expo`.) Open work lives in
`docs/BACKLOG.md` instead — see below.

**Commented-out code blocks of >3 lines:** none. The grep for comment lines beginning with
`const|let|var|function|if|for|return|import|export|await|}|<Capital` returned only prose
comments that happen to start with those words ("for", "forever", "importable", "if the
overflow…"). Verified each of the 18 hits by reading its line. **No dead code is commented
out anywhere.**

**Feature flags:**

| Flag | file:line | State |
|---|---|---|
| `EXPO_PUBLIC_E2E_FAST` | `app/game.tsx:20`, `app/(online)/game.tsx:31` | Off in production. Set only by `scripts/e2e-server.mjs:34` before the bundle build. Zeroes `AI_DELAY` (`app/game.tsx:23`), `AI_EXCHANGE_DELAY` (`:25`), `RESULT_DELAY` (`:29`), `GAME_OVER_DELAY` (`app/(online)/game.tsx:39`). **It is inlined at bundle-build time**, so a production bundle built with the var set would ship zero-delay AI — worth an A1/C2 check that no build path leaks it |
| `MURLAN_AFK_TIMEOUT_MS`, `MURLAN_DISCONNECT_GRACE_MS`, `MURLAN_BOT_MOVE_DELAY_MS` | `server/socket.ts:153,154,158` | Unset in production; read once at module scope. `tests/e2e/playwright.config.ts:47` sets the grace to 30 s |
| `ALLOW_DESTRUCTIVE` | `scripts/reset-db.mjs:11` | Required (with `--yes`) for the destructive reset. Never set by any script |
| `isBehindProxy()` | `server/cors.ts`, used `server/testApp.ts:186` | Environment-derived |

**Orphans (modules no file imports).** Determined by taking every tracked module under
`components/ context/ lib/ server/ shared/ locales/ app/` and grepping its basename (with and
without the `.ts`/`.tsx` extension) across all source and test directories:

| File | Verdict |
|---|---|
| `context/InviteContext.tsx` | **True orphan.** Two lines: `export { useSocket as useInvite } from "@/context/SocketContext";` with the comment "Re-export from SocketContext for backward compatibility". Nothing imports `InviteContext`, `InviteProvider` or `useInvite` anywhere in the repo — verified by a repo-wide grep for all three identifiers. Dead |
| `app/_layout.tsx`, `app/(online)/_layout.tsx`, `app/+not-found.tsx`, `app/+native-intent.tsx` | Not orphans — expo-router discovers these by filename convention |

No other orphan exists. `server/push.ts`, `server/ratings.ts`, `server/replayShape.ts`,
`server/stats.ts`, `server/schemaDdl.ts`, `server/testApp.ts`, `server/routes.ts` and
`shared/schema.ts` all *are* imported (with the `.ts` extension, which a naive grep misses).

**Open backlog items** (`docs/BACKLOG.md`, everything without a ✅):

| Item | Status |
|---|---|
| Q11 Maestro flows on CI | blocked on O11 — **and O11 is stale, see above** |
| Q12 iOS automation via EAS Workflows | blocked on O11 |
| Q26 Tournaments (XL) | not started. Design doc exists: `docs/superpowers/specs/2026-08-16-tournaments-design.md` — **an unimplemented design doc, which the standing agreement says should be deleted once implemented; it is not yet implemented, so it is legitimately open** |
| O1 | `eas.json` submit credentials are placeholders |
| O2 | `android-icon-monochrome.png` is 432×432 vs 512×512 for the other layers |
| O3 | `locales/sq.ts` needs a native-speaker pass |
| O4 | VoiceOver/TalkBack flow unverified |
| O5 | Replit boot unverified since the `reusePort` fix |
| O6 | `icon.png` 1.2 MB, `splash-icon.png` 1.37 MB (2.5 MB of available bundle win) |
| O7 | Push credentials (FCM + APNs) |
| O8 | Monetization is an owner call |
| O9 | npm vulnerabilities. BACKLOG says 30; **`npm audit` today reports 31: 0 critical, 14 high, 17 moderate, 0 low**. Drifted |
| O10 | Account friction before the ladder is worth defending |
| O11 | **Stale — the push has happened** |

**CLAUDE.md claims that contradict the code:**

| Claim | Reality |
|---|---|
| "If `graphify-out/wiki/index.md` exists, use it for broad navigation" | `graphify-out/wiki/` **does not exist**. Contents are `cache/`, `cost.json`, `graph.html`, `graph.json`, `GRAPH_REPORT.md`, `manifest.json` |
| Key Files: "`shared/schema.ts` — Drizzle schema + shared TypeScript types (Card, GameState, etc.)" | `shared/schema.ts` contains **no** `Card` or `GameState`. Those live in `lib/gameEngine.ts`. `shared/schema.ts` exports only Drizzle tables and their `$inferSelect` types |
| "`scripts/reset-db.mjs` required `--yes`, and `package.json`'s `db:reset` supplied `--yes` itself" (given as a live example of a self-defeating safeguard) | Already fixed. `package.json`'s `db:reset` is `node scripts/reset-db.mjs && drizzle-kit push` — no `--yes`, no `ALLOW_DESTRUCTIVE` |
| "CI ran lint, with `continue-on-error: true`" (same passage) | Already fixed. No `continue-on-error` in any of the three workflows |
| Not stated in CLAUDE.md, worth adding | CI does **not** run `test:native`, `test:e2e`, or any build |

---

## 15. Suspect set

The usual signals (TODO density, dead code, commented-out blocks, unmerged branches, red
tests) are all **zero or near-zero** in this repo — it is unusually clean. So the ranking
below is driven by the signals that remain: **size × churn × test-coverage gap**.

| # | File / area | Evidence |
|---|---|---|
| 1 | `server/socket.ts` (2272 L) | Largest file in the repo, 23 changes in 8 weeks (3rd hottest), holds **all** in-memory game state (`activeGames`, `socketRoomMap`, `spectatorRoomMap`, `userSocketMap`, `publicRoomIds`, 3 timer maps — `:125-138`), and has **no unit test file**: only `__testables` (`:212-235`) and the DB-gated integration suites reach it. `handleGameOver` alone is 213 lines (`:732-945`) doing stats, ratings, replays, achievements and match resolution with no unit coverage. This is the single highest-risk file |
| 2 | `components/GameTable.tsx` (1388 L) + `components/GameShared.tsx` (1329 L) | 17 + 13 changes in 8 weeks. 2717 L of presentational code whose only unit coverage is the extracted pure half (`gameTableModel.ts`, 62 tests). Everything about layout, animation timing, hit targets and accessibility inside these two files is verified only by Playwright screenshots-of-behaviour |
| 3 | `locales/sq.ts` / `it.ts` / `en.ts` (2329 L) | The three highest-churn source files after `server/socket.ts` (25/22/22 changes). `i18n.test.ts` pins key parity and placeholder parity but cannot pin *meaning*; BACKLOG O3 says the Albanian still needs a native-speaker pass. High churn + machine-checkable-only correctness |
| 4 | `context/OnlineGameContext.tsx` (656 L) | 22 `useState` hooks (`:130-166`) mirroring server broadcasts, 18 socket listeners (`:436-453`), a 27-entry `useMemo` dependency array (`:642`), and the whole reconnect/rejoin dance (`:179-192`). No unit test file; only the native `offlineResume` suite and Playwright touch it |
| 5 | `components/CardView.tsx` (689 L) | 14 changes in 8 weeks, and BACKLOG Q12b describes it as having shipped two separate rendering defects (procedural court art, colliding pip grid). Partially fixed and pinned by `cardFace.test.ts`, but it is the churniest component after the table |
| 6 | `app/result.tsx` (692 L) | 13 changes. BACKLOG Q10b documents **two** defects that shipped here: a stale `bothJokersException` overlay over a finished hand, and a double `router.replace` race between a button and a timer. Both fixed, but the file is a known repeat offender for lifecycle bugs |
| 7 | `components/ExchangeModal.tsx` (382 L) + `components/ResultExchangeOverlay.tsx` (278 L) | 11 changes to the modal. The exchange phase is the source of BACKLOG Q2, Q3, Q7, Q9, Q10b — five separate items. `ResultExchangeOverlay` was *extracted* from `result.tsx` specifically because Playwright could not reach it |
| 8 | `server/storage.ts` (475 L) | Every database read/write for rooms, seats, friends and users, including the atomic `claimRoomSeat` that the seat-collision invariant depends on. **No dedicated test file** — it is reached only through the DB-gated integration suites, which are the ones that silently skip locally |
| 9 | `scripts/build.js` (563 L) | The production build entry point. Untested, unlinted by CI, and **never exercised by CI at all** (§12). A break here reaches Replit unnoticed |
| 10 | `app/(online)/room.tsx` (977 L) + `app/(online)/quickmatch.tsx` (467 L) | 8 changes to `room.tsx`. The room screen is the largest online screen and owns the pre-game lifecycle (seat display, bot fill, mode selection, invite send) with no unit coverage |

**Two smaller concrete leads** (not "areas", specific findings from this pass):
- `context/InviteContext.tsx` — dead 2-line shim, imported by nothing (§14).
- `game:match_over` (`server/socket.ts:833`) and `room:player_left` (`server/socket.ts:2224`)
  are emitted by the server and listened to by **no client code** (§7). Either the client is
  missing a behaviour or the server is doing work nobody consumes.

---

## 16. Suggested file lists for the ten specialists

### A1 — Security & server authority

```
server/socket.ts                (esp. :1004-1049 handshake, :1391-1500 play/pass, :240-267 sanitize, :1601-1748 rejoin)
server/socketSafety.ts
server/socketSchemas.ts
server/ticket.ts
server/session.ts
server/cors.ts
server/routes.ts
server/schemas.ts
server/validate.ts
server/storage.ts
server/testApp.ts               (helmet/CORS/error-handler wiring, :23-39, :140-163, :180-240)
server/index.ts
server/push.ts
shared/schema.ts
lib/socket.ts                   (client ticket flow)
context/AuthContext.tsx
tests/integration/auth.test.ts
tests/integration/gameplay.test.ts
tests/integration/spectator.test.ts
tests/cors.test.ts
```

### A2 — Game rules correctness

```
lib/gameEngine.ts               (1274 L — the whole rulebook and the AI)
lib/botPersonalities.ts
lib/rating.ts
lib/achievements.ts
docs/RULES.md
docs/BRIEF.md                   (§3.1 rule decisions)
server/socket.ts                (:1391-1500 the server's rule enforcement, :732-945 handleGameOver)
server/onlineGameLogic.ts
context/GameContext.tsx         (:334-411 the offline authority)
lib/sharedGameFlow.ts
app/tutorial.tsx                (a third copy of the rule explanations)
tests/combinations.test.ts
tests/straights.test.ts
tests/exchange.test.ts
tests/scoring.test.ts
tests/teams.test.ts
tests/deal.test.ts
tests/flow.test.ts
tests/enumerator.property.test.ts
```

### A3 — Netcode, state sync & reconnection

```
server/socket.ts                (whole file; :125-192 state+timers, :526-641 turn arbitration, :643-718 vacateSeat, :1892-1974 disconnect, :1601-1748 rejoin, :2062-2151 sweeper)
server/onlineGameLogic.ts
server/socketSchemas.ts
server/socketSafety.ts
context/OnlineGameContext.tsx
context/SocketContext.tsx
lib/socket.ts
lib/offlineSave.ts
app/(online)/game.tsx
app/(online)/room.tsx
app/(online)/quickmatch.tsx
shared/schema.ts                (:71-88 active_games envelope)
tests/onlineGameLogic.test.ts
tests/persistedEnvelope.test.ts
tests/socketEvents.test.ts
tests/integration/gameplay.test.ts
tests/integration/abandonedGames.test.ts
tests/e2e/reconnect.spec.ts
tests/helpers/testServer.ts
```

### A4 — Resilience & error handling

```
server/testApp.ts               (:140-163 error handler, :211 ensureSchema before session)
server/socketSafety.ts          (:103-157 onEvent + installProcessGuards)
server/index.ts                 (:29-43 shutdown)
server/db.ts
server/logger.ts
server/schemaDdl.ts
server/storage.ts
server/replays.ts
server/ratings.ts
server/stats.ts
components/ErrorBoundary.tsx
components/ErrorFallback.tsx
components/OfflineBanner.tsx
context/NotificationContext.tsx
lib/query-client.ts
lib/i18n.ts                     (translateServerPayload — the client's error-code fallback)
server/routes.ts                (:417-438 client-errors)
tests/integration/clientErrors.test.ts
tests/integration/schemaBootstrap.test.ts
tests/schemaDdl.test.ts
```

### B1 — Performance

```
components/GameTable.tsx
components/GameShared.tsx
components/CardView.tsx
components/gameTableModel.ts
components/handLayout.ts
components/cardFaceModel.ts
components/ReactionLayer.tsx
context/OnlineGameContext.tsx   (:130-166 22 useState, :642 27-entry memo deps)
context/GameContext.tsx
app/(online)/game.tsx
app/game.tsx
app/(online)/friends.tsx        (FlatList + extraData)
lib/sounds.ts
lib/cosmetics.ts
babel.config.js                 (react-compiler beta)
metro.config.js
scripts/bundle-report.mjs
docs/BUNDLE.md
server/socket.ts                (:344-386 a DB upsert on every single move)
tests/e2e/tableFit.spec.ts
```

### B2 — UI visual quality

```
lib/tokens.ts
lib/theme.ts
components/GameTable.tsx
components/GameShared.tsx
components/CardView.tsx
components/cardFaceModel.ts
components/GameOverOverlay.tsx
components/ExchangeModal.tsx
components/ExchangeAnnouncement.tsx
components/ResultExchangeOverlay.tsx
components/MenuLayout.tsx
components/MenuCard.tsx
components/MenuButton.tsx
components/NotificationBanner.tsx
components/SettingsModal.tsx
app/index.tsx                   (the one screen exempt from MenuLayout; owns HomeMenuRow)
app/lobby.tsx                   (the reference menu screen)
app/result.tsx
app/(online)/profile.tsx
tests/tokenRoles.test.ts
tests/contrast.test.ts
tests/cosmetics.test.ts
tests/vignette.test.ts
```

### B3 — UX & game feel

```
components/GameTable.tsx        (:698-830 press feedback, glow, handlers)
components/gameTableModel.ts    (flight/impact timing)
components/GameShared.tsx
components/ExchangeAnnouncement.tsx
components/ResultExchangeOverlay.tsx
components/GameOverOverlay.tsx
components/NotificationBanner.tsx
components/ReactionLayer.tsx
lib/sounds.ts
lib/haptics.ts
lib/cardNames.ts
app/game.tsx                    (:20-29 AI/result pacing constants)
app/(online)/game.tsx           (:31-41 pacing + turn timer)
app/result.tsx
app/tutorial.tsx
app/index.tsx
app/lobby.tsx
app/(online)/room.tsx
context/GameContext.tsx
tests/motion.test.ts
tests/soundAssets.test.ts
```

### B4 — Accessibility & mobile/touch

```
lib/accessibility.ts
lib/cardNames.ts
lib/i18n.ts
locales/it.ts
locales/en.ts
locales/sq.ts
components/GameTable.tsx
components/GameShared.tsx
components/CardView.tsx
components/ExchangeModal.tsx
components/ResultExchangeOverlay.tsx
components/SettingsModal.tsx
components/ErrorFallback.tsx
components/MenuButton.tsx
app/tutorial.tsx
app/result.tsx
app/(online)/friends.tsx
tests/orientation.test.ts
tests/contrast.test.ts
tests/suitColours.test.ts
tests/reducedMotion.test.ts
tests/native/a11yCollapse.test.tsx
tests/e2e/tapTargets.spec.ts
```

### C1 — Architecture & maintainability

```
server/socket.ts                (the god file — 2272 L)
components/GameTable.tsx
components/GameShared.tsx
context/OnlineGameContext.tsx
context/GameContext.tsx
context/SocketContext.tsx
context/InviteContext.tsx       (dead 2-line shim — delete candidate)
lib/gameEngine.ts
lib/sharedGameFlow.ts
server/onlineGameLogic.ts
server/replayShape.ts
server/pushShape.ts
server/storage.ts
server/testApp.ts
shared/schema.ts
app/_layout.tsx                 (provider stack)
app/(online)/_layout.tsx
CLAUDE.md                       (four claims found false — §14)
docs/ARCHITECTURE.md
docs/BACKLOG.md                 (O11 is stale)
```

### C2 — Testing, build & supply chain

```
package.json
package-lock.json
.github/workflows/ci.yml
.github/workflows/eas-build.yml
.github/workflows/maestro.yml
.replit
eas.json
app.json
jest.config.js
tsconfig.json
eslint.config.js
babel.config.js
metro.config.js
drizzle.config.ts
patches/expo-asset+12.0.13.patch
scripts/build.js
scripts/e2e-server.mjs
scripts/dev-stack.mjs
scripts/reset-db.mjs
tests/e2e/playwright.config.ts
tests/helpers/testServer.ts
tests/serverLoadable.test.ts
tests/dbPush.test.ts
tests/dbResetGuard.test.ts
docs/TESTING.md
```

---

## 17. Coverage gaps

Things I could **not** determine, and why:

1. **Integration suites did not run.** No `DATABASE_URL` is set on this machine and no
   Postgres is reachable, so 11 suites self-skipped. I read their assertions but did not
   observe them pass. CI does run them (`.github/workflows/ci.yml:67-74` makes a skip fatal),
   so they are presumed green at `b894af4`, but that is inference from CI configuration, not
   from an observed run.
2. **Playwright E2E was not run.** It needs a built web bundle, a Docker/Postgres dev stack
   and a browser download. Not attempted — would have taken minutes and could have written
   into `tests/e2e/test-results/`, which the read-only rule forbids.
3. **Maestro was not run.** Needs an Android emulator.
4. **Production build not exercised.** `expo:web:build`, `expo:static:build` and
   `server:build` were not run — they write to gitignored output directories, which the
   read-only rule forbids. So "does the production build pass?" is **unanswered**; note that
   CI never answers it either.
5. **Replit runtime behaviour unverified.** I read `.replit` but cannot observe a deploy.
   BACKLOG O5 independently flags that Replit boot has not been verified since the
   `reusePort` fix.
6. **Unused *exports*** (as opposed to unused modules) were not enumerated. I proved module-level
   orphanhood by basename grep; symbol-level dead exports need a tool run (`ts-prune` or
   equivalent) that would require an install. Left for C1.
7. **`npm audit` detail.** I have the counts (0 critical / 14 high / 17 moderate / 0 low /
   31 total) but did not enumerate which packages or whether any is reachable at runtime.
   Left for C2. BACKLOG O9 explains why `npm audit fix --force` is refused.
8. **`graphify` CLI was not used.** `graphify-out/graph.json` exists (3.0 MB) but
   `graphify-out/wiki/` does not, and the CLI's availability on PATH was not tested. Every
   fact in this map comes from reading source or from a command output captured in this
   session — nothing came from the graph.
9. **`locales/` semantic correctness** is unverifiable here (needs it/sq speakers); only key
   and placeholder parity is machine-checked.
10. **Runtime performance numbers** (frame times, bundle size in bytes, DB query latency) were
    not measured. `docs/BUNDLE.md` and `scripts/bundle-report.mjs` exist and were not run.

