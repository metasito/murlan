# What makes a card game worth coming back to — research pass, August 2026

Research-only document for #137. Nothing here was implemented. Every source was fetched from
its primary host on **2026-08-20** unless a different date is given; the two academic PDFs
(Swink ch. 1, Zagal et al.) were read in full rather than summarised from search results.
Anything I could not confirm against a primary source is collected under
[Explicitly unverified](#explicitly-unverified) and flagged inline as **[UNVERIFIED]**.

Read alongside `docs/research/rendering-stack-2026.md` (the budget every recommendation here
must fit) and `docs/research/game-audio-2026.md` (the sound half of every moment described).

---

## Bottom line

- **The strongest lever available to this game is the one it already owns: the moment.** Not a
  retention mechanic. Swink's decomposition explains why — *polish* changes how a game feels
  without changing what it does, and to the player "simulation and polish are indistinguishable"
  ([Swink 2008, ch. 1](#s-swink)). Murlan's simulation is already correct and server-authoritative.
  Everything the owner is unhappy about lives in the polish layer, which is the cheapest layer
  to change and the only one with no rules risk.
- **Murlan's palette is already restricted. That is exactly the problem.** Counting colour
  tokens actually used across `GameTable.tsx`, `components/table/*` and `CardView.tsx` gives
  green + a gold alpha scale + paper white + the two suit inks + one bomb red. That is a
  disciplined palette by any textbook measure — and it is also *the* stock palette of every
  premium card app on both stores. **Restriction alone does not buy identity; a restriction
  that is specific does.** Green-and-gold is taken. See [§3](#3-colour-and-light-as-identity)
  and the [palette recommendation for #98](#the-palette-recommendation-for-98).
- **The recommendation for #98 is not a new hue set. It is a light source and a third material.**
  Commit to the *physical, cloth-over-wood, single warm overhead lamp* literally: one colour
  temperature for the whole scene, a real falloff from a hot centre to a near-black rim, and a
  wooden rail at the table's edge. Wood is the differentiator, because no competitor has it and
  `lib/tokens.ts` has no brown in it today. Cost: token edits and one extra gradient. Zero bundle.
- **Nijman's *Art of Screenshake* is the highest value-per-byte document in this field, and
  roughly a third of its 30 tricks apply to a card game unchanged** — impact effects, hit
  animation, knockback, permanence, camera position, screen shake, *sleep* (hit-stop), and "more
  bass" ([Nijman 2013](#s-nijman)). Every one of them is `transform`/`opacity` on a handful of
  nodes. See the [ranked list](#8-the-ranked-list-of-feel-changes-with-costs).
- **On the owner's "mix of all worlds": the toolkit was researched in full and most of it fails
  the owner's own test.** Judged one at a time in [§7](#7-the-full-retention-toolkit-judged-one-at-a-time):
  **4 pass**, **3 pass only in a specific weakened form**, **7 fail**. The failures fail for a
  consistent, non-squeamish reason — they work by making *leaving* feel bad rather than making
  *playing* feel good, and the research literature says so in the authors' own measurements, not
  as an ethical opinion. The clearest single datum: gambling near-misses are experienced as
  **less pleasant** than plain losses while simultaneously **increasing the urge to continue**
  ([Clark et al. 2009](#s-clark)). A technique that reduces enjoyment and increases play is the
  exact definition of failing "cool for the user".
- **The honest retention lever has a name and thirty years of evidence: competence.** Ryan,
  Rigby & Przybylski found autonomy, competence and relatedness each *independently* predict
  enjoyment and continued play ([2006](#s-ryan)). Murlan is weakest on **competence feedback** —
  the game never tells a player they played well. #129 and #132 are already the right tickets;
  this report's contribution is that they are the *retention* work, not a nice-to-have.
- **Ending well is a retention feature, and the literature is more specific than the folklore.**
  The 2025 meta-analysis finds the Zeigarnik memory effect does **not** replicate, while the
  Ovsiankina resumption effect does, at a weighted resumption rate of roughly two-thirds
  ([Ghibellini & Meier 2025](#s-ghibellini)). Translation for #57 and the result screen: you do
  not need to leave a player *hanging* to make them come back — you need to leave an interrupted
  thing they can *resume*. A match to a points target is already exactly that shape. See [§5](#5-session-shape).

---

## 0. What this repo has already decided — not re-derived here

| Decision | Where | Consequence for this report |
|---|---|---|
| No Skia in the web bundle; `react-native-svg` + Reanimated 4; `transform`/`opacity` only, <~100 animating nodes, <~1 MB gzip | #95, `docs/research/rendering-stack-2026.md` | Every recommendation below is costed against this and nothing here needs a shader or a particle engine |
| Effects from the Sonniss GDC bundle; music CC0 Tallbeard/Abstraction; Opus not MP3; **91 % of mobile players play with sound off** | #96, `docs/research/game-audio-2026.md` | No moment may carry state in audio alone. Every recommendation here is legible silent |
| Ads (#60), real-money play (#65), a generic achievements framework (#63) — rejected | #60/#65/#63 | Not reopened. Not mine to reopen |
| No new progression systems: no XP, unlocks or seasons | #94 scope fence | Rules out a whole column of the toolkit before it is judged on merit — noted where it applies |
| Free / CC0 only | #94 | Nothing recommended costs anything |
| Art direction unconstrained — a better look beats consistency | #94 | §3 is allowed to propose re-cutting `lib/tokens.ts` |

---

## 1. Game feel primitives that make a single action satisfying

### 1.1 Swink's decomposition, and why it matters that the simulation is already right

Steve Swink's *Game Feel: A Game Designer's Guide to Virtual Sensation* (Morgan Kaufmann, 2008,
ISBN 978-0-12-374328-2) builds its definition in three steps, quoted from chapter 1:

> Game feel, as experienced by players, is built from three parts: real-time control, simulated
> space and polish.

and arrives at:

> **Real-time control of virtual objects in a simulated space, with interactions emphasized by polish.**

His definition of the third block is the operative one for this ticket:

> Polish refers to any effect that **artificially enhances interaction without changing the
> underlying simulation**. […] If all polish were removed, the essential functionality of the
> game would be unaltered, but the player would find the experience less perceptually convincing
> and therefore less appealing. **This is because — for players — simulation and polish are
> indistinguishable.**

He backs it with De Blob's squash shader, quoting Joost van Dongen: *"Without the squash-shader,
the game feels like playing with a ball made of stone. Then with no changes to the physics at
all, the squash-shader makes it feel much more like a ball of paint."*

**Why this is the single most important paragraph in this report for Murlan.** `lib/gameEngine.ts`
is specified by `docs/RULES.md`, the server validates every move, and CLAUDE.md forbids changing
the rules except through `docs/BRIEF.md` §3.1. The owner's complaints — *"not premium"*, *"bomb
effects should be more refined"*, *"cues should convey messages better"* — are **all** polish-layer
complaints, and the polish layer is by Swink's own definition the one that can be changed without
touching the simulation at all. The entire wishlist is reachable without a single rules risk.

The corollary is the warning: because polish and simulation are indistinguishable *to the player*,
a polish bug reads as a rules bug. A card that appears twice mid-flight is not a cosmetic defect,
which is presumably why CLAUDE.md pins "a card appears exactly once" as an invariant.

### 1.2 Nijman's 30 tricks, filtered for a card game

*The Art of Screenshake*, Jan Willem Nijman (Vlambeer), INDIGO Classes 2013, Utrecht. The talk
takes a plain platform shooter and layers **30 tiny tricks** onto it one at a time, each
demonstrated live, until the same game is unrecognisably better. The full list in order:

> basic animations and sound · lower enemy HP · higher rate of fire · more enemies · bigger
> bullets · muzzle flash · faster bullets · less accuracy · impact effects · hit animation ·
> enemy knockback · permanence · camera lerp · camera position · screen shake · player knockback ·
> **sleep** · gun delay · gun kickback · strafing · shell casings · more bass · super machine gun ·
> random explosion · faster enemies · more enemies · higher rate of fire + camera kick · bigger
> explosions · more permanence (smoke) · meaning (mortality) and death animation · balancing

Roughly two-thirds are shooter-specific. **Ten transfer to a card game essentially unchanged**,
and all ten are `transform`/`opacity`:

| Nijman's trick | The Murlan translation | Nodes |
|---|---|---|
| Impact effects | Something happens *where the card lands*, not just to the card | 1–6 |
| Hit animation | The **beaten** combination reacts to being beaten | 1–5 |
| Knockback | The pile is nudged by the card landing on it | 1 |
| **Sleep** (hit-stop) | The table holds still for ~2–5 frames at the moment of impact | 0 |
| Permanence | Evidence of what happened stays on the table | already partly present via `pileState.prev` |
| Camera position / kick | The whole table container translates a few px on a big play | 1 |
| Screen shake | Same node, decaying, tiered by importance | 1 |
| More bass | The bomb's low end, not its volume | 0 (mix) |
| Meaning | The moment matters because losing is possible and visible | 0 |
| Balancing | Judged at the 50th bomb, not the first | 0 |

**"Sleep" is the cheapest and least-used trick in the list, and it is free here.** In an engine
it means dropping `time_scale`; in Murlan it means *not advancing the pile for ~90 ms at the
landing frame* — a delay on an existing chain, zero new nodes, zero bundle. It is the trick that
most reliably converts "the card moved" into "the card *hit*".

### 1.3 The layering rule, and the ceiling

The `game-feel` skill's core claim — one satisfying impact is **5–8 tiny responses inside ~100 ms**,
each cheap, stacked to read as weight — is the design shape for #101's tier table. Its two
governing rules are the ones to carry over verbatim:

1. **Exaggerate briefly and return to rest.** Juice is transient. Permanent exaggeration becomes
   the new normal and stops reading as feedback at all.
2. **Scale to importance.** A card *selection* is not a bomb. The skill's `small / medium / large`
   preset table is the right skeleton for #101's five tiers.

Murlan already has the timing infrastructure this needs and it is better than most: `Motion.spring`
distinguishes `pickup` (damping 37, stiffness 340 — critically damped, so a card arrives under
the finger without ringing) from `land` (damping 21, stiffness 260 — one ~7 % overshoot, second
bounce invisible). That is precisely the ease-out-vs-overshoot distinction in the skill's easing
table, already derived from the physics and already commented. **The tokens are ahead of the
usage.** A meaningful part of #101's work may turn out to be *using what `lib/tokens.ts` already
defines* rather than defining anything new.

### 1.4 The invariant that makes all of this safe

`impactDelayMs()` in `components/gameTableModel.ts` derives the feedback delay from
`FLIGHT_MS = 380` and `LANDING_FRACTION = 0.82` — 312 ms — and returns **0** under reduced motion
because the flight is skipped entirely. This is the "the lock" requirement in #101 already solved:
audio, haptic and visual cannot drift apart because there is one derivation. Every effect in
[§8](#8-the-ranked-list-of-feel-changes-with-costs) is specified to hang off it.

---

## 2. What makes a game memorable rather than merely sticky

### 2.1 The distinction, stated precisely

Sticky = the player returns. Memorable = the player can *describe it to someone else a year later*.
They are different variables and they are only weakly correlated: the most-played mobile genres are
also the least-described. The mechanism behind memorability is **compression** — a memorable game
has a small number of loud, consistent signals that survive being reduced to a screenshot, a
five-second clip, or a sentence.

### 2.2 The Balatro case, with the numbers

Balatro is the honest counter-example to "you need a budget", and it matters here because it is
**explicitly a Big Two derivative** — the same family as Murlan.

| Fact | Value | Source |
|---|---|---|
| Released | **2024-02-20** | [Steam](#s-balatro-steam) |
| Developer | LocalThunk, **solo**, ~2.5 years | [Wikipedia](#s-balatro-wiki) |
| Copies sold | **>5 million** as of 2025-01-21 | [Wikipedia](#s-balatro-wiki) **[UNVERIFIED — publisher figure, not audited]** |
| Awards | Best Independent Game, Best Debut Indie, Best Mobile (TGA 2024); Game of the Year + 4 awards (GDCA 2025); BAFTA Best Debut | [Wikipedia](#s-balatro-wiki) |
| Music | **Five tracks**, all in **7/4**, by Luis Clemente (LouisF), hired on Fiverr in 2023 | [Balatro Wiki](#s-balatro-music) |
| Track construction | All five share **the same basic composition**, differing in soundfont and melodic variation; each ~2:53 slowed to 70 % → ~4:07 in game, so they cross-fade seamlessly | [Balatro Wiki](#s-balatro-music) |

**The lesson is not "five tracks is enough."** It is *why* five is enough: they are five variations
on one idea, so every one of them reinforces the same memory rather than diluting it, and the
unusual metre makes that one idea unmistakable. A player who has heard Balatro can hum it. That is
memorability produced by **constraint**, and it cost one Fiverr commission.

This is directly load-bearing for #113, which already scopes to *one menu loop, one in-hand bed,
one win/lose cue, one pitch-shifted variant*. **That scope is right, and this is the evidence for
it.** The addition this report makes: the four should be *variations of one another*, not four
different pieces of music. #96 already chose "chill card-room music that anyone would accept" —
the risk in that direction is producing something universal *and forgettable*. The mitigation is
not a stronger theme (the owner ruled that out); it is making the four cues share a motif, so
repetition compounds instead of scattering.

### 2.3 Consistency of world is what makes a signature moment possible

A signature moment only reads as signature against a consistent background. The bomb cannot feel
like an event if the table is already busy. This is a **budget argument, not a taste argument**:
every effect spent on an ordinary turn is subtracted from what a bomb can spend, because the
player calibrates against what they have just seen. #101's "repeat tolerance at the fiftieth bomb"
requirement is the same constraint viewed along the time axis.

The practical rule for #98/#99/#101: **decide the resting state first and make it quiet.** Turn
cues (#99) are the highest-frequency signal on the table, so they are the thing most likely to
eat the bomb's headroom. They should be the *calmest* effect in the game, not the most attention-
grabbing — a claim that is testable against #97's "can you tell at a glance, without looking
directly at it, that it is your turn?"

---

## 3. Colour and light as identity

### 3.1 The mechanism

Games that are recognisable in a single screenshot restrict the palette **and then attach the
restriction to something structural**:

- **Mirror's Edge (DICE, 2008)** — a white city with saturated colour reserved almost entirely for
  interactable geometry, so the palette *is* the navigation system, not decoration
  ([Game Developer](#s-colour-gd), [World of Level Design](#s-colour-wold)).
- **Journey (thatgamecompany, 2012)** — a warm golden-orange scheme, shifted deliberately across
  the arc so colour carries the emotional structure with no text ([Game Developer](#s-colour-gd)).

In both, the restriction is *specific to that game's problem*. That is the part that transfers.

### 3.2 The measurement of where Murlan actually stands

Counted from source (`components/GameTable.tsx`, `components/table/*.tsx`, `components/CardView.tsx`),
the tokens the table actually draws with are: `gold` and its five-step alpha scale (55 uses between them),
`text`/`textSecondary`/`textMuted`, `cardPaper`/`cardInk`/`cardEdge`, `spade`/`heart`/`diamond`/`club`,
`bombText`/`bombFill`, the felt, and the overlays. `Colors.info` (the one cool blue) is **not used
on the table at all** — it appears only in `app/(online)/room.tsx` as team B's colour and in
`NotificationBanner.tsx`.

**So the table's palette is already restricted and already coherent.** Any recommendation premised
on "there are too many colours" would be wrong, and I checked before writing it.

### 3.3 The actual finding

Green felt + gold trim + warm-white cards is the single most common premium-card-app palette in
existence. It is restricted, it is tasteful, and it is **generic** — which is precisely the owner's
complaint (*"a competent but generic premium card app"*, #98's own framing). Restriction bought
coherence and bought no identity, because the restriction is not specific to Murlan.

Two things are missing, and neither is a hue:

1. **A light source.** `FeltGradients.verde` runs `#0F5A35 → #061E12`, light centre to dark rim —
   the correct *structure* for an overhead lamp, but it reads as a vignette rather than as a lamp,
   because nothing else in the scene agrees that there is a lamp. Real lamplight has a **colour
   temperature** and it lands on *everything*: the felt is warmer where the light pools, card
   edges facing up catch a rim of it, faces away from it fall into shadow. Today gold is a
   *decorative* colour applied to borders. **Gold should be the colour of the light.**
2. **A third material.** The brief says *cloth over wood*. There is no wood in `lib/tokens.ts` —
   not one brown. The scene is currently cloth and metal, floating with no edge and no furniture.

### The palette recommendation for #98

> **Do not replace the hue set. Light it, and add the wood.**
> Identity comes from the *specificity* of the restriction — and "green cloth over a wooden table
> under one warm lamp" is a specific, physical, culturally-true claim that no competitor makes,
> whereas "dark green and gold" is a claim all of them make.

Concretely, in four moves:

**1 — Commit to one colour temperature.** Pick the lamp (a warm tungsten, ≈2700–3000 K in feel)
and make every lit surface agree with it. `Colors.gold #C9A84C` already sits in that family, so
this is mostly a matter of *role*, not of new tokens: gold stops meaning "the trim colour" and
starts meaning "the colour of light falling on something". Consequence for `lib/tokens.ts`: the
five-step alpha scale **survives intact** and gains a documented meaning — `goldGhost` is a
surface barely catching the lamp, `goldStrong` is one directly under it.

**2 — Re-cut the felt ramp as a real falloff.** Warm and brighten the centre stop, darken and
cool the rim, and widen the range so the table reads as *lit* rather than *tinted*. Something in
the neighbourhood of `['#1C6B3E', '#155434', '#0E4028', '#092D1C', '#051710']` for `verde` — the
exact stops are #98's call with #97's screenshots in hand, and the direction is what matters:
**more range, warmer centre, darker rim.**

> **This is safe to iterate on, which I verified rather than assumed.** `tests/contrast.test.ts`
> already measures every table text style against **every stop of every felt**, not just the
> middle one (`tests/contrast.test.ts:138–150`). So a re-cut that goes too bright fails the suite
> immediately instead of shipping. The constraint to respect is the one in the `FeltGradients`
> comment: the three alternates must stay at or below `verde`'s luminance at every stop, and
> raising `verde` keeps that true by construction.

**3 — Add the rail. One new material, three tokens.** A warm wood band at the table's outer edge —
a mid brown, a dark brown for the shadowed side, and a `goldSoft` catch-light along the top edge —
turns the felt from a background into a surface *on a piece of furniture*. This is the cheapest
identity move on the list and the only genuinely differentiating one. It is one more
`LinearGradient` and it costs nothing in bundle. It also directly serves #100: the rail is what
makes the notch band read as *table edge* rather than *dead space*.

**4 — Spend saturation on exactly two things.** The suit inks on card faces, and the bomb/royal
emphasis (`bombText`/`bombFill`, already deliberately outside the danger family — the token comment
says so). Everything else on the table is cloth, wood, lamplight and paper. This is what keeps the
bomb able to be loud.

**What this costs.** Token edits in `lib/tokens.ts`, one gradient component for the rail, and a
re-run of `tests/contrast.test.ts` and `tests/cosmetics.test.ts`. **Zero bytes of bundle, no new
dependency, no shader, nothing outside #95's budget.** The four card backs and four felts in
`lib/cosmetics.ts` all continue to work, because the change is to the ramps, not to the system.

**What it does not settle.** Type (Rajdhani/Inter) is genuinely a #98 call and this research gives
no evidence either way. Card *face* design is #125. The cultural-specificity direction #98 asks
for is a design question this report cannot answer from sources — but note that the wood-and-lamp
direction is compatible with it rather than competing, because a physical table is where a
culturally specific deck would sit.

---

## 4. Card-game-specific satisfaction: the six beats

What the best digital card games do at each beat, and what Murlan has today.

### 4.1 The deal

The deal is the game's first impression and the only moment where every player is guaranteed to be
watching. It must read as **one gesture**, not as a set of cards appearing. Murlan already gets
this right in principle: `Motion.stagger.deal = 42` with a comment explaining exactly that intent.
42 ms at 60 fps is ~2.5 frames between cards — fast enough to be a *sweep*, slow enough to be a
sequence. The open question is whether the deal *arrives* with weight (`Motion.spring.land`) or
merely fades in; that is a #97/#126 observation, not something I can determine from source.

### 4.2 Fanning and holding

Hearthstone's UI lead Derek Sakamoto opened his GDC 2015 talk with *"our game is UI"*
([GDC 2015-03-04](#s-hearthstone); [Game Developer, 2015-05-22](#s-hearthstone-gd)) — the point
being that in a card game the interface is not a layer over the game, it *is* the game, so
interface tactility is not polish-on-top but the primary product.

The beat that carries the most feel per byte here is **pickup**. A held card should arrive under
the finger with no wobble — which is `Motion.spring.pickup` (damping 37, stiffness 340,
critically damped), already defined and already correctly derived. Marvel Snap's most-cited
tactile touch is accelerometer-driven parallax on rare cards ([Marvel](#s-snap)) — native-only,
and worth noting as a **candidate for the `.native.tsx` split #94 already sanctions**, not as a
web recommendation.

### 4.3 Selecting

Selection is the highest-frequency interaction in the game, so it gets the *smallest* feedback in
the whole tier table — the `small` preset: a tick, a lift, nothing else. `hapticSelection()` already
exists in `lib/haptics.ts` and `card_select.mp3` already exists in `lib/sounds.ts`. The risk at this
beat is over-juicing: at maybe 40 selections a hand, anything with a hit-stop or a shake becomes
intolerable by the third manche. Nijman's list is instructive by omission here — he spends his
tricks on *impacts*, not on aiming.

### 4.4 The throw and the landing

This is the beat the owner named. The grammar from [§1.3](#13-the-layering-rule-and-the-ceiling)
applies in full: **anticipation → impact → aftermath**, with the impact at `impactDelayMs()` =
312 ms and everything landing on that frame.

The specific thing missing today, in Nijman's vocabulary, is **hit animation and knockback on the
receiving end**. Murlan animates the thrown card; it does not animate the *beaten* combination
reacting. `advancePile()` already keeps the previous combination as `prev`, so the node to react
is already on screen and already tracked. Making `prev` flinch and settle as the new card lands
is the single clearest "this card *beat* that card" signal available, and it is one `transform`
on one existing node.

### 4.5 The reveal

Murlan's reveal beats are the exchange (the loser's strongest card, forced) and the two-Joker
exception. `exchange.mp3` exists. The design principle from #101 that governs here: **no state may
live in the effect alone** — 91 % of players have sound off (#96) and reduce-motion players see the
quiet version, so a reveal that is *only* an animation has not revealed anything to most players.

### 4.6 The win

Two tiers, and they must be different: the *manche* and the *partita*. The escalation risk is the
inverse of the bomb's — a manche win happens many times per session, so the manche celebration is
the one most likely to wear out. `round_win.mp3`, `game_win.mp3` and `game_lose.mp3` already
distinguish three outcomes.

**A note on the losing player, which the tier table in #101 does not currently have a row for.**
Every celebration is simultaneously shown to two or three people who did *not* win. The "would a
player who quit forever feel the game had treated them well?" test bites hardest here: a
celebration tuned purely for the winner is, from the other seats, the game being pleased about
your loss. This is worth an explicit row.

---

## 5. Session shape

### 5.1 What the evidence actually supports

The folklore is "leave them hanging" (Zeigarnik). The 2025 meta-analysis by **Ghibellini & Meier**
(*Humanities and Social Sciences Communications* **12**, article 962, 2025,
DOI [10.1057/s41599-025-05000-w](#s-ghibellini)) separates two effects that get conflated:

- **Zeigarnik** (better *memory* for interrupted tasks) — **found no memory advantage.** Does not
  replicate. The authors suggest the original result may have depended on experimenter authority
  and task involvement, conditions rarer today.
- **Ovsiankina** (the tendency to *resume* an interrupted task) — **holds**, at a weighted
  resumption rate of roughly **two-thirds** across studies.

**What that changes for design.** The pull to come back is real but it is a **resumption** pull,
not a *memory* pull, and resumption requires the thing to be genuinely resumable — a clear state,
a visible position, an obvious next step. It does **not** require the player to be left in
discomfort. Manufactured tension (a countdown, a decaying streak) is not what the surviving effect
describes; an unfinished match to a points target is.

### 5.2 Why a game that is easy to leave gets returned to

The SDT frame in [§6](#6-the-honest-retention-literature) supplies the mechanism: **autonomy**
independently predicts both enjoyment and future play ([Ryan et al. 2006](#s-ryan)). A game that
makes leaving costly is, definitionally, reducing autonomy — so it trades a predictor of long-term
play for a bump in session length. The trap it sets is not stable: it works while the player
tolerates it and produces a sharp exit when they stop.

The design consequence is concrete and cheap: **the game must have a visible, dignified stopping
point, and reaching it must feel like a completion rather than an abandonment.** Murlan already
has one — `app/result.tsx` distinguishes `result.handOverTitle` from `result.matchOverTitle` and
offers `result.nextHand` / `result.newMatch` / `result.home`. The structure is right.

### 5.3 The rematch prompt

This is the honest lever, in full, and it is where "addictive but cool for the user" is actually
achievable rather than a compromise:

- Offer the rematch **immediately** and make it the largest affordance — the Ovsiankina pull is
  real and serving it costs the player nothing.
- Make **leaving equally easy and equally dignified** — same screen, no confirmation dialogue, no
  "are you sure?", no penalty, no forfeited anything. A confirm-to-quit modal is a small dark
  pattern and it is exactly the thing the owner's test rules out.
- **Show what happened before offering what's next.** This is #132's whole thesis (*"the result
  screen throws away everything it knows"*), and [§6](#6-the-honest-retention-literature) says why
  it is the retention work: the result screen is the game's one guaranteed opportunity to deliver
  competence feedback.

---

## 6. The honest retention literature

**Ryan, R. M., Rigby, C. S., & Przybylski, A. (2006). "The Motivational Pull of Video Games: A
Self-Determination Theory Approach." *Motivation and Emotion* 30(4), 344–360.
DOI [10.1007/s11031-006-9051-8](#s-ryan).**

Across four studies, the finding that matters here: **autonomy, competence and relatedness each
*independently* predict enjoyment and future play**, and in-game autonomy and competence are
associated with changes in well-being from pre- to post-play. Independence is the load-bearing
word — these are not three names for engagement; each contributes separately, so a game can be
diagnosed on each.

**Murlan, diagnosed on the three:**

| Need | Standing | Evidence |
|---|---|---|
| **Autonomy** | **Strong.** Four formats, four felts, four card backs, local cosmetics, offline and online, no gates, no energy, no appointments | `lib/cosmetics.ts`, `docs/RULES.md` |
| **Relatedness** | **Adequate and deliberately capped.** Friends, invites, 2v2 partnerships. Free-text chat was rejected (#59) — a real cost to relatedness, accepted for a moderation reason | #59, #88 |
| **Competence** | **This is the gap.** The game shows *who won*. It does not show *that you played well* | #129, #132, #133 |

**The single highest-value honest retention change available to this project is competence
feedback**, and three tickets already exist for it: #129 (what counts as a good play), #132 (the
result screen throws away what it knows), #133 (the profile shows lifetime averages and no trend).
The contribution of this report is to reclassify them: they are not "nerd surface" or "nice to
have", they are the retention work, and they are the *only* retention work that passes the owner's
test without qualification. A player who quit forever would look back on having been told they
played well and feel the game treated them well. That is the test, passed cleanly.

**A caution about competence feedback in a game with luck.** Murlan deals a random hand. Praise
attached to *outcome* is praise for the deal, and players detect that quickly and discount all of
it. #129's framing — "what counts as a good play" — is therefore the correct framing, and it must
resolve to something the player *chose*: playing out a hand efficiently, holding a bomb until it
mattered, a correct pass. This is harder than counting wins and it is the difference between
competence feedback that lands and flattery that doesn't.

---

## 7. The full retention toolkit, judged one at a time

The owner's fence, verbatim: *"add a good mix to not be too invasive and keep the experience
addictive but cool for the user"* — and the test they set themselves: **not invasive, cool for the
user**, operationalised as **would a player who quit forever feel the game had treated them well?**

No technique below was excluded by category. Each is described, costed to the player, and judged.

**Result: 4 pass · 3 pass only in a weakened form · 7 fail.**

### ✅ Pass

| Technique | What it does | What it costs the player | Verdict |
|---|---|---|---|
| **Layered feel / juice** | 5–8 stacked responses per impact make an action satisfying | Nothing, if it returns to rest and respects reduce-motion | **Pass.** The core recommendation of this report |
| **Competence feedback** | Tells the player they played well | Nothing. Increases well-being pre-to-post ([Ryan 2006](#s-ryan)) | **Pass.** The strongest honest lever available (#129/#132/#133) |
| **The rematch prompt** | Serves the resumption pull at the natural stopping point | Nothing, *provided leaving is equally easy* | **Pass**, with that proviso |
| **Cosmetic choice** | Felts and card backs as self-expression | Nothing. Already local-only, not server state, not sold | **Pass.** Already shipped and already correct (`lib/cosmetics.ts`) |

### ⚠️ Pass only in a specific weakened form

| Technique | The strong form (fails) | The weak form (passes) | Why the line falls there |
|---|---|---|---|
| **Variable-ratio reward** | A second random-reward layer on top of play — random drops, random bonuses | **Nothing added.** The deal is *already* a variable-ratio schedule and players consent to it as the premise of cards | The randomness players signed up for is the shuffle. A second, designed randomness is the slot-machine layer, and it is not what makes a card game good |
| **Streaks** | A streak that can be **broken**, displayed with pressure | A **cumulative count that only goes up** — hands played, matches finished | Loss aversion is the entire mechanism of a breakable streak. The tell that this is a real cost, not a squeamish one: Duolingo had to invent *streak freezes* to blunt it **[UNVERIFIED — secondary/vendor sources only](#u-duolingo)**. A count that cannot be lost cannot generate obligation |
| **Notifications** | "We miss you", "your friends are playing", re-engagement pushes | **Information the player is waiting for**: it is your turn in a live game | The repo already set this precedent on #111/#120 — *detect it, say so once, never nag*. A notification that reports a fact the player asked to know is service; one that manufactures a reason is nagging |

### ❌ Fail

Each with the harm stated, as the ticket requires.

| Technique | What it does | **The harm** | Also |
|---|---|---|---|
| **Near-miss framing** | Dramatises almost-winning — "one card left!" stingers, engineered close calls | **Clark et al. measured it directly: near-misses are rated *less pleasant* than full misses while *increasing* the desire to continue, and the effect only appears when the player felt they had control** ([Neuron 61(3):481–490, 2009](#s-clark)). A technique that lowers enjoyment and raises play is the precise inverse of "cool for the user" | Murlan has *genuine* near-misses. Reporting one honestly is fine. Amplifying one is this |
| **Loss-aversion streak pressure** | A visible streak that will break | Converts play from something wanted into something owed. Makes *stopping* the punished action. Fails "would a player who quit forever feel treated well" by construction — the design's whole purpose is that quitting should feel bad | — |
| **FOMO / limited-time offers** | "One time offer! You will NEVER see this offer again!" | Zagal et al. cite exactly this SimCity Social text as manipulation toward spending players would not otherwise do ([2013 §5.2](#s-zagal)) | Also barred by #94's scope fence (no seasons) |
| **Energy gates** | Play is rationed; the ration shrinks as you progress | Zagal's **PAY TO SKIP** in its aggressive form: *"the player's ability to play effectively is steadily reduced, until payment is required to progress in any meaningful manner"* ([§4.2.1](#s-zagal)) | Also barred by #65 |
| **Appointment mechanics** | Daily rewards, decaying resources, log-in streaks | Zagal's **PLAYING BY APPOINTMENT**: *"players are forced to orient their real-world activities to meet the obligations of the game, rather than the other way around"* ([§4.1.2](#s-zagal)). Note his own escape clause: *"the darkness of this pattern is nullified if completing appointments is not required for progression"* | Also barred by #94 |
| **Grinding** | Padding time to inflate engagement | Zagal's **GRINDING**: coercing time *"for the sole purpose of extending the game's duration"*, and *"many players — especially young or new ones — may have difficulties judging exactly how much time the game will actually demand"* ([§4.1.1](#s-zagal)) | Directly opposed to the *manche/partita* structure, whose length is legible up front |
| **Reward-bearing invites** | In-game benefit for recruiting friends | Zagal's **SOCIAL PYRAMID SCHEMES**: the harm is to *the invited player*, who *"feels socially obliged to play"* and is then obliged to recruit further ([§4.3.1](#s-zagal)) | Murlan's invites are safe **because they carry no in-game reward.** Keep it that way — this is a live constraint on #116 and any future social work, not a hypothetical |

---

## 8. The ranked list of feel changes, with costs

Ranked by *identity and satisfaction gained per unit of cost*. All are `transform`/`opacity`, all
fit #95's budget, none adds a dependency or a byte of asset. Costs are engineering size, not money.

| # | Change | Why it is here | Nodes | Cost | Feeds |
|---|---|---|---|---|---|
| **1** | **Hit-stop ("sleep") at the landing frame** — hold the table still ~90 ms before the aftermath, hung off `impactDelayMs()` | Nijman's cheapest trick and the most reliable converter of *moved* into *hit*. Zero new nodes, zero bundle | 0 | **XS** | #101 |
| **2** | **The beaten combination reacts** — `pileState.prev` flinches and settles as the new card lands | The clearest possible "this beat that" signal, on a node already on screen and already tracked by `advancePile()` | 1 | **S** | #101 |
| **3** | **The wooden rail** — a warm brown band at the table's outer edge | The only genuinely differentiating identity move on this list. One gradient, three tokens | 0 (static) | **S** | #98, #100 |
| **4** | **Re-cut the felt ramp as a lamp falloff** — warmer/brighter centre, darker/cooler rim, wider range | Turns a tinted background into a lit room. `tests/contrast.test.ts` already checks every stop, so iteration is safe | 0 (static) | **S** | #98 |
| **5** | **Gold re-roled as lamplight** — rim-light on up-facing card edges, avatar discs, the pile | Makes the five-step alpha scale mean something physical instead of decorative. No new tokens | ≤ hand size | **M** | #98, #125 |
| **6** | **Tiered trauma shake** on the table container, decaying, `trauma²`, reduce-motion-gated | The `game-feel` skill's model, one transform on one node. Must ship with the reduce-motion path in the same change | 1 | **S** | #101, #126 |
| **7** | **Squash on land** — brief non-uniform scale on the landing card, easing out via `Motion.spring.land` | Swink's De Blob example is exactly this: feel changed with no simulation change | 1 | **XS** | #101, #126 |
| **8** | **Audit which springs are actually used** — `pickup` and `land` are defined and correctly derived; confirm the code uses them | Possibly the highest ratio on the list: the tokens may already be ahead of the usage. Costs a read to find out | 0 | **XS** | #126 |
| **9** | **Permanence** — evidence of the last few plays persists longer on the table | Nijman spends two of his 30 tricks on this. `pileState` already keeps one level | 1–2 | **M** | #101 |
| **10** | **A losing-seat row in #101's tier table** — what the celebration looks like from the seats that lost | Every celebration is shown to 1–3 players who did not win; the owner's test bites hardest here | 0 | **XS** (design) | #101 |
| **11** | **Make the four music cues variations of one motif** | The Balatro mechanism: constraint compounds the memory instead of scattering it. Costs nothing extra at #113's already-chosen scope | 0 | **S** (selection) | #113 |

**What is deliberately not on this list.** Anything needing a particle engine, a shader, a new
dependency, or an asset download. Anything touching `lib/gameEngine.ts`. Anything that is a
progression system. And the twelve sound effects — **#97 must run first**; no source read can tell
you whether `bomb.mp3` sounds cheap on hardware, and #42 exists precisely because nobody has heard
them.

---

## 9. Dark patterns to avoid, named, with the harm

The checklist for #98, #99, #100, #101 and anything downstream. **Zagal, Björk & Lewis's final
definition** ([FDG 2013](#s-zagal)):

> **A dark game design pattern is a pattern used intentionally by a game creator to cause negative
> experiences for players which are against their best interests and likely to happen without
> their consent.**

Their two-part reading of "dark" is worth keeping: the designer is doing it knowingly, **and the
player is unlikely to know it is happening.**

| Pattern | Category | The harm to the player |
|---|---|---|
| **GRINDING** | Temporal | Time taken for the sole purpose of extending duration; new and young players cannot judge the true demand up front |
| **PLAYING BY APPOINTMENT** | Temporal | The player must arrange their real life around the game's schedule rather than the reverse |
| **PAY TO SKIP** | Monetary | Progress is sold rather than played; in the aggressive form, effectiveness is deliberately degraded until payment |
| **PRE-DELIVERED CONTENT** | Monetary | Content already shipped is withheld behind a fee — the player was sold an incomplete game |
| **MONETIZED RIVALRIES** ("pay to win") | Monetary | Competitiveness is converted into spending; a contest advertised as skill is decided by payment |
| **SOCIAL PYRAMID SCHEMES** | Social capital | The harm lands on the *invited* player, who plays from social obligation and must recruit further |
| **IMPERSONATION / friend spam** | Social capital | The game speaks in the player's name to their real-world contacts, at cost to relationships outside the game |
| **Near-miss framing** | Psychological ([Clark 2009](#s-clark)) | Measurably reduces pleasure while increasing the urge to continue |
| **Breakable streaks / loss-aversion pressure** | Psychological | Makes stopping the punished action; converts play into obligation |
| **Artificial scarcity / FOMO timers** | Psychological ([Zagal §5.2](#s-zagal)) | Manufactured urgency drives choices the player would not otherwise make |
| **Confirm-to-quit friction** | Psychological | Small, common, and squarely in scope here: making leaving *slightly* harder is the same mechanism at low dose |

**The two questions to ask of any design in this map**, adapted from Zagal's guiding questions and
the owner's test:

1. *Does this work by making playing better, or by making leaving worse?* Only the first passes.
2. *Would the player be comfortable if the mechanism were explained to them?* Zagal's disclosure
   principle: if knowing how it works would stop it working, it is manipulation.

---

## Explicitly unverified

Flagged rather than dropped, per the standard the existing two reports set.

- <a id="u-duolingo"></a>**Duolingo streak-freeze claims.** That streak freezes increased DAU
  retention, and that the stack limit rose from one to two in 2024, come from **secondary and
  vendor sources** (a podcast summary and product-marketing blogs), not from Duolingo research
  publications. The *direction* is corroborated by the general loss-aversion literature, but treat
  the specific figures as unverified. The argument in [§7](#7-the-full-retention-toolkit-judged-one-at-a-time)
  does not depend on them: it rests on the structural point that a forgiveness valve had to exist.
- **Balatro's >5 million copies (2025-01-21)** is a publisher/press figure, not audited.
- **Swink's "correction cycle under 100 ms"** is widely quoted in secondary sources and is **not in
  chapter 1**, which is the part I read in full. Not relied on anywhere above.
- **Derek Sakamoto's GDC 2015 talk** — talk metadata (title, speaker, venue, date) is confirmed
  from GDC Vault and Game Developer. The talk's *detailed* content is behind GDC Vault and I did
  not watch it, so only the "our game is UI" framing, which the Game Developer write-up quotes
  directly, is used here.
- **Zagal et al. page range (39–46)** is reported by citation indexes; the PDF I read carries no
  page numbers. Authors, venue, year, definitions and pattern names are all verified from the
  paper itself.
- **Ghibellini & Meier's "roughly two-thirds" resumption rate** comes from the abstract summary;
  the full-text effect sizes are paywalled and I did not read them. The qualitative finding —
  Zeigarnik does not replicate, Ovsiankina does — is stated in the abstract itself.
- **The palette hexes in [§3](#the-palette-recommendation-for-98)** are a *direction*, not a
  measured result. They have not been rendered, and #97's screenshots do not exist yet. #98 sets
  the final stops.
- **Anything about how the game currently looks or sounds in motion.** Read from source only. No
  device was used, no screenshot was taken. That is #97's job and this report does not pre-empt it.

---

## Sources

Fetched 2026-08-20 unless noted.

- <a id="s-swink"></a>Swink, S. (2008). *Game Feel: A Game Designer's Guide to Virtual Sensation.*
  Morgan Kaufmann. ISBN 978-0-12-374328-2. Chapter 1 read in full from
  [mycours.es mirror](http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf).
- <a id="s-nijman"></a>Nijman, J. W. (Vlambeer) (2013). *The Art of Screenshake.* INDIGO Classes
  2013, Utrecht. [Video](https://www.youtube.com/watch?v=AJdEqssNZ-U) ·
  [Internet Archive](https://archive.org/details/the-art-of-screenshake) ·
  [trick-by-trick transcript](https://theengineeringofconsciousexperience.com/jan-willem-nijman-vlambeer-the-art-of-screenshake/).
- <a id="s-zagal"></a>Zagal, J. P., Björk, S., & Lewis, C. (2013). "Dark Patterns in the Design of
  Games." *Proceedings of the 8th International Conference on the Foundations of Digital Games
  (FDG 2013)*, 39–46. Full text read from
  [DiVA](https://www.diva-portal.org/smash/get/diva2:1043332/FULLTEXT01.pdf).
- <a id="s-ryan"></a>Ryan, R. M., Rigby, C. S., & Przybylski, A. (2006). "The Motivational Pull of
  Video Games: A Self-Determination Theory Approach." *Motivation and Emotion* 30(4), 344–360.
  [DOI 10.1007/s11031-006-9051-8](https://link.springer.com/article/10.1007/s11031-006-9051-8).
- <a id="s-clark"></a>Clark, L., Lawrence, A. J., Astley-Jones, F., & Gray, N. (2009). "Gambling
  Near-Misses Enhance Motivation to Gamble and Recruit Win-Related Brain Circuitry." *Neuron*
  61(3), 481–490. [PubMed 19217383](https://pubmed.ncbi.nlm.nih.gov/19217383/) ·
  [PMC2658737](https://pmc.ncbi.nlm.nih.gov/articles/PMC2658737/).
- <a id="s-ghibellini"></a>Ghibellini, R., & Meier, B. (2025). "Interruption, recall and resumption:
  a meta-analysis of the Zeigarnik and Ovsiankina effects." *Humanities and Social Sciences
  Communications* 12, 962. [DOI 10.1057/s41599-025-05000-w](https://www.nature.com/articles/s41599-025-05000-w).
- <a id="s-hearthstone"></a>Sakamoto, D. (2015-03-04). "Hearthstone: How to Create an Immersive
  User Interface." GDC 2015. [GDC Vault](https://gdcvault.com/play/1022036/Hearthstone-How-to-Create-an).
- <a id="s-hearthstone-gd"></a>*Game Developer* (2015-05-22). "Video: Designing an immersive user
  interface for Hearthstone."
  [gamedeveloper.com](https://www.gamedeveloper.com/design/video-designing-an-immersive-user-interface-for-i-hearthstone-i-).
- <a id="s-balatro-steam"></a>*Balatro* on Steam (released 2024-02-20).
  [store.steampowered.com/app/2379780](https://store.steampowered.com/app/2379780/Balatro/).
- <a id="s-balatro-wiki"></a>*Balatro* — Wikipedia (sales, awards, development).
  [en.wikipedia.org/wiki/Balatro](https://en.wikipedia.org/wiki/Balatro).
- <a id="s-balatro-music"></a>*Music* — Balatro Wiki (five tracks, 7/4, composer, construction).
  [balatrowiki.org/w/Music](https://balatrowiki.org/w/Music).
- <a id="s-snap"></a>"Inside the Art of MARVEL SNAP." Marvel.
  [marvel.com](https://www.marvel.com/articles/games/inside-the-art-of-marvel-snap).
- <a id="s-colour-gd"></a>"Color in games: an in-depth look at one of game design's most useful
  tools." *Game Developer*.
  [gamedeveloper.com](https://www.gamedeveloper.com/design/color-in-games-an-in-depth-look-at-one-of-game-design-s-most-useful-tools).
- <a id="s-colour-wold"></a>"How to Use Color to Create Environments Like Mirror's Edge." World of
  Level Design.
  [worldofleveldesign.com](https://www.worldofleveldesign.com/categories/game_environments_design/mirrors-edge-color.php).
- <a id="s-wcag"></a>W3C. *Understanding Success Criterion 2.3.3: Animation from Interactions*
  (WCAG 2.2, Level AAA).
  [w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).
- Skills consulted before writing, per the ticket: `game-feel` (incl.
  `references/feedback-recipes.md`) and `game-ui-design` (incl. `references/patterns.md`).
