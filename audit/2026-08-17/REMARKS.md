# REMARKS — observations from the remediation run

Notes that are **not** deferrals. Anything a batch failed to finish belongs in
`PROGRESS.md` § Carried forward, which is the binding queue; this file is not read by the
merge gate and nothing here blocks anything. It exists so that observations made while
implementing — things the audit missed, judgement calls, and defects too narrow to have
been filed — survive the session that found them.

Newest batch last. Each entry names the batch that raised it.

---

## Batch 4 — Reconnect and error surfacing

### The one deliberate departure from a finding's written fix

**RES-12** says, literally: *"Delete the manual loop; if the library's curve is wrong, change
its options rather than adding a competing timer."* Implemented instead as a guard on
`socket.active`, because the literal fix regresses a real behaviour.

Verified in `node_modules/socket.io-client/build/cjs/socket.js`: a middleware-rejected
handshake arrives as a `CONNECT_ERROR` packet, `onpacket` calls `this.destroy()` (`:523`),
which clears `subs`, so `get active()` (`:180`) returns false and **socket.io does not
retry**. The comment `context/SocketContext.tsx` carried was therefore accurate, and
deleting the manual loop would have left an expired or reused ticket permanently
disconnected. A transport-level failure leaves `subs` intact and socket.io's own backoff
already owns the retry — that, and only that, is the racing loop RES-12 describes.

`onConnectError` now retries only while `socket.active` is false. One loop owns each
failure mode, which is RES-12's intent; the audit entry's proposed mechanism was wrong
about the library.

### A defect this batch introduced and did not close

**A cold-start `game:rejoin` whose roster read fails now delivers `game:state` with no
`room`.** RES-03(a) gives `emitRoomStateTo` its own `.catch(logger.warn)` so a failed
`getRoomPlayers` cannot fail a rejoin that holds a valid seat — which is the fix RES-03
asks for. On a *reconnect* the client still holds the `room` it had, so nothing is lost.
On a **cold start** it holds nothing, and the client's navigation chain needs `room`, so
the player lands on the game screen's null state. `room:rejoin` (NET-03) does not cover
it: the client would have to notice "game state but no room" and re-ask, which is new
client logic on a different path.

Filed as a **Carried forward** row owed by Batch 13, which owns the `server/socket.ts`
seams.

### Narrow gaps left open on purpose

- **NET-04's "additionally" clause is not implemented** — returning early from `game:rejoin`
  when the caller's socket is already in `userSocketMap` *and* `socketRoomMap` for this room.
  The re-arm guard fixes the abuse on its own, and an early return would stop a legitimate
  repeat rejoin from re-delivering `room:state`/`game:state`, which is what the client's
  navigation chain gates on. It is a cheap-repeat optimisation, not part of the binding
  criteria.
- **The `attemptRejoin` dead-spot fix has no test.** A room held as `in_progress` with no
  game state matches no emit branch; the retry now treats "emitted nothing" as terminal
  rather than hanging. Not reachable through the provider's public surface — every event
  that could produce that state cancels the retry timer first — so the fix is defensive and
  a test would have to force private refs.
- **A stale `@murlan_waiting_room` can navigate a player into a lobby they did not ask for.**
  Force-quit from a waiting room, reopen the app later, touch the online index: `room:rejoin`
  fires off the persisted code and, if the room is still `waiting`, `room:state` arrives and
  the index pushes into it. Self-healing in every failure direction (a `finished`, started or
  full room answers `room:error`, which clears the key), so it is confined to the room
  genuinely still waiting. NET-03 asked for the id to be persisted; bounding it by age is a
  product call nobody has made.

### Things the audit did not file, found while working

- **`room:start` never re-broadcasts `room:state`,** so every client's `room.status` stays
  `"waiting"` for the whole game. Harmless — the code works around it — but it means
  `room.status` is not a usable signal for "is this table playing", and the next reader will
  assume it is.
- **A sub-millisecond race in `handleSeatRelease`.** The disconnect handler bails when
  `userSocketMap.has(userId)`, but a socket connecting *between* that check and
  `removeRoomPlayer` would have its freshly re-claimed row deleted. The window is a few
  microtasks and the client's `room:rejoin` is at least one RTT after `connect`, so it is not
  reachable in practice. A generation guard is the fix if it ever is.
- **`disposeGame(roomId, deleteRow = true)` has no caller that passes `false`** — a dead
  parameter.
- **Two `fetch` implementations in the client.** `lib/query-client.ts` imports `fetch` from
  `expo/fetch`; `lib/socket.ts` and now `context/AuthContext.tsx` use the global. RES-07's
  entry directed mirroring `lib/socket.ts`, so that is what landed. Which one is canonical is
  undecided.
- **`onGameState` calls `persistWaitingRoom(null)` unconditionally,** so every `game:state` —
  i.e. every move — issues an `AsyncStorage.removeItem`. It mirrors the existing
  `persistActiveRoom` write on the same path, so it is consistent rather than wrong, but it
  doubles the per-move storage churn.
- **`node --test` and `tsx --test` disagree on `tests/integration/reconnect.test.ts`.** Under
  `npx tsx --test`, the rehydration case fails on `__testables.hasActiveGame` — the test and
  the server get different module instances. Under the project's own runner (`node --test`,
  what `npm test` uses) it passes. Not introduced by this batch; worth knowing before anyone
  debugs a suite with tsx.
- **`components/ErrorFallback.tsx` reads `error.message` unguarded** in `formatErrorDetails`,
  where the reporting effect guards it (`String(error.message ?? "unknown")`). Only reachable
  under `__DEV__`, so harmless, but asymmetric.

### A self-defeating safeguard the audit missed — the E2E gate can pass without building

`tests/e2e/playwright.config.ts:39` sets `reuseExistingServer: !process.env.CI`. Locally that
silently adopts **whatever server already holds port 5199**, however old, serving whatever
`dist/` bundle happens to be on disk — and with none of the `webServer.env` block applied, so
`MURLAN_DISCONNECT_GRACE_MS: "30000"` is dropped too and the grace falls back to a value
shorter than socket.io's own reconnect backoff.

Found the hard way while verifying Batch 4: `reconnect.spec.ts` timed out at 240s against a
server started 21 hours before the batch's first commit, serving a bundle built 16 hours
before it. The spec never reached any reconnect code — it died on the registration form with
*"database murlan_dev does not exist"*. Against a correctly booted stack the same spec passes
**3/3, deterministically, in ~4s** on the batch branch, with the server log showing the real
path exercised (`Socket disconnected` → `Player reconnected within grace period` →
`Player rejoined game (from memory)`).

This is `CLAUDE.md`'s own rule: the gate that is supposed to prove the reconnect path works
can pass **or fail** on a binary nobody built. `retries` is 0 (`:19`), so there is not even a
flake signal. The fix is `reuseExistingServer: false` unconditionally, leaving
`E2E_SKIP_BUILD=1` as the explicit opt-in fast path for local iteration. **Batch 12** owns
test and build hardening (TEST-05, TEST-06 harden `scripts/build.js`); this belongs with them
and has a Carried-forward row.

Related harness friction, not a repo defect: `.claude/commands/batch.md` starts container
`murlan-pg` with database `murlan_test` on port 55432, while `scripts/dev-stack.mjs` — which
`scripts/e2e-server.mjs` invokes — requires `murlan-dev-pg` with `murlan_dev` on the *same*
port, so whichever exists first owns it and the other cannot boot. `scripts/e2e-server.mjs`
also overwrites `process.env.DATABASE_URL` unconditionally, so the `DATABASE_URL` the batch
instructions tell you to export is ignored by the E2E path. Worked around on this machine by
creating a `murlan_dev` database inside the `murlan-pg` container, which lets both suites
share one container.

### Strengthening a row already in the binding queue

`tests/integration/reconnect.test.ts` now sits at **exactly 20** `/api/auth/register` calls —
the per-process `authLimiter` ceiling. Its last two cases share one lobby specifically to stay
under it. The next client added to that file returns `429 AUTH_RATE_LIMITED` with nothing
explaining why. This is the same wall the *Batch 3 · RULE-01* Carried-forward row describes,
now hit by a second suite; Batch 12 owns it.

---

## Batch 5 — Robustness and session safety

### The audit's largest miss, found while implementing RES-09

**`Alert.alert` is a no-op on the web bundle Replit actually serves.** `react-native-web`'s
`Alert` is literally `static alert() {}`. Every `Alert.alert` call in `app/` therefore shows
the player nothing on web.

RES-09 hit it because its acceptance criterion — "the lobby is still shown with *a visible
error*" — was unsatisfiable while the lobby surfaced errors through `Alert.alert`. That one
site is fixed (an inline dismissible banner). **The rest are not**, and two of them matter:
the quit confirmation and the "Partita interrotta" dialog in `app/(online)/game.tsx`. A
confirmation dialog that never appears means the destructive branch never runs — on web, the
quit button simply does nothing.

No finding in the audit covers this. Filed as a **Carried forward** row owed by Batch 11.

### A binding acceptance criterion that no CI job can ever satisfy

Several findings across the audit name a `tests/e2e/*.spec.ts` case as their acceptance
criterion. **`.github/workflows/ci.yml` runs no Playwright step at all** — typecheck, test,
native, lint, build, boot-check, and nothing else. So those criteria are verified only by
whoever happens to run the suite locally, on a harness that (see the Batch 4 entry above)
reuses whatever server already holds its port.

SEC-05's reconnect-safety half was in exactly that position and is now closed by an
integration case instead. The general problem is not, and it is a gate-level defect rather
than a per-finding one. Folded into the Batch 12 Carried-forward row that already owns
`reuseExistingServer`.

### Deliberate behaviour changes worth knowing about

- **The integration harness no longer swallows unhandled rejections.** RES-04 moved
  `installProcessGuards()` out of `createApp()` — which `tests/helpers/testServer.ts` boots
  in-process — and into `server/index.ts`, which owns the process. Since Node 15 an unhandled
  rejection with no handler throws, so a stray one inside server code that an integration
  suite reaches now fails that suite's process instead of being logged. That is the better
  outcome, and the full run is green at 793/0, but it is a change nothing pins.
- **A deleted account still produces one ERROR log per hand it abandoned.** SEC-03 takes the
  per-seat-transaction option rather than pre-filtering: the abandoned seat stays in
  `gameResults`, its own transaction fails the foreign key, and it is logged and contained
  while every other seat is written. A pre-filter on top would be a second mechanism for the
  same property. If the log noise is unwanted, add it then.
- **NET-06 uses `disconnect(true)` on the evicted socket.** A client build that predates
  `SESSION_REPLACED` does not know to stop reconnecting, so two stale tabs would evict each
  other indefinitely. `disconnect(false)` would make it terminal on socket.io's own terms as
  defence in depth, at the cost of leaving the engine.io connection for the client to close.
  Kept consistent with `evictUser`; worth a second opinion.

### Narrow gaps left open on purpose

- **`evictReplacedSession` hands over `socketRoomMap` but not `spectatorRoomMap`.** Evicting a
  *spectating* socket drops the account out of `game.spectators` even though the account is
  still connected. Benign today — no seat is held and the replacement is not watching either —
  but it is the same asymmetry the seat handover fixes, and it will read as a bug the moment
  spectating gains any per-account state.
- **`tests/integration/sessionReplaced.test.ts` cannot distinguish the two orderings** of the
  `userSocketMap` repoint versus the eviction. The disconnect handler awaits
  `storage.updateLastSeen` between its two guards, so the connection handler's `set` always
  wins the race either way. D5's ordering is correct by construction, not because the suite
  proves it — do not read a green run as evidence there.
- **The RES-09 error banner still costs ~36px** in a `MenuLayout scrollable={false}`. Capped
  at two lines so it cannot grow further, but on a short landscape phone the base height can
  still push the lower card off screen. Fixing it properly means touching `MenuLayout`, which
  is Batch 11's territory.

### Things the audit did not file, found while working

- **`useCallback` dependency arrays in `context/OnlineGameContext.tsx` are unreliable, and lint
  does not catch it.** NET-05 only became verifiable after adding `isSpectator` to
  `leaveRoom`'s deps — without it the callback closed over the initial `false` and the fix
  would have been a check that cannot fail. Roughly a dozen sibling `useCallback`s list
  `[userId]` while closing over `socket`; those happen to be safe because `getSocket(userId)`
  is stable. `react-hooks/exhaustive-deps` did not fire on the real miss under `expo lint`.
  The whole file wants one pass with that rule set to error — which is adjacent to Batch 7's
  PERF-03, whose whole subject is the `eslint-disable react-hooks` suppressions.
- **`disconnectTimers` is keyed by userId, not by `(userId, room)`.** An account seated in one
  room and dropping from another would have one timer overwrite the other. Not reachable today
  because a socket holds at most one `socketRoomMap` entry, but that invariant is implicit and
  stated nowhere.
- **`logger.flush()` is only synchronous in production.** `server/socketSafety.ts`'s fatal
  path flushes before exiting; in dev the `pino-pretty` transport is a worker and the flush is
  asynchronous, so the fatal line can be lost. Harmless — the exit is unconditional either way
  — and the comment is scoped to the production case, but it is not universally true.
- **A second instance of the `node --test` / `tsx --test` discrepancy.** `tests/bootFailure.test.ts`
  fails under `npx tsx --test` and passes under `node --test`, which is what `npm test` uses.
  The Batch 4 entry records the same for `tests/integration/reconnect.test.ts`. Both files
  document that they must own their process; `tsx` evidently does not give them one.
