import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import type { Card } from "@/lib/gameEngine";
import { CardView } from "@/components/CardView";
import Colors from "@/constants/colors";

const DISMISS_MS = 3500;

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

  if (bothJokersException) {
    return (
      <Animated.View
        entering={FadeIn.duration(300)}
        exiting={FadeOut.duration(300)}
        style={styles.overlay}
      >
        <Pressable onPress={handleDismiss} style={styles.card}>
          <Text style={styles.emoji}>🃏🃏</Text>
          <Text style={styles.titleNoSwap}>NESSUNO SCAMBIO</Text>
          <Text style={styles.body}>
            Il perdente ha entrambi i jolly.{"\n"}
            <Text style={styles.accent}>{winnerName}</Text> inizia il round.
          </Text>
          <Text style={styles.dismissHint}>Tocca per chiudere</Text>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(300)}
      style={styles.overlay}
    >
      <Pressable onPress={handleDismiss} style={styles.card}>
        <Ionicons name="swap-horizontal" size={28} color={Colors.gold} />
        <Text style={styles.title}>SCAMBIO COMPLETATO</Text>
        <Text style={styles.body}>
          <Text style={styles.accent}>{loserName}</Text> ha dato a{" "}
          <Text style={styles.accent}>{winnerName}</Text>:
        </Text>
        {cardReceived && (
          <View style={styles.cardRow}>
            <View style={styles.cardWrap}>
              <CardView card={cardReceived} />
            </View>
          </View>
        )}
        {cardGiven && (
          <>
            <Text style={styles.body}>
              <Text style={styles.accent}>{winnerName}</Text> ha restituito:
            </Text>
            <View style={styles.cardRow}>
              <View style={styles.cardWrap}>
                <CardView card={cardGiven} />
              </View>
            </View>
          </>
        )}
        <Text style={styles.dismissHint}>Tocca per chiudere</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,16,8,0.88)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 120,
  },
  card: {
    backgroundColor: "#0B2A1A",
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "rgba(201,168,76,0.4)",
    padding: 28,
    alignItems: "center",
    gap: 12,
    maxWidth: 400,
    width: "82%",
    ...Platform.select({
      ios: {
        shadowColor: Colors.gold,
        shadowOpacity: 0.25,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 0 },
      },
      android: { elevation: 14 },
    }),
  },
  emoji: { fontSize: 36 },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 18,
    color: Colors.gold,
    letterSpacing: 2,
  },
  titleNoSwap: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 20,
    color: Colors.gold,
    letterSpacing: 2,
  },
  body: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.text,
    textAlign: "center",
    lineHeight: 20,
  },
  accent: {
    color: Colors.gold,
    fontFamily: "Rajdhani_700Bold",
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "center",
  },
  cardWrap: {
    transform: [{ scale: 1.0 }],
  },
  dismissHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
  },
});
