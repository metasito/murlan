# Checks

Which check catches what a change needs and what it costs, the local ports, and an index of the
traps that pass every check and still ship broken. Read this before a rendering change, not after a
green loop has already lied to you. Rules live in `docs/agents/RULES.md`; this file and the ones
it links are the *why* and the *gotcha*, not a restatement of either. Open a linked file only when
its trigger applies.

## Shell

The shell is **pwsh**: `$PSVersionTable.PSVersion.Major` is **7** or higher, and
`$OutputEncoding.WebName` is **utf-8**. `&&`/`||` work, `$env:NAME` sets a variable, and a
multi-line GitHub body still goes through `--body-file`, because the problem is quoting, not
encoding. Git Bash is available for POSIX scripts. `tests/tooling/shellClaims.test.ts` measures
both floors against the shell actually running, so a self-update or a falsified floor goes red
instead of sitting unguarded in prose.

## Pick the loop by what you changed

| You changed | Run | Catches | Needs | Cost |
| --- | --- | --- | --- | --- |
| Pure logic (`lib/`, `*Model.ts`, `tableArc.ts`) | `node --test tests/<file>.test.ts` | the maths, the guards, i18n key parity, colour contrast under CVD | nothing | ~1s |
| The server, the socket protocol, auth or storage | same command, under `tests/integration/` | routes and handlers end to end, boot-time schema creation | `DATABASE_URL` and `REDIS_URL` (`docs/agents/suites.md`) | ~10s/file |
| Whether any test asserts a line of `lib/game/` or `server/game/` | `npx stryker run --mutate <file>` (`docs/agents/suites.md` § Mutation) | a mutant no node test notices; never a gate | nothing | ~2 min dry run, then per mutant |
| A component's props or tree | `jest`, once per `Platform.OS` | render, memo, hook order, native-only branches | nothing | ~8s |
| Anything with **layout** (flex, absolute, transform) | Playwright | which side of the screen it is on | Docker + a built web bundle | ~35s |
| Anything **visual** (colour, gradient, shadow, size) | pixel-sample two PNGs on the same grid | pixels vs the prototype | Docker + a built web bundle | ~40s |
| An effect under #1252 (a moment, a sound, a haptic, the lamp, the shake) | its `mockupParity*.nightly.spec.ts` file alone (`docs/agents/suites.md` § Effect parity) | the app's trace against the mockup's on one virtual clock | Docker + a built web bundle | ~2.5 min |
| The viewer's own connection: the drop, the hold, give-up, the way back | the files in `docs/agents/suites.md` § The viewer's own connection | the pill, the lamp's freeze, the recovery against the mockup's `reconnect` chapter | Docker + a built web bundle for the specs | ~1s / ~3s / ~1 min, ~1.5 min |
| A table card's shadow | the files in `docs/agents/suites.md` § A table card's shadow | the mockup's numbers, paint order, the felt's shadow under the same light | Docker + a built web bundle for the spec | ~1s / ~70s / ~1 min |
| Tokens, contrast, roles | `node --test tests/ui-rules/{contrast,tokenRoles,cosmetics}.test.ts`; the table's text inks, read off the modules' own sheets: `npx jest --selectProjects ios tests/native/tableTextContrast.test.tsx` | AA floors | nothing | ~1s / ~10s |
| Must **boot and stay drivable on iOS** | `.github/workflows/ios.yml`, dispatched (`docs/agents/device-runs.md`) | a crash, a screen that never renders, a control the flows tap going missing — on a real simulator | a device dispatch | under 15 min warm, held by its gate; on a native change, `ios-app-cache.yml`'s ~21 min build first |
| Must **boot and stay drivable on Android** | `.github/workflows/maestro.yml`, same trigger policy | same, on a virtual device | a device dispatch | not yet green in the release-APK shape; #1206 landed the build-time and emulator fixes |
| A change to how a round plays: the deal, the opener, a rule, the bot | `.github/workflows/differential.yml`, weekly and dispatched, never on a pull request (`docs/agents/suites.md` § Differential, with the bisect) | a seeded match playing differently from the baseline with no entry naming why | nothing | ~25s a tree for 600 matches |
| The ticket loop (`tools/loop/`) | `node --import ./tools/loop/tests/helpers/clearLoopEnv.mjs --test tools/loop/tests/<file>.test.ts` (`docs/agents/loop-harness.md`) | the supervisor, the gate, the picker, the workspace tools | a signed-in `gh`, for `deleteBranchOnMerge.test.ts` only | ~40s |
| A parity target or the target guard | rule 52 (`docs/agents/target-freeze.md`) | a target moved beside the code | nothing | — |

`node --test` over `tests/**/*.test.ts` is one command for the first two rows —
`tests/integration/` folds in and self-skips without `DATABASE_URL` or `REDIS_URL`. A unit test
lives beside what it exercises: `tests/engine/`, `tests/bots/`, `tests/server/`, `tests/ui-rules/`,
`tests/tooling/` — none sits at the top of `tests/` (`tests/tooling/repoLayout.test.ts`).
`npm run test:tooling` runs `tests/tooling/` alone; a directory handed to `node --test` fails on Node 22, so
nothing shows that form (`tests/tooling/testInvocationForm.test.ts`).

## Local ports

| Port | For | Owner |
| --- | --- | --- |
| `5000` | The Express server (`PORT`) | `server/index.ts` |
| `8081` | Metro (`npx expo start` / `npm start`) | Metro's own default |
| Any, the OS's choice (`PORT=0`) | Every server a test spawns or listens on; `boot()` waits for the server's `ready on port N` line, which it announces once the Redis adapter is reading, and takes the bound port from it | `tests/helpers/instance.ts`, pinned by `tests/tooling/integrationPorts.test.ts` |
| `5099` | The diagnostics collector the bench posts to | `scripts/diagnostics-collector.mjs` |
| Any, the OS's choice (`PORT=0`) | Playwright's e2e webServer; its config waits for the server's `ready on port N` line and hands N to the specs as `E2E_PORT` | `tests/e2e/playwright.config.ts`, `tests/e2e/fixtures.ts` |
| `45432`+ | The dev-stack's disposable Postgres (`MURLAN_DEV_PG_PORT`) — ask `dev-stack env`, don't assume 45432 | `scripts/dev-stack.mjs`, `scripts/devStackPort.mjs` |

## Traps, by when they bite

Open the section when its trigger applies; each is in `docs/agents/traps.md` unless named.

- **A shared style uses `shadow*`, `rx`/`ry`, a scaled text box, `overflow`, `willChange`,
  `boxShadow` or `<Use href>`** — § React Native Web traps, with the `react-native-svg` renderer
  table.
- **A loop or spec is green and you are about to believe it** (bot delays zeroed, a cached
  `EXPO_PUBLIC_*`, zero tests collected, a timed-out run, a stale `node_modules`) — § What a green
  loop does not mean.
- **You write a scan, or a scan has never been red** — § A scan needs a planted floor.
- **A rule forbids a shape of code** — § Where a forbidden-shape rule goes.
- **A native test presses, unmounts or reads an animated style** — § The native harness is async.
- **A suite is red with nothing to explain it** — § Starvation looks like a red suite (memory,
  `npm run reap`).
- **A worktree, a Metro cache, a `tsc` route error or SwiftShader** — § Remaining traps.
- **A defect was seen on a phone, or the change needs a device run, a capture or the bench** —
  `docs/agents/device-runs.md`, with what no automated layer covers and the manual release
  checklist.
- **A module a `node --test` file loads imports JSX, `@/` or `react-native`** — below.

## Node's TypeScript loader reaches plain `.ts` only

`node --test` type-strips plain `.ts` and does nothing else: it cannot parse a `.tsx` file, and
resolves no bundler/tsconfig `paths` alias, so a runtime `@/` import throws at load (a type-only
`@/` import is fine — it's erased first). A module a `node --test` file has to reach therefore
stays free of JSX and of any import from a `.tsx` file, with relative, extensioned runtime
imports (`tsconfig.json`'s `allowImportingTsExtensions`). That's why the pure-logic modules
beside a component exist — `components/handLayout.ts` next to `table/hand.tsx`, and the rest of
that family.

The same loader cannot load `react-native` itself (its entry point is Flow-typed, not
TypeScript, and type-stripping has no Flow plugin) — so a file `node --test` runs stays free of any `react-native` import, transitive included. That's why `lib/tokens.ts` holds the palette
`lib/theme.ts` wraps, and why suites needing the renderer are `.test.tsx` under jest, where Metro
resolves the package instead.

Separately: files that type-strip fine but are run with `tsx` instead of `node --test` fail with
`The "paths[0]" argument must be of type string`, because `import.meta.dirname` is `undefined`
under `tsx` — reads like a bug in whatever you touched. Run these with `node --test`, per rule 3.

This is the only place the constraint is written down — every governed file carries a one-line
pointer here instead of restating it, and `tests/tooling/loaderConstraintIsSingleSourced.test.ts`
holds the count of files explaining it at one (this file).
