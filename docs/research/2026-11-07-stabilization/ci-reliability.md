# CI forensics: metasito/murlan `ci.yml`, last 300 runs (2026-10-26 to 2026-11-05)

Method: every failed job's log was fetched (`gh api .../actions/jobs/<id>/logs`, kept in `scratchpad/logs/`).
Failing tests come from node's `✖ failing tests:` block, jest's `●`/`FAIL` lines and Playwright's `✘`/`1) [chromium]`.
`head_sha` and rerun history come from `runs/<id>` and `runs/<id>/attempts/<n>/jobs`. The runs list shows
only each run's latest attempt, so 8 more runs that failed on attempt 1 and passed on a rerun were also pulled
and included. A job counts as REAL when the failing test is about what the PR's diff changed and later commits on
the branch went green (diffs checked with `pulls/<n>/files`).

## 1. Counts

### Failed jobs (99, CI-gate roll-ups excluded)

| Category | Jobs | Share |
|---|---|---|
| REAL | 51 | 52% |
| FLAKE | 13 | 13% |
| INFRA | 35 | 35% |

### Failed run-attempts (65 = 57 visible failures + 8 hidden by a green rerun)

| Category (worst job in the run) | Runs |
|---|---|
| REAL | 33 |
| FLAKE only | 10 |
| INFRA only | 22 (14 visible + all 8 hidden reruns) |

**About half of all red runs (32 of 65) were not the PR's fault.**

### Failure rate by event (latest attempt, completed runs)

| Event | Completed | Failed | Rate |
|---|---|---|---|
| push to main | 68 | 0 | 0% |
| pull_request | 166 | 49 | 29.5% |
| workflow_dispatch | 14 | 6 | 43% |
| schedule (main) | 2 | 2 | 100% (both INFRA, §2.2) |

The 0% on main pushes does not show main is healthy: 39 of the 40 main pushes sampled had
`Typecheck and tests` = **skipped** (`scope` skips a tree that already went green on its PR). Main pushes
almost never run the suite (§3.1).

## 2. Ranked causes (FLAKE and INFRA), with root cause and durable fix

### 2.1 Secret scan scans every branch in the repo, not the change. INFRA, 10 jobs (6 PR runs, 1 main schedule, 1 hidden rerun, ...)
- Findings: `generic-api-key` on `docs/research/2026-11-02-latest-stable/postgres.md:195` (prose containing "OAuth",
  commit 085fcb5b) and on `tests/helpers/instance.ts:86` (`password: "password123"` in a test helper, commit 2a6cd65a).
  Both are false positives.
- **Root cause (verified):** `.github/workflows/ci.yml:162-164` checks out with `fetch-depth: 0`. For a PR, actions/checkout
  then fetches `+refs/heads/*:refs/remotes/origin/*`, which is 159 branches (seen in the log of job 125274696539).
  `.github/scripts/gitleaks-scan.sh:13-14` then runs `gitleaks detect` over the whole repo, which covers all refs.
  So a commit on **any** pushed branch reddens **every** run. Evidence: PR `agent/1892-round-lands-once` and main's
  schedule run both failed on commit 085fcb5b, which belongs to `agent/1911-latest-stable-releases` and is not in main's
  history (`git cat-file` here: bad object). `agent/1894` failed on `agent/1893`'s commit 2a6cd65a. The main schedule
  run's SHA b05dd9fd passed later with no change of its own.
- **Fix:** scan only what the run is accountable for. Use `gitleaks detect --log-opts="<base>..HEAD"` on PRs. For the
  full-history audit, use `git log HEAD` (not `--all`) on main/schedule, or check out with `fetch-depth: 0` plus
  `git fetch origin main` only. Separately, allowlist the two false positives in `.gitleaks.toml` with `condition="AND"`
  (path plus regex), as the file already does for its other entries.

### 2.2 Billing lock: jobs never started. INFRA, 10 jobs (5 runs, 2026-10-26 and 10-28)
- 0 steps, no runner, about 3 s each. The check-run annotation says *"The job was not started because your account is
  locked due to a billing issue."* (verified on 122772017190 and 121839269863). This covers every failed
  "Timing budget", "Does this change need the suite?" and log-less "Secret scan" job. Fix: account billing. This is
  not a code issue.

### 2.3 Browser shards: registry pull of the Postgres/Valkey image. INFRA, 9 jobs (7 run-attempts, 6 hidden by reruns)
- `[WebServer] failed to copy: httpReadSeeker: failed open: could not fetch content descriptor sha256:... not found`
  from `mirror.gcr.io`, then `scripts/dev-stack.mjs up exited with code 1`. Every occurrence is on or before 2026-11-02.
- **Root cause:** `scripts/dev-stack.mjs:30,36` pull from `mirror.gcr.io`, a pull-through cache that sometimes 404s a
  blob it has not cached. Each of the **17** shards pulls the image separately (`dev-stack.mjs:187-189, 248-250`), so one
  bad registry minute reddens several shards at once (41424795639 lost 2 shards).
- Status: c557fd4e (2026-11-02 19:29) added these strings to `TRANSIENT` (`scripts/dockerEngine.mjs:19`) with
  backoff, and none has recurred since. That fix is a retry. **Durable fix:** run Postgres/Valkey as job `services:` in
  the browser job, as the node jobs already do with no pull failures in the window. Or pull once in `scope`,
  `docker save` to `actions/cache`, and `docker load` in the shards.

### 2.4 `roomVisibility` race: listener armed after the event can arrive. FLAKE, 5 jobs on 5 different PRs (2026-11-02)
- `tests/integration/roomVisibility.test.ts:119` "a started room stops taking players before the round exists" failed
  with `timed out waiting for "game:started"` on 5 PRs (branches agent/1885, 1886, 1887, 1890, 1891). None of these PRs touched it.
- **Root cause (verified):** a full quick-match room starts itself, so `game:started` could arrive together with the
  `room:state` being awaited. The test only subscribed to `game:started` after that. **Already fixed** by cb4180c1
  (listener created before `room:join`, now `roomVisibility.test.ts:136`). Main never saw it because main pushes skip
  the suite (§3.1).

### 2.5 Browser `WebSocket is closed before the connection is established` fails the console-error gate. FLAKE, 2 jobs
- `oneAccessibleNode.spec.ts:139` on main (`workflow_dispatch`; the same SHA cdbbcd4f passed later) and
  `accountRecovery.spec.ts:10` on #1950 (a CI-config-only PR).
- **Root cause (verified in code; the trigger is inferred):** both specs `page.goto(baseURL)` and then sign out at once
  (`oneAccessibleNode.spec.ts:166-170`, `accountRecovery.spec.ts:52-53`). The reload creates a socket with
  `autoConnect: true` (`lib/socket.ts:79-100`). Signing out runs `SocketContext`'s effect, which calls `disconnectSocket`
  (`context/SocketContext.tsx:292` → `lib/socket.ts:113-117` `s.disconnect()`) while the websocket is still CONNECTING.
  Chrome then logs the warning. Whether it shows depends on how the handshake races the sign-out click. The fixture
  (`tests/e2e/fixtures.ts:24-34`) allows only the offline variant.
- **Fix:** in the app, do not close a socket that is still connecting: in `disconnectSocket`, if `!s.connected && s.active`,
  wait for `connect`/`connect_error` and then disconnect. Or open the socket only once the session is known. Do not add
  the message to `isExpectedNoise`, because that would hide real early disconnects.

### 2.6 Native tests: library-default async timeouts on a 2-worker runner. FLAKE, 2 verified jobs (plus 1 REAL-probable)
- `historyScreen.test.tsx` "shows the full error…" on #1907 (a server PR): `findByText` missed at RNTL's 1 s default.
  `exchangeKeyHolds.test.tsx:95` on #1949 (a docs/research PR): jest's default 5 s test timeout.
- **Root cause:** RNTL's `asyncUtilTimeout` of 1000 ms and jest's 5000 ms against cold-transform CI runs measured up to
  8.6 s (`jest.config.js:75-78`). **Already fixed** on 2026-11-03 by b54a90ad/779e165a (`testTimeout: 80_000`) and
  98fa6c19 (`tests/native/setup.ts:178`, `asyncUtilTimeout: 10_000`). Here the longer timeout is justified: the budget
  was measured, and the old one was provably too small. None has recurred since.

### 2.7 Usernames minted with a 3-digit random suffix collide (409). FLAKE, 1 job, partly fixed
- `bannerDisplaces.spec.ts:103` got `409 USERNAME_TAKEN` on #1973. At that SHA `uniqueUsername` was
  `prefix + ms36.slice(-6) + rand(100..999)` (900 values per millisecond, with 17 shards writing to one database).
  6033b8bd fixed the helper (`tests/e2e/helpers/navigation.ts:109-113`, a per-worker counter plus a 4-char base-36 tail).
- **Still open (verified):** `tests/e2e/tapTargets.spec.ts:254, 293, 456` mint names inline with the old scheme.
  Fix: call `uniqueUsername`.

### 2.8 Ports picked by `freePorts` are released and re-bound later (TOCTOU) under `reusePort`. FLAKE, 2 jobs (mechanism verified, exact trigger unverified)
- `sharedRateLimits.test.ts:101`: `instance on 44201 exited with 1 before it came up`, on #1977 (a client-only PR).
  `presenceCluster.test.ts:95` and `presenceCrash.test.ts:48`: `the handshake was refused: Not authenticated`, also on #1977.
- **Root cause:** `tests/helpers/instance.ts:14-20` `freePorts` listens on port 0, reads the port and **closes** it. The
  port is used much later: `sharedRateLimits.test.ts:72-73` reserves `spare` in `before()` and boots on it only in the
  last test (`:103`), and `presenceCluster.test.ts:19` / `presenceCrash.test.ts:18` pick theirs at import. With
  `--test-concurrency=8` (`package.json:35`), another file can be handed the same port in the meantime. The server
  listens with `reusePort` (`server/index.ts:23`), so two suites' servers can share a port silently. The kernel then
  splits connections between them, and a cookie minted by one instance (with its own scoped database) is unknown to the
  other, which gives "Not authenticated". A non-reusePort holder gives EADDRINUSE, which is exit 1. The diagnosis is
  hidden twice: `LOG_LEVEL: "silent"` and `stdio: pipe` with nothing printed (`instance.ts:37-41, 49`).
- **Fix:** boot with `PORT=0` and read the bound port from the listen log line. `watch()` already reads stdout.
  This removes the window entirely. At a minimum, include the child's stderr in the "exited with" error.

### 2.9 `npm audit` gate reddens on a newly published advisory. INFRA, 3 jobs (2026-10-28)
- `tools/ci/audit-gate.mjs`: `fixable without a major bump: node-forge (high)`, on two unrelated PRs. Each attempt is a
  fresh query against the advisory database, so a PR that passed goes red without changing.
- **Fix:** run the audit on schedule/main and open an issue, or gate a PR only on advisories in packages its lockfile diff
  touches.

### 2.10 Browser test report: the timings self-check can never pass. INFRA, 2 jobs (both schedule runs on main)
- `node --test tests/tooling/e2eShardSplit.test.ts` fails with `ERR_MODULE_NOT_FOUND: Cannot find package 'yaml'` from
  `tests/helpers/workflow.ts:4`.
- **Root cause (verified):** the `report` job (`ci.yml:777`) installs only the Playwright CLI into `$RUNNER_TEMP/pw` (`:805`)
  and never runs `npm ci`. The guard at `ci.yml:907` imports `yaml` through `e2eShardSplit.test.ts:22`, so it fails every
  time and `tests/e2e/timings.json` is never regenerated (last touched 2026-10-21). The same log warns that
  controlRail, exchangeAttribution, feltNap and tableProportions now take 2-3x their committed times. This is a
  safeguard that fails without ever looking.
- **Fix:** `npm ci` (from the cached node_modules) in `report` before that step. Or make `e2eShardSplit`'s timings
  assertion a dependency-free script.

### Single occurrences
- 41507596810 attempt 1: `upload-artifact` failed with `FinalizeArtifact ECONNRESET`. INFRA.
- 41582427029 attempt 1: `iOS compiles` cancelled after about 35 min (timeout). #1950 later capped it at 30 min. INFRA.
- 40340243287 `Node tests 2/2` (a sharded node job, since retired): `tests/tooling/testHangs.test.ts:30,113`. The
  planted child run printed `test shard: 2/2`, so the parent's shard env leaked into the child `npm test`.
  FLAKE/env-leak, **unverified** which variable.

## 3. Structural

1. **Main pushes don't test.** `scope` skips the suite on main when the tree went green on its PR (39 of 40 main pushes
   sampled: `Typecheck and tests` skipped). A race that lands on main (§2.4) surfaces on the next five PRs instead.
   The 0% main failure rate measures the skip, not main's health. Consider one full run per N main merges, or the nightly.
2. **Every branch's history is part of every run** (§2.1). One branch with a false positive turned 6 other runs red,
   including main's schedule.
3. **Committed outputs of other checks.** Several REAL failures were PRs tripping over files that checks write and the
   repo commits:
   - `tests/e2e/57-polish-audit/online-table.txt`, which must be regenerated by "a whole run, not a shard"
     (`onlineTableSurvey.spec.ts:453`). No shard can do it, so a layout PR fails until someone runs all 17 locally.
   - `tests/fixtures/storedShapes.json`, which tripped #1918.
   - `tests/fixtures/protocolHashes.json`.
   - The `components/CLAUDE.md` line budget, which tripped #1983.
   - `timings.json`, whose regeneration is itself broken (§2.10).
   - The `fixed real-time wait inventory … at its exact count`, which tripped #1903.

   These are REAL by the rules, but each costs a CI round trip that a local pre-push generator would avoid.
4. **Meta-tests over prose and research directories.** `docs/research/**/*.ts` is typechecked and scanned
   (#1949 TS2345 in `docs/research/2026-11-02-latest-stable/valkey/entry-sizes.ts`, and #1899's "every top-level
   directory with TypeScript is scanned"). Research reproductions pay app-grade gates.
5. **17 browser shards, each with its own `docker pull` plus dev-stack boot,** multiply per-job infra exposure 17x
   (§2.3). Shared services (job `services:`) or fewer, longer shards cut it.
6. **The console-error gate is binary and app-wide.** One benign Chrome warning (§2.5) fails an unrelated spec on another
   shard. That is correct as policy, but the app-side race should be fixed rather than retried.

## Appendix: REAL jobs (51), for completeness
- #1977 table polish: 13 browser jobs (seatNameContrast, oneWayExchange@1024, onlineTableSurvey record, pileBeaten
  shade, flightOrigin, lampSeats, handClearance, handResizeNoPop). Persistent across 4 commits, then green.
- #1974 Skia felt: seatNameContrast ×2 plus native theme. #1973 lamp layer: native cardLevelShade. #1966 card shadows:
  native theme. #1980: oneWayExchange@1024, which is the PR's own subject.
- #1941 server bumps: musicLoops, because the PR re-encoded `assets/music/*.webm` and bumped Playwright 1.62→1.64.
  native historyScreen is REAL-probable, since the PR edits that test.
- #1942 Expo 58: blanking test, tapTargets, lampSeats, controlRail. REAL-probable, because an SDK bump changes layout.
  Not individually verified.
- #1930 addressed delivery: "a snapshot queued while the commit runs…" ×3. agent/1894 presence in Redis: 3 node jobs.
  #1905: rematch.test.ts:224 30 s timeout ×2 (REAL-probable).
- #1918 zod4 stored wire shape. #1903 and #1901 wait-inventory/exempt-call meta-tests. #1899 research TS directory.
  #1881 loop-guard tests (Linux plus Windows, 17 fails). pr-1974-conflicts guard-config tests. #1983 CLAUDE.md budget.
- `agent/ci-test-budgets` ×7 (lint, typecheck `timeoutHeadroom.test.ts:76`, its own tooling tests).
  #1949 research typecheck. #1874 React Compiler bailouts. #1969 homeHeroSignedOut (REAL-probable: the PR edited
  `tests/native/setup.ts`).
