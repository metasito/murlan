# 0016. Postgres 19 and Valkey 9 now, and their own commands in place of ours

**Status:** Accepted
**Date:** 2026-11-02

## Context

ADR-0015 chose Postgres 18 and Valkey 8.1, the newest lines the #1107 hosting candidates already
ran, and parked 19 and 9 behind the host choice (#1925, #1926). The owner overruled that on
2026-11-02: "let's use valkey 9 and postgres 19 straight away … use the latest stable versions and
the best features. no workaround. where they can do things better, remove our code and use their
functions."

The facts this record acts on, from `docs/research/2026-11-02-latest-stable/postgres-19.md` and
`valkey-9.md`:

- **Postgres 19** is at RC1 (2026-10-15). GA is planned for 2026-11-19, and no `19-alpine` tag
  exists yet. No managed host offers 19. Ubuntu packages no `postgresql-client-19`; PGDG does.
- **Valkey 9.1.3** is the newest GA (2026-10-26); 9.2 is at RC1. ElastiCache, Memorystore, Aiven
  and Heroku run 9. Render's last verified engine is 8.1.
- `@socket.io/redis-streams-adapter` and our `server/store/redis.ts` are node-redis-shaped.
  node-redis 6.3 runs against Valkey 9 and types `SET … IFEQ` and `XADD … NOMKSTREAM`, but not
  Valkey's `DELIFEQ`.

## Decision

1. **Postgres 19, pinned at GA.** Every pin and `deploy/runtime.json` move from 16 straight to
   `19-alpine@sha256:<GA digest>`, and CI installs `postgresql-client-19` from PGDG. A release
   candidate is never pinned: the repo's own major guards refuse `19rc1`, and the point is a
   stable release. 18 is skipped. This supersedes ADR-0015 decision 1.
   - *Adopted, with code:*
     - `transaction_timeout` on the `app` and `admin` pools, with its SQLSTATE `25P04` retried as
       transient by the round-results path.
     - Native `uuid` columns for every id and foreign key, in place of `varchar`. The database
       holds no accounts, so this is the only time the type can change without a migration.
     - `uuidv7()` defaults on the tables whose ids never reach a client and grow by appending:
       `events`, `round_history`, `round_replays`, `client_errors`, `server_errors`, `bug_reports`,
       `auth_tokens`, `game_invites`, `room_players`. `users`, `rooms` and `friends` keep v4,
       since a v7 id discloses when it was made.
     - Skip scan in place of two indexes: `events_occurred_idx` and `rooms_status_idx` are
       dropped, each guarded by an integration test asserting the plan.
     - `upsertSeatRow`'s read-then-write becomes one `INSERT … ON CONFLICT DO UPDATE`.
   - *Adopted, with no code:* LZ4 TOAST compression, parallel autovacuum, asynchronous I/O and its
     worker scaling, faster foreign-key checks, JIT off. `REPACK (CONCURRENTLY)` is the runbook's
     answer to a bloated `active_games`.
   - *Rejected:*
     - `MERGE`, still on correctness: it is not a concurrency-safe upsert and cannot carry the
       epoch fence.
     - `ON CONFLICT DO SELECT` and `RETURNING OLD/NEW`: no caller reads the row it lost or the
       value it replaced.
     - Virtual generated columns: they cannot be indexed, and expression indexes serve every
       lookup.
     - `JSON_TABLE`, temporal constraints, `NOT ENFORCED`, `IGNORE NULLS`, `casefold`, `random()`
       for codes, `COPY` for telemetry, and partitioning for retention, each for the reason in
       `postgres-19.md` § 3.3.
     - The host's own features: replication, OAuth and backup.
2. **Valkey 9.1, pinned as `valkey/valkey:9.1.3-alpine` by digest**, in CI, the soak, the mutation
   run and the dev stack. The host contract names the engine as well as its major. This supersedes
   ADR-0015 decision 2, and #1925 is withdrawn. Its commands replace our Lua:
   - **Table owners:** `DELIFEQ` clears the record. `SET … PX … IFEQ` refreshes it, falling back
     to `SET … NX` when the record is gone. Both scripts in `server/store/tableOwners.ts` go.
   - **Inbox:** a sender writes with `XADD … NOMKSTREAM MAXLEN ~`. The receiving instance creates
     its stream at boot and keeps its TTL alive in its liveness heartbeat, so the `XADD` + `EXPIRE`
     script goes. A null reply now means the instance is gone, so a forward fails at once instead
     of waiting on a reader that will never come.
   - **Presence (#1893, #1894):** `presence:<userId>` is the string `<instance>|<socket>`. It is
     written with `SET` and removed with `DELIFEQ`. The table a socket sits at is that socket's
     own key, `table:<socketId>`. `instance-users:<instance>` is added to before the presence write
     and removed from only after a `DELIFEQ` that returned 1, so it is always a superset. The
     dead-instance sweep uses `DELIFEQ`'s reply as its claim, so each friend notice is sent once
     with no lock. Delivery reads every recipient with one `MGET`. No presence script exists.
   - **Rate limits:** `rate-limit-redis` stays. The live-count decrement stays a script, sent by
     `EVALSHA`, because no 9.1 command decrements only a live key. `INCREX` replaces both when
     9.2 is GA.
   - **Guards:** `maxmemory-policy noeviction`. A boot check logs and counts when `INFO` reports an
     engine other than `server_name:valkey` or another eviction policy. Gauges come from `INFO`.
   - *Rejected:*
     - Hash-field TTL for presence, still on correctness: per-user expiry needs a periodic write
       per online user, and a key-TTL hash loses the dead instance's users before their friends
       are told.
     - Keyspace notifications for liveness: a missed event strands users, so the sweep stays.
     - Valkey GLIDE and iovalkey: the streams adapter takes node-redis.
     - Valkey 9.2's `INCREX`, `EXEC IFEQ` and `SET … IFNE`, until 9.2 is GA.
3. **The host follows the stack.** #1107 must choose a host that runs Postgres 19 and Valkey 9.1 or
   newer, or run either ourselves. Until one does, production has no target, and CI and dev run 19
   and 9 meanwhile.

## Consequences

- A Lua script sent to the key-value store needs a reason that no Valkey command covers. Today
  only the rate-limit decrement has one.
- Ids are `uuid` and arrive as text from clients, so an id is validated at the HTTP and socket
  schema. A malformed one would otherwise reach Postgres and raise `22P02` instead of matching
  nothing.
- The Postgres pin lands on or after 2026-11-19. The tickets that need 19 wait for it rather than
  pinning a release candidate.
- ADR-0015 still holds for Node 26, Expo SDK 58, the packages and the CI actions.

The work is carried out on map #1898:
- Postgres 19 (#1913).
- The schema on 19, which takes in `uuid`, `uuidv7()`, skip scan and the seat upsert (#1927).
- Valkey 9 and its commands (#1919).
- Presence and delivery on those commands (#1893, #1894).
- The measurements (#1921).
