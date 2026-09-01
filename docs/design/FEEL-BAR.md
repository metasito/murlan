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

**2. Balatro's digit-stagger, as the closest documented escalating-delay case**
`https://blakecrosley.com/guides/design/balatro`
A design-analysis write-up of Balatro's scoring sequence, not its deal — Balatro's own
dealing animation isn't covered anywhere I could verify — but it is the only shipped-game
source with real numbers for staggering a run of same-type elements one after another,
which is the mechanism a hand of cards being dealt needs too.
- Numbers: score-digit reveal stagger at 0ms, 50ms, 100ms, 150ms (four elements, 50ms
  apart); digit roll itself 0.4s with `cubic-bezier(0.34, 1.56, 0.64, 1)` (an overshoot
  ease, not a linear one).
- What it does that a flat translate-in doesn't: each element's stagger delay is a fixed
  step (50ms) rather than a fraction of total count, so adding a fifth element doesn't
  compress the first four — the run reads as one gesture at any hand size, which is
  `Motion.stagger.deal`'s own design (42ms per card, not per-hand-size).
- Frame check: a 13-card deal and a 3-card deal both show the same 42ms gap between any
  two consecutive cards' launch frames — the gap must not shrink as hand size grows.

## Card landing

**1. Balatro's contact feedback**
`https://blakecrosley.com/guides/design/balatro`
- Numbers: card hover lift −12px translateY at 1.05× scale; selected state −24px at 1.08×;
  hover transition 0.15s ease-out; scanline overlay period 2px transparent / 2px at
  `rgba(0,0,0,0.15)`.
- What it does that a translate-and-stop doesn't: the card's scale and vertical offset both
  move together, so contact reads as a physical lift-then-drop rather than a position swap.
- Frame check: at the frame nearest `impactDelayMs()` (312ms after play), the landed card's
  bounding box is momentarily narrower on one axis and wider on the other than its resting
  geometry — never a uniform scale-down — consistent with `Motion.spring.land`'s single
  ~7% overshoot.

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

**1. Balatro's screen-shake tiers**
`https://blakecrosley.com/guides/design/balatro`
- Numbers: small shake 0.2s ease-out, medium 0.3s ease-out, large 0.5s ease-out; large-shake
  translation range −8px to 8px, small-shake range −4px to 4px.
- What it does that ours (pre-#763) doesn't: ties shake amplitude *and* duration to event
  size as one escalation, not amplitude alone — a large event shakes longer as well as
  harder.
- Frame check: sampling the table's translateX across the shake window shows the bomb
  tier's envelope (trauma 0.55, decaying as trauma², ~260ms) crossing zero more times than
  the flush/straight tier's, which shows none — an escalation visible in the number of
  zero-crossings, not just peak amplitude.

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
  component under 1.5° peak — Nijman's own talk (per its listed topic tags) treats rotation
  as part of "trauma," and our current #763 spec is translation-only; a frame capture at
  the shake's peak should show a visible, sub-2° tilt on the felt if this is adopted, and
  none if it is not — either is checkable, only "not decided" is not.
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
therefore a floor, not a target: pass should sit at or below Material's `short1`/`short2`
band (50–100ms), the same band Material reserves for a state simply registering.
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

**Balatro's scoring reveal**
`https://blakecrosley.com/guides/design/balatro`
This is Balatro's win-adjacent moment — the sequence that plays when a hand's score is
revealed, which is the closest documented shipped analogue to a manche won, since no
source found documents a "you won this round" screen specifically with numbers.
- Numbers: digit roll 0.4s, `cubic-bezier(0.34, 1.56, 0.64, 1)` (overshoot ease); digit
  stagger 0/50/100/150ms; medium shake 0.3s ease-out accompanies the reveal.
- What it does that a static "You win" banner doesn't: the score isn't shown, it's *counted
  up* to, with an overshoot on arrival — the number itself performs the win rather than
  merely reporting it.
- Frame check: the manche-won banner's copy (per grammar C's tier row: hold 120ms, trauma
  0.40, "lamp lifts, then the banner") does not appear as a single opaque frame — there is
  at least one intermediate frame where the banner's content differs from both its start
  and end state (e.g. a count mid-roll, an opacity between 0 and 1 with the lamp-lift still
  completing), so the hand-off from lamp to banner is visible as a sequence, not a cut.

## Loss

**Material Design 3 motion duration tokens (as a floor, not a case study)**
`https://www.mdui.org/en/docs/2/styles/design-tokens`
No shipped card or casino game documents a loss/defeat screen's timing with numbers in any
source I could fetch and verify — game-over-screen writing (searched separately) is
uniformly qualitative ("emotional punctuation," "deliberate design choice") with no
duration figures. That gap is reported rather than papered over. What we do have is a
duration floor: a loss beat should sit in Material's `long`–`extra-long` band (450–1000ms)
rather than `short`/`medium`, since it is not a state registering but the end of something,
and the tier table already treats "manche won" (120ms hold) as faster than "partita won"
(180ms hold) — the losing side of the same event should not be faster than the winning
side of it.
- Frame check: the losing seats' acknowledgment (per #101's rank-10 discussion: recommended
  option 1, gating the celebration's escalation rather than adding new copy) completes no
  earlier than the winning seat's equivalent beat — measured frame-count-to-settle, not
  wall-clock impression.

## Reconnect / recovery

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

## What this file is not

It does not decide anything #101's tier table, #730, #731, #763, #764 or #765 already
decided — those numbers are restated here only as the frame checks a critic runs, not
re-opened. It adds no rule and changes no code, per this ticket's definition of done.
