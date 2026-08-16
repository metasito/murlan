# Murlan — remaining feature set, design

**Date:** 2026-08-16
**Covers:** `docs/BACKLOG.md` Q17, Q18, Q20, Q22, Q23, Q25, Q26 — the seven items
large enough that wiring them wrong is expensive to undo.

This is a design, not a queue. `docs/BACKLOG.md` remains the queue.

---

## 1. The constraint that shapes all seven

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

## 2. Q18 — Spectator mode

**Verdict: build first. It is nearly free, and the reason is already in the code.**

`sanitizeStateForPlayer` derives the viewer's seat with `findViewerSeat`, and
blanks the hand of every seat that is not the viewer's. A spectator is a viewer
whose seat is `null`, so *every* hand comes back empty with no new sanitisation
path and no risk of leaking a hand. The dangerous part of spectating is already
solved.

**Storage:** none. Spectators are a per-room in-memory `Set<userId>`, like
`publicRoomIds`.

**Design:**

- `OnlineGameState` gains `spectators: Set<string>`. It is **not** persisted:
  a spectator who reconnects re-joins as one, and a server restart dropping
  spectators costs nothing.
- New socket events, both validated and rate-limited:
  - `room:spectate { code }` — joins the socket to the room without a seat,
    replies with the sanitized state. Refused when the room does not exist.
  - `room:unspectate` — leaves.
- `emitStateToRoom` already iterates seats; it gains a second loop over
  spectators, sending `sanitizeStateForPlayer(state, spectatorUserId, playerMap)`
  — which, with no seat, is the all-hands-hidden view.
- **Not allowed:** `game:play`, `game:pass`, `game:exchange_card`,
  `game:rematch_vote`, `game:reaction`. The existing handlers already resolve
  the actor's seat and reject an unknown one; a spectator must hit that same
  path, so the check is "no seat" rather than a new spectator branch.
- **Who may spectate:** a friend, or anyone if the room is public. Not a
  stranger's private table.
- **Client:** the friends list gains a "watch" affordance when a friend is in a
  game. The game screen renders `GameTable` with `viewerSeat = null`; the hand
  section shows the pile and the opponents, and the action buttons are absent
  rather than disabled.

**Risk:** the seat-derivation path is load-bearing for hand secrecy. The
integration suite must gain a test asserting a spectator receives no hand at
all, alongside the existing "a player never receives another player's hand".

---

## 3. Q20 — Bot personalities

**Verdict: build second. No storage, contained blast radius.**

`aiChoosePlay(player, …)` already switches on `player.difficulty`
(`easy | medium | hard`). A personality is a named preset over that plus a small
number of legal-play *preferences* — never a change to what is legal.

**Design:**

- New pure module `lib/botPersonalities.ts`:
  ```ts
  export interface BotPersonality {
    id: string;                 // stable, stored in room config
    nameKey: TranslationKey;    // display name
    blurbKey: TranslationKey;   // one line shown when picking
    difficulty: AIDifficulty;   // maps onto the existing engine strategy
    /** 0-1. How readily it spends a bomb or a 2/joker. */
    aggression: number;
    /** 0-1. How much it varies from the strictly best play. */
    unpredictability: number;
  }
  ```
- `aiChoosePlay` gains one optional parameter carrying `aggression` and
  `unpredictability`, defaulting to today's behaviour exactly. The existing
  difficulty branches stay; the two numbers only re-rank an already-legal
  candidate list. **`getAllValidPlays` is not touched.**
- Determinism: `unpredictability` needs randomness, and the engine is currently
  deterministic, which is what makes its tests strong. The random source is a
  parameter with a default, so tests inject a fixed sequence and stay
  deterministic.
- Offline: the lobby's difficulty picker becomes a personality picker. Online:
  `room:start`'s existing `botDifficulty` field gains a sibling
  `botPersonality`, validated against the known ids.
- Four or five personalities, no more. Each must be *describable in one line*
  and actually distinguishable across a hand, or it is decoration.

**Risk:** a personality that plays badly enough to be annoying is worse than no
personality. Each one needs a test asserting it still finishes hands and never
returns an illegal play — the existing property test over `getAllValidPlays`
covers legality, so the new tests cover "does not stall".

---

## 4. Q17 — Match replay

**Verdict: build third. First item needing a new table.**

**Storage:** a new table `match_replays`, not a column.

```
match_replays
  id           varchar pk (uuid)
  room_code    text
  finished_at  timestamp
  game_mode    text
  seats        jsonb   -- [{ seatIndex, userId|null, name, isBot }]
  moves        jsonb   -- the log below
  hand_count   integer
```

A move is `{ n, seat, type: "play" | "pass", combo?, handCounts }` — the pile
and the counts are enough to re-render a table without storing anyone's hand.
**Hands are not stored.** A replay that reveals what everyone held is a
different, larger privacy question, and the loved-by-card-players part is
seeing what was *played*.

**Accumulation:** `OnlineGameState.moveLog`, written on the same path that
already advances the pile, and persisted in the **existing** `game_state`
envelope beside `handFlags` — so a mid-match restart does not lose it and no
column is needed for the live half. Only the finished log is written to the new
table, once, at game over, alongside `recordGameResult` and wrapped the same
way so it can never fail the game.

**Bounding:** a log is bounded by the game itself (54 cards, so a few hundred
entries). The *table* needs a retention rule of its own — replays are pruned
per user the way history is, and `MAX_HISTORY_ROWS_PER_USER` is not reused,
because a replay is worth keeping longer than a scoreline and costs more.

**Client:** a replay opens from a match-history row. Reuse `GameTable` in a
non-interactive mode driven by a reducer that folds moves into a `GameState`,
with step/play/scrub controls. If reusing `GameTable` proves to need an
`isReplay &&` branch threaded through the render, stop and render a simpler
dedicated view instead — the table's one-component invariant is worth more than
replay fidelity.

**Degradation:** if the table does not exist, the insert fails, is logged, and
match history simply shows no replay affordance. Nothing else notices.

---

## 5. Q25 — Cosmetics: card backs and table felts

**Verdict: build fourth. Small surface, needs one stored choice per user.**

**Storage:** `user_cosmetics` table (`user_id` pk, `card_back` text,
`table_felt` text), not columns on `user_stats`. Absent row = defaults, so the
feature degrades to "everyone has the default" if `db:push` has not run.

**Design:** the assets are the work, not the plumbing. Card backs are already
drawn procedurally in `CardView` (`getLattice` + medallion); a back is a small
parameter set (lattice spacing, medallion shape, palette) rather than an image,
so three or four backs cost almost nothing in bundle size. Felts are already a
`FeltGradient` token — alternates are additional gradient stops.

**Explicitly not monetization.** No IAP, no unlock currency, no ads. If the
owner ever wants a paid tier this is the surface, but nothing here assumes it.

---

## 6. Q22 — Ranked ladder

**Verdict: design now, build after the four above. Needs one owner decision.**

**Blocked on a product decision, not on code:** what a season is. Reset monthly?
Never? What happens to a rating at reset? A ladder without an answer is a
migration waiting to happen.

**Storage:** `user_ratings` (`user_id`, `season`, `rating`, `games`, `updated_at`,
pk `(user_id, season)`). Season as part of the key means a reset is a new row,
never a destructive update, and the previous season stays readable.

**Rating:** Elo over *placement*, not win/lose — Murlan is 2–4 players and
finishing second of four is not a loss. Each finished match produces pairwise
results between every pair of human seats, and the rating moves on the sum.
Bots are excluded entirely, as they already are from scoring.

**Fairness precondition:** a public ladder changes the incentive to cheat. The
server is already authoritative over every move, tickets are single-use, and
payloads are validated — those are the properties a ladder needs, and they hold.
What does *not* hold: nothing stops two accounts from farming each other. Before
a ladder is public it needs, at minimum, a rule that a pair of accounts playing
only each other stops moving the needle.

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

## 9. Order, and why

1. **Q18 spectator** — no storage, the risky part is already solved.
2. **Q20 bot personalities** — no storage, contained.
3. **Q17 replay** — first new table; establishes the degrade-safely pattern.
4. **Q25 cosmetics** — small, reuses that pattern.
5. **Q22 ladder** — needs the season decision first.
6. **Q23 push** — needs credentials and a privacy-policy entry.
7. **Q26 tournaments** — needs the hosting decision.

Items 1–4 are buildable now, in full, with no owner input. Items 5–7 each have a
named blocker that is a decision, not effort.

---

## 10. What could make this wrong

- **Spectators leaking a hand.** The whole design rests on `findViewerSeat`
  returning null for a spectator and the existing sanitiser doing the rest. If
  that function ever gains a fallback — "if no seat, treat as seat 0" — every
  spectator sees a hand. The integration test must assert the empty hands, not
  the seat lookup.
- **Replay reusing `GameTable`.** The table is one component serving two screens
  precisely because it has no mode branches. Replay is a third caller with
  different needs, and the pressure to add `isReplay &&` will be real.
- **Bot personalities that are only names.** If two personalities produce the
  same play in most positions, they are a menu, not a feature.
- **A ladder without an anti-farming rule.** Cheap to add at design time,
  expensive once ratings exist and players have them.
