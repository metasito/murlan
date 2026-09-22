# Components

Loaded when you read anything under `components/`. When a rule number is cited and you cannot
see the rule, it lives in `docs/agents/RULES.md`; invariants here are pinned by the test named on
each line.

## UI invariants — each is a bug that shipped

Verify against source before changing any.

**The table**

- **A card appears exactly once** in flight/`pileState` — never twice, never zero times
  (`tests/ui-rules/flightPhysics.test.ts`, `advancePile`).
- **`CARD_W`/`CARD_H` are declared once**, in `components/cardFaceModel.ts`; `handLayout.ts` takes
  a width parameter instead of importing it. A source scan pins this
  (`tests/ui-rules/layoutConstantsPinned.test.ts`), since pinning the value cannot find a copy
  holding the same number.
- **Impact feedback is timed to the card landing**, not the throw: derive the delay only from
  `impactDelayMs()`, so animation and feedback cannot drift apart.
- **The table's scale comes from the window's own short edge**, never that minus the safe-area
  insets. The safe area is the layout's job — the rail absorbs the cutout, the hand zone carries
  the home indicator.
- **State which view covers which with a `Layer` role** (or a value derived from one), never
  sibling order or a bare number: web and Android paint in tree order, iOS does not (#209).
  `Layer.felt` (0) < `Layer.feltScrim` (the bomb's) < `Layer.table`;
  `tests/ui-rules/tokenRoles.test.ts` resolves every `zIndex` through its constant.
- **Diagnose a native-only visual defect from device pixels, not reasoning.** Sample first
  (`docs/agents/checks.md`); a fix argued from code alone gets one thing right and two wrong, on
  the owner's phone, each round.

**UI components**

- **Use a design token in the role it was named for.** A fill or border token used as text colour
  renders as almost nothing, silently (`tests/ui-rules/tokenRoles.test.ts`).
- **Pass an icon name to `<Ionicons>` as a literal**, or a ternary between two literals, and every
  wrapper passes props by name. `scripts/iconSubsetChars.mjs` cannot see through a JSX spread, so
  `<IconButton {...props} />` ships a blank box with no error (`tests/tooling/iconSubset.test.ts`).
- **A labelled control exposes one accessible node**: hide its own words and glyphs with
  `a11yHidden()` (`tests/ui-rules/a11yOneNode.test.ts`). A web defect only — iOS makes the
  `Pressable` a leaf, react-native-web does not. A live region announces rather than being landed
  on, so it is its own node (`A11yStatus`), never a control.
- **A labelled container gets a role, via `a11yGroup()`** — a role-less `<div aria-label>` is
  `generic`, for which a name is prohibited. A container holding a control is not grouped at all:
  on iOS the control would be sealed inside the leaf.
- **`components/AppModal.tsx` is the app's only `<Modal>`, and it declares
  `supportedOrientations` including landscape**, or iOS rotates to portrait behind it and every tap
  lands on nothing (`tests/ui-rules/orientation.test.ts` pins both).
- **`NotificationBanner` never returns null, and animates by callback chain** — parallel
  `withTiming` calls overwrite the slide-in.
- **`OfflineBanner` flags offline only on `state.isConnected === false`**; `null` means unknown.
- **A game invite sets `pendingInvite` before showing the banner.** Banner only, no Alert.

## Design system

- **Colour, radius, font size, spacing and timing come from `lib/theme.ts`** (rule 18).
  `eslint.config.js` refuses a bare number for all but colour, which is convention. A
  component-local one-off may be a named module constant; `0` is still `0`.
- **Timing is a `Motion` step only when it is motion.** How long a banner stays readable is
  `Reading`. The reduced-motion form comes from `Motion.reduced` via `motionMs()`, never from the
  call site.
- **Gold is a five-step alpha scale** (`goldGhost` … `goldStrong`): pick by role, add no sixth.
- **Reach for the shared piece before writing one**: `ScreenHeader`, `StateBlock`, `IconButton`,
  `Avatar`, `ResultBoard`, `AppModal`, `useIsLandscape()`. A local component must not share a
  name with a shared one.
- **Menu screens use `MenuLayout` / `MenuCard` / `MenuButton`**, with `app/profile.tsx` as the
  reference. The game tables and `app/index.tsx` are exempt.
- **Every user-facing string goes through `t()`** (rule 19). English (`locales/en.ts`) is the
  source of truth; `it.ts` and `sq.ts` are `Record<keyof typeof en, string>`, so a missing key is a
  compile error.
- `Shadow.*` is platform-aware. Game screens are landscape-locked; menus do both via
  `useIsLandscape()`. Game and layout components use `useSafeAreaInsets()`.
