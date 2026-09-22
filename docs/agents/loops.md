# Working loops

Which check catches what a change needs, what each one costs, the local ports, and the traps
that pass every check and still ship broken. Read this before a rendering change, not after a
green loop has already lied to you. Rules live in `docs/agents/RULES.md`; this file is the *why*
and the *gotcha*, not a restatement of either.

## Pick the loop by what you changed

| You changed | Loop | Catches | Cost |
| --- | --- | --- | --- |
| Pure logic (`lib/`, `*Model.ts`, `tableArc.ts`) | `node --test tests/<file>.test.ts` | the maths, the guards | ~1s |
| A component's props or tree | `npx jest tests/native/<file>` | render, memo, hook order | ~8s |
| Anything with **layout** (flex, absolute, transform) | Playwright | which side of the screen it is on | ~35s |
| Anything **visual** (colour, gradient, shadow, size) | the parity harness below | pixels vs the prototype | ~40s |
| Tokens, contrast, roles | `node --test tests/ui-rules/contrast.test.ts tests/ui-rules/tokenRoles.test.ts tests/ui-rules/cosmetics.test.ts` | AA floors | ~1s |
| The server, the socket protocol, auth or storage | `tests/integration/` (needs a database — see below) | routes and handlers end to end | ~10s/file |
| Must **boot and stay drivable on iOS** | `.github/workflows/ios.yml`, dispatched by a ticket on its own branch | a crash, a screen that never renders, a control the flows tap going missing — on a real simulator | ~23 min warm, ~28–46 min cold (runs 35731140313, 35726375597) |
| Must **boot and stay drivable on Android** | `.github/workflows/maestro.yml`, same trigger policy | same, on a virtual device — the only one that logs a native crash | not yet measured on a passing run; every dispatch in the two weeks to 2026-09-22 failed inside 18–30 min |
| The ticket loop (`tools/loop/`) | `npm run loop:test` | the supervisor, the gate, the picker, the workspace tools | ~40s |

Full sweep at the end of an item: `npx tsc --noEmit` → `npm test` → `npx jest` → `npx eslint
components lib tests app`. Rules 1 and 2 in `docs/agents/RULES.md` decide which of these you run
by hand and which you leave to CI.

## Local ports

| Port | For | Owner |
| --- | --- | --- |
| `5000` | The Express server (`PORT`) | `server/index.ts`, `.replit` |
| `8081` | Metro (`npx expo start` / `npm start`) | `scripts/build.js`, `.replit` |
| `5561`, `5562`, `5571`, `5581` | One `tests/integration/` file's own spawned server each | pinned by `tests/tooling/integrationPorts.test.ts` |
| `5199`+ | Playwright's e2e webServer (`E2E_PORT`) — first free port at/above the base | `tools/ci/e2ePort.mjs`; a leftover is freed by `tools/loop/reap.mjs` |
| `55432`+ | The dev-stack's disposable Postgres (`MURLAN_DEV_PG_PORT`) — ask `dev-stack env`, don't assume 55432 | `scripts/dev-stack.mjs`, `scripts/devStackPort.mjs` |

## React Native Web traps

Each of these compiles, type-checks, passes every native test, and renders nothing on web — the
platform this app ships as.

- **`shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` are inert on web.** Use
  `makeShadow(...)` from `lib/theme.ts` (emits `boxShadow`; `elevation` is what draws on Android
  below 9). `Shadow.*` is the same helper pre-applied.
- **`<RadialGradient rx ry>` is ignored on web** — SVG has no `rx`/`ry` on `radialGradient`, so the
  browser falls back to `r="50%"`. Native's `RadialGradient.tsx` → `extractGradient` is what
  actually reads `rx`/`ry` (`rx: rx || r`). Shape the ellipse on the **rect** (`2*rx` by `2*ry`)
  and leave the gradient's `r` at its default — that is the inscribed ellipse on both renderers.
  `tests/ui-rules/vignette.test.ts` pins that no radial shapes itself instead.
- **Text is rasterised before transform** — a scaled container blurs its own label. Scale
  `fontSize`, never the box.
- `overflow: "clip"`, `willChange` and `boxShadow` are real on web and not (or partly) on native —
  see the renderer table below before reaching for any of them in a shared style.

Confirm any of these from the rendered DOM (`page.evaluate(() => el.outerHTML)`), not by
reasoning about the source.

## Ask which platform the report came from, first

Every loop above runs Chromium or nothing (`react-test-renderer` computes no layout, no paint).
The owner tests on **iOS through Expo Go**. Before touching a rendering bug, answer in one line:
*which renderer produced the screenshot?* A defect that reproduces in Chromium was never about
the platform — fix it there. A defect that doesn't needs a device capture (below); there is no
loop that reaches iOS by looking rather than driving it.

**`react-native-svg` on native is a different implementation, not a polyfill:**

| Written as | Web (`react-native-svg-web`) | Native (`extractGradient`) |
| --- | --- | --- |
| `<RadialGradient rx ry>` | ignored — falls back to `r="50%"` | this is what it reads |
| `gradientTransform` | honoured, unit space | user-space matrix |
| `overflow: "clip"` | clips, no scroll box | not a value RN knows |
| `willChange` | real | inert |
| `boxShadow` | real | real, bar Android below 9 |

## The iOS device loop

`.github/workflows/ios.yml` builds a release `.app` and drives `smoke` → `offline-game` →
`exchange-phase` → `rematch-prompt` on a real Simulator on `macos-latest` (no KVM, no emulator
boot to flake). `maestro.yml` runs the same four flows on Android, the only one that produces a
logcat and a crash tombstone. Both run only when a ticket whose work needs a device run
dispatches them on its own branch (`gh workflow run ios.yml --ref agent/<n>-<slug>`); nothing
triggers them automatically, and a red run is diagnosed from its artifacts, never rerun.
`gh run list --workflow=ios.yml` is current status. Red on `exchange-phase` at the 2026-09-21
dispatch is tracked as #1158.

That job proves the flows still run and the app renders *something* — it does not replace
looking at the device. A rendering defect (e.g. #209) needs a screenshot regardless.

**Getting one:**
1. States are `lib/captureStates.ts` — the contract both `app/capture.tsx` (device) and
   `tests/e2e/lampSeats.spec.ts` (Chromium) walk, so a photograph and a web run are of the same
   state. Add a state there, not in a spec. `app/capture.tsx` builds the table in memory rather
   than seeding `/game` (whose AI turn loop would move the seat), so no AI-suspend step is needed
   on device.
2. In a dev build (Expo Go or `npx expo start`): open `/capture`, pick a state, hold landscape.
   The rail's lower knob swings the lamp to the next seat.
3. Ask for it verbatim, so replies are comparable: *"On iOS, open `/capture` and send one
   landscape screenshot of each state: `lamp-bottom`, `lamp-right`, `lamp-top`, `lamp-left`,
   `pile-right`. Name each file after its state."*
4. **Sample pixels, don't describe them.** #209's worked example: measuring three captures put
   the boundary at 117pt from the lamp on both axes and killed the hypothesis the ticket was
   written around — "looks like it's covering the table" and "is continuous across the cut" were
   the same image.

This is rule 36, not just this paragraph: a green Chromium run closed #602 while the owner still
saw the same broken screen — a reference doc is read as advice, a numbered rule as binding.

## What a green loop does not mean

- **`EXPO_PUBLIC_E2E_FAST=1`** (set by `scripts/e2e-server.mjs`) zeroes every AI delay, so **no
  screenshot is ever taken on a bot's turn** — turn it off to look at turn-handover. Exception:
  `openCaptureState` (`tests/e2e/helpers/offlineSeed.ts`) writes the suspend flag
  (`lib/e2eAiSuspend.ts`) so a seeded capture-state spec holds its turn regardless.
- **Metro caches the transform that inlines `process.env.EXPO_PUBLIC_*`.** Flipping the env var
  and rebuilding gives you the *previous* value — `expo export --clear` actually rebuilds it. See
  *Metro's cache is machine-wide* below.
- **`EXPO_PUBLIC_E2E_REDUCE_MOTION=1`** (set only by `maestro.yml`'s build step) makes
  `usePrefersReducedMotion` always return `true`, so the table's looping decorative animation
  never plays under that build (#837). It answers "does the emulator reach idle", not "what does
  the animation look like."
- **One frame is not a state.** Play real hands (`tests/e2e/helpers/bot.ts`) and sample *through*
  a turn handover, not after one.
- **A spec outside `tests/e2e/` is collected as zero tests, silently** — `testDir` only sees that
  directory, and the filter path is relative to it. The webServer still boots and Metro still
  rebuilds before Playwright reports "0 tests" (#211).
- **`playwright.config.ts` owns its own `webServer`** on `E2E_PORT` — starting one by hand races
  it for the port.
- **A piped Playwright run reports the pipe's exit code**, not the suite's. Read the `N passed /
  N failed` line, never grep's `$?`.
- **Compare pixels, not impressions.** "Looks darker" cost hours; sampling the same relative
  points out of both PNGs found a halved vignette radius (104 vs 132) in one run.
- **A scan that has only ever been green has not been tested, it's been assumed** — rule 6; see
  *A scan needs a planted floor* below.
- **A native `fireEvent` without `await` asserts against the pre-press state** — see *The native
  harness is async* below.
- **A Maestro step name is not evidence of what was on screen when it ran.** If the app dies
  mid-flow the next assertion still passes against whatever hierarchy Maestro had already read.
  `maestro.yml` annotates a run whose logcat holds a tombstone for the app's own package (#629),
  Android only. The screenshot beside the failing step is the evidence; the step name is a guess.
- **Where an Android run's minutes went is a join, not a read**:
  `node tools/ci/analyze-maestro-run.mjs <maestro.log> <logcat.txt>` (its header has the `gh run
  download` invocation) puts each command's window beside the hierarchy fetches and janky
  frames — separating a command starved by animation from one paying a flat per-fetch cost
  (#823). Reads the `maestro-debug`/`maestro-debug-ios` artefact, uploaded only on failure or a
  crash tombstone unless dispatched with `force-upload-debug: true`. `maestro-debug-ios` carries
  no logcat, so only `parseCommandWindows` (not this script) reads it.
- **A stale `node_modules` reads as a real defect.** node_modules is shared live across every
  worktree (#938); an install can leave `react-native`/`react-native-worklets` looser than
  `package-lock.json` pins, silently (#926, #928, phantom `TS2698`). `tools/loop/preflight.mjs`
  and `tools/loop/agent-check.mjs` both call `checkLockDrift` — the latter uncached, on every
  invocation, because its PASS cache is keyed on tracked git content and can't see a peer's
  `npm install` landing mid-session. Both point at `npm ci` rather than running it themselves.
- **A flow run through Expo Go never pressed one of our controls.** Its dev-menu window sits
  above the app's and eats the touch (`COMPLETED` regardless); a `back` **key** works because
  keys skip window hit-testing (#627). Both device jobs now compile the app and drive that
  instead, so a green from either is a real claim — any Maestro green recorded before 2026-08-31
  is not.

## A scan needs a planted floor

Rule 6: a scan must fail on a planted defect. A scan that never found anything and a scan that
can't see anything produce the identical empty list — the convention here is a `// The floor…`
comment (about seventy files carry it, e.g. `tests/ui-rules/vignette.test.ts`,
`tests/native/feltEllipse.test.tsx`, `tests/tooling/bundleRoutes.test.ts`; grepping the literal
phrase undercounts it — `tests/ui-rules/a11yProps.test.ts` and `tests/tooling/e2eSentinels.test.ts`
do it under names of their own).

**Which direction a scan fails decides whether you find out.** Three scans lied here in one
week:

| The scan | What it did | What happened |
| --- | --- | --- |
| substring grep | reported a dead locale key as live (`common.no` matched inside `common.notice`) | **false negative** — #512 was written over a confirm dialog that does not exist |
| literal tokeniser | an apostrophe in a comment opened a literal that swallowed every key after it | **false positive** storm — 128 orphans, caught in a minute |
| pixel measure (#341) | passed 4:1 before any change, because one thread was already multiplicative | would have shipped a **green for a live defect** |

Choose loud when you can choose. Matching the exact token shape (`/(["'`])([\w.]+)\1/g`) rather
than tracking state across the file avoids the first two failure classes but trades for a
quieter one — a key named only in a comment reads as live, which is why
`tests/tooling/e2eSentinels.test.ts` blanks comments first.

**This is a rule, not a check**, because two of the three failures above were never committed
checks at all (an ad-hoc grep in an issue body, a draft measure on a branch) — no repo-level gate
could have seen either. The enforcement point is your own loop, before the scan exists to be
gated. Where a scan *is* committed and needs a reasoned exception, `tests/ui-rules/touchTargets.test.ts`
and `tests/ui-rules/i18n.test.ts` (`CONSTRUCTED`) show the allow-list-with-a-reason shape to
copy.

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

**A bare `fireEvent` is also the dangerous one for a different reason: it leaves its own `act`
scope open.** The next `act` entered without yielding first nests inside it, React logs
"overlapping act() calls", and the act environment stays corrupted **for the rest of the file** —
every later `render()` returns a tree that finds nothing, which reads as "this screen can't mount
twice" rather than the missing `await` that caused it. `await waitFor(...)` is safe because it
yields before entering its own scope; **`unmount`/`rerender` are `act` calls too**, so `await
view.unmount()` closes the trap. `tests/tooling/nativeActPairing.test.ts` refuses the pairing —
every call site it currently reaches is sound.

**Don't reach into `.props` to drive a control instead** — `getByTestId` returns the host node;
on a `Pressable` that's the `View`, and `props.onPress` is `undefined`.

## A reanimated value can't be read back from `props.style`

A `useAnimatedStyle` entry is frozen at the render that mounted it, so flattening `props.style`
in a test reads the mount-time value, never the live one. Read it live with reanimated's own
`getAnimatedStyle(node)` (`tests/native/bannerMakesRoom.test.tsx`), off the `jestAnimatedStyle`
the animated component hangs on the host — not by mirroring the value into React state, which
costs a render of the whole subtree per frame (what #589 shipped and removing it recovered).
`tests/native/feltTranslate.test.tsx` works around the frozen-array case by asserting the
animated entry's *position* rather than its contents.

What's still true below it in the tree: no child, and no JS-side code, can read an animated
entry — a number another component needs is a plain number. And `LinearTransition` is not a free
escape: on web it's a FLIP (`transform: translate() scale()` on the element), so it scales
everything inside a container; on native it animates real Yoga values. On a `flexGrow: 1` child
of a `flexGrow: 1` parent a padding change produces no size delta at all, so the transition fires
exactly where it distorts and is inert exactly where it would be harmless.

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

## Starvation looks exactly like a red suite

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
`pretest`; it's off under `CI` (a runner is sized for one job and starts near its floor by
design). It polls up to 60s before refusing (two sessions share this machine and neither knows
when the other finishes) — `MURLAN_PREFLIGHT_WAIT_MS=0` (env, not a flag, since jest/Playwright
call this as `globalSetup`) skips the wait; `node tools/ci/preflightMemory.mjs --no-wait` is the
same for a direct run. Two sessions can still both pass the same poll — a third concurrent one is
what would need a lock, not built because it hasn't happened.

`npm run reap` (`--dry-run` to only list) clears what a killed run leaves. Decided **by command
line, never process name** — `chrome.exe` is as likely the developer's own browser:

| What | Taken |
| --- | --- |
| A stale holder of `E2E_PORT` (launcher exited) | by default |
| Anything of ours, >2h old, parent gone | by default |
| **Any** process >2h old, parent gone, burning ≥20% of a core | by default |
| Anything of ours >24h old | only with `--stale` |

A sweep never takes a port with a live launcher attached — a run now *picks* a free port
(`tools/ci/e2ePort.mjs`) rather than freeing one, because a webServer pulled out from under
Playwright manufactures a connection-error or 0ms failure that reads exactly like a defect (and a
truncated run can manufacture a **green** the same way — check the spec count, not the colour).

The burning-orphan class is the one exception not decided by ownership: it caught a `tr | fold |
awk` pipeline reading `/dev/urandom`, orphaned by a killed Git Bash session (Windows has no
`SIGHUP`), holding a full core for 62 hours while every ownership-based check said "nothing of
ours." The four-way conjunction (parentless, >2h, measurably burning by two-snapshot delta, not
under `%SystemRoot%`/pid ≤ 4/unreadable command line) is what makes it safe — nothing legitimate
is all four. Both classes spare the caller's own ancestry and anything holding a listening port.

## The loop is a second product, with its own gate

`tools/loop/` — supervisor, gate, picker, workspace tools — has its own suite
(`tools/loop/tests/`, run with `npm run loop:test`) that shares nothing with the game's `npm
test` but the repository. `ci.yml`'s `scope` job sets `app`/`harness` outputs: a diff confined to
`tools/loop/` (plus a short list of shared scripts) sets `harness=true, app=false`; anything else
sets `app=true`; the protocol files (`docs/agents/`, `.claude/commands/`, `CLAUDE.md`) set
**both**, because `tests/tooling/rulesAreSingleSourced.test.ts` (game side) and
`tools/loop/tests/loopDocsAreExecutable.test.ts` (loop side) both read them. The harness job also
runs `npm run typecheck` and `npx eslint tools/loop`, since the game's jobs that would otherwise
do that are skipped on a loop-only change.

**Run `npm run loop:test` from the repo root, never `npm --prefix tools/loop`** — its tests read
the repository itself (`ci.yml`, the protocol files, worktree registrations), so npm's cwd
sends every one of them looking in the wrong place, usually failing with "missing file" rather
than a wrong answer. `tools/loop/package.json` carries no scripts on purpose — it exists only for
`"type": "module"`, which stops Node reparsing `land.ts`/`ciVerdict.ts` on every supervisor start.

**Move by subject, not filename.** `tests/ui-rules/contextSlices.test.ts` reads like harness
tooling but asserts the game's React contexts stay a partition, so it and the script it drives
(`scripts/contextSurface.mjs`) stay on the game's side. `tests/tooling/rootScanRace.test.ts`
scans every test file in the repo, game included, so it stays there too — and
`scripts/lib/entry.mjs` is shared by several game scripts as well as the loop, which is why it
didn't move either.

**`check:comments` (`npm run check:comments`) is its own step of CI's Lint job**, not part of
`npm run lint` or the harness suite — it's first heard from on CI unless you run it yourself. It
diffs against the merge base via `git diff`, so an uncommitted edit counts but an untracked file
doesn't show at all.

**A `tsc` error about a route that plainly exists is a stale `.expo/types/router.d.ts`** —
generated by the dev server, gitignored, never regenerated by `tsc` itself. CI has no `.expo` at
all and is green; delete the file locally rather than chasing it as a branch defect.

**`npm test` skips the integration suite silently** — every `tests/integration/` file no-ops when
`DATABASE_URL` is unset, so a green sweep says nothing about any of them; CI sets one and runs
them all. Point them at the dev-stack instead of finding out from CI:

```sh
node scripts/dev-stack.mjs up
DATABASE_URL=$(node scripts/dev-stack.mjs env | sed -n 's/^DATABASE_URL=//p')
[ -n "$DATABASE_URL" ] || { echo "dev-stack is not up"; exit 1; }   # empty = every test silently skips
DATABASE_URL="$DATABASE_URL" node --no-warnings --experimental-strip-types --test tests/integration/<file>.test.ts
node scripts/dev-stack.mjs down
```

Each server takes its own schema and drops it, so runs don't collide and the container can stay
up between runs of one sitting — but nothing stops it on its own (no teardown, no session exit),
and it has cost ~2.3k CPU-seconds sitting idle in one afternoon. `down` doesn't quit Docker
Desktop itself (~1 GB); a stack left warm buys nothing since the next `up` costs seconds.

**No unit test can see a layout bug** — `react-test-renderer` never runs flexbox. A green `npx
jest` on a fan rendered off-screen is the normal outcome, not a surprise.

## Editing

Use `Edit`, never a batched Python/sed rewrite of a `.tsx`: one bad match aborts the script
mid-run, discards every prior edit silently, and the exit code doesn't say which hunk landed.
`Edit` fails one hunk at a time, loudly.

## Worktrees

`npm run worktrees:prune` (`-- --dry-run` to only classify) cleans up a worktree left by a
killed/crashed/context-cleared session — run it after any session that ends without landing, or
periodically. To remove one you named yourself, `npm run worktrees:remove -- <path>` (rule 39)
from the main checkout; it refuses a path that isn't a linked worktree, one you're standing in,
or one with uncommitted work (`--force` waives only the last).

**git unregisters a worktree before deleting the directory**, so a delete that fails (usually a
live process still holding it — a shell parked there, rule 40) leaves it gone from `git worktree
list` and an empty directory behind; `worktrees:remove` re-reads the list and reports success,
correctly (#616) — the half that can't be undone already happened.

**`git worktree remove --force` deletes straight through a `node_modules` junction into the
shared install and exits 0, silently.** `tools/loop/guard-bash.mjs` blocks the raw `--force` and
points at `worktrees:remove`, which detaches the junction first;
`tools/loop/tests/worktreeRemoveCommand.test.ts` plants the defect and is **Windows-only by
necessity** — on CI (Linux) a junction is an ordinary symlink nothing recurses into, so the same
file asserts vacuity there instead of skipping. A regression here is caught only by running the
suite on this machine, the reverse of the usual "only the browser suite sees it" shape.

**Never hand-create the junction** — a worktree under `.worktrees/` is nested inside the
checkout, so Node's resolver finds the parent's `node_modules` on its own. A junction is also
actively harmful: `node --test` fails every file with `Cannot find package 'typescript'` through
one (ESM resolution specifically breaks), while `tsc`/`eslint` keep working — reads exactly like
a broken branch.

### Metro's cache is machine-wide, and the key is short of two inputs

Metro keeps one transform cache for the whole machine (`%TEMP%/metro-cache`). Two things a
transform's output actually depends on aren't in its key by default: **which checkout** (a
worktree's `node_modules` junction makes `expo-router/_ctx.web.js` one physical file that
`babel-preset-expo` inlines an app-root path into — two `.worktrees/w*` at equal depth collide;
the main checkout is safe by accident) and **the `EXPO_PUBLIC_*` values** (`inline-env-vars.js`
bakes them in as literals). `metro.config.js` adds both (`__dirname` and every `EXPO_PUBLIC_*`
value) to `cacheVersion`.

Both fail silently: the first bundles a route context pointing outside the worktree, so `dist/`
carries no routes at all and nothing errors until the browser 404s (every Playwright spec timing
out in `openApp`, #438); the second serves one build's inlined constants to another — a plain
`npx expo export` can poison the next e2e export, and an e2e export can poison the next
production build into a zero-delay one. `scripts/bundleRoutes.mjs` (called by
`scripts/e2e-server.mjs` on every run) re-checks the exported bundle against `app/` so an empty
route table is named once. CI's build job checks `lib/e2eBuildMark.ts`'s string in the built
output itself (`scripts/e2eBuildMark.mjs`) rather than trusting env at build time.

**A new worktree's first export is a cold build (~3 min)**, and so is the first export after any
`EXPO_PUBLIC_*` value changes — CI and Replit each pay it once, on a stable path; sharing the
cache was fast and wrong, not a saving.

## Playwright, locally

```sh
npx playwright test --config tests/e2e/playwright.config.ts <spec>          # any source change
E2E_SKIP_BUILD=1 npx playwright test --config tests/e2e/playwright.config.ts <spec>   # spec-only iteration
```

Two runs at once are safe — each takes its own port (#491); a run that has to move off `5199`
says so on its first line (`e2e: port 5199 is taken, serving on 5200`). `E2E_SKIP_BUILD=1` reuses
the last bundle, so a source edit under it measures the old code and passes.

Reach a table without playing to one: `openSeededGame(page, baseURL, 4)`
(`tests/e2e/helpers/offlineSeed.ts`) — four bot seats is the worst case for height. Safe-area
insets on web come from a hidden probe `div`; override with `div[style*="safe-area-inset-left"]
{ padding-left: Npx !important }`. Scratch specs go in the scratchpad dir, never `tests/e2e/` —
point Playwright at them with an explicit `--config` and path.

## Visual parity against a prototype

Read the prototype **once, first** — `WebFetch` the `claude.ai/code/artifact/<uuid>` URL (`curl`
gets an SPA shell or a 403), save it, and extract numbers from that file rather than a summary of
it.

1. Screenshot the saved prototype at the target handset — index 5 is 844×390, notch, inset-x 47,
   inset-b 21, the same viewport the e2e specs use.
2. Screenshot ours at the same viewport with `openSeededGame`.
3. **Sample both PNGs on the same grid** rather than describing them — load each into a canvas in
   a throwaway spec and print pixels at relative points down each third. A halved gradient radius
   reads as "hmm, darker" by eye and `104 vs 132` in one line of output.
4. Do it at **every lamp position**, not just the viewer's turn:
   `document.querySelector('#turn button[data-turn="top|left|right|me"]').click()`.

Prototype numbers most often re-derived wrong: felt stops are `FeltGradients.verde` verbatim; the
falloff ellipse is `76% 100%` at the lamp, the vignette `128% 104%` at the felt's centre; the hand
sits `26/90` of a card below the safe line on an arc of `radius 2200, step .68w, rise 15`;
`Gioca`/`Passa` are `max(48, 56*s)` square at `radius 14*s`, brass on your turn and
`rgba(239,234,219,.3)` on `rgba(0,0,0,.3)` otherwise; the opponent's back is `linear-gradient(155deg,
#1E6544, #0A3120)`.

## Owner decisions

Kept as policy even though the underlying number is imprecise or the shape looks unusual —
verified as *intended*, not stale:

- `maestro.yml`'s device loop has no green-run baseline to measure a "warm" cost from; the table
  above reports the only real data (every recent dispatch failing within 18–30 min) rather than
  inventing a steady-state figure.
- The iOS/Android device jobs are dispatch-only, never gating a PR, by the owner's decision — not
  an oversight to "fix" by giving them a schedule or wiring them into `ci.yml`.
- `MURLAN_PREFLIGHT_WAIT_MS` defaults to waiting rather than failing fast, on purpose, to survive
  a peer's teardown burst; `--no-wait`/`=0` is the opt-out, not the default.
