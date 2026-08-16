import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path, Circle, G, Rect } from "react-native-svg";
import { Card, Suit, getCardDisplayRank } from "@/lib/gameEngine";
import {
  CardFaceGradient,
  Colors,
  FeltGradient,
  Motion,
  Radius,
  Shadow,
} from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import { cardSpokenName } from "@/lib/cardNames";

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

// ponytail: theme.ts has no card-dimension token yet — centralised here and
// flagged in this task's `deferred` output rather than edited into theme.ts
// by an agent scoped to CardView.tsx only.
const CARD_W = 58;
const CARD_H = 84;
const CARD_W_SMALL = 40;
const CARD_H_SMALL = 58;

// ─── Card face geometry ───────────────────────────────────────────────────────
//
// Everything below is a fraction of the card's own width/height, so the same
// drawing code serves both card sizes and would survive a dimension change.
// The numbers reproduce a standard poker-deck layout: a narrow index column
// down the left edge (repeated rotated at the bottom-right), and a three-column
// pip field to its right.

const INDEX_X = 0.118;      // centre of the index column
const INDEX_SUIT_Y = 0.25;  // index suit mark, below the rank character
const PIP_COL = { left: 0.34, centre: 0.5, right: 0.66 } as const;
const PIP_TOP = 0.16;
const PIP_BOTTOM = 0.84;
const PIP_SIZE = 0.165;      // of card height
const ACE_PIP_SIZE = 0.30;   // of card height
const INDEX_SUIT_SIZE = 0.10;

// Court panel: horizontal extent in card fractions, vertical extent derived
// from the fixed local box the half-figure is authored in, so the two mirrored
// halves always meet exactly on the panel's centre line.
const PANEL_X0 = 0.22;
const PANEL_X1 = 0.78;
const PANEL_BOX_W = 40;
const PANEL_HALF_H = 38;

type PipColumn = keyof typeof PIP_COL;
interface PipSpot {
  col: PipColumn;
  /** 0 = top row of the pip field, 1 = bottom row. */
  row: number;
}

// The traditional pip grids. Anything at row > 0.5 prints upside down, exactly
// as it does on a real card, so the card reads the same from either end.
const THIRD = 1 / 3;
const PIP_LAYOUTS: Record<string, PipSpot[]> = {
  "2": [{ col: "centre", row: 0 }, { col: "centre", row: 1 }],
  "3": [{ col: "centre", row: 0 }, { col: "centre", row: 0.5 }, { col: "centre", row: 1 }],
  "4": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
  "5": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "centre", row: 0.5 },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
  "6": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "left", row: 0.5 }, { col: "right", row: 0.5 },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
  "7": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "centre", row: 0.25 },
    { col: "left", row: 0.5 }, { col: "right", row: 0.5 },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
  "8": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "centre", row: 0.25 },
    { col: "left", row: 0.5 }, { col: "right", row: 0.5 },
    { col: "centre", row: 0.75 },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
  "9": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "left", row: THIRD }, { col: "right", row: THIRD },
    { col: "centre", row: 0.5 },
    { col: "left", row: 2 * THIRD }, { col: "right", row: 2 * THIRD },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
  "10": [
    { col: "left", row: 0 }, { col: "right", row: 0 },
    { col: "centre", row: 1 / 6 },
    { col: "left", row: THIRD }, { col: "right", row: THIRD },
    { col: "left", row: 2 * THIRD }, { col: "right", row: 2 * THIRD },
    { col: "centre", row: 5 / 6 },
    { col: "left", row: 1 }, { col: "right", row: 1 },
  ],
};

const COURT_RANKS = new Set(["J", "Q", "K"]);

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

function SuitMark({
  suit,
  x,
  y,
  size,
  color,
  flipped = false,
}: {
  suit: Suit;
  x: number;
  y: number;
  size: number;
  color: string;
  flipped?: boolean;
}) {
  const k = size / 10;
  const transform = `translate(${x},${y}) scale(${k})${flipped ? " rotate(180)" : ""}`;
  if (suit === "clubs") {
    return (
      <G transform={transform}>
        <Circle cx={0} cy={-2.5} r={2.3} fill={color} />
        <Circle cx={-2.7} cy={1.2} r={2.3} fill={color} />
        <Circle cx={2.7} cy={1.2} r={2.3} fill={color} />
        <Path d="M-2.2,5.0 C-0.9,4.1 -0.4,2.9 -0.3,1.4 L0.3,1.4 C0.4,2.9 0.9,4.1 2.2,5.0 Z" fill={color} />
      </G>
    );
  }
  return (
    <G transform={transform}>
      <Path d={SUIT_PATHS[suit]} fill={color} />
    </G>
  );
}

// ─── Court figures ────────────────────────────────────────────────────────────
//
// A court card is one half-figure printed twice, the second rotated 180° about
// the panel centre, so the card reads right way up from either end. The half is
// authored in a fixed PANEL_BOX_W × PANEL_HALF_H box and the panel scales it.
//
// Every feature is at least ~2 local units across. At the size these render
// (a ~32pt-wide panel, so roughly 0.8px per local unit) anything finer than
// that resolves to a smudge, which is what the previous jewels and 0.8-unit
// circles did.
//
// The five kinds share one silhouette — crown/hat, head, shouldered robe, an
// object held at the right shoulder — so the deck reads as one engraved set:
//   K              spiked crown, beard, sword
//   Q              arched tiara with a centre orb, flowered sceptre
//   J              soft cap with a feather, halberd
//   joker_colored  belled jester cap, star-tipped marotte (Red Joker)
//   joker_bw       belled jester cap, plain marotte (Black Joker)
type FigureKind = "J" | "Q" | "K" | "joker_colored" | "joker_bw";

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
  suit,
}: {
  kind: FigureKind;
  color: string;
  paper: string;
  suit: Suit | null;
}) {
  const isJoker = kind === "joker_colored" || kind === "joker_bw";
  return (
    <G>
      <Path d={ROBE} fill={color} fillOpacity={0.16} stroke={color} strokeWidth={ROBE_STROKE} />
      {/* Collar: a narrow shield under the chin rather than a band across the
          whole chest. A full-width band reads as a belt and flattens the
          figure into a capsule. */}
      <Path d="M15.4,23.4 L24.6,23.4 L26.4,28 L20,30.4 L13.6,28 Z" fill={color} />
      {suit && !isJoker && <SuitMark suit={suit} x={20} y={34.2} size={7} color={color} />}
      {isJoker && (
        <G>
          <Circle cx={13.5} cy={33} r={1.8} fill={color} />
          <Circle cx={26.5} cy={33} r={1.8} fill={color} />
        </G>
      )}

      <Circle cx={20} cy={18.6} r={5.6} fill={color} />
      {kind === "K" && <Path d="M14.6,19.4 Q20,27.8 25.4,19.4 Z" fill={color} />}
      {kind === "Q" && (
        <G>
          <Path d="M14.2,13.8 Q11.8,19 13.8,23.8 L10.8,23.8 Q9,18.4 11.8,13 Z" fill={color} />
          <Path d="M25.8,13.8 Q28.2,19 26.2,23.8 L29.2,23.8 Q31,18.4 28.2,13 Z" fill={color} />
        </G>
      )}

      {kind === "K" && (
        <G>
          <Path d="M11,14 L11,10 L14.5,4.2 L17.5,10 L20,3 L22.5,10 L25.5,4.2 L29,10 L29,14 Z" fill={color} />
          <Rect x={10.4} y={13.2} width={19.2} height={2.4} rx={1} fill={color} />
        </G>
      )}
      {kind === "Q" && (
        <G>
          <Path d="M12,14.6 L12,10 Q20,4.6 28,10 L28,14.6 Z" fill={color} />
          <Circle cx={14.4} cy={7.4} r={2.3} fill={color} />
          <Circle cx={25.6} cy={7.4} r={2.3} fill={color} />
          <Circle cx={20} cy={4.2} r={3.1} fill={color} />
          <Circle cx={20} cy={4.2} r={1.2} fill={paper} />
        </G>
      )}
      {kind === "J" && (
        <G>
          <Path d="M11,14.4 Q9.5,5.5 19,3.6 Q29.5,3.2 30,10 L30,14.4 Z" fill={color} />
          <Path d="M26.5,5.2 L38,0.6 L31,10.4 Z" fill={color} />
        </G>
      )}
      {isJoker && (
        <G>
          <Path d="M10,14.4 L11.6,6.4 L15.6,11 L20,4.2 L24.4,11 L28.4,6.4 L30,14.4 Z" fill={color} />
          <Circle cx={11} cy={4.4} r={2.4} fill={color} />
          <Circle cx={20} cy={2.4} r={2.4} fill={color} />
          <Circle cx={29} cy={4.4} r={2.4} fill={color} />
        </G>
      )}

      {/* Held object, kept inside the panel and thick enough to survive the
          scale — a hairline staff reads as an antenna. */}
      {kind === "K" && (
        <G transform="rotate(-14 32 20)">
          <Rect x={30.8} y={5} width={2.6} height={24} rx={1} fill={color} />
          <Rect x={27.6} y={24.4} width={9} height={2.6} rx={1} fill={color} />
        </G>
      )}
      {kind === "Q" && (
        <G transform="rotate(13 32 20)">
          <Rect x={31} y={12} width={2.2} height={18} rx={1} fill={color} />
          <Circle cx={32.1} cy={9.4} r={3.3} fill={color} />
          <Circle cx={32.1} cy={9.4} r={1.3} fill={paper} />
        </G>
      )}
      {kind === "J" && (
        <G transform="rotate(-12 32 20)">
          <Rect x={31} y={7} width={2.2} height={23} rx={1} fill={color} />
          <Path d="M27.6,6.6 L36.4,5.6 L37.6,10.6 L32.1,13.2 L28.8,10.6 Z" fill={color} />
        </G>
      )}
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
  suit,
  w,
  h,
}: {
  kind: FigureKind;
  color: string;
  suit: Suit | null;
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
        <CourtHalf kind={kind} color={color} paper={Colors.cardPaper} suit={suit} />
        <G transform={`rotate(180 ${PANEL_BOX_W / 2} ${boxH / 2})`}>
          <CourtHalf kind={kind} color={color} paper={Colors.cardPaper} suit={suit} />
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
  const indexSuitSize = h * INDEX_SUIT_SIZE;
  const indexX = w * INDEX_X;
  const indexY = h * INDEX_SUIT_Y;

  let centre: React.ReactNode = null;
  if (card.isJoker) {
    centre = compact ? null : (
      <CourtPanel
        kind={card.rank === "joker_colored" ? "joker_colored" : "joker_bw"}
        color={color}
        suit={null}
        w={w}
        h={h}
      />
    );
  } else if (suit) {
    if (compact) {
      centre = <SuitMark suit={suit} x={w * 0.58} y={h * 0.62} size={h * 0.24} color={color} />;
    } else if (COURT_RANKS.has(card.rank)) {
      centre = <CourtPanel kind={card.rank as FigureKind} color={color} suit={suit} w={w} h={h} />;
    } else if (card.rank === "A") {
      centre = <SuitMark suit={suit} x={w * 0.5} y={h * 0.5} size={h * ACE_PIP_SIZE} color={color} />;
    } else {
      const spots = PIP_LAYOUTS[card.rank] ?? [];
      const size = h * PIP_SIZE * (spots.length > 6 ? 0.9 : 1);
      centre = spots.map((spot, i) => (
        <SuitMark
          key={i}
          suit={suit}
          x={w * PIP_COL[spot.col]}
          y={h * (PIP_TOP + spot.row * (PIP_BOTTOM - PIP_TOP))}
          size={size}
          color={color}
          flipped={spot.row > 0.5}
        />
      ));
    }
  }

  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      {centre}
      {suit && (
        <>
          <SuitMark suit={suit} x={indexX} y={indexY} size={indexSuitSize} color={color} />
          <SuitMark suit={suit} x={w - indexX} y={h - indexY} size={indexSuitSize} color={color} flipped />
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

// ─── Card back ────────────────────────────────────────────────────────────────
//
// A fine 45° lattice reads as texture at any size where a dot grid reads as
// blobs, because a line keeps its identity when it falls below a pixel and a
// dot does not. The whole thing is two Paths and a medallion.

const LATTICE_SPACING = 7;

const latticeCache = new Map<string, string>();
function getLattice(w: number, h: number): string {
  const key = `${w}x${h}`;
  let d = latticeCache.get(key);
  if (!d) {
    const span = w + h;
    const parts: string[] = [];
    for (let i = -h; i < span; i += LATTICE_SPACING) {
      parts.push(`M${i},0 L${i + h},${h}`);
      parts.push(`M${i},${h} L${i + h},0`);
    }
    d = parts.join(" ");
    latticeCache.set(key, d);
  }
  return d;
}

function OrnateCardBack({ width: w, height: h }: { width: number; height: number }) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.19;

  // An eight-point star: two squares, one rotated 45°, drawn as one polygon.
  const points: string[] = [];
  for (let i = 0; i < 16; i++) {
    const rad = (Math.PI * 2 * i) / 16 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.46;
    points.push(`${(cx + Math.cos(rad) * rr).toFixed(2)},${(cy + Math.sin(rad) * rr).toFixed(2)}`);
  }

  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={getLattice(w, h)} stroke={Colors.gold} strokeOpacity={0.13} strokeWidth={0.6} fill="none" />
      <Rect x={2.5} y={2.5} width={w - 5} height={h - 5} rx={5} ry={5}
        fill="none" stroke={Colors.gold} strokeWidth={1.4} strokeOpacity={0.85} />
      <Rect x={5.5} y={5.5} width={w - 11} height={h - 11} rx={3} ry={3}
        fill="none" stroke={Colors.gold} strokeWidth={0.7} strokeOpacity={0.35} />
      <Path d={`M${points.join(" L")} Z`} fill={Colors.gold} fillOpacity={0.55} />
      <Circle cx={cx} cy={cy} r={r * 0.42} fill={FeltGradient[4]} />
      <Circle cx={cx} cy={cy} r={r * 0.42} fill="none" stroke={Colors.gold} strokeOpacity={0.7} strokeWidth={0.8} />
    </Svg>
  );
}

// ─── CardView ─────────────────────────────────────────────────────────────────

interface CardViewProps {
  card: Card;
  selected?: boolean;
  onPress?: () => void;
  small?: boolean;
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

export function CardView({
  card,
  selected = false,
  onPress,
  small = false,
  faceDown = false,
  disabled = false,
  style,
  noLift = false,
  decorative = false,
}: CardViewProps) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- translateY is a stable shared value
  }, [selected, noLift, reduceMotion]);

  useEffect(
    () => () => {
      cancelAnimation(translateY);
      cancelAnimation(press);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only; both are stable shared values
    []
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value + press.value * -3 },
      { rotate: `${press.value * -1.5}deg` },
    ],
  }));

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

  const w = small ? CARD_W_SMALL : CARD_W;
  const h = small ? CARD_H_SMALL : CARD_H;

  if (faceDown) {
    return (
      <Animated.View style={[animStyle, style]}>
        <View style={[styles.card, small ? styles.cardSmall : styles.cardNormal, styles.cardBack]}>
          <LinearGradient
            colors={[FeltGradient[1], FeltGradient[2], FeltGradient[4]]}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <OrnateCardBack width={w} height={h} />
        </View>
      </Animated.View>
    );
  }

  const rankText = card.isJoker ? "JK" : getCardDisplayRank(card.rank);
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
        accessibilityElementsHidden={decorative}
        importantForAccessibility={decorative ? "no-hide-descendants" : "auto"}
        accessibilityLabel={decorative ? undefined : cardSpokenName(card, t)}
        accessibilityRole={decorative ? undefined : "button"}
        accessibilityHint={
          decorative || !selected ? undefined : t("cardView.selectedA11yHint")
        }
        style={[
          styles.card,
          small ? styles.cardSmall : styles.cardNormal,
          selected && styles.cardSelected,
        ]}
      >
        <LinearGradient
          colors={CardFaceGradient}
          locations={[0, 0.55, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <CardFaceArt card={card} color={color} w={w} h={h} compact={small} />
        <Text
          style={[
            styles.rankText,
            small ? styles.rankTextSmall : styles.rankTextNormal,
            card.isJoker && styles.rankTextJoker,
            { color },
          ]}
        >
          {rankText}
        </Text>
        <Text
          style={[
            styles.rankText,
            small ? styles.rankTextSmall : styles.rankTextNormal,
            card.isJoker && styles.rankTextJoker,
            small ? styles.rankTextBottomSmall : styles.rankTextBottom,
            { color },
          ]}
        >
          {rankText}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardPaper,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.cardEdge,
    overflow: "hidden",
    ...Shadow.card,
  },
  cardNormal: {
    width: CARD_W,
    height: CARD_H,
  },
  cardSmall: {
    width: CARD_W_SMALL,
    height: CARD_H_SMALL,
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
  rankText: {
    position: "absolute",
    fontFamily: "Rajdhani_700Bold",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  rankTextNormal: {
    fontSize: 15,
    lineHeight: 15,
    top: 3,
    left: 0,
    width: CARD_W * INDEX_X * 2,
  },
  rankTextSmall: {
    fontSize: 11,
    lineHeight: 11,
    top: 2,
    left: 0,
    width: CARD_W_SMALL * INDEX_X * 2,
  },
  rankTextJoker: {
    fontSize: 11,
    lineHeight: 12,
  },
  rankTextBottom: {
    top: undefined,
    left: undefined,
    bottom: 3,
    right: 0,
    transform: [{ rotate: "180deg" }],
  },
  rankTextBottomSmall: {
    top: undefined,
    left: undefined,
    bottom: 2,
    right: 0,
    transform: [{ rotate: "180deg" }],
  },
});
