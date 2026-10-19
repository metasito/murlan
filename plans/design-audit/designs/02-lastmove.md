# 02 — lastMove: the record of what just happened

IDs: L-005, L-009, L-070, L-082, L-171. All line numbers are at MAIN (`a1d0ebb5` snapshot).

## 1. Summary

- **Now:** `GameState` stores where the game *is*, never what *just happened*. Eight consumers
  rebuild "the move" by diffing two states or reading the engine's write order
  (`trickClosedWithWinner`, `turnKey`, `seatsJustPassed`, two refs in `useTableFeedback`,
  `exchangeAnnouncementOf`'s `jokersBefore`, `armAfterMove(prev)`, two diagnostics scenarios). A
  test harness hunts collisions in a composite key. The table's demand on the seat on move is
  derived five times, from two fields (`startCard?` and `firstPlayMade`) that encode one
  obligation.
- **After:** every engine transition writes `GameState.lastMove`, a card-free union with a
  per-round `seq`. `GameState.openingCard: Card | null` replaces `startCard` and `firstPlayMade`,
  and `tableDemand(state)` is the one reader of what the table demands. `trickWinner` is deleted.
  Consumers read facts and stop inferring them.
- **Why:** the deletion test passes. `turnKey`, `trickClosedWithWinner`, `seatsJustPassed`, the
  collision harness, two refs, `jokersBefore`, `whatMustBeMet` and the `isNewTrick` parameter all
  go, and so does the class of bug where a reader depends on the order the engine writes fields.
  The cost is one protocol bump with a `MIN_PROTOCOL_VERSION` raise. The app is not live
  (CONTEXT/memory), so that costs nothing to players today.

## 2. Current shape (evidence at MAIN)

**The engine records state, not transitions.** `GameState` is at `lib/game/gameEngine.ts:85-114`.
Its transitions are `processPlay` (`:735`), `processPass` (`:784`), `processExchangeChoice`
(`:949`), `initializeRematch` (`:860`) and `initializeGame` (`:1106`). The stuck valve
`resolveStuckExchange` is in `lib/game/autoMove.ts:43-52`, outside the engine file. A refused
pass or giveback returns its input unchanged (`:788`, `:950`, `:955`, `:961`).

**Consumers rebuild the move:**

| Site | What it infers | How |
|---|---|---|
| `components/flightPhysics.ts:338-345` `turnKey` | "a move happened" | `${currentTurnIndex}\|${passCount}\|comboKey`. Used for the offline bot timer (`app/game.tsx:113-127`) and the turn clock's reset key (`components/GameTable.tsx:974`, `:1026`, `:1149`) |
| `tests/helpers/offlineMatch.ts:300-321`, `:340-346`, `:409-447` | that `turnKey` never collides | `computeBotTurnKey` is a *hand copy* of the screen's key, not an import, plus `handFingerprint`, `BotTurnKeyCollision` and the assertion in `tests/engine/matchTerminates.test.ts:35-49`, `:98-121`, `:150-157` |
| `components/flightPhysics.ts:354-363` `trickClosedWithWinner` | "a pass closed the trick" | `lastPlayedCombination === null && trickWinner != null`. This is correct only because `processPass` clears one field and sets the other in the same transition, and `processPlay` leaves `trickWinner` standing (`pile.tsx:828-830` says so) |
| `components/useTableFeedback.ts:267-308` | the pass sound and the trick-won sting | `prevPassCountRef` and `prevTrickClosedRef`. The comment at `:296-298` explains that `processPass` zeroes `passCount` on the closing pass |
| `components/table/pile.tsx:741`, `:833-842` | the felt hold and the trick-winner tag | `trickClosedWithWinner` plus `trickClosedRef` |
| `components/flightPhysics.ts:399-411` `seatsJustPassed`, read at `GameTable.tsx:557` | "the viewer just passed" (the float) | diffs `passedSeats` across two states, with a special case for the closing pass |
| `lib/game/sharedGameFlow.ts:51-63` `exchangeAnnouncementOf` | the give, the stuck release, a two-Joker deal | `prev.exchangePhase.active` versus next, and `jokersBefore`, a three-term inference |
| `server/game/gameTurn.ts:164-167` `armAfterMove(prev)` | "this move closed an exchange" | `prev.exchangePhase.active` |
| `lib/diagnostics/scenarios/landingSync.ts:10`, `threadLoad.ts:38` | "this state is a play" | `lastPlayedCombination && passCount === 0` |

**L-070 at MAIN (mostly landed since the ledger).** The online refs the ledger cites are gone: no
`prevGameStateRef` remains. Both providers call one pure `exchangeAnnouncementOf(prev, next)`, at
`context/OnlineGameContext.tsx:565-567` and `context/GameContext.tsx:175`, `:211`, `:233`.
`tests/engine/sharedGameFlow.test.ts:72-92` tables it. Two things are left. Offline calls it from
three sites rather than one commit path: `dealFrom` and `chooseExchangeCard` call `setGameState`
directly. And it still infers the move from phase flags.

**The table's demand, derived five times (L-009):**

- `checkSelection` at `gameEngine.ts:484-497` takes `Pick<GameState, "lastPlayedCombination" | "firstPlayMade" | "startCard">`.
- `autoMove.ts:97-103`.
- `components/table/stagedPlay.ts:40-45` `whatMustBeMet`, fed by `TableFacts` (`:30-38`), which
  `GameTable.tsx:519-538` builds from four fields.
- `GameTable.tsx:1029-1033` (`startCardDue`, `whoStarts`), `handRow.tsx:118` and `selectionLeaves.tsx:90-92`.
- `tests/helpers/offlineMatch.ts:330-338` `weakestBeatingPlay`.

`getAllValidPlays(hand, lastPlayed, isNewTrick, requireCard?)` (`:509`) takes a redundant pair.
Every production caller computes `isNewTrick = lastPlayedCombination === null` (`GameTable.tsx:458`,
`autoMove.ts:97`), and every tutorial beat sets the two consistently (`app/tutorial.tsx:215-346`).

`initializeRematch` sets `firstPlayMade: true` (`:910`, `:935`) to mean "no opening owed". So
`firstPlayMade` cannot answer "has anyone played", which forces the `playedRanks` inference and
its 25-line comment in `openingIsPending`/`roundUnplayed` (`:1020-1066`).
`tableHandlers.ts:230`/`:245` reads `firstPlayMade` for the `game.firstMoveMade` analytics event,
and `GameTable.tsx:829` reads it for the ember.

**The wire carries `GameState` verbatim, minus hands.**

- `sanitizeStateForPlayer` spreads `...state` (`server/game/gamePersistence.ts:78-102`), so any
  `GameState` field reaches every viewer. Only `exchangePhase` is filtered, through
  `visibleExchangePhase` (`server/game/onlineGameLogic.ts:121-146`).
- `WireGameState = Omit<GameState, "players"> & …` (`shared/protocol.ts:23-28`) is derived from
  the engine's type.
- `tests/server/protocolVersion.test.ts:23-48` hashes only the tokens of `shared/protocol.ts`.
  **So a new `GameState` field changes the wire with the hash test green, which makes the bump
  check self-defeating** (CLAUDE.md, "No self-defeating safeguards").
- The client parses `game:state` with the tolerant `gameStateSchema` (`shared/protocol.ts:151-158`).
- `tests/server/protocolEvents.test.ts` scans literal event names only. `lastMove` rides
  `game:state`, so it adds no event and that scan is unaffected.

**Persistence is version-gated.**

- `GAME_SCHEMA_VERSION = 3` (`shared/persistedEnvelope.ts:87`). A mismatch disposes the row (`:216-221`).
- `OFFLINE_SAVE_VERSION = 3` (`lib/offlineSave.ts:21`). A bump needs a committed
  `tests/fixtures/offlineSave.v<N>.json` (`tests/engine/offlineSave.test.ts:84-85`).

**L-082.** `app/tutorial.tsx` is 906 lines. It holds card literals (`:55-152`),
`buildExchangeState` (`:157`), `buildBeats` (`:196-~378`), `stageBeat` (`:379`), `evaluatePlay`
(`:402`, which re-checks `beat.requireCard` by hand at `:412`), `evaluateExchange` (`:437`) and
inline AsyncStorage progress (`:477-506`). `lib/tutorial/` does not exist.

**L-171.** "Tap cards until GIOCA's label says valid" is written four times:

- `tests/e2e/tableFit.spec.ts:302-318`
- `tests/e2e/handBudget.spec.ts:127-142`
- `tests/e2e/helpers/motionPath.ts:110-127`
- `tests/e2e/helpers/bot.ts:217-345`, the full search

`bot.ts` parses Italian copy with literals: `:49` `cart[ae] in mano`, `:201` `ha giocato`, and
`:208-211` `coppia di`/`tris di`/`bomba di`/`scala`. `tests/tooling/e2eSentinels.test.ts:24-27`
guards only `GIOCA_VALID_LABEL` and `YOUR_TURN_PREFIX` against `locales/it.ts`. A copy edit to the
others reaches the suite as a rules failure.

## 3. Alternatives considered

### Central module: how a consumer learns what just happened

**A. `GameState.lastMove`, written by every transition. (Picked.)** The engine is the only writer.
The wire and persistence carry the field for free, because sanitize spreads `...state`. Consumers
compare `seq`.

- Depth: one small field hides "which transition ran and what it closed".
- Locality: the fact is written where it happens, in `processPass`, which knows it closed the
  trick. No reader depends on write order.
- Cost: a state-shape change, a protocol bump, both schema bumps, and every `GameState` literal.

**B. Transitions return `{ state, events: MoveEvent[] }`, sent as a new socket event.** This is
the richest model: it carries skipped moves and could drive animation. It fights the transport,
though. `sendGameStateTo`'s retry re-derives from the *live* state (`gamePersistence.ts:183-213`),
so a state can be re-sent and intermediate states skipped by design. An event stream would need
exactly-once delivery, a resume cursor, persistence of a backlog, and a new entry in the
`protocolEvents` scan. It adds two sources of truth, state and events, which can disagree.
Rejected.

**C. No engine change: one client-side `describeMove(prev, next)` in `lib/game/`.** No protocol
or schema risk. But it keeps the leak: it still reads the engine's write order, so the inference
just moves into one place. It also cannot give identity across re-sent or skipped states. The
online turn clock reset still needs a composite key, and the offline bot key still needs the
collision harness or an identity hack. It is the fallback if the owner refuses a protocol bump
before launch (§10).

**A versus C on the deciding axis.** C deepens nothing in the engine, and the leak (readers
coupled to `processPass`'s write order) survives behind a nicer name. A removes the coupling and
the key. Pre-launch, A's migration risk is bounded: in-flight tables are disposed by a schema bump
and nothing is persisted that matters (CONTEXT, "Murlan is not live").

### The shape of `LastMove`

- **A1 (the ledger's): a flat `{ seq; seat; kind; closedTrick }`.** `closedTrick` is meaningless
  off a pass, and `seat` is meaningless on a deal or a stuck release. A reader must know which
  fields are noise for which kind.
- **A2 (picked): a discriminated union.** Each kind carries only what is true of it, and the
  compiler enforces that. It is the same JSON size.

### `seq` scope

- **Per table, monotonic across rounds.** Identity holds even if a client skips a round boundary.
  It needs `initializeRematch` to take the previous state's `seq`, which is a signature change
  inside the engine area's L-004 (`dealNextRound`) design.
- **Per round, with the deal as `seq: 0` (picked).** No initializer signature changes. Consecutive
  states never share a `seq`: a round-over state has `seq ≥ 1` and the next deal has 0. The only
  blind spot is a client that skips an entire round boundary and lands on an equal `seq`. It then
  fires no edge, which is the rejoin rule `useTableFeedback.ts:265-266` already wants ("rejoining
  mid-round does not replay the passes").

### The table's demand (L-009)

- **D1: a `tableDemand` helper only, keeping `startCard`/`firstPlayMade`.** This is verify's
  "low-risk slice". It collapses five derivations with no shape change. But the two-field
  encoding stays, and so do `roundUnplayed`'s `!firstPlayMade ||` disjunct and the analytics and
  ember readers of a field whose meaning is inverted on rematch.
- **D2 (picked): `openingCard: Card | null` plus `tableDemand(state)`.** It ships in the same
  bump window as `trickWinner`'s deletion, so the `MIN_PROTOCOL_VERSION` raise is paid once.

## 4. Target design

### 4.1 Types handed to other areas (engine and client design in parallel against these)

```ts
// lib/game/gameEngine.ts, next to GameState. Exported.
export type LastMove =
  | { seq: 0; kind: "deal" }
  | { seq: number; kind: "play"; seat: number }
  | { seq: number; kind: "pass"; seat: number; closedTrick: boolean }
  | { seq: number; kind: "giveback"; seat: number }   // seat = exchangePhase.winnerIdx
  | { seq: number; kind: "stuckRelease" };

export interface GameState {
  // … unchanged fields …
  lastMove: LastMove;          // T1a: required
  openingCard: Card | null;    // T1b: replaces startCard? and firstPlayMade
  // T1b deletes: firstPlayMade, startCard, trickWinner
}

export interface TableDemand {
  /** The combination to beat; null when the seat on move leads. */
  toBeat: Combination | null;
  /** A card the play must contain: the opening's start card, else null. */
  mustInclude: Card | null;
}
export function tableDemand(state: Pick<GameState, "lastPlayedCombination" | "openingCard">): TableDemand;
export function checkSelection(cards: Card[], demand: TableDemand): PlayCheck;   // was (cards, Pick<…3 fields>)
export function getAllValidPlays(hand: Card[], demand: TableDemand): Combination[]; // was (hand, last, isNewTrick, requireCard?)
export function legalPlays(state: GameState, seat: number): Combination[];       // getAllValidPlays(hand of seat, tableDemand(state))

// lib/game/moves.ts (new, pure, node-loadable: relative extensioned imports)
/** The move `next` records if `seen` has not already accounted for it; null otherwise. */
export function moveSince(seen: LastMove | null | undefined, next: LastMove): LastMove | null;
```

### 4.2 Invariants a caller relies on

1. **The engine is the only writer of `lastMove`.** It is written by `initializeGame` and
   `initializeRematch` (`{ seq: 0, kind: "deal" }`), `processPlay`, `processPass`,
   `processExchangeChoice`, and whichever function closes a stuck phase (today
   `resolveStuckExchange` in `autoMove.ts`; the engine area's L-006 may move it). Each writes
   `seq: prev.seq + 1`.
2. **A refused transition returns its input unchanged**, `lastMove` included (`processPass`'s
   `mustLead`, `processExchangeChoice`'s refusals). Equal `seq` within a round means the same move.
3. **`closedTrick` is true exactly on the pass that closes a trick.** The winner is then
   `lastPlayedBy`, which `processPass` leaves naming the trick's winner (`:89-93`). This replaces
   `trickWinner`.
4. **`LastMove` carries no card.** Card visibility stays with `players[].hand` and
   `visibleExchangePhase`. `sanitizeStateForPlayer` spreads `...state`, so a card in `lastMove`
   would reach every viewer unfiltered. This is a type-level test, not a comment.
5. **`lastMove` describes one transition.** A consumer that skipped states (an ack retry, a
   rejoin) sees only the last one. Per-move side effects (sounds, the float) for skipped moves are
   lost, as today's rejoin seeding intends. No consumer may treat a `seq` gap as "replay the gap".
6. **`openingCard`, when set, is held by the seat on move** (`initializeGame` makes the holder
   the opener). `processPlay` clears it. `initializeRematch` writes `null`.
   `tableDemand(...).mustInclude === openingCard`.
7. **`roundUnplayed` and `openingIsPending` stay on `playedRanks`.** A giveback is a move but not
   a play, so `lastMove.kind === "deal"` is *not* "nobody has played", contrary to the ledger's
   suggestion. T1b drops `roundUnplayed`'s `!firstPlayMade ||` disjunct only, because the all-zero
   tally covers it. Making `playedRanks` required is the engine area's L-012.

### 4.3 Consumers after (T2 and T1b)

- **Offline bot key** (`app/game.tsx`): `String(gameState.lastMove.seq)` under the same null
  gates. **Turn-clock reset** (`GameTable`): `` `${lastMove.seq}|${turnTimer.resetKey ?? ""}` ``.
  Delete `turnKey`.
- **Pass sound and trick-won sting** (`useTableFeedback`): on `moveSince(seenRef, lastMove)`,
  `kind === "pass"` plays the pass sound, and `closedTrick` plays `trickWon`. The ref is seeded
  from the mount state. One ref replaces `prevPassCountRef`/`prevTrickClosedRef`. Props
  `passCount`, `lastPlayedCombination` and `trickWinner` leave `TableFeedbackState` and
  `lastMove` replaces them.
- **Pile** (`pile.tsx`): the felt hold and the tag read
  `lastMove.kind === "pass" && lastMove.closedTrick`, with seat `lastPlayedBy` and closure counter
  from `seq`. No new setState-in-effect (ADR-0005): derive the tag in render, keyed on `seq`, as
  the float does. `comboKey` stays, because it identifies a combination on the felt, which lags
  state by flights.
- **Float "you passed"** (`GameTable.tsx:557`): `moveSince(floatSeen.lastMove, lastMove)` is a
  pass by `viewerSeat`. Delete `seatsJustPassed`. `passedSeats`/`usePassedSeats` stay, since they
  draw the markers.
- **Exchange announcement** (`sharedGameFlow.ts`): `exchangeAnnouncementOf(prev, next)` keeps its
  signature but keys on `moveSince(prev?.lastMove, next.lastMove)`:
  - `giveback` / `stuckRelease`: announce with `received = prev?.exchangePhase?.cardFromLoser`
    (online's closing state withholds it) and `given = next.exchangePhase.cardToLoser`, under the
    existing `received || given` guard.
  - `deal` with `twoJokerException`: announce.
  - `prev === null` keeps today's rows 3 and "seen first".

  `jokersBefore` is deleted. Offline `dealFrom` and `chooseExchangeCard` go through `commitState`,
  the one commit path.
- **Server** `armAfterMove(io, roomId, next)`: the ceremony delay applies when
  `next.lastMove.kind` is `giveback` or `stuckRelease`. `commitMove` stops keeping `prev`.
- **Diagnostics scenarios**: `s.lastMove.kind === "play"`.
- **T1b readers:**
  - `checkPlay` calls `checkSelection(cards, tableDemand(state))`.
  - `autoMove` reads `tableDemand`.
  - `TableFacts = { hand; demand: TableDemand; isMyTurn; isFinished }`, and `whatMustBeMet` is deleted.
  - `handRow` and `selectionLeaves` read `demand.mustInclude`.
  - `GameTable`: `startCardDue = openingCard !== null`, ember on `openingCard === null`.
  - `tableHandlers`: `MUST_PLAY_START_CARD` takes `openingCard!.rank`, and `firstMoveMade` fires
    when `gameState.openingCard !== null && newState.openingCard === null`.
  - `replay.ts` writes `openingCard: null`. Its honest `lastMove` (with `closedTrick` from the
    same `passesToCloseTrick` check) already landed in T1a.
  - `weakestBeatingPlay` uses `legalPlays`.
  - `canPlayerPlay` is deleted if it has no caller, else ported.
  - `botChoosePlay` keeps its signature (the engine/test-harness area's L-146 owns that) and builds
    the demand internally.

### 4.4 Wire and deploy compatibility

| Pair | T1a (`lastMove` added, protocol 7, MIN stays 6) | T1b (fields removed, protocol 8, MIN 8) |
|---|---|---|
| Old client, new server | Works. The passthrough schema ignores `lastMove`, and every old field is still sent. | Refused at the handshake with `CLIENT_OUTDATED`. Without the raise, a v7 client would read `firstPlayMade` and `startCard` as undefined, light GIOCA for an opening without the 3♠, and eat a server `MUST_PLAY_START_CARD`. It would also never see a trick close (`trickWinner` undefined), so there would be no tag and no sting. |
| New client, old server | The client schema requires `lastMove`, so every `game:state` goes to `unreadable` and the table never renders. Deploy order is **server first**, always. Web cannot mismatch, because Express serves the bundle. Native builds must not ship ahead of the server. | Same. |
| Persisted rows | `GAME_SCHEMA_VERSION` 3→4 disposes in-flight tables at deploy, which is acceptable pre-launch. `OFFLINE_SAVE_VERSION` 3→4 makes an old offline save "incompatible", so the player is told and starts fresh. | 4→5 and 4→5 again, same consequence. |

`gameStateSchema` gains `lastMove: z.object({ seq: z.number(), kind: z.enum([...]) }).passthrough()`,
required, because rendering dereferences it. No new socket event, so
`tests/server/protocolEvents.test.ts` is unchanged. `protocolMismatch.test.tsx` (native,
`CLIENT_OUTDATED` UI) is unchanged.

**Closing the hash gap (T1a).** `protocolVersion.test.ts` also hashes a canonical expansion of
every exported wire type in `shared/protocol.ts`. That means a recursive walk of property names,
optionality and primitive/literal types through every object type declared in the repo
(`GameState`, `Player`, `ExchangePhase`, `LastMove`, `RoundOverPayload`, …). It needs a new
counterfactual: compiling with an in-memory host where `GameState` has one extra field moves the
hash. Without this, both bumps here are unenforced.

### 4.5 Deleted

- `turnKey`, `trickClosedWithWinner` and `seatsJustPassed` (`flightPhysics.ts`).
- `prevPassCountRef` and `prevTrickClosedRef`.
- `jokersBefore`.
- In `offlineMatch.ts`: `computeBotTurnKey`, `handFingerprint`, `BotTurnKeyCollision`,
  `collectBotTurnKeyCollisions` and `botTurnKeyChecks`, plus the `matchTerminates` collision
  assertion.
- `armAfterMove`'s `prev`.
- `GameState.trickWinner`, `firstPlayMade` and `startCard`.
- `whatMustBeMet`.
- `getAllValidPlays`'s `isNewTrick`.
- `checkSelection`'s three-field `Pick`.
- `weakestBeatingPlay`'s derivation.
- From `app/tutorial.tsx`, about 450 lines of logic, which move to `lib/tutorial/`.
- Three of the four e2e legal-play loops.

## 5. Migration (each step leaves main green)

1. **T1a: add `lastMove`.**
   - The engine writes it, and the valve writes `stuckRelease`.
   - Bumps: `PROTOCOL_VERSION` to 7 with MIN unchanged, schema to 4, offline save to 4, plus the
     `v4` fixture.
   - Close the hash gap.
   - Add the equivalence soak (§6), which proves that `lastMove` agrees with every derivation it
     will replace.
   - Nothing is deleted yet, and no consumer changes.
2. **T2: consumers read `lastMove`.** Deletes the rows in §4.5 up to `armAfterMove`'s `prev`, the
   offline triple-call, and the equivalence soak's "old side". No shape change and no bump.
3. **T1b: the shape cleanup.**
   - `openingCard` and `tableDemand` replace `firstPlayMade`/`startCard`, and `trickWinner` is
     deleted.
   - Bumps: protocol to 8, `MIN_PROTOCOL_VERSION` to 8, schema to 5, offline to 5, plus the `v5` fixture.
   - Deletes `whatMustBeMet`, the `isNewTrick` parameter and the three fields.
4. **T3: tutorial extraction** onto `TableDemand`. A pure move, with no behaviour change.
5. **T4: e2e `playAnyLegal`.** Independent of 1-4.

## 6. No-regression strategy

**T1a, written first:**
- A transition table, `tests/engine/lastMove.test.ts`. It starts red because the field is absent.
  - Each transition's `lastMove`, including the deal of both initializers, a two-Joker deal,
    giveback, stuck release, a closing and a non-closing pass, and a going-out play.
  - Refusals (`mustLead` pass, an off-list giveback, an unheld card) return the identical object.
- **The equivalence soak**, `tests/engine/lastMoveAgrees.test.ts`. Over `simulateOfflineMatch`
  seeds at 2, 3 and 4 seats, it asserts at every committed transition:
  - `seq` is `prev.seq + 1` within a round, and 0 on a deal.
  - `kind === "pass"` ⇔ `passCount` rose or a trick closed (today's `useTableFeedback` rule).
  - `closedTrick` ⇔ `trickClosedWithWinner(next)` on a pass.
  - `turnKey(prev) !== turnKey(next)` whenever `seq` moved, so the old key never caught a move
    the new one misses.
  - `seatsJustPassed(prev, next)` equals `[seat]` of a pass, or `[]`.
  - `exchangeAnnouncementOf` is unchanged.

  It is green against the old derivations before any consumer moves. That makes it the bridge
  T2 relies on.
- `sanitizeStateForPlayer` keeps `lastMove` byte-equal for every viewer (`tests/server/`), and a
  type-level assertion pins that `LastMove` contains no `Card`.
- Hash-gap counterfactual: a `GameState` field moves the hash.
- `tests/engine/offlineSave.test.ts`: the new `v4` fixture.

**T2:**
- The existing native and ui-rules tests keep their assertions. Only their input shape changes
  (props/state gain `lastMove`):
  - `tests/native/feedback.test.tsx`, `everyMomentHasACaller.test.tsx`,
    `nowCueSurvivesAStall.test.tsx`, `trickWinnerBanner.test.tsx`
  - `tests/ui-rules/floatModel.test.ts`, `mixPolicy.test.ts`
  - the exchange natives: `exchangeAnnounceBothWays`, `ceremonyHoldsTheCard`, `exchangeKeyHolds`,
    `exchangeHoldsTheTurn`, `gameContextExchange`
  - `tests/server/exchangeRearm.test.ts`, `tests/server/commitMove.test.ts`

  A changed `assert` line in those files needs a sentence in the PR body.
- `sharedGameFlow.test.ts` rows keep their expected column, and their inputs gain `lastMove`.
- `flightPhysics.test.ts`'s `turnKey`/`seatsJustPassed` blocks are deleted with the functions;
  the T1a soak covered them.
- `matchTerminates` drops the collision report. It is replaced by T1a's `seq` property, which
  makes a collision impossible by construction.
- New red/green: a native `GameScreen` test where two consecutive bot states would have shared a
  `turnKey`-shaped key still re-arms the bot timer. Build it from the soak's equality case if one
  exists, else assert re-arm on every `seq` change.

**T1b:**
- An engine table for `tableDemand`, `legalPlays` and `checkSelection(cards, demand)` covering
  opening, lead, follow and a rematch round.
- `enumerator.property.test.ts` keeps its brute-force equivalence through the new signature.
- `tests/server/` covers `MUST_PLAY_START_CARD` params and `game.firstMoveMade` firing once per match.
- The `v5` fixture.
- e2e: no layout changes, but `tests/e2e/startAnnouncement.spec.ts` (the opening announcement
  reads `openingIsPending`) and the opening-play path in `helpers/bot.ts` are the only browser
  check on the start card. Run both. Unit tests cannot see layout (CLAUDE.md), and nothing here
  moves layout.

**T3:** `tutorialTableBeats.test.tsx` stays green unchanged. A new `node --test`
`tests/engine/tutorialBeats.test.ts` pins `evaluatePlay`/`evaluateExchange` for every beat (each
beat's right answer and one wrong answer), written against the screen version first.

**T4:** the four specs that use the loop stay green. `e2eSentinels.test.ts` gains the parse
sentinels, red once: edit `it.ts`'s `a11yPlayerPlayed` locally and see it fail.

## 7. Coverage table

| ID | Covered by | Note |
|---|---|---|
| L-005 | T1a (field), T2 (consumers), T1b (`trickWinner` deleted) | Refined to a card-free union with a per-round `seq`. The opening predicates stay on `playedRanks` (§4.2.7), against the ledger's "becomes `kind === "deal"`". The protocol cost is spelled out in §4.4. |
| L-009 | T1b | D2: `openingCard` plus `tableDemand` and `legalPlays`. `getAllValidPlays(hand, demand)`. `botChoosePlay`'s signature is left to L-146. |
| L-070 | Mostly done at MAIN; residual in T2 | `exchangeAnnouncementOf` is already shared and the online refs are gone. T2 keys it on `lastMove`, deletes `jokersBefore`, and routes offline through `commitState` only. |
| L-082 | T3 | `lib/tutorial/beats.ts` and `lib/tutorial/progress.ts`. `PlayBeat` carries a `TableDemand`, so the hand check of `requireCard` (`:412`) becomes the engine's `needsStartCard`, mapped in `TUTORIAL_REFUSAL_KEYS`. |
| L-171 | T4 | No real dependency on L-009: GIOCA stays the judge. It merges into test-harness's e2e-helpers ticket (L-172) if that one is cut first. |

## 8. Proposed tickets

### T1a — `GameState.lastMove`: every transition records itself (size M)

- **Files:**
  - Engine: `lib/game/gameEngine.ts`, `lib/game/autoMove.ts` (`resolveStuckExchange`), `lib/e2eOpener.ts`, `lib/captureStates.ts`, `lib/game/replay.ts` (writes `lastMove`).
  - Wire and persistence: `shared/protocol.ts` (schema, version), `tests/fixtures/protocolHashes.json`, `tests/server/protocolVersion.test.ts`, `shared/persistedEnvelope.ts`, `lib/offlineSave.ts`, `tests/fixtures/offlineSave.v4.json`.
  - Tests: new `tests/engine/lastMove.test.ts` and `tests/engine/lastMoveAgrees.test.ts`, a sanitize test in `tests/server/`, and `app/tutorial.tsx` (literal gains the field).
- **Blocked by:** test-harness's `state()` fixture ticket (L-142). Without it, every hand-built
  `GameState` literal (about 100 files) gains a field, and this becomes L.
- **DoD:**
  - [ ] `LastMove` is exported exactly as §4.1, and `GameState.lastMove` is required.
  - [ ] Every transition in §4.2.1 writes it, and refusals return the input object.
  - [ ] Type-level test: `LastMove` holds no `Card`. Server test: wire `lastMove` equals the
    engine's for a participant, a non-participant and a spectator.
  - [ ] Equivalence soak green at 2, 3 and 4 seats, as §6.
  - [ ] Protocol 7 with MIN 6. Schema 4, offline save 4, `v4` fixture committed.
    `gameStateSchema` requires `lastMove`.
  - [ ] The hash covers the expanded wire types, with a counterfactual (an extra `GameState`
    field moves it).
  - [ ] No consumer reads `lastMove` yet. The diff touches no `components/` file.
- **Checks:**
  - While iterating: `node --test tests/engine/lastMove.test.ts tests/engine/lastMoveAgrees.test.ts tests/server/protocolVersion.test.ts tests/engine/offlineSave.test.ts`
  - Before pushing: `npm run agent:check`

### T2 — The table reads the move instead of diffing for it (size M)

- **Files:**
  - Screens and context: `app/game.tsx`, `context/GameContext.tsx`.
  - Table: `components/GameTable.tsx`, `components/useTableFeedback.ts`, `components/table/pile.tsx`, `components/flightPhysics.ts` (deletions).
  - Lib: new `lib/game/moves.ts`, `lib/game/sharedGameFlow.ts`, `lib/diagnostics/scenarios/landingSync.ts`, `threadLoad.ts`.
  - Server: `server/game/gameTurn.ts`.
  - Test harness: `tests/helpers/offlineMatch.ts`, `tests/engine/matchTerminates.test.ts`.
  - The tests listed in §6/T2.
- **Blocked by:** T1a, #1624 and #1639 (both edit `app/game.tsx` `botTurnKey`), and engine's L-003
  ticket (edits `app/game.tsx` giveback and `GameContext.releaseStuckExchange`). Land in either
  order, then rebase. **Blocks** table-ui's `flightPhysics.ts` split (L-099): there are three
  fewer functions to move.
- **DoD:**
  - [ ] `turnKey`, `trickClosedWithWinner`, `seatsJustPassed`, `prevPassCountRef`,
    `prevTrickClosedRef` and `jokersBefore` are gone. `rg` finds none.
  - [ ] Bot key and clock reset key read `lastMove.seq`. Pass/trick sounds, the pile tag and the
    float read `moveSince`, and each seeds from the mount state.
  - [ ] `exchangeAnnouncementOf` keys on the move. Offline `dealFrom` and `chooseExchangeCard`
    commit through `commitState`. `sharedGameFlow.test.ts` expected values are unchanged.
  - [ ] `armAfterMove` takes `next`, and `commitMove` keeps no `prev`.
  - [ ] The collision harness and its `matchTerminates` assertion are deleted. The soak's
    old-side comparisons are deleted with the functions they call.
  - [ ] The listed native and ui-rules tests changed input shape only, or the PR names each
    changed assertion.
  - [ ] No new setState-in-effect, and every hook in `app/game.tsx` still runs before
    `if (!gameState)`.
- **Checks:**
  - While iterating: `npx jest tests/native/feedback.test.tsx tests/native/trickWinnerBanner.test.tsx tests/native/exchangeAnnounceBothWays.test.tsx`; `node --test tests/engine/sharedGameFlow.test.ts tests/ui-rules/floatModel.test.ts tests/engine/matchTerminates.test.ts`
  - Before pushing: `npm run agent:check`. Then `npx playwright test tests/e2e/exchangeAnnounceNodes.spec.ts tests/e2e/exchangeAttribution.spec.ts` (the ceremony is the browser-visible path).

### T1b — One record of the table's demand: `openingCard`, `tableDemand`, no `trickWinner` (size M; L without the fixture builder)

- **Files:**
  - Engine: `lib/game/gameEngine.ts`, `lib/game/autoMove.ts`, `lib/game/bot.ts` (internal demand only), `lib/game/replay.ts`, `lib/captureStates.ts`.
  - Table: `components/table/stagedPlay.ts`, `components/GameTable.tsx`, `components/table/handRow.tsx`, `components/table/selectionLeaves.tsx`, `components/table/spokenLabels.ts`.
  - Server: `server/game/tableHandlers.ts`.
  - Wire and persistence: `shared/protocol.ts`, `shared/persistedEnvelope.ts`, `lib/offlineSave.ts`, plus the fixtures.
  - `app/tutorial.tsx` (`stageBeat` only).
  - Tests: `tests/helpers/offlineMatch.ts`, and every test calling `getAllValidPlays` (about 60 sites in 13 files).
- **Blocked by:** T2. Also engine's L-012 if it makes `playedRanks` required in the same window;
  coordinate one bump.
- **DoD:**
  - [ ] `GameState` has `openingCard: Card | null` and no `firstPlayMade`, `startCard` or `trickWinner`.
  - [ ] `tableDemand`, `legalPlays`, `checkSelection(cards, demand)` and
    `getAllValidPlays(hand, demand)` are as §4.1. `whatMustBeMet` and the five derivations read
    `tableDemand`. `rg "firstPlayMade|startCard\b|isNewTrick ? null"` finds no reader.
  - [ ] `roundUnplayed` loses the `firstPlayMade` disjunct. `openingIsPending` is unchanged.
  - [ ] `game.firstMoveMade` still fires once per match (server test).
    `MUST_PLAY_START_CARD` still carries the rank.
  - [ ] Protocol 8 with `MIN_PROTOCOL_VERSION` 8. Schema 5, offline save 5, `v5` fixture.
  - [ ] `enumerator.property.test.ts` is green through the new signature.
- **Checks:**
  - While iterating: `node --test tests/engine/*.test.ts tests/bots/*.test.ts`; `npx jest tests/native/legalPlaysPerHand.test.tsx tests/native/oneTapOneCommit.test.tsx`
  - Before pushing: `npm run agent:check`, plus `npx playwright test tests/e2e/startAnnouncement.spec.ts`

### T3 — The tutorial's content and validation live in `lib/tutorial/` (size S)

- **Files:** `app/tutorial.tsx`, new `lib/tutorial/beats.ts`, new `lib/tutorial/progress.ts`
  (beside `lib/tutorialSeen.ts`, using `TUTORIAL_PROGRESS_KEY`), new
  `tests/engine/tutorialBeats.test.ts`, and `components/tutorialRefusal.ts` (map `needsStartCard`).
- **Blocked by:** T1b. It also touches `CardView` usage, which table-ui's L-098 owns: no overlap
  unless L-098 moves tutorial press/lift into `app/tutorial.tsx`, in which case order them.
- **DoD:**
  - [ ] `buildBeats(t)`, `buildExchangeState(t)`, `evaluatePlay(sel, beat, t)`,
    `evaluateExchange(card, beat, t)` and the card literals are exported from
    `lib/tutorial/beats.ts`, with relative extensioned imports (node-loadable).
    `tutorialProgress.{read,write,clear}` are in `lib/tutorial/progress.ts`.
  - [ ] `PlayBeat` carries `demand: TableDemand`, and the hand check of `requireCard` is gone (the
    engine refuses, and the tutorial message is kept through `TUTORIAL_REFUSAL_KEYS`).
  - [ ] `app/tutorial.tsx` holds only the screen, at about 450 lines or fewer.
  - [ ] `tutorialTableBeats.test.tsx` passes unchanged. The new node test covers each beat's
    accepted and refused answer.
- **Checks:**
  - While iterating: `node --test tests/engine/tutorialBeats.test.ts`; `npx jest tests/native/tutorialTableBeats.test.tsx tests/native/tutorialSkip.test.tsx`
  - Before pushing: `npm run agent:check`, plus `npx playwright test tests/e2e/tutorialSkip.spec.ts`

### T4 — One "play any legal selection" helper, and parsed copy declared as sentinels (size S)

- **Files:** `tests/e2e/helpers/bot.ts`, `tests/e2e/helpers/labels.ts`,
  `tests/e2e/tableFit.spec.ts`, `tests/e2e/handBudget.spec.ts`,
  `tests/e2e/helpers/motionPath.ts`, `tests/tooling/e2eSentinels.test.ts`.
- **Blocked by:** #1639 (edits `motionPath.ts`). Merge into test-harness's L-172 e2e-helpers
  ticket if that is cut, since it touches the same files.
- **DoD:**
  - [ ] `bot.ts` exports `playAnyLegal(page, opts?: { singlesOnly?: boolean; prefer?: string }): Promise<boolean>`,
    and the three other loops call it. `rg 'GIOCA_VALID_LABEL' tests/e2e` finds only `bot.ts` and `labels.ts`.
  - [ ] `btn-gioca`/`btn-passa` selectors live in `selectors.ts`.
  - [ ] The Italian parse patterns (`a11yPlayerPlayed`, `a11yYourCards_*`/`a11yOpponentCards_*`,
    `a11yLastPlayPair|Triple|Bomb|Straight|RoyalStraight`) are declared in `labels.ts` as the
    locale template strings and turned into regexes there. `e2eSentinels.test.ts` holds each
    against `locales/it.ts`.
- **Checks:**
  - While iterating: `node --test tests/tooling/e2eSentinels.test.ts`
  - Before pushing: `npm run agent:check`, plus `npx playwright test tests/e2e/tableFit.spec.ts tests/e2e/handBudget.spec.ts` and one spec using `driveGameToCompletion`.

**Order:** T1a → T2 → T1b → T3. T4 runs in parallel with all of them.

## 9. Cross-area contracts

- **I give engine** the `LastMove`, `TableDemand`, `tableDemand`, `legalPlays` and
  `getAllValidPlays(hand, demand)` signatures (§4.1), plus invariants §4.2.1-3 and 6.
  - L-003/L-006 (bot giveback, the stuck valve): whichever function closes a stuck phase writes
    `{ kind: "stuckRelease" }`.
  - L-004 `dealNextRound`: it must produce `{ seq: 0, kind: "deal" }` and `openingCard: null`.
  - L-012 (`playedRanks` required): share T1b's bump window if possible.
  - `gameEngine.ts` is edited by T1a and T1b. Any engine-area split of that file orders against them.
- **I give client** `lastMove` on `GameState`, `WireGameState` and the offline state alike, plus
  `moveSince` from `lib/game/moves.ts`. `TableFacts` becomes `{ hand; demand; isMyTurn; isFinished }`
  in T1b, so client and table-ui work on `TableFacts`/`HandRow` (#1604's successors) must order
  against T1b. `context/GameContext.tsx` is edited by T2 (`commitState` as the one path).
- **I need from test-harness** the shared `state()` fixture (L-142) before T1a. T2 deletes the
  collision harness in `tests/helpers/offlineMatch.ts`, and T1b ports `weakestBeatingPlay`. L-146
  edits the same file, so order them.
- **table-ui:** T2 deletes `turnKey`, `trickClosedWithWinner` and `seatsJustPassed` from
  `flightPhysics.ts`. L-099's `passes.ts` should not receive them. T2 also edits `pile.tsx`,
  `useTableFeedback.ts` and `GameTable.tsx`.
- **static-checks:** T1a extends `protocolVersion.test.ts` to hash expanded wire types. If
  static-checks also plans a protocol-hash change, take this one there and make T1a blocked by it.
- **server-runtime / server-output:** T2 edits `server/game/gameTurn.ts` (`armAfterMove`,
  `commitMove`). T1b edits `server/game/tableHandlers.ts:222-250`. `sanitizeStateForPlayer` is
  unchanged, but invariant 4 (no card in `lastMove`) is what keeps it safe.
- **time:** none. `seq` is a count, not a clock, and `settledAt` stays server-only.

## 10. Owner decisions needed

1. **Two protocol bumps pre-launch, the second raising `MIN_PROTOCOL_VERSION`.** This needs a
   server-first deploy order. If any native build is in testers' hands, they get `CLIENT_OUTDATED`
   after T1b. The alternative is design C (§3): no wire change, one client-side `describeMove`,
   and `turnKey` and the collision harness stay.
2. **Glossary term "Move"** (CONTEXT.md grows one term at a time): "one transition of a round:
   the deal, a play, a pass, a giveback or the stuck release; `GameState.lastMove` records the
   newest". Add it with T1a, or leave it as an engine-internal name.
3. **Replay shows the trick-winner tag.** T1a writes an honest `closedTrick` in `replayStateAt`,
   and once T2 points the pile at it, stepping onto a closing pass shows the tag. Today's replay
   never shows it (`trickWinner: null` at `replay.ts:151`). Keep that (recommended, since it matches live play),
   or have the replay screen suppress it.
