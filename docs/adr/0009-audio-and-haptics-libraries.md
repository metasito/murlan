# 0009. Audio is react-native-audio-api and haptics are react-native-turbo-haptics

**Status:** Accepted
**Date:** 2026-09-28

## Context

The owner's review of the lantern table (#1259): the sound effects are "not timed, not behaving,
not optimised, and not always working".

Measured on the owner's iPhone (`docs/research/2026-09-28-lantern-review.md` § Audio and
haptics): 56 of 91 fast taps stalled the UI thread over 100 ms with sound and haptics on, none
with both off; 38 of 127 select sounds were silent; 3 of 5 music switches died silently; the
landing sound fired at 56–78 % of the flight. expo-audio 57 plays each clip through its own
`AVPlayer`, calls `setActive(true)` and re-registers observers on main per play, seeks
asynchronously before a synchronous play, and deactivates the shared session whenever no player
is `.playing` at that instant. expo-haptics creates a new generator on main per call.

## Decision

1. **expo-audio and expo-haptics are removed.** Sound goes through react-native-audio-api 0.13.6
   and haptics through react-native-turbo-haptics 1.2.0, both pinned exactly.
2. **One owner each:** only `lib/device/audioEngine.ts` imports the audio library and only
   `lib/device/hapticsEngine.ts` the haptics one; only `lib/device/feedback.ts` calls them.
3. **The library's known defects are guarded in our code**, not accepted: one context from app
   launch, never suspended in the foreground; plays dropped while it is not `running` (it replays
   queued plays at resume); a watchdog recreating a context that fails to resume (upstream
   #1230); no call from a worklet (its host objects are unsafe off the JS runtime); no `onEnded`
   on effects (#1285); the session never activated per play.
4. **A landing sound is scheduled at the throw** for the contact time, `ctx.currentTime + (landsAt
   − now)`; its error is one IO buffer plus output latency, held by a device gate.
5. **Adoption is gated** on CI release builds for iOS and Android and a 30-minute soak on each
   (memory slope, underruns; upstream #1263, #1231) before any caller moves.

The design is `docs/plans/2026-09-28-1259-design.md` §1.

## Consequences

- Effects play on the audio thread from resident buffers: no seek, no cold start, no per-play
  work on main. A music switch is a crossfade and cannot kill the output.
- The landing sound's placement is as good as the library's clock, about 10–21 ms, below what a
  player hears. If the device gate shows otherwise, the next step is reading the output latency
  into the offset.
- Music ships as FLAC, because the library cannot decode WebM on Android.
- Two libraries with small maintainer bases carry the app's feel. The pins, the importer test and
  the soak are what make an upgrade a deliberate, checked change.

## Alternatives rejected

**An owned native engine** (a C++ mixer on `AVAudioSourceNode` and Oboe, scheduling against the
render timestamp; Core Haptics players started at a time). Sample-exact, and designed in full,
but weeks of native code the app would own, for an accuracy gain below audibility. The owner
chose the library.

**Tuning expo-audio** (`keepAudioSessionActive`, an awaited seek). Stops the silent plays and the
music deaths, keeps per-play `AVPlayer` work on main, and has no scheduling, mixing or ramps.

**react-native-track-player** covers music only; **react-native-sound** is one `AVAudioPlayer`
per sound; **expo-haptics**, **react-native-haptic-feedback** and **react-native-nitro-haptics**
allocate a generator per call.
