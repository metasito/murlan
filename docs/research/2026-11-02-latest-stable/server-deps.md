# #1911 research: server and tooling npm dependencies

Date: 2026-11-02. Read-only on /home/user/murlan. Versions are from `package-lock.json` and `npm view` today (the Haiku table `deps-table.md` was cross-checked and agrees). `node_modules` is not installed in the checkout, so nothing was type-checked or run against the repo; every "works" claim below is from changelogs/peer metadata and says so.

Network note: devblogs.microsoft.com, zod.dev, infoq.com were blocked by the session proxy. Where an official post was unreachable, the source is the GitHub raw changelog or the package tarball itself.

## 1. Table

"Free" = inside the existing caret/tilde range, no code change expected; run the suite. "Compatible" = highest version the other constraints allow.

| package | locked | latest stable | latest-compatible | target | why |
|---|---|---|---|---|---|
| socket.io | 4.8.3 | 4.8.4 | 4.8.4 | 4.8.4 (free) | 4.8.4 cleans pending acks on timeout (a leak); `ws` ~8.21. No v5 exists (dist-tags: latest 4.8.4, alpha 4.6.0-alpha1). |
| socket.io-client | 4.8.3 | 4.8.4 | 4.8.4 | 4.8.4 (free) | same; used by lib/socket.ts (client) and tests/soak. Keep in lockstep with server. |
| @socket.io/redis-streams-adapter | 0.3.1 | 0.3.1 | 0.3.1 | stay | already latest; peer `socket.io-adapter ^2.5.4`. |
| redis (node-redis) | 6.3.0 | 6.3.1 | 6.3.1 | 6.3.1 (free); 6.4.0-beta.0 exists, do not take | RESP3 default and 5s command timeout already neutralised in `redisOptions` (server/store/redis.ts:62-75: `maintNotifications: "disabled"`, explicit `commandOptions.timeout`, keepAlive). |
| rate-limit-redis | 6.0.1 | 6.0.2 | 6.0.2 | 6.0.2 (free) | peer `express-rate-limit >=8.6.0`. |
| express | 5.2.1 | 5.3.0 | 5.3.0 | 5.3.0 (free in ^5.0.1) | bundles qs ^6.16.0 (3 CVEs), proxy-addr 2.0.8 CVE, body-parser ^2.3.0 CVE-2026-12590. See Breaking section for two behaviour notes. |
| express-rate-limit | 8.7.0 | 8.7.2 | 8.7.2 | 8.7.2 (free) | its `ip-address ^10.2.0` dep is locked at 10.7.0, which npm audit flags (section 5); `npm update ip-address` or a fresh lock fixes (latest 10.7.5). |
| express-session | 1.19.0 | 1.19.0 | 1.19.0 | stay | latest; last publish 2026-01-22. |
| connect-pg-simple | 10.0.0 | 10.0.0 | 10.0.0 | stay (see section 3) | last publish 2024-09-13, 4 open issues; stable, not abandoned, but quiet. |
| helmet | 8.3.0 | 8.3.0 | 8.3.0 | stay | latest. |
| compression | 1.8.2 | 1.8.2 | 1.8.2 | stay | latest; already negotiates br/gzip/deflate (README lists br). |
| cors | n/a | n/a | n/a | n/a | not a dependency: hand-rolled `setupCors` (server/app.ts:88-103) over `isAllowedOrigin` (server/http/cors.ts). |
| pg | 8.23.0 | 8.23.1 | 8.23.1 | 8.23.1 (free) | patch. |
| drizzle-orm | 0.45.2 | 0.45.4 (latest tag); 1.0.0-rc.5 (rc tag, 2026-10-21) | 0.45.4 | 0.45.4 (free). Do NOT go to 1.0 yet | 1.0 is still RC. |
| drizzle-kit | 0.31.10 | 0.31.11 | 0.31.11 | 0.31.11 (free) | 0.31.11 warns about silently skipped migrations. Nested esbuild 0.25.12 is clean of the audit's esbuild advisory (<=0.24.2). |
| zod | 3.25.76 | 4.6.7 | 4.6.7 (no peer blocks; eslint-plugin-react-hooks accepts ^3.25 or ^4) | 4.6.7, as its own ticket | npm audit HIGH GHSA-mrhx-c7xc-m3w5 (<4.6.6), no 3.x fix; faster parse, smaller bundle (client ships zod). ~60 mechanical edits, see section 2. |
| bcryptjs | 3.0.3 | 3.0.3 | 3.0.3 | stay | latest. |
| pino | 10.3.1 | 10.4.0 | 10.4.0 | 10.4.0 (free) | |
| pino-http | 11.0.0 | 11.0.0 | 11.0.0 | stay | |
| pino-pretty | 13.1.3 | 13.2.0 | 13.2.0 | 13.2.0 (free) | |
| prom-client | 15.1.3 | 15.1.3 (DEPRECATED: "replaced by @prometheus-io/client") | n/a | `@prometheus-io/client` 0.16.1, as its own ticket; or stay | see section 2. |
| source-map | 0.8.0 | 0.8.0 | 0.8.0 | stay now; LATER candidate for removal | section 3. |
| typescript | 6.0.3 | 7.0.2 (GA) | 6.0.3 for tooling | stay on 6.0.3; spike 7 for `typecheck` only | typescript-eslint peer is `typescript >=4.8.4 <6.1.0`; 7.0 ships no stable JS API (27 repo files `import ts from "typescript"`). |
| esbuild | 0.27.2 (exact pin) | 0.28.2 | 0.28.2 | 0.28.2 | tsx already runs 0.28.2 nested, drizzle-kit 0.25.12, @esbuild-kit 0.18.20. No reason for the exact pin is recorded in the repo (no test/doc mentions it; ci.yml:917 only discusses `--target`). |
| tsx | 4.23.13 | 4.23.15 | 4.23.15 | 4.23.15 (free) | |
| eslint | 9.39.5 | 10.14.0 | 9.39.5 | stay on 9 for now (9.x is EOL 2026-08-06; npm marks 9.39.5 "no longer supported") | blocked by eslint-config-expo's plugins, section 2. |
| @typescript-eslint/parser | 8.69.0 | 8.72.1 | 8.72.1 | 8.72.1 (free) | peer eslint ^8.57\|\|^9\|\|^10, typescript <6.1. |
| eslint-plugin-react-hooks | 7.1.1 | 7.1.1 | 7.1.1 | stay | already declares eslint ^10 peer. |
| globals | 16.5.0 | 17.14.0 | 17.14.0 (only eslint.config.js uses it) | 17.14.0 | eslint-config-expo has its own `globals ^16`; ours is separate. |
| jest / @jest/globals | 29.7.0 | 30.5.2 | 29.7.0 | stay; move with the Expo SDK 58 ticket | jest-expo 57.x depends on jest-29 packages (`@jest/globals ^29.2.1`, `babel-jest ^29.2.1`). jest-expo 58.0.13 peers `jest ^29\|\|^30` and depends on `^30.0.0` packages but needs `@react-native/jest-preset ^0.88.1`, i.e. RN 0.88/SDK 58. |
| @testing-library/react-native | 14.0.1 | 14.1.0 | 14.1.0 | 14.1.0 (free) | |
| @playwright/test, playwright | 1.62.1 | 1.64.1 | 1.64.1 | 1.64.1 | breaking items in 1.64 below (none look relevant). |
| @stryker-mutator/core, tap-runner | 10.0.0 (exact) | 10.1.1 | 10.1.1 | 10.1.1 | but `patches/@stryker-mutator+tap-runner+10.0.0.patch` must be regenerated for 10.1.1. |
| fast-check | 4.10.2 | 4.10.2 | same | stay | |
| patch-package | 8.0.1 | 8.0.1 | same | stay | |
| yaml | 2.9.0 | 2.9.1 | 2.9.1 | 2.9.1 (free) | |
| @babel/core | 7.29.7 | 8.0.10 | 7.x | stay | expo/babel-preset-expo is on Babel 7; Stryker 10 uses Babel 8 internally, nested. Other agents own babel-preset-expo. |
| fontverter | 2.0.0 | 2.0.0 | same | stay | |
| subset-font | 2.7.0 | 2.9.0 | 2.9.0 | 2.9.0 (free) | font build output may change bytes: run `tests/tooling/fontSubset.test.ts`. |
| mpg123-decoder, @breezystack/lamejs | 1.0.3, 1.2.7 | same | same | stay | |
| canvaskit-wasm | 0.41.0 | 0.42.0 | | other agent (Skia/CanvasKit URL is in the CSP) | |
| @types/* (compression, connect-pg-simple, express, express-session, express-serve-static-core) | 1.8.1, 7.0.3, 5.0.6, 1.19.0, 5.1.3 | same | same | stay | |
| @types/node (undeclared) | 26.4.1 | | | declare `@types/node@^22` | see section 3. |

## 2. Breaking changes per major, checked against our usage

### zod 3.25.76 -> 4.6.7 (the one real migration; also the only HIGH direct advisory)
Where zod is used: server/http/validate.ts, mount.ts, socket/lobbyIntents.ts, socket/socketSafety.ts, and `shared/` (protocol.ts, socketSchemas.ts, http.ts, httpSchemas.ts, gameStateSchema.ts, persistedEnvelope.ts) plus lib/offlineSave.ts. app/(online)/*.tsx and components/ import `shared/protocol.ts`/`shared/http.ts`, so zod is in the web/native client bundle, not only the server (docs/BUNDLE.md:114 lists 3.43 MB installed size, which is node_modules weight, not shipped weight).

Source for breaking list: https://raw.githubusercontent.com/colinhacks/zod/main/packages/docs/content/v4/changelog.mdx. Perf/bundle claims from https://raw.githubusercontent.com/colinhacks/zod/main/packages/docs/content/v4/index.mdx (zod's own benchmarks: string parse 14.71x, array 7.43x, object 6.5x faster; core gzip 12.47 kb -> 5.36 kb; ~25000 -> ~175 tsc instantiations on a simple file). Treat as upper bounds; not measured on our schemas.

| zod 4 change | our usage |
|---|---|
| `required_error` / `invalid_type_error` removed; use `error: (iss) => iss.input === undefined ? ... : ...` | 19 occurrences, nearly all in shared/persistedEnvelope.ts:112-144, 194-215 (the "match target missing" style messages that `readPersisted...` surfaces via `issues[0].message` at line 244) |
| `errorMap` renamed `error`, returns string/undefined | shared/persistedEnvelope.ts:122, 125 (`errorMap: (_iss, ctx) => ...ctx.data` -> `error: (iss) => ... iss.input`) |
| `z.record(valueSchema)` one-arg removed | shared/protocol.ts:217, 223; shared/persistedEnvelope.ts:112, 206; lib/offlineSave.ts:43 -> `z.record(z.string(), ...)` |
| `z.ZodTypeAny` removed (use `z.ZodType`) | server/http/validate.ts:10,12,31; mount.ts:35; shared/http.ts:144-211 (13 sites, plus `z.input/z.output` which survive) |
| `.passthrough()` deprecated (still works) -> `z.looseObject` | shared/protocol.ts:158-252, shared/socketSchemas.ts:17, 86 (8 sites). Optional: deprecated, not removed. |
| `.email()` deprecated -> `z.email()` | shared/httpSchemas.ts:30 (`.trim().min(3).max(254).email()`: keep chain order, move to `z.string().trim().min(3).max(254).pipe(z.email())` or accept the deprecated method) |
| `.default()` short-circuits and returns the default as the OUTPUT type | `.catch(0).default(0)` at shared/persistedEnvelope.ts:138-139 and `.default([])` protocol.ts:169: semantics change, add a test per site. Existing property/fuzz tests in tests/ cover envelopes; verify. |
| `ctx.addIssue({ code: z.ZodIssueCode.custom ...})` deprecated | shared/gameStateSchema.ts:104 (`ZodIssueCode` still exists but deprecated; use `ctx.addIssue({ code: "custom", message })`) |
| `.transform()`/`preprocess()` return ZodPipe, `ZodEffects` gone | we only use the result types via `z.input/z.output/z.infer`; fine |
| `ZodError.format/flatten/errors` removed | we read `.issues[0]` only (validate.ts, gameStateSchema.ts:172, persistedEnvelope.ts:244); fine |
| `.strict()` / `.nativeEnum` / `.merge` / `z.coerce` / `z.function` | 0 uses |
| union/`z.unknown()` required keys in objects (4.4) | check `z.object({ ... z.unknown() })` sites such as persistedEnvelope `playerMap: z.unknown().transform(...)` (line 111): a missing key now fails parse where it used to pass. Needs a test. |

Dedup facts: root `zod ^3.24.2`; `@expo/cli` nests its own zod 3.25.76; `mutation-server-protocol` (Stryker) already nests zod 4.6.7; eslint-plugin-react-hooks accepts either. Nothing forces 3.

Advisory GHSA-mrhx-c7xc-m3w5 (https://github.com/advisories/GHSA-mrhx-c7xc-m3w5): unbounded issue accumulation when a large array fails per-element in `$ZodArray` (4.x core class). npm audit's range `<4.6.6` also catches 3.x, and no 3.x fix exists, so audit stays red on 3.x. Whether 3.25.76's classic `ZodArray` has the same flaw is not stated by the advisory; since the socket/HTTP boundary parses client arrays with it, treat as exposed until proven otherwise or add `.max()` on arrays (cheap, and independent of the upgrade).

Alternative: zod 3.25 ships `zod/v4` as a subpath (a changelog comment mentions it; I could not confirm from rendered docs). A file-by-file migration through `zod/v4` is possible but the advisory fix is only in zod 4.6.6+, so a full move to `zod@4` is the real remedy. Recommended: one PR, mechanical, behind the existing envelope/protocol tests.

### prom-client 15.1.3 -> @prometheus-io/client 0.16.1 (deprecated package)
- npm: prom-client deprecation text is "prom-client has been replaced by @prometheus-io/client". The replacement is published from the same repo (github.com/prometheus/client_js; package.json repository field), maintainers listed on npm: prombot (prometheus-team), nexucis (Augustin Husson, Prometheus team), juliusv (Julius Volz). First release 0.16.0 on 2026-08-24, 0.16.1 on 2026-08-27; only 4 versions published; version 0.x. Changelog: https://raw.githubusercontent.com/prometheus/client_js/main/CHANGELOG.md ("first release as a Prometheus subproject").
- Declared engines `node ^22 || ^24 || >=26`: we are on 22, ok.
- Breaking vs 15.x (changelog): package rename; Node 16/18/20/21/23 dropped; IPC message names renamed (cluster only); internal hashMap replaced by LabelMap (custom metric subclasses only); counter exemplars report value not delta; `MetricType` numeric enum -> string union; cluster primary now reports. Unreleased on main (not in 0.16.1): gauges no longer initialise to zero, `reset()` clears the label map.
- Our usage maps 1:1. Verified against the 0.16.1 tarball (`index.d.ts` and `lib/`): `Counter`, `Gauge` with a `collect()` callback (lib/gauge.js:112-116 calls `this.collect()` and awaits a promise; `this.set`/`this.reset()` exist), `register` default registry, `register.contentType`, `register.metrics()` (async), `register.getMetricsAsJSON()`, `register.getSingleMetric(name)?.get()`. We do not call `collectDefaultMetrics` (server/shared/eventLoop.ts hand-rolls event-loop delay with `node:perf_hooks`), no Histogram/Summary/Pushgateway/cluster. Files to touch: server/shared/metrics.ts:1, server/http/health.ts:5,126, server/http/rateLimit.ts:15, tests/server/healthMetrics.test.ts:5, tests/integration/sharedRateLimits.test.ts:12. That is five import lines.
- Watch: a gauge with no labels and no `set` call in 15.x rendered `0`; 0.16.1 still does (the change to not zero is in the unreleased section), so after the next release `event_loop_lag_p99_seconds` and `pg_connection_headroom` have `collect()` that always sets, no issue; `redis_reconnects_total` Counter is label-only, unaffected.
- Recommendation: LATER (or a small ticket), not now. It removes a deprecation warning but buys nothing functionally and the new package is 10 weeks old at 0.x. Do it when 0.17/1.0 lands or when the deprecation starts to matter, and keep the diff to five import lines. If the issue wants "no deprecated deps", it is safe to do now: risk is low and the tests above exercise the exact API.

### drizzle-orm 0.45 -> 1.0
Not GA: npm `latest` is still 0.45.4 and `rc` is 1.0.0-rc.5 (2026-10-21); GitHub marks every 1.0 tag "Pre-release" (https://github.com/drizzle-team/drizzle-orm/releases). Breaking items there (relational queries v2 default strategy, RQBv1 removed from postgres in rc.1, caches apply to relational queries, drizzle-kit non-interactive mode surfacing `missing_hints`) mostly do not touch us: no `db.query.*` anywhere in server/ or shared/, we use the query builder and raw `sql` and our own `transaction()` (server/store/db.ts) and `schemaDdl.ts` instead of drizzle-kit migrations. drizzle-kit `push` is only the dev/manual path (`drizzle.config.ts` + `tablesFilter: ["!session"]`); rc changes to push were not itemised in the notes, so re-test the `session` exclusion before ever adopting. Recommend: bump to 0.45.4, wait for GA. Note 0.45.4's only change is a postgres-js prepare fix, irrelevant to pg.

### express 5.2.1 -> 5.3.0 (inside ^5.0.1)
From https://raw.githubusercontent.com/expressjs/express/master/History.md: `content-disposition ^2.0.1` stops quoting token filenames; `content-type ^2.0.0` keeps charset params; `body-parser` invalid `limit` now throws at setup; default error handler logs `cause`. Our checks: server/http/errorHandler.ts is custom; find `limit:` values in `setupBodyParsing` (server/app.ts) and make sure they are valid strings/numbers; grep tests for exact `Content-Disposition` bytes (none found by name; run the suite).

### express-session / connect-pg-simple
express-session 1.19.0 is latest. connect-pg-simple 10.0.0 (2024-09-13), repo voxpelli/node-connect-pg-simple: 4 open issues / 19 open PRs, renovate configured, Tidelift. Quiet but not dead. It is used in one place (server/http/session.ts:1-38; plus a connection-ownership test, tests/server/pgConnections.test.ts). No obviously better maintained drop-in. The store is ~100 lines of SQL against a `session` table we already own and exclude from drizzle-kit; writing our own store is feasible (LATER, only if connect-pg-simple blocks a Postgres/pg upgrade).

### socket.io
No v5 (latest tag 4.8.4; alpha tag is 4.6.0-alpha1). 4.8.4: pending-ack cleanup on timeout, `emitWithAck` typing for void callbacks, ws ~8.21 (https://github.com/socketio/socket.io/releases).

### node-redis 6.x
Already on 6.3.0. v5 -> v6 breaks (RESP3 default, 5 s command timeout, keepAliveInitialDelay 30 s, plain-object replies, maintNotifications auto under RESP3) are explicitly pinned in `redisOptions` (server/store/redis.ts:62-75) so we see none of them; docs/v5-to-v6.md: https://raw.githubusercontent.com/redis/node-redis/master/docs/v5-to-v6.md. 6.4.0-beta.0 adds client-side caching modes, `createMultiDbClient` and reconnect-loop fixes: wait for GA. The reconnect fixes (stale `data` listener on socket error: 6.2.1; sequential retry counter, termination event: 6.4 beta) line up with our half-open watch in server/store/redis.ts and are the reason to track 6.4 GA.

### express-rate-limit 8.7.x / rate-limit-redis 6.0.2 / helmet 8.3 / pino 10.4
All inside caret, no majors. Release notes for express-rate-limit were not retrievable (changelog lives on a mintlify site not reachable here), so the only evidence is semver plus the audit entry for its `ip-address` dependency. Run tests/server/rateLimiterFactory.test.ts and tests/integration/sharedRateLimits.test.ts after the bump.

### ESLint 9 -> 10
ESLint 10.0.0 was released 2026-02-06; 9.x reached end-of-life 2026-08-06 (https://eslint.org/blog/2026/02/eslint-v10.0.0-released/); npm marks 9.39.5 deprecated ("This version is no longer supported"). Blockers, verified:
- `eslint-config-expo@58.0.4` (latest) pulls `eslint-plugin-react ^7.37.3` (latest 7.37.5, last modified 2025-04-03, peer `eslint ^3..^9.7`) and `eslint-plugin-import ^2.30.0` (latest peers up to `^9`). I downloaded eslint-plugin-react@7.37.5: `lib/util/version.js:31` calls `contextOrFilename.getFilename()`, which ESLint 10 removed, so the React plugin crashes on 10 (consistent with reports: https://github.com/techquestsdev/beer/pull/9).
- Our eslint.config.js (222 lines) does `require('eslint-config-expo/flat')` at line 8 (`expoConfig` spread at line 74), then `defineConfig` from `eslint/config`: flat only, already ESLint-10-shaped. eslint-plugin-react-hooks 7.1.1 and @typescript-eslint 8.72.1 already accept ESLint 10.
- So ESLint 10 needs either eslint-config-expo to drop/replace those plugins (watch), or us to stop using the expo preset and wire `@typescript-eslint/parser` + `react-hooks` + the import/react rules we actually rely on ourselves. Recommend LATER, tracked, because EOL 9.x means no more fixes. Interim: npm audit flags eslint 9 chain through `minimatch <11.0.1` (fix:false); add an `overrides` entry only if the team wants it quiet, since it is dev-only.

### Jest 29 -> 30
Constrained by jest-expo (see table). Do together with SDK 58/RN 0.88 (other agents' ticket). Our footprint at that point: 305 files import from "@jest/globals" (tests/native/**); jest.config.js already uses a per-platform project split. Do not bump jest alone: jest-expo 57 pins jest-29 sub-packages and a jest 30 root would produce mixed majors.

### TypeScript 7 (Go-native compiler)
- GA: npm `latest` is 7.0.2 (7.0.1-rc, 7.1.0-beta, 7.1.0-dev tags exist). The native compiler ships under the `typescript` name now (`bin/tsc`, platform optional deps `@typescript/typescript-linux-x64` etc.); `@typescript/native-preview` is nightly-only. Reported full-build speedup 8x-12x (secondary press: https://linuxiac.com/typescript-7-0-rewrites-the-compiler-in-go-for-up-to-12x-faster-builds/; the official devblog was unreachable). Not measured on this repo.
- Programmatic API: `typescript@7.0.2` `exports` is only `.` -> its own `version.cjs` under `lib` plus `./unstable/*`. There is no classic `ts.createProgram`/`ts.factory` API; per press, a stable API is planned for 7.1.
- Our code needs the old API: 27 files `import ts from "typescript"` (tests/helpers/typeShape.ts, moduleEdges.ts, routeSources.ts, hookSuppression.ts, many tests/server/*.test.ts, tools/loop/tests/..., scripts/iconSubsetChars.mjs) plus scripts/checkStrictIndexed.mjs:35 which resolves `typescript/bin/tsc`.
- typescript-eslint 8.72.1: peer `typescript >=4.8.4 <6.1.0`; support issue https://github.com/typescript-eslint/typescript-eslint/issues/12518 (status unverified).
- Microsoft's compatibility package exists: `@typescript/typescript6@6.0.2` (npm; I unpacked it): `tsc6` bin plus `import ts6 from "@typescript/typescript6"` re-exporting the TS 6 API.
- So the answer to "tsgo for typecheck only, tsc 6 for the rest": feasible, not free. Plan: keep `typescript ~6.0.3` as is (API consumers + typescript-eslint stay untouched) and add a second install of 7 under an alias for `npm run typecheck` only (`"typescript7": "npm:typescript@7.0.2"`, script `node node_modules/typescript7/bin/tsc --noEmit`). Do not repoint `typescript` itself. Unknowns to spike: (a) `expo/tsconfig.base` and our `paths` under 7; (b) `incremental: true` + `.tsbuildinfo` handling asserted by tools/loop/tests/incrementalTypecheck.test.ts; (c) `typecheck:strict` (checkStrictIndexed.mjs) which needs a tsc that reports errors identically; (d) any TS 6 vs 7 diagnostic differences (press says rare). Stryker 10's TS checker has "experimental TypeScript 7 support" (https://raw.githubusercontent.com/stryker-mutator/stryker-js/master/CHANGELOG.md, 10.0.0). Recommendation: LATER (spike); gain is wall-clock on the typecheck job only, and the verify gate runs it serially (package.json `verify`).

### esbuild 0.27.2 -> 0.28.2
0.28.0 only changes the npm-fallback download hash verification and Go 1.26.1; 0.28.1 fixes dev-server backslash advisory GHSA-g7r4-m6w7-qqqr and `using` inlining; 0.28.2 refuses to overwrite inputs without `--allow-overwrite` and, on build errors, writes nothing (https://raw.githubusercontent.com/evanw/esbuild/main/CHANGELOG.md). Our use: one CLI call in `server:build` (package.json: `esbuild server/index.ts --platform=node --target=node22 --packages=external --bundle --format=esm --outdir=server_dist`), output dir differs from input. No dev server. Safe; CI's `build` job boots the bundle on Node 22 (ci.yml:917-958) as the guard. Drop the exact pin for `^0.28.2`? The pin has no recorded reason; ask in the ticket, otherwise keep it exact and bump it.

### Playwright 1.62.1 -> 1.64.1
https://raw.githubusercontent.com/microsoft/playwright/main/docs/src/release-notes-js.md. Breaking (1.64): `screen` now comes from device descriptors (set `screen: undefined` to opt out), JSX follows tsconfig, `--update-snapshots=missing` now passes and default mode renamed `'default'`, elements in hidden iframes are hidden. 1.63: Ubuntu 20.04 unsupported, arm64 Chromium from Chrome for Testing. Impact: check tests/e2e/playwright.config.ts for `devices[...]` spreads and any `--update-snapshots` use in CI/scripts (not grepped in depth). Test runner adds `--shuffle`, `test.describe.configure({ lock })`, `retryStrategy: 'isolated'` (1.62), `AbortSignal` on actions. The bundled browsers change, so baselines for visual checks may move. 94 files import `@playwright/test`.

### Stryker 10.0.0 -> 10.1.1
No breaking changes. 10.1.0 adds test-timing diagnostics, mutant `duration`, CLI command-runner option; fixes a Babel-8 crash on TS non-null expressions. The tap-runner patch is pinned by filename to 10.0.0.

### @babel/core 7 -> 8
Not our decision: babel-preset-expo/Metro are Babel 7. Our direct uses (tests/ui-rules/reactCompiler.test.ts, scripts/react-compiler-probe.mjs, scripts/reactCompilerOptions.mjs) must stay on the same major as the app's compiler (CLAUDE.md "React Compiler can miscompile").

## 3. Features worth adopting / simplifications

| # | Feature | Replaces (file:line) | Gain | Risk | Verdict |
|---|---|---|---|---|---|
| 1 | socket.io connection-state recovery | our `game:rejoin` flow (client emits on connect; server/CLAUDE.md "Register every listener before the first await") | a short reconnect could replay missed packets | needs an in-memory/adapter buffer; with the `@socket.io/redis-streams-adapter` the recovery is supported only by that adapter, and the client is a separate socket instance per `lib/socket.ts`; recovery restores rooms but not our authoritative state (seat, ownership epoch, turn clock), so rejoin still has to run. Also one-socket-per-userId, ticket auth, and mobile app kill/restore all bypass it | REJECT |
| 2 | `emitWithAck` / `.timeout().emitWithAck` | already using `.timeout(...)`: server/socket/socketOutbox.ts:19, lib/sendIntent.ts:102 | `emitWithAck` returns a promise instead of nested callback | 4.8.4 fixes a pending-ack leak on timeout, so just take the bump | LATER (cosmetic) |
| 3 | express 5 async handler propagation | no `asyncHandler` helper exists (grep: none). The 11 `catch` blocks in server/http are deliberate (409 mapping at routes/account.ts:86-89 rethrows with `throw err` and relies on express 5 forwarding; admin.ts:18 and reports.ts:96 answer 500 themselves) | already adopted | none | nothing to delete |
| 4 | zod 4 `z.toJSONSchema`, faster parse | no schema export today | smaller/faster client bundle; JSON Schema not needed | migration cost | ADOPT zod 4 for the advisory and bundle; `toJSONSchema` REJECT (no consumer) |
| 5 | pino `redact` + transports | already used: server/shared/logger.ts:75-78 redact, :80-84 pino-pretty only in dev TTY | n/a | n/a | already adopted |
| 6 | node-redis `RedisClientPool`, typed scripts, `scanIterator`, client-side caching | `eval` of raw Lua strings at server/store/instanceInbox.ts:104, tableOwners.ts:44,51; no SCAN found | typed `defineScript` would replace the three `eval` call sites; pool is for blocking commands (we already segregate by connection profile in server/store/redis.ts) | server/CLAUDE.md requires every Redis connection to come from server/store/redis.ts and pgConnections test pins it; CSC needs RESP3 + tracking and a stale read of table owners is unsafe | `defineScript`: LATER; pool & CSC: REJECT |
| 7 | pg-native | pool.ts | none we can measure | libpq native build breaks the Node-22-in-container deploy | REJECT |
| 8 | drizzle `$count`, batch, generated columns | hand-written `sql\`count(*)::int\`` at server/shared/events.ts:68-74 and raw SQL in server/http/admin.ts:70-132 | marginal | transactions must stay on our own `transaction()` (server/store/db.ts, tests/server/transactionScan.test.ts); schemaDdl.ts owns DDL so generated columns would be hand-written there | REJECT |
| 9 | Playwright sharding, `--only-changed`, clock API | CI e2e job (see .github/workflows/ci.yml, tests/e2e/playwright*.config.ts) | `--only-changed` and `retryStrategy: 'isolated'` could trim local runs; `--shuffle` flushes inter-test coupling | docs/agents/checks.md says e2e cost/ports are tuned; sharding fights the shared local ports | `--shuffle` as a one-off audit: LATER; the rest LATER/REJECT unless e2e wall-time is a stated pain |
| 10 | TS 6 `--erasableSyntaxOnly`, `isolatedDeclarations` | tests run under Node strip-types (`node --test`, soak uses `--experimental-strip-types`, tsconfig.json comment line 5) | `erasableSyntaxOnly` makes the compiler reject enums/parameter properties/namespaces that Node's type stripping can't run, turning a runtime "unsupported syntax" into a tsc error | needs a clean tsc first; check for `enum`, `namespace`, `constructor(private x)` in lib/ server/ shared/ | ADOPT after a grep shows zero violations (cheap, aligned with the "check that doesn't look" invariant). `isolatedDeclarations`: REJECT, we don't emit .d.ts |
| 11 | compression 1.8 brotli | server/app.ts:228 `compression()` | already negotiates `br` since 1.8; nothing to enable. Optional: precompressed `.br` static assets for the web bundle | CPU cost of dynamic brotli at default quality on large JSON; pre-compression changes the deploy | already on; precompress LATER |
| 12 | `node:module` `SourceMap` replacing `source-map` | server/http/sourceMaps.ts:12,83 `SourceMapConsumer.with(...).originalPositionFor` | drop one dep; Node 22's `SourceMap#findEntry` gives originalSource/Line/Column | need parity with `name` and 1-based columns; tests/server/sourceMaps.test.ts:12 also uses `SourceMapGenerator` (test-only) | LATER, low value |
| 13 | `@types/node` explicit | undeclared today: lock has @types/node 26.4.1 pulled transitively by jest/@inquirer; production is Node 22 (deploy/runtime.json) | typecheck would flag a Node 23+ builtin (server/CLAUDE.md "newer-Node builtin compiles at exit 0") | possible fix-ups | ADOPT `@types/node@^22`, also declare `@types/pg` (undeclared, currently from the graph) |
| 14 | `ip-address` via express-rate-limit | used for IPv6 subnet keying | n/a | | free bump (section 5) |

## 4. Dependencies that can be removed or are dead

Grep: `from "<pkg>"` / require in server shared lib tests tools scripts app components context hooks.

- None are fully dead. Every direct server/tooling dependency is imported or referenced by a script:
  - used only via script/CLI (no import): `esbuild` (`server:build`), `tsx` (`server:dev`, tests/tooling references), `patch-package` (postinstall), `pino-pretty` (string target at server/shared/logger.ts:82), `drizzle-kit` (drizzle.config.ts, `db:push`), `@stryker-mutator/*` (stryker.config.mjs, tools/ci/mutation.mjs), `@expo/env` (scripts/assertNotE2EFast.js:4), `playwright` (scripts/build-sounds.mjs, scripts/build-court-art.mjs).
  - imported by exactly one file, still real: `helmet` (app.ts), `rate-limit-redis` and `express-rate-limit` (server/http/rateLimit.ts), `@socket.io/redis-streams-adapter` (server/socket/socketAdapter.ts), `source-map` (sourceMaps.ts + one test), `bcryptjs` (accountSession.ts, routes/auth.ts, scripts/reset-password.mjs), `mpg123-decoder` (tests/tooling/soundAssets.test.ts only), `fontverter` (tests/helpers/cmap.ts), `@breezystack/lamejs` (scripts/build-sounds.mjs), `canvaskit-wasm` (tests/ui-rules).
- Build-time-only packages that are in `dependencies` rather than `devDependencies` and could move if the production image installs with `--omit=dev`: none of the server packages (all needed at runtime). `source-map` is runtime (the symbolicate endpoint). `pino-pretty` is `dependencies`, only loaded in non-production dev TTY (logger.ts:79-84): could be a devDependency, with a check that production never reaches that branch (it is guarded by `NODE_ENV !== "production"`). Only worth it if the prod install should shrink; LATER.
- Replaceable by a built-in: `source-map` -> `node:module` SourceMap (item 12). No others: `cors` is already built by hand, no `uuid`, no `dotenv`, no `ws` direct.
- Undeclared but used (the opposite problem): `@types/node` and `@types/pg` come transitively; `@types/ws`, `@types/cors` also appear in the lock without being declared. Declare the two we rely on.

## 5. Security (npm audit, not fixed, nothing installed)

Raw JSON saved next to this file: `audit-prod.json`, `audit-all.json`. Summary counts: prod (`--omit=dev`) 41 = low 5 / moderate 31 / high 5 / critical 0; all 64 = low 6 / moderate 53 / high 5 / critical 0.

Distinct advisories (the remaining rows in the JSON are npm propagating the same issue up the dependency chain):

| package (where it comes from) | severity | advisory | fixed in | actionable by us? |
|---|---|---|---|---|
| **zod** (direct, 3.25.76) | HIGH | GHSA-mrhx-c7xc-m3w5 unbounded issue allocation on large arrays | 4.6.6 (we would take 4.6.7) | YES: zod 4 migration, or `.max()` on every array schema |
| decode-uri-component 0.2.2 (via query-string <- expo-router) | HIGH | GHSA-qr28-fpjm-wq7f quadratic percent-decode; GHSA-vcc3-ghjq-m6fr exponential | none <=0.5.0 listed; audit says expo-router 58.0.29 | Expo SDK ticket, client side |
| query-string (expo-router) | HIGH | via decode-uri-component | expo-router 58 | other agent |
| @expo/cli | HIGH | chain | `fix: true` | other agent |
| expo-router | HIGH | chain | 58.0.29 | other agent |
| **ip-address 10.7.0** (express-rate-limit dep `^10.2.0`) | moderate | GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw, GHSA-rxp7-6hxx-x8q5 (IPv6 parse DoS, family-confusion in subnet check) | >10.7.3; latest is 10.7.5 | YES, free: lock refresh (`npm update ip-address`). Server-reachable via rate-limit key generation on the client IP |
| qs 6.15.1 (typed-rest-client, dev only via Stryker/vsce chain) | moderate | GHSA-q8mj-m7cp-5q26, GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw | 6.16.1+ (the prod qs under express/body-parser is already 6.16.1) | dev-only, `fix: true` |
| minimatch (<11.0.1) (eslint 9 chain, @stryker core, typescript-estree, glob, @expo/fingerprint) | moderate | GHSA-g3hv-75wg-m249 globparts DoS | 11.0.1 | dev tooling only; eslint chain has fix:false because ESLint 9 won't be updated; @stryker core says 3.3.1 (npm's nonsense downgrade). Use an `overrides` entry or wait for ESLint 10 |
| glob 13.0.6 / 7.2.3 (jest chain, expo) | moderate | GHSA-3g3m-2fjr-6pw4 | >14.0.1 | jest/Expo ticket |
| deepmerge | low | GHSA-gcqx-w48m-w2h4 | | via Expo; client side |
| uuid 7.0.3 | moderate | GHSA-w5hq-g745-h8pq | 11.1.1 | via Expo (xcode, config-plugins) |
| esbuild <=0.24.2 (@esbuild-kit/core-utils nested esbuild 0.18.20, dev, via old drizzle-kit loaders) | moderate | GHSA-67mh-4wv8-2f99 dev-server request leakage | >0.24.2 | not exploitable here (no esbuild dev server run); drizzle-kit 0.31.11 does not remove @esbuild-kit (audit offers an old-downgrade). Ignore or `overrides` |
| jest family (jest, jest-*, @jest/*, babel-jest, create-jest, test-exclude, babel-plugin-istanbul) | low/moderate | propagated from glob/minimatch | jest 30 | blocked by jest-expo, see table |
| eslint 9 family (@eslint/config-array, @eslint/eslintrc, @eslint-community/eslint-utils, eslint-plugin-react/import, typescript-eslint packages) | moderate | propagated from minimatch | fix:false | blocked, see ESLint section |
| react-native / @react-native/jest-preset / virtualized-lists | moderate | range 0.85.0-nightly..0.87.0-rc.4 | 0.88.1 | Expo/RN agent (we are on 0.86.3) |

Production-server relevance, in priority order: (1) zod HIGH, (2) ip-address (free), (3) express 5.3.0 picks up qs/proxy-addr/body-parser CVE fixes (we are on 5.2.1 with qs 6.16.1 locked, proxy-addr and body-parser 2.4.0 locked: body-parser is already past the 2.3.0 fix). Everything else in the audit is client/Expo/dev tooling.

## 6. Suggested tickets / order

1. Free bumps in one PR (lock refresh + range-internal): socket.io(-client) 4.8.4, express 5.3.0, express-rate-limit 8.7.2, rate-limit-redis 6.0.2, redis 6.3.1, pg 8.23.1, drizzle-orm 0.45.4, drizzle-kit 0.31.11, pino 10.4.0, pino-pretty 13.2.0, tsx 4.23.15, yaml 2.9.1, subset-font 2.9.0, @typescript-eslint/parser 8.72.1, @testing-library/react-native 14.1.0, `ip-address` refresh. Run `npm run verify`.
2. zod 4 migration (security).
3. Tooling bumps: esbuild 0.28.2, Playwright 1.64.1 (+ browsers), Stryker 10.1.1 (+ regenerate the tap-runner patch), globals 17.
4. Declare `@types/node@^22` and `@types/pg`; spike `erasableSyntaxOnly`.
5. LATER bucket: prom-client -> @prometheus-io/client, TS 7 typecheck-only spike, ESLint 10 (blocked on eslint-config-expo), Jest 30 (with SDK 58), drizzle 1.0 GA, node-redis 6.4 GA, connect-pg-simple replacement.

## Sources

- https://raw.githubusercontent.com/colinhacks/zod/main/packages/docs/content/v4/changelog.mdx
- https://raw.githubusercontent.com/colinhacks/zod/main/packages/docs/content/v4/index.mdx
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- https://raw.githubusercontent.com/prometheus/client_js/main/CHANGELOG.md
- https://github.com/prometheus/client_js
- https://github.com/drizzle-team/drizzle-orm/releases
- https://raw.githubusercontent.com/expressjs/express/master/History.md
- https://github.com/socketio/socket.io/releases
- https://raw.githubusercontent.com/redis/node-redis/master/docs/v5-to-v6.md
- https://github.com/redis/node-redis/releases
- https://raw.githubusercontent.com/evanw/esbuild/main/CHANGELOG.md
- https://raw.githubusercontent.com/microsoft/playwright/main/docs/src/release-notes-js.md
- https://raw.githubusercontent.com/stryker-mutator/stryker-js/master/CHANGELOG.md
- https://eslint.org/blog/2026/02/eslint-v10.0.0-released/ (via search result title: v9 EOL 2026-08-06)
- https://github.com/techquestsdev/beer/pull/9 (eslint-plugin-react vs ESLint 10 failure)
- https://linuxiac.com/typescript-7-0-rewrites-the-compiler-in-go-for-up-to-12x-faster-builds/ , https://github.com/typescript-eslint/typescript-eslint/issues/12518
- https://github.com/voxpelli/node-connect-pg-simple
- npm registry (`npm view`): dist-tags and peerDependencies for typescript, @typescript/typescript6, typescript-eslint, eslint, eslint-config-expo, eslint-plugin-react, eslint-plugin-import, jest-expo, drizzle-orm, redis, socket.io, @prometheus-io/client; tarballs of @prometheus-io/client@0.16.1, @typescript/typescript6@6.0.2, eslint-plugin-react@7.37.5, compression@1.8.2 inspected under this scratchpad.
- Unreachable (network allowlist): devblogs.microsoft.com, zod.dev, infoq.com; express-rate-limit changelog (mintlify) not tried.
