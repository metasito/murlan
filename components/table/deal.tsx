import { useCallback, useEffect, useMemo, useState } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  Easing,
  makeMutable,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  type FrameInfo,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { CardView } from "@/components/CardView";
import { BACK_SCALE } from "@/components/cardFaceModel";
import { Layer, motionMs } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { withdraw } from "@/lib/device/feedback";
import { handCountOf } from "@/shared/protocol";
import { seatPoint, type SeatGeometry } from "@/components/flightPhysics";
import { seatDirection } from "@/components/seatLayout";
import { dealArrivalsMs, dealEndMs, dealFlightsMs, dealLeaveMs } from "@/lib/game/dealTimeline";

/** When each of a seat's cards lands, on the deal's own clock. */
export interface DealArrivals { at: readonly number[]; clock: SharedValue<number> }

/** A deal in progress:`counts` is each seat's hand as dealt, `flightsMs` each seat's flight time, by seat index. */
interface Deal {
  key: number;
  offsetMs: number;
  counts: number[];
  flightsMs: number[];
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
  cards: DealtCard[];
  arrivalsFor: (seat: number) => DealArrivals | undefined;
  handOffsetMs: number | undefined;
  dealing: boolean;
  /** The deal's own clock, ms since its first frame; -1 before it. `DealFlights` steps it. */
  clock: SharedValue<number>;
  startMs: number;
  endMs: number;
  onLanded: () => void;
} {
  const { players, opponents, viewerSeat } = geometry;
  const newDeal = (key: number, offsetMs: number): Deal => ({
    key,
    offsetMs,
    counts: players.map(handCountOf),
    flightsMs: dealFlightsMs(players.map((_, seat) => seatPoint(geometry, seatDirection(seat, viewerSeat, players.length)))),
  });
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
            at: dealArrivalsMs(count, seat, deal.counts.length, deal.offsetMs, deal.flightsMs[seat]),
            clock: clockOf.clock,
          }))
        : null,
    [deal, reduceMotion, clockOf]
  );
  const onLanded = useCallback(() => setDeal(null), []);
  const cards: DealtCard[] =
    deal && arrivals
      ? (["top", "left", "right"] as const).flatMap((side) => {
          const o = opponents[side];
          if (!o) return [];
          const to = seatPoint(geometry, side);
          return Array.from({ length: deal.counts[o.seat] }, (_, round) => ({
            key: `${deal.key}-${o.seat}-${round}`,
            leaveMs: deal.offsetMs + dealLeaveMs(round, o.seat, players.length),
            flightMs: deal.flightsMs[o.seat],
            to,
          }));
        })
      : [];
  return {
    cards,
    arrivalsFor: (seat) => arrivals?.[seat],
    handOffsetMs: deal ? deal.offsetMs + dealLeaveMs(0, viewerSeat, players.length) : undefined,
    dealing: deal !== null,
    clock: clockOf.clock,
    startMs: deal?.offsetMs ?? 0,
    endMs: deal ? dealEndMs(deal.counts, deal.offsetMs, deal.flightsMs) : 0,
    onLanded,
  };
}

export interface DealtCard {
  key: string;
  /** When it leaves the pile, in ms after the deal started. */
  leaveMs: number;
  flightMs: number;
  /** Its seat, from the pile — `flightOrigin` for that seat. */
  to: { dx: number; dy: number };
}

const DEAL_EASING = Easing.bezierFn(0.22, 0.61, 0.36, 1.0);
const DEAL_SPIN_DEG = 180;

function DealtBack({ card, scale, clock }: { card: DealtCard; scale: number; clock: SharedValue<number> }) {
  const flightMs = usePrefersReducedMotion() ? motionMs("travel", true) : card.flightMs;
  const { dx, dy } = card.to;
  const style = useAnimatedStyle(() => {
    const k = Math.min(1, Math.max(0, (clock.value - card.leaveMs) / flightMs));
    const p = DEAL_EASING(k);
    return {
      opacity: k > 0 && k < 1 ? 1 : 0,
      transform: [{ translateX: dx * p }, { translateY: dy * p }, { rotate: `${DEAL_SPIN_DEG * p}deg` }],
    };
  });
  return (
    <Animated.View testID="dealt-back" style={[dealStyles.back, style]}>
      <CardView card={{ id: "bk", suit: null, rank: "3", isJoker: false }} faceDown scale={scale * BACK_SCALE} />
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
 * The opponents' hands leaving the pile, one back per card, round-robin, all on the deal's one
 * clock. On its first frame it reports `onStarted(at)`, when the first card will leave in
 * `performance.now()` ms, so the cue is sent ahead; `onLanded` when the last lands.
 */
export function DealFlights({ cards, scale, clock, startMs, endMs, onStarted, onLanded }: {
  cards: readonly DealtCard[];
  scale: number;
  clock: SharedValue<number>;
  startMs: number;
  endMs: number;
  onStarted: (at: number) => void;
  onLanded: () => void;
}) {
  const origin = useSharedValue(-1);
  const [step] = useState(() => dealStepper(clock, origin, startMs, endMs, onStarted, onLanded));
  useFrameCallback(step);
  useEffect(() => () => withdraw("deal"), []);
  return (
    <View style={[dealStyles.container, { pointerEvents: "none" as const }]}>
      {cards.map((card) => (
        <DealtBack key={card.key} card={card} scale={scale} clock={clock} />
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
