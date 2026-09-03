# Committed generated files in CI: what mature projects do, and what murlan should do about `timings.json`

Research date: 2026-09-03. Citation standard follows `docs/research/2026-08-29-multiplayer-infrastructure.md`:
every external claim carries a URL that was actually fetched, quotes are verbatim, and a
verdict is stated plainly, including where a source publishes no answer.

**This document changes no production code.** It answers the owner's question — "what do
best projects do?" — for `tests/e2e/timings.json`, and closes with a recommendation and what
it would replace.

---

## 1. The question, and what was verified vs not

Verified against primary sources (official docs, or a project's own README/action source):
Playwright, Jest, Vitest, pytest-split, CircleCI, Knapsack Pro, Nx, GitHub's `GITHUB_TOKEN`
trigger rule, `stefanzweifel/git-auto-commit-action`, `peter-evans/create-pull-request`,
Microsoft's API Extractor, the TypeScript compiler's baseline workflow, and
`benchmark-action/github-action-benchmark`.

Not independently verified: React's and Angular's own CI internals (their size-tracking
bots' source was not fetched — see §7), and whether Nx's Atomizer/DTE persists any timing
data into the *repository* as opposed to Nx Cloud's own servers (Nx's public docs pages
fetched here don't say either way — see §2.6).

Also checked directly against this repo: `tests/e2eShardSplit.test.ts`, `scripts/e2e-shard.mjs`,
`scripts/e2e-timings.mjs`, and `.github/workflows/ci.yml`'s `browser` / `browser-report` jobs,
to ground the recommendation in what CI already computes. `main` currently carries **no branch
protection rule** (`gh api repos/metasito/murlan/branches/main/protection` → 404), which
removes one constraint the rest of this document has to work around.

---

## 2. Does test-splitting need a committed timing file at all?

Short answer: **the test runners themselves never require one** — every runner's native
`--shard` flag divides by count. A committed timing file, or an external service holding the
same data, is something a project bolts on afterward because count-based splitting is uneven
when files vary from under a second to ninety seconds, which is exactly murlan's situation
(`scripts/e2e-shard.mjs`'s own comment cites a 2m11s/5m20s split from #441). So the finding
narrows the ticket to "who owns the bolt-on," not "should there be one" — murlan already
needs duration-aware splitting; the open question is only how the duration data stays fresh.

### 2.1 Playwright

[playwright.dev/docs/test-sharding](https://playwright.dev/docs/test-sharding) splits `--shard=x/y`
by count: with `fullyParallel: true` at individual-test granularity, otherwise at file
granularity — no timing data enters the decision. Playwright's own docs describe the
`--reporter=blob` + `merge-reports` flow for combining shard results into one report
afterward, but nothing in that page balances the shards themselves by duration. This matches
`scripts/e2e-shard.mjs`'s own comment: *"Playwright's own `--shard` splits by test count... this
suite's tests range from under a second to ninety-four [seconds]"* — i.e., murlan already
identified that Playwright doesn't solve this and built a replacement rather than missing a
feature.

### 2.2 Jest

[jestjs.io/docs/cli#--shardshardindexshardcount](https://jestjs.io/docs/cli) documents
`--shard=<shardIndex>/<shardCount>` as count-based, and requires the configured
`testSequencer` to implement a `shard` method — Jest ships no timing-aware balancer out of
the box.

### 2.3 Vitest

Vitest's `--shard` also splits deterministically by file count
([vitest.dev/guide/improving-performance](https://main.vitest.dev/guide/improving-performance)
covers the `--shard` + `--reporter=blob` combo, mirroring Playwright's design — Vitest's
sharding was modeled on it). Duration-aware sharding is an **open feature request**, not a
shipped feature: [github.com/vitest-dev/vitest/issues/9184](https://github.com/vitest-dev/vitest/issues/9184)
proposes "an opt-in sharding mode that distributes test files based on historical execution
time." As of this research, Vitest has the identical gap murlan is solving for Playwright.

### 2.4 pytest-split

This is the one mainstream tool that **does** commit a timing file by design, and it is
worth reading closely because its shape is close to what murlan already built.
[github.com/jerry-git/pytest-split](https://github.com/jerry-git/pytest-split)'s README:

> "This produces .test_durations file which should be stored in the repo in order to have it
> available during future test runs."

New or changed tests are handled the same way murlan's `UNMEASURED_SECONDS` handles them,
but with the opposite bias:

> "pytest-split assumes average test execution time (calculated based on the stored
> information) for every test which does not have duration information stored."

And its staleness story is explicitly manual, not automated:

> "there's no need to store durations after changing the test suite. However, when there are
> major changes in the suite compared to what's stored in .test_durations, it's recommended to
> update the duration information with `--store-durations`."

**Nothing in pytest-split's own docs regenerates `.test_durations` automatically in CI.** It
is a developer's manual step, exactly the step murlan's ticket says nobody has been doing —
which is the precedent for *not* copying this part of the design.

### 2.5 CircleCI test splitting

[circleci.com/docs/guides/optimize/use-the-circleci-cli-to-split-tests](https://circleci.com/docs/guides/optimize/use-the-circleci-cli-to-split-tests.html):
`circleci tests split --split-by=timings` — but the timing data is **not a repo file**. CircleCI
stores it server-side per project, populated by the `store_test_results` step on every run:

> "On each successful run of a test suite, CircleCI saves timing data from the directory
> specified by the path in the store_test_results step... The available timing data will then
> be analyzed and your tests will be split across your parallel-running containers as evenly
> as possible."

A brand-new test file has no history yet and is simply spread randomly across nodes for its
first run — the same "unmeasured spec still gets placed" property `tests/e2eShardSplit.test.ts`
pins for murlan, achieved by CircleCI without ever writing to the repository.

### 2.6 Knapsack Pro

[docs.knapsackpro.com/ruby/queue-mode](https://docs.knapsackpro.com/ruby/queue-mode/) describes
a queue-mode design that "sends the test execution times to the API for the subsequent CI
runs" — timing lives in Knapsack's own database, addressed by CI nodes over the network at
run time. **No file is committed to the repo at all.** This is the cleanest version of "don't
keep a timing file" among the tools surveyed: the runner asks a service for the next batch of
work instead of consulting a static split computed ahead of time.

### 2.7 Nx

Nx's Atomizer ([nx.dev/docs/features/ci-features/split-e2e-tasks](https://nx.dev/docs/features/ci-features/split-e2e-tasks))
turns one e2e task into one task per spec file; Distributed Task Execution
([nx.dev/docs/features/ci-features/distribute-task-execution](https://nx.dev/docs/features/ci-features/distribute-task-execution))
"assigns tasks to agents based on the task's average run time." Both pages describe the
*behavior* but neither states, in the text fetched here, whether that average-run-time history
lives in a repo-committed file or exclusively in Nx Cloud's backend. Given Nx Cloud is a paid
run-history service (like CircleCI's and Knapsack's), the strong implication is server-side —
but **this is not found in Nx's own docs as fetched, and is stated here as unverified**, not
as a claim.

### Verdict for §2

Playwright, Jest, and Vitest ship no timing-aware balancer; each defers to a committed file
(pytest-split's manual `.test_durations`) or a paid backend (CircleCI, Knapsack Pro, likely
Nx Cloud). **Murlan is not missing a feature its runner should have provided — every
comparable open-source runner has the identical gap, and the mainstream fix for a
budget-constrained project without a paid test-splitting service is exactly a committed
timing file.** The question the rest of this document answers is therefore pytest-split's
own unsolved half: who keeps the file from decaying.

---

## 3. Committed generated files: who writes them, with real examples

### 3.1 Human-in-the-loop: generate locally, commit as part of the PR, CI verifies

**Microsoft's API Extractor** (used across the Rushstack family and by many `@microsoft/*`
packages) commits a `.api.md` report and fails CI if it doesn't match a fresh run:
[api-extractor.com/pages/commands/api-extractor_run](https://api-extractor.com/pages/commands/api-extractor_run/)
distinguishes `--local` (a developer's machine, which auto-copies the fresh report over the
committed one and only warns) from a CI invocation without `--local` (which enforces the
match and fails). The workflow: a contributor changes a public API, runs the extractor
locally, the tool overwrites `etc/<package>.api.md`, the contributor commits that diff inside
their own PR, and CI's job is purely a diff check — CI never writes the file itself.
Source: [github.com/microsoft/rushstack/blob/main/apps/api-extractor/README.md](https://github.com/microsoft/rushstack/blob/main/apps/api-extractor/README.md).

**The TypeScript compiler's own test baselines** work the same way.
`tests/baselines/reference` is committed; `tests/baselines/local` is gitignored output from
the current run; a mismatch fails the suite. A contributor accepts an intentional change with
`gulp baseline-accept`, which — per the project's own tooling description — "replaces the
baseline test results with the results obtained from `gulp runtests`," and that diff is
committed as part of the PR making the behavior change. `microsoft/TypeScript` issue
[#37765](https://github.com/microsoft/TypeScript/issues/37765) even discusses a bot
(`typescript-bot`) offered to *run* `baseline-accept` and push the resulting commit *back onto
the contributor's own PR branch* on request — i.e., automation exists, but it acts as a
labor-saving step for a human-owned commit, not as an autonomous writer to `main`.

**Common shape:** the generated artifact records a *decision a human should see* (a public API
changed shape; a compiler's output changed) — so the write belongs in the PR, next to the
diff that caused it, for a reviewer to read. This is the closest analog to what murlan already
tried (asking nobody in particular to run a regeneration script) and it is the shape that
already failed here per the ticket's own premise: nothing regenerates the file, so it decays.
**This pattern only works when someone is actually looking at the diff each time** — API
Extractor and baseline diffs are reviewed for correctness; a timing number is not something
any reviewer meaningfully approves or rejects, which is why murlan's manual step never
happened across five PRs.

### 3.2 Bot commits straight to a branch, but not the PR's own branch

**`benchmark-action/github-action-benchmark`** is the direct precedent for "CI computes a
number after the fact and a bot commits it," and it deliberately does **not** write to `main`
or to the PR branch:
[github.com/benchmark-action/github-action-benchmark](https://github.com/benchmark-action/github-action-benchmark)
describes storing "collected benchmark results in the GitHub pages branch" (default
`gh-pages`), and per the action's own inputs
(`gh-pages-branch`, `benchmark-data-dir-path`, `auto-push`), the bot pushes benchmark JSON
there directly, using `github-actions[bot]` as the committer — visible in the wild, e.g. a
real commit *"add Benchmark (jmh) benchmark result for 03e303e"* pushed to Apache Groovy's
`gh-pages` branch by that bot. This sidesteps every failure mode in §4 that comes from writing
to a branch people also open PRs against: `gh-pages` has no feature work landing on it, so
there is nothing to conflict with and no PR review gate to route around.

**This doesn't transplant cleanly to murlan.** `timings.json` has to be *read* by
`tests/e2eShardSplit.test.ts` on every PR run, from whatever the PR's own branch checks out —
an orphan `gh-pages`-style branch would need every PR job to fetch a second branch just to read
one file, which is real added complexity for a repo this size to save what §3.3 below shows
is a much smaller problem than benchmark noise.

### 3.3 Bot commits straight to the default branch

This is the shape closest to what murlan should do, and it is common for low-stakes,
mechanical, un-reviewable generated data (translations, changelogs, formatting) — but it was
harder to find a named large repo publicly committing *test-timing* data this way, specifically,
in the time available; the closest verified precedent is the benchmark case in §3.2, which
uses the "own branch" variant of this same idea rather than `main` itself. This is recorded
here as a gap rather than papered over — see §7.

### 3.4 PR-opening bots for generated files that nobody reviews line-by-line

**`peter-evans/create-pull-request`** exists precisely for "a workflow step generated or
changed files; put them somewhere for review" rather than committing directly:
[github.com/peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request)'s
README: *"Changes to a repository in the Actions workspace persist between steps in a
workflow. This action is designed to be used in conjunction with other steps that modify or
add files to your repository."* It is the standard engine behind dependency-update bots and
"regenerate lockfile/docs/schema" workflows across many projects. Its own README flags the
trigger interaction directly (quoted in full in §4): a PR it opens with the default token will
not itself trigger `on: push`/`on: pull_request` workflows, so any required CI check on that PR
needs a PAT or GitHub App token instead, or the PR sits forever with no green check to merge on.

---

## 4. The GITHUB_TOKEN / workflow-trigger rule, quoted from GitHub's docs

GitHub's own docs, fetched directly
([docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)):

> "When you use the repository's `GITHUB_TOKEN` to perform tasks, events triggered by the
> `GITHUB_TOKEN` will not create a new workflow run, with the following exceptions:
> `workflow_dispatch` and `repository_dispatch` events always create workflow runs. `pull_request`
> events with the `opened`, `synchronize`, or `reopened` activity types: when a workflow using
> `GITHUB_TOKEN` creates or updates a pull request, the resulting `pull_request` event creates
> workflow runs in an **approval-required** state."

And the practical consequence, stated directly: "if a workflow run pushes code using the
repository's `GITHUB_TOKEN`, a new workflow will not run even when the repository contains a
workflow configured to run when push events occur." Escaping this requires "a GitHub App
installation access token or a personal access token instead of `GITHUB_TOKEN`."

Both third-party actions surveyed confirm this from their own side. `git-auto-commit-action`'s
README states plainly that "commits made by this Action will not trigger another GitHub
Actions Workflow run"
([github.com/stefanzweifel/git-auto-commit-action](https://github.com/stefanzweifel/git-auto-commit-action)).
`create-pull-request`'s README states the mirror image: "If you want pull requests created by
this action to trigger an `on: push` or `on: pull_request` workflow then you cannot use the
default `GITHUB_TOKEN`"
([github.com/peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request)).

**For murlan this is a feature, not a caveat to route around.** A bot commit updating
`timings.json` after a merge to `main` is guaranteed not to re-trigger `ci.yml`'s `push`
trigger — no `[skip ci]` marker, no recursion guard, and no risk of an infinite loop, needed.

Two more mechanics from the same actions' docs, both relevant to §5:

- **Protected branches**: `git-auto-commit-action`'s README: pushing to a protected branch
  needs a PAT rather than the default token, "and the token creator must have administrator
  privileges unless force pushes are explicitly enabled." Moot for murlan today — `main` has
  no branch protection rule configured (`gh api repos/metasito/murlan/branches/main/protection`
  returned 404 when checked for this document) — but would become a real blocker the day
  branch protection is added, and should be re-checked then.
- **Permissions**: both actions need `permissions: contents: write` on the job (or the whole
  workflow) granted to `GITHUB_TOKEN`; this is the standard, minimal grant — not `admin` or
  `workflows`.

---

## 5. Failure modes of each approach

**Manual regeneration (pytest-split's model, and murlan's status quo).** Works exactly as long
as someone remembers, and the ticket that spawned this research is the proof it doesn't: five
PRs' worth of drift landed before anyone crossed the 10% line the check enforces. The failure
is silent by construction — nothing is red until the threshold trips, and by then the file has
been wrong for a while.

**PR-opening bot (`create-pull-request`).** The mechanical fix compounds the human-diligence
problem instead of solving it: now a bot opens a PR nobody asked for, containing a diff nobody
finds interesting, that a human must remember to merge — which is the same "nobody did the
chore" failure as the manual case, just moved one step later and with an extra PR cluttering
the queue. It also inherits the trigger rule in §4: if the repo requires a green CI run before
merge (murlan's `ci.yml` runs on every `pull_request`, so it does get a normal run, but with
the default token that run is fine — the risk is specifically *when* a required check itself
was created by the bot's own token and needs `approval-required` handling per §4's quote).

**Bot commits straight to `main` on every push (naively, on every CI run).** If the workflow
that regenerates the file runs on every PR push rather than only after merge, concurrent PRs
race to write `timings.json` and whichever merges last wins or conflicts — this is the
"merge conflicts on the generated file across concurrent PRs" failure named in the prompt.
Restricting the write to `push` events on `main` (i.e., only after a merge actually lands, one
at a time, sequentially) removes the concurrent-PR race entirely, because pushes to `main` are
serialized by git itself; the only remaining race is two merges landing close enough together
that their `browser-report` jobs overlap, which is a much narrower window and is a stale-read
problem (the second job's report doesn't yet reflect the first's timing update) rather than a
conflict, since both compute a fresh file independently — a plain "commit, and pull-rebase if
the remote moved" retry is sufficient, which is exactly what `git-auto-commit-action` offers.

**Bot commits to a side branch (`gh-pages`, per §3.2).** Solves the conflict problem
completely, at the cost of every consumer needing to fetch that branch. For a value read
synchronously by a PR-time check like `tests/e2eShardSplit.test.ts`, that's an added
cross-branch fetch on every PR run for a file that's a few kilobytes — worse than the problem
it avoids, at murlan's scale.

**Noise on `main`.** A bot commit after every merge is one additional commit per merge, purely
mechanical, touching one file. Given `main`'s existing commit log (see git log at the top of
this session) already carries one commit per merged PR, a `timings.json` update commit is not
qualitatively different in kind — but it is a real increase in commit count, and reviewers
scrolling `git log` will see it. This is a cosmetic cost, not a correctness one, and is the
cost every project accepts when it picks bot-commit over PR-opening.

---

## 6. Recommendation for murlan, and what it replaces

**Regenerate `timings.json` as a bot commit to `main`, immediately after the merge job that
already computes the input, and delete the manual-regeneration story entirely.**

Concretely:

1. In `.github/workflows/ci.yml`'s `browser-report` job, change
   `npx playwright merge-reports --reporter html ./all-blob-reports` to also emit JSON — e.g.
   `--reporter html,json` (Playwright's merge-reports supports the same multi-reporter list
   the test runner does) — or run a second `merge-reports --reporter json` pass. This is the
   exact report `scripts/e2e-timings.mjs` already knows how to consume; today a human has to
   `gh run download` the blobs and run this by hand, per that script's own header comment.
2. Feed the JSON into `scripts/e2e-timings.mjs` (already written, already tested indirectly by
   `tests/e2eShardSplit.test.ts` importing its sibling module) to rewrite `tests/e2e/timings.json`.
3. Gate the write on `github.event_name == 'push'` (i.e., only on a run against `main`, which
   per `ci.yml`'s trigger only happens after a PR merges) — never on `pull_request` runs. This
   is what removes the concurrent-PR race in §5 and matches §3.2/§3.3's pattern of writing
   generated data only from the trunk, never from a feature branch.
4. Commit with `stefanzweifel/git-auto-commit-action`, `permissions: contents: write` on that
   job, scoped with `file_pattern: tests/e2e/timings.json` so nothing else the job touched gets
   swept in.
5. Per §4, this commit will not re-trigger `ci.yml` — no loop guard needed, and no CI run is
   wasted re-testing an already-tested merge.

**What this replaces:** the manual step implied by `scripts/e2e-timings.mjs`'s own header
comment (`gh run download` + `merge-reports` + `node scripts/e2e-timings.mjs`, run by a human
who has to remember to do it) goes away entirely. `tests/e2eShardSplit.test.ts`'s 10%
threshold stops being a countdown to an inevitable red PR and becomes what it was written to
be: a guard against a *structurally* new spec never having run in CI at all (the
`brandNew.spec.ts` case the test already covers), not a proxy for "nobody ran the chore."

**What this does not change:** the check itself, `assignShards`'s longest-processing-time
algorithm, and the `UNMEASURED_SECONDS` pessimistic default all stay — they are correct and
none of the research above suggests a mainstream project does better than
longest-processing-time for this kind of ahead-of-time split (§2's runners that beat it do so
with a live queue service, which is a materially bigger dependency than this fix).

**This makes the ticket smaller, not bigger.** No new service, no new dependency, no schema —
one existing job gains a reporter flag and a four-line commit step, using an action
(`stefanzweifel/git-auto-commit-action`) that is a single well-known, widely used step. The
"who writes it" design question the owner's prompt raised has one answer that fits murlan's
size and existing CI shape: the same job that already builds the merged report, once, right
after a merge, to a repo with no branch protection standing in the way.

---

## 7. Not found / not published

- **A named large repo (React, Vite, Astro, Next.js, Angular, Rust) committing *test-timing*
  data to `main` via bot, specifically**, was not found in the time available. The closest
  precedents found were: API Extractor / TypeScript baselines (human-committed, §3.1, a
  different kind of generated file — one worth a reviewer's eyes) and
  `github-action-benchmark` (bot-committed, but to a side branch, §3.2). Angular's and
  Next.js's bundle-size tooling
  ([nextjs-bundle-analysis](https://www.npmjs.com/package/nextjs-bundle-analysis)) comments on
  the PR rather than committing anywhere, and its own docs note the *base* comparison number
  does need one committed run on the default branch to exist before comparisons work — but
  that base is described as a one-time bootstrap, not an ongoing bot-commit habit, and this
  document did not find Angular's or React's own CI source to check further.
- **Nx's Atomizer/Distributed Task Execution**: whether historical duration data is ever
  persisted into the repository, versus exclusively inside Nx Cloud, is not stated in the docs
  pages fetched (§2.6). Not found — not claimed either way.
- **Whether Playwright plans to add duration-aware `--shard` natively**: no roadmap statement
  found; Vitest's identical gap is tracked as an open issue
  ([vitest-dev/vitest#9184](https://github.com/vitest-dev/vitest/issues/9184)) with no shipped
  resolution as of this research.
