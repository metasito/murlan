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
import { Card, isRedSuit, getCardDisplayRank, getSuitSymbol } from "@/lib/gameEngine";
import Colors from "@/constants/colors";
import Svg, { Path, Circle, Ellipse, G, Rect, Polygon, Text as SvgText } from "react-native-svg";

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

function JokerFigure({ colored, size }: { colored: boolean; size: number }) {
  const s = size;
  const primaryColor = colored ? "#C0392B" : "#2C3E50";
  const accentColor = colored ? "#E74C3C" : "#555";
  const hatColor = colored ? "#C0392B" : "#333";
  const skinColor = "#F0D09C";

  return (
    <Svg width={s} height={s * 1.3} viewBox="0 0 60 80">
      {/* Hat with bells */}
      <Path d="M30 5 L20 28 L40 28 Z" fill={hatColor} />
      <Path d="M20 28 L10 18 L22 30 Z" fill={primaryColor} />
      <Path d="M40 28 L50 18 L38 30 Z" fill={primaryColor} />
      <Circle cx="10" cy="17" r="3" fill={accentColor} />
      <Circle cx="50" cy="17" r="3" fill={accentColor} />
      <Circle cx="30" cy="4" r="3" fill={accentColor} />

      {/* Face */}
      <Ellipse cx="30" cy="36" rx="10" ry="11" fill={skinColor} />

      {/* Eyes */}
      <Circle cx="26" cy="34" r="2" fill="#333" />
      <Circle cx="34" cy="34" r="2" fill="#333" />
      <Circle cx="26.7" cy="33.3" r="0.7" fill="white" />
      <Circle cx="34.7" cy="33.3" r="0.7" fill="white" />

      {/* Smile */}
      <Path d="M24 40 Q30 46 36 40" stroke="#C0392B" strokeWidth="1.5" fill="none" strokeLinecap="round" />

      {/* Collar */}
      <Path d="M20 46 Q25 44 30 47 Q35 44 40 46 L38 52 L22 52 Z" fill={primaryColor} />
      {/* Collar diamonds */}
      <Polygon points="25,47 28,44 31,47 28,50" fill={accentColor} />
      <Polygon points="29,47 32,44 35,47 32,50" fill={hatColor} />

      {/* Body */}
      <Rect x="22" y="52" width="16" height="20" rx="2" fill={primaryColor} />
      {/* Body pattern */}
      <Path d="M22 57 L38 57" stroke={accentColor} strokeWidth="0.8" />
      <Path d="M22 63 L38 63" stroke={accentColor} strokeWidth="0.8" />
      <Path d="M30 52 L30 72" stroke={accentColor} strokeWidth="0.8" />

      {/* Arms */}
      <Path d="M22 55 L10 48" stroke={skinColor} strokeWidth="4" strokeLinecap="round" />
      <Path d="M38 55 L50 48" stroke={skinColor} strokeWidth="4" strokeLinecap="round" />

      {/* Hands with playing cards */}
      <Rect x="5" y="44" width="8" height="10" rx="1" fill="white" stroke={primaryColor} strokeWidth="0.5" />
      <Text style={{ fontSize: 5 }}>
        <SvgText x="7" y="52" fontSize="6" fill={colored ? "#C0392B" : "#333"} fontWeight="bold">♦</SvgText>
      </Text>
      <Rect x="47" y="44" width="8" height="10" rx="1" fill="white" stroke={primaryColor} strokeWidth="0.5" />
      <SvgText x="49" y="52" fontSize="6" fill={colored ? "#C0392B" : "#333"} fontWeight="bold">♠</SvgText>

      {/* Legs */}
      <Path d="M24 72 L20 80" stroke={hatColor} strokeWidth="4" strokeLinecap="round" />
      <Path d="M36 72 L40 80" stroke={hatColor} strokeWidth="4" strokeLinecap="round" />
    </Svg>
  );
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
    return (
      <Animated.View style={[animStyle, style]}>
        <View style={[styles.card, small ? styles.cardSmall : styles.cardNormal, styles.cardBack]}>
          <View style={styles.backPattern}>
            <View style={styles.backDiamond} />
            <View style={[styles.backDiamond, { transform: [{ rotate: "45deg" }] }]} />
          </View>
          <View style={styles.backBorder} />
        </View>
      </Animated.View>
    );
  }

  if (card.isJoker) {
    const colored = card.rank === "joker_colored";
    const titleColor = colored ? "#C0392B" : "#2C3E50";
    const bgColor = colored ? "#FFF9F0" : "#F5F5F5";

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

  const red = isRedSuit(card.suit);
  const rankText = getCardDisplayRank(card.rank);
  const suitSymbol = getSuitSymbol(card.suit);
  const color = red ? "#C0392B" : "#1A1A2E";

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
            <Text style={[styles.suitCenter, { color }]}>
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  cardNormal: {
    width: 58,
    height: 84,
  },
  cardSmall: {
    width: 40,
    height: 58,
  },
  cardSelected: {
    borderColor: Colors.gold,
    borderWidth: 2.5,
    shadowColor: Colors.gold,
    shadowOpacity: 0.6,
    shadowRadius: 10,
  },
  cardInner: {
    flex: 1,
    padding: 4,
    justifyContent: "space-between",
  },
  cardInnerSelected: {
    backgroundColor: "rgba(201,168,76,0.04)",
  },
  cardBack: {
    backgroundColor: Colors.felt,
    borderColor: Colors.goldDark,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  backBorder: {
    position: "absolute",
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: Colors.gold,
  },
  backPattern: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  backDiamond: {
    position: "absolute",
    width: "85%",
    height: "85%",
    borderRadius: 2,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.25)",
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
    fontSize: 14,
  },
  rankTextSmall: {
    fontSize: 10,
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
    lineHeight: 36,
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
