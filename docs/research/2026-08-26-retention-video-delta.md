# What the UX-psychology video adds over research we already have

Research date: 2026-08-26. This is evidence, not a decision.

**Source under review.** [uxpeak, *The UX Psychology Behind Apps People Can't Stop
Using*](https://www.youtube.com/watch?v=2TlIg3VokY8), July 2026. The video itself is not
machine-readable; the transcript was read via
[sozai.app](https://sozai.app/transcript/ux-psychology-behind-addictive-apps/) and
cross-checked against [youtubesummary.com](https://youtubesummary.com/summary/2TlIg3VokY8),
which agree on all six principles, their order, and their examples.

**Read `docs/research/what-makes-a-game-memorable.md` first.** That document (August 2026,
for #137) already judged the full retention toolkit against the owner's own fence — *"not
invasive, cool for the user"* — with primary sources fetched: Clark et al. (Neuron 2009),
Zagal et al. (2013), Ryan/Rigby/Przybylski (2006), Swink (2008), Nijman (2013), Ghibellini
& Meier (2025). This document does not repeat it. It asks one narrow question: **does the
video contain anything that document did not already judge?**

---

## Bottom line

**Two of the six principles are new. One is already shipped. Three were already judged, and
two of those were judged and rejected on measured evidence.**

The video is a *conversion-funnel* document — signup walls, onboarding forms, pricing pages,
upgrade prompts. Murlan has none of those surfaces. Its retention lives in the hand-to-hand
loop, which the video never addresses.

| # | Principle | Status against the existing research |
|---|---|---|
| 1 | Smart defaults / decision fatigue | **New.** Not in §7's toolkit at all |
| 2 | Goal gradient, "never start at zero" | **Half judged.** The cumulative-count half passes (§7, weakened streaks). The *manufactured* head start is new, and is the same mechanism as a technique §7 fails |
| 3 | Reciprocity — value before signup | **Already shipped.** Offline play needs no account (`app/index.tsx:453`, `:510`) |
| 4 | IKEA / endowment effect | **Shipped, but the *timing* insight is new.** §7: *"Cosmetic choice — Pass. Already shipped and already correct (`lib/cosmetics.ts`)"* |
| 5 | Loss aversion | **Judged and failed, twice**, with a measurement |
| 6 | Contrast / anchoring | **Does not apply.** No pricing surface exists |

The net contribution is principle 1, and the timing half of principle 4.

---

## 1. Where the video and the existing research disagree, and who is right

The video's principle 5 is its sharpest tool. Its examples are a countdown on files about to
be deleted, and an *"I'll risk it"* dismiss button. `what-makes-a-game-memorable.md` §7 fails
this class twice, and not on taste:

> **Near-miss framing.** Clark et al. measured it directly: near-misses are rated *less
> pleasant* than full misses while *increasing* the desire to continue, and the effect only
> appears when the player felt they had control ([Neuron 61(3):481–490,
> 2009](https://pubmed.ncbi.nlm.nih.gov/19217382/)). A technique that lowers enjoyment and
> raises play is the precise inverse of "cool for the user".

That is the whole disagreement in one citation. The video optimises a conversion number; the
existing research optimises whether *a player who quit forever would feel the game had treated
them well*. Where they conflict, the measured result wins.

**Owner's decision, 2026-08-26: in-game stakes only.** Murlan already contains real loss — a
manche lost, points conceded, a bomb spent badly. Surfacing that honestly is legitimate and
is largely unbuilt. Manufacturing loss outside the game — breakable streaks, decay timers,
return-nagging pushes — is not to be built. This confirms §7 rather than changing it.

---

## 2. Principle 1 — decision fatigue. The one genuinely new lever.

The video's example is a booking form with five empty fields, fixed by pre-filling the common
choice. Its cited evidence is the Iyengar & Lepper jam study (24 options → 3 % purchase;
6 options → 30 %).

**The lobby half is already done.** `app/lobby.tsx` opens at 2 players (`:139`),
free-for-all (`:140`), `matchLength: "match"` (`:141`), and assigns bot personalities by
rotation rather than asking (`:163`). A player who touches nothing gets a playable game.
There is no work here.

**The in-play half is untouched, and it is the larger surface by far.** A dealt hand is 13–21
cards. `getAllValidPlays` (`lib/gameEngine.ts:411`) routinely returns dozens of legal
combinations — the enumeration is so redundant that #215 exists because one rank alone can
contribute six identical pairs. **The game computes this list on every turn, for the bots, and
never shows the player anything derived from it.**

That is the decision-fatigue surface: not a form, a hand. And it lands exactly on an existing
open question.

> #129, *What counts as a good play, and can the game say so*: *"`lib/gameEngine.ts` knows
> every legal move. Nothing anywhere ranks them."*

#129 asks the question retrospectively — can the game tell you, after a hand, that you played
well. Principle 1 asks it prospectively — can it reduce the field *before* you choose. **They
need the same underlying answer, and #129's first checkbox is the gate on both:** *"Is there a
defensible notion of a good play in Murlan at all? Answer this first and be willing to answer
no."*

Two forms are worth distinguishing, because they carry very different risk:

| Form | What it is | Risk |
|---|---|---|
| **Legality surfacing** | Dim or group the cards that cannot legally be played this turn | **None.** It is a restatement of the rules the server already enforces. It removes no decision, only the illusion of one |
| **Quality ranking** | Suggest which legal play is *best* | **High.** This is #129's warning verbatim: *"A confident wrong opinion shown to a player is worse than no opinion"* |

Legality surfacing does not need #129 answered. Quality ranking cannot be built until it is.

---

## 3. Principle 2 — "never start at zero", and where the line falls

The video's mechanism is the Nunes & Drèze car-wash study: loyalty cards issued with two
stamps already filled completed at nearly double the rate of cards needing fewer total stamps.
The advice is *"Find something they've already done and count it."*

`what-makes-a-game-memorable.md` §7 already passes the honest form of this:

> **Streaks** — the strong form (a streak that can be **broken**) fails; the weak form (a
> **cumulative count that only goes up** — hands played, matches finished) passes. *"A count
> that cannot be lost cannot generate obligation."*

So the *counter* is already sanctioned. What the video adds is the **framing trick**, and the
trick is where it gets uncomfortable: a pre-filled stamp the player did not earn is
manufactured progress, which is the same class of mechanism §7 rejects in principle 5.

**The honest version, and it is genuinely available here.** Murlan does not need to invent a
head start — a new player earns real facts within one hand: cards played, a manche finished, a
first bomb. `lib/achievements.ts` already ships ten of them, `first_win` among them. The
work is to *count what actually happened early and show it*, not to award a stamp for nothing.

Relevant closed work: #132 (*the result screen throws away everything it knows*) and #133
(*the profile shows lifetime averages and no trend*) both landed. Whether they left a new
player looking at zeroes is a question for a device pass (#413, #97), not a source read.

---

## 4. Principle 4 — endowment. Shipped, but the timing is new.

`lib/cosmetics.ts` ships card backs and table felts (`CARD_BACK_IDS`, `TABLE_FELT_IDS`,
defaults `smeraldo` / `verde`), and §7 already passes it: *"Nothing. Already local-only, not
server state, not sold."*

The video's addition is **ordering**: Duolingo asks for language, goal and a first lesson
*before* it asks for an account, and relabels the signup button *"Continue"*. Applied here:
a player who has already chosen their felt and card back has built something, and #343
(*Profile becomes the one place for who you are and how it looks*) is the ticket that owns
that surface.

`setCosmetics` writes locally, so the ordering is technically free — this is a routing
question, not a storage one. Worth confirming against #343's design rather than assuming.

---

## 5. What the existing research says is actually undone

This is the part the video cannot see, and it matters more than anything above.
`what-makes-a-game-memorable.md` §8 ranks eleven feel changes by identity-and-satisfaction per
unit cost. A source scan on 2026-08-26 finds **the top of that list unbuilt**:

| Rank | Change | Cost | Built? |
|---|---|---|---|
| 1 | **Hit-stop at the landing frame** (~90 ms, hung off `impactDelayMs()`) | XS | ❌ no match for `hitStop` / `freezeFrame` anywhere |
| 2 | **The beaten combination reacts** — `pileState.prev` flinches as the new card lands | S | ❌ |
| 6 | **Tiered trauma shake**, decaying, reduce-motion-gated | S | ❌ no match for `trauma` |
| 7 | **Squash on land** | XS | ❌ (only unrelated uses of the word) |
| 9 | **Permanence** — the last few plays persist longer | M | ❌ |

Ranks 1 and 7 are **XS**. The document's own bottom line:

> The strongest lever available to this game is the one it already owns: **the moment. Not a
> retention mechanic.**

Two XS changes sitting undone, on the list the research ranks first, is a larger available win
than anything the video proposes. #101 (*What a bomb feels like: the language of big moments*)
is the open ticket they feed.

---

## 6. On "gimmicks no one else has"

The video contains none. Its six principles are the standard conversion toolkit and every
competitor already runs them.

Differentiation has to come from what Murlan uniquely holds, and the source scan says it holds
three things its category does not:

1. **`lib/replay.ts` reconstructs full state at any point in a finished manche**
   (`replayStateAt(replay, index)`), persisted in `matchReplays` for `REPLAY_RETENTION_DAYS =
   14`. Almost no mobile card game keeps this. It is the substrate for post-hand analysis,
   shareable moments, and "what should I have played" — and #129 already names it as ground
   truth.
2. **The exchange ritual between hands** — loser gives their best card, winner returns one.
   It is a dramatic beat the Big Two family mostly lacks, and it currently renders as a form.
   `components/ExchangeModal.tsx` and `components/ResultExchangeOverlay.tsx` are both plain
   panels; #388 is about one of them not fitting on a phone.
3. **Bombs**, which #101 exists to make feel like something.

None of these needs a new system. All three are polish on mechanics that already ship, which
is the same conclusion §8 reached by a different route.

---

## Explicitly unverified

- The Iyengar & Lepper and Nunes & Drèze studies are quoted as the video presents them. Neither
  primary paper was fetched for this document. The jam study in particular has a contested
  replication record; nothing here rests on its effect size.
- Whether a new player currently sees zeroes on the result or profile screens is **not**
  established. #132 and #133 landed; their output was not read on a device.
- The competitive claim in §6.1 ("almost no mobile card game keeps this") is a judgement from
  general knowledge, not a survey. A store survey was attempted and returned nothing usable.
