# Card AI difficulty and human play, for #904

Research date: 2026-09-04, for the owner's research-first instruction on #904 (comment
2026-09-04T07:48:53Z): understand how strong humans actually play this game family, and how
shipped card-game AI actually separates difficulty levels, before touching the bot roster or
its knobs. Citation standard follows `docs/research/2026-09-03-party-invites-and-seat-holds.md`:
every claim carries a URL that was actually fetched, and a claim with no source says so instead
of being invented. Sources are tiered:

- **T1 — primary source that owns the claim**: the actual rules site, the actual paper, the
  actual source code, fetched and read.
- **T2 — a search-engine synthesis of a primary source** that could not be fetched and read
  directly (a PDF that would not extract, a page that returned a summary rather than full text).
  Treated as weaker than T1 even when it names the primary source correctly.
- **T3 — game-design blogs, aggregator "rules + strategy" sites, forum/wiki content.** Not
  primary, not peer-reviewed, but the only material that exists for parts of this question.
- **Not published / not found** — stated plainly rather than filled in with plausible reasoning.

**Headline finding, stated before the detail:** Part A (how strong humans play this family) has
a genuinely thin sourced literature — the two rules sites this project already cites as Tier-1
authorities on the rules (pagat.com, catsatcards.com) contain **no strategy content at all**
beyond one or two sentences. Part B (how shipped AI separates difficulty) has much stronger
primary sourcing, and it converges hard on one answer: **real difficulty ladders change what the
AI is capable of noticing and doing — counting, holding, timing — not how often it exercises a
capability it always had.** That answer is checked against Murlan's actual engine in §4, and the
news there is better than the question worried it might be: the engine's three `AIDifficulty`
tiers already differ this way. The `aggression`/`unpredictability` knobs are a second, and
research-supported, axis for *flavor* — but they cannot be asked to carry the ladder.

---

## 1. What exists in the repo already (read before researching, so findings are checked against it)

- `lib/botPersonalities.ts`: five personalities, each a `{ difficulty: AIDifficulty; aggression:
  number; unpredictability: number }` triple over the engine's three strategy tiers
  (`easy`/`medium`/`hard`). Doc comment: "A personality is a preset over the engine's existing
  strategy tier plus two knobs that re-rank an already-legal candidate list — it never changes
  what is legal."
- `lib/gameEngine.ts` `aiChoosePlay` (lines 777–918) and `applyPersonality` (lines 693–735) are
  the whole AI. Read in full for this research. What actually differs **by tier**, independent
  of any personality knob:
  - **Easy** (line 831–833): `[...plays].sort((a,b) => a.strength - b.strength)[0]` — always the
    single cheapest legal play. No card tally, no hand-size awareness, no held-card protection.
  - **Medium** (854–866): saves bombs (`pool = normal.length > 0 ? normal : bombs`), and once
    the hand is large (`myCards > 8`) prefers multi-card dumps. Still no card tally, no 2/joker
    protection.
  - **Hard** (868–917): the only tier that reads `playedRanks` (a live tally of every rank played
    this hand) to compute `takesTheRound` — "no higher card is outstanding, and no rank is
    missing all four, so no opponent can be holding a bomb" (comment, line 796–809) — i.e. the
    only tier that counts cards. The only tier with a `conservative` filter that excludes 2s and
    jokers from ordinary responses (869–871) — i.e. the only tier that protects high cards. The
    only tier with an unconditional bomb-emergency rule when `minOpponent <= 1` (876–880) that no
    personality knob can suppress. The only tier with endgame dump-shaping (`near3`, 884–886) and
    a `myCards <= 4` branch that changes behaviour specifically near the end of a hand (897–898).
  - `applyPersonality` only ever **re-ranks** the tier's own candidate list: an aggression roll
    can make a personality contest a round it would otherwise pass, or spend a premium card the
    tier would have saved; an unpredictability roll swaps the choice for a same-shape, same-size
    alternative already in the legal list. Neither knob can add card-counting or held-card logic
    a tier doesn't have, and neither can produce an illegal play.
- `docs/RULES.md` §10 (Exchange): the hand's **loser** must give the **winner** their single
  highest card (Red Joker, else Black Joker, else 2s, automatic — the loser has no choice), and
  the winner gives back any one card ranked 3–10 **of their choosing**; the two-joker exception
  lets the loser skip the exchange and lead the new hand instead. Nothing in `gameEngine.ts`
  currently makes an AI's post-exchange hand evaluation different from a hand it was simply
  dealt — see §3.6 and §4.

---

## 2. Part A — how strong humans actually play this family

### 2.1 The two rules sites this project treats as Tier-1 for the rules have essentially no strategy content (T1, checked directly)

`docs/RULES.md` cites `pagat.com` and `catsatcards.com` as its primary rules authorities. Both
were fetched here specifically for strategy content, and both come back nearly empty:

- **pagat.com/climbing/bigtwo.html**: the only strategic passage in the whole page is a
  money-game caution about a player with one card left — "If single cards are being played, you
  should play your highest card. If it is your turn to lead, you should lead a combination [of]
  more than one card if possible; otherwise you should lead your highest card" — plus one general
  line: "You are never under any obligation to beat a card or set of cards just because you are
  able to — you may always choose to pass and keep your high cards for a better opportunity."
  <https://www.pagat.com/climbing/bigtwo.html> (fetched 2026-09-04). **Not published on this
  page**: anything about breaking combinations, holding 2s specifically, card counting, or
  general endgame play beyond the one-card-left case.
- **catsatcards.com/Games/TienLen.html**: fetched directly for the same six questions this
  research was asked to answer. Zero strategy content was found — the only relevant sentence is
  a rules constraint, not advice: "Once a player passes during a series of played combinations
  they may not make a play (including a bomb) until the next series of plays begins."
  <https://www.catsatcards.com/Games/TienLen.html> (fetched 2026-09-04).

This matters for how much weight the rest of §2 can carry: **the two sources this codebase
already trusts most for this game family are silent on strategy.** Everything below is a step
down in tier from what `docs/RULES.md` itself relies on.

### 2.2 A named framework exists, but the best copy of it could not be fully read (T2/T3)

A student strategy analysis of Singapore Chor Dai Di — "Teo Kai Meng, Roddy Kok Yik Siong, Jeremy
Ang Kay Yong and Ivan Lim Wen Chiang, June 2000" — is referenced from multiple secondary pages as
the source of a **controls vs. stragglers** framework: *controls* are high-ranking cards
opponents will likely pass on, *stragglers* are low cards that depend on a control being played
to get out safely. A scanned copy exists at
<https://www.scribd.com/document/188510913/Tai-Di-Analysis>, but the fetch tool could only read
a fragment of it (T2 — summarised, not fully read) confirming the controls/stragglers
terminology and the card-hierarchy framing; the full strategic content (the actual decision
rules built on top of that framework) was not retrievable.

The same terminology, independently, is what a modern strategy write-up for Big Two builds on —
this one **fully readable** (T3, a "rules + strategy" aggregator site, not academic, but the
fullest concrete strategy content found for this family):

> "If you can safely play low cards early — do it. Save high-impact cards for moments when
> control actually matters." … "Using a strong control card early can: Force multiple opponents
> to pass, Expose what kinds of hands they're holding, Create safe windows to unload weak cards."
> … "Holding everything 'for later' often backfires when you never get control again."
<https://www.playfacetoface.com/big-two-strategy> (fetched 2026-09-04)

The same page gives a four-way classification — **Guaranteed Control Plays** (high 2s, top
bombs, "use deliberately, not reflexively"), **High-Probability Plays** (strong pairs/combos),
**Low-Control Cards**, **Stragglers** (weak cards, discard early) — and names the counting
mechanism directly: *"Card Promotion: As higher ranks leave play, previously weak cards gain
strength. A King becomes a control card once Aces and 2s are depleted."* This is the clearest
statement found, anywhere in this research, of **why** counting matters: it isn't bookkeeping for
its own sake, it's what tells a player a card they're holding has just changed category.

### 2.3 The exchange mechanic: sourced generally, not tactically

Murlan's post-hand exchange (RULES.md §10) — loser's best card to the winner, winner returns a
3–10 of their choice — is structurally the same mechanic as **President/Daifugo**'s "scum gives
the president their best card(s)." Wikipedia's own President article states only the mechanic
itself, not tactics: *"After cards are dealt, the scum must hand over the best card in their
hand to the president, and the president passes back any card they do not want."*
<https://en.wikipedia.org/wiki/President_(card_game)> (fetched 2026-09-04) — **no dedicated
strategy section**, confirmed by direct fetch. A broader search across Daifugo sources converged
on the same one qualitative claim, stated by synthesis rather than a single quotable primary
sentence: the exchange **compounds** — the winner sheds weak cards for the loser's strongest,
which is why climbing back from a loss is harder each subsequent hand (search synthesis across
pagat.com/climbing/daifugo.html and others, T2/T3, read 2026-09-04). **Not found, anywhere**: a
concrete tactical rule for *how* a strong player reshapes their plan for the next hand once they
know which card they're about to receive or must give up — e.g., whether a strong player holds
back a specific rank in anticipation of the exchange, or restructures runs around the known gap.
This is a real gap in the literature, not a gap in this search.

### 2.4 What Part A adds up to

Every one of the six questions in the brief (break up a combo, hold a 2/joker, pass while legal,
endgame management, card counting, exchange planning) has *at most* one T3-tier concrete source,
and three of the six (holding a 2/joker specifically as opposed to "high cards" generally;
passing while holding a legal play, beyond "you may always choose to"; and exchange-specific
next-hand planning) were searched for directly and **came back with no concrete decision rule at
all** — general principle, or nothing. The strongest single idea recovered, and the one worth
carrying into engine design, is **card promotion**: the reason counting matters is that it
changes which category a card in your own hand belongs to, not that it produces a running score.

---

## 3. Part B — how shipped card-game AI actually separates difficulty

### 3.1 A directly-comparable open-source climbing game: RLCard's DouDizhu rule agent (T1, source read directly)

DouDizhu (Fight the Landlord) is the closest publicly-documented cousin to this family: a
Chinese climbing/shedding game with singles, pairs, straights and bombs, three players. RLCard
(Texas A&M's DATA Lab toolkit for card-game RL, <https://arxiv.org/pdf/1910.04376>, and
<https://github.com/datamllab/rlcard>) ships a rule-based baseline agent,
`DouDizhuRuleAgentV1` (`rlcard/models/doudizhu_rule_models.py`), fetched directly from
<https://raw.githubusercontent.com/datamllab/rlcard/master/rlcard/models/doudizhu_rule_models.py>
(2026-09-04). Its entire decision procedure: **when leading, combine the hand into candidate
plays and lead the minimum card in any valid one; when following, match the target's combination
type at the lowest legal rank, or pass if none exists (with a small random branch for the
landlord role).** It does not track which cards have been played, does not hold bombs
strategically, and has no endgame branch. This is not "the easy difficulty setting" of a
difficulty ladder RLCard ships — **it is the only rule-based agent RLCard has**, sitting between
a uniformly-random agent (`random_agent.py`) and the learned DMC/DouZero agent as the toolkit's
three-point scale for *how AI research itself* stratifies strength in this exact game family:
random < naive-heuristic < learned. Confirmed on the sibling game UNO the same way —
`UNORuleAgentV1` (fetched from
<https://raw.githubusercontent.com/datamllab/rlcard/master/rlcard/models/uno_rule_models.py>,
2026-09-04): draw if forced, play a wild-4 with the majority colour if available, otherwise
**pick uniformly at random among the non-wild legal plays**. Neither rule agent has an
"aggression" or "randomness" *dial* — the weak tier's behaviour is structurally different from
the strong tier's, not a turned-down copy of it.

### 3.2 What a real weak commercial bot looks like from the outside, and why it reads as broken rather than weak (T3, single source, but concrete and directly on point)

A first-hand teardown of a shipped mobile Euchre app's bot, written by a player who reverse-
engineered its behaviour by exploiting it: the bot "will always lead out trump even when that
actively hurts your odds," "will come in swinging with its biggest card" when a smaller one
would do, and critically "doesn't remember what cards it's already seen" — it re-scores every
card from a fixed per-card table on every decision, with no state carried between decisions.
<https://www.jjanusch.com/2025/05/poor-game-ai> (fetched 2026-09-04). This is a single blog
post, not a designed study, but it is the one primary-observation source in this research of
what "no counting, mechanical policy" actually looks like from a human opponent's seat: not "a
beatable beginner" but **exploitable in a way that stops feeling like an opponent at all**, once
the pattern is learned. This is the sharpest available answer to the brief's "what makes a weak
bot feel like a weak player instead of a broken one" — and the answer is *not* "plays worse
cards," it's "has no memory of the hand in progress."

### 3.3 The Hearts literature explicitly names two tiers by policy content, not by a knob (T2 — summarised, full PDF text not extractable)

A bachelor's thesis on reinforcement learning for Hearts (Rijksuniversiteit Groningen,
<https://fse.studenttheses.ub.rug.nl/15440/1/Bachelor_Thesis_-_Maxiem_Wagen_1.pdf>) builds its
baselines as two named, structurally different agents rather than one agent at two settings: a
**"Weak Heuristic Agent"** (search-summary: one variant always plays its highest card below the
current winning card to intentionally lose the trick, the opposite variant always plays lowest-
above to intentionally win it — two fixed, opposite, context-blind rules) versus a **"Strong
Heuristic Agent"** that follows roughly twenty hand-coded rules derived from published Hearts
strategy and — specifically — plays to create **voids** (deliberately emptying a suit early so a
dangerous card, the Queen of Spades, can be dumped safely later). The PDF's raw text could not be
extracted by this research's tools (confirmed: attempted direct fetch and local read both
failed), so this is reported as a T2 search-engine synthesis of the source, not a verified
verbatim quote — but the shape of the finding (two named agents differing in *what they model
about the game*, not in a shared model's aggressiveness) is corroborated by everything else in
this section.

### 3.4 The academic dynamic-difficulty literature explicitly names this same split, and criticises the knob (T1/T2, mixed)

Robin Hunicke's "The Case for Dynamic Difficulty Adjustment in Games" (ACM SIGCHI ACE 2005,
<https://dl.acm.org/doi/10.1145/1178477.1178573>) is the field's founding statement that
difficulty should track player skill rather than a fixed setting — found and correctly attributed
but not fetched in full (T2 for its exact text). What was fetched in full is Wikipedia's article
on the resulting technique family, **Dynamic game difficulty balancing**, which draws a clean
line between the two approaches this research was specifically asked to test:

> "Parameter Manipulation: [...] the player gets more weapons, recovers life points faster, or
> faces fewer opponents. [...] Although this approach may be effective, its application can
> cause implausible situations." versus "Behavior Modification" via techniques like *dynamic
> scripting*, which "assigns to each rule a probability of being picked" from a rule set — i.e.
> changing *which* tactic the AI reaches for, not a shared tactic's intensity.
<https://en.wikipedia.org/wiki/Dynamic_game_difficulty_balancing> (fetched 2026-09-04)

The same article's canonical bad-parameter-manipulation example is racing-game rubber-banding:
"the AI driver's vehicles becoming significantly faster when behind the player's vehicle, and
significantly slower while in front" — the criticised pattern is specifically a same-policy
intensity dial that produces behaviour with no in-fiction justification, which is exactly the
shape of failure an aggression/unpredictability-only difficulty axis risks. The underlying
technique the article credits, **dynamic scripting** (Spronck et al., "Difficulty Scaling of Game
AI," <https://spronck.net/pubs/SpronckGAMEON2004.pdf> — located and correctly attributed, but the
PDF would not extract cleanly through this research's tools and so is reported at T2, via search
synthesis rather than a direct quote) works by biasing **which rule from a rule-base gets
selected**, not by adding noise to one rule's output. Every independent source in this section —
RLCard's actual code, the Hearts thesis, and the DDA literature — agrees on the same shape: a
real difficulty ladder is built from **different rules being available or selected**, and a
same-policy randomness/aggression dial is the thing the literature specifically warns produces
implausible or exploitable behaviour when it's asked to do that job alone.

### 3.5 Believable-bot research: passing as human is a different bar from being weak (T1, abstract-level)

The 2K BotPrize line of work (Philip Hingston, "A Turing Test for Computer Game Bots," and the
BotPrize competition it spawned) judges bots on whether human observers mistake them for humans,
independent of skill — <https://www.semanticscholar.org/paper/A-Turing-Test-for-Computer-Game-Bots-Hingston/61e972ce10138b742825b851c35a04155bbc34ae>
and coverage confirming MirrorBot's 2012 win via "Human-inspired Mirroring Behavior"
(<https://www.researchgate.net/publication/261452209_MirrorBot_Using_Human-inspired_Mirroring_Behavior_To_Pass_A_Turing_Test>),
found via search, abstract-level only — is evidence that "reads as human" and "plays well" are
separately judged properties, and the winning technique in that line of research was imitating
recorded human behaviour rather than tuning a strength parameter. This is suggestive rather than
conclusive for a card game (BotPrize is a first-person shooter benchmark), and is reported here
at that weight — not as a card-game-specific finding.

### 3.6 Not found for Part B

- No public source (game-AI-specific or academic) was found describing how a **named consumer
  Big Two, Tien Len, or Murlan app** specifically constructs its easy/medium/hard bots — these are
  closed-source, same limitation §5 of the seat-holds research (2026-09-03) hit for consumer
  party games.
- No source was found describing an AI's exchange-phase (or Daifugo/President-equivalent)
  specific hand-replanning logic, in code or in writing — confirming §2.3's gap from the other
  direction: nobody publishes this for the human side or the AI side.

---

## 4. Checking the research against what the engine actually does

Re-reading §1 against §2–3: the news is better than the "gut feeling" framing of the original
ticket worried it might be.

- **The `AIDifficulty` tiers are already a worse-policy ladder in the sense §3.1–3.4 describe,
  not a same-policy dial.** Card counting (`playedRanks`, `takesTheRound`) exists in `hard` only.
  Held-card protection (the `conservative` filter excluding 2s/jokers) exists in `hard` only.
  Endgame-specific branching (`near3`, the `myCards <= 4` responder branch) exists in `hard`
  only. `medium` adds bomb-saving and large-hand multi-dumping that `easy` lacks. `easy` is,
  structurally, exactly RLCard's `DouDizhuRuleAgentV1`/`UNORuleAgentV1` shape from §3.1: pick the
  cheapest legal thing, no memory, no protection. That is a genuine, sourced "weaker AI is a
  worse policy" ladder already built into the engine before any personality knob is applied.
- **`aggression`/`unpredictability` are correctly scoped as a second, flavour axis, not the
  difficulty axis** — and their existing polarity across personalities already matches §3.1/3.3:
  `unpredictability`'s effect (swap to a uniformly-picked same-shape alternative) is structurally
  the same move as RLCard's random-agent/weak-heuristic baselines, and the roster gives the
  lowest-tier personality the highest unpredictability while the top-tier personality gets
  near-zero — consistent with "weak play looks more like random legal play" rather than
  coincidence. What the DDA literature (§3.4) specifically warns against is asking a knob like
  this to *manufacture* the ladder on its own; #904's plan does not do that — it inherits the
  ladder from the tier and uses the knobs only within a tier, which is the right order per every
  source here.
- **One-personality-per-tier is therefore a sound choice of axis**, contingent on the acceptance
  criteria's own check: `scripts/measureHeadsUpBalance.ts` showing a real, monotonic spread. §3.1
  and §3.4 both predict that spread should exist, because the tiers differ in kind, not degree —
  if the measured spread came out flat or non-monotonic despite that, it would mean the
  *personality* knobs chosen for the three kept bots are fighting the tier's own separation (e.g.
  a very low-aggression `hard` personality declining to use the counting/holding advantage its
  tier gives it), which is a tuning question the measurement script is already positioned to
  catch — not evidence the tier axis is wrong.
- **One real risk this research surfaces that the ticket does not currently ask about**: §3.2's
  Euchre teardown and §3.4's "implausible situations" warning both describe the same failure
  mode — a policy that is *simple* rather than *humanly weak* reads as broken once a player
  notices the pattern, not as "an easy opponent." `easy`'s policy (line 831–833) is exactly the
  minimal, no-memory, always-cheapest shape §3.1's `DouDizhuRuleAgentV1` and §3.2's teardown
  describe. That is defensible as *a* correct easy-tier design — it is what the sourced weak
  baselines in this research actually look like — but it is worth naming explicitly rather than
  assuming a low win rate against it automatically reads as "a believable weak human" instead of
  "a bot that always dumps its lowest card." Nothing in this research says it currently reads as
  broken; nothing in this research was able to check that either, since it's a playtest question,
  not a literature question.
- **What the engine does not express, and what #904 should not try to smuggle in**: §2.3 and
  §3.6's exchange-planning gap is real on both the human-strategy side and the AI side, and
  `aiChoosePlay` has no code path that treats a hand differently because of what was just given
  or received in the exchange. Per the ticket's own "Not this ticket" section, the exchange
  mechanic itself is closed (#882) — but *AI awareness of having just been exchanged with* is a
  distinct, unaddressed question this research turned up rather than one that was already ruled
  out, and it is not sourced well enough anywhere (§2.3, §3.6) to design against right now. That
  is a legitimate candidate for its own future ticket, not a gap to close inside #904.

---

## 5. What this means for #904

**Is one-personality-per-strategy-tier a sound difficulty ladder?** Yes, on the evidence this
research found. Every primary or near-primary source on how shipped/academic card-game AI
actually separates difficulty (RLCard's rule agents, the Hearts weak/strong heuristic split, the
DDA literature's parameter-vs-behaviour distinction) says the same thing: a real ladder comes
from *different capabilities being present or absent* — counting, holding, timed emergencies,
endgame awareness — not from a shared policy's aggressiveness turned up or down. Checked against
`lib/gameEngine.ts` directly, that is already how the three `AIDifficulty` tiers differ from each
other, independent of any personality knob. The ticket's roster choice (one personality per tier)
is therefore picking the right axis, not the "gut feeling" the owner's instruction was worried
about — the gut-feeling risk was in *which three personalities and which knob values*, not in the
tier-per-bot structure itself, and that narrower question is exactly what
`measureHeadsUpBalance.ts`'s monotonic-spread requirement in the existing acceptance criteria is
built to catch.

**Does the current engine need a different axis, or more than it has?** Not for the ladder
itself — see §4. It is missing something adjacent that the ticket correctly keeps out of scope:
exchange-phase-aware hand replanning (§2.3, §3.6, §4's last bullet). That gap is real, under-
sourced on both the human and the AI side, and belongs in its own ticket rather than being
absorbed into a difficulty-roster change.

**What could not be sourced, stated plainly:**
- Concrete tactical rules for *holding a 2/joker specifically* (as opposed to "high cards"
  generally) and for *passing while holding a legal play* (as opposed to "you may always choose
  to") — searched for directly, not found beyond the general principle.
- Any exchange-specific next-hand planning rule, for a human or an AI, in this game family or in
  President/Daifugo.
- How any specific named consumer Big Two/Tien Len/Murlan app tunes its own easy/medium/hard
  bots — closed source, consistent with the same limitation in the 2026-09-03 seat-holds
  research.
- Full verbatim text of the Hearts thesis and the Spronck difficulty-scaling paper — both located
  and correctly attributed, neither extractable by the tools available to this research; both
  reported at T2 rather than T1 as a result.
