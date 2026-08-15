# Murlan — Depth & Durability Design

**Date:** 2026-08-16
**Status:** Design, self-directed
**Preceding work:** Security, resilience, engine correctness, GUI, screen deduplication,
tutorial, CI and i18n are all shipped — see `docs/PLAN.md`. This spec covers what comes next.

---

## 1. Why this, and why not other things

The app is now correct and safe. It is not yet *durable*: multiplayer correctness is only
unit-tested, a room stalls if nobody else joins, and there is no reason to open it tomorrow.

This design was produced by benchmarking against the three largest Murlan implementations
(Murlan Pro, murlan.app, Murlan Arena) and against 2026 mobile retention data. Every item
below is engineering-only. Anything requiring a business decision is listed in §7 and is
**not** built.

### Explicitly rejected, with reasons

Rejecting work is the more useful half of a design.

- **Replacing `deepCloneState` with structural sharing.** Proposed to unlock memoization
  and speed the engine. Measured first: **0.96 ms per move** for a full AI turn including
  the clone. A 54-card state is simply not big enough for this to matter. Not doing it.
- **`React.memo` across the card components.** Already investigated and correctly declined:
  the React Compiler is active on those files, and `deepCloneState` gives every card a new
  reference per transition, so a shallow comparator can never hit. An incomplete custom
  comparator causes stale renders — strictly worse than none.
- **Free-text in-game chat.** All three competitors ship it. We will not. It creates
  moderation obligations and an App Store risk in a game with minors, for no gameplay gain.
  Emoji reactions already cover the social signal.
- **A general-purpose "achievements framework".** YAGNI. A flat table of achievement
  definitions and a check hook is enough; an engine with triggers and conditions is not.

---

## 2. Scope

Five workstreams, in dependency order.

### S1 — Multiplayer integration tests *(highest value; everything else rides on it)*

**Problem.** 433 tests cover pure logic. Not one exercises a real socket. Every serious
bug this project has had — impersonation, the seat deadlock, seat-map corruption on
rejoin, the exchange bypass — lived in the socket layer, and none of them would have been
caught by the current suite. `docs/PLAN.md` W5.3 deferred this because `server/storage.ts`
and `server/db.ts` use extensionless relative imports that plain `node --test` cannot load.

**Design.** Make the server modules import-safe under Node's type-stripping (add explicit
extensions), then add an integration suite that boots the real Express + Socket.io server
against a throwaway Postgres schema and drives it with `socket.io-client`.

Scenarios that must be covered, because each maps to a bug that actually occurred:
- A client presenting no ticket, an expired ticket, and a replayed ticket is rejected.
- A client cannot receive another player's hand via any event.
- Play and pass are rejected during an active exchange phase.
- A disconnect past the grace period hands the seat to the AI and the table keeps moving.
- Kill and restart the server mid-game: seats, hands, mode and cumulative scores all survive.
- A malformed payload on every inbound event leaves the process alive.

**Database.** Tests create and drop their own schema. They never touch the dev database.
If `DATABASE_URL` is absent the suite skips with a clear message rather than failing, so
`npm test` still works for someone without a database.

### S2 — Bot fill for empty seats

**Problem.** A room with fewer than the required players simply waits. Every competitor
fills empty seats with bots. We already have `aiChoosePlay` and the seat-takeover machinery
built for disconnects — this is wiring, not new capability.

**Design.** The host may start with empty seats filled by AI. Bot seats are marked in the
game state so the UI can label them honestly, and they are already excluded from match
scoring (done during the resilience work). Bot difficulty is a room setting.

**Rule boundary:** this changes *who* occupies a seat, never what a seat may legally do.
Bots play strictly through the same validation path as humans.

### S3 — Stats, match history and achievements

**Problem.** Nothing persists across sessions, so there is no reason to return.

**Design.** Three additions on top of the persistence that already exists:
- **Stats** — games played/won, win rate, longest streak, favourite combination, per mode.
  Written server-side at game over, read via one REST endpoint.
- **Match history** — the last **50** completed games per user, with final rankings and
  scores. The `active_games` row is already being deleted at game over; archive a compact
  summary instead of discarding it, and prune beyond 50 on write so the table cannot grow
  without bound.
- **Achievements** — a flat definition table evaluated at game over (win with a bomb, win
  without playing a joker, win a match 21–0, and so on). Local evaluation, server-persisted.

Deliberately **not** included: any leaderboard or rating. See §7.

### S4 — Accessibility completion

The GUI wave added labels and touch targets to new components. Finish the job on the game
table itself, which is where it matters and where it is hardest:
- A screen reader must be able to convey the table state: whose turn, what was played,
  how many cards each opponent holds, and what the player's own hand contains.
- Card identity must never depend on colour alone — verify the pip shape carries it.
- Support dynamic type where the layout can absorb it, and degrade honestly where it cannot
  (the landscape-locked table has hard geometric limits; say so rather than clipping).
- Reduced motion is already honoured; audit that nothing added since regressed it.

### S5 — Bundle and dependency audit

Measure, then cut. The audio already dropped 53%. Produce an actual per-asset and
per-dependency size report, remove anything unused, and record the resulting numbers so
future regressions are visible. No speculative optimisation — measure first, and if
something is already small, leave it alone and say so.

---

## 3. Architecture

Nothing here changes the shape of the system. S1 adds a test harness. S2 extends the
existing seat model. S3 adds three tables and one REST surface, following the patterns in
`server/storage.ts`. S4 and S5 are non-structural.

New persistence (one migration, one owner, per the lesson recorded in `docs/PLAN.md` P2):

| Table | Purpose |
|---|---|
| `user_stats` | one row per user, counters updated at game over |
| `match_history` | compact archived summary of a completed game |
| `user_achievements` | which achievements a user has unlocked, and when |

`npm run db:reset` continues to be the intended recovery path; there is no migration story.

---

## 4. Testing

- S1 is itself the test work.
- S2: bot seats are covered by the S1 integration suite, plus unit tests for seat assignment.
- S3: pure achievement evaluation and stat aggregation are unit-tested against fixed game
  results. The REST endpoints are covered by the integration suite.
- S4: assertion-based checks where possible (labels present, targets ≥44pt, contrast ratios
  already locked by `tests/contrast.test.ts`). Screen-reader *flow* cannot be unit-tested
  and must be verified on a device — say so rather than claiming coverage.
- S5: a size report committed as data, so a future increase is visible in a diff.

## 5. Error handling

Follows existing practice: the server validates and emits a stable code plus params; the
client renders it in the player's language. New endpoints reuse `requireAuth` and the
existing rate limiters. Stats and achievement writes must never be able to fail a game —
they are best-effort and logged, never blocking the game-over path.

## 6. Order and risk

S1 first: it is the safety net for everything after it. Then S2 (small, self-contained),
then S3 (largest surface), with S4 and S5 runnable in parallel throughout.

Highest risk is S3's migration touching the same file three workstreams want. One owner,
one migration, as before.

---

## 7. Flagged — not built, requires a decision that is not mine

| Item | Why it is not an engineering decision |
|---|---|
| **"Your turn" push notifications** | The single strongest retention lever for a turn-based game, and the engineering is standard. But it needs APNs and FCM accounts, stores push tokens (new personal data), and requires a privacy-policy entry. Ops and legal, not code. |
| **Ranked ladder / seasonal leaderboard** | Competitors ship both. It is a product commitment: seasons need resetting, rewards need defining, and a public ladder invites cheating pressure that changes the security posture. |
| **Monetization of any kind** | Murlan Pro charges $0.99/month to remove ads. Whether this app monetizes at all is a business decision, and the retention data is clear that doing it badly costs more than it earns. |
| **Crash and analytics reporting** | Valuable, but any SDK is a third-party data processor and changes the App Privacy answers. |
| **Free-text chat** | Rejected on moderation grounds — see §1 — but reversible if the owner wants it. |
| **Any change to the rules** | `docs/RULES.md` is settled. Rule changes go to the owner. |
