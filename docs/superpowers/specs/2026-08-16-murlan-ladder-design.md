# Murlan — ranked ladder (Q22), design

**Date:** 2026-08-16
**Covers:** `docs/BACKLOG.md` Q22. Supersedes §6 of
`2026-08-16-murlan-features-design.md`, which recorded the shape but left the
season question open.

---

## 1. The decision the old design was blocked on

> "What a season is. Reset monthly? Never? What happens to a rating at reset?"

**A season is a calendar month, UTC, and it is *derived*, never scheduled.**

`season` is the string `YYYY-MM` taken from the moment the hand finished. There
is no reset job, no cron, no migration at the month boundary — the season a
result belongs to *is* its month, so the reset cannot be missed, run twice, or
run late. That matters here specifically: the server sleeps on Replit
(`docs/BACKLOG.md` §3), and a scheduled reset on a host that sleeps is a reset
that eventually does not happen.

**A new season starts from a soft reset**, the industry-standard shape:

```
seed = 1000 + (previous season's rating - 1000) / 2
```

A strong player keeps half their edge and re-climbs; a weak one is pulled back
toward the middle. A hard reset throws away every game of signal each month; no
reset at all ossifies the ladder around whoever played first. Halving is the
compromise both Riot and Psyonix landed on, and it needs no extra storage —
the previous season's row is already there.

**This decision is reversible.** Changing the season key changes which rows new
results land in; existing rows stay readable, because season is part of the
primary key rather than a value that gets overwritten.

---

## 2. Rating

**Pairwise Elo over placement, normalised.** A manche with `n` human seats is
`n(n-1)/2` pairwise results: whoever placed higher beat whoever placed lower.

```
pairs      = n(n-1)/2
actual_i   = (n - placement_i) / pairs          // placement is 1..n
expected_i = Σ_{j≠i} E(r_i, r_j) / pairs        // E is the logistic curve
delta_i    = K_i · (n - 1) · (actual_i - expected_i)
```

Both `actual` and `expected` sum to 1 across the seats. At `n = 2` this reduces
to textbook Elo, which is the check that the generalisation is the right one.

`K` falls as a player's record grows — 40 while provisional, 24 to thirty
games, 16 after — so a new account converges quickly and an established rating
is stable.

**On conservation, precisely.** With one `K` across the table the deltas sum to
exactly zero, and integer rounding is done by largest remainder so that stays
exact rather than approximate. With mixed records the sum is *not* zero and
cannot be: paying a provisional account faster than its opponents lose is what
a provisional period is. The leak per hand is bounded by the spread between the
fastest and slowest `K`, once per pairing a seat takes part in — at most 72
points on a four-handed table with one brand-new player, and zero once everyone
is established. Both properties are pinned rather than assumed, because the
first draft of this design claimed unconditional conservation and was wrong.

**Rated on the manche, not the match.** `handleGameOver` and `match_history`
already work per manche, placement is meaningful per manche, and more results
converge the rating faster. One concept, one granularity.

**Free-for-all only.** A teams result belongs to the pair, not to either
partner, and deriving an individual ladder from team play needs a different
model than pairwise placement. Teams matches are simply not rated, rather than
rated with a model that does not fit.

**Bots are excluded**, as they already are from scoring and history, and a
table that `isContestedTable` rejects is not rated at all.

---

## 3. Farming, and what actually defends against it

The old design named the precondition: "nothing stops two accounts from
farming each other."

**Elo already defends against a fixed pair, and it is worth stating why rather
than adding a mechanism on top.** If A beats B every time, B's rating falls and
A's rises, so A's expected score against B approaches 1 and the payout
approaches zero. The pair asymptotes. `tests/rating.test.ts` pins this: the
second hundred wins in a row are worth a fraction of a percent of the first
hundred. The farm costs a sacrificed account and buys a bounded, shrinking
amount.

**A provisional period** (`PROVISIONAL_GAMES = 5`) keeps a fresh account off
the public ladder until it has a record, so a smurf cannot appear at the top
after one game.

**What is genuinely not solved: many sacrificial accounts.** A player who can
create accounts freely can farm each one to its asymptote. That is account
friction — email verification, rate-limited registration — not a rating
problem, and it is recorded in `docs/BACKLOG.md` §2 rather than pretended away
here. The ladder is honest for the player base that exists; making it
tamper-resistant at scale is a separate, named piece of work.

---

## 4. Storage

`user_ratings`, primary key `(user_id, season)`:

| column | why |
|---|---|
| `user_id` | references `users` on delete cascade |
| `season` | `YYYY-MM`; part of the key, so a reset is a new row and last season stays readable |
| `rating` | integer, seeded by the soft reset |
| `games` | drives `K` and the provisional gate |
| `updated_at` | ordering tiebreak on the leaderboard |

A **new table**, which is the allowed rung: a write to a missing table fails
alone. The write is not awaited and is wrapped, like the stats and replay
writes, so a ladder that has not had `db:push` run cannot fail a game — the
profile simply shows no rating.

Not derived from `match_history`: that table is capped at 50 rows per user, and
Elo is path-dependent, so a derived rating would silently drift as rows are
pruned.

---

## 5. Surfaces

- **Profile**: this season's rating, games played, and the season it belongs
  to. Provisional until five games, shown as such.
- **Leaderboard**: the current season's top 50 past the provisional gate.

---

## 6. What could make this wrong

- **Monthly may be too fast for this player base.** With few players a month
  may not contain enough games to converge. The season key is one function;
  moving to quarterly is a one-line change that leaves old rows readable.
- **Per-manche rating in a long match.** A seven-manche match moves rating
  seven times, so one bad evening moves it more than one bad match would. That
  is the intended trade for convergence speed with few players.
- **The soft-reset constant.** Halving is a convention, not a measurement.
  It is a named constant for exactly that reason.
