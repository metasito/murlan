# Design audit: the game domain core (lib/game, shared, and the callers in server/game and context)

Auditor report, 2026-10-16, commit `d8c34919`. I read all of this code and changed nothing. Every claim below comes from reading the cited lines. Root: `C:/Users/roton/murlan/.claude/worktrees/codebase-design-audit-6b14f2`. Every dependency in the engine runs in-process unless a finding says otherwise. The findings are ordered by priority.

---

## P1

### F1. The offline bot's exchange choice bypasses `autoMove.ts`, and the guard tests cannot see it
- **Where:**
  - `app/game.tsx:132-157` computes the bot's giveback and the stuck state itself, then calls `chooseExchangeCard(botGivebackCardId)` or `releaseStuckExchange()`.
  - `context/GameContext.tsx:230-245` and `270-273` receive those calls.
  - `lib/game/gameEngine.ts:981-985` defines `pickGivebackCard`, whose docstring reads "The card a bot gives back".
  - `lib/game/autoMove.ts:84-90` makes the same choice for the server.
- **What's wrong:**
  - CLAUDE.md's invariant says one module chooses a bot's move. Offline, that holds for plays only. The bot's exchange decision is made in a screen.
  - The guard `tests/engine/matchState.test.ts:203-216` counts callers of `botChoosePlay` only.
  - The guard "gameEngine.ts exports no bot heuristic" (`:272-282`) passes because the giveback heuristic lives in `gameEngine.ts`. A guard that exempts what it guards is a self-defeating safeguard (CLAUDE.md).
  - The interface is leaky: a screen has to know the bot rule, the stuck rule and the `cardFromLoser?.id` exclusion.
- **Proposed interface:**
  - Move `pickGivebackCard` into `bot.ts`.
  - The offline exchange-ready callback calls `runBotTurn()`. That goes through `offlineBotMove(state)`, which already reaches the exchange branch of `autoMoveForSeat`, because `initializeRematch` sets `currentTurnIndex` to the winner.
  - Derive the announcement from the move (F3), not from which callback ran.
- **Effect:**
  - Delete `givebackCardId`, `botGivebackCardId` and `exchangeIsStuck` from `app/game.tsx` (about 25 lines).
  - Delete `GameContext.releaseStuckExchange` and the `useLocalExchange.releaseStuckExchange` field.
  - The "one bot" guard can then cover every bot decision.
  - Bug class removed: online and offline bots choosing gives differently.
- **Effort:** S–M. **Risk:** the exchange ceremony timing offline. `onExchangeReady` still decides *when* the bot gives, only not *what*.

### F2. The match lifecycle (start, fold a round, roll forward, deal next) has no module and exists three times
- **Where:**
  - **Offline** (`context/GameContext.tsx`):
    - `freshMatch` at `:71-81`
    - `applyRoundToMatch` at `:87-113`
    - `commitState` at `:174-178`
    - `dealFrom`, `startNextRound` and `startNewMatch` at `:203-228`
    - the redundant state `savedPlayerConfigs` and `savedGameMode` at `:149-150`, which can be derived from `gameState.players` and `gameState.gameMode`
  - **Server:**
    - `tableHandlers.ts:361-397` (`dealVotedRound`: next deal plus the `initializeRematch`/`initializeGame` choice)
    - `tableState.ts:68-138` (`carriedFinishingOrder`, `newTable`)
    - `roundOver.ts:323-331` (`rollMatchForward`)
    - `onlineGameLogic.ts:348-399` (fold)
  - **Online client:** `OnlineGameContext.tsx:59-70` sets `INITIAL_MATCH.target = MATCH_TARGETS[0]` rather than `firstTargetFor(playerCount)`.
  - **Test harness:** `tests/helpers/offlineMatch.ts:31-85` and `:360-380`.
    - It keeps a "Verbatim copy of context/GameContext.tsx's `applyRoundToMatch`" plus `freshMatch` and `MatchState`.
    - It "Mirrors `GameContext.tsx`'s `dealFrom` exactly", and its banner says "a change to either copy has to be carried to the other by hand".
    - `tests/native/teamsSingleRound.test.tsx:2-6` has to run under native jest only because `applyRoundToMatch` lives in a `.tsx` context.
- **What's wrong:**
  - The domain logic sits behind a React provider (the wrong seam), so it cannot be tested through an interface and gets copied instead.
  - `initializeRematch(setup, mode, prevFinishingOrder, firstSeat)` leaks:
    - It reads only `[0]` and `[last]` of the order.
    - It silently falls back to seat 0 or the last seat when an id misses (`gameEngine.ts:876-880`).
    - It takes a setup that duplicates `state.players`. As a result `OfflineSave` persists `players` and `gameMode` (`lib/offlineSave.ts:29-31`, plus checks at `:76-77`), and `tableState.carriedFinishingOrder` fabricates a two-element "finishing order" `["player_W","player_L"]` (`:90`).
- **Proposed interface (pure, `lib/game/matchFlow.ts`):**
  ```ts
  interface Table { state: GameState; match: MatchState; dealFirstSeat: number }
  startMatch(seats: SeatSetup[], mode: GameMode, length: MatchLength, opts?: { random?: RandomSource }): Table
  commit(table: Table, next: GameState): Table            // folds exactly once, on the roundOver edge
  dealNext(table: Table, opts?: { newMatch?: boolean; random?: RandomSource }): Table
  // engine:
  dealNextRound(prev: Pick<GameState,"players"|"gameMode">,
                carry: { winnerSeat: number; loserSeat: number } | null,
                firstSeat: number, random?: RandomSource): GameState
  ```
  The server keeps its own key mapping (F5) but calls `dealNextRound` and the same match start and roll-forward.
- **Effect:**
  - About 70 mirrored lines leave `offlineMatch.ts`.
  - The two state slots in `GameContext` and two `OfflineSave` fields (with their decode checks) go away.
  - Three `initializeRematch`-or-`initializeGame` branches become one call.
  - `teamsSingleRound` moves to `node --test`.
  - Bug class removed: the harness passing against a stale copy of the app's logic.
- **Effort:** M. **Risk:**
  - `OFFLINE_SAVE_VERSION` needs a bump. Memory says nothing is live yet.
  - `dealVotedRound`'s ordering comment (`matchOver` is read before `dealRound` flips it) has to move into `dealNext`.

### F3. `GameState` has no record of what just happened, so consumers diff fields and invent keys
- **Where:**
  - `trickClosedWithWinner` (`components/flightPhysics.ts:337-352`)
  - `useTableFeedback.ts:281-322`: "`processPass` zeroes `passCount` on the pass that closes a trick, so the trick closing stands in for that edge"
  - `components/table/pile.tsx:827-842`: "processPlay leaves that field standing"
  - The online exchange announcement uses three refs to diff states (`OnlineGameContext.tsx:571-597`).
  - The composite key `${currentTurnIndex}|${passCount}|comboKey` appears in `app/game.tsx:113-123` and `GameTable.tsx:1054-1058`. It is reproduced in `tests/helpers/offlineMatch.ts` as `computeBotTurnKey`, with a whole collision-hunting feature (`collectBotTurnKeyCollisions`, `BotTurnKeyCollision`).
- **What's wrong:**
  - The UI depends on the engine's internal ordering of field writes, which is a leaky interface.
  - Event identity is reconstructed heuristically, and the harness has to search for key collisions.
  - Online and offline derive "an exchange was given" in two different ways (a state diff versus the callback site), which is part of why F1 exists.
- **Proposed interface:**
  ```ts
  interface LastMove { seq: number; seat: number;
    kind: "deal" | "play" | "pass" | "giveback" | "stuckRelease"; closedTrick: boolean }
  GameState.lastMove: LastMove   // written by every transition and by initialize*/dealNextRound
  ```
- **Effect:**
  - Turn and bot keys become `lastMove.seq`, so collisions are impossible and the collision harness can be deleted.
  - `trickClosedWithWinner`, `prevPassCountRef`, `prevTrickClosedRef` and the three online refs collapse to reading `lastMove`.
  - One `exchangeAnnouncementFor(state)` serves both providers.
  - `openingIsPending` and `roundUnplayed` (`gameEngine.ts:1043-1066`, which infer "nobody played" from an empty `playedRanks`) become `lastMove.kind === "deal"`.
- **Effort:** M–L. **Risk:**
  - The persisted shape changes, so bump both schema versions.
  - 118 hand-built `GameState` literals in 99 test files (`grep "trickWinner: null"`). Add a shared `stateFixture()` first.

### F4. The verdict on restore is derived differently from the live verdict (a latent bug)
- **Where:**
  - `tableState.ts:189-197` calls `restoredMatchOver` (`onlineGameLogic.ts:277-296`).
  - Live, `foldRoundIntoMatch` (`gameEngine.ts:1464-1484`) races free-for-all on `winEligibleCumulative`, which excludes a vacated seat's `bot:<seat>` key.
  - `restoredMatchOver` passes all `scores`.
- **What's wrong:** two implementations answer "is this match decided?" (the comment at `gameEngine.ts:1325` claims one).
  - A free-for-all table whose vacated seat's `bot:<seat>` total reached the target persists live as running.
  - After a restart the same row restores as `matchOver: true`, winner `bot:<seat>`. A tie case can flip the other way.
  - `teamOfKey` is also built twice: `teamKeyMap` (`onlineGameLogic.ts:255-268`) and inside the fold (`gameEngine.ts:1421-1430`).
  - No test covers vacated free-for-all on restore (`tests/server/onlineGameLogic.test.ts:136-215`).
- **Proposed interface:** split the fold.
  ```ts
  awardRound(order, seats: SeatScoring[], cumulative): { roundByKey; cumulative }
  judgeMatch(cumulative, seats: SeatScoring[], target, length, mode): Verdict
  ```
  Restore calls `judgeMatch` with the same `SeatScoring` the live path builds. Alternatively, persist the verdict.
- **Effect:**
  - One verdict path, so "restore disagrees with live" becomes impossible.
  - `teamKeyMap` and `restoredMatchOver` are deleted.
  - Add a red test first: a vacated free-for-all seat at the target.
- **Effort:** S. **Risk:** low.

---

## P2

### F5. `FoldRoundInput` is a wide, closure-based interface with dead flexibility
- **Where:** `gameEngine.ts:1342-1378` takes `keyOf`, `accumulates`, `winEligible` (which defaults to `accumulates`), `teamOf` and `frozenKeysOf`.
  - The server builds three closures (`onlineGameLogic.ts:378-398`). Offline passes identity (`GameContext.tsx:100`).
  - `accumulates` has no production caller. It appears only in `tests/engine/scoring.test.ts:428`, whose own comments (`:302-333`) record that the policy moved away from it.
- **What's wrong:** the interface is shallow relative to its implementation. The caller has to understand how the closures interact, including the default chaining and that frozen keys are never nameable.
- **Proposed interface:**
  ```ts
  interface SeatScoring { engineId: string; key: string | null; team?: string;
                          frozenKey?: string; crownable: boolean }
  foldRoundIntoMatch(round: { finishingOrder; playerCount; length; gameMode },
                     ledger: { cumulative; target }, seats: SeatScoring[]): FoldRoundResult
  ```
- **Effect:**
  - `accumulates` is deleted.
  - The server's policy becomes data and can be tested by value.
  - This is the input F4's `judgeMatch` needs.
- **Effort:** S. **Risk:** low.

### F6. "What the table demands of the seat on move" is derived in five places, and `startCard`/`firstPlayMade` encode one obligation in two fields
- **Where:**
  - `gameEngine.ts:490` (`checkSelection`)
  - `autoMove.ts:97-103`
  - `components/table/stagedPlay.ts:40-45` (`whatMustBeMet`)
  - `components/GameTable.tsx:1620`
  - `tests/helpers/offlineMatch.ts` (`weakestBeatingPlay`)
  - `getAllValidPlays(hand, lastPlayed, isNewTrick, requireCard?)` (`:509`) takes a redundant pair. Every caller passes `isNewTrick ? null : last`.
  - `initializeRematch` sets `firstPlayMade: true` to mean "no opening owed" (`:910`, `:935`). As a result `firstPlayMade` cannot answer "has anyone played", which forces the `playedRanks` inference in `openingIsPending` and `roundUnplayed` (`:1020-1066`, a 25-line comment).
- **Proposed interface:**
  ```ts
  GameState.openingCard: Card | null      // replaces startCard? + firstPlayMade; cleared by processPlay
  tableDemand(state): { toBeat: Combination | null; mustInclude: Card | null }
  legalPlays(state, seat): Combination[]
  getAllValidPlays(hand, toBeat: Combination | null, mustInclude?: Card)
  ```
- **Effect:**
  - Five derivations become one.
  - The `isNewTrick` parameter is gone.
  - Together with F3, the opening predicates become one-liners.
- **Effort:** M because of the persisted shape and the fixtures. **Risk:** medium. The rule semantics are unchanged, but this touches GAME-RULES-backed code.

### F7. Three transitions use three error modes, and every caller pre-checks
- **Where:**
  - `processPlay` throws (`assertPlayable`, `:690-710`).
  - `processPass` returns its input when refused (`:788`).
  - `processExchangeChoice` returns its input with no reason code (`:949-978`). Callers detect a refusal by identity: `GameContext.tsx:234` and `tableHandlers.ts:294-298`, which then invent `INVALID_CARD`.
  - The server's `playAction` pre-checks `exchangePhase.active` (`tableHandlers.ts:208-211`), duplicating `checkPlay`'s `exchangeOpen`. `PLAY_REFUSAL_CODES` (`:182-192`) already maps it.
  - `GameContext.playCards` and `passTurn` (`:247-262`) call check-then-process.
- **Proposed interface:**
  ```ts
  type Move = { kind: "play"; cardIds: string[] } | { kind: "pass" } | { kind: "giveback"; cardId: string };
  type MoveRefusal = PlayRefusal | PassRefusal | "notExchangeWinner" | "notGiveable";
  applyMove(state: GameState, seat: number, move: Move):
    { ok: true; state: GameState; combo: Combination | null } | { ok: false; code: MoveRefusal };
  ```
  `processPlay` keeps its throwing floor internally.
- **Effect:**
  - `tableHandlers` `playAction`, `passAction` and `exchangeAction` (`:198-301`, about 100 lines) shrink to about 40.
  - `GameContext`'s three callbacks become one `act(move)`.
  - Refusal codes become uniform.
- **Effort:** M. **Risk:** low to medium. The server keeps its turn-ownership check.

### F8. `autoMoveForSeat` reports its result through a callback and an in-place mutation; achievement flags are recorded at three sites
- **Where:**
  - `autoMove.ts:54-69` and `105-143`: `ctx.onMove` and `ctx.roundFlags` are mutated.
  - The server wraps it just to recover the move (`gameTurn.ts:118-131`) and computes `wasExchange` beforehand (`:293`).
  - `recordPlayFlags` runs at `autoMove.ts:124` and `:138`, and in `tableHandlers.ts:234` through a pass-through wrapper (`gameTurn.ts:104-106`).
  - `autoMove.ts:22-26` documents the bug class: a path that forgets the flags under-counts achievements.
- **Proposed interface:**
  ```ts
  autoMove(state, seat, strength: "bot" | "floor", rng?): { move: Move; next: GameState } | null
  ```
  Pure. `commitMove(io, game, next, move)` records the flags and the replay from `move` at one site.
- **Effect:**
  - `AutoMoveContext`, the server wrapper and the `recordPlayFlags` wrapper are deleted.
  - A forgotten-flags path becomes impossible.
  - Server tests that drive `autoMoveForSeat` (`weakSeatTakeover`, `socketRoundFlags`, `stuckExchange`: 15 calls) assert on `move` rather than on mutated maps.
- **Effort:** S–M. **Risk:** low.

### F9. The team has two sources of truth
- **Where:**
  - `Player.team` is optional and supplied by callers. Every caller must remember `teamForSeat`:
    - `app/lobby.tsx:152` and `:180` (on count change and on mode change)
    - `tableState.ts:107`
    - `dealVotedRound` strips team outside teams mode (`tableHandlers.ts:371`)
  - `bot.ts:148-156` ignores `Player.team` and recomputes from `teamForSeat`.
  - Scoring reads `p.team` (`GameContext.tsx:88-91`, `onlineGameLogic.ts:359-362`, `scorePill.ts`, `matchState.isDrawnRound`).
- **Proposed interface:** `initializeGame` and `dealNextRound` derive `team = teamForSeat(seat, n, gameMode)`, and `SeatSetup` drops `team`.
- **Effect:** four caller sites lose team plumbing, and a player whose team disagrees with the mode becomes impossible.
- **Effort:** S. **Risk:** low.

### F10. A server rule mutates engine state outside the engine
- **Where:** `gameTurn.ts:339-356` (`concedeRound`) writes `finishPosition`, `finishingOrder` and `roundOver` in place on `game.gameState`. It is a sibling of the engine's private `placeLastSeat` (`gameEngine.ts:668-673`).
- **Proposed interface:** `concedeRound(state, winnerSeat?: number): GameState` in the engine, returning a clone.
- **Effect:**
  - The placement rule (fewest cards first, seat as tiebreak) lives with the other placement rules.
  - It becomes testable with no io.
  - The engine's no-mutation invariant holds everywhere.
- **Effort:** S. **Risk:** low.

### F11. Deal randomness cannot be injected
- **Where:**
  - `shuffleDeck` and `dealCards` read `globalThis.crypto` (`gameEngine.ts:229-263`).
  - Tests and scripts monkeypatch the global instead:
    - `tests/helpers/offlineMatch.ts` (`withSeededDeals`, including the "non-configurable getter in some Node builds" workaround)
    - `tests/native/setup.ts`
    - `tests/e2e/helpers/seededRandomness.ts`
    - `scripts/measureHeadsUpBalance.ts`
  - Workarounds grew into the interface: `initializeGame(..., dealt?)` with validation at `:1124-1137`, and `initializeRematch(..., dealtHands?)`.
  - `lib/e2eOpener.ts` re-deals in an unbounded `for(;;)` until a given seat opens.
- **Dependency category:** local-substitutable.
- **Proposed interface:** `type RandomSource = { getRandomValues(a: Uint32Array): Uint32Array }`, with:
  - `dealCards(n, firstSeat, random = cryptoRandom)`
  - `initializeGame(setup, mode, { firstSeat, random, dealt })`
- **Effect:** the global patching in four places is deleted, and seeded reproduction becomes an argument.
- **Effort:** S. **Risk:** low.

### F12. Type weaknesses that make callers carry invariants
- **`playedRanks?`** stays optional "for a round persisted before the tally existed" (`gameEngine.ts:103-112`).
  - Both stores are version-gated: `GAME_SCHEMA_VERSION=3` and `OFFLINE_SAVE_VERSION=3`.
  - Every reader still handles `undefined`: `bot.ts:46-51`, `openingIsPending`, `roundUnplayed`, `processPlay:745`.
  - Both restore paths cast an unvalidated blob straight to `GameState`: `persistedEnvelope.ts:226` and `offlineSave.ts:80`.
  - **Proposed:** one shared `parseGameState(unknown): { ok: true; state: GameState } | { ok: false; reason }` at the restore seam, with required fields.
- **`ExchangePhase`** is a set of flags with optional cards (`:58-77`). The phase is never cleared, so its `.active` is checked at 70 sites in 15 files. `cardFromLoser?.id` appears at `autoMove.ts:88`, `app/game.tsx:140`, `GameTable.tsx:624`, `tutorial.tsx:439/733` and `gameEngine.ts:961`.
  - **Proposed:**
    ```ts
    type ExchangePhase =
      | { kind: "jokers"; winnerIdx; loserIdx }
      | { kind: "open"; winnerIdx; loserIdx; cardFromLoser: Card }
      | { kind: "settled"; winnerIdx; loserIdx; cardFromLoser: Card; cardToLoser: Card; settledAt?: number }
    ```
- **`visibleExchangePhase`** returns `Record<string, unknown>`, cast `as GameState["exchangePhase"]` (`gamePersistence.ts:86-89`). With the union above it can return a typed view.
- **The online client stores the sanitized `WireGameState` as `GameState`** (`OnlineGameContext.tsx:280` plus the cast at `:563`). Other seats' `hand: []` is typed as real cards, and `handCountOf` branches on `"handCount" in player` (`shared/protocol.ts:180-182`).
- **`OnlineGameState.gameMode`** duplicates `gameState.gameMode`. It is persisted twice (`persistedEnvelope.ts:138-139`) and rewritten from `room` in `dealVotedRound` (`tableHandlers.ts:395`).
- **Effort:** M overall, and it shares the fixture prerequisite with F3. **Risk:** medium.

---

## P3

### F13. `gameEngine.ts` is a 1525-line module with about ten responsibilities
- **Responsibilities and lines:**
  - Card and deck model, plus random: 1-150 and 209-325
  - Combinations and beat rules: 150-207 and 361-503
  - Legal-play enumeration: 505-657
  - Trick state machine: 659-838
  - Display helpers `getCardDisplayRank` and `getSuitSymbol`, which are presentation: 841-858
  - Exchange: 860-1035
  - Opening predicates: 1036-1066
  - Teams and deal rotation: 1068-1104
  - Round construction: 1106-1167
  - Match scoring and length: 1169-1525
  - `TURN_TIMEOUT_MS`, a transport timing: 1183
- **Exported only for tests:**
  - 16 exports have no production caller: `canPlay`, `getCombinationType`, `getCombinationStrength`, `loserHasBothJokers`, `getBestCardFromHand`, `canPlayerPlay`, `nextMatchTarget`, `resolveTeamMatch`, `resolveMatch`, `addPlacementPoints`, `freshHandFloor`, `findStartingPlayer`, `shuffleDeck`, `getStraightFaceValue`, `targetsFor`, `nextDealFirstSeat`.
  - Those tests reach past the interface.
- **Proposal:**
  - Split into `cards`, `combinations`, `legalPlays`, `round`, `exchange` and `match` files under `lib/game/`.
  - Move the display helpers to `lib/cardNames.ts`.
  - Un-export the internals and re-point their tests at `checkSelection`/`legalPlays`/`foldRoundIntoMatch`.
  - CLAUDE.md's "a rule lives in `lib/game/gameEngine.ts`" invariant needs rewording first.
- **Effort:** M, mechanical. **Gain:** locality.

### F14. Non-domain modules sit inside `lib/game`
- `sharedGameFlow.ts` imports `react` (`useExchangeAnnouncement`) in a folder that otherwise loads under `node --test`.
- `roundEnding.ts`, `matchEnding.ts`, `exchangeTimeline.ts` and `dealTimeline.ts` are animation worklets. The server imports `exchangeTimeline.ts` for `exchangeGiveDelayMs` and pulls the pose geometry in with it.
- `placement.ts` imports theme `Colors`.
- `matchState.ts` mixes wire types (`RoundOverPayload`, `ScoreLine`, `RatingAfter`), which `shared/protocol.ts:6` imports, with viewer-outcome logic.
- **Proposal:**
  - Keep only rules in `lib/game`.
  - Move the wire types to `shared/protocol.ts`.
  - Split the exchange and deal timing into a timing-only module the server imports.

### F15. Pass-throughs (each fails the deletion test)
- `lib/exchangeCeremony.ts` (`exchangeAnnounceMs` equals `exchangeAnnounceFrom`)
- `server/game/replayShape.ts:30` (`startReplayLog` returns `[]`)
- `gameTurn.ts:104-106` (the `recordPlayFlags` wrapper)
- `onlineGameLogic.ts:324` (`ScoreboardRow = ScoreLine`)

### F16. The stuck-exchange safety valve is kept at three sites for a state the rules make unreachable in a dealt round
- **Why it is unreachable:**
  - `getValidGivebackCards` (`gameEngine.ts:987-998`) falls back to the lowest card for any non-empty eligible hand.
  - A just-dealt winner holds at least 13 cards plus the one received.
- **The valve is kept at:**
  - `autoMove.ts:89` (`resolveStuckExchange`)
  - `app/game.tsx:147-155`
  - `GameContext.tsx:270-273`
  - plus `tests/server/stuckExchange.test.ts`
- **Proposal:** keep one valve inside the engine's giveback transition, if any is wanted for corrupted restores, and delete the UI and context paths. This folds into F1.

### F17. The placement-points rule is duplicated
- **Where:** `server/game/stats.ts:33-35` (`pointsForPlacement`, "mirroring … `scoreRound` exactly").
- **Proposal:** export `placementPoints(placement, n)` from the engine and use it in both places.

### F18. `botChoosePlay` takes nine positional parameters, five of them optional
- **Where:** `bot.ts:221-231`. The only production caller assembles them from `GameState` (`autoMove.ts:110-122`). 31 test calls read like `botChoosePlay(me, null, true, [8,8,8], undefined, () => 0.5, false, playedRanks)`.
- **Proposal:** `botView(state, seat): BotView` plus `botChoosePlay(view: BotView, rng)`.
- **Effort:** S.

### F19. `RoundOverPayload` is declared "with no optional field", but the schema and the client do not match it
- **Where:**
  - `roundOverSchema` validates 6 of 13 fields (`shared/protocol.ts:160-169`).
  - The client casts `as unknown as RoundOverPayload`, then reads with `?? prev` fallbacks (`OnlineGameContext.tsx:666-700`).
- **Proposal:** a full schema with `z.infer` as the type.

---

## Tests that reach past the interface, or become waste after the changes above
- **Source scans of the call graph** (`tests/engine/matchState.test.ts:203-228` and `262-282`). They are needed today only because the bot seam is partial. After F1 and F8 they reduce to one check for "the only importer of `bot.ts`".
- **Mirrors and reimplementations in `tests/helpers/offlineMatch.ts`:**
  - `applyRoundToMatch`, `freshMatch` and the `dealFrom` mirror (F2)
  - `computeBotTurnKey` and the collision search (F3)
  - `expectedNextActive`, whose comment says `getNextActivePlayer` "is not exported". That is stale: it is exported (`gameEngine.ts:822`).
- **`tests/native/teamsSingleRound.test.tsx`** tests a pure function under native jest (F2).
- **Tests of the 16 test-only engine exports** (F13).
- **118 hand-built `GameState` literals in 99 files.** Any `GameState` change touches them all. Introduce a `stateFixture()` builder before F3, F6 or F12.

---

## Already well designed: leave as is
- **The refusal ladder:** `checkPlay`, `checkSelection` and `PlayRefusal`. It is one vocabulary, held to the server's mapping by `satisfies Record<PlayRefusal,…>` and read by the UI through `stagedPlay.ts`.
- **`getAllValidPlays`'s enumeration:** deep, deduplicated by legality key, and property-tested against brute force. Only its parameters need trimming (F6).
- **`assertPlayable`:** the engine's floor re-derives the combination from the cards.
- **`foldRoundIntoMatch` as the one progression shared by both modes.** The concept is right; only the input shape needs work (F5).
- **`resolveRoundEnd` plus the `RoundOverWriters` port:** pure shaping behind a real seam with a production adapter and test adapters.
- **`shared/persistedEnvelope.ts`:** one schema, a version gate, and "newer revision" handling.
- **`sanitizeStateForPlayer`** as the single path a state takes to any client. **`visibleExchangePhase` and `markExchangeSettled`** take `now` as an argument.
- **`lib/game/replay.ts` `replayStateAt`:** it carries no hands at all, and it reuses `passesToCloseTrick`.
- **The pure helpers:**
  - `standings.ts`, `scorePill.ts`, `rating.ts`, `botPersonalities.ts`
  - `offlineSave.ts`'s pure encode and decode
  - `matchState.ts`'s outcome functions, including the explicit `"pending"` state.
