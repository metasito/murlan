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
  // The lit end of the gold: what the lamp leaves on a gold surface that is
  // currently the table's own subject — the seat on move, the turn chip, GIOCA.
  goldLit:      '#F3E0A6',
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
  // The chips over the felt. Dark enough to hold their own text against the
  // cloth directly under the lamp, sheer enough to read as glass on it.
  chipFill:     'rgba(3,14,9,0.72)',
  chipFillSolid:'rgba(2,12,8,0.85)',
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

// The lamp over the table, and what it falls on. A light, not a cloth: the
// felt's own five stops still carry which felt the player chose, and these are
// what lands on them. Every entry is translucent for that reason — a lit
// surface is the surface plus the light, never a colour of its own.
export const Lantern = {
  // The pool itself: a warm core, then nothing.
  core:     'rgba(255,242,208,0.26)',
  coreMid:  'rgba(255,226,172,0.09)',
  bloom:    'rgba(255,236,190,0.12)',
  clear:    'rgba(255,242,208,0)',
  // The cloth's own weave, one bright thread and one dark, crossing at 45.
  weaveLight: 'rgba(255,255,255,0.02)',
  weaveDark:  'rgba(0,0,0,0.055)',
  // Real darkness past the falloff, and the vignette over all of it.
  vignette:      'rgba(0,0,0,0.5)',
  vignetteClear: 'rgba(0,0,0,0)',
  // A card standing in a hand has its head nearer a hanging lamp than its
  // foot. The `-on` pair is the same card in the seat that is on move.
  headLit:     'rgba(255,240,205,0.26)',
  headLitOn:   'rgba(255,244,214,0.40)',
  headFade:    'rgba(255,240,205,0.08)',
  headFadeOn:  'rgba(255,240,205,0.13)',
  midShade:    'rgba(0,0,0,0.12)',
  midShadeOn:  'rgba(0,0,0,0.08)',
  footShade:   'rgba(0,0,0,0.34)',
  footShadeOn: 'rgba(0,0,0,0.26)',
  // A card lying flat on the felt catches far less of the same lamp.
  flatHead:  'rgba(255,246,222,0.22)',
  flatFade:  'rgba(255,246,222,0.04)',
  flatMid:   'rgba(24,20,12,0.05)',
  flatFoot:  'rgba(24,20,12,0.13)',
} as const;

// PASSA is garnet, not alarm red: GIOCA's construction — a lit top lip, a face
// darkening downward, a seated shadow — at lower luminance with the hue pulled
// across, and no glow. The only lit object on the table is GIOCA, and only on
// the player's own turn, which is the whole reason red can sit beside it
// without shouting.
export const Garnet = {
  lip:   '#A03B41',
  face:  '#7C2029',
  deep:  '#5A141C',
  base:  '#370A11',
  label: '#F4D5D0',
} as const;

// Table felts, from the cloth directly under the lamp out to the cloth at the
// edge of its reach. Order is the falloff order, and it is a falloff rather
// than a wash: `FeltPool` (components/table/felt.tsx) lays these along a radial
// that ends in the room's own darkness, so the first stop is the cloth lit and
// the last is the cloth barely lit — not two shades of the same flat green.
//
// Every alternate is at or below the green's luminance at every stop, so the
// contrast ratios tests/contrast.test.ts pins against `Colors.felt` are a
// floor for all four — pinned by tests/cosmetics.test.ts.
export const FeltGradients = {
  verde:    ['#2E9F62', '#23854F', '#186B41', '#0F4E31', '#093320'],
  blu:      ['#2288C4', '#1C6FA2', '#155780', '#0F3F5E', '#092A3E'],
  bordeaux: ['#B03D4C', '#94323F', '#782833', '#5A1E27', '#3D141B'],
  notte:    ['#5D6874', '#4E5862', '#3F4750', '#31373E', '#23272C'],
} as const;

/** The default felt. Anything not themed by the player's choice uses this. */
export const FeltGradient = FeltGradients.verde;

// Card backs. Only three things survive at card size — the ink, the field
// colour and how dense the lattice is — so a back is those plus a star count,
// not a bespoke drawing. The field is card stock, not cloth: its own five-stop
// gradient, dark enough to hold the ink lattice against any felt, so repainting
// FeltGradients can never repaint a back.
export const CardBacks = {
  oro:        { field: ['#3A2C13', '#2E2210', '#241A0B', '#180F06', '#0D0803'], ink: Colors.gold, lattice: 7, starPoints: 8 },
  rubino:     { field: ['#4A1622', '#3A111A', '#2C0C13', '#1E080D', '#120507'], ink: Colors.gold, lattice: 7, starPoints: 8 },
  zaffiro:    { field: ['#12294A', '#0E2038', '#0A182A', '#07101D', '#040A10'], ink: SILVER,      lattice: 9, starPoints: 6 },
  inchiostro: { field: ['#2A2A2E', '#212124', '#191919', '#111112', '#0A0A0B'], ink: Colors.gold, lattice: 5, starPoints: 4 },
} as const;

// Ordered by value, and only the order says so: nothing in slim, snug, cosy,
// wide or roomy tells a reader which of them is the wider step.
export const Spacing = {
  xxs: 2,
  xs: 4,
  slim: 6,
  sm: 8,
  snug: 10,
  cosy: 12,
  wide: 14,
  md: 16,
  roomy: 20,
  lg: 24,
  xl: 32,
  xxl: 40,
  xxxl: 48,
};

// iOS HIG's 44pt floor for a touch target. react-native-web reads `hitSlop`
// on nothing but the legacy Touchable, so on the shipped platform a control's
// own box is the whole target.
export const TOUCH_TARGET_MIN = 44;

// The game table is built from fixed boxes — CARD_W/CARD_H, TOP_BAR_H, the
// avatar discs — and React Native scales `fontSize` by the OS text setting
// (up to ~3.1x on iOS) while leaving `width`, `height` and `lineHeight` alone.
// Capping degrades; `allowFontScaling={false}` would refuse. The menus scroll
// and stay fully scalable.
export const TABLE_FONT_SCALE_MAX = 1.2;

export const Radius = {
  sm: 8, md: 12, lg: 20, xl: 32, full: 9999,
};

export const FontSize = {
  xxs: 9, xs: 11, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28, hero: 36,
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
    // visible wobble, which means critical damping — damping = 2·sqrt(stiffness)
    // at unit mass. Anything below that overshoots and rings under the finger.
    pickup:   { damping: 37, stiffness: 340 },
    // Something dropped onto a surface: fast approach, one small bounce. A
    // damping ratio near 0.65 overshoots about 7% once; the second bounce is
    // half a percent, which is to say invisible.
    land:     { damping: 21, stiffness: 260 },
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
