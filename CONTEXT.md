# Context

Domain glossary and pointers to where a concept's design lives, sharpened over time by
`mattpocock-skills:domain-modeling`. A decision that constrains the whole repo belongs in
`docs/adr/`, not here. What does belong here, next to the term it guards, is a dated note that a
specific change to *that term* was researched and rejected — narrow enough that it is part of the
term's meaning, and useless anywhere the term is not.

## The game

The rules themselves are `docs/GAME-RULES.md`; these are the words for them.

### Scoring

**Manche**:
One deal played until a single seat still holds cards.
_Avoid_: hand (that is the cards a seat holds), game, round

**Partita**:
The manches a table plays until a seat or team reaches the target; the unit that is won, drawn, rated and rematched.
_Avoid_: match, game

**Finishing order**:
The order seats went out in one manche, first to last; a seat's place in it is its **placement**.
_Avoid_: rankings (a card has a rank)

**Placement points**:
What a placement earns: N−1 for first down to 0 for last.
_Avoid_: hand score

**Target**:
The partita total that ends the partita; a tie on it **escalates** the target one rung up its ladder, and a tie on the last rung is a draw.

**Standings**:
Every seat's or team's running partita total, best first.
_Avoid_: leaderboard (that is the rated ladder across partite)

### Play

**Round**:
The plays that follow a lead until every other active seat passes in a row; the last player wins it and leads the next.
_Avoid_: trick

**Lead**:
The play that opens a round, with any combination.

**Opening**:
The lead of a manche with no exchange before it, which must contain the 3♠ (or, at two seats, the lowest dealt card).
_Avoid_: start card (that is the card, not the play)

**Combination**:
The shape of a play: single, pair, triple, straight, bomb or royal straight.

**Straight**:
Five or more cards of consecutive rank, suits ignored.
_Avoid_: scale, shkallë, sequence

**Bomb**:
Four cards of one rank; beats any combination but a higher bomb or a royal straight.
_Avoid_: quadruple, poker, quad

**Royal straight**:
A straight of one suit; beats any bomb.
_Avoid_: flush

**Pass**:
Declining to beat the play on the table; it does not lock the seat out of the round.

**Going out**:
Playing one's last card, which fixes the seat's placement and takes it out of the manche.

### Between manches

**Exchange**:
The swap before a manche whose table has a complete finishing order to take it from: the previous manche's last seat gives its highest card to the first seat, who gives back a card of their choice.
_Avoid_: swap, trade

**Giveback**:
The card the first seat returns in an exchange: ranked 3 to 10, never the card just received.
_Avoid_: return card

**Two-Joker exception**:
A last seat holding both Jokers shows them and no exchange happens; the first seat leads instead.

### The table

**Table**:
The seats that stay together across partite; its lifetime is what `docs/GAME-RULES.md` §4 calls a session.
_Avoid_: session (that is a login)

**Free-for-all** / **Teams**:
The two modes: every seat for itself, or two teams of two sitting opposite.

**Team**:
Two seats sitting opposite, scored on their combined placement points.
_Avoid_: pair (that is a combination), side

**Bot**:
A seat played by the computer, whether born one or taken over.
_Avoid_: AI, CPU, computer

**Vacated seat**:
A human's seat whose player did not return within the grace period; a bot plays it on, and it is never named the winner.
_Avoid_: dropped seat

**Abandonment**:
The last-place finish recorded against a player who left a manche before it ended.
_Avoid_: forfeit, rage-quit

## Design pointers

- **Account recovery** — the register / verify-email / add-email / resend-verification /
  request-password-reset / reset-password state machine. Its authoritative shape (states,
  transitions, the enumeration-safety and race-condition invariants) is `docs/adr/0007-account-recovery-email-verification-and-password-reset.md`,
  whose six boxes are cited by number from every handler in `server/http/routes.ts`. A future review proposing to consolidate this flow into
  an "owning module" should read that spec first — the state machine is already consolidated,
  just not as code, and each route's await-vs-fire-and-forget timing relative to `res.json()`
  is a deliberate per-route timing-oracle defense, not duplication.

  Its **client** half is five screens that each run their own request block. That is not the same
  finding and was reviewed separately on 2026-09-10: the blocks rhyme but differ in the busy flag
  they set, the success action they take (`setStep`, `router.replace`, `refreshUser`, a cache
  invalidation, a notification) and the surface the error lands on, so a shared hook would take
  five callbacks and save nothing. `app/auth.tsx` and `app/recover.tsx` additionally carry #897's
  enumeration-safety behaviour on their success paths, which must survive any change to them.

- **The online table's surface** — the 38 fields a screen reads from `OnlineGameContext`, exposed
  as the six slices in `context/onlineGameHooks.ts` (connection, room, table, turn clock, match,
  exchange). The slices are the seam, and `tests/ui-rules/contextSlices.test.ts` pins both that they
  partition the surface exclusively and that nothing outside four files reaches past them.

  A review proposing to extract a pure `reduce(state, event)` module from the provider should stop:
  it was researched on 2026-09-10 and rejected. Fourteen of the roughly twenty socket handlers
  interleave side effects — a socket `ack`, three refs read at event time, `AsyncStorage` writes,
  `queryClient.invalidateQueries`, a retry timer that emits — so a reducer would have to carry an
  effect queue out. The listener effect's dependency array was measured at the same time and is
  entirely stable, with twenty `on` and twenty matching `off`: there is no listener churn and no
  leak to fix. What was real is #961, one context per slice.

- **Feedback master state** — the enabled/volume globals in `lib/device/feedback.ts`, driven by three
  setters from `context/SettingsContext.tsx`. The music pair became one setter, because a volume of 0
  stops the track. A review proposing to collapse the setters behind one
  `applyFeedbackSettings(settings)` entry point should not: each effect has its own dependency for a
  reason, the haptics one is gated on `readFinished` because `lib/device/feedback.ts` preloads its key at
  module init, and a single entry point would fire every setter whenever any one value changed.

- **Notice** — anything the table tells a player in words on a plate of its own: the turn pill,
  a seat's PASSO, the combination, the connection notes, who starts, a refusal. A notice has a
  *kind* (which surface it is), a *shape* in the lantern mockup's vocabulary — `pill`, `chip` (the
  mockup's mark), `float`, `panel` — and a *tone* (`neutral`, `lit`, `urgent`, `ok`, `bad`, `solid`, `gold`)
  its shape must be able to paint. A notice is painted by `components/table/TableNotice.tsx` from
  `NoticePalette` in `lib/tokens.ts` once it has moved there: the HUD combination pill, the turn
  pill, who starts, the seat marks and the pile's marks (the combination, the round winner, the
  exchange label), the table's one float (the viewer's own pass, a refused play, a server error)
  and the hand row's lines (waiting for the others, an empty hand) have; the rest move in #1259
  plan 5's later tasks. Its kinds, their geometry in mockup pixels and their timings
  are `components/table/noticeModel.ts`, and each kind's gallery is
  `components/table/notices/gallery.tsx`. Not a notice: the banners over the app
  (`NotificationBanner`), which are news about the app rather than about the table.

## Working with this vocabulary

- **Name a domain concept with the repo's own word** — in an issue title, a test name, a
  hypothesis. A synonym for something the code already names starts a second vocabulary.
- **This file grows one term at a time**, as each is resolved; a term it does not carry yet is
  not a gap to fill upfront.
- **Say so when a change contradicts an ADR**, rather than quietly overriding it:

  > _Contradicts ADR-0002 (a play leaves the seat it was thrown from), but worth reopening
  > because…_

- `docs/adr/README.md` indexes the ADRs a term's design cites.
