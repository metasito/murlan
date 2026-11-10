# PR 0 spike result: compositor sway (web, Android emulator, iOS simulator)

Branch `claude/render-spike` (pushed, no PR, never merged). Workflow: PR 0a, #2027. Raw numbers:
`spike-web-q1-3-6.json`, `spike-web-q4-5.json` in this folder.

Emulator GPU numbers stand in for devices; there is no real-device run (owner, 2026-11-09).

Web rig: Playwright Chromium, the real RN web export of the spike route (app/spike.tsx on the spike branch, Reanimated 4.7.1
CSS animations on `Animated.View`, 874x402 DOM canvases), SwiftShader. Cost runs use 4x CPU throttle,
median of 3, load below 5. SwiftShader overstates pixel cost; the ratios are the evidence.
The harness is tests/e2e/zzSwaySpike.spec.ts on the spike branch.

## Per-platform table

| question | web (done) | Android emulator | iOS simulator |
|---|---|---|---|
| 1 keyframes with easing per keyframe | OK. Reanimated emits one `CSSAnimation` with a 81-rule `@keyframes`, 80 carrying `animation-timing-function`. 4000 seeks across the 5 min loop: max error 0.000025 pt | OK after a fix: `cubic-bezier(...)` strings are refused (`Invalid predefined timing function`), `cubicBezier(...)` from Reanimated works. 81-keyframe loop runs, inline and memoized (`css.keyframes`) alike | Same refusal, same fix; runs |
| 2 parent fade does not redraw Skia | n/a: web uses a DOM 2D canvas for end B, not a Skia surface | Not shown. Every animated step, including the pool translate, runs at about 9 fps on this software-GL emulator; opaque `SurfaceView` 9.0 fps and translucent `TextureView` 9.1 fps are indistinguishable. No draw counter exists | Not shown directly. Fade adds about 20 ms/s of process CPU over static two layers (42 to 58 to 69); the live shader adds about 90. 60 fps throughout. A full Skia redraw each frame is not ruled out by CPU alone |
| 3 handoff jump, both ways | max 0.29 pt live to CSS, 0.25 pt CSS to live (40 handoffs, 8 frames either side); with the measured start lead 0.15 / 0.28. Max per-frame step excess 0.45 pt | Not measured natively (not observable from JS). Rests on the web number | Same |
| 3 freeze (pause, resume) | OK. `animationPlayState: paused` held the value to 0 pt for 3 s; after resume the max error against the clock shifted by the pause is 0.24 pt | `animationPlayState: paused` returns the loop to 60 fps (animation stopped); value hold not read | Same, 60 fps, CPU 42 ms/s (= static) |
| 4 rest ms/s, fps (DPR 1 / DPR 3) | CSS sway 2 / 2 ms/s main thread, 60 compositor fps. Static 1 / 1, 0 fps. rAF-driven sway 268 / 964 ms/s | UI-loop fps: static 59 to 60; any animation 9 (emulator limit, not a sway cost). No per-process CPU row on Android | fps 60 in every step. Process CPU ms/s: one layer 51, two layers static 42, sway 58 to 69, paused 42 |
| 4 memory, one extra full-screen layer | 1.4 MB at DPR 1, 12.6 MB at DPR 3 (874x402x4 B x DPR^2). Process RSS was too noisy to resolve it (733 to 1911 MB across modes, uncorrelated with layer count) | Footprint 190 MB static two layers against 186 one layer (+4 MB, noise level); sway adds no growth (194 to 197 over 20 s) | Footprint 87 MB one layer, 88 two layers (+1 MB); no growth during sway |
| 5 G2 glide (plus-lighter pool translated by CSS) | 15 / 11 ms/s, 60 fps | 9 fps (equal to G1, 8.9): the emulator cannot tell them apart | 60 fps, 63 ms/s |
| 5 G1 glide (live lit shader) | not rerun in-app. `bench/glide.log`, same raster: 957 to 998 ms/s at DPR 3, 6 to 9 draw fps | 8.9 fps | 60 fps, 134 ms/s |
| 6 `mixBlendMode: "plus-lighter"` | Passes through RN web: computed `mix-blend-mode: plus-lighter`. Pixel on grey 100 under a 50 % grey 128 pool: plus-lighter 164 (exact add), screen 139, normal 114 | Runs without error on the pool (g2 step); pixels not read | Same |

Q6 on native, by source only (RN 0.88.1): `BlendModeHelper.kt` maps `plus-lighter` to `BlendMode.PLUS`;
`RCTViewComponentView.mm` handles `PlusLighter`. Not yet seen on screen.

## What the web half showed

1. **The clock must be the keyframe easing, not a sine.** The standard `easeInOutSine` bezier
   `(0.445, 0.05, 0.55, 0.95)` is 0.70 pt off a sine at amplitude 20. A rig on `sin(ph)` and a CSS
   animation on that bezier jump by up to 0.70 pt at a handoff, over the 0.5 pt line. `swayTable`
   (spike branch: components/table/spike/swayTable.ts) therefore defines each half-swing as that bezier
   and the live rig reads the table. The result above is for that single curve. The sway differs
   from the lamp rig's sine by at most 0.7 pt, which is below sight.
2. **A handoff needs a value on the element in the frame the animation goes.** The first cut
   removed the animation and let the live loop write a frame later: 20 pt flash (the element fell
   to its base style for a frame). Rendering the live value into the style in the same commit as
   the swap fixed it.
3. **CSS start lags the call by 0 to 14 ms** (median 5 ms). Pre-compensating the delay by the
   median lead halves the live to CSS error (0.29 to 0.15 pt). Without it the error is still under
   0.5 pt.
4. **Compositor sway costs the main thread 2 ms/s and holds 60 compositor fps**, against 268 (DPR 1)
   and 964 (DPR 3, saturated) ms/s for the same fade driven by rAF.
5. **G2 is cheap on web**: 11 to 15 ms/s at 60 fps against about 1000 ms/s for the live shader.

## What the native runs showed

Run 42713592179 (fixed scene); raw rows `spike-android.ndjson`, `spike-ios.ndjson`, `spike-ios-host-rss.txt`.

1. **Reanimated native refuses a bezier string as a per-keyframe easing.** First runs (42700135008, 42710019000)
   crashed with `Invalid predefined timing function "cubic-bezier(...)"`, and the failed registration poisoned
   later animations (`No keyframes with name REA-CSS-n were registered`). `cubicBezier(...)` from Reanimated
   fixes it. The same 81-key object also runs on web. `ambient()` must build native easing objects, not strings.
2. **iOS holds 60 fps in every step**, the fade costing about 20 ms/s of process CPU over static, the pool
   translate about the same, the live shader about 90 more. Reanimated CSS animations are cheap there.
3. **The Android emulator cannot rank anything animated**: sway, pool translate and the live shader all land
   at 8.7 to 10.2 UI fps (swangle software GL); only the paused step is 60. It shows the sway is no worse than
   the cheapest animation, nothing more. It also did not separate opaque from translucent B.
4. **Q2 is not settled by counts on either platform.** Skia 2.14 offers no draw callback, and the proxies
   (process CPU on iOS, fps on Android) do not isolate a redraw.

## Shapes picked

- **D2/D3, web: compositor shape** (CSS keyframes on `swayTable`, DOM canvas for end B, live rig reads the
  table, freeze by play state). Evidence: web Q1, Q3, Q4.
- **D3, native: N1 on iOS; N1 on Android as the plan, behind N0.** iOS shows the cheap fade at 60 fps.
  Android has no evidence against N1 and none for it: the emulator is software-limited and flat across
  animations. Keep `swayPlan.ts` per platform with N0 as the fallback, and require the Android shape to be
  confirmed on a real GPU before it ships dark-launched (owner's call: no device runs, so it stays N1 with N0
  one constant away). Do not pick N2: nothing here shows N1 failing.
- **GL: G2 on web and iOS** (iOS: 60 fps at about 63 ms/s against 134 for G1; web: 11 to 15 against about 1000).
  **Android: G2 as well** (equal to G1 on the emulator; cheaper elsewhere, and one shape for the code).
- Constraint for D2/D3: per-keyframe easing is a `cubicBezier` object on native and a string on web, from one
  place in `lib/motion.ts`.

## Still unmeasured

- A true draw count for Q2 and an on-screen read of the native handoff and freeze. Both need a native hook
  that does not exist in Skia 2.14 or Reanimated 4.7.1.
