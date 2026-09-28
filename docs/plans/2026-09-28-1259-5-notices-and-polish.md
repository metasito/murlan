# One notice family, and the table polished to the mockup: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Seam errata (final cross-plan check; these win over the text below).** Plans 1–4 have landed before this plan runs, in that order. Code against the tree they leave.
> - **Every commit** ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
> - **No mocks of `@/lib/device/sounds` or `haptics`:** plan 1 deleted both. Observe through `bootFeedback`, `sounds()` and `hapticCalls()`.
> - **Task 3:** migrate plan 2's `components/table/ExchangeTag.tsx` off `TableChip`/`ChipText` in the same task that deletes them, so `tsc` never goes red between tasks.
> - **`captureMockup`:** edit it; do not replace its first lines. Keep plan 3's `DEPART_SCRIPT`, `departMockup` and `expectDeparted`.
> - **Task 14 (notice gallery):** follow plan 1's bench contract.
>   - Add a `notice` key to `DiagRows` in `lib/diagnostics/types.ts`. Every row carries `k` and `t`, recorded with `diag` and `jsFromWall`.
>   - Add `scenarios/noticeGallery.ts` and register it in `scenarios/index.ts`.
>   - Put the verdict in `GATES.noticeGallery` via `burstStalls`, with a verdict test. The phone records and the laptop judges.
> - Find `contrast.test.ts` rows by name, because plan 2 deletes some of them first. The order is fixed at 3 before 5, so there is no "whichever lands second".

**Goal:** Every notice on the table is painted by one component, `TableNotice`, in the mockup's vocabulary. The #14 differences the owner kept (all ten except PASSA, which stays garnet) each move to the mockup's side, and a pixel check against the mockup fixture guards each one.

**Architecture:**
- `components/table/noticeModel.ts` is pure and node-testable. It holds the kinds, shapes, tones, geometry and motion, with every number cited to a line of the mockup fixture.
- `components/table/TableNotice.tsx` is the only painter. It has no `style` prop.
- Every surface that shows a notice moves into `components/table/notices/`. A file there lays out only: an ESLint rule refuses a fill, an edge, a radius or a shadow in it, and a planted file proves the rule fires.
- `tests/native/tableNotices.test.tsx` renders every `NoticeKind` through its real surface component. It asserts that exactly one `TableNotice` plate paints it, in the tones its spec declares.
- Each #14 difference gets a Playwright check (`tests/e2e/mockupPolish.spec.ts`). The check reads the computed paint and the boxes of the app and of the mockup fixture, on one 874×402 stage.

**Tech Stack:** Expo / React Native 0.86.3, react-native-web 0.21.2, Reanimated 4.5.5 (`react-native-worklets` `scheduleOnRN`), ESLint 9.39.5 flat config (`no-restricted-imports` with `importNames`, `no-restricted-syntax`), `@testing-library/react-native` 14.0.1 (async `render`, host-only tree), `node --test` for pure `.ts`, Playwright.

**Spec:** `docs/plans/2026-09-28-1259-design.md` §6 (notices and polish), §8 (diagnostics and bench) and §9 (D2, D3, D4). Findings: issue #1259 #11 and #14. Research: `docs/research/2026-09-28-lantern-review.md:571-668` (the surface inventory and the #14 ranked list). Critique: `docs/research/2026-09-28-contrarian-review.md` §9 (lines 165-167) and §14 (lines 216-219). The mockup: `tests/e2e/fixtures/lantern-table/index.html`.

## Coverage

| Finding / difference | Task | Red today on |
| --- | --- | --- |
| #11: notices use different visual languages; build the family (D2) | 1, 2–7 | `noticeModel.test.ts` (module missing), then `tableNotices.test.tsx` for each kind as it is added |
| #11: `OfflineBanner` becomes a notice (D3) | 6 | `mockupPolish.spec.ts` "offline" (the band is `Colors.danger`, full width; the mockup's `.bad` pill is L107) |
| #11: who-starts is shown twice (`chrome.tsx:49` and `:604`) | 7 | `tableNotices.test.tsx` "whoStarts": exactly one `notice-whoStarts` plate while the gate holds and the start card is due |
| #11: the panel has no mockup reference (contrarian §14) | 7, Step 1 (gated `/design` mockup) | not testable before the mockup exists; the gate is the step |
| A hand-built plate in a notice file (class) | 2 | `noticePaintLint.test.ts`: the planted file is flagged by rule id |
| A table text that paints its own plate (class) | 10 | `contrast.test.ts` "no `<TableText>` style is its own plate": 8 `SELF` entries today (`contrast.test.ts:229-280`) |
| D4 #1: waiting seats dimmed to 0.62 (`seats.tsx:724,893,937`) | 8 | `mockupPolish.spec.ts` "seats are not dimmed": cumulative opacity 0.62 against 1 |
| D4 #2: a plate behind the player name (`seats.tsx:987-1001`) | 10 (gated on a measurement) | `seatNameContrast.spec.ts` decides; `mockupPolish.spec.ts` "name" is red on the plate fill |
| D4 #3: PASSA is garnet | none: the owner keeps today's garnet PASSA (Task 9 dropped). The existing guard stays as it is: `contrast.test.ts:438-445` holds `Garnet.label` on every PASSA stop. | no new check |
| The exchange's centre messages (`ExchangePrompt`, "no swap") | plan 2: a name-tag chip rides each traded card, drawn with chip tokens by plan 2, migrated onto `TableNotice` as `exchangeTag` (Task 4) | plan 2's test |
| D4 #4: the last-card badge is gold (`seats.tsx:1048-1053`) | 8 | `mockupPolish.spec.ts` "last card": the fill is `goldLit` against `#9e1f26` (L85) |
| D4 #5: the beaten combo sits at opacity 0.3 (`pile.tsx:1027-1030`) | 11 (tokens here; the pose is plan 4's) | `mockupPolish.spec.ts` "beaten": the shade over the prev layer (0.3 opacity against the brightness 0.6 shade of L75) |
| D4 #6: PASSO is a full-size pill with no motion (`seats.tsx:584-591`) | 3 | `mockupPolish.spec.ts` "PASSO": 23 pt tall against 15 (L86), placed in the name row against L87 |
| D4 #7: the turn pill when lit (`chrome.tsx:322`) | 2 | `mockupPolish.spec.ts` "turn, lit": edge `rgba(201,168,76,.5)` against `rgba(243,224,166,.8)` (L101) |
| D4 #8: the countdown ring when a bot leads | plan 3 (design §4, line 340) | plan 3's test; nothing here |
| D4 #9: content sits 14 pt left of the felt centre | 12 (check here; the fix is plan 3's frame-fed `useLampRig`) | `mockupPolish.spec.ts` "centred": the light centroid is off the pile centre under 62/21/62 insets |
| D4 #10: the partita ends in a modal; the mockup's score pill becomes the board | 13 (check here; the build is #1266 → #1267) | `mockupPolish.spec.ts` "board": no `score-pill` box at `BOARD` (L574) |
| A 19th surface the inventory missed: `hand.tsx:954-958` "empty hand" plate | 5 | `tableNotices.test.tsx` "emptyHand" |
| Notices off the table that print the same afk news (`app/game.tsx:207-215`, `OnlineGameContext.tsx:612-630`) | 6 | `tableNotices.test.tsx` "autopass"; `offlineAutoPass.test.tsx` rewritten |

## What the source says (verified 2026-09-28 against this worktree)

**The mockup's vocabulary** (`tests/e2e/fixtures/lantern-table/index.html`):
- **Pill** (`.chip`, L95-96):
  - height 23.7, radius 999;
  - fill `rgba(3,14,9,.72)`, edge `rgba(201,168,76,.3)`;
  - padding 0 12, gap 6;
  - text 600 10 px, letter-spacing 1.55, ink `rgba(240,234,214,.58)`; `b` is gold 700.
- **Turn pill** (L98-100): padding 0 13, gap 7, a 6 px dot at `rgba(201,168,76,.8)`, `b` 12 px `#F3E0A6`.
- **Turn pill tones:**
  - `.lit` (L101-102): edge `rgba(243,224,166,.8)`, glow 20.6 at .28;
  - `.urgent` (L103-104): the app's ember family exactly (`lib/tokens.ts:56-60`);
  - `.net` (L105, L109): the dot blinks over .9 s;
  - `.ok` (L106) and `.bad` (L107).
- **Mark** (`.passo`, L86-88): 15 tall, padding 0 7, radius 8; fill `rgba(3,14,9,.85)`, edge `.35` gold, ink `.7`, 700 8 px.
  - Top seat: `left:-60px; top:-8px`. Side seats: `left:0; top:27px`. Both are also shifted by `translateX(-50%)` (L525).
- **Combo mark** (`.cchip`, L110): 15 tall, padding 0 9, fill `rgba(0,0,0,.6)`, edge `.5` gold, gold 700 9 px.
- **Float** (`.chip.floatchip`, L115, L526-527): pill geometry at (457, 300). It fades in over 100, holds and fades out over 100 from 1100, then is removed.
- **Panel** (`#score`, L118, L579): radius 12, gradient `rgba(18,36,26,.95)` → `rgba(3,14,9,.93)` at 60 %, edge `.45` gold.
  - Header `.hd` (L128): 700 9.5 px, letter-spacing 2, gold.
  - Rows `.rw` (L131): 600 11 px.
  - Buttons `.bb` (L154-155): 30 tall, radius 15.
- **The seats:**
  - `.nm` (L77): bare letters `rgba(240,234,214,.58)`, with no plate and no dimming anywhere in L76-90.
  - `.badge.last` (L85): `#9e1f26`, edge `#ffb3a0`, `#fff`, glow 10 at `rgba(255,90,70,.6)`, scale 1.25.
- **The beaten group** (`.grp.prev`, L75): `translateY(9px) rotate(-7deg)` plus `filter:brightness(.6)`.
- **PASSA** (`.act`, L111-113): `rgba(0,0,0,.6)` glass, ink `.4`, edge `.18` gold. `#passa.lit` has ink `#F0EAD6` and edge `.55` gold.
- **The stage and scale:** the stage is 874×402, and the pile is at (457, 222) (L248). Its pixels are points at `cardScale(402) = 402/390` (`components/cardFaceModel.ts:22`).

**The app today:**
- **Table chips:** `TableChip` / `ChipText` / `ChipDot` (`components/table/chrome.tsx:189-342`, styles `:313-342`). They serve the turn chip (`components/table/turnChip.tsx`, also imported by `app/tutorial.tsx:34`), the HUD combo (`GameTable.tsx:989-1013`) and the seat chips (`seats.tsx:584-648`).
- **Separate plates** paint, each its own way:
  - the combo chip (`pile.tsx:575-607`) and the winner tag (`pile.tsx:519-527`);
  - the who-starts gate (`chrome.tsx:49-176`) and the start card (`chrome.tsx:604-640`);
  - the exchange prompt (`ExchangePrompt.tsx:113-139`), the exchange tag (`ExchangeFlight.tsx:141-197`) and "no swap" (`ExchangeAnnouncement.tsx:161-172`);
  - the rematch panel (`rematchPrompt.tsx`);
  - finished (`GameTable.tsx:1476`), the reject hint (`:1492`) and the empty hand (`hand.tsx:1146`);
  - the online banners and toast (`app/(online)/game.tsx:340-457`, styles `:512-558`, Inter);
  - `OfflineBanner` (`components/OfflineBanner.tsx`, a `Colors.danger` band at `Layer.alert`).
- `CHIP_H(scale) = 23 * scale` (`components/seatLayout.ts:37`) is the mockup's 23.7 at the mockup's scale. It is reused as the pill height, so the HUD bands that lay out against it cannot drift.
- **The text floor.** `tableFontSize(base, scale) = max(base * scale, 10)` (`cardFaceModel.ts:28`), so the mockup's 8 and 9 px mark text renders at 10.
- **Motion** (`lib/tokens.ts:361-438`):
  - `motionScale.test.ts` requires ascending steps at least 1.25× apart, a reduced form for each, and every `Reading` value above twice the longest step.
  - 160 fits between `tap` 120 and `shift` 200. A 100 ms step does not fit after `flash` 90 (1.11×).
- **Gold** is a five-step alpha scale (`components/CLAUDE.md:62`: add no sixth). So the mockup's `.35`, `.45` and `.55` gold edges take `goldBorder` (.3), `goldStrong` (.5) and `goldStrong`, and its `.8` dot takes `gold`. `.18` takes `goldSoft` (.2).
- **The icon subset** follows an Ionicons `name` through props back to literal call sites (`scripts/iconSubsetChars.mjs:16-26`); a computed index resolves to null. So a notice's glyph is a literal union passed at the call site, never read out of `NOTICES`.
- **ESLint flat config replaces a rule's options** in a later block rather than merging them. The notices block must therefore restate the base `no-restricted-syntax` selectors (`eslint.config.js:44-97`) as well as adding its own.

## Global Constraints

- `TableNotice` has no `style` prop, and paints Rajdhani only. It is the one importer of the notice palette's fills and edges; a file under `components/table/notices/` lays out only.
- **Entrances** (D2): pill and panel take `Motion.duration.notice` = 160 ms; chip and float take `flash` (90 ms). All rise 6 mockup px; under reduced motion they fade in place.
- **The float's hold** is `dwell` (1200 ms) for a pass, `Reading.hint` for a refusal, and `Reading.toast` for an error.
- **Numbers.** Every geometry number is written as the mockup's pixel, with its fixture line, and converted once by `pt(px, scale) = px / cardScale(402) * scale`. No other scaling of notice geometry exists.
- **Selectors are kept:** `combo-chip`, `turn-chip-dot`, `seat-reconnect-chip`, `seat-vacated-chip`, `exchange-prompt`, `start-reason-gate`, `game-top-bar`, `game-hud-stack`, `offline-banner`, `pile-prev-layer`, `seat-name`, `seat-card-count`, `btn-passa`. They are passed as `testID` to the root the old element occupied, because e2e helpers, specs and `.maestro` flows read them.
- **Strings.** Every string comes through `t()` in `en`, `it` and `sq` (rule 19). No new copy is invented except the one key Task 7 names.
- **Local checks and CI.** Locally, run only `npx tsc --noEmit -p .`, `npx eslint <touched files>` and `node --test <one file>` (rules 1-4). Jest and Playwright specs are written here and run on CI: push the branch and read the run. Memory is tight here, so never run `agent:check` beside peers.
- **Comment budget** (`CLAUDE.md` § Comments): at most six added comment lines per change (three in a test) unless the change adds more code, counted over the branch against `origin/main`. `npm run check:comments` runs on CI. The code blocks below are inside it: add no prose to them.
- **Git.** Stage by pathspec (rule 11) and change files with Edit/Write (rule 44). A moved, renamed or deleted file updates every doc that names it (rule 43).
- **Collisions.** Plans 2 and 4 land before this one, and this plan builds on their final code:
  - plan 2 deletes `ExchangeFlight.tsx`, `ExchangeAnnouncement.tsx` and `ExchangePrompt.tsx`, and adds `ExchangeLegs.tsx`. It puts the exchange choice's text on the `TurnChip`, whose wrapping View carries `exchange-prompt`.
  - plan 4 moves the pile into `PileLayer`, with `ComboChip` and `RoundWinnerTag` as their own components.

  Plan 3 edits `seatLayout.ts`, `tableFrame.ts`, the lamp and the countdown, and whichever of plans 3 and 5 lands second rebases. Read each landed diff before touching its files (rule 41).

## Review Focus

1. **Large text (iOS up to 3.1×).** A pill has a fixed height and `TableText` caps text at 1.2× (`lib/tokens.ts` `TABLE_FONT_SCALE_MAX`). Expected: a notice never clips its words. One-line kinds truncate with an ellipsis inside `maxTextWidth`; floats and panels wrap.
   - Task 2 adds `offlineBannerFit.spec.ts`'s large-text case for the pill.
   - Task 7 adds a 1.2× panel case to `tableNotices.test.tsx`.
2. **A notice replaced while it is still entering** (the turn passes twice in 160 ms; a second error arrives while a float is up). Expected: no stacked plates and no half-faded leftovers; the float slot holds one float and a new one restarts its life.
   - Task 5's native test fires two floats 50 ms apart and asserts one `notice-*` float plate, with the second text.
3. **Reduced motion.** Expected: every notice appears without travel, and the `net` dot does not blink (`Motion.reduced.dwell` is null, which means hold still).
   - Task 2's native test renders with reduced motion and asserts `translateY` 0 on the first frame and a static dot.
4. **Screen readers.**
   - A pressable notice (end-match vote, Riprova) is one node with one name.
   - The turn pill's live region stays its own node (`turnChip.tsx:97-108`, `lib/a11y.tsx:222`).
   - A float is announced once through `A11yStatus`, never as a landing stop.
   - Task 2 keeps `turnTimerAnnouncement.test.tsx` and `turnChipLabel.test.tsx` green on the moved component; Task 5 asserts a float's `A11yStatus` label.
5. **Locales that run long** (`sq` and `it` strings in a 23.7 pt pill at a 402 pt short edge). Expected: the pill grows sideways but never past the HUD band it sits in.
   - Task 2's Playwright case asserts the turn pill's box stays inside `game-hud-stack`'s box under `it-IT` with the longest seat name the bots use (`Besnik`).

## CLAUDE.md invariants these tasks touch

- **Every hook runs before `if (!gameState)`** (`app/game.tsx:161-164`, `app/(online)/game.tsx:110` / `:220`). Tasks 5 and 6 add state to both screens (`floatNotice`, `netNote`); each new `useState` / `useEffect` goes above the guard. The existing hook-order tests for both screens stay green.
- **`lib/game/autoMove.ts` is the only chooser, and game rules change only through `docs/GAME-RULES.md` § Decisions.** No task touches either. The autopass float (Task 6) reads the pass the timer already commits (`app/game.tsx:207-215`).
- **No self-defeating safeguards.** Every guard here has a floor:
  - the lint has a planted file and a positive control that the directory is non-empty;
  - `tableNotices.test.tsx` is keyed by `satisfies Record<NoticeKind, …>`, so a new kind with no fixture fails tsc;
  - the `SELF` ban counts the entries, not a list of exceptions.
  - No guard carries an exemption list (contrarian §9).
- **No unit test can see a layout bug.** Every position and size claim here is in `tests/e2e/`. The native test asserts only which plate paints and with which style values.
- **Take only the size from `onLayout`.** The combo mark's sheen reads only `width` and `height` (`pile.tsx:596`); Task 4 keeps that.
- **`components/CLAUDE.md`:**
  - `Layer` roles: the gate stays `Layer.hint`, and the offline pill stays `Layer.alert`.
  - Literal icon names.
  - One accessible node, and a live region as its own node.
  - `OfflineBanner` flags offline only on `isConnected === false` (`components/CLAUDE.md:51`): Task 6 moves the check into `useNetOffline` verbatim.
  - Tokens by role, and the five-step gold scale.
  - Timing through `motionMs` and `Reading`.

## Device gates (design §8, D8)

| Gate | Metric | Threshold | Bench scenario | Owner does |
| --- | --- | --- | --- | --- |
| A notice enters on time | the entrance's UI-frame duration, from the first frame with opacity > 0 to the first with opacity 1, recorded by `TableNotice` as a `notice` event | p90 within one regime period of the shape's step (160 pill/panel, 90 chip/float), 50 entrances per kind | "notice gallery" (Task 14): every `NOTICE_GALLERY` fixture mounted, entered, exited, five times each, while a scripted trick runs through the real flight | opens `app/bench.tsx`, leaves the phone face up |
| Notices cost no frame | blocking stalls (design §8's definition) during the gallery | 0 | the same run | nothing more |
| The `net` dot blinks and stops | dot opacity samples over 3 s with reduced motion off and then on | a period of 1200 ± one frame; a constant 1 under reduced motion | the same run, with reduced motion flipped by the bench | nothing more |

- The gates ship off. `TableNotice` records only when `process.env.EXPO_PUBLIC_DIAGNOSTICS === "1"`, a build-time constant that Metro inlines. Design §8's production-bundle check proves the symbol is absent.
- **iOS pixels** are not a bench metric. They come from the `app/capture.tsx` states that `ios.yml` photographs (rule 36); Task 3 adds a `passed` capture state for that.

---

### Task 1: The notice model, its tokens, and their node test

**Depends on:** D2. On the other answer (no family), this task and Tasks 2–7 drop; Tasks 8–13 keep their own token edits.

**Files:**
- Create: `components/table/noticeModel.ts`
- Modify: `lib/tokens.ts:361-438` (`Motion.duration.notice`, `Motion.reduced.notice`), after `Scrim` (`:121-128`) add `Notice` and `SeatMark` (`Beaten` is plan 4's, already landed).
- Modify: `eslint.selectors.cjs:12` (`TOKEN_OBJECTS` gains `Notice|SeatMark`)
- Modify: `tests/ui-rules/contrast.test.ts:91` (`PALETTES` gains `Notice`, `SeatMark`) and a tone loop after `:326`
- Test: `tests/ui-rules/noticeModel.test.ts`

**Interfaces:**
- Produces:
  - `type NoticeShape = "pill" | "chip" | "float" | "panel"` and `type NoticeTone = "neutral" | "lit" | "urgent" | "ok" | "bad"`.
  - `type NoticeKind`: this task lands `"turn" | "hudCombo"`, and each later task appends its own.
  - `interface NoticeSpec { shape: NoticeShape; tones: readonly NoticeTone[] }` and `NOTICES`.
  - `noticeGeometry(shape, tone, scale, withDot?): NoticeGeometry`.
  - `noticeMotion(shape, scale, reduceMotion): NoticeMotion`.
  - `floatHoldMs(hold: FloatHold, reduceMotion): number`, with `type FloatHold = "pass" | "hint" | "toast"`.
  - `NOTICE_PAINT: Record<NoticeShape, Partial<Record<NoticeTone, NoticePaint>>>`.
  - `pt(px, scale)`.
  - The tokens `Notice` and `SeatMark`.

- [ ] **Step 1: Write the failing test**

The expected numbers are the fixture's pixels and D2's 160, written as literals, never read back from the module.

```ts
// tests/ui-rules/noticeModel.test.ts — the notice geometry is the mockup's, at the mockup's scale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTICES, NOTICE_PAINT, floatHoldMs, noticeGeometry, noticeMotion } from "../../components/table/noticeModel.ts";

const S = 402 / 390;
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 0.05, `${what}: ${a} vs ${b}`);

test("a pill is the mockup's .chip (L95) and #turn (L98-99)", () => {
  const g = noticeGeometry("pill", "neutral", S);
  near(g.h!, 23.7, "height");
  near(g.padX, 12, "padding");
  near(g.gap, 6, "gap");
  near(g.type, 10, "text");
  near(g.track, 1.55, "tracking");
  const dotted = noticeGeometry("pill", "lit", S, true);
  near(dotted.padX, 13, "padding with a dot");
  near(dotted.gap, 7, "gap with a dot");
  near(dotted.dot, 6, "dot");
  near(dotted.strongType, 12, "count");
});

test("a mark is .passo (L86) and .cchip (L110), its text at the table's floor", () => {
  near(noticeGeometry("chip", "neutral", S).h!, 15, "height");
  near(noticeGeometry("chip", "neutral", S).padX, 7, "passo padding");
  near(noticeGeometry("chip", "lit", S).padX, 9, "cchip padding");
  near(noticeGeometry("chip", "lit", S).type, 10, "9 px floored to 10");
  near(noticeGeometry("panel", "neutral", S).r, 12, "panel radius (#score L118)");
});

test("entrances: 160 ms for a pill or panel (D2), 90 for a mark or float, a 6 px rise", () => {
  assert.equal(noticeMotion("pill", S, false).inMs, 160);
  assert.equal(noticeMotion("panel", S, false).inMs, 160);
  assert.equal(noticeMotion("chip", S, false).inMs, 90);
  assert.equal(noticeMotion("float", S, false).outMs, 90);
  near(noticeMotion("chip", S, false).rise, 6, "rise");
  assert.equal(noticeMotion("pill", S, true).rise, 0);
  assert.equal(floatHoldMs("pass", false), 1200);
  assert.equal(floatHoldMs("hint", false), 2600);
});

test("every kind declares tones its shape can paint", () => {
  for (const [kind, spec] of Object.entries(NOTICES)) {
    assert.ok(spec.tones.length > 0, kind);
    for (const tone of spec.tones) assert.ok(NOTICE_PAINT[spec.shape][tone], `${kind}: ${spec.shape} has no ${tone}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ui-rules/noticeModel.test.ts`
Expected: FAIL with `Cannot find module '…/components/table/noticeModel.ts'`.

- [ ] **Step 3: Add the tokens**

In `lib/tokens.ts`, in `Motion.duration` directly after `tap`, add:

```ts
    /** A notice arriving on the table: one rise for every pill and panel (D2). */
    notice: 160,
```

In `Motion.reduced`, directly after `tap: null,`, add `notice: null,`. After `Scrim`, add:

```ts
// tests/e2e/fixtures/lantern-table/index.html:95-113 and :118; gold edges on the five-step scale.
export const Notice = {
  fill: Colors.chipFill, edge: Colors.goldBorder, ink: Colors.textMuted, strong: Colors.gold, dot: Colors.gold,
  litInk: Colors.goldLit, litEdge: 'rgba(243,224,166,0.8)', litGlow: Colors.goldLit,
  urgentInk: Colors.emberLabel, urgentEdge: Colors.ember, urgentStrong: Colors.emberCount, urgentDot: Colors.emberDot, urgentGlow: Colors.emberGlow,
  okInk: '#D4ECCE', okEdge: 'rgba(143,191,138,0.7)', okDot: '#8FBF8A',
  badInk: '#FFCFC6', badEdge: '#D0574B', badDot: '#E0806F',
  markFill: 'rgba(3,14,9,0.85)', markInk: 'rgba(240,234,214,0.7)', litMarkFill: Scrim.heavy,
  panelTop: Colors.scorePillTop, panelFoot: Colors.scorePillFoot, panelEdge: Colors.goldStrong, panelInk: Colors.text,
} as const;

// .badge.last, index.html:85.
export const SeatMark = { lastFill: '#9E1F26', lastEdge: '#FFB3A0', lastInk: Colors.white, lastGlow: '#FF5A46' } as const;
```

In `eslint.selectors.cjs:12`, append `|Notice|SeatMark` to the `TOKEN_OBJECTS` alternation. `Beaten` is plan 4's: it lands first, defines the token, and appends `|Beaten` itself. This plan only consumes it (Task 11), and must not define or append it again.

- [ ] **Step 4: Write the model**

```ts
// components/table/noticeModel.ts
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".
import { cardScale, tableFontSize } from "../cardFaceModel.ts";
import { CHIP_H } from "../seatLayout.ts";
import { Motion, Notice, Radius, Reading, motionMs } from "../../lib/tokens.ts";

export type NoticeShape = "pill" | "chip" | "float" | "panel";
export type NoticeTone = "neutral" | "lit" | "urgent" | "ok" | "bad";
export type NoticeKind = "turn" | "hudCombo";

export interface NoticeSpec {
  shape: NoticeShape;
  tones: readonly NoticeTone[];
}

export const NOTICES = {
  turn: { shape: "pill", tones: ["neutral", "lit", "urgent", "ok", "bad"] },
  hudCombo: { shape: "pill", tones: ["neutral"] },
} as const satisfies Record<NoticeKind, NoticeSpec>;

export type ToneOf<K extends NoticeKind> = (typeof NOTICES)[K]["tones"][number];

const MOCKUP_SCALE = cardScale(402);
export const pt = (px: number, scale: number) => (px / MOCKUP_SCALE) * scale;

export interface NoticeGeometry {
  h: number | null;
  r: number;
  padX: number;
  padY: number;
  gap: number;
  dot: number;
  type: number;
  strongType: number;
  track: number;
  glow: number;
}

export function noticeGeometry(shape: NoticeShape, tone: NoticeTone, scale: number, withDot = false): NoticeGeometry {
  const text = (px: number) => tableFontSize(pt(px, 1), scale);
  if (shape === "chip") {
    const lit = tone !== "neutral";
    return {
      h: pt(15, scale), r: Radius.full, padX: pt(lit ? 9 : 7, scale), padY: 0, gap: pt(4, scale), dot: 0,
      type: text(lit ? 9 : 8), strongType: text(lit ? 9 : 8), track: pt(lit ? 1.5 : 1.28, scale), glow: 0,
    };
  }
  if (shape === "panel") {
    return {
      h: null, r: pt(12, scale), padX: pt(14, scale), padY: pt(12, scale), gap: pt(8, scale), dot: 0,
      type: text(11), strongType: text(9.5), track: pt(2, scale), glow: 0,
    };
  }
  return {
    h: CHIP_H(scale), r: Radius.full, padX: pt(withDot ? 13 : 12, scale), padY: 0, gap: pt(withDot ? 7 : 6, scale),
    dot: pt(6, scale), type: text(10), strongType: text(12), track: pt(1.55, scale),
    glow: pt(tone === "urgent" ? 18 : 20.6, scale),
  };
}

export interface NoticeMotion {
  inMs: number;
  outMs: number;
  rise: number;
}

export function noticeMotion(shape: NoticeShape, scale: number, reduceMotion: boolean): NoticeMotion {
  const ms = motionMs(shape === "pill" || shape === "panel" ? "notice" : "flash", reduceMotion);
  return { inMs: ms, outMs: ms, rise: reduceMotion ? 0 : pt(6, scale) };
}

export type FloatHold = "pass" | "hint" | "toast";

export function floatHoldMs(hold: FloatHold, reduceMotion: boolean): number {
  if (hold === "pass") return motionMs("dwell", reduceMotion);
  return hold === "hint" ? Reading.hint : Reading.toast;
}

export const BLINK_MS = Motion.duration.dwell;

export interface NoticePaint {
  fill: readonly string[];
  edge: string;
  ink: string;
  strong: string;
  dot: string;
  glow: string | null;
}

const line = (ink: string, edge: string, strong: string, dot: string, glow: string | null): NoticePaint => ({
  fill: [Notice.fill], edge, ink, strong, dot, glow,
});
const LINE = {
  neutral: line(Notice.ink, Notice.edge, Notice.strong, Notice.dot, null),
  lit: line(Notice.litInk, Notice.litEdge, Notice.litInk, Notice.litInk, Notice.litGlow),
  urgent: line(Notice.urgentInk, Notice.urgentEdge, Notice.urgentStrong, Notice.urgentDot, Notice.urgentGlow),
  ok: line(Notice.okInk, Notice.okEdge, Notice.okInk, Notice.okDot, null),
  bad: line(Notice.badInk, Notice.badEdge, Notice.badInk, Notice.badDot, null),
};

export const NOTICE_PAINT: Record<NoticeShape, Partial<Record<NoticeTone, NoticePaint>>> = {
  pill: LINE,
  float: LINE,
  chip: {
    neutral: { fill: [Notice.markFill], edge: Notice.edge, ink: Notice.markInk, strong: Notice.markInk, dot: Notice.dot, glow: null },
    lit: { fill: [Notice.litMarkFill], edge: Notice.panelEdge, ink: Notice.strong, strong: Notice.litInk, dot: Notice.dot, glow: null },
    urgent: { fill: [Notice.litMarkFill], edge: Notice.urgentEdge, ink: Notice.urgentInk, strong: Notice.urgentStrong, dot: Notice.urgentDot, glow: null },
  },
  panel: {
    neutral: { fill: [Notice.panelTop, Notice.panelFoot], edge: Notice.panelEdge, ink: Notice.panelInk, strong: Notice.strong, dot: Notice.dot, glow: null },
  },
};
```

The panel's `padX`/`padY`/`gap` are the only numbers not on a fixture line. Task 7, Step 1 replaces them with the approved mockup's.

- [ ] **Step 5: Hold every tone to contrast**

In `tests/ui-rules/contrast.test.ts`, import the notice palette (add `Notice, SeatMark` to the `lib/tokens.ts` import at `:11`, and extend `PALETTES` at `:91` to `{ Colors, Scrim, Garnet, Notice, SeatMark }`). Then add after the `ON_TABLE` loop (`:326`):

```ts
import { NOTICE_PAINT } from "../../components/table/noticeModel.ts";

for (const [shape, tones] of Object.entries(NOTICE_PAINT)) {
  for (const [tone, paint] of Object.entries(tones)) {
    test(`a ${tone} ${shape} notice clears ${BODY_MIN}:1 on every felt stop`, () => {
      for (const gradient of Object.values(FeltGradients)) {
        for (const stop of ANY_STOP) {
          for (const fill of paint.fill) {
            const surface = resolve(fill, gradient[stop]);
            for (const ink of [paint.ink, paint.strong]) {
              const ratio = contrastRatio(resolve(ink, surface), surface);
              assert.ok(ratio >= BODY_MIN, `${shape}/${tone} ${ink} on ${fill} over stop ${stop}: ${ratio.toFixed(2)}:1`);
            }
          }
        }
      }
    });
  }
}
```

Move the `import` up to the file's import block when you paste it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/ui-rules/noticeModel.test.ts && node --test tests/ui-rules/motionScale.test.ts && node --test tests/ui-rules/contrast.test.ts && npx tsc --noEmit -p . && npx eslint components/table/noticeModel.ts lib/tokens.ts eslint.selectors.cjs`
Expected:
- all PASS;
- `motionScale` accepts `notice` between `tap` (160/120 = 1.33) and `shift` (200/160 = 1.25);
- a contrast failure names a tone, and is a palette defect to fix here, never a threshold to lower.

- [ ] **Step 7: Commit**

```bash
git add -- components/table/noticeModel.ts lib/tokens.ts eslint.selectors.cjs tests/ui-rules/noticeModel.test.ts tests/ui-rules/contrast.test.ts
git commit -m "feat(table): the notice model and palette, at the mockup's numbers"
```

---

### Task 2: `TableNotice`, the lint with its floor, and the turn and HUD pills (D4 #7)

**Depends on:**
- D2. On the other answer, only the D4 #7 part remains: the lit border and glow in `chrome.tsx:322`.
- D4 #7. On the other answer, `lit` keeps `goldStrong` and the spec's "turn, lit" test drops.

**Files:**
- Create:
  - `components/table/TableNotice.tsx`
  - `components/table/notices/hud.tsx` (`TurnNotice`, moved from `components/table/turnChip.tsx`, and `HudComboNotice`)
  - `components/table/notices/gallery.tsx` (`NOTICE_GALLERY`)
  - `tests/native/tableNotices.test.tsx`
  - `tests/ui-rules/noticePaintLint.test.ts`
  - `tests/e2e/helpers/mockupStage.ts`
  - `tests/e2e/mockupPolish.spec.ts`
- Delete: `components/table/turnChip.tsx`
- Modify:
  - `components/GameTable.tsx:989-1044` (the two HUD chips)
  - `app/tutorial.tsx:34,609` (the import)
  - `tests/native/turnChipLabel.test.tsx` and `tests/native/turnTimerAnnouncement.test.tsx` (the import path only)
  - `eslint.config.js:44-97` and `eslint.selectors.cjs`
  - `tests/e2e/helpers/mockupParity.ts:29,297-307` (export `FIXTURE`; `captureMockup` calls `openMockupStage`)
  - `tests/e2e/helpers/offlineSeed.ts:121` (export `holdSeededTurn`)
  - `tests/e2e/controlRail.spec.ts:71-89` (import `setSafeArea` from the new helper)
- Create: `tests/e2e/helpers/safeArea.ts` (`setSafeArea`, moved verbatim)

**Interfaces:**
- Consumes: Task 1's model and tokens.
- Produces:
  - `TableNotice<K extends NoticeKind>(props: TableNoticeProps<K>)`. Props:
    - `kind`, `tone: ToneOf<K>`, `scale`, `visible?`, `testID?`;
    - `text`, `strong?`, `dot?: "on" | "net"`, `glyph?: NoticeGlyph`, `sheen?`, `lines?: 1 | 2`, `maxTextWidth?`, `onPress?`, `a11yLabel?`;
    - `hold?: FloatHold`, `onDone?`, `children?` (panel only, Task 7).
  - The plate's testID is `notice-<kind>`, the label's `notice-<kind>-label`, and the dot's `${testID}-dot`.
  - `type NoticeGlyph = "star" | "trophy" | "checkmark-circle" | "flag" | "alert-circle" | "cloud-offline"`.
  - `NOTICE_GALLERY satisfies Record<NoticeKind, NoticeFixture[]>`, with `NoticeFixture = { tone: NoticeTone; dot?: boolean; element: ReactElement }`.
  - `mockupAt(browser, chapter, ms)`, `appAt(browser, baseURL, gameState)`, `paintOf(plate, label, origin)`, `expectPaint(app, mock, keys, mapped?)` and `stageOrigin(page)`.

- [ ] **Step 1: Write the lint floor (a new class guard: "a notice file paints its own plate")**

```ts
// tests/ui-rules/noticePaintLint.test.ts — a notice file lays out; only TableNotice paints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NOTICES_DIR = path.join(ROOT, "components", "table", "notices");
const eslint = new ESLint({ cwd: ROOT });

const PLANTED = [
  'import { Scrim } from "@/lib/theme";',
  'import { StyleSheet } from "react-native";',
  "export const s = StyleSheet.create({ plate: { backgroundColor: Scrim.heavy, borderRadius: s0 } });",
  "const s0 = 8;",
].join("\n");

test("a hand-built plate in a notice file is refused on both counts", async () => {
  const [result] = await eslint.lintText(PLANTED, { filePath: path.join(NOTICES_DIR, "planted.tsx") });
  const ids = new Set(result.messages.map((m) => m.ruleId));
  assert.ok(ids.has("no-restricted-imports"), JSON.stringify(result.messages));
  assert.ok(ids.has("no-restricted-syntax"), JSON.stringify(result.messages));
});

test("every real notice file is clean, and there are notice files to check", async () => {
  const files = readdirSync(NOTICES_DIR).filter((f) => f.endsWith(".tsx")).map((f) => path.join(NOTICES_DIR, f));
  assert.ok(files.length >= 1, "components/table/notices/ is empty");
  for (const result of await eslint.lintFiles(files)) {
    const paint = result.messages.filter((m) => m.ruleId === "no-restricted-imports" || m.ruleId === "no-restricted-syntax");
    assert.deepEqual(paint, [], result.filePath);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/ui-rules/noticePaintLint.test.ts`
Expected: FAIL. The first test finds neither rule id: the planted file lints clean today, because `Scrim.heavy` is a token and `s0` a named constant. The second test fails with `ENOENT` on `components/table/notices`.

- [ ] **Step 3: Write the rule**

In `eslint.selectors.cjs`, add and export:

```js
const NOTICE_FILES = ["components/table/notices/**/*.{ts,tsx}"];
const NOTICE_PAINT_MESSAGE =
  "A notice file lays out only: its fill, edge, radius and shadow belong to TableNotice (components/table/TableNotice.tsx).";
const NOTICE_PAINT = `Property[key.name=/^(backgroundColor|borderColor|borderWidth|borderRadius|boxShadow|shadowColor|shadowOpacity|shadowRadius|shadowOffset|elevation)$/]`;
const NOTICE_PAINT_NAMES = ["Scrim", "Shadow", "Radius", "Notice", "makeShadow", "makeLayeredShadow"];
const NOTICE_PAINT_IMPORTS = {
  paths: ["@/lib/theme", "@/lib/tokens"].map((name) => ({ name, importNames: NOTICE_PAINT_NAMES, message: NOTICE_PAINT_MESSAGE })),
  patterns: [{ group: ["**/lib/theme", "**/lib/tokens", "**/lib/theme.ts", "**/lib/tokens.ts"], importNames: NOTICE_PAINT_NAMES, message: NOTICE_PAINT_MESSAGE }],
};
```

In `eslint.config.js`:
- Lift the `no-restricted-syntax` entries at `:59-96` into `const TABLE_SYNTAX = [ … ]` above `module.exports`.
- Make the existing block read `"no-restricted-syntax": ["error", ...TABLE_SYNTAX]`.
- Add a block directly after it:

```js
  {
    // A later block replaces a rule's options, so the base selectors are restated here.
    files: NOTICE_FILES,
    rules: {
      "no-restricted-syntax": ["error", ...TABLE_SYNTAX, { selector: NOTICE_PAINT, message: NOTICE_PAINT_MESSAGE }],
      "no-restricted-imports": ["error", NOTICE_PAINT_IMPORTS],
    },
  },
```

- [ ] **Step 4: Write the native harness (the class guard "a notice kind with no painter")**

```tsx
// tests/native/tableNotices.test.tsx — every NoticeKind is painted by exactly one TableNotice plate, in its declared tones.
import { describe, expect, jest, test } from "@jest/globals";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";

jest.mock("@/lib/device/sounds", () => ({ stopClockRunningOut: jest.fn(async () => {}), playClockRunningOut: jest.fn(async () => {}) }));
jest.mock("@/lib/device/haptics", () => ({ hapticSelection: jest.fn(), hapticMedium: jest.fn(), hapticWarn: jest.fn() }));

import { NOTICES, NOTICE_PAINT, type NoticeKind, type NoticeTone } from "@/components/table/noticeModel";
import { NOTICE_GALLERY } from "@/components/table/notices/gallery";

const kinds = Object.keys(NOTICES) as NoticeKind[];

describe.each(kinds)("%s", (kind) => {
  test("each fixture paints one plate, and the fixtures cover the declared tones", async () => {
    const { shape, tones } = NOTICES[kind];
    const seen = new Set<NoticeTone>();
    for (const fixture of NOTICE_GALLERY[kind]) {
      const view = await render(fixture.element);
      const plates = screen.getAllByTestId(`notice-${kind}`);
      expect(plates).toHaveLength(1);
      const style = StyleSheet.flatten(plates[0].props.style);
      expect(style.borderColor).toBe(NOTICE_PAINT[shape][fixture.tone]!.edge);
      seen.add(fixture.tone);
      view.unmount();
    }
    expect([...seen].sort()).toEqual([...tones].sort());
  });
});

test("the gallery and the kinds are one list", () => {
  expect(Object.keys(NOTICE_GALLERY).sort()).toEqual([...kinds].sort());
});
```

A kind added to `NoticeKind` without a gallery entry fails `tsc`, because the gallery uses `satisfies Record<NoticeKind, …>`. A gallery entry whose surface paints outside `TableNotice` finds no `notice-<kind>` plate. A surface that paints two plates fails `toHaveLength(1)`.

- [ ] **Step 5: Run it to verify it fails**

Run: `npx tsc --noEmit -p .`
Expected: FAIL, with `Cannot find module '@/components/table/notices/gallery'` (tests/native is type-checked). CI runs the jest file, which fails on the same import.

- [ ] **Step 6: Write `TableNotice` (pill, chip and float; the panel's body is Task 7's)**

```tsx
// components/table/TableNotice.tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { makeShadow, Motion } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { TableText } from "./TableText";
import { Sweep } from "./moments";
import {
  BLINK_MS, NOTICES, NOTICE_PAINT, floatHoldMs, noticeGeometry, noticeMotion,
  type FloatHold, type NoticeKind, type ToneOf,
} from "./noticeModel";

export type NoticeGlyph = "star" | "trophy" | "checkmark-circle" | "flag" | "alert-circle" | "cloud-offline";

export interface TableNoticeProps<K extends NoticeKind> {
  kind: K;
  tone: ToneOf<K>;
  scale: number;
  text: string;
  visible?: boolean;
  testID?: string;
  strong?: string;
  dot?: "on" | "net";
  glyph?: NoticeGlyph;
  sheen?: boolean;
  lines?: 1 | 2;
  maxTextWidth?: number;
  onPress?: () => void;
  a11yLabel?: string;
  hold?: FloatHold;
  onDone?: () => void;
  children?: ReactNode;
}

export function TableNotice<K extends NoticeKind>({
  kind, tone, scale, text, visible = true, testID, strong, dot, glyph, sheen = false,
  lines = 1, maxTextWidth, onPress, a11yLabel, hold, onDone, children,
}: TableNoticeProps<K>) {
  const shape = NOTICES[kind].shape;
  const reduceMotion = usePrefersReducedMotion();
  const g = noticeGeometry(shape, tone, scale, !!dot);
  const m = noticeMotion(shape, scale, reduceMotion);
  const paint = NOTICE_PAINT[shape][tone]!;
  const shown = useSharedValue(0);
  const blink = useSharedValue(1);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    if (shape !== "float") {
      shown.value = withTiming(visible ? 1 : 0, { duration: visible ? m.inMs : m.outMs });
      return;
    }
    const done = () => doneRef.current?.();
    shown.value = 0;
    shown.value = withSequence(
      withTiming(1, { duration: m.inMs }),
      withDelay(floatHoldMs(hold ?? "pass", reduceMotion), withTiming(0, { duration: m.outMs }, (end) => {
        if (end) scheduleOnRN(done);
      }))
    );
  }, [shape, visible, text, hold, m.inMs, m.outMs, reduceMotion, shown]);

  useEffect(() => {
    blink.value = dot === "net" && !reduceMotion ? withRepeat(withTiming(0.25, { duration: BLINK_MS / 2 }), -1, true) : 1;
  }, [dot, reduceMotion, blink]);

  useEffect(() => () => { cancelAnimation(shown); cancelAnimation(blink); }, [shown, blink]);

  const enter = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * m.rise }] }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: blink.value }));
  const Plate = onPress ? Pressable : View;

  return (
    <Animated.View testID={testID} pointerEvents={onPress ? "box-none" : "none"} style={enter}>
      <Plate
        testID={`notice-${kind}`}
        onPress={onPress}
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={a11yLabel}
        onLayout={sheen ? (e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }) : undefined}
        style={[
          styles.plate,
          shape === "panel" ? styles.column : styles.row,
          { height: g.h ?? undefined, borderRadius: g.r, paddingHorizontal: g.padX, paddingVertical: g.padY, gap: g.gap },
          { backgroundColor: paint.fill.length === 1 ? paint.fill[0] : undefined, borderColor: paint.edge },
          paint.glow !== null && makeShadow(paint.glow, 0, 0, tone === "urgent" ? 0.5 : 0.28, g.glow, 0),
        ]}
      >
        {paint.fill.length > 1 && <LinearGradient colors={paint.fill as [string, string]} locations={[0, 0.6]} style={StyleSheet.absoluteFill} />}
        {dot && (
          <Animated.View
            testID={testID && `${testID}-dot`}
            style={[{ width: g.dot, height: g.dot, borderRadius: g.dot / 2, backgroundColor: paint.dot }, dotStyle]}
          />
        )}
        {glyph && <Ionicons name={glyph} size={g.type} color={paint.strong} />}
        <TableText
          testID={`notice-${kind}-label`}
          numberOfLines={lines}
          style={[styles.label, { fontSize: g.type, letterSpacing: g.track, color: paint.ink, maxWidth: maxTextWidth }]}
        >
          {text}
        </TableText>
        {strong !== undefined && (
          <TableText style={[styles.strong, { fontSize: g.strongType, color: paint.strong }]}>{strong}</TableText>
        )}
        {children}
        {sheen && !reduceMotion && (
          <View testID={testID && `${testID}-sheen`} style={StyleSheet.absoluteFill} pointerEvents="none">
            {size && <Sweep trigger={1} width={size.w} height={size.h} durationMs={Motion.duration.reveal} />}
          </View>
        )}
      </Plate>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  plate: { borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  column: { alignItems: "stretch", overflow: "hidden" },
  label: { fontFamily: "Rajdhani_600SemiBold", textTransform: "uppercase" },
  strong: { fontFamily: "Rajdhani_700Bold", fontVariant: ["tabular-nums"] },
});
```

About this component:
- **The sheen.** `Sweep` (`components/table/moments.tsx:527`) takes `trigger`, `width`, `height` and `durationMs`, as `pile.tsx:601-603` passes them today. The plate's `onLayout` supplies the size only (CLAUDE.md, "Take only the size from `onLayout`"), and the sheen keeps its `Motion.duration.reveal` (add `Motion` to the `@/lib/theme` import).
- **Clipping.** Only the panel clips, for its gradient. A pill must not set `overflow: "hidden"`, because iOS clips a layer's shadow with it and the lit glow would vanish.
- **Test IDs.** With `testID="combo-chip"`, the sheen is `combo-chip-sheen`, the selector `comboChipEntrance.test.tsx` reads.

- [ ] **Step 7: Move the turn chip and the HUD combo onto it**

Move `TurnChip` from `components/table/turnChip.tsx` into `components/table/notices/hud.tsx` as `TurnNotice`. Move it as plan 2's Task 9 left it: `spokenSeat` carries the exchange sentence, and `GameTable`'s View around it carries `exchange-prompt`. Both stay. Its clock, `A11yStatus`, `a11yGroup` and `onExpire` are unchanged (`turnChip.tsx:40-99`, today's lines). Two things change:
- It gains `netNote?: { tone: "neutral" | "ok" | "bad"; text: string }`, used from Task 6 on.
- It paints through the notice.

```tsx
      <View {...a11yGroup(label)}>
        <View {...a11yHidden()}>
          <TableNotice
            kind="turn"
            testID="turn-chip"
            scale={scale}
            tone={netNote?.tone ?? (ember ? "urgent" : lit ? "lit" : "neutral")}
            dot={netNote?.tone === "neutral" ? "net" : "on"}
            text={netNote?.text ?? chipText}
            strong={active && !netNote ? String(timeLeft) : undefined}
          />
        </View>
      </View>
```

`testID="turn-chip"` names the dot `turn-chip-dot`, which is the selector `tableProportions.spec.ts` and the native tests read.

Add `HudComboNotice` in the same file. It replaces `GameTable.tsx:996-1011`, and `game-top-bar`'s `a11yGroup` stays in `GameTable`:

```tsx
export function HudComboNotice({ scale, who, combo, empty }: { scale: number; who: string; combo: string | null; empty: string }) {
  return (
    <TableNotice
      kind="hudCombo"
      tone="neutral"
      scale={scale}
      text={combo === null ? empty : who}
      strong={combo ?? undefined}
      maxTextWidth={CHIP_NAME_MAX_W * scale}
    />
  );
}
```

In `GameTable.tsx`:
- Replace the `TableChip` block at `:997-1011` with `<HudComboNotice scale={scale} who={lastPlayName} combo={comboLabel} empty={t("gameShared.emptyTable")} />`.
- Replace `TurnChip` at `:1027-1041` with `TurnNotice` (same props). These are today's lines: plans 2 and 4 edit `GameTable.tsx` first, so find both blocks by name.
- Point `app/tutorial.tsx:34` and the two native tests at `@/components/table/notices/hud`.
- Delete `turnChip.tsx`.
- Keep `TableChip`/`ChipText`/`ChipDot` until Task 3 removes their last callers.

- [ ] **Step 8: Write the gallery**

```tsx
// components/table/notices/gallery.tsx
import type { ReactElement } from "react";
import type { NoticeKind, NoticeTone } from "../noticeModel";
import { HudComboNotice, TurnNotice } from "./hud";

export interface NoticeFixture {
  tone: NoticeTone;
  element: ReactElement;
}

const turn = (props: Partial<Parameters<typeof TurnNotice>[0]>) => (
  <TurnNotice seconds={30} active resetKey="gallery" scale={1} lit={false} chipText="Turno di Luan" spokenSeat="Turno di Luan" {...props} />
);

export const NOTICE_GALLERY = {
  turn: [
    { tone: "neutral", element: turn({}) },
    { tone: "lit", element: turn({ lit: true }) },
    { tone: "urgent", element: turn({ lit: true, seconds: 3 }) },
    { tone: "ok", element: turn({ netNote: { tone: "ok", text: "Di nuovo in linea" } }) },
    { tone: "bad", element: turn({ netNote: { tone: "bad", text: "Connessione persa" } }) },
  ],
  hudCombo: [{ tone: "neutral", element: <HudComboNotice scale={1} who="Luan" combo="Coppia" empty="Tavolo vuoto" /> }],
} satisfies Record<NoticeKind, NoticeFixture[]>;
```

`seconds: 3` with `lit` renders the ember state at mount (`CLOCK_RUNNING_OUT_SECONDS` is at least 3: check `components/turnTimerUi.ts` and use its constant if it differs). The strings here are fixture data, not user-facing copy. The gallery is imported only by tests and the bench.

- [ ] **Step 9: Write the stage helper and the first pixel check**

```ts
// tests/e2e/helpers/mockupStage.ts — the mockup fixture and the app, on one 874x402 stage, read as computed paint.
import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { FIXTURE, newSidePage } from "./mockupParity";
import { TABLE } from "./parityRegions";
import { takeOver } from "./virtualClock";
import { DEAL_SIZE, holdSeededTurn, offlineGameSave, resumeSaved } from "./offlineSeed";
import { atRest } from "./settle";
import { TABLE_SCREEN } from "./selectors";
import type { GameState } from "../../../lib/game/gameEngine";

export async function openMockupStage(browser: Browser): Promise<Page> {
  const page = await newSidePage(browser);
  await page.goto(FIXTURE);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate("paused = true");
  const frameBox = async () => (await page.locator("#frame").boundingBox())!;
  const off = TABLE.width - (await frameBox()).width;
  if (off !== 0) await page.setViewportSize({ width: TABLE.width + off, height: TABLE.height });
  await page.setViewportSize({ width: TABLE.width + off, height: Math.ceil((await frameBox()).y + TABLE.height) });
  await takeOver(page);
  expect((await frameBox()).width).toBe(TABLE.width);
  return page;
}

export async function mockupAt(browser: Browser, chapter: string, ms: number): Promise<Page> {
  const page = await openMockupStage(browser);
  await page.evaluate(([c, t]) => (window as unknown as { T: { go(c: string, t: number): void } }).T.go(c, t), [chapter, ms] as const);
  return page;
}

export async function appAt(browser: Browser, baseURL: string, gameState: GameState): Promise<Page> {
  const context = await browser.newContext({ viewport: TABLE, deviceScaleFactor: 2, locale: "it-IT", baseURL });
  const page = await context.newPage();
  await holdSeededTurn(page);
  const n = gameState.players.length as 2 | 3 | 4;
  await resumeSaved(page, baseURL, { ...offlineGameSave(n, DEAL_SIZE[n], gameState.currentTurnIndex), gameState });
  await atRest(page, TABLE_SCREEN);
  return page;
}

export const stageOrigin = async (page: Page) =>
  (await page.locator("#frame").count()) ? (await page.locator("#frame").boundingBox())! : { x: 0, y: 0 };

export interface Paint {
  x: number; y: number; w: number; h: number; radius: number;
  fill: string; edge: string; ink: string; fontSize: number; track: number; glow: string; opacity: number;
}

export async function paintOf(plate: Locator, label: Locator, origin: { x: number; y: number }): Promise<Paint> {
  const box = (await plate.boundingBox())!;
  const p = await plate.evaluate((el) => {
    const s = getComputedStyle(el);
    let opacity = 1;
    for (let n: Element | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    return { radius: parseFloat(s.borderTopLeftRadius), fill: s.backgroundColor, edge: s.borderTopColor, glow: s.boxShadow, opacity };
  });
  const l = await label.evaluate((el) => {
    const s = getComputedStyle(el);
    return { ink: s.color, fontSize: parseFloat(s.fontSize), track: parseFloat(s.letterSpacing) || 0 };
  });
  return { x: box.x - origin.x, y: box.y - origin.y, w: box.width, h: box.height, ...p, ...l };
}

const rgba = (c: string) => {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 0];
  const [r, g, b, a = "1"] = m[1].split(",").map((v) => v.trim());
  return [Number(r), Number(g), Number(b), Number(a)];
};

export function expectPaint(app: Paint, mock: Paint, keys: (keyof Paint)[], mapped: Partial<Paint> = {}): void {
  const want = { ...mock, ...mapped };
  for (const k of keys) {
    const [a, w] = [app[k], want[k]];
    if (k === "fill" || k === "edge" || k === "ink") {
      const [x, y] = [rgba(a as string), rgba(w as string)];
      x.slice(0, 3).forEach((v, i) => expect(Math.abs(v - y[i]), `${k} ${a} vs ${w}`).toBeLessThanOrEqual(3));
      expect(Math.abs(x[3] - y[3]), `${k} alpha ${a} vs ${w}`).toBeLessThanOrEqual(0.02);
    } else if (k === "glow") {
      expect(rgba(a as string).slice(0, 3), `glow ${a} vs ${w}`).toEqual(rgba(w as string).slice(0, 3));
    } else {
      expect(Math.abs((a as number) - (w as number)), `${k} ${a} vs ${w}`).toBeLessThanOrEqual(k === "fontSize" ? 0.3 : 1);
    }
  }
}
```

Export `FIXTURE` at `mockupParity.ts:29`, and make `captureMockup` (`:297-307`) start with `const page = await openMockupStage(browser);` in place of its first eight lines. Export `holdSeededTurn` at `offlineSeed.ts:121`. Move `setSafeArea` (`controlRail.spec.ts:71-89`) verbatim into `tests/e2e/helpers/safeArea.ts` as an export, and import it back.

```ts
// tests/e2e/mockupPolish.spec.ts — each #14 difference the owner kept (D4), against the mockup fixture.
import { test } from "@playwright/test";
import { captureGameState, captureStateById } from "../../lib/captureStates";
import { appAt, expectPaint, mockupAt, paintOf, stageOrigin } from "./helpers/mockupStage";

const state = (id: string) => captureGameState(captureStateById(id)!);

test("turn, lit: the viewer's turn pill is the mockup's #turn.lit (L101-102)", async ({ browser, baseURL }) => {
  const mock = await mockupAt(browser, "rest", 1000);
  const app = await appAt(browser, baseURL!, state("lamp-bottom"));
  const m = await paintOf(mock.locator("#turn"), mock.locator("#turn"), await stageOrigin(mock));
  const plate = app.getByTestId("turn-chip-dot").locator("xpath=..");
  const a = await paintOf(plate, plate.locator('[dir="auto"]').first(), await stageOrigin(app));
  expectPaint(a, m, ["h", "radius", "fill", "edge", "ink", "fontSize", "glow"]);
});

test("turn: the pill stays inside its band with the longest seat name", async ({ browser, baseURL }) => {
  const app = await appAt(browser, baseURL!, state("lamp-left"));
  const pill = (await app.getByTestId("turn-chip-dot").locator("xpath=..").boundingBox())!;
  const band = (await app.getByTestId("game-hud-stack").boundingBox())!;
  test.expect(pill.x).toBeGreaterThanOrEqual(band.x);
  test.expect(pill.x + pill.width).toBeLessThanOrEqual(band.x + band.width);
});
```

`lamp-left` puts Besnik on move (`lib/captureStates.ts:85-90`), the longest bot name. The `rest` chapter at 1000 ms has `setTurn('you', true)` with the clock running (fixture L660).

- [ ] **Step 10: Run the local checks**

Run: `node --test tests/ui-rules/noticePaintLint.test.ts && npx tsc --noEmit -p . && npx eslint components/table/TableNotice.tsx components/table/notices components/GameTable.tsx app/tutorial.tsx eslint.config.js eslint.selectors.cjs tests/e2e/helpers/mockupStage.ts tests/e2e/mockupPolish.spec.ts`
Expected: PASS. Before the rule was added (Step 2), the planted file was clean. If `lintText` reports `File ignored`, the notices path is under an `ignores` glob: fix the glob, never the test.

- [ ] **Step 11: Prove the pixel check red on today's tree, then commit**

Run rule 3's one spec locally on a stash-free copy of main: `git worktree add ../mp-red origin/main` outside `.worktrees/` (memory: side-session worktrees), then copy the spec and helper there.
Expected: "turn, lit" FAILS with `edge rgba(201, 168, 76, 0.5) vs rgba(243, 224, 166, 0.8)`. Remove that worktree with `npm run worktrees:remove` (rule 39).

```bash
git add -- components/table/TableNotice.tsx components/table/notices/hud.tsx components/table/notices/gallery.tsx components/table/turnChip.tsx components/GameTable.tsx app/tutorial.tsx eslint.config.js eslint.selectors.cjs tests/native/tableNotices.test.tsx tests/native/turnChipLabel.test.tsx tests/native/turnTimerAnnouncement.test.tsx tests/ui-rules/noticePaintLint.test.ts tests/e2e/helpers/mockupStage.ts tests/e2e/helpers/mockupParity.ts tests/e2e/helpers/offlineSeed.ts tests/e2e/helpers/safeArea.ts tests/e2e/controlRail.spec.ts tests/e2e/mockupPolish.spec.ts
git commit -m "feat(table): TableNotice paints the turn and HUD pills, in the mockup's lit style"
```

CI runs `tests/native/tableNotices.test.tsx`, `turnChipLabel`, `turnTimerAnnouncement`, `tableStatus`, `tutorialTableBeats`, `a11yOneNode`, `iconSubset` and `tests/e2e/mockupPolish.spec.ts`, `tableProportions.spec.ts` and `controlRail.spec.ts`.

---

### Task 3: Seat marks: PASSO rises as a 15 pt mark (D4 #6); the reconnect and vacated marks

**Depends on:** D4 #6. On the other answer, `passed` keeps pill geometry in the name row, and the spec's "PASSO" test drops.

**Files:**
- Create: `components/table/notices/seatMarks.tsx` (`PassedMark`, `SeatReconnectingMark`, `SeatVacatedMark`)
- Modify:
  - `components/table/seats.tsx:577-648` (the three chips move out) and the seat disc wrapper (`:498`), which hosts the absolutely placed `PassedMark`
  - `components/table/chrome.tsx:189-342` (delete `TableChip`, `ChipText`, `ChipDot` and `chipStyles`; `rg -n "TableChip|ChipText|ChipDot" components app` must print nothing)
  - `components/table/noticeModel.ts` (kinds `passed`, `seatReconnecting`, `seatVacated`)
  - `components/table/notices/gallery.tsx`
  - `tests/ui-rules/contrast.test.ts:224` (`CHIP` now names `TableNotice`'s plate)
  - `lib/captureStates.ts` (a `passed` state)
  - `tests/native/passMarker.test.tsx` (it finds the mark by `notice-passed`)
  - `tests/e2e/mockupPolish.spec.ts`
- Coordinate: plan 3 owns the seat bands (`seatLayout.ts`). This task only places the mark relative to the disc centre.

**Interfaces:**
- Consumes: `TableNotice` and `pt` (Tasks 1–2).
- Produces:
  - `PassedMark({ scale, side }: { scale: number; side: "top" | "left" | "right" })`
  - `SeatReconnectingMark({ seconds, resetKey, scale })` (same props as `ReconnectingChip`, `seats.tsx:599`)
  - `SeatVacatedMark({ scale })`

- [ ] **Step 1: Write the failing pixel check**

The app state has the pile from seat 3 and the viewer on move. By `passedSeats` (`flightPhysics.ts:746-765`), seats 2 (top) and 1 (right) have passed. In the mockup, Besnik (the top seat) passes at 4150 in `trick` (L608), so at 4400 his mark has finished rising.

```ts
test("PASSO: a 15 pt mark beside the top disc, as .passo (L86-87)", async ({ browser, baseURL }) => {
  const mock = await mockupAt(browser, "trick", 4400);
  const passed = { ...state("pile-right"), lastPlayedBy: 3, currentTurnIndex: 0 };
  const app = await appAt(browser, baseURL!, passed);
  const mo = await stageOrigin(mock);
  const passo = mock.locator('#seats .seat[data-side="top"] .passo');
  const m = await paintOf(passo, passo, mo);
  const label = app.getByTestId("top-seat").getByText("Passo", { exact: false });
  const a = await paintOf(label.locator("xpath=.."), label, await stageOrigin(app));
  const mockDisc = (await mock.locator('#seats .seat[data-side="top"] .disc').boundingBox())!;
  const appDisc = (await app.getByTestId("top-seat").getByTestId("seat-ring").boundingBox())!;
  const centreOf = (b: { x: number; w?: number; width?: number; y: number; h?: number; height?: number }) => ({
    x: b.x + (b.w ?? b.width!) / 2, y: b.y + (b.h ?? b.height!) / 2,
  });
  const dm = centreOf({ x: m.x, y: m.y, w: m.w, h: m.h });
  const da = centreOf({ x: a.x, y: a.y, w: a.w, h: a.h });
  const cm = centreOf({ ...mockDisc, x: mockDisc.x - mo.x, y: mockDisc.y - mo.y });
  const ca = centreOf(appDisc);
  expectPaint(a, m, ["h", "fill", "edge", "ink", "fontSize", "opacity"], { fontSize: 10, edge: "rgba(201, 168, 76, 0.3)" });
  test.expect(Math.abs(da.x - ca.x - (dm.x - cm.x))).toBeLessThanOrEqual(1);
  test.expect(Math.abs(da.y - ca.y - (dm.y - cm.y))).toBeLessThanOrEqual(1);
});
```

The two mapped values are documented departures: the text floor (`cardFaceModel.ts:28`), and the `.35` gold edge on the five-step scale (`components/CLAUDE.md:62`).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/mockupPolish.spec.ts -g PASSO` (rule 3, one spec).
Expected: FAIL on `h 23… vs 15`, because today's `PassedChip` is a `TableChip`.

- [ ] **Step 3: Add the kinds and the marks**

In `noticeModel.ts`, append to the union: `| "passed" | "seatReconnecting" | "seatVacated"`. Add to `NOTICES`:

```ts
  passed: { shape: "chip", tones: ["neutral"] },
  seatReconnecting: { shape: "chip", tones: ["neutral"] },
  seatVacated: { shape: "chip", tones: ["neutral"] },
```

```tsx
// components/table/notices/seatMarks.tsx
import { StyleSheet, View } from "react-native";
import { useTranslation } from "@/lib/i18n";
import { TableNotice } from "../TableNotice";
import { pt } from "../noticeModel";

// .passo, index.html:87-88: the top seat's mark sits left of the disc, a side seat's under it.
export function PassedMark({ scale, side }: { scale: number; side: "top" | "left" | "right" }) {
  const { t } = useTranslation();
  const top = side === "top";
  return (
    <View
      pointerEvents="none"
      style={[styles.anchor, { left: pt(top ? -60 : 0, scale), top: pt(top ? -8 : 27, scale), transform: [{ translateX: "-50%" }] }]}
    >
      <TableNotice kind="passed" tone="neutral" scale={scale} text={t("gameShared.passedLabel")} />
    </View>
  );
}

const styles = StyleSheet.create({ anchor: { position: "absolute" } });
```

`SeatReconnectingMark` and `SeatVacatedMark` keep the bodies of `ReconnectingChip` / `VacatedChip` (`seats.tsx:599-648`). They render `<TableNotice kind="seatReconnecting" tone="neutral" testID="seat-reconnect-chip" … text={…} strong={String(seconds)} />` and `<TableNotice kind="seatVacated" tone="neutral" testID="seat-vacated-chip" … />`, keeping the testIDs.

- [ ] **Step 4: Place the mark on the disc**

In `seats.tsx`, remove `PassedChip` from `SeatBadges`. Render `{passed && <PassedMark scale={scale} side={side} />}` inside a zero-size view centred on the disc: the `seat-ring` wrapper (`:498`) gains a child `<View style={{ position: "absolute", left: size / 2, top: size / 2 }}>`. Each slot passes its side:
- `TopOppSlot` passes `"top"`;
- `SideOppSlot` passes `side` (`:888`).

Delete `TableChip`, `ChipText`, `ChipDot` and `chipStyles` from `chrome.tsx`. In `contrast.test.ts:224`, change `CHIP` to `{ plate: "styles.plate" }` against `table/TableNotice.tsx`, and classify `"table/TableNotice.tsx:styles.label": { plate: "styles.plate" }` and `"table/TableNotice.tsx:styles.strong": { plate: "styles.plate" }`. Task 1's tone loop is what holds the per-tone inks.

- [ ] **Step 5: The gallery, the capture state, and the native test**

In `gallery.tsx`, add:

```tsx
  passed: [{ tone: "neutral", element: <PassedMark scale={1} side="top" /> }],
  seatReconnecting: [{ tone: "neutral", element: <SeatReconnectingMark seconds={20} resetKey="g" scale={1} /> }],
  seatVacated: [{ tone: "neutral", element: <SeatVacatedMark scale={1} /> }],
```

In `lib/captureStates.ts`, append a state `{ id: "passed", label: "Your turn after two passes: the PASSO marks on the top and right seats", playerCount: 4, turn: 0, side: "bottom", pile: true }`. In `captureGameState`, a state whose id is `passed` sets `lastPlayedBy: 3` instead of `pileFrom`. `tests/tooling/captureStates.test.ts` pins `side` against `seatDirection`. The label is dev copy, read by a person (`captureStates.ts:37-38`), not `t()` copy.

In `passMarker.test.tsx`, the marker query becomes `screen.getAllByTestId("notice-passed")`, and its count assertions are unchanged.

- [ ] **Step 6: Run the checks**

Run: `npx tsc --noEmit -p . && npx eslint components/table/notices components/table/seats.tsx components/table/chrome.tsx lib/captureStates.ts && node --test tests/ui-rules/contrast.test.ts && node --test tests/tooling/captureStates.test.ts && node --test tests/ui-rules/noticePaintLint.test.ts`
Expected: PASS. On CI: `tableNotices`, `passMarker`, `seatReconnectClock`, `seatDimming`, and `mockupPolish.spec.ts` "PASSO".

- [ ] **Step 7: Commit**

```bash
git add -- components/table/notices/seatMarks.tsx components/table/notices/gallery.tsx components/table/noticeModel.ts components/table/seats.tsx components/table/chrome.tsx lib/captureStates.ts tests/ui-rules/contrast.test.ts tests/native/passMarker.test.tsx tests/e2e/mockupPolish.spec.ts
git commit -m "feat(table): PASSO is a 15 pt mark rising beside the seat, as the mockup"
```

---

### Task 4: The pile's notices: the combo mark, the round winner, the exchange name tag

**Depends on:**
- D2.
- Plan 4, which has landed. Its `pile.tsx` keeps two isolated components: `ComboChip({ isPower, label, scale })` and `RoundWinnerTag({ name, scale })`, lifted from today's inline tag. Their props already match `ComboMark` and `RoundWinnerMark` (plan 4, "Plan 5 (lands after)").
- Plan 2, Task 9, which has landed:
  - `ExchangeLegs.tsx` draws the exchange's name tags with plan 2's `ExchangeTag({ name, scale, testID? })`, built from the existing design-system chip tokens (`TableNotice` does not exist yet when plan 2 lands);
  - `ExchangeFlight.tsx`, `ExchangeAnnouncement.tsx` and `ExchangePrompt.tsx` are deleted, with their `contrast.test.ts` rows (`:229,262,263,264`);
  - the exchange choice's text is on the `TurnChip`.

  This task migrates plan 2's `ExchangeTag` onto `TableNotice`, like every other surface, and touches none of the deleted files.

**Files:**
- Create: `components/table/notices/pileNotices.tsx` (`ComboMark`, `RoundWinnerMark`, `ExchangeTag`)
- Modify:
  - wherever plan 2 defined `ExchangeTag`: delete it, with any style entries only it read. `ExchangeLegs.tsx`'s import points at `pileNotices.tsx`; its props and the `exchange-tag-to-winner` / `-to-loser` / `exchange-no-swap` testIDs are unchanged.
  - `components/table/pile.tsx`, by name in plan 4's state: `ComboChip` and `RoundWinnerTag` are deleted, their call sites in `PileLayer` render `ComboMark` / `RoundWinnerMark`, and so do the style entries only those two read (`winnerTag`, `comboChip` and their siblings). Find them by name on the landed file, never by today's line; the `comboLabel` wrapper stays, since it positions whatever mark sits in it.
  - `components/table/noticeModel.ts`, `components/table/notices/gallery.tsx`
  - `tests/native/comboChipEntrance.test.tsx`, `tests/native/roundWinnerBanner.test.tsx` (queries by `notice-<kind>`)
  - `tests/e2e/mockupPolish.spec.ts`

**Interfaces:**
- Consumes: `TableNotice` (`sheen`, `glyph`, `testID`).
- Produces:
  - `ComboMark({ isPower, label, scale })`, with root testID `combo-chip` and sheen testID `combo-chip-sheen`;
  - `RoundWinnerMark({ name, scale })`;
  - `ExchangeTag({ name, scale, testID? })`, the chip shape in the `lit` tone, with plan 2's props, so `ExchangeLegs` changes only its import.

- [ ] **Step 1: Write the failing pixel check**

```ts
test("combo mark: the pile's combination chip is .cchip (L110)", async ({ browser, baseURL }) => {
  const mock = await mockupAt(browser, "rest", 1000);
  const app = await appAt(browser, baseURL!, state("pile-right"));
  const m = await paintOf(mock.locator("#cchip"), mock.locator("#cchip"), await stageOrigin(mock));
  const plate = app.getByTestId("combo-chip").getByTestId("notice-combo");
  const a = await paintOf(plate, app.getByTestId("notice-combo-label"), await stageOrigin(app));
  expectPaint(a, m, ["h", "fill", "edge", "ink", "fontSize"], { fontSize: 10 });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/mockupPolish.spec.ts -g "combo mark"`
Expected: FAIL with `notice-combo` not found. Plan 4's `ComboChip` still paints its own `Radius.sm` / `Scrim.heavy` plate.

- [ ] **Step 3: Add the kinds and move the surfaces**

```ts
  combo: { shape: "chip", tones: ["lit", "urgent"] },
  roundWinner: { shape: "chip", tones: ["lit"] },
  exchangeTag: { shape: "chip", tones: ["lit"] },
```

```tsx
// components/table/notices/pileNotices.tsx
import { TableNotice } from "../TableNotice";

export function ComboMark({ isPower, label, scale }: { isPower: boolean; label: string; scale: number }) {
  return <TableNotice kind="combo" testID="combo-chip" tone={isPower ? "urgent" : "lit"} scale={scale} text={label} sheen={isPower} />;
}

export function RoundWinnerMark({ name, scale }: { name: string; scale: number }) {
  return <TableNotice kind="roundWinner" tone="lit" scale={scale} text={name} glyph="star" />;
}

export function ExchangeTag({ name, scale, testID }: { name: string; scale: number; testID?: string }) {
  return <TableNotice kind="exchangeTag" tone="lit" scale={scale} text={name} testID={testID} />;
}
```

Make these replacements:
- In `pile.tsx`, delete `ComboChip` and `RoundWinnerTag` and their `pileStyles` entries. `PileLayer` renders `<ComboMark isPower={…} label={…} scale={scale} />` and `<RoundWinnerMark name={roundWinner} scale={scale} />` where it rendered them: the same props, one import each.
- The sheen's testID comes from `TableNotice` as `${testID}-sheen`, so it is still `combo-chip-sheen`.
- **`exchangeTag` / `ExchangeTag`.** Always migrate: the `exchangeTag` kind and the `ExchangeTag` above replace plan 2's chip-token version, and plan 2's definition is deleted. The tag's paint moves from the chip tokens to the notice's `lit` chip.
- Nothing else in the exchange is this plan's. Its tags are placed by `ExchangeLegs.tsx`, keeping the `exchange-tag-to-winner` / `exchange-tag-to-loser` testIDs.
- The combo mark's entrance becomes `flash` plus a rise. So `comboChipEntrance.test.tsx`'s expected entrance duration becomes the literal `90`, cited to D2/design §6. It stays a literal and is not read from `Motion`.

In `gallery.tsx`, add one fixture per kind: combo `lit` and `urgent`, then `roundWinner` and `exchangeTag`.

- [ ] **Step 4: Run the checks**

Run: `npx tsc --noEmit -p . && npx eslint components/table/notices components/table/pile.tsx components/table/ExchangeLegs.tsx components/table/ExchangeTag.tsx && node --test tests/ui-rules/contrast.test.ts && node --test tests/ui-rules/noticePaintLint.test.ts && node --test tests/tooling/iconSubset.test.ts`
Expected: PASS. `iconSubset` resolves `glyph="star"` through `TableNotice`'s parameter; if it reports `unresolved`, the glyph was not passed literally. On CI: `tableNotices`, `comboChipEntrance`, `roundWinnerBanner`, `pileFlinch`, plan 4's `pileBeaten.spec.ts`, plan 2's `exchangeAttribution.spec.ts`, `mockupPolish.spec.ts` "combo mark" and `pileHandoff.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add -- components/table/notices/pileNotices.tsx components/table/notices/gallery.tsx components/table/noticeModel.ts components/table/pile.tsx components/table/ExchangeLegs.tsx components/table/ExchangeTag.tsx tests/native/comboChipEntrance.test.tsx tests/native/roundWinnerBanner.test.tsx tests/e2e/mockupPolish.spec.ts
git commit -m "feat(table): the pile's combination, winner, and exchange notices are TableNotices"
```

---

### Task 5: Floats and table lines: the viewer's pass, the reject hint, the error toast, finished, empty hand

**Depends on:** D2. The viewer's pass float is the mockup's `passYou` (L526-527), and research #10 names it.

**Files:**
- Create: `components/table/notices/floats.tsx` (`FloatSlot`, `type FloatNotice`), `components/table/notices/tableLines.tsx` (`FinishedNotice`, `EmptyHandNotice`, `RejectHintNotice`)
- Modify:
  - `components/GameTable.tsx:1334-1338,1424-1448,1476-1505` (finished, reject hint and their styles) and a `floatNotice?: FloatNotice | null` prop
  - `components/table/hand.tsx:954-958,1146-1155` (empty hand)
  - `app/game.tsx` (the viewer's pass float, hooks above `:161`)
  - `app/(online)/game.tsx:452-457,540-558` (the error toast, hooks above `:220`)
  - `components/table/noticeModel.ts`, `gallery.tsx`
  - `tests/ui-rules/contrast.test.ts:230,231,265` (three `SELF` entries go)
  - `tests/e2e/mockupPolish.spec.ts`
- Test: `tests/native/floatSlot.test.tsx`

**Interfaces:**
- Consumes: `TableNotice` (`hold`, `onDone`, `lines`), `A11yStatus` (`lib/a11y.tsx:222`), `passedSeats` (`flightPhysics.ts:746`).
- Produces:
  - `type FloatNotice = { key: number; kind: "viewerPassed" | "autopass" | "errorToast"; text: string }`;
  - `FloatSlot({ notice, scale, onDone })`;
  - `GameTable`'s prop `floatNotice?: FloatNotice | null` and callback `onFloatDone?: () => void`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/native/floatSlot.test.tsx — the float slot holds one float; a new one replaces it and is announced once.
import { expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { FloatSlot } from "@/components/table/notices/floats";

test("a second float replaces the first", async () => {
  const view = await render(<FloatSlot scale={1} notice={{ key: 1, kind: "viewerPassed", text: "Passo" }} onDone={() => {}} />);
  await view.rerender(<FloatSlot scale={1} notice={{ key: 2, kind: "errorToast", text: "Mossa non valida" }} onDone={() => {}} />);
  expect(screen.queryAllByTestId(/^notice-(viewerPassed|errorToast)$/)).toHaveLength(1);
  expect(screen.getByTestId("notice-errorToast-label").props.children).toBe("Mossa non valida");
  expect(screen.getAllByLabelText("Mossa non valida")).toHaveLength(1);
});

test("the live region outlives its floats, so a float that arrives is announced", async () => {
  const view = await render(<FloatSlot scale={1} notice={null} onDone={() => {}} />);
  const region = screen.getByLabelText("");
  await view.rerender(<FloatSlot scale={1} notice={{ key: 3, kind: "viewerPassed", text: "Passo" }} onDone={() => {}} />);
  expect(screen.getByLabelText("Passo")).toBe(region);
});
```

A live region that arrives with its text already in it announces nothing (`turnChip.tsx:92-93`). So the slot's `A11yStatus` (`lib/a11y.tsx:222`) is mounted whether or not a float is up. The second test pins that it is the same node before and after.

```ts
test("float: the viewer's pass rises at (457, 300) as .floatchip (L115, L526)", async ({ browser, baseURL }) => {
  const mock = await mockupAt(browser, "clock", 4300);
  const app = await appAt(browser, baseURL!, { ...state("pile-right"), lastPlayedBy: 3, currentTurnIndex: 0 });
  await app.getByTestId("btn-passa").click();
  const plate = app.getByTestId("notice-viewerPassed");
  await plate.waitFor();
  await app.waitForTimeout(200);
  const m = await paintOf(mock.locator(".floatchip"), mock.locator(".floatchip"), await stageOrigin(mock));
  const a = await paintOf(plate, app.getByTestId("notice-viewerPassed-label"), await stageOrigin(app));
  expectPaint(a, m, ["x", "y", "w", "h", "fill", "edge", "ink", "fontSize"]);
});
```

In `clock`, the viewer's clock expires at `(30000 − 24000) / 1.5 = 4000` ms (L618-619), and `passYou` fades the float in over 100 ms. At 4300 it stands fully.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsc --noEmit -p .`
Expected: FAIL with `Cannot find module '@/components/table/notices/floats'`. Then run `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/mockupPolish.spec.ts -g float`: expected FAIL, `notice-viewerPassed` not found, because the viewer's pass has no marker today.

- [ ] **Step 3: Add the kinds and the floats**

```ts
  viewerPassed: { shape: "float", tones: ["neutral"] },
  autopass: { shape: "float", tones: ["urgent"] },
  errorToast: { shape: "float", tones: ["bad"] },
  rejectHint: { shape: "float", tones: ["neutral"] },
  finished: { shape: "pill", tones: ["lit"] },
  emptyHand: { shape: "pill", tones: ["ok"] },
```

```tsx
// components/table/notices/floats.tsx
import { StyleSheet, View } from "react-native";
import { A11yStatus } from "@/lib/a11y";
import { TableNotice } from "../TableNotice";
import { pt } from "../noticeModel";

export type FloatNotice = { key: number; kind: "viewerPassed" | "autopass" | "errorToast"; text: string };

export function FloatSlot({ notice, scale, onDone }: { notice: FloatNotice | null; scale: number; onDone: () => void }) {
  const shared = { scale, text: notice?.text ?? "", onDone, lines: 2 as const };
  return (
    <View pointerEvents="none" style={[styles.slot, { bottom: pt(78.3, scale) }]}>
      <A11yStatus label={notice?.text ?? ""} />
      {notice?.kind === "viewerPassed" && <TableNotice key={notice.key} kind="viewerPassed" tone="neutral" hold="pass" {...shared} />}
      {notice?.kind === "autopass" && <TableNotice key={notice.key} kind="autopass" tone="urgent" hold="pass" {...shared} />}
      {notice?.kind === "errorToast" && <TableNotice key={notice.key} kind="errorToast" tone="bad" hold="toast" {...shared} />}
    </View>
  );
}

const styles = StyleSheet.create({ slot: { position: "absolute", left: 0, right: 0, alignItems: "center" } });
```

`bottom: pt(78.3)` is `402 − 300 − 23.7` from `.floatchip`'s top (L115). `GameTable` renders `<FloatSlot>` inside its table layer, whose box spans the screen. `key` restarts a float's life when a new one arrives.

Put `FinishedNotice` (`glyph="trophy"`, tone `lit`), `EmptyHandNotice` (`glyph="checkmark-circle"`, tone `ok`) and `RejectHintNotice` (`kind="rejectHint"`, `hold="hint"`, `lines={2}`, `maxTextWidth={REJECT_HINT_MAX_W}`) in `tableLines.tsx`. They take their text through `t()` exactly as `GameTable.tsx:1337` and `hand.tsx:957` do. The reject hint keeps its anchor beside GIOCA (`GameTable.tsx:1424-1448`); only its paint changes. Delete `styles.finishedText`, `rejectHintText`, `rejectHintTextMirrored` and `handStyles.emptyHandText`, and their three `ON_TABLE` rows.

- [ ] **Step 4: Wire the viewer's pass and the error toast**

In `app/game.tsx`, above the `if (!gameState)` guard (`:161`):

```tsx
  const [floatNotice, setFloatNotice] = useState<FloatNotice | null>(null);
  const viewerPassed = gameState !== null && passedSeats(passedInput(gameState)).includes(0);
  const [passedShown, setPassedShown] = useState(viewerPassed);
  if (viewerPassed !== passedShown) {
    setPassedShown(viewerPassed);
    if (viewerPassed) setFloatNotice({ key: Date.now(), kind: "viewerPassed", text: t("gameShared.passedLabel") });
  }
```

`passedInput` is the adapter `GameTable` already builds for `passedSeats`: `rg -n "passedSeats\(" components/GameTable.tsx`. Hoist it to `components/flightPhysics.ts` as `passedInput(state: GameState)` if it is inline, and reuse it in both places rather than writing a second one.

Pass `floatNotice={floatNotice}` and `onFloatDone={() => setFloatNotice(null)}` to `GameTable`.

In `app/(online)/game.tsx`:
- Replace the toast at `:452-457` by setting `floatNotice` to `{ key, kind: "errorToast", text: error }` whenever `error` changes, reset in render the same way.
- Delete `styles.errorToast` and `styles.errorText`.

Both new hooks sit above `:220`.

- [ ] **Step 5: Gallery, checks, commit**

Add one fixture per new kind to `gallery.tsx`. `FinishedNotice` and `EmptyHandNotice` render with `scale={1}`; the three floats go through `FloatSlot`.

Run: `npx tsc --noEmit -p . && npx eslint components/table/notices components/GameTable.tsx components/table/hand.tsx app/game.tsx "app/(online)/game.tsx" && node --test tests/ui-rules/contrast.test.ts && node --test tests/ui-rules/noticePaintLint.test.ts && node --test tests/tooling/iconSubset.test.ts`
Expected: PASS. On CI: `floatSlot`, `tableNotices`, `seatFinishTrophy`, the hook-order tests of both screens, and `mockupPolish.spec.ts` "float".

```bash
git add -- components/table/notices/floats.tsx components/table/notices/tableLines.tsx components/table/notices/gallery.tsx components/table/noticeModel.ts components/GameTable.tsx components/table/hand.tsx components/flightPhysics.ts app/game.tsx "app/(online)/game.tsx" tests/native/floatSlot.test.tsx tests/ui-rules/contrast.test.ts tests/e2e/mockupPolish.spec.ts
git commit -m "feat(table): one float slot for the viewer's pass and errors; finished and empty-hand lines"
```

---

### Task 6: Connection notes in the turn pill, `OfflineBanner` as a notice (D3), the end-match vote, autopass

**Depends on:**
- D3. On the other answer, `offline` drops from `NoticeKind`, `OfflineBanner.tsx` is untouched, and the "offline" pixel check drops.
- The autopass surface departs from design §6's "panel" (see the design questions). On a panel answer, `autopass` moves to Task 7's panel shape.

**Files:**
- Create: `components/table/notices/netNotes.tsx` (`EndMatchVoteNotice`)
- Modify:
  - `components/OfflineBanner.tsx` (export `useNetOffline`; render a `TableNotice`)
  - `components/GameTable.tsx` (prop `netNote`, passed to `TurnNotice`)
  - `app/(online)/game.tsx:340-410,512-540` (the reconnect banners become `netNote`; the vote becomes `EndMatchVoteNotice`)
  - `app/game.tsx:207-215` (autopass float in place of `showNotification`)
  - `context/OnlineGameContext.tsx:612-630` and `context/onlineGameHooks.ts` (an `autoPassNotice` field in the turn-clock slice)
  - `CONTEXT.md:26` (37 fields become 38)
  - `components/table/noticeModel.ts`, `gallery.tsx`
  - `tests/native/offlineAutoPass.test.tsx`, `tests/native/offlineBannerLargeText.test.tsx`, `tests/e2e/offlineBannerFit.spec.ts`, `tests/ui-rules/contextSlices.test.ts`
  - `tests/e2e/mockupPolish.spec.ts`

**Interfaces:**
- Consumes: `TurnNotice`'s `netNote` (Task 2), `FloatSlot` (Task 5).
- Produces:
  - `useNetOffline(): boolean`, true only on `isConnected === false`;
  - `GameTable` prop `netNote?: { tone: "neutral" | "ok" | "bad"; text: string } | null`;
  - `EndMatchVoteNotice({ text, a11yLabel, onPress, scale })`;
  - `OnlineGameContext`'s `autoPassNotice: { key: number; text: string } | null`.

- [ ] **Step 1: Write the failing pixel check**

```ts
test("offline: the offline notice is the mockup's #turn.bad (L107)", async ({ browser, baseURL }) => {
  const mock = await mockupAt(browser, "reconnect", 8000);
  const context = await browser.newContext({ viewport: { width: 874, height: 402 }, deviceScaleFactor: 2, locale: "it-IT", baseURL });
  const app = await context.newPage();
  await app.goto("/");
  await context.setOffline(true);
  const plate = app.getByTestId("offline-banner").getByTestId("notice-offline");
  await plate.waitFor();
  const m = await paintOf(mock.locator("#turn"), mock.locator("#turn"), await stageOrigin(mock));
  const a = await paintOf(plate, app.getByTestId("notice-offline-label"), await stageOrigin(app));
  expectPaint(a, m, ["h", "radius", "edge", "ink", "fontSize"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/mockupPolish.spec.ts -g offline`
Expected: FAIL, `notice-offline` not found, because the band is a red `Text` strip.

- [ ] **Step 3: `useNetOffline` and the banner**

Move the NetInfo subscription out of `OfflineBanner` (`:56-69`) into the hook, keeping its invariant line verbatim:

```tsx
export function useNetOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        // This exact check is an app invariant — do not change it to `!state.isConnected`.
        setOffline(state.isConnected === false);
      }),
    []
  );
  return offline;
}

export function OfflineBanner() {
  const { t } = useTranslation();
  const offline = useNetOffline();
  const { top } = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const onTable = usePathname().startsWith("/game");
  const scale = cardScale(Math.min(width, height));
  return (
    <View
      testID="offline-banner"
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion={offline && !onTable ? "assertive" : "none"}
      {...a11yHidden(!offline || onTable)}
      style={[styles.band, { top: top + pt(13.4, scale) }]}
    >
      <TableNotice kind="offline" tone="bad" dot="on" glyph="cloud-offline" scale={scale} visible={offline && !onTable} text={t("offlineBanner.text")} />
    </View>
  );
}

const styles = StyleSheet.create({ band: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: Layer.alert } });
```

`OfflineBanner.tsx` is not under `components/table/notices/`, so it may keep `Layer`. It paints nothing itself. On `/game` (both game screens resolve there, `app/_layout.tsx:34-40`), the table's turn pill carries the note instead (Step 4). Delete `BANNER_H`, `BANNER_OFFSCREEN_Y`, the measured-height logic and the old styles.

- [ ] **Step 4: Connection notes in the turn pill; the vote; autopass**

In `app/(online)/game.tsx`, above `:220`:

```tsx
  const netOffline = useNetOffline();
  const netNote = netOffline
    ? { tone: "bad" as const, text: t("offlineBanner.text") }
    : !connected
      ? { tone: "neutral" as const, text: t("onlineGame.reconnecting") }
      : reconnectNotice
        ? { tone: "ok" as const, text: reconnectNotice }
        : null;
```

Then:
- Pass `netNote` to `GameTable`, which hands it to `TurnNotice`.
- The `banners` slot keeps only the vote. `EndMatchVoteNotice` renders `<TableNotice kind="endMatchVote" tone="neutral" glyph="flag" onPress={…} a11yLabel={…} … />`, and the existing `endMatchVoteHint` node and `A11yStatus` (`:400-410`) stay beside it.
- Delete `styles.reconnectBanner*` and `styles.bannerRow`.

In `app/game.tsx:207-215`, replace `showNotification({...afk})` with `setFloatNotice({ key: Date.now(), kind: "autopass", text: t("game.autoPassTitle") })`. Keep `hapticWarn()` and `passTurnRef.current()`.

In `OnlineGameContext.tsx:614-620`, the `afk` branch sets `autoPassNotice` to `{ key: Date.now(), text }` instead of calling `showNotification`. Expose it in the turn-clock slice of `onlineGameHooks.ts`. The online screen turns it into `floatNotice` in render, as Task 5 does for errors. Update `CONTEXT.md:26` to 38 fields (rule 43).

The viewer's own pass float and autopass must not both fire for one pass. `FloatSlot` holds one float, and autopass is set in the same tick as the pass it causes, so it takes the slot: `setFloatNotice` for `viewerPassed` in Task 5's render-time reset runs only when `floatNotice?.kind !== "autopass"`.

Add to `noticeModel.ts`:

```ts
  offline: { shape: "pill", tones: ["bad"] },
  endMatchVote: { shape: "pill", tones: ["neutral"] },
```

- [ ] **Step 5: Rewrite the tests that named the old surfaces**

- `offlineAutoPass.test.tsx`: "the banner naming it" becomes `screen.getByTestId("notice-autopass-label")` with `t("game.autoPassTitle")`.
- `offlineBannerLargeText.test.tsx`: at a 3.1 font scale, the label carries `maxFontSizeMultiplier` `TABLE_FONT_SCALE_MAX` and `numberOfLines` 1.
- `offlineBannerFit.spec.ts`: the pill's box lies within the viewport and above the first focusable control on `/`, at 375×812 and 874×402.
- `contextSlices.test.ts`: `autoPassNotice` is in exactly one slice.

- [ ] **Step 6: Gallery, checks, commit**

In `gallery.tsx`, add `offline` (the `OfflineBanner`) and `endMatchVote`. `tableNotices.test.tsx` gains two mocks:
- `@react-native-community/netinfo`, reporting `isConnected: false` the way `offlineBannerLargeText.test.tsx` mocks it;
- `expo-router`'s `usePathname`, returning `"/"`.

Run: `npx tsc --noEmit -p . && npx eslint components/OfflineBanner.tsx components/table/notices components/GameTable.tsx app/game.tsx "app/(online)/game.tsx" context && node --test tests/ui-rules/contextSlices.test.ts && node --test tests/ui-rules/noticePaintLint.test.ts && node --test tests/tooling/iconSubset.test.ts`
Expected: PASS. On CI: `tableNotices`, `offlineAutoPass`, `offlineBannerLargeText`, the online screen's reconnect tests (`rg -l "onlineGame.reconnecting" tests`), `offlineBannerFit.spec.ts` and `mockupPolish.spec.ts` "offline".

```bash
git add -- components/OfflineBanner.tsx components/table/notices/netNotes.tsx components/table/notices/gallery.tsx components/table/noticeModel.ts components/GameTable.tsx app/game.tsx "app/(online)/game.tsx" context/OnlineGameContext.tsx context/onlineGameHooks.ts CONTEXT.md tests/native/offlineAutoPass.test.tsx tests/native/offlineBannerLargeText.test.tsx tests/e2e/offlineBannerFit.spec.ts tests/ui-rules/contextSlices.test.ts tests/e2e/mockupPolish.spec.ts
git commit -m "feat(table): connection notes ride the turn pill; OfflineBanner is a notice (D3)"
```

---

### Task 7: The panel (gated on a `/design` mockup): who starts, rematch

**Depends on:** D2, and on the owner approving the panel mockup made in Step 1. The exchange prompt is not a panel here: plan 2 replaces it with `exchangeTag` chips (Task 4).

**Files:**
- Create: `components/table/notices/panels.tsx` (`WhoStartsNotice`, `RematchNotice`)
- Modify:
  - `components/table/TableNotice.tsx` (the panel's `title`, `rule`, `actions` and `gate` props)
  - `components/table/noticeModel.ts` (the panel numbers from the mockup)
  - `components/table/chrome.tsx:49-176,596-640` (delete `StartReasonBanner` and `StartCardBanner`)
  - `components/GameTable.tsx:952,1061-1067,1213-1219,1411-1418`
  - `components/table/rematchPrompt.tsx`
  - `tests/ui-rules/contrast.test.ts:223,225`
  - `tests/native/startAnnouncement.test.tsx`
  - `gallery.tsx`
  - `locales/{en,it,sq}` for one key, `gameTable.whoStartsTitle`

**Interfaces:**
- Consumes: `TableNotice`.
- Produces:
  - panel props `title?: string`, `rule?: string`, `actions?: { label: string; primary?: boolean; onPress: () => void; testID?: string }[]`, and `gate?: { onRelease: () => void; testID: string }`;
  - `WhoStartsNotice({ reason, players, startCard, starterIsViewer, starterName, holding, onRelease, scale })`.

- [ ] **Step 1 (gate): get the panel's mockup approved**

Contrarian §14: the panel has no mockup reference. Before any code in this task, the lead runs `/design` (rule 24) for one panel in two states: who starts (with the start card) and rematch. The prompt is:

> "The score board's plate (`tests/e2e/fixtures/lantern-table/index.html:118`, `.hd` L128, `.rw` L131, `.bb` L154-155) as a notice panel at the table's centre."

The owner approves it. Record the approved padding, gap, title spacing and button row in `noticeGeometry("panel", …)` (Task 1's provisional 14/12/8). Add the approved mockup's HTML to `tests/e2e/fixtures/notice-panel/index.html` so Step 2 can be checked against it.

This task does not start until the fixture is committed. If the owner rejects every option, the task stops here and is reported.

- [ ] **Step 2: Write the failing tests**

```ts
test("panel: who starts is the approved panel (fixtures/notice-panel)", async ({ browser, baseURL }) => {
  const mockPage = await (await browser.newContext({ viewport: { width: 874, height: 402 }, deviceScaleFactor: 2 })).newPage();
  await mockPage.goto(pathToFileURL(path.resolve(__dirname, "fixtures", "notice-panel", "index.html")).href);
  const app = await appAt(browser, baseURL!, { ...state("lamp-bottom"), firstPlayMade: false });
  const m = await paintOf(mockPage.locator("#who-starts"), mockPage.locator("#who-starts .t"), { x: 0, y: 0 });
  const a = await paintOf(app.getByTestId("notice-whoStarts"), app.getByTestId("notice-whoStarts-label"), await stageOrigin(app));
  expectPaint(a, m, ["x", "y", "w", "h", "radius", "edge", "ink", "fontSize"]);
});
```

Add `import path from "node:path"; import { pathToFileURL } from "node:url";` to the spec. `#who-starts` and `.t` are the ids the Step 1 fixture must carry; write them into the `/design` prompt.

In `tests/native/startAnnouncement.test.tsx`, add:

```tsx
test("who starts is one notice while the gate holds and the start card is due", async () => {
  await renderTableHoldingForStart();
  expect(screen.getAllByTestId("notice-whoStarts")).toHaveLength(1);
  expect(screen.getByTestId("start-reason-gate")).toBeTruthy();
});
```

`renderTableHoldingForStart` is the render that file already uses for the gate. Read the file, and reuse its setup under that name if it is inline.

- [ ] **Step 3: Run them to verify they fail**

Expected:
- The native test FAILS with `notice-whoStarts` not found: today `StartReasonBanner` and `StartCardBanner` are two plates (`GameTable.tsx:1061,1213`).
- The Playwright test FAILS on the same selector.

- [ ] **Step 4: The panel body, and the two panels**

Add to `TableNotice`, inside the plate, only when `shape === "panel"`:
- `title`, as `TableText` in the `.hd` style: `strongType`, `track`, `paint.strong`, uppercase;
- `rule`, a 1-pt line in `paint.edge`, full width;
- the `text` body;
- `actions`, a row of pressables 30 mockup px tall with radius 15. Primary is `Gradient.playButton`, the others `Notice.fill` with `Notice.panelEdge`.

`gate` wraps the plate in a full-table `Pressable` (`testID` = `gate.testID`, `onPress` = `gate.onRelease`) painted `Scrim.medium` at `zIndex: Layer.hint`, the layer `StartReasonBanner` uses today (`chrome.tsx:100`). All of it lives in `TableNotice.tsx`, the only file allowed these tokens.

`WhoStartsNotice` has one timer and one text:
- It merges `StartReasonBanner`'s `Reading.notice` timer and `A11yStatus` (`chrome.tsx:58-96`) with `StartCardBanner`'s card line (`:612-625`).
- It stays visible while `holding || (!firstPlayMade && startCard)`.
- It passes `gate` only while `holding`.
- Its `title` is `t("gameTable.whoStartsTitle")` ("Chi inizia" / "Who starts" / "Kush fillon"), the one new key.

`RematchNotice` carries `rematchPrompt.tsx`'s choices as `actions`.

Add to `noticeModel.ts`:

```ts
  whoStarts: { shape: "panel", tones: ["neutral"] },
  rematch: { shape: "panel", tones: ["neutral"] },
```

Then:
- Delete `StartReasonBanner`, `StartCardBanner`, their styles and `rematchPrompt`'s panel styles.
- Delete `START_REASON` and `REMATCH` in `contrast.test.ts`.
- Add fixtures to `gallery.tsx`, including a 1.2× font-scale `whoStarts` fixture that asserts no clipping: `numberOfLines` undefined on the body.

- [ ] **Step 5: Checks, commit**

Run: `npx tsc --noEmit -p . && npx eslint components/table/TableNotice.tsx components/table/notices components/table/chrome.tsx components/GameTable.tsx components/table/rematchPrompt.tsx && node --test tests/ui-rules/contrast.test.ts && node --test tests/ui-rules/noticePaintLint.test.ts && node --test tests/tooling/i18nKeys.test.ts`
Expected: PASS. Find the i18n test's real name first with `rg -l "every key" tests/tooling`. On CI:
- `tableNotices`, `startAnnouncement`, the rematch tests and the bot tests that release the gate (`rg -l "start-reason-gate" tests`);
- `mockupPolish.spec.ts` "panel".

```bash
git add -- components/table/TableNotice.tsx components/table/notices/panels.tsx components/table/notices/gallery.tsx components/table/noticeModel.ts components/table/chrome.tsx components/GameTable.tsx components/table/rematchPrompt.tsx locales tests/ui-rules/contrast.test.ts tests/native/startAnnouncement.test.tsx tests/e2e/fixtures/notice-panel/index.html tests/e2e/mockupPolish.spec.ts
git commit -m "feat(table): one who-starts panel; the rematch prompt on the approved panel"
```

---

### Task 8: Seats: no waiting dim (D4 #1), a red last-card badge (D4 #4)

**Depends on:**
- D4 #1. On the other answer, the dim stays and "seats are not dimmed" drops.
- D4 #4. On the other answer, the badge keeps `goldLit` and "last card" drops.

**Files:**
- Modify:
  - `components/table/seats.tsx:724-725,893-894,937,966` (drop `!isActive && seatDim`; keep the reconnecting dim)
  - `components/table/seats.tsx:1048-1053` and the count text style (`countBubbleTextLast`)
  - `components/table/chrome.tsx:537-539` (`useHandLift`'s comment mentions "the other seats dimming"; say what it lifts against now, or delete the clause)
  - `tests/native/seatDimming.test.tsx` (inverted), `tests/native/seatLowCount.test.tsx`
  - `lib/captureStates.ts:52-57` (the doc comment names "the other seats dimming")
  - `tests/e2e/mockupPolish.spec.ts`

- [ ] **Step 1: Write the failing pixel checks**

```ts
test("seats are not dimmed while they wait (L76-90 dims nothing)", async ({ browser, baseURL }) => {
  const app = await appAt(browser, baseURL!, state("lamp-bottom"));
  for (const seat of ["top-seat", "side-seat-left", "side-seat-right"]) {
    const name = app.getByTestId(seat).getByTestId("seat-name");
    const a = await paintOf(name, name, await stageOrigin(app));
    test.expect(a.opacity, seat).toBeCloseTo(1, 2);
  }
});

test("last card: the badge is .badge.last (L85)", async ({ browser, baseURL }) => {
  const mock = await mockupAt(browser, "mwin", 300);
  const one = state("lamp-bottom");
  one.players[2] = { ...one.players[2], hand: one.players[2].hand.slice(0, 1) };
  const app = await appAt(browser, baseURL!, one);
  const mb = mock.locator('#seats .seat[data-side="top"] .badge');
  const m = await paintOf(mb, mb, await stageOrigin(mock));
  const badge = app.getByTestId("top-seat").getByTestId("seat-card-count");
  const a = await paintOf(badge, badge.locator('[dir="auto"]').first(), await stageOrigin(app));
  expectPaint(a, m, ["fill", "edge", "ink", "glow"]);
});
```

In `mwin`, `counts:{besnik:1}` puts the top seat on its last card from the chapter's start (L627).

- [ ] **Step 2: Run them to verify they fail**

Expected:
- "seats are not dimmed" FAILS with `0.62` against 1 on at least one seat.
- "last card" FAILS with `fill rgba(243, 224, 166, 1) vs rgba(158, 31, 38, 1)`.

- [ ] **Step 3: Implement**

In `TopOppSlot` and `SideOppSlot`, drop the `!isActive && seatStyles.seatDim` lines (`:724`, `:893`). Keep `!!reconnecting && seatStyles.seatDim`, which is not D4 #1's waiting dim.

```ts
  countBubbleLast: {
    backgroundColor: SeatMark.lastFill,
    borderColor: SeatMark.lastEdge,
    ...makeShadow(SeatMark.lastGlow, 0, 0, 0.6, LAST_CARD_GLOW, 0),
  },
  countBubbleTextLast: { color: SeatMark.lastInk },
```

Add `const LAST_CARD_GLOW = 10;` beside `LAST_CARD_BADGE` (`:941`). The mockup's 10 px glow is taken unscaled, as the badge's other shadows are. Import `SeatMark` from `@/lib/theme` (re-exported: check `lib/theme.ts` re-exports `lib/tokens.ts` entirely, and add it there if not). Invert `seatDimming.test.tsx`: a waiting seat has no `opacity` below 1, and a reconnecting seat still has `SEAT_DIM_OPACITY`, found by value in the style, not by the constant. `seatLowCount.test.tsx`'s colour expectation becomes `SeatMark.lastFill`.

- [ ] **Step 4: Checks, commit**

Run: `npx tsc --noEmit -p . && npx eslint components/table/seats.tsx components/table/chrome.tsx lib/captureStates.ts && node --test tests/ui-rules/contrast.test.ts`
Expected: PASS. `SeatMark.lastInk` (#fff) on `#9E1F26` is about 8:1, and contrast reads the new plate through `countBubbleLast`. On CI: `seatDimming`, `seatLowCount`, `seatFinishTrophy`, `lampSeats.spec.ts` and `mockupPolish.spec.ts`.

```bash
git add -- components/table/seats.tsx components/table/chrome.tsx lib/captureStates.ts tests/native/seatDimming.test.tsx tests/native/seatLowCount.test.tsx tests/e2e/mockupPolish.spec.ts
git commit -m "feat(table): waiting seats stay lit; the last card is marked red, as the mockup"
```

---

### Task 9: dropped (D4 #3)

The owner keeps today's garnet PASSA (`actions.tsx:43-49`, `Gradient.garnet`). No task and no new check. The existing guard, `contrast.test.ts:438-445` (`Garnet.label` on every PASSA stop), stays as it is. The numbers of Tasks 10–14 are kept so cross-references stay valid.

---

### Task 10: The player name without its plate (D4 #2), its ink chosen by a measurement; the `SELF` ban

**Depends on:** D4 #2. The owner chose the mockup's bare names. The plate goes in every outcome.
- The measurement decides only the ink. It is the first token of the design system's text scale that passes AA with no plate.
- If no existing token passes, the task stops and asks the owner. There is no fallback to the plate.

**Files:**
- Create: `tests/e2e/seatNameContrast.spec.ts`
- Modify: `components/table/seats.tsx:811,985-1001` and `tests/ui-rules/contrast.test.ts:280-281` (plus the `SELF` ban)
- Sequencing: after plan 3's lamp and seat-band tasks. The backdrop the name sits on is theirs.

- [ ] **Step 1: Write the measurement**

```ts
// tests/e2e/seatNameContrast.spec.ts — a bare seat name on the real felt, under every lamp position, measured.
import { expect, test } from "@playwright/test";
import { CAPTURE_STATES, captureGameState } from "../../lib/captureStates";
import { Colors } from "../../lib/tokens";
import { appAt } from "./helpers/mockupStage";

const SCALE = { textMuted: Colors.textMuted, textSecondary: Colors.textSecondary, text: Colors.text, textPrimary: Colors.textPrimary, goldLit: Colors.goldLit };
const rgb = (c: string) => (c.startsWith("#") ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(1) : c.match(/[\d.]+/g)!.map(Number));
const lum = (c: number[]) => {
  const l = c.map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
};
const ratio = (ink: string, under: number[]) => {
  const [r, g, b, a = 1] = rgb(ink);
  const [hi, lo] = [lum([r, g, b].map((v, i) => v * a + under[i] * (1 - a))), lum(under)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const s of CAPTURE_STATES) {
  test(`${s.id}: every seat name clears 4.5:1 over the brightest felt behind it`, async ({ browser, baseURL }) => {
    const page = await appAt(browser, baseURL!, captureGameState(s));
    const table: Record<string, Record<string, number>> = {};
    for (const name of await page.getByTestId("seat-name").all()) {
      const ink = await name.evaluate((el) => getComputedStyle(el).color);
      await name.evaluate((el) => ((el as HTMLElement).style.visibility = "hidden"));
      const png = await name.screenshot();
      await name.evaluate((el) => ((el as HTMLElement).style.visibility = ""));
      const brightest = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = new OffscreenCanvas(img.width, img.height).getContext("2d")!;
        c.drawImage(img, 0, 0);
        const d = c.getImageData(0, 0, img.width, img.height).data;
        let best = [0, 0, 0], bl = -1;
        for (let i = 0; i < d.length; i += 4) {
          const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          if (y > bl) { bl = y; best = [d[i], d[i + 1], d[i + 2]]; }
        }
        return best;
      }, png.toString("base64"));
      const label = `${await name.textContent()}`;
      table[label] = Object.fromEntries(Object.entries(SCALE).map(([k, c]) => [k, Number(ratio(c, brightest).toFixed(2))]));
      expect(ratio(ink, brightest), `${s.id} ${label}`).toBeGreaterThanOrEqual(4.5);
    }
    await test.info().attach(`${s.id}-name-inks.json`, { body: JSON.stringify(table, null, 2), contentType: "application/json" });
  });
}
```

It hides only the text, so the backdrop measured is the real felt, lamp and vignette. The brightest backdrop pixel is the worst case for light ink. Each state attaches the ratio every candidate ink would get, so one CI run decides the ink without a guess.

- [ ] **Step 2: Remove the plate, then choose the ink from the measurement**

In `seatStyles.oppName` (`:987-1001`), remove `backgroundColor`, `borderRadius` and the padding, keeping the text style. Push, and read `seatNameContrast.spec.ts` on CI.
- **If it passes for every state:** the mockup's own ink (`textMuted`, `.nm` L77) holds, and nothing more changes.
- **If it fails** (my estimate is 1.84:1 for `textMuted` directly over felt stop 0): read the attached `*-name-inks.json`. Set the name's ink to the first token that is at least 4.5 for every name in every state:
  - resting names try `Colors.textSecondary`, then `Colors.text`, then `Colors.textPrimary`;
  - the on-move name (`oppNameActive`, the mockup's `#F3E0A6` = `Colors.goldLit`, L80) tries `goldLit`, then `Colors.text`, then `Colors.textPrimary`.

  This keeps the design system's own text scale (`lib/tokens.ts`, text group) and adds no token. Rerun; the spec goes green on the chosen ink.
- **If no token passes** (even `#FFFFFF` over stop 0 computes 3.37:1, so this is likely wherever a name sits directly under the lamp's centre): stop. Commit nothing from this step, and report the attached tables to the owner (design question 2). Do not bring the plate back and do not add a token.

In `contrast.test.ts`, the two `oppName` rows become `{ stops: [] }` with a one-line pointer to this spec. The file cannot know the lamp's backdrop, and the spec measures it.

- [ ] **Step 3: The class guard "a table text that paints its own plate"**

```ts
test("no <TableText> style is its own plate: a text on a fill is a notice", () => {
  const selfPlated = Object.entries(ON_TABLE).filter(([, b]) => [b.plate ?? []].flat().includes(SELF));
  assert.deepEqual(selfPlated.map(([id]) => id), []);
});
```

This goes red today on eight entries (`contrast.test.ts:229-280`). Plan 2 (landed) deleted four with the exchange's old files (`:229,262,263,264`). Task 5 and this one remove the other four (`:230,231,265,280`), so this step lands green. The next text that paints its own plate must be classified `SELF` to pass the classification test at `:294`, and this test then refuses it. Delete `const SELF` and its branch at `:311` once nothing uses them.

- [ ] **Step 4: Checks, commit**

Run: `npx tsc --noEmit -p . && npx eslint components/table/seats.tsx && node --test tests/ui-rules/contrast.test.ts`
Expected: PASS.

```bash
git add -- components/table/seats.tsx tests/ui-rules/contrast.test.ts tests/e2e/seatNameContrast.spec.ts
git commit -m "feat(table): seat names measured bare on the felt; no table text is its own plate"
```

---

### Task 11: The beaten combo's pose tokens and their check (D4 #5; the pose itself is plan 4's)

**Depends on:**
- D4 #5. On the other answer, plan 4 keeps opacity 0.3, and this check drops.
- Plan 4, which lands before this plan. It owns the `Beaten` token (`lib/tokens.ts`, and `TOKEN_OBJECTS`), `PileLayer`, the `pile-prev-layer` pose view and a `pile-prev-shade` overlay per card (plan 4, "Produces testIDs"). Its `tests/e2e/pileBeaten.spec.ts` already pins the pose (−7°, 9 pt), the view identity and one shade per card. This check adds only what that spec does not assert:
  - the shade's colour, which must equal `.grp.prev`'s `brightness(.6)`;
  - the layer's opacity of 1;
  - the mockup's own value, so a changed fixture is noticed.

**Files:**
- Modify: `tests/e2e/mockupPolish.spec.ts`. This plan defines no `Beaten` and does not touch `pile.tsx` here.

**The iOS constraint, which plan 4 already follows:** `filter: brightness` is a multiply-blend sublayer sized to the view's own bounds (React Native 0.86.3, `RCTViewComponentView.mm:1146-1213`). So the shade is an overlay per opaque card: black at 0.4 equals brightness 0.6.

- [ ] **Step 1: Write the check**

```ts
test("beaten: the previous combination drops 9, turns -7 degrees, and is shaded to .6 (L75)", async ({ browser, baseURL }) => {
  const deck = new Map(createDeck().map((c) => [c.id, c]));
  const moved = new Set(["3_hearts", "3_spades", "K_hearts", "K_spades"]);
  const s = state("lamp-bottom");
  const players = s.players.map((p) => ({ ...p, hand: p.hand.filter((c) => !moved.has(c.id)) }));
  players[0] = { ...players[0], hand: [deck.get("K_hearts")!, deck.get("K_spades")!] };
  const pile = buildCombination([deck.get("3_hearts")!, deck.get("3_spades")!]);
  const app = await appAt(browser, baseURL!, { ...s, players, lastPlayedCombination: pile, lastPlayedBy: 3, currentTurnIndex: 0 });
  await app.locator(HAND_CARDS).nth(0).click();
  await app.locator(HAND_CARDS).nth(1).click();
  await app.getByTestId("btn-gioca").click();
  await atRest(app, TABLE_SCREEN);
  const prev = app.getByTestId("pile-prev-layer");
  const pose = await prev.evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { deg: (Math.atan2(m.b, m.a) * 180) / Math.PI, drop: m.f };
  });
  test.expect(pose.deg).toBeCloseTo(-7, 0);
  test.expect(Math.abs(pose.drop - pt(9, 402 / 390))).toBeLessThanOrEqual(0.5);
  test.expect((await paintOf(prev, prev, { x: 0, y: 0 })).opacity).toBeCloseTo(1, 2);
  const shades = await prev.getByTestId("pile-prev-shade").all();
  test.expect(shades).toHaveLength(2);
  for (const shade of shades) {
    test.expect(await shade.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0.4)");
  }
  const mock = await mockupAt(browser, "bomb", 1500);
  test.expect(await mock.locator(".grp.prev").first().evaluate((el) => getComputedStyle(el).filter)).toBe("brightness(0.6)");
});
```

The imports are `createDeck` and `buildCombination` from `lib/game/gameEngine.ts`, `HAND_CARDS` and `TABLE_SCREEN` from `helpers/selectors`, `atRest` from `helpers/settle`, and `pt` from `components/table/noticeModel.ts`. The viewer holds exactly the two kings, so their order in the hand does not matter.

The check reads plan 4's shade views, because the beaten cards sit under the current combination, so their own pixels cannot be sampled. Black at 0.4 over an opaque card is `brightness(0.6)`: each sRGB channel becomes 0.6·c.

- [ ] **Step 2: Prove it red, then green (rule 6)**

Plan 4 has landed, so this check is green on arrival. Prove it can fail:
1. Set `Beaten.shade` to `'rgba(0,0,0,0.3)'` locally.
2. Run this one spec (rule 3). Expected: FAIL on `rgba(0, 0, 0, 0.3)`.
3. Restore the value, run again, and expect PASS. Commit only the spec.

- [ ] **Step 3: Commit**

```bash
git add -- tests/e2e/mockupPolish.spec.ts
git commit -m "test(table): the beaten combination's pose against the mockup's .grp.prev"
```

---

### Task 12: The table's content under the felt's light (D4 #9; the fix is plan 3's)

**Depends on:**
- D4 #9. On the other answer, the check drops.
- Plan 3's frame-fed `useLampRig` (design §4). The cause:
  - `computeTableFrame` (`components/tableFrame.ts:129-171`) at 874×402 with iPhone 16 Pro insets (62 left, 62 right, 21 bottom) puts the content box at 74..812, centred at 443.
  - `useLampRig` is fed the window (`GameTable.tsx:698-703`), and the vignette is fixed at (457, 210) (`feltShader.ts:70`).
  - With no insets both are at 457, which is why Chromium matches the mockup today.

**Files:**
- Modify: `tests/e2e/mockupPolish.spec.ts`

- [ ] **Step 1: Write the check**

```ts
test("centred: under device insets the felt's light centres on the table's content", async ({ browser, baseURL }) => {
  const app = await appAt(browser, baseURL!, state("pile-right"));
  await setSafeArea(app, 62, 21, 62);
  await atRest(app, TABLE_SCREEN);
  const pile = (await app.getByTestId("pile-area").boundingBox())!;
  await app.addStyleTag({ content: `[data-testid="table-felt"] ~ * { visibility: hidden !important; }` });
  const felt = await app.getByTestId("table-felt").screenshot();
  const cx = await app.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height).getContext("2d")!;
    c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, img.width, img.height).data;
    let sum = 0, wsum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const x = (i / 4) % img.width;
      sum += x * y * y;
      wsum += y * y;
    }
    return sum / wsum / (img.width / 874);
  }, felt.toString("base64"));
  test.expect(Math.abs(cx - (pile.x + pile.width / 2))).toBeLessThanOrEqual(2);
});
```

`pile-right` puts the lamp over the right seat. Use `lamp-bottom` instead if plan 3's lamp hangs at the seat on move: the viewer's seat is the centre line. The squared-luminance weights make the pool dominate the vignette's dark rim.

- [ ] **Step 2: Run it**

Expected, before plan 3: FAIL, with the light centroid more than 2 pt off the pile centre. The research measured 14 pt on the device (`lantern-review.md:483-490`). After plan 3: PASS.

- [ ] **Step 3: Commit**

```bash
git add -- tests/e2e/mockupPolish.spec.ts
git commit -m "test(table): the felt's light centres on the content under device insets"
```

---

### Task 13: The partita ends on the board, not a modal (D4 #10; the build is #1266 → #1267)

**Depends on:**
- D4 #10. On the other answer, #1267 is closed as won't-do and this check drops.
- #1266 and #1267, both open and size L. #1267 already specifies the payoff timeline, `BOARD = {x:237, y:72, w:440, h:252}` (fixture L574) and the rewrite of `resultCutout.spec.ts` / `resultActions.spec.ts`. This task adds one pixel check and nothing more.

**Files:**
- Modify: `tests/e2e/mockupPolish.spec.ts`

- [ ] **Step 1: Write the check**

```ts
test("board: a won partita ends with the score pill as the board (#score at BOARD, L574)", async ({ browser, baseURL }) => {
  const mock = await mockupAt(browser, "pwin", 4000);
  const mb = (await mock.locator("#score").boundingBox())!;
  const mo = await stageOrigin(mock);
  const two = captureGameState({ ...captureStateById("lamp-bottom")!, playerCount: 2 });
  two.players[0] = { ...two.players[0], hand: two.players[0].hand.slice(0, 1) };
  const app = await appAt(browser, baseURL!, two, { [two.players[0].id]: 20 });
  await app.locator(HAND_CARDS).first().click();
  await app.getByTestId("btn-gioca").click();
  const board = app.getByTestId("score-pill");
  await test.expect(async () => {
    const b = (await board.boundingBox())!;
    test.expect(Math.abs(b.x - (mb.x - mo.x))).toBeLessThanOrEqual(1);
    test.expect(Math.abs(b.width - mb.width)).toBeLessThanOrEqual(1);
    test.expect(Math.abs(b.height - mb.height)).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 8000 });
  await test.expect(app.getByRole("dialog")).toHaveCount(0);
});
```

This is a two-seat table. The viewer leads with their last card, so one player still holds cards and the manche ends (`docs/GAME-RULES.md:121`). The first place pays N−1 = 1 point (`gameEngine.ts:1181`), which takes 20 to the save's target of 21 (`offlineSeed.ts:94`).

Extend `appAt` with an optional `scores: Record<string, number> = {}`, passed through as `offlineGameSave`'s fourth argument. Scores are keyed by player id (`lib/game/scorePill.ts:66`).

- [ ] **Step 2: Run it**

Expected, before #1267: FAIL, because the partita ends on the `/result` route or a modal and no `score-pill` box matches the board. After #1267: PASS.

- [ ] **Step 3: Commit**

```bash
git add -- tests/e2e/mockupPolish.spec.ts tests/e2e/helpers/mockupStage.ts
git commit -m "test(table): a won partita ends on the board at the mockup's BOARD box"
```

Then comment on #1267 (rule 25, with a file body) that this check exists, so its implementer runs it.

---

### Task 14: The notice gallery on the bench, and the docs

**Depends on:**
- D8. On the other answer, the gates stay unrun and are reported as such.
- Plan 1, Task 1, which lands `lib/diagnostics/` and `app/bench.tsx` (design §8). This task starts after it has merged, and uses plan 1's recorder, frame-timestamp helper and scenario shape by the names plan 1 gives them.

**Files:**
- Modify:
  - `components/table/TableNotice.tsx` (records a `notice` event in diagnostics builds)
  - `lib/diagnostics/` (a `noticeGallery` scenario, in plan 1's scenario shape)
  - `components/CLAUDE.md` (one design-system line: notices go through `TableNotice`, and `components/table/notices/` lays out only)
  - `CONTEXT.md` (the term **Notice**)
  - `docs/FEEL-BAR.md` (a notices section: the 160 / 90 entrances and one float at a time)

- [ ] **Step 1: Record entrances in diagnostics builds only**

In `TableNotice`'s entrance `withTiming` (Task 2, Step 6), when `process.env.EXPO_PUBLIC_DIAGNOSTICS === "1"`, pass a completion callback. It sends `{ type: "notice", kind, shape, phase: visible ? "in" : "out", ms }`, where `ms` is the UI-frame time from the first frame the animation ran to its last. Use plan 1's frame-timestamp helper, not `Date.now()`, which is the JS clock. Call it through `scheduleOnRN` into diagnostics' event recorder. Metro inlines the constant, so the branch and its import are absent from production. Design §8's bundle check proves that.

- [ ] **Step 2: The scenario**

The scenario mounts each `NOTICE_GALLERY` fixture in turn, five times:
- `visible` true, then after 600 ms false, then unmounted;
- all while the bench's scripted trick runs (design §8);
- then once more with reduced motion, for the `net` dot.

It reports, per kind:
- the p90 entrance against 160 (pill, panel) or 90 (chip, float), plus one regime period;
- blocking stalls in the window, required to be 0;
- the dot's period (1200 ± one frame) and, under reduced motion, a constant 1.

These are literals in the scenario, cited to D2 and design §6, not read from `Motion`.

- [ ] **Step 3: Docs and commit**

Run: `npx tsc --noEmit -p . && npx eslint components/table/TableNotice.tsx lib/diagnostics && node --test tests/tooling/rulesAreSingleSourced.test.ts`
Expected: PASS.

```bash
git add -- components/table/TableNotice.tsx lib/diagnostics components/CLAUDE.md CONTEXT.md docs/FEEL-BAR.md
git commit -m "feat(diagnostics): the notice gallery on the bench; notices in the design system"
```

The owner opens `app/bench.tsx` on the diagnostics build and leaves the phone face up (D8).

---

## Self-review

- **Spec coverage.** Every design §6 item maps to a task:
  - shapes, tones and the no-`style` component: Tasks 1–2;
  - Rajdhani only: `TableNotice`'s two styles;
  - one entrance and exit: `noticeMotion`;
  - `NoticeKind` per surface, with who-starts as one notice: Task 7;
  - the native guard: Task 2, Step 4;
  - the lint with a floor: Task 2, Steps 1–3;
  - a pixel check per kept #14 item: Tasks 2–4, 8, 10–13.
  - D4 #8 is plan 3's, so it has a coverage row and no task. D4 #3 (PASSA) is kept garnet by the owner, so Task 9 is dropped.
  - D2's 160 ms is in `Motion.duration.notice`; D3 is Task 6.
- **Kinds.** There are 18:
  - turn, hudCombo;
  - passed, seatReconnecting, seatVacated;
  - combo, roundWinner, exchangeTag;
  - viewerPassed, autopass, errorToast, rejectHint, finished, emptyHand;
  - offline, endMatchVote;
  - whoStarts, rematch.
  - The research inventory's reconnect and reconnected banners fold into `turn`'s tones (the mockup's `renderTurn`, L496-502).
  - The two centre exchange messages (`ExchangePrompt`, "no swap") are dropped. Plan 2 replaces them with `exchangeTag` chips on the traded cards.
  - `emptyHand` is the surface the inventory missed.
- **Placeholders.** Task 1's panel padding (14/12/8) is provisional by design: Task 7, Step 1 gates it on the approved mockup, and nothing ships on it before. Task 14's diagnostics call uses plan 1's recorder by plan 1's names; that is a named dependency on plan 1, Task 1, not a gap in this plan.
- **Names.** These are used consistently across tasks:
  - `TableNotice`, `NOTICES`, `NOTICE_PAINT`, `NOTICE_GALLERY`;
  - `noticeGeometry`, `noticeMotion`, `floatHoldMs`, `pt`, `FloatSlot`, `FloatNotice`;
  - `useNetOffline`, `netNote`, `SeatMark`, `Notice` (`Beaten` is plan 4's, consumed as it defines it);
  - `mockupAt`, `appAt` (its `scores` argument is added in Task 13), `paintOf`, `expectPaint`, `stageOrigin`, `setSafeArea`;
  - plan 4's `pile-prev-shade`.
  - `TurnNotice`'s `netNote` tones (`neutral`/`ok`/`bad`) are a subset of `turn`'s declared tones.
- **Review Focus.** Each line has its test in the owning task:
  - large text: Task 6, Step 5 and the Task 7 gallery fixture;
  - replacement: Task 5, Step 1;
  - reduced motion: Task 2's gallery run under reduced motion (add `usePrefersReducedMotion` mocked true for one `describe` in `tableNotices.test.tsx`, asserting `translateY` 0 via `getAnimatedStyle`);
  - screen readers: Task 2's kept tests and Task 5's live-region test;
  - long locales: Task 2, Step 9.

## Design questions for the lead

1. **Autopass is a float, not a panel.** Design §6 lists autopass among the panels. The mockup's clock chapter ends the viewer's turn with `passYou()`, the same float as any pass (L624, L526-527), and D4's rule is "the mockup's side". I assumed the float, in the `urgent` tone, reading `game.autoPassTitle`. On a panel answer, `autopass` moves to Task 7.
2. **Bare names may not reach AA with any existing ink.** The owner chose bare names (D4 #2), and Task 10 always removes the plate. The real-lamp measurement then picks the first passing token:
   - resting names try `textMuted` → `textSecondary` → `text` → `textPrimary`;
   - the on-move name tries `goldLit` → `text` → `textPrimary`.

   My arithmetic over felt stop 0 (`#2E9F62`): `textMuted` 1.84:1, `goldLit` 2.56:1, even `#FFFFFF` 3.37:1. So if a name sits directly under the lamp's centre, no token passes. Then the task stops and asks the owner, with the per-state ratio tables the spec attaches. The lamp is plan 3's, so the numbers are measured after it lands.
3. **No 100 ms motion step exists.** The mockup's chip and float fades are 100 ms. `flash` is 90, and a 100 step fails `motionScale.test.ts`'s 1.25× rule. I used 90. The float's 1000 ms hold is not a legal `Reading` value (it must exceed 2400), so it uses `dwell` (1200); the `net` blink uses `dwell` for its period (mockup .9 s).
4. **Mark text floors to 10.** `.passo`'s 8 px and `.cchip`'s 9 px render at 10 (`TABLE_TEXT_MIN`, `cardFaceModel.ts:26`). The pixel checks map `fontSize` to 10 explicitly. Keeping the floor was my assumption; a smaller floor is a separate accessibility decision.
5. **Diagnostics are plan 1's (Task 1).** Task 14 waits for it, and sends `{ type: "notice", … }` through plan 1's recorder under plan 1's names.
6. **The gold scale departs from the mockup in four edges.** `.35`, `.45` and `.55` gold, and the `.8` dot, take `goldBorder`, `goldStrong`, `goldStrong` and `gold` (`components/CLAUDE.md:62`: add no sixth step). The pixel checks name each mapping. If the owner wants the mockup's exact alphas, the five-step rule is what changes.
7. **The power combo is `urgent` (ember), not `bombText` red.** The mockup has one `.cchip` style for every combination, including the bomb chapter. The app's power chip is red (`pile.tsx:1055`). I kept an emphasis but moved it onto the notice family's `urgent` tone, so the family has one "hot" colour. Say if the bomb should stay `bombText`.
8. **Who-starts as one notice.** I merged the 4 s gate (`chrome.tsx:49`) and the start-card line (`chrome.tsx:604`) into one panel. It holds the table with a dim for `Reading.notice` or until tapped, then stays without the dim until the first play. The one new string is its title (`gameTable.whoStartsTitle`).
9. **The 14 pt is not a notice defect.** It is the insets plus the window-fed lamp rig. The fix belongs to plan 3; Task 12 is the check. A related open point for plan 3: iPhone landscape puts the Dynamic Island on one side only, so equal 62/62 insets depend on orientation.
10. **#1266 and #1267 are both size L and open.** D4 #10 is really those tickets; Task 13 adds only the board's pixel check. Their order and scheduling are the lead's call.
11. **Collisions. Plans 2 and 4 land before this one**, and this plan builds on their final code:
    - The exchange is plan 2's (Task 9). `ExchangeLegs.tsx` renders plan 2's `ExchangeTag`, which is built on the chip tokens, and the exchange's old files are deleted. Task 4 always migrates that tag onto `TableNotice` as the `exchangeTag` kind.
    - `pile.tsx` is plan 4's `PileLayer`. Task 4 replaces `ComboChip` and `RoundWinnerTag` by name.
    - `seats.tsx`, the seat disc wrapper and the lamp are shared with plan 3, and whichever of the two lands second rebases.
12. **The research inventory missed one surface:** the empty-hand line (`hand.tsx:954-958`). It is `emptyHand` here.
13. **The beaten shade is a contract plan 4 already carries.** Task 11 checks it through plan 4's per-card `pile-prev-shade` view (`backgroundColor: Beaten.shade`), because the cards sit under the current combination and no pixel of theirs can be sampled. The same iOS limit rules out a `filter` on the group: RN 0.86.3's brightness filter is a multiply sublayer the size of the view, so it would darken the felt.
14. **The online reconnect notes are tones of the turn pill, not kinds of their own.** The mockup's `renderTurn` (L496-502) carries net, ok and bad in `#turn`. So the research's "reconnect" and "reconnected" banners are `turn`'s tones. The online screen's `banners` slot keeps only the end-match vote.
