import { useCallback, useEffect, useMemo, useState } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  makeMutable,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  type FrameInfo,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { CardView } from "@/components/CardView";
import { BACK_SCALE, CARD_BACK_H, CARD_BACK_W } from "@/components/cardFaceModel";
import { Layer, Motion } from "@/lib/theme";
import { withdraw } from "@/lib/device/feedback";
import { handCountOf } from "@/shared/protocol";
import { seatPoint, type SeatGeometry } from "@/components/flightPhysics";
import type { HandDeal } from "@/components/table/hand";
import { dealArrivalsMs, dealEndMs } from "@/lib/game/dealTimeline";
import { dealLegs, dealSlotOf, dealSlots, legAt, type DealLeg } from "@/components/table/dealSlots";
import { dealBreath, dealFlight, dealPose } from "@/components/table/dealPose";
import { useTraceSource } from "@/lib/e2eTrace";
import { dealBack, designRect } from "@/components/table/cardRects";
import { useCardRect, useCardTable } from "@/components/table/useCardRects";

function pileFromHand(geometry: SeatGeometry) {
  const hand = seatPoint(geometry, "bottom");
  return { dx: -hand.dx, dy: -hand.dy };
}

/** When each of a seat's cards lands, on the deal's own clock. */
export interface DealArrivals { at: readonly number[]; clock: SharedValue<number> }

/** A deal in progress:`counts` is each seat's hand as dealt, by seat index. */
interface Deal {
  key: number;
  offsetMs: number;
  counts: number[];
  legs: DealLeg[];
}

/**
 * A fresh deal is a manche nobody has opened yet. The first one waits out the
 * table's own entry beat (`entryMs`); a later one, dealt onto a table already
 * standing, starts at once.
 */
export function useDeal({
  geometry,
  fresh,
  entryMs,
  reduceMotion,
}: {
  geometry: SeatGeometry;
  fresh: boolean;
  entryMs: number;
  reduceMotion: boolean;
}): {
  cards: DealLeg[];
  arrivalsFor: (seat: number) => DealArrivals | undefined;
  hand: Omit<HandDeal, "onDealt"> | undefined;
  dealing: boolean;
  /** The deal's own clock, ms since its first frame; -1 before it. `DealFlights` steps it. */
  clock: SharedValue<number>;
  startMs: number;
  endMs: number;
  onLanded: () => void;
} {
  const { players, viewerSeat } = geometry;
  const newDeal = (key: number, offsetMs: number): Deal => {
    const timing = { key, offsetMs, counts: players.map(handCountOf) };
    return { ...timing, legs: dealLegs(geometry, timing) };
  };
  const [deal, setDeal] = useState<Deal | null>(() => (fresh ? newDeal(1, entryMs) : null));
  const [dealtFresh, setDealtFresh] = useState(fresh);
  if (fresh !== dealtFresh) {
    setDealtFresh(fresh);
    if (fresh) setDeal(newDeal((deal?.key ?? 0) + 1, 0));
  }
  if (deal && reduceMotion) setDeal(null);
  const [clockOf, setClockOf] = useState(() => ({ key: deal?.key ?? 0, clock: makeMutable(-1) }));
  if (deal && clockOf.key !== deal.key) setClockOf({ key: deal.key, clock: makeMutable(-1) });
  const arrivals = useMemo(
    () =>
      deal && !reduceMotion
        ? deal.counts.map((count, seat) => ({
            at: dealArrivalsMs(count, deal.offsetMs, dealSlotOf(seat, viewerSeat, deal.counts.length)),
            clock: clockOf.clock,
          }))
        : null,
    [deal, reduceMotion, clockOf, viewerSeat]
  );
  const onLanded = useCallback(() => setDeal(null), []);
  const cards = deal && arrivals ? deal.legs : [];
  return {
    cards,
    arrivalsFor: (seat) => arrivals?.[seat],
    hand: deal && arrivals ? { offsetMs: deal.offsetMs, clock: clockOf.clock, pile: pileFromHand(geometry) } : undefined,
    dealing: deal !== null,
    clock: clockOf.clock,
    startMs: deal?.offsetMs ?? 0,
    endMs: deal ? dealEndMs(deal.counts, deal.offsetMs) : 0,
    onLanded,
  };
}

/** The felt's one breath at the deal's onset, `offsetMs` on its clock. */
export function useDealBreath(deal: { offsetMs: number; clock: SharedValue<number> } | undefined) {
  const clock = deal?.clock;
  const onset = deal?.offsetMs ?? 0;
  const scale = useCallback(() => {
    "worklet";
    return clock ? dealBreath(clock.value - onset, Motion.deal.breath) : 1;
  }, [clock, onset]);
  useTraceSource("breath", scale);
  // Read here, not through `scale()`: a mapper follows only the shared values in its own closure.
  return useAnimatedStyle(() => ({ transform: [{ scale: clock ? dealBreath(clock.value - onset, Motion.deal.breath) : 1 }] }));
}

function DealtBack({ legs, scale, clock }: { legs: readonly DealLeg[]; scale: number; clock: SharedValue<number> }) {
  const style = useAnimatedStyle(() => dealPose(legAt(legs, clock.value), clock.value));
  const table = useCardTable();
  const w = CARD_BACK_W(scale * BACK_SCALE);
  const h = CARD_BACK_H(scale * BACK_SCALE);
  const pile = table?.pile;
  const felt = table?.felt;
  const motion = table?.motion;
  const ownRects = useCardRect(
    table,
    `deal:${legs[0].key}`,
    true,
    () => {
      "worklet";
      const f = dealFlight(legAt(legs, clock.value), clock.value);
      return pile && felt && motion && f.inAir ? designRect(dealBack(pile, f, w, h), felt, motion.value) : null;
    }
  );
  return (
    <Animated.View testID="dealt-back" nativeID={`card-deal:${legs[0].key}`} style={[dealStyles.back, style]}>
      <CardView card={{ id: "bk", suit: null, rank: "3", isJoker: false }} faceDown scale={scale * BACK_SCALE} rectKey={`deal:${legs[0].key}`} rects={ownRects} />
    </Animated.View>
  );
}

function dealStepper(clock: SharedValue<number>, origin: SharedValue<number>, startMs: number, endMs: number, started: (at: number) => void, landed: () => void) {
  return (frame: FrameInfo) => {
    "worklet";
    if (clock.value >= endMs) return;
    if (origin.value < 0) {
      origin.value = frame.timestamp;
      scheduleOnRN(started, frame.timestamp + startMs);
    }
    clock.value = frame.timestamp - origin.value;
    if (clock.value >= endMs) scheduleOnRN(landed);
  };
}

/**
 * The opponents' hands leaving the pile, round-robin, all on the deal's one clock, drawn by as
 * few backs as legs are ever in the air at once. On its first frame it reports `onStarted(at)`,
 * when the first card will leave in `performance.now()` ms, so the cue is sent ahead; `onLanded`
 * when the last lands, and its frame callback goes idle.
 */
export function DealFlights({ cards, scale, clock, startMs, endMs, onStarted, onLanded }: {
  cards: readonly DealLeg[];
  scale: number;
  clock: SharedValue<number>;
  startMs: number;
  endMs: number;
  onStarted: (at: number) => void;
  onLanded: () => void;
}) {
  const origin = useSharedValue(-1);
  const [landed, setLanded] = useState(false);
  const [step] = useState(() => dealStepper(clock, origin, startMs, endMs, onStarted, () => {
    setLanded(true);
    onLanded();
  }));
  const frames = useFrameCallback(step);
  useEffect(() => {
    if (landed) frames.setActive(false);
  }, [landed, frames]);
  useEffect(() => () => withdraw("deal"), []);
  const slots = useMemo(() => dealSlots(cards), [cards]);
  return (
    <View style={[dealStyles.container, { pointerEvents: "none" as const }]}>
      {slots.map((legs) => (
        <DealtBack key={legs[0].key} legs={legs} scale={scale} clock={clock} />
      ))}
    </View>
  );
}

const dealStyles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: Layer.sheet,
  },
  back: { position: "absolute" },
});
