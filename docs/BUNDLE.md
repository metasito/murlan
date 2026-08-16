# Bundle size report

Generated: 2026-08-16

Regenerate with `node scripts/bundle-report.mjs > docs/BUNDLE.md` after adding/removing assets or dependencies.

## Assets (`assets/`)

Total: **2.87 MB** across 18 files.

| File | Size |
|---|---|
| assets/images/splash-icon.png | 1.34 MB |
| assets/images/icon.png | 1.19 MB |
| assets/images/android-icon-foreground.png | 76.9 KB |
| assets/sounds/game_win.wav | 62.5 KB |
| assets/sounds/game_lose.wav | 33.6 KB |
| assets/sounds/round_win.wav | 29.3 KB |
| assets/sounds/round_start.wav | 25.0 KB |
| assets/sounds/bomb.wav | 20.7 KB |
| assets/sounds/exchange.wav | 20.7 KB |
| assets/images/android-icon-background.png | 17.1 KB |
| assets/sounds/your_turn.wav | 16.8 KB |
| assets/sounds/deal.wav | 16.4 KB |
| assets/sounds/card_pass.wav | 8.2 KB |
| assets/sounds/card_play.wav | 8.2 KB |
| assets/sounds/card_select.wav | 5.6 KB |
| assets/images/android-icon-monochrome.png | 4.0 KB |
| assets/sounds/urgent_tick.wav | 3.9 KB |
| assets/images/favicon.png | 1.1 KB |

## Production dependencies (installed size in `node_modules/`)

Total: **150.06 MB** across 46 declared dependencies.

| Package | Installed size |
|---|---|
| react-native | 72.63 MB |
| expo | 15.25 MB |
| drizzle-orm | 7.90 MB |
| @expo-google-fonts/inter | 7.67 MB |
| react-dom | 6.25 MB |
| @expo/vector-icons | 5.73 MB |
| react-native-svg | 3.94 MB |
| react-native-reanimated | 3.54 MB |
| zod | 3.43 MB |
| react-native-gesture-handler | 3.11 MB |
| react-native-web | 2.89 MB |
| expo-router | 2.80 MB |
| react-native-screens | 2.25 MB |
| @expo-google-fonts/rajdhani | 2.05 MB |
| socket.io | 1.61 MB |
| socket.io-client | 1.35 MB |
| react-native-keyboard-controller | 1.09 MB |
| react-native-worklets | 763.0 KB |
| expo-audio | 739.5 KB |
| @tanstack/react-query | 719.0 KB |
| pino | 648.0 KB |
| @react-native-community/netinfo | 533.8 KB |
| @react-native-async-storage/async-storage | 371.9 KB |
| expo-clipboard | 265.5 KB |
| pino-pretty | 248.0 KB |
| react-native-safe-area-context | 225.3 KB |
| expo-font | 216.9 KB |
| expo-screen-orientation | 200.3 KB |
| react | 163.1 KB |
| expo-linking | 155.6 KB |
| expo-localization | 144.2 KB |
| express-rate-limit | 137.7 KB |
| express-session | 135.5 KB |
| expo-constants | 125.8 KB |
| expo-splash-screen | 115.6 KB |
| bcryptjs | 109.7 KB |
| helmet | 101.2 KB |
| expo-linear-gradient | 100.6 KB |
| pg | 87.7 KB |
| drizzle-zod | 86.0 KB |
| pino-http | 83.7 KB |
| expo-haptics | 78.2 KB |
| expo-system-ui | 75.0 KB |
| express | 73.7 KB |
| expo-status-bar | 24.3 KB |
| connect-pg-simple | 23.8 KB |

## Notes

- `node_modules/` installed size is not the same as what Metro ships to the device. Metro tree-shakes per-file imports, so packages that bundle many assets internally (`@expo/vector-icons`, `@expo-google-fonts/*`) only contribute the specific icon families / font weights actually imported, not their full installed size.
- `assets/images/icon.png` and `assets/images/splash-icon.png` dominate the assets total. Both are required (referenced by `app.json`'s `icon` and `expo-splash-screen` plugin config) and are already DEFLATE-compressed close to the practical floor for their pixel content — a lossless zlib level-9 re-encode of the existing pixels only recovers ~2-4%, not enough to justify adding an image-optimization step.
- `assets/images/android-icon-monochrome.png` is 432x432 while the other adaptive-icon layers (`android-icon-foreground.png`, `android-icon-background.png`) are 512x512. This is a visual-consistency mismatch, not a size problem (it is already the smallest icon file). Left as-is; flagged for design follow-up outside this report's scope.
