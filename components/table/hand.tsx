import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Platform, View, StyleSheet } from "react-native";
import {
  GestureDetector,
  GestureStateManager,
  PointerType,
  usePanGesture,
  useSimultaneousGestures,
  useTapGesture,
} from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { EmptyHandLine } from "./notices/tableLines";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  cancelAnimation,
  Easing,
  ReduceMotion,
  type DerivedValue,
  type SharedValue,
} from "react-native-reanimated";
import { CardView, FallbackGlow, PRESS_RISE, PRESS_TILT } from "@/components/CardView";
import { CardGlow, Colors, Layer, Motion, motionMs, Radius, Scrim, Shadow, Spacing } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import type { Card } from "@/lib/game/gameEngine";
import {
  HELD_SCALE,
  SELECT_TILT,
  cardUnder,
  entryOffset,
  layoutHandRow,
  restingOrigin,
  type CardPlace,
} from "@/components/handLayout";
import { dropIndex, lendBack } from "@/components/handOrder";
import { byId, propsEqualExcept, shallowEqual } from "@/lib/memo";
import type { HandSelection } from "./useSelection";
import type { SettledSelection } from "./selectionLeaves";
import { DEAL_FLIGHT_MS, dealLeaveMs } from "@/lib/game/dealTimeline";
import { dealEase, handDealArc } from "@/components/table/dealPose";
import { handRowHeadroom } from "@/components/seatLayout";
import { CARD_W, cardRadius, FIELD_SCALE, handCardSize, type HandCardSize } from "@/components/cardFaceModel";
import type { CardFrom } from "@/components/flightPose";
import { readHandArrival } from "@/components/flightPhysics";
import type { ExchangeStages } from "@/components/table/exchangeModel";
import { useSameCards } from "@/components/useSameCards";
import type { ExchangeAnnounceData } from "@/lib/game/sharedGameFlow";
import { designRect, handCard, panShown, type Felt, type HandPlace, type TableMotion } from "./cardRects";
import { useCardRect, useCardTable, type CardTable } from "./useCardRects";
import { handCardZ, handPaintOrder } from "./cardShadows";

/**
 * The viewer's hand as the table draws it while a exchanged card is on its way in or out.
 *
 * Held back at display rather than by deferring the state: online the state is
 * the server's, and freezing a whole snapshot for the length of a phase would
 * swallow every other thing that arrives in that window. Arranged first and
 * filtered second, so the card lands in the place the player arranged for it
 * instead of re-entering an order computed without it.
 */
export function useHandArrival(input: {
  hand: Card[];
  /** The engine's order and the player's, which place a lent card back in its arranged slot. */
  sorted: Card[];
  order: readonly string[];
  announced: ExchangeAnnounceData | null;
  stages: ExchangeStages;
  viewerSeat: number | null;
}): { handOnTable: Card[]; holding: boolean; arrivingIndex?: number; descendingId?: string; receivedId?: string } {
  const first = readHandArrival(input);
  const lent = first.lent;
  const hand = lent ? lendBack(input.sorted, lent, input.order) : input.hand;
  const { withheldIds, arrivingIndex, descendingId, receivedId } = lent ? readHandArrival({ ...input, hand }) : first;
  const handOnTable = useSameCards(withheldIds.length === 0 ? hand : hand.filter((c) => !withheldIds.includes(c.id)));
  return { handOnTable, holding: withheldIds.length > 0 || lent !== undefined, arrivingIndex, descendingId, receivedId };
}

// ─── CardItem ─────────────────────────────────────────────────────────────────
//
// `onActivate` takes the card id rather than a bound zero-arg callback, so the
// caller passes one unchanged reference for every card and CardItem binds its
// own id once. CardView then sees a new `onActivate` only when this card's id or
// the callback changes — not when some other card's selection does.
// A selected card tips as it is picked up (`SELECT_TILT`): the rotation is what
// stops the lift reading as a flat slide. The lift itself is `handRowHeadroom`, a
// share of the card, so the row's reserved headroom cannot fall short of it.
const DESCEND_EASING = Easing.bezier(0.2, 0.85, 0.3, 1);
// The exchange's two states. Colour cannot be the only channel that carries
// them, and it is not: the ungiveable card recedes under a veil, which is
// luminance and survives a monochrome screen, while the giveable one glows,
// which is light against none.
//
// Neither of them *moves*. An earlier mockup's option A
// lifted the giveable card, and a lift reads well on a mockup of six evenly
// spaced ones. In the fan it splits the row into a high half and a low half
// with a step between them, and a hand that is not level reads as broken rather
// than as sorted (reported 2026-08-31, twice).
//
// The dim is laid *over* the card rather than taken out of the card's own
// opacity. A fan overlaps by design, so a translucent card is one the cards
// behind it show through: six of them together read as a rendering fault
// rather than as six cards that cannot be given, and the felt shows through
// the lot. An opaque veil recedes the card and stacks with nothing.
const UNGIVEABLE_DIM = Scrim.medium;
// `filter` reaches react-native-web as raw CSS and react-native's own
// processFilter parses the same string, so the string form is the only one that
// works on both — an array serialises to `[object Object]` on web.
const UNGIVEABLE_FILTER = { filter: "grayscale(1)" } as const;
// The giveable halo: a flat fill behind the card, wider than it by a fixed
// rim, never painted on the card's own face — a fan exposes only a sliver of
// most cards in the run, mostly the top-left index, and that is the one thing
// the marker must never sit on top of.
//
// The rim is flat rather than blurred: a blurred glow's radius fans out in a
// full circle at a corner and only a thin line along a straight edge, so
// wherever the fan's overlap leaves just a corner exposed it reads as a
// brighter smear than the rest of the run (reported 2026-09-02, iOS). A flat
// fill has no radius to concentrate — every exposed sliver, corner or edge,
// shows the same rim.


// ─── Reordering (#531) ────────────────────────────────────────────────────────
//
// A press already selects and a press on the confirm already plays, so the hold
// is the one gesture left that neither can be mistaken for — and 500ms is
// react-native-gesture-handler's own default, the number the thumb has learned
// elsewhere. Shortening it starts catching the slow taps of someone deciding
// which card to play, which is the exact moment a hand is being read.
const HOLD_MS = 500;
/**
 * How far the finger travels before the hold becomes a drag. The gate the tap
 * needs: below it the press belongs to the card it is on, so selecting one to
 * play cannot be spent on a rearrangement nobody asked for. It is
 * react-native-gesture-handler's own default pan distance, a hand's width above
 * the wobble a thumb has while it decides.
 */
const DRAG_SLOP = 10;
/** A one-off off the scale: no duration at all, since a press however long is still a press. `setTimeout` fires at once past it. */
const ANY_PRESS_MS = 2 ** 31 - 1;
// Off the fan rather than up in the air: the card stays where it came from and
// reads as one being picked out of a hand still being held.
const HELD_RISE = 8;
/** The gap opens by a whole card — unmissable, and the hand's centre holds still. */
const GAP_CARDS = 1;
const MOVE_LEFT = "moveCardLeft";
const MOVE_RIGHT = "moveCardRight";
/** The same two moves from a keyboard, which is the whole of them on web. */
const MOVE_KEYS = { ArrowLeft: MOVE_LEFT, ArrowRight: MOVE_RIGHT };
/** Directly over the card it dims, so it is derived from its band rather than guessed. */
const VEIL_Z = Layer.table + 1;
/** The halo sits behind the card, on the same step the selection bloom does. */
const GIVEABLE_HALO_Z = Layer.felt;
/** How far past the card's own edge the halo's rim shows. */
const GIVEABLE_HALO_PAD = 2;

/**
 * Past every card's own `zIndex`, which is its index in a hand of at most 18,
 * or that index lifted by the row's count while the exchange marks it
 * giveable — clamped short of this, so the bound holds for any hand size
 * rather than resting on one never being dealt.
 */
const HELD_Z = Layer.held;

const NO_OFFSET = { dx: 0, dy: 0 };

interface CardItemProps {
  card: Card;
  /** The selection, which this card's accessible state follows by its own membership. */
  store: SettledSelection;
  /** Where the row puts it, the shift to where it is drawn included: a resize carries the card in from the last one. */
  place: CardPlace;
  /**
   * The box CardView draws at `size.scale`. A spectated hand draws backs, which are their own
   * aspect, and the row's arc is solved against whichever of the two CardView will draw.
   */
  size: HandCardSize;
  entry: CardEntry;
  onActivate: (id: string) => void;
  /** The selection on the UI thread, which the lift, tilt and glow follow. */
  shown: DerivedValue<string[]>;
  /** The card under a finger that has not yet lifted. */
  pressed: SharedValue<string | null>;
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
  /**
   * Set only on the card the opening play must include, so a device flow can
   * name it instead of counting to it. Maestro's `index` sorts by position, and
   * the arc puts the outermost card a pixel below its neighbours — enough to
   * sort it last (#757).
   */
  isStartCard: boolean;
  /** The drag's discrete equivalents, for assistive technology (WCAG 2.5.7). */
  a11yActions?: { name: string; label?: string }[];
  /** Bound to this card's own id, the way `onPress` is. */
  onMove?: (id: string, action: string) => void;
  /** Hands the hand this card's drawn lift, tilt and shift, for a throw that leaves mid-lift. */
  onDrawn?: (id: string, drawn: DrawnCard) => void;
  /** Just received in an exchange: it glows for `Motion.exchange.highlight`. */
  received?: boolean;
  /** Ids drawn by an exchange flier instead, set on the UI thread on the frame it shows. */
  hidden?: SharedValue<string[]>;
  rects?: HandRects;
}

interface DrawnCard { liftY: SharedValue<number>; tilt: SharedValue<number>; shift: SharedValue<number> }

/** A card dealt from the pile on the deal's clock, `onDealt` given its landing point in design points. */
interface CardDeal { clock: SharedValue<number>; leaveMs: number; onDealt: (x: number, y: number) => void }

/**
 * How a card comes into the row. `dx`/`dy` lead back to where it comes from, and follow the row.
 * `deal` and `descends` are read once, at mount: the deal is disarmed one render after the hand
 * appears, while its cards are still flying in.
 */
interface CardEntry {
  dx: number;
  dy: number;
  deal?: CardDeal;
  descends: boolean;
}

/** The deal under way, on its own clock: `pile` is where it flies from, off the hand zone's centre. */
export interface HandDeal { offsetMs: number; clock: SharedValue<number>; pile: { dx: number; dy: number }; onDealt: (x: number, y: number) => void }

/** The registry apart from the place: a mapper reading it would re-run on its own every write. */
interface HandRects {
  table: CardTable;
  place: HandPlace & { felt: Felt; pan: SharedValue<number>; panLimit: number; lift: SharedValue<number>; motion: SharedValue<TableMotion> };
}

function CardItemBase({
  card,
  store,
  place: at,
  size,
  entry,
  onActivate,
  shown,
  pressed,
  disabled,
  zIndex,
  isStartCard,
  faceDown = false,
  giveable,
  hint,
  a11yActions,
  onMove,
  onDrawn,
  received = false,
  hidden,
  rects,
}: CardItemProps) {
  const { left, bottom, rot: arcRot, shift: shiftX, hitW, restX, restY } = at;
  const { w: cardW, h: cardH } = size;
  const { dx: dealFromX, dy: dealRise } = entry;
  const reduceMotion = usePrefersReducedMotion();
  const halo = useSharedValue(0);
  useEffect(() => {
    if (!received) return;
    const edge = Motion.duration.tap;
    halo.value = withSequence(
      withTiming(1, { duration: edge }),
      withTiming(1, { duration: Motion.exchange.highlight - 2 * edge }),
      withTiming(0, { duration: edge })
    );
    return () => cancelAnimation(halo);
  }, [received, halo]);
  const haloStyle = useAnimatedStyle(() => ({ opacity: halo.value }));
  const selectLift = -handRowHeadroom(cardH);
  const liftY = useSharedValue(0);
  const tilt = useSharedValue(0);
  const glow = useSharedValue(0);
  const exchangeState = useSharedValue(0);
  const [mounted] = useState(entry);
  const dealing = useSharedValue(mounted.descends && !reduceMotion ? 1 : 0);
  const mountedDeal = mounted.deal;
  // Reduced motion ends the deal's clock, so a card still waiting on it would never be shown.
  const dealt = reduceMotion ? undefined : mountedDeal;
  const dealClock = dealt?.clock;
  const dealAt = dealt ? dealt.leaveMs : -1;
  const onDealt = dealt?.onDealt;
  const shift = useSharedValue(shiftX);

  // The gap is not an effect laid over the fan; it is the fan, laid out around
  // a slot. It has to open and close continuously, though, or the cards jump
  // between two arrangements while the finger is still between them.
  useEffect(() => {
    shift.value = withTiming(shiftX, { duration: motionMs("shift", reduceMotion), reduceMotion: ReduceMotion.Never });
  }, [shiftX, reduceMotion, shift]);

  useEffect(() => {
    if (dealing.value === 0) return;
    dealing.value = withTiming(0, { duration: Motion.exchange.descend, easing: DESCEND_EASING, reduceMotion: ReduceMotion.System });
  }, [dealing]);

  const press = useSharedValue(0);
  const posed = useSharedValue("");
  const pressPosed = useSharedValue("");
  const cardId = card.id;
  const isSelected = useSyncExternalStore(store.subscribe, () => store.get().ids.includes(cardId));
  // Keyed on every input, not on the selection's edge: a reaction keeps its previous value across a
  // change of dependencies, so a turn that resizes the card would otherwise leave the lift behind.
  useAnimatedReaction(
    () => shown.value.includes(cardId),
    (on) => {
      const key = `${on}|${selectLift}|${reduceMotion}`;
      if (key === posed.value) return;
      const first = posed.value === "";
      posed.value = key;
      if (first && !on) return;
      glow.value = withTiming(on ? 1 : 0, { duration: Motion.duration.tap });
      if (reduceMotion) {
        liftY.value = withTiming(on ? selectLift : 0, { duration: Motion.duration.tap });
        tilt.value = 0;
        return;
      }
      liftY.value = withSpring(on ? selectLift : 0, Motion.spring.pickup);
      tilt.value = withSpring(on ? SELECT_TILT : 0, Motion.spring.pickup);
    },
    [reduceMotion, selectLift]
  );
  useAnimatedReaction(
    () => pressed.value === cardId,
    (on) => {
      const key = `${on}|${reduceMotion}`;
      if (key === pressPosed.value) return;
      const first = pressPosed.value === "";
      pressPosed.value = key;
      if (first && !on) return;
      if (reduceMotion) press.value = on ? 1 : 0;
      else press.value = withSpring(on ? 1 : 0, on ? Motion.spring.pickup : Motion.spring.land);
    },
    [reduceMotion]
  );

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
      cancelAnimation(press);
    },
    [liftY, tilt, glow, dealing, exchangeState, shift, press]
  );
  useEffect(() => {
    onDrawn?.(card.id, { liftY, tilt, shift });
  }, [onDrawn, card.id, liftY, tilt, shift]);

  // A shared value set in the commit, not a captured prop: a restyled worklet reaches the view only after
  // paint, so a re-arced card would draw its old turn for a frame beside its new place.
  const arcTilt = useSharedValue(arcRot);
  useLayoutEffect(() => {
    arcTilt.set(arcRot);
  }, [arcTilt, arcRot]);
  const resizeFrom = useSharedValue({ dx: 0, dy: 0, s: 1 });
  const resizing = useSharedValue(0);
  const restRef = useRef({ x: restX, y: restY, w: cardW });
  useLayoutEffect(() => {
    const was = restRef.current;
    restRef.current = { x: restX, y: restY, w: cardW };
    if (was.w === cardW) return;
    const [from, k] = [resizeFrom.get(), resizing.get()];
    resizeFrom.set({ dx: was.x + from.dx * k - restX, dy: was.y + from.dy * k - restY, s: ((1 + (from.s - 1) * k) * was.w) / cardW });
    resizing.set(1);
    resizing.set(withTiming(0, { duration: motionMs("handResize", reduceMotion), reduceMotion: ReduceMotion.Never }));
  }, [restX, restY, cardW, reduceMotion, resizeFrom, resizing]);
  useEffect(() => () => cancelAnimation(resizing), [resizing]);
  // Handed the values rather than reading them: a mapper follows only the shared values in its own closure.
  const pose = (d: number, arc: number, tiltNow: number, pressNow: number, shiftNow: number, lift: number, gone: boolean, now: number) => {
    "worklet";
    const restRot = arc + tiltNow + pressNow * PRESS_TILT;
    if (dealAt >= 0) {
      const e = dealEase(Math.min(1, Math.max(0, (now - dealAt) / DEAL_FLIGHT_MS)));
      const a = handDealArc(e, restRot);
      return {
        opacity: gone || now < dealAt ? 0 : 1,
        tx: dealFromX * (1 - e) + shiftNow,
        ty: lift + pressNow * PRESS_RISE + dealRise * (1 - e) - a.lift,
        rot: a.rot,
        scale: a.scale,
      };
    }
    return {
      opacity: gone ? 0 : 1,
      tx: dealFromX * d + shiftNow,
      ty: lift + pressNow * PRESS_RISE + dealRise * d,
      rot: restRot * (1 - d),
      scale: 1,
    };
  };
  const resized = (p: ReturnType<typeof pose>, from: { dx: number; dy: number; s: number }, k: number) => {
    "worklet";
    return { ...p, tx: p.tx + from.dx * k, ty: p.ty + from.dy * k, scale: p.scale * (1 + (from.s - 1) * k) };
  };
  const aStyle = useAnimatedStyle(() => {
    const at = pose(dealing.value, arcTilt.value, tilt.value, press.value, shift.value, liftY.value, !!hidden?.value.includes(cardId), dealClock ? dealClock.value : 0);
    const p = resized(at, resizeFrom.value, resizing.value);
    return {
      opacity: p.opacity,
      transform: [{ translateX: p.tx }, { translateY: p.ty }, { rotate: `${p.rot}deg` }, { scale: p.scale }],
    };
  });
  const place = rects?.place;
  const rectOf = (p: ReturnType<typeof pose>, liftNow: number, glowNow: number, panNow: number, handLift: number, motionNow: TableMotion) => {
    "worklet";
    if (!place) return null;
    const card = { left, bottom, w: cardW, h: cardH, tx: p.tx, ty: p.ty, rot: p.rot, scale: p.scale, back: faceDown, lift: liftNow / selectLift, glow: glowNow };
    return designRect(handCard(place, card, panShown(panNow, place.panLimit), handLift), place.felt, motionNow);
  };
  const ownRects = useCardRect(
    rects?.table ?? null,
    `hand:${cardId}`,
    true,
    () => {
      "worklet";
      const at = pose(dealing.value, arcTilt.value, tilt.value, press.value, shift.value, liftY.value, !!hidden?.value.includes(cardId), dealClock ? dealClock.value : 0);
      const p = resized(at, resizeFrom.value, resizing.value);
      if (!place || p.opacity <= 0) return null;
      return rectOf(p, liftY.value, glow.value, place.pan.value, place.lift.value, place.motion.value);
    }
  );
  useAnimatedReaction(
    () => (dealClock ? dealClock.value : -1),
    (now, prev) => {
      const landAt = dealAt + DEAL_FLIGHT_MS;
      if (!onDealt || !place || prev === null || prev >= landAt || now < landAt) return;
      const p = pose(dealing.value, arcTilt.value, tilt.value, press.value, shift.value, liftY.value, false, now);
      const r = rectOf(p, liftY.value, glow.value, place.pan.value, place.lift.value, place.motion.value);
      if (r) scheduleOnRN(onDealt, r.x, r.y);
    }
  );

  const giveableStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, exchangeState.value),
  }));

  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  const veilStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, -exchangeState.value) }));

  const handleActivate = useCallback(() => onActivate(cardId), [onActivate, cardId]);
  const handleMove = useCallback(
    (action: string) => onMove?.(cardId, action),
    [onMove, cardId]
  );

  return (
    <Animated.View
      testID={`hand-card-${cardId}`}
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
      <FallbackGlow style={[handStyles.cardGlow, { borderRadius: cardRadius(cardW) }, glowStyle]} />
      {giveable === true && (
        <Animated.View
          pointerEvents="none"
          style={[
            handStyles.giveableHalo,
            { borderRadius: cardRadius(cardW) + GIVEABLE_HALO_PAD },
            giveableStyle,
          ]}
        />
      )}
      {received && (
        <Animated.View
          testID="hand-received-highlight"
          pointerEvents="none"
          style={[handStyles.giveableHalo, { borderRadius: cardRadius(cardW) + GIVEABLE_HALO_PAD }, haloStyle]}
        />
      )}
      <CardView
        card={card}
        selected={isSelected}
        onActivate={handleActivate}
        disabled={disabled}
        faceDown={faceDown}
        scale={size.scale}
        rectKey={`hand:${cardId}`}
        rects={ownRects}
        hitWidth={hitW}
        testID={isStartCard ? "card-start" : undefined}
        hint={hint}
        a11yActions={a11yActions}
        onA11yAction={onMove ? handleMove : undefined}
        a11yActionKeys={MOVE_KEYS}
        noLift
        style={handStyles.cardLayer}
      />
      {giveable === false && (
        <Animated.View
          pointerEvents="none"
          style={[handStyles.ungiveableVeil, { borderRadius: cardRadius(cardW) }, veilStyle]}
        />
      )}
    </Animated.View>
  );
}

const readAtMount = () => true;

/** The card by id, as CardView compares it: every `game:state` rebuilds every card object. */
export const cardItemPropsEqual = propsEqualExcept<CardItemProps>({
  card: byId,
  place: shallowEqual,
  size: shallowEqual,
  entry: propsEqualExcept<CardEntry>({ deal: readAtMount, descends: readAtMount }),
});

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

/**
 * Getters, read by the throw: a card thrown mid-lift leaves from where it is drawn, not from where
 * its lift is going. Built outside the component because the React Compiler skips a component
 * holding a getter.
 */
function liveFrom(x: () => number, y: () => number, rot: () => number, scale: number): CardFrom {
  return {
    get x() {
      return x();
    },
    get y() {
      return y();
    },
    get rot() {
      return rot();
    },
    scale,
  };
}

export const StraightHand = React.memo(function StraightHand({
  cards,
  store,
  selection,
  onActivate,
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
  arrivingIndex,
  descendingId,
  receivedId,
  lifted,
  startCardId,
  handBottomPad = 0,
  deal,
  onOrigins,
}: {
  cards: Card[];
  /** The selection, which each card subscribes to for its own accessible state; the row never re-renders for it. */
  store: SettledSelection;
  /** The same selection on the UI thread, which a tap on the row writes and every card's lift follows. */
  selection: HandSelection;
  /** A screen reader's activate, or Enter or Space: the tap, from the JS thread. */
  onActivate: (id: string) => void;
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
  /**
   * The slot a card still in flight is coming to. The row steps for the hand
   * *including* it and holds that slot empty, so the card lands in a space
   * already waiting rather than over a fan that has not moved.
   */
  arrivingIndex?: number;
  /**
   * The card that slot was held for, named on the render it mounts, so it
   * travels into the space rather than appearing in it. From the row's centre
   * rather than in from the deck: it is arriving off the felt, not being dealt.
   */
  descendingId?: string;
  /** The card just received in an exchange, which glows. */
  receivedId?: string;
  /** Cards an exchange flier draws instead, from its first frame (`ExchangeLegs`). */
  lifted?: SharedValue<string[]>;
  /**
   * The card the opening play must include, when this seat has to open. Only
   * that one card is named, and only while it is still owed: a device flow
   * reaches it by id rather than by counting, because Maestro's `index` sorts
   * matches by position and the arc puts the outermost card a pixel below its
   * neighbours — enough to sort it behind every one of them (#757).
   */
  startCardId?: string;
  /**
   * `TableFrame.bottomPad` — the safe-area inset `HAND_ZONE_H` reserves below
   * the row. `descendingId`'s own arrival reads it to start its descent from
   * where the exchange's flying card actually retires (`exchangeArrivalRise`)
   * rather than from the pile a freshly dealt card flies from.
   * Unused, so omittable, on any hand that never receives one.
   */
  handBottomPad?: number;
  /** Absent while the table deals nothing, and the hand appears in place. */
  deal?: HandDeal;
  /** Each drawn card's resting pose, from the hand zone's centre, in field-card units — where a throw leaves from. */
  onOrigins?: (origins: ReadonlyMap<string, CardFrom>) => void;
}) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const n = cards.length;
  // Declared here rather than in the reordering section below: the row parts
  // for an arriving card only when nothing is held, and the layout is solved
  // above that section.
  const [heldId, setHeldId] = useState<string | null>(null);
  const onTurn = isMyTurn === true;
  const size = useMemo(() => handCardSize(scale, onTurn, faceDown), [scale, onTurn, faceDown]);
  const { w: cardW, h: cardH } = size;
  const pile = deal?.pile ?? NO_OFFSET;
  const drawnRef = useRef(new Map<string, DrawnCard>());
  const onDrawn = useCallback((id: string, d: DrawnCard) => void drawnRef.current.set(id, d), []);
  const giveableSet = useMemo(
    () => (giveableIds === undefined ? null : new Set(giveableIds)),
    [giveableIds]
  );

  // Armed while the hand is empty, so the render on which a hand appears —
  // the start of a match, or of the next one after a rematch — is the render
  // whose cards mount staggered. A single card arriving later (the exchange
  // give-back) mounts with the deal disarmed and simply appears in place.
  const [dealArmed, setDealArmed] = useState(true);
  const [shownCount, setShownCount] = useState(n);
  if (n !== shownCount) {
    setShownCount(n);
    setDealArmed(shownCount === 0);
  }

  // A drag already under way owns the row, which then holds no slot open for an
  // arrival: the caller stops offering `onReorder` when a card is in the air, but
  // a gesture already in progress keeps its held card for at least one render past that.
  // Solved above the empty-hand return so the scroll effect below it can be a hook.
  const ids = useMemo(() => cards.map((c) => c.id), [cards]);
  const row = useMemo(
    () => layoutHandRow({ ids, arriving: arrivingIndex, held: heldId, size, roomW, availW, bottomPad: handBottomPad }),
    [ids, arrivingIndex, heldId, size, roomW, availW, handBottomPad]
  );
  const { totalW, scrollable, crop, visibleH, arcRise, tiltOverhang, topClearance, heldCeiling, strips } = row;

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
  const panLimit = row.panLimit;
  const panReach = useSharedValue(panLimit);
  useLayoutEffect(() => {
    panReach.set(panLimit);
  }, [panReach, panLimit]);
  const rowShiftStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: -(panReach.value + panShown(pan.value, panReach.value)) },
    ],
  }));
  const panToFocused = (e: { target: unknown; currentTarget: unknown }) => {
    const target = e.target as HTMLElement;
    // A press focuses the card too; panning then would slide the row out from under the finger.
    if (!target.matches(":focus-visible")) return;
    const card = target.closest<HTMLElement>('[data-testid^="hand-card-"]');
    if (!card) return;
    const box = card.getBoundingClientRect();
    const view = (e.currentTarget as Element).getBoundingClientRect();
    // About the centre, at the unturned width: a tilted card's bounding box is wider than the row lets it show.
    const mid = (box.left + box.right) / 2;
    const half = card.offsetWidth / 2;
    const by = Math.max(0, mid + half - view.right) - Math.max(0, view.left - (mid - half));
    if (by !== 0) pan.set(panShown(panShown(pan.get(), panLimit) + by, panLimit));
  };

  // ─── Reordering ────────────────────────────────────────────────────────────
  const canReorder = onReorder !== undefined && !disabled && !faceDown;
  const [gapAt, setGapAt] = useState<number | null>(null);
  // What the gesture is holding, beside the state the render draws from: the
  // last `onUpdate` and the `onEnd` that follows it can land in the same frame,
  // and a drop that read the slot back out of state would use the one from
  // before the move. Shared values rather than refs — a ref touched outside an
  // effect is a React Compiler bailout for the whole file
  // (`tests/ui-rules/reactCompiler.test.ts`).
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
  /** Whether a hold clock may be running, so a move hops to JS once to stop it rather than every frame. */
  const armed = useSharedValue(false);
  /** Set on the UI thread the frame the pick is scheduled, so it is scheduled once. */
  const picking = useSharedValue(false);
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

  // The held card is the only thing on this table that leaves the arc and
  // follows a finger in free two dimensions, which is what makes "held" legible
  // beside "selected" without a legend — selection has already spent lift,
  // rotation and a border.
  const heldAt = useDerivedValue(() => {
    const p = settle.value;
    // The wrapper sits at the row's own origin, so a card at `left: L` and
    // `bottom: B` is this same box translated by (L, −B).
    const fromX = fingerX.value - grabOffset.value;
    const fromY = Math.max(heldCeiling, fingerY.value - HELD_RISE - (visibleH - cardH / 2));
    return {
      p,
      tx: fromX + (settleX.value - fromX) * p,
      ty: fromY + (settleY.value - fromY) * p,
      rot: settleRot.value * p,
      scale: HELD_SCALE + (1 - HELD_SCALE) * p,
    };
  });
  const heldStyle = useAnimatedStyle(() => {
    const h = heldAt.value;
    return {
      transform: [{ translateX: h.tx }, { translateY: h.ty }, { rotate: `${h.rot}deg` }, { scale: h.scale }],
    };
  });

  // The cards still in the fan. A held one is laid out by the finger instead,
  // and the rest are arced as a hand of n−1 inside the row's own unchanged box
  // — which is the whole of "the fan closes behind the card that left".
  const heldCard = heldId === null ? null : (cards.find((c) => c.id === heldId) ?? null);
  const heldSelected = useSyncExternalStore(store.subscribe, () => heldId !== null && store.get().ids.includes(heldId));
  const rest = useMemo(
    () => (heldCard === null ? cards : cards.filter((c) => c.id !== heldCard.id)),
    [cards, heldCard]
  );

  const rowMid = row.width / 2;
  // Split either side of the slot, so the hand's centre holds still while the
  // gap opens and nothing shifts out from under the thumb.
  const gapW = heldCard === null ? 0 : cardW * GAP_CARDS;
  const gapShift = (i: number) => (gapAt === null ? 0 : i >= gapAt ? gapW / 2 : -gapW / 2);
  const places = row.cards.map((p, i) => (gapShift(i) === 0 ? p : { ...p, shift: p.shift + gapShift(i) }));
  // The drop index is measured against the strips, which carry no gap: the gap
  // is a consequence of the slot, so measuring the slot against a row the gap
  // has already moved makes the two chase each other.
  const lefts = strips.lefts;
  const refused = useMemo(() => rest.map((c) => giveableSet?.has(c.id) === false), [rest, giveableSet]);
  const shownIds = selection.shown;
  const liftH = handRowHeadroom(cardH);
  const tilt = reduceMotion ? 0 : SELECT_TILT;
  const fingerOn = (x: number, y: number): number | null => {
    'worklet';
    return cardUnder(strips, x, y, size, { raised: shownIds.value, gone: lifted?.value ?? [], lift: liftH, tilt });
  };
  const slots = row.slots;

  const fieldW = CARD_W(scale * FIELD_SCALE);
  const cardTable = useCardTable();
  const rowBase = row.base;
  const handRow = useMemo(() => {
    if (!cardTable) return undefined;
    const { felt, hand, handLift, motion } = cardTable;
    const clipHalf = scrollable ? availW / 2 : 0;
    return { table: cardTable, place: { felt, x: hand.x - rowMid, y: hand.y + rowBase, clipX: hand.x, clipHalf, pan, panLimit, lift: handLift, motion } };
  }, [cardTable, rowMid, rowBase, scrollable, availW, pan, panLimit]);
  useEffect(() => {
    cardTable?.handOrder.set(handPaintOrder(rest.map((c) => c.id), (id) => giveableSet?.has(id), heldCard?.id ?? null));
  }, [cardTable, rest, giveableSet, heldCard]);
  const heldPlace = handRow?.place;
  const heldRects = useCardRect(
    cardTable,
    `hand:${heldId ?? ""}`,
    heldId !== null,
    () => {
      "worklet";
      if (!heldPlace || heldId === null) return null;
      const h = heldAt.value;
      const card = { left: 0, bottom: 0, w: cardW, h: cardH, tx: h.tx, ty: h.ty, rot: h.rot, scale: h.scale, back: faceDown, lift: 1 - h.p, glow: heldSelected ? 1 : 0 };
      return designRect(handCard(heldPlace, card, panShown(heldPlace.pan.value, panLimit), heldPlace.lift.value), heldPlace.felt, heldPlace.motion.value);
    }
  );
  useEffect(() => {
    if (!onOrigins) return;
    const panNow = () => panShown(pan.get(), panLimit);
    const origins = new Map<string, CardFrom>();
    rest.forEach((card, i) => {
      const place = places[i];
      const selected = () => store.get().ids.includes(card.id);
      const d = drawnRef.current.get(card.id);
      const now = () =>
        restingOrigin(
          place,
          d
            ? { shift: d.shift.get(), lift: d.liftY.get(), tilt: d.tilt.get() }
            : { shift: place.shift, lift: selected() ? -liftH : 0, tilt: selected() ? SELECT_TILT : 0 }
        );
      origins.set(
        card.id,
        liveFrom(() => now().x - panNow(), () => now().y, () => now().rot, cardW / fieldW)
      );
    });
    onOrigins(origins);
  });

  const releaseHeld = () => {
    landing.value = false;
    holding.value = false;
    picking.value = false;
    settle.value = 0;
    held.value = null;
    gap.value = null;
    setHeldId(null);
    setGapAt(null);
    // A held card is out of the fan, so it re-mounts when it comes back — the
    // one way a card mounts without the hand's count changing, and the only
    // thing left that could still be holding the stagger armed from the mount.
    setDealArmed(false);
  };

  const grab = (x: number, y: number) => {
    if (held.value !== null) return;
    const i = fingerOn(x, y);
    if (i === null) return;
    // The card comes up under the part of it the finger is actually on. Every
    // card but the last shows only a `step`-wide strip, so a finger almost
    // always lands near a left edge, and centring the card on it instead threw
    // it half a card sideways at the moment of pickup.
    grabOffset.value = x - lefts[i];
    held.value = strips.ids[i];
    gap.value = i;
    setHeldId(strips.ids[i]);
    setGapAt(i);
  };

  /** The hold's own clock. It survives a finger that never moves, which is the point. */
  const armHold = () => {
    clearTimeout(holdTimer.value);
    holdTimer.value = setTimeout(() => {
      holding.value = true;
    }, HOLD_MS) as unknown as number;
  };
  const disarmHold = () => {
    clearTimeout(holdTimer.value);
    holdTimer.value = 0;
  };

  // Takes the slot, not the finger: `onUpdate` has already decided on the UI
  // thread that this is a new one, so the crossing happens once per slot rather
  // than once per frame of the drag.
  const trackGap = (at: number) => {
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
    settle.value = withTiming(1, { duration: ms, reduceMotion: ReduceMotion.Never }, () => scheduleOnRN(commit));
  };

  const drag = usePanGesture({
    // One finger owns the drag. A second one anywhere would otherwise rewrite
    // where the held card is going, and the first is left holding a card the
    // pointer that picked it up can no longer put down.
    maxPointers: 1,
    enabled: canReorder,
    // Activated by hand rather than by `activateAfterLongPress`, which is a hard
    // gate this needs to be a soft one: it fails the whole gesture the moment
    // the finger travels 15px before the hold lands, so a thumb that rolls gets
    // nothing at all — and worse, it leaves the browser no way to scroll a row
    // wider than the window. Until the hold fires, a moving finger scrolls.
    manualActivation: true,
    onTouchesDown: (e) => {
      const touch = e.allTouches[0];
      if (touch === undefined) return;
      fingerX.value = touch.x;
      fingerY.value = touch.y;
      grabX.value = touch.x;
      grabY.value = touch.y;
      panFrom.value = pan.value;
      armed.value = true;
      scheduleOnRN(armHold);
    },
    onTouchesMove: (e) => {
      const touch = e.allTouches[0];
      if (touch === undefined) return;
      fingerX.value = touch.x;
      fingerY.value = touch.y;
      const dx = touch.x - grabX.value;
      const dy = touch.y - grabY.value;
      if (holding.value) {
        // The hold arms the drag; travel is what spends it. Picking a card to
        // play is the whole game, and a thumb rests on one for longer than a
        // mouse does — so a press that never travels stays a press, however
        // long it lasts, and the card is never taken out from under it.
        if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
        GestureStateManager.activate(e.handlerTag);
        if (!picking.value) {
          picking.value = true;
          // From where the finger landed, not where it is now: that is the card
          // it chose, and the offset that brings it up under the same point.
          scheduleOnRN(grab, grabX.value, grabY.value);
        }
        return;
      }
      // Not held: the finger is reading the hand, so it moves the row rather
      // than a card. Anything but a horizontal drag is somebody else's gesture.
      if (Math.abs(dx) > Math.abs(dy)) {
        if (armed.value) {
          armed.value = false;
          scheduleOnRN(disarmHold);
        }
        if (panLimit > 0) pan.set(panFrom.value - dx);
      }
    },
    onUpdate: (e) => {
      fingerX.value = e.x;
      fingerY.value = e.y;
      // Advances a gap `grab` has already opened; never opens one. `grab` runs
      // on the other runtime, where each write is a separately queued UI job, so
      // between its `held` landing and its `gap` landing there is a frame where
      // opening one here would be overwritten by the pickup slot arriving after
      // it — leaving the shared value and the rendered gap on different slots,
      // and the card returning to where it was picked up.
      if (held.value === null || gap.value === null) return;
      const at = dropIndex(lefts, cardW, e.x);
      if (at === gap.value) return;
      gap.value = at;
      scheduleOnRN(trackGap, at);
    },
    onDeactivate: () => {
      // Claimed here rather than in `drop`: `onFinalize` runs on this thread the
      // moment this returns, while `drop` is still queued on the other one, so a
      // flag `drop` set would be read as false and the flight cancelled before
      // it began.
      landing.value = true;
      scheduleOnRN(drop);
    },
    // A gesture the system takes away — an incoming call, a swipe from the
    // edge — never reaches onDeactivate, and the card it lifted would float
    // there for the rest of the hand.
    onFinalize: () => {
      armed.value = false;
      scheduleOnRN(disarmHold);
      if (landing.value) return;
      scheduleOnRN(releaseHeld);
    },
  });

  const pressed = useSharedValue<string | null>(null);
  const tapSelection = selection.tap;
  const tap = useTapGesture({
    enabled: !disabled && !faceDown,
    maxDistance: DRAG_SLOP,
    maxDuration: ANY_PRESS_MS,
    onBegin: (e) => {
      // The web handler turns Enter and Space into a touch at the centre of whatever holds focus, in
      // that element's own coordinates; the card's `onActivate` already answers both.
      if (e.pointerType === PointerType.KEY) return;
      const i = fingerOn(e.x, e.y);
      pressed.value = i === null || refused[i] ? null : strips.ids[i];
    },
    onActivate: () => {
      const id = pressed.value;
      if (id !== null && !picking.value) tapSelection(id);
    },
    onFinalize: () => {
      pressed.value = null;
    },
  });
  const gestures = useSimultaneousGestures(drag, tap);

  if (n === 0) {
    return (
      <View style={[handStyles.handCenter, { width: availW, height: visibleH }]}>
        <EmptyHandLine scale={scale} />
      </View>
    );
  }

  const rowView = (
    <GestureDetector gesture={gestures}>
    <View
      testID="hand-row"
      style={[
        handStyles.handRow,
        { width: row.width, height: visibleH },
      ]}
    >
      {rest.map((card, i) => {
        const descending = card.id === descendingId;
        const giveable = giveableSet?.has(card.id);
        const place = places[i];
        // A card the exchange has ruled out is a control reporting itself
        // unavailable; offering it two working actions anyway says the opposite
        // in the same breath.
        const arrangeable = canReorder && giveable !== false;
        return (
        <CardItem
          key={card.id}
          card={card}
          store={store}
          place={place}
          size={size}
          // A descending card starts at the row's own centre, where the flight
          // carrying it stops (`flightOrigin`'s `bottom` is `dx: 0`), so crossing
          // and descent are one continuous move; a dealt one starts at the pile.
          entry={{
            ...entryOffset(row, place, descending ? NO_OFFSET : pile),
            deal: dealArmed && deal && !descending ? { clock: deal.clock, leaveMs: deal.offsetMs + dealLeaveMs(i, null), onDealt: deal.onDealt } : undefined,
            descends: descending,
          }}
          onActivate={onActivate}
          shown={selection.shown}
          pressed={pressed}
          a11yActions={arrangeable ? moveActions : undefined}
          onMove={arrangeable ? moveByAction : undefined}
          onDrawn={onDrawn}
          received={card.id === receivedId}
          hidden={lifted}
          rects={handRow}
          // An ungiveable card during an exchange is a button that reports
          // itself unavailable, rather than one that silently does nothing.
          disabled={disabled || giveable === false}
          giveable={giveable}
          hint={giveable === undefined ? undefined : giveable ? giveHint : refuseHint}
          faceDown={faceDown}
          // A giveable card draws over every neighbour regardless of the fan's
          // own order, so the eye lands on what can be chosen rather than on
          // whichever illegal card the draw order happened to put on top. The
          // lift is the row's own count — past every index it hands out —
          // clamped short of `HELD_Z`, which has to stay above both bands: a
          // hand this row could ever be handed is what makes the ceiling hold,
          // not an assumption about how big one gets.
          zIndex={handCardZ(i, rest.length, giveable)}
          isStartCard={card.id === startCardId}
        />
        );
      })}
      {heldCard !== null && (
        <Animated.View
          nativeID={`card-hand:${heldCard.id}`}
          pointerEvents="none"
          style={[
            handStyles.handCardWrap,
            { left: 0, bottom: 0, zIndex: HELD_Z, width: cardW, height: cardH },
            heldStyle,
          ]}
        >
          <CardView
            card={heldCard}
            selected={heldSelected}
            faceDown={faceDown}
            scale={size.scale}
            rectKey={`hand:${heldCard.id}`}
            rects={heldRects}
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
        {/*
          The hand compresses inside its share, so the window clips only when
          even the finger floor cannot fit the row in availW — a full hand on
          a small phone. The row overflows and is moved under a window that
          clips it, rather than clipping the hand or stepping below what a
          thumb can separate. Mounted either way: a change of parent would
          remount every card, and a card mid-resize would snap.

          The window clears everything the row *draws*, which is more than the
          row is tall: `topClearance` above it, and below it the crop plus
          what a tilt hangs past the bottom edge. `overflow` takes both axes
          or neither, so a box sized to the row alone cuts a straight line
          across the fan.

          The two negative margins give that extra room back to the layout,
          so the box occupies exactly `visibleH` and the row lands where an
          unclipped one sits. Stated rather than left to cancel
          out: the parent centres its children, so a box that is taller than
          what it stands in for moves the hand by half the difference.
        */}
        <View
          style={
            scrollable
              ? {
                  width: availW,
                  marginTop: -topClearance,
                  marginBottom: -(crop + tiltOverhang),
                  height: topClearance + visibleH + crop + tiltOverhang,
                  paddingTop: topClearance,
                  // `clip` on web: a focused card would otherwise scroll a `hidden` box, sliding the row off the pan it is drawn and hit-tested by.
                  overflow: Platform.OS === "web" ? ("clip" as "hidden") : "hidden",
                }
              : undefined
          }
          onFocus={scrollable && Platform.OS === "web" ? panToFocused : undefined}
        >
          <Animated.View testID="hand-pan" style={[{ width: totalW }, rowShiftStyle]}>{rowView}</Animated.View>
        </View>
      </View>
    </View>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const handStyles = StyleSheet.create({
  handCenter: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: Spacing.slim,
  },
  handGlowWrap: { borderRadius: Radius.md, padding: Spacing.xs },
  // The three layers of a card, in the order they paint. Stated on all of them,
  // because the iOS renderer does not promise the order they are written in
  // (#209) and two of these resolve opposite ways around the card.
  cardGlow: {
    position: "absolute",
    top: 2, left: 2, right: 2, bottom: 2,
    zIndex: Layer.felt,
    backgroundColor: CardGlow.color,
    ...Shadow.cardGlow,
  },
  cardLayer: { zIndex: Layer.table },
  handRow: {
    position: "relative",
    alignSelf: "center",
  },
  handCardWrap: { position: "absolute" },
  // Its corner comes from the card's own width at the call site, never from a
  // fixed radius: a card rounds at a share of itself, so a veil rounding at a
  // constant leaves a crescent of undimmed face at each of the four corners —
  // four bright specks on a card that is meant to have receded.
  ungiveableVeil: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: VEIL_Z,
    backgroundColor: UNGIVEABLE_DIM,
  },
  // Behind the card (`GIVEABLE_HALO_Z` is `Layer.felt`, under `cardLayer`'s
  // `Layer.table`), so nothing it draws ever reaches the card's own face —
  // only the rim a fan's overlap leaves exposed. `GIVEABLE_HALO_PAD` inset
  // negative, restated as a literal rather than the constant: the stacking
  // scan (tests/ui-rules/stackingIsStated.test.ts) reads insets off the source text.
  //
  // Never a border: a fan overlaps by design, and only the top edge of a
  // bordered card survives it — a run of them joins into one hard line with a
  // square cap at either end, a frame the cards are trapped in rather than a
  // mark on each. A fill has no edge to join.
  giveableHalo: {
    position: "absolute",
    top: -2, left: -2, right: -2, bottom: -2,
    zIndex: GIVEABLE_HALO_Z,
    backgroundColor: Colors.gold,
  },
});
