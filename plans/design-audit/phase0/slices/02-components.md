# 02-components — slice review (SRC 50144087)

Scope: `components/` excluding `components/table/` (49 files, ~9.8k lines). Paths are relative to SRC.

## Findings

### 02-components-F1 (P2, S) CardView carries an interaction model that only the tutorial uses
- files: components/CardView.tsx:349-350, 452-500 (lift `-14` at 464); app/tutorial.tsx:674-682, 750-755; components/table/hand.tsx:305, 534-550, 1382-1390; components/table/pile.tsx:339; components/table/seats.tsx:118; components/table/deal.tsx:147; components/table/ExchangeLegs.tsx:145, 148; components/LookPicker.tsx:115; components/seatLayout.ts:50-53
- problem: CardView is two modules in one. One paints a face or back with its a11y label. The other is a press and selection interaction: a spring lift of `-14` when `selected`, plus a press rise and tilt. Only the tutorial uses the second (`onPress` + `selected`, app/tutorial.tsx:674-682, 750-755). Every table caller passes `noLift` or no `onPress`. Even so, every card on the table allocates the translateY and press shared values, one animated style and two effects. It also gives the codebase a second definition of "selected lift": the hand lifts by `handRowHeadroom(cardH)` = 16/90·cardH (seatLayout.ts:50-53, hand.tsx:305), and the tutorial lifts by a fixed 14 px.
- proposed: make CardView a pure painter (face/back + a11y). Move press and lift into a `TutorialCard` wrapper next to its only caller, or have the tutorial reuse the hand's lift via `handRowHeadroom`. Then `noLift` goes away.
- effect: the interface narrows (`noLift`, `onPress`, `selected` leave the painter). The table stops paying for per-card animation state it never uses. Lift has one definition. The `cardViewPropsEqual` comparator (ui-F8) shrinks.
- overlap: new; extends ui-F8
- confidence: high on the call-site facts, medium on the size of the perf win (not measured)

### 02-components-F2 (P3, S) "Where the chips end" is computed in two places; computeScreenPads is a pass-through
- files: components/tableFrame.ts:69-76, 141, 153, 165, 201-216; components/GameTable.tsx:1386; components/NotificationBanner.tsx:96-103; app/(online)/game.tsx:168; tests/native/bannerPlacement.test.tsx:32
- problem: `notificationTopOffset` (tableFrame.ts:201-216) rebuilds the chip bottom from raw inputs: `max(PAD_TOP*s, topPad) + surplus + CHIP_H + PAD_INNER*s`. That is the same value as GameTable's banner band top, `frame.tableTop + CHIP_H(scale) + frame.pad` (GameTable.tsx:1386; tableTop at tableFrame.ts:153, pad at 165). NotificationBanner (96-103) works out `surplusHeight/2` again instead of reading the frame. `computeScreenPads` (tableFrame.ts:69-76) only renames its input fields, so it fails the deletion test. Its four callers are listed above.
- proposed: export one `chipsBottom(frame, scale)` from tableFrame.ts. Make `notificationTopOffset` take a `TableFrame`. Delete `computeScreenPads`.
- effect: one source of truth for the band under the chips. A change to chip padding can no longer move the table and leave the banner behind.
- overlap: new (borders ui-F4 TableLayout)
- confidence: high

### 02-components-F3 (P3, S) Combination-name map lives in two places
- files: components/ReplayControls.tsx:31-38; components/table/pile.tsx:349-356, 571
- problem: `COMBO_NAME_KEYS` (ReplayControls, `rules.combo*Name`, an exhaustive `Record<CombinationType>`) and `COMBO_LABEL_KEYS` (pile, `gameShared.combo*`, a loose `Record<string>`) map the same domain type to two different i18n namespaces. pile falls back to the raw type string at 571, so a new combination type compiles there and shows up untranslated.
- proposed: one `comboNameKey(type: CombinationType)` in spokenLabels.ts, exhaustive, used by both.
- overlap: extends ui-F17, client-F12
- confidence: high

### 02-components-F4 (P3, S) Press feedback is hand-rolled three times
- files: components/MenuButton.tsx:48-61; components/table/actions.tsx:90-104, 231-243
- problem: three copies of the same code: pressed state, a shared value, `withTiming(Motion.tap)`, a reduce-motion snap, and a cancel on unmount. The jscpd inventory flagged this, and it is a real duplicate.
- proposed: a `usePressValue(enabled)` hook that constructs and writes its own shared value (React Compiler requires writes to happen in the hook that constructs the value).
- overlap: confirms the inventory; related to ui-F18
- confidence: medium (the compiler constraint has to be checked when this lands)

### 02-components-F5 (P3, XS) Comments that say something false
- files: components/GameTable.tsx:157-160, 721-727 vs 757; components/useTableFeedback.ts:290; components/HistoryRow.tsx:19-23 vs 25
- problem:
  - GameTable.tsx:157-160 describes "whole-pixel travel, mirroring MenuButton … 2px down". No code follows it, and the table buttons use `BTN_PRESS_SCALE` 0.94 (actions.tsx:28), a scale rather than a translate.
  - useTableFeedback.ts:290 says `BTN_PRESS_SCALE` is in GameTable.tsx. It is in components/table/actions.tsx:28.
  - HistoryRow.tsx:19-23 says the translators are "passed rather than calling the hook", but line 25 calls `useTranslation`.
  - GameTable.tsx:721-727 says the count comes from `sortedHand`; line 757 uses `handOnTable.length`.
- proposed: delete or correct each of them (CLAUDE.md § Comments).
- overlap: new; the GameTable 721-757 one is covered by ticket #1604
- confidence: high

### 02-components-F6 (P3, XS) Rank letter-spacing is defined twice, and the joker rank ignores scale
- files: components/cardFaceModel.ts:139, 154-158; components/CardView.tsx:707, 711-714
- problem: `LETTER_SPACING = -0.5` in cardFaceModel feeds `rankTextWidth`, which is the geometry that keeps index boxes from overlapping. CardView's stylesheet hardcodes `letterSpacing: -0.5` separately, so if one changes, the measured width no longer matches the painted width. `rankTextJoker` also pins `FontSize.xs` / `lineHeight: 12`, which overrides the scaled rank box.
- proposed: import the constant into the style. Derive the joker size from the same scale.
- overlap: new
- confidence: high

### 02-components-F7 (P3, S) The turn sentence is built by three ladders that read two turn sources
- files: components/tableA11y.ts:78-90; components/GameTable.tsx:755-756, 1084, 1223-1242
- problem: tableA11y builds the spoken table state (roundOver > dealing > exchange > yourTurn/turnOf) from `turnShown` and `gameState.currentTurnIndex` (GameTable 755-756). The chip text and `spokenSeat` (1223-1242) run their own ladder from `shownTurnIndex` (1084), which `useShownTurn` holds back until a throw lands. During a throw, the screen reader names the new seat while the chip still shows the old one.
- proposed: one `turnSentence(state, shownTurn)` that both use, fed by the shown turn.
- overlap: extends ui-F10; ticket #1602 (turnKey)
- confidence: high on the divergence, medium on whether it is intended

### 02-components-F8 (P3, XS) Account deletion is reported as failed after it succeeded
- files: components/SettingsModal.tsx:151-168; context/AuthContext.tsx:195-200; server/routes.ts:796-800
- problem: the DELETE succeeds and the server destroys the session (routes.ts:796-800). The modal then calls `onClose()` and `await logout()`. `logout` POSTs `/api/auth/logout` before it clears local state (AuthContext.tsx:195-200). If that POST fails on the network, control lands in the same `catch`, which shows a "deleteFailed" notification and leaves the deleted user cached locally.
- proposed: keep only the DELETE inside the try. On success, clear the session locally and skip the server logout.
- overlap: extends client-F26
- confidence: high on the mechanism, low on how often it happens

### 02-components-F9 (P3, S) Settings rows are spelled out six times
- files: components/SettingsModal.tsx:234-336; components/table/settingsSheet.tsx:304
- problem: every row repeats `row`/`stackRow > rowLeft > RowIcon + label/sublabel + control`. The inventory duplicates (267-281=284-309, 236-248=252-264, 237-246=270-279, 267-276=317-326) are real. The haptics capability check is restated in settingsSheet.tsx:304 (ui-F14).
- proposed: `SettingRow({ icon, label, sublabel, stacked, children })`.
- overlap: new; touches ui-F14
- confidence: high

### 02-components-F10 (P3, XS) Render churn from fresh defaults and per-frame state
- files: components/GameTable.tsx:357, 371, 779; components/useTableFeedback.ts:213-217, 228-234, 355; components/flightPhysics.ts:425-440; components/MenuLayout.tsx:99, 160
- problem:
  - The `placementPoints = {}` (357) and `disconnectedSeats = {}` (371) defaults are new objects on every render for replay, capture and bench callers. `placementPoints` is in the deps of the round-over effect in useTableFeedback (355), so that effect reruns on every render.
  - `readExchange` returns a new object while an exchange is active (flightPhysics.ts:425-440), and that object is in the `tableA11yLabel` memo deps (GameTable 779). The label is recomputed on every render during an exchange.
  - MenuLayout calls `setOffsetY` on every scroll event (160) only to derive one boolean, `hasMore` (99).
  - useTableFeedback computes `shakeOffset` twice (213-217, 228-234).
- proposed: hoist the defaults to module-level constants, key the memo on exchange fields, keep `hasMore` as state that is set only when it changes, and compute `shakeOffset` once.
- overlap: new
- confidence: medium on cost (not measured)

### 02-components-F11 (P3, XS) BenchScreen run latch has no finally
- files: components/BenchScreen.tsx:68-110
- problem: `benchRunning` and the drain interval are reset only on the success path. A throw outside the per-scenario catch (`benchScenarios()`, diag, `recorder.postTo`) leaves the latch set forever and the interval running, and unmount does no cleanup. This is dev-only. The React Compiler forbids try/finally, so the fix has to keep that body in a plain helper.
- proposed: run the body in a non-hook helper with try/finally, and add an unmount cleanup effect.
- overlap: new
- confidence: medium

### 02-components-F12 (P3, XS) ErrorBoundary `FallbackComponent` / `onError` are a hypothetical seam
- files: components/ErrorBoundary.tsx; app/_layout.tsx:152
- problem: the only caller passes neither prop, and no test uses them. They are one adapter's worth of seam with no adapter.
- proposed: delete both props.
- overlap: new
- confidence: high

### 02-components-F13 (P3, XS) flightPhysics restates the deck's jokers
- files: components/flightPhysics.ts:588-597, 615-618, 630-636; lib/game/gameEngine.ts:220-221
- problem: the `JOKERS` literal copies the engine's `createDeck` jokers, and `readThrownPlay` / `readExchangeLegs` copy each other's walk.
- overlap: extends ui-F5; ticket #1603 moves JOKERS
- confidence: high

## Prior findings that are wrong or already fixed

None of the prior findings in this slice are wrong. Status in SRC:
- ui-F1: still present. stagedPlay.ts:57-80 calls `checkSelection` and then `playButtonLabel` (turnTimerUi.ts:45-82). #1596 closed but kept both functions plus a parity test, so it is not fixed.
- ui-F2 / ui-F13 (`cardAtX`): still has no production caller (handLayout.ts:84). It is used only in tests/ui-rules/handLayout.test.ts and named in a comment in tests/e2e/handTapStrips.spec.ts:6.
- ui-F3: ticket #1603 (open). ui-F6, ui-F11, ui-F15 and turnKey: ticket #1602 (open; PR #1630 is not in SRC). ui-F2 / ui-F9 hand row: ticket #1604 (open).
- ui-F4, F7, F8, F10, F12, F14 and F16 are confirmed. Their line numbers have drifted by a few lines (for example, outcome is now at GameTable 800-801).
- client-F28 is a duplicate of ui-F12. client-F26 is extended by F8.

## Inventory items checked
- GameTable.tsx 1686 lines with one 1310-line function: real (ui-F3/F4/F6/F16)
- CardView `CardViewBase` 222 lines: real (F1)
- SettingsModal 378-line component: real (F9)
- NotificationBanner 140, ErrorFallback 130, Slider 127, useTableFeedback 137 long functions: real but mostly JSX/styles. Leave them.
- SettingsModal duplicate blocks (4 pairs): real (F9)
- homeCardField 43-62=53-72 and 87-98=98-106: false positive (data tables)
- MenuButton 54-64 = table/actions.tsx 97-108 / 236-246: real (F4)
- cardFaceModel test-only exports (isWideRank, rankTextWidth, indexBox, PIP_LAYOUTS, PIP_RANKS, placedPips, pipBox, boxesOverlap): real, but a legitimate pure-geometry test seam. Keep them.
- flightPhysics exports (arrivingCard, comboImpactTier, shakeMagnitude, TableGeometry, SeatPlace, INACTIVE_EXCHANGE): used internally and exported for tests, fine. `flightOrigin` is used only by tests.
- handLayout MIN_READABLE_STEP and MAX_STEP_RATIO: fine. `cardAtX` is dead in production (ui-F2).
- GameTable type exports (TurnTimerConfig, ExchangeAnnouncementSlot, GameTableProps): false positive (types)
- seatLayout ACTION_BTN_FLOOR and getOpponentPosition: used internally, fine
- useTableFeedback KICK_JOLTS, ReactionLayer EMOJIS/REACTION_ANCHOR, ReplayControls moveActionText: test seams, fine
- CardView `cardViewPropsEqual`: ui-F8
- jest.mock targets in the slice: GameTable (8 tests), SettingsModal (4), useTableFeedback (2), CardView (2), flightPhysics (1), MenuLayout (1). These are in-house modules mocked at the screen boundary, noted only. The GameTable mock count reflects the 5-adapter `GameTableProps` seam.
- No cycles or layer violations touch the slice.

## Coverage
| file | lines | verdict |
|---|---|---|
| components/tutorialRefusal.ts | 14 | single consumer (app/tutorial.tsx); see client-F24 |
| components/useSameCards.ts | 17 | clean |
| components/UpdateRequired.tsx | 33 | clean |
| components/AppModal.tsx | 45 | clean |
| components/SwitchVisual.tsx | 46 | clean |
| components/RoomKindNote.tsx | 51 | clean (uses module `t`, not the hook; minor) |
| components/fanGeometry.ts | 57 | clean |
| components/Toggle.tsx | 62 | clean |
| components/homeMenuModel.ts | 63 | clean |
| components/flightPose.ts | 64 | clean |
| components/SegmentedControl.tsx | 65 | clean |
| components/ScreenHeader.tsx | 66 | clean |
| components/useHandOrder.ts | 66 | clean |
| components/IconButton.tsx | 67 | clean |
| components/ErrorBoundary.tsx | 70 | F12 |
| components/MenuCard.tsx | 80 | clean |
| components/OfflineBanner.tsx | 87 | clean |
| components/Avatar.tsx | 97 | clean |
| components/handLayout.ts | 98 | ui-F2 (cardAtX dead) |
| components/handOrder.ts | 98 | clean |
| components/SessionReplacedNotice.tsx | 100 | clean |
| components/FormField.tsx | 106 | clean |
| components/tableA11y.ts | 107 | F7; ui-F10 |
| components/homeCardField.ts | 119 | clean (inventory dup false positive) |
| components/turnTimerUi.ts | 125 | ui-F1 |
| components/HistoryRow.tsx | 129 | F5 |
| components/ChoiceChips.tsx | 132 | clean |
| components/StateBlock.tsx | 134 | clean |
| components/DifficultyLadder.tsx | 136 | clean |
| components/ConfirmDialog.tsx | 146 | clean |
| components/BenchScreen.tsx | 154 | F11 |
| components/LookPicker.tsx | 174 | clean (CardView caller, F1) |
| components/MenuButton.tsx | 183 | F4 |
| components/tableArc.ts | 189 | clean |
| components/Slider.tsx | 195 | clean |
| components/ReactionLayer.tsx | 209 | clean |
| components/MenuLayout.tsx | 214 | F10 |
| components/tableFrame.ts | 216 | F2 |
| components/RoomSeatList.tsx | 217 | clean |
| components/seatLayout.ts | 252 | clean (F1 reuses handRowHeadroom) |
| components/NotificationBanner.tsx | 275 | F2 |
| components/ErrorFallback.tsx | 279 | clean |
| components/cardFaceModel.ts | 357 | F6 |
| components/ReplayControls.tsx | 410 | F3 |
| components/useTableFeedback.ts | 434 | F5, F10; ui-F15 |
| components/SettingsModal.tsx | 552 | F8, F9; ui-F14 |
| components/flightPhysics.ts | 650 | F13; ui-F3, ui-F4, ui-F5 |
| components/CardView.tsx | 721 | F1, F6; ui-F8 |
| components/GameTable.tsx | 1686 | F5, F7, F10; ui-F3, F4, F6, F7, F10, F11, F12, F16; tickets #1602, #1603, #1604 |
