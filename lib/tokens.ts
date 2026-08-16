// Design tokens. No runtime react-native import, so this is loadable outside a
// bundler (tests import it directly). `theme.ts` re-exports everything here and
// adds the platform-aware Shadow.
import type { TextStyle } from "react-native";

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
  // Gold alpha scale. Pick by role, not by eye.
  goldGhost:  'rgba(201,168,76,0.06)', // wash behind large areas
  goldMuted:  'rgba(201,168,76,0.15)', // chips, inactive pills
  goldSoft:   'rgba(201,168,76,0.2)',  // dividers, resting borders
  goldBorder: 'rgba(201,168,76,0.3)',  // card and row edges
  goldStrong: 'rgba(201,168,76,0.5)',  // active/selected, focus rings

  // Text colors
  // WCAG ratios are enforced by tests/contrast.test.ts against bg, bgCard and felt.
  white:        '#FFFFFF',
  text:         '#F0EAD6',
  textPrimary:  '#FFFFFF',
  textSecondary:'rgba(240,234,214,0.75)',
  textMuted:    'rgba(240,234,214,0.58)',

  // Accents & status
  accent:       '#22C55E',
  accentMuted:  'rgba(34,197,94,0.15)',
  success:      '#4CAF50',
  info:         '#6b8ef5',
  red:          '#EF4444',
  redMuted:     'rgba(239,68,68,0.15)',
  danger:       '#E53935',
  dangerDim:    '#C9655E',

  // Card specific
  cardBg:       '#FAFAF8',
  cardBorder:   'rgba(255,255,255,0.08)',
  cardBack:     '#1A1A2E',

  // Four hues rather than the traditional red/black pair, so suits stay separable
  // for colourblind players. The pip shape is the redundant channel.
  spade:        '#1A3A7F',
  heart:        '#E63946',
  diamond:      '#F1A208',
  club:         '#2D6A4F',

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

// Weight comes from fontFamily, never fontWeight: the app bundles static font files,
// so iOS would otherwise synthesise the weight. Loaded faces are in app/_layout.tsx.
export const Type = {
  display:    { fontFamily: 'Rajdhani_700Bold',     fontSize: FontSize.hero, color: Colors.text },
  title:      { fontFamily: 'Rajdhani_700Bold',     fontSize: FontSize.xxl,  color: Colors.text },
  heading:    { fontFamily: 'Rajdhani_700Bold',     fontSize: FontSize.xl,   color: Colors.text },
  subheading: { fontFamily: 'Rajdhani_600SemiBold', fontSize: FontSize.md,   color: Colors.textSecondary },
  body:       { fontFamily: 'Inter_400Regular',     fontSize: FontSize.sm,   color: Colors.textSecondary },
  bodyStrong: { fontFamily: 'Inter_500Medium',      fontSize: FontSize.sm,   color: Colors.text },
  label:      { fontFamily: 'Rajdhani_600SemiBold', fontSize: FontSize.sm,   color: Colors.textSecondary },
  caption:    { fontFamily: 'Inter_400Regular',     fontSize: FontSize.xs,   color: Colors.textMuted },
} as const satisfies Record<string, TextStyle>;


export const Motion = {
  duration: {
    fast: 120,
    base: 200,
    moderate: 300,
    slow: 600,
    pulse: 1200,
  },
  spring: {
    settle:   { damping: 10, stiffness: 200 },
    gentle:   { damping: 10, stiffness: 180 },
    entrance: { damping: 12, stiffness: 200 },
    reveal:   { damping: 8,  stiffness: 150 },
  },
} as const;
