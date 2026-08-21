import React, { useEffect, useId } from "react";
import { View, StyleSheet, Pressable, Image } from "react-native";
import { TableText } from "@/components/table/TableText";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path, Circle, G, Rect, Defs, Use } from "react-native-svg";
import { Card, Suit, getCardDisplayRank } from "@/lib/gameEngine";
import {
  CardFaceGradient,
  Colors,
  FontSize,
  Motion,
  Radius,
  Shadow,
} from "@/lib/theme";
import { useCardBack } from "@/lib/cosmetics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import { cardSpokenName } from "@/lib/cardNames";
import {
  ACE_PIP_SIZE,
  CARD_BACK_H,
  CARD_BACK_W,
  CARD_H,
  CARD_W,
  COURT_RANKS,
  courtArtRect,
  INDEX_SUIT_SIZE,
  INDEX_SUIT_Y,
  INDEX_TEXT_W,
  INDEX_X,
  placedPips,
  rankFontSize,
  rankInset,
} from "@/components/cardFaceModel";
import { a11yHidden, a11yState, useA11yHint } from "@/lib/a11y";

// Suit → colour. `Suit` is plural ("spades") while the theme tokens are singular
// ("spade"), so the mapping has to be explicit. Typed as Record<Suit, string> so
// the compiler catches a missing or misspelled suit instead of silently
// yielding undefined.
const SUIT_COLORS: Record<Suit, string> = {
  spades: Colors.spade,
  hearts: Colors.heart,
  diamonds: Colors.diamond,
  clubs: Colors.club,
};


// Court panel: horizontal extent in card fractions, vertical extent derived
// from the fixed local box the half-figure is authored in, so the two mirrored
// halves always meet exactly on the panel's centre line.
const PANEL_X0 = 0.22;
const PANEL_X1 = 0.78;
const PANEL_BOX_W = 40;
const PANEL_HALF_H = 38;



// ─── Suit marks ───────────────────────────────────────────────────────────────
//
// Drawn as vector paths rather than as the Unicode ♠♥♦♣ glyphs: the system font
// that resolves those characters differs on every platform, so a text-based pip
// is a different shape on iOS, Android and web. These are one shape everywhere.
// Each is authored in a 10×10 box centred on the origin and scaled at use.

const SUIT_PATHS: Record<Exclude<Suit, "clubs">, string> = {
  hearts:
    "M0,4.7 C-1.7,2.5 -4.7,0.5 -4.7,-1.8 C-4.7,-3.8 -3.3,-4.8 -2.1,-4.8 " +
    "C-0.9,-4.8 -0.2,-3.9 0,-3.1 C0.2,-3.9 0.9,-4.8 2.1,-4.8 " +
    "C3.3,-4.8 4.7,-3.8 4.7,-1.8 C4.7,0.5 1.7,2.5 0,4.7 Z",
  diamonds: "M0,-4.9 L3.5,0 L0,4.9 L-3.5,0 Z",
  spades:
    "M0,-4.9 C-0.6,-3.6 -4.6,-0.6 -4.6,1.6 C-4.6,3.2 -3.4,4.0 -2.4,4.0 " +
    "C-1.4,4.0 -0.7,3.5 -0.3,2.8 C-0.5,3.9 -1.3,4.6 -2.2,5.0 L2.2,5.0 " +
    "C1.3,4.6 0.5,3.9 0.3,2.8 C0.7,3.5 1.4,4.0 2.4,4.0 C3.4,4.0 4.6,3.2 4.6,1.6 " +
    "C4.6,-0.6 0.6,-3.6 0,-4.9 Z",
};

/**
 * The suit shape itself, declared once per card face and referenced by every
 * pip and index mark on it. A card carries one suit in one colour, so the fill
 * is baked into the definition — nothing has to inherit through <Use>, which is
 * where this kind of hoist usually changes rendering silently.
 */
function SuitDef({ id, suit, color }: { id: string; suit: Suit; color: string }) {
  if (suit === "clubs") {
    return (
      <G id={id}>
        <Circle cx={0} cy={-2.5} r={2.3} fill={color} />
        <Circle cx={-2.7} cy={1.2} r={2.3} fill={color} />
        <Circle cx={2.7} cy={1.2} r={2.3} fill={color} />
        <Path d="M-2.2,5.0 C-0.9,4.1 -0.4,2.9 -0.3,1.4 L0.3,1.4 C0.4,2.9 0.9,4.1 2.2,5.0 Z" fill={color} />
      </G>
    );
  }
  return <Path id={id} d={SUIT_PATHS[suit]} fill={color} />;
}

function SuitMark({
  href,
  x,
  y,
  size,
  flipped = false,
}: {
  href: string;
  x: number;
  y: number;
  size: number;
  flipped?: boolean;
}) {
  const k = size / 10;
  const transform = `translate(${x},${y}) scale(${k})${flipped ? " rotate(180)" : ""}`;
  return <Use href={href} transform={transform} />;
}

// ─── Joker figures ────────────────────────────────────────────────────────────
//
// Murlan's two jokers are the deck's top two cards and must be told apart at a
// glance, which the source deck's identical red/black art does not allow.
//
// One half-figure printed twice, the second rotated 180° about the panel
// centre, authored in a fixed PANEL_BOX_W × PANEL_HALF_H box.
//
// Keep every feature at least ~2 local units across: at ~0.8px per unit
// anything finer resolves to a smudge. The two differ only in the marotte —
// star-tipped for the red joker, plain for the black.
type FigureKind = "joker_colored" | "joker_bw";

// The robe is drawn as line work with a wash inside it, never as a solid fill:
// at this size a filled bust is a black rectangle with a dot on top. Keeping
// the large shape open and reserving solid ink for the small shapes — head,
// crown, held object — is what lets the figure read at all.
const ROBE = "M6.5,38 L6.5,31 Q6.5,26 13,24.2 L27,24.2 Q33.5,26 33.5,31 L33.5,38 Z";
const ROBE_STROKE = 1.5;

function CourtHalf({
  kind,
  color,
  paper,
}: {
  kind: FigureKind;
  color: string;
  paper: string;
}) {
  return (
    <G>
      <Path d={ROBE} fill={color} fillOpacity={0.16} stroke={color} strokeWidth={ROBE_STROKE} />
      {/* Collar: a narrow shield under the chin rather than a band across the
          whole chest. A full-width band reads as a belt and flattens the
          figure into a capsule. */}
      <Path d="M15.4,23.4 L24.6,23.4 L26.4,28 L20,30.4 L13.6,28 Z" fill={color} />
      <G>
        <Circle cx={13.5} cy={33} r={1.8} fill={color} />
        <Circle cx={26.5} cy={33} r={1.8} fill={color} />
      </G>

      <Circle cx={20} cy={18.6} r={5.6} fill={color} />

      <G>
        <Path d="M10,14.4 L11.6,6.4 L15.6,11 L20,4.2 L24.4,11 L28.4,6.4 L30,14.4 Z" fill={color} />
        <Circle cx={11} cy={4.4} r={2.4} fill={color} />
        <Circle cx={20} cy={2.4} r={2.4} fill={color} />
        <Circle cx={29} cy={4.4} r={2.4} fill={color} />
      </G>

      {/* Held object, kept inside the panel and thick enough to survive the
          scale — a hairline staff reads as an antenna. */}
      {kind === "joker_colored" && (
        <G transform="rotate(13 32 20)">
          <Rect x={31} y={12} width={2.2} height={18} rx={1} fill={color} />
          <Path
            d="M32.1,4.4 L33.8,8.5 L38.2,8.8 L34.8,11.7 L35.9,16 L32.1,13.6 L28.3,16 L29.4,11.7 L26,8.8 L30.4,8.5 Z"
            fill={color}
          />
        </G>
      )}
      {kind === "joker_bw" && (
        <G transform="rotate(13 32 20)">
          <Rect x={31} y={12} width={2.2} height={18} rx={1} fill={color} />
          <Circle cx={32.1} cy={9.4} r={3.3} fill={color} />
          <Circle cx={32.1} cy={9.4} r={1.3} fill={paper} />
        </G>
      )}
    </G>
  );
}

function CourtPanel({
  kind,
  color,
  w,
  h,
}: {
  kind: FigureKind;
  color: string;
  w: number;
  h: number;
}) {
  const x0 = w * PANEL_X0;
  const panelW = w * (PANEL_X1 - PANEL_X0);
  const k = panelW / PANEL_BOX_W;
  const boxH = PANEL_HALF_H * 2;
  const panelH = boxH * k;
  const y0 = (h - panelH) / 2;

  return (
    <G>
      <Rect
        x={x0}
        y={y0}
        width={panelW}
        height={panelH}
        rx={3}
        fill="none"
        stroke={color}
        strokeOpacity={0.22}
        strokeWidth={0.9}
      />
      <G transform={`translate(${x0},${y0}) scale(${k})`}>
        <CourtHalf kind={kind} color={color} paper={Colors.cardPaper} />
        <G transform={`rotate(180 ${PANEL_BOX_W / 2} ${boxH / 2})`}>
          <CourtHalf kind={kind} color={color} paper={Colors.cardPaper} />
        </G>
        <Path
          d={`M2,${boxH / 2} L${PANEL_BOX_W - 2},${boxH / 2}`}
          stroke={color}
          strokeOpacity={0.45}
          strokeWidth={1}
        />
      </G>
    </G>
  );
}

// ─── Card face art ────────────────────────────────────────────────────────────

function CardFaceArt({
  card,
  color,
  w,
  h,
  compact,
}: {
  card: Card;
  color: string;
  w: number;
  h: number;
  /** Too small for a pip field — one centred mark instead. */
  compact: boolean;
}) {
  const suit = card.suit;
  // <Defs> ids are document-global on web, where a full table renders 54 cards
  // into one DOM — a shared id would point every card at the first card's suit.
  const pipId = `pip-${useId().replace(/:/g, "")}`;
  const pipHref = `#${pipId}`;
  const indexSuitSize = h * INDEX_SUIT_SIZE;
  const indexX = w * INDEX_X;
  const indexY = h * INDEX_SUIT_Y;

  let centre: React.ReactNode = null;
  if (card.isJoker) {
    centre = compact ? null : (
      <CourtPanel
        kind={card.rank === "joker_colored" ? "joker_colored" : "joker_bw"}
        color={color}
        w={w}
        h={h}
      />
    );
  } else if (suit) {
    if (compact) {
      centre = <SuitMark href={pipHref} x={w * 0.58} y={h * 0.62} size={h * 0.24} />;
    } else if (COURT_RANKS.has(card.rank)) {
      // Drawn as a bitmap sibling of this Svg (see CourtArt), not here.
      centre = null;
    } else if (card.rank === "A") {
      centre = <SuitMark href={pipHref} x={w * 0.5} y={h * 0.5} size={h * ACE_PIP_SIZE} />;
    } else {
      centre = placedPips(card.rank, w, h).map((pip, i) => (
        <SuitMark
          key={i}
          href={pipHref}
          x={pip.x}
          y={pip.y}
          size={pip.size}
          flipped={pip.flipped}
        />
      ));
    }
  }

  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      {suit && (
        <Defs>
          <SuitDef id={pipId} suit={suit} color={color} />
        </Defs>
      )}
      {centre}
      {suit && (
        <>
          <SuitMark href={pipHref} x={indexX} y={indexY} size={indexSuitSize} />
          <SuitMark href={pipHref} x={w - indexX} y={h - indexY} size={indexSuitSize} flipped />
        </>
      )}
      {card.isJoker && (
        <>
          <JokerStar x={indexX} y={indexY} size={indexSuitSize} color={color} filled={card.rank === "joker_colored"} />
          <JokerStar
            x={w - indexX}
            y={h - indexY}
            size={indexSuitSize}
            color={color}
            filled={card.rank === "joker_colored"}
          />
        </>
      )}
    </Svg>
  );
}

// Red and black Joker differ by fill as well as by colour, so the two are still
// distinguishable without colour vision.
function JokerStar({
  x, y, size, color, filled,
}: { x: number; y: number; size: number; color: string; filled: boolean }) {
  const k = size / 10;
  return (
    <G transform={`translate(${x},${y}) scale(${k})`}>
      <Path
        d="M0,-5 L1.5,-1.5 L5,-1.2 L2.3,1.3 L3.1,4.8 L0,2.8 L-3.1,4.8 L-2.3,1.3 L-5,-1.2 L-1.5,-1.5 Z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={filled ? 0 : 1.2}
      />
    </G>
  );
}

// ─── Court art ────────────────────────────────────────────────────────────────
//
// The twelve court figures are real engraved artwork, not drawing code: a J, Q
// or K is a specific figure that people recognise, and hand-written paths at
// this size produced shapes that read as neither. Public domain, from Byron
// Knoll's vector-playing-cards via hayeah/playing-cards-assets — provenance and
// regeneration are recorded in assets/images/cards/README.md.
//
// Each key is a function so Metro can statically resolve the require() calls,
// the same shape lib/sounds.ts uses.
const COURT_ART: Record<string, () => number> = {
  J_clubs:      () => require("../assets/images/cards/jack_of_clubs.png") as number,
  J_diamonds:   () => require("../assets/images/cards/jack_of_diamonds.png") as number,
  J_hearts:     () => require("../assets/images/cards/jack_of_hearts.png") as number,
  J_spades:     () => require("../assets/images/cards/jack_of_spades.png") as number,
  Q_clubs:      () => require("../assets/images/cards/queen_of_clubs.png") as number,
  Q_diamonds:   () => require("../assets/images/cards/queen_of_diamonds.png") as number,
  Q_hearts:     () => require("../assets/images/cards/queen_of_hearts.png") as number,
  Q_spades:     () => require("../assets/images/cards/queen_of_spades.png") as number,
  K_clubs:      () => require("../assets/images/cards/king_of_clubs.png") as number,
  K_diamonds:   () => require("../assets/images/cards/king_of_diamonds.png") as number,
  K_hearts:     () => require("../assets/images/cards/king_of_hearts.png") as number,
  K_spades:     () => require("../assets/images/cards/king_of_spades.png") as number,
};

function CourtArt({ card, w, h }: { card: Card; w: number; h: number }) {
  const source = card.suit ? COURT_ART[`${card.rank}_${card.suit}`] : undefined;
  if (!source) return null;
  const rect = courtArtRect(w, h);
  return (
    <Image
      source={source()}
      style={[styles.courtArt, rect]}
      resizeMode="contain"
      {...a11yHidden()}
    />
  );
}

// ─── Card back ────────────────────────────────────────────────────────────────
//
// A fine 45° lattice reads as texture at any size where a dot grid reads as
// blobs, because a line keeps its identity when it falls below a pixel and a
// dot does not. The whole thing is two Paths and a medallion.

const latticeCache = new Map<string, string>();
function getLattice(w: number, h: number, spacing: number): string {
  const key = `${w}x${h}x${spacing}`;
  let d = latticeCache.get(key);
  if (!d) {
    const span = w + h;
    const parts: string[] = [];
    for (let i = -h; i < span; i += spacing) {
      parts.push(`M${i},0 L${i + h},${h}`);
      parts.push(`M${i},${h} L${i + h},0`);
    }
    d = parts.join(" ");
    latticeCache.set(key, d);
  }
  return d;
}

/** A `points`-pointed star as one polygon: alternate long and short radii. */
function starPath(cx: number, cy: number, r: number, points: number): string {
  const verts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const rad = (Math.PI * i) / points - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.46;
    verts.push(`${(cx + Math.cos(rad) * rr).toFixed(2)},${(cy + Math.sin(rad) * rr).toFixed(2)}`);
  }
  return `M${verts.join(" L")} Z`;
}

function OrnateCardBack({
  width: w,
  height: h,
  back,
}: {
  width: number;
  height: number;
  back: ReturnType<typeof useCardBack>;
}) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.19;
  const ink = back.ink;
  const field = back.field;

  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={getLattice(w, h, back.lattice)} stroke={ink} strokeOpacity={0.13} strokeWidth={0.6} fill="none" />
      <Rect x={2.5} y={2.5} width={w - 5} height={h - 5} rx={5} ry={5}
        fill="none" stroke={ink} strokeWidth={1.4} strokeOpacity={0.85} />
      <Rect x={5.5} y={5.5} width={w - 11} height={h - 11} rx={3} ry={3}
        fill="none" stroke={ink} strokeWidth={0.7} strokeOpacity={0.35} />
      <Path d={starPath(cx, cy, r, back.starPoints)} fill={ink} fillOpacity={0.55} />
      <Circle cx={cx} cy={cy} r={r * 0.42} fill={field[4]} />
      <Circle cx={cx} cy={cy} r={r * 0.42} fill="none" stroke={ink} strokeOpacity={0.7} strokeWidth={0.8} />
    </Svg>
  );
}

// ─── CardView ─────────────────────────────────────────────────────────────────

interface CardViewProps {
  card: Card;
  selected?: boolean;
  onPress?: () => void;
  /** Multiplies the base card size (face 64×90, back 27×48 at scale 1). */
  scale?: number;
  /** Too small for a pip field — one centred mark instead, no court bitmap. */
  compact?: boolean;
  faceDown?: boolean;
  disabled?: boolean;
  style?: object;
  noLift?: boolean;
  /**
   * The card is the visual content of an enclosing labelled control, so it
   * must not also announce itself — otherwise a screen reader reads the same
   * card twice, once for the wrapper and once for this.
   */
  decorative?: boolean;
}

function CardViewBase({
  card,
  selected = false,
  onPress,
  scale = 1,
  compact = false,
  faceDown = false,
  disabled = false,
  style,
  noLift = false,
  decorative = false,
}: CardViewProps) {
  const { t } = useTranslation();
  const selectedHint = useA11yHint(decorative || !selected ? undefined : t("cardView.selectedA11yHint"));
  const reduceMotion = usePrefersReducedMotion();
  const back = useCardBack();
  const backField = back.field;
  const translateY = useSharedValue(0);
  // Finger-down acknowledgement. Separate from the selection lift so a press
  // reads instantly even when the resulting selection is rejected.
  const press = useSharedValue(0);

  const interactive = !!onPress && !disabled;

  useEffect(() => {
    if (noLift) {
      translateY.value = 0;
      return;
    }
    const target = selected ? -14 : 0;
    translateY.value = reduceMotion
      ? withTiming(target, { duration: Motion.duration.fast })
      : withSpring(target, Motion.spring.pickup);
  }, [selected, noLift, reduceMotion, translateY]);

  // Must precede the effect that reads `press` — the React Compiler skips any component that mutates a value an effect captured.
  const handlePressIn = () => {
    if (!interactive) return;
    press.value = reduceMotion ? 1 : withSpring(1, Motion.spring.pickup);
  };
  const handlePressOut = () => {
    if (!interactive) return;
    press.value = reduceMotion ? 0 : withSpring(0, Motion.spring.land);
  };
  const handlePress = () => {
    if (!interactive) return;
    onPress!();
  };

  useEffect(
    () => () => {
      cancelAnimation(translateY);
      cancelAnimation(press);
    },
    [translateY, press]
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value + press.value * -3 },
      { rotate: `${press.value * -1.5}deg` },
    ],
  }));

  const w = faceDown ? CARD_BACK_W(scale) : CARD_W(scale);
  const h = faceDown ? CARD_BACK_H(scale) : CARD_H(scale);

  if (faceDown) {
    return (
      <Animated.View style={[animStyle, style]}>
        <View style={[styles.card, { width: w, height: h }, styles.cardBack]}>
          <LinearGradient
            colors={[backField[1], backField[2], backField[4]]}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <OrnateCardBack width={w} height={h} back={back} />
        </View>
      </Animated.View>
    );
  }

  const rankText = card.isJoker ? "JK" : getCardDisplayRank(card.rank);
  // "10" is the only two-glyph rank. At the single-glyph size it renders wider
  // than the index column and collides with the left pip column; the wide
  // ratio in cardFaceModel is the one that fits.
  const rankFont = rankFontSize(rankText, h);
  const inset = rankInset(h);
  const rankBox = { fontSize: rankFont, lineHeight: rankFont, width: w * INDEX_TEXT_W, top: inset };
  const color = card.isJoker
    ? card.rank === "joker_colored" ? Colors.heart : Colors.cardInk
    : card.suit ? SUIT_COLORS[card.suit] : Colors.spade;

  return (
    <Animated.View style={[animStyle, style]}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={!interactive}
        {...a11yHidden(decorative)}
        accessibilityLabel={decorative ? undefined : cardSpokenName(card, t)}
        // No onPress at all is information, not a control — it keeps its name
        // but claiming `button` would announce an action that does not exist.
        //
        // An onPress that is momentarily disabled stays a button reporting
        // itself unavailable: dropping the role would make the hand vanish and
        // reappear in the button rotation every turn.
        {...a11yState({ role: onPress ? "button" : undefined, selected, disabled: !interactive })}
        {...selectedHint.props}
        style={[
          styles.card,
          { width: w, height: h },
          selected && styles.cardSelected,
        ]}
      >
        {selectedHint.node}
        <LinearGradient
          colors={CardFaceGradient}
          locations={[0, 0.55, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <CardFaceArt card={card} color={color} w={w} h={h} compact={compact} />
        {!compact && COURT_RANKS.has(card.rank) && <CourtArt card={card} w={w} h={h} />}
        <TableText
          style={[
            styles.rankText,
            rankBox,
            card.isJoker && styles.rankTextJoker,
            { color },
          ]}
        >
          {rankText}
        </TableText>
        <TableText
          style={[
            styles.rankText,
            rankBox,
            card.isJoker && styles.rankTextJoker,
            styles.rankTextBottom,
            { top: undefined, bottom: inset, color },
          ]}
        >
          {rankText}
        </TableText>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A card id is `rank_suit` (lib/gameEngine.ts createDeck), so equal ids mean an
 * identical face. That is what lets this compare by id: every `game:state`
 * arrives as fresh JSON, so the card objects are new on every server message
 * even when nothing about the hand changed.
 */
function cardViewPropsEqual(a: CardViewProps, b: CardViewProps): boolean {
  return (
    a.card.id === b.card.id &&
    a.selected === b.selected &&
    a.onPress === b.onPress &&
    a.scale === b.scale &&
    a.compact === b.compact &&
    a.faceDown === b.faceDown &&
    a.disabled === b.disabled &&
    a.noLift === b.noLift &&
    a.decorative === b.decorative &&
    a.style === b.style
  );
}

export const CardView = React.memo(CardViewBase, cardViewPropsEqual);
CardView.displayName = "CardView";

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardPaper,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.cardEdge,
    overflow: "hidden",
    ...Shadow.card,
  },
  cardSelected: {
    borderColor: Colors.gold,
    borderWidth: 2,
  },
  cardBack: {
    backgroundColor: Colors.felt,
    borderColor: Colors.goldDark,
    borderWidth: 1,
  },
  // The index characters sit in the drawn index column: the suit mark below
  // them comes from the SVG layer, so the two must agree on INDEX_X.
  courtArt: {
    position: "absolute",
  },
  rankText: {
    position: "absolute",
    fontFamily: "Rajdhani_700Bold",
    letterSpacing: -0.5,
    textAlign: "center",
    left: 0,
  },
  rankTextJoker: {
    fontSize: FontSize.xs,
    lineHeight: 12,
  },
  rankTextBottom: {
    top: undefined,
    left: undefined,
    right: 0,
    transform: [{ rotate: "180deg" }],
  },
});
