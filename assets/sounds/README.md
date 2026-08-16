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
   absolute rather than "keep 99.9% of the energy", because a proportional
   measure moves every time it is applied — trimming the quiet tail shrinks the
   total it is a proportion of, so re-running the build would keep eating into
   the sound. An earlier hand-written table of maximum durations was worse
   still: it cut 0.4 s of audible card slide off `card_select`.
2. **Normalised** to a common peak, because the two packs are mastered at
   different levels and one effect being startlingly louder than its neighbours
   is the thing people notice.

`tests/soundAssets.test.ts` re-derives all of this from the shipped files: that
each is real mono 16-bit 44.1 kHz PCM, non-silent, levelled, and free of a
trailing silent tail.

## Reproducibility

The build is deterministic in length and content with one caveat: Chromium's
resampler can differ by a single least-significant bit on `game_lose`, which
uses pitch-shifted layers. That is 0.003% of full scale on one sample out of
~20,000 — inaudible, and not worth pinning the browser version over.

## Size

844 KB for twelve files, up from 257 KB of synthesized audio. That is a
deliberate trade: the effects are the game's whole sense of touch, and the
previous set sounded synthetic because it was. Uncompressed WAV is kept because
iOS will not play the sources' OGG and because decoding twelve short PCM files
costs nothing at load.
