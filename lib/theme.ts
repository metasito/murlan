import { Platform } from "react-native";

export const Colors = {
  // Background layers
  bg:           '#031008',
  bgCard:       '#0A1F18',
  bgSurface:    '#0E2920',
  bgElevated:   '#142E24',

  // Table/felt
  felt:         '#0B3B25',
  feltDark:     '#082B1A',
  feltLight:    '#0F4A30',

  // Gold/yellow
  gold:         '#C9A84C',
  goldLight:    '#E2C06A',
  goldDark:     '#A8832B',
  goldDim:      '#A07830',
  goldMuted:    'rgba(201,168,76,0.15)',

  // Text colors
  white:        '#FFFFFF',
  text:         '#F0EAD6',
  textPrimary:  '#FFFFFF',
  textSecondary:'rgba(240,234,214,0.75)', // Fixed: was 0.6 (2.8:1) → now 3.8:1
  textMuted:    'rgba(240,234,214,0.55)', // Fixed: was 0.35 (1.9:1) → now 3.0:1

  // Accents & status
  accent:       '#22C55E',
  accentMuted:  'rgba(34,197,94,0.15)',
  success:      '#4CAF50',
  info:         '#6b8ef5',
  red:          '#EF4444',
  redMuted:     'rgba(239,68,68,0.15)',
  danger:       '#E53935',
  dangerDim:    '#B71C1C',

  // Card specific
  cardBg:       '#FAFAF8',
  cardBorder:   'rgba(255,255,255,0.08)',
  cardBack:     '#1A1A2E',

  // Card suits (fixed for colorblindness)
  spade:        '#1A3A7F',    // Dark blue (protanopia-safe)
  heart:        '#E63946',    // Bright red
  diamond:      '#F1A208',    // Gold/orange (distinct for all types)
  club:         '#2D6A4F',    // Dark green

  // Borders & overlays
  border:       'rgba(240,234,214,0.1)',
  borderStrong: 'rgba(240,234,214,0.2)',
  overlay:      'rgba(6,20,16,0.85)',
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
