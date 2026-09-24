# Sound effects

The nineteen effects `lib/device/sounds.ts` plays. Fourteen are the table's sound set, picked by ear
on #1237 and vendored as they were picked. Five are built by `node scripts/build-sounds.mjs`.

## The table's picks

Copied from `origin/research/lantern-assets:mockups/the-lantern-table/audio/`. They were
loudness-matched per action before the listening: BS.1770 integrated loudness, a sample-peak cap of
0.89, high-passed at 80 Hz (60 Hz for the boom). They carry their level in the file, so `sounds.ts`
plays them at unity. `manche_lost`, `partita_lost`, `reconnected` and `select` are cut at an MP3
frame boundary (`ffmpeg -c:a copy -t`, no re-encode) where their tail falls 55 dB under their own
peak.

| File | Moment | Picked take | Source | Prompt | Licence |
|---|---|---|---|---|---|
| `select.mp3` | Select a card (a deselect is the same file, lower and quieter) | `select-2` | ElevenLabs | "One playing card lifted and slid slightly across a card table, short crisp paper sound, close up, no background noise" | free-tier prototype |
| `play.mp3` | One card lands | `play-kenney1` | Kenney *Casino Audio* `card-place-1.ogg` | — | CC0 |
| `combo.mp3` | Several cards land | `combo-2` | ElevenLabs | "A small fan of playing cards laid down on a felt table, realistic paper sound, clean, no background" | free-tier prototype |
| `pass.mp3` | Pass | `pass-2` | ElevenLabs | "One firm knuckle knock on a wooden card table, clean realistic foley" | free-tier prototype |
| `bomb.mp3` | Bomb | `bomb-final` | Kenney `card-place-1` four times, 70 ms apart, at −6/−4/−2/0 dB; an ElevenLabs boom 250 ms after the slam starts | Boom: "Deep warm boom, like a muffled explosion in the distance, short, powerful low end, clean, no debris" | CC0 slam; the boom is a free-tier prototype |
| `deal.mp3` | Shuffle and deal | `deal-now` | The previous `deal.mp3` (Kenney *Casino Audio* `cardShuffle.ogg`), re-levelled | — | CC0 |
| `exchange.mp3` | Card exchange | `exchange-1` | ElevenLabs | "Two playing cards slid across a felt table to another player, smooth realistic sliding sound, clean" | free-tier prototype |
| `turn.mp3` | Your turn | `turn-2` | ElevenLabs | "Gentle two-note marimba notification, warm and clean, short, casual card game" | free-tier prototype |
| `clock_running_out.mp3` | Turn clock running out | `clock-2` | ElevenLabs | "Countdown timer ticking getting faster, clean realistic clock ticks" | free-tier prototype |
| `manche_won.mp3` | Manche won | `mwin-6` | ElevenLabs | "Short happy piano arpeggio going up with a soft bell at the end, clean, card game win" | free-tier prototype |
| `manche_lost.mp3` | Manche lost | `mlose-1` | ElevenLabs | "Short soft losing sound for a card game, gentle descending piano notes, not sad, clean" | free-tier prototype |
| `partita_won.mp3` | Partita won | `pwin-3` | ElevenLabs | "Triumphant short orchestral win music with bells, mobile game victory, polished" | free-tier prototype |
| `partita_lost.mp3` | Partita lost | `plose-1` | ElevenLabs | "Short game over sound for a card game, calm descending piano phrase, gentle, clean" | free-tier prototype |
| `reconnected.mp3` | Reconnected | `reconnect-1` | ElevenLabs | "Soft clean confirmation chime, connected, short, modern app sound" | free-tier prototype |

**The twelve ElevenLabs files are free-tier prototypes.** Free-tier output is non-commercial: they
are regenerated from these prompts on a paid plan and re-listened before the game ships (#1269).

## The built effects

`round_start`, `round_win`, `reject`, `seat_fill` and `room_full`, each a recipe in
`scripts/build-sounds.mjs`: one or more source clips, each with a gain, a start offset and a playback
rate. All are CC0 1.0; no attribution is required, and it is given here because the work deserves it.

| Source | Used for | Where |
|---|---|---|
| Kenney, *Casino Audio* | the card fan and the chip laid down | <https://kenney.nl/assets/casino-audio> |
| Kenney, *Interface Sounds* | the confirmation, the error and the struck glass | <https://kenney.nl/assets/interface-sounds> |

The build downloads them from public mirrors
([iwenzhou/kenney](https://github.com/iwenzhou/kenney),
[Calinou/kenney-interface-sounds](https://github.com/Calinou/kenney-interface-sounds))
because kenney.nl refuses scripted requests. Mixing runs in Chromium's `OfflineAudioContext`, which
gives decoding, gain, pitch and overlap with no native binary.

**`room_full`** is one struck glass note at a third and a fifth, two quick notes for the last seat of
the lobby filling; each seat before it is `seat_fill`, a single *Casino Audio* chip laid down.
**`reject`**, a refused GIOCA, is *Interface Sounds* `error_004.wav`.

Every built output is then:

1. **Trimmed** to the last moment it is still above 55 dB below its own peak, with a 60 ms fade. The
   floor is absolute rather than a proportion of total energy, because a proportional measure is not
   idempotent — trimming the quiet tail shrinks the total it is a proportion of, so each rebuild eats
   further into the sound.
2. **Normalised** to a sample peak of 0.89, except `round_start` (0.79, which keeps its true peak
   under −1 dBTP once encoded) and `round_win` (0.3, which puts a trick won under the manche won).
3. **Encoded to MP3** at 96 kbps mono with `lamejs`.

## What the test holds

`tests/tooling/soundAssets.test.ts` decodes every file `sounds.ts` requires through
`mpg123-decoder`: that each is real mono 44.1 kHz audio of its pinned length and pinned integrated
loudness, free of a trailing silent tail, never above −1 dBFS, and that `round_win` sits under
`manche_won`.

`sounds.ts` varies the pitch and gain of the effects that repeat through a hand — select, play,
combo, pass, deal and reject — so a hand of them is not one clip repeated; the stings always sound
the same, which is what keeps each recognisable.
