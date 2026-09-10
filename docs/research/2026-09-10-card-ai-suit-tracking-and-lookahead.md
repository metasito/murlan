# Suit tracking and lookahead for the known exchange card, for #943

Research date: 2026-09-10, for #943's own request (issue body, and the parking comment dated after
it) for an owner-level decision between "Option A" (suit-level royal-straight reasoning) and
"Option B" (bounded lookahead) before an agent writes code — reopened after a same-day comment on
the issue retracted an earlier "owner delegated the pick" comment as fabricated, so no real
decision exists yet. Citation standard and tiering follow
`docs/research/2026-09-04-card-ai-difficulty-and-human-play.md`, which this document treats as its
house style:

- **T1 — primary source that owns the claim**: the actual rules site, the actual paper, the actual
  source code, fetched and read (this project's convention, per the 2026-09-04 doc, counts a page
  fetched and read via the tool available here as T1 even when a summarizing step touches it — a
  PDF that would not extract is what drops to T2, not the fetch mechanism itself).
- **T2 — a search-engine synthesis of a primary source** that could not be fetched and read
  directly (a PDF that would not extract, an abstract-only landing page).
- **T3 — blogs, aggregator sites, forum/wiki content, or a single first-hand account.** Not
  primary, not peer-reviewed, but sometimes the only material that exists.
- **Repo-derived** — a claim checked directly against this codebase's own source (`lib/gameEngine.ts`,
  `docs/RULES.md`), which is itself the primary source for a Murlan-specific fact no external
  literature could settle.
- **Not published / not found** — stated plainly.

---

## Headline finding, stated before the detail

**Recommendation: build nothing further on the known-exchange-card axis specifically.** Neither
Option A (suit-level reasoning gated on the known card) nor Option B (bounded lookahead against the
known card) is well supported once checked against this repo's own code and against the published
literature on comparable games. Both were scoped in the issue thread on an assumption about the
known card that turns out to be wrong when checked against `docs/RULES.md` and `lib/gameEngine.ts`
directly (§1 below) — and that correction, not a difference of taste between A and B, is most of
why both options have a low ceiling.

If the owner still wants to close `takesTheRound`'s named royal-straight blind spot (the one real,
named gap this research found), the right shape is a **general fix decoupled from the exchange
mechanic entirely** — because the blind spot exists on every hard/medium-tier "certain win" lead
decision in the game, not only the narrow window a known exchange card is live — and it should be
**measured before it is built**, the same discipline that killed #907's own 0.12% attempt, but run
before code exists rather than after. §5 gives a concrete, harness-checkable plan for that
measurement, using nothing but a diagnostic extension of `scripts/measureHeadsUpBalance.ts` — no
engine change required to take the measurement, since `royal_straight` is already fully implemented.

Real, general lookahead (ISMCTS-style search) is the one direction the literature shows clearly
outperforms hand-written heuristics in this genre (§6.3) and would make "how do I use one known
card" a non-question, because determinized search absorbs a known card automatically (§6.2). But it
is an architecture-level commitment — it does not fit #943's own constraint that whatever lands
"only re-ranks/filters" a legal candidate list "same as every other tier heuristic" — so it belongs
in its own, much bigger ticket if the owner wants a genuine hard-tier strength jump, not as an
extension of the known-card mechanic.

---

## 1. What exists in the repo already, read before researching

### 1.1 The known-card mechanism actually shipped, and a correction to the issue's own premise

`knownOpponentExchangeCard` (`lib/gameEngine.ts:782-789`) is the only known-card plumbing that
exists in the shipped engine:

```
export function knownOpponentExchangeCard(
  exchangePhase: ExchangePhase | undefined,
  seat: number
): Card | undefined {
  if (!exchangePhase || exchangePhase.bothJokersException) return undefined;
  if (seat !== exchangePhase.loserIdx) return undefined;
  return exchangePhase.cardFromLoser;
}
```

Its own doc comment (lines 772-781) is explicit: it surfaces **the loser's own former best card,
which the winner now holds** — never the winner's giveback, which the same comment says is
"deliberately not surfaced" because a bot's own giveback is always its weakest eligible card, so "a
floor built on that fact would never fire."

`docs/RULES.md` §10.1 (repo-derived, quoting catsatcards as its own Tier-1 source) states what that
card actually is: *"The player who finished last in the previous hand gives the player who finished
first their single highest-ranked card (this is compulsory and automatic — it will be the Red
Joker, else the Black Joker, else a 2, and so on)."* `getBestCardFromHand`
(`lib/gameEngine.ts:1335-1338`) implements exactly that — sorted by `cardStrength`, i.e. by
`RANK_ORDER` position, top of which is `2`, `joker_bw`, `joker_colored`.

**This means the one known card any future #943 work would operate on is, in practice, almost
always a 2 or a Joker — the single strongest tier of card in the deck — not a weak rank-3–10 card.**
The "always rank 3–10" description that appears twice in #943's own body (`gh issue view 943`, body
and the first substantive comment) describes a *different* card: the winner's giveback
(`getValidGivebackCards`, `EXCHANGE_VALID_RANKS = ["3"…"10"]`, `lib/gameEngine.ts:1182,1311-1317`),
which is real, is genuinely bounded 3–10, but is the card `knownOpponentExchangeCard` explicitly
*excludes* — it was the subject of the earlier, fully-removed hard-tier attempt (#907's review
comments, quoted in full in §2), not of anything #943 could extend, since #907's own review already
found that half of the code "provably dead" and deleted it. Conflating the two known cards is an
easy mistake — the exchange moves one of each direction every hand — but it matters: costing Option
A/B against "the known card is weak, rank 3–10" understates how much of its value the #907 floor
already captures, because a floor built for *that* card (avoid leading under a top-tier card) is a
much bigger constraint than a floor built for a weak one would be. §3 works out what is actually
left over once that correction is applied.

### 1.2 The rank-only counting surface `#943` proposes to extend

- `RANK_ORDER`, `DECK_BY_STRENGTH`, `getRankStrength`, `emptyRankTally` (`lib/gameEngine.ts:116-132`)
  — 15 rank slots (3…A, 2, joker_bw, joker_colored), no suit dimension anywhere.
- `outstandingTally`/`outstandingAbove` (146-164) — "how many of each rank are neither played nor
  in my hand," summed above a strength. Its own doc comment: at two seats "twenty-six cards are
  never dealt… they are counted here as outstanding. That errs towards caution."
- `bombPossible` (174-177) — whether any rank still has all 4 copies outstanding, i.e. an opponent
  could hold a bomb. Rank-indexed only, correctly: `isBomb` requires four of one rank
  (`lib/gameEngine.ts:241-246`), suit-blind by the rules themselves.
- `takesTheRound` (`lib/gameEngine.ts:842-860`), the "certain win" shortcut used for a new-round
  lead. Its own comment names the exact gap #943 is about:

  > "The one thing ranks cannot exclude is a royal straight, which needs five consecutive cards of
  > a single suit and so turns on suits this tally deliberately does not hold. That is the residual
  > risk, and it is a cheap one: it is the strongest hand in the game (§7.4), so drawing one out to
  > answer a single card is a trade worth inducing."

  **Correction to the "hard tier only" framing carried over from the 2026-09-04 research doc**:
  reading the current file line-by-line, the `certain`/`takesTheRound` block sits *above* the
  `diff === "medium"` branch (`lib/gameEngine.ts:887-892`, vs. `medium` at 901), so this shortcut —
  and its royal-straight blind spot — fires for **both `medium` and `hard`** tiers today, not hard
  alone. (The 2026-09-04 doc's "hard is the only tier that reads `playedRanks`" was accurate against
  that day's line numbers; #907's landing appears to have hoisted this block above the tier branch.
  This matters for §5: a general fix has a bigger measured surface than "hard tier only" implies.)
- `canPlay` (`lib/gameEngine.ts:468-495`) is the actual authority on what beats a single 2/Joker
  lead: a higher-ranked single of the same shape, a bomb (always beats a non-bomb, non-royal
  lastPlayed, `lib/gameEngine.ts:484-488`), or a royal straight (always beats anything but a longer
  or higher royal straight, 474-482). **A royal straight is the only one of those three `bombPossible`
  does not already answer**, independent of any known card — it is a residual for *any* strong
  single lead, exchange-related or not.

### 1.3 `scripts/measureHeadsUpBalance.ts`, the harness any recommendation here has to clear

Measurement 5 (`measureExchangeBlunderAvoidance`, lines 245-322) is the template for how #907 itself
was checked: drive a real, seeded match through the real engine and `autoMove.ts`, and at every
new-round lead where the known card is live, ask the question twice — with and without the fact —
using the same `aiChoosePlay` call the game actually makes, not a copy. It reported the number that
killed the earlier hard-tier attempt: **6 of 4950 gent-vs-gent responses changed (0.12%)**, per
#907's own comments (§2). §5 below proposes the same measurement discipline applied *before* writing
code, for the direction this document ends up recommending.

---

## 2. #907 and #943 in full — the floor, the removed attempt, and the open decision

`gh issue view 907/943 --json title,body,comments` (repo `metasito/murlan`, fetched 2026-09-10) —
summarized here because the full text is quoted above where it settles a fact, and is long:

- #907 shipped the floor: every tier avoids leading a single that loses outright to the known,
  still-live exchange tribute. Measured directly: **98.4% (n=5177) → 0.0%** blunder rate on
  decision points where a safe lead was legal (1525 forced leads, no safe alternative, reported
  separately); the coarser manche-winner-streak proxy moved **70.1% → 68.5%** (non-overlapping 95%
  CIs).
- #907's round-3 review record (the review comment quoted in full above, §2's own source) is where
  the removed hard-tier "goes further" attempt and its 0.12% number are recorded, along with the
  exact structural reason it was near-inert: *"`conservative` already excludes 2s/jokers (so it can
  never beat a known 2/joker) and a winner-side known card (the giveback, always rank 3-10) is
  beaten by nearly every conservative response anyway."* Read against §1.1's correction: the first
  half of that sentence is about the *loser-side* known card (a 2/Joker, provably unbeatable by a
  `conservative` response by construction — that clause was never going to fire, for any rank the
  known card could have been), and the second half is about the *winner-side* giveback, which the
  same review round separately found "provably dead" and deleted, because `pickGivebackCard` is
  always the hand's weakest eligible card.
- #943's own body proposes Option A (suit-level, "the known card's exact suit narrows royal-straight
  risk on that suit specifically") and Option B (bounded lookahead, "if I lead X, can the known
  card answer, and what does that cost them"), both attributed to a prior, non-research-backed
  triage pass, and both explicitly offered as *a* menu, not the only two options — the issue itself
  says "Both are bigger design questions than a one-line filter."
- The most recent comment on #943 (2026-09-10) retracts an intervening comment that had claimed
  "Owner delegated the pick" toward Option A, stating plainly that the delegation never happened and
  reopening the choice — this research was commissioned into that reopened, still-undecided state,
  not to validate a standing decision.

---

## 3. Why Option A, as literally scoped in #943, has a smaller ceiling than the 0.12% precedent

Given §1.1 (the known card is virtually always a 2 or a Joker) and §1.2 (`canPlay`'s three ways to
beat a strong single: higher single, bomb, or royal straight), working out what is actually left for
suit-level reasoning to add, once #907's floor already exists:

1. **A higher single of the same rank family** (a stronger Joker, or the other three 2s) is already
   priced into `outstandingAbove`/`losesLeadToExchangeCard` — rank-indexed, no suit needed, already
   shipped.
2. **A bomb** is already priced into `bombPossible` — rank-indexed, no suit needed, already shipped,
   and unrelated to which specific card is known (a bomb beats *any* single, known or not).
3. **A royal straight** is the one gap ranks cannot see — but it is a gap in `takesTheRound` for
   *any* strong single lead the bot considers, not a gap that exists *because* a specific card is
   known. Knowing that the opponent holds one particular card of a given suit does not narrow
   same-suit-run risk in that suit in the direction the issue's Option A description assumes — if
   anything, it is very weak evidence *toward* the opponent having a run in that suit (they are
   confirmed to hold at least one card of it), not away from it. The quantity that would actually
   bound the risk (how many *consecutive* same-suit ranks remain outstanding-or-in-hand around the
   candidate lead's strength) requires the same general per-suit tally whether or not any one card
   in that suit happens to be known — the known card contributes at most one already-counted data
   point to a count that needs four or five to matter.

So a suit-tracking predicate scoped specifically to "does this narrow risk around the known
exchange card" inherits the general blind spot's low base rate (royal straights are rare — five
consecutive same-suit cards concentrated in one hand, in a 28-of-54-card two-seat deal) **and** adds
almost no discriminating power beyond what a suit-blind general fix would already have, because the
known card is only ever one data point in the suit-count that would actually decide the question.
This is a *repo-derived* finding (built from `canPlay`, `RANK_ORDER`, `getBestCardFromHand`, and
`docs/RULES.md` §10.1, all read directly, §1), not sourced externally — but it is the direct,
concrete reason Option A, scoped the way #943 currently scopes it, is very unlikely to clear even
the 0.12% bar the earlier removed attempt set. Gating a real suit-tracking capability behind "is the
known exchange card involved" throws away nearly all of its potential surface for structural
reasons specific to this exchange mechanic, not because suit tracking itself has no value (§5 asks
that separately).

---

## 4. What the literature says a "goes further" step should look like, surveyed broadly

### 4.1 Directly comparable open-source shedding/climbing bots: none use a single-known-card heuristic

- **RLCard's `DouDizhuRuleAgentV1`/`UNORuleAgentV1`** (Texas A&M DATA Lab, fetched directly and
  quoted in full by `docs/research/2026-09-04-card-ai-difficulty-and-human-play.md` §3.1, T1 there,
  cited here rather than refetched): lead the minimum card in any valid combination, match the
  target's type at the lowest legal rank when responding, or pass. No card tally at all, let alone a
  known-card-specific heuristic.
- **`matgrioni/euchre-bot`** ("Albert"), a from-scratch open-source Euchre MCTS bot — README fetched
  directly, 2026-09-10, <https://github.com/matgrioni/euchre-bot> — uses determinization "polled
  uniformly, given the constraints of prior tricks" and states this could be improved by "weighting
  more likely determinizations" based on prior play, but describes **no bespoke mechanism for a
  single certain fact** — a known card, if it existed in Euchre's rules the way it does here, would
  be handled by constraining the uniform sample, not by a dedicated predicate. Its own finding:
  "increasing determinizations did not help as much as increasing number of playouts" — search
  breadth (playouts) mattered more than sampling breadth (determinizations) for this bot.
- **`JeremyHub/Presidents`**, an open-source President/Asshole bot framework — README fetched
  directly, 2026-09-10, <https://github.com/JeremyHub/Presidents> — states plainly "suits play no
  purpose in this game," i.e. the closest open-source relative of Murlan's own exchange mechanic
  (President's "scum gives the president their best card" — already cited via Wikipedia in the
  2026-09-04 doc §2.3) has no suit dimension to track at all in that implementation.
- **A first-hand teardown of a shipped mobile Euchre bot** (already cited in the 2026-09-04 doc
  §3.2, T3 but concrete and on point,
  <https://www.jjanusch.com/2025/05/poor-game-ai>): the weak bot "doesn't remember what cards it's
  already seen" at all — the failure mode this research keeps finding on the low end of shipped
  card-AI is *no* memory, not a memory that fails to specialize on one known fact.

**Not found, anywhere in this research**: a single published or open-source shedding/climbing/
trick-taking bot — rule-based or search-based — that implements a bespoke heuristic for "I know
exactly one specific opponent card." The two patterns that do exist in the literature are the
extremes: ignore it entirely (every rule-based agent surveyed), or get it for free from a general
mechanism built for a much larger purpose (determinization/ISMCTS, §4.2). A bespoke, narrowly-scoped
heuristic sitting between those two — which is what both Option A and Option B, as scoped in #943,
would be — has no precedent found in this survey.

### 4.2 ISMCTS / determinization: the general mechanism that would absorb a known card "for free"

- Cowling, Powley, Whitehouse, "Information Set Monte Carlo Tree Search," *IEEE Transactions on
  Computational Intelligence and AI in Games*, 2012 — located via Semantic Scholar and the White
  Rose institutional repository, <https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf>;
  the PDF would not extract cleanly through the tools available to this research (T2, reported via
  search-engine synthesis rather than a direct read). The synthesized finding, corroborated by
  §4.2's next source (same authors, a fully-readable practitioner writeup): ISMCTS searches trees of
  *information sets* rather than determinized single-world trees, and "is demonstrated to outperform
  existing approaches to handling hidden information and uncertainty in games," including on the
  climbing/shedding game Dou Di Zhu specifically (a companion paper by the same group, "Determinization
  and information set Monte Carlo Tree Search for the card game Dou Di Zhu," located but not
  independently re-verified here beyond the 2026-09-04 doc's existing RLCard citation for that game).
- The same authors' own practitioner writeup for their commercial studio — "Reducing the burden of
  knowledge: Simulation-based methods in imperfect information games," AI Factory newsletter, 2013,
  fetched and read directly 2026-09-10, <https://www.aifactory.co.uk/newsletter/2013_01_reduce_burden.htm>
  (T1) — is the single most directly useful source found for this question, because it answers
  exactly what #943 is asking: **how does a real, shipped card-game AI use one certain fact about
  hidden cards?** Quoting the fetched content: during determinization, the algorithm "randomly
  assigns unseen cards, then restricts legal moves to those compatible with that assignment," and
  the Spades implementation "tracks when players fail to follow suit, concluding that they have no
  cards in that suit" — i.e. a known constraint (there, a suit void; here, a known held card) is
  applied by **constraining which determinizations are legal to sample**, not by a bespoke predicate
  layered onto a hand-written heuristic. A known held card is the mirror image of a known void, and
  slots into the same mechanism with no new code shape: always place that one card in the known
  seat's sampled hand.
- **Cost, from the same source**: their ISMCTS Spades AI runs at "less than a quarter of a second on
  a modern mid-range handset" at 2,500 iterations — as of 2013 hardware — while outperforming a
  hand-tuned knowledge-based AI built "over many months of testing and tweaking." That is cheap
  enough in principle for a turn-based mobile card game.
- **The catch, from the same source**: "knowledge-free" ISMCTS, despite winning more, was perceived
  by human testers as playing worse than the tuned heuristic AI, because in fully- or
  near-determined positions it would still make "completely randomly" chosen moves among equally
  winning options — the team had to inject selective heuristics on top to "eliminate inconsequential
  bad moves" before it read as a good opponent. **Real search is not a drop-in replacement for
  tuned heuristics in this genre — it needs the same kind of tuning work layered back on top before
  it feels right to a human opponent**, which is exactly this project's own read on `easy`'s minimal
  policy in the 2026-09-04 doc (§4, "a policy that is simple rather than humanly weak reads as
  broken once a player notices the pattern").

### 4.3 How much real search costs and buys, against hand-written heuristics, in closely comparable games

- **Scopone** (Italian card game; fixed suits, tricks, and a comparable "expert heuristic vs. search"
  structure) — "Traditional Wisdom and Monte Carlo Tree Search Face-to-Face in the Card Game
  Scopone," arXiv:1807.06813, fetched 2026-09-10 (T1 for the abstract-level claims quoted, full
  methodology not independently verified beyond what the fetch returned): a fair-play ISMCTS player
  "is stronger than all the rule-based players implementing well-known and most advanced
  strategies," including ones built from published expert strategy, while a cheating (full-information)
  MCTS variant is stronger still. This is the one primary-ish result found in this research that
  directly measures search against hand-written heuristics of the kind this codebase's `aiChoosePlay`
  already is, in a structurally similar game, and search wins.
- **Hearts and Skat, via a 2024 transformer-planning paper** — "Transformer Based Planning in the
  Observation Space with Applications to Trick Taking Card Games," arXiv:2404.13150, fetched via its
  HTML mirror 2026-09-10 (T1): gives concrete per-move cost figures for determinized search relative
  to a fast baseline — in Hearts, a baseline heuristic/value evaluator ("ArgmaxVal*") took 71ms per
  turn versus **25.6 seconds per turn for GO-MCTS** (≈360×); in Skat, 0.55s versus **≈42s** (≈76×).
  Search bought real strength (state-of-the-art results in both games), but at two to three orders
  of magnitude more compute per decision than a fast heuristic evaluator — and this codebase's
  `aiChoosePlay` is currently far faster than even that fast baseline (a synchronous filter/sort over
  a legal-play list, no evaluation network, no rollout).

### 4.4 What the RLCard-family and Hearts-thesis material (already sourced in this repo) says about lookahead specifically

Re-confirmed against `docs/research/2026-09-04-card-ai-difficulty-and-human-play.md` §3.1 and §3.3
(both T1/T2 there, not refetched here): neither RLCard's rule-based agents nor the Hearts thesis's
"Strong Heuristic Agent" (≈20 hand-coded rules, notably including *voids* — deliberately emptying a
suit early so a dangerous card can be dumped safely later, a self-shaping tactic rather than an
opponent-card-exploiting one) do anything resembling "if I lead X, what does answering cost the
opponent." **No source found anywhere in this research — not the 2026-09-04 doc, not this pass —
describes a hand-coded, non-search "cost of answering" heuristic for a shedding or trick-taking
game.** This is the same gap #943's own parking comment names ("that heuristic *is* the design
question, not an implementation detail under it") — and this research did not find an external
answer to import. Anyone building Option B as scoped would be inventing that heuristic from nothing,
with no comparable prior art to check it against, and no reason to expect it does better than the
lead-side floor #907 already ships (§4.5).

### 4.5 Why Option B, even scoped down to a single-ply check rather than real search, mostly re-derives what #907 already does

Given §1.1 (the known card is nearly always the opponent's strongest single card) and §1.2 (only a
higher single, a bomb, or a royal straight beats it), a bounded "if I lead X, can the known card
answer" check is asking a question `losesLeadToExchangeCard` already answers exactly for the lead
side. The remaining, genuinely new question Option B's description poses — "what does answering cost
the opponent" — only has teeth on the *response* side (should the bot spend a good card to beat
something, given the opponent might be forced to answer with their known top card later) — and that
is precisely the response-side idea #907's removed attempt tried and measured at 0.12%, for the
structural reasons in §3, not because it ran on the wrong turn.

---

## 5. What is actually worth doing, and how to check it before writing code

**Recommendation for #943 as scoped: close it, or narrow it to documenting the §1.1 correction —
do not build Option A or Option B against the known exchange card specifically.** The reasoning in
§3–4 is checkable by anyone reading the same code and issue thread; it does not require running a
new simulation to be confident of, because it follows from facts already fixed by `docs/RULES.md`
and `lib/gameEngine.ts` (which card is known, what beats it, and what already handles what beats
it) rather than from an empirical measurement that could come out either way.

**If the owner independently wants to close `takesTheRound`'s named royal-straight blind spot**
(real, and — per §1.2's correction — live on both `medium` and `hard` tiers, not hard alone, which
widens its potential surface past what #943 scoped), that is a legitimate, differently-scoped
ticket, and it should be **measured before any engine change is written**, using the existing
`royal_straight` implementation (`isRoyalStraight`, `buildCombination`, `canPlay` — all shipped,
nothing new needed to take the measurement):

1. Extend `scripts/measureHeadsUpBalance.ts` (or a sibling script built the same way, over
   `simulateOfflineMatch`/`withSeededDeals` per the file's own conventions) with a new measurement
   that drives seeded 2-seat matches with today's engine and, at every `medium`/`hard`-tier
   `isNewRound` lead where `takesTheRound` would call a candidate "certain," checks the **actual,
   full (non-sanitized) simulated opponent hand** for a live royal straight that legally beats that
   candidate under `canPlay`.
2. Report it exactly the way measurement 5 reports its own numbers — `fmtWilson`, a real seeded n,
   a plain rate — of how often a "certain" lead is not actually certain because of this blind spot.
3. **Gate the decision to build anything on that number, not on intuition.** Use #907's own
   0.12% (6/4950) as the "not worth it, remove rather than ship" floor precedent, and require the
   *lower bound* of the Wilson interval to clear something meaningfully above it (the exact bar is
   an owner call, but it should be stated as a number before the measurement runs, the same way
   #943's own prior comment tried to for Option A — "land only if the harness shows a real,
   non-noise change").
4. If it clears the bar, *then* a suit-indexed outstanding tally (additive alongside the existing
   rank-indexed one, `getAllValidPlays` staying the sole source of legality, exactly as #943's own
   prior comment specified) is worth building, checked against the same measurement rerun after the
   change, as a general `takesTheRound` fix — **not gated on whether an exchange known card happens
   to be live**, since §3 shows that gate throws away nearly all of the fix's own surface.
5. If it does not clear the bar, write that down on the issue and close it, the same honest-gap
   pattern #907 used for its own removed attempt ("Honest gap, not silently dropped") rather than
   leaving #943 open indefinitely.

This step is cheap: it needs no change to `lib/gameEngine.ts` at all, only a read-only diagnostic
pass inside a copy of the measurement harness, so it can be done and answered before anyone commits
to the suit-tracking data structure #943's prior comment already scoped in detail.

**If the owner wants a genuine hard-tier strength jump** rather than closing one named blind spot,
§4.2–4.3 point at real determinized search (ISMCTS) as the sourced, higher-ceiling direction — but
it is a different-shaped project: it would restructure `aiChoosePlay` from a synchronous
filter/sort over `getAllValidPlays`'s output into a sampling/search process, is not expressible as
"re-ranks/filters a legal candidate list" (the constraint #943 itself states every tier heuristic to
date has honored), and — per the AI Factory source's own finding — would still need hand-tuned
heuristics layered back on top to read as a good opponent to a human, not just a stronger one by
win rate. That is worth its own ticket and its own Definition of Done if the owner wants it; it is
not an extension of #943, and a known exchange card would need no special-casing inside it at all
(§4.2) — which is itself a reason not to spend effort special-casing that one card in the current
heuristic engine, since a future search-based tier would make that effort moot.

---

## 6. What was not found, stated plainly

- No public source — academic or open-source — describing a hand-coded heuristic for exploiting one
  exactly-known opponent card in a shedding or trick-taking game, beyond "avoid losing to it" and
  "constrain a general search's sampling to include it" (§4.1, §4.2). This is the central gap #943
  asked this research to check, and it came back empty on the "bespoke middle option" specifically.
- No source quantifying, for Murlan's own exchange mechanic or any President/Daifugo-family
  equivalent, how much value a strong player actually extracts from knowing one gifted/received card
  beyond planning not to lose to it immediately — the same gap the 2026-09-04 research (§2.3, §3.6)
  already found and reports as unresolved by either the human-strategy or the AI-strategy literature.
- No independently-verified full text of the Cowling/Powley/Whitehouse 2012 ISMCTS paper or its Dou
  Di Zhu companion paper — both located and correctly attributed, neither extractable by the tools
  available to this research; both reported at T2 as a result. The 2013 practitioner writeup by the
  same authors (§4.2, T1, fully read) substitutes for the missing cost/benefit detail on the exact
  question this research needed answered.
- No incidence rate, for this specific engine and its 2-seat deal size, of how often a royal straight
  is actually live enough to matter — this is the one number this research recommends measuring
  before any code is written (§5), and it was not computed here because doing so would mean writing
  the diagnostic script this document explicitly stops short of (the task was research, not
  implementation).

---

## Sources

- `lib/gameEngine.ts` — read in full for the counting/AI surface named in the ticket, plus
  `canPlay`, `isRoyalStraight`, `getBestCardFromHand`, `pickGivebackCard`, `getValidGivebackCards`,
  `EXCHANGE_VALID_RANKS` (repo-derived, fetched 2026-09-10).
- `docs/RULES.md` §10 (Exchange phase), quoting catsatcards as its own Tier-1 source (repo-derived).
- `scripts/measureHeadsUpBalance.ts`, measurement 5 (repo-derived).
- `gh issue view 907 --repo metasito/murlan --json title,body,comments` (T1, fetched 2026-09-10).
- `gh issue view 943 --repo metasito/murlan --json title,body,comments` (T1, fetched 2026-09-10).
- `docs/research/2026-09-04-card-ai-difficulty-and-human-play.md` — this project's own prior
  research pass, cited rather than refetched for the RLCard rule-agent and Hearts-thesis findings it
  already sourced directly.
- Cowling, Powley, Whitehouse, "Information Set Monte Carlo Tree Search," IEEE TCIAIG 2012 —
  <https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf> (T2, PDF would
  not extract; found and attributed via Semantic Scholar/White Rose listings).
- "Reducing the burden of knowledge: Simulation-based methods in imperfect information games," AI
  Factory newsletter, 2013 — <https://www.aifactory.co.uk/newsletter/2013_01_reduce_burden.htm> (T1,
  fetched and read directly 2026-09-10).
- "Traditional Wisdom and Monte Carlo Tree Search Face-to-Face in the Card Game Scopone,"
  arXiv:1807.06813 — <https://arxiv.org/abs/1807.06813> (T1 for the abstract-level claims quoted,
  fetched 2026-09-10).
- "Transformer Based Planning in the Observation Space with Applications to Trick Taking Card
  Games," arXiv:2404.13150 — <https://ar5iv.labs.arxiv.org/html/2404.13150> (T1, fetched and read
  directly 2026-09-10).
- `matgrioni/euchre-bot` README — <https://github.com/matgrioni/euchre-bot> (T1, fetched directly
  2026-09-10).
- `JeremyHub/Presidents` README — <https://github.com/JeremyHub/Presidents> (T1, fetched directly
  2026-09-10).
- DouZero+ (arXiv:2204.02558) — checked for a possible "known-fact opponent modeling" precedent in
  DouDizhu; abstract only, mechanism unspecified there, not load-bearing for any claim above.
