# 17 — A refusal is worded once, from the engine's code (review card 6)

Code read at origin/main a1d0ebb5 (`scratchpad/main2`). Plan state: INTEGRATED.md with ENG-2 (#1662),
ENG-6 (#1687), SRV-2 (#1672), SRV-5 (#1693), UI-4 (#1690), LINT-2 (#1699) and CLI-8 (#1721) landed.

## 1. Verdict: do part of it

- **Do:** the server stops wording a refused play. Every selection refusal leaves on the existing
  `INVALID_MOVE` code with the engine's code as a param. The online client renders it through the
  same total table GIOCA reads (`PLAY_SPOKEN_KEYS`). This deletes the lossy 5-to-1 map, the
  `{ rank }` param and 6 locale strings (`server.INVALID_COMBINATION` and `server.MUST_PLAY_START_CARD`
  in en/it/sq).
- **It fixes a shipped wrong sentence.** `server.MUST_PLAY_START_CARD` hard-codes ♠ in all three
  locales (`locales/en.ts:77`, `it.ts:70`, `sq.ts:86`). At 2 players the round opens on the lowest
  dealt card of any suit about half the time (`docs/GAME-RULES.md:59,172`; `gameEngine.ts:341-352`),
  so the float can say "the 4♠" about the 4♥.
- **Don't:** fold the tutorial's sentences into the game's. `TUTORIAL_REFUSAL_KEYS` is a deliberate,
  partial override (for example, "isn't strong enough: you need a higher card" against "card too
  low"). After ENG-2 it is keyed on the engine's code, so it is no longer a parallel map. Merging it
  would change visible tutorial text to save 12 strings.
- **Cost:** one S ticket, owner-eye because the rare server float's wording changes. The server float
  is reachable only when client and server state disagree, since GIOCA never sends a play its own
  `readStagedPlay` refuses (`selectionLeaves.tsx:104-110`). That is the "Speculative" in the card,
  and the reason this stays at one S rather than the card's full shape.

## 2. The after-plan shape that hurts

After the plan lands:

| Wording of one refusal | Where (MAIN) | After plan |
|---|---|---|
| GIOCA reject float and screen reader | `components/table/spokenLabels.ts:25-34` (`PLAY_SPOKEN_KEYS`), `:129-149` (`playRefusalLabel`); used at `selectionLeaves.tsx:92,104` | ENG-2 keys it on the engine's `SelectionRefusal` (planned). UI-4 edits the file. |
| Server float for a refused play | `server/game/tableHandlers.ts:185-195` (`PLAY_REFUSAL_CODES`), `:220-224` (rank-only param); `server/socket/payload.ts:13-15`; `context/OnlineGameContext.tsx:589-591` → `lib/i18n.ts:163-167` | ENG-6 turns it into `MOVE_REFUSAL_CODES satisfies Record<MoveRefusal, …>` and **keeps** the `{ rank }` param (01-engine §4.1). SRV-2 routes it through `refuse`. SRV-5 moves it to `server/game/tableMoves.ts`. The five beat codes still collapse to `INVALID_MOVE`. |
| Tutorial line | `components/tutorialRefusal.ts:7-14`; `app/tutorial.tsx:392-400,643` | ENG-2 retypes the key. CLI-8 moves the caller to `lib/tutorial/beats.ts` and adds `needsStartCard`. It stays an override. |

The planned work makes the engine code reach GIOCA and the tutorial, but nothing carries it over the
wire. Two concrete defects survive the whole plan:

1. **Lossy:** `royalUnbeatable`, `bombOnly`, `wrongType`, `wrongLength` and `tooLow` all read
   "Invalid move" (`tableHandlers.ts:190-194`), while the same refusal on GIOCA reads "card too
   low", "only a higher bomb can beat this" and so on (`locales/en.ts:390-398`).
2. **Wrong:** the server's start-card sentence names only the rank and appends ♠, which is wrong on
   every 2-player fallback opening. The GIOCA sentence (`gameTable.playA11ySpokenStartCard`, `{{card}}`)
   names the real card.

The i18n check cannot see either one. `tests/ui-rules/i18n.test.ts:636-680` (deleted by LINT-2 in
favour of `payload()` typing) checks that a code has *a* key, not that two channels agree.

## 3. Alternatives

- **A. The card's full shape.** Every `MoveRefusal` crosses the wire as an engine code. One client
  table serves GIOCA, the float and the tutorial, and the tutorial keeps only overrides. Rejected in
  part: the tutorial overrides already key on the engine code after ENG-2/CLI-8, so "a third map" is
  gone. Merging the sentences would be a visible tutorial rewrite (12 strings, 3 locales) for no
  defect. Non-selection codes (`INVALID_CARD`, `EXCHANGE_PENDING`, `CANNOT_PASS`) have no client
  twin to agree with.
- **B. Patch the sentence.** Add `{{suit}}` to `server.MUST_PLAY_START_CARD` in three locales and send
  the suit. This fixes defect 2, keeps defect 1, deletes nothing and adds a param. It costs the same
  session as C.
- **C. Selection refusals carry the engine code, and the client words them (pick).** Fixes both
  defects, deletes the map and 6 strings, and leaves the tutorial and non-selection codes alone.
- **D. Nothing.** Defensible on reachability alone, but it leaves a wrong sentence in three locales
  when C costs one S.

## 4. Target design

**Module shape.** No new module. The wording of a selection refusal has one owner:
`components/table/spokenLabels.ts`, the existing translation boundary. It gains one small exported
function that turns a server payload into the float's text. The server stops choosing words for
selection refusals.

```ts
// server/game/tableMoves.ts (SRV-5's file), inside ENG-6's MOVE_REFUSAL_CODES
notACombination | needsStartCard | royalUnbeatable | bombOnly | wrongType | wrongLength | tooLow
  → { code: "INVALID_MOVE", toast: true }        // params: { refusal: <SelectionRefusal> }
notHeld → INVALID_CARD, exchangeOpen → EXCHANGE_PENDING, mustLead → CANNOT_PASS  // unchanged

// components/table/spokenLabels.ts
/** The float's text for a `game:error`: a refused selection in GIOCA's words, anything else as before. */
export function gameErrorText(
  payload: ServerPayload,
  startCard: GameState["startCard"],
  t: TFn
): string;
// payload.code === "INVALID_MOVE" && params.refusal is a key of PLAY_SPOKEN_KEYS (not "play")
//   → playRefusalLabel({ refusal, isMyTurn: true, isFinished: false, startCard }, t)
// otherwise → translateServerPayload(payload)

// context/OnlineGameContext.tsx onGameError
setError({ text: gameErrorText(payload, gameStateRef.current?.startCard, t), seq: … });
```

**Invariants.**
- A selection refusal has one sentence per locale. GIOCA's reject float, the screen reader and the
  server float all read `PLAY_SPOKEN_KEYS[code]`. That table is a total `Record`, so a new engine
  code cannot ship unworded (tsc).
- The wire carries the engine's code, never a server rewording of it. The guard is the
  `PLAY_SPOKEN_KEYS` table itself (`Object.hasOwn`). An unknown code, from a newer server, falls back
  to `server.INVALID_MOVE`, so nobody sees a blank.
- The start card is the client's own `gameState.startCard`. A `needsStartCard` refusal exists only
  while `firstPlayMade` is false in the same round, so the client's start card is the one refused.
- The tutorial keeps `TUTORIAL_REFUSAL_KEYS` as a partial override over the same keys (CLI-8's
  shape, untouched).

**Deleted.**
- `server.INVALID_COMBINATION` and `server.MUST_PLAY_START_CARD` in en/it/sq (6 strings). With the
  `ServerCode` type on `payload()`, any leftover emitter becomes a tsc error.
- The five `"INVALID_MOVE"` rows and the two single-code rows, which collapse into one branch.
- The server-side `{ rank }` param computation (`tableHandlers.ts:221-222`, carried by ENG-6).

**Kept.** `server.INVALID_MOVE` is the English `message` fallback and the old-client rendering.

## 5. Migration (one PR, each commit green)

1. **Red:** `tests/integration/gameplay.test.ts:799,847,864` assert `code === "INVALID_MOVE"` and
   `params.refusal` equal to `needsStartCard`, `notACombination` and the beat code. Add a node test
   for `gameErrorText`: each `SelectionRefusal` renders its `PLAY_SPOKEN_KEYS` sentence in en/it/sq;
   a 2-player fallback start card (4♥) renders the 4♥; an unknown refusal and a non-move code render
   through `translateServerPayload`. These are red on the branch base.
2. **Green:** collapse the selection rows in `MOVE_REFUSAL_CODES`, send `{ refusal }`, add
   `gameErrorText`, and switch `onGameError`.
3. **Delete** the two keys in three locales. tsc proves no emitter remains.

## 6. Owner decisions and amendments

- **O1 (owner-eye): the server float's wording.** A refused play's float now reads GIOCA's sentence.
  For example, "card too low" replaces "Invalid move", and "the first play must include the four of
  hearts" replaces "You must play the 4♠ as your first card". This text already appears in the same
  float when GIOCA itself refuses (`GameTable.tsx:943-946`). **Default: accept.**
- **O2: two-revision deploy.** An old client facing a new server sees "Invalid move" for
  `notACombination` and `needsStartCard` (today it sees the specific line). This is the same class as
  D8, and Murlan is not live yet. **Default: accept.**
- **O3: tutorial wording merge (alternative A).** **Default: no.** The overrides are pedagogic, and
  the merge only changes text.
- **Amendments:** none required. ENG-6 keeps its `{ rank }` param as planned and WORD-1 removes it
  after SRV-5. If ENG-6 has not started when this is accepted, an optional amendment saves a later
  edit: ENG-6's DoD bullet "`MUST_PLAY_START_CARD` keeps its `{ rank }` param" may read "the
  selection refusals map to `INVALID_MOVE` with `{ refusal: code }`". WORD-1 then shrinks to the
  client and locale half and stays S.

## 7. Tickets

| ID | title | area | size | ledger IDs | files/modules | blocked by | label | owner-eye? |
|---|---|---|---|---|---|---|---|---|
| WORD-1 | A refused play reads the same on GIOCA and in the server float | client | S | review C6 | server/game/tableMoves.ts, components/table/spokenLabels.ts, context/OnlineGameContext.tsx, locales/{en,it,sq}.ts, tests/integration/gameplay.test.ts, tests/ui-rules/gameErrorText.test.ts (new) | ENG-2, SRV-5, UI-4 | ready-for-agent | yes |

## 8. Spec cards

### WORD-1: A refused play reads the same on GIOCA and in the server float (S)
- **Defect:** the server maps five engine refusals onto `INVALID_MOVE` ("Invalid move"), while GIOCA
  says why (for example "card too low"). Its start-card sentence hard-codes ♠ in en/it/sq, which is
  wrong on every 2-player opening by the lowest dealt card (`docs/GAME-RULES.md:59`).
- **Where:** `server/game/tableMoves.ts` (`MOVE_REFUSAL_CODES`; at MAIN `tableHandlers.ts:185-195,220-224`);
  `components/table/spokenLabels.ts:25-34,129-149`; `context/OnlineGameContext.tsx:589-591`;
  `locales/en.ts:76-78`, `it.ts:69-71`, `sq.ts:85-87`; `tests/integration/gameplay.test.ts:799,847,864`.
- **Build:**
  - Every `SelectionRefusal` row in `MOVE_REFUSAL_CODES` maps to `INVALID_MOVE` with
    `params: { refusal: code }`, sent through SRV-2's `refuse`. `notHeld`, `exchangeOpen` and
    `mustLead` are unchanged.
  - `gameErrorText(payload, startCard, t)` in `spokenLabels.ts`. A known `params.refusal` goes through
    `playRefusalLabel` with the client's start card. Anything else goes to `translateServerPayload`.
  - `onGameError` sets its text from `gameErrorText`.
  - Delete `server.INVALID_COMBINATION` and `server.MUST_PLAY_START_CARD` from all three locales.
- **Constraints:**
  - The tutorial and `TUTORIAL_REFUSAL_KEYS` are untouched.
  - `PLAY_SPOKEN_KEYS` sentences are unchanged.
  - `server.INVALID_MOVE` stays as the fallback.
  - The guard on `params.refusal` is the wording table, not a second list of codes.
  - No `WRAPPED_EVENT_COUNT` or ack-shape change.
- **DoD:**
  - [ ] Red first: the three integration assertions name `params.refusal`, and they are red on the
    branch base.
  - [ ] `gameErrorText` renders every `SelectionRefusal` as its `PLAY_SPOKEN_KEYS` sentence in en, it
    and sq, plus a 4♥ start card as the 4♥.
  - [ ] An unknown `refusal` and a non-move code render exactly as `translateServerPayload` does.
  - [ ] The two keys are gone from en/it/sq, and tsc is green, so no emitter remains.
  - [ ] PR body shows before/after float text for `tooLow` and `needsStartCard` in en (owner-eye).
- **Checks:** `node --test tests/ui-rules/gameErrorText.test.ts tests/ui-rules/i18n.test.ts`. Gate,
  plus integration `gameplay`.
- **Not this ticket:**
  - Tutorial wording (owner decision O3, default no).
  - `INVALID_CARD`, `EXCHANGE_PENDING` and `CANNOT_PASS` wording.
  - The engine's developer-facing `refusalMessage` throw.
- **Source:** 17-refusal-wording §4; review C6.
