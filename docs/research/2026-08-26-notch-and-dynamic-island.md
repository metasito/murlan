# Designing around the iPhone cutout, and pushing game events into the Dynamic Island

Research date: 2026-08-26. This is evidence, not a decision.

Every external claim below carries a URL that was actually fetched. Version numbers for
npm packages were read from the registry (`npm view`) and repository statistics from the
GitHub API on 2026-08-26, not from prose on a marketing page. Anything that could not be
confirmed is in §7 rather than softened inline.

**The project facts this is measured against**, read from source rather than assumed:

| Fact | Where |
| --- | --- |
| Expo SDK `~54.0.37`, React Native `0.81.5`, `expo-router ~6.0.17`, `newArchEnabled: true` | `package.json`, `app.json` |
| `react-native-safe-area-context ~5.6.0` already a dependency | `package.json` |
| `expo-screen-orientation ~9.0.9` already a dependency | `package.json` |
| `expo-notifications ~0.32.17` already a dependency, already a config plugin | `package.json`, `app.json` |
| Game tables lock to `OrientationLock.LANDSCAPE` — **either** landscape direction | `components/GameTable.tsx:1028` |
| The rail absorbs `insets.left` only; `railWidth(insetLeft, scale)` | `components/gameTableModel.ts:710` |
| Replit's deploy build is `expo:static:build && expo:web:build && server:build`; run is `server:prod` | `.replit` |
| The iOS device loop is Expo Go, driven by Maestro on a `macos-latest` runner | `.github/workflows/ios.yml`, `docs/agents/loops.md` |

---

## 1. Q1 — Telling the three cases apart

### 1.1 Verdict

**A pure-geometry heuristic works, needs no new dependency, and runs in Expo Go on all
three platforms.** `react-native-device-info` is the wrong tool for this project on three
independent grounds, and `react-native-safe-area-context` — which is already installed —
gives the numbers the heuristic needs.

### 1.2 What `react-native-safe-area-context` actually exposes

The whole type surface is four numbers and a window rect
([`src/SafeArea.types.ts`, main branch](https://raw.githubusercontent.com/AppAndFlow/react-native-safe-area-context/main/src/SafeArea.types.ts)):

```ts
export interface EdgeInsets { top: number; right: number; bottom: number; left: number; }
export interface Rect { x: number; y: number; width: number; height: number; }
export interface Metrics { insets: EdgeInsets; frame: Rect; }
```

There is **no** cutout-shape API, no bounding rect, no `hasNotch`, nothing that says which
hardware produced an inset. An open issue asks for exactly that and has no maintainer answer
([#682](https://github.com/AppAndFlow/react-native-safe-area-context/issues/682)). The
library is in Expo Go
([docs.expo.dev/versions/latest/sdk/safe-area-context](https://docs.expo.dev/versions/latest/sdk/safe-area-context/)),
and the project already reads it correctly on web via `env(safe-area-inset-*)` — the
`viewport-fit=cover` requirement is already documented in `computeScreenPads`'s own comment.

Repo health, for the record: 2,752 stars, 115 open issues, last commit 2026-08-18 (GitHub
API, 2026-08-26). Actively maintained.

### 1.3 The inset values that separate the three cases

Read from Use Your Loaf's per-generation tables, which list safe-area insets in both
orientations:
[iPhone 13](https://useyourloaf.com/blog/iphone-13-screen-sizes/),
[iPhone 14](https://useyourloaf.com/blog/iphone-14-screen-sizes/),
[iPhone 16](https://useyourloaf.com/blog/iphone-16-screen-sizes/),
[iPhone 17](https://useyourloaf.com/blog/iphone-17-screen-sizes/).

| Class | Devices | Portrait `top` | Landscape `left` / `right` | Landscape `bottom` |
| --- | --- | --- | --- | --- |
| **Neither** | iPhone 8, SE 2/3 | 20 | 0 | 0 |
| **Notch** | X, XS, 11 Pro | 44 | 44 | 21 |
| **Notch** | XR, 11 | 48 | 48 | 21 |
| **Notch** | 12, 13, 14, 15 non-Pro (844/926 pt) | 47 | 47 | 21 |
| **Notch** | 12 mini, 13 mini | 50 | 50 | 21 |
| **Dynamic Island** | 14 Pro, 15 Pro, 16, 16 Plus | 59 | 59 | 21 |
| **Dynamic Island** | 16 Pro, 16 Pro Max, 17, 17 Pro, 17 Pro Max | 62 | 62 | 20 |
| **Dynamic Island** | iPhone Air | 68 | 68 | 29 |

Two things fall straight out of this table:

- **The ranges do not overlap.** Notch devices land in 44–50; Dynamic Island devices land in
  59–68. There is a nine-point gap with nothing in it. A threshold anywhere in 51–58 separates
  them, and the same threshold works on the portrait `top` and on the landscape side inset,
  because for every device in the table those two numbers are identical.
- **iOS 26 changed the landscape bottom.** iPhone 17 and Air report a non-zero landscape
  `top` (20) and a bottom of 20 / 29 rather than the long-standing 21. Any code that treats
  landscape `top === 0` as an invariant is now wrong on current hardware.

So the heuristic, in the project's own units, is:

```ts
// Landscape-locked game screens read the side inset; menus read insets.top.
const cutoutPt = Math.max(insets.left, insets.right, insets.top);
// none: < 44 · notch: 44–50 · island: >= 55
```

This is derivable data, not a device database, so a phone Apple has not shipped yet lands in
the right bucket as long as Apple keeps the island's reserved band larger than the notch's —
which it has done monotonically across four generations.

### 1.4 Why `react-native-device-info` is the wrong answer here

Three reasons, any one of which is disqualifying:

1. **It is not in Expo Go.** It is a third-party native module with no Expo Go presence. Adding
   it ends the owner's entire test loop for the sake of a boolean the insets already imply.
2. **It is a hardcoded device list.** `hasNotch()` and `hasDynamicIsland()` match a brand and
   model string against `devicesWithNotch.js` / `devicesWithDynamicIsland.js`, so a device
   Apple ships after the last release returns `false`, and a mismatch between what `getModel()`
   returns and what the table holds returns `false` for a device that *is* in the table
   ([issue #1527](https://github.com/react-native-device-info/react-native-device-info/issues/1527),
   closed stale rather than fixed).
3. **The publish cadence has gone quiet.** 6,681 stars, but `15.0.2` was published
   2026-02-21 and the last commit on `master` is the same date — six months at time of
   writing (npm registry and GitHub API, 2026-08-26).

`expo-device` is in Expo Go and would give `Device.modelId` (`"iPhone15,3"`), but its SDK 54
docs contain nothing about notches or cutouts
([docs.expo.dev/versions/v54.0.0/sdk/device](https://docs.expo.dev/versions/v54.0.0/sdk/device/)),
so using it means maintaining the same hardcoded table by hand. Same defect, more work.

### 1.5 The thing the insets cannot tell you, and the fix that is already installed

**iOS reports the landscape side insets symmetrically** — 47 on the left *and* 47 on the
right for an iPhone 14, though the hardware cut is only on one side (see the tables in §1.3).
That is deliberate: it means rotating the device never reflows the layout. It also means
**the insets alone cannot say which side the island is physically on.**

This matters to this codebase specifically. `computeTableFrame` puts the rail on the left
unconditionally, and `railWidth` is fed `insetLeft`:

```ts
// components/gameTableModel.ts:710
export function railWidth(insetLeft: number, scale: number): number {
  return Math.max(RAIL_FLOOR, RAIL_SCALED * scale, insetLeft + RAIL_CUTOUT_CLEARANCE);
}
```

…under a comment stating the design intent: *"A cutout can never sit on a card, but it sits
happily between two controls. The column the cutout occupies is the rail."* Because
`OrientationLock.LANDSCAPE` (`components/GameTable.tsx:1028`) permits both landscape
directions, **that intent is satisfied in one of the two orientations and inverted in the
other.** In the inverted case nothing is *covered* — `tableRight = Math.max(PAD_RIGHT * scale,
rightPad)` still holds content clear — but the island sits over the empty right pad while the
rail's deliberate gap sits over nothing.

The fix needs no new dependency. `expo-screen-orientation` is already installed, is
**included in Expo Go**, and exposes `getOrientationAsync()` returning `LANDSCAPE_LEFT` /
`LANDSCAPE_RIGHT` plus `addOrientationChangeListener()`
([docs.expo.dev/versions/v54.0.0/sdk/screen-orientation](https://docs.expo.dev/versions/v54.0.0/sdk/screen-orientation/)).
Which value corresponds to which physical side must be measured on the device rather than
reasoned about — see §7.

### 1.6 Web

`env(safe-area-inset-*)` returns the same numbers in Mobile Safari on the same hardware, and
the safe-area-context web polyfill already reads them (the project's own probe-div override in
`docs/agents/loops.md` proves it). So the heuristic is genuinely one code path for iOS, Android
and web. On Android the numbers mean something different — see §4.1.

---

## 2. Q2 — Live Activities and the Dynamic Island

### 2.1 Confirmed: it is a SwiftUI widget extension, and it cannot run in Expo Go

Apple's own words
([Displaying live data with Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)):

> To offer Live Activities, add code to your existing widget extension or create a new widget
> extension if your app doesn't already include one. Live Activities use \[WidgetKit\]
> functionality and \[SwiftUI\] for their user interface.

> The code that describes the user interface of your Live Activity is part of your app's
> widget extension.

> If your project includes an `Info.plist` file, add the Supports Live Activities entry to it,
> and set its Boolean value to `YES`.

The plist key is `NSSupportsLiveActivities`
([BundleResources reference](https://developer.apple.com/documentation/bundleresources/information-property-list/nssupportsliveactivities)),
and a second key, `NSSupportsLiveActivitiesFrequentUpdates`
([reference](https://developer.apple.com/documentation/bundleresources/information-property-list/nssupportsliveactivitiesfrequentupdates)),
raises the push budget.

A widget extension is a **separate Xcode target with its own bundle identifier, its own
provisioning profile, and Swift source compiled at build time**. There is no JavaScript path
to it and no way for Expo Go — a fixed, pre-built binary — to contain one. **Refuting this
is not possible; it is architectural.**

### 2.2 Apple's hard constraints, quoted

All from the ActivityKit pages, fetched 2026-08-26.

**Duration** ([Displaying live data](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)):

> A Live Activity can be active for up to eight hours unless its app or a person ends it before
> this limit. After the eight-hour limit, the system automatically ends the Live Activity, and
> immediately removes it from the Dynamic Island. However, the Live Activity remains on the
> Lock Screen until a person removes it or for up to four additional hours before the system
> removes it — whichever comes first. As a result, a Live Activity remains on the Lock Screen
> for a maximum of 12 hours.

**Foreground start**
([`Activity.request(attributes:content:pushType:)`](https://developer.apple.com/documentation/activitykit/activity/request(attributes:content:pushtype:))):

> Use this function to request and start a Live Activity from your app while it's in the
> foreground. Note that you can't do this while your app is in the background, unless you adopt
> \[LiveActivityIntent\] and start the Live Activity using a \[App Intent\].

**Sandbox and payload size** ([Displaying live data](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)):

> Each Live Activity runs in its own sandbox, and — unlike a widget — it can't access the
> network or receive location updates.

> Static and dynamic data for a Live Activity, including data for ActivityKit updates and
> ActivityKit push notifications, can't exceed a combined size of 4 KB.

**Presentations you must all implement:** Lock Screen, Dynamic Island compact leading,
compact trailing, minimal, and expanded (with `DynamicIslandExpandedRegion` at `.center`,
`.leading`, `.trailing`, `.bottom`). *"To add support for Live Activities to your iOS or
iPadOS app, you must support all presentations."* The Lock Screen presentation is truncated
above 160 points.

**Push updates**
([Starting and updating Live Activities with ActivityKit push notifications](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications)):

- The push type is `liveactivity` and the topic is `<your bundleID>.push-type.liveactivity`.
- *"You can't use the User Notifications framework to register your Live Activity for push
  notifications. Instead, you use ActivityKit to obtain a push token."*
- Push-to-start needs iOS 17.2+: *"On devices that run iOS or iPadOS 17.1 and earlier, you
  can't start Live Activities with ActivityKit push notifications."*
- *"The system allows for a certain budget of ActivityKit push notifications per hour… If you
  exceed the budget, the system may throttle your ActivityKit push notifications."* Priority
  `5` does not count toward the budget; priority `10` does and is the default.

**The consequence for this project's server.** The Express server would have to speak APNs
**directly** — token-based JWT auth with a `.p8` key, `apns-push-type: liveactivity`,
`apns-topic: com.murlan.cardgame.push-type.liveactivity`. Expo's push service cannot carry
this: the documented message fields are `to`, `data`, `title`, `body`, `ttl`, `expiration`,
`priority`, `categoryId`, `collapseId`, `richContent`, plus iOS `contentAvailable`, `subtitle`,
`sound`, `badge`, `interruptionLevel`, `targetContentId`, `relevanceScore`, `filterCriteria`,
`threadId`, `mutableContent`
([docs.expo.dev/push-notifications/sending-notifications](https://docs.expo.dev/push-notifications/sending-notifications/)).
There is no push-type field and no ActivityKit token concept. An issue asking Expo how to do
it was closed as not planned with no answer
([expo/expo#43591](https://github.com/expo/expo/issues/43591)).

### 2.3 The libraries, measured

Star counts, open-issue counts and last-commit dates from the GitHub API on **2026-08-26**;
versions and publish dates from the npm registry on the same date.

| Package | Repo | Stars | Open | Last commit | Latest | Verdict for this project |
| --- | --- | --- | --- | --- | --- | --- |
| **`expo-widgets`** (official) | `expo/expo` | 51.8k (monorepo) | — | 2026-08-26 | `57.0.12` | **Best maintained by a wide margin — but does not exist for SDK 54.** |
| `@bacons/apple-targets` | [EvanBacon/expo-apple-targets](https://github.com/EvanBacon/expo-apple-targets) | 1,378 | 72 | **2026-07-17** | `5.0.0` | **The only viable SDK 54 route.** Generates the target; you still write the SwiftUI. |
| `react-native-widget-extension` | [bndkt/react-native-widget-extension](https://github.com/bndkt/react-native-widget-extension) | 565 | 5 | **2026-05-25** | `0.3.0` | Alive, narrower scope, pre-1.0. Plausible fallback. |
| `expo-live-activity` | [software-mansion-labs/expo-live-activity](https://github.com/software-mansion-labs/expo-live-activity) | 522 | 9 | **2026-06-01** | `0.4.2` | **ARCHIVED.** README redirects to `expo-widgets`. Do not adopt. |
| `@bittingz/expo-widgets` | [gitn00b1337/expo-widgets](https://github.com/gitn00b1337/expo-widgets) | 306 | 14 | **2025-06-19** | `3.0.2` | Fourteen months stale. Do not adopt. |
| `react-native-live-activity` | — | — | — | — | `0.1.0`, published **2023-03-20** | Dead on arrival. Do not adopt. The name is a trap. |

**`expo-widgets` is the recommendation the ecosystem has converged on, and it is out of
reach.** Its npm dist-tags begin at `sdk-55`; the version list starts `0.0.0`, then
`55.0.0-alpha.0`. There is no `sdk-54` tag and no 54.x release. Independently:
`require('expo/bundledNativeModules.json')` in this repo's own `node_modules` has no
`expo-widgets` key at all, and `docs.expo.dev/versions/v54.0.0/sdk/widgets/` 404s while
v55/v56/v57 return 200. Expo announced it as alpha on 2026-03-04
([Home screen widgets and Live Activities in Expo](https://expo.dev/blog/home-screen-widgets-and-live-activities-in-expo)),
noting that `expo-apple-targets` *"automated the Xcode setup, but you were still writing
native components in SwiftUI."* Its own docs say plainly: *"This library is not available in
the Expo Go app — use development builds to try it out."*
([docs.expo.dev/versions/latest/sdk/widgets](https://docs.expo.dev/versions/latest/sdk/widgets/))

**Version pin if `@bacons/apple-targets` is chosen on SDK 54:** take `4.0.7`
(published 2026-05-13), not `5.0.0`. v5 pulls `@expo/prebuild-config: ~55.0.6` as a hard
dependency; 4.0.7 has no `@expo/prebuild-config` dependency at all. Both declare
`peerDependencies: { expo: ">=52" }`.

### 2.4 The minimum viable path, and what it costs

There is no path that keeps Expo Go. Ranked by total disruption:

**Path A — dev build on SDK 54, `@bacons/apple-targets@4.0.7`.** Add the plugin, write the
`ActivityAttributes` struct and the five SwiftUI presentations, `npx expo prebuild -p ios`,
then either `npx expo run:ios` (needs a Mac with Xcode) or EAS Build
([docs.expo.dev/develop/development-builds/introduction](https://docs.expo.dev/develop/development-builds/introduction/)).
No SDK upgrade. Most Swift written by hand.

**Path B — upgrade to SDK 55+ and use `expo-widgets`.** The Live Activity UI becomes
`@expo/ui` components under a `'widget'` directive with `createLiveActivity()`, so far less
Swift. Costs an SDK major upgrade *plus* the same dev build. Note that `@expo/ui` on SDK 54 is
pinned at `~0.2.0-beta.9` (read from `expo/bundledNativeModules.json`), so the API this
depends on is itself still beta at the version this project can reach.

**Path C — hand-rolled Expo module.** What `RobotHanzo/TRMission` did (§5). Maximum control,
maximum maintenance.

**What breaks, concretely:**

- **The owner's loop.** Expo Go stops being the way this app is tested on iOS. Every future
  native change needs a rebuild and a reinstall. This is the single largest cost in this
  document and it is not a footnote.
- **`.github/workflows/ios.yml`.** It runs `npx expo start --offline` and drives Expo Go on a
  simulator. A dev build cannot be loaded by Expo Go, so the job must either build the app
  itself on the runner (adding a full Xcode compile to a 75-minute budget) or be retired.

**What does not break:**

- **Replit survives.** The deploy build is `npm run expo:static:build && npm run expo:web:build
  && npm run server:build` and the run command is `npm run server:prod` (`.replit`). None of
  those invoke `expo prebuild`; `expo export --platform web` does not run config plugins'
  native side. An iOS widget extension is never compiled on Replit because **Replit never
  builds the iOS app at all** — it builds and serves the web bundle. The Run-button constraint
  is not violated by adding an iOS-only config plugin, provided the package's JS entry resolves
  under `--platform web` (`expo-widgets` and `@bacons/apple-targets` are both iOS-only, so
  every call site needs a `Platform.OS === "ios"` guard regardless).
- **The Express server can send the pushes.** It already runs Node with a database; adding a
  direct APNs client (`.p8` key in Replit Secrets, alongside `DATABASE_URL` and
  `SESSION_SECRET`) is ordinary server work, not a native build step.

---

## 3. Q3 — iOS 26 "Liquid Glass"

### 3.1 Verdict: available today, in Expo Go, on this SDK, with a built-in fallback

`expo-glass-effect` is pinned in this repo's own SDK 54 module map at `~0.1.10`
(`require('expo/bundledNativeModules.json')['expo-glass-effect']`), and the npm dist-tag
`sdk-54` resolves to `0.1.10`. The **SDK 54 doc page** marks it *Included in Expo Go*
([docs.expo.dev/versions/v54.0.0/sdk/glass-effect](https://docs.expo.dev/versions/v54.0.0/sdk/glass-effect/)).
That is the version this project would install; nothing needs upgrading and nothing needs
prebuilding.

API, from that page:

| Symbol | What it is |
| --- | --- |
| `GlassView` | Renders the effect; `glassEffectStyle` takes `'clear'` or `'regular'`, plus a tint colour |
| `GlassContainer` | Merges several glass views into one continuous effect |
| `isLiquidGlassAvailable()` | Runtime availability check |
| `isGlassEffectAPIAvailable()` | Runtime API check |

Degradation is built in and documented: *"GlassView is only available on iOS 26 and above. It
will fallback to regular View on unsupported platforms."* The platform line reads *iOS, tvOS,
Included in Expo Go* — so on **Android and web it renders a plain `View`**, which for this
project means a `GlassView` with no background token is invisible on two of the three
platforms. Any adoption must put the fallback surface on the component itself, not rely on the
glass.

### 3.2 `@expo/ui`

On SDK 54 this project would get `~0.2.0-beta.9` (`expo/bundledNativeModules.json`). It is
iOS/Android native-component bridging, still beta at the version SDK 54 pins, and is what
`expo-widgets` builds on from SDK 55. It is not the route to a glass look — `expo-glass-effect`
is — and adopting a beta component library to chase one is not warranted.

### 3.3 The design-system collision

`CLAUDE.md` says colour, radius, font size, spacing and timing all come from `lib/theme.ts`,
and `tests/tokenRoles.test.ts` pins that tokens are used in the role they were named for. A
native glass material is none of those things: it is a system-rendered blur whose colour is
the content behind it. Introducing it means either a token that names the *role* ("the
material behind the rail") with a per-platform value, or an explicit exemption. That is a
design decision, not a research finding, and it should be made before the first `GlassView`
lands.

---

## 4. Q4 — Android and web

### 4.1 The Android cutout

The four `layoutInDisplayCutoutMode` values (`DEFAULT`, `SHORT_EDGES`, `NEVER`, `ALWAYS`) are
documented on Android's
[Support display cutouts](https://developer.android.com/develop/ui/views/layout/display-cutout)
page — **and on Android 15+ with `targetSdk 35+` all of `DEFAULT`, `SHORT_EDGES` and `NEVER`
are reinterpreted as `ALWAYS` for non-floating windows.** Android 16 removes the last opt-out:
`windowOptOutEdgeToEdgeEnforcement` "is deprecated and disabled" and "apps can't opt-out of
going edge-to-edge"
([Android 16 behaviour changes](https://developer.android.com/about/versions/16/behavior-changes-16)).
Expo SDK 54 states the same from its side: with RN 0.81 targeting Android 16, *"edge-to-edge
will be enabled in all Android apps, and cannot be disabled"*
([expo.dev/changelog/sdk-54](https://expo.dev/changelog/sdk-54)). **So there is nothing to
configure. The setting is effectively dead.**

`react-native-safe-area-context` *does* fold the cutout into its Android insets. On API 30+ it
computes
([`SafeAreaUtils.kt`, main branch](https://raw.githubusercontent.com/AppAndFlow/react-native-safe-area-context/main/android/src/main/java/com/th3rdwave/safeareacontext/SafeAreaUtils.kt)):

```kotlin
rootView.rootWindowInsets?.getInsets(
  WindowInsets.Type.statusBars() or
  WindowInsets.Type.displayCutout() or
  WindowInsets.Type.navigationBars() or
  WindowInsets.Type.captionBar()
)
```

It is a **union**: one number per edge, no way to tell a punch-hole from a status bar. And
under true immersive mode it can come back all zeros on notched devices
([issue #201](https://github.com/AppAndFlow/react-native-safe-area-context/issues/201)).

**Bounding rects are not reachable from JS.** Android exposes `DisplayCutout.getBoundingRects()`
and `getSafeInsetTop()`, but nothing bridges them, and safe-area-context's public types
(§1.2) have no field for them. For a landscape-locked table this means the rail can absorb a
*width* but can never know *where along the edge* the hole sits. Getting that requires a native
module, a config plugin and a prebuild — no Expo Go path. Edge-to-edge itself is *"enabled by
default in the Expo Go app, with no opt-out"*
([Expo edge-to-edge blog](https://expo.dev/blog/edge-to-edge-display-now-streamlined-for-android)),
so the behaviour the owner sees in Expo Go is representative.

**The practical answer for Q1 on Android: the §1.3 heuristic does not port.** A 24dp Android
inset is a status bar, not a cutout, and the numbers carry no class information. Treat Android
as "avoid the insets" — which the code already does — and do not attempt cutout-aware design
there.

### 4.2 Android 16 "Live Updates" — real, and unreachable from Expo

Android 16 (API 36) shipped *Promoted Ongoing* notifications, branded Live Updates
([developer.android.com/develop/ui/views/notifications/live-update](https://developer.android.com/develop/ui/views/notifications/live-update)):
`Notification.ProgressStyle`, `Notification.Builder.setShortCriticalText()` (the status-bar
chip text), `NotificationCompat.Builder.setRequestPromotedOngoing()`,
`Notification.hasPromotableCharacteristics()`,
`NotificationManager.canPostPromotedNotifications()`, `Notification.FLAG_PROMOTED_ONGOING`,
and the manifest permission `android.permission.POST_PROMOTED_NOTIFICATIONS`. They surface in
the status-bar chip, at the top of the drawer, on the lock screen, on AOD, and bridged to
Wear OS. Disqualifiers: custom `RemoteViews`, `setGroupSummary(true)`, `setColorized(true)`.

Rendering is Pixel-first
([Android Authority hands-on](https://www.androidauthority.com/android-16-live-updates-demo-3528456/));
Samsung One UI 8 routes them into its own **Now Bar** rather than Google's chip
([Android Authority](https://www.androidauthority.com/one-ui-8-live-updates-support-3573794/)).
No other OEM confirmed.

**`expo-notifications` cannot post one.** Its Android surface is `badge`, `color`, `priority`,
`vibrationPattern`, `autoDismiss`, `sticky`, `vibrate`, plus channel configuration
([docs.expo.dev/versions/latest/sdk/notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)).
There is no `Notification.Style` of any kind, no progress bar, no promoted-ongoing flag. A
custom module would have to build with `NotificationCompat.Builder` + `ProgressStyle` +
`setShortCriticalText` + `setRequestPromotedOngoing(true)` + `setOngoing(true)`, subclass
`FirebaseMessagingService` for data-only messages (Android has no system-owned update channel
like APNs-to-ActivityKit), and **re-post the same notification ID** for every update — there is
no `updateActivity` equivalent. Config plugin, prebuild, dev build; payoff on Pixel and Samsung
on Android 16 QPR1+ only.

Also relevant to this app: remote push via `expo-notifications` is **unavailable in Expo Go on
Android from SDK 53 onward**. Local notifications still work there.

### 4.3 Web

Effectively nothing. The Badging API (`navigator.setAppBadge()` / `clearAppBadge()`) puts a
number or a dot on an installed PWA icon
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Badging_API)) — and most browsers
including Chrome **require a visible notification on every push**, so silently bumping "it's
your turn" is not achievable
([Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/badging-api)).
Chrome for Android does not expose `setAppBadge` at all; Safari supports it for home-screen web
apps from 16.4+ once notification permission is granted
([WebKit](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)). The Notification
API is a fire-and-forget toast. There is no persistent, self-updating, system-rendered surface.

### 4.4 So: does a cross-platform design exist?

**No. It forks, and it forks three ways.**

| | iOS | Android | Web |
| --- | --- | --- | --- |
| Cutout class detectable | Yes, from geometry (§1.3) | No — insets carry no class | Same as iOS, via `env()` |
| Cutout bounding rect | No | No (native module only) | No |
| Persistent glanceable surface | Live Activity — widget extension, dev build | Live Update — native module, dev build, Pixel/Samsung on API 36 QPR1+ | None |
| Update channel | APNs `liveactivity`, direct, not via Expo | Data-only FCM, re-post by ID | — |

The only honest cross-platform abstraction is at the *event* layer, not the presentation
layer: one server-side "it is your turn in room X" event, rendered as a Live Activity on iOS, a
plain `expo-notifications` push everywhere else, and nothing on web beyond the tab title.

---

## 5. Q5 — Prior art

### 5.1 What Apple says Live Activities are for

From the HIG
([developer.apple.com/design/human-interface-guidelines/live-activities](https://developer.apple.com/design/human-interface-guidelines/live-activities)):

> Offer Live Activities for tasks and events that have a defined beginning and end. Live
> Activities work best for tracking short to medium duration activities that don't exceed eight
> hours.

> Update a Live Activity only when new content is available.

> Alert people only for essential updates that require their attention… **don't use push
> notifications alongside Live Activities for the same updates**.

> Don't replicate notification layouts.

> Avoid displaying sensitive information. Live Activities are prominently visible and could be
> viewed by casual observers.

> Don't add elements to your app that draw attention to the Dynamic Island.

**Games are never named as a use case.** Every Apple example is delivery, rideshare, sports,
workouts, timers, flights.

### 5.2 Did anyone ship this for a turn-based game?

**No shipping commercial turn-based game was found doing it.** Searched: App Store listings,
GitHub repository and code search (`ActivityAttributes` alongside `isMyTurn` / `yourTurn` /
`currentPlayer` / `opponent`), Reddit, HN, Apple's showcases and WWDC26 sessions.

- **Chess.com** — no evidence of any Live Activity support, despite a documented history of
  *failing* to notify users when a turn arrives
  ([chess.com forum](https://www.chess.com/forum/view/help-support/timer-issue-in-ios)), which
  is the exact pain a Live Activity would fix.
- **Lichess** — zero hits for "live activity" or "dynamic island" across
  `lichess-org/mobile` issues. The nearest request is a plain push notification
  ([#2918](https://github.com/lichess-org/mobile/issues/2918)).
- **Words With Friends, Zynga, backgammon apps** — nothing found.

**That absence is the finding.** A turn-based game is the obvious fit on paper and essentially
nobody has shipped it.

### 5.3 The two open-source existence proofs

**`RobotHanzo/TRMission`** — a Ticket-to-Ride-style turn-based board game, an **Expo /
React Native monorepo** with a hand-rolled `modules/live-activity` native module
([`useLiveActivity.ts`](https://github.com/RobotHanzo/TRMission/blob/main/apps/mobile/src/game/useLiveActivity.ts),
[`TRMissionLiveActivityWidget.swift`](https://github.com/RobotHanzo/TRMission/blob/main/apps/mobile/ios-live-activity/TRMissionLiveActivityWidget.swift)).
It keeps **one** activity per game, hands its push token to the server so turn changes arrive
while the app is suspended, shows a turn label tinted when it is your turn plus a self-ticking
countdown, room code, and score. It ends with a two-minute "game over" linger, deep-links via
a custom scheme, is behind an explicit opt-in setting, is mounted only for seated players (not
spectators, not the tutorial or offline sandbox), and no-ops off iOS. Caveat: 2 stars, no
license — a personal project, not a proven pattern, but a genuine existence proof on a stack
very close to this one.

**`Okay-U/Riftbound-Consort`** — a companion score-tracker for a TCG
([`RiftboundWidgetsLiveActivity.swift`](https://github.com/Okay-U/Riftbound-Consort/blob/main/RiftboundWidgets/RiftboundWidgetsLiveActivity.swift)).
Shows deck names, a score stepper against a target, and a timer. It is a **local** scorekeeper:
no "your turn" state, no push updates.

### 5.4 The near-misses, and what they omit

OneSignal's survey of 22 Live-Activity apps contains **zero games**
([onesignal.com](https://onesignal.com/blog/best-examples-of-apps-using-live-activities-to-enrich-their-ux/)).
Sports (MLB, NBA, FotMob) surface score, inning, outs — never play-by-play. Travel (Uber,
Citymapper, Flighty) surface ETA and gate — never the map. Fitness surfaces elapsed and
distance — never a dashboard. Timers surface one countdown.

The consistent shape is **one number or one state, updated infrequently, that saves you from
unlocking the phone.** The thing nobody ships is the interactive turn prompt.

### 5.5 What this means for a Murlan Live Activity

The 8h/12h ceilings do not bind: a *manche* lasts minutes, a *partita* under an hour. The
binding constraint is the opposite one. An activity that lives four minutes and changes every
few seconds is closer to a chat than to a delivery, and runs straight into *"update only when
new content is available"* and *"alert only for essential updates."* Apple's model is a
slow-moving status; a trick-taking game is fast-moving.

The natural unit is therefore **the partita, not the trick** — one activity started when the
player sits down, updated when the turn passes *to them* (not on every card played by anyone),
ended when the match ends. TRMission's design is the only worked example of that shape.

One further constraint specific to a landscape-locked game: iOS 26/27 added a **landscape
Dynamic Island presentation** where the compact and minimal presentations "do not have the same
flexible width you get in portrait," with `@Environment(\.isDynamicIslandLimitedInWidth)`
exposed so you can swap in an icon-only view
([WWDC26 session 223](https://developer.apple.com/videos/play/wwdc2026/223/)). A Murlan player
is *by definition* in landscape while playing — so the width-limited variant is not an edge
case here, it is the primary case whenever the app is foregrounded.

---

## 6. Recommendation

### 6.1 Cheap, do now — no new dependency, no build change, stays in Expo Go

1. **Add a cutout-class helper derived from the insets** (§1.3), living beside
   `computeScreenPads` in `components/gameTableModel.ts` since that is already the one place
   insets are interpreted. Pure function, unit-testable at ~1s per `docs/agents/loops.md`,
   no platform divergence to trip over. It gives the table a fact it currently does not have.
2. **Make the rail follow the island, not the left edge** (§1.5). `expo-screen-orientation` is
   already installed and in Expo Go; `getOrientationAsync()` plus
   `addOrientationChangeListener()` say which landscape direction is live, and therefore which
   physical side the cut is on. Today the rail's stated design intent — *"the column the cutout
   occupies is the rail"* — holds in one of two orientations. **Before writing the fix, get a
   device capture of `/capture` in both landscape directions** and read which side the island
   is actually on; per `docs/agents/loops.md`, a native geometry claim argued from code gets one
   thing right and two things wrong. This is a layout change, so it needs Playwright *and* a
   device capture, not `jest`.
3. **Fix the iOS 26 landscape-bottom assumption** (§1.3). iPhone 17 and Air report landscape
   `top: 20` and `bottom: 20`/`29`, not the historical `top: 0, bottom: 21`. Check
   `HAND_ZONE_H` and the e2e specs' pinned inset values against that; the prototype's own
   844×390 / inset-x 47 / inset-b 21 handset is an iPhone 14, and current hardware no longer
   matches it.
4. **Nothing on Android.** The insets there carry no cutout class and the mode setting is dead
   (§4.1). Leave it avoiding the insets, which it already does.
5. **`expo-glass-effect` is available and free** (§3.1) — installable at `~0.1.10`, in Expo Go
   on SDK 54, silently falling back to a plain `View` off iOS 26. Worth a spike *only* if the
   design wants it; it is not a cutout answer and it needs a token-role decision first (§3.3).

### 6.2 Expensive, needs a decision — a Live Activity

Everything in Q2. Concretely: `@bacons/apple-targets@4.0.7` as a config plugin, an
`ActivityAttributes` struct and five SwiftUI presentations written by hand, `NSSupportsLiveActivities`
in `app.json`'s `ios.infoPlist`, ActivityKit push tokens round-tripped to the Express server, and
a **direct APNs client** on the server with a `.p8` key in Replit Secrets — because Expo's push
service cannot send this push type (§2.2). Plus a `Platform.OS === "ios"` guard at every call
site, and a defined fallback: a plain `expo-notifications` push on Android, nothing on web
(§4.4).

**Replit survives this** (§2.4). The deploy build never runs `expo prebuild` and never compiles
an iOS target; it exports the web bundle and bundles the server. That constraint is not the
blocker.

**The owner's test loop does not survive it.** Expo Go cannot load a widget extension —
architecturally, not incidentally. Every iOS test becomes a dev build, and
`.github/workflows/ios.yml`, which drives Expo Go on a simulator, must either grow a full Xcode
compile inside a 75-minute budget or be retired.

### 6.3 The one question that must be answered first

> **Is the owner willing to give up Expo Go as the iOS test loop — permanently, for every
> future change, not just for this feature?**

Everything else follows. If the answer is no, §6.2 is closed and §6.1 is the whole of the work.
If the answer is yes, the *second* question — and only then — is whether to pay for an SDK 55+
upgrade to get `expo-widgets` (§2.4 Path B) instead of hand-writing SwiftUI on SDK 54 (Path A),
because that upgrade is the difference between maintaining Swift forever and maintaining
TypeScript.

Note the asymmetry that makes this worth asking rather than assuming: §5.2 found **no shipping
turn-based game doing this at all**. That is either a gap worth being first through, or a
signal that the people best placed to ship it looked and declined. This document cannot tell
the two apart.

---

## 7. Could not verify

1. **Which `Orientation` value puts the island on which physical side.** `LANDSCAPE_LEFT` and
   `LANDSCAPE_RIGHT` are documented as enum members
   ([docs.expo.dev/versions/v54.0.0/sdk/screen-orientation](https://docs.expo.dev/versions/v54.0.0/sdk/screen-orientation/))
   but the docs do not say which corresponds to the device's home button being on which side,
   and iOS's own naming has been inconsistent historically. **Measure it on the device before
   writing §6.1 item 2.**
2. **Whether iOS still reports symmetric landscape insets on iOS 26.** The Use Your Loaf tables
   report symmetric left/right for every device including iPhone 17 and Air, and the project's
   own e2e harness assumes it, but the tables are one author's measurements, not Apple's.
3. **`expo-live-activity`'s exact archive date.** The GitHub API reports `archived: true` with
   `pushed_at: 2026-06-01`; the README's deprecation notice pointing at `expo-widgets` was read
   from the rendered page. The date the archive flag was set is not exposed.
4. **`@bacons/apple-targets`' SDK 54 compatibility, empirically.** The peer range is `expo >=52`
   and 4.0.7 carries no `@expo/prebuild-config` pin, so it *should* work — but nobody in this
   research ran `expo prebuild` against SDK 54 with it. Prove it with a throwaway prebuild before
   committing to Path A.
5. **Whether Apple's push budget throttling is survivable at Murlan's update rate.** Apple says
   there is "a certain budget… per hour" and never states the number
   ([ActivityKit push docs](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications)).
   `NSSupportsLiveActivitiesFrequentUpdates` raises it, users can turn that off, and only
   measurement will say whether one push per turn-handover fits.
6. **The exact `layoutInDisplayCutoutMode` RN 0.81 / Expo SDK 54 applies on Android.** Verified
   as `shortEdges` in `values-v27` of zoontek's `react-native-edge-to-edge` — the code RN
   vendored — but not read out of RN's own source. Mostly moot: Android 15/16 collapse every
   mode to `ALWAYS`.
7. **Android 16 API-level gating of `setRequestPromotedOngoing`.** The API 36 vs API 36.1
   (QPR1) split came from secondary walkthroughs; Android's own Live Update page lists the APIs
   without per-API level stamps.
8. **Whether Chess.com or Words With Friends ship a Live Activity.** Absence of evidence. App
   Store "What's New" entries could not be fetched directly.
9. **The Apple HIG page body.** Quoted in §5.1 via a subagent's fetch of
   `developer.apple.com/design/human-interface-guidelines/live-activities`; the design HIG is not
   served by the JSON documentation API used for the ActivityKit quotes in §2.2, which were
   extracted from Apple's own machine-readable source and are verbatim.
