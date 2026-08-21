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

Roughly 25 seconds. It is **not** part of `npm run test:e2e` — the default suite
ignores the file, and this runs from its own config
(`tests/e2e/playwright.perf.config.ts`).

It prints two lines:

```
[web-perf] deal {...}
[web-perf] idle {...}
```

`deal` records for three seconds from the click that starts the game, which is
the burst worth measuring: every card in the hand animates in at once. `idle`
records a settled table as the control — the difference between the two is the
cost of the animation rather than the cost of the page.

| Field | Means |
|---|---|
| `frames` | presented frames observed. Under ~30 for `deal` means nothing was measured. |
| `p50`, `p95`, `worst` | milliseconds between presented frames. **16.7 is one frame at 60fps.** |
| `janky` | frames that took longer than two 60fps frames to arrive |
| `longTasks`, `longTaskMs` | main-thread tasks over 50ms, via `PerformanceObserver` |
| `transformed` | elements carrying a non-identity transform when sampled |
| `domNodes` | elements in the document |

## The baseline

Desktop Chromium via Playwright, offline game, 4 players, `ef03d0c`, 2026-08-21
— **before** any of #94's visual work.

| | frames | p50 | p95 | worst | janky | longTasks | transformed | domNodes |
|---|---|---|---|---|---|---|---|---|
| **deal** | 178 | 16.7 | 16.7 | **33.4** | 1 | 0 | 179 | 782 |
| **idle** | 120 | 16.7 | 16.8 | 16.8 | 0 | 0 | 179 | 779 |

Read it as: the table holds 60fps, and the deal costs **one dropped frame**. No
long tasks at all, on this machine.

Two things worth carrying forward:

- **`transformed` is already 179 on a settled table**, against #95's ~100
  ceiling. The two are not the same measurement — a *static* transform counts
  here, and #95's number is about components *concurrently animating* — but it
  says the budget is not empty before the visual work starts, and it is the
  cheapest proxy available for how many nodes a frame has to touch.
- **`worst` is the number that moves first.** p50 stays at 16.7 long after the
  experience has stopped feeling smooth; a dropped frame shows up in `worst` and
  `janky` while the median is still perfect.

### What counts as a regression

There is no threshold in the test, deliberately. Compare against the table above
by hand, and treat as a regression:

- `janky` on `deal` rising above single figures, or any `janky` on `idle`
- `longTasks` becoming non-zero
- `p95` on `idle` leaving ~16.8

Re-record and update this table whenever the baseline legitimately moves, in the
same commit that moves it, so the number and its cause travel together.

## Why this does not gate CI

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
> The baseline above is desktop Chromium and nothing else.

Getting the number that actually matters needs a person with a handset:

1. Serve the web build on the LAN (`npm run expo:web:build`, then serve `dist/`).
2. Open it in Chrome on a mid-range Android phone.
3. `chrome://inspect` from a desktop Chrome, and record a Performance trace
   across an offline game's deal, a throw, and a bomb.
4. Record the same fields as the table above here, labelled with the device.

Until that row exists, every "is this fast enough on a phone?" answer is still a
guess — a better-informed one than before, but a guess.

The **Expo SDK 54 → 57 upgrade** would bring React 19.2's Chrome Performance
Tracks, which is the closest thing to a first-party answer; it is filed
separately (#119) and this does not wait on it.
