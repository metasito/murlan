# 08 — Table UI: target design

Area: `components/GameTable.tsx` and the components under `components/` that render the table.
All `path:line` references are at MAIN `a1d0ebb5` unless marked otherwise.

## 1. Summary

- **Now:** GameTable is still the place where every table concern is *decided*. Pure arithmetic and pure presentation run inline in render or inside memo components: hand-row geometry inside `StraightHand`, table anchors rebuilt per caller from a 12-field bag, turn and veil ladders in the JSX, three countdown clocks. Only a renderer or Playwright can reach them.
- **After:** four pure models, each built once per render and passed whole. `layoutHandRow` (the hand), `tableLayout` (frame, anchors, pill, banner band), `turnPresentation` with `tableVeils` (what the chip, the clock and the veils say), and `countdown` (one window clock). Two small ownership fixes sit beside them: the round-ending landing is latched where the throw is known, and the lamp level is a set of owned holds. Two thin seams, `lib/motion.ts` and `lib/platform.ts`, own the vendor and platform quirks.
- **Why:** each group of findings is one missing module. Once the arithmetic or decision has a pure home, the copies (three hand loops, four anchors computations, three turn ladders, three countdowns, two ending gates) collapse into it. The source scans that stood in for a module boundary (`flightHooks`, `cardMemoComparators`, `gameTableVeil`, `infiniteAnimations`) get replaced by node tests of the real function.
- #1603 already did this for the exchange (`useTableExchange`, `exchangeModel.exchangeNotes`), and #1604 started it for the hand (`TableFacts`, `HandRow`). This design applies the same move to the rest of the table.
- 9 tickets: 3 L, 3 M, 3 S. Two of them (T1 and T9) can start before #1624 lands.

## 2. Current shape (evidence at MAIN)

**Hand row (L-089, L-101, L-093).**
- `components/table/hand.tsx` is still 1497 lines. `StraightHand` (`:641-1443`) computes card size per turn (`:755-761`), crop, the arc solve (`:905-909`), tilt overhang (`:931-933`), `topClearance` (`:938`), `heldCeiling` (`:943`), slots (`:1046`), and per-card home, shift, strip and origin.
- It does that in three loops over `rest`: `strips` (`:1006-1027`), the `onOrigins` effect (`:1076-1098`) and the render map (`:1310-1372`). `y0` at `:1086` repeats `restY` at `:1331` (`rowBase + crop + home.y - cardH/2`).
- The real hit test is the worklet `cardUnder` (`:1032-1044`). `components/handLayout.ts:84` `cardAtX` is called only by `tests/ui-rules/handLayout.test.ts` and `tests/e2e/handTapStrips.spec.ts`.
- `tests/ui-rules/handTurnScale.test.ts:48-66` re-derives the card width and room.
- `CardItem` has 30 props (`:176-244`). `dealDelay` is a boolean in disguise: the only caller passes `descending ? 0 : -1` (`:1356`), and `withDelay(dealDelayRef.current…)` (`:333`) always waits 0. `DEAL_DURATION_MS = 500` is a component literal (`:97`).
- The 29-line comparator `cardItemPropsEqual` (`:569-601`) and `cardViewPropsEqual` (`components/CardView.tsx:651-674`) are kept complete by `tests/native/cardMemoComparators.test.tsx`, which regexes the interface text.

**Table geometry (L-091, L-099, L-116, L-112).**
- GameTable builds `seatGeometry` (12 fields: frame fields plus `players`/`opponents`/`viewerSeat`) at `GameTable.tsx:626-639`. It spreads it into `usePileFlight` (`:781`) and passes it whole to `useDeal` (`:644`), `ExchangeLegs` (`:1375`) and `floatTop` (`:1209`).
- `usePileFlight` destructures all 12 (`pile.tsx:619-646`), rebuilds the object inside its effect (`:715-728`) and lists them in a 25-entry dependency array (`:799-825`). `ThrownPlayInput`'s doc (`flightPhysics.ts:494-499`) says the spread exists to satisfy `exhaustive-deps`.
- `anchorPoints(tableGeometry(…))` runs in GameTable (`:824`), in `readThrownPlay` (`flightPhysics.ts:517`), and in every `seatPoint` call (`:544-546`), which covers the deal per side, the sweep and both exchange leg ends.
- `readThrownPlay:522-528` and `exchangeModel.ts:107-112` repeat the "own hand slot, else `HAND_SCALE/FIELD_SCALE` at the seat" expression.
- `flightPhysics.ts` (546 lines after #1603) still mixes impact tiers, shake and flare (`:22-257`), anchors (`:259-326`), keys and passes (`:328-411`), hand arrival (`:413-468`) and thrown plays (`:470-546`). `tests/ui-rules/flightHooks.test.ts:11-16` pins "one owner" with a regex over import lines.
- The chips' bottom edge is computed twice:
  - `GameTable.tsx:1289` uses `frame.tableTop + CHIP_H(scale) + frame.pad`.
  - `tableFrame.ts:212-215` `notificationTopOffset` rebuilds `max(PAD_TOP*s, topPad) + surplus + CHIP_H + PAD_INNER*s`, which `NotificationBanner.tsx:96-103` feeds from `surplusHeight(…)/2`.
- `computeScreenPads` (`tableFrame.ts:69-76`) is an identity map.
- The pill anchor (`GameTable.tsx:577-583`) and the vote tops (`:1181`, `:1197`) are inline geometry.

**Presentation decided in render (L-094, L-102, L-112, L-113, L-108).**
- The turn chip's `chipText` and `spokenSeat` are two parallel five-way ternaries (`GameTable.tsx:1126-1145`). `tableA11y.ts:78-90` is a third ladder.
- `turnTimerActive` is called twice with three inputs changed (`:962-972`, `:1011-1027`). The two `resetKey`s are concatenated separately (`:1026`, `:1149`).
- Veils: five booleans (`:423-439`). `tests/ui-rules/gameTableVeil.test.ts:85-127` finds the game layer's children by six- and eight-space indentation.
- Float: `nextFloat` is pure since #1602 (`floatModel.ts`). GameTable still diffs `floatSeen` during render (`:546-567`).
- The match board (`:594-611`) is inline.
- `getComboLabel` sits in `pile.tsx:567-576` over a `Record<string, TranslationKey>` (`:349-356`).
- `placementPoints = {}` and `disconnectedSeats = {}` defaults are fresh objects every render (`:343`, `:357`). `readExchange` returns a new object while active (`exchangeModel.ts:44-51`), and that object sits in the `tableA11yLabel` deps (`:719`).
- The OS orientation lock (`:20`, `:147`, `:195-198`, `:882-915`) is device code inside the table.

**Ending, lamp, clocks (L-096, L-097, L-100).**
- `useRoundEnding.ts:30-31,87-104` and `useRoundOutcome.ts:7-11,24-27` each re-derive "ended, nothing in flight, `pending()` false". Each carries a prose "call after `usePileFlight`" contract. They are called four times (`GameTable.tsx:790-811`).
- Lamp level writers:
  - The dim effect releases only if `lvlT === RoundMoment.lostLevel` (`useLampRig.ts:84-92`).
  - The breath cleanup releases only if `lvlT === BREATH_FROM` (`:104-109`).
  - `useLinkHold.ts:64-69` calls `setLevel(1)` unconditionally. So a link drop and recovery inside a lost-round dim ends the dim early.
- Countdowns:
  - `TurnChip`: a 1 s interval from a whole-second `timeLeft` (`notices/hud.tsx:92-135`).
  - `ReconnectingMark`: a third interval with no hold (`notices/seatMarks.tsx:32-53`).
  - `SeatRing`: `withTiming` over `Date.now` accumulation (`seats.tsx:278-319`).
  - After a hold, the chip restarts from whole seconds while the ring resumes from fractional ms.

**Leaf modules.**
- **L-098:** CardView's lift, press and `onPress` serve only `app/tutorial.tsx:678-680,752-754`. Everyone else passes `noLift`.
- **L-107:** `cardFaceModel.ts:139` and `CardView.tsx:707` both hold `-0.5`. `rankTextJoker` pins `FontSize.xs` and `lineHeight: 12` (`:711-714`).
- **L-104:** `useCardRects.ts:102` reads `__closure`. It has five callers: `deal.tsx:135`, `ExchangeLegs.tsx:130`, `hand.tsx:466,1064` and `pile.tsx:289`.
- **L-105:** `noticeModel.ts:207-215` gives chip and float shapes `Motion.mark` whatever `reduceMotion` is, and `hold: 1000` (`tokens.ts:581`) is a reading time.
- **L-106:**
  - `moments.tsx:363-368`: `Sweep.durationMs` has a single caller (`GameTable.tsx:1086`), which omits it.
  - `hand.tsx:97` and `chrome.tsx:219` hold 500 ms literals.
- **L-103:** `actions.tsx:89-110` and `:231-247` duplicate the press block. The garnet stops are restated at `actions.tsx:49` and `settingsSheet.tsx:169`.
- **L-110:**
  - The web clip quirk is cast two ways: `GameTable.tsx:161-162` and `hand.tsx:1432`.
  - The iOS grey quirk is split across `greyLayer.tsx:8-14`, `useLinkHold.ts:15-17` and `feltCanvas.tsx:50`.
  - The haptics gate is repeated at `settingsSheet.tsx:304` and `SettingsModal.tsx:266`.
- **L-117:** six hand-spelled rows at `SettingsModal.tsx:234-336`.
- **L-114:** 56 `cancelAnimation(` calls, 11 of them the exact `useEffect(() => () => cancelAnimation(x), [x])` shape, plus 7 in one block at `hand.tsx:389-400`.
- **L-120:** `infiniteAnimations.test.ts:63-66` is a presence scan. `reducedMotion.test.ts:119-139` is a proximity scan. `withDelayReduceMotion` and `answeredMotionOptsOut` are sound AST tests.
- **L-115:** `particleLayer.web.tsx:101-131` redraws every rAF tick with no idle path. Native returns early at `particleLayer.tsx:94-95`.
- **L-109:** `BenchScreen.tsx:68-108` resets its latch only on success.

**Already done at MAIN (L-090).** #1603 moved the exchange view into `components/table/useTableExchange.ts` and `exchangeModel.ts`:
- `exchangeNotes` returns the chip and pile note.
- `readExchangeSeats`, the seq bump and the stage reports all live in the hook.
- `tests/ui-rules/exchangeModel.test.ts` tests `exchangeNotes`.
- GameTable now only destructures (`GameTable.tsx:480-502`).

## 3. Alternatives considered

### 3a. Table geometry (the central shared value)

| | A. `TableLayout` value, memoised, passed explicitly; `Seating` separate | B. `TableLayoutContext` read by deep consumers | C. A plus absolute boxes: sections rendered at `layout.boxes` instead of flexbox |
|---|---|---|---|
| Depth | One builder hides frame, anchors, pill, float and banner arithmetic | Same builder; hides the plumbing too | Deepest: the model *is* the layout |
| Locality | Every consumer names its input; a hook's deps list it | Implicit; hooks inside GameTable (`usePileFlight`, `useDeal`) are *above* any provider GameTable renders, so they still need it passed | One place for layout |
| Seam | In-process, one adapter (GameTable) plus `NotificationBanner` building its own: two adapters, a real seam | Hypothetical; `NotificationBanner` is outside the table tree and cannot read it | — |
| Migration risk | Low: pure, pinned by node tests before the move | Low, but hides the dependency the exhaustive-deps workaround exists for | High: every section's flex placement changes, and only e2e can see it (verify: "speculative, needs e2e proof") |

**Pick A.** It deletes the 12-field bag and the dependency workaround, and computes anchors once. B adds a context that the main consumers cannot use. C is the right end-state only if model/flex disagreement recurs, and the current e2e witnesses (`flightOrigin.spec.ts`, `lampSeats.spec.ts`) already catch that class. Owner decision 4 records the rejection.

### 3b. Hand row

| | A. Pure `layoutHandRow(input): HandRowLayout` plus worklet `cardUnder(strips, …)` in `handLayout.ts` | B. A `useHandRowLayout` hook returning layout plus shared values | C. Split `StraightHand` into `HandGestures`/`HandCards` components, arithmetic stays inline |
|---|---|---|---|
| Testability | Node tests reach every number; `handTurnScale` imports it | Needs a renderer | Needs a renderer |
| Interface | One input object, one output object; CardItem takes a `place` | Leaks Reanimated into the model | Fewer lines per file, same coupling |
| Three loops | One computation; strips, origins and render read `layout.cards[i]` | Same | Unchanged |

**Pick A.** B and C fail the deletion test, because the arithmetic would still be duplicated or unreachable. The invariant "`handLayout.ts` takes a width parameter instead of importing `CARD_W`" (`components/CLAUDE.md`) is kept: the caller passes card dimensions in.

### 3c. Table presentation

| | A. One `tableViewModel(state, …)` returning everything GameTable shows | B. Focused pure functions per concern (`turnPresentation`, `tableVeils`, `matchBoardFor`, `comboLabel`) |
|---|---|---|
| Depth | Deep interface, but a god function in a new file | Each small and complete; each has a test table |
| Locality | Any change touches the one function and its giant input | A veil change touches `tableVeils.ts` only |
| Migration | One large PR | One ticket, but each function lands with its own pinned tests |

**Pick B.** A would move the god component into a god function; the concerns do not share state. Inside B, the turn decision is made deep: one `turnState()` feeds the chip text, the spoken sentence and `tableA11y` through three exhaustive `Record<TurnState, TranslationKey>` maps, so a branch cannot be added to one ladder only.

### 3d. Ending gate (L-096)

- **A. `tableTimeline.landedSince(at)`.** The read still happens at effect time in each consumer, so the ordering contract survives.
- **B. One `useRoundLanding(roundOver, timeline)` hook.** It is a single gate, but it is still a call-order contract between modules.
- **C. `usePileFlight` returns `ending: { landedAt } | null`.** This is the only module that knows, inside the effect where it takes the throw, whether this commit threw. The consumers take a plain value.

**Pick C.** The contract becomes a return value.

## 4. Target design

### 4.1 `components/tableLayout.ts` (new; replaces `flightPhysics.ts` § Seat anchors and `SeatGeometry`)

```ts
// Pure, JSX-free, relative runtime imports (docs/agents/checks.md "Node's TypeScript loader").
export interface Point { x: number; y: number }
export interface Delta { dx: number; dy: number }

export interface TableLayout {
  scale: number;
  window: { width: number; height: number };
  frame: TableFrame;                       // computeTableFrame, unchanged
  handCardH: number;                       // CARD_H(scale * HAND_SCALE)
  handZoneH: number;                       // HAND_ZONE_H(handCardH, frame.bottomPad)
  anchors: Record<FlyDirection | "pile", Point>;   // computed once
  seatPoint(dir: FlyDirection): Delta;     // anchors[dir] - anchors.pile
  floatTop: number;
  /** Bottom edge of the chip row: the banner band's top, and the notification banner's in landscape. */
  chipsBottom: number;
  /** The table overlay's box, read by GameTable's `game-table` style. */
  tableBox: { left: number; top: number; right: number; bottom: number };
  pill: PillAnchor;                        // scorePillModel.pillAnchorFor(frame, width, scale)
}
export function tableLayout(i: { width: number; height: number; insets: EdgeInsets; scale: number }): TableLayout;

export interface Seating {
  viewerSeat: number;
  players: readonly Player[];
  opponents: OpponentArrangement<Player>;
}
/** A hand card's starting pose from the pile: its drawn slot if the hand reported one, else the seat's point at hand scale. */
export function ownSlotFrom(origin: Delta, own: CardFrom | undefined): CardFrom;
```

`scorePillModel.ts` gains:

```ts
export function pillAnchorFor(frame: TableFrame, windowWidth: number, scale: number): PillAnchor;
export function voteTop(anchor: PillAnchor, open: boolean, scale: number): number;
```

`tableFrame.ts`:

```ts
export function bannerTop(layout: Pick<TableLayout, "chipsBottom"> | null, topInset: number): number;
// replaces notificationTopOffset; null when not landscape
```

**Callers**
- GameTable builds `layout` and `seating` once each with `useMemo`. Deps: `W`, `H`, `insets.top/bottom/left/right`, `scale`; and `viewerSeat`, `players`, `opponents`.
- The new signatures:
  - `usePileFlight({ …state, layout, seating, … })`: the effect deps drop from 25 to about 15.
  - `readThrownPlay(play, layout, seating, handOrigins)`
  - `readExchangeLegs(announced, layout, seating, handOrigins)`
  - `useDeal({ layout, seating, … })`
  - `dealSlots(…, layout, seating)`
  - `ExchangeLegs layout={…} seating={…}`
- `NotificationBanner` builds `tableLayout(...)` itself: it has width, height, insets and scale, and sits outside the table tree.

**Deleted:** `TableGeometry`, `SeatPlace`, `SeatGeometry`, `ThrownPlayInput`'s frame fields, `tableGeometry()`, `anchorPoints()`, `floatTop()`, `flightOrigin()`, `notificationTopOffset`, `computeScreenPads`, and GameTable's `seatGeometry`, `pillAnchor` and inline vote tops.

**`flightPhysics.ts` is dissolved:**
- `components/impact.ts`: tiers, trauma, flinch, shake, flare, `landWobble`, `LAND_WOBBLE_MS`, `FAN_CARD_SCALE`.
- `components/tableLayout.ts`: the anchors, as above.
- `components/passes.ts`: `comboKey`, `turnKey`, `trickClosedWithWinner`, `passedSeats`, `seatsJustPassed`.
- `components/table/exchangeModel.ts`: `airborne`, `arrivingCard`, `readHandArrival`.
- `components/table/throws.ts`: `readThrownPlay`.

**Invariants**
- `layout.anchors` is the only anchors computation in a render. A node test asserts that `readThrownPlay` and `readExchangeLegs` produce no point that is not `layout.seatPoint(dir)` or `ownSlotFrom(...)`.
- `chipsBottom === frame.tableTop + CHIP_H(scale) + frame.pad`. Before T2, `notificationTopOffset` must equal this for every viewport and inset the old inputs allow; that equality is pinned first.
- `tableBox.bottom === frame.surplus`, a node test. The source scan at `tableProportions.test.ts:111-114` changes to assert that GameTable spreads `layout.tableBox`, so the scan anchors on a named value.

**Error modes:** none. Pure, total functions. A `players` array shorter than `viewerSeat` behaves as today (`seatDirection`).

### 4.2 `components/handLayout.ts` (extended)

```ts
export const SELECT_TILT = -3;   // moved from hand.tsx
export const HELD_SCALE = 1.06;

export interface HandRowInput {
  ids: readonly string[];             // the cards the row draws, in drawn order
  heldId: string | null;              // a dragged card; laid out by the finger, not the arc
  arrivingIndex?: number;             // slot held open for a card in flight (ignored while heldId is set)
  gapAt: number | null;
  card: { w: number; h: number; scale: number };   // caller-sized: faceDown backs or faces, on/off turn
  restingCardH: number;               // CARD_H(scale * HAND_SCALE): zone height, exchange arrival rise
  roomW: number;                      // already widened by HAND_NEAR_RATIO on turn
  availW: number;
  bottomPad: number;
  refused?: ReadonlySet<string> | null;            // giveable === false
}
export interface HandCardPlace {
  id: string; slot: number;
  left: number; bottom: number; shiftX: number; arcRot: number;
  restX: number; restY: number;       // the same numbers the throw origin and the resize read
  hitW: number;
}
export interface HandStrips {           // worklet-readable plain arrays
  ids: string[]; lefts: number[]; widths: number[]; tops: number[]; rots: number[]; refused: boolean[];
}
export interface HandRowLayout {
  cardW: number; cardH: number; cardScale: number;
  crop: number; visibleH: number; arcRise: number;
  step: number; rowW: number; totalW: number; scrollable: boolean; overhang: number; panLimit: number;
  topClearance: number; tiltOverhang: number; heldCeiling: number;
  rowCentreY: number; rowBase: number; rowMid: number;
  exchangeArrivalRise: number;
  slots: { x: number; y: number; rot: number }[];  // the whole hand's slots: where a dropped card goes
  cards: HandCardPlace[];                           // one per drawn card, minus the held one
  strips: HandStrips;
}
export function layoutHandRow(i: HandRowInput): HandRowLayout;

/** The card a finger at (x, y) is on, turned about each card's centre as it is drawn. 'worklet'. */
export function cardUnder(
  s: HandStrips, card: { w: number; h: number; lift: number },
  x: number, y: number, shown: readonly string[], lifted: readonly string[], reduceMotion: boolean
): number | null;

/** A drawn card's resting pose from the hand zone's centre: what `onOrigins` reports. */
export function restingOrigin(l: HandRowLayout, place: HandCardPlace, selected: boolean): { x: number; y: number; rot: number };
```

**`StraightHand`**
- Calls `layoutHandRow` once per render, in a `useMemo`.
- `strips`, the `onOrigins` effect and the render map read `layout.cards[i]`. Nothing re-derives `at`/`home`/`slot`.
- `cardUnder` closes over `layout.strips`.
- `cardAtX` is deleted. Its tests move to `cardUnder`, and `handTapStrips.spec.ts` takes its expected strips from `layoutHandRow`.

**`CardItem` props shrink to grouped values:**

```ts
type CardEntry =
  | { kind: "deal"; clock: SharedValue<number>; leaveMs: number; from: Delta; onDealt: (x: number, y: number) => void }
  | { kind: "descend"; from: Delta };        // the exchange arrival; duration Motion.exchange.descend
interface CardItemProps {
  card: Card; place: HandCardPlace; size: { w: number; h: number; scale: number };
  entry: CardEntry | null;                   // read once, at mount
  store: SettledSelection; shown: DerivedValue<string[]>; pressed: SharedValue<string | null>;
  onActivate: (id: string) => void; disabled: boolean; faceDown: boolean;
  giveable?: boolean; hint?: string; received?: boolean; isStartCard: boolean;
  a11yActions?: …; onMove?: …; onDrawn?: …; hidden?: SharedValue<string[]>; rects?: HandRects;
}
```

`dealDelay`, `dealFromX`, `dealRise` and the eight-argument `pose` are deleted. One `poseOf(entry, s, now)` worklet feeds the style, the rect and the landing reaction.

**`lib/memo.ts` (new):**

```ts
export function propsEqualExcept<P extends object>(
  by: { [K in keyof P]?: ((a: P[K], b: P[K]) => boolean) | "ignore" }
): (a: P, b: P) => boolean;            // union of both objects' keys; Object.is for the rest
export const byId: (a: { id: string }, b: { id: string }) => boolean;
export function shallowEqual<T extends object>(a: T, b: T): boolean;
```

`cardItemPropsEqual = propsEqualExcept<CardItemProps>({ card: byId, entry: "ignore", place: shallowEqual, size: shallowEqual })`.

**Invariants**
- `place` and `size` are compared shallowly. Otherwise a fresh layout object per render defeats every card's memo; `handMemo.test.tsx` and `handMemoTable.test.tsx` pin the re-render counts.
- `entry` stays mount-only, as `dealDelay` and `deal` are today.
- `handLayout.ts` imports no `CARD_W`/`CARD_H` (`layoutConstantsPinned.test.ts`).
- The React Compiler must still compile `hand.tsx` (`tests/ui-rules/reactCompiler.test.ts`).
- `cardUnder` stays a `'worklet'`.

### 4.3 Presentation models (GameTable keeps only wiring)

```ts
// components/turnTimerUi.ts
export type TurnState = "matchOver" | "roundOver" | "dealing" | "yourTurn" | "turnOf";
export function turnState(i: { roundOver: boolean; matchOver: boolean; dealing: boolean; viewerOnMove: boolean }): TurnState;
export interface TurnPresentation {
  chip: { text: string; spoken: string; lit: boolean };   // exchangeChip outranks the state, as today
  clock: { active: boolean; seconds: number; resetKey: string };
  seat?: { seconds: number; resetKey: string; held: boolean };   // the ring's window
}
export function turnPresentation(i: {
  state: TurnState; onMoveName: string;
  exchange: { chip: string | null; choiceOpen: boolean; viewerIsWinner: boolean; active: boolean };
  timer?: TurnTimerConfig; isMyTurn: boolean; isFinished: boolean; isNewTrick: boolean;
  holdingForStart: boolean; held: boolean; turnToken: string;
  t: TFn;
}): TurnPresentation;
```

`tableA11y.ts` maps the same `TurnState` through its own exhaustive `Record`. It keeps its own input (`turnShown`, not `viewerOnMove`), which preserves today's announcement timing.

```ts
// components/table/tableVeils.ts
export type VeilRole = "table" | "sheetOnly" | "coverOnly" | "clock";
export function tableVeils(i: { settingsOpen: boolean; tableCovered: boolean; portrait: boolean; holdingForStart: boolean })
  : { withdrawn: boolean; veil: Record<VeilRole, boolean> };
// The reasons now in gameTableVeil.test.ts's REACHABLE_ON_PURPOSE / VEILED_ON_ITS_OWN_TERMS move here as doc on each role.

// components/table/useTableFloat.ts — the render-time diff now inline at GameTable.tsx:546-567
export function useTableFloat(i: { gameState: GameState; error: ServerError | null; autoPassed: number;
  withdrawn: boolean; viewerSeat: number; spectating: boolean }): { float: Float | null; raise: (kind: "reject", text: string) => void };

// lib/game/scorePill.ts
export function matchBoardFor(i: { standings: PillStandings; players: readonly Player[]; winners: readonly string[];
  score: { target: number; single?: boolean }; actions: MatchBoardActions; rating?: MatchRating; t: TFn }): MatchBoard;

// components/table/spokenLabels.ts (moved from pile.tsx)
export function comboLabel(combo: Combination | null, t: TFn): string | null;  // Record<Combination["type"], TranslationKey>

// lib/device/orientation.tsx
export function useLandscapeLock(navigation?: { addListener: NavigationLike["addListener"] }): void;
// lock on mount, relock every 1 s while upright (#1378), relock on transitionEnd (#1211), unlock + release on unmount
```

**Deleted from GameTable:**
- the two ternary ladders and the two `turnTimerActive` calls;
- the five veil booleans;
- `floatSeen`;
- the `matchBoard` IIFE;
- `lockLandscape`, the three orientation effects, and the `expo-screen-orientation` and `modules/murlan-orientation` imports;
- the fresh `{}` defaults, which become module constants.

`readExchange` is memoised on the phase fields inside `useTableExchange`.

### 4.4 Ending landing and lamp holds

```ts
// components/table/pile.tsx
export function usePileFlight(i: PileFlightInput): PileFlight & {
  /** performance.now() of the landing of the play that ended the round; null while the round runs or that play flies.
   *  If the round ended with nothing thrown, the time `roundOver` was first seen. Reset when `roundOver` goes false. */
  ending: { landedAt: number } | null;
};
// useRoundEnding({ ended, landed: number | null, hold, match, pileEmpty, onLanded }) — no `timeline`
// useRoundOutcome({ ended, outcome, landed: number | null }) — no `timeline`
```

The latch lives next to the throw effect, which is the only code that knows synchronously whether the commit threw. The "call after `usePileFlight`" prose and the `show.current` ref trick in `useRoundOutcome.ts:22-27` are both deleted.

```ts
// components/table/lampRig.ts
export type LevelOwner = "lost" | "breath" | "link";
// Lamp gains holds: Record<LevelOwner, number>  (1 = released)
lampControls.hold(s: Lamp, owner: LevelOwner, level: number | null, rate: number): void;
// lvlT = min(1, ...Object.values(holds)); lvlRate = the rate of the write that changed lvlT
// LampRig: hold(owner, level, rate) replaces setLevel; `setLevel` leaves the public interface.
```

Each writer releases only its own hold, so both sentinel comparisons go.

### 4.5 `components/table/countdown.ts` and `useCountdown`

```ts
export interface Countdown { key: string; ranMs: number; since: number | null }  // since: running-from time, null when held/stopped
export function countdownStep(c: Countdown, i: { key: string; running: boolean; now: number }): Countdown; // pure
export function remainingMs(c: Countdown, seconds: number, now: number): number;
export function useCountdown(o: { seconds: number; resetKey: string; running: boolean; held?: boolean;
  onExpire?: () => void; now?: () => number }): { left: number; elapsedMs: () => number };
```

- `TurnChip` and `ReconnectingMark` render `left`, which is `ceil(remainingMs/1000)`. A tick timer aligns to the next whole second of `remainingMs`.
- `SeatRing` starts `swept` at `elapsed/total` and runs `withTiming(1, { duration: remainingMs })`.
- Holds are one rule: `held` freezes `ranMs`.
- `onExpire` fires once per `key`, never while held.
- `clockRunningOut` fires at the same threshold as today.

### 4.6 Seams

```ts
// lib/motion.ts — the only importer of withRepeat
export function useOwnedValue<T>(init: T): SharedValue<T>;                 // cancelAnimation on unmount
export function useLoop(sv: SharedValue<number>, loop: () => number, on: boolean): void; // endless; never runs while !on; cancels on off/unmount
export function repeatTimes<T>(anim: T, times: number, reverse?: boolean): T;  // finite only
// components/table/actions.tsx
function usePressScale(enabled: boolean): { onPressIn: () => void; onPressOut: () => void; style: AnimatedStyle; pressed: boolean };
// lib/tokens.ts
Gradient.garnet: { colors: readonly string[]; locations: readonly number[] };
Reading.mark: number;     // 1000, from Motion.mark.hold
Motion.exchange.descend; Motion.handLift;   // 500 each, from hand.tsx:97 and chrome.tsx:219
// lib/platform.ts
export const clipOverflow: ViewStyle | null;   // { overflow: "clip" } on web, null native
export const viewFilterGrey: boolean;          // false on iOS (SwiftUI-hosted filter quirk)
export const hapticsAvailable: boolean;        // Platform.OS !== "web"
```

ESLint: `@typescript-eslint/no-restricted-imports` bans `withRepeat` from `react-native-reanimated` outside `lib/motion.ts`, following the `paletteLayers` pattern at `eslint.config.js:153-156`. A fixture test proves the rule fires; that test is the safeguard's floor. `infiniteAnimations.test.ts` is then deleted, because an endless loop can only exist in `useLoop`, which owns its cancel.

### 4.7 Leaves

- **CardView (L-098):** becomes a pure painter: face or back, a11y, and `selected` for its visual and a11y state. `noLift`, `onPress`, the `-14` lift and the press rise and tilt move to `TutorialCard` in `app/tutorial/` (or next to `app/tutorial.tsx`). `PRESS_RISE`/`PRESS_TILT` stay exported for the hand.
- **L-107:** `cardFaceModel.LETTER_SPACING` is imported into the style. The joker size is unchanged pending the owner (decision 1).
- **L-104:** `useCardRect(table, key, on, read, inputs: readonly SharedValue<unknown>[])`. All 5 callers name their inputs, and `__closure` goes.
- **L-105:** `noticeTiming` returns `{ enter: motionMs("mark", r), hold: Reading.mark, exit: motionMs("mark", r) }` for chip and float. `Motion.reduced.mark` is added.
- **L-106:** `Sweep` loses `durationMs` and uses `SWEEP_MS`.
- **L-117:** `SettingRow({ icon, label, sublabel, stacked, children })` in `SettingsModal.tsx`. The haptics row is gated by `hapticsAvailable`.
- **L-115:** `particleSprites.ts` gets `stepScene(scene, light, dt, reduced, rng, out): { lit; moth; mothSet; idle }`, called by both adapters. On the first idle frame the web adapter clears once and then returns early.
- **L-109:** the `BenchScreen` run body goes in `try/finally`, which resets `benchRunning` and the drain. An unmount effect clears the drain.

## 5. Migration

Each step is one ticket and leaves main green. They are ordered so that tickets editing the same files never run in parallel.

1. **T1 — hand row layout.**
   - Pin first: node tests of today's numbers (topClearance, heldCeiling, slots, strips, restY) for 2/3/4-seat deals on `PHONES`, held and arriving variants.
   - Then add `layoutHandRow`/`cardUnder`/`restingOrigin`, CardItem `place`/`entry`, and `lib/memo.ts`.
   - Deletes: the three loops, `cardAtX`, `dealDelay`, `DEAL_DURATION_MS`, `cardItemPropsEqual`'s 29 lines, and the CardItem half of `cardMemoComparators.test.tsx`.
2. **T9 — standalone (L-109, L-115).** Can run any time.
3. **T2 — table layout and dissolving `flightPhysics.ts`.**
   - Pin first: anchors, seatPoint, floatTop, chipsBottom and pill numbers for `VIEWPORTS` against today's functions.
   - Deletes: `flightPhysics.ts`, `flightHooks.test.ts`, `SeatGeometry`, `computeScreenPads`, `notificationTopOffset`, and the 12-field spread.
4. **T3 — CardView painter, letter spacing, CardView comparator via `propsEqualExcept`.**
   - Deletes: `noLift`, CardView's lift and press, and `cardMemoComparators.test.tsx` itself.
5. **T4 — presentation models.** Pin first: node tables for the chip, spoken text, a11y and veils, generated from today's GameTable branches.
   - Deletes: the ladders, the veil booleans, `floatSeen`, the board IIFE, the orientation code in GameTable, `getComboLabel` in pile, and the whitespace scan in `gameTableVeil.test.ts`.
6. **T5 — ending landing and lamp holds.** Red first: the link-recovery-inside-dim test.
   - Deletes: the two gates, both ordering comments, `setLevel` and the two sentinels.
7. **T6 — countdown.** Pin first: `seatTurnClock`, `turnChipLabel` and `matchTurnChip` stay green, and a node table covers `countdownStep` (held, resumed, reset).
   - Deletes: three hand-rolled clocks.
8. **T7 — platform seam and settings rows.** Deletes: `WEB_CLIP`, the `"clip" as "hidden"` cast, the `IOS` constants for grey, and the two haptics gates.
9. **T8 — motion seam.** Deletes: about 25 cleanup effects, `infiniteAnimations.test.ts`, `Sweep.durationMs`, the duplicate press blocks and the garnet stops.

## 6. No-regression strategy

- **Pin before move.** Each ticket's first commit adds node tests that compute today's numbers through today's code (the old functions are still present) and assert the new pure function returns the same. Where the ticket is a bug fix, that commit is red:
  - L-097: lamp dim survives a link drop and recovery.
  - L-100: the chip and the ring agree after a hold.
- **Unit tests cannot see layout.** Every ticket that changes where something is drawn must keep these e2e specs green and run them before pushing:
  - T1: `handClearance`, `handTapStrips`, `handParity`, `handScroll`, `reorderHand`, `pileHandoff`, `handBudget`.
  - T2: `flightOrigin`, `lampSeats`, `startAnnouncement`, `bannerPlacement` (native) plus a banner e2e if one exists.
  - T3: `a11yOverlays`, tutorial specs.
  - T7: SettingsModal screenshot plus `a11yOneNode`.
  - T9: the web particle spec or a parity run.
  - The native suite only proves wiring.
- **Memo behaviour:** `handMemo.test.tsx` and `handMemoTable.test.tsx` (re-render counts) must stay green through T1 and T3. `propsEqualExcept` gets its own 5-case node test.
- **Scans that move or change:**
  - `flightHooks.test.ts`: deleted (T2), because module boundaries replace it.
  - `cardMemoComparators.test.tsx`: replaced (T1, T3).
  - `gameTableVeil.test.ts`: the indentation parser is replaced by a native test that mounts GameTable under each `tableVeils` input and asserts every child of the game layer carries the veil `tableVeils` names (T4). This is a11y props, not layout, so the renderer can see it.
  - `infiniteAnimations.test.ts`: deleted (T8) once the lint plus its fixture land.
  - `tableProportions.test.ts:111`: re-anchored on `layout.tableBox` (T2).
  - `motionEscapes.test.ts`: its pinned count drops as `_MS` literals move into `Motion` (T1, T8). The count is lowered, never raised.
  - `reactCompiler.test.ts`: must stay green on every ticket.
  - `layoutConstantsPinned.test.ts`: T1.
  - `oneClock.test.ts`: T5 and T6 must not wait out a motion token.
- **Behaviour pins kept as they are:**
  - `roundEndingStart`, `roundEndingPill` (T5)
  - `matchTurnChip`, `dealTurn`, `turnChipLabel`, `seatTurnClock`, `seatReconnectClock`, `clockCrossFade` (T4, T6)
  - `passMarker`, `onlineErrorFloat`, `floatSlot` (T4)
  - `orientationFirstRender`, `orientationRows` (T4; retargeted at the hook)
  - `exchangeOnTable`, `exchangeDeal` (T2)

## 7. Coverage table

| ID | Covered by | Note |
|---|---|---|
| L-089 | T1 | `layoutHandRow` + `cardUnder`; `cardAtX` deleted; `handTurnScale` imports the real function |
| L-090 | — (done at MAIN) | #1603: `useTableExchange.ts`, `exchangeModel.exchangeNotes`, `tests/ui-rules/exchangeModel.test.ts`. The leg callbacks stay: ExchangeLegs owns the UI-thread clock that produces the stages. `readExchange` identity is handled in T4 (L-108) |
| L-091 | T2 | Step 1 only (`TableLayout` + `Seating`); absolute boxes rejected (owner decision 4) |
| L-093 | T1 (lib/memo, CardItem), T3 (CardView, delete scan) | Keeps a behavioural test, per `fix_ok` |
| L-094 | T4 | Three ladders, not two (per correction): `turnState` feeds chip, spoken and `tableA11y` |
| L-095 | T4 | `useLandscapeLock` in `lib/device/orientation.tsx`; ~30 lines and 2 imports |
| L-096 | T5 | Two implementations, four call sites (per correction); `usePileFlight` returns `ending` |
| L-097 | T5 | Owned holds; red test first |
| L-098 | T3 | Keep `selected` in the painter (per correction); lift, press and `onPress` move to `TutorialCard` |
| L-099 | T2 | `flightPhysics.ts` dissolved into impact, tableLayout, passes, throws and exchangeModel; own-slot dedupe via `ownSlotFrom` |
| L-100 | T6 | `useCountdown` with a pure `countdownStep` |
| L-101 | T1 | `entry` union; `dealDelay` gone; descend duration to `Motion.exchange.descend` |
| L-102 | T4 | Float half fixed by #1602; residue `floatSeen` goes to `useTableFloat`; veils go to `tableVeils` plus a native test |
| L-103 | T8 | `usePressScale` in actions.tsx (MenuButton's block differs, left alone); `Gradient.garnet` gets locations |
| L-104 | T8 | Explicit `inputs`. Touches deal, ExchangeLegs, hand and pile, so it runs after T1, T2 and T3 |
| L-105 | T8 | `Reading.mark`, `motionMs("mark")` |
| L-106 | T1 (`DEAL_DURATION_MS`), T8 (`Sweep.durationMs`, `HAND_LIFT_MS`) | Per correction they were already counted by `motionEscapes`; this is token hygiene |
| L-107 | T3 | Letter spacing only; joker size is owner decision 1 |
| L-108 | T4 | Defaults hoisted; `readExchange` memoised; `MenuLayout.hasMore` set only on change. The `placementPoints` effect deps and `shakeOffset` parts are already fixed or trace-only (per correction) |
| L-109 | T9 | `try/finally` plus unmount cleanup |
| L-110 | T7 | `lib/platform.ts`; `harnessData` dropped: `chrome.tsx` `harnessState` already serves View |
| L-112 | T2 (`pillAnchorFor`, `voteTop`), T4 (`matchBoardFor`) | |
| L-113 | T4 | Exhaustive map in `spokenLabels.ts`; client's L-064 `term.*` keys replace the key map later (cross-area) |
| L-114 | T8 | `useOwnedValue`; 11 exact-shape effects plus hand.tsx's 7-value block |
| L-115 | T9 | `stepScene`; web idles after one clear |
| L-116 | T2 | `layout.chipsBottom`, `bannerTop`; `computeScreenPads` deleted; NotificationBanner builds its own layout |
| L-117 | T7 | `SettingRow` with `stacked` |
| L-120 | T8 | Narrowed per `fix_ok`: `lib/motion.ts` owns `withRepeat` (lint plus fixture); `infiniteAnimations` deleted; the AST tests are kept; `reducedMotion.test.ts` is kept (owner decision 3) |

## 8. Proposed tickets

The external blockers are open tickets #1624 (in progress) and #1639. Nothing below edits `app/game.tsx`, `useClockFade.ts` or `TableNotice.tsx` except T8, which is blocked on #1639.

### T1 — Hand row: one layout function, one hit test, a CardItem that takes a place (L)
- **IDs:** L-089, L-101, L-093 (CardItem half and `lib/memo.ts`), L-106 (`DEAL_DURATION_MS`).
- **Files:** `components/handLayout.ts`, `components/table/hand.tsx`, `lib/memo.ts` (new), `lib/tokens.ts` (`Motion.exchange.descend`), `tests/ui-rules/handLayout.test.ts`, `tests/ui-rules/handTurnScale.test.ts`, `tests/e2e/handTapStrips.spec.ts`, `tests/native/cardMemoComparators.test.tsx` (CardItem half), `tests/ui-rules/motionEscapes.test.ts` (count).
- **Blocked by:** nothing in this area. It does not touch #1624's files, so it can start now.
- **Definition of done:**
  - [ ] First commit pins today's row: for 2/3/4-seat deals on `PHONES`, on and off turn, faceDown, held and arriving, a node test records step, totalW, topClearance, heldCeiling, slots, strips and per-card left/bottom/shiftX/restX/restY from the current `StraightHand` arithmetic, copied into the test with a pointer to the hand.tsx lines it mirrors. `layoutHandRow` must match it.
  - [ ] `layoutHandRow`, `cardUnder` (`'worklet'`) and `restingOrigin` live in `handLayout.ts`, take card dimensions as input, and import no `CARD_W`/`CARD_H`.
  - [ ] `StraightHand` calls it once per render. `strips`, `onOrigins` and the render map read `layout.cards`.
  - [ ] `cardAtX` is deleted. `handLayout.test.ts` covers `cardUnder`, including rotated corners and lifted selection. `handTapStrips.spec.ts` takes expected strips from `layoutHandRow`.
  - [ ] `handTurnScale.test.ts` imports `layoutHandRow` and its `row()` helper is deleted.
  - [ ] `CardItem` takes `place`, `size` and `entry: CardEntry | null`. `dealDelay`, `dealFromX`, `dealRise` and the literal `DEAL_DURATION_MS` are gone (the descend duration is `Motion.exchange.descend`, same 500 ms and easing).
  - [ ] `lib/memo.ts` has `propsEqualExcept`, `byId` and `shallowEqual`, with a 5-case node test. `cardItemPropsEqual` uses it (`place`/`size` shallow, `entry` ignored).
  - [ ] `handMemo.test.tsx`, `handMemoTable.test.tsx` and `reactCompiler.test.ts` are green.
- **Checks:**
  - While iterating: `node --test tests/ui-rules/handLayout.test.ts tests/ui-rules/handTurnScale.test.ts tests/ui-rules/layoutConstantsPinned.test.ts tests/ui-rules/reactCompiler.test.ts`; `npx jest tests/native/handMemo tests/native/handMemoTable tests/native/cardMemoComparators`.
  - Before pushing: `npm run agent:check`; `npm run test:e2e -- handClearance handTapStrips handParity handScroll reorderHand pileHandoff handBudget`.

### T2 — Table layout built once; `flightPhysics.ts` dissolved (L)
- **IDs:** L-091, L-099, L-116, L-112 (anchor and vote tops).
- **Files:**
  - New: `components/tableLayout.ts`, `components/impact.ts`, `components/passes.ts`, `components/table/throws.ts`.
  - Deleted: `components/flightPhysics.ts`.
  - Changed: `components/table/exchangeModel.ts`, `components/GameTable.tsx`, `components/table/pile.tsx`, `deal.tsx`, `dealSlots.ts`, `ExchangeLegs.tsx`, `hand.tsx` (import line), `seats.tsx`, `moments.tsx`, `useFlightClock.ts`, `useLampRig.ts`, `components/useTableFeedback.ts`, `components/tableFrame.ts`, `components/table/scorePillModel.ts`, `components/NotificationBanner.tsx`, `app/(online)/game.tsx` (`computeScreenPads`), `app/game.tsx` (`turnKey` import only).
  - Tests: `tests/helpers/phoneTable.ts`, `tests/e2e/helpers/lanternDepartures.ts`, `tests/ui-rules/flightPhysics.test.ts` (split per module), `flightHooks.test.ts` (deleted), `tableProportions.test.ts`, `dealSlots.test.ts`, `tests/native/bannerPlacement.test.tsx`, and the other importers listed by `grep flightPhysics`.
- **Blocked by:** T1; #1624 (`deal.tsx`, `ExchangeLegs.tsx`, `GameTable.tsx`).
  - It touches `app/game.tsx` on one import line, so it waits for #1639 as well, or the import move is left to a re-export shim deleted in T4. **Pick:** wait for #1639.
- **Definition of done:**
  - [ ] First commit: a node test computes anchors, every `seatPoint`, `floatTop`, the pill anchor, both vote tops and the banner offset for `VIEWPORTS` with zero and notched insets, through today's functions. `tableLayout` must equal them, including `chipsBottom === notificationTopOffset(...)` wherever landscape.
  - [ ] `tableLayout()` and `Seating` exist. GameTable builds each once with `useMemo`. `seatGeometry`, `SeatGeometry`, `SeatPlace`, `TableGeometry`, `tableGeometry`, `anchorPoints`, `floatTop`, `flightOrigin` and `ThrownPlayInput`'s frame fields are deleted.
  - [ ] `usePileFlight`, `useDeal`, `dealSlots`, `readThrownPlay`, `readExchangeLegs` and `ExchangeLegs` take `layout` and `seating`. `usePileFlight`'s effect deps no longer list frame fields.
  - [ ] `ownSlotFrom` replaces the duplicate expression in `readThrownPlay` and `readExchangeLegs`.
  - [ ] `flightPhysics.ts` is gone: impact, passes, throws, tableLayout, and exchangeModel gets the hand arrival. `flightHooks.test.ts` is deleted, and each new module has its own test file.
  - [ ] `computeScreenPads` and `notificationTopOffset` are deleted. `NotificationBanner` uses `bannerTop(tableLayout(...))`.
  - [ ] `tableProportions.test.ts:111` asserts GameTable spreads `layout.tableBox`. A node test asserts `tableBox.bottom === frame.surplus`.
- **Checks:**
  - While iterating: `node --test tests/ui-rules/tableLayout.test.ts tests/ui-rules/flightPhysics*.test.ts tests/ui-rules/tableProportions.test.ts tests/ui-rules/dealSlots.test.ts`; `npx jest tests/native/bannerPlacement tests/native/exchangeOnTable`.
  - Before pushing: `npm run agent:check`; `npm run test:e2e -- flightOrigin lampSeats startAnnouncement`.

### T3 — CardView is a painter (S)
- **IDs:** L-098, L-107 (letter spacing), L-093 (CardView half; delete the scan).
- **Files:** `components/CardView.tsx`, `components/cardFaceModel.ts`, `app/tutorial.tsx` (plus a new `TutorialCard` beside it), `components/table/hand.tsx`, `components/LookPicker.tsx`, `components/table/ExchangeLegs.tsx` (drop `noLift`), `tests/native/cardMemoComparators.test.tsx` (deleted).
- **Blocked by:** T1 (`lib/memo`, `hand.tsx`); T2 (`ExchangeLegs.tsx`).
- **Definition of done:**
  - [ ] CardView has no `noLift`, `onPress`, selected lift, or press rise and tilt. `selected` still drives `accessibilityState`, the selected hint and the lifted shadow.
  - [ ] `TutorialCard` reproduces the tutorial's lift (−14 spring, reduced-motion timing) and press. A native test pins `onPress` and the lift target.
  - [ ] `cardViewPropsEqual = propsEqualExcept({ card: byId })`. `cardMemoComparators.test.tsx` is deleted, and a native test still proves a new card object with the same id does not re-render.
  - [ ] The style uses `cardFaceModel.LETTER_SPACING`. The joker size is unchanged.
- **Checks:**
  - While iterating: `npx jest tests/native/cardView* tests/native/tutorial*`.
  - Before pushing: `npm run agent:check`; `npm run test:e2e -- a11yOverlays tutorial`. Owner screenshot of the tutorial hand.

### T4 — GameTable presentation: turn, veils, float, board, combo label, orientation (M)
- **IDs:** L-094, L-102, L-112 (board), L-113, L-108, L-095.
- **Files:** `components/GameTable.tsx`, `components/turnTimerUi.ts`, `components/tableA11y.ts`, `components/table/tableVeils.ts` (new), `components/table/useTableFloat.ts` (new), `lib/game/scorePill.ts`, `components/table/spokenLabels.ts`, `components/table/pile.tsx` (`getComboLabel` out), `components/table/useTableExchange.ts`, `components/MenuLayout.tsx`, `lib/device/orientation.tsx`, `tests/ui-rules/gameTableVeil.test.ts` (replaced), and tests for each new function.
- **Blocked by:** T2.
- **Definition of done:**
  - [ ] First commit: a node table generated from today's GameTable branches covers `{roundOver, matchOver, dealing, viewerOnMove, exchangeChip}`, giving chip text, spoken text and a11y text, plus both timer questions.
  - [ ] `turnState` and `turnPresentation` reproduce it. GameTable has no chip ladder and one `turnTimerActive`-equivalent call site. `tableA11y` maps the same `TurnState` and keeps its own `turnShown` input.
  - [ ] `tableVeils` replaces the five booleans. A native test mounts GameTable under settings open, covered, portrait and holding-for-start, and asserts each game-layer child's veil. The indentation parser in `gameTableVeil.test.ts` is deleted.
  - [ ] `useTableFloat` replaces `floatSeen`. `passMarker`, `onlineErrorFloat` and `floatSlot` are green.
  - [ ] `matchBoardFor` gets a node test (single winner, teams, draw, single round).
  - [ ] `comboLabel` is in `spokenLabels.ts` with a `Record<Combination["type"], TranslationKey>`.
  - [ ] Defaults are module constants. `readExchange` is memoised. `MenuLayout.hasMore` is state set only on change.
  - [ ] `useLandscapeLock` holds all orientation code. `orientationFirstRender` and `orientationRows` target it. GameTable imports neither `expo-screen-orientation` nor `modules/murlan-orientation`.
- **Checks:**
  - While iterating: `node --test tests/ui-rules/turnTimerUi.test.ts tests/ui-rules/tableVeils.test.ts`; `npx jest tests/native/matchTurnChip tests/native/dealTurn tests/native/turnChipLabel tests/native/passMarker tests/native/orientation*`.
  - Before pushing: `npm run agent:check`; `npm run test:e2e -- a11yOverlays startAnnouncement`.

### T5 — The round's ending landing is a return value; lamp level is owned holds (M)
- **IDs:** L-096, L-097.
- **Files:** `components/table/pile.tsx`, `useRoundEnding.ts`, `useRoundOutcome.ts`, `components/GameTable.tsx` (four call sites), `components/table/lampRig.ts`, `useLampRig.ts`, `useLinkHold.ts`, `tests/ui-rules/lampRig.test.ts`, `tests/native/roundEndingStart.test.tsx`.
- **Blocked by:** T4.
- **Definition of done:**
  - [ ] Red first: a native test with `useLampRig` (`dim` true) and `useLinkHold` going lost then up asserts that the lamp's `lvlT` stays at `RoundMoment.lostLevel`. It is red at MAIN.
  - [ ] `lampControls.hold(s, owner, level|null, rate)` with `holds` on `Lamp`. `setLevel` leaves `LampRig`. No writer compares `lvlT` to a constant. The node test covers every overlap of lost, breath and link.
  - [ ] `usePileFlight` returns `ending`. `useRoundEnding` and `useRoundOutcome` take `landed` and no `timeline`. Both "call after `usePileFlight`" comments and the `show.current` ref setter are gone.
  - [ ] `roundEndingStart`, `roundEndingPill` and `oneClock.test.ts` are green. A native test covers a round that ends with nothing thrown (an online forfeit) and still starts its ending.
- **Checks:**
  - While iterating: `node --test tests/ui-rules/lampRig.test.ts tests/ui-rules/oneClock.test.ts`; `npx jest tests/native/roundEnding* tests/native/lamp*`.
  - Before pushing: `npm run agent:check`; `npm run test:e2e -- lampSeats`.

### T6 — One countdown for the chip, the ring and the reconnect mark (M)
- **IDs:** L-100.
- **Files:** `components/table/countdown.ts` (new), `components/table/notices/hud.tsx`, `notices/seatMarks.tsx`, `components/table/seats.tsx`, `components/GameTable.tsx` (`seatCountdown` comes from `turnPresentation.seat`), and tests.
- **Blocked by:** T5 (GameTable), T4 (`turnPresentation`).
- **Definition of done:**
  - [ ] Red first: a native test holds then resumes a turn, then asserts the chip's `left` equals `ceil(ring remaining / 1000)`. It is red at MAIN.
  - [ ] `countdownStep` gets a node table: run, hold, resume, reset by key, expiry once.
  - [ ] TurnChip, ReconnectingMark and SeatRing read one `useCountdown`. No `setInterval` decrement and no `Date.now` accumulation remain.
  - [ ] `clockRunningOut` fires once at the same threshold. `onExpire` never fires while held.
  - [ ] `seatTurnClock`, `seatReconnectClock`, `clockCrossFade`, `turnChipLabel` and `oneClock.test.ts` are green.
- **Checks:**
  - While iterating: `node --test tests/ui-rules/countdown.test.ts`; `npx jest tests/native/seatTurnClock tests/native/seatReconnectClock tests/native/turnChipLabel`.
  - Before pushing: `npm run agent:check`.

### T7 — Platform quirks behind one seam; settings rows (S)
- **IDs:** L-110, L-117.
- **Files:** `lib/platform.ts` (new), `components/GameTable.tsx`, `components/table/hand.tsx`, `greyLayer.tsx`, `useLinkHold.ts`, `feltCanvas.tsx` (doc), `components/table/settingsSheet.tsx`, `components/SettingsModal.tsx`.
- **Blocked by:** T6 (GameTable), T5 (`useLinkHold`), T1 (`hand.tsx`).
- **Definition of done:**
  - [ ] `clipOverflow`, `viewFilterGrey` and `hapticsAvailable` replace `WEB_CLIP`, the `"clip" as "hidden"` cast, the two grey `IOS` constants and both haptics gates. `feltCanvas.tsx:57` (opaque Skia) is left alone: it is a different quirk.
  - [ ] `SettingRow({ icon, label, sublabel, stacked, children })` renders all six rows. The a11y one-node rule holds (`a11yOneNode.test.ts`).
- **Checks:**
  - While iterating: `npx jest tests/native/settings*`.
  - Before pushing: `npm run agent:check`; `npm run test:e2e -- handScroll a11yOverlays`. Owner screenshot of SettingsModal before and after.

### T8 — Motion seam: owned values, owned loops, tokens for the strays (L)
- **IDs:** L-114, L-120, L-105, L-106 (`Sweep`, `HAND_LIFT_MS`), L-103, L-104.
- **Files:**
  - New: `lib/motion.ts`.
  - Changed: `lib/tokens.ts`, `eslint.config.js`, and every component with the exact cancel-on-unmount effect or a `withRepeat` (about 22 files under `app/`, `components/`, `context/`, `lib/`), including `components/table/actions.tsx`, `settingsSheet.tsx`, `noticeModel.ts`, `moments.tsx`, `chrome.tsx`, `useCardRects.ts` and its 5 callers.
  - Tests: `tests/ui-rules/infiniteAnimations.test.ts` (deleted), `motionEscapes.test.ts` (count), and a new lint fixture test.
- **Blocked by:** T7, T6, T3, T2; #1639 (`useClockFade.ts`, `TableNotice.tsx`).
- **Definition of done:**
  - [ ] `useOwnedValue`, `useLoop` and `repeatTimes` exist in `lib/motion.ts`. No `useEffect(() => () => cancelAnimation(x), [x])` remains. `hand.tsx`'s seven-value cancel block is gone.
  - [ ] ESLint refuses a `withRepeat` import outside `lib/motion.ts`. A fixture test runs ESLint on an offending file and expects the error. `infiniteAnimations.test.ts` is deleted. `withDelayReduceMotion` and `answeredMotionOptsOut` are unchanged and green.
  - [ ] `noticeTiming`: chip and float take `Reading.mark` for the hold, and `motionMs("mark", r)` for enter and exit.
  - [ ] `Sweep` has no `durationMs`. `HAND_LIFT_MS` becomes `Motion.handLift`. The `motionEscapes` count drops.
  - [ ] `usePressScale` serves GIOCA and PASSA. `Gradient.garnet` carries its locations, and actions and settingsSheet read them.
  - [ ] `useCardRect` takes explicit `inputs`. No `__closure` read remains.
- **Checks:**
  - While iterating: `node --test tests/ui-rules/reducedMotion.test.ts tests/ui-rules/withDelayReduceMotion.test.ts tests/ui-rules/motionEscapes.test.ts tests/ui-rules/reactCompiler.test.ts`; `npx eslint components lib app`.
  - Before pushing: `npm run agent:check`; `npm run test:e2e -- handParity pileHandoff lampSeats`.

### T9 — Bench latch and the particle scene step (S)
- **IDs:** L-109, L-115.
- **Files:** `components/BenchScreen.tsx`, `components/table/particleSprites.ts`, `particleLayer.tsx`, `particleLayer.web.tsx`, plus tests.
- **Blocked by:** nothing. These files are in no other ticket.
- **Definition of done:**
  - [ ] Red first: a native test whose scenario list throws asserts that a second run is still accepted, and that unmount clears the drain interval.
  - [ ] `stepScene` is the only step sequence. Both adapters call it.
  - [ ] Once idle, the web adapter clears one frame and stops drawing. A test asserts no canvas draw calls on frames after idle, and that a new emit resumes drawing.
  - [ ] `landingDust` and `hiddenThrows` are green.
- **Checks:**
  - While iterating: `npx jest tests/native/landingDust tests/native/hiddenThrows tests/native/bench*`.
  - Before pushing: `npm run agent:check`; the web particle parity spec alone (`npx playwright test --config tests/e2e/playwright.parity.config.ts <particle spec>`).

**Order:** T1 and T9 start now. Then T2 (needs #1624), T3, T4, T5, T6, T7, and T8 (needs #1639).

## 9. Cross-area contracts

- **client (L-064):** owns the `term.*` namespace and `comboLabel(type, t)`.
  - T4 moves `getComboLabel` into `components/table/spokenLabels.ts` with an exhaustive map.
  - The client ticket for L-064 edits that same function, so it must be ordered after T4, or T4 consumes the client's helper if it landed first.
  - `ReplayControls.tsx:31-38` keeps its own map, which uses different keys; that belongs to client's L-064.
- **client / http:** T2 edits `app/(online)/game.tsx` (one call, `computeScreenPads`) and `components/NotificationBanner.tsx`. Any ticket on those files in those areas must be ordered against T2.
- **time:** T6's `useCountdown` takes `seconds` plus `resetKey` (today's `TurnTimerConfig`). If the time area replaces the server window with an absolute deadline, `useCountdown` should take `endsAt` instead, and that ticket goes after T6. Table-ui gives a single hook to change.
- **lastMove / engine:** T2 moves `comboKey` and `turnKey` to `components/passes.ts` and `readThrownPlay` to `components/table/throws.ts`. A lastMove ticket touching those must come after T2. No game rule changes here (`lib/game/gameEngine.ts` untouched).
- **static-checks / test-harness:** these scans are deleted or replaced by table-ui tickets and must not be edited concurrently:
  - `tests/ui-rules/flightHooks.test.ts` (T2)
  - `tests/native/cardMemoComparators.test.tsx` (T1, T3)
  - `tests/ui-rules/gameTableVeil.test.ts` (T4)
  - `tests/ui-rules/infiniteAnimations.test.ts` (T8)
  - `tableProportions.test.ts:111` (T2)
  - `motionEscapes.test.ts` count (T1, T8)
  - Any static-checks rule on `withRepeat` should reuse T8's lint.
- **Given to others:**
  - `lib/memo.ts` (`propsEqualExcept`)
  - `lib/motion.ts` (`useOwnedValue`, `useLoop`)
  - `lib/platform.ts`
  - `components/tableLayout.ts` (anchors for e2e helpers: `tests/e2e/helpers/lanternDepartures.ts`, `tests/helpers/phoneTable.ts`)
  - `components/table/countdown.ts`
- **Open tickets:**
  - #1624 owns `deal.tsx`, `ExchangeLegs.tsx`, `GameTable.tsx` (deal and exchange gates) and `app/game.tsx`. T2 and everything after it wait for it.
  - #1639 owns `useClockFade.ts`, `TableNotice.tsx` and `app/game.tsx`. T2 and T8 wait for it.
  - #1521 (noticed table defects): any item there that lands in GameTable before T4 is rebased by T4, with no design impact.

## 10. Owner decisions needed

1. **L-107 joker rank size.** `rankTextJoker` pins `FontSize.xs`/12 while the rank box scales. Deriving it from scale changes the JK glyph at every card size. **Needs your eye** on a screenshot of both sizes; T3 leaves it unchanged unless you say otherwise.
2. **L-105 reduced motion.** The chip and float notices would fade in and out at `Motion.reduced.mark` instead of 100 ms. The change is visible only with reduced motion on. Following `components/CLAUDE.md` ("reduced-motion form comes from `Motion.reduced`") says yes; confirm the reduced value (0 or a short fade).
3. **L-120 scope.** Keep `reducedMotion.test.ts` (a per-block proximity scan) rather than wrapping `withTiming`/`withSpring` in 22 files. The verifier judged the AST tests sound and the wrapper's cost high. T8 removes only the presence scan (`infiniteAnimations`).
4. **L-091 step 2 rejected.** Rendering the table's sections at absolute model boxes is not proposed. The e2e witnesses (`flightOrigin`, `lampSeats`) already catch model/flex disagreement. Revisit if that class recurs.
5. **Small visible changes that need your eye before merge:**
   - T6: after a hold the turn chip resumes from the true remaining time rather than restarting a whole second (sub-second).
   - T3: tutorial card lift and press move to a wrapper; they should look identical.
   - T7: settings rows rebuilt from one component; they should look identical.
   - T9: the web particle canvas stops redrawing when idle; it should look identical.
