# Dealing a 4-seat shedding game to 2 and 3 players — research pass, August 2026

Research-only document. **No code was changed and nothing was implemented.** Every source was
fetched from its primary host on **2026-08-21**; each claim carries the URL and site name it
came from. Ground truth for "what Murlan does today" is `docs/RULES.md` §3 and
`docs/BRIEF.md` §3.1, both read before the research began.

Arithmetic in §8 is **derived by this document**, not quoted from any source, and is labelled
as such. Anything a source would not confirm is in
[What could not be verified](#what-could-not-be-verified).

---

## Bottom line

1. **The problem has a canonical, explicitly-documented answer in this exact game family, and
   it is the undealt pile.** Pagat's Tien Len page states the reasoning in one sentence:
   *"When there are only two players, only 13 cards each should be dealt - if all the cards
   were dealt the players would be able to work out each other's hands, which would spoil the
   game."*
   ([pagat.com/climbing/thirteen.html](https://www.pagat.com/climbing/thirteen.html), read
   2026-08-21). This is the closest thing to a primary-source statement of Murlan's problem
   that exists, and it comes from Murlan's own family. §2
2. **Pagat's general design page ranks the options and puts undealt cards first as the
   simplest.** *"Trick-taking games, especially those in which most or all of the cards are
   dealt, often do not work well with only two players. If you know that your opponent holds
   exactly the cards that you do not have, the play can become uninteresting. There are
   several solutions to this."* — then lists seven, of which *"The simplest solution is to
   leave some of the cards undealt and out of play, for example by dealing the same sized
   hands that would be used with three or four players."*
   ([pagat.com/number/2_players.html](https://www.pagat.com/number/2_players.html), read
   2026-08-21). §2
3. **The problem is a cliff at two seats, not a slope.** Every game surveyed that strips the
   deal does so **only at two players**. Big Two at three players deals 17 each plus one face
   up — the *whole* 52 — and Tien Len's documented three-player alternative deals 17 each,
   i.e. 51 of 52. At three seats a player knows the *union* of two opponents' hands but not
   the split, which is a different and much weaker kind of information. §3, §9
4. **Deal-everything is also real, named practice — in games with 3+ seats.** President
   (*"All the cards are dealt out. Some players may have one more than others."*), Dai Fugō
   (*"All the cards are dealt out one at a time as equally as possible"*), Zheng Fen and Zheng
   Shangyou all deal the full pack across a variable seat count and accept unequal hands. None
   of them supports two players. §4
5. **Card removal is used to make a deck *divide*, not to hide information.** Hearts removes
   the ♦2 at three players and the ♣2 as well at five; Five Hundred swaps in an entirely
   different pack size per seat count (33 / 43 / 53 / 63 cards). Both are about arithmetic and
   trump density, and neither source gives hidden information as the reason. §5
6. **Dummy hands exist and are well documented, but every named instance hands the dummy to
   somebody** — Dummy Whist's declarer, three-handed Euchre's maker, Königrufen's "guardian".
   A truly *dead* fourth hand is documented as a category (Wikipedia's "dead hand") but this
   pass found no named climbing game that uses one. In practice a dead dummy is
   indistinguishable from an undealt pile, so it is the same option under a different name. §6
7. **Any undealt-pile option breaks Murlan's 3♠ opening rule, and the family already has the
   fix.** Both Big Two and Tien Len replace "holder of the lowest card leads" with *"the
   holder of the lowest dealt card starts"* precisely because the designated card may not be
   in play. `docs/BRIEF.md` §3.1 deleted Murlan's "lowest spade" fallback *because* the full
   deal made it unreachable; a stripped deal reinstates the need for it. §7
8. **A stripped deal has second-order effects on Murlan specifically that the source games do
   not have to think about, because they have no Jokers and no four-of-a-kind bomb.** At 14
   cards each for two players, roughly **74 % of deals would be missing at least one Joker**
   and only about **0.8 of 13 ranks would have all four cards in play** (down from 13 of 13
   today) — which nearly deletes the bomb, and interacts with the §10 two-Joker exchange
   exception. These are derived numbers, not sourced ones. §8
9. **Digital implementations split, and at least one makes it a setting.** Board Game Arena's
   Tien Len deals 13 each and leaves the rest undealt; CardzMania's Big Two deals equally and
   *"Remaining cards are discarded"*; the iOS app *Big 2 Poker!* exposes it as three separate
   options (13 or 17 cards, discard the extra card or give it away, face up or face down).
   Murlan Arena and murlan.app both document only four-player Murlan. §9

---

## 1. What Murlan does today, and why the current answer was chosen

From `docs/RULES.md` §3 and `docs/BRIEF.md` §3.1:

| Seats | Deal today | Deck used |
|---|---|---|
| 4 | 14 / 14 / 13 / 13 | all 54 |
| 3 | 18 each | all 54 |
| 2 | 27 each | all 54 |

`docs/RULES.md` §3 records that the four-player full deal is **unanimously sourced**:
catsatcards *"continuing until the entire deck has been dealt out"*; visixplay *"Si mischiano
e si distribuiscono tutte ai vari giocatori"*. It also records that **no source specifies a 2-
or 3-player deal at all** — the traditional game is four-handed, and the Tier-2 apps that
offer other counts do not publish their deal.

`docs/BRIEF.md` §3.1 chose the full deal for all counts, and the recorded reason is worth
restating because it cuts *against* the undealt-pile option:

> The current 13-per-player deal discards 2 random cards, so ~7% of games contain no Joker and
> ~4% no 3♠. This is the root cause of the fake "lowest spade" opening fallback, which can then
> be deleted.

So the repo has already rejected an undealt-card scheme once, on missing-key-card grounds, at
four seats. The question this document scopes is whether that reasoning survives at two seats,
where a different and larger problem appears.

---

## 2. The problem, stated by a primary source

Two Pagat pages state it directly. This is the strongest documented commentary found, and it
is the specific "predictability" argument the research brief asked for.

**Tien Len — the family member closest to Murlan.**

> "It is possible for two or three to play. If there are fewer than four players, 13 cards are
> still dealt to each player, and there will be some cards left undealt - these are not used
> in the game. **When there are only two players, only 13 cards each should be dealt - if all
> the cards were dealt the players would be able to work out each other's hands, which would
> spoil the game.**"
>
> — [Tien Len, pagat.com](https://www.pagat.com/climbing/thirteen.html), read 2026-08-21

**Pagat's general treatment of two-player adaptation**, which is a design essay rather than a
ruleset:

> "Trick-taking games, especially those in which most or all of the cards are dealt, often do
> not work well with only two players. If you know that your opponent holds exactly the cards
> that you do not have, the play can become uninteresting. There are several solutions to
> this."
>
> — [Card Games for Two Players, pagat.com](https://www.pagat.com/number/2_players.html),
> read 2026-08-21

That page then enumerates seven techniques. Quoted or paraphrased from the same page:

| # | Technique | Pagat's description |
|---|---|---|
| 1 | **Undealt cards** | *"The simplest solution is to leave some of the cards undealt and out of play, for example by dealing the same sized hands that would be used with three or four players."* |
| 2 | **Selective deal** | Players alternately choose between a visible and a hidden card, keeping or discarding each — so each player knows half the cards that are out of the game. |
| 3 | **Discard and draw** | *"Deal some of the cards to the players and stack the remaining cards face down. Then each player in turn may discard any unwanted cards and draw an equal number of replacement cards from the face down pile."* |
| 4 | **Phased deal** | *"Deal half the cards to the players and play them. Then deal the remaining cards to the players and play those."* |
| 5 | **Trick and draw** | *"Deal some cards to each player and stack the rest face down to form a stock pile. After each trick, the winner of the trick draws the top card of the stock…"* |
| 6 | **Dummy hands** | *"Deal more than two hands. Two hands belong to the two live players and the remaining hand or hands are dummy players."* |
| 7 | **Packets on the table** | Players play from hand or from the top of face-up packets with face-down cards beneath. |

Techniques 2, 4, 5 and 7 are trick-taking mechanics that do not transfer to a shedding game
without redesigning it; they are recorded here for completeness and not pursued below.

**Note the framing of technique 1.** Pagat does not say "deal fewer cards" — it says *"dealing
the same sized hands that would be used with three or four players"*. The design intent is
that **hand size stays constant** and the *deck* effectively shrinks, not the reverse.

---

## 3. Approach A — undealt / dead pile

The pile has many names. Wikipedia's *Talon (cards)* article treats **talon**, **stock**,
**skat**, **kitty**, **widow**, **blind**, **nest** and **dog** as largely regional and
game-specific synonyms for *"a stack of undealt cards that is placed on the table to be used
during the game"*, noting **widow** as *"primarily an American term"* (citing Dummett 1980)
and **kitty** as ambiguous between *"the pool or pot being played for"* and *"a dead hand or
widow"*
([en.wikipedia.org/wiki/Talon_(cards)](https://en.wikipedia.org/wiki/Talon_(cards)), read
2026-08-21). Pagat's mechanics page uses only three of them: *"some remain undealt, and are
left face down in the middle of the table, forming the **talon**, **skat**, or **stock**"*
([pagat.com/mech.html](https://www.pagat.com/mech.html), read 2026-08-21).

What matters for Murlan is not the name but **what happens to the pile**. Three distinct
treatments appear in the sources.

### 3a. Dead — set aside, never touched

This is the dominant treatment in the Big Two family.

| Game | Seats | Deal | Undealt | Source |
|---|---|---|---|---|
| **Big Two** | 2 | 17 each | 18 set aside unused | [pagat.com/climbing/bigtwo.html](https://www.pagat.com/climbing/bigtwo.html) |
| **Big Two** | 2 (alt) | 21 each | 10 unused | same |
| **Big Two** | 2 (alt) | 13 each | 26 unused | same |
| **Big Two** (catsatcards) | 2 | 21 each | *"the remainder of the deck set aide, unused in the rest of the hand"* | [catsatcards.com/Games/BigTwo.html](https://www.catsatcards.com/Games/BigTwo.html) |
| **Big Two** (Denexa) | 2–4 | 13 each | *"Set aside any unused cards; they will have no effect on game play."* | [denexa.com/blog/big-two/](https://www.denexa.com/blog/big-two/) |
| **Tien Len** | 2 | 13 each | 26 unused | [pagat.com/climbing/thirteen.html](https://www.pagat.com/climbing/thirteen.html) |
| **Tien Len** | 3 | 13 each | 13 unused | same |
| **Tien Len** (catsatcards) | 3 | 17 each | *"the last card in the deck set aside face down and not used in the hand"* | [catsatcards.com/Games/TienLen.html](https://www.catsatcards.com/Games/TienLen.html) |
| **Tien Len** (coololdgames) | any | 13 each | *"the remaining cards will be set aside, remaining facedown"* | [coololdgames.com/card-games/shedding/tien-len/](https://www.coololdgames.com/card-games/shedding/tien-len/) |

All read 2026-08-21.

**The spread of hand sizes is the notable thing.** Big Two's two-player rule is *not* settled:
Pagat documents 13, 17 and 21 as all being played, catsatcards prefers 21, Denexa prefers 13.
Expressed as a fraction of the 52-card deck actually in play, that is **50 %, 65 % and 81 %**
respectively. Nobody plays 26 each. The community has converged on "not all of it" without
converging on how much.

**Only two seats trigger it.** At three players, Big Two deals *"Seventeen cards … to each
player, and the last card is placed face up in the centre of the table. The holder of the
three of diamonds adds this extra card to their hand"* — the entire deck goes into play
(pagat.com). catsatcards corroborates and adds the edge case: *"If that last card happens to
be the three of diamonds, the holder of the three of clubs would take the card."* Tien Len's
documented three-player alternative is *"by prior agreement, to deal 17 cards each"* — 51 of
52. So the family's own answer is: **strip at two, deal everything at three.**

### 3b. Live — drawn from during play

Pagat records a Big Two variant where the leftovers become a penalty stock rather than dead
cards:

> "Anyone who passes must draw a card from the undealt stock and add it to their hand. When the
> stock is used up, play can continue without drawing, or in some groups the played cards that
> have been set aside are shuffled and used as a new stock."
>
> — [Big Two, pagat.com](https://www.pagat.com/climbing/bigtwo.html), read 2026-08-21

This is the same shape as **Shithead**, which is a shedding game built around it from the
start: three face-down, three face-up and a three-card hand per player, and *"Any cards
remaining undealt are placed face down to form a draw pile"*
([pagat.com/beating/shithead.html](https://www.pagat.com/beating/shithead.html), read
2026-08-21).

Note what this does to a shedding game's win condition: drawing on a pass means passing costs
you progress toward going out, which is a substantive rule change, not a dealing change.

### 3c. Auctioned — the pile is the prize

The Chinese climbing games use the undealt pile as an auction stake, which is a different
design goal entirely (asymmetry, not concealment).

- **Dou Dizhu** (3 players, 54 cards): each player draws to 17 and *"The last three cards are
  left face down on the table until after the auction."* After bidding, *"The three face-down
  cards in the middle are now added to the landlord's hand for a total of 20 cards."* Pagat
  notes a modern custom of the landlord revealing them first
  ([pagat.com/climbing/doudizhu.html](https://www.pagat.com/climbing/doudizhu.html)).
- **Big Three** (3 players): 16 each, *"The last four cards are left face down on the table
  until after the auction"*, and the winner *"picks up the four face-down cards from the
  middle, for a total of 20 cards"*
  ([pagat.com/climbing/bigthree.html](https://www.pagat.com/climbing/bigthree.html)).
- **Dou Dizhu, four-player**: double deck, *"Each player takes 25 cards and 8 cards are left
  over for the landlord, who plays alone from a hand of 33 cards"* (same page).

All read 2026-08-21. The pile here is never dead — it is always absorbed into a hand, so it
does **not** solve a concealment problem. It is listed because the brief asked about
auction/exchange mechanics, and because it shows the kitty is a load-bearing design object in
this family for reasons unrelated to Murlan's.

---

## 4. Approach B — full redistribution (what Murlan does now)

Named rulesets that deal the entire pack across a variable number of seats, accepting unequal
hands:

| Game | Seats | Rule | Source |
|---|---|---|---|
| **President / Scum** | 4–7 | *"All the cards are dealt out. Some players may have one more than others."* | [pagat.com/climbing/president.html](https://www.pagat.com/climbing/president.html) |
| **Dai Fugō / Dai Hinmin** | 3–6 | *"All the cards are dealt out one at a time as equally as possible to the players."* / *"Some players will have one card more than others - this does not matter."* | [pagat.com/climbing/daifugo.html](https://www.pagat.com/climbing/daifugo.html) |
| **Zheng Fen** | 3–6 | *"This continues until all the cards are distributed to the players. Some players may have one more card than others - this does not matter."* | [pagat.com/climbing/zhengfen.html](https://www.pagat.com/climbing/zhengfen.html) |
| **Zheng Shangyou** | 4+ | *"Depending on the number of players, some may have more cards than others - this does not matter."* / *"The players take single cards in counter-clockwise rotation until the pack is exhausted."* | [pagat.com/climbing/shangyou.html](https://www.pagat.com/climbing/shangyou.html) |

All read 2026-08-21.

**Two observations.**

First, **none of these games supports two players.** Their minimum is three (Dai Fugō, Zheng
Fen) or four (President, Zheng Shangyou). The full-redistribution approach is documented only
in the seat range where the deduction problem is weak, and it is never documented at the seat
count where the problem is acute.

Second, **the stated rationale in every case is "this does not matter"** — i.e. the design
question being answered is *hand-size fairness*, not *information*. Three separate Pagat pages
use nearly the same words, which reads as a shared tradition: the cards all go out, and a
one-card asymmetry is accepted as noise.

Where seats exceed what one deck supports, these games **add decks** rather than change the
principle: President *"When there are a lot of players, a double deck of cards is sometimes
used"*; Tien Len *"can also be played by more than four players, using two 52 card packs
shuffled together"*; Shithead adds two Jokers at six players. **Guan Dan** shows the endpoint —
a fixed 4-player, 108-card game where *"until all the cards have been drawn and everyone has 27
cards"*, with no variable-count provision at all
([pagat.com/climbing/guan_dan.html](https://www.pagat.com/climbing/guan_dan.html), read
2026-08-21). **Tichu** is the same shape: 56 cards, exactly four players, 14 each
([ultraboardgames.com/tichu/game-rules.php](https://www.ultraboardgames.com/tichu/game-rules.php)
and [en.wikipedia.org/wiki/Tichu](https://en.wikipedia.org/wiki/Tichu), read 2026-08-21). Some
games in this family simply decline the question.

---

## 5. Approach C — removing cards from the deck

Real and well documented, but the sources consistently give **divisibility and game balance**
as the reason, never concealment.

**Hearts** is the standard example.

> "With three players, remove the ♦2 from the deck, leaving 51 cards." … "With five players
> also remove the ♣2, and the holder of the ♣3 leads it to the first trick."
>
> — [Hearts, pagat.com](https://www.pagat.com/reverse/hearts.html), read 2026-08-21

Note that the same page offers **the undealt alternative as a peer option**, which is the
cleanest side-by-side statement of the two approaches found anywhere:

> "Deal 17 cards each to three players or 10 each to five players. The one or two remaining
> cards are called the **kitty**; they are placed in the middle of the table face down."

Wikipedia's Hearts article gives a different and **conflicting** removal list — *"For 3
players: the ♣2 is removed"*, *"For 5 players: the ♣2 and ♦2 are removed"*, *"For 6 players:
the ♣3, ♣2, ♦2 and ♠2 are left out"*
([en.wikipedia.org/wiki/Hearts_(card_game)](https://en.wikipedia.org/wiki/Hearts_(card_game)),
read 2026-08-21). The two sources agree on the *count* removed and disagree on *which* card at
three players; neither states a rationale. Flagged as a discrepancy, not resolved.

**Five Hundred** goes further and changes the pack itself per seat count — the most systematic
example of deck-scaling found:

| Seats | Pack | Kitty | Cards each |
|---|---|---|---|
| 3 | 33 cards, *"the lowest card in each suit being the seven"* | 3 | 10 |
| 4 | 43 cards: *"A K Q J 10 9 8 7 6 5 4 in the red suits; A K Q J 10 9 8 7 6 5 in the black suits; one joker"* | 3 | 10 |
| 5 | 53 cards, *"a full standard pack plus a joker"* | 3 | 10 |
| 6 | 63 cards, *"a special pack of 63 cards … having 11's and 12's of all suits and 13's of the red suits"* | 3 | 10 |

— [Five Hundred, pagat.com](https://www.pagat.com/euchre/500.html), read 2026-08-21.

**Five Hundred keeps the hand at exactly 10 cards and the kitty at exactly 3 across every seat
count**, and changes the pack to make that true. That is the "consistent hand size" design
goal in its purest documented form, and it is the mirror image of full redistribution.

**Euchre** likewise strips to 24 or 25 cards as its baseline and *adds* ranks for more seats —
*"Either adds the sevens and eights to the pack, making 33 cards … or play with a double 25
card pack"* at six players
([pagat.com/euchre/euchre.html](https://www.pagat.com/euchre/euchre.html), read 2026-08-21).

**Doppelkopf** removes ranks for reasons of *play texture* rather than seat count: *"Many
groups remove the nines so that there are 40 cards left. This way, there are no more dummy
cards and the balance between trumps and non-trumps is shifted even more towards trumps."*
([pagat.com/schafkopf/doko.html](https://www.pagat.com/schafkopf/doko.html), read 2026-08-21;
this line was read via search excerpt and is flagged in
[What could not be verified](#what-could-not-be-verified)).

**The information-theoretic catch.** Removing *named* cards does not restore hidden information
at two seats at all: if both players know the ♦2 and ♣2 are out, a full deal of the remainder
is still perfectly deducible. Card removal only helps if the removal is *random and unseen* —
at which point it is an undealt pile that has been given a different name.

---

## 6. Approach D — dummy / phantom hands

Wikipedia defines a dummy hand as *"a special hand dealt to an imaginary extra player, and
often played out according to certain rules"*, and splits the usage in two:

> "A dead hand is a hand dealt face down, but not used in the game." … "the dummy hand is
> controlled by a selected player (effectively meaning that player plays two separate hands)."
> … "points earned in the dummy are not scored separately but go to the player who played it."
>
> — [en.wikipedia.org/wiki/Dummy_hand](https://en.wikipedia.org/wiki/Dummy_hand), read
> 2026-08-21

Named instances found, all of them the *controlled* kind:

- **Dummy Whist** (3 players): the dummy gets 13 cards (15 with jokers), *"the cards are kept
  face-down until after the auction, when the dummy's cards are turned face-up and facing
  opposite the declarer."* Instead of a kitty, *"a dummy hand is dealt to be on the team of the
  player who wins the auction"*
  ([en.wikipedia.org/wiki/Dummy_whist](https://en.wikipedia.org/wiki/Dummy_whist), read
  2026-08-21).
- **Three-handed Euchre**: the fourth hand is dealt face-down; after trump is set *"the maker
  picks up the dummy hand, combines it with their own, and selects the best five cards to play
  with."* The stated reason is explicitly a *balance* one: *"This gives the maker a significant
  advantage and makes calling trump more appealing."* A "rotating dummy" sub-variant deals it
  face up instead, because *"This version gives the defenders more information and partially
  offsets the maker's advantage"*
  ([euchre.cards/variations/three-handed-euchre/](https://euchre.cards/variations/three-handed-euchre/),
  read 2026-08-21).
- **Königrufen with a Dummy** (3 players, proposed by Clas Broder Hansen 2012, adapted by
  Markus Mair): *"four hands of 12 cards as usual. Three hands belong to the active players and
  the fourth to an imaginary dummy player sitting to dealer's left."* It *"remains face down and
  unknown during the bidding"*, is *"turned face up after the talon exchange"*, and thereafter
  *"the dummy's cards are played by the 'guardian'"* — *"The play proceeds anticlockwise as
  usual, the dummy playing a card to each trick in its turn according to the normal rules."*
  ([pagat.com/invented/dummy-koenigrufen.html](https://www.pagat.com/invented/dummy-koenigrufen.html),
  read 2026-08-21).
- **Rummoli**: Wikipedia names the dummy position *"the widow"*, and records the dead treatment
  — *"cards are not revealed until the end of the game"*, kept out of play to increase
  difficulty (dummy_hand article, above).

**No named climbing or shedding game using a dummy hand was found in this pass.** The mechanic
lives in trick-taking games with an auction, where the dummy is the auction's prize. That
matters for Murlan: a shedding game has no auction, so there is nothing to attach a controlled
dummy to, and the *dead* variant collapses into approach A.

**A phantom that takes turns is a distinct sub-option** and does appear — Königrufen's dummy
plays a card to every trick. Transposed to a shedding game it would mean a hand that must be
*played out by someone*, which either re-creates the concealment problem (if a live player
controls and can see it) or requires an AI/random policy (if nobody does). No source documents
the latter.

---

## 7. The knock-on nobody can skip: who opens the first hand

Murlan `docs/RULES.md` §4: *"The holder of the 3♠ leads the very first hand of a session, and
the opening play must contain the 3♠"*, and it notes explicitly — *"Because the full deck is
dealt, the 3♠ is always in somebody's hand — no 'lowest spade' fallback exists in the
traditional rules."*

Every stripped-deal game in the family had to solve exactly this, and they solved it the same
way.

- **Big Two**, 2-player and the 13-card 3-player variant: *"The holder of the lowest dealt card
  starts"* ([pagat.com](https://www.pagat.com/climbing/bigtwo.html)).
- **Big Two** (catsatcards) documents a *protocol* for discovering it at a physical table:
  *"one player announcing the lowest card (i.e. three of diamonds), and a player states whether
  he has that card, and if so, can then proceed to make a first play. If no player has that
  card, the player would then announce the next lowest card in the deck."* This continues until
  someone holds the announced card
  ([catsatcards.com](https://www.catsatcards.com/Games/BigTwo.html)).
- **Pusoy Dos** on playingcards.io states the condition plainly: *"In 2-3 player games, it's
  possible that this card was not dealt"* — referring to the ♣3
  ([playingcards.io/game/pusoy-dos](https://playingcards.io/game/pusoy-dos)).
- Murlan's own Tier-2 prior art already contains the fallback: `docs/RULES.md` §4 records MWM's
  app adding *"If that does not exist then a random player starts"*, and notes this *"only
  arises in implementations that do not deal the whole deck."*

All read 2026-08-21. **A digital implementation does not need the announce-protocol** — the
server knows who holds the lowest dealt card and can simply designate them. But the *rule* must
exist, and `docs/BRIEF.md` §3.1 deleted Murlan's version of it as dead code.

---

## 8. Derived arithmetic — what a stripped deal would do to Murlan's own cards

**These numbers are computed by this document from Murlan's 54-card deck. They are not quoted
from any source.** They are included because Murlan has two features none of the source games
has — **two Jokers** and a **four-of-a-kind bomb** — and both are sensitive to cards leaving
play.

Probability that a given card is *not* dealt is `undealt / 54`. Probability that all four cards
of a rank are in play is the product of the four sequential draw probabilities, summed over 13
ranks for the expected count.

| Scenario | Dealt / undealt | P(3♠ missing) | P(≥1 Joker missing) | Expected ranks with all 4 cards in play (of 13) |
|---|---|---|---|---|
| **4p, 14/14/13/13 — today** | 54 / 0 | 0 % | 0 % | 13.00 |
| 4p, 13 each (the deal BRIEF rejected) | 52 / 2 | 3.7 % | 7.3 % | 12.08 |
| **3p, 18 each — today** | 54 / 0 | 0 % | 0 % | 13.00 |
| 3p, 14 each | 42 / 12 | 22.2 % | 39.8 % | 4.60 |
| 3p, 13 each | 39 / 15 | 27.8 % | 48.7 % | 3.28 |
| **2p, 27 each — today** | 54 / 0 | 0 % | 0 % | 13.00 |
| 2p, 14 each | 28 / 26 | 48.1 % | 73.6 % | 0.84 |
| 2p, 13 each | 26 / 28 | 51.9 % | 77.3 % | 0.60 |
| 2p, 21 each | 42 / 12 | 22.2 % | 39.8 % | 4.60 |

**Reading it.** The 4p/13-each row reproduces `docs/BRIEF.md` §3.1's own figures (*"~7% of
games contain no Joker and ~4% no 3♠"*) — confirming the method. The rows below it show the
same effect an order of magnitude larger. At two seats with 14-card hands, **the bomb very
nearly stops existing**: fewer than one rank per deal has all four of its cards anywhere in
play, against thirteen today.

Three Murlan rules sit directly downstream:

- **§7.2, the bomb** — *"4 of a kind beats any single, pair, triple or straight, of any size,
  at any time."* This is Murlan's escape valve. At 0.6–0.84 complete ranks it becomes a
  once-in-many-hands event rather than a tactic.
- **§10, the exchange phase** — the loser gives their *"single highest-ranked card … it will be
  the Red Joker, else the Black Joker, else a 2"*. The rule already degrades gracefully, so a
  missing Joker is survivable, but the **two-Joker exception** (*"If the loser holds both
  Jokers, he simply shows these cards and is not required to exchange"*) becomes near-unreachable.
- **§6, straights** — a 5+ straight needs five consecutive ranks present in one hand. Not
  quantified here, but density falls with the deal fraction.

**The 21-each two-player row is the interesting one.** It matches Big Two's most generous
documented two-player deal and catsatcards' preferred one, and it lands on the same numbers as
a 14-each three-player deal — meaningful concealment, with the bomb still present about 4.6
ranks per deal.

---

## 9. Digital prior art

| Implementation | What it does | Source |
|---|---|---|
| **Board Game Arena** (Tien Len) | *"Deal 4 players 13 cards each from a standard 52-card deck (it is also possible for two or three to play, 13 cards are still dealt to each player, and there will be some cards left undealt)."* | [en.doc.boardgamearena.com/Gamehelptienlen](https://en.doc.boardgamearena.com/Gamehelptienlen) |
| **CardzMania** (Big Two, 2–12 players) | *"After shuffling the cards, the dealer passes out an equal number of cards to each player. Remaining cards are discarded."* Plus: *"When enabled, the game is played with two decks. This variation is default when the game has 7 or more players."* | [cardzmania.com/BigTwo](https://www.cardzmania.com/BigTwo) |
| **Big 2 Poker!** (iOS, v2.0, 13 Jun 2018) | Ships it as three separate settings: *"Setting to choose between 13 or 17 cards in 2 & 3 player games"*; *"Setting to discard the extra card or give to the player with the lowest 3 in 2 & 3 player games"*; *"Setting to decide if the extra card is visible to all players or dealt face down to the recipient"* | [apps.apple.com/us/app/big-2-poker/id1065356412](https://apps.apple.com/us/app/big-2-poker/id1065356412) |
| **playingcards.io** (Pusoy Dos, 2–4) | Does not document a modified deal; only warns *"In 2-3 player games, it's possible that this card was not dealt"* about the ♣3 | [playingcards.io/game/pusoy-dos](https://playingcards.io/game/pusoy-dos) |
| **Murlan Arena** | Documents **four players only**: *"played by four players in clockwise turns"*, *"All cards are dealt sequentially and evenly among the four players."* No 2- or 3-player mode described. | [murlanarena.com](https://www.murlanarena.com/) |
| **murlan.app** | Names four-player free-for-all and 2v2 (four seats, partners opposite). *"Murlan uses a 54-card deck with two Jokers."* **No hand size or dealing mechanics published at all.** | [murlan.app](https://www.murlan.app/) |

All read 2026-08-21.

**Two things stand out.** CardzMania scales to twelve seats by dealing equally and *discarding
the remainder at every count* — the undealt-pile principle applied universally rather than only
at two players, which sidesteps having a special case. And *Big 2 Poker!* is the only
implementation found that treats this as a **configurable house rule** rather than a fixed
decision, which is itself a design position: the rule is genuinely unsettled in the source
material (§3a), so the app declines to settle it.

**No documented design rationale from any digital implementation was found** — no changelog,
blog post or developer note explaining *why* a given deal was chosen. The *Big 2 Poker!*
entries are release-note feature lines, not reasoning.

---

## 10. Implications for Murlan

Neutral option space. Murlan is a **54-card, 4-seat, 13/14-card-hand shedding game** with a
♠3 opening rule, two Jokers, a four-of-a-kind bomb, and a between-hands exchange keyed to the
highest card. Those four features are what make the choice non-obvious — the source games have
none of them.

**Framing point that applies to every option below:** the sources treat this as a *two-player*
problem. At three seats a player knows the union of two opponents' hands, not either hand, and
Big Two and Tien Len both deal the whole pack at three. Murlan could legitimately change the
2-player deal and leave the 3-player deal alone.

### Option 1 — Keep the full deal at every seat count (status quo)

- **For:** Zero change. Matches President / Dai Fugō / Zheng Fen / Zheng Shangyou practice
  (§4). Every card in play, so the bomb, both Jokers and the ♠3 opening rule all work exactly
  as at four seats. `docs/BRIEF.md` §3.1's reasoning — no missing key cards, no fallback rule —
  stays intact, and the deleted "lowest spade" fallback stays deleted. Nothing to explain to
  players.
- **Against:** At two seats it is the exact condition Pagat says *"would spoil the game"* (§2),
  and no sourced 2-player ruleset in this family does it. A 27-card hand is also double the
  hand size players learn at four seats, which is a UI problem as much as a game one (fanning
  27 cards on a phone in landscape).
- **Untouched sub-option:** keep it at 3 seats (18 each, well within family practice) and change
  only 2 seats.

### Option 2 — Undealt dead pile, hand size held near 13–14

- **For:** The family's documented answer, with the only explicit statement of the rationale
  (§2). Hand size stays where players already know it — Pagat frames the technique as *"dealing
  the same sized hands that would be used with three or four players"*, and Five Hundred's fixed
  10-card hand across four seat counts (§5) is the same principle. Trivial to implement: deal
  N cards, discard the rest. Existing card-fan layout works unchanged.
- **Against:** §8 is the cost. At 14 each for two players, ~74 % of deals lose a Joker and the
  bomb nearly vanishes (0.84 of 13 ranks complete). This is the same defect `docs/BRIEF.md`
  §3.1 called out at four seats, an order of magnitude worse. It also **reinstates the "lowest
  dealt card" opening fallback** that §3.1 deleted — which is a rule, a test, and a locale
  string, not just a branch.
- **Tuning lever:** hand size is exactly the dial. 21 each at two seats (Big Two's most
  generous documented deal, §3a) gives 42 of 54 in play, ~40 % chance of a missing Joker and
  ~4.6 complete ranks — materially better on every §8 axis while still concealing 12 cards.
  Whether 12 hidden cards is *enough* concealment is a judgement no source answers.

### Option 3 — Undealt pile that is drawn from on a pass

- **For:** Documented in Big Two itself (§3b) and central to Shithead. Solves concealment
  *and* keeps every card potentially reachable, so a Joker or the fourth card of a bomb is not
  permanently gone — it may arrive later. Adds genuine tension to passing.
- **Against:** This is a **rules change, not a dealing change**. It alters the win condition's
  shape — passing now costs progress toward going out — and interacts with Murlan §9's
  three-consecutive-passes trick resolution in ways no source describes. `CLAUDE.md` requires
  rule changes to go through `docs/BRIEF.md` §3.1, and this is the largest of the options here.
  Hand sizes also become dynamic, which the UI does not currently assume.

### Option 4 — Remove specific cards from the deck

- **For:** Named practice (Hearts, Five Hundred, Euchre, §5), and it makes the deal divide
  evenly, which 54 does not at four seats today.
- **Against:** **It does not solve the stated problem.** Publicly-known removals leave a
  two-player full deal just as deducible as it is now (§5). To help, the removal must be random
  and unseen — which *is* Option 2 with different vocabulary. It would also have to choose
  which of Murlan's cards to delete, and the deck's identity is load-bearing: `docs/RULES.md`
  §1 records that the two distinguishable Jokers are *"part of the game's identity, not an app
  invention"*, and the ♠3 has a rule attached to it.

### Option 5 — Dummy / phantom hand

- **For:** Preserves the four-seat table shape exactly: same deal, same hand sizes, same ♠3
  guarantee, same 13 complete ranks. Table layout, seat geometry and the four-seat scoring
  ladder all stay as-is. Turn order can skip the phantom or, following Königrufen (§6), let it
  play.
- **Against:** **No named climbing or shedding game uses one** (§6). Every documented dummy
  belongs to an auction game where the dummy is the auction's prize — Murlan has no auction to
  attach it to. A *dead* phantom that never plays is arithmetically identical to Option 2 with
  a fixed 13/14-card pile, so it inherits all of Option 2's §8 problems while adding a concept
  to explain. A phantom that *does* play needs a policy (AI or random), which is a bot, not a
  dealing rule — and its cards are 13/14 more cards not in either human hand, so it does not
  restore the bomb either.
- **Scoring note:** Murlan §12's placement points and `docs/BRIEF.md` §3.1's scaled targets
  (7/10/14/17 at two seats, 14/21/27/34 at three) assume N real players. A phantom that can
  "finish" would need a position in the finishing order, or be excluded from it.

### Option 6 — Make it a setting

- **For:** The only documented digital precedent that faces the ambiguity honestly (*Big 2
  Poker!*, §9), and the source material genuinely is unsettled — Pagat lists 13, 17 *and* 21 as
  played two-player deals (§3a). Lets the beta testers answer the question empirically.
- **Against:** Multiplies the state space every rule and test has to cover, on the deal — the
  single most load-bearing thing in the game. `docs/RULES.md` already carries four **Ambiguity**
  markers resolved by a single recorded decision each; this would be the first one resolved by
  *not* deciding. It also splits the player pool at matchmaking.

### The axis the options actually trade on

| | Concealment at 2 seats | Bomb / Joker density | ♠3 rule survives | Hand size stable | Rules-change size |
|---|---|---|---|---|---|
| 1 Full deal (today) | **none** | full | yes | no (27 at 2p) | none |
| 2 Dead pile, 13–14 | high | **very low** | no — needs fallback | **yes** | small |
| 2′ Dead pile, 21 at 2p | moderate | moderate | no — needs fallback | partial | small |
| 3 Draw-on-pass | high | recovers over time | no — needs fallback | dynamic | **large** |
| 4 Card removal | **none** (if public) | reduced | at risk | improves divisibility | small |
| 5 Dead phantom | high | very low | yes if ♠3 forced into a live hand | yes | medium |
| 6 Setting | configurable | configurable | must handle both | configurable | medium |

**The tension in one line:** concealment at two seats is bought by taking cards out of play, and
every card taken out of play is a card that might have been a Joker, the ♠3, or the fourth of a
bomb — the three things `docs/BRIEF.md` §3.1 changed the deal to guarantee. Hand size is the
dial that sets the exchange rate, and no source says where to set it.

---

## What could not be verified

- **BoardGameGeek returned HTTP 403 to every fetch.** Two threads that search results indicate
  are directly relevant — *"Big 2 for 2"* (thread 2532424) and *"Big Two rules, variants and
  some history"* (thread 2530232) — could not be read. Their content is **not** represented
  above. Community discussion of two-player Big Two is therefore a gap in this pass.
- **No Albanian or Balkan source describes a 2- or 3-player Murlan deal.** This confirms
  `docs/RULES.md` §3's existing finding rather than adding to it. visixplay, catsatcards and
  pagat's Albania entry were already surveyed by `docs/RULES.md`; of the Tier-2 apps,
  murlanarena documents four players only and murlan.app publishes no hand size at all (§9).
  MWM's App Store listing is reported second-hand via search excerpt as saying the game *"can
  be played with 2 or 4 players"* with *"13 or 14 cards"*, but the listing text could not be
  fetched directly to confirm how the 2-player deal works. **[UNVERIFIED]**
- **The Doppelkopf nines-removal quote in §5 was read from a search excerpt**, not from
  pagat.com/schafkopf/doko.html directly. It is peripheral to the argument. **[UNVERIFIED]**
- **The Pusoy Dos "26 cards each for two players" claim** appeared in a search summary
  attributed to gambiter.com; that page returned a closed socket on two fetch attempts and the
  claim is **not** used above. **[UNVERIFIED]**
- **No source states a "muscle memory / consistent hand size for player skill" rationale in
  those terms.** The closest documented evidence is structural rather than stated: Pagat's
  *"dealing the same sized hands that would be used with three or four players"* and Five
  Hundred's fixed 10-card hand across four different pack sizes. The inference in §10 is this
  document's, not a source's.
- **No digital implementation was found that published its reasoning.** §9's entries are rules
  text and release notes; none explains why.
- **Tabletop Simulator workshop mods** were searched for and nothing documenting a player-count
  dealing decision was found. The Steam results returned were generic scripting discussions.
- **The Hearts three-player removal conflicts between sources** (pagat: ♦2; Wikipedia: ♣2).
  Unresolved, and flagged in §5. It does not affect any conclusion here.
