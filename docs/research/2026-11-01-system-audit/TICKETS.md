# System audit: decision sheet, ticket breakdown and coverage

The decisions every ticket of this audit builds on, settled here once so the tickets do not each
re-decide them. Sources: [REPORT.md](REPORT.md), the reproductions in `sim/results/repro-*.txt`,
and a fresh contrarian review of the first draft of this sheet (its objections and what each
changed are listed at the end). Pointers are at `main` `aa13d82`.

The bar is the best design for a top-tier real-time game on its merits. Every finding is fixed;
nothing is deferred. A queue or a new component appears only where it beats the direct answer.

## Shape

- **Postgres** is the system of record: accounts, sessions, rooms, live-table envelopes, round
  results. Table ownership is a Postgres advisory lock plus an **owner epoch** stored on the
  table's row; every table write is fenced by the epoch, so an owner that lost its lock cannot
  write over the new owner.
- **Redis 7** carries what is shared, ephemeral and hot: the Socket.io cluster channel (Redis
  Streams adapter), one addressed inbox per instance, presence, instance liveness, the HTTP
  rate-limit counters. It replaces Postgres `LISTEN/NOTIFY`, whose measured cap of about 3,400 a
  second for the whole database is the system's first ceiling. A Redis outage degrades the game
  (cross-instance traffic stops), it never stops a table that lives on one instance.
- **A move is an event** applied in the owning process's memory. The player is acked on apply;
  state goes local-first, then addressed to the instances that hold the other recipients; the
  writes that follow go where their cost of loss says.

| Write | Decision | Why this and not the alternative |
| --- | --- | --- |
| The final state of a round | **One envelope write carrying the final state and the round's pending results**, fenced by the epoch | The round is durable the moment it is final; nothing a player saw is ever rewound |
| A finished round's results: stats, ratings, `round_history`, replay, achievements, room status | **One transaction that applies the pending results and clears them from the envelope** in the same commit | Atomic and idempotent by construction: the cleared marker is the "already applied" proof, so a retry after an unknown commit applies nothing twice. No worker, no new table |
| The live-table envelope, each move | **Per-table write chain: snapshot writes coalesce latest-wins; deletes and status writes are barriers** | Bounds memory under a stall without ever letting a snapshot overtake a delete |
| `events` and client-error rows | **Bounded in-memory batch**, one `unnest` insert every 1 s or 200 rows | A reconnect herd must not put thousands of single inserts on the gameplay pool |
| Socket messages | **Local first; then one message to each instance that holds a recipient** | No cluster hop for local recipients, and no instance reads traffic it does not deliver |

## Decisions

### Table ownership and writes

- **D1 A finished round lands once.**
  - The final move's state is written to the envelope together with a `pendingResults` entry
    (`{ round, finishedAt, gameMode, results, outcome, seats, opening, moveLog }`, `round` =
    `finishedAt` in epoch ms since `roundsPlayed` restarts each match), in the existing
    `active_games` jsonb, as one fenced write ahead of everything else for that table.
    `pendingResults` is an array: the table deals on while a retry is pending, and entries apply
    oldest first. A row with unapplied entries is never discarded.
  - The results transaction (through D8's wrapper) locks the seats' users, keeps only the live
    ones (as `ratings.ts:163-168` already does, so an account deleted mid-round is skipped, not a
    foreign-key failure), computes rating deltas from the locked rows, writes stats, ratings,
    `round_history` and its prune, the replay, achievements and room status with multi-row
    statements, and clears `pendingResults` with
    `UPDATE active_games … WHERE room_id = $1 AND owner_epoch = $2 AND game_state->'pendingResults'->>'round' = $3`.
    Zero rows rolls back: the round was already applied (or the table changed owner).
  - `round_over` is emitted after the commit with the committed deltas. `previewRatedDeltas` is
    deleted; the season key comes from `finishedAt` alone.
  - The move's ack is sent on apply, before any database work (finding 5). Durability gates
    `round_over`, never the intent.
  - Errors: transient ones (connection, serialization, lock or statement timeout) retry from
    the envelope's payload at 0.5 s doubling to 5 s. Any other error is logged with the payload
    and counted. In both cases the table moves on to its next deal; the results stay pending in
    the envelope, and restore and the orphan sweep finish any pending results they find before
    anything else. The metric `round_results_pending_age_seconds` alerts at 60 s.
  - The repro's kill at +0 ms after `round_over` left a `round_replays` row with no
    `round_history` row (the hazard `roundOver.ts:219-221` warns of) and lost every stat; one
    transaction makes that state impossible.
  - Restore never skips a `roundOver` row with `pendingResults` (`tableLifecycle.ts:223`
    skips every `roundOver` row today). The sweep applies pending entries with no player online
    by claiming the table like any owner (lock, epoch bump), applying, and releasing.
- **D2 Live-table write chain.** `inRoomOrder` (`server/game/gamePersistence.ts`) keeps at most
  one snapshot write in flight and one queued; a newer snapshot replaces the queued one, and the
  replaced call's promise resolves when its replacement lands. Deletes (`discardGame`), status
  writes (`closeTable`) and D1's final write are barriers: never replaced, never overtaken. The
  chain is flushed before the advisory lock is released, on dispose and on shutdown. The
  envelope carries `moveLog`, so a restored round still gets its replay.
- **D3 Owner epoch.** `active_games.owner_epoch` (integer, not null). A claim (first creation,
  restore, takeover) sets it to `owner_epoch + 1` in the same statement that reads the row, and
  records the owner in Redis as `table-owner:<roomId>` = `<instanceId>:<epoch>`. Every envelope
  write and D1's transaction run `WHERE owner_epoch = $mine`; zero rows means this instance lost
  the table: it disposes it without a further write. Nothing new goes on the wire: the players'
  next intent routes to the new owner, whose state reaches them through D6.
- **D4 Ownership heartbeat.** On heartbeat failure the new ownership client terminates the old
  backend pid (`pg_terminate_backend`, the app role may signal its own backends) before it
  reclaims, so it never loses a lock to its own process; 3 s connect timeout (P4).

### Redis and the wire

- **D5 Redis.**
  - Redis 7 in `deploy/runtime.json` (`"redis": 7`), in `dev-stack.mjs`, and as a CI service.
  - The client is node-redis (`redis`). `maxClusterMessagesPerSecond` is 1,000 in
    `runtime.json`.
  - One module opens every Redis connection, as `server/store/pool.ts` does for Postgres:
    `REDIS_URL` required at boot like `DATABASE_URL` (a missing URL is a misconfiguration, and
    running many instances without a channel silently breaks cross-instance play), TLS on
    `rediss://`, client name per use (`murlan-adapter`, `murlan-inbox`, `murlan-presence`,
    `murlan-limits`), TCP keep-alive, a `PING` every 5 s on every connection, reconnect with
    capped backoff, an `error` listener on every client.
  - Socket.io uses `@socket.io/redis-streams-adapter` for room broadcasts. Its `maxLen` is
    derived from `runtime.json`'s design peak (`maxClusterMessagesPerSecond × 120 s`), pinned by a
    test, so a 2-minute Redis gap loses no packet.
  - Each instance reads its own stream `inbox:<instanceId>` (`XREAD BLOCK`, `MAXLEN ~` sized the
    same way) for addressed traffic: state for its sockets, forwarded intents, state nacks,
    resume hand-offs.
  - Runtime loss of Redis is degraded mode: local delivery and local tables carry on, a
    cross-instance forward answers `TABLE_UNREACHABLE`, presence answers from this instance only,
    rate limits fall back per D13.
  - A blackhole test (the `sim/repro/db/proxy.ts` pattern) proves a half-open adapter or inbox
    connection is detected and reconnected within 15 s (P2's class, on the new channel).
  - `@socket.io/postgres-adapter`, its patch and the `socket_io_attachments` table are removed.
- **D6 Addressed, local-first delivery.** One module offers "send this to these users".
  - A recipient on this instance gets it directly. Other recipients are grouped by the instance
    in their presence entry (D8), and each such instance gets one inbox message carrying each
    recipient's payload. Game state, round events, reactions, votes and friend status notices
    all go through it. A recipient with no presence entry is offline and costs nothing (the
    repro measured 2 `pg_notify` per friend per session today, even with every friend offline).
  - A missed state ack on a remote instance travels back to the owner as a nack
    `{ roomId, userId }`; the owner re-derives from its live game (`sendGameStateTo`'s rule),
    never a stale payload.
  - Per recipient and table, at most one state send is outstanding and one queued; a newer state
    replaces the queued one, so a slow socket is never sent a backlog.
  - `commitMove` arms the turn before it publishes, so the state's `turnDeadlineMs` is current.
    `game:turn_deadline` stays for re-arms that change no state (rejoin, disconnect),
    `gameTurn.ts:30-36`.
- **D7 Ordered state.** `game:state` carries `(epoch, seq)`: `seq` is a per-table counter in
  the envelope, incremented per publish. The client applies a state only if its pair is above the
  last one for that table (a newer epoch always wins), and resets on a room change.
- **D8 Presence in Redis.**
  - `presence:<userId>` is a hash `{ instance, socket, table }`, written on connect and on
    joining or leaving a table. Delete and overwrite are compare-and-set on `socket` (one Lua
    script each), so an evicted socket's late disconnect cannot erase its replacement.
  - Ticket 12 lands the `{ instance, socket }` part with its compare-and-set, since addressed
    delivery needs it; ticket 13 adds `table` and everything below.
  - Instance liveness: `instance:<id>` with a 10 s TTL refreshed every 3 s, the set
    `instances`, and `instance-users:<id>` listing each instance's users for cleanup. An entry whose instance key is gone reads as offline. Each heartbeat, an instance
    finds members of `instances` with no live key, deletes their users' entries
    (compare-and-set), sends their friends the offline notices and removes them from the set. A
    crashed instance's users are offline within about 13 s, and online users cost no periodic
    writes.
  - All four `Presence` port methods (`socketOutbox.ts:36-89`) and both sweeps
    (`sweepFinishedTables`, `resumeOrphanedTables`) read Redis (`MGET` or a pipelined `HMGET`),
    never `fetchSockets()`. Account revocation (`socketRegistry.ts:58`) is one cluster message;
    each instance disconnects its own sockets. No handshake (cookie, ticket) crosses instances.
  - The server pushes the online-friends list on connect. The connect push also carries
    `social:<userId>`, a Redis counter incremented on every friend or invite change; the client
    refetches its friend and invite lists only when it differs from the last one it saw, or is
    missing (`SocketContext.tsx:313` refetches on every connect today).
- **D9 Protocol.** Each wire change above bumps `PROTOCOL_VERSION` (`shared/protocol.ts:12`).
  A handler only old bundles use goes when `MIN_PROTOCOL_VERSION` passes the version that
  stopped sending it, never "after one release": app-store builds stay installed.
  `friend:get_online_list` stays regardless: the client still asks after a friend is accepted.

### Postgres hygiene

- **D10 Pools.** Every pool: `application_name` (`murlan-app`, `murlan-ownership`,
  `murlan-admin`, `murlan-ddl`, `murlan-health`), TCP keep-alive after 10 s,
  `maxLifetimeSeconds` 1800, `idle_in_transaction_session_timeout` 10 s. Admin reads get their
  own pool: max 2, `statement_timeout` 30 s.
- **D11 Transactions own their client.** One wrapper connects, begins, commits or rolls back,
  and releases with the error, so a broken client is destroyed rather than pooled (P1). When the
  rollback fails too, the caller gets the original error with the rollback's as its `cause`
  (repro: a half-open rollback hid the real error and doubled the wait to 10 s). A test pins
  every `.transaction(` and `BEGIN` in `server/` to the wrapper.
- **D12 Boot DDL and indexes.** On its own client under `pg_advisory_lock`, with
  `statement_timeout` 0, the pg client's own `query_timeout` 0 (the repro's 5 s failure was the
  client-side "Query read timeout", which fires before Postgres's), and `lock_timeout` 3 s (P3). Every index is built
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS` after the tables, outside a transaction, still under
  the advisory lock; an `INVALID` leftover is dropped and rebuilt. A test refuses a plain
  `CREATE INDEX` in the schema code.
- **D13 Capacity.** `pgConnectionsPerInstance` is derived from the pool configs (app, ownership,
  admin, DDL, health), pinned by the existing `tests/server/deployRuntime.test.ts`. At boot, and
  each minute, the server reads `SHOW max_connections` and counts `pg_stat_activity` by
  `application_name`; when the instances seen times the per-instance count plus 10 reserved
  exceeds the limit, it logs an error and sets `pg_connection_headroom` below zero.

### HTTP edge

- **D14 Sessions.** `disableTouch: true`; the session middleware runs on `/api`, `/admin` and the
  socket handshake only, never on static files (finding 3).
- **D15 Tickets and reconnect.** The ticket limiter is keyed by signed-in user (the ticket route
  is signed-in only); web connects with its cookie and mints no ticket (finding 6). Reconnect stays
  fast for client-side drops and reconnects at once on app foreground or a network change. The
  client drives every reconnect through `lib/reconnectDelay.ts` (full jitter, base 1 s, cap
  5 s) with Socket.io's own `reconnection` off: the repro showed Socket.io's backoff uses one
  `Math.random()` for both sign and size, so 1,000 clients landed in ten 50 ms teeth. The herd
  after a deploy is spread by the draining server (D20), not by slowing every client.
- **D16 Shared rate limits.** Every HTTP limiter uses a Redis store (`rate-limit-redis`), so a
  limit holds across instances and survives a deploy (finding 8). This supersedes the owner's D7
  of 2026-10-16 (per-instance login limits), on the owner's 2026-11-01 instruction that every
  finding is fixed. On a store error a limiter falls back to its in-memory store and counts it,
  never fails open and never answers 500 (express-rate-limit defaults `passOnStoreError: false`).
  Socket action limits stay per process: buckets are per user and one socket per user lives in
  the cluster.
- **D17 Health and metrics.**
  - `/health/live` touches nothing.
  - `/health/ready` means this instance can serve: booted, not draining, event-loop lag p99
    under 200 ms. It reports Postgres (1 s probe on the health client) and Redis (`PING`) in its
    body, but a shared dependency's blip never takes every instance out of rotation at once.
  - `/health` stays as an alias of ready until the host probe is switched.
  - `/metrics` serves Prometheus text through `prom-client`, behind a `METRICS_TOKEN` bearer
    token (required in production). It covers event-loop lag, pool total/idle/waiting per pool,
    Redis reconnects and stream lag, state acks missed, rounds pending and their age, coalesced
    writes, limiter fallbacks, telemetry rows dropped, and `pg_connection_headroom`.

### Reads, routing, shutdown

- **D18 Routing.** A forwarded intent goes to the owner's inbox (`table-owner:<roomId>`) and
  resolves on that reply; 1.5 s per try, the whole wait under the client's 4 s. With no owner
  record or no reply, the router reads `pg_locks` for the table's lock key before calling it
  unowned (P6). The dedupe window is by time, 120 s per intent id, capped at 50,000 entries.
- **D19 Telemetry batch.** `events` and client-error rows are inserted with
  `INSERT … SELECT … FROM unnest(…) LEFT JOIN users`, writing a null `user_id` for an account
  deleted inside the window, so one row cannot poison a batch. Overflow past 5,000 queued rows
  drops the oldest and counts them. Flushed on shutdown before the pool closes.
- **D20 Shutdown hands off.** Per room: stop taking intents, flush the write chain, release the
  advisory lock, send a peer a `resume` for the room through its inbox (the peer claims, bumps
  the epoch and re-arms the timers), and only then forward the room's intents to the new owner.
  A draining instance never answers `UNOWNED` for a room it released. Then each socket gets
  `server:draining` with a random `reconnectAfterMs` in 0–10 s, and `io.close()` runs last
  (P5).
- **D21 Leaderboard cache.** Per-instance memo by season, 30 s, plus
  `Cache-Control: private, max-age=30`.

## Proposed in the report, dropped on review

Each of these was judged worse than the alternative, not postponed.

| Proposal | Why it is not the best design |
| --- | --- |
| Round-results outbox table and worker | D1 gets the same durability from the existing envelope, with idempotency from the cleared marker; a worker and table add nothing |
| `namesOf` cache | A primary-key read of a few ids, under 1 ms; the cache adds rename and delete invalidation across instances for nothing measurable |
| Friend-id cache | Under 1 ms, and a stale entry shows a removed friend your online status: a privacy defect |
| Dropping the handshake `getUser` read | It is the check that refuses a ticket minted before its account was deleted; one indexed read per connect |
| Daily funnel rollup table | Its cost scales with the 30-day window, not the table, and on the admin pool (D10) with a 30 s timeout it cannot slow the game; the `events_occurred_idx` b-tree serves it |
| `> 8000` attachment fix | The Postgres adapter is removed (D5) |
| Slower client reconnect (2 s base, 30 s cap) | It slowed every network blip to fix a deploy herd; D20 spreads the herd at its source |

## Tickets, in dependency order

Filed as #1882–#1897 (plan number N is issue #1881+N), children of the map #1898, with every
edge below as a native `blocked_by`.

All `ready-for-agent`: every decision is made above. Production Redis is provisioned with the
host choice ([#1107](https://github.com/metasito/murlan/issues/1107)); the server is not live, so
ticket 4 merging before that takes nothing down.

| # | Ticket | Covers | Blocked by | Size |
| --- | --- | --- | --- | --- |
| 1 | Record the real-time and persistence architecture ADR | Shape, D1–D9, D16, D20 | — | S |
| 2 | Postgres connection hygiene | P1, P3, P8, D10–D13 | — | M |
| 3 | Sessions off static files; ticket limiter per user | 3, 6, D14, D15 | — | S |
| 4 | Redis, the streams adapter and per-instance inboxes | 1, P2, threshold, D5 | 1 | L |
| 5 | Health that never cascades, and metrics | P7, D17 | 2, 4 | M |
| 6 | Shared HTTP rate limits | 8, D16 | 4 | S |
| 7 | Account deletion and the admin page fast at any size | 4, 7 | 2 | M |
| 8 | Fetch only what each read uses; cache the leaderboard | 9, 10, 11, D21 | — | M |
| 9 | Owner epoch and the ownership heartbeat | P4, split brain, D3, D4 | 2, 4 | M |
| 10 | The write chain, and batched telemetry | 12, 13 (events), D2, D19 | 9 | M |
| 11 | A finished round lands once | 5, D1 | 1, 10 | L |
| 12 | Addressed, local-first, ordered delivery | 1, 13 (friend notices), ordering, backpressure, D6, D7, D9 | 4, 11 | L |
| 13 | Presence in Redis | 2, cookie in replies, reconnect refetch, D8 | 12 | L |
| 14 | Routing to the owner | P6, dedupe window, fan-out, D18 | 9, 12 | M |
| 15 | Shutdown hands every table off | P5, deploy herd, D20 | 3, 10, 14 | M |
| 16 | Rerun the audit and record the after numbers | all | 2–15 | S |

## Coverage: every report item and where it went

| Report item | Ticket |
| --- | --- |
| 1 Every emit is a NOTIFY | 4 (channel off Postgres), 12 (local-first, addressed) |
| 2 Connect and restore sweep the cluster | 13 |
| 2 Session cookie in cross-instance replies | 13 |
| 3 Session touch on every request | 3 |
| 4 Account deletion scans; `server_errors` purge inside the transaction | 7 |
| 5 Round-ending ack waits; results not durable | 11 |
| 6 Ticket limiter per IP; reconnect herd | 3 (limiter), 15 (herd) |
| 7 Admin scans: BRIN index, own pool | 7 |
| 8 Per-instance rate limits | 6 |
| 9 Friend list over-fetch | 8 |
| 10 Quick match | 8 |
| 11 Orphan sweep | 8 |
| 12 Per-move persist uncoalesced | 10 |
| 13 Telemetry inserts | 10 |
| 13 One NOTIFY per friend notice | 12 |
| P1 Leaked transaction connection | 2 |
| P2 Half-open adapter connections | 4 (blackhole test on the Redis channel) |
| P3 Boot DDL race and timeout; no instance cap; index builds | 2 |
| P4 Ownership reclaim against its own session | 9 |
| P5 Locks held to the last shutdown step | 15 |
| P6 "No answer" read as "no owner"; timeouts | 14 |
| P7 `/health` through the app pool | 5 |
| P8 Pool hygiene | 2 |
| `game:state` applied with no sequence check | 12 |
| Attachment threshold `> 8000` | 4 (adapter removed) |
| `APPLIED_MAX` dedupe window | 14 |
| Caching: leaderboard | 8 |
| Caching: `namesOf`, friend ids, handshake `getUser`; funnel rollup | dropped on review (above) |
| After numbers | 16 |

## Contrarian review: objections and what changed

| # | Objection | Verdict | Change |
| --- | --- | --- | --- |
| 1 | The final state is sent and persisted before the results commit, so "restore to before the final move" is false and results can be lost silently | Confirmed (`tableMoves.ts:93-94`, `tableLifecycle.ts:223`) | D1 rewritten: final envelope carries pending results |
| 2 | A retry after an unknown commit double-applies; a deleted account's FK error blocks the table forever | Confirmed (`stats.ts:58-61,87-95`) | D1: cleared marker is the idempotency key, live users filtered, errors classified, table never waits |
| 3 | `seq` freezes clients after a restore; writes are not fenced by ownership | Confirmed (`activeGameStore.ts:28-31`, `shutdown.ts:129-131`) | D3 owner epoch, D7 `(epoch, seq)` |
| 4 | Releasing the lock before closing sockets answers `NO_LIVE_GAME` and stalls bot and AFK timers | Confirmed (`tableRouter.ts:283-287`) | D20 explicit hand-off |
| 5 | Presence covered friends only; `isAtTable`, both sweeps and revocation stayed on `fetchSockets`; TTL races | Confirmed (`socketOutbox.ts:36-89`, `socketRegistry.ts:58`) | D8 rewritten: hash with table, CAS, instance liveness, all methods |
| 6 | Deal-time previews straddle a season boundary; acking on commit worsens finding 5 | Confirmed (`roundOver.ts:99-103`) | D1: deltas from the transaction, ack on apply |
| 7 | Redis failure defaults take the game down; readiness cascades; stream `maxLen` too small; watchdog dropped | Confirmed (`passOnStoreError: false` at express-rate-limit `index.mjs:813`) | D5 degraded mode, keep-alive `PING`, blackhole test, derived `maxLen`; D16 fallback; D17 readiness. Kept: `REDIS_URL` required at boot (a missing URL is a misconfiguration) |
| 8 | "First reply" does not exist in Socket.io; every instance reads every message | Confirmed (`cluster-adapter.js:554` waits for `nodesMap.size`) | D5 per-instance inboxes, D6 addressed delivery, D18 owner inbox, D6 nack to the owner |
| 9 | Folding `turn_deadline` loses its reason; no protocol versioning | Confirmed (`gameTurn.ts:30-36`, `shared/protocol.ts:12-13`) | D6 arm before publish, event kept; D9 |
| 10 | The chain also carries deletes and status writes | Confirmed (`gamePersistence.ts:133-138,212`) | D2 barriers |
| 11 | Slowing all reconnects to fix a deploy herd | Accepted | D15 fast reconnect, D20 draining notice |
| 12 | 3 s `lock_timeout` with a plain `CREATE INDEX` at boot crash-loops | Confirmed (repro P3c) | D12 concurrent indexes, test |
| 13 | One deleted account poisons a telemetry batch; no flush on shutdown | Confirmed (`shared/schema.ts:225,288`) | D19 |
| 14 | The capacity test compares two literals | Accepted | D13 derived count and a live boot check |
| 15 | No metrics; no backpressure; reconnect refetch storm; BRIN misattributed | Confirmed (`SocketContext.tsx:313`) | D17 metrics, D6 per-recipient coalescing, D8 social version, funnel reason corrected |
| 16–20 | Missing edges, ticket 4 blocked for nothing, Redis provisioning, oversized tickets, ADR before revision | Accepted | Tickets regrouped to 16; ADR written from this revision |
