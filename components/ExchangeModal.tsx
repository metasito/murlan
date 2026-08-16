import React, { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  withSequence,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import type { ExchangePhase, Card } from "@/lib/gameEngine";
import { cardStrength, getValidGivebackCards } from "@/lib/gameEngine";
import { CardView } from "@/components/CardView";
import { Colors, FontSize, Highlight, Radius, Shadow, Spacing } from '@/lib/theme';
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";

interface ExchangeModalProps {
  phase: ExchangePhase;
  winnerHand: Card[];
  loserName: string;
  winnerName: string;
  onSelectCard: (cardId: string) => void;
}

function AnimatedCard({ card, delay = 0, reduceMotion }: { card: Card; delay?: number; reduceMotion: boolean }) {
  const ty = useSharedValue(reduceMotion ? 0 : -30);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const scale = useSharedValue(reduceMotion ? 1 : 0.8);

  useEffect(() => {
    if (reduceMotion) return;
    ty.value = withDelay(delay, withSpring(0, { damping: 12, stiffness: 200 }));
    opacity.value = withDelay(delay, withTiming(1, { duration: 250 }));
    scale.value = withDelay(delay, withSpring(1, { damping: 10, stiffness: 180 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount animation; ty/opacity/scale are stable shared values, delay/reduceMotion are fixed per instance
  }, []);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View style={anim}>
      <CardView card={card} />
    </Animated.View>
  );
}

function SelectableCard({
  card,
  onPress,
}: {
  card: Card;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  function handlePress() {
    scale.value = withSequence(
      withSpring(0.88, { damping: 8, stiffness: 300 }),
      withSpring(1, { damping: 10, stiffness: 200 })
    );
    opacity.value = withSequence(
      withTiming(0.7, { duration: 80 }),
      withTiming(1, { duration: 120 })
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  }

  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Pressable onPress={handlePress}>
      <Animated.View style={[styles.cardItem, anim]}>
        <CardView card={card} />
      </Animated.View>
    </Pressable>
  );
}

export function ExchangeModal({
  phase,
  winnerHand,
  loserName,
  winnerName,
  onSelectCard,
}: ExchangeModalProps) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();

  const validCards = getValidGivebackCards(winnerHand).sort(
    (a, b) => cardStrength(a) - cardStrength(b)
  );

  const arrowScale = useSharedValue(reduceMotion ? 1 : 0.6);
  const arrowOpacity = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) return;
    arrowScale.value = withDelay(300, withSpring(1, { damping: 12, stiffness: 200 }));
    arrowOpacity.value = withDelay(300, withTiming(1, { duration: 300 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount animation; stable shared values, reduceMotion checked once at mount
  }, []);

  const arrowAnim = useAnimatedStyle(() => ({
    transform: [{ scale: arrowScale.value }],
    opacity: arrowOpacity.value,
  }));

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(280)}
      exiting={reduceMotion ? undefined : FadeOut.duration(200)}
      style={styles.overlay}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Ionicons name="swap-horizontal" size={22} color={Colors.gold} />
          <Text style={styles.title}>{t("exchangeModal.title")}</Text>
        </View>

        {/* Winner row — receives card from loser */}
        <View style={styles.playerRow}>
          <View style={styles.playerInfo}>
            <Ionicons name="trophy" size={14} color={Colors.gold} />
            <Text style={styles.playerName} numberOfLines={1}>{winnerName}</Text>
            <View style={styles.receivesTag}>
              <Text style={styles.receivesTagText}>{t("exchangeModal.receives")}</Text>
            </View>
          </View>
          <View style={styles.cardSlot}>
            <AnimatedCard card={phase.cardFromLoser} delay={100} reduceMotion={reduceMotion} />
          </View>
        </View>

        {/* Arrow */}
        <Animated.View style={[styles.arrowRow, arrowAnim]}>
          <View style={styles.arrowLine} />
          <Ionicons name="arrow-down" size={18} color={Colors.gold} />
          <Ionicons name="arrow-up" size={18} color={Colors.textSecondary} />
          <View style={styles.arrowLine} />
        </Animated.View>

        {/* Loser row — sends a card */}
        <View style={styles.playerRow}>
          <View style={styles.playerInfo}>
            <Ionicons name="person" size={14} color={Colors.textSecondary} />
            <Text style={styles.playerName} numberOfLines={1}>{loserName}</Text>
            <View style={[styles.receivesTag, styles.givesTag]}>
              <Text style={[styles.receivesTagText, styles.givesTagText]}>{t("exchangeModal.gives")}</Text>
            </View>
          </View>
          <View style={styles.cardSlotEmpty}>
            <Ionicons name="help-circle-outline" size={28} color={Colors.goldBorder} />
          </View>
        </View>

        <View style={styles.divider} />

        <Text style={styles.sub}>
          {t("exchangeModal.subPrefix")}{" "}
          <Text style={styles.accent}>{loserName}</Text> {t("exchangeModal.subSuffix")}
        </Text>

        {validCards.length === 0 ? (
          <Text style={styles.hint}>{t("exchangeModal.noValidCards")}</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cardRow}
          >
            {validCards.map((card) => (
              <SelectableCard
                key={card.id}
                card={card}
                onPress={() => onSelectCard(card.id)}
              />
            ))}
          </ScrollView>
        )}

        <Text style={styles.hint}>{t("exchangeModal.hint")}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 110,
  },
  card: {
    backgroundColor: Colors.feltDark,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.goldStrong,
    padding: 20,
    alignItems: "center",
    gap: 10,
    maxWidth: 440,
    width: "90%",
    ...Shadow.gold,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 16,
    color: Colors.gold,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    gap: 12,
    backgroundColor: Highlight.faint,
    borderRadius: Radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.goldMuted,
  },
  playerInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "nowrap",
  },
  playerName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.sm,
    color: Colors.text,
    flex: 1,
  },
  receivesTag: {
    backgroundColor: Colors.goldMuted,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
  },
  receivesTagText: {
    fontFamily: "Inter_500Medium",
    fontSize: 9,
    color: Colors.gold,
    letterSpacing: 0.5,
  },
  givesTag: {
    backgroundColor: Highlight.soft,
    borderColor: Highlight.clear,
  },
  givesTagText: {
    color: Colors.textSecondary,
  },
  cardSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
  cardSlotEmpty: {
    alignItems: "center",
    justifyContent: "center",
    width: 52,
    height: 72,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.goldSoft,
    borderStyle: "dashed",
  },
  arrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    width: "100%",
    paddingHorizontal: Spacing.sm,
  },
  arrowLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.goldSoft,
  },
  divider: {
    width: "100%",
    height: 1,
    backgroundColor: Colors.goldMuted,
  },
  sub: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.text,
    textAlign: "center",
    lineHeight: 18,
  },
  accent: {
    color: Colors.gold,
    fontFamily: "Rajdhani_700Bold",
  },
  cardRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.xs,
    gap: 10,
    alignItems: "center",
  },
  cardItem: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.goldBorder,
    overflow: "hidden",
  },
  hint: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: "center",
  },
});
