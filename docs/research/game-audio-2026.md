# Game audio at a shipped-product standard — research, August 2026

Fact-finding pass for a planning session. **No code was changed and nothing was committed.**

Ground truth for "where we are today" is `lib/sounds.ts` and `assets/sounds/README.md`, both
read before this research began. Everything else is cited to a primary source or explicitly
flagged as unverified. Research date: **2026-08-20**.

> **Caveat on completeness.** The session's web-search budget ran out partway through. Most
> facts below were fetched directly from the primary page; where a page 403'd, 404'd or sat
> behind a login, that is stated in the section and repeated in
> [What could not be verified](#what-could-not-be-verified). One area is materially thinner
> than the rest: **2026 composer rate cards** (§3e — no primary rate survey was reachable).
> Five subscription libraries (Envato Elements, PremiumBeat, Storyblocks, Bensound, Uppbeat)
> also blocked every fetch and are reported as unverified.

---

## Bottom line

1. **Don't adopt `react-native-audio-api` yet, but plan for it.** Latest stable is **0.13.3
   (published 2026‑08‑17)** — still pre‑1.0, though `1.0.0-nightly-*` builds are being cut
   daily and `main`'s `package.json` already reads `1.0.0`. On web it is a *thin passthrough
   over the browser's real Web Audio API*, so it genuinely would collapse `lib/sounds.ts`'s
   dual path into one API. It also requires an Expo **dev client** (no Expo Go) and a config
   plugin. Cost: zero money, ~1–2 days of work, plus a native-binary size increase. Revisit
   when 1.0 ships. §1
2. **Add music on the existing stack first — it needs no new dependency.** On web, route a
   streaming `HTMLAudioElement` → `MediaElementAudioSourceNode` → `GainNode` into the
   `AudioContext` `lib/sounds.ts` already owns; that gives ducking and fades for free and
   avoids ~40 MB of decoded PCM per 2‑minute track. On native, `expo-audio`'s `AudioPlayer`
   already loops and plays simultaneously — it just cannot *ramp* volume, so fades must be
   stepped in JS. §1, §5
3. **Gate all audio behind one real tap, and never start an `AudioContext` on mount.**
   `GameTable.tsx:827` currently calls `preloadSounds()` from a mount effect, which
   constructs the web `AudioContext` outside any gesture — it will sit `suspended` on
   Chrome and Safari. Safari additionally requires `resume()` **synchronously inside the
   gesture** (no `await` first) and has an `"interrupted"` context state, distinct from
   `"suspended"`, that can stick after a phone call and needs a tap-to-resume fallback. §2
4. **Music must not be MP3.** MP3 cannot loop seamlessly (encoder delay + frame padding;
   browsers do not honour the LAME gapless headers). Ship music as **Ogg/WebM Opus at
   ~96 kbps stereo** — Safari has decoded WebM Opus since **17.0 (Sept 2023)** and Ogg Opus
   since **18.4 (31 Mar 2025)** — and, regardless of codec, loop by *scheduling* the next
   `AudioBufferSourceNode` at a computed `currentTime` rather than trusting `loop = true`.
   New assets should be **48 kHz**, not 44.1. §5
5. **Buy the music per track; do not subscribe to it, and never use a field recording.**
   Video-music subscriptions are the wrong shape: **Artlist's licence (eff. 15 Feb 2026)
   excludes "App, Software, games" from every standard plan**, Epidemic Sound grants only a
   *video and podcast* sync licence, and Musicbed lists "Video Game" under Enterprise only —
   all three want a custom quote. Two clean self-serve options exist:
   **AudioJungle "Music Mass Reproduction"** (perpetual, one end product, unlimited copies,
   explicitly names "apps" and "downloaded games"; per-track price unverified) and
   **Soundstripe's single-use "Expanded" licence at $399+/track**, which explicitly names
   "gaming platforms". Note AudioJungle's cheaper "Music Standard" caps at **10,000
   downloads** — wrong for a shipped game. §3a/b
6. **The Albanian identity has to be commissioned, not licensed.** A traditional *melody*
   may be public domain, but every existing *recording* of it is separately protected (EU:
   70 years from publication; US: pre‑1972 recordings protected to 2067 under the MMA).
   Nothing usable and openly licensed was found: the UNESCO iso‑polyphony page carries no
   reuse licence, Internet Archive's *Folk Music of Albania* is a digitised **Topic Records
   1966 LP** with no rights statement (assume in copyright), and Smithsonian Folkways is a
   paid sync licence. Commission a new arrangement — and beware the trap of tunes that
   *sound* folk but aren't: "Baresha" was written by **Rexho Mulliqi** c. 1970. §6
7. **Scope the score small and deliberately.** The comparable that matters is not Hearthstone
   or Slay the Spire (25 tracks) — it's **Balatro: 5 tracks, all in 7/4, composed at 2:53 and
   slowed to 70 % for a 4:07 in-game loop**, with the "boss" variation being the *same track*
   pitch/tempo-shifted rather than a stem-based adaptive system. Minimum credible set for
   Murlan: **1 menu loop, 1 restrained in-hand bed, 1 short win/lose cue, and a
   pitch-shift variant for the final cards** — the variant costs almost nothing. §4
8. **Assume most players never hear it.** TapResearch (2,400 census-balanced mobile gamers,
   18 May 2022) found **91 % play with sound off**. Music must therefore be pure garnish —
   no state information may live in it — and a hard mute must stay one tap away. Settings
   already has `soundsEnabled` + `soundVolume`; music needs its **own** toggle and slider,
   because a player who wants card *clicks* without a *soundtrack* is the common case. §4
9. **AI music: pick the vendor by its licence, not its output — they differ enormously.**
   The US Copyright Office's **Part 2 (29 Jan 2025)** holds that "**prompts do not alone
   provide sufficient control**", so purely prompt-generated music is not copyrightable: you
   may ship it, you just cannot stop anyone copying it. On terms, four facts decide it —
   **AIVA Pro (€33/mo)** assigns "**all copyrights**", names "**video games**" in its
   definitions, and is the only vendor whose *terms* (not FAQ) say "**Term: perpetuity**";
   **ElevenLabs excludes "Studio Games" — commercialised games on more than one platform —
   from every tier up to Business at $990/mo**; **Udio grants no commercial use at all** and
   bars downloading "on any personal device"; and **Google Lyria costs $0.08 per full-length
   track** but is **conspicuously absent from Google's indemnified-services list** that covers
   Veo and Imagen. **No vendor indemnifies you; all make you indemnify them.** §3d
10. **⚠️ Two dated items that expire during any planning cycle.** Suno imposes **download
   caps on 3 September 2026** — two weeks from this report (Pro 20/month, Premier 60/month,
   previously uncapped); pull any library before then. And Udio **disabled downloads
   overnight without notice** on 29 Oct 2025 after its UMG settlement, with **no
   grandfathering** for tracks made under its previously commercial-use terms. Whatever you
   generate, **download and archive the masters the same day.** §3d

**Recommended order of work**

| # | Action | Cost | Effort |
|---|---|---|---|
| 1 | Audition the 12 existing SFX on real hardware (never done) | £0 | hours |
| 2 | Move web music onto `MediaElementAudioSourceNode` + gain; add a gesture gate; handle `interrupted` | £0 | 1–2 days |
| 3 | Add a separate music enable/volume to `SettingsContext` + three locales | £0 | hours |
| 4 | Temp-track with AI or CC0 to prove the design before spending | £0–$30 | days |
| 5 | Commission 3–5 Albanian-flavoured loops from a composer | est. $1.5k–5k *(unverified)* | weeks |
| 6 | Re-encode everything to 48 kHz; music to Opus | £0 | 1 day |
| 7 | Revisit `react-native-audio-api` when 1.0 ships | £0 | 1–2 days |

---

## 1. expo-audio vs react-native-audio-api in 2026

### `react-native-audio-api` (Software Mansion)

| | |
|---|---|
| Latest stable | **0.13.3**, published **2026‑08‑17** ([npm registry](https://registry.npmjs.org/react-native-audio-api)) |
| Nightly channel | `1.0.0-nightly-*`, cut **daily** (e.g. `1.0.0-nightly-03d0deb-20260820`) |
| `main` branch version | `1.0.0` (verified from [`packages/react-native-audio-api/package.json`](https://raw.githubusercontent.com/software-mansion/react-native-audio-api/main/packages/react-native-audio-api/package.json)) |
| First release | 0.0.1, **2024‑08‑29** — the library is two years old |
| Repo | [software-mansion/react-native-audio-api](https://github.com/software-mansion/react-native-audio-api), ~828★ |

**Maturity.** Still pre‑1.0 on the stable tag after two years, but the daily 1.0 nightlies and
a `main` already stamped `1.0.0` say a 1.0 is imminent. Release cadence is roughly monthly
(0.13.3 Aug 17 → 0.13.2 Jul 15 → 0.13.1/0.13.0 Jul 1 → 0.12.2 May 12).

**New Architecture.** The
[compatibility table](https://docs.swmansion.com/react-native-audio-api/docs/other/compatibility/)
lists Fabric/TurboModule support for RN **0.74–0.85**, which covers this app's **0.81.5**. Old
Architecture (Paper) is also supported on the 0.1.x–0.8.x line.

**Web support — the decisive fact.** On web it **wraps the browser's native Web Audio API
rather than reimplementing it**, but deliberately "limits the available interfaces to APIs
that are implemented on iOS and Android" — i.e. you get the *intersection* surface, not the
whole browser API (source: the repo's own
[`CLAUDE.md`](https://github.com/software-mansion/react-native-audio-api/blob/main/CLAUDE.md)
and the
[getting-started docs](https://docs.swmansion.com/react-native-audio-api/docs/fundamentals/getting-started/)).
It runs under `react-native-web` / Expo web. The package ships a bin script
`setup-rn-audio-api-web` (verified present in the manifest) implying a web build/config step;
**its exact behaviour is not documented anywhere I could find.**

**So: yes, adopting it would let `lib/sounds.ts` delete its dual path.** One graph API on
native and web, same code.

**Expo integration.** Not usable in Expo Go ("contains native custom code"). Requires an
**Expo dev client** plus a config-plugin entry in `app.config.js` for iOS/Android permissions
and background modes. No minimum Expo SDK is published — compatibility is expressed purely in
RN versions, and SDK 54's RN 0.81.5 is inside the range.

**Peer-dependency wrinkle.** npm reports peers `react: *`, `react-native: *`,
`react-native-worklets: >= 0.6.0` (optional). This repo pins **`react-native-worklets` 0.5.1**
(Reanimated 4.1.1's companion). If a future version makes that peer hard, it collides.

### Feature comparison

| Capability | `react-native-audio-api` 0.13.3 | `expo-audio` (SDK 57 docs) |
|---|---|---|
| GainNode / BiquadFilter / StereoPanner / WaveShaper / IIR / Convolver | yes | **no** |
| `AudioParam` automation (`linearRampToValueAtTime`) → fades, crossfades, **ducking** | yes (real Web Audio spec) | **no** — only an instant `volume` setter, 0–1 |
| Sample-accurate scheduling `start(when)` | yes | no |
| Loop points (`loop`, `loopStart`, `loopEnd`) | yes | boolean `player.loop` only (whole file) |
| Analyser / offline rendering | yes | no |
| Streaming long music | `MediaElementAudioSourceNode`, added in **0.13.0** ([SWM blog](https://swmansion.com/blog/hello-react-native-audio-api-bb0f10347211/), closing [#735](https://github.com/software-mansion/react-native-audio-api/issues/735)) | yes — on web the `AudioPlayer` *is* an `HTMLMediaElement` ([`AudioPlayer.web.ts`](https://github.com/expo/expo/blob/main/packages/expo-audio/src/AudioPlayer.web.ts)); native uses AVPlayer/ExoPlayer |
| iOS session category, interruption events | `AudioManager.setAudioSessionOptions({iosCategory, iosMode, iosOptions})`, `observeAudioInterruptions()`, `addSystemEventListener('interruption', …)` with `began`/`ended`+`shouldResume` ([docs](https://docs.swmansion.com/react-native-audio-api/docs/system/audio-manager/)) | `setAudioModeAsync({ playsInSilentMode, shouldPlayInBackground, interruptionMode: 'mixWithOthers' \| 'doNotMix' \| 'duckOthers' \| 'doNotMixPersistent', allowsRecording, … })` |
| Background / lock-screen | `PlaybackNotificationManager` | lock-screen playlist controls shipped ([changelog](https://github.com/expo/expo/blob/main/packages/expo-audio/CHANGELOG.md)) |
| Codec decode | m4a/mp4/aac/ogg/opus since **0.8.0** (per repo roadmap) | platform-native |

**What expo-audio genuinely cannot do:** ramp a volume. There is no fade/crossfade/ramp API
anywhere in
[`AudioModule.types.ts`](https://github.com/expo/expo/blob/main/packages/expo-audio/src/AudioModule.types.ts) —
only a discrete `volume` setter. Ducking music under a bomb SFX therefore has to be stepped
manually in JS on native, which is audible if done coarsely.

**A trap worth knowing about.** `expo-audio`'s web `volume` setter contains an explicit iOS
Safari warning:

```ts
// AudioPlayer.web.ts
set volume(value: number) {
  if (!hasWarnedIOSVolume && isIOSSafari()) {
    console.warn('expo-audio: Programmatic volume control is not supported in browsers on iOS. …');
  }
  this.media.volume = value;
}
```

That is Apple's restriction on **`HTMLMediaElement.volume`** — it does **not** apply to Web
Audio's `GainNode.gain`. Which is precisely why the hand-rolled Web Audio path in
`lib/sounds.ts` works today, and why any web music implementation must route the media
element **through a GainNode**, not set `.volume` on it.

**Known open issues** (search of the repo's tracker): iOS interruption-recovery crash
[#1013](https://github.com/software-mansion/react-native-audio-api/issues/1013) (open);
Android grey-screen/freeze on reopen after background playback
[#833](https://github.com/software-mansion/react-native-audio-api/issues/833); an
AudioRecorder memory-growth bug [#676](https://github.com/software-mansion/react-native-audio-api/issues/676)
(closed, fix detail not visible).

**Coexistence.** No source confirms or denies running both libraries in one app.
Architecturally they are independent native modules, so it is plausible — **untested and
unverified.**

### Expo SDK status, August 2026

`expo` latest on npm is **57.0.15**. Timeline: SDK 54 → 10 Sep 2025; SDK 55 → 25 Feb 2026;
SDK 56 → 5 May 2026; SDK 57 → 25 Jun 2026. **SDK 54 is still supported** — the 1 May 2026
`"sdkVersion 54.0.0 is not supported"` scare ([issue #45276](https://github.com/expo/expo/issues/45276))
was a transient EAS Update incident that also hit SDK 55
([status page](https://status.expo.dev/incidents/w8h9ltjhktjh)), not a deprecation. SDK 54 is
the **last** SDK with Old Architecture support; 55+ is New-Architecture-only.

### Verdict

Adopting `react-native-audio-api` is the architecturally correct end state — one Web Audio
graph everywhere, real ducking, real crossfades, sample-accurate loop scheduling — and it
deletes the dual path. But it is pre‑1.0, needs a dev client, and pulls a worklets peer that
conflicts with the current pin. **Ship music on the existing stack now; re-evaluate at 1.0.**

---

## 2. Browser autoplay policy for background music in 2026

### Chrome / Chromium

- Autoplay policy applied to `<video>`/`<audio>` from **Chrome 66 (Apr 2018)**, extended to
  the Web Audio API's `AudioContext` from **Chrome 71 (Dec 2018)**.
  ([Autoplay policy](https://developer.chrome.com/blog/autoplay),
  [Web Audio, Autoplay Policy and Games](https://developer.chrome.com/blog/web-audio-autoplay))
- An `AudioContext` constructed before a qualifying gesture starts **`"suspended"`**; you call
  `context.resume()` after the gesture. Chrome's own recommended pattern is create-once at
  load, `.resume()` in the click handler.
- Chrome additionally **auto-resumes** a context when the user has interacted with the page
  *and* a source node's `start()` is called — which is why short SFX often "just work" after
  any tap.
- Qualifying gestures follow the HTML Standard's **sticky user activation**: `click`,
  `keydown`, `pointerup`/`touchend`. **`scroll`, `mousemove` and `pointermove` do not count.**
  Chrome's own guidance: "I'd recommend you stick to `click` for the time being."
- Unprompted autoplay-with-sound needs one of: muted; prior interaction with the domain;
  a crossed **Media Engagement Index** threshold on desktop; or the site installed to home
  screen / as a desktop PWA. **MEI still appears in current docs** (`chrome://media-engagement`);
  no 2026 deprecation notice was found either way — treat it as present but never design
  around it, since you cannot predict it.

### Safari / WebKit (iOS, iPadOS, macOS)

- **Strictest rule:** `resume()` must be called **synchronously inside the gesture handler**.
  An `await` before it, or a `setTimeout`, loses the activation and the context stays
  suspended. This is the single most common "works everywhere except iPhone" bug.
- **Version numbering:** Safari moved to the year scheme at **Safari 26** (WWDC25,
  [webkit.org/blog/16993](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/));
  **Safari 27** was announced at WWDC26, June 2026
  ([webkit.org/blog/17967](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/)).
  In Aug 2026 the shipping consumer version is **26.x**, with 27 in beta.
- **The mute switch silences Web Audio but not media elements.** Per a WebKit engineer on
  [bug 237322](https://bugs.webkit.org/show_bug.cgi?id=237322), Web Audio output defaults to
  the **"ambient" audio session category**, which the hardware Ring/Silent switch mutes —
  whereas `<audio>`/`<video>` elements are unaffected. *This is directly relevant:* the
  comment in `lib/sounds.ts` says "card games are routinely played with the ringer off", and
  `setAudioModeAsync({ playsInSilentMode: true })` handles that **on native only**. On iOS
  web, the current Web-Audio-only path is silenced by the ringer switch.
  - The modern fix is the **AudioSession API** (`type: "playback"`), an Editor's Draft as of
    Nov 2025 with **Safari currently the only implementer**.
  - The classic workaround is keeping a silent `<audio>` element playing to hold the media
    channel. Whether the old silent-buffer unlock hack is still strictly *required* on
    Safari 26.x could not be settled — field reports through 2025 say relocking still
    happens; no WebKit changelog declares it obsolete.
- **`"interrupted"` context state — real and shipped in WebKit.** Distinct from `"suspended"`.
  Entered on screen lock, an incoming call, or another app taking the audio session
  ([bug 273511](https://bugs.webkit.org/show_bug.cgi?id=273511),
  [bug 231105](https://bugs.webkit.org/show_bug.cgi?id=231105),
  [Edge explainer](https://microsoftedge.github.io/MSEdgeExplainers/AudioContextInterruptedState/explainer.html)).
  Listen on `statechange` and `resume()` when it clears — but contexts are documented to get
  **stuck** in `"interrupted"`, so a "tap to resume" affordance is required, not optional.
  Still WebKit-specific; not in Chromium as of Aug 2026.

### Firefox

Blocks autoplay via `media.autoplay.default` (0 allow / 1 block audible / 5 block all).
Web Audio blocking is a **separate, opt-in** pref (`media.autoplay.block-webaudio`), so Web
Audio autoplay is generally **not** blocked by default. Most permissive of the three — still
implement the gesture gate universally rather than branching.

### The pattern to implement

1. Create one `AudioContext` (module load is fine; expect `"suspended"`).
2. Put an unavoidable **tap gate** before any music starts.
3. In the **synchronous** handler: `audioContext.resume()` with no preceding `await`; in the
   same gesture, `.play()` a silent `<audio>` element if you need to escape the iOS ambient
   channel.
4. Handle `onstatechange` for **both** `"suspended"` and `"interrupted"`, with a manual
   resume control as the floor.
5. On `document.visibilitychange`: suspend/pause on `hidden`, resume on visible. Chrome
   already exempts audible tabs from background timer throttling
   ([background tabs](https://developer.chrome.com/blog/background_tabs),
   [timer throttling in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)),
   but Safari hard-interrupts in ways Chrome does not, and pausing is the courteous default.

### iOS PWA / standalone

Home-screen installation is one of Chrome's documented routes to gesture-free autoplay — this
lands more cleanly on Android than iOS. On iOS specifically, third-party reports through
iOS 26.1/26.2 describe unresolved PWA audio regressions (lock-screen controls not advancing,
audio stopping ~30 s after backgrounding). **No Apple or WebKit primary source documents
this**, so treat it as corroborated-but-not-authoritative. Practical posture: **assume music
pauses when an installed iOS PWA is backgrounded or locked, and resume on foreground.**

---

## 3. Music sourcing, ranked by cost and legal safety

The question that decides everything: *does the licence permit embedding the music inside
software distributed to end users*, as opposed to synchronising it to video? Many
"royalty-free" subscription libraries are written for video and are silent, restrictive or
tiered on this point.

### 3a. Subscription royalty-free libraries

**The single most important finding in this section:** these libraries are built around
"Productions" / "Projects" defined as **audiovisual** works — video and podcast. Interactive
software is not what their standard licences are written for, and three of the four majors
verified below push apps and games to a custom Enterprise quote. Buying a video-music
subscription and dropping the track into a game is a licence breach, not a grey area.

**Epidemic Sound** — [Business subscription policy](https://www.epidemicsound.com/policy/business-subscription/),
[music licensing for video games](https://www.epidemicsound.com/blog/music-licensing-for-video-games/):
- The grant is a "**Synchronization license**… to synchronize [tracks], in whole or in part,
  in **video and podcast productions**." No self-serve tier covers games; their own
  games-licensing page directs buyers to a custom **Enterprise** deal.
- It also forbids use "in any digital templates or other **applications enabling end users to
  synchronize or otherwise combine** the Licensed Works with other content."
- **Lapse:** genuinely perpetual for work already shipped — "whatever Production you have
  completed during your subscription will remain licensed for you to use forever… even after
  expiration or termination." You simply cannot make *new* ones after lapsing.
- Attribution suggested, not mandatory. Business plan ≈ $30/mo annual or $75/mo monthly
  (**price unverified** — the pricing page is JS-rendered).

**Artlist** — [licence](https://artlist.io/help-center/privacy-terms/artlist-license/),
effective **15 Feb 2026**. §11 excludes games from every standard plan, in as many words:

> "Artlist offers Enterprise customized solutions as well as for the following cases: Teams
> who need more than 7 seats; **App, Software, games and their end-users**; Customized
> coverage for special use cases…"

- **Lapse:** "you can keep using your Projects in the same media and monetize them forever,
  even after your subscription has expired… any new projects will not be covered."
- **Note for anyone reading blog roundups:** third-party summaries claiming Artlist's
  Business plan covers apps and games are **flatly contradicted by the licence text.**

**Soundstripe** — [terms of use](https://www.soundstripe.com/terms-of-use) (updated
24 Nov 2025), [pricing](https://www.soundstripe.com/library/pricing),
[single-use licences](https://www.soundstripe.com/knowledge/licensing/what-are-soundstripes-single-use-licenses).
**The one major with a self-serve, explicitly-game-covering option:**
- Single-use **"Expanded" licence, $399+ per track**, one-time, perpetual: "Everything in
  Digital, plus… **gaming platforms**." No subscription, so no lapse risk. Other single-use
  tiers: Personal $49+, Digital $199+, All Media $1,249+.
- The *subscription* tiers are a genuine grey area: ToU §3(a) defines "Project" broadly
  ("for any lawful purpose"), but the plan-comparison table lists only web, social, paid ads,
  podcasts, advertising and internal use — apps and games are absent. **Business plan is
  restricted to a single market/DMA**, which rules it out for a worldwide App Store release;
  **Personal bars commercial use** outright.
- **Warner Chappell (WCPM) tracks are carved out** and may not be put into "computer
  programs, applications… unless separately licensed in writing." Avoid WCPM-tagged tracks.
- **Lapse:** "You may use Projects in perpetuity. However, you may only create Projects while
  you have an active plan."

**Musicbed** — [pricing](https://www.musicbed.com/pricing),
[licence terms](https://www.musicbed.com/license-terms) (updated 13 Aug 2025):
- "Video Game" appears **only under Enterprise** (request a quote). Individual and Business
  list web, podcast and social only.
- Rights are granted "as embodied in **a single audiovisual Project**"; use "as part of… audio
  download or other standalone file" or a "product library or collection" is forbidden.
- **Lapse is narrower than the other three:** "Perpetual rights granted under this license
  apply only to the specific project, product, and usage details outlined in this
  agreement… Paid media rights are not granted in perpetuity unless explicitly stated."
- **Harshest enforcement posture found:** liquidated damages of the greater of **$10,000 per
  instance or 10× the licence fee** (§9) for unauthorised use or missing credit.

**Envato / AudioJungle — the other clean self-serve structure.**
[audiojungle.net/licenses/music](https://audiojungle.net/licenses/music) lists five music
licences, all "1 end product":

| Licence | Copies / downloads |
|---|---|
| Music Standard | up to **10,000** |
| Music Broadcast (1 Million) | up to 10,000 |
| **Music Mass Reproduction** | **unlimited** |
| Music Broadcast (10 Million) | unlimited |
| Music Broadcast & Film | unlimited |

The 10,000-download cap makes **Music Standard the wrong licence for a shipped app.** The
[Music Mass Reproduction terms](https://audiojungle.net/licenses/terms/music_mass_reproduction)
verify:

- permitted end products are named as "downloaded podcasts, audiobooks, **apps**, **downloaded
  games**, downloaded e-books, and DVDs";
- the grant is "an ongoing, non-exclusive, commercial, worldwide license" with **no stated
  expiration — perpetual once purchased**, which is exactly what an app that sits on a store
  for years needs;
- it is single-application: "a separate license for each different Allowed Use";
- you may not "re-distribute the Item as a musical item, as stock, in a tool or template, or
  with source files" — normal, and no obstacle to background music inside a game.

Because one purchase covers one end product with unlimited copies, **the web build and the
native builds are one product** and are covered together — a purchase per *track*, not per
platform. **Per-track price could not be verified** (the pricing page returned 403 to
automated requests).

**Pixabay** — verified from the
[licence summary](https://pixabay.com/service/license-summary/) and
[licence](https://pixabay.com/service/license/): it is its **own custom Content License, not
CC0**. Free use, **no attribution required**, modification allowed, commercial use allowed —
but you may not sell or distribute the Content itself "on a **Standalone** basis", nor use
recognisable trademarks or people commercially without release, nor print it on merchandise.
Music embedded in a game is not standalone distribution, so it very likely qualifies; the
licence does not address it by name, and the page itself says only the full terms are legally
binding. **Usable, mildly ambiguous, no indemnity.**

**Not verified — every fetch blocked (403/404), search budget exhausted:** **Envato Elements**
(the subscription, as distinct from AudioJungle the marketplace — it historically works on
per-project "Single Use" registration with restrictions where the item is the primary value),
**PremiumBeat / Shutterstock Music** (historically needed a Multi-Use or extended licence for
a for-sale product), **Storyblocks**, **Bensound** and **Uppbeat**. **Nothing about these five
is asserted here.** Before buying any of them: open the licence page, search it for "app",
"game" and "software", and if the words are absent get written confirmation from support.

### 3b. Perpetual per-track licences aimed at game devs

- **AudioJungle Music Mass Reproduction** — see above. Best verified option.
- **Sonniss GDC Game Audio Bundle** — verified from
  [sonniss.com/gameaudiogdc](https://sonniss.com/gameaudiogdc): **free**, "All of the sounds
  are royalty free and commercially usable", "No attribution is required and you can use them
  on an unlimited number of projects for the rest of your lifetime". Games, films, TV,
  podcasts explicitly allowed. Cannot be redistributed as standalone files or in a competing
  library. **AI/ML training is expressly prohibited.** Archives span **2015–2024** on that
  page; 2025/2026 editions were not confirmed. **Sound effects only — no music.**
  Immediately relevant to the SFX layer, not to this report's music question.
- **Unity Asset Store** — the EULA pages ([unity.com/legal/as-terms](https://unity.com/legal/as-terms),
  [asset-store-eula](https://unity.com/legal/terms-of-service/software/asset-store-eula)) both
  returned **403** to automated fetching. The widely-held understanding is that Asset Store
  assets are licensed for use **in Unity projects**, which would rule them out for an Expo/RN
  game — **this could not be verified and must be read before relying on it.**
- **GameDev Market, itch.io asset packs, Humble game-audio bundles** — not verified in this
  pass.

### 3c. Free / CC0 sources for a shipped title

- **Freesound** ([FAQ](https://freesound.org/help/faq/)) — three live licences: **CC0**
  (do anything, sell it, no attribution), **CC-BY** (credit required), **CC-BY-NC**
  (*cannot* be monetised at all — a real trap on a paid or ad-supported app). Sampling+ is
  deprecated. Filter to CC0 and stay there.
- **Kenney** — already the source of the twelve shipped SFX, per
  `assets/sounds/README.md`. Kenney also publishes **Music Jingles** (~85 files) under
  **CC0** ([kenney.nl/assets/music-jingles](https://kenney.nl/assets/music-jingles)). Jingles
  and stingers, not loops.
- **OpenGameArt** — mixed licences. Two hazards: CC-BY-SA (viral, generally unacceptable in
  a closed-source commercial app) and uploads mislabelled CC0 by someone who did not own the
  work. Not verified in this pass.
- **Incompetech / Kevin MacLeod** ([FAQ](https://incompetech.com/music/royalty-free/faq.html))
  — **CC-BY 4.0 remains free** with the exact credit line
  `"Title" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0`.
  A paid **Standard License** exists for cases where attribution is impossible; **its 2026
  price is not on that page.** Game/app use is not named explicitly, only "something else?
  Probably. Be sure to credit me or purchase a license." - **Free Music Archive** — mixed per-track licences. The **CC-BY-NC trap** is easy to miss:
  a paid or ad-supported App Store game is unambiguously commercial, so an NC track is
  disqualified no matter how well it is credited. Filter to CC0 or plain CC-BY only.

**CC-BY attribution mechanics in a shipped app.** The obligation runs to the people who
receive the work — the players — not to whoever reads the repo. The accepted practice is a
persistent in-app **Credits / About screen reachable from Settings**, listing title, author
and licence ("*Track* by *Author*, licensed under CC BY 4.0") with a link to the licence and
source. It does not need to be in the store listing or shown at launch, but it must be
discoverable inside the product; a line in a README or a source comment does not discharge it.
For this codebase that means a new screen and new keys in all three locales.

**Honest quality ceiling.** CC0 and CC-BY libraries are excellent for *SFX* — the twelve
shipped effects prove it. For **music that carries a title's identity** they are not
competitive: the pool is generic, already used in thousands of titles, and none of it is
Albanian. Free music is the right choice for a temp track and the wrong choice for the
shipped soundtrack.

### 3d. AI-generated music

Every vendor below was read from its own terms document. **The single universal finding: not
one AI music vendor indemnifies you against a third-party copyright claim, and every one of
them makes you indemnify *them*.** Given the 2024–2026 label litigation, that risk allocation
is the most important thing to price in.

| Vendor | Commercial tier & 2026 price | Grant type | Survives cancellation? | Game embedding | Indemnifies you? |
|---|---|---|---|---|---|
| **AIVA Pro** | **€33/mo** billed annually + VAT | **Full copyright assignment** | **Yes — "Term: perpetuity"** | **Explicitly in scope** | No |
| **Suno** | Pro $10/mo ($96/yr); Premier $30/mo ($288/yr) | Assignment of Suno's title | **Silent** — no survival clause at all | Unaddressed (permitted by silence) | No |
| **ElevenLabs** | Creator $22/mo upward | Non-exclusive; you retain rights | **Yes — explicit, best in class** | **EXCLUDED below Enterprise Music** | No (published) |
| **Google Lyria 3 Pro** | **$0.08 per generation** | No ownership asserted either way | n/a (pay-per-use) | Unaddressed | **No — Lyria absent from the indemnity list** |
| **Stable Audio** | Solo $12 → Studio $199/mo | Assignment | Structurally yes; §4 omitted from survival list | Unaddressed | **No — you indemnify them** |
| **Mubert In-App licence** | **$199 per track** | Perpetual licence | Yes — "perpetual" | **Explicitly in scope** | No |
| **Mubert subscription** | $14–199/mo | Licence | **No — "time-limited"** | **Explicitly forbidden** | No |
| **Soundraw** | consumer prices not public | Non-exclusive licence | **No — you must unpublish** | Permitted | No |
| **Beatoven.ai** | pricing page 404s | Licence; **Beatoven owns the copyright** | Self-contradictory | Explicitly in scope | No |
| **Udio** | **none on any tier** | **Udio owns the Output** | works *against* you | **Explicitly prohibited** | No |

#### AIVA — the strongest licence of the set, and the one to use

[EULA](https://www.aiva.ai/legal/1) (no printed date; footer "© 2016-2026 Aiva Technologies
SARL", Luxembourg law). §3: "**Full Copyright:** Licensor hereby assigns, grants and conveys
**all copyrights** of the MIDI and/or Audio Composition to Licensee" — an outright assignment
on the Pro tier, not a licence.

- **Games are named in the definitions, not just in marketing.** §1: "'**Content:** Media
  including, but not limited to, motion pictures, **video games**, tv shows, web apps, mobile
  apps, pictures and videos."
- **Survival is in the terms, not a FAQ** — the only vendor of which that is true. §2 vests
  the grant at download ("**As soon as Licensee downloads**… the type of the License granted
  … will depend on the plan that User is currently subscribed to"), and §4 reads in full:
  "Territory: the World / **Term: perpetuity**". §7 terminates only on *breach*; cancelling a
  subscription is not a breach.
- Pricing: Free €0 (AIVA owns copyright, credit required) · Standard €11/mo annual ·
  **Pro €33/mo annual + VAT** (copyright owned by you, no credit, 300 downloads/month, up to
  5 min 30 s, WAV export). A solo dev qualifies as an "Individual" under §1.
- §6 forbids "large scale upload or licensing to any third party" — aimed at bulk
  relicensing, not at shipping a score inside one game.
- "indemnif" appears **nowhere** in the EULA; §11 puts infringement risk entirely on you.

#### Suno — usable, but two traps and a deadline

[Terms](https://suno.com/terms), "Date of Last Revision: **March 26, 2026**". ⚠️ The page
carries a banner: "**Our terms are changing soon**" — the version quoted here is about to be
superseded.

- Pro/Premier: "**Suno hereby assigns to you all of its right, title and interest in and to
  any Output owned by Suno** and generated from Submissions made by you… during the term of
  your paid-tier subscription. However… **Suno makes no representation or warranty to you
  that any copyright will vest in any Output.**" Note the double limit — only Output Suno
  actually owned, and only Output made *while* subscribed.
- Free/Basic: non-commercial **and** attribution to Suno required.
- **Survival: the string "surviv" appears zero times in the document.** No survival clause, no
  clawback. An assignment is a completed transfer so it ought not lapse, but nothing says so.
  Suno's plan payload calls it "Commercial use rights for songs made while subscribed" —
  **marketing copy, not a contract term.** Weakest verified point in the whole picture.
- **Game embedding is unaddressed** — "video game", "game", "synchronization" and "standalone"
  appear nowhere. Permitted by silence, not by express grant.
- **⚠️ DEADLINE: download caps land 3 September 2026** — two weeks after this report. Suno's
  live pricing page shows "20 song downloads per month (starting 9/3/26)" on Pro and 60 on
  Premier; downloads were previously uncapped. **If Suno is to be a source, pull the library
  before then.**
- **⚠️ Never use Remix** on a track destined for the game: remixes are jointly owned and drop
  to non-commercial "regardless of whether you are a free Service tier user or a subscriber
  to a paid Service tier".
- Suno keeps a "**perpetual, irrevocable**… sublicensable… royalty-free" licence over both
  Submissions *and* Output, expressly covering "**monetization**" — so it assigns you title
  and then keeps the right to monetise the same track. And: "Output may not be unique across
  users and the Service may generate the same or similar output for a third party."
- Suno's [help-centre article](https://help.suno.com/en/articles/2746945) (edited 7 Jan 2026)
  claims "you should be the only person that is allowed to monetize those songs" — **not
  supported by the ToS**, which grants Suno a perpetual monetisation licence and disclaims
  uniqueness. The entire-agreement clause supersedes the FAQ.

#### ElevenLabs — **excluded for this game below Enterprise**

Three stacked documents govern, and **reading only the main Terms of Use gives the wrong
answer.** [Music Terms](https://elevenlabs.io/music-terms) §20 sets precedence: "**(A) the
Model-Specific Terms; (B) the Service Terms; and (C) the Underlying ElevenLabs Agreement**".

| Document | Last updated |
|---|---|
| [Terms of Service (non-EEA)](https://elevenlabs.io/terms-of-use) | 31 March 2026 |
| [Music Terms](https://elevenlabs.io/music-terms) | 26 May 2026 |
| [**Eleven Music Model-Specific Terms**](https://elevenlabs.io/eleven-music-model-specific-terms) | **26 May 2026** |

The exclusion, from the Model-Specific Terms, **§5(g)**:

> "'**Studio Games**' means video games which are **commercialised** (either by sale,
> advertising or any other forms of monetisation) and **made available for download or use
> through more than one platform.**"

The "Media Rights" row of the incorporated Music Commercial Rights table reads identically for
**Free, Starter, Creator, Pro, Scale, Business and Enterprise Music Lite**:

> "**All online and offline commercial use permitted, except film, TV, radio, & Studio Games**"

Only the top **Enterprise Music** tier reads "All online and offline commercial use
permitted". And §1(b) makes the table binding: "**Material failure to adhere to the terms and
limitations as specified in the Music Commercial Rights table for your particular plan will be
deemed a breach of your agreement with ElevenLabs.**"

**Applied to Murlan:** monetised and shipped on *both* the App Store and Google Play — squarely
a Studio Game. **Excluded on every self-serve plan up to Business at $990/month.** (A
single-platform game arguably escapes the conjunctive "more than one platform" element; that
is a narrow reading to build a product on, and this game is explicitly multi-platform.)

Everything else about ElevenLabs is good, which is what makes this a shame: you retain all
rights in Output; paid tiers need no attribution; and its **survival clause is the best in the
industry** — Model-Specific Terms §2(c): "**If you terminate your Music account or downgrade
to a lower-price plan, Output will remain available in your account subject to the plan in
effect when the Output was created.**" Rights vest at creation and are keyed to the plan you
were on; §2(b) even *retroactively upgrades* your back catalogue if you upgrade. (Caveat:
"remain available **in your account**" — download your masters.)

Post-settlement drafting is visible: §2(b) forbids prompting with any artist, songwriter,
song, album, publisher or label name, and §4(c) provides for passing through "fees…
attributable to ElevenLabs' third-party licensors" — a rightsholder royalty pass-through, and
a signal that Music pricing may rise.

#### Google Lyria — cheapest by an order of magnitude, but pointedly not indemnified

Self-serve as of Aug 2026 (no allowlist):
[docs](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/music/generate-music),
last updated 2026-08-19. Pricing is **per generation, not per second**
([Vertex AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)): **Lyria 3 Pro
$0.08/count** (full-length, ~184 s), Lyria 3 $0.04 (30 s clip), Lyria 2 $0.06.
**A full-length game loop costs eight cents.** The whole soundtrack, with heavy iteration, is a
few dollars.

Ownership, [Google Cloud Service Terms](https://cloud.google.com/terms/service-terms) (last
modified 29 July 2026): "Generated Output is Customer Data. As between Customer and Google,
**Google does not assert any ownership rights** in any new intellectual property created in the
Generated Output."

**SynthID watermarking is applied to all generated audio** — not a disclosure *requirement*,
but every track carries an inaudible, permanently machine-detectable provenance marker.

**The decisive finding:**
[Generative AI Indemnified Services](https://cloud.google.com/terms/generative-ai-indemnified-services)
(last modified 20 July 2026) lists the covered models as "Codey — Gemini — Imagen — PaLM —
**Veo**". **"Lyria" does not appear anywhere on that page. Neither does the word "music."**
So Google indemnifies AI-generated *video* and *images* but not *music* — the one modality
with the most litigious rightsholders. The training-data indemnity attaches to the broader
"Generative AI Service" but expressly "does not cover allegations related to a specific
Generated Output". Sued over how Lyria was trained → likely covered. Sued because your menu
theme resembles someone's song → on your own.

#### The rest, briefly

- **Stable Audio** — governing doc is [stability.ai/terms-of-service](https://stability.ai/terms-of-service),
  "Effective: July 31, 2025". §4(a) assigns "all of our right, title, and interest (if any) in
  the Outputs". **The word "commercial" appears zero times in the entire ToS** — the
  commercial/non-commercial tiering everyone reports is *not in the terms*. §4 is **omitted
  from the §12(e) survival list** (probably harmless, since assignment is a completed
  transfer). Pricing: Solo $12 · Session $30 · Producer $90 · Studio $199/mo. §11 makes **you**
  indemnify Stability, in capitals.
- **Mubert** — the subscription is a trap: "**time-limited**", "perpetual" appears zero times,
  and §1.2.9/§1.5 say "**You cannot use Remixes in apps or computer software.**" The pricing
  page nonetheless renders an "Apps & games" checkmark on three tiers — **a marketing artefact
  contradicted by the licence.** The real product for a game is the separate per-track
  **In-App Music License at $199/track**, which is "**perpetual**" and names "game
  soundtracks". Five loops + theme + 3 stingers ≈ **$1,800**.
- **Soundraw** — [ToS](https://soundraw.io/terms) updated 2025-06-12, Japanese law, Japanese
  text controls. Games are permitted, but the [licence page](https://soundraw.io/license) is
  disqualifying: "**If you use SOUNDRAW tracks as downloaded, you can only keep your content
  published while your SOUNDRAW subscription is active.**" Cancel and you must delist.
  Perpetuity is sold separately via API/Enterprise plans, contact-us pricing. Marketing claims
  "100 % Copyright-Safe" with **zero contractual backing** — "indemnif" appears nowhere.
- **Beatoven.ai** — [ToS](https://www.beatoven.ai/tos) "Last update: 5 June 2024", the oldest
  in the set. §6.1 grants a "**perpetual**… right **during the term of this Agreement**" —
  mutually exclusive in one sentence — and §2.1 says what survives is "**your obligations**",
  not your rights. Attribution "Music by Beatoven.ai" is **required even on paid tiers** (the
  only mandatory paid credit in this set), and §6.6 states "**Beatoven shall own and be the
  copyright owner of Your AI Music**".
- **Udio — unusable.** [Terms](https://www.udio.com/terms-of-service) "Last Revised on
  **November 12, 2025**". No tier grants commercial use; Udio "**own all right, title and
  interest in and to the Services and the Output**"; §1.2 bars downloading copies "**on any
  personal device**", which forecloses shipping audio in an app binary. The superseded
  [May 2025 terms](https://www.udio.com/old-terms-of-service-deprecated) are still public and
  make the change provable: they *had* said "you may use your Output for both personal and
  commercial purposes, and we permit you to download a copy". **There is no grandfathering
  clause.** A new §10.8 makes "**Universal International Music, B.V. and its affiliates…
  express third-party beneficiaries**" with the right to enforce the terms against you.

#### Copyrightability — what the US Copyright Office actually held

*Copyright and Artificial Intelligence, Part 2: Copyrightability*, signed by Register Shira
Perlmutter, **29 January 2025**
([PDF](https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf)).
Conclusions, verbatim from the Executive Summary (p. iii):

> "• The use of AI tools to assist rather than stand in for human creativity does not affect
> the availability of copyright protection for the output.
> • **Copyright does not extend to purely AI-generated material, or material where there is
> insufficient human control over the expressive elements.**
> • **Based on the functioning of current generally available technology, prompts do not alone
> provide sufficient control.**
> • Human authors are entitled to copyright in… **the creative selection, coordination, or
> arrangement of material in the outputs, or creative modifications of the outputs**."

§II.D (p. 18): "**Prompts essentially function as instructions that convey unprotectible
ideas**"; and iterating doesn't help — "Repeatedly revising prompts does not change this
analysis… copyright protects original authorship, not hard work."

**The clause that answers the game-dev question directly**, §II.F:

> "**the inclusion of elements of AI-generated content in a larger human-authored work does not
> affect the copyrightability of the larger human-authored work as a whole.** For example, **a
> film that includes AI-generated special effects or background artwork is copyrightable, even
> if the AI effects and artwork separately are not.**"

**Series status** (verified at [copyright.gov/ai](https://www.copyright.gov/ai/)): Part 1
Digital Replicas 31 Jul 2024; Part 2 Copyrightability 29 Jan 2025; **Part 3 Generative AI
Training — pre-publication only, 9 May 2025**, with no substantive changes expected. **As of
2026-08-20 there is no Part 4 and no final Part 3.**

**What this means in practice — and the distinction most people get wrong.**
Copyrightability is *not* permission to use; they are separate questions.
- **You can ship it.** Non-copyrightability doesn't stop commercial use. That is governed by
  your contract with the vendor and by whether the output infringes someone else.
- **What you lose is the ability to stop others copying it.** A purely prompt-generated menu
  theme is likely in the public domain — a Murlan clone could lift the file out of your bundle
  and you would have no copyright claim. Low stakes for a background loop; real if you ever
  want to sell the soundtrack or enforce against a clone.
- **The game as a whole stays protected** — the film-with-AI-VFX analogy applies directly.
- **Human editing can cross the line**, but not by prompting harder: re-arranging, layering,
  live overdubs, real DAW work on the loop.
- **Registration requires disclosure** of more-than-de-minimis AI material and a description of
  the human contribution (2023 AI Registration Guidance, 88 Fed. Reg. 16,190).

#### The litigation, and why it is a live operational risk

- **UMG × Udio, 29 October 2025** —
  [press release](https://www.prnewswire.com/news-releases/universal-music-group-and-udio-announce-udios-first-strategic-agreements-for-new-licensed-ai-music-creation-platform-302599129.html).
  Settles the suit, adds licences, new platform "in 2026" trained on "authorized and licensed
  music", existing creations "controlled within a walled garden". **In practice Udio disabled
  downloads entirely on 29–30 Oct 2025 with no prior notice**; after backlash it reopened a
  48-hour download window from 3 Nov 2025 *(secondary sources — Billboard, Rolling Stone)* and
  compensated subscribers with credits. The 12 Nov 2025 terms revision is the contractual
  expression of all of it, with no grandfathering.
- **Warner × Suno, 25 November 2025** — Warner settled and licensed its catalogue. "When the
  new models launch in 2026, the current models will be deprecated", and "**Moving forward,
  downloading audio will require a paid account**" with monthly caps — which is exactly the
  3 Sept 2026 cap now live on Suno's pricing page *(via MBW reproducing the release)*.
- **Still live:** **UMG and Sony have NOT settled with Suno** (D. Mass.). Per MBW, 12 May 2026,
  both remain plaintiffs; a magistrate denied them access to Suno's Warner settlement terms on
  6 April 2026 and Suno responded 4 May 2026. No trial date reported. **Koda** (Denmark) and
  **GEMA** (Germany) continue separate claims against Suno.

**The pattern that matters:** in both settlements the labels bought *control of the product*,
and downstream users' rights narrowed as a side effect — Udio's overnight and retroactively,
Suno's on a notice period running right now. **The vendor can revoke your ability to retrieve
your own assets at any time, and Udio proved it will do so without warning.** Whatever you
generate, download and archive the masters immediately.

#### App-store policy and disclosure

Apple's [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
**5.2**: "Make sure your app only includes content that you created or that you have a license
to use." **5.2.1**: "Don't use protected third-party material… without permission… Apps should
be submitted by the person or legal entity that owns or has licensed the intellectual
property." **No guideline mentioning AI-generated content was found**, and no page
last-updated date was visible. Google Play **does** have an *AI-Generated Content* policy —
item 10 under Restricted Content on the
[developer policy centre](https://support.google.com/googleplay/android-developer/answer/9876937) —
but **its text and effective date could not be read**, and in particular whether it reaches an
app that merely *ships* pre-generated audio versus one that generates at runtime is **open**.
Neither store was found to require disclosure of AI-generated music nor to forbid it; both are
**unverified negatives.**

**EU AI Act — nothing bites on this developer.** Reg. (EU) 2024/1689, amended by
**Reg. (EU) 2026/1744** ("Digital Omnibus on AI", OJ 24 July 2026, in force 27 July 2026,
CELEX 32026R1744) — which pushed only the *high-risk* dates and left **Article 50 transparency
on its 2 August 2026 date**. Art. 50(2) puts the synthetic-audio marking duty on **providers**
(Suno, Stability), not you. Art. 50(4) applies to *deep fakes*, defined in Art. 3(60) as
content "that **resembles existing persons, objects, places, entities or events** and would
falsely appear… to be authentic" — instrumental background music is not one. Art. 53 /
Annex XI–XII training-data transparency binds "**Providers of general-purpose AI models**".
Once the app ships it contains no AI system, so you are neither provider nor deployer.
**Disclosing AI use to players is a voluntary trust choice, not compliance** — the only legal
exposure is affirmatively claiming the music is human-composed when it is not.

**Albania: no binding AI law in force as of Aug 2026.** NAIS/AKSHI published a **draft** law
*"Për Inteligjencën Artificiale"* for public consultation on **29 May 2026** (106 articles,
expressly transposing Reg. 2024/1689); still open in July 2026, no adoption found.
*(Convergent secondary sources — Boga & Associates, SCiDEV, CMS — because Albania's official
gazette was not reachable.)* No applicable US disclosure rule either; the FTC Endorsement
Guides are scoped to paid endorsements and never mention AI.


### 3e. Commissioning a human composer

**No primary 2026 rate card was reachable.** The G.A.N.G. survey URL 404'd, Game Developer's
audio archive carried no pricing, and Reddit is not fetchable from this environment. The
`$1.5k–5k` figure in the Bottom line is an **estimate, not a sourced fact**, and should be
replaced with real quotes before it enters a budget.

What *is* verified and useful:

- **The Balatro precedent for sourcing.** LocalThunk found composer **LouisF (Luis Clemente)**
  on **Fiverr in 2023**, briefed him with reference tracks (*Risk of Rain 2* plus an old
  unpublished LouisF theme), and got the whole five-track score. A solo dev hiring a
  freelance composer off a marketplace produced one of the most recognisable game
  soundtracks of the decade. That is a proven, cheap model.
- **Rights to insist on:** a full buyout / work-for-hire assignment covering all media in
  perpetuity, worldwide, for the game and its marketing, with the right to sub-license to
  the app stores. The alternative — a licence with the composer retaining publishing and
  registering with a PRO — leaves per-territory obligations that a solo developer should not
  take on. **The customary buyout premium was not verified.**
- **Places to look** (existence not individually re-verified in this pass): Fiverr /
  Fiverr Pro, SoundBetter, Airgigs, Soundtrack.net's job board, game-audio Discords,
  r/gameDevClassifieds.
- **Finding an Albanian instrumentalist:** not verified. See §6 for the leads that were found.

### Ranked: cost against legal safety

| # | Source | Safety for in-game commercial use | Cost | Verified? |
|---|---|---|---|---|
| 1 | **AudioJungle Music Mass Reproduction** | High — perpetual, worldwide, names "apps" and "downloaded games", unlimited copies | per track, **price unverified** | ✅ licence text |
| 2 | **Soundstripe single-use "Expanded"** | High — names "gaming platforms", one-time, no lapse risk | **$399+/track** | ✅ |
| 3 | **Commissioned composer, full buyout** | Highest — you own it, and it's the only route to an Albanian identity | est. $1.5k–5k *(unverified)* | ⚠️ rates unverified |
| 4 | **Sonniss GDC bundle** *(SFX only, no music)* | High — free, no attribution, unlimited projects, lifetime | **free** | ✅ |
| 5 | **Epidemic / Artlist / Musicbed Enterprise** | High once contracted — but custom quote, no self-serve price | unknown | ✅ (the *exclusion* is verified) |
| 6 | **Pixabay** | Medium-high — no attribution, but read the full terms on "standalone" | free | ✅ summary |
| 7 | **Freesound CC0 / Kenney CC0** | High legally, **weak fit** — polished loopable music is scarce | free | ✅ |
| 8 | **Incompetech CC-BY** | High if credited in-app; paid no-attribution tier exists | free / price unverified | ⚠️ partial |
| 9 | **Envato Elements, PremiumBeat, Storyblocks, Bensound, Uppbeat** | **Unknown** | unknown | ❌ all fetches blocked |
| 10 | **OpenGameArt** | Risky — mixed licences, unverifiable uploader claims, CC-BY-SA copyleft | free | ⚠️ |
| 11 | **Free Music Archive** | Risky — CC-BY-NC tracks are a commercial-use trap | free | ⚠️ |
| 12 | **Unity Asset Store audio** | **Probably unusable outside Unity** — treat as excluded until confirmed | n/a | ❌ EULA 403'd |

**AI generation** (§3d) ranks separately, because the licence risk and the copyright risk are
different axes. On *licence* safety for this specific game the order is:
**AIVA Pro €33/mo** (assignment, perpetuity, games named) → **Mubert In-App $199/track**
(perpetual, game soundtracks named) → **Suno Pro $10/mo** (assignment, but no survival clause
and a 3 Sept 2026 download cap) → **Google Lyria $0.08/track** (cheapest by far, no
indemnity) → **Stable Audio** (assignment, but no commercial tiering in the terms at all) →
**Soundraw / Beatoven** (must stay subscribed / vendor owns the copyright) →
**ElevenLabs** (excluded below Enterprise Music) → **Udio** (no commercial use on any tier).
On *copyright* the whole column is equal and weak: prompt-only output is not protectable, so
none of it can carry a title's identity the way a commissioned score can.


---

## 4. What music a card game actually needs

### Comparables

**Balatro** (LocalThunk, 2024) — the closest structural model, and unusually well documented:
- **5 tracks**: Main Theme (menus + small/big blinds), Shop, Arcana, Celestial, Boss
  ([balatrowiki.org/w/Music](https://balatrowiki.org/w/Music),
  [Album of the Year](https://www.albumoftheyear.org/album/881784-luis-clemente-balatro-soundtrack.php)).
- **All in 7/4**, sharing compositional DNA — related, not identical.
- **Composed at 2:53, delivered slowed to 70 % → 4:07 in-game.** A deliberately under-tempo,
  stretched loop measurably reduces fatigue over long sessions. This is the single most
  transferable technique in this section.
- The boss-blind variation is **not** a stem-based adaptive system: it is the *currently
  playing track* pitched/tempo-shifted down with drums pushed forward, reverting at menu.
  A DSP state change, essentially free to implement.
- **No GDC talk by LocalThunk or LouisF on the music was found** — flagged as likely
  non-existent rather than missed.

**Hearthstone** (Blizzard, composer Peter McConnell) — his *first* score was musically fine
and wrong for the game; after watching playtesters he rebuilt it around
**"a bar fight waiting to happen"** rather than whimsical fantasy
([petermc.com/about](https://www.petermc.com/about/)). Blizzard's own
[Inside Battle.net piece on the Hearthstone sound team](https://news.blizzard.com/en-us/hearthstone/23964694/inside-battle-net-meet-the-sound-team-behind-hearthstone-s-harmonic-design)
describes designing each expansion's new music and stingers to sit *underneath* the
established tavern bed. Structurally: **new music per expansion, not per match.** No GDC talk
on Hearthstone audio was found.

**Marvel Snap** (Christopher Alan Grabar) — Vol. 1 was **11 tracks / 21 minutes (2022)**,
growing to a Vol. 3 (13 tracks, 2025). For a 3-minute-match mobile game, ship scope was small
and grew with content ([Apple Music](https://music.apple.com/us/album/marvel-snap-original-video-game-soundtrack/1656822160)).

**Slay the Spire** (Clark Aboud) — **25 tracks / 53 minutes**, released 15 Jun 2018, organised
per act ([Bandcamp](https://clarkaboudmusic.bandcamp.com/album/slay-the-spire-original-soundtrack)).
Runs are 45–90+ minutes. **Not a comparable for a short-burst game** — included to show what
scope Murlan should *not* copy.

**Card Shark** (Andrea Boccadoro, 29 tracks) and **Inscryption** (Jonah Senzel, 30 tracks) are
narrative games; their track counts are not transferable.

**Solitaire / casual card apps and backgammon-tavla apps** — the observed pattern is a short
lo-fi or ambient loop with an always-available music-off toggle. Several tavla apps treat
sound as an afterthought entirely. **No major tavla app was found treating music as a core
identity feature** — which is an opening for Murlan rather than a template.

### The muting statistic

**TapResearch, 18 May 2022**, 2,400 census-balanced mobile gamers: **91 % play with sound
off**; 8 % sound on; 60 %+ multitask with other audio
([blog.tapresearch.com](https://blog.tapresearch.com/how-sound-preferences-impact-player-engagement)).
A 2013 Appington/TouchArcade survey found the reverse (73 % sound **on**)
([toucharcade.com](https://toucharcade.com/2013/11/05/73-of-mobile-gamers-play-with-the-sound-on/)) —
useful only as evidence the trend reversed over a decade.

Both are single surveys and the numbers conflict; the defensible conclusion is that **a large
and probably majority share of players never hear the music.** Two design consequences:
1. **No state information may live in the music.** The urgent tick, "your turn" and the bomb
   must remain readable with music off *and* with all sound off — visually, and via haptics.
2. **Music gets its own toggle.** `SettingsContext` currently exposes `soundsEnabled` and
   `soundVolume`, and `SettingsModal` renders them as a toggle plus a `Segmented` volume.
   Music needs a **parallel pair** — a player who wants card clicks but no soundtrack is the
   normal case, not an edge case. That means new keys in `locales/en.ts`, `it.ts` and
   `sq.ts` (CLAUDE.md: every key in English must exist in every locale).

Writing on "when a game should be silent" — the sources found (the Wayline.io series) read as
SEO content, not GDC-grade authority. **No canonical primary source on strategic silence was
found**, so the argument below stands on the comparables, not on a citation.

### Minimum credible set for Murlan

1. **Menu / lobby loop**, ~2–3 minutes as heard. Balatro's compose-short-then-slow trick is a
   cheap way to buy length without the loop announcing itself.
2. **In-hand bed**, deliberately thin — a drone plus a light rhythmic figure that can run
   under decision time without fighting the twelve SFX. This is the track that should be
   *nearly nothing*, so a *manche* played in near-silence still feels intentional.
3. **Win / end-of-*partita* cue**, 10–20 s, not a loop. Note the existing `game_win` and
   `game_lose` arpeggios in `assets/sounds/` are synthesised from a struck-glass sample and
   would be superseded here.
4. **Tension variant for the last cards of a hand** — realised Balatro-style as a
   pitch/tempo shift of (2), not a fourth composition. Nearly free.
5. **A hard, always-reachable mute.** Table stakes, per the statistic above.

That is roughly Marvel Snap's original ship scope, and about a fifth of Slay the Spire's.

---

## 5. Audio production standards for mobile games in 2026

### Loudness

- **Measurement:** ITU-R **BS.1770-5** (Oct 2023) defines the LUFS algorithm. **EBU R128**
  targets **-23 LUFS** — a *broadcast* target, far too quiet for a game.
- **Game targets:** there is no ISO-style body for games. The nearest authorities are console
  platform TRCs (NDA-gated, inaccessible) and G.A.N.G.'s IESD mix reference levels. Multiple
  independent secondary sources converge on **-24 LUFS integrated for console** (attributed to
  Sony's ASWG) and **-16 LUFS integrated for portable/mobile** — mobile is louder because
  phones are played in noisy environments.
  **⚠️ The primary documents could not be fetched** (AES TD1004.1.15-10 404'd; the G.A.N.G.
  IESD PDF returned unparseable binary). **These two numbers are the least-verified facts in
  this report.**
- **Recommendation:** target **-16 LUFS integrated** on the combined music+SFX bus, with a
  **-1 dBTP** true-peak ceiling (standard across EBU R128 and ATSC A/85 to leave headroom for
  inter-sample peaks after lossy decode).
- Individual game assets are far shorter than the EBU measurement window, so per-asset
  practice uses **short-term loudness / max short-term in a 400 ms–3 s window** rather than
  integrated LUFS. Measure the session, not the 200 ms UI blip.
- For contrast only, not as targets: Spotify -14, YouTube -14, Apple Music Sound Check -16.

### Mono vs stereo — this contradicts the current build

G.A.N.G.'s
[Game Audio Basics: File Formats and Mono vs. Stereo](https://www.audiogang.org/game-audio-basics-file-formats-and-mono-vs-stereo/)
(Jack Menhorn, **28 Oct 2013** — note the age) frames the decision as **positional, not
SFX-vs-music**: stereo for "2D sounds" (music, UI, non-positional ambience, the player's own
effects); mono for "3D sounds" the engine must pan and attenuate by position.

Murlan is a 2D table with UI-triggered, non-positional effects. By that rule the twelve
effects **should be stereo**, not mono — the current 44.1 kHz **mono** MP3 pipeline in
`scripts/build-sounds.mjs` is optimising for a constraint the game does not have. In practice
the sources are mono recordings and duplicating them to two channels buys nothing but bytes,
so the honest conclusion is narrower: **mono is not wrong here, but "mono because it's an
SFX" is the wrong reason.** A future stereo card-slide with a hint of left/right per seat
would be a real improvement, and the current pipeline forecloses it.

### Sample rate — a concrete change to make

Modern **iOS** hardware runs a fixed **48 kHz** clock; Core Audio resamples anything else.
Modern **Android**'s AAudio/Oboe low-latency path is natively **48 kHz**, and only 48 kHz gets
the guaranteed fast path. Browsers instantiate `AudioContext` at the hardware rate, typically
48000.

The shipped assets are **44.1 kHz**, so **every effect is resampled on every platform at play
time.** Small cost, but free to avoid: encode new assets at 48 kHz.
*(Both platform claims come from developer-forum and NDK-issue consensus rather than a single
quotable Apple/Google statement — flagged.)*

### Formats — and why music must not be MP3

**Safari decode support, verified against WebKit's own release notes:**

| Format | Supported since |
|---|---|
| MP3, AAC (M4A) | long-standing |
| **Opus in WebM / MPEG-4** | **Safari 17.0, macOS Sonoma, Sept 2023** — "Safari 17.0 on macOS Sonoma adds support for one or two channel Opus audio in WebM and MPEG-4 containers" ([webkit.org/blog/14445](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)) |
| **Opus and Vorbis in Ogg** | **Safari 18.4, 31 Mar 2025** (macOS 15.4, iOS/iPadOS 18.4, visionOS 2.4) — "WebKit for Safari 18.4 rounds out our support for media formats by adding Ogg container support for both Opus and Vorbis audio" ([webkit.org/blog/16574](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)) |

Chrome/Android has decoded all of these for years. As of Aug 2026 both Opus paths are safe on
current Safari — but **Ogg Opus is only ~17 months old on iOS**, so a device frozen before
spring 2025 gets MP3/AAC (or WebM Opus if on 17.0+) and nothing else.

**The gapless-loop problem — this is why the music format matters.** Per
[compuphase.com/mp3/mp3loops.htm](https://www.compuphase.com/mp3/mp3loops.htm): MP3 stores
audio in fixed 1152-sample frames, the encoder must pad the final frame with silence, LAME
adds **576 samples of encoder delay**, there is a further ~**529-sample decoder delay**, and
the MDCT/bit-reservoir design makes each frame depend on its predecessors. The LAME/Xing
`enc_delay`/`enc_padding` headers and Apple's `iTunSMPB` tag *can* let a smart decoder strip
this — but **browsers' `decodeAudioData` and `<audio>` do not reliably honour that metadata**,
so an MP3 loop audibly clicks in Chrome, Firefox and Edge. AAC has analogous priming samples
but is reported to loop cleanly in Chrome; **no spec-level guarantee was found.** Opus defines
its pre-skip explicitly and is designed for gapless; WAV has no frame boundaries at all.

**Recommendations:**
- **Short one-shot SFX:** MP3 is fine — they never loop, and ~121 KB for twelve files is
  already negligible. AAC/M4A is a safe drop-in if the pipeline changes anyway. **No urgent
  reason to touch what works**, beyond the 48 kHz change.
- **Looping music:** **Ogg/WebM Opus, ~96 kbps stereo.** AAC ~128 kbps as the fallback for
  pre-18.4 iOS.
- **Regardless of codec, do not trust `loop = true`.** Decode the loop once and schedule each
  repetition with sample-accurate `AudioBufferSourceNode.start(when)` arithmetic off
  `AudioContext.currentTime`. That neutralises the codec question entirely — and
  `lib/sounds.ts` already owns the `AudioContext` needed to do it.

### Memory and payload

`decodeAudioData` yields non-interleaved **float32** PCM. A 2-minute stereo track at 44.1 kHz:

```
120 s × 44,100 = 5,292,000 frames
5,292,000 × 2 channels = 10,584,000 samples
10,584,000 × 4 bytes = 42,336,000 bytes ≈ 40.4 MiB
```

At 48 kHz that is ≈ **46.1 MiB per fully decoded track**. That number is the whole argument
for streaming long music instead of decoding it.

**Streaming vs decoding.** MDN's
[Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
states plainly that `MediaElementAudioSourceNode` is "more common… when you are working with
full-length tracks", and `decodeAudioData`/`AudioBufferSourceNode` "when working with shorter,
more sample-like tracks"; media elements have "streaming support out of the box".

**The architecture that follows:**
- Keep the twelve SFX on `decodeAudioData` → `AudioBufferSourceNode`. Already correct.
- Route background music as `HTMLAudioElement` → `MediaElementAudioSourceNode` → **GainNode**
  → destination, on the same `AudioContext`. Streaming (no 40 MB decode), and the GainNode is
  what makes ducking and fades possible — including on iOS Safari, where
  `HTMLMediaElement.volume` is a no-op.
- **Exception:** for a genuinely short bed (30 s – 2 min) where seamless looping is
  non-negotiable, decode it and schedule the loop manually; ~10–20 MiB is an acceptable
  trade for guaranteed gaplessness.
- **Lazy-load:** menu music eagerly behind the tap gate (small, needed at once); in-game
  music on demand once a table opens, by which point the context is warm and gestured.

Recommended bitrates: **Opus 64–96 kbps stereo** for music (96 is the commonly cited web
sweet spot); AAC ~128 kbps as fallback. A total audio payload in the low hundreds of KB
remains realistic even with four music tracks.

---

## 6. The cultural angle — can it read as Albanian?

### The musical material (enough to write a composer brief from)

**Northern / Gheg** (north Albania, Kosovo, southern Montenegro) — instrumental and epic:
- **Çifteli** — two-string long-necked lute, the signature northern instrument, typically
  tuned **B3/E4**. Narrative and heroic accompaniment.
- **Lahutë** — one-string bowed lute, used for sung epic narrative (*kângë kreshnike*):
  declamatory, rhythmically free.
- **Sharki** — a related plucked lute. **⚠️ Sources contradicted each other** — one described
  it as a wind instrument akin to a clarinet. Verify before it goes into a brief.
- **Def** (frame drum), **fyell/kavall** (flute) for accompaniment and ornament.

**Southern / Tosk and Lab** — vocal, not instrumental: **Albanian iso-polyphony**, sung
unaccompanied in defined roles — **marrës** (taker/lead), **kthyes** (turner/responder),
**iso** (the sustained drone) and, in four-part Labëria style, **hedhës**. Verified against
the [UNESCO page](https://ich.unesco.org/en/RL/albanian-folk-iso-polyphony-00155): "songs
consisting of two solo parts, a melody and a countermelody with a choral drone"; the *iso*
name derives from Byzantine church terminology; **Tosk** groups hold a continuous drone on the
vowel *e* with staggered breathing, while **Lab** practice sometimes renders the drone
rhythmically on the song text.

**Kaba** — the instrumental descendant of iso-polyphony: solo clarinet or violin over a *saze*
ensemble, rooted in southern lament (*vajtim*); free, heavily ornamented, non-metric
([Kaba](https://en.wikipedia.org/wiki/Kaba_\(Albanian_music\))). Notable players: clarinettist
**Laver Bariu**, violinist **Ethem Qerimaj**.

**Rhythm.** Asymmetric *aksak* metres — **7/8 (2+2+3)**, **9/8 pogonishte (2+2+2+3)**, 5/8,
11/8 — are common. **Note the honest caveat:** this is the wider **Balkan** rhythmic
vocabulary, not a uniquely Albanian trait. Melodic character (modal scales, augmented
seconds, melisma with Ottoman/Byzantine-adjacent colour) came from lower-authority sources
and is **directionally right but not scholarly-verified.**

**UNESCO status, verified:** proclaimed a Masterpiece of the Oral and Intangible Heritage of
Humanity in **2005**; inscribed on the Representative List in **2008**; reference **00155**.

### Licensing reality — the answer is "commission it"

- **UNESCO ICH page** — photographs carry "© Vasil S. Tole"; **no open-reuse licence
  anywhere on the page.** Not usable.
- **Internet Archive** hosts *Folk Music of Albania* (**Topic Records, LP 12T154, 1966**) with
  **no rights statement at all**. Topic Records is a still-active UK label. "Hosted on
  Internet Archive" ≠ "cleared for reuse." Assume in copyright.
- **Europeana** supports open rights statements as a platform feature, but **no specific
  Albanian folk item under CC0 was confirmed** — the search URL returned 403 to automated
  fetching. **Genuinely unverified; worth a manual search.**
- **Smithsonian Folkways** holds Albanian material; **all masters require a paid sync
  licence** through their licensing office, plus separate publisher permission. A commercial
  path, not a free one.
- **British Library Sounds** — the **Oct 2023 Rhysida ransomware attack** took down BL
  systems, with the sound archive named among the slower-recovering services. **Current 2026
  status unverified.**
- **IAKSA** (Instituti i Antropologjisë Kulturore dhe Studimit të Artit, Tirana) — real,
  active, successor to the 1947 Folklore Institute, ~30,000 objects, active digitisation. A
  plausible partner, but **no self-service licensing portal**; requires direct outreach
  (iaksa.edu.al).
- **RTSH / RTK archives** — not researched. Unverified.

**The rule that decides it.** In the **EU**, sound recordings get **70 years of related-rights
protection from publication** (Directive 2011/77/EU, extended from 50 in 2011), separate from
any copyright in the composition or arrangement. In the **US**, the **Music Modernization Act
(2018)** federalised pre-1972 recordings on a sliding scale — recordings from **1957 to Feb
1972 stay protected until 2067**.

So: a traditional *melody* may well be public domain; **any recording of it almost certainly
is not.** The safe, standard path is exactly the obvious one — **commission a new arrangement
and a new recording.**

**The trap, with a concrete example.** *"Baresha"* ("The Shepherdess"), widely treated as
Kosovar Albanian folk material, was **composed by Rexho Mulliqi** with lyrics by **Rifat
Kukaj**, first performed c. 1970 by **Nexhmije Pagarusha**. Streaming metadata even lists it
as "[traditional]" alongside the named composer. Many "folk" songs have known 20th-century
authors and are still in copyright. Every candidate melody needs its authorship checked.

### Sample libraries (so a composer can actually play a çifteli)

| Library | 2026 price | Licence position |
|---|---|---|
| **Impact Soundworks** (any) | varies | **Best verified EULA of the three.** [Combined licence](https://impactsoundworks.com/combined-license-agreement-privacy-policy/) (last updated 4 Dec 2014) explicitly names **video game soundtracks** among permitted commercial uses; royalty-free. Prohibits building a competing sample library and reselling individual sounds on stock-audio marketplaces. |
| **Sonokinetic** | varies | [Licence](https://sonokinetic.net/support/license-agreement) restricts use to "musical arrangements, compositions and/or productions with multiple musical audio layers" and **forbids use as isolated/standalone sounds** — fine for a scored music track, **not** for lifting a sample as a raw SFX one-shot. |
| **Strezov Sampling — BALKAN Ethnic Orchestra** | **€406.80 inc. 20 % VAT** (verified on the product page) | "over 40 of the finest Ethnic Folklore Soloists" — winds, bowed and plucked strings, a full Balkan brass band, ethnic percussion, vocal quartet. **The page does not name çifteli, sharki, lahutë, def, kaval, gajda, zurna or tapan individually, and carries no commercial/game licence statement.** Requires Kontakt Player 5.7.1+, ~50 GB, 16 GB RAM. **Email support before buying.** |
| **Best Service — Ethno World 7 Complete** | €399 / $399 | 382 instruments, 1,000+ patches. Nearest string relatives listed are balalaika and bouzouki; **no Albanian-specific content confirmed, licence terms not fetched.** Unverified. |
| **Native Instruments Discovery Series** | varies | Packs exist for Middle East, East Asia, India, Cuba, West Africa, Ireland, Balinese Gamelan — **no Balkan or Albanian pack exists.** *Middle East* gives generic "Eastern" colour, not Albanian authenticity. |
| **Decent Samples çifteli** for the free Decent Sampler | **$10** | A very cheap way to prototype a çifteli line before committing to a session player. **EULA not readable (403) — verify before shipping.** |

### Composers and players

Leads only — **none confirmed as taking game-music commissions:**
**Rauf Dhomi** (Kosovar; operas, film and theatre scores — closest to relevant screen
credits), **Mendi Mengjiqi** (wrote Kosovo's national anthem), **Fahri Beqiri** (University
of Pristina), **Akil Mark Koci**.

The more practical route is the Balatro route: post a brief on a composer marketplace
specifying *çifteli, Albanian folk idiom, 7/8*, and audition the replies. Whether a çifteli
or lahutë session player can be found and hired on those marketplaces was **not verified.**

### Is there a credible path to "Albanian rather than generic-casino"?

Yes, and it is not expensive. The instrumentation alone does most of the work: a **çifteli
ostinato** over a **sustained iso-style drone**, in **7/8**, with a **def** underneath, is
unmistakably not a Vegas card table — and it is achievable from a $10 sampled çifteli plus a
competent arranger, well before any field recording or archive licence enters the picture.
The distinctive part is cheap; the authentic *recording* is the expensive part, and it is
optional.

---

## 7. Haptics

**`expo-haptics`** — current npm version **57.0.1** (2026‑07‑15); this repo pins **~15.0.8**
(the SDK 54 line). API per the [official docs](https://docs.expo.dev/versions/latest/sdk/haptics/):
- `impactAsync(style)`: `Light | Medium | Heavy | **Rigid** | **Soft**` — `lib/haptics.ts`
  currently wraps only Light/Medium/Heavy. `Soft` and `Rigid` are unused and are exactly the
  vocabulary a card game wants (a *soft* card select, a *rigid* rejection).
- `notificationAsync(type)`: `Success | Warning | Error` — all three already wrapped.
- `selectionAsync()` — wrapped.
- `performAndroidHapticsAsync(type)` — Android-only, maps to `HapticFeedbackConstants` /
  `VibrationEffect` composition **without needing the `VIBRATE` permission**. Types include
  `Clock_Tick, Confirm, Reject, Toggle_On/Off, Segment_Tick, Long_Press, Virtual_Key`… Expo's
  docs state the raw Android `Vibrator` API "is no longer recommended". **Not used here** —
  `Reject` and `Clock_Tick` map naturally onto the play-rejection shake and the urgent tick.

**Web — and a version-specific catch.** `expo-haptics` on web does **not** simply no-op. Per
[`ExpoHaptics.web.ts`](https://github.com/expo/expo/blob/main/packages/expo-haptics/src/ExpoHaptics.web.ts)
on `main`, it calls `navigator.vibrate()` with per-style patterns (`Light: [40]`,
`Heavy: [60]`, `Success: [40,100,40]`, `Error: [60,100,60,100,60]`), and — since
**`expo-haptics@55.0.12`, 6 Apr 2026** ([PR #44261](https://github.com/expo/expo/pull/44261),
Evan Bacon) — falls back on iOS Safari to creating a hidden `<input type="checkbox" switch>`
and clicking it programmatically, exploiting iOS's native switch-toggle haptic.

**This app is on the SDK 54 line, which predates that fix.** Two consequences:
1. On iOS Safari today it would do nothing regardless — but
2. `lib/haptics.ts` guards every call with `const isNative = Platform.OS === "ios" || "android"`,
   so **web haptics are switched off in this codebase by construction.** Upgrading
   `expo-haptics` past 55.0.12 *and* relaxing that guard would give iPhone web players real
   haptic feedback. Given most users play on the web build, that is a cheap, real win.

**Vibration API status, 2026.** [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate)
flags it "Limited availability — not Baseline". Per
[caniuse](https://caniuse.com/mdn-api_navigator_vibrate): Chrome 32+, Edge 79+, Firefox
(partial/variable), Android Browser 4.4+, Chrome for Android, Samsung Internet. **Safari
desktop: unsupported in every version 3.1–27. Safari iOS: unsupported in every version
3.2–26.6.** Requires **sticky user activation**, and devices may ignore it in Silent/DND.
So on the web build: Android gets real vibration, iOS gets nothing without the checkbox trick.

**Audio-synced haptics.** No official Expo or RN wrapper for Apple's `CHHapticEngine` / AHAP
files was found; `expo-haptics` exposes only the discrete `UIImpactFeedbackGenerator`-level
styles, not custom patterns. The third-party option is **`react-native-haptic-feedback`**,
npm **3.0.0** (2026‑03‑29), peers `react >=18`, `react-native >=0.71.0`, which rebuilt its iOS
module on Core Haptics and supports named `.ahap` files and custom `HapticEvent` sequences via
`triggerPattern`. **Its Expo dev-client / config-plugin / New Architecture story could not be
verified** (npm 403'd).

**Best practice for pairing with audio.** Apple's Core Haptics guidance recommends the
`CHHapticEngine(audioSession:)` initialiser so haptic-triggered audio follows the app's
`AVAudioSession` policy, and reports no significant latency between simultaneous AHAP players.
**Secondary-sourced — developer.apple.com was not fetched directly.**

**What this project already gets right.** CLAUDE.md records that *"impact feedback is timed to
the card landing, not the throw"*, with `impactDelayMs()` in `components/gameTableModel.ts` as
the single place the delay is derived. That is the correct discipline and is precisely what
keeps the haptic and the sound from drifting apart — any music/ducking work must not
introduce a second timing source.

---

## What could not be verified

**Blocking or missing sources**

- Subscription-library licence texts for **Envato Elements**, **PremiumBeat / Shutterstock
  Music**, **Storyblocks**, **Bensound** and **Uppbeat** — every fetch returned 403 or 404.
  Nothing about their in-app/in-game position, 2026 prices or post-cancellation survival is
  asserted. (Epidemic Sound, Artlist, Soundstripe, Musicbed and Pixabay **were** verified —
  see §3a.)
- **AudioJungle per-track pricing** (403) — the licence *structure* is verified, the numbers
  are not.
- **Epidemic Sound and Musicbed self-serve prices** — JS-rendered / signup-gated.
- **Unity Asset Store EULA** (403 on both URLs) — the "Unity projects only" restriction is
  *believed* but **not verified**.
- **Udio** terms (login wall) — including the reported UMG settlement and any resulting
  product/terms change. Nothing about Udio is asserted.
- **ElevenLabs "Eleven Music v1 Terms"** — the operative music document. Its page
  (`/eleven-music-v1-terms`) returns **404** although the page linking to it loads fine. The
  reported "Studio Games" exclusion from self-serve tiers is **unconfirmed**; so are the
  music tier list, ownership grant and effective date. See §3d.
- **Stable Audio** commercial terms, tiers, indemnification, survival — the fetched Stability
  page is site terms only.
- **US Copyright Office Part 2** conclusions — the report *dates* are verified from
  [copyright.gov/ai](https://www.copyright.gov/ai/); the substantive holdings were not read
  from the PDF.
- **Google Play's AI-Generated Content policy** text and effective date — the policy exists
  (item 10, Restricted Content) but its requirements were not readable.
- **Apple guideline last-updated date** — not shown on the fetched page. No AI-specific
  guideline was found, which is a negative result, not a confirmation of absence.
- **EU AI Act** duties on a downstream game developer — not researched.
- **2026 composer rate cards** — G.A.N.G. survey URL 404'd, Game Developer archive carried no
  pricing, Reddit is unfetchable. **The $1.5k–5k package figure is an estimate, not a fact.**
- **Incompetech's paid Standard License price** — not on the FAQ page.
- **Europeana** Albanian-folk search (403) — whether any item is CC0 is genuinely open.
- **British Library Sounds** current post-ransomware status.
- **RTSH / RTK** archive access and licensing.
- **Strezov BALKAN** exact instrument list and game-specific EULA; **Best Service Ethno World
  7** licence terms; **Decent Samples çifteli** EULA (403).
- Whether the named Kosovar/Albanian composers accept game-music commissions.
- Whether a çifteli or lahutë session player is findable on Fiverr / SoundBetter / Airgigs.

**Facts held with low confidence**

- **-24 LUFS console / -16 LUFS portable.** Converged across independent secondary sources;
  neither the AES document (404) nor the G.A.N.G. IESD PDF (unparseable) was read. Platform
  TRCs are NDA-gated. **This is the least-verified number in the report and it is the one a
  mastering spec would be built on.**
- **iOS/Android native 48 kHz.** Consistent across Apple developer-forum threads and Android
  NDK/Oboe issues; no single quotable Apple or Google statement was found.
- **Whether Safari's silent-buffer unlock hack is still strictly required** on 26.x — field
  reports through 2025 say relocking still occurs; no WebKit changelog declares it fixed. The
  mute-switch/ambient-category behaviour *is* confirmed by a WebKit engineer's bug comment.
- **Chrome's Media Engagement Index status in 2026** — documented as active, no 2026
  changelog either way.
- **iOS 26 PWA audio regressions** — third-party bug reports only; no Apple/WebKit source.
- **AAC gapless looping in browsers** — field reports, no spec-level guarantee.
- **`setup-rn-audio-api-web`** — the bin script exists in the manifest; its behaviour is
  undocumented.
- **Whether `expo-audio` and `react-native-audio-api` can coexist** in one app — plausible,
  untested, unstated by either project.
- **Binary-size delta** from adding `react-native-audio-api` — the npm tarball is ~9.4 MB but
  includes source, docs and multi-arch prebuilts; no build-and-measure was done.
- **Whether "sharki" is a lute or a wind instrument** — sources contradict.
- **Balkan aksak metres as specifically *Albanian*** — they are the wider Balkan vocabulary;
  the melodic-character description came from non-scholarly sources.
- **The 91 %-play-muted figure** is one 2022 survey, contradicted by a 2013 one. Directionally
  strong, not a hard number.
- **No GDC talk found** on Balatro's music or on Hearthstone audio; **no canonical primary
  source found** on strategic silence in games. Absence of evidence, not evidence of absence.
