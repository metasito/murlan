# Five review defects, fixed at the root

Written 2026-09-03 against `origin/main` at `0a5fd51`, for #894, #892, #895, #896, #897.
Design only — nothing here is implemented.

Every file:line below was read and checked. Where a ticket's diagnosis is wrong, this document
says so and says what is true instead.

**Two owner decisions landed while this was being written and are folded in throughout:**

- **The matchmaking cooldown is removed entirely (#898).** Abandoning still costs the abandoner
  their own score and nothing further is enforced. So #897's fourth defect is not fixed, it is
  deleted — designed in §2/#897 (d).
- **Registration answers neutrally and mails the address (#893/#897).** Free address → account
  created plus the usual verification mail; taken address → a mail to *that* address saying
  someone tried to register with it; either way one indistinguishable "check your email".
  Designed in §2/#897 (a), together with the one respect in which the letter of that decision
  leaves a hole — see Q1.

**Two claim notices.** #894 already carries `in-progress`, and a worktree
`.worktrees/agent-894` exists on branch `agent/review-fixes`. Read that issue's thread and that
branch before starting it (RULES §22, §41). And two changes below touch stored schema or the
socket protocol — flagged in bold where they appear.

---

## 1. What these five have in common

Four of the five are the same failure, and it is not carelessness: **a property that was
decided once was implemented once per call site, so it holds wherever someone remembered it and
nowhere else.** Rate limiting is a policy that lives in six route mountings and is absent from
the two written most recently (#892). Enumeration-safety is a property of the account surface
engineered with real care into the reset flow and never stated as applying to registration
(#897). "A payload's English fallback comes from the locale file" is a rule obeyed at forty
sites and broken at three (#896.3). "Retention is bounded" is an idiom copied verbatim into
four modules, one of whose tables then became the busiest in the schema (#895, and the same
shape again in `redeemAuthToken` for #892). In each case the fix that lasts is not the instance
— it is to state the property in one place and add the check that fails when the next call site
forgets it.

**#894 is genuinely different and should not be forced into that frame.** It is a data-shape
defect: a seat's points live under two key spaces (`userId` and `bot:<seat>`), and the one
moment those spaces converge — a reclaim — is the one moment nothing merges them. Its symptom
is that two independent readers each re-implement a vacated-seat merge and a third does not;
but the cause is the split ledger, not a forgotten rule.

One further thing they share, which the owner's two decisions make plain: **three of the five
are the visible edge of a feature that was built before its policy was settled.** The cooldown,
the registration oracle and the vacated-seat ledger were each a defensible local choice made
by someone who did not have the decision in hand. Two of them are now answered by the owner
rather than by engineering, and the code should be made to say what was decided rather than
argued back into shape.

---

## 2. Per defect

### #894 — Reclaiming a seat drops the points the bot earned

#### Verified diagnosis

The ticket is right, and understates the blast radius. Confirmed:

- `server/tableHandlers.ts:515-521` (`reclaimSeat`) sets `playerMap[seat] = userId` and
  `vacatedSeats.delete(seat)`. Nothing touches `cumulativeScores`.
- `server/gameRoom.ts:198-200` → `server/onlineGameLogic.ts:41` — `scoreKeyForSeat` returns the
  `userId` once `playerMap` names the seat again, so the `bot:<seat>` bucket becomes
  unreachable from that seat.
- `server/onlineGameLogic.ts:555-574` — `resolveHandEnd`'s `detailed` builder does the merge,
  but only `if (vacated)`. After a reclaim `vacated` is `undefined`, so the row reads the
  userId bucket alone.
- `server/gameRoom.ts:100-108`'s comment claiming `endMatchVotes` is cleared "on a vacate or a
  reclaim" is **false**. Only `server/gameTurn.ts:322` (`vacateSeat`) and
  `server/dealManche.ts:35` clear it. Confirmed by tracing every writer.

**Three additional read sites, found by grepping every reader of `cumulativeScores`:**

1. **`server/gameOver.ts:340-345` (`scoresByEngineId`) does not do the vacated merge at all.**
   Not "loses it after a reclaim" — it never had it. It feeds `game:match_state`
   (`server/emit.ts:11`), emitted at `server/dealManche.ts:48` and `server/socketTable.ts:198`
   (rejoin). So between hands, and on every rejoin, a **still-vacated** seat's live standings
   row already drops the departed player's frozen points — the exact defect `docs/BRIEF.md`
   §3.1's "kept, shown and frozen" clause exists to prevent. A pre-existing bug the ticket does
   not mention and the review agent mislocated.
2. **The match's own resolution reads the orphaned bucket.** `lib/gameEngine.ts:1651+`
   (`foldHandIntoMatch`) resolves the target from `cumulative` keyed by `scoreKeyForSeat`. After
   a reclaim the returning player needs the target *plus* the orphaned points to cross the
   line. Not a display defect — the match ends at the wrong time.
3. **Ratings, achievements and history are unaffected.** `gameResults`
   (`server/onlineGameLogic.ts:607-627`) is keyed by
   `abandonedSeats.get(seat) ?? scoreKeyForSeat(...)` and carries `placement`, not points.
   Nothing in the ladder reads `cumulativeScores`. The claim that the drop "flows into ratings
   and achievements" is **wrong**; correcting it matters, because it moves the fix's risk from
   "rewrites stored ladder data" to "corrects live match state".

**`docs/design/DISCONNECT-POLICY.md` §2 note 2 and §5 Q5 state as fact something that is only
intent:** *"cumulativeScores already survives the vacate under the userId key, so restoring
`playerMap[seat]` restores the row, the name and the total together."* It restores the name and
the pre-departure total; it orphans the takeover's points. Correct that sentence in the same PR
(see §2/#897 (d) for the other corrections that document needs). `docs/BRIEF.md` §3.1 needs
nothing here — it is right, the code is wrong.

#### Root cause

A seat's match points are keyed by **identity**, which changes twice during a match
(`userId` → `bot:<seat>` → `userId`). The thing that is stable for the life of a match is the
**seat**. Two readers compensate with an ad-hoc merge and one does not.

#### Recommended fix

**(a) `reclaimSeat` merges the bucket, then deletes it.** In `server/tableHandlers.ts:515`:

```
const botKey = scoreKeyForSeat(game, seat);            // still `bot:<seat>` at this point
game.playerMap[seat] = userId;
const carried = game.cumulativeScores[botKey] ?? 0;
if (carried !== 0) {
  game.cumulativeScores[userId] = (game.cumulativeScores[userId] ?? 0) + carried;
}
delete game.cumulativeScores[botKey];
game.vacatedSeats.delete(seat);
game.releasedSeats.delete(userId);
game.endMatchVotes.clear();                            // see (c)
```

Order matters: `botKey` must be computed **before** `playerMap[seat]` is written, or it
resolves to the userId and the merge is a no-op every test still passes.

This is the root fix rather than a patch for one decisive reason: **`cumulativeScores` is
inside the persisted envelope** (`server/gamePersistence.ts:133` → `packPersistedState`),
whereas `vacatedSeats` is memory-only by design (`server/gameRoom.ts:85-90`). Fixing the *data*
at the moment the two key spaces converge is durable across a restart. Fixing the *readers* is
not — after a restart `vacatedSeats` is empty and any reader-side merge silently stops merging.
It also reaches the match-resolution path, which no reader-side change can.

The `carried !== 0` guard is not an optimisation: writing `cumulativeScores[userId] = 0` for a
seat that never scored creates a key `Object.keys(cumulativeScores)` sums over, and
`tests/handEnd.test.ts` asserts on exact map shapes.

**(b) One resolver for the vacated merge, used by both readers.** Extract the
`server/onlineGameLogic.ts:562-564` expression into an exported

```
export function seatTotal(
  cumulativeScores: Record<string, number>,
  playerMap: Record<number, string>,
  vacatedSeats: ReadonlyMap<number, { userId: string; username: string }>,
  seat: number
): number
```

and call it from both `resolveHandEnd`'s `detailed` builder and `scoresByEngineId`
(`server/gameOver.ts:343`). That fixes finding (1) and removes the duplicated rule that made
this class possible. `scoresByEngineId` takes only `game`, which carries all three arguments,
so its signature does not change.

**(c) `reclaimSeat` clears `endMatchVotes`.** The acceptance criterion says "clear it, or fix
the comment — not both, and not neither". Clear it: `vacateSeat`'s own comment
(`server/gameTurn.ts:320-322`) gives the reason — *"a roster change makes that question new
again"* — and a reclaim is a roster change in the direction that makes the vote **harder** to
carry (`votesUnanimous` compares against `Object.keys(playerMap).length`, which just grew). A
stale tally reading "2 of 2 agreed" beside a table of three is exactly the misleading state
that comment promised was impossible.

#### Alternatives rejected

- **Re-key `cumulativeScores` by seat.** The theoretically correct ledger, and what
  `CLAUDE.md`'s "a winner is stated as an engine player id" invariant points at. Rejected on
  three counts. (i) The map is inside the persisted envelope, so changing its key space needs a
  `GAME_SCHEMA_VERSION` bump, which by `server/onlineGameLogic.ts:296`'s own contract
  **discards every live game** — a wipe of every table in progress, in production, to fix a bug
  that occurs on a reclaim. (ii) `foldHandIntoMatch` is shared with the offline table, which
  keys by engine player id — seat-keying adds a third key space rather than removing the
  second. (iii) `matchWinners` must stay comparable with `gameResults.userId`
  (`server/onlineGameLogic.ts:623`, `matchWon: matchWinners.includes(key)`), so seat-keying
  trades one merge site for a mapping site at precisely the point identity matters. After (a),
  `bot:<seat>` is not a parallel identity for a live seat — it is a closed bucket that exists
  only while the seat is vacant and is consumed on return. That is coherent.
- **Patch each reader to consult a "this seat used to be vacated" record.** Needs persisted
  state that does not exist, degrades silently across a restart, and cannot reach
  `foldHandIntoMatch`.
- **Withhold the points, reading `DISCONNECT-POLICY.md` §5 Q5 ("the points the bot earned
  belong to the bot, not to you") as licence.** Wrong reading. Q4 renders the frozen player and
  the bot as **one combined row** while vacated; Q5 argues only that this opens no farming
  exploit. `docs/BRIEF.md` §3.1 settles it: *"points won before leaving are kept, shown and
  frozen, so the standings always sum to the hands played."*

#### Blast radius

`server/tableHandlers.ts`, `server/onlineGameLogic.ts`, `server/gameOver.ts`,
`docs/design/DISCONNECT-POLICY.md`. Tests: `tests/seatReclaim.test.ts`,
`tests/endMatchVote.test.ts`, `tests/handEnd.test.ts`, `tests/gameOver.test.ts`.
**No storage change, no schema-version bump, no socket protocol change.** In-memory and
persisted-envelope *values* change; the envelope's shape does not.

#### The check that fails if this regresses

Extend `tests/seatReclaim.test.ts` with one test that drives the whole sequence and asserts the
mechanism, not the outcome:

1. Seat 1 held by `drita`, `cumulativeScores = { drita: 8 }`, `handsPlayed = 2`.
2. `vacateSeat` seat 1.
3. Fold one hand in which the vacated seat scores — then **assert `cumulativeScores["bot:1"] > 0`
   before going further**. Without this the whole test passes on a seat that scored nothing.
4. `reclaimSeat`.
5. Assert all four: `cumulativeScores["bot:1"] === undefined`; `cumulativeScores.drita === 11`;
   `scoresByEngineId(game)["player_1"] === 11`; and
   `Object.values(cumulativeScores).reduce(add) === 6 * handsPlayed` for a four-seat table
   (3+2+1+0 a manche) — the "standings sum to the hands played" clause asserted as arithmetic
   rather than as a screenshot.
6. Assert `game.endMatchVotes.size === 0` after the reclaim.

Plus one test for finding (1) needing no reclaim: vacate, fold a hand, assert
`scoresByEngineId(game)["player_1"]` equals the frozen total **plus** the bot's — red today.

---

### #892 — Two public auth routes can be driven to take the server down

#### Verified diagnosis

Correct on every point.

- `server/routes.ts:544` — `app.post("/api/auth/verify-email", validate(VerifyEmailSchema), …)`,
  no limiter. Every other public auth route carries one: register/login `authLimiter`
  (`:341`, `:403`), request-password-reset `authLimiter` + `passwordResetRequestLimiter`
  (`:565-569`), reset-password `resetPasswordLimiter` (`:586-588`).
- `server/authTokens.ts:59` — `DELETE FROM auth_tokens WHERE expires_at < now()` runs
  unconditionally after the UPDATE, success or failure. `shared/schema.ts:351-356` indexes
  `auth_tokens` on `token_hash` (unique) and `(user_id, purpose)` only, so that predicate is a
  sequential scan plus a write transaction, on every anonymous POST.
- `server/routes.ts:479` — `app.post("/api/auth/change-password", requireAuth, validate(...))`,
  no limiter, then `bcrypt.compare` at cost 10 (`:489`) on every request. Login carries
  `authLimiter` **and** `loginUsernameLimiter` for exactly this cost, and `:123-147` explains
  at length why.
- `/api/auth/add-email` (`:509`) really is self-limiting — `:518-521` 409s `EMAIL_ALREADY_SET`
  after the first success. Correct to leave alone.

#### Root cause

Two, separable:

1. **Rate limiting is a per-route decision with no enforced default.** There are eight
   `/api/auth/*` mountings and no check that any carries a limiter. The next one will be found
   by the next review.
2. **Retention runs on the request path.** The same root cause as #895 wearing a different
   table; fixed once, there.

#### Recommended fix

**(a) `/api/auth/verify-email` gets `authLimiter`, mounted before `validate()`** — the position
register and login use, so a flood is refused before the body is parsed.

**(b) `/api/auth/change-password` gets a `changePasswordLimiter`,** in the house shape:

```
function changePasswordMaxFromEnv(): number {
  const parsed = Number(process.env.MURLAN_CHANGE_PASSWORD_RATE_LIMIT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
}

const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: changePasswordMaxFromEnv(),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => req.session?.userId ?? "anonymous",
  message: { error: "Too many requests, slow down.", code: "RATE_LIMITED" },
});
```

Mounted **after** `requireAuth`, so `req.session.userId` always exists.
`skipSuccessfulRequests` mirrors `loginUsernameLimiter`'s reasoning: a person legitimately
changing their password twice must not spend the budget a wrong `currentPassword` does.
**No decoy hash here, and none should be added** — `loginUsernameLimiter`'s decoy (`:126`,
`:155-158`) exists because a fast 401 tells an *anonymous* attacker they have exhausted an
account's guesses. This route is already authenticated as the account it is guessing at, so
there is no oracle to close and a plain `RATE_LIMITED` is the honest answer.

Add `process.env.MURLAN_CHANGE_PASSWORD_RATE_LIMIT ??= "5"` to `tests/helpers/testServer.ts`
beside the existing three (`:36`, `:45`). That file sets env at module top level, before
`server/routes.ts` is imported, so the module-scope `changePasswordMaxFromEnv()` call is safe —
do **not** reach for a function-valued `limit` to work around ESM import hoisting; the harness
already solves it.

**(c) A per-address limiter on register — `registerEmailLimiter`.** Required by the owner's
registration decision, not by the original ticket: registration now sends mail to an arbitrary
address on demand, which is an amplification vector. Mirror `passwordResetRequestLimiter`
(`:167-182`) exactly — 5 per 15 min, `keyGenerator: (req) => req.body.email.toLowerCase()`,
mounted **after** `validate(RegisterSchema)` so the body is parsed. Per that limiter's own
comment, keying on the submitted address is **not** itself an oracle: a nonexistent address is
throttled on the identical schedule a real one is. Designed here rather than in #897 because
it belongs with the other limiters and with the scan in (e).

**(d) The sweep leaves `redeemAuthToken` entirely.** Not "success-only" — moved. The ticket
leaves the choice to the implementer; the answer is a scheduled sweep, because that is #895's
fix and this is the same defect. `redeemAuthToken` becomes the UPDATE and nothing else, and its
doc comment loses the "sweeps expired rows on every call" paragraph.

**(e) A check that an unlimited public auth route cannot land again.** A TypeScript-AST source
scan over `server/routes.ts`, in the idiom `tests/tokenRoles.test.ts` and
`tests/orientation.test.ts` already use: find every `app.<verb>("/api/auth/…", …)` call and
assert its argument list names at least one identifier matching `/Limiter$/`.

Guard the scan against the decoy failure mode named in `docs/agents/RULES.md` §6 — a scan
matching nothing passes. Assert the **exact set of paths discovered** against a written list, so
a route that vanishes from the scan's reach fails as loudly as one that arrives unprotected.

#### Alternatives rejected

- **A `publicAuthRoute(app, path, ...handlers)` mount helper that always inserts
  `authLimiter`.** Attractive in the abstract; buys nothing here. The auth routes use five
  different limiter combinations (`authLimiter`; `authLimiter` + per-email; `resetPasswordLimiter`;
  per-user; none-by-design for logout), so the helper must take the limiter as a parameter —
  the same act as writing it in the argument list, with an extra indirection. The scan gives
  the guarantee; the helper only gives it a shorter name. This is the case where the small
  local fix genuinely is the right one.
- **Keeping the sweep, success-only.** Halves nothing worth halving: a successful redemption is
  rare, so it is a correctness fig leaf, and it leaves the seq-scan idiom in place to be copied
  again.

#### Blast radius

`server/routes.ts`, `server/authTokens.ts`, `tests/helpers/testServer.ts`. New
`tests/authRoutesLimited.test.ts`. Integration additions to
`tests/integration/changePassword.test.ts`, `tests/integration/auth.test.ts`, and a new
verify-email case. **Touches storage only in that it stops writing** — no schema change, no
socket protocol change. `auth_tokens` gains an index; see #895 (a), additive and applied at
boot.

#### The checks that fail if this regresses

1. `tests/authRoutesLimited.test.ts` — the scan. Prove it red by deleting `authLimiter` from
   the register mounting, and confirm the failure message names the route.
2. Integration: drive `POST /api/auth/verify-email` past `MURLAN_AUTH_RATE_LIMIT` and assert a
   429; drive `POST /api/auth/change-password` past `MURLAN_CHANGE_PASSWORD_RATE_LIMIT` with a
   wrong `currentPassword` and assert a 429, then assert a **correct** password change still
   succeeds afterwards (pins `skipSuccessfulRequests`, which a limiter without it would fail).
3. Integration: drive `POST /api/auth/register` past `registerEmailLimiter` with the **same
   address and different usernames**, assert a 429, and assert a **different** address is still
   accepted from the same IP within the window (pins that the key is the address, not the IP).
4. Integration: pre-insert an expired `auth_tokens` row, POST a garbage token to
   `verify-email`, assert the response is 400 **and the expired row is still there**. That
   asserts the mechanism — the sweep is off the write path — rather than asserting a comment.

---

### #895 — Every disconnect writes two rows and runs a full-table scan

#### Verified diagnosis

Correct, and the class is wider than the ticket says.

- `server/socket.ts:174-176` — `registerDisconnect(ctx)` above `await announcePresence(ctx)`.
  Correct and must stay; `server/socketPresence.ts:7-9` explains why.
- `server/socketPresence.ts:166` — `trackEvent("socket.closed", userId, { reason })` on every
  server-side disconnect.
- `server/events.ts:35-42` — one transaction: INSERT plus
  `DELETE FROM events WHERE occurred_at < now() - 90 days`. `shared/schema.ts:255` indexes
  `events` on `(name, occurred_at)`. A predicate with no `name` cannot use it. **Seq scan,
  confirmed.**
- `context/SocketContext.tsx:239-242` — `onDisconnect` calls `reportSocketClose(reason)` for
  every reason, including the deliberate sign-out path at `:216-222`.
  `lib/errorReporting.ts:93-107` POSTs `/api/client-errors`.

**Three further facts the ticket does not carry:**

- The write-path prune is an *idiom*, present in **four** modules: `server/events.ts:37`,
  `server/clientErrors.ts` (`recordClientError`), `server/replays.ts:42`, and
  `server/authTokens.ts:59` (#892). Each comment cites the others as precedent
  (*"the shape server/replays.ts and server/clientErrors.ts already use"*). Fixing one leaves
  the justification for the other three standing.
- Only two of the four actually seq-scan. `client_errors` has `client_errors_occurred_idx` on
  `occurred_at` (`shared/schema.ts:212`) and `match_replays` has `match_replays_finished_idx`
  on `finished_at` (`:278`). `events` and `auth_tokens` do not. So there are two problems — an
  unindexed predicate, and a prune on the write path — needing separate fixes.
- The client side is already partly bounded: `errorReportLimiter`
  (`server/routes.ts:239-251`) caps `/api/client-errors` at 5/minute **per account**. A
  flapping phone gets 429s rather than writing unboundedly. The row cost is real but the
  denial-of-service framing is overstated for the client half.

#### Root cause

**Retention was implemented as a property of each write instead of a property of each table.**
Bounding a table is a scheduled concern; the codebase had no scheduled place for it when the
first of these was written, so each write took the job. The comments say so:
*"so the table cannot grow without bound if a scheduled prune is never written."* The scheduled
prune is now worth writing.

There **is** an existing scheduler: `startSweeper` (`server/gamePersistence.ts:331-362`), a
5-minute interval started from `server/socket.ts:178`, already running `sweepFinishedTables`,
`pruneAbandonedGames` and `pruneStaleRooms`. This is not the first periodic job.

#### Recommended fix

**(a) An index that serves the predicate.** Add `index("events_occurred_idx").on(t.occurredAt)`
to `events` in `shared/schema.ts`, and `index("auth_tokens_expires_idx").on(t.expiresAt)` to
`auth_tokens`. Both **additive and idempotent**, so `server/schemaDdl.ts` creates them at boot
— no `drizzle-kit push`, no rename-or-drop prompt, no production migration.
`events_name_occurred_idx` stays: `funnel()` (`server/events.ts:72-84`) needs it.

**(b) One module owns retention.** New `server/retention.ts`:

```
export const RETENTION = [
  { table: events,        column: events.occurredAt,        days: EVENT_RETENTION_DAYS },
  { table: clientErrors,  column: clientErrors.occurredAt,  days: CLIENT_ERROR_RETENTION_DAYS },
  { table: matchReplays,  column: matchReplays.finishedAt,  days: REPLAY_RETENTION_DAYS },
  { table: authTokens,    column: authTokens.expiresAt,     days: 0 },
] as const;

export async function sweepRetention(): Promise<void>   // one DELETE per rule, logged, never thrown
```

Called from `startSweeper`'s existing interval alongside the three prunes already there. Every
five minutes is fine and needs no throttling: with (a)'s indexes each DELETE is an index range
scan matching zero rows almost always.

**(c) The four inline prunes are deleted.** `server/events.ts`'s `insertEvent` stops being a
transaction and becomes a bare insert. `server/clientErrors.ts`'s `recordClientError` likewise.
`server/replays.ts`'s prune goes too — not because it is expensive, but because leaving one
behind is what re-legitimises the idiom for the next table. One rule, one place.

**(d) The client reports only what the server cannot see.** `lib/errorReporting.ts`'s
`reportSocketClose` already documents its own purpose: *"The client is the only side that ever
sees `transport error` — the server's own handler only gets the reason its own transport
already knew about (#844)."* So narrow it to exactly that:

```
const CLIENT_ONLY_CLOSE_REASONS = new Set(["transport error", "parse error"]);
export function reportSocketClose(reason: string): void {
  if (!CLIENT_ONLY_CLOSE_REASONS.has(reason)) return;
  …
}
```

Stronger than the acceptance criterion and better justified: it drops the deliberate
`"io client disconnect"` the ticket asks about, drops `"io server disconnect"` (a server action
the server already logs), and drops `"transport close"` and `"ping timeout"` — routine mobile
churn — because `socket.closed` records both server-side with the same reason. What remains is
the one reason the server structurally cannot observe, which is the only thing this call was
ever for. The guard belongs in `reportSocketClose`, not in `SocketContext`, so a second caller
cannot reintroduce it.

**(e) `socket.closed` stays.** #871's invariant is untouched: `registerDisconnect` still
registers before the first `await` and still calls `trackEvent`. Only the cost inside
`trackEvent` changes.

#### Alternatives rejected

- **A predicate the existing `(name, occurred_at)` index can serve** — deleting per `name`, one
  name a sweep. Works, but makes retention depend on the funnel's index layout, which is a
  coincidence, and does nothing for `auth_tokens`. A dedicated index is a few MB and one line.
- **Dropping `socket.closed` as not worth recording.** Tempting —
  `tests/integration/socketCloseReason.test.ts` exists because the reason breakdown is the only
  server-side signal of mobile churn. Once the prune is off the write path, one small insert a
  disconnect is a reasonable price.
- **A separate `setInterval` for retention.** A second timer to unref, shut down and test, for
  work that fits an existing five-minute loop.
- **Sampling `socket.closed` (record 1 in N).** Breaks `funnel()`'s counts silently, which is
  the failure mode `shared/events.ts`'s closed-set comment exists to prevent.

#### Blast radius

`shared/schema.ts` (two additive indexes), new `server/retention.ts`, `server/events.ts`,
`server/clientErrors.ts`, `server/replays.ts`, `server/authTokens.ts`,
`server/gamePersistence.ts` (`startSweeper`), `lib/errorReporting.ts`. Tests:
`tests/schemaDdl.test.ts`, `tests/integration/events.test.ts`,
`tests/integration/clientErrors.test.ts`, `tests/integration/socketCloseReason.test.ts`,
`tests/integration/ladderAndReplay.test.ts`.

**Storage: two new indexes, both additive, both created at boot by `server/schemaDdl.ts`. No
`drizzle-kit push`, no rename-or-drop prompt, no `pg_dump` required.** No socket protocol
change.

#### The checks that fail if this regresses

1. **Integration, both halves in one test** (`tests/integration/events.test.ts`): insert an
   `events` row aged past `EVENT_RETENTION_DAYS`; call `trackEvent` and await the write; assert
   the aged row **still exists** (prune is off the write path); then call `sweepRetention()` and
   assert it is **gone** (the sweep works). Neither half passes vacuously.
2. **Source scan**, one test: no module under `server/` may contain a `.delete(` inside the same
   function body as an `.insert(`. Name the four modules in the assertion message. Prove red by
   restoring one line of `server/events.ts`.
3. **`tests/schemaDdl.test.ts`** — extend to assert `events_occurred_idx` and
   `auth_tokens_expires_idx` are emitted, and that every statement is still
   `IF NOT EXISTS`-shaped.
4. **Unit** (node test, no DB): `reportSocketClose` posts for `"transport error"` and does not
   post for `"io client disconnect"`, `"transport close"` or `"ping timeout"`.

---

### #896 — One stray tap ends the match unscored, and the vote button reads as its own hint

#### Verified diagnosis

All three confirmed; the third is changed by the cooldown removal.

1. `app/(online)/game.tsx:336-358` — a `Pressable` in the banner slot whose `onPress` is
   `hapticMedium(); voteToEndMatch()` with no confirmation.
   `context/OnlineGameContext.tsx:842-844` emits `game:end_match_vote` with no payload.
   `server/socketGameplay.ts:122-132` routes it; `server/tableHandlers.ts:471` only ever `add`s.
   There is no unvote event anywhere in `server/tableActions.ts`'s union. Confirmed. And the
   harm is real: `server/gameOver.ts:299-306` (`endMatchByAgreement`) leaves the hand in
   progress **unscored** and `handsPlayed` unadvanced.
2. `app/(online)/game.tsx:341` — `accessibilityLabel={t("game.endMatchVoteHint")}`, whose value
   (`locales/en.ts:307`) is *"Every remaining player must agree — nobody is penalised."* The
   visible text at `:347-357` is inside `{...a11yHidden()}`. One accessible node, wrong string.
3. `server/socketRooms.ts:232-236` — a template-literal English `message` beside
   `code: "MATCHMAKING_COOLDOWN"`, wording *"is on cooldown"* against `locales/en.ts:90`'s *"is
   paused"*. **This site is deleted rather than translated** — see #897 (d).

**The class is real without it.** Grepping `server/` for payload `message` fields that are
literals beside a `code` leaves two after the cooldown goes:

- `server/socketTable.ts:211` — `PLAYER_RECONNECTED`, `` `${username} is back.` `` against
  `locales/en.ts:88`.
- `server/tableHandlers.ts:763` — `PLAYER_DISCONNECTED_GRACE`, against `locales/en.ts:87`.

Both happen to match their locale value **today**. That is the argument for the check rather
than against it: three sites drifted apart from their catalogue entries at three different
times and only one was noticed, because only one had diverged yet. The other two are the same
defect in its silent phase. And the same shape exists at roughly forty sites in
`server/routes.ts` — `res.json({message, code})` with English literals. **These are not a
different class:** `lib/i18n.ts:170` (`translateServerPayload`) is reached from both
`context/OnlineGameContext.tsx:341` (socket) and `lib/apiError.ts:46` (HTTP). One function, one
rule.

#### Root cause

Three separate ones; the ticket bundles them and they should be fixed as three.

1. **A destructive, irreversible action was built as a mechanism without the reversibility the
   rest of the app already has.** `ConfirmDialog` exists and is used at two other sites in the
   same file. The vote is the only irreversible table action with neither a confirmation nor a
   withdrawal.
2. **`accessibilityLabel` was used where `accessibilityHint` was meant.** A one-line slip; the
   one-accessible-node rule is satisfied, so no existing check could see it.
3. **A payload's English fallback is written beside its code rather than derived from it.**
   Nothing makes the derivation the cheap path, and nothing checks it.

#### Recommended fix

**(a) Confirmation — small, local, correct.** Use the file's own idiom
(`app/(online)/game.tsx:170`, `:286`):

```
onPress={() => {
  hapticMedium();
  setConfirming({
    title: t("game.endMatchConfirmTitle"),
    body: t("game.endMatchVoteHint"),
    cancelLabel: t("common.cancel"),
    confirmLabel: t("game.endMatchConfirmAction"),
    destructive: true,
    onConfirm: () => voteToEndMatch(true),
  });
}}
```

Two new keys in all three locales (`game.endMatchConfirmTitle`, `game.endMatchConfirmAction`);
`game.endMatchVoteHint` finds its real home as the dialog body. Withdrawal needs no
confirmation — it is the undo.

**(b) Withdrawal. ⚠ THIS IS A SOCKET PROTOCOL CHANGE.** Design it as a toggle carrying an
explicit intent, not as a second event:

- `server/socketSchemas.ts`: `game:end_match_vote` moves from `NoPayloadSchema` to a schema
  carrying `wants: boolean` **with a default of `true` when the field is absent**. Native builds
  lag the server; an old client emits no payload and must keep voting yes, and simply not be
  able to withdraw. Write that compatibility rule into the schema's comment — it is the reason
  for the default and it is invisible from the type.
- `server/tableActions.ts:36`: `{ kind: "endMatchVote"; wants: boolean }`. `takeoverMode`
  (`:91`) already routes this kind as `"restore"`; unchanged.
- `server/tableHandlers.ts:462-483`:
  `wants ? game.endMatchVotes.add(userId) : game.endMatchVotes.delete(userId)`, then
  `emitEndMatchVoteState`, and evaluate unanimity **only when `wants`** — a withdrawal can never
  end a match, and `votesUnanimous` on a shrinking set must not be asked.
- `context/OnlineGameContext.tsx:842`: `voteToEndMatch(wants: boolean)`, emitted with the
  payload; the context interface type (`:130`) changes with it.
- The banner becomes two-state, keyed on
  `endMatchVoteState?.votes.includes(user?.id ?? "")` — the server already ships the voter list
  (`server/emit.ts:34-37`), so no further protocol work is needed to render it.

Why a toggle and not a `game:end_match_unvote`: `rematchIntent` already established
`{ wants: boolean }` in this codebase for exactly this question (`server/tableActions.ts:33`),
and one event means one rate-limit budget (`server/socketGameplay.ts:131`, 20/min), one router
case, one takeover-mode entry and one test.

**(c) The accessible name says what the control does; the tally is announced separately.**

```
accessibilityLabel={hasVoted ? t("game.endMatchWithdrawButton") : t("game.endMatchVoteButton")}
accessibilityHint={t("game.endMatchVoteHint")}
```

and, as a **sibling** of the `Pressable` rather than a child:

```
<A11yStatus label={t("game.endMatchVoteTally", { votes, total })} live="polite" />
```

`A11yStatus` (`lib/a11y.tsx:198-228`) is already the app's live region and is already its own
accessible node, which is what `CLAUDE.md`'s "a live region announces rather than being landed
on" rule requires. The visible tally text stays inside `{...a11yHidden()}`, so the control still
exposes exactly one node. One new key in three locales (`game.endMatchWithdrawButton`).

**(d) A payload's message is derived from its code.** A helper, and a type that makes the
derivation the only spelling that compiles:

```
// server/payload.ts
type ServerCode = TranslationKey extends `server.${infer C}` ? C : never;

export function payload<C extends ServerCode>(code: C, params: TranslationParams = {}) {
  return { code, message: translate(DEFAULT_LOCALE, `server.${code}`, params), params };
}
```

The type constraint is the real fix: **a code with no `server.*` locale key becomes a compile
error**, which no scan can achieve. Convert the two remaining socket sites, then the ~40 in
`server/routes.ts` and the five `rateLimit({ message: … })` option objects.

Add to `tests/i18n.test.ts`, which already has the machinery: `payloadSentences()` (`:104-121`)
walks every payload text field and `literalsIn()` (`:57-78`) deliberately stops at a nested call
— so a `payload(...)` call yields no literals and a hand-written one does. The new assertion:
**no object literal under `server/` may carry both a string-literal `code` and a literal
`message`/`error`.** Prove it red by restoring one of the two remaining sites.

**Scope honesty, and Q2 below.** Converting `server/routes.ts` changes the English *fallback
wording* at about a dozen sites where the literal and the locale value differ
(`USERNAME_TAKEN`: "Username already taken" → "Username already in use"; `ACCOUNT_DELETED`:
"Account deleted" → "Account deleted successfully"). `locales/en.ts` is the source of truth per
`CLAUDE.md`, so the locale value is the right one and this is a correction — but it is a
user-visible diff and should be reviewed, not swept in.

#### Alternatives rejected

- **A separate `game:end_match_unvote` event.** Doubles the protocol surface, the router case,
  the rate-limit budget and the tests, for one bit of information.
- **A time-limited undo ("tap again within 5s").** No server state, but the vote is
  unanimous-gated and may sit open for minutes waiting on other seats; a five-second window is
  not a withdrawal, it is a longer tap.
- **Confirmation alone, no withdrawal.** With three seats, two of whom have voted, the third's
  mind changing is the ordinary case, not the edge one.
- **Putting the tally in the control's `accessibilityValue`.** Announced only when focused, so a
  screen-reader user watching the vote come in learns nothing until they navigate back.
  `CLAUDE.md` states the rule directly.
- **Scoping the `translate()` check to socket payloads only.** No principled line —
  `lib/i18n.ts:170` serves both transports through one function.
- **Dropping (d) now that the one *diverged* instance is being deleted.** The two survivors are
  the same defect before it becomes visible; deleting the evidence is not the same as removing
  the cause.

#### Blast radius

Client: `app/(online)/game.tsx`, `context/OnlineGameContext.tsx`, `context/onlineGameHooks.ts`,
`locales/{en,it,sq}.ts`. Server: `server/socketSchemas.ts`, `server/socketGameplay.ts`,
`server/tableActions.ts`, `server/tableHandlers.ts`, `server/socketTable.ts`,
`server/routes.ts`, new `server/payload.ts`.
**⚠ Socket protocol change** (`game:end_match_vote` gains a payload; backward-compatible by
default). No storage change.

#### The checks that fail if this regresses

1. `tests/endMatchVote.test.ts` — a vote followed by `wants: false` leaves `endMatchVotes` empty
   and does **not** end the match; a `wants: false` from a seat that never voted is a no-op;
   and — the mechanism assertion — an action with `wants` **absent** still adds the vote (the
   old-client compatibility default).
2. A native test (`tests/native/`) that the banner's accessible name is
   `game.endMatchVoteButton` before voting and `game.endMatchWithdrawButton` after, and that the
   tally text appears on a **different** node from the button — mirroring
   `tests/native/exchangeAnnounceBothWays.test.tsx`.
3. `tests/a11yOneNode.test.ts` and `tests/e2e/oneAccessibleNode.spec.ts` must stay green
   unchanged: the browser's own tree is the only place the one-node claim is true or false.
4. A native test that tapping the banner opens `ConfirmDialog` and emits **nothing**, and that
   `testID="confirm-accept"` is what emits. This is the one that would have caught the original
   defect.
5. The `tests/i18n.test.ts` addition in (d).

---

### #897 — Registration leaks whether an email has an account; the cooldown gates one door

#### Verified diagnosis

Three of four confirmed as written. The fourth is wrong as stated **and is now moot**.

1. **Confirmed.** `server/routes.ts:349-353` — `getUserByEmail` then
   `409 {code:"EMAIL_TAKEN"}` before anything is created. Bounded only by `authLimiter`
   (100 / 15 min / IP, `:85-91`).
2. **Confirmed.** `server/routes.ts:574-575` — `await mintAuthToken(...)` then
   `res.json({ok:true})`. The comment at `:556-564` claims *"only the token mint … happens
   before the reply, so the two branches cost the same up to that point"* — an INSERT is work
   the other branch does not do. And `tests/integration/passwordReset.test.ts:174-206` is fitted
   to the defect: tolerance `realAvg < fakeAvg * 5 + 50`, with a comment saying *"the real
   branch does one extra insert the fake branch skips."*
3. **Confirmed.** `shared/schema.ts:33` — `uniqueIndex("users_email_lower_uq").on(lower(email))`,
   unconditional. `storage.createUser` (`server/storage.ts:160-177`) and `storage.setEmail`
   (`:195-202`) both take it before any verification. An unverified squat is permanent: the real
   owner gets 409 forever and the squatter can never reset (reset requires `emailVerifiedAt`,
   `server/routes.ts:573`).
4. **The failure scenario is wrong, and the defect is now deleted rather than fixed.**
   `server/socketRooms.ts:47` — `room:create` creates a **private** room
   (`storage.createRoom(..., "private")`). `findWaitingPublicRooms` (`server/storage.ts:453`) is
   called from exactly one place, `room:quickmatch` (`server/socketRooms.ts:240`); there is **no
   public-room list in the client** to "join any waiting public room from". So neither named
   bypass exists. The residue was narrow — `room:join` takes a code, and a quickmatch-created
   public room has one, so a cooled-down player handed that code by a confederate could join a
   stranger game. **File this correction on the issue** even though the cooldown is going: the
   review's mechanism was wrong, and a wrong mechanism recorded as fact is how a wrong rule gets
   pinned (RULES §35).

#### Root cause

1+3: **enumeration-safety was implemented per-route rather than stated as a property of the
account surface, and the unique index treats an unverified email claim as a possession.** Those
are one thing: the index is what forces register to have an opinion about a stranger's address
at all.

2: a comment asserting a cost equality the code does not have, and a test written to the code
instead of to the spec —
`docs/superpowers/specs/2026-09-03-account-recovery-design.md` Box 5 is explicit that *"the
branch then costs one indexed `users` lookup either way, which is the only work that happens
before the reply."*

4: not a root cause any more. The cooldown was a policy shipped ahead of the decision that would
have authorised it (`lib/abandonCooldown.ts:1-6` says so in as many words: *"this ticket's own
choice (#858) and need the owner's word before they are load-bearing"*). The owner's word is no.

#### Recommended fix

##### (a) Registration answers neutrally and mails the address

The owner's chosen shape, built as follows.

```
app.post("/api/auth/register",
  authLimiter,
  validate(RegisterSchema),
  registerEmailLimiter,                       // #892 (c)
  async (req, res) => {
    const { username, password, email } = req.body;

    // A username is public — it is shown at every table — so a collision is
    // reported plainly. Unchanged.
    if (await storage.getUserByUsername(username)) { 409 USERNAME_TAKEN; return; }

    const taken = await storage.getUserByEmail(email);
    …                                          // see the two branches below
  });
```

**The taken branch.** Create nothing; reply the neutral body; **then** mail the address:

```
res.status(202).json({ ok: true, code: "CHECK_YOUR_EMAIL" });
sendRegistrationAttemptEmail(email);           // fire-and-forget, like every other send
```

Reply-before-send, for the same reason `request-password-reset` needs it in (b): the provider
call is a network round trip and must never sit inside the response path.

**The free branch.** Create, sign in, reply the *same* neutral body, then mail:

```
const user = await storage.createUser({ username, password: await bcrypt.hash(password, 10), email });
req.session.regenerate(… req.session.userId = user.id … req.session.save(…));
res.status(202).json({ ok: true, code: "CHECK_YOUR_EMAIL" });
mintAuthToken(user.id, "email_verify", …).then(sendVerificationEmail).catch(log);
```

Note what changes beyond the body: **register stops returning `sessionUser(user)`.** It cannot
return it and stay neutral — a user object in one branch and not the other is the oracle
restated. The client must call `GET /api/auth/me` after a successful register, which it can,
because the session cookie is set either way… **and it is not set on the taken branch.** That is
the hole, and it is the subject of Q1 below. Read that before building this.

Three new locale keys in all three locales (`server.CHECK_YOUR_EMAIL` plus whatever
`app/auth.tsx` needs to say), and one new mail body in `server/routes.ts` beside
`sendVerificationEmail` (`:266-272`) — *"someone tried to register an account with this address.
If it was you, sign in or reset your password: <link>. If it was not, no account was created and
you need do nothing."*

**Timing.** The two branches now do very different work: the free branch runs
`bcrypt.hash` at cost 10 (~100 ms), an INSERT and a session write; the taken branch runs one
indexed SELECT. That is a ~100 ms gap, which is an oracle in its own right and a far coarser one
than #897.2's. Under the literal decision it must be closed with a decoy — `bcrypt.hash` against
a throwaway value on the taken branch, exactly the `LOGIN_LIMIT_DECOY_HASH` precedent
(`server/routes.ts:123-126`) — and even then the session write remains unmatched. **The variant
in Q1 removes the gap instead of masking it**, which is why it is worth the owner's minute.

**Squatting (defect 3) is only closed by the Q1 variant.** Under the literal decision the
unconditional `users_email_lower_uq` stays, so a squatter who registers `victim@gmail.com`
still holds it forever and the real owner can still never register. The neutral reply hides the
*fact* from a prober; it does not release the address. Say so on the issue rather than letting
the acceptance criterion look satisfied.

##### (a2) A misconfigured mailer must be loud

This is the part most likely to go wrong, and it is the same silent-failure shape #893 and #875
both describe: `server/mail.ts:17-20` logs a `warn` and returns `false`, nobody reads the
boolean, and *"nobody will report this; they will just never get the mail."* Registration is
about to make mail load-bearing for a branch that produces **no other observable output at all**
— the taken branch's entire effect is one email.

Four changes, cheapest first. All four, not a subset: each covers a different observer.

1. **`sendMail`'s failures become rows, not just log lines.** Add `"mail.sendFailed"` to
   `shared/events.ts`'s closed set and `trackEvent` it from both failure paths in
   `server/mail.ts` (unconfigured, and provider-rejected — distinguish them in `context`). This
   is the change that matters: it converts a silence into something `funnel()` counts and the
   dashboard can show.
2. **A boot-time check, at `error` level, naming the missing secrets.** Once, in the deploy log,
   where it is visible — not per-request, buried. **Do not refuse to boot:** `CLAUDE.md` is
   explicit that the app must launch from the Run button with no setup, and taking production
   down because recovery mail is unconfigured trades an inert feature for an outage.
3. **A mail-health row on `/admin`.** `server/routes.ts:868` already serves an admin page with
   `funnel()` and `recentClientErrorGroups()`; add configured yes/no plus sends attempted /
   succeeded / failed since boot. That is the owner's own surface and the place "recovery is
   inert" should be readable without grepping a log.
4. **A test that the loudness works.** With `RESEND_API_KEY` unset, `sendMail` returns `false`
   **and** an `events` row named `mail.sendFailed` exists afterwards. Assert the row, not the
   log line: a log assertion passes on a `warn` nobody will ever read, which is the defect.

##### (b) The reset-token timing oracle

```
const user = await storage.getUserByEmail(email);
res.json({ ok: true });
if (!user?.emailVerifiedAt) return;
mintAuthToken(user.id, "password_reset", PASSWORD_RESET_TOKEN_TTL_MS)
  .then((token) => sendPasswordResetEmail(user.email!, token))
  .catch((err) => logger.error({ err, userId: user.id }, "Failed to mint the reset token"));
```

The `catch` is load-bearing: once the mint is after the reply there is no request left to fail,
so a rejection becomes an unhandled one. Update the handler's comment at `:556-564` — it
currently states the wrong thing.

##### (c) The unverified-email squat

Closed only by the Q1 variant (a partial unique index on verified emails). Under the literal
decision it stays open; record that on the issue.

##### (d) The matchmaking cooldown is removed (#898)

Delete, do not refactor. Complete inventory, verified by grep:

| What | Where |
|---|---|
| The pure module | `lib/abandonCooldown.ts` — delete the file |
| The DB edge | `server/matchmakingCooldown.ts` — delete the file |
| The only call site | `server/socketRooms.ts:21` (import) and `:229-238` (the gate) |
| The locale strings | `server.MATCHMAKING_COOLDOWN` in `locales/en.ts:90`, `it.ts:83`, `sq.ts:99` — all three, or `tests/i18n.test.ts`'s parity check fails |
| The unit test | `tests/abandonCooldown.test.ts` — delete the file |
| The integration test | `tests/integration/matchmakingCooldown.test.ts` — **do not delete outright.** Its first half asserts that an abandoned hand writes `match_history.abandoned = true`; that record stays (below), so keep that half and rename the file to what it now pins. Deleting it wholesale removes the only integration coverage of the abandonment record. |

**The record stays; only the penalty goes.** `match_history.abandoned`
(`shared/schema.ts:187`) is written by `server/stats.ts:122` and read back by
`getMatchHistory` (`server/stats.ts:213-219`), which does a whole-row `findMany` served to the
client by `GET /api/stats/history`. So after `server/matchmakingCooldown.ts` goes the column
still has a reader and is not a write-only column. **Do not drop it** — dropping a column is a
`drizzle-kit push` against real accounts, and `docs/BRIEF.md` §3.1 wants the abandonment
recorded regardless of what is enforced on it.

**Documentation, per `CLAUDE.md`'s rule that a game-rule change is recorded in `docs/BRIEF.md`
§3.1:**

- `docs/BRIEF.md` §3.1, the disconnect row: strike the closing clause *"and repetition escalates
  as a matchmaking cooldown, never as a larger rating loss and never on a first offence"* and
  record the new decision — no cooldown; abandoning costs the abandoner their own score and
  nothing further — with the owner's reason.
- `docs/design/DISCONNECT-POLICY.md`: its header still reads *"Status: a recommendation, not a
  decision … Nothing here has been implemented, and the proposal changes no behaviour until the
  tickets in §9 are filed and worked."* That is now false twice over — most of §6 is
  implemented, and §6.12 is decided against. Rewrite the header to say which clauses were
  adopted, which was rejected, and when. Strike §6 clause 12, §5 Q7's cooldown recommendation,
  §7 row I and §9 item 9. Fix §2 note 2 / §5 Q5's false premise while you are in the file
  (#894).

**What is deliberately not deleted:** the `game.abandoned` funnel event
(`shared/events.ts:23`, written at `server/tableHandlers.ts:749`), which measures the behaviour
rather than penalising it; `abandonedSeats` and the last-place placement, which are §3.1's
unchanged abandonment rule; and `lib/achievements.ts:138`'s refusal to award achievements for an
abandoned seat, which reads the in-memory `GameResult.abandoned` and is independent of the
column.

#### Alternatives rejected

- **Leaving the register pre-check and simply changing the status code.** A 409 by another name
  is the same bit.
- **Deferred account creation** — hold username + password hash in a pending-signup record and
  create the account only at verification, so neither branch creates anything. Genuinely
  neutral, and rejected on cost: it needs a new table or a jsonb payload on `auth_tokens`
  (storage, on real accounts), makes username reservation racy across the verification window,
  and breaks auto-sign-in for everyone to close a leak the Q1 variant closes with one index.
- **Making email optional at signup** (username+password only; email added later through the
  existing `/api/auth/add-email` + `shouldShowAddEmailCard` nudge). Removes the unauthenticated
  oracle completely with zero schema change, and tempting. Rejected because it reverses #34
  (`server/schemas.ts:13`, *"#34: required at signup"*) and recreates the unrecoverable-account
  cohort #863 exists to clean up.
- **A generic 409 for both username and email collisions.** Leaks the same bit — the *presence*
  of a 409 on a fresh username reveals the address — while making the honest user's message
  useless.
- **Fixing the reset timing test by tightening its ratio alone.** The number is noise-bound on
  CI, and `DEADLINE_SCALE`-style scaling is wrong for a bound of this shape. The order of two
  statements is a deterministic fact and should be asserted deterministically.
- **Keeping the cooldown behind a feature flag.** A flag is a decision not taken. The owner took
  it.

#### Blast radius

`server/routes.ts`, `server/schemas.ts`, `server/mail.ts`, `server/storage.ts`,
`server/socketRooms.ts`, `shared/events.ts`, `locales/{en,it,sq}.ts`, `app/auth.tsx` (the
register screen's success state changes from "you are signed in" to "check your email"), plus
the file deletions in (d). Docs: `docs/BRIEF.md`, `docs/design/DISCONNECT-POLICY.md`. Tests:
`tests/integration/passwordReset.test.ts`, `tests/integration/auth.test.ts`,
`tests/integration/addEmail.test.ts`, `tests/integration/events.test.ts`,
`tests/i18n.test.ts`, and the two cooldown test files.

**Storage: none under the literal decision. ⚠ Under the Q1 variant, a production migration** —
see Q1.

No socket protocol change. (d) deletes a refusal path.

#### The checks that fail if this regresses

1. **Integration**: register with a **taken** address and register with a **free** one; assert
   the two responses are byte-identical in status and body. Assert the mechanism too — that the
   taken branch created **no** `users` row — or the test passes on an implementation that
   creates one and hides it.
2. **Integration**: `USERNAME_TAKEN` is still reported plainly, with a distinct status. Pins
   that the neutrality was scoped to the address and not smeared over the username.
3. **Integration**: registering the same address twice inside the window trips
   `registerEmailLimiter` (429); a different address from the same IP does not (#892 (c)).
4. **Integration**: with `RESEND_API_KEY` unset, a register to a taken address still returns the
   neutral 202 **and** writes a `mail.sendFailed` event row. This is the check that keeps the
   loudness from rotting.
5. **AST scan**, deterministic, replacing reliance on timing: inside the
   `request-password-reset` handler in `server/routes.ts`, the `res.json` call's source position
   precedes every `mintAuthToken` call's. Same assertion for the register handler's `res.json`
   against every `sendMail`-reaching call. Prove red by swapping the lines back.
6. **Keep** `tests/integration/passwordReset.test.ts`'s timing test, rewritten to the spec:
   `SAMPLES = 15`, compare **medians** not means (one GC pause dominates a 6-sample mean),
   tolerance `realMedian < fakeMedian * 1.5 + 20`, and a comment saying it is a smoke test while
   (5) is the guarantee.
7. **Cooldown removal**: a grep-shaped test is not needed — the deletions are proved by
   `tsc` (nothing imports a deleted module) and by `tests/i18n.test.ts`'s existing key-parity
   check (a locale key deleted from one file only is a compile error). What **is** needed is the
   surviving half of `tests/integration/matchmakingCooldown.test.ts`: an abandoned hand still
   writes `match_history.abandoned = true` and it still reaches `GET /api/stats/history`.
   Without that, the record quietly follows the penalty out.

---

## 3. Sequencing

Build in this order. The constraints are file collisions, not logic.

| # | Work | Why here |
|---|---|---|
| 1 | **#895** — retention module, indexes, client close reasons | Creates `server/retention.ts`, which #892 depends on. Lowest risk, purely additive storage. |
| 2 | **#898** — delete the cooldown, correct `BRIEF` §3.1 and `DISCONNECT-POLICY.md` | Pure deletion, no dependencies, and it removes `server/socketRooms.ts:229-238` before #896 would otherwise convert it. Do it early so nothing else is built on top of code that is going. |
| 3 | **#892** — the three limiters, the route scan, `redeemAuthToken` loses its DELETE | Rebased on 1. `registerEmailLimiter` lands here even though #897 motivates it. |
| 4 | **#894** — reclaim merge, `seatTotal`, `endMatchVotes`, doc correction | Independent of 1–3. Parallel-safe **if** the existing `agent/review-fixes` claim is resolved first. |
| 5 | **#896** — confirm + a11y (commit 1), the `wants` protocol (commit 2), `payload()` + scan (commit 3) | Commit 3 edits `server/tableHandlers.ts`, so it must follow 4; and it edits `server/socketRooms.ts`, so it must follow 2. |
| 6 | **#897 (b)** — the reset-token timing fix and its AST check | One line plus a test; independent. |
| 7 | **#897 (a)+(a2) / #893** — neutral registration, the mail-loudness work, the register screen | Edits `server/routes.ts`'s auth block, so it must follow 3. Gated on Q1 for its final shape. |

**Must not share a commit — or a branch:**

- **#894 and #896's `payload()` commit** both edit `server/tableHandlers.ts`.
- **#896's `payload()` commit and #898** both edit `server/socketRooms.ts`; #898 first.
- **#892's limiters and #897 (a)** both edit `server/routes.ts`'s auth block; #892 first.
- **#895 and #892** both edit `server/authTokens.ts`; #892 rebases, does not race.
- **#898's doc edits and #894's doc edit** both touch `docs/design/DISCONNECT-POLICY.md`. #898
  rewrites the header and strikes four sections; #894 corrects §2 note 2. Same file, different
  regions — sequence them (#898 first) rather than merging them.
- **The Q1 variant, if taken, must be its own commit and its own PR.** It is the only change
  needing a production migration and it must be revertible alone.
- **#896's three commits stay three.** The a11y fix ships alone safely; the protocol change
  needs a client release to be fully useful; the `payload()` conversion changes user-visible
  English at a dozen HTTP sites and needs its own review.

---

## 4. Open questions for the owner

**Q1 — Should the "taken address" branch of registration create an unverified claim, rather
than nothing?**

The decision as stated is *"address taken → nothing created"*. That makes the **response**
neutral but leaves two things open, and both are load-bearing:

- **The oracle survives one request later.** With nothing created, the taken branch sets no
  session cookie and the free branch does. Even if the cookie were somehow matched, the prober
  simply logs in as the username they just chose: success means the address was free, 401 means
  it was taken. Cost to them rises from one request to two — a factor of two against
  `authLimiter`, roughly 4,800 probes a day from one IP instead of 9,600. That is a speed bump,
  not a fix.
- **The squat (#897.3) is untouched.** The unconditional `users_email_lower_uq` still means a
  stranger who registers `victim@gmail.com` holds it forever and the real owner can never
  register.

*Options.*
**(i) As decided.** Neutral body, decoy `bcrypt.hash` on the taken branch to mask the ~100 ms
gap, session-cookie asymmetry accepted, squat left open and recorded on the issue. No schema
change.
**(ii) The variant: the taken branch also creates the account, with the email stored as an
unverified claim.** Requires replacing `users_email_lower_uq` with a **partial** unique index on
`lower(email) WHERE email_verified_at IS NOT NULL` — an unverified email becomes a *claim*, not
a possession. Then both branches do identical work, set identical cookies and return identical
bodies; there is no residual oracle and no decoy is needed. Whoever verifies first owns the
address; a later verification attempt against a verified-elsewhere address is refused **to
someone who has just proved they control that mailbox**, and that account's email is cleared —
which is also exactly the right answer to *"what does a person see who genuinely typed their own
address twice?"* They are told the truth, once, at the only moment it is safe to tell them, with
a link back in. And the squat closes with it.
**Cost of (ii):** `server/schemaDdl.ts` never drops anything (*"nothing is ever dropped, retyped
or renamed … this module will not do it"*), so the old index must go via `drizzle-kit push`
against the production `users` table, `pg_dump` first, rename-or-drop prompt read not accepted
(`docs/DEPLOY-RUNBOOK.md`). Also confirm before building that `schemaDdl`'s index renderer emits
a partial index's `WHERE` clause at all; if not, that is a prerequisite change to
`server/schemaDdl.ts`.

**Recommend (ii).** It is one index and one deploy window, and it is the difference between
hiding the fact and removing it — plus it is the only thing that reclaims a squatted address.

**Q2 — Take the ~40-site `payload()` conversion in `server/routes.ts` now, or as a follow-up?**
The helper and the scan (#896 (d)) are worthless if they cover only the two remaining socket
sites; the next hardcoded message will land in `routes.ts`. But converting it changes the
English fallback wording at about a dozen sites where the literal and `locales/en.ts` differ.
*Options:* (i) one PR, socket sites plus routes, one review of the wording diff; (ii) socket
sites plus a scan scoped to socket emits now, routes as a follow-up ticket.
**Recommend (i).** A scan with a carve-out is a scan that stops being true.

**Q3 — Does #894 stay with the existing claim?**
The issue carries `in-progress` and `.worktrees/agent-894` exists on `agent/review-fixes`. That
work predates this plan and may have taken a different shape — in particular it may have patched
only `resolveHandEnd` and missed `scoresByEngineId` and the match-resolution path.
*Options:* (i) hand this plan to whoever holds it; (ii) reclaim.
**Recommend (i), after reading that branch's diff against §2/#894's three read sites.**

---

## 5. What this deliberately does not change

- **`cumulativeScores`' key space.** No seat-keying, no `GAME_SCHEMA_VERSION` bump. The bump
  discards every live game; the bug it would fix is fully fixed by merging at reclaim.
- **`vacatedSeats`, `releasedSeats`, `abandonedSeats`, `weakSeats` stay memory-only.**
  Persisting any of them needs the same schema-version bump for a courtesy rather than a
  correctness property (`server/gameRoom.ts:50`, `:75`, `:86-89`). The #894 fix is chosen
  precisely so it does not depend on them surviving a restart.
- **`match_history.abandoned` stays** — written by `server/stats.ts:122`, still read back by
  `getMatchHistory` and served by `GET /api/stats/history`. The penalty goes; the record does
  not. Dropping the column would be a `drizzle-kit push` against real accounts for nothing.
- **The `game.abandoned` funnel event, the last-place placement, and the no-achievement rule for
  an abandoned seat.** All three are §3.1's abandonment decision, which #898 does not touch.
- **`USERNAME_TAKEN` on register.** Usernames are shown at every table — public by construction,
  and reporting a collision plainly is what makes the register screen usable.
- **`/api/auth/add-email`'s lack of a limiter.** Self-limiting via `EMAIL_ALREADY_SET`
  (`server/routes.ts:518-521`), as #892 says.
- **`authLimiter`'s 100 / 15 min numbers**, and every other existing limiter's numbers. The
  defect is absence, not calibration.
- **The mailer's non-throwing contract.** `sendMail` still returns `false` rather than throwing
  (`server/mail.ts:11-12`) and the server still boots without credentials — a provider outage
  must not become a caller's problem, and refusing to boot would trade an inert feature for a
  production outage. Only the *visibility* of a failure changes.
- **`socket.closed` as an event**, and **`client_errors` as a table with a server-side write
  path.** Only which client *reasons* reach it narrows.
- **The 30 s turn timer, the 60 s and 20 s graces, the winner-as-engine-player-id invariant, and
  the rule that a vacated seat can never cross the target or be named a winner.** None of the
  five defects touches them, and #894's fix is chosen to keep the last one exactly as
  `foldHandIntoMatch`'s `winEligible` already implements it.
- **`room:create`, `room:rejoin` and `room:spectate` gain no gate.** There is nothing left to
  gate them with.
