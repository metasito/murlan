import { Platform } from "react-native";

export const Colors = {
  bg:           '#031008',
  felt:         '#0B3B25',
  feltLight:    '#0F4A2E',
  gold:         '#C9A84C',
  goldDim:      '#A07830',
  white:        '#FFFFFF',
  textPrimary:  '#FFFFFF',
  textSecondary:'#AAAAAA',
  textMuted:    '#666666',
  danger:       '#E53935',
  dangerDim:    '#B71C1C',
  success:      '#4CAF50',
  border:       'rgba(201,168,76,0.25)',
  overlay:      'rgba(0,0,0,0.72)',
  cardBack:     '#1A1A2E',
};

export const Spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

export const Radius = {
  sm: 8, md: 12, lg: 20, xl: 32, full: 9999,
};

export const FontSize = {
  xs: 11, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28, hero: 36,
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

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
  gold: makeShadow('#C9A84C', 0, 0, 0.6, 12, 10),
  dark: makeShadow('#000000', 0, 4, 0.5, 8, 8),
};
