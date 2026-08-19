# For the owner — things no batch can do

Six items, three of them short reads. Everything else that used to be here was decided and
is done — see `DECISIONS.md` **D8-D14**.

---

## 1. Before the next deploy — the app will not start without it

**Run `npm run db:push` against the production database.**

Batches 13 and 14 changed how a game in progress is saved. The database still has the old column
layout and the new code cannot use it. The server checks this at startup and **deliberately refuses to
boot**, with a message naming this command — better than starting up and silently failing to
save games, but it does mean a deploy without this step is a dead app.

The server and the website must be deployed **together**. One of the messages they exchange
changed its wording, so an old website talking to a new server would be rejected.

Nothing is lost. Any game in progress at that moment ends and its players are told the game is
no longer valid — the existing, intended behaviour. Best done when nobody is mid-match.

Batch 14 has landed, so this is now the whole of it: two renamed columns and one added field in
the saved-game format, all carried by that single `db:push`.

---

## 2. On a real iPhone and a real Android phone

- [ ] Check all twelve sound effects play.

Not observable from here. MP3 decoding on iOS in particular is asserted, not measured — the risk
is low (AVFoundation has decoded MP3 for as long as it has existed) but it has never actually been
heard on a device.

**The two font checks that used to be on this list are done.** `tests/e2e/webFonts.spec.ts`
measures the Albanian ë and the Italian à against the fallback face in a real browser, so a subset
missing a glyph fails rather than shipping tofu. `tests/e2e/a11yOverlays.spec.ts` grows every text
in the table by the cap the app declares and measures the glyphs against the card that clips them,
then runs the same measurement uncapped and requires it to find clipping — so the pass is not free.
The full Playwright suite was run for the font change.

---

## 3. Two minutes on the Italian (D14)

Batch 14 reviewed the server-facing Italian and corrected the one string that was clearly wrong:
**`server.REMATCH_DECLINED`** now reads *"Il tavolo ha rifiutato la rivincita"* rather than *"…ha
scelto di non rigiocare"* — *rivincita* is the word Italian card games use for a return match.

Three judgement calls are left, and each takes one word from you:

- **The per-seat pass marker reads `PASSO`.** On your own seat that is right — it is what a player
  says. On somebody else's seat it is still first person, so Bea's seat says *"I pass"* in Bea's
  voice. A third-person *PASSATO* would describe instead of declare. *PASSA* is not available: it
  is byte-identical to the PASSA button, which would make one word mean both an action you can
  take and a seat's state.
- **`il tavolo`** for the group of players, in the string above. Standard at a card table, but if
  it reads oddly, *"Gli altri giocatori hanno rifiutato la rivincita"* is the alternative.
- **`server.NEW_MATCH_NOT_READY`** — *"…pronti prima di iniziare una nuova partita"*. *"…pronti per
  iniziare…"* is slightly smoother. Marginal either way.

---

## 4. A decision, not a review: four Italian strings assume a man is playing

Not part of the audit and not fixed, because the fix is a product decision rather than a wording
one. These four render masculine agreement whoever the player is:

| Key | Italian | Reads as |
|---|---|---|
| `server.PLAYER_AFK_AUTO_PASS` | *{{username}} è inattiv**o** — passat**o** automaticamente* | he |
| `server.PLAYER_AFK_AUTO_EXCHANGE` | *{{username}} è inattiv**o** — carta scambiata…* | he |
| `server.PLAYER_DISCONNECTED_GRACE` | *{{username}} si è disconness**o**…* | he |
| `server.PLAYER_RECONNECTED` | *{{username}} è rientrat**o**.* | he |

A woman playing is described in the masculine, to the whole table, several times a hand. Two ways
out: rewrite each into a form that carries no gender (*"{{username}}: turno passato per
inattività"*), or record gender on the account and pick the ending. The first costs nothing and is
what most Italian software does; the second is a schema change and a signup question. **Albanian
probably has the same problem** — `sq.ts` has never had a native read either.

---

## 5. The icon fonts are now the biggest thing the web downloads

Batch 14 took the six text weights from 2,123,508 B of TTF to 99,016 B of WOFF2. That leaves
`Ionicons.ttf` (389,724 B) and `Feather.ttf` (55,596 B) shipped whole — 445 KB for a few dozen
glyphs, and now 82% of the font bytes a web visitor fetches.

Subsetting them is the same technique, with one extra step: the set has to be derived from the
`name="…"` props across the app rather than from the strings. No finding covers it, so nothing is
scheduled — it is a backlog item if the download size matters, and nothing at all if it does not.

---

## 6. One Playwright case fails about one run in seven, and always has

`tests/e2e/tableFit.spec.ts` — *the table fits the screen › small phone landscape, 4 players*.
Measured **3 failures in 20** against the code as it was before Batch 14 touched fonts, so it is
not the font change; it was simply never noticed, because **CI runs no Playwright step at all** and
the suite only runs when somebody runs it by hand.

What escapes the screen is the right seat's fan of card backs, which is built from fixed pixel
sizes — so the test is sampling a moment while the table is still settling rather than catching a
real layout defect. Its whole settling logic is a two-second wait, and the bots start playing
immediately in the E2E build. Worth fixing when the suite next gets attention: either wait for the
table to stop moving, or leave out what is mid-animation.

---

## Worth knowing about the audit process

**Two batches merged while still owing work.** Batches 11 and 12 each closed with items that had
their name on them and were never done — three in total. They are re-homed into Batch 14, but
the merge gate's "nothing deferred" condition did not hold twice, and the ledger only caught it
because someone went looking.

**`main`'s green tick has been hollow since at least batch 11** — the run that would test merged
code was cancelled by the documentation commit following it, and that commit skipped every real
step because it only touches prose. Batch 11's and batch 12's post-merge runs each executed
**0 of 5** real steps. Nothing unsafe shipped: the code is fully tested on the pull request
before merging. **Batch 14 fixes it (D12).**
