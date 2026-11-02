# Postgres 19 for #1911 (research, 2026-11-02)

Supersedes the "do not adopt 19 now" verdict in `postgres.md`. Owner's rule: production and CI go
Postgres 16 to 19; every 17/18/19 built-in that does a job better than our code is adopted and our
code deleted. Read-only on the repo; nothing was run against a 19 server and nothing benchmarked.

Network: `www.postgresql.org`, `registry.hub.docker.com`, `apt.postgresql.org`, `github.com` (HTML)
were blocked (403 / DNS). First-hand sources used instead: `hub.docker.com/v2` (works), `mirror.gcr.io`,
`archive.ubuntu.com`, and `raw.githubusercontent.com` for **the PostgreSQL source tree itself**
(`REL_19_STABLE`, `REL_18_STABLE`, `REL_17_STABLE`: release-notes SGML, `gram.y`, `pg_proc.dat`,
`guc_parameters.dat`, `errcodes.txt`). That is the official release notes in source form, not a blog.
Caveat: the 19 notes in the tree are headed `AS OF 2026-10-09`, so items changed after that date
(including between RC1 and GA) are **[unverified]**.

## 1. Version facts

### 1.1 Status of 19

| Fact | Value | Source |
|---|---|---|
| Current state | **RC1, released 2026-10-15. Not GA.** `configure.ac` on `REL_19_STABLE` reads `19rc1` | https://raw.githubusercontent.com/postgres/postgres/REL_19_STABLE/configure.ac ; https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/ (URL from `postgres.md`, page itself not reachable today) |
| RC2 | planned 2026-11-12 (same day as the quarterly minors) | `postgres.md` section 1, from the RC1 announcement. **[unverified today]** |
| GA | planned **2026-11-19** (17 days from today) | same. **[unverified today]**; a Japanese RDS write-up repeats it: https://dev.classmethod.jp/articles/rds-preview-postgresql-19-rc1/ |
| Betas | beta1 2026-06-04, beta4 2026-09-24 | https://www.postgresql.org/about/news/postgresql-19-beta-1-released-3313/ ; https://www.postgresql.org/about/news/postgresql-19-beta-4-released-3386/ |
| Reverted before RC (search-result summary of the beta4 news, page not reachable) | online data-checksum toggling, `FOR PORTION OF` (temporal UPDATE/DELETE), partition MERGE/SPLIT, **SQL/PGQ graph queries** | beta4 URL above. **Corroborated first-hand**: `gram.y` on `REL_19_STABLE` has no `PORTION`, no `GRAPH_TABLE`; the notes list none of them. So the owner's candidates `FOR PORTION OF` and graph queries are **not in 19** |
| Release notes read | https://raw.githubusercontent.com/postgres/postgres/REL_19_STABLE/doc/src/sgml/release-19.sgml (3,968 lines, section 2 below) ; rendered form would be https://www.postgresql.org/docs/19/release-19.html (**not reachable**) | |
| 18 / 17 notes | https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/doc/src/sgml/release-18.sgml ; `.../REL_17_STABLE/doc/src/sgml/release-17.sgml` | |
| Support | 5 years from first release: 19 until Nov 2031 (derived, not read) | policy as in `postgres.md` |

### 1.2 Docker images (hub.docker.com v2 API, 2026-11-02)

Query: https://hub.docker.com/v2/repositories/library/postgres/tags?name=19&page_size=50 (the
`registry.hub.docker.com` host from the brief is blocked; same data).

| Tag | Index digest | Pushed |
|---|---|---|
| **`19rc1-alpine`** = `19rc1-alpine3.24` (newest 19 alpine) | `sha256:a3095ec8782b77587ca34006edaf09df362212351745069cb7758e256ecd488f` (amd64 `sha256:d9da2cdfda29f62a8da0363b8a663431f5b12fcab6c80673bc9768fa3abc2cf6`, arm64 `sha256:10a125ee6067fdfdcb6efed797d88ace5681b8e0dc94535f5c9fcf6fb93c39b3`) | 2026-10-26 |
| `19rc1-alpine3.23` | `sha256:bd175f13ba3bb5842a84595f48168a17845dfd9edb152fbc99494a6b1fd579ed` | 2026-10-26 |
| `19rc1` / `19rc1-trixie` (Debian) | `sha256:a4193f06aaf4cf10140225461dea49cf0d65a885221a07a90a9d410cdf469d7b` | 2026-11-01 |
| `19beta4-alpine` | `sha256:36ee1d77445129d0524274cc105b85a0a5f53782e4d22852788937d1ef1400b8` | 2026-09-29 |
| **`19-alpine`, `19.0-alpine`** | **do not exist** (no 19 tag without `beta`/`rc`; `mirror.gcr.io/.../manifests/19-alpine` = 404) | |

`mirror.gcr.io/v2/library/postgres/manifests/19rc1-alpine` answers 200 and its `docker-content-digest`
is exactly the Docker Hub digest above, and the by-digest manifest also answers 200. So the
repo's `mirror.gcr.io/library/postgres:<tag>@sha256:<digest>` pin form works for the RC today.

Consequence for the repo's own guards: `tests/tooling/postgresMajor.test.ts` and `postgresImage.test.ts`
match `postgres:(\d+)-alpine`, so **`19rc1-alpine` fails them by construction** (correctly: an RC is
not a pin). The pin that satisfies them is `19-alpine@sha256:...`, which Docker publishes at GA. Also
`tests/server/backupDb.test.ts:57,66` parse `19rc1` badly (`/(\d+)\./` finds no match so the client major is
`null` and the skip guard is bypassed; `"19rc1".split(".")[0]` is `NaN` server-side). Both parse fine at `19.0`.
Plan: land the 19 migration PR when `19-alpine` exists (2026-11-19 or just after), not on the RC.

### 1.3 `pg_dump` 19 on the CI runner

Checked `archive.ubuntu.com` Packages indexes (main + universe, release and `-updates` pockets) today:

| Suite | `postgresql-client-*` present | 19? |
|---|---|---|
| noble (24.04) | 16 (16.15 in `-updates`) | **no** |
| resolute (26.04) | 18 (18.6 in `-updates`) | **no** |

Runner images: `ubuntu-24.04` and `ubuntu-26.04` both exist (https://raw.githubusercontent.com/actions/runner-images/main/README.md;
`ubuntu-latest` = 24.04 there, which contradicts the `ci.yml:243` comment). Ubuntu will not carry 19 in a
stable pocket (Debian/Ubuntu ship one major per release). So `ci.yml:291-292` must use the **PGDG apt
repository** (`apt.postgresql.org`, `postgresql-client-19`) on whichever runner. Evidence PGDG builds 19:
docker-library's `versions.json` pins `19~rc1-1.pgdg13+1` / `19~rc1-1.pgdg12+1` (https://raw.githubusercontent.com/docker-library/postgres/master/versions.json)
for trixie/bookworm. That `noble-pgdg` / `resolute-pgdg` carry `postgresql-client-19`, and (before GA) under which
component, is **[unverified]**: `apt.postgresql.org` is blocked here. Add a step that adds the PGDG key and sources
list, keeps the existing `apt-get install ... postgresql-client-19` line (the `postgresMajor.test.ts` regex needs it), and keeps the
fail-on-skip grep at `ci.yml:310-313`. The `ubuntu-24.04` pin comment at `ci.yml:243` then goes: PGDG makes
the runner image irrelevant, so `ubuntu-latest` can come back [your call; the pin was there only for the distro package].

### 1.4 Hosts offering 19 (searched today; no host's own page was reachable)

| Host | 19 status | Evidence |
|---|---|---|
| AWS RDS | **Preview environment only** (beta1 announced 2026-06-08; RC1 `19.20261015` in us-east-2 preview, 60-day instances). Not production | https://aws.amazon.com/about-aws/whats-new/2026/06/postgresql-19-beta-1-amazon-rds-database-preview-environment ; https://dev.classmethod.jp/articles/rds-preview-postgresql-19-rc1/ |
| Render Postgres | none found; offers 13-18 (18 default) | search found no changelog; `postgres.md` section 1 |
| Fly.io | none found; Managed Postgres offers 16 and 17 only | `postgres.md` |
| Neon | none found; 18 GA 2026-05-01 | https://neon.com/docs/changelog/2026-05-01 |
| Supabase, Crunchy Bridge, DigitalOcean | none found, no announcement | searches returned nothing |

Past lag for a new major to reach a host (from `postgres.md`): RDS and Render about 7 weeks after GA, Neon about 7 months.
**Decision-relevant risk for the owner**: on 2026-11-19 there is no managed host for 19. Production on 19 means either
waiting for Render (expect roughly January 2027 **[inference from the 18 lag, unverified]**) or self-running
`postgres:19-alpine` with its own backups, TLS and upgrades. That conflicts with `server/CLAUDE.md`'s "`sslmode`
required, `pg_dump` runbook" assumptions only in who operates it, not in code. #1107 (host choice) now gates production, not CI/dev.

## 2. What 19 contains (official notes, filtered to what could touch an OLTP web app)

Everything else in the notes (replication, FDW, OAuth validators, platform/build, psql, libpq OAuth) is in
the appendix list at the end of this section by name only.

| Area | Item (verbatim names) | Relevant? |
|---|---|---|
| Incompatibilities | MD5 login now **warns** (`md5_password_warnings`); `password_expiration_warning_threshold`; RADIUS removed; **`standard_conforming_strings` forced on** (`escape_string_warning` removed); CR/LF banned in db/role names; `json_array()` of no rows returns `[]` not NULL; `max_locks_per_transaction` 64 to 128; **`io_workers` removed** (replaced by `io_min_workers`, `io_max_workers`, `io_worker_idle_timeout`, `io_worker_launch_interval`); **JIT off by default**; wait events renamed (`BUFFERPIN` to `BUFFER`); full-text/`pg_trgm` classification uses the DB locale provider; `MULE_INTERNAL` removed | section 4 |
| Query | **`INSERT ... ON CONFLICT DO SELECT ... RETURNING`** (optionally `FOR UPDATE/SHARE`); **`IGNORE NULLS` / `RESPECT NULLS`** for `lead lag first_value last_value nth_value`; GROUP BY may reference target-list subqueries | rows in 3.3 |
| Utility | **`REPACK`** (replaces `VACUUM FULL` + `CLUSTER`), **`REPACK (CONCURRENTLY)`** without access-exclusive lock (`max_repack_replication_slots`); `GRANTED BY`; `CHECKPOINT (MODE, FLUSH_UNLOGGED)` | 3.3 |
| Constraints | `ALTER CONSTRAINT ... [NOT] ENFORCED` now also for CHECK; `SET EXPRESSION` on virtual columns with CHECK | 3.3 |
| COPY | `ON_ERROR SET_NULL`; multi-line header skip; `COPY TO` JSON (`FORCE_ARRAY`); `COPY TO` partitioned tables; SIMD text/CSV `COPY FROM` | we use no COPY |
| Types/functions | `oid8`; jsonpath string methods (`ltrim rtrim btrim lower upper initcap replace split_part`); **bytea<->uuid casts**; `regdatabase`; `tid_block/tid_offset`; **`random(min,max)` for date/timestamp/timestamptz** (the integer/numeric form is 17); `base64url`/`base32hex` in `encode/decode`; `range_minus_multi`; **`error_on_null()`**; `IS JSON` on domains; new stemmers | 3.3 |
| Optimizer | `NOT IN` to anti join when no NULLs; more LEFT to ANTI joins; Memoize for anti joins; aggregate pushdown before joins; many constant-folding simplifications; planner stats for boolean functions; extended stats on virtual columns; **faster foreign-key checks**; radix sort; parallel TID range scan; row-deformation speedup; faster UTF-8 case folding | passive |
| Storage/maintenance | **parallel autovacuum** (`autovacuum_max_parallel_workers`, per-table `autovacuum_parallel_workers`); **autovacuum scoring** (`autovacuum_*_score_weight`, view `pg_stat_autovacuum_scores`); scans mark pages all-visible; **default TOAST compression `pglz` to `lz4`**; `wal_compression=on` picks best method; `NOTIFY` wakes only listeners; `io_method=worker` auto-scales; AIO read-ahead scheduling | passive |
| Observability | `pg_stat_lock`, `pg_stat_recovery`, `pg_stat_progress_repack`, `pg_stat_autovacuum_scores`; `started_by` in progress views; `stats_reset` on table/index views; FPI bytes in `pg_stat_wal`/`VACUUM`/`EXPLAIN (WAL)`; `EXPLAIN (IO)`; Memoize estimates; **`log_lock_waits` on by default**; `log_autoanalyze_min_duration`; `log_min_messages` per process type; wraparound warning at 100M (was 40M); `auto_explain.log_io` | passive / 3.3 |
| Extensions | `pg_plan_advice`, `pg_stash_advice` (planner hints); `pg_stat_statements`: FETCH sizes folded, **generic/custom plan counts**; `pg_buffercache` additions | 3.3 |
| Server apps | `pg_dump` includes extended statistics; `vacuumdb --dry-run`, `--analyze-only` covers partitioned tables; `pg_upgrade` faster large-object metadata; `pgbench --continue-on-error` | `pg_dump` row in 4 |
| Replication | `WAIT FOR LSN` (read-your-writes on standbys); logical replication of sequences; `wal_level=replica` auto-enables logical (`effective_wal_level`); `retain_dead_tuples`; `EXCEPT` in publications | we run none |
| Security | server-side **SNI** (`pg_hosts.conf`); OAuth validator extras | no |

Not in 19 (verified absent from `REL_19_STABLE` grammar/notes): `FOR PORTION OF`, graph queries (`GRAPH_TABLE`),
a DuckDB-style `GROUP BY ALL` (`select.sgml` only has `GROUP BY [ALL | DISTINCT]` as the set quantifier),
online checksum toggle.

Appendix, named only: `pg_createsubscriber` options, `postgres_fdw` stats import and READ ONLY propagation,
`file_fdw` headers, psql prompt/`\pset display_true`, libpq `oauth_ca_file`/`PGOAUTHDEBUG`, `PQgetThreadLock`,
`ShmemRequestStruct`, AIX/MSVC/C11/Meson changes, Unicode 17, GB18030-2022, 64-bit multixact members, event
triggers in PL/Python, `pg_verifybackup`/`pg_waldump` reading tar WAL.

## 3. Re-judging every candidate against the code

Rule applied: a feature is ADOPT when it deletes or simplifies code that exists, or fixes a gap the
code has; REJECT when there is nothing for it to replace or when it would break a correctness invariant
(and I say which). "Nothing calls for it" is a REJECT, not a LATER: the owner asked for adoption, not a watch list.
Drizzle 0.45.4 and `pg` 8.23.1 were inspected in their npm tarballs: drizzle has **no** builder for `uuidv7`,
`MERGE`, `ON CONFLICT DO SELECT`, `RETURNING OLD/NEW`, virtual generated columns (`generatedAlwaysAs` is the
stored form), `WITHOUT OVERLAPS`, `NOT ENFORCED`; it has `uuid().defaultRandom()` (emits `gen_random_uuid()`).
Everything below needing those is `sql\`\`` (as `shared/schema.ts` already does for defaults) or raw `execute`.
1.0 is only on the `rc` tag (`1.0.0-rc.5`), so unchanged by this.

### 3.1 ADOPT

| # | Feature | Release | Replaces / changes (file:line) | Reason | Drizzle / pg |
|---|---|---|---|---|---|
| A1 | **`transaction_timeout`** | 17 | adds a bound the code lacks. `server/store/pool.ts:36-43` (`app`), `:49-57` (`admin`): add `options: "-c transaction_timeout=<ms>"`; **not** `ddl` (`:58-61`, concurrent index builds) nor `ownership` (`:48`, session locks). `server/game/roundResults.ts:160-169` `TRANSIENT_CODES`: add `"25P04"` (verified in `errcodes.txt`: `ERRCODE_TRANSACTION_TIMEOUT`) so a timed-out commit is retried like `57014`. `pool.ts:8-12` comment/`shutdown.ts` budget: a transaction, not only a statement, is now bounded | `statement_timeout` 5 s + `idle_in_transaction` 10 s (`pool.ts:75`) leave an N-statement transaction (round-over runs `lockUsers` + ratings + stats + history + trim + achievements + replay + clear, `roundResults.ts:44-146`) unbounded, and `shutdown.ts` derives its whole budget from one statement. Value must exceed the longest legitimate round-over (suggest 15 s on `app`, 35 s on `admin`) | `pg` 8.23.1 forwards only `options`, `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout` as startup params (`lib/client.js:564-568`), so it must go via `options`. Unknown-parameter abort on 16 is moot now |
| A2 | **Native `uuid` type for every id and foreign key** (not new in 17-19, but the migration is free only now) | 13+ | `shared/schema.ts`: `varchar("id")`/`varchar("user_id")`... (lines 10, 59, 82-83, 103, 140-141, 193, 239, 260, 283, 306, 327, 412 and every FK) become `uuid(...)`; `activeGames.roomId` (`:167`) and `roundReplays.roomId` (`:~330`) `text` to `uuid` too, or `activeGames.roomId = rooms.id` (`retention.ts:~104`, `roomStore.ts:~290`) stops type-checking in SQL. `schemaDdl.ts` needs no new code (renders columns from drizzle) | 16 bytes vs ~37 per key in every PK, FK and index (about 25 indexes carry an id); malformed ids rejected by the type. Fresh database, so no retype migration (`schemaDdl.ts` is additive and could not retype) | drizzle `uuid()`. **Blast radius**: 188 hand-written non-uuid ids in `tests/server` + `tests/integration` (regex count, rough); any client-supplied id reaching a uuid comparison (`acceptFriend(id, ...)` `friendStore.ts:~125`, rooms by id) now raises `22P02` instead of "no rows", so inputs must be validated at the HTTP/socket schema (`shared/httpSchemas.ts`). Do it as its own ticket directly after the 19 bump, in the same empty-database window |
| A3 | **`uuidv7()`** | 18 | `shared/schema.ts` defaults `gen_random_uuid()` to `uuidv7()` on **append-only, time-pruned or never-exposed** tables: `round_history` (`:193`), `round_replays` (`:327`), `client_errors` (`:239`), `server_errors` (`:260`), `bug_reports` (`:283`), `events` (`:306`), `auth_tokens` (`:412`), `game_invites` (`:140`), `room_players` (`:82`). Keep `gen_random_uuid()` on `users` (`:10`) and `rooms` (`:59`) and `friends` (`:103`): their ids reach clients and a v7 id discloses the creation time of an account/room | monotonic PK b-tree appends and adjacent-page retention deletes (`retention.ts:~74` `deleteInBatches` by `ctid` after age). Gain unmeasured; there is no cost | needs `sql\`uuidv7()\``; `formatDefaultClause` (`schemaDdl.ts:~38-60`) already renders raw SQL defaults. Also gives `uuid_extract_timestamp(id)` for free, not needed |
| A4 | **Skip scan: drop redundant leading-column-less indexes** | 18 | drop `events_occurred_idx` (`schema.ts:~315`): `events_name_occurred_idx(name, occurred_at)` serves `occurred_at < cutoff` retention (`retention.ts:~144`) and the funnel (`server/shared/events.ts:75-82`) because `name` is a closed set of **7** values (`shared/events.ts:12-20`), the ideal skip-scan shape. Drop `rooms_status_idx` (`:74`) for the same reason against `rooms_open_idx(visibility,status,...)` (`:75`, 2 visibility values). Tests to edit: `tests/server/schemaDdl.test.ts:78-98,239`, `tests/integration/schemaConcurrency.test.ts:68-80` (they use `events_occurred_idx` as their fixture index; re-point to another) | one index fewer on the busiest insert path (batches of 200, `telemetryBatch.ts`) and one fewer on every room status write. Gate: an `EXPLAIN` assertion in an integration test that the retention predicate and the funnel use `events_name_occurred_idx` on seeded data (cheap, and a regression guard) | plain DDL. If the plan does not skip-scan on prod stats, the retention delete degrades to a seq scan of `events` under a 5 s `statement_timeout`, hence the assertion |
| A5 | **`default_toast_compression=lz4`, parallel autovacuum, autovacuum scoring, `log_lock_waits` on, faster FK checks, radix sort, async-I/O worker scaling, `NOT IN` anti-joins, planner simplifications** | 17/18/19 | none: server settings only | `active_games.game_state` (a TOASTed jsonb rewritten every move), every FK insert (`room_players`, `round_history`, `events`...) and the admin aggregates (`admin.ts:68-210`) benefit with no code. lz4 and `io_method` availability in the Alpine build **[unverified]**; check `SHOW default_toast_compression` in the first CI run | none |
| A6 | **`ON CONFLICT ... DO UPDATE` for the seat upsert** (not a 17-19 feature; found while auditing read-then-write) | 9.5 | `roomStore.ts:~25-45` `upsertSeatRow` (SELECT, then INSERT or UPDATE) becomes one `INSERT ... ON CONFLICT (room_id, user_id) DO UPDATE SET seat_index = excluded.seat_index WHERE room_players.seat_index IS DISTINCT FROM excluded.seat_index`, targeting the existing `room_players_room_user_uq` | deletes a round trip and the read; the row lock from `lockRoom` stays | `.onConflictDoUpdate({target:[roomId,userId], set:..., setWhere:...})` |

### 3.2 ADOPT, but only as ops runbook text (no code)

| Feature | Where | Reason |
|---|---|---|
| **`REPACK (CONCURRENTLY)`** | `docs/DEPLOY-RUNBOOK.md` (new "Bloat" step); replaces any `VACUUM FULL` advice | `active_games` churns a TOASTed row every move; this is the online fix when `pg_stat_user_tables` shows bloat. No `VACUUM FULL`/`CLUSTER`/pg_repack exists in the repo today (grep), so nothing to delete. Requires `wal_level` allowing logical decoding (`max_repack_replication_slots`) on the host **[unverified for managed hosts]** |
| `pg_stat_statements` generic/custom plan counts, `EXPLAIN (IO)`, `pg_stat_autovacuum_scores`, `pg_stat_lock` | runbook "Looking at the database" | observability, enabled on the host; the extension itself needs `shared_preload_libraries` which a managed host controls **[unverified]** |

### 3.3 REJECT (each with the reason it still holds or newly holds)

| Feature | Release | Looked at | Decision and reason |
|---|---|---|---|
| `MERGE` / `MERGE ... RETURNING` / `merge_action()` | 15/17 | `activeGameStore.ts:117-130` (`setWhere` on `owner_epoch`), `roundResults.ts:55-101`, `friendStore.ts:~209`, `ticket.ts:90-95` | **REJECT on correctness, still true.** Under concurrency MERGE can raise a unique violation instead of upserting, and has no equivalent of `ON CONFLICT DO UPDATE ... WHERE` that carries the epoch fence (the fence is the ownership invariant, ADR 0014). The 19 notes add nothing to MERGE |
| `INSERT ... ON CONFLICT DO SELECT` | 19 | every `onConflict*` in `server/` (list: `roundResults.ts:55,81,128`, `ticket.ts:93`, `push.ts:58`, `activeGameStore.ts:123`, `friendStore.ts:211`) | **REJECT.** No call site inserts-then-reads-the-existing-row. The socket-ticket burn (`ticket.ts:90-95`) needs exactly "did my insert win" (`DO NOTHING ... RETURNING`), which `DO SELECT` would make worse by returning the loser's row |
| `RETURNING OLD` / `NEW` | 18 | `activeGameStore.ts` `claim` (`:49-56`), `write` (`:117-130`), `remove` (`:135-142`), `clearPendingResult` (`:150-162`); `friendStore.acceptFriend`; `userStore.markEmailVerified` | **REJECT.** `claim` returns the new epoch and nothing reads the old one; `write` returns `room_id` only. `remove` (`:135-142`) re-reads the epoch (`epochOf`) after a DELETE that matched no row, but `RETURNING OLD` cannot report rows a `WHERE` excluded, so it does not shorten that. Re-open if a caller needs the previous owner. (The earlier "LATER" is withdrawn: nothing is waiting on it) |
| Virtual generated columns | 18 | `lower(username/email)` indexes (`schema.ts:28-45`), `seatedUserIds` (`activeGameStore.ts:36-47`) | **REJECT.** Virtual columns cannot be indexed, so they would add a column beside the expression index that already serves every lookup. The other 19 note (extended stats on virtual columns) does not change that. `schemaDdl.ts:167` also throws on CHECK/generated shapes it cannot render |
| `JSON_TABLE`, `JSON_QUERY/VALUE/EXISTS`, jsonpath string methods | 17/19 | `activeGameStore.ts:36-47` (`jsonb_each` + key regex + `order by key::numeric`), `:150-162`, `deleteAccount.ts:57-75` (`jsonb_array_elements ... WITH ORDINALITY`), `roundHistoryView.ts:~87`, `replays.ts:~14` | **REJECT.** Working, tested, GIN-served (`round_replays_player_ids_idx`, `schema.ts:~339`). `JSON_TABLE` is a different spelling of the same plan; no code deleted. `seatedUserIds` is a workaround for how `playerMap` is stored, so the fix is the data model (a `room_players` join), not a function; out of scope here |
| Temporal constraints `WITHOUT OVERLAPS`/`PERIOD` | 18 | no range data anywhere; seat holds are `now() - createdAt < holdMs` computed in `seatAllocation.ts` | **REJECT.** No overlap invariant exists. `FOR PORTION OF` is not in 19 at all (reverted in beta4) |
| `NOT NULL ... NOT VALID`, `NOT ENFORCED` (incl. 19 CHECK) | 18/19 | `schemaDdl.ts` is additive; adds columns with their NOT NULL default in one statement (`:408`); `:167` throws on CHECKs | **REJECT.** There is no "tighten an existing column on a live table" path to simplify. The cases it targets cannot occur on a fresh database |
| `GROUP BY ALL` | never | `admin.ts` uses `GROUP BY 1` | not in 19 |
| `IGNORE NULLS` | 19 | no `lag/lead/first_value/last_value` anywhere in `server/` | **REJECT** (nothing to apply to) |
| `random(min,max)`, `uuid_extract_timestamp`, `error_on_null`, `casefold`, `array_sort`, bytea<->uuid cast | 17-19 | `server/store/codes.ts` (`randomInt`, a CSPRNG for guessable-code defence); no code derives time from an id; no `array_sort`/`case-fold` call sites. `casefold` would re-key `lower()` account identity (`schema.ts:28-45`, `userStore.ts:41-81`) | **REJECT.** `random()` is not cryptographically secure, so room/friend codes stay in Node. `casefold` changes what makes two accounts equal; unchanged conclusion from `postgres.md` |
| `COPY` improvements, `COPY ... ON_ERROR SET_NULL`, JSON `COPY TO` | 17-19 | telemetry is `INSERT ... SELECT FROM unnest(...)` joined to `users` (`server/shared/events.ts:36`, `clientErrors.ts:81`) | **REJECT.** The join to `users` skips rows of deleted accounts, which `COPY` cannot do; `ON_ERROR` skips bad rows and would hide the `22xxx` fault accounting in `telemetryBatch.ts:~60-110` |
| `pg_stat_io`, `pg_stat_checkpointer`, `pg_stat_lock` in `/metrics` | 16-19 | `server/http/health.ts` exports pool meters and `pg_connection_headroom` | **REJECT** for code: managed hosts surface these; no consumer in our metrics. (Runbook mention in 3.2) |
| OAuth authentication, SNI, MD5 deprecation tooling | 18/19 | `DATABASE_URL` with password + `sslmode`; image uses SCRAM | **REJECT**; the host's concern |
| Incremental backup, failover slots, `WAIT FOR LSN`, logical sequence replication | 17-19 | `scripts/backup-db.mjs` is `pg_dump`; no replicas, publications or slots in the repo | **REJECT** (no replica exists) |
| `io_method=io_uring` | 18 | | **REJECT**: platform/host setting; `worker` default is automatic in 19 |
| `UNLOGGED socket_ticket_nonces` | 9.5 | `schema.ts:~383` | **REJECT**: a crash would forget burned nonces and reopen replay inside the TTL |
| Partitioning `events`/`client_errors` by day to replace `deleteInBatches` | 10+ | `retention.ts:~58-80` | **REJECT**: native partitioning has no auto-create, so it needs a scheduled job plus `DROP PARTITION`: more code than the `ctid` batch delete, not less |
| Triggers/`ON DELETE` rewrite of `deleteAccount.ts` | | | out of scope: no 17-19 feature involved |

### 3.4 Code found that no 17-19 feature replaces (do not chase)

`DEDUPE_ON_BOOT` (`schemaDdl.ts:276-310`): Postgres has no "create unique index ignoring duplicates". `session` table + advisory-locked
boot DDL: unchanged. `array_agg(... ORDER BY ...)[1]` in `clientErrors.ts:135-138`: no first/last aggregate arrived in 19.
`areFriends` + 3-attempt retry in `friendStore.acceptFriend` (`:~123-175`) could shrink with `ON CONFLICT (user_id, friend_user_id) WHERE status='accepted' DO NOTHING`
on the existing partial unique index, but that is a refactor not a Postgres 19 adoption and carries a race-test burden; flag only.

## 4. Breaking and behaviour changes, 16 to 19, against this repo

| Change | Release | Touches us? | Action |
|---|---|---|---|
| **Data checksums on at `initdb`** | 18 | fresh dev/CI/prod clusters only; small CPU/WAL cost. The online toggle was reverted from 19, so a no-checksum cluster cannot be flipped later without `pg_checksums` offline | none for fresh DB; runbook line for any `pg_upgrade` (`--no-data-checksums`) |
| **Docker `PGDATA` moved** to `/var/lib/postgresql/18/docker` (VOLUME `/var/lib/postgresql`) | 18 (same in 19 image) | no: `scripts/dev-stack.mjs:259-264` and all workflow services mount nothing | none |
| **JIT off by default** | 19 | no `jit` reference anywhere in the repo; admin aggregates are small | none (and removes a first-query latency spike) |
| **`io_workers` removed** | 19 | no reference in repo | none |
| **`standard_conforming_strings` forced on; `escape_string_warning` removed** | 19 | no reference; `pg_dump` 19 dumps are always loadable. Old (<19) `pg_dump` dumps with it off would not load | none; keep dump and restore client at 19 |
| **MD5 login warns** (`md5_password_warnings`); deprecated | 18/19 | image default is SCRAM; CI password created by initdb in SCRAM | none |
| **`max_locks_per_transaction` 64 to 128** | 19 | benign (more shared memory) | none |
| **`log_lock_waits` on by default** | 19 | more log lines under contention (`lockUsers`, `lockRoom`) | useful, none |
| **`default_toast_compression` lz4**, `wal_compression=on` picks best | 19 | new rows only | none |
| **Wait events renamed** (`BUFFERPIN` to `BUFFER`) | 19 | `grep wait_event` in repo/tests = none | none |
| **`json_array()` of zero rows returns `[]`** | 19 | `grep json_array` none | none |
| Full-text / `pg_trgm` classification via DB locale provider | 19 | none used | none |
| `pg_stat_*` renames (`sync_error_count` to `sync_table_error_count`) | 19 | subscriptions not used. `pg_stat_activity` columns we read (`pid`, `application_name`, `backend_start`; `pool.ts:~222`, `gameOwnership.ts:152,210,215`) unchanged | none |
| **`pg_dump`/`pg_restore` must match server major** | always | `tests/server/backupDb.test.ts:216-219` skips on mismatch; `ci.yml:310-313` fails on that skip; the `RC` string breaks both parsers (1.2) | PGDG client step (1.3); pin on GA only |
| `scripts/backup-db.mjs:41` text "Install a Postgres 16 client" | | stale | derive from `deploy/runtime.json` |
| Version pins | | `deploy/runtime.json:3`; `scripts/dev-stack.mjs:30`; `.github/workflows/ci.yml:254,885`, `soak.yml:41`, `mutation.yml:45`, client at `ci.yml:243,292,311` | same list as `postgres.md` section 5, with `19-alpine@sha256:<GA digest>` and `postgresql-client-19` |
| `max_connections`/`checkConnectionBudget` | | unchanged semantics | none |
| `LISTEN/NOTIFY` | 19 improved | not used (ADR-0014) | none |
| `CREATE INDEX CONCURRENTLY`, advisory locks, `pg_terminate_backend` | | no change found in 17-19 notes | existing integration tests run on 19 in CI |

## 5. Summary of decisions

ADOPT: PG 19 as the major (pin at GA); `transaction_timeout` (+ `25P04` in `TRANSIENT_CODES`); native `uuid` for all ids/FKs (own ticket, same empty-DB window);
`uuidv7()` on the 9 append-only/never-exposed tables; drop `events_occurred_idx` and `rooms_status_idx` via skip scan (EXPLAIN-asserted);
the passive 17/18/19 gains (lz4 TOAST, parallel autovacuum, AIO scaling, FK-check speed); single-statement seat upsert; runbook text for `REPACK (CONCURRENTLY)`.
REJECT: MERGE (correctness, epoch fence), ON CONFLICT DO SELECT, RETURNING OLD/NEW, virtual columns, JSON_TABLE, temporal, NOT ENFORCED, IGNORE NULLS, casefold,
`random()`, COPY, partitioning, UNLOGGED, replication/OAuth/backup features. Not in 19 at all: `FOR PORTION OF`, graph queries, `GROUP BY ALL`.
Open risks: no managed host offers 19 on GA day (1.4); PGDG `noble/resolute` client-19 availability **[unverified]**; GA/RC2 dates **[unverified today]**.
