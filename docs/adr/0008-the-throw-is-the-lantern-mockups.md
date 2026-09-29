# 0008. The throw is the lantern mockup's, and its landing is the card's contact

**Status:** Accepted
**Date:** 2026-09-28

## Context

The owner's review of the lantern table (#1259, finding 4): "Card flight: use the mockup's. Build
the mockup's flight (380 ms, 45 ms stagger, −24 pt lift, +0.1 scale pop, ease-out), not today's."
Finding 3: the landing dust "appears to go off before the card lands", and in this session: "it is
enough to time it to when the card touches table".

Today's throw came from #126's timing scale: 40 ms of anticipation, 260 ms of travel, no stagger,
no scale, a fixed rotation per seat, a 63 ms fade-in, and the flight in a `Layer.sheet` overlay
above the table. ADR-0002 §1 measured its origin from the seat box; §4 made `impactDelayMs()` the
one clock every landing effect waits for. That clock is a guess on a timer started in a different
effect from the animation (`pile.tsx:851` against `:106`), and its `LANDING_FRACTION` of 0.82 was
fitted to a 380 ms flight that #126 later reshaped without re-deriving it. On the phone the dust
and sound fired at 56 % (Debug) and 78 % (Release) of the travel
(the lantern review of #1259, § Timing).

## Decision

1. **The pose is the mockup's `play()`** (`tests/e2e/fixtures/lantern-table/index.html:513-521`),
   as a pure worklet `flightPose(elapsedMs, i, n, from, to, catchUp)`: 380 ms per card, 45 ms
   stagger (200 ms per card and a 20 ms stagger in reconnect catch-up), `1−(1−k)³` on every channel, lift `−24·sin(πe)`, scale
   from the origin's size with a `0.1·sin(πe)` pop, rotation to `(i−(n−1)/2)·1.2°`, slots 34/28/24
   pt apart by play size. The cards are visible at their origin at once and fly inside the pile's
   layer group.
2. **The origin is where the card is**: an opponent's fan centre, or the viewer's own hand slot
   for each card. This supersedes ADR-0002 §1's single box-derived origin for the viewer's hand.
   The flying card is the card that left: the fan's count drops at the throw, as in the mockup
   (`index.html:515`), and no separate back departs. This supersedes ADR-0002 §2 and §3, which
   kept the count and lifted a back while the face card, visible at its origin from the first
   frame, was already in the air.
3. **The landing moment is contact**, found by sampling the pose: the first frame at which every
   card is within 1 pt of its slot and 0.01 of its final scale. Nothing derives it from constants.
   It is about 57 ms before the mockup's own sound timer (which fires when its tween ends, after
   the card has visibly arrived); the sound follows the owner's "when the card touches" over the
   mockup's timer.
4. **One clock per motion.** UI-thread effects fire on the contact frame; JS consequences read
   `landsAt = firstFrame + contactMs`, and sounds are scheduled on the audio clock for `landsAt`.
   This supersedes ADR-0002 §4: `impactDelayMs()`, `LANDING_FRACTION` and `handOffDelayMs()` are
   deleted.
5. `Motion.duration.travel` stays for the deal and fades; the throw gets its own tokens
   (`Motion.throw.card`, `Motion.throw.stagger`, `Motion.throw.catchUpCard`, `Motion.throw.catchUpStagger`, in `lib/tokens.ts`).
6. **The exchange goes through the pile** (amended 2026-09-29). Each traded card lifts at its
   giver, flies to the pile centre, rests there still and face up for `Hold.reveal`, then flies to
   its receiver: the receive first, the give after the choice, one leg at a time on one frame clock
   (`components/table/ExchangeLegs.tsx`, `lib/game/exchangeTimeline.ts`, `Motion.exchange`).
   Attribution is the pile label during each rest ("Luan dà 2♥ a Gent") and the lit seats: the
   giver from the leg's first frame, the receiver from the rest. The owner rejected tags riding
   with the cards on 2026-09-29. The approved design is `tests/e2e/fixtures/exchange-legs/index.html`.

## Consequences

- The flight gets longer (380 ms plus 45 ms per extra card, against 300 ms flat), which is what
  the owner asked for; bots' pacing is unchanged because the next play waits for contact, not for
  a timer.
- Every consumer that guessed the landing (`useTableFeedback.ts:372`, `seats.tsx:197`,
  `pile.tsx:847`, the sting) now reads one value, so changing the pose can no longer leave one of
  them behind: that is how 0.82 went stale.
- The landing onset is checked against the pose itself (`tests/ui-rules/flightPose.test.ts`,
  `tests/e2e/landingContact.spec.ts`), so the mockup-parity spec no longer subtracts app constants
  from its throw times and cannot be green by construction.
- The components/CLAUDE.md invariant "derive the delay only from `impactDelayMs()`" becomes
  "derive every landing consequence from the flight's contact".
