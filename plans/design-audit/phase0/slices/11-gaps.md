# 11-gaps — slice review (SRC 50144087)

All 48 files read in full. Callers of each native module were grepped in SRC/lib, SRC/components, SRC/app, SRC/tests. The five patches were checked against package.json, package-lock.json and their tests.

## Findings

### 11-gaps-F1 (P2, S) `modules/murlan-diagnostics` also holds two production fixes, so its name and its gating test mislead
- files: modules/murlan-diagnostics/ios/MurlanRecycledLayout.mm:11-21 (view-recycling layout fix, #1485), modules/murlan-diagnostics/ios/MurlanReactNativeFlags.mm:20-26 (enables SwiftUI filters for `grayscale()`), modules/murlan-diagnostics/ios/MurlanDiagnostics.podspec:20-21 (compiles `*.{swift,h,mm}` together), plugins/withSwiftUIFilters.js:12 (writes `internal import MurlanDiagnostics` into every AppDelegate), tests/tooling/diagnosticsGate.test.ts:12-13 (`modules/murlan-diagnostics` is "diagnosticsOnly")
- problem: the module is autolinked into every build, and the two Obj-C++ files run in production (the `+load` swizzle on every launch, the flag override at AppDelegate start). The repo's own gate calls the whole module "diagnostics-only". That test only follows JS imports, so it can't see these two files. Someone who strips the diagnostics module from release builds (the rule that test enforces) loses the layout fix and the grayscale filters. Nothing fails, because the gate sees no JS edge. Locality is also poor: a RN-patch concern sits next to an ReplayKit/CoreMotion bench, so the podspec carries `ReplayKit`, `CoreMotion` and `React-Core` for both.
- proposed: split a `modules/murlan-rn-patches` module. It holds MurlanRecycledLayout.mm and MurlanReactNativeFlags.{h,mm} and has its own podspec, with `expo-module.config.json` `{"platforms":["apple"],"apple":{"modules":[]}}`. The plugin imports it instead. `recycledLayoutPatch.test.ts` and `swiftUIFiltersPlugin.test.ts` change only their path constants.
- effect: the "diagnostics" name becomes true. The bench module can later be dropped from release builds without breaking rendering, and the production-critical native code gets its own seam.
- overlap: new
- confidence: high

### 11-gaps-F2 (P2, S) `font-subset.json` check reads its own record, not the shipped fonts
- files: scripts/font-subset.json:2 (the `characters` string), tests/tooling/fontSubset.test.ts:19-32 (test 1)
- problem: test 1 compares the characters the app needs against `manifest.characters`, a committed text file. It never opens `public/fonts/*.woff2`. Adding a glyph to the manifest by hand, without running `build-fonts.mjs`, turns the check green while the font still renders tofu. This is the "green by not looking" shape CLAUDE.md names. The sibling `tests/tooling/iconSubset.test.ts:125-176` reads the real `cmap` of the TTF, so the repo already has the right pattern for icons. Tests 2 and 3 check existence and byte budget only.
- proposed: read the cmap from the woff2 files. Node has `zlib.brotliDecompressSync`, and cmap is untransformed in WOFF2. Share the cmap reader with iconSubset.test.ts as `tests/helpers/cmap.ts`. Then `characters` in the manifest can be dropped from the assertion and kept only as the build input.
- effect: the check can fail on a stale font file. One helper replaces two ways of checking the same thing.
- overlap: new
- confidence: high

### 11-gaps-F3 (P2, XS) Pass-loops assume `btn-passa` disappears when the round ends, but exchange-phase.yaml says it stays drawn
- files: .maestro/offline-game.yaml:213-227, .maestro/new-match.yaml:88-98 (`repeat times:30 while: visible btn-passa`), .maestro/exchange-phase.yaml:100-110 (same author states `btn-passa` stays drawn, disabled, through the table's ending), components/table/actions.tsx:259-267 (the Pressable is only `disabled`, not unmounted)
- problem: offline-game.yaml:213-217 says the loop stops the moment `btn-passa` is gone. exchange-phase.yaml:100 says the opposite for the same screen, and actions.tsx:259-267 renders the button with `disabled={!canPass}`. If the button persists after the round, both flows always burn the full 30 iterations, each a 500 ms settle plus a hierarchy read on a table that never settles. The same comment names that cost as where the minutes went. They then end on `btn-home` / `btn-new-match`, which do exist. The termination condition was fixed in exchange-phase.yaml (it loops on `notVisible: exchange-announce`) and not carried back. I could not run a device, so whether the button leaves the tree at match end is inferred.
- proposed: loop `while: notVisible: id: "btn-new-match"` in new-match.yaml and `notVisible: id: "btn-home"` in offline-game.yaml. The end state is then the exit condition, and the comment is true.
- effect: up to ~30 x (500 ms + read) per flow on both device jobs. #823 is open on wall-clock.
- overlap: new
- confidence: medium

### 11-gaps-F4 (P2, S) Seven Maestro flows copy the launch / tutorial-skip / lobby block, and the stated reason is false
- files: .maestro/smoke.yaml:10-61, offline-game.yaml:34-94, new-match.yaml:26-50, exchange-phase.yaml:37-61, felt-opaque.yaml:8-29, rotate-after-cover.yaml:9-30, _warmup.yaml:5-18
- problem: exchange-phase.yaml:7-9 and new-match.yaml:12-14 say "Maestro has no import mechanism, so the boilerplate is duplicated on purpose". Maestro's `runFlow: <file>` is that mechanism, and `felt-opaque.yaml:43` already uses it (`runFlow: captures.yaml`). The block carries timeouts (180000, 30000), the tutorial race fix (#353) and the `it-IT` launch arguments. Each copy is a place for those to drift. `MurlanE2EOpener: "1"` is already present in some flows and absent in others. `gameTableTapSettle.test.ts` reads the flows as text and would have to follow the include.
- proposed: add `.maestro/_launch.yaml` (underscore, so it is not a flow, as `_warmup.yaml` is) holding `launchApp clearState + arguments` and the tutorial skip. Add `.maestro/_lobby.yaml` taking `${FORMAT}` via `runFlow: {file, env:{FORMAT: "Manche secca.*"}}`. Each flow becomes launch + lobby + its own assertions (about 60% fewer lines in 5 files).
- effect: one home for the cold-start timeouts and Italian-locale arguments. The false "no import mechanism" comments go.
- overlap: new
- confidence: high on the false premise, medium on the extent of savings.

### 11-gaps-F5 (P3, XS) `captures.yaml` and `felt-opaque.yaml` use fixed sleeps and a hard-coded point
- files: .maestro/captures.yaml:24-25,28-29,32-33,36-37,45-46 (`waitForAnimationToEnd timeout:3000` x5), .maestro/felt-opaque.yaml:40-41 (2000), .maestro/captures.yaml:16-19 (`point: "530,222"`)
- problem: offline-game.yaml:19-28 says the table's glow and pulse never let the hierarchy settle. `waitForAnimationToEnd` against that screen therefore always runs to its timeout, so each is a ~3 s sleep (about 17 s of the iOS shard) that proves nothing about the state. The Open-button tap uses absolute landscape points taken from one run (`38061909920`), so a different simulator size mis-taps silently. `retryTapIfNoChange: false` and the `Cancel` `optional` guard make that failure invisible until the screenshot is wrong. The first state does wait on a real signal ("Move the lamp to the next seat", line 21-23).
- proposed: give each capture state a testID or accessibility label the way `lamp-bottom` has one, and use `extendedWaitUntil visible:` per state. Replace the point tap with the labelled Open button where iOS exposes it, or derive the point as a percentage like `_warmup.yaml:14` does.
- effect: less fixed time on the iOS device job and no run depends on device geometry.
- overlap: new
- confidence: medium (the "always runs to timeout" part is inferred from the repo's own note)

### 11-gaps-F6 (P3, XS) Patched-RN override has no tripwire for the day upstream fixes it
- files: modules/murlan-diagnostics/ios/MurlanRecycledLayout.mm:7-10 (fixed upstream in react/react-native#57590, "from 0.88"), tests/tooling/recycledLayoutPatch.test.ts:33-41 (excludes `COVERED` from the scan, `f !== COVERED`), package.json (`react-native` is `0.86.3`)
- problem: the Reanimated patch test has `DROP` guidance and fails when the installed library contains the upstream fix (reanimatedSyncPropsPatch.test.ts:20-21,40-45). The RN override has none. At 0.88 the override stays and still swaps `_layoutMetrics` after upstream already does, so it is harmless but permanent. The test even skips the one file that would change. Also `MurlanRecycledLayout.mm:15-16` does not check `method != NULL`, so if RN renames `prepareForRecycle` the swizzle silently installs nothing and the green source-text test says nothing.
- proposed: in the test, assert that `COVERED` still contains the stale `_layoutMetrics = {}` reset (`staleResets(read(COVERED)).length > 0`). When it stops, fail with "react-native contains #57590, delete MurlanRecycledLayout.mm and this test". In the .mm, `if (!method) return;` is not enough on its own: add an `NSAssert` / log so a rename is loud.
- effect: removes a permanent orphan on the next RN upgrade, with the same shape as the Reanimated patch.
- overlap: new
- confidence: medium (react-native itself was not in SRC to read the installed RCTViewComponentView.mm)

### 11-gaps-F7 (P3, XS) `deploy/runtime.json` `postgres: 16` is never checked, while `node` is
- files: deploy/runtime.json:3, tests/server/deployRuntime.test.ts:14-26 (checks `node` in engines and in CI's build job, never `postgres`), .github/workflows/ci.yml:304,931 and soak.yml:41 (three `postgres:16-alpine` images)
- problem: four of the five fields have a test (node, sigtermGraceMs, pgConnectionsPerInstance, and proxyHops in cors.test.ts:81). `postgres` is only read in a message at scripts/backup-db.mjs:41. A premise that lives in prose decays: bumping the CI service image to 17 leaves the manifest, which is "the contract any host must meet", claiming 16.
- proposed: add a test to deployRuntime.test.ts that every `image: ...postgres:<N>` in `.github/workflows/*.yml` equals `manifest.postgres`.
- overlap: new
- confidence: high

### 11-gaps-F8 (P3, XS) `scripts/post-merge.sh` is an unreferenced Replit-era hook, and uses `npm install`
- files: scripts/post-merge.sh:1-7
- problem: no reference anywhere (grep of SRC outside docs/plans). It runs `npm install`, which can re-resolve past package-lock.json, where the repo's other installs use `npm ci`. If anyone does wire it up, that is the wrong command.
- proposed: delete.
- overlap: confirms tooling-F17
- confidence: high

### 11-gaps-F9 (P3, XS) `skills-lock.json` lists seven skills, only one is installed, and nothing reads it
- files: skills-lock.json:3-43, .claude/skills (contains `react-native-best-practices/` only)
- problem: six entries (`find-skills`, `frontend-design`, `next-best-practices`, `radon-mcp`, `rnrepo`, `typegpu`) have no directory in `.claude/skills`. `next-best-practices` is a Next.js skill in an Expo app. The only reference to the file in SRC is the audit workflow's scope list (`.claude/workflows/audit.mjs:255`). As a lock it records hashes of things that are not there.
- proposed: either regenerate it from the installed skills or delete it.
- overlap: new
- confidence: medium

### 11-gaps-F10 (P3, XS) `result-schema.json` lets extra fields through; a test does that check by hand
- files: tools/loop/result-schema.json:3-14, tools/loop/queue-loop.mjs:209,241-242 (`--json-schema`), tools/loop/tests/loopDocsAreExecutable.test.ts:140-146 (`for (field of Object.keys(out)) assert.ok(field in schema.properties)`)
- problem: the schema has `required` but no `additionalProperties: false`. The test re-implements that rule over queue.md's printed examples only, so a model emitting a stray field in a real session is accepted.
- proposed: add `"additionalProperties": false` and drop the manual loop (keep the required check).
- overlap: new
- confidence: high

### 11-gaps-F11 (P3, XS) Small shell hardening
- files: tools/ci/rebundle-android-app.sh:12 (`find ... -name zipalign | sort | tail -1`), tools/ci/report-device-run.sh:16-17 (`$title` interpolated into the `--jq` program), .github/scripts/gitleaks-scan.sh:6,13 (`set -o pipefail` only, volume mounted read-write)
- problem: (a) `sort | tail -1` is lexicographic, so `build-tools/9.0.0` would beat `34.0.0` and `100.x` loses to `35.x`; use `sort -V`. (b) `$title` goes into a double-quoted jq string from `$workflow`; only `ios.yml` and `maestro.yml` pass today, but `--arg t "$title"` and `select(.title == $t)` removes the quoting hazard. (c) gitleaks-scan.sh has no `-e`/`-u`, and it relies on its callers noticing the exit status. Both ci.yml callers do (the self-test checks `status -ne 1`, and a missing `GITLEAKS_IMAGE` fails closed with a docker error). Mounting the tree `:ro` would also stop a scanner container writing into the checkout.
- overlap: new
- confidence: high (low impact)

### 11-gaps-F12 (P3, S) Two modules read the same `AVAudioSession` values, and `footprintMb` means different things per platform
- files: modules/murlan-audio-session/ios/MurlanAudioSessionModule.swift:8-9 (`outputLatencyMs`, `ioBufferMs`), modules/murlan-diagnostics/ios/MurlanDiagnosticsModule.swift:31-32 (same two, plus `inputLatencyMs`), modules/murlan-diagnostics/android/src/main/java/expo/modules/murlandiagnostics/MurlanDiagnosticsModule.kt:15-18 (resident pages from `/proc/self/statm`) vs MurlanDiagnosticsModule.swift:20-29 (`phys_footprint`)
- problem: the bench (`lib/diagnostics/probe.ts:7-9`) measures latency through the diagnostics copy, while production (`lib/device/audioEngine.ts:252-253`) uses the audio-session copy, so the bench does not exercise the production code path. The two copies are not interchangeable by import, because `eslint.config.js:32-33` gives each module one owner. `footprintMb` is RSS on Android and dirty-footprint on iOS under one name, so cross-platform bench rows are not comparable.
- proposed: let `audioEngine.ts` export a small `outputTiming()` and have the bench read that, and delete the two duplicate Swift functions. Rename or document the footprint semantics per platform in the TS interface.
- overlap: new
- confidence: medium

### 11-gaps-F13 (P3, S) Native diagnostics module: unbounded buffer, state not reset between captures, error swallowed on stop
- files: modules/murlan-diagnostics/ios/MurlanDiagnosticsModule.swift:9 (`rows` only drained by JS), :9-12 and :35-48 (detectors are stored properties that `startCapture`/`stopCapture` never reset), :50-52 (`stopCapture { _ in promise.resolve(true) }`), :38-40 (`error == nil` guard drops mid-capture errors silently), modules/murlan-diagnostics/ios/Detectors.swift:9-12
- problem: if the bench stops draining (JS paused, bench screen left), `rows` grows without bound at audio rate (a `level` row every 50 ms). A second `startCapture` begins with the previous run's `average`, `levelStart` and `lastOnset`, so its first onset and level window use stale times. `stopCapture` reports `true` whatever ReplayKit returned. This only runs in diagnostics builds, hence P3.
- proposed: reset detectors in `startCapture`, cap `rows` (drop-oldest), reject `stopCapture` on error.
- overlap: new
- confidence: medium

## Prior findings that are wrong or already fixed
- tooling-F17 (`post-merge.sh` has zero references) holds exactly (see F8).
- The brief asked whether each patch's package version still matches package.json. All five patch files carry the locked version: skia 2.12.0, audio-api 0.13.6, reanimated 4.5.5 are exact pins in package.json. `@socket.io/postgres-adapter` is `^0.5.0` and `expo-linear-gradient` is `~57.0.2`. Both are range-pinned, so the patch filename could silently go stale on a lockfile bump. package-lock.json holds 0.5.0 and 57.0.2 today, and each is covered by a test that exercises the installed code (postgresAdapterPatch.test.ts runs the real `PubSubClient`; linearGradientHiddenLayout.test.tsx runs the real web module). So a stale patch fails CI rather than passing. Making both exact in package.json would remove even that gap.
- Each patch is still needed and recorded: skia (docs/agents/checks.md:132-139 plus skiaOpaquePatch.test.ts), audio-api (#1238 in audioApiPatch.test.ts), reanimated (#1557, upstream software-mansion/react-native-reanimated#10435, with explicit drop instruction in the test), postgres adapter (server/CLAUDE.md:52), linear-gradient (#1411 in the test header). The patch files themselves carry no reason, which is normal for patch-package; the reasons are in tests and docs.

## Inventory items checked
- The inventory was read for slice-relevant items; none of the 48 files appears in its function-length, cycle or layer-violation lists (shell, YAML, JSON, native code are not scanned).

## Native module caller check (brief question)
- murlan-audio-session: `index.ts:3-7` types all three functions as sync and non-optional, and the module is `requireOptionalNativeModule` (undefined on Android and web). Callers: `lib/device/audioEngine.ts:94,252-253` use `session?.` everywhere. Matches. `preferLowLatency` swallows the error with `try?` (acceptable: a preference, not a requirement).
- murlan-orientation: `holdLandscape`, `release`, `snapshot` are `AsyncFunction(...).runOnQueue(.main)`, so UIKit calls run on main. Callers: `components/GameTable.tsx:211,966` use `?.` and `.catch(() => {})`, and `lib/diagnostics/index.ts:62-64` handles rejection. Matches. One gap: `requestGeometryUpdate`'s error handler (MurlanOrientationModule.swift:38-42) only stores `lastError` for `snapshot()`, so `holdLandscape()` resolves `void` even when the geometry request failed. Intentional (diagnostic row), but JS cannot react. `release()` (49) does not call `setNeedsUpdateOfSupportedInterfaceOrientations`, relying on expo's `unlockAsync` that GameTable calls just before.
- murlan-diagnostics: `index.ts:3-14` types the iOS-only members optional; `lib/diagnostics/probe.ts:4-20` guards each with `?.`. The Android module implements only `hostNowMs` and `footprintMb`, matching the non-optional part of the interface. Matches. `drain()` rows typed `Record<string,string|number>[]` while Swift returns `[String: Any]` rows; `probe.ts:19` casts through `unknown`.

## Coverage
| file | lines | verdict |
|---|---|---|
| .github/scripts/gitleaks-scan.sh | 14 | F11 (minor); otherwise leave-alone: shared by scan and self-test by design |
| .gitleaks.toml | 43 | clean (AND-scoped allowlists; self-test in ci.yml:252-285 proves aws-access-token still fires) |
| .maestro/_warmup.yaml | 18 | F4 |
| .maestro/audio-soak.yaml | 6 | clean (launcher only; the workflow gates on ndjson) |
| .maestro/captures.yaml | 47 | F5 |
| .maestro/exchange-phase.yaml | 140 | F3 (confirming source of the contradiction), F4 |
| .maestro/felt-opaque.yaml | 43 | F4, F5 |
| .maestro/new-match.yaml | 117 | F3, F4 |
| .maestro/offline-game.yaml | 233 | F3, F4 |
| .maestro/rotate-after-cover.yaml | 45 | F4 |
| .maestro/smoke.yaml | 88 | F4 |
| deploy/runtime.json | 7 | F7 |
| modules/murlan-audio-session/expo-module.config.json | 4 | clean |
| modules/murlan-audio-session/ios/MurlanAudioSession.podspec | 15 | clean |
| modules/murlan-audio-session/ios/MurlanAudioSessionModule.swift | 12 | F12 (duplicate of diagnostics reads) |
| modules/murlan-diagnostics/android/build.gradle | 15 | clean |
| modules/murlan-diagnostics/android/src/main/java/expo/modules/murlandiagnostics/MurlanDiagnosticsModule.kt | 20 | F12 |
| modules/murlan-diagnostics/expo-module.config.json | 5 | F1 |
| modules/murlan-diagnostics/ios/Detectors.swift | 91 | F13 |
| modules/murlan-diagnostics/ios/MurlanDiagnostics.podspec | 23 | F1 |
| modules/murlan-diagnostics/ios/MurlanDiagnosticsModule.swift | 77 | F12, F13 |
| modules/murlan-diagnostics/ios/MurlanReactNativeFlags.h | 16 | F1 |
| modules/murlan-diagnostics/ios/MurlanReactNativeFlags.mm | 27 | F1 |
| modules/murlan-diagnostics/ios/MurlanRecycledLayout.mm | 28 | F1, F6 |
| modules/murlan-orientation/expo-module.config.json | 4 | clean |
| modules/murlan-orientation/ios/MurlanOrientation.podspec | 15 | clean |
| modules/murlan-orientation/ios/MurlanOrientationModule.swift | 150 | leave-alone: deep (3-function interface over a UIKit delegate patch); caller check above |
| patches/@shopify+react-native-skia+2.12.0.patch | 32 | clean (tested, recorded) |
| patches/@socket.io+postgres-adapter+0.5.0.patch | 79 | clean (behaviour-tested; range pin noted under "prior findings") |
| patches/expo-linear-gradient+57.0.2.patch | 21 | clean (range pin noted) |
| patches/react-native-audio-api+0.13.6.patch | 35 | clean |
| patches/react-native-reanimated+4.5.5.patch | 32 | clean (model of a drop-when-upstream test, see F6) |
| scripts/font-subset.json | 11 | F2 |
| scripts/icon-subset.json | 4 | clean (glyph strings are private-use codepoints; cmap-checked by iconSubset.test.ts) |
| scripts/post-merge.sh | 7 | F8 |
| skills-lock.json | 44 | F9 |
| tools/ci/rebundle-android-app.sh | 25 | F11; otherwise clean (set -euo pipefail, ends with a `cmp` of the packed bundle) |
| tools/ci/rebundle-ios-app.sh | 24 | clean (final `[ -s main.jsbundle ]` covers the env-prefix substitutions errexit cannot see) |
| tools/ci/report-device-run.sh | 22 | F11 |
| tools/loop/loop-settings.json | 53 | clean (owner's local path and plugin names are hard-coded in prose; the loop runs only on that machine) |
| tools/loop/package.json | 6 | leave-alone: exists only for `type: module`, says so |
| tools/loop/result-schema.json | 15 | F10 |
| tools/loop/tests/fixtures/ledger-golden.main.json | ~170 | clean (regression snapshot read by loopCost/loopLogs tests) |
| tools/loop/tests/fixtures/rollup-absent.json | 40 | clean (recorded real `gh` rollup; check names match ci.yml job names) |
| tools/loop/tests/fixtures/rollup-green.json | ~45 | clean |
| tools/loop/tests/fixtures/rollup-pending.json | ~45 | clean |
| tools/loop/tests/fixtures/rollup-red.json | ~60 | clean |
| tsconfig.strictIndexed.json | 10 | clean (areas limited to server/ and context/ on purpose; scripts/checkStrictIndexed.mjs guards the vacuous-pass case) |
