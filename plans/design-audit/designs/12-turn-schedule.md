# 12 — One turn schedule for both tables (review card 1)

Code is cited at MAIN `a1d0ebb5`. #1624 closed after that commit, so its offline deal gate on the bot
(`app/game.tsx` `botTurnKey`) is on origin/main and is not in MAIN. #1628 is open, and its PR #1724
is unmerged.

## 1. Verdict: do it, with a narrower scope than the card

- **Evidence.** The two tables disagree in six places about when a seat acts and what deadline it
  has. Only one of those differences is recorded (GAME-RULES § Decisions, "The offline turn clock").
  One difference is a live bug that #1624 deferred as "a server ticket of its own" and that nobody
  filed: online, a bot opener plays inside the deal. A second is a hidden deadline: an online
  exchange winner has a 30 s AFK window and no clock on screen. #1628 (PR #1724) nearly lost its
  vote deadline because `armTurn` clears every room timer as a side effect.
- **The two adapters are real.** They are the server's `armTurn` and CLI-6's `useOfflineDriver`. A
  pure policy module between them passes the deletion test: delete it and the six decisions go back
  to being spread across `gameTurn.ts`, `app/game.tsx`, `turnTimerUi.ts` and two screens' props.
- **What it does not do.** The module does not own timers or durations. The server *computes* how
  long a gate lasts, and the offline driver *observes* the table to see a gate end. Those are two
  different mechanisms, and that is the right split. The module names the gates. Each adapter
  decides how to wait for them.
- **Cost.** Three tickets: S + M + S, about $105 in caps. One is a player-facing bug fix that can
  land early. One is the module. One is a UI change for the owner's eye.

## 2. The after-plan shape that hurts

The plan moves the code. It does not merge the decision. CLI-6 moves the bot loop into
`context/offlineDriver.ts` "unchanged" and keeps `botTurnKey`'s semantics exactly (07-client §4.5).
ENG-3 moves `exchangeCeremony` and `offlineBotDelay` into `lib/timeline/`. WIRE-1 and WIRE-2 give
both tables `lastMove`, and `armAfterMove` takes `next`. UI-4 builds `turnPresentation`, and UI-6
builds `useCountdown`. After all of that, "who acts, after what, against what deadline" is still
decided in two places:

| # | Question | Online (server) | Offline (client) | Recorded? |
|---|---|---|---|---|
| a | Bot "think" delay | 1200 ms, `server/game/gameTimers.ts:133` `botMoveDelayMs` | 1100 ms, `lib/game/offlineBotDelay.ts:2` | no; feel drift |
| b | Bot after an exchange closes | `exchangeAnnounceMs` *instead of* the think delay, `server/game/gameTurn.ts:164-167` | waits for `exchangeAnnouncing` to clear, *then* 1100 ms, `app/game.tsx:113-127` | no |
| c | Bot opener during the deal | 1200 ms after the deal starts, while the deal takes ≥1.5 s; `armTurn` has no deal floor except when an exchange is on the table (`gameTurn.ts:139-143`) | waits for the deal to land (#1624, on origin/main) | **bug**: #1624 "Not this ticket" names it and no ticket was filed |
| d | Is a lead timed? | yes, the AFK timer runs every turn (`gameTurn.ts:156-159`) | no (`app/game.tsx:210-211` `includeNewTrick: false`; `components/turnTimerUi.ts:100-104`) | no; it lives in comments only |
| e | Is the exchange winner timed? | yes: `actingSeat` is the winner (`gameTurn.ts:43-47`), the AFK window is armed, and `PLAYER_AFK_AUTO_EXCHANGE` fires (`:265`) | no | no. The online clock is also **invisible**: `turnTimerActive` returns false when `exchangeActive` (`turnTimerUi.ts:121`), and the seat ring passes the same flag (`components/GameTable.tsx:1013-1023`) |
| f | The opening hold | the deadline is extended by `Reading.notice`, a UI token the server imports (`gameTurn.ts:37,156`) | the clock pauses while the opening notice is up (`app/game.tsx:214` `pausable: true`; `GameTable.tsx:961`) | same intent, two mechanisms. They agree only because `components/table/notices/panels.tsx:95` also waits `Reading.notice` |

There is a structural hazard on top of the table. `armTurn` is both the turn scheduler and
`clearRoomTimers` (`gameTurn.ts:128`, `gameTimers.ts:162-166`). PR #1724 (#1628) adds a
`voteDeadline` kind to `clearRoomTimers`. It then had to move the clear below the `roundOver` return
so that a rejoin at the results screen (`armTurnIfIdle` → `armTurn`) would not cancel the vote
deadline. Every future room timer kind inherits that trap.

The screens carry the policy as props: `includeNewTrick` and `pausable` (`app/game.tsx:208-224`,
`app/(online)/game.tsx:263-268`, `components/GameTable.tsx:200-227`). PR #1724 adds a third deadline
source to the same chip (`voteClock ?? turnTimer`). After UI-4 and UI-6 the props are still there:
UI-6 changes how the countdown runs, not whether one runs.

CLAUDE.md's `autoMove` invariant covers *which* move a bot makes. Nothing covers *when* it makes it.

## 3. Alternatives

1. **Constants only.** Share `BOT_THINK_MS`, record (d) and (e) in GAME-RULES, and file (c) as a bug.
   This is cheap, but (b), (c) and (f) are about *sequence*, not numbers, and they would drift again.
   No test could see the next divergence.
2. **A full turn engine that owns its timers** (the card's literal "hold durations move behind the
   interface"). The offline driver would then wait on computed milliseconds instead of on the
   table's real gates. #1624 shows why that is wrong: the gates must exit on what the table actually
   did (the deal landing, `onExchangeReady`), and a wall-clock guess replays the soft-lock class the
   watchdogs exist for. The server cannot observe the client, so it must compute. Forcing both onto
   one mechanism breaks one of them.
3. **Pick: a pure schedule that names gates and policy, with two adapters that wait in their own
   way.** It fixes (a), (b) and (c) by construction, because both adapters wait for the same gates
   and then the same think delay. (d), (e) and (f) become named policy rows that the UI reads instead
   of props. The server stops importing `lib/tokens`.

## 4. Target design

**Module: `lib/game/turnSchedule.ts`**, beside `autoMove.ts`. It is pure and imports only engine
types and `openingIsPending`. It does not import `lib/timeline`, so ENG-3's boundary test still
holds.

```ts
export type TableKind = "online" | "offline";
/** What the table must finish showing before the acting seat may act. */
export type Gate = "deal" | "exchangeReceived" | "exchangeCeremony";

/** GAME-RULES § Decisions "The turn clock": each row is a recorded rule, changed only there. */
export interface TurnPolicy {
  leadTimed: boolean;            // online true, offline false   (d)
  exchangeTimed: boolean;        // online true, offline false   (e)
  opening: "extendDeadline" | "pauseClock";   // online extend, offline pause (f)
  clockOwner: "server" | "local";
}
export const TURN_POLICY: Record<TableKind, TurnPolicy>;
export const BOT_THINK_MS: number;          // one number (OD-3); the server keeps its env knob over it

export interface TurnSlot {
  seat: number;                              // exchange winner, else the turn holder
  acts: "human" | "bot";
  after: readonly Gate[];                    // derived from state.lastMove and exchangePhase
  thinkMs: number;                           // BOT_THINK_MS for a bot, 0 for a human
  deadline: { ms: number; openingGrace: boolean } | null;   // null = untimed under the policy
}
/** null when the round is over: no seat is on move. */
export function turnSchedule(state: GameState, table: TableKind, isBot: (seat: number) => boolean): TurnSlot | null;
```

**Gate derivation, one table:**
- `lastMove.kind === "deal"` → `deal`.
- An active exchange whose winner is a bot → `exchangeReceived`.
- A giveback, or a both-Jokers deal → `exchangeCeremony`.
- The opening notice is not a bot gate. In both modes today a bot opener plays over it and the play
  ends it, so that behaviour is kept. For a human the opening notice is the `openingGrace` flag on
  the deadline.

**Server adapter** (`server/game/gameTurn.ts` `armTurn`; `server/game/tableRuntime` once SRV-4 lands):
- The bot delay is `gateMs(after, counts, twoJokers)` combined with `thinkMs` per OD-4.
- `gateMs` is a pure function in `lib/timeline/turnGates.ts`:
  - `deal` → `dealEndMs(counts, Motion.duration.reveal)`
  - `exchangeReceived` → `exchangeGiveDelayMs`
  - `exchangeCeremony` → `exchangeAnnounceFrom`
- The human deadline is `afkTimeoutMs() + (openingGrace ? OPENING_NOTICE_MS : 0)`.
  `OPENING_NOTICE_MS` lives in `lib/timeline/` and `panels.tsx` reads the same constant.
- `armTurn` clears only the turn kinds (`afk`, `bot`). `dealRound` and `disposeGame` keep clearing
  the room's other timers.

**Offline adapter** (`context/offlineDriver.ts`): `botTurnKey` is non-null when
`slot.acts === "bot"` and every gate in `slot.after` is observed:
- `deal`: the table's `dealing` is false (#1624).
- `exchangeReceived`: `onExchangeReady` has fired.
- `exchangeCeremony`: `exchangeAnnouncing` is false.

It is keyed on `lastMove.seq` (WIRE-2), and then waits `slot.thinkMs`. The human `turnTimer` it
returns carries `TURN_POLICY.offline`.

**UI** (`components/turnTimerUi.ts`):
- `turnTimerActive` takes `policy: TurnPolicy` instead of `includeNewTrick`.
- `pausable` becomes `policy.clockOwner === "local"`.
- The online exchange winner's chip and ring run, because `exchangeTimed` is true (OD-2).

**Invariants:**
- `turnSchedule` is the only place that decides which seat acts, its gates and whether it is timed.
- Its only production callers are the server adapter and the offline driver. A caller-count pin with
  a planted probe enforces this.
- A `TURN_POLICY` row changes only with a GAME-RULES § Decisions entry. The policy test cites the
  row.
- `autoMove.ts` still chooses *what* is played.
- The turn adapter never clears a timer kind that is not a turn kind.

**Deleted:**
- `lib/timeline/offlineBotDelay.ts` (after ENG-3)
- `actingSeat` and `armAfterMove` in `gameTurn.ts`
- the `Reading` import on the server
- the `includeNewTrick` and `pausable` props, together with the comment blocks that explain them
  (`GameTable.tsx:209-226`, `app/game.tsx:209-214`, `app/(online)/game.tsx:266-267`)
- the `includeNewTrick` input of `turnTimerActive`

## 5. Migration, each step green

1. **TURN-1 (bug, early).** The server bot opener waits for the deal. This is a local change in
   `armTurn`: add a deal floor beside the existing exchange floor. Red first.
2. **TURN-2.** Add `turnSchedule` and both adapters. A characterization pin goes first and is green
   on main: `exchangeRearm`, `openingGrace`, `onlineAutoPass`, `offlineDriver` and
   `firstRoundWaitsForDeal` stay unchanged. Then the module lands. The only behaviour changes are
   OD-3 and OD-4, each with a red-first test. The armTurn-clears-only-turn-kinds pin is red on main
   only if #1724 has not landed; otherwise it is a green pin with a planted probe.
3. **TURN-3 (owner-eye).** The UI reads the policy, and the props are deleted. Behaviour change: the
   online exchange winner sees a clock.

## 6. Owner decisions and amendments

**Owner decisions (recommended defaults):**
- **OD-1, is a lead timed?** Keep online timed and offline untimed. Record both in a new GAME-RULES
  § Decisions row, "The turn clock", in TURN-2. This is not a rule change; it records today's
  behaviour.
- **OD-2, is the exchange winner timed?** Keep online timed (30 s, auto-exchange) and offline
  untimed, and record it in the same row. Show the online clock while the winner chooses (TURN-3).
  Today a player loses the choice to a deadline they cannot see.
- **OD-3, one bot think delay?** Yes: `BOT_THINK_MS = 1200` (the server's value). Offline moves from
  1100. This is pacing, not a rule, and "one number" follows the offline-clock precedent.
- **OD-4, how does a gate combine with the think delay?** Wait for the gates, then think, in both
  modes (offline's current shape). Online, a bot after an exchange gets about 1.2 s slower. The
  alternative is `max(gates, think)` (the online shape), which makes offline faster after an
  exchange.

**Amendments to planned tickets:** none are required.
- CLI-6's driver return type (`turnTimer: { includeNewTrick: false; pausable: true }`, 07 §4.5)
  lands as designed, and TURN-3 replaces it.
- WIRE-2's `armAfterMove(next)` lands as designed, and TURN-2 deletes it.

## 7. Tickets

| ID | title | area | size | ledger IDs | files/modules | blocked by | label | owner-eye? |
|---|---|---|---|---|---|---|---|---|
| TURN-1 | Online: a bot opener waits for the deal | server | S | review C1 | server/game/gameTurn.ts, tests/server/botWaitsForDeal.test.ts (new) | #1628 | ready-for-agent | no |
| TURN-2 | One turn schedule: who acts, after which gates, against which deadline | engine | M | review C1 | lib/game/turnSchedule.ts (new), lib/timeline/turnGates.ts (new), lib/timeline/offlineBotDelay.ts (deleted), server/game/{gameTurn,gameTimers,dealRound}.ts, context/offlineDriver.ts, components/table/notices/panels.tsx, docs/GAME-RULES.md, CLAUDE.md, tests/engine/turnSchedule.test.ts (new), tests/tooling/turnScheduleCallers.test.ts (new) | CLI-6, ENG-3, WIRE-2, TURN-1 | ready-for-agent | no |
| TURN-3 | The turn clock reads the policy; the exchange winner's online clock shows | table-ui | S | review C1 | components/turnTimerUi.ts, components/GameTable.tsx, app/game.tsx, app/(online)/game.tsx, context/offlineDriver.ts, tests/ui-rules/turnTimerUi.test.ts | TURN-2, UI-4, UI-6 | ready-for-agent | yes |

## 8. Spec cards

### TURN-1: Online: a bot opener waits for the deal (S)
- **Defect:** online, a vacant seat that opens a round without an exchange plays at
  `botMoveDelayMs()` (1200 ms). The deal it opens takes at least 1.5 s, so the bot's play flies over
  cards that are still being dealt. Offline this was fixed by #1624, which named the online half "a
  server ticket of its own"; that ticket was never filed.
- **Where:** `server/game/gameTurn.ts:137-147` (`armTurn`, the vacant-seat branch). The floor exists
  only for an exchange (`:139-143`). `lib/game/dealTimeline.ts:21` `dealEndMs`;
  `lib/game/exchangeTimeline.ts:121` `exchangeGiveDelayMs` (the precedent:
  `dealEndMs(counts, Motion.duration.reveal)`).
- **Build:**
  - When `roundUnplayed(state)` and the acting seat is vacant, the delay is
    `Math.max(botDelayMs, dealEndMs(counts, Motion.duration.reveal))`. This is the same floor the
    exchange branch already uses.
  - Pass the counts with `handCountOf`, as `:142` does.
- **Constraints:**
  - `autoMove.ts` still chooses the move. Change only *when* the bot plays.
  - Do not reorder #1628's `roundOver` return and clear (PR #1724).
  - The human AFK path is unchanged.
- **DoD:**
  - [ ] Red first: `tests/server/botWaitsForDeal.test.ts` on the fake clock (as
    `tests/server/openingGrace.test.ts`). For a 4-bot table with no exchange, nothing is played at
    `botMoveDelayMs()` and the bot plays at `dealEndMs(...)`. It fails on main.
  - [ ] A 2-seat case, where the deal is longest.
  - [ ] `exchangeRearm.test.ts` and `openingGrace.test.ts` are unchanged and green.
- **Checks:** `node --test tests/server/botWaitsForDeal.test.ts tests/server/exchangeRearm.test.ts
  tests/server/openingGrace.test.ts`. Gate, plus integration `gameplay` and `turnDeadline`.
- **Not this ticket:** the schedule module (TURN-2), or the think-delay value (OD-3).
- **Source:** 12-turn-schedule §2 row c; #1624 "Not this ticket"; review card 1.

### TURN-2: One turn schedule: who acts, after which gates, against which deadline (M)
- **Defect:** the server's `armTurn` and the offline driver each decide who acts next, what they
  wait for and whether they are timed, and they already disagree:
  - The bot think delay is 1100 ms against 1200 ms.
  - After an exchange, one waits "ceremony then think" and the other `exchangeAnnounceMs` alone.
  - The lead and the exchange winner are timed online and untimed offline, and that difference is
  recorded nowhere.

  The server imports `Reading.notice` from `lib/tokens`. `armTurn` clears every room timer, which
  nearly cancelled #1628's vote deadline.
- **Where:**
  - `server/game/gameTurn.ts:37-47,124-167`
  - `server/game/gameTimers.ts:133,162-166`
  - `lib/game/offlineBotDelay.ts:2` (moved by ENG-3)
  - CLI-6's `useOfflineDriver` bot loop, which was `app/game.tsx:113-127`
  - `components/table/notices/panels.tsx:95`
  - GAME-RULES § Decisions "The offline turn clock"
- **Build:**
  - `lib/game/turnSchedule.ts`: `TableKind`, `Gate`, `TurnPolicy`, `TURN_POLICY`, `BOT_THINK_MS`
    and `turnSchedule(state, table, isBot)`. Gates come from `lastMove` and `exchangePhase`, as
    12-turn-schedule §4 says.
  - `lib/timeline/turnGates.ts`: `gateMs(gates, counts, twoJokers)`, the server's resolution of a
    gate to a duration, and `OPENING_NOTICE_MS`. `panels.tsx` reads `OPENING_NOTICE_MS` too.
  - `armTurn` becomes the server adapter. It clears only the turn kinds (`afk`, `bot`); `dealRound`
    clears the room's other kinds. Delete `actingSeat`, `armAfterMove` and the `Reading` import.
  - The offline driver's bot key becomes "every gate observed": `dealing` false, `onExchangeReady`
    fired, `exchangeAnnouncing` false. It is keyed on `lastMove.seq` and waits `slot.thinkMs`.
    Delete `offlineBotDelay.ts`. `botMoveDelayMs()` defaults to `BOT_THINK_MS` and keeps its env
    knob.
  - OD-3 (one think delay) and OD-4 (gates, then think).
  - A GAME-RULES § Decisions row, "The turn clock", recording OD-1 and OD-2 as today's behaviour.
    Add a CLAUDE.md invariant line beside the `autoMove` one: `turnSchedule` decides *when*.
- **Constraints:**
  - `lib/game/turnSchedule.ts` imports nothing from `lib/timeline/` (ENG-3's boundary test).
  - `autoMove.ts` stays the only chooser of the move.
  - Hooks run before `if (!gameState)`.
  - The offline gates exit on table events, never on a computed time (`oneClock`; #1624's
    watchdogs).
  - A `TURN_POLICY` row changes only with a GAME-RULES entry.
- **DoD:**
  - [ ] First, green on main and unchanged after: `exchangeRearm`, `openingGrace`,
    `onlineAutoPass`, `offlineDriver`, `firstRoundWaitsForDeal` and `exchangeHoldsTheTurn`.
  - [ ] `tests/engine/turnSchedule.test.ts`: a node table with one row per `lastMove` kind × table
    × seat kind, plus opening and both Jokers.
  - [ ] Red first (OD-3): an offline bot does not play at 1100 ms and does play at `BOT_THINK_MS`.
  - [ ] Red first (OD-4): online, a bot after a giveback plays at
    `exchangeAnnounceMs + botMoveDelayMs()`, not before.
  - [ ] A rejoin through `armTurnIfIdle` never clears a non-turn timer kind. Use a planted probe
    with a fake extra kind.
  - [ ] `tests/tooling/turnScheduleCallers.test.ts`: `turnSchedule` has exactly two production
    importers (`gameTurn.ts` and `offlineDriver.ts`). It has a floor and a planted probe.
  - [ ] `rg "Reading" server/` finds nothing. `offlineBotDelay` and `armAfterMove` have zero
    references.
- **Checks:** `node --test tests/engine/turnSchedule.test.ts tests/server/exchangeRearm.test.ts
  tests/server/openingGrace.test.ts tests/server/tableStalls.test.ts
  tests/tooling/turnScheduleCallers.test.ts tests/tooling/libGameBoundary.test.ts`;
  `npx jest tests/native/{offlineDriver,offlineAutoPass,firstRoundWaitsForDeal,exchangeHoldsTheTurn}.test.tsx`.
  Gate, plus integration `turnDeadline` and `gameplay`, and e2e `motionMatch`, `motionThirdDeal` and
  `offlineMatch`.
- **Not this ticket:** what the UI shows (TURN-3), or the countdown mechanics (UI-6).
- **Source:** 12-turn-schedule §2-§5; review card 1.

### TURN-3: The turn clock reads the policy; the exchange winner's online clock shows (S, owner-eye)
- **Defect:** the screens pass the turn policy as loose props (`includeNewTrick`, `pausable`), and
  `turnTimerActive` hard-codes "never during the exchange". Online, the exchange winner is under a
  30 s AFK deadline with no chip and no ring, so they can lose the choice to a clock they never saw.
- **Where:**
  - `components/turnTimerUi.ts:100-125`
  - `components/GameTable.tsx:200-227,961-1027`
  - `app/game.tsx:208-224`
  - `app/(online)/game.tsx:263-268`
  - `tests/ui-rules/turnTimerUi.test.ts:153-162`
- **Build:**
  - `TurnTimerConfig` carries `policy: TurnPolicy` (from TURN-2) instead of `includeNewTrick` and
    `pausable`.
  - `turnTimerActive` reads `policy.leadTimed`, `policy.exchangeTimed` and `policy.opening`.
  - Delete both props and their comment blocks.
- **Constraints:**
  - Offline behaviour is unchanged: no clock on a lead or on the exchange.
  - The online chip still has no `onExpire`.
  - #1628's vote clock keeps precedence on the chip.
  - Hooks run before `if (!gameState)`.
- **DoD:**
  - [ ] Red first: online, the exchange winner's chip counts down from the server's seconds
    (native). It fails on main.
  - [ ] The `turnTimerUi` node table is re-keyed by policy. Its offline rows are unchanged.
  - [ ] `rg "includeNewTrick|pausable"` finds nothing.
  - [ ] Captures of the online exchange choice with the clock. The PR is left for the owner (D27).
- **Checks:** `node --test tests/ui-rules/turnTimerUi.test.ts`; `npx jest
  tests/native/{seatTurnClock,matchTurnChip,turnChipLabel,onlineAutoPass,offlineAutoPass}`. Gate,
  plus e2e `a11yOverlays`.
- **Not this ticket:** the countdown hook (UI-6), or the schedule itself (TURN-2).
- **Source:** 12-turn-schedule §2 rows d-f, OD-2; review card 1.
