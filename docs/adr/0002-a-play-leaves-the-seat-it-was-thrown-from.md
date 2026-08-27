# 0002. A play leaves the seat it was thrown from

**Status:** Accepted
**Date:** 2026-08-25

## Context

#204 records that a played combination has no visible origin. Two separate causes:

`FLY_OFFSETS` (`components/table/pile.tsx:32`) starts every flight at a fixed offset in the
pile's own frame — `left: -180`, `top: -100`, and so on. Four unscaled numbers, one per
direction. They do not track where the seat actually is, so at a small `scale` the throw is
longer than the distance to the seat and at a large one it is shorter. The card slides in
from off-frame.

And the fan is already short before the cards land. The flight is triggered off
`gameState.lastPlayedCombination`, by which point the server's state has been applied and
`handCountOf(player)` has already dropped. The backs disappear at the throw; the cards reach
the felt `impactDelayMs()` later. Nobody ever sees cards leave a hand.

This touches seven files with no recorded decision, which is why the pipeline's design gate
escalated it. The decision below is what it was asking for.

## Decision

### 1. The origin is measured, not constant

`FLY_OFFSETS` is replaced by a delta measured from the throwing seat's own box to the pile,
scaled with the table the way every other table distance is. The seat ring is already
measured — `tests/e2e/seatFans.spec.ts` measures the fan against it — so this reads an
existing measurement rather than introducing a new one. `bottom` keeps coming from the
viewer's hand row, which is already the viewer's real geometry.

### 2. The displayed count is derived, never stored

The obvious implementation — hold the old count in state and step it down on a timer — puts
a second source of truth next to `handCountOf` and lets the two disagree whenever a timer is
missed, a flight is interrupted, or the state arrives twice.

Instead the fan's count is a pure function of two things that already exist:

```
displayedHandCount(seat) = handCountOf(seat) + cardsInFlightFrom(seat)
```

During the flight the authoritative count has dropped by *k* and the flight holds *k*, so the
sum is the pre-play count. When the flight resolves, the second term becomes zero and the sum
*is* the authoritative count. There is no step-down to schedule and no timer to miss: the
number returns to truth because the flight ended, not because something remembered to update
it.

This is the whole reason the decision is worth recording. The behaviour #204 asks for sounds
like "delay the count", and delaying it is the wrong shape.

### 3. The departing backs are the flight, not copies of it

The *k* backs that lift and fade are the same *k* cards the flight is carrying. The fan draws
anonymous backs from a count and never from card identities, so this does not put a card in
two places: **a card appears exactly once in flight/`pileState`** (`CLAUDE.md`) is about
identities, and identities live only in the flight and the pile. The fan's contribution is a
number.

The remaining backs re-solve their arc into the gap rather than snapping — `solveArc` already
produces both geometries, so this is a transition between two of its results.

### 4. Timing comes from `impactDelayMs()`, which is not re-derived

`components/gameTableModel.ts` already owns `FLIGHT_MS`, `LANDING_FRACTION` and
`impactDelayMs()`, precisely so the animation and the impact feedback cannot drift apart.
The lift, the fade and the arc re-solve all read that same derivation. Under
`prefers-reduced-motion` `impactDelayMs()` is already `0` and `FlyingCards` already skips the
flight, so the count steps down immediately and nothing lifts — no separate reduced-motion
branch is added.

## Scope

`lib/gameEngine.ts` is **out of scope**, despite appearing in the gate's file list. Nothing
here changes a rule, a hand or a play: the engine keeps being the authority on how many cards
a player holds, and this decision only changes when the table draws that number. A change to
the engine would need `docs/BRIEF.md` §3.1, and this does not.

## Consequences

- Four layout constants become a runtime measurement, so the throw is correct at every
  `scale` instead of at one.
- The fan can be *ahead* of the engine by exactly the cards in flight, and only for the
  length of a flight. Any other divergence is a bug, and the two-term definition above is
  what makes that statement checkable.
- Only `tests/e2e/` can prove the origin tracks the seat — `react-test-renderer` never runs
  flexbox, so no native test can see where a fan renders (`CLAUDE.md`).

## Alternatives rejected

**Scale `FLY_OFFSETS` by the table scale.** Cheaper, and still wrong: the offsets encode a
direction, not a position, so a scaled constant still does not point at the seat. It would
fix the "too long at small scale" half and leave the "comes from nowhere" half.

**Delay applying the server's state until the flight lands.** Puts the animation in charge of
when the game state is true, and every other reader of that state — the turn indicator, the
buttons, the timer — would lag with it. The divergence belongs in the one view that needs it.

**Hold the pre-play count in component state.** Rejected in §2 above: a second source of
truth that can disagree with the first.
