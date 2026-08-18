# Bundle size report

Generated: 2026-08-18

Regenerate with `node scripts/bundle-report.mjs > docs/BUNDLE.md` after adding/removing assets or dependencies.

## Assets (`assets/`)

Total: **3.13 MB** across 32 files.

| File | Size |
|---|---|
| assets/images/splash-icon.png | 1.34 MB |
| assets/images/icon.png | 1.19 MB |
| assets/images/android-icon-foreground.png | 76.9 KB |
| assets/images/cards/king_of_clubs.png | 38.0 KB |
| assets/images/cards/king_of_hearts.png | 37.4 KB |
| assets/sounds/deal.mp3 | 37.0 KB |
| assets/images/cards/king_of_diamonds.png | 35.4 KB |
| assets/images/cards/queen_of_hearts.png | 34.0 KB |
| assets/images/cards/jack_of_diamonds.png | 33.5 KB |
| assets/images/cards/queen_of_clubs.png | 33.3 KB |
| assets/images/cards/jack_of_spades.png | 32.5 KB |
| assets/images/cards/jack_of_hearts.png | 32.4 KB |
| assets/images/cards/jack_of_clubs.png | 32.2 KB |
| assets/images/cards/king_of_spades.png | 31.6 KB |
| assets/images/cards/queen_of_spades.png | 28.9 KB |
| assets/images/cards/queen_of_diamonds.png | 26.3 KB |
| assets/images/android-icon-background.png | 17.1 KB |
| assets/sounds/card_pass.mp3 | 12.9 KB |
| assets/sounds/bomb.mp3 | 12.2 KB |
| assets/sounds/game_win.mp3 | 10.7 KB |
| assets/sounds/exchange.mp3 | 10.4 KB |
| assets/sounds/round_start.mp3 | 9.5 KB |
| assets/sounds/card_select.mp3 | 8.6 KB |
| assets/sounds/game_lose.mp3 | 5.8 KB |
| assets/sounds/card_play.mp3 | 4.6 KB |
| assets/sounds/round_win.mp3 | 4.6 KB |
| assets/images/android-icon-monochrome.png | 4.0 KB |
| assets/sounds/README.md | 3.3 KB |
| assets/sounds/your_turn.mp3 | 2.8 KB |
| assets/images/cards/README.md | 1.8 KB |
| assets/sounds/urgent_tick.mp3 | 1.5 KB |
| assets/images/favicon.png | 1.1 KB |

## Production dependencies (installed size in `node_modules/`)

Total: **150.74 MB** across 48 declared dependencies.

| Package | Installed size |
|---|---|
| react-native | 72.53 MB |
| expo | 15.44 MB |
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
| expo-notifications | 1.49 MB |
| socket.io-client | 1.35 MB |
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
| compression | 111.1 KB |
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

- `node_modules/` installed size is not the same as what Metro ships to the device, but Metro does not tree-shake assets. A module that is reached at all contributes every asset it requires, so the root module of `@expo/vector-icons` (one `.ttf` per icon family) or of an `@expo-google-fonts/*` package (one `.ttf` per weight and italic) ships the whole package. Both are therefore imported by subpath — `@expo/vector-icons/Ionicons`, `@expo-google-fonts/inter/400Regular` — which `tests/assetBarrels.test.ts` pins.
- `assets/images/icon.png` and `assets/images/splash-icon.png` dominate the assets total. Both are required (referenced by `app.json`'s `icon` and `expo-splash-screen` plugin config). At 1024x1024 8-bit truecolour RGB they DEFLATE to a ~2.3:1 ratio, typical for gradient-heavy photographic content; a lossless re-encode of those same pixels only recovers a few percent, because DEFLATE is not the limiting factor. A format built for that content is: canvas-encoded WebP at quality 0.9 reproduces icon.png in 105.5 KB and splash-icon.png in 136.6 KB, both under 11% of the current size. That headroom cannot be taken here — `@expo/image-utils`, which Expo's own prebuild uses to generate native icon and splash resources from these two files, decodes through `jimp-compact` unless a global `sharp-cli` is installed, and jimp throws `Unsupported MIME type: image/webp` on the file above, confirmed by feeding it the encoded output directly. `sharp` would read it, but it is a native global install, so the path that has to work is the one without it. Shrinking the pixel dimensions instead is blocked per file: `icon.png` doubles as the iOS App Store marketing icon, which Apple requires at exactly 1024x1024; `splash-icon.png` is displayed through `expo-splash-screen`'s CONTAIN mode, which scales the whole image up to the device's screen size, so 1024px is not confirmed to exceed what the widest phone screens show (some exceed 1290px) without a device pass. Real headroom exists; nothing here can take it without a pipeline change or a device verification pass this repo's tooling cannot run.
- `assets/images/android-icon-monochrome.png` is 432x432 while the other adaptive-icon layers (`android-icon-foreground.png`, `android-icon-background.png`) are 512x512. This is a visual-consistency mismatch, not a size problem (it is already the smallest icon file). Left as-is; flagged for design follow-up outside this report's scope.
