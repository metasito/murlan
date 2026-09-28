# Audio and haptics engine for the lantern table (2026-09-28)

**Verdict.** Audio: **react-native-audio-api 0.13.6** (Software Mansion). Run **one AudioContext for music and effects** on iOS, Android and web. Every effect is a one-shot `AudioBufferSourceNode` played from a pre-decoded buffer. Music is a decoded **FLAC** loop, crossfaded and ducked with `GainNode` automation. Haptics: **react-native-turbo-haptics 1.2.0**. It keeps long-lived, prepared UIKit generators. It triggers synchronously on the main thread when called from a UI worklet, and on Android it uses the system haptic constants. Remove expo-audio and expo-haptics.

Legend: **[V]** = verified in source, docs, the npm registry or the GitHub API. **[I]** = inference. Citation shorthand:
- RNAA = `github.com/software-mansion/react-native-audio-api/blob/0.13.6/packages/react-native-audio-api/`
- DOCS = `…/blob/0.13.6/packages/audiodocs/docs/`
- expo-audio and expo-haptics paths are `node_modules/…` in this repo (57.0.5 and 57.0.3).

## 0. Two premises in the brief are wrong
1. **The music tracks are 27.41 s loops, not 3-minute tracks.** [V: the `mvhd` box of `assets/music/{menu,hand,cue}.m4a`, which are 1.8, 2.0 and 1.6 MB.] Decoded as float32 stereo at 48 kHz, one track is about **10.5 MB** of PCM. Decoding into a buffer and looping it is therefore the right model, and nothing needs streaming. The "7.5 MB" figure is the README's old four-file total (`assets/music/README.md:115-117`).
2. **react-native-audio-api cannot decode the WebM that Android uses today.** [V] Format sniffing has no EBML/Matroska branch (RNAA `common/cpp/audioapi/core/utils/AudioDecoding.cpp:57-101`). FFmpeg is only used for `.mp4/.m4a/.aac` (`AudioDecoding.h:45-50`). miniaudio decodes mp3, wav and flac, and ogg/opus through static libs (DOCS `utils/decoding.mdx:15-27`). **Native music must change container.** Section C covers this.

## A. Effects + music engine

### A1. react-native-audio-api 0.13.6 — facts
| Topic | Finding |
|---|---|
| Version and maintenance | npm `latest` is 0.13.6 (2026-09-23). Releases 0.13.3→0.13.6 all shipped in Sept 2026. `1.0.0-nightly` builds are published daily. 844★, pushed 2026-09-28, 45 open issues, MIT. [V: npm; gh api] |
| RN / Expo compatibility | Peers: `react-native: *`; `react-native-worklets >=0.7.0` is optional. [V: RNAA `package.json`] The compatibility table is stale: it stops at RN 0.85 and lib 0.12.x (DOCS `other/compatibility.mdx:15-17`) [V]. The example app ran RN 0.85.0 through tag 0.13.3 and runs **0.87.0 at 0.13.6**, so RN 0.86 never ran in the library's CI [V: `apps/fabric-example/package.json` at each tag]. The 0.87 bump (PR #1226) changed only JS in the library (`AudioDecoder.ts`, `Audio/utils.ts`) [V]. **So 0.86 sits between two supported versions and is low risk, but only our own CI build proves it** [I]. Expo SDK 57 does not pin this library (`node_modules/expo/bundledNativeModules.json`) [V]. |
| New Architecture | Fabric/TurboModule over JSI host objects. The old-architecture table ends at RN 0.81 (compatibility.mdx:36-45). [V] |
| Worklets coupling | If `react-native-worklets ≥0.7` is installed, worklet integration compiles automatically. That applies to our 0.10.4 (`scripts/rnaa_utils.rb:1-26`, `android/build.gradle:127-128`) [V]. This coupling has broken builds before (#1095 on 0.12.2; #1250 on worklets 0.12, fixed in 0.13.4). Maintainers say 1.0 moves worklets into a separate package (#1250 comment; PR #1226 touches `packages/react-native-audio-worklets`) [V]. Nothing breaks with 0.10 that we know of [I]. |
| Expo config plugin | `app.plugin.js` → `withAudioAPI.ts`. **The defaults add `UIBackgroundModes: audio`, Android `FOREGROUND_SERVICE(_MEDIA_PLAYBACK)` and a foreground service** (`src/plugin/withAudioAPI.ts:23-37, 39-49, 68-105`) [V]. A card game must turn all of these off (C2). |
| iOS engine and threads | One shared `AVAudioEngine`. Each context attaches an `AVAudioSourceNode` render block (`ios/…/system/AudioEngine.mm:145-164`, `core/NativeAudioPlayer.m:35-62`) [V]. Rendering runs on Core Audio's real-time thread, not main [I: Apple semantics]. |
| Session handling | The default category is `Playback`, mode Default, options 0 (`system/AudioSessionManager.mm:28-45`). That plays through the silent switch, which is what `playsInSilentMode` gave us [V code; I Apple semantics]. **Activation happens once and is cached** (`isActive`, `:177-198`). It is re-armed only after `markInactive`, which runs on interruption, route change, media-services reset or engine configuration change (`SystemNotificationManager.mm:114-259`) [V]. The session is deactivated only by context `cleanup` (`AudioEngine.mm:137`) or an explicit `AudioManager.setAudioSessionActivity(false)` [V]. **Nothing in the per-play path touches AVAudioSession.** Options are set through `AudioManager.setAudioSessionOptions({iosCategory, iosMode, iosOptions})` (DOCS `system/audio-manager.mdx:47-59`) [V]. |
| Interruptions, routes, background | The library observes route changes, media reset, engine configuration change and interruptions. It auto-restarts the engine at interruption end unless the app opts into handling that itself (`SystemNotificationManager.mm:76-94, 139-148`) [V]. It has **no app-lifecycle observer** [V: none in those files]. So call `suspend()`/`resume()` from `AppState` [I]. A running context renders silence, so suspend it when idle (DOCS `fundamentals/best-practices.mdx:19-21`) [V]. |
| Main thread and JS thread cost of `start()` | `start()` queues a lambda for the audio thread (`common/cpp/audioapi/HostObjects/sources/AudioBufferSourceNodeHostObject.cpp:124-136`) [V]. Exception: the **first** `start()` on a context starts the driver on the JS thread (`AudioScheduledSourceNode.cpp:27-33` → `AudioContext.cpp:45-63,113-120` → `NativeAudioPlayer.m:64-85`) [V]. Calling `resume()` at launch moves that start off the tap path [I]. |
| Per-play cost | **Setting `source.buffer` deep-copies the PCM on the JS thread** (`AudioBufferSourceNodeHostObject.cpp:154-191`, copy at :178; the copy constructor is at `utils/AudioBuffer.hpp:47-52`) [V]. For a 0.1-1 s effect that is tens to hundreds of KB, which is negligible [I]. For music it means one 10.5 MB copy per loop start, so use `loop=true` rather than chaining one-shot sources [I]. |
| Decoding | Decoding runs as an async promise on a worker, off the JS thread (`HostObjects/utils/AudioDecoderHostObject.cpp:22-76`, `createAsyncPromise`) [V]. `ctx.decodeAudioData` resamples to the context rate; the standalone `decodeAudioData(input, sampleRate?)` does the same when given a rate (decoding.mdx:9-13, 29-32) [V]. JS input handling: remote URLs are fetched in JS, which covers dev-client Metro assets. Android release assets go through **base64 over the bridge** (`src/core/AudioDecoder.ts:83-116`) [V]. |
| Scheduling | `start(when, offset, duration)`. The render loop converts `startTime_` to a sample frame (`AudioScheduledSourceNode.cpp:64-80`), so starts are sample-accurate at render-quantum level [V]. **There is no `outputLatency`/`getOutputTimestamp` on native.** `AudioContext` has only close/suspend/resume, and BaseAudioContext only `currentTime`, `destination`, `sampleRate`, `state` (DOCS `other/web-audio-api-coverage.mdx:32-33`) [V]. |
| Automation and mixing | `AudioParam` supports setValueAtTime, linear and exponential ramps, setTargetAtTime, setValueCurveAtTime, cancelScheduledValues and cancelAndHoldAtTime (`src/core/AudioParam.ts`) [V]. A bug where in-flight automation was not cancelled is fixed in 0.13.4 (#1266 comment) [V]. **No DynamicsCompressorNode** (coverage.mdx:42; #597, #1180) [V]. Polyphony: every source node is independent and no voice cap is documented [I]. |
| Long files | `createStreamer` (HLS/URL, needs FFmpeg), `createBufferQueueSource` (mobile only), and `<Audio>`/file source (FFmpeg for m4a) (DOCS `core/base-audio-context.mdx:91-99,171-179`; `flags/runtime-flags.mdx:33-44`) [V]. None of these are needed at 27 s. |
| Android | Oboe, `SharingMode::Exclusive`, `PerformanceMode::LowLatency`, float (`android/…/core/AudioPlayer.cpp:34-37`) [V]. |
| Web | `api.web.ts` → `web-core/*` wrap the browser's `window.AudioContext` (`src/web-core/AudioContext.web.ts:26-41`). The docs say the web build exposes only the Web Audio subset that iOS and Android implement (DOCS `fundamentals/getting-started.mdx:154-160`) [V]. The constructor creates the context immediately with no `webkit` fallback, so it must be built inside the gesture handler, as `sounds.ts:43-87` does today [V/I]. The pitch-correction wasm loads lazily by script tag, and only when `pitchCorrection` is set (`AudioBufferSourceNode.web.ts:14-15`, `LoadCustomWasm.ts`) [V]. |
| Jest | `react-native-audio-api/mock` (`mock/package.json` → `src/mock/index.ts`, 1,243 lines). It covers AudioContext, decodeAudioData and AudioManager. Usage is `jest.mock('react-native-audio-api', () => require('react-native-audio-api/mock'))` (DOCS `other/testing.mdx:14-40`) [V]. |
| Size | The npm package unpacks to 9.46 MB [V]. At pod install / Gradle build it downloads prebuilt binaries from `rn-audio-libs` v3.1.0: `ffmpeg_ios.zip` 11.5 MB, `jniLibs.zip` 11.3 MB, `iphoneos.zip` 0.8 MB, `android.zip` 2.5 MB [V: gh release assets; `RNAudioAPI.podspec:68-71`; `android/build.gradle:320-326`]. **`disableFFmpeg` + `disableStaticExternalLibs` remove all of these** (DOCS `other/disabling-prebuilt-libraries.mdx:18-21`) [V]. |

### A2. How each measured defect goes away
1. **Per-tap main-thread stall.** No per-play session activation, observer registration or main-queue work (A1 rows 6-7). expo-audio does all three on every `play`: `setActive(true)` (`expo-audio/ios/AudioModule.swift:212-216,824-826`), an end observer re-added with `object: nil` (`AudioPlayer.swift:107,442-451`), and a periodic time observer on the main queue (`:108,474-482`) [V]. The fix for stalls is structural [I, to be proven by the A/B in C5].
2. **Silent plays (29-50%).** There is no seek at all. Each play is a fresh one-shot source that reads from `offset` (`AudioBufferSourceNode.cpp:90-108`) [V]. The race cannot happen [I].
3. **Pile-ups.** All sounds go through one mix point, so JS owns the policy: per-moment dedupe window, priority and voice cap. Without a compressor, use gain staging or a WaveShaper soft clip [I].
4. **750 ms first play.** Buffers are pre-decoded and the engine is started at launch. Onset becomes the next render quantum plus the IO buffer [I]. The library never sets `preferredIOBufferDuration` (no occurrence in `ios/`) [V], so the iOS default applies [I].
5. **Music gaps and death after a switch.** A switch becomes `newSource.start(now)` plus two gain ramps in the same clock domain. No player warm-up exists, and no per-player `setActive(false)` exists. The session-death sequence (expo-audio `deactivateSession`, 100 ms sleep, `AudioModule.swift:828-841`) cannot occur [V/I].
6. **Landing sync.** JS knows the landing time when it launches the animation. Call `start(ctx.currentTime + remaining + calib)` and the audio thread starts on that sample regardless of later JS jank [V API; I design]. Calibrate `calib` per platform, because native exposes no output latency.
**Music and effects share one context** (DOCS best-practices.mdx:12-14 recommends a single context; the current web code already does this, `lib/device/sounds.ts:23-30`) [V]. Ducking can then be scheduled at the bomb's own `when`.

### A3. Open issues that apply to us
- **#1230 (Android).** After a non-`ErrorDisconnected` Oboe error, `resume()` fails for the rest of the session. It was reported by a game using buffer-source effects plus music, about 20 users in 14 days. → Add a context watchdog that closes and recreates the context [V issue; I fix].
- **#1231 (Android).** Hard-coded LowLatency crackles on entry-level devices with several sources → test on a low-end device.
- **#1263 (Android).** Native heap leak when source nodes are recreated on the same buffer. The report uses 240 s buffers; ours are small. → Soak test (C5).
- **#1238 (iOS).** An NSException thrown by `startAndReturnError` aborts the app on the first engine start, which usually happens on the first tap. → Start the engine at launch, not on a tap [I].
- **#1209 (iOS).** A failed restart after an engine configuration change is dropped. The report involves an input node; we have none [I: lower risk].
- **#1285.** SIGSEGV under source churn with `onEnded`. The maintainer diagnosed the repro as an OOM (2026-09-23 comment). → Don't attach `onEnded` to effects.

### A4. Alternatives and why each misses the bar
- **expo-audio + `keepAudioSessionActive` + awaited seek.** The flag only skips *deactivation* (`AudioModule.swift:134-138,246-248`). `play` still calls `setActive(true)` and re-registers both observers every time (above) [V]. Awaiting `seekTo` (`AudioPlayer.swift:179-189`) removes #2 but adds a round trip before every onset. It is still AVPlayer: cold buffering (#4, #5), no sample-accurate start (#6), no gain ramps (`lib/device/music.ts:195`), and polyphony only by duplicating players (`sounds.ts:215-217`) [V/I]. **Fails #1 and #3-#6.**
- **react-native-track-player 4.1.2** (last stable 2025-08-12; v5 exists only as alpha nightlies). Music only. It would be a second session owner next to effects [V npm; I].
- **react-native-sound 0.13.0** (2025-10-15; 254 open issues). One AVAudioPlayer per sound. It calls `setCategory`/`setActive` itself (`ios/RNSound.mm:114-120,145-174`). No scheduling, no ramps, no web [V].
- **A custom Expo Module over AVAudioEngine/AVAudioPlayerNode + Oboe.** That is what react-native-audio-api already is (A1 rows 6, 13), minus the web path. We would also have to own interruption, route and media-reset recovery (`SystemNotificationManager.mm`). Keep it only as the fallback if C5 fails [I].

## B. Haptics
| Library | What it does on each tap (iOS unless noted) | Verdict |
|---|---|---|
| expo-haptics 57.0.3 | Allocates a new generator, calls `prepare()` and triggers, on `.main` (`ios/HapticsModule.swift:7-26`). Android uses `Vibrator.createWaveform` (`HapticsModule.kt:54-61`) [V] | Anti-pattern. Apple: "Calling `prepare()` and then immediately triggering feedback… does not improve latency" (developer.apple.com/documentation/uikit/uifeedbackgenerator/prepare()) [V] |
| react-native-haptic-feedback 3.0.0 | `methodQueue` is main (`ios/RNHapticFeedback/RNHapticFeedback.mm:19-21` @07e7f4b). The CHHapticEngine lives long, but **each call creates a pattern and a player** (`:218-233`). The UIKit fallback allocates a generator per call (`:183-213`). The engine is set to nil on stop and restarted lazily on the next tap (`:28-64`) [V] | No |
| react-native-nitro-haptics 0.2.3 (last push 2026-03) | New generator plus `prepare()` per call, **run on whichever thread calls it**, including the JS thread (`ios/HybridHaptics.swift:16-32` @ccda845) [V] | No |
| react-native-pulsar 1.7.0 (SWM) | System presets hold one generator each, prepared at construction (`iOS/…/SystemPresetsImpl.swift:5-16,29,35-37`), cached in `PresetsWrapper.swift:9,222-229`. The TurboModule `methodQueue` is main (`react-native/react-native-pulsar/ios/Haptics.mm:52-54` @bedb80c) [V] | Correct, but a Core Haptics preset/composer platform: far more surface than 7 taps need |
| Core Haptics (custom) | Time-scheduled patterns; `playsHapticsOnly` lowers latency and skips audio (Apple `chhapticengine/playshapticsonly`). `init(audioSession: nil)` means it does not follow the app's session (Apple `init(audiosession:)`) [V]. Stop/reset lifecycle to manage, as RNHF `:28-64` shows [V] | Overkill for our HapticHelper set |
| **react-native-turbo-haptics 1.2.0** (2026-09-19, MIT) | **Cached generators** (`package/ios/TurboHapticsBindings.mm:33-39`). **Triggers, then re-prepares**, which is Apple's recommended order (`:78-105`). Called directly when already on main (UI-worklet calls), otherwise `dispatch_async(main)` (`:141-150`). Drops generators on resign-active and background (`TurboHapticsModule.mm:40-60`). JSI install through `installJSIBindingsWithRuntime:callInvoker:` for RN ≥0.79 (`:72`). Android: `performHapticFeedback` constants, or `VibrationEffect` composition primitives with `USAGE_TOUCH`, on the UI thread, respecting the system setting (`android/…/HapticFeedback.kt:34-106,135-162`); declares `VIBRATE` @29d8907 [V] | **Recommended** |

turbo-haptics covers every `HapticHelper` in `lib/device/cues.ts:19-26` (selection, impactLight/Medium/Heavy, rigid, notificationSuccess/Warning) [V]. Its UI-worklet path lets the landing and bomb pulses fire on the exact animation frame: `BOMB_PULSES` already sit on the kick's jolt stops (`cues.ts:53-59`) [I].

Risks: one maintainer; its examples target RN 0.76 / Reanimated 3 (`examples/example-fabric/package.json`); open issue #4 (no haptics on iOS 15) [V]. Calling it from a worklet under worklets 0.10 is a README claim, not something I tested [I]. No web implementation and no jest mock ship with it [V]. Fallback: vendor its roughly 200 lines of MIT code as a local Expo module (`modules/`).

Note: the A/B showed haptics alone produce no stalls, so the audio change is the main fix. The haptics change removes per-call allocate-and-prepare work on main and adds exact-frame triggering [I].

## C. Adoption

### C1. Pins
`react-native-audio-api@0.13.6` and `react-native-turbo-haptics@1.2.0`, both installed with `--save-exact`. Remove `expo-audio` and `expo-haptics`. Keep `react-native-worklets@0.10.4` (≥0.7 is required).

**Plan the move to 1.0** once it is stable, because it decouples worklets (#1250) [I].

### C2. app.json and build
1. In `plugins`, replace `"expo-audio"` with:
   `["react-native-audio-api", {"iosBackgroundMode": false, "androidForegroundService": false, "androidPermissions": [], "disableFFmpeg": true, "disableStaticExternalLibs": true}]`
   - FLAC and MP3 decode through miniaudio, so neither FFmpeg nor ogg/opus is needed (runtime-flags.mdx:44) [V].
   - The plugin writes the flags into the Podfile and `gradle.properties` (`withAudioAPI.ts:107-217`) [V].
2. In `metro.config.js`, add `config.resolver.assetExts.push("flac")`.
   - Expo's defaults are `webm, aac, aiff, caf, m4a, mp3, wav` [V: `getDefaultConfig` run in this repo; decoding.mdx:71-74].
3. Produce the native music assets:
   - Run `ffmpeg -i assets/music/<t>.m4a -c:a flac assets/music/<t>.flac`. ALAC to FLAC is lossless to lossless, so the PCM iOS ships today is kept, and so is the loop seam argument (README "The iOS encode") [I].
   - Rename `lib/device/musicTracks.ios.ts` to `.native.ts` pointing at FLAC. Web keeps WebM.
   - Update `tests/tooling/musicAssets.test.ts` to check FLAC STREAMINFO sample count, rate and channels against the WebM, and update `tests/native/musicPlatform.test.tsx`.
   - Delete the `.m4a` files.
4. Android release decode: pass the asset's `localUri` from `expo-asset` `Asset.fromModule(m).downloadAsync()`. This avoids the base64 bridge path (`AudioDecoder.ts:98-111`) [I].
5. CI build:
   - Run `npx expo prebuild --clean`. With both flags set, the download script skips FFmpeg and the static libs (`scripts/download-prebuilt-binaries.sh`, `skipffmpeg` / `DISABLE_AUDIOAPI_STATIC_EXTERNAL_LIBS`) [V].
   - Assert that the `.app/Frameworks` folder contains no `libav*`, that Info.plist has no `UIBackgroundModes`, and that the Android manifest has no `FOREGROUND_SERVICE_MEDIA_PLAYBACK`.
   - Local Android builds on Windows need Git bash (getting-started.mdx:107; `build.gradle:320-326`) [V].

### C3. Code shape (one owner, like `autoMove.ts`)
1. **Single owner.** `lib/device/audioEngine.ts` is the only importer of `react-native-audio-api`. Pin that with a test.
2. **Session options at boot.** `AudioManager.setAudioSessionOptions({iosCategory: "playback", iosMode: "default", iosOptions: ["mixWithOthers"]})`.
   - **This is a product decision to flag.** Today expo-audio falls back to `interruptionModeAndroid: "duckOthers"` on iOS too (`expo-audio/src/ExpoAudio.ts:499`) [V]. Under a session that now stays active for the whole run, that would duck the player's Spotify the whole time [I].
3. **Lifecycle.** Create the context at launch, then call `resume()`. Suspend on `AppState` background; resume on active and on an interruption `ended` event.
   - Watchdog: if `state !== "running"` after `resume()`, close the context and create a new one (#1230). Decode with an explicit `sampleRate` so the buffers survive recreation (decoding.mdx:9-13) [I].
4. **Graph.** Source → per-voice gain → sfx bus or music bus → master → destination.
5. **Effects.** Decode at preload. Each play creates a source, sets `playbackRate` for the existing jitter, then calls `start(when)`. Do not attach `onEnded`.
6. **Music.** One `loop=true` source per track. Crossfade with 0.6 s `linearRampToValueAtTime`; duck with `setTargetAtTime` at the effect's `when`. Keep at most two decoded tracks, as web already does.
7. **Haptics.** `lib/device/haptics.ts` calls `triggerHaptics`. A `haptics.web.ts` keeps today's web behaviour. Landing and bomb pulses come from the Reanimated callbacks.

### C4. Integration risks, in order
1. RN 0.86 was never built by the library's CI (A1).
2. The worklets build coupling (A1).
3. Android #1230, #1231 and #1263.
4. iOS #1238.
5. The session policy change (C3 step 2).
6. Landing sync needs per-platform calibration, because native has no latency API.
7. On web, the library's context must be constructed inside the gesture. Run `npm run bundle:budget` to see whether it fits the web budget; if not, use a platform-split context factory that uses `window.AudioContext` on web.
8. The 52 `tests/native/*.test.tsx` files that mock expo-audio or expo-haptics must be migrated. Centralize the mocks in `tests/native/setup.ts` [V count].

### C5. Verification
- **Unit (`node --test`).** Run the engine against a fake context and assert the *mechanism*: `start(when)` arguments, automation calls with their exact times, and the dedupe/priority policy. Also pin that only one module imports the library.
- **Jest (`tests/native`).**
  - Use `jest.mock("react-native-audio-api", () => require("react-native-audio-api/mock"))` and a manual `triggerHaptics: jest.fn()`.
  - Assert that a `select` cue calls `start` once and triggers `selection` once.
- **Playwright (web).**
  - Keep `tests/e2e/musicLoops.spec.ts`.
  - Add a spec that uses `addInitScript` to wrap `AudioBufferSourceNode.prototype.start`. Assert one context and that a landing's `when` falls within ±10 ms of the animation end.
- **On device** (the iPhone 16 Pro, using the `components/Debug1259Probe.tsx` UI-thread frame probe):

| Metric | Baseline | Target | How to measure |
|---|---|---|---|
| UI frames > 100 ms within 500 ms of a tap | 56/91 taps (p50 165 ms, max 422 ms) | 0/91; also report frames > 34 ms | Frame probe |
| Silent-play rate | 29-50% | 0 | Debug `AnalyserNode` on the sfx bus: RMS above threshold within `[when, when + 120 ms]` for every `start`, and full played duration |
| Pile-ups | 31 in 6 min | 0 unintended | Distinct effects within 40 ms of each other per event |
| First-play onset (tap → RMS) | ~750 ms | < 50 ms [I] | Analyser on the sfx bus |
| Music switch (`playMusic` → music-bus RMS) | 2-4 s gap | Within the fade | Analyser on the music bus |
| Music deaths | 1 observed | 0 across 200 switches | Include background/foreground cycles and a Siri interruption |

  On Android, also run a 30-minute play soak and watch RSS (#1263), and check a low-end device for crackle (#1231).
