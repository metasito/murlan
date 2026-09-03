# The animation timing audit (#829)

Every duration, delay, easing and spring the app animates with, judged against the scale
`lib/tokens.ts` already decided (`Motion`, `Reading`, `Hold`) and against `FEEL-BAR.md`. Three
outcomes only, per the ticket: **moves onto the scale** (a rename), **changes feel** (a
retiming, with the reason), or **stays a one-off** (with the sentence saying why this beat is
not on any scale).

Gathered by the same grep the ticket used, re-verified against source rather than trusted —
one constant (`GAME_OVER_DELAY`) had moved onto the same shape since. `eslint.config.js`
refuses a bare number for a timing; every row below is what it cannot see, because a number
behind a name is not a bare literal (`tests/spacingLint.test.ts` pins that gap directly).
`tests/gameTableModel.test.ts`'s `"a duration off the scale is a counted decision, not a
silent drift"` suite is the mechanical check left behind: it counts every `_MS` constant in
`components/` and pins the number this audit leaves at **23**, so the next one added has to
either fold onto `Motion`/`Reading`/`Hold` or update the pin with a reason.

## Settled: `travel`

`Motion.duration.travel` (260ms) was already the decided number — the owner watched three
moving tables and chose it over Weighted's 380ms (#126, `lib/tokens.ts`'s own comment,
`tests/motionScale.test.ts`'s `"the card's flight is the weight that was chosen"`). Three
places had drifted from that decision to three different numbers:

| Where | Was | Now | Fix |
| --- | --- | --- | --- |
| `lib/tokens.ts` `Motion.duration.travel` | 260 | 260 | Already correct — the decision itself |
| `docs/design/126-motion-language/Scale.dc.html` | 300 | 260 | Stale mockup value corrected; `Main.dc.html` already had 260 right |
| `components/gameTableModel.ts` `FLIGHT_MS` | `380` (a bare literal, the rejected Weighted figure) | `Motion.duration.travel` (derives, currently 260) | The actual throw's own duration, now locked to the decision instead of a number nobody re-chose |

`impactDelayMs()` = `round(FLIGHT_MS × 0.82)` moved from **312ms to 213ms** as a consequence —
not a new aesthetic call, but the number the owner's own #126 decision always implied once
`FLIGHT_MS` stopped contradicting it. `docs/design/FEEL-BAR.md` (the grounding line, the deal
frame check, the card-landing frame check) and `tests/e2e/bombShakeBounds.spec.ts`'s comment
are updated to match. `tests/gameTableModel.test.ts`'s impact-timing test is repinned to
213ms/260ms with the reason recorded inline.

## Moved onto the scale (renames, no value changes)

| Constant | File | Value | Now |
| --- | --- | --- | --- |
| `REJECT_HINT_MS` | `components/GameTable.tsx` | 2600 | `Reading.hint` (new entry) — "how long the refused-play reason stays on screen" is a reading budget, not a Motion step |
| `REACTION_PANEL_MS` | `app/(online)/game.tsx` | 4000 | `Reading.notice` (reused — already numerically identical, just not spelled that way) |
| `ERROR_TOAST_MS` | `app/(online)/game.tsx` | 3000 | `Reading.toast` (new entry) — the ticket itself named this one and `REACTION_PANEL_MS` as "Reading, not Motion" |

All three passed `tests/motionScale.test.ts`'s existing `"a reading budget is not a motion
step"` floor (`ms > longest Motion step × 2` = 2400) without needing a value change.

## Stays a one-off, with the reason

Everything below is a genuine domain beat or a component-local choice (CLAUDE.md: "a
component-local one-off may be a named module constant"), not a step that belongs beside
`flash`/`tap`/`shift`/`travel`/`reveal`/`dwell`. No FEEL-BAR reference or Motion role conflicts
with any of these; none showed evidence its current number is wrong.

| Constant(s) | File | Value(s) | Why it stays off the scale |
| --- | --- | --- | --- |
| `ROUND_WINNER_MS` | `GameTable.tsx` | 1800 | Already commented in source: "a domain beat, not a generic UI transition" — how long the winning tag holds the pile before the next round opens |
| `GAME_OVER_DELAY` | `app/(online)/game.tsx` | 800 (0 under `E2E_FAST`) | Same shape as `ROUND_WINNER_MS`; comment added to say so |
| `SPARK_LEAD_MS`, `SPARK_PHASE_MS` | `gameTableModel.ts` | 60, 22 | Already commented: "off the Motion scale on purpose... chosen against each other so sixteen sparks read as debris rather than one ring leaving at once" |
| `RISE_MS` | `ReactionLayer.tsx` | 1800 | Below the Reading floor (must be >2400) and not equal to any Motion step; a reaction's own float-and-fade, no FEEL-BAR moment names it |
| `RANK_STAGGER_MS`, `RANK_LEAD_IN_MS` | `ResultBoard.tsx` | 70, 150 | The ranked reveal's own stagger, playing the same role as `Motion.stagger.deal` (42ms) does for the deal but tuned separately for a different reveal — a podium filling in, not a hand arriving |
| `HAND_LIFT_MS` | `table/chrome.tsx` | 500 | Sits between `shift` (200) and `reveal` (600) on no particular step; the turn-arrival signal's own timing, no evidence 500 is wrong |
| `LAMP_MS` | `table/felt.tsx` | 800 | The lamp swinging to the seat on move — a physical repositioning, not a generic transition; its reduced form (`reduceMotion ? 0 : LAMP_MS`) matches the same idiom used throughout the app (`MenuLayout`, `NotificationBanner`, `gameTableModel.ts`'s own `impactDelayMs`/`shakeAmplitudeFor`) for every other one-off |
| `DEAL_DURATION_MS` | `table/hand.tsx` | 500 | "Every value here is the prototype's own `deal` keyframe verbatim" — matched to an external reference, not derived from the internal scale |
| `HOLD_MS` | `table/hand.tsx` | 500 | Not motion at all — a long-press gesture threshold, "react-native-gesture-handler's own default," cited against research on reordering (`docs/research/2026-08-30-reordering-a-hand.md`) |
| `FLARE_BRIEF_MS` (and `FLARE_SETTLE_MS = ×2`) | `table/moments.tsx` | 1500, 3000 | The bomb's own brief flare vs. the partita's settle window — tied to #765's tier decision |
| `SPARK_MS` | `table/moments.tsx` | 1150 | The bomb burst's own particle choreography (opacity split 10%/90%) |
| `LIFT_MS` | `table/moments.tsx` | 900 | The manche's lamp-lift reaction (#765), its own two-phase fade/grow |
| `SWEEP_MS` | `table/moments.tsx` | 1500 | The flush's diagonal light pass, sized against the table's own oversized band |
| `CATCH_MS` | `table/pile.tsx` | 620 | "Verbatim off the prototype's own `catch` keyframe" |
| `BREATHE_MS` | `table/seats.tsx` | 3400 | An ambient-loop *period* — a different role from `Motion.duration.dwell` (how long a moment holds before releasing, not a repeat interval); within the 2-4s "simple loop" band FEEL-BAR's idle-table reference cites |
| `BTN_REJECT_LEG_MS` | `useTableFeedback.ts` | 40 | Already commented: "deliberately a third of the bomb's amplitude — it is a 'no', not an event" |
| `KICK_MS`, `KICK_PUNCH_MS`, `KICK_SETTLE_MS` | `useTableFeedback.ts` | 1600, 144, 112 | "Verbatim off the prototype's own `kick` keyframe" — a distinct animation from the #763 escalation shake, which correctly reads `motionMs("shake", reduceMotion)` |

Reviewed but out of `components/`'s scope, so not counted by the pinned check, and already
well-formed: `lib/exchangeCeremony.ts`'s `EXCHANGE_LEG_MS`/`MEET_HOLD_MS` compose into
`EXCHANGE_FLIGHT_MS` and already route their announcement window through `Reading.notice`.

## The pose-handoff class (#828's blocker)

Searched for the same shape #828 fixed — two components drawing the same subject in two
different poses across a time boundary, gated the way `pile.tsx`'s
`current={flyInfo ? null : pileState.current}` was. No second instance found: every other
trigger-based overlay (`Flare`, `LampLift`, `Sweep`, `CatchCard`) fades to nothing and hands
off to nothing, rather than to a second component drawing a different pose of the same
subject.

## Not verified live

The retiming was **not** watched by a human this session. It carries less risk than a new
aesthetic call would: 260ms/213ms is not a new number being introduced, it is the number
#126's own watched decision already settled, restored after `FLIGHT_MS` and the Scale mockup
drifted from it. The owner should still watch a played hand, web and one device, before
trusting the feel — the definition of done's own checkbox for that is left unchecked here on
purpose rather than claimed without a witness.
