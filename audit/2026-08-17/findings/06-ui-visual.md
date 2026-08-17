# B2 — UI visual quality

Prefix `UI`. Read-only pass over `lib/tokens.ts`, `lib/theme.ts`, the menu kit, the table
components, every overlay, and all 16 screens under `app/`. Every measurement below is
arithmetic on style objects I read, not a screenshot.

**Counts:** Critical 0 / High 1 / Medium 5 / Low 6

---

### [UI-01] Give `SettingsModal` a scrollable body and a max height
- **Severity:** High
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `components/SettingsModal.tsx:191-393` (render), `components/SettingsModal.tsx:396-413` (`backdrop`, `card`), opened from `app/index.tsx:393` and `app/index.tsx:458`
- **Problem:** The modal body is a plain `View` with no `ScrollView` and no `maxHeight`.
  `backdrop` is `{ flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.lg }`
  and `card` is `{ width: "100%", maxWidth: 340, padding: Spacing.lg }` — width is bounded,
  height is not. React Native defaults `flexShrink` to 0, so the card keeps its intrinsic
  height and overflows the backdrop in both directions when the viewport is short.

  Intrinsic height, summing the children at `:396-499`:

  | Child | Source | Height |
  |---|---|---|
  | `header` (44pt close button + `marginBottom: Spacing.sm`) | `:414-432` | 52 |
  | `row` — sounds (`minHeight: 44`, label 15pt + sublabel 11pt) | `:433-441` | 48 |
  | `stackRow` ×4 — volume, motion, card back, table felt (`paddingVertical: Spacing.sm` ×2 = 16, label block 31, `gap: Spacing.sm`, `Segmented` `minHeight: 36`) | `:446`, `:456-465` | 4 × 91 = 364 |
  | `row` — haptics (native only) | `:317-336` | 48 |
  | `row` — language | `:338-369` | 48 |
  | `divider` (`marginTop: Spacing.md` + 1 + `marginBottom: Spacing.sm`) | `:483-488` | 25 |
  | `deleteBtn` (`minHeight: 44`) | `:489-495` | 44 |
  | card padding `Spacing.lg` ×2 | `:411` | 48 |
  | backdrop padding `Spacing.lg` ×2 | `:402` | 48 |
  | **Total viewport height required** | | **~725** |
- **Impact:** On any viewport shorter than ~725pt the top and bottom of the card are equally
  off-screen (`justifyContent: "center"`) with no way to scroll to them. That covers: every
  phone in **landscape** (~320–430pt tall) — and landscape is a first-class state, since
  `app/index.tsx:343` renders a whole landscape home screen and the modal deliberately
  declares `supportedOrientations={["portrait","landscape"]}` at `:200`; an iPhone SE in
  portrait (667pt); and a desktop browser window under ~725pt tall (a 1366×768 laptop leaves
  roughly 660pt of viewport). In landscape roughly 300pt — the card-back picker, the felt
  picker, the language selector and the delete-account button — is unreachable, and the
  title bar with the close button is off the top edge too, so the only dismissal left is the
  backdrop `Pressable` at `:203-208`.
- **Repro / proof:** Open the app on a phone held in landscape (or resize a browser window to
  1200×600), tap the gear on the home screen (`app/index.tsx:374` compact / `:434`). The card
  renders at its full ~677pt inside a ~550pt backdrop, centred, clipped at both ends. No
  scroll view exists anywhere in `components/SettingsModal.tsx` — grep the file for
  `ScrollView`: zero hits.
- **Proposed fix:** In `components/SettingsModal.tsx`, wrap the settings rows (everything
  between `header` at `:210` and the closing `</View>` at `:390`) in a `<ScrollView>` with
  `contentContainerStyle={{ gap: 0 }}` and `showsVerticalScrollIndicator`. Add
  `maxHeight: "90%"` to `styles.card` (`:404-413`) so the card never exceeds the backdrop, and
  keep `header` outside the scroll view so the close button is always reachable. `Segmented`
  and the rows need no change.
- **Acceptance criteria:** At viewport 1200×568 and at 375×667, opening settings shows the
  title and close button pinned, and the delete-account button is reachable by scrolling.
  Add a case to `tests/e2e/tapTargets.spec.ts` (which already parameterises viewports at
  `:154`) that opens settings at a 568pt-tall viewport and asserts the
  `settings.deleteAccount` control's bounding box is inside the viewport after scrolling.
- **Fix risk:** A `ScrollView` inside a `Modal` on Android can swallow the backdrop tap if it
  fills the card; keep the backdrop `Pressable` (`:203`) as a sibling of the card, which it
  already is. `tests/orientation.test.ts` scans the `<Modal>` opening tag only, so it is
  unaffected.
- **Depends on:** None

---

### [UI-02] Wrap the portrait room screen in the ScrollView its landscape twin already has
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `app/(online)/room.tsx:583-696` (portrait branch), compare `app/(online)/room.tsx:457-498` (landscape branch)
- **Problem:** The landscape branch wraps the code card, mode pill, format picker and bot
  controls in a `ScrollView` with a comment at `:453-456` stating exactly why: *"at
  phone-landscape heights the code card, mode pill, format picker and bot controls together
  exceed the column, and without this they ran underneath the start button instead of being
  reachable."* The portrait branch at `:583` has no `ScrollView`. Its content lives in a bare
  `<View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 12 }}>`
  at `:599`, and the start button is a sibling `footer` at `:695`.

  Portrait intrinsic height for a **host** with 4 seats and empty seats (so both
  `formatControls` and `botFillControls` render — conditions at `:362` and `:406`):

  | Block | Source | Height |
  |---|---|---|
  | `topBar` (44 back button + 8 + 4) | `:823-831` | 56 |
  | content `paddingTop` | `:599` | 16 |
  | `codeSection` (12×2 padding + 11pt label + 8 + `codeText` at `fontSize: 42` + 8 + `codeActions` 32) | `:874-912` | 135 |
  | `modePill` | `:915-926` | 25 |
  | `MatchLengthControls` (label + `gap` + `option` 51pt) | `:155-190` | 72 |
  | `BotFillControls` (16 padding + 44 row + 8 + two wrapped rows of 44pt `personalityPill`) | `:700-757` | 164 |
  | seat list (title + 4 × `playerItemHeight` 44 + 3 × `playerListGap` 6) | `:325-327`, `:625-683` | 209 |
  | `InviteFriendsPanel` (`minHeight: 110` in portrait) | `:243` | 110 |
  | 6 × `gap: 12` + content `paddingBottom: 8` | `:599` | 80 |
  | `footer` (8 + `MenuButton` md 52 + 2× `marginVertical: Spacing.xs` + 4) | `:968`, `components/MenuButton.tsx:132,157` | 72 |
  | **Total** | | **~939** |

  Plus `MenuLayout`'s top pad — 67 on web (`components/MenuLayout.tsx:30`), `max(insets.top, 20)`
  on native — for **~986–1006pt** required.
- **Impact:** No phone portrait viewport is that tall: 667 (SE), 844 (iPhone 14/15), 852, 915
  (Pixel 7 Pro), 932 (iPhone 15 Pro Max). The host on a 390×844 phone loses ~150pt off the
  bottom — the fourth seat row and the whole invite panel; on a 667pt phone ~330pt, which is
  half the seat list plus the invite panel. The start button stays visible (it is a
  fixed-height sibling), so the host can start a game without ever seeing who joined or being
  able to invite anyone.
- **Repro / proof:** The Playwright spec that covers this screen size,
  `tests/e2e/online.spec.ts:119-128`, sets 390×844 and only asserts the room code matches
  `/^[A-Z0-9]{6}$/` (`:127`). It never touches the seat list, the invite panel or the start
  button on the room screen, so the overflow is uncovered.
- **Proposed fix:** In `app/(online)/room.tsx`, replace the `<View style={{flex:1,...}}>` at
  `:599` with a `<ScrollView style={{flex:1}} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 12 }} showsVerticalScrollIndicator={false}>`,
  closing at `:693`. Leave `footer` (`:695`) outside it so the start button stays pinned, which
  is what the landscape branch does at `:500-502`.
- **Acceptance criteria:** At 390×844 and 375×667, after creating a 4-player room as host with
  bot fill available, all four seat rows and the "invita amici" panel can be scrolled to, and
  the start button remains fixed at the bottom. Extend `tests/e2e/online.spec.ts:119` to
  assert the last seat row's bounding box is reachable after a scroll.
- **Fix risk:** The `InviteFriendsPanel` root is `{ flex: 1, minHeight: 110 }` (`:243`) — inside
  a `ScrollView`'s content container `flex: 1` no longer has a parent height to grow into, so
  it will collapse to `minHeight`. That is the intended size anyway (the inner `FlatList`
  already caps itself at `listMaxHeight`, `:240`), but check it renders three rows.
- **Depends on:** None

---

### [UI-03] Make the portrait home menu scrollable — it already overflows on a current iPhone
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `app/index.tsx:398-459` (portrait branch), `app/index.tsx:605` (`menu` style), compare `app/index.tsx:384-391` (landscape branch, which has a `ScrollView`)
- **Problem:** The landscape branch puts the destination rows in a `ScrollView` (`:384`). The
  portrait branch puts them in `<View style={styles.menu}>` (`:449`), where
  `menu: { flex: 1, paddingHorizontal: 24, justifyContent: "center", gap: 12 }`. `HomeMenuRow`
  has no `flexShrink`, so the rows keep their height and overflow; `justifyContent: "center"`
  splits the overflow across the top and bottom edges.

  Per-row height from `styles.menuButton` (`:606-616`): `paddingVertical: 18` ×2 + the taller
  of the 20pt icon and the 18pt `Rajdhani_600SemiBold` label ≈ **58pt**. `menuButtons(false)`
  (`:329-341`) always renders 7 rows, and 8 when `hasSavedGame` (`:331`).

  | | 7 rows | 8 rows |
  |---|---|---|
  | rows + 12pt gaps | 478 | 548 |

  Space available on a 390×844 iPhone: 844 − `topPad` 47 − `header` ~151 (`:509-539`) − `userRow`
  ~28 (`:540-546`) − `cardDecoration` 77 (`:603-604`) − `footer` 34 (`:674-675`) − `bottomPad + 20`
  54 = **~453pt**.
- **Impact:** On a 390×844 iPhone the seven-row menu overflows by ~25pt and the eight-row menu
  (any player with a saved offline game) by ~83pt — roughly one and a half destinations, split
  between the top and bottom of the list, so "Riprendi partita" at the top and "Regole" at the
  bottom are the ones that go. On a 375×667 iPhone SE only ~276pt is available against 478
  needed: three of the seven destinations are off-screen and there is no scroll gesture to
  reach them.
- **Repro / proof:** `app/index.tsx:398` returns a `<View style={[styles.container, …]}>` with
  no `ScrollView` anywhere in the portrait subtree — grep the file: the single `ScrollView`
  import at `:10` is used once, at `:384`, inside `if (isLandscape)`. The e2e tap-target spec
  (`tests/e2e/tapTargets.spec.ts`) parameterises viewports but asserts touch-target *size*, not
  that every row is inside the viewport.
- **Proposed fix:** In `app/index.tsx`, change `<View style={styles.menu}>` at `:449` to a
  `<ScrollView contentContainerStyle={styles.menu} showsVerticalScrollIndicator={false}>` and
  move `flex: 1` to the `ScrollView`'s `style` (leaving `justifyContent: "center"` and `gap: 12`
  on the content container, so a short list still centres and a long one scrolls).
- **Acceptance criteria:** At 375×667 with `hasSavedGame` true, all eight destinations plus the
  footer are reachable; at 430×932 the list still renders vertically centred with no scroll
  bar. A Playwright case at 375×667 asserts the bounding box of the last `HomeMenuRow` is
  inside the viewport after scrolling.
- **Fix risk:** `menu` currently supplies the flex growth that pushes `footer` to the bottom;
  moving `flex: 1` onto the `ScrollView` preserves that. The staggered mount animation
  (`:71-83`) is unaffected — it runs on mount regardless of scroll position.
- **Depends on:** None

---

### [UI-04] The replay transport controls render behind the game table's top bar and felt
- **Severity:** Medium
- **Confidence:** Medium (layout arithmetic from the constants; confirm by opening a replay on a phone/emulator in landscape)
- **Effort:** S (<1h)
- **Location:** `app/(online)/replay.tsx:115-144` and `app/(online)/replay.tsx:180-186` (`transport` style), `components/GameTable.tsx:903` (`{banners}`), `components/GameTable.tsx:1219-1227` (`topBar`), `components/GameShared.tsx:911-917` (`tableBg`)
- **Problem:** `GameTable` renders its `banners` slot at `:903` as the **first in-flow child** of
  the root `Animated.View` (`styles.root` at `:1217` is `{ flex: 1 }`, a default-column flex
  container; everything around it — the gradient, `topBar`, `tableBg`, `tableOverlay` — is
  absolutely positioned). The replay screen's `styles.transport` (`app/(online)/replay.tsx:180-186`)
  has **no `position`**, so it lays out at y = 0 with height ≈ 52 (44pt buttons +
  `paddingVertical: Spacing.xs` ×2).

  Two absolutely-positioned siblings sit in the same band:
  - `topBar` — `top: frame.topPad`, `height: TOP_BAR_H` (40, `components/gameTableModel.ts:24`),
    `zIndex: 10` (`components/GameTable.tsx:1226`).
  - `tableBg` — `top: frame.tableTop` = `topPad + 40 + 4` (`components/gameTableModel.ts:276`),
    opaque felt gradient, rendered *after* `{banners}` in source order with no `zIndex`, so it
    paints above it.

  On native `computeScreenPads` returns `insets.top` (`components/gameTableModel.ts:246`), which
  is 0 on a phone in landscape. That puts the top bar over y 0–40 and the felt over y ≥ 44 —
  covering the whole 52pt transport row. On web `WEB_TOP_PAD = 67` happens to clear it, which
  is why the bug is invisible in the browser.
- **Impact:** On a phone or tablet, opening a replay from the profile screen
  (`app/(online)/profile.tsx:351`) shows the table with no visible play/pause/step controls.
  The `GameBillboard` inside the top bar (`components/GameTable.tsx:881`) is a plain `View` with
  no `pointerEvents="none"` (`components/GameShared.tsx:1290-1297`), so it also intercepts the
  taps. The replay is stuck on move −1 with no way to advance it.
- **Repro / proof:** `app/(online)/game.tsx:345-357` — the online screen's own banner is
  `position: "absolute", top: 2, …, zIndex: 50`, which is what makes it clear the same top bar.
  The replay screen's banner is the only in-flow one.
- **Proposed fix:** In `app/(online)/replay.tsx`, make `styles.transport` absolutely positioned
  the way the online banner is: `position: "absolute", top: 2, alignSelf: "center", zIndex: 50`.
  Better still, have `GameTable` own this: wrap `{banners}` at `components/GameTable.tsx:903` in
  `<View style={{ position: "absolute", top: frame.topPad + TOP_BAR_H, left: frame.leftPad, right: frame.rightPad, zIndex: 50, alignItems: "center", pointerEvents: "box-none" }}>`
  and drop the per-caller positioning, so the slot's contract is "a banner band under the top
  bar" rather than "you position it yourself".
- **Acceptance criteria:** On a 568×320 viewport (and on an emulator in landscape), the four
  replay transport buttons and the move counter are visible and tappable, and the "next" button
  advances the move counter. The online reconnect banner still renders in the same band without
  covering the card-count badge.
- **Fix risk:** If `GameTable` takes over positioning, `app/(online)/game.tsx:345-357` must drop
  its own `position: "absolute"/top: 2` or it will be positioned twice. `pointerEvents: "box-none"`
  on the wrapper is required, otherwise the band swallows taps meant for the felt.
- **Depends on:** None

---

### [UI-05] The "rotate your device" overlay is hardcoded Italian
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `components/GameTable.tsx:1189-1199`, specifically `:1193` and `:1195`
- **Problem:** Two user-facing strings bypass `t()` entirely:
  `<Text style={portraitOverlayStyles.title}>Ruota il dispositivo</Text>` and
  `<Text style={portraitOverlayStyles.sub}>Il gioco richiede la modalità orizzontale</Text>`.
  A grep of `locales/` for `Ruota`, `orizzontale`, `rotateDevice` and `landscape` returns zero
  matches, so no key exists in `it.ts`, `en.ts` or `sq.ts`. `tests/i18n.test.ts` pins key
  *parity* across the three catalogues, not that every rendered string goes through `t()`, so
  nothing catches this.
- **Impact:** This is the full-screen blocker (`portraitOverlayStyles.overlay`,
  `components/GameShared.tsx:880-886`, `backgroundColor: Colors.overlayOpaque`, `zIndex: 999`)
  that covers the whole table whenever `W < H`. On web — the platform this actually ships on —
  `expo-screen-orientation` cannot force landscape in a desktop browser, so any browser window
  taller than it is wide hits this overlay. An English or Albanian player sees the entire
  screen replaced by two lines of Italian and no other cue.
- **Repro / proof:** Set the locale to `en` in settings, open a game, and resize the browser
  window to be taller than wide. `components/GameTable.tsx:1189` `{W < H && (…)}` fires and
  renders the Italian literals. `useTranslation()` is already in scope in this component (`t`
  is used at `:976`, `:1042`, `:1051`).
- **Proposed fix:** Add `gameTable.rotateTitle` and `gameTable.rotateBody` to `locales/it.ts`
  (source of truth), `locales/en.ts` and `locales/sq.ts`, and replace the two literals at
  `components/GameTable.tsx:1193` and `:1195` with `{t("gameTable.rotateTitle")}` /
  `{t("gameTable.rotateBody")}`.
- **Acceptance criteria:** `npm test` passes `tests/i18n.test.ts` with the three new keys, and
  a source scan for bare non-ASCII display strings inside a `<Text>` in `components/` and
  `app/` returns nothing. Consider adding that scan to `tests/i18n.test.ts` so the class is
  pinned, not just this instance.
- **Fix risk:** None beyond the usual locale-parity check.
- **Depends on:** None

---

### [UI-06] `MenuLayout` imposes no content max-width, so menu screens stretch across a desktop browser
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `components/MenuLayout.tsx:28-77` (no `maxWidth` anywhere), `components/MenuCard.tsx:16` (`width = '100%'` default), `app/(online)/leaderboard.tsx:46-129`, `app/(online)/replay.tsx:84-98`, `app/lobby.tsx:300-362`, `app/+not-found.tsx:15`
- **Problem:** `MenuLayout` applies only horizontal safe-area padding plus `CONTENT_H_PAD = 20`
  (`:11`, `:32-33`). Nothing caps the content width. Three screens work around this by
  hand-rolling their own wrapper — `app/(online)/friends.tsx:523-528`, `app/(online)/profile.tsx:458-463`
  and `app/(online)/index.tsx:332,338`, all `{ width: "100%", maxWidth: 800, alignSelf: "center" }` —
  which is the tell that the shared container should own the bound. The screens that do **not**
  wrap inherit the full viewport.
- **Impact:** The app is served as a web bundle by the Express server, so a 1920-wide desktop
  browser is a real viewport. On the ladder (`app/(online)/leaderboard.tsx`), `MenuCard` renders
  1880pt wide; each row (`:153-163`) becomes `rank` at `minWidth: 28` on the far left, `name`
  at `flex: 1` occupying ~1700pt of empty space, and `rating` at the far right — the rank and
  the rating are a metre apart on a 27" monitor. The back `MenuButton` (`:122-128`, `fullWidth`
  defaults true, `components/MenuButton.tsx:43`) renders as a 1880pt gold pill. `app/lobby.tsx`
  portrait and `app/(online)/replay.tsx`'s error card behave the same way.
- **Repro / proof:** `components/MenuLayout.tsx:37-41` builds `contentStyle` from paddings,
  `centered` and the caller's `style` only; `styles.scroll` is `{ flexGrow: 1 }` (`:75`) and
  `styles.centered` is `{ justifyContent: 'center', alignItems: 'center' }` (`:76`) — `alignItems: center`
  centres the *children*, but `MenuCard`'s `width: '100%'` (`components/MenuCard.tsx:16,18`)
  defeats it.
- **Proposed fix:** In `components/MenuLayout.tsx`, add a `maxWidth` prop defaulting to 800 and
  wrap `{children}` in `<View style={{ width: "100%", maxWidth, alignSelf: "center" }}>` inside
  both the `ScrollView` and the non-scrollable branch (`:54-65`). Then delete the three
  hand-rolled `contentWrapper` max-widths in `friends.tsx`, `profile.tsx` and
  `(online)/index.tsx` so there is one owner. `app/(online)/game.tsx`, `app/game.tsx`,
  `app/result.tsx` and `app/index.tsx` do not use `MenuLayout` and are unaffected.
- **Acceptance criteria:** At a 1920×1080 viewport, the ladder card, the lobby's player list
  and the not-found card are all ≤ 800pt wide and horizontally centred; at 375pt wide nothing
  changes. A Playwright assertion at 1920 wide that `#game-table`-less menu screens have a
  content bounding box ≤ 840pt.
- **Fix risk:** `app/lobby.tsx`'s landscape two-column body (`:315-330`, `landscapeLeftCol` at
  `width: "42%"`) and `app/(online)/room.tsx`'s landscape body assume the full container width;
  capping at 800 narrows both columns. Check those two landscape layouts specifically, or let
  those screens opt out with `maxWidth={undefined}`.
- **Depends on:** None

---

### [UI-07] The numeric half of the design-token scale is unenforced and has been abandoned
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** L (a day+)
- **Location:** `lib/tokens.ts:138-161` (the scales), `eslint.config.js:24-38` (what lint actually catches), `app/lobby.tsx:366-603`, `app/index.tsx:463-676`, `app/(online)/room.tsx:822-977`, `app/result.tsx:451-…`, `components/GameShared.tsx:1033-1206`, `components/GameOverOverlay.tsx:331-501`
- **Problem:** Token discipline is real for **colour** and absent for every **dimension**.
  `eslint.config.js:29,34` only bans a token written as a string (`color: "Colors.gold"`), and
  `tests/tokenRoles.test.ts` only bans a fill/border/scrim token used as text ink. Neither can
  see a bare number. The result:

  | Scale | Token values (`lib/tokens.ts`) | Distinct values actually shipped in `*.tsx` |
  |---|---|---|
  | `FontSize` | 7 — 11, 13, 15, 18, 22, 28, 36 | **21** — 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 32, 36, 38, 40, 42, 56 |
  | `Radius` | 5 — 8, 12, 20, 32, 9999 | **24** — 1, 4, 4.5, 5, 6, 8, 9, 10, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 24, 26, 38, 40, 50, 60 |
  | `Colors` | 40+ | only 4 bare literals repo-wide, all named module constants with a stated reason (`components/GameTable.tsx:1207-1214`) plus one inline `"rgba(40,30,5,0.7)"` at `:1316` |

  The inconsistency is visible *within one screen*. On `app/(online)/room.tsx` the surface
  corner radius is 16 (`:876` code card, portrait), 14 (`:886` code card, landscape), 12
  (`:921` mode pill), 10 (`:526`, `:642` seat rows), and `Radius.md` = 12 (`:703` bot-fill
  section, `:172` format option) — five values for one role on one screen, two of them for the
  same card in two orientations. The same screen's type ladder runs 42 → 26 → 22 → 16 → 15 →
  14 → 13 → 12 → 11 → 10, none of which is a `FontSize` step except 22, 15 and 11.
  `CLAUDE.md` names `app/lobby.tsx` as the reference menu screen; it is the file with the
  densest run of bare literals (`fontSize: 11/22/14/16/16/11/13/15/16/10` at `:412-590`,
  `borderRadius: 12/12/12/20/8/10` at `:424-576`, `padding: 14/10/20`, `paddingVertical: 14/13`).
- **Impact:** Nothing breaks, but the surfaces do not read as one system: cards next to each
  other round differently, and a heading is sometimes smaller than the body text beside it
  (`app/(online)/room.tsx:938` `slotsSectionTitle` at 11 sits above `:956` `slotName` at 14;
  `components/GameOverOverlay.tsx:404-410` `sectionTitle` at 9 sits above `:436-441` `playerName`
  at `FontSize.sm` = 13). New screens have no scale to copy, so each one invents its own.
- **Repro / proof:** `rg -o "fontSize:\s*\d+" --glob '*.tsx'` → 133 hits across 20 files;
  `rg -o "borderRadius:\s*[0-9.]+" --glob '*.tsx'` → 94 hits across 16 files. Both run clean
  against `npm run lint` and `npm test`.
- **Proposed fix:** Two steps, in this order. (1) Add a lint rule alongside the two in
  `eslint.config.js:24-38`: `no-restricted-syntax` on
  `Property[key.name=/^(fontSize|borderRadius|padding|paddingVertical|paddingHorizontal|margin|marginTop|marginBottom|gap)$/] > Literal[value=/^\d+$/]`
  inside `ObjectExpression`s passed to `StyleSheet.create`, scoped to `app/**` and
  `components/**`, with an allow-list for `borderRadius` values that are exactly half a
  sibling `width` (circular avatars). Ship it as a warning first so the count is visible.
  (2) Sweep file by file, mapping each literal to the nearest token: font sizes to `FontSize`,
  corner radii to `Radius`, spacing to `Spacing`. Where nothing fits (a 42pt room code, a 56pt
  wordmark), promote it to a named module constant as `CLAUDE.md` already permits.
- **Acceptance criteria:** The new lint rule is an `error` and `npm run lint` exits 0. The
  distinct-`fontSize` count in `app/` + `components/` is ≤ 9 (the 7 tokens plus at most two
  named display constants), and the distinct non-circular `borderRadius` count is ≤ 5.
- **Fix risk:** Large diff across 20 files, all visual. Sweep one screen per commit and check
  each against `tests/e2e/tableFit.spec.ts` and `tests/e2e/tapTargets.spec.ts` — the table's
  pinned constants (`components/gameTableModel.ts:20-28`, pinned by
  `tests/gameTableModel.test.ts`) must not move.
- **Depends on:** None

---

### [UI-08] `WEB_TOP_PAD`/`WEB_BOTTOM_PAD` already exist and are re-typed as bare 67/34 in five files
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `components/gameTableModel.ts:31-32` (the constants), duplicated at
  `app/index.tsx:319-320`, `app/lobby.tsx:122`, `app/result.tsx:270-271`,
  `components/MenuLayout.tsx:30-31`, `components/NotificationBanner.tsx:60`
- **Problem:** The web substitute for safe-area insets is a named, exported, commented pair of
  constants — `export const WEB_TOP_PAD = 67; export const WEB_BOTTOM_PAD = 34;` — used through
  `computeScreenPads` (`:244-251`) by the game table. Every other screen re-types the numbers:
  `Platform.OS === "web" ? 67 : insets.top` appears verbatim in three screens, one layout
  component and the notification banner. `MenuLayout.tsx:30` even writes it with single quotes
  and different alignment, so a grep for the game-table form does not find it.
- **Impact:** The notification banner positions itself at `topOffset + 8`
  (`components/NotificationBanner.tsx:114`) against a menu screen whose top padding is the same
  67 by coincidence. Change the web pad in `gameTableModel.ts` — which is the file that
  documents it — and the banner, the home screen, the lobby and the result screen all silently
  keep the old value, so the banner drifts off the content's top edge on web only.
- **Repro / proof:** `rg 'Platform.OS === .web. \? \d+'` → 11 hits, none of which import
  `WEB_TOP_PAD`. `components/gameTableModel.ts` is a runtime-import-free pure module
  (`:1-8`), so importing the constants from it costs nothing.
- **Proposed fix:** Import `WEB_TOP_PAD` / `WEB_BOTTOM_PAD` from `@/components/gameTableModel`
  at the five call sites and replace the literals. If a pure-layout module feels like the wrong
  home for a value the menu kit also needs, move the two constants to `lib/tokens.ts` and
  re-export them from `gameTableModel.ts`; `lib/tokens.ts` is already the react-native-free
  module tests import directly.
- **Acceptance criteria:** `rg 'Platform.OS === .web. \? (67|34)'` returns zero hits. A test in
  `tests/gameTableModel.test.ts` (or a new `tests/webPads.test.ts`) source-scans `app/` and
  `components/` for the literal pattern and fails on a reintroduction.
- **Fix risk:** None — the values are identical today, so the change is a pure refactor.
- **Depends on:** None

---

### [UI-09] The reaction panel's hardcoded `top: 52` puts it over the top bar on web
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `components/ReactionLayer.tsx:138-152` (`panel`), `components/GameTable.tsx:865-901` (`topBar`, positioned at `top: frame.topPad`), `components/gameTableModel.ts:24,31` (`TOP_BAR_H = 40`, `WEB_TOP_PAD = 67`)
- **Problem:** `panel` is `{ position: "absolute", right: 12, top: 52, width: 208, zIndex: 100 }`.
  52 is `0 + TOP_BAR_H + 12` — correct only when the top pad is 0. On web the pad is
  `WEB_TOP_PAD = 67`, so the top bar occupies y 67–107 while the panel starts at y 52 and, with
  `padding: Spacing.sm` and at least one 44pt row, extends to y ≥ 112. Its `zIndex: 100` beats
  the top bar's `zIndex: 10` (`components/GameTable.tsx:1226`), and its x range (`right: 12`,
  `width: 208`) covers the whole `topBarRight` group (`:895-900`).
- **Impact:** On web, tapping the emoji trigger opens the picker *over* the trigger it dropped
  from and over the live card-count badge (`components/GameTable.tsx:896-898`), hiding the
  viewer's own hand size for the 4 seconds the panel stays open
  (`app/(online)/game.tsx:37,189-192`). On native (pad 0) it sits correctly below the bar.
- **Repro / proof:** Open an online game in a browser, tap the emoji trigger in the top-right.
  The panel's top edge is 15pt above the top bar's top edge.
- **Proposed fix:** `ReactionPanel` should be positioned by its host rather than guessing. Give
  it a `top` prop and pass `frame.topPad + TOP_BAR_H + Spacing.sm` from
  `app/(online)/game.tsx:280`, the same way `RematchPromptPanel` already receives
  `top={frame.topPad + TOP_BAR_H + TABLE_M + Spacing.sm}` at `components/GameTable.tsx:1170`.
  Failing that, import `WEB_TOP_PAD` and compute `Platform.OS === "web" ? WEB_TOP_PAD + 52 : 52`.
- **Acceptance criteria:** On a 1280×800 browser viewport and on a 568×320 native viewport, the
  panel's top edge is below the top bar's bottom edge, and the card-count badge stays visible
  while the panel is open.
- **Fix risk:** `app/(online)/game.tsx` does not currently compute `frame`, only `pads`
  (`:171`); `pads.topPad + TOP_BAR_H` is the value needed and `TOP_BAR_H` is already exported
  from `gameTableModel`.
- **Depends on:** None

---

### [UI-10] The replay screen renders a blank screen while it loads
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `app/(online)/replay.tsx:30-33`, `app/(online)/replay.tsx:101`
- **Problem:** The query at `:30` has no `placeholderData` and the component returns `null` at
  `:101` (`if (!state) return null;`) for every state that is not "loaded and parsed". There is
  no `isLoading` branch. Between tapping a replay row in the profile
  (`app/(online)/profile.tsx:348-374`) and `/api/replays/:id` resolving, the route renders
  nothing at all — not even `MenuLayout`'s backdrop gradient, since that lives inside the
  error branch (`:84-98`) and never runs here.
- **Impact:** A visible flash of empty screen on every replay open, longer on a slow
  connection, with no spinner and no way to tell the tap registered. Every other data-backed
  screen in the app handles this: `app/(online)/profile.tsx:95-101` (`LoadingBlock`),
  `app/(online)/leaderboard.tsx:62-66`, `app/(online)/friends.tsx:261-267`,
  `app/(online)/quickmatch.tsx:250`, `app/(online)/_layout.tsx:13`.
- **Repro / proof:** `useQuery` at `:30` destructures only `data` and `isError`; `isLoading` is
  never read anywhere in the file.
- **Proposed fix:** Destructure `isLoading` at `app/(online)/replay.tsx:30` and add, before the
  `isError` branch at `:83`, a loading branch reusing the same `MenuLayout` + `MenuCard` shell:
  `<MenuLayout><MenuCard title={t("replay.title")}><ActivityIndicator color={Colors.gold} accessibilityLabel={t("replay.loadingA11yLabel")} /></MenuCard></MenuLayout>`.
  The key `replay.loadingA11yLabel` already exists — `app/(online)/profile.tsx:325` uses it.
- **Acceptance criteria:** With the network throttled, opening a replay shows a gold spinner
  inside the replay card until the table appears; the error and loaded paths are unchanged.
- **Fix risk:** None. Keep `if (!state) return null` as the final fallback for a resolved-but-
  unparseable replay.
- **Depends on:** None

---

### [UI-11] The profile's ladder card is the only data card with no error state
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S (<1h)
- **Location:** `app/(online)/profile.tsx:295-320`
- **Problem:** Four of the five `MenuCard`s on the profile handle loading, error and empty:
  stats (`:209-224`), history (`:243-258`), replays (`:325-340`), achievements (`:384-392`).
  The ladder card handles `ratingQuery.isLoading` (`:297`) and the success case (`:298-310`)
  but never `ratingQuery.isError` — the file's own `ErrorBlock` helper (`:103-129`) is used
  four times and not here.
- **Impact:** When `/api/ratings/me` fails, the ladder card renders as a titled card containing
  nothing but the "open ladder" button. No message, no retry — it reads as "you have no
  rating" rather than "we could not load it", and the only way to recover is a full screen
  reload.
- **Repro / proof:** Compare `:296-319` against `:242-291`; the `{historyQuery.isError && …}`
  clause has no counterpart in the ladder block.
- **Proposed fix:** Add
  `{ratingQuery.isError && <ErrorBlock title={t("ladder.errorTitle")} retryLabel={t("common.retry")} retryA11yLabel={t("ladder.errorRetry")} onRetry={() => ratingQuery.refetch()} />}`
  after `:297`. Both keys already exist — `app/(online)/leaderboard.tsx:71,73` uses them.
- **Acceptance criteria:** With `/api/ratings/me` returning 500, the ladder card shows the
  alert icon, the error title and a working retry button, matching the other four cards.
- **Fix risk:** None.
- **Depends on:** None

---

### [UI-12] A notification that arrives while the settings modal is open is never seen
- **Severity:** Low
- **Confidence:** Medium (React Native's `<Modal>` renders in a separate native window on iOS/Android and is portalled out of the app root by react-native-web; confirm by opening settings on a device and having a friend send an invite)
- **Effort:** M (a few hours)
- **Location:** `components/SettingsModal.tsx:192-201`, `components/NotificationBanner.tsx:149-155` (`zIndex: 9999`), `components/OfflineBanner.tsx:56-68` (`zIndex: 10000`), `app/_layout.tsx:36-51` (both banners are siblings of the `<Stack>`, inside the app root `View`)
- **Problem:** `SettingsModal` is the only real `<Modal>` in the app's normal flow (the other,
  `components/ErrorFallback.tsx:121`, only appears after a crash). A `<Modal>` is not part of
  the sibling stacking context that `NotificationBanner`'s `zIndex: 9999` and
  `OfflineBanner`'s `zIndex: 10000` compete in — no z-index in the app root can paint above it.
- **Impact:** Settings is opened from the home screen (`app/index.tsx:374`, `:434`), which is
  exactly where friend requests and game invites arrive via `SocketContext`. The banner slides
  in behind the modal, waits out its 4.5s (`components/NotificationBanner.tsx:51`) and
  dismisses itself, all unseen. The invite is recoverable — `gameInvites` persists and is
  listed on `app/(online)/friends.tsx:321-358` — but the player is given no reason to look.
  The offline banner has the same problem: losing the network while settings is open shows
  nothing.
- **Repro / proof:** The two banners are rendered at `app/_layout.tsx:48-49` as children of the
  root `<View style={{ flex: 1 }}>` at `:37`; `SettingsModal` is rendered from inside the
  `<Stack>` subtree at `app/index.tsx:393`/`:458` but presents outside it.
- **Proposed fix:** Two options, pick one. (a) Have `SettingsModal` close itself when a
  notification arrives — subscribe to `useNotification()` inside it and call `onClose()` on a
  new notification; simple, but it steals the screen. (b) Render a second
  `<NotificationBanner>` inside the modal's `backdrop` (`components/SettingsModal.tsx:202`),
  fed by the same `useNotification()` queue, so the banner appears wherever the topmost surface
  is. (b) matches the "always mounted, never returns null" contract the banner already has.
- **Acceptance criteria:** With settings open, dispatching a notification through
  `NotificationContext` shows the banner above the modal card, and dismissing it (tap or
  timeout) leaves the modal open. Add a case to `tests/native/render.test.tsx`, which already
  asserts the banner never unmounts.
- **Fix risk:** Two mounted banners reading one queue will both animate; the modal copy must be
  the only one that renders visibly while `visible` is true, or the dismissal callback fires
  twice. Option (a) avoids that entirely at the cost of closing a screen the user opened.
- **Depends on:** None

---

## Reference tables

### Overlay stacking inventory

Everything that can cover the game table, in the order it actually paints. Values are the
`zIndex` in the source; ties are broken by render order within the same parent.

| Overlay | File:line | zIndex | Parent | Co-occurs with |
|---|---|---|---|---|
| `OfflineBanner` | `components/OfflineBanner.tsx:62` | 10000 | app root (`app/_layout.tsx:49`) | everything except `<Modal>` (UI-12) |
| `NotificationBanner` | `components/NotificationBanner.tsx:154` | 9999 | app root (`app/_layout.tsx:48`) | everything except `<Modal>` (UI-12) |
| portrait-rotate overlay | `components/GameShared.tsx:885` | 999 | `GameTable` root | any table state; untranslated (UI-05) |
| `GameOverOverlay` | `components/GameOverOverlay.tsx:334` | 300 | `overlays` slot | error toast (same z, paints later → wins) |
| online error toast | `app/(online)/game.tsx:414` | 300 | `overlays` slot | `GameOverOverlay` |
| `FloatingReactions` | `components/ReactionLayer.tsx:168` | 200 | `overlays` slot | everything below 200 |
| `ExchangeAnnouncement` | `components/ExchangeAnnouncement.tsx:264` | 150 | `GameTable` (before `overlays`) | mutually exclusive with `StartReasonBanner` by design (`components/GameTable.tsx:1145`) |
| `ExchangeModal` | `components/ExchangeModal.tsx:244` | 110 | `GameTable` (before `overlays`) | covers `ReactionPanel` (110 > 100) |
| `ReactionPanel` | `components/ReactionLayer.tsx:151` | 100 | `overlays` slot | mis-anchored on web (UI-09) |
| online "waiting for exchange" | `app/(online)/game.tsx:374` | 100 | `overlays` slot | below `ExchangeAnnouncement`, correct |
| `FlyingCards` | `components/GameShared.tsx:1042` | 60 | `GameTable` root | — |
| `StartReasonBanner` | `components/GameShared.tsx:849` | 50 | `GameTable` root | — |
| online reconnect banner | `app/(online)/game.tsx:356` | 50 | `banners` slot | covers `GameBillboard` (deliberate, `:253-255`) |
| `RematchPromptPanel` | `components/GameTable.tsx:1330` | 20 | `GameTable` root | — |
| pile winner tag | `components/GameShared.tsx:1138` | 20 | felt | — |
| `topBar` | `components/GameTable.tsx:1226` | 10 | `GameTable` root | covers the replay transport row on native (UI-04) |
| replay transport | `app/(online)/replay.tsx:180` | *(none — in flow)* | `banners` slot | UI-04 |

No pair covers its own dismissal control except the two called out (UI-01 close button, UI-04
transport). `ExchangeModal` deliberately has no dismiss — the exchange is compulsory.

### Consistency sweep — values actually used per component

| Component / screen | Surface corner radius | Button height | Body font sizes |
|---|---|---|---|
| `components/MenuButton.tsx` | `Radius.full` (`:131`) | 44 / 52 / 60 (`:156-158`) | `FontSize.md/lg/xl` (`:162-164`) |
| `components/MenuCard.tsx` | `Radius.lg` = 20 (`:61`) | — | `FontSize.sm` (`:53`) |
| `components/SettingsModal.tsx` | `Radius.lg` card, `Radius.sm` segment (`:408,:462`) | 36 segment / 44 delete (`:458,:490`) | tokens only |
| `app/lobby.tsx` | 12, 12, 12, 20, 8, 10 (`:424,:483,:507,:516,:554,:576`) | 44 min, `paddingVertical: 14/13` (`:423,:482`) | 11, 22, 14, 16, 11, 13, 15, 16, 10 |
| `app/index.tsx` | 6, 20, 14, 16, 9, 14, 8, 5 (`:520-670`) | `paddingVertical: 18/12` (`:611,:617`) | 38, 10, 18, 11, 56, 10, 13, 13, 12, 14, 10, 24, 18, 15, 12 |
| `app/(online)/room.tsx` | 10, 15, 8, 16, 14, 12, 18 (`:248-950`) | 44 / 36 by orientation (`:325`) | 15, 11, 13, 14, 42, 26, 16, 10 |
| `app/(online)/friends.tsx` | 21, 6, 18, 10, 14 (`:572-678`) | 36 / 44 (`:598,:614`) | 11, 18, 14, 15 + tokens |
| `app/(online)/profile.tsx` | 24, 16, 18 + `Radius.md` (`:476,:495,:526,:555`) | 44 (`:493,:521`) | tokens only |
| `app/(online)/leaderboard.tsx` | `Radius.sm` (`:159`) | via `MenuButton` | tokens only |
| `components/GameOverOverlay.tsx` | 14, 22, 6, 10, 12, 6 + `Radius.md` (`:344-465`) | `paddingVertical: 9` → ~36 (`:463,:482`) | `FontSize.lg`, 9, 10, `FontSize.sm`, 10 |
| `components/GameShared.tsx` (felt) | 22 outer, 18 inner, 9, 10, 14 (`:913-1186`) | — | 10, 26, 14, 10, 13, 9, 8, 10 |

`app/(online)/profile.tsx` and `app/(online)/leaderboard.tsx` are the two screens that stay
inside the scale; they are the ones to copy from, not `app/lobby.tsx`, which `CLAUDE.md`
currently names as the reference.

### Dark mode

**The app is dark-only by design and nothing assumes otherwise.** `app.json:9` sets
`"userInterfaceStyle": "dark"`; `useColorScheme` and `prefers-color-scheme` appear nowhere in
`app/`, `components/` or `lib/` (the one `prefers-color-scheme` hit is
`server/templates/landing-page.html:264`, the Expo Go QR page, which is not the app).
`lib/tokens.ts` defines a single palette with no light variant. `Colors.white` is used only as
ink on a saturated fill (`components/MenuButton.tsx:170` on `Colors.danger`,
`app/index.tsx:528,600` on `Colors.danger`, `app/(online)/game.tsx:420` on `Colors.dangerScrim`)
and as a `Switch` thumb (`components/SettingsModal.tsx:237,330`) — never as a surface. That is
correct for a dark-only app and `tests/contrast.test.ts` already pins the `white`-on-`danger`
ratio. No finding.

---

## Coverage gaps

1. **No rendering.** I could not take a screenshot, run Playwright (forbidden — it writes to
   `tests/e2e/test-results/`) or boot a simulator. Every layout claim is arithmetic on style
   objects. The overflow findings (UI-01, UI-02, UI-03) are the ones most worth confirming
   visually before anyone spends effort; the height sums are itemised so they can be checked
   line by line.
2. **Native-only claims are inferred.** UI-04 depends on `insets.top === 0` for a phone in
   landscape. That is true on every iPhone and on Android without a landscape cutout, but I did
   not observe it. Confirming needs an emulator.
3. **`react-native-web` `<Modal>` layering** (UI-12) is stated from library behaviour, not from
   a run. On iOS/Android the separate-window behaviour is certain; on web it depends on RNW
   0.21's portal implementation, which I did not read in `node_modules`.
4. **Files I did not read in full:** `components/CardView.tsx` (689 L — `tests/cardFace.test.ts`
   and `tests/suitColours.test.ts` cover its geometry and ink, and it was clean in the parts I
   sampled), `app/tutorial.tsx` (it bounds itself at `maxWidth: 560`, `:731`), `app/rules.tsx`
   (bounds itself at `maxWidth: 800`, `:228`), `app/auth.tsx` (bounds itself at 480, `:202`),
   `components/ErrorFallback.tsx`, `components/ResultExchangeOverlay.tsx`. I checked each for
   the specific things in my scope (max-width, loading/empty states, `<Modal>` usage, z-index)
   but did not audit their full style sheets.
5. **Long-username handling is only partly checked.** `RegisterSchema` caps usernames at 30
   characters (`server/schemas.ts:4-7`); the DB column is unbounded `text`
   (`shared/schema.ts:8`), so a name longer than 30 can only arrive from a direct DB write. At
   30 characters the table seat labels truncate correctly (`components/GameShared.tsx:1060-1066`,
   `maxWidth: 70` + `numberOfLines={1}` at `:306`, `:351`), as do the leaderboard row
   (`app/(online)/leaderboard.tsx:114`), the game-over rank card
   (`components/GameOverOverlay.tsx:113`) and the room seat (`app/(online)/room.tsx:541`,
   `:657`). The one place with no `numberOfLines` is the friends list row name
   (`app/(online)/friends.tsx:300`, `:332`, `:369`, `:406`, `:470`) inside
   `rowInfo: { flex: 1 }` — a long name wraps to a second line and grows the row rather than
   breaking it, which is why I did not raise it as a finding.
6. **2-player vs 4-player at the table** was checked through `arrangeOpponents`
   (`components/gameTableModel.ts:83-95`) and its 62 pinned cases in
   `tests/gameTableModel.test.ts`, not visually. `tests/e2e/tableFit.spec.ts` already
   parameterises viewport × player count and asserts no card escapes the viewport, so this is
   the best-covered part of my scope.

## Opinions (non-findings)

- **`app/index.tsx`'s two orientation branches are near-duplicates.** The portrait and
  landscape returns (`:343-395` and `:398-459`) each carry their own title, subtitle, suit
  decoration, user row and footer with parallel style pairs (`title`/`titleLandscape`,
  `subtitle`/`subtitleLandscape`, `userRow`/`userRowLandscape`, `cardDecoration`/
  `cardDecorationLandscape`, `suitDecor`/`suitDecorSmall`). That is 12 styles maintained in
  pairs. Taste, not a defect — but it is why the landscape branch got a `ScrollView` and the
  portrait one did not (UI-03).
- **`MenuLayout`'s `CONTENT_H_PAD = 20`** (`components/MenuLayout.tsx:11`) sits between
  `Spacing.md` (16) and `Spacing.lg` (24). It is a named module constant, which `CLAUDE.md`
  explicitly permits, so it is not a violation — but the whole app's menu gutter being off the
  spacing scale is what makes every screen's inner padding a judgement call.
- **`components/GameOverOverlay.tsx`'s action buttons are ~36pt tall** (`paddingVertical: 9` at
  `:463` and `:482` plus a 15pt label). The app's own convention is `minHeight: 44` — it appears
  in 20+ places. `tests/e2e/tapTargets.spec.ts` covers menus, the table, the lobby and
  profile/ladder, not the game-over overlay, so this is unpinned. I am leaving it to B4 rather
  than double-reporting an accessibility finding.
- **`components/GameShared.tsx:840-873` writes its styles inline in JSX** rather than through
  `StyleSheet.create`, unlike every other component in the repo. Functionally identical on
  modern RN; stylistically the odd one out.

## Open questions for the human

1. **Is native a shipping target today, or is this web-only for now?** UI-04 is native-only and
   UI-12 is worst on native. `eas.json` exists but `.github/workflows/eas-build.yml:3-6` says
   the submit credentials are still placeholders, so if nobody can install the app on a phone,
   UI-04 drops to a latent bug and UI-01 halves in severity. This changes the priority order of
   four findings.
2. **What is the intended desktop-web experience?** Three screens bound themselves at 800pt and
   four do not (UI-06). Is 800 the house number, or should menu screens get a wider two-column
   layout on a large viewport rather than a centred column?
3. **`CLAUDE.md` names `app/lobby.tsx` as the reference menu screen.** By the numbers,
   `app/(online)/profile.tsx` and `app/(online)/leaderboard.tsx` are the ones that actually
   follow the design system — they use tokens throughout and handle loading/error/empty for
   every data block. Should the doc be repointed at those two before anyone copies `lobby.tsx`
   again? (Repointing is a one-line docs change; I did not make it, since this pass is
   read-only.)
