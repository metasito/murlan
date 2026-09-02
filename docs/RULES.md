# MURLAN — Consolidated Canonical Rule Specification

Sources are weighted as follows:
- **Tier 1 (Albanian/Italian primary, the tradition the game comes from):** visixplay.com/murlan/rules.php (IT/EN/AL — the "Visi Mobile Games" rules text, the most widely mirrored Albanian statement of the rules), catsatcards.com/Games/Murlan.htm (the most complete English write-up), pagat.com/national/albania.html (classification only, citing Franco Pratesi, *The Playing-Card* XXVI/3).
- **Tier 2 (modern online implementations):** murlanarena.com, murlan.app, Murlan Pro (gaminations), Murlan (MWM/Nordcurrent).

Where Tier 1 and Tier 2 disagree, this spec follows Tier 1 and records the disagreement at the point it arises, marked **Ambiguity**.

---

## 1. Deck composition

- **One standard 52-card French-suited deck plus exactly 2 Jokers = 54 cards.**
- The two Jokers **must be distinguishable** and have **different strength**. Naming varies by source but the ordering is unanimous:
  - **Coloured / Red Joker** — the single strongest card in the game.
  - **Black-and-White / Black Joker** — second strongest.
- catsatcards: *"One standard 52 card deck with the addition of two Jokers, in which each Joker being distinguishable from each other in some manner (such as a black and white Joker and a red or colored Joker)."*
- pagat.com's index entry for Albania states Murlan *"requires red and black jokers"* — i.e. the two-distinguishable-jokers requirement is part of the game's identity, not an app invention.
- murlanarena: *"Murlan uses a 54-card deck: the standard 52 cards plus a Black Joker and a Red Joker."*

## 2. Card strength order

**Confirmed by every source, lowest → highest:**

```
3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2 < Black/BW Joker < Red/Coloured Joker
```

- The **2 is the strongest ordinary rank** (stronger than the Ace).
- visixplay (AL): *"3, 4, 5, 6, 7, 8, 9, 10, Fanti, Zonja, Mbreti, Asi, 2, Xholi i Zi dhe Xholi i Kuq."*
- **Suit does NOT break ties.** catsatcards states this explicitly; no source anywhere assigns a suit ranking. Two cards of the same rank are of equal strength, and since a play must be **strictly higher** than the play it beats, a same-rank single simply cannot be played on top of another. **There is no suit order in Murlan.**
- The **only** role suit plays is: (a) identifying the 3♠ that opens the first hand, and (b) in implementations that recognise a flush/royal straight (see §5, §7).

## 3. Deal

- **4 players (the canonical and only traditionally-documented format):** the **entire 54-card deck is dealt out**, one card at a time, face down. 54 / 4 does not divide evenly, so **two players receive 14 cards and two receive 13**. catsatcards: *"He deals the cards one-at-a time and face-down to each player, continuing until the entire deck has been dealt out."* visixplay: *"Si mischiano e si distribuiscono tutte ai vari giocatori"* ("they are shuffled and **all** dealt to the players"). MWM's Murlan listing likewise says *"each player being dealt 13 or 14 cards."*
- **No cards are excluded from play in the 4-player game.** Every source that addresses dealing says the whole deck goes out.
- Dealer shuffles, the player to the dealer's **right** cuts, and the dealer deals **clockwise starting with the player to his left**.
- **3 players:** *no source specifies a deal.* The traditional game is 4-handed. **Ambiguity** — resolved by the implementation choice recorded in `docs/BRIEF.md` §3.1: the whole 54-card deck is dealt, 18 each, matching the 4-player precedent of nothing excluded.
- **2 players:** *no source specifies a deal either*, but dealing the whole deck lets each player deduce the other's exact hand by elimination — the family's own diagnosis of this exact problem (Tien Len, on pagat.com: *"if all the cards were dealt the players would be able to work out each other's hands, which would spoil the game"*). **Ambiguity** — resolved by the implementation choice recorded in `docs/BRIEF.md` §3.1: **14 cards are dealt to each player (28 of 54), and the remaining 26 are left face down and unused for the manche.** That is the four-player hand size, which is what both Tien Len and Big Two do at two players. Unlike every other seat count, the 3♠ is therefore not guaranteed to be dealt — see §4.

## 4. Who opens the first hand

- **The holder of the 3♠ (three of spades) leads the very first hand of a session**, and **the opening play must contain the 3♠**. It may be the 3♠ alone or any legal combination that includes it (pair of 3s including 3♠, a straight starting 3♠-4-5-6-7, etc.).
- visixplay (EN): *"The game starts (first hand) by who has the 3 of spades (forced to throw the 3 of spades also combined)."*
- catsatcards: *"the player who has the three of spades in hand plays first, and must include this card in the play."*
- At **3 and 4 players** the full deck is dealt, so **the 3♠ is always in somebody's hand** — no fallback is needed there.
- At **2 players** the 3♠ can end up in the 12 undealt cards (§3). When that happens, **the holder of the lowest dealt card opens instead** — the same fix Big Two and Tien Len use for their own stripped two-player deals. (MWM's app adds *"If that does not exist then a random player starts"*, a weaker version of the same idea.)
- **This rule applies only to the first hand of a session.** Subsequent hands are opened per §10.

## 5. Valid combinations

| Combination | Definition | Beaten by |
|---|---|---|
| **Single** | 1 card | a strictly higher single (Jokers are the top singles) |
| **Pair (double)** | 2 cards of the **same rank** | a strictly higher pair |
| **Triple** | 3 cards of the **same rank** | a strictly higher triple |
| **Straight ("scale" / *shkallë* / *scala*)** | **5 or more** cards in consecutive rank order; **suits are irrelevant** | a straight of the **same number of cards** whose top card is higher |
| **Bomb (quadruple / poker)** | **4 cards of the same rank** | only a higher bomb (Tier 1) — see §7 |
| **Royal straight / flush** *(Tier 2 only)* | a straight of 5+ cards **all of one suit** | a higher royal straight |

- **Minimum straight length is 5.** Unanimous across all sources: visixplay *"La scala deve essere di almeno 5 carte"* / *"Shkalla duhet të ketë të paktën 5 letra"*; catsatcards *"Five or more cards which are in direct sequential order."*
- **No source states a maximum straight length.** The practical maximum with ace-low and ace-high both permitted is 13 (A-2-3-…-K or 2-3-…-K-A style sequences, see §6).
- **A bomb is exactly 4 of a kind.** No source describes any other kind of bomb (no "four consecutive pairs", no "straight flush bomb" of the Tien Len / Big Two family).
- **Jokers form no combination.** catsatcards: *"A Joker can only be played as part of a single card combination."* murlanarena: *"Black and Red Jokers cannot be combined and can only be played as Singles."* They cannot pair with each other, cannot appear in a triple, cannot make a bomb, and cannot appear in a straight.

## 6. Straights in detail

- **The 2 is LOW inside a straight, and only low.** catsatcards: *"Twos are considered low, before the three."* visixplay: *"l'Asso e il 2 si possono utilizzare con il valore basso"* ("the Ace and the 2 can be used at low value" — in scales). murlanarena: aces and 2s can extend sequences *"but only on the lower end"* for 2s.
  - `2-3-4-5-6` is a **legal** straight.
  - `A-2-3-4-5` is a **legal** straight (Ace low, below the 2).
  - `K-A-2` style wrap-around, i.e. the 2 sitting **above** the Ace inside a straight, is **illegal**. The 2's status as the strongest rank applies to singles/pairs/triples/bombs only, never to sequence position.
- **The Ace is both high and low.** catsatcards: *"Aces can be used in a scale as either high or low, thus occurring after a King in a high scale … or before a 2 in a low scale."*
  - Lowest possible 5-card straight: **A-2-3-4-5** (top card = 5).
  - Highest possible 5-card straight: **10-J-Q-K-A** (top card = Ace high).
- **Jokers can NEVER substitute inside a straight or any other multi-card combination.** catsatcards: *"Scales cannot include jokers."* (The single dissenting statement is MWM's app-store blurb — *"A straight can go from any card with face value of 3 to the red joker"* — which is not corroborated by any rules source and appears to be marketing copy; **Ambiguity** — resolved by the implementation choice recorded in `docs/BRIEF.md` §3.1.)
- **Comparing straights:** same length required, compare the **top card of the sequence**. A 6-card straight cannot be played on a 5-card straight.

## 7. What beats what

1. A play may only be answered by **the same combination type with the same number of cards and strictly higher strength** — or by a **pass**.
2. **A bomb (4 of a kind) beats any single, pair, triple or straight, of any size, at any time.** visixplay: *"4 carte uguali (qualsiasi livello) battono qualsiasi mano in tavola e possono essere battute solo da altre quadruple di valore superiore."* This includes beating a Joker played as a single.
3. **A bomb is beaten only by a higher bomb** (Tier 1: catsatcards, visixplay IT/EN/AL, Murlan Pro).
4. **Royal straight / flush:** Tier 2 implementations (murlanarena, murlan.app) add a "Flush" = 5+ consecutive cards of one suit, and rank it **above bombs**: *"Quadruplets beat regular combinations but only lose to higher Quadruplets or Flushes… Flush is the strongest combination type as it can beat anything."* **The Albanian/Italian Tier-1 rules do not contain this combination at all.** Treat it as an optional/house rule — **Ambiguity** — resolved by the implementation choice recorded in `docs/BRIEF.md` §3.1.
5. **Equal strength never beats.** The answering play must be *strictly* higher.

## 8. Turn direction

- **Clockwise.** catsatcards describes both the deal and the play as proceeding clockwise: *"the object … is played by four players in clockwise turns"* / dealing *"in a clockwise rotation around the table, starting with the player at his left."* No source describes counter-clockwise play.

## 9. Passing, end of a trick/round, next lead

- A player who cannot or does not wish to beat the current play **passes**.
- **Passing does not lock a player out of the round.** The round ends only when **all other active players pass consecutively** — i.e. **three consecutive passes** in a 4-player game (`activePlayers − 1`). catsatcards: *"If there are three consecutive passes after a legal play, the player who played the last play to the table removes all cards currently on the table, setting them aside and out of play. He then starts the next series of plays."*
- The **player who made the last (unbeaten) play leads the next trick** with any legal combination of their choice. There is no start-card restriction on later tricks.
- If that player has just **gone out** (played their last card), the lead passes to the **next active player in turn order**.
- **A player who leads may not pass** — leading requires playing something.
- **Going out:** when a player plays their last card they leave the hand and are recorded in the finishing order. Play continues among the rest. The **hand ends when only one player still holds cards**; that player is last.

## 10. Exchange phase between hands

Performed **after every hand**, on the **newly dealt hands** of the next deal (not on the cards just played):

1. The player who finished **last** in the previous hand gives the player who finished **first** their **single highest-ranked card** (this is compulsory and automatic — it will be the Red Joker, else the Black Joker, else a 2, and so on).
2. In exchange, the player who finished **first** gives the last-place player **any one card of their choice ranked 3 through 10**. catsatcards: *"the player finishing first gives that player, in exchange, any card in his hand from rank 3 to 10."*
3. **The last-place player then leads the new hand.**

**Two-Joker exception:** *"If the player who had finished last on the last hand has both Jokers in his hand, he simply shows these cards and is not required to exchange any cards."* (catsatcards; corroborated by visixplay IT/EN/AL, Murlan Pro, murlanarena: *"If the loser holds both Black and Red Jokers, no card swapping occurs."*)

In that case **no cards change hands at all**, and the **first-place player from the previous hand leads the new hand instead** of the loser. catsatcards: *"The previous hand's last-place finisher leads (unless they showed both jokers; then the first-place finisher leads)."*

The 3♠ opening requirement (§4) is **not** re-applied — it belongs to the first hand of the session only.

## 11. Teams (2 v 2)

- Not part of the Tier-1 traditional description; it is a documented mode in modern implementations (murlan.app, murlanarena, Murlan Pro).
- **Seating:** partners sit **opposite** each other, so turn order alternates opponent–partner–opponent.
- **Scoring/win:** murlanarena states the team format is scored as a combined total — *"in team mode when a team earns combined 21 points first."* i.e. the two partners' individual placement points (3/2/1/0) are summed per hand and the pair racing to 21 wins.
- **No source states that a team wins the instant its first member goes out.** Under the combined-points reading, both partners' finishing positions matter (a 1st+2nd finish = 5 points, 1st+3rd = 4, etc.), so play continues after the first partner goes out. **Ambiguity** — resolved by the implementation choice recorded in `docs/BRIEF.md` §3.1.
- **A manche can end with both teams paid the same total.** First-and-fourth (3+0) and second-and-third (2+1) both sum to 3, which the combined-points reading above pays out identically. **No source addresses this case.** **Ambiguity** — resolved by the implementation choice recorded in `docs/BRIEF.md` §3.1: **it is a real draw.** Nobody is congratulated for that manche — no team, no winning haptic — and neither the seat that finished first nor the running *partita* score breaks the tie.

## 12. Scoring

- **Per hand (4 players):** 1st = **3** points, 2nd = **2**, 3rd = **1**, last = **0**. Unanimous across catsatcards, visixplay IT/EN/AL, Murlan Pro, murlanarena, murlan.app.
- **Match target: first to 21 points wins.**
- **Tie escalation:** if two or more players reach 21 in the same hand, the target is raised in 10-point steps — **21 → 31 → 41 → 51**. 51 is the maximum; if players are still tied at 51+, the match is a draw. visixplay: *"La vittoria si raggiunge a 21 punti, con possibili estensioni a 31, 41 e 51."*
- **2- and 3-player scoring is not documented anywhere.** The natural generalisation (N players ⇒ N−1 … 0) is an implementation choice, not a sourced rule — and so is the target it races to. This app scales the sourced 4-player ladder by (N−1)/3, giving **7 → 10 → 14 → 17** at two seats and **14 → 21 → 27 → 34** at three; the 4-player values above are untouched. See `docs/BRIEF.md` §3.1.
