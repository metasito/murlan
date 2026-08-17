# B1 — Performance

Audit of `C:\Users\roton\murlan` at `b894af461550cd1a184a6a6f1694baf10d27b70c`, branch `main`.
Prefix `PERF`. Read-only: nothing in the repo was modified. All scripts were written to and run
from the session scratchpad.

**Ranking rule used:** the app's hot surface is the game table, in landscape, during a hand, on a
mid-range phone — plus the one thing every player pays before they ever see it, the web first
load. Everything below says who notices and when.

**Measurements actually taken** (not estimates):

| What | Method | Result |
|---|---|---|
| React Compiler coverage | compiled every `.tsx` under `app/ components/ context/` with `babel-plugin-react-compiler@19.0.0-beta-ebf51a3-20250411` at the exact options `babel-preset-expo` uses | 48 functions memoized, **40 components bail out** |
| Web JS bundle | `dist/_expo/static/js/web/entry-7d796cc7….js` | 3,278,455 B raw / 841,002 B gzip -9 / 653,731 B brotli -11 |
| Blocking fonts | the 7 TTFs `app/_layout.tsx:55-63` loads, measured in `dist/` | 2,475,596 B (2.36 MB) |
| Dead icon glyph maps in bundle | probed 3 distinctive glyph names per family against the built bundle | 16 families present, 0.62 MB JSON; app uses 2 |
| `game:state` payload | serialized a real `initializeGame` state through `sanitizeStateForPlayer` | 4p opening broadcast 6,214 B; a full 4p hand = 79 mutations, 316 emits, 365 KB |
| Replay `moves` jsonb | serialized one real 4p hand's move log | 82 moves, 9,150 B → ~179 KB read per `GET /api/replays` |
| SVG nodes on the felt | mirrored `CardView`'s render against `cardFaceModel.PIP_LAYOUTS` | 4p opening ≈ 383 nodes / 31 `CardView`s; 2p worst case 491 nodes for the hand alone |
| Assets | `Get-ChildItem -Recurse` + PNG IHDR headers | matches `docs/BUNDLE.md`; `icon.png`/`splash-icon.png` are 1024×1024 8-bit **RGB** |

---

### [PERF-01] Enable HTTP compression on the Express server

- **Severity:** High
- **Confidence:** High (read the code, measured the artefacts)
- **Effort:** S (<1h)
- **Location:** `server/testApp.ts:116-127`, `package.json` (no `compression` dependency)
- **Problem:** Nothing in the server compresses a response. `express.static(distPath)`
  (`server/testApp.ts:121`) and `res.sendFile(webIndexPath)` (`:125`) send raw bytes, there is no
  `compression` middleware anywhere in `server/`, `compression` is in neither `dependencies` nor
  `devDependencies`, and `expo export` emits no precompressed siblings (`find dist -name "*.gz" -o
  -name "*.br"` → 0 files). Grepping all of `server/*.ts` for `compression|Content-Encoding|gzip|
  brotli` returns nothing.
- **Impact:** Every first-time web visitor downloads **3,278,455 B of JavaScript** that would be
  841,002 B gzipped or 653,731 B brotli-compressed — a 2.4 MB / 2.6 MB penalty per cold load — plus
  2.36 MB of raw TTF (PERF-02). That is ~5.9 MB before the app paints anything. On a 10 Mbps 4G
  connection that is roughly 5 s of blank page; on a congested mobile link it is tens of seconds.
  The player base is mobile web, so this is paid by everyone, every cold load. The
  `performance` skill's budget for compressed JS is 300 KB; the app is at 841 KB gzip and 3.13 MB
  as actually served.
- **Repro / proof:**
  ```
  $ ls -l dist/_expo/static/js/web/entry-7d796cc700c39d2b51a586aa28e94600.js
  3278455
  $ gzip -9 -c <that file> | wc -c      ->  841002
  $ brotli -q 11 -c <that file> | wc -c ->  653731
  $ grep -rn "compression|Content-Encoding|gzip|brotli" server/*.ts  ->  no matches
  $ node -e 'p=require("./package.json");console.log(p.dependencies?.compression, p.devDependencies?.compression)'
  undefined undefined
  ```
- **Proposed fix:** Add `compression` to `dependencies` and mount it in `createApp()`
  (`server/testApp.ts`) **before** the static handlers at `:116-121` and before `registerRoutes` —
  i.e. immediately after the body parsers at `:207`. Default options are correct here (it skips
  already-compressed types and responses under 1 KB). If a brotli path is wanted later, generate
  `.br`/`.gz` siblings in `npm run expo:web:build` and serve them with `express-static-gzip`; do
  **not** do both.
- **Acceptance criteria:** `curl -sI -H 'Accept-Encoding: gzip, br' http://localhost:5000/_expo/static/js/web/entry-*.js`
  returns `Content-Encoding: gzip` (or `br`) and a `Content-Length` under 900,000. Same for
  `/index.html` and for every `.ttf` under `/assets/`. `npm run verify` still passes.
- **Fix risk:** `compression` buffers and re-encodes; it must not sit in front of the Socket.io
  upgrade path. Mounting it in `createApp()` before `setupSocket(httpServer)` (`server/testApp.ts:234`)
  is safe because Socket.io attaches to the raw `http.Server`, not to the Express middleware chain —
  verify with `tests/integration/gameplay.test.ts` that websocket traffic is unaffected. Also confirm
  Replit's Cloud Run ingress does not double-encode.
- **Depends on:** None

---

### [PERF-02] Stop blocking first paint on 2.36 MB of uncompressed TTF

- **Severity:** High
- **Confidence:** High (read the code, measured the fonts)
- **Effort:** M (a few hours)
- **Location:** `app/_layout.tsx:55-63` (the seven fonts), `app/_layout.tsx:76` (the gate)
- **Problem:** `RootLayout` returns `null` until every one of seven Google-font TTFs has loaded:

  ```ts
  if ((!fontsLoaded && !fontError) || !localeReady) return null;   // app/_layout.tsx:76
  ```

  Measured from `dist/`, those seven files are 2,475,596 B — Rajdhani 400/500/600/700 at
  352/358/364/373 KB and Inter 400/500/600 at 342/343/344 KB. `dist/index.html` contains no splash
  markup and no `<link rel=preload>` for any of them; the only element in `<body>` is `<div id="root">`.
  So the user looks at an empty page for the whole download.

  One of the seven is loaded for nothing: **`Rajdhani_400Regular` is referenced by zero styles.**
  `grep -rho '"Rajdhani_400Regular"' app components lib context` outside `_layout.tsx` returns 0 hits,
  against 66 for `Rajdhani_700Bold` and 28 for `Rajdhani_600SemiBold`.
- **Impact:** Every web visitor, on every cold load, waits for 2.36 MB of font data before a single
  pixel of Murlan renders — with no splash, no skeleton and no text. Combined with PERF-01 (these
  TTFs are served uncompressed too; TTF gzips roughly 50%) this is the dominant term in the app's
  LCP. 352 KB of it is a font nothing uses.
- **Repro / proof:**
  ```
  Rajdhani_400Regular   352088 B   used in styles: 0
  Rajdhani_500Medium    357884 B   used in styles: 1
  Rajdhani_600SemiBold  363500 B   used in styles: 28
  Rajdhani_700Bold      373192 B   used in styles: 66
  Inter_400Regular      342408 B   used in styles: 47
  Inter_500Medium       342892 B   used in styles: 13
  Inter_600SemiBold     343632 B   used in styles: 8
  TOTAL 2,475,596 B
  ```
  `dist/index.html` (34 lines) has one `<script … defer>` and no font preload.
- **Proposed fix:** Three independent steps, in increasing effort:
  1. Delete `Rajdhani_400Regular` from the import at `app/_layout.tsx:20` and from the `useFonts`
     map at `:56`. −352 KB, zero visual change.
  2. Narrow the gate at `:76` to `if (!localeReady) return null;` and let the fonts arrive
     asynchronously. `useFonts` already returns `fontError`, and the existing
     `SplashScreen.hideAsync()` effect at `:70-74` already tolerates the error case, so the app is
     designed to survive fonts not resolving. The cost of not blocking is one reflow when the
     fonts land; the cost of blocking is a blank screen for the whole download.
  3. Ship web-specific WOFF2 subsets. `@expo-google-fonts/*` ships TTF only. Add a
     `Platform.OS === "web"` branch that registers Latin-subset WOFF2 files (a Latin subset of
     Rajdhani/Inter is ~25-30 KB each, so ~200 KB for all seven versus 2.36 MB) via a `@font-face`
     block in `dist/index.html`, keeping `useFonts` for native. Generate the subsets in
     `scripts/build.js` so no local tooling is needed at deploy time on Replit.
- **Acceptance criteria:** Steps 1+2: on a cold web load with the network throttled, the title
  screen's layout is on screen before the fonts finish, and the six remaining families still
  resolve (no fallback glyphs once loaded). `tests/native/theme.test.tsx` and the Playwright
  specs still pass. Step 3: total font bytes fetched on a web cold load is under 300 KB, measured
  in the browser network panel.
- **Fix risk:** Step 2 makes the first frame render in the fallback font, so any layout that
  depends on Rajdhani's metrics can shift once. `components/gameTableModel.ts`'s pinned layout
  constants are pixel values, not font-derived, so the table is unaffected; the menu screens use
  flexbox. `tests/e2e/tableFit.spec.ts` and `tests/e2e/tapTargets.spec.ts` are the ones that would
  catch a regression, and neither runs in CI (map §12) — run them locally for this change.
- **Depends on:** None (PERF-01 reduces the same bytes by ~50% and is complementary, not a substitute)

---

### [PERF-03] Get the game table back under the React Compiler, and memoize the card components

- **Severity:** High
- **Confidence:** High (compiled the files and read the compiler's output)
- **Effort:** M (a few hours)
- **Location:** `components/GameTable.tsx:383` and its six suppressions at `:646, :665, :717, :731, :742, :754`; `components/GameShared.tsx:610` (`CardItem`), `:514` (`PlayedPile`), `:173` (`AvatarCircle`), `:968` (`useTurnPulse`), `:1223` (`GameBillboard`), `:364` (`FlyingCards`); `components/CardView.tsx:462` and its suppressions at `:493, :501`; `app/(online)/game.tsx:43` and `:134`; `app/game.tsx:33` and `:56-60`
- **Problem:** `app.json:59` sets `experiments.reactCompiler: true`, which
  `@expo/metro-config/build/babel-transformer.js:81` turns into `supportsReactCompiler`, which
  `babel-preset-expo/build/index.js:74-92` turns into `babel-plugin-react-compiler` with
  `panicThreshold: 'NONE'` in production — i.e. **a component the compiler cannot handle is
  silently left uncompiled.** Compiling the repo's client code with exactly those options shows
  **40 components bail out**, and they are precisely the ones on the hot path.

  Two distinct causes, both provable:

  1. **`eslint-disable-next-line react-hooks/*` opts a component out entirely.** 45 of the 72
     bailout events say *"React Compiler has skipped optimizing this component because one or more
     React ESLint rules were disabled."* Recompiling each file with only those comment lines
     removed proves the causation:

     | file | as-is | suppressions removed |
     |---|---|---|
     | `components/CardView.tsx` | 7 functions memoized, `CardView` (`:462`) bails | **8 memoized, zero bailouts** |
     | `components/GameShared.tsx` | 7 memoized; bails at `:173, :364, :514, :610, :968, :1223` | **12 memoized**, only `FlyingCards` still bails |

  2. **`GameTable` additionally bails on its own `useMemo`s.** With suppressions stripped it still
     reports *"the existing manual memoization could not be preserved"* against `:456, :468, :472,
     :486, :505, :520` and *"this dependency may be mutated later"* against `:470, :474, :559, :561,
     :562, :570`. `app/(online)/game.tsx:43` and `app/game.tsx:33` bail on a single cause each —
     writing a ref during render (`goToLobbyRef.current = goToLobby` at `game.tsx:134`;
     `runAITurnRef/passTurnRef/chooseExchangeRef` at `app/game.tsx:56-60`).

  **There is no `React.memo` anywhere in the repo** (`grep -rn "React.memo\|memo("` over
  `app components context lib`, excluding `useMemo` → zero hits), so nothing catches what the
  compiler dropped.

  The consequence is exact and mechanical. `StraightHand` *is* compiled, and its compiled output
  guards the card list on `onPress`:

  ```js
  if ($[20] !== cards || $[21] !== dealArmed || $[22] !== disabled || $[23] !== faceDown
      || $[24] !== onPress || $[25] !== selectedSet || $[26] !== step || $[27] !== totalW) {
    …  t9 = cards.map(t10);   // rebuilds every <CardItem>
  ```

  `onPress` is `handleCardPress`, declared as a plain arrow at `components/GameTable.tsx:809` inside
  an **uncompiled** component — so it is a new reference on every single render of `GameTable`. The
  guard misses every time, every `CardItem` element is rebuilt, and `CardItem` and `CardView` (both
  uncompiled, neither `React.memo`'d) re-render in full.
- **Impact:** Every render of `GameTable` rebuilds the entire hand. Measured: a 4-player opening
  hand is 14 `CardView`s totalling ~264 `react-native-svg` element nodes, plus 17 face-down fan
  cards for ~119 more — ~383 SVG nodes on the felt; a 2-player hand is 27 cards / 491 nodes for the
  hand alone. On web those are real DOM elements with per-attribute diffing on the main thread.

  `GameTable` renders far more often than the game changes. Per opponent move the sequence is:
  `game:state` arrives (render 1) → the pile effect at `:602-647` sets `pileState` + `flyInfo`
  (render 2) → 380 ms later `FlyingCards.onDone` sets `flyInfo=null` + `pileBounceTrigger`
  (render 3) → on a round win `setRoundWinner` (render 4) and its 1800 ms dismissal (render 5).
  Three to five full hand rebuilds where one is warranted. On top of that, `giocaPressed` /
  `passaPressed` (`:439-440`) are React state, so **pressing GIOCA re-renders every card twice** —
  once on press-in, once on press-out.

  Who notices: every player, on every move, on the one screen that has to stay at 60 fps.
- **Repro / proof:** Compile any hot-path file with the project's own compiler options and read
  the `logEvent` stream — e.g. `components/CardView.tsx` reports
  `CompileError @462 -> React Compiler has skipped optimizing this component because one or more
  React ESLint rules were disabled`, and the same file with lines 493 and 501 deleted reports zero
  bailouts and one extra memoized function. Repo-wide tally over `app/ components/ context/`:
  48 functions memoized, 40 components bailing, 45/72 events attributable to the suppressions.
- **Proposed fix:** In dependency order:
  1. **Remove the suppressions rather than the deps they hide.** Most of them guard a `useEffect`
     that omits a `useSharedValue` handle. A shared value is a stable object, so *adding* it to the
     dependency array is behaviourally identical and satisfies `react-hooks/exhaustive-deps`
     honestly. Do this for `components/CardView.tsx:493,501`, `components/GameShared.tsx:207,216,
     537,544,659,669,996,1260`. That alone restores `CardView`, `CardItem`, `AvatarCircle`,
     `PlayedPile`, `useTurnPulse` and `GameBillboard` — the six per-card and per-frame components.
  2. **Stop writing refs during render** at `app/(online)/game.tsx:134` and `app/game.tsx:56-60`.
     Assign inside a `useEffect` (the values are only read from timers, which fire after commit,
     so an effect-time assignment is sufficient), or replace the ref-plus-reassign idiom with a
     `useCallback`. That is the sole remaining cause for both screens.
  3. **For `GameTable` itself**, the cheapest correct move is to keep the hand-critical props
     stable by hand rather than fight the compiler: wrap `handleCardPress` (`:809`), `handlePlay`
     (`:815`) and `handlePass` (`:822`) in `useCallback`, and wrap `CardItem` and `CardView` in
     `React.memo`. Do this even after step 1 — it is what makes the hand immune to `GameTable`
     re-rendering for reasons that have nothing to do with the cards (PERF-06).
  4. Move `giocaPressed` / `passaPressed` (`:439-440`) into the shared values that already exist
     next to them (`giocaPressVal` / `passaPressVal`), or into a small child component, so a button
     press does not re-render the table. The gradient swap needs React state only for the
     `LinearGradient colors` array; isolating it into a `GiocaButton` child is the smaller change.
- **Acceptance criteria:** Recompiling `components/CardView.tsx`, `components/GameShared.tsx`,
  `app/game.tsx` and `app/(online)/game.tsx` with `babel-plugin-react-compiler` reports **zero**
  `CompileError` events. `npx expo lint` still reports 0 problems (i.e. the suppressions were
  removed by fixing the dependency arrays, not by weakening the lint config — a suppression traded
  for an `eslint.config.js` rule-off is the self-defeating-safeguard shape CLAUDE.md forbids).
  `npm run verify` passes. In a React DevTools profile of one opponent move on the online table,
  the number of committed `CardView` renders drops from ~31 per table render to 0 for renders that
  do not change `cards` or `selectedIds`.
- **Fix risk:** Adding a genuinely-changing value to a dependency array that was suppressed for a
  reason will re-fire an effect. Two of the suppressions state a real constraint and must be read
  before touching: `components/GameTable.tsx:646` (re-firing the pile logic on unrelated updates
  breaks the flying-card invariant CLAUDE.md marks load-bearing) and `:665` (adding `players` would
  reschedule the round-winner dismissal timer forever). Neither of those two is required for step 1.
  `React.memo` on `CardView` changes nothing semantically as long as `onPress` is stabilized first —
  do steps 1-3 together, not step 3 alone.
- **Depends on:** None

---

### [PERF-04] Import icon families by path instead of from the `@expo/vector-icons` barrel

- **Severity:** Medium
- **Confidence:** High (probed the built bundle)
- **Effort:** S (<1h)
- **Location:** 23 files importing `from "@expo/vector-icons"` — including `components/GameTable.tsx:35`, `components/GameShared.tsx:19`, `app/(online)/game.tsx:12`; `docs/BUNDLE.md:101`
- **Problem:** Every icon import goes through the package barrel. The app uses exactly two
  families — `Ionicons` (21 files) and `Feather` (2 files) — but the barrel drags in all of them.
  Probing the built web bundle with three distinctive glyph names per family shows **16 families'
  glyph maps are present**, totalling 0.62 MB of JSON source: `MaterialCommunityIcons` (217 KB),
  `FontAwesome6Pro` (119 KB), `FontAwesome6Free` (59 KB), `MaterialIcons` (55 KB),
  `FontAwesome5Pro` (53 KB), `FontAwesome5Free` (33 KB), `FontAwesome` (17 KB), `Fontisto`,
  `AntDesign`, `Entypo`, `Foundation`, `Octicons`, `SimpleLineIcons`, `EvilIcons`, plus the two
  that are used. Metro correspondingly emitted **42 `.ttf` files totalling 11.54 MB** into
  `dist/assets/`, of which the browser will ever request two.

  `docs/BUNDLE.md:101` asserts the opposite and is why nobody has looked: *"Metro tree-shakes
  per-file imports, so packages that bundle many assets internally (`@expo/vector-icons`,
  `@expo-google-fonts/*`) only contribute the specific icon families / font weights actually
  imported, not their full installed size."* The build output disproves it for both packages named.
- **Impact:** Roughly 580 KB of dead glyph-map JSON (0.62 MB present minus 42 KB for Ionicons +
  Feather) inside a 3.13 MB bundle that every web visitor downloads, parses and executes on every
  cold load — ~19% of the raw bundle, and it is parse-and-execute cost on the main thread, not just
  transfer. It also inflates `dist/` to 17 MB, which is Replit build and cold-start weight.
- **Repro / proof:** `node_modules/@expo/vector-icons/Ionicons.js` and `Feather.js` exist as
  first-class entry points. Probing `dist/_expo/static/js/web/entry-7d796cc7….js` for glyph names
  unique to unused families returns hits: `account-cowboy-hat` and `zodiac-sagittarius`
  (MaterialCommunityIcons) → 1 each; `amazon-pay` (FontAwesome5) → 4; `nav-icon-a` (Fontisto) → 1.
  Only `FontAwesome6Pro_meta.json` (669 KB) is genuinely absent.
- **Proposed fix:** Replace `import { Ionicons } from "@expo/vector-icons"` with
  `import Ionicons from "@expo/vector-icons/Ionicons"` in all 23 files (and the same for `Feather`
  in the two that use it). Then correct or delete the false claim at `docs/BUNDLE.md:101` — under
  the standing "docs are evidence, not authority" rule it must not survive being disproved.
  Optionally add a `tests/` source-scan asserting no file imports from the bare
  `"@expo/vector-icons"` specifier, in the style of `tests/tokenRoles.test.ts`.
- **Acceptance criteria:** After a fresh `npm run expo:web:build`, probing the new `entry-*.js` for
  `account-cowboy-hat`, `amazon-pay` and `nav-icon-a` returns 0 hits each, and `find dist -name
  "*.ttf" | wc -l` drops from 42 to the Google fonts plus 2. Raw entry-bundle size drops by roughly
  0.5 MB. Every icon still renders (`tests/native/*` and a manual pass over the table, menus and
  the online screens).
- **Fix risk:** Low and mechanical. The two risks are missing a file (typecheck catches it, since
  the default export is typed) and `@expo/vector-icons` changing its subpath layout on an Expo SDK
  bump — the subpaths are the documented public API, so this is the supported form.
- **Depends on:** None

---

### [PERF-05] Stop animating `box-shadow` every frame on the container that holds the hand

- **Severity:** Medium
- **Confidence:** High for the code path; Medium for the magnitude (not measured in a browser)
- **Effort:** S (<1h)
- **Location:** `components/GameShared.tsx:968-1029` (`useTurnPulse`), `components/GameTable.tsx:697-718` and `:786-804` (`giocaGlowVal` / `giocaGlowStyle`), applied at `components/GameTable.tsx:1010` and `:1076`
- **Problem:** Two `withRepeat(…, -1)` loops run continuously while it is the local player's turn,
  and both drive a **`boxShadow` string** rather than a compositable property:

  ```ts
  // GameShared.tsx:1008-1016 — the style applied to the hand section
  if (Platform.OS === "web") {
    return { boxShadow: v < 0.01 ? "none" : `0 0 ${blur}px rgba(201,168,76,${alpha})`,
             borderRadius: 14, borderTopWidth: 1,
             borderTopColor: `rgba(201,168,76,${borderAlpha})` } as any;
  }
  ```

  On web there is no UI thread — reanimated takes the `SHOULD_BE_USE_WEB` branch in
  `node_modules/react-native-reanimated/lib/module/updateProps/updateProps.js:9-20`, which calls
  `_updatePropsJS` and writes inline styles from the **main JS thread**. So every animation frame,
  for the whole of the player's turn, the main thread builds two strings and writes
  `box-shadow` + `border-top-color` inline — neither of which the browser can composite; both
  invalidate paint. `useTurnPulse`'s target (`components/GameTable.tsx:1005-1012`) is the container
  of `StraightHand`, i.e. of all 14-27 cards and their ~264-491 SVG nodes.

  The codebase already knows the right technique and applies it twice elsewhere:
  `sharedStyles.cardGlow` (`GameShared.tsx:1188`) is described as *"a textless sibling behind the
  card [that] carries the selection bloom, so the glow can be animated with opacity alone"*, and
  `avatarRing`/`avatarPing` (`:1075-1085`) do the same for the avatar. The hand section and the
  GIOCA button did not get it.
- **Impact:** Continuous main-thread paint work on the hot screen for as long as it is your turn —
  competing with socket message handling, the 30 s countdown's `setInterval`, and the
  full-hand re-renders of PERF-03. On a mid-range phone in a browser this is the difference between
  a still table and a table that stutters while you are choosing a card.
- **Repro / proof:** `useTurnPulse(active)` is called unconditionally at
  `components/GameTable.tsx:805` with `isMyTurn && !isFinished && !exchange.active`; when active it
  starts `withRepeat(withSequence(withTiming(0.85,{duration:900}), withTiming(0.35,{duration:900})),
  -1, false)` (`GameShared.tsx:981-988`) — an unbounded loop. `giocaGlowVal` does the same for
  `playBtnValid` (`GameTable.tsx:697-706`). Both feed `useAnimatedStyle` bodies that return
  `boxShadow`.
- **Proposed fix:** For both, move the glow onto a `pointerEvents="none"`, absolutely-positioned,
  childless sibling `Animated.View` carrying a **static** `boxShadow` (a token value, so
  `tests/tokenRoles.test.ts` stays happy) and animate only its `opacity`. That is exactly the
  `cardGlow` pattern already in `sharedStyles`. `useTurnPulse` then returns an opacity-only animated
  style and the caller renders the sibling; the animated `borderTopColor` becomes a static
  `borderTopColor` on the same sibling, faded by the same opacity.
- **Acceptance criteria:** No `useAnimatedStyle` in `components/` returns `boxShadow`,
  `shadowRadius`, `shadowOpacity`, `elevation` or a `border*Color` string — assert it with a
  source-scan test alongside `tests/motion.test.ts`, which already scans for inline springs. The
  glow looks unchanged at both extremes of the pulse. `tests/reducedMotion.test.ts` still passes
  (the reduced-motion branches at `GameShared.tsx:973-977` and `GameTable.tsx:709-712` must survive).
- **Fix risk:** The native branch (`GameShared.tsx:1019-1027`) uses `shadowRadius`/`elevation`,
  which behave differently on a sibling than on the container — check the glow still reads on
  Android, where `elevation` also affects z-ordering. `tests/vignette.test.ts` and
  `tests/native/theme.test.tsx` are the nearest guards.
- **Depends on:** None

---

### [PERF-06] Take `reactions` out of the shared online-game context value

- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `context/OnlineGameContext.tsx:132` (state), `:358-366` (the handler), `:603-643` (the context value and its 34-entry dependency array), `app/(online)/game.tsx:277`
- **Problem:** `reactions` is one of the 34 fields in the single memoized context value. An
  incoming `game:reaction` runs `setReactions` (`:360`) and, 2.5 s later, a second `setReactions`
  to remove it (`:363`). Each one invalidates the `useMemo` at `:603`, so `OnlineGameScreen`
  re-renders, so `GameTable` re-renders, so — per PERF-03 — every card in the hand is rebuilt. The
  emoji itself is rendered by `FloatingReactions` (`app/(online)/game.tsx:277`), which is a leaf in
  the `overlays` slot and has nothing to do with the cards.

  `server/socket.ts:1767` rate-limits reactions at `{ limit: 8, windowMs: 10_000 }` **per user**,
  and broadcasts to the whole room. Four seats therefore permit 32 reactions per 10 s, each costing
  two full table re-renders on every client.
- **Impact:** One player holding down the emoji picker makes every other player's table re-render
  its entire hand up to ~6 times a second. That is griefing with no cheat and no error message —
  the table simply becomes sluggish for everyone while it happens. It is also the everyday case at
  a lower rate: a normal round of banter costs a hand rebuild per emoji per client.
- **Repro / proof:** `onReaction` at `context/OnlineGameContext.tsx:358-366` calls `setReactions`
  twice per emoji; `reactions` is listed in the dependency array at `:642`; `app/(online)/game.tsx:50`
  destructures it and passes it only to `<FloatingReactions>` at `:277`.
- **Proposed fix:** Give reactions their own tiny provider (or the same
  `useSyncExternalStore` module-store shape already used by `lib/cosmetics.ts` and
  `lib/accessibility.ts`, both of which exist for exactly this reason) and have `FloatingReactions`
  subscribe to it directly. `OnlineGameContext` keeps owning the socket listener and pushes into
  the store; `reactions` leaves the context value and its dependency array. `app/(online)/game.tsx`
  then renders `<FloatingReactions />` with no props.
- **Acceptance criteria:** `reactions` no longer appears in `context/OnlineGameContext.tsx`'s
  context value or its dependency array. Emoji still appear, still rise, and still disappear after
  2.5 s (the timers at `:361-365` and their cleanup at `:478-479` must move with the state). In a
  React DevTools profile, sending an emoji commits `FloatingReaction` and nothing else.
- **Fix risk:** The cleanup at `context/OnlineGameContext.tsx:478-479` clears the pending removal
  timers on unmount; moving the state without moving that cleanup leaks a `setState` after unmount.
  Reactions are not covered by any test, so this change is verified by hand or by a new one.
- **Depends on:** None. PERF-03 reduces the blast radius of each re-render but does not stop the
  re-render itself.

---

### [PERF-07] Make the replay list read only what it uses, and index the ownership predicate

- **Severity:** Medium
- **Confidence:** High for the query shapes (read the code and the schema); Medium for the scan claim (no `EXPLAIN` — no database was available)
- **Effort:** S (<1h)
- **Location:** `server/replays.ts:13-14` (`ownedBy`), `:49-68` (`listReplaysForUser`), `shared/schema.ts:121-131` (the only index is on `finished_at`)
- **Problem:** Two independent inefficiencies in the same query.

  1. `listReplaysForUser` does a bare `.select()` — every column of up to 20 rows, **including the
     `moves` jsonb** — and then uses it for exactly one thing:
     ```ts
     moveCount: (r.moves as ReplayMove[]).length,   // server/replays.ts:65
     ```
     Measured on a real hand: one 4-player manche produces 82 moves serializing to 9,150 B. Twenty
     rows is therefore roughly **179 KB of jsonb** shipped from Postgres, parsed by the `pg` driver
     into JS objects, and discarded — to compute a length Postgres can return as an integer.
  2. `ownedBy` filters with `matchReplays.playerIds @> '["<uid>"]'::jsonb`. `shared/schema.ts:131`
     declares exactly one index on this table, `match_replays_finished_idx` on `finished_at`.
     There is **no GIN index on `player_ids`**, so the containment predicate has nothing to use.
- **Impact:** Opening the replays list is a full read of the recent-replay table plus ~179 KB of
  useless payload per request. Today, with `REPLAY_RETENTION_DAYS = 14` and a small player base,
  a player sees a slow list. As the table grows, this is the query that degrades first, and it is
  authenticated so every user can issue it (`GET /api/replays`, `server/routes.ts:392`, no rate
  limiter).
- **Repro / proof:** Simulating one 4p hand through `lib/gameEngine.ts` and building the
  `ReplayMove[]` the server would store gives 82 entries at 9,150 B. `server/replays.ts:50-55` is
  `db.select().from(matchReplays).where(ownedBy(userId)).orderBy(desc(finishedAt)).limit(20)` —
  no column projection. `shared/schema.ts:131` is `(t) => [index("match_replays_finished_idx").on(t.finishedAt)]`.
- **Proposed fix:**
  1. Project explicitly in `listReplaysForUser`, replacing the `moves` column with
     `sql<number>`jsonb_array_length(${matchReplays.moves})`.as("move_count")`, and select only
     `id, finishedAt, gameMode, seats` alongside it. `ReplaySummary` (`lib/replay.ts`) already has
     exactly those fields, so no type changes downstream.
  2. Add a GIN index on `player_ids`. `server/schemaDdl.ts` derives its DDL from
     `shared/schema.ts`, so declare it there — check whether drizzle's `index(...).using("gin", …)`
     round-trips through `schemaStatements()`; if `server/schemaDdl.ts` cannot express a GIN index
     yet, teaching it one more index kind is the correct fix rather than a manual migration, since
     `schemaDdl.ts` is the single owner of table creation.
- **Acceptance criteria:** `GET /api/replays` returns byte-identical JSON to today (assert in
  `tests/integration/ladderAndReplay.test.ts`, which already exercises this route). The emitted DDL
  contains `CREATE INDEX IF NOT EXISTS … USING gin (player_ids)` and `tests/schemaDdl.test.ts`'s
  idempotence and non-destructiveness assertions still pass. `EXPLAIN` on the list query shows a
  bitmap index scan rather than a sequential scan.
- **Fix risk:** `jsonb_array_length` throws on a non-array value; the column is
  `.notNull().default([])` and only ever written by `saveReplay` (`server/replays.ts:28-35`), so
  every row is an array — but a defensive `coalesce(jsonb_array_length(…), 0)` costs nothing.
  Adding an index to `schemaDdl.ts` must keep the "columns added before indexes that target them"
  ordering that `tests/schemaDdl.test.ts` pins.
- **Depends on:** None

---

### [PERF-08] Ship the sound effects compressed instead of as 843 KB of raw WAV

- **Severity:** Medium
- **Confidence:** High (measured the files, read the load path)
- **Effort:** M (a few hours)
- **Location:** `lib/sounds.ts:99-112` (the registry), `:163-188` (`preloadSounds`), `components/GameTable.tsx:581-585` (the call site), `scripts/build-sounds.mjs:12-16`, `assets/sounds/`
- **Problem:** Entering the game table calls `preloadSounds()` (`components/GameTable.tsx:581`),
  which on web fetches and decodes **all twelve** assets in parallel (`lib/sounds.ts:169-174`).
  They are 44.1 kHz mono 16-bit PCM WAV, totalling **843.7 KB**, with `deal.wav` alone at 268.8 KB
  for a ~3 s shuffle. `scripts/build-sounds.mjs:12-16` explains the format choice as *"WAV, not
  OGG: … iOS will not play OGG"* and *"there is no ffmpeg here"* — the first constraint rules out
  OGG, not compression; AAC/M4A plays on iOS, Android and every browser. The second is a
  build-environment fact, not a platform one.
- **Impact:** 843 KB fetched on every entry to the game screen, on the hot surface, on top of the
  first-load cost of PERF-01/02. It does not block rendering — the table is playable, just silent —
  but on a mobile connection the first few seconds of a hand have no card, deal or turn sound, and
  the effects the player notices most (`deal`, `bomb`, `card_pass`) are the three biggest files.
  Against the `performance` skill's 1.5 MB total page-weight budget, this is over half of it in
  sound effects.
- **Repro / proof:**
  ```
  deal.wav 268.8 KB · card_pass.wav 90.5 · bomb.wav 87.0 · game_win.wav 75.8 · exchange.wav 72.4
  round_start.wav 67.2 · card_select.wav 58.6 · game_lose.wav 38.8 · round_win.wav 30.2
  card_play.wav 30.2 · your_turn.wav 16.4 · urgent_tick.wav 7.8   =  843.7 KB
  ```
  `lib/sounds.ts:169-174` awaits `Promise.all` over `Object.keys(ASSETS)`, i.e. all twelve, with no
  priority ordering. The same twelve files are present in `dist/assets/assets/sounds/` at the same
  sizes, so this is what the web client actually receives.
- **Proposed fix:** Two steps, either useful alone:
  1. Load lazily and by priority. `play()` (`lib/sounds.ts:132-141`) already falls back to
     `preloadWebAsset` on a cache miss (`:42`), so the eager preload of all twelve is not required
     for correctness. Preload only what the first ten seconds need (`deal`, `select`, `play`,
     `your_turn`) and let the rest arrive on first use.
  2. Emit AAC/M4A (or Opus-in-CAF for iOS plus AAC elsewhere) from `scripts/build-sounds.mjs`
     instead of PCM WAV — roughly a 5-10× reduction, so ~100 KB total. `node-wav`/`audio-decode`
     already do the decoding there; encoding needs an encoder that installs cleanly on Replit
     (a WASM AAC encoder, not a native ffmpeg binding — CLAUDE.md forbids build steps needing
     local native tooling).
- **Acceptance criteria:** Total bytes fetched by `preloadSounds()` on a web cold entry to the game
  screen is under 200 KB, measured in the browser network panel. Every one of the twelve effects
  still plays on web, iOS and Android. `tests/soundAssets.test.ts` is updated rather than deleted —
  it currently asserts a RIFF/WAVE header (`:36-37`) and reads sample rate, peak, RMS and
  `soundEndsAt` from the PCM, so it needs a decoder for the new container; keeping those assertions
  is the point of the test.
- **Fix risk:** Step 2 changes the format `tests/soundAssets.test.ts` parses, and iOS codec support
  is the exact trap the WAV choice was made to avoid — verify on a real iOS device, not a simulator,
  before merging. Step 1 alone is risk-free.
- **Depends on:** None

---

### [PERF-09] Set a long `Cache-Control` on the content-hashed web assets

- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `server/testApp.ts:116-121`
- **Problem:** All three static mounts take `express.static`'s defaults:
  ```ts
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));       // :116
  app.use(express.static(path.resolve(process.cwd(), "static-build")));            // :117
  app.use(express.static(distPath));                                              // :121
  ```
  `serve-static` defaults to `maxAge: 0`, so every asset is served with
  `Cache-Control: public, max-age=0` plus an ETag. Every one of those assets already has a content
  hash in its filename — `entry-7d796cc700c39d2b51a586aa28e94600.js`,
  `Rajdhani_700Bold.62eb2a35acdf719d19b2598e8e5f69df.ttf`,
  `deal.3726a0da51ba2870c80ee90f6b1d6fde.wav` — so its content can never change under that URL.
- **Impact:** Every repeat visit issues a conditional request per asset and waits for a `304`
  before it can use the cached copy. With the entry bundle, seven fonts, twelve sounds and twelve
  card images that is ~30 blocking round trips against a Cloud Run instance on every warm load —
  latency the user pays for nothing. `index.html` is the only file that genuinely must revalidate.
- **Repro / proof:** No `maxAge`, `immutable`, `setHeaders` or `Cache-Control` appears anywhere in
  `server/testApp.ts`; grepping all of `server/*.ts` for `Cache-Control` returns no matches.
- **Proposed fix:** Give the `dist` mount `express.static(distPath, { maxAge: "1y", immutable: true })`
  and keep the SPA catch-all at `:123-126` sending `index.html` with `Cache-Control: no-cache`
  (set it explicitly on the `res.sendFile` at `:125`). The `/assets` mount at `:116` serves
  unhashed source assets and must stay short-lived — give it a modest `maxAge` such as `1h`, not
  a year.
- **Acceptance criteria:** `curl -sI http://localhost:5000/_expo/static/js/web/entry-*.js` returns
  `Cache-Control: public, max-age=31536000, immutable`; `curl -sI http://localhost:5000/` returns a
  no-cache directive for the HTML. Deploying a new build still serves the new bundle on the next
  load (guaranteed by the hash in the filename plus the uncached `index.html`).
- **Fix risk:** Marking `index.html` immutable by accident would pin clients to a stale bundle with
  no recovery path short of a hard refresh — the two mounts must be configured separately, and the
  catch-all at `:123-126` is a different code path from `express.static`, so it needs its own header.
- **Depends on:** None

---

### [PERF-10] Re-measure `icon.png` / `splash-icon.png` — the note that closed the question tests the wrong thing

- **Severity:** Low
- **Confidence:** High (read the PNG headers)
- **Effort:** S (<1h)
- **Location:** `docs/BUNDLE.md:102`, `scripts/bundle-report.mjs:140-147`, `assets/images/icon.png`, `assets/images/splash-icon.png`
- **Problem:** `docs/BUNDLE.md:102` — generated from the hardcoded note at
  `scripts/bundle-report.mjs:141-147` — closes BACKLOG O6 with: *"already DEFLATE-compressed close
  to the practical floor for their pixel content — a lossless zlib level-9 re-encode of the
  existing pixels only recovers ~2-4%, not enough to justify adding an image-optimization step."*
  That measures re-running the same codec on the same pixels, which is not where the 2.5 MB is.
  Reading the IHDR chunks: both files are **1024×1024, 8-bit, colour type 2 (truecolour RGB, no
  alpha)** — `icon.png` 1,245,870 B and `splash-icon.png` 1,400,905 B against a 3.0 MB raw
  footprint, i.e. a ~2.3:1 ratio typical of photographic content. The levers that matter for such
  an image are palette quantisation, dimension (1024² is larger than any launcher or splash slot
  consumes), and format — none of which a lossless re-encode touches. The note reads as a decision
  someone made on purpose, which is precisely the shape CLAUDE.md's "no self-defeating safeguards"
  section warns about: *"If a change needs a paragraph explaining why the compromise is acceptable
  … the compromise is the defect."*
- **Impact:** Native only, and it is important to be precise about that: **neither file reaches the
  web client.** Nothing in `app/`, `components/`, `lib/` or `context/` `require()`s them — they are
  referenced only from `app.json:7` (`icon`) and `app.json:48` (the `expo-splash-screen` plugin),
  both of which are consumed at prebuild to generate native resources. Confirmed against the
  existing `dist/`: the only icon there is `favicon.ico`. So the cost is **2.5 MB of iOS/Android app
  download size**, not page weight — real, but paid once per install, by a channel that
  `.github/workflows/eas-build.yml` does not yet ship to (BACKLOG O1). Hence Low.
- **Repro / proof:** IHDR read directly from the files:
  `icon.png` → `1024x1024 depth=8 color=rgb bytes=1245870`;
  `splash-icon.png` → `1024x1024 depth=8 color=rgb bytes=1400905`.
  Neither filename appears in any source file (`grep -rn "splash-icon\|images/icon"` over
  `app components lib context scripts` matches only `app.json` and `bundle-report.mjs`'s own note).
- **Proposed fix:** Either do the real measurement — quantise to a palette or re-encode as WebP at
  the sizes the platforms actually consume, and record the result — or, if the answer is still "not
  worth it", say so on the correct grounds. Delete the paragraph at
  `scripts/bundle-report.mjs:141-147` and regenerate `docs/BUNDLE.md`; a generator that hardcodes a
  conclusion about specific files is not a report. While regenerating, also fix the false
  tree-shaking claim at `docs/BUNDLE.md:101` (PERF-04).
- **Acceptance criteria:** `docs/BUNDLE.md` contains no claim that is not reproducible from the
  script's own output, and BACKLOG O6 is either closed with a measured number or restated with the
  real lever named.
- **Fix risk:** Changing the source images changes the shipped app icon and splash; verify on both
  platforms. Doing nothing but correcting the note carries no risk at all.
- **Depends on:** None (shares a deliverable with PERF-04)

---

## Coverage gaps

1. **The production build was not run** — it writes into `dist/`, `static-build/` and
   `server_dist/`, which the read-only rule forbids. Every bundle number above comes from a
   `dist/` **already present in the working tree**, dated 2026-08-17 07:23, which I did not create
   and did not modify. It is gitignored, so I cannot prove it corresponds exactly to `b894af4`.
   Every claim I drew from it was cross-checked against current source (the icon imports, the
   `useFonts` map, the sound registry), and all of them match — but a reviewer should confirm by
   building once.
2. **No browser was driven, so no runtime metric was measured.** There are no frame times, no LCP,
   no TBT, no INP numbers here. Playwright and Lighthouse both write into the repo
   (`tests/e2e/test-results/`) and Playwright additionally needs a browser download, Postgres and a
   built bundle. PERF-03 and PERF-05 are argued from element counts and code paths, not from a
   profile — the *cause* is proven, the *milliseconds* are not.
3. **`scripts/bundle-report.mjs` was not run.** I checked it first as instructed: it writes only to
   `process.stdout` (`:162`) and would have been safe, but its output is already committed at
   `docs/BUNDLE.md` and my independent `Get-ChildItem` measurement reproduces it byte-for-byte, so
   running it would have added nothing.
4. **No database was available**, so PERF-07's sequential-scan claim is from the schema and the
   query text, not from `EXPLAIN (ANALYZE)`. The absent GIN index is a fact; the plan Postgres
   actually chooses is inference.
5. **Server memory ceiling: measured as a non-issue, not left open.** The brief asked how much one
   abandoned room holds. `vacateSeat` (`server/socket.ts:679-690`) disposes the room the moment
   `remaining <= 1`, and the sweeper (`:2115-2140`) disposes finished rooms with nobody connected,
   so `activeGames` is bounded by the number of tables with two or more live seats — not by
   abandonment. `moveLog` is capped at `MAX_REPLAY_MOVES = 1000` (`lib/replay.ts:65`) against a real
   hand's 82 moves / 9 KB. I found no unbounded growth to report and did not measure retained heap.
6. **Whether Replit's edge proxy compresses in front of Cloud Run is unverified.** PERF-01 stands
   regardless — `Content-Encoding` should not be left to an unverified intermediary — but if the
   proxy does compress, the observed saving will be smaller than the 2.4 MB I quote.
7. **react-native-svg's per-node cost on web was not measured.** I counted the elements
   (383 for a 4p opening table, 491 for a 2p hand) but did not measure what one `<Path>` costs to
   create, diff or paint.
8. **Native (iOS/Android) performance is entirely uncovered.** PERF-01, PERF-02, PERF-04 and
   PERF-09 are web-only by construction. PERF-05's native branch was read but not run on a device.

---

## Opinions (non-findings)

- **`persistGameState` rewrites the whole envelope on every move.** `server/socket.ts:344-386`
  upserts a ~4.1 KB jsonb blob per mutation; a real 4-player hand is 79 mutations, so ~324 KB of
  jsonb writes per hand per table. It is not awaited (`:363-385`), so it never blocks a broadcast,
  and the comment at `:107-122` shows the tradeoff was made deliberately. At the current player
  count nobody notices, and the alternative is a delta log — a redesign, not a fix. Noted so the
  next person sizing the database has the number.
- **`broadcastGameState` clones the full state once per recipient.** `server/socket.ts:388-400`
  calls `sanitizeStateForPlayer` per user, so a 4-player table does four spreads of the state and
  four `players.map` per move. Measured, that is 6,214 B of JSON per broadcast and 365 KB over a
  whole hand — trivial, and the per-viewer sanitisation is a security requirement
  (`tests/integration/gameplay.test.ts` pins that a player never receives another player's hand).
  Do not "optimize" this into a shared object.
- **`maxHttpBufferSize: 1e5`** (`server/socket.ts:1005-1017`) is comfortable: the largest inbound
  payload is a `game:play` with up to 27 card ids, and even the largest *outbound* state is 1.6 KB.
  No action.
- **All three locales are bundled eagerly.** `lib/i18n.ts:23-25` statically imports `it`, `en` and
  `sq` (147 KB of source combined), two-thirds of which is dead for any given user. Real, but an
  order of magnitude smaller than the 580 KB of dead glyph maps in PERF-04, and the design that
  makes it valuable — `TranslationKey` derived from `it` so a missing key is a compile error
  (`lib/i18n.ts:27`) — is worth more than the bytes. Fix PERF-04 first and re-measure.
- **`lib/gameEngine.ts` including the AI is shipped to every client, and that is correct.**
  `context/GameContext.tsx:384` calls `aiChoosePlay` for the offline game, which is a first-class
  mode. 45 KB of source. Not dead weight.
- **Court art is oversampled for desktop web.** `assets/images/cards/*.png` are 82×241 for an art
  box that `cardFaceModel.courtArtRect` sizes at ~23×66 pt — right at DPR 3, ~13× the pixels at
  DPR 1. Only the courts actually on screen are fetched, so the practical cost is small.
- **Two identical `storage.getFriends(userId)` calls per socket connect** —
  `server/socket.ts:1880` and inside `emitFriendStatus` (`:2239`), both reached from the same
  connect handler. One query's worth of waste per connection. Genuinely not worth a finding.
- **The sweeper fans out one `getRoomById` per public room every five minutes**
  (`server/socket.ts:2141-2148`), unbatched, against a `pg.Pool` left at its default `max: 10`
  (`server/db.ts:5-9`). Fine at this scale; a single `WHERE id = ANY(...)` would be strictly better
  if the public-room count ever grows.
- **`components/GameTable.tsx:267-311` (`TurnTimer`) is exactly right** and worth preserving through
  any PERF-03 work: it is a separate component precisely so the once-a-second tick re-renders one
  `<Text>` rather than the board, and the comment at `:262-265` says so. It bails out of the React
  Compiler only because of the ref write at `:281`, which is harmless here.
- **`lib/cosmetics.ts` does what CLAUDE.md claims** — verified. It imports only `./tokens.ts` and a
  type-only `./i18n.ts`, and neither it nor `lib/accessibility.ts`, `lib/theme.ts`, `lib/tokens.ts`
  nor `components/CardView.tsx` pulls in `expo-audio` or `SettingsContext`. The module-store
  indirection is earning its keep.
- **`CLAUDE.md`'s "Friends FlatList: Must have `extraData={onlineIds}`" is stale.**
  `app/(online)/friends.tsx` no longer uses a `FlatList` — it maps over the arrays inside a
  `ScrollView` (`:290, :325, :365, :402`). The repo's only `FlatList` is at
  `app/(online)/room.tsx:252`, and it has a `keyExtractor` and a bounded friends list. Nothing in
  the app renders a list long enough to need `getItemLayout`, `windowSize` or
  `removeClippedSubviews`; the leaderboard is capped at 50 by `LEADERBOARD_SIZE`
  (`server/ratings.ts:15`) and replays at 20 by `MAX_REPLAYS_LISTED` (`server/replays.ts:10`).
  I found no list-virtualisation finding to report. The stale invariant belongs to C1.

---

## Open questions for the human

1. **Does Replit's edge proxy compress responses in front of Cloud Run?** If it does, PERF-01's
   measured saving shrinks (the fix is still correct — it should not depend on an intermediary).
   One `curl -sI -H 'Accept-Encoding: gzip'` against the deployed URL answers it.
2. **Is web the primary target, or a stepping stone to the app stores?** PERF-01, PERF-02, PERF-04
   and PERF-09 are the four highest-impact items and all four are web-only. If the store builds are
   imminent (BACKLOG O1/Q12), PERF-10's 2.5 MB of icon and splash moves up and these move down.
3. **Is `Rajdhani_400Regular` intended for something?** It is loaded and blocks first paint
   (`app/_layout.tsx:56`) but styled by nothing. Deleting it is a free 352 KB unless a design change
   is pending.
4. **Should the React Compiler be treated as load-bearing?** It is currently enabled
   (`app.json:59`) but 40 of the repo's components silently opt out of it, on a *dated beta* whose
   miscompilation of `useEffect` CLAUDE.md already records as a known pitfall. Two coherent
   positions: fix the bailouts and add a test that pins zero bailouts, or turn the experiment off
   and memoize by hand. The current middle — enabled, mostly ineffective, invisible — is the worst
   of the three. PERF-03 assumes the first; say if you want the second.
5. **Is there an appetite for a performance budget in CI?** Nothing in the repo measures a byte or
   a frame. A single check that fails when the gzipped entry bundle exceeds a threshold would have
   caught PERF-04 the day it landed, and would have made `docs/BUNDLE.md:101`'s false claim
   impossible to hold. CI does not currently run any build at all (map §12), so this needs the
   build added first.
