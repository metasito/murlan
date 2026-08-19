import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Rajdhani_500Medium } from "@expo-google-fonts/rajdhani/500Medium";
import { Rajdhani_600SemiBold } from "@expo-google-fonts/rajdhani/600SemiBold";
import { Rajdhani_700Bold } from "@expo-google-fonts/rajdhani/700Bold";

/**
 * The faces `useFonts` loads, on the platforms that load fonts through it.
 *
 * One subpath per weight: each `@expo-google-fonts` root module requires every
 * weight and italic it ships, and Metro cannot drop an asset a reachable module
 * requires. Pinned by tests/assetBarrels.test.ts.
 *
 * Web resolves lib/fonts.web.ts instead, which imports none of these — the
 * TTFs are 2.1 MB and the browser gets WOFF2 subsets through @font-face.
 */
export const APP_FONTS = {
  Rajdhani_500Medium,
  Rajdhani_600SemiBold,
  Rajdhani_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
};
