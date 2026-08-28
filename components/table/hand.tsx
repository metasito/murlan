import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { TableText } from "./TableText";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withDelay,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CardView } from "@/components/CardView";
import { Colors, FontSize, Motion, Radius, Scrim, Shadow, Spacing } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import type { Card } from "@/lib/gameEngine";
import { computeHandLayout } from "@/components/handLayout";
import { HAND_ARC, solveArc } from "@/components/tableArc";
import { HAND_CROP, HAND_ROW_HEADROOM } from "@/components/gameTableModel";
import {
  CARD_W,
  CARD_H,
  CARD_BACK_W,
  CARD_BACK_H,
  HAND_NEAR_RATIO,
  HAND_SCALE,
  HAND_SCALE_ON_TURN,
} from "@/components/cardFaceModel";

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
// A deal drops from above the table, not up out of the middle of it — a fixed
// distance (scaled with the hand), not one derived from the card's own
// height. Every value here is the prototype's own `deal` keyframe verbatim,
// short of its scale-from-0.7: `tests/e2e/a11yOverlays.spec.ts` measures a
// rank glyph's own ink overflow in untransformed px, so a `scale` transform
// on the card — unlike its translate and rotate — reads as new clipping the
// glyph never actually has.
const DEAL_RISE_PX = -170;
const DEAL_DURATION_MS = 500;
const DEAL_EASING = Easing.bezier(0.2, 0.85, 0.3, 1);

interface CardItemProps {
  card: Card;
  isSelected: boolean;
  left: number;
  /** How far the card's own bottom sits below the row's, from the arc. */
  bottom: number;
  /** The card's own tilt on the arc, in degrees. */
  arcRot: number;
  onPress: (id: string) => void;
  disabled: boolean;
  zIndex: number;
  /** Draw the back — the hand belongs to someone else. */
  faceDown?: boolean;
  /** ms to wait before this card flies in, or -1 for no deal animation. */
  dealDelay: number;
  /** Horizontal distance back to the deck, so the fan converges on one point. */
  dealFromX: number;
  /** The table's own scale, times HAND_SCALE — this hand's card size. */
  cardScale: number;
  /** Vertical distance a dealt card rises from, derived from that same size. */
  dealRise: number;
  /** The strip of this card a tap can reach — the rest is under its neighbour. */
  hitW: number;
  /**
   * The card's own box. Passed in rather than derived from `cardScale`: a
   * spectated hand draws backs, which are their own aspect, and the row's arc
   * is solved against whichever of the two CardView will actually draw.
   */
  cardW: number;
  cardH: number;
}

function CardItemBase({
  card,
  isSelected,
  left,
  bottom,
  arcRot,
  onPress,
  disabled,
  zIndex,
  dealDelay,
  dealFromX,
  cardScale,
  dealRise,
  hitW,
  cardW,
  cardH,
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
      withTiming(0, { duration: DEAL_DURATION_MS, easing: DEAL_EASING })
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
    // The deal starts upright (0deg) and rotates into the card's own resting
    // tilt as it lands, rather than overshooting past it.
    const restRot = arcRot + tilt.value;
    return {
      opacity: 1 - d,
      transform: [
        { translateX: dealFromX * d },
        { translateY: liftY.value + dealRise * d },
        { rotate: `${restRot * (1 - d)}deg` },
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
      style={[
        handStyles.handCardWrap,
        // The card's own box, stated rather than taken from the child: the
        // child is only as wide as this card's tap strip, and a wrapper that
        // narrowed with it would rotate the card about a point left of its
        // centre and bend the fan.
        { left, bottom, zIndex, width: cardW, height: cardH },
        aStyle,
      ]}
    >
      <Animated.View pointerEvents="none" style={[handStyles.cardGlow, glowStyle]} />
      <CardView
        card={card}
        selected={isSelected}
        onPress={handlePress}
        disabled={disabled}
        faceDown={faceDown}
        scale={cardScale}
        hitWidth={hitW}
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
    a.bottom === b.bottom &&
    a.arcRot === b.arcRot &&
    a.onPress === b.onPress &&
    a.disabled === b.disabled &&
    a.zIndex === b.zIndex &&
    a.faceDown === b.faceDown &&
    a.dealFromX === b.dealFromX &&
    a.cardScale === b.cardScale &&
    a.dealRise === b.dealRise &&
    a.hitW === b.hitW &&
    a.cardW === b.cardW &&
    a.cardH === b.cardH
  );
}

const CardItem = React.memo(CardItemBase, cardItemPropsEqual);
CardItem.displayName = "CardItem";

// ─── The two sizes ────────────────────────────────────────────────────────────
//
// The hand is drawn bigger while the turn is the viewer's own — nearer, so
// bigger, and so the same fraction more air between the cards, because the
// share the row aims at grows with the card (`HAND_NEAR_RATIO`).
//
// Both sizes are real layout, and the change between them is a cut rather than
// a transition — a decision with its evidence, not an omission: `docs/BRIEF.md`
// §3.2. The short of it is that web rasterises text before transforming it, so
// a card under a `scale` carries a rank glyph `tests/e2e/a11yOverlays.spec.ts`
// reads as clipped, and a turn changes hands too often for the animation ever
// to be settled when something looks.

// ─── StraightHand ─────────────────────────────────────────────────────────────

export function StraightHand({
  cards,
  selectedIds,
  onPress,
  disabled,
  availW,
  roomW,
  isMyTurn,
  faceDown = false,
  scale = 1,
}: {
  cards: Card[];
  selectedIds: string[];
  onPress: (id: string) => void;
  disabled: boolean;
  /** The hard width: past it the row scrolls rather than clip or bury a card. */
  availW: number;
  /** The share of the table the hand aims at — see HAND_WIDTH_SHARE. */
  roomW: number;
  isMyTurn?: boolean;
  /** Draw backs instead of faces — the hand belongs to someone else. */
  faceDown?: boolean;
  /** The table's own scale — this hand draws its cards at `scale * HAND_SCALE`. */
  scale?: number;
}) {
  const { t } = useTranslation();
  const n = cards.length;
  const onTurn = isMyTurn === true;
  // Bigger cards *and* the same fraction more air between them: the share the
  // row aims at grows with the card, so the fan opens rather than just
  // overlapping harder at a larger size.
  const cardScale = scale * (onTurn ? HAND_SCALE_ON_TURN : HAND_SCALE);
  const room = onTurn ? roomW * HAND_NEAR_RATIO : roomW;
  // A spectated hand draws backs (CardItem passes faceDown straight to
  // CardView), which are their own narrower aspect — the row's own layout
  // math has to size against the same dimensions CardView actually draws.
  const cardW = faceDown ? CARD_BACK_W(cardScale) : CARD_W(cardScale);
  const cardH = faceDown ? CARD_BACK_H(cardScale) : CARD_H(cardScale);
  // The bottom edge crops the card; only the redundant upside-down index at
  // its foot is lost, and the row keeps the height that buys for the table.
  const crop = cardH * HAND_CROP;
  const visibleH = cardH - crop;
  const dealRise = DEAL_RISE_PX * cardScale;
  // O(1) membership check per card instead of `selectedIds.includes(card.id)`
  // (an O(k) scan repeated for every one of the up to 21 cards in a hand).
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

  // The overlap step is solved against the share, not against everything the
  // row could reach — a hand of three does not stretch across the felt, and a
  // hand of twenty-one compresses inside the same span rather than reaching
  // past it. Only `availW` is hard: past that the row scrolls. Solved above
  // the empty-hand return so the scroll effect below it can be a hook.
  const { step, totalW, scrollable } = computeHandLayout(n, room, cardW, availW);
  const rowW = Math.min(totalW, availW);
  /** How much of a scrolling row lies outside the window, both ends together. */
  const overhang = Math.max(0, totalW - availW);

  // The row opens on its own middle rather than its left edge. `contentOffset`
  // is honoured on the first frame on iOS and ignored outright on web, so the
  // position has to be set once the view exists — and again whenever the hand
  // changes size, or playing a card leaves the row scrolled off to one side.
  const scroller = useRef<ScrollView>(null);
  useEffect(() => {
    if (overhang === 0) return;
    scroller.current?.scrollTo({ x: overhang / 2, animated: false });
  }, [overhang]);

  if (n === 0) {
    return (
      <View style={[handStyles.handCenter, { width: availW, height: visibleH }]}>
        <Ionicons name="checkmark-circle" size={24} color={Colors.gold} />
        <TableText style={handStyles.emptyHandText}>{t("gameShared.emptyHand")}</TableText>
      </View>
    );
  }

  // Solved for the span the step produced, so the arc and the overlap floor
  // cannot disagree about how wide the hand is.
  const { cards: arc, box } = solveArc(n, {
    budget: HAND_ARC,
    cardW,
    cardH,
    scale: cardScale,
    room: totalW,
    step,
  });
  // The middle card rides highest, so the row is as tall as the card plus the
  // climb; the whole arc is then pushed past the bottom edge by the crop.
  const arcRise = box.h - cardH;

  const row = (
    <View
      style={[
        handStyles.handRow,
        { width: scrollable ? totalW : rowW, height: visibleH },
      ]}
    >
      {arc.map((place, i) => (
        <CardItem
          key={cards[i].id}
          card={cards[i]}
          isSelected={selectedSet.has(cards[i].id)}
          left={(scrollable ? totalW : rowW) / 2 + place.x}
          bottom={-crop - place.y}
          arcRot={place.rot}
          onPress={onPress}
          disabled={disabled}
          faceDown={faceDown}
          zIndex={i}
          dealDelay={dealArmed ? i * Motion.stagger.deal : -1}
          dealFromX={-place.x - cardW / 2}
          cardScale={cardScale}
          dealRise={dealRise}
          // Every card but the last is covered from `step` on by the one drawn
          // over it, so that strip is all of it a tap can reach.
          hitW={i === arc.length - 1 ? cardW : step}
          cardW={cardW}
          cardH={cardH}
        />
      ))}
    </View>
  );

  return (
    <View style={[handStyles.handCenter, { width: availW, height: visibleH + arcRise }]}>
      <View style={handStyles.handGlowWrap}>
        {scrollable ? (
          // The hand compresses inside its share, so this is reached only when
          // even the finger floor cannot fit the row in availW — a full hand on
          // a small phone. Scroll instead of clipping or of stepping below what
          // a thumb can separate. A ScrollView clips at its own bounds, so the
          // row keeps HAND_ROW_HEADROOM as top padding inside it — without it,
          // a selected card's lift (SELECT_LIFT) is cut off at the top edge.
          <ScrollView
            ref={scroller}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ width: availW, height: visibleH + arcRise + HAND_ROW_HEADROOM }}
            contentContainerStyle={{ paddingTop: HAND_ROW_HEADROOM, width: totalW }}
            // Opens on the middle of the hand. At offset 0 the row is against
            // the left edge of a box the buttons centre on, which reads as the
            // whole hand having slid sideways. `contentOffset` alone is the
            // first frame on iOS and nothing at all on web — the effect below
            // is what actually holds it there.
            contentOffset={{ x: overhang / 2, y: 0 }}
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
    flexDirection: "row",
    gap: Spacing.slim,
  },
  handGlowWrap: { borderRadius: Radius.md, padding: Spacing.xs },
  cardGlow: {
    position: "absolute",
    top: 2, left: 2, right: 2, bottom: 2,
    borderRadius: Radius.sm,
    backgroundColor: Colors.gold,
    ...Shadow.goldSoft,
  },
  handRow: {
    position: "relative",
    alignSelf: "center",
  },
  handCardWrap: { position: "absolute" },
  // Its own plate. Under a lamp that moves, the felt has no reliably dark end
  // to sit on: the brightest cloth on the table is wherever the light is.
  emptyHandText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.sm,
    color: Colors.gold,
    backgroundColor: Scrim.heavy,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    overflow: "hidden",
  },
});
