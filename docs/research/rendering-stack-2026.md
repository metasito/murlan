# Rendering, effects and motion stack — research pass, August 2026

Research-only document for a planning session. Nothing here was implemented. All package
metadata was read live from `registry.npmjs.org` / `api.github.com` / `cdn.jsdelivr.net` on
**2026-08-20**; docs and issues were fetched from their primary hosts on the same date.
Anything I could not confirm against a primary source is collected under
[Explicitly unverified](#explicitly-unverified) and flagged inline as **[UNVERIFIED]**.

---

## Bottom line

- **Do not adopt Skia for the web build.** The CanvasKit WASM blob that
  `setup-skia-web` copies (`canvaskit-wasm/bin/full/canvaskit.wasm`) is **8,076,553 bytes raw
  / 3.24 MB gzip / 3.18 MB brotli** (measured, canvaskit-wasm 0.41.0). This repo's *entire*
  current web JS bundle is **753 KB gzipped** (`dist/_expo/static/js/web/entry-*.js`, measured
  from the checked-in build). Skia would multiply the download for the primary user surface by
  ~5x, as an extra blocking fetch that must resolve before the first Skia frame. For a browser
  card game on mobile data, that is the wrong trade.
- **Skia is still worth considering as a native-only, code-split island** (`Platform.select` /
  `.native.tsx`) *if and only if* a specific effect genuinely needs SkSL. On SDK 54 that means
  pinning `@shopify/react-native-skia@2.9.1` (2026-07-22) — the last release whose peers don't
  demand `react-native-worklets >= 0.7.0`. My recommendation is to **not do this yet**: nothing
  currently on the wishlist requires a shader.
- **Most of the "high-end" list is reachable without Skia**, and on web specifically it is
  reachable *for free*, because `react-native-svg` emits real `<svg>` DOM on web and CSS
  `filter` / `mix-blend-mode` / gradients / `mask` are available through style props. Glow,
  bloom, blur, drop shadows, gradients on paths, text on path, per-card lighting ramps and felt
  noise are all doable today. See the [capability matrix](#2-what-skia-actually-buys).
- **Skip Rive. Skip Lottie for now.** Rive has *two separate runtime families* (native Nitro
  modules vs `@rive-app/react-canvas` on web) with no shared code path — that structurally
  breaks the one-codebase property. `lottie-react-native@7.4.0` (2026-08-05) hard-requires
  `react >= 19.2` / `react-native >= 0.84`; this repo is on 19.1.0 / 0.81.5, so the ceiling is
  `7.3.8`, and its web path is a second separately-versioned package.
- **Skip the confetti libraries too.** The maintained one (`react-native-fast-confetti@2.0.2`)
  is Skia-based and therefore drags in the WASM. The popular one
  (`react-native-confetti-cannon@1.5.2`) last shipped **2021-03-03**. A burst is ~40 `<View>`s
  with `transform`/`opacity` on shared values — write it, don't depend on it.
- **The highest-value, lowest-risk work is not a new library at all.** In priority order:
  (a) keep every animated property to `transform`/`opacity` and keep the count of
  *simultaneously animating* nodes well under 100 (Software Mansion's own documented ceiling);
  (b) cut per-card SVG node count via shared `<Defs>`/`<Use>` or by rasterising static card
  faces once; (c) close the profiling gap — Expo's Performance Monitor and DevTools Profiler
  are **native-only**, so the platform most users are on has no first-party profiler;
  (d) plan the Expo SDK 54 → 57 upgrade, because SDK 54 shipped 2025-09-10 and **SDK 57 is
  current** (57.0.15), and almost every modern version of every library discussed here has
  moved past RN 0.81.

---

## 0. Baseline: where this repo actually sits

Read from `package.json` and from Expo's `bundledNativeModules.json` for `sdk-54`.

| Package | This repo | Expo SDK 54 pin | Latest on npm (2026-08-20) |
|---|---|---|---|
| `expo` | `~54.0.37` | — | **57.0.15** (`sdk-54` tag: 54.0.37) |
| `react-native` | `0.81.5` | 0.81.x | RN 0.87 line current |
| `react` | `19.1.0` | 19.1.0 | 19.2+ |
| `react-native-web` | `^0.21.0` | `~0.21.0` | **0.21.2** (2025-10-16) |
| `react-native-reanimated` | `~4.1.1` | `~4.1.1` | **4.5.3** (2026-07-22) |
| `react-native-worklets` | `0.5.1` | `0.5.1` | **0.11.4** / next 0.12.1 |
| `react-native-svg` | `15.12.1` | `15.12.1` | **15.15.5** (2026-05-11) |
| `@shopify/react-native-skia` | *(absent)* | `2.2.12` | **2.11.0** (2026-08-06) |

Expo SDK release dates (first stable of each major, from the npm `time` map):
53.0.0 — 2025-04-28 · **54.0.0 — 2025-09-10** · 55.0.0 — 2026-02-25 · 56.0.0 — 2026-05-20 ·
57.0.0 — 2026-06-30.

**This repo is roughly one year and three SDK majors behind.** That single fact constrains
almost every library choice below, and is worth costing separately.

Measured current web payload (from the checked-in `dist/`, `expo export --platform web`):

| File | Raw | gzip -9 |
|---|---|---|
| `_expo/static/js/web/entry-*.js` | 2,970,147 B | **753,240 B** |
| `_expo/static/js/web/index-*.js` | 132,145 B | 35,008 B |
| `dist/` total | 3,667,146 B | — |

Measured current card face structure (`components/CardView.tsx`, `components/cardFaceModel.ts`):
**one `<Svg>` per card face**, containing the pip field plus two corner index marks. Each
`SuitMark` is a `<G>` wrapping 1 `<Path>` (hearts/diamonds/spades) or 3 `<Circle>` + 1 `<Path>`
(clubs). So a 10 of hearts is ≈ 1 + 12×2 ≈ **25 SVG nodes**; a 10 of clubs is ≈ 1 + 12×5 ≈
**61 nodes** — clubs and spades-heavy hands are the worst case. Court cards are a PNG sibling
and are cheap. Card backs are cheap. This is already a fairly tight structure — it is *not* a
naive "one self-contained SVG document per card" design, which is the usual disaster case.

---

## 1. `@shopify/react-native-skia` in 2026

### Versions and dates

`dist-tags`: `latest = 2.11.0`, `next = 2.12.0-next.1`. License **MIT**.

| Version | Published | `canvaskit-wasm` dep | Peer deps |
|---|---|---|---|
| 2.2.12 | 2025-09-09 | 0.40.0 | `react >=19.0`, `react-native >=0.78`, `react-native-reanimated >=3.19.1` |
| 2.9.1 | 2026-07-22 | 0.41.0 | same as above |
| 2.10.0 | 2026-07-23 | 0.41.0 | **adds `react-native-worklets >=0.7.0`**, `react-native-reanimated >=4.0.0` |
| 2.11.0 | 2026-08-06 | 0.41.0 | as 2.10.0 |

Recent release themes (github.com/Shopify/react-native-skia/releases): 2.10.0 "migration from
host objects to native states"; 2.10.1 "Skia Graphite WebGPU migration"; 2.11.0 upgrades to
Skia m152 and adds driving multiple animated props from one shared value.

### Compatibility with *this* stack

- **RN 0.81 / Expo SDK 54: yes.** Skia's RN floor is `>=0.78`. Expo's SDK 54 manifest pins
  `@shopify/react-native-skia: 2.2.12`, so `npx expo install` gives you an ~11-month-old build.
- **The worklets wall.** Skia ≥ 2.10.0 requires `react-native-worklets >= 0.7.0`. This repo has
  `0.5.1`. Per Reanimated's own compatibility table
  (docs.swmansion.com/react-native-reanimated/docs/guides/compatibility), **Reanimated 4.1.x is
  compatible with worklets 0.5.x, 0.6.x, 0.7.x and 0.8.x** — and `react-native-worklets@0.8.3`
  (2026-05-04) declares `react-native: "0.81 - 0.85"`. So there *is* a path to Skia 2.11 on
  SDK 54: bump worklets to 0.8.3 while holding Reanimated at 4.1.1. It diverges from Expo's
  pinned set (`expo install --check` will flag it) and I have **not** verified that Reanimated
  4.1.1 behaves correctly against worklets 0.8.3 in practice — **[UNVERIFIED]**.
- **The safe alternative on SDK 54** is `@shopify/react-native-skia@2.9.1` (2026-07-22), the
  last release with no worklets peer floor. Whether 2.9.1 *internally* calls worklets APIs newer
  than 0.5.1 provides is **[UNVERIFIED]** — worth a spike before committing.
- **Expo Go: yes.** Expo's own docs list `@shopify/react-native-skia` platforms as
  `['android','ios','tvos','web','expo-go']` with `inExpoGo: true`
  (docs.expo.dev/versions/latest/sdk/skia).
- **New Architecture / Fabric: yes.** Skia 2.x is Fabric/TurboModules-native; the project's own
  messaging cites ~50% faster on iOS and ~200% faster on Android vs 1.x.

### The web story — the decisive part

Source: shopify.github.io/react-native-skia/docs/getting-started/web.

Skia on web runs **CanvasKit**, a WebAssembly build of Skia. The docs' own figure is
"**2.9MB when gzipped**", which matches the *slim* `bin/canvaskit.wasm`. But
`packages/skia/scripts/setup-canvaskit.js` — the script the docs tell you to run — copies
**`canvaskit-wasm/bin/full/canvaskit.wasm`**, not the slim one. Measured over jsDelivr:

| Build (`canvaskit-wasm@0.41.0`) | identity | gzip | brotli |
|---|---|---|---|
| `bin/canvaskit.wasm` (slim) | 7,155,822 B | 2,894,418 B | 2,841,156 B |
| **`bin/full/canvaskit.wasm`** (what the setup script copies) | **8,076,553 B** | **3,243,559 B** | **3,177,276 B** |
| `bin/full/canvaskit.wasm` @ 0.40.0 (the SDK-54 pin) | 8,001,100 B | 3,190,039 B | 3,123,889 B |

Plus `canvaskit.js` (~0.12 MB raw) as the loader.

**So: ~3.2 MB gzipped extra, versus a 753 KB gzipped app today.** That WASM does *not* go
through Metro — the setup script drops it in `public/`, so `expo export --platform web` ships it
as a static asset fetched at runtime. Skia frames cannot render until it resolves.

Mechanics and gotchas:

- Load with `<WithSkiaWeb getComponent={() => import(...)} fallback={...} />` (code-splitting) or
  `LoadSkiaWeb().then(...)` before `AppRegistry.registerComponent`. Both mean a
  **loading state before any Skia pixel appears** — you would be designing around it, not
  around it being instant.
- Recommended wiring is `"postinstall": "npx setup-skia-web public"`, re-run on every Skia
  upgrade.
- **react-native-web**: Skia's docs say it "can be used on projects without the need to install
  React Native Web" — i.e. RNW is neither required nor a blocker. I found **no** statement
  either way about RNW **0.21** specifically — **[UNVERIFIED]**.
- **Metro + Node builtins**: a recurring failure is
  `node_modules/canvaskit-wasm/bin/full/canvaskit.js` trying to import Node's `path`/`fs` under
  Metro. Tracked across Shopify/react-native-skia issues #1243, #1774, #2192 and #2484
  ("Expo Web doesn't work in development mode", opened 2024-06-14, now **closed**, resolution
  not clearly stated in the thread). The community fix is either the `with-skia` Expo template
  or overriding `browser` fields to stub `fs`/`path`/`os`. This is friction, not a wall — but it
  is friction in the pipeline that serves your production users.
- **WebGL context limit**: browsers cap ~16 WebGL contexts per page. Skia offers
  `__destroyWebGLContextAfterRender` on `<Canvas>` to mitigate, at a performance cost for
  animated canvases. A card table with one canvas is fine; a canvas per card is not.
- **Four APIs are unsupported on web**: `PathEffectFactory.MakeSum()`,
  `PathEffectFactory.MakeCompose()`, `PathFactory.MakeFromText()`, `ShaderFilter`.
  `MakeFromText` is notable — text-to-path is a native-only capability.

### Verdict on question 1

**Skia on web is technically viable and functionally excellent, and economically wrong for this
app.** A 3.2 MB gzip payload gate in front of the primary platform, for effects that are mostly
achievable in the DOM, is not a trade a browser-first card game should take. The defensible
shape, if Skia is ever adopted, is a **native-only island**: Skia behind `.native.tsx`, with an
SVG/CSS equivalent on `.web.tsx`. That costs two implementations of every effect — which is
itself a reason to look hard at option 2 first.

---

## 2. What Skia actually buys

Legend: **RNS** = `react-native-svg` 15.x · **CSS** = plain style props on react-native-web ·
**Rea** = Reanimated 4.

`react-native-svg`'s implemented filter primitives (github.com/software-mansion/react-native-svg
`USAGE.md`): `FeBlend`, `FeComposite`, `FeColorMatrix`, `FeDropShadow`, `FeFlood`,
`FeGaussianBlur`, `FeMerge`, `FeOffset`. **Not implemented on native**:
`FeComponentTransfer`, `FeConvolveMatrix`, `FeDiffuseLighting`, `FeSpecularLighting`,
`FePointLight`, `FeSpotLight`, `FeDisplacementMap`, `FeMorphology`, `FeTile`, `FeTurbulence`,
`FeImage`. Masks, `ClipPath`, `Pattern`, `LinearGradient`, `RadialGradient`, `Use`/`Defs`/
`Symbol`, `TextPath` and markers are all supported. Crucially, **the filter gaps are stated as
native-platform gaps — on web the browser's own SVG filter engine runs**, so on your primary
platform the full SVG filter spec is in reach.

| Effect | Skia | RNS (native) | RNS (web) | CSS on web | Honest verdict |
|---|---|---|---|---|---|
| Linear/radial gradient on an arbitrary path | ✅ | ✅ | ✅ | partial | **Not a Skia-only feature.** Already have it. |
| Conic / sweep gradient | ✅ `SweepGradient` | ❌ | ❌ | ✅ `conic-gradient()` | Skia-only *on native*. |
| Gaussian blur | ✅ `<Blur>` | ✅ `FeGaussianBlur` | ✅ | ✅ `filter: blur()` | Not Skia-only. |
| Drop shadow / glow | ✅ `<Shadow>` | ✅ `FeDropShadow` | ✅ | ✅ `filter: drop-shadow()` | Not Skia-only. **Glow = blur + additive blend of a coloured copy.** |
| Bloom (blur + additive composite) | ✅ trivially | ⚠️ `FeGaussianBlur`+`FeBlend`/`FeComposite` | ✅ | ⚠️ `mix-blend-mode: screen` on a blurred layer | Achievable both ways; Skia is *much* nicer to author. |
| Backdrop blur (frosted panel) | ✅ `<BackdropFilter>` | ❌ | ❌ | ✅ `backdrop-filter` (+ RN `BlurView`) | Skia-only via SVG; web has it natively but it is **expensive** (see §7). |
| Procedural noise / felt texture | ✅ `Turbulence`, `FractalNoise`, SkSL | ❌ (`FeTurbulence` unimplemented) | ✅ (browser `feTurbulence`) | ⚠️ | **Skia-only on native.** On web, `feTurbulence` works — or ship a tiling PNG, which costs ~15 KB and works everywhere. |
| Arbitrary runtime shader (SkSL) | ✅ `RuntimeEffect.Make` | ❌ | ❌ | ❌ (WebGL/WebGPU only) | **Genuinely Skia-only.** This is the real differentiator. |
| Per-card lighting / specular sheen | ✅ shader or `Fe*Lighting` | ❌ | ✅ (`feSpecularLighting`) | ⚠️ moving gradient overlay | A moving `LinearGradient` overlay with `mix-blend-mode: overlay` gets 80% of it. |
| Text on a path | ✅ | ✅ `TextPath` | ✅ | ✅ SVG | Not Skia-only. |
| Image filters / colour matrix | ✅ | ✅ `FeColorMatrix` | ✅ | ✅ `filter: hue-rotate/saturate` | Not Skia-only. |
| Thousands of sprites in one draw call | ✅ `<Atlas>` / `drawAtlas` | ❌ | ❌ | ❌ | **Skia-only.** Docs' own example draws 150 rects; "transforms can be animated with near-zero cost using worklets". No published upper bound. |
| Cache a complex drawing as a GPU texture | ✅ `useTexture`, `usePictureAsTexture`, `Skia.Surface.MakeOffscreen()` + `makeImageSnapshot()` | ❌ (no evidence of internal caching; issue #2739 suggests the opposite on one backend) | ⚠️ `will-change: transform` | Skia's story here is genuinely better on native. |
| Particle emitter | ✅ (build on `<Atlas>`) | ⚠️ N `<View>`s | ⚠️ | ⚠️ | Nobody ships a "Skia particle library" — it's a technique. |

**Summary.** The only capabilities that are *actually* Skia-exclusive and relevant here are
**(a) SkSL runtime shaders, (b) `drawAtlas` for very large sprite counts, and (c) GPU texture
caching.** Everything on the "glow / bloom / blur / gradient / text-on-path / colour grading"
wishlist is already reachable with `react-native-svg` + CSS, especially on web where the browser
does the filtering. Given the effect list you'd realistically ship for a card game — card slam
impact, a gold sheen sweep on a bomb, a win burst, a felt texture, a glow on the playable set —
**none of them require (a), (b) or (c).**

---

## 3. Particle / burst effects in RN, 2026

All figures from the npm registry and GitHub API, 2026-08-20.

| Package | Latest | Published | Weekly DL | Stars | Status | Web? |
|---|---|---|---|---|---|---|
| `react-native-confetti-cannon` | 1.5.2 | **2021-03-03** | 121,678 | 529 | Dormant (last push 2023-08-10), 25 open issues; New Arch **unverified** | ✅ (plain `Animated`/View) |
| `react-native-fast-confetti` | **2.0.2** | 2026-07-17 | 63,159 | 568 | Healthy, 0 open issues | ⚠️ via Skia/CanvasKit only |
| `react-native-reanimated-confetti` (marcuzgabriel) | 1.3.1 | 2024-10-15 | low | 17 | Alive-ish (push 2024-11-06) | ✅ pure Reanimated |
| `react-native-reanimated-confetti` (felippepuhle) | — | — | — | 75 | **Archived** | — |
| `@hikaaam/react-native-reanimated-confetti` | 0.1.9 | 2025-11-20 | low | small | Too new to judge | ✅ claimed |
| `react-native-particles` | 0.0.8 | **2019-11-26** | — | — | **Dead** | — |
| `canvas-confetti` | 1.9.4 | 2025-10-25 | 5,922,927 | 12,707 | Healthy | **Web-only** |
| `tsparticles` / `@tsparticles/react` | 4.3.2 | 2026-07-10 | 100k / 192k | 8,960 | Healthy | **Web-only** |
| `react-tsparticles` | 2.12.2 | 2023-08-11 | — | — | Superseded | — |

**`react-native-fast-confetti@2.0.2` peer deps are the blocker:**
`@shopify/react-native-skia >=2.0.0 <3`, `react-native-reanimated >=4.1.0 <5`,
`react-native-worklets >=0.7.0 <1`. Reanimated clears; **worklets 0.5.1 does not**. Adopting it
means the worklets bump *and* the whole Skia/CanvasKit web payload from §1 — for a two-second
one-shot effect.

**`canvas-confetti` / `tsparticles`** cannot be used through the RN view tree at all. They'd need
a `.web.tsx` split rendering a raw `<canvas>`, doing nothing on native. That's two
implementations, which is the same cost as writing the Reanimated one — with an extra dependency.

There is **no maintained standalone "Skia particle system"** package. Skia's docs cover the
primitives; particle effects are built on `<Atlas>` + `useRSXformBuffer` by hand.

**Recommendation:** roll a small `Burst`/`Confetti` component on `react-native-reanimated` +
`View` (or `react-native-svg` if you want shaped confetti). ~40 nodes, each animating only
`transform` and `opacity`, driven off one shared clock. Identical on web and native, no new
dependency, no peer-dep conflict, respects the existing reduce-motion plumbing.
`react-native-reanimated-confetti` (marcuzgabriel, 1.3.1) is a reasonable *reference*, not a
dependency worth taking at 17 stars.

---

## 4. Rive vs Lottie in 2026

### Rive

Rive ships **two parallel RN packages** right now:

| Package | Latest | Published | Weekly DL | Stars | Open issues |
|---|---|---|---|---|---|
| `rive-react-native` (legacy) | 9.8.5 | 2026-07-17 | 94,892 | 783 | **99** |
| `@rive-app/react-native` (Nitro, "Rive React Native 2.0") | 0.4.20 | **2026-08-19** | 57,103 | 151 | 19 |

`@rive-app/react-native` peers `react-native-nitro-modules >=0.35.10 <0.36`, requires RN 0.78+
(0.79+ recommended), Expo SDK 53+, iOS 15.1+, Android SDK 24+. The legacy package still
out-downloads the successor — migration is mid-flight, not done.

**Web is a separate product.** Neither RN package's docs mention `react-native-web` or Expo web.
Rive's web runtimes are distinct packages: `@rive-app/react-canvas` **4.32.0** (2026-08-17,
837,727 DL/wk), `@rive-app/canvas` **2.40.0** (2026-08-14), `@rive-app/webgl2` **2.40.0**.
There is no RNW aliasing path — you would hand-write a `.web.tsx` split and duplicate all
loading and state-machine control code.

**Pricing** (rive.app/pricing, fetched 2026-08-20): Free $0 (3 collaborative files, 1 project,
1 workspace, 10 MB per imported asset) · Cadet $9/seat/mo annual ($17 monthly) · Voyager
$32/seat/mo · Enterprise $120/seat/mo. **Runtimes are free with no runtime fee**; the
`rive-app/rive-runtime` repo is **MIT**. So a solo dev can ship at $0 — the paywall is on
*editor collaboration*, not distribution.

**Expo Go:** both packages ship native binaries, so a dev/EAS build is required. I found no
explicit "not in Expo Go" statement to quote — **[UNVERIFIED]**, but architecturally certain.

### Lottie

`lottie-react-native` **7.4.0**, published **2026-08-05**. 17,202 stars, 16 open issues, last
push 2026-08-17, **1,176,120 downloads/week** — by far the most-used option surveyed.
License Apache-2.0.

**Hard blocker for this repo:** 7.4.0's peers are `react: ">=19.2"`, `react-native: ">=0.84"`.
This repo is on **19.1.0 / 0.81.5** — both fail. The peer floors by version:

| Version | Published | `react` peer | `react-native` peer |
|---|---|---|---|
| 7.1.0 | 2024-11-01 | `*` | `>=0.46` |
| 7.3.3 | 2025-08-28 | `*` | `>=0.46` |
| **7.3.8** | 2026-05-14 | `*` | `>=0.46` |
| 7.4.0 | 2026-08-05 | `>=19.2` | `>=0.84` |

So today the ceiling is **7.3.8**.

**Fabric / New Architecture:** supported since v6.0.0 (PRs #955, #910), with follow-up fixes as
recent as 7.2.4. Mature, not experimental.

**Web:** `lottie-react-native` declares `@lottiefiles/dotlottie-react` as a **peer** dependency
(since 7.1.0) and the README has a dedicated Web install section — i.e. web renders through a
*separate, separately-versioned* package. That seam has drifted before:
expo/expo#38583 ("lottie-react-native not compatible on web with Expo 53") was a React-19 peer
conflict inside `@lottiefiles/dotlottie-react`, since patched. A community shim
(`react-native-web-lottie`) exists, which is itself a signal.

**Alternative:** `@lottiefiles/dotlottie-react-native` **0.12.1** (2026-07-30), 31,821 DL/wk,
48 stars — LottieFiles' own newer runtime, architecturally more coherent (explicit RNW support
via `@lottiefiles/dotlottie-react`, Paper/Fabric interop bridge), far less adoption.

`react-native-skottie` (Skia-based Lottie player) is **stale**: 2.1.4, last published
**2024-05-06**.

### Verdict on question 4

- **Card slam impact** — Reanimated. It's timing-critical and already derived in one place
  (`impactDelayMs()` in `components/gameTableModel.ts`). A baked animation player is the wrong
  tool; you'd lose the ability to drive it off the actual landing time.
- **Win celebration** — Reanimated (see §3). A Lottie confetti `.json` is a real, common
  pattern, but it costs a dependency and a web seam for something you can express in 60 lines.
- **Animated mascot / avatar** — this is the *only* case with a real argument for a
  state-machine runtime, and it's speculative. If it ever ships, **Lottie over Rive for this
  repo**: Fabric-mature, Apache-2.0, no editor paywall, an order of magnitude more
  battle-tested, and its web gap is a patchable peer-dep issue rather than Rive's structurally
  separate runtime families. **Pin 7.3.8** until RN ≥ 0.84 / React ≥ 19.2.

---

## 5. Reanimated 4 specifics

- **4.0.0 stable shipped 2025-07-23** and **requires the New Architecture (Fabric)** — no
  old-arch fallback. Reanimated 3 is no longer actively maintained
  (docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started).
- **Worklets package split.** `react-native-worklets` is now a separate install "for better
  modularity". Its first release was 2025-03-10; `latest` is now 0.11.4 (2026-08-12) with
  0.12.1 on `next`.
- **Compatibility matrix** (docs.swmansion.com/.../guides/compatibility) — the table that
  matters for planning:

  | Reanimated | RN range | worklets range |
  |---|---|---|
  | 4.0.x | 0.78–0.81 | 0.4.x |
  | **4.1.x** *(this repo)* | **0.78–0.82** | **0.5.x – 0.8.x** |
  | 4.2.x | 0.80–0.84 | 0.7.x – 0.8.x |
  | 4.3.x | 0.81–0.85 | 0.8.x |
  | 4.4.x | 0.83–0.86 | 0.9.x – 0.10.x |
  | 4.5.x | 0.83–0.86 | 0.10.x – 0.11.x |
  | 4.6.x | 0.83–0.87 | 0.12.x |

  Two consequences: **you can move worklets from 0.5.1 to 0.8.3 without touching Reanimated**
  (which is what unlocks Skia ≥ 2.10 / `react-native-fast-confetti`), and **you cannot move
  Reanimated past 4.3.x without moving off RN 0.81**.

- **CSS Animations & CSS Transitions API** (new in 4.x). Confirmed present:
  `docs/css-animations/` ships `animation-name`, `animation-duration`, `animation-delay`,
  `animation-direction`, `animation-fill-mode`, `animation-iteration-count`,
  `animation-play-state`, `animation-timing-function`; `docs/css-transitions/` ships
  `transition-property`, `transition-duration`, `transition-delay`, `transition-timing-function`,
  `transition-behavior`, `pseudo-selectors`. The overview's own framing: *"Use CSS animations for
  self-contained, declarative motion… When you need frame-by-frame control (gesture-driven or
  scroll-driven motion, or animations orchestrated from live values), reach for the shared values
  API."*

  **What it does on web is the open question.** The name is borrowed, not the mechanism — the
  docs say *"The name comes from CSS on the web, where you declare keyframes under a named
  `@keyframes` rule"* but *"React Native has no global stylesheet to hold named rules, so instead
  of a name you pass the keyframes object directly."* Nothing in the docs claims it emits real
  browser `@keyframes` or gets compositor offload on web. Given the web-support page's blanket
  statement that on web *"all of the functionalities are implemented purely in JavaScript"*, the
  safe assumption is that it runs through the same JS/rAF path. **[UNVERIFIED]** — worth ten
  minutes in Chrome's Animations panel before betting a design on it.

  Where it *is* clearly useful regardless: `animation-play-state` and the declarative form make
  idle/ambient loops (a pulsing "your turn" ring, a shimmer) much less code than
  `withRepeat(withSequence(...))` chains, and pseudo-selector transitions cover hover/press
  states that currently need manual shared values.

- **Web execution model — the one that matters most here.**
  docs.swmansion.com/react-native-reanimated/docs/guides/web-support states plainly: on web
  *"all of the functionalities are implemented purely in JavaScript, hence the efficiency of the
  animations might be lower."* **There is no UI-thread equivalent on web.** Worklets run on the
  main JS thread via `requestAnimationFrame`. Every animation frame competes with React renders,
  socket message handling and layout. This has been true since Reanimated 2 and is unchanged.
- The docs *"strongly recommend not opting out of the Worklets Babel plugin, as it is the only
  configuration we actively test."* Without it you must hand-write dependency arrays for
  `useDerivedValue`, `useAnimatedStyle`, `useAnimatedProps`, `useAnimatedReaction`.
- **Known web/perf issues:** #7673 (opened 2025-06-19) — an unconditional
  `getBoundingClientRect()` on every animated-component render on web forces synchronous layout,
  measured at ~200 ms freezes; fix PR #7678 exists, **merge status into 4.x not confirmed —
  [UNVERIFIED]**. #8250 "huge performance loss in new arch with animated components" and #7480
  "performance on Fabric getting worse over time" as instance count grows are both open and
  apply to 4.x by construction.
- **Official ceiling:** Software Mansion's own performance guide advises **no more than ~100
  simultaneously animating components on low-end Android, ~500 on iOS**, and recommends pairing
  with Skia beyond that. Since web has no thread separation at all, treat web as *at least* as
  constrained as the low-end-Android figure.

---

## 6. Card rendering best practice

### What the techniques cost

- **Runtime SVG.** Scales losslessly, trivially themeable, but each face is a real DOM subtree
  on web. Concrete data point: the maintainer of **htdebeer/SVG-cards** (LGPL) reports a
  face-down 52-card deck rendering ~**50,000 DOM elements** and taking ~**2 seconds**, and
  recommends a simplified back specifically to cut node count. That's the failure mode this repo
  has *already avoided* — one `<Svg>` per face, ~25–61 nodes, not thousands.
- **Pre-rasterised sprite atlas.** Rasterise once at 2–3 DPI tiers, pack into one texture, draw
  from it. Unity's manual: an atlas lets the engine *"create one draw call for all the sprites"*.
  Cost model inverts: fixed rasterisation + fixed GPU memory regardless of on-screen count. A
  2048×2048 RGBA8 atlas is ~16 MB of GPU memory whether you draw 1 card or 54.
- **SDF glyphs.** Standard for crisp text/icons at arbitrary scale from a small texture (Valve,
  2007). Plausible for rank/suit glyphs. **No shipped card game confirmed doing this —
  [UNVERIFIED]**.
- **Playing-card glyph fonts.** No modern production example found — **[UNVERIFIED]** as an
  industry practice.

### What real titles do

Honest answer: **the primary sources mostly aren't public.** GDC talks are paywalled; no
engineering write-up was reachable for Hearthstone, Marvel Snap, Legends of Runeterra, MTG Arena
or the poker web clients.

- **Balatro** (LÖVE/Love2D): community teardowns confirm card and joker art ships as
  **pre-rendered 2x-tier sprite sheets** (`Jokers.png`, `8BitDeck.png`) — raster atlas, not
  vector. This is the one verifiable shipped-title data point.
- **Slay the Spire**: libGDX, 2D sprite-based; no official rendering write-up found.
- **MTG Arena**: Unity, assets in AssetBundles; no primary engineering post found.

So the only pattern with actual evidence behind it is **pre-rasterised atlases** — consistent
with generic engine practice, but this is absence of evidence for the vector approaches, not
proof against them.

### The SVG-kept-viable pattern

If staying on SVG, the standard optimisation is shared **`<Defs>` + `<Use>`** instead of
self-contained geometry per card. duk.io's SolitaireCat write-up gets a full 52-card deck's
source primitives down to **46.3 KB gzipped** this way, with each card reduced to about a dozen
`<use>` references. Directly applicable here: `SuitMark`'s paths are identical per suit and
currently re-emitted per pip — twelve times per card, up to ~650 times across a table. Hoisting
the four suit paths into one `<Defs>` and referencing them would cut node count substantially
while changing nothing visually.

`react-native-svg` supports `Use`/`Defs`/`Symbol` on all platforms per `USAGE.md`.

### Node-count thresholds

- **Chrome/Lighthouse** documents its own DOM-size thresholds: warns above ~**800** body-tree
  nodes, errors above ~**1,400** (developer.chrome.com/docs/lighthouse/performance/dom-size).
  web.dev explains the mechanism — large trees force constant position/style recomputation.
- **react-native-svg** has no maintainer-published numeric threshold — **[UNVERIFIED]**. The
  evidence is issue volume: #1470 (slow mount/re-render with nested trees), #2660 (~100 SVG+image
  elements causing flicker), #1319 and #1397 (general "large SVG" reports), #2739 (Windows Paper
  backend creating a new DirectX device *per SVG instance*).
- **On web, `react-native-svg` renders real `<svg>` DOM.** Its README states support for
  "React Native, React Native Web, and plain React web projects" and it ships a dedicated
  `ReactNativeSVG.web.js` build. I confirmed this indirectly (package structure, README,
  build-error issue #2020) rather than by quoting the emitting source line — **[UNVERIFIED]** at
  the line level, high confidence in substance.

### Cache-as-bitmap

The pragmatic middle path: a card face is **static**. Only its transform changes. So rasterise
once, then only composite.

- **Web:** `will-change: transform` forces one-time rasterisation into a compositor bitmap layer,
  after which only cheap transform/opacity compositing happens per frame. Or `canvas.toDataURL()`
  / `toBlob()` → a reused `<img>`. Composited layers are uncompressed RGBA in GPU memory —
  bounded and predictable, unlike DOM-node scaling.
- **Native, without Skia:** `react-native-svg` shows no evidence of internal bitmap caching for
  repeated instances (#2739 suggests the opposite on at least one backend) — **[UNVERIFIED]** for
  iOS/Android Fabric. iOS's own primitive is `CALayer.shouldRasterize` (Apple's docs note it
  trades memory for avoiding re-render), not exposed through RN.
- **Native, with Skia:** `Skia.Surface.MakeOffscreen()` → draw → `makeImageSnapshot()`, plus
  `useTexture` / `useImageAsTexture` / `usePictureAsTexture`, all documented explicitly for
  caching "complex graphics that don't change frequently".

### Open playing-card asset sets (licences verified)

| Set | Licence | Source |
|---|---|---|
| SVG-cards (htdebeer) | LGPL | github.com/htdebeer/SVG-cards |
| Kenney.nl Playing Cards Pack | **CC0** | kenney.nl/assets/playing-cards-pack |
| Byron Knoll vector playing cards | Public domain (WTFPL fallback) | byronknoll.blogspot.com/2011/03/vector-playing-cards.html |

All three are usable commercially. Probably not worth switching to — the current hand-drawn
`cardFaceModel.ts` pip grids are a genuine asset and match the game's visual identity.

### Recommendation for question 6

Do **not** move to a sprite atlas yet. Do, in order:
1. Hoist the four suit paths into `<Defs>` and reference with `<Use>` — a cheap, large node-count
   win with no visual change.
2. Measure the real DOM node count in a mobile browser at a 4-player table before deciding
   anything else. Right now the "54 cards is too many nodes" concern is a hypothesis; the
   structure is already better than the usual disaster case, and opponents' hands are card backs.
3. Only if measurement says so, rasterise static faces (web: `will-change` layer promotion or a
   `<canvas>`-generated data-URI sprite; native: no good option short of Skia).

---

## 7. Performance and profiling for react-native-web + Reanimated

### Cheap vs expensive properties (Chrome / web.dev primary)

- **Compositor-only, cheapest: `transform` and `opacity`** — the only two properties the
  compositor can handle alone, skipping layout and paint entirely
  (web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count).
- **Layout-triggering, expensive:** `top`/`left`/`width`/`height`/margin/padding force the whole
  style→layout→paint→composite pipeline to rerun (web.dev/articles/animations-guide).
- **Paint-only but costly:** `box-shadow` — blur-based effects take longer to paint than flat
  fills. Relevant: `Shadow.*` in `lib/theme.ts` is fine as a *static* style, but must never be
  animated.
- **`backdrop-filter` is explicitly flagged by Google:** *"Caution: backdrop-filter may harm
  performance. Test it before deploying."* (web.dev/articles/backdrop-filter). Each instance
  triggers a GPU blur pass. Per-card frosted glass across a table is a clear anti-pattern; one
  modal-scrim instance is fine.

**Practical rule for this codebase:** every card animation must be built from `transform` and
`opacity` only, and blur/filter effects should be limited to one or two actively-animating
elements at a time.

### Concurrency budget

Software Mansion's own number — ~100 simultaneously animating components on low-end Android,
~500 on iOS — plus web's total lack of thread separation, argues for animating only the *cards
actually in motion* (the thrown set, a couple of neighbours re-fanning), never all 54. Worth
making explicit as a design constraint in `gameTableModel.ts`.

### Profiling tooling, 2026

- **Chrome DevTools Performance panel** got a complete overhaul
  (developer.chrome.com/blog/new-in-devtools-147): real-time Live Metrics, AI-powered Insights,
  and a new **Long Animation Frames** track — directly useful, since Reanimated-on-web animations
  *are* long JS-thread work.
- **Chrome DevTools Rendering tab**: paint flashing, layer borders, FPS meter — still the fastest
  way to see whether card transforms are actually staying on the compositor.
- **React 19.2 Performance Tracks** (react.dev/blog/2025/10/01/react-19-2): plugs into Chrome's
  custom-tracks API with a Scheduler track and a Components track showing per-component
  mount/render/effect timing. **Requires React 19.2 — this repo is on 19.1.0.** A concrete
  reason to want the SDK upgrade.
- **React DevTools Profiler**: still standard. Note the interaction with React Compiler — since
  the compiler auto-memoises, high re-render counts in compiled code more likely reflect genuine
  prop/state changes than missing memoisation. Cross-check against the known
  `useEffect` miscompile risk already recorded in `CLAUDE.md`.
- **Expo's profiling is native-only.** Per docs.expo.dev/debugging/tools, both the Performance
  Monitor overlay (FPS, RAM, JS heap, view counts) and the React Native DevTools Profiler tab are
  Android/iOS only. **This is a real gap: the platform most users are on has no first-party
  profiler.** Fallback is Chrome DevTools plus a hand-rolled `requestAnimationFrame`/
  `PerformanceObserver` FPS meter.
- **Reanimated ships no web profiler** — nothing beyond the general performance guide.

### iOS / mobile Safari ceilings

- The real ceiling is **memory pressure, not a documented layer-count cap.** I found no WebKit or
  Apple source stating a numeric compositor-layer limit — **[UNVERIFIED]**, and I checked the
  Safari 18 release notes and webkit.org/blog/3632.
- Apple Developer Forums thread 112218 documents a **224 MB total canvas memory limit introduced
  at iOS 12**. That figure is old and I found no updated official number for current iOS —
  **treat as historical, not current**. Recent (2025-2026) WebGL memory/crash reports on
  iOS 18.2–18.4 (Apple Developer Forums thread 778735, Unity Discussions) corroborate ongoing
  GPU-memory fragility but give no hard number.
- A third-party source (catchmetrics.io, **not** WebKit-primary) describes WebKit escalating at
  ~50% ("Conservative": clear caches/GC) and ~65% ("Strict": drop decoded images and **flush all
  JIT-compiled JS**) — the latter would be brutal for a JS-driven animation loop. **This entire
  mechanism is [UNVERIFIED] against an official source; do not cite the percentages.**
- Since the app is served as a plain website via Express and opened in the device's real Safari
  (not a WKWebView wrapper), standard mobile Safari behaviour applies.

---

## Explicitly unverified

1. Whether Reanimated 4's CSS Animations API emits real browser `@keyframes` (compositor-offloaded)
   on web, or runs through the same JS/rAF path as everything else. Docs never say.
2. Whether the `getBoundingClientRect()` ~200 ms-freeze bug (reanimated #7673) is fixed in
   current 4.x releases.
3. Whether `@shopify/react-native-skia@2.9.1` works against `react-native-worklets@0.5.1` in
   practice (its declared peers permit it; its internals may not).
4. Whether `react-native-reanimated@4.1.1` behaves correctly against `react-native-worklets@0.8.3`
   (both compatibility tables say yes; not tested).
5. Whether Skia's web target works specifically against `react-native-web@0.21.x`. Docs only say
   RNW is not required.
6. Current (iOS 18.x) canvas/GPU memory ceiling in mobile Safari — only an iOS-12-era 224 MB
   figure found.
7. WebKit's 50%/65%/100% memory-pressure tiers and the "JIT flush at Strict tier" claim —
   non-primary source only.
8. Any numeric iOS Safari compositor-layer-count ceiling — none found.
9. SDF glyphs or glyph fonts used for card rank/suit rendering in any shipped title.
10. Rendering-technique specifics for Hearthstone, MTG Arena, Marvel Snap, Legends of Runeterra,
    Slay the Spire, PokerStars/partypoker — no accessible primary sources.
11. The literal `react-native-svg` source line emitting a host `<svg>` DOM tag on web —
    confirmed indirectly.
12. Whether `react-native-svg` has any internal render/bitmap caching for repeated instances on
    native.
13. Whether Rive's RN packages work in Expo Go — inferred from native-module architecture, no
    explicit doc statement found.
14. New Architecture support for `react-native-confetti-cannon` (last release 2021).
15. `react-native-particle-js`, `react-native-particle-system`, `react-native-particles-webgl`,
    `react-native-particles-bg` — surfaced in search only, not individually verified.

---

## Sources

Primary sources, all fetched 2026-08-20 unless a date is given.

**Registries / APIs**
- `registry.npmjs.org` per-package JSON (versions, `time` maps, peer deps, licences)
- `api.npmjs.org/downloads`, `api.github.com/repos/...`
- `cdn.jsdelivr.net` + `data.jsdelivr.com/v1/packages/npm/canvaskit-wasm@0.41.0` (file sizes,
  transfer sizes under `Accept-Encoding: gzip` / `br`)
- https://raw.githubusercontent.com/expo/expo/sdk-54/packages/expo/bundledNativeModules.json

**Skia**
- https://shopify.github.io/react-native-skia/docs/getting-started/web/
- https://shopify.github.io/react-native-skia/docs/shaders/overview/
- https://shopify.github.io/react-native-skia/docs/image-filters/overview/
- https://shopify.github.io/react-native-skia/docs/shapes/atlas/
- https://shopify.github.io/react-native-skia/docs/animations/textures
- https://raw.githubusercontent.com/Shopify/react-native-skia/main/packages/skia/scripts/setup-canvaskit.js
- https://github.com/Shopify/react-native-skia/releases
- https://github.com/Shopify/react-native-skia/issues/2484 (and #1243, #1774, #2192)
- https://docs.expo.dev/versions/latest/sdk/skia/

**Reanimated / worklets**
- https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started
- https://docs.swmansion.com/react-native-reanimated/docs/guides/web-support/
- https://docs.swmansion.com/react-native-reanimated/docs/guides/compatibility/
- https://raw.githubusercontent.com/software-mansion/react-native-reanimated/main/docs/docs-reanimated/docs/css-animations/overview.mdx
- Reanimated 4 stable release announcement, swmansion.com/blog, 2025-07-23
- github.com/software-mansion/react-native-reanimated issues #7673, #7678, #8250, #7480

**react-native-svg**
- https://github.com/software-mansion/react-native-svg/blob/main/USAGE.md
- Issues #1319, #1397, #1470, #2020, #2660, #2739

**Rive / Lottie**
- https://rive.app/pricing, https://rive.app/docs/runtimes/react-native
- github.com/rive-app/rive-runtime (MIT), github.com/rive-app/rive-nitro-react-native
- github.com/lottie-react-native/lottie-react-native (README, releases, #1067)
- github.com/expo/expo/issues/38583

**Web platform / performance**
- https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count
- https://web.dev/articles/animations-guide
- https://web.dev/articles/backdrop-filter
- https://web.dev/articles/dom-size-and-interactivity
- https://developer.chrome.com/docs/lighthouse/performance/dom-size
- https://developer.chrome.com/blog/new-in-devtools-147
- https://react.dev/blog/2025/10/01/react-19-2
- https://docs.expo.dev/debugging/tools
- https://developer.apple.com/documentation/quartzcore/calayer/shouldrasterize
- Apple Developer Forums threads 112218, 778735

**Card rendering**
- https://github.com/htdebeer/SVG-cards (README, node-count/timing figure)
- https://duk.io/blog/code/solitaire-cat/svg-playing-card-generation
- https://kenney.nl/assets/playing-cards-pack
- https://byronknoll.blogspot.com/2011/03/vector-playing-cards.html
- docs.unity3d.com Sprite Atlas manual; developer.android.com/games/optimize/textures
- https://www.redblobgames.com/x/2403-distance-field-fonts
