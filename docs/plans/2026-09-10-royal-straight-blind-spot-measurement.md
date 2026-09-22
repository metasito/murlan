# Royal-straight blind spot measurement (#943) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure how often `takesTheRound`'s named royal-straight blind spot (`lib/gameEngine.ts:851-855`) actually lets a medium- or hard-tier bot's "certain" new-round lead get answered anyway, before anyone writes an engine fix for it — and gate whether a fix gets built at all on that number.

**Architecture:** A read-only diagnostic measurement added to `scripts/measureHeadsUpBalance.ts`, following that file's own existing pattern (measurement 5, `measureExchangeBlunderAvoidance`): drive real, seeded 2-seat matches through the real engine (`simulateOfflineMatch`/`withSeededDeals`/`autoMoveForSeat`), and at every decision point of interest, ask a question against the *actual, non-sanitized* simulated state rather than a copy or a mock. No change to `lib/gameEngine.ts`'s behavior — the one touch there is exporting an already-existing, already-tested private function so the diagnostic can reuse the engine's own straight-ordering logic instead of re-deriving it.

**Tech Stack:** TypeScript, `node --test` (plain Node test runner, no framework), `node --experimental-strip-types` (this repo's existing way of running `.ts` scripts directly).

**Spec:** `docs/research/2026-09-10-card-ai-suit-tracking-and-lookahead.md` — the research this plan implements. Its §5 ("What is actually worth doing, and how to check it before writing code") is what this plan is: build no engine change, measure the blind spot first, gate any future work on the result. Read it before executing this plan; it also carries the factual correction to #943's own premise (§1.1) and the reasoning against Option A/B (§3–4) that this plan does not repeat.

## Global Constraints

- **No engine behavior change.** The one edit to `lib/gameEngine.ts` is adding `export` to an existing, already-correct, already-tested private function (`getStraightFaceValue`) — visibility only, not logic.
- **Reuse the real classifier, never a second copy of straight-detection logic.** `isRoyalStraight`/`isStraight`'s own ordering logic (ace-high vs ace-low, "2 is low, never high") lives in `getStraightFaceValue`. The diagnostic must call it, not re-derive its rank-to-value mapping — a second copy of that mapping is exactly the kind of duplicated logic this repo's own conventions (`CARD_W`/`CARD_H`, `impactDelayMs()`) warn against.
- **2-seat matches only**, matching measurement 5's own scope and this repo's "the strongest hand in the game" framing (a royal straight needs 5 consecutive same-suit cards concentrated in one hand — far more likely from a 28-of-54-card 2-seat deal than a 4-seat one).
- **Gate any future engine fix on a stated number, before the measurement runs**, per the research's own instruction: the Wilson lower bound of `actuallyAnswerable / certainLeadsChecked` must clear **1%** (roughly 8× #907's own 0.12%/6-of-4950 "not worth it, remove rather than ship" precedent) for a fix to be worth building. This bar is stated here, in the plan, before Task 4 runs it — not chosen after seeing the number. The owner can revise it before Task 4 if 1% doesn't match their judgment, but Task 4 must not silently pick a different bar after the fact.
- **`getAllValidPlays` stays the sole source of legality** anywhere new code asks "what can this hand play" — this plan's diagnostic never bypasses it.

---

## File Structure

- **Modify: `lib/gameEngine.ts`** — one-line visibility change: `export` the existing `getStraightFaceValue` function (currently module-private, lines 183-191). No other change.
- **Modify: `scripts/measureHeadsUpBalance.ts`** — add one new exported pure helper (`handHasLegalRoyalStraight`), one new exported predicate (`isCertainLead`, mirroring the module-private `takesTheRound` inside `lib/gameEngine.ts`'s `aiChoosePlay`), one new measurement function (`measureRoyalStraightBlindSpot`), and wire its report into `main()` as "Measurement 6". Same file, same conventions, because every existing measurement lives here and the script's own banner already documents it as the place `#839`/`#907`-style measurements go.
- **Create: `tests/royalStraightBlindSpotHelpers.test.ts`** — a `node --test` file pinning `handHasLegalRoyalStraight` and `isCertainLead` against known hands, using `tests/straights.test.ts`'s own existing fixtures (2-low, ace-high, ace-low, K-A-2 wrap-illegal) as the oracle for the straight-detection cases, so a mistake in the diagnostic is caught before it produces a misleading measurement. `measureRoyalStraightBlindSpot` itself gets no dedicated test — matching this file's own established pattern, where measurements 1–5 are validated empirically by running the script and reading real numbers, not by a unit test of the measurement function.

---

### Task 1: Export `getStraightFaceValue`, no behavior change

**Files:**
- Modify: `lib/gameEngine.ts:183`

**Interfaces:**
- Produces: `export function getStraightFaceValue(rank: Rank, aceAsHigh: boolean): number | null` — same signature, same body, now importable.

- [ ] **Step 1: Read the current function to confirm nothing else needs to change**

Run: `sed -n '183,191p' lib/gameEngine.ts`

Expected output (confirm it matches exactly before editing — if it has drifted, stop and re-read the surrounding code rather than editing blind):

```ts
function getStraightFaceValue(rank: Rank, aceAsHigh: boolean): number | null {
  if (rank === "joker_bw" || rank === "joker_colored") return null;
  if (rank === "A") return aceAsHigh ? 14 : 1;
  const map: Partial<Record<Rank, number>> = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
    "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13,
  };
  return map[rank] ?? null;
}
```

- [ ] **Step 2: Add `export`**

Change line 183 from:

```ts
function getStraightFaceValue(rank: Rank, aceAsHigh: boolean): number | null {
```

to:

```ts
export function getStraightFaceValue(rank: Rank, aceAsHigh: boolean): number | null {
```

- [ ] **Step 3: Confirm nothing broke**

Run: `npx tsc --noEmit && node --experimental-strip-types --test tests/straights.test.ts`
Expected: both PASS (typecheck clean, all existing straight tests still green — this step changes visibility only, so every existing assertion about straights must be byte-for-byte unaffected).

- [ ] **Step 4: Commit**

```bash
git add lib/gameEngine.ts
git commit -m "export getStraightFaceValue: visibility only, for #943's blind-spot measurement"
```

---

### Task 2: `handHasLegalRoyalStraight` and `isCertainLead` helpers, test-first

**Files:**
- Create: `tests/royalStraightBlindSpotHelpers.test.ts`
- Modify: `scripts/measureHeadsUpBalance.ts` (add helpers, no wiring into `main()` yet — that is Task 3)

**Interfaces:**
- Consumes: `getStraightFaceValue(rank, aceAsHigh)` from Task 1 (`../lib/gameEngine.ts`), plus already-exported `outstandingAbove(strength, played, myHand): number`, `bombPossible(played, myHand): boolean`, `cardStrength(card): number`, `STRAIGHT_MIN_LEN` (= 5), and the existing `Card`, `Combination`, `Suit` types — all already exported by `lib/gameEngine.ts` today (confirmed by direct read; `STRAIGHT_MIN_LEN` at line 195, `type Suit` at line 4).
- Produces: `export function handHasLegalRoyalStraight(hand: Card[]): boolean` and `export function isCertainLead(play: Combination, playedRanks: number[] | undefined, hand: Card[]): boolean` — both used by Task 3's `measureRoyalStraightBlindSpot`.

- [ ] **Step 1: Write the failing test**

Create `tests/royalStraightBlindSpotHelpers.test.ts`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { c, j } from "./helpers.ts";
import { cardStrength, type Card } from "../lib/gameEngine.ts";
import {
  handHasLegalRoyalStraight,
  isCertainLead,
} from "../scripts/measureHeadsUpBalance.ts";

describe("handHasLegalRoyalStraight", () => {
  test("no cards of any suit reach 5 in a row: false", () => {
    const hand: Card[] = [
      c("3", "hearts"), c("4", "hearts"), c("6", "hearts"), c("7", "hearts"),
      c("2", "clubs"),
    ];
    assert.equal(handHasLegalRoyalStraight(hand), false);
  });

  test("5 consecutive same-suit cards, 2 low: true (mirrors tests/straights.test.ts)", () => {
    const hand: Card[] = [
      c("2", "hearts"), c("3", "hearts"), c("4", "hearts"), c("5", "hearts"),
      c("6", "hearts"), c("K", "clubs"),
    ];
    assert.equal(handHasLegalRoyalStraight(hand), true);
  });

  test("5 consecutive same-suit cards, ace high: true", () => {
    const hand: Card[] = [
      c("10", "spades"), c("J", "spades"), c("Q", "spades"), c("K", "spades"),
      c("A", "spades"),
    ];
    assert.equal(handHasLegalRoyalStraight(hand), true);
  });

  test("K-A-2 wrap is not a straight: false", () => {
    const hand: Card[] = [
      c("10", "diamonds"), c("J", "diamonds"), c("Q", "diamonds"),
      c("K", "diamonds"), c("A", "diamonds"), c("2", "diamonds"),
    ];
    assert.equal(handHasLegalRoyalStraight(hand), false);
  });

  test("5 consecutive cards split across two suits: false (not same-suit)", () => {
    const hand: Card[] = [
      c("3", "hearts"), c("4", "hearts"), c("5", "clubs"), c("6", "hearts"),
      c("7", "hearts"),
    ];
    assert.equal(handHasLegalRoyalStraight(hand), false);
  });

  test("jokers never contribute: a hand of only jokers and a short same-suit run is false", () => {
    const hand: Card[] = [j("bw"), j("colored"), c("3", "spades"), c("4", "spades")];
    assert.equal(handHasLegalRoyalStraight(hand), false);
  });

  test("6 consecutive same-suit cards still counts (any run >= 5, not exactly 5)", () => {
    const hand: Card[] = [
      c("3", "clubs"), c("4", "clubs"), c("5", "clubs"), c("6", "clubs"),
      c("7", "clubs"), c("8", "clubs"),
    ];
    assert.equal(handHasLegalRoyalStraight(hand), true);
  });
});

describe("isCertainLead", () => {
  test("a single with nothing higher outstanding and no bomb possible: certain", () => {
    // Every other 2 and both jokers already played or in my own hand, and no
    // rank still has all 4 copies outstanding.
    const hand: Card[] = [c("2", "hearts")];
    const playedRanks: number[] = new Array(15).fill(0);
    playedRanks[cardStrength(c("2", "clubs"))] = 3; // 3 of the other 3 twos played
    // all 4 of every other rank played too, so no bomb is possible
    for (let i = 0; i < 12; i++) playedRanks[i] = 4;
    const single = { type: "single" as const, cards: [c("2", "hearts")], strength: cardStrength(c("2", "hearts")) };
    assert.equal(isCertainLead(single, playedRanks, hand), true);
  });

  test("a pair is never a certain lead, regardless of ranks", () => {
    const hand: Card[] = [c("A", "hearts"), c("A", "clubs")];
    const pair = { type: "pair" as const, cards: hand, strength: cardStrength(c("A", "hearts")) };
    assert.equal(isCertainLead(pair, undefined, hand), false);
  });

  test("a single is not certain when a higher rank is still outstanding", () => {
    const hand: Card[] = [c("K", "hearts")];
    const single = { type: "single" as const, cards: hand, strength: cardStrength(c("K", "hearts")) };
    assert.equal(isCertainLead(single, undefined, hand), false); // A and 2 still outstanding
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/royalStraightBlindSpotHelpers.test.ts`
Expected: FAIL — `handHasLegalRoyalStraight` and `isCertainLead` are not exported from `scripts/measureHeadsUpBalance.ts` yet (module resolution or "is not a function" error).

- [ ] **Step 3: Add the two helpers to `scripts/measureHeadsUpBalance.ts`**

First, extend the existing import block from `../lib/gameEngine.ts` (near the top of the file) to add the newly-exported and already-exported names this task needs:

```ts
import {
  aiChoosePlay,
  bombPossible,
  cardStrength,
  dealCards,
  getAllValidPlays,
  getStraightFaceValue,
  initializeRematch,
  isExchangeCardStillOut,
  knownOpponentExchangeCard,
  losesLeadToExchangeCard,
  opponentsOf,
  outstandingAbove,
  STRAIGHT_MIN_LEN,
  type Card,
  type Combination,
  type Suit,
} from "../lib/gameEngine.ts";
```

Then add the two helpers after measurement 5's own section (after line 322, before the `// ─── Report ─────` comment at line 324):

```ts
// ─── Measurement 6 helpers: royal-straight blind spot (#943) ──────────────
//
// takesTheRound (lib/gameEngine.ts, module-private inside aiChoosePlay) names
// one residual risk a rank tally cannot see: a royal straight, which needs
// suits the tally deliberately does not hold. isCertainLead mirrors that
// predicate exactly — same three conditions, same order — because the
// original is not exported and this measurement needs to ask the identical
// question about every legal play, not just the one aiChoosePlay ends up
// picking.

/** Mirrors `takesTheRound` inside `lib/gameEngine.ts`'s `aiChoosePlay`. */
export function isCertainLead(
  play: Combination,
  playedRanks: number[] | undefined,
  hand: Card[]
): boolean {
  return (
    play.cards.length === 1 &&
    outstandingAbove(cardStrength(play.cards[0]), playedRanks, hand) === 0 &&
    !bombPossible(playedRanks, hand)
  );
}

/**
 * Whether `hand` holds a legal royal straight in any suit, under either
 * straight-value convention (ace-low, ace-high — `getStraightFaceValue`'s own
 * two conventions, reused rather than re-derived so this can never drift from
 * what `isStraight`/`isRoyalStraight` actually accept). Per `canPlay`, any
 * royal straight beats any single unconditionally (the
 * `candidate.type === "royal_straight"` branch returns true before comparing
 * strength, unless `lastPlayed` is itself a royal straight) — so this
 * function answering `true` is the whole question a "certain" single lead
 * needs answered; no strength comparison is required.
 */
export function handHasLegalRoyalStraight(hand: Card[]): boolean {
  const bySuit = new Map<Suit, Card[]>();
  for (const card of hand) {
    if (card.isJoker || !card.suit) continue;
    const arr = bySuit.get(card.suit) ?? [];
    arr.push(card);
    bySuit.set(card.suit, arr);
  }

  for (const cards of bySuit.values()) {
    if (cards.length < STRAIGHT_MIN_LEN) continue;

    for (const aceAsHigh of [true, false]) {
      const values = cards
        .map((card) => getStraightFaceValue(card.rank, aceAsHigh))
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);

      let runStart = 0;
      for (let i = 1; i <= values.length; i++) {
        const brokeRun = i === values.length || values[i] !== values[i - 1] + 1;
        if (brokeRun) {
          if (i - runStart >= STRAIGHT_MIN_LEN) return true;
          runStart = i;
        }
      }
    }
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/royalStraightBlindSpotHelpers.test.ts`
Expected: PASS, all 10 assertions.

- [ ] **Step 5: Typecheck the whole tree**

Run: `npx tsc --noEmit`
Expected: PASS, no new errors.

- [ ] **Step 6: Commit**

```bash
git add tests/royalStraightBlindSpotHelpers.test.ts scripts/measureHeadsUpBalance.ts
git commit -m "test+feat: royal-straight blind spot detection helpers for #943"
```

---

### Task 3: `measureRoyalStraightBlindSpot`, wired into the report

**Files:**
- Modify: `scripts/measureHeadsUpBalance.ts`

**Interfaces:**
- Consumes: `isCertainLead`, `handHasLegalRoyalStraight` (Task 2, same file); `tableOf`, `withSeededDeals`, `initializeRematch`, `getAllValidPlays`, `autoMoveForSeat`, `mulberry32`, `fmtWilson` — all already defined/imported earlier in this file (confirmed by direct read of the existing measurement 5 and report sections).
- Produces: `measureRoyalStraightBlindSpot(n: number, seed: number): RoyalStraightBlindSpot` — not exported (module-private, like `measureExchangeBlunderAvoidance`; only the two Task 2 helpers need to be importable for their own test).

- [ ] **Step 1: Add the measurement function**

Add after the two helpers from Task 2, still before the `// ─── Report ─────` comment:

```ts
interface RoyalStraightBlindSpot {
  certainLeadsChecked: number;
  actuallyAnswerable: number;
}

/**
 * At every new-round lead a medium- or hard-tier bot makes where today's
 * `certain` filter (isCertainLead, mirroring the module-private
 * `takesTheRound`) calls a candidate a sure thing, checks the actual, full
 * opponent hand — not sanitized, nothing here reads a sanitized view — for a
 * legal royal straight that would answer it. 2-seat matches only, both
 * personalities that reach this code path (`besnik`=medium, `gent`=hard;
 * `easy` never reaches the `isNewRound` certain-filter branch at all,
 * lib/gameEngine.ts:878-880).
 */
function measureRoyalStraightBlindSpot(n: number, seed: number): RoyalStraightBlindSpot {
  let certainLeadsChecked = 0;
  let actuallyAnswerable = 0;

  const personalities = ["besnik", "gent"] as const;
  for (const personalityId of personalities) {
    for (let i = 0; i < n; i++) {
      const players = tableOf(2, [personalityId, personalityId]);
      const dealSeed = seed * 3454817917 + personalities.indexOf(personalityId) * 10_000_000 + i;
      let state = withSeededDeals(dealSeed, () => initializeRematch(players, "free_for_all", []));
      const rng = mulberry32(dealSeed + 1);

      for (let turn = 0; turn < 300 && !state.gameOver; turn++) {
        const seat = state.currentTurnIndex;
        const isNewRound = !state.exchangePhase?.active && state.lastPlayedCombination === null;

        if (isNewRound) {
          const leader = state.players[seat];
          const legalPlays = getAllValidPlays(leader.hand, null, true, undefined);
          const certain = legalPlays.filter((p) => isCertainLead(p, state.playedRanks, leader.hand));
          if (certain.length > 0) {
            certainLeadsChecked++;
            const opponentSeat = seat === 0 ? 1 : 0; // 2-seat table only
            if (handHasLegalRoyalStraight(state.players[opponentSeat].hand)) {
              actuallyAnswerable++;
            }
          }
        }

        const next = autoMoveForSeat(state, seat, true, { rng });
        if (!next) break;
        state = next;
      }
    }
  }

  return { certainLeadsChecked, actuallyAnswerable };
}
```

- [ ] **Step 2: Wire it into `main()`'s report, after Measurement 5**

Add, right after the existing Measurement 5 block (after the `blunders.forcedLeads` line, before the closing `console.log(\`\nDone in...\`)` line):

```ts
  // ── Measurement 6 ───────────────────────────────────────────────────────
  console.log("\n## 6. Royal-straight blind spot in \"certain\" leads (#943)\n");
  console.log("At every medium/hard new-round lead today's engine calls a sure thing,");
  console.log("checks the real opponent hand for a live royal straight that answers it.");
  console.log("Gate (docs/research/2026-09-10-card-ai-suit-tracking-and-lookahead.md §5,");
  console.log("stated before this ran): a fix is worth building only if the Wilson lower");
  console.log("bound clears 1% (#907's own 0.12%/6-of-4950 dead-end precedent x ~8).\n");
  const royalGap = measureRoyalStraightBlindSpot(opts.matchN2p, opts.seed);
  console.log(`  "certain" leads checked (besnik + gent, 2-seat): ${royalGap.certainLeadsChecked}`);
  console.log(`  actually answerable by a live royal straight: ${fmtWilson(royalGap.actuallyAnswerable, royalGap.certainLeadsChecked)}`);
```

- [ ] **Step 3: Typecheck and run the existing test suite to confirm nothing regressed**

Run: `npx tsc --noEmit && node --experimental-strip-types --test tests/royalStraightBlindSpotHelpers.test.ts tests/straights.test.ts tests/botExchangeAwareness.test.ts`
Expected: all PASS.

- [ ] **Step 4: Smoke-run the script with small counts to confirm it executes end to end**

Run: `node --experimental-strip-types scripts/measureHeadsUpBalance.ts --dealN 50 --matchN2p 20 --matchN4p 10 --personalityN 20`
Expected: the script completes and prints a "## 6. Royal-straight blind spot..." section with real (if noisy, at n=20) numbers — not a crash, not `NaN`/`n=0` throughout (a `certainLeadsChecked` of exactly 0 at this small n is possible and not itself a bug, but the section must render and the script must exit 0).

- [ ] **Step 5: Commit**

```bash
git add scripts/measureHeadsUpBalance.ts
git commit -m "feat: measure #943's royal-straight blind spot before building a fix"
```

---

### Task 4: Run it for real, report to the owner, gate the decision

**Files:** none (no code changes — this task runs the tool Task 3 built and acts on its output).

- [ ] **Step 1: Run the measurement at the file's default counts**

Run: `node --experimental-strip-types scripts/measureHeadsUpBalance.ts`
Record the full "## 6." section output — `certainLeadsChecked`, the point estimate, and the 95% Wilson interval `[low, high]` for `actuallyAnswerable`.

- [ ] **Step 2: Apply the stated gate**

From the Global Constraints section above: the Wilson **lower bound** must clear **1%** for a fix to be worth building.

- If the lower bound is **≥ 1%**: comment on #943 with the numbers, state that the gate is cleared, and open the follow-on scope as its own ticket — a suit-indexed outstanding tally, additive alongside the existing rank-indexed one, decoupled entirely from the exchange mechanic (per the research §5 step 4 and #943's own prior comment, which already specified this shape in detail: `getAllValidPlays` stays the sole source of legality). Do not build that fix inside this plan — this plan's scope is the measurement, and the research is explicit that whether to build it is a separate decision gated on this number.
- If the lower bound is **< 1%**: comment on #943 with the numbers, state plainly that the gate was not cleared, and close #943 — the same "honest gap, not silently dropped" pattern #907 used for its own removed attempt. Do not leave #943 open indefinitely waiting on a fix that this measurement found isn't worth building.

- [ ] **Step 3: Post the comment and close or re-scope #943 accordingly**

```bash
gh issue comment 943 --body "<numbers from Step 1, and the Step 2 verdict, written out in full — not just a link to this plan>"
# then, per the Step 2 verdict, either:
gh issue close 943 --comment "Gate not cleared (lower bound X% < 1%). Honest gap, not silently dropped — same pattern #907 used for its own removed attempt."
# or:
gh issue comment 943 --body "Gate cleared (lower bound X% >= 1%). Follow-on ticket: #<new number>, scoped to a general takesTheRound fix, not exchange-specific."
```

---

## Self-Review

**1. Spec coverage.** The research's §5 recommendation — measure before building, using a diagnostic extension of `scripts/measureHeadsUpBalance.ts`, no engine change needed for the measurement itself, gate any fix on clearing #907's 0.12% precedent with a number stated up front — is covered by Tasks 1–4 in full. §4.2/§4.3's ISMCTS/search direction is explicitly out of scope per the research's own framing ("a different-shaped project... not an extension of #943") and is not included here. §1.1's premise correction is not a code task — it is already posted to #943 (done in an earlier session turn) and is carried into this plan only as context in the Spec link, not duplicated as a task.

**2. Placeholder scan.** No TBD/TODO; every step has real code or a real runnable command; the gate threshold (1%) is a stated number, not "an owner call" left blank; Task 4's `gh` commands carry real flags, with only the measured numbers themselves (unknown until Task 4 runs) left as the one legitimate blank, explicitly marked as "numbers from Step 1."

**3. Type consistency.** `isCertainLead(play: Combination, playedRanks: number[] | undefined, hand: Card[]): boolean` and `handHasLegalRoyalStraight(hand: Card[]): boolean` are defined once in Task 2 and consumed with the same names and signatures in Task 3's `measureRoyalStraightBlindSpot` and in Task 2's own test file — no renaming drift between tasks.
