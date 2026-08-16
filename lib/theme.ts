// Design system entry point: re-exports the pure tokens and adds the
// platform-aware Shadow.
import { Platform } from "react-native";

export { Colors, Spacing, Radius, FontSize, Type, Motion, Scrim, Highlight, FeltGradient, FeltGradients, CardBacks, CardFaceGradient } from "./tokens";

import { Colors } from "./tokens";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// RN Web needs boxShadow; native needs the shadow props. Neither accepts the other.
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
  goldSoft: makeShadow(Colors.gold, 0, 0, 0.55, 14, 8),
  raised: makeShadow('#000000', 0, 2, 0.4, 8, 10),
  overlay: makeShadow('#000000', 0, 8, 0.5, 32, 20),
  // A card lying on the felt: contact shadow, tight and close.
  card: makeShadow('#000000', 0, 1, 0.45, 3, 3),
  // The same card held above it: the shadow travels further and softens.
  cardLifted: makeShadow('#000000', 0, 7, 0.5, 12, 14),
};
