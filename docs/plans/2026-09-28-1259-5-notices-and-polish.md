# #1259 plan 5: one notice family, and the table polished to the mockup

## Goal

Every notice on the table is painted by one component, *TableNotice*, in the mockup's vocabulary
(pill, mark, float, panel), and every #14 difference the owner kept moves to the mockup's side,
each held by a pixel check against `tests/e2e/fixtures/lantern-table/index.html`.

**What the owner sees:** the turn pill, the PASSO marks, the combination mark, the offline and
reconnect notes, the who-starts announcement and the refusals all read as one family. The
waiting seats are no longer dimmed, the last-card badge is red, the seat names sit bare on the
felt. The owner's bar for this plan: "look as close as possible to the mockup but with the right
amount of resources used and with a perfect performance."

Sources, none of them on `main`:
- the design, §6 (notices and polish), §8 (bench) and §9 (decisions):
  https://github.com/metasito/murlan/blob/claude/lantern-review-1259-efbf50/docs/plans/2026-09-28-1259-design.md
- the research inventory of notice surfaces and the #14 ranked list:
  https://github.com/metasito/murlan/blob/claude/lantern-review-1259-efbf50/docs/research/2026-09-28-lantern-review.md
- the contrarian review (§9 on exemption lists, §14 on the panel having no mockup):
  https://github.com/metasito/murlan/blob/claude/lantern-review-1259-efbf50/docs/research/2026-09-28-contrarian-review.md

Plans 1, 2 and 6 are merged (#1323, #1324, #1325). This plan is written against `main` after
them. Where it cites a symbol, find it by name; line numbers are deliberately absent.

## Decisions already made

- **D2, #11 notice family:** "build it, 160 ms entrance".
- **D3, #11 `OfflineBanner`:** it "becomes a `TableNotice`".
- **D4, #14 each difference:** "the mockup's side for nine; the PASSA button keeps today's
  garnet". The nine: #1 waiting seats dimmed, #2 the plate behind the player name, #4 the
  last-card badge, #5 the beaten combination, #6 PASSO, #7 the lit turn pill, #8 the countdown
  ring when a bot leads, #9 content off the felt's light centre, #10 the partita ending in a
  modal. #3 (PASSA) stays garnet, so no task.
- **D8, device checks:** "the owner runs the bench when asked".
- **For everything:** "Everything should be aligned to the design system, no bullshit."
- **The exchange goes through the pile** (owner's pick in plan 2's round 2; ADR-0008 decision 6,
  `docs/adr/0008-the-throw-is-the-lantern-mockups.md`). `ExchangeTag`, `ExchangePrompt` and the
  `exchange.tag` key are gone. The choice's instruction is in the turn pill (wrapped by the
  `exchange-prompt` view). The pile's label naming giver, card and receiver is a pile notice, drawn
  in the exchange fixture (`tests/e2e/fixtures/exchange-legs/index.html`) as the same `.cchip` as
  the combination mark.
- **#1264 (the owner's Hand-off B and calm pass, #1242):** another seat's PASSO slides up 6 pt and
  fades in, with no scale, particles or lamp change; the viewer's own pass shows a PASSO chip at
  (457, 300) that rises the same way, holds, and fades out. The seat on move's name is `#F3E0A6`.
- **#1265 (closed, shipped):** the turn pill sits at the top centre and turns ember in the viewer's
  last 4 s; the score pill at the top right is its own component (`components/table/scorePill.tsx`)
  with its own tests. This plan builds on both and changes neither's placement or ember values.

## Decided 2026-09-29

The owner's standing rule: "make it look and feel good, that's all I care. as close as possible
to mockup." Technical questions are the lead's under that rule, with the right amount of resources
and perfect performance. Only what a player sees goes to the owner, by eye, at a gate.

- **Q1, mark and float timing: lead, under the owner's rule.** The mockup's timing exactly: 100 ms
  in, a 1000 ms hold, 100 ms out, and the `net` dot's 0.9 s blink. They are a named moment group in
  `Motion`, as `Motion.exchange` is, not new steps of the duration scale, so `motionScale` is
  unchanged and rule 18 holds. Pills and panels keep D2's 160 ms. Every ending stays on the UI
  thread (`oneClock`).
- **Q2, autopass: owner, "Float".** It is the pass float; there is no panel.
- **Q3, mark text: owner, "Keep 10 floor".** `.passo` and `.cchip` text renders at 10
  (`TABLE_TEXT_MIN` in `components/cardFaceModel.ts`).
- **Q4, gold edges: owner, "Map to scale".** The mockup's `.35`, `.45`, `.55` edges and `.8` dot
  take `goldBorder`, `goldStrong`, `goldStrong` and `gold`.
- **Q5, the power combination: lead, under the owner's rule.** The mockup's single combination
  mark for every combination; today's power red and sheen go. The bomb's emphasis is #1263's.
- **Q6, who starts as one notice: open, settled by eye at G1.**
- **Q7, the rematch question during the last manche: owner, "Drop it".** Only the end board asks
  (#1267). Code check: today it cannot simply be removed. Offline, `app/result.tsx` offers
  "Nuova partita" only when `tableWantsRematch` (the closing manche's answers) is a majority.
  Online, `rematchRefused` in `server/game/tableHandlers.ts` refuses a rematch vote unless those
  intents said yes. That refusal is a recorded rule (`docs/GAME-RULES.md` § Decisions, "A rematch
  intent after the verdict"). Removing the question therefore changes a game rule and the server,
  so it is left to #1267, which builds the board that asks instead (see Overlaps).
- **Q8, connection notes: lead, under the owner's rule.** As the mockup's `renderTurn`: offline,
  reconnecting and reconnected are tones of the turn pill on the table; offline shows as a pill
  only off the table.
- **Q9, bare names short of AA: lead, under the owner's rule.** If no existing text token gives a
  bare name 4.5:1 over the lit felt, the name keeps the mockup's look with a soft dark text shadow
  (a named token, no plate), chosen by task 13's measurement. Not an owner question.

## Design gates

- **G1. The panel mockup** (rule 24: `/design`, else superdesign). The score board's plate
  (`#score`, `.hd`, `.rw`, `.bb` in the lantern fixture) as a notice panel at the table's centre,
  showing who starts with the start card as one notice (the owner settles Q6 here by eye). The
  approved HTML is committed as a fixture, *tests/e2e/fixtures/notice-panel/index.html*, with
  stable ids the pixel check reads. Waits: task 10. If the owner rejects every option, it stops
  and is reported.
- **G2. The notices with no mockup counterpart** (rule 24). One `/design` page showing, in the
  family's shapes and tones: the reject hint beside GIOCA, the error toast, the "waiting for the
  others" line, the empty-hand line, the online end-match vote, and the offline pill off the table
  (over a menu screen). The approved HTML is committed as a fixture,
  *tests/e2e/fixtures/notice-extras/index.html*. Waits: tasks 7, 8 (the off-table half), 9 (the
  vote).
- **G3. The notice gallery on the phone** (D8). The owner opens `app/bench.tsx` on a diagnostics
  build and leaves the phone face up. Thresholds are in task 14. Waits on task 14; nothing waits
  on it except closing D2's device claim.

## Tasks

Each task is one pull request against `main`, merged before a task that builds on it starts
(rule 45). Before pushing, run every test the task adds or edits and the ones covering the code it
changes: jest files by path (`npx jest <file> …`), each Playwright spec alone with
`npx playwright test --config tests/e2e/playwright.config.ts <spec>` (rule 3). A new test must be
seen red first (rule 6). New files are in italics.

Every task keeps these selectors on the element the old one occupied, because specs, helpers and
`.maestro` flows read them: `combo-chip`, `turn-chip-dot`, `seat-reconnect-chip`,
`seat-vacated-chip`, `exchange-prompt`, `exchange-pile-label`, `exchange-no-swap`,
`start-reason-gate`, `game-top-bar`, `game-hud-stack`, `offline-banner`, `pile-prev-layer`,
`seat-name`, `seat-card-count`, `btn-passa`, `score-pill`.

### Task 1: The notice family, and the HUD combination pill as its first caller (D2)

**Scope:** *components/table/noticeModel.ts*, *components/table/TableNotice.tsx*,
*components/table/notices/hud.tsx*, *components/table/notices/gallery.tsx*, `lib/tokens.ts`,
`eslint.selectors.cjs`, `eslint.config.js`, `components/GameTable.tsx`,
`tests/ui-rules/contrast.test.ts`, *tests/ui-rules/noticeModel.test.ts*,
*tests/ui-rules/noticePaintLint.test.ts*, *tests/native/tableNotices.test.tsx*,
`components/CLAUDE.md`, `CONTEXT.md`, `docs/FEEL-BAR.md`.

**Depends on:** nothing unmerged.

**Contract** (the types carry the rest):

```ts
type NoticeShape = "pill" | "chip" | "float" | "panel";
type NoticeTone = "neutral" | "lit" | "urgent" | "ok" | "bad";
// A kind is one NOTICES entry; NoticeKind is its keys, so a surface is added in one place.
const NOTICES = { /* kind: { shape, selector, tones } */ } as const satisfies Record<string, NoticeSpec>;
type NoticeKind = keyof typeof NOTICES;
const NOTICE_GALLERY = { /* kind: fixtures */ } satisfies { [K in NoticeKind]: NoticeFixture<K>[] };
```

**Acceptance:**
- *noticeModel.ts* is pure and node-testable. Every geometry number is the mockup's pixel, named
  by its fixture selector (`.chip`, `#turn`, `.passo`, `.cchip`, `.floatchip`, `#score`), and
  converted once, by `px / cardScale(402) * scale`. The pill's height is `CHIP_H(scale)` from
  `components/seatLayout.ts`, so the HUD bands laid out against it cannot drift.
- `Motion.duration.notice` = 160 (D2) for pill and panel, with its reduced form. The marks' and
  floats' moment group sits beside `Motion.exchange`: 100 in, 1000 hold, 100 out, a 900 blink
  (Q1). `motionScale` stays green unedited.
- The palette maps the mockup's gold edges onto the five-step scale (Q4) and has no power
  emphasis (Q5).
- *TableNotice* is the only painter: no `style` prop, Rajdhani only, one entrance (a 6 mockup-px
  rise) and one exit, no travel under reduced motion. It is the one importer of the notice
  palette's fills and edges. Its entrance runs on the UI thread and no JS callback waits on a
  motion token (`tests/ui-rules/oneClock.test.ts` stays green with no exemption).
- A file under *components/table/notices/* lays out only: an ESLint rule refuses a fill, edge,
  radius or shadow in it and refuses importing `Scrim`, `Shadow`, `Radius` or the notice palette.
  The flat config replaces a rule's options per block, so the notices block restates the base
  `no-restricted-syntax` selectors.
- The HUD's combination pill (today a `TableChip` in `GameTable`) renders through *TableNotice*
  at today's box and paint.
- Docs, same PR (rule 43): `components/CLAUDE.md` gains the design-system line (notices go
  through *TableNotice*; *components/table/notices/* lays out only); `CONTEXT.md` gains the term
  **Notice**; `docs/FEEL-BAR.md` gains the entrance rule.

**Tests:**
- New: *tests/ui-rules/noticeModel.test.ts* (the geometry equals the fixture's pixels, written as
  literals, never read back from the module; 160 for pill and panel, 100/1000/100 for mark and
  float; mark text at the floor of 10; no rise under reduced motion; every kind's tones are
  paintable by its shape).
- New: *tests/ui-rules/noticePaintLint.test.ts*. It plants a hand-built plate in the notices
  directory and requires both rule ids to fire, and requires the directory to be non-empty and its
  real files clean (the floor under the guard).
- New: *tests/native/tableNotices.test.tsx*. Every kind's gallery fixtures render exactly one
  `notice-<kind>` plate, in an edge its declared tone paints, and together cover every declared
  tone. A kind with no gallery entry fails `tsc`.
- Edited: `tests/ui-rules/contrast.test.ts`, a loop holding every shape and tone's ink and strong
  ink to body contrast on every felt stop. A failure is a palette defect, never a threshold to
  lower.
- Run: `tests/ui-rules/motionScale.test.ts`, `tests/ui-rules/oneClock.test.ts`,
  `tests/ui-rules/a11yOneNode.test.ts`, `tests/ui-rules/tokenRoles.test.ts`,
  `tests/native/tableStatus.test.tsx`, `tests/e2e/tableProportions.spec.ts`.

### Task 2: The turn pill paints through *TableNotice* (no visible change)

**Scope:** the turn chip's own module under `components/table/` (deleted; its component moves to
*components/table/notices/hud.tsx*), *components/table/noticeModel.ts*,
*components/table/notices/gallery.tsx*, `components/GameTable.tsx`, `app/tutorial.tsx`,
`tests/native/turnChipLabel.test.tsx`, `tests/native/turnTimerAnnouncement.test.tsx`,
`tests/ui-rules/contrast.test.ts`.

**Depends on:** task 1.

**Acceptance:**
- The turn pill's clock, its `A11yStatus` live region (its own node), its `a11yGroup` label, its
  `onExpire`, and the exchange sentence it speaks while `exchange-prompt` wraps it are unchanged.
- The ember state #1265 shipped (the viewer's last 4 s, gated on `lit`) renders as the pill's
  `urgent` tone with the same colours.
- The pill's box is where #1265 put it, within 1 pt, and its paint equals today's; the lit
  style's change is task 3's.
- The turn kind's gallery covers neutral, lit and urgent now; `ok` and `bad` arrive with task 8.

**Tests:** edited `tests/native/turnChipLabel.test.tsx` and
`tests/native/turnTimerAnnouncement.test.tsx` (import path); run
*tests/native/tableNotices.test.tsx*, `tests/native/tutorialTableBeats.test.tsx`,
`tests/native/scorePill.test.tsx`, `tests/e2e/tableProportions.spec.ts`,
`tests/e2e/controlRail.spec.ts`, `tests/e2e/mockupParity.spec.ts`.

### Task 3: The mockup stage, and the lit turn pill (D4 #7)

**Scope:** *tests/e2e/helpers/mockupStage.ts*, *tests/e2e/mockupPolish.spec.ts*,
`tests/e2e/helpers/mockupParity.ts`, `tests/e2e/helpers/offlineSeed.ts`, `lib/tokens.ts`,
*components/table/noticeModel.ts*.

**Depends on:** task 2.

**Acceptance:**
- One helper opens the lantern fixture paused at a chapter and time on an 874×402 stage, and the
  app at a seeded game state on the same stage, and reads a plate's box and computed paint (fill,
  edge, ink, font size, radius, glow, cumulative opacity) from both. It reuses
  `mockupParity.ts`'s fixture path and side-page setup and `offlineSeed.ts`'s seeding
  (`openCaptureState`, `resumeSaved`), exporting what it needs rather than copying it.
- The viewer's lit turn pill matches `#turn.lit`: its edge `rgba(243,224,166,.8)` and its glow, where
  today it is `goldStrong`. The glow is a static shadow, never animated.
- As built: the turn pill takes all of `#turn`'s box in every tone (padding, gap, the dot and its
  6 px glow, `#turn b`'s 12 px count), the lit count is `#turn b`'s `#F3E0A6` and the neutral
  dot `#turn .dot`'s `gold` (Q4). The ember keeps #1265's glow: the dot 9 pt, the plate 18 pt.
- Under `it-IT`, with Besnik (the longest bot name) on move, the turn pill stays inside
  `game-hud-stack`'s box.

**Tests:** new *tests/e2e/mockupPolish.spec.ts* ("turn, lit" red on `main` with the old edge, then
green; "turn fits its band"). Run `tests/e2e/mockupParity.spec.ts`,
`tests/e2e/tableProportions.spec.ts`, *tests/native/tableNotices.test.tsx*,
`tests/ui-rules/contrast.test.ts`.

### Task 4: Seat marks: PASSO as the mockup's mark (D4 #6, #1264's pass), reconnecting, vacated

**Scope:** *components/table/notices/seatMarks.tsx*, `components/table/seats.tsx`,
`components/table/chrome.tsx`, *components/table/noticeModel.ts*,
*components/table/notices/gallery.tsx*, `lib/tokens.ts`, `tests/ui-rules/contrast.test.ts`,
`lib/captureStates.ts`, `tests/native/passMarker.test.tsx`, *tests/e2e/mockupPolish.spec.ts*.

**Depends on:** task 3; plan 3, task 1 (the fixed seat bands: it reshapes `seats.tsx`,
`chrome.tsx` and the seat anchors this mark is placed against).

**Acceptance:**
- Another seat's PASSO is the mockup's `.passo`: 15 pt tall, its fill, edge (`goldBorder`) and
  ink, its text at 10; beside the top disc and under a side disc, at the mockup's offsets from the
  disc centre, within 1 pt.
- It slides up 6 pt and fades in over 100 ms, with no scale, particles or lamp change; under
  reduced motion it appears in place (#1264's end state; #1264 keeps the ember and the clocks).
- The seat's reconnecting countdown and vacated marks render through the same mark shape, keeping
  `seat-reconnect-chip` and `seat-vacated-chip`.
- `TableChip`, `ChipText` and `ChipDot` have no callers and are deleted with their styles and
  contrast rows; no other component paints a chip.
- A `passed` state in `lib/captureStates.ts` (two seats passed, the viewer on move) so `ios.yml`
  photographs the marks on iOS (rule 36).

**Tests:** new "PASSO" case in *tests/e2e/mockupPolish.spec.ts* (red on the 23 pt pill); edited
`tests/native/passMarker.test.tsx` (finds the mark by `notice-passed`, counts unchanged) and
`tests/ui-rules/contrast.test.ts`. Run `tests/native/seatReconnectClock.test.tsx`,
`tests/native/seatDimming.test.tsx`, *tests/native/tableNotices.test.tsx*,
`tests/tooling/captureStates.test.ts`, `tests/ui-rules/a11yOneNode.test.ts`,
`tests/e2e/lampSeats.spec.ts`.

### Task 5: The pile's notices: the combination mark, the round winner, the exchange label

**Scope:** *components/table/notices/pileNotices.tsx*, `components/table/pile.tsx`,
*components/table/noticeModel.ts*, *components/table/notices/gallery.tsx*,
`tests/ui-rules/contrast.test.ts`, `tests/native/comboChipEntrance.test.tsx`,
`tests/native/comboChipTiming.test.tsx`, `tests/native/roundWinnerBanner.test.tsx`,
*tests/e2e/mockupPolish.spec.ts*.

**Depends on:** task 3; plan 4, task 4 (`PileLayer`, with the combination chip and the winner tag
as their own components; this task replaces those by name).

Old task 4's `ExchangeTag` migration is void: plan 2 deleted the tag.

**Acceptance:**
- The combination mark is the mockup's `.cchip` (15 pt, its fill, `goldStrong` edge and gold ink,
  text at 10) for every combination, keeping `combo-chip`. The power styling (the red, the `✦`
  prefix, the sheen and its `onLayout` size) is deleted (Q5).
- The round winner's tag is the same mark with the literal `star` glyph.
- The exchange's pile label (`exchange-pile-label`, `exchange-no-swap`) is the same mark, still
  shown on the frame it mounts, because the exchange leg's own clock times it; its text stays on
  one line, as plan 2 fixed.
- No pile style paints a plate; the pile's contrast rows name *TableNotice*'s plate.

**Tests:** new "combination mark" case in *tests/e2e/mockupPolish.spec.ts*; edited
`tests/native/comboChipEntrance.test.tsx`, `tests/native/comboChipTiming.test.tsx` and
`tests/native/roundWinnerBanner.test.tsx` (queries by `notice-<kind>`; the sheen case becomes "a
power combination paints the same mark"; any expected duration a literal cited to Q1, never read
from `Motion`). Run
`tests/e2e/exchangeAttribution.spec.ts`, `tests/native/exchangeOnTable.test.tsx`,
`tests/native/pileFlinch.test.tsx`, `tests/e2e/pileHandoff.spec.ts`,
`tests/tooling/iconSubset.test.ts`, `tests/ui-rules/contrast.test.ts`.

### Task 6: The float slot, and the viewer's own pass (#1264)

**Scope:** *components/table/notices/floats.tsx*, `components/GameTable.tsx`,
`components/flightPhysics.ts`, *components/table/noticeModel.ts*,
*components/table/notices/gallery.tsx*, *tests/native/floatSlot.test.tsx*,
*tests/e2e/mockupPolish.spec.ts*.

**Depends on:** task 3.

**Acceptance:**
- When the viewer passes, a PASSO float appears at the mockup's `.floatchip` box (centred at
  457, 300), rises and fades in over 100 ms, holds 1000 ms and fades out over 100 ms. `GameTable` derives it from the state it
  already reads (`passedSeats`), so both game screens get it with no new screen state.
- The slot holds one float. A new float replaces the one standing and restarts its life; there is
  never a stacked or half-faded leftover.
- The slot's `A11yStatus` stays mounted whether or not a float is up, so a float that arrives is
  announced once and never becomes a landing stop.
- A float's life ends on the UI thread; no JS callback waits on a motion-derived hold
  (`oneClock` green with no exemption). A float that has ended runs no animation.

**Tests:** new *tests/native/floatSlot.test.tsx* (a second float replaces the first; the live
region is the same node before and after); new "float" case in
*tests/e2e/mockupPolish.spec.ts*. Run `tests/ui-rules/oneClock.test.ts`,
`tests/ui-rules/flightPhysics.test.ts`, *tests/native/tableNotices.test.tsx*,
`tests/native/passAndPlayHandoff.test.tsx`.

### Task 7: Refusals and table lines: reject hint, error toast, "waiting for the others", empty hand

**Scope:** *components/table/notices/tableLines.tsx*, *components/table/notices/floats.tsx*,
`components/GameTable.tsx`, `components/table/hand.tsx`, `app/(online)/game.tsx`,
*components/table/noticeModel.ts*, *components/table/notices/gallery.tsx*,
`tests/ui-rules/contrast.test.ts`, *tests/e2e/mockupPolish.spec.ts*, *tests/e2e/fixtures/notice-extras/index.html*.

**Depends on:** task 6; G2.

**Acceptance:**
- The reject hint and the online error toast are floats in the slot, held for `Reading.hint` and
  `Reading.toast`, looking as G2 approved. The reject hint keeps its anchor beside GIOCA.
- The "waiting for the others" line and the empty-hand line render through *TableNotice*, as G2
  approved, with their strings through `t()` unchanged.
- The online screen's own toast styles are deleted; its new hook sits above `if (!gameState)`.
- `finishedText`, `rejectHintText` and `emptyHandText` leave `contrast.test.ts`'s self-plated
  rows.

**Tests:** new cases in *tests/e2e/mockupPolish.spec.ts* against the G2 fixture; edited
`tests/ui-rules/contrast.test.ts`. Run `tests/native/playRejection.test.tsx`,
`tests/native/seatFinishTrophy.test.tsx`, *tests/native/floatSlot.test.tsx*,
`tests/native/connectingState.test.tsx`, `tests/native/rejoinFailedExit.test.tsx`,
*tests/native/tableNotices.test.tsx*.

### Task 8: Connection notes in the turn pill, and `OfflineBanner` as a notice (D3)

**Scope:** `components/OfflineBanner.tsx`, *components/table/notices/hud.tsx*,
`components/GameTable.tsx`, `app/(online)/game.tsx`, *components/table/noticeModel.ts*,
*components/table/notices/gallery.tsx*, *tests/native/tableNotices.test.tsx*,
`tests/native/offlineBannerLargeText.test.tsx`, `tests/e2e/offlineBannerFit.spec.ts`,
*tests/e2e/mockupPolish.spec.ts*.

**Depends on:** task 3; G2 for the off-table pill.

**Acceptance:**
- On the table, the turn pill carries the connection: offline is `#turn.bad`, reconnecting is the
  blinking dot, reconnected is `.ok` for the time the notice lasts today. The online screen's
  reconnect banners and their styles are gone.
- Off the table, `OfflineBanner` renders the offline pill as G2 approved, at `Layer.alert`,
  announced as today. It still flags offline only on `isConnected === false`, moved verbatim
  (`components/CLAUDE.md`).
- The blinking dot blinks over 0.9 s, holds still under reduced motion, and runs no animation
  while the note is not shown.
- At a 3.1 font scale the pill's text is capped at `TABLE_FONT_SCALE_MAX` and truncates on one
  line; the pill stays within the viewport and above the first focusable control, at 375×812 and
  874×402.

**Tests:** new "offline" case in *tests/e2e/mockupPolish.spec.ts* (against `#turn.bad`); edited
`tests/native/offlineBannerLargeText.test.tsx`, `tests/e2e/offlineBannerFit.spec.ts`, and the
turn kind's `ok` and `bad` fixtures in *tests/native/tableNotices.test.tsx*. Run
`tests/native/socketReconnect.test.tsx`, `tests/native/onlineStatusRow.test.tsx`,
`tests/native/connectingState.test.tsx`, `tests/native/rejoinFailedExit.test.tsx`,
`tests/ui-rules/orientation.test.ts`.

### Task 9: Autopass and the end-match vote

**Scope:** *components/table/notices/netNotes.tsx*, `app/game.tsx`, `app/(online)/game.tsx`,
`context/OnlineGameContext.tsx`, `context/onlineGameHooks.ts`, `CONTEXT.md`,
*components/table/noticeModel.ts*, *components/table/notices/gallery.tsx*,
`tests/native/offlineAutoPass.test.tsx`, `tests/ui-rules/contextSlices.test.ts`,
`tests/native/endMatchVoteBanner.test.tsx`.

**Depends on:** task 6 (the float slot); task 8 (it empties the online banner slot); G2 for the
vote.

**Acceptance:**
- An autopass, offline and online, shows the pass float (Q2) reading `game.autoPassTitle`, in
  place of today's `showNotification`; the haptic and the pass it commits are unchanged. The online context exposes it through one slice, and `CONTEXT.md`'s
  field count follows (rule 43).
- An autopass and the viewer's own pass float never both show for one pass: the autopass takes
  the slot.
- The online end-match vote is one pressable notice with one accessible name and its hint node,
  as G2 approved.
- Every new hook in both screens sits above `if (!gameState)`.

**Tests:** edited `tests/native/offlineAutoPass.test.tsx` (the notice's label, not the banner),
`tests/ui-rules/contextSlices.test.ts` (the field is in exactly one slice),
`tests/native/endMatchVoteBanner.test.tsx`. Run `tests/native/connectingState.test.tsx`,
`tests/native/rejoinFailedExit.test.tsx`, `tests/native/sliceRenderCounts.test.tsx`,
`tests/ui-rules/a11yOneNode.test.ts`.

### Task 10: The panel, and who starts as one notice

**Scope:** *components/table/TableNotice.tsx*, *components/table/notices/panels.tsx*,
*components/table/noticeModel.ts*, *components/table/notices/gallery.tsx*,
`components/table/chrome.tsx`, `components/GameTable.tsx`, `tests/ui-rules/contrast.test.ts`,
`tests/native/startAnnouncement.test.tsx`, `locales/en.ts`, `locales/it.ts`, `locales/sq.ts`,
*tests/e2e/fixtures/notice-panel/index.html*, *tests/e2e/mockupPolish.spec.ts*.

**Depends on:** task 1; G1 (and Q6 through it).

**Acceptance:**
- The panel shape takes G1's numbers (padding, gap, title, rule, button row) and the score
  pill's plate tokens; only *TableNotice* paints it, including the gate's dimming layer at
  `Layer.hint`.
- Who starts is one panel while the gate holds and until the first play: one timer, one live
  region, one `start-reason-gate` press to release. `StartReasonBanner`, `StartCardBanner` and
  their styles and contrast rows are gone. New copy, if G1's mockup has a title, is keyed in
  `en`, `it` and `sq` (rule 19).
- At 1.2× font scale the panel's body wraps and never clips.

**Tests:** new "panel" case in *tests/e2e/mockupPolish.spec.ts* against the G1 fixture; edited
`tests/native/startAnnouncement.test.tsx` (exactly one `notice-whoStarts` plate while the gate
holds and the start card is due) and `tests/ui-rules/contrast.test.ts`. Run
`tests/native/startCardHook.test.tsx`, `tests/e2e/startAnnouncement.spec.ts`,
`tests/ui-rules/blockingOverlays.test.ts`, `tests/bots/botSearchTimeout.test.ts`,
*tests/native/tableNotices.test.tsx*.

### Task 12: Seats: no waiting dim (D4 #1), a red last-card badge (D4 #4)

**Scope:** `components/table/seats.tsx`, `components/table/chrome.tsx` (the hand-lift comment
that names the dimming), `lib/tokens.ts`, `eslint.selectors.cjs`, `lib/captureStates.ts` (the
doc comment that names the dimming), `tests/ui-rules/contrast.test.ts`,
`tests/native/seatDimming.test.tsx`, `tests/native/seatLowCount.test.tsx`,
*tests/e2e/mockupPolish.spec.ts*.

**Depends on:** task 3; plan 3, task 1 (as task 4).

**Acceptance:**
- A waiting seat is not dimmed (cumulative opacity 1); a reconnecting seat keeps its dim.
- The last-card badge is `.badge.last`: fill `#9e1f26`, edge `#ffb3a0`, white ink, a red glow,
  from one new token group (added to `TOKEN_OBJECTS`), static. The white ink clears body contrast
  on it.

**Tests:** new "seats are not dimmed" and "last card" cases in *tests/e2e/mockupPolish.spec.ts*;
edited `tests/native/seatDimming.test.tsx` (inverted: a waiting seat has no opacity below 1, a
reconnecting one still has the dim, found by value), `tests/native/seatLowCount.test.tsx`,
`tests/ui-rules/contrast.test.ts`. Run `tests/native/seatFinishTrophy.test.tsx`,
`tests/e2e/lampSeats.spec.ts`, `tests/ui-rules/tokenRoles.test.ts`.

### Task 13: Bare seat names (D4 #2), and no table text as its own plate

**Scope:** `components/table/seats.tsx`, `tests/ui-rules/contrast.test.ts`,
*tests/e2e/seatNameContrast.spec.ts*.

**Depends on:** task 12 (same file); task 7 (it removes the other self-plated rows); plan 3, task
8 (the light at the owner's size: the backdrop the names are measured on).

**Acceptance:**
- The seat name has no plate. Its ink is the first existing text token that clears 4.5:1 over the
  brightest felt pixel behind every name in every capture state, the mockup's own ink first; the
  on-move name starts from `goldLit` (#1264's `#F3E0A6`). If none passes, the name keeps the
  mockup's ink with a soft dark text shadow, one named token, set by the same measurement to clear
  4.5:1 (Q9); the plate never comes back.
- `contrast.test.ts` no longer guesses the name's backdrop (the spec measures it) and refuses any
  self-plated entry, counted, with no exception list; its `SELF` branch is deleted once empty.

**Tests:** new *tests/e2e/seatNameContrast.spec.ts* (hides only the text, samples the real felt
behind it, attaches every candidate ink's ratio per state, with and without the shadow, so one
CI run decides the ink); edited
`tests/ui-rules/contrast.test.ts` (the ban, red today on four self-plated rows).

### Task 14: The notice gallery on the bench (D8, then G3)

**Scope:** *components/table/TableNotice.tsx*, `lib/diagnostics/types.ts`,
*lib/diagnostics/scenarios/noticeGallery.ts*, `lib/diagnostics/scenarios/index.ts`,
`scripts/diagnostics-verdict.mjs`, `tests/tooling/diagnosticsVerdict.test.ts`.

**Depends on:** task 1, and whichever of tasks 2–10 have landed (the gallery is what it mounts;
run G3 once the family is complete).

**Acceptance:**
- In diagnostics builds only (`DIAGNOSTICS`, which Metro inlines, so production carries none of
  it), *TableNotice* records a `notice` row per entrance and exit, `{ kind, shape, phase, ms }`,
  timed in UI frames, through `diag`.
- A `noticeGallery` bench scenario mounts every gallery fixture, five times each, while
  `driveBots` plays a scripted trick through the real flight, then once more with reduced motion.
- Its verdict lives in `GATES` with a verdict test: p90 entrance within one frame of the shape's
  time (160 pill and panel, 100 mark and float); zero blocking stalls (`burstStalls`) in the
  window; the `net` dot's period 900 within one frame, and a constant 1 under reduced motion. The
  thresholds are literals cited to D2 and Q1, not read from `Motion`.

**Tests:** edited `tests/tooling/diagnosticsVerdict.test.ts` (a planted slow entrance and a planted
stall each fail the gate). Run `tests/tooling/diagnosticsGate.test.ts`,
`tests/tooling/diagnosticsPlugin.test.ts`, `tests/ui-rules/oneClock.test.ts`.

### Dropped

- **Old task 4's exchange name tag:** void; plan 2 deleted `ExchangeTag` (ADR-0008 decision 6).
  The pile's exchange label is kept, in task 5.
- **Old task 9 (PASSA):** the owner keeps garnet (D4). `contrast.test.ts` already holds its label.
- **Old task 11 (the beaten combination, D4 #5):** plan 4, task 5 builds the pose and its
  spec. Handed to it: the shade equals the mockup's `.grp.prev` `brightness(.6)` (black at 0.4 per
  card, never a group `filter`, which on iOS darkens the felt), the layer's opacity is 1, and the
  fixture's own filter value is read so a changed mockup is noticed.
- **Old task 12 (content off the light's centre, D4 #9):** plan 3, task 6 (aim at the laid-out
  seats) owns the fix. Handed to it: under 62/21/62 insets the felt's
  light centroid sits within 2 pt of the pile centre.
- **Old task 13 (the partita board, D4 #10):** #1267 (open) owns it; its own parity registers
  "the board box and the dim" against `BOARD`. Nothing here.
- **D4 #8 (the countdown ring on a bot-led round):** plan 3, task 4.
- **Old G4 (an owner gate on the seat-name measurement):** void; Q9 is decided, task 13 applies it.
- **The power combination's emphasis:** void under Q5; task 5 deletes it.
- **Task 11 (the rematch question on the panel):** void under Q7; its removal is #1267's.

## Overlaps with #1260–#1267

- **Tasks 4 and 6 vs #1264 (PASSO and the viewer's pass):** build the end state here. #1264
  specifies exactly the mark and float this plan paints (6 pt rise, fade, hold, the float at
  457, 300); built twice, one copy would bypass the family. #1264 keeps the ember, the clocks'
  cross-fade and the parity; the lead amends #1264's pass bullet to point here. The timing is
  #1264's and the mockup's (Q1).
- **Task 13 vs #1264 (the on-move name `#F3E0A6`):** no conflict; the colour stays, and a text
  shadow is added only if the measurement needs one (Q9).
- **Tasks 2, 3 and 8 vs #1265 (closed: the turn pill at the top centre, its ember, the score
  pill):** no conflict. The pill is migrated in place with #1265's position and ember; the score
  pill stays its own component and is not a notice.
- **Task 10 vs #1265:** no conflict; the panel reuses the score pill's plate tokens rather than
  copying them.
- **The rematch question vs #1267: leave to the ticket.** The owner dropped the question (Q7), but
  today's partita ending offers a rematch only through it: `app/result.tsx` shows "Nuova partita"
  only on a majority of its answers, and `rematchRefused` in `server/game/tableHandlers.ts` refuses
  the online vote otherwise, a rule recorded in `docs/GAME-RULES.md` § Decisions. Removing
  `components/table/rematchPrompt.tsx` alone would leave no rematch at all, so #1267 removes it
  together with the rule change and the board that asks instead. The lead adds this to #1267.
- **Old task 13 vs #1267 (the board):** leave to the ticket (dropped above).
- **Task 7 vs #1266 (the manche ends on the table):** no conflict. "Waiting for the others" is
  shown while the viewer is out and the manche goes on, before #1266's ending starts. If #1266
  shows its own line there, it uses the family.
- **Tasks 1–14 vs #1260, #1261, #1262, #1263:** no conflict; cards, motes, the deal and the bomb
  paint no notice. Task 5 drops the power combination's own emphasis (Q5); the bomb's emphasis
  is #1263's.

## Risks

- **Every hook runs before `if (!gameState)`** (CLAUDE.md): tasks 7, 8 and 9 add state to
  `app/game.tsx` and the online screen; each hook goes above the guard.
- **One module chooses a bot's move, and rules change only via `docs/GAME-RULES.md`:** task 9
  reads the autopass the timer already commits; no task touches `lib/game/autoMove.ts` or the
  engine.
- **No self-defeating safeguards:** the paint lint has a planted file and a non-empty floor; the
  gallery is keyed `satisfies Record<NoticeKind, …>`; the self-plate ban counts entries and has no
  exception list; `oneClock` is never given an exemption for a float.
- **No unit test can see a layout bug:** every position and size claim is a Playwright case in
  *tests/e2e/mockupPolish.spec.ts* or its siblings; the native harness asserts only which plate
  paints, in which tone.
- **`components/CLAUDE.md`:** one clock (a notice's end never waits in JS on a motion token, tasks
  1, 6); `Layer` roles (the gate `Layer.hint`, the offline notice `Layer.alert`, tasks 8, 10);
  literal icon names (a glyph is a literal at the call site, never read from `NOTICES`, or
  `scripts/iconSubsetChars.mjs` ships a blank box); one accessible node and a live region its own
  node (tasks 2, 6, 9, 10); `OfflineBanner`'s `isConnected === false` (task 8, moved verbatim); the
  five-step gold scale and tokens by role (Q4's mapping; the badge's red and the name's shadow are
  named tokens).
- **Rule 18 and `motionScale`:** the 100/1000/100/900 timings are a named moment group beside
  `Motion.exchange`, never bare numbers and never new duration steps (Q1).
- **Performance (the owner's bar):** a notice's glow is a static shadow; the dot's loop runs only
  while shown; a hidden or ended notice runs no animation. G3 measures stalls on the phone.
- **Collisions:** `GameTable.tsx`, `seats.tsx`, `chrome.tsx`, `pile.tsx`, `lib/tokens.ts` and
  `lib/diagnostics/` are shared with plans 3 and 4; read the landed diff before touching one
  (rule 41).
