# 15. A move is one intent from the hand to the engine (review card 4)

Candidate: review card 4 ("A move is one intent from the hand to the engine"), round 2, on top of
INTEGRATED.md. ID prefix MOVE. Code read at MAIN `a1d0ebb5` (`scratchpad/main2`).

## 1. Verdict: do part of it, with no new ticket

- **Do:** carry the engine's `Move` inside the server's `TableAction`, and give the test side one
  `sendMove(socket, move)`. Each is an amendment to a ticket that already rewrites those lines:
  ENG-6 for the server, TEST-7 for the tests. Neither touches `shared/protocol.ts`, so neither
  bumps anything.
- **Do not:** replace `game:play`/`game:pass`/`game:exchange_give_card` with one `game:move`, or
  narrow GameTable to `onMove`. After ENG-6 and SRV-2, the wire collapse deletes about 30 lines.
  It costs a MIN raise, about 21 test files, one merged rate bucket and a window during deploys
  where moves are lost silently. The GameTable change costs 48 test files to carry exactly the
  same information.
- **The card's premise is wrong in one place.** Riding WIRE-1 does not keep the cost level.
  WIRE-1 keeps MIN at 6 (R1 row 2), and removing an inbound event strands every old bundle. Its
  `game:play` goes to a server with no listener, the ack times out, and the player sees "move
  not delivered" on every move. Only WIRE-4 or WIRE-5 already pay for a MIN raise. If the owner
  wants the wire collapse, WIRE-5 is the ticket to ride (owner decision DM-1, default no).
- **Bugs prevented:** none observed. There is no shipped defect from the three paths diverging.
  The divergences that did exist (offline giveback skipping `commitState`, `GameContext.tsx:229-238`;
  each path's own refusal shape, `tableHandlers.ts:184-301`) are already fixed by ENG-6's
  `applyMove`, `MOVE_REFUSAL_CODES` and offline `act(move)`.

## 2. The after-plan shape, and what still hurts

The planned tickets that shape it:
- **ENG-6:** `Move`, `applyMove`, one `moveAction(io, game, userId, move)` and one `commitMove`.
  Offline gets a private `act(move)`, and its public `playCards`/`passTurn`/`chooseExchangeCard`
  stay as one-line wrappers (01-engine §4.1).
- **SRV-2:** registrations become `onEvent(socket, "<literal>", Schema, atTable(toDraft), limits)`.
  `WRAPPED_EVENT_COUNT` stays 18, and `TAKEOVER satisfies Record<TableActionKind, Mode>`.
- **SRV-5:** `moveAction`/`commitMove` move into `server/game/tableMoves.ts`.
- **WIRE-1:** adds D3, the glossary term "Move". The protocol bump keeps MIN 6.
- **WIRE-5:** protocol bump with MIN raised.
- **CLI-2:** online state is typed `WireGameState`.
- **TEST-4:** a `FakeSocket` typed on `protocol.ts`.
- **TEST-7:** typed integration sockets. Its files are `tests/helpers/{client,table,gameDriver}.ts`
  and `tests/soak/{soak,replay}.ts`.

What stays after all of them, with evidence at MAIN:

| Layer | Shape after the plan | Evidence at MAIN | Hurts? |
|---|---|---|---|
| Engine | `Move` = play / pass / giveback, one `applyMove` | ENG-6 (01-engine §4.1) | no: this is the deep module |
| Server table action | `TableAction` still restates the move as three kinds; `moveAction` maps them back into a `Move` | `server/game/tableActions.ts:27-29`; dispatch `tableHandlers.ts:751-756`; `takeoverMode` lists all three at `tableActions.ts:85-95` | **yes**: a restatement with no reason to exist, and it crosses instances |
| Socket registration | three `onEvent` sites, two schemas | `socketGameplay.ts:80-102,171-181`; `socketSchemas.ts:90-92,103-105`; `protocol.ts:111,112,117` | a little: after SRV-2 each one is a single line |
| Online provider | three `deliver` one-liners | `context/OnlineGameContext.tsx:978-988`; `deliver` at `:867-880` treats all three the same | no: there is no divergent behaviour |
| Offline provider | `act(move)` plus three wrappers (ENG-6) | `context/GameContext.tsx:229-255`; consumers `context/gameHooks.ts:18-21`, `app/game.tsx:58-76` (e2e `murlanPass`) | no |
| GameTable | `onPlay` / `onPass` / `onExchangeGive` | `components/GameTable.tsx:279-282,956,1472-1473`; `components/table/selectionLeaves.tsx:81-82,110,116` | no: these are three distinct controls |
| GameTable callers | 2 real callers and 3 no-op callers | `app/game.tsx:190-192`, `app/(online)/game.tsx:259-261`, `app/(online)/replay.tsx:179-182`, `app/capture.tsx:90-92`, `components/BenchScreen.tsx:129-131`; 48 test files pass `onExchangeGive` | cosmetic |
| Test drivers | four three-way `if play / pass / give` emit branches, plus a fourth restatement of `Move` | `tests/soak/soak.ts:228-238` (`SoakAction`/`SeatAction`) and `:410-441`; `tests/soak/replay.ts:161-163`; `tests/helpers/gameDriver.ts:99-118`; `tests/helpers/table.ts:186-196` | **yes**: four copies of the Move→event map, in files TEST-7 rewrites anyway |

What the wire collapse would cost:
- **Scans and counts.** `tests/server/protocolEvents.test.ts:56-63` needs the literal at each
  site, which the new name keeps. `tests/server/socketEvents.test.ts:206` would go from 18 to 16,
  and the required list at `:243-249` names `game:play` and `game:pass`.
- **Rate limits.** Buckets are keyed per event and per user (`server/socket/socketSafety.ts:111-130`).
  Today play and pass have 60/min each and exchange has 30/min (`socketGameplay.ts:43,90,101,180`).
  One event means one bucket.
- **Mixed revisions.** A forwarded table action of a new kind gets `UNKNOWN_ACTION`
  (`tableHandlers.ts:801-803`, `tableRouter.ts:41,161-164`). That code is not retryable, so the
  client is not told (`lib/sendIntent.ts:22,114-116`).

## 3. Alternatives

| | What | Deletes | Costs | Verdict |
|---|---|---|---|---|
| A | The full card: `game:move` with `MoveSchema`, `act(move)` on both providers, GameTable `onMove`, riding WIRE-5 | 2 schemas, 2 registrations, 2 `IntentSchemas` entries, 2 `TableAction` kinds, 4 provider wrappers, 2 GameTable props (about 60 lines) | WIRE-5 grows from M to L or more. About 21 wire test files and 48 GameTable test files change. The rate bucket merges, and the deploy window loses moves silently. | no |
| B | Wire only, riding WIRE-5 | about 30 lines beyond C | WIRE-5 grows by about S, plus about 21 test files, the merged bucket, a protocol-map edit and `WRAPPED_EVENT_COUNT` | owner decision DM-1, default no |
| **C** | **`TableAction` carries `Move` (ENG-6), and one test `sendMove` (TEST-7)** | 2 `TableAction` kinds, ENG-6's three-arm kind→Move mapping, 2 `TAKEOVER` entries, 4 test emit branches, the soak's restated union | about 5 small files in ENG-6 and one helper in TEST-7. The deploy window applies to forwarded moves only (DM-2). | **pick** |
| D | Nothing | — | the `TableAction` restatement and four test copies stay | — |

C wins. It keeps the part of the card that removes a restatement (the server's own copy of the
move and the tests' four copies). It drops the parts whose cost is protocol churn or test churn
for equal information. Under the deletion test:
- Delete `TableAction`'s three move kinds after C, and the complexity does not reappear anywhere.
  Each registration builds its `Move` once.
- Delete the three socket events and keep one, and the complexity does reappear. Each client
  control still has to say which kind it is, so the switch moves from the server registration into
  the client provider and GameTable.

## 4. Target design (C)

**Server.** The router and the handlers carry the engine's `Move` untouched from the socket
registration to `applyMove`.

```ts
// server/game/tableActions.ts
import type { Move } from "../../lib/game/gameEngine.ts";
export type TableAction =
  | (TableActionBase & { kind: "move"; move: Move })
  | (TableActionBase & { kind: "reaction"; emoji: string })
  | … // the other kinds are unchanged

// server/socket/socketGameplay.ts (SRV-2's shape); the literal stays at every site
onEvent(socket, "game:play", GamePlaySchema,
  atTable(({ cardIds }) => ({ kind: "move", move: { kind: "play", cardIds } })), GAME_ACTION_LIMIT);
onEvent(socket, "game:pass", NoPayloadSchema,
  atTable(() => ({ kind: "move", move: { kind: "pass" } })), GAME_ACTION_LIMIT);
onEvent(socket, "game:exchange_give_card", GameExchangeGiveCardSchema,
  atTable(({ cardId }) => ({ kind: "move", move: { kind: "giveback", cardId } })), { limit: 30, windowMs: 60_000 });

// server/game/tableHandlers.ts (tableMoves.ts after SRV-5)
case "move": return moveAction(io, game, action.userId, action.move);
```

**Tests.** One function in the test helpers maps a `Move` to its socket event, and it is the only
test-side place that does.

```ts
// tests/helpers/client.ts (TEST-7's typed module)
export function sendMove(socket: TypedClientSocket, move: Move): Promise<IntentReply>;
// soak: SeatAction = { kind: "move"; seat: number; move: Move }
```

**Invariants.**
- **Literal event names stay at each registration.** The L-047 scans,
  `protocolEvents.test.ts:56-63` and `WRAPPED_EVENT_COUNT = 18` are all unchanged.
- **SRV-2's handler contract holds.** `atTable(toDraft)` returns an `Outcome`, and only the draft
  body changes.
- **`move` is the only `TableAction` kind that carries a game move.** `moveAction` is its only
  consumer, and `TAKEOVER.move === "restore"` (it replaces three `"restore"` entries).
- **The protocol is unchanged.** `shared/protocol.ts` changes no token, so
  `tests/fixtures/protocolHashes.json` is untouched. `TableAction` is server-only and not reachable
  from `protocol.ts`, whose imports are `protocol.ts:4-9`.
- **Rate buckets and refusal codes are unchanged.** Each event keeps its own limit and its
  `intentId` dedupe. The silent codes (`NO_LIVE_GAME`, `NOT_YOUR_TURN`, `NO_EXCHANGE`,
  `NOT_YOUR_EXCHANGE`) stay silent.
- **The soak log is no longer read directly.** `SoakLogEntry` gets `{kind: "move", seat, move}`,
  and the inline log at `tests/integration/soakLogReplays.test.ts:31-54` is rewritten. Night logs
  printed before TEST-7 are read through a `moveOf(entry)` shim inside `replay.ts`, or regenerated
  (DM-3).

**Deleted.**
- `TableAction` kinds `play`, `pass` and `exchange`.
- ENG-6's per-kind `Extract<TableAction, …>` signatures and its kind→Move mapping.
- Two `takeoverMode`/`TAKEOVER` entries.
- The three-way emit branches in `soak.ts`, `replay.ts`, `gameDriver.ts` and `table.ts`.
- The restated union at `soak.ts:228-238`.

**Not changed, on purpose.**
- The three socket events and their schemas.
- The online provider's three `deliver` one-liners.
- The offline wrappers over ENG-6's `act`.
- GameTable's three props.

## 5. Migration (inside the host tickets, each green)

1. **ENG-6, pin first.** Write `tests/server/moveRouting.test.ts` against `recordingRuntime`
   (SRV-4). For each of `game:play`, `game:pass` and `game:exchange_give_card` it records the
   `Move` that reaches `applyMove`, plus the forwarded action's `takeoverMode`. Commit it green on
   ENG-6's own `moveAction`, before the `TableAction` change.
2. **ENG-6, the change.** `TableAction` gets `move`, the registrations build the `Move`, and the
   dispatch arms collapse to one. Edit the `kind: "play"`/`"pass"` literals in
   `tests/server/tableOwnership.test.ts:110,122` and `tests/integration/takeoverSerialised.test.ts:43-48`.
   The pin from step 1 stays green unchanged, and `protocolVersion.test.ts` is untouched.
3. **TEST-7.** Add `sendMove`, then migrate `soak.ts`, `replay.ts`, `gameDriver.ts` and
   `table.ts` to it. Migrate `soakLogReplays.test.ts` to the new entry shape in the same commit.
   Tests that probe one particular event keep their literal emit (`gameplay.test.ts:845-863`,
   `intentAcknowledged.test.ts`). They test the wire, not a move.

## 6. Owner decisions and amendments

**Owner decisions.**

| ID | Question | Recommended default |
|---|---|---|
| DM-1 | Collapse the three inbound move events into one `game:move`? | **No.** If yes, it rides WIRE-5, which already raises MIN, and never WIRE-1, which keeps MIN 6 and would strand old bundles. The wire rider then adds a `MoveSchema` with `satisfies z.ZodType<Move>`, the online `act(move)` and `sendMove`'s one-line body. It changes `WRAPPED_EVENT_COUNT` from 18 to 16 and the required list at `socketEvents.test.ts:243-249`. It merges the play, pass and giveback rate buckets at 60/min. WIRE-5's size goes from M to L. |
| DM-2 | During a two-revision deploy, a play, pass or giveback forwarded between an old and a new instance gets `UNKNOWN_ACTION` and is lost without a toast, until the turn timer acts. | **Accept.** The game is pre-launch, and D8 sets the precedent. The client's turn timer and auto-pass already cover a lost move. |
| DM-3 | Night soak logs printed before TEST-7 use the old entry shape. | **Regenerate, don't shim.** The logs are search output, and the one kept log is inline in `soakLogReplays.test.ts`, which TEST-7 rewrites. |

**Amendments to planned tickets.**

- **ENG-6** (stays M):
  - **Build, add:** "`TableAction` carries the engine's `Move` as `{kind: "move", move}`, replacing
    `play`/`pass`/`exchange`. Each socket registration builds its `Move` once. `TAKEOVER` has one
    `move: "restore"` entry."
  - **Where, add:** `server/game/tableActions.ts:27-29,85-95`;
    `server/socket/socketGameplay.ts:80-102,171-181`.
  - **Files, add:** `server/game/tableActions.ts`, `server/socket/socketGameplay.ts`,
    `tests/server/tableOwnership.test.ts`, `tests/integration/takeoverSerialised.test.ts`,
    `tests/server/moveRouting.test.ts` (new).
  - **DoD, add:**
    - "First: `moveRouting.test.ts` pins the `Move` each of the three events delivers, green
      before the `TableAction` change and unchanged after."
    - "Zero `kind: "play" | "pass" | "exchange"` in `TableAction`."
    - "`protocolHashes.json` unchanged."
  - **Checks, add:** `node --test tests/server/moveRouting.test.ts tests/server/tableOwnership.test.ts
    tests/server/socketEvents.test.ts tests/server/protocolEvents.test.ts`, plus integration
    `takeoverSerialised` and `crossInstance`.
  - **Edge:** ENG-6 is already after SRV-2 and SRV-4 (`blocked by ENG-5, SRV-4`; SRV-4 is after
    SRV-2), so SRV-2's `atTable` and `TAKEOVER` exist. No new edge.
- **TEST-7** (stays L):
  - **Build, add:** "`sendMove(socket, move: Move)` in `tests/helpers/client.ts` is the only
    test-side Move→event map. `soak.ts`, `replay.ts`, `gameDriver.ts` and `table.ts` use it.
    The soak's `SeatAction` is `{kind: "move", seat, move: Move}`."
  - **DoD, add:**
    - "Zero `"game:play"`, `"game:pass"` and `"game:exchange_give_card"` literals under
      `tests/helpers/` and `tests/soak/` outside `sendMove`."
    - "`soakLogReplays.test.ts` is green on the new entry shape."
  - **Constraints, add:** "Tests that probe a specific event keep their literal emit."
  - **Blocked by:** ENG-6 is already upstream (TIME-3 ← WIRE-5 ← … ← ENG-6). No new edge.
- **WIRE-1 (D3, glossary "Move"):** the CONTEXT.md entry adds one sentence. It says the socket
  carries a move as three intents, mapped one-to-one at `socketGameplay.ts`, and that collapsing
  them needs a MIN raise (DM-1). This stops a later audit proposing the collapse again without
  its cost.

## 7. Ticket rows

No MOVE ticket. The adopted part rides ENG-6 and TEST-7 as amendments (section 6). The rejected
part is owner decision DM-1.

| ID | title | area | size | ledger IDs | files/modules | blocked by | label | owner-eye? |
|---|---|---|---|---|---|---|---|---|

## 8. Spec cards

None. The amendment text for ENG-6 and TEST-7 in section 6 is written in their cards' own fields
(Build, Where, DoD, Checks, Constraints), so it can be pasted into the §4 cards as it stands.
