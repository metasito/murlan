import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  useWindowDimensions,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from "react-native-reanimated";
import type { Card } from "@/lib/gameEngine";
import { CardView } from "@/components/CardView";
import { Colors } from '@/lib/theme';
import { Shadow } from "@/lib/theme";

const DISMISS_MS = 5500;

function getItalianCardName(card: Card): string {
  if (card.isJoker) return "Jolly";
  const rankMap: Record<string, string> = {
    A: "Asso",
    J: "Fante",
    Q: "Donna",
    K: "Re",
  };
  const suitMap: Record<string, string> = {
    hearts: "Cuori",
    diamonds: "Quadri",
    clubs: "Fiori",
    spades: "Picche",
  };
  const r = rankMap[card.rank as string] ?? String(card.rank);
  const s = card.suit ? suitMap[card.suit] : "";
  return `${r} di ${s}`;
}

function FlyingCard({
  card,
  toRight,
  delay,
  screenWidth,
  yOffset,
}: {
  card: Card;
  toRight: boolean;
  delay: number;
  screenWidth: number;
  yOffset: number;
}) {
  const tx = useSharedValue(toRight ? -80 : screenWidth + 20);

  useEffect(() => {
    tx.value = withDelay(
      delay,
      withTiming(toRight ? screenWidth + 20 : -80, { duration: 750 })
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  return (
    <Animated.View
      style={[{ position: "absolute", top: yOffset }, animStyle]}
    >
      <CardView card={card} noLift />
    </Animated.View>
  );
}

interface ExchangeAnnouncementProps {
  visible: boolean;
  winnerName: string;
  loserName: string;
  bothJokersException: boolean;
  cardGiven?: Card;
  cardReceived?: Card;
  onDismiss: () => void;
}

export function ExchangeAnnouncement({
  visible,
  winnerName,
  loserName,
  bothJokersException,
  cardGiven,
  cardReceived,
  onDismiss,
}: ExchangeAnnouncementProps) {
  const [shown, setShown] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  useEffect(() => {
    if (visible) {
      setShown(true);
      timerRef.current = setTimeout(() => {
        setShown(false);
        onDismiss();
      }, DISMISS_MS);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShown(false);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible]);

  if (!visible || !shown) return null;

  function handleDismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShown(false);
    onDismiss();
  }

  const midY = screenHeight / 2;
  const isMutual = !!(cardReceived && cardGiven);

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(300)}
      style={styles.overlay}
    >
      {cardReceived && (
        <FlyingCard
          card={cardReceived}
          toRight
          delay={200}
          screenWidth={screenWidth}
          yOffset={isMutual ? midY - 100 : midY - 42}
        />
      )}
      {cardGiven && (
        <FlyingCard
          card={cardGiven}
          toRight={false}
          delay={isMutual ? 1100 : 200}
          screenWidth={screenWidth}
          yOffset={isMutual ? midY + 16 : midY - 42}
        />
      )}

      <Pressable onPress={handleDismiss} style={styles.card}>
        <Text style={styles.title}>Scambio</Text>

        {bothJokersException ? (
          <Text style={styles.noSwapText}>
            Nessuno scambio — Jolly doppio 🃏
          </Text>
        ) : (
          <View style={styles.rowsContainer}>
            {cardReceived && (
              <View style={styles.exchangeBlock}>
                <View style={styles.exchangeRow}>
                  <Text style={styles.playerName}>{loserName}</Text>
                  <Text style={styles.arrow}>→</Text>
                  <View style={styles.cardWrap}>
                    <CardView card={cardReceived} noLift />
                  </View>
                  <Text style={styles.arrow}>→</Text>
                  <Text style={styles.playerName}>{winnerName}</Text>
                </View>
                <Text style={styles.descText}>
                  <Text style={styles.descName}>{loserName}</Text>
                  <Text style={styles.descPlain}>{" dà "}</Text>
                  <Text style={styles.descCard}>{getItalianCardName(cardReceived)}</Text>
                  <Text style={styles.descPlain}>{" a "}</Text>
                  <Text style={styles.descName}>{winnerName}</Text>
                </Text>
              </View>
            )}

            {cardReceived && cardGiven && (
              <View style={styles.separator} />
            )}

            {cardGiven && (
              <View style={styles.exchangeBlock}>
                <View style={styles.exchangeRow}>
                  <Text style={styles.playerName}>{winnerName}</Text>
                  <Text style={styles.arrow}>→</Text>
                  <View style={styles.cardWrap}>
                    <CardView card={cardGiven} noLift />
                  </View>
                  <Text style={styles.arrow}>→</Text>
                  <Text style={styles.playerName}>{loserName}</Text>
                </View>
                <Text style={styles.descText}>
                  <Text style={styles.descName}>{winnerName}</Text>
                  <Text style={styles.descPlain}>{" dà "}</Text>
                  <Text style={styles.descCard}>{getItalianCardName(cardGiven)}</Text>
                  <Text style={styles.descPlain}>{" a "}</Text>
                  <Text style={styles.descName}>{loserName}</Text>
                </Text>
              </View>
            )}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 150,
  },
  card: {
    backgroundColor: "rgba(3, 16, 8, 0.96)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 8,
    maxWidth: 300,
    width: "82%",
    ...Shadow.gold,
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 16,
    color: Colors.gold,
    textAlign: "center",
    letterSpacing: 2,
    marginBottom: 4,
  },
  noSwapText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  rowsContainer: {
    width: "100%",
    gap: 0,
  },
  exchangeBlock: {
    gap: 6,
    paddingVertical: 4,
    alignItems: "center",
  },
  exchangeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  playerName: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 15,
    color: Colors.gold,
    maxWidth: 70,
    textAlign: "center",
  },
  arrow: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  cardWrap: {
    transform: [{ scale: 0.65 }],
    marginHorizontal: -(58 * 0.175),
    marginVertical: -(84 * 0.175),
  },
  descText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  descName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: Colors.gold,
  },
  descPlain: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  descCard: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#F0EAD6",
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 8,
    width: "100%",
  },
});
