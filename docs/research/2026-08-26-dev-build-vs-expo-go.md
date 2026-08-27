# Is a development build worth it on its own merits, independent of the Dynamic Island?

Research date: 2026-08-26. This is evidence, not a decision.

The question asked, verbatim: *"Only if it brings benefits. If it improves performance, build
times, testability, compatibility, unblocks more UX/UI features, etc. — yes. If no benefit, no.
But do a thorough research."*

Every external claim carries a URL that was actually fetched. Every project claim was read out
of this repository — file and line where it matters, or a command whose output is quoted.
Anything that could not be confirmed is in §8 rather than softened inline. This document
deliberately does not advocate: the strongest argument on each side is stated at full strength.

**Scope.** The Dynamic Island / Live Activity case is *out of scope by construction* — it is
settled in `docs/research/2026-08-26-notch-and-dynamic-island.md` §2.1 (a widget extension
cannot run in Expo Go; that is architectural). This document asks whether the move pays for
itself with that feature deleted from the ledger entirely.

---

## 0. The project facts this is measured against

Read from source on 2026-08-26, not assumed.

| Fact | Where |
| --- | --- |
| Expo SDK `~54.0.37`, React Native `0.81.5`, React `19.1.0`, `newArchEnabled: true` | `package.json`, `app.json` |
| **Every native dependency in the project is bundled in Expo Go for SDK 54** | measured — see §5.1 |
| **EAS is already wired**: `extra.eas.projectId: ff2d6d27-8f50-4048-8f19-32c6bceb52d2` | `app.json:62-66` |
| **`eas.json` already has a `development` profile** — `developmentClient: true`, `distribution: internal` | `eas.json:8-11` |
| **A manual EAS build workflow already exists** — `workflow_dispatch`, profiles `development`/`preview`/`production` | `.github/workflows/eas-build.yml` |
| No `ios/` or `android/` directory; both are in `.gitignore` (lines 30-31) — pure CNG | `ls`, `.gitignore` |
| Owner's machine: Windows 11 Home, **no Mac**, Android SDK + emulator + Maestro present, **Gradle absent** | `docs/TESTING.md:145-160` |
| Replit deploy build: `expo:static:build && expo:web:build && server:build`; run: `server:prod` | `.replit` `[deployment]` |
| **The shipped product today is the web bundle.** `eas submit` credentials are placeholders (#27); push credentials do not exist (#32) | `eas.json:23-34`, gh issues |
| Push notifications are a **shipped feature**: token registration, server delivery, a `pushTokens` table | `lib/pushRegistration.ts`, `server/push.ts` |
| The iOS device loop is Expo Go driven by Maestro on `macos-latest`; **red since it landed** | `.github/workflows/ios.yml:15-16` |
| One `patch-package` patch exists, and it patches an **Expo-Go-only** code path | `patches/expo-asset+12.0.13.patch` |
| The app's measured compute is near zero — heaviest rules-engine op 0.96 ms/move, ≤54 sprites, no physics | `docs/adr/0001-…md` |

**The first surprise of this research: most of the setup cost is already paid.** The EAS project
is linked, the `development` profile is written, and the workflow that triggers it is committed.
`eas build --platform ios --profile development` is one dispatch away from running today. The
decision is not "should we build the scaffolding" — it is "should we change the daily loop".

---

## 1. Performance

### 1.1 Development build vs Expo Go: the same engine, the same architecture, the same bundle

There is no runtime difference to claim for this project, and the reasons are structural:

- **Same JS engine.** Hermes in both. Expo Go is itself a React Native app built from the Expo
  SDK; the dev build is "essentially your own version of Expo Go where you are free to use any
  native libraries and change any native configuration"
  ([docs.expo.dev/develop/development-builds/introduction](https://docs.expo.dev/develop/development-builds/introduction/)).
- **Same architecture.** Expo Go supports only the New Architecture, and this project is already
  `newArchEnabled: true` (`app.json:11`). The legacy-architecture escape hatch that a dev build
  uniquely offers on SDK 54 is worthless here — the project does not want it, and SDK 55 removes
  the choice for everyone
  ([docs.expo.dev/guides/new-architecture](https://docs.expo.dev/guides/new-architecture/)).
- **Same JS delivery.** Both load the bundle from the same Metro dev server. Fast Refresh is
  Metro's, not the client's. `npm run expo:dev` serves both identically.

The one asymmetry that is real: **Expo Go links every module in the Expo SDK; a dev build links
only the ones you declared.** That is a native binary-size and cold-start-module-init difference,
not a steady-state frame-rate difference. No official Expo benchmark quantifying it was found
(§8).

### 1.2 The performance claim that matters is irrelevant here — and the reason is worth stating

Any claim about *shipped* performance is about a production build, and **a production build is
reachable today without adopting a dev build at all.** `eas build --profile production` compiles
a standalone binary with minified, non-`__DEV__` JS whether the daily loop is Expo Go or a dev
client. The `production` profile is already in `eas.json:16-21`. The two decisions are orthogonal.

So: *a development build buys nothing for the performance of shipped code.* If the goal is to
measure the app as it will ship, the instrument is `eas build --profile preview` — a one-off,
not a change of loop.

### 1.3 And there is no performance problem to solve

`docs/adr/0001` measured this app's computational requirement as "close to zero — most 'game
engine' arguments assume a rendering or simulation problem this app does not have," with the
heaviest rules-engine operation at 0.96 ms per move. The only performance risk the ADR named as
worth acting on is "sustained frame drops during the deal animation on a low-end Android device"
— and a dev build does not make that faster; it only makes it *measurable in release
configuration*, which `--profile preview` already does.

**Verdict on performance: no benefit. Not a close call.**

---

## 2. Build times and the developer loop

### 2.1 What the loop is today

`npm run expo:dev` starts Metro on Replit behind `EXPO_PACKAGER_PROXY_URL=https://$REPLIT_DEV_DOMAIN`
(`package.json:10`); the owner scans the QR from Expo Go on an iPhone. Install once — from the
App Store, free. Reload in seconds. **Rebuild: never.** This is genuinely excellent and the
honest downside column has to start here.

### 2.2 When a dev build forces a rebuild — the rule, then this project's actual rate

Expo's rule, quoted
([docs.expo.dev/develop/development-builds/introduction](https://docs.expo.dev/develop/development-builds/introduction/)):

> When you only change your app's TypeScript/JavaScript code, there is no need to rebuild the
> native app.

You must regenerate native code only when: installing or updating a library containing native
code; changing your app config; or upgrading the Expo SDK version. And
([docs.expo.dev/develop/development-builds/use-development-builds](https://docs.expo.dev/develop/development-builds/use-development-builds/)):

> If you add a library to your project that contains native code APIs, for example,
> expo-secure-store, you will have to rebuild the development client.

**Measured against this repository's own history** — every commit touching `package.json` or
`app.json`, diffed, and counted as rebuild-forcing if it added/removed/changed a package present
in `expo/bundledNativeModules.json` (excluding `jest-expo`, a devDependency) or changed
`plugins` / `newArchEnabled` / `scheme` / `bundleIdentifier` / `infoPlist` / `adaptiveIcon`:

```
rebuild-forcing commits: 16 / 46 commits touching package.json or app.json
by month: { "2026-03": 6, "2026-08": 10 }
```

The distribution is the finding, not the total:

- **2026-03-01/02 — 6 commits.** Initial scaffolding: `scheme`, `bundleIdentifier`,
  `newArchEnabled`, `adaptiveIcon`, `expo-clipboard`, `expo-screen-orientation`,
  `expo-av`, `netinfo`.
- **2026-03-02 → 2026-08-15 — zero.** Five and a half months, the bulk of the game's
  development, with no rebuild trigger at all.
- **2026-08-15/19 — 10 commits.** A dependency-churn burst: `expo-av`→`expo-audio`,
  `expo-image` and `expo-blur` removed, `react-native-keyboard-controller` removed,
  `expo-localization` and `expo-notifications` added, `infoPlist` written.
- **2026-08-21 → today — zero.**

So the honest answer to "how often would you actually rebuild?" for *this* project is: **not
often, in bursts, and essentially never during feature work.** That is a point in favour of the
dev build, and it is the strongest one in this section. The counter-argument is that the bursts
are unpredictable and land exactly when momentum matters — the Aug 15-19 window would have cost
ten rebuilds in five days.

### 2.3 How long a build takes — what can and cannot be cited

**Expo publishes no baseline build duration.** `docs.expo.dev/build/introduction/` and
`docs.expo.dev/build-reference/` state none. What exists:

| Number | Source | Status |
| --- | --- | --- |
| Full native build **≈23 min**, repack ≈5 min | [Expo blog, Fingerprint Repack](https://expo.dev/blog/accelerating-continuous-integration-with-fingerprint-repack-in-eas-workflows) | Official, but **their example app**, not a guaranteed baseline |
| Build caching cuts build time "by up to 30%", free on all plans | [expo.dev/changelog](https://expo.dev/changelog), 2026-01-26 | Official |
| fastlane/gradlew step "up to 30%" faster from compiler-level caching (SDK 54/55) | [Expo blog, Build fast no matter what](https://expo.dev/blog/build-fast-no-matter-what-how-expo-is-optimizing-for-speed) | Official, relative only |
| Free-plan build timeout: **45 minutes** (paid: 2 hours) | [expo.dev/pricing](https://expo.dev/pricing) | Official |
| Free-plan queue: **"you may experience wait times of 90+ minutes with the low-priority queue depending on demand"** | [expo.dev/pricing](https://expo.dev/pricing) | Official |

What is cached between builds: JS dependencies, Android Maven/Gradle, C/C++ objects via ccache,
iOS CocoaPods artifacts
([docs.expo.dev/build-reference/caching](https://docs.expo.dev/build-reference/caching/)).

**The wall-clock a rebuild costs on the free tier is therefore the build (no citable figure,
Expo's own example says ~23 min) plus the queue (90+ minutes at peak).** That is the number that
matters and it cannot be pinned. Do not plan against a guess.

### 2.4 The Windows constraint — and it is decisive for iOS

Expo's own platform table
([docs.expo.dev/develop/development-builds/introduction](https://docs.expo.dev/develop/development-builds/introduction/)):

| | Android | iOS Simulator | iPhone device |
| --- | --- | --- | --- |
| **macOS** | ✓ | ✓ | ✓ |
| **Windows** | ✓ | ✗ | ✗ |
| **Linux** | ✓ | ✗ | ✗ |

And `eas build --local`: *"macOS and Linux are supported"*; Windows is explicitly unsupported
natively ("On Windows, you can use WSL for local EAS Builds. However, we do not officially test
against this platform and do not support Windows for local builds")
([docs.expo.dev/build-reference/local-builds](https://docs.expo.dev/build-reference/local-builds/)).

**So for iOS, EAS cloud build is mandatory.** There is no local path from this machine. Expo's
counterpoint is real — *"EAS Build also makes it possible to trigger iOS builds from non-macOS
platforms"* — but it means every iOS rebuild is a network round trip through a queue, not a
local compile.

For **Android**, a local dev build is possible on Windows and the owner already has the JDK,
Android SDK and an emulator (`docs/TESTING.md:145-160`) — but not Gradle, which that table
records as "absent — not needed; Expo Go is the whole point". That is a one-time install, not a
blocker.

**And the sting:** builds that run on a physical iPhone are gated on money, not tooling —
*"All builds that run on an iPhone device require a paid Apple Developer account for build
signing"* (same page). The Apple Developer Program is the thing #27 and #32 are both already
blocked on.

**Verdict on build times and the loop: a clear net cost today.** The rebuild rate for this
project is low, which limits the damage; it does not turn the damage into a gain.

---

## 3. Testability

### 3.1 What `ios.yml` does now, and what it would become

Today the job (`.github/workflows/ios.yml`) does: checkout → `npm ci` → start Metro with
`--offline` → warm the bundle → find and boot a simulator → set locale (shutdown + reboot) →
**fetch the Expo Go client matching this project's SDK from `api.expo.dev`** → `simctl install`
→ install Maestro → run `smoke.yaml` with `MAESTRO_EXPO_GO_APP_ID=host.exp.Exponent`. Ceiling
75 minutes; `docs/agents/loops.md` records its real cost as "unmeasured". It is **disabled on
pull requests and has been red since it landed** (`ios.yml:15-16`).

With a dev build, the job forks two ways and neither is obviously better:

- **(a) Build on the runner.** `expo prebuild -p ios` + `xcodebuild` for the simulator, inside
  the same 75-minute budget. This is exactly what issue **#288** already proposes as a separate
  compile job ("A compile is not a render and would not have caught #209, so scope it as 'the
  native project still builds'"). It removes an Expo Go download and adds an Xcode compile. No
  citable duration for that compile (§8).
- **(b) Download an EAS artifact.** Needs `EXPO_TOKEN` (the secret already referenced by
  `eas-build.yml`), a build per native change, and — on the free tier — a queue documented at
  90+ minutes at peak. **That does not fit a per-PR gate.**

### 3.2 What a dev build genuinely removes — quoted from the project's own ticket

Issue **#354** lists every cause of the eight red iOS runs it took to get `smoke.yaml` green:

> the Expo Go bundle id differs by case (`host.exp.Exponent` on iOS, `host.exp.exponent` on
> Android); iOS asks a system dialog before following a custom-scheme link; the dev-menu tip has
> an off switch, `?disableOnboarding=1`; `back` on iOS is an edge swipe that leaves the Expo Go
> experience entirely; the deep link must cold-start Expo Go (`stopApp` before `openLink`)

and then states the case itself:

> A dev build instead of Expo Go removes a whole class of these problems at once (no dev-menu,
> no deep-link prompt, no client-SDK matching) at the cost of a build step per run. Weigh it
> explicitly.

**Every item on that list is an Expo Go artefact, and a dev build deletes all of them
permanently.** `docs/TESTING.md:322-360` adds three more from the Android side: Expo Go is not
on a stock system image and must be downloaded per run; the client carries one SDK at a time so
the newest published client is wrong as soon as it moves ahead of the project; and
`--offline` is required because `app.json` carries an EAS `projectId` and an unauthenticated
runner cannot get a signed manifest.

The flows would change: `MAESTRO_EXPO_GO_APP_ID` and the `MURLAN_PACKAGER_URL` deep-link dance
both disappear, replaced by `appId: com.murlan.cardgame` and a plain `launchApp`. That is a
simplification of `.maestro/` and of both workflows.

### 3.3 The honest counterweights

- **#354's failures were all knowable from documentation.** Its own instruction is "Read the
  tool before you push" — every cause "was answerable without a CI run". A dev build buys
  reliability that reading also buys. What it buys that reading does not is *permanence*: nobody
  has to know any of it again.
- **A dev build does not fix Android.** `maestro.yml` is blocked on **#186** — the emulator
  intermittently never boots. That is a virtualisation failure on the runner, not an Expo Go
  failure.
- **It does not help the loop that actually catches bugs.** `docs/agents/loops.md` is explicit
  that no unit test can see a layout bug and that only Playwright (Chromium, ~35s) catches that
  class. Nothing in §"Pick the loop by what you changed" changes under a dev build; the four
  fast loops (~1s, ~8s, ~35s, ~40s) are all web or Node.
- **It does not replace looking at the device.** `loops.md`: the iOS job "proves the flows still
  run and the app still renders *something* on device — it does not replace looking at the
  device." A rendering defect like #209 still needs a capture either way.

**Verdict on testability: a real but bounded benefit, currently blocked on cost.** It makes the
device jobs simpler and more deterministic. It makes them slower and, on the free tier, too slow
to gate a pull request. It does not touch the loops that catch most defects.

---

## 4. Compatibility — the strongest argument, examined concretely

### 4.1 Nothing this app currently depends on is blocked

Measured, not assumed. Every dependency in `package.json` whose name starts `expo`/`react-native`/
`@expo`/`@react-native`, checked against `node_modules/expo/bundledNativeModules.json` (the SDK 54
module map that defines what Expo Go carries):

```
IN   @expo/vector-icons, @react-native-async-storage/async-storage,
     @react-native-community/netinfo, expo-asset, expo-audio, expo-clipboard,
     expo-constants, expo-font, expo-haptics, expo-linear-gradient, expo-linking,
     expo-localization, expo-notifications, expo-router, expo-screen-orientation,
     expo-splash-screen, expo-system-ui, react-native, react-native-gesture-handler,
     react-native-reanimated, react-native-safe-area-context, react-native-screens,
     react-native-svg, react-native-worklets
OUT  @expo-google-fonts/inter, @expo-google-fonts/rajdhani
```

The two "OUT" entries are JavaScript plus `.ttf` files loaded at runtime through `expo-font`;
they contain no native code and work in Expo Go. **There is no dependency this project has that
Expo Go cannot run.** Expo's own framing:

> If you are using Expo Go, you can only access native libraries that are included in the Expo
> SDK, or libraries that do not include any custom native code.
> ([docs.expo.dev/workflow/customizing](https://docs.expo.dev/workflow/customizing/))

This project is entirely inside that circle today.

### 4.2 The one shipped feature that Expo Go cannot run: push notifications on Android

This is the strongest concrete finding in the whole document, and it is not hypothetical.

**The feature exists and ships.** `lib/pushRegistration.ts` registers an Expo push token on the
Friends screen and withdraws it on logout; `server/push.ts` delivers to
`https://exp.host/--/api/v2/push/send`; `shared/schema.ts` carries a `pushTokens` table with a
five-devices-per-user cap. It is wired to friend game invites (#53, closed).

**Expo's documentation, verbatim**
([docs.expo.dev/versions/latest/sdk/notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)):

> Push notifications (remote notifications) functionality provided by `expo-notifications` is
> unavailable in Expo Go on Android from SDK 53. A development build is required to use push
> notifications. Local notifications (in-app notifications) remain available in Expo Go.

**And the installed package says so itself** — this is in `node_modules` in this repo right now
(`expo-notifications/build/warnOfExpoGoPushUsage.js`), and it is a `console.error` on Android,
not a warning:

```
expo-notifications: Android Push notifications (remote notifications) functionality provided by
expo-notifications was removed from Expo Go with the release of SDK 53. Use a development build
instead of Expo Go.
```

plus a blanket notice at import (`expo-notifications/build/index.js:5-8`):

```
`expo-notifications` functionality is not fully supported in Expo Go:
We recommend you instead use a development build to avoid limitations.
```

**So: a shipped feature of this app cannot be exercised at all on Android without a development
build.** It has presumably never been tested end-to-end on an Android device. Note the
qualifiers that keep this from being decisive on its own: the doc names **Android only** — iOS
Expo Go is not stated as removed, only "not fully supported" (§8) — and the owner tests on iOS.
And the feature is dark anyway: **#32 is open** and the FCM service account and APNs key do not
exist, so no push has ever been delivered from this server to any device by any route.

### 4.3 Everything else, checked and mostly negative

| Candidate | Would it need a dev build? | Evidence |
| --- | --- | --- |
| **`react-native-device-info`** (cutout class) | Yes — not in Expo Go | Already rejected on three grounds in `2026-08-26-notch-and-dynamic-island.md` §1.4, one of which is Expo Go. **Expo Go is already shaping a design decision here** — but the chosen alternative (geometry from `react-native-safe-area-context`) is judged *better*, not merely available. |
| **iOS music (#178)** | **No.** | `lib/music.ts`'s `NATIVE_MUSIC_SUPPORTED = Platform.OS !== "ios"` is an AVFoundation codec problem (cannot demux WebM). The fix is a second encode — Opus-in-MP4 / AAC / ALAC — plus `setAudioModeAsync`. All `expo-audio`, all in Expo Go. A dev build does not unblock this. |
| **Custom fonts** | **No.** | `@expo-google-fonts/*` + `expo-font` load at runtime. `lib/fonts.ts` / `lib/fonts.web.ts`. |
| **Deep links / entitlements** | **No — nothing uses them.** | `expo-linking` is a dependency but `grep` finds **zero** call sites in `app/`, `lib/`, `components/`, `context/`. `scheme: "murlan"` is declared and unused. Associated Domains / universal links would need a build; nothing wants them. |
| **Background tasks** | **No.** | Not installed, and the design excludes it: `server/push.ts`'s own header records that push is wired to invites and *not* turns because the server auto-passes at 30s and seats a bot at 60s, "which no notification can beat". |
| **In-app purchases, App Clips, widget extensions** | Not present, not planned | `grep` for `expo-iap` / `react-native-iap` / `StoreKit` / `TaskManager` / `BackgroundTask`: no hits anywhere in `app/`, `lib/`, `components/`, `server/`. |
| **`expo-glass-effect`** (iOS 26 look) | **No.** | Pinned in this repo's own SDK 54 module map at `~0.1.10` and marked *Included in Expo Go* ([docs.expo.dev/versions/v54.0.0/sdk/glass-effect](https://docs.expo.dev/versions/v54.0.0/sdk/glass-effect/)). |
| **Legacy architecture** | Yes, but unwanted | Only a dev build can set `newArchEnabled: false` on SDK 54; SDK 55 removes the option entirely. |

**One small, real cleanup.** `patches/expo-asset+12.0.13.patch` exists solely to make asset URLs
use `https://` when the dev server is the Replit HTTPS tunnel — and it patches the branch guarded
by `manifest2?.extra?.expoGo?.developer`, i.e. **an Expo-Go-only code path**. Under a dev build
that branch is never taken and the patch becomes dead. (Its own TODO says "Remove after upgrading
to expo 55", which is the same trigger as everything else in this document.) Whether asset
resolution over the Replit HTTPS tunnel then works from a dev build is untested (§8) — a
migration risk, not a benefit.

**Verdict on compatibility: one genuine, present-day gap (Android push), and it is currently
dark for an unrelated reason. Everything else is negative.**

---

## 5. What it costs

The honest downside column.

1. **Money, and it is the real gate.** *"All builds that run on an iPhone device require a paid
   Apple Developer account for build signing"*
   ([intro](https://docs.expo.dev/develop/development-builds/introduction/)). That is the Apple
   Developer Program membership that **#27** and **#32** are already blocked on. Adopting a dev
   build for the owner's own iPhone means paying it now, for a development convenience, rather
   than when the app actually ships to a store.
2. **EAS build economics** ([expo.dev/pricing](https://expo.dev/pricing)):

   | Plan | Cost | Included | Concurrency | Queue |
   | --- | --- | --- | --- | --- |
   | Free | $0 | 15 Android **and** 15 iOS builds/mo (separate quotas) | 1 | low priority, "90+ minutes" at peak |
   | Starter | $19/mo + usage | $45 build credit | 1 | high priority, "we strive for zero wait time" |
   | Production | $199/mo + usage | $225 build credit | 2 | high priority |

   Overage per build: **iOS medium $2, iOS large $4, Android medium $1, Android large $2** —
   iOS is 2× Android. Credits do not roll over. Free-plan build timeout 45 min.
   Against the measured rate in §2.2 (16 rebuild-forcing commits in six months, worst burst 10
   in five days), **the free tier's 15 iOS builds/month is adequate** — the burst would have
   consumed two thirds of one month's quota. The binding constraint is the queue, not the count.
3. **The Replit constraint is *not* violated — state it so nobody re-litigates it.** `.replit`'s
   deploy build is `expo:static:build && expo:web:build && server:build` and its run command is
   `server:prod`. None of those invoke `expo prebuild`; `expo export --platform web` does not run
   config plugins' native side. Replit never compiles a native app. CLAUDE.md's "No build step
   needing local tooling. Must launch from the Run button with no setup" survives untouched.
4. **The Replit dev loop needs proving.** `expo:dev` tunnels Metro through
   `$REPLIT_DEV_DOMAIN` over HTTPS, and the one patch in the repo exists because of that. A dev
   build connects to the same Metro server, but by a different asset-resolution path (§4.3). This
   is the concrete migration risk and it is untested (§8).
5. **Onboarding friction.** Every new device, every collaborator, every fresh CI runner needs the
   binary installed rather than an App Store download. `docs/TESTING.md:262-270` records that
   `npx expo start --android` installs Expo Go automatically on a bare emulator; that
   convenience is lost.
6. **`ios.yml` becomes a build job.** §3.1. Either an Xcode compile inside a 75-minute cap, or an
   artefact download behind a 90-minute queue.
7. **The over-the-air reload loop is genuinely excellent and this is where it is conceded.**
   Scan, run, reload in seconds, forever, free. `docs/adr/0001` lists losing it as one of the
   real costs of any stack change: "Expo Go testing disappears, closing the free device-testing
   path available today."

---

## 6. Reversibility

**High. This is a two-way door, and the repo is already shaped for it.**

- **No native directories exist and none are committed.** `ios/` and `android/` are in
  `.gitignore` (lines 30-31), which is Expo's default: *"The android and ios directories are
  automatically added to .gitignore when you create a new project"*
  ([docs.expo.dev/workflow/continuous-native-generation](https://docs.expo.dev/workflow/continuous-native-generation/)).
  As long as they stay generated rather than hand-edited, reverting is `rm -rf ios android` and
  going back to `npx expo start`.
- **CNG is the whole point of the design**: *"Instead of creating native projects a single time
  and maintaining customizations to those native projects for the lifetime of the codebase,
  short-lived native projects are generated only when needed."* `--clean` deletes and regenerates.
- **Nothing here is "ejecting".** Adopting a dev build changes which binary loads the bundle. It
  does not fork the native project, does not remove Expo, and does not touch `app.json` unless a
  config plugin is added.
- **The one-way parts, named.** (a) Committing `ios/`/`android/` and hand-editing them — do not.
  (b) Config-plugin sprawl: each plugin added is a dependency the Expo Go path would then have to
  shed to go back. (c) Any native dependency actually adopted while on a dev build closes the
  door behind it — which is the point, but it is the door closing.
- **Practically, the two can coexist.** As long as every dependency stays inside the Expo Go
  circle (§4.1), the same source tree runs in both. Expo Go remains available for `npx expo start`
  on any device that has it, and a dev build is installed alongside. This is a spike, not a
  migration, until the first out-of-circle dependency lands.

**A reversible decision deserves a lower bar — and this one clears the reversibility bar
comfortably. It does not currently clear the benefit bar.**

---

## 7. Verdict

> **Not yet — no clear net benefit for this project today; the single event that flips it is the
> Expo SDK upgrade past 54.**

### 7.1 The benefits table

| Claimed benefit | Applies to *this* project? | Evidence |
| --- | --- | --- |
| **Faster app at runtime** | **No** | Same Hermes, same New Architecture (Expo Go SDK 54 supports only the New Architecture, and `app.json:11` is already on it), same Metro bundle. |
| **Faster *shipped* app** | **No — irrelevant** | Production is a standalone binary either way. `eas build --profile production` works today from `eas.json:16-21` without changing the loop. |
| **Solves a measured perf problem** | **No** | `docs/adr/0001`: compute "close to zero", heaviest engine op 0.96 ms/move. There is no problem. |
| **Faster developer loop** | **No — slower** | Expo Go: scan once, rebuild never. Dev build: 16 rebuild-forcing commits in six months (measured, §2.2), each a cloud build behind a queue documented at "90+ minutes" at peak on the free tier. |
| **Rebuilds are rare enough not to hurt** | **Partly true** | Zero rebuild triggers between 2026-03-02 and 2026-08-15. But the Aug 15-19 burst would have cost ten in five days. |
| **Builds locally on the owner's machine** | **No, for iOS** | Expo's table: Windows builds Android only; iOS Simulator ✗, iPhone device ✗. `eas build --local` does not support Windows. EAS cloud is mandatory. |
| **More reliable device CI** | **Yes, genuinely** | #354 lists six Expo Go-specific failure causes; `TESTING.md:322-360` adds three more. All disappear. `.maestro/` flows simplify. |
| **Faster / cheaper device CI** | **No — worse** | `ios.yml` gains either an Xcode compile inside a 75-min cap or an artefact download behind a 90-min free-tier queue. |
| **Fixes the red `ios.yml`** | **Unproven** | It is red for reasons #353/#354 have not diagnosed. Changing the client is a hypothesis, not a fix. |
| **Fixes Android CI (#186)** | **No** | The emulator never booting is a virtualisation failure, unrelated to Expo Go. |
| **Unblocks a dependency the project wants** | **No** | Measured: every native dependency in `package.json` is in SDK 54's Expo Go module map (§4.1). Zero blocked. |
| **Unblocks push notifications** | **Yes on Android — but currently moot** | Expo docs: unavailable in Expo Go on Android from SDK 53; the installed package `console.error`s it. `lib/pushRegistration.ts` + `server/push.ts` ship the feature. **But #32 is open — no FCM key, no APNs key — so no push works by any route today.** |
| **Unblocks iOS music (#178)** | **No** | An AVFoundation codec problem; the fix is a re-encode via `expo-audio`, which is in Expo Go. |
| **Unblocks deep links / entitlements** | **No** | `expo-linking` has zero call sites; `scheme: "murlan"` is unused. |
| **Unblocks IAP / background tasks / App Clips** | **No** | None present, none planned; `server/push.ts` explicitly rejects turn notifications on timing grounds. |
| **Unblocks native fonts / icons** | **No** | `@expo-google-fonts/*` + `expo-font` are runtime, in Expo Go. |
| **Unblocks the iOS 26 glass look** | **No** | `expo-glass-effect ~0.1.10` is *Included in Expo Go* on SDK 54. |
| **Removes the `expo-asset` patch** | **Yes, marginally** | The patch guards `manifest2.extra.expoGo.developer` — dead code under a dev build. Worth ~10 lines. |
| **Setup cost already paid** | **Yes** | `eas.json` `development` profile, `app.json` EAS `projectId`, and `.github/workflows/eas-build.yml` are all committed. One `workflow_dispatch` away. |
| **Reversible** | **Yes, cleanly** | CNG; `ios/`+`android/` gitignored and never committed; nothing is ejected. |
| **Costs money** | **Yes** | An iPhone-device build "requires a paid Apple Developer account for build signing" — the membership #27/#32 are already blocked on. |

### 7.2 The trigger

> **When `package.json`'s `expo` dependency moves off `~54.x`.**

This is not a judgement call — it is a documented cliff, and this project is sitting exactly on
its edge.

Expo Go carries one SDK version per build, and
([docs.expo.dev/troubleshooting/expo-go-version-mismatch](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/)):

> Expo Go on the Apple App Store stops at SDK 54, and SDK 55 and later are not available there.

Confirmed by Expo's own changelog, *Expo Go and the App Store in May 2026*
([expo.dev/changelog/expo-go-and-app-store-may-2026](https://expo.dev/changelog/expo-go-and-app-store-may-2026)):

> Expo Go for SDK 54 will continue to be available on both the App Store and Play Store.

> If you're using it for another purpose, we encourage you to migrate your project to using a
> development build of your app.

**SDK 54 is the last SDK for which the owner's free, frictionless iPhone loop exists.** SDK 55,
56 and 57 are all published (confirmed against `api.expo.dev/v2/versions/latest` on 2026-08-26 —
`iosClientUrl` present for all of them, but those are **simulator** tarballs, which is exactly
what `ios.yml:170-189` downloads and installs with `simctl`). For a **physical iPhone** on SDK
55+, the two documented routes are:

1. **`sign.expo.dev`** — *"This installer uses your Apple ID's free developer provisioning, so it
   does not require a paid Apple Developer Program membership."* And: *"The certificate is valid
   for about seven days. Return to sign.expo.dev to re-sign and reinstall Expo Go when the
   certificate expires."*
2. **`eas go`** — *"build Expo Go for SDK 54 or later and distribute it through your TestFlight
   internal team, which needs an Apple Developer Program membership."*

Read those two side by side with the dev build's cost and the arithmetic inverts. Route 1 is a
**seven-day re-signing treadmill**. Route 2 is *an EAS build plus TestFlight plus the paid Apple
Developer membership* — which is, to within rounding, exactly what an EAS development build
costs. At that point Expo Go stops being the cheap option and becomes a strictly worse
development build, and the same page concludes:

> For a production project, create a development build so the native app and its dependencies
> are controlled by your project.

**So the rule to hold, and stop re-litigating:**

- **Stay on SDK 54 → stay on Expo Go.** Nothing in §4 is blocked, nothing in §1 is faster, and
  §2 is strictly worse. Revisit nothing.
- **Upgrade the SDK → build the dev build in the same change.** Not afterwards, and not as a
  separate decision. The upgrade is what removes Expo Go's advantage; treat the two as one
  ticket. Everything needed is already committed (§0).

### 7.3 Two secondary triggers, either of which flips it early

- **The Apple Developer Program membership gets bought** (for #27 or #32, or to ship at all).
  The moment that is paid, the dominant cost in §5 is already sunk and the dev build's marginal
  cost drops to build minutes — which the free tier's 15 iOS builds/month covers at this
  project's measured rate.
- **Android push is scheduled for real testing.** The moment #32's FCM key exists and someone
  must verify an invite arrives on an Android device, Expo Go cannot do it — documented, and the
  installed package `console.error`s it. That is not a preference; it is the one hard wall §4
  found.

### 7.4 What is *not* a trigger

`ios.yml` being red is not one. It has never been diagnosed (#353, #354), and changing the client
to fix an undiagnosed failure is the exact move `docs/agents/loops.md` was written to prevent.
Diagnose it on Expo Go first; if the cause turns out to be an Expo Go artefact from #354's list,
that is evidence — and it is cheap to get.

---

## 8. Could not verify

1. **Any official Expo baseline for build duration.** Expo's docs state none; only relative
   improvements and one example app at ≈23 minutes. Do not plan against a number.
2. **How long an `expo prebuild -p ios` + `xcodebuild` simulator compile takes on a
   `macos-latest` GitHub runner.** This is the number §3.1 option (a) turns on and nothing found
   states it. Measure it before rewriting `ios.yml`; #288 already scopes the experiment.
3. **Whether remote push works in Expo Go on iOS at SDK 54.** The doc warning names **Android
   only**, and `warnOfExpoGoPushUsage.js` downgrades to `console.warn` off Android — but
   `index.js` still prints "not fully supported in Expo Go" unconditionally. Nothing found states
   the iOS behaviour affirmatively either way. Since the owner tests on iOS, this materially
   changes how strong §4.2 is; resolve it before leaning on that argument.
4. **Whether the Replit HTTPS-tunnelled Metro server serves assets correctly to a development
   build.** `patches/expo-asset+12.0.13.patch` fixes this for Expo Go's code path only; the dev
   build takes a different branch. **This is the concrete migration risk** and the first thing a
   spike should prove.
5. **Whether `sign.expo.dev` works end to end from Windows.** The page describes install over USB
   or QR with an Apple ID; it does not state a host OS requirement. If it does not work from
   Windows, §7.2's route 1 does not exist for this owner and the trigger fires harder.
6. **The exact wall clock of `ios.yml` today.** `docs/agents/loops.md` records it as "unmeasured;
   the job's own ceiling is 75 min". Without it, "slower" in §3 is directional, not quantified.
7. **Any measured startup or memory difference between Expo Go and a development build.** The
   structural argument (Expo Go links every SDK module) is sound; no benchmark was found.
8. **Whether the free tier's "15 Android and 15 iOS builds" is calendar-monthly and whether a
   failed build consumes one.** The pricing page states the quota, not the accounting.
9. **The dev-build page's exact wording on going back to Expo Go.**
   `docs/expo.dev/develop/development-builds/expo-go-to-dev-build/` returns 404; §6's
   reversibility argument is assembled from the CNG page plus this repo's `.gitignore`, not from
   a single page stating it.
