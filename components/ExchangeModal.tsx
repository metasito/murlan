import React, { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  useWindowDimensions,
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
import { CARD_H, CARD_W, cardScale } from "@/components/cardFaceModel";
import { Colors, FontSize, Highlight, Motion, Radius, Shadow, Spacing, TOUCH_TARGET_MIN } from '@/lib/theme';
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import { cardSpokenName } from "@/lib/cardNames";
import { a11yHidden, a11yState, useA11yHint } from "@/lib/a11y";

interface ExchangeModalProps {
  phase: ExchangePhase;
  winnerHand: Card[];
  loserName: string;
  winnerName: string;
  onSelectCard: (cardId: string) => void;
}

function AnimatedCard({
  card,
  delay = 0,
  reduceMotion,
  scale,
}: {
  card: Card;
  delay?: number;
  reduceMotion: boolean;
  scale: number;
}) {
  const ty = useSharedValue(reduceMotion ? 0 : -30);
  const rot = useSharedValue(reduceMotion ? 0 : -8);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) return;
    ty.value = withDelay(delay, withSpring(0, Motion.spring.land));
    rot.value = withDelay(delay, withSpring(0, Motion.spring.land));
    opacity.value = withDelay(delay, withTiming(1, { duration: Motion.duration.moderate }));
    // A delayed spring outlives the view that started it. This card is remounted
    // whenever the pick changes, so without this each pick leaves a timeline
    // animating a shared value nothing reads any more.
    return () => {
      cancelAnimation(ty);
      cancelAnimation(rot);
      cancelAnimation(opacity);
    };
  }, [delay, opacity, reduceMotion, rot, ty]);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: ty.value }, { rotate: `${rot.value}deg` }],
  }));

  return (
    <Animated.View style={anim}>
      <CardView card={card} scale={scale} />
    </Animated.View>
  );
}

const PICK_LIFT = -10;
const PRESSED_OPACITY = 0.7;
// 90% of the widest phone the table ships to lying down (844pt). Past that the
// window is a desktop browser, where a wider panel buys the two columns nothing.
const LANDSCAPE_MAX_W = 760;

/** The slot is the card's own box, so the row does not resize around a pick. */
const emptySlotSize = (scale: number) => ({ width: CARD_W(scale), height: CARD_H(scale) });

function SelectableCard({
  card,
  onPress,
  selected,
  reduceMotion,
  scale,
}: {
  card: Card;
  onPress: () => void;
  selected: boolean;
  reduceMotion: boolean;
  scale: number;
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
      accessibilityLabel={cardSpokenName(card, t)}
      {...a11yState({ role: "button", selected })}
      {...giveHint.props}
    >
      {giveHint.node}
      <Animated.View style={anim}>
        <Animated.View pointerEvents="none" style={[styles.cardGlow, glowStyle]} />
        <View style={[styles.cardItem, selected && styles.cardItemSelected]}>
          <CardView card={card} scale={scale} decorative />
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
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const { width, height } = useWindowDimensions();
  // The table is landscape-locked, so this is the shape the modal is seen in.
  const landscape = width > height;
  const scale = cardScale(Math.min(width, height));

  const validCards = getValidGivebackCards(winnerHand, phase.cardFromLoser?.id).sort(
    (a, b) => cardStrength(a) - cardStrength(b)
  );
  const selectedCard = validCards.find((c) => c.id === selectedId) ?? null;

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
        <View
          testID="exchange-panel"
          style={[styles.card, landscape ? styles.cardLandscape : styles.cardPortrait]}
        >
          <View style={[styles.column, landscape && styles.columnLandscape]}>
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
                <AnimatedCard
                  card={phase.cardFromLoser}
                  delay={100}
                  reduceMotion={reduceMotion}
                  scale={scale}
                />
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
              {selectedCard ? (
                <View style={styles.cardSlot}>
                  {/* Keyed on the card so each new pick replays the drop. */}
                  <AnimatedCard
                    key={selectedCard.id}
                    card={selectedCard}
                    reduceMotion={reduceMotion}
                    scale={scale}
                  />
                </View>
              ) : (
                <View style={[styles.cardSlotEmpty, emptySlotSize(scale)]}>
                  <Ionicons name="help-circle-outline" size={28} color={Colors.goldDim} />
                </View>
              )}
            </View>
          </View>

          <View style={[styles.divider, landscape && styles.dividerUpright]} />

          <View style={[styles.column, landscape && styles.columnLandscape]}>
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
                    selected={card.id === selectedId}
                    reduceMotion={reduceMotion}
                    scale={scale}
                    onPress={() => setSelectedId(card.id)}
                  />
                ))}
              </ScrollView>
            )}

            {validCards.length > 0 && (
              <Pressable
                testID="exchange-confirm"
                onPress={() => {
                  if (!selectedCard) return;
                  hapticMedium();
                  onSelectCard(selectedCard.id);
                }}
                disabled={!selectedCard}
                {...a11yState({ role: "button", disabled: !selectedCard })}
                accessibilityLabel={t("exchangeModal.confirm")}
                style={({ pressed }) => [
                  styles.confirm,
                  !selectedCard && styles.confirmDisabled,
                  pressed && selectedCard && styles.confirmPressed,
                ]}
              >
                <Text
                  style={[styles.confirmLabel, !selectedCard && styles.confirmLabelDisabled]}
                  {...a11yHidden()}
                >
                  {t("exchangeModal.confirm")}
                </Text>
              </Pressable>
            )}

            <Text style={styles.hint}>
              {t(selectedCard ? "exchangeModal.hintConfirm" : "exchangeModal.hint")}
            </Text>
          </View>
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
    width: "90%",
    ...Shadow.gold,
  },
  cardPortrait: {
    maxWidth: 440,
  },
  cardLandscape: {
    flexDirection: "row",
    alignItems: "stretch",
    padding: Spacing.cosy,
    maxWidth: LANDSCAPE_MAX_W,
  },
  column: {
    alignSelf: "stretch",
    alignItems: "center",
    gap: Spacing.snug,
  },
  columnLandscape: {
    flex: 1,
    justifyContent: "center",
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
  dividerUpright: {
    width: 1,
    height: "auto",
    alignSelf: "stretch",
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
  cardItemSelected: {
    borderColor: Colors.gold,
    ...Shadow.gold,
  },
  confirm: {
    minHeight: TOUCH_TARGET_MIN,
    minWidth: TOUCH_TARGET_MIN,
    paddingHorizontal: Spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
    backgroundColor: Colors.gold,
  },
  confirmPressed: {
    opacity: PRESSED_OPACITY,
  },
  confirmDisabled: {
    backgroundColor: Colors.goldMuted,
  },
  confirmLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.md,
    color: Colors.bg,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  confirmLabelDisabled: {
    color: Colors.textMuted,
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
