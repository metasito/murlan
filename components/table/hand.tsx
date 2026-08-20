import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withDelay,
  cancelAnimation,
} from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CardView } from "@/components/CardView";
import { Colors, FontSize, Motion, Radius, Shadow, Spacing, TABLE_FONT_SCALE_MAX } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import type { Card } from "@/lib/gameEngine";
import { computeHandLayout } from "@/components/handLayout";
import { CARD_H, HAND_SECTION_H, fanCenterOffset } from "@/components/gameTableModel";

// Extra top clearance the fixed HAND_SECTION_H already gives the CARD_H-tall
// hand row (it's centered inside the taller section). Reused as the
// ScrollView headroom in StraightHand's scrollable fallback — see there.
const HAND_LIFT_HEADROOM = HAND_SECTION_H - CARD_H;

// ─── CardItem ─────────────────────────────────────────────────────────────────
//
// `onPress` takes the card id rather than a bound zero-arg callback, so the
// caller passes one unchanged reference for every card and CardItem binds its
// own id once. CardView then sees a new `onPress` only when this card's id or
// the callback changes — not when some other card's selection does.
// How far a selected card rises out of the fan, and how far it tips as it is
// picked up. The rotation is what stops the lift reading as a flat slide.
const SELECT_LIFT = -16;
const SELECT_TILT = -3;
// Where a dealt card comes from: up and in, i.e. the middle of the table.
const DEAL_RISE = -CARD_H * 2.2;
const DEAL_TILT = 14;

interface CardItemProps {
  card: Card;
  isSelected: boolean;
  left: number;
  onPress: (id: string) => void;
  disabled: boolean;
  zIndex: number;
  /** Draw the back — the hand belongs to someone else. */
  faceDown?: boolean;
  /** ms to wait before this card flies in, or -1 for no deal animation. */
  dealDelay: number;
  /** Horizontal distance back to the deck, so the fan converges on one point. */
  dealFromX: number;
}

function CardItemBase({
  card,
  isSelected,
  left,
  onPress,
  disabled,
  zIndex,
  dealDelay,
  dealFromX,
  faceDown = false,
}: CardItemProps) {
  const reduceMotion = usePrefersReducedMotion();
  const liftY = useSharedValue(0);
  const tilt = useSharedValue(0);
  const glow = useSharedValue(0);
  const dealing = useSharedValue(dealDelay >= 0 && !reduceMotion ? 1 : 0);
  // The stagger is disarmed one render after the hand appears, so `dealDelay`
  // becomes -1 while this card is still flying in. The deal owes its timing to
  // the value the card mounted with.
  const dealDelayRef = useRef(dealDelay);

  useEffect(() => {
    if (dealing.value === 0) return;
    dealing.value = withDelay(
      dealDelayRef.current,
      withSpring(0, Motion.spring.land)
    );
  }, [dealing]);

  useEffect(() => {
    if (reduceMotion) {
      liftY.value = withTiming(isSelected ? SELECT_LIFT : 0, { duration: Motion.duration.fast });
      tilt.value = 0;
      glow.value = withTiming(isSelected ? 1 : 0, { duration: Motion.duration.fast });
      return;
    }
    liftY.value = withSpring(isSelected ? SELECT_LIFT : 0, Motion.spring.pickup);
    tilt.value = withSpring(isSelected ? SELECT_TILT : 0, Motion.spring.pickup);
    glow.value = withTiming(isSelected ? 1 : 0, { duration: Motion.duration.fast });
  }, [isSelected, reduceMotion, liftY, tilt, glow]);

  useEffect(
    () => () => {
      cancelAnimation(liftY);
      cancelAnimation(tilt);
      cancelAnimation(glow);
      cancelAnimation(dealing);
    },
    [liftY, tilt, glow, dealing]
  );

  const aStyle = useAnimatedStyle(() => {
    const d = dealing.value;
    return {
      opacity: 1 - d,
      transform: [
        { translateX: dealFromX * d },
        { translateY: liftY.value + DEAL_RISE * d },
        { rotate: `${tilt.value + DEAL_TILT * d}deg` },
      ],
    };
  });

  // A textless sibling behind the card carries the selection bloom, so the
  // glow can be animated with opacity alone and never touches the card's own
  // rasterised rank characters.
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  const cardId = card.id;
  const handlePress = useCallback(() => onPress(cardId), [onPress, cardId]);

  return (
    <Animated.View
      style={[handStyles.handCardWrap, { left, zIndex }, aStyle]}
    >
      <Animated.View pointerEvents="none" style={[handStyles.cardGlow, glowStyle]} />
      <CardView
        card={card}
        selected={isSelected}
        onPress={handlePress}
        disabled={disabled}
        faceDown={faceDown}
        noLift
      />
    </Animated.View>
  );
}

/**
 * Compares the card by id for the same reason CardView does: an incoming
 * `game:state` rebuilds every card object, and `dealDelay` is deliberately
 * excluded because the deal reads it once at mount (`dealDelayRef`), so a
 * later change to it must not remount the card mid-flight.
 */
function cardItemPropsEqual(a: CardItemProps, b: CardItemProps): boolean {
  return (
    a.card.id === b.card.id &&
    a.isSelected === b.isSelected &&
    a.left === b.left &&
    a.onPress === b.onPress &&
    a.disabled === b.disabled &&
    a.zIndex === b.zIndex &&
    a.faceDown === b.faceDown &&
    a.dealFromX === b.dealFromX
  );
}

const CardItem = React.memo(CardItemBase, cardItemPropsEqual);
CardItem.displayName = "CardItem";

// ─── StraightHand ─────────────────────────────────────────────────────────────

export function StraightHand({
  cards,
  selectedIds,
  onPress,
  disabled,
  availW,
  isMyTurn,
  faceDown = false,
}: {
  cards: Card[];
  selectedIds: string[];
  onPress: (id: string) => void;
  disabled: boolean;
  availW: number;
  isMyTurn?: boolean;
  /** Draw backs instead of faces — the hand belongs to someone else. */
  faceDown?: boolean;
}) {
  const { t } = useTranslation();
  const n = cards.length;
  // O(1) membership check per card instead of `selectedIds.includes(card.id)`
  // (an O(k) scan repeated for every one of the up to 27 cards in a hand).
  // Computed before the early return below — Rules of Hooks requires every
  // hook to run unconditionally on every render of this component.
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Armed while the hand is empty, so the render on which a hand appears —
  // the start of a game, or of the next one after a rematch — is the render
  // whose cards mount staggered. A single card arriving later (the exchange
  // give-back) mounts with the deal disarmed and simply appears in place.
  const [dealArmed, setDealArmed] = useState(true);
  useEffect(() => {
    setDealArmed(n === 0);
  }, [n]);

  if (n === 0) {
    return (
      <View style={[handStyles.handCenter, { width: availW }]}>
        <Ionicons name="checkmark-circle" size={24} color={Colors.gold} />
        <Text maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX} style={handStyles.emptyHandText}>{t("gameShared.emptyHand")}</Text>
      </View>
    );
  }
  const { step, totalW, scrollable } = computeHandLayout(n, availW);

  const row = (
    <View style={[handStyles.handRow, { width: scrollable ? totalW : Math.min(totalW, availW) }]}>
      {cards.map((card, i) => (
        <CardItem
          key={card.id}
          card={card}
          isSelected={selectedSet.has(card.id)}
          left={i * step}
          onPress={onPress}
          disabled={disabled}
          faceDown={faceDown}
          zIndex={i}
          dealDelay={dealArmed ? i * Motion.stagger.deal : -1}
          dealFromX={-fanCenterOffset(i, step, totalW)}
        />
      ))}
    </View>
  );

  return (
    <View style={[handStyles.handCenter, { width: availW }]}>
      <View
        style={[
          handStyles.handGlowWrap,
          isMyTurn && handStyles.handGlowWrapActive,
        ]}
      >
        {scrollable ? (
          // Too many cards to keep the readable minimum step inside availW
          // (e.g. a 27-card hand on a narrow device). Scroll instead of
          // clipping or shrinking the step past legibility. HAND_LIFT_HEADROOM
          // reproduces the same top clearance the fixed-height, non-scrolling
          // path gets for free from HAND_SECTION_H (CARD_H + 16) being taller
          // than the CARD_H row it centers — without it, the ScrollView's own
          // clipping bounds would cut off the -14px selection lift.
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ width: availW, height: CARD_H + HAND_LIFT_HEADROOM }}
            contentContainerStyle={{ paddingTop: HAND_LIFT_HEADROOM, width: totalW }}
          >
            {row}
          </ScrollView>
        ) : (
          row
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const handStyles = StyleSheet.create({
  handCenter: {
    alignItems: "center",
    justifyContent: "center",
    height: CARD_H,
    flexDirection: "row",
    gap: Spacing.slim,
  },
  handGlowWrap: { borderRadius: Radius.md, padding: Spacing.xs },
  handGlowWrapActive: { backgroundColor: Colors.goldGhost },
  cardGlow: {
    position: "absolute",
    top: 2, left: 2, right: 2, bottom: 2,
    borderRadius: Radius.sm,
    backgroundColor: Colors.gold,
    ...Shadow.goldSoft,
  },
  handRow: {
    position: "relative",
    height: CARD_H,
    alignSelf: "center",
  },
  handCardWrap: { position: "absolute", bottom: 0 },
  emptyHandText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.sm,
    color: Colors.gold,
  },
});
