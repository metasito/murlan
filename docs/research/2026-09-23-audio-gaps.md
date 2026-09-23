# Where the current audio falls short

Answers #1232 (map #1230), and folds in the older listening pass #127. #127 closed with the
owner's hardware verdict on the **original twelve** effects ("all twelve effects hold up as
authored... No remix, no replace") — that subjective judgment is not reopened here. What follows
is the objective half #1232 asked for: loudness, peak and duration measured with a tool, checked
against first-party practice, plus every moment that currently has no sound at all.

## Method

Every file in `assets/sounds/` (16) and every music file `lib/device/music.ts` plays
(`assets/music/*.m4a`, the iOS container — same audio as the `.webm` set per
`tests/tooling/musicAssets.test.ts`) was measured with `ffmpeg 9.0`'s `ebur128` filter
(`-af ebur128=peak=true`), which implements ITU-R BS.1770 (the algorithm EBU R128 and every
platform loudness target below is built on). Durations from `ffprobe`.

Sixteen of these files run under 1.1 seconds — shorter than the 400 ms gating block EBU R128's
integrated-loudness measurement requires, so a single play of `card_play.mp3` (0.39s) or
`urgent_tick.mp3` (0.13s) reports a meaningless `-70.0 LUFS` (the algorithm's absolute silence
floor, never reached). Every short file below was measured looped 8× back-to-back
(`ffmpeg -stream_loop 7 -i <file>`) to give the gate enough duration to produce a real reading —
content-neutral, since it is the same clip repeated, not a different mix. True peak is identical
either way and was cross-checked against the single-play run.

"Effective LUFS" is the looped-file reading plus the gain `lib/device/sounds.ts`'s `play()`
applies per call (`20*log10(volume)`, at master volume 1) — what a player actually hears, not
what is on disk.

## Practice checked against

**EBU R 128 s1 — Loudness Parameters for Short-form Content**
`https://tech.ebu.ch/docs/r/r128s1.pdf` (fetched directly, PDF text extracted with `pdftotext`)
The EBU's own supplement for adverts, promos, stingers and "similar very short items" — the
closest first-party category to a one-shot UI sound, closer than the base R128 (built for
full-length programmes). Quoted verbatim from its Summary:
`Programme Loudness -23.0 LUFS · Maximum Short-term Loudness -18.0 LUFS (+5.0 LU) · Maximum True
Peak Level -1 dBTP`. ffmpeg's own `ebur128` filter defaults its on-screen `TARGET:` line to
-23 LUFS — the same EBU number, independently confirming the tool measures against the standard
it claims to.

**Sony ASWG-R001 and Google's own mobile mix-level guidance, via a secondary practitioner
account** (`gamedev.dou.ua/blogs/mobile-audio-challenges-and-their-solutions`, verified by direct
fetch) — no first-party Sony or Google URL for either number resolved (Sony's ASWG specs are not
publicly hosted; Google's mobile audio loudness guidance was not found as a standalone published
page). Quoted as reported: *"Follow the Sony (-18 LUFS) and Google Developers (-16 LUFS)
recommendations for the mix level"* for portable/mobile titles. Reported at this remove because
it is the only place these numbers turned up with attribution; treat the -16/-18 LUFS band as
directional, not verified against Sony's or Google's own document.

**Balatro's own scoring-sound pitch (shipped source, read directly)**
`https://raw.githubusercontent.com/GladdonT/balatro-source-code/main/functions/common_events.lua`
and `.../functions/state_events.lua` — fetched and grepped directly, not summarized. This is the
ticket's own comparison point ("Balatro's rising pitch per scored card"), and it is real:
`card_eval_status_text()` (`common_events.lua:892,912`) plays every chip/mult scoring sound with
`play_sound(sound, 0.8+percent*0.2, volume)` — pitch running from 0.8× to 1.0× playback rate.
`percent` is computed once per scored card in `evaluate_play()`
(`state_events.lua:176`): `local percent = (i-0.999)/(#G.hand.cards-0.998) + (j-1)*0.1`, where `i`
is the card's own index in the scored hand — so pitch climbs card-by-card across a single hand's
scoring pass, not a random per-play jitter. Murlan has no equivalent: `lib/device/sounds.ts`'s
`jitter()` randomizes ±4% pitch per play, uncorrelated with position in a trick or combo, so nothing
currently rises across a play the way Balatro's does. This is the ticket's own stated premise,
and it checks out against the shipped source.

## Per-file measurements

All effects are 44.1 kHz mono MP3; all music is 48 kHz stereo (ALAC in this M4A set). Volume is
the multiplier `lib/device/sounds.ts` passes to `play()` for that call (master volume 1);
"Verified?" is whether the file existed when #127 closed (file mtime `ago 18` and earlier) vs.
after (`set 21/22` — never heard on hardware, never in a #97/#127 verdict).

| File | Event(s) | Vol | Raw LUFS(I) | Eff. LUFS | True peak | Duration | Layers | Verified? | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| bomb.mp3 | bomb play | 1.0 | -23.8 | -23.8 | -1.5 dBFS | 1.04s | 3 (chip clatter+shove+drop) | yes | keep |
| card_pass.mp3 | pass | 0.75 | -30.3 | -32.8 | -1.5 dBFS | 1.10s | 1, ±4%/±8% jitter | yes | keep |
| card_play.mp3 | play, exchange give | 1.0 | -28.6 | -28.6 | -1.7 dBFS | 0.39s | 1, jitter | yes | keep |
| card_select.mp3 | select (0.75)/deselect (0.55, no jitter) | 0.75/0.55 | -25.2 | -27.7 / -30.4 | -1.5 dBFS | 0.73s | 1, jitter (select only) | yes | keep |
| count_complete.mp3 | pile count-complete | 0.8 | -20.8 | -22.7 | -2.2 dBFS | 0.29s | 1 | **no** | keep, unverified |
| deal.mp3 | deal (once/hand) | 0.8 | -30.4 | -32.3 | -1.6 dBFS | 3.16s | 1 long clip, jitter | yes | keep |
| exchange.mp3 | exchange confirm | 0.85 | -24.7 | -26.1 | **-0.3 dBFS** | 0.89s | 1 | yes | **remix** (peak) |
| game_lose.mp3 | partita lost | 0.85 | -18.5 | -19.9 | -1.7 dBFS | 0.50s | 2 (falling pair) | yes | keep |
| game_win.mp3 | partita won | 1.0 | -17.8 | -17.8 | -1.5 dBFS | 0.91s | 3 (rising triad) | yes | keep |
| reject.mp3 | GIOCA refused | 0.7 | -19.3 | -22.4 | -1.3 dBFS | 0.21s | 1, jitter | **no** | keep, unverified |
| room_full.mp3 | last lobby seat | 0.85 | -18.5 | -19.9 | -1.9 dBFS | 0.29s | 2 (3rd+5th) | **no** | keep, unverified |
| round_start.mp3 | manche start | 0.85 | -22.3 | -23.7 | **-0.4 dBFS** | 0.81s | 1 | yes | **remix** (peak) |
| round_win.mp3 | manche won | 1.0 | -13.8 | -13.8 | -1.5 dBFS | 0.39s | 1 | yes | **remix** (gain) |
| seat_fill.mp3 | lobby seat fills | 0.8 | -24.2 | -26.1 | -1.2 dBFS | 0.26s | 1 | **no** | keep, unverified |
| urgent_tick.mp3 | turn-clock tick | 0.8 | -23.4 | -25.3 | -1.0 dBFS | 0.13s | 1, flat | yes | keep |
| your_turn.mp3 | turn hand-off (incoming) | 0.9 | -20.8 | -21.7 | -1.5 dBFS | 0.24s | 1 | yes | keep |

**The three `remix` flags are all objective, not aesthetic** — they don't reopen #127's verdict
on how anything sounds, only its level:

- **`exchange.mp3` and `round_start.mp3`** true-peak at -0.3 and -0.4 dBFS — inside EBU R128 s1's
  -1 dBTP ceiling only by 0.6-0.7 dB, the tightest margins of any effect in the set. A lossy
  re-encode or a phone's own output limiter can push either over. Remix = renormalize peak down
  ~1.5 dB; no content change.
- **`round_win.mp3`** is the loudest single effect measured (-13.8 LUFS, 4+ LU hotter than
  `game_win.mp3`'s -17.8) despite being the *lower* tier in `docs/FEEL-BAR.md`'s own win hierarchy
  (manche below partita). `FEEL-BAR.md`'s Win section states the top tier must be distinguishable
  from "a louder manche," not the reverse — right now the manche cue is the louder of the two by
  measurement. Remix = trim `round_win.mp3`'s gain (or its 1.0 volume multiplier) until its
  effective loudness sits below `game_win.mp3`'s -17.8 LUFS.

No file merits a **replace** verdict — nothing measured clips at 0 dBFS, drops to silence
mid-clip, or reads as structurally broken, and the owner's #127 pass already confirmed the
originals sound right. No ElevenLabs prompts are drafted, since none apply.

**Four files were never part of #127's hardware pass**: `count_complete.mp3`, `reject.mp3`,
`room_full.mp3`, `seat_fill.mp3` were added after #127 closed (file mtimes `set 21`/`set 22`
against the verified twelve's `ago 18`). They measure cleanly — nothing here flags a defect — but
"measures cleanly" and "the owner heard it and it holds up" are different claims, and only the
second is what #127 actually certified for the other twelve.

## Music

`lib/device/music.ts` plays one CC0 composition (*Retro Lounge*, Abstraction/Tallbeard, #113) in
three loop variants (a fourth, unused in current routing — see below):

| Track | Route | Raw LUFS(I) | True peak | Duration |
|---|---|---|---|---|
| menu.m4a | every menu screen | -16.1 | -1.1 dBFS | 27.41s (loop) |
| hand.m4a | the table, live hand | -17.2 | **-0.4 dBFS** | 27.41s (loop) |
| cue.m4a | result screen | -16.2 | -0.9 dBFS | 27.41s (loop) |

All three sit inside the -16/-18 LUFS mobile mix-level band reported above — a closer match to
that guidance than any single sound effect, which makes sense: it is one continuously-playing bed
rather than a one-shot. `hand.m4a` — the track playing during actual gameplay, so the
most-heard of the three — has the tightest true-peak margin (-0.4 dBFS, 0.6 dB under the EBU
ceiling) of anything measured in this pass; same remix-not-replace flag as above, and the same
justification (ALAC is lossless per `assets/music/README.md`, so a peak trim costs nothing else).

**Verdict: keep**, with the `hand.m4a` peak flag. The pack ships a fourth track
(`assets/music/*.webm`/`.m4a` only lists three keys in `TRACKS` — `menu`, `hand`, `cue` — matching
`lib/device/musicTracks.ts`/`.ios.ts`; no fourth is routed anywhere in `app/_layout.tsx`'s
`trackForRoute()`), so "four loop variants" in the ticket body is one more than what's actually
wired — not a defect, just worth a note since the ticket's own framing overcounts by one.

No adaptive/tension-layered music exists (map #1230 already lists this under "Not yet specified,"
hanging on the audio direction) — confirmed present-tense true, not a new finding.

## Moments and events with no sound

Checked against `docs/FEEL-BAR.md`'s nine moments (Deal, Card landing, Bomb, Pass, Turn hand-off,
Win, Loss, Reconnect/recovery, Idle table) and the call sites in `components/GameTable.tsx`,
`components/useTableFeedback.ts`, `components/table/pile.tsx`, `components/table/turnChip.tsx`,
`components/RoomSeatList.tsx` and `app/_layout.tsx`.

**Covered, correctly timed.** Deal (`playDeal`, once per hand), Card landing (`playCardPlay`/
`playBomb` fire from `useTableFeedback.ts`'s `playImpact`, which — per `components/CLAUDE.md`'s
own invariant — is driven off the same landing timing as the visual impact, not the throw; a code
comment at `components/GameTable.tsx:782-783` states this directly: *"Haptic only: the throw is
acknowledged in the hand, and card_play sounds when the card actually reaches the pile"*), Bomb,
Pass, Win (two-tier: `round_win` for the manche, `game_win` for the partita) all have sound at
the right moment.

**Silent, checked directly:**

- **Manche loss has no sound of its own.** `playRoundWin` fires once per manche end, for every
  client, regardless of seat — there is no counterpart the way `game_lose.mp3` counters
  `game_win.mp3` at the partita level. `docs/FEEL-BAR.md`'s own Loss section (citing #101's
  rank-10 finding) argues against celebrating at the loser, which this arguably already satisfies
  by omission — but it means the manche's three non-winning seats hear nothing at the moment
  their hand-closing round resolves, one-sided in a way the partita tier is not.
- **Turn hand-off is one-sided.** Only the incoming seat gets `your_turn.mp3`
  (`useTableFeedback.ts:396`); the outgoing seat's own hand-off (the dimming `FEEL-BAR.md`
  describes) has no audio counterpart. May be intentional (one cue per hand-off, not two), noted
  because `FEEL-BAR.md` treats hand-off as a two-sided frame ("the outgoing seat's indicator and
  the incoming seat's indicator never both measure at full opacity").
- **No escalation on the turn clock.** `urgent_tick.mp3` (`components/table/turnChip.tsx:65`)
  plays the same flat 131ms sting on every tick regardless of how close the turn is to expiring —
  no rising pitch, no shortening interval. `docs/FEEL-BAR.md`'s own Turn hand-off references
  (Hearthstone's 75s timer with a fuse appearing at ~20s remaining and accelerating to ~7s after a
  miss; WSOP's 20s continuously-depleting shot clock) both describe an escalating signal, not a
  repeated flat one.
- **Reconnect/recovery is silent, checked at every call site.** Grepped
  `components/SessionReplacedNotice.tsx`, `OfflineBanner`, and every socket
  rejoin/resync path — none call any `play*` function or `duckMusic`. The resync is entirely
  visual (banner text), with no sound marking either the disconnect or the recovery.
- **Idle table carries no distinct sound.** Between hands the `hand`/`menu` loop simply keeps
  playing; there is no separate ambient layer or one-shot that marks an idle wait as its own
  moment, distinct from ordinary gameplay. `docs/FEEL-BAR.md`'s Idle table section is about visual
  life at rest, not audio, so this may not be a gap by that document's own scope — noted rather
  than assumed.
- **No rising pitch across a trick or combo.** Confirmed against Balatro's shipped source above:
  every effect in `lib/device/sounds.ts` that varies at all (`select`, `play`, `pass`, `deal`,
  `reject`) uses `jitter()` — ±4% pitch, ±8% gain, drawn fresh and uncorrelated with position in a
  trick, combo size, or score. Nothing currently plays higher as a trick or combo builds, which is
  the ticket's own stated premise and is accurate.

## What this file does not decide

No sound is replaced, remixed, or re-recorded here — this is measurement and a verdict table, per
#1232's own scope. The three `remix` flags and the "no sound" list are inputs to whatever the
audio-direction work under #1230 does next, not a change made by this ticket.
