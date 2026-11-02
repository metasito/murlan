# #1259: plan from the 2026-11-02 device bench

Source: `diagnostics/2026-10-30T16-07-56-421Z.ndjson`, session `mvzhb60f`, Release bundle, iPhone 16 Pro. The research behind the audio and haptics work is `docs/research/2026-09-28-lantern-review.md`; settle its nine open questions before A1 relies on them.

The scenarios that failed after thermal state 2 are not evidence of an app defect until they are re-run cool (B). The tap, onset and haptic failures are not thermal: they failed at thermal 0–2 in both runs and agree with the September measurements.

## C. Bench fixes (first)

1. The verdict stops at the run's first end (PR #1933). Done.
2. A failure at thermal 2 or more is labelled `throttled` (PR #1933). Done.
3. `--resume` already reruns every scenario that has no clean pass; no new flag.

## B. Re-measure cool (needs the phone)

Phone unplugged from heat sources, charging, Low Power off, rested until `thermal=0`; then `npm run ios:device -- --gates --resume diagnostics/2026-10-30T16-07-56-421Z.ndjson`.

| Scenario | If it still fails cool |
| --- | --- |
| restCost, sustained, dealBurst, noticeGallery | joins A3 (UI-thread cost) |
| lampVariants (evenness 0.06), seatAnchors (drift 1) | layout bugs: fix first, they are not frame-rate |

## A. Fixes, each with a before-and-after bench run on the phone

1. **Why the capture hears so few onsets.** The app already plays through `react-native-audio-api` and `react-native-turbo-haptics` (`lib/device/audioEngine.ts`, `tests/tooling/audioLibraries.test.ts`), so there is no engine to replace. tapBurst recorded 60 plays and "missing" counts taps with no captured onset within 150 ms (58 of 60); with sound and haptics off it stalls 17 times against 19 on, so the stalls are not the audio's. hapticOnset matched 4 of 30, landingSync 21 of 70. First settle whether the engine is silent or the ReplayKit capture misses it: play a known tone through the bench with the capture on and count onsets. Gates: tapBurst, hapticOnset, landingSync.
2. **Onset scheduling.** scheduledOnset: output error 0.69 ms, app error 94 to 108 ms. The sound is scheduled late, not played late. One clock, per `tests/ui-rules/oneClock.test.ts`. Gate: scheduledOnset.
3. **UI-thread cost on throws.** throwStalls: 103 stalls over 42 throws, median 55 Hz. Profile first (`measure-the-mechanism-before-blaming-it`), fix second. Gates: throwStalls, plus whatever B hands over.

One PR per area; each lands red-then-green against its gate.
