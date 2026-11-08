# Suites

How each suite runs, and the long recipes behind the rows of `docs/agents/checks.md`'s routing
table. Read the section the table sends you to; which suites you run by hand and which you leave
to CI is rules 1–3 in `docs/agents/RULES.md`.

## Running each suite

- **Native renderer** (`jest`, `jest-expo`) runs every suite twice, once with `Platform.OS ===
  'ios'` and once `'android'`, except a `*.compiled.test.tsx`, which runs once, under the React
  Compiler (the `compiled` project, which `related-tests.mjs` selects beside `ios`) — the only layer that runs app code the way a phone does; the web
  e2e suite runs through `react-native-web`, which resolves a *different* module graph and takes
  the other side of every `Platform.OS` branch. Tests are named `.test.tsx` on purpose: `node
  --test` globs `tests/**/*.test.ts` and must not pick them up — see `docs/agents/checks.md`,
  "Node's TypeScript loader".
  Give jest the path before `--selectProjects`: after it the path is read as a project name and the whole project runs.
- **Integration** creates an empty Postgres schema and nothing else; every table comes from the
  app's own `ensureSchema()`, so each run also tests that boot-time schema creation works on a
  database that has never seen it. `tests/helpers/gameDriver.ts` is the shared "play a real hand
  to completion" machinery every suite needing `handleRoundOver`'s writes rides.
  ```sh
  node scripts/dev-stack.mjs up
  export $(node scripts/dev-stack.mjs env | grep -E '^(DATABASE|REDIS)_URL=')
  node --test tests/integration/<file>.test.ts
  ```
  An empty `DATABASE_URL` or `REDIS_URL` means every test silently skips. Each server takes its
  own schema, and the Redis keyspace named after it, and drops both, so runs don't collide and the container can stay up between runs of one sitting
  (`node scripts/dev-stack.mjs down` when you're done).
- **Web e2e** plays real matches, offline and online, against the real server, in Italian, and
  rebuilds the bundle first; `E2E_SKIP_BUILD=1` reuses the last one (rule 5). Two
  runs at once are safe, each takes its own port (#491). Reach a table without playing to one:
  `openSeededGame(page, baseURL, 4)` (`tests/e2e/helpers/offlineSeed.ts`).
- **The loop harness** shares nothing with the game's suite but the repository —
  `docs/agents/loop-harness.md`. **Android (Maestro)** and **iOS** are the two device jobs —
  `docs/agents/device-runs.md`.

## Mutation

`npx stryker run --mutate <file>` (`stryker.config.mjs`) finds a mutant of `lib/game/` or
`server/game/` no node test notices; never a gate. `.github/workflows/mutation.yml` runs every
file weekly in line-range shards of at most `SHARD_MUTANTS` mutants (`tools/ci/mutation.mjs`), and
files the survivors under `mutation`.

## Effect parity (#1252)

For a moment, a sound, a haptic, the lamp, the shake: the `mockupParity*.nightly.spec.ts` file
running its moment alone (rule 3), the moment registered in `MOMENTS` in
`tests/e2e/helpers/mockupParity.ts`. Each test records in real time on one worker, so iterate on
one variant's file and never run the whole set for a single tweak.

The parity and pixel specs (every `*.nightly.spec.ts`; `tests/e2e/tiers.mjs` holds the tiers, and
the suffix is the tier) are out of pull-request CI: `.github/workflows/parity-nightly.yml` runs
them nightly, report-only, files a red run under `parity` and publishes the side-by-side page as
its `mockup-parity` artifact. Locally,
`npx playwright test --config tests/e2e/playwright.parity.config.ts` runs them all, or one file
named after it (the default config ignores them, so rule 3's command finds no test), and
`node scripts/mockupParityPage.mjs <report> <out>` builds the page.

What it compares: the app's trace against the picked mockup's on one virtual clock — onsets,
particle counts, lamp, shake, region brightness, the moth's path, an onset held to a window, the
particle layer's frames apart (`tests/e2e/helpers/traceDiff.ts`). Each sampled frame is held to
the mockup lit as the felt that drew the app's frame lights it (`underAppFelt`, from the trace's
`felt`): a web-fallback frame, which bakes its light, against the mockup's felt and rail at rest,
a Skia one against the swaying mockup, so a Skia run's frames before Skia's first are fallback
frames; the lamp's trace sways on both sides, and both sides count from the mount.

## The viewer's own connection

The drop, the hold, give-up, the way back: `tests/ui-rules/{ownLink,reconnectDiff}.test.ts` and
`tests/native/{ownLinkHold,onlineCatchUp}.test.tsx`, then `tests/e2e/reconnect.spec.ts` and
`tests/e2e/mockupParityReconnect.nightly.spec.ts` alone, the latter under
`tests/e2e/playwright.parity.config.ts`.

The parity spec runs the app on **real time** (the socket's timers stall under the virtual clock,
#1250) beside the mockup on the virtual one, drops the socket through `page.routeWebSocket` and
refuses retries by going offline: a retry must fail with an error, since socket.io ignores a close
while opening and waits its 20 s `timeout`.

They catch the pill's states and Riprova, and (native only) the turn pill's lost state and Riprova
handed to the table over a finished match; the grey, the lamp's freeze, the pill's onsets, the
recovery sound and the give-up's dimmed lamp against the mockup's `reconnect` chapter, each side
on its own drops, return and give-up (`tests/e2e/helpers/reconnectDiff.ts`); the app's give-up
waits out `Reconnect.giveUp`, so the parity spec takes ~1.5 min.

## A table card's shadow

`tests/ui-rules/cardShadows.test.ts`, `tests/native/{tableCards,handShadeWiring,handShadeRebuild}.test.tsx`,
`tests/e2e/landingShadowStill.spec.ts` (blocking: no shadow rebuilt through a landing wobble),
then `tests/e2e/cardShadowParity.nightly.spec.ts` and `mockupParity.nightly.spec.ts`'s `rest`
alone, and `mockupParityBomb{Skia,Fallback}.nightly.spec.ts`, under
`tests/e2e/playwright.parity.config.ts`. They catch: the mockup's numbers; any card view carrying
its own shadow; the card shade's canvas, the hand's and pile's paint order and rebuild on a
resize; the felt's shadow against the mockup's `.card` under the same light, a hand card's on the
card beneath (the `hand` region) and a pile card's (the bomb's `pile` region).

## Differential: how a round plays

For the deal, the opener, a rule, the bot. `.github/workflows/differential.yml` runs weekly and on
dispatch (input `baseline`), never on a pull request, and files red runs in the tracker:
`node tests/differential/trace.ts <tree>` on a baseline and on HEAD, then
`node tests/differential/compare.ts <baseline.jsonl> <head.jsonl> --accepted <file> --head-level transition`, once for `tests/differential/accepted.json` (the current baseline) and once for
`tests/differential/wave-1650.json` (the #1650 wave's 19 attributed diffs against `9d0359590`).
Each entry holds where its match first differs, so a later change to that match fails as moved.

Attribute a differing match by bisecting it in a second worktree (with a `node_modules` link)
while the scripts run from the HEAD checkout `$H`:

```sh
git bisect start <head> <baseline> && git bisect run sh -c 'node $H/tests/differential/trace.ts . --tables 3 --seeds 61 > /tmp/one.jsonl && node $H/tests/differential/compare.ts /tmp/baseline.jsonl /tmp/one.jsonl --match 3:61'
```

An entry is accepted only with the first commit the bisect names and that commit's issue or
`docs/GAME-RULES.md` § Decisions row; a new wave's baseline is one commit, the new `baseline` and
emptied `entries`.

It catches a seeded match playing differently from the baseline with no entry naming why, an
entry that no longer differs or now first differs elsewhere, a table that compared nothing, a
match that errored, a HEAD with no transitions; at the deepest level both trees offer
(`onTransition`, else round level), held to the file's `level`. About 25 s a tree for 600 matches;
about 5 s to bisect one match over ~550 commits.

## A flake is fixed, never retried or quietly skipped

Rule 53 is judged from what the runners report, not from what the source says. Each of `npm test`,
`loop:test`, `test:native` and `test:e2e` carries a results reporter (`tools/ci/results-*.mjs`,
through `tools/ci/results-writer.mjs`) that writes one JSON-lines file per runner invocation into
`$MURLAN_TEST_RESULTS`: a `run` record naming the runner and every name filter it ran under, one
`test` record per test with its status and its retry attempt, and an `end` record with the
runner's own verdict. The writer unsets the variable for the runner's children, so a nested run
inside a test writes nothing. Each test job uploads the directory as
`test-results-<job>-<shard>-<attempt>`, even when the job fails, and errors if it is empty.

CI gate's step "Every test that ran passed, once, and none was skipped unheard" downloads every
such artifact of the run and fails on:

- a test that failed, in any run attempt: re-running a failed job is a retry;
- a test that ran with retries allowed or used (Playwright's `retries` and `retry`, a jest test
  invoked more than once by `jest.retryTimes`; `node --test` has no retry);
- a skip or todo whose file and title never passed anywhere else in the run, unless
  `tools/ci/quarantine.json` holds it (below);
- a run filtered by name (`--test-name-pattern`, `--test-skip-pattern`, `--test-only`,
  `--test-shard`, jest's `-t` and changed-file modes, Playwright's `--grep`, `--grep-invert`,
  `--project`, `--last-failed`, `--only-changed`, `--test-list` and a config or project `grep`):
  a test filtered out reports nothing at all;
- a job that ran and uploaded nothing, a results file that ends before its runner did or whose
  runner called it red, an artifact that did not arrive, a job the gate does not need, an artifact
  from a job no suite judges, and a job the gate needs that is neither in `SUITES` nor in
  `NON_TEST_JOBS` (so a new test job cannot pass by uploading nothing);
- a test file in a suite's listing (from the head's tree) in which no test passed, and a listing
  under the suite's floor in `SUITES`.

A skip that is fine passes elsewhere: the win32-only loop tests skip in `harness` and pass in
`harness-windows`. A skip nothing else runs — an integration suite without Postgres, a test that
needs `gh` without a token — is red, which is what replaced verify's grep of the log. A test is
keyed by its spec file, not by where `test()` was called, so a test a shared helper registers in
two specs is two tests; and a node test file that registered no test, or exited mid-run, is not
counted as a pass for the wrapper node reports in its place.

A flake that cannot be fixed the day it is seen may wait in the quarantine, bounded by base code:
an entry the base does not hold verbatim is an addition, and an addition is red unless the pull
request changes `tools/ci/quarantine.json` and nothing else, and unless its `expires` is at most
`QUARANTINE_DAYS` (14) out. Every entry is red once its day has passed and unless its `issue` is
open and labelled `ci-flake` (read from the API), and a ledger over `QUARANTINE_CAP` (5) holds
nothing. Renewing an expiry is an addition. Loosening any bound is a change to
`tools/ci/test-verdict.mjs`, which is a `JUDGES` file and takes effect only once it is the base.

The gate runs the base's copy of `tools/ci/test-verdict.mjs` (`HEAD^1` of the merge commit on a
pull request), extracted with `git archive`. Where the base has none yet it runs the head's: that
`|| from=HEAD` fallback is bootstrap only, and goes once this lands on main. The verdict, the ledger, the reporters, `gate.mjs`, `scope.mjs` and
`ci.yml` are `JUDGES` in `tools/ci/target-freeze.mjs`, rendered into `.github/CODEOWNERS` beside
rule 52's targets but frozen with nothing. Text from the head is escaped before it reaches a
`::error::` line. `tests/tooling/testVerdict.test.ts` plants every bypass in a scratch project, runs
the real runner over it with its real reporter, and asserts the verdict over that output is red.

What still runs early, before any test: `murlan/no-focused-test` in `eslint.guards.cjs` and
Playwright's `forbidOnly` on CI. Both are cheap signals; the gate is the guarantee.

**Limits.** The judge is the base's, but on a pull request `ci.yml` is the head's, so the base's
judge guards only a head that leaves the workflow alone: a change to `ci.yml` can drop a reporter,
an upload, or the gate step itself, or run a judge of its own, and so can a test that forges or
deletes its own results file. `JUDGES` routes such a change to the owner, but CODEOWNERS binds
nothing until the ruleset requires code-owner review (`docs/agents/target-freeze.md`), so today
review is the only thing in the way. The durable fix is a follow-up: a "Test verdict" check run
from the default branch by a `workflow_run` trigger on CI, judging CI's artifacts with main's
workflow and main's judge, required by the ruleset.
The scope job skips suites a change does not reach, and the gate judges only what ran. A runner
that stops at a test's own early `return` reports a pass; Playwright's `test.fail()` and jest's
`test.failing` are passes when the test fails as declared. A skip is heard by file and title, not
by project or platform: an android-only skip passes on the ios run of the same test
(`tableRelocksAfterEntry.test.tsx`), and two tests of one title in one file share one key, so one
skipped beside its passing twin is heard. Every workflow but `ci.yml` (`maestro.yml`, `ios.yml`, the
nightly and soak runs) runs outside CI gate, and its results are not judged; `maestro.yml`'s retry
re-runs a flow that never started because the emulator did not boot.
