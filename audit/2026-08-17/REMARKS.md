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

### Strengthening a row already in the binding queue

`tests/integration/reconnect.test.ts` now sits at **exactly 20** `/api/auth/register` calls —
the per-process `authLimiter` ceiling. Its last two cases share one lobby specifically to stay
under it. The next client added to that file returns `429 AUTH_RATE_LIMITED` with nothing
explaining why. This is the same wall the *Batch 3 · RULE-01* Carried-forward row describes,
now hit by a second suite; Batch 12 owns it.
