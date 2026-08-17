# Murlan — remaining feature set, design

**Date:** 2026-08-16
**Covers:** `docs/BACKLOG.md` Q23 and Q26 — the two of the original seven that are
still unbuilt. Q17, Q18, Q20, Q22 and Q25 have shipped and their sections are
gone; what they decided lives in the code and in their backlog entries, which is
where it gets read.

This is a design, not a queue. `docs/BACKLOG.md` remains the queue.

---

## 1. The constraint that shapes both

**A new database column cannot be written until someone runs `db:push` on
Replit, and there is already one outstanding** (`active_games.match_length`).
Until it runs, every write that touches the new column fails. Drizzle sends one
`INSERT … ON CONFLICT DO UPDATE` per upsert, so a missing column does not fail
in isolation — it fails the whole statement, taking unrelated data down with it.

This has already bitten twice, and both times the fix was to avoid the column:

- `handFlags` rides the existing `game_state` jsonb envelope.
- The daily streak is derived from `match_history` rows that already exist.

### The rule for everything below

> Prefer, in order: **derive from existing rows** → **ride an existing jsonb
> column** → **a new table** → **a new column on an existing table**.
>
> A new *table* is acceptable where the first two are not enough, because a
> write to a missing table fails alone. The feature is unavailable until
> `db:push` runs; nothing else breaks. A new *column on a hot table* is not
> acceptable, because it breaks writes that have nothing to do with the feature.

Every new table therefore needs its write wrapped so its failure cannot
propagate, and its read to degrade to "not available" rather than to an error
screen.

### Constraints inherited from the repo

- **Replit must keep working.** No build step needing local tooling; no change
  to how the server starts.
- **Server authority.** The client never decides an outcome. Anything new that
  a client can send is validated by a zod schema in `server/socketSchemas.ts`
  or `server/schemas.ts` and rate-limited.
- **No game-rule changes** (`lib/gameEngine.ts` is specified by `docs/RULES.md`).
  AI *strategy* is not a rule and may change; what constitutes a legal play may
  not.
- **Every user-facing string** goes through `t()` with keys in `it`, `en`, `sq`.
- **No new runtime dependency** unless the item below names one and justifies it.
- **Listener registration precedes every `await`** in the socket connection
  handler.

---

## 7. Q23 — "Your turn" push notifications

**Verdict: build after the ladder. Ships inert; the owner supplies credentials.**

**New dependency:** `expo-notifications`. Justified: there is no other way to
reach a backgrounded app, and it is the Expo-managed path, so it does not cost
the managed build pipeline.

**Storage:** `push_tokens` (`user_id`, `token` pk, `platform`, `updated_at`).
A token is **new personal data** — the privacy policy needs an entry before this
ships, and that is an owner action, listed in `docs/BACKLOG.md` §2.

**Design:**

- The client registers a token after login and on change; it is deleted on
  logout and on account deletion (the existing cascade covers the latter if the
  table references `users` with `on delete cascade`).
- The server sends at most one "your turn" per turn, and **only when the player
  has no live socket** — notifying someone who is looking at the table is the
  fastest way to get notifications disabled.
- Delivery goes through Expo's push service, which needs FCM (Android) and APNs
  (iOS) credentials uploaded to EAS. Without them the send fails and is logged;
  the game is unaffected.
- A per-user quiet period so a fast table cannot produce a stream of pushes.

---

## 8. Q26 — Tournaments

**Verdict: not now. Design recorded so the shape is known.**

Bracketed multi-table events are the largest item in the backlog and the only
one that needs new *coordination* rather than new storage: a tournament owns
many rooms, advances players between them, and has to survive a restart with
players mid-match. That is a scheduler, and a scheduler on a single always-on
instance with all state in memory is the one place the Replit hosting question
(§3 of the backlog) stops being theoretical.

**Precondition:** move the server somewhere with no cold starts, or accept that
a sleeping Repl ends a tournament. That is `docs/BACKLOG.md` B4, which the
owner has deferred. Tournaments stay deferred with it.

---

---

## 9. Why these two are still here

Neither is blocked on effort. Q23 needs FCM and APNs credentials and a
privacy-policy entry covering push tokens, both owner actions (`docs/BACKLOG.md`
§2, O7). Q26 needs the hosting question answered: a tournament is a scheduler,
and a scheduler on a host that sleeps is a tournament that ends when the host
does.
