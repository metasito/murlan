import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import type { ExchangePhase, Card } from "@/lib/gameEngine";
import { cardStrength, getValidGivebackCards } from "@/lib/gameEngine";
import { CardView } from "@/components/CardView";
import Colors from "@/constants/colors";

interface ExchangeModalProps {
  phase: ExchangePhase;
  winnerHand: Card[];
  loserName: string;
  onSelectCard: (cardId: string) => void;
}

export function ExchangeModal({
  phase,
  winnerHand,
  loserName,
  onSelectCard,
}: ExchangeModalProps) {
  const validCards = getValidGivebackCards(winnerHand).sort(
    (a, b) => cardStrength(a) - cardStrength(b)
  );

  return (
    <Animated.View
      entering={FadeIn.duration(280)}
      exiting={FadeOut.duration(200)}
      style={styles.overlay}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Ionicons name="swap-horizontal" size={26} color={Colors.gold} />
          <Text style={styles.title}>SCAMBIO DI CARTE</Text>
        </View>

        <Text style={styles.sub}>
          Hai ricevuto da{" "}
          <Text style={styles.accent}>{loserName}</Text>:
        </Text>

        <View style={styles.receivedCardWrap}>
          <CardView card={phase.cardFromLoser} />
        </View>

        <View style={styles.divider} />

        <Text style={styles.sub}>
          Dai una carta a{" "}
          <Text style={styles.accent}>{loserName}</Text> (solo 3–10):
        </Text>

        {validCards.length === 0 ? (
          <Text style={styles.hint}>Nessuna carta valida da restituire.</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cardRow}
          >
            {validCards.map((card) => (
              <Pressable
                key={card.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onSelectCard(card.id);
                }}
                style={({ pressed }) => [
                  styles.cardItem,
                  pressed && styles.cardItemPressed,
                ]}
              >
                <CardView card={card} />
              </Pressable>
            ))}
          </ScrollView>
        )}

        <Text style={styles.hint}>Tocca una carta per darla al perdente</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,16,8,0.90)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 110,
  },
  card: {
    backgroundColor: "#0B2A1A",
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "rgba(201,168,76,0.45)",
    padding: 24,
    alignItems: "center",
    gap: 12,
    maxWidth: 420,
    width: "88%",
    ...Platform.select({
      ios: {
        shadowColor: Colors.gold,
        shadowOpacity: 0.3,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 0 },
      },
      android: { elevation: 16 },
    }),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 18,
    color: Colors.gold,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  sub: {
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
  receivedCardWrap: {
    transform: [{ scale: 1.05 }],
    marginVertical: 4,
  },
  divider: {
    width: "100%",
    height: 1,
    backgroundColor: "rgba(201,168,76,0.15)",
    marginVertical: 2,
  },
  cardRow: {
    flexDirection: "row",
    paddingHorizontal: 4,
    gap: 10,
    alignItems: "center",
  },
  cardItem: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "rgba(201,168,76,0.3)",
    overflow: "hidden",
  },
  cardItemPressed: {
    borderColor: Colors.gold,
    transform: [{ scale: 0.95 }],
  },
  hint: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: "center",
  },
});
