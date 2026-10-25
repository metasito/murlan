# 0012. A rules model under tests/model/ is a test oracle, not a second copy

**Status:** Accepted
**Date:** 2026-10-21

## Context

Every engine oracle asked the engine itself: `tests/engine/enumerator.property.test.ts` brute-forces
subsets but classifies each with `buildCombination` and judges it with `checkSelection`, so a wrong
rule the engine and its oracle share stays green (#1818). The owner asked for a regression search
that costs CI minutes rather than LLM audits, and settled every question #1818 put with its stated
default ("make them resdy for agent", 2026-10-21).

A model written from `docs/GAME-RULES.md` is a deliberate second statement of every rule it covers,
which reads as a breach of `docs/agents/RULES.md` 48, "One decision has one copy."

## Decision

1. **A test oracle under `tests/model/`, written from `docs/GAME-RULES.md` and compared with the
   engine, is not a second copy in rule 48's sense.** The comparison merges the two: neither copy
   can drift without a property going red, which is what rule 48 exists to guarantee. Nothing
   outside `tests/` may call the model; the engine stays the one copy the game runs on.
2. **Independence.** `tests/model/` imports nothing at runtime from outside itself; type-only imports
   of `Card` and `Combination` are allowed. `tests/tooling/rulesModelIndependence.test.ts` enforces
   it, with a floor and a planted runtime import, and holds the other direction too: nothing outside
   `tests/` imports the model. The model builds its own deck from §1, and
   `tests/model/differential.property.test.ts` asserts its card ids are `createDeck()`'s. Its
   `*.test.ts` files are the comparison and import the engine.
3. **Scope.** §1, §4–§10: classification, every legal play against the table's demand, beats, the
   opening card, the next seat to act, pass counting and the trick's close, the lead after a seat
   goes out, the finishing order and round end, and the giveback set with the two-Joker exception.
   §12 scoring stays out.
4. **Where the doc is silent, the model states no rule.** It returns a named silence instead, and
   the property skips that case. Each silence is a question to the owner, answered by a
   `docs/GAME-RULES.md` § Decisions row that the model then follows. Reading `gameEngine.ts` to fill
   a gap defeats the model.
5. **Disagreements and silences are listed** in `tests/model/disagreements.json` by seed and case,
   with the § and the issue the owner rules on. A silence the properties meet that is not listed
   fails, and so does a listed case the model now answers or where the engine's answer changed, so
   the list cannot outlive its rulings.

## Consequences

- A rule change is still made only in `lib/game/gameEngine.ts` through a § Decisions row. The model
  changes with it, from the row, never to match the engine without one.
- Each property is proven red on a planted engine defect, planted in a test-side wrapper rather than
  in the engine: a 2 above the Ace in a straight, a bomb beating a royal straight, a trick closing
  one pass early, a giveback offering the card just received, a giveback falling back to the lowest card, and the
  last place owing their second-highest card.
- The properties follow `tests/engine/engineInvariants.property.test.ts`: a fixed `FC_SEED` in CI,
  `FC_RUNS`, and the nightly `offline-match-soak` step moving the seed.
- `getAllValidPlays` returns one play per type, length and strength, so legal plays are compared as
  card-id sets one way (every engine play is a model play) and as classes both ways.
