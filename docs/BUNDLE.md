# Bundle size report

Generated: 2026-08-16

Regenerate with `node scripts/bundle-report.mjs > docs/BUNDLE.md` after adding/removing assets or dependencies.

## Assets (`assets/`)

Total: **3.84 MB** across 32 files.

| File | Size |
|---|---|
| assets/images/splash-icon.png | 1.34 MB |
| assets/images/icon.png | 1.19 MB |
| assets/sounds/deal.wav | 268.8 KB |
| assets/sounds/card_pass.wav | 90.5 KB |
| assets/sounds/bomb.wav | 87.0 KB |
| assets/images/android-icon-foreground.png | 76.9 KB |
| assets/sounds/game_win.wav | 75.8 KB |
| assets/sounds/exchange.wav | 72.4 KB |
| assets/sounds/round_start.wav | 67.2 KB |
| assets/sounds/card_select.wav | 58.6 KB |
| assets/sounds/game_lose.wav | 38.8 KB |
| assets/images/cards/king_of_clubs.png | 38.0 KB |
| assets/images/cards/king_of_hearts.png | 37.4 KB |
| assets/images/cards/king_of_diamonds.png | 35.4 KB |
| assets/images/cards/queen_of_hearts.png | 34.0 KB |
| assets/images/cards/jack_of_diamonds.png | 33.5 KB |
| assets/images/cards/queen_of_clubs.png | 33.3 KB |
| assets/images/cards/jack_of_spades.png | 32.5 KB |
| assets/images/cards/jack_of_hearts.png | 32.4 KB |
| assets/images/cards/jack_of_clubs.png | 32.2 KB |
| assets/images/cards/king_of_spades.png | 31.6 KB |
| assets/sounds/card_play.wav | 30.2 KB |
| assets/sounds/round_win.wav | 30.2 KB |
| assets/images/cards/queen_of_spades.png | 28.9 KB |
| assets/images/cards/queen_of_diamonds.png | 26.3 KB |
| assets/images/android-icon-background.png | 17.1 KB |
| assets/sounds/your_turn.wav | 16.4 KB |
| assets/sounds/urgent_tick.wav | 7.8 KB |
| assets/images/android-icon-monochrome.png | 4.0 KB |
| assets/sounds/README.md | 3.0 KB |
| assets/images/cards/README.md | 1.7 KB |
| assets/images/favicon.png | 1.1 KB |

## Production dependencies (installed size in `node_modules/`)

Total: **134.53 MB** across 46 declared dependencies.

| Package | Installed size |
|---|---|
| react-native | 72.53 MB |
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
| expo | 850.0 KB |
| react-native-worklets | 763.0 KB |
| expo-audio | 739.5 KB |
| @tanstack/react-query | 719.0 KB |
| pino | 648.0 KB |
| @react-native-community/netinfo | 533.8 KB |
| @react-native-async-storage/async-storage | 371.9 KB |
| expo-clipboard | 273.0 KB |
| pino-pretty | 248.0 KB |
| react-native-safe-area-context | 225.3 KB |
| expo-font | 217.9 KB |
| expo-screen-orientation | 200.9 KB |
| react | 163.1 KB |
| expo-linking | 155.7 KB |
| express-rate-limit | 149.0 KB |
| expo-localization | 144.2 KB |
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
| @react-native-masked-view/masked-view | 57.6 KB |
| expo-status-bar | 24.3 KB |
| connect-pg-simple | 23.8 KB |

## Notes

- `node_modules/` installed size is not the same as what Metro ships to the device. Metro tree-shakes per-file imports, so packages that bundle many assets internally (`@expo/vector-icons`, `@expo-google-fonts/*`) only contribute the specific icon families / font weights actually imported, not their full installed size.
- `assets/images/icon.png` and `assets/images/splash-icon.png` dominate the assets total. Both are required (referenced by `app.json`'s `icon` and `expo-splash-screen` plugin config) and are already DEFLATE-compressed close to the practical floor for their pixel content — a lossless zlib level-9 re-encode of the existing pixels only recovers ~2-4%, not enough to justify adding an image-optimization step.
- `assets/images/android-icon-monochrome.png` is 432x432 while the other adaptive-icon layers (`android-icon-foreground.png`, `android-icon-background.png`) are 512x512. This is a visual-consistency mismatch, not a size problem (it is already the smallest icon file). Left as-is; flagged for design follow-up outside this report's scope.
