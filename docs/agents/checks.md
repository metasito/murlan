# Checks

Which check catches what a change needs, what each one costs, the local ports, and the traps
that pass every check and still ship broken. Read this before a rendering change, not after a
green loop has already lied to you. Rules live in `docs/agents/RULES.md`; this file is the *why*
and the *gotcha*, not a restatement of either.

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
| The server, the socket protocol, auth or storage | same command, under `tests/integration/` | routes and handlers end to end, boot-time schema creation | `DATABASE_URL` (dev-stack, below) | ~10s/file |
| A component's props or tree | `jest`, once per `Platform.OS` | render, memo, hook order, native-only branches | nothing | ~8s |
| Anything with **layout** (flex, absolute, transform) | Playwright | which side of the screen it is on | Docker + a built web bundle | ~35s |
| Anything **visual** (colour, gradient, shadow, size) | pixel-sample two PNGs on the same grid | pixels vs the prototype | Docker + a built web bundle | ~40s |
| An effect under #1252 (a moment, a sound, a haptic, the lamp, the shake) | the `mockupParity*.spec.ts` file running its moment alone (rule 3), the moment registered in `MOMENTS` in `tests/e2e/helpers/mockupParity.ts`. Each test records in real time on one worker, so iterate on one variant's file and run the whole `mockupParity` set exactly once, before pushing — never all of it for a single tweak; `node scripts/mockupParityPage.mjs <report> <out>` builds the side-by-side page, and CI publishes it as the `mockup-parity` artifact | the app's trace against the picked mockup's on one virtual clock: onsets, particle counts, lamp, shake, region brightness (`tests/e2e/helpers/traceDiff.ts`) | Docker + a built web bundle | ~2.5 min |
| Tokens, contrast, roles | `node --test tests/ui-rules/{contrast,tokenRoles,cosmetics}.test.ts` | AA floors | nothing | ~1s |
| Must **boot and stay drivable on iOS** | `.github/workflows/ios.yml`, dispatched, and twice a week on `main` (below) | a crash, a screen that never renders, a control the flows tap going missing — on a real simulator | a device dispatch | ~23 min warm, ~28–46 min cold |
| Must **boot and stay drivable on Android** | `.github/workflows/maestro.yml`, same trigger policy | same, on a virtual device | a device dispatch | not yet green in the release-APK shape; #1206 landed the build-time and emulator fixes |
| The ticket loop (`tools/loop/`) | `npm run loop:test` | the supervisor, the gate, the picker, the workspace tools | nothing | ~40s |

`node --test` over `tests/**/*.test.ts` is one command for both rows above it — `tests/integration/`
folds in and self-skips without `DATABASE_URL` (below). Rules 1 and 2 in `docs/agents/RULES.md`
decide which of these you run by hand and which you leave to CI. A unit test lives beside what it
exercises: `tests/engine/`, `tests/bots/`, `tests/server/`, `tests/ui-rules/`, `tests/tooling/` —
none sits at the top of `tests/` (`tests/tooling/repoLayout.test.ts`).

## Local ports

| Port | For | Owner |
| --- | --- | --- |
| `5000` | The Express server (`PORT`) | `server/index.ts` |
| `8081` | Metro (`npx expo start` / `npm start`) | Metro's own default |
| `5561`, `5562`, `5571`, `5581` | One `tests/integration/` file's own spawned server each | pinned by `tests/tooling/integrationPorts.test.ts` |
| `5199`+ | Playwright's e2e webServer (`E2E_PORT`) — first free port at/above the base | `tools/ci/e2ePort.mjs`; a leftover is freed by `tools/loop/reap.mjs` |
| `55432`+ | The dev-stack's disposable Postgres (`MURLAN_DEV_PG_PORT`) — ask `dev-stack env`, don't assume 55432 | `scripts/dev-stack.mjs`, `scripts/devStackPort.mjs` |

## Running each suite

- **Native renderer** (`jest`, `jest-expo`) runs every suite twice, once with `Platform.OS ===
  'ios'` and once `'android'` — the only layer that runs app code the way a phone does; the web
  e2e suite runs through `react-native-web`, which resolves a *different* module graph and takes
  the other side of every `Platform.OS` branch. Tests are named `.test.tsx` on purpose: `node
  --test` globs `tests/**/*.test.ts` and must not pick them up — see *Node's TypeScript loader*.
- **Integration** creates an empty Postgres schema and nothing else; every table comes from the
  app's own `ensureSchema()`, so each run also tests that boot-time schema creation works on a
  database that has never seen it. `tests/helpers/gameDriver.ts` is the shared "play a real hand
  to completion" machinery every suite needing `handleGameOver`'s writes rides.
  ```sh
  node scripts/dev-stack.mjs up
  DATABASE_URL=$(node scripts/dev-stack.mjs env | sed -n 's/^DATABASE_URL=//p')
  DATABASE_URL="$DATABASE_URL" node --test tests/integration/<file>.test.ts
  ```
  An empty `DATABASE_URL` means every test silently skips. Each server takes its own schema and
  drops it, so runs don't collide and the container can stay up between runs of one sitting
  (`node scripts/dev-stack.mjs down` when you're done).
- **Web e2e** plays real games, offline and online, against the real server, in Italian, and
  rebuilds the bundle first; `E2E_SKIP_BUILD=1` reuses the last one (rule 5). Two
  runs at once are safe, each takes its own port (#491). Reach a table without playing to one:
  `openSeededGame(page, baseURL, 4)` (`tests/e2e/helpers/offlineSeed.ts`).
- **The loop harness** shares nothing with the game's suite but the repository — see *The loop is
  a second product*, below. **Android (Maestro)** and **iOS** are the two device jobs, next.

## Device runs

`.github/workflows/ios.yml` builds a release `.app`; `maestro.yml` compiles a release APK. Both
drive `smoke` → `offline-game` → `exchange-phase` → `rematch-prompt` on a real simulator or
emulator. A ticket dispatches them from its own branch when its work needs a device run
(`gh workflow run ios.yml --ref agent/<n>-<slug>`), and both run on `main` twice a week: a branch
can read only its own cache and main's, so a branch's first run restores main's native build
instead of compiling it cold, and a cache unread for 7 days is evicted. By the owner's decision; a
red run is diagnosed from its artifacts, never rerun. A red scheduled run files or comments on
that workflow's open `device-run` issue. `gh run list --workflow=ios.yml --branch
agent/<n>-<slug>` (or `maestro.yml`) is a ticket's current status — without `--branch` the list
mixes in main's scheduled runs. Wait on runs with `node tools/loop/await-run.mjs <run-id>
[<run-id>…]`, which exits 0 when all passed, 1 when one did not, 2 when `gh` cannot find a run id,
and 3 when some are still going: then run the same command again. It returns before the default
Bash timeout, so it needs no `timeout` of its own; a loop session's `gh run watch` is refused
because a device run outlasts any Bash timeout. `ios.yml` and `maestro.yml` run side by side,
so dispatch both and wait on both run ids at once; a second dispatch of the same workflow on one
branch cancels the first. **These two release builds are the only device path**: a release build carries its
own bundle, so no packager, dev server or `adb reverse` is involved, and the flows take the app id
from `MAESTRO_APP_ID` with no default. No host client can stand in for them: a host's dev-menu
window sits above the app's own and eats the touch — `tapOn` reports `COMPLETED` regardless
(#627). Both jobs pin the same Maestro version and check it reads back off the
installed binary, so a version drift is a named failure (`tests/tooling/realAppNotExpoGo.test.ts`
holds both to it). Reproducing locally needs the same pin: `export MAESTRO_VERSION=2.10.0` before
`curl -Ls https://get.maestro.mobile.dev | bash` — read from the installer's own environment, so
it must be exported above the pipe.

CI compiles the Android and iOS projects on a pull request that changes `package.json`'s
`dependencies` or the app config (`tools/ci/nativeScope.mjs`), and weekly. When a ticket asks for
a native build otherwise, request one: `gh workflow run ci.yml --ref agent/<n>-<slug> -f
native=true`, then wait on it with `await-run.mjs`.

A device job proves the flows still run and the app renders *something* — it does not replace
looking at the device (rule 36); a green Chromium run closed #602 while the owner still saw the
same broken screen.

**Getting one:** states are `lib/captureStates.ts` — the contract both `app/capture.tsx` (device)
and `tests/e2e/lampSeats.spec.ts` (Chromium) walk, so a photograph and a web run are of the same
state; add a state there, not in a spec. Open `/capture`, pick a state, hold landscape, and ask
for it verbatim: *"send one landscape screenshot of each state: `lamp-bottom`, `lamp-right`,
`lamp-top`, `lamp-left`, `pile-right`, named after its state."* **Sample pixels, don't describe
them** — measuring beats eyeballing, every time (#209).

**Traps found by actually running these, not by writing the YAML:**
- A center-tap on a fanned/overlapping hand card can select the neighbour — the reported bounds
  are correct, but the next card's z-order covers the center point. Tap ~20px into a card's
  exposed left sliver instead.
- Reanimated's always-on glow/pulse on the game table blocks Maestro's default `tapOn` — which
  waits for the UI to "stop changing" — for its full timeout on a screen that never settles. Pin
  `waitToSettleTimeoutMs: 500` on every `tapOn` there.
- A Maestro step name is not evidence of what was on screen when it ran — the next assertion can
  pass against whatever hierarchy Maestro already read if the app died mid-flow; the screenshot
  beside a failing step is the evidence. Both device workflows fail a run in which the app itself
  died of a native crash — a tombstone in the logcat, a report in the simulator host's
  DiagnosticReports (`tools/ci/find-native-crash.mjs`, #629, #1293). `node tools/ci/analyze-maestro-run.mjs
  <maestro.log> <logcat.txt>` separates a command starved by animation from one paying a flat
  per-fetch cost (#823), from the `maestro-debug`/`maestro-debug-ios` artefact.

## What no automated layer here covers

Real device/web divergences, verifiable only on hardware:

- **Reanimated v4 worklets** — the native-renderer suite's shim runs no UI thread and no frame
  loop; jank and a UI-thread crash are device-only.
- **Audio** — `expo-audio` calls are asserted; whether sound is audible, mixed correctly, or
  survives the silent switch is device-only.
- **Screen orientation** — `expo-screen-orientation` is a no-op on web; the landscape lock has
  never run under any automated layer.
- **Haptics** — gated and asserted (`tests/native/haptics.test.tsx` and siblings), but whether
  the phone actually buzzes is device-only.
- **Safe-area insets** — the native renderer injects fixed metrics; a real notch, dynamic island
  or gesture bar is device-only.
- **Text rendering** — font-weight synthesis and line breaking differ from the browser.
- **The New Architecture and the React Compiler** — Fabric and TurboModules are not what Jest
  renders into.

## Manual device checklist

Run by hand on a real phone before a release — nothing above can see these:

1. Landscape lock holds on game screens; menus rotate freely.
2. Card lift and the exchange animation land smooth (the exactly-once invariant is unit-tested,
   `tests/ui-rules/flightPhysics.test.ts` — smoothness itself is not).
3. Sound plays with the ringer off, and the settings toggle silences it.
4. Haptics fire on select, play and win, and stop when switched off.
5. The notification banner slides in and out clear of the notch and gesture bar.
6. Fonts render at the right weight; nothing clips.
7. Backgrounding mid-game and returning reconnects inside the 60s grace window (the server-side
   timer is integration-tested, `tests/integration/reconnect.test.ts`; the on-device resume path
   is not).

## React Native Web traps

Each of these compiles, type-checks, passes every native test, and renders nothing on web — the
platform this app ships as.

- **`shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` are inert on web.** Use
  `makeShadow(...)` from `lib/theme.ts` (emits `boxShadow`; `elevation` is what draws on Android
  below 9). `Shadow.*` is the same helper pre-applied.
- **`<RadialGradient rx ry>` is ignored on web** — SVG has no `rx`/`ry` on `radialGradient`, so the
  browser falls back to `r="50%"`; native's `extractGradient` is what actually reads them
  (`rx: rx || r`). Shape the ellipse on the **rect** (`2*rx` by `2*ry`) and leave the gradient's
  `r` at its default — the inscribed ellipse on both renderers.
- **Text is rasterised before transform** — a scaled container blurs its own label. Scale
  `fontSize`, never the box.
- `overflow: "clip"`, `willChange` and `boxShadow` are real on web and not (or partly) on native —
  see the renderer table below before reaching for any of them in a shared style.

Confirm any of these from the rendered DOM (`page.evaluate(() => el.outerHTML)`), not by
reasoning about the source. **Ask which renderer produced the report, first** — the owner tests
on **iOS, on a build of the app itself**, and a defect that reproduces in Chromium was never about the platform;
one that doesn't needs a device capture (above).

**`react-native-svg` on native is a different implementation, not a polyfill:**

| Written as | Web (`react-native-svg-web`) | Native (`extractGradient`) |
| --- | --- | --- |
| `<RadialGradient rx ry>` | ignored — falls back to `r="50%"` | this is what it reads |
| `gradientTransform` | honoured, unit space | user-space matrix |
| `overflow: "clip"` | clips, no scroll box | not a value RN knows |
| `willChange` | real | inert |
| `boxShadow` | real | real, bar Android below 9 |
| `<Use href>` | one DOM node per reference | Android re-measures the template per reference per draw, one event each: draw in place (#1222) |

## What a green loop does not mean

- **`EXPO_PUBLIC_E2E_FAST=1`** (set by `scripts/e2e-server.mjs`) zeroes every AI delay, so **no
  screenshot is ever taken on a bot's turn** — turn it off to look at turn-handover. Exception:
  `openCaptureState` (`tests/e2e/helpers/offlineSeed.ts`) writes the suspend flag
  (`lib/e2eAiSuspend.ts`) so a seeded capture-state spec holds its turn regardless. Play real
  hands (`tests/e2e/helpers/bot.ts`) and sample *through* a turn handover — one frame is not a
  state.
- **Metro caches the transform that inlines `process.env.EXPO_PUBLIC_*`** — flipping the env var
  and rebuilding gives you the *previous* value; `expo export --clear` rebuilds it (*Remaining
  traps*, below). **`EXPO_PUBLIC_E2E_REDUCE_MOTION=1`** (set only by `maestro.yml`'s build step)
  makes `usePrefersReducedMotion` always return `true`, so the table's looping animation never
  plays under that build (#837) — it answers "does the emulator reach idle", not "what does it
  look like."
- **A spec outside `tests/e2e/` is collected as zero tests, silently** — `testDir` only sees that
  directory, and the webServer still boots and Metro still rebuilds before Playwright reports "0
  tests" (#211). `playwright.config.ts` owns its own `webServer` on `E2E_PORT`, so starting one by
  hand races it for the port. A piped run exits with the pipe's code: `tools/loop/guard-bash.mjs`
  refuses one.
- **A scan that has only ever been green has not been tested, it's been assumed** — rule 6; see
  *A scan needs a planted floor*, below. **A native `fireEvent` without `await` asserts against
  the pre-press state** — see *The native harness is async*, below.
- **A stale `node_modules` reads as a real defect.** It is shared live across every worktree
  (#938); an install can leave `react-native`/`react-native-worklets` looser than
  `package-lock.json` pins, silently (phantom `TS2698`). `tools/loop/preflight.mjs` and
  `tools/loop/agent-check.mjs` both call `checkLockDrift`, and both point at `npm ci`.

## A scan needs a planted floor

Rule 6: a scan must fail on a planted defect. A scan that never found anything and a scan that
can't see anything produce the identical empty list — the convention here is a `// The floor…`
comment (about seventy files carry it, e.g. `tests/ui-rules/feltWeave.test.ts`,
`tests/tooling/bundleRoutes.test.ts`; grepping the literal phrase undercounts it —
`tests/ui-rules/a11yProps.test.ts` does it under a name of its own).

**Which direction a scan fails decides whether you find out.** A substring grep once reported a
dead locale key as live (`common.no` matched inside `common.notice`) — a **false negative**, #512
was written over a confirm dialog that did not exist. A pixel measure (#341) once passed 4:1
before any change, because one thread was already multiplicative — a **green for a live defect**.
Choose loud when you can choose: matching the exact token shape (`/(["'`])([\w.]+)\1/g`) rather
than tracking state across the file avoids a false negative but trades for a quieter one — a key
named only in a comment reads as live, which is why `tests/tooling/e2eSentinels.test.ts` blanks
comments first. Where a scan needs a reasoned exception, `tests/ui-rules/touchTargets.test.ts` and
`tests/ui-rules/i18n.test.ts` (`CONSTRUCTED`) show the allow-list-with-a-reason shape to copy.

**This is a rule, not a check** — neither failure above was ever a committed check at all, so no
repo-level gate could have seen either. The enforcement point is your own loop.

## The native harness is async

`@testing-library/react-native` is v14 here: `render` and every `fireEvent` return promises. Miss
one and the harness reports its own unfinished state as the app's — the handler *did* run, only
the re-render is deferred, so `expect(onExit).toHaveBeenCalled()` passes one line above an
`expect(...).toBe('pressed')` that fails on the same press.

| Form | Re-renders |
| --- | --- |
| `fireEvent.press(x)` alone | **no** |
| `await fireEvent.press(x)` | yes |
| `await act(async () => fireEvent.press(x))` | yes |
| `fireEvent.press(x)` then `await waitFor(...)` | yes |

Write `await fireEvent.press(x)` — it doesn't depend on something else flushing afterward.

**A bare `fireEvent` also leaves its own `act` scope open.** The next `act` entered without
yielding first nests inside it, and the act environment stays corrupted **for the rest of the
file** — every later `render()` returns a tree that finds nothing, which reads as "this screen
can't mount twice" rather than the missing `await` that caused it. `await waitFor(...)` is safe,
since it yields before entering its own scope; **`unmount`/`rerender` are `act` calls too**, so
`await view.unmount()` closes the trap. `tests/tooling/nativeActPairing.test.ts` refuses the
pairing. Don't reach into `.props` to drive a control instead — `getByTestId` returns the host
node, and on a `Pressable` that's the `View`, whose `props.onPress` is `undefined`.

A `useAnimatedStyle` entry is frozen at the render that mounted it, so flattening `props.style` in
a test reads the mount-time value, never the live one. Read it live with reanimated's own
`getAnimatedStyle(node)` (`tests/native/bannerMakesRoom.test.tsx`) rather than mirroring it into
React state, which costs a render of the whole subtree per frame (what #589 shipped and removing
it recovered). No child, and no JS-side code, can read an animated entry.

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
under `tsx` — reads like a bug in whatever you touched. Run these with `node --test`, per rule 4.

This is the only place the constraint is written down — every governed file carries a one-line
pointer here instead of restating it, and `tests/tooling/loaderConstraintIsSingleSourced.test.ts`
holds the count of files explaining it at one (this file).

## Starvation looks like a red suite

| Symptom | Reads as | Actually |
| --- | --- | --- |
| `npx jest` — 2 suites failed | a regression | `npx jest -w 3` on the same commit: 723 passed |
| 37 specs failing at 0ms, `ERR_CONNECTION_REFUSED` | the server never started | nothing had memory to start |
| specs failing inside `openApp` | the #438 flake | a different cause, same shape |
| whole `node --test` **files** exiting `3221225794` (`0xC0000142`) | a branch defect | Windows: no memory to start a process |

**A rerun with fewer workers that disagrees with the first run is the tell** — a real regression
doesn't care how many workers you gave it. Check free memory and rerun with `-w 3` before
believing a red.

`tools/ci/preflightMemory.mjs` is the `globalSetup` of jest and Playwright and `npm test`'s
`pretest`; it's off under `CI` (a runner starts near its floor), and polls up to 60s before
refusing since two sessions can share this machine. `MURLAN_PREFLIGHT_WAIT_MS=0` (env, not a
flag) or `node tools/ci/preflightMemory.mjs --no-wait` skips the wait — waiting is the default, to
survive a peer's teardown burst.

`npm run reap` (`--dry-run` to only list) clears what a killed run leaves, decided **by command
line, never process name** — `chrome.exe` is as likely the developer's own browser. Taken by
default: a stale holder of `E2E_PORT`, anything of ours >2h old with its parent gone, and *any*
process matching that shape burning ≥20% of a core regardless of ownership (once a pipeline held a
full core for 62 hours after its parent Git Bash session was killed, while every ownership check
said "nothing of ours"). Only `--stale` takes anything of ours merely >24h old. A sweep never
takes a port with a live launcher attached — a run now *picks* a free one (`tools/ci/e2ePort.mjs`)
instead, because a webServer pulled from under Playwright manufactures a connection error or 0ms
failure that reads like a defect (a truncated run can manufacture a **green** the same way — check
the spec count, not the colour).

## Remaining traps

- **`git worktree remove --force` deletes straight through a `node_modules` junction into the
  shared install and exits 0, silently.** `tools/loop/guard-bash.mjs` blocks the raw `--force` and
  points at `worktrees:remove` (rule 39);
  `tools/loop/tests/worktreeRemoveCommand.test.ts` plants the defect. `npm run worktrees:prune`
  (`-- --dry-run` to only classify) cleans up one left by a killed/crashed session the same way.
  It only ever removes worktrees directly under `.worktrees/`; one registered anywhere else is a
  person's, and only `worktrees:remove` takes it.
  Never hand-create the junction either — it is actively harmful: `node --test` fails every file
  with `Cannot find package 'typescript'` through one, while `tsc`/`eslint` keep working, which
  reads exactly like a broken branch.
- **Metro keeps one transform cache for the whole machine**, keyed in `metro.config.js` on the
  checkout and the `EXPO_PUBLIC_*` values: `tests/tooling/metroCacheVersion.test.ts` pins both.
- **A `tsc` error about a route that plainly exists is a stale `.expo/types/router.d.ts`** —
  gitignored, generated by the dev server, never regenerated by `tsc` itself. CI has no `.expo`
  and is green; delete the file locally.
- **No unit test can see a layout bug** — `react-test-renderer` never runs flexbox. A green `jest`
  run on a fan rendered off-screen is the normal outcome; only Playwright sees it.
- **The browser suite draws WebGL on SwiftShader, on the CPU**, here and on CI. The web table keeps
  its fallback felt on a software rasteriser (`components/table/feltSkia.web.tsx`), because a
  swaying Skia lamp there took the main thread and timed out the whole suite. A spec of Skia's
  own pixels calls `skiaOnSoftware(page)` first (`tests/e2e/helpers/tableTrace.ts`);
  `tests/e2e/feltIdle.spec.ts` pins both halves. SwiftShader's `GPU stall due to ReadPixels`
  warning is its own, not the app's: `isExpectedNoise` drops exactly that text.

## The loop is a second product, with its own gate

`tools/loop/` — supervisor, gate, picker, workspace tools — has its own suite
(`tools/loop/tests/`, run with `npm run loop:test`) that shares nothing with the game's `npm
test` but the repository. `ci.yml`'s `scope` job sets `app`/`harness` outputs: a diff confined to
`tools/loop/` (plus a short list of shared scripts) sets `harness=true, app=false`; anything else
sets `app=true`; the protocol files (`docs/agents/`, `.claude/`, `CLAUDE.md`) set **both**, since
both `tests/tooling/rulesAreSingleSourced.test.ts` and
`tools/loop/tests/loopDocsAreExecutable.test.ts` read them. A third output, `scans`, is true for
any change at all and runs `verify` (`npm test`) even when `app` is false: `docReferences` and the
other scans that list the repository from its root reach every tracked path, prose included, so a
doc-only change skips the browser, build and lint jobs but never the Node suite
(`tests/tooling/ciScope.test.ts`). The harness job also runs `typecheck`
and `eslint tools/loop`, since the game's jobs that would otherwise do that are skipped on a
loop-only change. Beside it, `harness-windows` runs every loop test file that branches on `win32`
on a Windows runner and fails if any test in them skips: Linux skips those branches, so this is
the only place they run.

**Run `npm run loop:test` from the repo root, never `npm --prefix tools/loop`** — its tests read
the repository itself, so npm's cwd sends every one of them looking in the wrong place. **Move by
subject, not filename**: `tests/ui-rules/contextSlices.test.ts` reads like harness tooling but
asserts the game's React contexts stay a partition, so it stays on the game's side.

**`check:comments` rides both the `Lint` job and the `Loop harness` job**, never `npm run lint`
itself — it's first heard from on CI unless you run it yourself. It diffs against the merge base
via `git diff`, so an uncommitted edit counts but an untracked file doesn't show at all.

**Some hooks act only in a loop session** (`LOOP_TURNS` set; `.claude/settings.json` registers
every hook):
- `tools/loop/guard-bash.mjs` also refuses `sed -i`/`perl -i` (rule 44), a `git worktree add`
  anywhere but `.worktrees/agent-<n>` (rules 7 and 32), and `gh run watch`, which § Device runs
  replaces with `await-run.mjs`.
- `tools/loop/guard-write.mjs` refuses a Write, Edit or NotebookEdit into the shared checkout;
  the worktrees under `.worktrees/`, `.loop-logs/` and paths outside the repo stay writable
  (rules 8 and 31).
- `tools/loop/guard-verdict.mjs` refuses a `VERDICT: LAND` until that round's own reviewers have
  run, or until `loop-gate --review-round` has said the cap is reached (rule 29).

## Owner decisions

Verified intended, not stale:

- The iOS/Android device jobs run on dispatch and on a twice-weekly schedule on `main` that keeps
  its native-build cache from eviction, never gating a PR — not an oversight to "fix" by running
  them on `push` or wiring them into `ci.yml`.
- `MURLAN_PREFLIGHT_WAIT_MS` defaults to waiting rather than failing fast, on purpose; `--no-wait`/
  `=0` is the opt-out, not the default.
