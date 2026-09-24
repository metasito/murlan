# Lantern table: the mockups and sounds the spec is built against

The source of every artifact that the spec [#1252](https://github.com/metasito/murlan/issues/1252) names as authoritative, copied on 2026-09-24. The spec comes from the map [#1230](https://github.com/metasito/murlan/issues/1230). This branch holds evidence, not app code, and it is never merged. A ticket copies what it needs into the repo; a fixture goes under `tests/e2e/fixtures/` with the header below.

Read a file without checking the branch out:

```sh
git fetch origin research/lantern-assets
git show origin/research/lantern-assets:mockups/the-lantern-table/index.html > /path/to/copy.html
```

## The mockups

| Path | Artifact | Version | Authority for |
|---|---|---|---|
| `mockups/the-lantern-table/` | [The Lantern Table](https://claude.ai/artifact/PDpVkLXU4g8XUkCCBbQn2X) | `1790260978-d58e` | Everything combined. It wins wherever it disagrees with another page |
| `mockups/lantern-particle-moments/` | [Lantern Particle Moments](https://claude.ai/artifact/WasP5smQn9omjKdT5YCHex) | `1790245964-9a0d` | Each moment's particle, lamp and timing parameters (#1242) |
| `mockups/felt-and-card-materials/` | [Felt and Card Materials](https://claude.ai/artifact/5haRaZDpALhaSz5WmP5juM) | `1790246374-73f5` | The twill, rail and card-reflection close-up at 2.5× (#1245) |
| `mockups/lantern-table-playthrough/` | [Lantern Table Playthrough](https://claude.ai/artifact/UUrXK6bovRZWqdbVx5ssPS) | `1790171727-f089` | The bomb as first decided, and seat details (#1236) |

**Driving The Lantern Table deterministically.** The page exposes `window.T.go(key, ms)`. It pauses the page's own loop, restarts the chapter, steps the scene at 1/60 s until `ms`, draws once, and mutes the sounds while doing it.
- The chapter keys are `deal`, `trick`, `bomb`, `clock`, `mwin`, `mlose`, `reconnect`, `pwin`, `plose` and `rest`.
- The page's random numbers come from `Math.random` (`R(a, b)`), so seeding `Math.random` before the page loads makes two runs identical.
- `Lantern Particle Moments` has `start(momentIndex, optionIndex)` and the same scene clock, but no `window` handle. A fixture driver has to add one.

**Header for a fixture copied from here:**

```html
<!-- Fixture: <artifact title>, <artifact URL>, version <version>, from origin/research/lantern-assets:<path>.
     The numbers in this file are the specification (#1252). Do not edit it; drive it from the spec. -->
```

## The sounds

`mockups/the-lantern-table/audio/` holds the 14 picks from [Murlan by Ear](https://claude.ai/artifact/EhuxTtGVmuRPHubeGmej6g) v7 (#1237). They are already loudness-matched per action: BS.1770 integrated, peak cap 0.89, high-passed at 80 Hz (60 Hz for the boom).

| File | Action | Target LUFS | Source | Licence |
|---|---|---|---|---|
| `select-2.mp3` | Select a card | −32 | ElevenLabs | free-tier prototype |
| `play-kenney1.mp3` | Play one card | −26 | Kenney *Casino Audio* `card-place-1.ogg` | CC0 |
| `combo-2.mp3` | Play several cards | −25 | ElevenLabs | free-tier prototype |
| `pass-2.mp3` | Pass | −27 | ElevenLabs | free-tier prototype |
| `bomb-final.mp3` | Bomb: Kenney `card-place-1` ×4 at 70 ms (−6/−4/−2/0 dB), then an ElevenLabs boom at 250 ms | −19 | mixed | the boom is a free-tier prototype |
| `deal-now.mp3` | Shuffle and deal | −28 | today's `assets/sounds/deal.mp3`, re-levelled | as today |
| `exchange-1.mp3` | Card exchange | −27 | ElevenLabs | free-tier prototype |
| `turn-2.mp3` | Your turn | −22 | ElevenLabs | free-tier prototype |
| `clock-2.mp3` | Turn clock running out | −25 | ElevenLabs | free-tier prototype |
| `mwin-6.mp3` | Manche won | −21 | ElevenLabs | free-tier prototype |
| `mlose-1.mp3` | Manche lost | −23 | ElevenLabs | free-tier prototype |
| `pwin-3.mp3` | Partita won | −18 | ElevenLabs | free-tier prototype |
| `plose-1.mp3` | Partita lost | −21 | ElevenLabs | free-tier prototype |
| `reconnect-1.mp3` | Reconnected | −23 | ElevenLabs | free-tier prototype |

ElevenLabs free-tier output is non-commercial. The 12 generated sounds ship in development builds only until they are regenerated from their prompts (listed on #1237) in one paid month and re-listened. The Kenney sound and today's deal sound ship as they are.

`mockups/the-lantern-table/img/` holds the court art the page draws. It is today's art, included so that the page renders offline.
