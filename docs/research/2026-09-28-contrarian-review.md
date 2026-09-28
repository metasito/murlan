# Contrarian review of the #1259 research (2026-09-28)

Scope: `docs/research/2026-09-28-lantern-review.md` (LR), `docs/research/2026-09-28-audio-engine.md`
(AE), the device data and the analysers. I reran the slices on a copy of `data/device-debug.ndjson`;
the new ones are scratchpad `extra.mjs`, `ab2.mjs` and `decay.mjs`, with every number quoted below.
Items are ranked by what a wrong claim would cost the plan.

## 1. The stall mechanism is unmeasured, and the source reading behind it is partly wrong
**Claim (LR §Audio › Root cause):** each `play()` calls `setActive(true)` synchronously and re-adds
observers, which is "per-event work on the iOS main thread". **AE A2.1:** haptics alone produce no
stalls, "so the audio change is the main fix".
**Verdict: WRONG on the threads, UNSUPPORTED on the mechanism.**
- `Function("play")` (`expo-audio/ios/AudioModule.swift:212`) is an Expo *sync* function, so it
  runs on the calling JS thread. `setActive(true)`, `playImmediately` and the observer
  re-registration therefore run on JS, which is why the JS side measures about 1 ms. Only two
  things run on main: the time-observer callbacks (`AudioPlayer.swift:482`, `queue: nil`) and
  expo-haptics (`HapticsModule.swift:7-26`, `.runOnQueue(.main)`).
- **The data shows an interaction.** Distinct >100 ms UI stalls within 400 ms of a tap, session
  `ios-mulcgfhp`: sound only 2 in 74 taps, haptics only 0 in 85, both 35 in 91. The effect
  survives interleaving (ABCBC here, eight segments in `ios-mulc7jn9`) and survives music on or
  off, so order and music are not the confound. What is unexplained is why it is
  superadditive. The likely candidate is that main-thread haptic calls wait on audio-server work:
  a session activation started on JS, or `deactivateSession` 100 ms after each clip ends.
- **Cost.** AE fires haptics from UI worklets. `TurboHapticsBindings.mm:141-150` runs
  `impactOccurred` and `prepare` synchronously on main, so any such wait lands inside the animation
  frame.
- **What settles it:**
  - A factorial on the phone, 3 × 30-tap bursts per arm: expo-audio with
    `keepAudioSessionActive: true`; expo-haptics swapped for a cached, prepared generator; both;
    neither. The decider is distinct >100 ms stalls per 90 taps (today 35).
  - One iOS hang log naming the blocked call, from Settings › Developer › Hang Detection (iOS 16
    and later; check the phone has it). It fires at 250 ms or more, and the tap stall is p90
    252–275 ms, max 422–731 ms.

## 2. Worklets' dynamic frame-rate governor: a missed cause and a measurement confound
**Verdict: MISSING.**
- `react-native-worklets` 0.10.4 defaults `IOS_DYNAMIC_FRAMERATE_ENABLED` to true
  (`src/featureFlags/staticFlags.json:4`). `apple/worklets/apple/AnimationFrameQueue.mm:103-135`
  moves the display link between 120, 60, 30 and 24 Hz on the 4-frame average callback time
  (thresholds 8, 16 and 33 ms). The POOR range's floor is 10 Hz.
- In `ios-mulaeyft`, 21 one-second windows sit at 55–66 fps: a 60 Hz plateau, not a stall. 102 of
  its 364 "long frames" are ≤45 ms, i.e. pacing. Those frames count as stalls in `builds.mjs` and
  would fail the proposed 34 ms gate.
- The team's own notes flagged this (`notes-agents2.md` H8.2), and LR dropped it. As a cause of #8 it
  is unproven in Release, where only 3 windows sat at 60 Hz. But any fix that adds UI-frame work,
  such as worklet haptics or a per-frame light pass, pushes the average toward 8 ms and brings the
  120↔60 flip back. No proposed fix accounts for it.
- **What settles it:**
  - Log the display link's `preferredFrameRateRange`, or `targetTimestamp - timestamp`, so pacing is
    told apart from blocking.
  - Rerun Release with the flag off (`package.json` worklets `staticFeatureFlags`) and ask the owner
    whether the lag is gone.

## 3. #5's root cause is a probe artefact: the sting played
**Claim (LR §Win/loss):** "The table's unmount cancels any sting still pending: `stingCancelled`
fired on every manche end." **Verdict: WRONG.**
- The probe (`useTableFeedback.ts:377`) logs whenever `stingTimerRef.current` is non-null. The ref is
  set at `:460` and never cleared after the timer fires, so the row appears on every unmount.
- The data (Grep `"key":"mancheLost"` in `device-debug.ndjson`) shows the sting playing:
  - Debug: `mancheLost` triggered at 331.29 s and played to the end (ct 0 → 500 → 888, `fin:true`).
  - Release: `mancheWon` triggered at 140.94 s, before the "cancel" row at 141.28 s.
- The real cause of "not sure anything played" is unmeasured. Candidates: a start about 300 ms
  late; navigation and the `cue` music switch 0.34 s later; its level against the bed; no sting for
  a neutral manche or a partita.
- **What settles it:** four manche ends (2 won, 2 lost), with music off and then on, captured by iOS
  screen recording with app audio. Did the owner hear it, and what is its level against the bed in
  dB?

## 4. "Silent plays 29–50%" are mostly *late* plays; onset latency is the unreported class
**Claim (LR headline):** "drops 29–50% of effects". **Verdict: OVERSTATED, and it MISSES the class.**
- `analyze.mjs:31-37` calls a play silent when the 30, 90 and 250 ms samples show no progress. It
  never reads `timeControlStatus`.
- Most "silent" `select` plays started late:
  - `ios-mulaeyft`: 46 silent; 33 reported playing from about 0 between +250 and +1500 ms; 39 passed
    through `waitingToPlayAtSpecifiedRate`.
  - `ios-mulc7jn9`: 68 silent; 55 reported playing late.
  - The landing sounds (`play`, `combo`) are truly silent more often.
- Steady-state onset, trigger → first status at ct<60 (JS arrival, so an upper bound): `select`
  p50 186 / p90 340 ms, `play` 169 / 279, `combo` p50 141, `turn` p50 271.
- Onsets 100–350 ms late and that variable bunch by themselves, which is "several fire at the same
  instant". LR counts pile-ups (31 in 6 min) on *trigger* times. Its mixing policy (dedupe
  turn+pass) is a design change, not #2's root cause.
- **What settles it:** a screen recording with app audio over 60 taps and 20 bot plays, aligned to
  the probe log by a visible and audible marker. Report tap → audible latency (p50/p90) and plays
  with no onset within 500 ms. Gate on those, not on player state.

## 5. The stall statistics double-count; "worse in Release" is not supported
**Claims (LR §Debug vs Release):** ">100 ms stall" at 56 of 91 taps; UI lag "equal or worse in
Release"; 6.2 against 4.0 s per minute. **Verdict: OVERSTATED.**
- **Double-counting.** The 400 ms window credits one long frame to every tap in a burst, so 56
  credited taps are 35 distinct stalls. Isolated taps have almost none: Release 1 in 20, p50 56 ms.
- **Release is equal, not worse.** Per tap, Debug and Release match: 35 distinct stalls in 91 taps
  against 35 in 93.
- **Denominator.** The per-minute figures divide by the whole session, menus included:
  `ios-mulaeyft` has 409 table-seconds in a 491 s span.
- **The sessions differ in what was played.** Debug had music on, 154 taps in 409 s and the sound
  probes on. Release had music off (`musStop` at 23.9 s), 93 taps in 146 s and the probes off.
  `builds.mjs` `cat()` also gives a tap priority over a landing.
- **The A/B table is mislabelled "Probe-free".** Its 19-tap "both off" row is from `ios-mulc7jn9`
  (probes on); "sound off, haptics on" is 85 taps, not 75; and sound alone did stall >100 ms, on 10
  taps (max 226) in `ios-mulc7jn9`.
- **What settles it:** distinct stalls per 100 taps and per table-minute, with matched bursts and
  matched music, in one Debug and one Release session.

## 6. The always-on-redraw case is confounded; Release already runs at 120 fps with the lamp
**Claim (LR §Always-on redraw):** Reduce Motion took UI fps from 78–90 to 111, because it froze the
lamp. **Verdict: UNSUPPORTED.**
- In `ios-mulc7jn9` the Reduce Motion segment (175–195 s) came right after 21 s in the background.
  Before it, fps had already fallen from 104 to 74 with the lamp running throughout (`decay.mjs`,
  10 s bins). The 120–150 s windows include app-inactive stretches at 20–26 fps.
- The governor (#2) turns a ≥8 ms callback into "60 fps". Release quiet windows reach 120 fps *with
  the sway running* (13–60 s and 100–137 s), so the cost is mostly a Debug artefact.
- Battery and heat may still justify the work, but this data does not show player lag. Do not rank
  "bake the cloth" on it.
- **What settles it:** a dev toggle that freezes only the sway. On Release, alternate 30 s on and
  30 s off, four times. The lamp matters if quiet-window fps is ≥115 frozen and ≤100 swaying, every
  time.

## 7. Landing sync: the two documents contradict each other, and the native path is unchecked
LR §Timing says every cue follows `onLanded` via `scheduleOnRN`; AE A2.6 says
`start(ctx.currentTime + remaining + calib)` at launch. **Verdict: MISSING a decision.**
- **The reactive path is bound by JS latency.** Release JS stalls are p50 52 ms at flight mounts
  and p50 39 / p90 89 ms at landings.
- **The predictive path lacks a clock mapping.** Native has no `outputLatency` or
  `getOutputTimestamp`, and `currentTime` steps per IO buffer (about 21 ms at the iOS default).
  AirPods add 150–250 ms, readable only from `AVAudioSession.outputLatency`, which the library does
  not expose.
- **The checks cannot fail on native.** The proposed timing checks are web-only: one thread, no hop.
- **"`landingMs(n)` equals flightPose's rest" is tautological** if both come from the same
  constants. Find the rest time by sampling the pose.
- **What settles it:** choose reactive or predictive first. Then measure dust frame against audible
  onset on a 240 fps slow-motion video of the phone.

## 8. The engine's #1263 leak is dismissed on the wrong axis; soak iOS as well
**Claim (AE A3):** the report uses 240 s buffers and ours are small, so an Android soak is enough.
**Verdict: OVERSTATED dismissal.**
- The issue is open, with no maintainer reply. It measures about one full buffer copy retained per
  source node (71 MB per operation on an 85 MB buffer). The leak scales with count × size, not with
  length.
- `setBuffer` deep-copies per source (`AudioBufferSourceNodeHostObject.cpp:178`), and the plan makes
  one source per play. That is about 1,400 plays per 30 min (0.8/s in `ios-mulaeyft`) at
  55 KB–1 MB each, plus 10.5 MB per music crossfade.
- The code is common C++, so iOS is exposed too.
- **What settles it:** 30-minute soaks on iOS and Android, logging RSS through the probe. Pass is an
  RSS slope under 1 MB/min.

## 9. Proposed checks that can pass without the property being true
- **"A play never calls a session API or a seek."** This is true of a facade over a fake context and
  false of the library once the driver has stopped (after a background, an interruption or a
  `suspend()`):
  1. `start()` calls `AudioContext::start()` (`AudioScheduledSourceNode.cpp:27-33`).
  2. That reaches `tryStartDriver`, then `NativeAudioPlayer.start` (`:64-85`).
  3. That runs `ensureActive` and restarts the engine.

  Test instead that the facade queues or drops any play while `state !== "running"`.
- **"A track switch never deactivates … the facade has no deactivate path."** This passes by
  construction. The library deactivates internally (`AudioEngine.mm:137`), and the #1230 watchdog
  closes contexts. Assert that a switch issues no `suspend` or `close`, and count music deaths on
  the device.
- **"0 silent plays" read from an `AnalyserNode` on the sfx bus.** The instrument sits inside the
  engine it tests. Use the external recording from #4.
- **"No UI frame over 34 ms attributable to a tap."** The attribution window decides the verdict,
  and 24 Hz pacing (41.7 ms) fails it (#2). It needs distinct-stall counts and a pacing/blocking
  split.
- **`tableNotices`: "every painted View with Text has a TableNotice ancestor".** Cards, seat names and
  buttons break the rule, so it needs an exemption list, which is how a safeguard starts exempting
  what it checks. Name the owned surfaces instead.
- **"Every Moment kind pinned to a caller".** It must drive a partita end and observe `playCue`; a
  source scan falls to a decoy.

## 10. #7 music death is undercounted, and the stated timing does not fit
**Claim (LR §Music):** "3 of 5 switches" died, because the old player's `pause()` triggers
`deactivateSession` 100 ms later while the new player waits. **Verdict: UNSUPPORTED mechanism,
OVERSTATED rarity.**
- At least 5 of 12 switches died: Debug at 186, 333 and 436 s, Release at 144 and 165 s. Each was a
  cached player being restarted. The switch at 23 s in `ios-mulc7jn9` started after 7 s of silence.
- At 186 s the new `hand` player reported playing at 186.44 s and again at 187.09–187.12 s. Both are
  after the ~186.23 s check.
- It died after the unawaited `seekTo(0)` landed at 187.11 s, and by 187.44 s it was paused at 0
  with no status event.
- Two mechanisms fit: the seek race on a looping `AVQueuePlayer`, or a deactivation after an
  *effect* ended (`exchange` at 186.13 s) while the music waited after its seek. The engine swap
  removes both; the class LR names covers only one.
- **What settles it:** 20 cue→hand switches with `keepAudioSessionActive: true`, then 20 with an
  awaited seek. Whichever arm drops deaths to 0 names the mechanism.

## 11. #12 is modelled, not measured, and the 3× bar is arbitrary
**Claim (LR §Turn lamp):** ratios 1.50/4.25/0.91/1.42 today, 6.9/10.6/4.5/7.5 after the fix, with a
check at ≥3×. **Verdict: UNSUPPORTED.**
- The ratios come from a JS port of the shader (`scripts/lamp2.mjs:1`), but `components/CLAUDE.md`
  requires device pixels before a native visual fix.
- The owner said "less visible than before", and before was 12–26×. Nothing derives 3×.
- The web check must pin the Skia variant, because a fallback felt exists (`feltReady.ts:10`).
- **What settles it:** four device screenshots, one per seat on move. Sample the annulus luminance,
  and set the floor from the owner's pick between two tuned builds.

## 12. #13: "measured" means web Chromium, not the device
**Claim:** "The web model predicts the device to 0.1 pt." **Verdict: OVERSTATED.** The "measured"
column is Chromium (`notes-agents.md:3,7`). The device probe logged the slot box top, not the ring
centre, and the two were never compared. The fix direction stands; confirm it once on the device.

## 13. The engine choice: weak or missing parts
**Verdict: OK-but-weak.**
- The expo-audio arms (#1, #10) were never run as diagnostics, so the swap rests on a partly wrong
  mechanism.
- The custom module was dismissed as "minus the web path", but web already has Web Audio and AE
  C4.7 allows a platform-split web context. Against the library: RN 0.86 never built upstream,
  worklets coupling, #1263, #1230, #1238, and 1.0 imminent. An owned `AVAudioEngine` +
  `scheduleBuffer(at:)` / Oboe module deserves a costed comparison.
- "Suspend when idle" conflicts with "session activated once", and every resume restarts the engine
  (`NativeAudioPlayer.m:28-33`).
- turbo-haptics from a worklet relies on worklets 0.10.4's `SerializableHostFunction`: present in the
  source, never run.
- FLAC is right for native loops: lossless, gapless, no FFmpeg; MP3's encoder delay breaks the seam.

## 14. #14 is judged against the floor, not the bar
**Verdict: MISSING.** Every #14 item is a diff against the mockup. `FEEL-BAR.md` makes the prototype
the floor, with top games as the ceiling, and no ceiling reference or `/design` mockup is named.
#11's "panel" shape has no mockup reference.

## Do not build the plan on these until settled
1. That per-play work *on main* is the stall and haptics are secondary: run the factorial and get a
   hang log (#1).
2. That the swap clears #8: decide the frame-rate governor and split pacing from blocking (#2).
3. "The unmount cancels the sting": it played (#3).
4. "Silent" as the #2/#10 class: gate on tap → audible latency from an external recording (#4).
5. The Debug/Release figures and the double-counted tap stalls (#5).
6. The priority of "bake the cloth" (#6).
7. The landing-sync architecture, with a check the native path can fail (#7).
8. The #1263 dismissal: soak both platforms before committing to one source per play (#8).
9. The #12 ratios and the 3× floor, until device pixels exist (#11).
