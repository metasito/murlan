# 01 — Engine: purity and the domain model of `lib/game`

Area: match flow, the restore verdict, error modes and types, the offline bot exchange through the
engine. Every `path:line` is at MAIN `a1d0ebb5` unless marked otherwise.
IDs: L-001 L-002 L-003 L-004 L-006 L-007 L-008 L-010 L-011 L-012 L-013 L-014 L-015 L-016 L-017
L-088 L-144 L-146 (L-018 absorbed: un-export only).

## 1. Summary

- **Now:** the engine exposes *transitions* (`processPlay`/`processPass`/`processExchangeChoice`,
  `initializeGame`/`initializeRematch`, `foldRoundIntoMatch`). It does not expose *decisions*. Each
  caller rebuilds the decisions around them: refusal modes, who may move, what a bot gives back,
  which seats may be crowned, the next deal, and whether a match is over. They are rebuilt three
  times (server, offline provider, test harness), and a fourth time on restore.
- **After:** four engine seams, each with one data-shaped interface.
  - `applyMove(state, seat, Move) → MoveResult` is the one transition with one refusal type.
  - `chooseMove(state, seat, strength) → Move` is the one bot decision, plays and givebacks both.
  - `foldRound(round, ledger, SeatScoring[])` is scoring policy as data.
  - `startRound(seats, mode, { firstSeat, opening })` plus `openingAfter(prev)` is the one deal.
  - The offline lifecycle composes them in a pure `lib/game/matchFlow.ts`, which the harness imports
    rather than mirrors.
- **The restore verdict is persisted, not re-derived.** Re-deriving it from later state is the bug
  class, not the particular input.
- **Why:** each finding here is a caller re-deriving an engine decision. Deepen the four seams and
  the copies have nothing left to copy. Nine tickets: 2 S and 7 M, in one ordered chain because
  nearly all of them edit `lib/game/gameEngine.ts`.

## 2. Current shape (evidence at MAIN)

**A. The verdict on restore (L-001).**
- `server/game/tableState.ts:217-225` restores `matchOver` through `restoredMatchOver`, at
  `server/game/onlineGameLogic.ts:277-296`. That function passes the whole `scores` map to
  `resolveMatchFor`.
- Live, `lib/game/gameEngine.ts:1470-1485` races free-for-all on `winEligibleCumulative` only. The
  live path's `winEligible` is the closure at `onlineGameLogic.ts:388-392`.
- So a vacated seat's `bot:<seat>` key can cross the target on restore only. A tie between a
  crownable key and that bot key escalates on restore, but ends the match live.
- The comment at `gameEngine.ts:1324-1327` ("cannot answer differently") holds for the resolver and
  not for its input.
- Persisting the verdict is the deeper fix. Re-judging with shared input still diverges whenever the
  seats change between the fold and the restore: a match winner who leaves at the results screen
  becomes frozen and uncrownable. `matchOver` is already a field of `OnlineGameState`, written at
  `roundOver.ts:92`, `:259` and `:329`. Only the envelope omits it ("derived from what is",
  `tableState.ts:192-193`).

**B. Three transitions with three error modes (L-010).**
- `processPlay` throws via `assertPlayable` (`gameEngine.ts:690-710`).
- `processPass` returns its input on refusal (`:788`).
- `processExchangeChoice` returns its input with no reason (`:950`, `:955`, `:961`).
- The server pre-checks every guard the engine also checks, then detects a refusal by identity:
  - `tableHandlers.ts:204-210` duplicates `checkPlay`'s `exchangeOpen`.
  - `:261-265` duplicates it again for pass.
  - `:293-297` compares `next === game.gameState`, then invents `INVALID_CARD`.
- The offline provider pre-checks the same way (`context/GameContext.tsx:240-255`).
- Turn ownership is reimplemented as `playerMap[currentIdx] !== userId` (`tableHandlers.ts:213`,
  `:267`). Its exchange twin is `:287-290`. "Who acts now" is a private `actingSeat` at
  `server/game/gameTurn.ts:43-47`.

**C. The bot decision reports through a callback and a mutation (L-011, L-013, L-017).**
- `autoMoveForSeat` (`lib/game/autoMove.ts:78-143`) returns a state.
- It hands the move out through `ctx.onMove` (`:105-108`) and mutates `ctx.roundFlags`
  (`:124`, `:138`).
- The server wraps it only to recover the move (`gameTurn.ts:66-77`) and computes `wasExchange`
  beforehand (`:241`).
- The test harness recovers the move through the same callback (`tests/helpers/offlineMatch.ts:458-470`).
- Flags are recorded in three places: `autoMove.ts:124`, `:138`, and `tableHandlers.ts:234` through
  a pass-through wrapper (`gameTurn.ts:52-54`).
- `botChoosePlay` takes nine positional parameters (`lib/game/bot.ts:222-232`), assembled by its one
  production caller (`autoMove.ts:110-122`). There are 33 test and script calls.

**D. The offline exchange decision sits in a screen (L-003, L-006).**
- `app/game.tsx:132-156` computes the bot's giveback with `pickGivebackCard` and a stuck predicate.
  It then calls `chooseExchangeCard` or `releaseStuckExchange` (`GameContext.tsx:263-266`).
- `offlineBotMove` already reaches the exchange branch (`autoMove.ts:84-91`, `:146-150`), because
  `initializeRematch` sets `currentTurnIndex` to the winner (`gameEngine.ts:928`).
- `pickGivebackCard` is a bot heuristic exported from the engine (`gameEngine.ts:981-985`). So the
  guard "gameEngine.ts exports no bot heuristic" (`tests/engine/matchState.test.ts:288`) cannot see
  it, and "one module chooses a bot's move" (`:219`) counts only `botChoosePlay`.
- The stuck valve `resolveStuckExchange` (`autoMove.ts:43-52`) is reached from:
  - `autoMove.ts:89`
  - `app/game.tsx:147-153`
  - `GameContext.tsx:263-266`
  - `lib/diagnostics/benchTable.ts:30`
  - `tests/native/helpers/botRound.ts:14`
- Its state is unreachable from a deal. `getValidGivebackCards` (`:987-993`) is empty only for an
  empty hand, and an open exchange means no play has happened yet.
- Both restore seams cast unvalidated blobs: `lib/offlineSave.ts:82` and
  `shared/persistedEnvelope.ts:226-233`. That cast is the only way in.

**E. The match lifecycle has no module (L-004, L-008, L-144, L-146).**
- Offline:
  - `freshMatch` (`GameContext.tsx:71-81`)
  - `applyRoundToMatch` (`:87-113`)
  - the fold on the roundOver edge (`:174-180`)
  - `dealFrom`/`startNextRound`/`startNewMatch` (`:205-227`)
  - two derivable state slots, `savedPlayerConfigs` and `savedGameMode` (`:149-150`), persisted as
    `OfflineSave.players` and `.gameMode` (`lib/offlineSave.ts:29-31`, `:78-79`)
- Server:
  - `dealVotedRound` (`tableHandlers.ts:331-395`) rebuilds the setup from `players` and strips
    `team` (`:371`)
  - `newTable`/`carriedFinishingOrder` (`tableState.ts:96-167`) fabricate a two-element order,
    `player_W`/`player_L` (`:118`)
  - `rollMatchForward` (`roundOver.ts:323-331`)
- Harness: a "Verbatim copy" of `applyRoundToMatch` and `freshMatch` (`offlineMatch.ts:46-89`), and
  a `dealFrom` mirror (`:379-394`).
- `tests/native/teamsSingleRound.test.tsx:1-6` needs jest-expo only because the function lives in a
  `.tsx` provider.
- `initializeRematch` (`gameEngine.ts:860-947`) reads `[0]` and `[last]` of an order and silently
  falls back to seat 0 or the last seat (`:890-891`).
- Team is supplied by callers: `app/lobby.tsx:152`, `:180`, `tableState.ts:135`, stripped at
  `tableHandlers.ts:371`. Bots ignore it and recompute it (`bot.ts:148-156`).
- `OnlineGameState.gameMode` duplicates `gameState.gameMode` and is rewritten at
  `tableHandlers.ts:391`.

**F. Scoring policy as closures (L-007, L-016, L-014, L-002).**
- `FoldRoundInput` (`gameEngine.ts:1342-1378`) takes `keyOf`, `accumulates`, `winEligible`, `teamOf`
  and `frozenKeysOf`. `accumulates` has no production caller.
- The server builds the closures at `onlineGameLogic.ts:371-399`, and `teamKeyMap` (`:255-268`)
  rebuilds `teamOfKey` a second time.
- Placement points are restated at `server/game/stats.ts:33-35` ("mirroring … exactly").
- The bot key format is spelled three times: `server/game/botSeat.ts:6-22`, `lib/game/rating.ts:80`,
  and `onlineGameLogic.ts:203`.
- `concedeRound` (`gameTurn.ts:287-306`) writes placements in place, a sibling of the engine's
  private `placeLastSeat` (`gameEngine.ts:668-673`).

**G. Smaller items.**
- **L-088.** `readStagedPlay` (`components/table/stagedPlay.ts:54-82`) runs `checkSelection`, drops
  `check.code`, and asks `playButtonLabel` (`components/turnTimerUi.ts:45-82`). That is a second
  copy of `beatRefusal`'s ladder (`gameEngine.ts:435-454`), over a lossy `ComboShape`.
- **L-015.** These files in `lib/game` are not game logic:
  - `lib/game/sharedGameFlow.ts:1` imports `react`.
  - `dealTimeline.ts:1`, `exchangeTimeline.ts:1`, `roundEnding.ts:7` and `matchEnding.ts:6` import
    `../tokens.ts`.
  - `placement.ts:3` imports `../theme` (react-native).
  - `offlineBotDelay.ts` is a UI pacing constant.
  - #1624 is about to add `lib/game/gateWatchdog.ts`.
  - The server imports `exchangeGiveDelayMs` from `lib/game/exchangeTimeline.ts`
    (`gameTurn.ts:39`).
- **L-013.**
  - `lib/exchangeCeremony.ts:13-15` only forwards to `exchangeAnnounceFrom`.
  - `server/game/replayShape.ts:30` (`startReplayLog`) returns `[]`.
  - `gameTurn.ts:52-54` is a wrapper.
  - `onlineGameLogic.ts:324` aliases `ScoreboardRow = ScoreLine`.
- **L-012.**
  - `playedRanks?` is optional "for a round persisted before the tally existed"
    (`gameEngine.ts:104-113`), though both stores are version-gated
    (`persistedEnvelope.ts` `GAME_SCHEMA_VERSION = 3`, `offlineSave.ts:21`).
  - `ExchangePhase` is flags plus optional cards (`:58-77`): 29 `.active` reads in 12 production
    files, and 23 `cardFromLoser` reads.
  - `visibleExchangePhase` returns `Record<string, unknown>` (`onlineGameLogic.ts:121-146`).
- **L-018.** These value exports from `gameEngine.ts` have no production importer: `shuffleDeck`,
  `freshHandFloor`, `findStartingPlayer`, `getCombinationType`, `getCombinationStrength`,
  `canPlayerPlay`, `loserHasBothJokers`, `getBestCardFromHand`, `nextDealFirstSeat`, `targetsFor`,
  `addPlacementPoints`, `nextMatchTarget`, `resolveMatch`, `resolveTeamMatch` and
  `STRAIGHT_MAX_LEN`. Measured by grep over app/components/context/lib/server/shared/scripts.

**Deletion test on existing modules.**
- `lib/exchangeCeremony.ts`, `startReplayLog`, the `recordPlayFlags` wrapper, `ScoreboardRow`,
  `teamKeyMap` and `restoredMatchOver` each fail it: deleting them concentrates nothing.
- `server/game/gameTurn.ts autoMoveForSeat` fails it once `autoMove` returns its move.
- `foldRoundIntoMatch` passes: it is deep, and only its interface is shallow.
- `onlineGameLogic.resolveRoundEnd` passes, since it has a real port (`RoundOverWriters`).

## 3. Alternatives considered

### 3.1 The restore verdict (L-001)
| | A. Re-judge with shared `SeatScoring` | B. Persist `matchOver` (picked) |
|---|---|---|
| Interface | `judgeMatch(ledger, seats)` called by fold and restore | none; `fromEnvelope` reads a field |
| Correct when seats change after the fold? | **No.** A winner who leaves at results becomes frozen and uncrownable, and restore reads "running" | Yes, by construction |
| Deletes | `restoredMatchOver`, `teamKeyMap` | the same, plus `endedByVote \|\|` at `tableState.ts:217` |
| Migration | needs L-007's data shape first | standalone, S |

B wins on correctness and on cost. The verdict is a fact of the fold moment, like `roundsPlayed`,
which is already persisted.

### 3.2 The move seam (L-010, L-011)
| | A. Keep three `process*`, give each a result type; `autoMove` returns `{next, move}` | B. One `applyMove(state, seat, Move)` plus `chooseMove` returning a `Move` (picked) |
|---|---|---|
| Interface a caller learns | three refusal unions, three entry points, the turn check still the caller's | one `Move`, one `MoveRefusal`, one entry |
| Server | three handlers keep their pre-checks | one `moveAction` and one code table, `satisfies Record<MoveRefusal, …>` |
| Flags and replay | still recorded where the caller knows the combo | recorded once, in `commitMove`, from the `AppliedMove` |
| Leverage for others | lastMove must hook three functions | lastMove writes `state.lastMove` in one place |
| Risk | lower churn | `next === state` identity checks must all go at once (verify note) |

B is the deeper module: the decide/apply split is what lets the offline bot's giveback (L-003)
reach the same path as a play.

### 3.3 The match lifecycle (L-004)
| | A. One `MatchTable` record shared by server and offline; `OnlineGameState` embeds it | B. Shared primitives (`startRound`, `openingAfter`, `foldRound`, `dealFirstSeatFor`) plus an offline-only `matchFlow` composition the harness imports (picked) |
|---|---|---|
| Depth | deepest on paper | deep where the copies are |
| Server churn | renames `cumulativeScores`, `matchTarget`, `roundsPlayed` and `matchOver` across `server/game` and the envelope; collides with server-runtime | `dealVotedRound` and `newTable` each call `startRound` |
| Locality | server key mapping, votes and persistence get forced through an offline-shaped record | server keeps its key mapping (verify: "legitimately") |
| Deletion test | — | the harness mirrors die, and `GameContext` keeps no match logic |

B wins. The duplication that ships bugs is offline against the harness, plus the two
`initializeRematch`-or-`initializeGame` branches. The server's ledger fields are not copies of
anything.

## 4. Target design

### 4.1 Moves: decide, apply, commit (E6)
```ts
// lib/game/gameEngine.ts
export type Move =
  | { kind: "play"; cardIds: string[] }
  | { kind: "pass" }
  | { kind: "giveback"; cardId: string };

export type AppliedMove =
  | { kind: "play"; seat: number; combo: Combination }
  | { kind: "pass"; seat: number }
  | { kind: "giveback"; seat: number; card: Card };

export type SelectionRefusal = Exclude<PlayRefusal, "exchangeOpen" | "notHeld">; // E2
export type MoveRefusal =
  | "roundOver" | "exchangeOpen" | "noExchange" | "notYourTurn" | "notExchangeWinner"
  | "notHeld" | SelectionRefusal | "mustLead" | "notGiveable";

export type MoveResult =
  | { ok: true; state: GameState; move: AppliedMove }
  | { ok: false; code: MoveRefusal };

/** Who must act now: the exchange winner while an exchange is open, else the turn holder. */
export function actingSeat(state: GameState): number;
export function applyMove(state: GameState, seat: number, move: Move): MoveResult;
```
- **Check order:** the result is the first refusal in this order, and it preserves today's
  server-visible behaviour:
  1. `roundOver`
  2. for a giveback: `noExchange`, then `notExchangeWinner`; for any other move: `exchangeOpen`
  3. `notYourTurn` (`seat !== actingSeat(state)`)
  4. the move's own checks: `checkPlay` codes, `mustLead`, or `notHeld`/`notGiveable`
- `seat` is the transport's claim of *who is acting*. The engine checks it against `actingSeat`.
  The transport still maps user to seat (`seatOfUser`). The comment at `gameEngine.ts:463-466` is
  rewritten to match.
- `processPlay` keeps `assertPlayable` as a throwing floor and becomes module-private, as do
  `processPass` and `processExchangeChoice`. `applyMove` never throws for a refusable move. A throw
  from inside it is a bug, which matches the floor's current contract.
- No `next === state` identity checks survive. `tableHandlers.ts:294` is the only one.

```ts
// lib/game/autoMove.ts — still the only caller of bot.ts
export type Strength = "bot" | "floor";
export function chooseMove(state: GameState, seat: number, strength: Strength, rng?: () => number): Move | null;
export function autoMoveForSeat(state: GameState, seat: number, strength: Strength, rng?: () => number):
  { state: GameState; move: AppliedMove } | null;   // chooseMove, then applyMove; null if the seat cannot act
export function offlineBotMove(state: GameState, rng?: () => number): { state: GameState; move: AppliedMove } | null;
```
- Deleted: `AutoMoveContext`, `ctx.onMove`, the `ctx.roundFlags` mutation, `recordPlayFlags` as an
  export of `autoMove`, the server `autoMoveForSeat` wrapper (`gameTurn.ts:56-77`), the
  `recordPlayFlags` wrapper (`gameTurn.ts:52-54`), and `wasExchange`.
- **Server:** `commitMove(io, game, applied: { state; move: AppliedMove })` is the one site. It
  records flags for a `play`, appends the replay for `play`/`pass`, assigns the state, broadcasts
  and persists. One `moveAction(io, game, userId, move)` with
  `MOVE_REFUSAL_CODES satisfies Record<MoveRefusal, { code: string; toast: boolean }>` replaces
  `playAction`, `passAction` and `exchangeAction` (`tableHandlers.ts:184-301`).
  - The silent codes stay silent: `NO_LIVE_GAME`, `NOT_YOUR_TURN`, `NO_EXCHANGE` and
    `NOT_YOUR_EXCHANGE`.
  - `MUST_PLAY_START_CARD` keeps its `{ rank }` param.
  - `game.firstMoveMade` tracking stays at the action, reading `prev.firstPlayMade`.
  - `startReplayLog()` becomes `[]` inline.
- **Offline:** `GameContext` has one private `act(move)`:
  `applyMove(state, actingSeat(state), move)`, then `commitState`. The public
  `playCards`/`passTurn`/`chooseExchangeCard` stay as one-line wrappers, since they are the slice
  interface `context/gameHooks.ts` and `GameTable` props read. `runBotTurn` commits
  `offlineBotMove(state)`.
- **Error modes a caller must know:** a `MoveResult` refusal leaves the state untouched. `null`
  from `autoMoveForSeat` means the seat cannot act. The server closes the table then, as today
  (`gameTurn.ts:203-219`).

### 4.2 The bot module owns every bot decision (E7)
```ts
// lib/game/bot.ts
export interface BotView {
  hand: Card[]; personality?: BotPersonalityId;
  toBeat: Combination | null;           // null when leading a new trick
  mustInclude?: Card;                   // the opening card, only for the seat holding it
  opponentHandCounts: number[]; partnerHoldsTop: boolean;
  playedRanks: number[] | undefined;    // `number[]` once E8 lands
  knownOpponentCard?: Card;
}
export function botView(state: GameState, seat: number): BotView;
export function botChoosePlay(view: BotView, rng?: () => number): Combination | null;
export function pickGivebackCard(hand: Card[], excludeCardId?: string): Card | undefined; // moved from gameEngine.ts
```
- **Offline:** `app/game.tsx`'s `onExchangeReady` calls `runBotTurn()`. `offlineBotMove` returns
  null unless the exchange winner is a bot, so a human winner is untouched. The ceremony timing is
  unchanged: the table still decides *when*, and the bot module decides *what*.
- **Deleted:**
  - `givebackCardId`, `botGivebackCardId`, `exchangeIsStuck` and `releaseStuckRef` in
    `app/game.tsx`
  - `releaseStuckExchange` in `GameContext`, `gameHooks.ts` and the four native test mocks
  - `resolveStuckExchange` and its five call sites
  - `tests/server/stuckExchange.test.ts` and the `resolveStuckExchange` describe block in
    `tests/engine/exchange.test.ts:172-207`
- **The valve's replacement:** an unsatisfiable open exchange can only arrive by restore. Add
  `exchangeIsSatisfiable(state): boolean` to the engine, beside `getValidGivebackCards`. Both
  restore seams refuse such a state: offline returns `incompatible`, the server returns
  `{ ok: false, reason }`. E8 later folds this into `parseGameState`.
- **Guards:** "one module chooses a bot's move" counts `pickGivebackCard` callers too. "gameEngine.ts
  exports no bot heuristic" then sees it, because it now lives in `bot.ts`.

### 4.3 Scoring as data (E4)
```ts
// lib/game/gameEngine.ts
export interface SeatScoring {
  engineId: string;            // player_<seat>
  key: string | null;          // what the seat scores under; null: it scores for nobody
  team?: "A" | "B";
  crownable: boolean;          // may cross the target alone, or be named a winner
  frozenKey?: string;          // a departed player's row: counts for the team, never crownable
}
export function placementPoints(finishIndex: number, playerCount: number): number; // 0-based index
export function foldRound(
  round: { finishingOrder: string[]; playerCount: number; gameMode: GameMode; length: MatchLength },
  ledger: { cumulative: Record<string, number>; target: number },
  seats: readonly SeatScoring[]
): FoldRoundResult;            // unchanged result shape
export function concedeRound(state: GameState, winnerSeat?: number): GameState; // clone; was gameTurn.ts
```
- **Invariants:**
  - Every key accumulates, so `accumulates` is deleted.
  - A key in `cumulative` that no seat lists as a crownable `key` is never crownable. That covers
    frozen rows, vacated `bot:<seat>` keys, and rows of a seat since reclaimed. It is the
    disconnect-policy row of `docs/GAME-RULES.md` § Decisions, now total rather than per-closure.
    In free-for-all today a frozen *userId* is "eligible" but can never newly cross, so no
    reachable outcome changes. The pin tests below prove that.
  - The team totals read every key with a team.
- **Builders, one each:**
  - `offlineSeats(state)` in `lib/game/matchFlow.ts`: key = engineId, crownable.
  - `seatScoringOf(game)` in `server/game/onlineGameLogic.ts`, replacing the three closures at
    `:378-398`.
- **Internal, no longer exported:** `resolveMatch`, `resolveTeamMatch`, `addPlacementPoints`,
  `nextMatchTarget` and `resolveMatchFor`. `targetsFor` stays exported only if `firstTargetFor`'s
  tests need it.
- **Other moves:**
  - `server/game/stats.ts` calls `placementPoints(placement - 1, playerCount)`.
  - `server/game/botSeat.ts` moves to `lib/game/botSeat.ts`, with no imports. `rating.ts` and
    `buildSeatRoster` (`onlineGameLogic.ts:203`) use `botSeatKey`/`isBotSeatKey`.

### 4.4 One deal, and the offline match flow (E5)
```ts
// lib/game/gameEngine.ts
export interface SeatSetup { name: string; type: PlayerType; personality?: BotPersonalityId } // no team, no id
export type Opening = { kind: "startCard" } | { kind: "exchange"; winnerSeat: number; loserSeat: number };
export function startRound(
  seats: readonly SeatSetup[], mode: GameMode,
  opts?: { firstSeat?: number; opening?: Opening; dealt?: Card[][] }
): GameState;                                   // ids are player_<seat>; team = teamForSeat(seat, n, mode)
export function openingAfter(finished: GameState): Opening; // exchange iff every seat placed and winner !== loser
export function seatsOf(state: GameState): SeatSetup[];
```
- **Error modes:** `startRound` throws on an `exchange` opening whose seats are out of range or
  equal, and on an invalid `dealt` (today's `:1128-1137`). It never falls back to a guessed seat.
- **Deleted:** `initializeGame`, `initializeRematch` and `PlayerSetupConfig.team`.
- **Server:**
  - `dealVotedRound`: `startRound(seatsOf(prev), room.gameMode, { firstSeat, opening: openingAfter(prev) })`.
  - `newTable`: `carriedFinishingOrder` becomes `carriedOpening(previous, roster): Opening`, which
    maps seats with no fabricated ids.
  - `OnlineGameState.gameMode` is deleted, and readers use `game.gameState.gameMode`.

```ts
// lib/game/matchFlow.ts — pure, node-loadable; GameContext and tests/helpers/offlineMatch.ts both import it
export interface OfflineTable { state: GameState; match: MatchState; dealFirstSeat: number }
export function freshMatch(length: MatchLength, playerCount: number): MatchState;   // from E4
export function applyRoundToMatch(match: MatchState, finished: GameState): MatchState; // from E4
export function startTable(seats: SeatSetup[], mode: GameMode, length: MatchLength, first?: GameState): OfflineTable;
export function advance(table: OfflineTable, next: GameState): OfflineTable;  // folds once, on the roundOver edge
export function dealNext(table: OfflineTable): OfflineTable;                  // a fresh match when match.over
```
- **Ordering contract:** `dealNext` reads `match.over` *before* it resets the match. That is the same
  ordering `dealVotedRound` documents for `dealFirstSeatFor` (`tableHandlers.ts:373-375`).
- `GameContext` holds one `OfflineTable | null`. The exchange announcement stays in `commitState`.
  `advance` returns the same `match` object when nothing was folded, so the slice memos keep their
  identity.
- `OfflineSave` loses `players` and `gameMode`, and `OFFLINE_SAVE_VERSION` goes to 4.

### 4.5 Restore and types (E1, E8, E9)
- **E1:** `persistedMatchSchema` gains `matchOver: z.boolean()`, and `toEnvelope` packs it.
  `fromEnvelope` reads it. `GAME_SCHEMA_VERSION` becomes 4. Nothing is live, so old rows are refused.
- **E8:** `parseGameState(unknown): { ok: true; state: GameState } | { ok: false; reason: string }`
  lives in `shared/gameStateSchema.ts`. It is the only way a stored `GameState` comes back, and
  both `decodeOfflineSave` and `unpackPersistedState` call it.
  - It checks the full card, player and phase shape.
  - It checks `playedRanks.length === RANK_SLOTS`.
  - It checks that each card appears once.
  - It checks `exchangeIsSatisfiable`.
  - `playedRanks` becomes required.
  - `bot.ts:46-51`, `openingIsPending` and `roundUnplayed` drop their `undefined` branches.
  - Both versions are bumped.
- **E9:** `ExchangePhase` becomes a union, with a typed wire view:
  ```ts
  type ExchangePhase =
    | { kind: "twoJokers"; winnerIdx: number; loserIdx: number }
    | { kind: "open"; winnerIdx: number; loserIdx: number; cardFromLoser: Card }
    | { kind: "settled"; winnerIdx: number; loserIdx: number; cardFromLoser: Card; cardToLoser: Card; settledAt?: number };
  type WireExchangePhase =
    | { kind: "twoJokers"; winnerIdx: number; loserIdx: number }
    | { kind: "open"; winnerIdx: number; loserIdx: number; cardFromLoser: Card }
    | { kind: "settled"; winnerIdx: number; loserIdx: number; cardToLoser?: Card };
  export function visibleExchangePhase(p: ExchangePhase | undefined, viewer: number | null, now?: number): WireExchangePhase | undefined;
  ```
  Every `.active` read becomes `kind === "open"`, and `cardFromLoser?.id` disappears.
  `PROTOCOL_VERSION` is bumped.

### 4.6 Layout (E3) and the refusal label (E2)
- **E2:**
  - `checkSelection` returns `{ ok: false; code: SelectionRefusal }`.
  - `readStagedPlay` computes
    `refusal = !myMove || selectedIds.length === 0 || check.ok ? "play" : check.code`.
  - `PlayButtonLabel = "play" | SelectionRefusal`.
  - `playButtonLabel` and `ComboShape` are deleted, along with `playRefusalParity.test.ts`, whose job
    disappears with the copy.
- **E3:** `lib/game` holds rules, bots, match flow and pure derivations only. A new
  `tests/tooling/libGameBoundary.test.ts` asserts that every *runtime* import in `lib/game/*.ts`
  resolves inside `lib/game/`. Type-only imports are exempt.
  - Floor: it scans at least 15 files and at least 20 imports, and fails on a planted probe line.
  - Moves to `lib/motion/`: `dealTimeline`, `exchangeTimeline`, `roundEnding`, `matchEnding`,
    `offlineBotDelay`, and `gateWatchdog` if #1624 has landed it.
  - Moves to `lib/placement.ts`: `placement.ts`.
  - Moves to `context/useExchangeAnnouncement.ts`: `useExchangeAnnouncement`.
  - `lib/exchangeCeremony.ts` is deleted. `exchangeAnnounceFrom` is renamed `exchangeAnnounceMs` in
    `lib/motion/exchangeTimeline.ts`.
  - The wire types in `matchState.ts` stay (type-only).

## 5. Migration (each step leaves main green)

| Step | Ticket | Deletes |
|---|---|---|
| 1 | E1 persist the verdict | `restoredMatchOver`, `teamKeyMap`, `endedByVote \|\|` in restore |
| 1′ (parallel) | E2 refusal label | `playButtonLabel`, `ComboShape`, `playRefusalParity.test.ts` |
| 2 | E3 layout | `lib/exchangeCeremony.ts`; six misfiled modules leave `lib/game` |
| 3 | E4 scoring as data | `FoldRoundInput` closures, `accumulates`, `resolveMatchFor` export, `pointsForPlacement`, `BOT_ID_PREFIX`, `ScoreboardRow`, server `concedeRound`, `applyRoundToMatch` in `GameContext`, harness mirror lines 31-89, the native `teamsSingleRound` |
| 4 | E5 one deal | `initializeGame`, `initializeRematch`, `carriedFinishingOrder`, `savedPlayerConfigs`/`savedGameMode`, `OfflineSave.players`/`.gameMode`, `PlayerSetupConfig.team`, `OnlineGameState.gameMode`, harness `dealFrom` mirror |
| 5 | E6 moves as data | `AutoMoveContext`, server `autoMoveForSeat` wrapper, `recordPlayFlags` wrapper, `startReplayLog`, `wasExchange`, three handlers' pre-checks, private `actingSeat` copy |
| 6 | E7 bot owns decisions | `resolveStuckExchange` and its five sites, the screen's giveback logic, `releaseStuckExchange`, 33 positional `botChoosePlay` calls |
| 7 | E8 parsed restore | two unvalidated casts, `playedRanks?` branches, the separate `exchangeIsSatisfiable` calls |
| 8 | E9 exchange union | `active`/`twoJokerException` flags, `cardFromLoser?.` reads, `Record<string, unknown>` |

## 6. No-regression strategy

**Pins before each move:** a test added in the ticket's first commit, green on main, unless marked
red.
- **E1:** red, then green.
  - `tests/server/tableState.test.ts` builds a free-for-all table whose vacated seat's `bot:2`
    reached the target with `matchOver` false, round-trips it through `toEnvelope`/`fromEnvelope`,
    and asserts `matchOver` is false. It is red today.
  - A second test covers the tie case (a crownable key and `bot:2` both at target, live `over`). It
    is also red today.
  - A third test covers a match winner vacated between rounds (`over` true, green today), which
    guards against alternative A.
  - The existing `restoredMatchOver` tests (`onlineGameLogic.test.ts:136-235`) are rewritten as
    round-trip cases with the same verdicts.
- **E4:**
  - Before the change, a table-driven test in `tests/engine/scoring.test.ts` records the current
    `foldRoundIntoMatch` results over a matrix: modes × lengths × {vacated, frozen partner, born
    bot, tie at target, tie at final rung}. It is built with the server's current closures.
  - After the change, the same matrix runs through `foldRound` plus `seatScoringOf` and asserts the
    same results.
  - `tests/server/roundEnd.test.ts`, `seatReclaim.test.ts:277` and `teams.test.ts` stay unchanged
    and green.
  - `concedeRound`: the existing vacate tests (`tests/server/roundOver.test.ts`,
    `voidAbandonedMatch.test.ts`) plus a new engine test for its ordering and its clone.
- **E5:**
  - Pin `tests/native/offlineDealFirstSeat.test.tsx`, `tests/engine/matchTerminates.test.ts` and the
    `tests/engine/exchange.test.ts` "round-to-round exchange setup" block.
  - Add an engine test that `startRound` with an out-of-range exchange seat throws, the old
    fallback's replacement.
  - Add a server test that `newTable` after a match with a changed roster deals the 3♠ opening when
    the winner left. This one exists as a behaviour today, so it is pinned first.
- **E6:**
  - First, a table-driven server test over every refusal path: code, toast or silent, and params.
    It drives the current three handlers through `tests/helpers/onlineTable.ts` and is green on
    main. The new `moveAction` must pass it unchanged.
  - `socketRoundFlags`, `weakSeatTakeover` and `commitMove` tests assert on `move` rather than on
    mutated maps.
- **E7:**
  - First, a native test: an offline bot winner gives its weakest legal card exactly once, and only
    after `onExchangeReady`. It extends `tests/native/gameContextExchange.test.tsx` and is green on
    main.
  - Then the move.
  - The guard tests change in the same commit. Their red proof: plant a
    `pickGivebackCard(` call in `app/game.tsx` and the guard fails.
- **E8:** red, then green. A restore of an open exchange with an empty winner hand is refused at
  both seams. It is red today, where the restore is accepted.
- **E9:** the protocol hash test (`tests/server/protocolVersion.test.ts`) and the exchange
  visibility tests are pinned.

**Which checks catch what:**
- `node --test` covers engine, server and ui-rules.
- jest covers provider and screen wiring (E5, E6, E7).
- None of these tickets moves layout. E7 changes when a bot gives, inside the existing
  `onExchangeReady` gate, so `tests/e2e/` motion specs (`exchangeAttribution`, `exchangeTeleport`)
  run as the before-pushing gate for E7 only. Unit tests cannot see layout.

## 7. Coverage table

| ID | Covered by | Note |
|---|---|---|
| L-001 | E1 | persist the verdict (alternative B); the verifier's "input divergence" is real, but a shared input still diverges when seats change after the fold |
| L-002 | E4 | `concedeRound` moves into the engine as a clone; the server assigns the result back |
| L-003 | E7 | the trigger moves to `runBotTurn`; `pickGivebackCard` moves to `bot.ts`; the guard covers it |
| L-004 | E5 (+E4 for the fold half) | primitives shared; `lib/game/matchFlow.ts` offline; server keeps its key mapping |
| L-006 | E7, then E8 | no valve: restore refuses an unsatisfiable exchange, which makes the state unreachable; `benchTable` and `botRound` lose theirs |
| L-007 | E4 | `SeatScoring[]` data; `accumulates` deleted |
| L-008 | E5 | `startRound` derives team; `SeatSetup` has none; the lobby renders `teamForSeat` |
| L-010 | E6 | `applyMove` plus `MoveResult`; `processPlay` keeps its throwing floor privately |
| L-011 | E6 | `autoMoveForSeat` returns `{ state, move }`; one `commitMove` records flags and replay |
| L-012 | E5 (`OnlineGameState.gameMode`), E8 (`playedRanks`, restore seam), E9 (`ExchangePhase`, `visibleExchangePhase`) | the online client's `WireGameState` typing goes to **client** (contract §9) |
| L-013 | E3 (`exchangeCeremony`), E4 (`ScoreboardRow`), E6 (`recordPlayFlags` wrapper, `startReplayLog`) | |
| L-014 | E4 | `botSeat.ts` moves to `lib/game` |
| L-015 | E3 | boundary test plus moves; the wire types in `matchState.ts` stay, since type-only imports load fine |
| L-016 | E4 | `placementPoints(finishIndex, n)`; the argument is named for its 0-based meaning |
| L-017 | E7 | `botView` plus `botChoosePlay(view, rng)` |
| L-018 | E4 (match internals), E5 (deal internals), E6 (combination internals plus a guard that every value export has a production importer) | no file split (owner: absorbed) |
| L-088 | E2 | gated by `myMove && selected > 0` (the verifier's fix_ok) |
| L-144 | E4 | part 1: `applyRoundToMatch` moves to `lib/game/matchFlow.ts` and `teamsSingleRound` moves to node; part 2 (i18n without expo-localization) goes to **client** or **test-harness** (§9); part 3 is dropped (owner) |
| L-146 | E4 (`applyRoundToMatch` mirror), E5 (`dealFrom` mirror), E7 (`playRoundOut` helper plus the `BotView` options object) | the harness already calls `offlineBotMove` (verifier); only the accounting mirrors die |

## 8. Proposed tickets

All tickets are ordered by GitHub "blocked by" edges. A ticket that edits `gameEngine.ts` is never
parallel with another that does.

**E1 — Restore reads the match verdict instead of re-deriving it.** Size S.
- Files: `shared/persistedEnvelope.ts`, `server/game/tableState.ts`,
  `server/game/onlineGameLogic.ts` (delete `:249-296`), `tests/server/tableState.test.ts`,
  `tests/server/onlineGameLogic.test.ts`, `tests/server/persistedEnvelope.test.ts`.
- Blocked by: #1628 (`onlineGameLogic.ts`).
- Definition of done:
  - [ ] Two red tests from §6 E1, then green.
  - [ ] The winner-left test stays green.
  - [ ] `matchOver` is in `persistedMatchSchema` and `toEnvelope`, and `GAME_SCHEMA_VERSION` is 4.
  - [ ] `fromEnvelope` reads it, and `restoredMatchOver`/`teamKeyMap` are gone.
  - [ ] The `tableState.ts:192` doc says what is derived (`botSeatsAtStart` only).
- Checks: `node --test tests/server/tableState.test.ts tests/server/persistedEnvelope.test.ts`; before
  pushing, `npm run agent:check`.

**E2 — GIOCA's refusal is the engine's code.** Size S.
- Files: `lib/game/gameEngine.ts` (`SelectionRefusal`, the `:422-425` comment),
  `components/table/stagedPlay.ts`, `components/turnTimerUi.ts`, `components/table/spokenLabels.ts`,
  `components/tutorialRefusal.ts`, `tests/ui-rules/turnTimerUi.test.ts`, a new
  `tests/ui-rules/stagedPlay.test.ts`, and deletes `tests/ui-rules/playRefusalParity.test.ts`.
- Blocked by: none in this area; any **table-ui** ticket editing these files.
- Definition of done:
  - [ ] Before the swap, port the parity matrix into a `readStagedPlay` test (green).
  - [ ] Swap; the same matrix stays green.
  - [ ] Empty selection, not my turn and finished all read `"play"`.
  - [ ] `playButtonLabel` and `ComboShape` are gone.
- Checks: `node --test tests/ui-rules/stagedPlay.test.ts tests/ui-rules/turnTimerUi.test.ts`;
  `npm run agent:check`.

**E3 — `lib/game` holds only the game: motion and UI modules move out, and a boundary test keeps it
so.** Size M.
- Files: the moves listed in §4.6 and every importer (about 45, mostly tests);
  `tests/ui-rules/oneClock.test.ts` `MOTION_FILES`; `tests/tooling/repoLayout.test.ts`
  `LIB_FOLDERS`; docs naming the paths; `server/game/gameTurn.ts` and `onlineGameLogic.ts` imports;
  the new `tests/tooling/libGameBoundary.test.ts`.
- Blocked by: E1, #1624, #1639, and any **time** or **table-ui** ticket editing the moved files.
- Definition of done:
  - [ ] The boundary test is red on main (lists the six offenders) and green after.
  - [ ] It has a floor and a planted-probe self-test.
  - [ ] `lib/exchangeCeremony.ts` is deleted.
  - [ ] `oneClock` and `repoLayout` pass with the new paths.
  - [ ] No behaviour change: the full jest run, plus `exchangeTimeline` and `dealSchedule` in
    ui-rules.
- Checks: `node --test tests/tooling/libGameBoundary.test.ts tests/ui-rules/oneClock.test.ts`;
  `npm run agent:check`.

**E4 — Scoring takes seats as data; offline match accounting leaves the provider.** Size M.
- Files: `lib/game/gameEngine.ts` (fold section, `placementPoints`, `concedeRound`, un-exports), a
  new `lib/game/matchFlow.ts` (`freshMatch`, `applyRoundToMatch`, `offlineSeats`),
  `lib/game/botSeat.ts` (moved), `lib/game/rating.ts`, `server/game/onlineGameLogic.ts`,
  `server/game/gameTurn.ts` (`concedeRound`), `server/game/stats.ts`, `server/game/roundOver.ts`
  (imports), `context/GameContext.tsx`, `tests/helpers/offlineMatch.ts`,
  `tests/engine/scoring.test.ts`, `tests/engine/teams.test.ts`, and
  `tests/native/teamsSingleRound.test.tsx` moved to `tests/engine/`.
- Blocked by: E3, E2.
- Definition of done:
  - [ ] Pin the fold matrix (§6) first.
  - [ ] `foldRound(round, ledger, SeatScoring[])` replaces `foldRoundIntoMatch`.
  - [ ] `seatScoringOf` is the server's one builder.
  - [ ] The harness imports `applyRoundToMatch`/`freshMatch`, and its banner no longer says
    "mirrored".
  - [ ] `pointsForPlacement` is gone.
  - [ ] One `bot:` spelling remains: grep `"bot:"` outside `botSeat.ts` finds none in production.
  - [ ] `concedeRound` is an engine clone and the server assigns it.
  - [ ] Match internals are un-exported.
- Checks: `node --test tests/engine/scoring.test.ts tests/engine/teams.test.ts tests/server/roundEnd.test.ts tests/engine/matchTerminates.test.ts`;
  `npm run agent:check`.

**E5 — One way to deal the next round, team derived from the seat.** Size M.
- Files: `lib/game/gameEngine.ts`, `lib/game/matchFlow.ts`, `lib/game/matchState.ts`
  (`PlayerSetupConfig`), `context/GameContext.tsx`, `lib/offlineSave.ts` (v4 plus fixture),
  `app/lobby.tsx`, `server/game/tableHandlers.ts` (`dealVotedRound`), `server/game/tableState.ts`,
  `server/game/gameRoom.ts`, `server/game/roundOver.ts`, `server/socket/socketTable.ts`
  (`gameMode` reads), `lib/e2eOpener.ts`, `lib/diagnostics/benchTable.ts`,
  `scripts/measureHeadsUpBalance.ts`, the harness, and the 17 test files calling
  `initializeGame`/`initializeRematch` (mechanical).
- Blocked by: E4.
- Definition of done:
  - [ ] Pins from §6 E5 are green first.
  - [ ] `startRound`/`openingAfter`/`seatsOf` replace both initializers.
  - [ ] No caller passes `team`.
  - [ ] `GameContext` holds `OfflineTable` and calls `startTable`/`advance`/`dealNext` only.
  - [ ] The harness's `dealFrom` mirror is gone.
  - [ ] `OnlineGameState.gameMode` is gone.
  - [ ] `OFFLINE_SAVE_VERSION` is 4, with a refreshed fixture.
  - [ ] Deal internals are un-exported.
- Checks: `node --test tests/engine/exchange.test.ts tests/engine/offlineSave.test.ts tests/server/tableState.test.ts tests/engine/matchTerminates.test.ts`;
  `npx jest tests/native/offlineDealFirstSeat.test.tsx tests/native/offlineResume.test.tsx`;
  `npm run agent:check`.

**E6 — Moves are data: `applyMove`, a pure `autoMove`, one commit site.** Size M.
- Files: `lib/game/gameEngine.ts`, `lib/game/autoMove.ts`, `server/game/tableHandlers.ts`,
  `server/game/gameTurn.ts`, `server/game/dealRound.ts`, `server/game/tableState.ts`
  (`startReplayLog`), `server/game/replayShape.ts`, `context/GameContext.tsx`,
  `tests/helpers/offlineMatch.ts`, the server tests calling `autoMoveForSeat` (5 files), and
  `tests/helpers/liveGame.ts`.
- Blocked by: E5. Coordinate with **lastMove** (§9).
- Definition of done:
  - [ ] The refusal-path pin is green on main first, then green after.
  - [ ] There is one `moveAction`, with a `MOVE_REFUSAL_CODES satisfies` table.
  - [ ] No `next === state` checks remain.
  - [ ] `recordPlayFlags` is called from `commitMove` only (grep).
  - [ ] `AutoMoveContext` is gone.
  - [ ] `GameContext` has one `act`.
  - [ ] A guard test: every value export of `gameEngine.ts` has a production importer. It has a
    floor (at least 20 exports scanned) and a planted-probe self-test.
- Checks: `node --test tests/server/commitMove.test.ts tests/server/socketRoundFlags.test.ts tests/server/weakSeatTakeover.test.ts tests/engine/engineFloor.test.ts`;
  `npm run agent:check`.

**E7 — The bot module owns every bot decision; the offline exchange goes through it.** Size M.
- Files: `lib/game/bot.ts`, `lib/game/autoMove.ts`, `lib/game/gameEngine.ts`
  (`exchangeIsSatisfiable`, removes `pickGivebackCard`), `app/game.tsx`, `context/GameContext.tsx`,
  `context/gameHooks.ts`, `lib/offlineSave.ts`, `server/game/tableState.ts`,
  `lib/diagnostics/benchTable.ts`, `tests/native/helpers/botRound.ts`, the four native mocks,
  `tests/ui-rules/contextSlices.test.ts`, `tests/engine/matchState.test.ts` guards,
  `tests/engine/exchange.test.ts`, deletes `tests/server/stuckExchange.test.ts`, the `tests/bots/*`
  `botChoosePlay` calls, `scripts/measureHeadsUpBalance.ts`, `tests/engine/helpers.ts`
  (`playRoundOut`), and the docs: `docs/GAME-RULES.md` §10 pointer and the "What the winner may hand
  back" row's pointer, plus `docs/ARCHITECTURE.md:299`.
- Blocked by: E6, #1624, #1639.
- Definition of done:
  - [ ] The giveback-timing pin is green first.
  - [ ] `onExchangeReady` calls `runBotTurn`.
  - [ ] `resolveStuckExchange` has zero references.
  - [ ] Both restores refuse an unsatisfiable exchange (new tests).
  - [ ] The guard counts `pickGivebackCard`, with a red proof noted in the PR.
  - [ ] `botChoosePlay(view, rng)`, and `botView` is the production builder.
  - [ ] The four round loops use `playRoundOut`.
  - [ ] No rule text changes in GAME-RULES; pointers only.
- Checks: `node --test tests/engine/exchange.test.ts tests/engine/matchState.test.ts tests/bots`;
  `npx jest tests/native/gameContextExchange.test.tsx tests/native/exchangeHoldsTheTurn.test.tsx`;
  before pushing, `npm run agent:check` plus the e2e `exchangeAttribution` and `exchangeTeleport`
  specs.

**E8 — A stored `GameState` is parsed, not cast; `playedRanks` is required.** Size M.
- Files: a new `shared/gameStateSchema.ts`, `shared/persistedEnvelope.ts`, `lib/offlineSave.ts`,
  `lib/game/gameEngine.ts`, `lib/game/bot.ts`, fixtures, `tests/server/persistedEnvelope.test.ts`,
  and `tests/engine/offlineSave.test.ts`.
- Blocked by: E7, and **test-harness**'s `stateFixture` ticket (the 91 test files with hand-built
  states must already use it).
- Definition of done:
  - [ ] Red test: an empty-winner exchange restores today, so it is red on main before E7. Here it
    asserts the reason string from `parseGameState`.
  - [ ] Both seams call `parseGameState`.
  - [ ] No `as unknown as GameState`/`gameState: S` casts on restore.
  - [ ] `playedRanks` is required, and its `?? 0`/`?? false` branches are gone.
  - [ ] Both versions are bumped, with fixtures refreshed.
- Checks: `node --test tests/server/persistedEnvelope.test.ts tests/engine/offlineSave.test.ts`;
  `npm run agent:check`.

**E9 — `ExchangePhase` as a union, with a typed wire view.** Size M.
- Files: `lib/game/gameEngine.ts`, `lib/game/autoMove.ts`, `lib/game/bot.ts`,
  `lib/game/sharedGameFlow.ts`, `server/game/onlineGameLogic.ts`, `server/game/gameTurn.ts`,
  `server/game/gamePersistence.ts`, `server/game/tableHandlers.ts`, `shared/protocol.ts`,
  `shared/gameStateSchema.ts`, `components/table/exchangeModel.ts`, `useTableExchange.ts`,
  `GameTable.tsx`, `app/tutorial.tsx`, `context/OnlineGameContext.tsx`, and the tests.
- Blocked by: E8, **client** (online state typed as `WireGameState`), **lastMove** (the
  exchange-announcement rewrite).
- Definition of done:
  - [ ] Zero `.active`/`twoJokerException` reads.
  - [ ] Zero `cardFromLoser?.`.
  - [ ] `visibleExchangePhase` returns `WireExchangePhase`.
  - [ ] `PROTOCOL_VERSION` bumped, with its hash recorded.
  - [ ] Exchange visibility, rearm and native exchange tests are green.
- Checks: `node --test tests/server/exchangeVisibility.test.ts tests/server/exchangeRearm.test.ts tests/ui-rules/exchangeModel.test.ts`;
  `npx jest tests/native/exchange*`; `npm run agent:check`.

**Order:** E1 → E3 → E4 → E5 → E6 → E7 → E8 → E9. E2 runs parallel with E1 and E3, and blocks E4.

## 9. Cross-area contracts

- **lastMove (L-005/L-070/L-009).**
  - **I give:** `applyMove`/`AppliedMove` (E6) as the one place every seat move becomes a state.
    `lastMove` should be written there, from the `AppliedMove`, plus in `startRound` (E5) for
    `kind: "deal"`.
  - **I need:** lastMove to own `exchangeAnnouncementOf`/`buildExchangeAnnounce` (they stay in
    `lib/game/sharedGameFlow.ts`; E3 moves only the hook) and the harness's
    `computeBotTurnKey`/collision search. If lastMove lands before E6, E6 keeps its writes.
  - **Shared:** every `GameState` shape change bumps both schema versions. E5, E8 and E9 do, and so
    does lastMove. Whoever lands second bumps again; nothing is live.
- **time.**
  - E3 moves `dealTimeline`, `exchangeTimeline`, `gateWatchdog` and `offlineBotDelay` to
    `lib/motion/` and deletes `lib/exchangeCeremony.ts`.
  - A time ticket editing those files goes before E3 or rebases onto the new paths. The server's
    timing import becomes `lib/motion/exchangeTimeline.ts`.
- **server-runtime.**
  - E1, E5 and E6 edit `server/game/tableState.ts`, `tableHandlers.ts`, `gameTurn.ts`,
    `dealRound.ts` and `gameRoom.ts`.
  - `OnlineGameState` loses `gameMode` (E5) and gains a persisted `matchOver` (E1).
  - Any server-runtime ticket on those files is ordered against them.
- **server-output.**
  - E9 retypes `visibleExchangePhase`.
  - If your design moves `RoundOverPayload`/`ScoreLine` out of `lib/game/matchState.ts` (F19, a full
    schema), that move is yours. E3 leaves those types in place.
  - E4 deletes `ScoreboardRow`.
- **client.**
  - **I need:** the online provider to type its state as `WireGameState` (L-012's wire part) before
    E9.
  - E5 changes the shape of `app/lobby.tsx` and `GameContext`.
  - E7 removes `releaseStuckExchange` from `useLocalExchange`. A client ticket re-exporting slice
    hooks (L-061) is ordered against E7.
  - L-144 part 2 (i18n string tables without expo-localization) is not in this design: client or
    test-harness owns it.
- **table-ui.**
  - E2 owns `components/turnTimerUi.ts` `playButtonLabel` and `stagedPlay.ts` `readStagedPlay`.
  - E3 rewrites imports in `components/table/{ExchangeLegs,exchangeModel,useTableExchange,deal,dealSlots,hand,handRow,useRoundEnding,scorePill}.tsx?`
    and `GameTable.tsx`.
  - E9 rewrites `exchangeModel.ts` and `useTableExchange.ts`.
  - E7 edits `app/game.tsx`'s exchange-ready path only.
- **test-harness.**
  - **I need:** a `stateFixture()` builder with the hand-built `GameState` literals migrated onto it,
    before E8.
  - **I give:** `lib/game/matchFlow.ts` (E4, E5), so `simulateOfflineMatch` soaks production code,
    and `playRoundOut` (E7).
  - Seeded deals (F11, `RandomSource`) are not in this design. If test-harness injects randomness,
    `startRound`'s `dealt` option stays and `random` can be added beside it.
- **static-checks.**
  - E3 adds `tests/tooling/libGameBoundary.test.ts`.
  - E6 adds the export-has-a-production-importer guard.
  - E7 widens the one-bot guard.
  - Each has a floor and a probe, per CLAUDE.md's no-self-defeating-safeguards invariant.

## 10. Owner decisions needed

None blocks a ticket. I decided these from the code, and say so so the owner can overturn them:

1. **Persist `matchOver` (E1) instead of re-deriving it.** This reverses the unrecorded code choice
   "derived from what is" (`tableState.ts:192`). Reason: re-derivation diverges whenever the seats
   change after the fold.
2. **No stuck-exchange valve (E7).** This deletes `resolveStuckExchange`, which #1638 maintained
   days ago. Reason: a dealt round cannot reach the state. With both restores refusing an
   unsatisfiable exchange, nothing can reach it, so the valve guards nothing. L-006 itself allows
   this ("if any is wanted").
3. **The engine checks turn ownership (E6).** `applyMove(state, seat, …)` refuses `notYourTurn`. The
   transport still maps user to seat. This rewrites the `gameEngine.ts:463-466` comment. It is not
   a recorded decision.
4. **E9 changes the wire shape of `exchangePhase`** and bumps `PROTOCOL_VERSION`. Nothing is live.
5. **No rule changes anywhere.** `gameEngine.ts` stays the rules home (the CLAUDE.md invariant holds;
   `matchFlow.ts` composes rules and states none). GAME-RULES §10 and the "What the winner may hand
   back" row get a code-pointer edit only (`pickGivebackCard` moves to `lib/game/bot.ts`). Check
   `tests/tooling/gameRuleDecisions.test.ts` accepts a pointer edit to a decision row.
