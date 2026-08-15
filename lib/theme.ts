// Design system entry point. Pure tokens live in ./tokens (importable without a
// React Native bundler, so they can be unit-tested); this file adds the
// platform-aware pieces and re-exports everything, so every existing
// `import { Colors, Spacing, ... } from "@/lib/theme"` keeps working.
import { Platform } from "react-native";

export { Colors, Spacing, Radius, FontSize, Type, Motion } from "./tokens";

import { Colors } from "./tokens";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// Platform-aware: React Native Web does not support the native shadow props, and
// the native platforms do not support boxShadow. This is load-bearing — see CLAUDE.md.
function makeShadow(
  color: string,
  offsetX: number,
  offsetY: number,
  opacity: number,
  radius: number,
  elevation: number
): Record<string, any> {
  if (Platform.OS === "web") {
    const { r, g, b } = hexToRgb(color);
    return { boxShadow: `${offsetX}px ${offsetY}px ${radius}px rgba(${r},${g},${b},${opacity})` };
  }
  return {
    shadowColor: color,
    shadowOffset: { width: offsetX, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation,
  };
}

export const Shadow = {
  gold: makeShadow(Colors.gold, 0, 0, 0.6, 12, 10),
  dark: makeShadow('#000000', 0, 4, 0.5, 8, 8),
  // Tighter gold glow used for selected-card borders (components/CardView.tsx)
  goldSoft: makeShadow(Colors.gold, 0, 0, 0.55, 14, 8),
  // Small floating-element shadow (components/OfflineBanner.tsx)
  raised: makeShadow('#000000', 0, 2, 0.4, 8, 10),
  // Large modal/sheet shadow (components/SettingsModal.tsx)
  overlay: makeShadow('#000000', 0, 8, 0.5, 32, 20),
};
