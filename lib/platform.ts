import { Platform, type ViewStyle } from "react-native";

/**
 * Web only: `hidden` still leaves a scrollable box, which the browser scrolls a focused card into
 * view in, sliding what it clips off the screen; `clip` clips without one. Native has no such box
 * and does not know the value, nor do React Native's types.
 */
export const clipOverflow: ViewStyle | null =
  Platform.OS === "web" ? ({ overflow: "clip" } as unknown as ViewStyle) : null;

/**
 * iOS hosts a view's `filter` in SwiftUI: `grayscale()` draws only through the filters
 * `plugins/withSwiftUIFilters.js` turns on, and `brightness()` as a blend that cannot see a Skia
 * canvas, so there the greying is drawn by other means.
 */
export const viewFilterGrey = Platform.OS !== "ios";

export const hapticsAvailable = Platform.OS !== "web";
