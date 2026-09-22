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
- **Ambiguity** — the implementation deals the other way round. `dealCards` gives successive cards to seat `start + i` while play runs the other direction (`getNextActivePlayer`), so the deal is anticlockwise against a clockwise game. Resolved by the decision recorded in § Decisions below: **the anticlockwise deal stands.** It decides only which seats get the 14th card of a 54-card deal, and the rotating deal start (§ Decisions) already moves that round the table every manche.
- **3 players:** *no source specifies a deal.* The traditional game is 4-handed. **Ambiguity** — resolved by the implementation choice recorded in § Decisions below: the whole 54-card deck is dealt, 18 each, matching the 4-player precedent of nothing excluded.
- **2 players:** *no source specifies a deal either*, but dealing the whole deck lets each player deduce the other's exact hand by elimination — the family's own diagnosis of this exact problem (Tien Len, on pagat.com: *"if all the cards were dealt the players would be able to work out each other's hands, which would spoil the game"*). **Ambiguity** — resolved by the implementation choice recorded in § Decisions below: **14 cards are dealt to each player (28 of 54), and the remaining 26 are left face down and unused for the manche.** That is the four-player hand size, which is what both Tien Len and Big Two do at two players. Unlike every other seat count, the 3♠ is therefore not guaranteed to be dealt — see §4.

## 4. Who opens the first hand

- **The holder of the 3♠ (three of spades) leads the very first hand of a session**, and **the opening play must contain the 3♠**. It may be the 3♠ alone or any legal combination that includes it (pair of 3s including 3♠, a straight starting 3♠-4-5-6-7, etc.).
- visixplay (EN): *"The game starts (first hand) by who has the 3 of spades (forced to throw the 3 of spades also combined)."*
- catsatcards: *"the player who has the three of spades in hand plays first, and must include this card in the play."*
- At **3 and 4 players** the full deck is dealt, so **the 3♠ is always in somebody's hand** — no fallback is needed there.
- At **2 players** the 3♠ can end up in the 26 undealt cards (§3). When that happens, **the holder of the lowest dealt card opens instead** — the same fix Big Two and Tien Len use for their own stripped two-player deals. (MWM's app adds *"If that does not exist then a random player starts"*, a weaker version of the same idea.)
- **This rule applies only to the first hand of a session.** Subsequent hands are opened per §10.
- **A session is the table, not the match.** It lasts until the table breaks up, so every match dealt at a standing table — a rematch or a freshly started one — opens with the exchange of §10 on the last complete rankings, and the 3♠ opens only a table with no previous manche to exchange from. A match ended by the unanimous end-of-match vote leaves its rankings incomplete and is never exchanged from. Recorded in § Decisions below.

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
- **Jokers can NEVER substitute inside a straight or any other multi-card combination.** catsatcards: *"Scales cannot include jokers."* (The single dissenting statement is MWM's app-store blurb — *"A straight can go from any card with face value of 3 to the red joker"* — which is not corroborated by any rules source and appears to be marketing copy; **Ambiguity** — resolved by the implementation choice recorded in § Decisions below.)
- **Comparing straights:** same length required, compare the **top card of the sequence**. A 6-card straight cannot be played on a 5-card straight.

## 7. What beats what

1. A play may only be answered by **the same combination type with the same number of cards and strictly higher strength** — or by a **pass**.
2. **A bomb (4 of a kind) beats any single, pair, triple or straight, of any size, at any time.** visixplay: *"4 carte uguali (qualsiasi livello) battono qualsiasi mano in tavola e possono essere battute solo da altre quadruple di valore superiore."* This includes beating a Joker played as a single.
3. **A bomb is beaten only by a higher bomb — with one exception, a royal straight, which beats a bomb of any strength and can never be beaten by one** (Tier 1 bomb-vs-bomb rule: catsatcards, visixplay IT/EN/AL, Murlan Pro; the royal-straight exception is a resolved house rule — see §7.4).
4. **Royal straight / flush:** Tier 2 implementations (murlanarena, murlan.app) add a "Flush" = 5+ consecutive cards of one suit, and rank it **above bombs**: *"Quadruplets beat regular combinations but only lose to higher Quadruplets or Flushes… Flush is the strongest combination type as it can beat anything."* **The Albanian/Italian Tier-1 rules do not contain this combination at all.** This app follows Tier 2 here as a **resolved house rule for this implementation** (not an open Ambiguity), per the decision recorded in § Decisions below: a royal straight beats a bomb of any strength, and a bomb can never beat a royal straight — see §7.3.
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
2. In exchange, the player who finished **first** gives the last-place player **any one card of their choice ranked 3 through 10**. catsatcards: *"the player finishing first gives that player, in exchange, any card in his hand from rank 3 to 10."* **Never the card just received** — handing it straight back is not an exchange. **Holding no card at all in 3-10**, the first-place player gives their **single lowest card** instead; the sources have no answer for that hand, and an empty choice deadlocks the exchange. Both recorded in § Decisions below.
3. **The last-place player then leads the new hand.**

**Two-Joker exception:** *"If the player who had finished last on the last hand has both Jokers in his hand, he simply shows these cards and is not required to exchange any cards."* (catsatcards; corroborated by visixplay IT/EN/AL, Murlan Pro, murlanarena: *"If the loser holds both Black and Red Jokers, no card swapping occurs."*)

In that case **no cards change hands at all**, and the **first-place player from the previous hand leads the new hand instead** of the loser. catsatcards: *"The previous hand's last-place finisher leads (unless they showed both jokers; then the first-place finisher leads)."*

The 3♠ opening requirement (§4) is **not** re-applied — it belongs to the first hand of the session only.

## 11. Teams (2 v 2)

- Not part of the Tier-1 traditional description; it is a documented mode in modern implementations (murlan.app, murlanarena, Murlan Pro).
- **Seating:** partners sit **opposite** each other, so turn order alternates opponent–partner–opponent.
- **Scoring/win:** murlanarena states the team format is scored as a combined total — *"in team mode when a team earns combined 21 points first."* i.e. the two partners' individual placement points (3/2/1/0) are summed per hand and the pair racing to 21 wins.
- **No source states that a team wins the instant its first member goes out.** Under the combined-points reading, both partners' finishing positions matter (a 1st+2nd finish = 5 points, 1st+3rd = 4, etc.), so play continues after the first partner goes out. **Ambiguity** — resolved by the implementation choice recorded in § Decisions below.
- **A manche can end with both teams paid the same total.** First-and-fourth (3+0) and second-and-third (2+1) both sum to 3, which the combined-points reading above pays out identically. **No source addresses this case.** **Ambiguity** — resolved by the implementation choice recorded in § Decisions below: **it is a real draw.** Nobody is congratulated for that manche — no team, no winning haptic — and neither the seat that finished first nor the running *partita* score breaks the tie.

## 12. Scoring

- **Per hand (4 players):** 1st = **3** points, 2nd = **2**, 3rd = **1**, last = **0**. Unanimous across catsatcards, visixplay IT/EN/AL, Murlan Pro, murlanarena, murlan.app.
- **Match target: first to 21 points wins.**
- **Tie escalation:** if two or more players reach 21 in the same hand, the target is raised in 10-point steps — **21 → 31 → 41 → 51**. 51 is the maximum; if players are still tied at 51+, the match is a draw. visixplay: *"La vittoria si raggiunge a 21 punti, con possibili estensioni a 31, 41 e 51."*
- **2- and 3-player scoring is not documented anywhere.** The natural generalisation (N players ⇒ N−1 … 0) is an implementation choice, not a sourced rule — and so is the target it races to. This app scales the sourced 4-player ladder by (N−1)/3, giving **7 → 10 → 14 → 17** at two seats and **14 → 21 → 27 → 34** at three; the 4-player values above are untouched. See § Decisions below.

## Decisions

Each row is a decided question: the rule, and why it is that way. Changing a row is the owner's (`CLAUDE.md`).

Research consulted 18 sources including pagat.com, catsatcards.com, visixplay.com (IT/EN/AL),
murlanarena.com, murlan.app, and the App Store / Play Store listings of the two largest
existing Murlan apps.

| Rule | Decision | Rationale |
|---|---|---|
| **The deal** | **Deal the entire 54-card deck at 3 and 4 players.** 4p = 14/14/13/13, 3p = 18 each. Every source says the whole deck is dealt. The current 13-per-player deal discards 2 random cards, so ~7% of games contain no Joker and ~4% no 3♠. This is the root cause of the fake "lowest spade" opening fallback, which can then be deleted. |
| **The deal at 2 players** | **Deal 14 each (28 of 54); the other 26 stay face down and unused.** | Dealing the whole deck at 2 players lets each player deduce the other's exact hand by elimination — Pagat's own diagnosis of this exact family of games. 14 is the four-player hand size, which is what both Tiến Lên (*"only 13 cards each should be dealt"*) and Big Two (13/17/21 all attested) do at two players, and what Pagat's two-player design page recommends in general: *"dealing the same sized hands that would be used with three or four players."* **Revised 2026-08-31, replacing 21 each.** 21 was chosen on a per-*deal* Joker figure (~74% of deals losing one at 13/14); measured per *hand*, which is what a player experiences, 14 each reproduces the canonical four-seat game almost exactly — 0.042 bombs a hand against 0.035, a Joker in 46% of hands against 44%, a 5+ straight in 56% against 52% — while 21 each gives seven times the canonical bomb density and leaves only 12 cards hidden, so most of the concealment the change exists for was never bought. 14 also lifts the hand off `MIN_READABLE_STEP`: at 21 the gap between two card targets sat at 24.4px on every handset, the narrowest that is defensible at all. Keeps the "lowest dealt card opens" fallback at 2 players only — it now fires on about half of first hands rather than a fifth. |
| **Royal straight** | **Keep as core, beating bombs. No engine change.** | Traditional Albanian sources have no flush at all, but both major modern implementations (murlanarena, murlan.app) have it and rank it above bombs — which is exactly what the engine already does. Only the documentation changes. |
| **Royal straight comparison** | Beating royal straight must have the **same card count**, consistent with normal straights. | Matches existing engine behaviour; `app/rules.tsx` currently implies otherwise. |
| **Teams win condition** | **Play the hand out and sum both partners' placement points.** | Matches current engine behaviour and the only source covering team play. `app/rules.tsx` is wrong and changes. |
| **Match target** | **Add it: 3/2/1/0 per hand, first to 21, escalating 31 → 41 → 51 on ties.** | The most consistently attested rule across every source, and completely absent from the app today. Turns loose repeated hands into an actual match. |
| **2 in straights** | **Keep — the engine is already correct.** `A-2-3-4-5` and `2-3-4-5-6` are legal; the 2 is low *only* inside a sequence. | Confirmed canonical by catsatcards and visixplay. No change. |
| **Suit tiebreaks** | **None. The engine is correct; `CLAUDE.md` is wrong** and must be corrected. | No source assigns any suit order. Equal ranks are equal strength, so a same-rank answer is simply illegal. |
| **Passing** | Passing does **not** lock a player out of the round (consecutive-pass counting). Engine is correct; state it explicitly on the rules screen. | Players arriving from Tien Len assume the opposite. |
| **Straight length** | 5 to 13 cards, each rank at most once, Ace picks one end. **Remove the arbitrary 9-card cap.** | No source imposes a maximum. |
| **Abandoning a hand** | **A seat abandoned mid-hand is recorded as a last-place finish.** The player loses rating and loses their streak. No penalty beyond that, and no achievement is awarded for an abandoned seat. | Leaving before the hand ended used to produce no record at all, which made closing the browser tab a complete defence against ever losing rating. A genuine network drop is punished identically to a rage-quit: there is no reliable signal separating them, and guessing would be a new class of unfairness rather than a fix. |
| **Match target by seat count** | **The 4-player ladder 21 → 31 → 41 → 51 scales by (N−1)/3**: **7 → 10 → 14 → 17** at two seats, **14 → 21 → 27 → 34** at three, four unchanged. | `scoreHand` was generalised to N−1…0 but the target stayed flat, so a manche fell from 6 points to 3 to 1 while the finish line did not move: measured over 60 full matches per configuration, a 1-v-1 took **26.7 manches** and a 3-player match 15.1, against 10.4 at four seats. Nobody finished a 1-v-1, so nobody in that format ever earned `match_champion` or `iron_will`. Scaling lands every count in the 8-12 manche band a match should take, and leaves the only values `docs/GAME-RULES.md` §12 actually sources untouched. |
| **Rotating the deal** | **The seat the deal starts from advances by one every manche**, so the two extra cards of a 54-card deal move round the table instead of landing on seats 0 and 1 forever. It resets to seat 0 when a new match is dealt. | `docs/GAME-RULES.md` §3 has a dealer who rotates; the engine dealt from index 0 every time. Measured over 4,000 four-seat hands with four identical AI personalities, seats 0 and 1 won 25.9%/26.3% of manches against 23.4%/24.4% for seats 2 and 3 — a ~2.2-point gap at ≈4.5σ, which a rotating deal collapses to noise. Online, seat 0 is always the host, so the rated ladder was recording that bias as skill. |
| **Starting a new match** | **While a match is still running, `room:start` is refused** — the next manche belongs to the rematch vote. **After a match has genuinely ended, a new one needs unanimous ready among the connected seated humans,** not the host alone. Vacated and bot seats abstain rather than voting no. | A finished match releases every player's commitment, and every ladder-based card game treats a new match as a new agreement. Host-only start is how players get ground into matches they wanted to leave, and a rated ladder makes an unwanted match a rating risk rather than an annoyance. Abstention is what keeps the unanimity gate from deadlocking on a seat that cannot answer. |
| **Naming the winner of a single manche** | **An abandoned seat can never be announced as the winner.** When a `single`-length game ends and the leading seat has been vacated, the announced winner is the best-placed seat still held by a human. If no human seat finished, the manche is announced with no winner. | The seat keeps the departed player's name when the engine takes it over, so the game was crediting the person who walked out, by name, in front of the people who stayed. Scoring already excluded abandoned seats from the running total — this is the same rule applied to the announcement, which was the one place it had never been carried through. |
| **Who votes on a rematch** | **Only seats held by a human vote, offline and online alike.** Bot seats and vacated seats abstain from both the count and the total. | Online already worked this way and the row above already says vacated and bot seats abstain; offline let AI seats vote *and* counted them toward the majority, so "most players agreed" meant two different things depending on where you were sitting. A computer has no preference to record, and a table of one human plus bots should restart when that human says so. |
| **A 3-3 drawn manche in teams mode** | **It is a real draw.** The overlay states the manche was drawn, no team is congratulated, and no winning haptic fires for anyone. Neither the seat that finished first nor the running *partita* score breaks the tie. | First-and-fourth (3+0) and second-and-third (2+1) both sum to 3, so a manche can pay both teams the same total. The overlay was reading `rankings[0]` as a fallback "hand winner" whenever the match itself was not yet decided, so it congratulated the team of whoever finished first even when that manche was a draw — and delivered that congratulation to the losing team's own bodies as a haptic (#777, found on PR #776). No source addresses the case, and inventing a tiebreak (finish order, running score) would be deciding the manche on a number the combined-points rule (above) says does not decide it. |
| **The disconnect policy** | **Adopted in full as `docs/DISCONNECT-POLICY.md` §6, decided by the owner 2026-09-03 on #820.** The seat carries the reconnect countdown for the whole 60 s grace and the hand keeps running; after it the seat is vacated and *labelled* vacated, rendered by each client from a flag rather than a server-written name; the takeover finishes the current hand at minimum legal strength and only plays properly from the next deal; **a seat that becomes a bot scores exactly as a seat that was born one**, while still never crossing the target and never being named the winner; points won before leaving are kept, shown and frozen, so the standings always sum to the hands played; the seat is reclaimable by the same account for the life of the match, and `SEAT_RELEASED` answers only for a finished or disposed table; the abandonment already recorded stands and returning does not undo it; once a seat has been vacated any remaining player may call a **unanimous** vote to end the match, penalty-free; a match abandoned before its first point is voided and rated for nobody. **There is no matchmaking cooldown — removed in full on #898, decided by the owner 2026-09-03.** Abandoning costs the abandoner their own score, via the standings clause above, and nothing further: no repeat-offence gate on `room:quickmatch`, whatever the count. Grace lengths (60 s / 20 s) and the 30 s turn timer are unchanged. | Every clause above existed as a local code choice made at a different time, and read side by side they did not describe a game anyone would choose: crossing the grace boundary *upgraded* the seat to a competent AI, and discarding the takeover's points is what made the standings stop summing to the hands played — the visible half of #815. Scoring a vacated seat like a born-bot seat removes that whole class of hole rather than papering over it with a footnote explaining an internal rule to players. Nothing here rewards leaving, whether ahead or behind; nobody is trapped or robbed. Researched against chess.com, Lichess, Board Game Arena, Tenhou, Mahjong Soul, RummyCircle, Dota 2 and League of Legends — sourced in the design doc, with unsourced claims marked there. The three rows above stay exactly as they are: this decision changes none of them. **The cooldown was a local code choice (#858) shipped ahead of the policy that would have authorised it, never confirmed by the owner; asked directly, the owner's answer was no — one drop, or several, is forgiven, and the standings' own frozen-points clause is already the whole consequence.** |
| **The direction the deal runs** | **Keep the anticlockwise deal.** `dealCards` gives card `i` to seat `start + i`, while the turn order runs the other way (`getNextActivePlayer` steps to `current - 1`), so the deal runs against the play. `docs/GAME-RULES.md` §3 carries an Ambiguity note saying so; no code changes. | The direction the deal runs decides only which two seats get the 14th card of a 54-card deal, and the rotating deal decision recorded above already moves that advantage round the table every manche. Sources describe a physical dealer, not a seat index, and matching §3's letter would rewrite every seat-specific deal fixture to buy nothing a player can perceive. Decided by the owner 2026-09-17 on #1090. |
| **What the winner may hand back** | **Not the card just received, and — holding nothing in 3-10 — the single lowest card in hand.** Both are `getValidGivebackCards`, which `pickGivebackCard` (bots, `lib/game/autoMove.ts`) and the UI's offered set both read. | Handing the received card straight back is not an exchange, and `docs/GAME-RULES.md` §10's "any card ranked 3 through 10" has no answer for a hand holding none — an empty offer deadlocks the table behind an undismissable overlay. Both rules shipped in code with no row here. The owner notes the first cannot arise in play: the loser gives their highest card, and the winner may only give back a 10 or lower. Decided by the owner 2026-09-17 on #1090. |
| **What a "session" is** (§4) | **A session lasts until the table breaks up.** Every new match dealt at a standing table opens with the exchange from the last complete rankings — `room:start` included, not the rematch vote alone. The 3♠ opens only a table that has no previous manche to exchange from. | §4's "first hand of a session" was never defined, and the code split on the call site instead: the rematch vote exchanged, `room:start` dealt the 3♠. A player who agrees to a new match at the same table has not left the session; making the format depend on which button ended the last match is the kind of rule nobody can state. Decided by the owner 2026-09-17 on #1090. |
| **A match ended by the unanimous vote** | **No rematch.** Once the penalty-free end-of-match vote carries, the table returns to the lobby; `game:rematch_vote` is refused for that match. A new match is `room:start`, which deals afresh. | The vote exists to release people from a match a seat was vacated from, and its rankings are partial by construction — 2 of 4 seats ranked. Dealing a rematch from them runs the exchange between the wrong two seats, because the 2nd finisher is read as the loser. Refusing the rematch is the rule the vote already implies. Decided by the owner 2026-09-17 on #1090. |
| **A pair whose partner walked out** | **The pair keeps the departed partner's points, frozen.** They count towards the pair's total and towards crossing the target; the vacated seat itself is still never named among the winners. | The same clause as the disconnect policy's "points won before leaving are kept, shown and frozen", applied to the pair rather than the seat. `teamOfKey` dropped the vacated key, so the remaining partner played on alone against a full pair's total while the scoreboard still showed the points that no longer counted. Decided by the owner 2026-09-17 on #1090. |
| **The offline turn clock** | **30 s, the same as the server's AFK timer** (`afkTimeoutMs`). The first hand after the tutorial is timed like any other. | Offline ran 20 s against the server's 30, so the table where a new player learns the game trained them to a deadline a third shorter than the online one that costs them a turn. One number is the rule; a tutorial exemption would make the first real hand feel slower than the game it is teaching. Decided on #1088; the tutorial clause by the owner 2026-09-17 on #1090. |
| **A rematch intent after the verdict** | **Refused once the match is over.** `rematchIntent` is rejected when `gameOver && matchOver`; the stop verdict a finished match reached cannot be reversed from the results screen. | `rematchRefused` is recomputed from the intents on every call, so an intent arriving after `game:over` turned a table that had already declined into one that had not, and dealt a manche out from under it. Technical, decided by the agent session under the owner's ruling 2026-09-17 on #1090. |
| **The seat a free-for-all invite holds** | **None — kept as recorded in `docs/BRIEF.md` §3.3.** A hold is taken in 2-v-2 rooms only. | Re-examined on #1090 and left as it stands: a free-for-all lobby has no sides, so the hold costs the room a seat and buys nothing. Confirmed by the owner 2026-09-17. |
| **Who starts a matchmade table** | **A table quick-match created deals itself a few seconds after its last seat is taken.** A table opened with "create room" still waits for its host, and `room:start`'s `NOT_THE_HOST` / `MATCH_IN_PROGRESS` refusals are unchanged for it. The two are told apart by `rooms.auto_start`, written once at creation — never by `visibility`, which the host may rewrite at any time. | Quick-match seats strangers together and then makes whoever searched first the host, so three people who never agreed to anything wait on one who was never told they had a job. Nobody at a matchmade table chose to host it, so nobody there should have to. Decided on #1088. |
The nine implementation tickets are filed from `docs/DISCONNECT-POLICY.md` §9, in the
order that document gives; the design doc keeps the reasoning and the sources, this table keeps
the decision.
