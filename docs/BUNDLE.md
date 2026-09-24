# Bundle size report

Generated: 2026-09-24

Regenerate with `node scripts/bundle-report.mjs > docs/BUNDLE.md` after adding/removing assets or dependencies.

## Assets (`assets/`)

Total: **9.24 MB** across 48 files.

| File | Size |
|---|---|
| assets/music/hand.m4a | 1.90 MB |
| assets/music/menu.m4a | 1.72 MB |
| assets/music/cue.m4a | 1.52 MB |
| assets/images/splash-icon.png | 1.19 MB |
| assets/images/icon.png | 1.03 MB |
| assets/music/cue.webm | 431.6 KB |
| assets/music/hand.webm | 376.6 KB |
| assets/music/menu.webm | 354.6 KB |
| assets/images/android-icon-foreground.png | 66.1 KB |
| assets/sounds/deal.mp3 | 59.2 KB |
| assets/sounds/clock_running_out.mp3 | 51.6 KB |
| assets/sounds/partita_won.mp3 | 48.5 KB |
| assets/sounds/bomb.mp3 | 30.1 KB |
| assets/images/cards/king_of_clubs.png | 30.0 KB |
| assets/images/cards/king_of_hearts.png | 27.4 KB |
| assets/images/cards/king_of_diamonds.png | 26.6 KB |
| assets/images/cards/queen_of_clubs.png | 26.2 KB |
| assets/sounds/manche_won.mp3 | 25.6 KB |
| assets/sounds/partita_lost.mp3 | 25.6 KB |
| assets/fonts/Ionicons.subset.ttf | 24.2 KB |
| assets/images/cards/jack_of_spades.png | 23.7 KB |
| assets/images/cards/queen_of_hearts.png | 23.0 KB |
| assets/images/cards/jack_of_hearts.png | 22.9 KB |
| assets/images/cards/jack_of_diamonds.png | 21.1 KB |
| assets/images/cards/jack_of_clubs.png | 19.4 KB |
| assets/images/cards/king_of_spades.png | 19.3 KB |
| assets/images/cards/queen_of_spades.png | 18.2 KB |
| assets/sounds/manche_lost.mp3 | 17.9 KB |
| assets/images/cards/queen_of_diamonds.png | 16.4 KB |
| assets/sounds/turn.mp3 | 14.8 KB |
| assets/sounds/exchange.mp3 | 14.3 KB |
| assets/sounds/reconnected.mp3 | 14.3 KB |
| assets/sounds/combo.mp3 | 13.8 KB |
| assets/sounds/round_start.mp3 | 9.5 KB |
| assets/music/README.md | 7.8 KB |
| assets/sounds/select.mp3 | 6.2 KB |
| assets/images/android-icon-background.png | 6.1 KB |
| assets/sounds/README.md | 5.8 KB |
| assets/sounds/pass.mp3 | 5.7 KB |
| assets/sounds/play.mp3 | 5.7 KB |
| assets/sounds/round_win.mp3 | 4.6 KB |
| assets/fonts/Feather.subset.ttf | 3.7 KB |
| assets/sounds/room_full.mp3 | 3.4 KB |
| assets/sounds/seat_fill.mp3 | 3.1 KB |
| assets/sounds/reject.mp3 | 2.4 KB |
| assets/images/android-icon-monochrome.png | 1.8 KB |
| assets/images/cards/README.md | 1.7 KB |
| assets/images/favicon.png | 659 B |

## Production dependencies (installed size in `node_modules/`)

Total: **113.42 MB** across 49 declared dependencies.

| Package | Installed size |
|---|---|
| react-native | 21.86 MB |
| @shopify/react-native-skia | 11.26 MB |
| drizzle-orm | 9.94 MB |
| @expo-google-fonts/inter | 7.67 MB |
| react-dom | 6.98 MB |
| expo | 6.62 MB |
| expo-router | 6.22 MB |
| @expo/vector-icons | 5.74 MB |
| react-native-reanimated | 4.35 MB |
| react-native-svg | 3.58 MB |
| zod | 3.43 MB |
| react-native-screens | 3.41 MB |
| react-native-gesture-handler | 3.06 MB |
| react-native-web | 2.89 MB |
| @expo-google-fonts/rajdhani | 2.05 MB |
| expo-font | 1.89 MB |
| socket.io | 1.61 MB |
| expo-notifications | 1.56 MB |
| socket.io-client | 1.35 MB |
| expo-audio | 1.27 MB |
| react-native-worklets | 1.08 MB |
| @tanstack/react-query | 727.4 KB |
| pino | 648.0 KB |
| @react-native-community/netinfo | 504.0 KB |
| @react-native-async-storage/async-storage | 371.9 KB |
| expo-clipboard | 277.5 KB |
| expo-splash-screen | 262.0 KB |
| expo-asset | 252.6 KB |
| pino-pretty | 248.0 KB |
| react-native-safe-area-context | 243.4 KB |
| expo-screen-orientation | 211.1 KB |
| source-map | 181.3 KB |
| react | 167.6 KB |
| expo-linking | 166.7 KB |
| expo-localization | 153.5 KB |
| express-rate-limit | 151.0 KB |
| express-session | 135.5 KB |
| expo-constants | 133.4 KB |
| expo-linear-gradient | 110.0 KB |
| bcryptjs | 109.7 KB |
| helmet | 103.1 KB |
| pg | 97.7 KB |
| expo-haptics | 86.0 KB |
| pino-http | 83.7 KB |
| compression | 83.2 KB |
| expo-system-ui | 82.0 KB |
| express | 73.7 KB |
| @socket.io/postgres-adapter | 61.8 KB |
| connect-pg-simple | 23.8 KB |

## Notes

- `node_modules/` installed size is not the same as what Metro ships to the device, but Metro does not tree-shake assets. A module that is reached at all contributes every asset it requires, so the root module of `@expo/vector-icons` (one `.ttf` per icon family) or of an `@expo-google-fonts/*` package (one `.ttf` per weight and italic) ships the whole package. Both are therefore imported by subpath — `@expo/vector-icons/Ionicons`, `@expo-google-fonts/inter/400Regular` — which `tests/tooling/assetBarrels.test.ts` pins.
- `assets/images/icon.png` and `assets/images/splash-icon.png` dominate the assets total. Both are required, referenced by `app.json`'s `icon` and the `expo-splash-screen` plugin config. What can and cannot be recovered from them is measured in issue #31 — this report states sizes, not conclusions about them.
- `assets/images/android-icon-monochrome.png` is 432x432 while the other adaptive-icon layers (`android-icon-foreground.png`, `android-icon-background.png`) are 512x512. This is a visual-consistency mismatch, not a size problem (it is already the smallest icon file). Left as-is; flagged for design follow-up outside this report's scope.
- The web first load is the scripts `dist/index.html` names; everything else Metro splits out is fetched on demand. `@shopify/react-native-skia` and CanvasKit's loader live only in the felt's lazy chunks (`components/table/feltSkia.web.tsx`), and the wasm comes from jsDelivr. `npm run bundle:budget` holds the first load and the deferred JS to budgets of their own and fails if CanvasKit reaches the first load.
