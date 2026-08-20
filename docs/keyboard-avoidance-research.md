# Keyboard avoidance research: keeping a TextInput above the soft keyboard in a ScrollView

Research for #87 ("The keyboard covers the field it is typing into"). Scope: what mechanism
should `MenuLayout`'s `ScrollView` (`components/MenuLayout.tsx:63`) use so every `TextInput`
that inherits it — `app/(online)/friends.tsx`, `app/(online)/index.tsx`, `app/auth.tsx`,
`app/lobby.tsx` — stays clear of the soft keyboard on iOS, Android and web. No file other than
this one was changed.

**Repo facts used below** (read from `package.json`, `components/MenuLayout.tsx`,
`app/auth.tsx`, `app/(online)/index.tsx`, `app/lobby.tsx`, `app/(online)/friends.tsx`,
`eslint.config.js`, `tests/orientation.test.ts`, `app.json`, and the installed
`node_modules/react-native-web`):

- Pinned versions: `expo` `~54.0.37`, `react-native` `0.81.5`, `expo-router` `~6.0.17`,
  `react-native-web` `^0.21.0` (installed: `0.21.2`).
- `MenuLayout`'s `scrollable` branch is a plain `react-native` `ScrollView` with
  `keyboardShouldPersistTaps="handled"` and nothing else keyboard-related. Issue #87 keeps
  that prop as-is.
- `app/auth.tsx` and `app/(online)/index.tsx` already wrap their screens in
  `KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}` —
  the pre-edge-to-edge idiom. `app/lobby.tsx` and `app/(online)/friends.tsx` have a
  `TextInput` inside a `ScrollView`/`MenuLayout` with no keyboard-avoidance wrapper at all;
  `friends.tsx`'s search field is the last block on the page, so the keyboard lands directly
  on it.
- `app.json` sets no `androidNavigationBar`/`edgeToEdgeEnabled` key — the app is on whatever
  Expo SDK 54 makes the unconditional default (§(b)).
- `react-native-keyboard-controller` is **not** an installed dependency.
- This repo's own convention for an invariant no unit test can see is a source-scan: either
  `eslint.config.js`'s `no-restricted-syntax` + esquery selectors, or a `node:test` file that
  reads `.tsx` source across `app/` and `components/` (`tests/orientation.test.ts` is the
  reference — see §(d)).

---

## Recommendation

Make `MenuLayout`'s `ScrollView` keyboard-aware with two native-RN mechanisms and adopt
neither of this app's existing per-screen `KeyboardAvoidingView` idiom nor a new dependency:
set `automaticallyAdjustKeyboardInsets` on the `ScrollView` for iOS (a built-in `ScrollView`
prop since RN 0.68, zero new dependency, no conflict with `keyboardShouldPersistTaps`), and
wrap it in `KeyboardAvoidingView behavior="padding"` for Android — not the `height` value
`auth.tsx`/`index.tsx` already use, because SDK 54's unconditional Android-16 edge-to-edge
(this repo is already on it — see §(b)) removes the automatic `adjustResize` window-padding
that `height` mode and every bare `ScrollView` on this app silently depended on, and
`padding` is what the maintainer of `react-native-edge-to-edge` (the library Expo's own
edge-to-edge support is built from) confirms still works. Do **not** add
`react-native-keyboard-controller`: it has no web support by its own compatibility docs, its
own maintainer, and Expo's own SDK reference, and this repo ships a web bundle as a first-class
target — issue #87's "done when" explicitly requires the web leg too. That's not a loss on
web, though: both `automaticallyAdjustKeyboardInsets` and `KeyboardAvoidingView` are already
complete no-ops on the installed `react-native-web@0.21.2` (verified directly from its
source), so the web leg is carried entirely by the browser's own default
scroll-focused-input-into-view behavior, which this repo's code does not currently defeat
(no `preventScroll` call anywhere in the tree).

---

## (a) `automaticallyAdjustKeyboardInsets` — does it solve iOS, and what are the caveats?

**What it does, and since when.** `ScrollView`'s `automaticallyAdjustKeyboardInsets` prop
"Controls whether the ScrollView should automatically adjust its `contentInset` and
`scrollViewInsets` when the Keyboard changes its size" — iOS only, default `false`. This is
confirmed against the docs pinned to this repo's exact RN version.
Source: <https://reactnative.dev/docs/0.81/scrollview> (iOS-only badge, default `false`),
cross-checked against the current docs: <https://reactnative.dev/docs/scrollview>.

It shipped as PR #31402 ("Feature: ScrollView `automaticallyAdjustKeyboardInsets`"), merged
as commit `49a1460`, present in the `v0.68.0-rc.0` tag per a contemporaneous PR comment — i.e.
**React Native 0.68**. The PR's own description states the mechanism: it adjusts
`contentInset`, `scrollIndicatorInsets` and `contentOffset` to match the keyboard's animation
curve/duration exactly, respects the `ScrollView`'s absolute on-screen position (only insets
the overlapping portion), and is designed to work with vertical, vertical-inverted, horizontal
and horizontal-inverted `ScrollView`s.
Sources: <https://github.com/facebook/react-native/pull/31402>,
<https://github.com/facebook/react-native/commit/49a1460a379e3a71358fb38888477ce6ea17e81a>.

A second PR (#35224, "Improvements to `automaticallyAdjustKeyboardInsets`") proposed making it
apply an offset **only when a text field would actually be covered**, instead of the fixed
keyboard-sized offset the original implementation always applied — the fixed offset is what
produces the "content jumps up even though the focused field was already visible" complaint
this proposal targeted. That specific PR was closed unmerged in November 2022; the same
improvement was merged via a reopened PR, **#37766, on 2023-09-15**. Neither PR page states
which stable RN version first shipped it — flagged below as **unverified beyond "0.73 or
later."**
Sources: <https://github.com/facebook/react-native/pull/35224>,
<https://github.com/facebook/react-native/pull/37766>.

**Caveat — interaction with `contentInsetAdjustmentBehavior`.** `contentInsetAdjustmentBehavior`
("how the safe area insets are used to modify the content area," iOS 11+, default `'never'`)
and `automaticallyAdjustKeyboardInsets` are documented as two independent props on the same
docs page — **neither cross-references the other.** Source:
<https://reactnative.dev/docs/scrollview>. That silence is not proof of no interaction: both
ultimately animate the same underlying `contentInset` on the native `UIScrollView`. Issue
#41397 ("automaticallyAdjustKeyboardInsets created padding at bottom when keyboard shown," RN
0.72.6, closed) reports exactly a residual-inset symptom, and the reporter's own attempted
workarounds were `contentInsetAdjustmentBehavior="never"` and a manual negative `contentInset`
— i.e. a real user hit this pairing as the suspect. Source:
<https://github.com/facebook/react-native/issues/41397>. Treat the interaction as
**undocumented but mechanically plausible**, not as a confirmed, named bug.

**Caveat — `keyboardDismissMode`.** No RN doc or issue found ties `keyboardDismissMode`
specifically to `automaticallyAdjustKeyboardInsets`; the documented conflict in this area is a
different one — `keyboardDismissMode="interactive"` not resizing `KeyboardAvoidingView`
smoothly as the keyboard hides (issue #13073) — which is a `KeyboardAvoidingView` problem, not
this prop. `keyboardShouldPersistTaps` (the prop this repo actually sets) is documented as
platform-independent and unrelated to either. Source:
<https://reactnative.dev/docs/scrollview>. **No conflict found; unverified beyond that.**

**Caveat — nested/composed ScrollViews and reliability generally.** PR #31402's own
description flags a known limitation: with a horizontal parent `ScrollView` containing a
child `ScrollView` that also sets `automaticallyAdjustKeyboardInsets`, the keyboard is
dismissed on the first scroll touch. Source:
<https://github.com/facebook/react-native/pull/31402>. On top of that, the feature has a
running history of New-Architecture-specific breakage: it did nothing at all under Fabric in
RN 0.74.3 (issue #45647, fixed), it failed to shift content for a focused `InputAccessoryView`
field in RN 0.75.3 (issue #46595, fixed via PR #46732), and under the New Architecture it
pushed content above the keyboard correctly but never removed the inset again once the
keyboard closed, in RN 0.76.2 (issue #47731, fixed). Expo's own issue tracker shows the same
class of regression reaching consumers directly: `automaticallyAdjustKeyboardInsets` broke
between SDK 51 and SDK 52 (RN 0.76.3) — scrolling to the bottom of a form became impossible
while the keyboard was open, and a residual bottom margin remained after dismissing it.
Sources: <https://github.com/facebook/react-native/issues/45647>,
<https://github.com/facebook/react-native/issues/46595>,
<https://github.com/facebook/react-native/issues/47731>,
<https://github.com/expo/expo/issues/33220>. A React Native community discussion from January
2025 comparing every current iOS keyboard-avoidance option (`KeyboardAvoidingView`, this prop,
Reanimated's `useAnimatedKeyboard`, and `react-native-keyboard-controller`) opens by noting
"there are many options" and states all of them "rely on keyboard notifications... [which]
has resulted in various issues" since iOS moved keyboard delivery out-of-process — a framing
that treats reliability as a genus problem across all four, not specific to one. Marked
**secondary** (a GitHub Discussion, not an official doc); the specific bugs above, each tied
to an issue number and RN version, are what this finding actually rests on. Source:
<https://github.com/react-native-community/discussions-and-proposals/discussions/867>.

**Net for this repo:** none of the four screens use `InputAccessoryView`, nested
horizontal `ScrollView`s, or `scrollToIndex`, which is where every cited bug lives — the
exposure for `friends.tsx`/`lobby.tsx`/`auth.tsx`/`index.tsx`'s plain vertical forms is low,
and the prop is free (no new dependency, no behavior change on Android or web — see §(c)).

---

## (b) Android edge-to-edge and `windowSoftInputMode="adjustResize"`

**Timeline, from Expo's own changelogs.** Edge-to-edge on Android went from opt-in library to
unconditional default across three SDKs:

| SDK | Default | Source |
|---|---|---|
| 52 | Ships `react-native-edge-to-edge` (built with @zoontek) as an available config-plugin library; not default. | <https://expo.dev/changelog/2024-11-12-sdk-52> |
| 53 | **Default for new projects** (opt-out outside Expo Go); **disabled by default for existing projects** (opt-in via `edgeToEdgeEnabled`); **mandatory, no opt-out, inside Expo Go**. | <https://expo.dev/changelog/sdk-53> |
| 54 | **"edge-to-edge will be enabled in all Android apps, and cannot be disabled."** Tied explicitly to targeting Android 16. `react-native-edge-to-edge` is no longer an `expo` package dependency because "the required functionality was built into React Native" itself. `edgeToEdgeEnabled` becomes a no-op on Android 16 (still respected on Android 15 and below). | <https://expo.dev/changelog/sdk-54> |

This repo pins `expo` `~54.0.37` and sets no `edgeToEdgeEnabled`/`androidNavigationBar` key in
`app.json` — it is already on the unconditional default.

**What edge-to-edge changes about `adjustResize`, per Android's own docs.** Android's official
edge-to-edge page: *"Edge-to-edge is enforced on Android 15 (API level 35) and higher once
your app targets SDK 35. If your app is not already edge-to-edge, portions of your app may be
obscured and you must handle insets."*
Source: <https://developer.android.com/develop/ui/views/layout/edge-to-edge>.

The soft-keyboard doc is explicit that `adjustResize` is still the correct manifest setting —
*"For each Activity with a soft keyboard, check that `android:windowSoftInputMode="adjustResize"`
is set in the AndroidManifest.xml. DO NOT use `SOFT_INPUT_ADJUST_RESIZE`"* (the runtime/Java
API is deprecated, the manifest attribute is not) — but what it *does* changes: before
targeting SDK 35, the framework treated the IME as a system window and automatically padded
the window's root views to avoid it; after targeting SDK 35, **the framework no longer pads
the root views for you** — the app must observe `WindowInsetsCompat.Type.ime()` itself (via
`ViewCompat.setOnApplyWindowInsetsListener`, `insets.isVisible(...)`,
`insets.getInsets(...).bottom`) and apply the adjustment in its own layout code.
Sources: <https://developer.android.com/develop/ui/views/layout/sw-keyboard>,
<https://developer.android.com/agents/skills/system/edge-to-edge/skill> (Android's own
edge-to-edge migration checklist, confirming the same `adjustResize`-still-required +
deprecated-API-forbidden pairing and giving the `WindowInsetsRulers.Ime`/`imePadding()`
Compose-side follow-up).

**Direct answer:** `adjustResize` does **not** stop being the right manifest setting, but it
stops being sufficient by itself. Pre-edge-to-edge, setting it alone caused the OS to shrink
the window and every plain view — including a bare RN `ScrollView` with zero keyboard code —
reflowed into the smaller space for free. Post-enforcement, the window itself is never
resized; the keyboard arrives only as an IME inset, and something must consume it explicitly.

**Confirmation from the React Native ecosystem, not just Android in the abstract.** The
maintainer of `react-native-edge-to-edge` — the exact library Expo's own edge-to-edge support
was built from and later absorbed (§ timeline above) — states this as fact about RN apps
specifically, in the library's own README: *"Enabling edge-to-edge display disrupts Android
keyboard management (`android:windowSoftInputMode="adjustResize"`), requiring an alternative
solution."* It recommends `KeyboardAvoidingView` or, preferably in its view,
`react-native-keyboard-controller`.
Source: <https://github.com/zoontek/react-native-edge-to-edge/blob/main/README.md>. The same
maintainer, replying directly to a report that *"enabling edge to edge / using
`react-native-edge-to-edge`... breaks the Android keyboard avoiding of
`windowSoftInputMode="adjustResize"`,"* confirmed: *"That's indeed the Android behavior, it's
explained in the README. Using `KeyboardAvoidingView` with `behavior="padding"` or
`react-native-keyboard-controller` works."*
Source: <https://github.com/react-native-community/discussions-and-proposals/discussions/827>
(comment by zoontek, 2024-11-09). Expo's own blog carries the identical guidance for its
streamlined-edge-to-edge rollout: *"This mode changes how Android handles keyboards. Like on
iOS, you'll need to use `KeyboardAvoidingView` or — ideally — `react-native-keyboard-controller`."*
Source: <https://expo.dev/blog/edge-to-edge-display-now-streamlined-for-android>.

**Why `KeyboardAvoidingView` is a real fix and not just another `adjustResize`-shaped victim:**
read directly from React Native's own source, `KeyboardAvoidingView`'s Android code path does
not depend on the window being resized at all — it subscribes to the native `Keyboard`
module's `keyboardDidShow`/`keyboardDidHide` events (vs. `keyboardWillChangeFrame` on iOS) and
computes its own offset from the event's reported `endCoordinates`, independent of whatever
`windowSoftInputMode` is doing to the window itself:
```
if (Platform.OS === 'ios') {
  this._subscriptions = [Keyboard.addListener('keyboardWillChangeFrame', this._onKeyboardChange)];
} else {
  this._subscriptions = [
    Keyboard.addListener('keyboardDidHide', this._onKeyboardChange),
    Keyboard.addListener('keyboardDidShow', this._onKeyboardChange),
  ];
}
```
Source: <https://github.com/facebook/react-native/blob/92073d4a71d50a1ed80cf9cb063a6144fcc8cf19/Libraries/Components/Keyboard/KeyboardAvoidingView.js>.
This is why adding the component fixes what bare `adjustResize` reliance no longer does — it
was never actually riding on the OS auto-resize to begin with. Which `behavior` value to use
is not something React Native's own docs take a position on (checked
<https://reactnative.dev/docs/keyboardavoidingview>: `behavior` is documented as `'height' |
'position' | 'padding'` with no platform recommendation); zoontek's explicit, repeated
`behavior="padding"` recommendation above is the most authoritative concrete guidance found,
which is why the Recommendation section adopts it over this repo's existing
`Platform.OS === "ios" ? "padding" : "height"` idiom. **Whether that existing `height` idiom
in `auth.tsx`/`index.tsx` is currently broken on a real Android device under this repo's
already-enforced edge-to-edge is not verified here** — see "What we could not verify."

---

## (c) What each option actually does on react-native-web

Checked directly against the pinned `node_modules/react-native-web` (`0.21.2`, matching this
repo's `^0.21.0`), not just the public repo, so this reflects what actually ships in this
app's web bundle.

**`automaticallyAdjustKeyboardInsets`.** A repo-wide search of the installed package's
`dist/` for `automaticallyAdjustKeyboardInsets` or `keyboardInset` returns zero matches. The
prop is not read anywhere — passing it is inert: no error, no effect, nothing happens.

**`KeyboardAvoidingView`.** The entire web implementation:
```js
onKeyboardChange(event) {}
render() {
  const { behavior, contentContainerStyle, keyboardVerticalOffset, ...rest } = this.props;
  return <View onLayout={this.onLayout} {...rest} />;
}
```
`onKeyboardChange` is defined but never wired to any event listener — there is no
`Keyboard.addListener` call anywhere in the file. `behavior`, `contentContainerStyle` and
`keyboardVerticalOffset` are destructured specifically so they are *not* forwarded to the
underlying `View`/DOM node. The component is a complete passthrough: on web,
`<KeyboardAvoidingView>` renders and behaves exactly like a bare `<View>`.
Source (installed file; public source is identical):
<https://github.com/necolas/react-native-web/blob/master/packages/react-native-web/src/exports/KeyboardAvoidingView/index.js>.

**`react-native-keyboard-controller`.** Not installed in this repo. Three independent primary
sources agree it has no web support:

1. Its own compatibility page lists only React Native/architecture version support (Fabric
   from 1.2.0, Paper from 1.0.0) — no web row exists at all.
   Source: <https://kirillzyusko.github.io/react-native-keyboard-controller/docs/guides/compatibility>.
2. Its own maintainer, asked directly about web support in 2022: *"Potentially it can be done
   using `VirtualKeyboard` API"* — a speculative idea, never implemented since.
   Source: <https://github.com/kirillzyusko/react-native-keyboard-controller/discussions/43>.
3. Expo's own SDK reference for the wrapped module declares its supported platforms in its
   page frontmatter as `['android', 'ios', 'expo-go']` — web is not listed.
   Source: <https://docs.expo.dev/versions/latest/sdk/keyboard-controller/>.

Until 2023 this wasn't just "unsupported," it was actively **build-breaking**: issue #208
reported that merely importing from the package crashed an Expo web build (`Unable to resolve
"../Utilities/Platform"`), because the library pulled in RN-internal native-bridge modules
unconditionally. The fix, PR #210, moved the iOS/Android implementation into `.native.ts`
files and added non-suffixed stub fallbacks that Metro's platform resolution picks up for
`web` — described in the PR itself as *"Created stub implementation for other platforms."*
That means current versions (npm shows `1.22.4` as latest at research time) are **safe to
bundle for web** — they no longer crash the build — but still provide **zero actual
keyboard-avoidance behavior** there, consistent with points 1–3 above.
Sources: <https://github.com/kirillzyusko/react-native-keyboard-controller/issues/208>,
<https://github.com/kirillzyusko/react-native-keyboard-controller/pull/210>.

**So what keeps a field visible on web, if all three RN-side mechanisms are inert or absent?**
The browser's own default behavior, entirely outside React/React Native. React-native-web's
`TextInput` renders a genuine DOM `<input>` (or `<textarea>` when `multiline`) — confirmed
from source (`var component = multiline ? 'textarea' : 'input';` in the installed
`TextInput/index.js`) — so ordinary DOM focus semantics apply. MDN: *"By default the browser
will scroll the element into view after focusing it"* (the `focus({preventScroll: false})`
default). Source: <https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus>. And
specifically for the on-screen keyboard: *"Web browsers usually deal with virtual keyboards on
their own, by adjusting the viewport height and scrolling to input fields when focused."*
Source: <https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API>. A repo-wide
search found no `preventScroll` call anywhere in this codebase, so nothing here currently
overrides that default.

---

## (d) Catching a `TextInput` outside a keyboard-aware container

**No such ESLint rule exists, published or installed.** Checked every RN-focused ESLint
plugin found:

- **`eslint-plugin-react-native`** (Intellicode, the most widely used community RN plugin —
  **not installed in this repo**). Full rule list: `no-unused-styles`, `sort-styles`,
  `split-platform-components`, `no-inline-styles`, `no-color-literals`, `no-raw-text`,
  `no-single-element-style-arrays`. All target `StyleSheet`/styling hygiene; none touch
  `TextInput`, `ScrollView`, or keyboard handling.
  Source: <https://github.com/Intellicode/eslint-plugin-react-native>.
- **`@react-native/eslint-plugin`** (the official plugin, from the `facebook/react-native`
  monorepo — also not installed here). One documented rule, `platform-colors`, which enforces
  that `PlatformColor`/`DynamicColorIOS` calls are statically analyzable. Nothing
  keyboard-related.
  Source: <https://github.com/facebook/react-native/tree/main/packages/eslint-plugin-react-native>.
- **`eslint-plugin-react-native-a11y`** (FormidableLabs — not installed here either). Every
  rule targets `accessibilityHint`/`accessibilityRole`/`accessibilityState`/
  `accessibilityLiveRegion`/`importantForAccessibility`/touchable nesting. Nothing about
  `TextInput` placement or the keyboard.
  Source: <https://github.com/FormidableLabs/eslint-plugin-react-native-a11y>.

This repo's actual ESLint stack is `eslint-config-expo` (pulling in `eslint-plugin-expo`,
`eslint-plugin-import`, `eslint-plugin-react`, `eslint-plugin-react-hooks` — confirmed from
`node_modules` and `eslint.config.js`), none of which are RN-component-aware in this sense
either. **Say it plainly: there is no existing rule to turn on. A check has to be written.**

**What a custom check would have to look at, and why it can't be a simple one-file AST rule.**
This repo already has the right primitive for a custom invariant —
`eslint.config.js`'s `no-restricted-syntax` blocks use esquery selectors (e.g.
`Property[key.name=/^(padding...)$/] > Literal[...]`) to catch a pattern *within a single
file's AST*. A same-shape selector for `<TextInput>` (e.g., "a `TextInput` JSX element with no
`KeyboardAvoidingView`/keyboard-aware ancestor **in this file**") is buildable with tools
already in this repo's toolchain. But it would not actually catch issue #87's bug: every
offending `TextInput` here (`lobby.tsx`'s `nameInput`, `friends.tsx`'s search field) is a
descendant of `<MenuLayout>`, and `MenuLayout` renders its own `ScrollView`
**in a different file** (`components/MenuLayout.tsx`). A single-file AST/esquery rule has no
way to know what a JSX element named `MenuLayout` renders internally — that's cross-component
semantic knowledge, not syntax the linter can see from the call site. The unavoidable
consequence: soundness rests on an explicit, maintained **allowlist of trusted wrapper
components** (`KeyboardAvoidingView`, `MenuLayout` once its own `ScrollView` is fixed, or a
`ScrollView` carrying `automaticallyAdjustKeyboardInsets` directly) — flag any `<TextInput>`
under `app/**/*.tsx` or `components/**/*.tsx` whose nearest enclosing JSX tag, walking
outward, is none of those.

That is precisely the shape of this repo's own precedent, `tests/orientation.test.ts`: a
`node:test` file that reads every `.tsx` source file under `app/` and `components/` as text
and pattern-matches specific JSX tags (there, `<Modal`, via a hand-rolled
bracket/quote-depth scanner rather than a real parser) — a **source-scan**, not a unit test
of rendered output, for exactly the reason CLAUDE.md gives: `@testing-library/react-native`
runs on `react-test-renderer`, which never runs flexbox/layout, so no render test can see a
keyboard overlapping a field. A `TextInput`-ancestor check needs the same treatment, plus two
things `orientation.test.ts` also does that a first draft would be tempted to skip:

1. **A self-check pinning the trusted root.** `orientation.test.ts` doesn't just trust
   `GameTable.tsx` to lock orientation correctly — it asserts `GameTable.tsx`'s own source
   calls `lockAsync(... LANDSCAPE)` and never `PORTRAIT`. The `TextInput` check needs the
   equivalent: assert `components/MenuLayout.tsx`'s own `ScrollView` literally carries
   whatever keyboard-aware prop/wrapper the fix adds, *before* trusting every `<MenuLayout>`
   call site elsewhere.
2. **An anti-vacuity test.** `orientation.test.ts` has a dedicated test asserting the `<Modal>`
   scanner actually matched more than zero tags, so a scanner that silently stops matching
   anything still fails loudly rather than passing green having checked nothing. Issue #87
   states this requirement directly: *"prove that check fails on today's `MenuLayout` before
   it passes on the fix."*

**No further published prior art was found for a generic "JSX ancestor lint rule" specific to
keyboard avoidance** — the search surfaced only the general fact that ESLint/typescript-eslint
support custom rules in the abstract, and one paraphrased community observation of the
common practice ("if a screen has more than one TextInput, it gets wrapped in a
`KeyboardAvoidingView`") with no rule enforcing it. That community mention is marked
**secondary** and adds no citable primary claim beyond what's already established above.

---

## What we could not verify

- **The exact RN version that first shipped PR #37766's "only offset when the field would
  actually be covered" improvement.** Confirmed merged to `main` on 2023-09-15; confirmed *not*
  in the version tied to PR #35224 (closed unmerged, Nov 2022). Not confirmed which stable
  release (0.73 is the earliest release date consistent with a September 2023 merge, but no
  changelog/release-notes entry was fetched to confirm it directly).
- **Whether this repo's existing `Platform.OS === "ios" ? "padding" : "height"`
  `KeyboardAvoidingView` usage in `app/auth.tsx` and `app/(online)/index.tsx` is currently
  visibly broken on a real Android device**, now that this repo is unconditionally on SDK 54's
  enforced edge-to-edge. The *mechanism* by which `adjustResize`-only reliance breaks is
  well-sourced (§(b)); whether `KeyboardAvoidingView`'s own `height` mode specifically
  (as opposed to bare reliance on `adjustResize` with no component at all) is affected was not
  found stated in any primary source — RN's own source shows `height` mode is driven by native
  `Keyboard` events, not by window-resize, which argues it should keep working, but no primary
  source confirms or denies a symptom specific to `height` vs `padding` under edge-to-edge.
  This needs a real Android device/emulator check, not more reading.
- **Whether `contentInsetAdjustmentBehavior` and `automaticallyAdjustKeyboardInsets` formally
  document an interaction anywhere in Apple's or React Native's docs.** Not found; treated as
  undocumented-but-plausible per §(a), on the strength of one bug report's workaround attempts,
  not a maintainer statement.
- **A canonical, numbered React Native issue for the "nested horizontal `ScrollView` dismisses
  the keyboard on first scroll" caveat**, beyond the one paragraph in PR #31402's own
  description. Not needed for this repo (no nested/horizontal `ScrollView`s carry
  `TextInput`s here) but flagged rather than treated as exhaustively documented elsewhere.
