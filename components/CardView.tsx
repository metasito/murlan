import React from "react";
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

interface CardViewProps {
  card: Card;
  selected?: boolean;
  onPress?: () => void;
  small?: boolean;
  faceDown?: boolean;
  disabled?: boolean;
}

export function CardView({
  card,
  selected = false,
  onPress,
  small = false,
  faceDown = false,
  disabled = false,
}: CardViewProps) {
  const translateY = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const handlePress = () => {
    if (disabled || !onPress) return;
    translateY.value = withSpring(selected ? 0 : -12, {
      damping: 15,
      stiffness: 300,
    });
    onPress();
  };

  React.useEffect(() => {
    translateY.value = withSpring(selected ? -12 : 0, {
      damping: 15,
      stiffness: 300,
    });
  }, [selected]);

  if (faceDown) {
    return (
      <Animated.View style={[animStyle]}>
        <View
          style={[
            styles.card,
            small ? styles.cardSmall : styles.cardNormal,
            styles.cardBack,
          ]}
        >
          <View style={styles.backPattern}>
            <View style={styles.backInner} />
          </View>
        </View>
      </Animated.View>
    );
  }

  const red = card.isJoker ? true : isRedSuit(card.suit);
  const rankText = getCardDisplayRank(card.rank);
  const suitSymbol = card.isJoker ? "★" : getSuitSymbol(card.suit);
  const color = red ? Colors.red : "#1A1A2E";

  return (
    <Animated.View style={animStyle}>
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
          {card.isJoker ? (
            <View style={styles.jokerContent}>
              <Text
                style={[
                  styles.jokerText,
                  small && styles.jokerTextSmall,
                  { color: card.rank === "joker_colored" ? "#E63946" : "#333" },
                ]}
              >
                JKR
              </Text>
              <Text
                style={[
                  styles.jokerStar,
                  small && styles.jokerStarSmall,
                  { color: card.rank === "joker_colored" ? "#E63946" : "#555" },
                ]}
              >
                ★
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.topCorner}>
                <Text
                  style={[
                    styles.rankText,
                    small ? styles.rankTextSmall : styles.rankTextNormal,
                    { color },
                  ]}
                >
                  {rankText}
                </Text>
                <Text
                  style={[
                    styles.suitSmall,
                    small && styles.suitSmallTiny,
                    { color },
                  ]}
                >
                  {suitSymbol}
                </Text>
              </View>
              {!small && (
                <Text style={[styles.suitCenter, { color }]}>
                  {suitSymbol}
                </Text>
              )}
              <View style={styles.bottomCorner}>
                <Text
                  style={[
                    styles.rankText,
                    small ? styles.rankTextSmall : styles.rankTextNormal,
                    { color, transform: [{ rotate: "180deg" }] },
                  ]}
                >
                  {rankText}
                </Text>
              </View>
            </>
          )}
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
    borderColor: "rgba(0,0,0,0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  cardNormal: {
    width: 58,
    height: 84,
  },
  cardSmall: {
    width: 38,
    height: 54,
  },
  cardSelected: {
    borderColor: Colors.gold,
    borderWidth: 2,
    shadowColor: Colors.gold,
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  cardInner: {
    flex: 1,
    padding: 4,
    justifyContent: "space-between",
  },
  cardInnerSelected: {
    backgroundColor: "rgba(201,168,76,0.05)",
  },
  cardBack: {
    backgroundColor: Colors.felt,
    borderColor: Colors.goldDark,
    borderWidth: 1.5,
  },
  backPattern: {
    flex: 1,
    margin: 3,
    borderRadius: 5,
    backgroundColor: Colors.feltLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.goldDark,
  },
  backInner: {
    width: "70%",
    height: "70%",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.gold,
    backgroundColor: Colors.felt,
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
  suitSmall: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
  },
  suitSmallTiny: {
    fontSize: 7,
  },
  suitCenter: {
    fontSize: 28,
    textAlign: "center",
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
  },
  jokerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  jokerText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  jokerTextSmall: {
    fontSize: 8,
  },
  jokerStar: {
    fontSize: 16,
  },
  jokerStarSmall: {
    fontSize: 10,
  },
});
