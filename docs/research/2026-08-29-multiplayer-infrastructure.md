# Why multiplayer join is unreliable: one cause, five symptoms

Research date: 2026-08-29. Written for #544. Citation standard follows
`docs/research/2026-08-26-game-home-screens.md`: every external claim carries a URL that was
actually fetched, quotes verbatim, verdicts stated plainly including where the evidence
contradicts the ticket's own hypothesis.

**This document changes no production code.** Its output is the plan in §7 and the fix
tickets that plan names.

---

## 1. The bottleneck, in one paragraph

**The game is written as if one Node process serves every player, and it is deployed onto a
platform that runs as many as it likes.** Every fact about who is in which room — which
socket belongs to which player, which sockets are in which room, which game is live — lives
in ordinary JavaScript `Map`s inside one process. `.replit` deploys to Cloud Run with no cap
on how many instances run. The moment there are two, players who are in the same room *in the
database* are invisible to each other, because the thing that delivers "someone joined" only
knows about the sockets attached to the instance it happens to be running on. This is not a
race, a timing bug, or four unrelated defects. It is one hole, and everything the owner
reported falls through it.

---

## 2. It reproduces

`scripts/repro-544.mjs`, committed alongside this document. Two server processes against one
database, one room, one join:

```
two instances up on 5551 and 5552, sharing one database

A created room QSMTA5 on instance 1

B joined:                       yes
B sees 2 player(s) in the room
A was told B arrived:           NO  <- the defect
```

B's seat is claimed, the row is written, B's own screen is correct. A is never told. The
broadcast — `io.to(roomId).emit("room:state", …)` — reached only instance 2's sockets.

Run it yourself: `DATABASE_URL=… node scripts/repro-544.mjs`. It exits 1 when the split
occurs and 0 when it does not, so it is also the check the fix has to turn green.

---

## 3. Why two processes is the deployed shape, not a hypothetical

`.replit`:

```
[deployment]
deploymentTarget = "cloudrun"
```

There is **no `maxInstances`, no `minInstances`, no autoscale setting anywhere in the repo**.
Cloud Run's default behaviour is to add instances under load and to run two revisions
concurrently during a deploy.

Google's own Cloud Run guidance for exactly this case
(<https://docs.cloud.google.com/run/docs/triggering/websockets>, read 2026-08-29) says
external state is required rather than optional:

> "Google recommends that you use external message queue systems such as Redis Pub/Sub
> (Memorystore) or Firestore real-time updates that can deliver updates to all instances over
> connections initiated by the container instance. If you are using the Socket.IO library for
> WebSockets, you can use its redis adapter."

And a second, separate hazard on the same platform: this app allows HTTP long-polling on both
ends — `transports: ["websocket", "polling"]` in **both** `lib/socket.ts:56` and
`server/socket.ts:208`. Socket.IO's handshake begins on polling before upgrading. Without
session affinity, the several HTTP requests of one handshake can land on different instances,
and the instance that receives the second request has never heard of the session:

> "For a multiple instances architecture without session affinity, Socket.io must only use
> the Websocket transport… if Socket.io falls back to long polling, it will send multiple
> HTTP requests, and requests might be routed to another instance that will generate an error
> due to the session ID being unknown to the server."

**Verdict: the app is not single-process, and nothing in the repository makes it so.** The
ticket's acceptance criterion asked this to be stated as fact rather than assumption. It is a
fact, and it is the wrong one.

---

## 4. What Socket.IO actually promises

Read before proposing anything, because two of these are commonly assumed and neither holds.

### 4.1 The default adapter is per-process, full stop

Socket.IO's adapter documentation (<https://socket.io/docs/v4/adapter/>, read 2026-08-29):

> "When scaling to multiple Socket.IO servers, you will need to replace the default in-memory
> adapter by another implementation, so the events are properly routed to all clients."

`grep` finds no `createAdapter`, no Redis, no Postgres adapter and no cluster adapter anywhere
in `server/`. So every `io.to(...)` in this codebase is scoped to one process. §2 is that
sentence, demonstrated.

### 4.2 Delivery is at-most-once, by default and today

Socket.IO's delivery guarantees page (<https://socket.io/docs/v4/delivery-guarantees/>, read
2026-08-29). Ordering is guaranteed:

> "Socket.IO does guarantee message ordering, no matter which low-level transport is used."

Delivery is not:

> "there is no guarantee that the other side has received it and there will be no retry upon
> reconnection… any event that was missed by a disconnected client will not be transmitted."

Getting more requires the application to ask for it. Client-to-server is a flag:

> "The client will try to send the event (up to `retries + 1` times), until it gets an
> acknowledgement from the server."

Server-to-client is work the application has to do — assign each event an id, persist it,
have the client remember the last offset it saw, and resend from that offset on reconnect
(<https://socket.io/docs/v4/tutorial/step-8>, read 2026-08-29):

> "the UNIQUE constraint on the `client_offset` column prevents the duplication of the
> message."

**This repo uses none of it.** No `retries`, no acknowledgement callbacks, no offset. Every
state broadcast the server sends during a network blip is simply gone. That is the owner's
"having a way to guarantee that his messages are sent and received", named precisely: **the
app currently has at-most-once delivery and needs at-least-once with de-duplication.**

### 4.3 Connection state recovery is not the answer here, and it is worth knowing why

Socket.IO's connection-state-recovery page
(<https://socket.io/docs/v4/connection-state-recovery>, read 2026-08-29) restores

> "the `id`, the rooms and the `data` attribute of the socket"

plus events missed during the gap. It is disabled by default and this app does not enable it.
It is genuinely useful for the blip case in §5.4. But it is not a substitute for an adapter,
and the docs are explicit about two limits: recovery

> "will not always be successful"

and it covers unexpected disconnection only, not a deliberate `socket.disconnect()`.

**Verdict: enable it, but do not let it stand in for the structural fix.** It shortens the
window; it does not close the hole.

---

## 5. The five symptoms, each traced

| # | Symptom | Status | Cause |
|---|---|---|---|
| 1 | Friend request never arrives, **both online** | **Reproduced by inspection** (§5.1) | `emitToUser` reads a per-process map |
| 2 | Joining by code is unreliable | **Reproduced** (§2) | broadcast is per-process |
| 3 | Quickmatch opens a fresh room instead of joining | **Root-caused and already fixed** (§5.3) | in-memory `publicRoomIds` |
| 4 | Membership diverges between clients | **Reproduced** (§2) | broadcast is per-process |
| 5 | Host starts, one player stuck, seat empty | **Not reproduced directly** (§5.5) | same mechanism, plus §5.4 |

### 5.1 The friend request, both players online

```ts
export function emitToUser(userId: string, event: string, data: unknown) {
  if (!_io) return;
  const socketId = userSocketMap.get(userId);
  if (socketId) {
    _io.to(socketId).emit(event, data);
  }
}
```
`server/socket.ts:120`. `userSocketMap` is a module-level `Map` (`server/gameRoom.ts:84`).

Adding a friend is an HTTP `POST /api/friends/add`, which Cloud Run routes to whichever
instance is free. `emitToUser` then runs *on that instance* and looks the recipient up in
*that instance's* map. If the recipient's socket is attached to any other instance, the `if`
is false and the function returns having done nothing. No error, no log, no queue.

**So "both online" is not the safe case — it is the case with no fallback.** #541 added a
re-read of the friends queries on socket connect, which rescues the offline sender because the
recipient connects later. Two players who are both already connected never hit that path.
That answers the owner's question directly: **#541 did not fix this, and could not have.**

`isUserOnline` (`server/socket.ts:128`) has the identical shape, so presence is also
per-instance: a friend connected to another instance reads as offline.

### 5.2 and 5.4 — the same broadcast hole

§2 is the demonstration. Every `io.to(roomId).emit(...)` in `server/socket.ts` — seats, room
state, game start, every play — carries it.

### 5.3 Quickmatch — found, and already shipped

`room:quickmatch` searched `publicRoomIds`, an in-memory `Set` that **only quickmatch itself
ever wrote to**; `room:create` never added to it, so a created room was invisible to
quickmatch by construction. Four friends pressing the online button found nothing, each
opened a room, and only the second arrival landed in company — the owner's "2 in, 2 alone",
exactly.

Fixed in #545 / PR #549: visibility became a persisted column and the register was deleted.
That removed one of the six process-local collections rather than patching it, which is the
shape §7 argues for throughout.

### 5.4 A lobby blip costs you your seat

`lobbyDropouts`' own doc comment (`server/gameRoom.ts`):

> "A lobby disconnect deletes the `room_players` row at once, so this is the only evidence the
> caller was ever seated"

So a two-second drop in a lobby unseats you, and the only route back is `room:rejoin`, which
reads `lobbyDropouts` — **also a per-process `Map`**. Reconnect to a different instance and
that map is empty, the seat row is gone, and the server answers `NOT_IN_ROOM`. Compare a live
*game*, which holds a seat open through `MURLAN_DISCONNECT_GRACE_MS`. The lobby has no grace
period at all.

### 5.5 Host starts, one player stuck

Not reproduced directly — it needs four clients and a start, and the mechanisms above are
sufficient to explain it without inventing a sixth. The shape is: the fourth player's
`room:state` never arrived (§2), so their screen still shows a lobby; or their seat row was
deleted by a blip (§5.4) and `room:start` dealt to the seats the database held, which was one
short. **Stated as the most likely explanation, not as a finding.** The fix tickets in §7
each carry a check, and whether this symptom survives them is the honest test.

---

## 6. Where the ticket's hypothesis was right, and where it was incomplete

The ticket proposed: *room truth is split across Postgres and six process-local collections,
with no single owner*. That is **correct and confirmed** — `activeGames`, `socketRoomMap`,
`spectatorRoomMap`, `userSocketMap`, `publicRoomIds` (now gone) and `lobbyDropouts`.

It was incomplete in one way that changes the priority. The ticket framed multi-process as a
risk to check. It is not a risk — **it is the running configuration**, and it converts every
one of those collections from an optimisation into a correctness bug. The split of truth is
real, but it is the *shape* of the problem; the deployment target is the *reason it bites
today*.

One thing the ticket implied that the evidence does not support: that these are "newly
introduced" bugs. §5.1 and §5.4 are structural and long-standing. What is likely new is
traffic — more concurrent players means Cloud Run scaling past one instance more often, which
turns a latent hole into a daily one. **No evidence was found either way**, and no commit was
identified that introduced any of it.

---

## 7. The plan, ordered by value per unit of risk

Each step ships alone and carries the check that proves it. Ordered so the biggest reduction
in "the game is broken for real players" comes first, and so nothing later depends on
something risky landing earlier.

### Step 0 — Cap the deployment to one instance, today

Set Cloud Run `maxInstances = 1` (and `minInstances = 1` so it is warm). One config line, no
code, and it makes every symptom in §5 except 5.4 impossible while the rest of this plan is
built. It is a ceiling on concurrent players, not a fix, and it must be recorded as
deliberate — an uncapped autoscaler is the default, so anyone can undo it by not knowing.

**Check:** the repro script exits 0 against the deployed configuration.
**This is the highest-value change in the document and it is not code.**

### Step 1 — Websocket-only transport

`transports: ["websocket"]` on both ends. Removes the polling-handshake-across-instances
failure entirely, at the cost of the polling fallback for clients behind a proxy that blocks
websockets — measure how many that is before assuming it is nobody.

**Check:** an integration test asserting the client never opens a polling request.

### Step 2 — Make the lobby survive a blip

Give a lobby seat the same disconnect grace a live game has, instead of deleting the
`room_players` row immediately. This deletes `lobbyDropouts` — the seat row itself becomes the
evidence, which is the point.

**Check:** a test that drops a lobby socket, reconnects it after the grace, and asserts the
seat is still held and the host role has not moved.

### Step 3 — An adapter, so a broadcast crosses instances

`@socket.io/postgres-adapter` rather than Redis: the database is already provisioned, already
in the deploy, and already the source of truth for rooms. This is what lifts the cap from
step 0.

**Check:** `scripts/repro-544.mjs` exits 0 — the same script that exits 1 today.

### Step 4 — Delivery the client can prove it received

Per §4.2: `retries` on client-to-server emits, and for the state broadcasts that matter, a
sequence number the client remembers and the server can replay from. Plus
`connectionStateRecovery` for the short blip, which is cheap and shortens the window.

**Check:** a test that drops a socket mid-hand, reconnects, and asserts the client's state
matches the server's exactly — no gap, no duplicate.

### Step 5 — One owner for room membership

Only after the above. `server/socket.ts` is 1,669 lines and #219 already covers splitting it;
this step is the *seam*, not the file move — a single module that owns "who is in this room"
and answers from the database, with the socket layer reduced to transport. **#219 must be read
first, and whichever of the two lands second adopts the other's decomposition** rather than
inventing a rival one.

**Check:** no handler outside that module reads a membership map directly.

### Not in the plan, deliberately

- **Redis.** Step 3's adapter can use Postgres, which is already there. Adding a second
  datastore to fix a bug is a cost with no matching benefit here.
- **Sticky sessions.** They make polling survivable but leave every broadcast still
  per-instance, so they solve the smaller half of the problem and hide the larger one.
- **Rewriting the socket layer first.** It is the most satisfying step and the least urgent.
  A tidy 1,669 lines that still cannot broadcast across instances is worth nothing to a
  player.

---

## 8. What this document does not know

- **No production logs were read.** Whether Cloud Run has actually scaled past one instance
  during the owner's sessions is unverified. The repro proves what happens when it does; it
  does not prove how often it does. **Step 0 is worth doing regardless, because it costs one
  config line.**
- **Symptom 5 was not reproduced** (§5.5) and its explanation is inference.
- **No commit was identified** as introducing any of this; the "newly introduced" framing is
  unsupported either way (§6).
- **The polling risk is quoted from a third-party write-up** summarising Google's guidance
  rather than from a Google page stating it in those words. The recommendation to use an
  adapter *is* from Google's own documentation, quoted in §3.
