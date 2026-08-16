# Testing

Four layers run today. Each covers something the others structurally cannot, and
none of them touches a real phone. This file says plainly where the coverage ends.

| Layer | Command | Size | Needs |
|---|---|---|---|
| Unit | `npm test` | 504 pass, 1 skip | nothing |
| Integration | `npm test` | folded into the above | `DATABASE_URL` |
| Native renderer | `npm run test:native` | 166 (83 × ios/android) | nothing |
| Web e2e | `npm run test:e2e` | Playwright, chromium | Docker + a built web bundle |

`npm run verify` runs typecheck, unit/integration and the native suite. The web
e2e suite is deliberately excluded — it builds the Expo web bundle and is far
slower than the rest.

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
| Android SDK | **absent** — no `ANDROID_HOME`, no `%LOCALAPPDATA%\Android` |
| `adb` | **absent** |
| Android Studio / emulator | **absent** |
| Gradle | **absent** |
| Hardware virtualization | present, so an emulator *would* be accelerated |
| WSL 2 | present, Ubuntu 24.04 |

So layers 1–4 all run here. Nothing device-shaped does.

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

### Android

`npx expo run:android` **cannot work here today** — it needs the Android SDK,
which is not installed, and it performs a full Gradle native build on top of that.

To make Android automation possible, in order:

1. Install Android Studio (or just the command-line tools), an SDK platform, and
   a system image. Set `ANDROID_HOME` and put `platform-tools` on `PATH`.
2. Create an AVD and boot it. Virtualization is already enabled here.
3. Install **Expo Go** on the emulator and run `npx expo start` — this skips the
   Gradle build entirely and is much the cheaper path.
4. Drive it with Maestro (see below).

### Maestro — the recommended next layer, once an emulator exists

Maestro is the right choice over Detox: YAML flows, no native debug build, works
against Expo Go, free. Two caveats, both real:

- It has **no native Windows build**. It runs under WSL 2, which is installed
  here, but Maestro's own documentation discourages the WSL route because it
  needs advanced port forwarding to reach the emulator.
- Its **iOS support is simulator-only**, so it contributes nothing to the iPhone
  path described above. It is an Android layer on this machine.

No flows are checked in, because none can be executed or verified here and an
unrunnable suite rots. A minimal starting flow, once step 3 above works:

```yaml
appId: host.exp.exponent   # Expo Go; use com.murlan.cardgame for a dev build
---
- launchApp
- tapOn: "Gioca offline"
- tapOn: "Inizia partita"
- assertVisible: "Passa"
```

Selectors must be Italian — `locales/it.ts` is the source of truth, the same
convention the Playwright suite follows.

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
