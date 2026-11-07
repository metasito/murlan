# Murlan table render pipeline: structural performance review

Read-only review. Line numbers are for main at `fe9de691`. Partway through the review the checkout
moved to `952d3045` (another process; the working tree is clean), so read files with
`git show fe9de691:<path>` to see the lines cited here.

**Measured** means I ran it in this session. Scripts are in
`/tmp/claude-0/-workspace-murlan/898beb32-de33-5eb2-afd9-a84741ec2651/scratchpad/perf/`.
**Inferred** means it comes from reading the code. **Prior** means the repo's own measurement,
`docs/research/2026-11-03-table-perf/REPORT.md`.

I did not run `npm run perf:web`. There is no `node_modules`, and the run needs `npm ci`, an Expo
export and the Postgres/Valkey stack. All of that would have to be written into the repo directory,
and it is not quick. Instead I ran three small experiments that isolate the claims below:

- `lru.mjs`: the felt's cloth cache, replayed exactly.
- `shadowBench.mts`: the repo's own shadow worklets, timed in Node.
- `composite.cjs`: a synthetic test of the layer structure in Chromium, 874x402 at DPR 3, CPU
  throttled 4x.

## The short answer

Each perf ticket made one effect cheaper. None of them changed the architecture underneath,
which is:

1. Every frame, forever, repaint up to three full-viewport raster surfaces.
2. Mirror every card's pose into a JS registry, then re-raster its shadow in a second renderer.
3. Build every card from 12-20 DOM nodes with 5-8 animated mappers each.

The effects are additive per surface and per card, and the lamp never stops moving, so the table
has no resting state.

There is also a blind spot. The harness everyone measured with (`perf:web`, headless SwiftShader)
never mounts the Skia felt or the hand-shade canvas (`feltSkia.web.tsx:24-38`). The fixes were
therefore checked against a renderer that a phone with a GPU, or the native app, never uses.

## What runs, per frame

**At rest (nobody moving), GPU web and native**

- 2 Reanimated frame callbacks stay registered for as long as the table is mounted: the lamp at
  `useLampRig.ts:78` and the link hold at `useLinkHold.ts:50`.
- The lamp sways ±20 pt forever (`lampRig.ts:59,173,176`). Its moved threshold is 0.01 pt
  (`lampRig.ts:125`), so `lamp.modify(undefined, true)` notifies every reader on every frame
  (`useLampRig.ts:37`).
- The felt canvas has 11 lamp readers (`feltCanvas.tsx:417-442`), which rebuild 6 rgba strings per
  frame among other things. Each change makes CanvasKit replay the whole felt display list at
  device resolution:
  - the room fill
  - the rail image
  - a full-rect `softLight` radial gradient (line 473)
  - the coat stroke
  - two full-screen cloth images, one with animated opacity
  - glow, cast and contact pictures with blur mask filters, under a transform that moves with the
    lamp (line 442)
  - a full-screen black rect with opacity (line 513)

  That is about 6 full-viewport fills per frame, at 60 Hz, or 120 Hz on iPhone since
  `CADisableMinimumFrameDurationOnPhone` (`app.json:15`).
- The particle canvas clears and redraws at 30 Hz forever, because the 40 motes keep it awake.
  On web that is a full-viewport 2D canvas at DPR 1 (`particleLayer.web.tsx:86,106`). On native it
  is a Skia Atlas that rebuilds three 200-entry buffers.
- The hand cards' gloss runs about 8 times a second on the swayed light (`cardGloss.ts:26`).

**On each turn change**

- The lamp glides about 1.8-2.3 s to settle: exponential at 2.2 per second (`lampRig.ts:58`),
  settled within 3 pt (`feltCanvas.tsx:297`). See cause 1.
- Every opponent back's gloss, foil and shade mappers re-run on each still-light step.
- On the fallback felt only, every CardView re-renders. See cause 4.

**During a deal or play**

- Every moving card publishes into the registry (`useCardRects.ts:111,118`).
- The registry then triggers the shadow-shape string, cluster and path rebuilds, and the blur
  pictures, in the felt canvas (`feltCanvas.tsx:437-440`).
- The hand-shade canvas re-records too, with two antialiased `clipPath` per card
  (`handShadeCanvas.tsx:81-99`).
- The whole hand re-fans, so all 13 hand rects change.

**Ruled out or small, measured here or prior**

- React work: 6.4 commits a second, about 3% of busy time (prior).
- Socket traffic, GC and timers (prior).
- The JS bookkeeping of the shadow registry. `shadowBench.mts` puts 13 hand cards moving over 56
  rects (copying, shape strings, clusters, path building, shade shape) at **0.21 ms a frame with
  JIT**, about 0.8 ms at 4x. This is measured. It is not the cost. The cost is what Skia does with
  the result.
- Blend modes and box-shadows on 39 backs. In the synthetic test each moved fps by only 2-5, which
  is within the noise (measured).

---

## The top 5 structural causes, ranked by expected frame-time impact

### 1. The felt is a live full-screen renderer that never stops, and its cache misses on every turn in a 4-player game

**Evidence**

- The sway never ends, and the felt redraws on every frame of it:
  - `lampRig.ts:173-176`: `sway = sin(ph) * 20`.
  - `lampRig.ts:125`: moved threshold of 0.01 pt.
  - `useLampRig.ts:37`: `lamp.modify(undefined, true)` every frame.
  - `feltCanvas.tsx:417-442,467-513`: the felt's readers and its draw list.
- During a glide the cache is not used at all:
  - `feltCanvas.tsx:409-410`: `cloth` is `null` while `aim === ""`.
  - `feltCanvas.tsx:494`: the felt then falls back to the live procedural cloth shader, full screen
    and per pixel (about 14 `sin` and 3 `pow` per pixel, per REPORT §6).
  - The glide lasts about 2 s after every turn. Bots think for 1200 ms (`turnSchedule.ts:38`), so in
    a round the lamp rarely settles. The felt spends most of play on the live shader.
- When the lamp does settle, it bakes, and in a 4-player game every bake is a miss:
  - The bake happens synchronously inside a `useMemo`, during render (`feltCanvas.tsx:409-416`).
  - Each bake renders two full-device-pixel cloths, one per sway end, each on its own offscreen
    surface (a WebGL context on web). Each is then copied off the GPU (`makeNonTextureImage`,
    line 334) and read back (`litAtCentre`, line 311).
  - The cache holds `CACHED_TARGETS = 3` targets (line 304). Four seats taking turns in order thrash
    a 3-entry LRU.
  - **Measured with `lru.mjs`:** 4 seats bake 2.00 cloths per turn, a 100% miss rate. 3 seats bake
    0.03 per turn and 2 seats 0.02.

**Why the tickets did not fix it.** The bake (#1959), the sway crossfade (`bf05f4cc`) and the cache
sizing (`da39ff80`) all assume the lamp is at rest. In play it almost never is.

**Durable fix: stop animating the felt as a raster at all.**

- Bake the cloth once per felt colour, unlit and at its final resolution.
- Bake the lamp pool once, as a soft radial light texture, a single small image.
- Draw the light as that texture under a compositor transform (translate and opacity), blended
  over the cloth.
- The turn glide and the sway then become a `transform` on one layer. No shader runs, no bake
  happens, and no full-screen replay is needed.
- Move the rail's soft-light and coat highlights into the same light layer, or bake them.

If one shader pass is kept, cap the felt at DPR 1-1.5. Cloth noise at DPR 3 is invisible. Also drop
the per-frame `flareColors` string building and the always-on `uniforms` derived value.

The sway itself should either stop when the table settles, or run on the compositor only.

### 2. Too many full-viewport surfaces, stacked and composited every frame

**Evidence: the surfaces in the table**

- The Skia felt (`GameTable.tsx:941`, `feltCanvas.tsx:467`), at DPR 3.
- A second full-viewport Skia canvas for the hand shade (`GameTable.tsx:951`,
  `handShadeCanvas.tsx:124`). On web this is a second CanvasKit WebGL context.
- The particle canvas (`GameTable.tsx:954`): 2D at DPR 1 on web, a third Skia canvas on native.
- The fallback felt canvas, until Skia is ready (`feltSkia.web.tsx:63`).
- Between these sit about 950-1050 DOM nodes with about 150 transformed (`docs/WEB-PERF.md`
  baseline).

**Evidence: the synthetic test (`composite.cjs`, measured, 4x CPU, DPR 3, software GL, relative
only)**

| Case | fps |
|---|---|
| Empty page | 60 |
| 1 full-viewport canvas redrawn each frame, DPR 1 backing | 60 |
| 1 full-viewport canvas redrawn each frame, DPR 3 backing | **32-34** |
| 3 full-viewport canvases, 1 redrawn each frame | 28 |
| 3 full-viewport canvases, all redrawn | **14-15** |

The repo's own trace agrees (prior). `LayerTreeHost::DoUpdateLayers` was 13.6 s of a 47 s round,
and `WaitForGetOffset` (synchronous readback) was 5.1 s.

**Durable fix: one surface for all static table art.** Felt, rail, cloth and resting card shadows
become a single image, baked once per layout and felt.

- **Moving light:** one small compositor layer (see cause 1).
- **Particles:** draw into the same canvas as anything else dynamic, at DPR 1, and only while
  something is live. Ambient motes should be a CSS or compositor animation of a few small sprites,
  or nothing at all at rest.
- **Hand shade:** delete the canvas. Card-on-card contact shadows belong to the card sprite (cause 4).

Target: at rest, zero surfaces repainted per frame. During play, at most one small surface.

### 3. Per-card layer and mapper count: cost is additive per card, and the backs pay the most

**Evidence**

- **A face card** has a Pressable, a box, a stock image (2-3 nodes on web), an SVG of suit marks,
  court art, 2 text nodes and a level shade, plus the hand wrapper with glow, halo and veil views
  (`CardView.tsx:530-580`, `hand.tsx:451-510`).
- **Per hand card** (`hand.tsx:244-447`):
  - about 10 shared values
  - 3 animated reactions
  - 5 `useAnimatedStyle`: `aStyle`, `halo`, `giveable`, `glow`, `veil`
  - 1 registry publish mapper, created with `makeMutable` and `startMapper` inside a layout effect
  - 1 level-shade style
- **Per opponent back** (`CardView.tsx:464-467`, `LampGloss.tsx:43-131`):
  - lamp gloss: a spot image and a streak `LinearGradient`, 2 mappers
  - foil glint: a CSS `mask-image` with `mix-blend-mode: screen` (`FoilMask.web.tsx:18`), 1 derived
    value and 2 mappers
  - level shade: 1 mapper
  - Across 39 backs that is **about 230 mappers and 39 masked blend layers** for card backs that do
    not change.
- **When those mappers run.** Fans read `stillLight`, which steps every 2 pt while the lamp glides,
  at up to one step per 12 ms (`cardGloss.ts:26,29`). So all of them re-run nearly every frame for
  about 2 s after every turn. That is the same window in which the felt is on the live shader
  (inferred).
- Fan rects also re-publish on every `motion` change (`useCardRects.ts:153`, `seats.tsx:158`).
- **Mount cost.** Mounting a hand was a 327 ms long task, 173 ms of it React render (prior,
  REPORT §7). Each new pile card mounts the same stack, mid-play.
- On web, every mapper is main-thread JS (Reanimated has no UI thread there), competing with React
  and CanvasKit.

**Durable fix: render cards from an atlas.**

- Bake every face and every back once into a texture atlas: art, indices, court art, foil, edge and
  shadow.
- Draw a card as **one node**, a single image or sprite carrying one transform, or draw all table
  cards in one Skia/WebGL pass with `drawAtlas` and one RSXform per card.
- The lamp's gloss becomes one shared overlay, a single light layer clipped to the card silhouettes
  or simply drawn over the table. It is not 2-5 animated layers per card.
- Opponent backs need no per-card gloss at all. A fan of 13 can be one pre-composited image per
  card count.
- Interactive hand cards keep a thin hit-target view, but carry no visual children beyond the sprite.

### 4. Shadows are a second rendering of every card, rebuilt whenever any card moves

**Evidence**

- Every card writes its pose into a global registry (`useCardRects.ts:111,118`). The pose is
  computed in design space and includes the table's kick and shake (`cardRects.ts:54-70`).
- The felt then rebuilds shadow shape strings, clusters, `SkPath`s and blurred pictures from that
  registry (`feltCanvas.tsx:437-440`).
- `HandShadeCanvas` re-records a clip-and-blur picture per card (`handShadeCanvas.tsx:81-99`).
- So each moving card is paid for three times: its DOM transform, its registry publish, and its
  Skia path rebuild, blur and canvas replay.
- **Deals, re-fans, flights and the hand lift** change many rects on every frame. **A bomb or round
  kick** changes all of them, fans included.
- The JS half is cheap (0.21 ms a frame, measured). The raster half is the cost: blur mask filters
  on freshly built arbitrary paths are not cacheable (inferred).
- **On the web fallback felt** (SwiftShader, or before CanvasKit loads), the shadow is CSS instead:
  - `useCardCast` returns a new `{x, y}` whenever the lamp's aim moves (`feltReady.ts:38-39`), and
    `GameTable.tsx:786` feeds it from `lampAim`.
  - Every `CardView` reads that context (`CardView.tsx:448`), which bypasses `React.memo`.
  - So **every turn re-renders all ~55 CardViews and repaints a 2-layer blurred `box-shadow` on
    each** (inferred).
  - This is the path `perf:web` measures, and it lines up with `round-4x`: 410 long tasks and
    28.6 s of long-task time (prior).

**Durable fix: make the shadow part of the card.**

- Pre-bake a blurred contact and drop shadow into the atlas sprite, or use a 9-slice shadow image
  under each card.
- Moving the card then moves its shadow with the same transform.
- The lamp-direction offset of the cast shadow becomes one transform per card group, not a rebuild.
- Delete the registry, `useShadowPicture`, `useGlow` and `HandShadeCanvas`.
- If card-on-card shading must stay, bake it per resting layout and crossfade. Do not rebuild it
  per frame.

### 5. Nothing is ever idle, the harness cannot see it, and 120 Hz doubles it

**Evidence**

- The always-on loops:
  - the lamp frame callback (`useLampRig.ts:78`)
  - the link-hold frame callback (`useLinkHold.ts:50`), registered even when nothing is greyed
  - the particles at 30 Hz while motes exist (`particleSprites.ts:168`)
  - the seat's breathe loop while a seat waits (`seats.tsx:456`)
- The 120 Hz unlock (`app.json:15`) doubles the per-second cost of each continuous redraw from
  causes 1 and 2 on iPhone.
- The harness measures a different table. `perf:web` runs on SwiftShader, so `drawsOnGpu()` is false
  (`feltSkia.web.tsx:24-38`). The Skia felt (cause 1) and the hand shade (causes 2 and 4) then
  never mount. Every `perf:web` row after #1968 was therefore taken without the two most expensive
  renderers that a player with a GPU, or on native, actually gets. REPORT §6 measured the Skia table
  at about 1.2 fps on SwiftShader, and nothing has re-measured it on a GPU.

**Durable fix**

- **Define a resting state.** When nothing is moving, no frame callback is registered, no canvas
  redraws, and no mapper runs. Sway, motes and breathing become compositor-only (CSS or
  `transform`/`opacity` on one small layer), or stop after a few seconds idle.
- **Gate idle cost with a test.** Assert zero rAF-driven paints over a settled 2 s window, via CDP
  paint or layer events, or by counting frame-callback ticks.
- **Measure the real renderer.** Run `perf:web` with a GPU (`--use-angle=gl`, `--enable-gpu` on a
  GPU runner) or force the Skia path (`murlanSkiaOnSoftware` already exists under E2E).
- Take the device row `docs/WEB-PERF.md` asks for before claiming any of the fixes above.

---

## Smaller items

These are real but not structural.

- `GameTable` is 1,355 lines with about 60 hooks and is not memoized.
  - The adapters pass inline `matchScore`/`matchActions`/`onQuit` (`app/game.tsx:42-80`).
  - `HandRow` gets inline `deal`/`geometry`/`exchange`/`selection` objects (`GameTable.tsx:1289-1297`).
  - React Compiler (`app.json:72`) has to memoize all of these. The comments show it bailing out
    before (`GameTable.tsx:449-451`).
  - Worth a build-time check that GameTable compiles. The cost is small at play rate (prior).
- The fallback felt's cache refuses bakes over 4 Mpx (`feltFallback.tsx:107`). A desktop at
  1920x1080 and DPR 2 never caches, so it bakes about 220 ms on every turn, which matches
  REPORT §3.
- The native particle Atlas runs 3 × 200 buffer worklets per stepped frame, whatever the live count
  (`particleLayer.tsx:182-201`).

## Suggested order of work

1. Felt as a static bake plus a moving light layer (cause 1). This removes the live shader, the
   bakes, the readbacks and the per-frame full-screen replay at once.
2. Shadows baked into card sprites; delete the registry and `HandShadeCanvas` (cause 4). This also
   removes the second canvas from cause 2.
3. Card atlas, one node per card, no per-card gloss, foil or blend (cause 3).
4. A resting state with a zero-paint idle test, and a GPU-path perf run (cause 5).
