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

## The iOS encode

AVFoundation cannot demux WebM at all — Opus reaches `AVPlayer` only inside an
MP4 container, and only from iOS 17. Android has decoded Opus in WebM since
5.0, and Safari is unaffected either way, which is why the format itself never
changed (#121): switching container for everyone would cost web Safari to fix
one platform.

Each `*.m4a` alongside the matching `*.webm` is the same audio, **losslessly
re-encoded to ALAC**: `ffmpeg -i menu.webm -c:a alac -sample_fmt s16p -f mp4
menu.m4a`. `lib/music.ts` picks the container by platform — WebM for web and
Android, M4A for iOS — and `tests/musicAssets.test.ts` pins that every track
exists in both.

**Why ALAC and not the two candidates that looked cheaper first**, in the
order #178 laid out — both were tried and measured, not assumed:

- **Opus, remuxed into the same MP4 with `-c:a copy`.** The audio bitstream is
  untouched, but ffmpeg's `mov` muxer does not carry the WebM stream's
  `discard_padding` side data across the remux, and separately recomputes the
  pre-skip value (312 samples in the source, 336 after the remux). A decoder
  reading the MP4 metadata alone — which is what a device does, not what the
  Opus bitstream secretly still contains — is missing the trim it needs. A
  fresh `libopus` encode straight into MP4 (the exact command #178 suggested
  first) does not fix it either: Chromium's ISOBMFF-Opus decode path measured
  a different sample count than its own WebM-Opus decode of the identical
  audio, and the seam ratio (see `tests/e2e/musicLoops.spec.ts`) came out
  above the 1× threshold on two of the four tracks.
- **AAC in M4A.** Chromium decodes it gapless — sample count matched the WebM
  decode exactly, unlike Opus-in-MP4 above — but the *lossy quantization
  noise itself* landed large enough at the loop boundary to fail the seam
  measurement on `menu` and `hand` at 160 kbps. Raising the bitrate fixed
  `menu` and made `hand` measurably worse, which is the "at risk" warning
  #178 raised about AAC borne out: the failure mode isn't a fixed encoder
  delay you can compensate for, it moves with the encode.
- **ALAC** sidesteps both failure modes by construction: it is lossless, so
  there is no quantization noise to land near the seam, and it carries no
  encoder delay or pre-skip to declare or lose in a remux — a decoder trims
  nothing, so nothing about the container's trim metadata can go missing or
  be recomputed wrong. Verified against the WebM source with `ffmpeg`
  (decode both to raw PCM, diff): every sample count matches exactly, and the
  largest per-sample difference is one 16-bit ALAC quantization step
  (roughly -96 dBFS) — inaudible, and nowhere near the loop join specifically
  since it is spread evenly across the whole file rather than concentrated
  at the seam.

**Cost.** Lossless does not compress like Opus does — the four ALAC files run
roughly 5× the WebM set's size (about 7.5 MB against 1.5 MB). Paid once in the
iOS bundle, not over the wire to web players.

**What "verified" means here, and what it does not.** Chromium cannot decode
ALAC at all (`decodeAudioData` and `<audio>` both refuse it), so
`tests/e2e/musicLoops.spec.ts` cannot run the same waveform-seam arithmetic
against the `.m4a` files that it runs against the `.webm` files. What it does
instead is parse the MP4 container's own boxes (`mdhd`, `stsd` — no decoder,
just the header) and assert the sample count, sample rate and channel count
match the WebM file exactly; the losslessness argument above is what carries
the seam guarantee across, verified once by hand with `ffmpeg`, not re-derived
by CI on every run. **Genuine on-device confirmation is still outstanding** —
AVFoundation decoding ALAC is long-documented Apple behaviour on every iOS
version, which is why it was picked over the other two, but nothing here has
run on a physical device or simulator. See #178.

## The audio session category

Music shares one `AVAudioSession` with the sound effects — `expo-audio` has no
per-player session, so whichever plays first decides it for both.
`lib/sounds.ts`'s `ensureAudioMode()` sets `playsInSilentMode: true`, and
`lib/music.ts` calls that same function (rather than setting its own mode)
before starting a native player, so the two cannot settle on different
answers. The deliberate call: music does **not** respect the hardware mute
switch, matching the effects — a bomb going silent under the ringer switch
while the music kept playing would read as broken, and giving the two
different answers is a worse trade than a card game's music failing to be
politely muteable.
