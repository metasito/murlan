# The match lifecycle — Batch 3 design

`CLAUDE.md`'s standing agreement requires a written design for anything touching storage or
the socket protocol. This batch touches both. The *rules* are already settled in
`audit/2026-08-17/DECISIONS.md` D1–D4; this document is the **how**, not the whether.

## The one defect underneath all seven findings

`handleGameOver` sets `rooms.status = "finished"` after **every manche**
(`server/socket.ts:882`), not only at the end of a match. So `"finished"` means two
incompatible things:

- *between hands of a live partita* — the table is intact, `matchOver === false`, and the
  next manche is owed to it;
- *this room is over* — the table should be torn down.

Five handlers branch on that flag and no two agree about which meaning they got. Every
finding in this batch is a symptom.

| Finding | The symptom that overload produces |
|---|---|
| NET-01 | `handleLeaveRoom` only vacates on `in_progress`, so a leave at the results screen never frees the seat and the rematch gate can never be satisfied |
| RULE-01 | `game:rematch_vote` rebuilds the roster from `room_players`, a humans-only table, so bot seats vanish mid-match |
| RULE-02 | bot seats are judged on a score key `excludeBotSeats` guarantees does not exist, so they always vote no |
| SEC-01 | `room:start` accepts `"finished"`, so the host can re-deal a running match from a modified client |
| SEC-02 | leaving before `gameOver` produces no record at all — the cheapest cheat in the repo |
| ARCH-07 | the leave path is two near-identical functions, and NET-01 is precisely the branch one of them is missing |
| UX-13 | the bot takeover is announced for 4 seconds and then invisible forever |

**The batch does not rename or re-model `rooms.status`.** That is a persisted shape, and
changing it would reach far outside these seven findings. Instead every handler that needs to
know "is a match still running" asks the in-memory game — `activeGames.get(roomId)?.matchOver`
— which is already the honest source. `rooms.status` keeps its current values and its current
writes.

## Storage impact: none

**No table is added, no column is added, no persisted shape changes.**

- `abandonedSeats` (SEC-02) lives on the **in-memory** `OnlineGameState` only. D1 requires
  this explicitly: putting it in the `game_state` envelope would change a persisted shape and
  force a `GAME_SCHEMA_VERSION` bump (`server/onlineGameLogic.ts:156`), which disposes every
  live game on the next rejoin. The cost of losing the map on a restart is that a hand
  interrupted by a deploy does not score its abandoned seat — acceptable, and strictly better
  than today, where no abandoned seat ever scores.
- `GameResult.abandoned` (SEC-02) is a field on an in-process interface
  (`lib/achievements.ts`), never persisted. `match_history` and `user_ratings` gain rows they
  did not previously get, in their existing shapes.

Consequence: `git revert` of any commit in this batch needs no database step.

## Protocol impact

Additive only. No event is removed and no existing payload field changes meaning.

| Event | Change |
|---|---|
| `room:error` | new code `MATCH_IN_PROGRESS` (SEC-01) |
| `room:error` | new code `NEW_MATCH_NOT_READY` (D4's consent gate) |
| `game:error` | now emitted on the rematch bail-outs that were silent (RULE-01) |
| `game:player_left` | **kept**, but see the emit change below (NET-01) |
| `game:seat_bot_takeover` | unchanged; UX-13 consumes it plus `players[seat].type` |

`room:player_left` (`server/socket.ts:2318`) is **not** touched here — ARCH-08 deletes it in
Batch 13. It is one letter from `game:player_left`, which this batch keeps and extends.
(`CONFLICTS.md` C5.)

Every new code gets keys in `locales/it.ts`, `en.ts` and `sq.ts`; `tests/i18n.test.ts` pins
parity.

## The changes, in implementation order

The order is load-bearing where stated. One commit per finding — the rollback story depends
on being able to revert a single finding out of the merged batch.

### 1 · RULE-02 — vacated and bot seats abstain

`countRematchAnswers` (`server/socket.ts:1008`) asks `botWantsRematch` for every seat with no
`playerMap` entry, feeding it `cumulativeScores["bot:<seat>"]` — a key `excludeBotSeats`
(`server/onlineGameLogic.ts:78`) strips by construction. It is always `0`, so from the first
point scored every bot seat votes no, and `isMajority` can never be reached on a bot-filled
table.

**Implement D4's stated option (b): a seat with no `playerMap` entry is excluded from both
`yes` and `total`.** The verdict becomes the connected humans' majority.

```
for each seat:
  userId = playerMap[seat]
  if userId is undefined: continue          // abstain — not counted in total either
  total++
  if rematchIntents.get(userId) === true: yes++
```

**This must land first.** D4's new-match consent gate (step 5) is a unanimity gate, and a
unanimity gate that counts seats which cannot answer deadlocks — which is exactly the NET-01
bug, rebuilt in a new place.

**The stated fix risk:** the denominator must not change for human-only tables. A seat with a
userId still counts toward `total`. The unit test pins both directions.

### 2 · NET-01 + UX-13 — free the seat at the results screen, and show it

Two call sites, both in `server/socket.ts`:

- `handleLeaveRoom` (`:2268`): replace `else if (room.status === "in_progress")` with a branch
  that runs `vacateSeat` whenever `activeGames.has(roomId)`, whatever `rooms.status` says.
- the disconnect handler (`:1987`): when `game.gameState.gameOver`, run
  `handleLeaveRoom_lobby` **and** `vacateSeat`. No grace timer — nobody is mid-turn.

`vacateSeat`'s `gameOver` branch (`:671-691`) already does the right thing and needs no new
event.

**The hazard (`CONFLICTS.md` C5, and NET-01's own Fix-risk field).** That branch emits
`game:player_left` at `:674`, and the client turns that event into the blocking "Partita
interrotta" teardown (`context/OnlineGameContext.tsx:368`, `app/(online)/game.tsx:137-154`).
Making the branch reachable therefore ejects every remaining player from a table that is
perfectly alive. **Adjust the emit at `:674`, not the client** — the remaining players should
see an updated vote tally and a bot marker, never a teardown alert.

`game:vote_state`'s `total` must agree with the gate that reads it. RULE-02 has just made the
gate count *seated* seats, so `total` stays `Object.keys(game.playerMap).length`.

**UX-13, same commit path, its own commit.** `game.gameState.players[seat].type` is set to
`"ai"` at `:667` and survives `sanitizeStateForPlayer`, so the client already has the fact —
no protocol change. Render a persistent marker on the seat in `components/GameShared.tsx`
(`TopOppSlot:285`, `SideOppSlot:320` — both already receive the whole `Player`).

**Decision — mark every `type === "ai"` seat, do not distinguish takeover from dealt-in.**
The appendix asks for the distinction "if that is cheap" and it is not: a seat vacated
mid-match keeps the departed human's username, so telling the two apart needs a new field
threaded through the sanitizer. What the player needs to know is "this seat is a bot now",
and the name already carries who it used to be. A dealt-in bot showing the same marker is
correct, not a false positive.

### 3 · RULE-01 — deal the next manche from the game, not the database

`game:rematch_vote` (`server/socket.ts:1607-1634`) rebuilds the roster from
`storage.getRoomPlayers` — a table that holds **only humans**; bot seats were never rows.

Four consequences, all from those thirty lines:

1. `players.length < 2` (`:1610`) silently returns, so **1 human + bots can never reach manche
   2** — the default online solo flow. Votes were already cleared at `:1605`, so it cannot even
   be retried.
2. `type: "human"` is hardcoded (`:1616`), so a 2-human + 2-bot table becomes a 2-seat table
   mid-match while `cumulativeScores` and `matchTarget` carry over — the points scale silently
   changes from 3/2/1/0 to 1/0.
3. `playerMap` is keyed by array position (`:1629`), not seat index, so seats renumber. The
   exchange then runs between the wrong players: A2 executed a table where bots placed 1st and
   2nd and got `exchangePhase.winnerIdx = 0`, the human who actually placed 3rd.
4. Every bail-out returns with no `game:error` and no `game:vote_state`.

**Fix:** build the next roster from `game.gameState.players` (name, type, team, personality)
and copy `game.playerMap` rather than re-indexing. Check *seat* count, not human count. Move
`rematchVotes.clear()` to after every bail-out. Emit `game:error` and re-broadcast
`game:vote_state` when it genuinely cannot proceed. Keep the DB read only for `room.gameMode`
and `room.maxPlayers`.

D2 settles that this is implemented as written: one seated human plus bots plays a **full
match**, because the room screen already offers bot-fill and the match-length picker together
and `room:start` already permits a one-human start.

**The stated fix risk is the serious one:** `playerMap` is what `sanitizeStateForPlayer` uses
to decide who sees which hand. A wrong copy hands a player someone else's cards. The existing
"a player never receives another player's hand" assertion in
`tests/integration/gameplay.test.ts` covers it and must stay green.

### 4 · SEC-01 — `room:start` stops being a second deal path

Two rules, per D4.

**While a match is running (`matchOver === false`): refuse outright.** Read
`activeGames.get(roomId)` *before* the status guard and emit
`room:error { code: "MATCH_IN_PROGRESS" }`. The next manche of a running match is
`game:rematch_vote`'s job. Also: **ignore the payload's `matchLength`** whenever a previous
game exists with `matchOver === false` — that is the field that converts a match being lost
3–18 into a one-hand shootout (`:1406`, then `handleGameOver:789-793`).

**After a match has genuinely ended (`matchOver === true`): require the same consent gate as a
rematch** — unanimous ready among *connected seated humans*, not the host alone. Refuse with
`room:error { code: "NEW_MATCH_NOT_READY" }` until it is met.

This gate is why RULE-02 goes first. With RULE-02's abstain rule, vacated and bot seats are
excluded from the denominator, so a table with a vacated seat still reaches its new match. The
composition is the thing the integration test must prove, not the gate in isolation.

No shipped client emits `room:start` between manches — `app/(online)/room.tsx:398` is the only
caller and it runs on the pre-game screen; the between-hands control is `voteRematch`
(`app/(online)/game.tsx:323`). So this is reachable only from a modified client, which is the
attacker in scope, and blocking it should not affect any real flow. Verify against
`app/(online)/game.tsx:300-340` before landing.

### 5 · SEC-02 — an abandoned hand is scored, not discarded

The rule is D1: **a seat abandoned mid-hand is recorded as a last-place finish.** The player
loses rating and loses their streak. No penalty beyond that.

D1 also states the accepted consequence outright, so nobody re-litigates it mid-implementation:
**a genuine network drop is punished identically to a rage-quit.** There is no reliable signal
to tell them apart, and a guess would be a new class of unfairness rather than a fix. Do not
add a heuristic.

Mechanism:

- `OnlineGameState.abandonedSeats: Map<number, string>` — seat → the userId `vacateSeat` just
  removed from `playerMap` (`:663`). In memory only, for the reason given under *Storage
  impact*.
- `handleGameOver` builds `gameResults` entries for those seats too, keyed by the **real
  userId**, with `placement = state.players.length` and a new `abandoned: true` flag on
  `GameResult`, so `evaluateAchievements` refuses to award anything for the seat.
- `recordRatedResult` must see a real last-place finisher, not a bot. `ratedFinishers`
  (`lib/rating.ts:96`) filters on the `bot:` prefix, and the real userId does not carry it —
  so keying the entry correctly is the whole fix. **The `bot:` sentinel and "a human who left"
  are two different things and must stop sharing one key.**
- The `remaining <= 1` branch (`:693-712`) must **run the scoring path before `disposeGame`**:
  award the surviving player the win for that hand — they are the only seat still holding
  cards — then `handleGameOver`, then dispose.

**The trap nobody will see coming.** `handleGameOver` computes
`humanSeats = Object.keys(game.playerMap).length` (`:947`) and gates every write on
`isContestedTable(humanSeats, botSeats)` (`server/onlineGameLogic.ts:145`, `botSeats <=
humanSeats`). A vacated seat is *already out of `playerMap`*, so on the heads-up case that
SEC-02's first acceptance criterion describes — two players, one leaves — `humanSeats` is 1
and `botSeats` is 1, and although `isContestedTable(1,1)` happens to be true, the four-handed
case collapses: 4 seats, one abandoned gives `humanSeats = 3, botSeats = 1`, still true, but a
table where *two* leave gives 2 v 2 and then 1 v 3, which is false. **`humanSeats` must count
abandoned seats as the humans they are** — `Object.keys(playerMap).length +
abandonedSeats.size`. Getting this wrong makes the fix silently do nothing in exactly the
cases it exists for, and every test would still pass on the two-player case.

`cumulativeScores` is a separate question and does **not** change: `excludeBotSeats` keeps a
vacated seat from accumulating match points and becoming eligible to win the match under the
departed human's username. Match scoring and stats/ratings recording are different mechanisms
and this batch only moves the second.

**Fix risk:** awarding the hand in the `remaining <= 1` branch touches the path that disposes
the table. A mistake there strands a game in `activeGames` after the last player has gone —
covered by the prune assertions already in `tests/integration/abandonedGames.test.ts`.

### 6 · ARCH-07 — fold the two leave functions

`handleLeaveRoom` (`:2226`) and `handleLeaveRoom_lobby` (`:2276`) share **seventeen identical
lines** of `waiting`-branch host migration and diverge around them, neither a superset of the
other. NET-01 is a difference of *omission* between those two bodies.

One function:

```ts
async function handleSeatRelease(
  io: SocketServer,
  roomId: string,
  userId: string,
  username: string,
  opts: { socket?: { id: string; leave: (r: string) => void }; source: "leave" | "disconnect" }
)
```

Clear the user's timers unconditionally — the disconnect path skips this today for no stated
reason. `await storage.removeRoomPlayer(...).catch(() => {})`. `socket?.leave(roomId)`. Then
**one** `waiting` branch and **one** "the game may still be live" branch running `vacateSeat`
whenever `activeGames.has(roomId)`. Keep `room:leave`'s `publicRoomIds` cleanup at its current
call site — it needs the post-removal player count. Leave `room:player_left` in place for
ARCH-08.

**Departure from ARCH-07's own advice, stated so it is a choice and not an oversight.** Its
Fix-risk field asks for NET-01 and this refactor in *one* commit. The batch's one-commit-per-
finding rule wins: it is what makes `git revert <finding-sha>` work, and the plan orders these
two findings four steps apart. NET-01 therefore writes the missing branch into the existing
two functions, and ARCH-07 folds them — the branch is written twice, and the second time
deletes the first. That is a few minutes of rework in exchange for keeping the rollback story
intact.

**Fix risk:** this function runs on the disconnect path inside a `void (async () => …)` with
its own try/catch. An unguarded throw becomes a logged failure rather than a crash — and
silently strands the room. Every `storage.*` call stays `.catch`-guarded.

### 7 · Record D1 and D4 in `docs/BRIEF.md` §3.1

`CLAUDE.md` requires rule decisions to live there, and this batch is where they become real.
D2 and D3 are product/lifecycle calls rather than rule changes; they belong in
`docs/ARCHITECTURE.md`, which Batch 14 (ARCH-03) is correcting anyway.

## What proves it

All integration cases need a live Postgres.

| Finding | Test |
|---|---|
| RULE-02 | unit via `__testables` (`server/socket.ts:212`): `playerMap = {0:"u1"}`, 4 seats, `cumulativeScores = {u1:7}`, `rematchIntents = {u1:true}` → `tableWantsRematch` **true**. Companion: a human-only table's denominator is unchanged |
| NET-01 | `gameplay.test.ts`: three clients play a manche to `game:over`, one emits `room:leave`, the other two emit `game:rematch_vote` and **both receive `game:started`**. Second case: a hard disconnect at the results screen. Third: the last player leaving disposes the room |
| UX-13 | native test: after `game:seat_bot_takeover` the seat renders its bot marker for the rest of the match, not only while the banner is up |
| RULE-01 | `gameplay.test.ts`: `room:start { fillWithBots: true }` with one human reaches manche 2 with the same seat count and its bot seats still AI-driven; a 2-human + 2-bot table keeps `players.length === 4`; `exchangePhase.winnerIdx` is the seat of the previous manche's `rankings[0]`; every bail-out emits `game:error` |
| SEC-01 | `gameplay.test.ts`: the host emitting `room:start { matchLength: "single" }` between manches gets `room:error` and the state is unchanged. Plus D4: after `matchOver === true` the host's `room:start` does **not** start until every connected seated human has readied, **and a table with one vacated seat still reaches the new match** |
| SEC-02 | `ladderAndReplay.test.ts`: two players, one disconnects mid-hand; after the grace **both** have a `user_ratings` row, the quitter's delta negative. `stats.test.ts`: four players, one leaves mid-hand; the leaver has a `match_history` row with `placement = 4` and no achievement unlocked |
| ARCH-07 | `grep -c "handleLeaveRoom"` shows one definition and two call sites; the 17-line block appears once; NET-01's repro still passes |

`tests/rating.test.ts` must pass **unchanged** — SEC-02 changes *who* is fed into the
arithmetic, never the arithmetic itself. That is the regression test for the whole of SEC-02.

## Replit

Nothing here adds a build step, a dependency or an environment variable. `PORT` and
`DATABASE_URL` are untouched, `server/schemaDdl.ts` emits no new statement, and no migration
is needed because no persisted shape moves.
