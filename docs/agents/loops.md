# Working loops

Which loop to run for which change, what each one costs, and what it can and cannot see.
Read this **before** starting a change, not after a loop has already lied to you.

The rules themselves are in `docs/agents/RULES.md`. This file is the *why* behind them.

## Ask which platform the report came from, first

Every loop below except the last runs **Chromium**. The owner tests on **iOS through Expo
Go**. A whole session has been spent fixing a table on web, pixel-matching it to the
prototype, and shipping nothing the reporter could see — because the defect was native-only
and no loop here could reach it.

So before touching a rendering bug, answer in one line: *which renderer produced the
screenshot I am fixing?* Then pick the loop that runs on it. One loop does reach iOS — a
Maestro job on a CI simulator — but it *drives* the app rather than looking at it, so a pixel
still comes back from a capture. The next section is both, and rule 36 is what it costs at the
end.

**What differs between the two renderers is not cosmetic.** `react-native-svg` on native is
a different implementation, not a polyfill:

| Written as | Web (`react-native-svg-web`) | Native (`RadialGradient.tsx` → `extractGradient`) |
| --- | --- | --- |
| `<RadialGradient rx ry>` | ignored — falls back to `r="50%"` | **this is what it reads** (`rx: rx \|\| r`) |
| `<RadialGradient gradientTransform>` | honoured, unit space | user-space matrix — a unit-space `translate(0.5,…)` means nothing |
| `overflow: "clip"` | clips without a scroll box | not a value RN knows |
| `willChange`, `boxShadow` | real | inert |

The portable way to shape a radial is neither: give the **rect** the radii (`2*rx` by
`2*ry`) and let the gradient keep its default `r="50%"`, which is the inscribed ellipse on
both. `tests/vignette.test.ts` pins that no radial shapes itself.

## The iOS loop: a CI simulator, or ask for a capture

`.github/workflows/ios.yml` builds this app and drives both flows on a real iOS Simulator, on
a free `macos-latest` GitHub runner (#205) — the same flows `maestro.yml` runs on Android,
with the emulator-only failure classes (#185, #186) gone because a Simulator is a process on
the host rather than a virtualised device. **It runs on demand only** — `on: workflow_dispatch:`, no `pull_request` trigger. It lost
that trigger for being red, went green on 2026-08-26, and never got it back; #354 owns restoring
it, and cannot until #620 is fixed.

That job proves the flows still run and the app still renders *something* on device — it does
not replace looking at the device. A rendering defect like #209 needs a screenshot regardless:
a named list of states, a screen that reaches each of them on the device, and rule 36.

**The states are `lib/captureStates.ts`.** That list is the contract. `app/capture.tsx` walks it
on the device and `tests/e2e/lampSeats.spec.ts` walks it in Chromium, so a photograph and a web
run are of the same state rather than of two similar ones. Add a state there, not in a spec.

**Reaching one on the device**, in a development build (Expo Go, or any `npx expo start`):
navigate to `/capture`, pick a state, hold the device in landscape. The table is built in
memory and the turn is pinned — `/game` runs the AI turn loop, so a seeded save with the turn
on a bot is a bot's turn for about a second, long enough to navigate to and not to photograph.
The rail's lower knob swings the lamp to the next seat, which is the one state that needs an
input rather than a route.

**What to ask for**, verbatim, so the reply is comparable to the last one:

> On iOS, open `/capture` and send one landscape screenshot of each state in the list:
> `lamp-bottom`, `lamp-right`, `lamp-top`, `lamp-left`, `pile-right`. Name each file after
> the state it is of.

**Reading them.** Sample pixels, do not describe them. #209 is the worked example: measuring
its three captures put the boundary at 117 pt from the lamp on both axes and killed the
hypothesis the ticket had been written around. "The felt looks like it is covering the table"
and "the felt is continuous across the cut, so it is not the occluder" are the same image.

**Why rule 36 is a rule and not this paragraph.** This section said the same thing in plain
words for months, and #602 was still closed on a green Chromium run — the owner reported the
same screen unchanged that afternoon, and it took a seeded reproduction and four captures to
find that two of its three faults were real and the third was a different defect. A reference
doc is read as advice; the numbered list is read as binding, so the claim moved there (#676).

The exception is narrow on purpose. A defect that reproduces in Chromium was never about the
platform, so the Chromium fix is the whole fix and there is nothing a device could add. It is
the defect that *only* the owner can see where a green web run says nothing at all — and that
is the one an agent is most tempted to close, because it is the only evidence it can produce
by itself.

## What a green loop does not mean

Each of these produced a confident, wrong "fixed" in one session:

- **`EXPO_PUBLIC_E2E_FAST=1`** (set by `scripts/e2e-server.mjs` and, unless
  `PARITY_REAL_DELAYS=1`, by `.scratch/parity/static-server.mjs`) sets every AI delay to
  `0`. The bots move instantly, so **no screenshot is ever taken on a bot's turn** — the
  state where the lamp is over someone else and the table is at its darkest. Turn it off to
  look at turn-handover. The one exception is a capture state: `openCaptureState` writes the
  suspend flag (`lib/e2eAiSuspend.ts`), which holds the seeded turn for as long as the page
  lives, and reads as nothing at all in any build that flag did not come from.
- **Metro caches the transform that inlines `process.env.EXPO_PUBLIC_*`.** Flipping that env
  var and rebuilding gives you the *previous* value. `expo export --clear` is what actually
  rebuilds it.
- **One frame is not a state.** Screenshotting a seeded table at the viewer's turn proves
  that one frame. Play real hands (`tests/e2e/helpers/bot.ts` drives one), and sample
  *through* a turn handover, not after it.
- **A Playwright spec is collected only from `tests/e2e/`.** `testDir` is that directory, so a
  spec written anywhere else — a scratchpad, a temp dir — matches nothing, and the filter
  argument is a path relative to it, not an absolute one. Neither mistake fails fast: the
  webServer starts and Metro rebuilds the whole bundle before Playwright reports that it
  collected no tests. #211 paid for that twice.
- **`playwright.config.ts` declares its own `webServer`.** It starts and stops the e2e server
  itself, on `E2E_PORT`. Starting one by hand races it for the port, and the run that then fails
  looks like a broken spec.
- **A piped Playwright run reports the pipe's exit code.** `playwright test … | grep` returns
  grep's status; a red run reads as green. Read the `N passed / N failed` line.
- **Compare pixels, not impressions.** "Looks darker" cost hours; sampling the same relative
  points out of both PNGs found the halved vignette radius in one run.
- **A scan that has only ever been green has not been tested, it has been assumed.** Rule 6
  covers it; the section below is why, and which way to lean when you get to choose.
- **A native test that drives a control without awaiting it** asserts against the state before
  the press. The handler runs, so a mock assertion passes and a rendered-output assertion does
  not — see *The native harness is async* below.
- **A Maestro step name is not evidence of what was on screen when it ran.** If the app dies
  mid-flow the *next* assertion still passes, off the hierarchy Maestro had already read, and
  the failure lands a step later against whatever is up by then — one run spent its remaining
  twenty minutes scrolling the emulator's own launcher and reported a missing home-screen row.
  The screenshot saved beside the failing step is the evidence; the step name is a guess.
  `maestro.yml` now annotates a run whose logcat holds a tombstone for the app's own package
  (#629), but only Android does, and only for a native crash.
- **Where an Android run's minutes went is a join, not a read.**
  `node scripts/analyze-maestro-run.mjs <maestro.log> <logcat.txt>` puts each command's own
  window beside the hierarchy fetches and the app's janky frames inside it, which is what
  separates a command starved by animation from one paying a flat per-fetch cost (#823). The
  header of the script has the `gh run download` invocation. It reads the `maestro-debug`
  artefact, which `maestro.yml` uploads only for a **failed** run — a green one leaves nothing
  to analyse.
- **A flow run through Expo Go never pressed one of our controls.** Expo Go's dev-menu window
  sits above the app's own and takes the touch: the tap is dispatched `to window:
  <EXDevMenuWindow>`, which then resigns key, so it is spent dismissing an invisible window
  and the app never sees it. `tapOn` reports `COMPLETED` either way. Across every run this
  repo recorded up to 2026-08-31, on both platforms, the only taps that ever landed were on
  Expo Go's own native dialogs — a `back` **key** works, because keys reach the app rather
  than going through window hit-testing (#627). So "the Maestro flow passed" was a claim about
  assertions, not about anything being pressable, and it has been load-bearing in at least one
  closed ticket. Both device jobs now compile the app and drive that, so a green from either
  is a claim about this app. Any Maestro green recorded before 2026-08-31 is not.

## Which device loop sees what

Both jobs build a **release** binary and drive it, so neither needs a dev server and neither
can be confused by the host. They are `workflow_dispatch` only — #354 owns the trigger.

| | `ios.yml` | `maestro.yml` |
| --- | --- | --- |
| Builds | `xcodebuild`, active arch only | `./gradlew assembleRelease` |
| Runs | smoke + offline-game | smoke + offline-game |
| Locale | `launchApp` arguments, no boot | `persist.sys.locale` + a real reboot |
| Roughly | 23 min, measured | unmeasured; budgeted for 100 |

Neither can see what the other can. iOS is a simulator on the host, so it has no emulator boot
to flake (#186) and no KVM; Android is a virtual device, so it is the only one that produces a
logcat and a tombstone when the app dies natively (#629). A defect that reproduces on one and
not the other is a real finding about that platform, not a broken job — #209 and #627 were both
that shape.

What neither sees: anything requiring a signed release or the Play/App Store runtime, and any
regression in a code path the two flows do not walk.

## A scan needs a planted floor

Rule 6 says a scan must fail on a planted defect. The reason it is worth its own rule for a
scan, and not just for a fix, is that a scan reads identically whether it is working or not:
the output of a scan with nothing to report and the output of a scan that cannot see anything
are the same empty list.

The convention is already here — about fifty test files carry a `// The floor…` comment.
`tests/vignette.test.ts`, `tests/native/feltEllipse.test.tsx` and `tests/bundleRoutes.test.ts`
each plant the defect verbatim; `tests/a11yProps.test.ts` and `tests/e2eSentinels.test.ts` do
it under names of their own, which is why grepping the phrase undercounts it.

**Which direction it fails in decides whether you find out.** Three scans lied here in one
week, and only the loud one was caught by the person who wrote it:

| The scan | what it did | what happened |
| --- | --- | --- |
| substring grep | reported a dead locale key as live — `common.no` matched inside `common.notice` | a **false negative**: #512 was written on top of it, describing a confirm dialog that does not exist |
| literal tokeniser | an apostrophe in a comment (`player's`) opened a literal that ran to the next one, losing every key after it in the file | a **false positive** storm: 128 orphans, most obviously live, investigated in a minute |
| pixel measure (#341) | passed 4:1 before any change was made, because one of the two threads was already multiplicative | would have shipped a **green for a live defect** |

When you can choose which way a scan fails, choose loud. The middle row is the one to copy:
it was alarming, so it was caught in a minute by the person who wrote it.

**The first two both tracked state across a file and could desynchronise.** Matching the shape
you are after directly — `/(["'`])([\w.]+)\1/g`, the token, not the language around it —
cannot lose its place. It buys that with a quieter failure of its own: a key named in a
comment or in an unrelated string reads as live. `tests/e2eSentinels.test.ts` blanks comments
first for exactly that reason. Know which of the two you are paying for.

**Why this is a rule and not a check.** Two checks were considered. One keyed on the comment
would flag 34 of the 36 files that scan the tree and assert an empty result, and be satisfied
by adding the comment. The allow-list-with-a-reason this repo uses for its other semantic
properties (`tests/touchTargets.test.ts`, `tests/i18n.test.ts`'s `CONSTRUCTED`) does fit, and
is worth building if this recurs — it was not built here because two of the three failures
above were never committed checks at all. One was an ad-hoc grep in an issue body and one was
a draft measure on a branch, so no repo-level gate could have seen either. The enforcement
point is your own loop, before the thing exists to be gated.

## The native harness is async, and a missing `await` reports on the harness

`@testing-library/react-native` is v14 here, where `render` **and every `fireEvent`** return
promises. Miss one and the harness reports its own unfinished state as the app's.

The handler still runs. Only the re-render is deferred, which is what makes this so quiet: after
a bare `fireEvent.press(go)`, the mock the handler calls has been called, and the text the
handler sets is still the old value. So `expect(onExit).toHaveBeenCalled()` passes and
`expect(view.getByTestId('msg').props.children).toBe('pressed')` fails, one line apart, off the
same press. A test asserting the first is right; the same test asserting the second is a defect
that reads as a broken component.

Which forms deliver a re-render, all measured:

| Form | Re-renders |
| --- | --- |
| `fireEvent.press(x)` with nothing after it | **no** |
| `await fireEvent.press(x)` | yes |
| `await act(async () => fireEvent.press(x))` | yes |
| `await act(async () => { fireEvent.press(x) })` — promise dropped | yes |
| `fireEvent.press(x)` then `await waitFor(…)` | yes |
| `fireEvent.press(x)` then an `act` flush | yes, and see below |

Only the first fails to re-render. Awaiting the `fireEvent` is the form to write: it is the one
that does not depend on something else happening to flush afterwards.

**The last row re-renders and is still the dangerous one.** A bare `fireEvent` leaves its own
`act` scope open, and the next `act` **entered without yielding first** nests inside it. React
says so —

```
Warning: You seem to have overlapping act() calls, this is not supported.
```

— and its act environment then stays corrupted **for the rest of the file**. Every later
`render()` returns a tree whose queries find nothing, so a control that is unconditionally
present reads as `Unable to find an element with testID: …`. The test that pays is never the
test that did it, which is why this reads as "a screen that cannot be mounted twice" or "one
interaction per file". It is neither.

Yielding is the whole distinction, and it is why `await waitFor(…)` is safe: it yields before
entering its own scope. Adjacency has nothing to do with it — any run of synchronous statements
between the two still pairs. **And `unmount` and `rerender` are `act` calls under another name**
(`dist/render.js`), so `await view.unmount()` closes the trap just as `await act(…)` does.
`tests/nativeActPairing.test.ts` refuses the pairing; every call site it reaches is sound.

**Do not reach into `.props` to drive a control instead.** `getByTestId` returns the *host*
node. On a `Pressable` that host is the `View` carrying the responder props, and
`props.onPress` is `undefined` — `TypeError: ….props.onPress is not a function`, not a flush
problem. On a `TextInput` the host does carry `onChangeText`, so the same reach appears to
work there, which is how it gets adopted.

## A reanimated value cannot be read back from `props.style`

An entry `useAnimatedStyle` contributes to `style` is **frozen at the render that mounted it**,
so a test that flattens `props.style` reads the value the component started with and never the
live one. `tests/native/feltTranslate.test.tsx` works around it where it has to, by using the
animated entry's *position in the array* rather than its contents.

The consequence when writing a component, not a test: **if a number has to be readable — by a
test, or by anything below it in the tree — it cannot be animated through `style`.** #589 hit
this making a menu screen reserve the room a notification banner occupies. Keep the value a
plain number and animate around it.

Reaching for a layout transition instead is not the escape it looks like. On web,
`LinearTransition` is a FLIP: `react-native-reanimated/src/layoutReanimation/web/transition/Linear.web.ts`
applies `transform: translate(...) scale(sx, sy)` to the element for the duration, so putting
one on a container scales everything inside it, while native animates the real Yoga values and
does not. And on a container that is already `flexGrow: 1` inside a `flexGrow: 1` parent, a
padding change produces no size delta at all, so the transition is inert exactly where it would
have been harmless and fires only where it distorts. Check both halves before using one.

## `import.meta.dirname` is `undefined` under `npx tsx --test`

The `node --test` files that use it fail under `tsx` with `The "paths[0]" argument must be of
type string` — which reads as a bug in whatever you just touched. Rule 4's `node --test` runs them. Reaching for `tsx` because
the file is TypeScript is the trap; two sessions hit it on the same day, on different files.

## Starvation looks exactly like a red suite

Two sessions running a full suite each drove a 15.6 GB machine to 242 MB free, and processes
began failing to launch with `0xC0000142`. Neither suite said anything about memory. What they
said was:

| Symptom | Reads as | Actually |
| --- | --- | --- |
| `npx jest` — 2 suites failed | a regression | `npx jest -w 3` on the same commit: 723 passed |
| 37 specs failing at 0ms, `ERR_CONNECTION_REFUSED` | the server never started | nothing had memory to start |
| specs failing inside `openApp` | the #438 flake | a different cause with the same shape |

**A rerun with fewer workers that disagrees with the first run is the tell.** A real regression
does not care how many workers you gave it. Before believing a red, check free memory and rerun
with `-w 3`.

All three suites now refuse up front rather than failing this way — `scripts/preflightMemory.mjs`
is the `globalSetup` of jest and Playwright alike, and `npm test`'s `pretest`, and it names
exhaustion. It is off under `CI`, where a runner is sized for one job and starts near its floor by
design.

The node suite's shape is its own: whole test *files* failing at once rather than assertions inside
them, and `importing … exited 3221225794` — `0xC0000142`, Windows for "no memory to start a
process". Twenty of them, once, on a branch that had touched none of the files named.

**It waits before it refuses.** Two sessions share this machine, and the second has no way to know
when the first will finish — so it polls its own verdict for up to 60s, says so once when it starts
waiting, and only then refuses with the message above. The refusal carries the best reading as well
as the last: a box that climbed towards the floor and fell back is worth waiting out again, and one
that never moved is worth going to look at with `npm run reap`.

To be refused now rather than waited for, set `MURLAN_PREFLIGHT_WAIT_MS=0`. The environment rather
than a flag, because jest and Playwright call this as their `globalSetup` with their own config
object and nothing on the command line reaches either. `0` still takes one settle — that reading
exists to survive another suite's teardown burst, not to wait for it. `node
scripts/preflightMemory.mjs --no-wait` is the same thing for the script run directly.

Two sessions can cross the floor in the same poll and both start, because polling does not
serialise. With two that is survivable — the loser meets the preflight again on its own next check.
A third concurrent session is what would break it, and a lock is the answer then, not now.

`npm run reap` clears what a killed run leaves behind. `--dry-run` lists without killing anything.
A run does not need it first: `scripts/e2ePort.mjs` picks a port that is already free, and clears
a holder only when that holder's launcher has exited.

| What | Taken |
| --- | --- |
| A **stale** holder of `E2E_PORT` — one whose launcher has exited | by default |
| **Any** holder of `E2E_PORT`, live run or not | only with `--port` |
| Anything of ours over 2h old whose parent is gone | by default |
| **Any** process over 2h old whose parent is gone and which is burning ≥20% of a core | by default |
| Anything of ours over 24h old | only with `--stale` |
| `murlan-verify-pg` / `murlan-verify-boot` containers | by default |
| The shared `murlan-dev-pg` container | only with `--docker` |

**"Ours" is decided by command line, never by process name.** A process is this repo's if its
command line names the checkout — which covers every worktree, jest worker and bundler — or names
Playwright's browser directory, which sits in the user's profile rather than under the checkout.
Name matching would be indefensible: `chrome.exe` is as likely to be the developer's own browser,
and this machine also runs an unrelated agent's `python.exe` and Windows' own `msedgewebview2.exe`.
A command line that could not be read claims nothing.

**A sweep never takes a port somebody is using; `--port` always does.** A bare `npm run reap` has
nothing waiting on the port, so a holder still attached to a live launcher is somebody's run and
stays — parentage is the signal, and a holder the process table cannot describe is left alone.
`--port` is the blunt form, kept for cleaning up after a run that is already over
(`lib/ticketPipeline/cleanup.ts`); no run takes that path on its way in any more.

Starting a run used to, and that is what made two sessions collide: Playwright refuses a busy port
*before* it runs the `webServer` command, so freeing it was the only way to boot — and the run
that started second freed the first one's server out from under it. A run now picks a port that
is free instead (`scripts/e2ePort.mjs`), which is a smaller thing to get right than a lease.

The reason this matters more than one lost run: a webServer pulled out from under Playwright
surfaces as a connection error or a 0ms failure, which reads exactly like a defect. A sweep that
takes a live port *manufactures a test result* in another process, and anything trusting a
suite's verdict — a review agent, `scripts/ticket-pipeline.ts` — then acts on it. Same shape as
the starvation table below, one layer up.

And it can manufacture a **green** as easily as a red: land part-way through a suite and the
specs that already finished still report passed, while the ones that never ran are simply absent
from the count. A truncated green is the one a reader skims past, so anything consuming a suite
verdict should check the **spec count**, not the colour.

**The burning class is the one exception, and it is not decided by ownership at all.** Ownership
is what makes the other classes safe, and it is exactly why they could not see the worst leftover
this machine has had: a `tr | fold | awk` pipeline reading `/dev/urandom`, orphaned by a killed
Git Bash session — Windows has no `SIGHUP` to send and the input never ends — holding a full core
for 62 hours while `reap` reported "nothing of ours". What makes this class safe instead is the
conjunction: parentless **and** over 2h old **and** measurably burning **and** not the operating
system's. Nothing legitimate is all four.

Two things it does not do. It never rules on cumulative CPU, which says only what a process has
ever burned — it takes two snapshots a second apart and rules on the delta, so a process that
burned a core for hours and then went idle reads as idle. And no system process can be a
candidate: anything under `%SystemRoot%`, anything at pid 4 or below, and anything whose command
line could not be read, which on Windows is the signature of a protected process. Pid 0, the
System Idle Process, samples at over 2000% of a core because its time is summed across every one
of them, and it is the loudest thing the scan sees.

The 24h class needs asking for. A crashed session leaves its **whole tree** resident — the node
process, the bash that launched it, the cmd above that — so its parent is alive and the parent test
cannot see it. Age is the only signal left, and a live session's process is also long-running.

Both classes spare the caller's own ancestry, and **anything holding a listening port**: a
detached dev server has a dead launcher and is hours old, so both classes would otherwise read a
process that is still serving as a corpse.

## Pick the loop by what you changed

| You changed | Loop | Catches | Cost |
| --- | --- | --- | --- |
| Pure logic (`lib/`, `*Model.ts`, `tableArc.ts`) | `node --test tests/<file>.test.ts` | the maths, the guards | ~1s |
| A component's props or tree | `npx jest tests/native/<file>` | render, memo, hook order | ~8s |
| Anything with a **layout** (flex, absolute, transform) | Playwright | which side of the screen it is on | ~35s |
| Anything **visual** (colour, gradient, shadow, size) | the parity harness below | pixels vs the prototype | ~40s |
| Tokens, contrast, roles | `node --test tests/contrast.test.ts tests/tokenRoles.test.ts tests/cosmetics.test.ts` | AA floors | ~1s |
| The server, the socket protocol, auth or storage | `tests/integration/` — see below, it needs a database | the routes and handlers end to end | ~10s a file |
| Anything the app must **boot and stay drivable through on iOS** | `.github/workflows/ios.yml`, dispatched by hand | a crash, a screen that never renders, a control the flows tap going missing — on a real simulator | 10–15 min over three runs on 2026-08-31, none of which finished the flow (#620); a full pass is longer, and the 75 min ceiling is sized for offline-game.yaml, which this job does not yet run |

Full sweeps, for the end of an item only: `npx tsc --noEmit` (~5s) → `npm test` (~12s, 1066) →
`npx jest` (~50s, 527) → `npx eslint components lib tests app` (~25s).
`docs/agents/issue-tracker.md` covers when CI runs instead.

**A `tsc` error about a route that plainly exists is a stale `.expo/types/router.d.ts`.** Typed
routes are generated there by the dev server, the file is gitignored, and it is never regenerated
by `tsc` — so a checkout where the dev server last ran before a route was added reports that
route as unassignable to `Href`, forever. CI has no `.expo` at all and is green, and so is a
fresh worktree, which is what makes it look like a branch defect rather than local state. Delete
the file; absence is correct, and nothing an agent runs needs it.

**`npm test` does not run the integration suite** — every file under `tests/integration/` skips
itself when `DATABASE_URL` is unset, so a green sweep says nothing about any of them. CI sets one
and runs them all, which is why a branch can be green locally and red there. Point them at the
dev-stack instead of finding out from CI:

```
node scripts/dev-stack.mjs up      # the same disposable Postgres the E2E suite uses
DATABASE_URL=$(node scripts/dev-stack.mjs env | sed -n 's/^DATABASE_URL=//p')
# Never skip the guard: an empty DATABASE_URL does not fail these tests, it
# makes every one of them skip itself and the run reads as green.
[ -n "$DATABASE_URL" ] || { echo "dev-stack is not up"; exit 1; }
DATABASE_URL="$DATABASE_URL" \
  node --no-warnings --experimental-strip-types --test tests/integration/<file>.test.ts
node scripts/dev-stack.mjs down
```

Each server takes its own schema and drops it, so runs cannot collide and the database can stay
up between the runs of one sitting.

It does not stay up past them. Nothing stops it on its own — no test teardown and no session
exit — and Docker here serves the agent sessions and nobody else, so a container nobody is
waiting on is a container nobody will notice. `murlan-dev-pg` and Docker Desktop together held
~2.3k CPU-seconds across an afternoon of tickets that had each long since finished.

`node scripts/dev-stack.mjs down` takes the container, and `npm run reap -- --docker` takes it
too if you have lost track of which sitting started it. Neither quits the engine: Docker Desktop
is a separate ~1 GB, and on a machine two sessions are already sharing, that is the difference
between a suite running and the jest preflight refusing. A stack left warm for the next ticket
buys nothing: the next `up` costs seconds.

**No unit test can see a layout bug.** `react-test-renderer` never runs flexbox. A green
`npx jest` on a fan rendered off-screen is the normal outcome, not a surprise.

## Editing

Use `Edit`. Never a batched Python/sed rewrite of a `.tsx`: one bad match aborts the script
mid-run and silently discards every edit that preceded it, and you cannot tell from the exit
code which of ten hunks landed. `Edit` fails one hunk at a time, loudly.

## Worktrees

A worktree left behind by a killed, crashed or context-cleared session is not cleaned up by
anything else — `npm run worktrees:prune` (`-- --dry-run` to only see the classification)
after any session that ends without landing, or as a periodic sweep, removes what it can
prove is merged or gone and leaves anything uncommitted or still under an open pull request
alone.

To take down one worktree you have named yourself — the ordinary end of a ticket — use
`npm run worktrees:remove -- <path>` (rule 39), from the main checkout. It refuses a path that
is not a linked worktree, one you are standing in, and one holding uncommitted work; `--force`
waives the last, and never the detaching, because that is the half protecting a directory you
did not name.

**git unregisters a worktree before it deletes the directory**, so a delete that fails leaves
the worktree gone from git and an empty directory behind. That is not a failure and is not
reported as one: the removal re-reads `git worktree list`, and if the registration is gone it
says so and exits 0. The usual cause is a live process holding the directory — a shell whose
working directory it is (rule 40) — and the directory clears when that process exits, or on the
next prune. Reporting it as a failure was worth a ticket of its own (#616): exit 1 there tells
the next agent nothing happened, when the half that cannot be undone already did.

Both go through `detachReparsePoints`, and the reason they have to is that on Windows a
recursive delete walks *into* a junction rather than unlinking it. The install is not a copy
per worktree: it is one directory every worktree points at, so a delete that follows the link
is deleting every session's install at once, and it has.

**Do not create the junction in the first place.** A worktree under `.worktrees/` is nested
inside the checkout, so Node's resolver walks up and finds the parent's `node_modules` by
itself — no link needed. The `mklink /J` an agent loop may carry buys nothing and exists only
for a recursive delete to walk into. It is also actively harmful: a junction breaks *ESM*
resolution specifically, so `npx tsc` and `npx eslint` keep working through it while
`node --test` fails every file with `Cannot find package 'typescript'`, which reads exactly
like a broken branch.

**`git worktree remove --force` is the trap, and it is silent.** Measured on 2026-08-31 with a
throwaway junction target: it deletes straight through the link into the target, empties it,
and **exits 0** with nothing in its output to notice. `--force` is what an agent reaches for
the moment the plain remove refuses — which it does whenever a shell is standing in the
directory — so the two failures compose. `scripts/guard-bash.mjs` now blocks the raw
`--force` and points at `npm run worktrees:remove`. Note that this paragraph, the one above
and `tests/worktreeRemoveCommand.test.ts` were all already in place when it happened again:
for a rule this mechanical, a guard that refuses the command is the only thing that holds.

`tests/worktreeRemoveCommand.test.ts` plants that defect — it asserts the raw command *does*
destroy a junctioned install. **That floor is live on Windows only, and CI is Linux**, where a
`junction` is an ordinary symlink nothing recurses into: there the same file passes whether or
not the links are detached at all, and it asserts that vacuity rather than skipping quietly. So
a change that drops the detaching lands green on CI and is caught only by running the suite
here. It is the reverse of the usual shape, where the browser suite sees what a local run
cannot.

### Metro's cache is machine-wide, and the key is short of two inputs

Metro keeps one transform cache for the whole machine (`%TEMP%/metro-cache`).
`getTransformCacheKey` hashes `cacheVersion`, the transformer and `globalPrefix`; the per-file
key adds the file's path *relative to `projectRoot`* and its content hash. Two things a
transform's output genuinely depends on are in none of that:

- **Which checkout it is.** A worktree's `node_modules` is a junction, so
  `expo-router/_ctx.web.js` is one physical file every checkout transforms, and
  `babel-preset-expo` inlines the app root into it as a path *relative to that file*. Two
  worktrees need different output from the same input. (The main checkout is safe from this
  one by accident: its relative path to that file is `node_modules/…` where a worktree's is
  `../../node_modules/…`, so their per-file keys differ. Two `.worktrees/w*` at equal depth
  are what collide.)
- **The `EXPO_PUBLIC_*` values.** `babel-preset-expo`'s `inline-env-vars.js` replaces
  `process.env.EXPO_PUBLIC_X` with a **literal** in a production build, so the value is baked
  into the cached output while being absent from the key.

Both fail silently. The first bundles a route context pointing at a directory Metro is not
watching, so `dist/` carries `_layout`, no routes at all, and nothing fails until the browser
404s — which Playwright reads as every spec waiting out its own timeout in `openApp` (#438).
The second serves one build's inlined constants to another: a plain `npx expo export` poisons
the next e2e export into a bundle whose AI is never suspended, and — the direction that
matters — an e2e export poisons the next production build into a zero-delay one.
`scripts/assertNotE2EFast.js` checks the environment variable, which a cached transform has
already outlived.

`metro.config.js` puts both into `cacheVersion`. It is not the only reachable part of that key
(`transformer.globalPrefix` is hashed too, and `cacheStores` could give each checkout its own
directory) — it is simply the one that carries arbitrary strings.

Three consequences worth knowing:

- **A new worktree's first export is a cold build (~3 min)**, and so is the first export after
  an `EXPO_PUBLIC_*` value changes. CI and Replit each pay it once, on a stable path. Sharing
  was never a saving — it was fast and wrong.
- `scripts/bundleRoutes.mjs` re-checks the exported bundle against `app/`, and
  `scripts/e2e-server.mjs` calls it on every run, so an empty route table is named once rather
  than diagnosed one five-minute timeout at a time. `npx expo export --platform web --clear`
  is the confirmation, never the fix.
- **The browser suite runs from a worktree** — `npx playwright test --config
  tests/e2e/playwright.config.ts <spec>`, exactly as below, with no extra step. It did not
  before #445, and the first run of a fresh worktree pays the cold build above.

#284's asset URLs are a *different* proximate mechanism — Metro's dev server deriving a served
path through the junction — and stay patched by `scripts/build.js`'s `sanitizeAssetPath`. They
do share the upstream condition: the junction puts the real path outside the worktree, and
every consumer that derives something from it inherits the `../..` escape. A worktree with its
own real `node_modules` would remove the class outright; it costs an install per worktree,
which is why it was not taken.

## Local ports

Every port this repo's local tooling binds — including the local-substitute path CLAUDE.md's
"When Actions cannot start" describes when CI can't run:

| Port | For | Owner |
| --- | --- | --- |
| `5000` | The Express server (`PORT`) | `server/index.ts`, `.replit` (`[[ports]]` localPort/externalPort, `[env] PORT`, `waitForPort`), `package.json` (`expo:dev`, `expo:dev:clean`) |
| `8081` | Metro (`npx expo start` / `npm start`) | `scripts/build.js`, `.replit` |
| `5199`+ | Playwright's e2e webServer (`E2E_PORT`) — the base, and the first free port above it when a neighbour holds it | chosen by `scripts/e2ePort.mjs`, used by `tests/e2e/playwright.config.ts` and `scripts/e2e-server.mjs`; a leftover is freed by `scripts/reap.mjs` and by `lib/ticketPipeline/cleanup.ts` |
| `55432`+ | The dev-stack's disposable Postgres (`MURLAN_DEV_PG_PORT`) — the base, and the first port above it the Docker daemon will accept when something already holds it. Ask `dev-stack env` rather than assuming 55432 | `murlan-dev-pg` container — `scripts/dev-stack.mjs`, `scripts/devStackPort.mjs`, `scripts/e2e-server.mjs` |
| `55433` | The verify-only Postgres substituted for CI's database | `murlan-verify-pg` container — freed by `lib/ticketPipeline/cleanup.ts`; also bound manually by CLAUDE.md's "When Actions cannot start" |

## Playwright, locally

```sh
# first run of a session, or after ANY source change — builds the bundle
npx playwright test --config tests/e2e/playwright.config.ts <spec>
# iterating on the spec only, source untouched
E2E_SKIP_BUILD=1 npx playwright test --config tests/e2e/playwright.config.ts <spec>
```

Two runs at once are safe: each takes its own port, so a review agent's Playwright and the
session that spawned it no longer take each other's server (#491). A run that has to move off
`5199` says so on its first line — `e2e: port 5199 is taken, serving on 5200` — and that line is
where to look when a run's server is not where this table says. Setting `E2E_PORT` yourself still
wins over the choosing, which is how a proof pins a port of its own.

`E2E_SKIP_BUILD=1` reuses the last bundle. Set it after a source edit and you measure the old
code and it passes.

Reach a table without playing to one: `openSeededGame(page, baseURL, 4)`
(`tests/e2e/helpers/offlineSeed.ts`). Four seats with bots is the worst case for height.

Real safe-area insets on web come from a hidden probe `div` the safe-area-context polyfill
appends to `<body>`. Override it in a spec with
`div[style*="safe-area-inset-left"] { padding-left: Npx !important }`.

Scratch specs go in the **scratchpad dir**, never `tests/e2e/` — that directory is the
suite's contract. Point Playwright at them with `--config` plus an explicit path.

## Visual parity against a prototype

The prototype is the primary source. Read it **once, first**, and extract the numbers; do not
reconstruct it from a summary of itself.

1. `WebFetch` the `claude.ai/code/artifact/<uuid>` URL — it is fetchable and returns the full
   HTML, saved to a local file whose path the result names. `curl` gets an SPA shell or a 403.
2. Copy that file into the scratchpad and screenshot it at the target handset. The prototype
   sets its own size from a `PHONES` table; index 5 is 844×390 notch, inset-x 47, inset-b 21 —
   the same viewport the e2e specs use.
3. Screenshot ours at the same viewport with `openSeededGame`, and diff. Compare images, not
   prose descriptions of images.
4. **Sample both PNGs on the same grid** rather than describing them. Load each into a canvas
   in a throwaway spec and print the pixel at a handful of relative points down each third of
   the frame. A halved gradient radius reads as "hmm, darker" by eye and as
   `104 vs 132` in one line of output.
5. Do it at **every lamp position**, not just the viewer's turn. The prototype exposes them:
   `document.querySelector('#turn button[data-turn="top|left|right|me"]').click()`.

The prototype's own numbers, for the parts most often re-derived wrongly:
felt stops are `FeltGradients.verde` verbatim; the falloff ellipse is `76% 100%` at the lamp
and the vignette `128% 104%` at the felt's centre; the hand is `26/90` of a card below the
safe line with an arc of `radius 2200, step .68w, rise 15`; `Gioca`/`Passa` are
`max(48, 56*s)` square at `radius 14*s`, brass **whenever the turn is yours** and
`rgba(239,234,219,.3)` on `rgba(0,0,0,.3)` when it is not; the opponent's back is
`linear-gradient(155deg, #1E6544, #0A3120)`.

## React Native Web traps

Each of these compiles, type-checks, passes every native test, and renders nothing on web —
which is the platform this app ships as. The table above under *Ask which platform* lists the
ones that run the other way, breaking native while web stays green.

- **`shadowColor` / `shadowOffset` / `shadowOpacity` / `shadowRadius` are inert.**
  react-native-web wants `boxShadow`. Use `makeShadow(color, x, y, opacity, radius, elevation)`
  from `lib/theme.ts`, which emits the right one per platform. The frozen `Shadow.*` map is the
  same helper pre-applied; reach for `makeShadow` directly when the radius scales with the card.
- **`<RadialGradient rx ry>` is ignored.** SVG has no `rx`/`ry` on `radialGradient`;
  react-native-svg passes them through and the browser falls back to `r="50%"`. An elliptical
  radial needs `r` plus a `gradientTransform`.
- **Text is rasterised before transform**, so a scaled container blurs its own label. Scale the
  `fontSize`, never the box.

Confirm any of these by dumping the rendered DOM from a spec
(`page.evaluate(() => el.outerHTML)`) rather than by reasoning about it.
