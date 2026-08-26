# Home menu reorganisation — three proposals

Research date: 2026-08-26. Subject: `app/index.tsx` (the title screen / main menu).
Nothing here is implemented; this is a decision document.

---

## 1. The current state, recorded verbatim

### 1.1 The rows

All rows come from one function, `menuButtons(compact: boolean)` in `app/index.tsx`
(lines 347-359). Both orientations render the same list; only `compact` differs.
Order, top to bottom, exactly as written:

| # | Key | English copy | Icon | Accent? | Stagger | Destination |
|---|-----|--------------|------|---------|---------|-------------|
| 1 | `home.resumeGame` | Resume game | `play-circle` | `accent` (always) | 240 | `resumeGame()` then `/game` — **rendered only when `hasSavedGame`** |
| 2 | `home.modeOffline` | Offline | `game-controller` | `accent={!hasSavedGame}` | 300 | `/lobby?mode=ai` |
| 3 | `home.modePlayWithFriends` | Play with friends | `people` | no | 420 | `/(online)` if signed in, else `/auth` |
| 4 | `home.modeOnline` | Online | `earth-outline` | no | 540 | `/(online)/quickmatch` if signed in, else `/auth` |
| 5 | `home.modeProfile` | My profile | `stats-chart-outline` | no | 580 | `/(online)/profile` if signed in, else `/auth` |
| 6 | `home.modeTutorial` | Tutorial | `school-outline` | no | 600 | `/tutorial` |
| 7 | `home.modeRules` | Rules & FAQ | `book-outline` | no | 660 | `/rules` |

There is **no grouping of any kind** — no section label, no gap change, no card, no
divider. Every row is the same `HomeMenuRow`: `Colors.bgSurface` fill, `Colors.border`
hairline, `Radius.md`, gold icon at 20, `Rajdhani_600SemiBold` label at `FontSize.lg`,
muted `chevron-forward`. The gap between every pair is the same `Spacing.cosy` (12)
in portrait and `Spacing.snug` (10) in landscape.

The only differentiation is the `accent` flag, which swaps the row's fill for a
`[Colors.gold, Colors.goldDark]` gradient and drops the chevron. Exactly one row is
ever accented: row 1 when a save exists, otherwise row 2.

### 1.2 Everything else on the screen

**Portrait** (`app/index.tsx` 416-482), top to bottom:

1. Full-bleed `LinearGradient` `[bg, bgCard, feltDark]` + four `FloatingCard` decorations.
2. `header`: `MURLAN` at `WORDMARK_SIZE` (56, deliberately above the type scale) with a
   `DEV` badge in `__DEV__`, a 160-wide gold underline, and `home.subtitle`
   ("The Card Game") in gold uppercase.
3. `userRow` — **signed in**: person icon, username, `home.logout` ("Log Out") as a
   bare text `Pressable`, `FriendsButton` (gold pill, "Friends", red count badge),
   `SettingsButton` (44x44 bordered circle, gear). **Signed out**: `SettingsButton` alone,
   centred.
4. `cardDecoration`: the four suit glyphs at `FontSize.xl`, `Spacing.roomy` apart.
5. `ScrollView` containing `menuButtons(false)`, `justifyContent: "center"`.
6. `footer`: `home.footer` = "2-4 players &middot; All modes" in `textMuted`.
7. `SettingsModal` (holds sound, music, motion, card back, table felt, **language**,
   report a bug, delete account).

**Landscape** (`app/index.tsx` 361-413) — a two-column split:

- Left column, fixed `38%`, bordered on the right: wordmark at `FontSize.hero` (36),
  underline, subtitle, suits, then the same `userRow` (`userRowLandscape`,
  `flexWrap`), with `FriendsButton compact` (icon only, outlined) and
  `SettingsButton compact`.
- Right column, `flex: 1`, a `ScrollView`: `menuButtons(true)` (compact padding,
  `FontSize.md` label) followed by the footer text.
- No `DEV` badge, no floating cards beyond two.

### 1.3 What the current state gets wrong

- **Seven rows of identical weight.** The one accented row is the only hierarchy, and it
  marks *Resume* or *Offline*, which are not the same kind of thing.
- **"Play now" is missing.** There is no single primary action. A first-time player must
  read seven labels and decide between four verbs.
- **Three unlike categories are interleaved.** Play (2,3,4), account (5), learn (6,7).
  Nothing separates them.
- **`Rules & FAQ` and `Tutorial` sit adjacent to `Online`** at the same weight, so
  reference material competes with the reason the app was opened.
- **Account is split three ways**: `My profile` is a row, `Friends` is a gold pill in the
  user strip, `Log Out` is a bare word, and `Language` is buried two levels down inside
  `SettingsModal`.
- **`/(online)/leaderboard` is unreachable from home** — its only entry point is a button
  inside `/(online)/profile` (`app/(online)/profile.tsx:253`).
- **Signed-out state is a trap.** Rows 3, 4 and 5 all silently redirect to `/auth`. Three
  of the seven rows lie about where they go.
- **The stagger is arbitrary**: 240, 300, 420, 540, 580, 600, 660 — gaps of 60, 120, 120,
  40, 20, 60. It reads as noise rather than as a rhythm.

### 1.4 Accessibility defects found while reading (independent of any proposal)

These are current bugs. Any of the three proposals should fix them as part of the work.

- **`FriendsButton` has no `accessibilityRole` and no `accessibilityLabel`**
  (`app/index.tsx` 240-254). In `compact` (landscape) it renders an icon and nothing else,
  so a screen reader announces an unlabelled button. In both variants the count badge is a
  separate un-hidden `Text` child, which violates the one-accessible-node-per-labelled-control
  invariant in `CLAUDE.md`.
- **`logoutBtn` is roughly 17pt tall** — `paddingVertical: Spacing.xxs` (2) around
  `FontSize.xs` (11) text — with no `hitSlop` and no `accessibilityRole`. Far under
  `TOUCH_TARGET_MIN`.
- **`HomeMenuRow` never declares `minHeight: TOUCH_TARGET_MIN`.** It clears 44pt only by
  arithmetic on `Spacing.md` padding plus the intrinsic line height. In `compact`
  (`Spacing.cosy` = 12 vertical) the margin is a couple of points and depends on the
  font's natural leading. It should state the floor.

---

## 2. External evidence

### 2.1 Platform and UX guidance

- **Prioritise, or nothing is prioritised.** NN/g: "Visual hierarchy refers to the
  organization of the design elements on the page so that the eye is guided to consume each
  design element in the order of intended importance"; "Bigger elements stand out more and
  attract users' attention, so size can be used as a marker for importance"; and it is "not
  the actual color of an element that creates the hierarchy, but rather the contrast in
  value and saturation between the element and the context in which it appears."
  <https://www.nngroup.com/articles/visual-hierarchy-ux-definition/>
- **Grouping is done with space or with an enclosure, and both are legitimate.** NN/g,
  same article: "Grouping is usually conveyed implicitly through proximity and the use of
  white space or explicitly through enclosure (common region)"; "increased spacing between
  groups makes each set separate and individualized."
  <https://www.nngroup.com/articles/visual-hierarchy-ux-definition/>
- **Proximity alone is enough to create a group.** NN/g: "Items close together are likely
  to be perceived as part of the same group — sharing similar functionality or traits."
  <https://www.nngroup.com/articles/gestalt-proximity/>
- **Seven equal choices is the expensive case.** Hick's Law: "The time it takes to make a
  decision increases with the number and complexity of choices," with the explicit
  recommendation to "avoid overwhelming users by highlighting recommended options."
  <https://lawsofux.com/hicks-law/>
- **Long menus are fixed by grouping, not by deletion.** NN/g on Hick's Law and long menus:
  "the more choices you present to your users, the longer it takes them to reach a
  decision," but "combining Hick's Law with other design techniques can make long menus easy
  to use." <https://www.nngroup.com/videos/hicks-law-long-menus/>
- **Chunking is the named technique.** Laws of UX: group information "into a meaningful
  whole" using "visually distinct groups with a clear hierarchy."
  <https://lawsofux.com/chunking/> ; Miller's Law:
  <https://lawsofux.com/millers-law/>
- **One path to each destination.** Apple HIG's navigation guidance: "In general, give
  people one path to each screen," and the path through content should be "logical,
  predictable, and easy to follow." <https://developer.apple.com/design/human-interface-guidelines/>
  (surfaced via <https://developer.apple.com/videos/play/wwdc2022/10001/>)
- **44x44pt is Apple's floor, and it is a hit region not a glyph.** Apple HIG: "a button
  needs a hit region of at least 44x44 pt ... to ensure that people can select it easily."
  <https://developer.apple.com/design/human-interface-guidelines/buttons> ;
  <https://developer.apple.com/design/tips/>
- **WCAG 2.2 SC 2.5.8 sets a lower legal floor of 24x24 CSS px** — "The size of the target
  for pointer inputs is at least 24 by 24 CSS pixels" — so the project's 44pt constant is
  stricter than required, and should stay.
  <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>
- **A phone in landscape is a *medium-width, compact-height* window, and Android's own
  guidance says two-pane is questionable there.** "for scenarios such as phones or open
  flippables in landscape orientation; the window width is typically medium, but window
  height is compact, in which case two pane layouts are not practical."
  <https://developer.android.com/develop/adaptive-apps/guides/use-window-size-classes>
  This is a direct argument against the current fixed `38% / 62%` split at phone size.

### 2.2 How this genre actually does it

- **Lichess** leads with a single create-a-game action: "Create lobby game", with
  "Challenge a friend" and "Play against computer" beside it, and six top-level
  categories — Play, Puzzles, Learn, Watch, Community, Tools. Account (Sign in / Register)
  is isolated in the top-right corner, out of the play flow. <https://lichess.org/>
- **Lichess's own mobile team treats the primary-action slot as contested territory.** A
  v0.8.9 change that moved the "new game" button to the top-right corner drew user pushback
  over de-prioritising the primary start-a-game action, and a maintainer agreed recent games
  should be promoted above the leaderboard.
  <https://github.com/lichess-org/mobile/discussions/295>
- **An independent critique of the Lichess iOS app** found the home screen offers "twelve
  various ways to launch a game" and proposed collapsing the app into three top-level
  sections: Home/Play, Learn, Profile.
  <https://ixd.prattsi.org/2024/09/design-critique-lichess-ios-app/>
- **Chess.com** puts the most popular features at the top of the homepage and groups them
  as Play / Puzzles / Learn, with community and account handled separately.
  <https://support.chess.com/en/articles/8615318-welcome-to-chess-com>
- **Board Game Arena** has a dedicated top-menu "Play now" that is not a game list: "By
  choosing 'Play now' on the top menu, you get a list of game tables waiting for players."
  Choosing a game and finding opponents are two different menu entries.
  <https://en.doc.boardgamearena.com/Getting_started>

**Gaps — deliberately not cited.** I could not verify, with a primary source, (a) Yucata's
menu taxonomy, (b) a home-screen hierarchy claim for Microsoft Solitaire Collection or the
Hearts/Belote/Scopa/Briscola app class, or (c) any reputable UX writing specifically on the
Continue/Resume-takes-the-primary-slot convention. The Resume argument below therefore rests
on the general prioritisation evidence above (highlight the recommended option) plus the
Lichess "promote recent games" thread, **not** on a claimed industry standard.

---

## 3. Constraints binding every proposal

Stated so no proposal can be read as waiving one.

1. **Every user-facing string goes through `t()` and needs a key in `en`, `it` and `sq`.**
   `it.ts`/`sq.ts` are `Record<keyof typeof en, string>`, so a missing key is a compile
   error, not a runtime fallback. Every proposal below lists the exact new keys it needs.
2. **No bare literals for colour, radius, font size, spacing or timing.** Everything below
   is expressed in existing `lib/tokens.ts` values. **No proposal adds a token.**
   ESLint enforces radius/font-size/spacing; colour and timing are convention only.
3. **A token is used in the role it was named for** (`tests/tokenRoles.test.ts`). The gold
   alpha scale is picked by role — `goldGhost` for a wash behind a large area, `goldSoft`
   for a resting divider, `goldBorder` for a row edge, `goldStrong` for active/selected.
4. **A local component must not share a name with a shared one.** `components/` currently
   holds `MenuButton`, `MenuCard`, `MenuLayout`, `CardView`, `Slider`, `Toggle`,
   `ConfirmDialog`, `SettingsModal`, `NotificationBanner`, `OfflineBanner`, `GameTable`,
   `HandBreakdown`, `ReplayControls`, `ErrorBoundary`, `ErrorFallback`,
   `ExchangeModal`, `ExchangeAnnouncement`, `GameOverOverlay`, `ResultExchangeOverlay`,
   `ReactionLayer`, `SessionReplacedNotice`. The names proposed below
   (`HomeHero`, `HomeSectionLabel`, `HomeModeTile`, `HomeAccountBar`) collide with none of
   them and all carry the `Home` prefix that `HomeMenuRow` already established.
5. **Every control keeps a 44pt hit region** (`TOUCH_TARGET_MIN`), declared as
   `minHeight`/`height`, not inferred from padding — `react-native-web` reads `hitSlop` on
   nothing but the legacy `Touchable`, so on the shipped platform the box *is* the target.
6. **One accessible node per labelled control.** Decorative children get `a11yHidden`;
   `Pressable`'s `accessible` default does not collapse them.
7. **Menus are not orientation-locked.** `useWindowDimensions` drives the branch; both
   layouts must be complete designs, not one design with things moved.
8. **Reduced motion is respected.** `usePrefersReducedMotion` already short-circuits every
   entrance animation to its end state; any new stagger must too.

---

## 4. Proposal A — "Deal"

**One-line thesis:** the home screen has exactly one job — get a hand dealt — so it gets
exactly one big gold button, and the other six things get out of its way.

### Primary action

A single hero CTA, `HomeHero`, using the existing `MenuButton` with
`variant="primary" size="lg"`: the struck-metal gradient
(`goldLight -> gold -> goldDark`), `Radius.full`, `Shadow.gold`, `Colors.bg` label in
`Rajdhani_700Bold` at `FontSize.xl`, `minHeight: 60`. It is the only gold fill on the
screen. Nothing else may be gold-filled — gold outlines and gold icons are still allowed,
which is what keeps the contrast doing work
(<https://www.nngroup.com/articles/visual-hierarchy-ux-definition/>).

Its label is state-dependent:

- **Saved game exists** -> `home.heroResume` ("Resume game"), subtitle line
  `home.heroResumeSub` ("Offline, against the computer"). Pressing it calls the existing
  `onResume()`.
- **No saved game** -> `home.heroPlay` ("Play"), subtitle `home.heroPlaySub`
  ("2-4 players, offline"). Pressing it goes to `/lobby?mode=ai`.

`resumeGame` therefore **never appears as a row**. When a save exists it *becomes* the
primary button; when it does not, `Offline` takes the slot and the accent flag disappears
from `HomeMenuRow` entirely (the `accent` prop is deleted, and with it
`menuButtonAccent`, `accentGradient`, `accentGradientCompact`, `menuLabelAccent`). This is
the largest simplification available: the whole gradient-inside-a-bordered-row apparatus,
and the padding-longhand comment that guards it, goes away.

When the hero is Resume, a small ghost link under it — `home.heroNewGame` ("Start a new
game instead") in `Colors.textSecondary`, `Inter_400Regular`, `FontSize.sm`, wrapped in a
44pt-tall `Pressable` — preserves the path to `/lobby?mode=ai`. Discarding the save is
*not* offered here; the existing lobby flow already overwrites it.

### Grouping

Three groups, separated **by spacing only** — no cards, no labels, no dividers. The
proximity principle carries it: `Spacing.cosy` (12) within a group, `Spacing.xxl` (40)
between groups.

1. **Hero** (1 control).
2. **More ways to play** (3 rows): `Play with friends`, `Online`, and a new
   `home.modeLocal` ("Pass and play") which currently has no home entry at all despite
   `/lobby?mode=local` existing. Keep the existing `HomeMenuRow` treatment.
3. **Learn** (2 rows): `Tutorial`, `Rules & FAQ` — same `HomeMenuRow` but at
   `Colors.textSecondary` label and `FontSize.md`, one step quieter than group 2.

### Account

Everything account-shaped moves out of the list and into one `HomeAccountBar` pinned to the
top-right, mirroring Lichess's corner placement (<https://lichess.org/>):

- Signed in: avatar-less person chip showing the username (tap -> `/(online)/profile`,
  which absorbs `home.modeProfile`), the friends icon with its badge, the gear.
- Signed out: `home.signIn` ("Sign in") as a `secondary`-variant `MenuButton size="sm"`
  (gold outline, transparent fill), plus the gear.
- **Log Out leaves the home screen.** It moves into `SettingsModal`, beside Delete Account,
  where a destructive account action belongs. This kills the 17pt tap target outright
  rather than enlarging it.
- **Language stays in `SettingsModal`.** It is a set-once preference; the gear is one tap
  away from every state.

Because rows 3/4 no longer redirect to `/auth` invisibly: when signed out, the *Online* and
*Play with friends* rows render `disabled` (the existing `menuButtonDisabled` style,
`opacity 0.5`, `textMuted` icon) with `accessibilityHint` = `home.requiresAccount`
("Sign in to play online"), and tapping them still routes to `/auth`. The label now tells
the truth before the tap.

### Portrait

```
+--------------------------------------------------+
|                                     [@ana][*3][G]|   <- HomeAccountBar, 44pt row
|                                                  |
|                    MURLAN                        |   FontSize 56, wordmark
|                 ==============                   |   gold underline
|                 THE CARD GAME                    |   gold caps, FontSize.sm
|                                                  |
|              (spade) (heart) (diam) (club)       |   suit decor
|                                                  |
|   +==========================================+   |
|   ||              R E S U M E               ||   |   <- hero, Radius.full,
|   ||        Offline, against the computer   ||   |      gold gradient, Shadow.gold
|   +==========================================+   |
|              Start a new game instead            |   <- ghost link, 44pt box
|                                                  |
|                                                  |   <- Spacing.xxl
|   +------------------------------------------+   |
|   | (people)   Play with friends           > |   |
|   +------------------------------------------+   |   <- Spacing.cosy
|   | (globe)    Online                      > |   |
|   +------------------------------------------+   |
|   | (users)    Pass and play               > |   |
|   +------------------------------------------+   |
|                                                  |   <- Spacing.xxl
|   +------------------------------------------+   |
|   | (cap)      Tutorial                    > |   |   <- quieter: textSecondary,
|   +------------------------------------------+   |      FontSize.md
|   | (book)     Rules & FAQ                 > |   |
|   +------------------------------------------+   |
|                                                  |
+--------------------------------------------------+
```

The footer (`home.footer`, "2-4 players &middot; All modes") is **deleted**. It repeats what the
hero subtitle now says.

### Landscape

The 38/62 split goes. Android's own guidance says a phone in landscape is medium-width /
compact-height and "two pane layouts are not practical"
(<https://developer.android.com/develop/adaptive-apps/guides/use-window-size-classes>).
Instead: a short banded header across the full width, then the hero and the two groups
**side by side** so nothing needs to scroll on a 375pt-tall window.

```
+----------------------------------------------------------------------+
| MURLAN  ==  THE CARD GAME                        [@ana] [*3] [G]     |  <- one band,
+----------------------------------------------------------------------+     44pt tall
|                                    |                                 |
|  +==============================+  |  +---------------------------+  |
|  ||         R E S U M E        ||  |  | (people) Play w/ friends >|  |
|  ||   Offline, vs the computer ||  |  +---------------------------+  |
|  +==============================+  |  | (globe)  Online          >|  |
|      Start a new game instead      |  +---------------------------+  |
|                                    |  | (users)  Pass and play   >|  |
|         (sp) (he) (di) (cl)        |  +---------------------------+  |
|                                    |                                 |
|                                    |  | (cap)    Tutorial        >|  |
|                                    |  | (book)   Rules & FAQ     >|  |
|                                    |                                 |
+----------------------------------------------------------------------+
        50%, centred                 |          50%, left-aligned
```

Both columns are `flex: 1` rather than a fixed percentage, so a tablet or a desktop browser
widens them evenly; `MENU_MAX_W` (800) is *not* applied because home owns its own
full-bleed background.

### Rows that move, merge or disappear

| Row | Fate |
|-----|------|
| `home.resumeGame` | **Merged into the hero.** No longer a row. Same string, new home. |
| `home.modeOffline` | **Merged into the hero** when no save exists; becomes the "Start a new game instead" ghost link when a save exists. No longer a row. |
| `home.modePlayWithFriends` | Stays, moves into group 2, gains a disabled+hint state when signed out. |
| `home.modeOnline` | Stays, moves into group 2, same disabled+hint state. |
| `home.modeProfile` | **Disappears as a row.** Absorbed by the username chip in `HomeAccountBar`. |
| `home.modeTutorial` | Stays, demoted into group 3. |
| `home.modeRules` | Stays, demoted into group 3. |
| (new) `home.modeLocal` | **Added** — `/lobby?mode=local` has no entry point today. |
| `home.logout` | **Moves into `SettingsModal`.** |
| `home.friendsLabel` | Icon-only chip in `HomeAccountBar`, with a real `accessibilityLabel`. |
| `home.footer` | **Deleted.** |

### New i18n keys (en/it/sq)

`home.heroPlay`, `home.heroPlaySub`, `home.heroResume`, `home.heroResumeSub`,
`home.heroNewGame`, `home.modeLocal`, `home.signIn`, `home.requiresAccount`,
`home.accountA11yLabel`, `home.friendsA11yLabel`, `home.friendRequestsBadgeA11yLabel`.
Removed: `home.footer`. `home.logout` moves to a `settings.*` key.

### Exemption

**Partially in.** The hero uses the shared `MenuButton` (`primary`/`lg`) and the signed-out
`Sign in` uses `MenuButton` (`secondary`/`sm`) — those are exactly the pill CTA the shared
component exists to be, and hand-rolling a second gold gradient pill is how a design system
drifts. Everything else stays exempt: `MenuLayout` is not adopted, because home owns a
full-bleed three-stop background, the floating-card decorations and a two-column landscape
body that `MenuLayout`'s `maxWidth` and centring would fight.

### Accessibility

Hero is `minHeight: 60` (MenuButton `lg`). Every `HomeMenuRow` gains an explicit
`minHeight: TOUCH_TARGET_MIN`. The ghost "Start a new game instead" link is wrapped in a
`TOUCH_TARGET_MIN`-tall box, not left as bare text. `HomeAccountBar` is a 44pt-tall row of
44x44 targets. `FriendsButton` gets `accessibilityRole="button"` and an
`accessibilityLabel` composed from `home.friendsA11yLabel` and the badge count, with the
badge `Text` marked `a11yHidden` so the control is one node. Disabled rows use
`a11yState({ role: "button", disabled: true })` plus the hint, so the reason is announced.

---

## 5. Proposal B — "Three Shelves"

**One-line thesis:** keep the row list, because a list of rows is a perfectly good menu;
cut it into three labelled shelves and give the top one a real primary.

This is the smallest diff of the three and the one that survives a hostile review of
"do we really need to redesign this".

### Primary action

The first row of the PLAY shelf is promoted to a **tall row**: same `HomeMenuRow`
component, new `hero` variant — `minHeight: 60`, `Radius.lg`, the primary gradient
(`goldLight -> gold -> goldDark`, matching `MenuButton`'s `PRIMARY_GRADIENT` rather than
today's two-stop `[gold, goldDark]`), label at `FontSize.xl` in `Rajdhani_700Bold` on
`Colors.bg`, a two-line layout with a `Colors.bgCard` subtitle at `FontSize.xs`,
`Shadow.gold`. Every other row keeps today's `bgSurface`/`border` treatment and loses the
`accent` prop entirely.

Rank is carried by three channels at once — size, colour contrast, and enclosure — which
is precisely the combination NN/g names
(<https://www.nngroup.com/articles/visual-hierarchy-ux-definition/>).

### Grouping

Three shelves, each with a **section label** — a new local `HomeSectionLabel`: uppercase,
`Colors.gold`, `Rajdhani_600SemiBold`, `FontSize.sm`, `letterSpacing: 1.5`,
`accessibilityRole="header"`. This is the same treatment `MenuCard`'s `title` already
uses, so a player moving between home and any other menu screen sees one convention. It is
copied rather than imported because `MenuCard` couples the title to the felt-gradient card
body, and home does not want a card.

Between shelves: `Spacing.lg` (24). Within a shelf: `Spacing.cosy` (12). Above each label:
`Spacing.xs`. A `goldSoft` hairline sits under each label (that is the token's named role:
"dividers, resting borders").

```
PLAY        <- home.sectionPlay
LEARN       <- home.sectionLearn
YOU         <- home.sectionAccount
```

### `resumeGame`

**Stays a row, but only ever as the hero row.** When `hasSavedGame` is true it is the first
row of PLAY, in hero treatment, labelled `home.resumeGame` with the subtitle
`home.resumeGameSub` ("Pick up where you left off"), and `Offline` is the second row in
normal treatment. When it is false it is not rendered at all and `Offline` is promoted into
the hero slot with `home.modeOfflineSub` ("2-4 players against the computer"). Exactly one
hero row exists in every state — that invariant is worth a unit test.

### Where the rest sits

- **PLAY**: hero row, then `Offline` (when not hero), `Play with friends`, `Online`,
  `Pass and play` (new).
- **LEARN**: `Tutorial`, `Rules & FAQ`.
- **YOU**: `My profile`, `Friends` (promoted out of the user strip into a real row, with
  the count badge as a trailing pill instead of a floating dot), `Leaderboard` (new —
  `/(online)/leaderboard` is currently unreachable from home), `Settings` (a row that opens
  `SettingsModal`), `Log out` (a row, `Colors.dangerDim` label, `Radius.md`, full 44pt).
- **Language** stays in `SettingsModal`.
- The gear button and the gold Friends pill in the user strip are **both deleted** — YOU
  now owns them, and Apple's "give people one path to each screen" is the reason to not
  keep two.
- The user strip shrinks to identity only: person icon + username, non-interactive, so it
  stops being a control that fails its own touch target.

### Portrait

```
+--------------------------------------------------+
|                    MURLAN                        |
|                 ==============                   |
|                 THE CARD GAME                    |
|             (person) ana                         |   <- identity only, not a control
|              (sp) (he) (di) (cl)                 |
|                                                  |
|  PLAY ------------------------------------------ |   <- HomeSectionLabel + goldSoft rule
|   +==========================================+   |
|   || (play) RESUME GAME                     ||   |   <- hero row: 60pt, Radius.lg,
|   ||        Pick up where you left off      ||   |      gold gradient
|   +==========================================+   |
|   +------------------------------------------+   |
|   | (pad)      Offline                     > |   |
|   +------------------------------------------+   |
|   | (people)   Play with friends           > |   |
|   +------------------------------------------+   |
|   | (globe)    Online                      > |   |
|   +------------------------------------------+   |
|   | (users)    Pass and play               > |   |
|   +------------------------------------------+   |
|                                                  |   <- Spacing.lg
|  LEARN ----------------------------------------- |
|   +------------------------------------------+   |
|   | (cap)      Tutorial                    > |   |
|   +------------------------------------------+   |
|   | (book)     Rules & FAQ                 > |   |
|   +------------------------------------------+   |
|                                                  |
|  YOU ------------------------------------------- |
|   +------------------------------------------+   |
|   | (chart)    My profile                  > |   |
|   +------------------------------------------+   |
|   | (people)   Friends                 (3) > |   |
|   +------------------------------------------+   |
|   | (trophy)   Leaderboard                 > |   |
|   +------------------------------------------+   |
|   | (gear)     Settings                    > |   |
|   +------------------------------------------+   |
|   | (exit)     Log out                       |   |   <- dangerDim label, no chevron
|   +------------------------------------------+   |
+--------------------------------------------------+
   (scrolls; the hero row is always above the fold)
```

Signed out, YOU collapses to a single hero-secondary row: `Sign in or create an account`,
and `Settings`. `Play with friends` / `Online` render `disabled` with the
`home.requiresAccount` hint, as in Proposal A.

The footer stays here — it is the only proposal that keeps it, because a labelled-shelf
layout has a natural bottom and "2-4 players &middot; All modes" reads as a colophon rather than
as a competing row.

### Landscape

Keep the two-column idea but make it **branding left, shelves right**, with the shelves
scrolling as one list and the section labels sticky-free (no sticky headers — RN Web's
`stickyHeaderIndices` on a nested ScrollView is a known divergence risk). Left column
narrows from `38%` to `32%` so the shelves get the space the labels cost.

```
+----------------------------------------------------------------------+
|                    |  PLAY ---------------------------------------   |
|      MURLAN        |  +==============================================+|
|    ==========      |  || (play) RESUME GAME                         ||
|   THE CARD GAME    |  ||        Pick up where you left off          ||
|                    |  +==============================================+|
|  (sp)(he)(di)(cl)  |  | (pad)    Offline                          > | |
|                    |  | (people) Play with friends                > | |
|   (person) ana     |  | (globe)  Online                           > | |
|                    |  | (users)  Pass and play                    > | |
|                    |                                                 |
|                    |  LEARN --------------------------------------   |
|   2-4 players      |  | (cap)    Tutorial                         > | |
|   All modes        |  | (book)   Rules & FAQ                      > | |
|                    |                                                 |
|                    |  YOU ----------------------------------------   |
|                    |  | (chart)  My profile                       > | |
|                    |  | (people) Friends                      (3) > | |
|                    |  | (trophy) Leaderboard                      > | |
|                    |  | (gear)   Settings                         > | |
|                    |  | (exit)   Log out                            | |
+----------------------------------------------------------------------+
      32%            |                    68%, scrolls
```

At compact height the hero row keeps its 60pt; the eleven rows below it scroll. That is
acceptable *because* the hero never scrolls out — the ScrollView's
`contentContainerStyle` drops `justifyContent: "center"` (which today pushes the first row
down on a short window) and pins to the top.

### Rows that move, merge or disappear

| Row | Fate |
|-----|------|
| `home.resumeGame` | Stays, promoted to hero treatment, gains a subtitle. |
| `home.modeOffline` | Stays; becomes the hero when no save exists, otherwise the second PLAY row. Gains a subtitle for the hero case. |
| `home.modePlayWithFriends` | Stays, under PLAY. Disabled+hint when signed out. |
| `home.modeOnline` | Stays, under PLAY. Disabled+hint when signed out. |
| `home.modeProfile` | Stays, **moves** from the middle of the list to the top of YOU. |
| `home.modeTutorial` | Stays, under LEARN. |
| `home.modeRules` | Stays, under LEARN. |
| (new) `home.modeLocal` | Added under PLAY. |
| (new) `home.modeLeaderboard` | Added under YOU; first home-screen path to `/(online)/leaderboard`. |
| `home.friendsLabel` | **Promoted** from a gold pill in the user strip to a full row under YOU. Pill deleted. |
| `home.settingsA11yLabel` | Becomes a real visible row label `home.modeSettings`; the floating gear is deleted. |
| `home.logout` | **Promoted** from a 17pt text link to a full 44pt row at the bottom of YOU. |
| `home.footer` | Kept. |

### New i18n keys (en/it/sq)

`home.sectionPlay`, `home.sectionLearn`, `home.sectionAccount`, `home.resumeGameSub`,
`home.modeOfflineSub`, `home.modeLocal`, `home.modeLeaderboard`, `home.modeSettings`,
`home.signIn`, `home.requiresAccount`, `home.friendRequestsBadgeA11yLabel`.

### Exemption

**Stays fully exempt.** No shared component is adopted: the hero is a variant of
`HomeMenuRow`, not `MenuButton`, because it is a full-bleed rounded *row* with an icon, a
title and a subtitle, and `MenuButton` is a centred single-line pill with `Radius.full`.
Forcing it into `MenuButton` would mean adding a subtitle slot and a left-aligned layout to
a component twelve other screens use — the tail wagging the dog. `HomeSectionLabel`
duplicates `MenuCard`'s title *styling* deliberately, and the duplication is one style
object.

### Accessibility

Every row declares `minHeight: TOUCH_TARGET_MIN`; the hero declares 60.
`HomeSectionLabel` is `accessibilityRole="header"`, which gives VoiceOver/TalkBack rotor
navigation between the three shelves — the single largest screen-reader win of any
proposal here, and one that a flat list cannot offer at all. The Friends row's count badge
is folded into the row's own `accessibilityLabel` and the badge `Text` is `a11yHidden`.
`Log out` is `accessibilityRole="button"` at full size and, being destructive, gets a
`ConfirmDialog` — matching the "never delete through a link" precedent already in the tree.

---

## 6. Proposal C — "Table and Rail"

**One-line thesis:** stop drawing a list at all. The home screen is a table you sit down
at: one lit action in the middle, the modes as tiles around it, and everything
administrative on a rail at the edge.

The most opinionated and the highest-risk of the three; also the only one that reads as a
*game* rather than as a settings screen.

### Primary action

Same hero as Proposal A — a `MenuButton primary/lg` pill, gold gradient, `Shadow.gold` —
but placed as the centre of a composition rather than the top of a stack, sitting on a
`Colors.goldGhost` wash (that token's named role is exactly "wash behind large areas") with
`Radius.xl` corners. The wash is the "common region" enclosure NN/g describes: it makes the
hero plus its one satellite link read as a unit without a border
(<https://www.nngroup.com/articles/visual-hierarchy-ux-definition/>).

### Grouping

Grouping is by **shape**, not by label or by card:

- **The table** — the hero, in a goldGhost region.
- **The modes** — a 2x2 grid of square-ish `HomeModeTile`s: icon at 28 over a label at
  `FontSize.md`, `Colors.bgSurface` fill, `Radius.lg`, `Colors.goldBorder` edge
  ("card and row edges" is that token's role), `Spacing.cosy` gutters. Four tiles:
  `Offline`, `Play with friends`, `Online`, `Pass and play`. Tiles are shapes, not rows —
  a grid reads as a set of peers, which these four actually are, in a way that a vertical
  list never quite says.
- **The rail** — a horizontal strip of icon-plus-micro-label chips at the very bottom
  (portrait) or a vertical strip down the left edge (landscape):
  `Tutorial`, `Rules`, `Profile`, `Friends`, `Leaderboard`, `Settings`. `Colors.chipFill`
  background, `Radius.full`, gold icon, `Colors.textMuted` label at `FontSize.xxs`, each
  a `TOUCH_TARGET_MIN` square minimum.

Three regions, three shapes, no labels needed. This is chunking done with form
(<https://lawsofux.com/chunking/>).

### `resumeGame`

**The saved game changes what the table region *is*.**

- **Save exists**: the hero says `home.heroResume`, and directly beneath it inside the same
  goldGhost region sits a one-line **save summary** — `home.savedGameSummary`
  ("{{players}} players &middot; hand {{hand}}"), values read from the existing save. This is
  the only proposal that shows the player *what* they would be resuming, which is the
  argument for the resume-first ordering rather than an assertion of it. The `Offline` tile
  in the grid stays and starts a fresh game, so the two paths are visibly distinct and
  neither is hidden behind the other.
- **No save**: the hero says `home.heroPlay` and routes to `/lobby?mode=ai`; the `Offline`
  tile is replaced by a `Tutorial` tile (a first-time player's most useful second option),
  and Tutorial leaves the rail. The grid is always four tiles.

### Where the rest sits

- **Settings**, **Friends**, **Profile**, **Leaderboard**: rail chips.
- **Log out**: **moves into `SettingsModal`**, as in Proposal A. A rail of six equal chips
  must not contain a destructive one.
- **Language**: **promoted out of `SettingsModal` onto the rail** as a two-letter chip
  (`EN` / `IT` / `SQ`) that cycles on tap, with the full name in its `accessibilityLabel`.
  Rationale: this app has three real language communities and the title screen is where a
  player who opened it in the wrong language is standing. It is the one preference worth a
  top-level slot. The `SettingsModal` control stays too — Apple's one-path rule argues
  against duplication, but a language switch is the case where being findable beats being
  singular, and the counter-argument is recorded in §8 as an open question.
- Username: a rail chip showing the avatar-less initial, tapping to `/(online)/profile`.
  Signed out, that chip reads `home.signIn`.

### Portrait

```
+--------------------------------------------------+
|                    MURLAN                        |
|                 ==============                   |
|                 THE CARD GAME                    |
|                                                  |
|  ..............................................  |
|  :          (goldGhost wash, Radius.xl)       :  |
|  :  +======================================+  :  |
|  :  ||          R E S U M E               ||  :  |   <- MenuButton primary/lg
|  :  +======================================+  :  |
|  :        3 players * hand 4                  :  |   <- save summary
|  :............................................:  |
|                                                  |
|   +-------------------+  +-------------------+   |
|   |     (pad)         |  |     (people)      |   |
|   |     Offline       |  | Play with friends |   |   <- HomeModeTile 2x2,
|   +-------------------+  +-------------------+   |      goldBorder, Radius.lg
|   +-------------------+  +-------------------+   |
|   |     (globe)       |  |     (users)       |   |
|   |     Online        |  |   Pass and play   |   |
|   +-------------------+  +-------------------+   |
|                                                  |
|            (sp) (he) (di) (cl)                   |
|                                                  |
| (cap) (book) (A) (people) (cup) (gear) (EN)      |   <- rail, chipFill, 44pt each,
|  Learn Rules  ana  Friends Board  Set.  Lang     |      horizontally scrollable
+--------------------------------------------------+
```

### Landscape

The rail becomes vertical on the leading edge — which is also where the safe-area cutout
lands, so the rail absorbs `insets.left` the way the game table's rail absorbs it already.
The table and grid go side by side.

```
+----------------------------------------------------------------------+
|(cap) |   MURLAN  ==  THE CARD GAME                                   |
|Learn |                                                               |
|      |  ..................       +------------+  +------------+      |
|(book)|  :  +============+ :      |   (pad)    |  |  (people)  |      |
|Rules |  :  || RESUME   || :      |  Offline   |  | With fri.. |      |
|      |  :  +============+ :      +------------+  +------------+      |
| (A)  |  :  3 pl * hand 4 :       +------------+  +------------+      |
| ana  |  :................:       |  (globe)   |  |  (users)   |      |
|      |                           |   Online   |  | Pass&play  |      |
|(ppl) |     (sp)(he)(di)(cl)      +------------+  +------------+      |
|Frnds |                                                               |
|      |                                                               |
|(cup) |                                                               |
|Board |                                                               |
|      |                                                               |
|(gear)|                                                               |
|(EN)  |                                                               |
+----------------------------------------------------------------------+
  72pt |  table region, flex 1     |  grid region, flex 1
```

The rail is a fixed 72pt column (44pt target + `Spacing.wide` either side), vertically
scrollable, and it is the only fixed-width element; the two content regions are `flex: 1`
each.

### Rows that move, merge or disappear

| Row | Fate |
|-----|------|
| `home.resumeGame` | **Merged into the hero**, plus a new save-summary line. No longer a row. |
| `home.modeOffline` | **Becomes a grid tile.** Also becomes the hero when no save exists, and is then swapped out of the grid for a Tutorial tile. |
| `home.modePlayWithFriends` | **Becomes a grid tile.** |
| `home.modeOnline` | **Becomes a grid tile.** |
| `home.modeProfile` | **Becomes a rail chip** (the username chip). |
| `home.modeTutorial` | **Becomes a rail chip**, or a grid tile in the no-save state. |
| `home.modeRules` | **Becomes a rail chip.** |
| (new) `home.modeLocal` | Added as the fourth grid tile. |
| (new) `home.modeLeaderboard` | Added as a rail chip. |
| `home.friendsLabel` | **Becomes a rail chip**; the gold pill is deleted. |
| `home.settingsA11yLabel` | **Becomes a rail chip**; the floating gear circle is deleted. |
| `home.logout` | **Moves into `SettingsModal`.** |
| Language (from `SettingsModal`) | **Promoted to a rail chip**, duplicated. |
| `home.footer` | **Deleted** — the save summary and the tiles carry the information. |

### New i18n keys (en/it/sq)

`home.heroPlay`, `home.heroResume`, `home.savedGameSummary` (interpolates `players` and
`hand`), `home.modeLocal`, `home.modeLeaderboard`, `home.modeSettings`, `home.railLearn`,
`home.railRules`, `home.railBoard`, `home.signIn`, `home.languageA11yLabel`,
`home.languageCycleA11yHint`, `home.requiresAccount`, `home.friendsA11yLabel`,
`home.friendRequestsBadgeA11yLabel`. Removed: `home.footer`.
The rail's micro-labels are separate keys from the full names because a 72pt chip cannot
hold "Rules & FAQ" in Albanian.

### Exemption

**Partially in**, same line as Proposal A: `MenuButton primary/lg` for the hero only.
`HomeModeTile` and the rail chip are new local components; neither has a shared analogue.
`MenuLayout` is still not adopted.

### Accessibility

The highest-risk proposal here, and it must be paid for:

- Every tile is at least `TOUCH_TARGET_MIN` square (in practice ~140pt at phone width).
- Every rail chip is a `TOUCH_TARGET_MIN` square minimum, with the micro-label *inside* the
  target, not below it.
- The rail's icon and micro-label are one accessible node: the label `Text` is
  `a11yHidden` and the chip carries the full name as its `accessibilityLabel`
  (`Leaderboard`, not `Board`).
- The language chip announces the current language by full name and carries an
  `accessibilityHint` saying that activating it changes language — a two-letter code with
  a cycle behaviour is invisible to a screen reader otherwise.
- The save summary is part of the hero's `accessibilityLabel`, not a separate focusable
  node, so "Resume, 3 players, hand 4" is announced once.
- **Reading order is the risk.** A 2x2 grid and an edge rail have no single obvious
  traversal order, and RN's default order follows the tree. The tree must be authored in
  the intended reading order (hero, tiles left-to-right top-to-bottom, then rail) rather
  than in the order the layout happens to want. This is the kind of thing only
  `tests/e2e/` can catch — no `react-test-renderer` test sees layout.

---

## 7. Recommendation

**Ship Proposal B, "Three Shelves".**

The problem the owner actually has is not that the menu is a list. It is that the list has
no rank and no groups. B fixes exactly that and nothing else:

- It is the only proposal where **every existing destination keeps a visible, labelled
  home-screen entry**, and two currently-hidden ones (`/(online)/leaderboard`,
  `/lobby?mode=local`) gain their first. A and C both solve the crowding partly by taking
  destinations away, which is a real cost the owner has not agreed to pay.
- It is the only proposal that gives screen-reader users **rotor-navigable headers**. Three
  `accessibilityRole="header"` labels turn an eleven-row scroll into three jumps. A's
  spacing-only grouping is invisible to assistive tech by construction, and C's grid and
  rail make traversal order a live hazard.
- It **fixes the three real a11y defects by structure rather than by patch**: Log out
  becomes a 44pt row instead of a 17pt word, Friends becomes a labelled row instead of an
  unlabelled icon, Settings becomes a row instead of a floating circle.
- It **stays fully exempt** from `MenuLayout`/`MenuCard`/`MenuButton`, so the change is
  confined to one file plus locale entries. A and C both take a dependency on `MenuButton`,
  and any future change to that pill CTA then has to be regression-checked against the
  title screen.
- Its landscape body is a genuine improvement without a rewrite: narrow the left column
  from 38% to 32%, drop `justifyContent: "center"` from the menu `contentContainerStyle`
  so the hero pins to the top on a compact-height window, and the shelves scroll.

**What B gives up, honestly:** it stays a list, so it will never read as a *game* the way C
does; and eleven rows plus three headers is more total content than today, which needs
scrolling in portrait on a small phone. The hero row above the fold is the mitigation, and
it is a real one — Hick's Law is about the choices you must *evaluate*, not the ones below
the fold (<https://lawsofux.com/hicks-law/>).

**If the owner wants the screen to feel like a game rather than a menu, take C, not A.** A
is B's hierarchy with fewer destinations and worse assistive-tech grouping; it is the
compromise that gets neither prize. C is a different and defensible product decision.

**Sequencing, if B is chosen:** the three a11y fixes in §1.4 are independent of the
redesign and should land first, as their own PR, so the redesign PR is a pure layout diff.

---

## 8. Open questions the owner must decide

1. **Does `Log out` belong on the title screen at all?** B keeps it as a row; A and C move
   it into `SettingsModal`. Keeping it visible is a courtesy to shared-device play (the
   pass-and-play case); hiding it is the convention everywhere else.
2. **Should signed-out players see `Online` / `Play with friends` disabled-with-a-hint, or
   keep today's silent redirect to `/auth`?** Disabled is honest but adds two dead rows to
   a first-run screen. A third option, not proposed above: replace both with one
   `Sign in to play online` row.
3. **Does the language switch earn a top-level slot** (C) or stay one tap inside Settings
   (A, B)? This is the only place a proposal deliberately breaks Apple's one-path rule
   (<https://developer.apple.com/design/human-interface-guidelines/>). The answer depends on
   data nobody here has: how many players open the app in a language they cannot read.
4. **Is `Pass and play` (`/lobby?mode=local`) a shipped mode?** All three proposals surface
   it. If it is unfinished, every proposal loses a tile/row and the grid in C needs a
   fourth thing.
5. **Should `Leaderboard` be promoted out of `/(online)/profile`?** B and C say yes. If
   the leaderboard is thin, promoting it advertises an empty room.
6. **How much does the wordmark cost?** All three keep `MURLAN` at 56pt in portrait. On a
   short window it is the single largest consumer of vertical space above the hero.
   Shrinking it to `FontSize.hero` (36) in portrait too would buy ~30pt for the menu; that
   is a brand call, not a layout call.
7. **Delete `home.footer`?** A and C do, B keeps it. It says "2-4 players &middot; All modes",
   which duplicates what the modes now say for themselves.
8. **Does the save summary in C (`3 players &middot; hand 4`) require new state?** It reads from
   the existing `OFFLINE_SAVE_KEY` blob, which already carries `players` and `match`, but
   `GameContext` currently exposes only the boolean `hasSavedGame` — it would need to expose
   a small descriptor. That is a context API change, which per `CLAUDE.md` is a
   design-first change, not a layout tweak.
