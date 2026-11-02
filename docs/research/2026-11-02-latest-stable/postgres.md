# Postgres: latest usable stable release for #1911 (research, 2026-11-02)

Read-only on the repo. Network note: postgresql.org, render.com, fly.io and endoflife.date were NOT reachable from this session (proxy 403), so provider and release facts below come from search-result snippets of those pages (URLs cited) and are marked **(snippet)** where I could not open the page. Docker Hub, npm and raw.githubusercontent.com were reachable and are first-hand. No benchmarks were run.

## 0. Recommendation

**PostgreSQL 18 (image `postgres:18.6-alpine`), on Render Postgres 18.** Reasons:

1. 18 is the newest GA major (19 is still RC1; GA planned 2026-11-19). 18.6 is the newest 18.x in the official image today.
2. Render offers 18 (default for new databases since 2025-11-13) and supports 13-18. Neon (GA 2026-05-01), AWS RDS (2025-11/12) also offer it. The recommended host is covered.
3. The database "holds no real accounts yet" (`server/CLAUDE.md`), so a fresh 18 database costs nothing now; a later 16 to 18 hop would need a maintenance window and `pg_dump` rehearsal. Render's in-place upgrade always targets the latest major, so starting on 16 only defers a forced hop.
4. Support horizon: 16 ends Nov 2028, 18 ends Nov 2030. Starting on 18 gives about 4 years before the first forced major move; starting on 16 gives about 2.
5. Nothing in our code or libraries blocks 18 (section 2).

**Caveat if Fly is chosen instead (#1107's cheaper alternative):** Fly Managed Postgres documents only 16 and 17 and no in-place major upgrade **(snippet)**. Then the common denominator is **17** (`postgres:17.11-alpine`). Everything below marked "18-only" (uuidv7, RETURNING OLD/NEW, skip scan, async I/O) would not be available on Fly MPG. Decide the host before pinning, or pin 18 and treat Fly as "run `postgres-flex` PG18 self-managed" (a pg18 Dockerfile exists in fly-apps/postgres-flex PR 296 **(snippet)**).

**Do not adopt 19 now**: not GA, no 19-alpine tag (only `19rc1-alpine`, verified on Docker Hub), no managed host offers it. Revisit at 19.1 or later (a cheap follow-up ticket, not part of #1911).

## 1. Versions, dates, usability

| Fact | Value | Source |
|---|---|---|
| Newest GA major | 18 (released 2025-09-25) | https://www.postgresql.org/docs/current/release-18.html |
| Newest 18 minor | **18.6** (2026-08-13). 18.5 was skipped for a regression. Docker `18.6-alpine` / `18-alpine` exist | pgPedia https://pgpedia.info/postgresql-versions/postgresql-18.html ; Docker Hub tags (verified) |
| Matching minors | 17.11, 16.15, 15.19, 14.24 (same 2026-08-13 release) | Docker Hub tags (verified) |
| Previous quarterly | 18.4/17.10/16.14 on 2026-05-14 (11 CVEs, tzdata 2026b) | https://postgresql.org/about/news/postgresql-184-1710-1614-1518-and-1423-released-3297 |
| Next quarterly | Nov 12 2026 (second Thursday), same day PG14 reaches EOL | same news item; https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/ |
| PostgreSQL 19 | **Not GA.** RC1 2026-10-15, RC2 2026-11-12, GA planned 2026-11-19 | https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/ |
| Support policy | 5 years from first release, then one last minor | https://www.instaclustr.com/education/postgresql/postgres-versions-supported-releases-eol-dates-upgrades/ |
| EOL 16 | Nov 2028 (derived: first release 2023-09-14, final release second Thursday of Nov = 2028-11-09) | derived from the policy |
| EOL 17 | Nov 2029 (derived: 2029-11-08) | derived |
| EOL 18 | Nov 2030 (Instaclustr lists November 2030; derived 2030-11-14) | Instaclustr link above |
| EOL 14 | 2026-11-12 | postgresql.org news item above |

I could not open postgresql.org/support/versioning; confirm the three derived EOL days there before putting them in a doc.

### Library compatibility (all checked on the npm registry or GitHub)

- **`pg`**: latest 8.23.1; repo range `^8.16.3`. node-postgres has no PG18-specific work in its changelog, and does not need any: it speaks protocol 3.0 and PG18 keeps 32-bit cancel keys for 3.0 clients (https://neon.com/postgresql/postgresql-18/security-improvements). 3.2 (variable-length cancel keys) is opt-in client-side and node-postgres does not advertise it; no action. Relevant releases: 8.14 SCRAM-SHA-256-PLUS (channel binding), 8.22 `sslnegotiation=direct` for PG17+, 8.23 query pipelining, 8.21 SCRAM error handling, 8.20 `onConnect` pool callback (https://raw.githubusercontent.com/brianc/node-postgres/master/CHANGELOG.md).
- **`drizzle-orm`** 0.45.4 / **`drizzle-kit`** 0.31.11 are the `latest` dist-tags. 1.0 is only on the `rc` tag (`1.0.0-rc.5`) and `beta`; **not stable, so LATER**. Drizzle emits plain SQL and introspects `pg_catalog`; I found no PG18 reports (search returned none), but the first `db:push` against an 18 database must be tried in CI (it already is: ci.yml's service container runs `ensureSchema`, and `db:push` is run by hand per the runbook).
- **`connect-pg-simple`** 10.0.0 (latest): plain `SELECT/INSERT ... ON CONFLICT` on the `session` table; no version-specific SQL.
- **`@socket.io/postgres-adapter`** is gone from the hot path (ADR-0014), so `LISTEN/NOTIFY` is no longer a dependency; check `grep -rn "LISTEN\|pg_notify" server` returns nothing in the repo today.

### Providers

| Host | Versions offered | Major upgrade | Source |
|---|---|---|---|
| **Render Postgres** | 18 (default for new), 17, 16, 15, 14, 13; 12/11 legacy | **In-place upgrade, GA since 2024-11-05**, always to the latest supported major (now 18), needs downtime (changelog: "usually less than one hour"); rehearse on a clone; or new DB + migrate to pick a version | https://render.com/docs/postgresql-upgrading ; https://render.com/changelog/postgresql-18-is-now-available-for-render-postgres-databases ; 17 added 2025-07-29 https://render.com/changelog/postgresql-17-is-now-available-for-render-postgres-databases (all **snippet**) |
| **Fly Managed Postgres** | 16 and 17 (`fly mpg create --pg-major-version`, default 16); PG17 shipped Jan 2026; **no PG18 found** | **No in-place upgrade**; create a new cluster and `pg_dump`/`pg_restore` | https://fly.io/docs/flyctl/mpg-create/ ; https://community.fly.io/t/you-asked-and-we-shipped-postgres-17-on-mpg/26430 ; https://docs.fly.io/postgres (**snippet**; may be stale, check `fly mpg create --help`) |
| Neon | 18 GA 2026-05-01, default for new projects | branch/new project | https://neon.com/docs/changelog/2026-05-01 |
| AWS RDS | 18.1+ (announced 2025-11-14, RDS 2025-12) | in-place major upgrade supported by RDS (not re-verified) | https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-rds-postgresql-major-version-18 |
| Supabase | not confirmed from official source | | |
| Google Cloud SQL | not found | | |

Render connection caps (the budget in `server/store/pool.ts` / `deploy/runtime.json` `pgConnectionsPerInstance: 15`): about 100 under 8 GB RAM, 200 at 8 GB, 300 at 16 GB (https://render.com/tutorials/postgres-on-render/connection-limits-and-pooling, snippet). `checkConnectionBudget` already compares against `SHOW max_connections`, so a smaller cap is detected, not assumed.

## 2. Breaking and behaviour changes 16 to 18 that could touch us

Sources: https://www.postgresql.org/docs/current/release-18.html (via search snippets), https://neon.com/postgresql/18-new-features, https://www.bytebase.com/blog/what-is-new-in-postgres-18/. Verified in repo where noted.

| Change | Touches us? | Action |
|---|---|---|
| **MD5 password auth deprecated** (warns on `CREATE/ALTER ROLE` with MD5; `md5_password_warnings`) | No. Docker image defaults to `scram-sha-256` (docker-library entrypoint comment: "default authentication method is md5 on versions before 14"); `pg` 8.14+ supports SCRAM and channel binding. Render roles are SCRAM. | None. CI/dev password `postgres` is created through the image's own initdb. |
| **initdb data checksums on by default** | Only new clusters (CI/dev containers, new Render DB). Small CPU/WAL cost, unmeasured. A pg_upgrade from a no-checksum 16 cluster needs matching settings (Render's in-place upgrade handles it; for a self-run pg_upgrade pass `--no-data-checksums` to the new cluster). | None for fresh DB. Worth knowing for the runbook. |
| **Docker image PGDATA moved** to `/var/lib/postgresql/18/docker`, `VOLUME /var/lib/postgresql` (was `/var/lib/postgresql/data`) | **No.** `scripts/dev-stack.mjs:259-264` runs the container with `-e`, `-p` and no `-v`/bind mount, and every workflow service container has none (`grep -rn "var/lib/postgresql\|PGDATA\|tmpfs" .github scripts tests deploy docs` = empty). Verified in https://raw.githubusercontent.com/docker-library/postgres/master/18/alpine3.24/Dockerfile lines 202-205. | None. Side note, same on 16: `docker rm -f` without `-v` (dev-stack.mjs:221,244,254,267) leaves the anonymous volume behind; adding `-v` is a tidy-up, not required. |
| **`pg_stat_activity` / `pg_stat_*` views** | Read: `pg_stat_activity` (pool.ts:222, gameOwnership.ts:152,210,215, tests). Columns used: `pid`, `application_name`, `backend_start` (STARTED). None renamed in 17/18. 17 moved checkpoint counters from `pg_stat_bgwriter` to `pg_stat_checkpointer`; 18 changed `pg_stat_io` byte columns and added vacuum-time columns to `pg_stat_all_tables`. **We read none of those** (`grep pg_stat` in server/ scripts/ shows only `pg_stat_activity`; the audit sims in `docs/research/2026-11-01-system-audit/sim` read `pg_stat_database`, unchanged). | None. |
| `pg_terminate_backend`, `pg_try_advisory_lock`/`pg_advisory_unlock` (gameOwnership.ts:215,256,278,440; schemaDdl.ts:567), `pg_blocking_pids` (tests/helpers/userLock.ts:37) | No semantic change in 17 or 18 that I found in the release notes. Session-level advisory locks still release on backend end. | Existing integration tests (ownershipReclaim, postgresRestart, takeoverSerialised) run against the new image in CI. |
| `LISTEN/NOTIFY` | Not used any more (ADR-0014). | None. |
| `CREATE INDEX CONCURRENTLY` (schemaDdl.ts:329-388, 586-607) | No change. PG17's `lock_timeout` interplay unchanged. | None. |
| Timeouts: `statement_timeout`, `idle_in_transaction_session_timeout`, `lock_timeout` unchanged; **new** `transaction_timeout` (17), `idle_replication_slot_timeout` (18) | Opt-in (section 3). | See ADOPT list. |
| **`io_method`** default `worker` (3 workers) in 18; `io_uring` Linux-only opt-in | Behaviour change but transparent. Render does not expose `io_method`. | None. |
| VACUUM/ANALYZE now recurse into inheritance children (use `ONLY`) | We have no inheritance or partitions (`shared/schema.ts`: plain `pgTable`s). | None. |
| Full-text / `pg_trgm` collation-provider change needing REINDEX after pg_upgrade | We use neither (`grep tsvector\|pg_trgm` empty; GIN indexes are `jsonb` default opclass, schema.ts:339,341). | None. |
| PG17 **MAINTAIN privilege / safe search_path for maintenance** (functional indexes, `lower(...)`) | Our expression indexes use `lower(col)` (schema.ts:28,34,43), a built-in; unaffected. | None. |
| `temp`-file/`random_page_cost`-style planner default changes | None relevant. | None. |
| Protocol 3.2 and cancel keys | `pg` stays on 3.0; no change. | None. |
| Test harness | `tests/server/backupDb.test.ts:216-219` **skips** when `pg_dump` major differs from server major, and CI greps for that skip (ci.yml:310-313). The runner is pinned to `ubuntu-24.04` only because it packages `postgresql-client-16` (ci.yml:243). | See section 5: with 18, move the pin to `ubuntu-26.04`, which packages `postgresql-client-18` natively (https://packages.ubuntu.com/tr/resolute/database/postgresql-client-18); or add the PGDG apt repo on 24.04. (Sources disagree on what `ubuntu-latest` is today: the runner-images README fetched on 2026-11-02 lists it as 24.04, while the ci.yml:243 comment says it moved to 26.04. Name `ubuntu-26.04` explicitly either way.) |
| `scripts/backup-db.mjs:41` error text says "Install a Postgres 16 client" | Stale string after the bump. | Edit message to derive from `deploy/runtime.json`. |

## 3. Feature survey

"Gain" is quantified only where a source gives numbers; otherwise "unmeasured". Verdicts: ADOPT, REJECT, LATER.

### 3a. PostgreSQL 17 and 18 (19 summarised at the end)

| Feature | What | Where it could help us (file:line) | Gain | Risk | Verdict |
|---|---|---|---|---|---|
| **Async I/O, `io_method=worker`/`io_uring`** (18) | Reads for seq scans, bitmap heap scans and VACUUM issue async. Docs/announcements claim up to ~3x faster reads on cold cache | Our workload is small hot rows read by PK (activeGameStore.ts:41-47), admin aggregates over `events`/`round_history` (admin.ts:68-210) on the 2-slot admin pool, and retention deletes (retention.ts:77). Data set fits in cache on the sizes we plan | **Unmeasured** for us; only cold large scans benefit. `io_method` is not tunable on Render | none | **ADOPT passively** (default `worker` comes with 18; no code). `io_uring`: REJECT (managed host, not settable) |
| **`MERGE ... RETURNING` + `merge_action()`** (17) | MERGE can return rows and say insert/update/delete | Our upserts are single-row `INSERT ... ON CONFLICT` with a fence: activeGameStore.ts:96-109 (`setWhere` epoch), stats.ts:71-96, ratings.ts:172-190, friendStore.ts:209-215, ticket.ts:91-94. `ON CONFLICT` is atomic and the right tool; MERGE under concurrency can raise unique violations instead of upserting, and has no `setWhere` equivalent | none | MERGE is not a concurrency-safe upsert; drizzle 0.45 has no MERGE builder | **REJECT** |
| **`RETURNING OLD`/`NEW`** (18) | UPDATE/INSERT/DELETE/MERGE can return the pre-image | activeGameStore.ts:49-56 `claim()` already returns the new epoch; old epoch (previous owner) would let the takeover log "took over from epoch N" in one statement. `write()` (96-109) returns only room_id; OLD null would tell insert vs update (the re-insert of a row an exempt writer deleted). `deleteAccount.ts:64-71` rewrites replay arrays | marginal; saves 0 round trips today (nothing reads the old value) | drizzle 0.45 `returning()` cannot express `old.col`; would be raw `sql` | **LATER** (no caller needs it) |
| **Virtual generated columns** (18, now the default) | Computed on read, not stored | `lower(username)` / `lower(email)` are done as expression indexes (schema.ts:28,34,43) and `lower(...)` inside queries (userStore.ts:41-81,123); `seatedUserIds` jsonb extraction (activeGameStore.ts:36-44). Virtual columns cannot be indexed in 18, and the expression index already covers the lookups | none | schema churn; drizzle 0.45 has `generatedAlwaysAs` for stored only | **REJECT** |
| **`uuidv7()`** (18) | Time-ordered UUID, `uuidv4()` alias for `gen_random_uuid()` | Id defaults are `gen_random_uuid()` on `varchar` PKs: schema.ts:10,59,82,103,140,190,236,257,280,303,324,409. Append-only, time-pruned tables (`events` 303, `round_history` 190, `round_replays` 324, `client_errors` 236, `server_errors` 257) would get an append-only PK b-tree and retention batches (retention.ts:77) that hit adjacent pages. Not for `users`/`rooms`/`auth_tokens`: those ids may be shown to clients or act as capabilities and v7 leaks creation time | unmeasured (published claims are about index locality; ask the benchmark agent to measure inserts into `events` with v4 vs v7) | **18-only** (locks out Fly MPG 17). `schemaDdl.ts` is additive `CREATE ... IF NOT EXISTS` (server/CLAUDE.md), so it will NOT change a default on an existing table; only works at greenfield, which is now. Default expression on a `varchar` needs a uuid-to-text assignment cast (works) | **ADOPT for the five telemetry/history tables at greenfield, conditional on the benchmark agent confirming a gain**; else LATER |
| **B-tree skip scan** (18) | Multicolumn index usable when leading column has no equality | `rooms_open_idx(visibility,status,gameMode,maxPlayers)` schema.ts:75 used by quick-match (roomStore.ts:339-356, friendStore.ts:233-251); `events_name_occurred_idx(name, occurred_at)` schema.ts:309 beside a separate `events_occurred_idx` (310) that exists to serve "last N days" without a name: with ~tens of distinct event names, skip scan could serve those from the first index and let us drop 310, removing one index of write amplification on the busiest insert path (D19 batch) | unmeasured | dropping an index is a risk if skip scan is not chosen on prod stats; retention deletes by `occurred_at` rely on it | **LATER**: test with `EXPLAIN` on the sims' seed after the bump, then decide to drop 310 |
| **Multi-value `IN`/`= ANY` b-tree improvements** (17) | fewer index descents for array/IN lists | `inArray(users.id, ids)` userLock.ts:16 (at most 4 seats), roomStore.ts:372 `inArray(rooms.id, ids)` | negligible at these sizes; automatic | none | **ADOPT passively** (free) |
| **`transaction_timeout`** (17) | Caps the whole transaction wall time, idle gaps included | pool.ts:8-12 documents that `shutdown.ts` derives its whole budget from `QUERY_TIMEOUT_MS` = one statement. `inTransaction()` (pool.ts:165-196) runs multi-statement transactions (round over: `lockUsers` + stats + ratings + history + replay, stats.ts:60-135, ratings.ts:172-190); per-statement 5 s and idle-in-tx 10 s (pool.ts:70-74) leave N x 5 s unbounded. `pg` sends `transaction_timeout` only via `options: "-c transaction_timeout=..."` (client.js:567 passes only `options`, `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout` as startup params) | turns "shutdown waits for the slowest multi-statement tx" into a hard bound | **17+ only**: on 16 an unknown startup param aborts the connection, so it must ship with the version bump, and the `ddl` and `ownership` profiles must NOT get it (CONCURRENTLY index builds are long, ownership holds session locks). Value must sit above the longest legit round-over tx | **ADOPT** on `app` and `admin` pools (admin 30 s statement cap suggests 35 s) |
| **`JSON_TABLE`, SQL/JSON constructors/query functions** (17) | `JSON_TABLE(...)`, `JSON_QUERY`, `JSON_VALUE`, `JSON_EXISTS` | `seatedUserIds` in activeGameStore.ts:36-44 is a `jsonb_each` + key regex + `order by seat.key::numeric` workaround for the playerMap; deleteAccount.ts:65 `jsonb_agg` rewrite of `seats`; roundHistoryView.ts:87, replays.ts:14 use `@>` with GIN (already optimal) | none; the current queries are correct and index-served (GIN `round_replays_player_ids_idx` schema.ts:339) | drizzle has no builder; the SQL is raw already. Rewriting a working, tested query for style | **REJECT** |
| **Incremental backup (`pg_basebackup --incremental`, `pg_combinebackup`)** (17) | block-level incrementals | Our backups are logical (`scripts/backup-db.mjs` = `pg_dump`, runbook "Backups"); on Render/Fly managed, physical backups are the provider's. Data is small (no accounts yet) | n/a | needs file-system access, which managed hosts do not give | **REJECT** (revisit only if self-hosting) |
| **Streaming I/O for seq scans/ANALYZE** (17) | read-stream API | same as async I/O: admin full scans | unmeasured | none | **ADOPT passively** |
| **Vacuum memory (TidStore, 17)** | `autovacuum` no longer limited to 1 GB for dead-tuple array, lower memory | `active_games` churns an envelope row on every move, `events` etc. Our tables are small; effect is on very large tables | unmeasured, near zero at our size | none | **ADOPT passively** |
| **`COPY ... ON_ERROR`, faster COPY** (17/18) | skip bad rows | telemetry is batched `INSERT ... VALUES` (D19, events). No `COPY` anywhere (`grep -rn "COPY" server` empty) | none | `pg` has no COPY without `pg-copy-streams` | **REJECT** |
| **`pg_stat_io`, `pg_stat_checkpointer`** (16/17) | I/O and checkpoint stats | Our `/metrics` (health.ts) exposes pool meters and `pg_connection_headroom` only; managed hosts show their own dashboards | n/a | none | **LATER** (only if we self-host) |
| **Logical replication failover slots (17), `idle_replication_slot_timeout` (18), logical-replication conflict logging** | | We run no replicas or slots (no `CREATE PUBLICATION/SLOT` in repo) | none | | **REJECT** |
| **OAuth authentication (18)** | server-side OAuth validators for login | We authenticate to Postgres with a password in `DATABASE_URL`; Render does not expose it | none | | **REJECT** |
| **`NOT NULL` as NOT VALID; temporal constraints `WITHOUT OVERLAPS`, `PERIOD`; `NOT ENFORCED` constraints (18)** | schema features | We have no ranges or periods. `ADD CONSTRAINT ... NOT VALID` for NOT NULL would help adding a NOT NULL to a large live table without a full scan lock; schemaDdl.ts is additive-only and never adds NOT NULL to an existing column | none now | | **REJECT** (LATER if a "tighten a column" change appears) |
| **`EXPLAIN (ANALYZE)` shows BUFFERS by default (18)** | | Used by hand only (audit `sim/explain.sql`). | convenience | | **ADOPT passively** |
| **`pg_upgrade` retains planner stats, `--swap`, `--jobs` improvements (18)** | faster, no post-upgrade ANALYZE | Applies only to a self-run upgrade; Render's in-place is theirs | n/a | | **ADOPT passively** (runbook note) |
| **Protocol 3.2 / larger cancel keys (18)** | | `pg` uses 3.0; `query_timeout`/`statement_timeout` handle cancel server-side | none | | **REJECT** (nothing to do; node-postgres has no 3.2 option) |
| **Self-join elimination, `OR`-to-`ANY` planner rewrite (18)** | planner | `userLock` and `roomStore` joins are not self-joins; OR lists are few | negligible | | **ADOPT passively** |
| **`array_sort`, `array_reverse` (19?), `casefold()` (18)** | `casefold(text)` is Unicode case folding | **userStore.ts:41-81,123 and schema.ts:28,34,43**: `lower(username)` / `lower(email)` unique indexes decide account identity. Albanian names contain `e` with diaeresis (ë) and ç, where `lower()` and casefold agree; casefold differs only for characters like German ß or Greek final sigma. Changing the index function re-keys account uniqueness | marginal | Changing identity semantics of existing rows; needs `DEDUPE_ON_BOOT` care | **REJECT** |
| **`gen_random_uuid()`** | built in since 13 | already used (schema.ts:10 etc.) | | | already done |
| **`pg_stat_statements`** (extension, since long) | per-statement timings | not enabled by us; Render docs list it among supported extensions but needs preload, snippet-level only | operational visibility | needs host config | **LATER** (ask Render to confirm; see 3b) |

### 3b. Features of the current version (16) we are not using, or already do

| Feature | Already done? | Evidence | Verdict |
|---|---|---|---|
| `application_name` per pool | **Yes** | pool.ts:19-24, 61-62, 132: `murlan-<profile>`; also used to count budget (pool.ts:221-224) | done |
| `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`, TCP keepalives, `maxLifetimeSeconds` | **Yes** | pool.ts:26-120, gameOwnership.ts:140-150 | done |
| `idle_session_timeout` (14+) | No | pools already recycle at 30 min and idle 30 s client-side (pool.ts:30,40,73) | REJECT (would kill the ownership session that must live across idle periods) |
| `jsonb` not `json` | **Yes** | schema.ts:168,197,244,261,307,329-334 all `jsonb` | done |
| Partial / covering indexes | Partial yes (friends_accepted_uq, email-verified unique, schema.ts:34,115-121); no `INCLUDE` anywhere | `round_history_user_idx(user_id, finished_at)` schema.ts:222 already serves the prune query; BRIN on `finished_at` (225) | LATER, only per measured query |
| **`FILLFACTOR` + HOT for `active_games`** | **No** | schema.ts:166-172: row is updated every move (`write()` activeGameStore.ts:96-109) and carries `game_state jsonb`, `updated_at`, `owner_epoch`; the only index is the PK on `room_id`, so every update is HOT-eligible, but at default fillfactor 100 a full page forces non-HOT updates. Drizzle `pgTable` has no table option for it; it would be `ALTER TABLE active_games SET (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.01)` added to schemaDdl.ts as an idempotent statement | Check first: `SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE relname='active_games'` on the live DB. If HOT ratio is low, **ADOPT** (cheap, idempotent). Caveat: envelopes over about 2 KB are TOASTed, and the TOAST table is rewritten on every update regardless; so the gain is bounded |
| `UNLOGGED` for ephemeral tables | No | candidates: `socket_ticket_nonces` (schema.ts:383-387, single-use, expiring) and `active_games`. UNLOGGED tables are truncated on crash recovery, which for `active_games` loses live tables (ADR-0014 says Postgres is the record of live tables) and is not replicated to standbys | `socket_ticket_nonces`: LATER (nonce loss on crash re-opens ticket replay inside its TTL; nonces are Redis-able); `active_games`: **REJECT** |
| Named/prepared statements in `pg` | No. `pg` unnamed extended protocol; drizzle node-postgres uses parameterised unnamed queries | Named statements pay off only for hot repeated queries and break behind transaction-mode poolers (Render has none; cluster uses direct connections) | LATER, measure first (hot path no longer touches Postgres per move per ADR-0014) |
| Pipeline mode | No | `pg` 8.23.0 "Add support for query pipelining" (CHANGELOG). Candidate: roundOver's per-seat loops (stats.ts:60-135, ratings.ts:172-190) - but ADR-0014 decision 1 already calls for **multi-row statements**, which beat pipelining and need no new driver feature. Note the code still loops per seat; the multi-row version is unlanded | **REJECT** pipelining in favour of the ADR's multi-row statements (bump `pg` to latest in the npm-deps agent's pass) |
| `pg_stat_statements` / `log_min_duration_statement` / `auto_explain` | No | no occurrence in repo | LATER; depends on the host exposing them |
| Boot DDL under advisory lock with `CREATE INDEX CONCURRENTLY` | **Yes** | schemaDdl.ts:329,558-607 | done |
| Retention batching by `ctid` | **Yes** | retention.ts:77 | done (PG14+ TID scans, still valid on 18) |

### 3c. PostgreSQL 19 (RC1, not usable yet)

From the RC1 coverage (https://www.devart.com/blog/postgresql-19-release.html, https://www.linuxcompatible.org/story/postgresql-19-rc1-released-native-repack-parallel-autovacuum-and-upgrades-to-watch/): `REPACK ... CONCURRENTLY` (online table rebuild; useful for bloated `active_games` if HOT fails), parallel autovacuum, `WAIT FOR LSN`, logical replication of sequences, `io_method=worker` auto-scaling (`io_min_workers`/`io_max_workers`), JIT off by default. **LATER**: revisit at 19.1 with a host offering it. These are reported by third parties; read the official 19 release notes when GA.

## 4. Upgrade path and runbook

### Render
- **In place**: Dashboard, database Info page, click the current version, then upgrade. Always goes to the latest major Render supports (18 today), requires downtime ("usually less than one hour"), and Render recommends rehearsing on a clone. Docs: https://render.com/docs/postgresql-upgrading (snippet). Changelog for 18: https://render.com/changelog/postgresql-18-is-now-available-for-render-postgres-databases.
- **New database + migrate**: pick any supported major at creation, `pg_dump` old, `pg_restore` new, flip `DATABASE_URL`. Use this when you want a version other than latest.
- For us today (no real accounts): create the database as 18, boot the server so `schemaDdl.ts` builds the schema, done. Nothing to migrate.

### Fly Managed Postgres
No in-place major upgrade: create a new cluster (`fly mpg create --pg-major-version 17`) and `pg_dump | pg_restore` (https://docs.fly.io/postgres, snippet). PG18 not offered as of the snippets I could read.

### Our runbook for a future major move (to add to `docs/DEPLOY-RUNBOOK.md`)
Add a section **"Moving Postgres to a new major"**, between "Before a destructive schema change" (line 10) and "Rolling back" (line 81), and fill the Render/Fly specifics into "Host-specific steps" (line 242, pending #1107). Steps:

1. Bump `deploy/runtime.json` `postgres` and the image pins (section 5) in one PR; CI proves the suites on the new major (`tests/tooling/postgresMajor.test.ts` forces every workflow and client to match).
2. `npm run db:backup` (`pg_dump` per server/CLAUDE.md) with a client of the **target** major (a dump is only portable forward; `tests/server/backupDb.test.ts:216` skips on a mismatch). Check it restores (`backupDb.test.ts` is the proof).
3. Rehearse: clone/restore the dump into a database of the new major, run `ensureSchema()` (boot the server against it; everything is idempotent) and `/health/ready`.
4. **`session` table**: it is created by `connect-pg-simple` (`createTableIfMissing: false`, absent from `shared/schema.ts`, excluded by drizzle-kit `tablesFilter: ["!session"]`, drizzle.config.ts:21). A `pg_dump` of the whole database carries it, but a dump built from drizzle's schema would not. On the new database either restore it with the dump, or accept that every user is signed out and create it from connect-pg-simple's `table.sql` before first traffic; **never drop it while the server runs** (server/CLAUDE.md). `socket.ts/ticket.ts:97` reads `session` directly, so a missing table breaks sockets.
5. Maintenance window: stop writes (scale the service to 0 or hold `/health/ready` with traffic drained), take the final dump, restore (or Render in-place), `ANALYZE` (not needed after in-place pg_upgrade on 18+, stats are kept), start one instance first, then the rest. `schemaDdl.ts` runs additive DDL at boot under `pg_try_advisory_lock` (schemaDdl.ts:558-572), so concurrent instances serialise.
6. Verify: `pg_connection_headroom` metric non-negative (D13), `SELECT version()`, a smoke login, and a replay read.
7. Rollback = the pre-move dump restored to the old major's database, which you must **keep running** until the new one has served a day. A new-major dump cannot restore into an older major.

## 5. Exact pin and files to change

Docker Hub (first-hand, `curl https://hub.docker.com/v2/repositories/library/postgres/tags/<tag>`, 2026-11-02):

| Tag | Index digest | amd64 | arm64 |
|---|---|---|---|
| `18-alpine` (= `18.6-alpine`, alpine3.24, pushed 2026-10-26) | `sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5` | `sha256:3b0ef735388b...` | `sha256:b1c1673a890f...` |
| `17-alpine` (17.11) | `sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b` | | |
| `16-alpine` (16.15) | `sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab` (repo currently pins the older `721873c3...`) | | |

Caution: `18.6-alpine` and `18-alpine` carry alpine3.24; the tag `18.6-alpine3.23` also exists. Pin the digest above; the existing tests require `tag@sha256:<digest>` (postgresImage.test.ts `assert.match(image, /^[^@]+:[\w.-]+@sha256:[0-9a-f]{64}$/)`).

**Pinned string for the recommended version:**

```
mirror.gcr.io/library/postgres:18-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5
```

(Verified: `mirror.gcr.io/v2/library/postgres/manifests/sha256:10a5c69a...` answers HTTP 200 on 2026-11-02, so the mirror has this digest. The repo's comment says the mirror serves "the same digest" as Docker Hub, but a freshly pushed tag can lag. If it lags, pin the previous digest or wait. `18.4-alpine` digest `sha256:9a8afca54e78...` exists but is two quarterly releases behind and misses the CVE fixes: do not use.)

Do not use a bare tag `18-alpine` without digest, and note `postgresMajor.test.ts` regex requires `postgres:<major>-alpine`, i.e. the digest form with `-alpine` in the tag, not `18.6-alpine`. Use `18-alpine@sha256:...`.

### Files that must change (from `grep -rn "postgres:16\|\"postgres\": *16\|postgresql-client-16"`)
1. `deploy/runtime.json:3` `"postgres": 16` to `18`. Read by `tests/tooling/postgresMajor.test.ts`, `tests/server/deployRuntime.test.ts`, `shutdownBudget.test.ts`, `cors.test.ts`.
2. `scripts/dev-stack.mjs:30` `IMAGE` (the single source `tests/tooling/postgresImage.test.ts` compares every workflow to).
3. `.github/workflows/ci.yml:254` (verify job service) and `:885` (build job service).
4. `.github/workflows/soak.yml:41`.
5. `.github/workflows/mutation.yml:45`.
6. `.github/workflows/ci.yml:243` (comment + `runs-on: ubuntu-24.04` pin), `:292` (`postgresql-client-16`), `:311` (error text). Either (a) move the pin to `ubuntu-26.04` (it ships `postgresql-client-18`; name it rather than `ubuntu-latest`, whose meaning the sources disagree on) and install `postgresql-client-18`, or (b) keep 24.04 and add the PGDG apt repository first. Option (a) keeps one apt line. `postgresMajor.test.ts` greps `apt-get install[^\n]*postgresql-client-(\d+)` and requires it equal the manifest.
7. `scripts/backup-db.mjs:41`: message "Install a Postgres 16 client" (make it read the manifest).
8. `tests/tooling/devStackPort.test.ts:110` and `tests/tooling/noDockerHubPulls.test.ts:252-332`: these use `postgres:16*` only as string fixtures for the Docker Hub scanner. They pass unchanged; update only if you want consistency. They need no edit.
9. Docs: `server/CLAUDE.md` mentions Postgres generally (no version); ADR-0014 says "measured ... on Postgres 16" (historical, leave); `docs/DEPLOY-RUNBOOK.md` new section (section 4 above); `docs/research/2026-11-01-system-audit/*` is dated history, leave.
10. Optional with the bump, per ADOPT list: `server/store/pool.ts` (add `options: "-c transaction_timeout=..."` to `app` and `admin` profiles only; add a test that `ddl`/`ownership` have none), `shared/schema.ts` (uuidv7 default on the five append-only tables, only after the benchmark agent confirms), `server/store/schemaDdl.ts` (fillfactor statement, only after the HOT ratio check).

No change needed for: `package.json` DB libraries (all current; `pg` could move to `^8.23.1` in the npm-deps pass), `drizzle.config.ts`, `docker rm` paths, volumes.

## 6. Verdict summary

ADOPT: PG 18.6 as the pinned major; `transaction_timeout` on app/admin pools (bounds shutdown on multi-statement round-over transactions); passive wins (async I/O default, streaming I/O, IN/ANY b-tree, vacuum memory, planner, EXPLAIN buffers, pg_upgrade stats); `uuidv7()` on the append-only tables if benchmark-confirmed; `active_games` fillfactor if the live HOT ratio is poor.
LATER: skip scan to drop `events_occurred_idx`, RETURNING OLD/NEW, pg_stat_statements, named statements, drizzle 1.0 (rc only), PG 19 (GA 2026-11-19), UNLOGGED nonces, `REPACK` (19).
REJECT: MERGE for upserts, virtual generated columns, JSON_TABLE rewrite, incremental backup, COPY, failover slots, temporal/NOT ENFORCED constraints, casefold, protocol 3.2, `io_uring`, `idle_session_timeout`, UNLOGGED `active_games`, pipelining, and the OAuth sign-in of 18.
