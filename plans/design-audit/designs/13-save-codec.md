# 13 — A stored shape cannot change without its version (review card 2)

Candidate: review card 2, "One codec and one shape version for a stored GameState". ID prefix SAVE.
Code at MAIN `a1d0ebb5` (`scratchpad/main2`); history read from the repo at `d8c34919`.

## 1. Verdict: do part of it

- **Do:** pin a hash of each stored document's TypeScript shape to its version integer, the way
  `protocolVersion.test.ts` pins `shared/protocol.ts` to `PROTOCOL_VERSION`. Then a shape change that
  is not bumped turns red. The bug is real and recent: **PR #1614 (merge `1bf1c0c5`) renamed the stored
  `GameState.roundWinner` to `trickWinner` with both versions left at 2, and PR #1616 (`8c2f4e9c`)
  renamed stored fields (`gameOver`, `rankings`, `"ai"`, `handsPlayed`) with `GAME_SCHEMA_VERSION`
  still 2.** The bump arrived one PR later, in #1617 (`cc183aab`). Both were green at merge.
- **Do not:** replace the integers with a runtime fingerprint, or merge the envelope and the offline
  save into one codec. The integer is ordered, and the server uses that order: it leaves a row written
  by a newer revision alone (`tableHandlers.ts:146-149`). The only shared piece, `parseGameState`, is
  already WIRE-3's. A codec over both would forward and nothing more (it fails the deletion test).
- **Cost:** one M ticket (SAVE-1) with no planned blocker. It lands before ENG-1, so all six planned
  stored-shape bumps (ENG-1, ENG-5, WIRE-1, WIRE-3, WIRE-4, WIRE-5) are checked rather than remembered.
  It also builds the type expander WIRE-1 needs, so WIRE-1 shrinks.
- **What it does not give:** bumps stay manual (one constant plus one hash line). They are now
  *enforced*, not free. A rule change that leaves the shape alone, such as a different hand size,
  still needs a person to decide on the bump. Nothing here can see that change.

## 2. The after-plan shape that hurts

**Two integers guard every stored blob, and nothing checks them against the shape.**
- `shared/persistedEnvelope.ts:80-87`: `GAME_SCHEMA_VERSION = 3`. Its doc says a row from an older
  shape "deals a silently corrupt game instead of crashing". `:213-221` refuses any other version,
  and marks a higher one `newer`.
- `lib/offlineSave.ts:14-21`: `OFFLINE_SAVE_VERSION = 3`. Its doc at `:55-56` says "The version is
  what actually protects against a shape change". `decodeOfflineSave` is shallow on purpose (`:62-83`).
- `tests/server/protocolVersion.test.ts:13-21,41-47` hashes only `shared/protocol.ts`'s tokens.
  Nothing hashes `GameState` (`lib/game/gameEngine.ts:85-114`), `MatchState`
  (`lib/game/matchState.ts:36-40`), `PersistedMatch` (`persistedEnvelope.ts:97-129`) or
  `PersistedSeats` (`:30-35`). All four are stored.
- `tests/engine/offlineSave.test.ts:80-86` checks only that the golden fixture's `version` field
  equals the constant. It cannot tell whether the shape moved. `tests/fixtures/offlineSave.v2.json`
  is referenced nowhere, and was rewritten to the new shape in place twice (`6a3dc9b4`, `64207d9c`,
  `9144ea4a`). So the "golden of an old version" it was meant to be is gone.

**History: the failure has already happened twice.** At `1bf1c0c5`, `gameEngine.ts` carries
`trickWinner`, and both constants are 2, the value the previous shape (`roundWinner`) was stored
under. At `8c2f4e9c`, the offline save is 3 but `GAME_SCHEMA_VERSION` is 2, while
`persistedMatchSchema` renamed `handsPlayed` → `roundsPlayed` (a v2 row reads back
`.catch(0)`, i.e. a silent 0) and `GameState.gameOver`/`rankings` became `roundOver`/`finishingOrder`.
No harm was done only because nothing is live.

**The plan adds six more bumps, each by hand.**
- INTEGRATED R1 table (`INTEGRATED.md:114-117`): "schema +1, offline +1" on WIRE-1, WIRE-3, WIRE-4,
  and WIRE-5. R1 records that WIRE-5's design left the offline bump out.
- ENG-1 bumps the schema (`INTEGRATED.md:379`), and ENG-5 the offline save (`:477`).
- `designs/01-engine.md:704-705` settles collisions as "whoever lands second bumps again". That is a
  rule that holds only if every author remembers it.
- WIRE-1 closes the same gap for the *wire*: the hash expands to the wire types, with a counterfactual
  (`INTEGRATED.md:564`, `02-lastmove.md:296`). The stored documents get no such check. `OfflineSave`
  and the envelope's own blocks are not wire types, so WIRE-1's expansion does not cover them.
- TEST-8 (`INTEGRATED.md:1472-1478`) already makes e2e saves take their version from
  `encodeOfflineSave`. WIRE-3 already gives both restore seams one `parseGameState`. **The "one
  codec" half of the card is therefore already planned.** The missing half is the version.

## 3. Alternatives

| | Shape | For | Against |
|---|---|---|---|
| A | Status quo: R1 plus review vigilance | free | the failure happened twice on 2026-10-15; R1 already found one omission in a design |
| **B (pick)** | **Pin `hash(expanded stored type)` per version, as the protocol is pinned; the integers stay** | **red on the exact class; keeps `newer` ordering; derives the fact from the writer's type (memory: a premise in prose decays); lands before every planned bump; WIRE-1 reuses the expander** | bumps stay manual; a semantic change with no shape change is not seen |
| C | The card's proposal: a fingerprint of WIRE-3's zod `gameStateSchema` stored in each blob instead of an integer | no bump at all for shape changes | loses the order `newer` relies on (`tableHandlers.ts:146`, `tableRouter.ts:209`); can only land after WIRE-3 (wave 19), when WIRE-1's and WIRE-3's bumps are already done; a `.passthrough()` schema misses any field it does not declare, so its fingerprint is blind exactly where the type moved; still needs a manual salt for semantic changes; ships a zod walker in the app |
| D | One `storedGame` codec module serving the envelope, the offline save and the e2e builder | one place to read | the two share only `parseGameState` (WIRE-3) and a three-line version compare. Their refusals differ (`newer`/`unrestorable` vs `none`/`incompatible`), and so do their own fields and storage. One module forwarding to two adapters is depth zero |

## 4. Target design

**Module shape.**
- `tests/helpers/typeShape.ts` is a test-only module. It gives one deep function: a canonical,
  structural string for a named TypeScript type, plus its sha256. It walks through the
  `TypeChecker`, so aliases, `z.infer`, `Omit` and generics resolve to the shape a writer actually
  produces.
- `tests/server/storedShapeVersions.test.ts` pins two stored documents to their integers:
  - `activeGames`: `PersistedEnvelope<GameState>`, the return type of `toEnvelope`
    (`server/game/tableState.ts:169`), keyed by `GAME_SCHEMA_VERSION`.
  - `offlineSave`: `OfflineSave` (`lib/offlineSave.ts:25-34`), keyed by `OFFLINE_SAVE_VERSION`.
- `tests/fixtures/storedShapes.json` records `{ activeGames: { "<v>": "<sha>" }, offlineSave: { "<v>": "<sha>" } }`.

**Interface sketch.**
```ts
// tests/helpers/typeShape.ts
export function typeShape(program: ts.Program, file: string, typeText: string): string; // canonical text
export function shapeHash(program: ts.Program, file: string, typeText: string): string; // sha256 of it
export function programFor(roots: string[], override?: { file: string; text: string }): ts.Program;
```
- **Canonical form.** Object types become property names, sorted, each with `?` when optional and
  its member shape. Index signatures, arrays, tuples, unions (members sorted), literals and primitives
  appear as such. A recursive reference is printed as a back-reference, so a cycle ends.
- **What is not shape.** Comments, property order, alias names and import paths.
- **Not JSON.** A function member, `Map`, `Set`, `Date` or class instance throws "not JSON". A stored
  document is `JSON.stringify`'d (`offlineSave.ts:37`, a jsonb column), so a `Set` there would come
  back as `{}`.
- `programFor` uses the in-memory host pattern `tests/server/protocolEvents.test.ts:134-138` already
  uses.

**Invariants (each held by the test).**
1. `storedShapes.json.activeGames[GAME_SCHEMA_VERSION] === shapeHash(PersistedEnvelope<GameState>)`, and
   the same for `offlineSave` with `OFFLINE_SAVE_VERSION`. The failure message says: bump the constant,
   record the hash under the new version, and rewrite the golden save through `encodeOfflineSave`.
2. No recorded version is above the constant.
3. Counterfactuals, through `programFor`'s override:
   - an extra `GameState` field moves both hashes;
   - a renamed `persistedMatchSchema` key moves only `activeGames`;
   - an extra `MatchState` field moves only `offlineSave`;
   - a comment and a property reorder move neither.

   These counterfactuals are the floor: an expander that returns a constant fails them.
4. A version may be bumped with the shape unchanged (the same hash recorded under the new number).
   This is the path for a semantic change, which the constant's doc already names.

**What is deleted.**
- `tests/fixtures/offlineSave.v2.json` (unreferenced).
- The per-version golden naming. `offlineSave.v3.json` becomes `tests/fixtures/offlineSave.json`,
  rewritten at each bump; `offlineSave.test.ts:80-86` already requires its `version` to equal the
  constant. R1's "one new fixture per bump" becomes "the golden regenerated", and git holds the old
  ones.
- WIRE-1 no longer writes its own type walker (amendment A1).
- `01-engine.md` §9's "whoever lands second bumps again" stops being a convention: the second to land
  is red until they do.

**Unchanged.**
- Both integers and the `newer`/older refusal.
- `decodeOfflineSave`'s shallowness until WIRE-3, and `parseGameState` (WIRE-3).
- TEST-8's builder.

## 5. Migration (each step green)

1. **SAVE-1, commit 1 (red proof, recorded in the PR, not committed red).** Write `typeShape.ts` and
   the pin. Record hashes at `1bf1c0c5^1` (both at v2, `roundWinner` shape). Run the pin at
   `1bf1c0c5` (#1614): both documents are red. Run it at `8c2f4e9c` (#1616): `activeGames` is red,
   `offlineSave` is green at v3. Paste the outputs.
2. **SAVE-1, commit 2.** Add the test and the fixture at MAIN's versions (3/3), with the
   counterfactuals. Green on main: the hash equals the recorded value and the counterfactuals hold.
3. **SAVE-1, commit 3.** Rename the golden to `offlineSave.json`, delete `v2`, and add one pointer
   line to each constant's doc: "`tests/server/storedShapeVersions.test.ts` holds that." This mirrors
   `shared/protocol.ts:2`.
4. **Downstream, free.** ENG-1, ENG-5, WIRE-1, WIRE-3, WIRE-4 and WIRE-5 each go red on their shape
   change until they bump. Each adds one hash line.

## 6. Owner decisions and amendments

**Owner decisions (defaults recommended; none is a rule change).**
- **OD-SAVE-1. A read-tolerant additive field still forces a bump.** `playedRanks?` was added
  without one (`gameEngine.ts:109-113`), as was the seats block (`persistedEnvelope.test.ts:79-82`),
  to keep live tables alive.
  - *Default: always bump while Murlan is not live* (memory: not live). At launch, revisit with an
    explicit per-version list of compatible hashes, each backed by a red-first restore test of the old
    shape.
- **OD-SAVE-2. The fixture can be overwritten instead of bumped.** That is the same exposure the
  protocol pin has had since v1. The test cannot see history.
  - *Default: accept, at parity with the protocol pin.* A changed recorded hash is a one-line diff the
    review reads. A history check against the merge base is not worth a CI dependency on fetch depth.

**Amendments to planned tickets.**
- **A1 — WIRE-1 (#1695).**
  - "The hash covers the expanded wire types" is built on `tests/helpers/typeShape.ts` (SAVE-1); it
    adds a third pinned document (the exported wire types) beside SAVE-1's two.
  - Its counterfactual stays.
  - Blocked by: add SAVE-1.
- **A2 — ENG-1 (#1679), ENG-5 (#1683).**
  - Blocked by: add SAVE-1.
  - DoD "the schema/offline version is bumped" reads "bumped, with `storedShapes.json` recording the
    new version's hash".
  - ENG-5's fixture line reads "rewrite `tests/fixtures/offlineSave.json` through TEST-8's builder".
- **A3 — WIRE-3 (#1714), WIRE-4 (#1718), WIRE-5 (#1719).**
  - Same DoD wording as A2. No edge to add: they already follow WIRE-1, which follows SAVE-1.
  - WIRE-5's omitted offline bump can no longer be omitted.
- **A4 — INTEGRATED R1.** The "Persisted versions" column is unchanged in count. Add one line: "Each
  persisted bump is enforced by `storedShapeVersions.test.ts` (SAVE-1); TEST-8 plus SAVE-1 make each
  one constant, one hash line and one regenerated golden."

## 7. Ticket rows

| ID | title | area | size | ledger IDs | files/modules | blocked by | label | owner-eye? |
|---|---|---|---|---|---|---|---|---|
| SAVE-1 | A stored shape cannot change without its version | wire | M | review C2 | tests/helpers/typeShape.ts (new), tests/server/storedShapeVersions.test.ts (new), tests/fixtures/storedShapes.json (new), tests/fixtures/offlineSave.json (renamed from offlineSave.v3.json), tests/fixtures/offlineSave.v2.json (deleted), tests/engine/offlineSave.test.ts, shared/persistedEnvelope.ts, lib/offlineSave.ts | — | ready-for-agent | no |

## 8. Spec cards

### SAVE-1: A stored shape cannot change without its version (M)
- **Defect:** `GAME_SCHEMA_VERSION` and `OFFLINE_SAVE_VERSION` are the only guards against
  restoring a blob into a changed shape, and nothing ties them to the shape. PR #1614 (`1bf1c0c5`)
  shipped a renamed stored `GameState` field at both old versions. PR #1616 (`8c2f4e9c`) shipped
  renamed envelope and `GameState` fields with `GAME_SCHEMA_VERSION` unchanged. Both were green at
  merge.
- **Where:**
  - `shared/persistedEnvelope.ts:80-87,213-221`; `lib/offlineSave.ts:14-21,55-56,72`.
  - `tests/server/protocolVersion.test.ts:13-47` (the pin to mirror).
  - `tests/server/protocolEvents.test.ts:134-138` (the in-memory host pattern).
  - `tests/engine/offlineSave.test.ts:80-86`; `tests/fixtures/offlineSave.v2.json` (unreferenced).
- **Build:**
  - `tests/helpers/typeShape.ts`: `programFor(roots, override?)`, `typeShape` and `shapeHash`. It is a
    structural walk through the `TypeChecker`:
    - property names sorted, with optionality;
    - index signatures, arrays, tuples, sorted unions, literals and primitives;
    - a cycle printed as a back-reference;
    - it throws "not JSON" on a function, `Map`, `Set`, `Date` or class instance.
  - `tests/server/storedShapeVersions.test.ts` pins two documents:
    - `PersistedEnvelope<GameState>` (`toEnvelope`'s return type) under `GAME_SCHEMA_VERSION`;
    - `OfflineSave` under `OFFLINE_SAVE_VERSION`.
  - `tests/fixtures/storedShapes.json` records both, at MAIN's 3 and 3.
  - Rename `offlineSave.v3.json` to `offlineSave.json` and point `offlineSave.test.ts` at it. Delete
    `offlineSave.v2.json`.
  - Add one pointer line to each constant's doc comment, naming the test that holds it.
- **Constraints:**
  - Both integers and the `newer` refusal stay exactly as they are.
  - No runtime code changes.
  - The walker is test-only and is not imported by `lib/`, `shared/`, `server/` or `app/`.
  - No comment beyond the two pointers (CLAUDE.md § Comments).
  - The test file finishes under the 30 s per-test deadline: reuse one base program for the
    counterfactuals.
- **DoD:**
  - [ ] Red proof in the PR, against history:
    - with hashes recorded at `1bf1c0c5^1`, the pin is red at `1bf1c0c5` (#1614) for both documents;
    - at `8c2f4e9c` (#1616) it is red for `activeGames` and green for `offlineSave`.
  - [ ] Counterfactuals, through `programFor`'s override:
    - an extra `GameState` field moves both hashes;
    - a renamed `persistedMatchSchema` key moves only `activeGames`;
    - an extra `MatchState` field moves only `offlineSave`;
    - a comment and a property reorder move neither.
  - [ ] A counterfactual `Set<string>` member makes `typeShape` throw "not JSON".
  - [ ] The failure message names the constant to bump, the fixture key to add, and the golden to
    regenerate through `encodeOfflineSave`.
  - [ ] No recorded version is above its constant (asserted).
  - [ ] `rg "offlineSave.v[0-9]"` finds nothing.
- **Checks:** `node --test tests/server/storedShapeVersions.test.ts tests/engine/offlineSave.test.ts
  tests/server/persistedEnvelope.test.ts tests/server/protocolVersion.test.ts`; `npx tsc --noEmit`.
  Gate.
- **Not this ticket:**
  - parsing a stored `GameState` (WIRE-3);
  - the wire's expanded hash (WIRE-1, which builds on this walker);
  - e2e saves (TEST-8);
  - deciding a bump for a rule change that keeps the shape;
  - compatible-hash lists (OD-SAVE-1, at launch).
- **Source:** architecture review 2026-10-16 card 2; INTEGRATED R1; 01-engine §9; 02-lastmove §4.4;
  design 13 (this file).
