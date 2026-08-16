import React, { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Card, Suit, isRedSuit, getCardDisplayRank, getSuitSymbol } from "@/lib/gameEngine";
import { Colors } from '@/lib/theme';
import { Shadow } from "@/lib/theme";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import Svg, { Path, Circle, G, Rect, Polygon } from "react-native-svg";

const FACE_RANKS = new Set(["J", "Q", "K"]);

// Suit → colour. `Suit` is plural ("spades") while the theme tokens are singular
// ("spade"), so the mapping has to be explicit. Typed as Record<Suit, string> so
// the compiler catches a missing or misspelled suit instead of silently
// yielding undefined (which is what the previous keyof-cast lookup did).
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
const FACE_FIGURE_SIZE = 32;
// Neutral engraving ink for the black/white joker (has no suit colour of its own).
// No Colors entry matches this dark slate — left inline.
const INK = "#26323C";
// Face-card border ring. 0.45 is closest to the new Colors.goldStrong (0.5,
// a 0.05 shift) — was hand-picked before that step existed.
const CARD_FACE_BORDER = Colors.goldStrong;

interface CardViewProps {
  card: Card;
  selected?: boolean;
  onPress?: () => void;
  small?: boolean;
  faceDown?: boolean;
  disabled?: boolean;
  style?: object;
  noLift?: boolean;
}

// ─── Ornate SVG card back ─────────────────────────────────────────────────────
//
// The diamond dot grid depends only on (width, height), and in practice only
// two sizes ever occur (CARD_W/CARD_H and CARD_W_SMALL/CARD_H_SMALL — see
// below). React Compiler already memoizes this per component instance keyed
// on (w, h) (verified by compiling this file through the same babel-preset-
// expo + react-compiler pipeline Metro uses), but that cache lives on each
// mounted OrnateCardBack's own fiber, so every face-down card on screen still
// pays for the grid once on its own first render, with its own array. A
// hand can show many face-down opponent cards at once, so a true module-level
// cache — computed once, ever, and shared by reference — is a strict
// improvement over the compiler's per-instance memo, not a fight against it.
const dotGridCache = new Map<string, { x: number; y: number }[]>();
function getDotGrid(w: number, h: number): { x: number; y: number }[] {
  const key = `${w}x${h}`;
  let grid = dotGridCache.get(key);
  if (!grid) {
    const spacing = 9;
    const padX = 8;
    const padY = 10;
    grid = [];
    for (let x = padX; x <= w - padX; x += spacing) {
      for (let y = padY; y <= h - padY; y += spacing) {
        grid.push({ x, y });
      }
    }
    dotGridCache.set(key, grid);
  }
  return grid;
}

function OrnateCardBack({ width, height }: { width: number; height: number }) {
  const w = width;
  const h = height;
  const dots = getDotGrid(w, h);

  const cx = w / 2;
  const cy = h / 2;

  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      {/* Outer gold border */}
      <Rect x={2} y={2} width={w - 4} height={h - 4} rx={6} ry={6}
        fill="none" stroke={Colors.gold} strokeWidth={1.5} strokeOpacity={0.82} />
      {/* Inner border */}
      <Rect x={5.5} y={5.5} width={w - 11} height={h - 11} rx={3.5} ry={3.5}
        fill="none" stroke={Colors.gold} strokeWidth={0.75} strokeOpacity={0.38} />
      {/* Diamond dot grid */}
      {dots.map((d, i) => (
        <Polygon
          key={i}
          points={`${d.x},${d.y - 2.5} ${d.x + 1.8},${d.y} ${d.x},${d.y + 2.5} ${d.x - 1.8},${d.y}`}
          fill={Colors.gold}
          fillOpacity={0.22}
        />
      ))}
      {/* Central diamond outer ring */}
      <Polygon
        points={`${cx},${cy - 11} ${cx + 8},${cy} ${cx},${cy + 11} ${cx - 8},${cy}`}
        fill="none"
        stroke={Colors.gold}
        strokeWidth={0.8}
        strokeOpacity={0.45}
      />
      {/* Central diamond fill */}
      <Polygon
        points={`${cx},${cy - 7} ${cx + 5},${cy} ${cx},${cy + 7} ${cx - 5},${cy}`}
        fill={Colors.gold}
        fillOpacity={0.65}
      />
    </Svg>
  );
}

// ─── Engraved court figures (J, Q, K, and both jokers) ────────────────────────
//
// Traditional court cards are built from a single figure duplicated with a
// true 180° rotation (not a mirror reflection) so the card reads right-side-up
// from either end. We draw one "half" — bust, headwear, held object — inside
// a 60×60 viewBox whose vertical centre (y=30) is the rotation axis, then
// render it twice: once as-is, once rotated 180° about (30,30).
//
// The four kinds share one silhouette family (bust + collar) and differ only
// in headwear + held object, so the deck reads as one coherent set:
//   K            — three-point crown, sword
//   Q            — arched tiara + bloom, flower sceptre
//   J            — soft lopsided cap + feather, halberd
//   joker_colored (Red Joker, strongest card in the game) — reuses the King's
//                   crown (it outranks the King) + a star-tipped marotte
//   joker_bw      (Black Joker, second-strongest) — reuses the Jack's cap
//                   + a plain-bauble marotte
type FigureKind = "J" | "Q" | "K" | "joker_colored" | "joker_bw";

function renderCourtHalf(kind: FigureKind, color: string, cream: string, keyPrefix: string) {
  const body = (
    <Path
      key={`${keyPrefix}-body`}
      d="M15,30 L15,21 Q15,16 21,15 L39,15 Q45,16 45,21 L45,30 Z"
      fill={color}
    />
  );
  const head = <Circle key={`${keyPrefix}-head`} cx={30} cy={9} r={6.5} fill={color} />;
  const collar = (
    <Path key={`${keyPrefix}-collar`} d="M21,15 L39,15" stroke={cream} strokeWidth={0.9} fill="none" />
  );

  let headwear: React.ReactNode;
  if (kind === "K" || kind === "joker_colored") {
    headwear = (
      <G key={`${keyPrefix}-crown`}>
        <Path d="M22,4 L22,2 L25,-3 L28,2 L30,-4 L32,2 L35,-3 L38,2 L38,4 Z" fill={color} />
        <Circle cx={25} cy={-2} r={0.8} fill={cream} />
        <Circle cx={30} cy={-3} r={0.8} fill={cream} />
        <Circle cx={35} cy={-2} r={0.8} fill={cream} />
      </G>
    );
  } else if (kind === "Q") {
    headwear = (
      <G key={`${keyPrefix}-tiara`}>
        <Path d="M23,4 L23,2 Q30,-2 37,2 L37,4 Z" fill={color} />
        <Circle cx={26.5} cy={-1.5} r={1.4} fill={color} />
        <Circle cx={33.5} cy={-1.5} r={1.4} fill={color} />
        <Circle cx={30} cy={-3.5} r={2.2} fill={color} />
        <Circle cx={30} cy={-3.5} r={0.8} fill={cream} />
      </G>
    );
  } else {
    // J, joker_bw
    headwear = (
      <G key={`${keyPrefix}-cap`}>
        <Path d="M22,4 Q21,-1 28,-3 Q36,-4 38,2 L38,4 Z" fill={color} />
        {kind === "J" && <Path d="M35,-3 L41,-6 L37,0 Z" fill={color} />}
      </G>
    );
  }

  let accessory: React.ReactNode;
  if (kind === "K") {
    accessory = (
      <G key={`${keyPrefix}-sword`} transform="rotate(-18 46 17)">
        <Rect x={45} y={2} width={2} height={24} rx={0.5} fill={color} />
        <Rect x={41} y={23} width={10} height={2} rx={0.5} fill={color} />
        <Circle cx={46} cy={27} r={1.6} fill={color} />
      </G>
    );
  } else if (kind === "Q") {
    accessory = (
      <G key={`${keyPrefix}-scepter`} transform="rotate(12 46 17)">
        <Rect x={45.3} y={6} width={1.4} height={22} rx={0.5} fill={color} />
        <Circle cx={46} cy={5} r={3} fill={color} />
        <Circle cx={46} cy={5} r={1.1} fill={cream} />
      </G>
    );
  } else if (kind === "J") {
    accessory = (
      <G key={`${keyPrefix}-halberd`} transform="rotate(-12 46 17)">
        <Rect x={45.3} y={1} width={1.4} height={27} rx={0.5} fill={color} />
        <Path d="M41,1 L50,1 L52,6 L46,9 L43,6 Z" fill={color} />
      </G>
    );
  } else if (kind === "joker_colored") {
    accessory = (
      <G key={`${keyPrefix}-marotte`} transform="rotate(14 46 17)">
        <Rect x={45.3} y={6} width={1.4} height={22} rx={0.5} fill={color} />
        <Polygon
          points="46,1.5 47.2,4.4 50.3,4.6 47.9,6.6 48.7,9.6 46,7.9 43.3,9.6 44.1,6.6 41.7,4.6 44.8,4.4"
          fill={color}
        />
      </G>
    );
  } else {
    accessory = (
      <G key={`${keyPrefix}-marotte-bw`} transform="rotate(14 46 17)">
        <Rect x={45.3} y={6} width={1.4} height={22} rx={0.5} fill={color} />
        <Circle cx={46} cy={5} r={2.6} fill={color} />
        <Circle cx={46} cy={5} r={1} fill={cream} />
      </G>
    );
  }

  return (
    <React.Fragment key={keyPrefix}>
      {body}
      {head}
      {collar}
      {headwear}
      {accessory}
    </React.Fragment>
  );
}

function CourtFigure({ kind, color, size }: { kind: FigureKind; color: string; size: number }) {
  const cream = Colors.cardBg;
  return (
    <Svg width={size} height={size} viewBox="0 0 60 60">
      <G>{renderCourtHalf(kind, color, cream, "top")}</G>
      <G transform="rotate(180 30 30)">{renderCourtHalf(kind, color, cream, "bot")}</G>
    </Svg>
  );
}

// ─── CardView ─────────────────────────────────────────────────────────────────

export function CardView({
  card,
  selected = false,
  onPress,
  small = false,
  faceDown = false,
  disabled = false,
  style,
  noLift = false,
}: CardViewProps) {
  const { t } = useTranslation();
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (noLift) {
      translateY.value = 0;
      return;
    }
    translateY.value = withSpring(selected ? -14 : 0, {
      damping: 15,
      stiffness: 300,
    });
  }, [selected, noLift]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const handlePress = () => {
    if (disabled || !onPress) return;
    onPress();
  };

  if (faceDown) {
    const w = small ? CARD_W_SMALL : CARD_W;
    const h = small ? CARD_H_SMALL : CARD_H;
    return (
      <Animated.View style={[animStyle, style]}>
        <View style={[styles.card, small ? styles.cardSmall : styles.cardNormal, styles.cardBack]}>
          <OrnateCardBack width={w} height={h} />
        </View>
      </Animated.View>
    );
  }

  if (card.isJoker) {
    const kind: FigureKind = card.rank === "joker_colored" ? "joker_colored" : "joker_bw";
    const jokerColor = kind === "joker_colored" ? Colors.danger : INK;

    return (
      <Animated.View style={[animStyle, style]}>
        <Pressable
          onPress={handlePress}
          disabled={disabled || !onPress}
          style={[
            styles.card,
            small ? styles.cardSmall : styles.cardNormal,
            selected && styles.cardSelected,
          ]}
        >
          {small ? (
            <View style={styles.jokerSmall}>
              <Text style={[styles.jokerSmallRank, { color: jokerColor }]}>J</Text>
              <Text style={[styles.jokerSmallSuit, { color: jokerColor }]}>
                {kind === "joker_colored" ? "★" : "☆"}
              </Text>
            </View>
          ) : (
            <View style={styles.jokerFull}>
              <Text style={[styles.jokerTopLabel, { color: jokerColor }]}>
                {kind === "joker_colored" ? "★" : "☆"}
              </Text>
              <View style={styles.courtFigureContainer}>
                <CourtFigure kind={kind} color={jokerColor} size={FACE_FIGURE_SIZE} />
              </View>
              <Text style={[styles.jokerBottomLabel, { color: jokerColor }]}>
                JKR
              </Text>
            </View>
          )}
        </Pressable>
      </Animated.View>
    );
  }

  const rankText = getCardDisplayRank(card.rank);
  const suitSymbol = getSuitSymbol(card.suit);
  const color = card.suit ? SUIT_COLORS[card.suit] : Colors.spade;
  const isFaceCard = FACE_RANKS.has(card.rank);

  const getSuitName = (suit: string | null) => {
    const key: TranslationKey | null =
      suit === "hearts" ? "cards.suitHearts"
      : suit === "diamonds" ? "cards.suitDiamonds"
      : suit === "clubs" ? "cards.suitClubs"
      : suit === "spades" ? "cards.suitSpades"
      : null;
    return key ? t(key) : "";
  };

  const getCardLabel = () => {
    if (card.isJoker) return t(card.rank === "joker_colored" ? "cardView.jokerColored" : "cardView.jokerBlack");
    return t("cards.nameFormat", { rank: rankText, suit: getSuitName(card.suit) });
  };

  return (
    <Animated.View style={[animStyle, style]}>
      <Pressable
        onPress={handlePress}
        disabled={disabled || !onPress}
        accessibilityLabel={getCardLabel()}
        accessibilityRole="button"
        accessibilityHint={selected ? t("cardView.selectedA11yHint") : undefined}
        style={[
          styles.card,
          small ? styles.cardSmall : styles.cardNormal,
          isFaceCard && styles.cardFace,
          selected && styles.cardSelected,
        ]}
      >
        <View style={[styles.cardInner, selected && styles.cardInnerSelected]}>
          <View style={styles.topCorner}>
            <Text style={[styles.rankText, small ? styles.rankTextSmall : styles.rankTextNormal, { color }]}>
              {rankText}
            </Text>
            <Text style={[styles.suitCorner, small && styles.suitCornerSmall, { color }]}>
              {suitSymbol}
            </Text>
          </View>
          {!small && (
            isFaceCard ? (
              <View style={styles.courtFigureContainer}>
                <CourtFigure kind={card.rank as FigureKind} color={color} size={FACE_FIGURE_SIZE} />
              </View>
            ) : (
              <Text style={[styles.suitCenter, { color }]}>
                {suitSymbol}
              </Text>
            )
          )}
          <View style={styles.bottomCorner}>
            <Text style={[styles.rankText, small ? styles.rankTextSmall : styles.rankTextNormal, { color, transform: [{ rotate: "180deg" }] }]}>
              {rankText}
            </Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 8,
    borderWidth: 1,
    // Plain black hairline, no Colors black-alpha entry to match — left inline.
    borderColor: "rgba(0,0,0,0.1)",
    overflow: "hidden",
    ...Shadow.dark,
  },
  cardNormal: {
    width: CARD_W,
    height: CARD_H,
  },
  cardSmall: {
    width: CARD_W_SMALL,
    height: CARD_H_SMALL,
  },
  cardFace: {
    borderColor: CARD_FACE_BORDER,
    borderWidth: 1.5,
  },
  cardSelected: Platform.OS === "web"
    ? ({
        borderColor: Colors.gold,
        borderWidth: 2,
        ...Shadow.gold,
      } as any)
    : {
        borderColor: Colors.gold,
        borderWidth: 2,
        ...Shadow.gold,
      },
  cardInner: {
    flex: 1,
    padding: 4,
    justifyContent: "space-between",
  },
  cardInnerSelected: {},
  cardBack: {
    backgroundColor: Colors.felt,
    borderColor: Colors.goldDark,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  topCorner: {
    alignItems: "flex-start",
  },
  bottomCorner: {
    alignItems: "flex-end",
  },
  rankText: {
    fontFamily: "Inter_600SemiBold",
    lineHeight: 16,
  },
  rankTextNormal: {
    fontSize: 15,
  },
  rankTextSmall: {
    fontSize: 11,
  },
  suitCorner: {
    fontSize: 11,
    lineHeight: 13,
  },
  suitCornerSmall: {
    fontSize: 8,
  },
  suitCenter: {
    fontSize: 30,
    textAlign: "center",
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    lineHeight: 34,
  },
  courtFigureContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 2,
  },
  jokerFull: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 3,
  },
  jokerTopLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
  jokerBottomLabel: {
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    transform: [{ rotate: "180deg" }],
  },
  jokerSmall: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  jokerSmallRank: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    lineHeight: 14,
  },
  jokerSmallSuit: {
    fontSize: 12,
    lineHeight: 14,
  },
});
