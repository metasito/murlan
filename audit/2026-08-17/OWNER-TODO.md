# For the owner — things no batch can do

Two items. Everything else that used to be here has been decided and scheduled into **Batch 14**
— see `DECISIONS.md` **D8–D14**.

---

## 1. Before the next deploy — the app will not start without it

**Run `npm run db:push` against the production database.**

Batch 13 changed how a game in progress is saved. The database still has the old column layout
and the new code cannot use it. The server checks this at startup and **deliberately refuses to
boot**, with a message naming this command — better than starting up and silently failing to
save games, but it does mean a deploy without this step is a dead app.

The server and the website must be deployed **together**. One of the messages they exchange
changed its wording, so an old website talking to a new server would be rejected.

Nothing is lost. Any game in progress at that moment ends and its players are told the game is
no longer valid — the existing, intended behaviour. Best done when nobody is mid-match.

> **Wait for Batch 14 before deploying.** D11 adds one more field to the saved-game format, and
> shipping it in the same deploy costs nothing. Deploying now and adding it later would discard
> everyone's in-progress game a second time for the same fix.

---

## 2. On a real iPhone and a real Android phone

- [ ] Check all twelve sound effects play.
- [ ] Check the fonts still look right after the font-loading change.

Neither is observable from here. MP3 decoding on iOS in particular is asserted, not measured —
the risk is low (AVFoundation has decoded MP3 for as long as it has existed) but it has never
actually been heard on a device.

Batch 14 is attempting the *large-text* check in a browser (D13). If that turns out not to prove
anything honestly, it will come back to this list rather than ship a test that passes without
demonstrating the property.

---

## Coming back to you later, briefly

Batch 14 reviews the Italian the server shows players and will leave a **short list of only the
genuinely uncertain phrasings** (D14) — a two-minute read, not a full translation review.

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
