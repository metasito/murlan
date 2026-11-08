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
