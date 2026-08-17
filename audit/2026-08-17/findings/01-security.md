# A1 — Security & server authority

Audit of `C:\Users\roton\murlan` at `b894af461550cd1a184a6a6f1694baf10d27b70c`, branch `main`.
Read-only. No file outside this one was created or modified.

## Threat model (written before reading code)

**The attacker:** a determined player of this game. They can modify their own client, open
DevTools, read the JS bundle, replay traffic, script `socket.emit(...)` by hand, and run a
loop. They have one or more real accounts. They are not a nation-state and they do not have
a foothold on the server or the database.

**What they want, in the order they would want it:**
1. See a hidden hand (other players' cards, the exchange card before it is revealed).
2. Win a manche or a match they should lose.
3. Inflate their ladder rating / stats, or avoid a loss being recorded.
4. Grief — stall a table, spam a room, deny other players their results.
5. Read another account's data (replays, stats, friends).

**What I checked against that model:** every emit path that carries `GameState`; the
handshake; all 18 inbound socket events for seat/host authority; the card-ownership filter;
`handleGameOver`'s writes; every REST route for authz and IDOR; session and cookie handling;
CORS on both the Express and the socket side; injection surfaces; and `npm audit`
reachability.

**Attacks I tried to build and could not** — the guards hold, so these are not findings:
hand disclosure, spectator disclosure, impersonation via a forged/replayed ticket, playing a
card you do not hold, playing out of turn, playing as another seat, reading a stranger's
replay, SQL injection. Details in *The cheapest cheat* below.

---

## Findings

### [SEC-01] Refuse `room:start` on a match that is still running

- **Severity:** Critical
- **Confidence:** High (read the code)
- **Effort:** M (a few hours)
- **Location:** `server/socket.ts:1293-1387` (guard at `:1300-1306`, deal at `:1343`, carried state at `:1355-1360`), `server/socket.ts:841`, `server/socket.ts:768-772`, `server/socket.ts:886`, `lib/gameEngine.ts:898-960` (`initializeRematch`) vs `lib/gameEngine.ts:1049` (`initializeGame`)
- **Problem:** `room:start` accepts `room.status === "finished"` (`server/socket.ts:1304`).
  `handleGameOver` sets exactly that status after **every** manche, not only at the end of a
  match (`server/socket.ts:841`), and leaves the game in `activeGames` with
  `matchOver === false`. So between any two manches of a running match the host can re-enter
  `room:start`, and the handler then:
  1. **deals with `initializeGame` (`:1343`), not `initializeRematch`** — so the new manche
     carries no `exchangePhase`. The loser's forfeit of their strongest card
     (`docs/RULES.md` §10, `lib/gameEngine.ts:927-960`) is skipped entirely.
  2. **takes `matchLength` straight from the client payload** —
     `matchLength: matchLength ?? previous?.matchLength ?? "match"` (`:1359`) — while
     `cumulativeScores` and `matchTarget` are carried over from the running match
     (`:1355`, `:1358`) and `rollMatchForward` (`:1365`) resets nothing because
     `matchOver` is false.
  3. **requires no other player's consent.** The consent gate lives on the other path:
     `game:rematch_vote` refuses until every seated player has voted
     (`server/socket.ts:1545`). `room:start` only checks `room.hostUserId === userId`.

  No shipped client emits `room:start` between manches — `app/(online)/room.tsx:398` is the
  only caller and it runs on the pre-game room screen; the between-hands button is
  `voteRematch` (`app/(online)/game.tsx:323`). `requestPlayAgain`
  (`context/OnlineGameContext.tsx:555-557`) exists but is called from nowhere. This is
  reachable only from a modified client, which is exactly the attacker in scope.
- **Impact:** The host of any online match can, at the end of any manche:
  - re-deal without asking anyone, as many times as they like, one per manche;
  - dodge the exchange penalty every time they lose a manche;
  - convert a match they are losing 3–18 into a one-hand shootout by sending
    `{ matchLength: "single" }`. `handleGameOver` then declares the winner of *that single
    hand* the match winner regardless of the cumulative score (`:768-772`), and
    `matchWon` (`:886`) flows into `user_stats.matches_won` (`server/stats.ts:79,90`).

  The other players see a normal `game:started` and cannot tell any of this happened.
- **Repro / proof:**
  1. Host creates a room, a second player joins, host starts a normal match
     (`matchLength: "match"`, target 21).
  2. Play one manche out. Host loses it 0–3. `handleGameOver` runs; `rooms.status` is now
     `finished` (`server/socket.ts:841`); `activeGames` still holds the game with
     `matchOver === false`.
  3. From the host's console, instead of the rematch button:
     `socket.emit("room:start", { matchLength: "single" })`.
  4. `server/socket.ts:1300-1306` passes (host ✓, status `finished` ✓). A fresh hand is
     dealt with `initializeGame` — no `exchangePhase` — and `newGame.matchLength` is now
     `"single"` while `cumulativeScores` still reads `{host: 0, other: 3}`.
  5. Host wins that hand. `handleGameOver` `:768-772` sets `matchOver = true` and
     `matchWinners = [host]`. `game:match_over` announces the host. `matches_won` increments
     for the host and not for the player who was ahead.
- **Proposed fix:** In the `room:start` handler in `server/socket.ts`:
  - Read `const previous = activeGames.get(roomId)` **before** the status guard and reject
    the event (`socket.emit("room:error", { code: "MATCH_IN_PROGRESS" })`) when
    `previous && !previous.matchOver` — a running match's next manche is
    `game:rematch_vote`'s job, not this handler's.
  - Ignore the payload's `matchLength` whenever `previous` exists and `previous.matchOver`
    is false; `matchLength` may only be set when a genuinely new match is being started.
  - Add `MATCH_IN_PROGRESS` to `locales/it.ts`, `locales/en.ts`, `locales/sq.ts` so
    `translateServerPayload` has a string for it.
  - Add the code to `tests/integration/gameplay.test.ts`: a non-host `room:start` is already
    a no-op; add a case where the host emits `room:start { matchLength: "single" }` between
    manches of a running match and assert the room errors and the game state is unchanged.
- **Acceptance criteria:**
  - With a match in progress and a manche just finished, a host emitting
    `room:start` (with or without a payload) receives `room:error` and the in-memory
    `matchLength`, `matchTarget`, `cumulativeScores` and `gameState` are all unchanged.
  - After a match genuinely ends (`matchOver === true`), `room:start` still works and still
    resets the scoreboard — the "new match" path must not regress.
  - `game:rematch_vote` remains the only path that deals the next manche of a running match,
    and that manche still carries an `exchangePhase` (assert
    `state.exchangePhase !== undefined` on the state broadcast after a rematch).
- **Fix risk:** The results screen's "play again" flow goes through `voteRematch`, so
  blocking `room:start` mid-match should not affect it — verify against
  `app/(online)/game.tsx:300-340` before landing. If any client path relies on `room:start`
  to recover a wedged room, it will now get an error instead; the recovery path is
  `room:leave` + rejoin.
- **Depends on:** None

---

### [SEC-02] Score an abandoned hand instead of discarding it

- **Severity:** High
- **Confidence:** High (read the code)
- **Effort:** L (a day+)
- **Location:** `server/socket.ts:643-709` (`vacateSeat`, esp. `:656`, `:679-691`), `server/socket.ts:1186-1199` (`room:leave`), `server/socket.ts:2188-2193` (`handleLeaveRoom` → `vacateSeat`), `server/socket.ts:1948-1970` (grace timer → `vacateSeat`), `server/onlineGameLogic.ts:52-57`, `server/stats.ts:61-62`, `server/ratings.ts:84-85`
- **Problem:** Stats, match history, achievements and ratings are written in exactly one
  place — `handleGameOver` (`server/socket.ts:732-944`) — which only runs when a hand
  reaches `gameOver`. Leaving before that produces **no record at all** for the leaver:
  - `vacateSeat` does `delete game.playerMap[seat]` (`:656`), after which
    `scoreKeyForSeat` returns `bot:<seat>` (`server/onlineGameLogic.ts:56`);
  - `recordGameResult` filters every `bot:` id out (`server/stats.ts:61`) and
    `recordRatedResult` does the same through `ratedFinishers` (`server/ratings.ts:84`).

  In a two-player game it is worse: `vacateSeat` sees `remaining <= 1` (`:679`), calls
  `disposeGame(roomId)` (`:689`) and **never calls `handleGameOver` at all** — so the player
  who was about to *win* also gets nothing: no rating gain, no `games_played`, no
  `games_won`, no history row, no replay.

  Nothing distinguishes a rage-quit from a dropped connection, and nothing penalises either.
- **Impact:** A player can guarantee their ladder rating never falls. Watch your hand; when
  it is clearly losing, close the tab (or emit `room:leave`). You lose nothing and, heads-up,
  the winner loses their win too. Over a season, `user_ratings.rating` for a quitter is a
  monotonically non-decreasing number — which is the entire quantity
  `GET /api/ratings/leaderboard` publishes. `user_stats.current_streak` and
  `games_won / games_played` are inflated the same way. This is the cheapest exploit in the
  repo and needs no modified client: closing the browser tab is enough.

  Note this is **not** `docs/BACKLOG.md` O10, which is about many sacrificial accounts. This
  is one honest account never recording a loss.
- **Repro / proof:**
  - **Heads-up:** Alice and Bob, `maxPlayers: 2`, free-for-all. Alice is losing. Alice's
    socket disconnects. `server/socket.ts:1948-1970` arms the 60s grace timer; it fires
    `vacateSeat` (`:1957`); `remaining` is 1 (`:662`, `:679`); `disposeGame` (`:689`).
    `handleGameOver` is never reached. Query `user_ratings` and `match_history`: neither
    player has a row for that hand.
  - **Four-handed:** Alice is heading for 4th place. Alice disconnects. Grace expires, seat 0
    becomes `bot:0`. The hand plays out. `handleGameOver` runs:
    `humanSeats = 3, botSeats = 1`, `isContestedTable(3,1)` is true (`:902`, `:919`), so
    the *other three* are rated and recorded against each other. `gameResults` contains
    `{ userId: "bot:0", placement: 4 }`, which `server/stats.ts:61` and
    `server/ratings.ts:84` both drop. Alice's row is untouched.
- **Proposed fix:** This needs a design decision on the rule, then a contained
  implementation — write it up under `docs/superpowers/` first (the standing agreement
  requires that for anything touching storage or the socket protocol). The mechanism:
  - Give `OnlineGameState` an `abandonedSeats: Map<number, string>` populated by
    `vacateSeat` with the userId it just removed from `playerMap`, alongside the existing
    `delete game.playerMap[seat]`.
  - In `handleGameOver`, build `gameResults` entries for those seats too, with
    `placement = state.players.length` (last) and a new `abandoned: true` flag on
    `GameResult` (`lib/achievements.ts`), so `evaluateAchievements` can refuse to award
    anything for an abandoned seat.
  - In `vacateSeat`, the `remaining <= 1` branch (`:679-691`) must run the scoring path
    before `disposeGame`: award the surviving player the win for that hand (they are the
    only seat left holding cards) and call `handleGameOver`, then dispose.
  - `recordRatedResult` must treat an abandoned seat as a real last-place finisher rather
    than a bot — the `bot:` sentinel and "a human who left" are two different things and
    must stop sharing one key.
- **Acceptance criteria:**
  - Integration test in `tests/integration/ladderAndReplay.test.ts`: two players, one
    disconnects mid-hand, and after the grace period **both** have a `user_ratings` row for
    the season, the quitter's delta is negative and the survivor's is positive.
  - Integration test in `tests/integration/stats.test.ts`: four players, one leaves
    mid-hand; the leaver has a `match_history` row with `placement = 4` and
    `games_played` incremented, and no achievement was unlocked for that hand.
  - `tests/rating.test.ts` still passes unchanged — the arithmetic must not move, only who
    is fed into it.
- **Fix risk:** A genuine network drop is now punished the same as a rage-quit; that is the
  intended trade but it is a product call, not a technical one, and belongs in the design
  doc. Awarding the hand in the `remaining <= 1` branch touches the path that currently
  disposes the table, so a mistake there can leave a game in `activeGames` after the last
  player has gone — cover it with the abandoned-row prune assertions already in
  `tests/integration/abandonedGames.test.ts`.
- **Depends on:** None

---

### [SEC-03] Stop an account deletion mid-hand from wiping the whole table's results

- **Severity:** Medium
- **Confidence:** High (read the code and the schema)
- **Effort:** M (a few hours)
- **Location:** `server/routes.ts:211-222`, `server/storage.ts:78-135`, `server/socket.ts:872-923`, `server/stats.ts:57-148`, `server/ratings.ts:89-116`, `shared/schema.ts:91,103,113,137`
- **Problem:** `DELETE /api/users/me` deletes the `users` row and destroys the HTTP session
  (`server/routes.ts:214-215`), but it does **not** touch the caller's live socket. The
  socket was authenticated once at handshake (`server/socket.ts:1039-1043`) and
  `socket.data.userId` is never re-checked, so the deleted account keeps its seat, keeps
  playing, and stays in `game.playerMap`.

  When that hand ends, `handleGameOver` builds `gameResults` with the deleted userId
  (`:872-894` via `scoreKeyForSeat`, which only substitutes `bot:<seat>` for a *vacated*
  seat) and hands the whole batch to `recordGameResult`. That runs **one transaction for
  every player at the table** (`server/stats.ts:64`), and its first `INSERT INTO user_stats`
  for the deleted id violates `user_stats.user_id → users.id` (`shared/schema.ts:91`). The
  transaction aborts, the `.catch` at `server/socket.ts:911` logs it, and **nobody** at that
  table gets stats, match history or achievements for the hand. `recordRatedResult` is a
  single transaction too (`server/ratings.ts:89`) and fails identically on
  `user_ratings.user_id` (`shared/schema.ts:137`).
- **Impact:** Any player can silently deny an entire four-person table its stats, history,
  achievements and ladder movement for a hand, by deleting their own account while the hand
  is in flight. It costs them an account they can re-create in one request
  (`POST /api/auth/register` is limited to 20 per 15 minutes, so ~20 tables per quarter hour
  per IP). Nothing in the UI tells the victims anything went wrong. Existing coverage does
  not reach this: `tests/integration/ladderAndReplay.test.ts:204` deletes the account
  *after* the hand has finished.
- **Repro / proof:** Four players in a live hand. Player D sends
  `DELETE /api/users/me` with their session cookie. `storage.deleteUser` runs the
  transaction at `server/storage.ts:79-134` and removes the `users` row; D's websocket stays
  open and D keeps playing (or is auto-passed). The hand ends. `handleGameOver` reaches
  `recordGameResult(gameResults, gameMode)` with `gameResults[i].userId` = D's now-dangling
  uuid. Postgres raises `insert or update on table "user_stats" violates foreign key
  constraint`. Check `user_stats.updated_at` for A, B and C: unchanged.
- **Proposed fix:**
  - In `server/routes.ts`, after `storage.deleteUser(userId)` succeeds, disconnect the
    account's live socket and tear down its seat. Export a helper from `server/socket.ts`
    (it already exports `emitToUser` / `isUserOnline`, and `routes.ts` already imports from
    it at `:16`) — e.g. `evictUser(userId)` that looks up `userSocketMap`, runs the same
    `vacateSeat` path a leave runs, and calls `socket.disconnect(true)`.
  - Independently, make `recordGameResult` and `recordRatedResult` resilient: one seat that
    cannot be written must not take the other three down with it. Either move the per-user
    write into its own transaction, or filter `results` against the `users` table once at
    the top of the batch.
- **Acceptance criteria:**
  - New case in `tests/integration/stats.test.ts`: three players in a live hand, one calls
    `DELETE /api/users/me` mid-hand; when the hand ends the other two both have a
    `user_stats` row and a `match_history` row for it.
  - The deleted account's socket is closed within a second of the DELETE returning 200, and
    its seat is bot-controlled (assert `game:seat_bot_takeover` reaches the survivors).
  - `tests/integration/ladderAndReplay.test.ts`'s existing "deleting an account erases that
    player from replays others keep" still passes.
- **Fix risk:** `evictUser` running the leave path while the request that deleted the account
  is still in flight is a re-entrancy hazard around `activeGames` / `disposeGame`; keep the
  eviction after the DB transaction has committed. Splitting `recordGameResult`'s
  transaction weakens its all-or-nothing property — the per-user prune of `match_history`
  must stay in the same transaction as that user's insert.
- **Depends on:** None

---

### [SEC-04] Regenerate the session id on login and registration

- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `server/routes.ts:124-125`, `server/routes.ts:157-158`, `server/session.ts:9-34`
- **Problem:** Both authentication routes write the identity into whatever session the
  request already carried:

  ```
  req.session.userId = user.id;
  req.session.save((err) => { ... });
  ```

  There is no `req.session.regenerate(...)` anywhere in the repo (grepped). An attacker who
  can set a cookie on the app's origin — an XSS anywhere on it, a shared-origin subdomain, or
  a first plaintext request before HSTS is pinned — can plant a session id they minted for
  themselves (by logging in with their own account and copying `connect.sid`). When the
  victim then logs in on that browser, express-session loads that same row from the `session`
  table and writes the victim's `userId` into it. The attacker's copy of the cookie is now a
  live session for the victim's account, with a 30-day `maxAge` (`server/session.ts:20`).
- **Impact:** Full account takeover for the 30-day cookie lifetime, given a cookie-writing
  primitive. The primitive is the hard part — `httpOnly`, `secure` in production and
  `sameSite: "lax"` are all set correctly — which is why this is Medium and not High. But the
  mitigation costs five lines and removes the whole class.
- **Repro / proof:** Read `server/routes.ts:124-125` and `:157-158`; neither calls
  `regenerate`. Behavioural proof: log in as user A, note `connect.sid`; log out
  (`req.session.destroy`, so use a *second* browser instead); in a browser that already
  holds a valid session cookie for account A, log in as account B — the `connect.sid` value
  is unchanged, and `SELECT sess FROM session WHERE sid = '<that sid>'` now names B.
- **Proposed fix:** In `server/routes.ts`, wrap both assignments:
  ```ts
  req.session.regenerate((regenErr) => {
    if (regenErr) { /* log, 500 */ return; }
    req.session.userId = user.id;
    req.session.save((err) => { ... existing body ... });
  });
  ```
  Keep the register route's rollback-on-save-failure behaviour (`:126-136`) — it must also
  fire if `regenerate` fails, or a failed regeneration leaves an unreachable account holding
  the username.
- **Acceptance criteria:**
  - New case in `tests/integration/auth.test.ts`: capture `set-cookie` from a first
    authenticated request, log in on the same cookie, and assert the returned `connect.sid`
    differs from the one sent.
  - A registration whose `regenerate` or `save` fails still deletes the half-created user
    (the existing rollback at `server/routes.ts:131` must still be reachable).
  - Logging in twice in the same browser still works and still returns 200.
- **Fix risk:** `regenerate` discards the whole session object. Nothing else is stored in the
  session today (`SessionData` declares only `userId`, `server/routes.ts:23-27`), so nothing
  can be lost — but confirm that before landing. Callbacks nest one level deeper; keep the
  error branches.
- **Depends on:** None

---

### [SEC-05] Rate-limit the socket.io handshake

- **Severity:** Medium
- **Confidence:** Medium (code path confirmed by reading; the load figure is inferred, not measured)
- **Effort:** M (a few hours)
- **Location:** `server/socket.ts:1004-1017`, `server/socket.ts:1030-1049` (esp. `:1039`), `server/socket.ts:1878-1888`, `server/socket.ts:2234-2248`, `server/socketSafety.ts:103-143`
- **Problem:** Every rate limiter in the app sits either in the Express middleware stack
  (`server/routes.ts:51-98`) or inside `onEvent`, which only runs **after** a connection has
  been accepted (`server/socketSafety.ts:110`). Socket.io attaches its own listener to the
  `http.Server` and handles `/socket.io/*` before Express sees it, so no `express-rate-limit`
  instance covers the handshake, and `installProcessGuards` is not a limiter.

  A connection that authenticates costs three database round-trips before the client has
  emitted anything:
  - `storage.getUser(claimedUserId)` in the handshake middleware (`:1039`);
  - `storage.getFriends(userId)` inside `emitFriendStatus` (`:1878` → `:2239`);
  - `storage.getFriends(userId)` again for the online list (`:1881`).

  Two of those three are `innerJoin`s against `users` (`server/storage.ts:335-343`). Nothing
  bounds how many connections one authenticated account may open per second, and nothing
  bounds how many sockets one account may hold at once.
- **Impact:** One account with a valid session cookie can drive the connection loop as fast
  as it can open sockets, and each iteration is three queries against the single `pg` pool
  the whole server shares (`server/db.ts`). A saturated pool stalls every live table's
  `persistGameState` and every REST request. Unauthenticated flooding is already cheap to
  refuse — `consumeSocketTicket` returns null before any DB call (`server/ticket.ts:47-51`),
  so no query runs — which is why this needs an account and is Medium rather than High.
- **Repro / proof:** Code path only; I could not run a load test (no database on this
  machine, and the read-only rule forbids the Playwright/dev-stack path). The claim that the
  handshake bypasses Express middleware follows from socket.io's `attach()` intercepting
  `/socket.io/` on the shared `http.Server` created at `server/routes.ts:445`; the three
  queries are at the three lines cited above. What would confirm the impact: a script that
  opens N sockets/second with one valid ticket-minting session and measures `pg` pool wait
  time and `/health` latency.
- **Proposed fix:**
  - Add a connection limiter in the handshake middleware in `server/socket.ts`, reusing the
    existing per-user bucket: after `socket.data.userId` is known, call
    `allowSocketAction(socket, "connection", N, 60_000)` and `next(new Error(...))` when it
    returns false. The client reconnects with `reconnectionDelay: 1000` /
    `reconnectionDelayMax: 5000` (`lib/socket.ts:61-62`), and mints one ticket per attempt
    against a 60/min limiter (`server/routes.ts:67-73`), so N = 60 matches the ticket budget
    exactly and cannot throttle a legitimately flapping mobile connection.
  - Collapse the two `getFriends` calls at `:1878` and `:1881` into one — `emitFriendStatus`
    and the online-list reply need the same rows.
- **Acceptance criteria:**
  - New case in `tests/socketRateLimit.test.ts` or `tests/integration/auth.test.ts`: the
    61st connection attempt by one account inside a minute is rejected with an error, and an
    attempt by a *different* account in the same window still succeeds.
  - A client that reconnects normally (drop, reconnect, drop, reconnect) is never rejected —
    exercise via `tests/e2e/reconnect.spec.ts`.
  - One `storage.getFriends` call per connection, not two.
- **Fix risk:** Set the limit too low and a phone on a flaky network gets locked out of its
  own game; the ticket limiter's 60/min is the ceiling to match, not to undercut. Merging the
  two `getFriends` calls changes the ordering of `friend:status` versus
  `friend:online_list`; `context/SocketContext.tsx:224-233` listens for both independently,
  so verify neither depends on arrival order.
- **Depends on:** None

---

### [SEC-06] Correct BACKLOG O9 — one advisory is in the running server, not in build tooling

- **Severity:** Low
- **Confidence:** High (ran `npm audit --json`, read every advisory, grepped for the vulnerable API)
- **Effort:** S (<1h) for the doc correction; M for the dependency bump
- **Location:** `docs/BACKLOG.md` (item O9, §2 Owner-blocked), `package.json` (`drizzle-orm: "^0.39.3"`, installed `0.39.3`)
- **Problem:** O9 states: *"Every remaining advisory is in build tooling — metro, @expo/cli,
  @expo/config, @esbuild-kit, drizzle-kit — which runs on a dev machine and in CI, not in the
  shipped bundle or the running server."* That is no longer true. `npm audit` today reports
  **31 advisories (0 critical, 14 high, 17 moderate, 0 low)** — O9 says 30 — and one of the
  14 highs is **`drizzle-orm <0.45.2`, GHSA-gpj5-g38j-94v9, "SQL injection via improperly
  escaped SQL identifiers"**. `drizzle-orm` is not build tooling: it is the ORM every REST
  route and every socket handler queries through, in production, on Replit.
- **Impact:** The one advisory that touches production is hidden behind a blanket claim that
  it does not exist. Anyone triaging this list next stops reading at O9. Note the exploit
  itself is **not reachable in this codebase today** — see the proof — so the immediate risk
  is a wrong record, not a live hole.
- **Repro / proof:** `npm audit --json`, enumerated. Reachability, package by package:

  | Advisory package | Sev | Where it runs |
  |---|---|---|
  | **drizzle-orm** | high | **production server, every query** |
  | @testing-library/react-native | high | test only |
  | react-native (via @react-native/community-cli-plugin) | high | the CLI plugin is dev-only; the runtime library is not the vulnerable path |
  | expo, @expo/cli, @expo/metro, @expo/metro-config | high | build/dev |
  | metro, metro-config, metro-transform-worker, image-size | high | bundler, build only |
  | postcss | high | via @expo/metro-config, build only |
  | brace-expansion | high | only under `glob`, `@typescript-eslint`, `@expo/fingerprint`, `expo` — verified by directory listing; lint/build only |
  | esbuild, @esbuild-kit/*, drizzle-kit | moderate | `db:push` only, never at runtime |
  | @expo/config, @expo/config-plugins, @expo/prebuild-config, xcode, uuid, @expo/ngrok, jest-expo | moderate | build/dev/test |
  | expo-constants, expo-linking, expo-notifications, expo-router, expo-splash-screen, expo-asset | moderate | all flagged *via* `@expo/config`, a build-time dependency |

  **So: 13 of 14 highs and all 17 moderates are build, dev or test tooling — O9's claim holds
  for everything except `drizzle-orm`.** For `drizzle-orm` specifically, the advisory requires
  an attacker-controlled SQL *identifier*. This repo never builds one: `grep -rn
  "sql.identifier\|sql.raw"` across `server/ shared/ lib/ tests/ scripts/` returns nothing,
  and every `sql\`\`` template interpolates either a schema column reference or a bound value
  (`server/storage.ts:110,130,450`, `server/replays.ts:14,43`, `server/ratings.ts:57`,
  `server/stats.ts:88-95`). Not exploitable here.
- **Proposed fix:**
  - Rewrite O9 in `docs/BACKLOG.md`: correct the count to 31, name `drizzle-orm` explicitly
    as the one runtime-reachable advisory, state that it is not exploitable here because no
    dynamic identifier is ever built, and keep the existing (still correct) reasoning about
    why `npm audit fix --force` is refused.
  - Separately, bump `drizzle-orm` to `^0.45.2` and run `npm run verify` plus the integration
    suites. This is a 0.x minor bump that npm reports as major; `drizzle-kit` must stay where
    it is (downgrading it breaks `db:push`, as O9 already records).
- **Acceptance criteria:**
  - `docs/BACKLOG.md` O9 names `drizzle-orm` and no longer claims every advisory is build
    tooling.
  - After the bump, `npx tsc --noEmit` is clean, `npm test` is 670+/672, and
    `tests/integration/schemaBootstrap.test.ts`, `stats.test.ts` and `ladderAndReplay.test.ts`
    pass against a live Postgres.
  - `npm audit` no longer lists `drizzle-orm`.
- **Fix risk:** drizzle-orm 0.39 → 0.45 crosses six minor versions of a library whose query
  builder types are load-bearing across `server/storage.ts`, `stats.ts`, `ratings.ts`,
  `replays.ts`, `push.ts` and `schemaDdl.ts`. `schemaDdl.ts` in particular reads the schema
  metadata to derive DDL and is the most likely to break silently — `tests/schemaDdl.test.ts`
  is the guard.
- **Depends on:** None

---

### [SEC-07] Escape the Host header before it reaches the landing page's inline script

- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `server/testApp.ts:88-99`, `server/testApp.ts:192-197`, `server/templates/landing-page.html:388`, `:396`, `:408`
- **Problem:** `serveLandingPage` builds `expsUrl` from a request header the client fully
  controls — `req.header("x-forwarded-host") || req.get("host")` (`server/testApp.ts:90,92`)
  — and substitutes it into the template with a bare `String.replace`
  (`:95`, no escaping). One of the two substitution sites is inside a `<script>` block:

  ```js
  const deepLink = "exps://EXPS_URL_PLACEHOLDER";   // landing-page.html:408
  ```

  A `Host:` (or `X-Forwarded-Host:`) value of `x";alert(1);//` closes the string literal and
  executes. `helmet` is configured with `contentSecurityPolicy: false`
  (`server/testApp.ts:194`), so there is no second line of defence, and the page also pulls
  `https://unpkg.com/qr-code-styling@1.6.0/...` with no `integrity` attribute
  (`landing-page.html:396`). Separately, `String.prototype.replace` with a string replacement
  expands `$&`, `` $` ``, `$'` — a Host containing those is reflected mangled even without an
  injection payload.
- **Impact:** Bounded, which is why this is Low. The landing page is only registered when
  `dist/index.html` does not exist (`server/testApp.ts:104,119-137`), and the Replit build
  chain always produces it, so **production serves the SPA and never this template**. It is
  reachable on a dev server and on any deploy where the web build failed but the server still
  came up. Exploiting it against a third party additionally needs a cache or proxy in front
  that keys on something other than the Host header — self-XSS otherwise.
- **Repro / proof:** Boot the server with no `dist/` (the state
  `server/testApp.ts:136` logs as "No web build found") and send:
  `curl -H 'X-Forwarded-Host: x";alert(1);//' http://localhost:5000/`. The response body's
  `<script>` block contains `const deepLink = "exps://x";alert(1);//";`.
- **Proposed fix:**
  - In `server/testApp.ts`, validate the host before use: reject or fall back to a
    configured domain unless it matches `/^[A-Za-z0-9.\-]+(:\d+)?$/`, and pass the
    replacement as a function (`.replace(/EXPS_URL_PLACEHOLDER/g, () => expsUrl)`) so `$`
    sequences are not expanded.
  - Add `integrity` + `crossorigin` to the unpkg `<script>` in
    `server/templates/landing-page.html:396`, or vendor the file under `assets/`.
  - Give `helmet` a real `contentSecurityPolicy` rather than `false`. The SPA needs
    `script-src 'self' 'unsafe-inline'` for the Expo bundle's inline bootstrap; start there
    and tighten later. A comment saying which directive the Expo bundle forces is worth one
    line; `false` with no reason is not.
- **Acceptance criteria:**
  - A request with `X-Forwarded-Host: x";alert(1);//` to a server with no `dist/` returns a
    page whose `deepLink` string contains no unescaped `"`.
  - A `Content-Security-Policy` header is present on `GET /` in both the SPA and the
    landing-page configurations, and the SPA still boots (exercise via
    `tests/e2e/offline.spec.ts`).
  - The landing page renders its QR code with no network request to a host outside the
    allowlist, or with an `integrity` hash on the one it does make.
- **Fix risk:** A CSP that is too tight breaks the Expo web bundle silently — the page
  renders blank with only a console error, and CI runs no build and no E2E, so it would reach
  Replit unnoticed. Land the header-escaping fix first and the CSP separately, and verify the
  CSP against a real `expo export --platform web` output before merging.
- **Depends on:** None

---

### [SEC-08] Make username uniqueness case-insensitive in the database, not just in the check

- **Severity:** Low
- **Confidence:** High (read the code and the schema)
- **Effort:** S (<1h)
- **Location:** `server/routes.ts:115-119`, `server/routes.ts:145`, `server/storage.ts:142-145`, `server/storage.ts:446-452`, `shared/schema.ts:8`
- **Problem:** Three places disagree about whether a username is case-sensitive:
  - **Registration** rejects duplicates case-**in**sensitively —
    `storage.searchUserByUsername` (`server/storage.ts:450`) is
    `lower(username) = lower($1)`.
  - **Login** looks the user up case-**sensitively** — `storage.getUserByUsername`
    (`server/storage.ts:143`) is `eq(users.username, $1)`.
  - **The constraint** is case-sensitive: `text("username").notNull().unique()`
    (`shared/schema.ts:8`), so nothing at the database level enforces what registration
    checks.
- **Impact:** Two concrete consequences.
  1. A player who registers `Alice` and later types `alice` at the login screen gets
     "Wrong username or password" (`server/routes.ts:147`) — indistinguishable from a wrong
     password, and the registration screen previously told them `alice` was taken. A
     support-shaped bug with no way for the player to diagnose it.
  2. The registration check is a read followed by a write with no lock
     (`server/routes.ts:115` then `:122`), and the unique index cannot catch what it does not
     see. Two simultaneous registrations of `Alice` and `alice` both pass the check and both
     insert. After that, `searchUserByUsername` has no `ORDER BY` or `LIMIT`
     (`server/storage.ts:447-451`) and returns whichever row Postgres hands back first — so
     `GET /api/users/search` and `POST /api/friends/add` may resolve `alice` to either
     account. Friend requests land on the wrong person.
- **Repro / proof:** Consequence 1 is a direct read of the two storage methods:
  `server/storage.ts:143` uses `eq`, `:450` uses `lower(...)`. Consequence 2 follows from the
  check-then-insert at `server/routes.ts:115-122` with only
  `unique()` on the raw column at `shared/schema.ts:8` — the constraint that would serialise
  the race is on `username`, not `lower(username)`.
- **Proposed fix:**
  - Add a case-insensitive unique index to `shared/schema.ts`'s `users` table
    (`uniqueIndex("users_username_lower_uq").on(sql\`lower(${users.username})\`)`), and
    confirm `server/schemaDdl.ts` emits it — `tests/schemaDdl.test.ts` already pins that
    every emitted statement is additive and idempotent, so this must satisfy that.
  - Change `storage.getUserByUsername` (`server/storage.ts:142-145`) to use the same
    `lower(...) = lower(...)` predicate as `searchUserByUsername`, so login matches
    registration.
  - Handle the unique-violation error in `createUser` (`server/storage.ts:151-166`, which
    today only retries on `friend_code`) by returning a 409 `USERNAME_TAKEN` instead of a
    500.
- **Acceptance criteria:**
  - A user registered as `Alice` can log in as `alice`, `ALICE` and `Alice`.
  - Registering `alice` when `Alice` exists returns 409 `USERNAME_TAKEN`, and does so even
    when the pre-check is bypassed (send the two registrations concurrently).
  - `GET /api/users/search?username=alice` returns exactly one user for any casing.
  - `tests/schemaDdl.test.ts` still passes: the new index is additive and idempotent.
- **Fix risk:** If any two existing rows already differ only by case, creating the index
  fails and `ensureSchema` throws at boot — which is the loud failure `server/schemaDdl.ts`
  is designed for, but it means the server will not start until the duplicate is resolved.
  Check for collisions (`SELECT lower(username) FROM users GROUP BY 1 HAVING count(*) > 1`)
  before landing; on a database with no real users, dropping the offending row is fine
  (CLAUDE.md: "the database is not precious").
- **Depends on:** None

---

## The cheapest cheat

**Quit.** That is the whole exploit, and it needs no modified client, no DevTools, and no
knowledge of the protocol.

Watch your hand. When it is clearly going to place last, close the browser tab.

- Your socket drops. `server/socket.ts:1930` announces a 60-second grace; `:1948-1969` arms
  the timer; it fires `vacateSeat` (`:1957`).
- `vacateSeat` does `delete game.playerMap[seat]` (`:656`). From that instant your seat scores
  under `bot:<seat>` (`server/onlineGameLogic.ts:56`).
- The hand finishes without you. `handleGameOver` builds `gameResults`, `recordGameResult`
  filters every `bot:` id out (`server/stats.ts:61`), and `recordRatedResult` does the same
  through `ratedFinishers` (`server/ratings.ts:84`).
- **Your rating did not move. Your `games_played` did not move. Your streak did not break.**
- Heads-up it is better still: `remaining <= 1` at `server/socket.ts:679` disposes the table
  at `:689` **without ever calling `handleGameOver`**, so the player who beat you gets
  nothing either.

Gain: a ladder rating (`GET /api/ratings/leaderboard`) and a win rate that can only ever go
up, for a player who does not have to win any hand they might lose. Cost: nothing. That is
SEC-02, and it is the finding to fix first.

The second-cheapest needs a modified client and a host seat: emit
`socket.emit("room:start", { matchLength: "single" })` between manches of a match you are
losing. The server accepts it (`server/socket.ts:1304` admits `status === "finished"`, which
is what `handleGameOver` set at `:841`), deals a hand with no exchange penalty, and then
crowns whoever wins *that one hand* as the match winner (`:768-772`). That is SEC-01.

**Everything the server was supposed to hold, it holds.** I tried to build each of the
following and could not:

- **A hidden hand.** There are exactly five places that emit `game:state`
  (`server/socket.ts:393`, `:1127`, `:1636`, `:1731`, `:1866`) and every one of them goes
  through `sanitizeStateForPlayer` (`:240-267`), which blanks `p.hand` for every seat that is
  not the viewer's. There is no `io.to(room).emit("game:state", ...)` anywhere. `GameState`
  (`lib/gameEngine.ts:74-88`) holds no deck and no undealt remainder — the whole deck is
  dealt — so there is nothing else to leak, and `visibleExchangePhase`
  (`server/onlineGameLogic.ts:109-128`) strips `cardFromLoser` from everyone but the two
  seats in the exchange. `tests/integration/gameplay.test.ts:161` and
  `tests/integration/spectator.test.ts:116` already prove both.
- **Impersonation.** The handshake accepts a live session or a signed, single-use, 60-second
  ticket, and nothing else (`server/socket.ts:1030-1049`, `server/ticket.ts`). The ticket is
  HMAC'd with `SESSION_SECRET`, compared with `timingSafeEqual`, its nonce is burned on
  first use, and its expiry is bounded in both directions. `tests/integration/auth.test.ts`
  proves the bare-`userId`, replay and forgery cases all fail.
- **Playing a card you do not hold.** `server/socket.ts:1419-1421` is correct as written:
  `Array.from(new Set(cardIds))` collapses duplicates, `player.hand.filter(c =>
  unique.includes(c.id))` can only return cards actually in your hand, and
  `cards.length !== unique.length` rejects any id that was not there. Sending the same id
  fourteen times yields one card; sending a card id from the pile yields zero. Card ids are
  unique across the deal, so there is no aliasing hole. Same for the exchange:
  `processExchangeChoice` (`lib/gameEngine.ts`) re-checks both ownership and
  `getValidGivebackCards` membership before mutating.
- **Acting out of turn or as another seat.** I checked all eighteen inbound events
  individually, not just `game:play`. `game:play` `:1415` and `game:pass` `:1489` both
  compare `playerMap[currentTurnIndex] !== userId`; `game:exchange_give_card` `:1783-1785`
  requires the caller's seat to *be* `exchangePhase.winnerIdx`; `game:reaction` `:1760`,
  `game:rematch_intent` `:1515` and `game:rematch_vote` `:1532` all require a seat;
  `game:rejoin` requires the caller to already be in `playerMap` on both the in-memory
  (`:1613`) and the rehydrated (`:1682`) path; `room:set_game_mode` `:1274` and `room:start`
  `:1303` require host. `room:leave` and `room:unspectate` act only on the caller's own
  socket. That leaves SEC-01's host-authority gap as the single hole, and it is a
  *scope* problem, not a missing check.
- **Malformed input.** Every one of the eighteen goes through `onEvent`
  (`server/socketSafety.ts:103-143`) — zod parse, per-*account* rate limit, try/catch — with
  `disconnect` (`:1892`) the only bare registration, and `tests/socketEvents.test.ts` pins
  that. I read all thirteen schemas in `server/socketSchemas.ts`: no `z.any()`, no unbounded
  string, no unbounded array. `.strict()` is not needed because zod 3's default for
  `z.object` is *strip* — extra keys are discarded before the handler, not passed through.
  `maxHttpBufferSize: 1e5` (`:1016`) caps the frame.
- **Reading another account's data.** Both replay routes filter on
  `player_ids @> [callerId]` (`server/replays.ts:13-14,53,78`). The three friend-request
  routes are each scoped in SQL to the party entitled to act — sender for cancel
  (`server/storage.ts:468`), recipient for accept (`:390`) and decline (`:438`). Every
  `:id` route runs through `readParam` (`server/routes.ts:42-49`) first.
- **SQL injection.** No `sql.raw`, no `sql.identifier`, no string-concatenated query anywhere
  (grepped). Every `sql\`\`` template interpolates a drizzle column reference or a bound
  value.
- **XSS in the app.** Usernames are `^[a-zA-Z0-9_]+$` at registration
  (`server/schemas.ts:8`), room and friend codes come from a fixed 32-character alphabet
  (`server/storage.ts:55`), and reactions are capped at 8 characters
  (`server/socketSchemas.ts:86`). All of it renders through react-native-web `<Text>`, which
  produces DOM text nodes, not markup. The raw-HTML surface is the landing page alone —
  SEC-07.
- **CORS divergence.** The Express middleware (`server/testApp.ts:27`) and the socket.io
  server (`server/socket.ts:1010`) call the *same* `isAllowedOrigin`
  (`server/cors.ts:17-29`), so they structurally cannot disagree. `tests/cors.test.ts` pins
  the behaviour including "localhost is refused in production".
- **Cross-site WebSocket hijacking.** Browsers do not enforce CORS on WebSocket upgrades, so
  socket.io's `cors` option does not block one — but `sameSite: "lax"`
  (`server/session.ts:32`) means the session cookie is not sent on a cross-site handshake,
  and the ticket route needs a credentialed same-origin `fetch`, which CORS *does* block. The
  path is closed by the cookie flag, not by the socket config.
- **`EXPO_PUBLIC_E2E_FAST` leaking into a shipped bundle.** It is set in exactly one place
  (`scripts/e2e-server.mjs:34`), by a script the Replit build chain never invokes — `.replit`
  runs `expo:static:build && expo:web:build && server:build`. `dist/` is gitignored
  (`.gitignore`), so a locally-built E2E bundle cannot ride a push into a deploy. Not a
  finding.
- **`DELETE /api/users/me` having no rate limiter.** Confirmed at `server/routes.ts:211` —
  and it does not matter. The first call destroys the session (`:215`), so every subsequent
  call gets 401 from `requireAuth`. The route is self-limiting. The real problem with it is
  SEC-03, which is not about rate.

---

## Coverage gaps

1. **No integration suite ran.** No `DATABASE_URL` and no reachable Postgres on this machine,
   so all 11 files in `tests/integration/` self-skip. I read their assertions in full and
   they are load-bearing for several of my "refuted" conclusions above, but I did not observe
   them pass. CI does run them and makes a skip fatal (`.github/workflows/ci.yml:67-74`), so
   they are presumed green at `b894af4` — that is inference from CI configuration, not an
   observed run.
2. **SEC-02, SEC-03 and SEC-05 were confirmed by reading code and schema, not by executing
   the attack.** Each names exactly what would confirm it in its Repro field. SEC-05 in
   particular has a Medium confidence rating because the *impact magnitude* (pool saturation)
   is inferred; the code path is certain.
3. **No load or concurrency testing.** SEC-05's DoS, the `claimRoomSeat` race, and the
   registration race in SEC-08 all want concurrent clients. I ran none.
4. **The offline path was not audited.** `context/GameContext.tsx` is the sole authority for
   the single-device game by construction, so there is no trust boundary there and nothing in
   my scope. Rule correctness there is A2's.
5. **`server/schemaDdl.ts` was checked only for injection**, not for the full DDL-derivation
   logic — that is A4's file. I confirmed it takes no user input and builds no identifier
   from a request.
6. **No dynamic analysis of the client bundle.** I could not run `expo export` (it writes to
   `dist/`, which the read-only rule forbids), so "what actually ends up in the shipped JS"
   is inferred from the source and from `scripts/build.js`, not observed.
7. **`npm audit` reachability was determined by reading the dependency graph**
   (`node_modules` directory layout plus each advisory's `effects` chain), not by tracing
   imports at runtime. The `react-native` high is the one I am least certain about: npm
   attributes it to `@react-native/community-cli-plugin`, which is dev-only, but I did not
   verify that the runtime library shares no vulnerable code path.

---

## Opinions (non-findings)

- `server/socket.ts` is 2272 lines and holds every piece of in-memory game state plus the
  entire authorisation model. Reading all eighteen handlers to check one invariant is a real
  cost, and it is why SEC-01 could hide: `room:start`'s guard reads perfectly sensibly in
  isolation and is only wrong in the context of what `handleGameOver` does 460 lines away.
  Splitting the room lifecycle from the game lifecycle would make the seat/host authority
  matrix reviewable at a glance. That is C1's call, not a security finding.
- `active_games.room_code` (`shared/schema.ts:72`) holds `rooms.id`, not `rooms.code`, and
  `game:rejoin`'s payload field is likewise called `roomCode` while carrying a room *id*
  (`context/OnlineGameContext.tsx:184`). It is consistent everywhere, so nothing is broken,
  but I had to prove that before I could rule out a room-code-guessing attack on rejoin. A
  rename would pay for itself.
- The comments in `server/ticket.ts`, `server/session.ts` and `server/onlineGameLogic.ts`
  state the invariant and why it is non-obvious, without narrating history. They made this
  audit materially faster and they are the standard the rest of the server already meets.

---

## Open questions for the human

1. **Is quitting supposed to be free?** SEC-02 is a design decision as much as a bug. Options,
   roughly in increasing severity: record the abandoned seat as a last-place finish (loses
   rating, loses the streak); additionally do not award the survivors anything in the
   heads-up case; or add an explicit abandonment penalty. I have proposed the first because it
   is the smallest change that closes the exploit, but the choice is yours.
2. **Should `room:start` be able to start a *new match* at all while players are still
   seated from the last one?** SEC-01's fix blocks it mid-match. If you also want the
   end-of-match "new match" restart to need everyone's consent rather than just the host's,
   say so — it is the same handler and roughly the same amount of work.
3. **Is the Expo Go landing page still wanted?** SEC-07 exists only because that template is
   served when there is no web build. If Expo Go previewing is no longer part of the
   workflow, deleting `server/templates/landing-page.html` and the `else` branch at
   `server/testApp.ts:128-137` closes the finding outright and removes a third-party CDN
   dependency with it.
