# The feel bar

The prototype (`docs/agents/GAUNTLET-PROMPT.md` → **Look**) is the floor for every moment
below, never the ceiling. This file is the ceiling: for each moment, named references a
critic can `WebFetch` and compare us against, plus ideas past any reference for what "even
cooler" means, stated as frame properties rather than adjectives.

Every reference URL below was fetched and its cited numbers confirmed present in the
fetched text before being written here. Where a source publishes no number for a quality
we needed, that is stated rather than invented.

Our own tokens, cited throughout for grounding: `Motion.duration` (`flash` 90ms, `tap`
120ms, `shift` 200ms, `travel` 260ms, `reveal` 600ms, `dwell` 1200ms),
`Motion.anticipate` 40ms, `Motion.spring.land` (damping 21, stiffness 260, ~7% overshoot
once), `Motion.spring.pickup` (damping 37, stiffness 340, critically damped),
`Motion.stagger.deal` 42ms, `Hold.land` 50ms, `impactDelayMs()` = round(380 × 0.82) =
312ms, `Reading.notice` 4000ms, `Reading.invite` 6000ms — all in `lib/tokens.ts`. The
grammar C tier table from #101 (hold/shake/aftermath per tier) is assumed read.

---

## Deal

**1. Material Design 3 motion duration tokens**
`https://www.mdui.org/en/docs/2/styles/design-tokens`
A third-party mirror of Google's official Material 3 token spec (same values published at
`m3.material.io`, which does not serve static text to a fetcher). Gives the duration floor
a run of arriving elements should sit inside.
- Numbers: `short1` 50ms, `short2` 100ms, `short3` 150ms, `short4` 200ms, `medium1` 250ms
  … `medium4` 400ms, `long1` 450ms … `long4` 600ms, `extra-long1` 700ms … `extra-long4`
  1000ms. Easing: standard `cubic-bezier(0.2, 0, 0, 1)`, emphasized-decelerate
  `cubic-bezier(0.05, 0.7, 0.1, 1)`.
- What it does that a flat translate-in doesn't: gives every step of a sequence its own
  named duration band, so a design can pick "this card's arrival is a `short3`" instead of
  guessing a number per call site — the exact trap `Motion` in this repo already avoids,
  confirmed against a second system.
- Frame check: at `t = 0ms` no card in the deal has begun moving except the first; at
  `t = 42ms × n` the n-th card (0-indexed) has just started its own travel, matching
  `Motion.stagger.deal`, and no two cards' travel windows are byte-identical in start time.

**2. Casino dealing pace, as a real-product ceiling on how long a deal may take**
`https://wizardofodds.com/ask-the-wizard/136/` and
`https://www.evolution.com/news/evolution-launches-super-fast-speed-blackjack`
Wizard of Odds publishes Jim Kilby's *Casino Operations Management* table of blackjack
hands dealt per hour by seat count: 209 (1 player), 139 (2), 105 (3), **84 (4)**, 70 (5),
60 (6), 52 (7) — verified by direct fetch, table intact. At murlan's four seats, 84
hands/hour is one full deal-play-resolve cycle every ~42.9s on a real table, which is the
outer ceiling our own hand (dealt in 13×42ms ≈ 546ms, played over a few more seconds) sits
nowhere near — we have room, not a deadline. Evolution's own Speed Blackjack product page
(verified by direct fetch) states it runs "30–40% faster" than their standard Live
Blackjack, confirming that dealing pace is itself a tunable, marketed dial in a shipped
casino product, not an afterthought.
- Numbers: 84 hands/hour at 4 seats (≈42.9s/hand); 30–40% pace delta between two shipped
  products from the same vendor.
- What it does that a flat translate-in doesn't: proves pace is a deliberate lever real
  money-facing products tune and advertise, which argues against treating `stagger.deal`
  as a fixed constant nobody revisits.
- Frame check: the full 13-card deal (first card's `t=0` to the 13th card's landing at
  roughly `t = 12×42ms + 312ms ≈ 816ms`) completes in under 1 second — nowhere near the
  ~42.9s/hand pace a real table tolerates, which is the point: our deal can afford to be
  unhurried relative to the casino floor, not raced against it.

## Card landing

**1. Android haptics design principles**
`https://developer.android.com/develop/ui/views/haptics/haptics-principles`
Google's own haptics guidance for touch feedback, verified by direct fetch — not a card
game, but the floor for how short a *landing's* haptic pulse can be before the actuator's
own physics, not the design, decides how long it reads.
- Numbers: "a good keyclick haptic feedback signal should last between 10 to 20
  milliseconds"; the actuator itself "may continue to ring for another 20 to 50
  milliseconds after a 20-millisecond input has ended" — a physical tail past the intended
  pulse.
- What it does that a translate-and-stop doesn't: names the gap between the pulse a design
  requests and the pulse a phone's actuator physically produces, so a landing's haptic can
  be authored short (10–20ms) with the knowledge its felt length will run longer regardless.
- Frame check: the landing's haptic trigger fires at the same frame `Hold.land` begins
  (within one frame, ~16ms, of `impactDelayMs()`), and no second haptic pulse fires before
  the first one's own 50ms ring-out tail has had time to finish.

**2. "Juice It or Lose It" (Jonasson & Purho, GDC Europe 2012)**
`https://www.gdcvault.com/play/1016487/Juice-It-or-Lose`
No numeric figures are published in the fetchable abstract — the talk itself is
video-only and this page is metadata plus a synopsis, not a transcript, so it is cited for
the technique it named rather than for a number: layering multiple simultaneous small
effects (screen shake, particles, squash) onto a single event reads as one bigger effect
than any of them alone. `Hold` (`lib/tokens.ts`) already credits this school of thought.
- What it does that a translate-and-stop doesn't: stacks feedback channels rather than
  picking one.
- Frame check: at the landing frame, at least two independent visual channels change in the
  same frame (e.g. scale via `Motion.spring.land` and the hold via `Hold.land`) — a landing
  that only moves the card is the thing this reference argues against.

## Bomb

**1. "Math for Game Programmers: Juicing Your Cameras With Math" (Squirrel Eiserloh, GDC 2016)**
`https://archive.org/stream/GDC2016Eiserloh/GDC2016-Eiserloh_djvu.txt`
The full talk transcript, verified by direct fetch — this is the origin of the trauma
formulation `#763`'s own ticket names, with the actual math behind it.
- Numbers: trauma is kept in `[0,1]`; an event adds trauma directly ("+= 0.2 or 0.5"); the
  shake magnitude the talk works through as its own example uses trauma **cubed**, not
  squared — "trauma .30, .60, .90 means 3%, 22%, 73% shake" (0.3³≈2.7%, 0.6³≈21.6%,
  0.9³≈72.9% — the math behind that quote, confirmed by hand). **This is a real, checkable
  divergence from our own spec**: #763 decays by trauma², which is a *gentler* curve at low
  trauma than the talk's own worked example (trauma² at 0.3 is 9%, more than triple trauma³'s
  3% at the same input) — worth knowing before anyone "fixes" #763's exponent to match this
  talk, since matching it would make the bomb's low end noticeably softer, not just
  differently sourced.
- What it does that a flat shake-and-stop doesn't: trauma decreases linearly while the
  *visible* shake decreases by trauma's square or cube, so the shake's perceptible collapse
  outpaces its underlying trauma value — the "sudden, not sliding" quality a linear shake
  lacks. The talk also recommends **Perlin noise** over pure randomness for the shake's
  own jitter, "because it automagically works with pause and slow-motion" and stays
  reproducible on replay.
- Frame check: sampling the table's offset across the shake window shows the amplitude at
  75% of the decay window under ~10% of peak (consistent with trauma² decay from 0.55), not
  the ~25% a linear decay across the same window would give at the same point.

**2. "The Art of Screenshake" (Nijman, INDIGO Classes 2013)**
`https://archive.org/details/the-art-of-screenshake`
No numeric figures are published in the fetchable page text — it is an interactive
presentation whose content is the video itself; the archive.org listing confirms the talk's
existence, speaker and topic tags (`Game Feel`, `Juicyness`, `Control`) but carries no
transcript. It is named here because it is the origin of the trauma-squared decay this
repo's own comments already credit it for (`Hold.land`'s doc comment cites Nijman by name).
- What it does that a shake-then-stop doesn't apply: decaying by the square of trauma
  rather than linearly, so a shake's back half fades faster than its front half — the
  "sudden, not sliding" quality a linear decay lacks.
- Frame check: plotting shake amplitude against time shows a curve, not a ramp — amplitude
  at 75% of the decay window is under 10% of peak, not ~25% (which is what linear decay
  would give at the same point).

### Beyond the references

Ideas past anything cited above, each a checkable frame property rather than a claim of
quality:

- At `t = 90ms` (the bomb's hold), the pile's beaten cards (`pileState.prev`) show a
  6px horizontal displacement from rest, and by `t = 90ms + 170ms` that displacement has
  linearly interpolated back to 0px — a number already decided by #764, restated here as
  the frame check the critic should actually run against a capture, not re-decided.
- At the bomb's landing frame, the spark burst's individual particles show a size
  distribution with at least three distinct radii (not one radius repeated ~24 times) —
  uniform-sized particles read as a sprite sheet, not a burst.
- Within the bomb's shake window, the table's rotation (not just translation) carries a
  component under 1.5° peak — Eiserloh's talk recommends combining translational and
  rotational shake ("Translational + Rotational = Awesome"), and #763's own body specifies
  a trauma value but not which axes it drives; a frame capture at the shake's peak should
  show a visible, sub-2° tilt on the felt if rotation is included, and none if it is
  translation-only — either is checkable, only "unspecified" is not.
- At the bomb's aftermath frame (`t ≈ 260ms` after landing), the lamp's flare (#765) casts
  a visibly brighter highlight on the *nearest* seat's card backs than on the *farthest*
  seat's — a directional light rather than a flat overlay, checkable by sampling luminance
  at the same screen position across two seats' card backs in the same frame.

## Pass

**Material Design 3 motion duration tokens (as a floor, not a case study)**
`https://www.mdui.org/en/docs/2/styles/design-tokens`
No shipped card game documents "pass" specifically with numbers — it is deliberately the
least-decorated action in every game surveyed (Hearthstone has no pass at all; Slay the
Spire's end-turn is covered only qualitatively in every source found, see **Turn hand-off**
below). That absence is itself the finding: #101's research (quoted on #101 by `rotonmeta`)
already established that turn-frequency actions must be the calmest in the game because
every effect spent on them is subtracted from what a bomb can spend. The reference here is
therefore a floor, not a target: pass should sit inside Material's own `short` tier —
`short1` 50ms, `short2` 100ms, `short3` 150ms — the band Material reserves for a state
simply registering, and never reach `short4` (200ms), which Material already treats as the
tier's own upper edge.
- Frame check: from tap to the card returning to hand's rest position, no frame in the
  sequence exceeds 100ms, and no frame shows a scale, shake, or particle change — a "state
  registering" motion signature, distinguishable in a capture from every other moment in
  this document by having no channel active except position.

## Turn hand-off

**1. WSOP Main Event shot clock (2026 rule change)**
`https://www.pokernews.com/news/2026/07/wsop-main-event-shot-clock-debate-51856.htm`
- Numbers: 20 seconds to act before a hand is ruled dead or auto-checked; a time-extension
  chip adds 30 seconds; each player starts the day with 6 chips.
- What it does that a static "your turn" label doesn't: makes the countdown itself the
  turn-hand-off signal, legible without reading any text — exactly the property #101's
  research asked for (a calm, high-frequency cue).
- Frame check: the active seat's turn indicator shows a continuously-depleting element
  (not a binary on/off) across the whole turn duration, so a capture at any two points in
  the same turn shows a measurably different indicator state.

**2. Timer-based rounds in live-dealer games**
`https://www.nerdly.co.uk/2026/02/17/understanding-timer-based-rounds-in-live-dealer-games/`
- Numbers: a fixed betting/decision window, reported as "often between 10 and 20 seconds,"
  after which no further input is accepted for that round.
- What it does that a static label doesn't: the same countdown-as-signal property as the
  WSOP reference, from a live-table rather than tournament-poker context — closer to our
  own always-on turn structure than a once-a-day shot clock is.
- Frame check: at the countdown's final ~2 seconds (however the total window is set), the
  indicator's rate of visual change increases relative to its rate earlier in the window —
  urgency communicated by an accelerating cue, not a constant one, checkable by comparing
  frame-to-frame delta near zero versus near the window's midpoint.

## Win

**1. Eiserloh's trauma math, applied to our own manche/partita values**
`https://archive.org/stream/GDC2016Eiserloh/GDC2016-Eiserloh_djvu.txt`
No shipped-game source with a "you won this round" screen documented in numbers turned up
in this pass — reported rather than papered over. What the same transcript cited under
**Bomb** gives for free is the actual visible-shake percentage grammar C's own manche
(trauma 0.40) and partita (trauma 0.50) rows produce, since we already know the exponent
(#763: trauma²).
- Numbers: trauma² at 0.40 → 16% visible shake; trauma² at 0.50 → 25% — both under the
  bomb's 30% (0.55²), and the four-tier sequence (ordinary win 0%, manche 16%, partita 25%,
  bomb 30%) is not evenly spaced — it compresses toward the top, which is #101's own
  deliberate inversion (a bomb outranks a manche) restated as a measurable curve rather
  than an ordering.
- Frame check: measuring peak table offset across the four non-zero tiers gives a
  monotonically increasing but non-linear sequence (0%, 16%, 25%, 30%) — a capture set that
  shows equal steps between tiers has drifted from the spec's own math.

**2. WCAG 2.2.2 Pause, Stop, Hide**
`https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html`
The official criterion, verified by direct fetch — a hard ceiling on how long any
auto-playing celebration may run before it needs a pause control.
- Numbers: "five seconds" is the exact threshold — chosen, per the criterion's own intent
  section, because it is "long enough to get a user's attention, but not so long that a
  user cannot wait out the distraction."
- What it does that an untimed celebration doesn't: draws a hard line between "brief enough
  to need no control" and "needs one," which our own `Reading.notice` (4000ms) already sits
  inside — worth stating as a found consistency, not a new constraint.
- Frame check: from the manche-won banner's first visible frame to its last, no more than
  4000ms elapses (our own budget, itself under the 5000ms line) — and no auto-playing
  celebration frame sequence in this document should be authored past 5000ms without a
  pause affordance appearing in the same capture.

## Loss

**Material Design 3 motion duration tokens (as a floor, not a case study)**
`https://www.mdui.org/en/docs/2/styles/design-tokens`
No shipped card or casino game documents a loss/defeat screen's timing with numbers in any
source I could fetch and verify — game-over-screen writing (searched separately) is
uniformly qualitative ("emotional punctuation," "deliberate design choice") with no
duration figures. That gap is reported rather than papered over. What we do have is a
duration floor: a loss beat should sit in Material's `long` tier — `long1` 450ms,
`long2` 500ms, `long3` 550ms, `long4` 600ms — or beyond, into `extra-long` (up to 1000ms),
rather than `short`/`medium`, since it is not a state registering but the end of something,
and the tier table already treats "manche won" (120ms hold) as faster than "partita won"
(180ms hold) — the losing side of the same event should not be faster than the winning
side of it.
- Frame check: the losing seats' acknowledgment (per #101's rank-10 discussion: recommended
  option 1, gating the celebration's escalation rather than adding new copy) completes no
  earlier than the winning seat's equivalent beat — measured frame-count-to-settle, not
  wall-clock impression.

## Reconnect / recovery

No shipped card game's own reconnect UX turned up with numbers in this pass — the closest,
Clash Royale, is documented only qualitatively (hide the disconnected opponent's state
rather than announce it, to stop players exploiting a disconnect and to reduce anxiety —
the same principle `OfflineBanner`'s `null`-is-unknown state already follows) with no
published latency figure. Reported rather than papered over; the reference below is a
general technical guide, not a game, cited because it is the only source found with real
numbers for the actual question — how long "still trying" may run before it must become
"recovery failed."

**WebSocket reconnection strategy guide**
`https://websocket.org/guides/reconnection/`
- Numbers: exponential backoff starting at 500ms, doubling each retry, capped at 30
  seconds; jitter randomizes each delay to 50–100% of the calculated value; 10–15 retry
  attempts is the recommended ceiling (12 retries spans roughly 2 minutes to the cap);
  session/ticket TTL recommended at 2–5 minutes to match the reconnection window; connection
  status should surface to the user after the first failed retry, not only on final failure.
- What it does that a plain "reconnecting…" banner doesn't: distinguishes "still trying"
  from "given up" as two different UI states with a numeric boundary between them, and
  surfaces the first one fast rather than making the player wait through several silent
  retries before learning anything is wrong.
- Frame check: a capture taken at any point between the first failed attempt and the 2–5
  minute ceiling shows a visibly different reconnect-state UI than a capture taken past
  that ceiling — "still trying" and "recovery failed" must be two distinguishable frames,
  never the same banner text at both times.

## Idle table

**1. Idle animation design guide (game-dev, character/loop authoring)**
`https://mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide`
- Numbers: a simple idle loop cycles every 2–4 seconds; a more complex loop (with a weight
  shift) cycles every 8–12 seconds; a secondary weight-transfer motion runs on its own
  4–8 second cycle; blend-in from any other state takes 0.2–0.4 seconds; a one-shot "fidget"
  plays every 30–60 seconds to break monotony; breathing amplitude is 1–2cm of travel, "no
  more."
- What it does that a frozen table doesn't: layers a slow primary loop with an occasional,
  much rarer secondary event, so the idle state reads as alive without ever repeating
  identically twice in under 30 seconds.
- Frame check: sampling the table at two points 10 seconds apart during idle shows a
  different phase of the primary ambient loop (not byte-identical frames), and no single
  30-second window contains two identical fidget events.

**2. Timer-based rounds in live-dealer games**
`https://www.nerdly.co.uk/2026/02/17/understanding-timer-based-rounds-in-live-dealer-games/`
- Numbers: the 10–20 second betting/decision window (same figure as **Turn hand-off**
  above) is also what a live table shows *between* hands while waiting for the next round —
  the table is never simply frozen, it is always inside some visible countdown.
- What it does that a frozen table doesn't: even "nothing is happening" carries a visible,
  legible countdown to the next thing that will happen, rather than an absence of
  information.
- Frame check: at no point during an idle wait (for players, for the next hand) does the
  screen contain zero moving or counting elements — there is always at least one visibly
  live element, even if it is only a clock.

---

## Beyond the references — the rest of the table

Bomb's own ideas are above, closest to its references. These are for the other eight
moments, each a checkable frame property rather than a claim of quality:

- **Deal.** At `t = -40ms` relative to the first card's own travel start (`Motion.anticipate`'s
  own duration, already spent elsewhere in this token set but never on the table itself), the
  felt's own scale departs from 1.0 by a small, named amount and returns to 1.0 by `t = 0`
  — a single symmetric "breath" so the whole hand's arrival reads as one gesture starting
  before the first card moves, not only once the first card is already in flight.
- **Card landing.** The card's drop-shadow length at the frame nearest `impactDelayMs()`
  (312ms) is measurably longer than its length 50ms later (`Hold.land`'s own span) — the
  shadow itself contracts in sync with the squash, rather than staying a fixed-length
  decoration under a card that is otherwise settling.
- **Turn hand-off.** At the single frame nearest the midpoint of a hand-off, the outgoing
  seat's indicator and the incoming seat's indicator never both measure at full opacity —
  their combined opacity at that frame stays under a named ceiling (e.g. 140%) — so the
  table never shows two simultaneously "current" seats even mid-transition.
- **Win.** The manche-won and partita-won tiers currently share one shape (hold, then shake,
  then lamp/flare) at different magnitudes. A frame capture at the partita tier's peak
  should show at least one channel absent from the manche tier entirely (not merely
  larger) — e.g. the flare (#765 is partita/bomb-only already) — so the top tier is
  distinguishable from a "louder manche" even with the sound off and a still frame.
- **Loss.** Per #101's own rank-10 finding (a celebration tuned purely for the winner is,
  from the other seats, the game being pleased about your loss) and its recommended option
  1 (gate the escalation to the winning seat, keep the hold and squash for everyone): a
  frame captured from a losing seat's device at the same tier and same timestamp as a
  winning seat's capture must differ in at least one channel (shake amplitude or flare
  presence) — a side-by-side of the two captures that is pixel-identical has not
  implemented the gating at all.
- **Reconnect.** The first frame rendered after a resync shows every card already at a
  valid resting geometry — on the felt, in a hand fan, or in the pile — never mid-flight
  with no spring in progress. A reconnect that "pops" a card into place produces a frame
  that could not have existed under normal play; one that replays the shortest applicable
  spring (`Motion.spring.land` compressed to its own settle, not skipped) never does.
- **Idle table.** Past some idle threshold, the ambient loop's own period should vary by a
  small, named amount from one cycle to the next (not repeat one exact interval verbatim)
  — sampling three consecutive idle cycles should show three different measured periods,
  not one period repeated three times, so a stationary table never becomes a detectably
  looping clip under close observation.
- **Pass.** A frame-diff between a pass's own peak frame and an ordinary win's peak frame
  (the land spring's own overshoot, per grammar C's own first row) should rank pass's
  amplitude strictly lower on every channel both moments share (scale, opacity,
  displacement) — pass is not merely shorter than the calmest win, it is smaller on every
  axis a critic can measure.

## What this file is not

It does not decide anything #101's tier table, #730, #731, #763, #764 or #765 already
decided — those numbers are restated here only as the frame checks a critic runs, not
re-opened. It adds no rule and changes no code, per this ticket's definition of done.
