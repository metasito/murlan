# 0020. The table at rest plays precomputed tracks, and nothing redraws per frame

**Status:** Accepted
**Date:** 2026-11-10

## Context

A resting table was redrawn constantly: the lamp's sway repainted the felt about every third frame,
the motes repainted a second canvas, and two frame callbacks never released. At 4x CPU that kept
the page about 80% busy while nothing happened, and play landed on top of it (#1989 § 3a).

The owner's ruling of 2026-11-09, verbatim: "the idea is to be more efficient and not have a laggy
app... looking good". The owner also asked for a durable framework, not a fix per feature. The
table must keep its look: the lamp's light pool and sway, the weave, card shadows, the gloss on
backs, the rail light. Where the app and `tests/e2e/fixtures/lantern-table/index.html` differ,
the mockup wins.

## Decision

1. **At rest nothing redraws per frame, on the JS thread or in a canvas.** Ambient motion (lamp
   sway, felt light, the motes and the moth, the back gloss) plays as precomputed tracks on the
   compositor: CSS keyframes on web, Reanimated on native, declared only through `ambient()` in
   `lib/motion.ts`. This is the standard technique in games: bake what does not change, let the
   compositor move and blend the pictures.
2. **The lamp rig stays the source of truth** (`components/table/lampRig.ts`), with the mockup's
   semantics. A track is baked from the rig's state when the lamp settles and rebaked at the next
   settle. The rig, the tracks and the trace source read one sway model (`lib/swayTable.ts`),
   so there is one copy of the sway (rule 48).
3. **Live drawing is for events only** (glide, flare, kick), started with the event and released
   at its end. The one-off bakes an event needs are done at glide time.
4. **Native keeps today's rest path** until a profile on device shows the compositor shape
   working there; a per-platform seam is added only when native needs one (rule 50).

## Consequences

- A rest-window lower bound that needed canvas redraws ("felt draws >= N", "particles >= 1") is
  replaced by an assertion that the motion is visible and moving on the compositor layers: the
  tracks are running and their values change over the window. The floor stays, so a dead table
  cannot satisfy "zero draws". The upper bounds are unchanged.
- The turn-time budgets in `tests/e2e/helpers/skiaPerfBudgets.ts` may count the one-off bakes at
  glide time, widened before the code that needs them and tightened after (ADR-0018 stays
  counts only).
- The owner froze the `tableAtRest` limits as a target on 2026-11-10 (`docs/agents/target-freeze.md`).
  This ADR is the decision rule 52 requires before those target lines can move, in a pull request
  of their own that cites it; the code that meets them lands after.
- A new perpetual motion goes through `ambient()`; nothing else starts a loop.
- Tracks are rebuilt at each settle, so a change that moves the lamp without settling shows a stale
  track until the next one.
