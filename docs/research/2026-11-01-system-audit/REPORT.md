# System design and performance audit: report

Audit of `main` at `5f464ce`, 2026-11-01, against [BRIEF.md](BRIEF.md). Four reviewers read the
code by lens (queries, pools and scale, the real-time path, caching and clients); the lead re-read
the cited lines of every finding above Low and ran the measurements. No fault was injected: the
failure-mode findings in the pool section are read from source, and each names the experiment that
would reproduce it. The numbers come from the scripts in [sim/](sim/) on Postgres 16 (the
production major) on this machine. A label says how each claim is known:

- **measured**: a number from `sim/`, with its result file;
- **read**: seen in the code at the cited line;
- **inferred**: a calculation or library behaviour not reproduced here.

## Verdict

The design is sound where it matters most: the server decides every outcome, a live table lives in
the memory of exactly one process, every Postgres connection is opened in one place, and every read
the player waits on is indexed and bounded. Single-move latency is low (P50 9 ms, P99 27 ms at
8 tables). It is not yet top tier on four counts:

1. **Every socket message goes through Postgres.** Each move costs about five `pg_notify`
   transactions plus one full-state write, even with one server (measured). `NOTIFY` tops out
   near 3,400 a second for the whole database however many connections send it, while plain
   queries scale past 100,000 (measured). That is about 650 moves a second cluster-wide, so this
   is the first ceiling the system hits, well before CPU or the query pool, and more instances do
   not raise it.
2. **The connect path scans the whole cluster.** Every connection, and every reconnect after a
   deploy, runs two full `io.fetchSockets()` sweeps to find a few friends (read). A reconnect herd
   costs O(N²).
3. **Slow work sits on paths it need not.** The session store writes on every signed-in HTTP
   request, static files included (measured on API requests; static files read from the
   middleware order); the move that ends a
   round waits on three database calls before its ack (read); round results are written seat by
   seat, sequentially, with no retry if the process dies (read).
4. **Connections fail quietly.** A transaction whose `begin` fails leaks its pool connection for
   good, and a silently dropped adapter connection is never noticed, so an instance can go deaf to
   its peers while `/health` says it is fine (read).

Account deletion and the admin page are the two places where data volume, not traffic, breaks a
query: both scan tables that grow without an index serving them (measured).

## Findings, ranked

| # | Finding | Severity | Known by |
| --- | --- | --- | --- |
| 1 | Every emit is a `pg_notify`, even to a socket on the same process | High | measured |
| 2 | Connect and restore sweep every socket in the cluster | High | read |
| 3 | Session touch on every request, static files included | High (cheap fix) | measured |
| 4 | Account deletion scans unindexed tables inside a 5 s budget | High (correctness) | measured |
| 5 | Round-ending move's ack waits on the database; results not durable | Medium | read |
| 6 | Ticket limiter is per IP; reconnect herd has no first-attempt jitter | Medium | measured + read |
| 7 | Admin snapshot scans `round_history` and `events`, holds 4 of 10 connections | Medium | measured |
| 8 | Per-instance rate limits multiply with instances | Medium | read |
| 9 | Friend lists select whole `users` rows, password hash included | Low | read |
| 10 | Quick match reads every waiting room, no `LIMIT`, mode filtered in JS | Low | measured |
| 11 | Orphan sweep loads every `active_games` envelope every 5 minutes | Low | read |
| 12 | Per-move persist is uncoalesced | Low | measured |
| 13 | Telemetry inserts one row per event; friend notices one `NOTIFY` per friend | Low | read |

Pool and lifecycle findings follow in their own section.

### 1. Every emit is a `pg_notify`, even to a local socket

- **Where.** `server/socket/socketOutbox.ts:14-26` sends each seat's state with
  `io.to(userRoom(uid)).timeout(..).emit(..)`. A room broadcast is not local, so the Postgres
  adapter publishes it before delivering it, whether or not another instance exists
  (`@socket.io/postgres-adapter` → `socket.io-adapter` `ClusterAdapter.broadcast`).
- **Measured** (`sim/results/statements-per-move.txt`). One table of four for 20 s: 417 moves,
  2153 `pg_notify`, 425 `active_games` upserts: **5.2 NOTIFY and 1.0 state write per move**,
  10.8 commits per move in all. One NOTIFY per human seat, plus `game:turn_deadline`.
- **Why it matters.** Each NOTIFY is its own transaction, and Postgres serialises NOTIFY commits on
  one global queue lock. The adapter pool holds four connections, one parked on `LISTEN`
  (`server/socket/socketAdapter.ts:18`). Room emits other than `game:state` (`round_over`,
  `turn_deadline`, `reaction`, votes) do not reach even a local socket until their NOTIFY returns;
  under pool saturation that is up to the 5 s connection timeout.
- **Measured ceiling** (`sim/results/notify-bench.txt`, pgbench, 2 kB payload, one listener).
  NOTIFY flattens at **about 3,400 a second whatever the connection count** (2,800 at 1
  connection, 3,425 at 3, 3,490 at 8, 3,420 at 16), while plain `SELECT 1` on the same server
  scales from 22k to 180k. That cap is for the whole database, on a same-host server with no
  network: at 5.2 NOTIFY per move it is about **650 moves a second cluster-wide**, and adding
  instances does not raise it. Over a network the adapter's three publishers bind first: at a
  3 ms round trip they carry about 1,000 NOTIFY a second, about 190 moves a second per instance
  (inferred from the round trip). At a person's pace of one move every 3–4 s per table, that is
  roughly 600–700 live tables per instance and about 2,000 cluster-wide.
- **Fix.** Deliver locally when the recipient's socket is on this instance and publish only for
  remote recipients; send one cluster message per move carrying every remote recipient's state
  instead of one per recipient; fold `turn_deadline` into `game:state`. On one instance this takes
  NOTIFY per move from about 5 to 0. Before horizontal scale, move the adapter to Redis or
  Postgres-free streams.
- **Proof after the fix.** `sim/load.sh` again: NOTIFY per move and commits per move.

### 2. Connect and restore sweep every socket in the cluster

- **Where.** `announcePresence` (`server/socket/socketPresence.ts:101-107`) calls
  `onlineUserIds()` → `io.fetchSockets()` across every instance (`socketOutbox.ts:77-88`), then the
  client asks again with `friend:get_online_list` on every connect (`context/SocketContext.tsx:307`),
  which sweeps a second time. `tablePresence` does the same once per restored table
  (`server/game/tableLifecycle.ts:76`).
- **Why it matters.** Each remote instance answers with every socket it holds, handshake headers
  included; above 8000 bytes that reply is an `INSERT` into `socket_io_attachments` plus a read on
  every receiver (inferred from the adapter source). After a deploy, N reconnecting clients each
  pull N sockets: O(N²) work at the moment the system is busiest. The handshake headers carry the
  session cookie into those rows (inferred; security lens).
- **Fix.** Keep the server push and drop the client's ask on connect; query only the friends'
  rooms (`io.in(friendRooms).fetchSockets()`, or a per-instance presence set); build restore
  presence once per sweep.

### 3. Session touch on every request, static files included

- **Where.** `server/app.ts:232-233` mounts the session middleware before `configureWebBuild`
  (`:252`), and `server/http/session.ts` does not set `disableTouch`, so connect-pg-simple runs
  `SELECT sess` plus `UPDATE session SET expire` for every cookie-bearing request: each card image,
  sound, font and script.
- **Measured** for API requests: the statement log shows the touch `UPDATE` beside each session
  read. The soak fetches no static files, so their share is read from the middleware order, not
  measured.
- **Why it buys nothing.** With `rolling: false` the cookie expires 30 days after issue whatever
  the row says, as `docs/PRIVACY.md` promises; sliding the row only adds WAL and dead tuples.
- **Fix.** `disableTouch: true`; mount the session on `/api` and `/admin` only.

### 4. Account deletion scans unindexed tables inside a 5 s budget

- **Where.** `server/http/deleteAccount.ts:21-83` runs in one transaction under the 5 s
  `statement_timeout` (`server/store/db.ts:16`). The cascade from `users` reaches columns with no
  index: `events.user_id`, `client_errors.user_id`, `bug_reports.user_id`,
  `game_invites.inviter_id`. Replays are matched by `player_ids @> .. OR seats @> ..`, and `seats`
  has no index; sessions by `sess->>'userId'`, also unindexed. Each matching replay is then
  updated in its own round trip.
- **Measured** (`sim/results/explain-baseline.txt`). With 2M events the `events` cascade trigger
  alone takes 212 ms; the whole `DELETE FROM users` 279 ms; the replay match is a sequential scan
  (119 ms on 200k replays); the session match a sequential scan (50 ms on 100k sessions).
  `events` grows by two rows per socket session for 90 days, so tens of millions of rows at launch
  scale; the sequential scan grows linearly, past the 5 s budget near 50M rows (inferred). A
  deletion that times out rolls back: the player cannot delete their account.
- **Fix.** Indexes on the four FK columns, a GIN on `round_replays.seats`, an expression index on
  `session ((sess->>'userId'))`; one set-based `UPDATE` for the replays; the `server_errors` purge
  moved out of the transaction into a batched job. The database holds no real data yet, so the
  indexes cost nothing to add now; after launch each needs `CREATE INDEX CONCURRENTLY` outside boot,
  because boot DDL runs under the same 5 s timeout and would stop the server starting.

### 5. Round-ending move waits on the database; results are not durable

- **Where.** The final move's ack is the `handleRoundOver` promise (`server/game/tableMoves.ts:69,94`),
  which awaits rating previews (`roundOver.ts:110`), a room status write (`:165`) and a second full
  envelope write (`:177`). The results that follow are fire-and-forget (`:207-215`): one
  transaction per human seat, in sequence (`server/game/stats.ts:57`), about 40 statements for four
  humans, then the replay. They live only in memory: a crash after `round_over` loses stats,
  rating and replay with nothing to retry them.
- **Fix.** Ack the move before the previews; write a round-result outbox row in the same
  transaction as the final state, and let a worker apply ratings, stats and replay with an
  idempotency key of room and round; batch the per-seat writes into multi-row statements.

### 6. Ticket limiter per IP; reconnect herd without first-attempt jitter

- **Where.** `ticketLimiter` (`server/http/routes/auth.ts:201-206`) has no `keyBy`, so it is 60 a
  minute per IP. Every socket attempt mints a ticket, web included, where the cookie already
  authenticates (`lib/socket.ts`, `server/socket/socket.ts:143`). Reconnect starts at 1 s with the
  library's default 0.5 jitter, capped at 5 s (`lib/socket.ts:92-95`).
- **Measured.** The load test hit it at once: with 32 tables of clients on one address,
  registration-to-socket setup failed with 429 until `MURLAN_TICKET_RATE_LIMIT` was raised.
  Players behind one carrier NAT, a school or an office share that bucket; after a deploy every one
  of them reconnects within 0.5–1.5 s.
- **Fix.** Key the limiter by session; skip ticket minting on web; widen the first reconnect
  (randomisation 1.0, delay 2 s, cap 30 s).

### 7. Admin snapshot scans big tables

- **Measured.** Active players over 7 days: 2.4 s on 2M `round_history` rows (no index leads with
  `finished_at`); the 30-day funnel: 0.5 s on 2M events, linear in a table that reaches tens of
  millions. Four admin queries run in parallel on the gameplay pool of ten
  (`server/http/admin.ts:220`).
- **Fix.** A BRIN index on `round_history(finished_at)`, a daily rollup for the funnel, and a
  separate one- or two-connection pool for admin reads.

### 8–13. Lower impact

- **8. Rate limits per instance** (`server/http/rateLimit.ts`, memory store): with N instances the
  login brute-force limit becomes N×, and every deploy resets it. A Postgres-backed store for the
  login, register and reset limiters only.
- **9. Over-fetch** (`server/store/friendStore.ts:25-43`): friend lists select whole `users` rows,
  password hash and email included, on every connect, then use three fields.
- **10. Quick match** (`server/store/roomStore.ts:334-354`): every public waiting room, no `LIMIT`,
  mode and size filtered in JS, then one locking claim per candidate in turn. Measured 4.6 ms with
  150 waiting rooms, so fine today; push the predicates into SQL and use `SKIP LOCKED` before it
  matters.
- **11. Orphan sweep** (`server/game/tableLifecycle.ts:217`): every instance reads every
  `active_games` envelope every 5 minutes; project the few fields it needs and filter in SQL.
- **12. Per-move persist** (`server/game/gamePersistence.ts:185-197`): measured envelope 3.2 kB as
  text, 1.5 kB stored, 86 % HOT updates. One small write per move is affordable; a latest-wins slot
  per table would drop the writes a stall queues up.
- **13. Telemetry and friend notices**: `trackEvent` is one `INSERT` per event, twice per socket
  session; friend status is one NOTIFY per friend. Batch both.

## Caching

**Verdict: caching is not where the database load comes from, so it is the last lever, not the
first.** The live table, the hottest data in the system, is already held in the memory of the one
process that owns it, and no move reads Postgres. The client caches every query with
`staleTime: Infinity` and refetches only on a socket event (`lib/query-client.ts:92-104`). The
reads a player waits on measured under 1 ms, the leaderboard 54 ms cold. The load measured above
is NOTIFY and session writes, which no read cache touches; findings 1–3 remove it.

Worth caching once those land, each with a TTL so a lost cross-instance invalidation heals itself
(invalidate through `io.serverSideEmit`, the channel the presence code already uses):

| Data | Cache | Staleness allowed | Invalidation |
| --- | --- | --- | --- |
| Global leaderboard | per-instance memo by season, 30 s; `Cache-Control: private, max-age=30` | 30–60 s | TTL only |
| Usernames for replays and history (`namesOf`) | LRU of 5k, 60 s | 60 s | on rename and delete |
| Friend ids for presence | LRU per user, 60 s | 60 s | on accept, remove, delete |
| Handshake `getUser` (`server/socket/socket.ts:168`) | drop the read | — | the session or ticket already proves the account |

Not to be cached: session rows (revocation would lag by the TTL), the room list (seat claims need
fresh rows), stats, achievements and history (the client already holds them until an event says
otherwise).

## Pools, connection lifecycle and failure modes

| Pool | max | idle timeout | connect timeout | statement / query timeout | keep-alive | max lifetime |
| --- | --- | --- | --- | --- | --- | --- |
| App (`server/store/db.ts:62-71`) | 10 | 30 s | 5 s | 5 s / 5 s | none | none |
| Socket adapter (`server/socket/socketAdapter.ts:152-161`) | 4, one on `LISTEN` | never | 5 s | none / none | none | none |
| Ownership client (`server/game/gameOwnership.ts:84-109`) | 1 | — | none | 5 s / 5 s | server-side 20/5/3 | — |

Fifteen per instance, as `deploy/runtime.json` says. No pool sets `application_name`,
`idle_in_transaction_session_timeout` or a maximum connection lifetime.

| # | Finding | Severity |
| --- | --- | --- |
| P1 | A failed `begin` leaks an app-pool connection for good | High |
| P2 | Half-open adapter connections are never detected | High |
| P3 | Nothing caps instances against the connection budget; boot DDL races and times out | Medium-high |
| P4 | Ownership reclaim can dispose every table of a healthy process | Medium |
| P5 | A deploy holds table locks until the last shutdown step | Medium |
| P6 | Forwarding reads "no answer" as "no owner"; timeouts out of order with the client's retries | Medium |
| P7 | `/health` runs through the app pool, so saturation looks like death | Medium |
| P8 | Pool hygiene: no idle-in-transaction timeout, no keep-alive, no lifetime, no name | Low-medium |

- **P1, read and verified.** drizzle's `transaction()` (`drizzle-orm/node-postgres/session.js`,
  0.45.2) runs `client.connect()` and `begin` outside its `try/finally`, so a `begin` that rejects
  never releases the client; and on any error it releases without passing the error, so a broken
  client goes back to the pool. A stale idle client after a failover is enough: each event costs
  one of ten connections until restart. Seventeen transactions are exposed, six in `roomStore`.
  Fix: a patch (the repo already patches the adapter) or one transaction wrapper that owns its
  client and calls `release(err)`. Proof: a unit test with a client whose `begin` rejects.
- **P2, read; network behaviour inferred.** The `LISTEN` client never writes and has no TCP
  keep-alive, so a silently dropped connection never errors and the patch's reconnect never runs;
  the instance goes deaf while peers still see its heartbeats, and every cross-instance ask waits
  its full 5 s. Idle publishers are never reaped and have no `query_timeout`, so a `pg_notify` on a
  stale one hangs until the kernel gives up. Fix: keep-alive at 10 s, `query_timeout` 3 s, idle
  timeout 60 s, lifetime 30 min on the adapter pool; a watchdog that reconnects `LISTEN` when no
  message (its own heartbeat included) arrived for 15 s; both exposed on `/health`. Proof: block
  the `LISTEN` backend's port with iptables in the container.
- **P3, read.** At 15 per instance a stock 100-connection database fits six instances, three
  across a deploy overlap; nothing in `runtime.json` caps instances. `ensureSchema`
  (`server/store/schemaDdl.ts:517-524`) takes no lock, so concurrent boots race on
  `CREATE … IF NOT EXISTS`, and it runs under the 5 s statement timeout, so an index on a grown
  table stops boot. Fix: `maxInstances` and `maxConnections` in the host contract with a test that
  derives the budget from them; DDL on its own client under an advisory lock with no statement
  timeout and a 3 s lock timeout.
- **P4, read.** When the ownership heartbeat fails, the client reconnects at once; if the old
  backend is still alive, `pg_try_advisory_lock` fails against the process's own session and every
  table is disposed as claimed elsewhere (`gameOwnership.ts:68-77,119-124,177-179`). The client has
  no connect timeout. Fix: terminate the old backend pid before reclaiming; 3 s connect timeout.
- **P5, read.** Shutdown stops listening at `io.close()` but releases table locks only in its last
  step (`server/http/shutdown.ts:109-135`); rejoins elsewhere meanwhile get `TABLE_UNREACHABLE`,
  shown as a server error after three 2 s retries. Fix: release each room's lock as soon as its
  last write lands.
- **P6, read.** During a peer's shutdown, `serverSideEmit` answers with nobody, which the router
  reads as unowned (`server/game/tableRouter.ts:247`), so a disconnect arms the 20 s lobby grace
  instead of the 60 s one. The router waits for every peer, 5 s a try, three tries, up to 15 s,
  against the client's 4 s × 3 (`lib/sendIntent.ts:11-12`). Fix: probe `pg_locks` when nobody
  answers; resolve on the first owner's reply, about 1.5 s.
- **P7, read.** `/health` runs `SELECT 1` on the app pool (`server/app.ts:235-250`), so a
  saturated but healthy instance answers 503 and can be restarted under load. Split liveness from
  readiness.
- **P8, read.** Add `idle_in_transaction_session_timeout=10s` (a stuck transaction holds user
  locks), keep-alive on the app pool, a 30 min lifetime against a demoted primary, and an
  `application_name` per pool. PgBouncer is not needed below about three instances; when it is,
  `LISTEN` and the session advisory locks stay on a direct connection.

Also from this lens, low: per-process rate limits (finding 8); the client applies any
`game:state` with no sequence check, and states can reorder across instances
(`context/OnlineGameContext.tsx:448-478`); the adapter's attachment threshold is `> 8000` where
Postgres requires a payload under 8000 bytes; the dedupe window (`APPLIED_MAX = 2000`,
`tableRouter.ts:59`) shrinks to seconds at a few hundred intents a second.

## Checked and not a problem

- **Indexes on the reads players wait on.** Profile history 0.15 ms, replay list 0.45 ms (GIN on
  `player_ids`), leaderboard 54 ms cold, quick match 4.6 ms, all on the launch-scale seed.
- **`round_history` cannot grow past 50 rows per player**: it is pruned on every write
  (`server/game/stats.ts:26,122-134`). The seed broke that cap on purpose, so its 2.6 s prune is
  not a production number.
- **No `OFFSET` pagination, no `LIKE` search, no polling.** React Query defaults to
  `staleTime: Infinity` with event-driven invalidation (`lib/query-client.ts`).
- **Per-table write ordering** is serialised in process (`gamePersistence.ts:102-109`); stored
  envelopes are small and mostly HOT-updated.

## Fix plan

Six PRs, one per area, each red-then-green; the two that touch storage or the socket path get a
design first (CLAUDE.md, working agreement).

| PR | Area | Findings | Design first |
| --- | --- | --- | --- |
| A | Indexes, query shape and read caches | 4, 7 (index), 9, 10, 11, caching table | no: additive DDL, query rewrites, TTL caches |
| B | HTTP session and reconnect | 3, 6, P7 | no |
| C | Pools and boot | P1, P2, P3, P8 | no: options, a patch, a boot lock |
| D | Real-time delivery | 1, 2, 13, P6 | yes: who delivers which emit, and the cluster message |
| E | Round results | 5, 7 (rollup, admin pool), 12 | yes: the outbox row and its worker |
| F | Ownership and deploy | P4, P5 | yes: reclaim and lock release order |

Finding 8 (a shared rate-limit store) waits for a second instance: today one instance runs, and
the cost is a table and a write per login attempt.

After the six PRs, `sim/load.sh` and `sim/explain.sql` rerun against the same seed, and this
report gains an "after" column.

## Measurements

| Run | Result |
| --- | --- |
| 1 table, 20 s, every statement logged | 21 moves/s; 5.2 NOTIFY, 1.0 state write, 10.8 commits per move |
| 8 tables, 1 min | 54 accepted moves/s, P50 9 ms, P99 27 ms |
| 32 tables, 1 min | 197 accepted moves/s, P50 29 ms, P99 71 ms |
| 96 tables, 1 min | 156 accepted moves/s, P50 46 ms, P99 268 ms; 61 % of sent moves refused |
| pgbench NOTIFY, 1 / 3 / 8 / 16 connections | 2,808 / 3,426 / 3,491 / 3,422 a second |
| pgbench `SELECT 1`, same | 21,777 / 54,378 / 104,943 / 179,564 a second |

The soak client plays without thinking time and in bursts, so the server's per-player limit of
60 moves a minute (`server/socket/socketGameplay.ts:31`, not configurable) refused most of the
96-table load. These runs are bound by that limit and do not locate the system's ceiling; the
pgbench rows do, for NOTIFY. Per-move database counts come from the statement log only:
`pg_stat_database` counters lag on backends that never go idle, so they undercount under load.
Clients and server share one process and one machine, so latency includes client CPU. Treat the
soak rows as before-and-after numbers, not as capacity.

Reproduce: start Postgres 16, then `sim/ensure-schema.ts`, `sim/seed.sql`, `sim/explain.sql`,
`pgbench -n -T 15 -c <n> -f sim/notify.sql` with one session listening on `bench`, and
`sim/load.sh <tables> <minutes>`.
