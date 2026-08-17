# A2 — Game rules correctness

Repo `C:\Users\roton\murlan` @ `b894af4`. Scope: `lib/gameEngine.ts` against `docs/RULES.md`
and `docs/BRIEF.md` §3.1, plus the three places that enforce it (`server/socket.ts`,
`context/GameContext.tsx`, `components/GameTable.tsx`) and the AI.

**Method.** Read `lib/gameEngine.ts` in full, then falsified/confirmed hypotheses by executing
the engine from a scratch directory outside the repo (`node --experimental-strip-types`,
importing `lib/gameEngine.ts` directly, the same way `tests/` loads it). Nothing in the repo
was written except this file.

**What the executed simulations found.** 360 complete matches (2/3/4 seats × free-for-all/teams
× 60 seeds), every move independently re-validated against `buildCombination` + `canPlay`,
card conservation checked after every play, produced **zero** illegal plays, zero mis-typed
combinations, zero card leaks, zero freezes, zero incomplete `rankings`. A separate 20 000-call
probe over all five personalities found **zero** cases of `aiChoosePlay` returning `null` while
leading a new round. **The combination/beat/pass core of this engine is correct**; every finding
below is at its edges — roster changes between manches, seat symmetry, teams seating, the match
target, and the exchange.

**One correction to the recon map.** Map §7 and the A2 brief state that
`components/GameTable.tsx` "does not re-check" the 3♠ rule for the button-enable state. It does:
`components/GameTable.tsx:476-481` computes `requiresStartCard` and folds it into `isValidPlay`.
`startCard` survives `sanitizeStateForPlayer` (`server/socket.ts:249-266` spreads `...state`), so
the check works online too. There is no lit-button-then-server-rejection path. Not a finding.

---

## Findings

### [RULE-01] Deal the next manche from the running game's roster, not from `room_players`
- **Severity:** High
- **Confidence:** High (read the code; reproduced the engine half by execution)
- **Effort:** M
- **Location:** `server/socket.ts:1548-1583` (esp. `:1550` `getRoomPlayers`, `:1551` the
  `< 2` return, `:1554-1562` `playerSetup`, `:1569-1572` `playerMap`), against
  `server/socket.ts:1331-1347` (what `room:start` actually seated)
- **Problem:** `game:rematch_vote` is the only path that deals the next manche online
  (`initializeRematch` is called nowhere else; `requestPlayAgain` exists in
  `context/OnlineGameContext.tsx:555` but **no screen calls it** — `app/(online)/game.tsx:316-336`
  offers only `voteRematch` and "leave"). It rebuilds the seat roster from
  `storage.getRoomPlayers(roomId)`, which returns rows from `room_players` — **seated humans
  only**. Bot seats created by `room:start`'s `buildSeatRoster` (`server/socket.ts:1331`) exist
  only in memory and are not in that table, so they vanish. Three consequences:
  1. **1 human + 3 bots:** `players.length` is 1, `server/socket.ts:1551` returns, and the
     manche is never dealt. `game.rematchVotes` has already been cleared at `:1546`, so the
     vote cannot even be retried into a different outcome. The table is a dead end.
  2. **2 humans + 2 bots:** a 4-seat game silently becomes a 2-seat game. `game.cumulativeScores`
     and `game.matchTarget` are carried over unchanged (`rollMatchForward`, `:947-954`, only
     resets when `matchOver`), while the points scale changes from 3/2/1/0 to 1/0.
  3. Any seat count: `prevRankings` holds the *old* roster's engine ids. `initializeRematch`
     resolves them with `players.findIndex(p => p.id === winnerId)` (`lib/gameEngine.ts:923-927`)
     and falls back to `0` / `length-1` on `-1`, so the exchange runs between the wrong two
     players.
- **Impact:** The default way a solo player plays online is `fillWithBots` (the room screen's
  own copy: "Empty seats will be taken by virtual players", `app/(online)/room.tsx:52-53`).
  That table cannot get past manche 1. A 2-human bot-filled table gets a different game than
  the one it started, with the wrong exchange winner and a scoreboard that no longer means what
  it did. A room that lost a player mid-match (seat vacated to a bot, `room_players` row deleted
  by `vacateSeat`) shrinks the same way.
- **Repro / proof:** executed (`initializeRematch` half). Manche 1 seated
  `[Alice(human), Bob(human), Luan(ai), Drita(ai)]`; hand ended `player_2 > player_3 > player_0
  > player_1` (bots 1st and 2nd — 3/2/1/0). `game:rematch_vote` then builds
  `playerSetup = [{id:"player_0",Alice}, {id:"player_1",Bob}]` and calls
  `initializeRematch(playerSetup, "free_for_all", ["player_2","player_3","player_0","player_1"])`.
  Output: **2 seats**, `exchangePhase.winnerIdx = 0` (Alice, who actually placed **3rd**),
  `loserIdx = 1`, `startReason = {type:"lost_round", playerIdx:1}`, and the per-manche points
  scale is now `{player_0: 1, player_1: 0}` instead of 3/2/1/0. For case 1, the server returns
  at `server/socket.ts:1551` before any of that.
- **Proposed fix:** In `game:rematch_vote`, build the next manche from the roster the running
  game already has, not from the database. `game.gameState.players` carries `name`, `type` and
  `team` per seat and `game.playerMap` carries seat→userId; derive `playerSetup` from those
  (`id: player_${seat}`, `type: game.playerMap[seat] === undefined ? "ai" : "human"`, keep
  `personality` — add it to `OnlineGameState` at `room:start` if it is not retained) and rebuild
  `playerMap` by copying the existing one rather than re-indexing `getRoomPlayers`. Replace the
  `players.length < 2` guard with a check on the *seat* count
  (`game.gameState.players.length < 2`). Keep the DB read only for `room.gameMode`/`maxPlayers`.
- **Acceptance criteria:**
  - An integration test starts a room with `fillWithBots: true` and one seated human, plays
    manche 1 to `game:over`, emits `game:rematch_vote`, and observes a new `game:state` with
    the **same number of seats** and the same bot seats still AI-driven.
  - A second test with two humans + two bots asserts the post-rematch `players.length` equals
    the pre-rematch one, and that `exchangePhase.winnerIdx` is the seat of the previous
    manche's `rankings[0]`.
  - A unit test on `initializeRematch` asserts it is never called with a `playerSetup` whose
    ids do not cover `prevRankings` (or that the caller guarantees it).
- **Fix risk:** `playerMap` is what `sanitizeStateForPlayer` uses to decide who sees which hand;
  getting the copy wrong hands a player someone else's cards. Cover it with the existing
  "a player never receives another player's hand" assertion in
  `tests/integration/gameplay.test.ts`.
- **Depends on:** None

---

### [RULE-02] Bot seats always vote against a rematch, because their score key is stripped by design
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Location:** `server/socket.ts:961-974` (esp. `:968`), `server/socket.ts:761-763`,
  `server/onlineGameLogic.ts:78-87`, `lib/gameEngine.ts:1267-1269`,
  `server/socket.ts:1535`, `components/GameOverOverlay.tsx:165`
- **Effort:** S
- **Problem:** `countRematchAnswers` decides a bot seat's answer with
  `botWantsRematch(game.cumulativeScores[`bot:${seat}`] ?? 0, leader)`. But
  `handleGameOver:761` runs `excludeBotSeats(handByKey)` before merging into
  `game.cumulativeScores`, and `excludeBotSeats` (`server/onlineGameLogic.ts:78-87`) drops
  exactly the keys beginning `bot:`. **`game.cumulativeScores["bot:<seat>"]` therefore never
  exists.** Every bot seat is evaluated as `botWantsRematch(0, leader)`, which
  (`lib/gameEngine.ts:1268`) is `leader === 0 || 0 >= leader` — true only while *nobody* has
  scored. From the first point onward every bot seat answers no.
- **Impact:** `tableWantsRematch` uses `isMajority(yes, seatCount)`. On a 1-human/3-bot table
  the best possible tally is 1 of 4; on 2 humans/2 bots it is 2 of 4 — neither is a majority.
  So `matchContinues` is false in the `game:over` payload (`server/socket.ts:794`, `:828`),
  `GameOverOverlay.canContinue` is false (`components/GameOverOverlay.tsx:165`) and the
  continue button disappears, and `game:rematch_vote` refuses outright at
  `server/socket.ts:1535`. A bot-filled online match can never be restarted once it ends.
  The behaviour inverts absurdly: the *only* time the bots agree to play again is when the
  human is on zero points.
- **Repro / proof:** read-code trace. 1 human + 3 bots, `matchLength: "match"`. Manche 1 ends
  with the human on any score ≥ 1 → `leader ≥ 1`; `cumulativeScores` contains only the human's
  key; `countRematchAnswers` calls `botWantsRematch(0, leader)` three times, all false;
  `yes ≤ 1`, `total = 4`; `isMajority(1, 4)` → `2 > 4` → false. (`lib/gameEngine.ts:1272-1274`.)
- **Proposed fix:** Bot seats have no match score by construction, so judging them on one is
  the bug. Either (a) score bot seats into a separate map that `countRematchAnswers` reads —
  `handByKey` already carries `bot:<seat>` before `excludeBotSeats` strips it, so keep that
  breakdown on `OnlineGameState` — or (b) make a bot seat abstain rather than vote: exclude
  vacant seats from both `yes` and `total` in `countRematchAnswers`, so the verdict is the
  humans' majority. (b) is smaller and matches how `excludeBotSeats` already reasons about
  bot seats elsewhere.
- **Acceptance criteria:** a unit test on `countRematchAnswers` (expose it through
  `__testables`, as `server/socket.ts:212-235` already does for `actingSeat`/`autoMoveForSeat`)
  asserting that with `playerMap = {0: "u1"}`, four seats, `cumulativeScores = {u1: 7}` and
  `rematchIntents = {u1: true}`, `tableWantsRematch` is **true**. Add a companion test that a
  bot-filled table's `game:over` payload carries `matchContinues: true` when the human wants
  another match.
- **Fix risk:** Option (b) changes the denominator for human-only tables too if written
  carelessly — a seat with a userId must still count toward `total`.
- **Depends on:** None (but a table blocked by RULE-01 never reaches this)

---

### [RULE-03] Rotate the deal: seats 0 and 1 receive the extra card in every manche, forever
- **Severity:** Medium
- **Confidence:** High (measured over 8 000 simulated hands with a control)
- **Effort:** M
- **Location:** `lib/gameEngine.ts:243-251` (`dealCards`), used unchanged by
  `lib/gameEngine.ts:1057` (`initializeGame`) and `lib/gameEngine.ts:909` (`initializeRematch`);
  `docs/RULES.md:38`
- **Problem:** `dealCards` deals `hands[i % playerCount].push(deck[i])` starting from index 0
  every single time. With 54 cards and 4 players that means **seats 0 and 1 always get 14 cards
  and seats 2 and 3 always get 13** — in the first manche, in every rematch, in every match.
  There is no dealer, no dealer rotation and no rotation of the remainder. `docs/RULES.md:38`
  describes a dealer who shuffles, a cut, and a deal starting from the dealer's left — i.e. a
  rotating origin; the engine has none. The doc comment at `lib/gameEngine.ts:237` records the
  behaviour ("the extra cards land deterministically on the first seats") without noting that it
  never moves.
- **Impact:** A permanent positional bias at every 4-player table. Because a seat's chance of
  holding the 3♠ (and thus of opening the very first manche) is proportional to hand size, seats
  0 and 1 open more often and finish better. The app has a rated ladder
  (`server/ratings.ts`, `lib/rating.ts`) and match history keyed on placement, so the bias is
  being recorded as skill. Online, seat 0 is always the host (`server/socket.ts:1076`
  `addRoomPlayer(room.id, userId, 0)`).
- **Repro / proof:** executed. 4 000 first-manche hands, **all four seats running the identical
  `ana` personality**, so the only difference between seats is the deal:

  | seat | cards | opens (holds 3♠) | wins the manche | avg points/manche |
  |---|---|---|---|---|
  | 0 | 14.00 | 25.8% | **25.9%** | **1.548** |
  | 1 | 14.00 | 25.9% | **26.3%** | **1.526** |
  | 2 | 13.00 | 23.6% | 23.4% | 1.452 |
  | 3 | 13.00 | 24.8% | 24.4% | 1.474 |

  Control, same code, same RNG stream, same 4 000 seeds, with the dealt hands rotated by
  `seed % 4` seats before play (i.e. a rotating dealer): the spread collapses to noise —
  wins 24.9 / 24.6 / 25.3 / 25.3 %, points 1.495 / 1.508 / 1.508 / 1.488. The ~2.2 percentage
  point gap in the uncontrolled run is ≈4.5σ at n = 8 000 per group.
- **Proposed fix:** Give `dealCards` a starting-seat parameter, `dealCards(playerCount,
  firstSeat = 0)`, and deal `hands[(firstSeat + i) % playerCount]`. Pass a rotating value:
  offline, `context/GameContext.tsx`'s `dealFrom` can advance a counter stored alongside
  `savedPlayerConfigs`; online, `OnlineGameState` can carry `dealerSeat`, advanced in
  `rollMatchForward`/on each rematch and persisted in the `game_state` envelope
  (`server/onlineGameLogic.ts:178-183`) so a restart does not reset it. Default the parameter to
  0 so every existing caller and test compiles unchanged.
- **Acceptance criteria:**
  - `tests/deal.test.ts` gains a case asserting `dealCards(4, 1)` yields `[13, 14, 14, 13]` and
    `dealCards(4, 2)` yields `[13, 13, 14, 14]`, and that the whole 54-card deck still goes out
    at every offset.
  - A test asserting that four consecutive manches of one match give each seat the 14-card hand
    at least once.
- **Fix risk:** `tests/deal.test.ts:57` pins `[14,14,13,13]` for 4 players and would need the
  offset spelled out. `lib/offlineSave.ts`'s save shape gains a field — see its
  version-discard behaviour (`tests/offlineSave.test.ts`) before adding one, and bump
  `GAME_SCHEMA_VERSION` (`server/onlineGameLogic.ts:156`) only if the persisted *state* shape
  changes, which it need not.
- **Depends on:** None

---

### [RULE-04] Refuse to start teams mode with anything other than four seats
- **Severity:** Medium
- **Confidence:** High (read the code; measured the resulting imbalance)
- **Effort:** S
- **Location:** `server/socket.ts:1311` (the only player-count guard),
  `server/socket.ts:1337-1340` (`team: idx % 2 === 0 ? "A" : "B"`),
  `app/(online)/room.tsx:360-361` (`notEnoughPlayers` / `canStart`),
  `server/socketSchemas.ts:24,40` (`maxPlayers` 2-4 accepted with any `gameMode`)
- **Problem:** Teams are assigned by `idx % 2` over the actual roster. Nothing checks that the
  roster has four seats. `room:start`'s only count guard is
  `if (!fillWithBots && players.length < 2)`. So a 4-seat **teams** room with three seated
  humans and "fill with bots" **off** starts a 3-player game with team A on seats 0 and 2 and
  team B on seat 1 alone — a permanent 2-versus-1. `resolveTeamMatch`
  (`lib/gameEngine.ts:1209-1225`) then sums two players' points against one's. The room screen
  enables Start in exactly that state (`app/(online)/room.tsx:361`). The 2-seated-human case
  starts a 1-v-1 labelled as teams, with the room screen still drawing four team badges
  (`app/(online)/room.tsx:516`, `:632`). Separately, `RoomCreateSchema` and
  `RoomQuickmatchSchema` accept `{gameMode: "teams", maxPlayers: 2}` from a crafted client —
  only `app/(online)/index.tsx:145-157` blocks it, and that is UI.
- **Impact:** The three-human case is reachable from the shipped UI with no crafted payload, and
  it is unwinnable for the odd player out. The offline lobby is not affected — it forces
  `free_for_all` unless `count === 4` (`app/lobby.tsx:142`, `:178`), which is exactly the check
  the server is missing.
- **Repro / proof:** executed. 120 full teams matches, three seats, all bots on identical
  personalities, teams by `idx % 2` (A = seats 0,2; B = seat 1), scored through
  `resolveTeamMatch` with the real escalation: **team A won 93 of 120 (78%), team B 27 (22%)**,
  no draws. Mechanism: a 3-player manche pays out 2/1/0 = 3 points, of which the two-member team
  takes ~2 on average, so it reaches 21 in about half the manches team B needs.
  UI path: create a 4-player teams room → two friends join by code → host leaves
  "Fill with bots" off → Start is enabled (`room.players.length` is 3, `fillWithBots` false, so
  `notEnoughPlayers` is false) → `room:start` seats three players with teams A/B/A.
- **Proposed fix:** In `room:start` (`server/socket.ts` after `:1331`, once `roster` is known),
  reject when `room.gameMode === "teams" && roster.length !== 4` with a
  `room:error` carrying a new code (e.g. `TEAMS_REQUIRE_FOUR`) and a key in all three locales.
  Add the same check to `room:create` and `room:quickmatch` (`gameMode === "teams"` implies
  `maxPlayers === 4`) so the room cannot exist in that shape, and mirror it in
  `app/(online)/room.tsx` so the Start button is disabled with a reason rather than failing on
  press.
- **Acceptance criteria:**
  - An integration test: create a teams room with `maxPlayers: 4`, seat three humans, emit
    `room:start` with `fillWithBots: false`, assert a `room:error` with code
    `TEAMS_REQUIRE_FOUR` and that no `game:started` is emitted.
  - A test that `room:create {gameMode:"teams", maxPlayers:2}` is rejected.
  - A unit test on `buildSeatRoster` + the team assignment asserting every teams roster has
    exactly two A seats and two B seats.
- **Fix risk:** `tests/integration/teamsOnline.test.ts` starts teams rooms — check it seats four
  before adding the guard.
- **Depends on:** None

---

### [RULE-05] Do not call a match a draw when one player is ahead at the final target
- **Severity:** Medium
- **Confidence:** High (executed)
- **Effort:** S
- **Location:** `lib/gameEngine.ts:1152-1177` (esp. `:1170-1176`); consumed at
  `server/socket.ts:786-790` and `:829`, `context/GameContext.tsx:127-134`,
  rendered at `components/GameOverOverlay.tsx:152-159`
- **Problem:** `resolveMatch`'s last branch fires whenever **two or more** players are at or
  above the final target (51) and no further escalation exists. It then picks the maximum and
  returns `{ winners: [that one], isDraw: true }`. Two players crossing 51 with *different*
  totals is not a tie, but the result is stamped `isDraw`. `docs/RULES.md:123` says the match is
  a draw only "if players are still **tied** at 51+".
- **Impact:** `components/GameOverOverlay.tsx:152-159` renders `match.winners[0]` as the
  celebrated name and, because `isDraw` is true, the "it's a draw" subtitle underneath it — one
  player's name over the word *Pareggio*. Meanwhile `server/socket.ts:886`
  (`matchWon: matchWinners.includes(key)`) still awards that player the match win, so the
  `match_champion` / `iron_will` achievements unlock on a screen that says nobody won.
- **Repro / proof:** executed —
  `resolveMatch({ a: 53, b: 51 }, 51)` → `{"winners":["a"],"newTarget":null,"isDraw":true}`.
  Reachable: at target 51 a 4-player manche pays 3/2/1/0, so a table at 50 and 49 lands on
  53 and 51 in one hand. `tests/scoring.test.ts:86-91` only covers the genuinely tied case
  (`{a:53, b:53, c:51}`), which is why this survives.
- **Proposed fix:** In `lib/gameEngine.ts:1170-1176`, compute `best` first and set
  `isDraw: winners.length > 1`. A single top scorer at the final target is an ordinary win
  (`newTarget: null, isDraw: false`); two or more sharing the top score is the draw.
- **Acceptance criteria:** `tests/scoring.test.ts` gains
  `assert.deepEqual(resolveMatch({a:53,b:51}, 51), {winners:["a"], newTarget:null, isDraw:false})`
  and keeps the existing tied-at-51 case passing. A teams companion:
  `resolveTeamMatch` with team totals 53 vs 51 at target 51 reports both members of the
  53-point pair and `isDraw: false`.
- **Fix risk:** None beyond the two tests above; `resolveTeamMatch` delegates to `resolveMatch`
  and inherits the fix.
- **Depends on:** None

---

### [RULE-06] Scale the match target to the player count — a 1-v-1 partita is ~27 manches
- **Severity:** Medium
- **Confidence:** High (measured)
- **Effort:** M (the number is a design choice — see Open questions)
- **Location:** `lib/gameEngine.ts:1098` (`MATCH_TARGETS = [21, 31, 41, 51]`),
  `lib/gameEngine.ts:1116-1125` (`scoreHand` → N−1…0);
  entry points: `app/lobby.tsx:132,134` (offline **defaults** to 2 players + "match"),
  `app/(online)/quickmatch.tsx:38-45` (the 1-v-1 preset),
  `app/(online)/room.tsx:321` (`matchLength` defaults to `"match"`)
- **Problem:** `scoreHand` was generalised to N players (N−1 down to 0) per `docs/BRIEF.md` §3.1,
  but `MATCH_TARGETS` was not. At two players a manche is worth **1 point to the winner and 0 to
  the loser**, so "first to 21" is at minimum 21 manches — each of which deals 27 cards per
  player. At three players it is a 2/1/0 payout against the same 21.
- **Impact:** The offline lobby's out-of-the-box configuration (2 players, format "Partita") is a
  game nobody will finish, and online quickmatch ships a 1-v-1 preset with the same default.
  Because nobody finishes, nobody in a 1-v-1 ever earns `match_champion` / `iron_will`
  (`lib/achievements.ts:110-121`) and `matchWon` is never recorded for that format.
- **Repro / proof:** executed. 60 full matches per configuration, all seats AI, played to a real
  `resolveMatch` conclusion:

  | seats / mode | avg manches per match | worst |
  |---|---|---|
  | 2p free-for-all | **26.7** | 37 |
  | 2p "teams" | 27.3 | 37 |
  | 3p free-for-all | 15.1 | 27 |
  | 4p free-for-all | 10.4 | 17 |
  | 4p teams | 6.0 | 10 |

- **Proposed fix:** Make the target a function of the player count rather than a constant. The
  cleanest shape that keeps `docs/RULES.md` §12 literally true for the 4-player game it
  documents: keep `[21, 31, 41, 51]` for 4 players and derive the others from the same number of
  manches — e.g. `targetsFor(playerCount)` returning `MATCH_TARGETS.map(t => Math.round(t *
  (playerCount - 1) / 3))` → `[7, 10, 14, 17]` at 2 players, `[14, 21, 27, 34]` at 3. Thread it
  through `server/socket.ts:1358` (`matchTarget: previous?.matchTarget ?? MATCH_TARGETS[0]`),
  `nextMatchTarget` (`lib/gameEngine.ts:1140-1142`), `context/GameContext.tsx:81`
  (`freshMatch`) and `matchIsClosing`'s `target` argument. Whatever number is chosen, record the
  decision in `docs/BRIEF.md` §3.1 and update `docs/RULES.md` §12 and `locales/*.ts`
  `rules.faq.a8`, which currently states a flat 21 for every count.
- **Acceptance criteria:**
  - A test asserting that a simulated 2-player match resolves within 12 manches
    (the harness in this report's `sim` probe is the shape).
  - `tests/scoring.test.ts` pins the target table for 2, 3 and 4 players and that escalation
    still chains for each.
  - `rules.faq.a8` in it/en/sq states the per-count targets and `tests/i18n.test.ts` still
    passes.
- **Fix risk:** `matchIsClosing` (`lib/gameEngine.ts:1247-1260`) reads `target` and decides when
  the rematch question opens; a smaller target opens it earlier, which is correct but changes
  the timing the E2E specs rely on (`tests/e2e/helpers/bot.ts:340-347`).
- **Depends on:** None

---

### [RULE-07] The exchange winner may hand back the exact card the loser just gave
- **Severity:** Low
- **Confidence:** High (executed)
- **Effort:** S
- **Location:** `lib/gameEngine.ts:1022-1027` (`getValidGivebackCards`),
  `lib/gameEngine.ts:957-961` (the loser's card is merged into the winner's hand *before* the
  choice), `lib/gameEngine.ts:985-1005` (`processExchangeChoice`);
  contradicted by `app/tutorial.tsx:367-374` and `locales/it.ts:526` / `locales/en.ts:510`
- **Problem:** `initializeRematch` moves the loser's highest card into the winner's hand and
  *then* asks the winner to return any card ranked 3-10 from that hand. The received card is not
  excluded. If the loser's highest card happens to rank 3-10 — i.e. the loser's whole hand is
  3-10 — the winner can select it and the exchange nets to nothing. The tutorial explicitly
  teaches the opposite: `tutorial.errJustReceived` — *"You just received that from the loser:
  you can't give back that very card."* — which is true in the tutorial's fixed scenario (the
  received card there is a joker, out of range) but is not a rule the engine holds.
- **Impact:** Small. `docs/RULES.md:103` does not itself exclude the received card, so this is a
  hole in the spirit of §10 rather than a contradiction of its letter, and the loser's whole
  hand being 3-10 is vanishingly rare in a 13/14-card deal. The user-visible defect is that the
  app teaches a rule it does not enforce.
- **Repro / proof:** executed.
  ```
  winner hand : [K♣, A♠, 10♥]     exchangePhase.cardFromLoser = 10♥
  loser  hand : [4♣]
  processExchangeChoice(state, "10_hearts")
  → accepted. loser hand: [4♣, 10♥]   winner hand: [K♣, A♠]
  ```
  The 10♥ went loser → winner → loser; no card changed sides.
- **Proposed fix:** Exclude `exchangePhase.cardFromLoser` from the offered set. Cleanest is to
  give `getValidGivebackCards` an optional second argument
  (`getValidGivebackCards(hand, excludeCardId?)`) filtering it out before the 3-10 filter, and
  pass `exchangePhase.cardFromLoser.id` from all four call sites:
  `lib/gameEngine.ts:995` (the validation inside `processExchangeChoice`),
  `components/ExchangeModal.tsx:139`, `components/ResultExchangeOverlay.tsx:71` and
  `app/tutorial.tsx:368`. Keep the existing "no 3-10 in hand → offer the lowest card" fallback,
  applied after the exclusion, so the phase still cannot deadlock. Alternatively delete
  `tutorial.errJustReceived` and accept the engine's behaviour — but then the loser's own card
  can come straight back, which is worse than the string.
- **Acceptance criteria:** `tests/exchange.test.ts` gains a case: a winner hand containing the
  received card and one other 3-10 card offers only the other card, and
  `processExchangeChoice(state, cardFromLoser.id)` returns the state unchanged. A companion case
  proves the fallback still returns exactly one card when the winner holds no other 3-10 card.
- **Fix risk:** If the exclusion is applied without the fallback ordering above, a winner whose
  only 3-10 card *is* the received card is left with no legal choice — the exact deadlock
  `lib/gameEngine.ts:1007-1015` documents having already been fixed once.
- **Depends on:** None

---

### [RULE-08] A single-manche teams game credits the match win to one seat, not the pair
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `server/socket.ts:768-772`, `context/GameContext.tsx:103-111`;
  contrast `lib/gameEngine.ts:1209-1225` (`resolveTeamMatch`, which expands winners to every
  member of the winning team)
- **Problem:** When `matchLength === "single"` both authorities short-circuit the match
  resolution and take `rankings[0]` as the sole winner — `matchWinners = [scoreKeyForSeat(game,
  topSeat)]` online, `winners: finished.rankings.slice(0, 1)` offline. Neither consults
  `gameMode`. In a 2-v-2 single-manche game only the seat that emptied its hand first is a
  winner; its partner is not, even though the pair took the manche together
  (`docs/RULES.md:116-117`, and `lib/gameEngine.ts:1198-1208`'s own comment about denying a
  partner its `matchWon` credit).
- **Impact:** The partner is denied `match_champion` and `iron_will`
  (`lib/achievements.ts:110-121`), and `components/GameOverOverlay.tsx:152` names one player as
  the winner of a team game. Only reachable in teams + "single manche", which the room screen
  offers together (`app/(online)/room.tsx:321,407`; offline `app/lobby.tsx:134`).
- **Repro / proof:** read-code. `server/socket.ts:768-772` has no `gameMode` branch;
  `context/GameContext.tsx:103-111` likewise. A teams manche whose `rankings[0]` is seat 0
  yields `matchWinners = [userOfSeat0]`, so `GameResult.matchWon` (`server/socket.ts:886`) is
  false for seat 2, seat 0's partner.
- **Proposed fix:** In both places, when `gameMode === "teams"`, expand the winner set to every
  seat sharing `rankings[0]`'s team — reuse `teamKeyMap(game, state)` (`server/socket.ts:719-730`)
  online and `finished.players.filter(p => p.team === winnerTeam)` offline.
- **Acceptance criteria:** a unit test asserting that a single-manche teams result names two
  winners, both on the team of `rankings[0]`, in both `handleGameOver`'s output shape and
  `applyHandToMatch`.
- **Fix risk:** None; the `free_for_all` branch is untouched.
- **Depends on:** None

---

### [RULE-09] Delete the unreachable anti-freeze branch in `runAITurn` — it would play an illegal opening
- **Severity:** Low
- **Confidence:** High (proved unreachable by execution)
- **Effort:** S
- **Location:** `context/GameContext.tsx:401-410`
- **Problem:** The brief asked what condition makes this branch necessary. **None does.**
  `aiChoosePlay` cannot return `null` when `isNewRound` is true and the hand is non-empty:
  `getAllValidPlays` adds every single card (`lib/gameEngine.ts:423`), `canPlay(combo, null)` is
  unconditionally true (`lib/gameEngine.ts:361`), and `requireCard` is only ever set to a card
  the seat actually holds (`context/GameContext.tsx:380-382`), so `plays` is never empty and
  every tier and both personality knobs return a member of it
  (`lib/gameEngine.ts:569-614`, `:647-722`). The branch is dead. Worse, if it ever did run it
  would call `buildCombination([sortHand(hand)[0]])` — the lowest card — **without honouring
  `gameState.startCard`**, i.e. it would open the first manche with something other than the 3♠,
  which `context/GameContext.tsx:347-352` refuses for a human and `server/socket.ts:1431-1442`
  refuses online. The comment above it ("doing nothing here freezes the table") reads as a live
  hazard and will keep the branch alive through future edits.
- **Impact:** None today — it is unreachable. It is a latent illegal-move path and a misleading
  comment in the offline authority, which has no server behind it to catch a mistake.
- **Repro / proof:** executed. 4 000 random hands × 5 personalities = 20 000 calls to
  `aiChoosePlay(player, null, true, [5,5,5], undefined, rng)` over hand sizes 1-14 drawn from a
  real 54-card deck: **0 null returns**. Separately, 360 complete simulated matches
  (2/3/4 seats, both modes) never entered the branch.
- **Proposed fix:** Replace the `else` block with a hard failure that cannot silently produce an
  illegal move — either delete it and let the impossible case be a visible bug, or keep a
  one-line guard that plays `requireCard ?? sortHand(hand)[0]` so the forced card is honoured if
  it ever does fire. Do not leave a branch that is simultaneously unreachable and wrong.
- **Acceptance criteria:** a unit test pinning the invariant the branch is defending against:
  for every personality and for hands of 1…14 cards drawn from `createDeck()`,
  `aiChoosePlay(player, null, true, counts)` is non-null. With that test in place the branch has
  no reason to exist.
- **Fix risk:** None. It is not executed.
- **Depends on:** None

---

### [RULE-10] An AFK exchange is announced as an automatic pass
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `server/socket.ts:612-632` (esp. `:622-629`), `server/socket.ts:461-468`,
  `server/socket.ts:534` (`actingSeat` returns the exchange winner)
- **Problem:** During an active exchange `armTurn` arms the AFK timer for the exchange
  *winner*. When it fires, `autoMoveForSeat(..., useAi: false)` takes the exchange branch and
  **gives a card** (`server/socket.ts:465-467`). `startAfkTimer` then unconditionally emits
  `game:notification` with `code: "PLAYER_AFK_AUTO_PASS"` and the message
  `"${username} è inattivo — passato automaticamente"`. No pass occurred; a card was handed to
  the loser.
- **Impact:** Every seat at the table is told the wrong thing about what just happened, at the
  one moment in the hand where card movement between two named players matters. The message is
  also a hardcoded Italian string on a server path that otherwise ships a `code` for the client
  to translate.
- **Repro / proof:** read-code trace. Manche ≥ 2 online: `initializeRematch` sets
  `exchangePhase.active = true`; `armTurn` (`:534`) resolves `actingSeat` to
  `exchangePhase.winnerIdx` and arms that user's AFK timer (`:549`); after `AFK_TIMEOUT_MS` the
  callback calls `handleAutoPass` → `autoMoveForSeat` → `processExchangeChoice`, returns true,
  and `:623-628` emits the auto-pass notification.
- **Proposed fix:** Have `autoMoveForSeat` report what it did (e.g. return
  `{ state, kind: "play" | "pass" | "exchange" }`, or have `handleAutoPass` check
  `game.gameState.exchangePhase?.active` before the move) and emit a distinct code —
  `PLAYER_AFK_AUTO_EXCHANGE` — with keys in `locales/it.ts`, `en.ts` and `sq.ts`.
- **Acceptance criteria:** an integration test lets the exchange winner's AFK timer expire
  (`MURLAN_AFK_TIMEOUT_MS` is env-overridable, `server/socket.ts:153`) and asserts the emitted
  `game:notification.code` is the exchange code, not `PLAYER_AFK_AUTO_PASS`; `tests/i18n.test.ts`
  still passes with the new key in all three locales.
- **Fix risk:** `translateServerPayload` (`lib/i18n.ts:166-173`) falls back to the server's raw message
  for an unknown code, so an unlocalised new code degrades to Italian rather than blank — check
  that path before shipping the code without all three keys.
- **Depends on:** None

---

## Implemented but untested

Rules the engine enforces that **no** file in `tests/` exercises. Verified by reading the test
files, not by filename.

| Rule / behaviour | Engine location | Nearest test that almost covers it |
|---|---|---|
| The turn moves to the **previous** seat index (`(i - 1 + n) % n`) and skips seats that have gone out — the "senso orario" claim in `locales/it.ts:443` | `lib/gameEngine.ts:852-861` | `tests/flow.test.ts:173,181` asserts only that the turn is *not* the finished seat, never the direction. `tests/gameTableModel.test.ts` pins `seatDirection` but never against the engine's rotation, so both halves of the clockwise claim are unpinned. |
| The whole rematch-question rule set: `matchIsClosing`, `CLOSING_HAND_CARDS`, `botWantsRematch`, `isMajority` | `lib/gameEngine.ts:1239-1274` | **Nothing.** A grep of `tests/` for all four identifiers returns zero hits. Only `tests/e2e/helpers/bot.ts:340-347` touches the prompt, and E2E is not in `npm run verify` or CI. |
| `resolveMatch`'s final-target branch when the crossers are **not** tied | `lib/gameEngine.ts:1170-1176` | `tests/scoring.test.ts:86-91` covers the tied case (`{a:53,b:53,c:51}`) only. → RULE-05 |
| The 3♠ rule as a **rejection**: a first play that omits the start card must be refused | `server/socket.ts:1431-1442`, `context/GameContext.tsx:347-352`, `components/GameTable.tsx:476-481` | `tests/straights.test.ts:186-203` tests the *enumerator*'s `requireCard`. Every harness plays the start card correctly on purpose (`tests/integration/gameplay.test.ts:259-261`, `tests/helpers/gameDriver.ts:112-114`), so no test ever submits a first play without it, and `MUST_PLAY_START_CARD` appears in no test. |
| The teams hand-end disjunct "no opposing seat still holds cards" | `lib/gameEngine.ts:784-787` (second half of the `if`) | `tests/teams.test.ts:99-113` reaches the same `return` through `teammateDone`; the disjunct alone is never the reason the branch fires. |
| `aiChoosePlay` at 2 and 3 seats, in teams mode, and with a `requireCard` that is not the 3♠ | `lib/gameEngine.ts:621-723` | `tests/botPersonalities.test.ts:32-40` builds a 4-seat free-for-all table only (`botTable(personality, seats = 4)`; the `seats` argument is never passed). |
| A 3-player game played end to end | `lib/gameEngine.ts:243-251` deals 18/18/18 | `tests/deal.test.ts:57` pins the hand sizes; no test plays a 3-seat hand. |
| `aggregateTeamScores` with an unbalanced team map | `lib/gameEngine.ts:1186-1195` | `tests/teams.test.ts:117` always uses a balanced 2+2 `teamOfKey`. → RULE-04 |
| The exchange giveback being the card just received | `lib/gameEngine.ts:1022-1027` | `tests/exchange.test.ts:68-76` covers an out-of-range card and the fallback, never the received card. → RULE-07 |
| `handleGameOver`'s `matchLength === "single"` winner selection, and single + teams | `server/socket.ts:768-772` | No node test and no integration test starts a single-manche game — `matchLength` appears in `tests/` only in the Playwright helpers (`tests/e2e/helpers/navigation.ts:26-42`). → RULE-08 |
| `resolveStuckExchange` and the `valid.length === 0` guard that reaches it | `server/socket.ts:425-431`, `server/socket.ts:466` | None — and both are unreachable: the exchange winner always holds ≥ 14 cards (they were just handed one) and `getValidGivebackCards` (`lib/gameEngine.ts:1022-1027`) returns `[]` only for an empty hand. |
| `canPlayerPlay`, `loserHasBothJokers`, `getBestCardFromHand`, `aggregateTeamScores` are exported but called from **no** application file — only from tests | `lib/gameEngine.ts:867-873`, `:1029-1039`, `:1186` | They are tested; nothing in `app/`, `components/`, `context/`, `lib/` or `server/` imports them. Flagged for C1, not a rules defect. |
| The enumerator over hands larger than 10 cards, and straights of 11-13 cards | `lib/gameEngine.ts:390-469` | `tests/enumerator.property.test.ts:17` fixes `HAND_SIZE = 10`, so the brute-force oracle never sees a real 13/14/18/27-card hand. `tests/straights.test.ts:205-222` runs a 27-card hand but only asserts it is *fast*, not that it is complete. |

## Documented but not implemented

| Documented rule | Where | Engine location where it should live |
|---|---|---|
| A dealer who shuffles, a cut to the dealer's right, and a deal that starts from the dealer's left — i.e. a rotating deal origin | `docs/RULES.md:38` | `lib/gameEngine.ts:243-251` deals from index 0 every time, so the 54/4 remainder is welded to seats 0 and 1 for the life of the app. → **RULE-03** |
| "51 is the maximum; if players are still **tied** at 51+, the match is a draw" | `docs/RULES.md:123` | `lib/gameEngine.ts:1170-1176` declares a draw whenever two or more are at the final target, tied or not. → **RULE-05** |
| Teams is 2 v 2, partners seated opposite | `docs/RULES.md:114-117`, `docs/BRIEF.md` §3.1 | `server/socket.ts:1337-1340` assigns teams by `idx % 2` over whatever roster exists; nothing requires four seats. → **RULE-04** |
| The per-hand payout was generalised to N players; the **target** was not | `docs/RULES.md:124`, `docs/BRIEF.md` §3.1 ("Match target … first to 21") | `lib/gameEngine.ts:1098` is a flat `[21,31,41,51]` for every player count, against a 1-point-per-manche payout at two players. → **RULE-06** |
| "You can't give back that very card" (the card just received) — stated to the player by the tutorial, not by `docs/RULES.md` | `app/tutorial.tsx:370-372`, `locales/it.ts:526`, `locales/en.ts:510` | `lib/gameEngine.ts:1022-1027` has no such exclusion. → **RULE-07** |
| "Play the hand out" in teams mode, so both partners' finishing positions are real | `docs/BRIEF.md` §3.1 (teams win condition), `docs/RULES.md:117` | `lib/gameEngine.ts:782-795` stops the hand the moment one pair is complete and **infers** the remaining two placements from cards-in-hand (`assignRemainingPlacements`, `:742-752`). The team total is unaffected (both remaining seats are on the losing pair), but `match_history.placement` records an inferred 3rd/4th rather than a played one. The code comment at `:733-739` acknowledges the sources are silent here — listed for completeness, no consequence found. |
| "Beating royal straight must have the **same card count**" | `docs/BRIEF.md` §3.1 | Implemented correctly (`lib/gameEngine.ts:363-371`), but `locales/it.ts:437,465` (`rules.comboRoyalDesc`, `rules.faq.a13`) still say only "una Scala Reale più alta batte una più bassa" with no mention of the count, and `tests/combinations.test.ts:187`'s own test name says "only a **longer-or-equal** higher royal beats it" — which the code does not do. The assertions are right; the name and the two strings are misleading. |

---

## Coverage gaps

1. **Integration and E2E suites were not run.** No `DATABASE_URL` on this machine, so the 11
   DB-gated suites self-skip, and Playwright would have written into `tests/e2e/test-results/`,
   which the read-only rule forbids. RULE-01, RULE-02, RULE-04 and RULE-10 are therefore
   confirmed by reading `server/socket.ts` and by executing the *engine* half in isolation, not
   by observing a live socket round trip. Each names the exact server lines so the implementer
   can confirm in minutes.
2. **RULE-03's magnitude is AI-relative.** The 2.2-point seat gap was measured with four
   identical `ana` bots and its control; the *direction* and the mechanism (hand size → 3♠
   probability → opening the first manche) are structural and hold for human play, but the exact
   size against human opponents is not something a simulation can settle.
3. **`server/socket.ts` was read in the ranges the brief named** (`:240-267`, `:400-641`,
   `:732-1000`, `:1066-1300`, `:1391-1600`, `:1750-1800`) plus the room handlers, not end to end.
   The rejoin path (`:1601-1748`) and the sweeper were left to A3.
4. **I did not evaluate whether the royal straight should exist at all.** `docs/RULES.md` §7.4
   records it as Tier-2-only and absent from the Albanian tradition; `docs/BRIEF.md` §3.1 is an
   explicit decision to keep it beating bombs. The engine matches that decision exactly
   (`lib/gameEngine.ts:363-379`), verified against all 16 cases in `tests/combinations.test.ts`.
   Reopening it is a product call, not an audit finding.
5. **Card-strength and combination detection were audited exhaustively and are correct.**
   `cardStrength` ignores suit entirely (`lib/gameEngine.ts:99-101` → `RANK_ORDER.indexOf`);
   every comparison site uses strict `>` (`:368`, `:375`, `:383`); jokers are rejected from every
   multi-card shape at `:161-175`, `:307`; a joker-containing set can be built exactly one way
   (as a single) so the "two constructions, two strengths" hole does not exist; the Ace is
   bucketed at both 1 and 14 but a run is capped at 13 positions so it can never be used twice
   (`:502-515`, proved by `tests/straights.test.ts:79-84`). No finding was warranted and I am
   recording that as a positive result rather than silence.

## Opinions (non-findings)

- `getCombinationType` checks `isRoyalStraight` before `isStraight` (`lib/gameEngine.ts:326-327`),
  so a player holding a suited run **cannot choose** to play it as a plain straight. Under the
  Tier-2 rules `docs/BRIEF.md` §3.1 adopted, a flush is its own combination type and this is
  correct — but it means a 10♠J♠Q♠K♠A♠ lead is unbeatable by any hand in the game (no bomb may
  answer it, `:374`, and no equal-length royal can be strictly higher). Worth knowing before
  someone reports it as a bug.
- `assignRemainingPlacements` orders unfinished seats by "fewest cards left, seat order as a
  tiebreak" (`lib/gameEngine.ts:742-752`). Seat order as the tiebreak is arbitrary and, given
  RULE-03, always favours the same seats. Cosmetic while it only separates two members of an
  already-losing pair.
- The engine exports `AIDifficulty` and three tiers (`easy`/`medium`/`hard`) that the product no
  longer surfaces — `lib/botPersonalities.ts` is now the only way a tier is chosen. Not wrong,
  just a layer the UI no longer names.

## Open questions for the human

1. **RULE-06 needs a number, not a fix.** What should a 2-player and a 3-player partita be worth?
   The proposal above (scale the 21/31/41/51 ladder by `(playerCount − 1)/3`, giving 7/10/14/17
   at two players and 14/21/27/34 at three) keeps a match around 8-11 manches at every count and
   leaves the 4-player numbers `docs/RULES.md` §12 documents untouched — but no source covers
   2- or 3-player Murlan, so this is an owner call and belongs in `docs/BRIEF.md` §3.1 alongside
   the other rule decisions.
2. **RULE-04: should a 3-player teams game be forbidden, or auto-filled with a bot?** Refusing to
   start is the smaller change and matches what the offline lobby already does
   (`app/lobby.tsx:142`). Auto-enabling `fillWithBots` for teams would be friendlier but makes
   the host's toggle a lie.
3. **RULE-03: is a per-manche dealer rotation acceptable, or should the deal be made exactly
   symmetric?** Rotation matches `docs/RULES.md` §3 (line 38) and the physical game. The alternative —
   never dealing the two extra cards — contradicts `docs/BRIEF.md` §3.1's explicit "deal the
   entire 54-card deck" decision and would reintroduce the missing-joker problem that decision
   was taken to remove, so I do not recommend it.
