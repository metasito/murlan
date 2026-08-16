# Testing

Five layers exist today; four run reliably and the fifth — the only one that
touches a real phone OS — is set up and partially working, with the exact
blocker documented below rather than glossed over.

| Layer | Command | Size | Needs |
|---|---|---|---|
| Unit | `npm test` | 504 pass, 1 skip | nothing |
| Integration | `npm test` | folded into the above | `DATABASE_URL` |
| Native renderer | `npm run test:native` | 166 (83 × ios/android) | nothing |
| Web e2e | `npm run test:e2e` | Playwright, chromium | Docker + a built web bundle |
| Android UI (Maestro) | `maestro test .maestro/*.yaml` | 2 flows | Android SDK + emulator + Maestro, see §5 |

`npm run verify` runs typecheck, unit/integration and the native suite. The web
e2e suite is deliberately excluded — it builds the Expo web bundle and is far
slower than the rest. The Maestro layer is not wired into `verify` or CI —
see §5 for exactly what runs and what does not on this machine.

---

## 1. Unit — `npm test`

`node --test` over `tests/**/*.test.ts`. Pure logic: the rules engine, card
combinations, dealing, scoring, the exchange phase, the AI, the table layout
model, i18n key parity, colour contrast.

Node strips types natively, so these files import `.ts` specifiers directly and
can only load modules that do not import `react-native`. That is why the table's
logic lives in `components/gameTableModel.ts` apart from the `.tsx` component.

**Covers:** every game rule, and the arithmetic behind the UI.
**Cannot cover:** anything that renders, and anything platform-dependent.

## 2. Integration — same command, plus a database

`tests/integration/` drives a real Socket.io server against real Postgres:
auth and the socket handshake, gameplay integrity, stats persistence, test
server cleanup.

Without `DATABASE_URL` these four suites skip and report why — that is the
single skip in the count above. They are not silently absent; a skipped run
prints `DATABASE_URL not set`.

**Covers:** server authority, ticket auth, disconnect grace, AFK timers,
persistence.
**Cannot cover:** anything client-side.

## 3. Native renderer — `npm run test:native`

Jest via `jest-expo`, configured in `jest.config.js`. **This is the only layer
that runs app code the way a phone does.** Every suite runs twice, once with
`Platform.OS === 'ios'` and once with `'android'`, so a branch correct on one
platform and wrong on the other shows up as one red project rather than a pass.

This matters because the web e2e suite runs through `react-native-web`, which
resolves a different module graph and takes the *other* side of every
`Platform.OS` branch. Code that only exists on a device was previously
unexercised by anything.

| Suite | What it pins |
|---|---|
| `theme.test.tsx` | `Shadow.*` yields native shadow props, never the web `boxShadow` |
| `haptics.test.tsx` | the settings toggle actually silences `expo-haptics` |
| `hapticsBypass.test.tsx` | no module reaches `expo-haptics` except `lib/haptics.ts` |
| `sounds.test.tsx` | the `expo-audio` path: rewind-before-play, volume, caching, one-time audio mode |
| `render.test.tsx` | every card and the notification banner mount under the RN renderer with Reanimated worklets live |

Tests are named `.test.tsx` on purpose: `npm test` globs `tests/**/*.test.ts`
and must not pick them up, since Node's type stripper cannot load `react-native`.

`hapticsBypass.test.tsx` exists because the bug it now prevents shipped: eight
screens imported `expo-haptics` directly, so the haptics setting was a no-op
everywhere except the game table. Nothing on web could observe it — `expo-haptics`
degrades to the Web Vibration API, which is inert on a desktop browser.

**Covers:** `Platform.OS` branches, native module contracts, worklet-bearing
components mounting, hook order, the always-mounted banner invariant.
**Cannot cover:** anything requiring real pixels, a real GPU, a real UI thread,
or a real audio device. The renderer produces a tree, not a frame. Mocked native
modules assert *that we call them correctly*, not that the OS obliges.

## 4. Web e2e — `npm run test:e2e`

Playwright against the real server and a real browser, in Italian. Full games
played to completion, offline and online. See `tests/e2e/`.

**Covers:** end-to-end flow, navigation, real socket traffic, UI state.
**Cannot cover:** the native runtime. It is React Native Web.

---

## What no automated layer here covers

These are real divergences between web and device, and they remain verifiable
only by running the app on hardware:

- **Reanimated v4 worklets.** Layer 3 mounts the components and runs the worklet
  functions, but under a shim: there is no UI thread and no frame loop. Jank,
  a worklet crashing on the UI thread, and reduced-motion behaviour are device-only.
- **Audio.** Layer 3 asserts the `expo-audio` calls. Whether sound is audible,
  correctly mixed, ducks other apps, or survives the silent switch is device-only.
- **Screen orientation.** `expo-screen-orientation` is a no-op on web. The
  landscape lock in `components/GameTable.tsx` has never been exercised
  automatically at all.
- **Haptics.** Now correctly gated and asserted, but whether the phone actually
  buzzes is device-only.
- **Safe-area insets.** Layer 3 injects fixed metrics. Real notches, dynamic
  islands and gesture bars are device-only.
- **Text rendering.** Font weight synthesis, Rajdhani/Inter fallback and line
  breaking differ from the browser.
- **The New Architecture** (`newArchEnabled: true`) and the React Compiler.
  Fabric and TurboModules are not what Jest renders into.

---

## What this machine can run

Verified on the development machine, not assumed:

| Thing | Status |
|---|---|
| OS | Windows 11 Home 10.0.26200 |
| Node | v24.13.1 |
| JDK | 21.0.11 (Microsoft OpenJDK) — present |
| Android SDK | **installed** — `commandlinetools` + `platform-tools` + `platforms;android-34` + `system-images;android-34;google_apis;x86_64` + `emulator`, at `C:\Android\sdk` (outside the repo, gitignored if it were inside it) |
| `adb` | **present** — `C:\Android\sdk\platform-tools\adb.exe`, version 37.0.1 |
| Android emulator (AVD) | **present** — `murlan_test`, Pixel 6 profile, Android 14 (API 34), boots and runs |
| Maestro | **present** — `~/.maestro/bin`, CLI 2.8.0, runs natively on Windows (no WSL needed — see below) |
| Gradle | absent — not needed; Expo Go is the whole point |
| Hardware virtualization | present (WHPX), the emulator is accelerated |
| WSL 2 | present, Ubuntu 24.04, **not used** — see below |

So layers 1–4 all run here, and layer 5 (Android/Maestro) now exists and
partially runs. Nothing iOS-shaped does — that remains impossible on Windows.

### iOS

**iOS simulator testing is impossible on Windows.** It requires macOS and Xcode;
Apple ships no simulator for any other OS and there is no workaround worth
calling one. Maestro's iOS support is *simulator-only*, so Maestro cannot drive
a physical iPhone either — that is a documented limitation, not a setup problem.

The owner's free path to a real iPhone remains **Expo Go**, driven by hand:

```
npx expo start
```

then scan the QR from Expo Go on the device. This is why
`react-native-keyboard-controller` was removed and why nothing here should
reintroduce a library requiring a custom dev client. Manual checklist below.

## 5. Android UI automation — Maestro

**This is the only layer that drives a real Android OS**: real touch dispatch,
real orientation lock, real Reanimated worklets on a UI thread, real haptics
and audio calls reaching an actual (emulated) device, real Expo Go — none of
which layer 3's Jest shim or layer 4's `react-native-web` can see. It is also
the only layer that would have caught the tutorial button issue documented
below, because it is the only one that taps at real screen coordinates through
the real Android accessibility tree.

### One-time setup

**Android SDK.** Full Android Studio is not needed — just the command-line
tools:

```
# download commandlinetools-win-*_latest.zip from
# https://dl.google.com/android/repository/commandlinetools-win-<ver>_latest.zip
# unzip so the layout is <sdk>\cmdline-tools\latest\bin\sdkmanager.bat
# (sdkmanager insists on the "latest" folder name — a straight unzip
# produces <sdk>\cmdline-tools\cmdline-tools\bin, which it rejects)

sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" ^
  "system-images;android-34;google_apis;x86_64" "emulator"
```

Installed at `C:\Android\sdk` on this machine (outside the repo — nothing
downloaded here should ever land inside it or be committed).

**Environment variables a human must set permanently** (this session set them
per-shell only; they do not survive a new terminal without this):

```
ANDROID_HOME=C:\Android\sdk
ANDROID_SDK_ROOT=C:\Android\sdk
PATH += C:\Android\sdk\platform-tools;C:\Android\sdk\emulator;C:\Android\sdk\cmdline-tools\latest\bin
```

**AVD.**

```
avdmanager create avd -n murlan_test -k "system-images;android-34;google_apis;x86_64" -d pixel_6
```

**Boot it** (headless — no visible window, which is what a CI-style or
background run needs):

```
emulator -avd murlan_test -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect
```

Prove it booted:

```
adb devices                              # emulator-5554   device
adb shell getprop sys.boot_completed     # 1
```

Boot takes a few minutes on first cold start; `boot_completed` polls until
it flips, it does not appear instantly.

**Locale.** The emulator defaults to `en-US`. The app's convention (matching
the Playwright suite) is Italian selectors, and `lib/i18n.ts` falls back to
Italian only for *unsupported* locales — `en-US` is supported, so it renders
English unless told otherwise:

```
adb shell settings put system system_locales it-IT,en-US
adb reboot          # a plain relaunch is not enough; the setting needs a reboot to take effect
```

**Maestro.** The documented WSL2 route was a dead end anyone would hit first —
**it is unnecessary on this machine**. Maestro is a Java CLI; the standard
installer (`curl -Ls "https://get.maestro.mobile.dev" | bash`) is a bash
script, and Git Bash on Windows has bash, curl, unzip and (via the JDK
already on this machine) java — everything the installer checks for. It runs
natively there, installs to `~/.maestro`, and talks to the *same* Windows
`adb` server the emulator is already registered with, so there is no
cross-VM port-forwarding to set up at all. Confirmed with `maestro --version`
→ `2.8.0`.

**The app on the emulator.** Expo Go, not a dev build — the whole reason
`react-native-keyboard-controller` was removed was to keep this path open:

```
npx expo start --android
```

With a connected/booted emulator and no Expo Go installed yet, this installs
Expo Go automatically and opens the project via `exp://<lan-ip>:8081` deep
link. Confirmed working: Metro bundled 1883 modules and the app rendered.

### Running the flows

```
export ANDROID_HOME=/c/Android/sdk
export PATH="$ANDROID_HOME/platform-tools:$PATH:$HOME/.maestro/bin"
cd murlan
maestro test .maestro/smoke.yaml
maestro test .maestro/offline-game.yaml
```

`npx expo start --android` must already be running and connected, and the
packager URL baked into both flows (`exp://192.168.1.217:8081`) must match
what that command printed — it is this machine's LAN IP, not portable. A
human on a different machine/network updates that one line in both files.

### Real findings from actually running this, not just writing YAML

**Expo Go's own dev-menu is two stacked layers, and the top one lies about
being dismissible.** On a fresh connection Expo Go shows a "this is the dev
menu" explainer *rendered on top of* its real dev menu sheet (Reload / Go
Home / Show Element Inspector / etc). Tapping the explainer's own "Continue"
button dismisses only the explainer — the sheet underneath stays open and
silently swallows every further tap. `tapOn` against it reports `COMPLETED`
with no observable effect, which is a bad failure mode: no error, just a
flow that quietly does nothing from that point on. One hardware **back**
press dismisses both layers together; that is what both flows use.

**A center-tap on a fanned/overlapping hand card can select the wrong card.**
The hand renders each card overlapping the next one drawn on top of it. Maestro
(and a plain `adb shell input tap`) both tap the *center* of an element's
reported accessibility bounds by default, and that center point is frequently
covered by the next card's z-order, so the tap lands on the neighbor instead —
confirmed with `adb shell uiautomator dump`: the reported bounds for the
intended card were correct, the physical touch just hit the sibling. Tapping
~20px into a card's exposed left sliver (the region before the next card's
left edge starts covering it) is reliable; tapping center is not. This is a
real rendering characteristic of the hand UI, not a test-tooling bug, and
worth knowing before writing any flow that selects a specific card.

**A missing accessibility label forced a fragile selector, and is worth
fixing.** The tutorial screen's header "Salta" (skip) button renders its
label as a plain child `Text` next to the `Pressable`, instead of the
`Pressable` collapsing into one accessible node. That leaves *two* matchable
nodes in the tree with the visible text "Salta": the real, correctly-labelled
`Pressable` (`accessibilityLabel="Salta il tutorial"`, `clickable=true`), and
the inner `Text` (`clickable=false`) that Maestro's plain-text selector
happens to match. Tapping by that text — or even by the Pressable's own
correct `accessibilityLabel` — lands on the right *element* by every
diagnostic available (`uiautomator dump` shows correct bounds, `clickable:
true`) but the tap still never fires the RN `onPress`; only a raw coordinate
tap at the same point does. The root cause was not fully isolated in the time
available, but the missing `accessible` grouping on `tutorial.tsx`'s header
`Pressable`s (`~line 505-507`, same shape on the back-chevron button) is a
real gap — screen readers see the same ambiguity Maestro does. Worth fixing
in the app; `.maestro/smoke.yaml` documents the point-tap workaround in place
of it.

**Reanimated's continuous animations can make Maestro wait forever on a
tap.** The game table has always-on Reanimated glow/pulse effects (the
active-turn highlight, the selected-card glow). Maestro's default `tapOn`
waits for the UI to "stop changing" before returning; against a screen that
never stops changing, every single tap blocks for its full internal timeout.
A first full `offline-game.yaml` run took **~17 minutes** for what should
have been a few dozen fast taps, before the emulator gave out. Pinning
`waitToSettleTimeoutMs: 500` on every `tapOn` in that screen's section
dropped a comparable run to under 4 minutes. Any future flow that taps
anything on the live game table needs this, or it will look "stuck" rather
than failed.

### What is confirmed working end-to-end

- `smoke.yaml`: launches the app through Expo Go, clears the dev-menu and
  first-launch tutorial, and asserts the home screen rendered — **passes
  reliably, repeatedly**, including from a fully cleared app state.
- `smoke.yaml` **can fail**: verified by swapping in an assertion for text
  that does not exist (`maestro test` exited 1, real assertion failure
  reported) — see the flow's own passing run alongside that check.
- `offline-game.yaml`'s logic — lobby configuration (2 players, "Manche
  secca"), the opening-move card-selection algorithm (including the
  overlap-tap fix above), and a real card play accepted by the
  server-authoritative engine with the AI responding — was verified
  correct **step by step**, both by hand (`adb shell input tap` matching
  each flow step, screenshotted at every stage) and by Maestro reaching and
  correctly executing each of those steps in two full automated runs.

### What is blocked, and where exactly

**A full unattended `maestro test .maestro/offline-game.yaml` run does not
reliably reach the result screen on this machine.** Across four full runs,
after configuring the lobby and tapping "Inizia Partita" — i.e. right around
the landscape rotation into the live, continuously-animated game table — the
run failed two different ways:

- Twice, Android itself force-killed the app's activity (`ActivityTaskManager:
  Force finishing activity host.exp.exponent/.experience.ExperienceActivity`,
  confirmed in `adb logcat`, followed by the process dying and Expo Go's own
  launcher reappearing — not a JS crash, not a Maestro error).
- Twice more, after trying `-gpu angle_indirect` and a larger `hw.ramSize`
  (3072M) to rule out software-rendering exhaustion, the **emulator process
  itself** died mid-run (`device 'emulator-5554' not found`), with no crash
  message in its own log.

Both failure modes land at the same point: the transition into the
orientation-locked, Reanimated-heavy game table. This reads as a genuine
performance/stability ceiling of software-rendered (`swiftshader_indirect`)
headless emulation on this host under sustained animated load, not a flow
logic defect — the flow's logic is independently verified correct (above).
Reverting to the original `swiftshader_indirect` + default RAM configuration
restored the known-stable baseline that `smoke.yaml` passes on.

**What would unblock it, roughly in order of promise:**

1. A host with real GPU passthrough for the emulator (a Hyper-V/WHPX
   accelerated *display*, not just CPU virtualization — this machine has the
   latter but the emulator still falls back to a software renderer for
   OpenGL under `-no-window`).
2. Reducing Maestro's own polling load on the accessibility tree during the
   animated screen (fewer/less frequent hierarchy dumps), since the crashes
   correlate with sustained high-frequency `uiautomator` dumps against a
   screen that never stops re-rendering.
3. Running the same flow on GitHub Actions' Android emulator action instead
   of this machine, per `docs/BACKLOG.md` B2's original plan — CI runners
   provide a different (often better-behaved) virtualization stack, and this
   is exactly the kind of host-specific flakiness that's worth confirming
   isn't universal before spending more time on it locally.

### Selectors

Prefer accessibility labels/`testID`s (`id: "btn-passa"`, `id: "btn-gioca"`,
`id: "game-table"`, `id: "btn-home"` all exist and were used). Where a label
doesn't exist or doesn't work as an element selector (see findings above),
both flows fall back to `point:` percentage taps and say so in a comment at
the point of use — never silently.

**Detox** was considered and rejected: it requires a native debug build, so on
Windows it is Android-only anyway, and it is markedly heavier to set up for
strictly more than Maestro asks.

**EAS Build plus a device cloud** would cover real iOS hardware, but it costs
money and the owner has declined a paid Apple Developer account. Noted only so
the option is not silently omitted.

---

## Manual device checklist

The honest residue: run these by hand on a real phone via Expo Go before a
release. Everything here is something no layer above can see.

1. Game screens lock to landscape, and menu screens rotate freely.
2. Card lift, the flying card and the exchange animation are smooth, and a card
   appears exactly once — never twice, never zero times.
3. Sound plays with the ringer off, and the settings toggle silences it.
4. Haptics fire on card select, play and win — and stop when switched off.
5. The notification banner slides in, waits, and slides out without being cut off
   by the notch or the gesture bar.
6. Fonts render at the right weight; nothing is clipped.
7. Backgrounding mid-game and returning reconnects within the 60s grace window.
