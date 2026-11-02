# 0015. Every runtime and service on its latest usable stable release

**Status:** Accepted; decisions 1 (Postgres 18) and 2 (Valkey 8.1) superseded by ADR-0016; decision 5's TypeScript and ESLint clauses superseded by ADR-0017
**Date:** 2026-11-02

## Context

#1911, asked for by the owner on 2026-11-02: "The owner's direction is to run the latest usable
stable release of everything, and to use the best features each product offers." The stack carried
versions nobody had chosen on purpose:

- Postgres 16 had been pinned before the 2026-11-01 audit, and the pinned digest is one no tag
  points to any more.
- Redis 7 was carried over from the audit's decision sheet. 7.4 is already source-available
  rather than open source.
- Production ran Node 22 while dev and CI ran 24, an override in CI's `build` job keeping the two
  apart.
- The client stack was one Expo SDK behind.
- zod sat on a line with an unfixed HIGH advisory.
- Every CI action except CodeQL declared the Node 20 runtime that GitHub has retired.

"Usable" means generally available, supported by the libraries we depend on, and offered by the
hosting candidates in #1107: Render recommended, Fly.io the cheaper alternative. The evidence,
the full version table and every feature considered are in
`docs/research/2026-11-02-latest-stable/REPORT.md` and the per-product files beside it. Nothing
was benchmarked or run on a new version there; the measured gains are the job of the measurement
ticket below.

## Decision

1. **Postgres 18**, pinned as `postgres:18-alpine` by digest (18.6 today). It is the newest GA
   major, Render's default for new databases, and supported to November 2030. The database holds
   no real accounts yet, so production starts on 18 rather than upgrading into it.
   `docs/DEPLOY-RUNBOOK.md` gains the procedure for a later major move.
   - *Adopted:* `transaction_timeout` on the `app` and `admin` pools only. `ddl` builds indexes
     concurrently and `ownership` holds session locks, so neither gets it. It has to land after
     the bump, because Postgres 16 refuses the setting at connect. The rest of 18's gains come
     with no code: asynchronous and streaming I/O, multi-value index lookups, vacuum memory,
     planner rewrites.
   - *Adopted only if measured:* dropping `events_occurred_idx`, if `EXPLAIN` shows skip scan
     serving its queries from `events_name_occurred_idx`. `uuidv7()` defaults on the append-only
     tables (`events`, `round_history`, `round_replays`, `client_errors`, `server_errors`,
     `bug_reports`), only while those tables are empty, and never on `users`, `rooms` or tokens, whose ids would reveal their creation
     time. Fillfactor and autovacuum tuning on `active_games`, if its HOT-update ratio is poor.
   - *Rejected:*
     - `MERGE`, which is not a concurrency-safe upsert and cannot carry the epoch fence that
       `ON CONFLICT … setWhere` does.
     - Virtual generated columns: the expression indexes already serve every lookup.
     - `JSON_TABLE` rewrites of queries that are already correct and indexed.
     - Incremental backup, failover slots and OAuth, which belong to the host.
     - `casefold()`, which would change what makes two accounts the same.
     - `io_uring`, which a managed host does not let us set.
     - Pipelining, since ADR-0014's multi-row statements beat it.
     - `UNLOGGED active_games`, which is the record of live tables.
   - *Later:* `RETURNING OLD/NEW`, once a caller reads an old value; `pg_stat_statements`;
     Postgres 19, at 19.1 on a host that offers it, with `REPACK CONCURRENTLY` and parallel
     autovacuum judged against `active_games` bloat.
2. **Valkey 8.1 replaces Redis 7**, pinned as `valkey/valkey:8.1.11-alpine` by digest, and the
   host contract names the engine as well as the major. Render's Key Value runs Valkey 8.1, so
   this is the engine CI can share with production. Valkey is BSD-3 under the Linux Foundation;
   Redis 8 is single-vendor, tri-licensed, and spells its new commands differently. ADR-0014's
   design is unchanged and carries no engine name of its own: where it says Redis, read the
   key-value store. Its features are all core commands. 9.1 is the newest Valkey GA line, and
   DigitalOcean, another #1107 candidate, runs it. CI pins 8.1 because it is the oldest line any
   candidate host runs: nothing can then come to depend on 9, and 9 accepts every 8.1 command.
   CI follows the host to 9 once #1107 names it.
   - *Adopted:*
     - `maxmemory-policy noeviction`. An evicted presence or owner key would read as "offline" or
       "unowned", whereas a refused write is already degraded mode.
     - Gauges from `INFO`.
     - A boot check that logs loudly when the engine or eviction policy differs from the host
       contract.
     - `EVALSHA` through node-redis `defineScript` for the Lua scripts we send by hand.
   - *Rejected:*
     - Hash-field TTL for presence. A per-user field expiry needs a periodic write per online
       user, which #1894 forbids, and an expired instance field cannot tell the sweep which
       instance died.
     - The Redis-only commands: `INCREX` for the rate limits; `XACKDEL`, `XDELEX`, `XNACK` and
       `XREADGROUP CLAIM` for the streams. An instance's inbox lives for one boot and must never
       be replayed.
     - I/O threads: the design peak is 1,000 messages a second.
     - Redis 8's built-in modules, client-side caching, RESP3, keyspace notifications, Functions
       and `WAITAOF`.
     - The GLIDE and iovalkey clients: the streams adapter and the half-open watch in
       `server/store/redis.ts` are node-redis-shaped.
     - A pay-per-command host: our idle traffic alone is about nine million commands per
       instance-month.
   - *Later:* `SET … IFEQ` and `DELIFEQ`, when the host runs Valkey 9. Presence (#1894) is
     designed against 8.1 primitives meanwhile. Conditional delete removes a few lines of Lua and
     fixes no failure mode.
3. **Node 26 everywhere**: `.node-version`, `deploy/runtime.json`, `engines`, the esbuild target
   and CI. It is Active LTS and supported to April 2029, and one version removes the dev/prod
   split together with the `build` job's override and guard. If the chosen host cannot run 26,
   all of them move to 24 together, never apart.
   - *Adopted:*
     - Node's own type stripping replaces `tsx` for `server:dev` and the e2e server, as the tests
       already boot it.
     - `erasableSyntaxOnly`, so syntax Node cannot strip fails typecheck instead of failing at
       boot.
     - Dropping the stable `--experimental-strip-types` flag.
     - `@types/node` declared at the production Node's major, so typecheck refuses a builtin
       production lacks.
   - *Rejected:*
     - Running `.ts` in production: the esbuild bundle is the artefact CI boots.
     - zstd: still experimental in Node.
     - The permission model, `node:sqlite` and `diagnostics_channel`.
     - `node --run`: it skips the `pre` hooks the test scripts rely on.
   - *Later:*
     - `crypto.argon2` replacing `bcryptjs`, which needs rehash-on-login and is an auth change of
       its own.
     - `using` in the transaction helper, whose release and cause-chaining are not a plain
       dispose.
     - Brotli pre-compression of the web export.
     - `node:module`'s `SourceMap` replacing `source-map`.
4. **Expo SDK 58**: React Native 0.88, React 19.3, and Jest 30, which jest-expo 58 runs on. Every
   Expo-managed package takes the SDK's pin, not npm's latest. AsyncStorage stays on 2.2.0,
   gesture-handler on 3.3, and `canvaskit-wasm` on the exact 0.41.0 Skia pins.
   - *Adopted:*
     - Deleting `modules/murlan-rn-patches/ios/MurlanRecycledLayout.mm`, since React Native 0.88
       carries the upstream fix.
     - Deleting the reanimated patch, whose code ships in 4.7.1.
     - The Strict TypeScript API.
   - *Later:* `useEffectEvent` in place of the latest-ref pattern; Expo Atlas; Android
     precompiled headers; SwiftPM.
   - *Rejected:* `<Activity>`, `<ViewTransition>`, DOM components, AsyncStorage 3 and worklets
     `bundleMode`.
5. **The server and tooling packages** move to their latest release inside their current range,
   and three majors move:
   - zod 4, because the advisory has no 3.x fix.
   - `@prometheus-io/client` replaces the deprecated `prom-client`.
   - Jest 30, with the SDK.

   Three stay, each for a reason a later ticket can lift:
   - TypeScript on 6 for every API consumer and for typescript-eslint. A spike measures 7 for
     `npm run typecheck` alone.
   - ESLint on 9, until eslint-config-expo's plugins run on 10.
   - drizzle on 0.45, until 1.0 is GA.

   *Rejected:* socket.io connection-state recovery, because `game:rejoin` carries authoritative
   state the recovery cannot; node-redis pooling and client-side caching; `pg-native`.
6. **CI actions move to their current majors**, which run on Node 24, each pinned by commit SHA
   as today. The gitleaks image is pinned by digest like every other image.

## Consequences

- `deploy/runtime.json` is the contract the bumps change first. A workflow, the dev stack and the
  tests already follow it for Postgres and Node, and the key-value store joins them under an
  engine name.
- A newer major, or a feature this record rejects, needs a record that supersedes the decision
  here. A patch or minor inside a pinned line needs only a passing CI run and a fresh digest.
- If #1107 chooses Fly.io, decision 1 drops to Postgres 17, which is all Fly Managed Postgres
  offers, and the 18-only items fall away. Decision 2 then means a self-run Valkey rather than
  Fly's Upstash.
- Valkey 8.1 and Redis 7.4 data files are not interchangeable. The store holds nothing durable, so
  the switch is an empty start and a brief cross-instance gap, which degraded mode absorbs.

The work is carried out on map #1898:
- Postgres 18 (#1913)
- Node 26 (#1914)
- Expo SDK 58 (#1915)
- Server and tooling bumps (#1917)
- zod 4 (#1918)
- Valkey 8.1 (#1919)
- CI actions (#1920)
- Measuring the new versions (#1921)
- `useEffectEvent` (#1922)
- TypeScript 7 and ESLint 10 (#1923)
- Valkey 9 (#1925) and Postgres 19 (#1926), once the host offers them

A second research of #1911, made at the same time (#1916), was folded into this record and its
evidence.
