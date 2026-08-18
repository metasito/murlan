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
import Feather from "@expo/vector-icons/Feather";
import type { Card } from "@/lib/gameEngine";
import { CardView } from "@/components/CardView";
import { Colors, Spacing, Radius, FontSize, Type, Motion, Shadow } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import { cardSpokenName } from "@/lib/cardNames";

// Mirrors the private CARD_W/CARD_H in components/CardView.tsx (not exported,
// and that file is owned elsewhere) — used only to shrink a rendered CardView
// down for the compact inline preview below.
const CARD_W = 58;
const CARD_H = 84;

// Domain timings, not generic UI transitions — not a lib/theme.ts Motion
// value because nothing there represents "how long a card announcement
// stays up" or "how long a card takes to fly across the table".
const DISMISS_MS = 5500;
const FLIGHT_DURATION = 750;


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
      withTiming(toRight ? screenWidth + 20 : -80, { duration: FLIGHT_DURATION })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount animation; tx is a stable shared value, other props are fixed per instance
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
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const reduceMotion = usePrefersReducedMotion();

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
  }, [visible, onDismiss]);

  if (!visible || !shown) return null;

  function handleDismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShown(false);
    onDismiss();
  }

  const midY = screenHeight / 2;
  const isMutual = !!(cardReceived && cardGiven);

  const a11yLabel = bothJokersException
    ? t("exchangeAnnouncement.a11yNoSwap", { loserName })
    : [
        cardReceived &&
          t("exchangeAnnouncement.giveLine", {
            from: loserName,
            card: cardSpokenName(cardReceived, t),
            to: winnerName,
          }),
        cardGiven &&
          t("exchangeAnnouncement.giveLine", {
            from: winnerName,
            card: cardSpokenName(cardGiven, t),
            to: loserName,
          }),
      ]
        .filter(Boolean)
        .join(". ");

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(Motion.duration.moderate)}
      exiting={reduceMotion ? undefined : FadeOut.duration(Motion.duration.moderate)}
      style={styles.overlay}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={handleDismiss}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      {/* Purely decorative flourish — the same information is announced via
          a11yLabel and shown as text below, so skip it entirely under
          reduced motion rather than trying to "jump" it to a resting frame. */}
      {!reduceMotion && cardReceived && (
        <FlyingCard
          card={cardReceived}
          toRight
          delay={200}
          screenWidth={screenWidth}
          yOffset={isMutual ? midY - 100 : midY - 42}
        />
      )}
      {!reduceMotion && cardGiven && (
        <FlyingCard
          card={cardGiven}
          toRight={false}
          delay={isMutual ? 1100 : 200}
          screenWidth={screenWidth}
          yOffset={isMutual ? midY + 16 : midY - 42}
        />
      )}

      <Pressable
        onPress={handleDismiss}
        style={styles.card}
        accessibilityViewIsModal
        accessibilityRole="alert"
        accessibilityLabel={a11yLabel}
        accessibilityHint={t("exchangeAnnouncement.dismissA11yHint")}
      >
        <Pressable
          onPress={handleDismiss}
          style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.6 : 1 }]}
          hitSlop={Spacing.xs}
          accessibilityRole="button"
          accessibilityLabel={t("exchangeAnnouncement.closeA11yLabel")}
        >
          <Feather name="x" size={18} color={Colors.textMuted} />
        </Pressable>

        <Text style={styles.title}>{t("exchangeAnnouncement.title")}</Text>

        {bothJokersException ? (
          <Text style={styles.noSwapText}>
            {t("exchangeAnnouncement.noSwapText")}
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
                  <Text style={styles.descPlain}>{t("exchangeAnnouncement.givesWord")}</Text>
                  <Text style={styles.descCard}>{cardSpokenName(cardReceived, t)}</Text>
                  <Text style={styles.descPlain}>{t("exchangeAnnouncement.toWord")}</Text>
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
                  <Text style={styles.descPlain}>{t("exchangeAnnouncement.givesWord")}</Text>
                  <Text style={styles.descCard}>{cardSpokenName(cardGiven, t)}</Text>
                  <Text style={styles.descPlain}>{t("exchangeAnnouncement.toWord")}</Text>
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
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    alignItems: "center",
    gap: Spacing.sm,
    maxWidth: 300,
    width: "82%",
    ...Shadow.gold,
  },
  closeBtn: {
    position: "absolute",
    top: Spacing.xs,
    right: Spacing.xs,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  title: {
    ...Type.heading,
    fontSize: FontSize.md,
    color: Colors.gold,
    textAlign: "center",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: Spacing.xs,
  },
  noSwapText: {
    ...Type.body,
    textAlign: "center",
  },
  rowsContainer: {
    width: "100%",
    gap: 0,
  },
  exchangeBlock: {
    gap: Spacing.xs + 2,
    paddingVertical: Spacing.xs,
    alignItems: "center",
  },
  exchangeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs + 2,
  },
  playerName: {
    ...Type.subheading,
    color: Colors.gold,
    maxWidth: 70,
    textAlign: "center",
  },
  arrow: {
    ...Type.caption,
  },
  cardWrap: {
    transform: [{ scale: 0.65 }],
    marginHorizontal: -(CARD_W * 0.175),
    marginVertical: -(CARD_H * 0.175),
  },
  descText: {
    textAlign: "center",
    lineHeight: 18,
  },
  descName: {
    ...Type.bodyStrong,
    color: Colors.gold,
  },
  descPlain: {
    ...Type.body,
  },
  descCard: {
    ...Type.bodyStrong,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.sm,
    width: "100%",
  },
});
