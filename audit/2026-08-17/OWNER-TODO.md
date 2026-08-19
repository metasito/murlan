# For the owner — things no batch can do

Everything here needs **you**: a decision only you can make, a real phone, a real browser, or a
person. None of it is work an agent can finish, which is why it sits in its own file instead of
rotting in the batch queue with nobody's name on it.

Written in plain language on purpose. Where a choice affects how the game plays, the options
are spelled out so you can just pick one.

---

## 1. Do this before the next deploy — the app will not start without it

**Run `npm run db:push` against the production database.**

Batch 13 changed how a game in progress is saved. The database still has the old column layout,
and the new code cannot use it. The server checks this when it starts and **deliberately
refuses to boot** with a message telling you to run that command — that is better than starting
up and silently failing to save games, but it does mean a deploy without this step is a dead
app.

Also: the server and the website must be deployed **together**. One of the messages they
exchange changed its wording, so an old website talking to a new server would be rejected.

Nothing is lost by doing this. Any game in progress at that moment ends and players are told the
game is no longer valid — that is the existing, intended behaviour. Best done when nobody is
mid-match.

---

## 2. Three decisions I need from you

I found these while working and deliberately did **not** change them, because each one changes
how the game behaves and that is your call, not mine.

### Question 1 — Who should be named the winner when someone quits a one-hand game?

**What happens now:** in a single-hand online game, if a player leaves, the computer takes over
their seat and keeps playing their cards. If that seat finishes first, the game announces **the
person who left** as the winner, by name — because the seat kept their name when the computer
took over.

**Why it matters:** someone who walked out gets the credit, in front of the people who stayed.
It only affects the announcement — records and rankings already ignore abandoned seats.

**Pick one:**
- **(a)** Leave it. They were winning when they left, so they win.
- **(b)** Name the best-placed player who actually stayed. *(my suggestion)*
- **(c)** Announce no winner for that hand.

### Question 2 — Should computer players get a vote on "play again"?

**What happens now:** when a hand ends, everyone votes on whether to play another. Playing
**offline** against the computer, the computer players get a vote and it counts toward the
total. Playing **online**, computer-controlled seats do not vote at all.

**Why it matters:** the same table behaves differently depending on where you play, which is
confusing and makes "most players agreed" mean two different things.

**Pick one:**
- **(a)** Only humans ever vote. Computers are skipped everywhere. *(my suggestion — a computer
  has no opinion, and it means a table of one human plus bots restarts when that human says so)*
- **(b)** Computers always vote, in both modes.
- **(c)** Leave it as it is.

### Question 3 — Do you want the biggest server file broken up further?

**What happens now:** the main server file went from 2833 lines down to 1686 in batch 13. The
audit asked for under 1000. What is left is mostly the list of the 17 message types the server
handles, written out one after another.

**Why it matters:** purely how easy the code is to work in. Nothing about the game changes.

**Pick one:**
- **(a)** Yes, finish the job — move each message type's code into its own file.
- **(b)** No. 1686 is a big improvement and the important part (the game-over logic can now be
  tested on its own) is already done. *(my suggestion — the remaining gain is small)*
- **(c)** Later, once the audit is finished.

---

## 3. Checks that need a real device, a real browser, or a person

These are genuinely not testable from here. Each has been asserted in code but never *observed*.

- [ ] **On a real phone with the text size turned up high**, open a game and check no card's
      letter or number is cut off. (The cap is set in code and tested; that the cap is *enough*
      has never been seen.)
- [ ] **On a real iPhone and a real Android phone**, check all twelve sound effects play, and
      that the fonts look right after the font-loading change.
- [ ] **Have someone who speaks Italian natively read the Italian messages** the server sends.
      Several were written by me, not by a speaker, and Italian is what most of your players
      read. Specifically: the match-in-progress, new-match-not-ready, rematch-declined and
      invalid-card messages, and the per-seat pass marker currently reading **PASSO**.
- [ ] **Open the card-exchange screen and press Tab five times**, checking the focus stays
      inside the pop-up and does not wander onto the table behind it. Needs a played-out hand,
      which is why it was never automated.

---

## 4. One thing to decide about the audit itself

Two batches (**11** and **12**) merged while still owing work — three items had their name on
them and were never done. I have re-homed those three into the new **Batch 14**, so they are not
lost. Worth knowing that the merge gate ("nothing deferred") did not hold twice, and that the
ledger only caught it because someone went looking.

Separately: after every batch merges, the green tick on `main` has been **hollow** — the run
that would have tested the merged code gets cancelled by the docs commit that follows it
seconds later, and that docs commit skips all the real steps because it only touches prose. The
code is still tested on the pull request before merging, so nothing unsafe has shipped, but
`main`'s green badge has not meant what it looks like since at least batch 11.
