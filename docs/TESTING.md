# Testing

Five layers exist today; four run reliably and the fifth — the only one that
touches a real phone OS — is set up and partially working, with the exact
blocker documented below rather than glossed over.

| Layer | Command | Size | Needs |
|---|---|---|---|
| Unit | `npm test` | everything under `tests/`; the files under `tests/integration/` self-skip without `DATABASE_URL` and report `skipped 0` with it | nothing |
| Integration | `npm test` | folded into the above | `DATABASE_URL` |
| Native renderer | `npm run test:native` | every `tests/native/` suite, once per platform (ios, android) | nothing |
| Web e2e | `npm run test:e2e` | Playwright, chromium — gameplay, reconnect, a tap-target sweep of every screen at three sizes, and a check that no part of the table renders off the side of one | Docker + a built web bundle |
| Android UI (Maestro) | `maestro test .maestro/*.yaml` | 2 flows | Android SDK + emulator + Maestro, see §5 |

`npm run verify` runs typecheck, unit/integration, the native suite and lint.
The web e2e suite is deliberately excluded — it builds the Expo web bundle and
is far slower than the rest. The Maestro layer is not wired into `verify` or
CI — see §5 for exactly what runs and what does not on this machine.

---

## 1. Unit — `npm test`

`node --test` over `tests/**/*.test.ts`. Pure logic: the rules engine, card
combinations, dealing, scoring, the exchange phase, the AI, the table layout
model, card-face geometry, spoken card names, the daily streak, the offline
save, the ladder's arithmetic, the push request shape, i18n key parity, colour
contrast and suit separation under colour-vision deficiency.

Several suites read source or shipped assets rather than calling a function,
because the property they protect is structural: that every `<Modal>` supports
landscape, that no fill token is used as a text colour, that the twelve sound
files are real non-silent PCM, that match history's prune and read share one
bound, that `db:push` cannot offer to rename the session table, that every
statement the boot-time schema bootstrap emits is additive and idempotent and
every error code the server can emit has a translation, that no inbound
socket event is registered outside the boundary wrapper, that every vignette
piece spans a full edge of the felt rather than drawing its inner edges across
it, that no component animates without consulting the reduced-motion setting,
and that no spring is written inline instead of naming one from the tokens.

Node strips types natively, so these files import `.ts` specifiers directly and
can only load modules that do not import `react-native`. That is why the table's
logic lives in `components/gameTableModel.ts` apart from the `.tsx` component.

**Covers:** every game rule, and the arithmetic behind the UI.
**Cannot cover:** anything that renders, and anything platform-dependent.

## 2. Integration — same command, plus a database

`tests/integration/` drives a real Socket.io server against real Postgres:
auth and the socket handshake, gameplay integrity, stats persistence, the
ladder and replay writes, spectating, client crash reports, test server
cleanup, and that a database the server has never seen works on the first boot.

The harness creates an empty Postgres schema and nothing else — the tables
inside it come from the app's own `ensureSchema()`, exactly as in production. So
every suite here is also a test that boot-time schema creation works.

`tests/helpers/gameDriver.ts` is the shared machinery: everything
`handleGameOver` writes — stats, history, replays, ratings — needs the same
"get a real table to finish" driver, so it lives once rather than once per
suite.

Without `DATABASE_URL` these suites skip and report why. They are not silently
absent; a skipped run prints `DATABASE_URL not set`, and CI fails on that
string rather than accepting a green run that tested nothing.

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
| `theme.test.tsx` | `Shadow.*` yields native shadow props — except the card pair, which needs two shadows at once and so rides `boxShadow`; and that a card's contact and cast shadows move apart on a lift |
| `haptics.test.tsx` | the settings toggle actually silences `expo-haptics` |
| `hapticsBypass.test.tsx` | no module reaches `expo-haptics` except `lib/haptics.ts` |
| `sounds.test.tsx` | the `expo-audio` path: rewind-before-play, volume, caching, one-time audio mode |
| `render.test.tsx` | every card and the notification banner mount under the RN renderer with Reanimated worklets live |
| `a11yCollapse.test.tsx` | a labelled control exposes one accessible node, not two |
| `motionPreference.test.tsx` | the animation setting overrides the OS reduce-motion preference in both directions |

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

`npx expo start` must already be running, and the device needs a route to it:

```
adb reverse tcp:8081 tcp:8081
```

Both flows reach the dev server at `exp://127.0.0.1:8081` over that forward,
which works on any emulator including a CI runner. `10.0.2.2`, the emulator's
alias for the host loopback, was the default before and is not universal: on
the GitHub runner's emulator a request to it never reaches the dev server at
all — Metro logs no request over it, while the same request to `127.0.0.1`
from the host answers `200`.

**That address cannot be overridden from the command line.** `-e` is applied
*before* a flow's own `env:` block, so the block wins and the flag is ignored
without a word. A `maestro test -e MURLAN_PACKAGER_URL=...` invocation looks
like it works and does not; check `commands.json` in the debug output, which
records both assignments in the order they were applied. For a physical
device, edit the `env:` key in the flow.

Both flows previously hardcoded one machine's LAN IP, which had since changed —
so they could not run even on the machine they were written on, let alone
anywhere else. Verified both ways after the change: a cold start against the
default passes, and the same flow against a wrong port fails.

### What CI runs, and what it does not

`.github/workflows/maestro.yml` runs **`smoke.yaml` only**, and **on demand
only** — `on: workflow_dispatch:`, with no `push` trigger. It was taken off
`main` for #186's boot flake; #354 owns bringing a trigger back, and wants
`pull_request` rather than `push`. Settling #186 alone is not enough to restore
it, because the job is also red on #619.

`offline-game.yaml` reached the game table on a runner and then died there with
no assertion message - the emulator going down, not the app being wrong, and the
thing this section predicted before the job had ever run. More memory, more
cores and a longer wait changed nothing. It still passes locally, a real hand to
the result screen in about sixteen minutes. See #185.

That last paragraph is the state as of **2026-08-21**, and it cannot be
rechecked yet: the tutorial-skip block in `offline-game.yaml` waits on a Skip
control that taps and does nothing on Android (#619), so the flow no longer
reaches the table at all.

That is an inference, and worth marking as one. No run of `offline-game.yaml`
exists to show it — CI drives `smoke.yaml` only, as three lines above says. What
was measured is smoke's *identical* skip block failing 4/4 on Android; the two
flows carry the same block, so the same wall stands in front of both.

### What CI supplies that a developer's machine supplies by hand

The first time this job ran, each of these was missing in turn (#35), and each
one stops the flows before they reach a single screen the app renders:

- **Expo Go is not on a stock system image.** Locally `expo start --android`
  installs it on first connect. The job downloads the client for the SDK
  `package.json` pins — Expo Go carries one SDK at a time, so the newest
  published client is the wrong one as soon as it moves ahead of this project.
- **The dev server must be reachable from the guest** — see `adb reverse` above.
- **`expo start --offline`.** `app.json` carries an EAS `projectId`, so Expo Go
  asks the linked project for a *signed* manifest; signing wants an
  authenticated Expo account, and a runner has none. Without it the request
  fails with `Input is required, but 'npx expo' is in non-interactive mode`,
  and the device reports only "Something went wrong". Offline serves the same
  manifest unsigned, which Expo Go accepts.

Metro also bundles on demand, so without warming it the first request for the
bundle is the device's — a cold build of the whole app inside the 60s the flows
allow for it to appear, on cores the emulator is competing for.

### Real findings from actually running this, not just writing YAML

**Expo Go's own dev-menu is two stacked layers, and the top one lies about
being dismissible.** On a fresh connection Expo Go shows a "this is the dev
menu" explainer *rendered on top of* its real dev menu sheet (Reload / Go
Home / Show Element Inspector / etc). Tapping the explainer's own "Continue"
button dismisses only the explainer — the sheet underneath stays open and
silently swallows every further tap. `tapOn` against it reports `COMPLETED`
with no observable effect, which is a bad failure mode: no error, just a
flow that quietly does nothing from that point on.

So both layers have to go, and only in this order: tap **Continue** to clear
the explainer and reveal the sheet, then one hardware **back** press to close
the sheet. That is what both flows do. A back press against the *explainer*
dismisses neither — it leaves the experience for Expo Go's own launcher, and
every assertion after it then fails against a screen the app never rendered.
A developer meets the explainer once; a runner installs Expo Go fresh on every
job, so it meets it every time.

**The flows are not independent unless they are made to be.** Both drive the
same Expo Go install one after the other, and the order is not fixed — CI ran
them the opposite way round from this machine. Whichever runs second inherits
the first's state, which is why each `launchApp` sets `clearState`.

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

**A labelled control must hide its own children from the accessibility
tree.** `Pressable` defaults `accessible` to true
(`react-native/Libraries/Components/Pressable/Pressable.js`: `accessible:
accessible !== false`), so setting that prop changes nothing. What the default
does *not* do is remove children, so a visible label survives as a second
matchable node with the same text — one `clickable=true`, one not, and a
plain-text selector can match either.

Decorative children are therefore hidden explicitly
(`accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`).
`CardView` takes a `decorative` prop for the case where a labelled wrapper
contains a card that would otherwise announce itself again.
`tests/native/a11yCollapse.test.tsx` pins both halves: an unhidden child is
reachable, and hiding it leaves only the button.

That was not merely an accessibility concern on the tutorial header: while the
label survived as a second node, a tap by *either* selector landed on the right
element by every diagnostic available (`uiautomator dump` showed correct bounds
and `clickable: true`) yet never fired the RN `onPress`, so both flows fell back
to a raw coordinate tap.

**Both halves of that are now resolved, and the workaround outlived its cause.**
Collapsing the header into one accessible node made `tapOn: "Salta il
tutorial"` fire the real `onPress` — confirmed on the emulator, through the real
Android accessibility tree, which is the one thing the Jest suite structurally
cannot check. The coordinate tap meanwhile started missing the button outright
as the header's layout shifted, and is gone from both flows.

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
   of this machine, per issue #55's original plan — CI runners
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
