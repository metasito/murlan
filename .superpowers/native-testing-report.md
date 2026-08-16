# Native testing — findings and what was built

## The blunt answer on hardware

**iOS simulator testing is impossible on this machine and there is no substitute.**
It requires macOS and Xcode. Apple ships no simulator for Windows. Maestro's iOS
support is *simulator-only*, so Maestro cannot drive a physical iPhone either —
that is a documented product limitation, not a configuration problem. Anything
claiming to replace a Mac here would be dressing up a workaround as equivalent.

**Android automation cannot run here today either.** Verified rather than assumed:

| Thing | Status |
|---|---|
| OS | Windows 11 Home 10.0.26200 |
| Node | v24.13.1 |
| JDK | 21.0.11 Microsoft OpenJDK — **present** |
| Android SDK | **absent** (no `ANDROID_HOME`, no `%LOCALAPPDATA%\Android`) |
| `adb` | **absent** |
| Android Studio / emulator | **absent** |
| Gradle | **absent** |
| Hardware virtualization | present — an emulator *would* be accelerated |
| WSL 2 | present, Ubuntu 24.04 |

So `npx expo run:android` cannot work as things stand: no SDK, and it additionally
performs a full Gradle native build. No emulator exists to point a test at, so per
the brief I built the highest-value layer that *does* run here and documented the
rest precisely.

## What I recommended, and why

**Jest + `jest-expo` + `@testing-library/react-native` as the first layer.** It is
the only option that runs app code the way a device does *and* runs on this
machine and in CI. It renders through React Native's own renderer rather than
`react-native-web`, so it takes the native side of every `Platform.OS` branch —
exactly where this app diverges. Every suite runs twice, once as `ios` and once
as `android`.

**Maestro is the right *next* layer, but only for Android, and only once an SDK
and emulator exist.** Preferred over Detox: no native debug build, works against
Expo Go, free. Two honest caveats — it has no native Windows build (WSL 2 only,
which Maestro's own docs discourage due to port forwarding), and its iOS support
is simulator-only, so it contributes nothing to the owner's iPhone path.

**Detox rejected** — needs a native debug build, so Android-only on Windows
anyway, for strictly more setup than Maestro.

**EAS Build + device cloud** — noted as informational only; the owner declined a
paid account.

No Maestro flows are checked in. I cannot execute or verify them here, and an
unrunnable suite rots into false confidence. A starter flow lives in
`docs/TESTING.md` as guidance instead.

## What is actually running on this machine

`npm run test:native` — **166 tests, 83 × (ios, android), all passing.**

| Suite | Pins |
|---|---|
| `theme.test.tsx` | `Shadow.*` yields native shadow props, never the web `boxShadow` |
| `haptics.test.tsx` | the settings toggle genuinely silences `expo-haptics` |
| `hapticsBypass.test.tsx` | only `lib/haptics.ts` may reach `expo-haptics` |
| `sounds.test.tsx` | the `expo-audio` path: rewind-before-play, volume, caching, one-time audio mode |
| `render.test.tsx` | all 54 cards + the notification banner mount under the RN renderer with Reanimated worklets live |

Wired into `npm run verify` so it cannot quietly stop running.

### Every new suite was proved able to fail

Five mutations were injected and each was caught: web `boxShadow` on native,
haptics guard removed, a direct `expo-haptics` import reintroduced, `seekTo(0)`
deleted, and the banner returning `null`.

That exercise caught **a defective test of my own**: the banner test asserted
`view.toJSON()` was non-null, but the `SafeAreaProvider` wrapper kept the tree
non-null regardless, so it could never fail. Now it asserts on the banner's own
`alert` role. A check that cannot fail is worse than no check, so it is worth
recording that the mutation run is what exposed it.

## Real bug found and fixed

**The haptics setting was a no-op across almost the whole app.** `lib/haptics.ts`
is where `Platform.OS` and the user's preference are applied, but **eight files**
imported `expo-haptics` directly and called it at **29 sites**, bypassing the
setting entirely: `app/(online)/friends.tsx`, `app/(online)/room.tsx`,
`app/auth.tsx`, `app/index.tsx`, `app/lobby.tsx`, `app/result.tsx`,
`app/tutorial.tsx`, `components/ExchangeModal.tsx`.

Turning haptics off in Settings silenced only the game table. Everything else
kept buzzing. No web test could ever have caught it — `expo-haptics` degrades to
the Web Vibration API, inert on a desktop browser.

All 29 sites now route through the wrapper, verified repo-wide, and
`hapticsBypass.test.tsx` prevents regression across `app/`, `components/`,
`context/` and `lib/`.

## What still needs a Mac or a device

- **Reanimated worklets** — mounted and executed here, but under a shim with no
  UI thread and no frame loop. Jank and UI-thread crashes are device-only.
- **Audio** — the `expo-audio` calls are asserted; audibility, mixing, ducking
  and silent-switch behaviour are device-only.
- **`expo-screen-orientation`** — a no-op on web and still not automatically
  exercised anywhere. The landscape lock is verified only by hand.
- **Safe-area insets** — fixed metrics are injected; real notches are device-only.
- **Text rendering / font weight synthesis**, **Fabric and TurboModules** under
  `newArchEnabled`.

`docs/TESTING.md` carries the full map plus a manual Expo Go checklist, which
remains the owner's free path to a real iPhone.

## Notes for the coordinator

- `npm install` was run **once, before** the no-install instruction arrived. It
  added only pure-JS devDependencies (`jest`, `jest-expo`,
  `@testing-library/react-native`, `test-renderer`) — nothing needing native
  compilation, so Replit's `npm install` is unaffected. No install has run since.
- `package.json` is committed with **both** agents' entries intact. `package-lock.json`
  is left modified in the working tree and **not committed**, for reconciliation.
- Not touched: `tests/e2e/`, `scripts/e2e-server.mjs`, `app/game.tsx`,
  `app/(online)/game.tsx`, `.gitignore`, `graphify-out/`.
