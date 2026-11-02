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

1. **Audio and haptics off the JS thread.** tapBurst: 58 of 60 plays missing, 19 UI stalls. hapticOnset: 26 of 30 missing, p90 99 ms. Replace the expo-audio and haptics path with a native engine, per the September research. Gates: tapBurst, hapticOnset, landingSync.
2. **Onset scheduling.** scheduledOnset: output error 0.69 ms, app error 94 to 108 ms. The sound is scheduled late, not played late. One clock, per `tests/ui-rules/oneClock.test.ts`. Gate: scheduledOnset.
3. **UI-thread cost on throws.** throwStalls: 103 stalls over 42 throws, median 55 Hz. Profile first (`measure-the-mechanism-before-blaming-it`), fix second. Gates: throwStalls, plus whatever B hands over.

One PR per area; each lands red-then-green against its gate.
