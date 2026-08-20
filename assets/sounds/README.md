# Sound effects

The twelve effects `lib/sounds.ts` plays. Built, not hand-authored — run
`node scripts/build-sounds.mjs` to rebuild them from source.

## Licence

**CC0 1.0 (public domain dedication).** No attribution is required; it is given
here because the work deserves it.

| Source | Used for | Where |
|---|---|---|
| Kenney, *Casino Audio* | everything a hand of cards does — slide, place, shove, fan, shuffle, chip clatter | <https://kenney.nl/assets/casino-audio> |
| Kenney, *Interface Sounds* | the stings — turn chime, tick, confirmation, error, struck glass | <https://kenney.nl/assets/interface-sounds> |

The build downloads them from public mirrors
([iwenzhou/kenney](https://github.com/iwenzhou/kenney),
[Calinou/kenney-interface-sounds](https://github.com/Calinou/kenney-interface-sounds))
because kenney.nl refuses scripted requests. The sources are not vendored; only
the twelve rendered files are.

## What the build does

Each output is a recipe in `scripts/build-sounds.mjs`: one or more source clips,
each with a gain, a start offset and a playback rate. Mixing runs in Chromium's
`OfflineAudioContext` — there is no ffmpeg here, and it gives decoding, gain,
pitch and overlap for free.

Two outputs are not simply a clip:

- **`bomb`** layers a chip clatter, a card shove and a drop, so the biggest play
  in the game lands as an impact rather than a click.
- **`game_win`** and **`game_lose`** are arpeggios. The packs contain no jingle,
  so one struck glass note is resampled to three pitches — a rising major triad
  for the win, a falling pair for the loss.

Every output is then:

1. **Trimmed** to the last moment it is still above 55 dB below its own peak,
   with a 60 ms fade. This removes silence and never audible sound. The floor is
   absolute rather than a proportion of total energy, because a proportional
   measure is not idempotent — trimming the quiet tail shrinks the total it is a
   proportion of, so each rebuild eats further into the sound. A fixed table of
   maximum durations per effect is worse still: it cuts whatever happens to run
   long, regardless of whether anything is audible there.
2. **Normalised** to a common peak, because the two packs are mastered at
   different levels and one effect being startlingly louder than its neighbours
   is the thing people notice.
3. **Encoded to MP3** at 96 kbps mono with `lamejs` (pure JS — no native
   binary, so this needs nothing beyond `npm install`).

`tests/soundAssets.test.ts` re-derives all of this from the shipped files
(decoding each through `mpg123-decoder`): that each is real mono 44.1 kHz
audio, non-silent, levelled, and free of a trailing silent tail.

## Reproducibility

The build is deterministic in length and content with one caveat: Chromium's
resampler can differ by a single least-significant bit on `game_lose`, which
uses pitch-shifted layers. That is 0.003% of full scale on one sample out of
~20,000 — inaudible, and not worth pinning the browser version over.

## Size

~121 KB for twelve files, MP3 rather than the sources' OGG because iOS will
not play OGG — MP3 decodes natively on iOS, Android and every browser, so no
per-platform format branch is needed. Recorded audio costs more than synthesis
and it is worth it: the effects are most of the game's sense of touch.

## Music is not built here

The twelve effects are 44.1 kHz mono MP3 and stay that way. Music does not, and
cannot: **MP3 has no seamless loop.** Encoder delay plus frame padding leave a
gap at the join, and browsers do not honour LAME's gapless headers, so a looping
track clicks every time round.

Music is therefore **pre-encoded WebM Opus, 48 kHz stereo**, taken from the CC0
provider already encoded rather than produced by `scripts/build-sounds.mjs`
(#121). Safari has decoded WebM Opus since **17.0** (September 2023); Ogg Opus
only since 18.4 (March 2025), which is why the container is WebM.

Encoding it here was tried and rejected on a measurement, not a preference.
Chromium's `MediaRecorder` can emit WebM Opus inside the same Playwright page
the mixer already uses, with no new dependency — but it captures in real time
and is not sample-exact. A one-second 480 Hz tone (480 whole cycles, so seamless
by construction) came back **1,920 samples short**, with 129 samples of silence
prepended, and a loop join stepping **0.888** where the waveform's own body step
was **0.063**. Fourteen times the natural slope is an audible click at every
pass — the exact defect the format change exists to prevent.

A WASM Opus encoder would be a new dependency added to solve a problem that does
not exist once the files arrive already encoded, and `npm install` and nothing
else is what this repository's build has to stay.

**Licences for the tracks themselves are recorded here when they land (#113).**
