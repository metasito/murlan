# The lantern table on a phone: root causes of the #1259 review (2026-09-28)

The owner's review comment on #1259
(https://github.com/metasito/murlan/issues/1259#issuecomment-5870135066) lists fourteen defects
seen on an iPhone. This is the research it asked for: each finding measured, its root cause, the
class it belongs to, the design reference that settles what "right" looks like, and the check
that goes red on the next instance. The implementation plan is built from this document; nothing
here has been fixed yet.

## How it was measured

- **Device:** the owner's iPhone 16 Pro (402×874 pt window, scale 3, 120 Hz ProMotion), app
  sideloaded by `npm run ios:device`.
- **Probes:** temporary, tagged `[DEBUG-1259]`, never merged. `lib/debug1259.ts` batches rows and
  POSTs them every second to a collector on the PC (`:5099`). The rows cover:
  - UI-thread frame times, from a Reanimated `useFrameCallback`;
  - JS-thread frame times, from `requestAnimationFrame`;
  - taps, commits and per-second render counts;
  - every cue and every sound trigger;
  - the native player's status after each play;
  - music state, polled every second;
  - the flight's throw → start → impact times;
  - side-seat positions, from `measureInWindow`.
- **Sessions:** five, 22 minutes of play and 13,000 rows in all:

  | Session | Build | What it covered |
  |---|---|---|
  | `ios-mulaeyft` | Debug native, production JS | 491 s of normal play, every probe on |
  | `ios-mulc7jn9` | Debug | haptics / sound / Reduce Motion A/B |
  | `ios-mulcgfhp` | Debug | the sound A/B again, with the sound probes off |
  | `ios-mulcuvvt` | **Release** native, Hermes bytecode | 167 s of normal play, sound probes off |

  The Release binary came from `ios-device.yml` on the research-only branch
  `agent/1259-release-ab`, which is never to be merged.
- **Web measurements** for layout (#13) and motion (#3, #4, #9) ran Chromium against seeded saves.
  The scripts are named in each section.
- **What cannot be measured here:** this machine is Windows, so there is no Instruments trace of
  the main thread. Every main-thread attribution below comes from a controlled A/B on the device,
  and says so.

## The headline

Three classes explain most of what the owner felt:

1. **The native audio and haptics layer does per-event work on the iOS main thread.** It stalls
   the UI thread for 100–700 ms, drops 29–50% of effects, and kills the music after a track
   switch. This is #1, #2, #5, #7 and #10, and it is the same in Debug and Release.
2. **Effects are timed by guessed delays on clocks separate from the animation they describe.**
   This is #3, #4, #9, and the landing/turn/pass pile-ups.
3. **Layout and light are derived from content that changes during play.** This is #12 and #13.

The rest (#11, #14) is missing design-system primitives.

---

## Debug vs Release (#8)

Point 8 required separating Debug-binary lag from what a player on a Release build sees. The
same probes ran on both builds:

| | Debug (`ios-mulaeyft`) | Debug, sound probes off (`ios-mulcgfhp`) | **Release** (`ios-mulcuvvt`) |
|---|---|---|---|
| UI thread fps, p50 | 96 | 91 | 111 |
| UI-thread stall per minute of play | 4.0 s | 4.7 s | **6.2 s** |
| UI stalls at a tap: p50 / p90 / max | 101 / 253 / 705 ms | 80 / 208 / 422 | **155 / 259 / 482** |
| UI stalls at a landing: p50 / p90 / max | 61 / 192 / 225 | 42 / 130 / 130 | **92 / 246 / 739** |
| JS-thread stall per minute | 4.7 s | 5.7 s | **1.8 s** |
| JS stall at a flight mount: p50 / p90 | 150 / 228 ms | 126 / 183 | **52 / 68** |
| Throw → flight start: p50 / p90 | 75 / 131 ms | 62 / 91 | **20 / 37** |

- **JS-thread lag is largely a Debug artefact.** In Release, stall time drops 2.6×, and the
  "bot card lags before reaching the table" delay (throw → flight start) drops from 75 ms to
  20 ms. A 52 ms JS stall at every flight mount remains in Release (see §Mount hitches).
- **UI-thread lag is not a Debug artefact. It is the player's lag.** It is equal or worse in
  Release, and it concentrates on taps, landings and turn/pass commits. Those are exactly the
  moments that fire a sound and a haptic (§Audio and haptics).
- **Reduce Motion raised UI fps from about 78–90 to 111 in Debug** (session `ios-mulc7jn9`), with
  the lamp rig frozen (§Always-on redraw). The owner's own words were "okeish".

## Audio and haptics on the main thread (#1, #2, #5, #7, #10)

### Measured

**The tap A/B (#1, #10).** Probe-free, Debug. The owner tapped cards fast in each condition:

| Condition | Taps | Worst UI frame within 400 ms of a tap: p50 / p90 / max | Taps with a >100 ms stall |
|---|---|---|---|
| Sound on, haptics on (the shipped default) | 91 | 165 / 252 / 422 ms | **56** |
| Sound on, haptics off | 74 | 56 / 87 / 129 | 5 |
| Sound off, haptics on | 75 | 0 / 38 / 67 | **0** |
| Sound off, haptics off | 19 | 0 / 0 / 0 | 0 |
| Release, both on | 93 | 167 / 275 / 731 | 60 |

- The JS side of a select sound (set volume, set rate, seek, play) costs about 1 ms. The stall is
  native work on the main thread.
- Neither library alone produces the >100 ms stalls. Together, on one tap, they do.
- Sound alone still costs 56–87 ms, which is 7–10 dropped frames at 120 Hz.
- The first A/B (`ios-mulc7jn9`, sound probes on) agreed: 30 of 83 taps over 100 ms, and zero
  with sound off.

**Silent effects (#2, #10).** Debug, `ios-mulaeyft`. Each play was sampled at 30, 90 and 250 ms:

| Sound | Silent plays |
|---|---|
| select | 38 / 127 |
| pass | 28 / 73 |
| turn | 17 / 38 |
| play | 16 / 37 |
| combo | 10 / 24 |
| round_win | 12 / 24 |
| round_start | 9 / 24 |
| deal | 3 / 3 |
| clockRunningOut | 1 / 2 |
| reject | 1 / 2 |
| exchange | 1 / 2 |

- **The mechanism**, seen in the samples: the player is parked at the end of its clip
  (`currentTime == duration`, not playing). `play()` runs before the unawaited `seekTo(0)` lands,
  so it ends again at once; the seek then lands at 0 and leaves the player paused. At 30 ms the
  sample reads `ct = dur`; at 90 and 250 ms it reads `ct = 0`, not playing.
- **A fresh player's first play waits about 750 ms** (`waitingToPlayAtSpecifiedRate /
  evaluatingBufferingRate`). The deal plays late every time.

**Pile-ups (#2).** 31 in 6 minutes: distinct effects triggered within 40 ms of each other, keyed
to one game event with no mixing policy.

- turn + pass at +0 ms;
- pass + round_win at +27–36 ms;
- combo/play + turn at +34–37 ms.

**Music (#7).** Every track switch pauses the old AVPlayer and starts a cold one:

- The new player waits in `waitingToPlayAtSpecifiedRate` for 2–4 s, which is a silent gap.
- In 3 of 5 switches across both builds, the new track reported `playing` and then fell silent at
  `ct = 0`, and stayed silent:
  - Debug at 186 s (cue → hand);
  - Release at 144 s (cue → hand);
  - Release at 165 s (hand → menu).
- JS still believes the track is playing, so `playMusic` is a no-op and nothing recovers it.
- **Mechanism, from source; the device shows the symptom and the timing:**
  - `pause()` on the old player calls expo-audio's `deactivateSession()`
    (`node_modules/expo-audio/ios/AudioModule.swift:244-249`).
  - 100 ms later that checks whether any player is `.playing`; the new one is still waiting, so it
    calls `AVAudioSession.setActive(false)` (`:828-842`).
  - That tears down the output under the player that is just starting.

**Win/loss sound (#5).** Three causes, all measured:

- **A neutral manche plays no sting, by design** (`useTableFeedback.ts:461`). At 168.8 s the
  outcome was `neutral`, and to the player the sound was simply missing.
- **The sting fires 0.5 s after `gameOver`, and the table leaves for `/result` 0.34 s later.**
  - The results screen switches the music to the cold `cue` track over the sting (Debug 331.3 →
    331.6 s; Release 140.9 → 141.3 s).
  - The table's unmount cancels any sting still pending: `stingCancelled` fired on every manche
    end.
  - The cue track's cold start then leaves 2–4 s of silence.
- **`partitaOver` is defined in `lib/device/cues.ts:78` and fired nowhere.** The end of a partita
  has no sting at all.

**Bomb (#6).** Not exercised on the device: the owner could not get a bomb. It rides the same
path:

- a single-voice AVPlayer;
- three haptic pulses (`cues.ts:55-59`), each a new main-thread generator;
- a landing timed by the guessed delay below.

It needs a seeded-save check, not a live one.

### Root cause

**expo-audio 57** plays effects through one `AVPlayer` per clip. On iOS, each `play()`:

- calls `AVAudioSession.setActive(true)` synchronously (`AudioModule.swift:212-216`, `:824-826`);
- removes and re-adds a periodic time observer on the **main queue** (`AudioPlayer.swift:474-491`);
- re-registers an `AVPlayerItemDidPlayToEndTime` observer with `object: nil`
  (`AudioPlayer.swift:442-472`), so every clip ending in the app is delivered to every player that
  has ever played.

Its `seekTo` is async while `play` is sync, hence the silent race. It deactivates the shared
session whenever a clip completes or a player pauses and none is `.playing` at that instant. It
has no scheduling, no mixing and no gain ramp. AVPlayer is a media-playback engine built for
streams, not a sound-effects engine.

**expo-haptics** creates, prepares and fires a new `UIFeedbackGenerator` on the main queue on
every call (`node_modules/expo-haptics/ios/HapticsModule.swift:7-26`). Apple's pattern is a
long-lived generator prepared ahead of the event.

**The app** layers several things on top:

- no mixing policy (turn + pass + round_win on one event);
- no in-flight dedupe in `ensureAudioMode` (`lib/device/sounds.ts:170`), with waits up to 112 ms
  measured;
- music switched by pausing one player and cold-starting another (`lib/device/music.ts:268-304`);
- a volume fade stepped by a JS `setInterval` (`music.ts:197-213`);
- the sting parked on a timer that the table's unmount cancels.

**Class:** a native library does per-event work on the UI thread, and its session lifecycle is
decided per player. **Every sound and haptic in the app is an instance.**

### Fix direction

**Replace, do not tune.** The owner's standard is the best available, with no workarounds. Tuning
expo-audio (`keepAudioSessionActive`, awaiting the seek) would stop the silent plays and the
music deaths, but it keeps per-play AVPlayer work, the main-queue observers, no scheduling and no
mixing. The replacement must meet all of these:

- **One audio engine**, created once, with the session activated once. Interruptions (calls,
  Siri) and route changes are handled by the engine, not per player.
- **Effects decoded once into memory buffers.** A play is starting a buffer source: no seek, no
  cold start, polyphonic, and no main-thread work.
- **Sample-accurate scheduling** (`start(when)`), so a landing sound starts at the landing,
  computed from the same pose clock as the animation (§Timing).
- **A mixer:**
  - buses for effects, music and stings;
  - gain ramps for fades and ducking done by the engine, not a JS interval;
  - a per-event mixing policy, so one event sounds one thing.
- **Music streamed or scheduled on the same engine,** with crossfades between arrangements, so a
  track switch never pauses a player or touches the session.
- **Haptics from long-lived prepared generators,** or Core Haptics, fired off the per-tap path.
- **One API for iOS, Android and web.** Web already plays effects and music through the Web Audio
  API (`sounds.ts:128-153`, `music.ts:57-161`). A Web-Audio-compatible native engine lets one
  implementation serve all three platforms, deleting the per-platform branches rather than adding
  a third.

The library choice is in §Engine choice below, from a separate primary-source review.

### Checks that go red

- **Device gate: the tap A/B, rerun per build.** Its pass condition is:
  - sound on and haptics on;
  - 60 fast taps;
  - no UI frame over 34 ms attributable to a tap;
  - 0 silent plays.

  It uses the frame and tap probes above, promoted to a dev-only diagnostics module that ships
  off.
- **Unit: the audio facade.** Every effect is a buffer-source start on a shared engine. A play
  never calls a session API or a seek. Every cue in `cues.ts` maps to a sound and a mixing rule
  (`satisfies Record<…>`), so an unmapped cue is a compile error.
- **Unit: session lifecycle.** A track switch never deactivates the session. It fails today by
  construction, because the facade has no deactivate path to call.
- **Wiring:** a native test pins every `Moment` kind to a caller. That includes `partitaOver`,
  which today has none.
- **Web Playwright:** the existing `traceOnset("sound", …)` onsets are checked against the landing
  moment (§Timing).

## Timing: effects on guessed delays and separate clocks (#3, #4, #9, pile-ups)

### Measured

**Dust too early (#3).** Throw → flight-start render latency was p50 75 ms and p90 126 ms in
Debug, and p50 20 ms in Release. The impact timer itself is on time (p50 9 ms late). But the dust
and the landing sound fire at **p50 56% (Debug) and 78% (Release) of the flight's travel**,
before the card arrives. On web, at 253 ms the card is still 11.5–14.8 pt from rest and moving at
143–306 pt/s. It is within 2 pt only from 294 ms.

**Why:**

- `impactDelayMs = 40 + 260 × 0.82 = 253 ms` (`components/flightPhysics.ts:73-81`).
- The 0.82 is from 95f4e9e8 (2026-08-16), for a 380 ms flight with squash at 82%. The flight was
  reshaped by #126 and the fraction never re-derived.
- The feedback timer starts in `usePileFlight`'s effect (`pile.tsx:851`, `:873`). The flight
  starts one render later, in `FlyingCards`' effect (`pile.tsx:878` → `:106`). Two clocks, so
  render latency lands directly as early dust.

**Other instances of the same class:**

- `landsAtRef = Date.now() + handOffDelayMs` (`useTableFeedback.ts:372`) drives the turn chip,
  the turn cue and the lamp target.
- `seats.tsx:197`: the departing backs.
- `pile.tsx:847`: the bomb scrim.
- `ExchangeFlight.tsx:102` against `sharedGameFlow.ts:191`.
- The sting timer (§#5).
- `pile.tsx:824` clears a pending impact when the next play arrives, so a landing sound is
  dropped outright.

**A parity check that cannot fail.** `tests/e2e/helpers/mockupParity.ts:150`, `:179-182` starts
the app's plays at `TRICK_LANDINGS − impactDelayMs`, so the landing-onset comparison is green by
construction. It is a self-defeating safeguard (CLAUDE.md invariant).

**Stale documentation:** `docs/design/FEEL-BAR.md:16` and `pile.tsx:836` say 213 ms; the value is
253. `FEEL-BAR.md:427` checks the landing against `impactDelayMs` itself.

**The throw (#4).** Measured against the mockup, `tests/e2e/fixtures/lantern-table/index.html:513-521`,
`play()`:

| | Mockup | App today |
|---|---|---|
| Flight | 380 ms per card, 45 ms stagger (20 ms in reconnect catch-up), lands at 380 + 45(n−1) | 40 ms anticipation + 260 ms travel, no stagger |
| Easing | 1−(1−k)³ on every channel | — |
| Lift | −24 sin(πe), peaking at 78 ms | — |
| Scale | sc + (1−sc)e + 0.1 sin(πe), from 0.4 (fan) or 1.2 (hand card) | no scale |
| Rotation | from the origin card's angle to (i−(n−1)/2)·1.2° | fixed `FLY_ROTS` |
| Origin | opponent fan centre (457,124.5 / 129,180 / 785,180), or each hand card's own slot for you | ring or hand centre |
| Destination | slots 34/28/24 pt apart around (457,222) | — |
| Appearance | visible at origin at once; lamp shadow only; inside the pile layer group | fades in over 63 ms; lifted shadow; `Layer.sheet` overlay |
| After landing | 400 ms wobble, then chip, sound, dust | extra pile dip + spring after the wobble (`pile.tsx:474-480`) |

**The exchange (#9).** Each traded card holds face-up and still for only 260 ms, both at once,
with no highlight in the hand. The taken card never visibly leaves the loser's hand (the engine
moves it first, `GameContext.tsx:204-215`).

- The prompt fades in over 600 ms under the deal (`ExchangePrompt.tsx:79`).
- The bot gives at +600 ms, mid-deal (`app/game.tsx:34`, `:147`).
- The exchange sound is keyed to the phase opening, over the deal (`useTableFeedback.ts:407`).
- The fliers unmount at 1780 ms (`sharedGameFlow.ts:191`) into a gap open since 600 ms.
- The tags vanish without a fade (`ExchangeAnnouncement.tsx:80`, `:131-146`).
- Online, a bot or AFK winner re-arms after 1200 ms (`server/game/gameTurn.ts:191`, `:218`)
  instead of `exchangeAnnounceMs`, so bots play over the tags.
- **Design reference:** the mockup's `receive` / `giveBack` (`index.html:543-551`, `:601-605`),
  sequential and about 2.75 s:
  1. 1250 ms: sound; the back flies 380 ms with a 30 pt lift.
  2. 1700–1940 ms: flip.
  3. Holds still for 480 ms.
  4. 2300–2620 ms: moves into its sorted slot with a gold ring and glow, highlighted for 1000 ms.
  5. The giveback is selected and waits 420 ms, then flies 460 ms with a 40 pt lift, flipping to
     its back.

### Root cause and class

**Class: an effect's onset is keyed to a guessed time on a clock separate from the motion it
describes.** Each consumer re-derives "when does it land" from constants, and the constants
drifted when the motion changed.

### Fix direction

One clock per motion:

- The flight is a pure worklet pose, `flightPose(elapsedMs, i, n, from, to)`, driven by one
  progress value on the UI thread.
- When the last card is at rest, it emits `onLanded` via `scheduleOnRN`. Every cue follows from
  `onLanded`: sound, dust, shake, turn handoff, lamp, sting.
- `landingMs(n)` stays as a pure function, for prediction only.
- `LANDING_FRACTION` is deleted.
- The throw adopts the mockup's motion. That needs a new ADR, "The throw is the lantern mockup's",
  superseding #126's throw travel and ADR-0002 §1 (origin) and §4 (`impactDelayMs`).
  `Motion.duration.travel` stays for the deal and fades; the throw gets its own token and a
  stagger token.
- The exchange becomes one explicit timeline (`exchangeTimeline()`, pure), started after the deal
  lands.
- **Owner decision:** the mockup's giveback flies face-down, while #602's tags show both cards to
  every seat.

### Checks that go red

- **Unit:** `landingMs(n)` equals the time `flightPose` reaches rest, for n = 1..6 and all 4 seats.
- **Unit:** `exchangeTimeline()` holds each reveal for at least 600 ms and orders the legs.
- **Web:** `lib/e2eTrace.ts` gains a `flight` source (maximum distance from rest). `traceDiff`
  requires `moment:landing` within 16 ms of the first frame with every card within 1 pt of rest.
  It fails today at 56–78% of travel.
- **Web:** the mockup parity spec plays at the mockup's throw times (1150, 2600, 5350 ms) without
  subtracting app constants, and holds the landing and `sound:combo` onsets to 16 ms. It fails
  today (the app lands at about 1403 ms against 1584).

## Layout and light derived from changing content (#12, #13)

### Side avatars drift up (#13)

**Measured.** On device, the side seat's ring y fell from 149 to 95 pt when the top player went
out (169 s), and stepped 149 → 144 as cards were played. It resets at the deal. The web model
predicts the device to 0.1 pt:

| Cards (side/top/side) | Ring y, predicted | Ring y, measured |
|---|---|---|
| 13/13/13 | 180.2 | 180.1 |
| 2/13/2 | 166.1 | 166.1 |
| 2/1/2 | 161.6 | 161.5 |
| 1/out/1 | 111.8 | 111.8 |

That is up to 68 pt of rise per manche. The web measurement is in scratchpad `drift.mts`, with the
seeded saves in `saves.json`.

**Root cause.** The bands are content-sized:

- The top band (`components/table/chrome.tsx:495-499`) has no height, so the middle band starts
  where the top fan ends: `topFanHeight(count)` at `seatLayout.ts:307`, 48.1 pt at 7 cards down to
  43.5 at 1. The fan unmounts when the player is out, dropping the band by 49.8 pt.
- `sideSection` is `alignSelf: "flex-start"` (`chrome.tsx:509`), so the ring centres in
  `sideSlotHeight(count)` (`seatLayout.ts:294`: 62.2 at 5 cards, 34 at 2 or fewer).
- Introduced by b90adb91 (2026-08-16) and doubled by 1cdbd90b (2026-08-26).
- The pile centre drifts by half the top band's change (231 → 204).

**Class: a seat's position is a function of a count.**

**Fix.** Fixed band sizes from the fan cap (`FAN_DRAWN_CARDS`), taking no count.
`flightOrigin` and `pileGeometry` (`flightPhysics.ts:457-511`) drop `topDisplayedCount` and
`sideDisplayedCount`. `flightPhysics.test.ts:1360-1368` currently asserts the moving formula and
must be inverted.

**Check.** A Playwright spec with seeded saves (13/13/13, 2/13/2, 2/1/2, top out), for every
`PHONES` entry. The side ring centres, the top ring and the pile centre must stay within 0.5 pt of
the deal position. `seatFans.spec.ts:184`'s "do not creep" varies only the viewport, which is why
it stayed green.

### The turn lamp barely reads (#12)

**Measured.** The shader maths was ported to JS; scratchpad `lamp.mjs` and `lamp2.mjs`. On-move
luminance against the brightest other seat, round the seat disc:

| Seat | Ratio today |
|---|---|
| bottom | 1.50 |
| top | 4.25 |
| left | 0.91 (the on-move seat is *darker*) |
| right | 1.42 |

Before #1257, `FeltPool` gave 12–26×.

**Root cause.**

- `feltShader.ts` `CLOTH_BODY` ports the mockup's vignette, fixed at (457,210) with a 420 pt
  falloff. It dims the side seats to about 0.6 and covers the whole table.
- The "you" light point sits 42 pt from the vignette centre.
- `useLampRig` is fed the window size (`GameTable.tsx:698-703`), while the seats are placed in the
  inset-aware table frame (`tableFrame.ts:147-152`), so the pools miss the seats by 14 pt.
- The lamp aims at a fixed side y of 196 (`lampRig.ts:13-19`) while the ring falls to 112 (#13).
- **The mockup has the same vignette defect**, so it cannot be the reference for this one.
- **Class: a cue verified by its parameters, not by what the player perceives.** `lampSeats`
  pins coordinates, and `feltParityGrid.ts:260-275` has no margin.

**Fix direction.** Centre the vignette on the light point, with a falloff of about R300; put the
"you" pool at about y 360; feed the rig from the table frame. Modelled ratios: 6.9 / 10.6 / 4.5 /
7.5.

**Owner decision:** the mockup is wrong here, and this departs from it on purpose.

**Check.** `tests/e2e/lampLegibility.spec.ts`: a screenshot of the felt layer, sampled in an
annulus per seat ring. The on-move seat must be at least 3× the brightest other seat, for each
seat on move.

**Also:** there is no countdown ring when a bot leads a new round offline
(`GameTable.tsx:935-950`).

## UI-thread and JS-thread load that is not audio (#1, #8)

### Always-on redraw

**Measured.** Reduce Motion freezes the lamp sway, and UI fps went from 78–90 to 111.

**Why:**

- The lamp sway never settles (`lampRig.ts:24`, `:83`; `lampRig.test.ts:121-127` *requires* a
  redraw on more than 570 of 600 frames).
- So the full-screen SkSL cloth, plus 4 more full-screen passes (about 3.2 Mpx), re-renders every
  frame.
- Core Animation recomposites about 90–110 `boxShadow` layers, each with a `CAShapeLayer` mask,
  which is an offscreen pass (`RCTBoxShadow.mm:73-107`).
- There are 2 non-opaque full-screen Metal layers.

**Class: a static scene redrawn per frame.**

**Fix.**

- Bake the cloth once, and keep a cheap per-frame light pass (or a sway that settles).
- Make the felt layer opaque.
- Bake card shadows, or draw them unmasked.

**Check.** A native test on a shadow-layer budget, plus the redraw test inverted to require the
table to rest.

### Mount hitches

**Measured.** In Release, the JS stalls at every flight mount (p50 52 ms) and at turn/pass
commits (p50 51 ms).

**Why:**

- `FlyingCards` mounts N face `CardView`s, and `PlayedPile` mounts them again at landing.
- Each face is about 25–35 native views, with RNSVG raster on the main thread.
- The deal is about 52 animated views; the worst single stall was 1459 ms at the deal (Debug).

**Class:** a card is re-created at each stage of its journey.

**Fix:** one persistent view per card, from hand to flight to pile.

**Check:** a native Profiler test allowing at most 1 `CardView` mount per card played.

### Selection re-renders

- tap → commit was p50 19 ms, p90 31 ms. The React side is not the stall.
- Every offline tap re-renders the home screen: `app/index.tsx:655` subscribes to the one
  `GameContext`, which includes `selectedCards`.
- The staged-play check reruns `getAllValidPlays` per selection.
- `selected && Shadow.cardLifted` (`CardView.tsx:716`) rebuilds the shadow layers on every select.
- The lift is started from JS (`CardView.tsx:577-586`), and Reanimated 4 pauses UI commits while a
  React commit mounts, so a burst of taps freezes the previous lift mid-spring.

**Fix:**

- The lift and tilt are driven by a UI-thread gesture; React state follows.
- A static lifted-shadow layer toggled by opacity.
- Split the context.

**Check:** a native Profiler test where one selection is one commit and one `CardView` render,
with no seat or home render.

## Notices are inconsistent (#11)

**Measured.** 18 notice surfaces, with no shared primitive:

- about 10 fills, 5 radii and about 8 borders;
- Rajdhani and Inter across 4 faces and about 9 sizes;
- 7 different entrance motions.

"Who starts" is shown twice at once (`chrome.tsx:49` gate, and `:604`).

**Inventory:**

| Surface | Location |
|---|---|
| StartReasonBanner | `chrome.tsx:49-176` |
| StartCardBanner | `chrome.tsx:604-640` |
| NotificationBanner (autopass) | `app/game.tsx:207-215` |
| ExchangePrompt | `:42`, `:105-140` |
| noSwap ExchangeAnnouncement | `:191`, `:301-312` |
| ExchangeSeatTag | `ExchangeFlight.tsx:141`, `:184-197` |
| winner tag | `pile.tsx:519`, `:1003` |
| ComboChip | `pile.tsx:552/575`, `:1034/1046` |
| TableChip | `chrome.tsx:189`, `:297-342` |
| seat chips | `seats.tsx:584/599/639` |
| reject hint | `GameTable.tsx:1424-1448` |
| RematchPromptPanel | `rematchPrompt.tsx:43`, `:109-166` |
| online banners | `app/(online)/game.tsx:343-410`, `:512` |
| error toast | `:452-457`, `:538` |
| ConfirmDialog, GameOverOverlay, OfflineBanner, finished row | `GameTable.tsx:1334` for the last |

**Design reference: the mockup's vocabulary.**

- `.chip`:
  - height 23.7, radius 999, padding 0 13, gap 7, dot 6;
  - fill rgba(3,14,9,.72), border 1px rgba(201,168,76,.3);
  - text weight 600, 10 px, letter-spacing 1.55, uppercase.
- `.chip` variants:
  - `.lit`: border rgba(243,224,166,.8), glow 20.6;
  - `.urgent`: #ff8a5c;
  - `.ok`: rgba(143,191,138,.7);
  - `.bad`: #d0574b;
  - `.net`: dot blinking every .9 s.
- `.cchip`: 15 tall.
- `.passo`: 15 tall, radius 8; enters over 100 ms with a 6 px rise.
- `.floatchip`: 100 / 1100 / 100 ms.
- `#score`: radius 12.
- The pill notes: *Distribuzione, Scambio, Fine manche, Partita finita, Tavolo in attesa,
  Riconnessione…, Di nuovo in linea, Connessione persa · Riprova*.

**Class:** no notice primitive and no spec. 11 commits hand-built one each; the `Scrim.heavy`
plate is inlined at about 14 sites.

**Fix.** A `TableNotice` primitive with no `style` prop:

- shapes: pill, chip, float, panel;
- tones: neutral, lit, urgent, ok, bad;
- Rajdhani; 100–240 ms entrance with a 6 px rise.

Autopass moves off `NotificationBanner`.

**Owner decision:** the spec keeps `OfflineBanner`, which conflicts with this.

**Check.** `tests/native/tableNotices.test.tsx`:

- a `NoticeKind` union with fixtures `satisfies Record<NoticeKind, …>`;
- every painted `View` containing `Text` in `GameTable` has a `TableNotice` ancestor;
- each kind renders.

## Overall polish (#14), ranked

Each item names its source line and the mockup value:

1. Content sits 14 pt left of the felt centre (the right seat is 67 pt inside the felt edge, the
   left 23; the mockup has 7 / 23).
2. The lamp (#12).
3. Notices (#11), and the hard cut on the who-starts gate.
4. Waiting seats are dimmed to .62 (`seats.tsx:937`); the mockup does not dim.
5. The name sits on a plate (`seats.tsx:987`); the mockup uses a bare `.nm`.
6. PASSA is garnet (`actions.tsx:47`); the mockup uses dark glass.
7. The last-card badge is gold; the mockup uses red #9e1f26 with a glow (`seats.tsx:1048`).
8. A beaten combo is at opacity .3; the mockup keeps it opaque at brightness .6
   (`pile.tsx:1027`).
9. The PASSO chip is 23.7 tall with no motion; the mockup's is 15 tall with a 100 ms rise.
10. The viewer's own pass shows nothing.
11. The turn pill: lit border .5 (mockup .8, `chrome.tsx:322`), dot glow 9 (mockup 6), padding
    11.3 (mockup 13), and no notes.
12. No countdown ring on a bot-led round offline.
13. The felt combo chip has radius 8; the mockup uses a pill.
14. Inter on table surfaces: `chrome.tsx:154,166,171`, `rematchPrompt.tsx:130,162`,
    `app/(online)/game.tsx:522,553`, `NotificationBanner.tsx:262`.
15. Hard cuts: StartReason, StartCard, the reconnect banners, the error toast, noSwap, the
    reject-hint exit.
16. The partita ends in a modal; the mockup goes pill → board (#1266 / #1267).
17. The won badge is `goldMuted` (`seats.tsx:1039`); the mockup uses #C9A84C.
18. The ambient work in #1260–#1264 is missing.

Also: hard-coded icon sizes (`GameTable.tsx:1336`, `pile.tsx:525`), and `feltParityGrid.ts:1-7`
claims the lamp scales with the frame, which it does not.

## Other defects found on the way

- **The server crashes when Postgres restarts.** `server/socket/socketAdapter.ts:162` listens only
  on `pool.on("error")`. The adapter's checked-out LISTEN client (`@socket.io/postgres-adapter`
  `initClient`) has no `error` listener, so a backend termination is an unhandled `error` event.
  `server/store/db.ts:63` is the same class.
  - Fix: `pool.on("connect", c => c.on("error", …))`.
  - Check: an integration test that terminates the backend with `pg_terminate_backend` and
    expects the server to stay up.
- **Online exchange re-arm:** the bot/AFK winner uses 1200 ms (`gameTurn.ts:191`, `:218`), not
  `exchangeAnnounceMs` (§Timing).
- **Card teleports:**
  - on the winner's confirm;
  - the received card goes table centre → loser seat, then crosses again;
  - given and thrown cards leave from the hand zone's centre, not their own slot.
- **The web perf harness is blind to all of this:**
  - desktop Chromium at 60 Hz;
  - no tap burst;
  - no input-to-feedback latency;
  - no gate.

  The device diagnostics above are the only instrument that saw #1 and #8.

## Engine choice (audio and haptics)

The full primary-source review is `docs/research/2026-09-28-audio-engine.md`. It is judged against
the requirements in §Audio and haptics → Fix direction.

### Audio: react-native-audio-api 0.13.6 (Software Mansion)

It is the Web Audio API on native, with one `AudioContext` for music and effects on iOS, Android
and web. On web it wraps the browser's own `AudioContext`, which the app already uses.

**Why each measured defect goes away:**

- **No per-play session or main-thread work.**
  - `start()` queues work for the audio thread.
  - The session is activated once and cached, and re-armed only after an interruption or route
    change.
  - It is deactivated only by an explicit call.
- **No seek:** each play is a fresh one-shot source, so the silent race cannot happen.
- **Buffers are decoded off the JS thread at preload.**
- **`start(when)` is sample-accurate**, which gives the landing sync.
- **Gain automation** gives crossfades and ducking, so a track switch never pauses a player.

**Rejected:**

- **expo-audio with `keepAudioSessionActive` and an awaited seek** fixes the silent plays only;
  the per-play `setActive`, the observers, the cold starts, scheduling and ramps all remain.
- **react-native-track-player** covers music only.
- **react-native-sound** is one AVAudioPlayer per sound.
- **A custom AVAudioEngine + Oboe module** re-implements this library without its web path. It is
  kept as the fallback if the device verification fails.

### Haptics: react-native-turbo-haptics 1.2.0

- Generators are long-lived and cached, triggered and then re-prepared (Apple's recommended
  order).
- It runs directly on main when called from a UI worklet, so landing and bomb pulses can fire on
  the exact animation frame.
- On Android it uses the system haptic constants.
- **Rejected:** expo-haptics, react-native-haptic-feedback and react-native-nitro-haptics, all of
  which allocate per call. Pulsar is correct but far larger than seven tap types need.

### Corrections the review made to the premises here

- **The music tracks are 27.41 s loops of 1.6–2.0 MB each, not long tracks.** Decoding one into
  memory (about 10.5 MB of PCM) and looping it is the right model, and nothing needs streaming.
- **The library cannot decode the WebM that Android plays today.** Native music moves to FLAC,
  converted losslessly from the current ALAC.

### Adoption constraints

- **Pins:** both libraries exactly; remove expo-audio and expo-haptics.
- **Config plugin:** turn off its defaults (background audio, the Android foreground service and
  its permissions), and disable the FFmpeg and static-lib downloads.
- **One owner module,** `lib/device/audioEngine.ts`, pinned by a test.
- **Lifecycle:** create the context at launch and `resume()` it, which avoids iOS #1238 and moves
  the driver start off the tap. Suspend and resume from `AppState`.
- **Watchdog:** recreate the context if it is not running after `resume()` (Android #1230).
- **Don't attach `onEnded` to effects** (#1285).
- **Android release decode:** pass an `expo-asset` `localUri`, not base64.
- **Risks to prove in our own CI:**
  - RN 0.86 was never built by the library's CI (0.85 and 0.87 were);
  - the worklets build coupling;
  - Android crackle and memory on a low-end device (#1231, #1263);
  - turbo-haptics has one maintainer and no web or jest support. The fallback is to vendor its
    roughly 200 MIT-licensed lines as a local Expo module.
- **Tests:** 52 `tests/native` files mock expo-audio or expo-haptics. Centralize the mocks.

## Owner decisions this research needs

1. **#12:** depart from the mockup's vignette, which carries the same defect.
2. **#9:** the giveback flies face-down (mockup), or both cards are shown to every seat (#602).
3. **#11:** `OfflineBanner` survives as its own surface (spec), or becomes a `TableNotice`.
4. **#4:** a new ADR adopting the mockup's throw, superseding #126 and ADR-0002 §1 / §4.
5. **#5:** does a neutral manche get a sound of its own?
6. **iOS mixing policy for the always-on session.** Today expo-audio silently applies
   `duckOthers` on iOS as well. Once the session stays active for the whole run, that would duck
   the player's own music (Spotify) the whole time. `mixWithOthers` is the suggestion.

## Reproducing the measurements

Everything is kept outside the repo, in `C:/Users/roton/murlan-plans/2026-09-28-1259-lantern-review/`:

- `data/device-debug.ndjson`: all five device sessions.
- `data/run-debug.ndjson`: the first Debug session alone.
- `scripts/`: the analysis scripts.
- `probes.diff`, `debug1259.ts` and `Debug1259Probe.tsx`: the probes, tagged `[DEBUG-1259]`.
- `notes-agents*.md`: the web measurements' notes.

The scripts read their data file from their own directory, so run them from `data/` or copy them
there:

| Script | What it reports |
|---|---|
| `analyze.mjs` | everything, per session |
| `taps.mjs` | tap stalls |
| `deact.mjs` | the session-deactivation hypothesis, refuted for taps: 27% of stalls follow a clip end against a 23% baseline |
| `ab.mjs` | the haptics / sound / Reduce Motion A/B |
| `builds.mjs` | Debug vs Release |

The plan's first task promotes the frame/tap/sound probes to a dev-only diagnostics module that
ships off, so that every fix below is verified on the device by the same numbers.
