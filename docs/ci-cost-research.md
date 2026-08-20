# CI cost research: cutting the browser job's wall-clock without N× setup

Research for #51 ("Split the browser tests across several CI runners"). Scope: how to
cut the `browser` job's wall-clock (9m34s of a 9m48s run — the critical path) without
re-paying its ~210s of fixed setup per shard, and what genuinely shrinks that 210s at
all. No file other than this one was changed.

**Repo facts used below** (read from `.github/workflows/ci.yml`,
`tests/e2e/playwright.config.ts`, `scripts/e2e-server.mjs`, `scripts/assertNotE2EFast.js`,
`package.json`, `ls tests/e2e/`):

- The `browser` job's setup is: `actions/checkout@v4` → `actions/setup-node@v4` (already
  `cache: npm`) → `npm ci` → `npx playwright install --with-deps chromium` → the suite's own
  `expo export --platform web` (triggered inside `scripts/e2e-server.mjs`, which Playwright's
  `webServer` invokes). Total ≈ 210s; the browser job overall is 9m34s (574s) per the
  comment in `ci.yml` citing run 32304169964.
- `tests/e2e/playwright.config.ts` sets `workers: 1`, `fullyParallel: false`. Nine spec
  files (1,476 lines, very unevenly sized: `tapTargets.spec.ts` 354 lines vs.
  `offlineResume.spec.ts` 80 lines), all driven against **one** `webServer`-launched
  Express/Socket.io process and **one** disposable Postgres (`scripts/dev-stack.mjs`, via
  `scripts/e2e-server.mjs`) — not the `services:` Postgres container the `verify`/`build`
  jobs use.
- The `build` job's web bundle (`npm run expo:web:build`) is **not** reusable by the
  browser job: `scripts/assertNotE2EFast.js` fails the build if `EXPO_PUBLIC_E2E_FAST` is
  set, while `scripts/e2e-server.mjs` sets exactly that (line 35) to bake in zero-delay
  AI/result pacing. The two bundles are deliberately different builds — one job's artifact
  cannot substitute for the other's.
- `tests/e2e/zzMeasure.spec.ts` (untracked, not part of the suite discussed here) is a
  one-off screenshot script, irrelevant to this research.

---

## 0. Measured baseline (run 32318614243, green, 2026-08-20)

Everything below §1 was arithmetic on the figures quoted in #51. Those figures are wrong.
These are read from the run's own step timings and job log.

| Job | wall | where it goes |
|---|---:|---|
| Does this change touch the app? | 3s | — |
| Typecheck, test, lint | 317s | `npm test` **230s**, containers 21s, `npm ci` 22s, lint 21s, typecheck 8s |
| Native tests | 91s | jest 62s, `npm ci` 24s |
| **Browser tests** | **572s** | `npm ci` 28s, `playwright install` 26s, then the 513s test step: `expo export` **57s** + **456s** of tests |
| Build and boot | 232s | `expo:static:build` **126s**, web+server bundles 63s, `npm ci` 23s, containers 14s |

Run wall-clock 578s. Billed, at GitHub's per-job round-up: 1+6+2+10+4 = **23 minutes per full run**.

Corrections to what #51 assumed:

- **Fixed setup in the browser job is ~114s, not 210s** — 28s `npm ci` + 26s Playwright
  install + 57s `expo export` (the export runs inside the test step, via `webServer`).
  Test execution is 456s, **80% of the job**. Sharding attacks the 80%; the setup penalty
  it re-pays is smaller than the issue priced it.
- **`--with-deps` installs nothing on `ubuntu-latest`.** The job log shows every package
  Playwright asks for reported `already the newest version`; the step's apt cost is an
  `apt-get update` fetching 11.4 MB of index (~12s), followed by zero installs. This
  contradicts the inference in §2.5 drawn from the runner-images manifest — the log is
  direct evidence and wins. The Playwright Docker image is therefore worth ~26s of 572s,
  not the standout lever §3 ranks it as.
- **The specs already isolate themselves in the database.** `tests/e2e/online.spec.ts` and
  `iconGlyphs.spec.ts` build account names from a `uniq()` helper (`Date.now()` +
  `Math.random()`), so the Postgres-collision half of §2.6's open question is largely
  already solved. What remains unverified is shared *in-memory* server state.
- **Per spec file** (sum of test durations): tapTargets 96.2s / online 86.9s / offline
  69.5s / tableFit 51.4s / iconGlyphs 47.1s / offlineResume 7.6s / a11yOverlays 7.4s /
  reconnect 4.3s / webFonts 3.4s. With file-level distribution (`fullyParallel: false`),
  four lanes bottom out at the longest file, ~96s.

Quota position when measured: 631 of 2,000 minutes used across Aug 16–20.

---

## 1. Billing arithmetic

Primary sources:
- Per-job rounding: <https://docs.github.com/en/actions/how-tos/monitor-workflows/view-job-execution-time> —
  *"Billable job execution minutes are... rounded up to the next minute."* Confirmed again at
  <https://docs.github.com/en/billing/reference/actions-runner-pricing> — *"GitHub rounds the
  minutes and partial minutes each job uses up to the nearest whole minute."*
- Rate table: <https://docs.github.com/en/billing/reference/actions-runner-pricing> —
  `ubuntu-latest` (2-core, SKU `actions_linux`) is the baseline Linux rate, **$0.006/min**,
  with no extra multiplier beyond that (Windows ≈1.67×, macOS ≈10×, larger runners scale
  linearly with core count).
- Free-plan quota: <https://docs.github.com/en/billing/concepts/product-billing/github-actions> —
  private repos get **2,000 minutes/month** on GitHub Free; usage beyond that bills at the
  same per-minute rate against the account's payment method.
- **Not stated in GitHub Docs, checked and confirmed absent**: whether queue/wait time before
  a job starts counts, whether `services:` container time counts, and whether
  `actions/cache` restore/save time counts. None of
  `usage-limits-billing-and-administration`, `about-billing-for-github-actions`,
  `view-job-execution-time`, or `actions-runner-pricing` break job duration into
  sub-components — treat any claim about these being excluded as unconfirmed.
- Matrix jobs: no GitHub Docs page states explicitly that matrix-expanded jobs are billed
  and rounded independently (checked
  <https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/running-variations-of-jobs-in-a-workflow>,
  which covers only mechanics). It follows from the general per-job rounding rule (each
  matrix cell is a distinct job) but is an inference, not an explicit statement.

**What this means for the browser job, worked out from the confirmed per-job rule:**

| Scenario | Setup (fixed) | Test time | Job wall-clock | Billed (ceil to min) |
|---|---|---|---|---|
| Current: 1 job | 210s | 364s | 574s (9m34s) | **10 min** |
| 3 shards, even split | 210s × 3 = 630s total | 364s ÷ 3 ≈ 121s each | ≈331s each (5m31s) | 6 min × 3 = **18 min** |

That's **1.8×** the billed minutes for the browser stage, not the literal 3× the issue
estimates — the ceiling-rounding softens it somewhat because each shard's *test* portion
shrinks even as setup stays flat. It is still a real increase, and it assumes an even
split, which `fullyParallel: false` does not guarantee (imbalanced files could push one
shard's setup+test past the next minute boundary while another is under it — same ballpark
total, worse worst-case wall-clock). Wall-clock drops from 574s to ≈331s, a **42%**
reduction — close to the issue's 46% estimate. **This is arithmetic on the repo's own
stated numbers using GitHub's confirmed rounding rule, not a measurement — a real shard run
should be timed to replace the estimate.**

Whether the `browser` job's Postgres (a `docker compose`-style disposable stack, not a
GitHub Actions `services:` container) adds billed time beyond the job's own wall-clock is
one of the undocumented items above — but since it runs *inside* the job process rather
than as a separate `services:` container, it's almost certainly already counted in the
574s, not an extra charge.

---

## 2. Options

### 2.1 Naive `--shard=i/N` (the issue's original proposal)

**What it does:** Splits the 9 spec files across N parallel jobs via
`playwright test --shard=i/N`, each running the full setup independently.

**Wall-clock:** ≈42–46% reduction for N=3 (574s → ≈331s), per the arithmetic above.

**Billed minutes:** ≈1.8× for N=3 in the even-split case (10 min → 18 min); worse if
shard sizes are uneven, since `fullyParallel: false` assigns whole files, not individual
tests, to shards.

**Complexity:** Low config diff, but needs `reporter: process.env.CI ? 'blob' : 'html'`
plus a `playwright merge-reports` step to reassemble one HTML report — Playwright's own
sharding docs cover this: *"your test suite completes four times faster"* while blob report
names *"contain shard number, so they will not clash."*
Source: <https://playwright.dev/docs/test-sharding>

**Verdict:** Real wall-clock win, real billed-minute cost. Not free the way the issue's
framing implies it might have been, but the actual multiplier (≈1.8× for N=3) is smaller
than the pessimistic 3× the issue used to justify deferring it — worth re-costing before
rejecting outright.

---

### 2.2 Build the E2E bundle once, download it per shard

**What it does:** A new job builds the E2E-specific bundle (with
`EXPO_PUBLIC_E2E_FAST=1`, matching what `scripts/e2e-server.mjs` currently builds inline)
and uploads it via `actions/upload-artifact`; each shard job (`needs: e2e-build`)
downloads it via `actions/download-artifact` instead of running `expo export` itself. The
existing `build` job's bundle **cannot** be reused here — `assertNotE2EFast.js` guarantees
the two are built differently on purpose.

**Wall-clock:** Only removes the bundle-build slice of the 210s setup from each shard;
`npm ci` and `playwright install --with-deps` must still run per shard (see 2.3, 2.4). Adds
a new serialization point: shards can't start until the build job's upload finishes —
confirmed by GitHub Docs on `needs:`: *"identify any jobs that must complete successfully
before this job will run."*
Source: <https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow>

**Billed minutes:** The build-once job itself now bills its own (rounded-up) minute, on
top of each shard's. Whether the download beats a fresh `expo export` is **not documented
anywhere** — neither `actions/upload-artifact` nor `actions/download-artifact`'s READMEs
give throughput numbers (the only documented speed lever is
`compression-level: 0` for "significantly faster uploads" of large/incompressible files).
This pattern is explicitly sanctioned as the way to share data between jobs (*"You can use
the upload-artifact and download-artifact actions to share data between jobs in a
workflow"*), but the actual win here is **unknown, needs measuring**.
Sources: <https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts>,
<https://github.com/actions/upload-artifact>, <https://github.com/actions/download-artifact>

Artifact storage itself is a separate, small budget line (\$0.25/GB-month), not compute
minutes.

**Complexity:** Medium — new job, artifact plumbing, and the serialization risk of turning
"3 shards run at once" into "build, then 3 shards run at once" which can erase some of the
wall-clock win if the build job itself takes long enough.

**Verdict:** Only partially solves the N× problem (leaves `npm ci` and Playwright browser
install unshared, which 2.3/2.4 below show are not good artifact/cache candidates anyway),
and the actual payoff is unmeasured. Not worth the complexity unless the bundle build turns
out to be most of the 210s.

---

### 2.3 `actions/cache` for `npm ci` and Playwright browsers

**npm cache** — already enabled (`cache: npm` in `setup-node@v4`). Per the action's own
README: *"The action does not cache `node_modules`"* — it only caches npm's tarball
download cache, keyed on the lockfile. `npm ci` still fully re-links `node_modules` every
run regardless. **No further win available here beyond what's already configured.**
Source: <https://github.com/actions/setup-node>

**Playwright browser cache** — Playwright's own CI docs actively discourage this:
*"Caching browser binaries is not recommended, since the amount of time it takes to
restore the cache is comparable to the time it takes to download the binaries."* They also
confirm the `--with-deps` OS-level dependency install (apt packages) is **not cacheable**
and must run fresh every time.
Source: <https://playwright.dev/docs/ci>, <https://playwright.dev/docs/browsers>

**Verdict: skip.** Both are either already exploited or explicitly anti-recommended by the
tool's own maintainers.

---

### 2.4 Metro/Expo bundle cache across CI runs

**What it does:** Persist Metro's cache directory via `actions/cache` to speed up
`expo export --platform web`.

**Documentation:** None exists. Expo's `customizing-metro`, `metro` config reference, and
`build-reference/caching` pages were checked; the last covers only EAS Build's cloud cache
(`eas.json`), explicitly not `expo export` in GitHub Actions. **This is genuinely
undocumented — Expo gives no official cache directory or invalidation guidance for this
path.**

**Verdict:** Not recommended without first measuring how much of the 210s is bundle build
at all, and — if pursued — with real caution: a stale/incorrectly-keyed Metro cache would
silently ship an old bundle against new source, passing tests against the wrong code.

---

### 2.5 Cheap, low-risk trims to the fixed 210s

| Lever | What the docs say | Verdict |
|---|---|---|
| `npm ci --prefer-offline --no-audit --fund=false` | `prefer-offline` only skips a staleness *check* on already-cached packages (still downloads anything missing); `--no-audit` skips one extra network call; `fund` is purely cosmetic. None touch `npm ci`'s dominant cost (disk I/O writing `node_modules`). | Negligible, but free — fine to add, don't expect it to move the number. |
| `actions/checkout` `fetch-depth` tuning | Already defaults to a single-commit shallow clone (`fetch-depth: 1`) — <https://github.com/actions/checkout> confirms this is the out-of-the-box behavior. `filter: blob:none` / sparse-checkout exist for large monorepos. | No further win for a repo this size. Skip. |
| Skip `--with-deps` because `ubuntu-latest` already has the libs | Checked `actions/runner-images`' Ubuntu 24.04 manifest — it lists Chromium/Chrome/ChromeDriver as standalone browser installs, **not** Playwright's own headless-runtime dependency set (`libatk`, `libgbm`, `libasound2`, etc.). `--with-deps`'s apt work is real, non-redundant work on this image. | Cannot be skipped safely. |
| **Playwright's own Docker image as the job's `container:`** | `mcr.microsoft.com/playwright:v<version>-noble` ships browsers *and* their OS dependencies pre-installed. Playwright's CI docs give a working GitHub Actions example using it via `container: image:`. This is the one documented way to eliminate the `--with-deps` apt-get step outright, though Playwright frames it for environment consistency rather than speed — no time-savings number is given. | **Worth ~26s of 572s, not a standout lever** — see §0: the apt half installs nothing on this image. Low complexity (pin the image tag to the installed `@playwright/test` version — `package.json` currently has `^1.62.1`), removes real, confirmed-non-preinstalled work. Payoff size is unmeasured but structurally sound. |

Sources: <https://docs.npmjs.com/cli/v10/commands/npm-ci>,
<https://docs.npmjs.com/cli/v10/using-npm/config#prefer-offline>,
<https://github.com/actions/checkout>,
<https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md>,
<https://playwright.dev/docs/docker>, <https://playwright.dev/docs/ci>

---

### 2.6 Cut wall-clock by parallelizing *inside* the one job (pays setup once)

This is the option that most directly answers the brief: reduce wall-clock without
re-paying the 210s N times, by keeping one job and raising `workers` within it instead of
sharding across jobs.

Issue #51 records that this was already tried and rejected because all nine specs share
one `webServer` and one disposable Postgres. Playwright's docs turn out to document exactly
this situation, not just parallelism in the abstract:

- **Worker-scoped fixtures**: *"worker fixtures are set up for each worker process... That's
  where you can set up services, run servers, etc. Playwright Test will reuse the worker
  process for as many test files as it can."*
  Source: <https://playwright.dev/docs/test-fixtures> (§ Worker-scoped fixtures)
- **Per-worker isolation against one shared backend** — directly on point: *"You can
  leverage `process.env.TEST_WORKER_INDEX` or `testInfo.workerIndex`... to isolate user
  data in the database between tests running on different workers,"* with the example
  `const userName = \`user-${test.info().workerIndex}\`; await createUserInTestDatabase(userName);`
  Source: <https://playwright.dev/docs/test-parallel>
- **Global setup done once, before workers fan out**: the `dependencies` field in
  `defineConfig`'s `projects` runs a setup project to completion first — *"once all tests
  from this project have passed, the tests from the dependent projects will start
  running"* — and a `testProject.teardown` project runs after. This is the documented
  alternative to `globalSetup` for "start the shared server, then parallelize."
  Source: <https://playwright.dev/docs/test-projects>
- `fullyParallel` and `workers` themselves: default worker count is *"half of the number of
  logical CPU cores"*; the docs' own collision-avoidance guidance is *"derive a unique
  identifier from `testInfo.testId` so parallel tests never collide"* and *"if many tests
  can share one dataset, create it once per worker instead."*
  Source: <https://playwright.dev/docs/test-parallel>, <https://playwright.dev/docs/api/class-testconfig>

**What this would take here:** `scripts/e2e-server.mjs` / `scripts/dev-stack.mjs` boot one
Express/Socket.io process and one Postgres. Raising `workers` safely means each worker gets
a logically separate slice of that shared backend — e.g. a per-worker Postgres schema
selected via `search_path`, keyed on `workerIndex`, provisioned by a worker-scoped fixture
per the pattern above. **Open question this research cannot answer from CI docs alone:**
whether the prior flakiness was purely Postgres write collisions (which schema isolation
would fix) or also involved shared in-memory state in the single Node server process
(Socket.io rooms, AI bot pool, AFK/disconnect timers) that isolation-by-DB-schema wouldn't
touch. That needs a look at `server/` room/game-code isolation, not CI configuration — flag
as **unknown, needs investigation before attempting**, not a config-only change.

**Wall-clock:** Test-execution portion (≈364s) parallelizes across N workers, roughly
÷N minus contention; setup (210s) paid once. For N=3 with perfect parallelism:
≈210 + 121 = 331s (5m31s) — comparable to the 3-shard wall-clock from §2.1, but as **one**
job.

**Billed minutes:** Because it's still one job with one rounding-up, 574s → ≈331s takes the
job from `ceil(574/60)=10` billed minutes down to `ceil(331/60)=6` — a genuine reduction,
not the ≈1.8× increase §2.1 carries.

**Complexity:** The highest of any option here — requires per-worker backend isolation
design, verified against real server internals, and revisiting exactly why the earlier
attempt caused flakes. Not a quick win; needs its own design pass per this repo's working
agreement ("design first for anything touching storage... or many files").

---

### 2.7 `--only-changed`

Playwright docs: *"Only run test files that have been changed between 'HEAD' and 'ref'...
Only supports Git."*
Source: <https://playwright.dev/docs/test-cli>

This reduces *which* tests run, not the fixed setup cost, and doesn't apply when a change
touches shared engine/server code that all 9 specs exercise (the common case here). Not a
substitute for the above; noted for completeness only.

---

## 3. Ranked recommendation

1. **In-job worker parallelism** (§2.6) — §0's measurements move this to first place. Test
   execution is 456s of the browser job's 572s; setup is 114s, not 210s. Four lanes take the
   job to ~230s: wall-clock −60%, billed 10→4 minutes, one job, setup paid once.
2. **`npm ci` flags** (§2.5) — add alongside #1 since they're free, but don't expect them to
   register.
3. **In-job worker parallelism with per-worker backend isolation** (§2.6) — the only option
   that cuts wall-clock *and* billed minutes simultaneously (574s→~331s wall-clock, 10→6
   billed minutes, one job, setup paid once). Highest complexity and has a real open
   question (in-memory server state, not just Postgres) that needs answering before design
   — but it is the option that actually satisfies the brief ("cut wall-clock without paying
   fixed cost N times"), where sharding structurally cannot.
4. **Naive `--shard=i/N`** (§2.1) — re-cost with the arithmetic in §1 (≈1.8×, not 3×, for
   N=3) before rejecting it on the issue's original estimate; still a real billed-minute
   increase, and is the fallback if §2.6 proves the shared-server isolation isn't tractable.
5. **Build-once/download-per-shard** (§2.2) — only worth it in combination with #4, and only
   if measurement shows the bundle build is a large share of the 210s; the serialization it
   adds (shards wait on the build job) can eat into the very wall-clock win sharding exists
   for.
6. **Skip:** Playwright browser-binary caching and `actions/cache` for `npm ci` beyond what
   `setup-node`'s `cache: npm` already does (both explicitly not helpful per source), and
   `actions/checkout` tuning (already at its floor for this repo's size).
7. **Needs its own investigation before any action, not part of this research:** Metro/Expo
   bundle caching (§2.4) — undocumented, and the failure mode (stale bundle, silently green)
   is worse than the time it would save.

All wall-clock and billed-minute figures above are arithmetic on the repo's own stated
210s/574s split combined with GitHub's confirmed per-job rounding rule — not measurements.
Before implementing anything, time a real run of whichever option is chosen and replace
these estimates.
