# 14 — The live table holds ledgers, not twenty writable fields (review card 3)

Prefix LEDG. Code pointers are at MAIN `a1d0ebb5` unless marked "after SRV-6".

## 1. Verdict: do part of it

- **Do:** type the twelve ledger-owned fields of `OnlineGameState` read-only (`readonly`, `ReadonlySet`,
  `ReadonlyMap`, `Readonly<Record>`). Each ledger writes through one view local to its own module, and
  the regex scans go. An alias or a destructure then fails to compile, which closes the decoy class
  that c8fb9e5e patched. This is one S ticket plus an amendment that makes SRV-6 smaller.
- **Don't:** nest the fields into `seats`/`match` ledger objects that pack and unpack themselves. That
  touches about 300 read sites in 32 files, and buys almost nothing. `tableState.ts:47-69`
  (`PERSISTED_FIELDS`) already fails to compile when a field is not mapped to the envelope.
- **Evidence:** no stray write has ever been found. c8fb9e5e's only hit was a fresh local that happened
  to be named `playerMap`. The value is in deleting code: the ~100-line seat scan at
  `seatLedger.test.ts:129-230`, the scan SRV-6 plans for match fields, and the shared
  `tests/helpers/fieldWrites.ts`. The guarantee also widens to writes made through a parameter, which
  the scan never saw.
- **Out of scope:** the other eight fields (`gameState`, `roundFlags`, `moveLog`, `turnDeadlineMs`,
  `dealFirstSeat`, `spectators`, `lastRoundOverPayload`, `resultWrites`). No recorded rule gives any
  of them a single writer.

## 2. The after-plan shape that hurts

- `server/game/gameRoom.ts:8-144`: `OnlineGameState` declares every field mutable. The six seat fields
  are at `:13,52,76,89,101,110`. The six match fields are `rematchVotes :18`, `cumulativeScores :20`,
  `matchTarget :23`, `roundsPlayed :26`, `matchOver :27` and `endedByVote :33`.
- `server/game/seatLedger.ts:4-8` claims to be the only writer of the seat fields. Only a source scan
  enforces that (`tests/server/seatLedger.test.ts:129-230`), which has four parts:
  - a write regex;
  - `aliasesIn`/`writesThrough`, added by c8fb9e5e after `const { weakSeats } = game; weakSeats.add(…)`
    passed;
  - two self-tests;
  - a walk over `server/`, `lib/` and `shared/`.
- **Holes the scan still has today.** Each of these compiles and passes the scan:
  - a field passed to a function that mutates it (`markAll(game.weakSeats)`);
  - `Object.assign(game, …)`;
  - `game["weakSeats"]`;
  - a `let` alias that is reassigned before the write.
- **SRV-6 (#1696), as planned,** adds `server/game/matchLedger.ts` as the only writer of the six match
  fields. Those fields are written today at `roundOver.ts:90-95,259,318,326-329`,
  `tableHandlers.ts:360,413,540,561`, `gameTurn.ts:325` and `seatLedger.ts:60-62`. It extracts the
  scanner into `tests/helpers/fieldWrites.ts` "shared by both ledger scans" and requires that "each
  scan has a 'recognises every kind of write' self-test" (INTEGRATED §4 SRV-6). After SRV-6,
  therefore, two regex scans with alias logic guard twelve fields that a type could guard.
- SRV-3, SRV-4 and SRV-5 do not touch these field types. SRV-5 moves the vote writes into
  `tableVotes.ts`, and SRV-6 then routes them through `matchLedger`.
- ENG-1 and ENG-4 change what is stored in the match block (`matchOver` persisted; `foldRound`), but
  not who writes the live field.

## 3. Alternatives

| | A. Ledger objects (`game.seats`, `game.match`) with private fields, getters and their own pack/unpack | B. Read-only field types; each ledger writes through a mutable view local to its module (picked) | C. Keep the scans (plan as is) |
|---|---|---|---|
| Single writer | sound at runtime for scalars (getter-only); collections can still be broken by an explicit cast | a compile error for every direct, aliased or destructured write, and for passing a collection to a `Set`/`Map` parameter; the residual holes are listed under B's invariants | regex; has the 4 holes in §2 |
| Read sites changed | about 130 in `server/` and 170 in `tests/` (`game.matchOver` becomes `game.match.over`) | none; only function parameters that take these fields become `Readonly*` (`onlineGameLogic.ts:258,307,321`) | none |
| Envelope | moves pack/unpack into the ledgers; `PERSISTED_FIELDS` already gives that check | unchanged (`tableState.ts`) | unchanged |
| Deletes | both scans and `fieldWrites.ts` | both scans and `fieldWrites.ts` | nothing; SRV-6 adds the helper |
| Cost | L, churn over files SRV-4, SRV-5 and TIME-3 also rewrite | S, plus a smaller SRV-6 | 0 now, plus scan upkeep |
| Card warning | invites a "match record" shape; engine design 01 §3.3 rejected sharing one with offline | stays server-only and flat; no shared record | — |

**Pick: B.** It deletes the same scans as A at a tenth of the churn. A's one extra property, runtime
soundness for scalars, guards against something nobody has written. B's residual holes (an explicit
cast, a readonly-to-mutable parameter, `Object.assign`) each take a deliberate act that a reviewer
can see. The scan has the same holes plus the accidental ones.

## 4. Target design

**Module shape.**
- `OnlineGameState` stays one flat interface, but the twelve ledger fields become read-only views:
  ```ts
  // server/game/gameRoom.ts
  readonly playerMap: Readonly<Record<number, string>>;
  readonly vacatedSeats: ReadonlyMap<number, { userId: string; username: string }>;
  readonly releasedSeats: ReadonlySet<string>;
  readonly abandonedSeats: ReadonlyMap<number, string>;
  readonly weakSeats: ReadonlySet<number>;
  readonly endMatchVotes: ReadonlySet<string>;
  // SRV-6 (amended):
  readonly rematchVotes: ReadonlySet<string>;
  readonly cumulativeScores: Readonly<Record<string, number>>;
  readonly matchTarget: number;
  readonly roundsPlayed: number;
  readonly matchOver: boolean;
  readonly endedByVote?: boolean;
  ```
- Each ledger declares its own mutable shape and the single cast into it, and exports neither:
  ```ts
  // server/game/seatLedger.ts
  interface SeatFields {
    playerMap: Record<number, string>;
    vacatedSeats: Map<number, { userId: string; username: string }>;
    releasedSeats: Set<string>;
    abandonedSeats: Map<number, string>;
    weakSeats: Set<number>;
    endMatchVotes: Set<string>;
  }
  function seats(game: OnlineGameState): SeatFields {
    return game as unknown as SeatFields;
  }
  // vacate/reclaim/clearForDeal/castEndMatchVote write through seats(game); signatures unchanged.
  ```
  `matchLedger.ts` (SRV-6) has the same `MatchFields` + `match(game)` pair.
- `newTable`, `fromEnvelope` and `tests/helpers/onlineTable.ts` construct the object, so they need no
  view. Readers are unchanged.

**Invariants.**
- **I1.** A write to a ledger field outside its ledger fails `npx tsc --noEmit`. This covers a direct
  write, a destructured or aliased local, and a collection passed to a mutable `Set`/`Map` parameter.
- **I2.** The type pin holds. `tests/server/ledgerFields.types.test.ts` carries one
  `// @ts-expect-error` line per field and per write kind (direct, destructured, aliased, collection
  method). If someone removes a `readonly`, tsc reports an unused directive. This is the check's floor
  (CLAUDE.md "no self-defeating safeguards").
- **I3.** Only the ledger module contains the cast to `SeatFields` (or `MatchFields`). Both types are
  unexported, so another module would have to declare its own. That would be visible in review; it
  cannot happen by accident.
- **Known residual.** TypeScript lets a `readonly` property or a `Readonly<Record>` be assigned to a
  mutable type. Passing `game.playerMap` or `game.cumulativeScores` to a parameter typed
  `Record<…>` that mutates it still compiles. To shrink that hole, every parameter that receives
  these fields is retyped `Readonly<…>`. The scan does not catch this case today either.

**Deleted.**
- The scan block `tests/server/seatLedger.test.ts:129-230`: `WRITE`, `aliasesIn`, `writesThrough`,
  `writesOf`, `writesIn`, `sourceFiles` and their four tests, about 100 lines.
- From SRV-6's plan: `tests/helpers/fieldWrites.ts` and the match-field scan.

## 5. Migration (each step green)

1. **LEDG-1** (needs nothing; seatLedger is on main):
   - Add the type-pin file first, with its `@ts-expect-error` lines. tsc goes red with unused
     directives, which is the red-first commit.
   - Then make the six seat fields read-only and route `seatLedger.ts` through `seats(game)`. Change
     `onlineGameLogic.ts:258,307,321` to take `ReadonlyMap`.
   - Fix the five test writes:
     - `tests/helpers/liveGame.ts:72` calls `clearForDeal`, as `dealRound` does.
     - `seatLedger.test.ts:46,79` call `castEndMatchVote`.
     - `tests/integration/reconnect.test.ts:354,359` plants a fault. It keeps its explicit
       `as unknown as` cast, now on the table object.
   - Delete the scan block. tsc and the seat-ledger behaviour tests go green.
2. **SRV-6 (amended)** does the same for the six match fields. `matchLedger.ts` writes through
   `match(game)`, and the type pin grows six lines. There is no `fieldWrites.ts` and no match scan.

## 6. Owner decisions and amendments

**Owner decisions.** None. No game rule or behaviour changes.

**Amendment to SRV-6 (#1696):**
- **Build:**
  - Strike "`tests/helpers/fieldWrites.ts`, shared by both ledger scans".
  - Add "the six match fields are `readonly` in `OnlineGameState` (LEDG-1's pattern), and
    `matchLedger.ts` writes them through its module-local `MatchFields` view."
- **DoD:**
  - "Each scan has a 'recognises every kind of write' self-test" now applies only to the
    `tableOwnership` scan.
  - Add "`tests/server/ledgerFields.types.test.ts` pins the six match fields."
  - Add "`seatLedger.reclaim`'s score carry goes through `carrySeatScore`; `cumulativeScores` is
    written nowhere else."
- **Blocked by:** add LEDG-1.
- **Files:** drop `tests/helpers/fieldWrites.ts`; add `server/game/gameRoom.ts`.
- **Effect:** SRV-6 gets smaller. It loses one scan, its self-test and the helper.

**Note to LINT-3 (no scope change):** the seat scan's private `sourceFiles` walker is deleted by
LEDG-1, so it is one fewer walker to convert to `trackedFiles`.

## 7. Ticket rows

| ID | title | area | size | ledger IDs | files/modules | blocked by | label | owner-eye? |
|---|---|---|---|---|---|---|---|---|
| LEDG-1 | Seat fields are read-only outside seatLedger; the seat scan becomes a type | server | S | review C3 | server/game/{gameRoom,seatLedger,onlineGameLogic}.ts, tests/server/{seatLedger,ledgerFields.types}.test.ts, tests/helpers/liveGame.ts, tests/integration/reconnect.test.ts | — | ready-for-agent | no |

## 8. Spec cards

### LEDG-1: Seat fields are read-only outside seatLedger; the seat scan becomes a type (S)
- **Defect:** `OnlineGameState`'s six seat fields are mutable everywhere, and only a regex scan holds
  `seatLedger` as their single writer. That scan needed an alias fix (c8fb9e5e) and still misses a
  field passed to a mutating function, `Object.assign` and bracket access.
- **Where:**
  - `server/game/gameRoom.ts:13,52,76,89,101,110`;
  - `server/game/seatLedger.ts:4-8,26-40,57-65,77-84`;
  - `tests/server/seatLedger.test.ts:129-230`;
  - `server/game/onlineGameLogic.ts:258,307,321`.
- **Build:**
  - Type `playerMap`, `vacatedSeats`, `releasedSeats`, `abandonedSeats`, `weakSeats` and
    `endMatchVotes` `readonly`, as `Readonly<Record>`/`ReadonlyMap`/`ReadonlySet`.
  - `seatLedger.ts` declares an unexported `SeatFields` and one `seats(game)` cast, and writes only
    through it. Its exported signatures are unchanged.
  - Parameters that receive these fields take `Readonly*` types.
  - Add `tests/server/ledgerFields.types.test.ts`: one `@ts-expect-error` per seat field for each
    write kind (direct, destructured, aliased, collection method).
  - Delete the scan block.
- **Constraints:**
  - No behaviour change: the seat-ledger behaviour tests stay unchanged in substance.
  - Readers keep `game.<field>`. Do not nest the fields or add ledger objects (card 3: no shared
    match record; engine design 01 §3.3).
  - The `seats` cast appears in `seatLedger.ts` only.
- **DoD:**
  - [ ] Red first: the type-pin file lands with tsc failing on unused `@ts-expect-error` directives.
  - [ ] `npx tsc --noEmit` is green with the six fields read-only.
  - [ ] `aliasesIn`, `writesThrough`, `WRITE` and `sourceFiles` have zero references under `tests/`.
  - [ ] `as unknown as SeatFields` occurs once, in `server/game/seatLedger.ts`.
  - [ ] `tests/helpers/liveGame.ts` clears the seat state through `clearForDeal`.
- **Checks:** `node --test tests/server/seatLedger.test.ts tests/server/seatReclaim.test.ts
  tests/server/tableState.test.ts` plus `npx tsc --noEmit`. Gate, plus integration `reconnect`.
- **Not this ticket:**
  - the match fields (SRV-6, amended);
  - the eight fields with no single-writer rule;
  - `activeGames` ownership (`tableOwnership` scan, SRV-6).
- **Source:** architecture review 2026-10-16 card 3; this design §4; c8fb9e5e.
