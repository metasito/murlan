# Capturing the real table beside its mockup (#1250)

Research for metasito/murlan#1250, a child of the map #1230. Read against `main` at `9e295925`,
2026-09-24. Tags: **[src]** = read in this repo or a package's source; **[measured]** = I ran it;
**[est]** = my inference, not run.

## Verdict

| Question | Answer |
|---|---|
| Runner | Playwright on the web build, in the existing harness (`tests/e2e/playwright.config.ts`, 874 × 402). The mockup runs in the same browser, from a copy saved under `tests/e2e/fixtures/`. |
| Reaching a moment | The real table starts from a seeded offline save, and the spec's own tap triggers the moment. The mockup is started by calling its own `start(moment, option)`. Both run on one virtual clock that stands still between steps. Both sides' `Math.random` is seeded. Time zero is the onset of the triggering event on each side. |
| What is captured | Frames from both sides at the same times after the onset: a strip at 30 fps, as JPEG at DPR 2, plus DPR 3 stills at FEEL-BAR's checkpoints. Beside the frames, a per-step trace of named quantities from each side. |
| How they are compared | A pixel diff means nothing here, because the particles are random on both sides. Two instruments instead: **(1)** a side-by-side page the eye judges, with the two playing in step, a scrubber, and a flip toggle that swaps them in one box; **(2)** a numeric trace diff that CI enforces: event onsets, live-particle counts, the lamp's position, level and flare, the shake transform, and the mean brightness of named regions. |
| Where it runs | The spec runs in `ci.yml`'s browser shards like any other spec. Its frames and trace are attachments, so they reach the merged `playwright-report` artifact on green runs too. The session landing the ticket builds the side-by-side page from those frames (or from a local run of that one spec) and publishes it as an artifact, linked from the pull request and the ticket. |
| Skia on web | The spec waits for a "Skia ready" marker before it triggers the moment, and serves CanvasKit from a local file. It captures the pre-Skia fallback too, by holding CanvasKit back. |

## What already exists [src]

| Piece | Where | What it gives the capture |
|---|---|---|
| A mockup saved as a fixture and compared with the real table | `tests/e2e/fixtures/prototype-table.html`, `tests/e2e/feltParityGrid.spec.ts` | The pattern. An artifact's HTML is saved into the repo once ("a parity harness that reaches the network is a parity harness that stops working"). The spec opens it with `file://` at the shared 874 × 402 and samples pixel patches on both sides. It compares the lamp pool's falloff in absolute levels, not pixel for pixel. |
| Seeded tables | `tests/e2e/helpers/offlineSeed.ts` (`resumeSaved`, `openCaptureState`, `offlineGameSave`), `lib/captureStates.ts` | Any table state in one page load, through the app's own restore path. |
| Moments reached from a save | `tests/e2e/tableMoments.spec.ts` | A fresh deal (`firstPlayMade = false`), a played card (tap a seeded card, then Gioca), and a partita won on the next card (`partitaPointSave`). It samples computed styles every frame with a `requestAnimationFrame` loop and attaches a screenshot. |
| Holding a bot's turn | `lib/e2eAiSuspend.ts` | A localStorage flag, read only when `EXPO_PUBLIC_E2E_FAST` is baked into the bundle. This is the pattern for any test hook the capture needs: no production build reads it. |
| Reconnect | `tests/e2e/reconnect.spec.ts` | The online table against the real server. It is the only moment that cannot start from an offline save. |
| Artifacts CI keeps | `.github/workflows/ci.yml` (browser shards, then `browser-report`) | `blob-report-N` (1 day), `playwright-report` as merged HTML (7 days; the HTML reporter copies every attachment into it), and `playwright-test-results-N` on failure (7 days). |
| Mockup internals | "Particles for each moment" artifact, version `1790245964-9a0d` | Top-level `sceneT` (the scene clock in ms), `simT`, `P` (the live particles), `lamp` (`lx`, `ly`, `L`, `flare`), `start(m, o)`, and a `#<moment>` hash. Its loop is `requestAnimationFrame`, with dt clamped to 50 ms. `Math.random` drives every particle. CSS transitions and keyframes also play a part: the pile's `.grp` at 280 ms, the chalk strokes at 280 ms, and the clock's opacity at 100 ms. |
| Animation in the app on web | `react-native-reanimated@4.5.1`, `lib/module/layoutReanimation/web/componentUtils.js:129` | `useAnimatedStyle` and `withTiming` run on `requestAnimationFrame`. The `entering`/`exiting` layout animations become **CSS keyframes** (`element.style.animationName`), used in `components/table/pile.tsx`, `components/GameTable.tsx` and seven other files. |

## What I measured

Throwaway probes in a scratch directory outside the repo, run with `playwright-core` 1.62.1 from
the shared install, then deleted.

1. **`page.clock` drives `requestAnimationFrame` and `performance.now`, but not CSS animations**
   [measured]. After `clock.pauseAt`, 600 ms of real time moved a rAF-driven box 0 px, while a
   CSS transition and a keyframe animation moved 583 px. After `clock.runFor(250)`, the rAF box
   had moved 239 px over 15 frames. The CSS pair moved with real time only.
2. **CDP puts CSS animations on the same clock** [measured]. The sequence was
   `Animation.enable`, then `Animation.setPlaybackRate {playbackRate: 0}`, then at each 16 ms
   step `clock.runFor(16)` and `currentTime += 16` on every `document.getAnimations()`. The
   transition and the keyframes read 160, 320 and 480 px at 160, 320 and 480 ms, in step with
   the rAF box, which lags one frame (145, 305, 465). An animation that starts partway through
   a step can be off by up to one step.
3. **The real mockup runs under this clock and replays exactly** [measured]. The probe opened
   "Lantern Particle Moments" as a file, at DPR 2, with `#frame` at 874 px. It installed the
   clock paused before navigating, seeded `Math.random`, and called `start(win, A)` from the
   spec. `sceneT` followed the steps (397 ms at step 400). The trace read the live count
   (40, 40, 110, 102, 77, 56, 40, 40 at 0.4 s intervals) and `lamp.lx` directly. Two runs gave
   **byte-identical JPEG frames at all 8 checkpoints**, with identical traces. When the clock
   was installed after load, time flowed before the pause and the runs differed: the lamp's
   sway phase moved `lx` by up to 11 px.
4. **Frame size** [measured]: the 874 × 402 table as JPEG at quality 80 is about 95 KB at DPR 2
   and about 170 KB at DPR 3. A 3 s moment at 30 fps is 90 frames per side, so about 17 MB for
   the pair at DPR 2. That is over one page's 16 MB, so the frames go in the artifact's asset
   store (15 MB per file, 64 MB per version), and each page covers the moments of one ticket.
5. **WebGL renders in software, on this machine too** [measured]. Headless Chromium reported
   `ANGLE (… SwiftShader Device (Subzero) …)`, with and without `--disable-gpu`, and drew a
   WebGL2 canvas stepped by the paused clock. Playwright's Chromium launcher always adds
   `--enable-unsafe-swiftshader` [src, `playwright-core/lib/coreBundle.js`]. So a GPU-less CI
   runner renders the Skia felt the same way as this machine [est]. Because time is virtual,
   a slow software shader changes how long the capture takes, never what a frame shows.

## The harness, as the first tracer ticket should build it

- **One spec per mockup family**, for example `tests/e2e/mockupParity.spec.ts`. It holds a small
  adapter table per mockup: how to start a moment (`start(m, o)` and the picked option's index),
  which global is the mockup's clock, and which function marks the onset. Top-level function
  declarations are writable globals, so the spec can wrap, say, `play`'s `onLand` to timestamp the
  landing without editing the mockup. Each fixture's header records the artifact URL and version
  it was saved from, as `prototype-table.html`'s does. A mockup picked later is a new fixture,
  never a live fetch.
- **Clock**: `page.clock.install({ time: fixed })` and `pauseAt` **before** navigating, then CDP
  playback rate 0, then step 16 ms at a time. Seed `Math.random` with `addInitScript` on both
  sides. The mockup side then replays byte for byte (measured). The app side boots on real
  network events, so the spec advances virtual time in fixed chunks while it polls for readiness.
  The moment itself is deterministic from its trigger. The ambient sway phase at the trigger can
  differ from run to run by the polling chunk, so a spec that needs the lamp at a fixed phase
  resets the sway through the test hook [est].
- **Reaching the moment in the app**: seed with `resumeSaved`/`openCaptureState`, and trigger with
  the spec's own tap. The patterns are in `tableMoments.spec.ts`: the deal from a fresh save,
  a landing by playing a seeded card, a win or partita by playing the last card, and a loss by
  releasing a held bot that goes out (`e2eAiSuspend`). At rest is the table with a held turn.
  The hand-off is a released bot. `EXPO_PUBLIC_E2E_FAST` zeroes the bots' delay, so the spec
  aligns each hand-off on its own onset rather than on the mockup's 1.5 s spacing. Reconnect
  needs the online table and socket.io's timers, and the virtual clock stalls those. Its ticket
  should capture with the clock running, align on the drop, and accept up to a frame of jitter
  [est].
- **Trace hook in the app**: Skia- and Canvas-drawn particles have no DOM, so the app exposes a
  per-frame trace (`live`, lamp `x`, `y`, `level` and `flare`, the shake transform, and onset
  marks) on a global. It is written only under `EXPO_PUBLIC_E2E_FAST`, the gate
  `lib/e2eAiSuspend.ts` uses. The mockup's side reads `P.length + MOTES`, `lamp.*` and
  `getComputedStyle(world).transform`.
- **Region brightness**: from each frame, the mean brightness of named regions: the lamp pool at
  the seat on move, the rim, the empty right band, the pile and the slate. This survives random
  particle placement, and it catches a missing flare, a wrong dim or an absent pool.
  `feltParityGrid.spec.ts` already samples patches this way.
- **Gate**: the trace diff is the assertion. Proposed starting tolerances, which the owner confirms
  with the tracer ticket: onsets within one 16 ms step; live count within ±10% of the mockup's at
  every checkpoint, with the peak within ±10%; lamp position within 4 pt and level within 0.03;
  shake peak within 10% and its end within one step; region brightness within 6/255.
- **Frames**: a 30 fps strip at DPR 2 through the moment's window, and DPR 3 stills at FEEL-BAR's
  frame-check times. DPR 3 is the owner's iPhone, and the worsted twill fades to a flat tone below
  about 1.5 device pixels per thread ("Felt and card materials", round two). The mockup caps its
  own canvases at 2.5×. The frames and the trace JSON are `test.info().attach(...)`ed, so they
  reach `playwright-report` on a green run.
- **Skia**: the Skia layer sets a readiness marker once CanvasKit has loaded **and** drawn its
  first frame. `globalThis.CanvasKit` alone means loaded, not drawn. The spec polls for the
  marker while stepping time, and triggers the moment only after it appears. `page.route`
  serves the CanvasKit `.wasm` from `node_modules`, so a capture never depends on jsDelivr. A
  second pass holds that route to capture the pre-Skia fallback, because the web shows it until
  Skia arrives.
- **The side-by-side page**: per moment, the two strips play in step at real speed, with a
  scrubber by time since onset and a flip toggle that swaps mockup and real in one box. It also
  shows the trace curves overlaid and marks the checkpoints where a tolerance failed. The session
  landing the ticket builds it from the report (`gh run download … -n playwright-report`) or from
  a local run of the one spec (rule 3), and publishes it as an artifact with the frames in its
  asset store.

## What this does not settle

- **Who looks at the side-by-side page after the tracer.** The owner reviews the first ticket
  (map Notes). My default for the rest: the reviewers in `/queue` read the page's checkpoint
  pairs and the trace diff, and the pull request carries the link for the owner to open if he
  wants. If he wants to sign off every effect ticket himself, the tickets need `ready-for-human`
  at the end instead.
- **Native.** Device checks are waived (map Notes), so this is web only. Native-only divergences
  in decorative effects are allowed by the Skia note and are not captured.
