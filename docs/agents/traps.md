# Traps

What passes every check and still ships broken, or reads as a defect when it is not. Read the
section `docs/agents/checks.md`'s index sends you to, when its trigger applies; rules live in
`docs/agents/RULES.md`.

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
one that doesn't needs a device capture (`docs/agents/device-runs.md`).

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

- **`EXPO_PUBLIC_E2E_FAST=1`** (set by `scripts/e2e-server.mjs`) zeroes every bot delay, so **no
  screenshot is ever taken on a bot's turn** — turn it off to look at turn-handover. Exception:
  `openCaptureState` (`tests/e2e/helpers/offlineSeed.ts`) writes the suspend flag
  (`lib/e2eConfig.ts`) so a seeded capture-state spec holds its turn regardless. The same build
  holds the offline exchange open on a timer, and the `consoleErrors` fixture reduces motion. A
  few specs turn motion back on; only `tests/e2e/helpers/motionPath.ts` also drops the hold
  (`lib/e2eConfig.ts`), so only its specs (`motionMatch`, `motionThirdDeal`) deal and
  exchange round after round the way a player's build does. Play real
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
  tests" (#211). `playwright.config.ts` owns its own `webServer`, so starting one by
  hand runs a second server beside it. A piped run exits with the pipe's code: `tools/loop/guard-bash.mjs`
  refuses one.
- **A local Playwright run stops two minutes under the session's Bash ceiling and still reports**
  (`globalTimeout`); narrow with one spec or `-g` rather than raising it. Outside a loop session
  (`LOOP_TURNS` unset) an explicit `E2E_GLOBAL_TIMEOUT_MS` above that ceiling is honoured.
- **`dev-stack up` starts Docker Desktop and waits for it** (`scripts/dockerEngine.mjs` holds the budget) when the engine is down; never
  improvise a start. A `docker info` that times out is a starved engine, not a down one: it is
  waited for with a longer probe and never launched again.
- **A scan that has only ever been green has not been tested, it's been assumed** — rule 6; see
  *A scan needs a planted floor*, below. **A native `fireEvent` without `await` asserts against
  the pre-press state** — see *The native harness is async*, below.
- **A stale `node_modules` reads as a real defect.** It is shared live across every worktree
  (#938); an install can leave `react-native`/`react-native-worklets` looser than
  `package-lock.json` pins, silently (phantom `TS2698`). The loop's housekeeping
  (`tools/loop/workspace.mjs`) and `tools/loop/agent-check.mjs` both call `checkLockDrift`, and
  both point at `npm ci`.

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

## Where a forbidden-shape rule goes

A rule that says "this shape of code must not appear here" — a call, an import, a JSX element, a
literal — is a guard in `eslint.guards.cjs`, never a regex scan in a test and never a loose block in
`eslint.config.js`. A guard is an esquery `selector` over the AST with a `why` naming its owner,
its `files`, its exemptions as `{ glob, reason }` in `ignores`, a `plant` it must report exactly
`hits` times and the `spare`s it must not; `guardBlocks()` is the only thing that switches guards
on, and the plant is the guard's floor. `tests/tooling/lintGuards.test.ts` holds six points under
all of them: each plant fires exactly its hits under the real config and no spare fires; every glob
reads a tracked file and the real config runs the guard there; every exemption reads a tracked file,
gives a reason and still covers a file the guard would report; no config block sets a guard below `error`; no source switches a guard off
inline or carries a bare `eslint-disable` (D17); and the ids are unique, each guard is only a
selector entry, and its `why` names a path that exists. A stale directive is an error. An exception is the guard's to change, in
review, never a comment's at the site. A rule about prose, JSON, or a relation between two files is
not a shape and stays a test.

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
flag) or `node tools/ci/preflightMemory.mjs --no-wait` skips the wait. **By the owner's decision,
verified intended:** waiting is the default, to survive a peer's teardown burst; the opt-out is
not to become the default.

`npm run reap` (`--dry-run` to only list) clears what a killed run leaves, decided **by command
line, never process name** — `chrome.exe` is as likely the developer's own browser. Taken by
default: a stale holder of the legacy e2e span (5199-5218) and anything of ours >2h old with its parent gone; a process
that is not ours is never taken, however busy. Only `--stale` takes anything of ours merely >24h
old. A sweep never
takes a port with a live launcher attached, because a webServer pulled from under Playwright
manufactures a connection error or 0ms failure that reads like a defect (a truncated run can manufacture a **green** the same way — check
the spec count, not the colour).

`npm run agent:check` reaps first, and again before each memory preflight: any node process whose
command line names its own worktree, whatever its age, except its own ancestors and a port's
holder (`reapWorktree` in `tools/loop/reap.mjs`).

## Remaining traps

- **`git worktree remove --force` deletes straight through a `node_modules` junction into the
  shared install and exits 0, silently, on Git for Windows before 2.54.0.** From 2.54.0 it
  spares the install but leaves the junction standing in an unregistered directory, for the next
  `rm -r` to follow. `tools/loop/guard-bash.mjs` blocks the raw `--force` and points at
  `worktrees:remove` (rule 39); `tools/loop/tests/worktreeRemoveCommand.test.ts` plants the
  defect and pins the version where it changed, on the Windows CI leg. `npm run worktrees:prune`
  (`-- --dry-run` to only list) cleans up one left by a killed/crashed session the same way, and
  the loop runs it before every ticket. It only ever removes a `.worktrees/agent-<n>` whose issue
  is closed, or no longer `in-progress` with a pull request or a branch merged into
  `origin/main` — never with `--force`, so uncommitted, locked, detached or unmerged work with no
  pull request stays, and the row says why; one registered anywhere else, or named otherwise, is a person's, and
  only `worktrees:remove` takes it.
  Never hand-create the junction either — it is actively harmful: `node --test` fails every file
  with `Cannot find package 'typescript'` through one, while `tsc`/`eslint` keep working, which
  reads exactly like a broken branch.
- **Metro keeps one transform cache for the whole machine**, keyed in `metro.config.js` on the
  checkout and the `EXPO_PUBLIC_*` values: `tests/tooling/metroCacheVersion.test.ts` pins both.
- **A `tsc` error about a route that plainly exists is a stale `.expo/types/router.d.ts`** —
  gitignored, generated by the dev server, never regenerated by `tsc` itself. CI has no `.expo`
  and is green; delete the file locally.
- **The browser suite draws WebGL on SwiftShader, on the CPU**, here and on CI. The web table keeps
  its fallback felt on a software rasteriser (`components/table/feltSkia.web.tsx`), because a
  swaying Skia lamp there took the main thread and timed out the whole suite. A spec of Skia's
  own pixels calls `skiaOnSoftware(page)` first (`tests/e2e/helpers/tableTrace.ts`);
  `tests/e2e/feltIdle.spec.ts` pins both halves, and `tests/e2e/tableAtRest.spec.ts` counts, frame by
  frame on the virtual clock, what a settled Skia table still draws. `tests/e2e/skiaPerf.spec.ts`
  holds the Skia table at 4x CPU to the budgets in `tests/e2e/helpers/skiaPerfBudgets.ts`, both
  targets under rule 52 (`docs/WEB-PERF.md` § The gate). SwiftShader's `GPU stall due to ReadPixels`
  warning is its own, not the app's: `isExpectedNoise` drops exactly that text.
