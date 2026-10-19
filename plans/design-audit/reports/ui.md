# Design audit: `components/**` (table UI) and `lib/tokens.ts`

Auditor report, 2026-10-16. Read-only. Every claim below was checked against the source in worktree `C:/Users/roton/murlan/.claude/worktrees/codebase-design-audit-6b14f2` (commit `d8c34919`). Paths are relative to that root.

## Context numbers
- **`components/GameTable.tsx`** (1686 lines)
  - 79 import statements and 30 props (`GameTableProps`, 251-349).
  - 17 `useState`, 11 `useMemo`, 11 `useCallback`, 7 `useEffect` and about 40 custom hooks.
  - 166 commits touched it since 2026-09-16 (`git log`, merges included).
- **Churn in the same window:** pile.tsx 61, hand.tsx 52, seats.tsx 48, flightPhysics.ts 37. 10 of the last 30 commits are exchange fixes.
- **Callers of `GameTable`:** four adapters (`app/game.tsx`, `app/(online)/game.tsx`, `app/(online)/replay.tsx`, `app/capture.tsx`). `GameTableProps` is a **real seam**; the problem is what sits behind it.
- **Tests:** 62 files in `tests/native` mount or name `GameTable`. 39 of 102 `tests/ui-rules` files read source text (`readFileSync` or `readdirSync`).

## GameTable's responsibilities (god component map)

| # | Responsibility | Lines |
|---|---|---|
| 1 | Device and window: scale, insets, portrait, felt, offline note | 385-404 |
| 2 | Settings, focus mode, play-on-left | 406-462 |
| 3 | Opening gate (who starts), state derived during render | 412-433 |
| 4 | Five a11y veil booleans | 435-453 |
| 5 | Game-state derivation: viewer, turn, synthetic spectator hand, hand order | 464-494 |
| 6 | Exchange stage tracking: `exchangeSeq`, `reported`, two callbacks, `ringFlash`, `lifted` | 495-528, 540-542 |
| 7 | Selection store, canPass, passIsOnlyMove, passed seats | 543-584 |
| 8 | Float notice state machine (4 "seen" states, during render) | 585-614 |
| 9 | Giveable cards | 616-628 |
| 10 | Layout geometry: frame, pillAnchor, seatGeometry, score-pill hit test | 635-699 |
| 11 | Match board derivation | 654-671 |
| 12 | Deal | 701-719 |
| 13 | Screen-reader table description | 721-795 |
| 14 | Feedback and animation orchestration: timeline, outcomes, useTableFeedback, hand lift, pile flight, two round endings, two outcome hooks, winner seat, lamp aim, ember effect, lamp rig, motes effect, card table, felt cast, link hold | 797-956 |
| 15 | OS lifecycle: orientation lock, relock interval, navigation listener, card-art warm, deal cue sound | 209-212, 958-993 |
| 16 | Input handlers: tap, pass, refusal | 996-1035 |
| 17 | Render-time presentation: timer activity ×2, turn token, top play name, exchange pile note, exchange chip, seat marks | 1039-1161 |
| 18 | JSX, about 500 lines, including three near-identical seat slots | 1163-1661 |

---

# P1

## F1. GIOCA's refusal ladder re-implements the engine's rule outside `gameEngine.ts`
- **Files:**
  - `components/turnTimerUi.ts:33-82` (`playButtonLabel`, `ComboShape`)
  - `components/table/stagedPlay.ts:55-82`
  - `lib/game/gameEngine.ts:426-495` (`beatRefusal`, `checkSelection`)
  - `tests/ui-rules/playRefusalParity.test.ts`
- **What's wrong:**
  - `readStagedPlay` already calls `checkSelection`, which returns `{ok:false, code}` (stagedPlay.ts:57-61). It then throws `code` away and asks `playButtonLabel` again.
  - `playButtonLabel` is a second copy of `beatRefusal`'s ladder (royal, bomb, type, length, tooLow), working on a lossy `ComboShape`.
  - Its own doc (turnTimerUi.ts:40-42) justifies this by saying "only the caller can run the engine". The caller now does.
  - Two adapters answer one question, and a parity test exists only to hold them together. Game-rule logic lives outside `gameEngine.ts`, which breaks the CLAUDE.md invariant.
- **Proposed interface (stagedPlay.ts):**
  ```ts
  type SelectionRefusal = Exclude<PlayRefusal, "exchangeOpen" | "notHeld">;
  // checkSelection narrowed to return { ok:false; code: SelectionRefusal }
  refusal: myMove && input.selectedIds.length > 0 && !check.ok ? check.code : "play"
  ```
  - `PlayButtonLabel` becomes `"play" | SelectionRefusal`.
  - Equivalent wherever the label is read: `selectionLeaves.tsx:117-140` reads `reason` only when `!staged.playable`.
- **Dependency category:** in-process.
- **Effect:**
  - Deletes about 50 lines (`playButtonLabel` and `ComboShape`). `turnTimerUi.ts` goes back to what its header says it is.
  - The parity test loses its GIOCA column; the engine and tutorial columns remain.
  - "The button gives a different reason than the server" becomes impossible by construction.
- **Effort / risk:** S / Low. **Priority:** P1 (a rule duplicated outside its authority; cheap).

## F2. Hand-row geometry is buried in `StraightHand`, computed in three parallel loops; the tested hit-test is a decoy
- **Files:**
  - `components/table/hand.tsx`, geometry at 750-793, 901-942, 984-1058, and three loops over `rest`:
    - `strips` 1005-1026
    - `onOrigins` effect 1075-1097
    - render map 1309-1371
  - Hit test `cardUnder` 1031-1043 and `slots` 1045.
  - `components/handLayout.ts:84-90` (`cardAtX`).
  - `tests/ui-rules/handTurnScale.test.ts:48-66`.
  - `tests/e2e/handClearance.spec.ts`, `handTapStrips.spec.ts`.
- **What's wrong:**
  - All of this is pure arithmetic (card size per turn, crop, arc solve, tilt overhang, `topClearance`, `heldCeiling`, slot, home and shift per card, strips, rotated hit test). It is locked inside a 22-prop memo component, so only a renderer or Playwright can reach it.
  - The same per-card values are derived three times:
    - `restY` at 1330 equals `y0` at 1085 (`rowBase + crop + home.y - cardH/2`).
    - The `at`/`home`/`slot` lookup is repeated at 1016-1018, 1080-1081 and 1310-1316.
  - The test surface reaches the wrong thing:
    - `cardAtX` is documented as "the hand's whole hit-testing rule" but has no production caller (grep: only `tests/ui-rules/handLayout.test.ts`). Production uses `stripAt` plus the rotation and lift logic in `cardUnder`.
    - `handTurnScale.test.ts:48` has `row()`, "The row hand.tsx lays out", which **re-implements** hand.tsx:754-790 in the test. It can drift silently.
- **Proposed interface** (`components/handLayout.ts`, JSX-free, worklet-safe where needed):
  ```ts
  interface HandRowInput { n: number; arrivingIndex?: number; heldId: string|null; ids: readonly string[];
    scale: number; onTurn: boolean; faceDown: boolean; roomW: number; availW: number; bottomPad: number;
    gapAt: number|null; refused: (id: string) => boolean }
  interface HandCardPlace { id: string; left: number; bottom: number; shiftX: number; arcRot: number;
    restX: number; restY: number; hitW: number; stripLeft: number; stripTop: number; zIndex: number }
  interface HandRowLayout { cardW: number; cardH: number; cardScale: number; visibleH: number; crop: number;
    arcRise: number; rowW: number; totalW: number; scrollable: boolean; panLimit: number;
    topClearance: number; tiltOverhang: number; heldCeiling: number; slots: {x:number;y:number;rot:number}[];
    cards: HandCardPlace[] }
  export function layoutHandRow(i: HandRowInput): HandRowLayout;
  export function cardUnder(l: HandRowLayout, x: number, y: number, shown: readonly string[], reduceMotion: boolean): number | null; // 'worklet'
  ```
- **Dependency category:** in-process.
- **Effect:**
  - `StraightHand` drops about 200 lines of arithmetic, and the three loops become one.
  - `handTurnScale` imports the real function instead of copying it. `cardAtX` is deleted, or production adopts the tested function.
  - The arithmetic half of `handClearance.spec.ts` (`topClearance` against tilt) and `handTapStrips` (strips tile the row, rotated corners) becomes node tests. Keep one e2e per spec as the flexbox witness.
  - Bug class removed: "the origin a throw leaves from disagrees with where the card was drawn" (now one computation).
- **Effort / risk:** M / Medium (UI-thread worklets read the result; keep `cardUnder` a `'worklet'`). **Priority:** P1 (highest-leverage testability gain in the area; CLAUDE.md names layout as the class unit tests cannot see).

## F3. The exchange's presentation is smeared across five modules, with GameTable holding its state machine
- **Files:**
  - `components/GameTable.tsx`: 495-528, 540-542, 616-628, 1121-1155 (`giveNote`, `pileNote`, `exchangeChip`), 1155, 1158, 1498-1515.
  - `components/flightPhysics.ts`: 31-49 (`arrivingCard`), 402-534 (`readExchange`, `ExchangeStages`, `exchangeKey`, `readExchangeSeats`, `readHandArrival`), 614-650 (`JOKERS`, `readExchangeLegs`).
  - `components/table/hand.tsx:69-84` (`useHandArrival`).
  - `components/table/ExchangeLegs.tsx:159-305`. Its own a11y `giveLine` at 280-290 says nearly the same sentence as GameTable's `giveNote` at 1123-1129.
- **What's wrong:**
  - No module owns "the exchange as the table shows it". GameTable keeps the stage-report state (`reported`, `exchangeSeq`, the render-time seq bump at 503) and derives `stages`, `choiceReady`, `exchangeIsMine`, `choiceOpen`, chip text, pile note, seat lit and shift, and giveable.
  - ExchangeLegs reports stages back up through two callbacks, and the hand reads stages again via `useHandArrival`.
  - About 11 values cross GameTable for one concept. The interface is as wide as the implementation, which is shallow.
  - This is the most-churned concept (10 of the last 30 commits; tests `exchangeKeyHolds`, `exchangeReceivedNeverMissing`, `ceremonyHoldsTheCard`, …). Every fix must touch GameTable.
- **Proposed interface:**
  ```ts
  // components/table/exchangeTable.ts (pure)
  export function exchangeNotes(i: { shown: ExchangeAnnounceData|null; stages: ExchangeStages;
    view: ExchangeView; giveable?: Card[]; viewerSeat: number; spectating: boolean; nameOf: (s:number)=>string; t: TFn })
    : { chip: string|null; pileNote: PileNote|null; choiceOpen: boolean };
  // components/table/useExchangeTable.ts
  export function useExchangeTable(i: { state: GameState; announcement?: ExchangeAnnouncementSlot;
    viewerSeat: number; spectating: boolean; hand: Card[]; sorted: Card[]; order: readonly string[]; onReady?: () => void })
    : { shown: ExchangeAnnounceData|null; stages: ExchangeStages; mine: boolean; giveableIds?: string[];
        seats: { lit: number[]; shift: Map<number,number> }; arrival: HandArrival & { handOnTable: Card[]; holding: boolean };
        notes: ReturnType<typeof exchangeNotes>; legs: Omit<ExchangeLegsProps,'geometry'|'scale'|'handOrigins'> | null };
  ```
- **Dependency category:** in-process.
- **Effect:**
  - About 90 lines leave GameTable, and the exchange's derivations sit in one file.
  - `exchangeNotes` is a node test table (two-Jokers, receive at rest, give at rest, fallback giveback, watcher). Today that needs a full GameTable mount (`exchangeOnTable.test.tsx` and similar).
  - The flightPhysics exchange section moves out (see F5).
  - `tests/ui-rules/flightHooks.test.ts`'s "one component owner" import scan becomes moot: the owner is the module.
- **Effort / risk:** M / Medium. **Priority:** P1.

## F4. Table geometry is a 12-field bag mixed with game state, fanned out field by field, and the layout is encoded twice
- **Files:**
  - `components/flightPhysics.ts`: 262-325 (`TableGeometry`, `SeatPlace`, `anchorPoints`, `floatTop`, `flightOrigin`), 551-575 (`ThrownPlayInput`, `SeatGeometry`), 610-612 (`seatPoint`).
  - `components/GameTable.tsx`: 686-699 (`seatGeometry`, rebuilt each render), 859 (`...seatGeometry` spread into `usePileFlight`), 902.
  - `components/table/pile.tsx`: 584-612 (14 own fields plus 12 inherited = 26 inputs), 715-728 (re-assembles the object inside the effect), 799-825 (25-entry dependency array).
  - `components/table/deal.tsx:26-28, 55, 72-76`; `components/table/dealSlots.ts:25-29`; `components/table/ExchangeLegs.tsx:176, 210, 266`.
  - Flex layout that mirrors the model: `components/table/chrome.tsx:170-216`.
- **What's wrong:**
  - `SeatGeometry` mixes frame geometry (scale, window, table edges, surplus, bottomPad, handCardH) with game state (players, opponents, viewerSeat).
  - `ThrownPlayInput`'s own doc (flightPhysics.ts:560-565) says the fields are spread because naming a per-render object inside an effect trips `exhaustive-deps`. The interface shape is a workaround for missing memoisation.
  - `anchorPoints` is recomputed from scratch in GameTable, `readThrownPlay`, and every `seatPoint` call (deal per side, sweep, each exchange leg end).
  - The model hard-codes what flexbox does: left seat x = `tableLeft + Spacing.sm + ring/2` (306) mirrors `sideSection.paddingHorizontal: Spacing.sm` plus `alignItems: flex-start` (chrome.tsx:192-198). Two encodings of one layout, kept honest only by e2e (`flightOrigin.spec.ts`, `lampSeats.spec.ts`, `seatAnchorsScenario`).
  - `tableProportions.test.ts:111-114` regex-matches `bottom: frame.surplus,` in GameTable source for the same reason.
- **Proposed interface:**
  ```ts
  // components/tableLayout.ts (pure; built once per (frame, scale, window) in a useMemo)
  export interface TableLayout { scale: number; window: {w:number;h:number}; frame: TableFrame; handCardH: number;
    anchors: Record<FlyDirection|'pile', Point>; seatPoint(dir: FlyDirection): Delta; floatTop: number;
    boxes: { table: Insets; top: Rect; left: Rect; right: Rect; centre: Rect; hand: Rect } }
  export function tableLayout(i: { width: number; height: number; insets: Insets; scale: number }): TableLayout;
  // game state travels separately:
  export interface Seating { viewerSeat: number; seats: number; dir(seat: number): FlyDirection; opponents: OpponentArrangement<Player> }
  ```
  - `usePileFlight({ ...state, layout, seating, ... })`: the dependency list goes from 25 to about 12.
  - Optional second step (L, high risk): render the top, side and centre sections at `layout.boxes` (absolute) so flexbox and the model cannot disagree.
- **Dependency category:** in-process.
- **Effect:**
  - About 60 lines of field-forwarding go across GameTable, pile, deal, dealSlots and ExchangeLegs.
  - One anchors computation per render.
  - `TableLayout` becomes the test surface for "the lamp, the throw and the deal aim at laid-out places" in node.
  - With the optional step, the "model and flex disagree" bug class is gone, and `flightOrigin` and `lampSeats` shrink to one flexbox witness each. The `tableProportions` source regex is replaced by asserting `layout.boxes.table.bottom === frame.surplus`.
- **Effort / risk:** M (object) or L (absolute boxes) / Medium, then High. **Priority:** P1 for the object, P2 for the boxes.

---

# P2

## F5. `flightPhysics.ts` is a grab bag whose name misleads, guarded by an import-ownership scan
- **Files:** `components/flightPhysics.ts` (650 lines, 7 unrelated sections); `tests/ui-rules/flightHooks.test.ts`.
- **Sections:**
  - Exchange arrival and landing wobble: 18-65
  - Impact tiers, shake, flinch, flare: 67-256
  - Table anchors: 258-325
  - `comboKey`, trick closed, `passedSeats`, `seatsJustPassed` (game-state derivation): 327-400
  - Exchange view and hand arrival: 402-534
  - Thrown plays: 536-612
  - Jokers and exchange legs: 614-650
- **What's wrong:**
  - Low cohesion; the name misleads on half its contents. `flightHooks.test.ts` pins "each helper has one component owner" by regex over import lines, which is a substitute for module boundaries.
  - Real duplication: `readThrownPlay` 588-594 and `readExchangeLegs` 630-633 carry the identical "own hand slot, else `HAND_SCALE/FIELD_SCALE` at the seat" expression. The fan branch is the same at 596-597 and 635-636.
- **Proposed split:**
  - `impact.ts`: tiers, trauma, flinch, shake, flare, `landWobble`.
  - `tableLayout.ts`: anchors (F4).
  - `passes.ts`: `comboKey`, `trickClosedWithWinner`, `passedSeats`, `seatsJustPassed`. Arguably `lib/game/`.
  - `exchangeView.ts`: F3.
  - `throws.ts`: `readThrownPlay`, `readExchangeLegs`, sharing `cardStart(layout, seating, seat, card?, handOrigins?) => CardFrom & {face:boolean}`.
- **Dependency category:** in-process.
- **Effect:**
  - `flightHooks.test.ts` is deleted.
  - Each test file in `flightPhysics.test.ts` maps to one module.
  - One `cardStart` replaces two copies; a fix to the hand-slot fallback cannot land in one leg type and not the other.
- **Effort / risk:** S-M / Low. **Priority:** P2.

## F6. Opponent seats: two near-identical slot components rendered three times with 13 identical props
- **Files:**
  - `components/table/seats.tsx:601-665` (`TopOppSlot`) and `777-846` (`SideOppSlot`). The bodies differ only in wrapper style, the `side` prop and `anchor`.
  - `components/GameTable.tsx:1426-1442, 1450-1467, 1531-1548`.
  - Also `wentOut` is decided twice: `GameTable.tsx:471` and `seats.tsx:198-200`.
- **What's wrong:**
  - The slots' 12-prop interface is as big as their bodies (shallow).
  - GameTable repeats the same 11-13 prop expressions per seat (`onMove(seat)`, `seatCount(...)`, `deal.arrivalsFor(seat)`, `passed.includes(seat)`, `vacatedOf`, `disconnectedSeats[seat]`, `seatCountdown`, `focusMode`, `seatMark(seat)`). About 60 lines of JSX that must change in three places.
- **Proposed interface:**
  ```ts
  export const OpponentSeat = memo(function OpponentSeat(p: { side: OpponentSide; seat: SeatView; scale: number; focusMode: boolean; countdown?: SeatCountdown; flash: SharedValue<RingFlash> }));
  interface SeatView { seat: number; player: Player; isActive: boolean; cardCount: number; passed: boolean; vacated: boolean;
    reconnecting?: {seconds:number; resetKey:string}; dealArrivals?: DealArrivals; marked: boolean }
  // GameTable: const seatView = (o) => ({...}) built once; render {(['top','left','right'] as const).map(side => ...)} into the three section boxes
  ```
  - Primitives stay primitive, so the memo still holds.
- **Dependency category:** in-process.
- **Effect:**
  - About 70 lines removed from seats.tsx and about 60 from GameTable.
  - "Fixed the top seat, forgot the sides" becomes impossible.
  - Seat tests (`seatDimming`, `seatLowCount`, `seatReconnectClock`, `seatFinishTrophy`) can mount `OpponentSeat` directly instead of a whole table.
- **Effort / risk:** S / Low. **Priority:** P2.

## F7. Three hand-rolled countdowns; the seat ring and the turn chip show the same window from independent clocks
- **Files:**
  - `components/table/notices/hud.tsx:94-137` (`TurnChip`: render-time reset on `resetKey|seconds|active`, `setInterval` decrement, freeze).
  - `components/table/notices/seatMarks.tsx:32-53` (`ReconnectingMark`: same reset pattern, `setInterval`).
  - `components/table/seats.tsx:278-319` (`CountdownRing`: `Date.now()` elapsed accumulation in a ref, `withTiming(leftMs)`, held).
  - GameTable builds the two `resetKey`s separately: 1110 and 1246.
- **What's wrong:**
  - The same concept ("a server window of N seconds, restarted by a key, optionally held") is implemented three ways.
  - GameTable's comment (1086-1094) says the ring "sweeps over the same window the viewer's chip counts down". The two run on unrelated timers (interval ticks against an animation duration plus `Date.now` accumulation), and their hold semantics are implemented separately.
- **Proposed interface:**
  ```ts
  export function useCountdown(o: { seconds: number; resetKey: string; running: boolean; held?: boolean; onExpire?: () => void })
    : { left: number; elapsedMs: () => number; startedAt: number };
  ```
  - The ring drives its `withTiming` from `seconds*1000 - elapsedMs()`; the chip and the mark render `left`.
  - Pure core: `countdownStep(state, now)`.
- **Dependency category:** local-substitutable (clock: inject `now`).
- **Effect:**
  - About 60 lines are replaced by one tested hook.
  - The chip and ring cannot drift by construction. Hold and reset semantics are fixed once (a `held` mark for the reconnect window becomes a one-line decision instead of new code).
  - `seatTurnClock`, `seatReconnectClock` and `clockCrossFade` keep working; a node test of `countdownStep` covers held, resumed and reset.
- **Effort / risk:** M / Medium (animation timing). **Priority:** P2.

## F8. Hand-written memo comparators, with a source-parsing test to keep them complete
- **Files:**
  - `components/CardView.tsx:651-674` (`cardViewPropsEqual`, 20 fields).
  - `components/table/hand.tsx:568-600` (`cardItemPropsEqual`, 29 fields).
  - `tests/native/cardMemoComparators.test.tsx` parses `interface X {…}` out of source (17-22) and keeps a hand-maintained `VALUES` table.
- **What's wrong:**
  - Both comparators are shallow equality except for `card` (compared by id) and two mount-only props.
  - Adding a prop and forgetting a line is a silent stale-card bug. The guard is a regex over interface text that breaks if the interface is restyled (e.g. `type` instead of `interface`, or a prop on one line with another).
- **Proposed interface:**
  ```ts
  // lib/memo.ts
  export function propsEqualExcept<P extends object>(by: { [K in keyof P]?: ((a: P[K], b: P[K]) => boolean) | 'ignore' })
    : (a: P, b: P) => boolean; // iterates the union of both objects' keys; Object.is for the rest
  export const cardViewPropsEqual = propsEqualExcept<CardViewProps>({ card: (a, b) => a.id === b.id });
  export const cardItemPropsEqual = propsEqualExcept<CardItemProps>({ card: (a,b)=>a.id===b.id, dealDelay: 'ignore', deal: 'ignore' });
  ```
- **Dependency category:** in-process.
- **Effect:**
  - About 55 comparator lines are deleted, and so is the source-parsing test, replaced by a 5-case unit test of `propsEqualExcept`.
  - A new prop is compared by default, so the forgotten-line class is gone. `handMemo` and `handMemoTable` still pin the behaviour.
- **Effort / risk:** S / Low (check the React Compiler accepts it; `tests/ui-rules/reactCompiler.test.ts`). **Priority:** P2.

## F9. `CardItem` has 30 props, a boolean disguised as a number, and two "deal" mechanisms
- **Files:** `components/table/hand.tsx`
  - Props: 175-243.
  - `dealDelay` / `dealing` / `DEAL_DURATION_MS` / `DEAL_EASING`: 96-97, 310-337, 1355.
  - `deal` / `dealClock` / `dealAt`: 315-320, 1356.
  - `pose(...)` called with 8 positional args three times: 451, 471, 482.
- **What's wrong:**
  - `dealDelay` is documented as "ms to wait, or -1", but its only caller passes `descending ? 0 : -1` (1355). It is a boolean, and `dealDelayRef`/`withDelay` always wait 0.
  - The "deal" names cover two different motions: the exchange card's descent (500 ms literal) and the real deal (on `deal.clock`). `pose()` branches between them.
  - The interface is nearly as large as the body (shallow). The placement props (left, bottom, arcRot, restX, restY, shiftX, hitW, zIndex, cardW, cardH) are all outputs of F2's layout.
- **Proposed interface:**
  ```ts
  interface CardItemProps { card: Card; place: HandCardPlace; size: {w:number;h:number;scale:number}; entry: CardEntry | null;
    interaction: { store; shown; pressed; onActivate; disabled; a11yActions?; onMove?; hint? }; giveable?: boolean;
    received?: boolean; hidden?: SharedValue<string[]>; rects?: HandRow; onDrawn?; faceDown?: boolean; isStartCard: boolean }
  type CardEntry = { kind: 'deal'; clock: SharedValue<number>; leaveMs: number; from: Delta; onDealt } | { kind: 'descend'; from: Delta };
  ```
  - `pose` becomes `poseOf(entry, state, now)` with one call site feeding style, rect and the landing reaction.
- **Dependency category:** in-process.
- **Effect:**
  - The props become about 12 grouped values, and the comparator shrinks (pairs with F8).
  - The descend duration moves to `Motion` (`Motion.exchange.*`) instead of a component literal.
  - "Card dealt with the descent's timing" becomes unrepresentable.
- **Effort / risk:** M / Medium. **Priority:** P2 (do it with F2).

## F10. Turn presentation: two parallel 5-way ternaries and two `turnTimerActive` calls in GameTable's JSX
- **Files:**
  - `components/GameTable.tsx:1223-1242` (`chipText` and `spokenSeat`: identical ladders, different keys).
  - 1039-1050 (`timerActive`), 1054-1058 (`turnToken`), 1095-1111 (`seatCountdown`), 1110 and 1246 (`resetKey` concatenated twice), 1082-1084, 1156 (`onMove`).
- **What's wrong:**
  - This is pure presentation logic inline in render. A branch added to one ladder and not the other makes the screen-reader sentence diverge from the chip.
  - The two timer questions differ only in three inputs.
- **Proposed interface** (`components/turnTimerUi.ts`):
  ```ts
  export function turnPresentation(i: { roundOver: boolean; matchOver: boolean; dealing: boolean; viewerOnMove: boolean; onMoveName: string;
    exchangeChip: string|null; isMyTurn: boolean; isFinished: boolean; isNewTrick: boolean; exchangeActive: boolean;
    timer?: TurnTimerConfig; holdingForStart: boolean; held: boolean; turnToken: string })
    : { chip: { key: TranslationKey; params?: object; spokenKey: TranslationKey }; clock: { active: boolean; resetKey: string; seconds: number }; seat?: SeatCountdown };
  ```
- **Dependency category:** in-process.
- **Effect:**
  - About 50 lines out of the JSX.
  - A node test table replaces the native mounts that today pin the chip text (`matchTurnChip`, `dealTurn`).
  - The chip and the sentence share one decision.
- **Effort / risk:** S / Low. **Priority:** P2.

## F11. Notice float, opening gate and veils are state machines written as render-time `setState`
- **Files:** `components/GameTable.tsx`
  - Float: 585-614, with `raised` at 199-204.
  - Opening gate: 412-433, 1113-1119.
  - Veils: 435-453.
  - Source-scan test: `tests/ui-rules/gameTableVeil.test.ts:85-127`, which finds the "root children" by **indentation** (`/^ {6}<Animated\.View style=\{\[styles\.kick/`, children "at eight spaces") and matches exact spellings such as `\{\.\.\.clockVeil\}`.
- **What's wrong:**
  - The float reducer tracks four "last seen" values (`passSeen`, `errorSeen`, `autoSeen`, `withdrawnSeen`) inline. Its only tests are native mounts (`passMarker`, `onlineErrorFloat`, `offlineAutoPass`, `onlineAutoPass`).
  - The veil decision is five booleans with long comments. Its guard parses JSX by whitespace, so re-indenting or wrapping GameTable breaks the test without any behaviour change.
- **Proposed interface:**
  ```ts
  // components/table/tableFloat.ts
  export function nextFloat(prev: FloatState, i: { state: PassView; error: ServerError|null; autoPassed: number; withdrawn: boolean;
    viewerSeat: number; spectating: boolean; text: { passed: string; autoPass: string } }): FloatState;
  // components/table/tableVeils.ts
  export type VeilRole = 'table' | 'sheetOnly' | 'coverOnly' | 'clock';
  export function tableVeils(i: { settingsOpen: boolean; covered: boolean; portrait: boolean; holdingForStart: boolean }): Record<VeilRole, boolean>;
  export function VeilRegion(p: { role: VeilRole | 'none'; reason?: string; children }): JSX.Element; // the one place a11yVeiled is spread
  ```
  - `gameTableVeil.test.ts` then asserts that every direct child of the game layer is a `<VeilRegion>`, either by keying on that tag instead of indentation or by a native test rendering with `settingsOpen` and walking `UNSAFE_root`.
- **Dependency category:** in-process.
- **Effect:**
  - About 60 lines of render-phase logic become two tested pure functions.
  - The whitespace-sensitive scan goes away. The veil reasons live beside the roles instead of in a test-file map (`REACHABLE_ON_PURPOSE`, `VEILED_ON_ITS_OWN_TERMS`).
- **Effort / risk:** M / Medium (the a11y invariants in components/CLAUDE.md). **Priority:** P2.

## F12. OS orientation lock lives in the table component
- **Files:**
  - `components/GameTable.tsx:20, 155, 209-212, 958-993` (`lockAsync`, native `holdLandscape`, one-second relock while upright, `transitionEnd` relock, unlock on unmount).
  - `lib/device/orientation.tsx` already owns `useOrientedWindow` and `usePortraitInterface`.
- **What's wrong:**
  - A true-external dependency (UIKit/Android orientation plus a custom native module) is driven from inside the presentational table. The adapter's quirks (#1211, #1378) sit next to card logic.
  - It is the only `ScreenOrientation` use in `components/`.
- **Proposed interface:** `export function useLandscapeLock(navigation?: NavigationLike): void` in `lib/device/orientation.tsx`.
- **Dependency category:** true-external (mock at the seam).
- **Effect:**
  - About 40 lines and 3 imports leave GameTable.
  - `orientationFirstRender.test.tsx` and `orientationRows.test.tsx` can target the hook, and future orientation fixes do not touch GameTable.
- **Effort / risk:** S / Low. **Priority:** P2.

## F13. Source-scan tests that pin implementation details or have decayed
Each maps to the refactor that replaces it.
- **`tests/ui-rules/gameTableVeil.test.ts`:** an indentation-based JSX parser. Replaced by F11.
- **`tests/ui-rules/tableProportions.test.ts:111-114`:** regex `bottom: frame\.surplus,` against GameTable. Replaced by F4.
- **`tests/ui-rules/flightPhysics.test.ts`:**
  - 746-751 regex-matches lambda shapes `useLandingReaction\(signal, \(l\) => \{[^}]*flinchFor\(l\.tier`. Renaming `l` fails it with no behaviour change. `pileFlinch.test.tsx` and `screenShakeSetting` already pin the behaviour.
  - 753-757 scans pile.tsx for 7 callee names. 6 of the 7 (`playImpact`, `shake`, `burst`, `setFlinchTier`, `setFlinchTrigger`, `setFlightLanded`) no longer exist in pile.tsx, so only `celebrateGoingOut` is still checked. `tests/ui-rules/oneClock.test.ts` is the general guard.
- **`tests/ui-rules/flightHooks.test.ts`:** import-ownership regex. Replaced by F5.
- **`tests/native/cardMemoComparators.test.tsx`:** interface-text parse. Replaced by F8.
- **`tests/ui-rules/handTurnScale.test.ts:48-66`:** re-implements production layout. Replaced by F2.
- **`tests/ui-rules/handLayout.test.ts:185-221`:** tests `cardAtX`, which production does not call (F2).
- **Effect:** about 6 brittle tests deleted or rewritten against real modules. **Effort / risk:** follows each refactor. **Priority:** P2.

---

# P3

## F14. Platform branches scattered instead of behind one seam
- **The web overflow-clip quirk (a focused child scrolls a `hidden` box)** is written twice with two different casts: `GameTable.tsx:169-170` (`WEB_CLIP`, cast via `unknown as ViewStyle`) and `hand.tsx:1431` (`"clip" as "hidden"`).
- **The "iOS cannot grey a view with a filter" quirk** is split between `greyLayer.tsx:8-14` and `useLinkHold.ts:15-17, 76-80`, plus the `grey` prop doc at `feltCanvas.tsx:50`. `feltCanvas.tsx:57`'s `IOS` is a different quirk (opaque Skia).
- **The haptics capability** (`Platform.OS !== "web"`) is restated in `SettingsModal.tsx:266` and `settingsSheet.tsx:304`.
- **Web-only `dataSet` casts** in `seats.tsx:489` and `seats.tsx:737` bypass the existing `harnessState` helper (`chrome.tsx:26`).
- **Proposed:**
  - `lib/platform.ts`: `export const clipOverflow: ViewStyle | null;` and `export const viewFilterGrey: boolean;`.
  - `hapticsAvailable` exported from `lib/device/feedback.ts`.
  - A `harnessData(state)` usable on Text and View.
- **Dependency category:** true-external (platform).
- **Effect:** one place per quirk (about 8 sites); a new surface cannot get the cast wrong. **Effort / risk:** S / Low. **Priority:** P3.

## F15. `useTableFeedback` recomputes the round and match outcome GameTable already has
- **Files:**
  - `components/GameTable.tsx:800-801, 811-829`: passes `finishingOrder`, `players`, `isTeamMode`, `placementPoints`, `viewerId`, `matchOver`, `matchWinners`.
  - `components/useTableFeedback.ts:324-358`: `roundOutcomeFor` and `matchOutcomeFor` again.
  - Its "decided" guard (352: every finisher scored, in any mode) differs from `roundOutcomeFor`'s team-only `pending` (`lib/game/matchState.ts:115`), which drives the visual `useRoundOutcome`.
- **What's wrong:**
  - The 17-input interface exists to rebuild a value the caller holds.
  - The sound and the visuals decide "outcome known" by different rules in two files. This is not shown to be a bug, but it is a locality problem.
- **Proposed:** `useTableFeedback({ ..., outcome: RoundOutcome, matchOutcome: RoundOutcome, scored: boolean })`, with `scored` decided once next to `roundOutcomeFor`.
- **Effect:** 7 inputs drop to 3; one rule for "decided". **Effort / risk:** S / Low. **Priority:** P3.

## F16. Score pill and match-board derivation in GameTable
- **Files:** `GameTable.tsx:637-643` (`pillAnchor`), 654-671 (`matchBoard`), 675-684 (manual hit test against `scorePillHitBox`), 1278 and 1294 (vote spots).
- **What's wrong:** pure geometry and labels sit in the component, beside the existing `components/table/scorePillModel.ts` and `lib/game/scorePill.ts`.
- **Proposed:**
  - `pillAnchorFor(layout: TableLayout): PillAnchor` and `voteTop(anchor, open, scale)` in scorePillModel.
  - `matchBoardFor(standings, players, winners, score, t)` in `lib/game/scorePill.ts`.
- **Effect:** about 45 lines become node-testable (`scorePillGeometry` and `scorePillStandings` already exist to extend). **Effort / risk:** S / Low. **Priority:** P3.

## F17. `getComboLabel` is a pure label function living in a component, with a lossy key type
- **Files:** `components/table/pile.tsx:349-356, 565-576`, imported by `GameTable.tsx:132, 1065`.
- **What's wrong:** `Record<string, TranslationKey>` loses exhaustiveness; an unknown type falls back to the raw `combo.type` string on screen.
- **Proposed:** move it to `components/table/spokenLabels.ts` (beside `lastPlayLabel`) as `Record<Combination["type"], TranslationKey>`.
- **Effort / risk:** S / Low. **Priority:** P3.

## F18. Animation-lifetime boilerplate
- **Files:** 55 `cancelAnimation(` calls across components (`useTableFeedback.ts` 10, `hand.tsx` 9, `seats.tsx` 7, `moments.tsx` 7, `pile.tsx` 6, …). 11 of them are the exact `useEffect(() => () => cancelAnimation(x), [x])` shape. `hand.tsx:388-399` cancels 7 values by hand.
- **Proposed:** `useOwnedValue<T>(init: T): SharedValue<T>`, a shared value cancelled on unmount.
- **Effect:**
  - About 25 cleanup effects removed, and "forgot to cancel" becomes structural.
  - `tests/ui-rules/infiniteAnimations.test.ts` can accept the owned hook as the cancellation.
- **Effort / risk:** S / Low. **Priority:** P3.

---

# Already deep: leave alone
- **`components/table/trick.ts`:** one view of a card from throw to sweep; small pure interface (`playOnto`, `sweepTrick`, `clearTrick`, `roleOf`, `topPlay`).
- **`components/table/tableTimeline.ts`, `useFlightClock.ts`, `useLandingReaction.ts`, `useBombBeat.ts`:** the single landing clock and `LandingSignal` seam. Every consumer (pile flinch, shake, lamp, particles, BombBurst/BombFlash) reacts through one hook.
- **`components/table/TableNotice.tsx` with `noticeModel.ts` and `NoticePalette` (`lib/tokens.ts:283`):** a six-prop painter driven by a kind/shape/tone model. `notices/` only lays out.
- **Pure models with their own node tests:**
  - `components/table/scorePillModel.ts`, `cardRects.ts` with `useCardRects.ts` (registry), `cardShadows.ts`.
  - `components/tableFrame.ts`, `seatLayout.ts`, `fanGeometry.ts`, `tableArc.ts`, `flightPose.ts`, `handOrder.ts`, `tableA11y.ts`.
  - `components/table/dealPose.ts`, `dealSlots.ts`, `lampRig.ts`, `particles.ts`, `spokenLabels.ts`.
- **`components/table/selection.ts`, `useSelection.ts`, `selectionLeaves.tsx`:** an external store, so a tap re-renders only the leaves. `stagedPlay.ts` is deep apart from F1.
- **The `.web.tsx` file-extension seam** (`feltSkia`, `handShade`, `particleLayer`, `FoilMask`): the right pattern for platform divergence; F14 asks the stragglers to follow it.
- **`GameTableProps` as a seam:** four adapters make it real. Deepen behind it rather than widen it.
- **`lib/tokens.ts`:** `Motion` with `Motion.reduced` and `motionMs`, `Reading`, `Hold`, `Layer` and `Trauma` are role-named, with the reduced form centralised. The only wart is `motionMs`'s special-case branch for the off-ladder `beaten` and `handResize` (tokens.ts:658-661), which is minor.

# Considered, not recommended
- **SettingsModal's three account flows** (bug report, logout, delete; `components/SettingsModal.tsx:94-188`) rhyme, but they differ in success action and error surface. This is the same shape CONTEXT.md recorded as rejected for the auth screens (2026-09-10).
- **Merging `GameSettingsSheet` and `SettingsModal`:** different scopes (table-session toggles against account preferences). Only the haptics capability is shared, which F14 covers.
- **A reducer for `usePileFlight`'s trick-hold, tag and flight bookkeeping** (pile.tsx:655-882): the interleaved timers and `timeline` side effects resemble the online-context reducer CONTEXT.md recorded as rejected. F4 already removes most of its interface width; revisit only after F4.

# Suggested order
F1 (S) → F12, F6, F17 (S) → F4 object → F2 with F9 and F8 → F3 with F5 → F10, F11 → F7 → P3s. Delete the F13 tests in the same PR as each replacement.
