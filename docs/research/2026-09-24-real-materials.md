# Real felt and card materials on Expo + Skia (#1244)

Research for metasito/murlan#1244, read against `main` at `892e90b5`, 2026-09-24.
Tags: **[doc]** = a primary source says it; **[src]** = read in the published package source;
**[measured]** = I ran it; **[est]** = my estimate, not measured on the target device.

## 0. Where the code stands today

- `components/table/felt.tsx` `FeltPool`: three react-native-svg radials (field, core, bloom) hung
  off one Reanimated anchor that moves with the lamp; a static 45°/−45° 1px-every-3px line weave;
  a "nap" radial ring (clear → `Lantern.napSheen` at 0.5 → clear) that fakes a raking-light band;
  a fixed vignette. No texture, no per-pixel lighting.
- `components/CardView.tsx`: a back is an `expo-linear-gradient` over the five `CardBacks.field`
  stops + `OrnateCardBack` SVG (lattice + star) + `TopLight` (a fixed gradient, three presets). A
  face is `CardFaceGradient` + SVG art. Nothing on a card knows where the lamp is.
- **`@shopify/react-native-skia` is not in `package.json` yet.** Expo SDK 57 pins it at
  **2.6.2** ([bundledNativeModules.json, sdk-57](https://github.com/expo/expo/blob/sdk-57/packages/expo/bundledNativeModules.json)),
  and it is in Expo Go ([Expo docs](https://docs.expo.dev/versions/latest/sdk/skia/)) **[doc]**.
  npm `latest` is 2.12.0, so docs pages may describe newer APIs; everything below marked [src]
  was checked in the 2.6.2 tarball (browsable at `https://unpkg.com/@shopify/react-native-skia@2.6.2/src/`).

## 1. The real materials, and what light does to them

### Gaming suede (velveteen / micro-suede)
- Velveteen, "also known as micro suede", is the standard poker-table felt; short plush fibres
  "that won't pill"; absorbent, stains; cards "stay where they are dealt" **[doc]**
  ([BBO](https://www.bbopokertables.com/poker-table-felt),
  [Billiards Direct](https://www.billiardsdirect.com/how-to-play-cards/poker-tables/poker-table-felt-guide/)).
- Optics: a cut pile is a fibre forest, not a surface. Light scatters forward and back along the
  fibres, giving "fuzz" and a sheen that rises toward **grazing** angles, often two-toned; the
  body colour is deep because light is trapped between fibres **[doc — Filament's cloth model]**
  ([Filament § Cloth model](https://google.github.io/filament/Filament.md.html#materialsystem/clothmodel)).
- The pile has a direction (nap). Brushed patches lie differently and read lighter/darker — the
  CC0 scan of velveteen at Poly Haven ships **anisotropy-rotation and -strength maps** and is
  tagged "patchey" ([velour_velvet](https://polyhaven.com/a/velour_velvet)) **[src — API listing]**.
- What it looks like under an overhead lamp: matte, saturated core; a soft brightening ring where
  the light starts to rake; faint cloudy nap patches; no visible threads.

### Speed cloth (suited speed cloth)
- 100% polyester, tight weave, water resistant, "cards slide across eight foot long tables";
  "softer and more silky to the touch"; suits woven in, usually two-tone jacquard; graphics by
  dye sublimation **[doc]** ([BBO](https://www.bbopokertables.com/poker-table-felt),
  [Billiards Direct](https://www.billiardsdirect.com/how-to-play-cards/poker-tables/poker-table-felt-guide/),
  [casino4you](https://casino4you.com/product/suited-speed-cloth/)).
- Optics **[est, from fibre type]**: continuous polyester filaments in a flat tight weave give a
  smoother surface than a cut pile — less fuzz, a slightly glossier, broader sheen, a little less
  colour depth, and the woven suit motif showing up as a tone shift that appears/disappears as the
  light angle changes (jacquard reads by sheen, not by ink).
- What it looks like: flatter and "cleaner" than suede, a faint lamp glint, and the suit pattern
  as a ghost in the raking band.

### Scale check (matters for every texture choice) [est]
If the 874 pt table stands for a ~1.5 m real table, 1 pt ≈ 1.7 mm and a device pixel (~2.75×)
≈ 0.6 mm. Real threads (tenths of a mm) are **sub-pixel**: what can read is pile mottling, nap
patches, the suit jacquard (motifs a few cm → 10–20 pt) and the light response. Today's 3 pt
weave is ~5 mm per thread — coarser than any real cloth.

### Playing-card stock
- Two paper plies laminated with a glue/paste core for opacity; a coating ("Magic"/standard
  finish) gives slip; embossed decks "handle much more evenly" than smooth
  ([PlayingCardDecks](https://playingcarddecks.com/blogs/all-in/factors-that-affect-the-handling-of-a-deck)) **[doc]**.
- Air-Cushion Finish: small indentations embossed into the card that fill with air
  ([Bicycle glossary](https://de.bicyclecards.com/glossar/air-cushion-finish/)) **[doc]**;
  Kaolin (Japanese) stock uses an "extremely precise grid-like embossing pattern"
  ([Legends](https://legendsplayingcards.com/blogs/articles/playing-card-paper-and-finishing-techniques)) **[doc]**.
- 100% PVC plastic (Copag) is smooth, no emboss ([Copag](https://www.copagusa.com/collections/1546-series/products/copag-1546-poker-size-jumbo-index-playing-cards-orange-brown)) **[doc]**.
- Optics **[est]**: linen/dimple emboss breaks the coating's specular into a fine grain — a
  satin, low-glare sheen that sparkles slightly under a raking light; plastic gives a smoother,
  more mirror-like streak. The edge shows the paper core as a thin light line (or gilding).

### Card-back finishes
- Hot foil (metal die, opaque metallic, slightly raised), cold foil, spot UV (clear varnish cured
  by UV: shiny, slightly raised, selective), blind/foil emboss, gilded edges ("brighter,
  mirror-like edge") ([EzraCard](https://ezracard.com/finishing-options/),
  [MPC](https://www.makeplayingcards.com/pops/card-print-types.html)) **[doc]**.
- What sells each one visually is a **view/light-dependent highlight** that moves across the
  metallic or varnished areas while the matte field stays still. For our backs: the gold/silver
  ink lattice + star = foil; the field = matte linen stock.

## 2. Rendering on this stack

### APIs verified in react-native-skia 2.6.2 [src]
| Need | 2.6.2 | Web (CanvasKit 0.41.0) |
|---|---|---|
| SkSL `RuntimeEffect.Make` + `<Shader source uniforms>` with child shaders | yes (`renderer/components/shaders/Shader.tsx`) | yes |
| `<ImageShader tx/ty>` repeat tiling (TileMode Repeat/Mirror) | yes | yes |
| `<FractalNoise>` / `<Turbulence>` (freqX/Y, octaves, seed, tileWidth/Height) | yes | yes |
| Reanimated shared/derived values passed straight as props/uniforms, UI thread | yes ([docs](https://shopify.github.io/react-native-skia/docs/animations/animations)) | yes |
| `<Atlas>` + `useRSXformBuffer`, per-sprite `colors` | yes (`external/reanimated/buffers.ts`) | yes (`drawAtlas`) |
| `useTexture` / `usePictureAsTexture` (bake a picture into an SkImage on the UI thread) | yes (`external/reanimated/textures.tsx`) | yes |
| `ImageFilter.MakePointLitDiffuse/Specular` (Phong on a bump map) | yes, native | **throws `NotImplementedOnRNWeb`** (`skia/web/JsiSkImageFilterFactory.ts`) |
| WebP decode | yes | `WEBPVP8` strings present in `canvaskit.wasm` [measured, grep] |

SkSL specifics: children are sampled with `child.eval(coord)`, `main()` gets **local** coords,
colour uniforms need `layout(color)`, output must be premultiplied
([Skia SkSL](https://skia.org/docs/user/sksl/)) **[doc]**. Whether runtime effects allow
`dFdx`-style derivatives I did not verify — design so it is not needed (sample neighbours).

### The felt: one full-table Skia `<Canvas>`, one RuntimeEffect
Shader inputs: `uniform float2 lamp; uniform float lampH; uniform float time;` + child
`height` (a tiling grayscale tile) + the five `FeltStops` as `layout(color)` uniforms.
Per pixel: (1) albedo from the stops by distance to the lamp (what the SVG radials do now);
(2) normal from the height tile by 2 neighbour samples; (3) light vector from `(lamp, lampH)`,
view vector straight down; (4) material term:
- **Suede**: wrap diffuse `(NoL+w)/(1+w)^2` (w≈0.5) + Charlie sheen
  `D = (2+1/α)·sin(θh)^(1/α)/2π` with α high (0.6–0.9), sheen tinted a lighter step of the felt
  ([Filament](https://google.github.io/filament/Filament.md.html#materialsystem/clothmodel)) **[doc]**.
  With the view straight down, θh grows away from the lamp, so this *derives* the raking ring the
  `NAP_OFFSETS` radial fakes today. Nap: a constant nap direction + a low-frequency noise that
  rotates it per patch; modulate the sheen by `dot(nap, L_xy)` → brushed patches that change as
  the lamp swings.
- **Speed cloth**: same diffuse, narrower, brighter sheen lobe (lower α) or a Blinn-Phong glint;
  the suit jacquard as a second, tiny tiling mask (one suit motif per tile) that changes only the
  sheen weight, never the albedo — so it shows in the raking band and vanishes under the lamp.
- Vignette and bloom fold into the same shader: one draw for the whole felt.

Lamp: the existing `x`/`y` shared values become the `lamp` uniform (a `useDerivedValue`); sway and
bomb swing are just more animation on the same values. The Canvas re-renders only when they change,
but the lamp moves every frame, so **the felt shader runs every frame** — its cost is the budget.

**Height tile: bake it, don't download it.** `FractalNoise`/`Turbulence` (with `tileWidth/Height`
for seamless) drawn once into an offscreen image via `useTexture`, then sampled through
`ImageShader tx="repeat"`. Zero bytes, no licence, and noise is not evaluated per frame. A
photographic CC0 tile (§4) is the alternative when mottling must look "scanned".

Cost at the floor **[est]**: 2019 mid-range Android (Adreno 610 / Mali-G72 MP3 class), table
≈ 2400×1100 px ≈ 2.6 Mpx; ~3 texture samples + ~40 ALU ops per pixel ≈ 160 M fragments/s at 60 fps
— plausibly 2–5 ms GPU per frame, inside 16.7 ms, plus one full-screen composite of the Skia
view (Android uses a `TextureView` unless `opaque`, `SkiaBaseView.java`) **[src]**. Must be
measured on a device before committing (GPU profile bars); if tight, render the Canvas at 0.5–0.75×
resolution — cloth has no hard edges to lose.

### The cards: stay React Native views
- **Per-card Skia `<Canvas>` is foreclosed**: browsers cap WebGL at **16 contexts per page**
  ([Skia web docs](https://shopify.github.io/react-native-skia/docs/getting-started/web)) **[doc]**
  and every web Canvas is a `webgl2` surface (`views/SkiaPictureView.web.tsx`) **[src]**; on Android
  each Canvas is its own `TextureView`/`SurfaceView` **[src]**. 54 of them is out.
- **All cards in one Skia canvas (`<Atlas>`)** is technically cheap — one draw call, transforms
  animated in worklets, per-sprite tint — but moves hit-testing, accessibility, `testID`s and
  flight animation out of RN, and on web the cards would not paint until CanvasKit arrives. Atlas
  takes no shader, only per-sprite `colors` ([Atlas docs](https://shopify.github.io/react-native-skia/docs/shapes/atlas)) **[doc]**.
  A redesign, not a material change.
- **Shippable approach**: (a) **bake** each material into images once — card stock (white with a
  procedural dimple/linen height lit from above), and the five backs with their lattice and star
  rendered with a foil look at a neutral light; (b) keep the **lamp relation** as one cheap overlay
  per card: a `LinearGradient` sheen whose angle and opacity come from the card's position vs the
  `lamp` shared value in a `useAnimatedStyle` worklet — replacing `TopLight`'s three presets. The
  foil highlight is the same overlay masked to the ink (a second baked alpha image of the lattice
  + star, tinted by the overlay) **[est: 54 animated styles + 108 small images is within RN's
  budget, but measure]**.
- Bake where: Skia offscreen on native is possible, but then web needs CanvasKit first. Simplest
  and identical everywhere: **pre-rendered WebP assets at build time** (5 backs + stock tile + foil
  masks). Faces stay SVG art over a stock tile.

### Asset sizes [measured, PIL WebP q80, Poly Haven 1K sources]
| Tile | 512² colour | 512² gray (height) | 1024² colour |
|---|---|---|---|
| velour_velvet diffuse | 8.5 KB | 7.5 KB | 116 KB |
| velour_velvet normal | 11.6 KB | 9.2 KB | 54 KB |
| bi_stretch (polyester) diffuse | 1.0 KB | 0.5 KB | 50 KB |

The 512² downsamples are tiny because at table scale the texture is nearly uniform — the §1
scale check in numbers. Budget: a felt tile ≤ 20 KB, each card back ≤ ~15 KB at 2× card size
**[est]**. Ship height, not normal maps: one channel, compresses cleanly; lossy WebP on a normal
map bends normals.

## 3. Web before CanvasKit arrives

- CanvasKit 0.41.0 full `canvaskit.wasm` (the build 2.6.2 imports): **8.08 MB raw, 3.25 MB
  gzip -9, 2.51 MB brotli -11** **[measured]** (docs say "2.9MB when gzipped" for an older build).
  The issue's "3.22 MB brotli" looks like the gzip figure.
- react-native-svg 15.15.4 **does not implement `feDiffuseLighting`, `feSpecularLighting` or
  `feTurbulence` on native** (`warnUnimplementedFilter()`) **[src]**; browsers do support them
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feSpecularLighting))
  **[doc]**, but a point-lit filter over the full table is re-rasterised on every lamp frame
  **[est: too heavy for mobile web]**. Not a fallback.
- **What gets close**: the current SVG pool (unchanged) + the **same baked felt tile** as a CSS
  `background-image` repeat layer blended over it (`mixBlendMode` is an RN style — New
  Architecture, Android 10+ — and plain CSS on web ([RN docs](https://reactnative.dev/docs/view-style-props))
  **[doc]**) + the existing nap ring. That reproduces albedo, mottling and falloff; it lacks only
  the lamp-dependent grain glint and nap patches shifting as the lamp sways **[est: ~80% of the look]**.
  Cards need no fallback — they are baked images on every platform.
- The swap to Skia must be invisible: both paths read the same tile and the same stops, and the
  Skia layer fades in over the fallback.

## 4. Texture sources and licences

- **ambientCG**: CC0 1.0, no attribution, commercial use OK ([licence](https://docs.ambientcg.com/license/)) **[doc]**.
  Candidates with colour + normal + roughness + displacement: `Fabric034` (tagged felt),
  `Leather039` (tagged suede), `Fabric048`/`Fabric049` (polyester), `Fabric082A` (fine woven),
  `Paper001` **[src — ambientCG API]**. No playing-card linen/air-cushion scan.
- **Poly Haven**: CC0, commercial OK ([licence](https://polyhaven.com/license)) **[doc]**.
  `velour_velvet` (velveteen, with anisotropy maps — the closest to gaming suede), `bi_stretch`,
  `stretch_poplin`, `terlenka` (fine polyester/cotton weaves — speed-cloth stand-ins), `crepe_satin`
  (sheen reference). ~28 × 27 cm per tile **[src — API `dimensions`]**. No card stock.
- **Card linen/dimple and the suit jacquard are procedural** (a regular dimple grid and a suit
  mask are trivial to draw) — which also avoids a licence question.

## 5. What forecloses what

| Option | Ships? | Why |
|---|---|---|
| Felt as one Skia Canvas + SkSL cloth shader (sheen, nap, lamp uniform) | **yes** (native now; web after CanvasKit) | APIs all in 2.6.2 + CanvasKit; one surface |
| Procedural height baked once via `useTexture` | **yes** | no asset, no licence |
| Photographic CC0 felt tile | **yes** | CC0; ≤ ~20 KB at 512² |
| `ImageFilter` point-lit diffuse/specular | native only | throws on web → foreclosed as the shared path |
| SVG lighting filters | web only | unimplemented in react-native-svg native |
| Per-card Skia Canvas | **no** | 16 WebGL contexts/page; one GPU surface per card on Android |
| All cards in one Skia Atlas | not in this scope | moves hit-testing/a11y/flights out of RN; no cards on web until CanvasKit |
| Per-pixel normal-lit cards | **no** (follows from the two above) | fake it with baked texture + lamp-driven overlay |
| Baked card stock / backs / foil masks as WebP + per-card lamp overlay | **yes** | works on every platform from first paint |
| Visible thread-level weave | pointless | threads are sub-pixel at table scale |

So the HTML prototype should mock only: the SkSL felt (suede and speed-cloth variants), the
CSS-tile web fallback beside it, and cards as baked images with a lamp-relative sheen/foil overlay.

## Recommendation

- **Felt — suede**: one full-table Skia Canvas running one RuntimeEffect: stops-by-distance albedo,
  baked procedural height, wrap diffuse + Charlie sheen (high α) + noise-rotated nap direction;
  lamp from the existing shared values. Web: same tile via CSS over the SVG pool until CanvasKit.
- **Felt — speed cloth**: the same shader with a tighter, brighter sheen lobe and a tiling suit
  jacquard mask that modulates only the sheen. Same fallback. Offer both as `FeltStops`-style
  cosmetic variants — one shader, two parameter sets.
- **Cards**: stay RN views. Bake stock (linen dimple), the five backs and a foil mask of each
  back's ink to WebP; replace `TopLight` with a per-card overlay driven by the card's position vs
  the lamp, adding a moving foil glint on gold/silver ink. No Skia on cards.
- **Before building**: measure the felt shader on a real 2019 mid-range Android (GPU profile), and
  decide the Skia web load (2.5–3.3 MB) against the fallback being "good enough".

## Could not verify
- Real GPU cost on the floor device (all per-frame costs above are estimates).
- Whether SkSL runtime effects accept derivatives (`dFdx`) — avoided by design.
- Whether RN `mixBlendMode` composites correctly over a Skia `TextureView` on Android.
- Thread pitch, sheen and colour-depth figures for specific suede/speed-cloth products: no
  manufacturer publishes optical data; §1 optics beyond the cited lines are physics-based estimates.
- Dimple pitch of Air-Cushion/linen emboss (not published by USPCC).
