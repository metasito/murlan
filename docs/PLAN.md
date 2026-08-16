# Murlan — Remediation Plan

> ## Amendments since this plan was written (2026-08-15)
>
> The plan below was generated from the audit. These decisions supersede parts of it.
> Where they conflict, the amendments win.
>
> **1. There is no migration path. The database gets wiped.**
> The owner's instruction was "clean all, there is nothing worth saving." So **P2 is
> replaced by `npm run db:reset`** (`scripts/reset-db.mjs` + `drizzle-kit push`). Every
> consequence P2 was designed to manage disappears with the data:
> - no dedupe needed before the `room_players` unique indexes — the table is empty
> - no `schemaVersion` rescue for pre-existing 13-card `active_games` rows — there are none
>   (the version guard was still implemented, as protection for the *next* schema change)
> - the `session` table is preserved structurally and only emptied, because
>   `createTableIfMissing: false` means dropping it stops the server booting
>
> **2. Test runner: `node --test`, not vitest.** P0 called for vitest; Node 24 strips
> TypeScript natively, so the suite runs with **zero added dependencies** — which also
> respects the Replit "no native tooling" constraint better than the original proposal.
> Scripts: `npm test`, `npm run typecheck`, `npm run verify`.
>
> **3a. FINAL STATUS (2026-08-16).** Typecheck clean, **504 tests passing**, working tree
> committed on `murlan-hardening`. The depth plan
> (`docs/superpowers/plans/2026-08-16-murlan-depth.md`) is fully executed — all 11 tasks
> implemented, each independently reviewed, plus a whole-branch review and its fix wave,
> re-reviewed clean.
>
> The whole-branch review found five problems that per-task review structurally could not,
> because each lived at a seam between tasks. All are fixed:
> - teams mode resolved the match per player instead of per team, contradicting §3.1
> - teams mode could never record a loss (losing seats never entered `rankings`)
> - socket rate limits were keyed per socket, so one user with many sockets multiplied them
> - `npm run db:reset` supplied its own `--yes` guard and could wipe production unprompted
> - bot-filled tables recorded stats, making achievements farmable
>
> CI now runs the integration suites against a real Postgres service, and fails the build if
> they ever silently skip — they are what guard impersonation, hand secrecy, the exchange
> bypass and seat vacancy.
>
> **Outstanding, requiring the owner:** `eas.json` submit credentials are placeholders;
> `assets/images/android-icon-monochrome.png` is 432×432 against 512×512 siblings;
> `locales/sq.ts` is machine-translated outside the terms sourced in `docs/RULES.md` and
> needs a native speaker. Business decisions deliberately not taken: push notifications,
> ranked ladder, monetization, analytics SDKs.
>
> **3. Status at the previous amendment:** typecheck clean, **355 tests passing**. Waves 1 and
> 1.5 are complete and independently reviewed. Fixed and confirmed: socket impersonation,
> session cookie behind the proxy, runtime payload validation, friend-request IDOR,
> exchange-phase bypass, the seat-vacancy deadlock, account-deletion cascade, the straight
> enumerator, the pass threshold, the full-deck deal, match scoring, and the large-hand
> layout. **Not started:** the GUI rework, deduplicating the two game screens, i18n, the
> tutorial, and CI.
>
> **4. `runtimeVersion` was removed** from `app.json`. W6.4 correctly says not to add it
> without `expo-updates`, which is not installed. An agent added it anyway; it is gone.
> `expo-splash-screen` was added to `plugins` and the deprecated top-level `splash` key
> removed.
>
> **5. Correction to a claim repeated in the findings:** `canPlayerPlay` is exported but
> **never called anywhere in the app**. The broken straight enumerator therefore never
> produced a false "no valid move" for a human player — its only consumer was the AI. The
> user-visible symptom was an AI that passed while holding winning hands, not a blocked
> player.

Scope source: `docs/BRIEF.md`. Every task below maps to a workstream named in §4 of the brief. Ordering inside each workstream is by **dependency**, not severity — a critical bug that must wait for a precondition appears after that precondition.

Baseline verified at time of writing:
- `npx tsc --noEmit` → **1 error**: `server/index.ts(47,54): TS7006 Parameter 'd' implicitly has an 'any' type`.
- No test runner is installed (no vitest/jest in `package.json`), no `.github/` — W5 starts from zero.
- `lib/gameEngine.ts:200-210` still deals `CARDS_PER_GROUP = 13` and returns `excluded`; `findStartingPlayer:226-241` still scans `SPADE_RANK_ORDER`.

---

## 0. Preconditions that gate everything

These are not optional and they are not parallel with anything.

| # | Task | Files | Change | Verify |
|---|---|---|---|---|
| **P0** | Test runner exists | `package.json`, `vitest.config.ts` (new), `tsconfig.json` | Add `vitest` + `@vitest/coverage-v8` as devDeps, `"test": "vitest run"`, `"test:watch": "vitest"`. Alias `@/` to repo root so engine imports resolve. Do **not** add anything requiring native compilation (Replit constraint). | `npx vitest run` exits 0 with a single trivial passing spec. `npm run server:dev` still boots. |
| **P1** | Fix the live TS error | `server/index.ts:47` | Type the `d` parameter. | `npx tsc --noEmit` → clean. This becomes the gate for every later PR. |
| **P2** | Single schema migration lands first | `shared/schema.ts`, `drizzle.config.ts` | One PR containing **all** DDL that later tasks depend on: unique index on `room_players(room_id, user_id)` and `(room_id, seat_index)`; `index()` on `room_players.room_id`, `friends.user_id`, `friends.friend_user_id`; `onDelete: 'cascade'` on `room_players.userId`, `onDelete: 'set null'` on `rooms.hostUserId`; new `active_games.player_seats jsonb` column; functional unique index on `lower(users.username)` (raw SQL migration). | `npm run db:push` succeeds against the Replit DB. Then in psql: insert a duplicate `(room_id, user_id)` → must raise 23505. `DELETE FROM users WHERE id=...` for a user with room rows → must succeed. |

**Why P2 is a single PR:** `shared/schema.ts` is wanted by W1 (IDOR/uniqueness), W3 (seat map persistence), W6 (account deletion FK) and the perf work. Three agents editing it concurrently guarantees a merge conflict on a file where a bad merge silently produces a wrong migration. One owner, one migration, everyone rebases.

---

## W1 — Trust & authority

**Owner: one agent. Every task except W1.5/W1.6 edits `server/socket.ts`.** Do not split this workstream across agents.

### W1.1 — `trust proxy` (must land before anything else in W1)
- **Files:** `server/index.ts` (before `app.use(sessionMiddleware)`).
- **Change:** `app.set('trust proxy', 1)`. This single line fixes two confirmed defects at once: the production `Set-Cookie` being silently dropped (`express-session/index.js:242` → `issecure()` returns `req.secure === true` which is false behind Cloud Run), and `express-rate-limit` collapsing every client into one global bucket via `req.ip`.
- **Why first:** the impersonatable `handshake.auth.userId` branch is *load-bearing today* precisely because no session cookie ever reaches a production client. Removing the fallback before this lands locks out 100% of production users.
- **Verify:** deploy to Replit, then `curl -i -X POST https://<replit-domain>/api/auth/login -H 'content-type: application/json' -d '{"username":"...","password":"..."}'` → response **must** contain a `Set-Cookie: connect.sid=...; Secure; HttpOnly; SameSite=Lax` header. Then `curl -b` that cookie against an authenticated route and get 200. Until that curl shows `Set-Cookie`, W1.4 is blocked.

### W1.2 — Runtime payload validation + process survival
- **Files:** `server/socket.ts` (all handlers), new `server/socketSchemas.ts`.
- **Change:** a zod schema per event, parsed *before* destructuring. Every handler currently destructures in the parameter list (`({ emoji }: { emoji: string }) =>` at :837, `({ cardIds }: {...}) =>` at :579, `({ code })` at :327, and `room:create`/`game:rejoin` destructure *before* their `try` opens), and socket.io calls listeners inside `process.nextTick` with no guard. Concretely: `cardIds: z.array(z.string().max(64)).min(1).max(27)` (27, not 14 — see W2.8), `emoji: z.enum([...actual reaction set])`, `code: z.string().length(6).regex(/^[A-Z0-9]+$/)`, `gameMode: z.enum(['free_for_all','teams'])`. Wrap every handler body in try/catch. Register `process.on('uncaughtException')` and `process.on('unhandledRejection')` in `server/index.ts` (log + continue, do not exit). Set `maxHttpBufferSize: 8192` in the `SocketServer` options at `server/socket.ts:196-203`.
- **Verify:** `scripts/repro/crash-dos.ts` — connect a socket.io-client, `socket.emit('game:reaction')` with no argument, then `socket.emit('game:play', 42)`, then `socket.emit('room:set_game_mode', { roomId, gameMode: 'nonsense' })`. Assert the server process is still alive and responds to a subsequent `room:create`. Run with `npx tsx scripts/repro/crash-dos.ts`. Before the fix this kills the process on the first emit.

### W1.3 — Ticket-minting endpoint + client consumption
- **Files:** new `server/ticket.ts`, `server/routes.ts`, `lib/socket.ts`.
- **Change:** `POST /api/auth/socket-ticket` behind `requireAuth`, returning `{ ticket }` where ticket = `base64url(userId.expiry).HMAC-SHA256(SESSION_SECRET)`, 60s TTL, single-use (in-memory `Set` of consumed jti, swept on expiry). No new dependencies — `node:crypto` only, per brief §3. `lib/socket.ts` fetches the ticket with `credentials: 'include'` before `io()` and passes `auth: { ticket }`. Socket middleware accepts, in order: valid `req.session.userId`, **then** a valid ticket. The raw `userId` branch stays for now.
- **Depends on:** W1.1 (the mint endpoint needs a working session).
- **Verify:** log in on web, open devtools network → `socket-ticket` returns 200, websocket handshake carries `auth.ticket`. Replay the same ticket a second time → rejected. Wait 61s and use it → rejected.

### W1.4 — Delete the `handshake.auth.userId` fallback
- **Files:** `server/socket.ts:225-233`.
- **Change:** remove the branch entirely. `if (!socket.data.userId) return next(new Error('unauthorized'))`.
- **Depends on:** W1.1 verified in production **and** W1.3 shipped to every client (native binaries included — this is why it must precede the first EAS build in W6.4, not follow it).
- **Verify:** `scripts/repro/impersonate.ts` — authenticate as attacker A, `GET /api/users/search?username=victim` to obtain B's uuid, then `io(url, { auth: { userId: B } })`. Expect connection refused. Before the fix this succeeds, and `socket.emit('game:rejoin', { roomCode })` returns `sanitizeStateForPlayer(state, B, …)` — B's full hand.

### W1.5 — Per-socket rate limiting + reaction allowlist
- **Files:** `server/socket.ts` (`socket.use(...)` middleware).
- **Change:** token bucket, 10 events/sec/socket default, 1 per 10s for `room:create` and `room:quickmatch`, 3/min for `friend:invite`, 5/min for failed `room:join`. `game:reaction` payload validated against the real emoji set (already enforced by the zod enum in W1.2) — the remaining risk is rate, not size.
- **Depends on:** W1.2 (shares the middleware layer and the same file regions).
- **Verify:** `scripts/repro/flood.ts` emits 200 `game:reaction` in a tight loop; assert the room receives ≤ ~10/sec and the socket is not disconnected mid-game. Assert 20 rapid `room:create` produce ≤ 2 `rooms` rows.

### W1.6 — `friend:invite` authorization
- **Files:** `server/socket.ts:881-898`.
- **Change:** require `await storage.areFriends(userId, friendUserId)` (the function exists at `storage.ts:216` and is never called), require the sender to actually be in a room, and **ignore the client-supplied `roomCode`** — emit the server-known one from `socketRoomMap`.
- **Depends on:** W1.2, W1.5 (same file, same handler region).
- **Verify:** `scripts/repro/invite-spam.ts` — as a non-friend, emit `friend:invite` at a victim uuid with an arbitrary `roomCode`. Assert the victim's socket receives nothing. Manually confirm a real friend invite still auto-fills the join code at `app/(online)/index.tsx:54-55`.

### W1.7 — REST IDOR (parallel-safe; different files)
- **Files:** `server/routes.ts:214-240`, `server/storage.ts:199-241`.
- **Change:** `acceptFriend(id, accepterId)` / `declineFriendRequest(id, userId)`; add `and(eq(friends.id, id), eq(friends.friendUserId, userId), eq(friends.status, 'pending'))` to both queries; return 404 on zero rows affected. `storage.ts:260-266 cancelFriendRequest` already demonstrates the correct scoping pattern — copy it.
- **Verify:** as A, `POST /api/friends/request` to B, `GET /api/friends/sent` to read the id, then `POST /api/friends/accept/<id>` as A → must be 404. As B → 200. Assert `SELECT * FROM friends WHERE user_id=B` is empty in the first case.

### W1.8 — Rate-limiter keying (parallel-safe)
- **Files:** `server/routes.ts:19-31`.
- **Change:** now that `trust proxy` is set, add `keyGenerator` on `authLimiter` combining `ipKeyGenerator(req.ip)` with `req.body?.username` so one IP cannot lock a specific account, and one account cannot lock an IP.
- **Depends on:** W1.1.
- **Verify:** 21 failed logins for user X from IP 1 → X is limited, user Y from IP 1 still logs in. Confirm `req.ip` differs across two clients by logging it once in staging.

### W1.9 — CSPRNG shuffle (wiring only)
- **Files:** `server/socket.ts:533, 721` (call sites).
- **Change:** pass `randomInt` from `node:crypto` into the injected-RNG parameter added by **W2.7**. The engine keeps `Math.random` as its default so the client bundle is unaffected.
- **Depends on:** W2.7 (engine-side signature change). **This is a cross-workstream dependency — W1's agent must wait for W2's agent to land the signature.**
- **Verify:** `scripts/repro/shuffle-entropy.ts` — call the server's `initializeGame` path 1000× with the crypto RNG and assert uniform first-card rank distribution (χ² p > 0.01), and assert `Math.random` is never reached from a server code path (temporarily monkey-patch `Math.random` to throw in the test).

---

## W2 — Game integrity

**Owner: one agent for everything touching `lib/gameEngine.ts`.** W2.10 touches `server/socket.ts` and must be coordinated with W1/W3's owner.

### W2.1 — Write `docs/RULES.md` first
- **Files:** new `docs/RULES.md`.
- **Change:** the consolidated spec (deck, strength order, deal, opening, combinations, straights, what-beats-what, passing, exchange, teams, scoring) with each rule tagged as `CANON` (sourced) / `HOUSE` (our decision, e.g. royal straight beating bombs) / `APP` (generalisation with no source, e.g. 2p/3p scoring). Every subsequent code change cites a section number.
- **Verify:** review only. It is the reference every later PR is checked against.

### W2.2 — Characterization tests before touching the engine
- **Files:** new `lib/__tests__/gameEngine.characterize.test.ts`.
- **Change:** pin the *current* behaviour of `getCombinationType`, `getCombinationStrength`, `canPlay`, `processPlay`, `processPass`, `initializeRematch` on a fixed set of hands (seeded deterministic deck). These are not assertions of correctness — they are a tripwire so the rewrites below can prove what they changed.
- **Depends on:** P0.
- **Verify:** `npx vitest run` green on unmodified engine.

### W2.3 — Rewrite `enumStraights` (highest-value engine fix)
- **Files:** `lib/gameEngine.ts:395-402`.
- **Change:** stop slicing contiguous windows of the value-sorted hand. Build `Map<faceValue, Card[]>` from non-joker cards; walk distinct face values; for each maximal run of consecutive values emit every sub-run of length `5 .. runLength`; for each sub-run emit one play using an arbitrary representative per value **plus** one play per suit that can supply every value in the run (this is what makes royal straights discoverable). Do the whole thing twice — once with the ace-low value map, once ace-high. Deduplicate by sorted card-id key.
- **Verify (this is the brief's DoD item 2):** property test — generate 5,000 hands from the real `dealCards`, brute-force every subset up to length 13, compute the set of legal plays against a randomly chosen `lastPlayed`, and assert `getAllValidPlays` returns a superset covering every legal *straight* and *royal_straight*. Current measured failure rate: ~80-93% of individual legal straights unenumerated, and the enumerator finds zero straights in ~53-57% of hands that contain one. After the fix the property test must report 0 misses.

### W2.4 — Remove the 9-card cap
- **Files:** `lib/gameEngine.ts:397`.
- **Change:** delete `hi - lo <= 8`; bound by the actual run length (5..13). Per brief §3.1 no source imposes a maximum.
- **Depends on:** W2.3 (the cap existed to bound combinatorial blowup; once enumeration is per distinct-value run, the blowup is gone — removing it before W2.3 would make enumeration explode).
- **Verify:** `aiChoosePlay` on hand `3h..Qh` (10 consecutive, one suit) leading a new round must return a 10-card `royal_straight` and satisfy the finishing filter at `gameEngine.ts:444` (`p.cards.length === myCards`). Add a test for a 13-card single-run hand.

### W2.5 — Fix the pass threshold
- **Files:** `lib/gameEngine.ts:583-589`.
- **Change:** `activeCount - 1` is only correct while the player who made the last play is still active. Replace with an explicit responder count: `const lastPlayerStillIn = newState.players[newState.lastPlayedBy].hand.length > 0; const responders = activeCount - (lastPlayerStillIn ? 1 : 0); if (newState.passCount >= responders) { ... }`. Additionally, when `!lastPlayerStillIn`, set `roundWinner` to the next *active* player rather than to an already-finished seat (`app/(online)/game.tsx:473` reads `roundWinner` for the banner).
- **Why here:** in a 3-player game the moment anyone goes out, the threshold becomes 1 — so the very next pass ends the round and the third player is *always* skipped. This runs on the authoritative server (`server/socket.ts:671` and `:147` both call `processPass`), so it corrupts ranked online games.
- **Verify:** unit test replaying the confirmed trace — `p0=[4c,9h] p1=[5c] p2=[6c] p3=[8s]`, turn 3; `processPlay(p3, 8s)` → `processPass()` ×2. Assert p0 is offered the turn and can play `9h`, and that `roundWinner` is not seat 3.

### W2.6 — Leader must play (engine-level)
- **Files:** `lib/gameEngine.ts:579-606`.
- **Change:** `processPass` must reject when `lastPlayedCombination === null`. This is currently enforced only in the UI at `app/game.tsx:410` (`canPassNow = !isNewRound && ...`) — the server-authoritative engine does not uphold it. Return the state unchanged **and** signal rejection (see W2.7's return-shape note).
- **Depends on:** W2.5 (same function).
- **Verify:** `processPass` on a state with `lastPlayedCombination: null` returns a rejection; `server/socket.ts` `game:pass` responds `game:error` instead of silently no-oping.

### W2.7 — Exchange fallback + non-silent rejections + RNG injection
- **Files:** `lib/gameEngine.ts:652, 731-761, 191-198`.
- **Change:** (a) when `getValidGivebackCards(winnerHand)` is empty (winner holds no rank 3-10), fall back to the winner's lowest-strength card. This is a rules ambiguity — see §Ambiguities — but the *deadlock* must be removed regardless. (b) `processExchangeChoice` currently returns the identical `state` object on rejection (`:749`), which is indistinguishable from success to every caller; change the contract to `{ ok: boolean; state: GameState; reason?: string }` (or throw) so `server/socket.ts` and `context/GameContext.tsx:178` can react. (c) `shuffleDeck(deck, rng: (max: number) => number = (m) => Math.floor(Math.random() * m))` so W1.9 can inject `crypto.randomInt`.
- **Depends on:** W2.2.
- **Verify:** unit test with winner hand `J,J,J,J,Q,Q,Q,Q,K,K,K,K,A,A` → `getValidGivebackCards` returns 0, exchange still resolves, `exchangePhase.active === false`. Assert `processExchangeChoice` with a card the winner does not hold returns `ok: false`.

### W2.8 — Full-deck deal + 3♠ opening ⚠️ **the most dangerous change — see §Risk**
- **Files:** `lib/gameEngine.ts:200-210` (`dealCards`), `:221-241` (`findStartingPlayer`), `:337` (stale "26 cards" comment), `components/GameShared.tsx` (hand row geometry), `app/rules.tsx:98-100`.
- **Change:** deal the entire 54-card deck per brief §3.1 — 4p = 14/14/13/13, 3p = 18 each, 2p = 27 each. Delete `excluded` from the return type and every consumer. Then delete `SPADE_RANK_ORDER` and the "lowest spade" scan: with the whole deck dealt the 3♠ is always in someone's hand, so `findStartingPlayer` becomes a direct 3♠ lookup and the `players[0].hand[0]` fallback at `:240` (whose comment is currently false — measured ~1 in 30-40k two-player deals contain no spade at all) is removed. Fix `server/socket.ts:606`'s hardcoded `♠` in `Devi giocare il ${sc.rank}♠` while you are there.
- **Depends on:** W2.3, W2.4, W2.5, W2.7 **all landed and green**, and on W4.4 (shared `<HandBar>`) so the hand-row overflow fix is made once rather than twice.
- **Verify:**
  1. Invariant test over 100k deals: union of all hands === the 54-card deck exactly; no card appears twice; the 3♠ and both Jokers are always in play (currently ~7.3% of 4p deals have no Joker and ~3.7% no 3♠).
  2. Distribution test: 4p → sorted hand sizes `[13,13,14,14]`; 3p → `[18,18,18]`; 2p → `[27,27]`.
  3. `findStartingPlayer` always returns the holder of the literal 3♠; delete the fallback branch and assert it is unreachable (make it `throw`).
  4. **Layout:** `components/GameShared.tsx` `StraightHand` is sized around `CARD_W = 58` / `HAND_SECTION_H = CARD_H + 16`. Render 14, 18 and 27 card hands on a 375pt-wide device in landscape and screenshot; assert no card is clipped off-screen and the overlap step scales. This is the part that will be missed if the change is treated as engine-only.
  5. **Persistence:** any `active_games` row written before this change holds 13-card hands. Rehydrating one into a 14-card world is a corrupt state. Add a `schemaVersion` to the persisted `gameState`; on rehydration, if it does not match, emit `game:rejoin_failed` and delete the row rather than restoring it.

### W2.9 — Scoring and match target
- **Files:** new `lib/scoring.ts`, `shared/schema.ts` (already covered by P2 if a scores column is needed), `server/socket.ts:626-634`, `app/result.tsx`.
- **Change:** the engine has *no* scoring today — it produces only `rankings`. Add 3/2/1/0 per hand for 4p (generalised `N-1 … 0`), match won at 21 with escalation 31 → 41 → 51 and draw beyond. Fix the two confirmed defects in the server's cumulative scoring: it is keyed by engine ids (`player_0`) but labelled as usernames, and `activeGames.delete()` at `:521` precedes the `activeGames.get()` that reads prior scores, so cumulative scores reset every game. Key by `userId`, resolve display names at emit time, and persist `cumulativeScores` (it is currently hardcoded to `{}` on rehydration at `server/socket.ts:809-810`, so a Replit restart mid-series silently wipes the scoreboard).
- **Depends on:** W2.5 (rankings must be correct before they are scored), W3.3 (persistence round-trip).
- **Verify:** unit test — a 4p series where partners' placements sum to 21 across hands ends the match; a tie at 21 escalates to 31. Integration: start a series, `kill -9` the server, restart, rejoin → cumulative scores match pre-kill values (brief DoD item 4).

### W2.10 — Server-side rule enforcement gaps
- **Files:** `server/socket.ts:579-653` (`game:play`), `:655-685` (`game:pass`), `:174-192` (`persistGameState`), `:128`.
- **Change:** (a) add `if (game.gameState.exchangePhase?.active) { socket.emit('game:error', …); return; }` at the top of both `game:play` and `game:pass`. Today `game:play` checks turn, ownership, combination and start-card but never phase — and during the exchange the winner *is* the current turn with `lastPlayedCombination: null` and `firstPlayMade: true`, so every guard passes, `canPlay(combo, null)` returns true, the winner keeps the loser's best card without giving one back, and `exchangePhase.active` stays true forever (freezing every other client behind the `absoluteFillObject` overlay at `app/(online)/game.tsx:992` and leaving a turn-hijack token the winner can fire at any later moment). (b) `persistGameState`'s `onConflictDoUpdate` set must include `playerSeats` and `cumulativeScores`, and the insert must stop hardcoding `gameMode: "free_for_all"` / `maxPlayers: playerIds.length` — read them from the room. (c) `:128` AFK auto-play hardcodes `3♠`; read `gameState.startCard`.
- **Depends on:** W2.7 (exchange contract), W1.2 (this file is being restructured — coordinate with W1's owner; **same file, must serialize**).
- **Verify:** `scripts/repro/exchange-bypass.ts` — drive a rematch to the exchange phase, then emit `game:play` as the winner. Assert `game:error` and that the winner's hand is unchanged. Then emit `game:exchange_give_card` after the exchange resolved → assert no turn hijack (`currentTurnIndex` unchanged).

### W2.11 — Reconcile the rules screen and CLAUDE.md
- **Files:** `app/rules.tsx` (lines 35, 45, 50, 63-65, 70, 88-90, 98-100, 226, 227), `CLAUDE.md`.
- **Change:** every conflict listed in §Rules-vs-engine below. Notably: the deal figures (`26 / 17 / 13`) are false and the 3p figure is internally impossible (17×3 = 51 of 54, so 3 excluded, not 1); "Bomba … batte tutto" contradicts the engine at three places while `:85` states the exception correctly; the teams win condition at `:70` ("the pair whose first member finishes wins") directly contradicts `gameEngine.ts:546-563`. Correct the `CLAUDE.md` line asserting "suit also matters for tiebreaks" — no source supports it and the engine does not implement it.
- **Depends on:** W2.8, W2.9 (the screen must describe the shipped behaviour, not the intended one).
- **Verify:** a review checklist mapping each `docs/RULES.md` section number to the `app/rules.tsx` line that states it and the `lib/gameEngine.ts` line that enforces it. Brief DoD item 9.

### W2.12 — Delete dead wild-joker scaffolding
- **Files:** `lib/gameEngine.ts:109-122, 280-288`.
- **Change:** `isConsecutiveSequence`'s `jokerCount` parameter is only ever passed 0; the joker-filtering branches in `getCombinationStrength` for pair/triple are unreachable because `:251` rejects any multi-card selection containing a joker. Remove both. This is leftover scaffolding for a wild-joker rule the researched rules explicitly forbid, and it invites a future editor to re-enable behaviour that is not part of the game.
- **Depends on:** W2.2 (characterization tests must be green after removal).
- **Verify:** `npx vitest run` — no test changes.

---

## W3 — Resilience

**Owner: same agent as W1** (it is the same file). Order matters more here than anywhere else: three of these defects compound, and fixing one without the others leaves the table deadlocked by a different route.

### W3.1 — Retire the vacated seat (the critical one)
- **Files:** `server/socket.ts:942-981`, new helper `retireSeat(gameState, seatIdx)` in `lib/gameEngine.ts`.
- **Change:** the 60s disconnect timeout deletes the seat from `playerMap` (`:958`) but leaves the hand in `gameState.players[seat]`. `getNextActivePlayer` (`gameEngine.ts:612`) only skips *empty* hands, so the ghost seat stays in rotation; when the turn lands there `playerMap[nextTurnIdx]` is undefined so `startAfkTimer` is never armed (`:649-651`), and every survivor's `game:play`/`game:pass` is rejected by `playerMap[currentIdx] !== userId` (`:587`, `:663`). The table hangs forever. Fix: before deleting the mapping, empty the seat's hand, assign `finishPosition`, push to `rankings`, recompute `currentTurnIndex` via `getNextActivePlayer`, re-check `gameOver`, broadcast and persist.
- **Depends on:** W2.5 (retiring a seat changes the active count, which is exactly what the pass threshold reads — fixing retirement on top of the broken threshold produces a *different* skipped-player bug).
- **Verify:** `scripts/repro/orphan-seat.ts` — 3-player game A/B/C; B's socket disconnects and never returns; advance 60s; then A plays, C plays, and the turn wraps to B's old seat. Assert the game either ends or offers the turn to a live player within one tick, and that no state has `currentTurnIndex` pointing at a seat absent from `playerMap`. Note: verify on **web** as well as native — `Alert.alert` is a no-op in react-native-web (`react-native-web/dist/exports/Alert/index.js`), so the `game:player_left` client kick at `app/(online)/game.tsx:519-540` does *not* rescue web players.

### W3.2 — One turn-advance epilogue, always arming the AFK timer
- **Files:** `server/socket.ts:135-151` (`handleAutoPass` branches), `:651`, `:680`, `:570`, `:812-828` (rehydration).
- **Change:** extract the epilogue used by `game:play`/`game:pass` into `advanceTurn(roomCode, game)` that broadcasts, persists, and — when `!gameOver` — always calls `startAfkTimer(roomCode, playerMap[newState.currentTurnIndex], …)`. Call it from **every** `handleAutoPass` exit path and immediately after DB rehydration (which currently arms no timer at all). Today `startAfkTimer` deletes its own map entry at `:162` before invoking `handleAutoPass`, and the normal auto-pass branches never re-arm — so the AFK safety net works exactly once per table, then the next unresponsive-but-connected player hangs it indefinitely.
- **Depends on:** W3.1 (retirement is one of the paths that must run through the same epilogue).
- **Verify:** `scripts/repro/afk-chain.ts` — 4 players, none of whom ever act. Assert the game reaches `gameOver` purely by auto-passes, with an AFK notification per turn and no stall. Additionally assert an AFK timer exists (inspect `afkTimers`) after a server restart + rejoin.

### W3.3 — Persist seats by seat, not by array position
- **Files:** `server/socket.ts:174-192, 794-828, 957-964`, `shared/schema.ts` (column added in P2).
- **Change:** write `playerSeats` as a jsonb `{ "0": userId, "2": userId, "3": userId }` and rehydrate with `Object.entries` verbatim. Today `playerIds` is written as the **compacted** `Object.values(g.playerMap)` after a seat removal while `gameState.players` keeps its original indices, and rehydration does `Object.fromEntries(ids.map((id, i) => [i, id]))` (`:807`) — so `{0:A, 2:C, 3:D}` persists as `[A,C,D]` and restores as `{0:A, 1:C, 2:D}`. `sanitizeStateForPlayer` (`:60-67`) then ships C the hand at index 1, which belongs to the *removed* player, and grants C turn authority over that seat. Also re-emit `room:state` on rejoin so the client's `mySeatIndex` (`context/OnlineGameContext.tsx:275-279`, set only from the last `room:state`) is refreshed rather than stale.
- **Depends on:** P2 (column), W3.1 (retirement is the only producer of non-contiguous seat maps — fix the producer and the consumer in the same series).
- **Verify:** `scripts/repro/rehydrate-seats.ts` — 4-player game A0/B1/C2/D3; time B out; `kill -9` the server; restart; C rejoins. Assert C receives the hand from `players[2]` (their own), D receives `players[3]`, and no client is ever shown another player's cards. Brief DoD item 4.

### W3.4 — Idempotent rejoin + non-racy seat allocation
- **Files:** `server/socket.ts:769-772, 815-818, 339-350, 410-418`, `server/storage.ts:145-147`.
- **Change:** `addRoomPlayer` becomes `.onConflictDoNothing()` (unique index from P2 makes the existing `.catch(() => {})` actually fire); better, skip the insert on rejoin entirely — the row already exists, the 60s timeout is the only thing that deletes it. Replace `const seatIndex = players.length` with a single-statement allocation (`INSERT … SELECT COALESCE(MAX(seat_index)+1, 0) …`) or a `SELECT … FOR UPDATE` on the rooms row. De-duplicate by `userId` when building `playerSetup`/`playerMap` in `room:start` and `game:rematch_vote`.
- **Why:** today every reconnect (`context/OnlineGameContext.tsx:104-108` re-emits `game:rejoin` on every `connect`) appends a row. `getRoomPlayers` then returns the user N times, `room:start`/rematch build an N-entry `playerSetup` so `dealCards` hands live cards to seats nobody owns, and `playerMap` silently collapses the duplicates — the same unownable-seat deadlock as W3.1, reachable by a mobile network blip.
- **Depends on:** P2.
- **Verify:** `scripts/repro/rejoin-dup.ts` — force 5 reconnects for one player, then `SELECT count(*) FROM room_players WHERE room_id=… AND user_id=…` → must be 1. Then trigger a rematch and assert `playerSetup.length === playerMap` key count.

### W3.5 — Guard `userSocketMap.delete`
- **Files:** `server/socket.ts:914-915`.
- **Change:** `if (userSocketMap.get(userId) === socket.id) userSocketMap.delete(userId);` and skip the entire disconnect/grace block when the guard fails. Today the delete is unconditional, so on a mobile network switch (socket.io-client reconnects with a new id long before the server times out the old socket) the late `disconnect` wipes the *live* entry — the player silently stops receiving `game:state` (every per-user emit goes through this map: `:995-1002`, `:554`, `:734`, `:43`, `:50`, `:890`) while socket.io still sees a healthy connection.
- **Depends on:** none (isolated block), but same file → serialize.
- **Verify:** `scripts/repro/reconnect-race.ts` — open socket 1, open socket 2 for the same userId, close socket 2. Assert socket 1 still receives a subsequent `broadcastGameState` and still shows online to friends.

### W3.6 — Intentional mid-game leave uses the same retirement routine
- **Files:** `server/socket.ts:1048-1057` (`handleLeaveRoom` `in_progress` branch).
- **Change:** today this only deletes the rematch vote and emits `game:player_left` — `playerMap` is untouched, so the leaver keeps their seat, `startAfkTimer` keeps being armed for them, `handleAutoPass` keeps playing their cards, and `broadcastGameState` (which addresses by userId, not by socket.io room membership) keeps sending them their full hand on the lobby screen. Route it through W3.1's retirement.
- **Depends on:** W3.1.
- **Verify:** tap "Esci" mid-game, then open another room. Assert `app/(online)/room.tsx:161-165`'s `if (gameState) router.replace("/(online)/game")` does **not** yank you back into the abandoned game, and that the remaining players' turn cycle skips the vacated seat.

### W3.7 — Clear timers at game over
- **Files:** `server/socket.ts:637-646`, `:949-978`.
- **Change:** clear the room's `disconnectTimers` and `afkTimers` in the game-over branch, and guard the removal block with `if (!g.gameState.gameOver)`. Today a player who drops 40s before the match ends has their timer fire 20s into the results screen: they are removed from `room_players` and `playerMap` and `game:player_left` is broadcast mid-rematch-vote. In a 2-player match this also hits `activeGames.delete` at `:967`, so the survivor's `game:rematch_vote` silently returns at `:687` and the cumulative scoreboard is lost.
- **Depends on:** W2.9 (scoreboard must be worth preserving), W3.1.
- **Verify:** `scripts/repro/dc-timer-gameover.ts` — B disconnects at T, game ends at T+40s, wait to T+70s. Assert no `game:player_left` is emitted after `game:over`, and that a rematch vote still works.

### W3.8 — Reap finished games
- **Files:** `server/socket.ts:637-646, 1023-1101`.
- **Change:** there are only two `activeGames.delete` sites (`:521`, `:967`); the game-over branch deletes the DB row but leaves the in-memory entry, and `status === 'finished'` matches neither leave branch. Delete the entry when the last member leaves a finished room, plus a periodic sweep dropping `gameOver === true` entries older than a few minutes.
- **Depends on:** W3.7.
- **Verify:** play 20 matches to completion, returning to lobby each time. Assert `activeGames.size === 0` (expose it on a dev-only `/api/_debug/stats` route behind `NODE_ENV !== 'production'`).

### W3.9 — Exchange freeze fallback + honest AFK notification
- **Files:** `server/socket.ts:102-115, 161-169`.
- **Change:** add the missing `else` — when the winner holds no valid giveback card, resolve the phase server-side (W2.7's engine fallback) and broadcast. Make `handleAutoPass` return `boolean` (true only on paths that actually mutate `game.gameState`) and emit the "`${username}` è inattivo — passato automaticamente" notification only when it returns true. Today it fires unconditionally after five different no-op paths, telling everyone a move happened while the board is frozen.
- **Depends on:** W2.7, W3.2.
- **Verify:** unit test forcing the no-valid-card exchange state; assert the phase resolves and no `game:notification` is emitted for a no-op auto-pass.

### W3.10 — Client can rejoin after an app restart
- **Files:** `context/OnlineGameContext.tsx:104-108`, `server/socket.ts:334-337`.
- **Change:** persist `{roomId, roomCode}` to AsyncStorage when a game starts, clear on game over/leave, and emit `game:rejoin` on connect whenever it exists. Additionally let `room:join` fall through to the rejoin path when the caller is already in the room's seat map, instead of rejecting with `Partita già iniziata`. Today `OnlineGameContext.tsx:107` is the *only* `game:rejoin` emitter in the app and it is gated on two provider-local refs that die when the provider unmounts (it lives only inside `app/(online)/_layout.tsx:21`) — so the entire DB rehydration path is unreachable after the most common failure mode, an app swipe-out.
- **Depends on:** W3.3 (rehydration must be correct before it becomes reachable).
- **Verify:** on device, mid-game, force-quit the app, relaunch, and confirm you land back in the game with your own hand. Repeat after also restarting the Replit server. Brief §5 Tier 1 "Rejoin-in-progress UX".

---

## W4 — Client architecture

**Owner: one agent for W4.3–W4.7.** `app/game.tsx` (946 lines), `app/(online)/game.tsx` (1465) and `components/GameShared.tsx` share ~490 identical in-order lines; any two agents editing them concurrently will conflict on nearly every hunk. See §Parallelism.

### W4.1 — Fix the hooks-after-early-return crash (do this first, alone)
- **Files:** `app/(online)/game.tsx:586`.
- **Change:** `if (!gameState) return null;` is followed by eleven hooks (`useMemo` at 588/589/593/598, `useEffect` 613, `useAnimatedStyle` 629/645, `useMemo` 650/662/669/676). Any non-null → null transition while mounted drops the hook count from ~30 to ~19 and React throws. The path is ordinary: `OnlineGameContext.tsx:107` emits `game:rejoin` on every reconnect, `server/socket.ts:790` replies `game:rejoin_failed` when the room is gone (e.g. after a Replit restart), `OnlineGameContext.tsx:225-234` sets `gameState` null from a socket handler, and the only navigation is a *later* effect at `app/(online)/game.tsx:543` — so the null render provably commits. The string is present in the production renderer, so this is not dev-only. Fix by splitting: a thin `OnlineGameScreen` that does the null check, and an inner `<GameBoard gameState={gameState}>` that owns every hook.
- **Note:** the equivalent offline pattern at `app/game.tsx:390` was investigated and is **not** currently reachable (both updates batch into one commit that unmounts the route). Do not "fix" it speculatively as part of this task — fold it into W4.5's shared component instead.
- **Verify:** with the app on the online game screen, restart the server so `game:rejoin_failed` arrives. Assert the screen navigates to the lobby without the ErrorBoundary appearing. Add a render test mounting the screen with a context that flips `gameState` non-null → null.

### W4.2 — Trivial correctness fixes (parallel-safe, different files)
- **Files:** `app/(online)/index.tsx:183,207`, `app/(online)/friends.tsx:219,223,298,302,327,580`, `app/(online)/room.tsx:121,539`.
- **Change:** replace the string literal `"Colors.success"` with the token `Colors.success` (10 sites). `styles.dot` has no `backgroundColor` fallback, so the "connected" indicator currently renders with no fill.
- **Verify:** `rg '"Colors\.' app components` returns zero. Visually confirm the dot is green when connected.

### W4.3 — Suit colours (parallel-safe)
- **Files:** `components/CardView.tsx:218`, `lib/theme.ts`.
- **Change:** `Colors[card.suit as keyof typeof Colors]` resolves to `undefined` because `Suit` is plural (`"hearts"|"diamonds"|"clubs"|"spades"`) while the theme tokens are singular (`heart`/`diamond`/`club`/`spade`), and the cast silences the compiler. Add `export const SuitColor: Record<Suit, string>` and use `SuitColor[card.suit]`; remove the cast so the compiler catches the next drift. The colourblind-safe palette documented at `theme.ts:45-48` has never once rendered.
- **Verify:** `npx tsc --noEmit` clean without the cast. Screenshot a hand containing all four suits: hearts red, diamonds amber, clubs green, spades blue. This is also the cheapest half of brief §5 Tier 3 "Colourblind-safe suit differentiation".

### W4.4 — Extract `<HandBar>` and `useTurnTimer`
- **Files:** `components/GameShared.tsx`, `app/game.tsx:636-704`, `app/(online)/game.tsx:886-946`.
- **Change:** one shared `<HandBar>` owning PASSA + `StraightHand` + GIOCA, the `giocaGlow` shared value and its bloom effect, the PASSA pulse, and the hand-section scale — all of which exist byte-identically or have silently diverged. Props carry the disabled-label state so the online player finally sees `NON VALIDA` / `TROPPO BASSA` instead of a bare dim `GIOCA`. Add `useTurnTimer` (offline-only today at `app/game.tsx:257-276`) and drive it online from the server's 30s AFK window, plus a shared `<StartCardBanner/>` (offline-only at `:595-609`).
- **Depends on:** W4.1.
- **Verify:** `git diff --no-index app/game.tsx "app/(online)/game.tsx"` line count drops materially from today's 456 deletions / 975 insertions. Play both modes and confirm identical button feedback, an online countdown that expires into the server's auto-pass, and the exchange sound (`playExchange`, currently not even imported online) firing in both.

### W4.5 — Collapse to one `<GameBoard>` behind a common view model
- **Files:** `components/GameShared.tsx` (new `GameBoard`), `app/game.tsx`, `app/(online)/game.tsx`.
- **Change:** define one `GameViewModel` interface (`hand`, `seats`, `pile`, `isMyTurn`, `canPass`, `exchange`, `onPlay`, `onPass`, `onSelect`) implemented once by `GameContext` (offline) and once by `OnlineGameContext` (online). Both routes become thin adapters. Also unify selection ownership (context offline vs local `useState` online) and null-guarding of `currentPlayer`.
- **Depends on:** W4.4. **Blocks:** nothing — but it must land before W4.6 and W7.1/W7.3 so those are done once.
- **Verify:** play a full 4-player offline game and a full online game with identical UI behaviour, including the flying-card animation and `pileState` visibility (a `MUST NOT CHANGE` item in CLAUDE.md — screenshot-compare before/after frame by frame). Assert `CARD_W`, `CARD_H`, `SIDE_BTN_W`, `TABLE_M` are defined once and imported, never redefined.

### W4.6 — Render cost
- **Files:** `components/GameShared.tsx:487, 580-582`, `components/CardView.tsx:41-46, 131`, `app/game.tsx:394`.
- **Change:** `React.memo` on `CardItem`, `CardView`, `OrnateCardBack`, `CardFan`, `AvatarCircle`, `TopOppSlot`, `SideOppSlot`. Make `onPress` stable (pass `card.id` down, hoist a `useCallback`) — memo alone does nothing while `onPress={() => onPress(card.id)}` mints a closure per card per render. Replace `selectedIds.includes(card.id)` with a `Set`. Memoize `sortedHand` offline (online already does at `:588`). Hoist `OrnateCardBack`'s dot grid to module scope keyed by (w,h) — there are two sizes. Move `timeLeft` into an isolated `<Timer/>` so the 1s tick does not re-render the board.
- **Depends on:** W4.5 (otherwise memoized twice, in two files, differently). Becomes more urgent after W2.8: 27-card hands make the per-second full-board re-render ~2× costlier.
- **Verify:** React DevTools profiler — during a timed turn, the commit triggered by the timer tick must contain only the `<Timer/>` subtree.

### W4.7 — Delete dead code
- **Files:** `context/InviteContext.tsx` (delete), `constants/colors.ts` (delete), `app/game.tsx:37-56, 89-91, 805-821`, `app/(online)/game.tsx:1, 25, 40, 44-70, 369, 1089-1112, 1465`.
- **Change:** `InviteContext.tsx` is a 2-line re-export with no importer. `constants/colors.ts` has zero references yet contradicts `lib/theme.ts` on `bg`, `textSecondary`, `textMuted` and ships the pre-fix red/black-only suit pairs — and CLAUDE.md's claim that "existing screens still use this" is false, so correct that table row too. Drop `formatSpadeLabel`, the unused imports (`BTN_W`, `BTN_H`, `SIDE_SECTION_W`, `sharedStyles`, `StartReason`, `CARD_W`, `Player`, `useCallback`, `FadeOut`), the orphaned `turnPill`/`turnDot`/`turnText`/`onlineIndicator` styles, and the `memo()` on a route component expo-router renders with no props.
- **Depends on:** W4.5 (these files are being rewritten anyway — deleting first creates pointless conflicts).
- **Verify:** `npx expo lint` clean, `npx tsc --noEmit` clean, app boots.

### W4.8 — `expo-av` → `expo-audio` (fully parallel-safe: one file)
- **Files:** `lib/sounds.ts:1, 53-94, 169-185`, `app.json` plugins.
- **Change:** `Audio.setAudioModeAsync({playsInSilentModeIOS, staysActiveInBackground, shouldDuckAndroid})` → `setAudioModeAsync({playsInSilentMode: true, shouldPlayInBackground: false, interruptionModeAndroid: 'duckOthers'})`; `Audio.Sound.createAsync` → `createAudioPlayer`; `setPositionAsync(0) + playAsync()` → `player.seekTo(0); player.play()`. ~60 lines, one file, no call-site changes — the public API (`playCardPlay`, `playBomb`, …) is unchanged. Add `["expo-audio", { "microphonePermission": false }]` to `app.json` plugins. The web path (Web Audio API, `:6-49`) is untouched.
- **Verify:** on a physical device, every one of the twelve sounds plays. Then `npx expo config --type introspect` → `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` and `NSMicrophoneUsageDescription` must all be gone.

### W4.9 — Remove unused dependencies (parallel-safe)
- **Files:** `package.json`.
- **Change:** `npm uninstall @stardazed/streams-text-encoding @ungap/structured-clone expo-blur expo-glass-effect expo-image expo-image-picker expo-location expo-symbols http-proxy-middleware ws zod-validation-error`. Do **not** remove: `pino-pretty` (string-referenced at `server/logger.ts:7`), `tsx` (npm script), `expo-font`/`expo-web-browser` (app.json plugins), `react-dom`/`react-native-web`/`react-native-screens`/`react-native-worklets`/`expo-constants`/`expo-linking`/`expo-status-bar`/`expo-system-ui` (indirect but required), `expo-av` until W4.8 lands.
- **Depends on:** W4.8 for the `expo-av` line only; the other 11 are independent.
- **Verify:** `npx expo-doctor` clean; `npx expo config --type introspect` android permission list reduces to `INTERNET`; app boots on web and device; `npm run server:build` succeeds. **Replit check: press Run and confirm the app starts with no additional setup** (brief DoD item 8).

### W4.10 — Design token adoption (do last)
- **Files:** `lib/theme.ts`, all 11 screens.
- **Change:** add semantic tokens (`onGold`, `surfaceRaised`) and replace the three competing literals for text-on-gold (`Colors.bg` in `MenuButton.tsx:69`, `"#031008"` in `quickmatch.tsx:354`, `"#0A1F18"` in six files, `"#0A1F10"` in four). Adopt `Spacing`/`Radius`/`FontSize` in the nine unconverted screens — today they reach exactly two files (`MenuCard.tsx`, `MenuButton.tsx`). Resolve the duplicate `MenuButton` (`app/index.tsx:39` shadows `components/MenuButton.tsx`) by promoting one.
- **Depends on:** W4.5, W4.7 (touching every screen while two of them are being rewritten is the worst possible merge).
- **Verify:** `rg '#0A1F1[08]|#031008' app components` returns only `lib/theme.ts`. Screenshot every screen before/after and diff for unintended shifts.

---

## W5 — Test & CI

### W5.1 — Engine unit tests
- **Files:** `lib/__tests__/`.
- **Change:** every combination type, the full `canPlay` matrix (including bomb-beats-everything, royal-straight-beats-bomb, same-length straight comparison, jokers-as-singles-only), the exchange phase including the two-joker exception, the win condition in both free-for-all and teams.
- **Depends on:** P0. Written **alongside** each W2 task, not after.
- **Verify:** `npx vitest run` + coverage ≥ 90% of `lib/gameEngine.ts` statements.

### W5.2 — Property tests (brief DoD item 2)
- **Files:** `lib/__tests__/gameEngine.property.test.ts`.
- **Change:** (a) enumerator completeness — for random hands and random `lastPlayed`, brute-force every subset and assert `getAllValidPlays` finds every legal play. (b) Deal invariants — union of hands === deck, no duplicates, 3♠ and both Jokers always present. (c) Round invariants — no player is ever skipped while holding cards; `currentTurnIndex` always points at an active, mapped seat; `passCount` never exceeds the responder count.
- **Depends on:** W2.3, W2.5, W2.8.
- **Verify:** `npx vitest run` — 0 counterexamples over 5,000 seeded cases.

### W5.3 — Server integration tests over a real socket
- **Files:** `server/__tests__/`, a `storage` seam allowing an in-memory implementation.
- **Change:** boot the real Express+socket.io server on an ephemeral port, drive it with `socket.io-client`. Cover: impersonation refused (W1.4), malformed payload does not kill the process (W1.2), exchange bypass refused (W2.10), orphan seat resolves (W3.1), AFK chain completes (W3.2), seat map survives restart (W3.3), duplicate rejoin is idempotent (W3.4).
- **Depends on:** W1.2, W3.1–W3.4.
- **Verify:** `npx vitest run server` green; each test corresponds to a `scripts/repro/*.ts` that failed before its fix.

### W5.4 — CI
- **Files:** new `.github/workflows/ci.yml`.
- **Change:** on every push and PR — `npm ci`, `npx tsc --noEmit`, `npx expo lint`, `npx vitest run`, `npm run server:build`. No native build in CI (that is EAS's job).
- **Depends on:** P1, W5.1.
- **Verify:** open a PR with a deliberate type error and confirm CI fails.

### W5.5 — Replit regression guard
- **Files:** `docs/RELEASE-CHECKLIST.md`.
- **Change:** a manual step — press Run on Replit, confirm the server boots on `process.env.PORT`, the Expo web bundle serves, login sets a cookie, and a 2-player online game completes. CI cannot cover this and the brief makes it a DoD item.
- **Verify:** the checklist itself, executed before every deploy.

---

## W6 — Store readiness

### W6.1 — Make account deletion actually work
- **Files:** `server/storage.ts:44-53`.
- **Change:** wrap `deleteUser` in a transaction that removes `room_players` and nulls/deletes `rooms.host_user_id` before deleting friends/session/users. Currently `rooms` rows are immortal (no `delete(rooms)` anywhere in `server/`) and every `room:create`/`room:quickmatch` writes `host_user_id`, so **any user who has ever created a room gets a 500** — `routes.ts:124-127` returns `Eliminazione fallita`. This is a GDPR/right-to-erasure failure, not only a store issue.
- **Depends on:** P2 (`onDelete` cascade/set-null is the cleaner half of the fix).
- **Verify:** register a user, create a room, quickmatch, add a friend, play a game, then `DELETE /api/users/me` → 200. Then assert zero rows referencing that uuid across `users`, `friends`, `room_players`, `rooms.host_user_id`, `session`. Brief DoD item 5.

### W6.2 — Mount the deletion UI (highest store risk)
- **Files:** `app/index.tsx`, `app/(online)/index.tsx`, `components/SettingsModal.tsx:31-32`.
- **Change:** `SettingsModal` is the **only** component that calls the deletion endpoint and it is never imported or rendered anywhere in the app — no screen has a settings or profile control. Mount it from the home screen header (next to `FriendsButton`) and from the online lobby, wire `visible`/`onClose`. Also check `res.ok`: the current `await fetch(...)` never inspects the response, so a 500 still clears the query cache and logs the user out as if deletion succeeded.
- **Depends on:** W6.1 (mounting a button that returns 500 is worse than no button).
- **Verify:** fresh install → register → find the settings entry within 3 taps from the home screen → delete account → confirm you are logged out and the credentials no longer authenticate. Also confirm the Suoni/Vibrazione toggles are now reachable (they were unreachable, which is the real reason the app cannot be muted).

### W6.3 — Purge phantom permissions
- **Files:** covered by W4.9 (`expo-location`, `expo-image-picker`) and W4.8 (`expo-av` → mic).
- **Change:** none beyond those; this task is the **verification gate**.
- **Verify:** `npx expo config --type introspect` → `android.permissions` must be exactly `["android.permission.INTERNET"]`, and `ios.infoPlist` must contain none of `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`. Today all six are present with the English placeholder `Allow $(PRODUCT_NAME) to access your location` in an Italian card game.

### W6.4 — Build pipeline
- **Files:** new `eas.json`, `app.json`.
- **Change:** `eas build:configure` → development/preview/production profiles; `"appVersionSource": "remote"` (EAS-managed auto-increment, which removes the duplicate-build-number problem); add `"runtimeVersion": { "policy": "appVersion" }` only if `expo-updates` is later added — it is not installed today, so do not add it speculatively. Add `expo-splash-screen` to `app.json` plugins (it is a dependency and autolinked, but the legacy top-level `splash` key is the only config present).
- **Depends on:** W1.4 (a binary shipped with the old handshake auth would have to be force-upgraded later), W4.8, W4.9, W6.3.
- **Verify:** `eas build --platform ios --profile production` and `--platform android` both produce artifacts. Brief DoD item 7.

### W6.5 — ATS + splash colour
- **Files:** `app.json`.
- **Change:** add an explicit `ios.infoPlist.NSAppTransportSecurity` with `NSAllowsArbitraryLoads: false` plus a localhost-only dev exception (the inherited Expo template currently resolves to `NSAllowsArbitraryLoads: true`, which App Store Connect surfaces and may require written justification for). Align `splash.backgroundColor` and `android.adaptiveIcon.backgroundColor` from the stale `#061410` to `Colors.bg` `#031008` — today the splash flashes a visibly different green than the app it launches into.
- **Depends on:** W6.4 (same file, same PR is cleaner).
- **Verify:** `npx expo config --type introspect` shows `NSAllowsArbitraryLoads: false`. Cold-launch on device and confirm no colour flash.

### W6.6 — Store content
- **Files:** new `docs/PRIVACY.md`, store listing copy, screenshots.
- **Change:** privacy policy URL, support URL, App Privacy questionnaire answers (after W6.3, the honest answer is "data not collected" beyond username + gameplay), Italian as primary language, screenshots from the post-W4.10 build.
- **Depends on:** W6.3 (the questionnaire answers change if permissions remain), W4.10 (screenshots).
- **Verify:** submission checklist walked end-to-end in App Store Connect / Play Console without a blocking field.

### W6.7 — Confirm offline play stays ungated
- **Files:** regression test only.
- **Change:** none — verified: `app/index.tsx:255` pushes `/lobby?mode=ai` with no auth check (only "Gioca con amici" and "Online" at `:256-257` branch on `user`), `app/lobby.tsx:118` degrades to `user?.username ?? "Giocatore 1"`, and `AuthProvider` never redirects. **The brief's open question is answered: there is no 5.1.1(v) exposure on this axis.** Lock it in so a future auth change does not regress it.
- **Verify:** integration test asserting the `/lobby?mode=ai` route renders with a null auth context. Brief DoD item 6.

---

## W7 — Product & design

### W7.1 — Accessibility on the game and result flow
- **Files:** `components/GameShared.tsx` (post-W4.5, therefore once), `app/result.tsx`, `components/NotificationBanner.tsx`, `components/OfflineBanner.tsx`.
- **Change:** `accessibilityRole="button"` + Italian `accessibilityLabel` on the quit, PASSA and GIOCA controls, plus `accessibilityState={{ disabled: !canPassNow }}` (disabled state is currently conveyed only by opacity). `accessibilityLiveRegion="polite"` on `NotificationBanner`/`OfflineBanner`/the turn indicator, with `AccessibilityInfo.announceForAccessibility` for iOS. `grep -c accessibility` is currently **0** across twelve files including both game screens; only `CardView.tsx:241` labels anything, so cards read out but nothing around them does.
- **Depends on:** W4.5 (adding these to two duplicated screens doubles the work and guarantees drift).
- **Verify:** VoiceOver on iOS and TalkBack on Android — navigate a full turn using only the screen reader: whose turn it is, what is on the pile, why GIOCA is disabled.

### W7.2 — Touch targets (parallel-safe)
- **Files:** `app/index.tsx:453,465-472`, `app/auth.tsx:259`, `app/lobby.tsx:481-491`.
- **Change:** add `hitSlop={{top:12,bottom:12,left:12,right:12}}` to `logoutBtn` (~41×21pt), `eyeBtn` (22×22 — roughly half the minimum in both axes, and it sits directly beside the password field so mis-taps refocus the input), `friendsBtnCompact` (~32×32, currently `hitSlop={4}`) and `difficultyBtn` (~28pt tall). The pattern already exists at `rules.tsx:167` and `lobby.tsx:263`.
- **Verify:** on a small physical device, tap each control ten times at its visual edge; all ten must register.

### W7.3 — Contrast on move-rejection text
- **Files:** shared `<HandBar>` (post-W4.4).
- **Change:** `playBtnLabelDim` is `rgba(201,168,76,0.4)` at 10px over `rgba(40,30,5,0.7)` over the felt — a measured **2.23:1**, below even the 3:1 large-text floor, for the only text explaining *why* a play was refused. Raise to solid `Colors.goldLight` at `FontSize.sm` (≈6.7:1) and surface the same message as an accessibility announcement.
- **Depends on:** W4.4 (otherwise fixed twice, in `app/game.tsx:938` and `app/(online)/game.tsx:1227`).
- **Verify:** compute the ratio from the composited values and assert ≥ 4.5:1; screenshot at 10% brightness.

### W7.4 — Make the haptics and reduced-motion settings real
- **Files:** all ten screens importing `expo-haptics` directly, `lib/haptics.ts`, `lib/accessibility.ts:4-23`, `app/index.tsx:143-166`.
- **Change:** `lib/haptics.ts` exposes a guarded API (`const guard = () => _hapticsEnabled && isNative`) and **not one of its exports is ever called** — every screen imports `expo-haptics` raw, so the "Vibrazione" toggle changes nothing. Replace all direct imports with the wrappers. Implement `usePrefersReducedMotion`'s native branch with `AccessibilityInfo.isReduceMotionEnabled()` + `addEventListener('reduceMotionChanged')` (it is currently a stub returning `false`, and has zero importers), then consume it in the four `withRepeat(..., -1)` FloatingCard loops on the home screen and the turn pulse.
- **Depends on:** W6.2 (the toggles must be reachable for this to be user-visible).
- **Verify:** enable "Riduci movimento" in OS settings → home screen cards static. Toggle Vibrazione off in-app → no haptics anywhere, confirmed on device.

### W7.5 — Rebrand the crash screen (parallel-safe)
- **Files:** `components/ErrorFallback.tsx`.
- **Change:** it is unmodified Expo boilerplate — `Something went wrong` / `Please reload the app to continue.` / `Try Again`, the only English user-facing strings in the app, on `#000000`/`#FFFFFF` with an iOS-blue `#007AFF` link and system fonts, honouring `useColorScheme()` even though `app.json` pins `userInterfaceStyle: "dark"`. It ships to production (`ErrorBoundary.tsx:22-26` sets it as default with no `__DEV__` guard, wrapping the whole tree at `app/_layout.tsx:73`). Rewrite against `lib/theme.ts` with Italian copy and `components/MenuButton`.
- **Verify:** throw deliberately from a screen in a production build; confirm branded Italian fallback and that "Riprova" recovers.

### W7.6 — i18n layer
- **Files:** new `locales/{it,en,sq}.json`, ~22 client files, `server/routes.ts`, `server/socket.ts`, `server/schemas.ts`.
- **Change:** `expo-localization` + `i18n-js`. Critically, the **server must return stable codes**, not Italian prose: `app/auth.tsx:58` does `setError(parsed.message ?? msg)` verbatim, so translating the client alone still shows Italian errors. 27 server `message:` literals become `{ code: 'USERNAME_TAKEN' }` with the client mapping codes to strings. Set `app.json` `locales`.
- **Depends on:** W4.10 (string extraction across screens that are still being rewritten is wasted work), W6.6.
- **Verify:** switch device language to English and Albanian; walk every screen and every error path (bad login, room full, invalid combination) with no Italian leaking through.

### W7.7 — Onboarding and in-game rules access
- **Files:** new `app/onboarding.tsx`, `components/GameShared.tsx` top bar, `context/SettingsContext.tsx`.
- **Change:** a 3-4 slide first-run carousel gated on an AsyncStorage flag (goal, card strength, combinations, exchange), reusing the 18 Q&A pairs already written at `app/rules.tsx:26-117`. Add a `help-circle-outline` control to the game top bar opening the rules as a modal — today `/rules` is reachable from exactly one place (`app/index.tsx:258`) and neither game screen links to it. Both additive; neither touches game logic.
- **Depends on:** W2.11 (the rules content must be correct before it is put in front of a first-time player), W4.5, W7.6.
- **Verify:** fresh install → carousel appears once and never again. From mid-game, open the rules and return without losing turn state or the socket connection.

---

## Parallelism and conflict map

**Five lanes can run concurrently. Within a lane, tasks are strictly ordered.**

| Lane | Owner scope | Tasks | Exclusive files |
|---|---|---|---|
| **A — Server** | one agent | P1, W1.1–W1.6, W1.9, W2.10, W3.1–W3.9 | `server/socket.ts`, `server/index.ts`, `server/session.ts` |
| **B — Engine** | one agent | W2.1–W2.9, W2.12, W5.1, W5.2 | `lib/gameEngine.ts`, `lib/scoring.ts`, `lib/__tests__/` |
| **C — Game screens** | one agent | W4.1, W4.4, W4.5, W4.6, W4.7, W7.1, W7.3 | `app/game.tsx`, `app/(online)/game.tsx`, `components/GameShared.tsx`, `components/CardView.tsx` |
| **D — Data layer** | one agent | P2, W1.7, W1.8, W6.1 | `shared/schema.ts`, `server/storage.ts`, `server/routes.ts` |
| **E — Build & store** | one agent | W4.8, W4.9, W6.3–W6.6 | `package.json`, `app.json`, `eas.json`, `lib/sounds.ts` |
| **F — Standalone polish** | one agent | W4.2, W4.3, W7.2, W7.5 | `app/(online)/{index,friends,room}.tsx`, `app/auth.tsx`, `app/lobby.tsx`, `components/ErrorFallback.tsx`, `lib/theme.ts` |

**Cross-lane blocking edges (the only synchronisation points):**
- **D → A, B, everyone.** P2's migration must merge before Lane A starts W3.3/W3.4 or Lane D starts W6.1.
- **B → A.** W2.7's `shuffleDeck(deck, rng)` signature must land before A does W1.9. W2.5's pass threshold must land before A does W3.1.
- **B → C.** W2.8 (full-deck deal) changes hand sizes; C must have W4.4's shared `<HandBar>` in place first, and then re-verify hand geometry for 14/18/27 cards.
- **A → E.** W1.4 (fallback removal) must ship before E cuts the first EAS binary in W6.4, or that binary can never authenticate after the server-side removal.
- **C → F.** W4.3 (suit colours) touches `CardView.tsx`, which Lane C owns for W4.6. Give W4.3 to F **only if it lands before C starts W4.6**; otherwise fold it into C.
- **C → W4.10.** Design-token adoption touches all 11 screens and must be the **last** merge of the client work, after both C and F are done.

**Hard conflicts — never assign to two agents:**
1. `app/game.tsx` / `app/(online)/game.tsx` / `components/GameShared.tsx`. They share ~490 identical in-order lines (52% of the offline file). The whole point of W4.4/W4.5 is that this coupling stops being a hazard; until that lands, treat all three as one unit with one owner. Any layout constant (`CARD_W`, `CARD_H`, `SIDE_BTN_W`, `TABLE_M`) changed in one must change in the other — this is an explicit `MUST NOT CHANGE` rule in CLAUDE.md, and it is exactly what a parallel edit will break silently.
2. `server/socket.ts`. W1, W2.10 and W3 all rewrite overlapping handler bodies. One owner.
3. `lib/gameEngine.ts`. Eight W2 tasks plus a W3 helper. One owner.
4. `shared/schema.ts`. One migration, one owner, up front.

---

## The single most dangerous change

**W2.8 — dealing the entire 54-card deck.**

Not because it is hard, but because it is the only change on this plan that **produces no error signal when it goes wrong**. Every other high-risk item announces itself: a broken auth cutover throws 401s within seconds, a broken seat map throws a wrong hand you can see, a broken enumerator fails a property test. A wrong deal just plays.

Its blast radius, all of which is currently invisible from `lib/gameEngine.ts`:
- **Hand sizes change from a constant 13 to 13/14/18/27.** `components/GameShared.tsx` sizes the hand row around `CARD_W = 58` and `HAND_SECTION_H = CARD_H + 16`. A 27-card two-player hand is more than double what the layout was designed for, and nothing in the code asserts a bound.
- **`findStartingPlayer` changes meaning.** Deleting the lowest-spade scan is only safe *because* the whole deck is dealt. If any code path still deals partially (or a persisted row does), the 3♠ lookup fails and there is no fallback left.
- **The exchange phase operates on a bigger hand** (14 cards for the winner after receiving), so `EXCHANGE_VALID_RANKS` coverage and the `getValidGivebackCards` empty case change probability.
- **Every persisted `active_games` row becomes invalid.** A row written pre-change holds 13-card hands; rehydrating it into a 14-card world is a corrupt table that will not crash — it will deal a game with two cards missing.
- **It invalidates every characterization test and every AI difficulty tuning** simultaneously, so a regression introduced here has no clean "before" to diff against.
- **`cardIds` payload bounds** (W1.2) must be 27, not 14, or the validator silently rejects legal plays.

**De-risking, in order:**
1. **Land it last in Lane B**, after W2.3/W2.4/W2.5/W2.7 are green. Those fixes are independently valuable and independently verifiable; bundling them with the deal makes a bisect impossible.
2. **Ship it behind a runtime flag** — `DEAL_MODE = 'full' | 'legacy13'`, defaulting to `legacy13`, read once in `dealCards`. Run the entire test suite twice, once per mode, in CI. This makes the change revertible by config on Replit without a redeploy.
3. **Version the persisted state.** Add `schemaVersion` to `gameState`; on rehydration, mismatch → `game:rejoin_failed` + delete the row. Never restore a legacy-deal game into a full-deal server.
4. **Add the invariant property test before the change, not after** — union-of-hands === deck, 3♠ present, both Jokers present. Under `legacy13` it fails by design (~7.3% no Joker, ~3.7% no 3♠); under `full` it must be 100%. That divergence is the proof the change did what it claims.
5. **Screenshot-gate the layout.** 14, 18 and 27 card hands on a 375pt landscape viewport, both game screens, before flipping the default.
6. **Stage the flag flip:** offline-only first (no persistence, no other players), soak for a day, then online.

**Runner-up: W1.4** (removing the handshake fallback). Lower ranked only because its failure mode is loud and total — every production login breaks at once, which you find out in under a minute. Its de-risking is entirely in the ordering already specified: W1.1 verified by an actual `Set-Cookie` in a production `curl`, then W1.3 shipped to every client including native binaries, *then* W1.4 — with a dual-accept window where session, ticket and raw-id all work, and server-side logging of which branch each handshake used. Only remove the raw-id branch once that log shows zero hits for 48 hours.

---

## Rules research vs `lib/gameEngine.ts` — required engine changes

Precise, in dependency order. Items marked **NO CHANGE** are recorded so nobody "fixes" them.

| # | Location | Required change |
|---|---|---|
| **R1** | `:395-402` `enumStraights` | Replace contiguous windows over the value-sorted hand with per-distinct-face-value runs; emit every sub-run of length 5..runLength; one representative card per value, plus a per-suit pass for royal straights; run the whole thing under both the ace-low and ace-high value maps; dedupe by sorted card-id key. *(W2.3)* |
| **R2** | `:397` | Delete `hi - lo <= 8`. Legal straight length is 5..13. *(W2.4)* |
| **R3** | `:583-589` `processPass` | `responders = activeCount - (players[lastPlayedBy].hand.length > 0 ? 1 : 0)`; end the round on `passCount >= responders`; when the last player to play has finished, set `roundWinner` to the next active player, not to the finished seat. *(W2.5)* |
| **R4** | `:579-606` `processPass` | Reject a pass when `lastPlayedCombination === null` — the leader must play. Currently enforced only in UI, so the authoritative server does not uphold it. *(W2.6)* |
| **R5** | `:749`, `:652` `processExchangeChoice` | When `getValidGivebackCards` is empty, fall back to the winner's lowest-strength card and resolve the phase. Change the rejection contract so callers can distinguish rejection from success (it currently returns the identical object). *(W2.7)* |
| **R6** | `:191-198` `shuffleDeck` | Accept an injected RNG, defaulting to `Math.random`; the server passes `crypto.randomInt`. *(W2.7 + W1.9)* |
| **R7** | `:200-210` `dealCards` | Deal the entire 54-card deck: 4p = 14/14/13/13, 3p = 18/18/18, 2p = 27/27. Delete `excluded` and all consumers. *(W2.8)* |
| **R8** | `:221-241` `findStartingPlayer` | Delete `SPADE_RANK_ORDER` and the `players[0].hand[0]` fallback. Look up the literal 3♠ and throw if absent (unreachable once R7 lands). Fix `server/socket.ts:606`'s hardcoded `♠` in the error message. *(W2.8)* |
| **R9** | new `lib/scoring.ts` | Add scoring entirely — 3/2/1/0 per hand (4p), generalised `N-1 … 0`; match target 21 with escalation 31 → 41 → 51 and a draw beyond. The engine has none today. *(W2.9)* |
| **R10** | `:109-122`, `:280-288` | Delete the `jokerCount` parameter (only ever 0) and the unreachable joker-filtering branches in `getCombinationStrength` for pair/triple. Wild jokers are explicitly forbidden by the researched rules. *(W2.12)* |
| **R11** | `:337` | Stale comment claiming 2-player hands are 26 cards. Correct it as part of R7. |
| — | `:166-173`, `:312-327` royal straight | **NO CHANGE.** Brief §3.1 keeps it as core, beating bombs, same-card-count comparison — matching current behaviour. Tier-1 sources have no flush; document it as HOUSE in `docs/RULES.md`. |
| — | `:103` `2` low in straights | **NO CHANGE.** `A-2-3-4-5` and `2-3-4-5-6` are canonical; the 2 is low *only* inside a sequence. |
| — | `cardStrength` suit handling | **NO CHANGE.** No source assigns a suit order. The engine is correct; **`CLAUDE.md` is wrong** and its "suit also matters for tiebreaks" line must be deleted. |
| — | consecutive-pass counting | **NO CHANGE.** Passing does not lock a player out; state it explicitly on the rules screen. |
| — | `:546-563` teams win | **NO CHANGE.** Play the hand out and sum both partners' placements. `app/rules.tsx:70` is what changes. |

**Rules screen corrections (documentation only, no engine impact):** `app/rules.tsx` lines 35 (fake lowest-spade fallback), 45 & 227 ("Bomba … batte tutto", contradicted by `:85` in the same file and by `gameEngine.ts:323`), 50 & 226 ("highest straight is 10-J-Q-K-A" — true only for 5-card straights), 63-65 (scoring with no match target), 70 (teams win condition), 88-90 (royal straight comparison implies no length requirement), 98-100 (deal figures are false, and the 3p figure of 17×3 = 51 of 54 is internally impossible).

---

## Rule ambiguities requiring a human decision

The brief's §3.1 closed nine questions. These are open and **must not be guessed**:

1. **Who gets the extra card in a 4-player deal?** 54/4 leaves two players with 14 and two with 13. Canonically the deal starts at the dealer's left, but this app has no dealer. Options: (a) rotate the extra cards each hand; (b) give the extras to the previous hand's bottom two finishers (a rubber-band mechanic); (c) give them to the top two. This is a **balance decision**, not a rules question — no source addresses it, and it recurs every single hand.
2. **Is 27 cards each an acceptable 2-player game?** The canon covers only the 4-handed game. Full-deck 2p means a 27-card hand on a phone in landscape. Either accept it and rebuild the hand row, or keep a reduced 2p deal as an openly-documented house variant with the 3♠ dealt deterministically. This decision gates W2.8's UI work.
3. **Scoring for 2 and 3 players, and does the 21-point match target apply?** All sources give 3/2/1/0 and first-to-21 for 4 players only. `N-1 … 0` is a natural generalisation but is an app convention. For 2 players it may be cleaner to use plain win/loss with a first-to-N-hands match.
4. **Teams match target.** The one source covering team play implies a *combined* 21. With two partners each scoring 0-3 per hand, a pair can bank up to 5 per hand, so a combined 21 is roughly 5 hands. Confirm the target or set a separate teams target.
5. **Vacated seat: bot takeover or forfeit?** Brief §4 W3 explicitly leaves this open ("either bot takeover or forfeit — never a hang"). W3.1 currently plans **forfeit** (retire the hand, rank the player last). Bot takeover preserves the game for the remaining players but means a player can be scored on moves they did not make — unacceptable if the ranked ladder (§5 Tier 2) is ever built. **Decide before W3.1 is implemented**, because it changes the helper's contract.
6. **Exchange fallback when the winner holds no rank 3-10.** W2.7 implements "give the lowest card in hand". No source addresses it (probability ≈ 1 in 2.2M rematches). Confirm, or choose "skip the giveback entirely".
7. **Does the 3♠ opening apply to every fresh deal or only the first hand of a session?** Research says first hand only — subsequent hands are opened by the previous loser after the exchange. The engine's `initializeRematch` already matches this. But a *new match* after a completed series: re-apply 3♠, or continue the previous ordering? Affects W2.9's match-target design.
8. **Should the royal straight be a settings toggle?** Brief §3.1 decided to keep it as core. The research recommends presenting it honestly as non-traditional on the rules screen. Confirm the copy: silently presenting a house rule as canonical Murlan to an Albanian/Italian player base is the kind of thing that gets called out in reviews.
9. **What happens to a match series when a player leaves mid-series?** Cumulative scores are per-room. Does the series void, continue with a replacement, or freeze? Currently undefined, and W2.9 + W3.6 both need an answer.