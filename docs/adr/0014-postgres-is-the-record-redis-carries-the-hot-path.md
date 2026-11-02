# 0014. Postgres is the record, Redis carries the hot path, a move is an event

**Status:** Accepted; the Redis 7 engine superseded by 0015 (Valkey)
**Date:** 2026-11-01

## Context

On 2026-11-01 the owner asked for the backend to be judged against the bar of a top-tier
real-time multiplayer game and for what falls short to be fixed, every finding and none
deferred. The audit of `main` at `5f464ce` measured the real-time path on Postgres 16:

- **Every socket message went through Postgres.** `@socket.io/postgres-adapter`
  (`server/socket/socketAdapter.ts`) publishes a room emit as a `pg_notify` even when the only
  recipient is on the same process. One move cost 5.2 `pg_notify` transactions and 1.0
  full-envelope write, 10.8 commits per move in all.
- **`NOTIFY` is the first ceiling.** It flattens at about 3,400 a second for the whole database
  however many connections send it, because Postgres serialises `NOTIFY` commits on one global
  lock; plain `SELECT 1` on the same server scales past 100,000. At 5.2 per move that is about
  650 moves a second cluster-wide, and adding instances does not raise it.
- **A finished round was not durable.** The move that ends a round waited on three database calls
  before its ack, and the round's results (`server/game/roundOver.ts`) were written
  fire-and-forget, seat by seat, from memory: a crash after `round_over` lost stats, ratings and
  the replay with nothing to retry them, and could leave a replay with no history row.
- **Ownership had no fence.** A table's owner is whoever holds its advisory lock
  (`server/game/gameOwnership.ts`), with no epoch on the row, so an owner that lost its lock could
  still write over the new owner's envelope. The per-table write chain
  (`server/game/gamePersistence.ts`) was a plain promise tail that queued every snapshot.

ADR-0003 named the Postgres adapter and the advisory lock as load-bearing. Multi-instance remains
the deployed reality; the adapter is what this record replaces.

## Decision

The shape:

- **Postgres is the system of record**: accounts, sessions, rooms, live-table envelopes, round
  results. Ownership is the advisory lock plus an owner epoch on the table's row.
- **Redis 7 carries what is shared, ephemeral and hot**: the Socket.io cluster channel, one
  addressed inbox per instance, presence, instance liveness, HTTP rate-limit counters. A Redis
  outage degrades cross-instance traffic; it never stops a table that lives on one instance.
- **A move is an event applied in the owning process's memory.** The player is acked on apply;
  state goes local-first, then addressed to the instances that hold the other recipients; each
  write that follows goes where its cost of loss says.

Each decision, and why:

1. **A finished round lands once.** The final move's envelope write carries the final state and
   a `pendingResults` array (oldest first; a row with unapplied entries is never discarded), fenced
   by the epoch. One transaction then locks the seats' live users, computes rating deltas from the
   locked rows, writes stats, ratings, round history, replay, achievements and room status with
   multi-row statements, and clears that entry by a fenced update that rolls back on zero rows.
   `round_over` is emitted after the commit with the committed deltas; the move is acked on apply,
   before any database work. A transient error retries from the envelope with capped backoff; any
   other error is logged with its payload and counted. Either way the results stay pending, the
   table deals on meanwhile, and restore and the orphan sweep finish pending results before
   anything else. *Why:* the round is durable the moment it is final, and the cleared marker is
   the proof of application, so a retry after an unknown commit applies nothing twice.
2. **The live-table write chain coalesces snapshots and never reorders barriers.** At most one
   snapshot write is in flight and one queued; a newer snapshot replaces the queued one. Deletes,
   status writes and decision 1's final write are barriers, never replaced or overtaken. The
   chain is flushed before the advisory lock is released. *Why:* memory stays bounded under a
   stall, and a snapshot can never land after the delete it preceded.
3. **An owner epoch fences every table write.** `active_games` carries `owner_epoch`; every claim
   (creation, restore, takeover) increments it in the statement that reads the row and records
   `<instanceId>:<epoch>` as the table's owner in Redis. Every envelope write and decision 1's
   transaction is conditioned on the claimant's epoch; zero rows means the table was lost, and the
   instance disposes it without another write. *Why:* a lock alone cannot stop a former owner's
   in-flight write; the epoch makes it a no-op.
4. **The ownership heartbeat terminates the old backend before it reclaims.** On heartbeat
   failure the new ownership client calls `pg_terminate_backend` on its predecessor's pid, then
   reclaims, with a 3 s connect timeout. *Why:* otherwise the instance can lose a lock to its own
   half-dead session.
5. **Redis 7 replaces Postgres as the cluster channel.** Redis is part of the host contract
   (`deploy/runtime.json`), the dev stack and CI. One module opens every Redis connection, as
   `server/store/pool.ts` does for Postgres: `REDIS_URL` required at boot, TLS on `rediss://`, a
   client name per use, keep-alive with a periodic `PING`, capped reconnect, an error listener on
   every client. Room broadcasts use `@socket.io/redis-streams-adapter`, its stream length derived
   from the host contract's design peak so a two-minute gap loses nothing; addressed traffic goes
   to one stream per instance. Losing Redis at runtime is degraded mode: local delivery and local
   tables carry on, a cross-instance forward answers `TABLE_UNREACHABLE`. A half-open connection is
   detected and reconnected within 15 s. `@socket.io/postgres-adapter`, its patch and the
   `socket_io_attachments` table are removed. *Why:* it removes the `NOTIFY` ceiling, and an
   instance reads only the traffic it delivers.
6. **Delivery is addressed and local-first.** One module offers "send this to these users". A
   recipient on this instance gets it directly; the rest are grouped by the instance their
   presence names, one inbox message per instance; a user with no presence is offline and costs
   nothing. Per recipient and table, at most one state send is outstanding and one queued, the
   newer replacing the queued. A missed state ack on a remote instance returns to the owner as a
   nack, and the owner re-derives the state from its live game. The turn is armed before the state
   is published. *Why:* no cluster hop for a local recipient, no backlog to a slow socket, and a
   resend is never a stale payload.
7. **Game state is ordered by `(epoch, seq)`.** `seq` is a per-table counter kept in the
   envelope. The client applies a state only above the last pair it applied for that table (a
   newer epoch always wins) and resets on a room change. *Why:* a reordered or replayed state can
   no longer rewind a table, and a restore cannot freeze a client on a reset counter.
8. **Presence lives in Redis.** Each user has an entry naming its instance, socket and table;
   overwrite and delete are compare-and-set on the socket, so an evicted socket's late disconnect
   cannot erase its replacement. Instances keep a short-TTL liveness key, and a live instance
   clears a dead one's users and notifies their friends. Every presence question and both table
   sweeps read Redis, never `fetchSockets()`; account revocation is one cluster message. *Why:* a
   connect stops costing a sweep of the whole cluster, and a crashed instance's users go offline
   within seconds.
9. **Every wire change bumps `PROTOCOL_VERSION`** (`shared/protocol.ts`), and a handler only old
   bundles use is removed when `MIN_PROTOCOL_VERSION` passes the version that stopped sending it.
   *Why:* app-store builds stay installed long after a release, so "one release later" is not a
   removal date.
   Between instances the same holds for one rolling deploy: a table action and a stop-spectating
   call go to an instance's inbox only when its adapter heartbeat names it, and otherwise over the
   legacy `murlan:table` and `murlan:stop-spectating` emits, which every instance still answers.
   Both legacy emits and their listeners are removed once no deployed revision predates #1895.
10. **Every HTTP rate limit is shared in Redis.** On a store error a limiter falls back to its
    in-memory store and counts it, never failing open and never answering 500. Socket action limits
    stay per process. This supersedes the owner's 2026-10-16 decision (the #1650 design audit's D7)
    that login limits stay per instance, on his 2026-11-01 instruction that every finding is fixed.
    *Why:* a per-instance limit multiplies with the instance count and resets on every deploy.
11. **Shutdown hands each table to a peer before it closes sockets.** Per room: stop taking
    intents, flush the write chain, release the lock, send a peer a `resume` through its inbox
    (the peer claims, bumps the epoch and re-arms the timers), then forward the room's intents to
    it; a draining instance never answers a room it released as unowned. Only then does each socket
    get `server:draining` with a random reconnect delay, and `io.close()` runs last. *Why:* a
    released table never sits ownerless with its bot and AFK timers stopped, and the reconnect
    herd after a deploy is spread at its source.

Nothing here changes a game rule; those are `docs/GAME-RULES.md`'s alone.

## Consequences

- An agent who meets `@socket.io/postgres-adapter`, `LISTEN/NOTIFY` as a message channel, or
  ownership by advisory lock without an epoch is looking at the design this record retires, not
  one to preserve. ADR-0003's multi-instance premise still holds.
- Every doc that names the Postgres adapter as current, the `server/CLAUDE.md` bullet on the
  adapter's patch among them, is updated by the ticket that removes the adapter (#1885), not by
  this record.
- A new table write is fenced by the epoch and goes through the write chain; a new socket message
  goes through the addressed-delivery module; a new wire field bumps `PROTOCOL_VERSION`.
- Redis is a required dependency at boot. Its loss at runtime is survivable by design and must
  stay so.

Rejected, each judged worse than the alternative rather than postponed:

- **A round-results outbox table and worker**: decision 1 gets the same durability from the
  existing envelope, and idempotency from the cleared marker; a table and a worker add nothing.
- **A `namesOf` cache**: a primary-key read of a few ids takes under 1 ms, and the cache would need
  rename and delete invalidation across instances for nothing measurable.
- **A friend-id cache**: also under 1 ms, and a stale entry would show a removed friend your online
  status, a privacy defect.
- **Dropping the handshake `getUser` read**: it is the check that refuses a ticket minted before its
  account was deleted, one indexed read per connect.
- **A daily funnel rollup table**: its cost scales with the 30-day window, not the table, and on a
  separate admin pool with a statement timeout it cannot slow the game.
- **A slower client reconnect**: it would slow every network blip to fix a deploy herd that
  decision 11 spreads at its source.

The work is carried out by: Redis, the streams adapter and per-instance inboxes (#1885); Shared
HTTP rate limits (#1887); Owner epoch and the ownership heartbeat (#1890); The write chain, and
batched telemetry (#1891); A finished round lands once (#1892); Addressed, local-first, ordered
delivery (#1893); Presence in Redis (#1894); Routing to the owner (#1895); Shutdown hands every
table off (#1896).
