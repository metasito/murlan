# Can Skia load on web after the table first appears? — research pass, September 2026

Answers #1233. Ground truth read in full before this pass: #95 (resolution + owner amendment),
#105 (resolution), and `docs/research/2026-08-20-rendering-stack-2026.md` (no longer in the tree —
`docs/research/` was deleted whole-directory in commit `92ebafaf`; read via
`git show 92ebafaf~1:docs/research/2026-08-20-rendering-stack-2026.md`). #95 measured a
**blocking** load (CanvasKit fetched before the first Skia frame, gating nothing else). This
ticket asks the opposite question: what does a **lazy** load — triggered only after the table has
already painted, gating nothing on the critical path — cost.

CanvasKit's own bytes were re-fetched live from jsDelivr on **2026-09-23** rather than trusted from
#95, since a package's CDN-served compression can change; version pins were read live from the npm
registry and this repo's `package.json` on the same date. Anything not confirmed against a primary
source is flagged **[UNVERIFIED]**, matching #95's convention.

---

## Bottom line

**Yes.** `@shopify/react-native-skia` ships exactly the primitive this question needs —
`WithSkiaWeb`, a `React.lazy` + `Suspense` wrapper — so CanvasKit can be deferred to whenever a
specific component mounts, anywhere in the tree, with zero change to the app's entry point and
zero cost to everything that isn't that component. The table paints on the existing ~753 KB
gzipped bundle (#95's baseline, unchanged by this question); the Skia fetch only starts once
something asks for it.

What it costs once asked for:

| | First visit (no cache) | Repeat visit |
|---|---|---|
| CDN-hosted (jsDelivr, confirmed `immutable` 1yr cache) | **~2.9–3.4 s** at a typical "4G" throughput figure; **~16 s** at a conservative worst-case one (table below) | **~0 s network** — served from the browser's disk cache; only WASM instantiation remains |
| Self-hosted via `setup-skia-web public` into this repo's own `dist/` | same transfer cost as above, plus this server | **not actually cached** — see [§4](#4-a-repo-specific-catch-self-hosting-defeats-this-servers-own-caching): the file lands unhashed and this repo's own cache-control logic (`server/app.ts`) does not treat it as immutable, unlike CDN hosting |

The compatible version question is also cleanly resolved: `@shopify/react-native-skia@2.12.0`
(latest, 2026-09-16) installs against this repo's *current* pins — Expo `~57.0.23`,
`react-native-reanimated@4.5.1`, `react-native-worklets@0.10.1` — with **no version bumps needed
anywhere**. #95's SDK-54-era pin advice (`2.9.1`, "worklets wall" at `2.10.0`) is stale for this
repo now that it's on SDK 57.

---

## 1. The lazy-loading APIs

Source: `shopify.github.io/react-native-skia/docs/getting-started/web/` and the package's own
source (`packages/skia/src/web/LoadSkiaWeb.tsx`, `WithSkiaWeb.tsx`, fetched from
`raw.githubusercontent.com/Shopify/react-native-skia/main/...` on 2026-09-23).

**`LoadSkiaWeb(opts?)`** — the primitive both other APIs sit on:

```ts
let ckSharedPromise: Promise<CanvasKitType>;
export const LoadSkiaWeb = async (opts?: CanvasKitInitOptions) => {
  if (global.CanvasKit !== undefined) {
    return;                                   // already loaded — no-op
  }
  ckSharedPromise = ckSharedPromise ?? CanvasKitInit(opts);
  const CanvasKit = await ckSharedPromise;
  global.CanvasKit = CanvasKit;
};
```

Two things this source confirms directly: it caches on `global.CanvasKit` (a second call anywhere
in the app is free), and it takes the underlying `canvaskit-wasm` loader's own
`CanvasKitInitOptions`, whose only documented field is `locateFile(file): string` — this is the
CDN-hosting hook (below).

**`WithSkiaWeb`** — the component form, and the one that answers this ticket directly:

```tsx
<WithSkiaWeb
  getComponent={() => import("@/components/MySkiaComponent")}
  fallback={<Text>Loading Skia...</Text>}
/>
```

Its full implementation is a `React.lazy(async () => { await LoadSkiaWeb(opts); return
getComponent(); })` inside a `Suspense` boundary. This is the mechanism for "after the table has
already painted": mount `<WithSkiaWeb>` only around the specific effect (e.g. inside the bomb
moment component, not at the app root), and everything else in the tree — including the table
itself — renders and is interactive on the very first paint, completely unaware CanvasKit exists
until React reaches that subtree. The `fallback` is shown (or can be `null`) only for that
subtree while the fetch is in flight.

**Expo Router note** (`shopify.github.io/.../web/#expo`, fetched 2026-09-23): the doc's
*other* pattern — calling `LoadSkiaWeb()` once before `AppRegistry.registerComponent`, via a
custom `index.web.tsx` entry and `"main": "index"` in `package.json` — is for when you want Skia
ready *before* routing starts, which is the blocking case #95 already rejected. This repo uses
Expo Router (`app/game.tsx` etc.), so **`WithSkiaWeb` at the component level, not the entry-point
`LoadSkiaWeb` pattern, is the one that matches this question's premise** and needs no entry-point
restructuring at all.

### CDN vs self-hosted

- **Self-hosted**: `npx setup-skia-web public` copies `canvaskit-wasm/bin/full/canvaskit.wasm`
  into the project's `public/` dir (Expo copies `public/` verbatim into the web export), to be
  re-run "each time you upgrade the `@shopify/react-native-skia` package" (docs, verbatim). No
  `locateFile` override needed — it's fetched same-origin.
- **CDN-hosted**: skip `setup-skia-web` entirely and pass
  `LoadSkiaWeb({ locateFile: (file) => \`https://cdn.jsdelivr.net/npm/canvaskit-wasm@${version}/bin/full/${file}\` })`.
  Docs state plainly: "If loading CanvasKit from a CDN, running `setup-skia-web` is unnecessary."

---

## 2. What it actually weighs — measured 2026-09-23

Fetched live over HTTPS from jsDelivr (`canvaskit-wasm@0.41.0` — the version
`@shopify/react-native-skia@2.12.0`'s own `package.json` `dependencies` still pins, confirmed via
`registry.npmjs.org/@shopify/react-native-skia/2.12.0`):

| File | Raw | `Content-Encoding: gzip` (measured `Content-Length`) | `Content-Encoding: br` (measured `Content-Length`) |
|---|---|---|---|
| `bin/full/canvaskit.wasm` | 8,076,553 B | **3,272,334 B** | **3,177,276 B** |
| `bin/full/canvaskit.js` (Emscripten loader) | 123,600 B | 38,316 B | 39,299 B |
| **Total (js + wasm)** | 8,200,153 B | **3,310,650 B** | **3,216,575 B** |

(#95's original figures — 8,076,553 B raw / 3,243,559 B gzip / 3,177,276 B brotli — match on raw
and brotli exactly; gzip differs by ~29 KB, plausibly a different gzip encoder/level at jsDelivr's
edge on a different date. Brotli is the one a modern browser actually negotiates first, and it's
identical to #95's figure, so nothing has changed for this file since August.)

`jsDelivr`'s response headers (measured, both encodings) also confirm the caching claim used
below: `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable`.

### Transfer time by throughput assumption

Both "4G" throughput figures below are cited from primary tooling sources, not guessed, because
"4G" throughput varies enormously by percentile and this matters for the answer:

| Preset | Down | Source |
|---|---|---|
| WebPageTest **"4G"** | 9 Mbps, 170 ms RTT | `WPO-Foundation/webpagetest` repo, `www/settings/connectivity.ini.sample`, `[4G]` stanza (fetched 2026-09-23) |
| Lighthouse **"Slow 4G"** (labelled "4G" pre-v10; bottom 25th percentile of real 4G, top 25th of 3G) | 1.6 Mbps, 750 Kbps up, 150 ms RTT | `GoogleChrome/lighthouse` repo, `docs/throttling.md` (fetched 2026-09-23) — this is the exact preset #95's "~5 s" estimate was loosely gesturing at |

Transfer time = total bits ÷ throughput, plus one connection's RTT overhead (TLS handshake to a
CDN not already warmed, ignored for same-origin self-hosting since the table's own bundle already
paid it):

| Payload (br, real jsDelivr bytes) | WebPageTest "4G" (9 Mbps) | Lighthouse "Slow 4G" (1.6 Mbps) |
|---|---|---|
| 3,216,575 B = 25,732,600 bits | **2.86 s** + ~0.2–0.4 s connection overhead ≈ **3.1–3.3 s** | **16.1 s** + overhead ≈ **~16.3 s** |

So: **first visit, the Skia-drawn effect becomes available roughly 3 seconds after being asked
for, on a decent 4G connection, or as much as 16 seconds on a poor one** — while, per §1, every
other pixel on the table is already painted and interactive the entire time. That is the
qualitative change from #95's blocking-load framing: the number is the same bytes, but it no
longer gates first paint, so it stops being "5 seconds of blank screen" and becomes "the bomb
shader isn't ready yet if you trigger it in the first few seconds on a bad connection" — a very
different product cost.

### Repeat visit

- **CDN-hosted**: the measured `Cache-Control: public, max-age=31536000, immutable` header means
  a browser that has fetched this exact URL before **does not re-request it at all** — served
  straight from disk cache, ~0 network time, for a full year or until the version pin changes. This
  is the best-case repeat-visit cost and needs no work in this repo to get.
- **Self-hosted**: see §4 below — this repo's own server does not give the file that guarantee by
  default.
- Either way, a **repeat visit still pays WASM instantiation** (parse + compile), not just the
  network fetch — see §5 for why this is smaller than it looks, and why an exact number is
  **[UNVERIFIED]**.

---

## 3. Mechanics and gotchas carried over from #95, re-verified 2026-09-23

- **WebGL context limit** (browsers cap ~16 per page): unchanged, still documented, `<Canvas
  __destroyWebGLContextAfterRender>` is the mitigation, at an animation-performance cost. Fine for
  one table canvas; wrong for a canvas per card.
- **Four APIs unsupported on web**: `PathEffectFactory.MakeSum()`, `PathEffectFactory.MakeCompose()`,
  `PathFactory.MakeFromText()`, `ShaderFilter` — same four as #95, confirmed still listed on the
  current docs page.
- **Metro / Node builtins friction** (#95's citation of issues #1243/#1774/#2192/#2484): not
  re-verified in this pass — out of scope for the lazy-loading question specifically, since
  `WithSkiaWeb`'s dynamic `import()` is exactly the code-splitting boundary that sidesteps most of
  that class of failure (the Skia-importing module is never in the initial Metro bundle at all).

---

## 4. A repo-specific catch: self-hosting defeats this server's own caching

This is new to this pass — #95 didn't examine this repo's static-serving code, because the
blocking-load question didn't need to.

`server/app.ts`'s cache-control logic (`setDistCacheControl`) only grants the year-long immutable
cache to files whose name matches `CONTENT_HASHED`
(`server/http/staticPaths.ts:10` — `/[.-][0-9a-f]{32}(@[0-9]+x)?\.[^.]+$/`, a 32-hex-char hash
segment before the extension, matching this build's `entry-<hash>.js` naming). `setup-skia-web`
copies `canvaskit.wasm` with that literal name — no hash — into `public/`, which Expo copies
verbatim into `dist/` on export. That filename **does not match** `CONTENT_HASHED`, so if it were
self-hosted through this server, it would fall through to `Cache-Control: no-cache`
(`server/app.ts:200`) — the same treatment as `index.html`, i.e. a conditional-GET round trip on
every single visit, never a true cache hit.

**CDN hosting (jsDelivr's `locateFile` override) sidesteps this entirely** and is the simpler
choice for that reason alone, independent of the transfer-time numbers above: it needs no change
to this repo's caching code, and jsDelivr already serves the file `immutable`. Self-hosting is
still viable, but only if the version-locking is done by URL (e.g. serving it at a
version-stamped path) rather than trusting the plain filename to get long-cache treatment for
free.

---

## 5. iOS Safari — iPhone 16 Pro

- **Streaming compilation, confirmed used**: `canvaskit.js`'s Emscripten-generated loader calls
  `WebAssembly.instantiateStreaming` (grepped directly from the fetched file, 2 matches, 2026-09-23)
  — the loader does **not** wait to buffer the whole 8 MB into an `ArrayBuffer` before compiling;
  compilation streams as bytes arrive, off the fetch itself. MDN's compatibility data states
  `instantiateStreaming` reached **Baseline "Widely available", supported across browsers since
  September 2021** — an iPhone 16 Pro (a 2024 device, shipped on iOS 18+) is comfortably past that
  by any supported OS version. Net effect: no blocking full-buffer compile step on iOS Safari for
  this file, which was historically the failure mode worth worrying about for large WASM on Safari.
- **Compile/instantiate time itself, on an A18 Pro, for this specific 8 MB binary**: no primary
  source states a number, and I did not have a device to measure on. **[UNVERIFIED]** — flagged,
  not guessed. Qualitatively: streaming compilation plus a modern high-end SoC argues this is a
  sub-second-to-low-single-digit-second cost layered on top of the transfer time in §2, not
  something that dominates it, but that is reasoning, not a measurement.
- **WASM/canvas memory ceiling on current iOS Safari**: unchanged from #95, re-checked 2026-09-23
  and still no update found. The only hard number is Apple Developer Forums thread 112218's
  **224 MB total canvas memory limit, introduced at iOS 12** — explicitly historical, not current.
  Recent (2025–2026) WebGL memory/crash reports (Apple Developer Forums thread 778735) corroborate
  ongoing GPU-memory fragility on iOS 18.2–18.4 but give no hard current figure. **[UNVERIFIED]**
  as a current ceiling, same status as #95 left it.

---

## 6. Compatible version for this repo's *current* pins

This repo's `package.json`, read 2026-09-23:

| Package | Pinned |
|---|---|
| `expo` | `~57.0.23` |
| `react-native` | `0.86.3` |
| `react-native-reanimated` | `4.5.1` |
| `react-native-worklets` | `0.10.1` |

`@shopify/react-native-skia`'s peer-dependency history, read live from `registry.npmjs.org`
(2026-09-23):

| Version | Published | Peer deps |
|---|---|---|
| 2.9.1 | 2026-07-22 | `react-native-reanimated >=3.19.1` (no worklets floor) |
| **2.10.0** | 2026-07-23 | **adds `react-native-worklets >=0.7.0`**, `react-native-reanimated >=4.0.0` |
| **2.12.0** (`dist-tags.latest`) | 2026-09-16 | `react-native >=0.78`, `react-native-worklets >=0.7.0`, `react-native-reanimated >=4.0.0` |

Every floor from 2.10.0 onward is already cleared by this repo's current pins
(worklets `0.10.1 >= 0.7.0`; reanimated `4.5.1 >= 4.0.0`; RN `0.86.3 >= 0.78`). **`npm install
@shopify/react-native-skia@2.12.0` installs today with zero changes to any other pin.**

One nuance worth recording: `npx expo install @shopify/react-native-skia` — the normal Expo
workflow — would instead install **whatever SDK 57 bundles**, which is `2.6.2` (read from
`raw.githubusercontent.com/expo/expo/sdk-57/packages/expo/bundledNativeModules.json`, fetched
2026-09-23), a version that predates the worklets floor entirely and is also fine against this
repo's pins, just older (2026-08-06 vs the 2.6.2 line's earlier date — the SDK pin lags upstream
by design, same pattern #95 already noted for SDK 54). Either the `expo install` pin or a manual
bump to `2.12.0` works; neither requires moving Expo, Reanimated or worklets.

**This makes #95's SDK-54-era caveat moot for this repo**: the "worklets wall" it warned about
(`2.10.0+` needing `worklets >=0.7.0` against SDK 54's pinned `0.5.1`) doesn't exist here — SDK 57
already ships worklets `0.10.1`.

---

## Explicitly unverified

1. WASM compile/instantiate wall-clock time for this specific 8 MB CanvasKit binary on an A18 Pro
   / iOS Safari — no primary source, no device measurement in this pass.
2. Current (iOS 18.x) canvas/GPU memory ceiling in mobile Safari — same gap #95 left; only a
   historical iOS-12-era 224 MB figure found, re-checked 2026-09-23.
3. Metro/Node-builtins friction (#95 §1, issues #1243/#1774/#2192/#2484) specifically *through* the
   `WithSkiaWeb` dynamic-import code-splitting path — plausible it's avoided by construction, not
   re-tested.
4. Real-world 4G throughput distribution for this app's actual player base (e.g. Albania
   specifically) — the two cited presets (WebPageTest "4G", Lighthouse "Slow 4G") are general
   web-industry testing conventions, not measurements of this app's traffic.

---

## Sources

Fetched live 2026-09-23 unless noted.

- `shopify.github.io/react-native-skia/docs/getting-started/web/` (and `#expo` anchor)
- `raw.githubusercontent.com/Shopify/react-native-skia/main/packages/skia/src/web/LoadSkiaWeb.tsx`
- `raw.githubusercontent.com/Shopify/react-native-skia/main/packages/skia/src/web/WithSkiaWeb.tsx`
- `registry.npmjs.org/@shopify/react-native-skia` (full version/time/peerDependencies map),
  and `/2.12.0` for its `canvaskit-wasm` dependency pin
- `raw.githubusercontent.com/expo/expo/sdk-57/packages/expo/bundledNativeModules.json`
- `cdn.jsdelivr.net/npm/canvaskit-wasm@0.41.0/bin/full/canvaskit.wasm` and `canvaskit.js` — raw
  bytes and `HEAD` responses with `Accept-Encoding: br` / `gzip`, measured directly
- `docs.expo.dev/versions/latest/sdk/skia/`
- `github.com/WPO-Foundation/webpagetest`, `www/settings/connectivity.ini.sample`
- `github.com/GoogleChrome/lighthouse`, `docs/throttling.md`
- `developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/instantiateStreaming_static`
  (Baseline compatibility statement)
- Apple Developer Forums threads 112218, 778735 (unchanged from #95, re-checked)
- This repo: `server/app.ts` (`setDistCacheControl`, `configureExpoAndLanding`),
  `server/http/staticPaths.ts` (`CONTENT_HASHED`), `package.json`
- `docs/research/2026-08-20-rendering-stack-2026.md` at `92ebafaf~1` (pre-deletion) — #95's full
  ground-truth document
- #95, #105 (`gh issue view --comments`)
