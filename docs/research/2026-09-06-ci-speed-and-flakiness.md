# CI speed and flakiness: native compile jobs and the Playwright search-timeout budget

Research into two problems surfaced by GitHub Actions run `34054022312` (PR #927, 2026-09-06):
whether the native "still compiles" jobs can be made faster or gated more precisely, and
whether the wall-clock budget inside the E2E bot's card-search loop is the wrong kind of bound
under CI load. Same standard as `docs/ci-cost-research.md`: primary sources only, every claim
cited, gaps stated as "not documented" rather than filled with a guess. No file other than this
one was changed.

---

## 0. Measured facts

- **Run `34054022312` (PR #927):** `android-build` ("Android compiles") took **21m22s**;
  `ios-build` ("iOS compiles") took **16m51s**. Every other job in the same run finished in
  1-5 minutes.
- **Why both ran at all:** PR #927 touched `package.json` only to add an npm script — no
  dependency changed. `package.json` is not in the `scope` job's allowlist regex
  (`.github/workflows/ci.yml:124`, the `elif grep -qvE '^(app|components|context|lib|locales|
  shared|server|tests|docs|scripts|public|\.claude|\.agents|\.maestro|\.github)/|\.md$'`
  branch), so the touch fell into the "something outside the JavaScript sources changed —
  compiling for both devices" branch (`ci.yml:125-126`) and set `native=true`. This is by
  design, documented in the comment directly above the filter (`ci.yml:106-120`): the allowlist
  is deliberately fail-unsafe — it names what *cannot* reach a native compile (JS sources) and
  runs the compile jobs for everything else, including a change to `package.json`'s `scripts`
  key that no native toolchain ever reads.
- **Same PR, same run:** `resultActions.spec.ts` failed on Playwright shard 5/6 with
  `SearchTimeoutError`, thrown from `tests/e2e/helpers/bot.ts:294-300` inside `tryCombo`.
- **The two jobs themselves**, read from `ci.yml`:
  - `android-build` (`ci.yml:362-385`): `runs-on: ubuntu-latest`, `npx expo prebuild --platform
    android --no-install` then `./gradlew assembleDebug --no-daemon` (`ci.yml:382-385`).
  - `ios-build` (`ci.yml:387-419`): `runs-on: macos-latest`, `npx expo prebuild --platform ios
    --no-install`, `pod install --project-directory=ios`, then `xcodebuild ... -sdk
    iphonesimulator build` (`ci.yml:402-419`).
  - Both are gated on `needs.scope.outputs.native`, not `.app` — the comment at `ci.yml:346-361`
    states they were measured at 938s and 807s against 309s for the rest of the workflow, which
    is why they don't run on every PR.
- **`browser` job** (`ci.yml:420-497`): `strategy.matrix.shard: [1, 2, 3, 4, 5, 6]`,
  `fail-fast: false`. Comment at `ci.yml:459-462` states named spec files are used instead of
  Playwright's own `--shard`, because Playwright's split is by test count and this suite's
  tests range from under a second to 94s (`scripts/e2e-shard.mjs`).

---

## 1. Problem 1 — native compile jobs (Android 21m22s, iOS 16m51s), triggered by any `package.json` touch

### 1.1 Does Gradle/AGP build caching help `assembleDebug` in CI?

- Gradle's own build-cache docs confirm AGP support exists but give no CI-specific correctness
  guidance: *"The most prominent examples are the Android plugin 3.1+... For other third party
  plugins, check their documentation to find out whether they support the build cache."* The
  same page's only CI-specific guidance is architectural, not a hit-rate figure: *"your
  continuous integration server populates it from clean builds while developers only load from
  it... We expect that developers will not be allowed to populate the remote build cache, and
  all continuous integration builds populate the build cache after running the `clean` task."*
  Source: <https://docs.gradle.org/current/userguide/build_cache.html>. **The page gives no
  cache-hit-rate expectation and no staleness/correctness caveat for a shared CI cache** — that
  gap is genuinely unaddressed by Gradle's own docs, not omitted from this research.
- GitHub's own guidance is a level below Gradle's dedicated cache mechanism: `actions/setup-java`
  (the action `android-build` already uses at `ci.yml:375-378`) ships a built-in `cache: gradle`
  option. Per its own README: caches *"Downloaded dependencies, such as `~/.m2/repository`,
  `~/.gradle/caches`, or the sbt cache paths"* plus the wrapper distribution at
  `~/.gradle/wrapper`, keyed as `setup-java-<runner-os>-<node-arch>-<package-manager>-<file-hash>`
  where the hash covers `**/*.gradle*`, `**/gradle.properties`, `**/gradle-wrapper.properties`,
  and related version-catalog files.
  Source: <https://github.com/actions/setup-java#caching-packages-dependencies>
- `actions/cache`'s own maintained examples give the equivalent hand-written version:
  ```yaml
  - uses: actions/cache@v6
    with:
      path: |
        ~/.gradle/caches
        ~/.gradle/wrapper
      key: ${{ runner.os }}-gradle-${{ hashFiles('**/**.gradle*', '**/gradle-wrapper.properties') }}
      restore-keys: |
        ${{ runner.os }}-gradle-
  ```
  with one documented correctness caveat: *"Ensure no Gradle daemons are running anymore when
  your workflow completes"* (`--no-daemon`, which `ci.yml:385` already passes) to avoid file
  locks poisoning the saved cache.
  Source: <https://github.com/actions/cache/blob/main/examples.md>

**Verdict:** Both `cache: gradle` (via `setup-java`, already in the job) and Gradle's own
*remote build cache* (task-output caching, not just dependency-download caching — genuinely
different from what `setup-java`/`actions/cache` provide, which only cache the downloaded
`.gradle/caches`/wrapper directories, not compiled task outputs) are documented, low-risk,
additive options. Neither is currently configured in `android-build`. **No primary source gives
a measured hit-rate or wall-clock figure for either on this project's specific `assembleDebug`
task graph — that would need to be measured on a real run, not assumed.**

### 1.2 Does Xcode DerivedData or CocoaPods caching help `ios-build`?

- **CocoaPods:** CocoaPods' own "Optimise CI" guide addresses exactly this: *"if you have your
  `Pods` directory cached — sometimes you don't need to run it again for the current CI run,"*
  and recommends `pod check` (from the `cocoapods-check` plugin) to detect when a fresh
  `pod install` is unnecessary, cutting cost only when nothing changed.
  Source: <https://guides.cocoapods.org/plugins/optimising-ci-times.html>. `actions/cache`'s own
  examples give the matching cache block, keyed on `Podfile.lock`:
  ```yaml
  - uses: actions/cache@v6
    with:
      path: Pods
      key: ${{ runner.os }}-pods-${{ hashFiles('**/Podfile.lock') }}
      restore-keys: |
        ${{ runner.os }}-pods-
  ```
  Source: <https://github.com/actions/cache/blob/main/examples.md>. Neither source documents a
  staleness/correctness caveat beyond the lockfile-hash key itself.
- **DerivedData:** **Checked and confirmed absent.** Apple's own official documentation pages
  (`developer.apple.com/documentation/xcode/improving-the-speed-of-incremental-builds` and
  `developer.apple.com/documentation/xcode/build-system`) cover local incremental-build
  mechanics only — dependency graphs, compiler workload — and say nothing about caching or
  sharing DerivedData across machines, CI runners, or workflow runs. A `site:developer.apple.com`
  search for "DerivedData" surfaces only Apple Developer Forum threads (user Q&A, not official
  documentation, and out of scope for this research's primary-source standard) discussing local
  DerivedData behavior, none of them an Apple-authored statement about CI safety either way.
  **This is genuinely undocumented by Apple** — there is no official page that either endorses
  or explicitly warns against caching DerivedData across CI runs; third-party CI-caching guides
  for DerivedData (GitHub Marketplace actions, blog posts) exist but are outside this research's
  primary-source scope and are not cited here.
- `ios-build` currently passes `-derivedDataPath "$RUNNER_TEMP/DerivedData"` (`ci.yml:416`) —
  a fresh, job-local directory every run, never persisted or restored.

**Verdict:** CocoaPods' own docs support caching `Pods` keyed on `Podfile.lock` with no caveat
found; low-risk to add. DerivedData caching has no official Apple guidance either way — treat
adding it as an experiment to measure, not a documented win, and note the correctness risk this
repo's own precedent doc already flags for an analogous case (§2.4 of `docs/ci-cost-research.md`
on Metro caching): a stale cache can silently compile old sources.

### 1.3 Is EAS Build a faster/cheaper substitute for these CI compile checks?

`.github/workflows/eas-build.yml` (read in full) is a `workflow_dispatch`-only workflow — it
never runs on `push` or `pull_request` (confirmed by its `on:` block, lines 7-27, and its own
top comment: *"This workflow only ever builds, never submits, and only ever runs when a human
explicitly triggers it — never on push or pull_request"*). It runs `eas build --profile
<development|preview|production> --non-interactive --no-wait` (line 51) — fire-and-forget against
Expo's paid cloud build service, with no step that waits for or checks the build's result.

Expo's own docs confirm what this is for: EAS Build is described as *"a hosted service for
building app binaries for your Expo and React Native projects,"* explicitly for *"building your
apps for distribution simple and easy to automate,"* with its "when to use" framing built around
producing production-ready binaries, internal distribution, and app-store submission — not local
native-code debugging.
Source: <https://docs.expo.dev/build/introduction/>. EAS Build's own caching docs describe
dependency caching (npm, Maven, ccache, CocoaPods) purely as a way to shorten *that* pipeline's
own wall-clock, with no framing of EAS Build as a CI compile-check substitute.
Source: <https://docs.expo.dev/build-reference/caching/>

**Verdict:** `eas-build.yml` in this repo is not an alternative to `android-build`/`ios-build`
at all — it's a manually-triggered path to a distributable binary (App Store/Play submission,
TestFlight, internal testing), consuming paid EAS credits per its own comment (lines 3-4), and
it doesn't even wait for the build (`--no-wait`) or assert success. It cannot be repurposed as a
cheap, automatic "still compiles" gate without changing its trigger (defeating its own
cost-control comment) and adding a wait/assert step Expo's docs don't describe as a documented
pattern for this workflow file specifically.

### 1.4 Is a structural diff of `package.json` feasible to scope the native jobs more precisely?

Feasible, and does not require a primary source beyond `jq`'s own manual (jqlang.github.io/jq) —
this is a design/feasibility question, not a documentation lookup. The `scope` job already has
both commits checked out (`base` and `HEAD`, `ci.yml:60-63,94-99`) and already computes
`changed` via `git diff --name-only` (`ci.yml:105`); the same two refs support pulling the
`package.json` blob from each side and diffing structurally instead of textually:

```bash
# Only trip native=true on package.json if `dependencies` (or a
# native-module-bearing devDependency, e.g. anything under expo-*/react-native-*)
# actually changed — not `scripts`, `devDependencies` in general, or formatting.
before=$(git show "$base:package.json" 2>/dev/null | jq -S '.dependencies // {}')
after=$(git show "HEAD:package.json" | jq -S '.dependencies // {}')
if [ "$before" != "$after" ]; then
  echo "dependencies changed"
fi
```

This is a concrete, mechanical narrowing of exactly the false positive PR #927 hit — a `scripts`
addition with `dependencies` untouched. It would need to preserve the job's existing fail-unsafe
posture (`ci.yml:106-120`): a `package.json` change to a key this filter doesn't recognize (a
new top-level key, `jq` erroring on malformed JSON, a change to `devDependencies` that turns out
to include a native module) must still fall through to `native=true`, not be silently swallowed.
No code was written into the repo for this — this is a design sketch only, per the task.

### 1.5 Running the compile jobs conditionally (scheduled / merge-only)

- `ci.yml` already uses one of these documented mechanisms: `schedule: cron: "17 4 * * 1"`
  (`ci.yml:19-20`), with its own comment explaining why (a schedule run has no base commit, so
  `scope` takes the "running everything" path and both native jobs run weekly regardless of
  what changed — catching a break introduced by a new Xcode/Android SDK or CocoaPods release on
  the runner image itself, not by this repo's diff). GitHub's own docs on `schedule` confirm the
  mechanics: *"The `schedule` event allows you to trigger a workflow at a scheduled time,"* using
  POSIX cron with a 5-minute minimum interval, and *"Scheduled workflows run on the latest commit
  on the default branch."*
  Source: <https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows>
- **`workflow_run`**: *"This event occurs when a workflow run is requested or completed. It
  allows you to execute a workflow based on execution or completion of another workflow,"* and
  critically, *"The workflow started by the `workflow_run` event is able to access secrets and
  write tokens, even if the previous workflow was not."* This is the documented mechanism for
  running an expensive job only after a cheaper gate has already passed — e.g. only after
  `verify`/`lint`/`native` (the fast checks) are green, rather than dispatching the compile jobs
  in parallel with everything else the moment `scope` decides `native=true`. This repo doesn't
  currently use `workflow_run`; using it would mean splitting `android-build`/`ios-build` into
  their own workflow file, since `workflow_run` triggers on a *completed* workflow, not a job.
  Source: same page as above.
- **Required-for-merge, not required-for-PR**: GitHub's branch-protection docs describe required
  status checks as merge gates, not PR-run gates: *"Required status checks must have a
  `successful`, `skipped`, or `neutral` status before collaborators can make changes to a
  protected branch,"* and separately describe merge queues as giving *"the same benefits as the
  Require branches to be up to date before merging branch protection, but does not require a
  pull request author to update their pull request branch and wait for status checks to finish
  before trying to merge."*
  Source: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>.
  This describes *merging* being blocked on a check's status, not the check itself running later
  — GitHub's docs don't describe a mechanism for "run this check, but only count it against merge
  eligibility rather than PR turnaround," beyond what `workflow_run`/branch protection already
  compose to. Using branch protection to mark `android-build`/`ios-build` required-for-merge
  while `workflow_run` defers when they actually run is consistent with these two docs pages
  together, but this repo does not currently configure branch protection at all (not found in
  `ci.yml` or elsewhere in this research's scope) — that would be a separate, out-of-band GitHub
  repo-settings change, not a `ci.yml` edit.

**Verdict:** the `schedule` mechanism this repo already uses is exactly the documented pattern
for "catch drift from the platform, not from the diff." The gap PR #927 exposes is narrower:
`scope`'s allowlist, not the choice of trigger. §1.4's structural diff is the more targeted fix.

---

## 2. Problem 2 — `SearchTimeoutError` from a fixed millisecond search budget

### 2.1 Playwright's own guidance: poll/event-based waits over fixed timeouts

- **`expect.poll`**: *"You can convert any synchronous `expect` to an asynchronous polling one
  using `expect.poll`,"* retried on an interval until it passes or its own `timeout` elapses —
  documented for exactly the class of problem this repo has (an outcome that should eventually
  become true, rather than a fixed amount of wall-clock work).
  Source: <https://playwright.dev/docs/test-assertions>
- **`page.waitForFunction`**: polls an in-page predicate rather than sleeping a fixed duration;
  default polling mode is `raf` (`requestAnimationFrame`) and an explicit numeric `polling` value
  is treated as an interval in milliseconds, with its own 30s default `timeout`.
  Source: <https://playwright.dev/docs/api/class-page> (confirmed via
  <https://github.com/microsoft/playwright/issues/40568>, Playwright's own issue tracker,
  discussing this same API's in-browser-timer behavior).
- **`test.setTimeout()`**: extends one test's own timeout dynamically from inside the test,
  e.g. `test.setTimeout(120_000);`, rather than hard-coding a global number.
  Source: <https://playwright.dev/docs/test-timeouts>
- **`test.slow()` / `testInfo.slow()`**: *"Easy way to triple the default timeout"* for a test
  or step known in advance to run long — a documented multiplier, not a bespoke constant.
  Source: <https://playwright.dev/docs/test-timeouts>

None of these four map directly onto `tryCombo`'s deadline (`bot.ts:293-310`), because that
check isn't a Playwright `test.*`/`expect.*` primitive — it's plain application code (a `for`
loop over candidate card combinations) guarded by a hand-rolled `Date.now()` comparison
(`bot.ts:294`). Playwright's poll/retry primitives are for waiting on the *page*, not for
bounding a test-harness search loop's own CPU-bound iteration count — so this specific
Playwright guidance doesn't directly transplant into `bot.ts`; it's context for why a
milliseconds-based bound is the wrong primitive in general, not a drop-in fix here.

### 2.2 Can test code detect CI parallelism/load?

Playwright documents two indices, and nothing beyond them:

- *"Each worker process is assigned two ids: a unique worker index that starts with 1, and a
  parallel index that is between `0` and `workers - 1`,"* readable via
  `process.env.TEST_WORKER_INDEX` / `process.env.TEST_PARALLEL_INDEX` or
  `testInfo.workerIndex` / `testInfo.parallelIndex`. The documented use case is data isolation
  (*"leverage `process.env.TEST_WORKER_INDEX` or `testInfo.workerIndex`... to isolate user data
  in the database between tests running on different workers"*), not load detection.
  Source: <https://playwright.dev/docs/test-parallel>

**These indices are scoped to workers *within one Playwright process/job* (`workers` in
`playwright.config.ts`), not across the six separate `matrix.shard` jobs `ci.yml` runs** — each
shard is its own `npx playwright test` invocation in its own job (§2.4 below), so
`workerIndex`/`parallelIndex` inside shard 5 says nothing about what shards 1-6 or the sibling
`android-build`/`verify`/`native` jobs are doing on GitHub's infrastructure. **Genuinely
undocumented: Playwright's own docs give no environment variable or API for a test to learn the
current cross-job CI load** (how many sibling jobs/runners are active, host CPU pressure, etc.)
— `test-parallel`'s docs and the `workers`/`shard` config reference
(<https://playwright.dev/docs/test-sharding>) cover only Playwright's own within-job
parallelism model.

### 2.3 `combosTried` — already tracked, and a count-based cap is structurally trivial

Confirmed directly from `tests/e2e/helpers/bot.ts`:

- `combosTried` is declared at **line 291** (`let combosTried = 0;`), scoped to one `playOrPass`
  call (i.e., one turn's search).
- It is incremented at **line 302** (`combosTried += 1;`), inside `tryCombo` — the same function
  that performs the time-based deadline check.
- The deadline check itself is at **lines 294-300**: `if (Date.now() > searchDeadline) { throw
  new SearchTimeoutError(...) }`, and the thrown message already reports `combosTried` as part
  of its diagnostic text (line 296: `` `...after ${combosTried} candidate(s), without finishing.` ``).

A step-count cap is not a new instrument to add — the counter already exists, is already read on
every iteration of the same loop the time check runs in, and is already surfaced in the error
message. Swapping or supplementing the check at line 294 with `if (combosTried > MAX_COMBOS)`
is a change of comparable size to what's already there, not a restructuring.

**Whether it's the *right* fix is a separate question**, and the file's own comments argue both
sides of it for two different watchdogs in the same module:

- The `SearchTimeoutError` class doc (**lines 98-107**) frames `searchBudgetMs` as *"a ceiling
  over every healthy search, not a claim about which deadline the search lost to"* — i.e., it
  exists to bound wall-clock so a stuck search doesn't outlive the turn's own deadline
  (`HUMAN_TURN_SECONDS` offline, the server's AFK window online) — both of which are themselves
  wall-clock, not step-count, limits.
- The `maxStatesWithoutProgress` doc on `DriveOptions` (**lines 458-461**, applied at line 490)
  makes the opposite argument for a sibling watchdog in the same file: *"Counted rather than
  timed: a slow machine plays the same moves as a fast one, and the spread across deals is wide
  enough that any wall-clock figure covering the slow tail is useless as a check."* This is
  exactly the failure mode PR #927 hit — a CI runner under load is a "slow machine," and a fixed
  18-second budget (`DEFAULT_SEARCH_BUDGET_MS`, line 127) has no way to distinguish "genuinely
  stuck" from "correctly still working, just slower this run."

So the repo already contains, in the same file, both the argument for why `tryCombo`'s bound is
time-based (it exists to not outlive an *external*, itself-timed deadline — the turn clock) and
the argument for why a sibling bound is deliberately count-based (CI/machine-speed variance makes
wall-clock figures unreliable). `combosTried` being fully tracked and already exposed in the
error text means a count-based (or count-*and*-time, whichever is smaller) cap is implementable
without adding new bookkeeping — it is a small, well-scoped change if `tryCombo`'s purpose is
judged closer to "bounded search" than "must finish before the turn clock does."

### 2.4 Are six shards six separate runner VMs, or six processes on one VM?

`ci.yml:433-439`'s `strategy.matrix.shard: [1,2,3,4,5,6]` with no `max-parallel` set means each
of the six matrix combinations is its own **job** — GitHub's own docs on running job variations
describe matrix expansion as running *"a job... for each possible combination"* and describe
`max-parallel` as a way to cap *"the maximum number of jobs that can run simultaneously... even
if there are runners available to run all six jobs at once"* — implying, but not stating in one
sentence, that absent `max-parallel` all six run concurrently, each needing its own runner.
Source: <https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/running-variations-of-jobs-in-a-workflow>.

GitHub's own hosted-runner docs settle the VM question directly: *"With the exception of
single-CPU runners, each GitHub-hosted runner is a new virtual machine (VM) hosted by GitHub"* —
`ubuntu-latest` is not the single-CPU/shared-container variant (that's a separate, explicitly
named `ubuntu-latest-...` slim label this repo doesn't use).
Source: <https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners/about-github-hosted-runners>.
The GitHub-hosted-runners hardware reference confirms the standard Linux runner is **4 vCPU /
16 GB RAM / 14 GB SSD** for `ubuntu-latest` (this repo's public-repo tier), and that *"Use of the
standard GitHub-hosted runners is free and unlimited on public repositories"* (murlan is public,
per the repo's own operating notes).
Source: <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>

**Verdict, stated precisely per the task's ask:** the six `browser` shards are six separate,
dedicated 4-vCPU/16GB VMs, not six processes time-slicing one VM — there is **no CPU contention
between shards**. What *can* still contend is (a) processes *within* one shard's own VM (the
Express/Socket.io server, the disposable Postgres, and the single `workers: 1` Playwright process
all share that one shard's 4 vCPUs — confirmed by `docs/ci-cost-research.md §0`'s own measured
job breakdown for the unsharded predecessor of this job), and (b) queueing for a runner to become
available at all if GitHub's concurrent-job limit for the account is reached — a resource none of
the docs fetched here quantify per-account, and out of scope for this research (it's an
account-wide concurrency ceiling, not a per-shard-VM property). **The diagnosis for PR #927's
`SearchTimeoutError` on shard 5/6 is therefore not "shards fought each other for CPU"** — each
shard has its own dedicated VM — **but is consistent with that one VM's own internal contention
(server + Postgres + Playwright process sharing 4 vCPUs) or simple run-to-run variance**, which
is exactly the "slow machine" scenario `bot.ts`'s own `maxStatesWithoutProgress` comment (§2.3)
already names as a reason to prefer a counted bound over a timed one.

---

## 3. Ranked recommendations

### Problem 1 — native compile jobs

1. **Narrow the `scope` job's `package.json` trigger to a structural diff of `dependencies`
   (§1.4)** — directly fixes the PR #927 false positive, costs nothing at runtime (the `scope`
   job already checks out both commits), and can preserve the existing fail-unsafe posture by
   falling through to `native=true` on anything the `jq` filter doesn't recognize (parse
   failure, an unfamiliar top-level key). This is the only option here that fixes the specific
   defect observed, rather than making the jobs faster once triggered.
2. **Add `actions/setup-java`'s `cache: gradle` to `android-build`** (§1.1) — one added
   parameter to a step the job already runs, documented by GitHub's own action, additive and
   low-risk. Effect on the 21m22s is unmeasured; time a real run before claiming a number.
3. **Add CocoaPods' `Pods`-directory cache, keyed on `Podfile.lock`, to `ios-build`** (§1.2) —
   same shape as #2, documented by CocoaPods' own guide, unmeasured effect on the 16m51s.
4. **Do not attempt Xcode DerivedData caching without first measuring #3's effect** (§1.2) —
   Apple gives no official guidance either way, so this would be an unverified experiment with
   the same class of risk this repo's own precedent doc (`ci-cost-research.md §2.4`) already
   flags for Metro caching: a stale cache compiling old sources silently.
5. **Do not treat `eas-build.yml` as a substitute for either compile job** (§1.3) — it's a
   manual, credit-consuming, fire-and-forget path to a store-distributable binary, not a CI
   check, per Expo's own docs on what EAS Build is for.
6. **`workflow_run` + branch-protection required-for-merge (§1.5) is a real, documented
   pattern** for deferring these two jobs off the PR's critical path entirely, but it's a
   repo-settings change (branch protection isn't configured in-repo today) and a workflow-file
   split, not a `ci.yml` tweak — larger in scope than #1, and #1 fixes the actual bug PR #927
   exposed while this only relocates when a correctly-triggered run happens.

### Problem 2 — `SearchTimeoutError`

1. **Treat `tryCombo`'s bound as a candidate for a count-based (or count-and-time) cap, using
   the already-tracked `combosTried`, rather than assuming the current ms-only budget is
   correct** (§2.3) — the same file already documents, for a sibling watchdog, exactly the
   argument for why a wall-clock figure is "useless as a check" under machine-speed variance,
   and intra-VM contention (§2.4) is a real source of that variance here. This is the smallest
   change with the clearest textual precedent in the codebase itself, not an import from
   Playwright's own APIs.
2. **Do not expect `testInfo.workerIndex`/`TEST_PARALLEL_INDEX` or any other Playwright-
   documented signal to reveal CI load** (§2.2) — confirmed genuinely undocumented for
   cross-job/cross-shard load, and even within-job it's scoped to Playwright's own `workers`
   config (this suite runs `workers: 1` per `docs/ci-cost-research.md`), not to the
   `matrix.shard` jobs at all.
3. **`expect.poll`/`waitForFunction`-style guidance doesn't transplant directly** (§2.1) — useful
   context for why fixed-duration waits are a known Playwright anti-pattern in general, but
   `tryCombo`'s loop is hand-rolled application logic, not a Playwright assertion or page-wait,
   so adopting these APIs as-is isn't the fix; the count-based-cap option above is the one that
   fits the actual code shape.
4. **Confirmed, not a recommendation needing action: the six shards are not contending with each
   other for CPU** (§2.4) — each is its own dedicated 4-vCPU/16GB VM. Any fix aimed at
   "reduce cross-shard contention" is solving a problem that, per GitHub's own docs, does not
   exist at the shard-VM level; the contention (if any) is intra-VM (server + Postgres +
   Playwright sharing one shard's own 4 vCPUs), which recommendation #1 is robust to regardless
   of its exact cause.
