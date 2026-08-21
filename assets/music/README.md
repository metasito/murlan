# Music

The four loops `lib/music.ts` plays. Unlike the effects in `assets/sounds/`,
these are **not built by a script** — they arrive pre-encoded, which is the
decision #121 settled and `scripts/build-sounds.mjs`'s header records.

## Licence

**CC0 1.0 (public domain dedication).** No attribution is required; it is given
here because the work deserves it.

| | |
|---|---|
| Artist | **Abstraction** (Ben Burnes) / Tallbeard Studios |
| Pack | [Music Loop Bundle](https://tallbeard.itch.io/music-loop-bundle), `music-loop-bundle-2026-q1.zip` |
| Verified | The pack's own `_LICENSE.txt`: *"has waived all copyright and related or neighboring rights"* |

Commercial use and modification are permitted. The creator asks that these are
not used in NFT, AI/ML, or resale-of-unmodified-assets projects — none of which
applies here.

## What they are

All four are **one composition**, *Week 1 — Retro Lounge*. That is the point
rather than a coincidence: `docs/research/what-makes-a-game-memorable.md` §2.2
finds that four variations of one idea are more memorable than four unrelated
pieces, so a change of screen is a change of arrangement, not a change of music.

| File | Source | Plays on |
|---|---|---|
| `menu.webm` | `Week 1 - Retro Lounge BASE.ogg` | every menu screen |
| `hand.webm` | `Week 1 - Retro Lounge MELODY.ogg` | the table, while a hand is live |
| `cue.webm` | `Week 1 - Retro Lounge UNUSED ALT.ogg` | the result screen |
| `final.webm` | `Week 1.1 - Super Retro Lounge.ogg` | the table, at three cards or fewer |

Chosen by the owner on #113 from the twelve candidates auditioned in #163.

## How they were made

Each source was decoded at 48 kHz through Chromium's `OfflineAudioContext`, had
its loop closed with a **20 ms equal-power crossfade**, and was encoded to
**WebM Opus, 96 kbps stereo, 48 kHz** with ffmpeg.

The crossfade is not cosmetic. `Retro Lounge BASE` — the loop the game plays
most — stepped **14.2×** the waveform's own 95th-percentile sample-to-sample
step at the wrap, which is an audible click once per pass. Folding the tail back
over the head makes the join continuous by construction. After encoding, no
track steps more than **0.5×**, and `tests/musicLoops.test.ts` fails if one does
— verified against the un-crossfaded file, which it rejects at 11.6×.

**WebM, not Ogg**: Safari decodes WebM Opus from 17.0 and Ogg Opus only from
18.4. The container also declares Opus's encoder delay as pre-skip, so the
decoded buffer carries no leading silence — the other way a loop fails.

ffmpeg is not a repo dependency and is not needed to build the app; it was used
once, to author these four files. Re-encoding is a manual step, which is why the
test guards the result rather than the process.

## Native iOS has no music

AVFoundation cannot demux WebM — Opus reaches `AVPlayer` only in an MP4
container, and only from iOS 17. Android has decoded Opus in WebM since 5.0, and
web is unaffected. `lib/music.ts` therefore refuses on iOS deliberately rather
than failing inside the player, and `tests/native/musicPlatform.test.tsx` pins
both sides of that branch. The fix is a second encode, not a different format:
changing the format costs web Safari, which is the platform this game actually
ships on.
