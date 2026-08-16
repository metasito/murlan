// Pure design tokens — no runtime dependency on react-native.
//
// Split out of theme.ts so the palette can be imported by tests and by any
// non-RN context. `theme.ts` re-exports all of this, so existing
// `import { Colors } from "@/lib/theme"` call sites keep working unchanged;
// only Shadow (which needs Platform) lives there now.
//
// The TextStyle import is type-only and therefore erased at runtime — that is
// what keeps this file loadable outside a React Native bundler.
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
  // ── Gold alpha scale ───────────────────────────────────────────────────────
  // The app had accumulated SIXTEEN distinct gold alphas (0.05 … 0.55), each
  // one someone eyeballing a value in the moment. That is not a palette, it is
  // drift, and it is why a "make the gold subtler" request had sixteen places
  // to touch. These five steps replace all of them.
  //
  // Collapsing does shift some values by up to 0.05 alpha. That is deliberate
  // and imperceptible — the alternative is preserving typos forever.
  //
  // Pick by ROLE, not by eye. If none fits, the design is asking for something
  // new — say so rather than inventing a sixteenth value.
  goldGhost:  'rgba(201,168,76,0.06)', // barely-there wash behind large areas
  goldMuted:  'rgba(201,168,76,0.15)', // subtle fill: chips, inactive pills
  goldSoft:   'rgba(201,168,76,0.2)',  // hairline dividers, resting borders
  goldBorder: 'rgba(201,168,76,0.3)',  // visible gold edge on cards and rows
  goldStrong: 'rgba(201,168,76,0.5)',  // active/selected emphasis, focus rings

  // Text colors
  // Ratios below are the worst case across the three surfaces text actually
  // renders on: bg #031008, bgCard #0A1F18, felt #0B3B25 (see tests/contrast.test.ts).
  white:        '#FFFFFF',
  text:         '#F0EAD6',
  textPrimary:  '#FFFFFF',
  textSecondary:'rgba(240,234,214,0.75)', // 6.58:1 min (felt) — passes 4.5:1 body on all 3 surfaces
  textMuted:    'rgba(240,234,214,0.58)', // was 0.55 (4.26:1 on felt, failed body text) → now 4.60:1 min

  // Accents & status
  accent:       '#22C55E',
  accentMuted:  'rgba(34,197,94,0.15)',
  success:      '#4CAF50',
  info:         '#6b8ef5',
  red:          '#EF4444',
  redMuted:     'rgba(239,68,68,0.15)',
  danger:       '#E53935',
  dangerDim:    '#C9655E', // was #B71C1C (~2.2:1 — the move-rejection text failure) → now 4.51:1 on bg/bgCard

  // Card specific
  cardBg:       '#FAFAF8',
  cardBorder:   'rgba(255,255,255,0.08)',
  cardBack:     '#1A1A2E',

  // Card suits — four distinct hues, not the traditional red/black pair, so the
  // suits stay separable for colourblind players. Shape (the pip) is the
  // redundant channel; colour alone is never the only cue.
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

// Named text styles so screens stop hand-assembling fontFamily + fontSize + color.
// Weights are set via fontFamily (never fontWeight) because the app bundles static
// font files — see app/_layout.tsx for the loaded Rajdhani/Inter weights.
// Sizes and pairings are drawn from the combinations already in use across app/
// and components/, not invented from scratch.
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

// Motion tokens: durations and spring presets, derived from the values already
// repeated across screens rather than an invented scale.
export const Motion = {
  duration: {
    fast: 120,     // micro press feedback (button scale down/up)
    base: 200,     // standard state transitions
    moderate: 300, // fades / entrance transitions (most common single value)
    slow: 600,     // larger reveals
    pulse: 1200,   // one half-cycle of a looping glow/breathing animation
  },
  spring: {
    settle:   { damping: 10, stiffness: 200 }, // snap back to rest (most common config)
    gentle:   { damping: 10, stiffness: 180 }, // softer settle
    entrance: { damping: 12, stiffness: 200 }, // staggered item entrance (with withDelay)
    reveal:   { damping: 8,  stiffness: 150 }, // emphasized scale-in reveal
  },
} as const;
