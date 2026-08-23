# High-fidelity card table: what makes one read as real, and what of it React Native can do

Research note, 2026-08-23. Written against this repo at `agent/191-194-table-layout`
(Expo SDK 54, React Native 0.81.5, New Architecture **on**, `react-native-svg` 15.12.1,
Reanimated 4.1, `react-native-web` 0.21, `expo-linear-gradient` 15).

Scope: the owner wants the table to look like a real table under real light. This note
answers *which techniques actually produce that*, *what the card itself needs*, *what is
reachable in RN/Expo*, *what it costs*, and *what order to do it in*.

Claims that could not be traced to a primary or high-trust source are marked
**[unverified]**. Two of the biggest levers below (New Architecture `boxShadow`/`filter`,
and `experimental_backgroundImage`) are documented API surface, not measured — the note
says so where it matters.

---

## 0. What this repo already has

Grounding, so the ladder in §5 is not re-proposing things that exist.

- `lib/tokens.ts` already models the table as **surface + light, not colour**: `FeltGradients`
  is a five-stop cloth gradient per felt, and `Lantern` is a set of *translucent* overlays
  (`core`, `coreMid`, `bloom`, `clear`, `weaveLight`/`weaveDark` at 45°, `vignette`) laid on
  top of it. The comment in the file states the principle outright: "a lit surface is the
  surface plus the light, never a colour of its own." That is the correct model and most of
  §1 is an elaboration of it, not a replacement.
- `lib/theme.ts` already has a two-state card shadow — `Shadow.card` (0,1 / r3 / α.45) for a
  card lying on felt and `Shadow.cardLifted` (0,7 / r12 / α.5) for one held above it — plus
  `makeShadow()`, which emits `boxShadow` on web and the legacy `shadow*` props on native.
- Court art is already **raster, not vector**: twelve public-domain PNGs at 82×241, ~428 KB
  total, from Byron Knoll's *Vector Playing Cards* via
  [hayeah/playing-cards-assets](https://github.com/hayeah/playing-cards-assets)
  (`assets/images/cards/README.md`). The reasoning recorded there — the source SVGs are
  0.4–1.1 MB and thousands of paths each, which `react-native-svg` would re-parse per card —
  is exactly the §2/§3 conclusion, already reached.
- `docs/BUNDLE.md`: assets total **2.71 MB / 34 files**, of which `icon.png` (1.03 MB) and
  `splash-icon.png` (1.19 MB) are 2.22 MB. Everything else in the tree — all twelve court
  cards, all thirteen sounds, both subset fonts — is **~490 KB combined**. That is the real
  headroom figure to reason against.
- `docs/WEB-PERF.md`: desktop-Chromium baseline is 60 fps with **one** dropped frame on the
  deal, `transformed` already **179** on a settled table, `domNodes` ~780. No mid-range
  Android row exists yet; the doc is explicit that until it does, every phone-perf answer is
  a guess.
- `docs/agents/loops.md`: the `react-native-svg` web/native divergence table. This is the
  single most important constraint in the whole note and §3 builds on it.

---

## 1. What actually makes a digital card table read as real

The short version, ordered by how much of the effect each carries:

### 1.1 Grounding beats everything else

The single biggest "is it real" cue is **the contact shadow** — the small, dark, tight
occlusion directly under an object where it meets the surface. Contact shadow is the cheap
2D cousin of ambient occlusion: "basically as a very blurry patch of shadow under the object
where it meets the ground, using a simple alpha-mapped texture"
([Beyond3D discussion](https://forum.beyond3d.com/threads/what-are-contact-shadows-and-dynamic-radiosity.40169/)).
Its job is described precisely in the AO literature: it darkens contact points "so scenes
look grounded instead of like props sitting on a lit stage"
([CraftPBR AO guide](https://craftpbr.com/guides/what-is-an-ambient-occlusion-map)), and
without it objects "feel like flat stickers."

The important structural point: **a contact shadow and a cast shadow are two different
shadows, and a realistic card has both.** The contact shadow is tight, dark, offsetless and
does not move; the cast shadow is soft, offset away from the key light, and lengthens as the
card lifts. `Shadow.card` / `Shadow.cardLifted` in this repo are currently *one* shadow in
two states, which is the cheap approximation. Two stacked shadows — one tight one soft —
is the upgrade, and it is nearly free (see §3.2).

### 1.2 Light must have a direction, and the surface must respond to it

Everything convincing on a felt table comes from one hanging key light plus fill:

- a **warm key** with an **elliptical falloff** (a hanging lamp over a landscape table pools
  as an ellipse, not a circle);
- a **cool/neutral fill** so the shadow side is not simply black;
- a **vignette** wider than the falloff, centred on the table rather than the lamp;
- the cloth's own **weave** as a very low-alpha crosshatch, which is what makes the pool of
  light read as *cloth* rather than as a gradient.

This repo's `Lantern` block is already exactly this decomposition, including the two-thread
45° weave at α 0.02 / 0.055. The prototype numbers recorded in `docs/agents/loops.md` —
falloff ellipse `76% 100%` at the lamp, vignette `128% 104%` at the felt's centre — are the
"ellipse not circle" point made concrete.

### 1.3 The card is an *object*, not an image

Four cues, in descending order of payoff:

1. **Thickness / edge.** A real card has a visible white core at the edge and a
   rounded-corner radius. Poker-size stock is 11–12 pt / 300–310 gsm with a corner radius of
   about 1/8 inch on a 2.5 × 3.5 in card
   ([CPP Boxes size guide](https://www.cppboxes.com/the-complete-guide-to-the-standard-custom-playing-card-sizes/)).
   At phone scale a one-device-pixel light edge line plus a correct corner radius is what
   sells thickness — not a 3D bevel.
2. **Specular response.** Card stock is coated and semi-glossy; it catches a broad, soft
   highlight that *moves* with the card. Notably, the linen/air-cushion emboss exists partly
   *for* this: "the micro-texture scatters specular highlights, which cuts glare under bright
   ... lighting"
   ([PlayingCardDecks, how cards are made](https://playingcarddecks.com/blogs/all-in/how-to-uspcc-playing-cards)).
   So the physically right highlight on a card is **broad and diffuse**, never a hard mirror
   glint.
3. **Curl / bend.** Held cards bow. A per-card rotation of ±1–2° plus a few px of vertical
   offset along a fan arc already reads as bend; this repo's hand arc (`radius 2200,
   step .68w, rise 15`) does the geometric half of it.
4. **Parallax under tilt.** Marvel Snap's premium cards are the reference implementation:
   the card art is commissioned *in layers* and "players can upgrade cards to include a rare
   3D effect, which uses a phone's accelerometer to achieve the effect on mobile"; the
   commissions are "developed with the 3D process of Snap cards directly in mind ... with the
   layers in mind" ([Marvel.com, Inside the Art of MARVEL SNAP](https://www.marvel.com/articles/games/inside-the-art-of-marvel-snap)).
   Legends of Runeterra does the same thing artisanally — see the published 2.5D Lux card
   breakdown ([ArtStation](https://www.artstation.com/artwork/9ed5Za)).

### 1.4 Grain, dust and imperfection

Every one of the reference titles adds a final noise/imperfection pass. Balatro's is the
most extreme and the most instructive because it is *the whole art direction*: it does not
rely on "high-fidelity modeling or flashy visual effects" but on a CRT shader with edge
distortion, scanlines and strobe
([ArtStation visual breakdown](https://www.artstation.com/blogs/retrostyle-games1/PQMKA/balatro-game-art-style-a-complete-visual-breakdown);
LocalThunk's own account of it being a shader he wrote for fun is in the
[Game Informer interview](https://gameinformer.com/interview/2024/03/21/balatro-was-almost-called-joker-poker-and-other-details-from-its-creator)).
The transferable lesson is not "add a CRT filter" — it is that a **unifying full-screen
post-pass is what stops separately-drawn elements from looking separately drawn.** A very
low-alpha film grain over the whole table does for a card game what the CRT shader does for
Balatro.

### 1.5 Motion is part of the fidelity

Balatro is also the clearest demonstration that *movement* carries as much realism as
rendering: the commonly-cited analysis of it credits the feel to card motion and layered
feedback rather than to fidelity
([Balatro design analysis](https://medium.com/@yyh19971004/balatro-design-analysis-visual-packaging-and-interactive-feedback-cc6fa6a65370),
[Juicy Feedback in a Poker Roguelike](https://blakecrosley.com/guides/design/balatro)).
Concretely: spring (not linear) settling, slight overshoot, rotation coupled to velocity,
and a shadow that grows *before* the card lands.

### 1.6 What I could not verify

- **Hearthstone.** The relevant GDC sessions exist and are the right sources — *The Art of
  Hearthstone: Playing the Cards You're Dealt* ([GDC Vault](https://www.gdcvault.com/play/1020615/The-Art-of-Hearthstone-Playing)),
  *Hearthstone: How to Create an Immersive User Interface* ([GDC Vault](https://gdcvault.com/play/1022036/Hearthstone-How-to-Create-an)),
  and *VFX Storytelling: How 'Hearthstone' Breathes Life into Hundreds of Cards*
  ([GDC 2025 schedule](https://schedule.gdconf.com/session/vfx-storytelling-how-hearthstone-breathes-life-into-hundreds-of-cards/908026)) —
  but they are behind GDC Vault membership and I could not read them. **[unverified]** Do not
  cite specific Hearthstone techniques from this note; the sessions are listed so someone
  with Vault access can mine them.
- **Pokémon TCG Live, Poker Now, PokerStars, Clubhouse Games, Slay the Spire.** No art
  breakdown, postmortem or talk of usable quality found. **[unverified]** — nothing in this
  note is derived from them.
- **Legends of Runeterra's production pipeline.** Only artist-side portfolio breakdowns
  found, no Riot engineering talk. The layered-2.5D *approach* is verified by the artwork
  itself; the pipeline is not.

---

## 2. The card itself

### 2.1 What separates a cheap face from a real one

**Stock texture and linen finish.** "Linen finish is the visible textured surface on premium
playing cards, with the crosshatch pattern embossed during finishing by a steel calender
roller"; the air-cushion finish is "an embossed linen-pattern coating ... so cards glide
instead of stick"
([MPC glossary: linen finish](https://www.mrplayingcard.com/glossary/linen-finish),
[air-cushion finish](https://www.mrplayingcard.com/glossary/air-cushion-finish)). Note the
naming history — the roller was *literally cloth* before manufacturers began stamping the
pattern directly, which is why the term survives
([PlayingCardDecks](https://playingcarddecks.com/blogs/all-in/how-to-uspcc-playing-cards)).

At phone scale the emboss is **sub-pixel**. Reproducing the crosshatch literally is wrong —
it will alias into moiré. What survives, and what you actually want, is its *consequence*: a
faint uneven luminance across the face and a **broad, scattered** rather than sharp
specular. That is a 2–4% alpha noise overlay, not a texture.

**Edge treatment and bleed.** Poker stock: 2.5 × 3.5 in, ~1/8 in corner radius, 1/8 in
bleed ([CPP Boxes](https://www.cppboxes.com/the-complete-guide-to-the-standard-custom-playing-card-sizes/)).
1/8 in on a 2.5 in width is **5% of card width** — that is the corner radius to use as a
fraction, and it is a larger radius than most digital cards use. The white border around the
printed area exists because of bleed tolerance; reproducing it is part of why a card reads as
printed rather than as a screen element.

**Index sizing and readability.** Indices sit upper-left and lower-right (four corners in
many European decks, so the card fans either way)
([Crab Fragment Labs, Designing Traditional Card Decks](https://crabfragmentlabs.com/lecture-hall/designing-traditional-card-decks)).
Two principles from that essay are directly load-bearing for a phone:

- *"Above ten pips, it becomes harder to count the dots than to recognize a portrait."* —
  which is why faces exist at all, and why at small sizes the **index, not the pip field**,
  is the information channel. On a phone, the pip field is decoration; the index is the UI.
- *"The more information you put on a card, the fewer games you can play with it."* — argues
  against adding detail to the face for its own sake.

Jumbo-index decks exist precisely because standard indices lose at distance
([CPP Boxes](https://www.cppboxes.com/the-complete-guide-to-the-standard-custom-playing-card-sizes/)).
A phone hand is the distance problem in miniature: **a realistic table needs
jumbo-index-proportioned cards, not standard-index-proportioned ones.** This is the one
place where fidelity and realism are in tension and readability must win.

### 2.2 Scanned/photographed vs vector at phone scale

Vector wins on the *index* — crisp at any size, no resampling, trivially recolourable, and
one path set for 52 cards. Raster wins on the *figure* — a court card is thousands of paths
and re-parsing that per card is the failure mode this repo already documented and avoided.

The correct hybrid is the one already in `CardView.tsx`: **vector index and pips + raster
court figure + procedural stock/lighting on top.** A photographed real card is the wrong
answer at phone scale for a specific reason: a photograph bakes in *one* light direction, and
this table's whole premise is that the light moves with the turn. Baked lighting fights the
lamp. Anything photographic must be diffuse/flat-lit, with all the lighting added at runtime.

### 2.3 Open-licence card art worth knowing

| Set | Licence | Notes |
|---|---|---|
| Byron Knoll, *Vector Playing Cards* (mirror: [hayeah/playing-cards-assets](https://github.com/hayeah/playing-cards-assets)) | Public domain | **Already in use here.** 0.4–1.1 MB per SVG; use rasterised, as this repo does. |
| [saulspatz/SVGCards](https://github.com/saulspatz/SVGCards) | Public domain | **Jumbo index** decks, SVG + PNG + sprite sheets. Directly relevant to §2.1's readability point — the best lead in this table for a phone deck. |
| [RevK's SVG playing cards](https://www.revk.uk/2018/06/svg-vector-playing-cards.html) / [me.uk/cards](https://www.me.uk/cards/) | CC0, no attribution required | Clean, small, parametric. |
| [English pattern playing cards deck PLUS CC0](https://commons.wikimedia.org/wiki/File:English_pattern_playing_cards_deck_PLUS_CC0.svg) (Wikimedia Commons) | CC0 | Single 7.42 MB SVG, 5109 × 2883 nominal — a source to render *from*, not to ship. |
| [VerzatileDev Card Deck](https://verzatiledev.itch.io/card-deck), [MrEliptik 52-card pack](https://mreliptik.itch.io/playing-cards-packs-52-cards) | CC0 | Stylised rather than traditional; useful for backs and pips. |
| [OpenGameArt playing cards (vector & PNG)](https://opengameart.org/content/playing-cards-vector-png) | Per-item — **check each** | Mixed licences on OGA; verify before use. |

No open-licence set found provides *lit, textured, photoreal* card faces. **[unverified]** —
if one exists I did not find it. Realism here will be procedural, not asset-sourced.

---

## 3. What is reachable in React Native / Expo

### 3.1 The constraint that governs everything: two SVG implementations

`docs/agents/loops.md` already records this and it is correct: `react-native-svg` on native
is a different implementation from `react-native-svg-web`, not a polyfill. Upstream confirms
the native side is its own extraction path — `RadialGradient.tsx` reads `rx: rx || r`
([source](https://github.com/software-mansion/react-native-svg/blob/main/src/elements/RadialGradient.tsx)) —
while on web the element is handed to the browser, where `rx`/`ry` are not `radialGradient`
attributes at all and the browser falls back to `r="50%"`. Known native-side gradient gaps
are also documented upstream: focus point unsupported on Android, gradient alpha channel
unsupported on iOS
([issue #306](https://github.com/react-native-svg/react-native-svg/issues/306)).

The portable rule the repo already derived stands and should be treated as the governing
rule for all new work: **shape the element, not the gradient.** Give the rect the radii and
let the gradient keep `r="50%"`, which is the inscribed ellipse on both renderers.
`tests/vignette.test.ts` pins it.

### 3.2 The largest unexploited lever: New Architecture `boxShadow` and `filter`

This repo runs **RN 0.81.5 with `newArchEnabled: true`** (`app.json`). That unlocks style
props `makeShadow()` predates:

- **`boxShadow`** — CSS syntax, **accepts a comma-separated list**, so a tight contact
  shadow *and* a soft cast shadow are one prop on one node. New-Architecture-only; outset
  shadows Android 9+, inset Android 10+
  ([View Style Props](https://reactnative.dev/docs/view-style-props)).
- **`filter`** — `brightness` and `opacity` cross-platform; `blur`, `dropShadow`, `contrast`,
  `grayscale`, `hueRotate`, `invert`, `sepia`, `saturate` are **Android-only**, with `blur`
  and `dropShadow` requiring **Android 12+**. iOS ships only `brightness` and `opacity`
  "due to performance and spec compliance issues" (same page).
- **`mixBlendMode`** — New-Arch-only, Android 10+. This is the *right* primitive for lamp
  light: an overlay/soft-light blend is what a light actually does to a surface, versus the
  alpha compositing `Lantern` currently uses.
- **`experimental_backgroundImage`** — `linear-gradient()` from 0.76, `radial-gradient()`
  from **0.80**, on Android and iOS; on web the plain `backgroundImage`
  ([RN 0.81 View Style Props](https://reactnative.dev/docs/0.81/view-style-props)). This
  would let felt and vignette be *CSS-syntax gradients on a View*, sidestepping the SVG
  divergence entirely — one syntax, both platforms.

Two cautions, both real:

- RN labels `experimental_backgroundImage` "experimental ... likely to change ... Don't use
  them in production." Take that at face value.
- `react-native-web` **does not implement `experimental_backgroundImage`**
  ([necolas/react-native-web#2787](https://github.com/necolas/react-native-web/issues/2787)),
  so it needs the same `Platform.OS === 'web'` split `makeShadow()` already models — write
  `backgroundImage` on web, `experimental_backgroundImage` on native. That is a
  `makeGradient()` helper alongside `makeShadow()`, and it is the single highest-leverage
  refactor in this note.

**iOS has no `filter: blur`.** Any design that needs a real blur on iOS needs `expo-blur` or
Skia, not `filter`. Plan around this, do not discover it.

### 3.3 Technique-by-technique reachability

| Technique | Reachable? | How, cross-platform |
|---|---|---|
| Felt base gradient | Yes, today | `expo-linear-gradient`, already used |
| Elliptical lamp falloff | Yes, today | SVG rect with the radii + default `r="50%"` (the repo's own rule) |
| Vignette | Yes, today | Same |
| Cloth weave | Yes, today | Tiled WebP at α 2–5%, or the existing two-thread SVG crosshatch |
| **Contact + cast shadow as two shadows** | **Yes, cheap** | `boxShadow` comma list on native (new arch) and web; `makeShadow()` extended |
| Card thickness / edge | Yes, today | 1px inset light border + correct 5%-of-width corner radius |
| Broad specular on stock | Yes | A second `LinearGradient` at low alpha, angle driven by card rotation via Reanimated |
| Card curl/bend | Yes | Per-card `rotateZ`/`translateY` along the existing arc |
| **Tilt parallax (Marvel Snap style)** | Yes | `expo-sensors` `DeviceMotion` → Reanimated shared value → layer transforms. Native only; web has `deviceorientation` but permission-gated on iOS Safari **[unverified on this stack]** |
| Grain / dust post-pass | Yes | One tiled noise WebP at α 2–4% over the table, `pointerEvents="none"` |
| Warm key + cool fill | Yes, today | Already `Lantern`; upgrade to `mixBlendMode` where available |
| Real gaussian blur | **Split** | iOS: `expo-blur` or Skia. Android 12+: `filter: blur`. Web: CSS `filter`. No single API. |
| True per-pixel lighting / normal maps | Skia or GL only | See §3.4 |
| Foil / holo shader | Skia (`RuntimeShader`/SkSL) or `expo-gl` | Not achievable with views |

### 3.4 Is `@shopify/react-native-skia` the right tool?

**Capability: yes. Cost: high enough that it should be a deliberate second phase, not the
foundation.**

Facts:

- **Web payload is the deal-breaker for this app.** CanvasKit is **2.9 MB gzipped**
  ([Skia bundle size docs](https://shopify.github.io/react-native-skia/docs/getting-started/bundle-size/)).
  Shopify's own reported end-to-end figure is a compressed web bundle going from 2.6 MB to
  5.2 MB, plus ~220 KB JS — "about 6 MB of increased download size"
  ([Report expected bundle size increases, issue #797](https://github.com/Shopify/react-native-skia/issues/797)).
  This app's *entire* asset tree is 2.71 MB and its non-icon assets are ~490 KB
  (`docs/BUNDLE.md`). Skia on web is roughly **6× the current asset budget**, for the felt.
- **Native adds ~6 MB (iOS) and ~4 MB (Android arm64)**; `librnskia.so` alone is ~3.8 MB
  (same bundle-size doc). App Bundles keep Android to one architecture.
- **It can be loaded lazily.** `<WithSkiaWeb>` code-splits, and `LoadSkiaWeb()` defers root
  registration
  ([Web Support](https://shopify.github.io/react-native-skia/docs/getting-started/web/)). So
  the 2.9 MB need not be on the critical path — but a card table needs Skia *at the table*,
  which is the screen that matters.
- **It coexists with the RN view tree.** The docs state Skia can be used alongside normal
  React Native views (same page). So a Skia `<Canvas>` for the felt under a normal RN card
  tree is a supported architecture, and is the right shape if Skia is adopted: **Skia for the
  surface, views for the cards.**
- **Web caveat:** browsers cap WebGL contexts at **16 per page**; Skia offers
  `__destroyWebGLContextAfterRender` for static canvases (same page). One felt canvas is
  fine; one canvas per card is not.
- **Perf claims are weakly sourced.** Everything I found comparing Skia to `react-native-svg`
  on mid-range Android is secondary blog material with unreproducible numbers
  (e.g. [bobcares](https://bobcares.com/blog/react-native-skia-alternatives/),
  [reactnativerelay](https://reactnativerelay.com/article/react-native-skia-tutorial-gpu-graphics-shaders-animations-expo)).
  The directional claim — Skia is faster for many dynamic primitives, SVG is lighter for
  static vectors — is consistent across sources, but **[unverified]** as a number. Do not
  put a figure in a decision doc from these.

**Recommendation.** Do not adopt Skia to get the current design's felt, vignette and shadows —
all of those are reachable with gradients, `boxShadow` and a tiled noise texture, at a
fraction of the cost. Adopt Skia *only* if the design lands on something genuinely
per-pixel — an SkSL foil/holo shader, real-time normal-mapped lighting, or a displacement
weave. And if adopted, scope it to one lazily-loaded `<Canvas>` for the surface.

### 3.5 Blur, specifically

Blur is the trap. Positions:

- **iOS:** `expo-blur` is the only real option (`filter: blur` is Android-only).
- **Android:** blur "can be achieved efficiently only by using the RenderNode Android API,
  ... introduced in Android SDK 31 (Android 12.0). On older versions of Android, expo-blur
  uses the much less efficient RenderScript API"
  ([expo-blur docs](https://docs.expo.dev/versions/latest/sdk/blur-view/)). Expo's own
  guidance is that blur "can be expensive on Android and should be used sparingly," and the
  `dimezisBlurView` method "may lead to decreased performance on Android SDK 30 and below"
  and can cause rendering issues during `react-native-screens` transitions (same doc).
  `dimezisBlurViewSdk31Plus` falls back to `none` below 31.
- **Web:** CSS `backdrop-filter`, cheap and universally supported.

**Conclusion: do not put a live blur in the table's steady state.** A blur behind a modal or
a pause overlay is fine. A blurred bloom around the lamp should be a **pre-blurred PNG/WebP**,
not a runtime blur — it is static, so paying for it every frame on three platforms with three
different APIs buys nothing.

---

## 4. Performance budget

### 4.1 Texture memory — computed, not cited

Decoded bitmaps are RGBA8888 in memory regardless of on-disk compression: `w × h × 4` bytes.

| Asset | Pixels | Decoded RAM |
|---|---|---|
| Full-bleed felt for 844×390 @1x | 844 × 390 | **1.32 MB** |
| Same @2x | 1688 × 780 | **5.27 MB** |
| Same @3x | 2532 × 1170 | **11.85 MB** |
| 1024² tiling weave/grain texture | 1024 × 1024 | **4.19 MB** |
| **256² tiling weave/grain texture** | 256 × 256 | **0.26 MB** |
| 12 court PNGs @82×241 (current) | — | **0.95 MB** total |

The conclusion falls straight out: **a full-bleed felt photograph at 3x costs ~12 MB of RAM
and buys nothing a gradient plus a 256² tile does not.** A 256² seamless noise/weave tile is
**46× cheaper in RAM** than a 1024² one and, at 2–5% alpha, visually indistinguishable. On
disk a 256² greyscale-alpha WebP is single-digit KB.

`expo-image` helps here: `allowDownscaling` (default `true`) "automatically reduces image
resolution to match container size," and `cachePolicy` / `recyclingKey` control memory
([expo-image docs](https://docs.expo.dev/versions/latest/sdk/image/)). It also decodes WebP
and AVIF through SDWebImage (iOS) / Glide (Android). For any new raster asset, `expo-image`
over `<Image>`.

### 4.2 Per-card shadows on 52 nodes

The only hard measured number I found is `react-native-fast-shadow`'s benchmark: 100
150×200pt images with a 12pt-radius shadow on a Pixel 2 —

| Approach | Memory |
|---|---|
| No shadow | 117 MB |
| `react-native-shadow-2` | 430 MB (**+313 MB**) |
| `react-native-androw` | 403 MB (**+286 MB**) |
| `react-native-fast-shadow` | 123 MB (**+6 MB**) |

([alan-eu/react-native-fast-shadow](https://github.com/alan-eu/react-native-fast-shadow)).
The winning technique is the informative part: render the shadow once, convert to a
`NinePatchDrawable`, and "reuse it for all views with the same border and blur radii."

This is directly applicable. **Every card in this game is the same size with the same corner
radius**, so every card's shadow is the same shadow — one 9-slice, 52 reuses. That is the
argument for a 9-slice shadow asset over 52 independently-rasterised ones, whichever API
draws it. Note also RN's own long-standing Android bug where elevation shadows grow per
nested view ([facebook/react-native#20501](https://github.com/facebook/react-native/issues/20501)) —
another reason to prefer `boxShadow` (new arch) or a 9-slice over `elevation`.

Caveat: these numbers predate New-Arch `boxShadow`, which is a native implementation and
should behave much better than the JS shadow libraries measured. **[unverified]** — no
benchmark of `boxShadow` at 52 nodes found. Measure it before committing.

### 4.3 Web

`docs/WEB-PERF.md`'s baseline is the number to defend: `worst` 33.4 ms on the deal, `janky`
1, `longTasks` 0, `transformed` 179, `domNodes` 782 — desktop Chromium. Reanimated on web is
"implemented purely in JavaScript, hence the efficiency of the animations might be lower"
([Reanimated web support](https://docs.swmansion.com/react-native-reanimated/docs/guides/web-support/)).
The specific "~100 concurrently animating components on low-end hardware" ceiling quoted in
`WEB-PERF.md` I **could not find in Reanimated's current documentation** — treat it as
**[unverified]** / repo-internal until re-sourced.

Practical web rules that follow:
- Every new decorative layer is `+N` to `domNodes` and potentially `+N` to `transformed`.
  Static overlays (grain, vignette, weave) must carry **no transform** so they do not
  inflate the number that matters.
- Prefer one full-table overlay to 52 per-card overlays wherever the effect allows it.
- Re-record `npm run perf:web` after each ladder rung in §5 and compare against the table in
  `WEB-PERF.md`.

### 4.4 Bundle

Non-icon assets are ~490 KB today. A realistic realism budget:

| Addition | Realistic size |
|---|---|
| 256² seamless linen/weave tile, WebP alpha | ~5–15 KB |
| 256² film-grain tile, WebP alpha | ~5–15 KB |
| 9-slice card contact-shadow PNG | ~2–5 KB |
| Pre-blurred lamp bloom, WebP | ~20–40 KB |
| **Total for the whole of rungs 1–7 below** | **~35–75 KB** |
| Skia on web (for comparison) | **~2.9 MB gzipped** |

That contrast is the entire argument of §5.

---

## 5. The pragmatic ladder

Ranked: fidelity gained per unit of effort and risk. Rungs 1–7 are the 80% for 20%. Each is
independently shippable and independently revertable.

**Rung 1 — Split the card shadow into contact + cast.** (§1.1) Extend `makeShadow()` to emit
a comma-separated `boxShadow` list: one tight, dark, offsetless shadow (≈0,0 / r1.5 / α.55)
plus one soft offset one (the existing `Shadow.card`). Cost: one helper edit, zero assets,
zero nodes. This is the biggest single realism gain available and it is an afternoon.
*Risk:* comma lists need New Arch on native — already on. Verify on iOS via Expo Go, not just
Chromium (`docs/agents/loops.md`).

**Rung 2 — Correct the corner radius and add the edge line.** (§2.1) 5% of card width, and a
1px inset light border. Pure geometry, no assets, no perf cost. Cards stop reading as
rectangles of colour.

**Rung 3 — One full-table grain overlay.** (§1.4) A 256² tiled noise WebP at α 2–4%,
`pointerEvents="none"`, no transform. ~10 KB, 0.26 MB RAM, **one** DOM node. This is the
unifying pass that stops separately-drawn elements looking separately drawn, and it is the
cheapest thing on this list per unit of effect.

**Rung 4 — A `makeGradient()` companion to `makeShadow()`.** (§3.2) `backgroundImage` on web,
`experimental_backgroundImage` on native, one call site. Not a visual change on its own — it
is the *enabler* that removes the SVG web/native divergence from every gradient written from
here on. Do it before rungs 5–7, not after.
*Risk:* RN calls the native prop experimental. Gate it, keep the SVG path as fallback, and
pin the behaviour in a test the way `tests/vignette.test.ts` pins the current rule.

**Rung 5 — Broad, moving specular on the card face.** (§1.3, §2.1) A second low-alpha
`LinearGradient` on the card whose angle is driven by the card's rotation shared value.
Broad and diffuse, per the linen-finish physics — never a hard glint. No assets. Costs one
node per card, which is the first rung that touches the `transformed` count, so re-record
`perf:web`.

**Rung 6 — Per-card curl along the existing arc.** (§1.3) ±1–2° rotation and a few px of rise,
riding the hand arc already in place. Pure transform maths.

**Rung 7 — Pre-blurred lamp bloom as an asset.** (§3.5) Replace any runtime blur ambition
with a static WebP. ~30 KB, one node, works identically on all three platforms, and dodges
the iOS-has-no-`filter:blur` / Android-below-12-is-slow problem entirely.

--- *the 80% ends here; everything below costs materially more* ---

**Rung 8 — `mixBlendMode` for the lamp.** (§3.2) Soft-light/overlay instead of alpha
compositing makes the light behave like light. New-Arch-only, **Android 10+**, and it needs a
per-platform fallback path — so it is a real branch in the code, not a token change. Good
payoff, non-trivial cost.

**Rung 9 — Jumbo-index card faces.** (§2.1) Redraw the index at jumbo proportions, sourcing
from [saulspatz/SVGCards](https://github.com/saulspatz/SVGCards) if useful. This is the
readability-vs-realism trade and it touches every card; it is a design decision with an
owner-level call in it, not a rendering change.

**Rung 10 — Tilt parallax on the held hand.** (§1.3) `expo-sensors` `DeviceMotion` → shared
value → layered transforms, Marvel Snap style. Genuinely striking, but it is native-only,
needs a motion-permission story on web, needs layered art to parallax *between*, and adds
per-frame work to every card in the hand. High payoff, high cost, last of the
non-architectural rungs.

**Rung 11 — Skia.** (§3.4) Only for an effect that is genuinely per-pixel: SkSL foil/holo,
normal-mapped lighting, displacement weave. **~2.9 MB gzipped on web** against a current
non-icon asset budget of ~490 KB. If it happens: one lazily-loaded `<Canvas>` for the surface
only, cards stay as views, and `docs/BUNDLE.md` and the `WEB-PERF.md` baseline both get
re-recorded in the same commit.

**Explicitly not recommended:** a photographed felt texture at 2x/3x (§4.1 — ~5–12 MB RAM for
something a gradient plus a 256² tile matches); a runtime blur anywhere in the table's steady
state (§3.5); photographic card faces (§2.2 — they bake in a light direction that fights the
lamp); and per-card SVG filter effects (the divergence in §3.1 makes them a two-renderer
maintenance problem forever).

---

## Verification checklist for whoever implements this

- Every rung above changes *rendering*, and per `docs/agents/loops.md` the owner reports from
  **iOS via Expo Go** while every local loop is Chromium. A green Playwright run is not
  evidence for rungs 1, 4, 5 or 8, all of which sit exactly on a web/native divergence.
- Re-record `npm run perf:web` after rungs 3, 5, 6 and 10 and diff against `WEB-PERF.md`.
  `worst` and `janky` move first; `p50` will lie to you.
- Re-run `node scripts/bundle-report.mjs > docs/BUNDLE.md` after any rung that adds an asset.
- `lib/theme.ts` is the only place a shadow or gradient should be constructed. Rungs 1 and 4
  are both edits to that file, not new helpers elsewhere.

## Sources

- [Balatro Game Art Style: A Complete Visual Breakdown — ArtStation](https://www.artstation.com/blogs/retrostyle-games1/PQMKA/balatro-game-art-style-a-complete-visual-breakdown)
- [Balatro Was Almost Called Joker Poker — Game Informer interview with LocalThunk](https://gameinformer.com/interview/2024/03/21/balatro-was-almost-called-joker-poker-and-other-details-from-its-creator)
- [Balatro Design Analysis: Visual Packaging and Interactive Feedback](https://medium.com/@yyh19971004/balatro-design-analysis-visual-packaging-and-interactive-feedback-cc6fa6a65370)
- [Balatro: Juicy Feedback in a Poker Roguelike](https://blakecrosley.com/guides/design/balatro)
- [Balatro's Card Movements & Shaders Recreated in Unity — 80.lv](https://80.lv/articles/balatro-s-card-movements-shaders-recreated-in-unity)
- [Inside the Art of MARVEL SNAP — Marvel.com](https://www.marvel.com/articles/games/inside-the-art-of-marvel-snap)
- [Legends of Runeterra — Lux Animated 2.5D Card — ArtStation](https://www.artstation.com/artwork/9ed5Za)
- [GDC Vault — The Art of Hearthstone: Playing the Cards You're Dealt](https://www.gdcvault.com/play/1020615/The-Art-of-Hearthstone-Playing) *(membership; unread)*
- [GDC Vault — Hearthstone: How to Create an Immersive User Interface](https://gdcvault.com/play/1022036/Hearthstone-How-to-Create-an) *(membership; unread)*
- [GDC 2025 — VFX Storytelling: How 'Hearthstone' Breathes Life into Hundreds of Cards](https://schedule.gdconf.com/session/vfx-storytelling-how-hearthstone-breathes-life-into-hundreds-of-cards/908026) *(unread)*
- [MPC glossary — Linen finish](https://www.mrplayingcard.com/glossary/linen-finish) · [Air-cushion finish](https://www.mrplayingcard.com/glossary/air-cushion-finish)
- [How Playing Cards are Made — PlayingCardDecks](https://playingcarddecks.com/blogs/all-in/how-to-uspcc-playing-cards)
- [The Complete Guide to Standard & Custom Playing Card Sizes — CPP Boxes](https://www.cppboxes.com/the-complete-guide-to-the-standard-custom-playing-card-sizes/)
- [Designing Traditional Card Decks — Crab Fragment Labs](https://crabfragmentlabs.com/lecture-hall/designing-traditional-card-decks)
- [saulspatz/SVGCards — public-domain jumbo-index decks](https://github.com/saulspatz/SVGCards)
- [RevK — SVG Vector Playing Cards (CC0)](https://www.revk.uk/2018/06/svg-vector-playing-cards.html) · [me.uk/cards](https://www.me.uk/cards/)
- [English pattern playing cards deck PLUS CC0 — Wikimedia Commons](https://commons.wikimedia.org/wiki/File:English_pattern_playing_cards_deck_PLUS_CC0.svg)
- [hayeah/playing-cards-assets](https://github.com/hayeah/playing-cards-assets)
- [OpenGameArt — Playing Cards (Vector & PNG)](https://opengameart.org/content/playing-cards-vector-png)
- [React Native — View Style Props](https://reactnative.dev/docs/view-style-props) · [0.81 version](https://reactnative.dev/docs/0.81/view-style-props)
- [React Native 0.76 release notes — New Architecture, boxShadow, filter](https://reactnative.dev/blog/2024/10/23/release-0.76-new-architecture)
- [necolas/react-native-web#2787 — missing `experimental_backgroundImage`](https://github.com/necolas/react-native-web/issues/2787)
- [software-mansion/react-native-svg — RadialGradient.tsx](https://github.com/software-mansion/react-native-svg/blob/main/src/elements/RadialGradient.tsx)
- [react-native-svg#306 — RadialGradient not rendering correctly](https://github.com/react-native-svg/react-native-svg/issues/306)
- [React Native Skia — Bundle Size](https://shopify.github.io/react-native-skia/docs/getting-started/bundle-size/) · [Web Support](https://shopify.github.io/react-native-skia/docs/getting-started/web/)
- [Shopify/react-native-skia#797 — Report expected bundle size increases](https://github.com/Shopify/react-native-skia/issues/797)
- [Expo — BlurView](https://docs.expo.dev/versions/latest/sdk/blur-view/) · [expo-image](https://docs.expo.dev/versions/latest/sdk/image/)
- [alan-eu/react-native-fast-shadow — Android shadow memory benchmark](https://github.com/alan-eu/react-native-fast-shadow)
- [facebook/react-native#20501 — elevation shadow grows per nested view](https://github.com/facebook/react-native/issues/20501)
- [Reanimated — Web Support](https://docs.swmansion.com/react-native-reanimated/docs/guides/web-support/)
- [Beyond3D — What are contact shadows?](https://forum.beyond3d.com/threads/what-are-contact-shadows-and-dynamic-radiosity.40169/) · [CraftPBR — What is an ambient occlusion map?](https://craftpbr.com/guides/what-is-an-ambient-occlusion-map)
