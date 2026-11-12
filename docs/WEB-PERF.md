# Measuring the web build's frame performance

Expo's Performance Monitor and the React DevTools Profiler are native-only, so
the platform most players use has no first-party profiler. This is the
substitute: a repeatable recording, a baseline taken before #94's visual work,
and a decision about what to do with the numbers.

The constraint it exists to serve is #95's: Reanimated on web is plain
JavaScript on the main thread — there is no UI thread in a browser — with a
documented ceiling around **100 concurrently animating components** on low-end
hardware. The #94 map adds motion, effects and particles to a table that renders
up to 54 cards.

## Running it

```
npm run perf:web
```

About seven minutes, mostly the full round. It is **not** part of `npm run test:e2e` — the default
suite ignores the file, and this runs from its own config (`tests/e2e/playwright.perf.config.ts`).
`PERF_URL=http://127.0.0.1:<port>` measures a server you started by hand instead of the e2e build:
point it at a production export (`npx expo export --platform web`, no `EXPO_PUBLIC_E2E_FAST`), so
the bots think at the pace a player sees. The numbers below were taken that way.

Every case runs with **motion on** (`reducedMotion: "no-preference"`) at **device pixel ratio 3**
(`test.use` in the spec), in a 874x402 landscape phone viewport. Under reduced motion the lamp does
not sway, the motes sleep and the particle loop idles, so a number taken there measures a table
nobody plays (rule 51). The two `-4x` cases also set CDP's CPU throttle to 4x, Lighthouse's mobile
preset; a desktop at full speed hides what a phone pays.

It prints eight lines:

```
[web-perf] deal {...}
[web-perf] idle {...}
[web-perf] drag {...}
[web-perf] idle-4x {...}
[web-perf] turn-4x {...}
[web-perf] round-4x {...}
[web-perf] online-idle {...}
[web-perf] throttled-load {...}
```

and under `PERF_SKIA=1` two more, `idle-dpr3` and `turn-dpr3` (§ The Skia felt at 3x).

`deal` records for three seconds from the click that starts the game, which is
the burst worth measuring: every card in the hand animates in at once. `idle`
records a settled table as the control — the difference between the two is the
cost of the animation rather than the cost of the page.

`idle-4x` is a settled table on the viewer's own turn, at 4x CPU: nothing runs but ambient motion.
It and `turn-4x` play one seeded game: `dealCards(4, 0, rng(12).source)`, saved `fresh` with no
opening (no 3♠ gate and no start reason, so it is not dealt the way a new round is: the viewer leads
at once), and the viewer leading J♣ J♦, to which the bots answer Q Q, K K and A A, and the turn comes
back to the viewer facing A♠ A♥. The spec
replays those replies through `offlineBotMove` under eleven different random sources before it opens
the page and fails unless all agree, and after the window it compares the table's hand counts with
the engine's. Seeding `Math.random` would not do it: on a production build the particles draw from
it every frame, so a bot's draw would depend on the frame rate being measured. The seed removes
the game's variance and nothing else: three seeded runs of one build read `idle-4x` at 3.4, 12.9 and
13.6fps at load 4.7 to 9.7, so the machine's load still moves the figure, and every line carries
`load` to be read beside it.
`round-4x` records one whole four-player round at 4x, from the click to the result screen — the
deal, every throw, the bots' replies and the pauses between — so its `frames` are in the thousands
and its `transformed` and `domNodes` are sampled on the result screen.

`drag` records a card being dragged the width of the fan: the other burst, and
the only one whose dropped frames land under the finger that caused it. Its
window is sized to the drag and starts *after* the hold, because the hold is a
stationary finger — 800ms of it inside the window is 800ms of idle table
averaged into the drag's own p50, which is how the first version of this
recording reported a figure for a table nobody was touching. For the same
reason the moves are paced one per frame rather than handed to Playwright's
`steps`, which dispatches them back to back in tens of milliseconds. The test
refuses to publish a number unless the hand's order actually changed.

| Field | Means |
|---|---|
| `frames` | presented frames observed. Under ~30 for `deal` means nothing was measured. |
| `fps` | `frames` over the window's length. 60 is the display's rate. |
| `p50`, `p95`, `worst` | milliseconds between presented frames. **16.7 is one frame at 60fps.** |
| `janky` | frames that took longer than two 60fps frames to arrive |
| `longTasks`, `longTaskMs` | main-thread tasks over 50ms, via `PerformanceObserver` |
| `transformed` | elements carrying a non-identity transform when sampled |
| `domNodes` | elements in the document |
| `taskMsPerS`, `scriptMsPerS` | main-thread and script milliseconds a second, CDP's `Performance.getMetrics` `TaskDuration` and `ScriptDuration` |
| `feltFps`, `particlesFps` | `PERF_SKIA` only: frames a second the Skia felt's and the motes' canvas drew in (`tests/e2e/helpers/renderCounters.ts`) |
| `cardStylesPerS` | `PERF_SKIA` only: style writes a second inside cards' own views |
| `felts` | `PERF_SKIA` only: which felt the trace saw draw through the window |
| `feltKs` | `PERF_SKIA` only: the k the Skia felt reported drawing at through the window (`feltK` in `lib/e2eTrace.ts`) |
| `load` | the one-minute load average when the line was printed (rule 51) |

`turn-4x` is the 2.5 s after the viewer's seeded lead on the `idle-4x` table: the throw, its
landing, the lamp's glide to the next seat and the bots behind it.

`PERF_SKIA=1 npm run perf:web` records the Skia felt instead of the fallback. This browser draws
WebGL on SwiftShader, where the table keeps its fallback felt (`drawsOnGpu`,
`components/table/drawsOnGpu.ts`), and only an e2e build lets a spec ask for Skia anyway, so this
mode runs against the e2e build, never `PERF_URL`, and fails a window whose trace saw any felt but
Skia's. It records at device pixel ratio 1: at 3 SwiftShader draws the Skia table at about four
frames a second, under every window's floor, and `drag` holds a floor of its own at 1
(§ The drag floor on SwiftShader). The one case at 3x is § The Skia felt at 3x. SwiftShader draws
on the CPU: its frame times say how two builds compare on this machine,
never what a phone's GPU pays. Only this mode installs the render counters and runs the trace,
which patch every draw call, observe every style write and sample every frame: their cost is in its
figures, and in no other mode's.

`online-idle` is `idle` on a two-seat online table, motion on.
`throttled-load` opens home under Lighthouse's mobile throttling (4x CPU, 150ms RTT, 1.6 Mbps)
and reports `fcp`, `lcp` and `tbt` (the sum of every long task's time past 50ms) in milliseconds.

Server capacity is `npm run soak -- --tables 8 --minutes 1`: moves/sec and broadcast p50/p99.

## The baseline

Production web export of `12aae41c` (main after #1968), Chromium via Playwright, headless, DPR 3, motion on, 874x402
(online: 844x390, 2 seats), 2026-11-03, one run, on a shared machine at load average 8 to 12, so
read the figures to the nearest 5fps. Not a phone: it is a software-rendered desktop browser, 4x slower where marked.

| | CPU | frames | fps | p50 | p95 | worst | janky | longTasks | longTaskMs | transformed | domNodes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **deal** | 1x | 168 | 53.9 | 16.7 | 33.3 | 133.4 | 3 | 1 | 124 | 157 | 958 |
| **idle** | 1x | 103 | 49.8 | 16.7 | 33.4 | 133.3 | 3 | 1 | 129 | 169 | 1055 |
| **drag** | 1x | 87 | 60.0 | 16.7 | 16.8 | 16.8 | 0 | 0 | 0 | 141 | 885 |
| **online-idle** | 1x | 101 | 47.0 | 16.7 | 50.0 | 66.7 | 8 | 1 | 58 | 108 | 902 |
| **idle-4x** | 4x | 213 | 50.9 | 16.7 | 33.4 | 66.6 | 7 | 0 | 0 | 146 | 920 |
| **round-4x** | 4x | 9076 | 27.2 | 33.3 | 83.3 | 350.0 | 3121 | 410 | 28587 | 57 | 428 |

| | fcp | lcp | tbt |
|---|---|---|---|
| **throttled-load** | 8540 | 8616 | 2067 |

Read it as: a settled table holds about 50fps with motion on, even at 4x CPU, but **a whole round
at 4x runs at 27fps, a third of its frames janky, with 410 long tasks totalling 28.6s.** The
settled table is not where a phone hurts; the throws, replies and result are. A drag still holds
60fps at 1x.

The table before this re-recording (`eb0d4825`, 2026-09-17) was desktop, 1280x720, DPR 1 and never
throttled: deal 9 janky, idle 0, drag 0, and its online case ran under reduced motion. Its "a settled
table holds 60fps" was true of that table and of no phone. The research measured the same settled
table at 57.8fps at 1x and 17.3fps at 4x before #1968
(`docs/research/2026-11-03-table-perf/REPORT.md`); the 50.9fps above is after it.

**A drag has headroom to spare.** Every frame arrives on time, so a
change that removes work from the gesture cannot show up here — the saving is
absorbed before it reaches the number. Moving the drop-slot decision onto the UI
thread left all four figures identical, and that is the ceiling talking, not
evidence the work was free.

Two things worth carrying forward:

- **`transformed` is 146 on a settled table**, against #95's ~100
  ceiling. The two are not the same measurement — a *static* transform counts
  here, and #95's number is about components *concurrently animating* — but it
  says the budget is not empty, and it is the cheapest proxy available for how
  many nodes a frame has to touch.
- **`worst` is the number that moves first.** p50 stays at 16.7 long after the
  experience has stopped feeling smooth; a dropped frame shows up in `worst` and
  `janky` while the median is still perfect.

### The Skia felt

`PERF_SKIA=1` against an e2e build where the felt redraws once its light has moved half a design point
(`FELT_STEP`, `components/table/lampRig.ts`), 874x402, DPR 1, motion on, 2026-11-07, the median of three runs at
load average 1.2 to 4.2. SwiftShader draws the felt on the CPU, so read these against each other and
against a run of another build on the same machine, never as a phone's. They are not comparable with
the baseline above: a different build, felt and pixel ratio, and the counters and trace running.

| | CPU | fps | p95 | worst | janky | longTasks | longTaskMs | feltFps | taskMsPerS |
|---|---|---|---|---|---|---|---|---|---|
| **deal** | 1x | 22.8 | 183.4 | 350.1 | 18 | 12 | 1919 | 4.8 | 870.5 |
| **idle** | 1x | 56.0 | 33.3 | 33.4 | 0 | 0 | 0 | 19.4 | 547.6 |
| **drag** | 1x | 8.6 | 216.6 | 216.6 | 12 | 11 | 1667 | 8.1 | 993.4 |
| **idle-4x** | 4x | 34.0 | 50.0 | 333.4 | 29 | 8 | 783 | 17.2 | 812.9 |
| **turn-4x** | 4x | 16.6 | 166.7 | 249.9 | 14 | 14 | 1797 | 6.4 | 889.0 |

The same runs of its parent, where the felt redrew every frame its light moved a hundredth of a
point: idle 43.1fps with the felt drawing 44 frames a second and the main thread busy 995 ms of
every second.

### The Skia felt at 3x

`records the Skia felt past its cap` runs under `PERF_SKIA=1` alone, at device pixel ratio 3 and
874x402, unthrottled, on the seeded table of `idle-4x`. The case reads the k the Skia felt itself
draws at (`dpr · min(sx, sy)` in `components/table/feltCanvas.tsx`, reported to the trace as
`feltK`) and fails unless it passes `FELT_K_CAP` (2.5, `components/table/feltShader.ts`); it
confirms the lead left the hand before the turn window and checks the hand counts after. It prints
`idle-dpr3`, the seeded table at rest, and `turn-dpr3`, the 2.5 s after the seeded lead. **SwiftShader rasterises on the CPU: these figures compare runs of
this case with each other, never with a phone's GPU.** Three runs of `6f60f0fc` plus this case,
2026-11-11, load average 9.3 to 11.7 on four cores:

| | fps | frames | p95 | longTaskMs | feltFps | taskMsPerS |
|---|---|---|---|---|---|---|
| **idle-dpr3** | 1.4 / 1.8 / 1.5 | 15 / 15 / 16 | 1400 / 1033 / 1567 | 10182 / 7914 / 9976 | 2.4 / 2.2 / 1.7 | ~997 |
| **turn-dpr3** | 1.7 / 0.9 / 0.8 | 13 / 11 / 10 | 1933 / 2600 / 2367 | 7252 / 11776 / 12671 | 1.5 / 1.4 / 1.3 | ~1000 |

One later run, with the felt reporting `feltKs: [3]`, at load 2.9 to 4.5: `idle-dpr3` 2.8fps,
`feltFps` 3.4; `turn-dpr3` 36.7fps, `feltFps` 1.4. The table above ran at more than twice that load.
At device pixel ratio 2 the felt reports k 2 and the case fails.

### The drag floor on SwiftShader

`drag` holds a floor per renderer over its window of about 1.44 s: `frames > 20` on the fallback
felt at DPR 3, and `frames > 12` on the Skia felt under `PERF_SKIA=1` at DPR 1. The owner delegated
the choice on 2026-11-12 and a per-renderer floor was chosen (#1988 items 15, 46 and 101). Skia's
floor sits just under the lowest of twelve runs on main (`e9918b418`) in one 4-core container,
2026-11-12, at load average 7.4 to 20.3:

| Renderer | DPR | Runs | `frames` | Load |
|---|---|---|---|---|
| Skia | 1 | 12, 3 failed the old 20 | 31, 34, 25, 39, 26, 24, 14, 26, 25, 18, 15, 23 | 7.4 to 20.3 |
| fallback | 3 | 5, all passed | 79, 78, 64, 76, 76 | 11.6 to 16.9 |

The three under 20 (14, 15 and 18) ran at load 14.3 to 20.3; at load under 13 Skia's lowest was
24. On 2026-11-11, before the hand-shade canvas was deleted (#2076), Skia read 9, 12, 11 and 18
at load 6.5 to 11.2, and the fallback 90, 88 and 68. A Skia drag at 12 frames or fewer is the
regression this floor catches; it moves only with a new calibration recorded here.

### What counts as a regression

The thresholds that block are the gate's (§ The gate). This recorder has none, deliberately.
Compare against the table above by hand, and treat as a regression:

- `fps` on `idle-4x` falling below ~45, or on `round-4x` below ~25
- `janky` on `deal` rising above single figures
- any `janky` at all on `drag`, or its `p95` leaving ~16.7
- `longTasks` on `idle-4x` becoming non-zero, or `longTaskMs` on `round-4x` rising

A change to the table is measured the way rule 51 says: this check, before and after, in the same
session, alternating, with the load average beside the figures.

Re-record and update this table whenever the baseline legitimately moves, in the
same commit that moves it, so the number and its cause travel together.

## The gate: `skiaPerf.spec.ts`

What blocks a pull request is `tests/e2e/skiaPerf.spec.ts`. It runs in the browser shards, so
`CI gate` holds it. The setup:

- the Skia felt on SwiftShader, motion on, 4x CPU throttle;
- 874x402 at DPR 1, seeded, on the virtual clock.

It reads two 240-frame windows. One is the settled table. The other is the viewer's throw with the
three bots answering. Each window is held to `tests/e2e/helpers/skiaPerfBudgets.ts`, which counts:

- WebGL draws per frame on the page's canvases;
- 2D draws on the page's canvases;
- draws on canvases outside the document;
- `readPixels` calls;
- style writes anywhere under `game-root`;
- through the turn, style writes inside the cards, between a floor and a ceiling;
- the frames the felt drew in: at rest a ceiling, through the turn a floor.

A slow runner steps the same frames as a fast one, so these counts do not move with the runner.

Nothing timed gates, for the reasons in § Why this recorder does not gate CI. Script ms, task ms and
long tasks go into the `skia perf at 4x` annotation only. Script ms would not catch much anyway.
Under the virtual clock a frame's callbacks run inside `page.evaluate`, and CDP's `ScriptDuration`
misses that work: a planted 1.5M `Math.sin` a frame moved it by 2%. **A regression that only burns
CPU, with no extra draw, readback or style write, passes this gate.** Catching it would need a time
budget, and this runner cannot hold one.

The budgets and the spec are targets (rule 52), set by
`docs/adr/0018-the-skia-table-is-held-to-counted-budgets.md`. A budget moves in a pull request of
its own, touching nothing under `app/`, `components/` or `lib/`, and `@rotonmeta` owns both files.

Not covered: DPR 3, where SwiftShader had not finished the rest window after six minutes. The
recorder's 3x case (§ The Skia felt at 3x) prints figures there and holds no budget.

## Why this recorder does not gate CI

It records; it does not fail a build. That is a decision, not an omission.

Frame timing on a shared runner is noisy, and this repo has the evidence in
hand: #152 records three separate `tableFit` failures where a plain
`locator.click` timed out on CI — one waiting **240 seconds** for the home
screen's first button — while the identical spec runs all eight of its cases
locally in 1.1 minutes. A runner whose *functional* timeouts vary that much
cannot host a frame-timing threshold that means anything.

A perf check that goes red at random gets disabled, and a disabled check is
worse than no check: it reads as coverage that is not there. So the numbers are
recorded on demand and compared by a person, and the only assertions in the spec
are anti-vacuity ones — that frames were observed at all, and that the table
rendered.

## What this does not cover

> [!IMPORTANT]
> **A desktop CI runner will never show what a mid-range Android phone does.**
> The baseline above is desktop Chromium, throttled in software, and nothing else.

Getting the number that actually matters needs a person with a handset:

1. Serve the web build on the LAN (`npm run expo:web:build`, then serve `dist/`).
2. Open it in Chrome on a mid-range Android phone.
3. `chrome://inspect` from a desktop Chrome, and record a Performance trace
   across an offline game's deal, a throw, and a bomb.
4. Record the same fields as the table above here, labelled with the device.

Until that row exists, every "is this fast enough on a phone?" answer is still a
guess — a better-informed one than before, but a guess.

The app is on **Expo SDK 58**, whose React 19.3 carries 19.2's Chrome Performance
Tracks — the closest thing to a first-party answer, and worth recording in that
trace (`tests/tooling/webPerfDoc.test.ts` keeps this sentence on `package.json`'s SDK).
