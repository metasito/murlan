import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
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
import { Colors, FontSize, Motion, motionMs, Radius, Scrim, Shadow, Spacing } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import type { Card } from "@/lib/gameEngine";
import { computeHandLayout } from "@/components/handLayout";
import { cardAt, dropIndex } from "@/components/handOrder";
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
// The exchange's two states, `docs/design/532-exchange/mockups.html`'s option A
// verbatim. Colour cannot be the only channel that carries them
// (docs/research/2026-08-28-card-exchange-interaction.md §3.1): the giveable
// card rises and the ungiveable one drops to a third of its opacity, and
// luminance is what survives a monochrome screen. The grey is the second
// channel on top of that, never the only one. Only the giveable state moves —
// a sunk card would push past the hand row's bottom edge.
const GIVEABLE_LIFT = -8;
const UNGIVEABLE_OPACITY = 0.3;
// `filter` reaches react-native-web as raw CSS and react-native's own
// processFilter parses the same string, so the string form is the only one that
// works on both — an array serialises to `[object Object]` on web.
const UNGIVEABLE_FILTER = { filter: "grayscale(1)" } as const;
// ─── Reordering (#531) ────────────────────────────────────────────────────────
//
// A press already selects and a press on the confirm already plays, so the hold
// is the one gesture left that neither can be mistaken for — and 500ms is
// react-native-gesture-handler's own default, the number the thumb has learned
// elsewhere. Shortening it starts catching the slow taps of someone deciding
// which card to play, which is the exact moment a hand is being read
// (docs/research/2026-08-30-reordering-a-hand.md).
const HOLD_MS = 500;
// Off the fan rather than up in the air: the card stays where it came from and
// reads as one being picked out of a hand still being held.
const HELD_SCALE = 1.06;
const HELD_RISE = 8;
/** The gap opens by a whole card — unmissable, and the hand's centre holds still. */
const GAP_CARDS = 1;
const MOVE_LEFT = "moveCardLeft";
const MOVE_RIGHT = "moveCardRight";
/** The same two moves from a keyboard, which is the whole of them on web. */
const MOVE_KEYS = { ArrowLeft: MOVE_LEFT, ArrowRight: MOVE_RIGHT };
/** Past every card's own `zIndex`, which is its index in a hand of at most 21. */
const HELD_Z = 100;

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
  /**
   * Whether this card may be given, during an exchange. `undefined` outside
   * one — which is not the same as `false`, and is why this is not a boolean:
   * an ordinary hand has no ungiveable cards, it has no exchange.
   */
  giveable?: boolean;
  /** What a tap does, when it is not "play this card". */
  hint?: string;
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
  /** How far the gap under a held card pushes this one aside. */
  shiftX: number;
  /** The drag's discrete equivalents, for assistive technology (WCAG 2.5.7). */
  a11yActions?: { name: string; label?: string }[];
  /** Bound to this card's own id, the way `onPress` is. */
  onMove?: (id: string, action: string) => void;
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
  shiftX,
  faceDown = false,
  giveable,
  hint,
  a11yActions,
  onMove,
}: CardItemProps) {
  const reduceMotion = usePrefersReducedMotion();
  const liftY = useSharedValue(0);
  const tilt = useSharedValue(0);
  const glow = useSharedValue(0);
  const exchangeState = useSharedValue(0);
  const dealing = useSharedValue(dealDelay >= 0 && !reduceMotion ? 1 : 0);
  // The stagger is disarmed one render after the hand appears, so `dealDelay`
  // becomes -1 while this card is still flying in. The deal owes its timing to
  // the value the card mounted with.
  const dealDelayRef = useRef(dealDelay);
  const shift = useSharedValue(shiftX);

  // The gap is not an effect laid over the fan; it is the fan, laid out around
  // a slot. It has to open and close continuously, though, or the cards jump
  // between two arrangements while the finger is still between them.
  useEffect(() => {
    shift.value = withTiming(shiftX, { duration: motionMs("shift", reduceMotion) });
  }, [shiftX, reduceMotion, shift]);

  useEffect(() => {
    if (dealing.value === 0) return;
    dealing.value = withDelay(
      dealDelayRef.current,
      withTiming(0, { duration: DEAL_DURATION_MS, easing: DEAL_EASING })
    );
  }, [dealing]);

  useEffect(() => {
    if (reduceMotion) {
      liftY.value = withTiming(isSelected ? SELECT_LIFT : 0, { duration: Motion.duration.tap });
      tilt.value = 0;
      glow.value = withTiming(isSelected ? 1 : 0, { duration: Motion.duration.tap });
      return;
    }
    liftY.value = withSpring(isSelected ? SELECT_LIFT : 0, Motion.spring.pickup);
    tilt.value = withSpring(isSelected ? SELECT_TILT : 0, Motion.spring.pickup);
    glow.value = withTiming(isSelected ? 1 : 0, { duration: Motion.duration.tap });
  }, [isSelected, reduceMotion, liftY, tilt, glow]);

  // -1 sunk and faded, 0 untouched, +1 lifted and lit. One value rather than
  // two so a card cannot briefly be in both states as the phase turns on.
  const exchangeTarget = giveable === undefined ? 0 : giveable ? 1 : -1;
  useEffect(() => {
    exchangeState.value = reduceMotion
      ? withTiming(exchangeTarget, { duration: Motion.duration.tap })
      : withSpring(exchangeTarget, Motion.spring.land);
  }, [exchangeTarget, reduceMotion, exchangeState]);

  useEffect(
    () => () => {
      cancelAnimation(liftY);
      cancelAnimation(tilt);
      cancelAnimation(glow);
      cancelAnimation(dealing);
      cancelAnimation(exchangeState);
      cancelAnimation(shift);
    },
    [liftY, tilt, glow, dealing, exchangeState, shift]
  );

  const aStyle = useAnimatedStyle(() => {
    const d = dealing.value;
    const e = exchangeState.value;
    // The deal starts upright (0deg) and rotates into the card's own resting
    // tilt as it lands, rather than overshooting past it.
    const restRot = arcRot + tilt.value;
    const exchangeY = e >= 0 ? e * GIVEABLE_LIFT : 0;
    const faded = e >= 0 ? 1 : 1 + e * (1 - UNGIVEABLE_OPACITY);
    return {
      opacity: (1 - d) * faded,
      transform: [
        { translateX: dealFromX * d + shift.value },
        { translateY: liftY.value + exchangeY + dealRise * d },
        { rotate: `${restRot * (1 - d)}deg` },
      ],
    };
  });

  // The giveable rim rides the same textless sibling the selection bloom does,
  // for the same reason: it must never touch the card's own rasterised ranks.
  const giveableStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, exchangeState.value),
  }));

  // A textless sibling behind the card carries the selection bloom, so the
  // glow can be animated with opacity alone and never touches the card's own
  // rasterised rank characters.
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  const cardId = card.id;
  const handlePress = useCallback(() => onPress(cardId), [onPress, cardId]);
  const handleMove = useCallback(
    (action: string) => onMove?.(cardId, action),
    [onMove, cardId]
  );

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
        giveable === false && UNGIVEABLE_FILTER,
      ]}
    >
      <Animated.View pointerEvents="none" style={[handStyles.cardGlow, glowStyle]} />
      {giveable === true && (
        <Animated.View
          pointerEvents="none"
          style={[handStyles.giveableRim, { borderRadius: Radius.sm }, giveableStyle]}
        />
      )}
      <CardView
        card={card}
        selected={isSelected}
        onPress={handlePress}
        disabled={disabled}
        faceDown={faceDown}
        scale={cardScale}
        hitWidth={hitW}
        hint={hint}
        a11yActions={a11yActions}
        onA11yAction={onMove ? handleMove : undefined}
        a11yActionKeys={MOVE_KEYS}
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
    a.giveable === b.giveable &&
    a.hint === b.hint &&
    a.dealFromX === b.dealFromX &&
    a.cardScale === b.cardScale &&
    a.dealRise === b.dealRise &&
    a.hitW === b.hitW &&
    a.cardW === b.cardW &&
    a.cardH === b.cardH &&
    a.shiftX === b.shiftX &&
    a.a11yActions === b.a11yActions &&
    a.onMove === b.onMove
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
  giveableIds,
  giveHint,
  refuseHint,
  onReorder,
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
  /**
   * The cards this hand may give, during an exchange. Undefined outside one —
   * an empty array means the exchange is on and nothing qualifies, which is a
   * different hand from an ordinary one.
   */
  giveableIds?: string[];
  /** What tapping a giveable card does. Required whenever `giveableIds` is set. */
  giveHint?: string;
  /** …and why an ungiveable one refuses. */
  refuseHint?: string;
  /**
   * Puts the card at `id` in slot `to` of the hand without it — the same index
   * space the drag's own gap opens at. Omitted for any hand but the viewer's:
   * an opponent's fan and a spectated one are not arrangeable.
   */
  onReorder?: (id: string, to: number) => void;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
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
  const giveableSet = useMemo(
    () => (giveableIds === undefined ? null : new Set(giveableIds)),
    [giveableIds]
  );

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

  // A row wider than its window is moved by this offset rather than by a
  // ScrollView. The gesture below already has to arbitrate between scrolling
  // the hand and picking a card out of it — a scroller would be a third party
  // to that, one that owns the touch on web the moment it is attached
  // (`tests/e2e/handScroll.spec.ts`) and answers only to a ref the React
  // Compiler will not let this file read. A shared value answers on the UI
  // thread, identically on both platforms, and needs no ref at all.
  //
  // Measured from the middle of the hand rather than from its left edge, so
  // zero is where the row opens and no effect has to put it there: at offset 0
  // the row sits against the left edge of a box the buttons centre on, which
  // reads as the whole hand having slid sideways. Playing a card narrows the
  // overhang, and the clamp below carries the row in with it.
  const pan = useSharedValue(0);
  const panFrom = useSharedValue(0);
  const panLimit = overhang / 2;
  const rowShiftStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: -(panLimit + Math.min(Math.max(pan.value, -panLimit), panLimit)) },
    ],
  }));

  // ─── Reordering ────────────────────────────────────────────────────────────
  const canReorder = onReorder !== undefined && !disabled && !faceDown;
  const [heldId, setHeldId] = useState<string | null>(null);
  const [gapAt, setGapAt] = useState<number | null>(null);
  // What the gesture is holding, beside the state the render draws from: the
  // last `onUpdate` and the `onEnd` that follows it can land in the same frame,
  // and a drop that read the slot back out of state would use the one from
  // before the move. Shared values rather than refs — a ref touched outside an
  // effect is a React Compiler bailout for the whole file
  // (`tests/reactCompiler.test.ts`).
  const held = useSharedValue<string | null>(null);
  const gap = useSharedValue<number | null>(null);
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  // The hold, and what the finger is doing until it fires. A row wider than the
  // window has to stay scrollable by touch, and on web that is a straight
  // contest this gesture cannot both enter and lose: any handler attached to a
  // view sets `touch-action: none` on it (react-native-gesture-handler's
  // `GestureHandlerWebDelegate`), which stops the browser scrolling it, and
  // `pan-x` — the obvious remedy — hands the browser the finger and the drag
  // never reorders anything. Both were measured (`tests/e2e/handScroll.spec.ts`).
  // So the gesture arbitrates instead of the browser: it activates by hand, and
  // until the hold fires a moving finger scrolls the row itself.
  const holding = useSharedValue(false);
  const holdTimer = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  /** Where inside the card the finger landed, so it comes up under that point. */
  const grabOffset = useSharedValue(0);
  // 0 under the finger, 1 arrived in its slot. The flight it drives is the
  // *only* thing waiting on it: the reorder itself lands on a timer of the same
  // length, so a spring that never reaches rest — which `Motion.spring.pickup`
  // does not, from 0 to 1 — cannot take the card out of the hand.
  const settle = useSharedValue(0);
  const settleX = useSharedValue(0);
  const settleY = useSharedValue(0);
  const settleRot = useSharedValue(0);
  /** Held for the length of the flight, so the gesture ending cannot cut it short. */
  const landing = useSharedValue(false);
  // The held card is the only thing on this table that leaves the arc and
  // follows a finger in free two dimensions, which is what makes "held" legible
  // beside "selected" without a legend — selection has already spent lift,
  // rotation and a border.
  const heldStyle = useAnimatedStyle(() => {
    const p = settle.value;
    // The wrapper sits at the row's own origin, so a card at `left: L` and
    // `bottom: B` is this same box translated by (L, −B).
    const fromX = fingerX.value - grabOffset.value;
    const fromY = fingerY.value - HELD_RISE - (visibleH - cardH / 2);
    return {
      transform: [
        { translateX: fromX + (settleX.value - fromX) * p },
        { translateY: fromY + (settleY.value - fromY) * p },
        { rotate: `${settleRot.value * p}deg` },
        { scale: HELD_SCALE + (1 - HELD_SCALE) * p },
      ],
    };
  });

  // WCAG 2.5.7: reordering is a convenience rather than something the game
  // needs, so the drag has to have a single-pointer equivalent. It is two
  // discrete actions on the card itself, which costs no pixels and shows to
  // nobody who is not asking for it — the same answer `Slider` and
  // `ReplayControls` already give.
  const moveActions = useMemo(
    () => [
      { name: MOVE_LEFT, label: t("gameTable.moveCardLeft") },
      { name: MOVE_RIGHT, label: t("gameTable.moveCardRight") },
    ],
    [t]
  );
  const moveByAction = useCallback(
    (id: string, action: string) => {
      const from = cards.findIndex((card) => card.id === id);
      if (from === -1) return;
      // The slot index is measured in the hand *without* this card, so the
      // card's own index is where it already is and one either side is a step.
      const to = action === MOVE_LEFT ? from - 1 : from + 1;
      if (to < 0 || to > cards.length - 1) return;
      onReorder?.(id, to);
    },
    [cards, onReorder]
  );

  if (n === 0) {
    return (
      <View style={[handStyles.handCenter, { width: availW, height: visibleH }]}>
        <Ionicons name="checkmark-circle" size={24} color={Colors.gold} />
        <TableText style={handStyles.emptyHandText}>{t("gameShared.emptyHand")}</TableText>
      </View>
    );
  }

  // The cards still in the fan. A held one is laid out by the finger instead,
  // and the rest are arced as a hand of n−1 inside the row's own unchanged box
  // — which is the whole of "the fan closes behind the card that left".
  const heldCard = heldId === null ? null : (cards.find((c) => c.id === heldId) ?? null);
  const rest = heldCard === null ? cards : cards.filter((c) => c.id !== heldCard.id);

  // Solved for the span the step produced, so the arc and the overlap floor
  // cannot disagree about how wide the hand is.
  const solve = (count: number) =>
    solveArc(count, { budget: HAND_ARC, cardW, cardH, scale: cardScale, room: totalW, step });
  // Two arcs: where the whole hand sits, and where the rest of it closes to
  // with one card lifted out. Every card is *placed* by the first and moved to
  // the second, so the closing is one animated value rather than a new `left`
  // landing in a single frame — the fan has to close continuously, or the cards
  // jump between two arrangements while the finger is still between them.
  const full = solve(n);
  const arc = heldCard === null ? full.cards : solve(rest.length).cards;
  const box = full.box;
  const rowMid = (scrollable ? totalW : rowW) / 2;
  const place = new Map(cards.map((card, j) => [card.id, full.cards[j]]));
  // Split either side of the slot, so the hand's centre holds still while the
  // gap opens and nothing shifts out from under the thumb.
  const gapW = heldCard === null ? 0 : cardW * GAP_CARDS;
  const gapShift = (slot: number) =>
    gapAt === null ? 0 : slot >= gapAt ? gapW / 2 : -gapW / 2;
  // Where the drop index is measured from: the arc without the gap in it. The
  // gap is a consequence of the slot, so measuring the slot against a row the
  // gap has already moved makes the two chase each other.
  const lefts = arc.map((at) => rowMid + at.x);
  const ids = rest.map((card) => card.id);
  // Where each slot of the *whole* hand sits — where a released card is going.
  const slots = full.cards.map((at) => ({ x: rowMid + at.x, y: crop + at.y, rot: at.rot }));

  const releaseHeld = () => {
    landing.value = false;
    holding.value = false;
    settle.value = 0;
    held.value = null;
    gap.value = null;
    setHeldId(null);
    setGapAt(null);
  };

  const grab = (x: number) => {
    const i = cardAt(lefts, cardW, x);
    if (i === null) return;
    // The card comes up under the part of it the finger is actually on. Every
    // card but the last shows only a `step`-wide strip, so a finger almost
    // always lands near a left edge, and centring the card on it instead threw
    // it half a card sideways at the moment of pickup.
    grabOffset.value = x - lefts[i];
    holding.value = true;
    held.value = ids[i];
    gap.value = i;
    setHeldId(ids[i]);
    setGapAt(i);
  };

  /** The hold's own clock. It survives a finger that never moves, which is the point. */
  const armHold = (x: number) => {
    clearTimeout(holdTimer.value);
    holdTimer.value = setTimeout(() => grab(x), HOLD_MS) as unknown as number;
  };
  const disarmHold = () => {
    clearTimeout(holdTimer.value);
    holdTimer.value = 0;
  };

  const trackGap = (x: number) => {
    if (held.value === null) return;
    const at = dropIndex(lefts, cardW, x);
    if (at === gap.value) return;
    gap.value = at;
    setGapAt(at);
  };

  // The card settles into the slot the gap has been holding open, and the fan
  // takes it back at the moment it arrives, so the handover happens at one
  // position rather than as a jump between two. The clock is what hands it
  // over, never the animation finishing: `Motion.spring.pickup` run from 0 to 1
  // rings for over a second without ever reaching reanimated's rest thresholds,
  // and a card whose return waits on that is a card taken out of the hand.
  const drop = () => {
    const id = held.value;
    const at = gap.value;
    if (id === null || at === null) {
      releaseHeld();
      return;
    }
    const commit = () => {
      releaseHeld();
      onReorder?.(id, at);
    };
    const ms = motionMs("shift", reduceMotion);
    const target = slots[at] ?? slots[slots.length - 1];
    if (target === undefined || ms === 0) {
      commit();
      return;
    }
    landing.value = true;
    settleX.value = target.x;
    settleY.value = target.y;
    settleRot.value = target.rot;
    // The same step the gap closes on, so the card arrives as the fan closes
    // around it rather than into a hand still moving.
    settle.value = withTiming(1, { duration: ms });
    setTimeout(commit, ms);
  };

  // Built on every render rather than memoised, like `Slider`'s: a hook whose
  // argument writes a shared value is a React Compiler bailout for the whole
  // file (`tests/reactCompiler.test.ts`), and `GestureDetector` takes a fresh
  // gesture cheaply.
  const drag = Gesture.Pan()
    // One finger owns the drag. A second one anywhere would otherwise rewrite
    // where the held card is going, and the first is left holding a card the
    // pointer that picked it up can no longer put down.
    .maxPointers(1)
    .enabled(canReorder)
    // Activated by hand rather than by `activateAfterLongPress`, which is a hard
    // gate this needs to be a soft one: it fails the whole gesture the moment
    // the finger travels 15px before the hold lands, so a thumb that rolls gets
    // nothing at all — and worse, it leaves the browser no way to scroll a row
    // wider than the window. Until the hold fires, a moving finger scrolls.
    .manualActivation(true)
    .onTouchesDown((e) => {
      const touch = e.allTouches[0];
      if (touch === undefined) return;
      fingerX.value = touch.x;
      fingerY.value = touch.y;
      grabX.value = touch.x;
      grabY.value = touch.y;
      panFrom.value = pan.value;
      scheduleOnRN(armHold, touch.x);
    })
    .onTouchesMove((e, state) => {
      const touch = e.allTouches[0];
      if (touch === undefined) return;
      fingerX.value = touch.x;
      fingerY.value = touch.y;
      if (holding.value) {
        state.activate();
        return;
      }
      // Not held: the finger is reading the hand, so it moves the row rather
      // than a card. Anything but a horizontal drag is somebody else's gesture.
      const dx = touch.x - grabX.value;
      if (Math.abs(dx) > Math.abs(touch.y - grabY.value)) {
        scheduleOnRN(disarmHold);
        if (overhang > 0) pan.value = panFrom.value - dx;
      }
    })
    .onUpdate((e) => {
      fingerX.value = e.x;
      fingerY.value = e.y;
      scheduleOnRN(trackGap, e.x);
    })
    .onEnd(() => {
      // Claimed here rather than in `drop`: `onFinalize` runs on this thread the
      // moment this returns, while `drop` is still queued on the other one, so a
      // flag `drop` set would be read as false and the flight cancelled before
      // it began.
      landing.value = true;
      scheduleOnRN(drop);
    })
    // A gesture the system takes away — an incoming call, a swipe from the
    // edge — never reaches onEnd, and the card it lifted would float there for
    // the rest of the hand.
    .onFinalize(() => {
      scheduleOnRN(disarmHold);
      if (landing.value) return;
      scheduleOnRN(releaseHeld);
    });
  // The middle card rides highest, so the row is as tall as the card plus the
  // climb; the whole arc is then pushed past the bottom edge by the crop.
  const arcRise = box.h - cardH;

  const row = (
    <GestureDetector gesture={drag}>
    <View
      style={[
        handStyles.handRow,
        { width: scrollable ? totalW : rowW, height: visibleH },
      ]}
    >
      {arc.map((at, i) => {
        const giveable = giveableSet?.has(rest[i].id);
        // Placed where it sits in the whole hand; moved from there to where the
        // closed fan wants it, plus its share of the gap.
        const home = place.get(rest[i].id) ?? at;
        // A card the exchange has ruled out is a control reporting itself
        // unavailable; offering it two working actions anyway says the opposite
        // in the same breath.
        const arrangeable = canReorder && giveable !== false;
        return (
        <CardItem
          key={rest[i].id}
          card={rest[i]}
          isSelected={selectedSet.has(rest[i].id)}
          left={rowMid + home.x}
          shiftX={at.x - home.x + gapShift(i)}
          bottom={-crop - home.y}
          arcRot={home.rot}
          onPress={onPress}
          a11yActions={arrangeable ? moveActions : undefined}
          onMove={arrangeable ? moveByAction : undefined}
          // An ungiveable card during an exchange is a button that reports
          // itself unavailable, rather than one that silently does nothing.
          disabled={disabled || giveable === false}
          giveable={giveable}
          hint={giveable === undefined ? undefined : giveable ? giveHint : refuseHint}
          faceDown={faceDown}
          zIndex={i}
          dealDelay={dealArmed ? i * Motion.stagger.deal : -1}
          dealFromX={-home.x - cardW / 2}
          cardScale={cardScale}
          dealRise={dealRise}
          // Every card but the last is covered from `step` on by the one drawn
          // over it, so that strip is all of it a tap can reach.
          hitW={i === arc.length - 1 ? cardW : step}
          cardW={cardW}
          cardH={cardH}
        />
        );
      })}
      {heldCard !== null && (
        <Animated.View
          pointerEvents="none"
          style={[
            handStyles.handCardWrap,
            { left: 0, bottom: 0, zIndex: HELD_Z, width: cardW, height: cardH },
            heldStyle,
          ]}
        >
          <CardView
            card={heldCard}
            selected={selectedSet.has(heldCard.id)}
            faceDown={faceDown}
            scale={cardScale}
            decorative
            noLift
          />
        </Animated.View>
      )}
    </View>
    </GestureDetector>
  );

  return (
    <View style={[handStyles.handCenter, { width: availW, height: visibleH + arcRise }]}>
      <View style={handStyles.handGlowWrap}>
        {scrollable ? (
          // The hand compresses inside its share, so this is reached only when
          // even the finger floor cannot fit the row in availW — a full hand on
          // a small phone. The row overflows and is moved under a window that
          // clips it, rather than clipping the hand or stepping below what a
          // thumb can separate. The window keeps HAND_ROW_HEADROOM as top
          // padding — without it, a selected card's lift (SELECT_LIFT) is cut
          // off at the top edge.
          <View
            style={{
              width: availW,
              height: visibleH + arcRise + HAND_ROW_HEADROOM,
              paddingTop: HAND_ROW_HEADROOM,
              overflow: "hidden",
            }}
          >
            <Animated.View style={[{ width: totalW }, rowShiftStyle]}>{row}</Animated.View>
          </View>
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
  // A rim rather than a fill: the card underneath has to stay readable while
  // it is lit, and this sibling never touches its rasterised rank glyphs.
  giveableRim: {
    position: "absolute",
    top: -2, left: -2, right: -2, bottom: -2,
    borderWidth: 2,
    borderColor: Colors.gold,
    ...Shadow.goldSoft,
  },
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
