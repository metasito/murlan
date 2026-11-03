# The table at play: why it is janky (measured 2026-11-03)

The owner, 2026-11-03: "the whole game once we log into a table is super laggy. All animations."

**The table is never at rest.** Even with nobody moving, it redraws a full-resolution particle
canvas every frame and re-poses every card's lamp gloss about 25 times a second. On a phone-speed
main thread (Chrome CPU throttled 4x), a table waiting on a turn runs at 15-17 fps.

## Setup

- Base commit `1860b52f8`, production web export (minified, `EXPO_PUBLIC_E2E_FAST` unset), the
  real server on Postgres 16 and Valkey 9.1.3.
- Headless Chromium, viewport 874x402 at device scale factor 3 (iPhone 16 Pro landscape),
  **motion on** (`reducedMotion: no-preference`). CPU throttled with
  `Emulation.setCPUThrottlingRate` at 1x, 4x and 6x.
- 4-core 2.1 GHz VM with **no GPU**: WebGL is SwiftShader, so Skia numbers are relative only.
  No iOS device: every native claim below is inferred from code shared with web.

**The existing perf check never measured animation.** `npm run perf:web`
(`tests/e2e/webPerf.spec.ts`) runs through the `consoleErrors` fixture, which forces reduced motion
(`tests/e2e/fixtures.ts:131`), as does `openOnlineTable`. Under reduced motion there is no lamp
sway, the motes sleep and the particle loop idles, so `docs/WEB-PERF.md`'s "a settled table holds
60fps" never measured the table the owner plays.

## Instruments

`experiments-knobs.patch` (apply on `1860b52f8`) holds the local-only instruments and every
experiment:
- `tests/e2e/perfProbe.spec.ts` plays full rounds through the UI (`driveGameToCompletion`) and
  records rAF timestamps, long tasks, long animation frames with attribution, heap and socket
  frames; `perfLab.spec.ts` samples 4 s windows of a settled table and the 2.5 s after each play;
  `playwright.probe.config.ts` runs them.
- `lib/perfKnobs.ts`: `localStorage` knobs (`fixParticles`, `glossStep`, `fixBake`, and the
  removals). With every knob off the build is the shipped one.

## Baseline (shipped), full rounds

| run | scenario | fps | p95 ms | p99 ms | dropped % | long-task ms |
|---|---|---|---|---|---|---|
| offline 1x | whole round (274 s) | 38.5 | 50 | 283 | 35.9 | 48,934 |
| offline 1x | deal | 16.3 | 300 | 383 | 73.6 | 1,134 |
| offline 4x | whole round (556 s) | 13.2 | 150 | 583 | 78.0 | 344,576 |
| offline 4x | moves | 10.3 | 183 | 617 | 81.7 | 158,841 |
| offline 6x | whole round | 8.7 | 233 | 750 | 85.5 | 287,425 |
| online 1x | whole round (228 s) | 46.0 | 33 | 83 | 23.4 | 25,886 |
| online 4x | whole round (294 s) | 20.4 | 100 | 500 | 66.1 | 137,718 |

Settled table (nothing moving, mean of 3 windows): 1x 57.8 fps, main thread 542 ms/s busy;
4x 17.3 fps, 855 ms/s. Full rows: `baseline-table.md`.

A 47 s trace of a 1x round: main thread busy 39.3 s (84%), of it scripting 9.6 s, rendering 3.3 s,
painting 4.0 s, GC 0.35 s; `LayerTreeHost::DoUpdateLayers` (canvas layer upload) 13.6 s and
`CommandBufferProxyImpl::WaitForGetOffset` (synchronous WebGL readback) 5.1 s. With fixes 1-3:
23.4 of 46.5 s busy (50%).

## Causes, ranked by impact per effort

### 1. The particle canvas redraws at full resolution every frame, forever

`components/table/particleLayer.web.tsx:86-121`: the backing store is window x DPR (2622x1206,
12.6 MB) and the rAF loop clears and redraws it every frame. `sceneAsleep`
(`particleSprites.ts:162`) sleeps only under reduced motion, so the 40 ambient motes keep it awake.
The cost is the per-frame bitmap upload, not script (`frame` is ~6 ms per 4 s).

| settled table | 1x main ms/s | 4x fps |
|---|---|---|
| shipped | 542 | 17.3 |
| layer removed | 246 | 32.0 |
| backing store at DPR 1 | 398 | 27.2 |

Native: `particleLayer.tsx` is a separate full-screen Skia Atlas that rebuilds 200-entry buffers
(`PARTICLE_BUDGET`) and redraws every tick (inferred).

### 2. The lamp sway re-poses every card's gloss forever

`useLampRig.ts:30-39` runs a frame callback for as long as the table is mounted; the sway
(`lampRig.ts:174`, +-20 pt) crosses `GLOSS_POINT_STEP` (`cardGloss.ts:26`, 0.5 pt) 20-35 times a
second, and each step re-runs the mappers in `LampGloss.tsx:42-53,95-107,129` for 139 layers
(35 gloss spots, 35 streaks, 17 foil inks, 17 foil bands, 35 level shades).

| settled table, 4x | fps |
|---|---|
| shipped | 17.3 |
| no gloss layers | 26.1 |
| no sway | 26.0 |
| sway, particles and gloss all off | 56.6 |

**Fixes 1+2 together** (`fixParticles`: canvas at DPR 1, ambient-only scene at 30 Hz;
`glossStep`: 2 pt): settled table 15.3 -> **45.7 fps**, p95 94.5 -> 38.9 ms, long tasks 41 -> 4.3
per window; the 2.5 s after a play 16.9 -> 29 fps. Either alone: 19.5 and 23.4 fps.

Native: the same worklets run on the UI thread under Hermes (no JIT), so the 4x-6x rows are the
closer guide; `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS` is off, so each update is a ShadowTree commit.

### 3. Web only: the fallback felt re-bakes a 3.2 Mpx WebGL cloth on every turn

`feltFallback.tsx:104-176`: `bake` runs in a passive effect on every lamp target change (every
turn and deal, `GameTable.tsx:727` `lampAim`), renders the cloth at full DPR, then `drawImage`s it,
forcing a GPU readback. Over a 1x round `bake` is 23.4 s of 182 s busy; long animation frames put
42.3 of 49.9 s on this effect (~220 ms, 193 times).

| 1x full round | fps | dropped % | long-task ms | deal fps |
|---|---|---|---|---|
| shipped | 38.5 | 35.9 | 48,934 | 16.3 |
| bake cached (`fixBake`) | 58.2 | 3.0 | 5,210 | 46.4 |
| fixes 1-3 | 55.6 | 7.4 | 4,303 | 41.4 |

Applies only while the fallback shows: always on software WebGL, otherwise until CanvasKit draws.

### 4. What is left during plays is rendering, not script (partly unconfirmed)

With fixes 1-3 at 4x, the windows after a play run at 25-29 fps; their CPU is 82% style, paint and
layer work, Reanimated ~6%, the particle frame 3.3%, React ~1.5%. Each card in flight carries five
lamp layers. Untested next step: one lamp layer per card; skip `LevelShade` at lamp level 1.

### 5. Native iOS: 60 Hz cap, per-prop ShadowTree commits (config, unmeasured)

`app.json` has no `CADisableMinimumFrameDurationOnPhone`, so the iPhone 16 Pro runs the app at
60 Hz. No `reanimated.staticFeatureFlags` is set. Proposed: `proposed-native-flags.patch`. 120 Hz
halves the frame budget, so it follows fixes 1, 2 and 6.

### 6. GPU web and native: full-screen Skia canvases re-record and re-raster every frame (inferred)

`feltCanvas.tsx:318-335` derives every uniform and transform from `lamp`, which changes every
frame, so Skia replays the display list each frame and rasterises a 3.2 Mpx procedural cloth
(~14 `sin`, 3 `pow` per pixel) plus blurred shadow pictures; `handShadeCanvas.tsx:83-112`
re-records its clip and blur picture each lamp frame. On SwiftShader at DPR 3 the Skia table runs
~1.2 fps (2.3 without the hand shade) and stays there with sway, particles and gloss all off.

### 7. The deal starts on the frames that mount the hand

Deal frame intervals at 1x: `17 17 17 17 17 17 100 333 83 383 ...`; long tasks at +31 ms (260 ms,
the bake) and +449 ms (327 ms, React mounting the hand, 173 ms render).

## Ruled out

- React re-renders: 6.4 commits/s, ~72 fibres each, none per frame; ~3% of busy time.
- Socket traffic: 0.55 messages/s, 1.1 KB average.
- Memory and GC: heap 27 -> 72 MB peak -> 39 MB after two rounds, no trend; GC 0.35 s of 47 s.
- Timers (countdown, audio pump, orientation relock, diagnostics): 1 Hz or slower.
- Layout: 0.2-3 ms/s. Image or audio decoding during play: not visible.

## Not measured

Native iOS (no device; confirm with `npm run ios:device -- --gates`), real-GPU web, the exchange
phase in isolation, and a 4x full round with the fixes (the run failed without output; the 4x
before/after is from the settled-table windows).
