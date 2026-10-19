# 16 — Named table situations reached through the engine (review card 5, prefix SCEN)

## 1. Verdict: do part of it

- **Do:** the capture states (`lib/captureStates.ts`, 13 states that ship in `app/capture.tsx`, are walked by
  10 e2e specs and are shown by 2 bench scenarios). Each becomes a real deal plus a short scripted move list played
  through ENG-5's `startRound` and ENG-6's `applyMove`. Also do TEST-8's `exchangeSave` preset, which
  becomes `startRound`'s exchange opening.
- **Why:** at MAIN, every pile state says `passCount: 0` while the table derives two passes from it. All four
  count states leave cards in no hand and on no pile, and no state has `playedRanks`. After the plan, WIRE-1,
  WIRE-3 (not in its file list) and WIRE-4 would each have to make up engine fields for this production file. One
  L ticket deletes the hand builder and that later work. Situation states then pass `parseGameState`
  without anyone working to make them pass.
- **Do not:** route TEST-1's `state()`, the e2e opener's re-deal loop, `benchTable`'s random tables or
  `redealExactly` through situations. Unit tests and the ENG-7/WIRE-3 restore refusals need states no deal
  reaches. The opener needs a *random* deal that the viewer opens. The bench and `redealExactly` already go
  through the engine's deal.
- **Cost:** one L ticket (~$70) plus one owner look at the re-shot iOS captures. No engine change, no rule change.
  Amendments drop `lib/captureStates.ts` from WIRE-1 and WIRE-4.

## 2. The shape that hurts after the plan (pointers at MAIN `a1d0ebb5`)

**A production fixture that builds `GameState` by hand.**
- `lib/captureStates.ts:227-263` (`captureGameState`) builds the literal itself. `:254` gives `passCount: 0`,
  `:261` gives `firstPlayMade: true` while every hand is still full, and nothing sets `playedRanks`.
- `:243` (`dealt[seat].slice(0, held)`) makes the count states drop cards: `counts-2-13-2` loses 23 cards
  that are in no hand, on no pile and in no tally.
- `:232` sets the pile to the seat *after* the one on move. Turn order is decreasing
  (`lib/game/gameEngine.ts:822-830`), so for the play to have reached the seat on move, the two seats in
  between must have passed.
  - `passedSeats` (`components/flightPhysics.ts:376-397`) does draw those passes: for `play-right-landed`
    and `bomb-landed` it returns seats 0 and 3.
  - `passCount` still says 0, and the label ("Drita's turn after Luan's combination", `:107`) does not
    mention them.
  - This has happened before: commit `985ba364` found `pile-right`'s pile flying from the wrong seat, and
    only on a device.
- `:207-217` (`takeOfARank`) and `:185-197` (`hands`, `heldAt`, `COUNT_SEAT`) exist only to keep a
  fabricated deal self-consistent. The `:200-206` comment records a bug that the fabrication itself caused
  ("silently left the felt empty").

**Who reads it.**
- `app/capture.tsx:71` reads it on the device.
- `tests/e2e/helpers/offlineSeed.ts:157-164` (`openCaptureState`) writes it into an offline save. Ten
  specs import it: `lampSeats`, `seatsDoNotMove`, `mockupPolish`, `feltIdle`, `feltNap`,
  `cardGlowParity`, `cardShadowParity`, `lampLegibility`, `seatNameContrast` and `helpers/feltParityGrid`.
- `lib/diagnostics/scenarios/{lampVariants,seatAnchors}.ts` read it on the bench.
- `tests/tooling/{captureStates,iosShards}.test.ts` and `tests/native/captureScreen.test.tsx` test it.

**Planned tickets that would each fabricate a field here** (INTEGRATED §3):
- **WIRE-1** lists `lib/captureStates.ts`. It has to make up a `lastMove` for each pile state, including a
  seat and a `seq`, for moves that never happened.
- **WIRE-3** makes `playedRanks` required and parses every save. `captureGameState` returns `GameState`, so
  `tsc` will force an edit in a file WIRE-3 does not list. `openCaptureState`'s saves then go through
  `parseGameState`.
- **WIRE-4** lists it, to turn `firstPlayMade: true` into a made-up `openingCard: null`.
- **TEST-8's `exchangeSave`** (09-test-harness §4.4) builds an `exchangePhase` with `state()`. WIRE-5's
  union then reshapes it in the e2e helper as well.

**What is fine as it is.**
- `lib/e2eOpener.ts:13-16` loops a real deal. The loop ends with probability 1, needs about four deals
  at four seats, and 03-time already decided to leave it. ENG-5 moves it onto `startRound`.
- `lib/diagnostics/benchTable.ts:5-36` makes random real deals. ENG-7 removes its valve call.
- `tests/helpers/liveGame.ts:44-80` (`redealExactly`) already passes a deal through the engine.

## 3. Alternatives

- **A. The whole card.** Situations would serve captures, the opener, the bench, TEST-8 presets, native tests
  and `state()`. Rejected for three reasons:
  - `state(over)` exists so that a unit test can state the one thing it is about, and the ENG-7, WIRE-3 and
    parser tests *need* unreachable states (an empty-winner exchange, a malformed tally).
  - The opener needs a random deal for the Maestro flows.
  - The bench is already engine-built.
- **B. Status quo with amendments.** WIRE-1, WIRE-3 and WIRE-4 each list `captureStates.ts`, and a consistency
  test checks the fabricated fields. Rejected: that test would restate the engine's pass, opening and tally
  rules, which makes a second copy. Each shape ticket would still invent semantics, such as the right
  `lastMove` for a pass nobody made.
- **C. Short `dealt` hands plus one or two moves.** `startRound` checks only seat count and uniqueness
  (`gameEngine.ts:1125-1137`). Authoring is cheaper, but the count states still lose cards, so "reached" would
  be a half-truth, and a later card-conservation check in `parseGameState` would refuse them.
- **D. Picked: real deals, filled to real sizes, plus scripted moves.** Captures and the one e2e preset that
  mirrors an engine opening use them. Straights run 5 to 13 cards, so even `counts-2-1-2` is a script of
  about a dozen moves.

## 4. Target design

**Module.** `lib/situation.ts` is new and production-safe. It is pure, uses relative extensioned imports
and imports no react-native, so the capture screen, node, jest and Playwright all load it. It hides the
deal fill, `startRound`, the `applyMove` fold and the validity checks behind one call.

```ts
export type Step =
  | { seat: number; play: string }        // space-separated card ids, e.g. "3_spades 4_spades …"
  | { seat: number; pass: true }
  | { seat: number; giveback: string };
export interface Situation {
  seats: 2 | 3 | 4; mode: GameMode; firstSeat?: number; opening?: Opening;  // ENG-5's Opening
  holding: Partial<Record<number, string>>;   // only the cards the script needs; the rest is filled
  moves: readonly Step[];
}
export function dealOf(s: Situation): Card[][];          // deterministic fill to the real deal sizes
export function reach(s: Situation): GameState;          // startRound, then applyMove per step
export function reachSteps(s: Situation): GameState[];   // every intermediate state, for tests
```

- `dealOf` keeps each seat's `holding` and deals the rest of the deck in `createDeck` order, round-robin
  from `firstSeat`, until each seat has the size `dealCards` would give it. That is 14/14/13/13 at four
  seats and 18 each at three. At two seats it is 14 each, with the other 26 undealt. It throws if the
  `holding` lists overlap or overfill a seat.
- `reach` throws on the first refused step. The error names the step index and the engine's
  `MoveRefusal`, so a rule or shape change that makes a script illegal goes red in the node test that walks
  every situation.
- `lib/captureStates.ts` keeps its public contract unchanged: ids, `label`, `playerCount`, `turn`, `side`,
  `pile`, `counts`, `link`, the four lists and `captureStateById`. Each entry gains a `situation`, and
  `captureGameState(state)` becomes `reach(state.situation)` with the capture names (`Ana`, bots from
  `BOT_PERSONALITIES` per HYG-2) applied to `players[].name` only.
  - Situations may share a deal and differ only in how long their script runs: the lamp states are the trick
    leads of one scripted round.
- `exchangeSave` (TEST-8, `tests/e2e/helpers/offlineSeed.ts`) builds its state with
  `reach({ opening: { kind: "exchange", winnerSeat, loserSeat }, … })`. It adds a scripted giveback only
  when the preset names one.

**Invariants**
- Every state a situation yields is one the engine wrote. The deal is a real deal's sizes, every field
  comes from `startRound`/`applyMove`, and hands plus `playedRanks` plus the undealt cards add up to the deck.
- The tooling test still pins each capture's stated properties against the reached state: `side` against
  `seatDirection`, `counts`, `turn`, `pile`, the bomb, and `passedSeats` for `passed`. The labels name the
  moves.
- The two capture knobs (`swing`, `rethrow`; `app/capture.tsx:103,112`, `lib/captureStates.ts:266-278`) stay
  display-only perturbations. They live in the screen's local state, never reach a save or the engine,
  and exist to replay an animation for a photograph (D-SCEN-2).
- `state()` in `tests/support/game.ts` stays the unit-test literal. Unreachable states are built there on
  purpose and nowhere in production code.

**Deleted:** the `GameState` literal in `captureGameState`, `takeOfARank`, `hands`, `heldAt`, `COUNT_SEAT`, the
`:200-206` and `:176-184` explanations of the fabrication, and `exchangeSave`'s hand-built `exchangePhase`.

## 5. Migration (one PR, each commit green except the marked red one)

1. **Red:** add two tests to `tests/tooling/captureStates.test.ts`. Both fail at MAIN's builder.
   - (a) Every pile state's `passCount` equals `passedSeats(...).length`. MAIN gives 0 against 2.
   - (b) For every state, hand sizes plus `sum(playedRanks)` plus pile cards equal the deal size. MAIN has no
     `playedRanks`, and the count states drop cards.
2. Add `lib/situation.ts` and `tests/tooling/situation.test.ts`. Test a planted illegal step (it throws, naming
   the step and the refusal), a planted short deal, overlapping `holding` lists, and a round trip through
   `encodeOfflineSave`/`decodeOfflineSave` for every situation.
3. Re-express the 13 capture states as situations, keeping every existing assertion. The red tests turn green.
   Delete the builder helpers.
4. Rebase `exchangeSave` onto the exchange opening. The six `exchange*` specs stay green.
5. Run e2e `lampSeats`, `seatsDoNotMove`, `mockupPolish` and `exchangeAttribution`. Attach the `ios.yml`
   capture artifacts for the owner.

## 6. Owner decisions and amendments

**Owner decisions (defaults are recommended):**
- **D-SCEN-1. Captures become reachable.**
  - Opponent hand sizes shift by a card or two where a script plays.
  - Pile states carry the passes they always implied, so `passCount` now agrees with the PASSO marks the
    table already draws.
  - Labels name the moves (for example, "Luan plays a pair; you and Besnik pass; Drita on move").
  - *Default: accept.* The owner reviews the re-shot iOS captures in the PR.
- **D-SCEN-2. The swing and rethrow knobs stay display-only.** The alternative is to make each a real move,
  which would change hands between shots. *Default: keep them as they are.*
- **D-SCEN-3. The count states keep opponent counts exact.** The viewer's hand may be up to two cards short of
  a full deal where the script needs the viewer to win a lead. *Default: allow.*

No game rule question arises. Scripts play by the rules as they stand, and a refusal means the script is wrong.

**Amendments to planned tickets:**
- **WIRE-1:**
  - Add `SCEN-1` to blocked-by and drop `lib/captureStates.ts` from its files.
  - DoD gains "`lib/captureStates.ts` is not in the diff", because the engine writes captures' `lastMove`.
  - `lastMoveAgrees` may also walk `reachSteps` over every capture situation.
- **WIRE-3:**
  - DoD gains "every situation and `state()`'s default pass `parseGameState`". SCEN-1's round-trip test
    makes that check automatic once WIRE-3 lands.
  - No edit to `lib/captureStates.ts` is needed.
- **WIRE-4:** drop `lib/captureStates.ts` from its files.
- **WIRE-5:** no edit to `exchangeSave` (now `startRound`-built). Its files are unchanged, but the PR should
  confirm the preset was untouched.
- **ENG-5:** unchanged. `lib/e2eOpener.ts` moves onto `startRound` as planned, and its loop stays.

**Ordering:** SCEN-1 runs after ENG-6 and in parallel with ENG-7, and WIRE-1 waits for it. WIRE-1 sits about seven
waves off the critical path (WIRE-3 is wave 19), so the plan's length does not change.

## 7. Tickets

| ID | title | area | size | ledger IDs | files/modules | blocked by | label | owner-eye? |
|---|---|---|---|---|---|---|---|---|
| SCEN-1 | Named situations: captures and the exchange preset are reached through startRound and applyMove | test | L | review C5 | lib/situation.ts (new), lib/captureStates.ts, app/capture.tsx, tests/tooling/{situation (new),captureStates,iosShards}.test.ts, tests/e2e/helpers/offlineSeed.ts, tests/native/captureScreen.test.tsx | ENG-6, HYG-2, TEST-8 | ready-for-agent | yes |

## 8. Spec cards

### SCEN-1: Named situations: captures and the exchange preset are reached through startRound and applyMove (L)
- **Defect:** `lib/captureStates.ts` builds production `GameState` literals by hand.
  - Every pile state has `passCount: 0`, while `passedSeats` derives two passes from it.
  - The four count states leave cards in no hand, on no pile and in no tally.
  - No state has `playedRanks`.
  - WIRE-1, WIRE-3 and WIRE-4 would each make up engine fields here, and TEST-8's `exchangeSave` builds an
    `exchangePhase` by hand that WIRE-5 then reshapes.
- **Where:** `lib/captureStates.ts:185-263` (`hands`, `heldAt`, `takeOfARank`, `captureGameState`; `:232`
  pile seat, `:243` slice, `:254` `passCount`, `:261` `firstPlayMade`); `components/flightPhysics.ts:376-397`
  (`passedSeats`); `lib/game/gameEngine.ts:822-830` (decreasing turn order), `:1125-1137` (`dealt` checks);
  `tests/e2e/helpers/offlineSeed.ts:157-164` (`openCaptureState`) and `exchangeSave`.
- **Build:**
  - `lib/situation.ts` provides `Situation`, `Step`, `dealOf`, `reach` and `reachSteps`. It is pure,
    loadable by node, jest and Playwright, and imports nothing from `tests/`.
  - Each capture state gains a `situation`, and `captureGameState` becomes `reach(state.situation)` with the
    capture names applied. The lamp states share one scripted round.
  - Delete the literal, `takeOfARank`, `hands`, `heldAt` and `COUNT_SEAT`.
  - Labels name the moves (D-SCEN-1).
  - `exchangeSave` is built through `startRound`'s exchange opening.
- **Constraints:**
  - No engine or rule change. Scripts obey the rules; a refused step is a script bug.
  - Capture ids and the `CaptureState` fields are unchanged, because Maestro links, `iosShards` and the
    10 e2e specs key on them.
  - The swing and rethrow knobs stay display-only (D-SCEN-2).
  - In `app/capture.tsx`, every hook still runs before the null guard.
  - `dealOf` fills to `dealCards`' real sizes.
- **DoD:**
  - [ ] Red first: every pile capture's `passCount` equals `passedSeats(...).length` (0 against 2 at MAIN).
  - [ ] Red first: for every capture, hand sizes plus `sum(playedRanks)` plus pile cards equal the deal size.
  - [ ] A planted illegal step throws, naming the situation, the step index and the `MoveRefusal`. A planted
    short deal and overlapping `holding` lists throw too.
  - [ ] Every situation round-trips `encodeOfflineSave` → `decodeOfflineSave` unchanged.
  - [ ] `lib/captureStates.ts` has no `currentTurnIndex:` literal, and the four helpers have zero references.
  - [ ] All existing `captureStates.test.ts` assertions (side, counts, turn, pile, bomb, rethrow, swing) stay
    green, unchanged.
  - [ ] The six `exchange*` e2e specs pass on the rebased `exchangeSave`.
  - [ ] The PR lists each capture's hand counts before and after, and attaches the `ios.yml` capture
    artifacts; the PR is left for the owner.
- **Checks:** `node --test tests/tooling/situation.test.ts tests/tooling/captureStates.test.ts
  tests/tooling/iosShards.test.ts`; `npx jest tests/native/captureScreen.test.tsx --selectProjects ios`.
  Gate, plus e2e `lampSeats`, `seatsDoNotMove`, `mockupPolish` and `exchangeAttribution` with
  `E2E_SKIP_BUILD=1`.
- **Not this ticket:**
  - `state()` and unit-test fixtures (TEST-1).
  - The e2e opener's loop (ENG-5 keeps it).
  - `benchTable` and `redealExactly`.
  - `oneCardFromFinishing` (TEST-8).
  - Tutorial beats (CLI-8).
  - A card-conservation check inside `parseGameState`, which is possible only after this ticket.
- **Source:** architecture review card 5; this design §2–§5; INTEGRATED R5, ENG-5, ENG-6, WIRE-1, WIRE-3,
  WIRE-4, TEST-8.
