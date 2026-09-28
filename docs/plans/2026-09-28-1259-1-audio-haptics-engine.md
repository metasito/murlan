# The audio and haptics engine, and the device bench: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Seam errata (final cross-plan check; these win over the text below).**
> - The `ios-bench.yml` step takes its YAML from plan 4's text. Plan 1 lands first, so write the whole workflow in this plan's task, and plan 4 only edits it.
> - The helpers `bootFeedback`, `sounds()` and `hapticCalls()` (Task 11) are the only way later plans observe feedback. Keep their names and signatures stable.

**Goal:** Every sound and haptic in the app goes through two owned facades over two maintained libraries: react-native-audio-api for audio, react-native-turbo-haptics for haptics. Neither facade does per-event main-thread work, and the audio facade can place a play at a time. expo-audio and expo-haptics are gone. A table state change sounds one thing. A diagnostics-only bench proves the device gates, unattended.

**Architecture:**

- `lib/device/audioEngine.ts` owns one `AudioContext` for the app's life. It configures the session once and holds every effect and track decoded in memory. It exposes a synchronous facade: `play`, `ramp`, `music`, `setBusTrim`, `cut`. `lib/device/audioEngine.web.ts` is its twin over the browser's Web Audio.
- `lib/device/hapticsEngine.ts` fires `triggerHaptics` either from JS (taps) or from a UI-thread worklet (landing pulses). It has a `.web.ts` twin too.
- `lib/device/feedback.ts` is the engines' only caller. It turns game moments into one sound per state change, using a pure policy in `lib/device/moments.ts`.
- Diagnostics are compiled in only under `EXPO_PUBLIC_DIAGNOSTICS=1`. They live in:
  - `lib/diagnostics/`;
  - `components/BenchScreen.tsx` and `app/bench.tsx`;
  - the local native module `modules/murlan-diagnostics`, which provides host time, memory footprint, and the iOS audio-onset and accelerometer capture.

**Tech Stack:**

- Expo SDK 57.0.25, React Native 0.86.3, Reanimated 4.5.5 and react-native-worklets 0.10.4.
- react-native-audio-api 0.13.6 and react-native-turbo-haptics 1.2.0, both pinned exactly.
- expo-asset 57.0.18.
- Expo Modules, in Swift (ReplayKit, CoreMotion, AVFAudio) and Kotlin.
- Web Audio.
- jest-expo 57 (the ios and android projects), `node --test`, and Playwright (CI).

**Spec:**

- `docs/plans/2026-09-28-1259-design.md`: §1 (engine), §8 (diagnostics and bench), §9 (D6, D7, D8).
- `docs/adr/0009-audio-and-haptics-libraries.md`.
- Findings #1, #2, #5, #6, #7 and #10: `docs/research/2026-09-28-lantern-review.md` § Audio and haptics, and the owner's review in issue #1259.
- The coordinator's library decision:
  - react-native-audio-api 0.13.6 and react-native-turbo-haptics 1.2.0, with every plugin default that adds a service, permission or download switched off;
  - CI release builds first, then a CI soak, before any caller migrates.

## Coverage

| Finding | Task | The test that is red today (or is new, and red until its task lands) |
| --- | --- | --- |
| #1, #10: UI stalls on fast taps (`setActive`, observers, and a new generator on main per play or haptic) | 5, 6, 9 | `tests/native/tableTapFeedback.test.tsx` (Task 9): a card press starts exactly one source and fires one `triggerHaptics`, with no session call and no new context. Red today: the press goes through expo-audio, so the library mock records nothing. Device gate G1. |
| #2, #10: silent plays (an unawaited `seekTo(0)` racing `play()`, a 750 ms cold start) | 5 | `tests/native/audioEngine.test.tsx` (Task 5): "a play after start is one source started now". Red until the engine exists. Device gates G1 (missing plays) and G2. |
| #2: pile-ups (turn + pass at +0 ms, pass + round_win at +27–36 ms, play + turn at +34–37 ms) | 7, 9 | `tests/ui-rules/mixPolicy.test.ts` (Task 7). Class guard `tests/native/oneSoundPerMoment.test.tsx` (Task 9), seen red with the batching disabled. |
| #5: missing sting (neutral is silent by design, unmount cancels the timer, the `cue` track is cold, `partitaOver` never fired) | 7, 9; D6 | `tests/native/gameOverSting.test.tsx`, rewritten in Task 9: the sting is in the engine before the table can unmount; `matchOver` gives a partita sting; a draw sounds `mancheNeutral`. Class guard `tests/native/everyMomentHasACaller.test.tsx` (Task 10): each kind rendered through the real component that raises it, with a planted red. |
| #6: bomb (a single-voice AVPlayer, three new generators on JS timers, a guessed delay) | 6, 7, 9 | `tests/native/landingHaptic.test.tsx`, carried forward in Task 9. The layers stay pinned to `KICK_JOLTS` (256 / 416 ms, exact at 255/256 and 415/416), dropped when the next card lands and when the table unmounts, now fired by `runLandingPulses` on the UI runtime. The bomb plays on the sting bus. |
| #7: music death (pause, then `deactivateSession()` under a cold player) | 5, 10 | `tests/native/audioEngine.test.tsx` (Task 5): a context that does not run after the app returns, or whose clock stands still, is rebuilt and the wanted track restarts. `tests/native/musicRoute.test.tsx` (Task 10). Device gate G5. |
| Libraries adopted with their defaults off | 2 | `tests/tooling/audioLibraries.test.ts` (Task 2), plus the build assertions in ci.yml's `android-build` and `ios-build`, which become release builds |
| One owner per layer | 5, 6, 7, 10 | `tests/tooling/audioOwners.test.ts` (TS compiler) and `no-restricted-imports` in `eslint.config.js` |
| expo-audio and expo-haptics removed; the 81 per-file mocks collapse into one | 10 | `tests/tooling/oneAudioMock.test.ts` (Task 10): red today on 81 files. Build assertions: neither module is registered in the binary. |
| Music as 48 kHz FLAC | 4 | `tests/tooling/musicAssets.test.ts` (FLAC STREAMINFO) and `tests/e2e/musicLoops.spec.ts` (FLAC section). Red until the files exist. |
| Android raw-resource clash (`menu.flac` beside `menu.webm`) | 2, 4 | FLAC lives in `assets/music/native/`, and web resolves its own `musicTracks.web.ts`. `android-build` is a JS-bundled release (Task 2), the only build that merges raw resources. |
| Unanchored `.gitignore` `ios/` and `android/` (silently ignored a module's native sources on the probe) | 3 | `tests/tooling/gitignoreNativeDirs.test.ts` (Task 3), red today |
| Diagnostics ship off | 1, 3 | `tests/tooling/diagnosticsGate.test.ts` (TS compiler). ci.yml `build` checks the mark both ways: absent in `dist`, present in `dist-diag`. |
| Soak before any caller moves | 8 | `.github/workflows/audio-soak.yml`, gated by `scripts/diagnostics-verdict.mjs … soak`, after a one-minute `smoke` whose failure says "no audio device", and by `--flinger` on the audio_flinger underrun counters (#1231). Verdict tests in `tests/tooling/diagnosticsVerdict.test.ts`. |
| Device gates G1–G6, and the pulse's own cost | 11 | Bench scenarios, run by the owner (D8), and judged on the laptop by `scripts/diagnostics-verdict.mjs` |
| #8: Debug and Release measure different things | 1 | `diagnosticsVerdict.test.ts` "a verdict stands only on a Release build…": any other build is `pass: null`, unrun. `.github/workflows/ios-bench.yml` builds the Release bench; `iosDevice.test.ts` pins `--bench` to it. |
| #1238: `NSException` from `startAndReturnError` (`AudioEngine.mm:494-495`) kills the app | 5 | `tests/tooling/audioApiPatch.test.ts`: both start sites (`:397-398`, `:494-495`) sit inside `@try`, through `patches/react-native-audio-api+0.13.6.patch`. The exception is thrown on the library's native thread, not in a JS call, so no JS `catch` can see it. |
| Late plays sound late; plays scheduled before a suspend burst out at resume | 5, 7 | `audioEngine.test.tsx`: a play more than one IO buffer late is dropped, and a background stops every voice not yet started and cancels bus ramps. `feedback.test.tsx`: `event([landing], now − 100)` starts nothing. |
| Output latency uncompensated | 5 | `modules/murlan-audio-session` (production, iOS): `outputLatency`, `ioBufferDuration`, and a 5 ms preferred IO buffer; `when()` schedules `L + IO/2` early. `audioEngine.test.tsx` pins the arithmetic; G3 checks it against the mic. |

## What the source says (verified 2026-09-28)

These were read in the extracted tarballs `react-native-audio-api-0.13.6.tgz` and `react-native-turbo-haptics-1.2.0.tgz`, in this worktree, and in the shared `node_modules`.

**react-native-audio-api 0.13.6:**

- **Config plugin** (`src/plugin/withAudioAPI.ts`). Its defaults and the settings this plan uses:

  | Option | Default | This plan |
  | --- | --- | --- |
  | `iosBackgroundMode` | `true` | `false` |
  | `androidForegroundService` | `true` (adds `com.swmansion.audioapi.system.CentralizedForegroundService`) | `false` |
  | `androidPermissions` | `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | `[]` |
  | `disableFFmpeg` | `false` | `true`: writes `ENV['DISABLE_AUDIOAPI_FFMPEG'] = '1'` into the Podfile (line 112) and `disableAudioapiFFmpeg=true` into `gradle.properties` |
  | `disableStaticExternalLibs` | `false` | `true`: writes `ENV['DISABLE_AUDIOAPI_STATIC_EXTERNAL_LIBS'] = '1'` (line 169) and `disableAudioapiStaticExternalLibs=true` |

- **With both `disable*` options on, nothing is downloaded.**
  - `scripts/download-prebuilt-binaries.sh` fetches rn-audio-libs v3.1.0 only for what is enabled.
  - Android: `jniLibs.srcDirs = []` (`android/build.gradle:143`).
  - iOS: the podspec skips its script phase (`RNAudioAPI.podspec:93`) and compiles with `-DMA_NO_LIBOPUS=1 -DMA_NO_LIBVORBIS=1`.
  - MP3 and FLAC are decoded by the bundled miniaudio. WebM, ALAC and Ogg are not decodable. That is why the music becomes FLAC before the engine exists (Task 4).
- **Native libraries:**
  - Android: `System.loadLibrary("react-native-audio-api")` (`AudioAPIModule.kt:57`) and `System.loadLibrary("turbo-haptics")`.
  - iOS pods: `RNAudioAPI` and `TurboHaptics`.
  - The library's own Android manifest declares nothing. turbo-haptics declares `android.permission.VIBRATE`.
- **Session.**
  - `AudioManager` is the default export of `src/system` and is re-exported as `AudioManager`.
  - `setAudioSessionOptions({ iosCategory, iosMode, iosOptions, iosAllowHaptics, iosNotifyOthersOnDeactivation })`. `IOSOption` includes `'mixWithOthers'`; `IOSMode` includes `'default'`.
  - `AudioSessionManager.mm` configures the session and calls `setActive:YES` only when the session is not already active, or when forced. `AudioEngine.mm startEngine` forces activation only when the engine is not already running. That happens on the context's first start and on `resume()`, never on a source's `start()` (`AudioScheduledSourceNode::start` starts the driver only when it is not yet initialised).
  - `disableSessionManagement()` turns activation into a no-op for good, and then nothing could activate the session.
  - **Decision: keep the library's session management, and never call `disableSessionManagement`.** Configure the options once, before the first context. Activation then happens once at launch and once per return to the foreground, never per play.
- **Android audio focus** is requested only through `observeAudioInterruptions`. This plan never calls it, which is D7 on Android.
- **AudioContext:**
  - `new AudioContext({ sampleRate? })` (`src/core/AudioContext.ts:11`);
  - `resume()`, `suspend()` and `close()` return promises;
  - `state` is `'running' | 'closed' | 'suspended'` (`src/types.ts:39`);
  - `currentTime`, `sampleRate`, `createGain()`, `createBufferSource()`.
- **Decoding.** The standalone export `decodeAudioData(input, sampleRate?)` (`src/core/AudioDecoder.ts`) takes a `file://` path and decodes it natively (`decodeWithFilePath`).
  - A module id in an Android release build goes through `readAndroidReleaseAssetBytesAsBase64` instead: the whole file crosses the bridge as base64.
  - So the engine decodes from expo-asset's `localUri`.
  - The buffers do not belong to a context, so they survive a rebuilt one.
- **Sources and params.**
  - `AudioBufferSourceNode`: `buffer` (set once), `loop`, `playbackRate`, `start(when, offset, duration)`, `stop(when)`, `onEnded`.
  - `AudioParam`: `value` (sets at `currentTime`), `setValueAtTime`, `linearRampToValueAtTime`, `setTargetAtTime`, `cancelScheduledValues`, `cancelAndHoldAtTime`.
  - `AudioNode`: `connect`, `disconnect`.
  - `getLatency()` on a source is time-stretch latency, not output latency.
- **Worklets coupling.** `validate-worklets-version.js` requires react-native-worklets ≥ 0.7.0, and 0.10.4 is installed.
- **Facts the review's fixes rest on:**
  - the library never sets `preferredIOBufferDuration`, so the session module's 5 ms preference stands; the engine reapplies it after every resume, because a route change may reset it;
  - `startAndReturnError` is called at two sites, `AudioEngine.mm:397-398` and `:494-495`, and throws `NSException` on the library's own thread, where no JS promise can catch it (#1238); only a native `@try` can;
  - each `AudioContext` makes its own `AudioWorkletRuntime` (`AudioContext.ts:22`), and the constructor has no option to reuse one, so a rebuild allocates one; rebuilds are rare (the watchdog), so this is accepted;
  - a source that never started is freed by `stop()` plus `buffer = null` (`AudioScheduledSourceNode.cpp:78`); a finished one by `buffer = null` and `disconnect()` (`AudioBufferSourceNode.cpp:68-70`);
  - the context's `state` has no `interrupted`: iOS interruptions reach JS only through `observeAudioInterruptions`, which on Android also requests audio focus against D7. The design's `AudioState` line is corrected to `"running" | "suspended" | "failed"` (Design questions).

**react-native-turbo-haptics 1.2.0:**

- It exports `triggerHaptics(type)` and `type HapticType` (`src/index.ts`). The types are `impactHeavy`, `impactLight`, `impactMedium`, `notificationError`, `notificationSuccess`, `notificationWarning`, `rigid`, `selection` and `soft`.
- `triggerHaptics` is a JSI host function. react-native-worklets 0.10.4 serialises a host function onto the UI runtime directly, so a worklet can call it.
- **iOS:**
  - generators are cached, and each trigger fires and then calls `prepare`;
  - a trigger runs on main, directly if already there, otherwise through `dispatch_async`;
  - the generators are cleared on WillResignActive and DidEnterBackground, and there is no prepare API. So the first haptic after a return allocates one generator. This plan accepts that and lets gate G4 judge it.
  - The library builds generators with `UIImpactFeedbackGenerator(style:)`, which is deprecated in iOS 17.5 in favour of `init(style:view:)`. It still works, and is listed under Design questions.
- **Android:** `performHapticFeedback` or a `VibrationEffect` composition, on the UI thread, and only while the activity is RESUMED.
- It ships no jest mock and no web implementation, so this plan writes both.

**Worklets and Reanimated:**

- The UI runtime has a `setTimeout`.
- Under jest the worklets web build is used: `scheduleOnUI` runs through a `requestAnimationFrame` stand-in that is `setTimeout(cb, 0)`. So fake timers stay exact.
- `makeMutable` works in jest.

**The app today:**

- The sounds:
  - `lib/device/sounds.ts` holds the 19-key asset map (242–262), gain and pitch jitter of ±8 % and ±4 % (282–296), and the per-effect gains (316–336). Deselect is select at 0.75 gain and 0.9 rate.
  - `reconnected` has never had a caller.
- `lib/device/cues.ts:54-58`: `BOMB_PULSES` is rigid at 0, heavy at 256 and light at 416 ms, and `PARTITA_LEAD_MS` is −300. A landing is light for a single card and medium for any combo (cards > 1), for the viewer only.
- `components/useTableFeedback.ts`:
  - `KICK_JOLTS` (55–63);
  - `landsAtRef` on `Date.now()` (369–372);
  - the turn reveal (382–391) and the turn cue timer (393–402);
  - exchange (404–407) and pass (416–423);
  - the sting on a `setTimeout` (425–462), with `cancelMusicDuck` on unmount (467);
  - `playImpact` (529–539).
- `components/table/pile.tsx`:
  - `openNewRound` calls `playRoundStart` (767);
  - the impact timer calls `playImpact` (851–866);
  - the `roundWinnerTag` effect calls `playRoundWin` (927–933). The file's own comment says "A round closes on a pass, never on a play".
- `components/GameTable.tsx`:
  - the imports (105–107) and `useTableFeedback` (674–692);
  - `usePileFlight` passes `playRoundStart` and `playRoundWin` (727–747);
  - the deal effect with `holdSounds` and `preloadSounds` (752–771);
  - `handleCardPress` (816–828), `handlePlay`, `handleExchangeGive`, and `handlePass` (`hapticLight`).
- The screens pass `matchOver={match.over}` (`app/game.tsx:174`) and `matchOver={matchState.over}` (`app/(online)/game.tsx:299`). Both verdicts carry `.winners` (`lib/game/matchState.ts:9-15`).
- `lib/game/matchState.ts`:
  - `celebratesViewer(players, candidates, viewerId, isTeamMode)` (73);
  - `handOutcomeFor(…)` returns `"pending"` only in team mode with scores missing (139).
- `context/SettingsContext.tsx:134-152` drives the masters from separate effects, and `CONTEXT.md:39-45` explains why.
- The music:
  - `lib/device/musicTracks.ts` is WebM with `CONTAINER = "webm"`;
  - `musicTracks.ios.ts` is ALAC M4A;
  - the `.m4a` files are ALAC `s16p`, 48000 Hz, 2 channels, 27.408562 s (1,315,611 samples), re-encoded losslessly from the WebM (`assets/music/README.md`). ffmpeg 9.0 is installed on this machine.
- The repo:
  - `.gitignore:30-31` are the unanchored `ios/` and `android/`;
  - `tools/ci/nativeScope.mjs` `CONFIG` is `app.json`, `app.config.*` and `eas.json`;
  - ci.yml `android-build` (495–521) is `assembleDebug`, and `ios-build` (523–563) is a Debug simulator build.
- The tests:
  - 81 test files `jest.mock` expo-audio, expo-haptics or one of the old device modules;
  - no source scan uses the TS compiler for imports yet (`tests/ui-rules/layering.test.ts` uses a regex);
  - `layering.test.ts` forbids `lib/` from importing `components/`, which is why the bench screen lives in `components/`.
- The probe:
  - `research/1259-probe` (commit `21ad74f4`, never merged) built both libraries in release for an API 34 x86_64 emulator and for the iOS simulator;
  - it picked the installed NDK of React Native's major, and it needed `usesCleartextTraffic` to post to `10.0.2.2:5099`.
- `scripts/ios-device.mjs` serves production JS (`--no-dev --minify`) to a dev build built from `--ref <branch>`, and starts Metro in `serve(home)` (303–337).

## Global Constraints

- **Owners (ADR-0009).** Each layer has exactly one importer:
  - `react-native-audio-api` → `lib/device/audioEngine.ts`;
  - `react-native-turbo-haptics` → `lib/device/hapticsEngine.ts`;
  - `lib/device/audioEngine` and `lib/device/hapticsEngine` → `lib/device/feedback.ts`;
  - `modules/murlan-audio-session` → `lib/device/audioEngine.ts`;
  - `modules/murlan-diagnostics` → `lib/diagnostics/probe.ts`.

  After Task 10, nothing imports expo-audio or expo-haptics. `tests/tooling/audioOwners.test.ts` and `eslint.config.js` enforce this.
- **The facade (design §1).** Its signatures are verbatim, and `at` is a `performance.now()` time in ms, absent meaning now. Nothing returns a promise after `startAudio()`. No JS path seeks, pauses, activates or deactivates the session per play. No library call is made from a worklet except `triggerHaptics`.
- **Plays are dropped, never queued,** while the context is not running, and when more than one IO buffer late (10 ms where the session reports none). A given `at` is passed through as given; only an absent `at` means now.
- **Versions:**
  - `react-native-audio-api` `0.13.6` and `react-native-turbo-haptics` `1.2.0`, both exact (no `^`, no `~`);
  - miniaudio is the one inside react-native-audio-api;
  - iOS deployment 16.4 and Swift 5.9 for `modules/murlan-diagnostics` and `modules/murlan-audio-session`;
  - Android minSdk and compileSdk from the app.
- **D7: mix with other apps.** iOS uses `iosCategory: "playback"`, `iosOptions: ["mixWithOthers"]`, never `duckOthers`. Android makes no audio-focus request.
- **Diagnostics ship off.**
  - Every edge into diagnostics-only code is a `require` behind the literal `process.env.EXPO_PUBLIC_DIAGNOSTICS === "1"`.
  - `modules/murlan-diagnostics` is compiled into every binary but is reachable only from a diagnostics bundle.
  - The cleartext and microphone plugin acts only when `EXPO_PUBLIC_DIAGNOSTICS=1` at prebuild.
  - The web `dist`, the release APK's bundle and the Release `.app`'s `main.jsbundle` each carry no diagnostics mark (Tasks 1 and 2).
- **Device verdicts come only from Release** with an embedded bundle (Task 1); any other build's verdict is `pass: null`.
- **Downloads need the owner's yes, in chat, first** (the brief; the user-level rules). Before each download, the executor states what, from where and how large, and waits for a clear yes. That covers:
  - `npm install` of the two libraries (Task 2);
  - the Kenney clip for `manche_neutral` (Task 7);
  - a Playwright Chromium install, if `scripts/build-sounds.mjs` finds none.

  CI's own downloads (npm ci, Maestro, the emulator image) are CI's.
- **Local verification** is rules 1–4:
  - `npx tsc --noEmit -p .`;
  - `npx eslint <files>`;
  - `node --test <one file>`.

  Never run jest or Playwright locally. They, `npm run check:comments` and the native builds run on CI: push, then read the run.
- **Comment budget** (`CLAUDE.md` § Comments). The branch adds no more than six comment lines (three in a test), unless it adds more code lines. The code below carries about twenty comment lines in all (counted in the self-review), each one of the four allowed reasons, against several thousand code lines. The policy applies to Swift, Kotlin and YAML too.
- **Files** change through Edit and Write (rule 44).
  - Stage by pathspec (`git add -- <files>`, rule 11); other agents share the index.
  - Update the docs a change makes stale in the same task (rule 43).
  - Name a model for any agent dispatched (rule 29).
  - Never merge `research/1259-probe`.

## Review Focus

1. **A second music switch while a crossfade is still running** (route flicking: result → menu → game within 600 ms).
   - Expected: no click and no dead music.
   - The running deck is held where it is (`cancelAndHoldAtTime`) and faded from there.
   - A retired deck's gain is disconnected at the next switch after its fade ends, so no GainNode accumulates.
   - Task 5: "a second switch mid-fade holds the first fade where it is".
2. **The app backgrounded with plays in flight, and JS running before the context runs again.**
   - Expected: nothing blurts on return. A play is dropped while the context is not running.
   - On `active`, the context is resumed. A context that is not running 500 ms later, or whose clock has not advanced 250 ms, is closed and rebuilt, and the wanted track restarts.
   - Task 5: the two watchdog tests and "a play while the context is not running is dropped, not queued".
3. **Sound volume 0, or haptics off.**
   - Expected: no source is created, no `triggerHaptics` fires, and there is no trace onset.
   - Task 7: `feedback.test.tsx` "sound volume 0 and haptics off leave nothing behind an event".
4. **A tap while another card lands.**
   - Expected: the tap still sounds. Input moments are never masked by the cross-event ledger.
   - Task 7: `mixPolicy.test.ts` "a select 30 ms after a landing still sounds".
5. **The engine never starts** (a decode failure, a refused resume), or a play precedes `startAudio()`.
   - Expected: `play()` is a silent no-op, nothing throws into the game, and `audioState()` is `"failed"`.
   - Task 5: "a failed start leaves play harmless".

## CLAUDE.md invariants these tasks touch

- **Every hook runs before `if (!gameState)`.**
  - The only new hook is `useBenchHandle` (Task 1). It goes into `components/GameTable.tsx` directly after `handleCardPress`, at the top level of `GameTable`, which has no early return before it.
  - The two game screens gain props (`matchWinners`), not hooks.
- **One module chooses a bot's move: `lib/game/autoMove.ts`.** `tests/native/helpers/botManche.ts` (Task 9) and the bench's `driveBots` advance bots only through `offlineBotMove` and `resolveStuckExchange`.
- **Game rules.** No task touches `lib/game/gameEngine.ts`.
- **No self-defeating safeguards.** Each check below has a floor that is named in its step:
  - every source scan has planted sources that must be flagged;
  - every absence check in CI is preceded by a presence check on the same file;
  - `! grep` is never used under `set -e`, because bash does not exit on it. Absence is checked with `if grep …; then exit 1; fi`.
  - the verdicts fail on too few rows, and report `pass: null` rather than `true` for a build they cannot judge;
  - the class guards are seen red: `oneSoundPerMoment` with the batching disabled, `everyMomentHasACaller` with one caller deleted.
- **No unit test can see a layout bug.** The bench screen is diagnostics-only. No player-facing layout changes.
- **`components/CLAUDE.md`: impact feedback is timed to the card landing through `impactDelayMs()`.** This stands until plan 2: the landing still fires from pile's impact timer.

## Hand-over to plan 2 (one clock)

- **At the throw (JS):**
  - plan 2 calls `event([{ kind: "landing", cards, bomb, mine }], landsAt)`, where `landsAt` is the contact time on `performance.now()`;
  - it computes `const steps = landingPulsesFor({ cards, bomb, mine })` and passes `steps` into the flight worklet.
- **At the contact frame (UI thread):** plan 2 calls `runLandingPulses(steps)`, imported from `@/lib/device/feedback`.
  - It takes no `at`.
  - It fires step 0 now and the others after their `offsetMs` on the UI runtime's `setTimeout`.
  - Any later call, even with `[]`, cancels the pending layers.
- **The rest of the export.** `landingPulse(strength)` fires one pulse from a worklet. `LANDING_PULSES` is the plain data: `play`: light@0; `combo`: medium@0; `bomb`: rigid@0, heavy@256, light@416.
- **The landing cue carries no haptic,** so `event()` never pulses a landing; the pulses belong to `runLandingPulses` (plan 2's `landingCueHasNoHaptic` pins this). A batch holding a landing that pulses (`landingPulsesFor(m)` non-empty) fires none of its other taps, so a coincident turn tap stays silent. Plan 2 must not call `triggerHaptics`: the owners test and the lint rule forbid it.
- **Until plan 2 lands,** pile's impact timer calls `playImpact`, which calls `event([landing])` and `startLandingPulses(landing)` (that is, `scheduleOnUI(runLandingPulses, steps)`). Plan 2 deletes that path.

## Decisions

- **D6: a drawn manche sounds its own soft sting, `manche_neutral.mp3`,** with no haptic. It is built by `scripts/build-sounds.mjs` from two `glass_002` notes a major second apart, at peak 0.25, under both verdict stings.
  - *Other answer:* neutral stays silent. `MOMENTS.mancheOver` returns `sound: null` for neutral, and no asset is built (19 files becomes 18 after Task 10).
- **D7: mix with other apps.** iOS uses `playback` with `mixWithOthers`. Android makes no focus request.
  - *Other answer:* duck other apps. `iosOptions: ["duckOthers"]`, and `AudioManager.observeAudioInterruptions(true)` requests focus on Android.
- **D8: the owner runs the bench when asked** (Task 11 has the procedure).
  - *Other answer:* gates G1–G5 go unmeasured on a device. Only the CI soak (Task 8) gates the PR, and the PR body lists G1–G5 as "not run".

## Task order, and why the soak moves after the engine

1. Diagnostics JS, the bench and the collector.
2. The libraries, pinned, with release builds on CI that assert their defaults are off. This is the coordinator's step (a).
3. `modules/murlan-diagnostics`, the anchored `.gitignore`, and native scope.
4. FLAC music. The library cannot decode WebM or ALAC with FFmpeg off, so this must precede the engine.
5. `audioEngine.ts`, its web twin, and one recording mock.
6. `hapticsEngine.ts` and its web twin.
7. `moments.ts`, `feedback.ts`, and the D6 asset.
8. The CI soak. This is step (b), placed before any caller migrates.
9. The table's callers move to `event()`, with the class guards.
10. Removal of the old path, one mock, and the remaining callers.
11. Device gates G1–G6.

The coordinator ordered (b) the soak before (c) the engine. Here the soak runs over the real engine and `feedback.event`, because a soak of the bare library would measure a graph this app never builds: per-play voice gains, three buses, looped decks, the watchdog. It still runs before any caller moves, which is what the order protects. All eleven tasks are one branch and one PR. Task 8's soak must be green on the branch before Task 9 starts.

---

### Task 1: Diagnostics that ship off, the bench route, and the collector

**Files:**
- Create:
  - `tests/helpers/moduleEdges.ts`;
  - `lib/diagnostics/types.ts`, `index.ts`, `recorder.ts`, `bench.ts`, `benchTable.ts`, `build.ts`, `jsLag.ts`, `FrameProbe.tsx`, `scenarios/index.ts` and `scenarios/idle.ts`;
  - `components/BenchScreen.tsx` and `app/bench.tsx`;
  - `scripts/diagnostics-collector.mjs` and `scripts/diagnostics-verdict.mjs`;
  - `.github/workflows/ios-bench.yml` (moved here from plan 4's Task 2).
- Modify:
  - `app/_layout.tsx` (a second `Stack.Protected`) and `app/+native-intent.tsx`;
  - `components/GameTable.tsx` (one hook);
  - `scripts/e2eBuildMark.mjs` and `scripts/ios-device.mjs` (`serve`, `main`);
  - `.github/workflows/ci.yml` (`build` job), `.gitignore` and `docs/agents/checks.md`.
- Test: `tests/tooling/diagnosticsGate.test.ts`, `tests/tooling/diagnosticsVerdict.test.ts`, `tests/tooling/e2eBuildMark.test.ts` and `tests/tooling/iosDevice.test.ts`.

**Interfaces:**
- Produces:
  - from `@/lib/diagnostics`: `DIAGNOSTICS`, `diag(row)`, `jsFromWall()`, `benchHandles`, `useBenchHandle("cardPress", fn)`, `type DiagRow` and `type DiagRows` (the one place later plans add row kinds);
  - from `@/lib/diagnostics/bench`: `registerBenchScenario(name, run)`, `benchScenarios()` and `type BenchContext`;
  - from `@/lib/diagnostics/benchTable`: `benchTable()`, `botTable()` and `driveBots(ctx, state, stepMs, onStep?)`, the all-bot driver plan 2's `landingSync` scenario uses;
  - `recorder.push`, `recorder.postTo`;
  - `benchBuild()` (`lib/diagnostics/build.ts`) and `startJsLag(): () => void` (`lib/diagnostics/jsLag.ts`), which `BenchContext.frames(on)` toggles with the UI `FrameProbe`;
  - `moduleEdges(file, text): Edge[]` with `Edge.gated`, and `resolveSpec`;
  - `createCollector(file)`, `verdict(rows, scenario)`, `GATES`, `metroEnv(env, ip, diagnostics)`, `artifactFor(bench)` and `benchUrl(ip)`.
- **The `GATES` entry signature** that plans 2–4 bind to: `(rows: Row[]) => { pass: boolean; metrics: Record<string, unknown> }`, where `rows` is the scenario's bracket in the newest session, every row carrying `t`. `verdict()` alone turns a pass into `null` (unrun) on a non-Release build, and into `false` on an error or dropped rows; a gate never reads the build.
- **Release only.** A verdict stands only on a Release binary with an embedded bundle, read from the session's `{ k: "build", t, dev, scriptURL }` row. Anything else keeps its metrics and reports `pass: null` with `metrics.unrun`, and the CLI exits 1. `npm run ios:device -- --bench` installs the Release bench build from `.github/workflows/ios-bench.yml` (artifact `murlan-ios-bench`); `--diagnostics` stays for iterating on a scenario, and its verdicts are unrun.

- [ ] **Step 1: The TS-compiler edge reader**

`tests/helpers/moduleEdges.ts`:

```ts
import path from "node:path";
import ts from "typescript";

export interface Edge {
  from: string;
  to: string;
  via: "import" | "require" | "mock";
  gated: boolean;
}

export function resolveSpec(file: string, spec: string): string {
  const bare = spec.startsWith("@/")
    ? spec.slice(2)
    : spec.startsWith(".")
      ? path.posix.join(path.posix.dirname(file), spec)
      : spec;
  return bare.replace(/\.(tsx?|mjs|js)$/, "").replace(/\/index$/, "");
}

const typeOnly = (clause: ts.ImportClause | undefined): boolean =>
  !!clause &&
  (clause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
    (!clause.name &&
      !!clause.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every((e) => e.isTypeOnly)));

function isDiagnosticsGate(node: ts.Expression, source: ts.SourceFile): boolean {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    node.left.getText(source) === "process.env.EXPO_PUBLIC_DIAGNOSTICS" &&
    ts.isStringLiteral(node.right) &&
    node.right.text === "1"
  );
}

export function moduleEdges(file: string, text: string): Edge[] {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out: Edge[] = [];
  const add = (spec: string, via: Edge["via"], gated: boolean) =>
    out.push({ from: file, to: resolveSpec(file, spec), via, gated });
  const visit = (node: ts.Node, gated: boolean): void => {
    if (ts.isImportDeclaration(node) && !typeOnly(node.importClause) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, "import", false);
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, "import", false);
    }
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      const spec = node.arguments[0].text;
      const callee = node.expression.getText(source);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(spec, "import", gated);
      else if (callee === "require" || callee === "jest.requireActual") add(spec, "require", gated);
      else if (/^jest\.(mock|doMock|setMock|unstable_mockModule)$/.test(callee)) add(spec, "mock", gated);
    }
    if (ts.isConditionalExpression(node) && isDiagnosticsGate(node.condition, source)) {
      visit(node.condition, gated);
      visit(node.whenTrue, true);
      visit(node.whenFalse, gated);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, gated));
  };
  visit(source, false);
  return out;
}
```

`phaseModifier` is TypeScript 6.0.3's replacement for the deprecated `ImportClause.isTypeOnly` (`typescript.d.ts:5533-5535`).

- [ ] **Step 2: Write the failing tests**

`tests/tooling/diagnosticsGate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { moduleEdges } from "../helpers/moduleEdges.ts";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIRS = ["app", "components", "context", "lib", "modules"].filter((d) => existsSync(path.join(repoRoot, d)));

const idOf = (file: string) => file.replace(/\.(tsx?|mjs|js)$/, "").replace(/\/index$/, "");
const diagnosticsOnly = (id: string) =>
  id.startsWith("lib/diagnostics/") || id === "components/BenchScreen" || id.startsWith("modules/murlan-diagnostics");

function ungated(sources: [string, string][]): string[] {
  return sources.flatMap(([file, text]) =>
    diagnosticsOnly(idOf(file))
      ? []
      : moduleEdges(file, text)
          .filter((e) => e.via !== "mock" && diagnosticsOnly(e.to) && !(e.via === "require" && e.gated))
          .map((e) => `${e.from} -> ${e.to}`)
  );
}

test("the scan flags an ungated require and a static import, and passes a gated require", () => {
  assert.deepEqual(
    ungated([
      ["app/a.tsx", 'const X = require("@/lib/diagnostics/recorder");'],
      ["app/b.tsx", 'import { probe } from "@/lib/diagnostics/probe";'],
      ["app/c.tsx", 'const X = process.env.EXPO_PUBLIC_DIAGNOSTICS === "1" ? require("@/components/BenchScreen") : null;'],
      ["app/d.tsx", 'const X = process.env.EXPO_PUBLIC_DIAGNOSTICS === "0" ? require("@/components/BenchScreen") : null;'],
      ["lib/diagnostics/recorder.ts", 'import { probe } from "./probe";'],
    ]),
    ["app/a.tsx -> lib/diagnostics/recorder", "app/b.tsx -> lib/diagnostics/probe", "app/d.tsx -> components/BenchScreen"]
  );
});

test("nothing a production bundle reaches imports diagnostics code except behind the literal gate", () => {
  const sources = sourcesUnder(repoRoot, DIRS);
  assert.ok(sources.length > 100, `read ${sources.length} sources — the scan is not reading the tree`);
  assert.deepEqual(ungated(sources), []);
});

test("the gate is exercised, not merely unviolated", () => {
  const gated = sourcesUnder(repoRoot, DIRS)
    .flatMap(([file, text]) => moduleEdges(file, text))
    .filter((e) => e.via === "require" && e.gated)
    .map((e) => `${e.from} -> ${e.to}`)
    .sort();
  assert.deepEqual(gated, ["app/bench.tsx -> components/BenchScreen", "lib/diagnostics/index.ts -> lib/diagnostics/recorder"]);
});
```

`tests/tooling/diagnosticsVerdict.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createCollector } from "../../scripts/diagnostics-collector.mjs";
import { verdict } from "../../scripts/diagnostics-verdict.mjs";

const RELEASE = { k: "build", t: 0, dev: false, scriptURL: "file:///var/containers/Bundle/Application/X/murlan.app/main.jsbundle" };

const bracket = (session: string, name: string, inner: object[], error: string | null = null, build: object | null = RELEASE) => [
  ...(build ? [{ session, ...build }] : []),
  { session, k: "scenario", t: 0, name, phase: "start" },
  ...inner.map((r) => ({ session, ...r })),
  { session, k: "scenario", t: 5000, name, phase: "end", error },
];

test("the collector appends a batch line and every posted row as NDJSON", async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "murlan-collector-")), "run.ndjson");
  const server = createCollector(file).listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  const body = JSON.stringify({ session: "s1", seq: 0, dropped: 2, rows: [{ k: "frame", t: 1, dt: 16 }] });
  const res = await fetch(`http://127.0.0.1:${port}/log`, { method: "POST", body });
  server.close();
  assert.equal(res.status, 200);
  const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [
    { session: "s1", seq: 0, k: "batch", n: 1, dropped: 2 },
    { session: "s1", seq: 0, k: "frame", t: 1, dt: 16 },
  ]);
});

test("a verdict reads its own scenario's bracket in the newest session only", () => {
  const rows = [...bracket("old", "idle", [{ k: "frame", t: 1, dt: 16 }]), ...bracket("new", "idle", [])];
  assert.deepEqual(verdict(rows, "idle"), { pass: false, metrics: { frames: 0 } });
});

test("no bracket, an unfinished bracket, or an unknown scenario is no verdict", () => {
  assert.equal(verdict([], "idle"), null);
  assert.equal(verdict(bracket("s", "idle", []).slice(0, 2), "idle"), null);
  assert.equal(verdict(bracket("s", "nope", []), "nope"), null);
});

test("a scenario that threw, or rows the phone dropped, fail whatever the gate said", () => {
  const frame = { k: "frame", t: 1, dt: 16 };
  assert.equal(verdict(bracket("s", "idle", [frame]), "idle")?.pass, true);
  assert.equal(verdict(bracket("s", "idle", [frame], "Error: boom"), "idle")?.pass, false);
  const dropped = [{ session: "s", k: "batch", n: 1, dropped: 3 }, ...bracket("s", "idle", [frame])];
  assert.deepEqual(verdict(dropped, "idle"), { pass: false, metrics: { frames: 1, dropped: 3 } });
});

test("a verdict stands only on a Release build with an embedded bundle; anything else is unrun, with its metrics", () => {
  const on = (build: object | null) => verdict(bracket("s", "idle", [{ k: "frame", t: 1, dt: 16 }], null, build), "idle");
  assert.deepEqual(on(RELEASE), { pass: true, metrics: { frames: 1 } });
  assert.equal(on({ ...RELEASE, scriptURL: "assets://index.android.bundle" })?.pass, true);
  for (const build of [null, { ...RELEASE, dev: true }, { ...RELEASE, scriptURL: "http://192.168.1.5:8081/index.bundle?platform=ios" }, { ...RELEASE, scriptURL: null }]) {
    const v = on(build);
    assert.equal(v?.pass, null);
    assert.equal(v?.metrics.frames, 1);
    assert.equal(typeof v?.metrics.unrun, "string");
  }
});
```

Append to `tests/tooling/e2eBuildMark.test.ts`, and add `assertMark` to its import if it is not already there:

```ts
import { DIAGNOSTICS_MARK } from "../../scripts/e2eBuildMark.mjs";

test("the diagnostics mark is judged like the e2e one", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "murlan-diag-"));
  writeFileSync(path.join(dir, "a.js"), `x="${DIAGNOSTICS_MARK}"`);
  assert.throws(() => assertMark("--absent", [dir], DIAGNOSTICS_MARK), /a\.js/);
  assert.doesNotThrow(() => assertMark("--present", [dir], DIAGNOSTICS_MARK));
  assert.doesNotThrow(() => assertMark("--absent", [dir]));
});
```

Append to `tests/tooling/iosDevice.test.ts`, and add `metroEnv` to its import:

```ts
test("--diagnostics turns the diagnostics build on for Metro, and only then", () => {
  const on = metroEnv({ PATH: "p" }, "192.168.1.5", true);
  assert.equal(on.EXPO_PUBLIC_DIAGNOSTICS, "1");
  assert.equal(on.EXPO_PUBLIC_DOMAIN, "http://192.168.1.5:5000");
  assert.equal(on.REACT_NATIVE_PACKAGER_HOSTNAME, "192.168.1.5");
  assert.equal(metroEnv({ PATH: "p" }, "192.168.1.5", false).EXPO_PUBLIC_DIAGNOSTICS, undefined);
});

test("--bench fetches the Release bench build, never the dev client", () => {
  assert.deepEqual(artifactFor(true), { workflow: "ios-bench.yml", name: "murlan-ios-bench", ipa: "murlan-bench.ipa" });
  assert.deepEqual(artifactFor(false), { workflow: "ios-device.yml", name: "murlan-ios-dev", ipa: "murlan-dev.ipa" });
  assert.equal(benchUrl("192.168.1.5"), "murlan://bench?host=192.168.1.5&scenario=all");
});
```

Add `artifactFor` and `benchUrl` to that import too.

- [ ] **Step 3: Run them and watch them fail**

Run each on its own:

- `node --test tests/tooling/diagnosticsGate.test.ts`. Expected: the planted test passes, the tree test passes vacuously, and "the gate is exercised" FAILS with `[] !== [...]`.
- `node --test tests/tooling/diagnosticsVerdict.test.ts`. Expected: FAIL, the scripts do not exist.
- `node --test tests/tooling/e2eBuildMark.test.ts` and `node --test tests/tooling/iosDevice.test.ts`. Expected: FAIL, missing exports.

- [ ] **Step 4: The build mark takes a mark**

In `scripts/e2eBuildMark.mjs`, replace the body below the imports with:

```js
export const E2E_BUILD_MARK = "murlan-e2e-build";
export const DIAGNOSTICS_MARK = "murlan-diagnostics-recorder";
const MARKS = { e2e: E2E_BUILD_MARK, diagnostics: DIAGNOSTICS_MARK };

export function filesCarryingMark(dir, mark = E2E_BUILD_MARK) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && fs.readFileSync(path.join(e.parentPath, e.name)).includes(mark))
    .map((e) => path.join(e.parentPath, e.name));
}

export function assertMark(mode, dirs, mark = E2E_BUILD_MARK) {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) throw new Error(`${dir} does not exist — nothing was built there`);
    const found = filesCarryingMark(dir, mark);
    if (mode === "--absent" && found.length > 0) {
      throw new Error(`${dir} carries ${mark}, which only a flagged build may:\n  ${found.join("\n  ")}`);
    }
    if (mode === "--present" && found.length === 0) {
      throw new Error(`${dir} carries no ${mark} — the mark no longer survives a flagged build`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--mark");
  const mark = at === -1 ? E2E_BUILD_MARK : MARKS[args[at + 1]];
  const [mode, ...dirs] = at === -1 ? args : args.slice(0, at);
  if (!mark || !["--absent", "--present"].includes(mode) || dirs.length === 0) {
    console.error("usage: e2eBuildMark.mjs --absent|--present <dir>... [--mark e2e|diagnostics]");
    process.exit(2);
  }
  try {
    assertMark(mode, dirs, mark);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
```

In the file's header comment, change one usage line to `node scripts/e2eBuildMark.mjs --absent|--present <dir>... [--mark e2e|diagnostics]`. That edits a line; it adds none.

- [ ] **Step 5: The diagnostics module**

`lib/diagnostics/types.ts`. **One timebase.** Every row's `t` is in the JS thread's `performance.now()` ms, the clock `event(…, at)` and `play({ at })` take. A row stamped on another clock is converted when it reaches JS, from an offset sampled back to back with `performance.now()`:

- UI-thread stamps (`Date.now()` in a worklet: `frame`, the `hapticOnset` pulse stamps) use `t = wall + (performance.now() − Date.now())`, sampled at the flush;
- native rows (`onset`, `level`, `shake`, on the host clock that `hostNowMs()` reads: ReplayKit's sample-buffer PTS and CoreMotion's timestamp) use `t = host + (performance.now() − hostNowMs())`, sampled at each drain (Task 3, `probe.drain`).

The verdict script therefore compares `t` values directly and converts nothing.

**One place to extend.** Plans 3 and 4 add their kinds (`ring`, `anchors`, `lampLegibility`) as keys of `DiagRows`, and nowhere else. The mapped type gives every kind, present and added, a required `t` on this timebase; an added kind declares no clock field of its own (`at` is a scheduled time, not the row's stamp):

```ts
export interface DiagRows {
  scenario: { name: string; phase: "start" | "end"; error?: string | null };
  build: { dev: boolean; scriptURL: string | null };
  arm: { name: "on" | "off"; phase: "start" | "end" };
  latency: { outputMs: number | null; ioMs: number | null; inputMs: number | null };
  trigger: { name: string };
  play: { id: string; at: number; bus: string; dropped: boolean; lead: number };
  haptic: { kind: string; at: number };
  music: { track: string | null; at: number };
  engine: { state: string; audioMs: number; plays: number };
  frame: { dt: number };
  jsLag: { dt: number };
  jsTicks: { n: number };
  pulseCost: { ms: number; cold: boolean };
  footprint: { mb: number };
  onset: { db: number; source: "app" | "mic" };
  level: { db: number };
  shake: { g: number };
}

export type DiagRow = { [K in keyof DiagRows]: { k: K; t: number } & DiagRows[K] }[keyof DiagRows];
```

`lib/diagnostics/index.ts`:

```ts
import { useEffect } from "react";
import type { DiagRow } from "./types";

export type { DiagRow } from "./types";

export const DIAGNOSTICS = process.env.EXPO_PUBLIC_DIAGNOSTICS === "1";

const recorder: { push(row: DiagRow): void } | null =
  process.env.EXPO_PUBLIC_DIAGNOSTICS === "1" ? require("./recorder").recorder : null;

export function diag(row: DiagRow): void {
  recorder?.push(row);
}

export function jsFromWall(): (wall: number) => number {
  const offset = performance.now() - Date.now();
  return (wall) => wall + offset;
}

export const benchHandles: { cardPress?: (id: string) => void } = {};

export function useBenchHandle(name: "cardPress", fn: (id: string) => void): void {
  useEffect(() => {
    if (!DIAGNOSTICS) return;
    benchHandles[name] = fn;
    return () => {
      if (benchHandles[name] === fn) delete benchHandles[name];
    };
  }, [name, fn]);
}
```

`lib/diagnostics/recorder.ts` keeps nothing but a capped outbox, so the bench's own rows cannot grow the footprint the soak measures:

```ts
import type { DiagRow } from "./types";

const MARK = "murlan-diagnostics-recorder";
const CAP = 5000;
const session = Date.now().toString(36);
let outbox: DiagRow[] = [];
let dropped = 0;
let seq = 0;
let target: string | null = null;

export const recorder = {
  push(row: DiagRow): void {
    if (outbox.length >= CAP) {
      outbox.shift();
      dropped++;
    }
    outbox.push(row);
  },
  postTo(host: string): void {
    target = `http://${host}:5099/log`;
    outbox = [];
    dropped = 0;
  },
};

setInterval(() => {
  if (!target || (outbox.length === 0 && dropped === 0)) return;
  const body = JSON.stringify({ session, seq: seq++, rows: outbox, dropped, build: MARK });
  outbox = [];
  dropped = 0;
  fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body }).catch(() => {});
}, 1000);
```

`lib/diagnostics/bench.ts`:

```ts
import type { GameState } from "@/lib/game/gameEngine";

export interface BenchContext {
  params: Record<string, string | undefined>;
  showTable(state: GameState | null): Promise<void>;
  sleep(ms: number): Promise<void>;
  frames(on: boolean): void;
}

type Scenario = (ctx: BenchContext) => Promise<void>;
const scenarios = new Map<string, Scenario>();

export function registerBenchScenario(name: string, run: Scenario): void {
  scenarios.set(name, run);
}

export function benchScenarios(): [string, Scenario][] {
  return [...scenarios.entries()];
}
```

`lib/diagnostics/benchTable.ts`. `driveBots` is the bench's game driver: every seat a bot, moves chosen only by `lib/game/autoMove.ts` (the CLAUDE.md invariant). Plan 2's `landingSync` scenario uses it:

```ts
import { initializeGame, type GameState } from "@/lib/game/gameEngine";
import { offlineBotMove, resolveStuckExchange } from "@/lib/game/autoMove";
import type { BenchContext } from "./bench";

export function benchTable(): GameState {
  return initializeGame(
    [
      { name: "You", type: "human" },
      { name: "A", type: "ai" },
      { name: "B", type: "ai" },
      { name: "C", type: "ai" },
    ],
    "free_for_all"
  );
}

export function botTable(): GameState {
  return initializeGame(["A", "B", "C", "D"].map((name) => ({ name, type: "ai" as const })), "free_for_all");
}

export async function driveBots(ctx: BenchContext, state: GameState, stepMs: number, onStep?: (s: GameState) => void): Promise<GameState> {
  await ctx.showTable(state);
  while (!state.gameOver) {
    const next = offlineBotMove(state) ?? (state.exchangePhase?.active ? resolveStuckExchange(state) : null);
    if (!next) break;
    state = next;
    onStep?.(state);
    await ctx.showTable(state);
    await ctx.sleep(stepMs);
  }
  return state;
}
```

`lib/diagnostics/FrameProbe.tsx`. The UI thread stamps wall time, the one clock both threads share, and the flush converts it (`jsFromWall`):

```tsx
import { useEffect } from "react";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";
import { diag, jsFromWall } from "./index";

export function FrameProbe({ on }: { on: boolean }) {
  const samples = useSharedValue<number[]>([]);
  useFrameCallback((frame) => {
    "worklet";
    const dt = frame.timeSincePreviousFrame;
    if (dt === null) return;
    samples.modify((a) => {
      "worklet";
      a.push(Date.now(), dt);
      return a;
    }, false);
  }, on);
  useEffect(() => {
    if (on) return;
    const a = samples.value;
    const toJs = jsFromWall();
    for (let i = 0; i < a.length; i += 2) diag({ k: "frame", t: toJs(a[i]), dt: a[i + 1] });
    samples.value = [];
  }, [on, samples]);
  return null;
}
```

`lib/diagnostics/jsLag.ts`, the JS-thread twin of `FrameProbe` (moved here from plan 4's Task 1). A tick due every 8 ms that arrives late is time the JS thread spent elsewhere, which the UI-thread probe cannot see:

```ts
import { diag } from "./index";

const TICK_MS = 8;
const LAG_MS = 34;

export function startJsLag(): () => void {
  let last = performance.now();
  let n = 0;
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    const t = performance.now();
    if (t - last >= LAG_MS) diag({ k: "jsLag", t, dt: t - last });
    last = t;
    n++;
    timer = setTimeout(tick, TICK_MS);
  };
  timer = setTimeout(tick, TICK_MS);
  return () => {
    clearTimeout(timer);
    diag({ k: "jsTicks", t: performance.now(), n });
  };
}
```

A `jsLag` row's `t` ends its interval, as a `frame` row's does. `jsTicks` is the floor: a gate that finds no `jsLag` must also find ticks, or the probe never ran.

`lib/diagnostics/build.ts` (from plan 4's Task 2). RN hands JS no Debug/Release constant, so the native configuration is proven at build time by `ios-bench.yml`, and this reads what JS can see:

```ts
import { TurboModuleRegistry, type TurboModule } from "react-native";

interface SourceCode extends TurboModule { getConstants(): { scriptURL: string } }

export function benchBuild(): { dev: boolean; scriptURL: string | null } {
  return { dev: __DEV__, scriptURL: TurboModuleRegistry.get<SourceCode>("SourceCode")?.getConstants().scriptURL ?? null };
}
```

`lib/diagnostics/scenarios/idle.ts`:

```ts
import { registerBenchScenario } from "../bench";

registerBenchScenario("idle", async (ctx) => {
  ctx.frames(true);
  await ctx.sleep(5000);
  ctx.frames(false);
  await ctx.sleep(100);
});
```

`lib/diagnostics/scenarios/index.ts`:

```ts
import "./idle";
```

`components/BenchScreen.tsx`. It lives in `components/` because it renders `GameTable`, which `lib/` may not import (`tests/ui-rules/layering.test.ts`):

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import { GameTable } from "@/components/GameTable";
import type { GameState } from "@/lib/game/gameEngine";
import { Colors, FontSize, Spacing, Type } from "@/lib/theme";
import { diag } from "@/lib/diagnostics";
import { recorder } from "@/lib/diagnostics/recorder";
import { benchScenarios, type BenchContext } from "@/lib/diagnostics/bench";
import { benchBuild } from "@/lib/diagnostics/build";
import { FrameProbe } from "@/lib/diagnostics/FrameProbe";
import { startJsLag } from "@/lib/diagnostics/jsLag";
import "@/lib/diagnostics/scenarios";

const COPY = { runAll: "Run all" } as const;

const collectorHost = (param: string | undefined) =>
  param ?? (process.env.EXPO_PUBLIC_DOMAIN ? new URL(process.env.EXPO_PUBLIC_DOMAIN).hostname : "127.0.0.1");

export function BenchScreen() {
  useKeepAwake();
  const params = useLocalSearchParams<Record<string, string>>();
  const [table, setTable] = useState<{ state: GameState | null }>({ state: null });
  const [frames, setFrames] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const shown = useRef<() => void>(() => {});
  const running = useRef(false);
  const autoRan = useRef(false);
  const stopJs = useRef<(() => void) | null>(null);

  const run = useCallback(
    async (only?: string) => {
      if (running.current) return;
      running.current = true;
      recorder.postTo(collectorHost(params.host));
      diag({ k: "build", t: performance.now(), ...benchBuild() });
      const ctx: BenchContext = {
        params,
        showTable: (state) =>
          new Promise((resolve) => {
            shown.current = resolve;
            setTable({ state });
          }),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        frames: (on) => {
          setFrames(on);
          stopJs.current?.();
          stopJs.current = on ? startJsLag() : null;
        },
      };
      for (const [name, scenario] of benchScenarios()) {
        if (only && only !== name) continue;
        diag({ k: "scenario", t: performance.now(), name, phase: "start" });
        const error = await scenario(ctx).then(() => null, (e: unknown) => String(e));
        diag({ k: "scenario", t: performance.now(), name, phase: "end", error });
        setResults((r) => ({ ...r, [name]: error ?? "done" }));
      }
      running.current = false;
    },
    [params]
  );

  useEffect(() => {
    shown.current();
  }, [table]);
  useEffect(() => {
    if (!params.scenario || autoRan.current) return;
    autoRan.current = true;
    void run(params.scenario === "all" ? undefined : params.scenario);
  }, [params.scenario, run]);

  return (
    <>
      <FrameProbe on={frames} />
      {table.state ? (
        <GameTable
          gameState={table.state}
          viewerSeat={0}
          selectedIds={[]}
          onSelectCard={() => {}}
          onPlay={() => {}}
          onPass={() => {}}
          onExchangeGive={() => {}}
          onQuit={() => router.replace("/bench")}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.page}>
          <Pressable accessibilityRole="button" onPress={() => void run()} style={styles.button}>
            <Text style={styles.text}>{COPY.runAll}</Text>
          </Pressable>
          <Text selectable style={styles.text}>
            {JSON.stringify(results, null, 2)}
          </Text>
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.lg, gap: Spacing.md, backgroundColor: Colors.bg },
  button: { padding: Spacing.md, backgroundColor: Colors.bgSurface },
  text: { ...Type.bodyStrong, fontSize: FontSize.sm },
});
```

`showTable` wraps the state in a fresh object, so every call re-renders and resolves, including `showTable(null)` over an empty table and the same state twice.

Every style value is a token (rule 18). The one visible string is developer chrome, held in `COPY` as `app/capture.tsx` holds its own.

`app/bench.tsx`:

```tsx
import type React from "react";

const Bench: () => React.ReactElement | null =
  process.env.EXPO_PUBLIC_DIAGNOSTICS === "1" ? require("@/components/BenchScreen").BenchScreen : () => null;

export default Bench;
```

In `app/_layout.tsx`:

- Import `DIAGNOSTICS` from `@/lib/diagnostics`.
- After the capture's `Stack.Protected`, add:

  ```tsx
          <Stack.Protected guard={DIAGNOSTICS}>
            <Stack.Screen name="bench" />
          </Stack.Protected>
  ```

- In `RootLayoutNav`, the bench owns the music while it runs. Replace the music effect with:

  ```tsx
    const track = trackForRoute(pathname);
    const benchOwnsAudio = DIAGNOSTICS && pathname === "/bench";
    useEffect(() => {
      if (!benchOwnsAudio) void playMusic(track);
    }, [track, benchOwnsAudio]);
  ```

`app/+native-intent.tsx` becomes:

```tsx
const DIAGNOSTICS = process.env.EXPO_PUBLIC_DIAGNOSTICS === "1";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (DIAGNOSTICS && /^(murlan:\/\/|\/)?bench(\?|$)/.test(path)) return path.replace(/^murlan:\/\//, "/");
  return "/";
}
```

In `components/GameTable.tsx`:

- import `useBenchHandle` from `@/lib/diagnostics`;
- directly after the `handleCardPress` `useCallback`, add:

  ```tsx
    useBenchHandle("cardPress", handleCardPress);
  ```

- [ ] **Step 6: The collector and the verdict**

`scripts/diagnostics-collector.mjs`:

```js
#!/usr/bin/env node
// node scripts/diagnostics-collector.mjs [out.ndjson] — the bench posts here on :5099 (docs/agents/checks.md).
import http from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { isInvokedDirectly } from "./lib/entry.mjs";

export function createCollector(file) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  return http.createServer((req, res) => {
    if (req.method === "GET") return res.end("ok");
    if (req.method !== "POST" || req.url !== "/log") {
      res.statusCode = 404;
      return res.end();
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { session, seq, rows, dropped = 0 } = JSON.parse(body);
        const lines = [{ session, seq, k: "batch", n: rows.length, dropped }, ...rows.map((row) => ({ session, seq, ...row }))];
        appendFileSync(file, lines.map((l) => JSON.stringify(l) + "\n").join(""));
        res.end("ok");
      } catch {
        res.statusCode = 400;
        res.end();
      }
    });
  });
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const file = process.argv[2] ?? path.join("diagnostics", `${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`);
  createCollector(file).listen(5099, "0.0.0.0", () => console.log(`• Diagnostics collector on :5099 → ${file}`));
}
```

`scripts/diagnostics-verdict.mjs`. The phone only records; every gate is computed here, from raw rows:

```js
#!/usr/bin/env node
// node scripts/diagnostics-verdict.mjs <run.ndjson> <scenario|all> — exits 1 unless every named gate passed.
import { readFileSync } from "node:fs";
import { isInvokedDirectly } from "./lib/entry.mjs";

export const GATES = {
  idle: (rows) => {
    const frames = rows.filter((r) => r.k === "frame").length;
    return { pass: frames > 0, metrics: { frames } };
  },
};

function bracket(rows, scenario) {
  const start = rows.findLastIndex((r) => r.k === "scenario" && r.name === scenario && r.phase === "start");
  if (start === -1) return null;
  const session = rows[start].session;
  const end = rows.findIndex((r, i) => i > start && r.k === "scenario" && r.name === scenario && r.phase === "end");
  if (end === -1) return null;
  return { rows: rows.slice(start, end + 1).filter((r) => r.session === session), session, error: rows[end].error ?? null };
}

function unrun(build) {
  if (!build) return "no build row";
  if (build.dev) return "dev JS";
  return !build.scriptURL || /^https?:/i.test(build.scriptURL) ? "not an embedded Release bundle" : null;
}

export function verdict(rows, scenario) {
  const gate = GATES[scenario];
  const part = gate && bracket(rows, scenario);
  if (!part) return null;
  const v = gate(part.rows);
  const dropped = rows.filter((r) => r.k === "batch" && r.session === part.session).reduce((n, r) => n + (r.dropped ?? 0), 0);
  const judged = part.error
    ? { pass: false, metrics: { ...v.metrics, error: part.error } }
    : dropped > 0 ? { pass: false, metrics: { ...v.metrics, dropped } } : v;
  const reason = unrun(rows.findLast((r) => r.k === "build" && r.session === part.session));
  return reason ? { pass: null, metrics: { ...judged.metrics, unrun: reason } } : judged;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [file, scenario] = process.argv.slice(2);
  const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const names = scenario === "all" ? Object.keys(GATES).filter((n) => rows.some((r) => r.k === "scenario" && r.name === n)) : [scenario];
  const out = Object.fromEntries(names.map((n) => [n, verdict(rows, n)]));
  console.log(JSON.stringify(out, null, 2));
  process.exit(names.length > 0 && names.every((n) => out[n]?.pass === true) ? 0 : 1);
}
```

Add `/diagnostics/` to `.gitignore`, under `# Coverage`.

- [ ] **Step 7: `ios:device --diagnostics`**

In `scripts/ios-device.mjs`, export the Metro environment:

```js
export function metroEnv(env, ip, diagnostics) {
  return {
    ...env,
    EXPO_PUBLIC_DOMAIN: `http://${ip}:${SERVER_PORT}`,
    REACT_NATIVE_PACKAGER_HOSTNAME: ip,
    ...(diagnostics ? { EXPO_PUBLIC_DIAGNOSTICS: "1" } : {}),
  };
}
```

Then:

- `async function serve(home)` becomes `async function serve(home, diagnostics)`.
- The Metro spawn's `env:` becomes `metroEnv(process.env, ip, diagnostics)`.
- Directly before the Metro spawn, add:

  ```js
    if (diagnostics) {
      const collector = spawn(process.execPath, [path.join(ROOT, "scripts", "diagnostics-collector.mjs")], { cwd: ROOT, stdio: "inherit" });
      process.on("exit", () => killTree(collector));
      console.log(`• Diagnostics build: once the app loads, open murlan://bench?host=${ip}&scenario=all on the phone.`);
    }
  ```

- In `main()`, `await serve(home)` becomes `await serve(home, args.includes("--diagnostics"))`.
- The docblock's Flags sentence gains ``, `--diagnostics` serves the diagnostics build and its collector (verdicts unrun), `--bench` installs the Release bench build that gates read``. That edits the sentence; it adds no line.

**`--bench`** (moved from plan 4's Task 2):

- delete `const WORKFLOW` and `const ARTIFACT` (`:27-28`);
- `runsOf(ref)` becomes `runsOf(ref, workflow)`;
- `latestBuild(home, ref)` becomes `latestBuild(home, ref, bench)` and uses `artifactFor(bench)`: its `workflow` in `runsOf`, `gh workflow run` and the download, its `name` for `-n`, and its `ipa` for the file checked and returned (`:209`, `:214`);
- `main()` reads `const bench = args.includes("--bench")`, passes it to `latestBuild`, and after the install calls `bench ? benchServe() : await serve(home, args.includes("--diagnostics"))`.

```js
export function artifactFor(bench) {
  return bench
    ? { workflow: "ios-bench.yml", name: "murlan-ios-bench", ipa: "murlan-bench.ipa" }
    : { workflow: "ios-device.yml", name: "murlan-ios-dev", ipa: "murlan-dev.ipa" };
}

export function benchUrl(ip) {
  return `murlan://bench?host=${ip}&scenario=all`;
}

function benchServe() {
  const ip = lanAddress(os.networkInterfaces());
  if (!ip) fail("No Wi-Fi/LAN address on this PC; the phone must share a network with it.");
  const collector = spawn(process.execPath, [path.join(ROOT, "scripts", "diagnostics-collector.mjs")], { cwd: ROOT, stdio: "inherit" });
  process.on("exit", () => killTree(collector));
  console.log(`• Bench build installed. On the iPhone open ${benchUrl(ip)} and leave it face up; results land in diagnostics/.`);
}
```

`.github/workflows/ios-bench.yml` is plan 4's Task 2 Step 4 file, unchanged: `workflow_dispatch` only; `EXPO_PUBLIC_DIAGNOSTICS: "1"` on the build step; `xcodebuild -configuration Release -sdk iphoneos … CODE_SIGNING_ALLOWED=NO`; then the step "The bench build is Release, with an embedded bundle that carries the recorder", which fails unless `Build/Products/Release-iphoneos/*.app` exists with `main.jsbundle` and `node scripts/e2eBuildMark.mjs --present "$app" --mark diagnostics` passes; it zips `murlan-bench.ipa`, writes `fingerprint.txt` as `bench-${{ github.sha }}`, and uploads both as `murlan-ios-bench`. Copy it from `docs/plans/2026-09-28-1259-4-thread-load.md` Task 2 Step 4 with Edit/Write, and delete nothing from it. A Debug build has no `Release-iphoneos` product, a Metro build has no `main.jsbundle`, and an unflagged bundle lacks the mark, so each way of building the wrong thing fails the step. The `bench-` fingerprint makes the next plain `npm run ios:device` reinstall the dev client (`needsInstall`, `ios-device.mjs:33`). It is proven by its first dispatch: `gh workflow run ios-bench.yml --ref <branch>`, then read the run.

- [ ] **Step 8: CI proves both directions of the gate**

In ci.yml's `build` job, directly after the step "The production web bundle carries no test-only flag":

```yaml
      - name: The production web bundle carries no diagnostics recorder
        run: node scripts/e2eBuildMark.mjs --absent dist --mark diagnostics

      - name: A diagnostics build carries the recorder
        env:
          EXPO_PUBLIC_DIAGNOSTICS: "1"
        run: npx expo export --platform web --output-dir dist-diag && node scripts/e2eBuildMark.mjs --present dist-diag --mark diagnostics
```

The second step is the floor for the first: a mark that never survives a build would make "absent" true by construction.

- [ ] **Step 9: Verify**

Run each on its own. Expected: PASS.

- `node --test tests/tooling/diagnosticsGate.test.ts`
- `node --test tests/tooling/diagnosticsVerdict.test.ts`
- `node --test tests/tooling/e2eBuildMark.test.ts`
- `node --test tests/tooling/iosDevice.test.ts`

Then run `npx tsc --noEmit -p .` and `npx eslint lib/diagnostics components/BenchScreen.tsx components/GameTable.tsx app/bench.tsx app/_layout.tsx app/+native-intent.tsx scripts/e2eBuildMark.mjs scripts/ios-device.mjs scripts/diagnostics-collector.mjs scripts/diagnostics-verdict.mjs tests/helpers/moduleEdges.ts tests/tooling`. Expected: clean.

- [ ] **Step 10: Document the bench**

In `docs/agents/checks.md`, add a subsection "Device bench (diagnostics builds)" after "Device runs". It says:

- the bench and `modules/murlan-diagnostics` are reachable only when `EXPO_PUBLIC_DIAGNOSTICS=1`;
- `npm run ios:device -- --ref <branch> --bench` installs the Release bench build (`ios-bench.yml`) and starts the collector on :5099, whose NDJSON lands in `diagnostics/`; `--diagnostics` serves Metro JS on the dev client for iterating on a scenario;
- `node scripts/diagnostics-verdict.mjs <file> all` computes every gate from the raw rows, and reports `pass: null` with `unrun` for any run not on a Release build with an embedded bundle: Debug and Release differ 2.6–3× on JS-thread stall (`docs/research/2026-09-28-lantern-review.md`), so a Debug verdict would fail for work no player runs;
- ci.yml `build` checks that production carries no recorder, and that a diagnostics export does.

Add 5099 to the file's local-ports list.

- [ ] **Step 11: Commit**

```bash
git add -- tests/helpers/moduleEdges.ts lib/diagnostics components/BenchScreen.tsx components/GameTable.tsx app/bench.tsx app/_layout.tsx app/+native-intent.tsx scripts/e2eBuildMark.mjs scripts/ios-device.mjs scripts/diagnostics-collector.mjs scripts/diagnostics-verdict.mjs .github/workflows/ci.yml .github/workflows/ios-bench.yml .gitignore docs/agents/checks.md tests/tooling/diagnosticsGate.test.ts tests/tooling/diagnosticsVerdict.test.ts tests/tooling/e2eBuildMark.test.ts tests/tooling/iosDevice.test.ts
git commit -m "feat(#1259): diagnostics that ship off, the bench route and its collector

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The two libraries, pinned, and release builds that prove their defaults are off

**Files:**
- Modify: `package.json`, `package-lock.json`, `app.json` and `.github/workflows/ci.yml` (`android-build`, `ios-build`)
- Test: `tests/tooling/audioLibraries.test.ts`

- [ ] **Step 1: The failing test**

`tests/tooling/audioLibraries.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (file: string) => JSON.parse(readFileSync(path.join(repoRoot, file), "utf8"));
const PINS = { "react-native-audio-api": "0.13.6", "react-native-turbo-haptics": "1.2.0" };

test("both libraries are pinned exactly, and the lockfile resolves the pins", () => {
  const deps = json("package.json").dependencies;
  const lock = json("package-lock.json").packages;
  for (const [name, version] of Object.entries(PINS)) {
    assert.equal(deps[name], version, `${name} must be pinned to exactly ${version}`);
    assert.equal(lock[`node_modules/${name}`]?.version, version, `package-lock.json resolves ${name} elsewhere`);
  }
});

test("the audio library's plugin runs with every service, permission, background mode and download off", () => {
  const plugins: unknown[] = json("app.json").expo.plugins;
  const entry = plugins.find((p) => Array.isArray(p) && p[0] === "react-native-audio-api") as [string, object] | undefined;
  assert.deepEqual(entry?.[1], {
    iosBackgroundMode: false,
    androidForegroundService: false,
    androidPermissions: [],
    disableFFmpeg: true,
    disableStaticExternalLibs: true,
  });
  assert.ok(!plugins.includes("react-native-audio-api"), "a bare plugin entry runs every default");
});
```

Each assertion names the exact value, so a missing entry, a caret range or a bare plugin string is red.

- [ ] **Step 2: Run it and watch it fail**

Run `node --test tests/tooling/audioLibraries.test.ts`. Expected: FAIL, `undefined !== "0.13.6"`.

- [ ] **Step 3: Ask the owner, then install**

Ask in chat, and wait for a clear yes:

> Task 2 runs `npm install --save-exact --prefer-offline react-native-audio-api@0.13.6 react-native-turbo-haptics@1.2.0`. It downloads `react-native-audio-api-0.13.6.tgz` (1.8 MB) and `react-native-turbo-haptics-1.2.0.tgz` (16 KB) from registry.npmjs.org. It also fills this worktree's own `node_modules` from npm's cache, and from the registry for anything the cache lacks. Proceed?

On a yes, in the worktree:

1. Check whether `node_modules` is a junction to the main checkout: `(Get-Item node_modules -Force).Attributes -band [IO.FileAttributes]::ReparsePoint`.
2. If it is, remove only the junction with `cmd /c rmdir node_modules`. That is not recursive. Then confirm `Test-Path C:/Users/roton/murlan/node_modules/react` is still `True`.
3. Run the install.

`npm install` resolves through the lockfile that CI's `npm ci` obeys.

- [ ] **Step 4: The plugin**

In `app.json`, after `"expo-notifications"` in `plugins`, add:

```json
      [
        "react-native-audio-api",
        {
          "iosBackgroundMode": false,
          "androidForegroundService": false,
          "androidPermissions": [],
          "disableFFmpeg": true,
          "disableStaticExternalLibs": true
        }
      ]
```

`"expo-audio"` stays until Task 10.

- [ ] **Step 5: `android-build` becomes a release build with assertions**

Replace the job's steps from `- run: npx expo prebuild --platform android --no-install` to the end of the job with the block below. Also set `timeout-minutes: 60`, because a bundled release takes longer than a debug build.

```yaml
      - name: Generate the native project, on the NDK React Native pins
        run: |
          npx expo prebuild --platform android --no-install
          want=$(sed -n 's/^ndkVersion = "\(.*\)"$/\1/p' node_modules/react-native/gradle/libs.versions.toml)
          have=$(ls "$ANDROID_HOME/ndk" | grep "^${want%%.*}\." | sort -V | tail -1)
          [ -n "$have" ] || { echo "::error::No NDK ${want%%.*}.x under $ANDROID_HOME/ndk to build with."; exit 1; }
          sed -i "1i ext.ndkVersion = \"$have\"" android/build.gradle
      - name: The audio library's downloads are off
        run: |
          grep -qx "disableAudioapiFFmpeg=true" android/gradle.properties
          grep -qx "disableAudioapiStaticExternalLibs=true" android/gradle.properties
      - uses: actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3 # v4.9.1
        with:
          distribution: temurin
          java-version: "17"
          cache: gradle
      - name: Compile a release, JS bundled
        working-directory: android
        run: ./gradlew assembleRelease -PreactNativeArchitectures=x86_64 -x lintVitalRelease --no-daemon
      - name: The release carries both libraries, no FFmpeg, no background service, no cleartext
        run: |
          apk=$(ls android/app/build/outputs/apk/release/*.apk | head -1)
          [ -n "$apk" ] || { echo "::error::assembleRelease produced no APK."; exit 1; }
          unzip -l "$apk" > "$RUNNER_TEMP/apk.txt"
          unzip -q -o "$apk" "assets/index.android.bundle" -d "$RUNNER_TEMP/apk"
          [ -f "$RUNNER_TEMP/apk/assets/index.android.bundle" ] || { echo "::error::The release APK embeds no JS bundle."; exit 1; }
          node scripts/e2eBuildMark.mjs --absent "$RUNNER_TEMP/apk" --mark diagnostics
          grep -q "lib/x86_64/libreact-native-audio-api.so" "$RUNNER_TEMP/apk.txt"
          grep -q "lib/x86_64/libturbo-haptics.so" "$RUNNER_TEMP/apk.txt"
          if grep -q "libav" "$RUNNER_TEMP/apk.txt"; then echo "::error::FFmpeg shipped in the APK."; exit 1; fi
          aapt=$(find "$ANDROID_HOME/build-tools" -name aapt2 | sort | tail -1)
          "$aapt" dump xmltree --file AndroidManifest.xml "$apk" > "$RUNNER_TEMP/manifest.txt"
          grep -q "android.permission.VIBRATE" "$RUNNER_TEMP/manifest.txt"
          if grep -qE "FOREGROUND_SERVICE|CentralizedForegroundService|usesCleartextTraffic" "$RUNNER_TEMP/manifest.txt"; then
            echo "::error::The merged manifest carries a foreground service or cleartext traffic."; exit 1
          fi
          test -d node_modules/react-native-audio-api/common/cpp
          if find node_modules/react-native-audio-api \( -name "libav*" -o -name "libopus*.a" -o -name "libvorbis*.a" -o -name "*.xcframework" \) | grep -q .; then
            echo "::error::A prebuilt binary was downloaded."; exit 1
          fi
```

Each absence check sits under a presence check on the same data:

- the `.so` names, for the APK listing;
- turbo-haptics' `VIBRATE`, for the merged manifest;
- `common/cpp`, for the package tree.

- [ ] **Step 6: `ios-build` becomes a Release build with assertions**

Make these changes:

- After `- run: npx expo prebuild --platform ios --no-install`, add:

  ```yaml
      - name: The audio library's downloads are off
        run: |
          grep -qF "ENV['DISABLE_AUDIOAPI_FFMPEG'] = '1'" ios/Podfile
          grep -qF "ENV['DISABLE_AUDIOAPI_STATIC_EXTERNAL_LIBS'] = '1'" ios/Podfile
  ```

- After `- run: pod install --project-directory=ios`, add:

  ```yaml
      - name: Both libraries resolved at their pins
        run: |
          grep -qF "RNAudioAPI (0.13.6)" ios/Podfile.lock
          grep -qF "TurboHaptics (1.2.0)" ios/Podfile.lock
  ```

- In "Compile", replace `-configuration Debug \` with `-configuration Release \`.
- At the end of the job, add:

  ```yaml
      - name: The release declares no background audio, and nothing was downloaded
        run: |
          app=$(ls -d "$RUNNER_TEMP/DerivedData/Build/Products/Release-iphonesimulator/"*.app | head -1)
          [ -n "$app" ] || { echo "::error::xcodebuild produced no .app."; exit 1; }
          /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist"
          if /usr/libexec/PlistBuddy -c 'Print :UIBackgroundModes' "$app/Info.plist" 2>/dev/null | grep -qw audio; then
            echo "::error::UIBackgroundModes carries audio."; exit 1
          fi
          [ -f "$app/main.jsbundle" ] || { echo "::error::The Release .app embeds no main.jsbundle."; exit 1; }
          node scripts/e2eBuildMark.mjs --absent "$app" --mark diagnostics
          if /usr/libexec/PlistBuddy -c 'Print :NSMicrophoneUsageDescription' "$app/Info.plist" >/dev/null 2>&1; then
            echo "::error::A production build asks for the microphone."; exit 1
          fi
          test -d node_modules/react-native-audio-api/common/cpp
          if find node_modules/react-native-audio-api \( -name "libav*" -o -name "*.xcframework" \) | grep -q .; then
            echo "::error::A prebuilt binary was downloaded."; exit 1
          fi
  ```

The `package.json` change already puts both jobs in scope (`tools/ci/nativeScope.mjs` `needsNative`).

The native bundles are checked for the diagnostics mark as the web `dist` is (Task 1): a production binary is what players run, and the web check says nothing about Metro's native graph. The embedded bundle's existence is each check's floor; the soak's `--present` on a flagged build (Task 8) and `ios-bench.yml`'s prove the mark survives Hermes. The microphone check has no floor of its own until Task 3's plugin exists; `diagnosticsPlugin.test.ts` is it.

- [ ] **Step 7: Verify**

Run `node --test tests/tooling/audioLibraries.test.ts` (PASS), `npx tsc --noEmit -p .` and `npx eslint tests/tooling/audioLibraries.test.ts`.

Commit, push, and dispatch the native jobs: `gh workflow run ci.yml --ref <branch> -f native=true`. Read the run: both "compiles" jobs must be green before Task 3.

If an absence check is red on a permission or background mode that another library adds (not this one), stop. Report it to the lead with the manifest or plist line; do not widen the pattern.

- [ ] **Step 8: Commit**

```bash
git add -- package.json package-lock.json app.json .github/workflows/ci.yml tests/tooling/audioLibraries.test.ts
git commit -m "feat(#1259): pin react-native-audio-api and turbo-haptics, with release builds that prove their defaults are off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `modules/murlan-diagnostics`, anchored `.gitignore`, and native scope

**Files:**
- Create:
  - `modules/murlan-diagnostics/expo-module.config.json`, `index.ts` and `app.plugin.js`;
  - `modules/murlan-diagnostics/ios/MurlanDiagnostics.podspec`, `ios/MurlanDiagnosticsModule.swift` and `ios/Detectors.swift`;
  - `modules/murlan-diagnostics/android/build.gradle` and `android/src/main/java/expo/modules/murlandiagnostics/MurlanDiagnosticsModule.kt`;
  - `lib/diagnostics/probe.ts`.
- Modify: `.gitignore`, `app.json`, `tools/ci/nativeScope.mjs`, `components/BenchScreen.tsx` and `.github/workflows/ci.yml`
- Test: `tests/tooling/gitignoreNativeDirs.test.ts`, `tests/tooling/nativeScope.test.ts` and `tests/tooling/diagnosticsPlugin.test.ts`

- [ ] **Step 1: The failing tests**

`tests/tooling/gitignoreNativeDirs.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ignored = (p: string) => spawnSync("git", ["check-ignore", "--no-index", "-q", p], { cwd: repoRoot }).status === 0;

test("the generated native projects are ignored, and a local module's native sources are not", () => {
  assert.equal(ignored("ios/Podfile"), true, "check-ignore reads nothing — the floor");
  assert.equal(ignored("android/app/build.gradle"), true);
  assert.equal(ignored("modules/murlan-diagnostics/ios/MurlanDiagnosticsModule.swift"), false);
  assert.equal(ignored("modules/murlan-diagnostics/android/build.gradle"), false);
});
```

Append to `tests/tooling/nativeScope.test.ts`:

```ts
test("a local native module's sources need the native builds; other sources do not", () => {
  assert.equal(needsNative(["modules/murlan-diagnostics/ios/MurlanDiagnosticsModule.swift"], "", ""), true);
  assert.equal(needsNative(["lib/diagnostics/probe.ts"], "", ""), false);
});
```

`tests/tooling/diagnosticsPlugin.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const plugin = createRequire(import.meta.url)("../../modules/murlan-diagnostics/app.plugin.js") as (c: object) => { mods?: { android?: Record<string, unknown>; ios?: Record<string, unknown> } };

test("cleartext traffic and the microphone prompt are added to a diagnostics prebuild and never to any other", () => {
  const config = { name: "murlan", slug: "murlan" };
  delete process.env.EXPO_PUBLIC_DIAGNOSTICS;
  assert.equal(plugin(config), config);
  process.env.EXPO_PUBLIC_DIAGNOSTICS = "1";
  const flagged = plugin({ ...config });
  assert.equal(typeof flagged.mods?.android?.manifest, "function");
  assert.equal(typeof flagged.mods?.ios?.infoPlist, "function");
  delete process.env.EXPO_PUBLIC_DIAGNOSTICS;
});
```

- [ ] **Step 2: Run them and watch them fail**

Run each on its own. Expected:

- `gitignoreNativeDirs` fails on the module paths, which are ignored today;
- `nativeScope` fails with `false !== true`;
- `diagnosticsPlugin` fails, because the file does not exist.

- [ ] **Step 3: Anchor the patterns, first**

In `.gitignore`, under `# Native`, replace `ios/` with `/ios/` and `android/` with `/android/`. Then run `git status --porcelain --untracked-files=all`. Expected: nothing new appears outside `modules/`. If a nested `ios/` or `android/` shows up, stop and report it to the lead.

- [ ] **Step 4: The module**

`modules/murlan-diagnostics/expo-module.config.json`:

```json
{
  "platforms": ["apple", "android"],
  "apple": { "modules": ["MurlanDiagnosticsModule"] },
  "android": { "modules": ["expo.modules.murlandiagnostics.MurlanDiagnosticsModule"] }
}
```

`modules/murlan-diagnostics/index.ts`:

```ts
import { requireOptionalNativeModule } from "expo";

export interface MurlanDiagnostics {
  hostNowMs(): number;
  footprintMb(): number;
  outputLatencyMs?(): number;
  ioBufferMs?(): number;
  inputLatencyMs?(): number;
  startCapture?(mic: boolean): Promise<boolean>;
  stopCapture?(): Promise<boolean>;
  startMotion?(): boolean;
  stopMotion?(): void;
  drain?(): Record<string, string | number>[];
}

export default requireOptionalNativeModule<MurlanDiagnostics>("MurlanDiagnostics");
```

`modules/murlan-diagnostics/app.plugin.js`:

```js
const { withAndroidManifest, withInfoPlist } = require("expo/config-plugins");

module.exports = (config) =>
  process.env.EXPO_PUBLIC_DIAGNOSTICS === "1"
    ? withInfoPlist(
        withAndroidManifest(config, (mod) => {
          mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = "true";
          return mod;
        }),
        (mod) => {
          mod.modResults.NSMicrophoneUsageDescription = "The bench records the speaker to time sound onsets.";
          return mod;
        }
      )
    : config;
```

The microphone prompt ships only in a diagnostics build: G3's calibration hears the speaker through ReplayKit's `.audioMic` track, which needs it.

In `app.json` `plugins`, add `"./modules/murlan-diagnostics/app.plugin.js"`.

`modules/murlan-diagnostics/ios/MurlanDiagnostics.podspec`:

```ruby
Pod::Spec.new do |s|
  s.name = 'MurlanDiagnostics'
  s.version = '1.0.0'
  s.summary = 'Host time, memory, audio onsets and motion for the Murlan bench'
  s.homepage = 'https://github.com/metasito/murlan'
  s.license = 'UNLICENSED'
  s.author = 'Murlan'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.frameworks = 'ReplayKit', 'CoreMotion', 'AVFAudio'
end
```

`modules/murlan-diagnostics/ios/Detectors.swift`:

```swift
import AudioToolbox
import CoreMedia

struct OnsetDetector {
  let source: String
  let levels: Bool
  init(source: String, levels: Bool) { self.source = source; self.levels = levels }
  private var average = 1e-9
  private var lastOnset = -Double.infinity
  private var levelSum = 0.0
  private var levelCount = 0
  private var levelStart = -1.0

  mutating func feed(_ buffer: CMSampleBuffer) -> [[String: Any]] {
    guard let format = CMSampleBufferGetFormatDescription(buffer),
          let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee else { return [] }
    // ReplayKit stamps sample buffers on the host clock, the one hostNowMs reads.
    let t0 = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer)) * 1000
    let samples = firstChannel(buffer, asbd)
    let rate = asbd.mSampleRate
    let window = max(1, Int(rate / 1000))
    var rows: [[String: Any]] = []
    var i = 0
    while i + window <= samples.count {
      var power = 0.0
      for s in samples[i..<(i + window)] { power += Double(s * s) }
      power /= Double(window)
      let t = t0 + Double(i) / rate * 1000
      let db = 10 * log10(power + 1e-12)
      if db > 10 * log10(average + 1e-12) + 12, db > -45, t - lastOnset > 50 {
        rows.append(["k": "onset", "host": t, "db": db, "source": source])
        lastOnset = t
      }
      average += (power - average) / 20
      guard levels else { i += window; continue }
      if levelStart < 0 { levelStart = t }
      levelSum += power
      levelCount += 1
      if t - levelStart >= 50 {
        rows.append(["k": "level", "host": levelStart, "db": 10 * log10(levelSum / Double(levelCount) + 1e-12)])
        levelSum = 0
        levelCount = 0
        levelStart = -1
      }
      i += window
    }
    return rows
  }

  private func firstChannel(_ buffer: CMSampleBuffer, _ asbd: AudioStreamBasicDescription) -> [Float] {
    var size = 0
    CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(buffer, bufferListSizeNeededOut: &size, bufferListOut: nil, bufferListSize: 0, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
    guard size > 0 else { return [] }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    let list = raw.bindMemory(to: AudioBufferList.self, capacity: 1)
    var block: CMBlockBuffer?
    guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(buffer, bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: size, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block) == noErr else { return [] }
    let first = UnsafeMutableAudioBufferListPointer(list)[0]
    guard let data = first.mData, asbd.mBitsPerChannel > 0 else { return [] }
    let stride = Int(first.mNumberChannels)
    let count = Int(first.mDataByteSize) / Int(asbd.mBitsPerChannel / 8) / max(1, stride)
    let isFloat = asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0
    let bigEndian = asbd.mFormatFlags & kAudioFormatFlagIsBigEndian != 0
    var out = [Float](repeating: 0, count: count)
    if isFloat && asbd.mBitsPerChannel == 32 {
      let p = data.assumingMemoryBound(to: Float.self)
      for f in 0..<count { out[f] = p[f * stride] }
    } else if !isFloat && asbd.mBitsPerChannel == 16 {
      let p = data.assumingMemoryBound(to: Int16.self)
      for f in 0..<count { out[f] = Float(bigEndian ? Int16(bigEndian: p[f * stride]) : p[f * stride]) / 32768 }
    } else {
      return []
    }
    return out
  }
}

struct ShakeDetector {
  private var mean = 1.0
  private var last = -Double.infinity

  mutating func feed(t: Double, x: Double, y: Double, z: Double) -> [[String: Any]] {
    let g = (x * x + y * y + z * z).squareRoot()
    let deviation = abs(g - mean)
    mean += (g - mean) / 20
    guard deviation > 0.02, t - last > 100 else { return [] }
    last = t
    return [["k": "shake", "host": t, "g": deviation]]
  }
}
```

`modules/murlan-diagnostics/ios/MurlanDiagnosticsModule.swift`:

```swift
import AVFAudio
import CoreMotion
import ExpoModulesCore
import QuartzCore
import ReplayKit

public final class MurlanDiagnosticsModule: Module {
  private let queue = DispatchQueue(label: "murlan.diagnostics")
  private var rows: [[String: Any]] = []
  private var appOnsets = OnsetDetector(source: "app", levels: true)
  private var micOnsets = OnsetDetector(source: "mic", levels: false)
  private var shakes = ShakeDetector()
  private let motion = CMMotionManager()

  public func definition() -> ModuleDefinition {
    Name("MurlanDiagnostics")

    Function("hostNowMs") { () -> Double in CACurrentMediaTime() * 1000 }

    Function("footprintMb") { () -> Double in
      var info = task_vm_info_data_t()
      var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
      let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
      }
      return kr == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : -1
    }

    Function("outputLatencyMs") { () -> Double in AVAudioSession.sharedInstance().outputLatency * 1000 }
    Function("ioBufferMs") { () -> Double in AVAudioSession.sharedInstance().ioBufferDuration * 1000 }
    Function("inputLatencyMs") { () -> Double in AVAudioSession.sharedInstance().inputLatency * 1000 }

    AsyncFunction("startCapture") { (mic: Bool, promise: Promise) in
      let recorder = RPScreenRecorder.shared()
      recorder.isMicrophoneEnabled = mic
      recorder.startCapture(handler: { [weak self] buffer, type, error in
        guard let self, error == nil else { return }
        switch type {
        case .audioApp: self.queue.async { self.rows.append(contentsOf: self.appOnsets.feed(buffer)) }
        case .audioMic: self.queue.async { self.rows.append(contentsOf: self.micOnsets.feed(buffer)) }
        default: return
        }
      }, completionHandler: { error in
        if let error { promise.reject("E_CAPTURE", error.localizedDescription) } else { promise.resolve(true) }
      })
    }

    AsyncFunction("stopCapture") { (promise: Promise) in
      RPScreenRecorder.shared().stopCapture { _ in promise.resolve(true) }
    }

    Function("startMotion") { () -> Bool in
      guard self.motion.isAccelerometerAvailable else { return false }
      self.motion.accelerometerUpdateInterval = 0.01
      let operations = OperationQueue()
      operations.underlyingQueue = self.queue
      self.motion.startAccelerometerUpdates(to: operations) { [weak self] data, _ in
        guard let self, let data else { return }
        let a = data.acceleration
        self.rows.append(contentsOf: self.shakes.feed(t: data.timestamp * 1000, x: a.x, y: a.y, z: a.z))
      }
      return true
    }

    Function("stopMotion") { self.motion.stopAccelerometerUpdates() }

    Function("drain") { () -> [[String: Any]] in
      self.queue.sync {
        let out = self.rows
        self.rows = []
        return out
      }
    }
  }
}
```

`CMAccelerometerData.timestamp` and `CACurrentMediaTime()` are both seconds since boot on the same timebase.

`modules/murlan-diagnostics/android/build.gradle`:

```gradle
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = 'expo.modules.murlandiagnostics'
version = '1.0.0'

android {
  namespace "expo.modules.murlandiagnostics"
  defaultConfig {
    versionCode 1
    versionName "1.0.0"
  }
}
```

`modules/murlan-diagnostics/android/src/main/java/expo/modules/murlandiagnostics/MurlanDiagnosticsModule.kt`:

```kotlin
package expo.modules.murlandiagnostics

import android.system.Os
import android.system.OsConstants
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class MurlanDiagnosticsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MurlanDiagnostics")

    Function("hostNowMs") { System.nanoTime() / 1e6 }

    Function("footprintMb") {
      val pages = File("/proc/self/statm").readText().trim().split(" ")[1].toLong()
      pages * Os.sysconf(OsConstants._SC_PAGESIZE) / 1048576.0
    }
  }
}
```

`lib/diagnostics/probe.ts`, the module's one importer:

```ts
import native from "@/modules/murlan-diagnostics";
import { diag, type DiagRow } from "./index";

export const probe = {
  hostNowMs: (): number | null => native?.hostNowMs() ?? null,
  footprintMb: (): number | null => native?.footprintMb() ?? null,
  outputLatencyMs: (): number | null => native?.outputLatencyMs?.() ?? null,
  ioBufferMs: (): number | null => native?.ioBufferMs?.() ?? null,
  inputLatencyMs: (): number | null => native?.inputLatencyMs?.() ?? null,
  canCapture: (): boolean => typeof native?.startCapture === "function",
  startCapture: (mic: boolean): Promise<boolean> => native?.startCapture?.(mic) ?? Promise.resolve(false),
  stopCapture: (): Promise<boolean> => native?.stopCapture?.() ?? Promise.resolve(false),
  startMotion: (): boolean => native?.startMotion?.() ?? false,
  stopMotion: (): void => native?.stopMotion?.(),
  drain(): void {
    const rows = native?.drain?.() ?? [];
    if (!native || rows.length === 0) return;
    const offset = performance.now() - native.hostNowMs();
    for (const { host, ...row } of rows) diag({ ...row, t: Number(host) + offset } as unknown as DiagRow);
  },
};
```

`drain` is where the host clock becomes the `performance.now()` timebase (Task 1, `types.ts`). The offset is sampled back to back, once a second; the two clocks drift apart by parts per million, far below a millisecond over one drain.

- [ ] **Step 5: The bench uses the probe**

In `components/BenchScreen.tsx`:

- import `probe` from `@/lib/diagnostics/probe`;
- directly after `recorder.postTo(collectorHost(params.host));`, add:

  ```tsx
        const capturing = params.capture !== "0" && probe.canCapture() && (await probe.startCapture(true).catch(() => false));
        const drain = setInterval(() => probe.drain(), 1000);
  ```

- in the scenario loop, directly after the `{ k: "scenario", …, phase: "start" }` row, add `diag({ k: "latency", t: performance.now(), outputMs: probe.outputLatencyMs(), ioMs: probe.ioBufferMs(), inputMs: probe.inputLatencyMs() });`, so each verdict reads the session values in force during its own bracket.

`capture=0` in the link skips capture, for CI runs where no one can answer ReplayKit's prompt. The capture runs with the microphone on for the whole bench run: restarting ReplayKit mid-run can prompt again, and the phone is unattended. Only `scheduledOnset` reads `source: "mic"` onsets; every other gate reads `source: "app"`, and levels come from the app track only. The first run's owner report compares the scenario latency rows with a capture-off run: if the mic moves `outputMs` or `ioMs`, report it to the lead before trusting G1–G5.

- directly before `running.current = false;`, add:

  ```tsx
        clearInterval(drain);
        probe.drain();
        if (capturing) await probe.stopCapture().catch(() => false);
  ```

- [ ] **Step 6: Native scope and the registration assertions**

In `tools/ci/nativeScope.mjs`, `CONFIG` becomes `/^(app\.json|app\.config\.(js|ts)|eas\.json|modules\/.+)$/`.

In ci.yml `android-build`'s last step, and in `ios-build` after "Both libraries resolved at their pins", add the module's registration check.

Android (after the APK checks):

```yaml
          list=$(find android node_modules/expo/android -name ExpoModulesPackageList.java 2>/dev/null | head -1)
          [ -n "$list" ] || { echo "::error::No ExpoModulesPackageList.java was generated."; exit 1; }
          grep -q "MurlanDiagnosticsModule" "$list"
```

iOS (a new step after pod install):

```yaml
      - name: The diagnostics module is registered
        run: |
          provider=$(find ios/Pods -name ExpoModulesProvider.swift | head -1)
          [ -n "$provider" ] || { echo "::error::No ExpoModulesProvider.swift was generated."; exit 1; }
          grep -q "MurlanDiagnosticsModule" "$provider"
```

- [ ] **Step 7: Verify**

Run `node --test tests/tooling/gitignoreNativeDirs.test.ts`, `node --test tests/tooling/nativeScope.test.ts`, `node --test tests/tooling/diagnosticsPlugin.test.ts` and `node --test tests/tooling/diagnosticsGate.test.ts`. Expected: PASS. The gate scan now reads `modules/` too.

Then run `npx tsc --noEmit -p .` and `npx eslint lib/diagnostics components/BenchScreen.tsx modules/murlan-diagnostics tools/ci/nativeScope.mjs`.

Stage the module, then run `git ls-files --error-unmatch modules/murlan-diagnostics/ios/MurlanDiagnosticsModule.swift modules/murlan-diagnostics/android/build.gradle`. It must list both.

Push and dispatch `gh workflow run ci.yml --ref <branch> -f native=true`. Both compiles must be green: the Swift and Kotlin compile only there.

- [ ] **Step 8: Commit**

```bash
git add -- .gitignore app.json modules/murlan-diagnostics lib/diagnostics/probe.ts components/BenchScreen.tsx tools/ci/nativeScope.mjs .github/workflows/ci.yml tests/tooling/gitignoreNativeDirs.test.ts tests/tooling/nativeScope.test.ts tests/tooling/diagnosticsPlugin.test.ts
git commit -m "feat(#1259): a diagnostics-only native module for host time, memory, onsets and motion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Music as 48 kHz FLAC

**Files:**
- Create: `assets/music/native/menu.flac`, `hand.flac` and `cue.flac`; `lib/device/musicTracks.web.ts`
- Modify: `lib/device/musicTracks.ts`, `metro.config.js`, `assets/music/README.md` and `tests/e2e/musicLoops.spec.ts`
- Delete: `lib/device/musicTracks.ios.ts` and `assets/music/{menu,hand,cue}.m4a`
- Test: `tests/tooling/musicAssets.test.ts` and `tests/native/musicPlatform.test.tsx`

- [ ] **Step 1: The failing asset test**

In `tests/tooling/musicAssets.test.ts`:

- import `moduleEdges` from `../helpers/moduleEdges.ts`;
- replace `tracksFor`, `onDiskFor` and the first test with the code below;
- leave `chosenTracks`, `trackKeys` and their two tests as they are.

```ts
function tracksFor(file: string, ext: "webm" | "flac"): string[] {
  const rel = `lib/device/${file}`;
  return moduleEdges(rel, readFileSync(path.join(repoRoot, rel), "utf8"))
    .filter((e) => e.via === "require" && e.to.endsWith(`.${ext}`))
    .map((e) => path.posix.basename(e.to, `.${ext}`))
    .sort();
}

function onDiskFor(dir: string, ext: "webm" | "flac"): string[] {
  return readdirSync(path.join(repoRoot, dir))
    .filter((f) => f.endsWith(`.${ext}`))
    .map((f) => f.slice(0, -ext.length - 1))
    .sort();
}

interface StreamInfo {
  sampleRate: number;
  channels: number;
  bits: number;
  samples: number;
}

export function streamInfo(buf: Buffer): StreamInfo {
  assert.equal(buf.toString("ascii", 0, 4), "fLaC", "not a FLAC file");
  assert.equal(buf[4] & 0x7f, 0, "the first metadata block is not STREAMINFO");
  const b = buf.subarray(8, 42);
  return {
    sampleRate: (b[10] << 12) | (b[11] << 4) | (b[12] >> 4),
    channels: ((b[12] >> 1) & 0x07) + 1,
    bits: (((b[12] & 0x01) << 4) | (b[13] >> 4)) + 1,
    samples: (b[13] & 0x0f) * 2 ** 32 + b.readUInt32BE(14),
  };
}

test("web requires exactly the WebM on disk, native exactly the FLAC, and the two name the same tracks", () => {
  const webm = tracksFor("musicTracks.web.ts", "webm");
  const flac = tracksFor("musicTracks.ts", "flac");
  assert.ok(webm.length > 0, "musicTracks.web.ts requires no WebM — the scan reads nothing");
  assert.deepEqual(onDiskFor("assets/music", "webm"), webm);
  assert.deepEqual(onDiskFor("assets/music/native", "flac"), flac);
  assert.deepEqual(flac, webm);
});

test("the STREAMINFO reader reads a planted header", () => {
  const b = Buffer.alloc(42);
  b.write("fLaC", 0, "ascii");
  b[4] = 0x80;
  b.writeUIntBE(34, 5, 3);
  b[18] = 0x0b; b[19] = 0xb8; b[20] = 0x03 | (1 << 1) | 0;
  b[21] = 0xf0 | 0x00; b.writeUInt32BE(1315611, 22);
  assert.deepEqual(streamInfo(b), { sampleRate: 48000, channels: 2, bits: 16, samples: 1315611 });
});

test("each FLAC is 48 kHz 16-bit stereo, the WebM's length, and not a silent stub", () => {
  for (const track of tracksFor("musicTracks.ts", "flac")) {
    const bytes = readFileSync(path.join(repoRoot, "assets", "music", "native", `${track}.flac`));
    const info = streamInfo(bytes);
    assert.deepEqual({ ...info, samples: undefined }, { sampleRate: 48000, channels: 2, bits: 16, samples: undefined }, track);
    assert.equal(info.samples, 1315611, `${track}.flac is not the loop's 27.408562 s at 48 kHz`);
    assert.ok(bytes.length / info.samples > 0.3, `${track}.flac compresses like silence`);
  }
});
```

The planted header encodes 48000 = `0x0BB80`, which spans bytes 10–12 of the block (buffer bytes 18–20). Channels−1 = 1 and bits−1 = 15 are split across bytes 12–13. The sample count is the low 36 bits. 1,315,611 is `assets/music/README.md`'s 27.408562 s at 48 kHz, and today's M4A header check measured the same count.

In `tests/native/musicPlatform.test.tsx`, the first `it` becomes:

```tsx
  it('resolves FLAC, the container react-native-audio-api decodes on both platforms', () => {
    expect(CONTAINER).toBe('flac');
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run `node --test tests/tooling/musicAssets.test.ts`. Expected: FAIL, because `musicTracks.web.ts` does not exist.

- [ ] **Step 3: Convert, with no download**

```bash
mkdir -p assets/music/native
for t in menu hand cue; do ffmpeg -v error -i assets/music/$t.m4a -map_metadata -1 -c:a flac -sample_fmt s16 -ar 48000 assets/music/native/$t.flac; done
for t in menu hand cue; do ffprobe -v error -show_entries stream=sample_rate,channels,sample_fmt,duration_ts -of csv=p=0 assets/music/native/$t.flac; done
```

Expected: `48000,2,s16,1315611` three times. ALAC to FLAC is lossless to lossless, so each FLAC is the shipped audio sample for sample.

- [ ] **Step 4: Split the track map by platform**

`lib/device/musicTracks.web.ts`:

```ts
/** Behind functions so Metro sees the requires while the bytes stay out of the web bundle's initial payload. */
export const CONTAINER = "webm" as const;

export const TRACKS = {
  menu: () => require("../../assets/music/menu.webm") as number,
  hand: () => require("../../assets/music/hand.webm") as number,
  cue: () => require("../../assets/music/cue.webm") as number,
} as const;

export type TrackId = keyof typeof TRACKS;
```

`lib/device/musicTracks.ts`, whose `CONTAINER` docblock stays as it is:

```ts
/** FLAC, decoded natively by react-native-audio-api on iOS and Android (assets/music/README.md). Web resolves musicTracks.web.ts. */

export const CONTAINER = "flac" as const;

export const TRACKS = {
  menu: () => require("../../assets/music/native/menu.flac") as number,
  hand: () => require("../../assets/music/native/hand.flac") as number,
  cue: () => require("../../assets/music/native/cue.flac") as number,
} as const;

export type TrackId = keyof typeof TRACKS;
```

Then:

- Delete `lib/device/musicTracks.ios.ts` and `assets/music/{menu,hand,cue}.m4a`.
- In `metro.config.js`, directly after the `ICON_SUBSETS` block, add `config.resolver.assetExts.push("flac");`.
- `lib/device/music.ts` (deleted in Task 10) keeps playing through expo-audio until then; AVPlayer and ExoPlayer both play FLAC.

In `assets/music/README.md`, replace the section "The iOS encode" with "The native encode". It says:

- iOS and Android decode the music with react-native-audio-api, whose bundled miniaudio reads FLAC and MP3 but not WebM, Ogg or ALAC once FFmpeg is off (docs/adr/0009);
- each `native/*.flac` is the same audio as the matching `*.webm`, made losslessly with the Step 3 command, and `tests/tooling/musicAssets.test.ts` pins that;
- the subfolder keeps a FLAC from sharing an Android raw-resource name with its WebM.

Keep the section's measured history of the lossy candidates as it is.

- [ ] **Step 5: The browser check decodes FLAC**

In `tests/e2e/musicLoops.spec.ts`:

1. Make the `beforeAll` body a function `measure(page, files)`, and call it twice:
   - `measured = await measure(page, WEBM)`;
   - `measuredFlac = await measure(page, FLAC)`.

   Here `WEBM` maps each track to `${track}.webm`, and `FLAC` to `native/${track}.flac`, both read as base64 exactly as today. Chromium's `decodeAudioData` decodes FLAC.
2. Delete everything from the line `// ─── M4A (ALAC)` to the end of the file.
3. Add:

   ```ts
   test("the FLAC music loops join seamlessly, sample for sample with the WebM", () => {
     for (const track of TRACKS) {
       const m = measuredFlac[track];
       expect(m.ratioP95, `${track}.flac steps ${m.ratioP95.toFixed(2)}x the p95 step at the join`).toBeLessThanOrEqual(1);
       expect(m.headMs, `${track}.flac starts with silence`).toBeLessThan(1);
       expect(m.tailMs, `${track}.flac ends with silence`).toBeLessThan(1);
       expect(m.sampleRate).toBe(48000);
       expect(m.channels).toBe(2);
       expect(m.samples, `${track}.flac and ${track}.webm differ in length`).toBe(measured[track].samples);
     }
   });

   test("the FLAC measurement would notice a bad join", () => {
     expect(Math.max(...TRACKS.map((t) => measuredFlac[t].ratioP95))).toBeGreaterThan(0);
   });
   ```

4. Update the header comment's paragraph about #178 to say the native container is FLAC, decoded here directly. That replaces lines rather than adding any.

- [ ] **Step 6: Verify**

Run `node --test tests/tooling/musicAssets.test.ts` (PASS), `npx tsc --noEmit -p .` and `npx eslint lib/device/musicTracks.ts lib/device/musicTracks.web.ts metro.config.js tests/tooling/musicAssets.test.ts tests/e2e/musicLoops.spec.ts tests/native/musicPlatform.test.tsx`. The browser spec and jest run on CI.

- [ ] **Step 7: Commit**

```bash
git add -- assets/music lib/device/musicTracks.ts lib/device/musicTracks.web.ts lib/device/musicTracks.ios.ts metro.config.js tests/tooling/musicAssets.test.ts tests/e2e/musicLoops.spec.ts tests/native/musicPlatform.test.tsx
git commit -m "feat(#1259): native music as 48 kHz FLAC, decoded by the new engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `audioEngine.ts`, its web twin, and one recording mock

**Files:**
- Create:
  - `lib/device/soundAssets.ts`, `lib/device/assetFiles.ts`, `lib/device/audioEngine.ts` and `lib/device/audioEngine.web.ts`;
  - `tests/native/mocks/audioApi.ts` and `tests/native/helpers/feedback.ts`.
- Modify: `tests/native/setup.ts` and `eslint.config.js`
- Test: `tests/native/audioEngine.test.tsx` and `tests/tooling/audioOwners.test.ts`

The old modules keep playing everything until Tasks 9 and 10 move their callers. This task adds the new path beside them, with no app caller yet.

**Interfaces:**
- Produces:
  - from `@/lib/device/soundAssets`: `SOUND_FILES`, `type SoundFile`, `type SoundSpec`, `SOUNDS`, `type SoundId`;
  - from `@/lib/device/assetFiles`: `localFiles(modules: number[]): Promise<string[]>`;
  - from `@/lib/device/audioEngine` (and `.web`):
    - `type Bus`, `type AudioState`, `type EngineStats`, `MUSIC_CROSSFADE_MS`;
    - `startAudio()`, `play(id, { at?, gain?, bus? })`, `ramp(bus, gain, { at?, ms })`, `music(track | null, { crossfadeMs?, at? })`;
    - `setBusTrim(bus, gain)`, `cut(id, at?)`, `durationMs(id)`, `audioState()`, `engineStats()`.
  - from `tests/native/helpers/feedback.ts`: `api()`, `ctxTime(js)`, `ctxAt(js)` (where the engine starts a sound due at `js`, under the fixture's latency), `effects()`, `loops()`, `fileOf(n)`, `soundOf(n)`, `sounds()`, `startsOf(id)`, `appStateHandler()` and `settle(ms?)`.

- [ ] **Step 1: The owners test, reading imports through the compiler**

`tests/tooling/audioOwners.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { moduleEdges } from "../helpers/moduleEdges.ts";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIRS = ["app", "components", "context", "lib", "modules"].filter((d) => existsSync(path.join(repoRoot, d)));

const OWNERS: Record<string, string[]> = {
  "react-native-audio-api": ["lib/device/audioEngine.ts"],
  "modules/murlan-diagnostics": ["lib/diagnostics/probe.ts"],
};

function importers(sources: [string, string][]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const [file, text] of sources) {
    for (const edge of moduleEdges(file, text)) {
      if (edge.via === "mock" || edge.to === file.replace(/\.(tsx?)$/, "")) continue;
      out.set(edge.to, (out.get(edge.to) ?? new Set()).add(file));
    }
  }
  return new Map([...out].map(([to, from]) => [to, [...from].sort()]));
}

test("the scan sees a value import, a relative require and a package, and skips a type-only import", () => {
  const found = importers([
    ["components/x.tsx", 'import { play } from "@/lib/device/audioEngine";'],
    ["lib/device/y.ts", 'import type { Bus } from "./audioEngine";'],
    ["lib/device/w.ts", 'import { type Bus } from "./audioEngine";'],
    ["lib/device/z.ts", 'const m = require("react-native-audio-api");'],
  ]);
  assert.deepEqual(found.get("lib/device/audioEngine"), ["components/x.tsx"]);
  assert.deepEqual(found.get("react-native-audio-api"), ["lib/device/z.ts"]);
});

test("each audio layer is imported by its one owner and nothing else", () => {
  const sources = sourcesUnder(repoRoot, DIRS);
  assert.ok(sources.length > 100, `read ${sources.length} sources — the scan is not reading the tree`);
  const found = importers(sources);
  for (const [target, owners] of Object.entries(OWNERS)) assert.deepEqual(found.get(target) ?? [], owners, target);
});
```

Tasks 6, 7 and 10 each add their rows to `OWNERS`. The first test is the floor: a scan that reads nothing, or counts a type-only import as an edge, is red there.

- [ ] **Step 2: The recording mock**

`tests/native/mocks/audioApi.ts`. Its state lives on `globalThis`, so an engine loaded inside `jest.isolateModules` records into the same place the helpers read:

```ts
export interface ParamEvent {
  kind: "set" | "ramp" | "target" | "cancel" | "hold";
  value: number;
  time: number;
}

export interface MockParam {
  value: number;
  events: ParamEvent[];
  setValueAtTime(v: number, t: number): MockParam;
  linearRampToValueAtTime(v: number, t: number): MockParam;
  setTargetAtTime(v: number, t: number, tau: number): MockParam;
  cancelScheduledValues(t: number): MockParam;
  cancelAndHoldAtTime(t: number): MockParam;
}

export interface MockBuffer {
  path: string;
  duration: number;
  sampleRate: number;
}

export interface MockNode {
  id: number;
  kind: "gain" | "source" | "destination";
  outputs: MockNode[];
  disconnected: boolean;
  gain: MockParam;
  playbackRate: MockParam;
  buffer: MockBuffer | null;
  loop: boolean;
  startedAt?: number;
  stoppedAt?: number;
  onEnded?: unknown;
  connect(to: MockNode): MockNode;
  disconnect(): void;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioApiState {
  log: string[];
  session: unknown[];
  contexts: MockContext[];
  decoded: MockBuffer[];
  nextId: number;
  epoch: number;
  failResumes: number;
  failDecode: boolean;
  durationS: number;
}

export function audioApiState(): AudioApiState {
  const g = globalThis as { __audioApi?: AudioApiState };
  g.__audioApi ??= { log: [], session: [], contexts: [], decoded: [], nextId: 0, epoch: 0, failResumes: 0, failDecode: false, durationS: 1 };
  return g.__audioApi;
}

function param(value: number): MockParam {
  const p: MockParam = {
    value,
    events: [],
    setValueAtTime(v, t) { p.events.push({ kind: "set", value: v, time: t }); p.value = v; return p; },
    linearRampToValueAtTime(v, t) { p.events.push({ kind: "ramp", value: v, time: t }); return p; },
    setTargetAtTime(v, t) { p.events.push({ kind: "target", value: v, time: t }); return p; },
    cancelScheduledValues(t) { p.events.push({ kind: "cancel", value: NaN, time: t }); return p; },
    cancelAndHoldAtTime(t) { p.events.push({ kind: "hold", value: NaN, time: t }); return p; },
  };
  return p;
}

function node(kind: MockNode["kind"], ctx: MockContext | null): MockNode {
  const n: MockNode = {
    id: audioApiState().nextId++,
    kind,
    outputs: [],
    disconnected: false,
    gain: param(1),
    playbackRate: param(1),
    buffer: null,
    loop: false,
    connect(to) { n.outputs.push(to); return to; },
    disconnect() { n.disconnected = true; n.outputs = []; },
    start(when = 0) { n.startedAt = when; },
    stop(when = 0) { n.stoppedAt = when; },
  };
  ctx?.nodes.push(n);
  return n;
}

export class MockContext {
  state: "running" | "suspended" | "closed" = "suspended";
  readonly sampleRate: number;
  readonly destination = node("destination", null);
  readonly nodes: MockNode[] = [];
  private frozenAt: number | null = null;

  constructor(options?: { sampleRate?: number }) {
    const s = audioApiState();
    s.log.push("context");
    this.sampleRate = options?.sampleRate ?? 44100;
    s.contexts.push(this);
  }
  get currentTime(): number {
    return this.frozenAt ?? performance.now() / 1000 + 10;
  }
  freeze(): void {
    this.frozenAt = this.currentTime;
  }
  async resume(): Promise<void> {
    const s = audioApiState();
    if (s.failResumes > 0) {
      s.failResumes--;
      throw new Error("resume refused");
    }
    this.state = "running";
  }
  async suspend(): Promise<void> {
    this.state = "suspended";
  }
  async close(): Promise<void> {
    this.state = "closed";
  }
  createGain(): MockNode {
    return node("gain", this);
  }
  createBufferSource(): MockNode {
    return node("source", this);
  }
}

export function newEpoch(): void {
  const s = audioApiState();
  s.epoch = s.nextId;
  s.failResumes = 0;
  s.failDecode = false;
  s.durationS = 1;
  s.log.length = 0;
  s.session.length = 0;
  for (const c of s.contexts) for (const n of c.nodes) { n.gain.events.length = 0; n.playbackRate.events.length = 0; }
}

export function audioApiModule() {
  const s = audioApiState();
  return {
    __esModule: true,
    AudioContext: MockContext,
    AudioManager: {
      setAudioSessionOptions: (o: unknown) => { s.log.push("session"); s.session.push(o); },
      disableSessionManagement: () => s.log.push("disableSessionManagement"),
      observeAudioInterruptions: () => s.log.push("observeAudioInterruptions"),
    },
    decodeAudioData: async (input: string, sampleRate?: number): Promise<MockBuffer> => {
      if (s.failDecode) throw new Error("decode failed");
      const b = { path: input, duration: s.durationS, sampleRate: sampleRate ?? 48000 };
      s.decoded.push(b);
      return b;
    },
    __mock: s,
  };
}

export function audioSessionModule() {
  const s = audioApiState();
  return {
    __esModule: true,
    default: {
      outputLatencyMs: () => 8,
      ioBufferMs: () => 5,
      preferLowLatency: () => void s.log.push("preferLowLatency"),
    },
  };
}
```

The context's clock is `performance.now()/1000 + 10`. A context built without a rate gets 44.1 kHz, a device rate the engine must not inherit. The session reports an 8 ms output latency and a 5 ms IO buffer, iPhone-like figures chosen here, so a scheduled start lands 10.5 ms early on the context clock and a play more than 5 ms late is dropped. The offset is deliberate: an engine that confused the two clocks would schedule 10 s off, and every timing test would see it. Each decoded buffer lasts `durationS`, 1 s by default. That is this fixture's own number, and the sting tests read it.

In `tests/native/setup.ts`, add `beforeEach` to the `@jest/globals` import, then append:

```ts
// The one mock of each audio layer: every other test reads what it recorded (tests/tooling/oneAudioMock.test.ts).
jest.mock('react-native-audio-api', () => require('./mocks/audioApi').audioApiModule());
jest.mock('@/modules/murlan-audio-session', () => require('./mocks/audioApi').audioSessionModule());
jest.mock('@/lib/device/assetFiles', () => ({
  localFiles: async (modules: number[]) => modules.map((_, i) => `file:///asset-${i}`),
}));
beforeEach(() => {
  require('./mocks/audioApi').newEpoch();
});
```

- [ ] **Step 3: The helpers**

`tests/native/helpers/feedback.ts`:

```ts
import { jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { SOUNDS, SOUND_FILES, type SoundId } from '@/lib/device/soundAssets';
import { TRACKS } from '@/lib/device/musicTracks';
import { audioApiState, type MockNode } from '../mocks/audioApi';

const KEYS = [...Object.keys(SOUND_FILES), ...Object.keys(TRACKS)];

export const api = audioApiState;
export const ctxTime = (jsMs: number) => jsMs / 1000 + 10;
export const ctxAt = (jsMs: number) => ctxTime(jsMs - 8 - 5 / 2);

const sources = () =>
  api().contexts.flatMap((c) => c.nodes).filter((n) => n.kind === 'source' && n.id >= api().epoch && n.startedAt !== undefined);

export const effects = () => sources().filter((n) => !n.loop);
export const loops = () => sources().filter((n) => n.loop);
export const fileOf = (n: MockNode) => (n.buffer ? KEYS[Number(n.buffer.path.slice('file:///asset-'.length))] : undefined);

export function soundOf(n: MockNode): SoundId | undefined {
  const file = fileOf(n);
  const ids = (Object.keys(SOUNDS) as SoundId[]).filter((id) => SOUNDS[id].file === file);
  return ids.find((id) => SOUNDS[id].rate === n.playbackRate.value) ?? ids.find((id) => SOUNDS[id].rate === undefined);
}

export const sounds = () => effects().map(soundOf);
export const startsOf = (id: SoundId) => effects().filter((n) => soundOf(n) === id).map((n) => n.startedAt!);
export const voiceGain = (n: MockNode) => n.outputs[0].gain.value;
export const musicBus = () => loops().at(-1)!.outputs[0].outputs[0];

export function appStateHandler(): (state: string) => void {
  const calls = jest.mocked(AppState.addEventListener).mock.calls.filter(([event]) => event === 'change');
  return calls.at(-1)![1] as (state: string) => void;
}

export const settle = (ms = 0) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
```

`localFiles` is called once, with every effect and then every track, so `asset-i` is `KEYS[i]`. `soundOf` separates `deselect` from `select` by its exact 0.9 rate: a varied select stays within 0.96–1.04.

- [ ] **Step 4: The failing engine test**

`tests/native/audioEngine.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as nativeEngine from '@/lib/device/audioEngine';
import * as webEngine from '@/lib/device/audioEngine.web';
import { SOUND_FILES } from '@/lib/device/soundAssets';
import { api, appStateHandler, ctxTime, effects, fileOf, loops, settle, soundOf, startsOf, voiceGain } from './helpers/feedback';

const sameSurface: typeof nativeEngine = webEngine;
const lastContext = () => api().contexts.at(-1)!;

function isolated(run: (engine: typeof nativeEngine) => Promise<void>): () => Promise<void> {
  return async () => {
    let engine!: typeof nativeEngine;
    jest.isolateModules(() => {
      engine = require('@/lib/device/audioEngine');
    });
    await run(engine);
  };
}

describe('the audio engine', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('has the same surface on web and native', () => {
    expect(Object.keys(sameSurface).sort()).toEqual(Object.keys(nativeEngine).sort());
  });

  it('configures the session once, to mix with other apps, before building its one context', isolated(async (engine) => {
    await engine.startAudio();
    for (let i = 0; i < 20; i++) engine.play('select');
    expect(api().log).toEqual(['session', 'context', 'preferLowLatency']);
    expect(api().session).toEqual([{ iosCategory: 'playback', iosMode: 'default', iosOptions: ['mixWithOthers'] }]);
  }));

  it('builds its context at 48 kHz and decodes every effect and the first two tracks from the files expo-asset wrote', isolated(async (engine) => {
    await engine.startAudio();
    const effectCount = Object.keys(SOUND_FILES).length;
    const mine = api().decoded.slice(-(effectCount + 2));
    expect(mine.map((b) => b.path)).toEqual(Array.from({ length: effectCount + 2 }, (_, i) => `file:///asset-${i}`));
    expect(lastContext().sampleRate).toBe(48000);
    expect(new Set(mine.map((b) => b.sampleRate))).toEqual(new Set([48000]));
    expect(engine.engineStats().resident).toBe(2);
  }));

  it('drops a play before start; after it, one source starts now, through its own gain, with no onEnded', isolated(async (engine) => {
    engine.play('turn');
    expect(effects()).toEqual([]);
    await engine.startAudio();
    engine.play('turn');
    const [s] = effects();
    expect(soundOf(s)).toBe('turn');
    expect(s.startedAt).toBeCloseTo(ctxTime(performance.now()), 3);
    expect(s.onEnded).toBeUndefined();
    expect(s.outputs[0].kind).toBe('gain');
  }));

  it('starts a play given a time one output latency and half an IO buffer early, and drops one more than an IO buffer late', isolated(async (engine) => {
    await engine.startAudio();
    const now = performance.now();
    engine.play('bomb', { at: now + 300, bus: 'sting' });
    engine.play('select', { at: now - 6 });
    engine.play('select', { at: now - 4 });
    engine.play('select', { at: now - 100 });
    expect(startsOf('bomb')).toEqual([expect.closeTo(ctxTime(now + 300 - 8 - 2.5), 3)]);
    expect(startsOf('select')).toEqual([expect.closeTo(ctxTime(now), 3)]);
  }));

  it("frees a played effect's buffer and gain at the next play", isolated(async (engine) => {
    await engine.startAudio();
    engine.play('turn');
    const [first] = effects();
    const voice = first.outputs[0];
    await settle(1100);
    engine.play('turn');
    expect(first.buffer).toBeNull();
    expect(voice.disconnected).toBe(true);
  }));

  it('backgrounding stops what has not started and holds the buses, so nothing bursts out at resume', isolated(async (engine) => {
    await engine.startAudio();
    const now = performance.now();
    engine.play('bomb', { at: now + 500, bus: 'sting' });
    engine.ramp('music', 0.3, { at: now + 500, ms: 60 });
    const [bomb] = effects();
    appStateHandler()('background');
    expect(bomb.stoppedAt).toBeCloseTo(ctxTime(now), 3);
    expect(bomb.buffer).toBeNull();
    const busGains = lastContext().nodes.filter((n) => n.kind === 'gain').filter((_, i) => i % 2 === 1);
    expect(busGains[2].gain.events.slice(-2)).toEqual([
      { kind: 'cancel', value: NaN, time: expect.closeTo(ctxTime(now), 3) },
      { kind: 'set', value: 1, time: expect.closeTo(ctxTime(now), 3) },
    ]);
    await settle();
    expect(lastContext().state).toBe('suspended');
  }));

  it('a play dropped in the foreground because the context stopped wakes the watchdog, at most once per 2 s', isolated(async (engine) => {
    await engine.startAudio();
    const first = lastContext();
    first.state = 'suspended';
    api().failResumes = 1;
    engine.play('turn');
    engine.play('turn');
    await settle(0);
    await settle(500);
    expect(first.state).toBe('closed');
    expect(engine.engineStats().rebuilds).toBe(1);
  }));

  it('a start that failed is retried when the app next becomes active', isolated(async (engine) => {
    api().failDecode = true;
    await engine.startAudio();
    expect(engine.audioState()).toBe('failed');
    api().failDecode = false;
    appStateHandler()('active');
    await engine.startAudio();
    expect(engine.audioState()).toBe('running');
  }));

  it('keeps two tracks decoded, and decodes a third on demand, evicting the least recent', isolated(async (engine) => {
    await engine.startAudio();
    engine.music('menu');
    await settle(1000);
    engine.music('hand');
    await settle(1000);
    const decodedBefore = api().decoded.length;
    engine.music('cue');
    expect(loops().map(fileOf)).toEqual(['menu', 'hand']);
    await settle();
    await settle();
    expect(api().decoded.length).toBe(decodedBefore + 1);
    expect(loops().map(fileOf)).toEqual(['menu', 'hand', 'cue']);
    expect(engine.engineStats().resident).toBe(2);
  }));

  it('varies a repeated effect within ±4 % pitch and ±8 % gain, never past 1; a sting and a deselect stay fixed', isolated(async (engine) => {
    await engine.startAudio();
    for (let i = 0; i < 200; i++) engine.play('reject');
    for (let i = 0; i < 20; i++) engine.play('bomb');
    engine.play('deselect');
    const rejects = effects().filter((n) => soundOf(n) === 'reject');
    const rates = rejects.map((n) => n.playbackRate.value);
    expect(Math.min(...rates)).toBeGreaterThanOrEqual(0.96 - 1e-9);
    expect(Math.max(...rates)).toBeLessThanOrEqual(1.04 + 1e-9);
    expect(new Set(rates).size).toBeGreaterThan(1);
    for (const n of rejects) {
      expect(voiceGain(n)).toBeGreaterThanOrEqual(0.7 * 0.92 - 1e-9);
      expect(voiceGain(n)).toBeLessThanOrEqual(0.7 * 1.08 + 1e-9);
    }
    expect(new Set(effects().filter((n) => soundOf(n) === 'bomb').map((n) => n.playbackRate.value))).toEqual(new Set([1]));
    const [deselect] = effects().filter((n) => soundOf(n) === 'deselect');
    expect([deselect.playbackRate.value, voiceGain(deselect)]).toEqual([0.9, 0.75]);
  }));

  it('drops a play while the context is not running, and does not queue it', isolated(async (engine) => {
    await engine.startAudio();
    lastContext().state = 'suspended';
    engine.play('turn');
    lastContext().state = 'running';
    await settle(1000);
    expect(effects()).toEqual([]);
  }));

  it('music asked for before start begins once started, looped, from its track', isolated(async (engine) => {
    engine.music('menu');
    await engine.startAudio();
    expect(loops().map(fileOf)).toEqual(['menu']);
  }));

  it('a switch crossfades over 600 ms at one time, and stops the old deck at the fade end', isolated(async (engine) => {
    await engine.startAudio();
    engine.music('menu');
    await settle(1000);
    const t = ctxTime(performance.now());
    engine.music('hand');
    const [menu, hand] = loops();
    expect(menu.outputs[0].gain.events).toEqual([
      { kind: 'hold', value: NaN, time: expect.closeTo(t, 3) },
      { kind: 'ramp', value: 0, time: expect.closeTo(t + 0.6, 3) },
    ]);
    expect(menu.stoppedAt).toBeCloseTo(t + 0.6, 3);
    expect(hand.outputs[0].gain.events).toEqual([
      { kind: 'set', value: 0, time: expect.closeTo(t, 3) },
      { kind: 'ramp', value: 1, time: expect.closeTo(t + 0.6, 3) },
    ]);
  }));

  it('a second switch mid-fade holds the first fade where it is, and retired decks are freed once faded', isolated(async (engine) => {
    await engine.startAudio();
    engine.music('menu');
    await settle(1000);
    engine.music('hand');
    await settle(200);
    const t2 = ctxTime(performance.now());
    engine.music('menu');
    const [menu, hand] = loops();
    expect(hand.outputs[0].gain.events.slice(2)).toEqual([
      { kind: 'hold', value: NaN, time: expect.closeTo(t2, 3) },
      { kind: 'ramp', value: 0, time: expect.closeTo(t2 + 0.6, 3) },
    ]);
    await settle(1000);
    const [menuGain, handGain] = [menu.outputs[0], hand.outputs[0]];
    engine.music('hand');
    expect([menuGain.disconnected, handGain.disconnected]).toEqual([true, true]);
    expect([menu.buffer, hand.buffer]).toEqual([null, null]);
  }));

  it('a context that does not run after the app returns is rebuilt, and the wanted track restarts in it', isolated(async (engine) => {
    await engine.startAudio();
    engine.music('menu');
    const first = lastContext();
    first.state = 'suspended';
    api().failResumes = 1;
    appStateHandler()('active');
    await settle(0);
    await settle(500);
    expect(first.state).toBe('closed');
    expect(lastContext()).not.toBe(first);
    expect(lastContext().state).toBe('running');
    expect(loops().filter((n) => api().contexts.at(-1)!.nodes.includes(n)).map(fileOf)).toEqual(['menu']);
    expect(engine.audioState()).toBe('running');
  }));

  it('a context that reports running with a clock that stands still is rebuilt too', isolated(async (engine) => {
    await engine.startAudio();
    const first = lastContext();
    first.freeze();
    appStateHandler()('active');
    await settle(0);
    await settle(500);
    expect(first.state).toBe('closed');
    expect(lastContext()).not.toBe(first);
  }));

  it('a failed start leaves play harmless', isolated(async (engine) => {
    api().failDecode = true;
    await expect(engine.startAudio()).resolves.toBeUndefined();
    expect(() => engine.play('bomb')).not.toThrow();
    expect(effects()).toEqual([]);
    expect(engine.audioState()).toBe('failed');
  }));

  it('a trim set before start is the bus level once the context runs', isolated(async (engine) => {
    engine.setBusTrim('music', 0.5);
    await engine.startAudio();
    engine.music('menu');
    const bus = loops()[0].outputs[0].outputs[0];
    expect(bus.outputs[0].gain.value).toBe(0.5);
  }));
});
```

The numbers are the spec's:

- ±4 % and ±8 % around 0.7, and never above 1, are today's `lib/device/sounds.ts:282-296` and `:336`;
- 600 ms, 500 ms and 250 ms are design §1 and this plan's watchdog;
- 8 ms, 5 ms and 1 s are the fixture's latency, IO buffer and clip length (Step 2), never the engine's constants;
- the decode count is the effect files the test reads from `SOUND_FILES`, plus the two resident tracks.

The `NaN` in `hold` events matches, because `toEqual` treats `NaN` as equal to `NaN`.

- [ ] **Step 5: Run and watch them fail**

Run `node --test tests/tooling/audioOwners.test.ts`. Expected: the floor passes, and "each audio layer…" fails on `react-native-audio-api`, which nothing imports yet.

`npx tsc --noEmit -p .` fails on the missing modules. jest runs on CI.

- [ ] **Step 6: The assets, the file seam and the engine**

`lib/device/assetFiles.ts`:

```ts
import { Asset } from "expo-asset";

export async function localFiles(modules: number[]): Promise<string[]> {
  return (await Asset.loadAsync(modules)).map((a) => a.localUri ?? a.uri);
}
```

`lib/device/soundAssets.ts`:

```ts
export const SOUND_FILES = {
  select: () => require("../../assets/sounds/select.mp3") as number,
  play: () => require("../../assets/sounds/play.mp3") as number,
  combo: () => require("../../assets/sounds/combo.mp3") as number,
  pass: () => require("../../assets/sounds/pass.mp3") as number,
  bomb: () => require("../../assets/sounds/bomb.mp3") as number,
  deal: () => require("../../assets/sounds/deal.mp3") as number,
  exchange: () => require("../../assets/sounds/exchange.mp3") as number,
  turn: () => require("../../assets/sounds/turn.mp3") as number,
  clock_running_out: () => require("../../assets/sounds/clock_running_out.mp3") as number,
  manche_won: () => require("../../assets/sounds/manche_won.mp3") as number,
  manche_lost: () => require("../../assets/sounds/manche_lost.mp3") as number,
  partita_won: () => require("../../assets/sounds/partita_won.mp3") as number,
  partita_lost: () => require("../../assets/sounds/partita_lost.mp3") as number,
  round_start: () => require("../../assets/sounds/round_start.mp3") as number,
  round_win: () => require("../../assets/sounds/round_win.mp3") as number,
  reject: () => require("../../assets/sounds/reject.mp3") as number,
  seat_fill: () => require("../../assets/sounds/seat_fill.mp3") as number,
  room_full: () => require("../../assets/sounds/room_full.mp3") as number,
} as const;

export type SoundFile = keyof typeof SOUND_FILES;

export interface SoundSpec {
  file: SoundFile;
  gain: number;
  rate?: number;
  vary?: true;
}

const SPECS = {
  select: { file: "select", gain: 1, vary: true },
  deselect: { file: "select", gain: 0.75, rate: 0.9 },
  play: { file: "play", gain: 1, vary: true },
  combo: { file: "combo", gain: 1, vary: true },
  pass: { file: "pass", gain: 1, vary: true },
  deal: { file: "deal", gain: 1, vary: true },
  reject: { file: "reject", gain: 0.7, vary: true },
  bomb: { file: "bomb", gain: 1 },
  exchange: { file: "exchange", gain: 1 },
  turn: { file: "turn", gain: 1 },
  clockRunningOut: { file: "clock_running_out", gain: 1 },
  mancheWon: { file: "manche_won", gain: 1 },
  mancheLost: { file: "manche_lost", gain: 1 },
  partitaWon: { file: "partita_won", gain: 1 },
  partitaLost: { file: "partita_lost", gain: 1 },
  round_start: { file: "round_start", gain: 0.85 },
  round_win: { file: "round_win", gain: 1 },
  seat_fill: { file: "seat_fill", gain: 0.8 },
  room_full: { file: "room_full", gain: 0.85 },
} as const satisfies Record<string, SoundSpec>;

export type SoundId = keyof typeof SPECS;
export const SOUNDS: Record<SoundId, SoundSpec> = SPECS;
```

The gains, the deselect's rate and which effects vary are today's `lib/device/sounds.ts:316-336`. `reconnected` is left out: it never had a caller, and Task 10 deletes its file.

`lib/device/audioEngine.ts`:

```ts
import { AppState } from "react-native";
import { AudioContext, AudioManager, decodeAudioData, type AudioBuffer, type AudioBufferSourceNode, type GainNode } from "react-native-audio-api";
import session from "@/modules/murlan-audio-session";
import { DIAGNOSTICS, diag } from "@/lib/diagnostics";
import { localFiles } from "./assetFiles";
import { SOUNDS, SOUND_FILES, type SoundFile, type SoundId } from "./soundAssets";
import { TRACKS, type TrackId } from "./musicTracks";

export type Bus = "sfx" | "sting" | "music";
export type AudioState = "running" | "suspended" | "failed";
export interface EngineStats {
  audioMs: number;
  plays: number;
  dropped: number;
  rebuilds: number;
  resident: number;
}

export const MUSIC_CROSSFADE_MS = 600;
const SAMPLE_RATE = 48000;
const RESIDENT_TRACKS = 2;
const FALLBACK_LATE_MS = 10;
const LEAD_TTL_MS = 1000;
const NUDGE_MS = 2000;
const GAIN_JITTER = 0.08;
const PITCH_JITTER = 0.04;
const TRIM_TAU_S = 0.05;
const WATCHDOG_MS = 500;
const WATCHDOG_MIN_ADVANCE_S = 0.25;
const BUSES: Bus[] = ["sfx", "sting", "music"];
const FILES = Object.keys(SOUND_FILES) as SoundFile[];
const TRACK_IDS = Object.keys(TRACKS) as TrackId[];

interface Graph {
  ctx: AudioContext;
  buses: Record<Bus, { trim: GainNode; gain: GainNode }>;
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  startsAt: number;
  endsAt: number;
}

interface Deck extends Voice {
  track: TrackId;
}

let graph: Graph | null = null;
let boot: Promise<void> | null = null;
let rebuilding: Promise<void> | null = null;
let ready = false;
let failed = false;
let listening = false;
let lastNudge = -Infinity;
let deck: Deck | null = null;
let wanted: TrackId | null = null;
let retired: Voice[] = [];
let voices: Voice[] = [];
let lead = { ms: 0, lateMs: FALLBACK_LATE_MS, at: -Infinity };
const trims: Record<Bus, number> = { sfx: 1, sting: 1, music: 1 };
const effects = new Map<SoundFile, AudioBuffer>();
const trackUris = new Map<TrackId, string>();
const tracks = new Map<TrackId, AudioBuffer>();
const decoding = new Map<TrackId, Promise<void>>();
const lastVoice = new Map<SoundId, AudioBufferSourceNode>();
const stats = { plays: 0, dropped: 0, rebuilds: 0 };

const jitter = (spread: number) => 1 + (Math.random() * 2 - 1) * spread;
const running = (g: Graph | null): g is Graph => g !== null && g.ctx.state === "running";

function build(): Graph {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const buses = {} as Graph["buses"];
  for (const bus of BUSES) {
    const trim = ctx.createGain();
    const gain = ctx.createGain();
    trim.gain.value = trims[bus];
    gain.connect(trim);
    trim.connect(ctx.destination);
    buses[bus] = { trim, gain };
  }
  return { ctx, buses };
}

async function resumeInto(g: Graph): Promise<boolean> {
  try {
    await g.ctx.resume();
  } catch {
    return false;
  }
  if (g.ctx.state !== "running") return false;
  session?.preferLowLatency();
  lead.at = -Infinity;
  return true;
}

function listen(): void {
  if (listening) return;
  listening = true;
  AppState.addEventListener("change", (state) => {
    if (state === "active") void wake();
    else if (state === "background") sleep();
  });
}

function load(track: TrackId): Promise<void> {
  if (tracks.has(track)) {
    const buffer = tracks.get(track)!;
    tracks.delete(track);
    tracks.set(track, buffer);
    return Promise.resolve();
  }
  let pending = decoding.get(track);
  if (!pending) {
    for (const victim of tracks.keys()) {
      if (tracks.size < RESIDENT_TRACKS) break;
      if (victim !== deck?.track) tracks.delete(victim);
    }
    pending = decodeAudioData(trackUris.get(track)!, SAMPLE_RATE)
      .then((buffer) => void tracks.set(track, buffer))
      .finally(() => decoding.delete(track));
    decoding.set(track, pending);
  }
  return pending;
}

async function start(): Promise<void> {
  listen();
  AudioManager.setAudioSessionOptions({ iosCategory: "playback", iosMode: "default", iosOptions: ["mixWithOthers"] });
  try {
    const old = graph;
    graph = null;
    await old?.ctx.close().catch(() => {});
    const g = build();
    graph = g;
    if (!(await resumeInto(g))) throw new Error("the audio context did not start");
    // A module id reaches the decoder as base64 over the bridge in an Android release; a file:// path decodes natively.
    const uris = await localFiles([...FILES.map((f) => SOUND_FILES[f]()), ...TRACK_IDS.map((t) => TRACKS[t]())]);
    const decoded = await Promise.all(uris.slice(0, FILES.length).map((uri) => decodeAudioData(uri, SAMPLE_RATE)));
    FILES.forEach((f, i) => effects.set(f, decoded[i]));
    TRACK_IDS.forEach((t, i) => trackUris.set(t, uris[FILES.length + i]));
    await Promise.all(TRACK_IDS.slice(0, RESIDENT_TRACKS).map(load));
    ready = true;
    failed = false;
  } catch {
    failed = true;
    return;
  }
  music(wanted);
}

export function startAudio(): Promise<void> {
  boot ??= start();
  return boot;
}

function rebuild(): Promise<void> {
  rebuilding ??= (async () => {
    const old = graph;
    graph = null;
    deck = null;
    retired = [];
    voices = [];
    lastVoice.clear();
    // Android opens the new output stream only once the old one is closed.
    await old?.ctx.close().catch(() => {});
    const g = build();
    if (!(await resumeInto(g))) {
      await g.ctx.close().catch(() => {});
      return;
    }
    graph = g;
    stats.rebuilds++;
    music(wanted);
  })().finally(() => {
    rebuilding = null;
  });
  return rebuilding;
}

async function wake(): Promise<void> {
  if (failed) {
    boot = null;
    return startAudio();
  }
  if (!ready) return;
  const g = graph;
  if (!g) return rebuild();
  await resumeInto(g);
  const before = g.ctx.currentTime;
  setTimeout(() => {
    if (graph !== g) return;
    if (running(g) && g.ctx.currentTime - before >= WATCHDOG_MIN_ADVANCE_S) {
      for (const bus of BUSES) g.buses[bus].trim.gain.setValueAtTime(trims[bus], g.ctx.currentTime);
      music(wanted);
    } else void rebuild();
  }, WATCHDOG_MS);
}

function nudge(): void {
  const now = performance.now();
  if (boot === null || AppState.currentState !== "active" || now - lastNudge < NUDGE_MS) return;
  lastNudge = now;
  void wake();
}

function sleep(): void {
  const g = graph;
  if (!g) return;
  if (running(g)) {
    const now = g.ctx.currentTime;
    const unstarted = [...voices, ...(deck ? [deck] : [])].filter((v) => v.startsAt > now);
    for (const v of unstarted) {
      v.source.stop(now);
      v.source.buffer = null;
      v.gain.disconnect();
    }
    voices = voices.filter((v) => !unstarted.includes(v));
    if (deck && unstarted.includes(deck)) deck = null;
    for (const bus of BUSES) {
      g.buses[bus].gain.gain.cancelScheduledValues(now);
      g.buses[bus].gain.gain.setValueAtTime(1, now);
    }
  }
  void g.ctx.suspend().catch(() => {});
}

function sweep(now: number): void {
  const done = (v: Voice) => {
    if (v.endsAt > now) return false;
    v.source.buffer = null;
    v.gain.disconnect();
    return true;
  };
  voices = voices.filter((v) => !done(v));
  retired = retired.filter((v) => !done(v));
}

function outputLead(): { ms: number; lateMs: number } {
  const now = performance.now();
  if (now - lead.at > LEAD_TTL_MS) {
    const io = session?.ioBufferMs() ?? 0;
    lead = { ms: (session?.outputLatencyMs() ?? 0) + io / 2, lateMs: io > 0 ? io : FALLBACK_LATE_MS, at: now };
  }
  return lead;
}

// A sample reaches the speaker one output latency, plus half an IO buffer on average, after its context time.
function when(ctx: AudioContext, at: number | undefined): number | null {
  if (at === undefined) return ctx.currentTime;
  const { ms, lateMs } = outputLead();
  const ahead = at - performance.now();
  if (ahead < -lateMs) return null;
  return ctx.currentTime + Math.max(0, ahead - ms) / 1000;
}

export function play(id: SoundId, o: { at?: number; gain?: number; bus?: Bus } = {}): void {
  const g = graph;
  const spec = SOUNDS[id];
  const buffer = effects.get(spec.file);
  const t = running(g) && buffer ? when(g.ctx, o.at) : null;
  if (DIAGNOSTICS) {
    const leadMs = o.at === undefined ? 0 : outputLead().ms;
    diag({ k: "play", t: performance.now(), id, at: o.at ?? performance.now(), lead: leadMs, bus: o.bus ?? "sfx", dropped: t === null });
  }
  if (t === null || !g || !buffer) {
    stats.dropped++;
    if (!running(g)) nudge();
    return;
  }
  sweep(g.ctx.currentTime);
  const source = g.ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = (spec.rate ?? 1) * (spec.vary ? jitter(PITCH_JITTER) : 1);
  const voice = g.ctx.createGain();
  voice.gain.value = Math.min(1, spec.gain * (o.gain ?? 1) * (spec.vary ? jitter(GAIN_JITTER) : 1));
  source.connect(voice);
  voice.connect(g.buses[o.bus ?? "sfx"].gain);
  // No onEnded: a JS callback per effect is a bridge crossing per play; sweep() frees finished voices instead.
  source.start(t);
  voices.push({ source, gain: voice, startsAt: t, endsAt: t + buffer.duration / source.playbackRate.value });
  lastVoice.set(id, source);
  stats.plays++;
}

export function ramp(bus: Bus, gain: number, o: { at?: number; ms: number }): void {
  const g = graph;
  if (!running(g)) return;
  const now = g.ctx.currentTime;
  const t = Math.max(now, when(g.ctx, o.at) ?? now);
  const param = g.buses[bus].gain.gain;
  param.cancelAndHoldAtTime(t);
  param.linearRampToValueAtTime(gain, t + o.ms / 1000);
}

export function music(track: TrackId | null, o: { crossfadeMs?: number; at?: number } = {}): void {
  wanted = track;
  const g = graph;
  if (!running(g) || (deck?.track ?? null) === track) return;
  if (track !== null && !tracks.has(track)) {
    void load(track).then(() => {
      if (wanted === track) music(track, o);
    }, () => {});
    return;
  }
  const now = g.ctx.currentTime;
  const t = Math.max(now, when(g.ctx, o.at) ?? now);
  const fade = (o.crossfadeMs ?? MUSIC_CROSSFADE_MS) / 1000;
  sweep(now);
  if (deck) {
    deck.gain.gain.cancelAndHoldAtTime(t);
    deck.gain.gain.linearRampToValueAtTime(0, t + fade);
    deck.source.stop(t + fade);
    retired.push({ ...deck, endsAt: t + fade });
    deck = null;
  }
  if (track === null) return;
  void load(track);
  const gain = g.ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(1, t + fade);
  gain.connect(g.buses.music.gain);
  const source = g.ctx.createBufferSource();
  source.buffer = tracks.get(track)!;
  source.loop = true;
  source.connect(gain);
  source.start(t);
  deck = { track, gain, source, startsAt: t, endsAt: Infinity };
  if (DIAGNOSTICS) diag({ k: "music", t: performance.now(), track, at: o.at ?? performance.now() });
}

export function setBusTrim(bus: Bus, gain: number): void {
  trims[bus] = gain;
  const g = graph;
  if (running(g)) g.buses[bus].trim.gain.setTargetAtTime(gain, g.ctx.currentTime, TRIM_TAU_S);
}

export function cut(id: SoundId, at?: number): void {
  const g = graph;
  const source = lastVoice.get(id);
  if (!running(g) || !source) return;
  try {
    source.stop(Math.max(g.ctx.currentTime, when(g.ctx, at) ?? 0));
  } catch {}
}

export function durationMs(id: SoundId): number {
  const buffer = effects.get(SOUNDS[id].file);
  return buffer ? (buffer.duration * 1000) / (SOUNDS[id].rate ?? 1) : 0;
}

export function audioState(): AudioState {
  if (failed) return "failed";
  const g = graph;
  if (!g || !ready) return "suspended";
  return g.ctx.state === "running" ? "running" : g.ctx.state === "closed" ? "failed" : "suspended";
}

export function engineStats(): EngineStats {
  return { audioMs: graph ? graph.ctx.currentTime * 1000 : 0, ...stats, resident: tracks.size };
}
```

Notes on the shape:

- **A trim set while the context is not running** is stored, never sent: `ramp`, `setBusTrim` and `cut` take the library's driver mutex, so they skip a context that is not running. A new graph is built with the stored trims (`build()` reads `trims`), and a woken one gets them re-applied. The last test pins the first case.
- **The music memory.** The shipped loops hold 3 × 1,315,611 frames × 2 channels × 4 bytes. That is 10.5 MB each, and 31.6 MB for all three. The engine keeps two decoded: the current track and the most recent other. The third is decoded on demand, on the library's decoder thread, never on JS, and the least recently used track is evicted first. So the steady state is 21 MB. It peaks at 31.6 MB only while a decode overlaps the fade of the track it replaces. A switch to a track that is not resident starts once the decode resolves; the old deck keeps playing meanwhile, so there is no silence.
- **Freeing voices.** `setBuffer(null)` hands the buffer to the graph manager for destruction (`AudioBufferSourceNode.cpp:68-70`), and a finished node otherwise keeps it. `sweep()` sets `buffer = null` and disconnects the voice gain on every effect whose end has passed and every retired deck whose fade has ended. It runs at each play and each switch, so what lingers is at most the voices since the last one.
- **Backgrounding.** A source scheduled before a suspend starts as soon as its start frame is behind the render clock (`AudioScheduledSourceNode.cpp:78`, `startFrame = max(start, firstFrame)`), so after a resume every pending start would burst out at once. `sleep()` stops and empties every voice and deck that has not started, and holds every bus at 1 with its ramps cancelled, before it suspends.
- **The watchdog.** It also wakes when a play is dropped because the context is not running while the app is in the foreground (`nudge`, at most once per 2 s). A failed start is retried on the next `active`. The AppState listener is registered before anything in `start()` can fail.
- **A rebuild makes a new worklet runtime.** `new AudioContext()` always calls `AudioAPIModule.createAudioRuntime()` (`src/core/AudioContext.ts:22`), and the public API has no way to pass one in. It is accepted, because a rebuild happens only when the watchdog finds a dead context.
- **One rate.** Every context is built at 48 kHz, the rate the FLAC files and the effects decode at, so nothing resamples when a context is rebuilt at a different device rate.

`modules/murlan-audio-session` is the engine's second native dependency, iOS-only and production. `requireOptionalNativeModule` returns `null` on Android and web, and there the lead is 0 and the late-drop is 10 ms:

`modules/murlan-audio-session/expo-module.config.json`:

```json
{
  "platforms": ["apple"],
  "apple": { "modules": ["MurlanAudioSessionModule"] }
}
```

`modules/murlan-audio-session/index.ts`:

```ts
import { requireOptionalNativeModule } from "expo";

export interface MurlanAudioSession {
  outputLatencyMs(): number;
  ioBufferMs(): number;
  preferLowLatency(): void;
}

export default requireOptionalNativeModule<MurlanAudioSession>("MurlanAudioSession");
```

`modules/murlan-audio-session/ios/MurlanAudioSession.podspec` is `MurlanDiagnostics.podspec` (Task 3) with the name `MurlanAudioSession`, the summary "Output latency and IO buffer for the audio engine", and `s.frameworks = 'AVFAudio'`.

`modules/murlan-audio-session/ios/MurlanAudioSessionModule.swift`:

```swift
import AVFAudio
import ExpoModulesCore

public final class MurlanAudioSessionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MurlanAudioSession")

    Function("outputLatencyMs") { () -> Double in AVAudioSession.sharedInstance().outputLatency * 1000 }
    Function("ioBufferMs") { () -> Double in AVAudioSession.sharedInstance().ioBufferDuration * 1000 }
    Function("preferLowLatency") { try? AVAudioSession.sharedInstance().setPreferredIOBufferDuration(0.005) }
  }
}
```

The library never sets `preferredIOBufferDuration`. A search of its `ios/` and `common/` trees finds only a log line (`AudioEngine.mm:592`) and miniaudio's device backend, which the library does not open. The preference is re-applied after every resume that runs (`resumeInto`), because the library activates the session on resume, and a preference survives category changes but is only honoured by an active session.

Add it as an owner row (`"modules/murlan-audio-session": ["lib/device/audioEngine.ts"]`) to `tests/tooling/audioOwners.test.ts` and to `GROUP_OWNERS` in Step 7. Add `modules/murlan-audio-session/ios/MurlanAudioSessionModule.swift` to `tests/tooling/gitignoreNativeDirs.test.ts`'s not-ignored assertions; the anchored patterns from Task 3 already cover it. ci.yml's `ios-build` "The diagnostics module is registered" step also greps the provider for `MurlanAudioSessionModule`.

**Guard #1238.** `-[AudioEngine startEngine]` (`AudioEngine.mm:494-495`) and the restart after an interruption (`AudioEngine.mm:397-398`) call `startAndReturnError:` and check only the `NSError`. When AVAudioEngine throws an Objective-C exception instead, it unwinds past the promise thread (`AudioContextHostObject.cpp:43`) and the app aborts (upstream #1238, open). JS cannot catch it: no JS frame is on that stack. Only native code can, so this task patches the library with the repo's existing `patch-package` (`package.json` `postinstall`). Edit `node_modules/react-native-audio-api/ios/audioapi/ios/system/AudioEngine.mm` with the Edit tool, wrapping each of the two calls:

```objc
  @try {
    [self.audioEngine startAndReturnError:&error];
  } @catch (NSException *exception) {
    NSLog(@"AVAudioEngine threw starting: %@", exception.reason);
    error = [NSError errorWithDomain:@"RNAudioAPI" code:1238 userInfo:nil];
  }
```

Setting `error` sends both sites down their existing failure branch. At `:495` that is `return false`, which the host object turns into a rejected `resume()` (`AudioContextHostObject.cpp:49`); `resumeInto` then reports `false`, and the engine reports `failed` or rebuilds. Then run `npx patch-package react-native-audio-api`, which writes `patches/react-native-audio-api+0.13.6.patch`. `tests/tooling/audioApiPatch.test.ts` pins it:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENGINE = "node_modules/react-native-audio-api/ios/audioapi/ios/system/AudioEngine.mm";

test("every AVAudioEngine start in the installed library is inside @try (#1238)", () => {
  assert.ok(existsSync(path.join(repoRoot, "patches/react-native-audio-api+0.13.6.patch")), "the patch is not committed");
  const source = readFileSync(path.join(repoRoot, ENGINE), "utf8");
  const starts = source.match(/\[self\.audioEngine startAndReturnError:&error\];/g) ?? [];
  const guarded = source.match(/@try \{\s*\[self\.audioEngine startAndReturnError:&error\];\s*\} @catch \(NSException \*exception\)/g) ?? [];
  assert.equal(starts.length, 2, "the library's start sites moved; re-read AudioEngine.mm before trusting the patch");
  assert.equal(guarded.length, starts.length);
});
```

The count of 2 is the floor: a library update that moves or adds a start site fails here instead of passing unguarded.

`lib/device/audioEngine.web.ts` keeps today's web rules, from `lib/device/sounds.ts:11-160` and `lib/device/music.ts:57-150`:

- the context is built inside the gesture, and the listeners stay bound (Safari's `interrupted` state);
- `navigator.audioSession.type = "playback"`;
- only the wanted track and the one it replaces stay decoded;
- the music is a pump of one-shots (#96).

It adds the time mapping through `getOutputTimestamp()`, the 40 ms drop, and a hidden tab dropping plays.

```ts
import { SOUNDS, SOUND_FILES, type SoundFile, type SoundId } from "./soundAssets";
import { TRACKS, type TrackId } from "./musicTracks";

export type Bus = "sfx" | "sting" | "music";
export type AudioState = "running" | "suspended" | "failed";
export interface EngineStats {
  audioMs: number;
  plays: number;
  dropped: number;
  rebuilds: number;
  resident: number;
}

export const MUSIC_CROSSFADE_MS = 600;
const LATE_S = 0.01;
const LOOKAHEAD_S = 2;
const START_MARGIN_S = 0.05;
const GAIN_JITTER = 0.08;
const PITCH_JITTER = 0.04;
const BUSES: Bus[] = ["sfx", "sting", "music"];
const FILES = Object.keys(SOUND_FILES) as SoundFile[];
const TRACK_IDS = Object.keys(TRACKS) as TrackId[];

interface Deck {
  track: TrackId;
  gain: GainNode;
  sources: AudioBufferSourceNode[];
  next: number;
  timer?: ReturnType<typeof setInterval>;
}

let ctx: AudioContext | null = null;
let bound = false;
let deck: Deck | null = null;
let wanted: TrackId | null = null;
const trims: Record<Bus, number> = { sfx: 1, sting: 1, music: 1 };
const nodes = {} as Record<Bus, { trim: GainNode; gain: GainNode }>;
const fetched = new Map<number, Promise<ArrayBuffer | null>>();
const decoded = new Map<number, Promise<AudioBuffer | null>>();
const buffers = new Map<SoundFile, AudioBuffer>();
const lastVoice = new Map<SoundId, AudioBufferSourceNode>();
const stats = { plays: 0, dropped: 0, rebuilds: 0 };

const jitter = (spread: number) => 1 + (Math.random() * 2 - 1) * spread;

function fetchOnce(file: number): Promise<ArrayBuffer | null> {
  let bytes = fetched.get(file);
  if (!bytes) {
    bytes = fetch(file as unknown as string).then((r) => r.arrayBuffer()).catch(() => null);
    fetched.set(file, bytes);
  }
  return bytes;
}

function decode(c: AudioContext, file: number): Promise<AudioBuffer | null> {
  let buffer = decoded.get(file);
  if (!buffer) {
    // decodeAudioData detaches what it is given; the copy keeps the fetch reusable.
    buffer = fetchOnce(file).then((b) => (b ? c.decodeAudioData(b.slice(0)) : null)).catch(() => null);
    decoded.set(file, buffer);
  }
  return buffer;
}

function build(): AudioContext | null {
  if (ctx) return ctx;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  const c = new Ctor();
  for (const bus of BUSES) {
    const trim = c.createGain();
    const gain = c.createGain();
    trim.gain.value = trims[bus];
    gain.connect(trim);
    trim.connect(c.destination);
    nodes[bus] = { trim, gain };
  }
  for (const f of FILES) void decode(c, SOUND_FILES[f]()).then((b) => b && buffers.set(f, b));
  ctx = c;
  return c;
}

// Safari honours resume() only synchronously inside the gesture, so the context is built here and nowhere else.
function unlock(): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = "playback";
  const c = build();
  if (!c) return;
  if (c.state !== "running") void c.resume();
  music(wanted);
}

export function startAudio(): Promise<void> {
  if (typeof document === "undefined" || bound) return Promise.resolve();
  bound = true;
  for (const e of ["pointerdown", "touchend", "keydown"]) document.addEventListener(e, unlock, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (ctx) void (document.hidden ? ctx.suspend() : ctx.resume());
  });
  return Promise.all(FILES.map((f) => fetchOnce(SOUND_FILES[f]()))).then(() => undefined);
}

function contextTime(c: AudioContext, at: number | undefined): number | null {
  if (at === undefined) return c.currentTime;
  const stamp = c.getOutputTimestamp?.();
  const t = stamp?.performanceTime
    ? (stamp.contextTime ?? 0) + (at - stamp.performanceTime) / 1000
    : c.currentTime + (at - performance.now()) / 1000;
  return t < c.currentTime - LATE_S ? null : Math.max(t, c.currentTime);
}

export function play(id: SoundId, o: { at?: number; gain?: number; bus?: Bus } = {}): void {
  const c = ctx;
  const spec = SOUNDS[id];
  const buffer = buffers.get(spec.file);
  const t = c && buffer && !document.hidden && c.state === "running" ? contextTime(c, o.at) : null;
  if (t === null || !c || !buffer) {
    stats.dropped++;
    return;
  }
  const source = c.createBufferSource();
  const gain = c.createGain();
  source.buffer = buffer;
  source.playbackRate.value = (spec.rate ?? 1) * (spec.vary ? jitter(PITCH_JITTER) : 1);
  gain.gain.value = Math.min(1, spec.gain * (o.gain ?? 1) * (spec.vary ? jitter(GAIN_JITTER) : 1));
  source.connect(gain);
  gain.connect(nodes[o.bus ?? "sfx"].gain);
  source.start(t);
  lastVoice.set(id, source);
  stats.plays++;
}

export function ramp(bus: Bus, gain: number, o: { at?: number; ms: number }): void {
  const c = ctx;
  if (!c) return;
  const t = contextTime(c, o.at) ?? c.currentTime;
  const param = nodes[bus].gain.gain;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
  }
  param.linearRampToValueAtTime(gain, t + o.ms / 1000);
}

function retire(d: Deck, t: number, fade: number): void {
  if (d.timer) clearInterval(d.timer);
  d.gain.gain.cancelScheduledValues(t);
  d.gain.gain.setValueAtTime(d.gain.gain.value, t);
  d.gain.gain.linearRampToValueAtTime(0, t + fade);
  for (const s of d.sources) s.stop(t + fade);
}

export function music(track: TrackId | null, o: { crossfadeMs?: number; at?: number } = {}): void {
  wanted = track;
  const c = ctx;
  if (!c || (deck?.track ?? null) === track) return;
  const fade = (o.crossfadeMs ?? MUSIC_CROSSFADE_MS) / 1000;
  const t = contextTime(c, o.at) ?? c.currentTime;
  const old = deck;
  if (old) retire(old, t, fade);
  deck = null;
  if (track === null) return;
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.connect(nodes.music.gain);
  const d: Deck = { track, gain, sources: [], next: 0 };
  deck = d;
  for (const other of TRACK_IDS) if (other !== track && other !== old?.track) decoded.delete(TRACKS[other]());
  void decode(c, TRACKS[track]()).then((buffer) => {
    if (!buffer || deck !== d) return;
    d.next = Math.max(t, c.currentTime + START_MARGIN_S);
    gain.gain.setValueAtTime(0, d.next);
    gain.gain.linearRampToValueAtTime(1, d.next + fade);
    // Successive one-shots at computed times, not `loop = true` (#96): a timer only queues, never times.
    const pump = () => {
      while (d.next < c.currentTime + LOOKAHEAD_S) {
        const s = c.createBufferSource();
        s.buffer = buffer;
        s.connect(gain);
        s.onended = () => d.sources.splice(d.sources.indexOf(s), 1);
        s.start(d.next);
        d.sources.push(s);
        d.next += buffer.duration;
      }
    };
    pump();
    d.timer = setInterval(pump, (LOOKAHEAD_S / 2) * 1000);
  });
}

export function setBusTrim(bus: Bus, gain: number): void {
  trims[bus] = gain;
  if (ctx) nodes[bus].trim.gain.setTargetAtTime(gain, ctx.currentTime, START_MARGIN_S);
}

export function cut(id: SoundId, at?: number): void {
  const c = ctx;
  const source = lastVoice.get(id);
  if (!c || !source) return;
  try {
    source.stop(contextTime(c, at) ?? c.currentTime);
  } catch {}
}

export function durationMs(id: SoundId): number {
  const buffer = buffers.get(SOUNDS[id].file);
  return buffer ? (buffer.duration * 1000) / (SOUNDS[id].rate ?? 1) : 0;
}

export function audioState(): AudioState {
  const state = ctx?.state as string | undefined;
  if (state === "running") return "running";
  if (state === "closed") return "failed";
  return "suspended";
}

export function engineStats(): EngineStats {
  return { audioMs: ctx ? ctx.currentTime * 1000 : 0, ...stats, resident: TRACK_IDS.filter((t) => decoded.has(TRACKS[t]())).length };
}
```

- [ ] **Step 7: One owner per layer, in lint too**

In `eslint.config.js`, below the `require('./eslint.selectors.cjs')` block, add:

```js
const ONLY_OWNERS = "ADR-0009: one owner per audio layer (tests/tooling/audioOwners.test.ts).";
const PACKAGE_OWNERS = {
  "react-native-audio-api": "lib/device/audioEngine.ts",
  "react-native-turbo-haptics": "lib/device/hapticsEngine.ts",
};
const GROUP_OWNERS = [
  { group: ["**/audioEngine", "**/audioEngine.*", "**/hapticsEngine", "**/hapticsEngine.*"], owner: "lib/device/feedback.ts" },
  { group: ["**/modules/murlan-diagnostics", "**/modules/murlan-diagnostics/*"], owner: "lib/diagnostics/probe.ts" },
];
const audioLayers = (file) => [
  "error",
  {
    paths: Object.entries(PACKAGE_OWNERS)
      .filter(([, owner]) => owner !== file)
      .map(([name]) => ({ name, allowTypeImports: true, message: ONLY_OWNERS })),
    patterns: GROUP_OWNERS.filter((g) => g.owner !== file).map(({ group }) => ({ group, allowTypeImports: true, message: ONLY_OWNERS })),
  },
];
```

After the `app/components/context/lib` block, add:

```js
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "context/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-restricted-imports": audioLayers(null) },
  },
  ...["lib/device/audioEngine.ts", "lib/device/hapticsEngine.ts", "lib/device/feedback.ts", "lib/diagnostics/probe.ts"].map((file) => ({
    files: [file],
    rules: { "@typescript-eslint/no-restricted-imports": audioLayers(file) },
  })),
```

Later flat-config blocks override earlier ones for the same rule, so each owner is allowed exactly its own layer. Type imports stay allowed: `moments.ts` names `Bus` and `TapHaptic`, and a type is not a runtime edge. Task 10 adds `"expo-audio": null` and `"expo-haptics": null` to `PACKAGE_OWNERS`.

- [ ] **Step 8: Verify**

Run `node --test tests/tooling/audioOwners.test.ts` (PASS), `npx tsc --noEmit -p .` and `npx eslint lib/device eslint.config.js tests/native/mocks tests/native/helpers tests/native/setup.ts tests/native/audioEngine.test.tsx tests/tooling/audioOwners.test.ts`. Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add -- lib/device/soundAssets.ts lib/device/assetFiles.ts lib/device/audioEngine.ts lib/device/audioEngine.web.ts tests/native/mocks/audioApi.ts tests/native/helpers/feedback.ts tests/native/setup.ts tests/native/audioEngine.test.tsx tests/tooling/audioOwners.test.ts eslint.config.js
git commit -m "feat(#1259): one AudioContext for the app's life, behind a facade that never awaits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `hapticsEngine.ts`, taps from JS and pulses from a worklet

**Files:**
- Create: `lib/device/hapticsEngine.ts`, `lib/device/hapticsEngine.web.ts` and `tests/native/mocks/turboHaptics.ts`
- Modify: `tests/native/setup.ts`, `tests/native/helpers/feedback.ts` and `tests/tooling/audioOwners.test.ts`
- Test: `tests/native/hapticsEngine.test.tsx`

**Interfaces:**
- Produces:
  - from `@/lib/device/hapticsEngine` (and `.web`): `type TapHaptic`, `type PulseStrength`, `setHapticsGate(on)`, worklet `pulse(strength)` and `tap(kind, at?)`;
  - from the helper: `haptics()` and `hapticCalls()`.

- [ ] **Step 1: The mock and the failing test**

`tests/native/mocks/turboHaptics.ts`:

```ts
export interface HapticsState {
  calls: { type: string; at: number }[];
}

export function turboHapticsState(): HapticsState {
  const g = globalThis as { __turboHaptics?: HapticsState };
  g.__turboHaptics ??= { calls: [] };
  return g.__turboHaptics;
}

export function turboHapticsModule() {
  const s = turboHapticsState();
  return {
    __esModule: true,
    triggerHaptics: (type: string) => {
      s.calls.push({ type, at: performance.now() });
    },
    __mock: s,
  };
}
```

In `tests/native/setup.ts`, below the audio mock, add:

```ts
jest.mock('react-native-turbo-haptics', () => require('./mocks/turboHaptics').turboHapticsModule());
```

In the same file's `beforeEach`, add `require('./mocks/turboHaptics').turboHapticsState().calls.length = 0;`.

Append to `tests/native/helpers/feedback.ts`:

```ts
import { turboHapticsState } from '../mocks/turboHaptics';

export const hapticCalls = () => turboHapticsState().calls;
export const haptics = () => hapticCalls().map((c) => c.type);
```

`tests/native/hapticsEngine.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as nativeHaptics from '@/lib/device/hapticsEngine';
import * as webHaptics from '@/lib/device/hapticsEngine.web';
import { pulse, setHapticsGate, tap } from '@/lib/device/hapticsEngine';
import { hapticCalls, haptics, settle } from './helpers/feedback';

const sameSurface: typeof nativeHaptics = webHaptics;

describe('the haptics engine', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setHapticsGate(true);
  });
  afterEach(() => jest.useRealTimers());

  it('has the same surface on web and native', () => {
    expect(Object.keys(sameSurface).sort()).toEqual(Object.keys(nativeHaptics).sort());
  });

  it('maps each tap to its library type', () => {
    for (const kind of ['selection', 'light', 'medium', 'heavy', 'rigid', 'success', 'error', 'warn'] as const) tap(kind);
    expect(haptics()).toEqual([
      'selection', 'impactLight', 'impactMedium', 'impactHeavy', 'rigid',
      'notificationSuccess', 'notificationError', 'notificationWarning',
    ]);
  });

  it('a pulse fires its strength', () => {
    pulse('rigid');
    pulse('heavy');
    expect(haptics()).toEqual(['rigid', 'impactHeavy']);
  });

  it('a tap given a time fires at that time and not before', async () => {
    const at = performance.now() + 300;
    tap('light', at);
    await settle(299);
    expect(haptics()).toEqual([]);
    await settle(1);
    expect(hapticCalls()).toEqual([{ type: 'impactLight', at: expect.closeTo(at, 0) }]);
  });

  it('a tap 8 ms late fires now, and one 12 ms late is dropped', () => {
    tap('light', performance.now() - 8);
    tap('heavy', performance.now() - 12);
    expect(haptics()).toEqual(['impactLight']);
  });

  it('the gate silences taps, scheduled taps and pulses', async () => {
    setHapticsGate(false);
    tap('light');
    tap('medium', performance.now() + 100);
    pulse('rigid');
    await settle(200);
    expect(haptics()).toEqual([]);
  });
});
```

Add `"react-native-turbo-haptics": ["lib/device/hapticsEngine.ts"]` to `OWNERS` in `tests/tooling/audioOwners.test.ts`.

- [ ] **Step 2: Run and watch them fail**

Run `node --test tests/tooling/audioOwners.test.ts`. Expected: FAIL on `react-native-turbo-haptics`.

- [ ] **Step 3: The engine and its twin**

`lib/device/hapticsEngine.ts`:

```ts
import { makeMutable } from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";
import { triggerHaptics, type HapticType } from "react-native-turbo-haptics";
import { DIAGNOSTICS, diag } from "@/lib/diagnostics";

export type TapHaptic = "selection" | "light" | "medium" | "heavy" | "rigid" | "success" | "error" | "warn";
export type PulseStrength = "light" | "medium" | "heavy" | "rigid";

const TYPES: Record<TapHaptic, HapticType> = {
  selection: "selection",
  light: "impactLight",
  medium: "impactMedium",
  heavy: "impactHeavy",
  rigid: "rigid",
  success: "notificationSuccess",
  error: "notificationError",
  warn: "notificationWarning",
};
const gate = makeMutable(true);
const LATE_MS = 10;

export function setHapticsGate(on: boolean): void {
  gate.value = on;
}

export function pulse(strength: PulseStrength): void {
  "worklet";
  if (gate.value) triggerHaptics(TYPES[strength]);
}

function tapLater(type: HapticType, ms: number): void {
  "worklet";
  setTimeout(() => {
    if (gate.value) triggerHaptics(type);
  }, ms);
}

export function tap(kind: TapHaptic, at?: number): void {
  const wait = at === undefined ? 0 : at - performance.now();
  if (wait < -LATE_MS) return;
  if (DIAGNOSTICS) diag({ k: "haptic", t: performance.now(), kind, at: at ?? performance.now() });
  if (wait > 0) scheduleOnUI(tapLater, TYPES[kind], wait);
  else if (gate.value) triggerHaptics(TYPES[kind]);
}
```

`lib/device/hapticsEngine.web.ts` ports expo-haptics 57's web shim (`src/ExpoHaptics.web.ts`): vibration patterns where `navigator.vibrate` exists, and the hidden-switch click on a coarse pointer.

```ts
import { makeMutable } from "react-native-reanimated";

export type TapHaptic = "selection" | "light" | "medium" | "heavy" | "rigid" | "success" | "error" | "warn";
export type PulseStrength = "light" | "medium" | "heavy" | "rigid";

const PATTERNS: Record<TapHaptic, number[]> = {
  success: [40, 100, 40],
  warn: [50, 100, 50],
  error: [60, 100, 60, 100, 60],
  light: [40],
  medium: [50],
  heavy: [60],
  rigid: [45],
  selection: [50],
};
const gate = makeMutable(true);
const LATE_MS = 10;

export function setHapticsGate(on: boolean): void {
  gate.value = on;
}

function switchClick(): void {
  try {
    const label = document.createElement("label");
    label.ariaHidden = "true";
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    document.head.removeChild(label);
  } catch {}
}

function fire(pattern: number[]): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
    return;
  }
  if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return;
  let t = 0;
  pattern.forEach((ms, i) => {
    if (i % 2 === 0) {
      if (t === 0) switchClick();
      else setTimeout(switchClick, t);
    }
    t += ms;
  });
}

export function pulse(strength: PulseStrength): void {
  "worklet";
  if (gate.value) fire(PATTERNS[strength]);
}

export function tap(kind: TapHaptic, at?: number): void {
  const wait = at === undefined ? 0 : at - performance.now();
  const run = () => {
    if (gate.value) fire(PATTERNS[kind]);
  };
  if (wait < -LATE_MS) return;
  if (wait > 0) setTimeout(run, wait);
  else run();
}
```

On web a worklet runs on the JS thread, so `pulse` may call `fire`.

- [ ] **Step 4: Verify**

Run `node --test tests/tooling/audioOwners.test.ts` (PASS), `npx tsc --noEmit -p .` and `npx eslint lib/device/hapticsEngine.ts lib/device/hapticsEngine.web.ts tests/native`.

- [ ] **Step 5: Commit**

```bash
git add -- lib/device/hapticsEngine.ts lib/device/hapticsEngine.web.ts tests/native/mocks/turboHaptics.ts tests/native/setup.ts tests/native/helpers/feedback.ts tests/native/hapticsEngine.test.tsx tests/tooling/audioOwners.test.ts
git commit -m "feat(#1259): haptics from JS and from UI-thread worklets, through turbo-haptics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Moments, the mixing policy, `feedback.ts`, and the neutral sting (D6)

**Files:**
- Create: `lib/device/moments.ts`, `lib/device/feedback.ts` and `assets/sounds/manche_neutral.mp3` (built)
- Modify:
  - `lib/device/soundAssets.ts`, `scripts/build-sounds.mjs` and `assets/sounds/README.md`;
  - `tests/tooling/soundAssets.test.ts`, `tests/tooling/audioOwners.test.ts` and `tests/native/helpers/feedback.ts`.
- Test: `tests/ui-rules/mixPolicy.test.ts` (node) and `tests/native/feedback.test.tsx` (jest)

**Interfaces:**
- Produces:
  - from `@/lib/device/moments` (pure, so `node --test` imports it):
    - `type Moment`, `type MomentKind`, `type LandingKind`, `type PulseStep`, `type Haptic`, `type Cue`, `type Played`;
    - `MOMENTS`, `cueFor`, `isCombo`, `mix`, `PILE_UP_WINDOW_MS = 120`, `LANDING_PULSES`, `landingKind`, `landingPulsesFor`.
  - from `@/lib/device/feedback`:
    - `startFeedback()`, `event(moments, at?)`, `uiFeedback(kind)`, `silence("clockRunningOut")`, `backgroundMusic(track)`;
    - `setSoundVolume(v)`, `setMusicVolume(v)`, `setHapticsEnabled(v)`, `hapticsEnabled()`, `resetFeedback()`;
    - `startLandingPulses(m)`, `cancelLandingPulses()`, worklet `runLandingPulses(steps)`, worklet `landingPulse(strength)`;
    - `LANDING_PULSES`, `landingPulsesFor`, `audioState` and `engineStats`;
    - the types `Moment`, `MomentKind`, `LandingKind`, `PulseStep`, `UiFeedbackKind`, `TapHaptic` and `PulseStrength`.
  - from the helper: `bootFeedback()`.

The moments are:

| Moment | Fields |
| --- | --- |
| `landing` | `{ cards, bomb, mine }` |
| `mancheOver` | `{ outcome: "won" \| "lost" \| "neutral" }` |
| `partitaOver` | `{ won }` |
| `roundWon`, `roundStart`, `select`, `deselect`, `reject`, `give`, `pass`, `deal`, `exchange`, `turn`, `clockRunningOut` | none |

- [ ] **Step 1: The failing policy test (node)**

`tests/ui-rules/mixPolicy.test.ts` carries every row of `tests/ui-rules/tableCues.test.ts` over (Task 10 deletes that file with `cues.ts`), and adds the priority policy:

```ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LANDING_PULSES, MOMENTS, cueFor, isCombo, landingPulsesFor, mix, type Moment, type MomentKind } from "../../lib/device/moments.ts";

const KINDS: MomentKind[] = [
  "landing", "mancheOver", "partitaOver", "roundWon", "roundStart", "select", "deselect",
  "reject", "give", "pass", "deal", "exchange", "turn", "clockRunningOut",
];
const tapAt = (tap: string, atMs = 0) => ({ tap, atMs });
const sound = (batch: Moment[], t = 0, played: ReturnType<typeof mix>["played"] = []) => mix(batch, t, played).sound?.id ?? null;
const land = (cards: number, bomb: boolean, mine: boolean): Moment => ({ kind: "landing", cards, bomb, mine });

describe("every moment maps", () => {
  test("MOMENTS holds exactly the design's moments", () => {
    assert.deepEqual(Object.keys(MOMENTS).sort(), [...KINDS].sort());
  });

  test("your single card lands light, any combo of yours medium, with the matching sound and no haptic in the cue", () => {
    assert.deepEqual(cueFor(land(1, false, true)), { sound: "play", bus: "sfx", haptics: [] });
    for (const cards of [2, 3, 5]) {
      assert.deepEqual(cueFor(land(cards, false, true)), { sound: "combo", bus: "sfx", haptics: [] });
    }
    assert.deepEqual(LANDING_PULSES.play, [{ strength: "light", offsetMs: 0 }]);
    assert.deepEqual(LANDING_PULSES.combo, [{ strength: "medium", offsetMs: 0 }]);
  });

  test("someone else's cards land silent in the hand", () => {
    assert.deepEqual(cueFor(land(1, false, false)).haptics, []);
    assert.deepEqual(landingPulsesFor({ cards: 4, bomb: false, mine: false }), []);
    assert.equal(cueFor(land(4, false, false)).sound, "combo");
  });

  test("the sound and the pulse split on the same n > 1 predicate", () => {
    for (const cards of [1, 2, 3, 4, 5]) {
      assert.equal(cueFor(land(cards, false, true)).sound === "combo", isCombo(cards));
      assert.equal(landingPulsesFor({ cards, bomb: false, mine: true })[0].strength === "medium", isCombo(cards));
    }
  });

  test("a bomb from any seat is a sting, rigid on impact, heavy at 256 ms, light at 416 ms", () => {
    for (const mine of [true, false]) {
      assert.deepEqual(cueFor(land(4, true, mine)), { sound: "bomb", bus: "sting", haptics: [] });
      assert.deepEqual(landingPulsesFor({ cards: 4, bomb: true, mine }), [
        { strength: "rigid", offsetMs: 0 },
        { strength: "heavy", offsetMs: 256 },
        { strength: "light", offsetMs: 416 },
      ]);
    }
  });

  test("a manche ends on a notification haptic with its sting; a draw has its own soft one (D6)", () => {
    assert.deepEqual(cueFor({ kind: "mancheOver", outcome: "won" }), { sound: "mancheWon", bus: "sting", haptics: [tapAt("success")] });
    assert.deepEqual(cueFor({ kind: "mancheOver", outcome: "lost" }), { sound: "mancheLost", bus: "sting", haptics: [tapAt("warn")] });
    assert.deepEqual(cueFor({ kind: "mancheOver", outcome: "neutral" }), { sound: "mancheNeutral", bus: "sting", haptics: [] });
  });

  test("a partita's haptic opens 300 ms ahead of its sting", () => {
    assert.deepEqual(cueFor({ kind: "partitaOver", won: true }), {
      sound: "partitaWon", bus: "sting", haptics: [tapAt("medium", -300), tapAt("success")],
    });
    assert.deepEqual(cueFor({ kind: "partitaOver", won: false }).haptics, [tapAt("medium", -300), tapAt("warn")]);
  });

  test("the hand's own taps, the turn, and the sound-only moments", () => {
    assert.deepEqual(cueFor({ kind: "select" }), { sound: "select", bus: "sfx", haptics: [tapAt("selection")] });
    assert.deepEqual(cueFor({ kind: "deselect" }), { sound: "deselect", bus: "sfx", haptics: [tapAt("selection")] });
    assert.deepEqual(cueFor({ kind: "reject" }), { sound: "reject", bus: "sfx", haptics: [tapAt("rigid")] });
    assert.deepEqual(cueFor({ kind: "give" }), { sound: "play", bus: "sfx", haptics: [tapAt("medium")] });
    assert.deepEqual(cueFor({ kind: "turn" }), { sound: "turn", bus: "sfx", haptics: [tapAt("light")] });
    const soundOnly = { pass: "pass", deal: "deal", exchange: "exchange", clockRunningOut: "clockRunningOut", roundWon: "round_win", roundStart: "round_start" } as const;
    for (const [kind, id] of Object.entries(soundOnly)) {
      assert.deepEqual(cueFor({ kind } as Moment), { sound: id, bus: "sfx", haptics: [] });
    }
  });
});

describe("one event sounds one thing", () => {
  test("the research's pile-ups, each as one event", () => {
    assert.equal(sound([{ kind: "turn" }, { kind: "pass" }]), "pass");
    assert.equal(sound([{ kind: "pass" }, { kind: "roundWon" }]), "round_win");
    assert.equal(sound([land(1, false, false), { kind: "turn" }]), "play");
  });

  test("a turn 34 ms after the landing that handed it over stays silent", () => {
    const first = mix([land(1, false, false)], 1000, []);
    assert.equal(sound([{ kind: "turn" }], 1034, first.played), null);
  });

  test("a turn well clear of the landing still sounds", () => {
    const first = mix([land(1, false, false)], 1000, []);
    assert.equal(sound([{ kind: "turn" }], 1500, first.played), "turn");
  });

  test("a select 30 ms after a landing still sounds", () => {
    const first = mix([land(2, false, false)], 1000, []);
    assert.equal(sound([{ kind: "select" }], 1030, first.played), "select");
  });

  test("the haptic comes from the highest moment that has one, even when a higher one is silent to the hand", () => {
    const out = mix([{ kind: "pass" }, { kind: "roundWon" }, { kind: "turn" }], 0, []);
    assert.equal(out.sound?.id, "round_win");
    assert.deepEqual(out.haptics, [tapAt("light")]);
  });

  test("a landing that pulses silences a coincident turn tap; one that does not, does not", () => {
    assert.deepEqual(mix([land(1, false, true), { kind: "turn" }], 0, []).haptics, []);
    assert.deepEqual(mix([land(4, true, false), { kind: "turn" }], 0, []).haptics, []);
    assert.deepEqual(mix([land(1, false, false), { kind: "turn" }], 0, []).haptics, [tapAt("light")]);
  });
});
```

The offsets are chosen or measured, never derived from `PILE_UP_WINDOW_MS`:

- 34 ms is the research's play-then-turn gap (+34–37 ms);
- 500 ms is far outside any pile-up;
- 256 and 416 ms are today's `lib/device/cues.ts:54-58`, which `tests/native/landingHaptic.test.tsx` pins against `KICK_JOLTS` (Task 9).

- [ ] **Step 2: The failing feedback test (jest)**

Append to `tests/native/helpers/feedback.ts`:

```ts
export async function bootFeedback(): Promise<void> {
  const feedback = require('@/lib/device/feedback') as typeof import('@/lib/device/feedback');
  feedback.resetFeedback();
  await act(() => feedback.startFeedback());
  require('../mocks/audioApi').newEpoch();
  hapticCalls().length = 0;
}
```

`tests/native/feedback.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  backgroundMusic, event, setHapticsEnabled, setSoundVolume, silence, startLandingPulses, uiFeedback,
} from '@/lib/device/feedback';
import { bootFeedback, ctxAt, ctxTime, effects, fileOf, hapticCalls, haptics, loops, musicBus, settle, sounds, startsOf } from './helpers/feedback';

const NINE_DB_DOWN = 10 ** (-9 / 20);
const STING_S = 1;

describe('feedback', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => jest.useRealTimers());

  it('moments raised in one commit are one event, and it sounds its highest moment', async () => {
    event([{ kind: 'turn' }]);
    event([{ kind: 'pass' }, { kind: 'roundWon' }]);
    await settle();
    expect(sounds()).toEqual(['round_win']);
    expect(haptics()).toEqual(['impactLight']);
  });

  it('a sting ducks the music 9 dB over 60 ms at its start, and returns over 400 ms at its end', async () => {
    backgroundMusic('menu');
    const at = performance.now() + 500;
    event([{ kind: 'mancheOver', outcome: 'won' }], at);
    await settle();
    expect(musicBus().gain.events).toEqual([
      { kind: 'hold', value: NaN, time: expect.closeTo(ctxAt(at), 3) },
      { kind: 'ramp', value: expect.closeTo(NINE_DB_DOWN, 3), time: expect.closeTo(ctxAt(at) + 0.06, 3) },
      { kind: 'hold', value: NaN, time: expect.closeTo(ctxAt(at) + STING_S, 3) },
      { kind: 'ramp', value: 1, time: expect.closeTo(ctxAt(at) + STING_S + 0.4, 3) },
    ]);
  });

  it('the music switch after a sting waits for the sting to end', async () => {
    backgroundMusic('menu');
    const at = performance.now() + 500;
    event([{ kind: 'mancheOver', outcome: 'lost' }], at);
    await settle();
    backgroundMusic('hand');
    const hand = loops().find((n) => fileOf(n) === 'hand')!;
    expect(hand.startedAt!).toBeGreaterThanOrEqual(ctxAt(at) + STING_S - 1e-3);
  });

  it('an event given a time already past starts nothing, and never plays late', async () => {
    event([{ kind: 'landing', cards: 1, bomb: false, mine: true }], performance.now() - 100);
    await settle();
    expect(effects()).toEqual([]);
  });

  it('the partita haptic leads its sting by 300 ms, and the sting is in the engine at once', async () => {
    const at = performance.now() + 1000;
    event([{ kind: 'partitaOver', won: true }], at);
    await settle();
    expect(startsOf('partitaWon')).toEqual([expect.closeTo(ctxAt(at), 3)]);
    await settle(1000);
    expect(hapticCalls()).toEqual([
      { type: 'impactMedium', at: expect.closeTo(at - 300, 0) },
      { type: 'notificationSuccess', at: expect.closeTo(at, 0) },
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sound volume 0 and haptics off leave nothing behind an event', async () => {
    setSoundVolume(0);
    setHapticsEnabled(false);
    event([{ kind: 'landing', cards: 4, bomb: true, mine: true }]);
    startLandingPulses({ cards: 4, bomb: true, mine: true });
    uiFeedback('selection');
    uiFeedback('seatFill');
    await settle(1000);
    expect(effects()).toEqual([]);
    expect(haptics()).toEqual([]);
  });

  it('haptics off silences the haptic, not the sound', async () => {
    setHapticsEnabled(false);
    event([{ kind: 'select' }]);
    await settle();
    expect(sounds()).toEqual(['select']);
    expect(haptics()).toEqual([]);
  });

  it('a landing sounds through event and pulses only through startLandingPulses', async () => {
    event([{ kind: 'landing', cards: 1, bomb: false, mine: true }]);
    await settle();
    expect([sounds(), haptics()]).toEqual([['play'], []]);
    startLandingPulses({ cards: 1, bomb: false, mine: true });
    await settle();
    expect(haptics()).toEqual(['impactLight']);
  });

  it('silencing the clock stops its voice now', async () => {
    event([{ kind: 'clockRunningOut' }]);
    await settle();
    silence('clockRunningOut');
    expect(effects()[0].stoppedAt).toBeCloseTo(ctxTime(performance.now()), 3);
  });

  it('music plays the track the route asks for, once', async () => {
    backgroundMusic('menu');
    backgroundMusic('menu');
    expect(loops().map(fileOf)).toEqual(['menu']);
  });
});
```

Every number here comes from the spec or the fixture, never from `feedback.ts`:

- 9 dB, 60 ms and 400 ms are design §1;
- 300 ms is `cues.ts:60`;
- 1 s is the mock's `durationS`.

- [ ] **Step 3: Run and watch them fail**

Run `node --test tests/ui-rules/mixPolicy.test.ts`. Expected: FAIL, `Cannot find module '../../lib/device/moments.ts'`.

- [ ] **Step 4: Ask the owner, then build the neutral sting (D6)**

First run `curl -sI https://raw.githubusercontent.com/Calinou/kenney-interface-sounds/master/addons/kenney_interface_sounds/glass_002.wav`, and read `content-length`. That is a HEAD request, not a download.

Then ask in chat, and wait for a clear yes:

> Task 7 runs `node scripts/build-sounds.mjs manche_neutral`. It downloads `glass_002.wav` (<content-length> bytes) from raw.githubusercontent.com/Calinou/kenney-interface-sounds, the source `room_full.mp3` was already built from. If Playwright's Chromium is missing, it also needs `npx playwright install chromium` (about 170 MB). Proceed?

In `scripts/build-sounds.mjs`:

- add to `RECIPES`, under the table entries:

  ```js
    manche_neutral: [
      { file: "glass_002.wav", gain: 0.5, rate: 1.0, at: 0.0 },
      { file: "glass_002.wav", gain: 0.45, rate: 1.122, at: 0.14 },
    ],
  ```

- `PEAK` becomes `{ round_start: 0.79, round_win: 0.3, manche_neutral: 0.25 }`;
- replace `const files = [...new Set(Object.values(RECIPES).flat().map((s) => s.file))];` with:

  ```js
  const only = process.argv.slice(2);
  const unknown = only.filter((name) => !(name in RECIPES));
  if (unknown.length > 0) throw new Error(`No recipe named ${unknown.join(", ")}`);
  const chosen = Object.fromEntries(Object.entries(RECIPES).filter(([name]) => only.length === 0 || only.includes(name)));
  const files = [...new Set(Object.values(chosen).flat().map((s) => s.file))];
  ```

- pass `RECIPES: chosen` in both places the `page.evaluate` call names `RECIPES`.

1.122 is a major second: two notes that resolve to neither verdict.

On the owner's yes, run `node scripts/build-sounds.mjs manche_neutral`. Only `assets/sounds/manche_neutral.mp3` changes. `git status --porcelain assets/sounds` must list exactly that file.

In `assets/sounds/README.md`, add a row for `manche_neutral.mp3`: "a drawn manche (D6): two glass notes a major second apart, under both verdict stings; built by `scripts/build-sounds.mjs manche_neutral`".

In `lib/device/soundAssets.ts`:

- add `manche_neutral: () => require("../../assets/sounds/manche_neutral.mp3") as number,` after `manche_lost`;
- add `mancheNeutral: { file: "manche_neutral", gain: 1 },` after `mancheLost`.

- [ ] **Step 5: The asset test reads both owners through the compiler**

In `tests/tooling/soundAssets.test.ts`:

- import `existsSync` and `moduleEdges` (`../helpers/moduleEdges.ts`);
- replace `requiredFiles` with the function below;
- in "requires exactly the files that exist on disk", the count becomes `20` and the message "sounds.ts and soundAssets.ts together require twenty files";
- the header comment's "lib/device/sounds.ts require()s nineteen names" becomes "lib/device/sounds.ts and lib/device/soundAssets.ts require() these names". That edits a line.

```ts
/** Every asset path the sound owners require(), read through the compiler. */
function requiredFiles(): string[] {
  const owners = ["lib/device/sounds.ts", "lib/device/soundAssets.ts"].filter((f) => existsSync(path.join(repoRoot, f)));
  const files = owners
    .flatMap((f) => moduleEdges(f, readFileSync(path.join(repoRoot, f), "utf8")))
    .filter((e) => e.via === "require" && e.to.startsWith("assets/sounds/"))
    .map((e) => e.to.slice("assets/sounds/".length));
  return [...new Set(files)];
}
```

Add, inside the `describe`:

```ts
  test("a drawn manche's sting sits well under both verdicts (D6)", async () => {
    const [neutral, won, lost] = await Promise.all(["manche_neutral.mp3", "manche_won.mp3", "manche_lost.mp3"].map(readMp3));
    assert.ok(neutral.lufs < won.lufs - 3 && neutral.lufs < lost.lufs - 3, `manche_neutral at ${neutral.lufs.toFixed(1)} LUFS is not under both verdicts`);
  });
```

Then run `node --test tests/tooling/soundAssets.test.ts`. Expected: two failures:

- `EXPECTED` does not cover `manche_neutral.mp3`;
- its playable test names the measured seconds and LUFS.

Add `"manche_neutral.mp3": { seconds: <measured, 3 decimals>, lufs: <measured, 1 decimal> }` to `EXPECTED`, in the file's alphabetical place, from the numbers that run printed. A new artefact's pin is taken once from the artefact. The relative test above is the part that does not depend on it.

- [ ] **Step 6: `moments.ts`**

```ts
import type { Bus } from "./audioEngine";
import type { PulseStrength, TapHaptic } from "./hapticsEngine";
import type { SoundId } from "./soundAssets";

type Plain = "roundWon" | "roundStart" | "select" | "deselect" | "reject" | "give" | "pass" | "deal" | "exchange" | "turn" | "clockRunningOut";

export type Moment =
  | { kind: "landing"; cards: number; bomb: boolean; mine: boolean }
  | { kind: "mancheOver"; outcome: "won" | "lost" | "neutral" }
  | { kind: "partitaOver"; won: boolean }
  | { [K in Plain]: { kind: K } }[Plain];
export type MomentKind = Moment["kind"];
export type LandingKind = "play" | "combo" | "bomb";

export interface PulseStep {
  strength: PulseStrength;
  offsetMs: number;
}

export interface Haptic {
  tap: TapHaptic;
  atMs: number;
}

export interface Cue {
  sound: SoundId | null;
  bus: Bus;
  haptics: Haptic[];
}

export interface MomentSpec<K extends MomentKind> {
  priority: number;
  input?: true;
  cue(m: Extract<Moment, { kind: K }>): Cue;
}

export interface Played {
  at: number;
  priority: number;
}

export const PILE_UP_WINDOW_MS = 120;
const PARTITA_LEAD_MS = 300;

export const LANDING_PULSES: Record<LandingKind, readonly PulseStep[]> = {
  play: [{ strength: "light", offsetMs: 0 }],
  combo: [{ strength: "medium", offsetMs: 0 }],
  bomb: [
    { strength: "rigid", offsetMs: 0 },
    { strength: "heavy", offsetMs: 256 },
    { strength: "light", offsetMs: 416 },
  ],
};

export const isCombo = (cards: number): boolean => cards > 1;

export function landingKind(m: { cards: number; bomb: boolean }): LandingKind {
  return m.bomb ? "bomb" : isCombo(m.cards) ? "combo" : "play";
}

export function landingPulsesFor(m: { cards: number; bomb: boolean; mine: boolean }): readonly PulseStep[] {
  return m.bomb || m.mine ? LANDING_PULSES[landingKind(m)] : [];
}

const tap = (t: TapHaptic): Haptic[] => [{ tap: t, atMs: 0 }];
const sfx = (sound: SoundId, haptics: Haptic[] = []): Cue => ({ sound, bus: "sfx", haptics });

export const MOMENTS = {
  partitaOver: {
    priority: 100,
    cue: (m) => ({
      sound: m.won ? "partitaWon" : "partitaLost",
      bus: "sting",
      haptics: [{ tap: "medium", atMs: -PARTITA_LEAD_MS }, { tap: m.won ? "success" : "warn", atMs: 0 }],
    }),
  },
  mancheOver: {
    priority: 95,
    cue: (m) =>
      m.outcome === "won"
        ? { sound: "mancheWon", bus: "sting", haptics: tap("success") }
        : m.outcome === "lost"
          ? { sound: "mancheLost", bus: "sting", haptics: tap("warn") }
          : { sound: "mancheNeutral", bus: "sting", haptics: [] },
  },
  roundWon: { priority: 80, cue: () => sfx("round_win") },
  landing: {
    priority: 70,
    cue: (m) =>
      m.bomb
        ? { sound: "bomb", bus: "sting", haptics: [] }
        : sfx(isCombo(m.cards) ? "combo" : "play"),
  },
  pass: { priority: 60, cue: () => sfx("pass") },
  exchange: { priority: 55, cue: () => sfx("exchange") },
  deal: { priority: 50, cue: () => sfx("deal") },
  roundStart: { priority: 45, cue: () => sfx("round_start") },
  turn: { priority: 40, cue: () => sfx("turn", tap("light")) },
  clockRunningOut: { priority: 35, cue: () => sfx("clockRunningOut") },
  give: { priority: 30, input: true, cue: () => sfx("play", tap("medium")) },
  reject: { priority: 25, input: true, cue: () => sfx("reject", tap("rigid")) },
  select: { priority: 20, input: true, cue: () => sfx("select", tap("selection")) },
  deselect: { priority: 20, input: true, cue: () => sfx("deselect", tap("selection")) },
} satisfies { [K in MomentKind]: MomentSpec<K> };

type AnySpec = { priority: number; input?: true; cue(m: Moment): Cue };
const specOf = (m: Moment) => MOMENTS[m.kind] as unknown as AnySpec;

export function cueFor(m: Moment): Cue {
  return specOf(m).cue(m);
}

export function mix(batch: Moment[], at: number, played: Played[]): { sound: { id: SoundId; bus: Bus } | null; haptics: Haptic[]; played: Played[] } {
  const ranked = batch.map((m) => ({ spec: specOf(m), cue: cueFor(m) })).sort((a, b) => b.spec.priority - a.spec.priority);
  const recent = played.filter((p) => p.at >= at - PILE_UP_WINDOW_MS);
  const top = ranked.find((r) => r.cue.sound !== null);
  const masked = !!top && !top.spec.input && recent.some((p) => p.priority > top.spec.priority && Math.abs(p.at - at) < PILE_UP_WINDOW_MS);
  const sound = top?.cue.sound && !masked ? { id: top.cue.sound, bus: top.cue.bus } : null;
  const pulsed = batch.some((m) => m.kind === "landing" && landingPulsesFor(m).length > 0);
  const haptics = pulsed ? [] : (ranked.find((r) => r.cue.haptics.length > 0)?.cue.haptics ?? []);
  return { sound, haptics, played: sound && top ? [...recent, { at, priority: top.spec.priority }] : recent };
}
```

On the other answer to D6, the neutral branch is `{ sound: null, bus: "sting", haptics: [] }`, and Step 4 builds nothing.

Each of these comparisons is a policy decision:

- `input` moments are never masked;
- a sound is masked only by a *strictly* higher one within the window;
- the haptic comes from the highest moment that has one, whether or not its sound was masked;
- the landing cue carries no haptic (the pulses are `runLandingPulses`'), and a batch with a landing that pulses fires no other tap;
- the bomb is a sting.

- [ ] **Step 7: `feedback.ts`**

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { makeMutable } from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";
import { SETTINGS_KEY } from "@/lib/storageKeys";
import { traceOnset } from "@/lib/e2eTrace";
import { audioState, cut, durationMs, engineStats, music, play, ramp, setBusTrim, startAudio } from "./audioEngine";
import { pulse, setHapticsGate, tap, type TapHaptic } from "./hapticsEngine";
import { LANDING_PULSES, landingPulsesFor, mix, type Moment, type Played, type PulseStep } from "./moments";
import type { SoundId } from "./soundAssets";
import type { TrackId } from "./musicTracks";

export type { LandingKind, Moment, MomentKind, PulseStep } from "./moments";
export type { PulseStrength, TapHaptic } from "./hapticsEngine";
export { pulse as landingPulse } from "./hapticsEngine";
export { LANDING_PULSES, audioState, engineStats, landingPulsesFor };
export type UiFeedbackKind = TapHaptic | "seatFill" | "roomFull";

const STING_DUCK_GAIN = 0.355;
const STING_DUCK_IN_MS = 60;
const STING_DUCK_OUT_MS = 400;
const DEFAULT_MUSIC_VOLUME = 0.5;
const UI_SOUNDS = { seatFill: "seat_fill", roomFull: "room_full" } as const;

let soundVolume = 1;
let musicVolume = DEFAULT_MUSIC_VOLUME;
let hapticsOn = true;
let track: TrackId | null = null;
let stingEndsAt = 0;
let played: Played[] = [];
let pending: { moments: Moment[]; at?: number }[] = [];
const generation = makeMutable(0);
setBusTrim("music", musicVolume);

// Read before SettingsProvider mounts, so a stored "off" holds from the first tap (CONTEXT.md, Feedback master state).
AsyncStorage.getItem(SETTINGS_KEY)
  .then((raw) => {
    const parsed = raw ? JSON.parse(raw) : null;
    if (typeof parsed?.hapticsEnabled === "boolean") setHapticsEnabled(parsed.hapticsEnabled);
  })
  .catch(() => {});

export function startFeedback(): Promise<void> {
  return startAudio();
}

// Effects of one commit run back to back, so a microtask gathers them into one event; timers cannot, they are faked in tests.
export function event(moments: Moment[], at?: number): void {
  if (moments.length === 0) return;
  if (pending.length === 0) void Promise.resolve().then(flush);
  pending.push({ moments, at });
}

function flush(): void {
  const now = performance.now();
  const batches = new Map<number | undefined, Moment[]>();
  for (const p of pending) batches.set(p.at, [...(batches.get(p.at) ?? []), ...p.moments]);
  pending = [];
  for (const [at, moments] of [...batches].sort((a, b) => (a[0] ?? now) - (b[0] ?? now))) fire(moments, at, now);
}

function trace(kind: "sound" | "haptic", name: string, at: number, now: number): void {
  if (at <= now) traceOnset(kind, name);
  else if (process.env.EXPO_PUBLIC_E2E_FAST === "1") setTimeout(() => traceOnset(kind, name), at - now);
}

// A given `at` goes through untouched, past or not: the engine drops what is more than one IO buffer late. Only an absent `at` means now.
function fire(moments: Moment[], at: number | undefined, now: number): void {
  const out = mix(moments, at ?? now, played);
  played = out.played;
  const lead = Math.max(0, ...out.haptics.map((h) => -h.atMs));
  const t0 = at ?? (lead > 0 ? now + lead : undefined);
  if (out.sound && soundVolume > 0) {
    play(out.sound.id, { at: t0, bus: out.sound.bus });
    trace("sound", out.sound.id, t0 ?? now, now);
    if (out.sound.bus === "sting") duck(out.sound.id, t0 ?? now);
  }
  if (!hapticsOn) return;
  for (const h of out.haptics) {
    const t = t0 === undefined ? undefined : t0 + h.atMs;
    tap(h.tap, t);
    trace("haptic", h.tap, t ?? now, now);
  }
}

function duck(id: SoundId, at: number): void {
  const end = at + durationMs(id);
  ramp("music", STING_DUCK_GAIN, { at, ms: STING_DUCK_IN_MS });
  ramp("music", 1, { at: end, ms: STING_DUCK_OUT_MS });
  stingEndsAt = Math.max(stingEndsAt, end);
}

export function runLandingPulses(steps: readonly PulseStep[]): void {
  "worklet";
  generation.value += 1;
  const mine = generation.value;
  for (const step of steps) {
    if (step.offsetMs <= 0) pulse(step.strength);
    else
      setTimeout(() => {
        if (generation.value === mine) pulse(step.strength);
      }, step.offsetMs);
  }
}

export function startLandingPulses(m: { cards: number; bomb: boolean; mine: boolean }): void {
  const steps = landingPulsesFor(m);
  scheduleOnUI(runLandingPulses, steps);
  if (!hapticsOn) return;
  const now = performance.now();
  for (const s of steps) trace("haptic", s.strength, now + s.offsetMs, now);
}

export function cancelLandingPulses(): void {
  scheduleOnUI(runLandingPulses, []);
}

export function uiFeedback(kind: UiFeedbackKind): void {
  if (kind === "seatFill" || kind === "roomFull") {
    if (soundVolume === 0) return;
    play(UI_SOUNDS[kind]);
    traceOnset("sound", UI_SOUNDS[kind]);
    return;
  }
  if (!hapticsOn) return;
  tap(kind);
  traceOnset("haptic", kind);
}

export function silence(id: "clockRunningOut"): void {
  cut(id);
}

export function backgroundMusic(next: TrackId): void {
  track = next;
  if (musicVolume > 0) music(next, { at: Math.max(performance.now(), stingEndsAt) });
}

export function setSoundVolume(v: number): void {
  soundVolume = Math.max(0, Math.min(1, v));
  setBusTrim("sfx", soundVolume);
  setBusTrim("sting", soundVolume);
}

export function setMusicVolume(v: number): void {
  const was = musicVolume;
  musicVolume = Math.max(0, Math.min(1, v));
  setBusTrim("music", musicVolume);
  if (musicVolume === 0) music(null);
  else if (was === 0 && track) music(track);
}

export function setHapticsEnabled(v: boolean): void {
  hapticsOn = v;
  setHapticsGate(v);
}

export function hapticsEnabled(): boolean {
  return hapticsOn;
}

export function resetFeedback(): void {
  pending = [];
  played = [];
  stingEndsAt = 0;
  track = null;
  setHapticsEnabled(true);
  setSoundVolume(1);
  musicVolume = DEFAULT_MUSIC_VOLUME;
  setBusTrim("music", musicVolume);
}
```

A stacked sting needs no bookkeeping. A later sting's duck starts before the earlier sting's restore, and `cancelAndHoldAtTime` drops every event after its time. So the earlier restore is overwritten in the engine, and the music never surfaces between two stings.

The duck waits on `durationMs(id)`: the sting's buffer length, scaled by its rate.

Add to `OWNERS` in `tests/tooling/audioOwners.test.ts`:

- `"lib/device/audioEngine": ["lib/device/feedback.ts"]`;
- `"lib/device/hapticsEngine": ["lib/device/feedback.ts"]`.

- [ ] **Step 8: Verify**

Run each on its own. Expected: PASS.

- `node --test tests/ui-rules/mixPolicy.test.ts`
- `node --test tests/tooling/soundAssets.test.ts`
- `node --test tests/tooling/audioOwners.test.ts`

Then run `npx tsc --noEmit -p .` and `npx eslint lib/device scripts/build-sounds.mjs tests/native tests/ui-rules/mixPolicy.test.ts tests/tooling`.

- [ ] **Step 9: Commit**

```bash
git add -- lib/device/moments.ts lib/device/feedback.ts lib/device/soundAssets.ts scripts/build-sounds.mjs assets/sounds/manche_neutral.mp3 assets/sounds/README.md tests/ui-rules/mixPolicy.test.ts tests/native/feedback.test.tsx tests/native/helpers/feedback.ts tests/tooling/soundAssets.test.ts tests/tooling/audioOwners.test.ts
git commit -m "feat(#1259): one sound per table moment, stings that duck in the engine, and a neutral sting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The CI soak, before any caller moves

**Files:**
- Create: `lib/diagnostics/scenarios/soak.ts`, `.github/workflows/audio-soak.yml` and `.maestro/audio-soak.yaml`
- Modify: `lib/diagnostics/scenarios/index.ts` and `scripts/diagnostics-verdict.mjs`
- Test: `tests/tooling/diagnosticsVerdict.test.ts`

**The gate:**

- **Metric and threshold:**
  - the footprint slope after a five-minute warm-up is under 1 MB/min;
  - audio-clock lag steps (a jump of more than 20 ms in `audioMs − t` between two ten-second samples) are no more in the second half of the run than in the first;
  - the context state is `running` in every sample;
  - there are at least 90 % of the expected plays (one event per 1.2 s, so 50 a minute).
- **Scenario:** 30 minutes of `feedback.event` on a fixed eight-event cycle every 1.2 s, with landing pulses. The music switches track every minute, and a manche sting plays every five minutes.
- **Where:** an API 34 x86_64 emulator and an iOS simulator, in release builds with diagnostics on.
- **The bench ships off:** the build job sets `EXPO_PUBLIC_DIAGNOSTICS=1` itself, and `ci.yml`'s `build` job keeps proving production carries no recorder.
- **What the owner does:** nothing. The executor dispatches the workflow and reads it.

- [ ] **Step 1: The failing verdict tests**

Append to `tests/tooling/diagnosticsVerdict.test.ts`:

```ts
function soakRows(opts: { minutes: number; mbPerMin: number; lateSteps?: number; state?: string; playsPerMin?: number; rate?: number; name?: string }) {
  const rows: object[] = [];
  const end = opts.minutes * 60000;
  for (let t = 0; t <= end; t += 10000) {
    const late = opts.lateSteps && t > end / 2 && t % 60000 === 0 ? 30 : 0;
    rows.push({ k: "engine", t, state: opts.state ?? "running", audioMs: t * (opts.rate ?? 1) + 5 + late, plays: 0 });
    rows.push({ k: "footprint", t, mb: 150 + (opts.mbPerMin * t) / 60000 });
  }
  const plays = Math.round(opts.minutes * (opts.playsPerMin ?? 50));
  for (let i = 0; i < plays; i++) rows.push({ k: "play", t: (i * end) / plays, id: "turn", at: (i * end) / plays, bus: "sfx", dropped: false, lead: 0 });
  const name = opts.name ?? "soak";
  return [
    { session: "s", k: "build", t: 0, dev: false, scriptURL: "assets://index.android.bundle" },
    { session: "s", k: "scenario", t: 0, name, phase: "start" },
    ...rows.map((r) => ({ session: "s", ...r })),
    { session: "s", k: "scenario", t: end, name, phase: "end", error: null },
  ];
}

test("a flat half-hour soak passes, and so does one whose audio clock runs 1% fast", () => {
  assert.equal(verdict(soakRows({ minutes: 30, mbPerMin: 0.2 }), "soak")?.pass, true);
  assert.equal(verdict(soakRows({ minutes: 30, mbPerMin: 0.2, rate: 1.01 }), "soak")?.pass, true);
});

test("the smoke passes a running clock, and fails a clock that stands still as 'no audio device'", () => {
  assert.equal(verdict(soakRows({ minutes: 1, mbPerMin: 0, name: "smoke" }), "smoke")?.pass, true);
  const still = verdict(soakRows({ minutes: 1, mbPerMin: 0, rate: 0, name: "smoke" }), "smoke");
  assert.equal(still?.pass, false);
  assert.equal(still?.metrics.error, "no audio device");
  assert.equal(verdict(soakRows({ minutes: 1, mbPerMin: 0, state: "suspended", name: "smoke" }), "smoke")?.pass, false);
});

const FLINGER = (partial: number, empty: number) =>
  `Output thread 0x7b2c type 0 (MIXER):\n  Normal mixer raw underrun counters: partial=${partial} empty=${empty}\nOutput thread 0x7b40 type 0 (MIXER):\n  Normal mixer raw underrun counters: partial=1 empty=0\n`;

test("underruns are summed over every output thread, and a dump without the counters is no reading", () => {
  assert.equal(flingerUnderruns(FLINGER(3, 4)), 8);
  assert.equal(flingerUnderruns("Output thread 0x7b2c type 0 (MIXER):\n  Standby: no\n"), null);
  assert.equal(flingerVerdict(FLINGER(3, 4), FLINGER(20, 30)).pass, true);
  assert.equal(flingerVerdict(FLINGER(3, 4), FLINGER(40, 40)).pass, false);
  assert.equal(flingerVerdict(FLINGER(3, 4), "no counters").pass, false);
});

test("a soak fails on a 2 MB/min leak, growing lag jumps, a stopped context, too few plays, or too short a run", () => {
  assert.equal(verdict(soakRows({ minutes: 30, mbPerMin: 2 }), "soak")?.pass, false);
  assert.equal(verdict(soakRows({ minutes: 30, mbPerMin: 0.2, lateSteps: 1 }), "soak")?.pass, false);
  assert.equal(verdict(soakRows({ minutes: 30, mbPerMin: 0.2, state: "suspended" }), "soak")?.pass, false);
  assert.equal(verdict(soakRows({ minutes: 30, mbPerMin: 0.2, playsPerMin: 20 }), "soak")?.pass, false);
  assert.equal(verdict(soakRows({ minutes: 10, mbPerMin: 0.2 }), "soak")?.pass, false);
});
```

Add `flingerUnderruns` and `flingerVerdict` to the file's import from `../../scripts/diagnostics-verdict.mjs`. The `FLINGER` text is written from `MixerThread::dumpInternals` (`frameworks/av/services/audioflinger/Threads.cpp`, the "Normal mixer raw underrun counters" line). Before trusting it, read the first dispatch's `audio-flinger-start.txt`: if the line is not there verbatim, correct the regex and the fixture to the real dump. The gate reds on a dump without it, so a format change cannot pass silently.

Run `node --test tests/tooling/diagnosticsVerdict.test.ts`. Expected: FAIL, `null` has no `pass`, because there is no `soak` gate.

- [ ] **Step 2: The gate**

In `scripts/diagnostics-verdict.mjs`, above `export const GATES`, add:

```js
function slopePerMinute(points) {
  const n = points.length;
  const mx = points.reduce((a, [x]) => a + x, 0) / n;
  const my = points.reduce((a, [, y]) => a + y, 0) / n;
  const sxy = points.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
  const sxx = points.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  return sxx === 0 ? NaN : sxy / sxx;
}

function fit(points) {
  const slope = slopePerMinute(points);
  const mx = points.reduce((a, [x]) => a + x, 0) / points.length;
  const my = points.reduce((a, [, y]) => a + y, 0) / points.length;
  return (x) => my + slope * (x - mx);
}

function soak(rows) {
  const t0 = rows[0].t;
  const t1 = rows.at(-1).t;
  const minutes = (t1 - t0) / 60000;
  const memory = rows.filter((r) => r.k === "footprint" && r.t - t0 >= 5 * 60000).map((r) => [(r.t - t0) / 60000, r.mb]);
  const engine = rows.filter((r) => r.k === "engine");
  const lag = engine.map((r) => [(r.t - t0) / 60000, r.audioMs - r.t]);
  const line = lag.length >= 2 ? fit(lag) : () => NaN;
  const residual = lag.map(([x, y]) => y - line(x));
  const jumps = engine.slice(1).filter((_, i) => !(Math.abs(residual[i + 1] - residual[i]) <= 20)).map((r) => r.t);
  const mid = (t0 + t1) / 2;
  const firstHalf = jumps.filter((t) => t < mid).length;
  const secondHalf = jumps.length - firstHalf;
  const notRunning = engine.filter((r) => r.state !== "running").length;
  const plays = rows.filter((r) => r.k === "play" && !r.dropped).length;
  const mbPerMin = memory.length >= 10 ? slopePerMinute(memory) : NaN;
  const pass =
    minutes >= 29 && mbPerMin < 1 && secondHalf <= firstHalf && notRunning === 0 && engine.length >= minutes * 5 && plays >= minutes * 45;
  return { pass, metrics: { minutes, mbPerMin, driftMsPerMin: slopePerMinute(lag), firstHalf, secondHalf, notRunning, plays, samples: engine.length } };
}

function smoke(rows) {
  const engine = rows.filter((r) => r.k === "engine");
  const first = engine[0];
  const last = engine.at(-1);
  const advance = engine.length >= 2 ? (last.audioMs - first.audioMs) / (last.t - first.t) : 0;
  const running = engine.length > 0 && engine.every((r) => r.state === "running");
  const pass = engine.length >= 5 && running && advance >= 0.9;
  return { pass, metrics: { samples: engine.length, running, advance, ...(pass ? {} : { error: "no audio device" }) } };
}

const UNDERRUNS = /underrun counters: partial=(\d+) empty=(\d+)/g;

export function flingerUnderruns(text) {
  const counts = [...text.matchAll(UNDERRUNS)].map((m) => Number(m[1]) + Number(m[2]));
  return counts.length === 0 ? null : counts.reduce((a, b) => a + b, 0);
}

export function flingerVerdict(startText, endText) {
  const start = flingerUnderruns(startText);
  const end = flingerUnderruns(endText);
  const growth = start === null || end === null ? null : end - start;
  return { pass: growth !== null && growth <= 60, metrics: { start, end, growth } };
}
```

Add `soak, smoke,` to `GATES`. `NaN < 1` is false, so too few footprint samples fail the gate rather than pass it.

**The lag metric.** An emulator's audio clock can run at a slightly different rate from `performance.now()`, which a sample-to-sample difference counts as a jump every sample. The fitted line takes that constant drift out (reported as `driftMsPerMin`), and only jumps in the residual count; a NaN residual counts as a jump. More jumps in the second half than the first is growth.

**Underruns (#1231).** The threshold is 60 over the 30 minutes, 2 a minute, the design's number; the first dispatch's growth goes in the PR body, and only the lead changes the threshold. In the CLI's `isInvokedDirectly` block, first:

```js
  if (process.argv[2] === "--flinger") {
    const v = flingerVerdict(readFileSync(process.argv[3], "utf8"), readFileSync(process.argv[4], "utf8"));
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.pass ? 0 : 1);
  }
```

- [ ] **Step 3: The scenario**

`lib/diagnostics/scenarios/soak.ts`:

```ts
import {
  audioState, backgroundMusic, engineStats, event, setMusicVolume, setSoundVolume, startFeedback, startLandingPulses, type Moment,
} from "@/lib/device/feedback";
import type { TrackId } from "@/lib/device/musicTracks";
import { registerBenchScenario } from "../bench";
import { diag } from "../index";
import { probe } from "../probe";

const CYCLE: Moment[][] = [
  [{ kind: "landing", cards: 1, bomb: false, mine: true }],
  [{ kind: "turn" }],
  [{ kind: "pass" }],
  [{ kind: "landing", cards: 2, bomb: false, mine: false }],
  [{ kind: "select" }],
  [{ kind: "landing", cards: 4, bomb: true, mine: false }],
  [{ kind: "pass" }, { kind: "roundWon" }],
  [{ kind: "deal" }],
];
const TRACKS: TrackId[] = ["menu", "hand", "cue"];

registerBenchScenario("smoke", (ctx) => soak(ctx, 1));
registerBenchScenario("soak", (ctx) => soak(ctx, Number(ctx.params.minutes ?? "30")));

async function soak(ctx: BenchContext, minutes: number): Promise<void> {
  await startFeedback();
  await probe.stopCapture().catch(() => false);
  setSoundVolume(1);
  setMusicVolume(1);
  const t0 = performance.now();
  let lastSample = -Infinity;
  let lastManche = t0;
  let minute = -1;
  for (let i = 0; performance.now() - t0 < minutes * 60000; i++) {
    const now = performance.now();
    const m = Math.floor((now - t0) / 60000);
    if (m !== minute) {
      minute = m;
      backgroundMusic(TRACKS[m % TRACKS.length]);
    }
    const batch = CYCLE[i % CYCLE.length];
    if (now - lastManche >= 300000) {
      lastManche = now;
      event([{ kind: "mancheOver", outcome: "won" }], now + 500);
    } else {
      event(batch);
      if (batch[0].kind === "landing") startLandingPulses(batch[0]);
    }
    if (now - lastSample >= 10000) {
      lastSample = now;
      const stats = engineStats();
      diag({ k: "engine", t: now, state: audioState(), audioMs: stats.audioMs, plays: stats.plays });
      const mb = probe.footprintMb();
      if (mb !== null) diag({ k: "footprint", t: now, mb });
    }
    await ctx.sleep(1200);
  }
}
```

The import line becomes `import { registerBenchScenario, type BenchContext } from "../bench";`. `lib/diagnostics/scenarios/index.ts` gains `import "./soak";`.

**A list of scenarios in the link.** In `components/BenchScreen.tsx`, `run(only?: string)` becomes `run(only?: string[])`, its filter `if (only && !only.includes(name)) continue;`, and the auto-run passes `params.scenario === "all" ? undefined : params.scenario.split(",")`. The scenarios run in registration order, so `smoke,soak` runs the minute's smoke first.

`.maestro/audio-soak.yaml`:

```yaml
appId: ${MAESTRO_APP_ID}
---
- openLink: "murlan://bench?host=localhost&scenario=smoke,soak&minutes=30&capture=0"
- tapOn:
    text: "Open"
    optional: true
```

- [ ] **Step 4: The workflow**

`.github/workflows/audio-soak.yml`:

```yaml
# docs/plans/2026-09-28-1259-1-audio-haptics-engine.md, Task 8. Not on pull_request: 30 minutes a platform.
name: Audio soak

on:
  workflow_dispatch:
  schedule:
    - cron: "17 3 * * 1"

concurrency:
  group: audio-soak-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

env:
  NODE_VERSION: "24"
  EXPO_PUBLIC_DIAGNOSTICS: "1"

jobs:
  android:
    runs-on: ubuntu-latest
    timeout-minutes: 120
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - name: Generate the native project, on the NDK React Native pins
        run: |
          npx expo prebuild --platform android --no-install
          want=$(sed -n 's/^ndkVersion = "\(.*\)"$/\1/p' node_modules/react-native/gradle/libs.versions.toml)
          have=$(ls "$ANDROID_HOME/ndk" | grep "^${want%%.*}\." | sort -V | tail -1)
          [ -n "$have" ] || { echo "::error::No NDK ${want%%.*}.x under $ANDROID_HOME/ndk."; exit 1; }
          sed -i "1i ext.ndkVersion = \"$have\"" android/build.gradle
          grep -q 'usesCleartextTraffic="true"' android/app/src/main/AndroidManifest.xml
      - uses: actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3 # v4.9.1
        with:
          distribution: temurin
          java-version: "17"
          cache: gradle
      - name: Build a diagnostics release
        run: |
          ./android/gradlew -p android assembleRelease -PreactNativeArchitectures=x86_64 -x lintVitalRelease --no-daemon
          apk=$(ls android/app/build/outputs/apk/release/*.apk | head -1)
          [ -n "$apk" ] || { echo "::error::assembleRelease produced no APK."; exit 1; }
          unzip -q "$apk" -d "$RUNNER_TEMP/apk"
          node scripts/e2eBuildMark.mjs --present "$RUNNER_TEMP/apk" --mark diagnostics
          aapt=$(find "$ANDROID_HOME/build-tools" -name aapt2 | sort | tail -1)
          echo "APP_APK=$GITHUB_WORKSPACE/$apk" >> "$GITHUB_ENV"
          echo "APP_ID=$("$aapt" dump packagename "$apk")" >> "$GITHUB_ENV"
          mkdir -p "$RUNNER_TEMP/soak"
      - name: Enable KVM
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
          sudo udevadm control --reload-rules
          sudo udevadm trigger --name-match=kvm
      - name: Start the collector
        run: |
          nohup node scripts/diagnostics-collector.mjs "$RUNNER_TEMP/soak/android.ndjson" > "$RUNNER_TEMP/soak/collector.log" 2>&1 &
          for _ in $(seq 1 20); do curl -sf http://127.0.0.1:5099/ >/dev/null && break; sleep 1; done
          curl -sf http://127.0.0.1:5099/
      - name: Soak on the emulator
        uses: reactivecircus/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d # v2.38.0
        with:
          api-level: 34
          target: google_apis
          arch: x86_64
          profile: pixel_6
          emulator-options: -no-window -no-boot-anim -gpu swangle_indirect -camera-back none
          disable-animations: false
          emulator-boot-timeout: 900
          script: |
            timeout 300 adb wait-for-device
            i=0; until adb shell "getprop init.svc.bootanim | grep -q stopped && cmd package list packages > /dev/null 2>&1"; do i=$((i+1)); [ $i -lt 150 ] || { echo "::error::The framework never began serving."; exit 1; }; sleep 2; done
            adb shell settings put global hide_error_dialogs 1
            timeout 300 adb install -r "$APP_APK"
            adb shell dumpsys media.audio_flinger > "$RUNNER_TEMP/soak/audio-flinger-start.txt" 2>&1 || true
            adb shell "am start -W -a android.intent.action.VIEW -d 'murlan://bench?host=10.0.2.2&scenario=smoke,soak&minutes=30&capture=0' $APP_ID"
            i=0; until grep -q '"name":"smoke","phase":"end"' "$RUNNER_TEMP/soak/android.ndjson" 2>/dev/null; do i=$((i+1)); [ $i -lt 90 ] || { echo "::error::The bench never finished the smoke."; exit 1; }; sleep 2; done
            node scripts/diagnostics-verdict.mjs "$RUNNER_TEMP/soak/android.ndjson" smoke || { echo "::error::No audio device on this emulator: the engine's clock did not advance in the one-minute smoke."; exit 1; }
            i=0; until grep -q '"name":"soak","phase":"start"' "$RUNNER_TEMP/soak/android.ndjson" 2>/dev/null; do i=$((i+1)); [ $i -lt 60 ] || { echo "::error::The bench never started the soak."; exit 1; }; sleep 2; done
            nohup sh -c 'while true; do date -u +%H:%M:%S; adb shell dumpsys meminfo "$APP_ID" | grep -E "Native Heap|TOTAL PSS|TOTAL RSS"; sleep 60; done' > "$RUNNER_TEMP/soak/meminfo-series.txt" 2>&1 &
            i=0; until grep -q '"name":"soak","phase":"end"' "$RUNNER_TEMP/soak/android.ndjson" 2>/dev/null; do i=$((i+1)); [ $i -lt 1140 ] || { echo "::error::The soak never ended."; exit 1; }; sleep 2; done
            sleep 3
            adb shell dumpsys media.audio_flinger > "$RUNNER_TEMP/soak/audio-flinger-end.txt" 2>&1 || true
      - name: The soak gate
        run: node scripts/diagnostics-verdict.mjs "$RUNNER_TEMP/soak/android.ndjson" soak
      - name: The underrun gate (#1231)
        run: node scripts/diagnostics-verdict.mjs --flinger "$RUNNER_TEMP/soak/audio-flinger-start.txt" "$RUNNER_TEMP/soak/audio-flinger-end.txt"
      - name: Upload the soak record
        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: audio-soak-android
          path: ${{ runner.temp }}/soak/

  ios:
    runs-on: macos-latest
    timeout-minutes: 120
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - name: Find and boot an iPhone simulator
        run: |
          udid=$(xcrun simctl list devices available -j | node tools/ci/pick-simulator.mjs)
          echo "SIMULATOR_UDID=$udid" >> "$GITHUB_ENV"
          xcrun simctl boot "$udid"
      - run: npm ci
      - name: Build a diagnostics release for the simulator
        run: |
          npx expo prebuild --platform ios --no-install
          pod install --project-directory=ios
          workspace=$(ls -d ios/*.xcworkspace | head -1)
          scheme=$(basename "$workspace" .xcworkspace)
          xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration Release -sdk iphonesimulator \
            -derivedDataPath "$RUNNER_TEMP/DerivedData" ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO build
          app=$(ls -d "$RUNNER_TEMP/DerivedData/Build/Products/Release-iphonesimulator/"*.app | head -1)
          [ -n "$app" ] || { echo "::error::xcodebuild produced no .app."; exit 1; }
          node scripts/e2eBuildMark.mjs --present "$app" --mark diagnostics
          echo "APP_BUNDLE=$app" >> "$GITHUB_ENV"
          echo "APP_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")" >> "$GITHUB_ENV"
          echo "APP_EXE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Info.plist")" >> "$GITHUB_ENV"
          mkdir -p "$RUNNER_TEMP/soak"
      - name: Install the app and start the collector
        run: |
          xcrun simctl bootstatus "$SIMULATOR_UDID"
          xcrun simctl install "$SIMULATOR_UDID" "$APP_BUNDLE"
          nohup node scripts/diagnostics-collector.mjs "$RUNNER_TEMP/soak/ios.ndjson" > "$RUNNER_TEMP/soak/collector.log" 2>&1 &
          for _ in $(seq 1 20); do curl -sf http://127.0.0.1:5099/ >/dev/null && break; sleep 1; done
          curl -sf http://127.0.0.1:5099/
      - name: Install Maestro
        run: |
          export MAESTRO_VERSION=2.10.0
          curl -Ls "https://get.maestro.mobile.dev" | bash
          echo "$HOME/.maestro/bin" >> "$GITHUB_PATH"
          "$HOME/.maestro/bin/maestro" --version 2>&1 | tee /dev/stderr | grep -q "$MAESTRO_VERSION"
      - name: Open the bench by its deep link
        env:
          MAESTRO_DRIVER_STARTUP_TIMEOUT: "300000"
        run: maestro --device "$SIMULATOR_UDID" test -e MAESTRO_APP_ID="$APP_ID" .maestro/audio-soak.yaml
      - name: The one-minute smoke, which tells a missing audio device from a broken engine
        run: |
          i=0; until grep -q '"name":"smoke","phase":"end"' "$RUNNER_TEMP/soak/ios.ndjson" 2>/dev/null; do i=$((i+1)); [ $i -lt 90 ] || { echo "::error::The bench never finished the smoke."; exit 1; }; sleep 2; done
          node scripts/diagnostics-verdict.mjs "$RUNNER_TEMP/soak/ios.ndjson" smoke || { echo "::error::No audio device on this runner: the engine's clock did not advance in the one-minute smoke. The iOS soak is then G6 on the phone (Task 11)."; exit 1; }
      - name: Soak
        run: |
          i=0; until grep -q '"name":"soak","phase":"start"' "$RUNNER_TEMP/soak/ios.ndjson" 2>/dev/null; do i=$((i+1)); [ $i -lt 60 ] || { echo "::error::The bench never started the soak."; exit 1; }; sleep 2; done
          i=0; until grep -q '"name":"soak","phase":"end"' "$RUNNER_TEMP/soak/ios.ndjson" 2>/dev/null; do
            i=$((i+1)); [ $i -lt 38 ] || { echo "::error::The soak never ended."; exit 1; }
            pid=$(pgrep -x "$APP_EXE" | head -1)
            echo "$(date -u +%H:%M:%S) pid=${pid:-none} rss_kb=$( [ -n "$pid" ] && ps -o rss= -p "$pid" | tr -d ' ')" >> "$RUNNER_TEMP/soak/host-rss.txt"
            sleep 60
          done
          sleep 3
      - name: The soak gate
        run: node scripts/diagnostics-verdict.mjs "$RUNNER_TEMP/soak/ios.ndjson" soak
      - name: Collect crash reports
        if: always()
        run: cp "$HOME/Library/Logs/DiagnosticReports/"*"$APP_EXE"* "$RUNNER_TEMP/soak/" 2>/dev/null || true
      - name: Upload the soak record
        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: audio-soak-ios
          path: ${{ runner.temp }}/soak/
```

The host meminfo and RSS series are kept as artifacts for a failed gate, ungated. The audio_flinger dumps are gated by `--flinger`, which reds on a dump without the counters rather than passing it.

**If the smoke fails on `macos-latest` for want of an output device,** no simulator soak can run there. The iOS soak is then G6, the same 30-minute gate on the owner's phone (Task 11), and the executor reports the smoke's metrics to the lead with a proposal to delete the iOS job. The job stays red until that decision; it is never made to pass without playing.

The "start" wait is the floor for the gate: a bench that never opened produces no rows, and the verdict script would print `null` and exit 1 anyway. The explicit error names why.

- [ ] **Step 5: Verify, then run the soak**

Run `node --test tests/tooling/diagnosticsVerdict.test.ts` (PASS), `node --test tests/tooling/diagnosticsGate.test.ts` (PASS), `npx tsc --noEmit -p .` and `npx eslint lib/diagnostics scripts/diagnostics-verdict.mjs`.

Commit, push, then dispatch `gh workflow run audio-soak.yml --ref <branch>`. Read both jobs. **Both soak gates must be green before Task 9 starts.** On a red gate, read the uploaded record and stop; report the metrics to the lead. Do not relax a threshold.

- [ ] **Step 6: Commit**

```bash
git add -- lib/diagnostics/scenarios components/BenchScreen.tsx scripts/diagnostics-verdict.mjs .github/workflows/audio-soak.yml .maestro/audio-soak.yaml tests/tooling/diagnosticsVerdict.test.ts
git commit -m "feat(#1259): a 30-minute CI soak of the engine on an emulator and a simulator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The table's callers move to `event()`, with the class guards

**Files:**
- Modify:
  - `components/useTableFeedback.ts`, `components/GameTable.tsx` and `components/table/pile.tsx`;
  - `app/game.tsx`, `app/(online)/game.tsx` and `app/_layout.tsx`.
- Test:
  - `tests/native/tableTapFeedback.test.tsx` (new), `tests/native/oneSoundPerMoment.test.tsx` (new) and `tests/native/helpers/botManche.ts` (new);
  - rewritten: `tests/native/landingHaptic.test.tsx` and `tests/native/gameOverSting.test.tsx`.

The class guard that every moment has a caller is Task 10's `everyMomentHasACaller`: `clockRunningOut`'s caller only moves in Task 10, and a source scan cannot see the `handleCardPress` kind, which is a conditional, not a literal.

- [ ] **Step 1: (none; the guard is Task 10 Step 5a)**

- [ ] **Step 2: The tap test and the one-sound guard**

`tests/native/tableTapFeedback.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';
import { api, bootFeedback, effects, haptics, settle, sounds } from './helpers/feedback';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const SEVEN_H: Card = { id: '7_hearts', rank: '7', suit: 'hearts', isJoker: false };
const seat = (id: string, hand: Card[]): Player => ({ id, name: id, hand, type: 'human' });
const state: GameState = {
  players: [seat('player_0', [SEVEN_H]), seat('player_1', [])],
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
};
const noop = () => {};

describe('a card press', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => jest.useRealTimers());

  it('starts one source and fires one haptic, and touches neither the session nor a context', async () => {
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameTable gameState={state} viewerSeat={0} selectedIds={[]} onSelectCard={noop} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
      </SafeAreaProvider>
    );
    await settle(2000);
    const before = effects().length;
    const contexts = api().contexts.length;
    api().log.length = 0;
    await act(async () => {
      fireEvent.press(screen.getByLabelText(cardSpokenName(SEVEN_H, t)));
    });
    await settle();
    expect(sounds().slice(before)).toEqual(['select']);
    expect(haptics().slice(-1)).toEqual(['selection']);
    expect(api().log).toEqual([]);
    expect(api().contexts.length).toBe(contexts);
    await r.unmount();
  });
});
```

The `settle(2000)` lets the entry beat's deal sound pass, so the slice reads only the press.

`tests/native/oneSoundPerMoment.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import type { GameState } from '@/lib/game/gameEngine';
import { bootFeedback, effects, settle } from './helpers/feedback';
import { botManche as manche, STEP_MS } from './helpers/botManche';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const noop = () => {};

export function pileUps(starts: number[], windowS: number): number[][] {
  const sorted = [...starts].sort((a, b) => a - b);
  return sorted.flatMap((t, i) => (i > 0 && t - sorted[i - 1] < windowS ? [[sorted[i - 1], t]] : []));
}

const table = (s: GameState) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable gameState={s} viewerSeat={0} selectedIds={[]} onSelectCard={noop} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} handScores={{}} />
  </SafeAreaProvider>
);

describe('one table state change sounds one thing', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => jest.useRealTimers());

  it('the checker flags two starts inside the window and not two outside it', () => {
    expect(pileUps([10, 10.03, 11], 0.05)).toEqual([[10, 10.03]]);
    expect(pileUps([10, 10.2], 0.05)).toEqual([]);
  });

  it('a whole bot manche never starts two effects within 50 ms', async () => {
    const states = manche();
    const r = await render(table(states[0]));
    for (const s of states.slice(1)) {
      await act(async () => r.rerender(table(s)));
      await settle(STEP_MS);
    }
    const starts = effects().map((n) => n.startedAt!);
    expect(starts.length).toBeGreaterThanOrEqual(6);
    expect(pileUps(starts, 0.05)).toEqual([]);
    await r.unmount();
  });
});
```

Its class is "one table state change sounds one thing", whichever effects raise it.

`tests/native/helpers/botManche.ts`, shared with Task 10's `everyMomentHasACaller`:

```ts
import { initializeGame, type GameState } from '@/lib/game/gameEngine';
import { offlineBotMove, resolveStuckExchange } from '@/lib/game/autoMove';

export const STEP_MS = 1500;

export function botManche(): GameState[] {
  let state = initializeGame(['A', 'B', 'C', 'D'].map((name) => ({ name, type: 'ai' as const })), 'free_for_all');
  const states = [state];
  while (!state.gameOver && states.length < 300) {
    const next = offlineBotMove(state) ?? (state.exchangePhase?.active ? resolveStuckExchange(state) : null);
    if (!next) break;
    state = next;
    states.push(state);
  }
  return states;
}
```

- [ ] **Step 3: Carry the landing pin forward, and rewrite the sting test**

`tests/native/landingHaptic.test.tsx` becomes:

```tsx
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react-native";
import { KICK_JOLTS, useTableFeedback } from "@/components/useTableFeedback";
import { LANDING_PULSES } from "@/lib/device/feedback";
import { bootFeedback, haptics, settle, sounds } from "./helpers/feedback";

const state = {
  isMyTurn: false,
  currentTurnIndex: 0,
  isFinished: false,
  exchangeActive: false,
  canPass: false,
  playBtnValid: false,
  selectedCount: 0,
  passCount: 0,
  lastPlayedCombination: null,
  roundWinner: null,
  gameOver: false,
  rankings: [],
  players: [],
  isTeamMode: false,
  handScores: {},
  viewerId: "viewer",
  scale: 1,
};

const mount = () => renderHook(() => useTableFeedback(state));

describe("a card landing's haptic", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => jest.useRealTimers());

  it("taps lightly for the viewer's own single card", async () => {
    const { result, unmount } = await mount();
    await act(async () => result.current.playImpact(false, "bottom", 1));
    await settle();
    expect(sounds()).toEqual(["play"]);
    expect(haptics()).toEqual(["impactLight"]);
    await unmount();
  });

  it("taps harder for any of the viewer's own combos, with the combo sound", async () => {
    const { result, unmount } = await mount();
    await act(async () => result.current.playImpact(false, "bottom", 2));
    await settle();
    expect(sounds()).toEqual(["combo"]);
    expect(haptics()).toEqual(["impactMedium"]);
    await unmount();
  });

  it("stays silent in the hand for another seat's ordinary landing", async () => {
    const { result, unmount } = await mount();
    await act(async () => result.current.playImpact(false, "top", 5));
    await settle(500);
    await act(async () => result.current.playImpact(false, "left", 1));
    await settle();
    expect(sounds()).toEqual(["combo", "play"]);
    expect(haptics()).toEqual([]);
    await unmount();
  });

  it("times a bomb's later layers to the kick's first two jolts", () => {
    const [, heavy, light] = LANDING_PULSES.bomb;
    expect(heavy.offsetMs).toBe(KICK_JOLTS[0].ms);
    expect(light.offsetMs).toBe(KICK_JOLTS[0].ms + KICK_JOLTS[1].ms);
  });

  it("rumbles a bomb in three layers: rigid on impact, then heavy, then light", async () => {
    const { result, unmount } = await mount();
    await act(async () => result.current.playImpact(true, "right", 4));
    await settle();
    expect(sounds()).toEqual(["bomb"]);
    expect(haptics()).toEqual(["rigid"]);
    await settle(255);
    expect(haptics()).toEqual(["rigid"]);
    await settle(1);
    expect(haptics()).toEqual(["rigid", "impactHeavy"]);
    await settle(159);
    expect(haptics()).toEqual(["rigid", "impactHeavy"]);
    await settle(1);
    expect(haptics()).toEqual(["rigid", "impactHeavy", "impactLight"]);
    await unmount();
  });

  it("drops a bomb's pending layers when the next card lands first", async () => {
    const { result, unmount } = await mount();
    await act(async () => result.current.playImpact(true, "bottom", 4));
    await settle(100);
    await act(async () => result.current.playImpact(false, "top", 1));
    await settle(1000);
    expect(haptics()).toEqual(["rigid"]);
    await unmount();
  });

  it("drops a bomb's pending layers when the table unmounts", async () => {
    const { result, unmount } = await mount();
    await act(async () => result.current.playImpact(true, "bottom", 4));
    await settle();
    await unmount();
    await settle(1000);
    expect(haptics()).toEqual(["rigid"]);
  });
});
```

In `tests/native/gameOverSting.test.tsx`:

- **The mocks.** Delete the `jest.mock('@/lib/device/sounds', …)` and `jest.mock('expo-haptics', …)` blocks and their imports. Import `bootFeedback`, `ctxAt`, `haptics`, `settle as advance`, `sounds` and `startsOf` from `./helpers/feedback`.
- **`beforeEach`** becomes `jest.useFakeTimers(); await bootFeedback();`.
- **The `table(...)` helper** gains the props `matchOver` and `matchWinners`, passed through to `GameTable` (default `false` and `[]`).
- **Replace these three tests:**
  - "waits for the deciding card to land and hold before it plays";
  - "drops a pending sting when the table unmounts before it lands";
  - "drops a pending sting when a rematch starts before it lands".

  The replacements:

  ```tsx
    it('schedules the win sting in the engine at the landing and its hold', async () => {
      const t0 = performance.now();
      const r = await render(table(ID_RANKINGS, 0));
      await advance();
      expect(startsOf('mancheWon')).toEqual([expect.closeTo(ctxAt(t0 + STING_MS), 2)]);
      await r.unmount();
    });

    it('a sting already in the engine survives the table unmounting (#5)', async () => {
      const r = await render(table(ID_RANKINGS, 0));
      await advance();
      await r.unmount();
      expect(startsOf('mancheWon')).toHaveLength(1);
    });

    it('a finished partita sounds its own sting, with the haptic leading by 300 ms', async () => {
      const r = await render(table(ID_RANKINGS, 0, true, { matchOver: true, matchWinners: ['player_0'] }));
      await advance(STING_MS);
      expect(sounds()).toEqual(['partitaWon']);
      expect(haptics()).toEqual(['impactMedium', 'notificationSuccess']);
      await r.unmount();
    });
  ```

- **In every remaining test:**
  - `expect(playMancheWon).toHaveBeenCalledTimes(1)` becomes `expect(sounds()).toContain('mancheWon')`, and `not.toHaveBeenCalled()` becomes `not.toContain`. The same holds for `playMancheLost` with `'mancheLost'`.
  - `Haptics.notificationAsync(Success)` becomes `haptics()` containing `'notificationSuccess'`. Advance `STING_MS` first: the haptic is a tap at the sting's time.
- **The two "stays silent for a 3-3 drawn teams manche" tests** become "sounds the neutral sting for a 3-3 drawn teams manche, with no haptic" (D6): `expect(sounds()).toEqual(['mancheNeutral'])` and `expect(haptics()).toEqual([])`.

The rematch test is dropped, and its reason is under Design questions.

- [ ] **Step 4: Run and watch them fail**

The jest files compile but go red on CI until Step 5, because every press still goes through expo-audio.

- [ ] **Step 5: `useTableFeedback.ts`**

- **Imports:**
  - delete `import { playCue } from "@/lib/device/playCue";` and `import { cancelMusicDuck, duckMusicFor } from "@/lib/device/music";`;
  - add `import { cancelLandingPulses, event, startLandingPulses } from "@/lib/device/feedback";`;
  - `handOutcomeFor`'s import gains `celebratesViewer`.
- **`TableFeedbackState`** gains:

  ```ts
    /** The partita is decided; its sting replaces the manche's. */
    matchOver?: boolean;
    /** Engine player ids, as `MatchVerdict.winners`. */
    matchWinners?: readonly string[];
  ```

  Destructure both, with the defaults `false` and `[]`.
- **One clock for plan 2.** `landsAtRef` is stamped with `performance.now()`, and both `wait` computations read `performance.now()` instead of `Date.now()`.
- **The unmount cleanup** keeps clearing `handOffTimerRef`. Delete `stingTimerRef`, and replace `cancelPulsesRef.current();` with `cancelLandingPulses();`. Delete `cancelPulsesRef`.
- **The turn cue:** `const cue = () => playCue({ kind: "turn" });` becomes `const cue = () => event([{ kind: "turn" }]);`.
- **Exchange:** `playCue({ kind: "exchange" })` becomes `event([{ kind: "exchange" }])`.
- **The pass effect's last line** becomes:

  ```ts
      const closedNow = closed && !wasClosed;
      if (passCount > prevCount || closedNow) event(closedNow ? [{ kind: "pass" }, { kind: "roundWon" }] : [{ kind: "pass" }]);
  ```

  A round closes on a pass (`pile.tsx`'s own comment), so the round-win sting is that pass's event, not a second one 27–36 ms later.
- **The `gameOver` effect body** becomes:

  ```ts
    useEffect(() => {
      if (!gameOver) {
        prevGameOverRef.current = false;
        return;
      }
      if (handOffTimerRef.current) clearTimeout(handOffTimerRef.current);
      if (prevGameOverRef.current) return;
      const outcome = handOutcomeFor(players, rankings, handScores, viewerId, isTeamMode);
      if (outcome === "pending" || rankings.some((id) => !(id in handScores))) return;
      prevGameOverRef.current = true;
      const at = performance.now() + handOffDelayMs(reduceMotion) + motionMs("shift", reduceMotion);
      if (matchOver && matchWinners.length > 0) {
        event([{ kind: "partitaOver", won: celebratesViewer(players, [matchWinners[0]], viewerId, isTeamMode) }], at);
      } else {
        event([{ kind: "mancheOver", outcome }], at);
      }
    }, [gameOver, rankings, players, isTeamMode, handScores, viewerId, reduceMotion, matchOver, matchWinners]);
  ```

  The block comment above it keeps its paragraphs about the shake, `rankings` and `"pending"`. Replace its last sentence ("The verdict waits…") with: "The sting is placed in the engine at the landing's hold, so leaving the table cannot cancel it (#5); every ranked id must carry a score, which is also when an online partita's winners have arrived." That edits comment lines; it adds none.
- **Delete** `useEffect(() => cancelMusicDuck, []);` and its comment.
- **`playImpact`** becomes:

  ```ts
    const playImpact = useCallback(
      (heavy: boolean, dir: FlyDirection, cards: number) => {
        const landing = { cards, bomb: heavy, mine: dir === "bottom" };
        event([{ kind: "landing", ...landing }]);
        startLandingPulses(landing);
        if (heavy) impact();
      },
      [impact]
    );
  ```

- [ ] **Step 6: `GameTable.tsx`, `pile.tsx`, the screens and the layout**

**`components/GameTable.tsx`:**

- The imports at 105–107 become `import { event, uiFeedback } from "@/lib/device/feedback";`.
- Add a module-level `const roundStart = () => event([{ kind: "roundStart" }]);`.
- Add the props `matchWinners?: readonly string[]`, and pass `matchOver` and `matchWinners` into `useTableFeedback`.
- The `usePileFlight` input passes `playRoundStart: roundStart` and no `playRoundWin`.
- The deal effect becomes:

  ```tsx
    useEffect(() => {
      lockLandscape();
      const deal = setTimeout(() => event([{ kind: "deal" }]), entryMs);
      warmCourtArt();
      return () => {
        clearTimeout(deal);
        ScreenOrientation.unlockAsync().catch(() => {});
      };
    }, [entryMs]);
  ```

  Keep the comment about fast navigation above `lockLandscape()`. Delete the one about releasing players.
- In `handleCardPress`, `playCue({ kind: … })` becomes `event([{ kind: handSelectionRef.current.includes(id) ? "deselect" : "select" }])`.
- In `handlePlay`, `playCue({ kind: "reject" })` becomes `event([{ kind: "reject" }])`, and `hapticSelection()` becomes `uiFeedback("selection")`.
- In `handleExchangeGive`, `playCue` becomes `event([{ kind: "reject" }])` and `event([{ kind: "give" }])`.
- In `handlePass`, `hapticLight()` becomes `uiFeedback("light")`.

**`components/table/pile.tsx`:** delete `playRoundWin` from `PileFlightInput` and its destructuring. Delete the `playRoundWin();` line in the `roundWinnerTag` effect, and its dependency. The effect's first comment sentence changes to say that the round-win sting is the closing pass's event (`useTableFeedback`), and that the tag is only the banner.

**The screens:** `app/game.tsx` passes `matchWinners={match.winners}`, and `app/(online)/game.tsx` passes `matchWinners={matchState.winners}`, next to `matchOver`.

**`app/_layout.tsx`:** import `startFeedback` from `@/lib/device/feedback`, and add `useEffect(() => { void startFeedback(); }, []);` beside the web-unlock effect. From here to Task 10, the old path still drives music and the menus; both ship in one PR.

- [ ] **Step 7: Verify**

Run `node --test tests/tooling/diagnosticsGate.test.ts` and `node --test tests/tooling/audioOwners.test.ts`.

Run `npx tsc --noEmit -p .` and `npx eslint components app tests/native`.

Then **see the class guard go red**:

1. In `lib/device/feedback.ts`'s `flush`, temporarily replace the `batches` loop with `for (const p of pending) fire(p.moments, p.at, now);`.
2. Push. `oneSoundPerMoment` must fail on CI.
3. Revert that one line with Edit, and push again. Green.

Record both run ids in the PR body. Do not use `git checkout` or `git stash` for this.

- [ ] **Step 8: Commit**

```bash
git add -- components/useTableFeedback.ts components/GameTable.tsx components/table/pile.tsx app/game.tsx "app/(online)/game.tsx" app/_layout.tsx tests/native/tableTapFeedback.test.tsx tests/native/oneSoundPerMoment.test.tsx tests/native/landingHaptic.test.tsx tests/native/gameOverSting.test.tsx tests/native/helpers/botManche.ts
git commit -m "feat(#1259): the table raises moments, and each state change sounds one thing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Remove the old path; one mock

**Files:**
- Delete:
  - `lib/device/sounds.ts`, `music.ts`, `haptics.ts`, `cues.ts` and `playCue.ts`;
  - `assets/sounds/reconnected.mp3`;
  - `tests/ui-rules/tableCues.test.ts`;
  - the native tests listed in Step 4.
- Modify:
  - `app/_layout.tsx`, `context/SettingsContext.tsx` and `CONTEXT.md`;
  - `components/table/turnChip.tsx` and `components/RoomSeatList.tsx`;
  - the menus in Step 2;
  - `package.json`, `package-lock.json`, `app.json`, `eslint.config.js` and `.github/workflows/ci.yml`;
  - `tests/tooling/soundAssets.test.ts`, `tests/tooling/audioOwners.test.ts` and `tests/native/musicPlatform.test.tsx`.
- Test: `tests/tooling/oneAudioMock.test.ts` (new), `tests/native/musicRoute.test.tsx` (new) and `tests/native/everyMomentHasACaller.test.tsx` (new)

- [ ] **Step 1: The failing one-mock test**

`tests/tooling/oneAudioMock.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { moduleEdges } from "../helpers/moduleEdges.ts";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETUP = "tests/native/setup.ts";
const AUDIO = [
  "react-native-audio-api", "react-native-turbo-haptics", "expo-audio", "expo-haptics", "modules/murlan-audio-session",
  "lib/device/assetFiles", "lib/device/audioEngine", "lib/device/hapticsEngine", "lib/device/feedback",
  "lib/device/sounds", "lib/device/haptics", "lib/device/music", "lib/device/cues", "lib/device/playCue",
];

const mocks = (sources: [string, string][]) =>
  sources.flatMap(([file, text]) => moduleEdges(file, text).filter((e) => e.via === "mock" && AUDIO.includes(e.to)).map((e) => `${e.from} -> ${e.to}`));

test("the scan sees jest.mock and jest.doMock of an audio module by any spelling", () => {
  assert.deepEqual(
    mocks([
      ["tests/native/a.test.tsx", 'jest.mock("expo-audio", () => ({}));'],
      ["tests/native/b.test.tsx", 'jest.doMock("@/lib/device/feedback", () => ({}));'],
      ["tests/native/c.test.tsx", 'jest.mock("@/lib/device/other", () => ({}));'],
    ]),
    ["tests/native/a.test.tsx -> expo-audio", "tests/native/b.test.tsx -> lib/device/feedback"]
  );
});

test("only tests/native/setup.ts mocks an audio layer, and it mocks the four the engines import", () => {
  const found = mocks(sourcesUnder(repoRoot, ["tests"]));
  assert.deepEqual(found.filter((m) => !m.startsWith(`${SETUP} ->`)), []);
  assert.deepEqual(found.sort(), [
    `${SETUP} -> lib/device/assetFiles`, `${SETUP} -> modules/murlan-audio-session`, `${SETUP} -> react-native-audio-api`, `${SETUP} -> react-native-turbo-haptics`,
  ]);
});
```

Run `node --test tests/tooling/oneAudioMock.test.ts`. Expected: the floor passes, and the tree test fails, listing 81 files.

- [ ] **Step 2: The remaining callers**

**`app/_layout.tsx`:**

- delete the imports of `bindWebAudioUnlock` and of `playMusic`/`MusicTrack`;
- import `backgroundMusic` and `startFeedback` from `@/lib/device/feedback`, and `type TrackId` from `@/lib/device/musicTracks`;
- `trackForRoute` returns `TrackId`;
- the music effect becomes `if (!benchOwnsAudio) backgroundMusic(track);`;
- delete `useEffect(bindWebAudioUnlock, [])`, whose comment moves onto the `startFeedback` effect;
- the comment above the music effect says that `backgroundMusic` is a no-op for the track already playing, and that the engine restarts it after the app returns (`lib/device/audioEngine.ts`). That edits its lines.

**`context/SettingsContext.tsx`:** the imports at lines 3–5 become `import { setHapticsEnabled, setMusicVolume, setSoundVolume } from "@/lib/device/feedback";`. The three effects become:

```tsx
  useEffect(() => {
    setSoundVolume(settings.soundVolume);
  }, [settings.soundVolume]);

  // A volume of 0 stops the track in feedback.ts, so enabled and volume are one value and one setter.
  useEffect(() => {
    setMusicVolume(settings.musicVolume);
  }, [settings.musicVolume]);

  // lib/device/feedback.ts preloads this same key at module init, before this provider
  // mounts — pushing the unread default here would stomp a correctly-preloaded
  // `false` until the read above resolves.
  useEffect(() => {
    if (!readFinished) return;
    setHapticsEnabled(settings.hapticsEnabled);
  }, [settings.hapticsEnabled, readFinished]);
```

**`CONTEXT.md` § Feedback master state** now says:

- the globals live in `lib/device/feedback.ts`, driven by three setters from `context/SettingsContext.tsx`;
- the music pair became one setter, because a volume of 0 stops the track;
- the haptics effect stays gated on `readFinished`, because `feedback.ts` preloads the key;
- the advice against one `applyFeedbackSettings` entry point stands.

**`components/table/turnChip.tsx`:** the imports at 6–7 become `import { event, silence } from "@/lib/device/feedback";`. `stopClockRunningOut()` becomes `silence("clockRunningOut")`, and `playCue({ kind: "clockRunningOut" })` becomes `event([{ kind: "clockRunningOut" }])`.

**`components/RoomSeatList.tsx`:** the import at 8 becomes `import { uiFeedback } from "@/lib/device/feedback";`. Line 104 becomes `for (let i = 0; i < filled; i++) uiFeedback("seatFill");`, and line 105 becomes `if (filled > 0 && seated.size >= maxSeats) uiFeedback("roomFull");`.

**`app/(online)/room.tsx` and `app/result.tsx`:** delete the `holdSounds`/`preloadSounds` import and effect. The engine holds every buffer for the app's life.

**The menus.** In each file, the import from `@/lib/device/haptics` becomes `import { uiFeedback } from "@/lib/device/feedback";`. Each call maps:

| Old call | New call |
| --- | --- |
| `hapticSelection()` | `uiFeedback("selection")` |
| `hapticLight()` | `uiFeedback("light")` |
| `hapticMedium()` | `uiFeedback("medium")` |
| `hapticHeavy()` | `uiFeedback("heavy")` |
| `hapticRigid()` | `uiFeedback("rigid")` |
| `hapticSuccess()` | `uiFeedback("success")` |
| `hapticWarn()` | `uiFeedback("warn")` |
| `hapticError()` | `uiFeedback("error")` |

A bare reference passed as a callback (`onPress={hapticLight}`) becomes `() => uiFeedback("light")`; `tsc` flags any call left in callback position.

The files:

- `app/(online)/friends.tsx`, `app/(online)/game.tsx`, `app/(online)/index.tsx`, `app/(online)/replay.tsx`, `app/(online)/room.tsx`;
- `app/auth.tsx`, `app/game.tsx`, `app/index.tsx`, `app/lobby.tsx`, `app/result.tsx`, `app/tutorial.tsx`;
- `components/ChoiceChips.tsx`, `components/DifficultyLadder.tsx`, `components/LookPicker.tsx`, `components/ResultBoard.tsx`, `components/SettingsModal.tsx`;
- `components/table/rematchPrompt.tsx`.

Then `grep -rlE "lib/device/(sounds|haptics|music|cues|playCue)\"" app components context lib` must print nothing.

- [ ] **Step 3: Delete the old path**

- Delete `lib/device/sounds.ts`, `lib/device/music.ts`, `lib/device/haptics.ts`, `lib/device/cues.ts`, `lib/device/playCue.ts`, `assets/sounds/reconnected.mp3` and `tests/ui-rules/tableCues.test.ts`.
- Remove `"expo-audio"` and `"expo-haptics"` from `package.json`, and `"expo-audio"` from `app.json`'s `plugins`. Run `npm install --prefer-offline`. It removes packages and downloads nothing new; the lockfile follows.
- In `eslint.config.js`, add `"expo-audio": null, "expo-haptics": null` to `PACKAGE_OWNERS`.
- In `tests/tooling/audioOwners.test.ts`, add `"expo-audio": []` and `"expo-haptics": []` to `OWNERS`.
- In `tests/tooling/soundAssets.test.ts`:
  - the count becomes `19`, with the message "soundAssets.ts requires nineteen files";
  - delete the `"reconnected.mp3"` entry from `EXPECTED`;
  - `requiredFiles` now reads only `soundAssets.ts`, because `sounds.ts` no longer exists and the `existsSync` filter drops it.
- In `assets/sounds/README.md`, delete the `reconnected.mp3` row.

- [ ] **Step 4: One mock**

Every one of the 81 files gets two edits:

- delete each `jest.mock`/`jest.doMock` of expo-audio, expo-haptics, `@/lib/device/sounds`, `@/lib/device/haptics`, `@/lib/device/music`, `@/lib/device/playCue` or `@/lib/device/cues`, with the imports only those mocks used;
- where a test asserted on one of those mocks, assert through `tests/native/helpers/feedback.ts` instead, after `await bootFeedback()` in `beforeEach` under fake timers.

List the 81 with `grep -rlE "jest\.(mock|doMock)\(['\"](expo-audio|expo-haptics|@/lib/device/(sounds|haptics|music|playCue|cues))" tests`.

The assertion mapping:

| Old assertion | New assertion |
| --- | --- |
| `playCardSelect`, `playCardPlay`, `playCombo`, `playCardPass`, `playTurn`, `playDeal`, `playBomb`, `playExchange`, `playReject`, `playClockRunningOut`, `playMancheWon/Lost`, `playPartitaWon/Lost`, `playRoundStart`, `playRoundWin`, `playSeatFill`, `playRoomFull` called *n* times | `sounds().filter((s) => s === '<id>')` has length *n*. The ids are `select`, `play`, `combo`, `pass`, `turn`, `deal`, `bomb`, `exchange`, `reject`, `clockRunningOut`, `mancheWon/Lost`, `partitaWon/Lost`, `round_start`, `round_win`, `seat_fill` and `room_full`. |
| `playCardDeselect` | `'deselect'` |
| `Haptics.selectionAsync` | `haptics()` contains `'selection'` |
| `impactAsync(Light/Medium/Heavy/Rigid)` | `'impactLight'`, `'impactMedium'`, `'impactHeavy'`, `'rigid'` |
| `notificationAsync(Success/Warning/Error)` | `'notificationSuccess'`, `'notificationWarning'`, `'notificationError'` |
| `playMusic('x')` called once | `loops().map(fileOf)` equals `['x']` |

The files with such assertions:

- `gameOverSting` and `landingHaptic` (done in Task 9);
- `losingSeatHaptic`, `yourTurnCue`, `offlineAutoPass`, `passMarker`, `roomSeatFill`, `roundClose`, `roundWinnerBanner`, `seatDealArrival`, `stagedSelection` and `turnChipLabel`;
- `traceOnsetFollowsSettings`: rewrite over `event`/`uiFeedback`. The expected trace becomes `[['haptic', 'light'], ['sound', 'play']]`; the off cases use `setHapticsEnabled(false)` and `setSoundVolume(0)`.

Delete these, and name each one's heir in the PR body:

| Deleted test | What replaces it |
| --- | --- |
| `sounds.test.tsx` | `audioEngine.test.tsx` |
| `soundsHold.test.tsx`, `roomHoldsSounds.test.tsx` | nothing: there are no players to hold |
| `soundsImportIsInert.test.tsx` | the engine starts only in `startFeedback` |
| `haptics.test.tsx`, `hapticsWeb.test.tsx` | `hapticsEngine.test.tsx` |
| `hapticsBypass.test.tsx` | `audioOwners.test.ts` |
| `musicResume.test.tsx` | the two watchdog tests |
| `musicWebBuffers.test.tsx` | its rule is ported unchanged into `audioEngine.web.ts` (see Design questions) |

Rewrite `hapticsPreload.test.tsx` and `settingsHapticsRace.test.tsx` over `hapticsEnabled()` from `@/lib/device/feedback`, with the same stored `{ hapticsEnabled: false }` and the same assertions.

`musicRouteSameTrack.test.tsx` and `musicRouteReentry.test.tsx` become one file, `tests/native/musicRoute.test.tsx`. It keeps their three routes and asserts on `loops().map(fileOf)`:

- menu to menu starts nothing new;
- menu to game starts `hand` once;
- game to result to game starts `hand` again;
- no session call is made (`api().log` has no `'session'` after boot).

`tests/native/musicPlatform.test.tsx` keeps only the container test from Task 4; delete the rest, which tested `music.ts`.

- [ ] **Step 5: The binary no longer registers either old module**

ci.yml `android-build`, after the `MurlanDiagnosticsModule` grep:

```yaml
          if grep -qE "expo\.modules\.(audio|haptics)\." "$list"; then echo "::error::expo-audio or expo-haptics is still registered."; exit 1; fi
```

ci.yml `ios-build`, in "The diagnostics module is registered", after its grep:

```yaml
          if grep -qE "ExpoAudio|ExpoHaptics" ios/Podfile.lock "$provider"; then echo "::error::expo-audio or expo-haptics is still linked."; exit 1; fi
```

The `MurlanDiagnosticsModule` grep on the same file is the floor. Dispatch `gh workflow run ci.yml --ref <branch> -f native=true`, and read both jobs.

- [ ] **Step 5a: Every moment has a real caller**

Written here, after the last caller (`turnChip`'s `clockRunningOut`) has moved. Each probe renders the real component that raises its kind and returns the sounds heard during its action; `Record<MomentKind, …>` makes `tsc` refuse a new kind without a probe, and the key test catches a probe for a kind that no longer exists.

`tests/native/everyMomentHasACaller.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import { TurnChip } from '@/components/table/turnChip';
import { CLOCK_RUNNING_OUT_SECONDS } from '@/components/turnTimerUi';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import { MOMENTS, type MomentKind } from '@/lib/device/moments';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';
import { bootFeedback, settle, sounds } from './helpers/feedback';
import { botManche, STEP_MS } from './helpers/botManche';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const noop = () => {};
const SEVEN_H: Card = { id: '7_hearts', rank: '7', suit: 'hearts', isJoker: false };
const FIVE_H: Card = { id: '5_hearts', rank: '5', suit: 'hearts', isJoker: false };
const TWO_S: Card = { id: '2_spades', rank: '2', suit: 'spades', isJoker: false };
const seat = (id: string, hand: Card[]): Player => ({ id, name: id, hand, type: 'human' });
type Extra = { handScores?: Record<string, number>; matchOver?: boolean; matchWinners?: string[] };

const human = (turn: number, exchange = false): GameState => ({
  players: [seat('player_0', [SEVEN_H, FIVE_H]), seat('player_1', [TWO_S])],
  currentTurnIndex: turn,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
  ...(exchange ? { exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: TWO_S, bothJokersException: false } } : {}),
});

const table = (s: GameState, x: Extra = {}) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable gameState={s} viewerSeat={0} selectedIds={[]} onSelectCard={noop} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} handScores={{}} {...x} />
  </SafeAreaProvider>
);

const press = async (node: Parameters<typeof fireEvent.press>[0]) => act(async () => { fireEvent.press(node); });
const seven = () => screen.getAllByLabelText(cardSpokenName(SEVEN_H, t))[0];

async function heard(mount: React.ReactElement, action: (r: Awaited<ReturnType<typeof render>>) => Promise<void>): Promise<string[]> {
  const r = await render(mount);
  await settle(2000);
  const before = sounds().length;
  await action(r);
  await settle(2000);
  const out = sounds().slice(before);
  await r.unmount();
  return out;
}

async function wholeManche(): Promise<string[]> {
  const states = botManche();
  const r = await render(table(states[0]));
  for (const s of states.slice(1)) {
    await act(async () => r.rerender(table(s)));
    await settle(STEP_MS);
  }
  const out = sounds();
  await r.unmount();
  return out;
}

async function mancheEnd(x: (last: GameState) => Extra): Promise<string[]> {
  const states = botManche();
  const last = states[states.length - 1];
  const scores = Object.fromEntries(last.rankings.map((id, i) => [id, i]));
  return heard(table(states[states.length - 2]), async (r) => {
    await act(async () => r.rerender(table(last, { handScores: scores, ...x(last) })));
  });
}

let manche: Promise<string[]> | undefined;
const botSounds = () => (manche ??= wholeManche());

const PROBES: Record<MomentKind, { sounds: string[]; run: () => Promise<string[]> }> = {
  landing: { sounds: ['play', 'combo', 'bomb'], run: botSounds },
  pass: { sounds: ['pass'], run: botSounds },
  roundWon: { sounds: ['round_win'], run: botSounds },
  roundStart: { sounds: ['round_start'], run: botSounds },
  deal: { sounds: ['deal'], run: botSounds },
  turn: { sounds: ['turn'], run: () => heard(table(human(1)), async (r) => { await act(async () => r.rerender(table(human(0)))); }) },
  select: { sounds: ['select'], run: () => heard(table(human(0)), () => press(seven())) },
  deselect: { sounds: ['deselect'], run: () => heard(table(human(0)), async () => { await press(seven()); await settle(500); await press(seven()); }) },
  reject: { sounds: ['reject'], run: () => heard(table(human(0)), () => press(screen.getByTestId('btn-gioca'))) },
  give: { sounds: ['play'], run: () => heard(table(human(0, true)), async () => { await press(seven()); await press(screen.getByTestId('btn-gioca')); }) },
  exchange: { sounds: ['exchange'], run: () => heard(table(human(0)), async (r) => { await act(async () => r.rerender(table(human(0, true)))); }) },
  mancheOver: { sounds: ['mancheWon', 'mancheLost', 'mancheNeutral'], run: () => mancheEnd(() => ({})) },
  partitaOver: { sounds: ['partitaWon', 'partitaLost'], run: () => mancheEnd((last) => ({ matchOver: true, matchWinners: [last.rankings[0]] })) },
  clockRunningOut: {
    sounds: ['clockRunningOut'],
    run: () => heard(<TurnChip seconds={CLOCK_RUNNING_OUT_SECONDS + 1} active resetKey="t" scale={1} lit chipText="" spokenSeat="" />, () => settle(2000)),
  },
};

describe('every moment the policy knows is raised by a real caller', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => jest.useRealTimers());

  it('has one probe per moment kind, and no other', () => {
    expect(Object.keys(PROBES).sort()).toEqual(Object.keys(MOMENTS).sort());
  });

  it.each(Object.keys(PROBES) as MomentKind[])('%s', async (kind) => {
    const { sounds: expected, run } = PROBES[kind];
    const got = await run();
    expect(got.some((s) => expected.includes(s))).toBe(true);
  });
});
```

`botSounds` renders the whole manche once and five kinds read it; `sounds()` maps into a new array, so the memoised result is that run's snapshot. `give` sounds `play`, which no landing can supply here: the exchange fixture throws nothing.

**See it go red** (as Task 9 Step 7): delete the `event([{ kind: "clockRunningOut" }])` line in `turnChip.tsx` with Edit and push; `everyMomentHasACaller › clockRunningOut` must fail on CI. Restore it with Edit and push again. Record both run ids in the PR body.

- [ ] **Step 6: Verify**

Run each on its own:

- `node --test tests/tooling/oneAudioMock.test.ts`
- `node --test tests/tooling/audioOwners.test.ts`
- `node --test tests/tooling/soundAssets.test.ts`
- `node --test tests/tooling/diagnosticsGate.test.ts`

Then run `npx tsc --noEmit -p .` and `npx eslint app components context lib tests eslint.config.js`. Expected: clean.

Push. jest (both projects) and the browser suites must be green on CI.

- [ ] **Step 7: Commit**

```bash
git add -- app components context lib CONTEXT.md package.json package-lock.json app.json eslint.config.js .github/workflows/ci.yml assets/sounds tests
git commit -m "refactor(#1259): remove expo-audio and expo-haptics; one mock of each audio layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The pathspec `tests` is safe here only because this task edits nothing else in `tests/`. Check `git status --porcelain tests` first; stage by file if anything unrelated shows.

---

### Task 11: Device gates G1–G6

**Files:**
- Create: `lib/diagnostics/scenarios/pulseCost.ts`, `tapBurst.ts`, `scheduledOnset.ts`, `hapticOnset.ts` and `musicSwitch.ts`
- Modify: `lib/diagnostics/scenarios/index.ts`, `scripts/diagnostics-verdict.mjs` and `docs/agents/checks.md`
- Test: `tests/tooling/diagnosticsVerdict.test.ts`

**The gates.** Each one runs on the owner's iPhone, in the Release bench build that `npm run ios:device -- --bench` installs (Task 1); a verdict from any other build is `pass: null`, unrun. Production ships none of them (the Task 1 and Task 3 checks).

| Gate | Metric | Threshold | Scenario |
| --- | --- | --- | --- |
| P | The worklet pulse's own cost on the UI thread: the first fire after launch (which follows ReplayKit's prompt, a resign-active), and p90 of 20 warm fires | cold ≤ 8.33 ms (one 120 Hz frame); warm p90 ≤ 1 ms | `pulseCost`, registered first so its first fire is the app's first |
| G1 | The one stall gate (design §8), `burstStalls`: any UI frame or JS-lag interval ≥ 34 ms, merged within 100 ms; and the share of 250 ms windows at ≥ 100 Hz. Missing: a tap with no app-track onset in [tap, tap + 150 ms), each onset matched to one tap | 0 stalls, fast share ≥ 0.8, 0 missing | `tapBurst`: 60 card presses at 6 Hz through `benchHandles.cardPress`, once with feedback off, then once with it on |
| G2 | Tap to heard onset, p90: app-track onset + `outputMs` + `ioMs`/2 − tap | ≤ 40 ms | `tapBurst`, "on" arm |
| G3 | Scheduled onset error, p90 of \|mic onset − `inputMs` − at\|; reported beside it, the app-track error \|app onset − (at − lead)\| | ≤ 25 ms | `scheduledOnset`: 40 `turn` events at now + 300 ms, one a second |
| G4 | Pulse to accelerometer onset (> 0.02 g), p90; missing (none within 150 ms) | ≤ 40 ms; 0 | `hapticOnset`: 30 `landingPulse("heavy")` from `scheduleOnUI`, each stamped on the UI thread |
| G5 | Music deaths (2 s all below −50 dB) and gaps (below −50 dB for longer than 250 ms) | 0 and 0, with the floor median level > −40 dB | `musicSwitch`: 40 switches, one every 3 s |
| G6 | The Task 8 soak gate | as Task 8 | `soak`, 30 minutes on the phone, ReplayKit capture off |

**Why 150 ms and one onset per tap.** The design's 500 ms window is longer than the 167 ms between taps, so a silent tap would borrow the next tap's onset and pass. A window shorter than the spacing, with each onset used once, makes one removed onset one missing tap; the planted test below removes exactly one. Each tap raises one play, so a play without an onset is a missing tap.

**Why the mic for G3.** The app track is stamped when the engine renders a sample, before the output path; only the mic hears when the speaker sounds. The engine schedules `outputMs + ioMs/2` early (Task 5), so the app-track error checks the engine's arithmetic and the mic error checks that the arithmetic matches the speaker. The mic subtraction assumes ReplayKit stamps a mic buffer when it is delivered; if the first run's `medianErr` sits near `-inputMs`, the stamp is the air time, and the lead drops the subtraction.

- [ ] **Step 1: The failing verdict tests**

Append to `tests/tooling/diagnosticsVerdict.test.ts` one test per gate. Every row carries `t` in the `performance.now()` timebase (Task 1, `types.ts`); the clock conversion happens on the phone, and G2's "every latency > 0" is its device-side floor: a wrong conversion puts onsets before their taps.

```ts
const LATENCY = { k: "latency", t: 0, outputMs: 8, ioMs: 5, inputMs: 10 };
const run = (name: string, inner: object[]) => bracket("d", name, [LATENCY, ...inner]);
const onset = (t: number, source: "app" | "mic" = "app") => ({ k: "onset", t, db: -20, source });

type Arm = { onsetMs?: number; drop?: number; ui?: number; js?: number; hz?: number; ticks?: number };

function arm(name: string, on: boolean, o: Arm = {}): object[] {
  const end = 1000 + 60 * 167 + 600;
  const rows: object[] = [{ k: "arm", t: 0, name, phase: "start" }];
  const dt = 1000 / (o.hz ?? 120);
  for (let t = 1000; t < end; t += dt) rows.push({ k: "frame", t, dt });
  for (let i = 0; i < 60; i++) {
    const t = 1000 + i * 167;
    rows.push({ k: "trigger", t, name: "tap" });
    if (!on) continue;
    rows.push({ k: "play", t, id: "select", at: t, bus: "sfx", dropped: false, lead: 10.5 });
    if (i !== o.drop) rows.push(onset(t + (o.onsetMs ?? 20)));
  }
  if (o.ui) rows.push({ k: "frame", t: o.ui, dt: 40 });
  if (o.js) rows.push({ k: "jsLag", t: o.js, dt: 40 });
  rows.push({ k: "jsTicks", t: end, n: o.ticks ?? 1200 }, { k: "arm", t: end + 1, name, phase: "end" });
  return rows;
}

const burst = (o: Arm) => verdict(run("tapBurst", [...arm("off", false), ...arm("on", true, o)]), "tapBurst");

test("tapBurst passes 60 taps heard in 30.5 ms at 120 Hz with no stall on either thread", () => {
  const v = burst({});
  assert.equal(v?.pass, true);
  assert.equal(v?.metrics.tapToHeardP90, 30.5);
});

test("tapBurst fails one silent tap, a UI stall, a JS stall, a 60 Hz burst, no JS ticks, a slow onset, or an onset before its tap", () => {
  assert.equal(burst({ drop: 17 })?.metrics.missing, 1);
  assert.equal(burst({ drop: 17 })?.pass, false);
  assert.equal(burst({ ui: 5000 })?.metrics.stalls, 1);
  assert.equal(burst({ ui: 5000 })?.pass, false);
  assert.equal(burst({ js: 5000 })?.pass, false);
  assert.equal(burst({ hz: 60 })?.pass, false);
  assert.equal(burst({ ticks: 0 })?.pass, false);
  assert.equal(burst({ onsetMs: 40 })?.pass, false);
  assert.equal(burst({ onsetMs: -30 })?.pass, false);
});

test("burstStalls merges a UI and a JS stall 60 ms apart into one, and keeps two 200 ms apart", () => {
  const rows = (gap: number) => [{ k: "frame", t: 1000, dt: 40 }, { k: "jsLag", t: 1000 + gap, dt: 40 }];
  assert.equal(burstStalls(rows(60)).stalls, 1);
  assert.equal(burstStalls(rows(200)).stalls, 2);
});

test("scheduledOnset judges the mic: passes a 10 ms bias, fails a 30 ms one, fails a missing onset, and reports the app track", () => {
  const rows = (err: number, n = 40) =>
    run("scheduledOnset", Array.from({ length: 40 }, (_, i) => {
      const at = 1000 + i * 1000;
      return [
        { k: "trigger", t: at, name: "scheduled" },
        { k: "play", t: at - 300, id: "turn", at, bus: "sfx", dropped: false, lead: 10.5 },
        onset(at - 10.5 + 2, "app"),
        ...(i < n ? [onset(at + err + 10, "mic")] : []),
      ];
    }).flat());
  const good = verdict(rows(10), "scheduledOnset");
  assert.equal(good?.pass, true);
  assert.equal(good?.metrics.appMedianErr, 2);
  assert.equal(verdict(rows(30), "scheduledOnset")?.pass, false);
  assert.equal(verdict(rows(10, 39), "scheduledOnset")?.pass, false);
});

test("pulseCost passes a 5 ms cold fire and 0.3 ms warm ones, and fails a slow cold, a slow warm p90 or a short run", () => {
  const rows = (cold: number, warm: number, n = 20) =>
    run("pulseCost", [{ k: "pulseCost", t: 1, ms: cold, cold: true }, ...Array.from({ length: n }, (_, i) => ({ k: "pulseCost", t: 2 + i, ms: warm, cold: false }))]);
  assert.equal(verdict(rows(5, 0.3), "pulseCost")?.pass, true);
  assert.equal(verdict(rows(12, 0.3), "pulseCost")?.pass, false);
  assert.equal(verdict(rows(5, 2), "pulseCost")?.pass, false);
  assert.equal(verdict(rows(5, 0.3, 19), "pulseCost")?.pass, false);
});

test("hapticOnset passes 30 shakes 20 ms after their pulses, and fails a missing one or a slow p90", () => {
  const rows = (lag: (i: number) => number | null) =>
    run("hapticOnset", Array.from({ length: 30 }, (_, i) => {
      const t = 1000 + i * 1000;
      const l = lag(i);
      return [{ k: "trigger", t, name: "pulse" }, ...(l === null ? [] : [{ k: "shake", t: t + l, g: 0.05 }])];
    }).flat());
  assert.equal(verdict(rows(() => 20), "hapticOnset")?.pass, true);
  assert.equal(verdict(rows((i) => (i === 3 ? null : 20)), "hapticOnset")?.pass, false);
  assert.equal(verdict(rows((i) => (i < 5 ? 80 : 20)), "hapticOnset")?.pass, false);
});

test("musicSwitch passes steady music, and fails a 300 ms gap, a 2 s death, or music too quiet to judge", () => {
  const rows = (db: (t: number) => number) =>
    run("musicSwitch", [
      ...Array.from({ length: 40 }, (_, i) => ({ k: "trigger", t: 1000 + i * 3000, name: "switch" })),
      ...Array.from({ length: 2400 }, (_, i) => ({ k: "level", t: 1000 + i * 50, db: db(1000 + i * 50) })),
    ]);
  assert.equal(verdict(rows(() => -25), "musicSwitch")?.pass, true);
  assert.equal(verdict(rows((t) => (t >= 30000 && t < 30300 ? -60 : -25)), "musicSwitch")?.pass, false);
  assert.equal(verdict(rows((t) => (t >= 30000 && t < 32100 ? -60 : -25)), "musicSwitch")?.metrics.deaths, 1);
  assert.equal(verdict(rows(() => -45), "musicSwitch")?.pass, false);
});
```

Add `burstStalls` to the file's import from `../../scripts/diagnostics-verdict.mjs`.

Every threshold in these rows is chosen on either side of the design's number (40, 34, 25, 150 and 250 ms; 100 Hz and 0.8; 8.33 and 1 ms; −50 and −40 dB). None is read from the script.

Run `node --test tests/tooling/diagnosticsVerdict.test.ts`. Expected: FAIL, because the four gates are missing.

- [ ] **Step 2: The gates**

In `scripts/diagnostics-verdict.mjs`, above `export const GATES`, add:

```js
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const p90 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.ceil(s.length * 0.9) - 1] : NaN;
};

const times = (rows, k, name) => rows.filter((r) => r.k === k && (name === undefined || r.name === name)).map((r) => r.t);
const firstIn = (times, from, to) => times.filter((t) => t >= from && t <= to).sort((a, b) => a - b)[0];
const onsetsOf = (rows, source) => rows.filter((r) => r.k === "onset" && r.source === source).map((r) => r.t);

function armRows(rows, name) {
  const start = rows.findIndex((r) => r.k === "arm" && r.name === name && r.phase === "start");
  const end = rows.findIndex((r, i) => i > start && r.k === "arm" && r.name === name && r.phase === "end");
  return start === -1 || end === -1 ? [] : rows.slice(start, end + 1);
}

// Each onset answers one window, so a silent trigger cannot borrow its neighbour's.
function matchOnsets(starts, onsets, windowMs) {
  const sorted = [...onsets].sort((a, b) => a - b);
  const used = new Set();
  return starts.map((s) => {
    const i = sorted.findIndex((o, j) => !used.has(j) && o >= s && o < s + windowMs);
    if (i === -1) return null;
    used.add(i);
    return sorted[i];
  });
}

export function burstStalls(rows) {
  const frames = rows.filter((r) => r.k === "frame");
  const spans = [...frames, ...rows.filter((r) => r.k === "jsLag")]
    .filter((r) => r.dt >= 34)
    .map((r) => [r.t - r.dt, r.t])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of spans) {
    const last = merged.at(-1);
    if (last && s[0] - last[1] <= 100) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const perWindow = new Map();
  for (const f of frames) perWindow.set(Math.floor(f.t / 250), (perWindow.get(Math.floor(f.t / 250)) ?? 0) + 1);
  const counts = [...perWindow.values()];
  const jsTicks = rows.filter((r) => r.k === "jsTicks").reduce((n, r) => n + r.n, 0);
  return {
    stalls: merged.length,
    fastShare: counts.length ? counts.filter((n) => n * 4 >= 100).length / counts.length : 0,
    frames: frames.length,
    jsTicks,
  };
}

function tapBurst(rows) {
  const on = armRows(rows, "on");
  const latency = rows.find((r) => r.k === "latency");
  const lead = (latency?.outputMs ?? NaN) + (latency?.ioMs ?? NaN) / 2;
  const taps = times(on, "trigger", "tap");
  const matched = matchOnsets(taps, onsetsOf(on, "app"), 150);
  const heard = taps.flatMap((t, i) => (matched[i] === null ? [] : [matched[i] - t + lead]));
  const plays = on.filter((r) => r.k === "play" && !r.dropped).length;
  const missing = matched.filter((m) => m === null).length;
  const b = burstStalls(on);
  const off = burstStalls(armRows(rows, "off"));
  const metrics = { taps: taps.length, plays, missing, ...b, stallsOff: off.stalls, fastShareOff: off.fastShare, tapToHeardP90: p90(heard), leadMs: lead };
  const pass =
    taps.length === 60 && plays >= 60 && missing === 0 && b.frames > 0 && b.jsTicks > 0 &&
    b.stalls === 0 && b.fastShare >= 0.8 && p90(heard) <= 40;
  return { pass, metrics };
}

function scheduledOnset(rows) {
  const latency = rows.find((r) => r.k === "latency");
  const inputMs = latency?.inputMs ?? NaN;
  const lead = median(rows.filter((r) => r.k === "play" && !r.dropped).map((r) => r.lead));
  const triggers = times(rows, "trigger", "scheduled");
  const mic = matchOnsets(triggers.map((at) => at - 100), onsetsOf(rows, "mic").map((t) => t - inputMs), 300);
  const app = matchOnsets(triggers.map((at) => at - lead - 100), onsetsOf(rows, "app"), 300);
  const errors = triggers.flatMap((at, i) => (mic[i] === null ? [] : [mic[i] - at]));
  const appErrors = triggers.flatMap((at, i) => (app[i] === null ? [] : [app[i] - (at - lead)]));
  const metrics = {
    scheduled: triggers.length, matched: errors.length, absP90: p90(errors.map(Math.abs)), medianErr: median(errors),
    appAbsP90: p90(appErrors.map(Math.abs)), appMedianErr: median(appErrors),
    outputMs: latency?.outputMs ?? null, ioMs: latency?.ioMs ?? null, inputMs: latency?.inputMs ?? null, leadMs: lead,
  };
  return { pass: triggers.length === 40 && errors.length === 40 && p90(errors.map(Math.abs)) <= 25, metrics };
}

function pulseCost(rows) {
  const costs = rows.filter((r) => r.k === "pulseCost");
  const cold = costs.find((r) => r.cold)?.ms ?? NaN;
  const warm = costs.filter((r) => !r.cold).map((r) => r.ms);
  return { pass: warm.length === 20 && cold <= 8.33 && p90(warm) <= 1, metrics: { coldMs: cold, warmP90Ms: p90(warm), warm: warm.length } };
}

function hapticOnset(rows) {
  const pulses = times(rows, "trigger", "pulse");
  const shakes = times(rows, "shake");
  const lags = pulses.flatMap((p) => {
    const s = firstIn(shakes, p, p + 150);
    return s === undefined ? [] : [s - p];
  });
  const metrics = { pulses: pulses.length, matched: lags.length, p90: p90(lags), missing: pulses.length - lags.length };
  return { pass: pulses.length === 30 && lags.length === 30 && p90(lags) <= 40, metrics };
}

function musicSwitch(rows) {
  const switches = rows.filter((r) => r.k === "trigger" && r.name === "switch");
  const from = switches[0]?.t ?? Infinity;
  const levels = rows.filter((r) => r.k === "level" && r.t >= from).sort((a, b) => a.t - b.t);
  let quiet = 0;
  let gaps = 0;
  let deaths = 0;
  const close = () => {
    if (quiet > 250) gaps++;
    if (quiet >= 2000) deaths++;
    quiet = 0;
  };
  for (const l of levels) {
    if (l.db < -50) quiet += 50;
    else close();
  }
  close();
  const level = median(levels.map((l) => l.db));
  const metrics = { switches: switches.length, levels: levels.length, medianDb: level, gaps, deaths };
  return { pass: switches.length === 40 && levels.length >= 1900 && level > -40 && gaps === 0 && deaths === 0, metrics };
}
```

`GATES` becomes `{ pulseCost, idle, tapBurst, scheduledOnset, hapticOnset, musicSwitch, smoke, soak }`, with `idle` as a named function. That order is the bench's run order. `burstStalls` is the one stall rule: plan 4's tap and throw scenarios call it from their own `GATES` entries instead of keeping a second verdict.

- [ ] **Step 3: The scenarios**

`lib/diagnostics/scenarios/tapBurst.ts`:

```ts
import { setHapticsEnabled, setSoundVolume } from "@/lib/device/feedback";
import { registerBenchScenario } from "../bench";
import { benchTable } from "../benchTable";
import { benchHandles, diag } from "../index";

registerBenchScenario("tapBurst", async (ctx) => {
  const state = benchTable();
  await ctx.showTable(state);
  await ctx.sleep(3000);
  const card = state.players[0].hand[0].id;
  if (!benchHandles.cardPress) throw new Error("no table registered its card press");
  for (const name of ["off", "on"] as const) {
    setSoundVolume(name === "on" ? 1 : 0);
    setHapticsEnabled(name === "on");
    diag({ k: "arm", t: performance.now(), name, phase: "start" });
    ctx.frames(true);
    for (let i = 0; i < 60; i++) {
      diag({ k: "trigger", t: performance.now(), name: "tap" });
      benchHandles.cardPress?.(card);
      await ctx.sleep(167);
    }
    await ctx.sleep(600);
    ctx.frames(false);
    await ctx.sleep(200);
    diag({ k: "arm", t: performance.now(), name, phase: "end" });
  }
  setSoundVolume(1);
  setHapticsEnabled(true);
  await ctx.showTable(null);
});
```

`lib/diagnostics/scenarios/scheduledOnset.ts`:

```ts
import { event, setSoundVolume } from "@/lib/device/feedback";
import { registerBenchScenario } from "../bench";
import { diag } from "../index";

registerBenchScenario("scheduledOnset", async (ctx) => {
  setSoundVolume(1);
  for (let i = 0; i < 40; i++) {
    const at = performance.now() + 300;
    diag({ k: "trigger", t: at, name: "scheduled" });
    event([{ kind: "turn" }], at);
    await ctx.sleep(1000);
  }
  await ctx.sleep(500);
});
```

`lib/diagnostics/scenarios/hapticOnset.ts`:

```ts
import { makeMutable } from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";
import { landingPulse, setHapticsEnabled } from "@/lib/device/feedback";
import { registerBenchScenario } from "../bench";
import { diag, jsFromWall } from "../index";
import { probe } from "../probe";

const stamps = makeMutable<number[]>([]);

function fire(): void {
  "worklet";
  stamps.value = [...stamps.value, Date.now()];
  landingPulse("heavy");
}

registerBenchScenario("hapticOnset", async (ctx) => {
  setHapticsEnabled(true);
  stamps.value = [];
  if (!probe.startMotion()) throw new Error("no accelerometer");
  await ctx.sleep(1000);
  for (let i = 0; i < 30; i++) {
    scheduleOnUI(fire);
    await ctx.sleep(1000);
  }
  probe.stopMotion();
  const toJs = jsFromWall();
  for (const wall of stamps.value) diag({ k: "trigger", t: toJs(wall), name: "pulse" });
});
```

`lib/diagnostics/scenarios/musicSwitch.ts`:

```ts
import { backgroundMusic, setMusicVolume } from "@/lib/device/feedback";
import type { TrackId } from "@/lib/device/musicTracks";
import { registerBenchScenario } from "../bench";
import { diag } from "../index";

const TRACKS: TrackId[] = ["menu", "hand", "cue"];

registerBenchScenario("musicSwitch", async (ctx) => {
  setMusicVolume(1);
  for (let i = 0; i < 40; i++) {
    diag({ k: "trigger", t: performance.now(), name: "switch" });
    backgroundMusic(TRACKS[i % TRACKS.length]);
    await ctx.sleep(3000);
  }
});
```

`lib/diagnostics/scenarios/pulseCost.ts`:

```ts
import { makeMutable } from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";
import { landingPulse, setHapticsEnabled } from "@/lib/device/feedback";
import { registerBenchScenario } from "../bench";
import { diag } from "../index";

const costs = makeMutable<number[]>([]);

function timed(): void {
  "worklet";
  if (typeof performance === "undefined" || typeof performance.now !== "function") {
    costs.value = [...costs.value, NaN];
    return;
  }
  const t = performance.now();
  landingPulse("heavy");
  costs.value = [...costs.value, performance.now() - t];
}

registerBenchScenario("pulseCost", async (ctx) => {
  setHapticsEnabled(true);
  costs.value = [];
  for (let i = 0; i < 21; i++) {
    scheduleOnUI(timed);
    await ctx.sleep(300);
  }
  if (costs.value.some(Number.isNaN)) throw new Error("the UI runtime has no performance.now");
  costs.value.forEach((ms, i) => diag({ k: "pulseCost", t: performance.now(), ms, cold: i === 0 }));
});
```

It is registered first, so its first fire is the app's first pulse, straight after the capture prompt's resign-active. The cost is measured around `landingPulse` alone, so the array copy that records it is outside the figure.

`lib/diagnostics/scenarios/index.ts` becomes:

```ts
import "./pulseCost";
import "./idle";
import "./tapBurst";
import "./scheduledOnset";
import "./hapticOnset";
import "./musicSwitch";
import "./soak";
```

- [ ] **Step 4: Verify**

Run `node --test tests/tooling/diagnosticsVerdict.test.ts` (PASS), then `node --test tests/tooling/diagnosticsGate.test.ts`.

Run `npx tsc --noEmit -p .` and `npx eslint lib/diagnostics scripts/diagnostics-verdict.mjs`.

The scenarios' own `event` calls cannot stand in for a real caller: `everyMomentHasACaller` renders the table and the chip, never the bench.

- [ ] **Step 5: Ask the owner to run the bench (D8)**

Post this to the owner, and wait:

> The device gates need about 40 minutes of your iPhone, untouched.
> 1. On the PC: `npm run ios:device -- --ref <branch> --bench`. It installs the Release bench build from `ios-bench.yml` (building it first if the branch has none) and starts the collector. It prints the phone link with the PC's address.
> 2. On the phone: open that link in Safari (`murlan://bench?host=<PC address>&scenario=all`) and tap Open.
> 3. Allow the microphone prompt and the screen-recording prompt once each (they record the app's own audio and the speaker, for onsets).
> 4. Lay the phone face up on a table, plugged in, with the volume at about half and the ringer on. Leave it alone until the page lists `soak: done`.
> 5. On the PC: `node scripts/diagnostics-verdict.mjs diagnostics/<newest>.ndjson all`, and paste the output into the PR.

On a red gate, report the metrics to the lead; do not change a threshold. A `pass: null` is not a result: the run was not on the bench build, and is rerun with `--bench`. If G3 fails with a steady mic `medianErr` while `appMedianErr` is near 0, the engine's arithmetic holds and the lead model (`outputMs + ioMs/2`) misses the route; report both, not a new engine.

- [ ] **Step 6: Document**

In `docs/agents/checks.md` § "Device bench (diagnostics builds)", add the gate table above, the two "Why" paragraphs as one sentence each, and the owner's five steps.

- [ ] **Step 7: Commit**

```bash
git add -- lib/diagnostics/scenarios scripts/diagnostics-verdict.mjs docs/agents/checks.md tests/tooling/diagnosticsVerdict.test.ts
git commit -m "feat(#1259): device gates G1-G6 on the bench, judged on the laptop from raw rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- **Coverage.** Each finding row maps to a task and to a test that is red first:
  - #1/#10 → Tasks 5, 6, 9, `tableTapFeedback` and G1;
  - #2 silent plays → Task 5's engine tests, G1 and G2;
  - #2 pile-ups → `mixPolicy` and `oneSoundPerMoment`;
  - #5 → `gameOverSting` and `everyMomentHasACaller`;
  - #6 → `landingHaptic`, carried forward with its exact 255/256 and 415/416;
  - #7 → the watchdog tests and G5;
  - #8 → the build row, `unrun`, and `ios-bench.yml`;
  - #1231 → the `--flinger` gate; #1238 → `audioApiPatch`.

  The contrarian review's items: `at` passed through (Tasks 5, 7); one onset per tap in a 150 ms window (Task 11); Release-only verdicts (Task 1); `t` required on every row kind (Task 1); the landing pulses unchanged; stop-and-cancel on background (Task 5); the watchdog's nudge, retry and early listener (Task 5); the production session module and mic calibration (Tasks 3, 5, 11); the caller guard as a native render test (Task 10); buffer release and two resident tracks (Task 5); the smoke (Task 8); the fitted lag and the underrun gate (Task 8); one stall rule with the JS probe (Tasks 1, 11); #1238 and the pulse's cost (Tasks 5, 11); and the LOW items (Tasks 2, 5).

  The coordinator's list is covered too:
  - the libraries (Task 2); the local diagnostics module (Task 3);
  - the release builds with the defaults off (Task 2); the soak (Task 8);
  - the engine points (Task 5): one context, the session once, `disableSessionManagement` decided from source, the watchdog, drop-not-queue, `localUri`, no `onEnded`, three buses, FLAC in `native/`, the two-ramp crossfade, no library call from a worklet;
  - turbo-haptics (Task 6); callers, D6 and the class guards (Tasks 7 and 9); removal and one mock (Task 10); the device gates (Task 11).
- **Placeholders.** None. One value is taken from its artefact: the `EXPECTED` seconds and LUFS of the new `manche_neutral.mp3`, pinned once from the test's own printout (Task 7 Step 5). The relative loudness test beside it does not depend on that pin.
- **Names across tasks:**
  - `SOUND_FILES`, `SOUNDS`, `SoundId`, `TrackId`, `localFiles`;
  - `startAudio`, `play`, `ramp`, `music`, `setBusTrim`, `cut`, `durationMs`, `audioState`, `engineStats`;
  - `setHapticsGate`, `pulse`, `tap`;
  - `LANDING_PULSES`, `landingPulsesFor`, `runLandingPulses`, `startLandingPulses`, `cancelLandingPulses`, `landingPulse`;
  - `event`, `uiFeedback`, `backgroundMusic`, `silence`;
  - `benchBuild`, `startJsLag`, `burstStalls`, `matchOnsets`, `flingerUnderruns`, `flingerVerdict`, `artifactFor`, `benchUrl`, `botManche`, `ctxAt`.

  Each is defined once and used under that name. `TapHaptic` and `PulseStrength` come only from `hapticsEngine`, re-exported by `feedback`.
- **One timebase for diagnostics.** Every row has `t` in `performance.now()` ms. The two conversions sit on the phone, each with its offset sampled back to back: `jsFromWall` (UI-thread stamps) and `probe.drain` (host clock). The verdict converts nothing. Row kinds are added only as keys of `DiagRows`.
- **Every check's floor:**
  - the source scans: planted sources in `diagnosticsGate`, `audioOwners`, `oneAudioMock`, and `musicAssets`/`soundAssets` via `required.length > 0`;
  - the gitignore test checks that `ios/Podfile` is ignored;
  - the CI absence greps sit under presence greps (the embedded bundle for the native marks), and never use `! grep` under `set -e`;
  - the build mark is checked both ways;
  - the verdicts fail on too few rows, on dropped rows and on a thrown scenario, and are `null` on a non-Release build; G1 needs frames and JS ticks, `--flinger` a counter line, the smoke five engine samples;
  - `oneSoundPerMoment` needs at least 6 starts and is seen red with the batching off; `everyMomentHasACaller` has a key-equality test and is seen red with one caller deleted.
- **Timing tests.** None derives its expectation from the constant it tests:
  - 40, 34, 25, 150, 600, 60, 400, 300, 256, 416, 9 dB, 250, 8.33 and 1 ms are the spec's or the review's, written as literals;
  - `landingHaptic` pins the bomb's offsets against `KICK_JOLTS`, a different module, which is the agreement that matters;
  - `gameOverSting` keeps its existing `handOffDelayMs + motionMs('shift')`. That pins the sting to the hand-off's hold, not a number.
- **The comment budget.** New comment lines in code: the collector and verdict usage lines (2), `matchOnsets` (1), the Swift clock line (1), `musicTracks*.ts` (2 docblocks), the mock's header (1), `audioEngine.ts` (4), `audioEngine.web.ts` (3), `soundAssets` scan (1), `feedback.ts` (3), `SettingsContext.tsx` (1 new), and the headers of `audio-soak.yml` and `ios-bench.yml` (2). That is 22, against thousands of code lines, so under the budget. Each is an invisible constraint, a why, or a pointer.
- **The CLAUDE.md invariants.** They are listed above, and none is weakened. `impactDelayMs` stays the landing's trigger until plan 2.

## Design questions for the lead

1. **Resolved by the review: the scheduling error bound.** `modules/murlan-audio-session` is a production iOS module; `when()` schedules `outputLatency + ioBufferDuration/2` early, and G3 checks that against the mic. Android reports no latency through it and schedules uncompensated (`outputMs` 0); the CI soak does not judge onset timing, so no Android number exists yet.
2. **`modules/murlan-diagnostics` is compiled into every binary,** App Store build included, and reachable only from a diagnostics bundle.
   - The ReplayKit and CoreMotion frameworks are linked but never called.
   - The alternative is an env-gated autolinking exclusion. That means a different native fingerprint for diagnostics builds, which forces a reinstall on every switch.
3. **Resolved by the review: music memory.** Each track is 1,315,611 frames × 2 channels × 4 bytes = 10.5 MB of float PCM; all three were 31.6 MB, not the 10.5 MB this question first said. Two stay resident (the current and the next, 21 MB steady); the third is decoded on demand by the native decoder, off the JS thread, and the LRU evicts one to keep the peak at 31.6 MB. A switch to the cold third starts when its decode lands, so it can start late but never dead (#7).
4. **The soak runs after the engine exists (Task 8), not before it,** unlike the coordinator's (b)-before-(c) order. It still precedes every caller migration.
5. **Resolved by the review: voices are freed.** `sweep()` sets `buffer = null` and disconnects each voice after its end, and each retired deck after its fade; background stops and frees every voice not yet started. Each `AudioContext` still makes its own worklet runtime (`AudioContext.ts:22`), with no API to reuse one; rebuilds are watchdog-rare, and the soak's footprint slope would show them.
6. **turbo-haptics has no prepare API.** After a return to the foreground, the first haptic allocates one generator on main. It is accepted, and G4 judges it.
7. **turbo-haptics uses the deprecated `UIImpactFeedbackGenerator(style:)`.** It is still functional on iOS 26. Watch upstream, or patch-package `init(style:view:)` if Apple removes it?
8. **The sting's time is computed when `gameOver` (and the scores) arrive:** `performance.now() + handOffDelayMs + shift`, as today's timer did. Plan 2 may want it on the throw clock instead.
9. **The rematch-before-the-sting test is dropped.** A sting now lives in the engine (so that unmount cannot cancel it, #5), and a rematch inside the ~0.7 s hold is not reachable by hand. Say if you want `silence()` generalised to cancel a scheduled sting instead.
10. **Old and new paths coexist inside the one PR, from Task 5 to Task 10.** From Task 9, both session owners are live in a build. Nothing between those tasks ships; only Task 10's end state does.
11. **Web music retention** (`musicWebBuffers.test.tsx`) is ported unchanged into `audioEngine.web.ts`, but no jest project has a DOM `AudioContext` to test it in. The browser suites exercise it without asserting it. Add a Playwright check, or accept?
12. **`chosenTracks` and `trackKeys` in `musicAssets.test.ts`** remain regex scans. They are out of this plan's class, and should be flagged separately if wanted.
13. **`AudioState` has no `"interrupted"`; the design line is corrected instead.** The library's context state is `running | suspended | closed`, and an interruption reaches JS only through `observeAudioInterruptions`, which on Android requests audio focus (against D7). An interruption shows as `suspended`, and the watchdog handles it on the next `active`. The design doc's `AudioState` line should read `"running" | "suspended" | "failed"`.
14. **The mic is on for the whole bench run** (Task 3), because restarting ReplayKit mid-run can prompt again on an unattended phone. If the first run shows the mic moving `outputMs` or `ioMs`, G3 moves to a run of its own.
15. **Plan 4 changes that this plan now requires:** its Task 2 (Release-only verdicts, `ios-bench.yml`, `--bench`) moved here into Task 1; its `startJsLag` moved here and emits `{ k: "jsLag", t, dt }` plus a `jsTicks` floor row, on `performance.now()` rather than `Date.now()`; its `burstVerdict` is replaced by this plan's `burstStalls`.
