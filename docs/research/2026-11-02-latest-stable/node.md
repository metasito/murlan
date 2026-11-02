# Node.js runtime research for #1911 (as of 2026-11-02)

Fetch limits: render.com, fly.io, docs.cloud.google.com did not resolve from this sandbox (not in the allowed network domains). Their facts below come from WebSearch snippets only and are marked.
Sandbox node is v22.23.4, so nothing here was run on 24/26. Every "works on 26" claim is unverified until CI runs it.

## 1. Schedule and recommendation

Source: https://raw.githubusercontent.com/nodejs/Release/main/schedule.json
| Line | Start | LTS | Maintenance | EOL | Codename |
|---|---|---|---|---|---|
| 22 | 2024-04-24 | 2024-10-29 | 2025-10-21 | 2027-04-30 | Jod |
| 24 | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 | Krypton |
| 26 | 2026-05-05 | 2026-10-28 | 2027-10-20 | 2029-04-30 | Lithium |
| 27 | 2027-04-22 | 2027-10-20 | - | 2030-04-30 | - |

- Today: 22 and 24 are both in Maintenance LTS (24 since 2026-10-20). 26 became Active LTS on 2026-10-28 (5 days ago). 25 is EOL (2026-03-31). 20 EOL.
- Latest patches (https://nodejs.org/dist/index.json, https://nodejs.org/en/about/previous-releases): v22.23.4 (2026-10-20, npm 10.9.9, V8 12.4, OpenSSL 3.5.9); v24.22.2 (2026-10-27, npm 11.19.1, V8 13.6, OpenSSL 3.5.9); v26.13.0 (2026-10-28, npm 11.20.0, V8 14.6, OpenSSL 3.5.9); v27.0.0-alpha.0.0.0 (2026-10-29, npm 12.1.0, OpenSSL 4.1.0).
- Release model (https://nodejs.org/blog/announcements/evolving-the-nodejs-release-schedule): confirmed. 26 is the last line under the old model. From 27: one major per year, Alpha Oct-Mar, Current Apr-Oct, every release becomes LTS in Oct (30 months LTS, 36 months total). The post says the schedule is not final.
- Hosting:
  - Render (search snippet of https://render.com/docs/node-version): precedence NODE_VERSION env, then .node-version, then .nvmrc, then package.json engines (docs warn to give engines an upper bound because ">=22" resolves to latest). Default for services created on/after 2026-04-21 is 24.14.1. Whether 26 is accepted was not verifiable.
  - Cloud Run (search snippet of https://docs.cloud.google.com/docs/buildpacks/runtime-support and /builders; ADR-0003 says production is Cloud Run): Node 24 listed, deprecation 2028-04-30; Node 26 listed as `nodejs26` but marked Preview on the lifecycle table. Sources disagree; re-check before choosing a Cloud Run buildpack build. A Dockerfile build is unaffected.
  - Fly.io: not fetchable. Dockerfile host, so any `node:26.13.0-alpine` image works.
  - Docker image: Docker Hub `library/node` tag `26.13.0-alpine` (= `26.13.0-alpine3.24`), updated 2026-10-28, index digest `sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94`; amd64 `sha256:d431b1d60cd8de74dc66d271c236f66227998c308e011e60faa9c60dc4d37382`; arm64 `sha256:81aab771be4f445efddcecc1f9efbace81be8d184bd9ec7a8e77b67890334c67` (https://hub.docker.com/v2/repositories/library/node/tags?name=26.13.0-alpine). Repo rule: tests/tooling/noDockerHubPulls.test.ts forbids Docker Hub pulls, so reference it as `mirror.gcr.io/library/node:26.13.0-alpine@sha256:c6ad...6d94`, as ci.yml does for redis (re-resolve the digest on the mirror).
  - setup-node: latest major is v7 (https://github.com/actions/setup-node); supports node-version-file `.node-version` and `lts/*`. The repo pins v4.4.0 in .github/actions/install/action.yml (CI-actions agent owns the bump). Node 26 should resolve like any major from the manifest; untested.

Recommendation: ONE Node everywhere = 26 (pin 26.13.0 in Docker; `.node-version` and runtime.json carry the major only, as the tests require). Why: it is Active LTS to 2027-10-20 and supported to 2029-04-30, versus 24 which is already Maintenance and EOL 2028-04-30 and 22 which EOLs in 6 months (2027-04-30). Every library now ships OpenSSL 3.5/V8 14. Gate: do it in one PR only if CI is green on 26 for all jobs, including Expo/Metro export, jest, Playwright, the iOS workflow. Fallback (one-line change, same file set): 24.22.2. Do not stay on 22. The dev-24/prod-22 split should be removed: the only reason it exists (server/CLAUDE.md:19-21) is that production lagged. With one version, the `build` job's `node-version` override and its "this job's Node is production's" shell guard become redundant; replace with a test that `.node-version` major == runtime.json `node` (tests/tooling/installAction.test.ts and tests/server/deployRuntime.test.ts currently encode the split).
Caveat on 26: five days old as LTS; native addons need a rebuild (NODE_MODULE_VERSION 147). Check the repo's native/postinstall deps (patch-package, sharp-like bake scripts, Playwright, jest/Expo watchman) install cleanly.
Open known hazard: scripts/nodeTest.mjs:10-15 `NO_BACKGROUND_JIT` works around a Node 24 `--test-force-exit` hang (#1590) with V8 compiler threads. Re-test on 26 (V8 14.6) both with and without the flags; remove them only if proven unnecessary, otherwise keep.

## 2. Breaking changes 22 -> 26 vs this repo (grepped before flagging)

Sources: https://nodejs.org/en/blog/release/v24.0.0, v25.0.0, v26.0.0, https://nodejs.org/docs/latest-v26.x/api/typescript.html
- Type stripping: unflagged default since 22.18/23.6, warning removed 22.18/24.3, Stable 24.12/25.2; `--experimental-strip-types` still accepted, no warning stated (verify on 26: run `node --experimental-strip-types -e 1`). Uses: package.json:45 (`soak`), tests/helpers/instance.ts:23, tests/tooling/processGuards.test.ts:23. Action: drop the flag in all three (no behaviour change). `--experimental-transform-types` removed in 26: grep found no use.
- AsyncLocalStorage -> AsyncContextFrame (24): `grep AsyncLocalStorage` over server/shared/lib/tests/tools/scripts: zero hits. No impact (but pg/socket.io/pino-style libraries may use it internally; run integration suite).
- Removed/deprecated APIs: grep of server/shared/lib/scripts/tools for url.parse, util.is*, SlowBuffer, fs.F_OK, process.binding, new Buffer(, fs.exists( : zero hits (the only `require(` hits are client-side Metro asset requires in lib/). `http.Server.writeHeader`, `_stream_*` removed in 26: not used in repo; transitive deps (npm audit by deps agent) could use `_stream_*` - the full test run on 26 will tell.
- OpenSSL: 22.23.4 already has OpenSSL 3.5.9, same as 24/26 (dist/index.json). No security-level change to chase. DEP0182/0203/0204 crypto runtime deprecations in 26: repo uses only randomUUID and bcryptjs (pure JS), no hit.
- Undici 7 (24) -> 8.0.2 (26): repo uses global `fetch` with `AbortSignal.timeout` (server/http/mail.ts:83, server/socket/push.ts:115, scripts/probe-health.mjs:21). API stable; the tests that stub fetch should still pass. Verify.
- npm 10.9.9 -> 11.20.0: lockfile format and `npm ci` behaviour not verified (no source fetched). Action: run `npm ci` under 26, then `npm install --package-lock-only` and confirm `package-lock.json` has no diff; check patch-package postinstall and `engines` warnings. Corepack is no longer shipped (25+): repo does not use corepack (no grep hit expected; confirm).
- node:test: process isolation default, `--test-force-exit`, `--test-concurrency`, `--test-reporter(-destination)` still documented (https://nodejs.org/docs/latest-v26.x/api/test.html); stable. Custom reporter tests/helpers/filesRunReporter.mjs: re-run on 26 (reporter event shapes changed rarely, but verify). `t.mock.timers` already used (tests/server/ownershipReclaim.test.ts:115).
- Temporal enabled by default in 26: additive; no clash (grep for a global `Temporal` shim not done; low risk).
- V8 14.6: nothing to fix; the NO_BACKGROUND_JIT note above is the real risk.
- Build target: esbuild 0.27.2 `--target=node26` (esbuild takes any nodeN).

## 3. Built-ins vs dependencies / hand-rolled code

| Item | Repo usage | Verdict | Reason |
|---|---|---|---|
| Native type stripping instead of tsx for dev | package.json:12 `server:dev` = tsx; scripts/e2e-server.mjs:103 `npx tsx server/index.ts`; tsx devDep package.json:135 | ADOPT | tests/helpers/instance.ts:23 already boots server/index.ts with `node --experimental-strip-types`. grep `enum`/`namespace`/parameter properties in server shared lib: zero real hits. `node --watch server/index.ts` for dev. Add `erasableSyntaxOnly` (absent from tsconfig.json; TS 6.0.3 supports it) so a future enum fails typecheck, not at runtime. Also note tools/loop/guard-bash.mjs:528-530 special-cases `tsx`; leave. Caveat: Node refuses .ts under node_modules, ignores tsconfig paths (server uses relative .ts imports; allowImportingTsExtensions already on tsconfig.json:6). `--watch` stability: verify docs. |
| Production runs .ts directly, drop esbuild | package.json:15 `server:build`; scripts/server-prod.mjs | REJECT | Bundle is the one tested artefact (CI build job boots it); stripped .ts has no sourcemaps (whitespace replace, line numbers kept, but no bundling = many file reads at cold start on Cloud Run), and lib/shared imports must stay `.ts`-clean. esbuild stays. Revisit only if cold start proves a non-issue. |
| `--env-file` / `process.loadEnvFile` | no dotenv in server/scripts; `@expo/env` (package.json:107) is Expo's | LATER | Nothing to replace; only worth it for a local `.env` convenience. |
| zlib zstd | server/app.ts:228 `compression()` (dynamic gzip on every response incl. static dist at app.ts:153) | REJECT zstd (zstd streams are Stability 1 Experimental per https://nodejs.org/docs/latest-v26.x/api/zlib.html; Chrome/Safari support not verified) | Better: pre-compress dist at build with brotli (zlib.brotliCompress is stable) and serve .br/.gz via express static variant or let the host CDN do it. Verdict LATER; depends on host (CDN may already compress). compression@1.8.x brotli support not verified. |
| `fs.glob` | tools/ci/mutation.mjs:7,71 already uses `globSync` | DONE | nothing |
| `util.styleText` | no color code found in server; scripts not grepped | LATER | cosmetic |
| URLPattern global (24) | Express routes | REJECT | no use case |
| Explicit resource management (`using`) | server/store/pool.ts:164-195 `inTransaction` hand-rolls begin/rollback/release with release(err) destroying the client | LATER (leaning ADOPT) | V8 13.6 in Node 24+ (https://nodejs.org/en/blog/release/v24.0.0) so runtime support exists on 26; TS 6 supports it. BUT `release(err)` on failure and rollback-cause chaining (appendCause) is not a plain dispose; a `using` rewrite loses that precision. Type stripping passes `using` through (plain JS); esbuild lowers it for node22 but with --target=node26 it is emitted as is. Not worth rewriting the tested function. Could suit simple lock/timer scopes. |
| Error.isError, Promise.try, RegExp.escape, Array.fromAsync, Iterator helpers, Set methods, Map.getOrInsert | grep for hand-rolled `new Set(...).filter(has)` found none; only reduce sums | LATER | opportunistic, no clear call site |
| node:sqlite | no use | REJECT | Postgres is the record (ADR-0014) |
| Permission model `--permission` | server boots Postgres/Redis sockets (`--allow-net` added in 25) | REJECT for now | needs fs/net/child allow-lists; Cloud Run container is already the sandbox; high breakage risk, low gain |
| Heap flags `--max-old-space-size`/semi-space | none set | LATER | measure first on Cloud Run memory limit |
| getActiveResourcesInfo | none | REJECT | |
| Built-in WebSocket client | tests use socket.io-client | REJECT | |
| node:test snapshot / coverage | `t.assert.snapshot` stable since 23.4; coverage still experimental flag | LATER | no hand-rolled snapshot helper checked; mutation job (stryker) covers quality |
| crypto.hash one-shot | no sha/md hashing in server grep (only randomUUID: server/game/tableRouter.ts:15, server/store/redis.ts:1) | LATER | no call site |
| structuredClone | lib/game/gameEngine.ts:798,850,914 | DONE | |
| AbortSignal.timeout | mail.ts:83, push.ts:115 | DONE | |
| monitorEventLoopDelay | server/shared/eventLoop.ts uses perf_hooks histogram | DONE | |
| diagnostics_channel | no | REJECT | pg/redis tracing not needed |
| import.meta.dirname | already used in tests | DONE | |
| `node --run` for npm scripts | CI runs `npm run ...` | LATER | saves ~100s of ms per call; scripts using `pre*` hooks (pretest preflightMemory) are NOT run by `node --run` (verify), which would silently skip the preflight. Risky, REJECT unless hooks are inlined. |
| bcryptjs -> crypto.argon2 | server/http/accountSession.ts:2, server/http/routes/auth.ts:2, scripts/reset-password.mjs:20 | LATER | `crypto.argon2`/`argon2Sync` exist in 26 docs (added v24.7.0; stability label changed from release candidate to stable in a later commit, release not confirmed: https://github.com/nodejs/node/commit/5402b5e). Stored bcrypt hashes cannot be converted: migration = verify with bcrypt on login, rehash with argon2 and store an algo-prefixed hash. Also argon2 runs on the libuv threadpool (default 4), so size UV_THREADPOOL_SIZE. Benefit: drops a dependency, memory-hard hash. Cost: schema/verify path change and security review. Raise as a separate ticket. |

## 4. Exact pins and files to change (for 26 line; fallback 24.22.2)

Pins: Node 26.13.0 (2026-10-28); image `mirror.gcr.io/library/node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94` (digest from Docker Hub; confirm on mirror). No Dockerfile exists in the repo today (no host chosen; ADR-0006, #1105).
Files:
1. `.node-version`: `24` -> `26`
2. `deploy/runtime.json`: `"node": 22` -> `26`
3. `package.json:5-7` engines `>=22` -> `>=26` (tests/server/deployRuntime.test.ts:16 requires `>=<manifest major>`; engines floor also gates npm install on contributor machines)
4. `package.json:15` `--target=node22` -> `--target=node26`
5. `.github/workflows/ci.yml:910-930` (build job): `node-version: "22"` -> "26", or delete the override and the shell guard step and fix comments; if deleted, rewrite tests/server/deployRuntime.test.ts:22-28 (reads build job node-version) and tests/tooling/installAction.test.ts:23-31 (spelled pins must equal production) into ".node-version major == runtime.json node"
6. `server/CLAUDE.md:19-21` ("Production runs deploy/runtime.json's Node (22), not the repo's") - rewrite; tests/tooling/claudeMdScope.test.ts:23 expects "deploy/runtime.json" to stay mentioned in that file
7. `.claude/workflows/audit.mjs:94,264` ("Builtins newer than Node 22", "--target=node22")
8. Drop `--experimental-strip-types`: package.json:45, tests/helpers/instance.ts:23, tests/tooling/processGuards.test.ts:23
9. If adopting native dev: package.json:12 -> `node --watch server/index.ts`, scripts/e2e-server.mjs:103, remove `tsx` (package.json:135), add `erasableSyntaxOnly` to tsconfig.json
10. package-lock.json only if npm 11 rewrites it (verify); `tests/tooling/noDockerHubPulls.test.ts:274` is a fixture string, no change.
11. Node-modules cache key already includes node version (.github/actions/install/action.yml:27): first run cold.
