import { useEffect, useMemo, useState } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { CardView } from "@/components/CardView";
import { BACK_SCALE } from "@/components/cardFaceModel";
import { Layer, motionMs } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { handCountOf } from "@/shared/protocol";
import {
  dealArrivalsMs,
  dealFlightsMs,
  dealLeaveMs,
  seatPoint,
  type SeatGeometry,
} from "@/components/flightPhysics";

/** A deal in progress: `counts` is each seat's hand as dealt, `flightsMs` each seat's flight time, by seat index. */
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
  arrivalsFor: (seat: number) => number[] | undefined;
  handOffsetMs: number;
  dealing: boolean;
} {
  const { players, opponents, viewerSeat } = geometry;
  const newDeal = (key: number, offsetMs: number): Deal => ({
    key,
    offsetMs,
    counts: players.map(handCountOf),
    flightsMs: dealFlightsMs(players.map((_, seat) => seatPoint(geometry, seat))),
  });
  const [deal, setDeal] = useState<Deal | null>(() => (fresh ? newDeal(1, entryMs) : null));
  const [dealtFresh, setDealtFresh] = useState(fresh);
  if (fresh !== dealtFresh) {
    setDealtFresh(fresh);
    if (fresh) setDeal(newDeal((deal?.key ?? 0) + 1, 0));
  }
  const arrivals = useMemo(
    () =>
      deal && !reduceMotion
        ? deal.counts.map((count, seat) => dealArrivalsMs(count, seat, deal.counts.length, deal.offsetMs, deal.flightsMs[seat]))
        : null,
    [deal, reduceMotion]
  );
  useEffect(() => {
    if (!deal) return;
    const lastLanding = Math.max(0, ...(arrivals ?? []).map((a) => a[a.length - 1] ?? 0));
    const id = setTimeout(() => setDeal(null), lastLanding);
    return () => clearTimeout(id);
  }, [deal, arrivals]);
  const cards: DealtCard[] =
    deal && arrivals
      ? [opponents.top, opponents.left, opponents.right].flatMap((o) => {
          if (!o) return [];
          const to = seatPoint(geometry, o.seat);
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
    handOffsetMs: deal ? deal.offsetMs + dealLeaveMs(0, viewerSeat, players.length) : 0,
    dealing: deal !== null,
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

const DEAL_EASING = Easing.bezier(0.22, 0.61, 0.36, 1.0);
const DEAL_SPIN_DEG = 180;

function DealtBack({ card, scale }: { card: DealtCard; scale: number }) {
  const progress = useSharedValue(0);
  const flightMs = usePrefersReducedMotion() ? motionMs("travel", true) : card.flightMs;
  useEffect(() => {
    progress.value = withDelay(card.leaveMs, withTiming(1, { duration: flightMs, easing: DEAL_EASING }));
    return () => cancelAnimation(progress);
  }, [card.leaveMs, flightMs, progress]);
  const { dx, dy } = card.to;
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: p > 0 && p < 1 ? 1 : 0,
      transform: [{ translateX: dx * p }, { translateY: dy * p }, { rotate: `${DEAL_SPIN_DEG * p}deg` }],
    };
  });
  return (
    <Animated.View testID="dealt-back" style={[dealStyles.back, style]}>
      <CardView card={{ id: "bk", suit: null, rank: "3", isJoker: false }} faceDown scale={scale * BACK_SCALE} />
    </Animated.View>
  );
}

/** The opponents' hands leaving the pile, one back per card, round-robin. */
export function DealFlights({ cards, scale }: { cards: readonly DealtCard[]; scale: number }) {
  return (
    <View style={[dealStyles.container, { pointerEvents: "none" as const }]}>
      {cards.map((card) => (
        <DealtBack key={card.key} card={card} scale={scale} />
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
