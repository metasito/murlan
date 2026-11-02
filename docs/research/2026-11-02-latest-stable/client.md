# Client stack research for metasito/murlan#1911 (as of 2026-11-02)

Method note. `expo.dev`, `reactnative.dev`, `docs.swmansion.com`, `github.com` (non-raw), dev.to and medium are blocked by the
session proxy (WebFetch ENOTFOUND, curl 403). What worked: `npm view`/`npm pack` (registry), `raw.githubusercontent.com`
(RN and React changelogs). The SDK 58 blog/changelog prose could therefore NOT be read directly; it is reconstructed from
(a) the WebSearch snippets of expo.dev pages, (b) the published tarballs of expo@58.0.22 and the 58.x packages
(bundledNativeModules.json, per-package CHANGELOG.md, .d.ts/exports, podspecs), (c) the RN/React changelogs.
Everything marked VERIFIED was read in a tarball or changelog; UNVERIFIED is stated as such.
Tarballs and changelogs were unpacked in a scratch directory that is not kept; every claim names the tarball or changelog it was read from.

## 1. Target versions

### Status
- SDK 58 is stable: `npm view expo dist-tags` -> `latest: 58.0.22` (published 2026-10-31); `next: 58.0.11` is stale; `sdk-57: 57.0.31`.
  expo-screen-orientation/expo-linear-gradient changelogs date 58.0.0 as 2026-09-10. Search snippet of
  https://expo.dev/changelog/sdk-58 and https://expo.dev/blog/how-to-upgrade-to-sdk-58 confirms "SDK 58 has officially arrived", built for iOS 27, RN 0.88.
- SDK 59: no `59.x` version and no dist-tag in the registry (only `canary` -> 58.0.0-canary-20260909). Not announced as published; do not target it.
- SDK 58 ships **react-native 0.88.1**, **react / react-dom 19.3.0** (installed 19.3.1 exists on npm; bundled spec is exact 19.3.0), react-native-web ~0.21.4.
  (bundledNativeModules.json of expo@58.0.22; RN 0.88.1 peer: `react ^19.3.0`, engines node `^22.13.0 || ^24.3.0 || >=26`.)
- Node: expo/@expo/cli 58 engines `^22.13.0 || ^24.3.0 || ^26 || >=27`. `.node-version` is `24` (ok); `package.json` engines `>=22` should become `>=22.13`.
- RN 0.88.1 native floors (VERIFIED in the tarball): iOS min 15.1 (Expo modules floor 16.4, unchanged since SDK 56), min Xcode 16.1, Android minSdk 24, targetSdk 36, **compileSdk 37 / buildTools 37.0.0**, AGP 9.2.1, NDK 27.1.12297006.
  Whether SDK 58 *requires* Xcode 27 is UNVERIFIED (search snippet says "built for iOS 27", scene lifecycle "required by the iOS 27 SDK"); the actions/runner-images README has Xcode 27 as *preview* only, `macos-latest` = macOS 26.

### Current -> target (SDK 58 `bundledNativeModules.json`, expo@58.0.22; latest = npm dist-tag latest)

| package | repo now | SDK 58 target | npm latest | note |
|---|---|---|---|---|
| expo | ~57.0.25 | ~58.0.22 | 58.0.22 | `npx expo install expo@^58 --fix` |
| react-native | 0.86.3 | 0.88.1 | 0.88.1 | skips 0.87 (all 0.87 breaks apply) |
| react / react-dom | 19.2.3 | 19.3.0 | 19.3.1 | `@types/react` ~19.2.4 -> ~19.3.0 (19.3.0 exists; not in the Expo list) |
| react-native-web | ^0.21.0 (lock 0.21.2) | ~0.21.4 | 0.21.4 | patch |
| expo-router | ~57.0.23 | ~58.0.29 | 58.0.29 | |
| expo-notifications | ~57.0.21 | ~58.1.7 | 58.1.7 | |
| expo-asset / clipboard / constants / dev-client / font / keep-awake / linear-gradient / linking / localization / screen-orientation / splash-screen / system-ui | ~57.x | ~58.0.19 / .4 / .14 / .18 / .11 / .3 / .3 / .15 / .5 / .3 / .12 / .7 | same | |
| eslint-config-expo | ~57.0.2 | ~58.0.4 | 58.0.4 | |
| jest-expo | ~57.0.5 | ~58.0.13 | 58.0.13 | **moves to Jest 30 internals**, see §2 |
| @expo/vector-icons | ^15.0.3 (lock 15.1.1) | ^15.0.2 | 15.1.1 | keep |
| react-native-reanimated | 4.5.5 | 4.7.1 | 4.7.1 | pinned pair with worklets 0.13.x |
| react-native-worklets | 0.10.4 | 0.13.0 | 0.13.1 | SDK pins 0.13.0; 0.13.1 not Expo-validated |
| @shopify/react-native-skia | 2.12.0 | 2.14.0 | 2.14.0 | pins `canvaskit-wasm` **exactly 0.41.0** |
| react-native-gesture-handler | ~3.3.0 | ~3.3.0 | 3.4.0 | already at SDK pin |
| react-native-screens | ~4.28.0 | ~4.30.1 | 4.30.1 | expo-router 58 requires `^4.30.1 || ^5.0.0-alpha` |
| react-native-safe-area-context | ~5.10.0 | ~5.10.1 | 5.11.0 | |
| react-native-svg | 15.15.5 | 15.16.0 | 15.16.0 | |
| @react-native-async-storage/async-storage | 2.2.0 | 2.2.0 | 3.1.1 | stay (see §3) |
| @react-native-community/netinfo | 12.0.1 | 12.0.1 | 12.0.1 | unchanged |
| @react-native-masked-view/masked-view | 0.3.2 | 0.3.2 | 0.3.2 | unchanged (last published 2024-11) |
| @expo-google-fonts/inter, rajdhani | ^0.4.2 / ^0.4.1 | n/a | same | already latest |
| @tanstack/react-query | ^5.83.0 (lock 5.102.8) | n/a | 5.105.1 | in range, lockfile bump only |
| socket.io-client | ^4.8.3 | n/a | 4.8.4 | in range |
| canvaskit-wasm | ^0.41.0 | **keep 0.41.x** | 0.42.0 | Skia 2.14.0 depends on exactly 0.41.0; the JS binding and the wasm must match, do NOT take 0.42 |
| react-native-audio-api | 0.13.6 | 0.13.6 | 0.13.6 | not in Expo list; peers `react-native *`, `worklets >=0.7.0`; also a `1.0.0-nightly` tag only |
| react-native-turbo-haptics | 1.2.0 | 1.2.0 | 1.2.0 | peers `react-native >=0.72`; nothing newer |
| @testing-library/react-native | ^14.0.1 | n/a | 14.1.0 | in range; peer `test-renderer ^1.0.0` (repo already uses it, lock 1.2.0; jest-expo 58 pins 1.3.0) |
| jest / @jest/globals | ^29.7.0 | 30.x recommended | 30.5.2 | see §2 |
| metro | via expo | `@expo/metro ~58.0.0`, `@expo/metro-config ~58.0.20` | | RN 0.88 requires metro >= 0.87.1 |
| babel-preset-expo | via expo | ~58.0.23 | | still `babel-plugin-react-compiler ^1.0.0` (npm latest 1.0.0), `react-native-worklets/plugin` options unchanged |

Not Expo-managed and not in the table by choice: `canvaskit-wasm` (above), `@react-native/jest-preset` (new peer of jest-expo 58, `^0.88.1`; it is already
present in the lockfile as an auto-installed peer, make it an explicit devDependency).

## 2. Breaking changes SDK 57 -> 58 and whether they touch our code

Sources: RN changelog https://raw.githubusercontent.com/facebook/react-native/main/CHANGELOG.md (v0.87.0, v0.88.0/.1 sections);
React https://raw.githubusercontent.com/facebook/react/main/CHANGELOG.md (19.3.0, 2026-09-09); package tarballs; search snippets of
https://expo.dev/blog/how-to-upgrade-to-sdk-58 and https://expo.dev/changelog/sdk-58-beta.

### Needs a code/config/CI change

1. **jest-expo 58 is a Jest 30 package** (VERIFIED: deps `babel-jest ^30`, `@jest/globals ^30`, `jest-environment-* ^30`, `jest-snapshot ^30`, `test-renderer 1.3.0`; `jest-preset.js` comment: the upstream preset's Jest 29 environment "must not be mixed into a Jest 30 runtime"). Peer allows `jest ^29 || ^30`, but a 29 core with 30 transformers is the mixed case. Plan: bump `jest` and `@jest/globals` to 30.x in the same ticket.
   Touches: `package.json` (jest, @jest/globals), `jest.config.js` (uses `react-native-worklets/jest/resolver` -> still exists in 0.13.0 and just calls `defaultResolver`; `jest-expo/src/preset/assetFileTransformer.js` -> still exists; the `compiled` project passes `babel-jest` options directly), `tests/native/setup.ts` (imports `@jest/globals`). Deep imports the harness relies on all still exist (VERIFIED in tarballs): `react-native-reanimated/lib/module/ReducedMotion`, `.../layoutReanimation/web`, `global._frameCallbackRegistry` (setup.ts:34-49), `react-native-gesture-handler/lib/module/handlers/gestures/installUIRuntimeBindings(.web)` and `.../GestureHandlerRootViewContext` (gesture-handler stays 3.3.0), `expo-router/build/views/Try`, `react-native/Libraries/Utilities/Dimensions` (tests/native/harness/env.ts:15, file still in RN 0.88.1).
   Jest 29 -> 30 itself: check `tools/loop/related-tests.mjs` for `--testPathPattern` (renamed `--testPathPatterns` in Jest 30; the grep over the repo found no `testPathPattern`, so likely fine) and `tools/ci/native-budget.mjs` reporter.
2. **RN 0.87 made the Strict TypeScript API the default** (RN CHANGELOG v0.87.0 "Strict TypeScript API: React Native's default JavaScript API is now the Strict TypeScript API. Use `customConditions: ["react-native-legacy-deep-imports"]` to opt out"; `react-native@0.88.1` exports map confirms `types_generated` is the default). Our `tsconfig.json` extends `expo/tsconfig.base` which is byte-identical between 57 and 58 (`customConditions: ["react-native"]`). Only deep import in app code: none (`react-native/` deep imports exist only in tests/native/harness/env.ts, runtime require). Removed types: `NativeMethods`/`NativeMethodsMixin`, `PublicScrollViewInstance`, `PublicModalInstance` -> repo greps show no use. Expect a typecheck sweep over style/ref types (15 files use ViewStyle/StyleProp/refs); `lib/diagnostics/index.ts:96` calls `ref.current?.measureInWindow` (still on the host instance type). The opt-out exists as a fallback and "is set to be removed after RN 0.89".
3. **iOS scene-based lifecycle** (search snippet of the upgrade guide: "SDK 58 requires the UIKit scene-based lifecycle; remove `ios.enableSceneSupport` from expo-build-properties"; template `expo-template-bare-minimum@sdk-58` has `SceneDelegate.swift` and the AppDelegate comment "The window is created and React Native is started by `SceneDelegate` under the scene-based life cycle (required by the iOS 27 SDK)"). We do not use `enableSceneSupport` (no expo-build-properties). Touches our native glue:
   - `plugins/withSwiftUIFilters.js`: inserts at `    reactNativeFactory = factory\n` and requires `\nimport React\n` + `ExpoAppDelegate`. The SDK 58 template still contains both strings (VERIFIED), so the plugin still applies, and RN is started later (SceneDelegate) so the "flags set before the factory starts" ordering still holds. Needs a prebuild run to confirm the generated AppDelegate; `tests/tooling` may pin the template.
   - `modules/murlan-orientation/ios/*.swift` swizzles `application:supportedInterfaceOrientationsForWindow:` on `UIApplication.shared.delegate` and uses `windowScenes`. expo-screen-orientation 58.0.3 still answers via `ScreenOrientationAppDelegate.swift` (VERIFIED) so the swizzle target exists; the landscape lock path must be verified on a device (ios.yml flows + `.maestro/captures.yaml` landscape states). This is the highest-risk item of the bump.
   - `modules/murlan-diagnostics`, `murlan-audio-session` use no app/scene delegate API.
4. **Android build floor**: RN 0.88 needs compileSdk/buildTools 37, AGP 9.2.1, NDK 27 (was: RN 0.86 values). `.github/workflows/maestro.yml:127-132` derives the NDK major from `node_modules/react-native/gradle/libs.versions.toml` and fails if the runner lacks it; needs Android platform 37 / build-tools 37.0.0 on the runner image (or the SDK manager auto-downloads, which that job explicitly avoids for the NDK). Java 17 at maestro.yml:138 is what AGP 9 requires (ok). Emulator api-level 34 (`drive-android-flows/action.yml:31`) is independent of compileSdk. SDK 58 also reportedly enables R8 by default for release (third-party blog, UNVERIFIED): check the release APK keeps `react-native-audio-api` / `murlan-diagnostics` classes.
5. **expo-router 58**: `expo-router/react-navigation` is still exported (VERIFIED: `package.json` exports `./react-navigation` -> `build/react-navigation/index` which re-exports `./native`, `./elements` and `../core`, giving `NavigationContext` and `usePreventRemove`), so our 7 import sites keep working: `app/(online)/room.tsx:13`, `lib/device/orientation.tsx:5`, tests/native x5 (some `jest.mock('expo-router/react-navigation')`). The upgrade guide says "removed `expo-router/react-navigation` exports" - only a subset was removed; `LocaleDirContext`, `ServerContainer` are now `@deprecated`. `NativeStackNavigationProp` is still exported from `expo-router` (lib/device/orientation.tsx:4). `expo-router/unstable-native-tabs` -> `expo-router/native-tabs` rename: we do not use native tabs. expo-router 58 peers `@expo/ui`, `expo-symbols` etc. are optional. `typedRoutes` stays in app.json:64.
6. **react-native-screens**: expo-router 58 depends on `^4.30.1 || ^5.0.0-alpha.3`; take Expo's ~4.30.1, not 5.x alpha.
7. **`expo-modules-core`/precompiled artifacts**: SDK 58 rebuilds its precompiled iOS binaries against RN 0.88.1 (expo-font/expo-modules-core changelogs "Rebuild precompiled iOS binaries against React Native 0.88.1"). Any native fingerprint change forces `ios-app-cache.yml` (~21 min) before `ios.yml`; plan for it.

### Touches nothing of ours (checked by grep)
RN 0.87 removals: `InteractionManager`, Modal `animated` prop (AppModal.tsx uses `animationType`, fine), StatusBar `backgroundColor`/`translucent`, `keyboardShouldPersistTaps` booleans (repo uses the string `"handled"`: MenuLayout.tsx:160, app/(online)/index.tsx:243/264/293), `Touchable`, `SceneTracker`, `react-native/rn-get-polyfills`, `react-native/jest-preset` (now `@react-native/jest-preset`), Legacy Hermes; deprecated `ImageBackground`, `DrawerLayoutAndroid`, `InputAccessoryView`, `Appearance.setColorScheme('unspecified')`, `react-native/assets-registry` - none used. `useColorScheme` unused. RN 0.88: "non-breaking release"; `Libraries/Core/InitializeCore` deprecated (not imported).
`useNativeDriver` is now always-on under a flag (no uses). Node floor for RN: >= 22.13.

### Libraries
- **react-native-reanimated 4.5.5 -> 4.7.1**: public export surface additive only (diff of `index.d.ts`: new `LogData/LogFunction/LoggerConfig`, `contrastColor`). compatibility.json: 4.7.x needs RN 0.86-0.88 and worklets 0.13.x exactly. Android `NativeProxy.kt` gained `cssPlatformTransitionsManager` and our patch is upstream (see §4). The repo uses `scheduleOnRN` (58 sites), `scheduleOnUI` (17), `useAnimatedReaction`, `useFrameCallback` (15), `measure`, `ReducedMotionConfig` - all current APIs. `runOnJS` is not used. I could not read the Reanimated release notes (docs.swmansion.com blocked); behaviour changes between 4.5 and 4.7 are therefore only inferred from types, so the device/e2e runs below are the real check.
- **react-native-worklets 0.10.4 -> 0.13.0**: 0.x minors, but the public barrel diff is additive (`getCurrentThreadId`, `FixedSynchronizable`, `SynchronizableConfig` added; `scheduleOnRN/UI`, `runOnJS/UI` unchanged). `react-native-worklets/plugin` option `omitNativeOnlyData` (babel.config.js) is still honored (VERIFIED in plugin/index.js); `babel-preset-expo` 58 still forwards `worklets: platformOptions.worklets` (our `worklets:false` on web). New `bundleMode` dir exists (not enabled by default).
- **react-native-gesture-handler**: unchanged at 3.3.0 (SDK pin); 3.4.0 exists but is not Expo-validated. `GestureDetector`, `GestureHandlerRootView` sites (6) untouched.
- **@shopify/react-native-skia 2.12.0 -> 2.14.0**: removed export `isFabric` (unused here); new `AndroidCanvasProps`/`AndroidSurfaceType`; our deep import `@shopify/react-native-skia/lib/module/web` (components/table/feltSkiaBoundary.tsx:1) still exists; `<Canvas opaque>` (feltCanvas.tsx:353) still supported. Peers: react >=19, RN >=0.78, worklets >=0.7, reanimated >=4. Patch: see §4. Jest mock at tests/native/setup.ts:107 is ours.
- **react-native-svg 15.15.5 -> 15.16.0, safe-area-context 5.10.0 -> 5.10.1, screens 4.28 -> 4.30.1**: minors/patches, no API removals found in types; screens is the only one with a native-behaviour risk (orientation/modals), covered by the same device runs.
- **expo-notifications 57.0.21 -> 58.1.7**: only adds (Android `threadIdentifier` grouping, exact-alarm permission helpers, `enableRemoteNotifications` plugin option, iOS `handleNotificationAsync` crash fix 58.1.3, Expo Go import fix 58.1.7). No breaking items in the 58.x changelog. Our use is `lib/device/pushRegistration.ts` (dynamic import) and `lib/device/inviteTaps.ts:1`.
- **react-native-web ~0.21.4**: patch bump of the 0.21 line; peers react/react-dom 18||19. No breaking change expected; covered by the Playwright suite.
- **React 19.2.3 -> 19.3.0** (changelog 2026-09-09): additive (`<ViewTransition>`, Fragment refs, `browser()`), plus fixes: `useEffectEvent` now reads latest values in `forwardRef`/`memo`, Activity fixes, "transitions render independently", DEV warning for conditional `use()`. No removals. Note RN 0.88.1 peer is `react ^19.3.0`, so React must move with RN.
- **TanStack Query 5.102.8 -> 5.105.1**: same major, lockfile update; 15 call sites.
- **socket.io-client 4.8.3 -> 4.8.4**: patch.
- **expo-linear-gradient 57.0.2 -> 58.0.3 / expo-font / expo-splash-screen**: no API changes (expo-font 58.0.10 fixes Safari font-face timeout on web - relevant to our web export).

## 3. Features: adopt / reject / later

| Feature | Replaces / touches | Gain | Risk | Verdict |
|---|---|---|---|---|
| **React Compiler** (already on: `app.json:65`, `babel-plugin-react-compiler ^1.0.0`, guarded by `tests/ui-rules/reactCompiler.test.ts`) | n/a | already shipping; babel-preset-expo 58 keeps the same dep range (npm latest compiler is still 1.0.0) | the "never a second copy" invariant: after `expo install --fix`, rerun that test | KEEP; verify the test after the bump |
| **React 19.2+ `useEffectEvent`** (stable) | latest-ref-in-render patterns: `components/table/countdown.ts:61` (`onExpireRef.current = onExpire`), `components/table/useRoundEnding.ts:53` (`onLandedRef.current = onLanded`), `components/RoomSeatList.tsx:101`, `components/table/pile.tsx:624`, `components/useTableFeedback.ts:150` | removes manual ref-sync, fixes stale-closure risk; 19.3 makes it correct in `memo`/`forwardRef` | must be called only from effects; ref mutated during render is also a compiler lint smell; each site is timing-critical (table clock) | LATER: separate ticket after the bump, one hook at a time, behind the existing native tests |
| **React 19.2 `<Activity>`** | no hidden-screen pattern found (grep `Activity` hits are only `ActivityIndicator`) | keeps state of hidden subtrees | RN support for Activity hiding/native views is not something I verified | REJECT for now |
| **React 19.3 `<ViewTransition>`/Fragment refs** | web only DOM features, RN renderer unsupported | none | n/a | REJECT |
| **Hermes V1** | default engine since RN 0.84 (changelog v0.84.0 "Make Hermes V1 the default engine"); RN 0.88 bumps Hermes to 260318099.0.x | already in use | none | n/a (already). "Static Hermes" is not shipping; not adopt |
| **Precompiled iOS React Native core** (RN >= 0.81, `ios.buildReactNativeFromSource` default false) | already how we build (`modules/murlan-rn-patches/ios/MurlanRecycledLayout.mm` comment: "The core links prebuilt") | CI build time | n/a | already on. SDK 58 additionally ships precompiled Expo-module xcframeworks and SwiftPM (`npx react-native spm`, opt-in per search snippet). Not adopting SwiftPM now (our CocoaPods local modules + patches) -> LATER |
| **Android precompiled headers** (`expo-build-properties` `android.usePrecompiledHeaders` or `EXPO_USE_ANDROID_PRECOMPILED_HEADERS=1`, experimental) | `.github/workflows/maestro.yml` release APK build | faster C++ compile | experimental, "might not work with all native libraries" (audio-api, skia, reanimated); would add a dependency | LATER, try as an env var in the maestro build only |
| **RN 0.88 upstream recycled-view layout fix** (`Reset EmptyLayoutMetrics in RCTViewComponentView prepareForRecycle`, v0.88.0 changelog; our own comment names react/react-native#57590 "from 0.88") | `modules/murlan-rn-patches/ios/MurlanRecycledLayout.mm` (method wrap) | deletes a runtime-swizzle of RN internals | must keep #1485's regression test green | ADOPT (drop the file; keep `MurlanReactNativeFlags` for SwiftUI filters). Verify `enableSwiftUIBasedFilters` is still not default - nothing in the 0.87/0.88 changelog makes it default |
| **Strict TypeScript API default** | tsconfig/types | better types (`*Instance` ref types, interfaces) | typecheck churn | ADOPT (forced anyway) |
| **`expo/fetch`** | `lib/query-client.ts:1` already imports it | n/a | n/a | already adopted |
| **Expo Atlas** (`expo-atlas` 0.5.0, `EXPO_ATLAS=true npx expo export`) | complements `scripts/bundle-budget.mjs` (gz JS budget 1 MB / deferred 250 KB, bundle dir `dist/_expo/static/js/web`) | attribution of bundle growth (which module added the 400 KB), which the budget script can't give | extra devDependency, interactive tool, not a gate | LATER (useful when the budget fails after the React 19.3/Skia bump; no ticket needed now) |
| **Metro bundle splitting / async routes** | `scripts/bundle-budget.mjs` DEFERRED budget already measures a deferred chunk (Skia felt) | smaller first load | needs `web.output`/router async config; `canvaskit.wasm` handled in `feltSkiaBoundary.tsx` | REJECT (already split where it matters) |
| **DOM components (`'use dom'`)** | nothing | none | adds a webview on native | REJECT |
| **React Native Performance APIs** (`performance.mark/measure`, `PerformanceObserver`, `Systrace.trace`, DevTools perf tracks in 0.87/0.88) | `lib/diagnostics/index.ts` (measureInWindow, `performance.now()`), `tests/e2e/playwright.perf.config.ts` perf harness | native-side frame/long-task traces comparable to the web perf suite | DevTools only; production data collection is a larger design | LATER, for the #1259-style on-device investigations |
| **`react-native-web` 0.21** | web build | patch fixes only | none | KEEP (patch bump) |
| **TanStack Query v5.10x** | 15 sites, `lib/query-client.ts:97` (`staleTime: Infinity`), `lib/queries.ts` | nothing needed beyond bug fixes; `queryOptions` helper not used | none | bump lockfile only |
| **AsyncStorage 3.x** (npm latest 3.1.1; default export is a "legacy" proxy to the v2 store, new `createAsyncStorage` API, web uses IndexedDB `idb`) | `AsyncStorage.getItem/setItem/removeItem/multiRemove` in ~10 files | none that we need | not in `bundledNativeModules` (SDK pins 2.2.0, `expo-doctor` would flag); persisted-data migration surface; `tests/native/setup.ts:68-70` uses `async-storage/jest/async-storage-mock` | REJECT (stay on SDK pin) |
| **zod 4, TypeScript 7, ESLint 10** | outside the client list | | | out of scope here |
| **expo-notifications `enableRemoteNotifications: false`** plugin option (58.1.0) | `app.json` plugin `"expo-notifications"` (only local notification taps in `lib/device/inviteTaps.ts`?) | drops the APNs entitlement if push is unused | we DO register push tokens (`lib/device/pushRegistration.ts`) | REJECT |
| **Reanimated 4.7 / worklets 0.13 `bundleMode`** | | startup | opt-in, new | REJECT now |

## 4. Patches (`/home/user/murlan/patches`)

| patch | targets | fixed upstream in target? | action |
|---|---|---|---|
| `react-native-reanimated+4.5.5.patch` (Android `NativeProxy.kt`: `getViewExists` guard + log message) | reanimated 4.5.5 | **Yes, identical code is in 4.7.1 `NativeProxy.kt` lines ~319-337** (`getViewExistsMethod` + "The props stay in the registry, and the commit hook applies them to the shadow tree" comment). `patch --dry-run` against 4.7.1 reports "Reversed (or previously applied)". (Upstream commit/PR link not retrievable offline; evidence is the shipped source.) | DROP the file |
| `@shopify+react-native-skia+2.12.0.patch` (iOS `_layer.opaque`, `SkiaUIView.mm setOpaque`) | skia 2.12.0 | **No.** 2.14.0 still has `_layer.opaque = false` in `MetalWindowContext.mm:21` and `setOpaque` only stores `_opaque` (`SkiaUIView.mm:132`). The hunks apply with offsets -24/-30 and zero fuzz (`patch -F0` ok) | keep, regenerate as `@shopify+react-native-skia+2.14.0.patch`; must also rename in `docs/agents/checks.md:130`, `tests/tooling/nativeScope.test.ts`, and anything tools/ci greps. iOS `felt-opaque.yaml` + `feltOpaque` bench must pass |
| `expo-linear-gradient+57.0.2.patch` (web: ignore 0x0 layout under `display:none`) | 57.0.2 web build | **No.** 58.0.3 `NativeLinearGradient.web.js` still sets layout unconditionally; and the compiled output format changed (spaces/commas) so the hunk **fails to apply** (`Hunk #1 FAILED`) | regenerate against 58.0.3 (re-add the `if (width === 0 \|\| height === 0) return oldLayout;` guard), rename `+58.0.3.patch`. Consider upstreaming |
| `react-native-audio-api+0.13.6.patch` (iOS `@try` around `startAndReturnError`) | 0.13.6 | **No.** 0.13.6 is the npm latest (only a `1.0.0-nightly` after it); `AudioEngine.mm:398,495` unchanged and the patch applies cleanly | keep unchanged (name still matches); `tests/tooling/audioApiPatch.test.ts` stays |
| `@stryker-mutator+tap-runner+10.0.0.patch` (dev tool, not client) | tap-runner 10.0.0 | No: 10.1.1 `tap-test-runner.js:144` still has the unpatched `failureMessage` line | server/tooling owner: regenerate if 10.1.1 is adopted |
| `modules/murlan-rn-patches` (not a patch-package file) | RN 0.86 | `MurlanRecycledLayout.mm` obsolete on 0.88 (see §3); `MurlanReactNativeFlags` still needed | edit after the bump |

## 5. Recommended sequence and gates

Ticket A (one PR, the core): **Expo SDK 58 bump**
1. `npx expo install expo@^58.0.22 --fix` (rewrites every row of the §1 table; keep `react-native-audio-api`, `react-native-turbo-haptics`, `canvaskit-wasm ^0.41`, `async-storage 2.2.0` as-is), then `npx expo-doctor@latest`. Add `@react-native/jest-preset@^0.88.1` and `jest@^30`, `@jest/globals@^30` (or keep Jest 29 only as a deliberate fallback); `@types/react` -> `~19.3.0`; `engines.node` -> `>=22.13`.
2. Patches: delete the reanimated patch; regenerate skia (2.14.0) and expo-linear-gradient (58.0.3); keep audio-api; update the filenames in `docs/agents/checks.md`, `tests/tooling/nativeScope.test.ts`.
3. Delete `modules/murlan-rn-patches/ios/MurlanRecycledLayout.mm` (or keep and make it a no-op if #1485 still reproduces on device).
4. Fix typecheck fallout of the Strict TS API; `npx expo prebuild --clean` once to diff the generated AppDelegate/SceneDelegate against `plugins/withSwiftUIFilters.js`.
Gates that must be green on that branch: `npm run verify` (typecheck, `typecheck:strict`, `npm test`, `test:native` x ios/android/compiled, lint), `tests/ui-rules/reactCompiler.test.ts`, `npm run expo:web:build` + `npm run bundle:budget` (the React 19.3 + Skia 2.14 + RNW bump can move the 1 MB budget), the Playwright web e2e (`npm run test:e2e`, the only layout check per CLAUDE.md), `ci.yml` native compile (package.json deps changed so `tools/ci/nativeScope.mjs` triggers it), then dispatch both device runs from the ticket branch: `gh workflow run ios-app-cache.yml --ref <branch>` (new fingerprint, ~21 min) -> `gh workflow run ios.yml` and `maestro.yml`, wait with `node scripts/await-run.mjs`. Specific device assertions: `.maestro/felt-opaque.yaml` (skia patch), landscape lock in `captures.yaml`, audio/haptics flows (audio-api vs RN 0.88), no black band (`tools/ci/feltPixels.mjs`). ADR 0009 requires its own gate for audio-api/haptics on release builds: run `audio-soak.yml`/`soak.yml` for the new RN since audio-api has no RN 0.88 declaration beyond `react-native: *`.
   Order inside the PR if it needs to be split by risk: (1) React/RN/Expo core, (2) reanimated+worklets+skia (pinned pair), (3) Jest 30 migration as its own commit.

Ticket B (separate, after A is on main): lockfile-only bumps within ranges (`@tanstack/react-query` 5.105.1, `socket.io-client` 4.8.4, `@testing-library/react-native` 14.1.0, `@playwright/test`, `react-native-web` already in A).
Ticket C: `useEffectEvent` conversion of the latest-ref sites (§3), one hook per commit.
Ticket D (optional): Android PCH env var in `maestro.yml`; `expo-atlas` for bundle attribution.
Do not ticket: AsyncStorage 3, canvaskit-wasm 0.42, reanimated/worklets above the SDK pin, gesture-handler 3.4, SDK 59 (does not exist yet).

### Open questions I could not close offline
- Exact SDK 58 text on Xcode version required and R8 default (blocked expo.dev). Check `npx expo-doctor` output and the upgrade-guide page in a session with expo.dev allowed.
- Reanimated 4.6/4.7 and worklets 0.11-0.13 release-note behaviour changes (blocked docs.swmansion.com and github.com releases).
- Whether the upstream reanimated fix has a linkable PR number.

## Sources
- https://expo.dev/changelog/sdk-58 and https://expo.dev/blog/how-to-upgrade-to-sdk-58 (search snippets only, host blocked for fetch)
- https://expo.dev/changelog/sdk-58-beta, https://dev.to/expo/expo-sdk-58-beta-opens-with-ios-27-support-and-a-faster-build-pipeline-5bb3 (search snippets)
- npm registry: expo@58.0.22 (bundledNativeModules.json, tsconfig.base.json), expo-router@58.0.29, expo-notifications@58.1.7 CHANGELOG, expo-screen-orientation@58.0.3, expo-linear-gradient@58.0.3, expo-font@58.0.11, expo-modules-core@58.0.29 CHANGELOG, expo-build-properties@58.0.12, expo-template-bare-minimum@sdk-58, jest-expo@58.0.13, babel-preset-expo@58.0.23, react-native@0.88.1, react-native-reanimated@4.7.1 (compatibility.json, NativeProxy.kt), react-native-worklets@0.13.0, @shopify/react-native-skia@2.14.0, react-native-audio-api@0.13.6, @react-native-async-storage/async-storage@3.1.1, @stryker-mutator/tap-runner@10.1.1
- https://raw.githubusercontent.com/facebook/react-native/main/CHANGELOG.md (v0.87.0, v0.88.0, v0.88.1)
- https://raw.githubusercontent.com/facebook/react/main/CHANGELOG.md (19.3.0)
- The full version table: `versions.md` beside this file
