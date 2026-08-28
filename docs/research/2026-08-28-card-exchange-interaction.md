# The forced card exchange — what the code does now, and what other games do at that moment

Research date: 2026-08-28. Written for #532, which blocks #533. Companion to the four
`/design` mockup sets. **This document produces no production code**, per the ticket.

Read `docs/research/2026-08-26-game-home-screens.md` for the citation standard this follows:
every external claim carries a URL that was actually fetched, quotes are verbatim, and a
verdict is stated plainly even when it goes against the brief.

The owner's request, which is the specification:

> "with current exchange modal user can see only what can give to other player but it doesn't
> actually show the full deck to the player so he doesn't know what other cards he has and he
> cannot properly decide on what is less needed for him... better to show a message in the
> middle of the field prompting the user to select the card to give to 'username' maybe show
> his avatar too... then he has all his deck visible and the cards that he can give are
> highlighted somehow compared to the others... an animation should show the cards actually
> being moved... both at the same time, one takes one side the other the other side they
> should not overlap. and a text that doesn't cover the action shows the exchange or some
> arrows"

And the steer he added on the ticket:

> "My idea was to keep the normal game interface as the exchange modal, just adding correct
> text and animations and movements and arrows etc. idk If I explained myself, but try 3
> totally different designs, to not be too constrained."

---

## 1. The current code, verified

Every fact the triage note asserted was checked against source. **All of them hold.** Two
are worth restating with more precision, and one deserves a correction of emphasis.

### 1.1 The rule

`ExchangePhase` in `lib/gameEngine.ts` is
`{ active, winnerIdx, loserIdx, cardFromLoser, cardToLoser?, bothJokersException }`. The
loser's card is chosen for them by `getBestCardFromHand` the instant the phase opens — the
loser never makes a choice. Only the winner picks, through `processExchangeChoice(state,
cardId)`, validated against `getValidGivebackCards(hand, excludeCardId)`: ranks 3–10,
excluding the card just received, falling back to the single lowest card in hand if the
winner holds nothing in 3–10. Both Jokers in the loser's hand skips the exchange entirely.

Out of scope to change, and nothing below proposes to.

### 1.2 The screen

`components/ExchangeModal.tsx` is a `<Modal transparent visible>` whose overlay is
`Colors.overlay` — `rgba(6,20,16,0.85)` — at `zIndex: 110`. Inside, two columns: the left
shows the received card, a two-headed arrow, and the slot the picked card drops into; the
right shows a **horizontal `ScrollView` containing `getValidGivebackCards`' output and
nothing else**, a confirm button, and a hint line.

`components/table/hand.tsx` has no exchange branch at all — it keeps drawing the full fan
underneath. The scrim is what hides it. **So the winner's other cards are rendered, on
screen, one layer down, and invisible.** That is the owner's complaint, and it is a
compositing decision rather than a missing feature — which is why the fix is cheaper than
it looks.

`onRequestClose` is deliberately inert with a comment saying so: the hand cannot proceed
until a card is picked.

### 1.3 The button premise, corrected

The triage note is right that there are already two buttons and the modal's already carries
exchange copy — `testID="exchange-confirm"`, labelled `t("exchangeModal.confirm")` ("Give
card"), distinct from `gameTable.playLabelGioca` ("PLAY"). **But the owner's premise is not
wrong, it is a request.** He is asking for the table's own GIOCA button to become the
exchange's confirm — because in his design the modal is gone and the table *is* the exchange
screen, so there is only one button on screen and it should be the one his thumb already
knows. Any mockup that keeps a separate floating confirm is answering a different question
than the one he asked.

### 1.4 What already exists that the new interaction should not rebuild

`components/ExchangeAnnouncement.tsx` already solves the hardest-looking part. Two
`FlyingCard`s cross in opposite directions with `toRight` true/false at **different vertical
offsets** — `isMutual ? midY - 100 : midY - 42` and `midY + 16` — so they never occupy the
same space, with a stationary panel of names, an arrow glyph and a sentence sitting clear of
both paths. It fires *after* resolution, to every seat, and its flights are plain
absolute-position `translateX` tweens rather than the `advancePile`/`flightOrigin` machinery
in `components/gameTableModel.ts` — which models exactly one flight, seat to shared pile, and
cannot carry two simultaneous peer-to-peer flights.

**Verdict: the two-way animation is a solved problem in this repo, in the wrong place.** The
work is wiring its pattern into the interactive moment, not inventing it. The vertical
offset trick in particular is already the right answer to "they should not overlap", and §4
below explains why perceptually.

Existing locale namespaces: `exchangeModal.*`, `exchangeAnnouncement.*`, `onlineGame.exchange*`,
`tutorial.beat.exchange.*`, `gameTable.a11yExchange*`, `rules.faq.q10/a10`.

---

## 2. The exchange is asymmetric everywhere, and Murlan restricts it further

This matters because it determines whether "the rest of your hand is unpickable" needs
explaining or can simply be shown.

Pagat's Dai Fugō entry, fetched 2026-08-28
(<https://www.pagat.com/climbing/daifugo.html>), states the standard rule verbatim:

> "the Dai Hinmin must give his highest ranking two cards to the Dai Fugō and the Hinmin
> must give his highest card to the Fugō"

and, for the other side:

> "The Dai Fugō gives any two unwanted cards to the Dai Hinmin and the Fugō gives any one
> unwanted card to the Hinmin."

Dokopa's implementation notes (<https://dokopa.com/en/daifugo/>, fetched 2026-08-28) describe
the same split in software: *"Daifugo and Fugo pick the cards they want to discard. Daihinmin
and Hinmin can't choose (the app auto-picks their strongest cards)."*

**Verdict, and it is the most consequential finding in this document.** In the canonical rule
the winner gives **any** card. Murlan restricts the winner to ranks 3–10. That restriction is
this game's own, it is not something a player arriving from any other climbing game will
expect, and it is the entire reason the current modal filters the hand instead of showing it.

So the design question is not "should the illegal cards be visible" — they must be, the owner
is right — it is **"how does the screen teach a rule the player does not already know, in the
two seconds before they tap?"** A glow on the legal cards answers *which*. It does not answer
*why*. Every option in the mockups is judged against that.

---

## 3. Showing what is choosable: glow the legal, or mute the illegal?

The established pattern is **both, and they are not interchangeable**.

Hearthstone, per Gamer's Experience (<https://www.gamersexperience.com/how-hearthstone-perfects-the-digital-card-collecting-and-deck-building-experience/>,
fetched 2026-08-28):

> "Hearthstone achieves this by utilizing pulsing and glowing visual cues"

and, for the unavailable state:

> "Cards you do not have and cannot currently afford to craft are grayed out to closely match
> the background, clearly indicating that this option is unobtainable at the moment."

The pairing is the point. The glow says *take this*; the grey-out says *this one is not
refusing you, it is simply not part of this decision*. A glow alone leaves the unglowed cards
ambiguous — unstyled reads as "normal", and normal cards in this game are tappable.

In An Age's UI teardown (<https://inanage.com/2013/08/29/hearthstones-ui/>, fetched
2026-08-28) makes the second half of the argument, which is about *not* using text:

> "You don't have to know anything about the specific rules of Hearthstone to know
> intuitively... that A) weapon cards let your hero attack, and B) your hero can't use the
> weapon during an opponent's turn."

and on how the constraint is communicated:

> "Card dragging, creature ovals 'breaking off' from cards, and impact animations create
> visceral feedback that communicates constraints through physicality rather than restrictive
> UI elements."

**Verdict: state the legality in form, not in a sentence.** But see §2 — form can carry
*which*, and Murlan additionally needs *why*, which is one short line and belongs in the
prompt, not on the cards.

### 3.1 Colour cannot be the only channel

Filament Games' accessibility guidance
(<https://www.filamentgames.com/blog/color-blindness-accessibility-in-video-games>, per search
summary 2026-08-28) is unambiguous that vital information must not be carried by colour
alone, and that the remedy is *"including iconography as supplementary conveyance"* —
outlines, arrows, shape changes, or removing the element rather than only recolouring it.

This repo already agrees: `CLAUDE.md`'s design-token rule and `tests/tokenRoles.test.ts`
enforce that a fill token is never used to carry text meaning. **Verdict: every "glow"
option in the mockups must also change something non-chromatic — lift, scale, opacity or
outline width — so the distinction survives a monochrome screenshot.** That is the test the
mockups apply to themselves.

---

## 4. Two cards moving at once: why opposite directions are readable

The owner's instinct — *"both at the same time, one takes one side the other the other side
they should not overlap"* — is correct, and there is a perceptual reason rather than only a
practical one.

Chevalier, Riche et al., *Common Fate for Animated Transitions in Visualization*
(<https://arxiv.org/abs/1908.00661>, abstract fetched 2026-08-28), tested which visual factors
group objects during animated transitions and found a clear hierarchy:

> "Motion dominated... Dynamic luminance and size ranked second, roughly equivalent to each
> other."

Motion is the strongest grouping cue there is. Which is exactly the risk here: **two cards
moving together read as one group, not as two opposite gifts.** Common fate binds them. What
separates them is that their motion vectors differ — opposite direction is the thing that
stops the pair being perceived as a single travelling clump.

**Verdict, in three parts:**

1. **Simultaneous is right**, and the owner's "at the same time" should be taken literally —
   staggering them would read as one card causing the other, which is not what an exchange is.
2. **Opposite directions and separated lanes are load-bearing, not decoration.**
   `ExchangeAnnouncement`'s existing vertical offsets are the correct mechanism; keep them.
3. Because motion outranks luminance and size as a grouping cue, **the two cards must not also
   share a highlight treatment** during the flight — that would re-group what the direction
   just separated.

---

## 5. Text that does not cover the action

Here the research contradicts the brief, and the contradiction is worth stating plainly
before the mockups rather than discovering it afterwards.

The owner asked for *"a message in the middle of the field"*. Superfiles' game-UI guide
(<https://superfiles.in/game-ui-design-guide-diegetic-spatial.php>, fetched 2026-08-28) states
the conventional rule:

> "Safe zones are screen areas (usually corners and edges) where UI won't block critical
> gameplay. The center 60% of the screen should remain clear for action."

and on which register to use:

> "Non-Diegetic overlays work best for clarity-focused games like strategy and mobile titles,
> where players need instant access to numbers and stats."

**Verdict: the owner is right and the guideline is right, because they are about two different
moments.** Before the pick there is no action in the centre of the field — the pile is
resolved, nothing is flying, and the centre is the only place a prompt can sit that the
player's eyes are already on. During the flight the centre is the action, and the same prompt
must be gone.

So the prompt is not a persistent label; **it is a beat that occupies the centre and then
vacates it.** The mockups' fourth set is about how it leaves, not only how it looks. Anything
that stays put through the animation fails the owner's own "doesn't cover the action" test.

This also resolves the avatar question he floated. A prompt that must vanish can afford to be
large and personal — avatar, name, one line — precisely because it is not competing with
anything yet.

---

## 6. What the sources could not settle

Stated so nothing here reads as more grounded than it is.

- **No implementation's exchange screen was seen.** Board Game Arena's Tichu help
  (<https://en.doc.boardgamearena.com/Gamehelptichu>, fetched 2026-08-28) confirms the
  exchange is simultaneous and that a Tichu call before it lets players change their outgoing
  cards, but says nothing about the interface. Dokopa describes only the mechanic. The App
  Store listings for President/Daifugo apps carry no interface description in text. **Nothing
  in this document claims a screenshot that was not read as text.**
- **No vendor design document explains the glow.** Hearthstone's playable-card aura is
  described by third-party teardowns, not by Blizzard. The GDC talk *Hearthstone: 10 Bits of
  Design Wisdom* (<https://www.gdcvault.com/play/1020775/Hearthstone-10-Bits-of-Design>) is
  behind the Vault and was not read.
- **The common-fate paper is about data visualisation, not cards.** Its finding that motion is
  the dominant grouping cue is general perception and transfers; any claim about specific
  durations or easing does not, and none is made.

---

## 7. What the four mockup sets have to answer

Carried into the `/design` sets, one per piece as the ticket requires, three genuinely
different premises each rather than three settings of one dial:

| Set | The question | The constraint from above |
|---|---|---|
| **1. The prompt** | How does the centre of the field ask for a card and name the recipient? | §5 — it must vacate before the flight, so how it leaves is part of the design |
| **2. Legal vs. rest** | How does the full hand show which cards this game will accept? | §3 — glow *and* mute, non-chromatic channel too, and one line of *why* somewhere |
| **3. The two-way flight** | Two cards, at once, one to each side | §4 — simultaneous, opposite vectors, separated lanes, no shared highlight |
| **4. The label** | What names the exchange while it happens | §5 — out of the flight path; §4 — must not re-group the two cards |

And one thing that is not a mockup question because §1.3 settles it: **the table's own GIOCA
button is the confirm.** The owner asked for the normal interface with the exchange layered
on, and a second floating button is the modal coming back in a smaller coat.
