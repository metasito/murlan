# Split gameTableModel.ts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `components/gameTableModel.ts` (1754 lines, 100 exports, 36 importers) into five files, one per concern, with no behavior change.

**Architecture:** Move code by concern into five new sibling files under `components/`. During the move, `gameTableModel.ts` temporarily re-exports from the new files so every task keeps the build green; the final task repoints all 36 importers at the new files directly and deletes `gameTableModel.ts`. No new abstractions, no new dependencies — this is a pure reorganization.

**Tech Stack:** TypeScript, React Native / Expo. No new libraries.

**Spec:** This plan is the spec — see "Why" in the linked GitHub issue for the deepening rationale (module/interface/depth vocabulary).

## Global Constraints

- **No behavior change.** Every moved function keeps its exact signature and body. If a diff to a moved function's logic is needed, it does not belong in this plan.
- **`readThrownPlay` (flight physics) calls `seatDirection` (seat layout) at `gameTableModel.ts:1723`.** This is a real cross-file dependency, not shared mutable state — `flightPhysics.ts` imports `seatDirection` from `./seatLayout`. Keep the import direction one-way: `seatLayout.ts` must never import from `flightPhysics.ts`.
- **`FLIGHT_MS = Motion.duration.travel`** and other `Motion.*`/`Spacing.*` token reads come from `lib/theme.ts` in every group — no group defines its own copy, all import the token directly from `lib/theme.ts`, matching current behavior.
- **This is not a task you can verify with a unit test alone.** Per `CLAUDE.md`: `@testing-library/react-native` runs on `react-test-renderer`, which never runs flexbox — layout bugs are invisible to it. `tests/e2e/` (Playwright: `seatFans.spec.ts`, `tableProportions.spec.ts`, `feltParityGrid.spec.ts`) is what actually exercises this file's layout math. Every task below runs `npx tsc --noEmit` and the relevant `node --test`/native suites as its fast loop; the final task additionally runs the three Playwright specs once before considering the change done.

---

## File structure

| New file | Concern | Exports (from `gameTableModel.ts`, current line numbers) |
|---|---|---|
| `components/seatLayout.ts` | Seat/hand layout geometry | `SIDE_SECTION_W`, `ACTION_BTN_FLOOR`, `HAND_ZONE_GAP`, `actionBtnSize`, `CHIP_H`, `handRowHeadroom`, `HAND_CROP`, `handVisibleH`, `HAND_ZONE_H`, `exchangeArrivalRise`, `HAND_WIDTH_SHARE`, `FIELD_WIDTH_SHARE`, `COMBO_MAX_TILT`, `cardTilt`, `FlyDirection`, `OpponentSide`, `FAN_DRAWN_CARDS`, `getOpponentPosition`, `seatDirection`, `LightPosition`, `LAMP_CENTRE`, `lightPosition`, `SeatedPlayer`, `OpponentArrangement`, `arrangeOpponents`, `handCountOf`, `vacatedOf`, `displayedHandCount`, `FanCounts`, `fanCounts`, `SEAT_DISC`, `seatGap`, `SEAT_LABEL_GAP`, `SEAT_LABEL_PAD`, `seatLabelH`, `seatFanArc`, `sideSlotHeight`, `viewerOwnsSeat` (lines 36–233, 261–344, 684–747, 1451–1461) |
| `components/flightPhysics.ts` | Card-flight/pile physics, impact feedback | `PileState`, `EMPTY_PILE`, `arrivingCard`, `FLIGHT_MS`, `LANDING_FRACTION`, `impactDelayMs`, `landingHoldMs`, `LAND_SQUASH`, `landSquashScale`, `settleForMotion`, `ImpactTier`, `comboImpactTier`, `landingTier`, `traumaFor`, `flinchFor`, `shakeMagnitude`, `shakeAmplitudeFor`, `shakeOffset`, `FlareKind`, `flareKindFor`, `sparksFor`, `lampLiftFor`, `SPARK_COUNT`, `SparkOffset`, `sparkOffset`, `FlightOriginInput`, `flightOrigin`, `ExchangeFlightInput`, `ExchangeFlight`, `exchangeFlight`, `TAG_MAX_W`, `comboKey`, `advancePile`, `roundClosedWithWinner`, `passedSeats`, `ExchangeView`, `INACTIVE_EXCHANGE`, `readExchange`, `HandArrival`, `readHandArrival`, `rotateGlyphAngle`, `ROTATE_UPRIGHT`, `ROTATE_SETTLED`, `straightTopRankChar`, `ThrownPlay`, `ThrownPlayInput`, `readThrownPlay` (lines 344–684, 747–1084, 1659–1754). Imports `seatDirection` from `./seatLayout`. |
| `components/turnTimerUi.ts` | Turn-timer / play-button labels | `TurnFacts`, `canPassNow`, `PlayButtonLabel`, `ComboShape`, `playButtonLabel`, `URGENT_TICK_SECONDS`, `urgentThresholdSeconds`, `openingIsPending` (re-export from `../lib/gameEngine.ts`), `turnTimerActive` (lines 1084–1215) |
| `components/tableFrame.ts` | Screen-frame / safe-area math | `EdgeInsets`, `surplusHeight`, `ScreenPads`, `computeScreenPads`, `CutoutClass`, `cutoutClass`, `railWidth`, `RailSide`, `LANDSCAPE_LEFT`, `railSideForOrientation`, `railSideFor`, `TableFrame`, `computeTableFrame`, `notificationTopOffset` (lines 1215–1451) |
| `components/tableA11y.ts` | Accessibility string-building | `TableA11yOpponent`, `TableA11yLastPlay`, `TableA11yExchange`, `TableA11yStrings`, `TableA11yInput`, `describeTableForA11y` (lines 1562–1659) |

Also re-exported unchanged in `gameTableModel.ts` today and needing a new home: `CARD_H`, `CARD_W`, `cardScale` (line 33, re-exported from `./cardFaceModel.ts` — move this re-export line to whichever new file's callers need it, or leave it in `cardFaceModel.ts` importers to import directly; confirm at Task 6 which importers use it and point them at `./cardFaceModel` directly rather than carrying a second re-export).

---

## Task 1: Create `seatLayout.ts`

**Files:**
- Create: `components/seatLayout.ts`
- Modify: `components/gameTableModel.ts` (remove moved code, add `export * from "./seatLayout"`)

**Interfaces:**
- Produces: every export listed in the "seatLayout.ts" row above, unchanged signatures.

- [ ] **Step 1: Create `components/seatLayout.ts`** with the seat/hand-layout exports from the table above, moved verbatim (same code, same JSDoc/comments if any). Import `Motion`/`Spacing` from `../lib/theme` and `Player`/`Combination` types from wherever `gameTableModel.ts` currently imports them (check its top-of-file imports).
- [ ] **Step 2: In `gameTableModel.ts`, delete the moved code** and add `export * from "./seatLayout";` near the top so every existing importer keeps working unchanged.
- [ ] **Step 3: Run `npx tsc --noEmit`.** Expected: no errors. If there are errors about a symbol used by code still in `gameTableModel.ts` (e.g. `readThrownPlay` calling `seatDirection`), add `import { seatDirection } from "./seatLayout";` at the top of `gameTableModel.ts` for now — it'll be cleaned up when that function moves in Task 2.
- [ ] **Step 4: Run the native suites that touch seat layout:** `node --test tests/seatReclaim.test.ts` (if it exists as a plain node test) and `npx jest tests/native/seatFanDeparting.test.tsx` (adjust command to this repo's actual jest invocation — check `package.json`'s `test:native` script). Expected: PASS, unchanged.
- [ ] **Step 5: Commit.**

```bash
git add components/seatLayout.ts components/gameTableModel.ts
git commit -m "refactor: extract seat/hand layout geometry into seatLayout.ts"
```

---

## Task 2: Create `flightPhysics.ts`

**Files:**
- Create: `components/flightPhysics.ts`
- Modify: `components/gameTableModel.ts` (remove moved code, add `export * from "./flightPhysics"`)

**Interfaces:**
- Consumes: `seatDirection` from `./seatLayout` (Task 1).
- Produces: every export listed in the "flightPhysics.ts" row above.

- [ ] **Step 1: Create `components/flightPhysics.ts`** with the flight/pile-physics exports moved verbatim. `readThrownPlay` now imports `seatDirection` from `./seatLayout` directly instead of relying on `gameTableModel.ts`'s re-export.
- [ ] **Step 2: In `gameTableModel.ts`, delete the moved code**, add `export * from "./flightPhysics";`, and remove the now-redundant `seatDirection` import added in Task 1 Step 3 (it's `flightPhysics.ts`'s problem now, not `gameTableModel.ts`'s).
- [ ] **Step 3: Run `npx tsc --noEmit`.** Expected: no errors.
- [ ] **Step 4: Run the flight/physics native and e2e suites:** `npx jest tests/native/flightRestPose.test.tsx tests/native/flightFloor.test.tsx tests/native/tableShakeReducedMotion.test.tsx tests/native/bombBurstNodeBudget.test.tsx tests/native/lampFlareEndToEnd.test.tsx tests/native/lampFlareReducedMotion.test.tsx tests/native/lampFlareWiring.test.tsx tests/native/onlinePartitaShake.test.tsx tests/native/exchangeAnnounceBothWays.test.tsx` (adjust to the repo's actual jest command). Expected: PASS, unchanged.
- [ ] **Step 5: Commit.**

```bash
git add components/flightPhysics.ts components/gameTableModel.ts
git commit -m "refactor: extract card-flight/pile physics into flightPhysics.ts"
```

---

## Task 3: Create `turnTimerUi.ts`

**Files:**
- Create: `components/turnTimerUi.ts`
- Modify: `components/gameTableModel.ts`

**Interfaces:**
- Produces: `TurnFacts`, `canPassNow`, `PlayButtonLabel`, `ComboShape`, `playButtonLabel`, `URGENT_TICK_SECONDS`, `urgentThresholdSeconds`, `openingIsPending`, `turnTimerActive`.

- [ ] **Step 1: Create `components/turnTimerUi.ts`** with the turn-timer/play-button exports moved verbatim, including the `export { openingIsPending } from "../lib/gameEngine.ts";` re-export line.
- [ ] **Step 2: In `gameTableModel.ts`, delete the moved code**, add `export * from "./turnTimerUi";`.
- [ ] **Step 3: Run `npx tsc --noEmit`.** Expected: no errors.
- [ ] **Step 4: Run `npx jest tests/native/bannerBand.test.tsx tests/native/bannerPlacement.test.tsx`** (or whichever native tests cover `turnTimer.tsx`/`playButtonLabel` — check `components/table/turnTimer.tsx`'s existing test coverage). Expected: PASS, unchanged.
- [ ] **Step 5: Commit.**

```bash
git add components/turnTimerUi.ts components/gameTableModel.ts
git commit -m "refactor: extract turn-timer/play-button labels into turnTimerUi.ts"
```

---

## Task 4: Create `tableFrame.ts`

**Files:**
- Create: `components/tableFrame.ts`
- Modify: `components/gameTableModel.ts`

**Interfaces:**
- Produces: `EdgeInsets`, `surplusHeight`, `ScreenPads`, `computeScreenPads`, `CutoutClass`, `cutoutClass`, `railWidth`, `RailSide`, `LANDSCAPE_LEFT`, `railSideForOrientation`, `railSideFor`, `TableFrame`, `computeTableFrame`, `notificationTopOffset`.

- [ ] **Step 1: Create `components/tableFrame.ts`** with the screen-frame/safe-area exports moved verbatim.
- [ ] **Step 2: In `gameTableModel.ts`, delete the moved code**, add `export * from "./tableFrame";`.
- [ ] **Step 3: Run `npx tsc --noEmit`.** Expected: no errors.
- [ ] **Step 4: Run `npx jest tests/native/resultCutoutRail.test.tsx` and `npx tsx tests/e2e/feltParityGrid.spec.ts --list`** (or the repo's normal way of confirming a Playwright spec still compiles — do not run the full Playwright suite here, per the "loop vs. gate" rule in `docs/agents/issue-tracker.md`: a Playwright spec belongs in the gate, not the loop). Expected: PASS / compiles clean.
- [ ] **Step 5: Commit.**

```bash
git add components/tableFrame.ts components/gameTableModel.ts
git commit -m "refactor: extract screen-frame/safe-area math into tableFrame.ts"
```

---

## Task 5: Create `tableA11y.ts`

**Files:**
- Create: `components/tableA11y.ts`
- Modify: `components/gameTableModel.ts`

**Interfaces:**
- Produces: `TableA11yOpponent`, `TableA11yLastPlay`, `TableA11yExchange`, `TableA11yStrings`, `TableA11yInput`, `describeTableForA11y`.

- [ ] **Step 1: Create `components/tableA11y.ts`** with the accessibility-string exports moved verbatim.
- [ ] **Step 2: In `gameTableModel.ts`, delete the moved code**, add `export * from "./tableA11y";`.
- [ ] **Step 3: Run `npx tsc --noEmit`.** Expected: no errors.
- [ ] **Step 4: Run `npx jest tests/native --testPathPattern "a11y|spokenLabels"`** (adjust to whatever native tests cover `components/table/spokenLabels.ts`, the main consumer). Expected: PASS, unchanged.
- [ ] **Step 5: Commit.**

```bash
git add components/tableA11y.ts components/gameTableModel.ts
git commit -m "refactor: extract accessibility string-building into tableA11y.ts"
```

---

## Task 6: Repoint all 36 importers, delete the barrel, final verification

**Files:**
- Modify: all 36 files currently importing from `./gameTableModel` (or a relative path to it) — see list below.
- Delete: `components/gameTableModel.ts`

**Interfaces:**
- Consumes: the five new files from Tasks 1–5.

- [ ] **Step 1: List current importers and what they import**, to confirm nothing changed since planning:

```bash
grep -rl "from ['\"].*gameTableModel['\"]" --include="*.ts" --include="*.tsx" .
```

Expected files (36, confirm the count still matches): `tests/native/lampFlareEndToEnd.test.tsx`, `components/table/chrome.tsx`, `components/useTableFeedback.ts`, `components/GameTable.tsx`, `context/OnlineGameContext.tsx`, `app/(online)/game.tsx`, `tests/native/exchangeAnnounceBothWays.test.tsx`, `context/GameContext.tsx`, `components/table/seats.tsx`, `components/table/pile.tsx`, `components/table/hand.tsx`, `components/ExchangeAnnouncement.tsx`, `tests/native/flightRestPose.test.tsx`, `tests/native/resultCutoutRail.test.tsx`, `tests/native/lampFlareReducedMotion.test.tsx`, `components/useRailSide.ts`, `components/table/ExchangeFlight.tsx`, `components/ResultBoard.tsx`, `components/NotificationBanner.tsx`, `app/game.tsx`, `tests/native/tableShakeReducedMotion.test.tsx`, `components/table/moments.tsx`, `tests/native/bombBurstNodeBudget.test.tsx`, `tests/native/lampFlareWiring.test.tsx`, `tests/native/onlinePartitaShake.test.tsx`, `components/table/settingsSheet.tsx`, `components/table/rotateOverlay.tsx`, `components/table/spokenLabels.ts`, `tests/e2e/seatFans.spec.ts`, `components/table/turnTimer.tsx`, `tests/native/bannerBand.test.tsx`, `tests/native/bannerPlacement.test.tsx`, `tests/e2e/tableProportions.spec.ts`, `tests/e2e/feltParityGrid.spec.ts`, `tests/native/seatFanDeparting.test.tsx`, `tests/native/flightFloor.test.tsx`.

- [ ] **Step 2: For each file, replace its `gameTableModel` import with imports from the specific new file(s) each symbol now lives in**, per the table at the top of this plan. Most files import from only one or two of the five new files — e.g. `components/table/turnTimer.tsx` needs only `./turnTimerUi`, `components/table/spokenLabels.ts` needs only `./tableA11y`. Where a file imports symbols from more than one new module (e.g. `components/GameTable.tsx` likely needs several), add one import line per source file rather than a combined re-export.
- [ ] **Step 3: Delete `components/gameTableModel.ts`.**
- [ ] **Step 4: Run `npx tsc --noEmit`.** Expected: no errors — this is the real safety net for Step 2; a missed or misrouted import fails here immediately.
- [ ] **Step 5: Run the full native/unit suite** (`npm run test:native` or this repo's equivalent — check `package.json`). Expected: PASS, unchanged.
- [ ] **Step 6: Run the three Playwright specs that exercise this file's layout math once, as the gate** (per `docs/agents/issue-tracker.md`'s loop-vs-gate rule — these do not belong in the fast loop): `tests/e2e/seatFans.spec.ts`, `tests/e2e/tableProportions.spec.ts`, `tests/e2e/feltParityGrid.spec.ts`. Expected: PASS, unchanged — this is what actually catches a layout regression per `CLAUDE.md`'s "no unit test can see a layout bug" pitfall.
- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "refactor: repoint gameTableModel importers at the five split modules, delete the barrel"
```

---

## Self-review notes

- **Spec coverage:** all five concerns from the candidate (flight/pile physics, seat/hand layout, screen-frame/safe-area, accessibility strings, turn-timer/play-button labels) each get one task and one file. The `CARD_H`/`CARD_W`/`cardScale` re-export line and `viewerOwnsSeat` are called out explicitly so they aren't dropped silently.
- **Cross-file dependency:** `flightPhysics.ts` → `seatLayout.ts` (via `readThrownPlay` → `seatDirection`) is named as a Global Constraint and handled explicitly in Task 2, so it doesn't surprise whoever executes Task 2.
- **Type consistency:** every task's Interfaces block names the exact exports it produces; Task 6 is the only task consuming across all five, and its Step 2 is deliberately per-file rather than a blanket regex, since a combined re-export would just recreate the shallow grab-bag this plan is trying to remove.
