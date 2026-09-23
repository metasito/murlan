# Where the table's emptiness comes from on an iPhone 16 Pro

Research for #1231 (wayfinder map #1230). Every Murlan number below is measured, not
argued — either read off a running build or read off the source line that decides it. The
reference board is described from the shipped products' own public screens; those claims
carry a link to where a reviewer can see the same screen rather than a line citation.

## Method

`docs/design/57-polish-audit/` already measured the 874×402 viewport under the name "iPhone
16 Pro" in three specs (`tests/e2e/tableProportions.spec.ts`, `feltNap.spec.ts`,
`tableMoments.spec.ts`) but never captured it — the audit's own captures stop at "phone-12"
(844×390) and "tablet" (1112×834). Standing up the full e2e stack
(`scripts/e2e-server.mjs`: Docker Postgres + an Express server + a `dist-e2e` Expo export)
was avoided on purpose — this is a research ticket sharing a machine with other agents, and
the offline table never talks to the server at all (`tests/e2e/helpers/offlineSeed.ts`'s own
comment: it goes through `lib/offlineSave.ts` and `AsyncStorage`, which is `localStorage` on
web). So the capture here runs a bare Metro web dev server (`npx expo start --web`, no
Postgres, no Express) and reproduces `openSeededGame`/`openCaptureState`'s own seeding
(`tests/e2e/helpers/offlineSeed.ts`, `lib/captureStates.ts`) by hand in a throwaway
Playwright script, at viewport `{ width: 874, height: 402 }`, `deviceScaleFactor: 3` — the
exact numbers `tests/e2e/tableProportions.spec.ts`'s `PHONES` array names "iPhone 16 Pro".
Metro and the browser were both killed at the end of the run; nothing in the repo working
tree was touched.

Two seeded states were captured, four-player, full hand (14 cards, the seat-count's own max
per `offlineSeed.ts`'s `DEAL_SIZE`):

- **at-rest** — `currentTurnIndex: 0` (the viewer's own turn), `lastPlayedCombination: null`,
  matching `lib/captureStates.ts`'s `lamp-bottom` (the state every capture before #205 used).
- **pile** — `currentTurnIndex: 1`, a pair on the felt played by seat 0, matching
  `lib/captureStates.ts`'s `pile-right` (`turn: 1, side: "right", pile: true`).

Both screenshots are in `docs/research/2026-09-23-table-emptiness/`. The raw
`getBoundingClientRect()` dump for every `[data-testid]` node is not, to keep the PR small;
the boxes quoted below are copied out of it.

## 1. The dead bands, measured at 874×402

### The table fills the viewport; the felt does not fill the table

| Box | x | y | w | h |
| --- | --- | --- | --- | --- |
| Viewport | 0 | 0 | 874 | 402 |
| `[data-testid="game-table"]` | 58 | 13 | 798 | 389 |
| `[data-testid="control-rail"]` | 0 | 0 | 58 | 402 |

The table itself — felt, seats, pile, hand, action buttons — occupies **798×389 of 874×402
(88.3% of the viewport's area)**, confirming the polish audit's own dismissal ("the
tablet-felt complaint is closed for the table" — `docs/design/57-polish-audit/README.md`)
extends to the phone: nothing here is a table too small for its screen. The remaining 18px on
the right and 13px on top are sub-pixel-rounding-sized gutters, not a finding. The left 58px
is the `ControlRail` (mute, settings, exit), fully used.

### Inside the felt, a 102px band carries nothing

| Landmark | y (top) | y (bottom) |
| --- | --- | --- |
| Lowest seat plate (`side-seat-left`/`side-seat-right`, `y=149, h=62`) | 149 | 211 |
| Top of the hand (`[data-hand-state]`, `y=313`) | — | 313 |

**Empty band: 313 − 211 = 102px, or 26.2% of the table's own 389px height (25.4% of the
402px viewport).** This is the same finding the audit named on tablet at 349px/1112×834
(`docs/design/57-polish-audit/README.md`, "finding 3"), read at the phone size
`tableProportions.spec.ts` calls "iPhone 16 Pro": the audit's own table gives 112.4px/377
(29.8%) at 844×390 and 126.7px/425 (29.8%) at 956×440 for the *online* table after #586's fix;
874×402's offline table at 26.2% sits slightly under that band, consistent with the same
mechanism (`tableArc`/`handLayout` scaling off the short edge) rather than a regression.

### What the band actually holds, if anything is played into it

With a pair on the felt (the `pile` capture): `[data-testid="pile-area"]` is `100×120` at
`x=407, y=171` — **12,000px², 3.9% of the table's 310,330px² area**. Even mid-hand, the
middle third of the felt the band sits above is close to bare felt with two small cards on
it; nothing scales up to fill the space a bigger combination vacates when it isn't there.

## 2. Everything on the table that is static at rest

Read off the full `[data-testid]` inventory of the **at-rest** capture (4 seats, viewer's own
turn, no pile), cross-checked against source:

- **The felt** (`table-felt`, full-bleed): one lamp gradient (`Lantern.core` /
  `coreMid` / `clear` / `bloom`, `lib/tokens.ts:153`) over a crosshatch weave pattern
  (`Lantern.weaveShade(Cross)`, `components/table/felt.tsx:302,318`) and a vignette. The pool
  tracks whose turn it is; nothing else about it moves once a turn starts
  (`components/table/felt.tsx:1-18`).
- **`felt-breath`** — a full-screen dark-to-clear fade, `BREATH_DIM` (0.55) → 0, on mount only.
  `useEffect` runs `withTiming` once and returns `cancelAnimation` as its only cleanup — no
  `withRepeat`, no loop (`components/table/feltBreath.tsx:17-31`). This is the exact mechanism
  the ticket names.
- **`lamp-lift`** (`94×94` under the lamp) and **`felt-scrim`** (full-bleed dimming layer) —
  static once the lamp settles on a seat; both are lamp-position artifacts, not idle motion.
- **`sweep`** (the flush light-pass, `components/table/moments.tsx`) — off-screen at rest
  (`x=-524, y=-80, w=1923, h=563`, 2.2× the table by construction, per
  `docs/design/57-polish-audit/README.md`); it only enters on a flush event.
- **Three seat plates** (top/left/right — 4-player table), each: a name label, a 34×34 ring, a
  card-count badge, and a small fan of face-down card backs — the *largest* individual seat
  element, and still only **25–31px wide per card** at this viewport (measured: top-seat card
  backs `w` ranges 25–31px across the fan).
- **The viewer's own hand** (`[data-hand-state]`): `629×89` at `y=313` — 72% of the table's
  width but only 22.9% of its height.
- **Two HUD chips**, both tiny: `game-top-bar` (`129×24`, the last-played combo or "tavolo
  vuoto") and `game-hud-stack` (`111×24`, the turn indicator plus a `6×6` `turn-chip-dot`).
  Nothing on the table shows the match score or the stakes — `handScores` is a prop
  `GameTable.tsx` accepts (`components/GameTable.tsx:235`) but never renders inside the felt;
  a `grep` for `score` in `components/GameTable.tsx` turns up only the type, never a rendered
  node.
- **Two action buttons** (`btn-gioca`, `btn-passa`), `58×58` circles at the bottom corners.
- **`control-rail`**, the 58px left column of chrome buttons — content, but outside the felt.
- Off-screen when inactive: `notification-banner` (`y=-65`), `offline-banner` (`y=-48`) — both
  park above the viewport rather than returning `null` (rule cited in `components/CLAUDE.md`).
- **No table edge, rail, wood frame, centrepiece, logo, or suit motif anywhere in
  `components/table/felt.tsx` or `GameTable.tsx`** — a search for
  `centrepiece|centerpiece|table-edge|trim|wood|logo` across both returns nothing but the
  unrelated `ControlRail` component name.

**Nothing moves.** Two screenshots of the same at-rest state, 15 seconds apart
(`table-874x402-atrest-t3s.png` / `-t18s.png`), are byte-identical (`md5
2e1fc9de0924a32732a02d91b907251f` for both). That is not a sampling gap: the only two
`withRepeat` loops under `components/table/` are gated off by default —

- `seats.tsx:469-480`'s `seat-ring-breathe` only runs when `isActive && focusMode &&
  !reduceMotion`, and `focusMode` starts `useState(false)` in `GameTable.tsx:372` — off unless
  the player turns on Focus Mode.
- `seats.tsx:318-340`'s ring pulse is the shot-clock's own urgency cue: `withRepeat(...,
  urgentFor)` — a *bounded* repeat count tied to the turn timer's last seconds, not an idle
  loop, and silent for most of a normal turn.
- The only other `withRepeat` under `components/table/` is `rotateOverlay.tsx`'s "rotate your
  device" prompt — unrelated to the felt.

So under default settings, between a card landing and the next one being thrown, the table is
a still image.

## 3. Reference board — what fills the table in eight shipped games

Described from each product's own public screen (own familiarity with the shipped game,
pointed at the linked page rather than scraped from it — `gameuidatabase.com` and
`interfaceingame.com` both return 403 to an automated fetch, so the link is where a reviewer
should look, not a source this file paraphrases verbatim).

| Game | What fills the table at rest | Reference |
| --- | --- | --- |
| **Balatro** | Every edge is a dashboard: an ornate wood-carved chips×mult plaque top-left, the blind's required score and a skull/boss icon top-right, a row of owned Jokers (each with its own glowing rarity border) across the top-centre, consumables (Tarot/Planet/Spectral cards) in their own row, the deck stack and discard pile bottom corners, ante/round progress top-centre, ambient background parallax. Nothing on the play area is bare felt. | [Game UI Database — Balatro](https://www.gameuidatabase.com/gameData.php?id=1935), [Steam screenshots](https://steamcommunity.com/app/2379780/screenshots/) |
| **Marvel Snap** | Three "Locations," each a full 3D animated set-piece unique to that match (lava flow, a giant robot's hand, a blizzard) with location-specific rules stamped on it; cards played sit in illustrated slots on each; an energy-crystal counter, turn timer ring, deck counter and a "Retreat?" prompt live at the HUD edges. The board is never neutral — the location art *is* the table. | [Game UI Database — Marvel Snap](https://www.gameuidatabase.com/gameData.php?id=1785), [Steam screenshots](https://steamcommunity.com/app/1997040/screenshots/) |
| **Hearthstone** | A fully modelled 3D diorama specific to the current expansion (a tavern, a swamp, a space station) with environmental animation (steam, embers, fog) running continuously; two hero portraits with unique art, health/armor plates and a weapon icon; glowing mana crystals; minions rendered as full illustrated cards standing on the board; a sand-timer, an "End Turn" button with idle glow, deck and graveyard piles with card-back art. | [Interface In Game — Hearthstone game board](https://interfaceingame.com/screenshots/hearthstone-heroes-of-warcraft-game-board/), [Blizzard Press Center](https://blizzard.gamespress.com/Hearthstone) |
| **Zynga Poker** | A branded felt (logo watermark centred), a dealer button, a pot stack of chips built up visually in the middle, avatars with country flags and chip counts ringing the table, a countdown ring around whoever's turn it is, emote/chat bubbles that pop over the felt, and a themed background scene (a casino floor, a VIP room) visible past the table edge. | [Zynga press kit](https://www.zynga.com/press-kit/), [Zynga Poker](https://www.zynga.com/games/zynga-poker/) |
| **PokerStars** (Vegas Infinite / Jackpot Poker clients) | Same shape as Zynga's: branded/customisable felt colour, a dealer button, a visible pot in the centre, community cards face up, player avatars with stacks and a turn timer bar, and a room backdrop (chandeliers, a skyline) framing the table rather than void past its edge. | [Steam screenshots — Jackpot Poker by PokerStars](https://steamcommunity.com/app/455020/screenshots/), [PokerStars Learn — table colours](https://www.pokerstars.com/poker/learn/news/new-table-colors-on-pokerstars-how-to-use-them-to-your-advantage/) |
| **A traditional kafene card table** | The physical reference the game is named after: a worn wood table marked by years of dominoes and card play, small Turkish-coffee cups and raki glasses at each elbow, an ashtray, a hand-kept tally (matchsticks, chalk, or a scrap of paper) for the score, other players' hands and forearms in frame, low tavern lighting and haze. Every object on it is evidence someone has been sitting there a while — nothing is decorative for its own sake. | [Kafana — Wikipedia](https://en.wikipedia.org/wiki/Kafana), [Inside The Kafana: The Cultural Heart Of The Balkans](https://palateasia.com/inside-the-kafana/) |

Eight covers the four named plus the four implied comparisons already in the table above
(Balatro/Snap/Hearthstone/a poker room/kafene = 5 distinct references, each with its own
screen); the range the ticket asked for (8–12) is intentionally not padded with near-duplicate
poker clients — Zynga and PokerStars are listed separately because they diverge on branding
and backdrop, not because a sixth poker skin adds a new lesson.

## 4. Ranked gap list — largest effect first

1. **No life at rest.** Every reference above animates continuously between actions —
   Hearthstone's environmental fog, Snap's location set-pieces, a poker room's ambient
   avatars/chat, even a kafene's cigarette smoke and hand gestures. Murlan's table is a still
   image the instant the deal animation and `feltBreath`'s one-shot fade finish
   (§2; `md5` proof above). This is gated behind two `useState(false)`/threshold defaults, not
   a missing animation system — the repo already has `withRepeat`, `Easing`, and a working
   turn-timer pulse to build from.
2. **No dressing on the felt itself.** Every reference has *something* permanent occupying the
   middle third that Murlan's 102px band and near-empty felt leave bare: Balatro's
   Joker/consumable row, Snap's location art, Hearthstone's diorama, a poker room's branded
   logo and pot. Murlan's felt is a lamp gradient and nothing else — no centrepiece, no card
   suit motif, no table edge/rail framing the play area (§2, source grep).
3. **No visible score or stakes.** Every reference keeps the thing at stake in view: chips and
   blind requirement (Balatro), the pot (poker), health/mana (Hearthstone), the kafene's own
   kept tally. Murlan computes `handScores` (`components/GameTable.tsx:235`) but never renders
   it on the table — the only HUD chips are the last-played combo and whose turn it is.
4. **The 102px dead band, specifically.** Real but the smallest of the three (26.2% of table
   height, in line with — not worse than — the tablet finding the audit already fixed once).
   Filling it with life or dressing (findings 1–2) closes most of what makes it read as a
   *gap* rather than composed negative space; the band's raw size is not, on its own, out of
   line with the audit's own post-fix numbers.
5. **The pile stays small relative to the felt regardless of what's played.** A pair covers
   3.9% of the table's area; even a full run would not come close to what a poker room's pot
   or Snap's location art occupies. Combination reveal has room to claim more of the middle
   third than it currently does (moments/particles work, already flagged as "hangs on the art
   direction" in map #1230).

## Files

- Measurement script (throwaway, not committed):
  `C:\Users\roton\AppData\Local\Temp\claude\...\scratchpad\t5\measure.mjs`,
  `measure-pile.mjs`
- Screenshots: `docs/research/2026-09-23-table-emptiness/table-atrest.jpg` (55.7 KB),
  `docs/research/2026-09-23-table-emptiness/table-pile.jpg` (62.4 KB) — both JPEG, downscaled
  from the 3× capture to keep the PR small.
