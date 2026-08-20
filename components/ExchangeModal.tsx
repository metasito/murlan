import React, { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  cancelAnimation,
} from "react-native-reanimated";
import { hapticMedium } from "@/lib/haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ExchangePhase, Card } from "@/lib/gameEngine";
import { cardStrength, getValidGivebackCards } from "@/lib/gameEngine";
import { CardView } from "@/components/CardView";
import { Colors, FontSize, Highlight, Motion, Radius, Shadow, Spacing } from '@/lib/theme';
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import { cardSpokenName } from "@/lib/cardNames";
import { useA11yHint } from "@/lib/a11y";

interface ExchangeModalProps {
  phase: ExchangePhase;
  winnerHand: Card[];
  loserName: string;
  winnerName: string;
  onSelectCard: (cardId: string) => void;
}

function AnimatedCard({ card, delay = 0, reduceMotion }: { card: Card; delay?: number; reduceMotion: boolean }) {
  const ty = useSharedValue(reduceMotion ? 0 : -30);
  const rot = useSharedValue(reduceMotion ? 0 : -8);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) return;
    ty.value = withDelay(delay, withSpring(0, Motion.spring.land));
    rot.value = withDelay(delay, withSpring(0, Motion.spring.land));
    opacity.value = withDelay(delay, withTiming(1, { duration: Motion.duration.moderate }));
  }, [delay, opacity, reduceMotion, rot, ty]);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: ty.value }, { rotate: `${rot.value}deg` }],
  }));

  return (
    <Animated.View style={anim}>
      <CardView card={card} />
    </Animated.View>
  );
}

const PICK_LIFT = -10;

function SelectableCard({
  card,
  onPress,
  reduceMotion,
}: {
  card: Card;
  onPress: () => void;
  reduceMotion: boolean;
}) {
  const { t } = useTranslation();
  const giveHint = useA11yHint(t("exchangeModal.giveCardA11yHint"));
  // Lift and tip rather than scale: this wraps a CardView, whose rank
  // characters are rasterised text and go soft the moment they are resampled.
  const lift = useSharedValue(0);
  const glow = useSharedValue(0);

  // Must precede the effect that reads them — the React Compiler skips any component that mutates a value an effect captured.
  function setPress(down: boolean) {
    if (reduceMotion) {
      glow.value = down ? 1 : 0;
      return;
    }
    lift.value = withSpring(down ? 1 : 0, down ? Motion.spring.pickup : Motion.spring.land);
    glow.value = withTiming(down ? 1 : 0, { duration: Motion.duration.fast });
  }

  useEffect(
    () => () => {
      cancelAnimation(lift);
      cancelAnimation(glow);
    },
    [glow, lift]
  );

  function handlePress() {
    hapticMedium();
    onPress();
  }

  const anim = useAnimatedStyle(() => ({
    transform: [
      { translateY: lift.value * PICK_LIFT },
      { rotate: `${lift.value * -3}deg` },
    ],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={() => setPress(true)}
      onPressOut={() => setPress(false)}
      accessibilityRole="button"
      accessibilityLabel={cardSpokenName(card, t)}
      {...giveHint.props}
    >
      {giveHint.node}
      <Animated.View style={anim}>
        <Animated.View pointerEvents="none" style={[styles.cardGlow, glowStyle]} />
        <View style={styles.cardItem}>
          <CardView card={card} decorative />
        </View>
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

  const validCards = getValidGivebackCards(winnerHand, phase.cardFromLoser?.id).sort(
    (a, b) => cardStrength(a) - cardStrength(b)
  );

  const arrowScale = useSharedValue(reduceMotion ? 1 : 0.6);
  const arrowOpacity = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) return;
    arrowScale.value = withDelay(300, withSpring(1, Motion.spring.entrance));
    arrowOpacity.value = withDelay(300, withTiming(1, { duration: 300 }));
  }, [arrowOpacity, arrowScale, reduceMotion]);

  const arrowAnim = useAnimatedStyle(() => ({
    transform: [{ scale: arrowScale.value }],
    opacity: arrowOpacity.value,
  }));

  return (
    // The hand cannot continue until a card is picked, so Escape has nowhere
    // to dismiss to and onRequestClose is deliberately inert.
    <Modal
      transparent
      visible
      accessibilityLabel={t("exchangeModal.title")}
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={() => {}}
    >
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

          {/* Loser row — receives the card the winner is about to pick */}
          <View style={styles.playerRow}>
            <View style={styles.playerInfo}>
              <Ionicons name="person" size={14} color={Colors.textSecondary} />
              <Text style={styles.playerName} numberOfLines={1}>{loserName}</Text>
              <View style={[styles.receivesTag, styles.willReceiveTag]}>
                <Text style={[styles.receivesTagText, styles.willReceiveTagText]}>{t("exchangeModal.willReceive")}</Text>
              </View>
            </View>
            <View style={styles.cardSlotEmpty}>
              <Ionicons name="help-circle-outline" size={28} color={Colors.goldDim} />
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
                  reduceMotion={reduceMotion}
                  onPress={() => onSelectCard(card.id)}
                />
              ))}
            </ScrollView>
          )}

          <Text style={styles.hint}>{t("exchangeModal.hint")}</Text>
        </View>
      </Animated.View>
    </Modal>
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
    padding: Spacing.roomy,
    alignItems: "center",
    gap: Spacing.snug,
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
    fontSize: FontSize.md,
    color: Colors.gold,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    gap: Spacing.cosy,
    backgroundColor: Highlight.faint,
    borderRadius: Radius.md,
    padding: Spacing.snug,
    borderWidth: 1,
    borderColor: Colors.goldMuted,
  },
  playerInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.slim,
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
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xxs,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
  },
  receivesTagText: {
    fontFamily: "Inter_500Medium",
    fontSize: FontSize.xxs,
    color: Colors.gold,
    letterSpacing: 0.5,
  },
  willReceiveTag: {
    backgroundColor: Highlight.soft,
    borderColor: Highlight.clear,
  },
  willReceiveTagText: {
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
    gap: Spacing.slim,
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
    fontSize: FontSize.xs,
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
    gap: Spacing.snug,
    alignItems: "center",
  },
  cardItem: {
    borderRadius: Radius.sm + 2,
    borderWidth: 2,
    borderColor: Colors.goldBorder,
    overflow: "hidden",
  },
  cardGlow: {
    position: "absolute",
    top: 2, left: 2, right: 2, bottom: 2,
    borderRadius: Radius.sm,
    backgroundColor: Colors.gold,
    ...Shadow.goldSoft,
  },
  hint: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: "center",
  },
});
