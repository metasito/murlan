import { useEffect } from "react";
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
import { DEAL_FLIGHT_MS } from "@/components/flightPhysics";
import { Layer } from "@/lib/theme";

export interface DealtCard {
  key: string;
  /** When it leaves the pile, in ms after the deal started. */
  leaveMs: number;
  /** Its seat, from the pile — `flightOrigin` for that seat. */
  to: { dx: number; dy: number };
}

const DEAL_EASING = Easing.bezier(0.22, 0.61, 0.36, 1.0);
const DEAL_SPIN_DEG = 180;

function DealtBack({ card, scale }: { card: DealtCard; scale: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(card.leaveMs, withTiming(1, { duration: DEAL_FLIGHT_MS, easing: DEAL_EASING }));
    return () => cancelAnimation(progress);
  }, [card.leaveMs, progress]);
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
