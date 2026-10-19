# Phase 0 — third-party tool results (snapshot origin/main 50144087)

Tools were installed in an isolated scratchpad folder (knip 5, dependency-cruiser 16 with TypeScript 5.9, jscpd 4) and run against the snapshot, with the main checkout's `node_modules` linked in. Raw output in this folder: `knip.md`, `depcruise.txt`, `jscpd-prod/`, `jscpd-tests/`. Each tool's results were cross-checked against `../inventory.md` (the project's TypeScript compiler API script).

## Confirmed by two independent tools
- **Import cycle:** lib/wire.ts → lib/game/gameEngine.ts → lib/game/botPersonalities.ts → lib/i18n.ts → shared/protocol.ts → (lib/wire.ts | lib/game/matchState.ts | lib/game/gameEngine.ts). Also a direct gameEngine ↔ botPersonalities cycle. The 04-lib-shared reviewer checked every edge: all are **type-only**, so there is no runtime effect. The cause is two types in the wrong module: `TranslationKey` is imported from lib/i18n instead of shared/i18n, and the wire DTOs live in lib/wire and matchState.
- **Small cycle:** components/table/air.ts ↔ particles.ts.
- **`shared/` is not a leaf:** shared/protocol.ts → lib/game/gameEngine, lib/game/matchState, lib/wire; shared/schema.ts → lib/game/gameEngine, lib/game/replay.
- **Production importing test helpers:** scripts/measureHeadsUpBalance.ts → tests/helpers/offlineMatch.ts and tests/engine/helpers.ts.

## New from these tools
- **Undeclared (phantom) dependencies**, imported but not in package.json, so they work only because npm hoists them (the "npm install hoists, npm ci obeys the lockfile" class):
  - `@jest/globals`, imported by 243 test files.
  - `canvaskit-wasm` (4 imports).
  - `express-serve-static-core`, a type import in server/http/validate.ts.
  - `jest-util`, `expo-updates`, `expo-keep-awake`, `eslint-plugin-react-hooks`, `babel-preset-expo`, `@typescript-eslint/parser`, `@expo/env`.
  - jest.config.js references `babel-jest`, which is not listed.
  - CLAUDE.md says a second copy of babel-preset-expo's React Compiler must never be added, so `babel-preset-expo` must stay a transitive dependency of `expo`. Check each of these before declaring it.
- **Declared but unused, per knip:** `pino-pretty` (check whether it is loaded as a pino transport string, which knip cannot see), `@breezystack/lamejs`, `@types/bcryptjs` (bcryptjs may ship its own types), `subset-font` (used by build-* scripts that knip cannot reach).
- **Scripts with no package.json or workflow entry:** scripts/react-compiler-probe.mjs, build-icon-fonts, build-court-art, optimize-images, reset-password, bundle-report, build-sounds, build-fonts, dev-stack (run by hand per docs), tools/loop/tests/helpers/probeFixtureRace.mjs, .claude/workflows/audit.mjs. Each needs a decision: keep as documented by-hand tool, or delete.
- **False positives:** the `*.web.ts(x)` "unused files" are platform variants that Metro resolves.
- **Exports used nowhere, not even by tests:** 111 values and 38 types, listed in knip.md "Unused exports" / "Unused exported types". Top files: components/cardFaceModel.ts 8, tools/loop/loop-stream.mjs 6, tests/native/mocks/audioApi.ts 6, tools/ci/e2ePort.mjs 5, eslint.selectors.cjs 5, server/socket/socketTable.ts 4, lib/device/feedback.ts 4, mainHealth/loop-logs 4. The ../inventory.md list counts test-only use separately: 498 exports used only by tests.
- **Duplicate exports:** feltCanvas.tsx exports `FeltCanvas` both named and default; shared/socketSchemas.ts has `RoomJoinSchema` = `RoomSpectateSchema` = `RoomRejoinSchema` as three names for one schema.

## Duplication (jscpd, exact tokens)
- **Production:** 12 clones, 167 lines, 0.22%. Exact copy-paste is not the problem; the inventory's identifier-normalised count (71 blocks) shows the structural duplication. Largest: seats.tsx:615-636 = 793-814; recover.tsx = verify-email.tsx (CONTEXT.md rejects merging these); profile.tsx ×2; audioEngine.ts = audioEngine.web.ts head; index.tsx:361 = 562; tableHandlers.ts:202 = 260; tools/ci edgePixels = feltPixels; table/actions.tsx ×2; feltCanvas = handShadeCanvas.
- **Tests:** 104 clones, 3,628 duplicated lines out of 136,744.
  - Mostly e2e HTML mockup fixtures (card-glow, exchange-legs, lantern-table, notice-extras/panel share 150–217-line blocks) and offlineSave.v2/v3.json, which is deliberate.
  - Real test-code clones: the socket-fake preamble (friendLastSeen = socketReconnect = socketContextFreshness; friendRequestReconcile = friendRowArrivesWithTheBanner), endMatchVote = seatReclaim (`stubIo`), and tableCardRects = tableCardShadows.
  - e2e exchange specs share a 28–53-line setup: exchangeAnnounceNodes, exchangeNoOverlap, exchangePickChange, a11yOverlays, startAnnouncement.
