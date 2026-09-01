// Design tokens. No runtime react-native import, so this is loadable outside a
// bundler (tests import it directly). `theme.ts` re-exports everything here and
// adds the platform-aware Shadow.
import type { TextStyle, ViewStyle } from "react-native";

// Named once because two unrelated roles want the same ink: the second-place
// podium and the silver card back.
const SILVER = '#C0C0C0';

export const Colors = {
  // Background layers
  bg:           '#031008',
  // `bg` at zero alpha, for the clear end of a fade over it. Spelt out rather
  // than 'transparent': a gradient blends its stops non-premultiplied, so a
  // stop of another hue reads as grey at half strength (see `clear`, below).
  bgClear:      'rgba(3,16,8,0)',
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
  // Alarm: error state and destructive action. Pick by role, not by eye.
  danger:       '#E53935',              // fills, borders, icons, text at the large-text bar
  dangerDim:    '#C9655E',              // the same alarm below that bar
  dangerScrim:  'rgba(229,57,53,0.92)', // error toast over the felt
  redMuted:     'rgba(239,68,68,0.15)', // the error box's wash, bordered by dangerDim

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
  // is not the only channel. Role: card suit ink, on the card face or anywhere
  // else a suit glyph is drawn.
  spade:        '#1A1A1A',
  heart:        '#C8102E',
  diamond:      '#C8102E',
  club:         '#1A1A1A',

  // Borders & overlays
  // What a shadow is cast in. `Shadow.*` (lib/theme.ts) is the same colour
  // pre-applied; this is for the shadows whose radius scales with the card.
  shadow:       '#000000',
  border:       'rgba(240,234,214,0.1)',
  borderStrong: 'rgba(240,234,214,0.2)',
  // The chips over the felt. The prototype gets away with rgba(3,14,9,.55)
  // because it also carries `backdrop-filter: blur(6px)`, which React Native
  // has no equivalent for on any platform — without the blur behind it the
  // sheerer fill drops the chip's own label under 4.5:1 on the felt's lit
  // stop (tests/contrast.test.ts). The extra opacity buys back what the blur
  // was doing.
  chipFill:     'rgba(3,14,9,0.72)',
  // A seat is a chip on the cloth, and its own dark disc rather than a patch of
  // the felt behind it — a seat that took the felt's colour disappeared into it
  // wherever the lamp happened to be standing. Lit corner first.
  seatDisc:     '#12402A',
  seatDiscDeep: '#061C12',
  // The count badge on the disc's foot: darker than any felt, so the digit
  // reads the same wherever the lamp is.
  seatBadge:    '#03110A',
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

/**
 * One hairline of light along a surface's top edge: the cue that it has a
 * thickness and is facing up. The inset and the tint are the only things a
 * caller varies — a card is inset by a proportion of its own width, a panel by
 * a fixed gutter.
 */
export const TopEdgeLight: ViewStyle = {
  position: "absolute",
  top: 0,
  left: "12%",
  right: "12%",
  height: 1,
  backgroundColor: Highlight.clear,
};

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
  // The weave, crossing at 45: shadow between the threads, deeper one way than
  // the other. Both must stay black — a shadow scales the light that reached
  // it, so the crosshatch tracks the lamp with nothing moving, and a thread
  // that adds light instead reads loudest on the darkest felt
  // (tests/feltWeave.test.ts).
  weaveShade:      'rgba(0,0,0,0.085)',
  weaveShadeCross: 'rgba(0,0,0,0.035)',
  // The pile standing off that weave, where the light rakes across the fibres.
  // Shares `clear`'s hue: SVG blends stops non-premultiplied, so two hues
  // either side of a transparent stop read as grey at half strength.
  napSheen: 'rgba(255,242,208,0.055)',
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

/**
 * The gradients, together, so a drifted copy is visible as one. `menuButton`
 * and `playButton` open on different rungs of the gold scale deliberately: the
 * table's is the brighter of the two because it sits on felt, not on a menu.
 */
export const Gradient = {
  menuButton: [Colors.goldLight, Colors.gold, Colors.goldDark],
  playButton: [Colors.goldLit, Colors.gold, Colors.goldDark],
  menuCard: [Colors.feltLight, Colors.felt, Colors.feltDark],
  garnet: [Garnet.lip, Garnet.face, Garnet.deep, Garnet.base],
} as const;


// Table felts, from the cloth directly under the lamp out to the cloth at the
// edge of its reach. Order is the falloff order, and it is a falloff rather
// than a wash: `FeltPool` (components/table/felt.tsx) lays these along a radial
// that ends in the room's own darkness, so the first stop is the cloth lit and
// the last is the cloth barely lit.
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
  // The prototype's own back, and the default: a green field, so an opponent's
  // fan still reads as cards on the far side of the table. Every other back is
  // dark enough to vanish into the felt once the lamp is standing elsewhere.
  smeraldo:   { field: ['#1E6544', '#19583B', '#144B32', '#0F3E29', '#0A3120'], ink: Colors.gold, lattice: 7, starPoints: 8 },
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

/**
 * How dim a control goes while it is held, and while it is refusing.
 *
 * Two values, not a range: a press is feedback and a disabled control is a
 * statement, and a scale with a step between them invites a third.
 */
export const Opacity = {
  pressed: 0.8,
  disabled: 0.4,
};

/**
 * Which band a view paints in.
 *
 * Named because sibling order is not a statement: web and Android paint in
 * tree order and iOS does not, so anything sharing a stacking context says
 * where it sits or finds out on a device (#209). Every band is a role, so two
 * views at the same number are deliberately peers.
 */
export const Layer = {
  felt: 0,
  table: 1,
  moment: 10,
  rail: 20,
  hint: 30,
  band: 50,
  sheet: 60,
  held: 100,
  overlay: 300,
  banner: 9999,
  /** Above an ordinary banner: the connection itself is the news. */
  alert: 10000,
  /** Nothing may cover this: the app has stopped and is saying so. */
  blocking: 10001,
};

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


/**
 * The game's sense of weight, and the scale that expresses it.
 *
 * **A card has weight, but never keeps you waiting for it.** Decided by the
 * owner against three moving alternatives (#126): a small load before it
 * leaves, 260ms of travel, and a settle on arrival with no visible bounce.
 * Weighted (380ms, spring overshoot) bought a bomb its sense of occasion by
 * taxing all thirteen singles in a hand; Crisp made the table read as a
 * utility rather than the cinematic one #98 chose.
 *
 * Every step is named for the role it plays, never for its number — a step
 * that exists because some component wanted 240ms is not a scale, which is
 * the trap #52 identified. Each carries its reduced form here, so a sweep
 * cannot invent one per call site.
 */
export const Motion = {
  duration: {
    /** A state registering, too short to read as movement — a chip toggling, a glyph swapping. */
    flash: 90,
    /** The answer to a finger: a press state, a selection lifting. */
    tap: 120,
    /** Something moving a short way inside its own container. */
    shift: 200,
    /** Something crossing the table — the card in flight. The whole feel hangs on this one. */
    travel: 260,
    /** Something arriving that was not there: a banner, an overlay, a hand dealt in. */
    reveal: 600,
    /** An ambient loop, and how long a moment holds before it releases. */
    dwell: 1200,
  },
  /**
   * The load before a deliberate launch — a small move against the direction of
   * travel. This is what makes `travel` read as weight rather than as a
   * duration. Crisp had none; that is most of what made it Crisp.
   */
  anticipate: 40,
  /**
   * What each step becomes when the player asked for less motion.
   *
   * Not "off": travel is what goes, and the state change stays legible. A card
   * that flew cross-fades in place instead. `null` means the step is already
   * short enough to leave alone.
   *
   * `impactDelayMs()` stays the single source of the card-landing delay and
   * already returns 0 here, so the feedback fires immediately rather than
   * waiting out a flight that never happens.
   */
  reduced: {
    flash: null,
    tap: null,
    /** Cross-fade in place, no travel. */
    shift: 0,
    /** Cross-fade in place, no travel. */
    travel: 0,
    /** Fade only. */
    reveal: 200,
    /** Hold at rest; do not loop. */
    dwell: null,
  },
  /**
   * A spring when the player caused it and is still touching it — picked up,
   * dragged, released; its arrival has to answer the finger, and a duration
   * cannot. A duration for everything the table does on its own, which must be
   * predictable and must line up with its neighbours; springs drift apart
   * under load.
   */
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

/**
 * How long `step` runs for this player.
 *
 * A `null` reduced form is a step with nothing to shorten — a flash is over
 * before it registers as movement, and a loop gives up its repeat rather than
 * its duration — so the step's own length stands. Everything else takes the
 * answer `Motion.reduced` already wrote down, which is the point: a call site
 * that decides for itself is how "reduced" came to mean a 200ms fade in one
 * screen and an instant jump in the next.
 */
export function motionMs(step: keyof typeof Motion.duration, reduceMotion: boolean): number {
  if (!reduceMotion) return Motion.duration[step];
  return Motion.reduced[step] ?? Motion.duration[step];
}

/**
 * How long something stays on screen to be read. Not motion, and deliberately
 * not a `Motion` step: this is set by how many words there are and what the
 * player has to do about them, so folding a reading budget in beside a 90ms
 * flash would put two unrelated decisions on one scale.
 */
export const Reading = {
  /** A banner that is only news — it is read, and then it is gone. */
  notice: 4000,
  /** An invitation, which is acted on rather than read, so it outlasts its own sentence. */
  invite: 6000,
} as const;

/**
 * Stillness: a beat where nothing moves at all, inserted into a chain that is
 * already running. `Reading` is the precedent — a duration the app spends not
 * animating — and the reason these are not `Motion` steps: `motionMs()` and
 * `Motion.reduced` shorten travel, and there is no travel here to shorten.
 *
 * Counted in frames rather than taken off the `Motion` scale, because that is
 * the unit the effect is described and felt in.
 */
export const Hold = {
  /** The table at a card's contact — Nijman's *sleep* (*Art of Screenshake*, INDIGO 2013). Three frames at 60fps. */
  land: 50,
} as const;
