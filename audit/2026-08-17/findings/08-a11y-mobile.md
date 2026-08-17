# B4 — Accessibility & mobile/touch

Audit of `b894af4`, read-only. Every contrast ratio below was computed with the same WCAG 2.x
maths `tests/contrast.test.ts` uses (sRGB → linear → relative luminance, alpha flattened onto the
opaque backdrop), not eyeballed. Every layout number was computed from the source constants.

**What is already pinned, and what I checked around it:**

| Pinned test | What it actually covers | The gap I hunted |
|---|---|---|
| `tests/contrast.test.ts` | 10 named `Colors.*` against exactly three surfaces: `bg`, `bgCard`, `felt` | `bgSurface`/`bgElevated`, the felt *gradient stops*, translucent chip fills, `Colors.danger` (in neither list) |
| `tests/e2e/tapTargets.spec.ts` | **occlusion only** — is a control's centre point covered by something inert. It never measures a rect | target *size*. Nothing in the repo asserts 44pt/48dp anywhere |
| `tests/reducedMotion.test.ts` | the file containing an animation *mentions* `usePrefersReducedMotion` | per-animation gating inside a file that mentions it once |
| `tests/native/a11yCollapse.test.tsx` | one accessible node per labelled control, **under jest-expo (native)** | web, where the props that do the hiding are dropped |
| `tests/orientation.test.ts` | every `<Modal>` declares `supportedOrientations` | there are only two `<Modal>`s; the six blocking overlays are not modals at all |
| `tests/suitColours.test.ts` | suit ink under CVD simulation | other colour-only channels: turn, selection, disabled, team |
| `tests/cardNames.test.ts` | `cardSpokenName` across locales | whether the name reaches a screen reader (it does; the *table state* does not) |

---

### [A11Y-01] Attach the table and hand screen-reader descriptions to a real accessibility node
- **Severity:** High
- **Confidence:** High (read the code, and read react-native-web 0.21.2's source)
- **Effort:** M
- **Location:** `components/GameTable.tsx:932-944`, `components/GameTable.tsx:1058`, supported by `components/gameTableModel.ts:325-419`
- **Problem:** `describeTableForA11y` builds the entire spoken state of the table — whose turn it
  is, what was last played and by whom, every opponent's card count, the exchange phase — and
  `GameTable` attaches the result to a bare `<View accessibilityLabel={tableA11yLabel}>` with **no
  `accessibilityRole` and no `accessible`** (the comment at `:926-931` says `accessible` is omitted
  deliberately so the buttons underneath stay reachable). The hand summary at `:1058` is the same
  shape. Neither reaches a screen reader:
  - **Web (the shipped platform).** `react-native-web@0.21.2` renders `View` as the element chosen
    by `propsToAccessibilityComponent` (`node_modules/react-native-web/dist/modules/AccessibilityUtil/propsToAccessibilityComponent.js:11-53`);
    with no role that returns `undefined`, so the element is a plain `<div>`, and
    `accessibilityLabel` becomes `aria-label` on it. A `<div>` with no role has the implicit ARIA
    role `generic`, for which `aria-label` is **name-prohibited** — browsers do not compute an
    accessible name for it and screen readers do not announce it. The attribute is in the DOM
    (which is why `tests/e2e/helpers/bot.ts:26,38` can read it with Playwright), but Playwright
    reads raw attributes, not the accessibility tree.
  - **iOS.** React Native only makes a view an accessibility element when `accessible` is true.
    With `accessible` unset on a `View`, `accessibilityLabel` sets a label on a view VoiceOver will
    never focus.
  - **Android.** The label becomes a `contentDescription` on a `ViewGroup` whose children are all
    individually focusable, so TalkBack walks the children and never stops on the container.

  There is also no `accessibilityLiveRegion` / `aria-live` anywhere on the table state, and no
  `AccessibilityInfo.announceForAccessibility` call exists anywhere in the repo (grepped
  `app/ components/ context/ lib/` — the only `AccessibilityInfo` uses are the reduced-motion
  listeners in `lib/accessibility.ts:57,63`). So even a screen reader that *did* find the label
  would only hear it on manual focus, never when the turn changes.
- **Impact:** A blind player cannot play. They can hear each card in their hand
  (`CardView` labels work — those are real `<button>` elements), and they can hear the GIOCA button
  say why it is unavailable, but they can never learn whose turn it is, what combination is on the
  pile, how many cards each opponent holds, or that the exchange phase is waiting on them. Three
  locales' worth of translated strings (`gameTable.a11yYourTurn`, `a11yTurnOf`, `a11yOpponentCards`,
  `a11yHandCount`, `a11yExchangeGive`, … all present in `it`/`en`/`sq`) and 95 lines of pure,
  unit-tested formatting code reach nobody. `docs/BACKLOG.md` O4 ("VoiceOver/TalkBack flow
  unverified") is the standing reason this was never caught.
- **Repro / proof:** Build the web bundle, start an offline game, and inspect the element carrying
  `data-testid="game-table"` in Chrome DevTools → Accessibility pane: the node has no computed
  name. Equivalently, `document.querySelector('[data-testid="game-table"]')` is a `<div>` (not a
  `<button>`/`<section>`), and `getAttribute('role')` is `null`.
- **Proposed fix:** Stop overloading the layout container. In `components/GameTable.tsx`, render a
  dedicated, visually-empty status node as the first child of the root view:
  ```tsx
  <Text
    accessible
    accessibilityRole="text"
    accessibilityLiveRegion="polite"
    accessibilityLabel={tableA11yLabel}
    style={styles.srOnly}          // width/height 1, overflow hidden, absolute, opacity 0
  >{tableA11yLabel}</Text>
  ```
  `Text` with `accessible` is a real accessibility element on iOS/Android and renders as a `<div>`
  whose *text content* names it on web — which is not name-prohibited — and
  `accessibilityLiveRegion` maps to `aria-live="polite"` in RNW's forwarded props, so every turn
  change is announced. Do the same for `handA11yLabel` at `:1058`. Keep the existing
  `accessibilityLabel` on the container **only if** `tests/e2e/helpers/bot.ts` still needs it as a
  Playwright hook; if so, add a comment saying it exists for the harness, not for users, and point
  the harness at the new node instead so there is one source.
- **Acceptance criteria:**
  1. A jest-expo test under `tests/native/` renders `<GameTable>` and asserts
     `getByLabelText(/È il tuo turno/)` resolves with `includeHiddenElements: false`, and that the
     node's `accessibilityLiveRegion` is `"polite"`.
  2. A source-scan test (same shape as `tests/reducedMotion.test.ts`) asserts no `View` in
     `components/` or `app/` carries `accessibilityLabel` without either `accessible` or
     `accessibilityRole` — this is the class of bug, not just the instance.
  3. `tests/e2e/*` still pass (the bot's `tableDescription()` must keep working).
- **Fix risk:** An always-mounted `aria-live` region that re-announces on every re-render is worse
  than silence. Gate it: only the assembled sentence changes should push, which
  `describeTableForA11y`'s string identity already gives you. Watch that the srOnly style does not
  use `display:none` or `visibility:hidden` (both remove it from the tree).
- **Depends on:** None

---

### [A11Y-02] Make the blocking game overlays real modals — they leave the table focusable behind them
- **Severity:** High
- **Confidence:** High (read the code)
- **Effort:** M
- **Location:** `components/ExchangeModal.tsx:158-163`, `components/GameOverOverlay.tsx:204-208`, `components/ResultExchangeOverlay.tsx`, `components/ExchangeAnnouncement.tsx:147-148`, `components/GameTable.tsx:1189-1199` (portrait overlay)
- **Problem:** Only two components in the repo use React Native's `<Modal>` —
  `components/SettingsModal.tsx:192` and `components/ErrorFallback.tsx:121` — and those two are
  fine: RNW's `Modal` ships a focus trap (`node_modules/react-native-web/dist/exports/Modal/ModalFocusTrap.js`)
  and closes on Escape (`.../ModalContent.js:26-35`). Every other blocking layer in the game is a
  plain `<Animated.View>` with `StyleSheet.absoluteFillObject` and a high `zIndex`. An absolutely
  positioned view covers pixels; it does not remove anything from the tab order or the
  accessibility tree, and nothing in these files moves focus in, traps it, restores it on close, or
  wires Escape. There is no `aria-modal`, no `inert`, no `accessibilityViewIsModal` on any of them
  (the one `accessibilityViewIsModal` in the repo is `SettingsModal.tsx:206`, and RNW does not
  forward that prop either — see A11Y-03).
  - `ExchangeModal` (z-index 110) is **mandatory**: the hand cannot continue until the winner picks
    a card. Underneath it the 13–14 hand cards are still `<button>` elements with `tabIndex=0`
    (RNW's `Pressable` sets `tabIndex = disabled ? -1 : 0`, `dist/exports/Pressable/index.js:117-121`),
    as are PASSA, GIOCA and the quit button.
  - The portrait overlay at `GameTable.tsx:1189-1199` covers the whole table when `W < H`, yet
    every control beneath it stays focusable and readable — a phone user who rotated to portrait
    can still tab to GIOCA and play a card they cannot see. (`tests/e2e/tapTargets.spec.ts:105-112`
    explicitly *skips* any element covering ≥50% of the viewport, so this overlay is exempted from
    the one sweep that might have noticed.)
- **Impact:** A keyboard-only or screen-reader player reaching the exchange phase is stuck: Tab
  cycles through a dozen inert cards behind a scrim and the card picker is somewhere in that order
  with nothing marking it as the only live region of the screen. Sighted mouse users are unaffected.
  Escape does nothing on any of these overlays, which is the reflex on web.
- **Repro / proof:** Play an offline 2-player manche to its end so the exchange fires, then press
  Tab repeatedly: focus visits the hand cards under `[data-testid="game-table"]` before reaching
  `ExchangeModal`'s `SelectableCard` buttons. Structurally: `ExchangeModal.tsx:239-245`
  `styles.overlay` is `{...StyleSheet.absoluteFillObject, zIndex: 110}` and nothing else.
- **Proposed fix:** Two options, in order of preference.
  1. Wrap each of the five overlays in RN's `<Modal transparent visible onRequestClose={...}
     supportedOrientations={["portrait","landscape"]}>` — this buys the focus trap, Escape and
     `aria-modal` for free on web and satisfies the existing `tests/orientation.test.ts` invariant.
     `ExchangeAnnouncement` and the portrait overlay both already have a natural dismiss/absence
     condition to feed `onRequestClose`.
  2. If a real `Modal` breaks the table's landscape lock or the flying-card layer, add an explicit
     inert layer instead: set `aria-hidden`/`inert` on the table subtree while an overlay is up,
     move focus to the overlay's first control on mount, restore it on unmount, and handle Escape.
     This is more code and more to get wrong.
  For the portrait overlay specifically, option 1 plus `pointerEvents` is not enough on its own —
  the controls must leave the tab order, which only `inert`/`Modal` does.
- **Acceptance criteria:**
  - A Playwright spec: open the exchange phase, press Tab five times, assert
    `document.activeElement.closest('[data-testid="game-table"]')` is `null` every time.
  - Pressing Escape with `ExchangeModal` / `GameOverOverlay` / the portrait overlay up either
    dismisses it or is a documented no-op with a reason.
  - A source-scan test listing the overlay components and asserting each renders a `<Modal>` (or
    carries an explicit, named exemption).
- **Fix risk:** RN `Modal` renders into a separate root; the flying-card layer
  (`GameShared.tsx:1034-1049`, `zIndex: 60`) and the table's `shakeStyle` transform live in the
  screen's own tree, so an overlay moved into a portal will no longer inherit them. `ExchangeModal`
  is currently a *sibling* of the table (`GameTable.tsx:1154-1165`), which
  `tests/e2e/helpers/bot.ts:280-297` depends on for its selector — that helper will need updating.
- **Depends on:** None

---

### [A11Y-03] Stop relying on props react-native-web silently drops (`accessibilityState`, `accessibilityHint`, `accessibilityElementsHidden`)
- **Severity:** Medium
- **Confidence:** High (read react-native-web 0.21.2's `forwardedProps` allow-list)
- **Effort:** M
- **Location:** `node_modules/react-native-web/dist/modules/forwardedProps/index.js:10-118` (the allow-list); 24 `accessibilityState` sites and 19 `accessibilityHint` sites across `app/` and `components/` — worst instances `components/GameOverOverlay.tsx:283-293`, `app/auth.tsx:92-99`, `components/CardView.tsx:574-576`, `components/SettingsModal.tsx:96-104`
- **Problem:** `react-native-web@0.21.2` builds a `View`'s DOM props by `pick()`ing an explicit
  allow-list (`dist/exports/View/index.js:26,33,88`). That list contains `aria-selected`,
  `accessibilitySelected`, `aria-disabled`, `aria-describedby` and so on — but it contains **no
  `accessibilityState`, no `accessibilityHint`, no `accessibilityElementsHidden` and no
  `importantForAccessibility`**. `grep -rl accessibilityHint node_modules/react-native-web/dist/`
  returns nothing at all; `accessibilityState` appears only in `TouchableWithoutFeedback` and a
  dead `accessibilityStates` check. Everything the app sets through those props reaches the DOM as
  nothing.

  What that costs, concretely:
  - **`GameOverOverlay.tsx:283-293`** — the rematch/next-hand button uses
    `onPress={hasVoted ? undefined : onVoteRematch}` and `accessibilityState={{ disabled: hasVoted }}`
    but **never sets the `disabled` prop**. RNW's `Pressable` derives `aria-disabled` and
    `tabIndex` from the `disabled` prop only (`dist/exports/Pressable/index.js:117-124`), so after
    voting the button is announced as an enabled button, stays in the tab order, and does nothing.
  - **`app/auth.tsx:92-99`** — the login/register switcher uses `accessibilityRole="tab"` with
    `accessibilityState={{ selected }}`. On web that is a `div role="tab"` with no `aria-selected`
    and no `role="tablist"` parent: an invalid tab that never says which one is current.
  - **`CardView.tsx:574-576`** — a selected card's *only* accessibility signal is an
    `accessibilityHint`. On web that signal does not exist (see A11Y-04).
  - **`SettingsModal.tsx:96-104`** — `role="radio"` inside `role="radiogroup"` with no
    `aria-checked`/`aria-selected`. Same for `app/lobby.tsx:232,251,276`,
    `app/(online)/index.tsx:106,135`, `app/(online)/room.tsx:85,139`,
    `components/ResultExchangeOverlay.tsx:157`.
  - **`accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"`** are how
    the CLAUDE.md invariant "a labelled control exposes one accessible node" is implemented
    (`CardView.tsx:560-561`, `CardView.tsx:374-375`, `SettingsModal.tsx:204-205`). None of it
    applies on web. `tests/native/a11yCollapse.test.tsx` runs under jest-expo against the *native*
    prop surface, so it proves the invariant on the one platform that is not shipped from Replit.
- **Impact:** On the web build — the platform actually deployed — no toggle, pill, radio, tab,
  language chip, card-back swatch or selected card reports its state, and every one of the 19
  translated `*A11yHint` strings in three locales is dead weight. A screen-reader user hears the
  same name for the on and off state of every setting.
- **Repro / proof:** Build the web bundle, open the offline lobby, and inspect the "4 giocatori"
  radio: `outerHTML` has `role="radio"` and `aria-label` but no `aria-checked` and no
  `aria-selected`. Static proof is the allow-list itself, cited above.
- **Proposed fix:** Do not scatter `aria-*` through 24 screens. Add a tiny adapter used everywhere
  a control has state — e.g. `lib/a11y.ts` exporting
  `a11yState({selected, disabled, busy, expanded})` returning both the RN `accessibilityState`
  object and the web `aria-selected` / `aria-disabled` / `aria-busy` / `aria-expanded` props, and
  `a11yHint(text)` returning `accessibilityHint` plus (web) an `aria-describedby` wired to a hidden
  `Text`. Spread it at each call site. Separately, fix `GameOverOverlay.tsx:283` to pass the real
  `disabled` prop rather than only declaring it, since that also restores the tab-order behaviour
  for free.
- **Acceptance criteria:**
  - A source-scan test in `tests/` asserting no `.tsx` under `app/` or `components/` passes a bare
    `accessibilityState=` / `accessibilityHint=` / `accessibilityElementsHidden=` without the
    helper — the same technique `tests/tokenRoles.test.ts` and `tests/reducedMotion.test.ts`
    already use, including a self-check case proving the scanner matches a real use.
  - A Playwright assertion on the offline lobby that the selected player-count radio has
    `aria-checked="true"` and the others `"false"`.
  - `GameOverOverlay`'s rematch button has `aria-disabled="true"` and `tabindex="-1"` after voting.
- **Fix risk:** RNW forwards both `aria-selected` and the deprecated `accessibilitySelected`;
  picking the wrong one is silent. Passing raw `aria-*` props on **native** is harmless (RN ignores
  unknown props) but TypeScript's `ViewProps` will reject them — the helper's return type needs a
  cast, contained in one file.
- **Depends on:** None

---

### [A11Y-04] Expose which cards are selected
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `components/CardView.tsx:462-582` (esp. `:553-581`), rendered from `components/GameShared.tsx:693-707` and `components/GameTable.tsx:1058-1068`
- **Problem:** Selecting cards then pressing GIOCA is the game's whole interaction. `CardView`
  receives `selected` and uses it for the border (`:580`), the lift (`:489`) and the glow, but the
  `Pressable` at `:555-581` never emits `accessibilityState={{ selected }}`. The only accessibility
  signal is `accessibilityHint={t("cardView.selectedA11yHint")}` at `:574-576` — a hint, which
  VoiceOver reads late and optionally, TalkBack reads after the label, and **react-native-web drops
  entirely** (A11Y-03). The app already knows the right pattern: `ResultExchangeOverlay.tsx:157`
  wraps its card picker in a `Pressable` with `accessibilityState={{ selected: picked }}`.
- **Impact:** A screen-reader user selects cards blind. They can hear a count
  (`gameTable.a11yHandSelected`) but only via the node A11Y-01 shows is unreachable, and never
  *which* cards. Combined with A11Y-01 there is no way to recover from a mis-tap except deselecting
  everything by trial.
- **Repro / proof:** `components/CardView.tsx:553-581` — the full prop list on the `Pressable` is
  `onPress`/`onPressIn`/`onPressOut`/`disabled`/`accessibilityElementsHidden`/
  `importantForAccessibility`/`accessibilityLabel`/`accessibilityRole`/`accessibilityHint`/`style`.
  No `accessibilityState`. `tests/native/a11yCollapse.test.tsx:66-71` asserts
  `accessibilityState?.disabled` for the disabled case and nothing for `selected`.
- **Proposed fix:** On `CardView`'s `Pressable`, pass `accessibilityState={{ selected, disabled: !interactive }}`
  (via the A11Y-03 helper so `aria-selected` lands on web too). Keep the hint but stop it being the
  only channel. `selected` is already a prop; nothing else changes.
- **Acceptance criteria:** Extend `tests/native/a11yCollapse.test.tsx`: rendering
  `<CardView card={ACE} onPress={…} selected />` yields one `button` whose
  `accessibilityState.selected === true`, and `selected={false}` yields `false` (not `undefined` —
  an absent state reads as "not selectable", which is a different claim).
- **Fix risk:** `accessibilityRole="button"` with `aria-selected` is unusual ARIA; if a screen
  reader reads it oddly, `aria-pressed` (RNW forwards `accessibilityPressed`) is the alternative
  and arguably the more correct role semantics for a toggle. Pick one and pin it.
- **Depends on:** [A11Y-03] for the web half

---

### [A11Y-05] Fix the combination chip and round-winner tag — 2.49:1 to 4.31:1 on the felt
- **Severity:** Medium
- **Confidence:** High (computed)
- **Effort:** S
- **Location:** `components/GameShared.tsx:1156-1177` (`comboChip`, `comboChipPower`, `comboChipText`, `comboChipTextPower`), `components/GameShared.tsx:1126-1144` (`winnerTag`, `winnerText`), rendered at `:578-588` and `:556-565`
- **Problem:** These three chips put gold or salmon text on a *translucent* fill of the same hue
  laid over the felt. Flattening the fill onto each stop of the felt gradient
  (`lib/tokens.ts:117-122`) and computing WCAG ratios gives, on the default `verde` felt:

  | Element | Text | Size | Backdrop (flattened) | Ratio | AA needs |
  |---|---|---|---|---|---|
  | `comboChipText` | `Colors.gold` | 10 | `goldBorder` over felt stop 0 `#47713c` | **2.49** | 4.5 |
  | `comboChipText` | `Colors.gold` | 10 | over stop 2 (`Colors.felt`) `#445c31` | **3.26** | 4.5 |
  | `comboChipText` | `Colors.gold` | 10 | over stop 4 `#414723` | **4.27** | 4.5 |
  | `comboChipTextPower` | `Colors.bombText` | 10 | `bombFill` over stop 0 `#44583b` | **3.20** | 4.5 |
  | `winnerText` | `Colors.gold` | 11 (`FontSize.xs`) | `goldMuted` over stop 0 `#2b6638` | **3.00** | 4.5 |

  It fails on every felt: the `blu` chip is 2.63–4.31, `bordeaux` 3.00–4.45, `notte` 3.21–4.56. All
  three are below 18pt/14pt-bold, so the 4.5:1 body threshold applies, and none of them clear it at
  the pile's position (roughly the gradient's middle). `tests/contrast.test.ts` cannot see this
  because it only ever composites a colour directly onto `Colors.bg`/`bgCard`/`felt`, never onto a
  translucent fill sitting on one of those.
- **Impact:** The chip names what is on the table — `COPPIA`, `BOMBA ×4`, `SCALA REALE`. It is the
  one piece of text that tells a player what they have to beat, and it is the least legible text in
  the app. Worst for low-vision players and in sunlight; the "bomb" variant is the dramatic play
  the design most wants noticed.
- **Repro / proof:** The numbers above are reproducible from `lib/tokens.ts` alone with the
  `flattenRgba` + `contrastRatio` helpers already present in `tests/contrast.test.ts:19-67`.
- **Proposed fix:** Two changes in `components/GameShared.tsx`:
  1. Give `comboChip` / `comboChipPower` / `winnerTag` an **opaque** dark backing
     (`Scrim.heavy` over the gradient flattens to `#062415`, where `Colors.gold` measures **7.23:1**
     and `Colors.bombText` clears comfortably) instead of the same-hue translucent gold/red wash.
     Keep the gold *border* — that is where the chip's identity actually lives.
  2. Raise `comboChipText`/`winnerText` from 10/11 to at least `FontSize.sm`, or accept 3:1 by
     making them ≥14pt bold. Given the space, (1) alone is the cheaper and sufficient fix.
- **Acceptance criteria:** Extend `tests/contrast.test.ts` with a case that flattens a translucent
  fill onto **each of the five stops of each of the four felts** and asserts every on-felt text
  token clears 4.5:1 at every stop. The existing `flattenRgba` already does the compositing; only
  the surface list needs to grow. The three pairs above must pass.
- **Fix risk:** The chip currently reads as part of the felt; an opaque dark plate will read as a
  separate UI element. That is a visual-design call (B2's territory) but the contrast floor is not
  negotiable — if the opaque plate is rejected, the text colour has to change instead.
- **Depends on:** None

---

### [A11Y-06] `contrast.test.ts` measures a felt colour nothing is drawn on; opponent names sit at 3.43:1
- **Severity:** Medium
- **Confidence:** High (computed)
- **Effort:** S
- **Location:** `tests/contrast.test.ts:72-76`, `components/GameTable.tsx:917-921`, `components/GameShared.tsx:1060-1066` (`oppName`), `lib/tokens.ts:117-122`
- **Problem:** The felt is never painted as `Colors.felt`. `GameTable.tsx:917-921` renders a
  five-stop `LinearGradient` (`locations={[0, 0.25, 0.5, 0.75, 1]}`, vertical), of which
  `Colors.felt` (`#0B3B25`) is only the **middle** stop. The top of the table is `#0F5A35` — 1.9×
  the relative luminance. `tests/contrast.test.ts:75` pins `felt: Colors.felt` and therefore
  measures the single most favourable band of a surface that spans a 2× luminance range.

  `sharedStyles.oppName` (`Colors.textMuted`, `fontSize: 10`) is rendered by `TopOppSlot` and
  `SideOppSlot`, which live in `sharedTableStyles.topSection` (`TOP_SECTION_H = 70`, i.e. the
  topmost band) and `sideSection`. Measured against the stops it actually lands on:

  | Felt | stop 0 | stop 1 | stop 2 (= `Colors.felt`, the tested one) | stop 3 | stop 4 |
  |---|---|---|---|---|---|
  | verde (default) | **3.43** | **3.99** | 4.60 ✓ | 5.21 | 5.59 |
  | blu | **3.62** | **4.13** | 4.71 ✓ | 5.21 | 5.62 |
  | bordeaux | **4.11** | 4.55 ✓ | 4.99 | 5.41 | 5.69 |
  | notte | 4.69 ✓ | 5.05 | 5.38 | 5.66 | 5.80 |

  So the test passes at 4.60 while every opponent's name renders at 3.43–3.99 on the default
  theme. `tests/cosmetics.test.ts`'s "no alternate felt is lighter than default at any stop" makes
  verde the worst case, which is exactly the case above. `Colors.gold` on the raw felt has the same
  shape: 5.51 at the tested stop, **3.63** at stop 0.
- **Impact:** Opponent names — 10pt, on the busiest surface in the app — are below AA on the
  default theme for two of the five bands they can occupy. The guard that exists to prevent this
  reports green.
- **Repro / proof:** Numbers above; reproducible from `lib/tokens.ts:117-122` with
  `tests/contrast.test.ts`'s own `contrastRatio`.
- **Proposed fix:**
  1. In `tests/contrast.test.ts`, replace the single `felt: Colors.felt` surface with all five
     stops of `FeltGradients.verde` (and, cheaply, the other three), named so a failure says which
     stop. This is the change that makes the rest findable.
  2. For `oppName` specifically, either move it to `Colors.textSecondary` (4.63 at stop 0, still
     below 4.5 — so also bump to `FontSize.xs`+ or add a scrim) or give the opponent slots the same
     dark backing plate proposed in A11Y-05. The `AvatarCircle`'s `countBubble`
     (`GameShared.tsx:1097-1119`) already uses `Colors.overlayStrong` and measures **8.11:1** — the
     name should sit on the same treatment.
- **Acceptance criteria:** `tests/contrast.test.ts` composites every on-felt text token against
  all five stops of all four felts, and every one clears 4.5:1 (or 3.0 with a comment naming the
  large-text element). The suite must go **red** at `b894af4` before the token changes land — if it
  does not, the surfaces were not widened.
- **Fix risk:** Widening the surface list will also fail `Colors.goldDark` (2.35 at verde stop 0)
  and `Colors.gold` (3.63). `goldDark` is currently only used as a border/icon on the felt
  (`components/ExchangeModal.tsx:202` uses `goldDim` for a decorative icon), so exclude non-text
  roles explicitly rather than weakening the threshold — `tests/tokenRoles.test.ts` already knows
  how to tell a text use from a fill use.
- **Depends on:** None

---

### [A11Y-07] `Colors.danger` is used as body text and is in neither contrast list — 4.07:1
- **Severity:** Medium
- **Confidence:** High (computed)
- **Effort:** S
- **Location:** `components/SettingsModal.tsx:498` (`deleteBtnText`) with `styles.card` at `:404-406`; `tests/contrast.test.ts:91-122`
- **Problem:** `tests/contrast.test.ts` enumerates `BODY_TEXT_COLORS` (7 entries) and
  `LARGE_ONLY_TEXT_COLORS` (3 entries) and adds a one-off for `dangerDim` and for `white` on
  `danger`. **`Colors.danger` as a foreground is in none of them.** It is used as body text at
  `SettingsModal.tsx:498` — `deleteBtnText: { ...Type.body, color: Colors.danger }`, i.e.
  `Inter_400Regular` at `FontSize.sm` = 13pt — on `styles.card`'s `Colors.bgCard` background.
  Computed: `#E53935` on `#0A1F18` = **4.07:1**, against the 4.5:1 body threshold. (On the other
  surfaces: `bg` 4.59 ✓, `bgSurface` 3.66, `bgElevated` 3.44, `felt` 2.98.)
  `app/(online)/game.tsx:367` uses the same token for `reconnectBannerTextAlert`.
- **Impact:** The delete-account button — the most destructive control in the app, and the one that
  most needs to be read correctly — is the only text on that panel below AA.
- **Repro / proof:** `Colors.danger = '#E53935'` (`lib/tokens.ts:49`), `Colors.bgCard = '#0A1F18'`
  (`:12`); WCAG ratio 4.07.
- **Proposed fix:** Use `Colors.dangerDim` (`#C9655E`, already pinned ≥4.5 on `bg` and `bgCard` by
  `tests/contrast.test.ts:138-143`) for the label, and add `danger` to the test's
  `LARGE_ONLY_TEXT_COLORS` with a comment that its only sanctioned text use is ≥18pt or ≥14pt bold.
  Check `app/(online)/game.tsx:367`'s banner background at the same time.
- **Acceptance criteria:** `Colors.danger` appears in one of the two lists in
  `tests/contrast.test.ts`; no `.tsx` uses `color: Colors.danger` at a font size below the bar that
  list asserts. The second half is enforceable by extending `tests/tokenRoles.test.ts`'s scanner.
- **Fix risk:** `dangerDim` is a softer red; on a destructive control the loss of urgency is a
  real design cost. If the saturation matters more than the ratio, raise the label to
  `FontSize.lg` bold (making 3.0 the applicable bar, which `danger` clears at 4.07).
- **Depends on:** None

---

### [A11Y-08] Raise the hand's minimum overlap step — cards expose a 22–35pt tap strip
- **Severity:** Medium
- **Confidence:** High (computed from the layout constants)
- **Effort:** M
- **Location:** `components/handLayout.ts:12-34` (`MIN_READABLE_STEP`), `:62-73` (`computeHandLayout`), `components/gameTableModel.ts:289` (`handAvailW`), `components/GameShared.tsx:755-802`
- **Problem:** The hand is a left-anchored overlap: card *i* sits at `left = i * step` with
  `zIndex = i`, so each card exposes exactly `step` px of itself and only the last is fully
  visible. `MIN_READABLE_STEP` computes to `ceil(4 + 15 × 0.6 × 2) = 22` px.
  `handAvailW = W − leftPad − rightPad − 156` (from `computeTableFrame`, with `SIDE_BTN_W = 62`
  and `TABLE_M = 4`). Working the maths through:

  | Viewport | `handAvailW` | 13 cards | **14 cards** (4-player deal) | 20 cards | **27 cards** (2-player deal) |
  |---|---|---|---|---|---|
  | 844×390 web (phone landscape) | 688 | 52.5 | **48.5** | 33.2 | 24.2 |
  | 844 native, 44pt notch insets | 600 | 45.2 | **41.7** | 28.5 | 22 (floor, scrolls) |
  | 667×375 web (small phone landscape) | 511 | 37.8 | **34.9** | 23.8 | 22 (floor, scrolls) |

  Against the bars: 44pt (iOS HIG) / 48dp (Material), and WCAG 2.2 SC 2.5.8 *Target Size (Minimum)*
  at Level AA — 24×24 CSS px, or the undersized-target exception, which requires that 24px circles
  centred on adjacent targets not intersect. Adjacent card centres are exactly `step` apart, so
  `step < 24` fails **both** the size test and the spacing exception. **`MIN_READABLE_STEP = 22` is
  2px below the WCAG 2.2 AA floor**, and a normal 14-card hand is under 44pt on anything but a wide
  viewport.

  Supporting evidence that the constant is due a revisit: its derivation comment
  (`handLayout.ts:12-34`) cites `styles.cardInner` (`padding: 4`), `styles.topCorner` and
  `styles.suitCorner` in `CardView.tsx`. **None of those styles exist** — `CardView.tsx:620-689`
  defines `card`, `cardNormal`, `cardSmall`, `cardSelected`, `cardBack`, `courtArt`, `rankText*`.
  The number is right for the wrong stated reasons.

  `tests/e2e/tapTargets.spec.ts:11-15` explicitly declares the fan overlap out of scope ("that is
  the design, not a defect") — correct for *occlusion*, but it means nothing in the repo measures
  the strip width. `tests/handLayout.test.ts` pins the geometry, not its accessibility.
- **Impact:** Mis-taps in the hand, the single most-repeated gesture in the game, on small phones
  and on any 2-player match. A mis-tap is recoverable (tap again to deselect) but it is constant,
  and it lands hardest on players with motor impairments — which is the population SC 2.5.8 exists
  for.
- **Repro / proof:** Arithmetic above, straight from `handLayout.ts:32`, `:66-72` and
  `gameTableModel.ts:289`.
- **Proposed fix:** In `components/handLayout.ts`, raise the floor to the WCAG minimum:
  `export const MIN_READABLE_STEP = 24;` and rewrite the derivation comment to state the real
  constraint (24 CSS px, WCAG 2.2 SC 2.5.8) rather than the deleted styles. The scrollable fallback
  at `:70-72` already handles "the floor no longer fits", so the only behavioural change is that
  the row starts scrolling slightly earlier on narrow devices. Then extend `tests/handLayout.test.ts`
  with a case that walks the realistic viewport × hand-size matrix and asserts
  `step >= 24` for every combination — which will pass by construction once the floor moves, and
  will catch any future change to `SIDE_BTN_W`/`TABLE_M` that eats the width back.
- **Acceptance criteria:**
  1. `MIN_READABLE_STEP >= 24`, pinned by a test that names WCAG 2.2 SC 2.5.8 as the reason.
  2. `tests/handLayout.test.ts` asserts `computeHandLayout(n, availW).step >= 24` for
     `n ∈ {13, 14, 20, 27}` × `availW ∈ {511, 600, 688}`.
  3. `tests/e2e/tableFit.spec.ts` still passes at every parameterised viewport (the row will scroll
     in more of them).
- **Fix risk:** More hands become `scrollable: true`, which puts them inside the horizontal
  `ScrollView` at `GameShared.tsx:792-799`. That path is the less-tested of the two and interacts
  with the `-14px` selection lift (`HAND_LIFT_HEADROOM`, `:58`, `:796`) and with the deal stagger.
  Reaching 44pt is *not* achievable by changing this constant — at 14 cards it needs ~630px of hand
  width, which only a redesign (a two-row hand, or reclaiming the 140px of side buttons) provides.
  Say that plainly rather than pretending 24 is the target.
- **Depends on:** None

---

### [A11Y-09] Bring the sub-44pt controls up to size — nothing in the repo measures target size
- **Severity:** Medium
- **Confidence:** High (read the styles)
- **Effort:** S
- **Location:** `components/GameTable.tsx:1352-1360` (`rematchChoice`), `components/GameOverOverlay.tsx:458-484` (`homeBtn`, `rematchGradient`), `components/SettingsModal.tsx:457-482` (`segment`, `localeBtn`), `app/(online)/room.tsx:913` (`codeBtn`), `app/(online)/friends.tsx:592` (`iconBtn`)
- **Problem:** `tests/e2e/tapTargets.spec.ts` is named for touch targets but never measures one —
  its whole check is `document.elementFromPoint` at a control's centre (`:100-113`), i.e. occlusion.
  Nothing else in the repo asserts a minimum. Measured from the styles:

  | Control | Computed size | file:line |
  |---|---|---|
  | Rematch YES / NO, mid-game side panel | `minHeight: 32` × ~74 wide | `GameTable.tsx:1352-1360` |
  | "Home" after a manche | `paddingVertical: 9` ×2 + 13pt line ≈ **34pt tall** | `GameOverOverlay.tsx:458-469` |
  | "Rivincita" / "Prossima mano" | same ≈ **34pt tall** | `GameOverOverlay.tsx:477-484` |
  | Settings segmented control (motion, animation amount, felt, card back) | `minHeight: 36` | `SettingsModal.tsx:457-466` |
  | Language chips IT / EN / SQ | `minHeight: 32`, `minWidth: 40` | `SettingsModal.tsx:474-482` |
  | Room-code copy/share | `minHeight: 32`, `hitSlop: 8` → 48 ✓ | `room.tsx:913` + `:591` |

  None of the first five carry a `hitSlop`. `components/MenuButton.tsx:156-158` gets this right
  (`sm: 44`, `md: 52`, `lg: 60`) — the offenders are the bespoke controls that bypass it.
- **Impact:** `GameOverOverlay`'s two buttons are the *only* way out of a finished manche and are
  34pt tall on a phone; `rematchChoice` asks a yes/no question in 32pt boxes while the player is
  mid-hand. Below 44pt these need a deliberate aim, which is the definition of the failure mode
  for anyone with a tremor or large fingers.
- **Repro / proof:** The style objects cited; `MenuButton`'s own scale is the in-repo reference for
  what this project considers correct.
- **Proposed fix:** Add `minHeight: 44` to `rematchChoice`, `homeBtn`, `rematchGradient`, `segment`
  and `localeBtn` (or `hitSlop` where the visual size is deliberate — `hitSlop` counts toward the
  target on both platforms and on web via RNW's pointer handling). Then add the measurement the
  spec's name promises: a Playwright sweep that walks every `button`/`[role=button]`/`[role=radio]`
  on the same five screens `tapTargets.spec.ts` already visits and asserts
  `rect.width >= 44 && rect.height >= 44`, with an explicit, commented allow-list for the hand
  cards (A11Y-08) and any other deliberate exception.
- **Acceptance criteria:** The new size sweep is red at `b894af4` for exactly the controls listed
  above and green after the style changes. The allow-list has one entry per exception with a reason.
- **Fix risk:** `GameOverOverlay`'s action row is inside a fixed-height overlay on a landscape
  phone (`innerCol` is `flex: 1` above a `ScrollView`); adding 10pt to both buttons squeezes the
  rankings list. Check `tests/e2e/tableFit.spec.ts`'s smallest viewport. The settings segmented
  control has up to five segments across a 340px card — 44pt tall is fine, but do not also widen it.
- **Depends on:** None

---

### [A11Y-10] Gate the three unguarded layout animations on the motion preference
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `components/GameTable.tsx:336-338`, `components/GameOverOverlay.tsx:205-207`, `components/GameShared.tsx:556-560`; test at `tests/reducedMotion.test.ts:34-50`
- **Problem:** `tests/reducedMotion.test.ts` checks that a file containing `withTiming|withSpring|
  withRepeat|withSequence|withDecay` also contains the string `usePrefersReducedMotion` — a
  file-level check. Reanimated's declarative `entering=` / `exiting=` layout animations are not in
  that regex, and a file that calls the hook once passes regardless of how many animations ignore
  it. Three do:
  - `GameTable.tsx:337` — `RematchPromptPanel`, `entering={FadeIn.duration(Motion.duration.moderate)}`,
    unconditional. The component does not call the hook at all; the file does, elsewhere.
  - `GameOverOverlay.tsx:206` — the whole end-of-manche overlay, `entering={FadeIn.duration(400)}`,
    unconditional, in a component that *does* read `reduceMotion` (`:166`) and gates everything else.
  - `GameShared.tsx:557-559` — `PlayedPile`'s winner tag, `entering={FadeIn.duration(250)}` /
    `exiting={FadeOut.duration(250)}`, unconditional, in a component that gates its bounce at `:532`.

  The rest of the app gets this right and shows the intended shape:
  `ExchangeModal.tsx:160-161`, `ExchangeAnnouncement.tsx:147-148`, `ReactionLayer.tsx:106` and
  `tutorial.tsx:672` all use `entering={reduceMotion ? undefined : …}`. Everything else I checked
  genuinely reduces rather than merely shortening: `FlyingCards` skips the flight entirely
  (`GameShared.tsx:396-400`), `CardItem` disarms the deal (`:638`), `useTurnPulse` holds the glow at
  its midpoint instead of breathing (`:973-977`), `GameBillboard` pins the dot at 1 (`:1239-1242`),
  and `impactDelayMs` collapses to 0 (`gameTableModel.ts:134-138`). This finding is only the three
  stragglers.
- **Impact:** A player who has asked for reduced motion still gets three cross-fades, one of them
  full-screen. Minor, but it is the exact promise the setting makes.
- **Repro / proof:** `grep -rn "entering=\|exiting=" app components` returns 8 sites; 5 are gated,
  3 are not (plus `room.tsx:462,600`, which are menu-screen fades in a file that does not read the
  hook at all — the same class, lower stakes).
- **Proposed fix:** Apply the `reduceMotion ? undefined : …` pattern at those three call sites
  (`RematchPromptPanel` needs to call `usePrefersReducedMotion()` itself). Then widen the test:
  add `entering=` / `exiting=` to the scan and assert each occurrence is on a line (or within the
  same JSX attribute) containing `reduceMotion`, with a self-check case proving the scanner matches
  a real ungated use — the technique `tests/tokenRoles.test.ts:70` already uses.
- **Acceptance criteria:** The widened `tests/reducedMotion.test.ts` is red at `b894af4` naming
  those three files, and green after. `app/(online)/room.tsx:462,600` are either fixed or listed as
  a named exemption.
- **Fix risk:** `entering={undefined}` on a component that mounts inside a `ScrollView` sometimes
  produces a one-frame flash where the fade used to hide the layout pass. Verify `GameOverOverlay`
  in particular.
- **Depends on:** None

---

### [A11Y-11] Translate the portrait "rotate your device" overlay
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `components/GameTable.tsx:1189-1199`
- **Problem:** The overlay shown whenever `W < H` on the game table renders two raw Italian string
  literals — `"Ruota il dispositivo"` and `"Il gioco richiede la modalità orizzontale"` — with no
  `t()` call, in a file where every other string goes through the translator. `tests/i18n.test.ts`
  pins key parity across `it`/`en`/`sq` and placeholder parity, but it cannot see a string that
  never became a key. (The same shape exists at `components/gameTableModel.ts:211-222`,
  `startCardBannerText`, which returns hardcoded Italian — but that function is exported, unit
  tested at `tests/gameTableModel.test.ts:318-330`, and **called by no production code**; `GameTable`
  uses `t("gameTable.startCardBannerSelf")` instead. Dead, so no user impact, but it is the second
  instance of the same gap.)
- **Impact:** An English or Albanian player who holds a phone in portrait on the game table — the
  one screen that forces landscape, so the overlay is common — gets an instruction they may not
  read, on the only screen telling them how to proceed.
- **Repro / proof:** `components/GameTable.tsx:1193` and `:1195` contain the literals verbatim.
- **Proposed fix:** Add `gameTable.rotateTitle` / `gameTable.rotateSubtitle` to `locales/it.ts`
  (source of truth), `en.ts` and `sq.ts`, and call `t()` at both lines. Separately, delete
  `startCardBannerText` and its test — an unused exported function returning untranslated copy is
  exactly the residue `CLAUDE.md`'s "leave no residue" rule targets.
- **Acceptance criteria:** A source-scan test (sibling of `tests/i18n.test.ts`) that flags any
  `<Text>` child in `app/` or `components/` that is a bare string literal of ≥2 words, with a
  self-check case. It must be red at `b894af4` for `GameTable.tsx:1193,1195`.
- **Fix risk:** The scanner will also flag legitimate literals — glyphs (`"♠"` at `:973`), the
  `"✦ "` prefix at `GameShared.tsx:582`, `"JK"` at `CardView.tsx:544`. Restrict it to multi-word
  strings containing a space and at least one lowercase letter, and keep an explicit allow-list.
- **Depends on:** None

---

### [A11Y-12] Set `autoComplete` / `textContentType` on the login and register fields
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `app/auth.tsx:110-125` (username), `app/auth.tsx:131-147` (password)
- **Problem:** Neither `TextInput` sets `autoComplete` or `textContentType`. `returnKeyType`,
  `autoCapitalize`, `autoCorrect` and `onSubmitEditing` are all set correctly, and the field↔field
  focus chain works — the credential hints are the only thing missing. On web, RNW renders the
  password field as `<input type="password">` with no `autocomplete` attribute, so browser and
  password-manager autofill is unreliable and Chrome logs a DOM warning; on iOS/Android the
  keyboard's password/username suggestion bar and the Keychain/Autofill service never offer to fill
  or to save. The same form serves both login and register, so the value has to switch with `tab`.
- **Impact:** Every returning player types their password by hand. This is the first screen behind
  the online mode and `docs/BACKLOG.md` O10 already flags account friction as a concern for the
  ladder.
- **Repro / proof:** `app/auth.tsx:112-124` and `:135-146` — the full prop lists, with no
  `autoComplete` and no `textContentType`.
- **Proposed fix:**
  ```tsx
  // username
  autoComplete="username" textContentType="username"
  // password
  autoComplete={tab === "login" ? "current-password" : "new-password"}
  textContentType={tab === "login" ? "password" : "newPassword"}
  ```
  `tab` is already in scope at both call sites (`app/auth.tsx`, the `Tab` state).
- **Acceptance criteria:** A jest-expo test renders `<AuthScreen>` in both tab states and asserts
  the two inputs carry the expected `autoComplete`/`textContentType` per state.
- **Fix risk:** iOS's `textContentType="newPassword"` triggers the Strong Password suggestion
  sheet, which some users find intrusive on a game signup and which will fight the server's own
  password policy if the two disagree. Check `RegisterSchema` in `server/schemas.ts` first.
- **Depends on:** None

---

### [A11Y-13] Cap font scaling on the fixed-size boxes, or they clip at large text sizes
- **Severity:** Medium
- **Confidence:** Medium (mechanism read from the code; not observed on a device)
- **Effort:** M
- **Location:** `components/CardView.tsx:651-688` inside the fixed card at `:629-635`, `components/GameTable.tsx:1219-1246` (top bar), `components/GameShared.tsx:1092-1119` (avatar initials, count bubble), `components/gameTableModel.ts:20-28`
- **Problem:** `allowFontScaling` and `maxFontSizeMultiplier` appear **nowhere** in the repo
  (grepped the whole tree). React Native's default is `allowFontScaling: true`, so every `fontSize`
  in the app is multiplied by the OS text-size setting — up to roughly 3.1× on iOS's Larger
  Accessibility Sizes and 2× on Android — while `width`, `height` and `lineHeight` are not. The
  game table is built entirely from fixed boxes:
  - `CardView` renders inside `styles.cardNormal` (`58 × 84`, `overflow: "hidden"` at `:626`) and
    positions the rank glyph with `styles.rankTextNormal` — `fontSize: RANK_FONT` (15),
    **`lineHeight: 15`**, `width: CARD_W * INDEX_TEXT_W`, `top: 3`. At 200% the glyph is 30px in a
    15px line box in a card whose box does not grow: the index clips, and the two-glyph "10"
    (already the tight case the comment at `:545-547` calls out) overruns into the pip field.
  - The top bar is `height: TOP_BAR_H` = 40 (`gameTableModel.ts:24`, `GameTable.tsx:1220-1221`)
    and holds `timerNum` (13pt, `minWidth: 20`), `cardCountText` (15pt in a `30 × 30` badge at
    `:1239-1246`) and the `GameBillboard`'s two lines (13pt + 10pt). At 200% none of it fits 40pt.
  - `AvatarCircle`'s `countBubble` is `18` tall with 10pt text (`GameShared.tsx:1097-1119`); the
    initials are sized `size * 0.36` but the circle is a fixed `size`.

  The menus mostly survive because `MenuButton` uses `minHeight` (`:156-158`) and `MenuLayout`
  scrolls — this is a game-table problem, and the game table is the one screen with no scroll and
  a hard landscape lock.
- **Impact:** A player using large system text cannot read their own cards' ranks — the game's
  primary information — and the top bar's turn/timer/count row overlaps. On iOS this is a
  plausible App Store accessibility rejection.
- **Repro / proof:** Set iOS Settings → Accessibility → Display & Text Size → Larger Text to a
  large accessibility size, or Android Settings → Display → Font size → Largest, then open the game
  table. Statically: `rankTextNormal` pins `lineHeight: 15` against a scalable `fontSize: 15`
  inside a `height: 84`, `overflow: "hidden"` box — the clip is structural, not conditional.
- **Proposed fix:** The card face and the table chrome are graphics with pinned geometry
  (`CARD_W`/`CARD_H` are a CLAUDE.md invariant and pinned by `tests/gameTableModel.test.ts`), so
  the right answer is to opt them out rather than to make them fluid: set
  `maxFontSizeMultiplier={1.2}` on the `<Text>` elements inside `CardView`
  (`:592-614`), on `GameTable`'s `timerNum`/`cardCountText`/billboard labels, and on
  `AvatarCircle`'s initials and count bubble. Leave everything under `MenuLayout` fully scalable —
  those screens scroll and should honour the setting completely. Do **not** set
  `allowFontScaling={false}`; capping degrades, disabling refuses.
- **Acceptance criteria:**
  1. A source-scan test asserting every `<Text>` rendered inside a fixed-`height` container in
     `components/CardView.tsx`, `components/GameTable.tsx` and `components/GameShared.tsx` carries
     a `maxFontSizeMultiplier`.
  2. A jest-expo snapshot at a simulated large scale, or a Playwright run at a browser base font
     size of 32px, showing no clipped rank glyph.
- **Fix risk:** Capping at 1.2 is a judgement call; too low and the setting is effectively ignored
  on the table, too high and the clipping returns. The *whole* fix might be a fluid card size
  instead, but `CARD_W`/`CARD_H` are pinned as MUST-NOT-CHANGE and that is an XL redesign — say so
  rather than half-doing it.
- **Depends on:** None

---

## Coverage gaps

1. **Nothing was run.** Playwright, the web build and the native builds all write to disk, which
   the read-only rule forbids, so every claim here is from reading source (including
   `node_modules/react-native-web@0.21.2`'s own source for the prop allow-lists) and from
   arithmetic. No VoiceOver, TalkBack, NVDA or keyboard session was performed. `docs/BACKLOG.md` O4
   independently records that the VoiceOver/TalkBack flow has never been verified.
2. **Mobile-web overscroll / pull-to-refresh is unresolved.** There is no `app/+html.tsx`, no
   `web/` or `public/` directory, no `web.template` in `app.json`, and `scripts/build.js` injects no
   `<style>`; `overscroll-behavior` appears nowhere in the tree. Whether Expo SDK 54's default web
   shell sets it, and therefore whether pull-to-refresh can reload a live game on mobile Safari or
   Chrome, needs the generated `dist/index.html` — which I could not produce. **This is the one
   scope item I could not answer.** It is worth a 5-minute check by anyone who can run
   `npm run expo:web:build`.
3. **Drag-to-play was checked and does not exist.** `react-native-gesture-handler` is mounted only
   as `GestureHandlerRootView` at `app/_layout.tsx:81`; no `Gesture`/`PanGestureHandler` is used
   anywhere in `app/` or `components/`. Selection is tap-only, so there is no drag-vs-scroll
   conflict to report.
4. **Landscape safe areas look correct and I found nothing to report.**
   `computeScreenPads`/`computeTableFrame` (`gameTableModel.ts:244-291`) thread `insets.left`/
   `insets.right` into `tableLeft`/`tableRight`/`handAvailW`, and the top bar and rematch panel
   both consume `frame.leftPad`/`rightPad` (`GameTable.tsx:868`, `:1170-1171`). The hardcoded
   `leftPad/rightPad = 0` on web (`:248-249`) is correct as long as the viewport meta does not set
   `viewport-fit=cover` — which ties back to gap 2.
5. **Colour-only encoding: partially cleared, one item unverified.** Turn is carried by colour
   *plus* the ping ring and the pulsing dot (`GameShared.tsx:198-224`, `:1272-1274`); selection by
   colour *plus* a 16px lift; disabled by colour *plus* `aria-disabled` where the `disabled` prop is
   set. **Teams mode (2v2) I could not clear** — `app/(online)/room.tsx` and the table render
   `team` but I did not trace whether partnership is signalled by anything other than seat position
   and colour. Worth a targeted look.
6. **Locale-specific overflow not checked.** Albanian and English strings are longer than the
   Italian source in places, and the table's chrome is fixed-width. A11Y-13 covers font *scaling*;
   string-length overflow at 100% scale is a separate, unchecked risk.
7. **Screen-reader behaviour of the `<button>`-with-`aria-label` cards is asserted from spec, not
   observed.** RNW turns `accessibilityRole="button"` into a literal `<button>`
   (`propsToAccessibilityComponent.js:11-31`), where `aria-label` is valid; I did not confirm
   announcement in a real screen reader.

## Opinions (non-findings)

- `components/gameTableModel.ts:325-419` (`describeTableForA11y`) is the best piece of accessibility
  design in this repo — priority-ordered, pure, translation-agnostic, and separately tested. That
  A11Y-01 says it reaches nobody is a wiring bug, not a design failure, and the fix is small.
  Nothing else here should be read as a criticism of that work.
- `NotificationBanner.tsx:116-144` nests a `Pressable` (the close button, `role="button"`) inside a
  `Pressable` carrying `accessibilityRole="alert"`. RNW renders the outer as a `div role="alert"`,
  not a `<button>`, so this is not the invalid button-in-button it looks like — but the outer
  control is the one that opens a game invite, and announcing it as an alert rather than a button
  understates that. Preference, not a defect.
- `tests/e2e/helpers/bot.ts:286-297` describes `SelectableCard` as carrying "no accessibilityLabel
  of its own (an accessibility gap noted in the harness's report)" — that is now false;
  `ExchangeModal.tsx:116` sets one, and the same comment's second half (`:323-326`) says so. Stale
  prose in a test helper, C2's territory.
- `handLayout.ts:9` re-declares `CARD_W = 58` while `gameTableModel.ts:20` owns `CARD_H`. Both are
  re-exported through `GameShared.tsx:40-53` so there is exactly one runtime value for each, and
  the split is explained — but "layout constants live once in `gameTableModel.ts`" (CLAUDE.md) is
  not literally true today.
- `GameTable.tsx:1082` sets `onPress={playBtnValid ? handlePlay : undefined}` *and* `disabled={!playBtnValid}`
  at `:1085`. The belt-and-braces is harmless; `GameOverOverlay.tsx:285` does the first half only,
  which is the actual bug in A11Y-03.

## Open questions for the human

1. **Is a screen-reader-playable Murlan a goal, or is the existing a11y work insurance against
   store review?** A11Y-01 and A11Y-04 are cheap and would make the game genuinely playable blind;
   A11Y-02 is not cheap. If the goal is only store compliance, do 01/03/04/09/13 and defer 02.
2. **Which platform is the accessibility target?** The whole native prop surface
   (`accessibilityState`, `accessibilityHint`, `accessibilityElementsHidden`) is dead on the
   Replit-served web build, and the one a11y test that runs in CI-adjacent form
   (`tests/native/a11yCollapse.test.tsx`) tests the *other* platform. If web is the product,
   `tests/native/` is not where accessibility should be pinned.
3. **`MIN_READABLE_STEP` at 24 makes more hands scroll** (A11Y-08). Is a horizontally scrolling hand
   acceptable at 14 cards on a small phone, or is reclaiming width from the 140px PASSA/GIOCA
   columns the change you actually want? The second is a table redesign and belongs in the backlog,
   not in this fix.
4. **Should `tests/e2e/tapTargets.spec.ts` be renamed?** It is a very good occlusion test with a
   name that implies size coverage the repo does not have (A11Y-09). Adding the size sweep to it and
   keeping the name is one option; splitting it into `occlusion.spec.ts` + `tapTargets.spec.ts` is
   the other.
5. **Teams mode (2v2): is partnership signalled by anything other than seat position?** I could not
   clear this (coverage gap 5) and it is the one remaining colour-only-encoding risk.
