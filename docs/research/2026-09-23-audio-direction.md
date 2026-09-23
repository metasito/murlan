# Murlan audio direction: research

Researched 2026-09-23. Sources are linked inline. Most material is **paraphrased** with its source named;
direct quotation is kept to one load-bearing licence clause. Every claim is tagged:

- **[P]** primary: official docs or terms, the designer's own words, peer-reviewed paper, the game's code
- **[S]** secondary: journalism, wiki, a third-party analysis
- **[U]** unverified: my inference, or something I could not confirm at a primary source

Scope note from the owner, applied throughout: classic and mass-market card games (poker, solitaire,
UNO, casino, Big Two apps) are surveyed to show **what players expect a card table to sound like**. The
**quality bar** and the recommendations are set by whichever work is actually best-in-class.

---

## 1. Lessons from game-audio practitioners for a mobile card game

### 1.1 Phone speakers: what survives

- **Phone speakers carry almost no bass.** One iPhone 7 Plus measurement puts the usable range at
  roughly 500 Hz to 10 kHz, with a steep fall below about 600 Hz. The same article suggests checking
  mixes through a 400 Hz to 6 kHz band-pass as a stand-in for a small speaker
  ([Sonarworks](https://www.sonarworks.com/blog/learn/make-your-mix-sound-great-on-small-speakers)) [S].
  Mixing guides agree that most phones struggle below about 200 Hz and are silent by about 100 Hz
  ([LANDR](https://blog.landr.com/make-bass-audible-phone-speakers/)) [S]. Audiokinetic published
  measured responses for popular phones
  ([Audiokinetic blog](https://www.audiokinetic.com/en/community/blog/loudness-and-frequency-response-on-popular-smart-phones/)),
  but the page returned 403, so I could not read the numbers [U].
- **Weight comes from harmonics, not sub-bass.** Because of the missing-fundamental effect, the ear
  infers a low note from its upper harmonics. The practical move is saturation or distortion on the low
  layer, which creates partials around 150 to 500 Hz, and EQ above 80 Hz rather than below it
  (Sonarworks and LANDR, above) [S]. For Murlan, this means the "big" moments (bomb, partita won) need a
  **low-mid body with harmonics (roughly 150 to 400 Hz)**, a sharp transient, and bright content from 2
  to 5 kHz. A 50 Hz boom will simply not be heard.
- **Target loudness.** Sony's ASWG-R001 standard sets portable titles at about −18 LKFS integrated with
  a −1 dBTP true-peak ceiling, against −24 for consoles
  ([ASWG-R001 PDF](http://gameaudiopodcast.com/ASWG-R001.pdf)) [P]. This is the one published game
  loudness target for handheld devices.
- **Respect the mute switch and the player's own audio.** Apple's HIG says people silence a device to
  suppress sound effects and game soundtracks, and it steers games toward the *Ambient* audio session
  categories. SFX may mix with another app's audio, while the soundtrack should play only when nothing
  else is playing ([Apple HIG, Playing audio](https://developer.apple.com/design/human-interface-guidelines/playing-audio);
  [Audio guidelines by app type](https://developer.apple.com/library/archive/documentation/Audio/Conceptual/AudioSessionProgrammingGuide/AudioGuidelinesByAppType/AudioGuidelinesByAppType.html))
  [P]. Card-game players often run a podcast underneath, so this is a real requirement for Murlan.

### 1.2 Design the emotion before the physics

- **Hearthstone (Blizzard).** Principal sound designer Andy Brock calls their method "subjective sound
  design": they design for the emotional impact of a card, not its animation states. Spells are built
  on key beats (the cast, the hit), and turn-based pacing lets them take a more rhythmic, musical
  approach. Brock also warns that a game can carry too much sound, so the real work is deciding what
  is heard when, or not at all. Olivia Lauletta names intelligibility at speed as the constraint.
  Brian Farr credits Warcraft's spell sounds with an atonal musical element that made them instantly
  recognisable ([Blizzard, "Meet the sound team behind Hearthstone's harmonic design"](https://news.blizzard.com/en-us/article/23964694/inside-battle-net-meet-the-sound-team-behind-hearthstones-harmonic-design))
  [P].
- **Hearthstone treats the board as a physical toy box.** UI lead Derek Sakamoto's GDC 2015 talk
  presents physicality as the core of the game, delivered through art, animation and sound
  ([GDC Vault](https://gdcvault.com/play/1022036/Hearthstone-How-to-Create-an) [P];
  [Blizzard Watch recap](https://blizzardwatch.com/2015/03/07/gdc-takes-a-look-behind-the-scenes-of-hearthstone-development/) [S]).
  The music is written as if a small band were playing inside the tavern: accordion, penny whistle, and
  folk-blues ensemble writing (Jason Hayes, Peter McConnell). The legendary stingers reuse Warcraft
  themes ([Hearthstone wiki, design and development](https://hearthstone.wiki.gg/wiki/Design_and_development_of_Hearthstone))
  [S]. **This is the closest precedent for a kafene table**: a diegetic small ensemble, tactile card
  foley, and short musical punctuation.
- **Monument Valley (Stafford Bawler, Develop award 2014).** Bawler began with realistic ambiences, then
  found the game needed something more abstract. He gave object sounds musical tonality until the
  interactions and the backdrop became harmonious, with a brief of light, positive and uplifting
  ([MCV/Develop](https://www.mcvuk.com/heard-about-the-sounds-of-monument-valley/)) [P, interview].

### 1.3 Tonal coherence: every tonal sound in one key, and pitch that escalates

- **Peggle 2 and Peggle Blast (PopCap; Guy Whitmore, RJ Mattingly).** Peg hits play *ascending diatonic
  scales* that fit the harmony of the current music phrase, and the scales change with the phrase even
  mid-shot. The hits were individual string pizzicato samples, so the feedback itself became the
  melody. The Free Ball choir chord always sits in harmony with the music. Seven music sections
  progress through play, and an ambient mode takes over when the player pauses
  ([G.A.N.G., "Peggle2: Sonic Joy!"](https://www.audiogang.org/peggle2-sonic-joy/)) [P, by the audio
  director]. The Wwise write-up of the peg-hit system
  ([Audiokinetic](https://www.audiokinetic.com/en/blog/peggle-blast-peg-hits-and-the-music-system/))
  returned 403 [U]. **This is the best-documented model for Murlan's card plays**: escalating,
  in-key tonal feedback.
- **Balatro (LocalThunk; music by LouisF).** Many players and analyses describe each scoring card
  playing a rising note ([Blake Crosley analysis](https://blakecrosley.com/guides/design/balatro)) [S],
  but I found **no primary confirmation of the per-card pitch rise** [U]. What *is* confirmed in the
  game's Lua (reproduced by a sound mod): a global pitch modifier that slides the music toward 0.5 on
  game over ([sound.lua](https://github.com/Infarctus/Balatro-Custom-Sound-Player/blob/main/sound.lua))
  [P, code], and SFX pools picked at random from numbered variants such as `coin1` to `coin7`
  ([DeepWiki reverse-engineering notes](https://deepwiki.com/balatro-src/balatro-src-reverse-engineering/5.3-sound-effects-and-music))
  [S].
- **Koji Kondo (GDC 2007).** Music that does not follow the game's rhythm turns into background music
  from another room. Important SFX must be the clearest, and the others blend in. Arrangements of *one*
  theme signal a state change. Ocarina of Time's field music avoids fatigue by stitching randomly
  ordered phrases (12 phrases into varied 8-phrase runs)
  ([Game Developer recap](https://www.gamedeveloper.com/game-platforms/gdc-koji-kondo-s-interactive-musical-landscapes))
  [S, recap of the keynote; [archive.org recording](https://archive.org/details/GDC2007Kondo) is the primary].
- **Keeping sounds in key cuts fatigue.** Bjørn Jacobsen: a sound that does not fit the music's harmony
  creates dissonance, so pitch or notch-filter it into place. Remove any variation that stands out,
  because players notice the pattern. Keep all variants recorded with the same mic and in the same
  space ([A Sound Effect](https://www.asoundeffect.com/game-audio-immersion/)) [P, practitioner].

### 1.4 Variation: surviving hundreds of repetitions

- **Split sounds into layers and randomise each layer.** Jacobsen's example has three layers with five
  variants each, over 125 combinations, which stops players spotting the repeat. He also kept a
  "nuisance score" during playtests (A Sound Effect, above) [P].
- **Round-robin pools.** Balatro picks at random from numbered variants (above) [S].
- **Slight changes in pitch, timbre or level** are standard advice for UI sounds that repeat all
  session ([Audiokinetic, "Approaching UI audio from a UI design perspective"](https://www.audiokinetic.com/en/blog/approaching-ui-audio-ui-design-perspective-1/)
  (403, known only from its search snippet) [U];
  [SFX Engine guide](https://sfxengine.com/blog/best-practices-for-game-ui-sounds) [S]).
  I found no sourced numbers. Common practice is ±3 to 5 % pitch and ±1.5 dB level on foley, and **no
  pitch jitter on tonal layers**: vary them by choosing another scale degree instead [U].
- **Laura Taylor, slot-machine composer.** Her first rule for a game played for hours is not to
  annoy the player ([Twenty Thousand Hertz, "Slot Machines"](https://www.20k.org/episodes/slotmachines))
  [P, interview].

### 1.5 Loudness and importance hierarchy

- Kondo: the most important sound is the clearest, and the rest blend (above) [S].
- Brock: choose what is heard when, or not at all (above) [P].
- **Casino practice scales the celebration with the event.** Karen Collins (University of Waterloo)
  describes bright, sparkly "audio bling" for wins, unresolved progressions after a loss, and a
  resolving chord on a win. Machines play win sounds even when the payout is below the stake (20k,
  above) [P, researcher]. Murlan should borrow the *resolution* idea (a win resolves the motif) and
  **not** the manipulation (celebrating losses dressed up as wins).
- **Ducking.** Zachary Quarles (Day 1 Studios) documents a ducker taking non-dialogue audio down to
  −9 dB over 500 ms and recovering over 1 s. He warns that ducking used too often or too hard becomes
  distracting in itself
  ([Game Developer, "Game Audio Theory: Ducking"](https://www.gamedeveloper.com/audio/game-audio-theory-ducking))
  [P]. PopCap's GDC 2017 talk covers additive, state-based mixing for 2D menus in Bejeweled Stars and
  PvZ Heroes ([GDC Vault](https://gdcvault.com/play/1024049/I-Will-Now-Talk-About)) [P, abstract only].

### 1.6 A sonic identity: one motif everywhere

- Hearthstone's legendary stingers reuse Warcraft themes to tie the games together (Brock, above) [P].
- Balatro builds its five themes from **one composition**, varied in soundfont and melody and switched
  by game state ([Balatro Wiki, Music](https://balatrowiki.org/w/Music)) [S].
- Kondo: arrangements of one theme mark state changes (above) [S].
- In branding generally, a sonic logo is often cut from a longer anthem, as McDonald's jingle was
  ([Epidemic Sound](https://www.epidemicsound.com/blog/what-is-sonic-branding/)) [S].

### 1.7 Named teams where I found no primary audio source

- **Marvel Snap:** only trailer sound-design write-ups (Box of Toys, Bigmouth Audio); no in-game audio
  interview [U].
- **Clash Royale / Supercell:** fan analyses only. Supercell publishes a Brawl Stars audio fan kit
  ([fankit](https://fankit.supercell.com/d/YvtsWV4pUQVm/audio)) but no design talk that I could find [U].
- **Legends of Runeterra:** Riot's "Making music with sound design" piece turned out to cover League of
  Legends skins, not LoR ([Surrender at 20](https://www.surrenderat20.net/2019/11/red-post-collection-qgt-november-15.html))
  [S]. One principle carries over from it (Riot Zimberfly): sound cannot be designed in a vacuum;
  context decides everything.
- **Slay the Spire:** Clark Aboud describes a melody-first process, sketching at the piano, with
  orchestral libraries ([VGM Wax](https://www.vgmwax.com/reviews/2020/3/4/slay-the-spire)) [P], but says
  nothing about loops or SFX room.
- **Inscryption:** Jonah Senzel aimed the cabin score at guitars, folk music and traditional tunings,
  plus the eerie sense of something outside while you are inside
  ([Design Room interview](https://www.designroom.site/inscryption-audio-interview/)) [P]. The rest
  of the interview is paywalled.

### 1.8 Classic and mass-market card games: what players expect (breadth, not the quality bar)

I found **no published audio-team interview** for Zynga Poker, WSOP, PokerStars, GGPoker, Microsoft
Solitaire Collection, UNO! mobile, Pokémon TCG Live, ZingPlay/Tiến Lên or Pusoy Dos apps, or the
Mahjong apps. The shared palette below comes from store listings, forum threads and archived sound
sets. Treat it as the genre's **conventions**, not as proven design [S/U]:

- **Real foley** carries the table: card snap and slide, the riffle shuffle and bridge, a flick per
  dealt card, and chip clatter and stacking in poker. Store listings for solitaire apps advertise
  "realistic shuffling" and "satisfying" moves
  ([Solitaire #1 listing](https://apps.apple.com/us/app/-/id1345075012)) [S]. Archived UNO mobile sets
  show the same split between a gameplay set and a menu/interface set
  ([The Sounds Resource, UNO mobile](https://sounds.spriters-resource.com/mobile/uno/)) [S].
- **Turn timers tick**, speeding up near the end, often paired with vibration (poker apps) [U, from
  observation].
- **Win stingers are bright and short**, with coins or chips cascading. Casino design explains the
  pattern: bright, "tinkly" win sounds and a resolving chord (Collins, 20k) [P].
- **Menu music is lounge or light jazz** (poker, social casino) **or soft piano and acoustic**
  (solitaire). Solitaire listings sell "subtle and relaxing" music for long sessions, plus toggles
  ([Solitaire: Classic Card Games](https://apps.apple.com/us/app/solitaire-classic-card-games/id479280326))
  [S].
- **Recurring complaints:** the sounds are "annoying", there are no separate music and SFX toggles,
  and the game cuts off the player's own audio
  ([UNO Steam discussion](https://steamcommunity.com/app/470220/discussions/1/3192494154703474483);
  [Board Game Arena forum](https://forum.boardgamearena.com/viewtopic.php?t=24473)) [S]. On Pokémon TCG
  Live, players asked for *more* impact on attacks
  ([Pokémon forums](https://community.pokemon.com/en-us/discussion/107/general-impressions-pokemon-tcg-live))
  [S].
- **What this means for Murlan.** Players expect recorded, physical card sounds, a readable "your
  turn" and timer, a short bright win, and separate music and SFX controls that respect their own
  audio. Casual card apps rarely have a *recognisable identity* (a motif, a place). That is the gap
  where Murlan can beat them.

---

## 2. What makes a menu or table theme catchy and loop-friendly

- **Catchiness.** A study of 3,000 people's earworms found the stickiest tunes tend to have a fairly
  fast tempo, a *common* melodic contour (rise, fall, rise again), and some unusual interval or
  repetition as a hook (Jakubowski, Finkel, Stewart & Müllensiefen 2016, *Psychology of Aesthetics,
  Creativity, and the Arts*; [APA release](https://www.apa.org/news/press/releases/2016/11/earworms),
  [paper PDF](https://www.apa.org/pubs/journals/releases/aca-aca0000090.pdf)) [P]. Short menu music with
  a good loop is Kondo's rule for select screens (GDC 2007, above) [S].
- **Loop without fatigue:**
  - **One theme in several arrangements, switched by state.** Balatro runs one composition as five
    variants, plays it slowed to 70 % in game (about 4 min per loop), and slides it down to 50 % on
    game over (Balatro Wiki, sound.lua) [P/S]. Peggle 2 has seven progressive sections plus an idle
    ambient mode (Whitmore) [P]. Ocarina of Time randomises its phrase order (Kondo) [S].
  - **Keep the loop long, or build it from shuffled phrases.** A 20 to 30 s loop heard for an hour is
    what wears people out. At four minutes, Balatro's loop is the other extreme [P].
  - **Keep it sparse and leave the mid-range to SFX.** Laura Taylor's line is music that keeps the
    player engaged without distracting from what they are doing (Wilcox, 20k) [P]. For a phone,
    "sparse" means the melody and pads step back whenever card foley (1 to 5 kHz) and stingers
    speak, via ducking or a band carved out of the bed [U].
  - **Tempo.** Slot composers use 130 to 140 BPM to drive continuous play (Taylor, 20k) [P]. That
    is too pushy for a thinking game. Balatro's in-game tempo is the original slowed to 70 % [P].
    For a table bed, 70 to 95 BPM, or no audible pulse at all, keeps the table calm [U].
  - **The idle state.** Peggle's ambient mode when the player pauses [P], and Stardew's deliberate
    silences between tracks
    ([Stardew wiki](https://stardewvalleywiki.com/Soundtrack)) [S].
- **Instrumentation that reads as a place.** Hearthstone's tavern band [S]; Inscryption's folk guitar
  and traditional tunings [P]; Monument Valley's tonal ambience [P].
- **Stems.** Ship the table bed as 2 to 4 stems (drone or pad, pulse, melody, colour) so the game
  can drop the melody while a player thinks and add the pulse when the clock is short [U, standard
  adaptive-music practice; Kondo's Yoshi percussion toggle is the classic example [S]].

---

## 3. Albanian and Balkan material for Murlan's identity

### 3.1 Instruments

| Instrument | What it is | Use for Murlan |
|---|---|---|
| **Çifteli** | Two-string long-necked lute, Gheg north and Kosovo; commonly tuned **B3 and E4**, with a drone on the lower string and melody on the upper; a diatonic, partly microtonal fret layout ([Wikipedia](https://en.wikipedia.org/wiki/%C3%87ifteli)) [S] | Signature plucked timbre. Its fundamentals sit **in the phone's range** (E4 ≈ 330 Hz) and its attack is bright. Ideal tonal layer. |
| **Sharki** | Larger fretted lute, 4 to 6 strings in courses; louder, more melodic ([BlueTreeAudio](https://music.bluetreeaudio.com/countries/albania/instruments)) [S] | Melody for the menu theme |
| **Lahuta** | One-string bowed fiddle that accompanies northern epic song (same source; [Music of Albania](https://en.wikipedia.org/wiki/Music_of_Albania)) [S] | A rasping bowed drone for tension (turn clock, bomb build-up). Use sparingly; it is austere. |
| **Def / dajre** | Frame drum with jingles, the rhythm engine of southern *saze* ensembles [S] | Card-play accents and bomb hits. The jingles cut through on phones. |
| **Clarinet** | Leads the southern *kaba*: improvised, melancholic, with violin, accordion and llautë (Music of Albania) [S] | Win and loss stingers; the "voice" of the kafene at night |
| **Fyell / zumare** | Shepherd's flute and double clarinet (same) [S] | Colour for idle and ambient moments |
| **Iso-polyphony** | Southern Tosk and Lab song: soloists over a sung drone (*iso*); UNESCO Masterpiece 2005, Representative List 2008 ([UNESCO encyclopaedia](https://unesdoc.unesco.org/ark:/48223/pf0000230477); [Wikipedia](https://en.wikipedia.org/wiki/Albanian_iso-polyphony)) [P/S] | Soft vocal-drone pad under the menu theme; a brief choral "iso" swell on partita won |

### 3.2 Modes and scales

- Iso-polyphony is built mostly on **anhemitonic pentatonic** modes (no semitones), varying by region
  ([Albanian iso-polyphony](https://en.wikipedia.org/wiki/Albanian_iso-polyphony);
  [Anglisticum paper, "Modality…"](https://anglisticum.org.mk/index.php/IJLLIS/article/download/1494/2003/5271))
  [S]. **This is a gift for game audio**: any sequence of notes from an anhemitonic pentatonic scale
  is consonant, so escalating card-play notes can never clash. That is the property Peggle gets from
  its diatonic scales.
- Urban café music (Shkodër, Elbasan, Korçë) carries Ottoman-era colour (augmented seconds, makam-like
  turns) [U, not confirmed at a primary source]. Use it as a *flavour note* in the menu melody, not in
  the gameplay SFX.

### 3.3 Meters, and whether odd meters hurt mass appeal

- Albanian dance music runs in 2/4, **7/8 (2+2+3, slow-quick-quick)**, 9/8 pogonishte (2+2+2+3), and
  3/8, 5/8 and 10/8
  ([SFDH, Albanian dance forms in Kosovo](https://sfdh.us/encyclopedia/introduction_to_albanian_dance_forms_in_kosovo_reineck.html);
  [Music of Albania](https://en.wikipedia.org/wiki/Music_of_Albania)) [S]. Tropojë's *k'cimi* dancing
  was added to UNESCO's list in December 2024
  ([Wikipedia](https://en.wikipedia.org/wiki/Vallja_e_Tropoj%C3%ABs)) [S].
- **Evidence.** North American adults cannot tell structure-preserving from structure-violating changes
  in complex-meter folk tunes, while Bulgarian and Macedonian adults can. Six-month-old infants handle
  both (Hannon & Trehub 2005, *Psychological Science*,
  [doi](https://doi.org/10.1111/j.0956-7976.2005.00779.x)) [P]. So Western listeners do not *track*
  an aksak meter, but nothing in that study says they *dislike* it.
- **Mass-market precedent.** **Balatro's entire soundtrack is in 7/4** (Balatro Wiki) [S] and was a
  mass hit. Take Five (5/4) is the best-selling jazz single, and Pink Floyd's Money opens in 7/4
  ([NPR](https://www.npr.org/2008/09/26/94979223/five-more-in-5-4)) [S].
- **Verdict [U]:** a **7/8 (2+2+3) lilt at a relaxed tempo** is an identity asset for the menu theme.
  It reads as a lopsided groove, not as "difficult". Keep the table bed pulse-light or in a plain
  meter so it never fights the turn rhythm. Avoid 9/8 and 11/8 for anything that loops.

### 3.4 Regional folk made mainstream

- **The Witcher 3.** Marcin Przybyłowicz brought in the folk band Percival (bowed gusle, lute,
  hurdy-gurdy, fiddle) and called Slavic folk the score's "secret ingredient". The band supplied raw
  musical material and the composer shaped the final tracks
  ([WSHU](https://www.wshu.org/culture/2017-06-27/music-respawn-marcin-przybylowicz-says-slavic-music-is-the-witchers-secret-ingredient)
  [P, interview]; [Gamemusic.net](https://gamemusic.net/percival-the-witcher-3-wild-hunt/) [S]).
  **The model is authentic players recorded as raw material, arranged in a modern way.**
- **Ghost of Tsushima.** Ilan Eshkeri studied with a specialist, used shakuhachi, koto and biwa
  soloists **as soloists over a Western frame**, and accepted non-idiomatic lines, because the aim was
  emotional authenticity, not museum accuracy
  ([Den of Geek](https://www.denofgeek.com/games/ghost-of-tsushima-music-ilan-eshkeri/);
  [Spitfire](https://composer.spitfireaudio.com/en/articles/the-music-of-ghost-of-tsushima-with-ilan-eshkeri))
  [S, interview reports].
- **Hearthstone** used accordion and penny whistle to say "tavern" instantly (above) [S].
- **The lesson.** One or two **signature solo timbres** (çifteli plus clarinet) over a familiar,
  consonant harmonic frame and a production polish players already know. Folk colour works as a
  *spice* on accessible harmony, not a full ethnographic ensemble.

---

## 4. ElevenLabs sound effects: prompting, limits and licence

### 4.1 Prompting (official)

- **Plain language plus audio terms.** Upgrade a bare prompt ("footsteps on grass") with production
  words: high-quality, professionally recorded, foley
  ([Help centre, prompting SFX](https://elevenlabs.io/docs/help-center/product/core-capabilities/sound-effects/how-do-i-prompt-for-sound-effects))
  [P].
- **Official vocabulary:** Impact, Whoosh, Ambience, **One-shot**, **Loop**, Stem, Braam, Glitch, Drone
  ([Sound effects capability docs](https://elevenlabs.io/docs/overview/capabilities/sound-effects)) [P].
- **Musical prompts are officially supported**, with BPM and key examples such as brass stabs in F
  minor or a 90 BPM drum loop (same page) [P]. **Nobody guarantees the output hits that key or tempo**
  [U]. Measure the pitch and retune in post.
- **Generate sequences as separate sounds** and combine them in an editor, instead of asking for one
  complex multi-event prompt (help centre and product guide) [P].
- **Length and conditioning.** Guides recommend 10 to 60 words and warn that one- or two-word prompts
  come out generic ([Promptomania](https://promptomania.com/models/elevenlabs/elevenlabs-sfx)) [S]. The
  hard limit is 450 characters
  ([product guide](https://elevenlabs.io/docs/eleven-creative/playground/sound-effects)) [P].
  Describing material, size, distance and space (e.g. "close-mic", "dry, no reverb", "small wooden
  room") and the envelope ("sharp attack, short decay, no tail") is widely recommended [S]. I found no
  official page that tests these words [U].
- **Takes.** The UI makes **four** per generation (product guide) [P]; the API and MCP make **one**
  per call. `prompt_influence` defaults to **0.3**; higher follows the prompt more closely with less
  variation ([API reference](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert))
  [P]. The MCP does not expose it, so expect the default. Outputs will vary, which **suits
  round-robin pools**. Plan on **3 to 6 takes per sound**.
- **Model and limits.** `eleven_text_to_sound_v2` (SFX v2, released 2025-09-02): up to 30 s,
  **seamless loop** mode, 48 kHz ([ElevenLabs on X](https://x.com/elevenlabsio/status/1962912811392131214))
  [P]. The API accepts 0.5 to 30 s; the MCP caps at 5 s.
- **Cost.** A specified duration costs **40 credits per second**; auto-duration costs 200 credits per
  generation (capability docs [P];
  [help centre](https://help.elevenlabs.io/hc/en-us/articles/25735337678481-How-much-does-it-cost-to-generate-sound-effects)
  [S, snippet]). Free is 10k credits a month, **about 250 s of generated SFX**; Starter is 30k, about
  750 s ([pricing](https://elevenlabs.io/pricing)) [P].

### 4.2 Strengths and weaknesses for Murlan [U, judgement plus the docs above]

- **Good at:** textures and ambience (café murmur, room tone, lantern-chain creak, crickets), whooshes,
  impacts, generic foley, abstract tonal sweeteners, 5 s loops.
- **Weak at:** exact pitch or key, exact rhythm, a *consistent* set of variants (each call is
  independent), and ultra-short transients. It tends to pad the start with silence and add room tail.
  Card foley generated this way is often slightly "wrong" in material.
- **Five-second loops are too short** for an idle bed. Layer 2 or 3 loops of different lengths (e.g.
  4.9 s, 3.7 s, 4.3 s) and add randomly scheduled one-shots (a cup, a chair, a distant laugh) every
  8 to 25 s.
- **Always post-process:** trim the leading silence, fade the tails, high-pass at about 90 Hz,
  normalise per tier, and **retune** tonal takes to the house key.

### 4.3 Licence: this decides what can ship

- **The free plan is non-commercial.** The terms (effective 31 March 2026) limit Free Users to
  non-commercial use ([Terms of Use](https://elevenlabs.io/terms-of-use)) [P]. The help centre adds
  that the free plan carries no commercial licence, that public use of free output must credit
  elevenlabs.io or 11.ai in the title, and that **every paid plan includes a commercial licence** except
  for Beta services
  ([help centre, publishing](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform))
  [P].
- **Upgrading does not clearly cover old output.** The terms say nothing on whether free-plan output
  becomes commercial after an upgrade [P, silent]. Suno explicitly says upgrading is *not* retroactive
  (below). **Treat free-tier ElevenLabs SFX as prototypes and regenerate the final set in a paid
  month** [U, conservative reading].
- **SFX-specific terms (updated 12 Feb 2026).** You may opt out of ElevenLabs sublicensing your SFX
  output to others with "Disable" ([Sound Effects Terms](https://elevenlabs.io/sound-effects-terms))
  [P]. The Prohibited Use Policy bars selling SFX as standalone libraries [S]. Using them *inside* a
  game is fine on a paid plan.
- **Music excludes games on every self-serve plan.** Eleven Music's model terms (updated 26 May 2026)
  allow commercial use on Free through Business with carve-outs. The one quotation in this document is
  the clause: "All online and offline commercial use permitted, except film, TV, radio, & Studio
  Games." Studio Games are video games that are **monetised in any way (sale, ads, anything else) and
  available on more than one platform**. Only Enterprise lifts the exclusion; Free also requires an
  "Eleven Music" credit
  ([Eleven Music Model-Specific Terms](https://elevenlabs.io/eleven-music-model-specific-terms)) [P].
  **Murlan ships on iOS and web, which is more than one platform. The moment it earns money in any
  form, self-serve Eleven Music is off-limits.** The music terms also allow Free-plan commercial use,
  which contradicts the general ToS. The question is moot here because `compose_music` returns 402.

---

## 5. Alternatives: cost, licence and quality

| Option | Cost | Licence for a shipped game | Fit |
|---|---|---|---|
| **ElevenLabs Starter** | **$6/mo** ([pricing](https://elevenlabs.io/pricing)) [P] | Commercial SFX [P]. Music API unlocked for paid plans ([music docs](https://elevenlabs.io/docs/overview/capabilities/music)) [P], but **Studio Games excluded** [P] | Best cheap route to *legal* generated SFX. One month is enough for the whole final SFX set. |
| **ElevenLabs Creator** | $22/mo ($11 first month) [P] | Adds 192 kbps and "music commercial use", with the same Studio Games carve-out [P] | Not needed unless you want 192 kbps |
| **Stable Audio 2.5 API** (Stability) | about **$0.20 per generation** ([api-evangelist summary](https://github.com/api-evangelist/stability-audio)) [S] | Trained on licensed data and pitched as commercially safe ([Stability](https://stability.ai/news-updates/stability-ai-introduces-stable-audio-25-the-first-audio-model-built-for-enterprise-sound-production-at-scale)) [P]. The Community License lets under-$1M businesses use the listed models commercially and says **you own the output** ([Stability license](https://stability.ai/license)) [P] | Good for ambience beds and instrumental loops; weaker at hummable melody [U]. No official MCP found [U]. |
| **Suno Pro / Premier** | **$8 / $24 per month** ([pricing](https://suno.com/pricing)) [P] | Commercial use for songs made *while subscribed*; **not retroactive** for free-plan songs ([help](https://help.suno.com/en/articles/2425729)) [P]. After the WMG settlement, users hold a licence rather than ownership ([Music in Africa](https://musicinafrica.net/magazine/suno-adjusts-ai-music-ownership-terms-after-warner-music-partnership/)) [S]. **No public official API**, only a partner-program intake ([MBW, July 2026](https://www.musicbusinessworldwide.com/suno-explores-developer-api-seeking-apps-that-unlock-experiences-generative-music-makes-possible-for-the-first-time/)) [S]. The MCP servers that exist wrap unofficial third-party APIs ([example](https://github.com/AceDataCloud/SunoMCP)) [S], so ToS risk. | **The strongest AI option for a catchy, hook-driven instrumental** [U]. Premier adds stems. Loop points and exact key still need hand editing. I did not check Suno's terms for a games carve-out [U]. |
| **Udio** | n/a | Since the UMG settlement (Oct 2025) it is a **walled garden with no downloads** ([Billboard](https://www.billboard.com/pro/udio-deal-backlash-ai-users-download-ai-songs-48-hours/)) [S] | **Out.** |
| **Meta AudioCraft (MusicGen / AudioGen)** | free, runs locally | Code is MIT; **weights are CC-BY-NC 4.0, non-commercial** ([model card](https://github.com/facebookresearch/audiocraft/blob/main/model_cards/MUSICGEN_MODEL_CARD.md)) [P] | **Cannot ship.** Prototyping only. |
| **Freesound** | free | Licence is set per sound: CC0, CC-BY, or CC-BY-NC (avoid NC). **Commercial use of the API is negotiated case by case** ([API terms](https://freesound.org/help/tos_api/)) [P], so download CC0 sounds by hand. Community MCP servers exist ([timjrobinson/FreesoundMCPServer](https://github.com/timjrobinson/FreesoundMCPServer)) [S]. | Real recorded card and café foley. Quality varies. |
| **Sonniss #GameAudioGDC bundles** | free | Commercial use in games, **no attribution**, unlimited projects; no resale as a library; **AI training prohibited** ([licence](https://sonniss.com/gdc-bundle-license/)) [P] | **The best free source of professional foley**: wood, cloth, glass, crowds, rooms |
| **Pixabay music and SFX** | free | Free use, no attribution, no standalone redistribution ([licence summary](https://pixabay.com/service/license-summary/)) [P]. Some tracks are registered with Content ID [U]. | Stock quality; no identity |
| **OpenGameArt** | free | Licence varies per asset; many need attribution [U] | Low identity |
| **Commissioning a human composer** | Balatro's composer was hired on **Fiverr** (Balatro Wiki) [S]. A realistic range for one theme with arrangements, stems and stingers is **$300 to $1,500**; one session çifteli or clarinet player, **$50 to $200 per track** [U, market estimate] | You own it, or hold an exclusive licence by contract | **Highest ceiling for a catchy, coherent theme with a motif system** |
| **Recording the foley yourself** | a deck, a felt mat, a wooden table, a phone or USB mic, a quiet cupboard | You own it | **The most authentic card sounds of any option** [U]. Cards on felt are easy to record well. |

**Best realistic quality [U, judgement]:**

- **(a) Card and foley sounds:** self-recorded card foley on a real felt and wooden table, plus Sonniss
  and Freesound CC0 for café, glass and wood, plus ElevenLabs on Starter for ambience beds, whooshes
  and abstract sweeteners.
- **(b) A catchy theme:** a human composer with one or two recorded folk soloists. The best AI route
  is Suno Pro or Premier for one month, used to prototype or produce the theme, then hand-edited for
  loops and key.

---

## Recommendations for Murlan

### (a) Three sound directions

All three share one **house key and motif** so that every tonal sound belongs to one identity. That
coherence is what Peggle, Hearthstone and Balatro have in common. Casual card apps do not have it.

- **House key: E, in a minor-pentatonic frame (E G A B D).** It is anhemitonic like iso-polyphony, so
  no two notes clash. It matches the çifteli's common B3 and E4 tuning, it is guitar-friendly, and its
  fundamentals (E4 ≈ 330 Hz) are ones phones can play.
- **House motif, "Murlan call" (four notes):** B3 → E4 → G4 → E4. It rises by a fourth, climbs a third,
  then falls home: the rise-fall contour the earworm study describes, with the fourth as the hook
  interval.
  - The **first two notes** (B→E) are "your turn".
  - The **full motif** is a manche won.
  - **Menu theme and win stingers** develop the same four notes.

**Direction 1: "Kafe e natës" (the night café, acoustic).**
Real, close-miked foley is the physical layer: linen-finish cards on felt, a knuckle knock on a waxed
walnut rim, a glass of raki set down, a copper xhezve. The tonal layer is a **plucked çifteli** (single
notes, retuned to the house scale) and a **def** for accents. The **clarinet** carries every
emotional stinger (win, loss, partita). The space is a **small wooden room**: short, warm and nearly
dry (RT60 about 0.4 to 0.6 s), with an occasional distant murmur. The music is a café trio (sharki or
çifteli, clarinet, def) that sounds as if it plays in the corner, in a 7/8 lilt for the menu, and a
drone plus sparse plucks for the table. This is the **safest mass-appeal choice**: Hearthstone's
tavern recipe in Albanian clothes. Its risk is sounding "stock world music" if the clarinet writing
is clichéd.

**Direction 2: "Llamba" (the lantern, warm magical-realist).**
The same card and felt foley, but the tonal layer is **the lantern itself**. Tuned glass and brass
tings are pitched to the house scale, with a soft kalimba- or celesta-like bell doubled an octave up
by a çifteli pluck. The light-pool sway gets a faint **chain creak** and a slow **tonal shimmer** as
it moves between seats. The space is a medium, soft plate (about 1.0 s), so stingers bloom like
lamplight. The music is a warm **iso vocal-drone pad** (soft "ah" voices on E and B), a slow plucked
ostinato, and the motif on sharki. Monument Valley is the model: musical, harmonious SFX. This is the
**most distinctive and most "premium"** direction, and the easiest to keep non-fatiguing because
every sound is consonant. Its risk is feeling too soft for the bomb unless the bomb gets a dedicated
percussive layer.

**Direction 3: "Sheshi" (the night square, cinematic folk).**
The foley is tighter and punchier: cards "snap" with a little saturation for phone presence. The
tonal layer is a **bowed lahuta or gusle drone** for tension and **sharki** for melody. The
percussion is a big processed def (low-mid thump with harmonics at 150 to 300 Hz and bright jingles).
The space is a **stone courtyard at night**: a longer, darker reverb (about 1.5 to 2 s) on stingers
only, with foley kept dry. The music is Witcher / Ghost of Tsushima-style: folk soloists over modern
pads and drums, with the menu theme driving in 7/8 and the table bed as drone plus heartbeat pulse.
This is the **most dramatic** direction, with the best bomb and partita moments. Its risk is fatigue
over long sessions if the drone and reverb are overused, and it reads less "cosy kafene".

**My ranking [U]:** Direction 1 as the base, with Direction 2's lantern tonal layer as the
signature. The lantern sway and light pool are *the* art idea, so give them the sonic identity. Keep
Direction 3's def and harmonic-bomb treatment for the bomb only.

### (b) Per-moment design rules

Loudness tiers are peak levels relative to the loudest event, which is 0 dB. Mix integrated to about
**−18 LUFS with a −1 dBTP ceiling** (ASWG-R001 portable). High-pass everything at about 90 Hz, and put
recognition energy between 400 Hz and 5 kHz.

| Moment | Length | Tier | Layers | What makes it recognisable | Variation |
|---|---|---|---|---|---|
| Card select | 60–120 ms | T1, −20 dB | a dry card lift or tick, no tone | A tiny bright transient at 2–4 kHz; must disappear into habit | 4–6 round-robin, ±4 % pitch, ±1.5 dB |
| Card play (landing) | 150–300 ms | T2, −12 dB | slap on felt + short slide + **one çifteli/glass note** | **The note climbs the pentatonic scale with each play in the trick** (Peggle-style) and resets when the trick clears; a combo plays 2–3 notes as a strum | 5+ foley variants; the tone is chosen by scale degree, never jittered |
| Pass | 200–350 ms | T2, −14 dB | two knuckle taps on the wooden rim (the real-table gesture) | Rhythmic, non-tonal, *different material* (wood, not card) | 3 variants |
| Your turn | 400–700 ms | T3, −8 dB | motif head B→E, soft pluck + lantern shimmer, paired with haptics | **The first two motif notes, and only ever for this**, so it is learned within minutes | none, or two timbres (menu vs. table); consistency *is* the recognition |
| Turn clock (escalation) | last 10 s | T3 rising to −6 dB | wooden tick → a faster tick an octave up in the last 5 s → the lahuta drone swells in the final 3 s; the music bed drops its melody stem | Tempo and pitch rise; must be urgent **without** an alarm timbre | tick pool of 3 |
| Bomb | 1.2–2.0 s | T5, 0 dB | ~120 ms pre-silence (duck music −9 dB) → def hit plus saturated low-mid body plus card-slam foley → clarinet or brass stab on E → short courtyard tail | **The only sound allowed to be big**; breaks the scale pattern and duck the music (Quarles: −9 dB, 500 ms down, 1 s back) | 2 variants; a four-of-a-kind can add a 4-note arpeggio |
| Manche won | 1.5–2.5 s | T4, −4 dB | full motif on clarinet + çifteli, resolves on E; light glass-clink cascade | Motif **resolves home** | 2 arrangements |
| Manche lost | 1.0–1.5 s | T4, −8 dB | motif inverted and descending, ends on B (unresolved but gentle), soft clarinet | Recognisably the *same* motif, sadder; never mocking | 2 arrangements |
| Partita won | 4–6 s | T5, 0 dB | full ensemble statement of the motif ×2 + iso vocal swell + a short burst of café applause | The biggest musical moment; ends on high E; a lasting, earned feeling | 1 (rare event, so repetition is fine) |
| Partita lost | 2.5–3.5 s | T4, −6 dB | slow clarinet phrase + lantern dimming shimmer, ends on the tonic, calm | Dignified closure; invites "again" with no manipulative cliff-hanger | 1 |
| Deal / shuffle | riffle ~1 s + per-card flicks 40–80 ms | T2, −12 dB | a riffle and bridge one-shot, then **one flick per dealt card, sequenced in code to the animation** | Real shuffle sound; the familiar genre convention | 3 riffles, 6+ flicks |
| Card exchange | 400–700 ms per direction | T2, −10 dB | two slides crossing the felt + soft whoosh; the loser's giving slide is lower and duller, the winner's return brighter | Direction readable by ear | 3 variants |
| Reconnect | 500–800 ms | T3, −8 dB | lost: tone fades and muffles (low-pass sweep); regained: motif head rising B→E with a lantern "flare" | Uses the motif; the same family as "your turn" but brighter | none |
| Idle table ambience | layered loops | T0, −30 dB | café room tone (4.9 s loop) + low murmur (3.7 s loop) + crickets or night outside (4.3 s loop) + random one-shots every 8–25 s (cup, chair, far laugh, **lantern chain creak synced to the sway**) | Place, not a sound; it should be *missed* when absent, never noticed when present | many one-shots, shuffled with no immediate repeats |
| Lobby seat filled | 300–500 ms | T3, −10 dB | chair scrape + **the next motif note** (seat 1 = B, 2 = E, 3 = G, 4 = E) | The room *builds the motif* as it fills | 3 chair variants |
| Room full | 1.0–1.5 s | T4, −6 dB | the four notes together as a chord + def roll + murmur swell | Completes the motif; "game on" | 1 |

**Global rules:**

- **Separate music and SFX sliders.** Use the iOS Ambient audio-session behaviour: mix SFX with other
  apps' audio, and skip the soundtrack when the user's own audio is playing (Apple HIG). This is the
  number one genre complaint.
- **Cap concurrent voices** at 1 per event type and about 6 in total.
- **Two per second.** Card-play sounds that fire faster than two per second (bot rushes) should drop
  the tonal layer and play foley only.
- **Test every sound on an iPhone speaker at 30 % and 70 % volume** before accepting it. Laptop
  speakers and headphones lie.

### (c) The best route to a catchy table theme and menu theme

- **ElevenLabs is out for music.** `compose_music` returns 402 on the free tier. Even on a paid
  self-serve plan, Eleven Music **excludes monetised games on more than one platform** (iOS + web =
  more than one), so it is not a safe route unless Murlan stays unmonetised forever.
- **ElevenLabs free-tier SFX are non-commercial.** Use them to *prototype* the palette. Buy
  **Starter at $6 for one month** to generate the final SFX set with a commercial licence.

**Recommended route (total about $6 to $1,500, depending on ambition):**

1. **Now, free.** Record the card and table foley yourself. Pull wood, glass and crowd sounds from
   the Sonniss GDC bundles and CC0 Freesound. Prototype the ambience and tonal sweeteners with the
   free ElevenLabs MCP, and **listen on the phone**.
2. **Motif first.** Fix the four-note house motif and the key (E pentatonic) before any music is made.
   It is also the brief for the composer or the AI.
3. **The theme, in one of two ways:**
   - **Best quality (recommended), about $300 to $1,500 [U].** Commission a composer, the way
     Balatro did via Fiverr, for one theme delivered as:
     - (i) a menu arrangement: 7/8 lilt, 90 to 110 BPM, about 60 to 90 s with a clean loop point;
     - (ii) a table bed: 3 to 4 stems (drone or iso pad, plucked ostinato, melody, def pulse), 2 to 3
       min, sparse, with the melody stem droppable;
     - (iii) all the win and loss stingers built from the motif.
     Budget **one live çifteli or clarinet soloist** at about $50 to $200 [U]. One real folk voice is
     what makes it sound authentic rather than stock, as with the Witcher's Percival.
   - **Budget, $8 to $24.** One month of **Suno Pro, or Premier for stems**. Generate instrumental
     candidates in the brief's style (Albanian café trio, çifteli, clarinet, frame drum, 7/8, E minor
     pentatonic, the motif hummed into the prompt as a description), then hand-edit the loop points,
     retune if needed and cut stingers. The licence covers only songs made while subscribed, and there
     is no official API, so do it in the Suno web app, not through an unofficial MCP. Check Suno's
     current terms for any games carve-out before shipping [U].
4. **Implement adaptively.**
   - Crossfade the menu and table arrangements.
   - Drop the melody stem during long thinks, and bring in the pulse stem in the clock's last 10 s.
   - Pitch the bed down gently on a lost partita, as Balatro does on game over.
   - Duck the music −6 to −9 dB under bomb and win stingers.
   - After several minutes of inactivity, fall back to ambience only, as Peggle does.
