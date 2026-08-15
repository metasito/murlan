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
import Svg, { Path, Circle, Ellipse, G, Rect, Polygon, Text as SvgText, Defs, ClipPath } from "react-native-svg";

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

function OrnateCardBack({ width, height }: { width: number; height: number }) {
  const w = width;
  const h = height;
  const spacing = 9;
  const padX = 8;
  const padY = 10;

  const dots: Array<{ x: number; y: number }> = [];
  for (let x = padX; x <= w - padX; x += spacing) {
    for (let y = padY; y <= h - padY; y += spacing) {
      dots.push({ x, y });
    }
  }

  const cx = w / 2;
  const cy = h / 2;

  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      {/* Outer gold border */}
      <Rect x={2} y={2} width={w - 4} height={h - 4} rx={6} ry={6}
        fill="none" stroke="#C9A84C" strokeWidth={1.5} strokeOpacity={0.82} />
      {/* Inner border */}
      <Rect x={5.5} y={5.5} width={w - 11} height={h - 11} rx={3.5} ry={3.5}
        fill="none" stroke="#C9A84C" strokeWidth={0.75} strokeOpacity={0.38} />
      {/* Diamond dot grid */}
      {dots.map((d, i) => (
        <Polygon
          key={i}
          points={`${d.x},${d.y - 2.5} ${d.x + 1.8},${d.y} ${d.x},${d.y + 2.5} ${d.x - 1.8},${d.y}`}
          fill="#C9A84C"
          fillOpacity={0.22}
        />
      ))}
      {/* Central diamond outer ring */}
      <Polygon
        points={`${cx},${cy - 11} ${cx + 8},${cy} ${cx},${cy + 11} ${cx - 8},${cy}`}
        fill="none"
        stroke="#C9A84C"
        strokeWidth={0.8}
        strokeOpacity={0.45}
      />
      {/* Central diamond fill */}
      <Polygon
        points={`${cx},${cy - 7} ${cx + 5},${cy} ${cx},${cy + 7} ${cx - 5},${cy}`}
        fill="#C9A84C"
        fillOpacity={0.65}
      />
    </Svg>
  );
}

// ─── Joker figure ─────────────────────────────────────────────────────────────

function JokerFigure({ colored, size }: { colored: boolean; size: number }) {
  const s = size;
  const primaryColor = colored ? "#C0392B" : "#2C3E50";
  const accentColor = colored ? "#E74C3C" : "#555";
  const hatColor = colored ? "#C0392B" : "#333";
  const skinColor = "#F0D09C";

  return (
    <Svg width={s} height={s * 1.3} viewBox="0 0 60 80">
      <Path d="M30 5 L20 28 L40 28 Z" fill={hatColor} />
      <Path d="M20 28 L10 18 L22 30 Z" fill={primaryColor} />
      <Path d="M40 28 L50 18 L38 30 Z" fill={primaryColor} />
      <Circle cx="10" cy="17" r="3" fill={accentColor} />
      <Circle cx="50" cy="17" r="3" fill={accentColor} />
      <Circle cx="30" cy="4" r="3" fill={accentColor} />
      <Ellipse cx="30" cy="36" rx="10" ry="11" fill={skinColor} />
      <Circle cx="26" cy="34" r="2" fill="#333" />
      <Circle cx="34" cy="34" r="2" fill="#333" />
      <Circle cx="26.7" cy="33.3" r="0.7" fill="white" />
      <Circle cx="34.7" cy="33.3" r="0.7" fill="white" />
      <Path d="M24 40 Q30 46 36 40" stroke="#C0392B" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <Path d="M20 46 Q25 44 30 47 Q35 44 40 46 L38 52 L22 52 Z" fill={primaryColor} />
      <Polygon points="25,47 28,44 31,47 28,50" fill={accentColor} />
      <Polygon points="29,47 32,44 35,47 32,50" fill={hatColor} />
      <Rect x="22" y="52" width="16" height="20" rx="2" fill={primaryColor} />
      <Path d="M22 57 L38 57" stroke={accentColor} strokeWidth="0.8" />
      <Path d="M22 63 L38 63" stroke={accentColor} strokeWidth="0.8" />
      <Path d="M30 52 L30 72" stroke={accentColor} strokeWidth="0.8" />
      <Path d="M22 55 L10 48" stroke={skinColor} strokeWidth="4" strokeLinecap="round" />
      <Path d="M38 55 L50 48" stroke={skinColor} strokeWidth="4" strokeLinecap="round" />
      <Rect x="5" y="44" width="8" height="10" rx="1" fill="white" stroke={primaryColor} strokeWidth="0.5" />
      <Text style={{ fontSize: 5 }}>
        <SvgText x="7" y="52" fontSize="6" fill={colored ? "#C0392B" : "#333"} fontWeight="bold">♦</SvgText>
      </Text>
      <Rect x="47" y="44" width="8" height="10" rx="1" fill="white" stroke={primaryColor} strokeWidth="0.5" />
      <SvgText x="49" y="52" fontSize="6" fill={colored ? "#C0392B" : "#333"} fontWeight="bold">♠</SvgText>
      <Path d="M24 72 L20 80" stroke={hatColor} strokeWidth="4" strokeLinecap="round" />
      <Path d="M36 72 L40 80" stroke={hatColor} strokeWidth="4" strokeLinecap="round" />
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
    const w = small ? 40 : 58;
    const h = small ? 58 : 84;
    return (
      <Animated.View style={[animStyle, style]}>
        <View style={[styles.card, small ? styles.cardSmall : styles.cardNormal, styles.cardBack]}>
          <OrnateCardBack width={w} height={h} />
        </View>
      </Animated.View>
    );
  }

  if (card.isJoker) {
    const colored = card.rank === "joker_colored";
    const titleColor = colored ? "#C0392B" : "#2C3E50";
    const bgColor = colored ? "#FFF8F0" : "#F4F4F4";

    return (
      <Animated.View style={[animStyle, style]}>
        <Pressable
          onPress={handlePress}
          disabled={disabled || !onPress}
          style={[
            styles.card,
            small ? styles.cardSmall : styles.cardNormal,
            { backgroundColor: bgColor },
            selected && styles.cardSelected,
          ]}
        >
          {small ? (
            <View style={styles.jokerSmall}>
              <Text style={[styles.jokerSmallRank, { color: titleColor }]}>J</Text>
              <Text style={[styles.jokerSmallSuit, { color: titleColor }]}>★</Text>
            </View>
          ) : (
            <View style={styles.jokerFull}>
              <Text style={[styles.jokerTopLabel, { color: titleColor }]}>
                {colored ? "★" : "☆"}
              </Text>
              <View style={styles.jokerFigureContainer}>
                <JokerFigure colored={colored} size={36} />
              </View>
              <Text style={[styles.jokerBottomLabel, { color: titleColor }]}>
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
    switch (suit) {
      case "hearts": return "Cuori";
      case "diamonds": return "Quadri";
      case "clubs": return "Fiori";
      case "spades": return "Picche";
      default: return "";
    }
  };

  const getCardLabel = () => {
    if (card.isJoker) return `Joker ${card.rank === "joker_colored" ? "colorato" : "nero"}`;
    return `${rankText} di ${getSuitName(card.suit)}`;
  };

  return (
    <Animated.View style={[animStyle, style]}>
      <Pressable
        onPress={handlePress}
        disabled={disabled || !onPress}
        accessibilityLabel={getCardLabel()}
        accessibilityRole="button"
        accessibilityHint={selected ? "Selezionata" : undefined}
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
            <Text
              style={[
                styles.suitCenter,
                { color },
                Platform.OS !== "web" && {
                  textShadowColor: color,
                  textShadowOffset: { width: 0, height: 0 },
                  textShadowRadius: 6,
                },
              ]}
            >
              {suitSymbol}
            </Text>
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
    backgroundColor: "#FAFAF8",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
    overflow: "hidden",
    ...Shadow.dark,
  },
  cardNormal: {
    width: 58,
    height: 84,
  },
  cardSmall: {
    width: 40,
    height: 58,
  },
  cardFace: {
    borderColor: "rgba(201,168,76,0.45)",
    borderWidth: 1.5,
  },
  cardSelected: Platform.OS === "web"
    ? ({
        borderColor: "#C9A84C",
        borderWidth: 2,
        boxShadow: "0 0 0 1px #C9A84C, 0 0 14px rgba(201,168,76,0.55)",
      } as any)
    : {
        borderColor: "#C9A84C",
        borderWidth: 2,
        shadowColor: "#C9A84C",
        shadowOpacity: 0.55,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 0 },
        elevation: 8,
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
    fontFamily: "Rajdhani_700Bold",
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
  jokerFull: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 3,
  },
  jokerTopLabel: {
    fontSize: 13,
    fontFamily: "Rajdhani_700Bold",
    letterSpacing: 0.5,
  },
  jokerFigureContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 2,
  },
  jokerBottomLabel: {
    fontSize: 9,
    fontFamily: "Rajdhani_700Bold",
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
    fontFamily: "Rajdhani_700Bold",
    fontSize: 12,
    lineHeight: 14,
  },
  jokerSmallSuit: {
    fontSize: 12,
    lineHeight: 14,
  },
});
