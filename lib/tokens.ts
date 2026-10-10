// Design tokens. No runtime react-native import, so this is loadable outside a
// bundler (tests import it directly). `theme.ts` re-exports everything here and
// adds the platform-aware Shadow.
import type { TextStyle, ViewStyle } from "react-native";

export const Colors = {
  bg:           '#031008',
  // `bg` at zero alpha, for the clear end of a fade over it. Spelt out rather
  // than 'transparent': a gradient blends its stops non-premultiplied, so a
  // stop of another hue reads as grey at half strength (see `clear`, below).
  bgClear:      'rgba(3,16,8,0)',
  goldClear:    'rgba(201,168,76,0)',
  bgCard:       '#0A1F18',
  bgSurface:    '#0E2920',
  bgElevated:   '#142E24',

  felt:         '#0B3B25',
  feltDark:     '#082B1A',
  feltLight:    '#0F4A30',

  gold:         '#C9A84C',
  goldLight:    '#E2C06A',
  // The lit end of the gold: what the lamp leaves on a gold surface that is
  // currently the table's own subject — the seat on move, the turn chip, GIOCA.
  goldLit:      '#F3E0A6',
  goldLitEdge:  'rgba(243,224,166,0.8)', // the lit turn pill's border
  goldLitDisc:  'rgba(243,224,166,0.7)', // a lit disc's border: the seat on move, a notice's disc
  goldDark:     '#A8832B',
  goldDim:      '#A07830',
  // Gold alpha scale. Pick by role, not by eye.
  goldGhost:  'rgba(201,168,76,0.06)', // wash behind large areas
  goldMuted:  'rgba(201,168,76,0.15)', // chips, inactive pills
  goldSoft:   'rgba(201,168,76,0.2)',  // dividers, resting borders
  goldBorder: 'rgba(201,168,76,0.3)',  // card and row edges
  goldStrong: 'rgba(201,168,76,0.5)',  // active/selected, focus rings

  // WCAG ratios are enforced by tests/ui-rules/contrast.test.ts against bg, bgCard and felt.
  white:        '#FFFFFF',
  text:         '#F0EAD6',
  textPrimary:  '#FFFFFF',
  textSecondary:'rgba(240,234,214,0.75)',
  textMuted:    'rgba(240,234,214,0.58)',

  accent:       '#22C55E',
  accentMuted:  'rgba(34,197,94,0.15)',
  success:      '#4CAF50',
  info:         '#6b8ef5',
  // Alarm: error state and destructive action. Pick by role, not by eye.
  danger:       '#E53935',              // fills, borders, icons, text at the large-text bar
  dangerDim:    '#E8857E',              // the same alarm below that bar
  dangerScrim:  'rgba(229,57,53,0.92)', // the lobby's error banner
  redMuted:     'rgba(239,68,68,0.15)', // the error box's wash, bordered by dangerDim
  offlineAlert: '#D32F2F',              // the offline pill's fill: danger, deep enough for body-size white text
  // The lantern mockup's #turn.ok and #turn.bad: the turn pill carrying the connection, and `offline*`
  // also a refusal's float.
  onlineInk:    '#D4ECCE',
  onlineEdge:   'rgba(143,191,138,0.7)',
  onlineDot:    '#8FBF8A',
  offlineInk:   '#FFCFC6',
  offlineEdge:  '#D0574B',
  offlineDot:   '#E0806F',
  // The turn chip in the last seconds of the viewer's own clock.
  ember:        '#FF8A5C',              // border
  emberGlow:    '#FF6E3C',
  emberDot:     '#FF7A45',
  emberLabel:   '#FFD2B8',
  emberCount:   '#FFB08A',

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
  // The paper ramp's own shade seen edge-on: a card's lip, and the who-starts tile's.
  cardLip:      '#D6D0BC',

  // Traditional red/black. Suit identity is carried by the pip glyph, so colour
  // is not the only channel. Role: card suit ink, on the card face or anywhere
  // else a suit glyph is drawn.
  spade:        '#1A1A1A',
  heart:        '#C8102E',
  diamond:      '#C8102E',
  club:         '#1A1A1A',

  // What a shadow is cast in. `Shadow.*` (lib/theme.ts) is the same colour
  // pre-applied; this is for the shadows whose radius scales with the card.
  shadow:       '#000000',
  border:       'rgba(240,234,214,0.1)',
  borderStrong: 'rgba(240,234,214,0.2)',
  // The chips over the felt. The prototype gets away with rgba(3,14,9,.55)
  // because it also carries `backdrop-filter: blur(6px)`, which React Native
  // has no equivalent for on any platform — without the blur behind it the
  // sheerer fill drops the chip's own label under 4.5:1 on the felt's lit
  // stop (tests/ui-rules/contrast.test.ts). The extra opacity buys back what the blur
  // was doing.
  chipFill:     'rgba(3,14,9,0.72)',
  scorePillTop: 'rgba(18,36,26,0.95)',
  scorePillFoot:'rgba(3,14,9,0.93)',
  track:        'rgba(240,234,214,0.08)', // an empty progress line
  badgeInk:     '#241A06',                // text on a gold badge
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
  bombFill:    'rgba(255,80,80,0.22)',

  podiumGold:   '#C9A84C',
  podiumSilver: '#C0C0C0',
  podiumBronze: '#CD7F32',
};

// Black washes for depth and modal backdrops.
export const Scrim = {
  subtle: 'rgba(0,0,0,0.1)',
  soft:   'rgba(0,0,0,0.22)',
  medium: 'rgba(0,0,0,0.35)',
  heavy:  'rgba(0,0,0,0.6)',
  // For a wash animated by opacity: the view's opacity is then the darkness.
  solid:  'rgba(0,0,0,1)',
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

// The Lantern Table mockup's `gloss()`, in design points at reach 1 (components/table/cardGloss.ts).
export const CardGloss = {
  falloff: 440,
  squash: 1.2,
  spot: { radius: 85, color: '#FFF8E8', alpha: 0.3, mid: { at: 0.3, color: '#FFF4DE', alpha: 0.1 } },
  streak: { color: '#FFF6E4', reach: 260, travel: 0.7, width: 0.2, alpha: { floor: 0.05, lit: 0.22 } },
} as const;

// What a card landing throws up off the felt: the mockup's `landDust` (#1242).
export const Dust = {
  mote: '#FFE2A8',
  puff: 'rgba(230,215,180,0.1)',
  moteLifeSec: [0.5, 1.1],
  puffLifeSec: [0.7, 1.1],
  speckLifeSec: [0.4, 0.8],
} as const;

// The turn hand-off: the mockup's `ember` along the rim, and its `.ring` transition, the outgoing
// clock out before the incoming in, at once under reduced motion (#1264).
export const Handoff = {
  emberHead: '#FFF1C8',
  emberTrail: '#FFD27A',
  emberMs: 380,
  headLifeSec: 0.05,
  trailLifeSec: [0.25, 0.4],
  clockOutMs: 100,
  clockInMs: 100,
} as const;

// The bomb's beat after its landing: the mockup's `bombFx` and `flash` (#1263).
export const BombFx = {
  delayMs: 90,
  sparks: ['#FFD27A', '#FFB347', '#FFF1C8'],
  sparkSizes: [1, 1.8, 2.8],
  sparkLifeSec: [0.5, 1.2],
  ember: '#FF9A4A',
  emberLifeSec: [1.5, 2.6],
  flash: 'rgba(255,222,150,0.5)',
  flashMs: 280,
  flashGapMs: 1000,
  asidePt: 6,
  asideMs: 170,
} as const;

// The table at rest: the mockup's `drawAir` (#1261). A mote's alpha is its light's.
export const RestAir = {
  mote: '#FFE4AA',
  moth: 'rgba(232,214,176,0.9)',
  mothShadow: 'rgba(0,0,0,0.28)',
} as const;

// The beaten play under the new one: the lantern mockup's `.grp.prev`; `shade` over each card is its `brightness(.6)` (D4 #5).
export const Beaten = {
  rotateDeg: -7,
  drop: 9,
  shade: 'rgba(0,0,0,0.4)',
} as const;

// A seat down to its last card: the lantern mockup's `.badge.last` (#1259 D4 #4).
export const LastCard = {
  fill: '#9E1F26',
  edge: '#FFB3A0',
  ink:  '#FFFFFF',
  glow: '#FF5A46',
} as const;

// The felt's card shadows: the lantern mockup's `.card`, `.card.bkc`, `.bk` and `--shx`/`--shy`, in its
// points at card scale 1, blurs as CSS states them (tests/ui-rules/cardShadows.test.ts parses the mockup).
export const CardShadow = {
  cast: { blur: 10, alpha: 0.5 },
  contact: { y: 1, blur: 2 },
  alpha: { face: 0.3, back: 0.4, fan: 0.5 },
  fall: { x: 26, y: 30, drop: 3 },
} as const;

// Design gate G1 (#1259 plan 4), tests/e2e/fixtures/card-glow: under a selected hand card and the flush catch.
export const CardGlow = { color: '#FFD27A', alpha: 0.7, blur: 18 } as const;

// What a table notice paints, by shape and tone (components/table/TableNotice.tsx,
// its one reader). Edges map the mockup's onto the gold scale (#1259 Q4); the lit edge is `goldLitEdge`.
export const NoticePalette = {
  pill: {
    neutral: { fill: Colors.chipFill, edge: Colors.goldBorder, ink: Colors.textMuted, strong: Colors.gold, warn: Colors.dangerDim, dot: { color: Colors.gold } },
    lit: {
      fill: Colors.chipFill,
      edge: Colors.goldLitEdge,
      ink: Colors.goldLit,
      strong: Colors.goldLit,
      warn: Colors.dangerDim,
      glow: { color: Colors.goldLit, opacity: 0.28 },
      dot: { color: Colors.goldLit, glow: 1 },
    },
    urgent: {
      fill: Colors.chipFill,
      edge: Colors.ember,
      ink: Colors.emberLabel,
      strong: Colors.emberCount,
      warn: Colors.emberCount,
      glow: { color: Colors.emberGlow, opacity: 0.5 },
      dot: { color: Colors.emberDot, glow: 1 },
    },
    ok: { fill: Colors.chipFill, edge: Colors.onlineEdge, ink: Colors.onlineInk, strong: Colors.onlineInk, dot: { color: Colors.onlineDot } },
    bad: { fill: Colors.chipFill, edge: Colors.offlineEdge, ink: Colors.offlineInk, strong: Colors.offlineInk, dot: { color: Colors.offlineDot } },
    solid: { fill: Colors.offlineAlert, edge: Colors.offlineAlert, ink: Colors.white, strong: Colors.white },
    gold: { fill: Colors.chipFill, edge: Colors.goldStrong, ink: Colors.goldLit, strong: Colors.goldLit },
  },
  chip: {
    neutral: { fill: 'rgba(3,14,9,0.85)', edge: Colors.goldBorder, ink: Colors.textSecondary, strong: Colors.textSecondary },
    lit: { fill: Scrim.heavy, edge: Colors.goldStrong, ink: Colors.gold, strong: Colors.gold },
  },
  float: {
    neutral: { fill: Colors.chipFill, edge: Colors.goldBorder, ink: Colors.textMuted, strong: Colors.gold },
    bad: { fill: Colors.chipFill, edge: Colors.offlineEdge, ink: Colors.offlineInk, strong: Colors.offlineInk, dot: { color: Colors.offlineDot } },
  },
  panel: {
    neutral: { fill: Colors.scorePillFoot, top: Colors.scorePillTop, edge: Colors.goldStrong, ink: Colors.text, strong: Colors.goldLit, quiet: Colors.textMuted, hairline: 'rgba(243,224,166,0.1)' },
  },
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
// than a wash: the cloth shader (components/table/feltShader.ts) lays these
// along the lamp's falloff, so the first stop is the cloth lit and the last is
// the cloth barely lit.
//
// Every alternate is at or below the green's luminance at every stop, so the
// contrast ratios tests/ui-rules/contrast.test.ts pins against `Colors.felt` are a
// floor for all four — pinned by tests/ui-rules/cosmetics.test.ts.
export const FeltGradients = {
  verde:    ['#2E9F62', '#23854F', '#186B41', '#0F4E31', '#093320'],
  blu:      ['#1F8A93', '#197279', '#135A60', '#0D4247', '#082C30'],
  bordeaux: ['#9A3A5E', '#80304E', '#66263F', '#4C1C2F', '#331320'],
  notte:    ['#566878', '#475765', '#394652', '#2B353F', '#1E252C'],
} as const;

/** The default felt. Anything not themed by the player's choice uses this. */
export const FeltGradient = FeltGradients.verde;

// Card backs. Only three things survive at card size — the ink, the field
// colour and how dense the lattice is — so a back is those plus a star count,
// not a bespoke drawing. The field is card stock, not cloth: its own five-stop
// gradient, so repainting FeltGradients can never repaint a back.
export const CardBacks = {
  // The prototype's own back, and the default: a green field, so an opponent's
  // fan still reads as cards on the far side of the table.
  smeraldo:   { field: ['#1E6544', '#19583B', '#144B32', '#0F3E29', '#0A3120'], ink: Colors.gold, lattice: 7, starPoints: 8 },
  oro:        { field: ['#7A5528', '#654520', '#503718', '#3B2811', '#271A0A'], ink: '#E2BE62',   lattice: 7, starPoints: 8 },
  rubino:     { field: ['#5E1B28', '#4C1520', '#3A1018', '#2A0B11', '#1A060A'], ink: Colors.gold, lattice: 7, starPoints: 8 },
  zaffiro:    { field: ['#1C3B63', '#172F50', '#12243E', '#0C192C', '#07101C'], ink: '#BFC3C8',   lattice: 9, starPoints: 6 },
  // Blind embossed: the lattice and frame are pressed, not inked, and only the star is gold.
  inchiostro: { field: ['#34302C', '#2A2623', '#201D1A', '#171513', '#0E0C0B'], ink: Colors.gold, lattice: 5, starPoints: 4, emboss: true },
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
  /** Dims the felt before a bomb lands, under every card. */
  feltScrim: 1,
  table: 2,
  moment: 10,
  rail: 20,
  hint: 30,
  /** The bomb's flash: over the table, its hand and chips, as the mockup's `#flash`. */
  flash: 35,
  /**
   * The turn countdown, and nothing else. A layer that holds the table covers
   * the cards and the buttons on purpose, but a clock the seat is being charged
   * for is not something a hold may take away — so it sits above every such
   * layer and below the banner band, which is news about the app rather than
   * about this turn.
   */
  clock: 40,
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
    /** A notice's pill or panel arriving or leaving (D2, #1259). */
    notice: 160,
    /** Something moving a short way inside its own container. */
    shift: 200,
    /** Something crossing the table — the card in flight. The whole feel hangs on this one. */
    travel: 260,
    /** The escalation's own screen shake (#763): a beat longer than the throw, so the recoil outlasts the card's own landing, decaying trauma squared across the window. */
    shake: 360,
    /** Something arriving that was not there: a banner, an overlay, a hand dealt in. */
    reveal: 600,
    /** An ambient loop, and how long a moment holds before it releases. */
    dwell: 1200,
  },
  /**
   * What each step becomes when the player asked for less motion.
   *
   * Not "off": travel is what goes, and the state change stays legible. A card
   * that flew cross-fades in place instead. `null` means the step is already
   * short enough to leave alone.
   */
  reduced: {
    flash: null,
    tap: null,
    /** Fade in place: `noticeRise` drops the travel. */
    notice: null,
    /** Cross-fade in place, no travel. */
    shift: 0,
    /** Cross-fade in place, no travel. */
    travel: 0,
    /** No decay window to run: `traumaFor` already answers 0 trauma here. */
    shake: 0,
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
  /** The lantern mockup's `dealRun`: the first card's lead, each opponent slot's gap, the felt's breath, the tail past the last round. */
  deal: { lead: 40, seat: 10, breath: 80, tail: 320 },
  /** The lantern mockup's `play()` (ADR-0008): per card, and between cards; catch-up is its reconnect replay. */
  throw: { card: 380, stagger: 45, catchUpCard: 200, catchUpStagger: 20 },
  /** The exchange's legs, giver → pile → receiver, and the holds between them: the owner's "Through the pile" (tests/e2e/fixtures/exchange-legs, PLAN). */
  exchange: { beat: 344, lift: 500, fly: 1000, tuck: 1000, highlight: 1500, giveWait: 420, read: 900 },
  /** A notice's mark or float, and the connection dot's blink: the lantern mockup's `passSeat`, `passYou` and `blink` (#1259 Q1). */
  mark: { enter: 100, hold: 1000, exit: 100, blink: 900 },
  /** The beaten play's turn: the lantern mockup's `.grp` transition, ease-out. Off the ladder, a hair past travel; at once under reduced motion. */
  beaten: 280,
} as const;

/** The viewer's own drop: the lantern mockup's `reconnect` chapter, `grayTo` and `net()` (#1268). */
export const Reconnect = {
  grey: 0.85,
  /** Brightness falls by this much of the grey: `brightness(1 − 0.25g)`. */
  darken: 0.25,
  greyIn: 300,
  greyOut: 400,
  pillAfter: 500,
  back: 1300,
  /**
   * Still down this long, the table gives up and offers Riprova. A socket.io drop is noticed up to
   * a ping timeout late, and the server holds the seat for 60 s (docs/DISCONNECT-POLICY.md), so a
   * longer wait leaves Riprova only a seat already taken over.
   */
  giveUp: 15_000,
  lamp: 0.55,
  lampRate: 1,
} as const;

/** A manche ending on the table, in ms from the landing that ends it: the lantern mockup's `payoff` (#1266). */
export const MancheEnding = {
  open: 700,
  openFor: 240,
  gain: 900,
  gainStep: 120,
  popFor: 180,
  countFor: 500,
  rerank: 1500,
  rerankFor: 300,
  close: 2150,
  closeFor: 250,
  glowFor: 900,
  pileFadeFor: 150,
  deal: 2500,
} as const;

/** A partita ending on the table, in ms from the landing that ends it: the mockup's `payoff` with `partita` (#1267). */
export const PartitaEnding = {
  open: 600,
  openFor: 240,
  gain: 800,
  gainStep: 100,
  popFor: 180,
  countFor: 450,
  rerank: 1350,
  rerankFor: 300,
  close: Infinity,
  closeFor: 0,
  glowFor: 0,
  board: 1600,
  boardFor: 600,
  dim: 0.6,
  dimFor: 400,
  winnerBox: 2100,
  winnerBoxFor: 300,
  actions: 2600,
  actionsFor: 300,
} as const;

/**
 * How long `step` runs for this player.
 *
 * A `null` reduced form is a step with nothing to shorten — a flash is over
 * before it registers as movement, and a loop gives up its repeat rather than
 * its duration — so the step's own length stands. Every other ladder step takes
 * the answer `Motion.reduced` already wrote down, which is the point: a call site
 * that decides for itself is how "reduced" came to mean a 200ms fade in one
 * screen and an instant jump in the next. `beaten`, the one step off the ladder,
 * has its reduced form (0) written here, since `Motion.reduced` holds ladder steps only.
 */
export function motionMs(step: keyof typeof Motion.duration | "beaten", reduceMotion: boolean): number {
  if (step === "beaten") return reduceMotion ? 0 : Motion.beaten;
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
  /** From a flight's end to the hand-off — the lantern mockup's gap (index.html:612, :614). */
  land: 175,
  /** From the landing that ends a manche to its sting (the lantern mockup's `mwin`/`mlose`). */
  sting: 300,
  /** A face shown to be read before it moves on: the exchange's rest on the pile (the fixture's PLAN.rest). */
  reveal: 1500,
} as const;

/** How late a sound may still start and be heard as on time; later, it is dropped. */
export const LATE_SOUND_MS = 45;

/**
 * How hard the table shakes at each rung of the landing escalation #101
 * settled — Nijman's *trauma*, 0..1 (*Art of Screenshake*, INDIGO Classes
 * 2013). `shakeMagnitude` (components/flightPhysics.ts) reads it back as
 * trauma squared, not trauma: #772 found the talk itself hedges between
 * squaring and cubing that curve, and the owner settled this table on it —
 * raw trauma reads as the table sliding to rest rather than struck, and
 * flattens how far a bomb ought to stand above a manche closing.
 *
 * The bomb outranks the manche on purpose, confirmed by the owner on #101: a
 * bomb is a surprise, a manche ending is expected. If the bigger event always
 * shook harder, the moment the game is actually about would be the quiet one.
 */
export const Trauma = {
  bomb: 0.55,
  mancheWon: 0.40,
  partitaWon: 0.50,
} as const;
