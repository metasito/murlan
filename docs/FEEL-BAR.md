# The feel bar

The prototype (`https://claude.ai/code/artifact/80607f3e-e852-416e-a6f1-91788d80f40f`, fetched
with `WebFetch`, never `curl`) is the floor for every moment below, never the ceiling. This file is the ceiling: for each moment, named references a
critic can `WebFetch` and compare us against, plus ideas past any reference for what "even
cooler" means, stated as frame properties rather than adjectives.

Every entry below cites what was checked, and how, at that entry — a per-line claim, not a
blanket one. Where a source publishes no number for a quality we needed, that is stated
rather than invented.

Our own tokens, cited throughout for grounding: `Motion.duration` (`flash` 90ms, `tap`
120ms, `shift` 200ms, `travel` 260ms, `reveal` 600ms, `dwell` 1200ms),
`Motion.anticipate` 40ms, `Motion.spring.land` (damping 21, stiffness 260, ~7% overshoot
once), `Motion.spring.pickup` (damping 37, stiffness 340, critically damped),
`Motion.stagger.deal` 42ms, `Hold.land` 50ms, `impactDelayMs()` = round(260 × 0.82) =
213ms, `Reading.notice` 4000ms, `Reading.invite` 6000ms — all in `lib/tokens.ts`. The
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
  roughly `t = 12×42ms + 213ms ≈ 717ms`) completes in under 1 second — nowhere near the
  ~42.9s/hand pace a real table tolerates, which is the point: our deal can afford to be
  unhurried relative to the casino floor, not raced against it.

## Card landing

**1. Balatro's own `juice_up`/`move_juice` (shipped source, read directly)**
`https://raw.githubusercontent.com/GladdonT/balatro-source-code/main/engine/moveable.lua`
Balatro ships as an unencrypted LÖVE2D `.love` archive — unzipping the Steam build gives
its literal Lua source, mirrored at this repository and verified here by direct fetch. This
is Balatro's own contact-feedback primitive, called on essentially every card event
(`self:juice_up(0.3, 0.3)` on seals — quoted verbatim from `Card:set_seal()`, both the
immediate and delayed-event branches use the same figure; `juice_up(1, 0.5)` on editions —
verified in `card.lua` at the same repository, same fetch pass).
- Numbers, quoted from `Moveable:juice_up`/`Moveable:move_juice`: default `amount = 0.4`;
  effect duration `end_time = G.TIMERS.REAL + 0.4` (400ms); resting scale offset during the
  effect is `1 - 0.6*amount`; rotation amplitude is `0.6*amount`; the oscillation itself is
  `math.sin(50.8*t)` for scale and `math.sin(40.8*t)` for rotation, decaying by the
  remaining-time fraction cubed (scale) and squared (rotation); the whole function returns
  immediately, doing nothing, when `G.SETTINGS.reduced_motion` is true — the same
  reduced-motion gate this repo's own `impactDelayMs()` implements, independently arrived
  at by a different shipped game.
- What it does that a translate-and-stop doesn't: the card doesn't just arrive, it wobbles
  down to rest on two independent decaying sine waves (scale and rotation) rather than
  easing once — "landing" is oscillation settling, not a single tween completing.
- Frame check: sampling the card's scale at 1/60s intervals across the 400ms window after
  landing shows at least two direction changes (the sine crossing its own decay envelope
  twice), not a monotonic approach to rest — a landing that only ever moves toward its
  final scale, once, is the thing this reference argues against.

**2. Android haptics design principles**
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

## Bomb

**1. Balatro's blind-defeat juice, and a checked absence (shipped source, read directly)**
`https://raw.githubusercontent.com/GladdonT/balatro-source-code/main/functions/state_events.lua`
and `https://raw.githubusercontent.com/GladdonT/balatro-source-code/main/engine/moveable.lua`
Balatro's biggest single moment — defeating a blind — calls `G.GAME.blind:juice_up()` with
no arguments (so the default `amount = 0.4` from `Moveable:juice_up`, see **Card landing**),
alongside `effects[ii].card:juice_up(0.7)` for a triggering joker — verified by direct
fetch of both files. Also checked and confirmed absent: **no camera-shake or screen-shake
system exists anywhere in Balatro's engine source** (`engine/particles.lua` was read in
full for it) — the game's escalation for its biggest moment is delivered entirely through
each object's own `juice_up` wobble (scale + rotation, see Card landing's numbers) and
sound, never by moving the camera or the table itself.
- Numbers: default `juice_up` amount 0.4 (blind defeat) vs. 0.7 (a triggering joker) — a
  real, shipped escalation-by-amount rather than a new mechanism per tier; 0 instances of
  screen/camera shake in the source, confirmed by reading `engine/particles.lua` in full.
- What it does that a flat shake-and-stop doesn't: escalates a moment without ever moving
  the camera — a real, shipped counter-example to "bigger moment, more shake" worth
  weighing against grammar C's own trauma-based shake before assuming shake is required.
- Frame check: at the blind-defeat frame, the felt/table container's own position is
  unchanged from the frame before it (0px offset) while the triggering card's scale and
  rotation are both mid-oscillation — the escalation is legible entirely from what individual
  objects do, checkable independently of whatever the table itself is doing.

**2. "Math for Game Programmers: Juicing Your Cameras With Math" (Squirrel Eiserloh, GDC 2016)**
`https://archive.org/stream/GDC2016Eiserloh/GDC2016-Eiserloh_djvu.txt`
The full talk transcript, verified by direct fetch — this is the origin of the trauma
formulation `#763`'s own ticket names, with the actual math behind it. Not a shipped card
game; kept because it's the technique's own primary source and the ticket names it.
- Numbers: trauma is kept in `[0,1]`; an event adds trauma directly ("+= 0.2 or 0.5"); on
  the exponent, the transcript itself hedges rather than picking one — "Camera shake is
  trauma 2 or trauma 3" — and separately works a numeric example at "trauma .30, .60, .90
  means 3%, 22%, 73% shake," which is the cubed reading (0.3³≈2.7%, 0.6³≈21.6%,
  0.9³≈72.9%, confirmed by hand); the squared reading of the same trauma values gives 9%,
  36%, 81% instead. **Both readings are the talk's own**, not a single prescribed curve —
  #763 picks trauma² (the gentler of the two at low trauma), which is one of the two
  options this source itself offers, not a departure from it.
- What it does that a flat shake-and-stop doesn't: trauma decreases linearly while the
  *visible* shake decreases by trauma's square or cube (the talk offers both), so the
  shake's perceptible collapse outpaces its underlying trauma value — the "sudden, not
  sliding" quality a linear shake lacks. The talk also recommends **Perlin noise** over
  pure randomness for the shake's own jitter, "because it automagically works with pause
  and slow-motion" and stays reproducible on replay.
- Frame check: sampling the table's offset across the shake window shows the amplitude at
  75% of the decay window under ~10% of peak (consistent with trauma² decay from 0.55), not
  the ~25% a linear decay across the same window would give at the same point.

**3. "The Art of Screenshake" (Nijman, INDIGO Classes 2013)**
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

**1. Balatro's discard — the closest shipped equivalent, checked for what it withholds**
`https://raw.githubusercontent.com/GladdonT/balatro-source-code/main/functions/state_events.lua`
Balatro has no "pass," but its discard is the same shape: a frequent, low-stakes action a
player takes often and that must not compete with the game's bigger moments.
`G.FUNCS.discard_cards_from_highlighted()` was read in full, start to end (not scanned) —
each discarded card's own draw-out animation is staggered by `i*100/highlighted_count` (a
percentage delay scaled by how many cards are discarded at once) via
`draw_card(G.hand, G.discard, i*100/highlighted_count, 'down', false, ...)`, and the string
`juice_up` does not appear anywhere in that function's own body, confirmed by reading every
line of it rather than by searching the file for the term. The game's own frequent,
unremarkable action gets movement and nothing else.
- Numbers: stagger step `100/highlighted_count` percent per card (e.g. 5 discarded cards →
  20% steps); 0 `juice_up` calls in the discard function, against 8+ distinct call sites
  elsewhere in the source for events the game *does* want to sell (editions, seals, sold
  cards, blind defeat — see **Card landing**, **Bomb**).
- What it does that an unremarkable action might do by accident: proves restraint is a
  real shipped choice, not an oversight — Balatro's own discard has a small, functional
  stagger and deliberately no wobble, on a game that reaches for `juice_up` on almost
  everything else.
- Frame check: across a pass's full sequence, no frame shows a non-monotonic scale or
  rotation change (the oscillation signature **Card landing** and **Bomb** both show) —
  position may move, nothing wobbles.

**2. Material Design 3 motion duration tokens (as a floor, not a case study)**
`https://www.mdui.org/en/docs/2/styles/design-tokens`
Pass should sit inside Material's own `short` tier — `short1` 50ms, `short2` 100ms,
`short3` 150ms — the band Material reserves for a state simply registering, and never
reach `short4` (200ms), which Material already treats as the tier's own upper edge. #101's
research (quoted on #101 by `rotonmeta`) already established that turn-frequency actions
must be the calmest in the game because every effect spent on them is subtracted from what
a bomb can spend — this is the numeric floor for that finding, not a case study of it.
- Frame check: from tap to the card returning to hand's rest position, no frame in the
  sequence exceeds 100ms, and no frame shows a scale, shake, or particle change — a "state
  registering" motion signature, distinguishable in a capture from every other moment in
  this document by having no channel active except position.

## Turn hand-off

**1. Hearthstone's own turn timer (shipped game, mechanic verified against live behaviour)**
`https://hearthstone.wiki.gg/wiki/Turn`
Not a developer document, but a documentation of Hearthstone's actual live mechanic —
verified by direct fetch, and the numbers describe the shipped client's real behaviour, not
a design intent.
- Numbers: each turn lasts a maximum of **75 seconds**; a burning-rope fuse visual appears
  once **around 20 seconds remain**; a missed turn's next turn starts with a faster fuse
  giving only **around 7 seconds**.
- What it does that a static "your turn" label doesn't: stays silent and static for the
  first ~55 of 75 seconds, and escalates (visual fuse, urgency) only in the closing ~20 —
  exactly the calm-by-default, urgent-only-near-deadline shape #101's research asked turn
  cues to have, verified against a shipped game rather than argued for.
- Frame check: at any point before the final ~20 seconds of a turn, the active seat's
  indicator shows no burning/urgency element at all — only past that threshold does a
  visibly different (accelerating) state appear, so a capture from early and late in the
  same turn must show two qualitatively different indicator states, not the same element
  scaled.

**2. WSOP Main Event shot clock (2026 rule change)**
`https://www.pokernews.com/news/2026/07/wsop-main-event-shot-clock-debate-51856.htm`
- Numbers: 20 seconds to act before a hand is ruled dead or auto-checked; a time-extension
  chip adds 30 seconds; each player starts the day with 6 chips.
- What it does that a static "your turn" label doesn't: makes the countdown itself the
  turn-hand-off signal, legible without reading any text.
- Frame check: the active seat's turn indicator shows a continuously-depleting element
  (not a binary on/off) across the whole turn duration, so a capture at any two points in
  the same turn shows a measurably different indicator state.

## Win

**1. Balatro's own round-win sequence (shipped source, read directly)**
`https://raw.githubusercontent.com/GladdonT/balatro-source-code/main/functions/state_events.lua`
No shipped card game's own "you won this round" *screen* is documented anywhere with
numbers — but Balatro's own win/round-evaluation event chain is the actual code that runs
it, verified by direct fetch of `state_events.lua`'s `evaluate_play()` and `win_game()`.
The file uses `delay(0.4)` in at least five unrelated places (new-round setup, hand-level
display, post-play state transitions) and one conditional `delay(0.3)` — neither is tied
cleanly enough to a single "win" beat to attribute without guessing, so both are left out
below rather than assigned to whichever occurrence looked closest.
- Numbers, each quoted from its own exact surrounding lines: in `evaluate_play()`,
  `delay(0.2)` precedes the loop `for i=1, #scoring_hand do highlight_card(scoring_hand[i],
  (i-0.999)/5, 'up') end` — the scoring cards' own highlight; further down the same
  function, `if hand_chips*mult > 0 then delay(0.8) ... play_sound('chips2') end` gates a
  sound cue, and a separate event with `ref_value = 'chips', ease_to = G.GAME.chips +
  math.floor(hand_chips*mult), delay = 0.5` is the chip/mult total's own count-up ease — two
  different numbers for two different things, not one; in `win_game()`, `delay = 2.5` gates
  the event that shows the win-screen character (Jimbo).
- What it does that a static "You win" banner doesn't: nothing appears all at once — cards
  highlight first, a sound cue fires 0.8s later, the chip/mult total counts up on its own
  0.5s ease, and only on the biggest win does a 2.5s beat bring in a character — four
  distinct, separately-timed reveals rather than one screen.
- Frame check: sampling frames across the first second after a manche is won shows the
  scoring cards highlighted before the total begins counting, and the total still counting
  (not yet at rest) at least 200ms after the highlight appears — a capture set where the
  highlight and the final total appear on the same frame has collapsed the sequence into a
  cut.

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

**1. Balatro's own game-over transition — a checked absence (shipped source, read directly)**
`https://raw.githubusercontent.com/GladdonT/balatro-source-code/main/functions/state_events.lua`
No shipped card or casino game documents a loss/defeat *screen's* own timing with numbers
in any developer write-up I could fetch and verify. What is fetchable and checkable is
Balatro's own `end_round()` code path on a loss, read directly: the whole check — `local
game_over = true`, the jokers' `end_of_round` evaluation that can flip it, and the
`G.STATE = G.STATES.GAME_OVER` assignment itself — sits inside one `G.E_MANAGER:add_event`
whose own wrapper is `trigger = 'after', delay = 0.2`, so the earliest the state can change
is 0.2s after the event is scheduled. Inside that 0.2s-delayed block, the assignment itself
fires with no further `delay()` or `juice_up()` call of its own — no *second*, additional
beat once the block runs.
- Numbers: the enclosing event's own `delay = 0.2` (quoted verbatim above); 0 further
  `delay()` or `juice_up()` calls between entering that block and the `GAME_OVER`
  assignment — the block runs once it starts, but does not stage anything after it starts.
- What it does that our own design intent needs to answer rather than copy: past that one
  0.2s gate, Balatro's own loss has no further choreography — no staged reveal like the win
  path's (see **Win**) highlight → sound → count-up chain. That is the asymmetry #101's
  rank-10 finding ("the losing side should not be faster than the winning side") is arguing
  against, with a real shipped example on the record rather than an assumption of what
  shipped games do.
- Frame check: measured against our own decided intent (#101 rank-10, option 1: gate the
  celebration's escalation rather than remove the loss beat), the losing seats' acknowledgment
  must NOT collapse to zero frames the way Balatro's does — at least one frame between the
  loss becoming certain and the result screen settling must differ from both its start and
  end state, the same staged-reveal property **Win**'s frame check asks of a win.

**2. Material Design 3 motion duration tokens (as a floor, not a case study)**
`https://www.mdui.org/en/docs/2/styles/design-tokens`
A duration floor: a loss beat should sit in Material's `long` tier — `long1` 450ms,
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

**Tried and dead-ended, named rather than silently dropped:** PokerStars' own disconnect
policy (the one shipped casino/poker product most likely to document this) has numbers
reported second-hand by press coverage (10 seconds minimum to act on reconnection, a
"Disconnect Extra Time" system, Rule 18 governing it), but every PokerStars-branded page
that might state Rule 18 directly no longer resolves: `pokerstars.bet/help/articles/…`
redirects to FanDuel's own support portal, `pokerstarsnj.com/poker/tournaments/rules/`
redirects to `poker.fanduel.com` (which returns HTTP 403), and `pokerstars.com`'s FAQ
redirects to a `pokerstars.ch` marketing homepage with no rules content — all four fetched
directly and confirmed dead or content-free. No shipped card game's own reconnect UX turned
up with numbers either — the closest, Clash Royale, is documented only qualitatively (hide
the disconnected opponent's state rather than announce it, to stop players exploiting a
disconnect and to reduce anxiety — the same principle `OfflineBanner`'s `null`-is-unknown
state already follows) with no published latency figure. Reported rather than papered
over; the reference below is a general technical guide, not a game or casino product,
cited because it is the only source found with real numbers for the actual question — how
long "still trying" may run before it must become "recovery failed."

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

**1. Evolution's own Live Roulette product page (shipped casino product)**
`https://games.evolution.com/live-casino/live-roulette/`
Evolution's own marketing/product page for its live tables, verified by direct fetch — not
a card game, but a shipped, real-money casino product describing exactly this moment: what
a live table does between rounds while waiting for the next one to start.
- Numbers: Speed Roulette rounds run "just 25 seconds from spin to spin," stated as "around
  50% of the duration" of standard Live Roulette (so standard ≈ 50s spin-to-spin); Speed
  Auto Roulette runs "2,500 games per day"; VIP Auto Roulette tables deliver "60–80 game
  rounds per hour" (≈45–60s/round) — three different real cadences for "table between
  hands," all from the same shipped vendor, none of them ever fully stopped.
- What it does that a frozen table doesn't: a live table is never simply waiting — it is
  always mid-cycle at some point in a named, marketed cadence, and that cadence is a
  product decision publicly stated in seconds and rounds-per-hour, not an implementation
  afterthought.
- Frame check: at any point sampled during an idle wait between hands, the elapsed time
  since the last hand ended is under the table's own between-round cadence (translated to
  our own pace, comfortably under Evolution's fastest published 25s) — an idle wait longer
  than a real product's own full round-to-round cycle has drifted from "a lull" into
  "stalled."

**2. Idle animation design guide (game-dev, character/loop authoring)**
`https://mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide`
Not a shipped product — kept as a secondary, technique-level source for the ambient-loop
shape itself, since Evolution's page states cadence but not loop construction.
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
  (213ms) is measurably longer than its length 50ms later (`Hold.land`'s own span) — the
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
