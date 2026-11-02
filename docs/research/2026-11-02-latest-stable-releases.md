# Latest usable stable releases, and the features worth adopting

Research for #1911, a child of map #1898, asked for by the owner on 2026-11-02. The owner wants
the latest stable release of every runtime, service and dependency, and wants each product's best
features used where they help the real-time hot path, persistence, presence, rate limits and the
cluster channel. The decision is [ADR-0015](../adr/0015-latest-stable-runtimes-and-services.md).
This note holds the evidence for it and the ticket breakdown. Like every research note, it is
deleted once those tickets land.

**Usable** means three things, as the ticket defines it. The release is GA. The libraries we
depend on support it. And it is offered by the one-provider hosting candidates of #1107: Render,
Fly.io and DigitalOcean. #1107 is still deferred.

Every fact is from 2026-11-02. Package versions, engines and peers were read from the npm
registry with `npm view`. Image digests were read from `mirror.gcr.io`, the registry
`tests/tooling/noDockerHubPulls.test.ts` allows, and they match Docker Hub's. Action commits come
from `git ls-remote`. Everything else is cited under Sources.

## What was not measured

The ticket asks for a measured gain per feature. This session could not measure any. Its Docker
daemon was down, and `apt.postgresql.org` was refused by the proxy. Running Postgres 18 and
Valkey 9 binaries extracted from their images was refused by the session's permission policy, so
those binaries were deleted unrun. Per rule 35, the gains below are the vendors' published
figures, labelled as such. Each adopted feature's ticket measures its own gain, before and after,
with the audit's harness in `docs/research/2026-11-01-system-audit/sim/`.

## Runtimes and services

| Product | Now | Move to | Why |
|---|---|---|---|
| **Node.js** | 22 in production (`deploy/runtime.json`, `ci.yml`'s build job, `esbuild --target=node22`); 24 for dev and CI (`.node-version`) | **26.13.0 LTS "Lithium"**, `node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94` | Node 26 entered LTS on 2026-10-28 and is supported to April 2029. Expo 57 and 58 (`^26.0.0` / `>=25`), RN 0.88, ESLint 9, Jest 29 and 30, Babel 7, Stryker 10 and `@prometheus-io/client` all accept it. Dev and production then run one major. |
| **Postgres** | 16 (`postgres:16-alpine@sha256:7218…`) | **18.6**, `mirror.gcr.io/library/postgres:18.6-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5` | 18 is the newest GA major (2025-09-25). 18.6 shipped 2026-08-13 and fixes 28 CVEs; 18.5 was skipped for a regression. Render and DigitalOcean offer 18, and Render uses it as the default for new databases. Ubuntu 26.04, which is now `ubuntu-latest`, packages `postgresql-client-18`, so `ci.yml`'s verify job can drop its `ubuntu-24.04` pin. **19 is not GA**: RC 1 came out on 2026-10-15, and GA is planned for 2026-11-19. That is ticket N. |
| **Redis** | Redis 7 (`redis:7-alpine@sha256:8da1…`, which is 7.4, licensed RSALv2/SSPLv1, not BSD) | **Valkey 9.1.3**, `mirror.gcr.io/valkey/valkey:9.1.3-alpine@sha256:bf09d58e96d6b4524a15396b65b242bbe18beebbcc15a04d8ee75ddac62fae0b` | See *Redis 8 or Valkey* below. 9.1 is Valkey's newest GA line (9.1.0 on 2026-05-19); 9.2 is still at RC 1. The image ships `redis-cli` and `redis-server` as aliases, so the workflows' `--health-cmd "redis-cli ping"` keeps working (seen in the image's layer listing). |

### Redis 8 or Valkey

| | Redis Open Source 8.8.4 | Valkey 9.1.3 |
|---|---|---|
| Licence | Your choice of RSALv2, SSPLv1 or AGPLv3 since 8.0 | BSD-3 |
| Offered by the #1107 candidates | **None.** Render Key Value runs Valkey (8.1 for new instances since 2025-04-22). DigitalOcean runs Valkey (9 by default since 2026-09-28). Fly offers Upstash, which is Redis-compatible but is neither product | Render (8.1; whether Render offers 9 is not confirmed) and DigitalOcean (9) |
| Commands this code uses: `XADD`/`XREAD`/`XRANGE` (the streams adapter, `server/store/instanceInbox.ts`), `EVAL` (inbox, `tableOwners.ts`, `rate-limit-redis`), `SET PX`, `PUBLISH`, `PUBSUB CHANNELS` | All present | All present. Lua moved into a module in 9.1 but **loads by default**, so `EVAL` needs no configuration |
| Features with a use here | `INCREX` (8.8), a bounded counter with an expiry, could replace `rate-limit-redis`'s script | `DELIFEQ` (9.0) could replace `CLEAR_IF_MINE` in `server/store/tableOwners.ts` |

**Choice: Valkey 9.1.3.** No one-provider host offers Redis 8, so it is not usable under the
ticket's definition. Licensing is a second reason, not the deciding one: running Redis 8
unmodified as a service is allowed under any of its three licences. The redis.io protocol stays
the interface, so `REDIS_URL`, `redis://`, `rediss://`, the `redis` client and the
`@socket.io/redis-streams-adapter` stay as they are.

## Feature survey

### Postgres 17 and 18

| Feature | Since | Replaces | Gain (vendor's figure, or unmeasured) | Risk | Decision |
|---|---|---|---|---|---|
| `uuidv7()`, time-ordered UUIDs | 18 | `gen_random_uuid()` as the id default of the append-only tables `events`, `round_history`, `round_replays`, `client_errors`, `server_errors` and `bug_reports` (`shared/schema.ts`) | Each new key lands on the right-most B-tree page instead of a random one: fewer page splits, less WAL, a hotter cache. The project calls it "better caching". Not measured here | An id now reveals its creation time; `round_replays` ids are shared, but `finishedAt` is shown beside them anyway. `server/store/schemaDdl.ts` cannot change an existing column's `DEFAULT` yet | **Adopt**, ticket K |
| `transaction_timeout` | 17 | Nothing bounds a whole transaction today. `server/store/pool.ts` sets `statement_timeout` per statement and `idle_in_transaction_session_timeout` (10 s), so a multi-statement transaction can hold its row locks for the sum | A hard cap on how long decision 1's round-results transaction (ADR-0014) can hold the seats' `users` rows | Postgres 16 refuses an unknown setting at connect, so it must wait until every environment is on 18 | **Adopt**, ticket L |
| Skip scan on multicolumn B-trees | 18 | A range on `occurred_at` alone may be served by `events_name_occurred_idx (name, occurred_at)`, which has a few dozen event names in front, making `events_occurred_idx` redundant | One index fewer to maintain on every batched telemetry insert (#1891). Not measured here | The planner may prefer the single-column index anyway; that has to be shown with `EXPLAIN` | **Adopt if `EXPLAIN` agrees**, ticket M |
| Asynchronous I/O (`io_method=worker` by default) | 18 | Synchronous reads | "Up to 3×" on reads from storage, per the release announcement. That covers sequential scans, vacuum and the 30-day admin funnel, not the write-heavy hot path | None; it is the default | **Adopted by the bump itself** (ticket B); there is nothing to code. `io_uring` is a host setting |
| Better B-tree lookups for `IN` lists and `= ANY` | 17 | — | Applies on its own to every `= ANY($1)` read, such as name and presence rosters | None | **Adopted by the bump itself** |
| `pg_upgrade` keeps planner statistics; data checksums on by default at `initdb` | 18 | — | No post-upgrade `ANALYZE` stall; corruption is detected | None | **Adopted by the bump itself** |
| `OLD`/`NEW` in `RETURNING` | 18 | — | — | — | **Reject**: the epoch claim (`activeGameStore.claim`) already returns the new row in the same statement, and no statement needs the row as it was before an update |
| Virtual generated columns (now the default kind) | 18 | — | — | — | **Reject**: there is no derived column; the `lower(...)` lookups are expression indexes, and Postgres 18 cannot index a virtual column |
| `MERGE … RETURNING`, `JSON_TABLE`, faster `COPY` with `ON_ERROR`, incremental `pg_basebackup` | 17 | — | — | — | **Reject**: `ON CONFLICT` covers every upsert, nothing shreds JSON in SQL, nothing uses `COPY`, and backups are `pg_dump` (`scripts/backup-db.mjs`) or the host's PITR |
| Temporal `WITHOUT OVERLAPS`, OAuth authentication, `NOT ENFORCED` constraints | 18 | — | — | — | **Reject**: no use here |
| MD5 passwords deprecated | 18 | — | — | The server warns at an MD5 login | **Check in ticket B**: the images default to SCRAM, and so does `pg` 8 |
| Postgres 19: `REPACK CONCURRENTLY`, parallel autovacuum, LZ4 TOAST by default, JIT off by default | 19 (not GA) | Bloat on `active_games`, whose row is rewritten on every move | Not measured | Not GA; dumps taken by a pre-19 `pg_dump` with `standard_conforming_strings=off` do not load | **Defer to ticket N** |

### Valkey 8 and 9, set against Redis 8

| Feature | Since | Would replace | Decision and reason |
|---|---|---|---|
| Hash-field expiry (`HEXPIRE`, `HSETEX`, `HGETEX`) | Valkey 9.0, Redis 7.4 | Whole-key TTLs | **Reject.** The one place it could apply is presence (#1894): the user entries, or the instance liveness kept as hash fields. A per-user field expiry needs a periodic write per online user, which #1894's DoD forbids ("online users cause no periodic writes"). An expired instance field is removed without a per-field notification in Valkey, so the sweeper loses the very member it has to clean up. The `instance:<id>` key with a 10 s TTL, the `instances` set and `instance-users:<id>` already do the job with whole-key TTLs |
| `DELIFEQ` (delete if the value equals) | Valkey 9.0 (Redis 8.4 spells it `DELEX IFEQ`) | `CLEAR_IF_MINE`, a one-line script in `server/store/tableOwners.ts` | **Reject for now.** It saves one script and no measurable latency at our rates. It also binds the code to Valkey 9 and above: Upstash lacks it, and Render's version is not confirmed. Reconsider once #1107 picks the host. `REFRESH_IF_MINE` would stay a script either way, because it also puts back a missing record, which `SET … IFEQ` does not |
| `INCREX` window counter | Redis 8.8 only | `rate-limit-redis`'s `INCR`+`PEXPIRE` script | **Reject**: Redis only, and Redis is not usable here |
| `XNACK`, `XREADGROUP … CLAIM` | Redis 8.4–8.8 | — | **Reject**: the adapter and the inboxes read by offset with `XREAD`; nothing uses consumer groups |
| I/O threads, the new hashtable (8.1, about 20% less memory per key), atomic slot migration, numbered databases in cluster mode (9.0), the 9.1 I/O-threading work | Valkey 8.0–9.1 | — | **Comes with the bump; nothing to code.** The design peak is 1,000 cluster messages a second (`deploy/runtime.json` `maxClusterMessagesPerSecond`), far below any single-node ceiling, so throughput is not the gain. The gain is a supported BSD line that the hosts offer |
| Lua as a module that can be turned off | Valkey 9.1 | — | **Reject**: the inbox, `tableOwners` and `rate-limit-redis` all use `EVAL`. A known leak on Lua function deletion affects 9.1 and later; we use `EVAL`, never `FUNCTION DELETE` |
| Path Hash type, forkless snapshots, `HOTKEYS` | Valkey 9.2 (RC) | — | **Reject**: not GA |

### Node 24 and 26

| Feature | Since | Replaces | Decision and reason |
|---|---|---|---|
| Type stripping on by default | Unflagged in 22.18 and 23.6, on by default in 24 and 26 | **`tsx`**, used only by `npm run server:dev`, and the `--experimental-strip-types` flag on six call sites (`package.json` `soak`, `tests/helpers/instance.ts`, `tests/server/dbTls.test.ts`, `tests/tooling/processGuards.test.ts`, `scripts/measureHeadsUpBalance.ts`, the sim's repros) | **Adopt**, in ticket A. The server already boots this way under test (`tests/helpers/instance.ts`), so `node server/index.ts` replaces `tsx` and the dependency goes. Node 26 removed `--experimental-transform-types`; ticket A proves whether 26 still accepts `--experimental-strip-types` and drops the flag either way |
| One major for dev and production | — | `ci.yml`'s production-Node job, which exists because esbuild's `--target=node22` lowers syntax and not APIs (`server/CLAUDE.md`) | **Adopt**, in ticket A. The job stays and reads the manifest; it now exercises the same major as dev |
| Temporal enabled by default | 26 | — | **Reject**: there is no date library to replace |
| `module.SourceMap` | Experimental | `source-map` in `server/http/sourceMaps.ts` | **Reject**: not confirmed stable |
| Permission model (`--permission`) | Stable in 24 | — | **Reject**: no threat it closes that the host's sandbox leaves open; nothing measured |
| `zlib` zstd | 23.8 | Brotli or gzip from `compression` | **Reject**: Safari does not accept zstd, and `compression` does not offer it |
| Removed in 26: legacy `_stream_*` modules, `http.Server#writeHeader`, `--experimental-transform-types`; `module.register()` deprecated at runtime | 26 | — | **Risk, checked**: nothing in `node_modules` requires a `_stream_*` module (grep at `main` `b05dd9f`) |

### Expo SDK 58: React Native 0.88 and React 19.3

The newest Expo SDK is **58.0.22**: 58.0.0 shipped on 2026-09-29 and the latest patch on
2026-10-31. Its `bundledNativeModules.json` sets React 19.3.0, React Native 0.88.1, Reanimated
4.7.1 with Worklets 0.13.0, and every pin in the table below. React Native 0.88 has no breaking
changes of its own, but the jump from 0.86 includes 0.87's.

What the move touches here, and the risks:

- **`app.json` has no `web.output`.** On SDK 58, expo-router defaults an unset `web.output` to
  `server`, which renders each request on the fly. The Express server serves an `expo export`
  bundle, so ticket D sets `web.output` explicitly and proves the export's layout is unchanged.
- **React Native 0.87 makes the Strict TypeScript API the default.** A deep import into
  `react-native/Libraries/...` becomes a type error, and three tests have one:
  `tests/native/harness/env.ts`, `orientationFirstRender.test.tsx` and
  `tableRelocksAfterEntry.test.tsx`.
- **Five patches must be ported or deleted.** Their packages move: Skia 2.12.0→2.14.0,
  expo-linear-gradient 57.0.2→58.0.3, Reanimated 4.5.5→4.7.1. Stryker 10.0.0→10.1.1 goes in
  ticket F. The audio-api patch (0.13.6) stays on its version.
- **expo-router 58 changes behaviour.** `freezeOnBlur` is gone (not used here). `screen`,
  `params` and `initial` are now ordinary parameters. A failing guard renders a redirect.
- **`jest-expo` 58** declares `@react-native/jest-preset ^0.88.1` as a peer, and accepts Jest 30.
- Features worth having: web-style event dispatch through `EventTarget` (RN 0.88). Metro 0.87,
  whose source maps are about twice as fast at half the memory, per the release coverage; that
  shortens `expo:web:build` in CI. React 19.3's `<ViewTransition>` and `<Activity>`. None of these
  replaces code here today, so none gets its own ticket. The speed-up is measured inside ticket D.

### The other libraries

| Feature | Decision |
|---|---|
| **Zod 4**: the maintainers' microbenchmarks give 14× faster string parsing, 7× array and 6.5× object, and a core bundle 57% smaller. Zod parses every socket intent (`shared/socketSchemas.ts`, `server/socket/socketSafety.ts`) and every persisted envelope on restore (`shared/gameStateSchema.ts`, `shared/persistedEnvelope.ts`) | **Adopt**, ticket I. The hot path parses on every move. Risk: error customisation is unified, `.default()` changed meaning, and string formats are now top-level functions |
| **Jest 30**: `jest-expo` 58 accepts `^30` | **Adopt if not slower**, ticket H, with the native suite's wall time measured |
| **`prom-client` is deprecated** in favour of `@prometheus-io/client`, the same project (`prometheus/client_js`) renamed. Its README points to a changelog of breaking changes, which the 0.16.1 tarball does not include | **Adopt**, ticket G |
| **TypeScript 7.0.2**, the native compiler | **Not usable**: `@typescript-eslint/parser` 8.72.1 declares a peer of `typescript >=4.8.4 <6.1.0`. Stay on 6.0.3, the newest 6.x |
| **ESLint 10.14.0** | **Not usable**: `eslint-config-expo` 58 pulls in `eslint-plugin-import` and `eslint-plugin-react`, whose peers stop at ESLint 9. Stay on 9.39.5 |
| **Babel 8.0.10** | **Not usable**: `babel-preset-expo` 58 is built from Babel 7 plugins. Stay on 7.29.7 |
| **drizzle-orm 1.0** | **Not usable**: still `1.0.0-rc.5`. Move to 0.45.4 |
| **Socket.io** | 4.8.4 is the newest; there is no v5. `@socket.io/redis-streams-adapter` 0.3.1 is the newest |

## Every direct dependency

The `Now` column is the version `package-lock.json` locks at `main` `b05dd9f`. An `=` means the
package is already on its newest usable release.

| Package | Now | Move to | Why, if not the newest on npm |
|---|---|---|---|
| expo | 57.0.25 | 58.0.22 | ticket D |
| expo-asset · expo-clipboard · expo-constants · expo-dev-client · expo-font · expo-keep-awake · expo-linear-gradient · expo-linking · expo-localization · expo-notifications · expo-router · expo-screen-orientation · expo-splash-screen · expo-system-ui | 57.x | ~58.0.19 · ~58.0.4 · ~58.0.14 · ~58.0.18 · ~58.0.11 · ~58.0.3 · ~58.0.3 · ~58.0.15 · ~58.0.5 · ~58.1.7 · ~58.0.29 · ~58.0.3 · ~58.0.12 · ~58.0.7 | SDK 58's pins |
| jest-expo · eslint-config-expo | 57.0.5 · 57.0.2 | ~58.0.13 · ~58.0.4 | SDK 58 |
| react · react-dom | 19.2.3 | 19.3.0 | SDK 58's pin; 19.3.1 is newer but Expo pins 19.3.0 |
| @types/react | 19.2.18 | ~19.3.0 | follows React |
| react-native | 0.86.3 | 0.88.1 | SDK 58 |
| react-native-web | 0.21.2 | ~0.21.4 | SDK 58 |
| react-native-reanimated | 4.5.5 | 4.7.1 | SDK 58; the patch moves |
| react-native-worklets | 0.10.4 | 0.13.0 | SDK 58's pin; 0.13.1 is newer |
| react-native-gesture-handler | 3.3.0 | ~3.3.0 = | SDK 58 pins `~3.3.0`; 3.4.0 is not supported |
| react-native-screens | 4.28.0 | ~4.30.1 | SDK 58 |
| react-native-safe-area-context | 5.10.0 | ~5.10.1 | SDK 58; 5.11.0 is not supported |
| react-native-svg | 15.15.5 | 15.16.0 | SDK 58 |
| @shopify/react-native-skia | 2.12.0 | 2.14.0 | SDK 58; the patch moves |
| canvaskit-wasm | 0.41.0 | 0.41.0 = | Skia 2.14.0 pins 0.41.0 exactly, so 0.42.0 would be a second copy |
| @react-native-async-storage/async-storage | 2.2.0 | 2.2.0 = | SDK 58 pins 2.2.0; 3.1.1 is not supported |
| @react-native-community/netinfo · @react-native-masked-view/masked-view | 12.0.1 · 0.3.2 | = | SDK 58 |
| @expo/vector-icons · @expo-google-fonts/inter · @expo-google-fonts/rajdhani | 15.1.1 · 0.4.2 · 0.4.1 | = | |
| react-native-audio-api · react-native-turbo-haptics | 0.13.6 · 1.2.0 | = | newest; Worklets 0.13 satisfies audio-api's peer |
| @tanstack/react-query | 5.102.8 | 5.105.1 | ticket E |
| express | 5.2.1 | 5.3.0 | ticket E |
| express-rate-limit · rate-limit-redis | 8.7.0 · 6.0.1 | 8.7.2 · 6.0.2 | ticket E |
| express-session · helmet · compression · connect-pg-simple · bcryptjs · pino-http · source-map | 1.19.0 · 8.3.0 · 1.8.2 · 10.0.0 · 3.0.3 · 11.0.0 · 0.8.0 | = | |
| pg | 8.23.0 | 8.23.1 | ticket E |
| drizzle-orm · drizzle-kit | 0.45.2 · 0.31.10 | 0.45.4 · 0.31.11 | tickets E and F; 1.0 is an RC |
| redis | 6.3.0 | 6.3.1 (exact pin, as now) | ticket E |
| socket.io · socket.io-client | 4.8.3 | 4.8.4 | ticket E |
| @socket.io/redis-streams-adapter | 0.3.1 | = | |
| pino · pino-pretty | 10.3.1 · 13.1.3 | 10.4.0 · 13.2.0 | ticket E |
| prom-client | 15.1.3 | **@prometheus-io/client 0.16.1** | deprecated; ticket G |
| zod | 3.25.76 | 4.6.7 | ticket I |
| typescript | 6.0.3 | 6.0.3 = | 7.0.2 is not usable (typescript-eslint) |
| @typescript-eslint/parser | 8.69.0 | 8.72.1 | ticket F |
| eslint | 9.39.5 | 9.39.5 = | 10 is not usable (Expo's lint plugins) |
| eslint-plugin-react-hooks · fast-check · fontverter · patch-package · mpg123-decoder · @breezystack/lamejs | 7.1.1 · 4.10.2 · 2.0.0 · 8.0.1 · 1.0.3 · 1.2.7 | = | |
| globals | 16.5.0 | 17.14.0 | ticket F |
| @babel/core | 7.29.7 | 7.29.7 = | 8 is not usable (babel-preset-expo) |
| jest · @jest/globals | 29.7.0 | 30.5.2 | ticket H |
| @testing-library/react-native | 14.0.1 | 14.1.0 | ticket F |
| @playwright/test · playwright | 1.62.1 | 1.64.1 | ticket F |
| @stryker-mutator/core · @stryker-mutator/tap-runner | 10.0.0 | 10.1.1 | ticket F; the tap-runner patch moves |
| esbuild | 0.27.2 | 0.28.2 (exact pin) | ticket A |
| tsx | 4.23.13 | **removed** | Node's own type stripping; ticket A |
| @expo/env · subset-font · yaml | 2.4.3 · 2.7.0 · 2.9.0 | 2.5.3 · 2.9.0 · 2.9.1 | ticket F |
| @types/compression · @types/connect-pg-simple · @types/express · @types/express-serve-static-core · @types/express-session | 1.8.1 · 7.0.3 · 5.0.6 · 5.1.3 · 1.19.0 | = | |

## GitHub Actions and runners

Each action is pinned by commit, as it is now. The commits come from `git ls-remote`, with
annotated tags peeled.

| Action | Now | Move to |
|---|---|---|
| actions/checkout | v4.4.0 `11d5960a` | **v7.0.1** `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node | v4.4.0 `49933ea5` | **v7.1.0** `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| actions/cache (and `/restore`, `/save`) | v4.3.0 `0057852b` | **v6.1.0** `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| actions/upload-artifact | v4.6.2 `ea165f8d` | **v7.0.2** `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| actions/download-artifact | v4.3.0 `d3f86a10` | **v8.0.2** `9000827ccba6bdab643e8b6fd33ac0654aef8333` |
| actions/setup-java | v4.9.1 `cf277c60` | **v6.1.0** `b843ebf9b913146b38da2eaa7aeddf76074ae1ad` |
| github/codeql-action (`init`, `analyze`) | v4.38.2 `2892aa5e` | **v4.39.1** `9b3254085494b55a0f7c4c2b3d2d52cc712ce370` |
| expo/expo-github-action | 8.2.1 `c7b66a9c` | **9.0.1** `9da89d3617bb88139671bad31b09c65714c2ee06` |
| ReactiveCircus/android-emulator-runner | v2.38.0 `a421e438` | = |

Why: the v4 majors are the Node 20 builds. Since 2026-06-16, runners have forced Node 24 on them,
and Node 20 is due to be removed from runners this autumn. checkout v7 makes
`pull_request_target` checkouts safer by default; no workflow here uses `pull_request_target`.
Runners: `ubuntu-latest` is 26.04 and `macos-latest` is macOS 26 with Xcode 26.6, which meets SDK
58's 26.4 minimum. `windows-latest` has Visual Studio 2026. The one pinned label, `ci.yml`'s
`ubuntu-24.04`, exists only for `postgresql-client-16` and goes back to `ubuntu-latest` in
ticket B.

## Proposed implementation tickets

Each ticket is one pull request, and each ends with a green `ci.yml`. A ticket that touches the
server also needs green integration suites with `DATABASE_URL` and `REDIS_URL`. Per the ticket's
constraint, none starts before the map's open PRs #1905–#1909 have merged. **#1897**, the audit
rerun, should also be blocked by A, B and C, so its after-numbers are taken on the stack that
ships.

### A. Run Node 26 LTS everywhere, and drop `tsx` — size M — no dependencies

Scope:
- `deploy/runtime.json` `node: 26`; `engines.node` `>=26`; `.node-version` `26`; `ci.yml`'s
  production-Node job `node-version: "26"`.
- esbuild pinned at `0.28.2`, and `server:build` `--target=node26`.
- `server:dev` becomes `node server/index.ts`; `tsx` is removed.
- Every `--experimental-strip-types` either goes or is proved still needed on 26.
- Every doc and prompt naming Node 22 is updated: `server/CLAUDE.md`, `.claude/workflows/audit.mjs`.

Definition of done:
- [ ] `tests/server/deployRuntime.test.ts` passes, reading 26 from the manifest.
- [ ] `npm run server:build && npm run server:prod` boots on Node 26.13.0 in the build job.
- [ ] `tsx` is gone from `package.json` and the lockfile, and `npm run server:dev` serves `/health`.
- [ ] The audit's `sim/repro/srv` runs once on 26, with its numbers in the PR body against
  `sim/results/repro-srv.txt`.

### B. Postgres 18.6 everywhere — size M — no dependencies

Scope:
- `deploy/runtime.json` `postgres: 18`.
- Every Postgres image (`scripts/dev-stack.mjs`, `ci.yml` ×2, `soak.yml`, `mutation.yml`) becomes
  `mirror.gcr.io/library/postgres:18.6-alpine@sha256:10a5c69a…edadfb5`. Re-verify the digest
  before landing.
- `ci.yml`'s verify job goes back to `ubuntu-latest` and installs `postgresql-client-18`.
- `scripts/backup-db.mjs`'s message names 18.
- `docs/DEPLOY-RUNBOOK.md` gains a *major upgrade* section. Dev: `node scripts/dev-stack.mjs down`
  and up, since the container has no volume. A host: its in-place upgrade (Render's goes to its
  newest major; DigitalOcean's has no downtime), or `pg_dump` with the new major's client and
  `pg_restore`. Production is not live yet, so there is no data to move today.

Definition of done:
- [ ] `tests/tooling/postgresMajor.test.ts` and `noDockerHubPulls.test.ts` pass at 18.
- [ ] The backup-restore test runs; it is not skipped.
- [ ] The integration and soak suites are green on 18.
- [ ] `sim/repro/db` is rerun on 18, with its numbers in the PR body against
  `sim/results/repro-db.txt`, and nothing slower beyond noise.
- [ ] `SHOW password_encryption` is `scram-sha-256` in dev and CI.

### C. Valkey 9.1.3 replaces Redis 7 — size M — no dependencies

Scope:
- `deploy/runtime.json` replaces `redis: 7` with `valkey: 9`.
- `REDIS_IMAGE` and every workflow service become
  `mirror.gcr.io/valkey/valkey:9.1.3-alpine@sha256:bf09d58e…62fae0b`.
- `tests/tooling/redisImage.test.ts` is renamed and rewritten to hold Valkey images to the
  manifest's `valkey` major. It must still fail when the image is missing or not pinned (rule 49).
- `docs/DEPLOY-RUNBOOK.md`'s `REDIS_URL` line names Valkey 9. `REDIS_URL` and the client stay.
- Record in #1107 that the host must offer Valkey 9 or newer. If the chosen host offers only 8.x,
  the manifest follows the host; no code depends on 9.

Definition of done:
- [ ] The integration suites pass against Valkey, with `crossInstance`, `sharedRateLimits` and the
  inbox and adapter tests named in the PR body.
- [ ] `EVAL` works with no module configuration.
- [ ] `sim/repro/srv` is rerun against Valkey, and its numbers are in the PR body.

### D. Expo SDK 58: React Native 0.88.1, React 19.3.0 — size L — no dependencies

Scope:
- Every package in the table marked "SDK 58", installed with `npx expo install --fix`, then
  `npx expo-doctor` is clean.
- The Skia, expo-linear-gradient and Reanimated patches are ported to the new versions, or
  deleted where the fix is upstream.
- `app.json` sets `web.output` explicitly, so the export Express serves is unchanged.
- The three deep `react-native/Libraries` imports in tests move to the public API.
- The expo-router 58 migration items are checked against `app/`.
- `@react-native/jest-preset` is added if `jest-expo` 58 needs it top-level.

Definition of done:
- [ ] `ci.yml` is green, including e2e.
- [ ] `-f native=true` Android and iOS compiles are green.
- [ ] `npm run bundle:budget` passes, with the size change in the PR body.
- [ ] `expo:web:build` wall time is recorded before and after, for Metro 0.87.
- [ ] Maestro flows are green on Android.

### E. Server and app libraries to their newest minors — size S — no dependencies

Scope:
- express 5.3.0, express-rate-limit 8.7.2, rate-limit-redis 6.0.2, pg 8.23.1, drizzle-orm 0.45.4,
  redis 6.3.1 (exact), socket.io and socket.io-client 4.8.4, pino 10.4.0, pino-pretty 13.2.0,
  @tanstack/react-query 5.105.1.

Definition of done:
- [ ] `ci.yml` and the integration suites are green.
- [ ] `tests/fixtures/protocolHashes.json` is unchanged; a change means the wire moved, so stop.

### F. Test and build tooling to their newest usable releases — size M — no dependencies

Scope:
- @playwright/test and playwright 1.64.1, @stryker-mutator/core and tap-runner 10.1.1 (port the
  patch), @testing-library/react-native 14.1.0, @typescript-eslint/parser 8.72.1, globals 17.14.0,
  drizzle-kit 0.31.11, @expo/env 2.5.3, subset-font 2.9.0, yaml 2.9.1.

Definition of done:
- [ ] `ci.yml` is green, and no e2e spec is over its budget in `tests/e2e/timings.json` (rule 46).
- [ ] `npm run lint` is clean.
- [ ] One `mutation.yml` dispatch runs green on the ported patch.

### G. `prom-client` → `@prometheus-io/client` 0.16.1 — size S — no dependencies

Scope:
- The five importers (`server/http/health.ts`, `server/http/rateLimit.ts`,
  `server/shared/metrics.ts`, and two tests) import the new package. `prom-client` is removed.

Definition of done:
- [ ] `/metrics` serves the same series names, types and labels as before, compared by a test on
  the parsed exposition, not by eye.
- [ ] `tests/server/healthMetrics.test.ts` passes.

### H. Jest 30 for the native suite — size M — blocked by D

Scope:
- jest and @jest/globals 30.5.2, with config changes Jest 30 requires.

Definition of done:
- [ ] Both platform projects are green.
- [ ] The native suite's wall time and peak RSS in CI are in the PR body, before and after.
- [ ] If Jest 30 is slower, the PR is closed with those numbers instead.

### I. Zod 4 on the socket and persistence paths — size M — no dependencies

Scope:
- zod 4.6.7, migrating every schema in `shared/`, `server/` and `lib/`: error customisation,
  `.default()` against `.prefault()`, and the top-level string formats.

Definition of done:
- [ ] A benchmark parses a recorded `game:play` intent and a full persisted envelope 10,000 times
  on zod 3 and on zod 4, with the numbers in the PR body.
- [ ] HTTP 400 bodies are unchanged (`tests/server/validate.test.ts`).
- [ ] `protocolHashes.json` is unchanged.
- [ ] `bundle:budget` passes, with the size change recorded.

### J. GitHub Actions to their current majors — size S — no dependencies

Scope:
- Every `uses:` in the actions table, pinned by the commit listed there (re-peel before landing),
  across `.github/workflows/*.yml` and `.github/actions/*`.

Definition of done:
- [ ] Every workflow that runs on a pull request is green.
- [ ] `ios.yml`, `maestro.yml`, `mutation.yml`, `soak.yml`, `codeql.yml` and `eas-build.yml` are
  each dispatched once and green.
- [ ] Artifacts uploaded by v7 download with v8 within one run (`ios.yml` and `mutation.yml` do
  both).
- [ ] `tests/tooling/installAction.test.ts` passes.

### K. `uuidv7()` ids for the append-only tables — size M — blocked by B

Scope:
- `shared/schema.ts` defaults `events`, `round_history`, `round_replays`, `client_errors`,
  `server_errors` and `bug_reports` to `uuidv7()`.
- `server/store/schemaDdl.ts` learns to apply a changed `DEFAULT` to an existing column. That is
  additive and safe online.

Definition of done:
- [ ] A test boots on a database with the old default and finds the new one applied.
- [ ] A seeded run inserts 1M `events` rows under each default, with the index size, insert time
  and WAL bytes in the PR body.
- [ ] If v7 is no better, the PR is closed with the numbers.

### L. `transaction_timeout` on the round-results transaction — size S — blocked by B and #1892

Scope:
- The pool profile that runs ADR-0014 decision 1's transaction sets `transaction_timeout` (in
  `server/store/pool.ts`), with the value derived from the statement timeouts it bounds, not a
  new literal.

Definition of done:
- [ ] A test holds the transaction open past the limit, sees it end with Postgres's timeout error
  and the seats' rows unlocked, and sees the pending results retried (#1892's retry path).
- [ ] The same test fails with the setting removed (rule 6).

### M. Drop `events_occurred_idx` if skip scan serves its queries — size S — blocked by B

Scope:
- `EXPLAIN (ANALYZE, BUFFERS)` on Postgres 18, against `sim/seed.sql` data, for every query that
  filters `events` by `occurred_at` alone: the retention prune and the admin funnel.

Definition of done:
- [ ] The plans are in the PR body with and without the index.
- [ ] The index is dropped only if every plan is no slower; otherwise the PR records why it stays
  and changes nothing.

### N. Postgres 19 — size M — blocked by B; also waits for 19's GA (planned for 2026-11-19) and for one #1107 candidate offering 19

Scope:
- The same files as ticket B, at 19's first GA minor.
- An assessment of `REPACK CONCURRENTLY` and parallel autovacuum against `active_games` bloat,
  measured with the soak.
- A runbook note that dumps for 19 come from a 19 client.

Definition of done:
- [ ] As ticket B's.
- [ ] `active_games` dead tuples and table size after a soak are in the PR body, on 18 and on 19.

## Sources

- npm registry, read with `npm view <pkg> version|engines|peerDependencies|time` on 2026-11-02;
  Expo 58.0.22's `bundledNativeModules.json` and `package.json`, read with `npm pack`.
- Image digests: `https://mirror.gcr.io/v2/<repo>/manifests/<tag>` (`docker-content-digest`),
  checked against `hub.docker.com/v2/repositories/<repo>/tags/<tag>`.
- Action commits: `git ls-remote --tags https://github.com/<owner>/<repo>`.
- Postgres: [PostgreSQL 18 released](https://postgresql.org/about/news/postgresql-18-released-3142/);
  [PostgreSQL 19 RC 1](https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/);
  [PostgreSQL 19 RC 1 coverage](https://www.warp2search.net/story/postgresql-19-rc1-released-native-repack-parallel-autovacuum-and-upgrades-to-watch/);
  [EDB 18.6.0 release notes](https://www.enterprisedb.com/docs/pge/latest/release_notes/rel_notes18.6.0/);
  [Render: PostgreSQL 18](https://render.com/changelog/postgresql-18-is-now-available-for-render-postgres-databases);
  [Render: upgrading](https://render.com/docs/postgresql-upgrading);
  [DigitalOcean version support](https://docs.digitalocean.com/products/databases/version-support-policy/);
  [Ubuntu 26.04 ships PostgreSQL 18](https://idroot.us/install-postgresql-ubuntu-26-04/).
- Redis and Valkey: [Redis licences](https://redis.io/legal/licenses/);
  [Redis 8.0 tri-licensed](https://www.phoronix.com/news/Redis-8.0-Goes-AGPLv3);
  [Redis 8.8 release notes](https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisos-8.8-release-notes/);
  [Redis 8.4: SET IFEQ, DELEX, XREADGROUP CLAIM](https://redis.io/blog/simplifying-streams-and-strings/);
  [Valkey 9.0](https://valkey.io/download/9.0/);
  [Valkey 9.0 atomic slot migration](https://infoq.com/news/2025/11/valkey-9-atomic-migration/);
  [What's new in Valkey 9 (DELIFEQ)](https://www.dragonflydb.io/blog/whats-new-in-valkey-v9);
  [Valkey 9.1 announcement](https://valkey.io/blog/valkey-9-1-delivers-improvements-in-security-performance-and-more/);
  [Valkey 9.1 at the Linux Foundation](https://www.linuxfoundation.org/press/valkey-enhances-efficiency-security-and-modular-performance-with-9.1-release-and-new-ecosystem-integrations);
  [Move Lua into a module (#1627)](https://github.com/valkey-io/valkey/issues/1627);
  [Valkey 9.1.0-rc2](https://github.com/valkey-io/valkey/releases/tag/9.1.0-rc2);
  [Valkey 9.2.0-rc1](https://newreleases.io/project/github/valkey-io/valkey/release/9.2.0-rc1);
  [Render Key Value on Valkey 8.1](https://render.com/changelog/new-render-key-value-instances-use-valkey-8-1);
  [DigitalOcean databases](https://docs.digitalocean.com/databases/quickstart/);
  [Upstash on Fly](https://fly.io/docs/upstash/redis/).
- Node: [v26.13.0 release](https://github.com/nodejs/node/releases/tag/v26.13.0);
  [Node 26 on Vercel](https://vercel.com/changelog/node-js-26-lts-is-now-generally-available-on-vercel);
  [Node 26 overview](https://linuxiac.com/node-js-26-debuts-with-temporal-api-enabled-by-default/);
  [Node 26 LTS upgrade notes](https://fireup.pro/news/nodejs-26-lts-whats-new-upgrade).
- Expo, React Native and React: [How to upgrade to SDK 58](https://expo.dev/blog/how-to-upgrade-to-sdk-58);
  [expo-router SDK 57 to 58](https://docs.expo.dev/router/migrate/sdk-57-to-58/);
  [SDK 58 reference](https://docs.expo.dev/versions/v58.0.0);
  [React Native 0.88](https://reactnative.dev/blog/2026/10/19/react-native-0.88);
  [React Native 0.87 coverage](https://itnext.io/react-native-0-87-instant-paywall-a-b-testing-and-buying-mike-hardy-a-beer-87795be5803e);
  [SDK 58 breaking changes](https://www.buildmvpfast.com/blog/expo-sdk-58-ios-27-react-native-088-breaking-changes-2026);
  [React 19.3.0](https://www.gitclear.com/open_repos/facebook/react/release/v19.3.0).
- Libraries: [Zod 4](https://zod.dev/v4); [Zod 4 on InfoQ](https://www.infoq.com/news/2025/08/zod-v4-available).
- Actions and runners: [Node 20 deprecation on runners](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/);
  [Upcoming image migrations](https://github.blog/changelog/2026-05-14-github-actions-upcoming-image-migrations);
  [New runner images](https://github.blog/changelog/2026-06-11-new-runner-images-in-public-preview/);
  [checkout releases](https://github.com/actions/checkout/releases).
- Hosting candidates: #1107's option space (2026-09-22).
