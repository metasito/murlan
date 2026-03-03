import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import type { Card } from "@/lib/gameEngine";
import { CardView } from "@/components/CardView";
import Colors from "@/constants/colors";
import { Shadow } from "@/lib/theme";

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

function AvatarBubble({ name }: { name: string }) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <View style={styles.avatarBubble}>
      <Text style={styles.avatarInitial}>{initial}</Text>
    </View>
  );
}

function ExchangeRow({
  from,
  card,
  to,
}: {
  from: string;
  card?: Card;
  to: string;
}) {
  return (
    <View style={styles.exchangeRow}>
      <AvatarBubble name={from} />
      <Text style={styles.arrow}>→</Text>
      {card ? (
        <View style={styles.cardWrap}>
          <CardView card={card} />
        </View>
      ) : (
        <View style={styles.cardWrap} />
      )}
      <Text style={styles.arrow}>→</Text>
      <AvatarBubble name={to} />
    </View>
  );
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

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(300)}
      style={styles.overlay}
    >
      <Pressable onPress={handleDismiss} style={styles.card}>
        <Text style={styles.title}>Scambio</Text>

        {bothJokersException ? (
          <Text style={styles.noSwapText}>
            Nessuno scambio — Jolly doppio 🃏
          </Text>
        ) : (
          <View style={styles.rowsContainer}>
            {cardReceived && (
              <ExchangeRow
                from={loserName}
                card={cardReceived}
                to={winnerName}
              />
            )}
            {cardReceived && cardGiven && (
              <View style={styles.separator} />
            )}
            {cardGiven && (
              <ExchangeRow
                from={winnerName}
                card={cardGiven}
                to={loserName}
              />
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
    width: "80%",
    ...Platform.select({
      ios: Shadow.gold,
      android: { elevation: Shadow.gold.elevation },
    }),
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 16,
    color: Colors.gold,
    textAlign: "center",
    marginBottom: 8,
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
  exchangeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 4,
  },
  avatarBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.feltLight,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 13,
    color: Colors.gold,
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
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 8,
    width: "100%",
  },
});
