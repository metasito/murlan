# Every runtime, service and dependency on its latest usable stable release: report

Research for #1911 (child of map #1898), on `main` at `dfd7695`, 2026-11-02. The decisions are
recorded in [ADR-0015](../../adr/0015-every-runtime-and-service-on-its-latest-usable-stable-release.md);
this file is the evidence, and the per-product files beside it hold the detail and the sources:

| File | Covers |
|---|---|
| [postgres.md](postgres.md) | Postgres 16 → 18: versions, hosts, breaking changes, the 17/18/19 feature survey, the upgrade runbook |
| [redis.md](redis.md) | Redis 7 → Valkey 8.1: versions, licensing, hosts, compatibility, feature survey, stream sizing, Upstash cost |
| [node.md](node.md) | Node 22/24 → 26: the release schedule, breaking changes, built-ins that replace a dependency |
| [client.md](client.md) | Expo SDK 57 → 58, React Native 0.86 → 0.88, React 19.3, patches, client feature survey |
| [server-deps.md](server-deps.md) | Server and tooling packages, the majors, removable dependencies, `npm audit` |
| [ci.md](ci.md) | Every GitHub Action, container image and runner label: pin → latest SHA or digest |
| [versions.md](versions.md) | The raw registry data for all 88 direct dependencies |

## How this was done

Five research agents (Postgres, Redis/Valkey, Node, client stack, server and tooling packages) read
the code they report on and the primary sources. Two cheaper agents collected registry data (every
`npm view`) and every CI pin (`git ls-remote`, Docker Hub). Each claim below is labelled:

- **read**: seen in the code, a tarball or a changelog;
- **registry**: from the npm registry, Docker Hub, mirror.gcr.io or `git ls-remote` on this date;
- **snippet**: from a search result, because the page was blocked here (render.com, fly.io,
  expo.dev, valkey.io, redis.io, upstash.com, postgresql.org and github.com release pages);
- **unmeasured**: nobody has measured it on this workload.

> [!WARNING]
> **Nothing here was measured or run on a new version.** No database or cache server could be
> started in this session, and the sandbox has only Node 22. Every "gain" is a vendor's number
> or a reasoned one. **#1921** measures the gains on the pinned images, using the
> audit's own `sim/`, and is the gate for the two adopt-if-measured features (`uuidv7()`,
> `active_games` fillfactor).

## 1. Runtimes and services

| Product | Today | Latest GA (2026-11-02) | Target | Why |
|---|---|---|---|---|
| **Postgres** | 16 (`16-alpine`, a stale 16.x digest that no tag points to any more) | 18.6; 19 is RC (GA planned 2026-11-19) | **18.6** (`18-alpine@sha256:10a5c69a…`) | Newest GA, offered by Render (default for new databases) and Neon/RDS; support to Nov 2030 against Nov 2028 for 16; nothing in our code or libraries blocks it (read). A fresh 18 database costs nothing now, since no real accounts exist yet. |
| **Key-value store** | Redis 7.4.12 (`redis:7-alpine`), already source-available (RSAL/SSPL), not OSI open source | Redis 8.10.3; Valkey 9.1.3, 9.0.7, 8.1.11 | **Valkey 8.1.11** (`valkey/valkey:8.1.11-alpine@sha256:2602ace2…`) | The #1107 candidates run Valkey: Render on 8.1 (snippet), DigitalOcean on 9 by default. CI pins 8.1, the oldest line any candidate runs, so nothing can come to depend on 9; 9 accepts every 8.1 command. #1925 moves to 9 once the host is chosen. Valkey is BSD-3 under the Linux Foundation. Redis 8 is single-vendor, tri-licensed, and spells its new commands differently from Valkey. Every adopted feature works on 8.1. |
| **Node.js** | dev/CI 24 (`.node-version`), production 22 (`deploy/runtime.json`, `--target=node22`) | 26.13.0 (Active LTS since 2026-10-28); 24 is in Maintenance; 22 reaches EOL 2027-04-30 | **26** everywhere | One version removes the split, the build job's override and its guard. Supported to 2029-04-30; RN 0.88, Metro and Expo 58 all accept `>=26` (registry). Fallback is 24.22.2 if the host refuses 26 (Render's acceptance of 26 is unverified). |
| **npm** | 10.9.9 (bundled with 22) | 12.2.1 | the one Node 26 bundles (11.20.0) | Moves with Node. `npm ci` must leave `package-lock.json` unchanged (unverified). |
| **Expo SDK** | 57 | 58.0.22, stable since 2026-10-31; no 59 exists | **58** | Brings RN 0.88.1 and React 19.3.0, fixes four HIGH audit chains (expo-router, query-string, decode-uri-component, @expo/cli), and contains the upstream fix that lets us delete a runtime swizzle. |
| **GitHub runners** | `ubuntu-latest`, one `ubuntu-24.04`, `macos-latest`, `windows-latest` | `ubuntu-26.04` is available | `verify` moves to `ubuntu-26.04` | It packages `postgresql-client-18`, which the restore test needs (#1913). Sources disagree on what `ubuntu-latest` means today: the runner-images README says 24.04, `ci.yml:243` says 26.04. Name the version explicitly. |

## 2. CI actions and images

Every pinned action except CodeQL declares the `node20` runtime at its pin (read). GitHub
deprecated Node 20 for actions on 2025-09-19, forced Node 24 by default from 2026-06-16, and
announced removal for 2026-09-16 (snippet, both dates second-hand). The pins run today only
because the runner forces them onto Node 24. Full table with peeled SHAs: [ci.md](ci.md).

| Action / image | Pinned | Latest | Notable change on the way |
|---|---|---|---|
| actions/checkout | v4.4.0 | v7.0.1 `3d3c42e5…` | node24; v7 refuses fork checkout under `pull_request_target`/`workflow_run` |
| actions/setup-node | v4.4.0 | v7.1.0 `949feb24…` | v5 caches automatically (set `package-manager-cache: false`: our install action restores `node_modules` itself) |
| actions/cache (+restore/save) | v4.3.0 | v6.1.0 `55cc8345…` | node24, cache service v2 |
| actions/upload-artifact | v4.6.2 | v7.0.2 `cf430e03…` | node24; artifacts immutable (already true on v4) |
| actions/download-artifact | v4.3.0 | v8.0.2 `9000827c…` | v8 fails on a hash mismatch by default |
| actions/setup-java | v4.9.1 | v6.1.0 `b843ebf9…` | node24; JDK cached when `cache` is set |
| expo/expo-github-action | 8.2.1 | 9.0.1 `9da89d36…` | node24 |
| github/codeql-action | v4.38.2 | v4.39.1 `9b325408…` | same major |
| reactivecircus/android-emulator-runner | v2.38.0 | v2.38.0 | already latest |
| ghcr.io/gitleaks/gitleaks | `v8.30.1` (tag only) | v8.30.1 `sha256:c00b6bd0…` | pin the digest like every other image |
| postgres, redis | see §1 | | |

## 3. Every direct dependency

Target is what the ticket in the **Ticket** column moves it to. "SDK 58 pin" is the version in
`expo@58.0.22`'s `bundledNativeModules.json` (read), which `npx expo install --fix` writes.
Registry data per package, including deprecations and dates: [versions.md](versions.md).

| Package | | Locked | Latest | Target | Ticket | Why |
|---|---|---|---|---|---|---|
| `@expo-google-fonts/inter` | dep | 0.4.2 | 0.4.2 | stay | — | already latest |
| `@expo-google-fonts/rajdhani` | dep | 0.4.1 | 0.4.1 | stay | — | already latest |
| `@expo/vector-icons` | dep | 15.1.1 | 15.1.1 | ^15.0.2 | #1915 | SDK 58 pin |
| `@react-native-async-storage/async-storage` | dep | 2.2.0 | 3.1.1 | stay 2.2.0 | #1915 | SDK 58 pins 2.2.0; 3.x is outside Expo's list |
| `@react-native-community/netinfo` | dep | 12.0.1 | 12.0.1 | 12.0.1 | #1915 | SDK 58 pin |
| `@react-native-masked-view/masked-view` | dep | 0.3.2 | 0.3.2 | 0.3.2 | #1915 | SDK 58 pin |
| `@shopify/react-native-skia` | dep | 2.12.0 | 2.14.0 | 2.14.0 | #1915 | SDK 58 pin |
| `@socket.io/redis-streams-adapter` | dep | 0.3.1 | 0.3.1 | stay | — | already latest; core commands only, so Valkey-compatible |
| `@tanstack/react-query` | dep | 5.102.8 | 5.105.1 | 5.105.1 | #1917 | inside the current range |
| `bcryptjs` | dep | 3.0.3 | 3.0.3 | stay | — | already latest (`crypto.argon2` is LATER, §4.3) |
| `compression` | dep | 1.8.2 | 1.8.2 | stay | — | already latest; already negotiates `br` |
| `connect-pg-simple` | dep | 10.0.0 | 10.0.0 | stay | — | latest; quiet since 2024-09 but maintained, with no better drop-in |
| `drizzle-orm` | dep | 0.45.2 | 0.45.4 | 0.45.4 | #1917 | 1.0 is still rc.5 |
| `expo` | dep | 57.0.25 | 58.0.22 | 58.0.22 | #1915 | SDK 58 |
| `expo-asset` | dep | 57.0.18 | 58.0.19 | ~58.0.19 | #1915 | SDK 58 pin |
| `expo-clipboard` | dep | 57.0.2 | 58.0.4 | ~58.0.4 | #1915 | SDK 58 pin |
| `expo-constants` | dep | 57.0.19 | 58.0.14 | ~58.0.14 | #1915 | SDK 58 pin |
| `expo-dev-client` | dep | 57.0.19 | 58.0.18 | ~58.0.18 | #1915 | SDK 58 pin |
| `expo-font` | dep | 57.0.4 | 58.0.11 | ~58.0.11 | #1915 | SDK 58 pin; fixes a Safari font-face timeout on web |
| `expo-keep-awake` | dep | 57.0.2 | 58.0.3 | ~58.0.3 | #1915 | SDK 58 pin |
| `expo-linear-gradient` | dep | 57.0.2 | 58.0.3 | ~58.0.3 | #1915 | SDK 58 pin; our patch must be regenerated |
| `expo-linking` | dep | 57.0.11 | 58.0.15 | ~58.0.15 | #1915 | SDK 58 pin |
| `expo-localization` | dep | 57.0.2 | 58.0.5 | ~58.0.5 | #1915 | SDK 58 pin |
| `expo-notifications` | dep | 57.0.21 | 58.1.7 | ~58.1.7 | #1915 | SDK 58 pin |
| `expo-router` | dep | 57.0.23 | 58.0.29 | ~58.0.29 | #1915 | SDK 58 pin; fixes the HIGH audit chain |
| `expo-screen-orientation` | dep | 57.0.2 | 58.0.3 | ~58.0.3 | #1915 | SDK 58 pin |
| `expo-splash-screen` | dep | 57.0.9 | 58.0.12 | ~58.0.12 | #1915 | SDK 58 pin |
| `expo-system-ui` | dep | 57.0.4 | 58.0.7 | ~58.0.7 | #1915 | SDK 58 pin |
| `express` | dep | 5.2.1 | 5.3.0 | 5.3.0 | #1917 | inside the range; qs, proxy-addr and body-parser CVE fixes |
| `express-rate-limit` | dep | 8.7.0 | 8.7.2 | 8.7.2 | #1917 | inside the range; refresh its `ip-address` (3 moderate advisories) |
| `express-session` | dep | 1.19.0 | 1.19.0 | stay | — | already latest |
| `helmet` | dep | 8.3.0 | 8.3.0 | stay | — | already latest |
| `pg` | dep | 8.23.0 | 8.23.1 | 8.23.1 | #1917 | inside the current range; speaks protocol 3.0, which 18 keeps |
| `pino` | dep | 10.3.1 | 10.4.0 | 10.4.0 | #1917 | inside the current range |
| `pino-http` | dep | 11.0.0 | 11.0.0 | stay | — | already latest |
| `pino-pretty` | dep | 13.1.3 | 13.2.0 | 13.2.0 | #1917 | inside the current range |
| `prom-client` | dep | 15.1.3 | 15.1.3 | → `@prometheus-io/client` 0.16.1 | #1917 | deprecated; its successor's API matches ours 1:1, five import lines |
| `rate-limit-redis` | dep | 6.0.1 | 6.0.2 | 6.0.2 | #1917 | inside the current range |
| `react` | dep | 19.2.3 | 19.3.1 | 19.3.0 | #1915 | SDK 58 pin; RN 0.88 peers ^19.3 |
| `react-dom` | dep | 19.2.3 | 19.3.1 | 19.3.0 | #1915 | SDK 58 pin |
| `react-native` | dep | 0.86.3 | 0.88.1 | 0.88.1 | #1915 | SDK 58 pin |
| `react-native-audio-api` | dep | 0.13.6 | 0.13.6 | stay 0.13.6 | #1915 | already latest; its patch still applies and is still needed |
| `react-native-gesture-handler` | dep | 3.3.0 | 3.4.0 | stay ~3.3.0 | #1915 | SDK 58 pin |
| `react-native-reanimated` | dep | 4.5.5 | 4.7.1 | 4.7.1 | #1915 | SDK 58 pin; our patch is upstream, delete it |
| `react-native-safe-area-context` | dep | 5.10.0 | 5.11.0 | ~5.10.1 | #1915 | SDK 58 pin |
| `react-native-screens` | dep | 4.28.0 | 4.30.1 | ~4.30.1 | #1915 | SDK 58 pin (expo-router 58 needs it) |
| `react-native-svg` | dep | 15.15.5 | 15.16.0 | 15.16.0 | #1915 | SDK 58 pin |
| `react-native-turbo-haptics` | dep | 1.2.0 | 1.2.0 | stay 1.2.0 | #1915 | already latest |
| `react-native-web` | dep | 0.21.2 | 0.21.4 | ~0.21.4 | #1915 | SDK 58 pin |
| `react-native-worklets` | dep | 0.10.4 | 0.13.1 | 0.13.0 | #1915 | SDK 58 pin (0.13.1 is not Expo-validated) |
| `redis` | dep | 6.3.0 | 6.3.1 | 6.3.1 | #1917 | inside the range; 6.4 is beta |
| `socket.io` | dep | 4.8.3 | 4.8.4 | 4.8.4 | #1917 | inside the range; fixes a pending-ack leak on timeout; no v5 exists |
| `socket.io-client` | dep | 4.8.3 | 4.8.4 | 4.8.4 | #1917 | in lockstep with the server |
| `source-map` | dep | 0.8.0 | 0.8.0 | stay | — | latest; `node:module` `SourceMap` could replace it (LATER) |
| `zod` | dep | 3.25.76 | 4.6.7 | 4.6.7 | #1918 | HIGH advisory GHSA-mrhx-c7xc-m3w5 has no 3.x fix; zod ships in the client bundle too |
| `@babel/core` | dev | 7.29.7 | 8.0.10 | stay 7.x | — | babel-preset-expo and Metro are Babel 7; the React Compiler must match them |
| `@breezystack/lamejs` | dev | 1.2.7 | 1.2.7 | stay | — | already latest |
| `@expo/env` | dev | 2.4.3 | 2.5.3 | 2.5.3 | #1915 | SDK 58 line |
| `@jest/globals` | dev | 29.7.0 | 30.5.2 | 30.5.2 | #1915 | with jest |
| `@playwright/test` | dev | 1.62.1 | 1.64.1 | 1.64.1 | #1917 | inside the range; check 1.64's `screen` and `--update-snapshots` changes |
| `@stryker-mutator/core` | dev | 10.0.0 | 10.1.1 | 10.1.1 | #1917 | regenerate the tap-runner patch |
| `@stryker-mutator/tap-runner` | dev | 10.0.0 | 10.1.1 | 10.1.1 | #1917 | regenerate the tap-runner patch |
| `@testing-library/react-native` | dev | 14.0.1 | 14.1.0 | 14.1.0 | #1917 | inside the current range |
| `@types/compression` | dev | 1.8.1 | 1.8.1 | stay | — | already latest |
| `@types/connect-pg-simple` | dev | 7.0.3 | 7.0.3 | stay | — | already latest |
| `@types/express` | dev | 5.0.6 | 5.0.6 | stay | — | already latest |
| `@types/express-serve-static-core` | dev | 5.1.3 | 5.1.3 | stay | — | already latest |
| `@types/express-session` | dev | 1.19.0 | 1.19.0 | stay | — | already latest |
| `@types/react` | dev | 19.2.18 | 19.3.0 | ~19.3.0 | #1915 | with React 19.3 |
| `@typescript-eslint/parser` | dev | 8.69.0 | 8.72.1 | 8.72.1 | #1917 | inside the current range |
| `canvaskit-wasm` | dev | 0.41.0 | 0.42.0 | stay 0.41.0 | — | Skia 2.14 pins exactly 0.41.0; binding and wasm must match |
| `drizzle-kit` | dev | 0.31.10 | 0.31.11 | 0.31.11 | #1917 | inside the current range |
| `esbuild` | dev | 0.27.2 | 0.28.2 | 0.28.2 (exact) | #1917 | nothing breaking for our one CLI call; #1914 moves `--target` |
| `eslint` | dev | 9.39.5 | 10.14.0 | stay 9.39.x; 10 when unblocked | #1923 | 9.x is EOL (2026-08-06); eslint-config-expo 58's eslint-plugin-react crashes on 10 |
| `eslint-config-expo` | dev | 57.0.2 | 58.0.4 | ~58.0.4 | #1915 | SDK 58 pin |
| `eslint-plugin-react-hooks` | dev | 7.1.1 | 7.1.1 | stay | — | already latest |
| `fast-check` | dev | 4.10.2 | 4.10.2 | stay | — | already latest |
| `fontverter` | dev | 2.0.0 | 2.0.0 | stay | — | already latest |
| `globals` | dev | 16.5.0 | 17.14.0 | 17.14.0 | #1917 | only `eslint.config.js` reads it |
| `jest` | dev | 29.7.0 | 30.5.2 | 30.5.2 | #1915 | jest-expo 58 runs on Jest 30 internals; a 29 core with them would mix majors |
| `jest-expo` | dev | 57.0.5 | 58.0.13 | ~58.0.13 | #1915 | SDK 58 pin |
| `mpg123-decoder` | dev | 1.0.3 | 1.0.3 | stay | — | already latest |
| `patch-package` | dev | 8.0.1 | 8.0.1 | stay | — | already latest |
| `playwright` | dev | 1.62.1 | 1.64.1 | 1.64.1 | #1917 | with `@playwright/test` |
| `subset-font` | dev | 2.7.0 | 2.9.0 | 2.9.0 | #1917 | inside the range; rerun the font-subset test |
| `tsx` | dev | 4.23.13 | 4.23.15 | remove | #1914 | Node 26 runs `server/index.ts` directly, as `tests/helpers/instance.ts` already does |
| `typescript` | dev | 6.0.3 | 7.0.2 | stay ~6.0.3; 7.0.2 for `typecheck` only | #1923 | 7.0 has no stable JS API (27 files import it); typescript-eslint peers `<6.1` |
| `yaml` | dev | 2.9.0 | 2.9.1 | 2.9.1 | #1917 | inside the current range |

Declared by none and used by us, to declare (#1914): `@types/node` at the production Node's major
(today the lock carries 26.4.1 transitively), and `@types/pg`. `@react-native/jest-preset ^0.88.1`
becomes an explicit devDependency in #1915.

## 4. Feature survey, by product

Verdicts and the reasons for the rejected ones are in ADR-0015; the per-feature tables, with the
file:line each feature would touch, are in the product files.

### 4.1 Postgres 18 ([postgres.md](postgres.md) §3)

- **Adopt, code:** `transaction_timeout` (17+) on the `app` and `admin` pools. Today
  `statement_timeout` bounds each statement at 5 s, but a multi-statement round-over transaction
  has no total bound (`server/store/pool.ts:26-46`). `pg` can only send it as
  `options: "-c transaction_timeout=…"`, and 16 rejects it at connect, so it ships with the bump
  (#1913). Keep it off `ddl` (concurrent index builds) and `ownership` (session locks).
- **Adopt if #1921 measures a gain:** `uuidv7()` defaults on the five append-only tables (`events`,
  `round_history`, `round_replays`, `client_errors`, `server_errors`), which gives index locality
  for inserts and the retention deletes. Only while the database is empty, because `schemaDdl.ts`
  never changes an existing default. Never on `users`, `rooms` or tokens, because a v7 id leaks
  its creation time. Also `fillfactor`/autovacuum tuning on `active_games`, if its HOT-update ratio
  is poor: it is rewritten on every move.
- **Free with the bump, no code:** asynchronous I/O (`io_method=worker`), streaming reads, faster
  multi-value `IN`/`= ANY`, lower vacuum memory, planner rewrites, `EXPLAIN` showing buffers by
  default, `pg_upgrade` keeping planner statistics.
- **Later:** B-tree skip scan, which could let `events_occurred_idx` go (needs `EXPLAIN` on real
  stats); `RETURNING OLD/NEW` (nothing reads an old value); `pg_stat_statements`; Postgres 19 at
  19.1 on a host that offers it.
- **Reject:** `MERGE` (not a concurrency-safe upsert, and has no fenced `setWhere`); virtual
  generated columns (the expression indexes already serve lookups); `JSON_TABLE` rewrites;
  incremental backup and failover slots (the host's job); OAuth; `casefold` (changes account
  identity); `io_uring` (not settable on a managed host); pipelining (ADR-0014's multi-row
  statements beat it); `UNLOGGED active_games` (it is the record of live tables).
- **Already done on 16:** a per-pool `application_name`, every timeout but the transaction one,
  keepalives, `jsonb`, partial indexes, concurrent boot DDL, ctid-batched retention.

### 4.2 Valkey 8.1 ([redis.md](redis.md) §3)

- **Adopt:**
  - `maxmemory-policy noeviction`, stated in the host contract. An eviction is indistinguishable
    from "offline" or "unowned", whereas an out-of-memory write is already degraded mode.
  - `INFO`-based gauges: memory, `evicted_keys`, `blocked_clients`, rejected connections, engine
    and version.
  - A boot check that logs loudly when the policy or engine differs from `deploy/runtime.json`.
  - `EVALSHA` via node-redis `defineScript` for the three hand-sent Lua scripts. The inbox send
    (`server/store/instanceInbox.ts:104`) uploads its script body with every cross-instance
    message.
  - Persistence off on the host, if offered.

  All of this is in #1919, with the engine move.
- **Later, with Valkey 9 (#1925, once the host offers it):** `DELIFEQ` and `SET … IFEQ`, which
  would replace short Lua scripts at no measurable gain and are spelled differently by each
  engine. **Design #1894's presence against 8.1 primitives.**
- **Reject:**
  - Hash-field TTL for presence. Per-user field expiry needs a periodic write per online user,
    which #1894 forbids ("online users cost no periodic writes"). An expired instance field also
    cannot tell the sweep which instance died.
  - `INCREX` (Redis 8.8) for the rate limits: Redis-only.
  - `XACKDEL`/`XDELEX`/`XREADGROUP CLAIM`/`XNACK`: Redis-only, and a per-boot inbox must never be replayed.
  - I/O threads: the design peak is 1,000 msg/s.
  - Redis 8's built-in modules, client tracking, RESP3, keyspace notifications, Functions,
    `WAITAOF`.
  - The GLIDE and iovalkey clients: the adapter and our half-open watch are node-redis-shaped.
  - Upstash pay-as-you-go: about 9M idle commands per instance-month, about $18 per instance
    before a single move (arithmetic from the code's constants).

### 4.3 Node 26 ([node.md](node.md) §3)

- **Adopt:**
  - Native type stripping instead of `tsx`: `server:dev` becomes `node --watch server/index.ts`
    and `scripts/e2e-server.mjs:103` follows. There are no enums, namespaces or parameter
    properties in `server/`, `shared/` or `lib/` (read).
  - `erasableSyntaxOnly` in `tsconfig.json`, so a future enum fails typecheck instead of failing
    at boot.
  - Drop the now-stable `--experimental-strip-types` flag (three sites).
  - One Node, which removes the build job's override and its guard.
- **Later:**
  - Pre-compressed brotli for the web export.
  - `using` for the transaction helper: `release(err)` and cause chaining are not a plain dispose.
  - `crypto.argon2` replacing `bcryptjs`: needs rehash-on-login, an auth change of its own.
  - `node:module` `SourceMap` replacing `source-map`.
- **Reject:**
  - Running `.ts` in production: the esbuild bundle is the artefact CI boots.
  - zstd (experimental in Node).
  - The permission model, `node:sqlite`, `diagnostics_channel`.
  - `node --run`: it skips the `pretest` preflight hook.
- **Already used:** `fs.glob`, `structuredClone`, `AbortSignal.timeout`, `monitorEventLoopDelay`,
  `t.mock.timers`, `import.meta.dirname`, global `fetch`.

### 4.4 Expo SDK 58, React Native 0.88, React 19.3 ([client.md](client.md) §3–4)

- **Adopt:**
  - Delete `modules/murlan-rn-patches/ios/MurlanRecycledLayout.mm`. RN 0.88 ships the upstream
    `prepareForRecycle` fix our own comment cites, so a runtime swizzle of RN internals goes.
  - Delete `patches/react-native-reanimated+4.5.5.patch`, whose code ships in 4.7.1.
  - The Strict TypeScript API, which RN 0.87 forces anyway.
  - Jest 30.
- **Later:** `useEffectEvent` for the five latest-ref sites (`components/table/countdown.ts:61`,
  `components/table/useRoundEnding.ts:53`, `components/RoomSeatList.tsx:101`,
  `components/table/pile.tsx:624`, `components/useTableFeedback.ts:150`), which is #1922. Also Expo
  Atlas when the bundle budget next fails, Android precompiled headers, SwiftPM, and the RN
  Performance APIs.
- **Reject:** `<Activity>`, `<ViewTransition>`, DOM components, async-storage 3, worklets
  `bundleMode`.
- **Already on:** the React Compiler, Hermes V1, the precompiled RN core, `expo/fetch`.

### 4.5 Server and tooling packages ([server-deps.md](server-deps.md) §2–5)

- **Adopt:**
  - zod 4 (#1918), which closes the HIGH advisory. Its own benchmarks claim several-fold faster
    parsing and a core under half the gzip size, and zod ships in the client bundle (unmeasured
    here).
  - `@prometheus-io/client` and the in-range bumps (#1917).
  - `@types/node` at the production major and `@types/pg` (#1914).
- **Spike (#1923):** TypeScript 7 for `npm run typecheck` only, installed under an alias, while the
  27 API consumers and typescript-eslint stay on 6. The press figure of 8–12x is unmeasured here.
- **Blocked upstream (#1923):** ESLint 10, on eslint-config-expo's plugins.
- **Reject:** socket.io connection-state recovery (`game:rejoin` carries authoritative state the
  recovery cannot), the node-redis pool and client-side caching, `pg-native`, drizzle 1.0 before
  GA, `z.toJSONSchema`.
- **Nothing dead:** every dependency is imported or run by a script.

## 5. What it buys

| | From |
|---|---|
| **Security** | Closes the only HIGH advisory in a server dependency (zod), three moderate ones on the rate-limit key path (`ip-address`), four HIGH client chains (SDK 58) and express's qs/proxy-addr/body-parser CVEs. Retires the Node 20 actions runtime. Moves every service onto a line with years of patches: Postgres to 2030, Node to 2029. |
| **Resilience** | `transaction_timeout` puts a hard bound on shutdown. `noeviction` plus `INFO` gauges turn a silent eviction, which would look like "offline", into a visible, degraded write error. The boot check catches prod/CI engine drift, which is this ticket's own subject. CI runs the production engine and the production Node. |
| **Simplicity** | Drops: a runtime swizzle of RN internals, the reanimated patch, `tsx`, the Node split with its override and guard, a strip-types flag in three places, and a deprecated metrics package. |
| **Performance** | Each measurable claim is unmeasured until #1921: Postgres 18's async and streaming I/O; zod 4 parsing on every socket message and HTTP body; Valkey's memory layout; `EVALSHA` saving a script upload per inbox message; TypeScript 7 for typecheck wall time (#1923). |
| **Cost** | Valkey on Render instead of Upstash pay-as-you-go avoids about $18 per instance-month of idle commands. Valkey on ElastiCache is the cheapest AWS engine if the host ever moves there. |

## 6. Tickets

Filed on map #1898 as `ready-for-human` (rule 33): the owner promotes what is work. Each ticket is
one topic and about one pull request's worth of work. The native blocking edges carry the order.

| Ticket | Topic | Size | Blocked by |
|---|---|---|---|
| #1913 | Postgres 18.6 everywhere, `transaction_timeout`, and the major-upgrade runbook | M | — |
| #1914 | Node 26 everywhere; Node's type stripping replaces `tsx` | M | — |
| #1915 | Expo SDK 58: React Native 0.88, React 19.3, Jest 30, patches | L | #1914 |
| #1917 | Server and tooling bumps; `@prometheus-io/client` replaces `prom-client` | M | — |
| #1918 | zod 4 | M | — |
| #1919 | Valkey 8.1 replaces Redis 7, with eviction and engine guards and `EVALSHA` | M | — |
| #1920 | CI actions onto their Node 24 majors; gitleaks pinned by digest | S | — |
| #1921 | Measure Postgres 18 and Valkey 8.1 with the audit's sims; decide `uuidv7()` and fillfactor | M | #1913, #1919 |
| #1922 | `useEffectEvent` for the latest-ref sites | S | #1915 |
| #1923 | TypeScript 7 for typecheck, and ESLint 10 | M | — |
| #1925 | Valkey 9 once the chosen host offers it | S | #1919, #1107 |
| #1926 | Postgres 19 once it is GA and the chosen host offers it | M | #1913, #1107 |

Also: #1913 waits for #1892, whose round-results transaction `transaction_timeout` bounds; #1921
waits for #1914 as well; and #1897, the audit's own rerun, waits for #1913, #1914 and #1919, so
its after-numbers come from the stack that ships.

**Merged from the parallel research in #1916.** A second session researched #1911 at the same
time. Folded in after checking each claim:
- `bug_reports` as a sixth append-only table for `uuidv7()`.
- The skip-scan decision, which moves into #1921.
- `transaction_timeout` tested against #1892's retry path.
- A SCRAM check on 18.
- The before-and-after measurements on #1915 (Jest 30, Metro 0.87, bundle size).
- A zod 3/4 parse benchmark, with `protocolHashes.json` held unchanged.
- The artifact v7/v8 round trip in #1920.
- The rejection of hash-field TTL on #1894's own terms.
- `INCREX` and `XNACK` rejected.
- The Valkey 9 and Postgres 19 follow-ups.

Two of its claims did not hold:
- The Valkey image does keep `redis-cli` (Valkey's `USE_REDIS_SYMLINKS` default), so the
  workflows' health command stays. This corrects `redis.md`.
- SDK 58 does not default an unset `web.output` to `server`: `@expo/cli` 58.1.18's
  `exportApp.js:139-140,398` treats unset as `single`. #1915 still pins `"output": "single"`
  explicitly.

Its Valkey 9.1.3 pin gave way to 8.1 for CI, because 8.1 is the oldest line any Valkey
candidate host runs. #1925 then follows the host.

#1915 is the one L: Expo, React Native, React and Jest move together, because jest-expo 58 runs
on Jest 30 and RN 0.88 peers React 19.3. It waits for #1914 only so that it lands on the final
Node. Nothing in it needs Node 26, since RN 0.86 already accepts it.

## 7. Open

- **Host facts I could not read** (render.com, fly.io and upstash.com were blocked): whether
  Render accepts Node 26; Render Key Value's plan memory and connection caps, its default eviction
  policy and its persistence option names; whether Valkey 9 is on Render's roadmap; how Upstash
  meters a blocked `XREAD`. Each matters only once #1107 picks the host, and each ticket names the
  check to run after provisioning.
- **If #1107 picks Fly:** Fly Managed Postgres offers 16 and 17 only (snippet), so the target
  becomes 17.11 and the 18-only items (`uuidv7()`, skip scan, async I/O) drop out. Fly's Redis is
  Upstash, which is rejected above, so it would mean a self-run Valkey machine.
- **Expo SDK 58 details** behind expo.dev: the exact Xcode required, and whether R8 is on by
  default for Android release builds. Run `npx expo-doctor` in #1915.
- **Postgres 19 reaches GA on 2026-11-19.** #1926 takes it at 19.1 on a host that offers it. It brings
  `REPACK CONCURRENTLY` and parallel autovacuum.
