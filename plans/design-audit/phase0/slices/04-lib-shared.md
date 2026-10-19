# 04-lib-shared — slice review (SRC 50144087)

Scope: 117 files, 13,627 lines (lib/, lib/game, lib/device, lib/diagnostics, shared/, modules/, plugins/, locales/). Every file was read in full. Prior reports read in full: domain.md, client.md. The others were skimmed.

## Findings

### 04-lib-shared-F1 (P1, S) The restore path decides "match over" differently from the live path; the comment claiming otherwise is false
- files: lib/game/gameEngine.ts:1324-1327, lib/game/gameEngine.ts:1470-1485, server/game/onlineGameLogic.ts:277-296, server/game/tableState.ts:189-195
- problem: The doc on the match-verdict helper says the live path and the restore path both go through it, "so they cannot answer 'is this match decided?' differently". That is not true.
  - The live path, `foldRoundIntoMatch`, passes `winEligibleCumulative` for free-for-all.
  - The restore path, `restoredMatchOver`, called from tableState.ts:189, passes every score and no nameable set.
  - So a restored free-for-all table whose leader is not win-eligible is judged over (or not over) differently than the live fold judged it. The comment is a lie that will stop the next reader from looking.
- proposed: make `resolveMatchFor(match, scores)` the single entry point, with the eligibility filter computed inside it from `match`. Callers then cannot pass the unfiltered map. Delete `restoredMatchOver`'s private scoring.
- effect: one home for the verdict; removes a server-restart bug class. Tests: one restore-vs-live parity test on a free-for-all fixture with an ineligible leader.
- overlap: confirms domain-F4 (still present in SRC; `resolveMatchFor` exists, but the restore caller still bypasses the filter). Adds the false comment.
- confidence: high

### 04-lib-shared-F2 (P2, S) The inventory's import cycle is all type-only, and is caused by two misplaced type homes
- files: lib/game/gameEngine.ts (type import of botPersonalities), lib/game/botPersonalities.ts:7, lib/i18n.ts, shared/protocol.ts:5-6, lib/wire.ts, lib/game/matchState.ts (RoundOverPayload/ScoreLine/RatingAfter), shared/i18n.ts:12, lib/game/placement.ts:4, lib/game/rating.ts:3, lib/achievements.ts:20, lib/cosmetics.ts:13, lib/cardNames.ts:9, shared/schema.ts:3,5
- problem:
  - The cycle is gameEngine →type botPersonalities →type lib/i18n →type shared/protocol →type lib/wire →type gameEngine.
  - Every edge is `import type`, so the cycle is erased at runtime and has no runtime defect. It is real for tooling only: tsc project references, madge, and any future bundler that preserves type imports.
  - It exists because of two misplaced homes.
    - (a) Six domain modules import `TranslationKey` from the client module `lib/i18n` (which pulls in AsyncStorage and React), although the type is defined in `shared/i18n.ts:12`.
    - (b) Wire DTOs live in lib: `lib/wire.ts`, plus `RoundOverPayload`/`ScoreLine`/`RatingAfter` in `lib/game/matchState.ts`. That makes shared/protocol import from lib.
- Layer assessment:
  - shared/protocol → lib/game *types* (Card, GameState, PlayerSeat) is the correct direction: the protocol describes domain types. The inventory's "shared imports nothing from lib" rule is wrong for lib/game.
  - shared/protocol → lib/wire and → lib/game/matchState wire payloads are the real violations, because those types are protocol, not domain.
  - shared/schema.ts is a server-only drizzle schema with no client importer (lib/wire only mentions it in a comment), so it is a locality note, not a violation.
- proposed:
  - Retarget the six imports to `shared/i18n` (a mechanical change).
  - Move the friend/lobby DTOs from lib/wire.ts, and the three round-over payload types from matchState.ts, into `shared/protocol.ts` (or `shared/wire.ts`). Leave lib/wire re-exporting them only if callers are many; otherwise update the imports.
- effect: the cycle and every shared→lib/wire edge disappear; the domain no longer reaches the client i18n module. No behaviour change.
- overlap: extends domain-F14 (non-domain things in lib/game) and server-F8 (unshared contract)
- confidence: high

### 04-lib-shared-F3 (P2, S) Production-critical iOS patches ship inside the "diagnostics" bench module
- files: modules/murlan-diagnostics/index.ts, modules/murlan-diagnostics/app.plugin.js, modules/murlan-diagnostics/ios/ (MurlanReactNativeFlags.enableSwiftUIFilters, MurlanRecycledLayout prepareForRecycle swizzle), plugins/withSwiftUIFilters.js:12, app.json:60
- problem:
  - The module named and documented as the bench/probe module also carries two fixes the store build depends on: the SwiftUI-filters flag behind iOS grayscale, and the recycled-layout swizzle from #1485.
  - `withSwiftUIFilters.js:12` unconditionally inserts `internal import MurlanDiagnostics` into every AppDelegate, so the bench module is linked into release builds.
  - A "strip diagnostics from release" or dead-code sweep would silently drop production fixes. The name hides the dependency (a locality failure).
- proposed: split the module.
  - `modules/murlan-rn-patches`: the flags plus the swizzle, imported by the config plugin.
  - `modules/murlan-diagnostics`: probe and latency only, and allowed to be excluded from release.
- effect: the module name tells the truth; diagnostics can be gated out of store builds without risk.
- overlap: new
- confidence: medium-high (the Swift sources were read for the flag and swizzle; release linkage was inferred from the plugin, not from a built binary)

### 04-lib-shared-F4 (P2, S) Platform twins restate their shared types and constants by hand
- files: lib/device/audioEngine.ts, lib/device/audioEngine.web.ts, lib/device/hapticsEngine.ts, lib/device/hapticsEngine.web.ts
- problem:
  - `Bus`, `AudioState` and `EngineStats` are declared in both audio twins, as are `MUSIC_CROSSFADE_MS` and the jitter constants. `TapHaptic` and `PulseStrength` are declared in both haptics twins.
  - Nothing ties the native and web export surfaces together. Today they match by hand. This is the inventory's 26-line duplicate, and it is real.
- proposed: `lib/device/audioEngine.types.ts` and `hapticsEngine.types.ts` hold the shared types, constants and an `AudioEngine` interface. Each twin ends with `export const engine = {...} satisfies AudioEngine` (or `satisfies typeof import(...)`).
- effect: one home per fact. A twin that drifts becomes a compile error.
- overlap: extends client-F19 (adds the haptics twin and the `satisfies` contract)
- confidence: high

### 04-lib-shared-F5 (P2, XS) A fourth stuck-exchange valve and two more "a play happened" inferences live in diagnostics
- files: lib/diagnostics/benchTable.ts:30, lib/diagnostics/scenarios/landingSync.ts:10, lib/diagnostics/scenarios/threadLoad.ts:38, lib/game/autoMove.ts:43-52
- problem:
  - benchTable re-derives "advance this table" as `offlineBotMove(state) ?? (exchangePhase?.active ? resolveStuckExchange(state) : null)`. That is a fourth call-site copy of the valve decision, here used to skip a human's giveback.
  - landingSync and threadLoad infer "a play just happened" from `lastPlayedCombination && passCount === 0`, which is the same fragile inference domain-F3 flags.
- proposed: when domain-F16's single `advanceTable(state)` and domain-F3's explicit last-event field land, these three sites call them. No separate work is needed, but they must be in that ticket's caller list.
- effect: the bench stops being a silent sibling that keeps old semantics after the fix.
- overlap: extends domain-F16 and domain-F3
- confidence: high

### 04-lib-shared-F6 (P3, XS) exchangeCeremony.ts is a pass-through, and its header is false
- files: lib/exchangeCeremony.ts:1-15, server/game/gameTurn.ts:38,166, server/game/onlineGameLogic.ts:11,82
- problem:
  - The module only forwards to `exchangeAnnounceFrom`, so it fails the deletion test.
  - Its header says it is "imported by the client" and governs how long a local turn waits. Both claims are false: only two server files import it.
- proposed: inline it into the server callers, or move it to server/game.
- effect: one less file, and one less false comment.
- overlap: confirms domain-F15 (adds the false header)
- confidence: high

### 04-lib-shared-F7 (P3, XS) Bot seat-key format is defined twice
- files: lib/game/rating.ts:80 (`BOT_ID_PREFIX = "bot:"`), server/game/botSeat.ts (botSeatKey/isBotSeatKey/botSeatIndex), server/game/onlineGameLogic.ts:203 (inline `` `bot:${seat}` ``)
- problem: three spellings of one key format. A change to one leaves rating unable to recognise bots.
- proposed: move botSeat.ts into lib/game (it has no server dependencies). rating.ts and onlineGameLogic then import `botSeatKey`/`isBotSeatKey`.
- effect: one home; delete the constant and the inline template.
- overlap: new
- confidence: high

### 04-lib-shared-F8 (P3, S) Reduce-motion opens one native subscription per subscriber
- files: lib/accessibility.ts:80-103, components/CardView.tsx:448 (plus about 35 call sites of usePrefersReducedMotion)
- problem: on native, `subscribeSystemReduceMotion` adds an `AccessibilityInfo` listener and fires an `isReduceMotionEnabled()` bridge call for every subscriber. Every CardView subscribes, so one table mount opens about 54 native listeners and bridge calls for one boolean.
- proposed: a module store with one native listener, ref-counted, and a cached value. `useSyncExternalStore` readers share it, following the pattern already used for the in-app setting in the same file.
- effect: one listener per app; no bridge burst on deal.
- overlap: new
- confidence: medium (the count is from the code; the cost was not measured)

### 04-lib-shared-F9 (P3, XS) captureStates seats bots that the lobby never seats
- files: lib/captureStates.ts:28-29, app/lobby.tsx:139,151, lib/game/botPersonalities.ts
- problem: `BOTS = ["Luan","Drita","Besnik"]` claims to match "as app/lobby.tsx fills empty seats". The lobby uses BOT_PERSONALITIES (Luan, Besnik, Gent), and "Drita" exists nowhere else. Capture screenshots therefore show a table the app cannot produce.
- proposed: derive the names from `botSeatNames` (or `BOT_PERSONALITIES`) and delete the literal.
- effect: one home for the bot roster; the false comment goes.
- overlap: new
- confidence: high

### 04-lib-shared-F10 (P3, XS) Comments that are false against SRC
- files and problems:
  - lib/game/autoMove.ts:132: "instead of assuming 3♣". The opening card is 3♠.
  - lib/game/gameEngine.ts:506-507: says a bitmask "fails for 2-player hands of 26 cards". Heads-up hands are 14 (`HEADS_UP_HAND`, :266).
  - lib/game/gameEngine.ts:973-985: two JSDoc blocks are stacked. getValidGivebackCards' doc sits above pickGivebackCard.
  - lib/game/replay.ts:194-196: cites `server/game/gameTurn.ts recordPlayFlags`. The real home is lib/game/autoMove.ts; gameTurn only wraps it (:52).
  - lib/achievements.ts:36: cites "lib/game/gameEngine.ts:687-690" with a quote that is not there.
  - lib/game/matchState.ts:11 and lib/achievements.ts:32: "escalates 21→31→41→51". That holds only at 4 seats.
- proposed: correct each comment, or delete it. Prefer deleting line-number citations, per CLAUDE.md, which says to point at the authority and not at a line.
- effect: removes six misleading pointers.
- overlap: new
- confidence: high

### 04-lib-shared-F11 (P3, XS) useOwnLink resets the shared link edges on every subscribe
- files: lib/useOwnLink.ts:32, context/OnlineGameContext.tsx:341
- problem: `edgesOf.set(socket, NO_LINK)` runs on each subscribe against a WeakMap shared per socket. A second subscriber, or a resubscribe during an outage, erases `downAt`, so the outage duration restarts. There is only one caller today, so the defect is latent.
- proposed: initialise only when the entry is missing (`if (!edgesOf.has(socket))`).
- effect: correct outage timing under any number of subscribers.
- overlap: new
- confidence: medium

### 04-lib-shared-F12 (P3, XS) Small hygiene items
- lib/diagnostics/FrameProbe.tsx:45-49: `armFrames` never clears its 1 s reject timer after it resolves. The timer is harmless but leaks one timer per arm.
- lib/i18n.ts:166 vs :182-189: `translateServerPayload` exists twice, once free and once bound. Keep the bound one.
- lib/game/exchangeTimeline.ts re-declares `clamp01`/`ease` from lib/game/roundEnding.ts.
- shared/socketSchemas.ts: `GameModeSchema`/`MatchLengthSchema` restate the literal unions. Derive the types with `z.infer`, or build the schema from the const tuple.
- overlap: new
- confidence: high

### Confirmed priors, still present in SRC, with no new evidence beyond above
- domain-F5: `FoldRoundInput.accumulates` has no production caller (gameEngine.ts:1280 doc still references it).
- domain-F6: opening derivation duplicated in autoMove.ts:97-103 and checkSelection gameEngine.ts:490; `openingIsPending` and `roundUnplayed` (:1043-1065) infer from playedRanks.
- domain-F7: processExchangeChoice (:949-971) returns state unchanged on refusal.
- domain-F8: recordPlayFlags/ctx mutation and onMove callback in autoMove.
- domain-F9: bot.ts partnerSeat recomputes the team.
- domain-F11: RandomSource is global crypto (gameEngine.ts:229-255), not injectable; e2eOpener.ts loops unbounded.
- domain-F12: persistedEnvelope casts gameState unvalidated.
- domain-F13: test-only exports (display helpers :841-856, TURN_TIMEOUT_MS :1183, FeltGradient lib/tokens.ts:365).
- domain-F14: sharedGameFlow imports React; roundEnding/matchEnding/dealTimeline/exchangeTimeline import tokens; placement imports theme colours.
- domain-F18: botChoosePlay takes 9 positional parameters.
- domain-F19: roundOverSchema (shared/protocol.ts:160-169) validates only part of the payload, and `ratingsAfter` is `.optional()` while the type requires it.
- domain-F2: offlineSave duplicates players/gameMode.
- client-F7: three fetch clients in query-client.
- client-F18: e2eBotSuspend/e2eRealExchange are line-for-line copies.
- client-F20: latency readings duplicated across two native modules (probe.ts:7-8).
- client-F21: feedback.ts:36-41 parses raw settings JSON.
- client-F26: socket.ts has a global auth handler.
- client-F27: `tn(base: string)` is untyped.
- client-F12 (locale domain-term keys with drifted translations): wording, out of scope here.

### Locales (structure and parity)
- en.ts is the authority. it.ts and sq.ts are typed `Record<keyof typeof en, string>`, so missing or extra keys are compile errors. Measured: 923 keys in each, 0 missing, 0 extra, 0 `_one`/`_other` pairs incomplete, 45 namespaces.
- Placeholders (143 `{{x}}` in en): 0 mismatches in it or sq. This is already enforced by tests/ui-rules/i18n.test.ts:512, so no finding.
- it.ts carries a redundant `as const` under the `Record` annotation. That is trivial and not a finding.
- 26 (it) and 21 (sq) values are identical to English: email labels, "Online"/"Offline", "%", replay.title, and so on. That is wording, not structure, so it was not assessed.

## Prior findings that are wrong or already fixed
- None of the domain or client findings touching this slice were already fixed in SRC.
- domain-F4: "resolveMatchFor now unifies the verdict" would be the natural assumption from reading gameEngine.ts alone. It is wrong; the restore caller bypasses it (see F1).
- The inventory's layer rule "shared must not import lib" is wrong for lib/game types (see F2). It is not a prior-report finding, but it would produce a wrong ticket.

## Inventory items checked (real / false positive)
- Import cycle lib/wire ↔ lib/game/* ↔ shared/protocol ↔ lib/i18n: real but type-only, with no runtime effect (F2).
- shared→lib layer violations: shared/protocol→lib/wire and →lib/game/matchState wire types are real (F2). shared/protocol and shared/schema → lib/game domain types are a false positive (correct direction).
- Orphan modules/murlan-diagnostics/app.plugin.js: false positive; referenced from app.json:60.
- Duplicate block audioEngine.ts ↔ audioEngine.web.ts (26 lines): real (F4).
- Duplicate block e2eBotSuspend.ts ↔ e2eRealExchange.ts (18 lines): real (client-F18).
- Duplicate block locales en/it/sq (~1036 lines): false positive; same key set by design, enforced by type.
- Duplicate blocks inside lib/tokens.ts (4-31 vs 415-455, 386-414): false positive; structurally similar object literals with different values.
- Duplicate block components/scorePill.tsx 81-111 vs lib/tokens.ts: false positive (PX constants vs Colors).
- Duplicate block lib/device/soundAssets.ts vs tokens.ts 556-568: false positive (require list vs token map).
- Function ≥80 lines: gameEngine.ts initializeRematch (:860-947). Real, but cohesive; its silent fallback to seat 0 or the last seat is noted under domain-F7's refusal class.
- Test-only exports in gameEngine.ts and tokens.ts (FeltGradient): real (domain-F13). Motion.exchange.highlight is used (components hand.tsx:299), so that one is a false positive.
- ratedFinishers in lib/game/rating.ts: real, but server-only (server/game/ratings.ts:83,98,165); a locality note only.

## Coverage
| file | lines | verdict |
|---|---|---|
| lib/a11y.tsx | 292 | clean |
| lib/accessibility.ts | 139 | F8 |
| lib/achievements.ts | 140 | F2, F10 |
| lib/apiError.ts | 48 | clean |
| lib/audioLevel.ts | 80 | clean |
| lib/authRedirect.ts | 10 | clean |
| lib/authUser.ts | 34 | clean |
| lib/canvaskit.ts | 5 | clean |
| lib/captureRoute.ts | 2 | clean |
| lib/captureStates.ts | 278 | F9 |
| lib/cardNames.ts | 51 | F2 |
| lib/cosmetics.ts | 97 | F2 |
| lib/deepLink.ts | 24 | clean |
| lib/device/assetFiles.ts | 5 | clean |
| lib/device/audioEngine.ts | 371 | F4 |
| lib/device/audioEngine.web.ts | 221 | F4 |
| lib/device/feedback.ts | 197 | confirms client-F21 |
| lib/device/fonts.ts | 25 | clean |
| lib/device/fonts.web.ts | 14 | clean |
| lib/device/hapticsEngine.ts | 44 | F4 |
| lib/device/hapticsEngine.web.ts | 67 | F4 |
| lib/device/inviteTaps.ts | 30 | clean |
| lib/device/inviteTaps.web.ts | 4 | clean |
| lib/device/keyboard.ts | 21 | clean |
| lib/device/moments.ts | 143 | clean |
| lib/device/musicTracks.ts | 17 | clean |
| lib/device/musicTracks.web.ts | 9 | clean |
| lib/device/orientation.tsx | 101 | clean |
| lib/device/pushRegistration.ts | 94 | clean |
| lib/device/soundAssets.ts | 58 | clean |
| lib/diagnostics/bench.ts | 44 | clean |
| lib/diagnostics/BenchAutostart.tsx | 18 | clean |
| lib/diagnostics/benchLaunch.ts | 6 | clean |
| lib/diagnostics/benchTable.ts | 38 | F5 |
| lib/diagnostics/build.ts | 7 | clean |
| lib/diagnostics/FrameProbe.tsx | 92 | F12 |
| lib/diagnostics/index.ts | 98 | clean |
| lib/diagnostics/jsLag.ts | 22 | clean |
| lib/diagnostics/lampLegibility.ts | 97 | clean |
| lib/diagnostics/probe.ts | 21 | confirms client-F20 |
| lib/diagnostics/recorder.ts | 36 | clean |
| lib/diagnostics/scenarios/hapticOnset.ts | 28 | clean |
| lib/diagnostics/scenarios/idle.ts | 8 | clean |
| lib/diagnostics/scenarios/index.ts | 12 | clean |
| lib/diagnostics/scenarios/lampVariants.ts | 23 | clean |
| lib/diagnostics/scenarios/landingSync.ts | 14 | F5 |
| lib/diagnostics/scenarios/musicSwitch.ts | 15 | clean |
| lib/diagnostics/scenarios/noticeGallery.ts | 47 | clean |
| lib/diagnostics/scenarios/pulseCost.ts | 29 | clean |
| lib/diagnostics/scenarios/scheduledOnset.ts | 14 | clean |
| lib/diagnostics/scenarios/seatAnchors.ts | 21 | clean |
| lib/diagnostics/scenarios/soak.ts | 57 | clean |
| lib/diagnostics/scenarios/tapBurst.ts | 30 | clean |
| lib/diagnostics/scenarios/threadLoad.ts | 75 | F5 |
| lib/diagnostics/types.ts | 36 | clean |
| lib/e2eBotSuspend.ts | 22 | confirms client-F18 |
| lib/e2eBuildMark.ts | 10 | clean |
| lib/e2eOpener.ts | 17 | confirms domain-F11 |
| lib/e2eRealExchange.ts | 22 | confirms client-F18 |
| lib/e2eTrace.ts | 175 | clean |
| lib/emailNudge.ts | 21 | clean |
| lib/errorReporting.ts | 204 | clean |
| lib/exchangeCeremony.ts | 15 | F6 |
| lib/flushSync.ts | 2 | clean |
| lib/flushSync.web.ts | 3 | clean |
| lib/game/autoMove.ts | 151 | F5, F10; confirms domain-F6, F8 |
| lib/game/bot.ts | 365 | confirms domain-F9, F18 |
| lib/game/botPersonalities.ts | 80 | F2 |
| lib/game/dealTimeline.ts | 24 | confirms domain-F14 |
| lib/game/exchangeTimeline.ts | 128 | F12; confirms domain-F14 |
| lib/game/gameEngine.ts | 1525 | F1, F10; confirms domain-F5, F6, F7, F11, F13 |
| lib/game/matchEnding.ts | 56 | confirms domain-F14 |
| lib/game/matchState.ts | 206 | F2, F10 |
| lib/game/offlineBotDelay.ts | 2 | clean |
| lib/game/placement.ts | 28 | F2; confirms domain-F14 |
| lib/game/rating.ts | 151 | F2, F7 |
| lib/game/replay.ts | 205 | F10 |
| lib/game/roundEnding.ts | 113 | F12; confirms domain-F14 |
| lib/game/scorePill.ts | 94 | clean |
| lib/game/sharedGameFlow.ts | 91 | confirms domain-F14 |
| lib/game/standings.ts | 30 | clean |
| lib/i18n.ts | 200 | F2, F12; confirms client-F27 |
| lib/ladderQuery.ts | 8 | clean |
| lib/offlineSave.ts | 96 | confirms domain-F2 |
| lib/ownLink.ts | 62 | clean |
| lib/profileStats.ts | 91 | clean |
| lib/query-client.ts | 79 | confirms client-F7 |
| lib/reactions.ts | 78 | clean |
| lib/reconnectDelay.ts | 10 | clean |
| lib/relativeTime.ts | 22 | clean |
| lib/screenShake.ts | 26 | clean |
| lib/sendIntent.ts | 116 | leave-alone: deep; one queue hides retry/ack behind send() |
| lib/socket.ts | 110 | confirms client-F26 |
| lib/storageKeys.ts | 29 | clean |
| lib/streak.ts | 48 | clean |
| lib/theme.ts | 128 | clean |
| lib/tokens.ts | 715 | confirms domain-F13 (FeltGradient); inventory duplicates false positive |
| lib/tutorialSeen.ts | 26 | clean |
| lib/updateRequired.ts | 20 | clean |
| lib/useEntrance.ts | 43 | clean |
| lib/useOwnLink.ts | 64 | F11 |
| lib/wire.ts | 91 | F2 |
| locales/en.ts | 1045 | leave-alone: authority for key set; parity type-enforced, placeholders tested |
| locales/it.ts | 1042 | leave-alone: key parity type-enforced (923/923), placeholders tested |
| locales/sq.ts | 1048 | leave-alone: key parity type-enforced (923/923), placeholders tested |
| modules/murlan-audio-session/index.ts | 9 | clean |
| modules/murlan-diagnostics/app.plugin.js | 15 | F3 |
| modules/murlan-diagnostics/index.ts | 16 | F3 |
| modules/murlan-orientation/index.ts | 9 | clean |
| plugins/withSwiftUIFilters.js | 21 | F3 |
| shared/events.ts | 68 | clean |
| shared/i18n.ts | 36 | F2 (the right home for TranslationKey) |
| shared/persistedEnvelope.ts | 243 | confirms domain-F12 |
| shared/protocol.ts | 187 | F2; confirms domain-F19 |
| shared/schema.ts | 449 | F2 (locality note: server-only) |
| shared/socketSchemas.ts | 110 | F12 |
| shared/username.ts | 18 | clean |
