// Design tokens. No runtime react-native import, so this is loadable outside a
// bundler (tests import it directly). `theme.ts` re-exports everything here and
// adds the platform-aware Shadow.
import type { TextStyle } from "react-native";

// Named once because two unrelated roles want the same ink: the second-place
// podium and the silver card back.
const SILVER = '#C0C0C0';

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
  dangerScrim:  'rgba(229,57,53,0.92)', // error toast over the felt

  // Card specific
  cardBg:       '#FAFAF8',
  cardBorder:   'rgba(255,255,255,0.08)',
  cardBack:     '#1A1A2E',
  // Printed-stock face: warm white in the light, cooling toward the edge.
  cardPaper:    '#FFFDF7',
  cardPaperMid: '#F7F4EA',
  cardPaperEdge:'#E6E1D2',
  // Engraved line work on the face — neutral, so it never fights the suit colour.
  cardInk:      '#26323C',
  cardEdge:     'rgba(90,78,52,0.45)',

  // Traditional red/black. Suit identity is carried by the pip glyph, so colour
  // is not the only channel.
  spade:        '#1A1A1A',
  heart:        '#C8102E',
  diamond:      '#C8102E',
  club:         '#1A1A1A',

  // Borders & overlays
  border:       'rgba(240,234,214,0.1)',
  borderStrong: 'rgba(240,234,214,0.2)',
  overlay:      'rgba(6,20,16,0.85)',
  overlayStrong:'rgba(3,16,8,0.90)',
  overlayOpaque:'rgba(3,16,8,0.97)',

  // Bomb and royal-straight emphasis. Deliberately outside the danger family:
  // these mark a dramatic play, not an error.
  bombText:     '#FF8080',
  bombBorder:   'rgba(255,80,80,0.55)',
  bombFill:     'rgba(255,80,80,0.22)',

  podiumGold:   '#C9A84C',
  podiumSilver: SILVER,
  podiumBronze: '#CD7F32',
};

// Black washes for depth and modal backdrops.
export const Scrim = {
  subtle: 'rgba(0,0,0,0.1)',
  soft:   'rgba(0,0,0,0.22)',
  medium: 'rgba(0,0,0,0.35)',
  heavy:  'rgba(0,0,0,0.6)',
} as const;

// White lifts on dark surfaces: inner edges, glass highlights.
export const Highlight = {
  faint: 'rgba(255,255,255,0.03)',
  soft:  'rgba(255,255,255,0.06)',
  clear: 'rgba(255,255,255,0.12)',
} as const;

// Card face, lit from the top-left corner. Order is the gradient order.
export const CardFaceGradient = [
  Colors.cardPaper,
  Colors.cardPaperMid,
  Colors.cardPaperEdge,
] as const;

// Table felts, light centre to dark rim. Order is the gradient order.
//
// Every alternate is at or below the green's luminance at every stop, so the
// contrast ratios tests/contrast.test.ts pins against `Colors.felt` are a
// floor for all four — pinned by tests/cosmetics.test.ts.
export const FeltGradients = {
  verde:    ['#0F5A35', '#0D4A2E', '#0B3B25', '#082B1A', '#061E12'],
  blu:      ['#144C7A', '#113F66', '#0E3253', '#0A2540', '#071A2E'],
  bordeaux: ['#6B2230', '#5A1C29', '#491722', '#38111A', '#280C12'],
  notte:    ['#2E3338', '#272B2F', '#1F2226', '#171A1D', '#101214'],
} as const;

/** The default felt. Anything not themed by the player's choice uses this. */
export const FeltGradient = FeltGradients.verde;

// Card backs. Only three things survive at card size — the ink, the field
// colour and how dense the lattice is — so a back is those plus a star count,
// not a bespoke drawing. The field reuses a felt palette rather than
// introducing a fifth set of greens, blues and reds.
export const CardBacks = {
  oro:        { field: 'verde',    ink: Colors.gold, lattice: 7, starPoints: 8 },
  rubino:     { field: 'bordeaux', ink: Colors.gold, lattice: 7, starPoints: 8 },
  zaffiro:    { field: 'blu',      ink: SILVER,      lattice: 9, starPoints: 6 },
  inchiostro: { field: 'notte',    ink: Colors.gold, lattice: 5, starPoints: 4 },
} as const;

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
    // A frame-scale flash: long enough to register, too short to read as a state.
    flash: 90,
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
    // Direct manipulation: the object must arrive under the finger with no
    // visible wobble, so this is stiffer and far more damped than `settle`.
    pickup:   { damping: 16, stiffness: 340 },
    // Something dropped onto a surface: fast approach, one small bounce.
    land:     { damping: 14, stiffness: 260 },
  },
  // Gap between consecutive items in a run that should read as one gesture
  // (a hand being dealt) rather than as simultaneous appearance.
  stagger: {
    deal: 42,
  },
  // Gap between moves when a replay plays itself: slow enough to read one
  // combination, fast enough that a whole hand is not a sitting.
  replayStep: 1200,
} as const;
