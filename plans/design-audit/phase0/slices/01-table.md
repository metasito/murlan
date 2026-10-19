# 01-table — slice review (SRC 50144087)

Every one of the 76 files was read in full. Confirmations of earlier `ui.md`/`client.md` findings that SRC still shows are listed under "Prior findings". Only new evidence or a sharper fix appears as a finding.

## Findings

### 01-table-F1 (P2, S) The exchange's spoken line and its visual note are two homes for one sentence, and they disagree
- **files:**
  - `components/table/ExchangeLegs.tsx:283-295` (`nameOf`, `shown`, `giveLine`, `a11yLabel`)
  - `components/GameTable.tsx:1123-1139` (`giveNote`, `pileNote`)
- **problem:**
  - Visual: `giveNote` speaks to the viewer: `exchange.pileYouGive` / `exchange.pileGivesYou`, and third person only for spectators of other seats.
  - Spoken: `giveLine` always uses `exchangeAnnouncement.giveLine` with both names in the third person. A screen-reader user who gives a card hears their own name, never "you".
  - The two also decide *which leg is told* differently:
    - The visual shows one leg: receive at `"rest"`, else give at `"rest"`.
    - The spoken label joins both legs as soon as each stage is past `waiting`/`flying`.
  - So the two channels differ in both wording and timing for the same exchange.
- **proposed:**
  - One pure function, `exchangeLine(leg: {card; from; to}, viewerSeat, spectating, names, t): string`, beside `spokenLabels.ts`.
  - One stage rule, `toldLegs(stages): ("receive"|"give")[]`.
  - Both GameTable's pile note and ExchangeLegs' `a11yLabel` call these.
  - The spoken form may still use `cardSpokenName` where the visual uses `shortName`, via a `{spoken: boolean}` flag.
- **effect:**
  - The divergence class (the a11y line drifting from the visible one) goes.
  - About 15 lines leave GameTable, which is a step on ui-F3's "no module owns the exchange as shown".
  - A node test can pin viewer-is-giver / viewer-is-receiver / spectator in one place.
- **overlap:** extends ui-F3. ui-F3 noted the two sentences are "nearly the same"; they are in fact different in person and in leg selection.
- **confidence:** high (both code paths and the locale keys read).

### 01-table-F2 (P2, S) "The play that ended the round has landed" is decided four times, behind a call-order contract
- **files:**
  - `components/table/useRoundEnding.ts:28-31, 87-106`
  - `components/table/useRoundOutcome.ts:7-11, 25-28`
  - `components/GameTable.tsx:868-889` (two `useRoundEnding`, two `useRoundOutcome` calls)
- **problem:**
  - Each hook re-derives "ended, nothing in flight, nothing pending" from `timeline.inFlight` and `timeline.pending()`.
  - Each carries the same prose contract: it must be called after `usePileFlight`, because `pending()` is read at call time. That ordering is enforced by comment only.
  - The four call sites feed different `ended` expressions:
    - The round clock gets `roundOver && !matchOver && (onRoundLanded !== undefined || roundVote !== null)`.
    - The round outcome gets `roundOver && !matchOver`.
  - So the outcome burst and the ending clock can disagree on whether a round ended. That is intended or not; nothing states it.
- **proposed:**
  - `usePileFlight` (the module that owns the throw) returns `endedLanding(ended: boolean): number | null`, the landing time of the ending play or null. Alternatively, `tableTimeline` gains `landedSince(at: number): number | null`.
  - The two hooks take that landing time as input instead of `timeline`, which also removes the ordering contract.
  - `useRoundOutcome` becomes `ended && landedAt !== null && outcome !== "pending" ? outcome : null`, with the latch kept.
- **effect:**
  - Two copies of the gate and two ordering comments are deleted.
  - A new ending consumer cannot read `pending()` before the throw is registered.
  - `tests/native/roundEndingStart.test.tsx` feeds a time instead of a fake timeline.
- **overlap:** new
- **confidence:** medium. The duplication is verified. Whether the differing `ended` inputs cause a visible defect is not.

### 01-table-F3 (P2, S) The lamp level has three writers that guess ownership from the target value
- **files:**
  - `components/table/useLampRig.ts:88-89` (round-lost dim; releases only `if (s.lvlT === RoundMoment.lostLevel)`)
  - `components/table/useLampRig.ts:100-119` (deal breath; bails `if (s.lvlT !== BREATH_FROM)`)
  - `components/table/useLinkHold.ts:69` (`rig.setLevel(lost ? Reconnect.lamp : 1, …)`)
  - `components/table/lampRig.ts:185` (`setLevel`)
- **problem:**
  - Three effects write one `lvlT`. Two infer "this level is mine" by comparing the current target with their own constant, and the third does no inference at all.
  - Example: a link that drops and recovers during a lost round's dim resets the level to 1 and ends the dim early.
  - Another example: if 0.8 ever equals another writer's level, the dim release fires on someone else's hold.
  - The class is "last writer wins on a shared knob".
- **proposed:**
  - In `lampControls`: `hold(s, owner: "lost" | "breath" | "link", level: number | null, rate)`.
  - `Lamp` carries `holds: Record<owner, number>`, and the effective target is `min(1, …holds)`.
  - `setLevel` leaves the public `LampRig` and is replaced by `hold`.
- **effect:**
  - The two sentinel comparisons go.
  - Each writer releases only its own hold.
  - One `lampRig.test.ts` case covers overlap. Today no test covers it.
- **overlap:** new
- **confidence:** medium. The writes and guards are verified. The overlap sequence is inferred, not reproduced.

### 01-table-F4 (P3, XS) `LampRig.flare()` and `kick()` are interface with no caller
- **files:**
  - `components/table/useLampRig.ts:25-26` (interface)
  - `components/table/useLampRig.ts:153-168` (wrappers)
- **problem:**
  - Nothing outside the hook calls `rig.flare` or `rig.kick`; a grep of SRC finds no caller.
  - The landing and bomb reactions inside the hook call `lampControls.flare`/`kick` directly, at 130 and 138-139.
  - Only `freeze` (`GameTable.tsx:955`, `useLinkHold.ts:34`) and `setLevel` (`useLinkHold.ts:69`) are used.
  - Deletion test: deleting the two wrappers changes nothing.
- **proposed:** `LampRig` becomes `{ lamp; glossLight; sx; sy; freeze; setLevel }`, or `hold` after F3.
- **effect:** 10 lines go and the interface shrinks to what is used.
- **overlap:** new
- **confidence:** high

### 01-table-F5 (P3, S) Both particle adapters re-state the per-frame scene step, and the web one never idles
- **files:**
  - `components/table/particleLayer.tsx:86-108`
  - `components/table/particleLayer.web.tsx:101-131`
- **problem:**
  - The seam between the two is real (Skia Atlas vs 2D canvas). But the step order sits in both adapters and must stay in lockstep by hand:
    - `emberFrame`
    - `coneRainFrame`
    - `step`
    - `stepAir`, with its moth trace
    - `layout`
    - `layoutMotes`
    - `mothPose`
  - The native adapter skips idle frames (`:92-94`). The web adapter clears and redraws every rAF tick forever, including at rest with no lit motes.
  - Tests observe the landing dust by `jest.mock`-spying `particles.landingDust` in 5 files (`tests/native/landingDust.test.tsx:5`, `hiddenThrows.test.tsx:5`, `landingNotDropped`, `landingOnContact`, `dealFeel`), because the layer offers no observation point.
- **proposed:**
  - One worklet in `particleSprites.ts`: `stepScene(scene: {s: Particles; air: Air; ember: EmberRun; rain: RainRun}, l: AirLight, dt: number, reduced: boolean, rng: Rng, out: Float32Array): {lit: number; moth: MothPose | null; mothSet: boolean; idle: boolean}`.
  - Each adapter keeps only its draw.
  - The web loop returns early on `idle` the way native does.
- **effect:**
  - About 10 duplicated lines become one call.
  - Web stops redrawing an idle table.
  - The spy tests could instead read `scene` through the existing `useTraceSource` hooks.
- **overlap:** new. The inventory's "dup 27-34 = 9-16" is only the import list, so it is not this finding.
- **confidence:** high

### 01-table-F6 (P3, XS) GIOCA and PASSA each hand-roll the press scale, and the garnet gradient stops live twice
- **files:**
  - `components/table/actions.tsx:82-106` and `224-245`
  - `components/table/actions.tsx:49` (`PASS_GRADIENT_LOCATIONS`)
  - `components/table/settingsSheet.tsx:169` (`EXIT_GRADIENT_LOCATIONS`, the same `[0, 0.22, 0.6, 1]`, both under `Gradient.garnet`)
- **problem:**
  - The inventory duplicate is real: the same `setPress`/`pressVal`/cancel/`pressStyle` block appears twice.
  - The gradient's stops belong to the gradient, yet each consumer restates them.
- **proposed:**
  - `usePressScale(enabled: boolean): { onPressIn; onPressOut; style }` in actions.tsx.
  - `Gradient.garnet` becomes `{ colors, locations }` in `lib/tokens.ts`.
- **effect:** about 20 lines go, and a third garnet surface cannot get the stops wrong.
- **overlap:** new (inventory dup confirmed)
- **confidence:** high

### 01-table-F7 (P3, XS) Comments that are false in SRC
- **files and problems:**
  - `components/table/hand.tsx:311-313`: "the stagger is disarmed one render after the hand appears, so `dealDelay` becomes -1 while this card is still flying in". The only caller passes `descending ? 0 : -1` (`hand.tsx:1355`), so nothing disarms a stagger. `dealDelayRef` defends against a change that no longer happens.
  - `components/table/hand.tsx:378-379`: "-1 sunk and faded, … +1 lifted and lit". The file's own 103-107 says neither state *moves*, and `exchangeState` drives only opacity and halo.
  - `components/table/hand.tsx:109`: "works on both — an array serialises to `[object Object]` on web" is the tail of a sentence whose head is gone.
  - `components/table/hand.tsx:119-129` (giveable-halo block): describes a fill with no constant or code following it.
  - `components/table/moments.tsx:284-286`: cites `pileStyles.flyingContainer, Layer.sheet`. No `flyingContainer` exists anywhere in SRC; flights sit at `pileGroupZ` (`cardShadows.ts`).
  - `components/table/actions.tsx:310-312`: describes `btnDimFace` but sits above `passBtnOnlyMove`.
- **proposed:** delete or correct each one. Delete `dealDelayRef` with ui-F9's boolean.
- **effect:** no stale guidance at the z-order and deal sites that CLAUDE.md invariants already watch.
- **overlap:** extends ui-F9 (first item)
- **confidence:** high

### 01-table-F8 (P3, XS) Opponent slots take `cardCount` as optional, with a fallback that would show the wrong number
- **files:**
  - `components/table/seats.tsx:616, 633` (TopOppSlot)
  - `components/table/seats.tsx:794, 811` (SideOppSlot)
  - `components/GameTable.tsx:1430, 1456, 1537`
- **problem:**
  - Both slots use `held = cardCount ?? player.hand.length`, with `cardCount?: number`.
  - Every caller passes `seatCount(...)`, which includes the exchange shift. The fallback is dead.
  - The fallback would also be wrong if reached: `player.hand.length` ignores the shift, and an online opponent's hand is not the viewer's to read.
- **proposed:** make `cardCount: number` required and delete the fallback.
- **effect:** one wrong default is gone, and it falls out of ui-F6's slot merge for free.
- **overlap:** extends ui-F6
- **confidence:** high

### 01-table-F9 (P3, XS) `StraightHand` publishes card origins on every render
- **files:**
  - `components/table/hand.tsx:1075-1097` (`useEffect` without deps)
  - `components/GameTable.tsx:837-840` (`onHandOrigins` writes into a ref map)
- **problem:**
  - After every render of the hand, the effect allocates a new Map holding N `liveFrom` objects with three closures each.
  - The origins are already lazy (getters reading shared values). Only the geometry inputs (`rest`, `arc`, `place`, `rowCentreY`, `visibleH`, `crop`, `cardW`, `cardH`, `fieldW`, `panLimit`) change what they return.
  - This is the third copy of the hand-row geometry (ui-F2).
- **proposed:** give the effect those deps. Better, have ui-F2's `handRowLayout` return `originOf(id)` and pass that one function up instead of a Map.
- **effect:** no per-render allocation on the most-rendered table component, and one less geometry loop once ui-F2 lands.
- **overlap:** extends ui-F2
- **confidence:** medium. The cost is small. The duplication is the real point.

### 01-table-F10 (P3, XS) `useCardRect` takes its mapper inputs from a private worklets field
- **files:** `components/table/useCardRects.ts:102`: `startMapper(publish, Object.values((read as { __closure?: … }).__closure ?? {}))`
- **problem:**
  - `__closure` is an internal of the worklets Babel plugin.
  - If it is renamed or reshaped, the `?? {}` turns it into "no inputs". The mapper then never re-runs, and every card rect goes silently stale.
  - That is the layout-bug class CLAUDE.md says no unit test sees. No check pins it.
- **proposed:** `useCardRect(key, read, inputs: readonly SharedValue<unknown>[])`, with callers naming what `read` reads. Alternatively, a test that fails when `__closure` is absent on a worklet.
- **effect:** the dependence on a library internal becomes explicit or guarded.
- **overlap:** new
- **confidence:** medium (the failure mode is inferred from the fallback)

### 01-table-F11 (P3, XS) Notice timing puts a reading hold in `Motion` and ignores reduced motion for two shapes
- **files:**
  - `components/table/noticeModel.ts:207-215`
  - `lib/tokens.ts:581` (`Motion.mark`)
- **problem:**
  - `chip` and `float` take `Motion.mark.{enter, hold, exit}` whatever `reduceMotion` is. `pill` goes through `motionMs("notice", reduceMotion)`.
  - `hold: 1000` is a reading duration, which components/CLAUDE.md says belongs in `Reading`, not `Motion`.
- **proposed:** `hold: Reading.mark`, and enter/exit via `motionMs("mark", reduceMotion)`.
- **effect:** one rule for notice timing, and the token audit stops seeing a reading time in `Motion`.
- **overlap:** new
- **confidence:** medium. Whether chips should collapse under reduced motion is a design call.

### 01-table-F12 (P3, XS) Unused motion knob and component-literal durations
- **files:**
  - `components/table/moments.tsx:363-368`: `Sweep`'s `durationMs` prop is never passed (`GameTable.tsx:1183`).
  - `components/table/chrome.tsx:219`: `HAND_LIFT_MS = 500`.
  - `components/table/hand.tsx:96`: `DEAL_DURATION_MS = 500`.
- **problem:**
  - A parameter with one value is a hypothetical seam.
  - The two 500 ms literals are motion durations outside `Motion`, so they escape the reduced-motion and token checks.
- **proposed:** drop the `durationMs` prop and use `SWEEP_MS`. Move both literals to `Motion.duration.*`.
- **effect:** three fewer local knobs.
- **overlap:** extends ui-F9 (`DEAL_DURATION_MS`)
- **confidence:** high

## Prior findings that are wrong or already fixed

### Wrong or drifted
- **ui-F3, line drift:** the ExchangeLegs `giveLine` cited at 280-290 is now at 286-290. The finding also understates it: the sentences differ in grammatical person and in leg selection (01-table-F1).
- **ui-F7, line range:** cites `seats.tsx:278-319` for CountdownRing. In SRC, CountdownRing spans 256-381, with the Date.now accumulation inside. The finding still holds.
- **ui-F13:** the claim that `flightPhysics.test.ts:753-757` checks only `celebrateGoingOut` was not re-checked here (it is a test file outside this slice). Nothing in `pile.tsx` contradicts it.

### Confirmed unchanged in SRC
- **ui-F1:** `stagedPlay.ts:57-81` still throws away `check.code` and asks `playButtonLabel`. `spokenLabels.ts:138-142` re-decides not-your-turn and finished on top of it.
- **ui-F2:** `hand.tsx` geometry is still in three loops: 1005-1026, 1075-1097 and 1309-1371. `cardAtX` is still called only by tests.
- **ui-F4:** `pile.tsx` `usePileFlight` takes 26 inputs, rebuilds geometry at 715-728, and has deps at 799-825.
- **ui-F6:** TopOppSlot 601-665 and SideOppSlot 777-846.
- **ui-F7:** `hud.tsx` TurnChip, `seatMarks.tsx` ReconnectingMark, and `seats.tsx` CountdownRing.
- **ui-F8:** `hand.tsx:568-600`.
- **ui-F9:** `hand.tsx:1355`.
- **ui-F14:** `hand.tsx:1431` (`"clip" as "hidden"`), `seats.tsx:489, 737` (`dataSet` casts), `settingsSheet.tsx:304` (haptics check), and `greyLayer.tsx`/`useLinkHold.ts` (iOS grey).
- **ui-F17:** `pile.tsx:349` `Record<string, TranslationKey>`.
- **ui-F18:** `hand.tsx` has 9 `cancelAnimation` calls; `moments.tsx` Flare/Wave reset at 162-179 / 243-259.
- **client-F18:** the e2e env literal is still gated at module level in `useCardRects.ts`, `feltCanvas.tsx`, `feltReady.ts` and `feltSkia.web.tsx`.
- **Leave-alone list:** every module ui.md marked "already deep" in this slice still is: trick, tableTimeline, useFlightClock, useLandingReaction, useBombBeat, TableNotice/noticeModel, scorePillModel, cardRects/useCardRects, cardShadows, dealPose, dealSlots, lampRig, particles, spokenLabels, selection, and the `.web.tsx` seams.

## Inventory items checked (real / false positive, one line each)

### Sizes and long functions
- **Large modules** (hand.tsx 1496, seats.tsx 980, pile.tsx 941, scorePill.tsx 531): real. hand, seats and pile are covered by ui-F2/F6/F4/F9. scorePill is long but cohesive (one painter plus the PX table): leave.
- **Long function StraightHand (803):** real (ui-F2, F9).
- **Long function CardItemBase (302):** real (ui-F9).
- **Long function usePileFlight (278):** real (ui-F4).
- **Long function ScorePill (260):** real size, cohesive. Leave.
- **Long function GameSettingsSheet (195):** real size, mostly rows. Leave.
- **Long function SeatRing (185):** real size, one ring painter. Leave.
- **Long function ExchangeLegs (161):** real (ui-F3, 01-table-F1).
- **Long function GiocaButton (158):** real, with a press block duplicated with PASSA (01-table-F6).
- **Long function PileLayer (158):** real size, layout-only. Leave.
- **Long function TurnChip (144):** real (ui-F7).
- **Long function useLampRig (142):** real (01-table-F3, F4).
- **Long function ParticleLayer (135):** real (01-table-F5).
- **Long function PlayGroup (128):** real size, cohesive. Leave.
- **Long function CountdownRing (126):** real (ui-F7).

### Cycle
- **particles.ts <-> air.ts:** false positive at runtime. `air.ts:7` imports `Rng` with `import type`, so only `particles → air` (`MOTES`) exists at runtime. Moving `Rng` to air.ts or a types file would silence the tool if wanted.

### Test-only exports
All of these pin the mockup's numbers and are deliberate; real, harmless:
- cardShadows (ShadowKind, shadowKind, inPath, castOffset…)
- noticeModel (selectorBox, selectorGlow)
- lampRig (LampTarget, TABLE_CENTRE, poolOver, LAMP_LIGHT, GLIDE)
- feltShader (TWILL, CLOTH_BODY, ClothUniforms)
- cardGloss (Gloss, GLOSS_FRAME_S, FoilGlint)
- rail (RAIL, SHADE_MAX, rng)
- cardRects (CARD_SCOPES, TABLE_AT_REST)
- ember (RIM, emberSweep)
- particleSprites (GLOWS, Cell)
- seats (SeatMark, SeatCountdown)
- pile (Flight, BombClock, PileNote, PileLayerProps, PileFlightInput): types for tests.

### Unused exports
Each is real, a stray `export` only:
- `air.moteAt` (tests only)
- `dealPose.backDealArc` (tests only)
- `feltReady.CardCast`: false positive, imported by `CardView.tsx` and `GameTable.tsx`.
- `hand.cardItemPropsEqual` (tests only; ui-F8)
- `legibilityRing.ANNULUS_OUTER` (tests)
- `floats.BesideGioca` (own file only)
- `scorePillModel.PillBox`: false positive, used by GameTable and e2e helpers.
- `settingsSheet.GameSettingsSheetProps` (own file)
- `tableTimeline.Anchor`: false positive, used by GameTable and scorePill.
- `trick.beatenPlay` (tests only)
- `useRoundEnding.RoundEndingClock` (own file)

### Duplicated blocks
- **particleLayer.tsx:27-34 = particleLayer.web.tsx:9-16:** real but only import lines. The meaningful duplicate is the frame step (01-table-F5).
- **actions.tsx 82-106 = 224-245:** real (01-table-F6).
- **actions vs MenuButton 54-64:** a similar shape across slices; F6's `usePressScale` could serve it.
- **moments.tsx 162-179 = 243-259:** real, small (ui-F18).
- **notices/tableLines.tsx 4-12 = 14-22:** real, two 9-line components. Trivial; leave.
- **scorePill.tsx 81-111 = lib/tokens.ts:** false positive (number-literal object shapes).
- **matchBoard.tsx 32-50 = tokens:** false positive (number-literal object shapes).
- **noticeModel.ts 53-58 = 58-67:** false positive (MOCKUP entries).

### Mock targets
- **particles.ts (5):** real. The `jest.mock` wraps `requireActual` to spy on `landingDust`, because the layer has no observation seam (01-table-F5).
- **cardShadows (3):** real. The global setup stubs Skia builds, and one test re-unmocks it.
- **seats/pile/hand (2 each):** real, profiling and isolation mocks (`botMoveCost.compiled`, `oneTapOneCommit`). They mock whole components; acceptable for render-cost tests.
- **dealSlots (2) and useFlightClock (2):** real, pool and clock injection. These are hypothetical seams with one production adapter; tests patch them, so a real seam would be an injected clock/pool.
- **The single-mock targets** (cardGloss, lampRig, dealPose, ExchangeLegs, feltFallback, feltSkiaBoundary, ember, handShadeCanvas, selection, particleSprites, air): spot-checked handShadeCanvas and the others listed. Each is a spy or a native-module stub. None is in itself a finding.

### Tool results (phase0/tools: knip, dependency-cruiser, jscpd)

#### dependency-cruiser
- **no-circular air.ts ↔ particles.ts:** a false positive at runtime, as above. `air.ts:7` is `import type`.

#### knip: unused files
- **particleLayer.web.tsx, handShade.web.tsx, FoilMask.web.tsx:** false positives. Metro and Expo resolve the `.web.tsx` platform extension, which knip does not see.

#### knip: unused exports
- **`HandShadeBoundary` (feltSkiaBoundary.tsx:14):** false positive, imported by `handShade.web.tsx`.
- **`SkiaLoadFailed` and `drawsOnGpu` (feltSkia.web.tsx:31, :18):** false positives, imported by `handShade.web.tsx`. knip misses them because the importer is itself a `.web.tsx`.
- **`feltCanvas.tsx:392` `export default FeltCanvas`:** real. Every importer uses the named `FeltCanvas` (`feltSkia.tsx:1`, `skiaCanvases.ts:3`). Delete the default.
- **`GLOWS`, `inPath`, `poolOver`, `rng`:** test-only exports, deliberate (see above).
- **`LAMP_HEIGHT` (feltShader.ts:22):** real, used only in its own file. Drop the `export`.
- **`ToneOf` (noticeModel.ts:8):** real, used only in its own file. Drop the `export`.
- **`Anchor` (tableTimeline.ts:7):** false positive. The name is used by GameTable and scorePill, possibly through a type import knip mis-tracked; low confidence on which.
- **`PileNote` (pile.tsx:370):** test-only type.

#### jscpd
- **seats.tsx:615-636 = 793-814:** real (ui-F6). This is exactly the region holding the dead `cardCount ?? player.hand.length` fallback (01-table-F8).
- **actions.tsx:97-108 = 236-246:** real (01-table-F6).
- **feltCanvas.tsx:106-114 = handShadeCanvas.tsx:26-33:** real, small. Both build the blurred shadow `SkPaint` from `shadowPaint(kind, felt.s)` line for line.
  - Proposed: `shadowSkPaint(kind, s): { paint, blur, reach }` beside `shadowPaint` in `cardShadows.ts`.
  - P3/XS, not raised as a finding.

## Coverage

| file | lines | verdict |
|---|---|---|
| components/table/actions.tsx | 361 | 01-table-F6, F7 |
| components/table/air.ts | 124 | clean (cycle is type-only) |
| components/table/cardGloss.ts | 115 | clean |
| components/table/cardRects.ts | 167 | leave-alone: deep registry, pure |
| components/table/cardShadows.ts | 262 | leave-alone: deep shadow model |
| components/table/chrome.tsx | 283 | 01-table-F12; ui-F4 (side padding mirrors model) |
| components/table/coneRain.ts | 52 | clean |
| components/table/deal.tsx | 213 | clean. Note: without reduced motion, `useDeal` lands only through the mounted `DealFlights` frame callback; low-confidence, not a finding |
| components/table/dealPose.ts | 58 | leave-alone: pure pose math |
| components/table/dealSlots.ts | 60 | leave-alone: pure |
| components/table/ember.ts | 58 | clean |
| components/table/ExchangeLegs.tsx | 324 | 01-table-F1; ui-F3 |
| components/table/feltCanvas.tsx | 392 | client-F18 (e2e globals); otherwise deep |
| components/table/feltFallback.tsx | 184 | clean |
| components/table/feltReady.ts | 68 | client-F18 |
| components/table/feltShader.ts | 94 | clean |
| components/table/feltSkia.tsx | 6 | clean |
| components/table/feltSkia.web.tsx | 65 | client-F18; clean otherwise (two-adapter seam) |
| components/table/feltSkiaBoundary.tsx | 16 | clean |
| components/table/flightTrace.ts | 12 | clean |
| components/table/FoilMask.tsx | 22 | leave-alone: real two-adapter seam |
| components/table/FoilMask.web.tsx | 19 | leave-alone: real two-adapter seam |
| components/table/greyLayer.tsx | 25 | ui-F14 |
| components/table/hand.tsx | 1496 | 01-table-F7, F9, F12; ui-F2, F8, F9, F14, F18 |
| components/table/handShade.tsx | 6 | clean |
| components/table/handShade.web.tsx | 23 | clean |
| components/table/handShadeCanvas.tsx | 133 | clean |
| components/table/LampGloss.tsx | 143 | clean |
| components/table/lampRig.ts | 208 | 01-table-F3 (`setLevel` arbitration); otherwise leave-alone: deep |
| components/table/legibilityRing.ts | 39 | clean |
| components/table/linkGrey.ts | 32 | clean |
| components/table/matchBoard.tsx | 263 | clean |
| components/table/moments.tsx | 449 | 01-table-F7, F12; ui-F18 |
| components/table/noticeClock.ts | 39 | clean |
| components/table/noticeModel.ts | 215 | 01-table-F11 |
| components/table/notices/floats.tsx | 91 | clean |
| components/table/notices/gallery.tsx | 148 | clean |
| components/table/notices/hud.tsx | 206 | ui-F7 |
| components/table/notices/netNotes.tsx | 69 | clean |
| components/table/notices/panels.tsx | 132 | clean |
| components/table/notices/pileNotices.tsx | 29 | clean |
| components/table/notices/seatMarks.tsx | 73 | ui-F7 |
| components/table/notices/tableLines.tsx | 22 | clean (trivial dup, leave) |
| components/table/particleLayer.tsx | 255 | 01-table-F5 |
| components/table/particleLayer.web.tsx | 185 | 01-table-F5 |
| components/table/particles.ts | 224 | leave-alone: deep simulation; mock target noted in F5 |
| components/table/particleSprites.ts | 123 | clean (home for F5's `stepScene`) |
| components/table/pile.tsx | 941 | ui-F4, F17, F18 |
| components/table/rail.ts | 88 | clean |
| components/table/rotateGlyph.ts | 14 | clean |
| components/table/rotateOverlay.tsx | 80 | clean |
| components/table/scorePill.tsx | 531 | clean (string `countedKey` is a deliberate value-compare; falls back safely) |
| components/table/scorePillModel.ts | 122 | leave-alone: pure worklets |
| components/table/seats.tsx | 980 | 01-table-F8; ui-F6, F7, F14 |
| components/table/selection.ts | 56 | leave-alone: deep, pure |
| components/table/selectionLeaves.tsx | 162 | clean (consumer of ui-F1) |
| components/table/settingsSheet.tsx | 444 | 01-table-F6; ui-F14 |
| components/table/skiaCanvases.ts | 4 | clean |
| components/table/skiaDispose.ts | 10 | clean |
| components/table/spokenLabels.ts | 149 | ui-F1 (refusal re-decided at 138-142); home for 01-table-F1 |
| components/table/stagedPlay.ts | 82 | ui-F1 |
| components/table/straightTopRank.ts | 20 | clean |
| components/table/TableNotice.tsx | 457 | leave-alone: deep painter |
| components/table/TableText.tsx | 13 | clean |
| components/table/tableTimeline.ts | 105 | leave-alone: deep |
| components/table/trick.ts | 52 | leave-alone: deep, pure |
| components/table/useBombBeat.ts | 27 | clean |
| components/table/useCardRects.ts | 146 | 01-table-F10; client-F18 |
| components/table/useClockFade.ts | 44 | clean |
| components/table/useFlightClock.ts | 107 | leave-alone: deep |
| components/table/useLampRig.ts | 183 | 01-table-F3, F4 |
| components/table/useLandingReaction.ts | 23 | clean |
| components/table/useLinkHold.ts | 81 | 01-table-F3; ui-F14 |
| components/table/useRoundEnding.ts | 120 | 01-table-F2 |
| components/table/useRoundOutcome.ts | 30 | 01-table-F2 |
| components/table/useSelection.ts | 80 | leave-alone: deep (UI-thread prediction with store authority) |
