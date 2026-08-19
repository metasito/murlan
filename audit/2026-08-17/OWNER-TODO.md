# For the owner — things no batch can do

Everything here needs **you**: a real phone, a real browser, a person, or a deploy. None of it
is work an agent can finish, which is why it sits in its own file instead of rotting in the
batch queue with nobody's name on it.

The three behaviour questions that used to be in this file are **answered** and are now
`DECISIONS.md` **D8**, **D9** and **D10**, with the two that change how the game plays written
into `docs/BRIEF.md` §3.1. Batch 14 implements them. Nothing to do here.

---

## 1. Do this before the next deploy — the app will not start without it

**Run `npm run db:push` against the production database.**

Batch 13 changed how a game in progress is saved. The database still has the old column layout,
and the new code cannot use it. The server checks this when it starts and **deliberately
refuses to boot**, with a message telling you to run that command — better than starting up and
silently failing to save games, but it does mean a deploy without this step is a dead app.

Also: the server and the website must be deployed **together**. One of the messages they
exchange changed its wording, so an old website talking to a new server would be rejected.

Nothing is lost by doing this. Any game in progress at that moment ends and its players are told
the game is no longer valid — that is the existing, intended behaviour. Best done when nobody is
mid-match.

---

## 2. Checks that need a real device, a real browser, or a person

Each of these has been asserted in code but never actually *observed*. They are not testable
from here, which is exactly why they have stayed open since batch 6.

- [ ] **On a real phone with the text size turned up high**, open a game and check no card's
      letter or number is cut off. The cap is set in code and tested; that the cap is *enough*
      has never been seen.
- [ ] **On a real iPhone and a real Android phone**, check all twelve sound effects play, and
      that the fonts still look right after the font-loading change.
- [ ] **Have someone who speaks Italian natively read the Italian messages** the server sends.
      Several were written by me, not by a speaker, and Italian is what most of your players
      read. Specifically the match-in-progress, new-match-not-ready, rematch-declined and
      invalid-card messages, and the per-seat pass marker currently reading **PASSO**.
- [ ] **Open the card-exchange screen and press Tab five times**, checking focus stays inside
      the pop-up and does not wander onto the table behind it. Needs a played-out hand, which is
      why it was never automated.

---

## 3. One design decision still open

**A player who cold-starts into a game whose room record is missing gets no room screen.**

Batch 13 fixed the common case — if reading the player list fails, the server now falls back to
the live game's own seats. What is still uncovered is the rarer case where the *room record
itself* is gone: the six-character join code lives only in that record, so there is nothing
truthful to put on screen, and inventing a code would show players something they cannot join
with.

Fixing it means storing the join code alongside the saved game. That changes what is written to
the database, and `CLAUDE.md` asks for a written design before any storage change — so it needs
a decision from you before it can be scheduled, rather than being quietly folded into a batch.

---

## 4. Two things worth knowing about the audit process itself

**Two batches merged while still owing work.** Batches 11 and 12 each closed with items that had
their name on them and were never done — three in total. They are re-homed into Batch 14 so they
are not lost, but the merge gate's "nothing deferred" condition did not hold twice, and the
ledger only caught it because someone went looking.

**The green tick on `main` has been hollow since at least batch 11.** After each batch merges,
the CI run that would have tested the merged code gets cancelled by the documentation commit
that follows it seconds later, and that documentation commit skips every real step because it
only touches prose. The code is still fully tested on the pull request before merging, so
nothing unsafe has shipped — but `main`'s badge has not meant what it looks like. Worth fixing
before anyone starts trusting it.
